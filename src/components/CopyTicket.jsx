import React, { useState } from 'react';
import { CircleAlert, ClipboardPaste, Check } from 'lucide-react';
import { useBetContext } from '../context/BetContext';
import { post } from '../services/api';

const when = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' });

/** Paste a Betano or Superbet ticket as text and save it as a practice bet. */
export default function CopyTicket() {
  const { refreshState } = useBetContext();
  const [text, setText] = useState('');
  const [book, setBook] = useState('');
  const [stake, setStake] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [skip, setSkip] = useState(false);

  const read = async () => {
    setBusy(true); setError(''); setSaved('');
    try {
      const result = await post('/api/tickets/copy/preview', { text });
      setPreview(result);
      if (result.bookmaker) setBook(result.bookmaker);
      if (result.stake && !stake) setStake(String(result.stake));
    } catch (e) { setError(e.message); setPreview(null); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setError('');
    try {
      const { ticket } = await post('/api/tickets/copy', { text, stake: Number(String(stake).replace(',', '.')), bookmaker: book, skipProblems: skip });
      await refreshState();
      const n = new Set(ticket.selections.map(s => s.matchId)).size;
      setSaved('Saved: ' + n + ' match' + (n > 1 ? 'es' : '') + (ticket.leftOut ? ' (' + ticket.leftOut + ' left out)' : '') + ' at odds ' + ticket.totalOdds + ', stake ' + ticket.stake + ' RON.');
      setText(''); setPreview(null); setStake(''); setSkip(false);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const problems = preview?.legs.filter(l => l.problem) || [];
  const warnings = preview?.warnings || [];
  const usable = preview?.legs.filter(l => !l.problem) || [];
  const ready = preview && usable.length && (skip || (!problems.length && !warnings.length)) && book && Number(String(stake).replace(',', '.')) > 0;

  return <section className="copy-ticket" aria-labelledby="copy-ticket-title">
    <h2 id="copy-ticket-title">Copy a ticket</h2>
    <p className="muted">Open your ticket in the Betano or Superbet app, copy all its text and paste it here. It is saved as a practice bet with the
      odds from the ticket and settled on the real results. Works for 1X2 and total goals, for matches in roughly the next two days.</p>
    <textarea value={text} onChange={e => { setText(e.target.value); setPreview(null); setSaved(''); }} rows={7} maxLength={20000}
      placeholder={'Bayern München - FC Köln\nRezultat final\n1\n1.25\n…'} aria-label="Ticket text" />
    <div className="copy-row">
      <label>Bookmaker<select value={book} onChange={e => setBook(e.target.value)}>
        <option value="">Choose</option><option>Betano</option><option>Superbet</option></select></label>
      <label>Stake (RON)<input inputMode="decimal" value={stake} onChange={e => setStake(e.target.value)} placeholder="10" /></label>
      <button type="button" onClick={read} disabled={busy || !text.trim()}><ClipboardPaste size={15} aria-hidden="true" /> Read ticket</button>
    </div>

    {preview && <div className="copy-preview">
      {!preview.legs.length ? <p className="copy-problem"><CircleAlert size={15} aria-hidden="true" /> No match from this text was found in the fixture list.
        The feed covers about the next two days; check that the team names are in the text.</p> :
        <div className="table-wrap"><table className="stats-table">
          <caption>{new Set(preview.legs.map(l => l.matchId)).size} matches found</caption>
          <thead><tr><th scope="col">Match</th><th scope="col">Pick</th><th scope="col">Ticket odds</th><th scope="col">Feed odds</th></tr></thead>
          <tbody>{preview.legs.map((l, i) => <tr key={l.matchId + i}>
            <th scope="row">{l.matchTitle}<span>{when(l.matchDate)}{l.competition ? ' · ' + l.competition : ''}</span></th>
            <td>{l.problem ? <span className="copy-problem"><CircleAlert size={14} aria-hidden="true" /> {l.problem}</span> : l.selection}</td>
            <td>{l.builderId ? (preview.legs.findIndex(x => x.builderId === l.builderId) === i
              ? <>{l.builderPrice.toFixed(2)}<small>Bet Builder</small></> : <small>same Bet Builder</small>) : l.price ? l.price.toFixed(2) : '-'}</td>
            <td>{l.feedPrice ? l.feedPrice.toFixed(2) : '-'}</td>
          </tr>)}</tbody>
        </table></div>}
      {preview.totalOdds && (!problems.length || skip) && <p className="muted">{problems.length || warnings.length ? 'Without the flagged matches: total' : 'Total'} odds {preview.totalOdds}
        {Number(String(stake).replace(',', '.')) > 0 ? ' · potential return ' + (Number(String(stake).replace(',', '.')) * preview.totalOdds).toFixed(2) + ' RON' : ''}</p>}
      {warnings.map(w => <p key={w} className="copy-problem"><CircleAlert size={15} aria-hidden="true" /> {w}</p>)}
      {(problems.length > 0 || warnings.length > 0) && usable.length > 0 && <label className="copy-skip">
        <input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} />
        Leave out the flagged matches and save the rest{preview.totalOdds ? ' (total odds ' + preview.totalOdds + ' instead of the ticket’s)' : ''}</label>}
      <button type="button" className="copy-save" onClick={save} disabled={busy || !ready}><Check size={15} aria-hidden="true" /> Save ticket</button>
    </div>}
    {error && <p className="copy-problem" role="alert"><CircleAlert size={15} aria-hidden="true" /> {error}</p>}
    {saved && <p className="copy-saved" role="status">{saved}</p>}
  </section>;
}
