import React, { useEffect, useState } from 'react';
import { fetchBox, openStatic } from '../services/api';
import { decrypt, deriveKey, recallKey, rememberKey } from '../services/vault';

/** Password screen for the GitHub Pages version: the data is decrypted in this browser only. */
export default function Gate({ children }) {
  const [box, setBox] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | locked | working | open | missing
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const b = await fetchBox();
        if (!active) return;
        setBox(b);
        const key = await recallKey(b.salt);
        if (key) {
          try { openStatic(await decrypt(key, b), key); if (active) setStatus('open'); return; } catch { /* key no longer valid */ }
        }
        if (active) setStatus('locked');
      } catch (e) {
        if (active) { setError(e.message); setStatus('missing'); }
      }
    })();
    return () => { active = false; };
  }, []);

  async function unlock(e) {
    e.preventDefault();
    setStatus('working'); setError('');
    try {
      const key = await deriveKey(password, box);
      const payload = await decrypt(key, box);
      await rememberKey(key, box.salt);
      openStatic(payload, key);
      setPassword('');
      setStatus('open');
    } catch {
      setError('Wrong password.');
      setStatus('locked');
    }
  }

  if (status === 'open') return children;
  return <main className="gate">
    <h1>The match ledger.</h1>
    <p>Private dashboard. The data is encrypted; enter your password to open it on this device.</p>
    {status === 'loading' && <p role="status">Loading…</p>}
    {status === 'missing' && <div className="gate-error" role="alert">{error}</div>}
    {(status === 'locked' || status === 'working') && <form onSubmit={unlock}>
      {error && <div className="gate-error" role="alert">{error}</div>}
      <label>Password<input type="password" autoComplete="current-password" autoFocus required value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button type="submit" disabled={status === 'working'}>{status === 'working' ? 'Unlocking…' : 'Unlock'}</button>
    </form>}
    <small>Your password never leaves this browser: decryption happens here.</small>
  </main>;
}
