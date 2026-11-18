export const calculateStats = (bets) => {
    const resolvedBets = bets.filter(b => b.status === 'won' || b.status === 'lost');
    const totalStaked = resolvedBets.reduce((acc, b) => acc + Number(b.stake), 0);
    const totalReturned = resolvedBets.filter(b => b.status === 'won').reduce((acc, b) => acc + Number(b.potentialReturn), 0);
    const netProfit = totalReturned - totalStaked;
    const roi = totalStaked > 0 ? ((netProfit / totalStaked) * 100) : 0;
    const winRate = resolvedBets.length > 0 ? ((resolvedBets.filter(b => b.status === 'won').length / resolvedBets.length) * 100) : 0;

    return { totalStaked, totalReturned, netProfit, roi, winRate, count: resolvedBets.length, total: bets.length };
  };
