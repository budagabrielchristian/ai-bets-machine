import { fixtureDay } from './fixtureDay.js';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2;
}

function readQuotes(match, now) {
  const names = [match.home_team, 'Draw', match.away_team];
  const sources = new Map();
  for (const book of match.bookmakers || []) {
    const market = book?.markets?.find(m => m.key === 'h2h');
    if (market?.outcomes?.length !== 3) continue;
    const prices = names.map(name => market.outcomes.find(o => o.name === name)?.price);
    if (!prices.every(price => Number.isFinite(price) && price > 1)) continue;
    const name = book.title || book.key;
    if (!name) continue;
    const timestamp = market.last_update || book.last_update;
    const updated = timestamp ? Date.parse(timestamp) : 0;
    if (timestamp && (!Number.isFinite(updated) || now - updated > 3600000 || updated > now + 60000)) continue;
    const raw = prices.map(price => 1 / price);
    const total = raw.reduce((sum, p) => sum + p, 0);
    // Screen out anomalous books before comparing prices across providers.
    if (total < 0.99 || total > 1.20) continue;
    const key = name.trim().toLowerCase();
    if (sources.has(key) && sources.get(key).updated >= updated) continue;
    sources.set(key, { name, prices, updated, probabilities: raw.map(p => p / total), margin: total - 1 });
  }
  return [...sources.values()];
}

function compare(a, b) {
  return b.rankingProbability - a.rankingProbability || b.probability - a.probability ||
    a.match.commence_time.localeCompare(b.match.commence_time) || a.selection.localeCompare(b.selection);
}

export function rankMarkets(matches, profile, volume, timeframe, now = new Date()) {

  const priceCheck = profile === 'price';
  const order = priceCheck ? (a,b) => b.expectedReturn - a.expectedReturn || compare(a,b) : compare;
  const picks = [];
  for (const match of matches) {
    const start = new Date(match.commence_time);
    if (match.archived || !(start > now) || (match.statusName && match.statusName !== 'STATUS_SCHEDULED')) continue;
    if (timeframe === 'today' && fixtureDay(start) !== fixtureDay(now)) continue;
    const quotes = readQuotes(match, now);
    if (!quotes.length) continue;
    const names = [match.home_team, 'Draw', match.away_team];
    const centers = names.map((_, i) => median(quotes.map(q => q.probabilities[i])));
    const sum = centers.reduce((total, p) => total + p, 0);
    const candidates = [];
    for (const [i, selection] of names.entries()) {
      const probability = centers[i] / sum;
      const band = probability >= .6 ? 'safe' : probability >= .4 ? 'balanced' : 'outsider';
      if (!priceCheck && band !== (profile === 'value' ? 'outsider' : profile)) continue;
      const best = quotes.reduce((a, b) => b.prices[i] > a.prices[i] ? b : a);
      const low = Math.min(...quotes.map(q => q.probabilities[i]));
      const high = Math.max(...quotes.map(q => q.probabilities[i]));
      // Rank by the least optimistic quote, discounted by the typical pricing margin.
      // This is a sorting heuristic, not a statistical confidence bound.
      const margin = median(quotes.map(q => q.margin));
      const rankingProbability = Math.min(low, probability) / (1 + Math.max(0, margin));
      let referenceProbability;
      let expectedReturn;
      if (priceCheck) {
        // The provider offering the price cannot also supply its own benchmark.
        const references = quotes.filter(q => q !== best && q.margin <= .08);
        if (!references.length || margin > .08 || high - low > .08) continue;
        referenceProbability = Math.min(...references.map(q => q.probabilities[i]));
        expectedReturn = best.prices[i] * referenceProbability - 1;
        if (expectedReturn < .02) continue;
      }
      candidates.push({ match, selection, price: best.prices[i], bookmaker: best.name, probability,
        referenceProbability, expectedReturn,
        rankingProbability, bookCount: quotes.length, spread: high - low, margin });
    }
    if (candidates.length) picks.push(candidates.sort(order)[0]);
  }
  return picks.sort(order).slice(0, volume);
}

export function describePick(pick) {
  const evidence = pick.bookCount === 1 ? 'Single bookmaker' :
    pick.bookCount + ' bookmakers · ' + (pick.spread * 100).toFixed(1) + ' percentage points apart';
  return evidence + ' · ' + (pick.margin * 100).toFixed(1) + '% typical margin · price from ' + pick.bookmaker;
}
