// The adjudicability tier is the ONLY evidence-strength signal. Cells are coloured by tier, never by
// probability: a high-probability cell we cannot adjudicate must not look stronger than a low-probability
// cell we can. `tier: null` is "no observation row for this hour": UNKNOWN, never clear, never absent.
export const TIER_ORDER = ['STRONG', 'SUPPORTED', 'WEAK', 'NOT_ADJUDICABLE'];
export const ADJUDICABLE = ['STRONG', 'SUPPORTED', 'WEAK'];

export const TIER_STYLE = {
  STRONG: { fill: '#4fd1c5', pips: 3, word: 'STRONG' },
  SUPPORTED: { fill: '#2f9a92', pips: 2, word: 'SUPPORTED' },
  WEAK: { fill: '#25736f', pips: 1, word: 'WEAK' },
  NOT_ADJUDICABLE: { fill: '#3a4152', pips: 0, word: 'NOT ADJUDICABLE' },
  UNKNOWN: { fill: null, pips: 0, word: 'UNKNOWN' },
};

// Secondary channel: the cheap determination is an outline, always paired with a legend icon + label.
export const DET_STROKE = { DEGRADED: '#ff5c61', CLEAR: '#3fd68f' };
export const UNKNOWN_STROKE = '#d3d8ea';

export function tierKey(cell) {
  return cell.tier === null || cell.tier === undefined ? 'UNKNOWN' : cell.tier;
}

export function tally(cells) {
  const tiers = { STRONG: 0, SUPPORTED: 0, WEAK: 0, NOT_ADJUDICABLE: 0, UNKNOWN: 0 };
  const dets = { DEGRADED: 0, CLEAR: 0, UNKNOWN: 0 };
  for (const c of cells) {
    tiers[tierKey(c)] += 1;
    dets[c.determination] += 1;
  }
  const adjudicable = ADJUDICABLE.reduce((n, t) => n + tiers[t], 0);
  return { total: cells.length, tiers, dets, adjudicable, unknown: tiers.UNKNOWN };
}

// Strongest evidence first, then highest probability; UNKNOWN last.
export function rankCells(cells) {
  const rank = (c) => {
    const k = tierKey(c);
    const i = TIER_ORDER.indexOf(k);
    return i < 0 ? TIER_ORDER.length : i;
  };
  return cells.slice().sort((a, b) => rank(a) - rank(b) || b.probability - a.probability);
}
