// A fixed-length test of all AIs, configured in test-period.json at the repo root:
//   { "id": "month-1", "days": 30 }
// When the engine sees a new id it starts a clean season for every AI (and the
// manual account) at the same moment, sends a weekly summary, stops new bets
// when the period ends and sends a final report once open tickets settle.
import fs from 'node:fs';
import path from 'node:path';
import { AIS, MANUAL } from '../src/services/aiCatalog.js';
import { aiStats } from '../src/services/aiStats.js';
import { config } from './config.js';
import { log } from './log.js';
import { sendReport } from './notify.js';
import { testDay } from '../src/services/fixtureDay.js';

const DAY = 86400000;

export function readTestConfig() {
  // Only the online engine runs the test (TEST_PERIOD=1 in engine.yml); the local app is left alone.
  if (process.env.TEST_PERIOD !== '1') return null;
  try {
    const c = JSON.parse(fs.readFileSync(path.join(config.root, 'test-period.json'), 'utf8'));
    if (typeof c?.id === 'string' && c.days > 0) return c;
  } catch { /* no test configured */ }
  return null;
}

const pct = v => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%';
const ron = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' RON';

/** One line per account, best profit first. */
export function summaryLines(state, walletTickets) {
  const rows = [...Object.keys(AIS), 'manual'].map(key => {
    const tickets = walletTickets(key);
    const s = aiStats(tickets, key === 'manual' ? 0 : state.ais[key].deposit / 100);
    return { name: key === 'manual' ? MANUAL.name : AIS[key].name, s, count: tickets.length, manual: key === 'manual' };
  }).filter(r => !r.manual || r.count);
  rows.sort((a, b) => b.s.profit - a.s.profit);
  return rows.map((r, i) => (i + 1) + '. ' + r.name + ': ' + ron(r.s.profit) +
    (r.s.settled ? ' · ROI ' + pct(r.s.roi) + ' · ' + r.s.won + 'W-' + r.s.lost + 'L' : ' · nothing settled yet') +
    (r.s.pending ? ' · ' + r.s.pending + ' open' : ''));
}

/** Called once per engine pass. Returns true while new bets are allowed. */
export async function testTick({ state, now, newSeason, walletTickets }) {
  const cfg = readTestConfig();
  if (cfg && state.test?.id !== cfg.id) {
    for (const key of Object.keys(state.ais)) newSeason(key);
    state.test = { id: cfg.id, days: cfg.days, start: now, end: now + cfg.days * DAY, lastWeekly: now, finished: false };
    log.info('Test period "' + cfg.id + '" started for ' + cfg.days + ' days');
    await sendReport('Test period started (' + cfg.days + ' days)',
      'Every AI starts again at 200 RON. You will get a summary each week and a final report on ' +
      new Date(state.test.end).toISOString().slice(0, 10) + '.', 'checkered_flag');
    return true;
  }
  const test = state.test;
  if (!test) return true;
  if (now < test.end) {
    if (now - test.lastWeekly >= 7 * DAY) {
      test.lastWeekly = now;
      const day = testDay(test.start, now, test.days);
      await sendReport('Week ' + Math.round((now - test.start) / (7 * DAY)) + ' of the test (day ' + day + '/' + test.days + ')',
        summaryLines(state, walletTickets).join('\n'), 'bar_chart');
    }
    return true;
  }
  if (!test.finished) {
    const open = Object.keys(state.ais).some(key => walletTickets(key).some(t => t.status === 'pending'));
    // Wait for open tickets to settle (at most 3 extra days), then report once.
    if (!open || now > test.end + 3 * DAY) {
      test.finished = true;
      test.finishedAt = now;
      await sendReport('Test period finished: final results',
        summaryLines(state, walletTickets).join('\n') + '\n\nNo new bets until you start another test.', 'trophy', 5);
    }
  }
  return false;
}
