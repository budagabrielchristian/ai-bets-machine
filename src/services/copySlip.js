// Read a ticket copied as text from Betano or Superbet and match it to the
// fixtures in our feed. Pure functions: used by the server (which decides) and
// by tests. Nothing here talks to the bookmakers.

const STOP = new Set(['fc', 'afc', 'cf', 'sc', 'ac', 'ssc', 'ss', 'us', 'the', 'club', 'de', 'cd', 'ud', 'rc', 'sv', 'tsv', 'vfl', 'vfb', 'bsc', 'calcio', 'football', 'cp', 'as', 'sk', 'fk', 'nk']);
// Words many clubs share: never enough on their own to recognise a team.
const GENERIC = new Set(['united', 'city', 'town', 'real', 'sporting', 'athletic', 'atletico', 'borussia', 'olympique', 'racing', 'deportivo',
  'inter', 'internacional', 'independiente', 'universidad', 'union', 'dynamo', 'dinamo', 'rovers', 'wanderers', 'albion', 'county',
  'saint', 'san', 'santa', 'nacional', 'stade', 'stadium', 'young', 'boys', 'jong', 'u17', 'u19', 'u21', 'u23', 'women', 'west', 'north', 'south']);

// Romanian bookmaker spellings and short names for ESPN team names.
const ALIASES = {
  'bayern munich': ['bayern munchen', 'bayern'], 'fc cologne': ['koln', 'fc koln', '1 fc koln'], 'internazionale': ['inter', 'inter milano', 'inter milan'],
  'ac milan': ['milan'], 'as roma': ['roma'], 'ssc napoli': ['napoli'], 'manchester united': ['man utd', 'man united', 'manchester utd'],
  'manchester city': ['man city'], 'paris saint germain': ['psg', 'paris sg', 'paris saint germain'], 'tottenham hotspur': ['tottenham', 'spurs'],
  'wolverhampton wanderers': ['wolves', 'wolverhampton'], 'brighton and hove albion': ['brighton'], 'newcastle united': ['newcastle'],
  'west ham united': ['west ham'], 'nottingham forest': ['nottingham', 'nottm forest'], 'atletico madrid': ['atl madrid', 'atletico madrid'],
  'athletic club': ['athletic bilbao', 'ath bilbao', 'bilbao'], 'borussia monchengladbach': ['gladbach', 'monchengladbach', 'm gladbach'],
  'borussia dortmund': ['dortmund'], 'bayer leverkusen': ['leverkusen'], 'rb leipzig': ['leipzig'], 'eintracht frankfurt': ['frankfurt'],
  'sporting cp': ['sporting lisabona', 'sporting lisbon'], 'fc porto': ['porto'], 'red star belgrade': ['steaua rosie', 'crvena zvezda'],
  'fcsb': ['steaua', 'fcsb'], 'universitatea craiova': ['u craiova', 'univ craiova', 'universitatea craiova'], 'rapid bucuresti': ['rapid'],
  'cfr cluj': ['cfr', 'cfr cluj'], 'real betis': ['betis'], 'celta vigo': ['celta'], 'olympique lyonnais': ['lyon'], 'olympique marseille': ['marseille'],
  'marseille': ['olympique marseille'], 'lyon': ['olympique lyon'], 'as monaco': ['monaco'], 'psv eindhoven': ['psv'], 'ajax amsterdam': ['ajax'],
  'bodo glimt': ['bodo glimt', 'bodo'], 'hellas verona': ['verona'], 'como': ['como 1907'],
  'aek athens': ['aek atena'], 'olympiacos': ['olympiakos', 'olympiacos pireu'], 'fc copenhagen': ['fc copenhaga', 'copenhaga'],
  'shakhtar donetsk': ['sahtior donetk', 'sahtior', 'shakhtar'], 'dynamo kyiv': ['dinamo kiev', 'dynamo kiev'],
  'slavia prague': ['slavia praga'], 'sparta prague': ['sparta praga'], 'legia warsaw': ['legia varsovia'],
  'benfica': ['benfica lisabona'], 'red bull salzburg': ['salzburg', 'rb salzburg'], 'union st gilloise': ['union saint gilloise'],
};

const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae');
/** Words only: punctuation, dots and commas become spaces. */
export const norm = s => plain(s).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

function teamKeys(name) {
  const full = norm(name);
  const words = full.split(' ');
  const core = words.filter(w => !STOP.has(w)).join(' ');
  const strong = new Set([full, core, ...(ALIASES[full] || []), ...(ALIASES[core] || [])].filter(k => k && k.length >= 3));
  // A single distinctive word (e.g. "Magdeburg") is a weaker hint.
  const weak = words.filter(w => w.length >= 5 && !STOP.has(w) && !GENERIC.has(w) && !/^\d+$/.test(w));
  return { strong: [...strong].sort((a, b) => b.length - a.length), weak };
}

const hasWord = (text, key) => (' ' + text + ' ').includes(' ' + key + ' ');

/** How well a team name shows in normalised text: 2 strong, 1 weak, 0 not at all. */
function teamScore(text, keys) {
  if (keys.strong.some(k => hasWord(text, k))) return 2;
  if (keys.weak.some(k => hasWord(text, k))) return 1;
  return 0;
}

function removeTeam(text, keys) {
  let out = ' ' + text + ' ';
  for (const k of [...keys.strong, ...keys.weak]) out = out.split(' ' + k + ' ').join(' ');
  return out.trim();
}

const SUMMARY = /(cota totala|cote totale|total odds|miza|suma pariata|stake|castig|plata|potential|bonus|taxa|impozit|cod bilet|booking code|id bilet)/;
const UNSUPPORTED = [
  [/\b(ambele|gg|ng|btts|both teams)\b/, 'Both teams to score is not supported yet'],
  [/\b(sansa dubla|dubla sansa|double chance|1x|x2|12)\b/, 'Double chance is not supported yet'],
  [/\b(pauza|repriza|prima|half|interval|r1|r2)\b/, 'Half-time markets are not supported'],
  [/\b(corner|cornere|cornerele|cartonase|cartonas|cards|faulturi|suturi|shots)\b/, 'Corners, cards and shots are not supported'],
  [/\b(marcheaza|marcator|scorer|scor corect|correct score|rezultat exact)\b/, 'Scorer and exact-score bets are not supported'],
  [/\b(handicap|hcp|fara egal|draw no bet)\b/, 'Handicap and draw-no-bet are not supported yet'],
  [/\b(echipa gazda|echipa oaspete|goluri gazde|goluri oaspeti|team total)\b/, 'Team goal totals are not supported'],
];

// Dates, times, counts and decimals would otherwise look like the picks 1, 2 or 12.
const withoutNoise = l => l
  .replace(/\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?/g, ' ').replace(/\d{1,2}:\d{2}/g, ' ')
  .replace(/\b\d{1,2}\s+(ian|feb|mar|apr|mai|iun|iul|aug|sep|oct|noi|nov|dec)[a-z]*\.?/g, ' ')
  .replace(/\b(liga|league|ligue|divizia|serie|bundesliga|division|primera|superliga|eliteserien)\s*\d\b/g, ' ')
  .replace(/\b\d\.?\s*(bundesliga|liga|ligue|division|divizia|lig)\b/g, ' ')
  .replace(/\(\s*\d+\s*\)/g, ' ').replace(/\b\d+\s*(selectii|selectie|evenimente|eveniment|meciuri|pariuri|legs|selections)\b/g, ' ')
  .replace(/\d+[.,]\d+/g, ' ');

/** Odds-like numbers in a line: two decimals, not part of a date or time. */
function oddsIn(line) {
  const l = plain(line);
  if (/\b(ron|lei|eur)\b/.test(l) || SUMMARY.test(l)) return [];
  const cleaned = l.replace(/\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?[.,]?\s*,?\s*\d{1,2}:\d{2}/g, ' ').replace(/\d{1,2}:\d{2}/g, ' ')
    .replace(/(peste|over|sub|under)\s*[+-]?\d+[.,]\d+/g, ' ');
  return [...cleaned.matchAll(/(?<![\w.,])(\d{1,3}[.,]\d{2})(?![\w.,]|\d)/g)].map(m => Number(m[1].replace(',', '.')))
    .filter(p => p >= 1.01 && p <= 1000);
}

/** Find which feed fixtures appear in the text, in order. */
function findEvents(lines, fixtures) {
  const prepared = fixtures.map(m => ({ m, home: teamKeys(m.home_team), away: teamKeys(m.away_team) }));
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    if (events.length && events[events.length - 1].end >= i) continue;
    for (const span of [1, 2]) {
      if (i + span > lines.length) break;
      const text = lines.slice(i, i + span).map(norm).join(' ');
      const first = norm(lines[i]), second = span === 2 ? norm(lines[i + 1]) : '';
      let best = null;
      for (const p of prepared) {
        const h = teamScore(text, p.home), a = teamScore(text, p.away);
        if (!h || !a) continue;
        // Over two lines: one team on each (home first), not a stray word.
        if (span === 2 && (!(teamScore(first, p.home) && teamScore(second, p.away)) || (teamScore(second, p.home) && teamScore(second, p.away)))) continue;
        const score = h + a;
        if (!best || score > best.score) best = { ...p, score };
      }
      if (best) { events.push({ start: i, end: i + span - 1, match: best.m, keys: [best.home, best.away] }); break; }
    }
  }
  return events;
}

/** Read the pick, market and price from the lines that belong to one fixture. */
function readLeg(event, blockLines, match) {
  const [homeKeys, awayKeys] = event.keys;
  const isEventLine = idx => idx >= event.start && idx <= event.end;
  const parts = blockLines.filter(b => !SUMMARY.test(plain(b.text)));
  // Words of the block with the team names taken out of the fixture line, and decimals hidden.
  const words = parts.map(b => {
    const n = norm(withoutNoise(plain(b.text)));
    return isEventLine(b.idx) ? removeTeam(removeTeam(n, homeKeys), awayKeys) : n;
  }).join(' ');
  const raw = parts.map(b => plain(b.text)).join('\n');
  const leg = { matchId: match.id, matchTitle: match.home_team + ' vs ' + match.away_team, teams: [match.home_team, match.away_team],
    competition: match.sport_title, matchDate: match.commence_time };
  const prices = parts.flatMap(b => oddsIn(isEventLine(b.idx) ? removeTeamRaw(b.text, match) : b.text));
  leg.price = prices.length ? prices[prices.length - 1] : undefined;

  for (const [pattern, reason] of UNSUPPORTED) if (pattern.test(words)) return { ...leg, problem: reason };

  const total = raw.match(/\b(peste|over|sub|under)\s*\+?\s*(\d+[.,]5)\b/) ||
    (/\btotal/.test(raw) && raw.match(/(?:^|\s)([+-])\s*(\d+[.,]5)\b/));
  if (total) {
    const side = ['peste', 'over', '+'].includes(total[1]) ? 'over' : 'under';
    const line = Number(total[2].replace(',', '.'));
    return { ...leg, market: 'total', side, line, selection: 'Total goals - ' + side + ' ' + line, ...(leg.price ? {} : { problem: 'No odds found for this pick' }) };
  }
  if (/\b(peste|over|sub|under|total)\b/.test(words)) return { ...leg, problem: 'Could not read the goal line' };

  // 1X2: "1", "X", "2", a draw word, or a team name written on its own line.
  const picks = new Set();
  for (const t of words.split(' ')) {
    if (t === '1') picks.add('home');
    if (t === 'x' || t === 'egal' || t === 'egalitate' || t === 'draw') picks.add('draw');
    if (t === '2') picks.add('away');
  }
  for (const b of parts) {
    if (isEventLine(b.idx)) continue;
    const n = norm(b.text);
    if (teamScore(n, homeKeys) === 2 && !teamScore(n, awayKeys)) picks.add('home');
    if (teamScore(n, awayKeys) === 2 && !teamScore(n, homeKeys)) picks.add('away');
  }
  if (picks.size !== 1) return { ...leg, problem: picks.size ? 'More than one pick found for this match' : 'Could not read the pick (1, X or 2)' };
  const side = [...picks][0];
  const selection = side === 'home' ? match.home_team : side === 'away' ? match.away_team : 'Draw';
  return { ...leg, market: 'h2h', side, selection, ...(leg.price ? {} : { problem: 'No odds found for this pick' }) };
}

// Team names can hold numbers ("Schalke 04", "Darmstadt 98"); drop the line's
// words that belong to the names before looking for odds.
function removeTeamRaw(text, match) {
  const names = new Set([...norm(match.home_team).split(' '), ...norm(match.away_team).split(' ')]);
  return plain(text).split(/\s+/).filter(w => !names.has(norm(w))).join(' ');
}

function readStake(text) {
  const m = plain(text).match(/(miza(?: totala)?|suma pariata|stake)\s*:?\s*(?:ron|lei)?\s*(\d+(?:[.,]\d{1,2})?)/);
  return m ? Number(m[2].replace(',', '.')) : undefined;
}

function readTotalOdds(text) {
  const m = plain(text).match(/(cota totala|cote totale|total odds)\s*:?\s*(\d+(?:[.,]\d{1,2})?)/);
  return m ? Number(m[2].replace(',', '.')) : undefined;
}

export function detectBookmaker(text) {
  const t = plain(text);
  if (t.includes('betano')) return 'Betano';
  if (t.includes('superbet')) return 'Superbet';
  return null;
}

/** The feed's own price for a pick (main book first), for comparison. */
function feedPriceFor(match, leg) {
  const books = [...(match.bookmakers || [])].sort((x, y) => Number(Boolean(x.extra)) - Number(Boolean(y.extra)));
  for (const b of books) {
    const market = b.markets?.find(m => m.key === leg.market);
    const o = market && (leg.market === 'h2h' ? market.outcomes.find(x => x.name === leg.selection)
      : market.outcomes.find(x => x.side === leg.side && x.line === leg.line));
    if (o && Number.isFinite(o.price)) return o.price;
  }
  return undefined;
}

const LINK = /^\[(.+?)\]\((https?:\/\/[^)\s]+)\)$/;
const isBuilder = t => /^bet ?builder$/i.test(plain(t).trim());
const oddsLine = t => /^\d{1,3}[.,]\d{2}$/.test(String(t || '').trim()) ? Number(String(t).trim().replace(',', '.')) : undefined;

function bestFixture(home, away, prepared) {
  const h = norm(home), a = norm(away);
  let best = null;
  for (const p of prepared) {
    const score = teamScore(h, p.home) && teamScore(a, p.away) ? teamScore(h, p.home) + teamScore(a, p.away) : 0;
    if (score && (!best || score > best.score)) best = { ...p, score };
  }
  return best;
}

const HALF_OR_FULL = '"Pauză sau Final" (win at half-time or full-time) cannot be settled: the results feed has no half-time scores';

/** One Betano pick: its name ("Chelsea FC", "Peste 1.5") and its market ("Rezultat final"). */
function betanoPick(pick, market, entry, fx) {
  const m = norm(market), p = norm(pick.replace(/^\*\s*/, ''));
  if (/pauza sau final/.test(m)) return { problem: HALF_OR_FULL };
  if (/\b(pauza|repriza)\b/.test(m)) return { problem: 'Half-time markets are not supported' };
  if (/^(rezultat final|final|1x2)$/.test(m)) {
    let side = null;
    if (p === norm(entry.home) || (teamScore(p, fx.home) === 2 && !teamScore(p, fx.away)) || p === '1') side = 'home';
    else if (p === norm(entry.away) || (teamScore(p, fx.away) === 2 && !teamScore(p, fx.home)) || p === '2') side = 'away';
    else if (/^(x|egal|egalitate|draw)$/.test(p)) side = 'draw';
    if (!side) return { problem: 'Could not read the pick "' + pick + '"' };
    return { market: 'h2h', side, selection: side === 'home' ? fx.m.home_team : side === 'away' ? fx.m.away_team : 'Draw' };
  }
  if (/^total goluri( peste sub)?$/.test(m)) {
    const t = plain(pick).match(/(peste|sub|over|under)\s*(\d+[.,]5)\b/);
    if (!t) return { problem: 'Could not read the goal line "' + pick + '"' };
    const side = ['peste', 'over'].includes(t[1]) ? 'over' : 'under', line = Number(t[2].replace(',', '.'));
    return { market: 'total', side, line, selection: 'Total goals - ' + side + ' ' + line };
  }
  return { problem: 'The market "' + market + '" is not supported yet (only Rezultat final and Total goluri)' };
}

/**
 * Betano's betslip copied from the website: every match has its two teams as
 * links to the same match page. A single pick sits just above them
 * (pick, odds, market); a Bet Builder has "[Bet Builder](link)" and the odds
 * above them and its picks as "* pick" + market lines below.
 */
function readBetano(lines, prepared) {
  const links = lines.map(l => { const m = l.match(LINK); return m ? { text: m[1].trim(), url: m[2] } : null; });
  const textOf = k => links[k] ? links[k].text : lines[k];
  const entries = [];
  const add = (home, away, at, teamsEnd) => {
    const builder = at >= 2 && isBuilder(textOf(at - 2));
    const start = builder ? (at >= 3 && isBuilder(textOf(at - 3)) ? at - 3 : at - 2) : Math.max(0, at - 3);
    entries.push({ home, away, at, teamsEnd, builder, start });
  };
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = links[i], b = links[i + 1];
    if (a && b && a.url === b.url && !isBuilder(a.text) && !isBuilder(b.text)) { add(a.text, b.text, i, i + 1); i++; continue; }
    // Copied without links (the app): each team name appears twice, "A, A, B, B".
    const [w, x, y, z] = lines.slice(i, i + 4);
    if (!a && z !== undefined && w === x && y === z && w !== y && !oddsLine(w) && !oddsLine(y) && !isBuilder(w) && !isBuilder(y) &&
        !/^\*/.test(w) && /[a-z]/i.test(w) && /[a-z]/i.test(y)) { add(w, y, i, i + 3); i += 3; }
  }
  const legs = [], warnings = [];
  entries.forEach((e, n) => {
    const fx = bestFixture(e.home, e.away, prepared);
    if (!fx) { warnings.push('Not found in the fixture list: ' + e.home + ' - ' + e.away); return; }
    const base = { matchId: fx.m.id, matchTitle: fx.m.home_team + ' vs ' + fx.m.away_team, teams: [fx.m.home_team, fx.m.away_team],
      competition: fx.m.sport_title, matchDate: fx.m.commence_time };
    if (!e.builder) {
      const price = oddsLine(lines[e.at - 2]);
      const pick = betanoPick(lines[e.at - 3] || '', lines[e.at - 1] || '', e, fx);
      legs.push({ ...base, price, ...pick, ...(price || pick.problem ? {} : { problem: 'No odds found for this pick' }) });
      return;
    }
    const price = oddsLine(lines[e.at - 1]);
    const end = n + 1 < entries.length ? entries[n + 1].start : lines.length;
    const picks = [];
    // After the teams and the kickoff time: "* pick" + market lines, or plain pick/market pairs.
    const rest = lines.slice(e.teamsEnd + 1, end).filter(l => !/^(astazi|azi|diseara|maine|poimaine|luni|marti|miercuri|joi|vineri|sambata|duminica)?\b.*\d{1,2}:\d{2}$/.test(plain(l)) &&
      !/^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(l));
    if (rest.some(l => /^\*\s*/.test(l))) {
      rest.forEach((l, k) => { if (/^\*\s*/.test(l)) picks.push(betanoPick(l, rest[k + 1] && !/^\*/.test(rest[k + 1]) ? rest[k + 1] : '', e, fx)); });
    } else {
      for (let k = 0; k + 1 < rest.length; k += 2) picks.push(betanoPick(rest[k], rest[k + 1], e, fx));
    }
    if (!picks.length || !price) { legs.push({ ...base, price, problem: 'Could not read this Bet Builder' }); return; }
    const bad = picks.find(p => p.problem);
    // The odds are for the whole Bet Builder; each pick gets an equal share so the product stays right.
    const share = Number((price ** (1 / picks.length)).toFixed(4));
    picks.forEach(p => legs.push({ ...base, ...p, price: share, builderPrice: price, builderId: 'b' + n,
      ...(bad && !p.problem ? { problem: 'Another pick in this Bet Builder cannot be copied' } : {}) }));
  });
  return { legs, warnings, found: entries.length };
}

/** Any other text: find the fixtures by team names and read the lines around them. */
function readGeneric(lines, upcoming) {
  const events = findEvents(lines, upcoming);
  // "mixed": the pick sits before the fixture and the odds after it.
  const oddsEnd = events.map((e, i) => {
    const limit = i + 1 < events.length ? events[i + 1].start - 1 : lines.length - 1;
    for (let k = e.start; k <= limit; k++) if (oddsIn(lines[k]).length) return k;
    return e.end;
  });
  const read = layout => events.map((e, i) => {
    const from = layout === 'after' ? e.start : i ? (layout === 'mixed' ? oddsEnd[i - 1] : events[i - 1].end) + 1 : 0;
    const to = layout === 'after' ? (i + 1 < events.length ? events[i + 1].start - 1 : lines.length - 1)
      : layout === 'mixed' ? oddsEnd[i] : e.end;
    const block = [];
    for (let k = from; k <= to; k++) block.push({ idx: k, text: lines[k] });
    return readLeg(e, block, e.match);
  });
  const good = legs => legs.filter(l => !l.problem).length;
  let legs = read('after');
  for (const layout of ['mixed', 'before']) {
    const other = read(layout);
    if (good(other) > good(legs)) legs = other;
  }
  // Never save a ticket that silently lost a match: lines that look like a
  // fixture ("Team A - Team B") but were not found are reported.
  const used = new Set(events.flatMap(e => Array.from({ length: e.end - e.start + 1 }, (_, k) => e.start + k)));
  const unmatched = lines.filter((l, i) => !used.has(i) && !SUMMARY.test(plain(l)) &&
    /[a-z]{2}.*\s(-|–|—|·|vs\.?|v)\s.*[a-z]{2}/i.test(plain(l)) &&
    !/\b(liga|league|ligue|bundesliga|serie|divizia|cup|cupa|fotbal|football|soccer|championship|primera|eredivisie|superliga)\b/.test(plain(l)));
  return { legs, warnings: unmatched.map(l => 'Not found in the fixture list: ' + l), found: events.length };
}

/**
 * Parse pasted ticket text against the feed fixtures. Betano's website format
 * (team links) is read exactly; anything else is read by team names, trying
 * the pick and odds before and after the fixture name.
 */
export function parseSlipText(text, fixtures, now = Date.now()) {
  const raw = String(text || '').slice(0, 30000).split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 600);
  const upcoming = fixtures.filter(m => Number.isFinite(Date.parse(m.commence_time)));
  const prepared = upcoming.map(m => ({ m, home: teamKeys(m.home_team), away: teamKeys(m.away_team) }));
  let result = readBetano(raw, prepared);
  if (!result || !result.found) {
    // Links copied from other pages: keep only their text.
    const lines = raw.map(l => l.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\*\s*/, '').trim()).filter(Boolean);
    result = readGeneric(lines, upcoming);
  }
  const { legs, warnings } = result;
  const byId = new Map(upcoming.map(m => [m.id, m]));

  for (const leg of legs) {
    const match = byId.get(leg.matchId);
    if (!leg.problem && (Date.parse(match.commence_time) <= now || (match.statusName && match.statusName !== 'STATUS_SCHEDULED'))) {
      leg.problem = 'This match has already started';
    }
    if (leg.market) leg.feedPrice = feedPriceFor(match, leg);
    // A price far from the feed's usually means the pick was read wrong.
    if (!leg.problem && !leg.builderId && leg.feedPrice && leg.price && Math.abs(Math.log(leg.price / leg.feedPrice)) > Math.log(1.35)) {
      leg.problem = 'Ticket odds ' + leg.price.toFixed(2) + ' are far from the feed’s ' + leg.feedPrice.toFixed(2) +
        ' for this pick, so it was probably read wrong';
    }
  }
  const owner = new Map();
  for (const leg of legs) {
    const group = leg.builderId || leg;
    if (owner.has(leg.matchId) && owner.get(leg.matchId) !== group && !leg.problem) leg.problem = 'Two picks on the same match cannot be copied';
    if (!owner.has(leg.matchId)) owner.set(leg.matchId, group);
  }
  const ok = legs.filter(l => !l.problem);
  const seenBuilder = new Set();
  const totalOdds = ok.length ? Number(ok.reduce((p, l) => {
    if (!l.builderId) return p * l.price;
    if (seenBuilder.has(l.builderId)) return p;
    seenBuilder.add(l.builderId);
    return p * l.builderPrice;
  }, 1).toFixed(2)) : null;
  const statedOdds = readTotalOdds(text);
  if (statedOdds && totalOdds && ok.length === legs.length && Math.abs(statedOdds / totalOdds - 1) > 0.02) {
    warnings.push('The ticket says total odds ' + statedOdds + ' but the picks read multiply to ' + totalOdds + '.');
  }
  return { legs, bookmaker: detectBookmaker(text), stake: readStake(text), statedOdds, totalOdds, warnings };
}
