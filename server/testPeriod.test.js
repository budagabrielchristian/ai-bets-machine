import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TEST_PERIOD = '1';
process.env.NTFY_TOPIC = '';
const { testTick, summaryLines, readTestConfig } = await import('./testPeriod.js');

const DAY = 86400000;
function setup() {
  const state = { ais: Object.fromEntries(['favorites', 'price', 'slips', 'elo', 'poisson', 'manual'].map(k => [k, { season: 1, deposit: 20000 }])), tickets: [] };
  const seasons = [];
  const newSeason = key => { state.ais[key].season++; seasons.push(key); };
  const walletTickets = key => state.tickets.filter(t => (key === 'manual' ? t.source === 'manual' : t.strategy === key) && t.season === state.ais[key].season);
  return { state, seasons, newSeason, walletTickets };
}

test('the repo config defines a 30-day test', () => {
  assert.deepEqual(readTestConfig(), { id: 'month-1', days: 30 });
});

test('a test starts a clean season for everyone, then stops new bets after 30 days', async () => {
  const ctx = setup();
  const t0 = Date.parse('2026-11-19T09:00Z');
  assert.equal(await testTick({ ...ctx, now: t0 }), true);
  assert.deepEqual(ctx.seasons.sort(), ['elo', 'favorites', 'manual', 'poisson', 'price', 'slips']);
  assert.equal(ctx.state.test.end, t0 + 30 * DAY);
  // Same id again: no second reset.
  assert.equal(await testTick({ ...ctx, now: t0 + DAY }), true);
  assert.equal(ctx.seasons.length, 6);
  // Weekly summary bookkeeping.
  await testTick({ ...ctx, now: t0 + 7 * DAY + 1 });
  assert.equal(ctx.state.test.lastWeekly, t0 + 7 * DAY + 1);
  // After the end: no new bets; final report waits for open tickets.
  ctx.state.tickets.push({ strategy: 'elo', season: 2, status: 'pending', stake: 2, totalOdds: 3, potentialReturn: 6, selections: [], datePlaced: new Date(t0).toISOString() });
  assert.equal(await testTick({ ...ctx, now: t0 + 30 * DAY }), false);
  assert.equal(ctx.state.test.finished, false);
  ctx.state.tickets[0].status = 'won';
  ctx.state.tickets[0].settledAt = new Date(t0 + 30 * DAY).toISOString();
  assert.equal(await testTick({ ...ctx, now: t0 + 30 * DAY + 3600000 }), false);
  assert.equal(ctx.state.test.finished, true);
});

test('summary ranks accounts by profit', () => {
  const ctx = setup();
  const t = (strategy, status, stake, odds) => ({ strategy, season: 1, status, stake, totalOdds: odds, potentialReturn: stake * odds, selections: [], datePlaced: '2026-11-19T09:00Z', settledAt: '2026-11-20T09:00Z' });
  ctx.state.tickets.push(t('favorites', 'lost', 4, 2), t('elo', 'won', 2, 3));
  const lines = summaryLines(ctx.state, ctx.walletTickets);
  assert.match(lines[0], /^1\. Elo ratings: \+4\.00 RON · ROI \+200\.0% · 1W-0L/);
  assert.match(lines.at(-1), /^5\. Favorites: −4\.00 RON/, 'biggest loss last');
  assert.equal(lines.length, 5, 'five AIs; manual account hidden when it has no tickets');
});
