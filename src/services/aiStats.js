// Profit and loss figures for one AI (or the manual account).
const DAY = 86400000;

export function settledAt(ticket) {
  if (ticket.settledAt) return Date.parse(ticket.settledAt);
  const last = Math.max(...ticket.selections.map(s => Date.parse(s.matchDate || ticket.matchDate || ticket.datePlaced)));
  return Number.isFinite(last) ? last + 2 * 3600000 : Date.parse(ticket.datePlaced);
}

/** Net result of a settled ticket in RON (0 for pending or refunded). */
export function ticketProfit(ticket) {
  if (ticket.status === 'won') return Number(ticket.potentialReturn) - Number(ticket.stake);
  if (ticket.status === 'lost') return -Number(ticket.stake);
  return 0;
}

/** Closing line value of a single-leg ticket: how much better our price was than the last price before kickoff. */
export function ticketClv(ticket, now = Date.now()) {
  // Only final once the match has kicked off.
  const values = ticket.selections.filter(s => s.closingPrice > 1 && s.price > 1 && Date.parse(s.matchDate) <= now)
    .map(s => s.price / s.closingPrice - 1);
  if (!values.length || values.length !== ticket.selections.length) return null;
  return values.reduce((product, v) => product * (1 + v), 1) - 1;
}

export function aiStats(tickets, deposit, now = Date.now()) {
  const settled = tickets.filter(t => t.status === 'won' || t.status === 'lost')
    .sort((a, b) => settledAt(a) - settledAt(b));
  const pending = tickets.filter(t => t.status === 'pending');
  const won = settled.filter(t => t.status === 'won').length;
  const staked = settled.reduce((s, t) => s + Number(t.stake), 0);
  const profit = settled.reduce((s, t) => s + ticketProfit(t), 0);
  const reserved = pending.reduce((s, t) => s + Number(t.stake), 0);
  const window = days => settled.filter(t => now - settledAt(t) <= days * DAY).reduce((s, t) => s + ticketProfit(t), 0);

  // Equity curve and largest peak-to-trough fall.
  let balance = deposit, peak = deposit, drawdown = 0;
  const curve = [{ t: settled.length ? Math.min(...tickets.map(t => Date.parse(t.datePlaced))) : now, balance }];
  for (const t of settled) {
    balance += ticketProfit(t);
    peak = Math.max(peak, balance);
    drawdown = Math.max(drawdown, peak ? (peak - balance) / peak : 0);
    curve.push({ t: settledAt(t), balance });
  }

  const clvs = tickets.map(t => ticketClv(t, now)).filter(v => v !== null);
  let streak = 0;
  for (let i = settled.length - 1; i >= 0; i--) {
    const w = settled[i].status === 'won';
    if (i === settled.length - 1) streak = w ? 1 : -1;
    else if (w === streak > 0) streak += w ? 1 : -1;
    else break;
  }
  return {
    deposit, balance: deposit + profit, profit, reserved, available: deposit + profit - reserved,
    roi: staked ? profit / staked : 0, staked, settled: settled.length, won, lost: settled.length - won,
    refunded: tickets.filter(t => t.status === 'void').length, pending: pending.length,
    // A fall measured as a share of the bankroll needs a starting bankroll.
    winRate: settled.length ? won / settled.length : 0, drawdown: deposit > 0 ? drawdown : null, streak,
    day: window(1), week: window(7), month: window(30),
    clv: clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null, clvCount: clvs.length,
    averageOdds: settled.length ? settled.reduce((s, t) => s + Number(t.totalOdds), 0) / settled.length : 0,
    curve,
  };
}

/** Profit per calendar day (Europe/Bucharest) for the last `days` days. */
export function dailyProfit(tickets, days = 14, now = Date.now()) {
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' });
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push({ day: fmt.format(new Date(now - i * DAY)), profit: 0, count: 0 });
  const index = new Map(out.map((d, i) => [d.day, i]));
  for (const t of tickets) {
    if (t.status !== 'won' && t.status !== 'lost') continue;
    const i = index.get(fmt.format(new Date(settledAt(t))));
    if (i === undefined) continue;
    out[i].profit += ticketProfit(t);
    out[i].count++;
  }
  return out;
}
