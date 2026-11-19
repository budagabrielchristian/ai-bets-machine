import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Leaderboard from '../components/Leaderboard';
import SlipNotificationSettings from '../components/SlipNotificationSettings';
import { useBetContext } from '../context/BetContext';
import { STATIC } from '../services/api';
import { ArrowUpRight } from 'lucide-react';

const LEGACY_KEY = 'practice-account-v1';

function readLegacy() {
  try {
    const saved = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
    return saved?.tickets?.length && !localStorage.getItem(LEGACY_KEY + '-imported') ? saved : null;
  } catch { return null; }
}

/** One-time move of tickets saved in this browser by the old version. */
function LegacyImport() {
  const { importLegacy } = useBetContext();
  const [legacy, setLegacy] = useState(readLegacy);
  const [message, setMessage] = useState('');
  if (!legacy && !message) return null;
  async function run() {
    try {
      const { added, skipped } = await importLegacy(legacy);
      try { localStorage.setItem(LEGACY_KEY + '-imported', new Date().toISOString()); } catch { /* private mode */ }
      setLegacy(null);
      setMessage('Imported ' + added + ' tickets' + (skipped ? ' (' + skipped + ' skipped: duplicates or old single-bankroll Auto-Pilot tickets)' : '') + '.');
    } catch (e) { setMessage(e.message); }
  }
  return <div className="notification-settings">
    {legacy ? <><div><h3>Tickets found in this browser</h3><p>{legacy.tickets.length} tickets from the previous version are stored only in this browser. Copy them to the server so they count on the leaderboard.</p></div>
      <div className="flex flex-wrap gap-3"><button onClick={run}>Import to server</button>
      <button onClick={() => { try { localStorage.setItem(LEGACY_KEY + '-imported', 'dismissed'); } catch { /* ignore */ } setLegacy(null); }}>Dismiss</button></div></> : null}
    {message && <p role="status">{message}</p>}
  </div>;
}

export default function Home() {
  return <div className="desk">
    <header><h1>The match<br/><em>ledger.</em></h1>
      <div><p>Five betting AIs run around the clock on practice money. Track who is up and who is down.</p><Link to="/bets">Today’s fixtures <ArrowUpRight size={16} strokeWidth={2} aria-hidden="true" /></Link></div>
    </header>
    {!STATIC && <LegacyImport />}
    <Leaderboard />
    {STATIC ? <p className="trial-caption">Online view: updated about every 15 minutes by GitHub Actions. View-only; make changes in the local app.</p> : <SlipNotificationSettings />}
  </div>;
}
