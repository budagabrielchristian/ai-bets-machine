// Talks to the server. Every request carries the session cookie; changes also
// carry the CSRF token the server issued for this session.
let csrf = '';

export const SERVER_DOWN = 'The AI Bets Machine server is not running. Start it with “Start AI Bets Machine.bat” (keep its window open), then reload this page.';

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
  const data = await request('/api/me');
  csrf = data.csrf;
  return data;
}

export const get = path => request(path);

export async function post(path, body = {}) {
  if (!csrf) await me();
  return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
}

export async function logout() {
  try { await post('/api/logout'); } finally { window.location.assign('/login'); }
}
