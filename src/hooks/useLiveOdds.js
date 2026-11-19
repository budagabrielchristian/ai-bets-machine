import { useEffect, useState, useRef } from 'react';
import { get, post } from '../services/api';

/** Fixtures and prices, served (and cached) by the server. */
export function useLiveOdds() {
  const [feed, setFeed] = useState({ matches: [], insights: {}, loading: true, refreshing: false, error: null, updatedAt: null });
  const refreshAction = useRef(() => {});
  useEffect(() => {
    let active = true, busy = false;
    async function refresh(force = false) {
      if (document.hidden || busy) return;
      busy = true;
      setFeed(previous => ({ ...previous, refreshing: true }));
      try {
        if (force) await post('/api/matches/refresh');
        const { matches, updatedAt, insights = {} } = await get('/api/matches');
        if (active) setFeed({ matches, insights, loading: false, refreshing: false, error: null, updatedAt: updatedAt ? new Date(updatedAt) : new Date() });
      } catch (e) {
        if (active) setFeed(previous => ({ ...previous, loading: false, refreshing: false, error: e.message || 'Odds refresh failed. Retrying automatically.' }));
      } finally { busy = false; }
    }
    const resume = () => { if (!document.hidden) refresh(); };
    refreshAction.current = () => refresh(true);
    refresh();
    const timer = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      active = false;
      refreshAction.current = () => {};
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, []);
  return { ...feed, refresh: () => refreshAction.current() };
}
