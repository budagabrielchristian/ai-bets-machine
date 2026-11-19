// Phone notifications through ntfy (https://ntfy.sh): install the ntfy app and
// subscribe to the same secret topic name as NTFY_TOPIC. Nothing is sent when
// NTFY_TOPIC is empty.
import { AIS } from '../src/services/aiCatalog.js';
import { config } from './config.js';
import { log } from './log.js';

const name = t => t.source === 'manual' ? 'You' : AIS[t.strategy]?.name || t.strategy;
const legs = t => t.selections.map(s => '• ' + s.matchTitle + ' → ' + s.selection + ' @ ' + s.price).join('\n');
const ron = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' RON';

async function send({ title, body, tags, priority = 3 }) {
  if (!config.ntfyTopic) return;
  try {
    // JSON publishing keeps any character (−, →, diacritics) intact, unlike HTTP headers.
    const message = { topic: config.ntfyTopic, title, message: body, tags: tags.split(','), priority };
    if (config.ntfyClick) message.click = config.ntfyClick;
    const res = await fetch(config.ntfyServer.replace(/\/$/, '') + '/', {
      method: 'POST', body: JSON.stringify(message), headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) log.warn('Notification failed: HTTP ' + res.status);
  } catch (error) {
    log.warn('Notification failed: ' + error.message);
  }
}

const key = t => t.source === 'manual' ? 'manual' : t.strategy;

/**
 * Default ("digest"): count what happened and send one summary every
 * NTFY_DIGEST_HOURS (4 h) when there is something to report.
 * NTFY_MODE=each sends one message per ticket instead.
 */
export async function notifyChanges({ placed = [], settled = [], state, now = Date.now() }) {
  if (!config.ntfyTopic) return;
  if (config.ntfyMode === 'each' || !state) return notifyEach({ placed, settled });
  const d = state.digest ||= { since: now, ais: {} };
  const row = t => (d.ais[key(t)] ||= { placed: 0, won: 0, lost: 0, refunded: 0, profit: 0 });
  for (const t of placed) row(t).placed++;
  for (const t of settled) {
    const r = row(t);
    if (t.status === 'won') { r.won++; r.profit += t.potentialReturn - t.stake; }
    else if (t.status === 'lost') { r.lost++; r.profit -= t.stake; }
    else if (t.status === 'void') r.refunded++;
  }
  if (now - d.since < config.ntfyDigestHours * 3600000) return;
  const rows = Object.entries(d.ais).filter(([, r]) => r.placed || r.won || r.lost || r.refunded);
  state.digest = { since: now, ais: {} };
  if (!rows.length) return;
  const total = rows.reduce((s, [, r]) => s + r.profit, 0);
  const settledCount = rows.reduce((s, [, r]) => s + r.won + r.lost, 0);
  const label = k => k === 'manual' ? 'You' : AIS[k]?.name || k;
  const body = rows.sort((a, b) => b[1].profit - a[1].profit).map(([k, r]) => label(k) + ': ' + [
    r.placed && r.placed + ' placed', r.won && r.won + ' won', r.lost && r.lost + ' lost', r.refunded && r.refunded + ' refunded',
  ].filter(Boolean).join(' · ') + (r.won || r.lost ? ' → ' + ron(r.profit) : '')).join('\n');
  const hours = Math.round((now - d.since) / 3600000);
  await send({ title: settledCount ? 'Last ' + hours + 'h: ' + ron(total) + ' (' + settledCount + ' settled)' : 'Last ' + hours + 'h: new bets placed',
    body, tags: total > 0 ? 'chart_with_upwards_trend' : total < 0 ? 'chart_with_downwards_trend' : 'ticket' });
}

/** One notification per placed ticket and per settled ticket (NTFY_MODE=each). */
async function notifyEach({ placed, settled }) {
  for (const t of placed.slice(0, 10)) {
    await send({ title: name(t) + ' placed a bet', tags: 'ticket',
      body: t.stake.toFixed(2) + ' RON @ ' + Number(t.totalOdds).toFixed(2) + ' (to win ' + Number(t.potentialReturn).toFixed(2) + ')\n' + legs(t) });
  }
  for (const t of settled.slice(0, 15)) {
    if (t.status === 'won') {
      await send({ title: name(t) + ' WON ' + ron(t.potentialReturn - t.stake), tags: 'white_check_mark,moneybag', priority: 4,
        body: t.stake.toFixed(2) + ' RON @ ' + Number(t.totalOdds).toFixed(2) + ' → returned ' + Number(t.potentialReturn).toFixed(2) + ' RON\n' + legs(t) });
    } else if (t.status === 'lost') {
      await send({ title: name(t) + ' lost ' + ron(-t.stake), tags: 'x',
        body: legs(t) + '\nFinal: ' + t.selections.map(s => s.result || '?').join(', ') });
    } else if (t.status === 'void') {
      await send({ title: name(t) + ' bet refunded', tags: 'leftwards_arrow_with_hook', priority: 2,
        body: t.stake.toFixed(2) + ' RON back (match postponed or cancelled)\n' + legs(t) });
    }
  }
  if (placed.length > 10 || settled.length > 15) {
    await send({ title: 'More AI activity', tags: 'information_source', body: (placed.length + settled.length) + ' updates this round; open the dashboard for all of them.' });
  }
}

/** A summary message (test start, weekly report, final report). */
export const sendReport = (title, body, tags, priority = 4) => send({ title, body, tags, priority });

export const sendTest = () => send({ title: 'AI Bets Machine', tags: 'tada', body: 'Notifications are working. You will get one when an AI places, wins or loses a bet.' });
