import test from 'node:test';
import assert from 'node:assert/strict';
import { settleExtra } from './legRules.js';
import { grade } from './practice.js';
import { legOutcome } from './betAnalysis.js';

const s = (home, away, htHome, htAway) => ({ home, away, htHome, htAway });

test('full-time extra markets', () => {
  assert.equal(settleExtra({ market: 'btts', side: 'yes' }, s(2, 1)), 'won');
  assert.equal(settleExtra({ market: 'btts', side: 'yes' }, s(2, 0)), 'lost');
  assert.equal(settleExtra({ market: 'btts', side: 'no' }, s(0, 0)), 'won');
  assert.equal(settleExtra({ market: 'double', side: 'homeDraw' }, s(1, 1)), 'won');
  assert.equal(settleExtra({ market: 'double', side: 'drawAway' }, s(2, 1)), 'lost');
  assert.equal(settleExtra({ market: 'double', side: 'homeAway' }, s(0, 0)), 'lost');
  assert.equal(settleExtra({ market: 'team_total', team: 'home', side: 'over', line: 1.5 }, s(2, 0)), 'won');
  assert.equal(settleExtra({ market: 'team_total', team: 'away', side: 'over', line: 1.5 }, s(2, 1)), 'lost');
});

test('half-time markets wait for the half-time score, and refund when it never comes', () => {
  const htOver = { market: 'ht_total', side: 'over', line: 0.5 };
  assert.equal(settleExtra(htOver, s(1, 0)), null);
  assert.equal(settleExtra(htOver, s(1, 0, 0, 0)), 'lost');
  assert.equal(settleExtra(htOver, s(1, 0, 1, 0)), 'won');
  assert.equal(settleExtra(htOver, s(1, 0, null, null)), 'void');
  assert.equal(settleExtra({ market: 'ht_h2h', side: 'draw' }, s(3, 1, 1, 1)), 'won');
  // Pauza sau Final: a full-time win is enough on its own.
  const hof = { market: 'half_or_full', team: 'home' };
  assert.equal(settleExtra(hof, s(2, 1)), 'won');
  assert.equal(settleExtra(hof, s(1, 1)), null);
  assert.equal(settleExtra(hof, s(1, 1, 1, 0)), 'won');
  assert.equal(settleExtra(hof, s(1, 2, 0, 0)), 'lost');
});

test('tickets with extra markets grade, and the analysis reads them', () => {
  const ticket = { selections: [
    { matchId: 'a', market: 'btts', side: 'yes' },
    { matchId: 'b', market: 'half_or_full', team: 'away' },
  ] };
  const final = { a: { homeScore: 1, awayScore: 1 }, b: { homeScore: 1, awayScore: 1 } };
  assert.equal(grade(ticket, final), 'pending');
  assert.equal(grade(ticket, { ...final, b: { ...final.b, htHome: 0, htAway: 1 } }), 'won');
  assert.equal(legOutcome({ market: 'ht_total', side: 'under', line: 1.5, result: '3–1', halfTime: '1–0' }), 'won');
  assert.equal(legOutcome({ market: 'ht_total', side: 'under', line: 1.5, result: '3–1' }), null);
});
