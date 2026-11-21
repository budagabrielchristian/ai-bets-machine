// Analysis of your own (manual) bets: what worked, what cost money, and what to change.
import { settledAt, ticketClv, ticketProfit } from './aiStats.js';
import { EXTRA_MARKETS, readScore, settleExtra } from './legRules.js';

/** Win / lose for one leg from its final score ("2-1"), or null before it is known. */
export function legOutcome(leg) {
  const m = String(leg.result || '').match(/(\d+)\D+(\d+)/);
  if (!m) return null;
  const h = Number(m[1]), a = Number(m[2]);
  const [home, away] = leg.teams || String(leg.matchTitle).split(' vs ');
  if (EXTRA_MARKETS.has(leg.market)) {
    const ht = leg.halfTime === 'unknown' ? [null, null] : readScore(leg.halfTime) || [undefined, undefined];
    const r = settleExtra(leg, { home: h, away: a, htHome: ht[0], htAway: ht[1] });
    return r === 'won' || r === 'lost' ? r : null;
  }
  if (leg.market === 'total') return (leg.side === 'over' ? h + a > leg.line : h + a < leg.line) ? 'won' : 'lost';
  if (leg.market === 'handicap') return (leg.side === 'home' ? h - a : a - h) + leg.line > 0 ? 'won' : 'lost';
  const winner = h > a ? home : h < a ? away : 'Draw';
  return leg.selection === winner ? 'won' : 'lost';
}

const settledOnly = tickets => tickets.filter(t => t.status === 'won' || t.status === 'lost');
const MIN = 3; // smallest group worth an opinion

function ticketGroup(tickets) {
  const staked = tickets.reduce((s, t) => s + Number(t.stake), 0);
  const profit = tickets.reduce((s, t) => s + ticketProfit(t), 0);
  const won = tickets.filter(t => t.status === 'won').length;
  return { count: tickets.length, won, staked, profit, roi: staked ? profit / staked : 0, winRate: tickets.length ? won / tickets.length : 0 };
}

function groupTickets(tickets, keyOf, order) {
  const map = new Map();
  for (const t of tickets) { const k = keyOf(t); if (!map.has(k)) map.set(k, []); map.get(k).push(t); }
  return (order || [...map.keys()]).filter(k => map.has(k)).map(k => ({ label: k, ...ticketGroup(map.get(k)) }));
}

/** Hit rate of legs per category, against the chance their prices implied. */
function groupLegs(legs, keyOf) {
  const map = new Map();
  for (const l of legs) { const k = keyOf(l); if (k == null) continue; if (!map.has(k)) map.set(k, []); map.get(k).push(l); }
  return [...map.entries()].map(([label, ls]) => {
    const won = ls.filter(l => l.outcome === 'won').length;
    const expected = ls.reduce((s, l) => s + (Number.isFinite(l.marketProbability) ? l.marketProbability : 1 / l.price), 0) / ls.length;
    return { label, count: ls.length, won, hitRate: won / ls.length, expected };
  }).sort((a, b) => b.count - a.count);
}

export const oddsBand = o => o < 1.5 ? 'under 1.50' : o < 2 ? '1.50 to 1.99' : o < 3 ? '2.00 to 2.99' : o < 5 ? '3.00 to 4.99' : '5.00 and up';
const ODDS_ORDER = ['under 1.50', '1.50 to 1.99', '2.00 to 2.99', '3.00 to 4.99', '5.00 and up'];
const size = t => t.selections.length === 1 ? 'Singles' : t.selections.length === 2 ? '2 matches' : '3+ matches';
const marketName = l => l.market === 'total' ? 'Total goals' : l.market === 'handicap' ? 'Handicap' : 'Match result';
function pickType(l) {
  if ((l.market || 'h2h') !== 'h2h') return null;
  if (l.selection === 'Draw') return 'Draw';
  return 1 / l.price >= 0.5 ? 'Favourite' : 'Underdog';
}

const pct = v => (v * 100).toFixed(0) + '%';
const signedPct = v => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%';
const ron = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' RON';

export function analyzeBets(tickets, now = Date.now()) {
  const settled = settledOnly(tickets);
  const open = tickets.filter(t => t.status === 'pending');
  const summary = ticketGroup(settled);
  summary.open = open.length;
  summary.averageOdds = settled.length ? settled.reduce((s, t) => s + Number(t.totalOdds), 0) / settled.length : 0;
  const clvs = settled.map(t => ticketClv(t, now)).filter(v => v !== null);
  summary.clv = clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null;

  const bySize = groupTickets(settled, size, ['Singles', '2 matches', '3+ matches']);
  const byOdds = groupTickets(settled, t => oddsBand(Number(t.totalOdds)), ODDS_ORDER);

  // Legs with a known outcome (the match finished).
  const legs = settled.flatMap(t => t.selections.map(l => ({ ...l, outcome: legOutcome(l), ticket: t }))).filter(l => l.outcome);
  const byMarket = groupLegs(legs, marketName);
  const byPick = groupLegs(legs, pickType);
  const byCompetition = groupLegs(legs, l => l.competition || null).filter(g => g.count >= 2).slice(0, 6);

  // Tickets that one match broke.
  const lostByOne = settled.filter(t => t.status === 'lost' && t.selections.length > 1)
    .map(t => ({ ticket: t, losers: t.selections.filter(l => legOutcome(l) === 'lost') }))
    .filter(x => x.losers.length === 1);
  const biggestLosses = settled.filter(t => t.status === 'lost').sort((a, b) => b.stake - a.stake).slice(0, 3);

  // Value at the moment of betting (needs the fair price captured when the bet was placed).
  const priced = legs.filter(l => Number.isFinite(l.marketProbability));
  const value = priced.length ? {
    legs: priced.length,
    averageEdge: priced.reduce((s, l) => s + (l.marketProbability * l.price - 1), 0) / priced.length,
    negativeShare: priced.filter(l => l.marketProbability * l.price < 1).length / priced.length,
  } : null;
  const disagreed = legs.filter(l => Number.isFinite(l.modelProbability) && Number.isFinite(l.marketProbability) && l.modelProbability < l.marketProbability - 0.03);
  const agreed = legs.filter(l => Number.isFinite(l.modelProbability) && Number.isFinite(l.marketProbability) && l.modelProbability >= l.marketProbability - 0.03);
  const modelCheck = disagreed.length || agreed.length ? {
    disagreed: disagreed.length, disagreedWon: disagreed.filter(l => l.outcome === 'won').length,
    agreed: agreed.length, agreedWon: agreed.filter(l => l.outcome === 'won').length,
  } : null;

  /* ------------------------------------------------------ suggestions --- */
  const tips = [];
  if (settled.length < MIN) {
    tips.push({ tone: 'info', text: 'The analysis gets useful after a few settled bets. So far: ' + settled.length + ' settled, ' + open.length + ' open.' });
  }
  const singles = bySize.find(g => g.label === 'Singles');
  const multi = settledOnly(settled.filter(t => t.selections.length > 1));
  const multiGroup = ticketGroup(multi);
  if (multi.length >= MIN && singles?.count >= MIN && multiGroup.roi < singles.roi - 0.1) {
    tips.push({ tone: 'avoid', text: 'Your multi-match tickets returned ' + signedPct(multiGroup.roi) + ' against ' + signedPct(singles.roi) + ' for singles. Every extra match multiplies the bookmaker margin: bet more singles.' });
  } else if (multi.length >= MIN && multiGroup.roi < -0.15) {
    tips.push({ tone: 'avoid', text: 'Multi-match tickets: ' + multiGroup.won + ' of ' + multi.length + ' won, ' + ron(multiGroup.profit) + '. Each extra match multiplies the bookmaker margin, so try fewer legs.' });
  }
  if (lostByOne.length >= 2) {
    tips.push({ tone: 'avoid', text: lostByOne.length + ' tickets lost because of a single match. With fewer legs, ' + (lostByOne.length === settled.filter(t => t.status === 'lost').length ? 'most' : 'several') + ' of those would have paid out in part.' });
  }
  const worstOdds = byOdds.filter(g => g.count >= MIN && g.roi < -0.2).sort((a, b) => a.roi - b.roi)[0];
  if (worstOdds) tips.push({ tone: 'avoid', text: 'Odds ' + worstOdds.label + ' cost you the most: ' + signedPct(worstOdds.roi) + ' over ' + worstOdds.count + ' tickets (' + ron(worstOdds.profit) + ').' });
  const bestOdds = byOdds.filter(g => g.count >= MIN && g.roi > 0.05).sort((a, b) => b.roi - a.roi)[0];
  if (bestOdds) tips.push({ tone: 'keep', text: 'Odds ' + bestOdds.label + ' work for you: ' + signedPct(bestOdds.roi) + ' over ' + bestOdds.count + ' tickets. Keep that range.' });
  for (const g of byPick) {
    if (g.count >= MIN && g.hitRate < g.expected - 0.12) {
      tips.push({ tone: 'avoid', text: g.label + ' picks won ' + pct(g.hitRate) + ' of the time, while their prices implied ' + pct(g.expected) + '. Be more selective there.' });
    }
  }
  if (value && value.legs >= MIN && value.negativeShare > 0.6) {
    tips.push({ tone: 'avoid', text: pct(value.negativeShare) + ' of your picks were priced below the fair market chance (average ' + signedPct(value.averageEdge) + '). Check the match page: positive expected value means the price beats the fair chance.' });
  }
  if (modelCheck && modelCheck.disagreed >= MIN && modelCheck.disagreedWon / modelCheck.disagreed < (modelCheck.agreed ? modelCheck.agreedWon / modelCheck.agreed : 1) - 0.1) {
    tips.push({ tone: 'avoid', text: 'When the AI models rated your pick lower than the market, you won ' + modelCheck.disagreedWon + ' of ' + modelCheck.disagreed + '. When they agreed: ' + modelCheck.agreedWon + ' of ' + modelCheck.agreed + '. Check the model column before betting.' });
  }
  if (summary.clv !== null && clvs.length >= MIN) {
    tips.push({ tone: summary.clv > 0 ? 'keep' : 'info', text: summary.clv > 0
      ? 'You beat the closing price by ' + signedPct(summary.clv) + ' on average, the best sign of real skill. Keep betting early on prices you trust.'
      : 'On average the price moved against you before kickoff (' + signedPct(summary.clv) + '). Betting earlier, or skipping picks the market drifts away from, tends to help.' });
  }
  if (settled.length >= MIN && !tips.some(t => t.tone !== 'info')) {
    tips.push({ tone: 'info', text: 'No clear weak spot yet. Results so far: ' + summary.won + ' of ' + settled.length + ' won, ' + ron(summary.profit) + '.' });
  }

  return { summary, bySize, byOdds, byMarket, byPick, byCompetition, lostByOne, biggestLosses, value, modelCheck, tips,
    lastSettled: settled.length ? Math.max(...settled.map(settledAt)) : null };
}
