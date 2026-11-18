import { rankMarkets } from './rankMarkets.js';

import { pilotCandidates } from './practice.js';

export function replaySeason(games, profile, limit) {
  const days = new Map();
  const winners = new Map();
  for (const game of games) {
    const names = [game.home, 'Draw', game.away];
    const id = [game.date, game.home, game.away].join('/');
    const bookmakers = ['bet365', 'pinnacle'].map(key => ({
      title: key === 'bet365' ? 'Bet365' : 'Pinnacle',
      markets: [{ key: 'h2h', outcomes: names.map((name, i) => ({ name, price: game[key][i] })) }]
    }));
    // Archive dates identify the daily slate. Kickoff hours are not used in this replay.
    const match = { id, commence_time: game.date + 'T12:00:00Z', home_team: game.home, away_team: game.away, bookmakers };
    if (!days.has(game.date)) days.set(game.date, []);
    days.get(game.date).push(match);
    winners.set(id, { H: game.home, D: 'Draw', A: game.away }[game.result]);
  }
  const rows = [];
  for (const date of [...days.keys()].sort()) {
    const now = new Date(date + 'T00:00:00Z');
    const slate = days.get(date);
    const picks = ['favorites','price'].includes(profile)
      ? pilotCandidates(slate, profile, now).slice(0,limit)
      : rankMarkets(slate, profile, limit, 'all', now);
    for (const pick of picks) {
      const winner = winners.get(pick.match.id);
      const won = pick.selection === winner;
      rows.push({ ...pick, date, winner, won, profit: won ? pick.price - 1 : -1 });
    }
  }
  const profit = rows.reduce((sum, row) => sum + row.profit, 0);
  return { rows, profit, wins: rows.filter(row => row.won).length };
}
