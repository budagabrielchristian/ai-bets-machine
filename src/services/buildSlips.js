import { slipMatchAllowed } from './eligibleCompetition.js';

// Stake depends on the slip's combined odds: up to 3.50 risks 60 RON, above
// 3.50 risks 10 RON. Each slip has 2 to 4 matches. A few slips may be open at
// once, limited per tier so one bad day cannot empty the wallet.
export const SLIP_TIERS = [
  { key:'standard', stake:60, min:1.90, max:3.50, target:2.5, maxOpen:2 },
  { key:'higher', stake:10, min:3.51, max:8.00, target:5.0, maxOpen:4 }
];
const MIN_LEG = 1.30;

function collectLegs(matches, now, used, { probability, teamLeague } = {}) {
  const legs = [];
  for (const match of matches) {
    // Top five leagues + Champions League, with the team rules (see eligibleCompetition.js).
    if (!slipMatchAllowed(match, teamLeague)) continue;
    const kickoff = Date.parse(match.commence_time);
    if (used.has(match.id) || match.archived || !(kickoff > +now && kickoff <= +now + 72*3600000)) continue;
    if (match.statusName && match.statusName !== 'STATUS_SCHEDULED') continue;
    for (const book of match.bookmakers || []) {
      if (!book.title || book.title === 'ESPN') continue;
      for (const market of book.markets || []) {
        if (!['h2h','total','handicap'].includes(market.key)) continue;
        if (market.outcomes?.length !== (market.key === 'h2h' ? 3 : 2)) continue;
        const stamp = market.last_update || book.last_update;
        const age = +now - Date.parse(stamp);
        if (stamp && !(age >= -60000 && age <= 3600000)) continue;
        if (market.outcomes.some(o => !Number.isFinite(o.price) || o.price <= 1)) continue;
        const total = market.outcomes.reduce((sum,o)=>sum+1/o.price,0);
        if (total < .99 || total > 1.10) continue;
        for (const o of market.outcomes) {
          if (o.price < MIN_LEG || o.price > 8 / MIN_LEG) continue;
          const leg = {competition:match.sport_title,matchId:match.id, matchDate:match.commence_time, teams:[match.home_team,match.away_team],
            matchTitle:match.home_team+' vs '+match.away_team, bookmaker:book.title, market:market.key,
            selection:market.key === 'h2h' ? o.name : market.title+' - '+o.name,
            side:o.side,line:o.line,price:o.price,openingPrice:o.price,marketTotal:total};
          if (probability) {
            // Expected return per unit staked, from the blended model/market probability.
            const p = probability(match, leg);
            if (Number.isFinite(p)) {
              leg.probability = p;
              leg.value = p * o.price;
              // Skip legs that look clearly worse than fair.
              if (leg.value < .97) continue;
            }
          }
          legs.push(leg);
        }
      }
    }
  }
  return legs;
}

// Lower is better: minus the leg's value (or plus the bookmaker margin when
// there is no model).
function legCost(leg) {
  return leg.value ? -Math.log(leg.value) : Math.log(leg.marketTotal);
}

function compatible(legs, leg) {
  return legs.every(l => l.matchId !== leg.matchId && l.bookmaker === leg.bookmaker && !l.teams.some(t => leg.teams.includes(t)));
}

/**
 * Best 2-4 match combination for one tier, or null. Scored on distance from
 * the tier's target odds plus the legs' cost; a small bonus per extra match
 * favours fuller slips when the value is similar.
 */
function bestCombination(pool, tier, used) {
  const legs = pool.filter(l => !used.has(l.matchId)).sort((a, b) => legCost(a) - legCost(b));
  let best = null, bestScore = Infinity;
  const consider = combo => {
    const odds = Number(combo.reduce((p, l) => p * l.price, 1).toFixed(2));
    if (odds < tier.min || odds > tier.max) return;
    const score = Math.abs(Math.log(odds / tier.target)) + combo.reduce((s, l) => s + legCost(l), 0) - 0.03 * (combo.length - 2);
    if (score < bestScore) { best = { odds, legs: combo }; bestScore = score; }
  };
  // Depth-first search; larger slips draw only on the best-value legs to stay fast.
  const limits = { 1: legs.length, 2: legs.length, 3: 45, 4: 25 };
  const extend = (combo, start) => {
    if (combo.length >= 2) consider(combo);
    if (combo.length === 4) return;
    const limit = limits[combo.length + 1];
    for (let i = start; i < Math.min(legs.length, limit); i++) {
      if (compatible(combo, legs[i])) extend([...combo, legs[i]], i + 1);
    }
  };
  extend([], 0);
  return best;
}

/**
 * Build 60/10 slips. Options: `probability(match, leg)` for model value and
 * `teamLeague(teamId)` for the Italian-club rule in the Champions League.
 */
export function buildSlips(account, matches, cash, now = new Date(), options = {}) {
  const previous = account.tickets.filter(t=>t.autoRun);
  const used = new Set(previous.flatMap(t=>t.selections.map(s=>s.matchId)));
  const pool = collectLegs(matches,now,used,options);
  const tickets = [];
  // Optional stake rule (cents) from the bankroll = cash + money on open slips.
  const bankroll = cash + previous.filter(t => t.status === 'pending').reduce((s, t) => s + Math.round(t.stake * 100), 0);
  for (const tier of SLIP_TIERS) {
    const stakeCents = options.stakeFor ? options.stakeFor(tier, bankroll) : tier.stake * 100;
    const open = previous.filter(t => t.status === 'pending' && stakeTier(t) === tier.key).length;
    if (cash < stakeCents || open >= tier.maxOpen) continue;
    const best = bestCombination(pool, tier, used);
    if (!best) continue;
    best.legs.forEach(l=>used.add(l.matchId));
    cash-=stakeCents;
    const stake = stakeCents / 100;
    const value = best.legs.every(l=>l.value) ? best.legs.reduce((p, l) => p * l.value, 1) - 1 : undefined;
    tickets.push({id:crypto.randomUUID(), autoRun:true, source:'ai', strategy:options.strategy || 'slips', tier:tier.key, currency:'RON',
      status:'pending', datePlaced:now.toISOString(), stake,totalOdds:best.odds,
      potentialReturn:Number((stake*best.odds).toFixed(2)),selections:best.legs,
      rationale: best.legs.length+' matches at '+best.odds.toFixed(2)+': '+stake.toFixed(2)+' RON'+
        (value !== undefined ? ' · estimated value '+(value>=0?'+':'')+(value*100).toFixed(1)+'%' : '')});
  }
  return tickets;
}

/** Tier of an existing slip, from its odds (older slips used different ranges). */
function stakeTier(ticket) {
  return Number(ticket.totalOdds) > 3.5 ? 'higher' : 'standard';
}
