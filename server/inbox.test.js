import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { inboxTopic, openMessage, processInbox, sealMessage } from './inbox.js';

const key = crypto.randomBytes(32);
const NOW = Date.parse('2026-11-21T12:00:00Z');
const line = (id, message, time = NOW / 1000) => JSON.stringify({ id, time, event: 'message', message });
const request = extra => ({ id: crypto.randomUUID(), at: NOW - 60000, text: 'Arsenal - Chelsea\n1\n2.00', stake: 10, bookmaker: 'Betano', ...extra });
const ticket = { id: 't1', stake: 10, totalOdds: 2, potentialReturn: 20, selections: [{ matchId: 'm1' }] };

test('the topic is private to the key, and messages round-trip', () => {
  assert.match(inboxTopic(key), /^abm-[0-9a-f]{32}$/);
  assert.notEqual(inboxTopic(key), inboxTopic(crypto.randomBytes(32)));
  const value = request();
  assert.deepEqual(openMessage(key, sealMessage(key, value)), value);
  assert.throws(() => openMessage(crypto.randomBytes(32), sealMessage(key, value)));
});

test('saves each sealed ticket once and ignores foreign, replayed and old messages', async () => {
  const state = {};
  const placed = [], notes = [];
  const good = request();
  const lines = [
    line('a', sealMessage(key, good)),
    line('b', sealMessage(crypto.randomBytes(32), request())), // someone without the key
    line('c', 'hello'),                                         // not a ticket at all
    line('d', sealMessage(key, good)),                          // the same ticket posted again
    line('e', sealMessage(key, request({ at: NOW - 3 * 864e5 }))), // too old
  ];
  const run = () => processInbox({ key, state, now: NOW, fetchLines: async () => lines,
    place: async r => { placed.push(r); return ticket; }, notify: async n => { notes.push(n); } });
  const done = await run();
  assert.equal(done.length, 1);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].stake, 10);
  assert.equal(notes[0].title, 'Ticket copied');
  assert.equal(state.copyLog[0].ok, true);
  assert.deepEqual(await run(), []); // a second pass sees the same messages and does nothing
  assert.equal(placed.length, 1);
});

test('a refused ticket is logged and reported, not lost silently', async () => {
  const state = {};
  const notes = [];
  await processInbox({ key, state, now: NOW, fetchLines: async () => [line('x', sealMessage(key, request()))],
    place: async () => { throw new Error('Real Madrid vs Getafe: Not found in the fixture list.'); }, notify: async n => { notes.push(n); } });
  assert.equal(state.copyLog[0].ok, false);
  assert.match(state.copyLog[0].message, /Not found/);
  assert.equal(notes[0].title, 'Ticket not copied');
});

test('an unreachable inbox does not break the engine pass', async () => {
  const state = {};
  assert.deepEqual(await processInbox({ key, state, now: NOW, fetchLines: async () => { throw new Error('offline'); }, place: async () => ticket }), []);
});
