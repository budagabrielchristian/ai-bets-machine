import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBetContext } from '../context/BetContext';
import { AIS, MANUAL, STARTING_BALANCE } from '../services/aiCatalog';
import { aiStats, dailyProfit } from '../services/aiStats';
import { STATIC } from '../services/api';
import { testDay } from '../services/fixtureDay';
import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { CountUp, Reveal } from './Reveal';

const money = (v, sign = true) => (sign ? (v > 0.004 ? '+' : v < -0.004 ? '−' : '') : '') + Math.abs(v).toFixed(2);
const percent = (v, sign = true) => v === null || v === undefined ? '-' : (sign ? (v > 0 ? '+' : v < 0 ? '−' : '') : '') + Math.abs(v * 100).toFixed(1) + '%';
const trend = v => v > 0.004 ? 'up' : v < -0.004 ? 'down' : 'flat';
const ICONS = { up: TrendingUp, down: TrendingDown, flat: Minus };
const ago = ms => { if (!ms) return 'never'; const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
const DASHES = ['', '6 4', '2 3', '10 3 2 3', '1 5', '14 4'];

/** Profit or loss with a direction icon; `animated` counts up to the value when visible. */
function PL({ value, size, animated }) {
  const Icon = ICONS[trend(value)];
  return <span className={'pl pl-' + trend(value) + (size ? ' pl-' + size : '')}>
    <Icon className="pl-icon" size={size === 'lg' ? 22 : size === 'card' ? 24 : 13} strokeWidth={2.25} aria-hidden="true" />
    {animated ? <CountUp value={value} format={money} /> : money(value)}<span className="sr-only">{value >= 0 ? ' RON profit' : ' RON loss'}</span>
  </span>;
}

function Sparkline({ curve, deposit }) {
  if (curve.length < 2) return <svg className="spark" viewBox="0 0 100 28" aria-hidden="true"><line x1="0" x2="100" y1="14" y2="14" /></svg>;
  const values = curve.map(p => p.balance);
  const min = Math.min(...values, deposit), max = Math.max(...values, deposit);
  const y = v => max === min ? 14 : 26 - (v - min) / (max - min) * 24;
  const pts = values.map((v, i) => (i / (values.length - 1) * 100).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  return <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
    <line className="base" x1="0" x2="100" y1={y(deposit)} y2={y(deposit)} />
    <polyline points={pts} />
  </svg>;
}

/** Profit over time for every account on one chart, labelled at the line ends. */
function ProfitChart({ rows }) {
  const series = rows.filter(r => r.stats.curve.length > 1);
  if (!series.length) return <p className="empty-note">The chart fills in as tickets settle.</p>;
  const W = 720, H = 260, L = 52, R = 120, T = 14, B = 26;
  const t0 = Math.min(...series.map(r => r.stats.curve[0].t)), t1 = Math.max(Date.now(), ...series.map(r => r.stats.curve.at(-1).t));
  const profits = series.flatMap(r => r.stats.curve.map(p => p.balance - r.stats.deposit));
  let lo = Math.min(0, ...profits), hi = Math.max(0, ...profits);
  if (hi - lo < 1) { hi += 1; lo -= 1; }
  const x = t => L + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - L - R);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const ticks = [lo, lo + (hi - lo) / 2, hi, 0].filter((v, i, a) => a.findIndex(u => Math.abs(u - v) < (hi - lo) / 8) === i);
  // Spread end labels so they never overlap.
  const ends = series.map(r => ({ r, v: r.stats.curve.at(-1).balance - r.stats.deposit })).sort((a, b) => b.v - a.v);
  let last = -Infinity;
  for (const e of ends) { e.y = Math.max(y(e.v), last + 15); last = e.y; }
  const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
  return <figure className="profit-chart">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Profit over time per AI">
      {ticks.map(v => <g key={v} className={v === 0 ? 'zero' : 'grid'}>
        <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
        <text x={L - 8} y={y(v) + 4} textAnchor="end">{money(v)}</text>
      </g>)}
      <text className="axis" x={L} y={H - 6}>{fmt.format(t0)}</text>
      <text className="axis" x={W - R} y={H - 6} textAnchor="end">{fmt.format(t1)}</text>
      <g className="chart-draw">
      {series.map((r, i) => {
        const pts = [...r.stats.curve, { t: Date.now(), balance: r.stats.curve.at(-1).balance }];
        const d = pts.map((p, j) => (j ? 'H' + x(p.t).toFixed(1) + 'V' : 'M' + x(p.t).toFixed(1) + ',') + y(p.balance - r.stats.deposit).toFixed(1)).join('');
        return <path key={r.key} d={d} className={'series s' + i} strokeDasharray={DASHES[rows.indexOf(r) % DASHES.length]} />;
      })}
      </g>
      {ends.map(e => <text key={e.r.key} className="end-label" x={W - R + 8} y={e.y + 4}>{e.r.short} {money(e.v)}</text>)}
    </svg>
    <figcaption>Net profit in RON for the current season. Steps happen when tickets settle.</figcaption>
  </figure>;
}

function DailyGrid({ rows }) {
  const days = dailyProfit([], 10).map(d => d.day);
  return <div className="daily-wrap"><table className="daily">
    <caption>Profit per day, last 10 days (RON)</caption>
    <thead><tr><th scope="col">Account</th>{days.map(d => <th scope="col" key={d}>{d.slice(8)}<small>{new Date(d + 'T12:00Z').toLocaleDateString(undefined, { month: 'short' })}</small></th>)}<th scope="col">Total</th></tr></thead>
    <tbody>{rows.map(r => {
      const daily = dailyProfit(r.tickets, 10);
      const total = daily.reduce((s, d) => s + d.profit, 0);
      return <tr key={r.key}><th scope="row">{r.name}</th>
        {daily.map((d, j) => <td key={d.day} className={d.count ? 'pl-' + trend(d.profit) : 'none'} title={d.count + ' settled'} style={{ transitionDelay: j * 35 + 'ms' }}>{d.count ? money(d.profit) : '·'}</td>)}
        <td className={'total pl-' + trend(total)}>{money(total)}</td></tr>;
    })}</tbody>
  </table></div>;
}

/** Progress of the fixed-length test period (online engine only). */
function TestBanner({ test }) {
  const fmt = ms => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const now = Date.now();
  const day = testDay(test.start, now, test.days);
  const done = now >= test.end;
  return <div className="test-banner" role="status">
    <div><strong>{done ? (test.finished ? 'Test finished: final results' : 'Test over: waiting for the last tickets to settle') : 'Test period · day ' + day + ' of ' + test.days}</strong>
      <span>{fmt(test.start)} to {fmt(test.end)}{done ? ' · no new bets' : ' · every AI started at 200 RON'}</span></div>
    {!done && <div className="test-progress" aria-hidden="true"><span style={{ width: Math.round(100 * (now - test.start) / (test.end - test.start)) + '%' }} /></div>}
  </div>;
}

export default function Leaderboard() {
  const { account, aiAction, error } = useBetContext();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const rows = useMemo(() => {
    const out = Object.entries(AIS).map(([key, meta]) => {
      const wallet = account.ais[key] || { season: 1, deposit: STARTING_BALANCE * 100 };
      const tickets = account.tickets.filter(t => t.source === 'ai' && t.strategy === key && (t.season || 1) === wallet.season);
      return { key, ...meta, wallet, tickets, stats: aiStats(tickets, wallet.deposit / 100) };
    });
    const manualSeason = account.ais.manual?.season || 1;
    const manual = account.tickets.filter(t => t.source === 'manual' && (t.season || 1) === manualSeason);
    if (manual.length) out.push({ key: 'manual', ...MANUAL, manual: true, wallet: account.ais.manual || {}, tickets: manual, stats: aiStats(manual, 0) });
    return out.sort((a, b) => b.stats.profit - a.stats.profit || b.stats.roi - a.stats.roi);
  }, [account]);

  async function run(key, action, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key + action); setMessage('');
    try { await aiAction(key, action); setMessage(action === 'scan' ? 'Scan requested. New tickets appear within a minute.' : 'Saved.'); }
    catch (e) { setMessage(e.message); }
    finally { setBusy(''); }
  }

  const totals = rows.filter(r => !r.manual).reduce((s, r) => ({ profit: s.profit + r.stats.profit, pending: s.pending + r.stats.pending, reserved: s.reserved + r.stats.reserved }), { profit: 0, pending: 0, reserved: 0 });
  const models = account.engine?.models || {};
  const status = error ? 'Server unreachable · ' + error : account.engine?.error ||
    ('Engine checked ' + ago(account.engine?.lastTick) + ' · ' + (models.status === 'ready' ? 'models trained on ' + models.results?.toLocaleString() + ' results' : models.status === 'failed' ? 'model training failed, retrying' : 'learning team ratings…'));

  return <section className="leaderboard" aria-labelledby="lb-title">
    <Reveal as="div" className="trial-heading">
      <div><h2 id="lb-title">AI leaderboard</h2><p role="status">{status}</p></div>
      <div className="lb-total"><small>All AIs combined</small><PL value={totals.profit} size="lg" animated /><small>{totals.pending} open · {totals.reserved.toFixed(2)} RON at risk</small></div>
    </Reveal>

    {account.test && <TestBanner test={account.test} />}

    <Reveal as="div" className="lb-table-wrap" delay={0.05}><table className="lb-table">
      <thead><tr>
        <th scope="col">#</th><th scope="col">Account</th><th scope="col" className="num">Profit / loss</th><th scope="col" className="num">ROI</th>
        <th scope="col" className="num">Balance</th><th scope="col" className="num">Won-lost</th><th scope="col" className="num">Last 7 days</th>
        <th scope="col" className="num" title="Closing line value: how much better our price was than the last price before kickoff. Positive over many bets indicates real skill.">CLV</th>
        <th scope="col" className="num" title="Largest fall from a peak balance">Max drop</th><th scope="col">Trend</th>
      </tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.key} className={r.wallet.enabled === false ? 'paused' : ''}>
        <td className="rank">{i + 1}</td>
        <th scope="row"><Link to={r.manual ? '/my-bets' : '/auto-pilot?strategy=' + r.key}>{r.name}</Link><small>{r.manual ? 'Your bet slips' : r.method}{r.wallet.enabled === false ? ' · paused' : ''}</small></th>
        <td className="num"><PL value={r.stats.profit} animated /></td>
        <td className={'num pl-' + trend(r.stats.roi)}>{r.stats.settled ? percent(r.stats.roi) : '-'}</td>
        <td className="num">{r.manual ? '-' : r.stats.balance.toFixed(2)}<small>{r.stats.pending} open{r.stats.reserved ? ' · ' + r.stats.reserved.toFixed(2) : ''}</small></td>
        <td className="num">{r.stats.won}-{r.stats.lost}<small>{r.stats.settled ? percent(r.stats.winRate, false) + ' won' : 'none settled'}</small></td>
        <td className="num"><PL value={r.stats.week} /></td>
        <td className={'num pl-' + trend(r.stats.clv || 0)}>{percent(r.stats.clv)}<small>{r.stats.clvCount ? r.stats.clvCount + ' bets' : ''}</small></td>
        <td className="num">{r.stats.settled && r.stats.drawdown !== null ? percent(-r.stats.drawdown) : '-'}</td>
        <td><Sparkline curve={r.stats.curve} deposit={r.stats.deposit} /></td>
      </tr>)}</tbody>
    </table></Reveal>
    <p className="trial-caption">Each AI starts every season with {STARTING_BALANCE} RON of practice money. Ranked by profit. ROI = profit ÷ amount staked on settled tickets. A positive CLV over 50+ bets is the strongest early sign an AI has a real edge, because it is far less noisy than win rate.</p>

    <Reveal as="div"><h3 className="lb-sub">Profit over time</h3>
    <ProfitChart rows={rows} /></Reveal>

    <Reveal as="div"><h3 className="lb-sub">Day by day</h3>
    <DailyGrid rows={rows} /></Reveal>

    <h3 className="lb-sub">The AIs</h3>
    <Reveal as="div" className="strategy-grid ai-grid">{Object.entries(AIS).map(([key, meta]) => {
      const row = rows.find(r => r.key === key);
      const wallet = account.ais[key] || {};
      return <article className="strategy-summary" key={key}>
        <h3>{meta.name} <small>Season {wallet.season || 1}</small></h3>
        <div className="balance"><PL value={row.stats.profit} size="card" animated /><small>{row.stats.available.toFixed(2)} RON available{row.stats.streak ? ', ' + Math.abs(row.stats.streak) + (row.stats.streak > 0 ? ' won' : ' lost') + ' in a row' : ''}</small></div>
        <dl>
          <div><dt>Today</dt><dd><PL value={row.stats.day} /></dd></div>
          <div><dt>Last 30 days</dt><dd><PL value={row.stats.month} /></dd></div>
          <div><dt>Average odds</dt><dd>{row.stats.settled ? row.stats.averageOdds.toFixed(2) : '-'}</dd></div>
          <div><dt>Last scan</dt><dd>{ago(wallet.lastScan)}</dd></div>
        </dl>
        <p className="scan-note">{wallet.enabled === false ? 'Paused. No new tickets until resumed.' : wallet.note || 'Waiting for the first scan.'}</p>
        <details className="method"><summary>How it bets</summary><p>{meta.description}</p></details>
        {!STATIC && <div className="ai-actions">
          <button disabled={!!busy} onClick={() => run(key, wallet.enabled === false ? 'enable' : 'pause')}>{wallet.enabled === false ? 'Resume' : 'Pause'}</button>
          <button disabled={!!busy || wallet.enabled === false} onClick={() => run(key, 'scan')}>Scan now</button>
          <button disabled={!!busy} onClick={() => run(key, 'new-season', 'Start a new season for ' + meta.name + '? Its balance goes back to ' + STARTING_BALANCE + ' RON. Old tickets stay in the history.')}>New season</button>
        </div>}
        <Link to={'/auto-pilot?strategy=' + key}>View tickets <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" /></Link>
      </article>;
    })}</Reveal>
    {message && <p role="status" className="trial-caption">{message}</p>}
  </section>;
}
