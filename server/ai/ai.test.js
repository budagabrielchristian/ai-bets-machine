import test from 'node:test';
import assert from 'node:assert/strict';
import { kelly, kellyStake, powerDevig } from './math.js';
import { buildModels, fitOutcomeCurve, marketProbability, predict, scoreMatrix } from './ratings.js';
import { AI, readOptions } from './strategies.js';
import { aiStats } from '../../src/services/aiStats.js';
import { totp } from '../auth.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('power devig sums to one and takes more margin off the long shot', () => {
  const { probabilities, margin } = powerDevig([1.5, 4.2, 7.0]);
  assert.ok(close(probabilities.reduce((s, p) => s + p, 0), 1));
  assert.ok(margin > 0.04 && margin < 0.06);
  const naive = [1 / 1.5, 1 / 4.2, 1 / 7].map(q => q / (1 + margin));
  assert.ok(probabilities[0] > naive[0], 'favourite keeps more probability');
  assert.ok(probabilities[2] < naive[2], 'long shot loses more probability');
  assert.equal(powerDevig([1.5, 0.9]), null);
});

test('kelly fraction and capped quarter-Kelly stake', () => {
  assert.ok(close(kelly(0.6, 2.1), (0.6 * 2.1 - 1) / 1.1));
  assert.equal(kelly(0.4, 2), 0);
  assert.equal(kellyStake({ probability: 0.6, price: 2.1, bankroll: 20000 }), 600); // 3% cap
  assert.equal(kellyStake({ probability: 0.52, price: 2, bankroll: 20000 }), 200); // full Kelly 4%, quarter = 1%
  assert.equal(kellyStake({ probability: 0.5, price: 2, bankroll: 20000 }), 0);
});

test('Dixon-Coles matrix is a distribution and markets are consistent', () => {
  const m = scoreMatrix(1.6, 1.1);
  assert.ok(close(m.flat().reduce((s, p) => s + p, 0), 1));
  const h = marketProbability(m, { market: 'h2h', side: 'home' });
  const d = marketProbability(m, { market: 'h2h', side: 'draw' });
  const a = marketProbability(m, { market: 'h2h', side: 'away' });
  assert.ok(close(h + d + a, 1) && h > a);
  const over = marketProbability(m, { market: 'total', side: 'over', line: 2.5 });
  const under = marketProbability(m, { market: 'total', side: 'under', line: 2.5 });
  assert.ok(close(over + under, 1));
  // Home -0.5 is the same bet as a home win.
  assert.ok(close(marketProbability(m, { market: 'handicap', side: 'home', line: -0.5 }), h));
});

// A synthetic league where team strength is known: lower id = stronger.
function season(seed = 7) {
  let x = seed;
  const rand = () => (x = (x * 16807) % 2147483647) / 2147483647;
  const poisson = rate => { let k = 0, p = Math.exp(-rate), s = p; const u = rand(); while (u > s) { k++; p *= rate / k; s += p; } return k; };
  const teams = Array.from({ length: 12 }, (_, i) => ({ id: String(i), strength: 0.5 - i * 0.08 }));
  const results = [];
  const start = Date.parse('2026-01-01');
  let day = 0;
  for (let round = 0; round < 4; round++) for (const h of teams) for (const a of teams) {
    if (h === a) continue;
    results.push({ date: start + (day++) * 3600000 * 6, league: '700', homeId: h.id, awayId: a.id,
      homeScore: poisson(Math.exp(0.25 + 0.2 + h.strength - a.strength)), awayScore: poisson(Math.exp(0.25 + a.strength - h.strength)) });
  }
  return { results, end: start + day * 3600000 * 6 };
}

test('models learn that stronger teams are more likely to win', () => {
  const { results, end } = season();
  const models = buildModels(results, end);
  assert.ok(models.leagues.get('700'), 'league fitted');
  const fit = models.leagues.get('700');
  assert.ok(fit.home > 0, 'home advantage positive');
  assert.ok(fit.teams.get('0').attack > fit.teams.get('11').attack);
  const p = predict(models, { homeId: '0', awayId: '11', league: '700' });
  assert.ok(p.elo.home > 0.5 && p.elo.home > p.elo.away);
  assert.ok(marketProbability(p.poisson.matrix, { market: 'h2h', side: 'home' }) > 0.6);
  assert.ok(close(p.elo.home + p.elo.draw + p.elo.away, 1));
});

test('outcome curve stays ordered with few samples', () => {
  const c = fitOutcomeCurve([]);
  assert.ok(c.c > c.a);
});

function fixture(id, prices, homeId, awayId, extra = {}) {
  return { id, league: '700', homeId, awayId, home_team: 'H' + id, away_team: 'A' + id, sport_title: 'Test',
    commence_time: new Date(Date.parse('2026-11-14T12:00Z') + 3 * 3600000).toISOString(), statusName: 'STATUS_SCHEDULED',
    bookmakers: [{ title: 'Book', markets: [{ key: 'h2h', outcomes: [{ name: 'H' + id, price: prices[0] }, { name: 'Draw', price: prices[1] }, { name: 'A' + id, price: prices[2] }] }] }],
    ...extra };
}

test('model AIs bet only on value and respect one bet per fixture', () => {
  const { results, end } = season();
  const models = buildModels(results, end);
  const now = Date.parse('2026-11-14T12:00Z');
  const p = predict(models, { homeId: '3', awayId: '6', league: '700' }).elo;
  // Market rates the home side 9 points below the model, with a 3% margin: moderate value.
  const market = [p.home - 0.09, p.draw, 1 - (p.home - 0.09) - p.draw];
  const prices = market.map(x => Number((1 / (x * 1.03)).toFixed(2)));
  const matches = [fixture('1', prices, '3', '6'), fixture('4', prices, '3', '6'), fixture('2', [1.05, 15, 30], '0', '11')];
  const wallet = { deposit: 20000, tickets: [] };
  const elo = AI.elo.run(wallet, matches, { now, models });
  assert.equal(elo.length, 1, 'one ticket from the two value picks, overpriced favourite skipped');
  assert.deepEqual(elo[0].selections.map(s => s.selection).sort(), ['H1', 'H4']);
  assert.ok(elo[0].stake > 0 && elo[0].stake <= 6, 'stake capped at 3% of 200');
  assert.ok(elo[0].selections.every(s => s.edge >= 0.03));
  assert.equal(AI.elo.run(wallet, [matches[0]], { now, models }).length, 0, 'a single pick is never a ticket on its own');
  assert.equal(AI.elo.run({ deposit: 20000, tickets: elo }, matches, { now, models }).length, 0, 'no repeat on same fixture');
  assert.equal(AI.poisson.run(wallet, [matches[1]], { now, models }).length, 0, 'no bet without edge');
  // Strong favourite priced as an outsider: the gap is too large to trust.
  assert.equal(AI.elo.run(wallet, [fixture('3', [4.5, 3.6, 1.8], '0', '11')], { now, models }).length, 0, 'disagreement cap');
});

test('picks are combined into multi-match tickets; never a single', () => {
  const now = Date.parse('2026-11-14T12:00Z');
  const pinnacle = id => ({ title: 'Pinnacle', markets: [{ key: 'h2h', outcomes: [{ name: 'H' + id, price: 1.95 }, { name: 'Draw', price: 3.6 }, { name: 'A' + id, price: 4.2 }] }] });
  const valueGame = (id, hoursAhead) => {
    const m = fixture(id, [2.3, 3.3, 3.3], '1', '2', { commence_time: new Date(now + hoursAhead * 3600000).toISOString() });
    m.bookmakers.push(pinnacle(id));
    return m;
  };
  const wallet = () => ({ deposit: 20000, tickets: [] });
  const [ticket, ...rest] = AI.price.run(wallet(), [valueGame('a', 5), valueGame('b', 6), valueGame('c', 7)], { now });
  // Three picks at 2.30 would be 12.17, above the 12.00 cap: two go on one
  // ticket and the third (kickoff in 7 hours) waits for a partner.
  assert.equal(rest.length, 0);
  assert.equal(ticket.selections.length, 2, 'two picks on one ticket');
  assert.equal(ticket.totalOdds, 5.29);
  assert.equal(new Set(ticket.selections.map(s => s.matchId)).size, 2);
  assert.ok(ticket.selections.every(s => s.rationale), 'each match keeps its reason');
  assert.equal(AI.price.run(wallet(), [valueGame('d', 8)], { now }).length, 0, 'lone pick waits');
  assert.equal(AI.price.run(wallet(), [valueGame('e', 1)], { now }).length, 0, 'even close to kickoff, never a single');
});

test('value hunter needs a second bookmaker', () => {
  const now = Date.parse('2026-11-14T12:00Z');
  const games = ['8', '9'].map(id => fixture(id, [2.3, 3.3, 3.3], '1', '2'));
  assert.equal(AI.price.run({ deposit: 20000, tickets: [] }, games, { now }).length, 0);
  for (const [i, m] of games.entries()) m.bookmakers.push({ title: 'Pinnacle', markets: [{ key: 'h2h', outcomes: [{ name: 'H' + (8 + i), price: 1.95 }, { name: 'Draw', price: 3.6 }, { name: 'A' + (8 + i), price: 4.2 }] }] });
  const [t] = AI.price.run({ deposit: 20000, tickets: [] }, games, { now });
  assert.ok(t.selections.every(s => s.bookmaker === 'Book'), 'bets at the soft book, never at Pinnacle');
  assert.deepEqual(t.selections.map(s => s.selection).sort(), ['H8', 'H9']);
  assert.equal(readOptions(games[0], now).length, 6);
});

test('stats track profit, drawdown and closing line value', () => {
  const t = (status, stake, odds, extra = {}) => ({ status, stake, totalOdds: odds, potentialReturn: stake * odds,
    datePlaced: '2026-11-01T10:00Z', settledAt: extra.at, selections: [{ price: odds, closingPrice: extra.close, matchDate: '2026-11-01T12:00Z' }] });
  const s = aiStats([t('won', 10, 2, { at: '2026-11-01T14:00Z', close: 1.8 }), t('lost', 20, 1.5, { at: '2026-11-02T14:00Z', close: 1.5 }),
    t('pending', 5, 3)], 200, Date.parse('2026-11-03T00:00Z'));
  assert.equal(s.profit, -10);
  assert.equal(s.balance, 190);
  assert.equal(s.reserved, 5);
  assert.equal(s.won, 1);
  assert.equal(s.lost, 1);
  assert.ok(close(s.drawdown, 20 / 210));
  assert.ok(close(s.clv, (2 / 1.8 - 1) / 2));
  assert.equal(s.streak, -1);
});

test('TOTP matches the RFC 6238 test vector', () => {
  // Secret "12345678901234567890" in base32, time 59s -> 94287082 (8 digits) -> 287082 (6 digits).
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), '287082');
});

test('new variants: favourite singles and scaled 60/10 stakes', () => {
  const now = Date.parse('2026-11-14T12:00Z');
  const fav = id => fixture(id, [1.45, 4.4, 7.5], 'x' + id, 'y' + id);
  const singles = AI.favSingles.run({ deposit: 20000, tickets: [] }, [fav('f1'), fav('f2')], { now, models: null });
  assert.ok(singles.length >= 1);
  assert.ok(singles.every(t => t.selections.length === 1 && t.strategy === 'favSingles'));
  assert.equal(AI.favorites.run({ deposit: 20000, tickets: [] }, [fav('f1'), fav('f2')], { now, models: null })[0].selections.length, 2,
    'the original Favorites still combines');
});
