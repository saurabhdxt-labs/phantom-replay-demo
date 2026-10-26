// "</> API" affordance: every panel can reveal the exact call that produced it.
// Osprey-class buyers consume the FEED; this makes the console prove it is embeddable.
import { el } from './dom.js';

export function callUrl(call, origin = location.origin) {
  const qs = Object.entries(call.params)
    .map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join('&');
  return `${origin}${call.path}${qs ? `?${qs}` : ''}`;
}

export function callCurl(call, origin = location.origin) {
  return `curl -s '${callUrl(call, origin)}'`;
}

function copyText(text, btn) {
  // Acknowledge FIRST, copy second -- same reason as the proof receipt's COPY:
  // writeText can sit pending instead of rejecting when the document is not
  // focused, and then nothing after `await` ever runs.
  const keep = btn.textContent;
  btn.textContent = 'COPIED';
  setTimeout(() => { btn.textContent = keep; }, 1400);
  try {
    const w = navigator.clipboard && navigator.clipboard.writeText(text);
    if (w && w.catch) w.catch(() => {});     // best effort, never awaited
  } catch (e) { /* no clipboard API; the text is on screen */ }
}

// A frozen snapshot cannot answer a query-string URL, but it DOES carry the
// identical response body as a file. Rather than hide the API affordance there
// (which removed the one feature the buyer actually consumes), the snapshot
// publishes its own route map and we show both: the live contract, and the
// file in this bundle that holds exactly that response.
function snapshotBlock(call) {
  const snap = window.__staticSnapshot;
  if (!snap || typeof snap.fileFor !== 'function') return null;
  const file = snap.fileFor(callUrl(call));
  if (!file) return null;
  const href = new URL(file, location.href).href;
  const curl = `curl -s '${href}'`;
  const copy = el('button', { type: 'button', class: 'copy api-copy' }, 'COPY CURL');
  copy.addEventListener('click', () => copyText(curl, copy));
  const copyUrl = el('button', { type: 'button', class: 'copy api-copy' }, 'COPY URL');
  copyUrl.addEventListener('click', () => copyText(href, copyUrl));
  return el('div', { class: 'api-snap' }, [
    el('div', { class: 'api-snap-h' }, 'IN THIS FROZEN SNAPSHOT'),
    el('div', { class: 'api-snap-n' },
      'This file carries the identical response body; this command returns it:'),
    el('code', { class: 'api-curl' }, curl),
    el('div', { class: 'api-actions' }, [copy, copyUrl]),
  ]);
}

function callBlock(call) {
  const rows = Object.entries(call.params).map(([k, val]) =>
    el('div', { class: 'api-param' }, [el('span', { class: 'api-k' }, k), el('span', { class: 'api-v' }, String(val))]));
  // In a frozen snapshot there is no API server behind this page, so a curl
  // against this host with a query string can only 404. Never offer a command
  // that cannot succeed: show the contract call as text, and make the copy
  // buttons copy the file in this bundle that holds the identical response.
  // 2026-10-26: a buyer copying the host-bearing form got a 404.
  const snap = snapshotBlock(call);
  if (snap) {
    return el('div', { class: 'api-call' }, [
      el('div', { class: 'api-line' }, [el('b', {}, call.method), ` ${call.path}`]),
      rows.length ? el('div', { class: 'api-params' }, rows) : null,
      el('div', { class: 'api-snap-n' },
        'Contract call of the live service. This page is a frozen snapshot with no '
        + 'API server behind it, so the command that actually returns this response '
        + 'here is the file below.'),
      snap,
    ]);
  }
  const curl = callCurl(call);
  const copyCurl = el('button', { type: 'button', class: 'copy api-copy' }, 'COPY CURL');
  copyCurl.addEventListener('click', () => copyText(curl, copyCurl));
  const copyUrl = el('button', { type: 'button', class: 'copy api-copy' }, 'COPY URL');
  copyUrl.addEventListener('click', () => copyText(callUrl(call), copyUrl));
  return el('div', { class: 'api-call' }, [
    el('div', { class: 'api-line' }, [el('b', {}, call.method), ` ${call.path}`]),
    rows.length ? el('div', { class: 'api-params' }, rows) : null,
    el('code', { class: 'api-curl' }, curl),
    el('div', { class: 'api-actions' }, [copyCurl, copyUrl]),
  ]);
}

// The popover is position:fixed (every .zone clips with overflow:hidden), so its
// coordinates are computed here from the button and clamped to the viewport:
// below the button by default, flipped above when it would run off the bottom.
const POP_GAP = 6;
const POP_MARGIN = 8;

function placePop(btn, pop) {
  const b = btn.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const maxLeft = window.innerWidth - w - POP_MARGIN;
  pop.style.left = `${Math.max(POP_MARGIN, Math.min(b.right - w, maxLeft))}px`;
  const below = b.bottom + POP_GAP;
  const fitsBelow = below + h <= window.innerHeight - POP_MARGIN;
  // Clamp after choosing a side. The button can itself be outside the viewport
  // (the receipt sits in the inspector's own scroller), and then neither side
  // is on-screen; the popover is pinned into view rather than hanging off it.
  const maxTop = window.innerHeight - h - POP_MARGIN;
  const want = fitsBelow ? below : b.top - h - POP_GAP;
  pop.style.top = `${Math.max(POP_MARGIN, Math.min(want, maxTop))}px`;
}

function closePop(btn, pop) {
  pop.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
}

function openPop(btn, pop) {
  // Measure after it is laid out but before it is seen, so it never flashes
  // at the wrong place; a fixed box carries no stale offsetParent.
  pop.style.visibility = 'hidden';
  pop.hidden = false;
  placePop(btn, pop);
  pop.style.visibility = '';
  btn.setAttribute('aria-expanded', 'true');
}

// A fixed popover does not travel with a scrolling panel, so it would drift away
// from its button. Closing is honest and cheap; re-opening re-measures.
['scroll', 'resize'].forEach((evt) => {
  window.addEventListener(evt, () => {
    document.querySelectorAll('.apipop:not([hidden])').forEach((p) => {
      const b = p.parentNode.querySelector('.apibtn');
      if (b) closePop(b, p);
    });
  }, true);
});

// Replace the API control inside `section` with one describing `calls` (one call or a list).
export function attachApi(section, calls) {
  if (!section) return;
  section.querySelectorAll(':scope > .apiwrap').forEach((n) => n.remove());
  const list = [].concat(calls).filter(Boolean);
  if (!list.length) return;
  // Recessive by design: a small glyph that shows on hover or focus (see .apiwrap in the stylesheet).
  const btn = el('button', { type: 'button', class: 'apibtn', 'aria-expanded': 'false', 'aria-label': '</> API', title: '</> API' }, '</>');
  const pop = el('div', { class: 'apipop' }, list.map(callBlock));
  pop.hidden = true;
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (pop.hidden) openPop(btn, pop); else closePop(btn, pop);
  });
  section.appendChild(el('div', { class: 'apiwrap' }, [btn, pop]));
}

document.addEventListener('click', (ev) => {
  document.querySelectorAll('.apipop').forEach((p) => {
    if (!p.hidden && !p.parentNode.contains(ev.target)) closePop(p.parentNode.querySelector('.apibtn'), p);
  });
});
