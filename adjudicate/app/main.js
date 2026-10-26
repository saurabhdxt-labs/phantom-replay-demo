// Entry point. Three persistent zones, as in the other consoles: the hour LIST (left), the MAP (middle) and an
// INSPECTOR (right). Selecting a cell opens the inspector as a panel; it never replaces the list. The list
// is rendered once per hour, so its contents and scroll position survive every open and close.
import { Api } from './api.js';
import { State } from './state.js';
import { CellMap } from './map.js';
import { el, clear } from './dom.js';
import { renderAll, renderError, renderLoading } from './view.js';
import {
  renderHourHead, renderHourError, renderCellList, renderLegend, renderOutOfRecord,
  fillCountries,
  markSelected, rowFor, stepFrom, hourText, REASON_LABEL,
} from './hour.js';
import { renderCoverage, renderCoverageError } from './coverage.js';
import { attachApi } from './apitag.js';
import { HOUR_MS, iso, shift, lastCompleteHour, latestHourCandidates,
         ribbonEndFor } from './clock.js';
import { renderRibbon, markRibbon, RIBBON_HOURS } from './ribbon.js';
import { loadCountries } from './countries.js';
import { tally } from './tiers.js';

// Pre-verified live cases (2026-10-20), kept as deep links beside the live record.
const CASES = [
  { key: 'live', title: 'Live record', tag: 'Every cell, latest hour' },
  { key: 'verdict', title: 'A proven verdict', tag: 'Anchored in Bitcoin',
    area: '871fae670ffffff', hour: '2026-10-10T13:00:00Z' },
  { key: 'refusal', title: 'A refusal', tag: 'Strong evidence, still declined',
    area: '871fae670ffffff', hour: '2026-07-20T13:00:00Z' },
];
const VERIFICATION_CALL = { method: 'GET', path: '/api/adjudicate/verification', params: {} };
const HOUR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/;
const CELL_RE = /^[0-9a-f]{15}$/;

const $ = (id) => document.getElementById(id);
const nodes = {
  stage: $('stage'), hero: $('hero'), legs: $('leg-list'), chain: $('chain-list'),
  receipt: $('receipt'), limits: $('limit-list'),
};
const listNode = $('celllist');
const headNode = $('hourhead');
const inspector = $('inspector');
const api = new Api();
const state = new State();
const cellMap = new CellMap($('map'), $('map-caption'), (c) => select(c.h3));
let hourSeq = 0;
let verdictSeq = 0;
let latest = null;      // newest hour known to be in the record
let calls = { hour: null, verdict: null };
let ribbonBins = null;


const inspectorOpen = () => !inspector.hidden;

// State lives in the URL hash (hour + cell) so a refresh or a pasted link restores the same view.
// Query parameters are still read, so older deep links (?case=, ?hour=, ?cell=) keep working.
function readLocation() {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const hour = h.get('hour') || q.get('hour');
  const cell = h.get('cell') || q.get('cell');
  return {
    caseKey: q.get('case'),
    hour: HOUR_RE.test(hour || '') ? hour : null,
    cell: CELL_RE.test(cell || '') ? cell : null,
  };
}

function syncUrl() {
  const hash = new URLSearchParams();
  if (state.get('hour')) hash.set('hour', state.get('hour'));
  if (state.get('selected')) hash.set('cell', state.get('selected'));
  const ck = state.get('caseKey');
  const search = ck && ck !== 'live' ? `?case=${encodeURIComponent(ck)}` : '';
  history.replaceState(null, '', `${location.pathname}${search}#${hash.toString().replaceAll('%3A', ':')}`);
}

function setView(view) { nodes.stage.setAttribute('data-view', view); }

function markActive(key) {
  state.set('caseKey', key);
  document.querySelectorAll('.case').forEach((b) => {
    b.setAttribute('aria-selected', b.dataset.case === key ? 'true' : 'false');
  });
}

function renderTimebar() {
  const h = state.get('hour'), d = state.get('hourData');
  $('hour-label').textContent = h ? hourText(h) : '…';
  const chip = $('rec-chip');
  chip.removeAttribute('data-state');
  if (d) {
    chip.setAttribute('data-state', d.out_of_record ? 'out' : (d.committed_late ? 'late' : 'in'));
    chip.textContent = d.out_of_record
      ? `OUT OF RECORD · ${REASON_LABEL[d.out_of_record_reason] || ''}`
      : d.committed_late
        // the file covering this hour was committed after the hour began: it
        // is in the record for listing, but it is not a pre-commitment and
        // the cells it alone covers are refused one by one
        ? `COMMITTED AFTER THE HOUR BEGAN · ${d.mirror_commit.slice(0, 7)}`
        : `IN RECORD · COMMIT ${d.mirror_commit.slice(0, 7)}`;
  } else chip.textContent = '';
  $('step-fwd').disabled = !h || (latest !== null && h >= latest);
  $('step-fwd24').disabled = !h || (latest !== null && shift(h, 24) > latest);
  $('step-live').disabled = !h || !latest || h === latest;
}

function hourDet() {
  const d = state.get('hourData');
  return d && d.out_of_record ? 'OUT' : 'HOUR';
}

function showInspector(label) {
  $('insp-id').textContent = label;
  inspector.hidden = false;
  setView('cell');
}

// Close the inspector and nothing else: the list, its scroll, the hour and the map zoom stay exactly as they were.
function closeInspector({ focusRow = true } = {}) {
  verdictSeq += 1;
  const was = state.get('selected');
  state.set('selected', null);
  state.set('verdict', null);
  markSelected(listNode, null);
  cellMap.setSelected(null);
  cellMap.clearCaption();
  inspector.hidden = true;
  setView('hour');
  nodes.stage.setAttribute('data-det', hourDet());
  syncUrl();
  const row = was ? rowFor(listNode, was) : null;
  if (focusRow && row) row.focus({ preventScroll: true });
}

function showError(err) {
  closeInspector({ focusRow: false });
  nodes.stage.setAttribute('data-det', 'error');
  renderHourError(headNode, listNode, err);
}

async function loadHour(hour, { fit = false, keepSelection = false } = {}) {
  const mine = ++hourSeq;
  renderLoading(nodes);
  const res = await api.getHour(hour);
  if (mine !== hourSeq) return res;
  if (!res.ok) {
    state.set('hourData', null);
    cellMap.setCells([], false);
    renderLegend($('legend'), null);
    renderOutOfRecord($('oor'), null);
    showError(res.error);
    return res;
  }
  const d = res.data;
  calls.hour = res.call;
  state.set('hour', d.hour);
  state.set('hourData', d);
  cellMap.setCells(d.cells, fit);
  renderLegend($('legend'), d);
  renderOutOfRecord($('oor'), d);
  renderHourHead(headNode, d);
  // Move the ribbon's emphasis by attribute only -- no re-render, so a hover or
  // a mid-ribbon scroll survives changing hour. If the hour is outside the
  // window the ribbon was built for (a deep link, or a page left open past an
  // hour boundary), rebuild it rather than silently marking nothing.
  if (ribbonBins) {
    const marked = markRibbon($('rb-plot'), d.hour);
    if (!marked) loadRibbon(d.hour);
    // The section can have been hidden by an earlier failed window; if we still
    // have bins, it belongs on screen.
    $('ribbon').hidden = false;
    const sub = $('rb-sub');
    if (sub) {
      const peak = ribbonBins.reduce((m, b) => Math.max(m, b.in_record ? b.adjudicable : 0), 0);
      sub.textContent = marked
        ? `LAST ${ribbonBins.length}H · PEAK ${peak}`
        : `LAST ${ribbonBins.length}H · PEAK ${peak} · THIS HOUR IS OUTSIDE THIS RANGE`;
    }
  }
  renderCellList(listNode, d, (c) => select(c.h3));
  fillCountries(listNode);
  $('listscroll').scrollTop = 0;
  attachApi($('listzone'), calls.hour);
  attachApi($('map-panel'), res.call);
  $('map').setAttribute('data-hour-ms', String(res.ms));
  const sel = state.get('selected');
  if (sel && keepSelection && !d.out_of_record) {
    renderTimebar();
    await select(sel, { reveal: false });
  } else {
    if (inspectorOpen()) closeInspector({ focusRow: false });
    state.set('selected', null);
    nodes.stage.setAttribute('data-det', hourDet());
    renderTimebar();
  }
  syncUrl();
  return res;
}

// Open the inspector on a cell. `reveal` ties the map to it (moves only when it is off screen);
// `refit` instead frames the whole hour in the (now narrower) map.
async function select(h3id, { reveal = true, refit = false } = {}) {
  const hour = state.get('hour');
  const mine = ++verdictSeq;
  state.set('selected', h3id);
  const c = (state.get('hourData') || { cells: [] }).cells.find((x) => x.h3 === h3id);
  markSelected(listNode, h3id, true);
  cellMap.setSelected(h3id, c ? c.determination : null);
  showInspector(h3id);
  if (refit) cellMap.fitAll(false);
  if (reveal || refit) cellMap.reveal(h3id);
  renderLoading(nodes);
  const res = await api.getVerdict(h3id, hour);
  if (mine !== verdictSeq) return res;
  calls.verdict = res.call;
  if (res.ok) {
    state.set('error', null);
    state.set('verdict', res.verdict);
    renderAll(nodes, res.verdict);
    for (const id of ['hero', 'legs', 'chain', 'limits']) attachApi($(id), res.call);
    attachApi($('receipt'), [res.call, VERIFICATION_CALL]);
  } else {
    state.set('verdict', null);
    state.set('error', res.error);
    renderError(nodes, res.error);
  }
  syncUrl();
  return res;
}

// Newest in-record hour that has actually HAPPENED, or null if there is none.
//
// This was a binary search with a cap bolted on, and the cap had a fallback
// (`if (hi < 0) return at(0)`) that returned the search base -- a future hour --
// in precisely the case the cap existed for. Reproduced at now=2026-10-20T23:30Z
// with record.last_day=2026-10-21: it returned 2026-10-21T00:00:00Z, which had
// not started. The record runs 2-3h ahead of the clock, so last_day is
// "tomorrow" for 2-3 hours of every UTC day: not an edge case.
//
// It now walks `latestHourCandidates()` newest-first. Every candidate has
// elapsed, and because the walk probes each hour it can never return one it did
// not check -- the binary search could, under a hole in the record. Normally it
// costs one probe. Returns null rather than guessing, so callers must handle
// "no answer" instead of being handed a wrong one.
// No hour in the record has finished yet. That is a real state (the record can
// run ahead of the clock), and it is not an error and not a finding about the
// world -- so it is said in those words rather than rendered as an empty hour.
function showNoElapsedHour() {
  renderError(nodes, {
    code: 'no_elapsed_hour',
    message: 'No hour in the record has finished yet. The record commits '
      + 'forecasts before the hour they cover, so there is nothing observed '
      + 'to adjudicate yet. This is not a finding that nothing happened.',
  });
}

async function findLatest(cov) {
  const base = cov && cov.record.last_day ? Date.parse(`${cov.record.last_day}T00:00:00Z`)
    : Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  for (const h of latestHourCandidates(base)) {
    const r = await api.getHour(h);
    if (r.ok && !r.data.out_of_record) return h;
  }
  return null;
}

// Land on the hour with the MOST evidence in the last day, not merely the newest hour that has
// any. Measured 2026-10-20 across one day (2026-10-19): the unknown share tracks air traffic, not
// staleness — 12Z 43% unknown over 2,288 cells, 15Z 45% over 2,422, but 18Z 81%, 21Z 91%, 06Z 76%.
// A night hour is still ~83% unknown a full day later, so waiting does not improve it. We can only
// adjudicate where aircraft were flying, and that is diurnal.
//
// Picking by max adjudicable count finds the daytime peak WITHOUT hardcoding a UTC band (which
// would bake in a European-traffic assumption). Probed in parallel so the landing page stays fast.
// Nothing is hidden: the time bar shows the real hour, LATEST jumps to the live edge, and the
// unknown ratio is permanently on screen.
const LANDING_PROBE_STEP_H = 3;   // coarse grid; finer buys little, each probe is a request
const LANDING_PROBE_SPAN_H = 24;  // one full diurnal cycle

async function findLatestEvidence() {
  if (!latest) return null;   // no elapsed in-record hour to anchor the probes on
  const offsets = [];
  for (let i = 0; i < LANDING_PROBE_SPAN_H; i += LANDING_PROBE_STEP_H) offsets.push(i);
  const probes = await Promise.all(offsets.map(async (i) => {
    const h = shift(latest, -i);
    const r = await api.getHour(h);
    if (!r.ok || r.data.out_of_record) return null;
    return { hour: h, adjudicable: tally(r.data.cells).adjudicable };
  }));
  const usable = probes.filter((p) => p && p.adjudicable > 0);
  if (!usable.length) return null;
  // Most evidence wins; ties go to the more recent hour.
  usable.sort((a, b) => (b.adjudicable - a.adjudicable) || (a.hour < b.hour ? 1 : -1));
  return usable[0].hour;
}

function buildCases() {
  const bar = $('cases');
  clear(bar);
  for (const c of CASES) {
    const b = el('button', { type: 'button', class: 'case', role: 'tab', 'data-case': c.key, 'aria-selected': 'false' }, [
      el('span', { class: 'case-title' }, c.title),
    ]);
    b.title = c.tag;
    b.addEventListener('click', () => openCase(c));
    bar.appendChild(b);
  }
}

async function openCase(c) {
  markActive(c.key);
  if (c.key === 'live') {
    if (inspectorOpen()) closeInspector({ focusRow: false });
    const live = latest || (await findLatest(null));
    if (live) await loadHour(live, { fit: true }); else showNoElapsedHour();
    return;
  }
  await loadHour(c.hour, { fit: true });
  await select(c.area, { refit: true });
}

function step(hours) {
  const h = state.get('hour');
  if (!h) return;
  markActive(null);
  loadHour(shift(h, hours), { keepSelection: true });
}

function wireControls() {
  $('step-back').addEventListener('click', () => step(-1));
  $('step-fwd').addEventListener('click', () => step(1));
  $('step-back24').addEventListener('click', () => step(-24));
  $('step-fwd24').addEventListener('click', () => step(24));
  $('step-live').addEventListener('click', () => {
    if (!latest) return;
    markActive('live'); loadHour(latest, { fit: false, keepSelection: true });
  });
  $('step-evidence').addEventListener('click', async () => {
    const h = await findLatestEvidence();
    if (h) { markActive(null); loadHour(h, { keepSelection: false }); }
  });
  $('insp-close').addEventListener('click', () => closeInspector());
  $('jump-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const raw = $('jump').value.trim();
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2})/.exec(raw);
    const jerr = $('jump-error');
    jerr.hidden = true;
    if (!m) { jerr.textContent = 'use YYYY-MM-DDTHH'; jerr.hidden = false; return; }
    markActive(null);
    loadHour(`${m[1]}T${m[2]}:00:00Z`, { keepSelection: true });
  });
  document.addEventListener('keydown', (ev) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === 'ArrowLeft') step(ev.shiftKey ? -24 : -1);
    else if (ev.key === 'ArrowRight' && !$('step-fwd').disabled) step(ev.shiftKey ? 24 : 1);
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const next = stepFrom(listNode, state.get('selected'), ev.key === 'ArrowDown' ? 1 : -1);
      if (next) select(next);
    } else if (ev.key === 'Escape' && inspectorOpen()) closeInspector();
    else if (ev.key === 'f' || ev.key === 'F') cellMap.fitAll(true);
  });
  // A pasted or edited link (hash change only) restores that hour and cell.
  window.addEventListener('hashchange', async () => {
    const loc = readLocation();
    if (loc.hour && loc.hour !== state.get('hour')) await loadHour(loc.hour);
    if (loc.cell && loc.cell !== state.get('selected')) await select(loc.cell);
    else if (!loc.cell && state.get('selected')) closeInspector({ focusRow: false });
  });
}

function wireQuery() {
  const form = $('query-form'), errBox = $('input-error');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const area = $('area').value.trim(), hour = $('hour').value.trim();
    errBox.hidden = true;
    markActive(null);
    const mine = ++verdictSeq;
    state.set('selected', null);
    markSelected(listNode, null);
    cellMap.setSelected(null);
    showInspector(area || 'ANY CELL');
    renderLoading(nodes);
    const res = await api.getVerdict(area, hour);
    if (mine !== verdictSeq) return;
    if (res.ok) {
      state.set('verdict', res.verdict);
      renderAll(nodes, res.verdict);
      for (const id of ['hero', 'legs', 'chain', 'limits']) attachApi($(id), res.call);
      attachApi($('receipt'), [res.call, VERIFICATION_CALL]);
    } else {
      state.set('verdict', null);
      renderError(nodes, res.error);
      if (res.status >= 400 && res.status < 500) {
        errBox.textContent = `${res.error.code}: ${res.error.message}`;
        errBox.hidden = false;
      }
    }
  });
}

async function boot() {
  buildCases();
  wireControls();
  wireQuery();
  const covP = api.getCoverage();
  const cov = await covP;
  if (cov.ok) {
    renderCoverage($('coverage'), cov.data);
    attachApi($('scope'), cov.call);
  } else {
    renderCoverageError($('coverage'), cov.error);
  }
  latest = await findLatest(cov.ok ? cov.data : null);
  const loc = readLocation();
  const wanted = CASES.find((c) => c.key === loc.caseKey);
  if (wanted && wanted.key !== 'live') { await openCase(wanted); return; }
  markActive('live');
  // Land on the newest hour that HAS evidence, not the newest hour in the
  // record. Measured 2026-10-20: 18:00Z = 512 cells / 0 adjudicable, 17:00Z =
  // 76, 16:00Z = 306, 15:00Z = 752. Observations trail the committed forecast
  // by ~2-3h — that lag is the pre-commitment architecture working (we commit
  // BEFORE the window; evidence arrives after), not an absence of capability.
  // Landing on the zero hour would misrepresent a working system as useless.
  // Nothing is hidden: the time bar shows the real hour, stepping forward
  // reaches the live edge, and the unknown ratio is always on screen.
  const hour = loc.hour || (await findLatestEvidence()) || latest;
  // findLatest returns null rather than guessing when no in-record hour has
  // elapsed. Say so plainly instead of loading a null hour.
  if (!hour) { showNoElapsedHour(); return; }
  await loadHour(hour, { fit: true });
  if (loc.cell) await select(loc.cell, { refit: true });
  // The ribbon is loaded last and never blocks the view: it is navigation and
  // context, so a slow or missing /ribbon must not delay the hour the reader
  // asked for, and must not surface as an error over working content.
  loadRibbon(hour);
  // The gazetteer is ~168 KB and only decorates the list, so it never blocks
  // the hour the reader asked for. When it lands, re-render the list once so
  // the rows gain their country; everything already works without it.
  loadCountries().then((ok) => { if (ok) fillCountries(listNode); });
}

let ribbonEnd = null;

async function loadRibbon(hour) {
  const node = $('ribbon');
  const end = ribbonEndFor(hour, Date.now(), RIBBON_HOURS);
  if (end === ribbonEnd) return;      // already showing this window
  ribbonEnd = end;
  const r = await api.getRibbon(end, RIBBON_HOURS);
  if (!r.ok || !r.data || !Array.isArray(r.data.bins)) {
    // A window we cannot fetch must not destroy the one already on screen.
    // Measured in the exported bundle: deep-linking to the July refusal case
    // (outside the snapshot) 404'd, hid the section, and the ribbon never came
    // back for the rest of the session even after returning to a covered hour,
    // because the plot still matched and nothing re-showed the section. Losing
    // the navigation entirely is the exact complaint this chart was built for.
    ribbonEnd = null;
    if (!ribbonBins) node.hidden = true;     // nothing to fall back to
    return;
  }
  ribbonBins = r.data.bins;
  // Render into the plot child, never the section: the section also holds the
  // title and the texture key, and renderRibbon() clears whatever it is given.
  renderRibbon($('rb-plot'), ribbonBins, hour, (h) => {
    markActive(null);
    loadHour(h, { keepSelection: false });
  });
  // renderRibbon un-hides the node IT is given (the plot); the section carrying
  // the title and key is hidden in markup until there is something to show, so
  // it must be un-hidden here or the whole chart stays invisible.
  node.hidden = false;
  const sub = $('rb-sub');
  if (sub) {
    const peak = ribbonBins.reduce((m, b) => Math.max(m, b.in_record ? b.adjudicable : 0), 0);
    sub.textContent = `LAST ${ribbonBins.length}H · PEAK ${peak}`;
  }
  attachApi(node, r.call);
}

boot();
