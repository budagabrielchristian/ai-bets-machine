// One-off wallet top-ups for the online engine, listed in wallet-topups.json at
// the repo root:  [{ "id": "slips-2026-11-23", "ai": "slips", "amount": 200 }]
// Each id is applied exactly once. The money is ADDED to the wallet's deposit in
// the same season, so earlier losses stay on the record (unlike a new season).
// Online only (TEST_PERIOD=1), like the test period: the local app keeps its own wallets.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';

export function readTopUps(file = path.join(config.root, 'wallet-topups.json')) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export function applyTopUps(state, { now = Date.now(), list = readTopUps(), online = process.env.TEST_PERIOD === '1' } = {}) {
  if (!online) return [];
  state.appliedTopUps ||= [];
  const done = [];
  for (const t of list) {
    const amount = Math.round(Number(t?.amount) * 100);
    const wallet = state.ais?.[t?.ai];
    if (!t?.id || state.appliedTopUps.includes(t.id) || !wallet || !(amount > 0 && amount <= 100000)) continue;
    wallet.deposit += amount;
    wallet.topUps = [...(wallet.topUps || []), { id: t.id, at: new Date(now).toISOString(), amount: amount / 100 }];
    wallet.lastScan = 0;
    wallet.note = 'Topped up with ' + (amount / 100).toFixed(0) + ' RON on ' + new Date(now).toISOString().slice(0, 10) + '.';
    state.appliedTopUps.push(t.id);
    done.push(t);
    log.info('Top-up ' + t.id + ': +' + (amount / 100) + ' RON for ' + t.ai);
  }
  return done;
}
