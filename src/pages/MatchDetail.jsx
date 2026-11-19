import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBetContext } from '../context/BetContext';
import { AIS } from '../services/aiCatalog';
import { powerDevig } from '../../server/ai/math.js';
import { CountUp, Reveal } from '../components/Reveal';

const pct = (v, d = 1) => Number.isFinite(v) ? (v * 100).toFixed(d) + '%' : '-';
const signed = v => Number.isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%' : '-';
/** A probability with a thin bar that grows to its value when the section appears. */
const Prob = ({ v }) => Number.isFinite(v) ? <span className="pcell">{pct(v)}<i style={{ '--p': Math.min(1, v) }} /></span> : '-';
const cls = v => !Number.isFinite(v) ? '' : v > 0.0005 ? 'pl-up' : v < -0.0005 ? 'pl-down' : '';
const kickoff = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' });

/** Each market at each bookmaker, with implied and margin-free probabilities. */
function marketRows(match) {
  const rows = [];
  for (const book of match.bookmakers || []) for (const market of book.markets || []) {
    const outcomes = market.key === 'h2h'
      ? [match.home_team, 'Draw', match.away_team].map(name => market.outcomes.find(o => o.name === name)).filter(Boolean)
      : market.outcomes;
    const fair = powerDevig(outcomes.map(o => o.price));
    rows.push({ book: book.title, key: market.key, title: market.key === 'h2h' ? 'Match result (1X2)' : market.title || market.key,
      margin: fair?.margin, outcomes: outcomes.map((o, i) => ({ name: o.name, price: o.price, implied: 1 / o.price, fair: fair?.probabilities[i] })) });
  }
  return rows;
}

function Form({ games }) {
  if (!games?.length) return <span className="muted">No recent results</span>;
  return <ol className="form-list">{games.map((g, i) => <li key={i} className={'form-' + g.res} title={new Date(g.date).toLocaleDateString()}>
    <b>{g.res}</b> {g.gf}-{g.ga} {g.home ? 'vs' : '@'} {g.opp || 'opponent'}</li>)}</ol>;
}

function ScoreGrid({ matrix, home, away }) {
  const max = Math.max(...matrix.flat());
  return <div className="score-grid-wrap"><table className="score-grid">
    <caption>Chance of each exact score (Dixon-Coles). Rows: {home} goals, columns: {away} goals.</caption>
    <thead><tr><th></th>{matrix[0].map((_, a) => <th key={a} scope="col">{a}</th>)}</tr></thead>
    <tbody>{matrix.map((row, h) => <tr key={h}><th scope="row">{h}</th>{row.map((p, a) =>
      <td key={a} className={p / max > 0.6 ? 'hot' : undefined} style={{ background: 'rgba(231,229,224,' + (0.03 + 0.3 * p / max).toFixed(3) + ')',
        transitionDelay: Math.round((1 - p / max) * 500) + 'ms' }}>{(p * 100).toFixed(1)}</td>)}</tr>)}</tbody>
  </table></div>;
}

export default function MatchDetail() {
  const { id } = useParams();
  const { oddsFeed, account } = useBetContext();
  const match = oddsFeed.matches.find(m => String(m.id) === String(id));
  const insight = oddsFeed.insights?.[id];
  const tickets = account.tickets.filter(t => t.selections.some(s => String(s.matchId) === String(id)));
  const leg = tickets[0]?.selections.find(s => String(s.matchId) === String(id));

  if (!match) {
    return <div className="desk detail"><Link to="/bets" className="back">← Markets</Link>
      <h1>{leg?.matchTitle || 'Match'}</h1>
      <p>{oddsFeed.loading ? 'Loading…' : 'This match is no longer in the live feed (it finished or is outside the next few days). Its tickets are below.'}</p>
      <TicketList tickets={tickets} matchId={id} />
    </div>;
  }

  const rows = marketRows(match);
  const h2h = rows.filter(r => r.key === 'h2h');
  const sides = ['home', 'draw', 'away'];
  const names = [match.home_team, 'Draw', match.away_team];
  const best = sides.map((_, i) => Math.max(...h2h.map(r => r.outcomes[i]?.price || 0)));
  const fairMarket = sides.map((_, i) => { const v = h2h.map(r => r.outcomes[i]?.fair).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b) / v.length : NaN; });
  const e = insight?.elo, p = insight?.poisson;

  return <div className="desk detail">
    <Link to="/bets" className="back">← Markets</Link>
    <Reveal as="header" className="detail-head">
      <p className="eyebrow">{match.sport_title} · {kickoff(match.commence_time)}{match.statusLabel ? ', ' + match.statusLabel : ''}</p>
      <h1>{match.home_team} <em>vs</em> {match.away_team}</h1>
    </Reveal>

    <Reveal>
      <h2>Who wins?</h2>
      <p className="lede">The bookmaker's price includes a margin. Removing it (power method) gives the market's fair probability. The models give their own estimate; the AIs blend model and market 50/50 and look for a positive expected value.</p>
      <div className="table-wrap"><table className="stats-table">
        <thead><tr><th scope="col">Outcome</th><th scope="col">Best price</th><th scope="col">Market (fair)</th><th scope="col">Elo</th><th scope="col">Poisson</th><th scope="col">Blend 50/50</th><th scope="col" title="Expected value per 1 RON staked at the best price, using the blend">Expected value</th></tr></thead>
        <tbody>{names.map((name, i) => {
          const models = [e?.[sides[i]], p?.[sides[i]]].filter(Number.isFinite);
          const model = models.length ? models.reduce((a, b) => a + b) / models.length : NaN;
          const blend = Number.isFinite(model) ? (model + fairMarket[i]) / 2 : fairMarket[i];
          const ev = best[i] ? blend * best[i] - 1 : NaN;
          return <tr key={name}><th scope="row">{name}</th><td>{best[i] ? best[i].toFixed(2) : '-'}</td><td><Prob v={fairMarket[i]} /></td>
            <td><Prob v={e?.[sides[i]]} /></td><td><Prob v={p?.[sides[i]]} /></td><td><Prob v={blend} /></td><td className={cls(ev)}>{signed(ev)}</td></tr>;
        })}</tbody>
      </table></div>
      {!insight && <p className="muted">No model numbers for this match (teams without enough recent results).</p>}
    </Reveal>

    {p && <Reveal>
      <h2>Goals model</h2>
      <div className="stat-tiles">
        <div><small>Expected goals</small><strong><CountUp value={p.homeGoals} format={v => v.toFixed(2)} /> - <CountUp value={p.awayGoals} format={v => v.toFixed(2)} /></strong></div>
        <div><small>Over 1.5 goals</small><strong><CountUp value={p.over15} format={v => pct(v, 0)} /></strong></div>
        <div><small>Over 2.5 goals</small><strong><CountUp value={p.over25} format={v => pct(v, 0)} /></strong></div>
        <div><small>Over 3.5 goals</small><strong><CountUp value={p.over35} format={v => pct(v, 0)} /></strong></div>
        <div><small>Both teams score</small><strong><CountUp value={p.btts} format={v => pct(v, 0)} /></strong></div>
      </div>
      <ScoreGrid matrix={p.matrix} home={match.home_team} away={match.away_team} />
    </Reveal>}

    {e && <Reveal>
      <h2>Ratings</h2>
      <div className="stat-tiles">
        <div><small>{match.home_team} Elo</small><strong><CountUp value={e.homeRating} from={1400} /></strong><small>{e.homeGames} games rated</small></div>
        <div><small>{match.away_team} Elo</small><strong><CountUp value={e.awayRating} from={1400} /></strong><small>{e.awayGames} games rated</small></div>
        <div><small>Gap incl. home advantage</small><strong>{(e.homeRating + e.homeAdvantage - e.awayRating > 0 ? '+' : '') + (e.homeRating + e.homeAdvantage - e.awayRating)}</strong><small>home advantage +{e.homeAdvantage}</small></div>
      </div>
    </Reveal>}

    {insight?.form && <Reveal>
      <h2>Recent form</h2>
      <div className="form-cols"><div><h3>{match.home_team}</h3><Form games={insight.form.home} /></div><div><h3>{match.away_team}</h3><Form games={insight.form.away} /></div></div>
    </Reveal>}

    <Reveal>
      <h2>All prices</h2>
      {rows.length ? rows.map((r, i) => <div className="table-wrap" key={i}><table className="stats-table">
        <caption>{r.title} · {r.book} · margin {pct(r.margin)}</caption>
        <thead><tr><th scope="col">Outcome</th><th scope="col">Price</th><th scope="col" title="1 ÷ price">Implied</th><th scope="col">Fair (no margin)</th></tr></thead>
        <tbody>{r.outcomes.map(o => <tr key={o.name}><th scope="row">{o.name}</th><td>{o.price.toFixed(2)}</td><td>{pct(o.implied)}</td><td>{pct(o.fair)}</td></tr>)}</tbody>
      </table></div>) : <p className="muted">No prices yet.</p>}
    </Reveal>

    <Reveal><h2>AI tickets on this match</h2><TicketList tickets={tickets} matchId={id} /></Reveal>
  </div>;
}

function TicketList({ tickets, matchId }) {
  if (!tickets.length) return <p className="muted">No AI has bet on this match.</p>;
  return <ul className="ticket-links">{tickets.map(t => {
    const s = t.selections.find(x => String(x.matchId) === String(matchId));
    return <li key={t.id}><Link to={'/ticket/' + t.id}>
      <b>{t.source === 'manual' ? 'You' : AIS[t.strategy]?.name || t.strategy}</b> · {s?.selection} @ {s?.price}
      {t.selections.length > 1 ? ' · ' + t.selections.length + '-match ticket' : ''} · {Number(t.stake).toFixed(2)} RON · <span className={'status-' + t.status}>{t.status}</span> ↗</Link></li>;
  })}</ul>;
}
