// The AIs. Each one receives its own wallet and returns new practice tickets.
import { availableFunds } from '../../src/services/practice.js';
import { buildSlips } from '../../src/services/buildSlips.js';
import { blend, kellyStake, median, powerDevig } from './math.js';
import { marketProbability, predict } from './ratings.js';

const HOUR = 3600000;
/** Largest model-vs-market gap (in probability points) the model AIs will act on. */
export const MAX_DISAGREEMENT = 0.10;
/** How far ahead the AIs look for matches (72 h reaches the weekend from midweek). */
export const WINDOW_HOURS = 72;

/* ------------------------------------------------------- market reading --- */

/** Every priced outcome at every bookmaker, with that book's fair probability. */
// Prices from the Odds API are refreshed every few hours, so allow older quotes.
const QUOTE_MAX_AGE = 4 * HOUR;

export function readOptions(match, now = Date.now(), { includeExtra = true } = {}) {
  const options = [];
  for (const book of match.bookmakers || []) {
    if (!book?.title || (book.extra && !includeExtra)) continue;
    for (const market of book.markets || []) {
      const stamp = market.last_update || book.last_update;
      if (stamp) {
        const age = now - Date.parse(stamp);
        if (!(age >= -60000 && age <= QUOTE_MAX_AGE)) continue;
      }
      let outcomes;
      if (market.key === 'h2h') {
        const names = [match.home_team, 'Draw', match.away_team];
        outcomes = ['home', 'draw', 'away'].map((side, i) => {
          const o = market.outcomes?.find(x => x.name === names[i]);
          return o && { side, line: undefined, selection: names[i], price: Number(o.price) };
        });
      } else if (market.key === 'total' || market.key === 'handicap') {
        outcomes = (market.outcomes || []).map(o => ({ side: o.side, line: o.line,
          selection: (market.title || market.key) + ' - ' + o.name, price: Number(o.price) }));
        if (outcomes.length !== 2 || outcomes.some(o => !Number.isFinite(o.line) || Math.abs(o.line % 1) !== 0.5)) continue;
      } else continue;
      if (outcomes.some(o => !o)) continue;
      const fair = powerDevig(outcomes.map(o => o.price));
      if (!fair) continue;
      outcomes.forEach((o, i) => options.push({ ...o, market: market.key, bookmaker: book.title,
        fair: fair.probabilities[i], margin: fair.margin }));
    }
  }
  return options;
}

const sameOutcome = (a, b) => a.market === b.market && a.side === b.side &&
  (a.market === 'h2h' || a.line === b.line);

function upcoming(matches, now, hours) {
  return matches.filter(m => {
    const kickoff = Date.parse(m.commence_time);
    return !m.archived && kickoff > now + 5 * 60000 && kickoff <= now + hours * HOUR &&
      (!m.statusName || m.statusName === 'STATUS_SCHEDULED');
  });
}

function leg(match, option, extra = {}) {
  return { competition: match.sport_title, matchId: match.id, matchDate: match.commence_time,
    teams: [match.home_team, match.away_team], matchTitle: match.home_team + ' vs ' + match.away_team,
    bookmaker: option.bookmaker, market: option.market, selection: option.selection,
    side: option.side, line: option.line, price: option.price, openingPrice: option.price, ...extra };
}

/* --------------------------------------------------------- risk manager --- */

function walletState(wallet) {
  const cash = availableFunds(wallet);
  const reserved = wallet.tickets.filter(t => t.autoRun && t.status === 'pending')
    .reduce((s, t) => s + Math.round(t.stake * 100), 0);
  const used = new Set(wallet.tickets.flatMap(t => t.selections.map(s => s.matchId)));
  return { cash, reserved, bankroll: cash + reserved, used };
}

/**
 * Group the AI's picks into multi-match tickets and stake them within the
 * bankroll rules: each fixture used once, a maximum share of the bankroll at
 * risk, and a cap on new tickets per scan.
 *
 * Picks are taken best first and combined into tickets of up to `maxLegs`
 * matches while the combined odds stay under `maxOdds`. Every ticket has at
 * least 2 matches: a pick left without a partner waits for the next scan.
 */
function place(wallet, candidates, { strategy, exposure, perScan, stake, now, maxLegs = 4, maxOdds = 10, minLegs = 2 }) {
  const state = walletState(wallet);
  let capacity = Math.min(state.cash, Math.floor(state.bankroll * exposure) - state.reserved);
  const pool = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (state.used.has(c.match.id)) continue;
    state.used.add(c.match.id);
    pool.push(c);
  }
  // First fit: each pick (best first) joins the first ticket it fits on, so
  // two long prices that cannot share a ticket still find other partners.
  const odds = g => g.reduce((p, c) => p * c.option.price, 1);
  const groups = [];
  for (const c of pool) {
    const home = groups.find(g => g.length < maxLegs && odds(g) * c.option.price <= maxOdds);
    if (home) home.push(c); else groups.push([c]);
  }
  // Fuller tickets first, then the ones with the best picks.
  groups.sort((a, b) => b.length - a.length);

  const tickets = [];
  for (const g of groups) {
    if (tickets.length >= perScan || capacity < 100) break;
    const start = Math.min(...g.map(c => Date.parse(c.match.commence_time)));
    if (g.length < minLegs) continue;
    const price = Number(odds(g).toFixed(2));
    const probability = g.reduce((p, c) => p * (c.probability ?? NaN), 1);
    const cents = Math.min(capacity, stake({ probability, price, legs: g }, state.bankroll));
    if (cents < 100) continue;
    capacity -= cents;
    const edge = probability * price - 1;
    tickets.push({ id: crypto.randomUUID(), autoRun: true, source: 'ai', strategy, currency: 'RON',
      status: 'pending', datePlaced: new Date(now).toISOString(), matchDate: new Date(start).toISOString(),
      stake: cents / 100, totalOdds: price, potentialReturn: Math.floor(cents * price) / 100,
      rationale: g.length + ' matches at ' + price.toFixed(2) + (Number.isFinite(edge) ? ' · combined edge ' + (edge >= 0 ? '+' : '') + pct(edge) : ''),
      selections: g.map(c => leg(c.match, c.option, { ...c.details, rationale: c.rationale })) });
  }
  return tickets;
}

const pct = x => (x * 100).toFixed(1) + '%';

/** Consensus fair probability for an outcome across every book quoting it. */
function consensus(options, option) {
  return median(options.filter(o => sameOutcome(o, option)).map(o => o.fair));
}

function modelProbability(prediction, option, source) {
  if (!prediction) return NaN;
  if (source === 'elo') return option.market === 'h2h' && prediction.elo ? prediction.elo[option.side] : NaN;
  if (prediction.poisson) return marketProbability(prediction.poisson.matrix, option);
  return NaN;
}

/* ------------------------------------------------------------ the AIs --- */
// Each AI accepts an optional `tune` object ({ minEdge, legs: { minLegs, maxLegs } })
// used only by the backtest to compare variants; production never passes it.

/** Baseline: strong favourites at a fair margin, flat 2% stakes. */
function favorites(wallet, matches, { now, models, tune = {}, key = 'favorites' }) {
  const candidates = [];
  for (const match of upcoming(matches, now, WINDOW_HOURS)) {
    const options = readOptions(match, now, { includeExtra: false }).filter(o => o.market === 'h2h');
    if (!options.length || median(options.map(o => o.margin)) > 0.10) continue;
    for (const side of ['home', 'away']) {
      const quotes = options.filter(o => o.side === side);
      if (!quotes.length) continue;
      const fair = median(quotes.map(o => o.fair));
      const best = quotes.reduce((a, b) => b.price > a.price ? b : a);
      if (fair < 0.6 || best.price < 1.2 || best.price > 1.80) continue;
      // Skip favourites that our own models clearly disagree with.
      const prediction = predict(models, match);
      const model = modelProbability(prediction, best, 'poisson');
      const check = Number.isFinite(model) ? model : modelProbability(prediction, best, 'elo');
      if (Number.isFinite(check) && check < fair - 0.03) continue;
      candidates.push({ match, option: best, score: fair,
        details: { marketProbability: fair, modelProbability: Number.isFinite(check) ? check : undefined },
        rationale: 'Market favourite at ' + pct(fair) + ' fair probability' + (Number.isFinite(check) ? ', model ' + pct(check) : '') });
    }
  }
  // Favourite accumulators: 2-3 favourites per ticket, combined odds up to 4.00.
  return place(wallet, candidates, { strategy: key, exposure: 0.10, perScan: 3, now, maxLegs: 4, maxOdds: 6, ...tune.legs,
    stake: (_, bankroll) => Math.floor(bankroll * 0.02) });
}

/**
 * Line shopping: compare the best available price against the no-vig price
 * of other bookmakers. Pinnacle, the sharpest book, is used alone when present.
 */
function price(wallet, matches, { now, tune = {}, key = 'price' }) {
  const candidates = [];
  for (const match of upcoming(matches, now, WINDOW_HOURS)) {
    const options = readOptions(match, now);
    const isSharp = o => /pinnacle/i.test(o.bookmaker);
    for (const option of options) {
      // The sharp book is the yardstick, never the place to bet against softer books.
      if (isSharp(option)) continue;
      const references = options.filter(o => o.bookmaker !== option.bookmaker && sameOutcome(o, option) && o.margin <= 0.08);
      if (!references.length) continue;
      const sharp = references.find(isSharp);
      const fair = sharp ? sharp.fair : median(references.map(o => o.fair));
      const edge = fair * option.price - 1;
      if (edge < (tune.minEdge ?? 0.03) || option.price > 6) continue;
      candidates.push({ match, option, score: edge, probability: fair,
        details: { marketProbability: fair, referenceProbability: fair, estimatedReturn: edge, edge },
        rationale: pct(edge) + ' above ' + (sharp ? 'Pinnacle no-vig price' : 'consensus of ' + references.length + ' books') });
    }
  }
  return place(wallet, candidates, { strategy: key, exposure: 0.25, perScan: 3, now, maxLegs: 4, maxOdds: 12, ...tune.legs,
    stake: (t, bankroll) => kellyStake({ probability: t.probability, price: t.price, bankroll, cap: 0.04 }) });
}

/**
 * Model value: blend the model's probability with the market's fair
 * probability (markets are hard to beat, so the model only gets half the
 * weight) and bet when the blended edge clears the threshold.
 */
function modelValue(strategy, source, minEdge, markets) {
  return (wallet, matches, { now, models, tune = {} }) => {
    const candidates = [];
    for (const match of upcoming(matches, now, WINDOW_HOURS)) {
      const prediction = predict(models, match);
      if (!prediction) continue;
      const options = readOptions(match, now, { includeExtra: false }).filter(o => markets.includes(o.market));
      for (const option of options) {
        if (option.price < 1.3 || option.price > 5) continue;
        const model = modelProbability(prediction, option, source);
        if (!Number.isFinite(model)) continue;
        const market = consensus(options, option);
        // A huge gap usually means the model is missing news (injuries,
        // rotation, transfers), not that the market is wrong. Stay out.
        if (Math.abs(model - market) > MAX_DISAGREEMENT) continue;
        const probability = blend(model, market, 0.5);
        const edge = probability * option.price - 1;
        if (edge < (tune.minEdge ?? minEdge)) continue;
        candidates.push({ match, option, score: edge, probability,
          details: { modelProbability: model, marketProbability: market, probability, edge },
          rationale: (source === 'elo' ? 'Elo' : 'Poisson') + ' ' + pct(model) + ' vs market ' + pct(market) + ' → ' + pct(edge) + ' edge' });
      }
    }
    return place(wallet, candidates, { strategy, exposure: 0.25, perScan: 3, now, maxLegs: 4, maxOdds: 12, ...tune.legs,
      stake: (t, bankroll) => kellyStake({ probability: t.probability, price: t.price, bankroll, cap: 0.03 }) });
  };
}

/** 60/10 combination slips; legs are now chosen by model value, not just margin. */
function slips(wallet, matches, { now, models, key = 'slips', stakeFor }) {
  const cash = availableFunds(wallet);
  return buildSlips(wallet, matches, cash, new Date(now), {
    strategy: key, stakeFor,
    teamLeague: id => models?.homeLeague.get(id),
    probability(match, legInfo) {
      const prediction = predict(models, match);
      const options = readOptions(match, now, { includeExtra: false });
      const option = options.find(o => o.bookmaker === legInfo.bookmaker && o.market === legInfo.market &&
        (o.market === 'h2h' ? o.selection === legInfo.selection : o.side === legInfo.side && o.line === legInfo.line));
      if (!option) return NaN;
      let model = modelProbability(prediction, option, 'poisson');
      if (!Number.isFinite(model)) model = modelProbability(prediction, option, 'elo');
      if (Math.abs(model - option.fair) > MAX_DISAGREEMENT) model = NaN;
      return blend(model, option.fair, 0.5);
    },
  });
}

const SINGLES = { legs: { minLegs: 1, maxLegs: 1 } };

export const AI = {
  favorites: { run: favorites },
  price: { run: price },
  slips: { run: slips },
  elo: { run: modelValue('elo', 'elo', 0.025, ['h2h']) },
  poisson: { run: modelValue('poisson', 'poisson', 0.025, ['h2h', 'total', 'handicap']) },
  // Variants that did best in the backtest (npm run backtest).
  favSingles: { run: (w, m, ctx) => favorites(w, m, { ...ctx, key: 'favSingles', tune: SINGLES }) },
  sharpSingles: { run: (w, m, ctx) => price(w, m, { ...ctx, key: 'sharpSingles', tune: { ...SINGLES, minEdge: 0.01 } }) },
  // 60/10 rules with stakes as a share of the bankroll: 3% up to odds 3.50, 0.5% above (min 1 RON).
  slipsScaled: { run: (w, m, ctx) => slips(w, m, { ...ctx, key: 'slipsScaled',
    stakeFor: (tier, bankroll) => Math.max(100, Math.floor(bankroll * (tier.key === 'standard' ? 0.03 : 0.005))) }) },
};
