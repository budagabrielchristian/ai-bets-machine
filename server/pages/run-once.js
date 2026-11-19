// One engine pass for GitHub Actions (the repo is public, so everything saved is encrypted).
//   DASHBOARD_PASSWORD=... node server/pages/run-once.js --vault <dir> --out <file>
// <dir>/state.enc.json  engine state, kept between runs on the "data" branch
// <dir>/salt.txt        key-derivation salt (not secret)
// <file>                encrypted dashboard data for GitHub Pages
import fs from 'node:fs';
import path from 'node:path';
import { decrypt, deriveKey, encrypt, newSalt } from './vault.js';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const vaultDir = path.resolve(arg('--vault') || 'vault');
const outFile = path.resolve(arg('--out') || 'dist/data.enc.json');
// Absolute path: the server's config would otherwise resolve it against the project folder.
const dataDir = path.resolve(process.env.DATA_DIR || 'engine-data');
process.env.DATA_DIR = dataDir;
fs.mkdirSync(vaultDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const saltFile = path.join(vaultDir, 'salt.txt');
if (!fs.existsSync(saltFile)) fs.writeFileSync(saltFile, newSalt());
const salt = fs.readFileSync(saltFile, 'utf8').trim();
const key = deriveKey(process.env.DASHBOARD_PASSWORD, salt);

// Restore the previous run's state.
const stateFile = path.join(vaultDir, 'state.enc.json');
if (fs.existsSync(stateFile)) {
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify(decrypt(key, JSON.parse(fs.readFileSync(stateFile, 'utf8')))));
  } catch {
    console.error('Could not decrypt the saved state. Was DASHBOARD_PASSWORD changed? Restore the old password, or delete the "data" branch to start fresh.');
    process.exit(1);
  }
} else {
  console.log('No saved state yet: starting fresh.');
}

// The engine reads DATA_DIR when it is imported, so import it only now.
const engine = await import('../engine.js');
const { getMatches } = await import('../feed.js');
await engine.refit();
await engine.tick({ force: true });
engine.flush();

const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
fs.writeFileSync(stateFile, JSON.stringify(encrypt(key, salt, state)));

let matches = [];
try { matches = await getMatches({ maxAge: 15 * 60000 }); } catch { /* the page shows the feed error */ }
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(encrypt(key, salt, { generatedAt: Date.now(), state: engine.publicState(), matches })));

// Numbers-only status, NOT encrypted: lets anyone (including you) check the engine
// is alive without the password. No matches, selections or amounts are included.
const { config } = await import('../config.js');
const status = { lastPass: new Date().toISOString(), fixtures: matches.length, models: engine.engineStatus().models.status,
  notifications: Boolean(config.ntfyTopic), test: state.test || null, feedError: state.engine?.error || null, ais: {} };
for (const [key, ai] of Object.entries(state.ais)) {
  const mine = state.tickets.filter(t => (key === 'manual' ? t.source === 'manual' : t.strategy === key) && (t.season || 1) === ai.season);
  status.ais[key] = { open: mine.filter(t => t.status === 'pending').length, settled: mine.filter(t => ['won', 'lost'].includes(t.status)).length,
    placedLast24h: mine.filter(t => Date.now() - Date.parse(t.datePlaced) < 864e5).length, enabled: ai.enabled };
}
fs.writeFileSync(path.join(vaultDir, 'status.json'), JSON.stringify(status, null, 1));
console.log('Status: ' + JSON.stringify(status));

const open = state.tickets.filter(t => t.status === 'pending').length;
console.log('Run complete: ' + state.tickets.length + ' tickets (' + open + ' open), ' + matches.length + ' fixtures, models ' + engine.engineStatus().models.status);
process.exit(0);
