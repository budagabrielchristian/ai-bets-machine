import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSlipText } from './copySlip.js';

const NOW = Date.parse('2026-11-21T10:00:00Z');
const fx = (id, home, away, hours = 8, title = 'Football') => ({ id, home_team: home, away_team: away, sport_title: title,
  commence_time: new Date(NOW + hours * 3600000).toISOString(), statusName: 'STATUS_SCHEDULED', bookmakers: [] });
const FIXTURES = [
  fx('1', 'Bayern Munich', 'FC Cologne', 6, 'Bundesliga'), fx('2', 'Arsenal', 'Chelsea', 9, 'Premier League'),
  fx('3', 'Internazionale', 'Como', 30, 'Italian Serie A'), fx('4', 'SV Darmstadt 98', '1. FC Heidenheim 1846', 5, '2. Bundesliga'),
  fx('5', 'Liverpool', 'Montevideo Wanderers', 12), fx('6', 'Liverpool', 'Manchester City', 26, 'Premier League'),
  fx('7', 'Manchester United', 'Everton', -2),
];

test('reads a Betano-style ticket: pick and market after the fixture', () => {
  const text = `Bilet combinat (3)
Bayern München - FC Köln
Sâm, 22.11, 16:30
Rezultat final
1
1.25
Arsenal - Chelsea
Total goluri
Peste 2.5
1,80
Inter - Como
Final
X
4.20
Cotă totală 9.45
Miză totală 10,00 RON
Câștig potențial 94,50 RON`;
  const r = parseSlipText(text, FIXTURES, NOW);
  assert.equal(r.legs.length, 3);
  assert.deepEqual(r.legs.map(l => l.problem), [undefined, undefined, undefined]);
  assert.deepEqual(r.legs.map(l => [l.matchId, l.market, l.selection, l.price]), [
    ['1', 'h2h', 'Bayern Munich', 1.25], ['2', 'total', 'Total goals - over 2.5', 1.8], ['3', 'h2h', 'Draw', 4.2]]);
  assert.equal(r.stake, 10);
  assert.equal(r.statedOdds, 9.45);
  assert.equal(r.totalOdds, 9.45);
});

test('reads a Superbet-style ticket: pick before the fixture, team names with numbers', () => {
  const text = `Superbet
Final
2
SV Darmstadt 98 · 1. FC Heidenheim 1846
2.90
Final
Liverpool
Liverpool · Manchester City
2.35
Sub 3.5
Total goluri
Arsenal · Chelsea
1.55`;
  const r = parseSlipText(text, FIXTURES, NOW);
  assert.equal(r.bookmaker, 'Superbet');
  assert.deepEqual(r.legs.map(l => [l.matchId, l.selection, l.price, l.problem]), [
    ['4', '1. FC Heidenheim 1846', 2.9, undefined], ['6', 'Liverpool', 2.35, undefined], ['2', 'Total goals - under 3.5', 1.55, undefined]]);
});

test('one line per leg, and the right Liverpool', () => {
  const r = parseSlipText('Liverpool - Man City 1 2.35\nBayern - Koln X 6.50', FIXTURES, NOW);
  assert.deepEqual(r.legs.map(l => [l.matchId, l.side, l.price]), [['6', 'home', 2.35], ['1', 'draw', 6.5]]);
});

test('flags unsupported markets, started matches and unknown fixtures', () => {
  const r = parseSlipText(`Arsenal - Chelsea
Ambele echipe marchează
Da
1.70
Man United - Everton
1
1.40`, FIXTURES, NOW);
  assert.match(r.legs[0].problem, /Both teams/);
  assert.match(r.legs[1].problem, /already started/);
  assert.equal(r.totalOdds, null);
  const missing = parseSlipText('Real Madrid - Getafe\n1\n1.30\nArsenal - Chelsea\n1\n2.00', FIXTURES, NOW);
  assert.equal(missing.legs.length, 1);
  assert.match(missing.warnings[0], /Real Madrid - Getafe/);
});

test('warns when the stated total odds do not match the picks read', () => {
  const r = parseSlipText('Arsenal - Chelsea\n1\n2.00\nCota totala 3.00', FIXTURES, NOW);
  assert.match(r.warnings[0], /total odds 3/);
  assert.deepEqual(parseSlipText('Germania - Bundesliga\nBayern - Koln\n1\n1.20\nCota totala 1.20', FIXTURES, NOW).warnings, []);
});

test('reads the Betano website betslip: singles, Bet Builders and Pauza sau Final', () => {
  const link = (name, slug) => '[' + name + '](https://ro.betano.com/cote/' + slug + '/123/)';
  const text = [
    'VfL Wolfsburg', '1.45', 'Pauză sau Final', link('Bayern München', 'b-k'), link('FC Köln', 'b-k'), 'Mâine 14:00',
    link('Bet Builder', 'a-c'), '1.52', link('Arsenal FC', 'a-c'), link('Chelsea FC', 'a-c'), 'Mâine 14:30', '',
    '* Arsenal FC', 'Rezultat final', '* Peste 1.5', 'Total goluri Peste/Sub', '',
    'Inter', '1.80', 'Rezultat final', link('Inter', 'i-c'), link('Como 1907', 'i-c'), 'Mâine 19:00',
    'Egal', '3.40', 'Rezultat final', link('Real Madrid', 'r-g'), link('Getafe', 'r-g'), 'Mâine 21:00',
  ].join('\n');
  const r = parseSlipText(text, FIXTURES, NOW);
  assert.match(r.legs[0].problem, /Pauză sau Final/);
  assert.deepEqual(r.legs.slice(1).map(l => [l.matchId, l.selection, l.builderPrice, l.problem]), [
    ['2', 'Arsenal', 1.52, undefined], ['2', 'Total goals - over 1.5', 1.52, undefined], ['3', 'Internazionale', undefined, undefined]]);
  assert.equal(r.legs[1].builderId, r.legs[2].builderId);
  assert.deepEqual(r.warnings, ['Not found in the fixture list: Real Madrid - Getafe']);
  assert.equal(r.totalOdds, 2.74); // 1.52 x 1.80, the flagged and missing matches left out
});

test('reads the Betano app copy, where each team name appears twice and there are no links', () => {
  const text = ['Dinamo București', '1.42', 'Rezultat final', 'Dinamo București', 'Dinamo București', 'Petrolul Ploiești', 'Petrolul Ploiești', 'Diseară 20:30',
    'Bayern München', '1.25', 'Rezultat final', 'Bayern München', 'Bayern München', 'FC Köln', 'FC Köln', 'Mâine 15:00',
    'Inter Milano', '1.60', 'Rezultat final', 'Inter Milano', 'Inter Milano', 'Como 1907', 'Como 1907', '24.11.26 21:45',
    'Bet Builder', '1.52', 'Arsenal FC', 'Arsenal FC', 'Chelsea FC', 'Chelsea FC', 'Mâine 17:00', 'Arsenal FC', 'Rezultat final', 'Peste 1.5', 'Total goluri Peste/Sub'].join('\n');
  const r = parseSlipText(text, FIXTURES, NOW);
  assert.deepEqual(r.warnings, ['Not found in the fixture list: Dinamo București - Petrolul Ploiești']);
  assert.deepEqual(r.legs.map(l => [l.matchId, l.selection, l.builderPrice || l.price, l.problem]), [
    ['1', 'Bayern Munich', 1.25, undefined], ['3', 'Internazionale', 1.6, undefined],
    ['2', 'Arsenal', 1.52, undefined], ['2', 'Total goals - over 1.5', 1.52, undefined]]);
  assert.equal(r.totalOdds, 3.04);
});

test('a price far from the feed is flagged as a misread', () => {
  const fixtures = [{ ...FIXTURES[1], bookmakers: [{ title: 'DK', markets: [{ key: 'h2h', outcomes: [
    { name: 'Arsenal', price: 1.5 }, { name: 'Draw', price: 4.2 }, { name: 'Chelsea', price: 6.5 }] }] }] }];
  const r = parseSlipText('Arsenal - Chelsea\nFinal\n2\n1.50', fixtures, NOW);
  assert.match(r.legs[0].problem, /far from the feed/);
});

test('kickoff dates and league numbers are not read as picks', () => {
  const r = parseSlipText(`Germania - 2. Bundesliga
SV Darmstadt 98 - 1. FC Heidenheim 1846
2 dec, 12:00
Final
X
3.40`, FIXTURES, NOW);
  assert.deepEqual(r.legs.map(l => [l.side, l.price, l.problem]), [['draw', 3.4, undefined]]);
});
