// Pricing and staking helpers shared by every AI.

/**
 * Remove the bookmaker margin with the power method: find k so that the
 * implied probabilities raised to k sum to one. Compared with plain
 * normalisation it takes more margin off long shots, which corrects part of
 * the favourite-longshot bias.
 */
export function powerDevig(prices) {
  if (!prices.length || prices.some(p => !Number.isFinite(p) || p <= 1)) return null;
  const implied = prices.map(p => 1 / p);
  const total = implied.reduce((s, q) => s + q, 0);
  if (total < 0.98 || total > 1.25) return null;
  const sum = k => implied.reduce((s, q) => s + q ** k, 0);
  let low = 0.2, high = 10;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (sum(mid) > 1) low = mid; else high = mid;
  }
  const k = (low + high) / 2;
  const probabilities = implied.map(q => q ** k);
  const norm = probabilities.reduce((s, p) => s + p, 0);
  return { probabilities: probabilities.map(p => p / norm), margin: total - 1 };
}

/** Kelly fraction for decimal odds. Returns 0 when there is no edge. */
export function kelly(probability, price) {
  if (!(probability > 0 && probability < 1) || !(price > 1)) return 0;
  return Math.max(0, (probability * price - 1) / (price - 1));
}

/**
 * Fractional Kelly stake in cents. Quarter Kelly keeps most of the growth of
 * full Kelly while sharply reducing drawdowns caused by estimation error.
 */
export function kellyStake({ probability, price, bankroll, fraction = 0.25, cap = 0.03, minimum = 100 }) {
  const share = Math.min(cap, kelly(probability, price) * fraction);
  if (!(share > 0)) return 0;
  const cents = Math.floor(bankroll * share);
  // Multi-match tickets win less often, so Kelly can suggest less than the
  // minimum stake. Any positive edge gets at least the minimum, as long as
  // the minimum itself stays within the cap.
  if (cents < minimum) return minimum <= bankroll * cap ? minimum : 0;
  return cents;
}

/** Shrink a model probability toward the market's fair probability. */
export function blend(model, market, weight = 0.5) {
  if (!Number.isFinite(model)) return market;
  if (!Number.isFinite(market)) return model;
  return weight * model + (1 - weight) * market;
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
