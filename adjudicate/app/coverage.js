// Coverage bars drawn from /api/adjudicate/coverage (contract v1.1). Nothing here is hard-coded:
// every figure, gap and day count is derived from the payload. `attested: null` is "not measured".
import { el, clear } from './dom.js';

const DAY = 86400000;
const day = (s) => Date.parse(`${s}T00:00:00Z`);
const span = (a, b) => Math.round((day(b) - day(a)) / DAY) + 1;
const md = (s) => s.slice(5);
const num = (n) => (n === null || n === undefined ? 'NOT MEASURED' : Number(n).toLocaleString('en-US'));

function bar(axis, series, label, summary) {
  const total = span(axis.from, axis.to);
  const pct = (a, b) => `${(((day(a) - day(axis.from)) / DAY) / total) * 100}%`;
  const width = (a, b) => `${(span(a, b) / total) * 100}%`;
  const track = el('div', { class: 'cov-track', role: 'img', 'aria-label': `${label}: ${summary}` });
  if (series.first_day) {
    const cap = el('div', { class: 'cov-fill' });
    cap.style.left = pct(series.first_day);
    cap.style.width = width(series.first_day, series.last_day);
    track.appendChild(cap);
    for (const g of series.gaps) {
      const seg = el('div', { class: 'cov-gap', title: `${g.from}..${g.to} (${g.days}d)` });
      seg.style.left = pct(g.from);
      seg.style.width = width(g.from, g.to);
      track.appendChild(seg);
    }
  }
  const gaps = series.gaps.length
    ? series.gaps.map((g) => `${md(g.from)}..${md(g.to)} ${g.days}d`).join(' · ')
    : 'NO MISSING DAYS';
  return el('div', { class: 'cov-row' }, [
    el('span', { class: 'cov-k' }, label),
    track,
    el('span', { class: 'cov-v mono' }, summary),
    el('span', { class: series.gaps.length ? 'cov-gaps mono' : 'cov-gaps none mono' }, gaps),
  ]);
}

export function renderCoverage(node, cov) {
  clear(node);
  const { record, onset, proofs } = cov;
  const starts = [record.first_day, onset.first_day].filter(Boolean).sort();
  const ends = [record.last_day, onset.last_day].filter(Boolean).sort();
  if (!starts.length) {
    node.appendChild(el('span', { class: 'cov-v mono' }, 'NO RECORD DAYS ON THIS SERVER'));
    return;
  }
  const axis = { from: starts[0], to: ends[ends.length - 1] };
  const detail = el('div', { class: 'cov-detail', hidden: '' });
  detail.hidden = true;
  detail.appendChild(bar(axis, record, 'RECORD',
    `${record.n_days} days · ${record.first_day}..${record.last_day}`));
  const onsetSpan = onset.first_day ? span(onset.first_day, onset.last_day) : 0;
  const lost = onset.gaps.reduce((n, g) => n + g.days, 0);
  detail.appendChild(bar(axis, onset, 'ONSET',
    `${onset.n_days} capable days · ${lost} of ${onsetSpan} days not adjudicable`));
  const attested = proofs.attested === null
    ? `ATTESTED NOT MEASURED${proofs.attested_unavailable_reason ? ` (${proofs.attested_unavailable_reason})` : ''}`
    : `ATTESTED ${num(proofs.attested)} · PENDING ${num(proofs.pending)}`;
  detail.appendChild(el('div', { class: 'cov-proofs mono' },
    `PROOFS per-commit ${num(proofs.per_commit)} · daily-head ${num(proofs.daily_head)} · ${attested}`));
  detail.appendChild(el('div', { class: 'cov-method mono' },
    proofs.attestation_method ? `METHOD: ${proofs.attestation_method}` : 'METHOD: NOT STATED'));

  // One calm line; the day-by-day gaps and the method live behind DETAIL (and in the hover title).
  const gapList = record.gaps.map((g) => `${g.from}..${g.to} (${g.days}d)`).join('\n');
  // Day-level: a day is in the record once it holds a committed forecast. Hour
  // completeness is a different measure (record.hours) and is stated beside it,
  // so 'no gaps' never reads as 'every hour present'.
  const gapWord = record.gaps.length ? `${record.gaps.length} missing days` : 'no missing days';
  const h = record.hours;
  const hourWord = h ? `HOURS ${h.present.toLocaleString()} of ${h.expected.toLocaleString()}`
                     + (h.missing ? ` · ${h.missing} absent` : '') : null;
  const line = el('div', { class: 'cov-line mono' }, [
    el('span', { title: gapList || 'no missing calendar days in the record' }, `RECORD ${record.n_days} days · ${gapWord}`),
    hourWord ? el('span', { title: 'owed hours present; an hour counts as absent only after it has closed and settled' }, hourWord) : null,
    el('span', {}, `ONSET ${onset.n_days} capable days`),
    el('span', {}, `PROOFS ${num(proofs.per_commit)} per-commit · ${num(proofs.daily_head)} daily-head`),
    el('span', {}, attested),
  ]);
  const toggle = el('button', { type: 'button', class: 'cov-toggle', 'aria-expanded': 'false' }, 'DETAIL');
  toggle.addEventListener('click', (ev) => {
    ev.stopPropagation();
    detail.hidden = !detail.hidden;
    toggle.setAttribute('aria-expanded', detail.hidden ? 'false' : 'true');
  });
  node.appendChild(line);
  node.appendChild(toggle);
  node.appendChild(detail);
}

export function renderCoverageError(node, err) {
  clear(node);
  node.appendChild(el('span', { class: 'cov-v mono' }, `COVERAGE UNAVAILABLE · ${err.code}`));
}
