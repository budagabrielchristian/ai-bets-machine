import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBets, legOutcome, oddsBand } from './betAnalysis.js';

const leg = (selection, price, result, extra = {}) => ({ matchTitle: 'Home vs Away', teams: ['Home', 'Away'], selection, price, result, ...extra });
const ticket = (status, stake, legs) => ({ source: 'manual', status, stake, totalOdds: legs.reduce((p, l) => p * l.price, 1),
  potentialReturn: stake * legs.reduce((p, l) => p * l.price, 1), datePlaced: '2026-11-19T10:00Z', settledAt: '2026-11-20T10:00Z', selections: legs });

test('leg outcomes from final scores', () => {
  assert.equal(legOutcome(leg('Home', 1.8, '2-1')), 'won');
  assert.equal(legOutcome(leg('Draw', 3.4, '1–1')), 'won');
  assert.equal(legOutcome(leg('Away', 4, '2-1')), 'lost');
  assert.equal(legOutcome({ ...leg('over', 1.9, '2-1'), market: 'total', side: 'over', line: 2.5 }), 'won');
  assert.equal(legOutcome(leg('Home', 1.8, undefined)), null);
  assert.equal(oddsBand(2.4), '2.00 to 2.99');
});

test('finds that multi-match tickets and draws cost money, and that one leg broke tickets', () => {
  const tickets = [
    ticket('won', 10, [leg('Home', 1.8, '2-0')]),
    ticket('won', 10, [leg('Home', 1.7, '1-0')]),
    ticket('lost', 10, [leg('Home', 1.9, '0-1')]),
    ticket('lost', 10, [leg('Home', 1.6, '2-0'), leg('Draw', 3.3, '2-1')]),
    ticket('lost', 10, [leg('Home', 1.6, '3-1'), leg('Away', 3.5, '1-0')]),
    ticket('lost', 10, [leg('Draw', 3.2, '1-0'), leg('Home', 1.5, '2-0'), leg('Home', 1.4, '1-0')]),
    ticket('pending', 5, [leg('Home', 2, undefined)]),
  ];
  const a = analyzeBets(tickets, Date.parse('2026-11-21T00:00Z'));
  assert.equal(a.summary.count, 6);
  assert.equal(a.summary.open, 1);
  assert.equal(a.summary.won, 2);
  assert.ok(Math.abs(a.summary.profit - (8 + 7 - 10 - 10 - 10 - 10)) < 1e-9);
  assert.equal(a.lostByOne.length, 3, 'each multi-match ticket lost on exactly one match');
  assert.deepEqual(a.bySize.map(g => g.label), ['Singles', '2 matches', '3+ matches']);
  assert.ok(a.tips.some(t => /multi-match/.test(t.text)), 'suggests fewer legs');
  assert.ok(a.tips.some(t => /single match/.test(t.text)), 'reports tickets broken by one match');
  const draw = a.byPick.find(g => g.label === 'Draw');
  assert.equal(draw.count, 2);
  assert.equal(draw.won, 0);
});

test('value and model checks use the numbers captured at bet time', () => {
  const mk = (won, fair, model) => ticket(won ? 'won' : 'lost', 10, [leg('Home', 2, won ? '1-0' : '0-1', { marketProbability: fair, modelProbability: model })]);
  const tickets = [mk(false, 0.45, 0.35), mk(false, 0.45, 0.36), mk(false, 0.46, 0.38), mk(true, 0.47, 0.52), mk(true, 0.47, 0.5), mk(true, 0.48, 0.55)];
  const a = analyzeBets(tickets);
  assert.equal(a.value.legs, 6);
  assert.ok(a.value.negativeShare > 0.9, 'all priced below the fair chance (price 2.00, fair under 50%)');
  assert.deepEqual([a.modelCheck.disagreed, a.modelCheck.disagreedWon, a.modelCheck.agreed, a.modelCheck.agreedWon], [3, 0, 3, 3]);
  assert.ok(a.tips.some(t => /AI models rated your pick lower/.test(t.text)));
  assert.ok(a.tips.some(t => /below the fair market chance/.test(t.text)));
});

test('with no settled bets it says so instead of guessing', () => {
  const a = analyzeBets([ticket('pending', 5, [leg('Home', 2)])]);
  assert.equal(a.tips.length, 1);
  assert.match(a.tips[0].text, /after a few settled bets/);
});
