// The time ribbon: one column per hour over the last N hours, height = how many
// cells could be adjudicated in that hour. It is both the picture and the
// navigation -- clicking a column goes to that hour.
//
// FORM (dataviz procedure, step 1): the job is magnitude over time, so this is a
// column chart on one axis with ONE hue. Deliberately NOT a stacked
// degraded/clear chart: the reader's question here is "where is there anything to
// adjudicate", and stacking a second category buries that under a two-colour
// pattern. The determination split lives in the tooltip and the stat tiles.
//
// COLOUR (step 2): a single series, so a single hue -- never a value ramp keyed to
// bar height, which would double-encode height as colour. The selected hour is
// EMPHASIS (full accent); every other column is the same hue, recessive. Two
// states are textures rather than hues, because they are absences, not values:
//   * not elapsed  -> hatched. The committed record runs AHEAD of the clock (a
//     forecast is committed before the hour it covers), so these hours exist in
//     the record with zero adjudicable. Measured 2026-10-21T00:52Z: 01:00Z and
//     02:00Z held 607 and 545 cells and nothing observed.
//   * not in record -> an empty slot with a baseline tick only.
// Neither may ever render as a short bar: a zero-height column would say "we
// looked and found nothing", which is the one thing this product must not say.
import { el, clear } from './dom.js';
import { hourNotElapsed } from './clock.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export const RIBBON_HOURS = 48;
const PLOT_H = 44;          // plot area, excluding the day-label gutter
const GUTTER_H = 14;        // day labels sit below the baseline
const BAR_MAX_W = 14;       // the skill caps a column at 24px; a ribbon reads better thinner
const BAR_GAP = 2;          // the 2px surface gap between adjacent fills
const BAR_MIN_H = 2;        // a nonzero hour must never render as nothing
const HATCH_ID = 'adj-ribbon-hatch';

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

// Carries the YEAR, like hourText() in hour.js. A frozen bundle is read months
// after it is made, and "19 OCT · 14:00 UTC" does not say which year -- an
// ambiguity the rest of the console does not have.
export function binLabel(iso) {
  return `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
    + ` · ${iso.slice(11, 16)} UTC`;
}

// What this bin IS, as one word. Order matters: an hour outside the record is
// unknowable whether or not it has elapsed.
export function binState(bin) {
  if (!bin.in_record) return 'absent';
  if (bin.not_elapsed || hourNotElapsed(bin.hour)) return 'pending';
  return 'present';
}

// Linear scale, shared baseline, with a floor so a 1-cell hour is still visible.
// The floor is a legibility device, not a value: the exact count is in the
// tooltip, and a zero stays zero.
export function barHeight(adjudicable, max, plot = PLOT_H) {
  if (!adjudicable) return 0;
  if (max <= 0) return BAR_MIN_H;
  return Math.max(BAR_MIN_H, Math.round((adjudicable / max) * plot));
}

function ensureHatch(svg) {
  if (svg.querySelector(`#${HATCH_ID}`)) return;
  const defs = svgEl('defs');
  const pat = svgEl('pattern', { id: HATCH_ID, width: 4, height: 4,
    patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 4,
    stroke: 'currentColor', 'stroke-width': 1.2 }));
  defs.appendChild(pat);
  svg.appendChild(defs);
}

// The reason an exported bundle stamps on a bin it did not carry. An hour the
// bundle omits is NOT a gap in the record, and must not be described as one.
const NOT_IN_EXPORT = 'not in this export';

export function tooltipText(bin) {
  if (!bin.in_record) {
    if (bin.out_of_record_reason === NOT_IN_EXPORT) {
      return [binLabel(bin.hour), 'NOT IN THIS EXPORT',
        'This snapshot does not carry this hour. That is a limit of the '
        + 'snapshot, not a gap in the record and not a finding.'];
    }
    return [binLabel(bin.hour), 'NOT IN THE RECORD',
      'Nothing was committed for this hour. That is a gap in the record, not a finding.'];
  }
  if (binState(bin) === 'pending') {
    // Two different truths. Live, the hour genuinely has not finished. In a
    // frozen bundle opened days later it HAD not finished when the data was
    // taken -- saying "yet" there would be false. The viewer's clock decides,
    // so one wording serves both and neither overstates.
    const stillRunning = hourNotElapsed(bin.hour);
    return [binLabel(bin.hour),
      stillRunning ? 'HAS NOT FINISHED YET' : 'HAD NOT FINISHED WHEN THIS DATA WAS TAKEN',
      `${bin.n_cells} cells committed ahead of the hour; nothing observed in it `
      + `${stillRunning ? 'yet' : 'at that point'}.`];
  }
  const d = bin.dets || {};
  return [binLabel(bin.hour), `${bin.adjudicable} ADJUDICABLE of ${bin.n_cells} CELLS`,
    `degraded ${d.DEGRADED || 0} · clear ${d.CLEAR || 0} · no observation ${d.UNKNOWN || 0}`];
}

/**
 * Render the ribbon into `node`.
 * @param {HTMLElement} node   container
 * @param {Array} bins         contiguous, oldest first (contract: never sparse)
 * @param {string|null} selected  hour to emphasise
 * @param {(hour:string)=>void} onPick
 */
export function renderRibbon(node, bins, selected, onPick) {
  clear(node);
  if (!bins || !bins.length) { node.hidden = true; return; }
  node.hidden = false;

  const n = bins.length;
  const slot = BAR_MAX_W + BAR_GAP;
  const w = n * slot;
  const h = PLOT_H + GUTTER_H;
  const max = bins.reduce((m, b) => Math.max(m, b.in_record ? b.adjudicable : 0), 0);

  const svg = svgEl('svg', {
    class: 'rb-svg', viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': `Adjudicable cells per hour for the last ${n} hours. `
      + `Peak ${max}. Select an hour to open it.`,
  });
  ensureHatch(svg);

  // Hairline baseline, solid and recessive (never dashed).
  svg.appendChild(svgEl('line', { class: 'rb-base', x1: 0, y1: PLOT_H, x2: w, y2: PLOT_H }));

  bins.forEach((bin, i) => {
    const x = i * slot;
    // What the bin IS and whether it is SELECTED are two facts. They used to
    // share data-state, so a selected pending hour lost its cursor (pending won)
    // and markRibbon could only move the cursor between 'present' columns.
    const state = binState(bin);
    const g = svgEl('g', { class: 'rb-col', 'data-state': state, 'data-hour': bin.hour });
    if (bin.hour === selected) g.setAttribute('data-selected', 'true');

    if (state === 'absent') {
      // No bar at all: a 1px tick on the baseline, so the slot is visibly empty
      // rather than visibly zero.
      g.appendChild(svgEl('rect', { class: 'rb-absent',
        x, y: PLOT_H - 1, width: BAR_MAX_W, height: 1 }));
    } else if (state === 'pending') {
      g.appendChild(svgEl('rect', { class: 'rb-pending',
        x, y: 0, width: BAR_MAX_W, height: PLOT_H, fill: `url(#${HATCH_ID})` }));
    } else {
      const bh = barHeight(bin.adjudicable, max);
      if (bh > 0) {
        // 4px rounded data-end, square at the baseline: draw a rounded rect and
        // cover the bottom corners with a square patch.
        const r = Math.min(4, bh);
        g.appendChild(svgEl('rect', { class: 'rb-bar',
          x, y: PLOT_H - bh, width: BAR_MAX_W, height: bh, rx: r, ry: r }));
        if (bh > r) {
          g.appendChild(svgEl('rect', { class: 'rb-bar rb-foot',
            x, y: PLOT_H - r, width: BAR_MAX_W, height: r }));
        }
      } else {
        g.appendChild(svgEl('rect', { class: 'rb-zero',
          x, y: PLOT_H - 1, width: BAR_MAX_W, height: 1 }));
      }
    }

    // Day boundary: a hairline at 00Z, with the date in the gutter.
    if (bin.hour.slice(11, 13) === '00') {
      g.appendChild(svgEl('line', { class: 'rb-day', x1: x - 1, y1: 0, x2: x - 1, y2: PLOT_H }));
      const t = svgEl('text', { class: 'rb-daylabel', x: x + 2, y: h - 3 });
      t.textContent = `${bin.hour.slice(8, 10)} ${MONTHS[Number(bin.hour.slice(5, 7)) - 1]}`;
      g.appendChild(t);
    }

    // Hit target spans the full height, so the pointer never has to find a 2px bar.
    const hit = svgEl('rect', { class: 'rb-hit', x, y: 0, width: slot, height: h });
    const title = svgEl('title');
    title.textContent = tooltipText(bin).join(' — ');
    hit.appendChild(title);
    hit.addEventListener('click', () => onPick(bin.hour));
    g.appendChild(hit);
    svg.appendChild(g);
  });

  node.appendChild(svg);
  node.appendChild(el('div', { class: 'rb-tip', hidden: true }));
  wireTooltip(node, bins);
}

// Per-mark hover tooltip (the skill requires a hover layer on a bar chart).
function wireTooltip(node, bins) {
  const tip = node.querySelector('.rb-tip');
  const byHour = new Map(bins.map((b) => [b.hour, b]));
  const show = (ev) => {
    const g = ev.target.closest('.rb-col');
    if (!g) return;
    const bin = byHour.get(g.getAttribute('data-hour'));
    if (!bin) return;
    clear(tip);
    const [where, headline, detail] = tooltipText(bin);
    tip.appendChild(el('b', {}, headline));
    tip.appendChild(el('span', { class: 'rb-tip-where mono' }, where));
    tip.appendChild(el('span', { class: 'rb-tip-detail' }, detail));
    tip.hidden = false;
    const box = node.getBoundingClientRect();
    const col = g.getBoundingClientRect();
    const left = col.left - box.left + col.width / 2;
    tip.style.left = `${Math.max(4, Math.min(left, box.width - 4))}px`;
  };
  node.addEventListener('pointermove', show);
  node.addEventListener('pointerleave', () => { tip.hidden = true; });
}

// Mark one hour without re-rendering, so hovering and scrolling survive a selection.
export function markRibbon(node, hour) {
  for (const g of node.querySelectorAll('.rb-col[data-selected]')) {
    g.removeAttribute('data-selected');
  }
  const g = node.querySelector(`.rb-col[data-hour="${hour}"]`);
  if (g) g.setAttribute('data-selected', 'true');   // any state can be the cursor
  return g;
}
