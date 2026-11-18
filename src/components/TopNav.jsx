import { useState } from 'react';
import { FileText, LogOut, Menu, X } from 'lucide-react';
import { useBetContext } from '../context/BetContext';
import { NavLink } from 'react-router-dom';
import Overlay from './Overlay';
import { logout } from '../services/api';

const pages = [['/', 'Leaderboard'], ['/bets', 'Markets'], ['/auto-pilot', 'AI tickets'], ['/my-bets', 'My bets'], ['/analytics', 'Analytics']];

export default function TopNav() {
  const { bets, toggleSlip, user } = useBetContext();
  const [open, setOpen] = useState(false);
  const links = pages.map(([to, label]) => <NavLink key={to} to={to} end onClick={() => setOpen(false)}>{label}</NavLink>);
  return <header className="app-bar">
    <button className="mobile-menu" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu size={20}/></button>
    <nav aria-label="Main navigation" className="wide-nav">{links}</nav>
    <button className="slip-trigger" onClick={toggleSlip}><FileText size={16}/> Bet slip · {bets.length}</button>
    <button className="sign-out" onClick={logout} title={user ? 'Signed in as ' + user : 'Sign out'}><LogOut size={16}/><span>Sign out</span></button>
    {open && <Overlay label="Navigation" onClose={() => setOpen(false)}>
      <div className="menu-scrim" onClick={() => setOpen(false)}/>
      <nav className="menu-sheet"><button aria-label="Close navigation" onClick={() => setOpen(false)}><X/></button>{links}</nav>
    </Overlay>}
  </header>;
}
