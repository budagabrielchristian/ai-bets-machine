import { jointMarket } from '../services/jointMarket';
import { fixtureDay } from '../services/fixtureDay';

import React, { useState, useMemo } from 'react';

import { motion, AnimatePresence } from 'framer-motion';



import { Trophy, Clock, Filter, Cpu, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';

import { useBetContext } from '../context/BetContext';
import { Link } from 'react-router-dom';

import AIAnalysisModal from '../components/AIAnalysisModal';



const AllBets = () => {





  const { addBet, bets, oddsFeed } = useBetContext();
  const {matches,loading,error:feedError,refreshing,updatedAt} = oddsFeed;

  

  const [query, setQuery] = useState('');

  const [quoted, setQuoted] = useState(true);
  const [includeFinished,setIncludeFinished] = useState(false);

  const [selectedLeague, setSelectedLeague] = useState('All');

  const [selectedDay, setSelectedDay] = useState('All');



  const [isAIModalOpen, setIsAIModalOpen] = useState(false);

  

  // Track which match rows are expanded

  const [expandedMatches, setExpandedMatches] = useState({});



  const handleOddsClick = (match, selection, price, e, details = {}) => {

    e.stopPropagation(); // Prevent row click

    addBet({

      matchId: match.id, matchDate: match.commence_time, ...details, jointModel: details.market === 'total' ? jointMarket(match) : undefined,

      matchTitle: `${match.home_team} vs ${match.away_team}`,

      selection,

      price

    });

  };



  const toggleMatchExpansion = (matchId) => {

    setExpandedMatches(prev => ({

      ...prev,

      [matchId]: !prev[matchId]

    }));

  };



  const leagues = useMemo(() => {

    const unique = [...new Set(matches.map(m => m.sport_title))];

    return ['All', ...unique.sort((a,b) => Number(b.startsWith('UEFA')) - Number(a.startsWith('UEFA')) || a.localeCompare(b))];

  }, [matches]);



  const days = useMemo(() => ['All', 'Today', 'Tomorrow', 'Upcoming'], []);



  const filteredMatches = useMemo(() => {

    return matches.filter(match => {



      if (!includeFinished && (!(Date.parse(match.commence_time)>Date.now()) || (match.statusName && match.statusName !== 'STATUS_SCHEDULED'))) return false;
      if (quoted && !match.bookmakers?.some(book=>book.markets?.some(m=>m.outcomes?.some(o=>Number.isFinite(o.price) && o.price>1)))) return false;

      if (![match.home_team, match.away_team, match.sport_title].join(' ').toLowerCase().includes(query.trim().toLowerCase())) return false;

      if (selectedLeague !== 'All' && match.sport_title !== selectedLeague) return false;

      if (selectedDay !== 'All') {

        const day = fixtureDay(match.commence_time);

        const isToday = day === fixtureDay();

        const isTomorrow = day === fixtureDay(new Date(), 1);

        if (selectedDay === 'Today' && !isToday) return false;

        if (selectedDay === 'Tomorrow' && !isTomorrow) return false;

        if (selectedDay === 'Upcoming' && (isToday || isTomorrow)) return false;

      }

      return true;

    });

  }, [matches, selectedLeague, selectedDay, query, quoted, includeFinished]);



  const containerVariants = {

    hidden: { opacity: 0 },

    visible: { opacity: 1, transition: { staggerChildren: 0.05 } }

  };



  const itemVariants = {

    hidden: { opacity: 0, y: 10 },

    visible: { opacity: 1, y: 0, transition: { duration: 0.2 } },

    exit: { opacity: 0, scale: 0.98, transition: { duration: 0.1 } }

  };



  if (loading) {

    return (

      <div className="min-h-screen w-full flex items-center justify-center bg-bg-dark pt-20 text-white">

        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>

          <Trophy className="h-8 w-8 text-accent-green opacity-50" />

        </motion.div>

      </div>

    );

  }



  const groupedMatches = filteredMatches.reduce((acc, match) => {

    if (!acc[match.sport_title]) acc[match.sport_title] = [];

    acc[match.sport_title].push(match);

    return acc;

  }, {});



  return (

    <div className="min-h-screen w-full bg-bg-dark pt-28 pb-32 px-4 md:px-8 lg:px-12 font-sans">

      <div className="max-w-7xl mx-auto">

        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">

          <div>

            <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-2 tracking-tight">Global Markets</h1>

            <div className="flex items-center space-x-2">

              <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse"></span>

              <p className="text-gray-400 font-medium tracking-wide">

                {filteredMatches.length} fixtures · Bucharest time

              </p>

            </div>

          </div>

          <div className="flex items-center">

            <motion.button 

              whileHover={{ scale: 1.05 }}

              whileTap={{ scale: 0.95 }}

              onClick={() => setIsAIModalOpen(true)}

              className="flex items-center space-x-2 text-sm font-bold bg-white text-black px-6 py-3 rounded-full hover:bg-gray-200 transition-colors shadow-lg"

            >

              <Cpu className="w-4 h-4 mr-1" />

              <span>Screen selections</span>

            </motion.button>

          </div>

        </div>



        <p role="status" className="text-sm text-gray-400 mb-5">
          {feedError || (refreshing ? 'Refreshing fixtures and odds…' : updatedAt ? 'Feed refreshed '+updatedAt.toLocaleTimeString()+' · refreshes every minute' : 'Connecting to odds feed…')}
        </p>
        <button className="border border-white/20 px-4 py-2 rounded-full mb-4" disabled={refreshing} onClick={oddsFeed.refresh}>{refreshing ? 'Refreshing…' : 'Refresh markets'}</button>
        {/* Filters - Now using custom-scrollbar */}

        <div className="mb-10 space-y-4">

          <div className="flex flex-wrap items-center gap-4"><input type="search" aria-label="Search fixtures" placeholder="Search teams or leagues" value={query} onChange={e => setQuery(e.target.value)} className="rounded-lg border border-white/20 px-4 py-2" /><label><input type="checkbox" checked={quoted} onChange={e => setQuoted(e.target.checked)} /> With quoted odds</label><label><input type="checkbox" checked={includeFinished} onChange={e=>setIncludeFinished(e.target.checked)} /> Include started and finished matches</label></div>

          <div className="flex items-center space-x-2 overflow-x-auto pb-4 custom-scrollbar">

            <Filter className="w-5 h-5 text-gray-500 shrink-0 mr-2" />

            {leagues.map(league => (

              <motion.button

                whileTap={{ scale: 0.95 }}

                key={league}

                onClick={() => setSelectedLeague(league)}

                className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold transition-all ${

                  selectedLeague === league 

                    ? 'bg-accent-green text-white shadow-[0_0_15px_rgba(59,89,73,0.4)]' 

                    : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-white/5'

                }`}

              >

                {league}

              </motion.button>

            ))}

          </div>



          <div className="flex items-center space-x-2 overflow-x-auto pb-4 custom-scrollbar pl-9">

            {days.map(day => (

              <motion.button

                whileTap={{ scale: 0.95 }}

                key={day}

                onClick={() => setSelectedDay(day)}

                className={`whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${

                  selectedDay === day 

                    ? 'bg-white/20 text-white border border-white/30' 

                    : 'border border-white/5 text-gray-400 hover:bg-white/5'

                }`}

              >

                {day}

              </motion.button>

            ))}

          </div>

        </div>



        {/* List Layout */}

        {filteredMatches.length === 0 ? (

           <div className="py-20 text-center text-gray-500">

              <Trophy className="w-12 h-12 mx-auto mb-4 opacity-20" />

              <p>{feedError ? String(feedError) : 'No upcoming quoted fixtures match these filters. The feed refreshes every minute.'}</p>

           </div>

        ) : (

          <motion.div 

            variants={containerVariants}

            initial="hidden"

            animate="visible"

            className="space-y-8"

          >

            {Object.entries(groupedMatches).sort(([a], [b]) => Number(b.startsWith('UEFA')) - Number(a.startsWith('UEFA'))).map(([leagueName, leagueMatches]) => (

              <div key={leagueName} className="bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl overflow-hidden shadow-xl">

                

                {/* League Header */}

                <div className="bg-black/40 px-6 py-4 border-b border-white/5 flex items-center justify-between sticky top-0 z-10 backdrop-blur-xl">

                  <div className="flex items-center space-x-3">

                    <div className="w-8 h-8 rounded-full bg-accent-green/20 flex items-center justify-center">

                      <Trophy className="w-4 h-4 text-accent-green" />

                    </div>

                    <h2 className="text-lg font-bold text-white tracking-wide">{leagueName}</h2>

                  </div>

                  <div className="hidden md:flex space-x-2 text-xs font-bold text-gray-500 uppercase tracking-widest w-[280px]">

                    <div className="w-1/3 text-center">1</div>

                    <div className="w-1/3 text-center">X</div>

                    <div className="w-1/3 text-center">2</div>

                  </div>

                </div>



                {/* Matches List */}

                <div className="divide-y divide-white/5">

                  <AnimatePresence>

                    {leagueMatches.map((match) => {

                      const isExpanded = expandedMatches[match.id];

                      const displayBook = match.bookmakers?.find(book=>book.markets?.some(m=>m.key === 'h2h')) || match.bookmakers?.[0];
                      const allMarkets = displayBook?.markets || [];

                      

                      // H2H is the main market shown on the row

                      const h2hMarket = allMarkets.find(m => m.key === 'h2h') || { outcomes: [] };

                      const h2hOutcomes = h2hMarket.outcomes;

                      const homeOdds = h2hOutcomes.find(o => o.name === match.home_team)?.price?.toFixed(2) || "N/A";

                      const awayOdds = h2hOutcomes.find(o => o.name === match.away_team)?.price?.toFixed(2) || "N/A";

                      const drawOdds = h2hOutcomes.find(o => o.name === "Draw")?.price?.toFixed(2) || "N/A";

                      

                      // Other Markets

                      const otherMarkets = ['total','handicap'].flatMap(key => match.bookmakers?.flatMap(book => book.markets || []).filter(m => m.key === key).slice(0,1) || []);



                      const matchDate = new Date(match.commence_time);

                      const isToday = fixtureDay(matchDate) === fixtureDay();

                      const isTomorrow = fixtureDay(matchDate) === fixtureDay(new Date(), 1);

                      const dayString = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : fixtureDay(matchDate);

                      const closed = match.archived || matchDate <= new Date() || (match.statusName && match.statusName !== 'STATUS_SCHEDULED');

                      const timeString = `${matchDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit',timeZone:'Europe/Bucharest',hour12:false})}`;



                      return (

                        <motion.div 

                          key={match.id}

                          variants={itemVariants}

                          layout

                          className="flex flex-col group"

                        >

                          {/* Main Row */}

                          <div 

                            onClick={() => toggleMatchExpansion(match.id)}

                            className="px-6 py-5 hover:bg-white/5 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer"

                          >

                            <div className="flex-1 flex items-start space-x-4">

                              <div className="text-center shrink-0 w-16">

                                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">{dayString}</div>

                                <div className="text-sm font-bold text-white">{timeString}</div>

                              </div>

                              

                              <div className="flex-1 space-y-2">

                                <div className="font-semibold text-white text-base leading-none group-hover:text-accent-green transition-colors">{match.home_team}</div>

                                <div className="font-semibold text-white text-base leading-none">{match.away_team}</div>
                                <Link to={'/match/' + match.id} onClick={e => e.stopPropagation()} className="stats-link">Stats & model ↗</Link>

                                <div className="text-xs text-gray-500 mt-2 flex items-center">

                                  {h2hOutcomes.length > 0 && <span className="mr-2">{displayBook.title} · {closed ? "Pre-match odds" : "1X2"}</span>}
                                  {otherMarkets.length > 0 && (

                                    <>

                                      {isExpanded ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}

                                      {otherMarkets.length} More Markets

                                    </>

                                  )}

                                </div>

                              </div>

                              

                              {closed && (

                                <div className="flex items-center text-[10px] font-bold text-accent-green bg-accent-green/10 px-2 py-1 rounded border border-accent-green/20">

                                  <TrendingUp className="w-3 h-3 mr-1" /> {match.archived ? 'Snapshot' : match.statusLabel || 'Started'}

                                </div>

                              )}

                            </div>



                            {/* 1X2 Odds */}

                            <div className="flex space-x-2 md:w-[280px] shrink-0" onClick={e => e.stopPropagation()}>

                              {[ 

                                { name: match.home_team, price: homeOdds, label: '1' }, 

                                { name: 'Draw', price: drawOdds, label: 'X' }, 

                                { name: match.away_team, price: awayOdds, label: '2' } 

                              ].map((outcome, idx) => {

                                const betInSlip = bets.find(b => b.matchId === match.id && b.selection === outcome.name);

                                return (

                                  <motion.button 

                                    key={idx}

                                    whileTap={{ scale: 0.95 }}

                                    disabled={closed || !(Number(outcome.price) > 1)} onClick={(e) => handleOddsClick(match, outcome.name, outcome.price, e)}

                                    className={`flex-1 flex flex-col items-center justify-center py-2 rounded-xl border transition-all ${

                                      betInSlip

                                        ? 'bg-accent-green border-accent-green text-bg-dark shadow-[0_0_15px_rgba(59,89,73,0.4)]' 

                                        : 'bg-black/30 border-white/10 hover:border-accent-green hover:bg-black/50 text-white'

                                    }`}

                                  >

                                    <span className={`text-[9px] font-bold uppercase mb-0.5 ${betInSlip ? 'text-bg-dark/70' : 'text-gray-500'}`}>

                                      {outcome.label}

                                    </span>

                                    <span className="font-bold text-sm">

                                      {outcome.price}

                                    </span>

                                  </motion.button>

                                );

                              })}

                            </div>

                          </div>



                          {/* Expanded Markets Panel */}

                          <AnimatePresence>

                            {isExpanded && otherMarkets.length > 0 && (

                              <motion.div

                                initial={{ height: 0, opacity: 0 }}

                                animate={{ height: 'auto', opacity: 1 }}

                                exit={{ height: 0, opacity: 0 }}

                                className="overflow-hidden bg-black/60 border-t border-white/5"

                              >

                                <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                                  {otherMarkets.map((market, mIdx) => (

                                    <div key={mIdx} className="space-y-3">

                                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">{market.title}</h4>

                                      <div className="grid grid-cols-2 gap-2">

                                        {market.outcomes.map((outcome, oIdx) => {

                                          const betInSlip = bets.find(b => b.matchId === match.id && b.selection === `${market.title} - ${outcome.name}`);

                                          return (

                                            <motion.button

                                              key={oIdx}

                                              whileTap={{ scale: 0.95 }}

                                              disabled={closed} onClick={(e) => handleOddsClick(match, `${market.title} - ${outcome.name}`, outcome.price, e, {market:market.key,side:outcome.side,line:outcome.line})}

                                              className={`flex justify-between items-center px-4 py-3 rounded-xl border transition-all ${

                                                betInSlip

                                                  ? 'bg-accent-green border-accent-green text-bg-dark shadow-[0_0_10px_rgba(59,89,73,0.3)]' 

                                                  : 'bg-white/5 border-white/10 hover:border-accent-green hover:bg-white/10 text-white'

                                              }`}

                                            >

                                              <span className={`text-sm font-semibold ${betInSlip ? 'text-bg-dark' : 'text-gray-300'}`}>

                                                {outcome.name}

                                              </span>

                                              <span className={`text-sm font-bold ${betInSlip ? 'text-bg-dark' : 'text-white'}`}>

                                                {outcome.price}

                                              </span>

                                            </motion.button>

                                          );

                                        })}

                                      </div>

                                    </div>

                                  ))}

                                </div>

                              </motion.div>

                            )}

                          </AnimatePresence>

                        </motion.div>

                      );

                    })}

                  </AnimatePresence>

                </div>

              </div>

            ))}

          </motion.div>

        )}

      </div>

      

      <AIAnalysisModal 

        isOpen={isAIModalOpen} 

        onClose={() => setIsAIModalOpen(false)} 

        matches={filteredMatches} 

      />

    </div>

  );

};



export default AllBets;

