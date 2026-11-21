import React, { useLayoutEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { BrowserRouter, HashRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
import { STATIC } from './services/api';

const Router = STATIC ? HashRouter : BrowserRouter;

import TopNav from './components/TopNav';
import Home from './pages/Home';
import AllBets from './pages/AllBets';
import MyBets from './pages/MyBets';
import Analytics from './pages/Analytics';
import MatchDetail from './pages/MatchDetail';
import TicketDetail from './pages/TicketDetail';
import { BetProvider } from './context/BetContext';
import BetSlip from './components/BetSlip';

/** Open every new page at the top (going back keeps the browser's own position). */
function ScrollToTop() {
  const { pathname } = useLocation();
  const type = useNavigationType();
  useLayoutEffect(() => {
    if (type === 'POP') return;
    const top = () => { window.scrollTo(0, 0); document.querySelector('main')?.scrollTo(0, 0); };
    top();
    // Again once the new page has drawn, so the browser cannot keep the old position.
    const timer = setTimeout(top, 30);
    return () => clearTimeout(timer);
  }, [pathname, type]);
  return null;
}

const App = () => {
  return (
    <MotionConfig reducedMotion="user"><BetProvider>
      <Router>
        <ScrollToTop />
        <div className="min-h-screen bg-bg-dark text-white font-sans flex flex-col overflow-hidden relative">
          <main className="flex-1 relative h-screen overflow-y-auto pb-32">
            <TopNav />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/bets" element={<AllBets />} />
              <Route path="/my-bets" element={<MyBets />} />
              <Route path="/auto-pilot" element={<MyBets autoOnly />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/match/:id" element={<MatchDetail />} />
              <Route path="/ticket/:id" element={<TicketDetail />} />
            </Routes>
          </main>
          
          <BetSlip />
        </div>
      </Router>
    </BetProvider></MotionConfig>
  );
}

export default App;

