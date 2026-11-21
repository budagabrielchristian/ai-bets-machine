// The 24/7 loop: settle tickets, record closing prices, refit models, run the AIs.
import { AIS, STARTING_BALANCE } from '../src/services/aiCatalog.js';
import { builderPrice, grade } from '../src/services/practice.js';
import { jointMarket } from '../src/services/jointMarket.js';
import { parseSlipText } from '../src/services/copySlip.js';
import { AI, readOptions } from './ai/strategies.js';
import { ELO, buildModels, marketProbability, predict } from './ai/ratings.js';
import { config } from './config.js';
import { feedStatus, findPrice, getCopyFixtures, getHistory, getMatches, getResults } from './feed.js';
import { log } from './log.js';
import { notifyChanges } from './notify.js';
import { testTick } from './testPeriod.js';
import { backup, readJson, writeJson } from './store.js';

const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const SCAN_EVERY = 5 * MINUTE;
const REFIT_EVERY = 6 * HOUR;

export const state = load();
let models = null;
let modelInfo = { status: 'pending' };
let fitting = false;
let busy = false;
let lastFit = 0;

function load() {
  const s = readJson('state.json', null) || { version: 2, tickets: [], settings: {} };
  s.ais ||= {};
  for (const key of [...Object.keys(AIS), 'manual']) {
    s.ais[key] = { season: 1, deposit: STARTING_BALANCE * 100, enabled: true, lastScan: 0, note: '', ...s.ais[key] };
  }
  s.engine ||= {};
  s.settings ||= {};
  return s;
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { writeJson('state.json', state); backup('state.json'); }
    catch (error) { log.error('Saving state failed: ' + error.message); }
  }, 250);
}
export function flush() { clearTimeout(saveTimer); writeJson('state.json', state); }

export const walletTickets = key =>
  state.tickets.filter(t => (key === 'manual' ? t.source === 'manual' : t.source === 'ai' && t.strategy === key) &&
    (t.season || 1) === state.ais[key].season);

/** What the dashboard reads (no internal fields). */
export function publicState() {
  return {
    ais: Object.fromEntries(Object.entries(state.ais).map(([key, v]) =>
      [key, { season: v.season, deposit: v.deposit, enabled: v.enabled, lastScan: v.lastScan, note: v.note }])),
    tickets: state.tickets.map(({ selections, ...t }) => ({ ...t, selections: selections.map(({ jointModel, ...s }) => s) })),
    settings: state.settings,
    engine: engineStatus(),
    feed: feedStatus(),
    oddsApi: Boolean(config.oddsApiKey),
    test: state.test || null,
  };
}

/**
 * Model numbers for the match page: Elo win/draw/loss and ratings, Poisson
 * expected goals, a 6x6 score matrix and derived markets, and recent form.
 */
export function matchInsights(matches) {
  if (!models) return {};
  const out = {};
  const r4 = v => Math.round(v * 10000) / 10000;
  const names = new Map(matches.flatMap(m => [[m.homeId, m.home_team], [m.awayId, m.away_team]]));
  const form = id => (models.form.get(id) || []).map(g => ({ ...g, opp: names.get(g.opp) || null,
    res: g.gf > g.ga ? 'W' : g.gf < g.ga ? 'L' : 'D' }));
  for (const m of matches) {
    if (Date.parse(m.commence_time) < Date.now() - 3 * HOUR || !m.homeId) continue;
    const p = predict(models, m);
    if (!p) continue;
    const ins = { form: { home: form(m.homeId), away: form(m.awayId) } };
    if (p.elo) ins.elo = { home: r4(p.elo.home), draw: r4(p.elo.draw), away: r4(p.elo.away), homeAdvantage: ELO.home,
      homeRating: Math.round(models.elo.ratings.get(m.homeId)), awayRating: Math.round(models.elo.ratings.get(m.awayId)),
      homeGames: models.elo.games.get(m.homeId) || 0, awayGames: models.elo.games.get(m.awayId) || 0 };
    if (p.poisson) {
      const mx = p.poisson.matrix;
      const q = o => r4(marketProbability(mx, o));
      let btts = 0;
      for (let h = 1; h < mx.length; h++) for (let a = 1; a < mx[h].length; a++) btts += mx[h][a];
      ins.poisson = { homeGoals: r4(p.poisson.homeRate), awayGoals: r4(p.poisson.awayRate),
        home: q({ market: 'h2h', side: 'home' }), draw: q({ market: 'h2h', side: 'draw' }), away: q({ market: 'h2h', side: 'away' }),
        over15: q({ market: 'total', side: 'over', line: 1.5 }), over25: q({ market: 'total', side: 'over', line: 2.5 }),
        over35: q({ market: 'total', side: 'over', line: 3.5 }), btts: r4(btts),
        matrix: mx.slice(0, 6).map(row => row.slice(0, 6).map(r4)) };
    }
    out[m.id] = ins;
  }
  return out;
}

export const engineStatus = () => ({ lastTick: state.engine.lastTick || null, error: state.engine.error || null, models: modelInfo });

/* ------------------------------------------------------------ settling --- */

const ymd = ms => new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');

async function settle(now) {
  const open = state.tickets.filter(t => t.status === 'pending');
  const days = new Set();
  for (const ticket of open) for (const leg of ticket.selections) {
    const start = Date.parse(leg.matchDate || ticket.matchDate || ticket.datePlaced);
    if (!Number.isFinite(start) || start > now) continue;
    // The provider groups games by US date; include the neighbouring days.
    for (const delta of [-1, 0, 1]) days.add(ymd(start + delta * DAY));
  }
  if (!days.size) return [];
  const { results, checked } = await getResults([...days]);
  const changed = [];
  for (const ticket of state.tickets) {
    if (ticket.status !== 'pending') continue;
    const known = { ...results };
    // A game still without a result three days after kickoff was postponed, so
    // the leg is refunded. Only when its days were really checked: a failed
    // download (PC offline, feed down) must never refund a bet.
    for (const leg of ticket.selections) {
      const start = Date.parse(leg.matchDate || ticket.matchDate);
      const daysChecked = [-1, 0, 1].every(delta => checked.has(ymd(start + delta * DAY)));
      if (!known[leg.matchId] && now - start > 3 * DAY && daysChecked) known[leg.matchId] = { void: true };
    }
    const status = grade(ticket, known);
    if (status !== 'pending') {
      ticket.status = status;
      ticket.settledAt = new Date(now).toISOString();
      for (const leg of ticket.selections) {
        const r = known[leg.matchId];
        if (r && !r.void) leg.result = r.homeScore + '–' + r.awayScore;
      }
      changed.push(ticket);
    }
  }
  return changed;
}

/** Keep updating the price of each open leg until kickoff; the last one is the closing price. */
function trackClosingPrices(matches, now) {
  const byId = new Map(matches.map(m => [m.id, m]));
  for (const ticket of state.tickets) {
    if (ticket.status !== 'pending') continue;
    for (const leg of ticket.selections) {
      if (Date.parse(leg.matchDate) <= now) continue;
      const match = byId.get(leg.matchId);
      if (!match || (match.statusName && match.statusName !== 'STATUS_SCHEDULED')) continue;
      const price = findPrice(match, leg);
      if (price) { leg.closingPrice = price; leg.closingAt = new Date(now).toISOString(); }
    }
  }
}

/* -------------------------------------------------------------- models --- */

export async function refit() {
  if (fitting) return;
  fitting = true;
  try {
    modelInfo = { ...modelInfo, status: models ? 'refreshing' : 'learning' };
    const { results, fetched } = await getHistory();
    const started = Date.now();
    models = buildModels(results);
    lastFit = Date.now();
    modelInfo = { status: 'ready', fittedAt: lastFit, results: results.length, downloadedDays: fetched,
      teams: models.elo.ratings.size, leagues: models.leagues.size, curve: models.elo.curve,
      seconds: Math.round((Date.now() - started) / 100) / 10 };
    log.info('Models fitted: ' + results.length + ' results, ' + models.leagues.size + ' leagues, ' + models.elo.ratings.size + ' teams');
  } catch (error) {
    modelInfo = { ...modelInfo, status: models ? 'ready' : 'failed', error: error.message };
    log.error('Model fit failed: ' + error.message);
  } finally { fitting = false; }
}

/* --------------------------------------------------------------- tick --- */

export async function tick({ force = false } = {}) {
  if (busy) return;
  busy = true;
  const now = Date.now();
  const settled = [], placed = [];
  try {
    if (!fitting && now - lastFit > REFIT_EVERY) refit();
    settled.push(...await settle(now));
    if (settled.length) log.info('Settled ' + settled.length + ' tickets');
    let matches;
    try {
      matches = await getMatches({ force: true });
      state.engine.error = null;
    } catch (error) {
      state.engine.error = 'Fixture feed unavailable · retrying every minute';
      log.warn('Feed error: ' + error.message);
      return;
    }
    trackClosingPrices(matches, Date.now());
    const betting = await testTick({ state, now: Date.now(), newSeason, walletTickets });
    for (const [key, ai] of Object.entries(AI)) {
      const wallet = state.ais[key];
      if (!betting) { wallet.note = 'Test period finished · no new bets. Final results are on the leaderboard.'; continue; }
      if (!wallet.enabled || (!force && Date.now() - wallet.lastScan < SCAN_EVERY)) continue;
      if ((key === 'elo' || key === 'poisson') && !models) { wallet.note = 'Learning team ratings from past results…'; continue; }
      try {
        const tickets = ai.run({ deposit: wallet.deposit, tickets: walletTickets(key) }, matches, { now: Date.now(), models })
          .map(t => ({ ...t, season: wallet.season }));
        wallet.lastScan = Date.now();
        state.tickets.unshift(...tickets);
        placed.push(...tickets);
        wallet.note = tickets.length
          ? 'Placed ' + tickets.length + ' ticket' + (tickets.length > 1 ? 's' : '') + ' at ' + new Date().toISOString().slice(11, 16) + ' UTC'
          : noBetNote(key, matches);
        if (tickets.length) log.info(AIS[key].name + ' placed ' + tickets.length + ' tickets');
      } catch (error) {
        wallet.note = 'Scan failed: ' + error.message;
        log.error(key + ' scan failed: ' + error.stack);
      }
    }
  } finally {
    await notifyChanges({ placed, settled, state, now: Date.now() });
    state.engine.lastTick = Date.now();
    busy = false;
    save();
  }
}

function noBetNote(key, matches) {
  const now = Date.now();
  const soon = matches.filter(m => Date.parse(m.commence_time) > now && Date.parse(m.commence_time) <= now + 3 * DAY);
  const priced = soon.filter(m => m.bookmakers?.length);
  if (!priced.length) return 'No priced fixtures in the next 72 hours.';
  if (key === 'price' && !priced.some(m => m.bookmakers.length > 1)) return 'Waiting for a second bookmaker. Add an Odds API key to switch it on.';
  return 'Checked ' + priced.length + ' priced matches. None met the rules this round.';
}

export function start() {
  if (!config.engineEnabled) { log.info('Engine disabled (ENGINE_ENABLED=false)'); return; }
  tick();
  setInterval(() => tick(), MINUTE).unref();
  log.info('Engine running: settle + closing prices every minute, AI scans every 5 minutes, model refit every 6 hours');
}

/* ------------------------------------------------------ user actions --- */

export function setEnabled(key, enabled) {
  state.ais[key].enabled = enabled;
  state.ais[key].lastScan = 0;
  save();
}

export function newSeason(key) {
  const ai = state.ais[key];
  ai.season += 1;
  ai.deposit = STARTING_BALANCE * 100;
  ai.lastScan = 0;
  ai.note = 'New season started';
  save();
}

/** Price a manual slip from the server's own feed; client prices are never trusted. */
export async function placeManual({ stake, selections }) {
  const amount = Math.round(Number(stake) * 100) / 100;
  if (!(amount >= 0.01 && amount <= 100000)) throw new UserError('Enter a stake between 0.01 and 100,000.');
  if (!Array.isArray(selections) || !selections.length || selections.length > 12) throw new UserError('Add between 1 and 12 selections.');
  const matches = await getMatches({ maxAge: 2 * MINUTE });
  const byId = new Map(matches.map(m => [String(m.id), m]));
  const legs = selections.map(s => {
    const match = byId.get(String(s?.matchId));
    if (!match) throw new UserError('A selected fixture is no longer listed.');
    if (!(Date.parse(match.commence_time) > Date.now()) || (match.statusName && match.statusName !== 'STATUS_SCHEDULED')) {
      throw new UserError(match.home_team + ' vs ' + match.away_team + ' has already started.');
    }
    const market = ['h2h', 'total', 'handicap'].includes(s.market) ? s.market : 'h2h';
    const wanted = { market, selection: String(s.selection || '').slice(0, 200), side: s.side, line: Number(s.line) };
    const offers = (match.bookmakers || []).map(b => ({ bookmaker: b.title, price: findPrice(match, { ...wanted, bookmaker: b.title }) }))
      .filter(o => o.price);
    if (!offers.length) throw new UserError('That price is no longer available.');
    const offer = offers.find(o => Math.abs(o.price - Number(s.price)) < 0.005);
    if (!offer) throw new UserError('The price for ' + wanted.selection + ' changed. Refresh and try again.');
    const legBase = { matchId: match.id, matchDate: match.commence_time, matchTitle: match.home_team + ' vs ' + match.away_team,
      teams: [match.home_team, match.away_team], competition: match.sport_title, bookmaker: offer.bookmaker, market, selection: wanted.selection,
      side: market === 'h2h' ? undefined : wanted.side, line: market === 'h2h' ? undefined : wanted.line };
    return { ...legBase, ...legNumbers(match, legBase), price: offer.price, openingPrice: offer.price,
      jointModel: market === 'total' ? jointMarket(match) || undefined : undefined };
  });
  const odds = builderPrice(legs);
  if (!Number.isFinite(odds) || odds <= 1) throw new UserError('These selections cannot be combined.');
  const ticket = { id: crypto.randomUUID(), source: 'manual', status: 'pending', season: state.ais.manual.season,
    datePlaced: new Date().toISOString(), stake: amount, totalOdds: odds, currency: 'RON',
    potentialReturn: Number((amount * odds).toFixed(2)), selections: legs };
  state.tickets.unshift(ticket);
  save();
  return ticket;
}

export class UserError extends Error {}

/* ----------------------------------- copy a Betano / Superbet ticket --- */

const COPY_BOOKS = ['Betano', 'Superbet'];

/** The feed's own price for the same pick (for comparison only). */
function feedOffer(match, leg) {
  for (const b of [...(match.bookmakers || [])].sort((x, y) => Number(Boolean(x.extra)) - Number(Boolean(y.extra)))) {
    const price = findPrice(match, { ...leg, bookmaker: b.title });
    if (price) return { bookmaker: b.title, price };
  }
  return null;
}

/** Read pasted ticket text. Nothing is saved. */
export async function previewCopy({ text }) {
  if (typeof text !== 'string' || !text.trim()) throw new UserError('Paste the ticket text first.');
  const matches = await getCopyFixtures();
  const parsed = parseSlipText(text, matches);
  const byId = new Map(matches.map(m => [m.id, m]));
  for (const leg of parsed.legs) {
    const offer = !leg.problem && feedOffer(byId.get(leg.matchId), leg);
    if (offer) { leg.feedPrice = offer.price; leg.feedBookmaker = offer.bookmaker; }
  }
  return parsed;
}

/**
 * Save a copied ticket as a manual practice bet. The server reads the text
 * again with its own fixtures; the odds are the ones written on the ticket.
 */
export async function placeCopy({ text, stake, bookmaker, skipProblems = false }) {
  const parsed = await previewCopy({ text });
  const book = COPY_BOOKS.includes(bookmaker) ? bookmaker : parsed.bookmaker;
  if (!book) throw new UserError('Choose whether the ticket is from Betano or Superbet.');
  const bad = parsed.legs.find(l => l.problem);
  // Leaving matches out is only done when asked for, and recorded on the ticket.
  if (!skipProblems && parsed.warnings.length) throw new UserError(parsed.warnings[0]);
  if (!skipProblems && bad) throw new UserError(bad.matchTitle + ': ' + bad.problem + '.');
  const kept = parsed.legs.filter(l => !l.problem);
  if (!kept.length) throw new UserError('None of the matches on this ticket can be copied.');
  const leftOut = new Set(parsed.legs.filter(l => l.problem).map(l => l.matchId)).size + parsed.warnings.filter(w => /^Not found/.test(w)).length;
  if (new Set(kept.map(l => l.matchId)).size > 20) throw new UserError('A copied ticket can have at most 20 matches.');
  const amount = Math.round(Number(stake ?? parsed.stake) * 100) / 100;
  if (!(amount >= 0.01 && amount <= 100000)) throw new UserError('Enter a stake between 0.01 and 100,000.');
  const matches = await getCopyFixtures();
  const byId = new Map(matches.map(m => [m.id, m]));
  const legs = kept.map(l => {
    const match = byId.get(l.matchId);
    const base = { matchId: l.matchId, matchDate: l.matchDate, matchTitle: l.matchTitle, teams: l.teams, competition: l.competition,
      bookmaker: book, market: l.market, selection: l.selection, side: l.market === 'h2h' ? undefined : l.side,
      line: l.market === 'h2h' ? undefined : l.line, price: l.price, openingPrice: l.price, feedPrice: l.feedPrice,
      builderId: l.builderId, builderPrice: l.builderPrice };
    const numbers = l.feedBookmaker ? legNumbers(match, { ...base, bookmaker: l.feedBookmaker }) : {};
    return { ...base, ...numbers };
  });
  const odds = parsed.totalOdds;
  const ticket = { id: crypto.randomUUID(), source: 'manual', copiedFrom: book, leftOut: leftOut || undefined, status: 'pending', season: state.ais.manual.season,
    datePlaced: new Date().toISOString(), stake: amount, totalOdds: odds, currency: 'RON',
    potentialReturn: Number((amount * odds).toFixed(2)), selections: legs };
  state.tickets.unshift(ticket);
  save();
  return ticket;
}

/**
 * For the bet analysis: the market's fair chance (margin removed) and the
 * model's chance for a manual leg, captured when the bet is placed.
 */
function legNumbers(match, leg) {
  const option = readOptions(match, Date.now()).find(o => o.bookmaker === leg.bookmaker && o.market === leg.market &&
    (o.market === 'h2h' ? o.selection === leg.selection : o.side === leg.side && o.line === leg.line));
  if (!option) return {};
  const out = { marketProbability: option.fair, pickSide: option.side };
  const p = models && predict(models, match);
  if (p?.poisson) out.modelProbability = marketProbability(p.poisson.matrix, option);
  else if (p?.elo && option.market === 'h2h') out.modelProbability = p.elo[option.side];
  return out;
}

/* ------------------------------------------------- import old browser data --- */

const text = (v, max = 200) => typeof v === 'string' ? v.slice(0, max) : undefined;
const num = v => Number.isFinite(Number(v)) ? Number(v) : undefined;
const legacyStrategy = { favorites: 'favorites', price: 'price', slips: 'slips' };

export function importLegacy(account) {
  if (!account || !Array.isArray(account.tickets)) throw new UserError('No tickets found to import.');
  const known = new Set(state.tickets.map(t => t.id));
  let added = 0, skipped = 0;
  for (const raw of account.tickets.slice(0, 5000)) {
    const id = text(raw?.id, 64);
    if (!id || known.has(id) || !['pending', 'won', 'lost', 'void'].includes(raw.status) || !Array.isArray(raw.selections)) { skipped++; continue; }
    let source, strategy;
    if (raw.source === 'manual' && !raw.autoRun) source = 'manual';
    else if (raw.autoRun && raw.trialId && legacyStrategy[raw.strategy]) { source = 'ai'; strategy = legacyStrategy[raw.strategy]; }
    else { skipped++; continue; } // The old single-bankroll Auto-Pilot has no matching AI wallet.
    const ticket = { id, source, strategy, autoRun: source === 'ai' || undefined, imported: true, status: raw.status,
      season: state.ais[strategy || 'manual'].season, tier: text(raw.tier, 20), currency: 'RON',
      datePlaced: Number.isFinite(Date.parse(raw.datePlaced)) ? new Date(raw.datePlaced).toISOString() : new Date().toISOString(),
      matchDate: text(raw.matchDate, 40), stake: num(raw.stake) ?? 0, totalOdds: num(raw.totalOdds) ?? 1,
      potentialReturn: num(raw.potentialReturn) ?? 0,
      selections: raw.selections.slice(0, 12).map(s => ({ matchId: text(String(s?.matchId ?? ''), 40), matchDate: text(s?.matchDate, 40),
        matchTitle: text(s?.matchTitle), competition: text(s?.competition), bookmaker: text(s?.bookmaker, 80),
        market: ['h2h', 'total', 'handicap'].includes(s?.market) ? s.market : undefined, selection: text(s?.selection),
        side: text(s?.side, 10), line: num(s?.line), price: num(s?.price), teams: Array.isArray(s?.teams) ? s.teams.slice(0, 2).map(x => text(x)) : undefined })) };
    if (!(ticket.stake > 0 && ticket.stake <= 100000)) { skipped++; continue; }
    state.tickets.push(ticket);
    known.add(id);
    added++;
  }
  state.tickets.sort((a, b) => Date.parse(b.datePlaced) - Date.parse(a.datePlaced));
  save();
  return { added, skipped };
}
