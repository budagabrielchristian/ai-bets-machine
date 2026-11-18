import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jointProbability } from './jointMarket.js';
import { builderPrice, pilotCandidates } from './practice.js';

test('joint cells reproduce both market marginals', () => {
  const model = {result:[.55,.25,.20],under:.46,line:2.5};
  const cells = model.result.map((_,i) => ['under','over'].map(side => jointProbability(model,i,side)));
  for (const [i,[under,over]] of cells.entries()) {
    assert.ok(under>0 && over>0);
    assert.ok(Math.abs(under+over-model.result[i])<1e-7);
  }
  assert.ok(Math.abs(cells.reduce((sum,row)=>sum+row[0],0)-model.under)<1e-7);
});

test('under half a goal precludes a home win', () => {
  const model = {result:[.50,.30,.20],under:.10,line:.5,names:['H','Draw','A'],load:1.04};
  assert.equal(jointProbability(model,0,'under'),0);
  const legs=[{matchId:1,selection:'H',price:1.9},{matchId:1,market:'total',line:.5,side:'under',jointModel:model,price:9}];
  assert.ok(Number.isNaN(builderPrice(legs)));
  assert.equal(builderPrice([{matchId:1,price:2},{matchId:2,price:1.5}]),3);
});

test('price strategy needs an external benchmark and skips duplicate providers', () => {
  const book = (title,prices)=>({title,markets:[{key:'h2h',outcomes:['H','Draw','A'].map((name,i)=>({name,price:prices[i]}))}]});
  const offer=book('Offer',[2.30,3.05,3.60]);
  const match={id:'m',commence_time:'2026-11-05T15:00Z',home_team:'H',away_team:'A',bookmakers:[offer,offer]};
  const now=new Date('2026-11-05T12:00Z');
  assert.equal(pilotCandidates([match],'price',now).length,0);
  match.bookmakers.push(book('Reference',[1.95,3.50,4.00]));
  const [pick]=pilotCandidates([match],'price',now);
  assert.equal(pick.selection,'H');
  assert.ok(Math.abs(pick.referenceProbability - (1/1.95)/(1/1.95+1/3.5+1/4))<1e-10);
});
