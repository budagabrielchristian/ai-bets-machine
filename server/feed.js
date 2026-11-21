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

async function fetchFixtures(now = new Date(), offsets = [-1, 0, 1, 2], europeanOffsets = [0, 1]) {
  const days = offsets.map(offset => fixtureDay(now, offset).replaceAll('-', ''));
  const feeds = days.map(day => ({ league: 'all', day }));
  for (const league of ['uefa.champions', 'uefa.europa', 'uefa.europa.conf']) {
    for (const offset of europeanOffsets) feeds.push({ league, day: fixtureDay(now, offset).replaceAll('-', '') });
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
// Free plan: 500 credits a month, 1 credit per sport per call (one region, one market).
// The cache lives on disk so the online engine (a new process every pass) does not
// refetch every 15 minutes, and a budget guard stops before the monthly allowance runs out.

const oddsCacheFile = () => path.join(config.dataDir, 'odds-cache.json');
const thisMonth = () => new Date().toISOString().slice(0, 7);

function readOddsCache() {
  try { return JSON.parse(fs.readFileSync(oddsCacheFile(), 'utf8')); } catch { return { at: 0, data: [], remaining: null, month: null }; }
}

async function fetchQuotes() {
  if (!config.oddsApiKey) return [];
  const cached = readOddsCache();
  if (Date.now() - cached.at < config.oddsApiIntervalMinutes * 60000) return cached.data;
  if (cached.month === thisMonth() && cached.remaining !== null && cached.remaining < config.oddsApiReserve) {
    log.warn('Odds API: only ' + cached.remaining + ' requests left this month, pausing until next month.');
    return cached.data;
  }
  const data = [];
  let remaining = cached.month === thisMonth() ? cached.remaining : null;
  for (const sport of config.oddsApiSports) {
    try {
      const url = 'https://api.the-odds-api.com/v4/sports/' + encodeURIComponent(sport) +
        '/odds/?regions=eu&markets=h2h&oddsFormat=decimal&apiKey=' + encodeURIComponent(config.oddsApiKey);
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const left = Number(res.headers.get('x-requests-remaining'));
      if (Number.isFinite(left)) remaining = left;
      if (!res.ok) { log.warn('Odds API ' + sport + ': HTTP ' + res.status); continue; }
      const rows = await res.json();
      if (Array.isArray(rows)) data.push(...rows.map(r => ({ ...r, sport_key: sport })));
    } catch (error) {
      log.warn('Odds API request failed for ' + sport + ': ' + error.message);
    }
  }
  const next = { at: Date.now(), data: data.length ? data : cached.data, remaining, month: thisMonth() };
  try { fs.mkdirSync(config.dataDir, { recursive: true }); fs.writeFileSync(oddsCacheFile(), JSON.stringify(next)); } catch { /* cache is optional */ }
  log.info('Odds API: ' + data.length + ' events' + (remaining !== null ? ', ' + remaining + ' requests left this month' : ''));
  return next.data;
}

const STOP = new Set(['fc', 'afc', 'cf', 'sc', 'ac', 'ssc', 'the', 'club', 'de', 'cd', 'ud', 'rc', 'sv', 'vfb', 'vfl', 'calcio', 'football']);
const tokens = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ')
  .split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t));
function sameTeam(a, b) {
  const x = tokens(a), y = tokens(b);
  if (x.join('') === y.join('')) return true;
  return x.some(t => t.length >= 4 && y.some(u => u.startsWith(t) || t.startsWith(u)));
}

/**
 * Attach Odds API bookmakers to the matching ESPN fixtures (kickoff within 90
 * minutes, both team names alike). Their outcome names are rewritten to the
 * fixture's names, and the books are tagged `extra` so only the price-comparison
 * AIs use them (the others keep the single-book view they started the test with).
 */
export function mergeQuotes(fixtures, quotes) {
  const out = fixtures.map(f => ({ ...f }));
  for (const q of quotes) {
    const t = Date.parse(q.commence_time);
    const f = out.find(m => Math.abs(Date.parse(m.commence_time) - t) <= 90 * 60000 &&
      sameTeam(m.home_team, q.home_team) && sameTeam(m.away_team, q.away_team));
    if (!f) continue;
    const rename = n => n === q.home_team ? f.home_team : n === q.away_team ? f.away_team : n;
    const books = (q.bookmakers || []).map(b => ({ title: b.title, last_update: b.last_update, extra: true,
      markets: (b.markets || []).map(m => ({ ...m, outcomes: (m.outcomes || []).map(o => ({ ...o, name: rename(o.name) })) })) }));
    f.bookmakers = [...books, ...(f.bookmakers || [])];
  }
  return out;
}

/* ------------------------------------------------------- merged feed --- */

let cache = { at: 0, matches: [], error: null };
let pending = null;

export function getMatches({ force = false, maxAge = 60000 } = {}) {
  if (pending) return pending;
  if (!force && Date.now() - cache.at < maxAge) return Promise.resolve(cache.matches);
  pending = Promise.all([fetchFixtures(), fetchQuotes().catch(() => [])]).then(([fixtures, extra]) => {
    cache = { at: Date.now(), error: null,
      matches: mergeQuotes(fixtures, extra).sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time)) };
    return cache.matches;
  }).catch(error => {
    cache = { ...cache, error: error.message };
    throw error;
  }).finally(() => { pending = null; });
  return pending;
}

/* ------------------------------------- Romanian Liga 1 (TheSportsDB) --- */
// ESPN has no Romanian Liga 1 games, so copied tickets with them use
// TheSportsDB's free public API (fixtures and final scores, no odds, no
// half-time scores). Only fetched when a ticket is copied or has such a game.

const TSDB_DAY = day => 'https://www.thesportsdb.com/api/v1/json/123/eventsday.php?l=4691&d=' + day;
export const isTsdb = id => String(id).startsWith('tsdb-');

function parseTsdb(e) {
  const time = Date.parse(String(e.strTimestamp || '').replace(/(\d)$/, '$1Z'));
  if (!e.idEvent || !e.strHomeTeam || !e.strAwayTeam || !Number.isFinite(time)) return null;
  const finished = /^(FT|AET|PEN|AP)$/i.test(e.strStatus || '');
  const postponed = /yes/i.test(e.strPostponed || '') || /^(PST|CANC|ABD|postponed|cancelled)/i.test(e.strStatus || '');
  return { id: 'tsdb-' + e.idEvent, league: 'rou.1', sport_title: 'Romanian Liga I', commence_time: new Date(time).toISOString(),
    home_team: e.strHomeTeam, away_team: e.strAwayTeam, homeId: 'tsdb-' + e.idHomeTeam, awayId: 'tsdb-' + e.idAwayTeam,
    statusName: postponed ? 'STATUS_POSTPONED' : finished ? 'STATUS_FULL_TIME' : /^(NS|TBD|)$/i.test(e.strStatus || '') ? 'STATUS_SCHEDULED' : 'STATUS_IN_PROGRESS',
    bookmakers: [], tsdb: { finished, postponed, home: Number(e.intHomeScore), away: Number(e.intAwayScore) } };
}

// The free API allows about 30 requests a minute: each day is cached for 10
// minutes, and a stale copy is used when a request is refused.
const tsdbCache = new Map();
async function tsdbDay(day) {
  const hit = tsdbCache.get(day);
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.matches;
  try {
    const data = await getJson(TSDB_DAY(day));
    const matches = (data.events || []).map(parseTsdb).filter(Boolean);
    tsdbCache.set(day, { at: Date.now(), matches });
    if (tsdbCache.size > 60) tsdbCache.delete(tsdbCache.keys().next().value);
    return matches;
  } catch (error) {
    if (hit) return hit.matches;
    throw error;
  }
}

/** Final scores of Liga 1 games on the given YYYYMMDD days, shaped like getResults. */
export async function getTsdbResults(days) {
  const results = {};
  const checked = new Set();
  for (const day of days) {
    try {
      for (const m of await tsdbDay(day.slice(0, 4) + '-' + day.slice(4, 6) + '-' + day.slice(6))) {
        if (m.tsdb.postponed) { results[m.id] = { void: true }; continue; }
        if (!m.tsdb.finished || !Number.isFinite(m.tsdb.home) || !Number.isFinite(m.tsdb.away)) continue;
        const { home, away } = m.tsdb;
        results[m.id] = { homeTeam: m.home_team, awayTeam: m.away_team, homeScore: home, awayScore: away,
          winningSelection: home > away ? m.home_team : home < away ? m.away_team : 'Draw' };
      }
      checked.add(day);
    } catch { /* retried on the next tick */ }
  }
  return { results, checked };
}

/**
 * Half-time score of a finished ESPN game: [home, away], null when ESPN has
 * none for it (the leg is then refunded), or undefined when the download failed.
 */
export async function getHalfTime(id) {
  if (isTsdb(id)) return null;
  try {
    const data = await getJson(ESPN + 'all/summary?event=' + encodeURIComponent(id));
    const teams = data.header?.competitions?.[0]?.competitors || [];
    const half = side => Number(teams.find(c => c.homeAway === side)?.linescores?.[0]?.displayValue);
    const h = half('home'), a = half('away');
    return Number.isFinite(h) && Number.isFinite(a) ? [h, a] : null;
  } catch { return undefined; }
}

/**
 * For copying a betslip: the normal feed plus fixtures up to ten days ahead
 * (tickets often hold later games, e.g. next week's Champions League).
 * Fetched only when someone copies a ticket, and cached for 15 minutes.
 */
let later = { at: 0, matches: [] };
export async function getCopyFixtures() {
  const near = await getMatches({ maxAge: 2 * 60000 });
  if (Date.now() - later.at > 15 * 60000) {
    const offsets = [3, 4, 5, 6, 7, 8, 9, 10];
    let espn = later.matches.filter(m => !isTsdb(m.id));
    try { espn = await fetchFixtures(new Date(), offsets, offsets); }
    catch (error) { log.warn('Later fixtures unavailable: ' + error.message); }
    // Romanian Liga 1, today and the next ten days (one small request per day).
    const romanian = [];
    for (let offset = 0; offset <= 10; offset++) {
      try { romanian.push(...await tsdbDay(fixtureDay(new Date(), offset))); } catch { /* skipped this round */ }
    }
    later = { at: Date.now(), matches: [...espn, ...romanian] };
  }
  const ids = new Set(near.map(m => m.id));
  return [...near, ...later.matches.filter(m => !ids.has(m.id))];
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
