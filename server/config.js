import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader so no extra dependency is needed. Real environment wins.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const env = process.env;
const production = env.NODE_ENV === 'production' || process.argv.includes('--production');
const bool = (value, fallback) => value === undefined || value === '' ? fallback : /^(1|true|yes)$/i.test(value);

export const config = {
  root,
  production,
  host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
  port: Number(env.PORT) || 8787,
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  distDir: path.join(root, 'dist'),
  // Cookies marked Secure are only sent over HTTPS. Keep this on in production.
  secureCookies: bool(env.COOKIE_SECURE, production),
  // Only trust X-Forwarded-For when running behind your own reverse proxy.
  // "cloudflare" reads CF-Connecting-IP (Cloudflare Tunnel); true reads X-Forwarded-For (Caddy, nginx).
  trustProxy: env.TRUST_PROXY === 'cloudflare' ? 'cloudflare' : bool(env.TRUST_PROXY, false),
  sessionDays: Number(env.SESSION_DAYS) || 7,
  oddsApiKey: env.ODDS_API_KEY || '',
  // Free plan: 500 requests a month. Two leagues every 3 hours = 2 × 8 × 30 = 480.
  oddsApiSports: (env.ODDS_API_SPORTS || 'soccer_epl,soccer_spain_la_liga').split(',').map(s => s.trim()).filter(Boolean),
  oddsApiIntervalMinutes: Number(env.ODDS_API_INTERVAL_MINUTES) || 180,
  // Stop fetching when fewer requests than this are left in the month.
  oddsApiReserve: Number(env.ODDS_API_RESERVE) || 20,
  historyDays: Number(env.HISTORY_DAYS) || 365,
  engineEnabled: bool(env.ENGINE_ENABLED, true),
  // Phone notifications via ntfy: install the ntfy app, subscribe to this secret topic.
  ntfyTopic: env.NTFY_TOPIC || '',
  ntfyServer: env.NTFY_SERVER || 'https://ntfy.sh',
  ntfyClick: env.NTFY_CLICK || '',
  // "digest" (default): one grouped message per engine pass with activity (instant),
  // or at most one every NTFY_DIGEST_HOURS when set. "each": one message per ticket.
  ntfyMode: env.NTFY_MODE === 'each' ? 'each' : 'digest',
  ntfyDigestHours: Number(env.NTFY_DIGEST_HOURS) || 0,
};
