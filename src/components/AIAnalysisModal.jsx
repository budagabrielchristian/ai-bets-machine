import Overlay from './Overlay';
import { describePick, rankMarkets } from '../services/rankMarkets';
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, X, Zap, Target, TrendingUp, CheckCircle2, ShieldCheck, PieChart, Scale } from 'lucide-react';
import { useBetContext } from '../context/BetContext';

const AIAnalysisModal = ({ isOpen, onClose, matches }) => {
  const [step, setStep] = useState('config'); // 'config', 'scanning', 'results'
  const [strategy, setStrategy] = useState('safe');
  const [volume, setVolume] = useState(3);
  const [timeframe, setTimeframe] = useState('today');
  
  const [recommendations, setRecommendations] = useState([]);
  const [added, setAdded] = useState(false);
  const { addBet } = useBetContext();

  // Reset modal when opened
  useEffect(() => {
    if (isOpen) {
      setStep('config');
      setAdded(false);
      setRecommendations([]);
    }
  }, [isOpen]);

  const runEngine = () => {
    const picks = rankMarkets(matches, strategy, volume, timeframe);
    setRecommendations(picks);
    setStep('results');
  };

  const handleAddAll = () => {
    recommendations.forEach(rec => {
      addBet({
        matchId: rec.match.id, matchDate: rec.match.commence_time,
        matchTitle: `${rec.match.home_team} vs ${rec.match.away_team}`,
        selection: rec.selection,
        price: rec.price
      });
    });
    setAdded(true);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Overlay label="Screen selections" onClose={onClose}>
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-md"
        />
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-2xl bg-bg-dark border border-accent-green/30 rounded-3xl shadow-[0_0_50px_rgba(59,89,73,0.3)] overflow-hidden flex flex-col max-h-[85vh]"
        >
          {/* Header */}
          <div className="p-6 border-b border-white/10 flex justify-between items-center bg-accent-green/5">
            <div className="flex items-center space-x-3">
              <div className="bg-accent-green/20 p-2 rounded-xl">
                <Cpu className="w-6 h-6 text-accent-green" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Neural Bet Engine <span className="text-sm font-normal text-gray-400">v2.0</span></h2>
                <p className="text-xs text-accent-green flex items-center">
                  <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse mr-2"></span>
                  Ready to compute
                </p>
              </div>
            </div>
            <button aria-label="Close screener" onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto flex-1">
            {step === 'config' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
                <div>
                  <h3 className="text-lg font-bold text-white mb-4">Select AI Strategy</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <button 
                      onClick={() => setStrategy('safe')}
                      className={`p-4 rounded-xl border text-left transition-all ${strategy === 'safe' ? 'bg-accent-green/20 border-accent-green' : 'bg-white/5 border-white/10 hover:border-white/30'}`}
                    >
                      <ShieldCheck className={`w-6 h-6 mb-2 ${strategy === 'safe' ? 'text-accent-green' : 'text-gray-400'}`} />
                      <div className="font-bold text-white mb-1">Favorites</div>
                      <div className="text-xs text-gray-400">At least 60% estimated win probability.</div>
                    </button>
                    
                    <button 
                      onClick={() => setStrategy('value')}
                      className={`p-4 rounded-xl border text-left transition-all ${strategy === 'value' ? 'bg-blue-500/20 border-blue-500' : 'bg-white/5 border-white/10 hover:border-white/30'}`}
                    >
                      <TrendingUp className={`w-6 h-6 mb-2 ${strategy === 'value' ? 'text-blue-500' : 'text-gray-400'}`} />
                      <div className="font-bold text-white mb-1">Outsiders</div>
                      <div className="text-xs text-gray-400">Below 40% estimated win probability.</div>
                    </button>
                    
                    <button 
                      onClick={() => setStrategy('balanced')}
                      className={`p-4 rounded-xl border text-left transition-all ${strategy === 'balanced' ? 'bg-yellow-500/20 border-yellow-500' : 'bg-white/5 border-white/10 hover:border-white/30'}`}
                    >
                      <Scale className={`w-6 h-6 mb-2 ${strategy === 'balanced' ? 'text-yellow-500' : 'text-gray-400'}`} />
                      <div className="font-bold text-white mb-1">Balanced</div>
                      <div className="text-xs text-gray-400">From 40% to below 60% estimated win probability.</div>
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-white mb-4">Select Timeframe</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => setTimeframe('today')}
                      className={`p-3 rounded-xl border text-center transition-all ${timeframe === 'today' ? 'bg-accent-green/20 border-accent-green text-white font-bold' : 'bg-white/5 border-white/10 hover:border-white/30 text-gray-400'}`}
                    >
                      Today Only
                    </button>
                    <button 
                      onClick={() => setTimeframe('all')}
                      className={`p-3 rounded-xl border text-center transition-all ${timeframe === 'all' ? 'bg-accent-green/20 border-accent-green text-white font-bold' : 'bg-white/5 border-white/10 hover:border-white/30 text-gray-400'}`}
                    >
                      All Upcoming
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-white">Ticket Volume</h3>
                    <span className="bg-white/10 text-white font-bold px-3 py-1 rounded-lg">{volume} Picks</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="8" 
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="w-full accent-accent-green h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-2">
                    <span>1 (Single)</span>
                    <span>8 (Mega Parlay)</span>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 'scanning' && (
              <div className="flex flex-col items-center justify-center py-20 space-y-6">
                <motion.div 
                  animate={{ rotate: 360 }} 
                  transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                >
                  <Cpu className="w-16 h-16 text-accent-green opacity-80" />
                </motion.div>
                <div className="text-center space-y-2">
                  <h3 className="text-lg font-bold text-white animate-pulse">Running {strategy.toUpperCase()} Algorithm...</h3>
                  <p className="text-gray-400 text-sm">Processing {matches.length} fixtures to find {volume} optimal bets</p>
                </div>
                <div className="w-64 h-1 bg-white/10 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ x: "-100%" }}
                    animate={{ x: "100%" }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                    className="w-full h-full bg-accent-green"
                  />
                </div>
              </div>
            )}

            {step === 'results' && (
              <div className="space-y-6">
                <div className="text-center mb-8">
                  <h3 className="text-2xl font-bold text-white mb-2 flex items-center justify-center">
                    <Zap className="w-6 h-6 text-yellow-400 mr-2" /> 
                    {recommendations.length ? 'Matching selections' : 'No qualifying quoted markets'}
                  </h3>
                  <p className="text-gray-400">The Neural Engine has finalized your selections.</p>
                </div>
                
                <div className="space-y-4">
                  {recommendations.map((rec, idx) => (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.15 }}
                      className={`bg-white/5 border rounded-xl p-5 relative overflow-hidden ${rec.isArb ? 'border-yellow-500/30' : 'border-white/10'}`}
                    >
                      {/* Ribbon */}
                      <div className={`absolute top-0 right-0 text-bg-dark text-[10px] font-bold px-3 py-1 rounded-bl-xl ${rec.isArb ? 'bg-yellow-500' : 'bg-accent-green'}`}>
                        {`${(rec.probability * 100).toFixed(1)}% implied`}
                      </div>
                      
                      <div className="flex justify-between items-start mb-3 pr-24">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">{rec.match.sport_title}</div>
                          <div className="font-bold text-white text-lg">{rec.match.home_team} vs {rec.match.away_team}</div>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-3 mb-4">
                        <div className="bg-black/40 border border-white/10 px-4 py-2 rounded-lg flex items-center">
                          <Target className="w-4 h-4 text-gray-400 mr-2" />
                          <span className="text-sm text-gray-300 mr-2">Selection:</span>
                          <span className="font-bold text-white">{rec.selection}</span>
                        </div>
                        <div className={`px-4 py-2 rounded-lg border ${rec.isArb ? 'bg-yellow-500/10 border-yellow-500' : 'bg-accent-green/20 border-accent-green'}`}>
                          <span className={`font-bold ${rec.isArb ? 'text-yellow-500' : 'text-accent-green'}`}>{rec.price}</span>
                        </div>
                      </div>
                      
                      <div className="text-sm text-gray-400 flex items-start">
                        {rec.isArb ? <PieChart className="w-4 h-4 text-yellow-500 mr-2 shrink-0 mt-0.5" /> : <TrendingUp className="w-4 h-4 text-accent-green mr-2 shrink-0 mt-0.5" />}
                        <p>{describePick(rec)}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-white/10 bg-black/20 flex justify-end">
            {step === 'config' ? (
              <button 
                onClick={runEngine}
                className="px-8 py-4 rounded-xl font-bold bg-white text-black hover:bg-gray-200 transition-colors flex items-center"
              >
                Launch Engine
              </button>
            ) : step === 'results' ? (
              <button 
                disabled={!recommendations.length || added} onClick={handleAddAll}
                disabled={added}
                className={`px-8 py-4 rounded-xl font-bold transition-all flex items-center ${
                  added 
                    ? 'bg-white/10 text-white cursor-not-allowed' 
                    : 'bg-accent-green text-white hover:bg-[#466956] shadow-[0_0_20px_rgba(59,89,73,0.4)]'
                }`}
              >
                {added ? (
                  <><CheckCircle2 className="w-5 h-5 mr-2" /> Injected to Slip</>
                ) : (
                  <><Zap className="w-5 h-5 mr-2" /> Add {volume} Picks to Slip</>
                )}
              </button>
            ) : null}
          </div>
        </motion.div>
      </div>
    </Overlay>
  );
};

export default AIAnalysisModal;
