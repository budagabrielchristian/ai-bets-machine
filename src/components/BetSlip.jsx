import { builderPrice } from '../services/practice';
import Overlay from './Overlay';
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBetContext } from '../context/BetContext';
import { X, Trash2, CheckCircle2 } from 'lucide-react';

const BetSlip = () => {
  const { bets, isSlipOpen, toggleSlip, removeBet, clearBets, placeBet } = useBetContext();
  const currency = 'RON';
  const [stake, setStake] = useState('');
  const [placed, setPlaced] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  React.useEffect(() => { if (!isSlipOpen) { setPlaced(false); setStake(''); setError(''); } }, [isSlipOpen]);

  // Calculate total odds (multiplying them for a parlay/accumulator)
  const totalOdds = builderPrice(bets).toFixed(2);
  const potentialReturn = (stake * totalOdds).toFixed(2);

  const handlePlaceBet = async () => {
    setBusy(true); setError('');
    try { await placeBet(stake); setPlaced(true); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }

  };

  return (
    <AnimatePresence>
      {isSlipOpen && (
        <Overlay label="Bet slip" onClose={toggleSlip}>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={toggleSlip}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
          />
          
          {/* Slip Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 h-full w-full sm:w-96 bg-bg-dark border-l border-white/10 shadow-2xl z-50 flex flex-col"
          >
            {/* Header */}
            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
              <h2 className="text-xl font-bold text-white flex items-center">
                Bet Slip
                <span className="ml-3 bg-accent-green text-white text-xs px-2 py-0.5 rounded-full">
                  {bets.length}
                </span>
              </h2>
              <button aria-label="Close bet slip" onClick={toggleSlip} className="text-gray-400 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Bets List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {bets.length === 0 && !placed ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-500">
                  <p>Your bet slip is empty.</p>
                  <p className="text-sm mt-2">Click on odds to add selections.</p>
                </div>
              ) : placed ? (
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }} 
                  animate={{ scale: 1, opacity: 1 }} 
                  className="h-full flex flex-col items-center justify-center text-accent-green"
                >
                  <CheckCircle2 className="w-16 h-16 mb-4" />
                  <h3 className="text-2xl font-bold text-white mb-2">Bet Placed!</h3>
                  <p className="text-gray-400">Good luck.</p>
                </motion.div>
              ) : (
                <AnimatePresence>
                  {bets.map((bet) => (
                    <motion.div
                      key={bet.matchId + (bet.market || "h2h")}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="bg-white/5 border border-white/10 rounded-xl p-4 relative group"
                    >
                      <button 
                        onClick={() => removeBet(bet.matchId,bet.market)}
                        className="absolute top-4 right-4 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <div className="text-xs text-gray-400 mb-1">{bet.matchTitle}</div>
                      <div className="font-bold text-white mb-2">{bet.selection}</div>
                      <div className="text-accent-green font-bold text-lg">{bet.price}</div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            {/* Footer / Summary */}
            {bets.length > 0 && !placed && (
              <div className="p-6 border-t border-white/10 bg-black/20">
                {new Set(bets.map(b=>b.matchId)).size < bets.length && <p className="text-sm text-gray-300 mb-4">Practice bet builder · All legs must win. Same-match returns use a score model fitted to result and goals prices from one bookmaker. These are simulated odds. Prices multiply across different matches. A void leg refunds an otherwise winning ticket.</p>}
                <div className="bg-white/5 p-4 rounded-xl space-y-3 mb-6 border border-white/5">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-400">Total Odds</span>
                    <span className="font-bold text-accent-green">{Number.isFinite(Number(totalOdds)) ? totalOdds : 'Unavailable'}</span>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <span className="text-xl text-gray-400 font-bold">{currency}</span>
                    <input
                      type="number"
                      value={stake}
                      onChange={(e) => setStake(e.target.value)}
                      placeholder="Stake amount"
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-accent-green font-bold text-lg"
                    />
                  </div>

                  <div className="flex justify-between items-center pt-3 border-t border-white/10">
                    <span className="text-gray-400">Potential Return</span>
                    <span className="font-bold text-xl text-white">{Number.isFinite(Number(potentialReturn)) ? potentialReturn : 'Unavailable'} {currency}</span>
                  </div>
                </div>

                {error && <p role="alert" className="text-sm text-red-300 mb-4">{error}</p>}
                <button
                  disabled={busy || !(Number(stake) > 0 && Number.isFinite(Number(potentialReturn)))} onClick={handlePlaceBet}
                  className="w-full py-4 rounded-xl bg-accent-green text-white font-bold hover:bg-[#466956] transition-all shadow-[0_0_20px_rgba(59,89,73,0.4)]"
                >
                  {busy ? 'Placing…' : 'Place Bet'}
                </button>
              </div>
            )}
          </motion.div>
        </Overlay>
      )}
    </AnimatePresence>
  );
};

export default BetSlip;
