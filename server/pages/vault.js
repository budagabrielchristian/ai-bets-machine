// Password-based encryption for everything published from the public repo.
// AES-256-GCM, key from PBKDF2-SHA256. Browser counterpart: src/services/vault.js.
import crypto from 'node:crypto';

export const ITERATIONS = 600000;

export const newSalt = () => crypto.randomBytes(16).toString('base64');

export function deriveKey(password, salt) {
  if (!password || password.length < 12) throw new Error('DASHBOARD_PASSWORD must be at least 12 characters.');
  return crypto.pbkdf2Sync(password.normalize('NFKC'), Buffer.from(salt, 'base64'), ITERATIONS, 32, 'sha256');
}

export function encrypt(key, salt, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt, iv: iv.toString('base64'), data: body.toString('base64') };
}

export function decrypt(key, box) {
  const body = Buffer.from(box.data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}
