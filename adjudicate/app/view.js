// Rendering of one verdict body (FROZEN contract v1.0). Branches on `determination`.
// A null leg is NOT ASSESSED and is never rendered as satisfied.
import { el, clear, icon } from './dom.js';

const STAGES = ['adjudicability', 'record', 'proof', 'onset'];
const TIERS = ['NOT_ADJUDICABLE', 'WEAK', 'SUPPORTED', 'STRONG'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const LEGS = [
  { key: 'multi_aircraft', label: 'Multiple aircraft', sub: 'not one faulty receiver', yes: 'EXCLUDED' },
  { key: 'geomagnetic_quiet', label: 'Space weather', sub: 'quiet, not the cause', yes: 'EXCLUDED' },
  { key: 'onset_established', label: 'Onset', sub: 'started then, not already running', yes: 'ESTABLISHED' },
];

function hourLabel(v) {
  const a = v.query.window_start, b = v.query.window_end;
  const d = `${a.slice(8, 10)} ${MONTHS[Number(a.slice(5, 7)) - 1]} ${a.slice(0, 4)}`;
  return `${d} · ${a.slice(11, 16)}–${b.slice(11, 16)} UTC`;
}

// Whole minutes, FLOORED: the feed's own lead ("minutes_between"), the
// walkthrough and the feed spec all floor, and a reader comparing this panel
// with the API must see the same number (2026-10-26: 79.8 min read "1h 20m"
// here and "79 minutes" everywhere else).
function span(ms) {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export function renderHero(node, v) {
  clear(node);
  const det = el('div', { class: 'det' }, v.determination);
  const where = el('div', { class: 'where mono' }, [v.query.area, el('br'), hourLabel(v)]);
  const tierIdx = v.adjudicability_tier ? TIERS.indexOf(v.adjudicability_tier) : -1;
  const pips = el('span', { class: 'pips', 'aria-hidden': 'true' },
    TIERS.map((t, i) => el('i', { class: i <= tierIdx ? 'on' : '' })));
  const tier = el('div', { class: 'tier' }, [
    el('span', { class: 'k' }, 'EVIDENCE'), pips,
    el('span', { class: 'tv mono' }, v.adjudicability_tier ? v.adjudicability_tier.replace('_', ' ') : 'NOT ASSESSED'),
  ]);
  const kids = [det, where, tier];
  if (v.refusal) {
    kids.push(el('div', { class: 'declined' }, [
      icon('lock'),
      el('span', {}, `DECLINED AT ${v.refusal.stage.toUpperCase()}`),
    ]));
  }
  kids.forEach((k) => node.appendChild(k));
}

export function renderLegs(list, v) {
  clear(list);
  for (const leg of LEGS) {
    const value = v.legs[leg.key];
    let state, word, ico, note = null;
    if (value === true) { state = 'true'; word = leg.yes; ico = 'check'; }
    else if (value === false) { state = 'false'; word = 'NOT ESTABLISHED'; ico = 'cross'; }
    else { state = 'null'; word = 'NOT ASSESSED'; ico = 'dash'; note = 'not counted as satisfied'; }
    list.appendChild(el('li', { class: 'leg', 'data-state': state }, [
      icon(ico, 'ico leg-ico'),
      el('div', { class: 'leg-body' }, [
        el('div', { class: 'leg-name' }, [leg.label, el('span', { class: 'leg-sub' }, ` (${leg.sub})`)]),
        el('div', { class: 'leg-state' }, [el('b', {}, word), note ? el('em', {}, note) : null]),
      ]),
    ]));
  }
}

function nodeSub(stage, v, state) {
  if (state === 'unreached') return '';
  if (state === 'failed') return 'REASON BELOW';
  if (stage === 'adjudicability') return v.adjudicability_tier ? v.adjudicability_tier.replace('_', ' ') : 'NOT ASSESSED';
  if (stage === 'record') return v.proof ? `COMMIT ${v.proof.commit_sha.slice(0, 7)}` : 'COVERED';
  if (stage === 'proof') {
    if (!v.proof) return 'ANCHORED';
    return v.proof.pending ? 'STAMP PENDING' : `BLOCK ${v.proof.bitcoin_block}`;
  }
  // The sub-label states what the stage FOUND, not a second status. Reading
  // "PASSED / NOT ESTABLISHED" on one node looks self-contradictory: the stage
  // resolved (passed) and its finding was that no onset occurred in the window.
  if (!v.onset) return 'NOT ASSESSED';
  return v.onset.established === true ? 'ONSET CONFIRMED' : 'NO ONSET IN WINDOW';
}

export function renderChain(list, v) {
  clear(list);
  const failAt = v.refusal ? STAGES.indexOf(v.refusal.stage) : -1;
  STAGES.forEach((stage, i) => {
    const state = failAt < 0 || i < failAt ? 'passed' : i === failAt ? 'failed' : 'unreached';
    const word = state === 'passed' ? 'PASSED' : state === 'failed' ? 'FAILED' : 'NOT REACHED';
    if (i > 0) {
      const link = failAt < 0 || i < failAt ? 'ok' : i === failAt ? 'broken' : 'idle';
      list.appendChild(el('li', { class: 'link', 'data-link': link, 'aria-hidden': 'true' }));
    }
    list.appendChild(el('li', { class: 'node', 'data-state': state }, [
      el('div', { class: 'disc' }, [icon(state === 'passed' ? 'check' : state === 'failed' ? 'cross' : 'dash', 'ico')]),
      el('div', { class: 'node-name' }, stage.toUpperCase()),
      el('div', { class: 'node-word' }, word),
      el('div', { class: 'node-sub mono' }, nodeSub(stage, v, state)),
    ]));
  });
  // The refusal's own words, at full width under the broken chain rather than squeezed into one stage.
  if (v.refusal) list.appendChild(el('li', { class: 'chain-note mono' }, v.refusal.detail));
}

export function renderReceipt(node, v) {
  clear(node);
  node.appendChild(el('h2', {}, 'PROOF RECEIPT'));
  const p = v.proof;
  if (!p) {
    node.setAttribute('data-empty', '1');
    node.appendChild(el('div', { class: 'bignum none' }, 'NO RECEIPT'));
    node.appendChild(el('div', { class: 'rline mono' }, v.refusal ? `refused at ${v.refusal.stage}` : '—'));
    return;
  }
  node.removeAttribute('data-empty');
  node.appendChild(el('div', { class: p.pending ? 'bignum pending' : 'bignum' },
    p.pending ? 'STAMP PENDING' : `BLOCK ${p.bitcoin_block}`));
  // Say in words that a pending stamp is the normal state of a recent commit.
  // Without this the reader is left to guess, and "PENDING" reads as "failed".
  if (p.pending) {
    node.appendChild(el('div', { class: 'pendnote' },
      'The timestamp proof is lodged and the commit hash is already fixed; '
      + 'the Bitcoin block that will carry it has not been mined yet. This is '
      + 'the normal state for a recent commit, not a fault.'));
  }
  const lead = Date.parse(v.query.window_start) - Date.parse(p.committed_at);
  node.appendChild(el('div', { class: 'rline mono' }, `COMMITTED ${p.committed_at.replace('T', ' ').replace('Z', ' UTC')}`));
  node.appendChild(el('div', { class: lead > 0 ? 'precedes yes' : 'precedes no' }, [
    icon(lead > 0 ? 'check' : 'cross'),
    el('span', {}, lead > 0 ? `COMMIT PRECEDES THE HOUR BY ${span(lead)}` : 'COMMIT DOES NOT PRECEDE THE HOUR'),
  ]));
  const cmd = el('code', { class: 'cmd mono', id: 'verify-cmd' }, p.verify_command);
  const btn = el('button', { type: 'button', class: 'copy', id: 'copy-btn' }, 'COPY');
  // The acknowledgement is in a `finally`, because it is the only thing the
  // reader can see. Previously it sat after the catch, so when the clipboard
  // was blocked AND the selection fallback threw, the handler died silently
  // and the button never changed -- click COPY, nothing happens. Observed in
  // a browser where writeText rejects with NotAllowedError.
  // Acknowledge FIRST, copy second. navigator.clipboard.writeText does not
  // always settle -- when the document is not focused it can sit pending
  // rather than reject -- so anything after `await` may never run. Measured:
  // the click handler fired, no error, no rejection, and the label still said
  // COPY. The label is the only feedback the reader gets, so it cannot be
  // downstream of a promise that might never resolve.
  btn.addEventListener('click', () => {
    btn.textContent = 'COPIED';
    setTimeout(() => { btn.textContent = 'COPY'; }, 1500);
    try {                         // select it so the reader can copy by hand
      const r = document.createRange(); r.selectNodeContents(cmd);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
    } catch (e) { /* selection unavailable; the command is still on screen */ }
    try {
      const w = navigator.clipboard && navigator.clipboard.writeText(p.verify_command);
      if (w && w.catch) w.catch(() => {});   // best effort, never awaited
    } catch (e) { /* no clipboard API at all */ }
  });
  node.appendChild(el('div', { class: 'cmdrow' }, [cmd, btn]));
}

export function renderLimits(list, limits) {
  clear(list);
  for (const s of limits) list.appendChild(el('li', {}, s));
}

export function renderAll(nodes, v) {
  nodes.stage.setAttribute('data-det', v.determination);
  renderHero(nodes.hero, v);
  renderLegs(nodes.legs, v);
  renderChain(nodes.chain, v);
  renderReceipt(nodes.receipt, v);
  renderLimits(nodes.limits, v.limits);
}

export function renderError(nodes, err) {
  nodes.stage.setAttribute('data-det', 'error');
  clear(nodes.hero);
  nodes.hero.appendChild(el('div', { class: 'det' }, 'NO ANSWER'));
  nodes.hero.appendChild(el('div', { class: 'where mono' }, `${err.code}: ${err.message}`));
  [nodes.legs, nodes.chain, nodes.receipt, nodes.limits].forEach(clear);
}

export function renderLoading(nodes) {
  nodes.stage.setAttribute('data-det', 'loading');
}
