import React, { useState } from 'react';
import games from '../assets/epl-2024-25.json';
import { replaySeason } from '../services/replaySeason';

export default function AutoPilotReplay() {
  const [profile, setProfile] = useState('price');
  const [limit, setLimit] = useState(3);
  const [result, setResult] = useState(null);
  return <section className="border-y border-white/15 py-7">
    <h2 className="text-2xl font-bold mb-2">Test Auto-Pilot</h2>
    <p className="text-gray-300">Replay all 380 Premier League fixtures from 2024–25, one matchday at a time. Each selected single risks one practice unit.</p>
    <div className="controls">
      <label>Selection rule<select value={profile} onChange={e => { setProfile(e.target.value); setResult(null); }}>
        <option value="price">Auto-Pilot · compare prices</option><option value="favorites">Auto-Pilot · favorites</option><option value="safe">Favorites · 60% and above</option><option value="balanced">Balanced · 40–60%</option><option value="outsider">Outsiders · below 40%</option>
      </select></label>
      <label>Maximum picks per day<select value={limit} onChange={e => { setLimit(Number(e.target.value)); setResult(null); }}>
        {[1,2,3].map(n => <option key={n}>{n}</option>)}
      </select></label>
    </div>
    <button className="bg-white text-black rounded-full px-5 py-2 font-semibold" onClick={() => setResult(replaySeason(games, profile, limit))}>Run historical test</button>
    {result && <div className="mt-5" aria-live="polite">
      <p className="text-lg">{result.rows.length} bets · {result.wins} won · {result.rows.length - result.wins} lost</p>
      <p>Net {result.profit.toFixed(2)} units · ROI {result.rows.length ? (100 * result.profit / result.rows.length).toFixed(1) + '%' : '—'}</p>
      <details className="mt-4"><summary className="cursor-pointer">Inspect selections and results</summary>
        <div className="overflow-auto max-h-96"><table className="w-full text-left text-sm"><thead><tr>{['Date','Fixture','Pick','Price','Source','Result','Net units'].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>
          {result.rows.map(r => <tr className="border-t border-white/10" key={r.match.id}>{[r.date,r.match.home_team+' vs '+r.match.away_team,r.selection,r.price.toFixed(2),r.bookmaker,r.winner,r.profit.toFixed(2)].map((cell,i) => <td className="p-2" key={i}>{cell}</td>)}</tr>)}
        </tbody></table></div></details>
    </div>}
    <p className="mt-5 text-sm text-gray-400">Uses archived pre-match Bet365 and Pinnacle prices. The replay assumes each day’s quotes were available together. Results stay separate from your saved portfolio. <a className="underline" href="https://www.football-data.co.uk/mmz4281/2425/E0.csv">Season data</a></p>
  </section>;
}
