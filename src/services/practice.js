import { buildSlips } from './buildSlips.js';
import { jointProbability } from './jointMarket.js';
import { rankMarkets } from './rankMarkets.js';

export function availableFunds(account) {
  return account.tickets.filter(t => t.autoRun).reduce((sum,t) =>
    sum - Math.round(t.stake * 100) + (t.status === 'won' ? Math.round(t.potentialReturn * 100) : t.status === 'void' ? Math.round(t.stake * 100) : 0), account.deposit);
}

export function pilotCandidates(matches, strategy, now = new Date()) {
  const soon = matches.filter(m => Date.parse(m.commence_time) <= +now + 86400000);
  if (strategy === 'price') return rankMarkets(soon, 'price', soon.length, 'all', now);
  return rankMarkets(soon, 'safe', soon.length, 'all', now)
    .filter(p => p.rankingProbability >= .60 && p.margin <= .08 && p.spread <= .08);
}

export function scan(account, matches) {
  const cash = availableFunds(account);
  if (account.strategy === 'slips') return buildSlips(account,matches,cash);
  const reserved = account.tickets.filter(t => t.autoRun && t.status === 'pending').reduce((sum,t) => sum + Math.round(t.stake * 100), 0);
  const stake = Math.floor(cash * .02);
  let capacity = Math.min(cash, Math.floor((cash + reserved) * .10) - reserved);
  const used = new Set(account.tickets.filter(t => t.autoRun).flatMap(t => t.selections.map(s => s.matchId)));
  const unseen = matches.filter(m => !used.has(m.id));
  const tickets = [];
  for (const p of pilotCandidates(unseen, account.strategy)) {
    if (!stake || capacity < stake || tickets.length >= 3) break;
    if (used.has(p.match.id)) continue;
    used.add(p.match.id);
    capacity -= stake;
    tickets.push({id: crypto.randomUUID(), autoRun: true, strategy:account.strategy || 'favorites', source: 'ai', status:'pending', datePlaced:new Date().toISOString(),
      matchDate:p.match.commence_time, stake:stake/100, potentialReturn:Math.round(stake*p.price)/100, totalOdds:p.price,
      selections:[{matchId:p.match.id, matchDate:p.match.commence_time, matchTitle:p.match.home_team+' vs '+p.match.away_team,
        selection:p.selection, price:p.price, bookmaker:p.bookmaker, referenceProbability:p.referenceProbability, estimatedReturn:p.expectedReturn}]});
  }
  return tickets;
}

export function grade(ticket, results) {
  const legs = ticket.selections.map(leg => {
    const r = results[leg.matchId];
    if (!r) return 'pending';
    if (r.void) return 'void';
    if (leg.market === 'handicap') {
      const difference = leg.side === 'home' ? r.homeScore - r.awayScore : r.awayScore - r.homeScore;
      return difference + leg.line > 0 ? 'won' : 'lost';
    }
    if (leg.market === 'total') {
      const goals = r.homeScore + r.awayScore;
      return (leg.side === 'over' ? goals > leg.line : goals < leg.line) ? 'won' : 'lost';
    }
    if (![r.homeTeam, r.awayTeam, 'Draw'].includes(leg.selection)) return 'pending';
    return leg.selection === r.winningSelection ? 'won' : 'lost';
  });
  if (legs.includes('lost')) return 'lost';
  if (legs.includes('pending')) return 'pending';
  // Practice builder rule: refund an otherwise successful ticket containing a void leg.
  return legs.includes('void') ? 'void' : 'won';
}
export function builderPrice(legs) {
  const groups = new Map();
  for (const leg of legs) {
    if (!groups.has(leg.matchId)) groups.set(leg.matchId, []);
    groups.get(leg.matchId).push(leg);
  }
  let price = 1;
  for (const group of groups.values()) {
    if (group.length === 1) { price *= Number(group[0].price); continue; }
    const total = group.find(leg => leg.market === 'total');
    const winner = group.find(leg => !leg.market || leg.market === 'h2h');
    const model = total?.jointModel;
    const idx = model?.names.indexOf(winner?.selection) ?? -1;
    if (group.length !== 2 || !model || idx < 0 || total.line !== model.line) return NaN;
    const joint = jointProbability(model, idx, total.side);
    if (!(joint > 0)) return NaN;
    price *= Math.max(1, 1 / (joint * model.load));
  }
  return Number(price.toFixed(2));
}
