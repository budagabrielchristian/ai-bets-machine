import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBetContext } from '../context/BetContext';
import { AIS } from '../services/aiCatalog';
import { ticketClv, ticketProfit } from '../services/aiStats';
import { CountUp, Reveal } from '../components/Reveal';

const pct = (v, d = 1) => Number.isFinite(v) ? (v * 100).toFixed(d) + '%' : '-';
const signed = v => Number.isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%' : '-';
const ron = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' RON';
const cls = v => !Number.isFinite(v) ? '' : v > 0.0005 ? 'pl-up' : v < -0.0005 ? 'pl-down' : '';
const when = iso => iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' }) : '-';

// How each AI sizes its stake (see server/ai/strategies.js).
const STAKING = {
  favorites: { text: 'Flat 2% of the bankroll per ticket.', fraction: null },
  price: { text: 'Quarter Kelly, capped at 4% of the bankroll.', fraction: 0.25, cap: 0.04 },
  elo: { text: 'Quarter Kelly, capped at 3% of the bankroll.', fraction: 0.25, cap: 0.03 },
  poisson: { text: 'Quarter Kelly, capped at 3% of the bankroll.', fraction: 0.25, cap: 0.03 },
  slips: { text: 'Fixed: 60 RON when combined odds are up to 3.50, 10 RON above.', fraction: null },
};

/** Win / lose for one leg from its final score ("2–1"). */
function legOutcome(leg) {
  const m = String(leg.result || '').match(/(\d+)\D+(\d+)/);
  if (!m) return null;
  const h = Number(m[1]), a = Number(m[2]);
  const [home, away] = leg.teams || String(leg.matchTitle).split(' vs ');
  if (leg.market === 'total') return (leg.side === 'over' ? h + a > leg.line : h + a < leg.line) ? 'won' : 'lost';
  if (leg.market === 'handicap') return (leg.side === 'home' ? h - a : a - h) + leg.line > 0 ? 'won' : 'lost';
  const winner = h > a ? home : h < a ? away : 'Draw';
  return leg.selection === winner ? 'won' : 'lost';
}

/** The probability the AI used for a leg, and where it came from. */
function legProbability(leg) {
  if (Number.isFinite(leg.probability)) return { p: leg.probability, source: 'blend of model and market' };
  if (Number.isFinite(leg.referenceProbability)) return { p: leg.referenceProbability, source: 'sharp-book fair price' };
  if (Number.isFinite(leg.marketProbability)) return { p: leg.marketProbability, source: 'market fair price' };
  return { p: 1 / leg.price, source: 'implied by the price' };
}

export default function TicketDetail() {
  const { id } = useParams();
  const { account } = useBetContext();
  const t = account.tickets.find(x => x.id === id);
  if (!t) return <div className="desk detail"><Link to="/auto-pilot" className="back">← AI tickets</Link><h1>Ticket</h1>
    <p>{account.loaded ? 'Ticket not found.' : 'Loading…'}</p></div>;

  const who = t.source === 'manual' ? 'You (manual)' : AIS[t.strategy]?.name || t.strategy;
  const legs = t.selections.map(l => ({ ...l, ...legProbability(l), outcome: legOutcome(l),
    clv: l.closingPrice > 1 ? l.price / l.closingPrice - 1 : NaN,
    fairOdds: Number.isFinite(l.marketProbability) ? 1 / l.marketProbability : NaN }));
  const odds = Number(t.totalOdds);
  const product = legs.reduce((x, l) => x * l.price, 1);
  const pWin = legs.reduce((x, l) => x * l.p, 1);
  const ev = pWin * odds - 1;
  const fairTicketOdds = legs.every(l => Number.isFinite(l.fairOdds)) ? legs.reduce((x, l) => x * l.fairOdds, 1) : NaN;
  const builtInMargin = Number.isFinite(fairTicketOdds) ? fairTicketOdds / odds - 1 : NaN;
  const kelly = Math.max(0, (pWin * odds - 1) / (odds - 1));
  const rule = STAKING[t.strategy];
  const clv = ticketClv(t);
  const profit = ticketProfit(t);
  const settled = t.status === 'won' || t.status === 'lost';

  return <div className="desk detail">
    <Link to={t.source === 'manual' ? '/my-bets' : '/auto-pilot?strategy=' + t.strategy} className="back">← {who} tickets</Link>
    <Reveal as="header" className="detail-head">
      <p className="eyebrow">{who}{t.season ? ', season ' + t.season : ''}. Placed {when(t.datePlaced)}{t.settledAt ? ', settled ' + when(t.settledAt) : ''}</p>
      <h1>{t.selections.length > 1 ? t.selections.length + '-match ticket' : 'Single bet'} <em>@ {odds.toFixed(2)}</em></h1>
    </Reveal>

    <Reveal as="div" className="stat-tiles" delay={0.08}>
      <div><small>Status</small><strong className={'status-' + t.status}>{t.status === 'void' ? 'refunded' : t.status}</strong></div>
      <div><small>Stake</small><strong><CountUp value={Number(t.stake)} format={v => v.toFixed(2) + ' RON'} /></strong></div>
      <div><small>Potential return</small><strong><CountUp value={Number(t.potentialReturn)} format={v => v.toFixed(2) + ' RON'} /></strong></div>
      <div><small>Result</small><strong className={settled ? (profit >= 0 ? 'pl-up' : 'pl-down') : ''}>{settled ? ron(profit) : t.status === 'void' ? '±0.00 RON' : 'open'}</strong></div>
      <div><small title="Closing line value">CLV</small><strong className={cls(clv)}>{clv === null ? '-' : signed(clv)}</strong></div>
    </Reveal>
    {t.rationale && <p className="lede">Why: {t.rationale}</p>}

    <Reveal>
      <h2>The matches</h2>
      <div className="table-wrap"><table className="stats-table">
        <thead><tr><th scope="col">Match</th><th scope="col">Pick</th><th scope="col">Price</th><th scope="col" title="1 ÷ price">Implied</th>
          <th scope="col">Market fair</th><th scope="col">Model</th><th scope="col">Used p</th><th scope="col" title="Used p × price − 1">Edge</th>
          <th scope="col" title="Last price before kickoff">Closing</th><th scope="col" title="Price ÷ closing price − 1">CLV</th><th scope="col">Final</th></tr></thead>
        <tbody>{legs.map((l, i) => <tr key={i}>
          <th scope="row"><Link to={'/match/' + l.matchId}>{l.matchTitle}</Link><small>{l.competition}{l.matchDate ? ' · ' + when(l.matchDate) : ''}</small></th>
          <td>{l.selection}<small>{l.bookmaker}</small></td><td>{Number(l.price).toFixed(2)}</td><td>{pct(1 / l.price)}</td>
          <td>{pct(l.marketProbability ?? l.referenceProbability)}</td><td>{pct(l.modelProbability)}</td>
          <td title={l.source}>{pct(l.p)}</td><td className={cls(l.p * l.price - 1)}>{signed(l.p * l.price - 1)}</td>
          <td>{l.closingPrice ? Number(l.closingPrice).toFixed(2) : '-'}</td><td className={cls(l.clv)}>{signed(l.clv)}</td>
          <td className={l.outcome === 'won' ? 'pl-up' : l.outcome === 'lost' ? 'pl-down' : ''}>{l.result ? String(l.result).replace('–', '-') + (l.outcome ? ', ' + l.outcome : '') : '-'}</td>
        </tr>)}</tbody>
      </table></div>
    </Reveal>

    <Reveal className="maths">
      <h2>The maths</h2>
      <dl>
        <div><dt>Combined odds</dt><dd>{legs.map(l => Number(l.price).toFixed(2)).join(' × ')} = <b>{product.toFixed(2)}</b>{Math.abs(product - odds) > 0.01 ? ' (same-match builder priced at ' + odds.toFixed(2) + ')' : ''}</dd></div>
        <div><dt>Chance the bookmaker's price implies</dt><dd>1 ÷ {odds.toFixed(2)} = <b>{pct(1 / odds)}</b></dd></div>
        <div><dt>Chance the AI estimated</dt><dd>{legs.map(l => pct(l.p)).join(' × ')} = <b>{pct(pWin, 2)}</b><small>Legs are on different matches, so their chances multiply.</small></dd></div>
        <div><dt>Expected value</dt><dd>{pct(pWin, 2)} × {odds.toFixed(2)} − 1 = <b className={cls(ev)}>{signed(ev)}</b><small>Average result per 1 RON if this exact bet were repeated many times: {ron(ev * t.stake)} on this stake.</small></dd></div>
        {Number.isFinite(builtInMargin) && <div><dt>Bookmaker margin on the ticket</dt><dd>fair odds {fairTicketOdds.toFixed(2)} vs offered {odds.toFixed(2)} → <b className="pl-down">{signed(-builtInMargin)}</b><small>Each extra match multiplies the margin, which is why combined tickets are expensive.</small></dd></div>}
        <div><dt>Kelly stake</dt><dd>(p × odds − 1) ÷ (odds − 1) = ({pct(pWin, 2)} × {odds.toFixed(2)} − 1) ÷ {(odds - 1).toFixed(2)} = <b>{pct(kelly, 2)}</b> of the bankroll
          <small>{rule ? rule.text : 'You chose this stake yourself.'}{rule?.fraction ? ' Here: ' + pct(kelly * rule.fraction, 2) + (kelly * rule.fraction > rule.cap ? ', capped at ' + pct(rule.cap, 0) : '') + ', with a 1 RON minimum.' : ''}</small></dd></div>
        <div><dt>Payout</dt><dd>{Number(t.stake).toFixed(2)} × {odds.toFixed(2)} = <b>{Number(t.potentialReturn).toFixed(2)} RON</b> if every match wins; profit {ron(t.potentialReturn - t.stake)}</dd></div>
        <div><dt>Closing line value</dt><dd>{legs.some(l => l.closingPrice) ? legs.map(l => l.closingPrice ? Number(l.price).toFixed(2) + ' ÷ ' + Number(l.closingPrice).toFixed(2) : '-').join(' · ') + ' → ' : ''}<b className={cls(clv)}>{clv === null ? 'after kickoff' : signed(clv)}</b>
          <small>Positive means the AI got a better price than the market's final price. Over many bets this is the best sign of real skill.</small></dd></div>
      </dl>
    </Reveal>
  </div>;
}
