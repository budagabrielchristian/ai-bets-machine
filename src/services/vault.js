// Decrypts the dashboard data published on GitHub Pages (see server/pages/vault.js).
const bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const KEY_STORE = 'abm-key';

export async function deriveKey(password, box) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(box.salt), iterations: box.iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}

export async function decrypt(key, box) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(box.iv) }, key, bytes(box.data));
  return JSON.parse(new TextDecoder().decode(plain));
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
    return crypto.subtle.importKey('raw', bytes(saved.key), 'AES-GCM', false, ['decrypt']);
  } catch { return null; }
}

export function forgetKey() {
  try { sessionStorage.removeItem(KEY_STORE); } catch { /* ignore */ }
}
