// Team-strength models learned from past results.
// A result is {date (ms), league, homeId, awayId, homeScore, awayScore}.

const DAY = 86400000;
const sigmoid = x => 1 / (1 + Math.exp(-x));

/* ---------------------------------------------------------------- Elo --- */

export const ELO = { start: 1500, k: 20, home: 60 };

function marginMultiplier(goalDifference) {
  const gd = Math.abs(goalDifference);
  return gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;
}

/**
 * Walk forward through results in date order. Each game is rated with the
 * ratings known before kickoff, so the calibration below never sees the
 * future. Returns the final ratings plus pre-match differences for fitting.
 */
export function runElo(results) {
  const ratings = new Map();
  const samples = [];
  const games = new Map();
  const get = id => ratings.get(id) ?? ELO.start;
  for (const r of results) {
    const home = get(r.homeId), away = get(r.awayId);
    const diff = home + ELO.home - away;
    const seen = Math.min(games.get(r.homeId) || 0, games.get(r.awayId) || 0);
    if (seen >= 8) samples.push({ diff, outcome: r.homeScore > r.awayScore ? 0 : r.homeScore === r.awayScore ? 1 : 2 });
    const expected = 1 / (1 + 10 ** (-diff / 400));
    const actual = r.homeScore > r.awayScore ? 1 : r.homeScore === r.awayScore ? 0.5 : 0;
    const change = ELO.k * marginMultiplier(r.homeScore - r.awayScore) * (actual - expected);
    ratings.set(r.homeId, home + change);
    ratings.set(r.awayId, away - change);
    games.set(r.homeId, (games.get(r.homeId) || 0) + 1);
    games.set(r.awayId, (games.get(r.awayId) || 0) + 1);
  }
  return { ratings, games, samples };
}

/**
 * Ordered-logit mapping from Elo difference to home/draw/away, fitted by
 * gradient ascent on the walk-forward samples. Three parameters:
 * P(away) = s(a - b*d), P(away or draw) = s(c - b*d), with d = diff / 100.
 */
export function fitOutcomeCurve(samples, iterations = 300) {
  let a = -0.85, c = 0.2, b = 0.35;
  if (samples.length < 200) return { a, c, b, samples: samples.length };
  for (let it = 0; it < iterations; it++) {
    let ga = 0, gc = 0, gb = 0;
    for (const { diff, outcome } of samples) {
      const d = diff / 100;
      const s1 = sigmoid(a - b * d), s2 = sigmoid(c - b * d);
      let du1 = 0, du2 = 0;
      if (outcome === 2) du1 = 1 - s1;
      else if (outcome === 0) du2 = -s2;
      else {
        const p = Math.max(1e-9, s2 - s1);
        du2 = s2 * (1 - s2) / p;
        du1 = -s1 * (1 - s1) / p;
      }
      ga += du1; gc += du2; gb -= d * (du1 + du2);
    }
    const n = samples.length;
    a += 1.5 * ga / n; c += 1.5 * gc / n; b += 1.5 * gb / n;
    if (c < a + 0.05) c = a + 0.05;
  }
  return { a, c, b, samples: samples.length };
}

export function eloProbabilities(model, homeId, awayId) {
  const { ratings, games, curve } = model;
  if ((games.get(homeId) || 0) < 15 || (games.get(awayId) || 0) < 15) return null;
  const d = (ratings.get(homeId) + ELO.home - ratings.get(awayId)) / 100;
  const away = sigmoid(curve.a - curve.b * d);
  const notHome = sigmoid(curve.c - curve.b * d);
  return { home: 1 - notHome, draw: notHome - away, away };
}

/* ---------------------------------------------------- Poisson (Dixon-Coles) --- */

export const POISSON = { halfLifeDays: 180, prior: 2, rho: -0.06, minGames: 10, minLeagueGames: 100, maxGoals: 10 };

/**
 * Fit attack and defence strengths for one league with time-weighted Poisson
 * maximum likelihood (coordinate ascent). A small prior shrinks teams with
 * few games toward the league average.
 */
export function fitPoissonLeague(results, now) {
  const teams = new Map();
  const team = id => {
    if (!teams.has(id)) teams.set(id, { attack: 0, defence: 0, games: 0 });
    return teams.get(id);
  };
  const decay = Math.LN2 / (POISSON.halfLifeDays * DAY);
  const games = results.map(r => {
    team(r.homeId).games++; team(r.awayId).games++;
    return { ...r, w: Math.exp(-decay * Math.max(0, now - r.date)) };
  });
  const totalW = games.reduce((s, g) => s + g.w, 0);
  if (games.length < POISSON.minLeagueGames || totalW <= 0) return null;
  let mu = Math.log(Math.max(0.3, games.reduce((s, g) => s + g.w * (g.homeScore + g.awayScore), 0) / (2 * totalW)));
  let home = 0.2;
  const mean = Math.exp(mu);
  for (let it = 0; it < 40; it++) {
    for (const key of ['attack', 'defence']) {
      const num = new Map(), den = new Map();
      for (const g of games) {
        const h = teams.get(g.homeId), a = teams.get(g.awayId);
        if (key === 'attack') {
          add(num, g.homeId, g.w * g.homeScore); add(den, g.homeId, g.w * Math.exp(mu + home + a.defence));
          add(num, g.awayId, g.w * g.awayScore); add(den, g.awayId, g.w * Math.exp(mu + h.defence));
        } else {
          add(num, g.awayId, g.w * g.homeScore); add(den, g.awayId, g.w * Math.exp(mu + home + h.attack));
          add(num, g.homeId, g.w * g.awayScore); add(den, g.homeId, g.w * Math.exp(mu + a.attack));
        }
      }
      for (const [id, t] of teams) {
        const n = (num.get(id) || 0) + POISSON.prior * mean;
        const d = (den.get(id) || 0) + POISSON.prior * mean;
        t[key] = Math.log(n / d);
      }
      const centre = [...teams.values()].reduce((s, t) => s + t[key], 0) / teams.size;
      for (const t of teams.values()) t[key] -= centre;
    }
    let hn = 0, hd = 0, mn = 0, md = 0;
    for (const g of games) {
      const h = teams.get(g.homeId), a = teams.get(g.awayId);
      hn += g.w * g.homeScore; hd += g.w * Math.exp(mu + h.attack + a.defence);
      mn += g.w * (g.homeScore + g.awayScore);
      md += g.w * (Math.exp(home + h.attack + a.defence) + Math.exp(a.attack + h.defence));
    }
    home = Math.max(-0.2, Math.min(0.6, Math.log(hn / hd)));
    mu = Math.log(mn / md);
  }
  return { mu, home, teams, games: games.length };
}

function add(map, key, value) { map.set(key, (map.get(key) || 0) + value); }

function poissonRow(rate, max) {
  const row = [Math.exp(-rate)];
  for (let k = 1; k <= max; k++) row.push(row[k - 1] * rate / k);
  return row;
}

/** Dixon-Coles score matrix with the low-score dependence correction. */
export function scoreMatrix(homeRate, awayRate, rho = POISSON.rho, max = POISSON.maxGoals) {
  const h = poissonRow(homeRate, max), a = poissonRow(awayRate, max);
  const m = h.map(ph => a.map(pa => ph * pa));
  m[0][0] *= 1 - homeRate * awayRate * rho;
  m[0][1] *= 1 + homeRate * rho;
  m[1][0] *= 1 + awayRate * rho;
  m[1][1] *= 1 - rho;
  const total = m.flat().reduce((s, p) => s + p, 0);
  return m.map(row => row.map(p => p / total));
}

export function poissonPrediction(fit, homeId, awayId) {
  const h = fit?.teams.get(homeId), a = fit?.teams.get(awayId);
  if (!h || !a || h.games < POISSON.minGames || a.games < POISSON.minGames) return null;
  const homeRate = Math.exp(fit.mu + fit.home + h.attack + a.defence);
  const awayRate = Math.exp(fit.mu + a.attack + h.defence);
  return { homeRate, awayRate, matrix: scoreMatrix(homeRate, awayRate) };
}

/** Probability of a market outcome under a score matrix. */
export function marketProbability(matrix, { market, side, line }) {
  let p = 0;
  for (let h = 0; h < matrix.length; h++) for (let a = 0; a < matrix[h].length; a++) {
    let hit;
    if (market === 'h2h') hit = side === 'home' ? h > a : side === 'away' ? a > h : h === a;
    else if (market === 'total') hit = side === 'over' ? h + a > line : h + a < line;
    else if (market === 'handicap') hit = (side === 'home' ? h - a : a - h) + line > 0;
    if (hit) p += matrix[h][a];
  }
  return p;
}

/* ---------------------------------------------------------- Combined --- */

/** Build every model from the cached results. */
export function buildModels(results, now = Date.now()) {
  const sorted = [...results].sort((x, y) => x.date - y.date);
  const elo = runElo(sorted);
  const curve = fitOutcomeCurve(elo.samples);
  const recent = sorted.filter(r => now - r.date <= 400 * DAY);
  const byLeague = new Map();
  const leagueCount = new Map();
  for (const r of recent) {
    if (!byLeague.has(r.league)) byLeague.set(r.league, []);
    byLeague.get(r.league).push(r);
    for (const id of [r.homeId, r.awayId]) {
      if (!leagueCount.has(id)) leagueCount.set(id, new Map());
      add(leagueCount.get(id), r.league, 1);
    }
  }
  const leagues = new Map();
  for (const [league, games] of byLeague) {
    const fit = fitPoissonLeague(games, now);
    if (fit) leagues.set(league, fit);
  }
  // A team's home league is where it played most of its recent games.
  const homeLeague = new Map();
  for (const [id, counts] of leagueCount) {
    homeLeague.set(id, [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0]);
  }
  return {
    fittedAt: now, results: results.length,
    elo: { ratings: elo.ratings, games: elo.games, curve },
    leagues, homeLeague,
  };
}

/** Model probabilities for one fixture, or null if the teams are unknown. */
export function predict(models, match) {
  if (!models || !match.homeId || !match.awayId) return null;
  const elo = eloProbabilities(models.elo, match.homeId, match.awayId);
  let fit = models.leagues.get(match.league);
  let poisson = poissonPrediction(fit, match.homeId, match.awayId);
  if (!poisson) {
    // Cup games: fall back to the shared domestic league when both teams play in it.
    const shared = models.homeLeague.get(match.homeId);
    if (shared && shared === models.homeLeague.get(match.awayId)) {
      fit = models.leagues.get(shared);
      poisson = poissonPrediction(fit, match.homeId, match.awayId);
    }
  }
  if (!elo && !poisson) return null;
  return { elo, poisson };
}
