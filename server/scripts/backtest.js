// Walk-forward backtest of the live AI code on historical results and odds.
//   npm run backtest
// Data: football-data.co.uk season files (top five leagues), cached in data/backtest/.
// Each simulated day the AIs see only matches kicking off in the next 72 hours
// and models trained only on results before that day — no peeking at the future.
// Bet365 prices stand in for DraftKings; Pinnacle is the reference book for the
// Value hunter and the closing line for CLV.
import fs from 'node:fs';
import path from 'node:path';
import { AIS, STARTING_BALANCE } from '../../src/services/aiCatalog.js';
import { aiStats } from '../../src/services/aiStats.js';
import { grade } from '../../src/services/practice.js';
import { AI } from '../ai/strategies.js';
import { buildModels } from '../ai/ratings.js';
import { powerDevig } from '../ai/math.js';
import { config } from '../config.js';

const DAY = 86400000;
// Variant to test, e.g. BACKTEST_TUNE='{"legs":{"minLegs":1,"maxLegs":1},"minEdge":0.05}'
const TUNE = JSON.parse(process.env.BACKTEST_TUNE || '{}');
const LEAGUES = {
  E0: { id: 'eng.1', title: 'English Premier League' }, SP1: { id: 'esp.1', title: 'LALIGA' },
  D1: { id: 'ger.1', title: 'Bundesliga' }, I1: { id: 'ita.1', title: 'Serie A' }, F1: { id: 'fra.1', title: 'Ligue 1' },
};
const SEASONS = ['2223', '2324', '2425', '2526'];
const WARMUP = '2223';                      // only trains the models
const TEAM_NAMES = { Inter: 'Internazionale' }; // ESPN naming, so the 60/10 Inter rule matches

const dir = path.join(config.dataDir, 'backtest');
fs.mkdirSync(dir, { recursive: true });

/* --------------------------------------------------------------- data --- */

async function load(league, season) {
  const file = path.join(dir, league + '-' + season + '.csv');
  if (!fs.existsSync(file)) {
    const res = await fetch('https://www.football-data.co.uk/mmz4281/' + season + '/' + league + '.csv');
    if (!res.ok) throw new Error('Download failed: ' + league + ' ' + season);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const [header, ...lines] = fs.readFileSync(file, 'latin1').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const cols = header.split(',');
  return lines.map(line => Object.fromEntries(line.split(',').map((v, i) => [cols[i], v])));
}

const num = v => { const n = Number(v); return Number.isFinite(n) && n > 1 ? n : undefined; };

function toMatch(row, league, season) {
  const [d, m, y] = (row.Date || '').split('/');
  const year = y?.length === 2 ? '20' + y : y;
  const kickoff = Date.parse(`${year}-${m}-${d}T${row.Time || '15:00'}:00Z`);
  const home = TEAM_NAMES[row.HomeTeam] || row.HomeTeam, away = TEAM_NAMES[row.AwayTeam] || row.AwayTeam;
  if (!Number.isFinite(kickoff) || !home || !away || row.FTHG === '' || row.FTHG === undefined) return null;
  const book = (title, h, dr, a, over, under, ahH, ahA) => {
    const markets = [];
    if (num(h) && num(dr) && num(a)) markets.push({ key: 'h2h', outcomes: [{ name: home, price: num(h) }, { name: 'Draw', price: num(dr) }, { name: away, price: num(a) }] });
    if (num(over) && num(under)) markets.push({ key: 'total', title: 'Total goals', outcomes: [
      { name: 'over 2.5', side: 'over', line: 2.5, price: num(over) }, { name: 'under 2.5', side: 'under', line: 2.5, price: num(under) }] });
    const line = Number(row.AHh);
    if (Number.isFinite(line) && Math.abs(line % 1) === 0.5 && num(ahH) && num(ahA)) markets.push({ key: 'handicap', title: 'Goal handicap', outcomes: [
      { name: home + ' ' + (line > 0 ? '+' : '') + line, side: 'home', line, price: num(ahH) },
      { name: away + ' ' + (-line > 0 ? '+' : '') + -line, side: 'away', line: -line, price: num(ahA) }] });
    return markets.length ? { title, markets } : null;
  };
  const homeScore = Number(row.FTHG), awayScore = Number(row.FTAG);
  return {
    id: league + '|' + row.Date + '|' + home, league, leagueId: LEAGUES[league].id, sport_title: LEAGUES[league].title, season,
    commence_time: new Date(kickoff).toISOString(), kickoff, home_team: home, away_team: away, homeId: home, awayId: away,
    statusName: 'STATUS_SCHEDULED',
    soft: book('Bet365', row.B365H, row.B365D, row.B365A, row['B365>2.5'], row['B365<2.5'], row.B365AHH, row.B365AHA),
    sharp: book('Pinnacle', row.PSH, row.PSD, row.PSA, row['P>2.5'], row['P<2.5'], row.PAHH, row.PAHA),
    // Pinnacle closing prices, for closing line value.
    close: { h2h: [num(row.PSCH), num(row.PSCD), num(row.PSCA)], total: [num(row['PC>2.5']), num(row['PC<2.5'])],
      handicap: Number(row.AHCh) === Number(row.AHh) ? [num(row.PCAHH), num(row.PCAHA)] : [] },
    result: { homeTeam: home, awayTeam: away, homeScore, awayScore,
      winningSelection: homeScore > awayScore ? home : homeScore < awayScore ? away : 'Draw' },
  };
}

/** Expected value of a bet at the fair Pinnacle closing price (positive = beat the close). */
function closingValue(match, leg) {
  const prices = match.close[leg.market || 'h2h'];
  if (!prices?.length || prices.some(p => !p)) return null;
  const fair = powerDevig(prices)?.probabilities;
  if (!fair) return null;
  const i = leg.market === 'total' ? (leg.side === 'over' ? 0 : 1)
    : leg.market === 'handicap' ? (leg.side === 'home' ? 0 : 1)
    : [match.home_team, 'Draw', match.away_team].indexOf(leg.selection);
  return i < 0 ? null : fair[i] * leg.price - 1;
}

/* ---------------------------------------------------------- simulation --- */

const all = [];
for (const season of SEASONS) for (const league of Object.keys(LEAGUES)) {
  for (const row of await load(league, season)) { const m = toMatch(row, league, season); if (m) all.push(m); }
}
all.sort((a, b) => a.kickoff - b.kickoff);
const byId = new Map(all.map(m => [m.id, m]));
const evalMatches = all.filter(m => m.season !== WARMUP);
const first = evalMatches[0].kickoff, last = evalMatches.at(-1).kickoff;
console.log('Matches: ' + all.length + ' (' + evalMatches.length + ' in the test seasons, ' + SEASONS.slice(1).join(', ') + ')');

const wallets = Object.fromEntries(Object.keys(AIS).map(k => [k, { deposit: STARTING_BALANCE * 100, tickets: [], brokeOn: null }]));
const view = (m, withSharp) => ({ ...m, bookmakers: [m.soft, withSharp ? m.sharp : null].filter(Boolean) });
let models = null, lastFit = 0;
const started = Date.now();

for (let day = Math.floor(first / DAY) * DAY; day <= last + 4 * DAY; day += DAY) {
  const now = day + 9 * 3600000; // one engine pass per day at 09:00 UTC
  // Settle tickets whose matches have finished.
  for (const w of Object.values(wallets)) for (const t of w.tickets) {
    if (t.status !== 'pending' || t.selections.some(s => byId.get(s.matchId).kickoff + 3 * 3600000 > now)) continue;
    t.status = grade(t, Object.fromEntries(t.selections.map(s => [s.matchId, byId.get(s.matchId).result])));
    t.settledAt = new Date(now).toISOString();
  }
  // Refit the models weekly on results known so far.
  if (now - lastFit >= 7 * DAY) {
    const known = all.filter(m => m.kickoff + 3 * 3600000 < now).map(m => ({ date: m.kickoff, league: m.league,
      homeId: m.homeId, awayId: m.awayId, homeScore: m.result.homeScore, awayScore: m.result.awayScore }));
    models = buildModels(known, now);
    lastFit = now;
  }
  const upcoming = all.filter(m => m.kickoff > now && m.kickoff <= now + 72 * 3600000 && m.season !== WARMUP);
  if (!upcoming.length) continue;
  for (const [key, ai] of Object.entries(AI)) {
    const w = wallets[key];
    // Single-book view (like DraftKings in production); the Value hunter also sees Pinnacle.
    const tickets = ai.run(w, upcoming.map(m => view(m, key === 'price' || key === 'sharpSingles')), { now, models, tune: TUNE });
    w.tickets.unshift(...tickets);
  }
  for (const w of Object.values(wallets)) {
    const s = aiStats(w.tickets, STARTING_BALANCE, now);
    if (!w.brokeOn && s.available < 1) w.brokeOn = new Date(now).toISOString().slice(0, 10);
  }
}

/* -------------------------------------------------------------- report --- */

const pct = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
const report = [];
for (const [key, w] of Object.entries(wallets)) {
  const s = aiStats(w.tickets, STARTING_BALANCE, last + 5 * DAY);
  const clv = w.tickets.map(t => {
    const v = t.selections.map(l => closingValue(byId.get(l.matchId), l));
    return v.every(x => x !== null) ? v.reduce((p, x) => p * (1 + x), 1) - 1 : null;
  }).filter(v => v !== null);
  const seasons = Object.fromEntries(SEASONS.slice(1).map(se => {
    const ts = w.tickets.filter(t => byId.get(t.selections[0].matchId).season === se);
    const st = aiStats(ts, 0);
    return [se, { tickets: ts.length, profit: st.profit, roi: st.roi }];
  }));
  report.push({ key, name: AIS[key].name, tickets: w.tickets.length, legs: w.tickets.reduce((n, t) => n + t.selections.length, 0),
    settled: s.settled, won: s.won, lost: s.lost, staked: s.staked, profit: s.profit, roi: s.roi, winRate: s.winRate,
    drawdown: s.drawdown, finalBalance: s.balance, brokeOn: w.brokeOn, clv: clv.length ? clv.reduce((a, b) => a + b, 0) / clv.length : null,
    clvPositive: clv.length ? clv.filter(v => v > 0).length / clv.length : null, seasons });
}
report.sort((a, b) => b.roi - a.roi);

console.log('\nSimulated in ' + ((Date.now() - started) / 1000).toFixed(0) + 's. Each AI started with ' + STARTING_BALANCE + ' RON.\n');
console.log('AI'.padEnd(16) + 'Tickets  Staked     Profit      ROI     Won   Max drop  CLV (vs close)  Final RON');
for (const r of report) {
  console.log(r.name.padEnd(16) + String(r.tickets).padStart(7) + String(r.staked.toFixed(0)).padStart(8) +
    String((r.profit >= 0 ? '+' : '') + r.profit.toFixed(2)).padStart(11) + pct(r.roi).padStart(9) +
    (r.settled ? (r.winRate * 100).toFixed(0) + '%' : '—').padStart(7) + (r.drawdown !== null ? pct(-r.drawdown) : '—').padStart(10) +
    (r.clv !== null ? pct(r.clv) + ' (' + (r.clvPositive * 100).toFixed(0) + '% beat)' : '—').padStart(17) +
    r.finalBalance.toFixed(2).padStart(11) + (r.brokeOn ? '  BROKE ' + r.brokeOn : ''));
}
console.log('\nPer season (ROI):');
for (const r of report) console.log('  ' + r.name.padEnd(16) + Object.entries(r.seasons).map(([se, v]) =>
  '20' + se.slice(0, 2) + '/' + se.slice(2) + ': ' + (v.tickets ? pct(v.roi) + ' (' + v.tickets + ')' : '—')).join('   '));
fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), seasons: SEASONS.slice(1), report }, null, 1));
console.log('\nSaved: data/backtest/report.json');
