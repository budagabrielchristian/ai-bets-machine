import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ODDS_API_KEY = '';
const { mergeQuotes } = await import('./feed.js');
const { AI, readOptions } = await import('./ai/strategies.js');

const now = Date.parse('2026-11-20T12:00Z');
const fixture = { id: '1', league: '700', home_team: 'Manchester United', away_team: 'Brighton & Hove Albion', homeId: 'a', awayId: 'b',
  commence_time: '2026-11-20T17:00Z', statusName: 'STATUS_SCHEDULED', sport_title: 'English Premier League',
  bookmakers: [{ title: 'DraftKings', markets: [{ key: 'h2h', outcomes: [
    { name: 'Manchester United', price: 2.3 }, { name: 'Draw', price: 3.3 }, { name: 'Brighton & Hove Albion', price: 3.3 }] }] }] };
// Odds API style: slightly different names and kickoff, many books, last_update stamps.
const quote = { commence_time: '2026-11-20T17:00:00Z', home_team: 'Manchester United FC', away_team: 'Brighton and Hove Albion',
  bookmakers: [{ key: 'pinnacle', title: 'Pinnacle', last_update: '2026-11-20T10:30:00Z', markets: [{ key: 'h2h', last_update: '2026-11-20T10:30:00Z', outcomes: [
    { name: 'Manchester United FC', price: 1.95 }, { name: 'Draw', price: 3.6 }, { name: 'Brighton and Hove Albion', price: 4.2 }] }] }] };

test('Odds API events attach to the right fixture with the fixture team names', () => {
  const [m] = mergeQuotes([fixture], [quote, { ...quote, home_team: 'Arsenal', away_team: 'Chelsea' }]);
  assert.equal(m.bookmakers.length, 2);
  const pin = m.bookmakers.find(b => b.title === 'Pinnacle');
  assert.ok(pin.extra);
  assert.deepEqual(pin.markets[0].outcomes.map(o => o.name), ['Manchester United', 'Draw', 'Brighton & Hove Albion']);
  assert.equal(mergeQuotes([fixture], [{ ...quote, commence_time: '2026-11-21T17:00:00Z' }])[0].bookmakers.length, 1, 'a different day does not match');
});

test('extra books reach only the price-comparison AIs, and 90-minute-old quotes still count', () => {
  const [m] = mergeQuotes([fixture], [quote]);
  assert.equal(readOptions(m, now, { includeExtra: false }).length, 3);
  assert.equal(readOptions(m, now).length, 6, 'Pinnacle quote from 1.5 hours ago is accepted');
  const two = [m, { ...m, id: '2', commence_time: '2026-11-20T19:00Z' }];
  const sharp = AI.sharpSingles.run({ deposit: 20000, tickets: [] }, two, { now });
  assert.ok(sharp.length >= 1 && sharp.every(t => t.selections.length === 1 && t.selections[0].bookmaker === 'DraftKings'));
  const fav = AI.favorites.run({ deposit: 20000, tickets: [] }, two, { now, models: null });
  assert.ok(fav.every(t => t.selections.every(s => s.bookmaker === 'DraftKings')), 'Favorites never uses the extra books');
});
