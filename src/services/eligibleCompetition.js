// The five major European leagues and the Champions League (no Europa League,
// no Conference League, nothing else).
const ids = new Set(['eng.1','esp.1','ger.1','ita.1','fra.1','uefa.champions','soccer_epl']);
const names = new Set(['english premier league','laliga','spanish laliga','bundesliga','german bundesliga','serie a','italian serie a','ligue 1','french ligue 1','uefa champions league']);

export function eligibleCompetition(match) {
  if (match.leagueId || match.sport_key) return ids.has(match.leagueId || match.sport_key);
  const competition = (match.sport_title || '').split(',')[0].trim().toLowerCase();
  return names.has(competition);
}

/* ------------------------------------------------- 60/10 team rules --- */
// ESPN team ids, with name patterns as a fallback for feeds without ids.
const INTER = { id: '110', name: /internazionale|inter milan/i };
const COMO = { id: '2572', name: /^como\b/i };
const DORTMUND = { id: '124', name: /dortmund/i };
const PSV = { id: '148', name: /\bpsv\b/i };
const SERIE_A = '730'; // ESPN league number for Serie A

const NEVER = [DORTMUND, PSV];          // never bet on a match with these teams
const ITALY_ONLY = [INTER, COMO];       // the only Italian clubs allowed

const is = (team, side) => String(side.id) === team.id || team.name.test(side.name || '');

/**
 * 60/10 rules: top five leagues and Champions League only; Italian football
 * only when Inter or Como play; never Dortmund; never PSV.
 * `teamLeague(id)` gives a team's domestic league number (from the match
 * history), used to spot other Italian clubs in the Champions League.
 */
export function slipMatchAllowed(match, teamLeague = () => undefined) {
  if (!eligibleCompetition(match)) return false;
  const sides = [{ id: match.homeId, name: match.home_team }, { id: match.awayId, name: match.away_team }];
  if (sides.some(side => NEVER.some(team => is(team, side)))) return false;
  const allowedItalian = side => ITALY_ONLY.some(team => is(team, side));
  const serieA = match.league === SERIE_A || match.leagueId === 'ita.1' ||
    /^(italian )?serie a$/i.test((match.sport_title || '').split(',')[0].trim());
  if (serieA) return sides.some(allowedItalian);
  // Champions League: other Italian clubs are out too.
  return !sides.some(side => teamLeague(String(side.id)) === SERIE_A && !allowedItalian(side));
}
