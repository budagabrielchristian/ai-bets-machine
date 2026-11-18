// JSON file persistence with atomic writes and daily backups.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';

export function readJson(name, fallback) {
  const file = path.join(config.dataDir, name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') log.error('Could not read ' + name + ': ' + error.message);
    return fallback;
  }
}

export function writeJson(name, value) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, name);
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temp, file);
}

/** Keep one copy of the state per day for the last 14 days. */
export function backup(name) {
  const source = path.join(config.dataDir, name);
  if (!fs.existsSync(source)) return;
  const dir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name.replace('.json', '') + '-' + new Date().toISOString().slice(0, 10) + '.json');
  if (!fs.existsSync(target)) fs.copyFileSync(source, target);
  const copies = fs.readdirSync(dir).filter(f => f.startsWith(name.replace('.json', '') + '-')).sort();
  for (const old of copies.slice(0, -14)) fs.rmSync(path.join(dir, old), { force: true });
}
