// Hour view: summary, key and the persistent cell list. Built from /api/adjudicate/hour (contract v1.1).
// `tier: null` renders as UNKNOWN (hatched, hollow); an out-of-record hour renders as NOT IN RECORD.
// Neither is ever drawn as clear. The list is rendered once per hour and is never rebuilt by a
// selection: selecting only toggles a mark on an existing row, so scroll position survives.
import { el, clear } from './dom.js';
import { hourNotElapsed } from './clock.js';
import { cellPlace } from './place.js';
import { TIER_STYLE, DET_STROKE, UNKNOWN_STROKE, TIER_ORDER, tally, rankCells, tierKey } from './tiers.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEX = '12,2 21,7 21,17 12,22 3,17 3,7';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const HATCH_ID = 'adj-hatch';

export const REASON_LABEL = {
  before_record: 'BEFORE THE RECORD BEGINS',
  after_record: 'AFTER THE RECORD ENDS',
  gap_in_record: 'GAP INSIDE THE RECORD',
  not_committed: 'FILE NOT COMMITTED',
};

export function hourText(iso) {
  return `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)} · ${iso.slice(11, 16)} UTC`;
}

function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, val] of Object.entries(attrs)) n.setAttribute(k, String(val));
  return n;
}

// One shared hatch pattern for every UNKNOWN swatch, so hundreds of rows cost one definition.
function ensureHatch() {
  if (document.getElementById(HATCH_ID)) return;
  const svg = svgEl('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' });
  svg.style.position = 'absolute';
  const defs = svgEl('defs', {});
  const pat = svgEl('pattern', { id: HATCH_ID, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 5, stroke: UNKNOWN_STROKE, 'stroke-width': 1.4 }));
  defs.appendChild(pat);
  svg.appendChild(defs);
  document.body.appendChild(svg);
}

// Hex swatch that mirrors exactly how the map draws a cell. kind: a tier name, UNKNOWN, DEGRADED, CLEAR.
export function swatch(kind) {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', class: 'sw', 'aria-hidden': 'true' });
  let fill = 'none', stroke = 'none', width = 1.5, dash = null;
  if (kind === 'UNKNOWN') {
    ensureHatch();
    fill = `url(#${HATCH_ID})`; stroke = UNKNOWN_STROKE; dash = '3 2';
  } else if (kind === 'DEGRADED') {
    fill = TIER_STYLE.SUPPORTED.fill; stroke = DET_STROKE.DEGRADED; width = 2.6;
  } else if (kind === 'CLEAR') {
    fill = TIER_STYLE.SUPPORTED.fill; stroke = DET_STROKE.CLEAR; width = 1.8;
  } else {
    fill = TIER_STYLE[kind].fill;
  }
  const poly = svgEl('polygon', { points: HEX, fill, stroke, 'stroke-width': width, 'stroke-linejoin': 'round' });
  if (dash) poly.setAttribute('stroke-dasharray', dash);
  svg.appendChild(poly);
  return svg;
}

function chip(kind, word, n, extra = {}) {
  return el('li', { class: 'lg-row', ...extra }, [
    swatch(kind), el('span', { class: 'lg-word' }, word), el('b', { class: 'lg-n mono' }, String(n)),
  ]);
}

// Key, folded into the list zone so nothing sits on the map. Colour is tier; the outline is the cheap determination.
export function renderLegend(node, data) {
  clear(node);
  if (!data || data.out_of_record) { node.hidden = true; return; }
  node.hidden = false;
  const t = tally(data.cells);
  const rows = el('ul', { class: 'lg-rows' });
  for (const k of [...TIER_ORDER, 'UNKNOWN']) {
    const word = k === 'UNKNOWN' ? 'UNKNOWN · no observation' : TIER_STYLE[k].word;
    rows.appendChild(chip(k, word, t.tiers[k], { 'data-tier': k }));
  }
  node.appendChild(rows);
  const dets = el('ul', { class: 'lg-rows lg-dets' });
  for (const k of ['DEGRADED', 'CLEAR']) dets.appendChild(chip(k, k, t.dets[k], { 'data-det': k }));
  // Observed, but the evidence is too weak to clear (amendment A3: CLEAR needs
  // SUPPORTED or STRONG, so an un-degraded WEAK cell stays undetermined). This
  // used to be a separate text line that repeated DEGRADED and CLEAR verbatim
  // beside these chips; it is one number, so it is one chip.
  dets.appendChild(chip('UNKNOWN', 'TOO WEAK TO CLEAR', t.dets.UNKNOWN - t.unknown,
    { 'data-det': 'WEAKHELD' }));
  node.appendChild(el('div', { class: 'lg-sub' }, 'OUTLINE = CHEAP DETERMINATION'));
  node.appendChild(dets);
  node.appendChild(el('div', { class: 'lg-foot' }, 'COLOUR = TIER, NEVER PROBABILITY'));
}

// Summary at the head of the list zone: the ratio is the one dominant element.
export function renderHourHead(node, data) {
  clear(node);
  if (data.out_of_record) {
    node.appendChild(el('div', { class: 'det' }, 'NOT IN RECORD'));
    node.appendChild(el('div', { class: 'where mono' }, [hourText(data.hour), el('br'),
      REASON_LABEL[data.out_of_record_reason] || 'NOT IN THE COMMITTED RECORD']));
    node.appendChild(el('div', { class: 'oor-note' }, 'This hour is not in the committed record, which says nothing about whether anything happened.'));
    return;
  }
  const t = tally(data.cells);
  node.appendChild(el('div', { class: 'where mono' }, `${hourText(data.hour)} · ${t.total} CELLS`));
  if (hourNotElapsed(data.hour)) {
    node.appendChild(el('div', { class: 'notyet' }, [
      el('b', {}, 'THIS HOUR HAS NOT FINISHED YET'),
      el('span', {},
        'The record already covers it because forecasts are committed before the '
        + 'hour they cover, but nothing has been observed in it. Zero adjudicable '
        + 'here means not yet, not "nothing happened".'),
    ]));
  }
  // ONE hero figure per view. This used to print the adjudicable count and the
  // unknown count side by side at the same display size, and two 48px numbers
  // race each other -- the reader cannot tell which is the subject. The unknown
  // count is NOT demoted: it keeps the meter and is stated in words directly
  // below, because "most cells are unknown" is the honest headline of this
  // product and must stay on screen. It is simply no longer a rival hero.
  node.appendChild(el('div', { class: 'hero-fig' }, [
    el('b', { class: 'mono' }, String(t.adjudicable)),
    el('span', {}, 'ADJUDICABLE'),
  ]));
  const share = el('div', { class: 'ratio-bar', role: 'img',
    'aria-label': `${t.adjudicable} adjudicable, ${t.unknown} unknown, of ${t.total}` }, [
    el('i', { class: 'rb-ok' }), el('i', { class: 'rb-unk' }),
  ]);
  share.firstChild.style.flexGrow = String(t.adjudicable);
  share.lastChild.style.flexGrow = String(t.unknown);
  node.appendChild(share);
  const pct = t.total ? Math.round((t.unknown / t.total) * 100) : 0;
  node.appendChild(el('div', { class: 'unk-note' },
    `${t.unknown} of ${t.total} cells had no observation (${pct}%) — no aircraft `
    + `reported from them in this hour, so nothing can be said either way.`));
}

export function renderHourError(head, list, err) {
  clear(head);
  clear(list);
  head.appendChild(el('div', { class: 'det' }, 'NO ANSWER'));
  head.appendChild(el('div', { class: 'where mono' }, `${err.code}: ${err.message}`));
}

// Every cell of the hour, strongest evidence first, UNKNOWN last behind its own divider.
export function renderCellList(list, data, onPick) {
  clear(list);
  if (data.out_of_record) return;
  const ranked = rankCells(data.cells);
  let divided = false;
  for (const c of ranked) {
    const key = tierKey(c);
    if (key === 'UNKNOWN' && !divided) {
      divided = true;
      const n = ranked.filter((x) => tierKey(x) === 'UNKNOWN').length;
      // Collapsed by default. Hundreds of identical "UNKNOWN / UNKNOWN" rows
      // carry one bit of information between them and bury the adjudicable
      // cells above -- which are the only rows anyone can act on. The count
      // stays visible, so nothing is hidden; it is one click to open.
      const toggle = el('button', { type: 'button', class: 'grp grp-toggle mono',
        'aria-expanded': 'false', 'aria-controls': 'unknown-rows' },
        `NO OBSERVATION · ${n} CELLS · SHOW`);
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
        toggle.textContent = `NO OBSERVATION · ${n} CELLS · ${open ? 'SHOW' : 'HIDE'}`;
        list.setAttribute('data-unknown', open ? 'collapsed' : 'open');
      });
      list.setAttribute('data-unknown', 'collapsed');
      list.appendChild(el('li', { class: 'grp-row' }, [toggle]));
    }
    // Lead with WHERE, not with the cell id. A column of `871e15015ffffff`
    // cannot be read: nothing tells one row from the next, or north from
    // south. The id is still the API key, so it moves to the tooltip and
    // stays in the inspector header. See place.js for what is deliberately
    // NOT shown here.
    const place = cellPlace(c.h3);
    const b = el('button', {
      type: 'button', class: 'cellbtn', 'data-h3': c.h3, 'data-tier': key,
      'data-det': c.determination,
      title: place
        ? `${c.h3} — ${place.coords}${place.country ? ' — ' + place.country : ''}`
        : c.h3,
    }, [
      swatch(key),
      el('span', { class: 'cb-country' },
        place && place.countryShort ? place.countryShort : ''),
      el('span', { class: 'mono cb-where' },
        place ? place.coords : c.h3),
      el('span', { class: 'cb-tier' }, TIER_STYLE[key].word),
      el('span', { class: 'cb-det mono' }, c.determination),
    ]);
    b.addEventListener('click', () => onPick(c));
    list.appendChild(el('li', key === 'UNKNOWN' ? { class: 'unk-row' } : {}, b));
  }
}

// Fill in the country column after the gazetteer arrives, WITHOUT rebuilding.
// Re-rendering the list would throw away scroll position and the selected row
// -- the invariant test_selection_never_rebuilds_the_list exists to protect --
// for what is only a decoration on rows that already read correctly.
export function fillCountries(list) {
  let filled = 0;
  for (const b of list.querySelectorAll('.cellbtn[data-h3]')) {
    const slot = b.querySelector('.cb-country');
    if (!slot || slot.textContent) continue;
    const place = cellPlace(b.getAttribute('data-h3'));
    if (!place || !place.country) continue;
    slot.textContent = place.countryShort;
    b.title = `${b.getAttribute('data-h3')} — ${place.coords} — ${place.country}`;
    filled += 1;
  }
  return filled;
}


function rows(list) { return Array.from(list.querySelectorAll('.cellbtn')); }

export function rowFor(list, h3id) {
  return rows(list).find((b) => b.getAttribute('data-h3') === h3id) || null;
}

// Mark one row as the current place. Touches attributes only: no rebuild, so the scroll position is kept.
// The row is scrolled into view only when it is outside the visible part of the list.
export function markSelected(list, h3id, reveal = true) {
  for (const b of list.querySelectorAll('.cellbtn[aria-current]')) b.removeAttribute('aria-current');
  if (!h3id) return null;
  const row = rowFor(list, h3id);
  if (!row) return null;
  row.setAttribute('aria-current', 'true');
  if (reveal) row.scrollIntoView({ block: 'nearest' });
  return row;
}

// The id one step up/down the list from `h3id` (first row when nothing is selected); null at the ends or when empty.
export function stepFrom(list, h3id, delta) {
  const all = rows(list);
  if (!all.length) return null;
  const at = all.findIndex((b) => b.getAttribute('data-h3') === h3id);
  if (at < 0) return all[delta > 0 ? 0 : all.length - 1].getAttribute('data-h3');
  const next = all[at + delta];
  return next ? next.getAttribute('data-h3') : null;
}

// Full-map overlay for an out-of-record hour: hatched, labelled, impossible to read as an empty hour.
export function renderOutOfRecord(node, data) {
  clear(node);
  if (!data || !data.out_of_record) { node.hidden = true; return; }
  node.hidden = false;
  node.appendChild(el('div', { class: 'oor-title' }, 'OUT OF RECORD'));
  node.appendChild(el('div', { class: 'oor-reason mono' }, REASON_LABEL[data.out_of_record_reason] || 'NOT IN THE COMMITTED RECORD'));
  node.appendChild(el('div', { class: 'oor-hour mono' }, hourText(data.hour)));
}
