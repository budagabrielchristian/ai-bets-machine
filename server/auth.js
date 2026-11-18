// Accounts, sessions, login throttling and two-factor codes. Node crypto only.
import crypto from 'node:crypto';
import { config } from './config.js';
import { readJson, writeJson } from './store.js';

/* ------------------------------------------------------------ passwords --- */

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize('NFKC'), salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

// A real hash to compare against when the username does not exist, so the
// response time does not reveal which usernames are valid.
const DUMMY = hashPassword(crypto.randomBytes(16).toString('hex'));

export function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored || DUMMY).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(actual, expected) && Boolean(stored);
}

/* ---------------------------------------------------------- TOTP (2FA) --- */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = '', out = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function base32(secret) {
  let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totp(secret, step = Math.floor(Date.now() / 30000)) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, '0');
}
function verifyTotp(user, code) {
  if (!/^\d{6}$/.test(code || '')) return false;
  const now = Math.floor(Date.now() / 30000);
  for (const step of [now - 1, now, now + 1]) {
    // Each code works once, which blocks replay of an observed code.
    if (step > (user.lastTotpStep || 0) && crypto.timingSafeEqual(Buffer.from(totp(user.totpSecret, step)), Buffer.from(code))) {
      user.lastTotpStep = step;
      return true;
    }
  }
  return false;
}

/* --------------------------------------------------------------- users --- */

export const loadUsers = () => readJson('users.json', { users: [] });
export const saveUsers = data => writeJson('users.json', data);
export const hasUsers = () => loadUsers().users.length > 0;

/* ---------------------------------------------------- login throttling --- */

// Failures are counted per IP and per username. After 5 failures the key is
// locked, and the lock doubles with each further failure. IP locks grow to 24
// hours; username locks stop at 15 minutes so a stranger cannot keep the real
// owner locked out for long.
const failures = new Map();
const lockFor = (key, count) => count < 5 ? 0 :
  Math.min(key.startsWith('user:') ? 15 * 60000 : 24 * 3600000, 60000 * 2 ** (count - 5));

function lockedUntil(key) {
  const f = failures.get(key);
  return f ? f.at + lockFor(key, f.count) : 0;
}
function fail(key) {
  const f = failures.get(key) || { count: 0, at: 0 };
  failures.set(key, { count: f.count + 1, at: Date.now() });
}
setInterval(() => {
  for (const [key, f] of failures) if (Date.now() - f.at > 24 * 3600000) failures.delete(key);
}, 3600000).unref();

export function login({ username, password, code, ip }) {
  const name = String(username || '').trim().toLowerCase().slice(0, 64);
  const keys = ['ip:' + ip, 'user:' + name];
  const wait = Math.max(...keys.map(lockedUntil)) - Date.now();
  if (wait > 0) return { ok: false, error: 'Too many attempts. Try again in ' + Math.ceil(wait / 60000) + ' minute(s).' };
  const data = loadUsers();
  const user = data.users.find(u => u.username === name);
  const passwordOk = verifyPassword(String(password || '').slice(0, 1024), user?.hash);
  const codeOk = passwordOk && user && (!user.totpSecret || verifyTotp(user, String(code || '').trim()));
  if (!user || !passwordOk || !codeOk) {
    keys.forEach(fail);
    return { ok: false, error: user?.totpSecret && passwordOk ? 'Invalid authentication code.' : 'Invalid username or password.' };
  }
  keys.forEach(k => failures.delete(k));
  user.lastLogin = new Date().toISOString();
  saveUsers(data);
  return { ok: true, user: user.username };
}

/* ------------------------------------------------------------ sessions --- */

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const sessions = new Map(Object.entries(readJson('sessions.json', {})));
const persist = () => writeJson('sessions.json', Object.fromEntries(sessions));
const IDLE = config.sessionDays * 86400000;
const ABSOLUTE = 30 * 86400000;

export const cookieName = config.secureCookies ? '__Host-sid' : 'sid';

export function createSession(user, ip, agent) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(sha(token), { user, created: now, seen: now, ip, agent: String(agent || '').slice(0, 200), csrf: crypto.randomBytes(24).toString('base64url') });
  persist();
  return token;
}

export function getSession(token) {
  if (!token) return null;
  const id = sha(token);
  const s = sessions.get(id);
  if (!s) return null;
  const now = Date.now();
  if (now - s.seen > IDLE || now - s.created > ABSOLUTE || !loadUsers().users.some(u => u.username === s.user)) {
    sessions.delete(id); persist();
    return null;
  }
  if (now - s.seen > 60000) { s.seen = now; persist(); }
  return { id, ...s };
}

export function destroySession(token) {
  if (token && sessions.delete(sha(token))) persist();
}

export function destroyAllSessions(user) {
  for (const [id, s] of sessions) if (s.user === user) sessions.delete(id);
  persist();
}

export function sessionCookie(token, maxAgeSeconds = config.sessionDays * 86400) {
  return [cookieName + '=' + token, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=' + maxAgeSeconds,
    config.secureCookies ? 'Secure' : ''].filter(Boolean).join('; ');
}
