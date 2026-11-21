// Decrypts the dashboard data published on GitHub Pages (see server/pages/vault.js).
const bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const KEY_STORE = 'abm-key';

export async function deriveKey(password, box) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(box.salt), iterations: box.iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function decrypt(key, box) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(box.iv) }, key, bytes(box.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

const b64 = buf => { let s = ''; for (const c of new Uint8Array(buf)) s += String.fromCharCode(c); return btoa(s); };

/**
 * Encrypt a message for the engine (gzip, then AES-GCM with the dashboard key).
 * Server counterpart: openMessage in server/inbox.js.
 */
export async function sealMessage(key, value) {
  const zipped = await new Response(new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, zipped);
  return JSON.stringify({ v: 1, iv: b64(iv), data: b64(data) });
}

/**
 * The engine's private ntfy inbox for this key: "abm-" + the first 32 hex
 * characters of HMAC-SHA256(key, "copy-inbox"). Same as inboxTopic in server/inbox.js.
 */
export async function inboxTopic(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  const mac = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', mac, new TextEncoder().encode('copy-inbox')));
  return 'abm-' + [...sig].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** Keep the derived key for this browser tab only, so a reload does not ask again. */
export async function rememberKey(key, salt) {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  try { sessionStorage.setItem(KEY_STORE, JSON.stringify({ salt, key: btoa(String.fromCharCode(...raw)) })); } catch { /* private mode */ }
}

export async function recallKey(salt) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY_STORE) || 'null');
    if (!saved || saved.salt !== salt) return null;
    return crypto.subtle.importKey('raw', bytes(saved.key), 'AES-GCM', true, ['encrypt', 'decrypt']);
  } catch { return null; }
}

export function forgetKey() {
  try { sessionStorage.removeItem(KEY_STORE); } catch { /* ignore */ }
}
