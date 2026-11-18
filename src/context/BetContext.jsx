import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLiveOdds } from '../hooks/useLiveOdds';
import { get, me, post } from '../services/api';
import { newSlipNotifications, showSlipNotification } from '../services/slipNotifications';

// The server runs the AIs around the clock; this context only displays its
// state and sends the user's own actions.
const BetContext = createContext();
export const useBetContext = () => useContext(BetContext);

const empty = { ais: {}, tickets: [], settings: {}, engine: {}, feed: {}, loaded: false };

export function BetProvider({ children }) {
  const oddsFeed = useLiveOdds();
  const [account, setAccount] = useState(empty);
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const [bets, setBets] = useState([]);
  const [isSlipOpen, setIsSlipOpen] = useState(false);
  const previous = useRef(null);

  const refreshState = useCallback(async () => {
    try {
      const next = await get('/api/state');
      if (previous.current && next.settings?.slipNotifications) {
        for (const alert of newSlipNotifications(previous.current, next.tickets)) showSlipNotification(alert.title, alert.options);
      }
      previous.current = next.tickets;
      setAccount({ ...next, loaded: true });
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    me().then(d => setUser(d.user)).catch(() => {});
    refreshState();
    const timer = setInterval(() => { if (!document.hidden) refreshState(); }, 30000);
    const onVisible = () => { if (!document.hidden) refreshState(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [refreshState]);

  const act = async (path, body) => { const result = await post(path, body); await refreshState(); return result; };

  function addBet(bet) {
    setBets(prev => [...prev.filter(b => !(b.matchId === bet.matchId && (b.market || 'h2h') === (bet.market || 'h2h'))), bet]);
    setIsSlipOpen(true);
  }

  async function placeBet(stake) {
    const selections = bets.map(({ matchId, market, side, line, selection, price }) => ({ matchId, market, side, line, selection, price }));
    await act('/api/tickets', { stake: Number(stake), selections });
    setBets([]);
    return true;
  }

  const value = {
    user, error, account, oddsFeed, refreshState,
    placedBets: account.tickets,
    currency: 'RON', setCurrency: () => {},
    bets, addBet, placeBet, clearBets: () => setBets([]),
    removeBet: (id, market) => setBets(prev => prev.filter(b => b.matchId !== id || b.market !== market)),
    isSlipOpen, setIsSlipOpen, toggleSlip: () => setIsSlipOpen(v => !v),
    aiAction: (key, action) => act('/api/ai/' + key + '/' + action),
    clearPortfolio: () => act('/api/reset-all'),
    setSlipNotifications: enabled => act('/api/settings', { slipNotifications: enabled }),
    importLegacy: legacy => act('/api/import', { account: legacy }),
  };
  return <BetContext.Provider value={value}>{children}</BetContext.Provider>;
}
