import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSlips} from './buildSlips.js';
import {grade} from './practice.js';
import {slipMatchAllowed} from './eligibleCompetition.js';

const now = new Date('2026-11-05T12:00Z');
function fixture(id, price, key) {
  const home='Home '+id, away='Away '+id;
  const outcomes=key==='h2h' ? [{name:home,price},{name:'Draw',price:5.5},{name:away,price:6.5}] :
    [{name:'over',side:'over',line:2.5,price},{name:'under',side:'under',line:2.5,price:1/(1.04-1/price)}];
  return {id,leagueId:"eng.1",home_team:home,away_team:away,commence_time:'2026-11-05T18:00Z',
    bookmakers:[{title:'Book',markets:[{key,title:'Goals',outcomes}]}]};
}
const games=[fixture(1,1.40,'h2h'),fixture(2,1.42,'total'),fixture(3,1.75,'total'),fixture(4,1.72,'total'),
  fixture(5,1.06,'total'),fixture(6,2.10,'total'),fixture(7,2.20,'total')];

test('stake follows combined odds: 60 RON up to 3.50, 10 RON above', ()=>{
  const tickets=buildSlips({tickets:[]},games,20000,now);
  assert.equal(tickets.length,2);
  for (const t of tickets) {
    assert.equal(t.stake, t.totalOdds>3.5 ? 10 : 60);
    assert.ok(t.selections.length>=2 && t.selections.length<=3);
    assert.ok(t.selections.every(l=>l.price>=1.30));
  }
  assert.ok(tickets.some(t=>t.stake===60 && t.totalOdds>=1.9 && t.totalOdds<=3.5));
  assert.ok(tickets.some(t=>t.stake===10 && t.totalOdds>3.5 && t.totalOdds<=8));
  const legs=tickets.flatMap(t=>t.selections);
  assert.equal(new Set(legs.map(l=>l.matchId)).size,legs.length,'each match used once');
});

test('funds and open-slip limits', ()=>{
  assert.deepEqual(buildSlips({tickets:[]},games,5900,now).map(t=>t.stake),[10]);
  assert.equal(buildSlips({tickets:[]},games,999,now).length,0);
  const open = odds => ({autoRun:true,status:'pending',totalOdds:odds,stake:odds>3.5?10:60,selections:[{matchId:'x'+odds}]});
  // Two open 60 RON slips: only a 10 RON slip may be added.
  assert.deepEqual(buildSlips({tickets:[open(2),open(2.2)]},games,20000,now).map(t=>t.stake),[10]);
});

test('60/10 rules: top leagues + Champions League; Italy only Inter or Como; never Dortmund or PSV', ()=>{
  const m = (title, home, away, extra={}) => ({ sport_title:title, home_team:home.name, homeId:home.id, away_team:away.name, awayId:away.id, ...extra });
  const t = (name, id='0') => ({ name, id });
  const inter=t('Internazionale','110'), como=t('Como','2572'), juve=t('Juventus','111'), napoli=t('Napoli','114');
  const bvb=t('Borussia Dortmund','124'), psv=t('PSV Eindhoven','148'), bayern=t('Bayern Munich','132'), arsenal=t('Arsenal','359');
  const italian = id => ['110','2572','111','114'].includes(id) ? '730' : undefined;
  const ok = (match) => slipMatchAllowed(match, italian);
  assert.ok(ok(m('English Premier League', arsenal, t('Chelsea'))));
  assert.ok(ok(m('Serie A', inter, juve)), 'Serie A with Inter');
  assert.ok(ok(m('Serie A', napoli, como)), 'Serie A with Como');
  assert.ok(!ok(m('Serie A', juve, napoli)), 'other Serie A matches are out');
  assert.ok(!ok(m('Bundesliga', bvb, bayern)), 'never Dortmund');
  assert.ok(ok(m('Bundesliga', bayern, t('Freiburg'))));
  assert.ok(!ok(m('UEFA Champions League, League Phase', arsenal, psv)), 'never PSV');
  assert.ok(!ok(m('UEFA Champions League, League Phase', bvb, arsenal)), 'never Dortmund in Europe either');
  assert.ok(!ok(m('UEFA Champions League, League Phase', juve, arsenal)), 'other Italian clubs out in Europe');
  assert.ok(ok(m('UEFA Champions League, League Phase', inter, arsenal)));
  assert.ok(!ok(m('UEFA Europa League, League Phase', arsenal, t('Roma'), { leagueId:'uefa.europa' })), 'no Europa League');
  assert.ok(!ok(m('LALIGA 2', t('Eibar'), t('Cadiz'))), 'no other leagues');
  assert.ok(!ok(m('Inter Miami', t('Inter Miami CF','1'), t('LAFC','2'))), 'Inter Miami is not Inter');
});

test('60/10 slips can hold up to 4 matches', ()=>{
  const cheap=[1,2,3,4,5,6].map(i=>fixture(10+i,1.40,'h2h'));
  const slips=buildSlips({tickets:[]},cheap,20000,now);
  assert.ok(slips.some(s=>s.selections.length>=3), 'uses more than two matches when needed for the odds');
  assert.ok(slips.every(s=>s.selections.length>=2 && s.selections.length<=4));
});

test('half-goal handicap settles on regulation goal difference',()=>{
  const ticket={selections:[{matchId:1,market:'handicap',side:'away',line:1.5}]};
  assert.equal(grade(ticket,{1:{homeScore:2,awayScore:1}}),'won');
  assert.equal(grade(ticket,{1:{homeScore:3,awayScore:1}}),'lost');
});

test('stake rule option: share of the bankroll instead of fixed 60/10', () => {
  const stakeFor = (tier, bankroll) => Math.max(100, Math.floor(bankroll * (tier.key === 'standard' ? 0.06 : 0.01)));
  const tickets = buildSlips({ tickets: [] }, games, 20000, now, { stakeFor, strategy: 'slipsScaled' });
  assert.ok(tickets.length > 0);
  for (const t of tickets) {
    assert.equal(t.strategy, 'slipsScaled');
    assert.equal(t.stake, t.totalOdds > 3.5 ? 2 : 12, '1% / 6% of 200 RON');
    assert.equal(t.potentialReturn, Number((t.stake * t.totalOdds).toFixed(2)));
  }
});
