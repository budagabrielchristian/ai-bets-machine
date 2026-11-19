import { calculateStats } from '../services/ticketStats';
import { AIS } from '../services/aiCatalog';

const strategies = Object.fromEntries(Object.entries(AIS).map(([key, ai]) => [key, ai.name]));
import { Link, useSearchParams } from 'react-router-dom';
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBetContext } from '../context/BetContext';
import { Archive, ArrowUpRight, Clock, Target } from 'lucide-react';
import BetAnalysis from '../components/BetAnalysis';

const MyBets = ({ autoOnly = false }) => {
  const { placedBets: history, currency,account } = useBetContext();
  const manualBets = history.filter(b => b.source === 'manual' && !b.autoRun);
  const placedBets = autoOnly ? history.filter(b => b.autoRun) : manualBets;
  const [status,setStatus] = useState('all');
  const [params,setParams]=useSearchParams();
  const strategy=params.get('strategy') || 'all';
  const trialOnly=params.get('season') !== 'all';
  const currentSeason = b => (b.season || 1) === (account.ais?.[b.source === 'manual' ? 'manual' : b.strategy]?.season || 1);
  const comparisonBets = placedBets.filter(b =>
    (!autoOnly || strategy==='all' || (b.strategy || 'favorites')===strategy) &&
    (!autoOnly || !trialOnly || currentSeason(b)));
  const visible = comparisonBets.filter(b => status === 'all' || b.status === status);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
  };


  return (
    <div className="min-h-screen w-full bg-bg-dark pt-28 pb-32 px-4 md:px-12 font-sans">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-2 tracking-tight">{autoOnly ? 'AI tickets' : 'My Bets'}</h1>
            <p className="text-gray-400">{autoOnly ? 'Practice tickets each AI placed from its own wallet, with the reason it bet.' : 'Tickets you placed from your bet slip.'}</p>
          </div>
        </div>

        {autoOnly && <div className="ticket-filters">
          <label>Strategy<select value={strategy} onChange={e=>setParams(previous=>{previous.set('strategy',e.target.value);return previous;})}>
          <option value="all">All strategies</option>{Object.entries(strategies).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
          <label><input type="checkbox" checked={trialOnly} onChange={e=>setParams(previous=>{previous.set('season',e.target.checked?'current':'all');return previous;})}/> Current season only</label>
          <span>{visible.length} tickets</span>
        </div>}
        {autoOnly && <section className="mb-8 overflow-x-auto">
          <h2 className="text-xl mb-3">Auto-Pilot vs. you</h2>
          <table className="w-full text-left text-sm"><thead><tr>{['Account','Settled','Pending','Win rate','Net profit','ROI'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead>
          <tbody>{[[strategy==='all' ? 'Auto-Pilot' : strategies[strategy] || 'Auto-Pilot',comparisonBets],['Manual',manualBets]].map(([label,tickets])=>{
            const stats=calculateStats(tickets);
            return <tr key={label} className="border-t border-white/10">{[label,stats.count,tickets.filter(b=>b.status==='pending').length,
              stats.count ? stats.winRate.toFixed(1)+'%' : '—',stats.netProfit.toFixed(2)+' '+currency,stats.count ? stats.roi.toFixed(1)+'%' : '—'].map((cell,i)=><td className="p-2" key={i}>{cell}</td>)}</tr>;
          })}</tbody></table><p className="text-sm text-gray-400 mt-3">Win rate and ROI use won and lost tickets only. Each builder counts as one ticket.</p>
          <label className="block mt-6">Ticket status <select className="bg-neutral-800 p-2 rounded" value={status} onChange={e=>setStatus(e.target.value)}>
            {['all','pending','won','lost','void'].map(value=><option key={value} value={value}>{value === 'void' ? 'Refunded' : value}</option>)}</select></label>
        </section>}
        {!autoOnly && <BetAnalysis tickets={manualBets} />}
        {!autoOnly && <h2 className="tickets-heading">Your tickets</h2>}
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white/5 border border-white/5 rounded-3xl">
            <Archive className="w-16 h-16 text-gray-600 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">{placedBets.length ? 'No tickets with this status' : 'No bets placed yet'}</h3>
            <p className="text-gray-400">{autoOnly ? <Link to='/' className='underline'>View Auto-Pilot bankroll and scan status</Link> : 'Go to Markets to make your first selection.'}</p>
          </div>
        ) : (
          <motion.div 
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-6"
          >
            <AnimatePresence>
              {visible.map((receipt) => {
                let statusColor = 'bg-yellow-500';
                let statusText = receipt.status === 'void' ? 'Refunded' : 'Pending';
                if (receipt.status === 'won') {
                  statusColor = 'bg-emerald-500';
                  statusText = 'WON';
                } else if (receipt.status === 'lost') {
                  statusColor = 'bg-red-500';
                  statusText = 'LOST';
                }

                return (
                  <motion.div 
                    key={receipt.id}
                    variants={itemVariants}
                    layout
                    className={`bg-white/5 backdrop-blur-md rounded-[32px] overflow-hidden border ${
                      receipt.status === 'won' ? 'border-accent-green/50 shadow-[0_0_30px_rgba(59,89,73,0.2)]' : 
                      receipt.status === 'lost' ? 'border-red-500/30' : 'border-white/10 hover:bg-white/10'
                    } transition-all`}
                  >
                    {/* Header */}
                    <div className="px-6 py-4 border-b border-white/5 bg-black/40 flex justify-between items-center relative">
                      <div className={`absolute top-0 left-0 w-full h-1 ${statusColor}`} />
                      
                      <div className="flex items-center space-x-2 text-gray-400 text-sm">
                        <Clock className="w-4 h-4" />
                        <span>{new Date(receipt.datePlaced).toLocaleString()}</span>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <Link to={'/ticket/' + receipt.id} className="stats-link">Details & maths <ArrowUpRight size={13} aria-hidden="true" /></Link>
                        <div className={`text-[10px] font-bold px-3 py-1 rounded-full text-bg-dark uppercase tracking-wider ${statusColor}`}>
                          {receipt.source === 'ai' ? 'Auto-Pilot' : 'Manual'} · {statusText}
                        </div>
                      </div>
                    </div>

                    {/* Selections */}
                    <div className="p-6 space-y-4">
                      {receipt.selections.map((sel, idx) => (
                        <div key={idx} className="flex justify-between items-center bg-black/20 p-4 rounded-xl border border-white/5">
                          <div>
                            <div className="text-sm text-gray-400 mb-1">{sel.matchTitle}{sel.competition ? ' · '+sel.competition : ''}{sel.result ? ' · final '+sel.result : ''}</div>
                            <div className="text-xs text-gray-400 mb-1">{[
                              receipt.autoRun ? (strategies[receipt.strategy] || 'Auto-Pilot') + (receipt.season ? ' · season ' + receipt.season : '') : null,
                              sel.bookmaker,
                              idx === 0 && receipt.selections.length > 1 && receipt.rationale ? 'Ticket: ' + receipt.rationale : null,
                              sel.rationale || (receipt.selections.length === 1 ? receipt.rationale : null),
                              Number.isFinite(sel.value) ? 'leg value ' + ((sel.value - 1) >= 0 ? '+' : '') + ((sel.value - 1) * 100).toFixed(1) + '%' : null,
                              sel.closingPrice ? (Date.parse(sel.matchDate) > Date.now() ? 'price now ' : 'closing price ') + sel.closingPrice + ' (CLV ' + ((sel.price / sel.closingPrice - 1) >= 0 ? '+' : '') + ((sel.price / sel.closingPrice - 1) * 100).toFixed(1) + '%)' : null,
                              receipt.imported ? 'imported' : null,
                            ].filter(Boolean).join(' · ')}</div>
                            <div className="font-bold text-white flex items-center">
                              <Target className="w-4 h-4 mr-2 text-accent-green" /> {sel.selection}
                            </div>
                          </div>
                          <div className="text-accent-green font-bold bg-white/5 px-3 py-1 rounded-lg">
                            {sel.price}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Receipt Footer */}
                    <div className="bg-white/5 p-6 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4">
                      <div className="flex space-x-8 w-full md:w-auto">
                        <div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-gray-400">Total Odds:</span>
                            <span className="text-white font-bold">{receipt.totalOdds}</span>
                          </div>
                          {receipt.matchDate && (
                            <div className="flex justify-between items-center text-xs mt-1">
                              <span className="text-gray-400">Match Date:</span>
                              <span className="text-white font-bold">{new Date(receipt.matchDate).toLocaleDateString()}</span>
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Stake</div>
                          <div className="font-bold text-white">{receipt.stake} {receipt.currency || currency}</div>
                        </div>
                      </div>
                      
                      <div className="w-full md:w-auto bg-black/30 px-6 py-3 rounded-xl border border-white/5 flex flex-col md:items-end">
                        <span className="text-xs text-gray-400 mb-1 uppercase tracking-wider">{receipt.status === 'won' ? 'Returned' : receipt.status === 'lost' ? 'Returned' : receipt.status === 'void' ? 'Refunded' : 'Potential Return'}</span>
                        <span className="text-2xl font-bold text-accent-green">{receipt.status === 'lost' ? '0.00' : receipt.status === 'void' ? Number(receipt.stake).toFixed(2) : receipt.potentialReturn} {receipt.currency || currency}</span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default MyBets;
