// HTTP server: login, JSON API and the built dashboard. No third-party packages.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { AIS } from '../src/services/aiCatalog.js';
import { config } from './config.js';
import { cookieName, createSession, destroySession, getSession, hasUsers, login, sessionCookie } from './auth.js';
import * as engine from './engine.js';
import { feedStatus, getMatches } from './feed.js';
import { log } from './log.js';

/* ------------------------------------------------------------- helpers --- */

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // same-origin (not no-referrer): browsers then send a real Origin header on
  // our own form posts, which the CSRF check relies on.
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  ...(config.secureCookies ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
const json = (res, status, value, headers = {}) =>
  send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function clientIp(req) {
  if (config.trustProxy === 'cloudflare' && req.headers['cf-connecting-ip']) return String(req.headers['cf-connecting-ip']);
  if (config.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (forwarded.length) return forwarded[forwarded.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Reject cross-site requests: the Origin (or Referer) must match this host. */
function sameOrigin(req) {
  // Modern browsers state the relationship directly; trust it when present.
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin';
  const host = config.trustProxy ? (req.headers['x-forwarded-host'] || req.headers.host) : req.headers.host;
  const source = req.headers.origin || req.headers.referer;
  if (!source || !host) return false;
  try { return new URL(source).host === host; } catch { return false; }
}

// Simple fixed-window rate limit per IP for all requests.
const hits = new Map();
function rateLimited(ip, limit = 600, windowMs = 5 * 60000) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > windowMs) { hits.set(ip, { start: now, count: 1 }); return false; }
  return ++h.count > limit;
}
setInterval(() => { const now = Date.now(); for (const [ip, h] of hits) if (now - h.start > 600000) hits.delete(ip); }, 600000).unref();

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ----------------------------------------------------------- login page --- */

const LOGIN_CSS = `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#131313;color:#eee;font:16px/1.5 system-ui,sans-serif;padding:16px}
main{width:100%;max-width:22rem}h1{font:400 2.6rem/1 Georgia,serif;letter-spacing:-.05em;margin:0 0 .4rem}p{color:#aaa;margin:0 0 1.8rem;font-size:.9rem}
label{display:block;font-size:.8rem;color:#bbb;margin-bottom:1rem}input{display:block;width:100%;margin-top:.4rem;padding:.75rem;background:#202020;color:#fff;border:1px solid #474747;border-radius:.45rem;font-size:1rem}
input:focus-visible,button:focus-visible{outline:2px solid #ddd;outline-offset:2px}button{width:100%;padding:.8rem;border:0;border-radius:2rem;background:#e7e5e0;color:#181818;font-weight:600;font-size:1rem;cursor:pointer;margin-top:.4rem}
.error{background:#3a1d1d;border:1px solid #6b2f2f;color:#f3c4c4;padding:.7rem .9rem;border-radius:.45rem;font-size:.85rem;margin-bottom:1.2rem}small{display:block;color:#888;margin-top:1.5rem;font-size:.75rem}`;

function loginPage(res, { error = '', status = 200 } = {}) {
  const token = crypto.randomBytes(24).toString('base64url');
  const setup = !hasUsers();
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · AI Bets Machine</title><meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/login.css"></head><body><main>
<h1>The match ledger.</h1><p>Private dashboard. Sign in to continue.</p>
${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ''}
${setup ? `<div class="error" role="alert">No account exists yet. On the server, run <b>npm run create-user -- yourname</b>, then reload this page.</div>` : ''}
<form method="post" action="/login" autocomplete="on">
<input type="hidden" name="csrf" value="${token}">
<label>Username<input name="username" autocomplete="username" required maxlength="64" autofocus></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="1024"></label>
<label>Authentication code <span style="color:#777">(if 2FA is on)</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"></label>
<button type="submit">Sign in</button></form><small>Repeated failures lock the account for a while.</small></main></body></html>`;
  send(res, status, body, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Set-Cookie': `lcsrf=${token}; Path=/login; HttpOnly; SameSite=Strict; Max-Age=1800${config.secureCookies ? '; Secure' : ''}`,
  });
}

async function handleLogin(req, res, ip) {
  const form = new URLSearchParams(await readBody(req, 8 * 1024));
  const expected = cookies(req).lcsrf;
  if (!sameOrigin(req) || !expected || form.get('csrf') !== expected) {
    return loginPage(res, { error: 'Your sign-in form expired. Please try again.', status: 400 });
  }
  const result = login({ username: form.get('username'), password: form.get('password'), code: form.get('code'), ip });
  if (!result.ok) {
    log.audit('login failed user=' + JSON.stringify(String(form.get('username') || '').slice(0, 64)) + ' ip=' + ip);
    return loginPage(res, { error: result.error, status: 401 });
  }
  log.audit('login ok user=' + result.user + ' ip=' + ip);
  const token = createSession(result.user, ip, req.headers['user-agent']);
  send(res, 303, '', { Location: '/', 'Set-Cookie': [sessionCookie(token), `lcsrf=; Path=/login; Max-Age=0`], 'Cache-Control': 'no-store' });
}

/* ------------------------------------------------------------------ API --- */

const aiKey = key => (Object.hasOwn(AIS, key) ? key : null);

function publicState() {
  return {
    ais: Object.fromEntries(Object.entries(engine.state.ais).map(([key, v]) =>
      [key, { season: v.season, deposit: v.deposit, enabled: v.enabled, lastScan: v.lastScan, note: v.note }])),
    tickets: engine.state.tickets.map(({ selections, ...t }) => ({ ...t, selections: selections.map(({ jointModel, ...s }) => s) })),
    settings: engine.state.settings,
    engine: engine.engineStatus(),
    feed: feedStatus(),
    oddsApi: Boolean(config.oddsApiKey),
  };
}

async function api(req, res, session, url) {
  const route = req.method + ' ' + url.pathname;
  if (req.method === 'GET') {
    if (route === 'GET /api/me') return json(res, 200, { user: session.user, csrf: session.csrf });
    if (route === 'GET /api/state') return json(res, 200, publicState());
    if (route === 'GET /api/matches') {
      try { return json(res, 200, { matches: await getMatches({ maxAge: 60000 }), updatedAt: feedStatus().updatedAt }); }
      catch { return json(res, 503, { error: 'Fixture feed unavailable. Retrying shortly.' }); }
    }
    return json(res, 404, { error: 'Not found' });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  // Every state change needs a same-origin JSON request carrying the session's CSRF token.
  const token = String(req.headers['x-csrf-token'] || '');
  if (!sameOrigin(req) || !String(req.headers['content-type'] || '').startsWith('application/json') ||
      token.length !== session.csrf.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(session.csrf))) {
    return json(res, 403, { error: 'Request blocked by CSRF protection. Reload the page.' });
  }
  const raw = await readBody(req, url.pathname === '/api/import' ? 5 * 1024 * 1024 : 64 * 1024);
  let body;
  try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'Invalid JSON' }); }

  if (route === 'POST /api/logout') {
    destroySession(cookies(req)[cookieName]);
    log.audit('logout user=' + session.user);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (route === 'POST /api/tickets') return json(res, 201, { ticket: await engine.placeManual(body) });
  if (route === 'POST /api/matches/refresh') {
    try { await getMatches({ maxAge: 10000 }); } catch { /* reported in state */ }
    return json(res, 200, { ok: true });
  }
  if (route === 'POST /api/settings') {
    if (typeof body.slipNotifications === 'boolean') engine.state.settings.slipNotifications = body.slipNotifications;
    engine.save();
    return json(res, 200, { settings: engine.state.settings });
  }
  if (route === 'POST /api/import') {
    const result = engine.importLegacy(body.account);
    log.audit('import user=' + session.user + ' added=' + result.added);
    return json(res, 200, result);
  }
  if (route === 'POST /api/reset-all') {
    for (const key of Object.keys(engine.state.ais)) engine.newSeason(key);
    log.audit('reset-all user=' + session.user);
    return json(res, 200, { ok: true });
  }
  const m = url.pathname.match(/^\/api\/ai\/([a-z]+)\/(enable|pause|new-season|scan)$/);
  if (m) {
    const key = m[1] === 'manual' && m[2] === 'new-season' ? 'manual' : aiKey(m[1]);
    if (!key) return json(res, 404, { error: 'Unknown AI' });
    if (m[2] === 'enable') engine.setEnabled(key, true);
    if (m[2] === 'pause') engine.setEnabled(key, false);
    if (m[2] === 'new-season') { engine.newSeason(key); log.audit('new-season ' + key + ' user=' + session.user); }
    if (m[2] === 'scan') { engine.state.ais[key].lastScan = 0; engine.tick(); }
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Not found' });
}

/* -------------------------------------------------------------- static --- */

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp' };

function serveStatic(req, res, pathname) {
  let file;
  try { file = path.resolve(config.distDir, '.' + decodeURIComponent(pathname)); } catch { return send(res, 400, 'Bad request'); }
  if (!file.startsWith(config.distDir + path.sep) && file !== config.distDir) return send(res, 403, 'Forbidden');
  let stat = fs.existsSync(file) && fs.statSync(file);
  if (!stat || stat.isDirectory()) {
    if (path.extname(pathname)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    file = path.join(config.distDir, 'index.html');
    stat = fs.existsSync(file) && fs.statSync(file);
    if (!stat) return send(res, 503, 'Dashboard not built yet. Run npm run build.', { 'Content-Type': 'text/plain' });
  }
  const immutable = pathname.startsWith('/assets/');
  send(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(file), {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': immutable ? 'private, max-age=31536000, immutable' : 'no-store',
  });
}

/* -------------------------------------------------------------- server --- */

const server = http.createServer(async (req, res) => {
  const ip = clientIp(req);
  try {
    if (rateLimited(ip)) return send(res, 429, 'Too many requests', { 'Retry-After': '60', 'Content-Type': 'text/plain' });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    if (url.pathname === '/login.css') return send(res, 200, LOGIN_CSS, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
    if (url.pathname === '/login') {
      if (req.method === 'POST') return await handleLogin(req, res, ip);
      if (getSession(cookies(req)[cookieName])) return send(res, 303, '', { Location: '/' });
      return loginPage(res);
    }
    const session = getSession(cookies(req)[cookieName]);
    if (!session) {
      if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'Sign in required' });
      return send(res, 303, '', { Location: '/login' });
    }
    if (url.pathname.startsWith('/api/')) return await api(req, res, session, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    if (error instanceof engine.UserError) return json(res, 400, { error: error.message });
    if (error.status === 413) return json(res, 413, { error: 'Request too large' });
    log.error(req.method + ' ' + req.url + ' failed: ' + error.stack);
    if (!res.headersSent) json(res, 500, { error: 'Server error' });
  }
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    log.error('Port ' + config.port + ' is already in use, so the dashboard did not start. Another copy is probably ' +
      'still running: close its window (or end "node.exe" in Task Manager), then start again.');
    process.exit(1);
  }
  throw error;
});

server.headersTimeout = 20000;
server.requestTimeout = 30000;
server.listen(config.port, config.host, () => {
  log.info('AI Bets Machine listening on http://' + config.host + ':' + config.port + (config.production ? ' (production)' : ''));
  if (!hasUsers()) log.warn('No accounts yet. Create one with: npm run create-user -- <username>');
  if (!config.secureCookies) {
    if (config.host === '127.0.0.1' || config.host === 'localhost') log.info('Local mode: only this PC can open the dashboard.');
    else log.warn('Secure cookies are OFF while listening on ' + config.host + '. Use HTTPS (npm start) before exposing this to a network.');
  }
  engine.start();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log.info('Shutting down');
    try { engine.flush(); } catch (error) { log.error(error.message); }
    process.exit(0);
  });
}
