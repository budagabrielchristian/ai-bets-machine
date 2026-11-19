import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CircleCheck, CircleAlert, Info } from 'lucide-react';
import { useBetContext } from '../context/BetContext';
import { AIS } from '../services/aiCatalog';
import { analyzeBets } from '../services/betAnalysis';
import { CountUp, Reveal } from './Reveal';

const pct = (v, d = 0) => Number.isFinite(v) ? (v * 100).toFixed(d) + '%' : '-';
const signed = v => Number.isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%' : '-';
const ron = v => (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + Math.abs(v).toFixed(2);
const cls = v => v > 0.004 ? 'pl-up' : v < -0.004 ? 'pl-down' : '';
const when = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' });
const TIP_ICON = { avoid: CircleAlert, keep: CircleCheck, info: Info };

function TicketTable({ caption, groups }) {
  if (!groups.length) return null;
  return <div className="table-wrap"><table className="stats-table">
    <caption>{caption}</caption>
    <thead><tr><th scope="col">Group</th><th scope="col">Tickets</th><th scope="col">Won</th><th scope="col">Staked</th><th scope="col">Profit (RON)</th><th scope="col">ROI</th></tr></thead>
    <tbody>{groups.map(g => <tr key={g.label}><th scope="row">{g.label}</th><td>{g.count}</td><td>{pct(g.winRate)}</td><td>{g.staked.toFixed(2)}</td>
      <td className={cls(g.profit)}>{ron(g.profit)}</td><td className={cls(g.roi)}>{signed(g.roi)}</td></tr>)}</tbody>
  </table></div>;
}

function LegTable({ caption, groups }) {
  if (!groups.length) return null;
  return <div className="table-wrap"><table className="stats-table">
    <caption>{caption}</caption>
    <thead><tr><th scope="col">Pick</th><th scope="col">Matches</th><th scope="col">Won</th><th scope="col" title="What the prices implied, margin removed when known">Expected</th><th scope="col">Difference</th></tr></thead>
    <tbody>{groups.map(g => <tr key={g.label}><th scope="row">{g.label}</th><td>{g.count}</td><td>{pct(g.hitRate)}</td><td>{pct(g.expected)}</td>
      <td className={cls(g.hitRate - g.expected)}>{signed(g.hitRate - g.expected)}</td></tr>)}</tbody>
  </table></div>;
}

const edgeOf = s => Number.isFinite(s.edge) ? s.edge : Number.isFinite(s.value) ? s.value - 1 : -1;

/** What the AIs are backing in the next 48 hours, best edge first. */
function AiIdeas({ tickets }) {
  const now = Date.now();
  const ideas = tickets.filter(t => t.source === 'ai' && t.status === 'pending' &&
      t.selections.some(s => Date.parse(s.matchDate) > now && Date.parse(s.matchDate) < now + 48 * 3600000))
    .flatMap(t => t.selections.map(s => ({ ...s, ticket: t })))
    .filter(s => Date.parse(s.matchDate) > now)
    .sort((a, b) => edgeOf(b) - edgeOf(a))
    .filter((s, i, all) => all.findIndex(x => x.matchId === s.matchId && x.selection === s.selection) === i)
    .slice(0, 6);
  if (!ideas.length) return <p className="muted">No AI picks for the next 48 hours yet.</p>;
  return <ul className="ideas">{ideas.map(s => <li key={s.ticket.id + s.matchId}>
    <Link to={'/match/' + s.matchId}><b>{s.selection}</b> @ {Number(s.price).toFixed(2)}<span>{s.matchTitle} · {when(s.matchDate)}</span>
      <small>{AIS[s.ticket.strategy]?.name}{Number.isFinite(s.edge) ? ', estimated edge ' + signed(s.edge) : ''}</small>
      <ArrowUpRight size={15} aria-hidden="true" /></Link></li>)}</ul>;
}

export default function BetAnalysis({ tickets }) {
  const { account } = useBetContext();
  const a = useMemo(() => analyzeBets(tickets), [tickets]);
  const s = a.summary;
  return <div className="analysis detail">
    <Reveal as="div" className="stat-tiles">
      <div><small>Profit</small><strong className={cls(s.profit)}><CountUp value={s.profit} format={v => ron(v) + ' RON'} /></strong><small>{s.count} settled, {s.open} open</small></div>
      <div><small>Return on stakes</small><strong className={cls(s.roi)}>{s.count ? signed(s.roi) : '-'}</strong><small>{s.staked.toFixed(2)} RON staked</small></div>
      <div><small>Won</small><strong>{s.count ? pct(s.winRate) : '-'}</strong><small>{s.won} of {s.count} tickets</small></div>
      <div><small>Average odds</small><strong>{s.count ? s.averageOdds.toFixed(2) : '-'}</strong></div>
      <div><small title="Closing line value">Beat the closing price</small><strong className={cls(s.clv ?? 0)}>{s.clv === null ? '-' : signed(s.clv)}</strong></div>
    </Reveal>

    <Reveal>
      <h2>What to change</h2>
      <ul className="tips">{a.tips.map((t, i) => { const Icon = TIP_ICON[t.tone]; return <li key={i} className={'tip-' + t.tone}><Icon size={18} aria-hidden="true" /><span>{t.text}</span></li>; })}</ul>
    </Reveal>

    {s.count > 0 && <Reveal>
      <h2>Where the money went</h2>
      <TicketTable caption="By number of matches on the ticket" groups={a.bySize} />
      <TicketTable caption="By combined odds" groups={a.byOdds} />
    </Reveal>}

    {(a.byPick.length > 0 || a.byMarket.length > 0) && <Reveal>
      <h2>How your picks did</h2>
      <p className="lede">Each match on a ticket, against the chance its price implied. A negative difference means those picks won less often than their odds suggested.</p>
      <LegTable caption="Favourite, underdog or draw" groups={a.byPick} />
      <LegTable caption="By market" groups={a.byMarket} />
      <LegTable caption="By competition (2+ picks)" groups={a.byCompetition} />
    </Reveal>}

    {(a.lostByOne.length > 0 || a.biggestLosses.length > 0) && <Reveal>
      <h2>What lost the tickets</h2>
      {a.lostByOne.length > 0 && <>
        <p className="lede">Tickets that failed because of a single match:</p>
        <ul className="ticket-links">{a.lostByOne.slice(0, 6).map(({ ticket, losers }) => <li key={ticket.id}><Link to={'/ticket/' + ticket.id}>
          <b>{losers[0].selection}</b> @ {Number(losers[0].price).toFixed(2)} in {losers[0].matchTitle} ({String(losers[0].result).replace('–', '-')}) sank a {ticket.selections.length}-match ticket of {Number(ticket.stake).toFixed(2)} RON <ArrowUpRight size={13} aria-hidden="true" /></Link></li>)}</ul>
      </>}
      {a.biggestLosses.length > 0 && <>
        <p className="lede">Biggest losing tickets:</p>
        <ul className="ticket-links">{a.biggestLosses.map(t => <li key={t.id}><Link to={'/ticket/' + t.id}>
          <b>{Number(t.stake).toFixed(2)} RON</b> @ {Number(t.totalOdds).toFixed(2)}: {t.selections.map(l => l.selection).join(', ')} <ArrowUpRight size={13} aria-hidden="true" /></Link></li>)}</ul>
      </>}
    </Reveal>}

    {(a.value || a.modelCheck) && <Reveal>
      <h2>Value when you bet</h2>
      <div className="stat-tiles">
        {a.value && <div><small>Average edge at bet time</small><strong className={cls(a.value.averageEdge)}>{signed(a.value.averageEdge)}</strong><small>price × fair chance − 1, over {a.value.legs} picks</small></div>}
        {a.value && <div><small>Picks priced below fair</small><strong>{pct(a.value.negativeShare)}</strong></div>}
        {a.modelCheck && <div><small>Models agreed with you</small><strong>{a.modelCheck.agreedWon} of {a.modelCheck.agreed} won</strong></div>}
        {a.modelCheck && <div><small>Models rated your pick lower</small><strong>{a.modelCheck.disagreedWon} of {a.modelCheck.disagreed} won</strong></div>}
      </div>
    </Reveal>}

    <Reveal>
      <h2>Ideas from the AIs</h2>
      <p className="lede">What the AIs are backing in the next 48 hours. Practice picks with an estimated edge, not guarantees.</p>
      <AiIdeas tickets={account.tickets} />
    </Reveal>
  </div>;
}
