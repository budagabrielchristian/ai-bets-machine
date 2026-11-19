import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NTFY_TOPIC = 'unit-test-topic';
process.env.NTFY_DIGEST_HOURS = '4';
const sent = [];
globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; };
const { notifyChanges } = await import('./notify.js');

const H = 3600000;
const t = (strategy, status, stake, odds) => ({ source: 'ai', strategy, status, stake, totalOdds: odds, potentialReturn: stake * odds, selections: [] });

test('digest: one summary after 4 hours, nothing in between', async () => {
  const state = {};
  const t0 = Date.parse('2026-11-19T12:00Z');
  await notifyChanges({ state, now: t0, placed: [t('elo', 'pending', 2, 3), t('elo', 'pending', 1, 5)], settled: [] });
  await notifyChanges({ state, now: t0 + 2 * H, placed: [], settled: [t('elo', 'won', 2, 3), t('favorites', 'lost', 4, 2)] });
  assert.equal(sent.length, 0, 'no message before 4 hours');
  await notifyChanges({ state, now: t0 + 4 * H, placed: [t('slips', 'pending', 60, 2.5)], settled: [] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'Last 4h: +0.00 RON (2 settled)');
  assert.match(sent[0].message, /^Elo ratings: 2 placed · 1 won → \+4\.00 RON/);
  assert.match(sent[0].message, /Favorites: 1 lost → −4\.00 RON$/);
  // A quiet period sends nothing.
  await notifyChanges({ state, now: t0 + 8 * H, placed: [], settled: [] });
  assert.equal(sent.length, 1);
});

test('instant mode: one grouped message per pass with activity', async () => {
  delete process.env.NTFY_DIGEST_HOURS;
  const { config } = await import('./config.js');
  config.ntfyDigestHours = 0;
  sent.length = 0;
  const state = {};
  await notifyChanges({ state, now: 1, placed: [t('elo', 'pending', 2, 3), t('poisson', 'pending', 1, 4)], settled: [] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, '2 new bets placed');
  await notifyChanges({ state, now: 2, placed: [], settled: [] });
  assert.equal(sent.length, 1, 'quiet pass sends nothing');
  await notifyChanges({ state, now: 3, placed: [], settled: [t('elo', 'won', 2, 3)] });
  assert.equal(sent[1].title, '+4.00 RON (1 settled)');
});
