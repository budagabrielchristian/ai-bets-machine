// Show what each AI would bet right now, without saving anything.
//   npm run dry-run
import { AIS } from '../../src/services/aiCatalog.js';
import { AI } from '../ai/strategies.js';
import { buildModels, predict } from '../ai/ratings.js';
import { getHistory, getMatches } from '../feed.js';

let t = Date.now();
const { results, fetched } = await getHistory();
console.log('History:', results.length, 'results (' + fetched + ' days downloaded) in', ((Date.now() - t) / 1000).toFixed(1) + 's');
t = Date.now();
const models = buildModels(results);
console.log('Models:', models.elo.ratings.size, 'teams,', models.leagues.size, 'leagues, curve', JSON.stringify(models.elo.curve), 'in', ((Date.now() - t) / 1000).toFixed(1) + 's');
const matches = await getMatches({ force: true });
const priced = matches.filter(m => m.bookmakers?.length && Date.parse(m.commence_time) > Date.now());
console.log('Fixtures:', matches.length, 'upcoming priced:', priced.length, 'with model:', priced.filter(m => predict(models, m)).length);
for (const [key, ai] of Object.entries(AI)) {
  const tickets = ai.run({ deposit: 20000, tickets: [] }, matches, { now: Date.now(), models });
  console.log('\n' + AIS[key].name + ': ' + tickets.length + ' ticket(s)');
  for (const tk of tickets) console.log('  ' + tk.stake.toFixed(2) + ' RON @ ' + tk.totalOdds + ' · ' +
    tk.selections.map(s => s.matchTitle + ' → ' + s.selection).join(' + ') + ' · ' + (tk.rationale || ''));
}
process.exit(0);
