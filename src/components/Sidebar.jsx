import React from 'react';
import { motion } from 'framer-motion';
import { Grid, Trophy, Archive, PieChart } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const Dock = () => {
  const location = useLocation();

  const navItems = [
    { path: '/', Icon: Grid, label: 'Home' },
    { path: '/bets', Icon: Trophy, label: 'Markets' },
    { path: '/my-bets', Icon: Archive, label: 'My Bets' },
    { path: '/analytics', Icon: PieChart, label: 'Analytics' }
  ];

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <motion.nav 
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="flex items-center space-x-2 bg-black/40 backdrop-blur-2xl border border-white/10 px-4 py-3 rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
      >
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link key={item.path} to={item.path} className="relative group">
              <motion.div 
                whileHover={{ scale: 1.15, y: -5 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
                className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center transition-colors ${
                  isActive ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <item.Icon className="w-6 h-6 mb-1" />
                <span className="text-[9px] font-bold tracking-wider">{item.label}</span>
              </motion.div>
              
              {isActive && (
                <motion.div 
                  layoutId="dockIndicator"
                  className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white"
                />
              )}
            </Link>
          );
        })}
      </motion.nav>
    </div>
  );
};

export default Dock;
