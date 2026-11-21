// Tickets copied on the online (GitHub Pages) dashboard. The page has no server,
// so it encrypts the pasted ticket with the dashboard key and posts it to a
// private ntfy topic; each engine pass reads that topic and saves the tickets.
//
// - The topic name is derived from the key, so only someone with the dashboard
//   password knows it (it is published only inside the encrypted data).
// - Messages are AES-256-GCM encrypted with the same key: anything else posted
//   there fails to decrypt and is ignored. Each message is processed once.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { log } from './log.js';

const MAX_AGE = 24 * 3600 * 1000;

/** The private ntfy topic for this dashboard key. */
export const inboxTopic = key => 'abm-' + crypto.createHmac('sha256', key).update('copy-inbox').digest('hex').slice(0, 32);

/** Decrypt one message from the page: { v: 1, iv, data } with gzip-compressed JSON inside. */
export function openMessage(key, text) {
  const box = JSON.parse(text);
  if (box?.v !== 1 || typeof box.iv !== 'string' || typeof box.data !== 'string') throw new Error('not a ticket message');
  const body = Buffer.from(box.data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(body.subarray(body.length - 16));
  const zipped = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  return JSON.parse(zlib.gunzipSync(zipped, { maxOutputLength: 200000 }).toString('utf8'));
}

/** Seal a message the way the page does (used by tests). */
export function sealMessage(key, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const zipped = zlib.gzipSync(JSON.stringify(value));
  const body = Buffer.concat([cipher.update(zipped), cipher.final(), cipher.getAuthTag()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), data: body.toString('base64') });
}

/**
 * Read new messages from the inbox and save each ticket with `place` (the
 * engine's placeCopy). Results are kept in state.copyLog for the page and sent
 * with `notify`. `fetchLines` returns ntfy's JSON lines (injectable for tests).
 */
export async function processInbox({ key, state, place, notify, server = 'https://ntfy.sh', fetchLines, now = Date.now() }) {
  const topic = inboxTopic(key);
  state.inbox ||= { since: Math.floor((now - MAX_AGE) / 1000), seen: [] };
  state.copyLog ||= [];
  const read = fetchLines || (async () => {
    const res = await fetch(server.replace(/\/$/, '') + '/' + topic + '/json?poll=1&since=' + state.inbox.since, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return (await res.text()).split('\n').filter(Boolean);
  });
  let lines;
  try { lines = await read(); } catch (error) { log.warn('Copy inbox unavailable: ' + error.message); return []; }
  const done = [];
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.event !== 'message' || !event.id || state.inbox.seen.includes(event.id)) continue;
    state.inbox.seen = [...state.inbox.seen, event.id].slice(-300);
    state.inbox.since = Math.max(state.inbox.since, Number(event.time) || 0);
    let request;
    try { request = openMessage(key, event.message); } catch { continue; } // not ours: ignore quietly
    if (!request?.id || state.copyLog.some(c => c.id === request.id) || !(now - Number(request.at) < MAX_AGE)) continue;
    const entry = { id: String(request.id).slice(0, 64), at: new Date(now).toISOString(), sentAt: new Date(Number(request.at)).toISOString() };
    try {
      const ticket = await place({ text: String(request.text || ''), stake: request.stake, bookmaker: request.bookmaker,
        skipProblems: Boolean(request.skipProblems), payout: request.payout });
      const matches = new Set(ticket.selections.map(s => s.matchId)).size;
      Object.assign(entry, { ok: true, ticketId: ticket.id, message: matches + ' matches at odds ' + ticket.totalOdds + ', stake ' + ticket.stake +
        ' RON' + (ticket.leftOut ? ', ' + ticket.leftOut + ' left out' : '') + ', pays ' + Number(ticket.potentialReturn).toFixed(2) + ' RON' });
    } catch (error) {
      Object.assign(entry, { ok: false, message: String(error.message || 'Could not copy the ticket').slice(0, 300) });
    }
    state.copyLog = [entry, ...state.copyLog].slice(0, 15);
    done.push(entry);
    await notify?.({ title: entry.ok ? 'Ticket copied' : 'Ticket not copied', body: entry.message });
    log.info('Copy inbox: ' + (entry.ok ? 'saved ' : 'refused ') + entry.message);
  }
  return done;
}
