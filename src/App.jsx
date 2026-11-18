import React from 'react';
import { MotionConfig } from 'framer-motion';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

import TopNav from './components/TopNav';
import Home from './pages/Home';
import AllBets from './pages/AllBets';
import MyBets from './pages/MyBets';
import Analytics from './pages/Analytics';
import { BetProvider } from './context/BetContext';
import BetSlip from './components/BetSlip';

const App = () => {
  return (
    <MotionConfig reducedMotion="user"><BetProvider>
      <Router>
        <div className="min-h-screen bg-bg-dark text-white font-sans flex flex-col overflow-hidden relative">
          <main className="flex-1 relative h-screen overflow-y-auto pb-32">
            <TopNav />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/bets" element={<AllBets />} />
              <Route path="/my-bets" element={<MyBets />} />
              <Route path="/auto-pilot" element={<MyBets autoOnly />} />
              <Route path="/analytics" element={<Analytics />} />
            </Routes>
          </main>
          
          <BetSlip />
        </div>
      </Router>
    </BetProvider></MotionConfig>
  );
}

export default App;

