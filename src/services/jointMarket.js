/* Practice pricing for a result combined with a half-goal total. Both markets
   must come from the same fixture, bookmaker and displayed handicap. */
function fair(prices) {
  if (prices.some(price => !Number.isFinite(price) || price <= 1)) return null;
  const total = prices.reduce((sum, price) => sum + 1 / price, 0);
  if (total < .99 || total > 1.2) return null;
  return { probabilities: prices.map(price => 1 / price / total), total };
}

function bisect(target, evaluate, low, high) {
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    if (evaluate(middle) < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function jointMarket(match) {
  const names = [match.home_team, 'Draw', match.away_team];
  for (const book of match.bookmakers || []) {
    const result = book.markets?.find(m => m.key === 'h2h');
    const totals = book.markets?.find(m => m.key === 'total');
    if (!result || !totals) continue;
    const over = totals.outcomes.find(o => o.side === 'over');
    const under = totals.outcomes.find(o => o.side === 'under');
    if (!over || !under || under.line !== over.line || over.line % 1 !== .5 || over.line > 9.5) continue;
    const hda = fair(names.map(name => result.outcomes.find(o => o.name === name)?.price));
    const ou = fair([under.price,over.price]);
    if (!hda || !ou) continue;
    return {names, line:over.line, result:hda.probabilities, under:ou.probabilities[0],
      load:Math.max(1,hda.total,ou.total), bookmaker:book.title};
  }
  return null;
}

export function jointProbability(model, resultIndex, side) {
  // Fit expected total goals to the under probability using a Poisson distribution.
  const cutoff = Math.floor(model.line);
  function overProbability(rate) {
    let term = Math.exp(-rate), under = term;
    for (let k = 1; k <= cutoff; k++) { term *= rate / k; under += term; }
    return 1 - under;
  }
  const rate = bisect(1-model.under, overProbability, 0, 50);
  // Split total goals between teams. Use independent Poisson score probabilities
  // as the starting shape; market marginals are imposed separately below.
  function scores(mean) {
    const p = [Math.exp(-mean)];
    for (let n=1; n<=60; n++) p.push(p[n-1]*mean/n);
    return p;
  }
  function cells(homeShare) {
    const home = scores(rate*homeShare), away = scores(rate*(1-homeShare));
    const table = [[0,0],[0,0],[0,0]];
    for (let h=0;h<home.length;h++) for (let a=0;a<away.length;a++) {
      const row = h === a ? 1 : h > a ? 0 : 2;
      table[row][Number(h+a>cutoff)] += home[h]*away[a];
    }
    return table;
  }
  const share = bisect(model.result[0], x => cells(x)[0].reduce((a,b)=>a+b), 0, 1);
  const table = cells(share);
  // Iterative proportional fitting retains impossible combinations as zero.
  for (let n=0;n<150;n++) {
    for (let r=0;r<3;r++) {
      const scale=model.result[r]/(table[r][0]+table[r][1]);
      table[r][0]*=scale; table[r][1]*=scale;
    }
    const under=table.reduce((s,row)=>s+row[0],0);
    if (Math.abs(under-model.under)<1e-8) return table[resultIndex][Number(side==='over')];
    for (const row of table) {
      row[0]*=model.under/under;
      row[1]*=(1-model.under)/(1-under);
    }
  }
  return null;
}
