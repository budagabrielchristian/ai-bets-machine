import { calculateStats } from '../services/ticketStats';
import React from 'react';
import AutoPilotReplay from '../components/AutoPilotReplay';
import { motion } from 'framer-motion';
import { useBetContext } from '../context/BetContext';
import { TrendingUp, Cpu, User, PieChart, Activity } from 'lucide-react';

const Analytics = () => {
  const { placedBets, currency, clearPortfolio } = useBetContext();

  const aiStats = calculateStats(placedBets.filter(b => b.autoRun));
  const humanStats = calculateStats(placedBets.filter(b => b.source === 'manual'));
  const overallStats = calculateStats(placedBets);

  const StatCard = ({ title, value, subtitle, highlight, isProfit }) => (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-md">
      <div className="text-gray-400 text-sm font-bold uppercase tracking-wider mb-2">{title}</div>
      <div className={`text-3xl font-extrabold ${highlight ? (isProfit >= 0 ? 'text-accent-green' : 'text-red-500') : 'text-white'}`}>
        {value}
      </div>
      {subtitle && <div className="text-gray-500 text-xs mt-2">{subtitle}</div>}
    </div>
  );

  return (
    <div className="min-h-screen w-full bg-bg-dark pt-28 pb-32 px-4 md:px-12 font-sans">
      <div className="max-w-6xl mx-auto space-y-12">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-2 tracking-tight flex items-center">
              <PieChart className="mr-4 text-accent-green h-8 w-8" /> Analytics Engine
            </h1>
            <p className="text-gray-400">Track and compare the AI's autonomous performance against your manual bets.</p>
          </div>
          <button 
            onClick={() => { if (window.confirm('Start a new season for every AI and your manual bets? Balances go back to the starting amount. Old tickets stay in the history.')) clearPortfolio(); }}
            className="bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-white px-6 py-3 rounded-full text-sm font-bold transition-all shadow-lg"
          >
            New season for everyone
          </button>
        </div>

        
        <section>
          <div className="flex items-center mb-6 space-x-3">
            <div className="bg-accent-green/20 p-2 rounded-xl">
              <Cpu className="w-6 h-6 text-accent-green" />
            </div>
            <h2 className="text-2xl font-bold text-white">AI Auto-Pilot Performance</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard 
              title="Win Rate" 
              value={`${aiStats.winRate.toFixed(1)}%`} 
              subtitle={`${aiStats.count} resolved out of ${aiStats.total} total bets`}
            />
            <StatCard 
              title="Total Staked" 
              value={`${aiStats.totalStaked.toFixed(2)} ${currency}`} 
            />
            <StatCard 
              title="Net Profit" 
              value={`${aiStats.netProfit >= 0 ? '+' : ''}${aiStats.netProfit.toFixed(2)} ${currency}`} 
              highlight={true}
              isProfit={aiStats.netProfit}
            />
            <StatCard 
              title="ROI" 
              value={`${aiStats.roi >= 0 ? '+' : ''}${aiStats.roi.toFixed(1)}%`} 
              highlight={true}
              isProfit={aiStats.roi}
            />
          </div>
        </section>

        {/* Human Performance */}
        <section>
          <div className="flex items-center mb-6 space-x-3">
            <div className="bg-white/10 p-2 rounded-xl border border-white/20">
              <User className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white">Your Manual Performance</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 opacity-80 hover:opacity-100 transition-opacity">
            <StatCard 
              title="Win Rate" 
              value={`${humanStats.winRate.toFixed(1)}%`} 
              subtitle={`${humanStats.count} resolved out of ${humanStats.total} total bets`}
            />
            <StatCard 
              title="Total Staked" 
              value={`${humanStats.totalStaked.toFixed(2)} ${currency}`} 
            />
            <StatCard 
              title="Net Profit" 
              value={`${humanStats.netProfit >= 0 ? '+' : ''}${humanStats.netProfit.toFixed(2)} ${currency}`} 
              highlight={true}
              isProfit={humanStats.netProfit}
            />
            <StatCard 
              title="ROI" 
              value={`${humanStats.roi >= 0 ? '+' : ''}${humanStats.roi.toFixed(1)}%`} 
              highlight={true}
              isProfit={humanStats.roi}
            />
          </div>
        </section>

        <AutoPilotReplay />
        {/* System Overview */}
        <section className="bg-black/40 border border-white/5 p-8 rounded-3xl">
          <h2 className="text-xl font-bold text-gray-300 flex items-center mb-6">
            <Activity className="w-5 h-5 mr-2" /> System Overview
          </h2>
          <div className="w-full h-4 bg-white/5 rounded-full overflow-hidden flex">
            {overallStats.count > 0 ? (
              <>
                <div 
                  style={{ width: `${(placedBets.filter(b => b.status === 'won').length) / overallStats.count * 100}%` }} 
                  className="h-full bg-accent-green"
                />
                <div 
                  style={{ width: `${(placedBets.filter(b => b.status === 'lost').length) / overallStats.count * 100}%` }} 
                  className="h-full bg-red-500"
                />
              </>
            ) : (
              <div className="w-full h-full bg-white/10" />
            )}
          </div>
          <p className="text-xs text-gray-500 mt-4 text-center">
            * Stats only include bets that have been settled as Won or Lost based on real-world match data.
          </p>
        </section>

      </div>
    </div>
  );
};

export default Analytics;
