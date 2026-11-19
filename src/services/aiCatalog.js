// Shared by the server engine and the dashboard.
export const STARTING_BALANCE = 200; // RON per AI per season

export const AIS = {
  favorites: {
    name: 'Favorites',
    short: 'FAV',
    method: 'Favourite accumulators, flat 2% stakes',
    description: 'Picks home or away favourites the market rates at 60% or more (margin removed with the power method), at odds 1.20–1.80, and skips any the Poisson or Elo model rates 3+ points lower. Combines 2–4 of them per ticket (combined odds up to 6.00), never a single. Flat 2% of bankroll per ticket, at most 10% at risk.',
  },
  price: {
    name: 'Value hunter',
    short: 'VAL',
    method: 'Line shopping against sharp prices',
    description: 'Compares each bookmaker price with the no-vig price at other bookmakers (Pinnacle alone when available) and picks outcomes with at least 3% expected return. Combines 2–4 picks per ticket (combined odds up to 12.00), never a single. Quarter-Kelly stakes on the combined ticket, 4% cap. Needs multiple bookmakers, so it only bets when an Odds API key is configured.',
  },
  slips: {
    name: '60 / 10 slips',
    short: '60/10',
    method: '60 RON up to 3.50, 10 RON above',
    description: 'Slips of 2–4 matches (minimum 1.30 per match) from the Premier League, LaLiga, Bundesliga, Serie A, Ligue 1 and Champions League only (no Europa or Conference League). Italian football only when Inter or Como play; never Dortmund; never PSV. Combined odds 1.90–3.50 risk 60 RON (aiming near 2.50); combined odds 3.51–8.00 risk 10 RON (aiming near 5.00). Matches are ranked by model value. At most 2 open 60 RON slips and 4 open 10 RON slips at a time.',
  },
  elo: {
    name: 'Elo ratings',
    short: 'ELO',
    method: 'Elo team ratings vs the market',
    description: 'Rates every team from a year of results (K=20, home advantage 60, bigger moves for wider wins) and converts rating gaps into win/draw/loss chances with a curve fitted on past games. Picks outcomes where the 50/50 blend of model and market shows a 2.5%+ edge and combines 2–4 per ticket (combined odds up to 12.00), never a single. Quarter-Kelly stakes on the combined ticket, 3% cap.',
  },
  poisson: {
    name: 'Poisson model',
    short: 'POI',
    method: 'Dixon-Coles goal model',
    description: 'Estimates each team’s attack and defence per league from time-weighted results (half-life 180 days), then prices every scoreline with the Dixon-Coles low-score correction. Covers results, totals and handicaps. Picks outcomes where the 50/50 blend shows a 2.5%+ edge and combines 2–4 per ticket (combined odds up to 12.00), never a single. Quarter-Kelly stakes on the combined ticket, 3% cap.',
  },
};

export const MANUAL = { name: 'You (manual)', short: 'YOU' };
