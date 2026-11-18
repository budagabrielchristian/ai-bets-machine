// Talks to the server. Every request carries the session cookie; changes also
// carry the CSRF token the server issued for this session.
//
// On GitHub Pages (built with VITE_STATIC=1) there is no server: the page reads
// encrypted data published by GitHub Actions and is view-only.
import { decrypt, forgetKey } from './vault';

export const STATIC = import.meta.env.VITE_STATIC === '1';
export const READ_ONLY = 'This online page is view-only. Place manual bets, pause AIs or start seasons in the local app.';
export const SERVER_DOWN = 'The AI Bets Machine server is not running. Start it with “Start AI Bets Machine.bat” (keep its window open), then reload this page.';

let csrf = '';

/* ------------------------------------------------- GitHub Pages mode --- */

let staticData = null, staticKey = null, loadedAt = 0;
export const DATA_FILE = './data.enc.json';

export async function fetchBox() {
  const response = await fetch(DATA_FILE + '?t=' + Date.now(), { cache: 'no-store' });
  if (!response.ok) throw new Error('No data published yet. The first GitHub Actions run creates it.');
  return response.json();
}

export function openStatic(payload, key) {
  staticData = payload; staticKey = key; loadedAt = Date.now();
}

async function reloadStatic(force = false) {
  if (!force && Date.now() - loadedAt < 60000) return;
  loadedAt = Date.now();
  try { staticData = await decrypt(staticKey, await fetchBox()); } catch { /* keep showing the last good data */ }
}

function lock() {
  forgetKey();
  window.location.reload();
}

async function staticGet(path) {
  if (path === '/api/me') return { user: 'owner', csrf: '' };
  await reloadStatic();
  if (path === '/api/state') return staticData.state;
  if (path === '/api/matches') return { matches: staticData.matches, updatedAt: staticData.generatedAt };
  throw new Error('Not available online');
}

async function staticPost(path) {
  if (path === '/api/logout') return lock();
  if (path === '/api/matches/refresh') { await reloadStatic(true); return { ok: true }; }
  throw new Error(READ_ONLY);
}

/* ------------------------------------------------------- server mode --- */

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  } catch {
    throw new Error(SERVER_DOWN);
  }
  // The Vite dev proxy answers 502/504 when the server is not running.
  if (response.status === 502 || response.status === 504) throw new Error(SERVER_DOWN);
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('Signed out');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed (' + response.status + ')');
  return data;
}

export async function me() {
  if (STATIC) return staticGet('/api/me');
  const data = await request('/api/me');
  csrf = data.csrf;
  return data;
}

export const get = path => STATIC ? staticGet(path) : request(path);

export async function post(path, body = {}) {
  if (STATIC) return staticPost(path);
  if (!csrf) await me();
  return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
}

export async function logout() {
  if (STATIC) return lock();
  try { await post('/api/logout'); } finally { window.location.assign('/login'); }
}
