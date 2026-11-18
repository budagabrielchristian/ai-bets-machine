// Fixtures, prices and results, fetched by the server only.
import fs from 'node:fs';
import path from 'node:path';
import { fixtureDay } from '../src/services/fixtureDay.js';
import { config } from './config.js';
import { log } from './log.js';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
const scoreboard = (league, day) => ESPN + league + '/scoreboard?dates=' + day + '&limit=1000';

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'ai-bets-machine/1.0' } });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

const american = value => {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) < 100) return NaN;
  return Number((1 + (n > 0 ? n / 100 : 100 / -n)).toFixed(2));
};

function readBookmakers(game, home, away) {
  return (Array.isArray(game.odds) ? game.odds : []).flatMap(line => {
    if (!line) return [];
    const quote = q => american(q?.close?.odds ?? q?.current?.odds);
    const outcomes = [['home', home], ['draw', 'Draw'], ['away', away]].map(([side, name]) => {
      const price = quote(line.moneyline?.[side]);
      return Number.isFinite(price) ? { name, price, open: american(line.moneyline?.[side]?.open?.odds) } : null;
    });
    const markets = outcomes.every(Boolean) ? [{ key: 'h2h', outcomes }] : [];
    const total = Number(line.overUnder);
    if (Number.isFinite(total) && total > 0 && total % 1 === 0.5) {
      const sides = ['over', 'under'].map(side => {
        const q = line.total?.[side]?.close;
        const price = american(q?.odds);
        if (!Number.isFinite(price) || Number(String(q?.line).replace(/^[ou]/i, '')) !== total) return null;
        return { name: side + ' ' + total, side, line: total, price };
      });
      if (sides.every(Boolean)) markets.push({ key: 'total', title: 'Total goals', outcomes: sides });
    }
    const handicap = ['home', 'away'].map(side => {
      const q = line.pointSpread?.[side]?.close;
      const points = Number(q?.line), price = american(q?.odds);
      if (Math.abs(points % 1) !== 0.5 || !Number.isFinite(price)) return null;
      return { name: (side === 'home' ? home : away) + ' ' + (points > 0 ? '+' : '') + points, side, line: points, price };
    });
    if (handicap.every(Boolean) && handicap[0].line === -handicap[1].line) markets.push({ key: 'handicap', title: 'Goal handicap', outcomes: handicap });
    return markets.length ? [{ title: line.provider?.name || 'ESPN', markets }] : [];
  });
}

const leagueOf = event => event.uid?.match(/l:(\d+)/)?.[1] || 'unknown';

function parseEvent(event, leagueId) {
  const game = event.competitions?.[0];
  const home = game?.competitors?.find(c => c.homeAway === 'home');
  const away = game?.competitors?.find(c => c.homeAway === 'away');
  if (!home?.team || !away?.team || !Number.isFinite(Date.parse(event.date))) return null;
  return { id: event.id, league: leagueOf(event), leagueId, sport_title: game.altGameNote || 'Football',
    commence_time: event.date, home_team: home.team.name, away_team: away.team.name,
    homeId: home.team.id, awayId: away.team.id,
    statusLabel: event.status?.type?.shortDetail, statusName: event.status?.type?.name,
    bookmakers: readBookmakers(game, home.team.name, away.team.name) };
}

/* ------------------------------------------------------------ fixtures --- */

async function fetchFixtures(now = new Date()) {
  const days = [-1, 0, 1, 2].map(offset => fixtureDay(now, offset).replaceAll('-', ''));
  const feeds = days.map(day => ({ league: 'all', day }));
  for (const league of ['uefa.champions', 'uefa.europa', 'uefa.europa.conf']) {
    for (const day of days.slice(1, 3)) feeds.push({ league, day });
  }
  const batches = await Promise.allSettled(feeds.map(async ({ league, day }) => {
    const data = await getJson(scoreboard(league, day));
    return (data.events || []).flatMap(e => {
      const m = parseEvent(e, league === 'all' ? undefined : league);
      return m && fixtureDay(m.commence_time) >= fixtureDay(now) ? [m] : [];
    });
  }));
  if (batches[1].status === 'rejected') throw new Error('Fixture feed unavailable');
  const fixtures = new Map();
  for (const batch of batches) {
    if (batch.status !== 'fulfilled') continue;
    for (const match of batch.value) {
      const other = fixtures.get(match.id);
      if (other) {
        const books = new Map(other.bookmakers.map(b => [b.title, b]));
        for (const book of match.bookmakers) {
          const markets = new Map((books.get(book.title)?.markets || []).map(m => [m.key, m]));
          book.markets.forEach(m => markets.set(m.key, m));
          books.set(book.title, { ...book, markets: [...markets.values()] });
        }
        match.bookmakers = [...books.values()];
        match.leagueId = match.leagueId || other.leagueId;
      }
      fixtures.set(match.id, match);
    }
  }
  return [...fixtures.values()];
}

/* ------------------------------------------------- optional Odds API --- */

let quotes = { at: 0, data: [] };
async function fetchQuotes() {
  if (!config.oddsApiKey) return [];
  if (Date.now() - quotes.at < config.oddsApiIntervalMinutes * 60000) return quotes.data;
  const data = [];
  for (const sport of config.oddsApiSports) {
    try {
      const url = 'https://api.the-odds-api.com/v4/sports/' + encodeURIComponent(sport) +
        '/odds/?regions=eu,uk&markets=h2h&oddsFormat=decimal&apiKey=' + encodeURIComponent(config.oddsApiKey);
      const rows = await getJson(url);
      if (Array.isArray(rows)) data.push(...rows.map(r => ({ ...r, sport_key: sport })));
    } catch (error) {
      log.warn('Odds API request failed for ' + sport + ': ' + error.message);
    }
  }
  quotes = { at: Date.now(), data };
  return data;
}

/* ------------------------------------------------------- merged feed --- */

let cache = { at: 0, matches: [], error: null };
let pending = null;

export function getMatches({ force = false, maxAge = 60000 } = {}) {
  if (pending) return pending;
  if (!force && Date.now() - cache.at < maxAge) return Promise.resolve(cache.matches);
  pending = Promise.all([fetchFixtures(), fetchQuotes()]).then(([fixtures, extra]) => {
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = m => [Date.parse(m.commence_time), norm(m.home_team), norm(m.away_team)].join('|');
    const merged = new Map(fixtures.map(m => [key(m), m]));
    for (const quote of extra) {
      const fixture = merged.get(key(quote));
      if (fixture) merged.set(key(quote), { ...fixture, bookmakers: [...(quote.bookmakers || []), ...fixture.bookmakers] });
    }
    cache = { at: Date.now(), error: null,
      matches: [...merged.values()].sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time)) };
    return cache.matches;
  }).catch(error => {
    cache = { ...cache, error: error.message };
    throw error;
  }).finally(() => { pending = null; });
  return pending;
}

export const feedStatus = () => ({ updatedAt: cache.at || null, error: cache.error, count: cache.matches.length });

/* ------------------------------------------------------------ results --- */

function parseResult(event) {
  const type = event.status?.type;
  if (['STATUS_CANCELED', 'STATUS_CANCELLED', 'STATUS_ABANDONED', 'STATUS_POSTPONED'].includes(type?.name)) {
    return type.name === 'STATUS_POSTPONED' ? null : { void: true };
  }
  if (!type?.completed) return null;
  const game = event.competitions?.[0];
  const home = game?.competitors?.find(c => c.homeAway === 'home');
  const away = game?.competitors?.find(c => c.homeAway === 'away');
  // Bets settle on 90 minutes; drop extra time when the game went beyond it.
  const extended = event.status.period > 2 || /extra|penalt|AET/i.test(type.detail + ' ' + type.shortDetail);
  const score = c => {
    if (!extended) return /^\d+$/.test(String(c?.score)) ? Number(c.score) : NaN;
    const halves = c?.linescores?.slice(0, 2);
    return halves?.length === 2 ? halves.reduce((n, h) => n + Number(h.value), 0) : NaN;
  };
  const homeScore = score(home), awayScore = score(away);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
  return { homeTeam: home.team.name, awayTeam: away.team.name, homeId: home.team.id, awayId: away.team.id,
    homeScore, awayScore, league: leagueOf(event), date: Date.parse(event.date),
    winningSelection: homeScore > awayScore ? home.team.name : homeScore < awayScore ? away.team.name : 'Draw' };
}

/**
 * Final results keyed by event id for the given YYYYMMDD days, plus the set
 * of days that downloaded successfully (a missing game only means something
 * when its day was actually checked).
 */
export async function getResults(days) {
  const results = {};
  const checked = new Set();
  await Promise.all(days.map(async day => {
    try {
      const data = await getJson(scoreboard('all', day));
      for (const event of data.events || []) {
        const r = parseResult(event);
        if (r) results[event.id] = r;
      }
      checked.add(day);
    } catch { /* retried on the next tick */ }
  }));
  return { results, checked };
}

/* ------------------------------------------------------------ history --- */

/**
 * A rolling year of completed games for the rating models. Each finished day
 * is cached on disk, so after the first run only new days are downloaded.
 */
export async function getHistory(daysBack = config.historyDays) {
  const dir = path.join(config.dataDir, 'history');
  fs.mkdirSync(dir, { recursive: true });
  const today = new Date();
  const days = [];
  for (let i = 1; i <= daysBack; i++) days.push(fixtureDay(today, -i).replaceAll('-', ''));
  const results = [];
  let fetched = 0;
  const queue = [...days];
  async function worker() {
    while (queue.length) {
      const day = queue.shift();
      const file = path.join(dir, day + '.json');
      // Recent days can still change (late results), so refresh the last three.
      const fresh = days.indexOf(day) < 3;
      if (!fresh && fs.existsSync(file)) {
        try { results.push(...JSON.parse(fs.readFileSync(file, 'utf8'))); continue; } catch { /* refetch */ }
      }
      try {
        const data = await getJson(scoreboard('all', day));
        const games = (data.events || []).map(parseResult).filter(r => r && !r.void)
          .map(r => ({ date: r.date, league: r.league, homeId: r.homeId, awayId: r.awayId, homeScore: r.homeScore, awayScore: r.awayScore }));
        fs.writeFileSync(file, JSON.stringify(games));
        results.push(...games);
        fetched++;
      } catch (error) {
        log.warn('History download failed for ' + day + ': ' + error.message);
        // Offline: keep the older cached copy of this day if there is one.
        try { results.push(...JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { /* none cached */ }
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  // Remove cached days that fell out of the window.
  const keep = new Set(days.map(d => d + '.json'));
  for (const name of fs.readdirSync(dir)) if (!keep.has(name)) fs.rmSync(path.join(dir, name), { force: true });
  return { results, fetched };
}

/** Find the current price for a ticket leg in the live feed. */
export function findPrice(match, leg) {
  const book = match?.bookmakers?.find(b => b.title === leg.bookmaker);
  if (!book) return null;
  const market = book.markets?.find(m => m.key === (leg.market || 'h2h'));
  if (!market) return null;
  const outcome = (leg.market || 'h2h') === 'h2h'
    ? market.outcomes.find(o => o.name === leg.selection)
    : market.outcomes.find(o => o.side === leg.side && o.line === leg.line);
  return outcome && Number.isFinite(outcome.price) ? outcome.price : null;
}
