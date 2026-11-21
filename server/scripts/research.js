// Research backtest for the post-test strategy review (ChatGPT + Gemini reports).
//   node server/scripts/research.js            (uses the CSVs cached in data/backtest/)
//
// Uses football-data.co.uk season files: opening ("Fri") and closing prices.
// Execution book: Bet365 (stand-in for Betano). Fair-price reference:
//   - Pinnacle (PS*/P*/PAH*) up to 2024/25,
//   - Betfair Exchange (BFE*) in 2025/26, because football-data's Pinnacle feed
//     is stale from July 2025 (checked: Pinnacle drifts from the market 1.8x
//     more than before and often never moves from open to close).
// CLV is always measured against the fair (no-margin) closing reference price.
// Every strategy decides only with information available at its bet time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/backtest');
const SEASONS = ['2223', '2324', '2425', '2526'];
const num = v => { const n = Number(v); return Number.isFinite(n) && n > 1 ? n : NaN; };

/* ---------------------------------------------------------------- data --- */

function load() {
  const games = [];
  for (const f of fs.readdirSync(dir).filter(f => /\.csv$/.test(f))) {
    const season = f.slice(-8, -4);
    if (!SEASONS.includes(season)) continue;
    const [head, ...lines] = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
    const cols = head.split(',');
    for (const line of lines) {
      const v = line.split(',');
      const r = Object.fromEntries(cols.map((c, i) => [c, v[i]]));
      const [d, m, y] = (r.Date || '').split('/');
      const when = Date.parse((y?.length === 2 ? '20' + y : y) + '-' + m + '-' + d + 'T12:00:00Z');
      if (!Number.isFinite(when) || r.FTHG === '' || r.FTHG === undefined) continue;
      games.push({ ...r, season, league: f.slice(0, -9), when, hg: Number(r.FTHG), ag: Number(r.FTAG) });
    }
  }
  return games.sort((a, b) => a.when - b.when);
}

/* --------------------------------------------------------------- maths --- */

/** Power-method de-vig: find k with sum (1/o)^k = 1. */
function devig(prices) {
  if (prices.some(p => !(p > 1))) return null;
  const inv = prices.map(p => 1 / p);
  const over = inv.reduce((a, b) => a + b, 0);
  if (!(over > 0.95 && over < 1.3)) return null;
  let lo = 0.5, hi = 2;
  for (let i = 0; i < 60; i++) { const k = (lo + hi) / 2; inv.reduce((a, b) => a + b ** k, 0) > 1 ? (lo = k) : (hi = k); }
  const k = (lo + hi) / 2;
  return { p: inv.map(x => x ** k), margin: over - 1 };
}

/** Asian handicap result for the side given its handicap: 1 win, 0.5 half win, 0 push, -0.5 half loss, -1 loss. */
function ahResult(diff, line) {
  const parts = Math.abs((line * 4) % 2) === 1 ? [line - 0.25, line + 0.25] : [line];
  return parts.reduce((s, l) => s + Math.sign(diff + l), 0) / parts.length;
}
/** Profit per 1 unit at decimal price for an AH result. */
function ahProfit(res, price) {
  if (res === 1) return price - 1;
  if (res === 0.5) return (price - 1) / 2;
  if (res === 0) return 0;
  if (res === -0.5) return -0.5;
  return -1;
}

/* ---------------------------------------------------------- the markets --- */
// For one game and one snapshot ('open' | 'close') return every outcome with:
// soft price (Bet365), best price (market max), fair reference probability, and settlement.

const REF = {
  open: { h: s => s === '2526' ? 'BFEH' : 'PSH', d: s => s === '2526' ? 'BFED' : 'PSD', a: s => s === '2526' ? 'BFEA' : 'PSA',
    o: s => s === '2526' ? 'BFE>2.5' : 'P>2.5', u: s => s === '2526' ? 'BFE<2.5' : 'P<2.5',
    ahh: s => s === '2526' ? 'BFEAHH' : 'PAHH', aha: s => s === '2526' ? 'BFEAHA' : 'PAHA' },
  close: { h: s => s === '2526' ? 'BFECH' : 'PSCH', d: s => s === '2526' ? 'BFECD' : 'PSCD', a: s => s === '2526' ? 'BFECA' : 'PSCA',
    o: s => s === '2526' ? 'BFEC>2.5' : 'PC>2.5', u: s => s === '2526' ? 'BFEC<2.5' : 'PC<2.5',
    ahh: s => s === '2526' ? 'BFECAHH' : 'PCAHH', aha: s => s === '2526' ? 'BFECAHA' : 'PCAHA' },
};
const SOFT = {
  open: { h: 'B365H', d: 'B365D', a: 'B365A', o: 'B365>2.5', u: 'B365<2.5', ahh: 'B365AHH', aha: 'B365AHA', line: 'AHh',
    maxh: 'MaxH', maxd: 'MaxD', maxa: 'MaxA', maxo: 'Max>2.5', maxu: 'Max<2.5' },
  close: { h: 'B365CH', d: 'B365CD', a: 'B365CA', o: 'B365C>2.5', u: 'B365C<2.5', ahh: 'B365CAHH', aha: 'B365CAHA', line: 'AHCh',
    maxh: 'MaxCH', maxd: 'MaxCD', maxa: 'MaxCA', maxo: 'MaxC>2.5', maxu: 'MaxC<2.5' },
};

function outcomes(g, snap) {
  const r = REF[snap], s = SOFT[snap], out = [];
  const ref1 = devig([num(g[r.h(g.season)]), num(g[r.d(g.season)]), num(g[r.a(g.season)])]);
  const soft1 = devig([num(g[s.h]), num(g[s.d]), num(g[s.a])]);
  const res = g.hg > g.ag ? 'h' : g.hg < g.ag ? 'a' : 'd';
  if (ref1) ['h', 'd', 'a'].forEach((k, i) => out.push({ market: '1X2', key: k, p: ref1.p[i], price: num(g[s[k]]), max: num(g[s['max' + k]]),
    softMargin: soft1?.margin, refMargin: ref1.margin, profit: price => res === k ? price - 1 : -1 }));
  const ref2 = devig([num(g[r.o(g.season)]), num(g[r.u(g.season)])]);
  const goals = g.hg + g.ag;
  if (ref2) ['o', 'u'].forEach((k, i) => out.push({ market: 'OU2.5', key: k, p: ref2.p[i], price: num(g[s[k]]), max: num(g[s['max' + k]]),
    refMargin: ref2.margin, profit: price => ((k === 'o') === (goals > 2.5)) ? price - 1 : -1 }));
  const line = Number(g[s.line]);
  const ref3 = devig([num(g[r.ahh(g.season)]), num(g[r.aha(g.season)])]);
  if (ref3 && Number.isFinite(line)) {
    out.push({ market: 'AH', key: 'ahh', p: ref3.p[0], price: num(g[s.ahh]), refMargin: ref3.margin, line,
      profit: price => ahProfit(ahResult(g.hg - g.ag, line), price) });
    out.push({ market: 'AH', key: 'aha', p: ref3.p[1], price: num(g[s.aha]), refMargin: ref3.margin, line,
      profit: price => ahProfit(ahResult(g.ag - g.hg, -line), price) });
  }
  return out;
}

/** Fair closing probability for the same outcome (for CLV). AH only when the closing line is the same. */
function closingFair(g, o) {
  const c = outcomes(g, 'close').find(x => x.market === o.market && x.key === o.key && (o.market !== 'AH' || x.line === o.line));
  return c?.p;
}

/* ------------------------------------------------------------- records --- */

function record(name) { return { name, bets: [] }; }
function addBet(rec, g, o, price, extra = {}) {
  const pc = closingFair(g, o);
  rec.bets.push({ season: g.season, when: g.when, price, profit: o.profit(price), clv: pc ? price * pc - 1 : NaN, ev: price * o.p - 1,
    market: o.market, ...extra });
}

function summary(rec) {
  const b = rec.bets;
  const n = b.length;
  if (!n) return { name: rec.name, n: 0 };
  const profit = b.reduce((s, x) => s + x.profit, 0);
  const clvs = b.map(x => x.clv).filter(Number.isFinite);
  const mean = clvs.reduce((s, x) => s + x, 0) / clvs.length;
  const sd = Math.sqrt(clvs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, clvs.length - 1));
  const bySeason = {};
  for (const s of SEASONS) {
    const sb = b.filter(x => x.season === s);
    const sc = sb.map(x => x.clv).filter(Number.isFinite);
    bySeason[s] = { n: sb.length, roi: sb.length ? sb.reduce((t, x) => t + x.profit, 0) / sb.length : NaN, clv: sc.length ? sc.reduce((t, x) => t + x, 0) / sc.length : NaN };
  }
  // Drawdown on a 100-unit bankroll with 1-unit flat stakes.
  let bank = 100, peak = 100, dd = 0;
  for (const x of b) { bank += x.profit; peak = Math.max(peak, bank); dd = Math.max(dd, (peak - bank) / peak); }
  return { name: rec.name, n, roi: profit / n, hit: b.filter(x => x.profit > 0).length / n, clv: mean,
    clvT: mean / (sd / Math.sqrt(clvs.length)), clvPos: clvs.filter(x => x > 0).length / clvs.length, avgPrice: b.reduce((s, x) => s + x.price, 0) / n,
    dd, bySeason };
}

/* ---------------------------------------------------------- strategies --- */

const games = load();

/** Value singles: bet the soft (or best) price when it beats the fair reference by minEdge. One bet per match. */
function valueSingles({ snap, minEdge, markets = ['1X2', 'OU2.5', 'AH'], exec = 'price', lo = 1.4, hi = 4.5, name }) {
  const rec = record(name);
  for (const g of games) {
    let best = null;
    for (const o of outcomes(g, snap)) {
      const price = o[exec];
      if (!markets.includes(o.market) || !(price >= lo && price <= hi)) continue;
      if (o.market === '1X2' && o.refMargin > 0.045) continue;
      if (o.market !== '1X2' && o.refMargin > 0.035) continue;
      const edge = price * o.p - 1;
      if (edge >= minEdge && (!best || edge > best.edge)) best = { o, edge, price };
    }
    if (best) addBet(rec, g, best.o, best.price);
  }
  return rec;
}

/** ChatGPT favourite singles: fair p >= 60%, Bet365 1.20-1.80, Bet365 1X2 margin <= 10%. */
function favouriteSingles({ snap = 'open', name, band }) {
  const rec = record(name);
  for (const g of games) {
    const fav = outcomes(g, snap).filter(o => o.market === '1X2' && o.key !== 'd').sort((a, b) => b.p - a.p)[0];
    if (!fav || fav.p < 0.6 || !(fav.price >= 1.2 && fav.price <= 1.8) || !(fav.softMargin <= 0.1)) continue;
    if (band && !(fav.price >= band[0] && fav.price < band[1])) continue;
    addBet(rec, g, fav, fav.price);
  }
  return rec;
}

/** Gemini sharp-filtered favourites: fair p 62-80%, Bet365 margin <= 6%, Bet365 >= 1.005 / p. */
function sharpFavourites({ snap = 'open', name }) {
  const rec = record(name);
  for (const g of games) {
    const fav = outcomes(g, snap).filter(o => o.market === '1X2' && o.key !== 'd').sort((a, b) => b.p - a.p)[0];
    if (!fav || fav.p < 0.62 || fav.p > 0.8 || !(fav.softMargin <= 0.06) || !(fav.price >= 1.005 / fav.p)) continue;
    addBet(rec, g, fav, fav.price);
  }
  return rec;
}

/**
 * Gemini steam chasing, without look-ahead: at closing time, if the reference
 * price for an outcome shortened by at least 4.5% since the open and Bet365's
 * closing price still beats the fair closing price by 1.5%, bet Bet365's close.
 */
function steam({ name }) {
  const rec = record(name);
  for (const g of games) {
    const open = outcomes(g, 'open'), close = outcomes(g, 'close');
    for (const c of close.filter(o => o.market !== 'AH')) {
      const o = open.find(x => x.market === c.market && x.key === c.key);
      if (!o || !(c.price >= 1.45 && c.price <= 4)) continue;
      if (c.p / o.p < 1.045) continue; // probability rose 4.5%+ = price shortened
      if (c.price * c.p - 1 < 0.015) continue;
      addBet(rec, g, c, c.price);
      break;
    }
  }
  return rec;
}

/* ------------------------------------------------------- accumulators --- */

/**
 * Accumulators of favourites, as the owner bets them: each weekend (Fri-Mon) or
 * midweek window, take the strongest favourites in a price band, and build
 * tickets of n legs. Reported: realised ROI and expected ROI from fair
 * probabilities (much less noisy than results for long tickets).
 */
function accumulators({ legs, lo, hi, sharp = false, name }) {
  const windows = new Map();
  for (const g of games) {
    const day = new Date(g.when).getUTCDay();
    const start = g.when - ((day + 2) % 7 >= 4 ? ((day + 2) % 7 - 4) : (day + 2) % 7) * 864e5; // groups Fri-Mon and Tue-Thu
    const key = g.season + ':' + Math.floor(start / (3.5 * 864e5));
    if (!windows.has(key)) windows.set(key, []);
    for (const o of outcomes(g, 'open')) {
      if (o.market !== '1X2' || o.key === 'd' || !(o.price >= lo && o.price <= hi)) continue;
      if (sharp && !(o.price >= 0.995 / o.p)) continue;
      windows.get(key).push({ g, o });
    }
  }
  const tickets = [];
  for (const [key, picks] of windows) {
    picks.sort((a, b) => b.o.p - a.o.p);
    for (let i = 0; i + legs <= picks.length && i < legs * 3; i += legs) {
      const t = picks.slice(i, i + legs);
      const odds = t.reduce((s, x) => s * x.o.price, 1);
      const win = t.every(x => x.o.profit(x.o.price) > 0);
      const fairWin = t.reduce((s, x) => s * x.o.p, 1);
      tickets.push({ season: key.split(':')[0], odds, profit: win ? odds - 1 : -1, ev: fairWin * odds - 1 });
    }
  }
  const n = tickets.length;
  return { name, legs, n, realisedRoi: tickets.reduce((s, t) => s + t.profit, 0) / n, expectedRoi: tickets.reduce((s, t) => s + t.ev, 0) / n,
    wins: tickets.filter(t => t.profit > 0).length, avgOdds: tickets.reduce((s, t) => s + t.odds, 0) / n };
}

/** Bet365 value per favourite price band: average (price x fair closing probability - 1). */
function bandValue(lo, hi, snap = 'open') {
  let s = 0, n = 0;
  for (const g of games) for (const o of outcomes(g, snap)) {
    if (o.market !== '1X2' || o.key === 'd' || !(o.price >= lo && o.price < hi)) continue;
    const pc = closingFair(g, o);
    if (!pc) continue;
    s += o.price * pc - 1; n++;
  }
  return { band: lo.toFixed(2) + '-' + hi.toFixed(2), n, value: s / n };
}

/* ---------------------------------------------------------------- run --- */

const strategies = [
  valueSingles({ snap: 'open', minEdge: 0.02, name: 'Value singles, early, edge>=2%, all markets (Bet365)' }),
  valueSingles({ snap: 'open', minEdge: 0.01, name: 'Value singles, early, edge>=1%' }),
  valueSingles({ snap: 'open', minEdge: 0.03, name: 'Value singles, early, edge>=3%' }),
  valueSingles({ snap: 'open', minEdge: 0.02, markets: ['1X2'], name: 'Value singles, early, 1X2 only' }),
  valueSingles({ snap: 'open', minEdge: 0.02, markets: ['OU2.5'], name: 'Value singles, early, over/under only' }),
  valueSingles({ snap: 'open', minEdge: 0.02, markets: ['AH'], name: 'Value singles, early, Asian handicap only' }),
  valueSingles({ snap: 'close', minEdge: 0.02, name: 'Value singles, late, edge>=2%, all markets (Bet365)' }),
  valueSingles({ snap: 'open', minEdge: 0.02, markets: ['1X2', 'OU2.5'], exec: 'max', name: 'Value singles, early, BEST price of all books' }),
  favouriteSingles({ name: 'Favourite singles (ChatGPT), early' }),
  favouriteSingles({ name: '  band 1.20-1.40', band: [1.2, 1.4] }),
  favouriteSingles({ name: '  band 1.40-1.60', band: [1.4, 1.6] }),
  favouriteSingles({ name: '  band 1.60-1.80', band: [1.6, 1.81] }),
  sharpFavourites({ name: 'Sharp-filtered favourites (Gemini), early' }),
  steam({ name: 'Steam chasing (Gemini, no look-ahead), late' }),
].map(summary);

const pct = (x, d = 1) => Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%' : '-';
console.log('Games:', games.length, '| seasons', SEASONS.join(', '), '| reference: Pinnacle to 2024/25, Betfair Exchange 2025/26\n');
console.log('STRATEGY'.padEnd(58), 'BETS'.padStart(5), 'ROI'.padStart(8), 'CLV'.padStart(8), 't(CLV)'.padStart(7), 'CLV+'.padStart(6), 'HIT'.padStart(6), 'ODDS'.padStart(6), 'MAXDD'.padStart(6), '  ROI / CLV by season');
for (const s of strategies) {
  if (!s.n) { console.log(s.name.padEnd(58), '0'); continue; }
  console.log(s.name.padEnd(58), String(s.n).padStart(5), pct(s.roi).padStart(8), pct(s.clv, 2).padStart(8), s.clvT.toFixed(1).padStart(7),
    pct(s.clvPos, 0).padStart(6), pct(s.hit, 0).padStart(6), s.avgPrice.toFixed(2).padStart(6), pct(s.dd, 0).padStart(6), ' ',
    SEASONS.map(k => k.slice(0, 2) + '/' + k.slice(2) + ' ' + (s.bySeason[k].n ? pct(s.bySeason[k].roi, 0) + '/' + pct(s.bySeason[k].clv, 1) : '-')).join('  '));
}

console.log('\nBET365 VALUE ON FAVOURITES BY PRICE (average of price x fair closing probability - 1 = loss per leg)');
for (const [lo, hi] of [[1.05, 1.15], [1.15, 1.25], [1.25, 1.35], [1.35, 1.5], [1.5, 1.75], [1.75, 2.1]]) {
  const b = bandValue(lo, hi);
  console.log('  ' + b.band, 'legs', String(b.n).padStart(5), 'value per leg', pct(b.value, 2));
}

console.log('\nACCUMULATORS OF FAVOURITES (Bet365 opening prices, strongest favourites of each weekend/midweek window)');
console.log('  LEGS  PRICES        TICKETS  AVG ODDS  WON  REALISED ROI  EXPECTED ROI (fair probabilities)');
for (const [lo, hi, label, sharp] of [[1.09, 1.72, '1.09-1.72', false], [1.09, 1.35, '1.09-1.35', false], [1.3, 1.65, '1.30-1.65 sharp', true]]) {
  for (const legs of [1, 2, 3, 4, 6, 11, 15]) {
    const a = accumulators({ legs, lo, hi, sharp, name: label });
    if (!a.n) continue;
    console.log('  ' + String(legs).padStart(4), ' ' + label.padEnd(16), String(a.n).padStart(6), a.avgOdds.toFixed(1).padStart(9), String(a.wins).padStart(5),
      pct(a.realisedRoi).padStart(13), pct(a.expectedRoi).padStart(13));
  }
}
