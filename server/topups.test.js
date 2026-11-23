import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTopUps } from './topups.js';
import { aiStats } from '../src/services/aiStats.js';

const list = [{ id: 'slips-1', ai: 'slips', amount: 200 }];
const fresh = () => ({ ais: { slips: { season: 1, deposit: 20000, lastScan: 5 } } });

test('a top-up is added once, online only, in the same season', () => {
  const state = fresh();
  assert.deepEqual(applyTopUps(state, { list, online: false }), []);
  assert.equal(state.ais.slips.deposit, 20000);
  assert.equal(applyTopUps(state, { list, online: true }).length, 1);
  assert.equal(state.ais.slips.deposit, 40000);
  assert.equal(state.ais.slips.season, 1);
  assert.equal(state.ais.slips.lastScan, 0);
  assert.equal(applyTopUps(state, { list, online: true }).length, 0); // never twice
  assert.equal(state.ais.slips.deposit, 40000);
  assert.deepEqual(applyTopUps(fresh(), { list: [{ id: 'x', ai: 'nobody', amount: 200 }, { id: 'y', ai: 'slips', amount: -5 }], online: true }), []);
});

test('earlier losses stay on the record after a top-up', () => {
  const lost = { status: 'lost', stake: 60, potentialReturn: 150, totalOdds: 2.5, datePlaced: '2026-11-20T10:00Z', settledAt: '2026-11-21T10:00Z', selections: [] };
  const s = aiStats([lost, { ...lost }, { ...lost, stake: 70 }], 400);
  assert.equal(s.profit, -190);
  assert.equal(s.balance, 210);
});
