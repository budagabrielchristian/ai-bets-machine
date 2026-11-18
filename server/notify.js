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

/** One notification per placed ticket and per settled ticket. */
export async function notifyChanges({ placed = [], settled = [] }) {
  if (!config.ntfyTopic) return;
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

export const sendTest = () => send({ title: 'AI Bets Machine', tags: 'tada', body: 'Notifications are working. You will get one when an AI places, wins or loses a bet.' });
