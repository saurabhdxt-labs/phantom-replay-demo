// Tiny DOM helpers. Text only: API strings are inserted as text nodes, never parsed.
const SVG_NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs)) {
    if (val === null || val === undefined) continue;
    if (k === 'class') n.className = val;
    else n.setAttribute(k, String(val));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

export function clear(node) { node.replaceChildren(); }

const ICONS = {
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  cross: ['M6 6l12 12', 'M18 6L6 18'],
  dash: ['M12 4a8 8 0 1 0 .01 0'],
  lock: ['M7 11V8a5 5 0 0 1 10 0v3', 'M5 11h14v9H5z'],
};

// kind: check | cross | dash | lock. Pure geometry; no API data reaches the SVG.
export function icon(kind, cls = 'ico') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[kind]) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2.4');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    if (kind === 'dash') p.setAttribute('stroke-dasharray', '3.2 3.2');
    svg.appendChild(p);
  }
  return svg;
}
