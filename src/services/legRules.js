// Settlement rules for the extra markets a copied ticket can hold (beyond
// 1X2, total goals and handicap). Shared by the engine and the analysis.

/** Markets that need the half-time score. */
export const HALF_TIME_MARKETS = new Set(['ht_total', 'ht_h2h', 'half_or_full']);
export const EXTRA_MARKETS = new Set(['btts', 'double', 'team_total', ...HALF_TIME_MARKETS]);

/** "2–1" (any dash) to [2, 1], or null. */
export function readScore(text) {
  const m = String(text || '').match(/(\d+)\D+(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const sideOf = (h, a) => h > a ? 'home' : h < a ? 'away' : 'draw';

/**
 * Outcome of one extra-market leg: 'won', 'lost', 'void', or null while the
 * scores it needs are not known yet. s = { home, away, htHome?, htAway? };
 * htHome === null means the half-time score will never be available (refund).
 */
export function settleExtra(leg, s) {
  const { home: h, away: a } = s;
  const ht = Number.isFinite(s.htHome) && Number.isFinite(s.htAway);
  switch (leg.market) {
    case 'btts': return ((h > 0 && a > 0) === (leg.side === 'yes')) ? 'won' : 'lost';
    case 'double': {
      const r = sideOf(h, a);
      const ok = leg.side === 'homeDraw' ? r !== 'away' : leg.side === 'drawAway' ? r !== 'home' : r !== 'draw';
      return ok ? 'won' : 'lost';
    }
    case 'team_total': {
      const goals = leg.team === 'home' ? h : a;
      return (leg.side === 'over' ? goals > leg.line : goals < leg.line) ? 'won' : 'lost';
    }
    case 'half_or_full': {
      // Wins if the team leads at half-time or wins the match.
      if (sideOf(h, a) === leg.team) return 'won';
      if (ht) return sideOf(s.htHome, s.htAway) === leg.team ? 'won' : 'lost';
      return s.htHome === null ? 'void' : null;
    }
    case 'ht_total':
      if (!ht) return s.htHome === null ? 'void' : null;
      return (leg.side === 'over' ? s.htHome + s.htAway > leg.line : s.htHome + s.htAway < leg.line) ? 'won' : 'lost';
    case 'ht_h2h':
      if (!ht) return s.htHome === null ? 'void' : null;
      return sideOf(s.htHome, s.htAway) === leg.side ? 'won' : 'lost';
    default: return null;
  }
}
