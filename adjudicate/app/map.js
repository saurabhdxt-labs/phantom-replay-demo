// Leaflet map: a dark land canvas plus ONE custom canvas layer that draws every cell of the hour.
// Canvas, not 2,400 SVG polygons: one draw pass, hit-testing by H3 lookup (O(1)), no DOM per cell.
// Cells whose true size is sub-pixel are drawn at a minimum screen radius so none can vanish.
import { TIER_STYLE, DET_STROKE, UNKNOWN_STROKE, tierKey } from './tiers.js';

const MIN_RADIUS = 5;       // px: floor so a res-7 cell is visible at world zoom
const HATCH_RADIUS = 7;     // px: above this, UNKNOWN cells also carry the diagonal hatch

function hatchPattern(ctx) {
  const t = document.createElement('canvas');
  t.width = 6; t.height = 6;
  const c = t.getContext('2d');
  c.strokeStyle = 'rgba(211,216,234,.75)';
  c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(-1, 7); c.lineTo(7, -1); c.stroke();
  return ctx.createPattern(t, 'repeat');
}

export class CellMap {
  constructor(node, captionNode, onPick) {
    this.node = node;
    this.caption = captionNode;
    this.onPick = onPick;
    this.map = null;
    this.cells = [];
    this.byH3 = new Map();
    this.geo = new Map();       // h3 -> { ring, center }; geometry is immutable per cell, so it is cached
    this.selected = null;       // { h3, determination }
    this.draw = { last: 0, count: 0, total: 0, max: 0 };
    this.raf = 0;
    this.ok = typeof window.L !== 'undefined' && typeof window.h3 !== 'undefined';
    if (this.ok) this._init();
    else this.caption.textContent = 'MAP UNAVAILABLE';
  }

  _init() {
    const L = window.L;
    this.map = L.map(this.node, {
      zoomControl: true, attributionControl: false, zoomSnap: 0.25, worldCopyJump: false,
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, minZoom: 2, maxZoom: 11,
    }).setView([30, 20], 3);
    // Public-domain world land (Natural Earth 110m): context only.
    fetch('/vendor/geo/ne_110m_land.geojson')
      .then((r) => (r.ok ? r.json() : null))
      .then((g) => {
        if (g) L.geoJSON(g, { interactive: false, style: { color: '#2b3447', weight: 1, fillColor: '#10151f', fillOpacity: 1 } })
          .addTo(this.map).bringToBack();
      })
      .catch(() => {});
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(this.map);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cell-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.map.getContainer().appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.hatch = hatchPattern(this.ctx);
    this.tip = document.createElement('div');
    this.tip.className = 'cell-tip mono';
    this.tip.hidden = true;
    this.map.getContainer().appendChild(this.tip);

    const sched = () => this._schedule();
    this.map.on('move zoom resize viewreset', sched);
    this.map.on('click', (ev) => this._click(ev));
    this.map.on('mousemove', (ev) => this._hover(ev));
    this.map.on('mouseout', () => { this.tip.hidden = true; });
    this.map.whenReady(() => this._resize());
    new ResizeObserver(() => { this.map.invalidateSize({ pan: false }); this._resize(); }).observe(this.node);

    // One way back to the whole hour, so a zoomed-in viewer can always recover context.
    this.fitBtn = document.createElement('button');
    this.fitBtn.type = 'button';
    this.fitBtn.className = 'mapfit';
    this.fitBtn.textContent = 'FIT HOUR';
    this.fitBtn.title = 'Frame every cell of this hour (F)';
    this.fitBtn.addEventListener('click', () => this.fitAll(true));
    this.node.parentNode.appendChild(this.fitBtn);
    // Zoomed into empty space is a state the viewer must be told about, not left to guess.
    this.emptyNote = document.createElement('div');
    this.emptyNote.className = 'mapempty mono';
    this.emptyNote.textContent = 'NO CELLS IN VIEW · FIT HOUR (F)';
    this.emptyNote.hidden = true;
    this.node.parentNode.appendChild(this.emptyNote);
  }

  _resize() {
    const s = this.map.getSize();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(s.x * dpr);
    this.canvas.height = Math.round(s.y * dpr);
    this.canvas.style.width = `${s.x}px`;
    this.canvas.style.height = `${s.y}px`;
    this.dpr = dpr;
    this._schedule();
  }

  _geometry(h3id) {
    let g = this.geo.get(h3id);
    if (!g) {
      g = { ring: window.h3.cellToBoundary(h3id), center: window.h3.cellToLatLng(h3id) };
      this.geo.set(h3id, g);
    }
    return g;
  }

  // Replace the drawn cells. `fit` frames the map on them.
  setCells(cells, fit) {
    if (!this.ok) return;
    this.cells = cells;
    this.byH3 = new Map(cells.map((c) => [c.h3, c]));
    if (fit) this.fitAll(false);
    this._schedule();
  }

  // Frame every cell of the hour. `animate` flies there so the relationship to where you were stays legible.
  fitAll(animate) {
    if (!this.ok || !this.cells.length) return;
    const pts = this.cells.map((c) => this._geometry(c.h3).center);
    const bounds = window.L.latLngBounds(pts);
    const opts = { padding: [40, 40], maxZoom: 7 };
    if (animate) this.map.flyToBounds(bounds, { ...opts, duration: 0.6 });
    else this.map.fitBounds(bounds, { ...opts, animate: false });
  }

  setSelected(h3id, determination) {
    this.selected = h3id ? { h3: h3id, determination } : null;
    this._schedule();
  }

  // Tie the map to a selection WITHOUT stranding the viewer. The zoom is the user's own: if the cell is
  // already on screen nothing moves. Only an off-screen cell moves the view, and then it flies to a frame that
  // holds the cell together with its nearest neighbours, never zooming in past the current scale.
  reveal(h3id) {
    if (!this.ok) return;
    const [lat, lng] = this._geometry(h3id).center;
    this.caption.textContent =
      `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lng).toFixed(3)}°${lng >= 0 ? 'E' : 'W'}  ·  H3 RES 7`;
    this.map.invalidateSize({ pan: false });
    const p = this.map.latLngToContainerPoint([lat, lng]);
    const s = this.map.getSize();
    const margin = 56;
    if (p.x > margin && p.y > margin && p.x < s.x - margin && p.y < s.y - margin) return;
    const near = this.cells
      .filter((c) => c.h3 !== h3id)
      .map((c) => {
        const q = this._geometry(c.h3).center;
        return { q, d: (q[0] - lat) ** 2 + (q[1] - lng) ** 2 };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, 12)
      .map((x) => x.q);
    const bounds = window.L.latLngBounds([[lat, lng], ...near]);
    const zoom = Math.min(this.map.getZoom(), this.map.getBoundsZoom(bounds, false, window.L.point(70, 70)));
    this.map.flyTo(bounds.getCenter(), zoom, { duration: 0.6 });
  }

  clearCaption() { this.caption.textContent = ''; }

  _schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this._paint(); });
  }

  _project(ring, center, minR) {
    const map = this.map;
    const cp = map.latLngToContainerPoint(center);
    const pts = ring.map((p) => map.latLngToContainerPoint(p));
    const r = Math.hypot(pts[0].x - cp.x, pts[0].y - cp.y);
    if (r >= minR) return { pts, r, cp };
    const k = minR / (r || 1);
    return { pts: pts.map((p) => ({ x: cp.x + (p.x - cp.x) * (r ? k : 1), y: cp.y + (p.y - cp.y) * (r ? k : 1) })), r: minR, cp };
  }

  _path(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  _paint() {
    if (!this.ok || !this.ctx) return;
    const t0 = performance.now();
    const ctx = this.ctx, s = this.map.getSize();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, s.x, s.y);
    const pad = 20;
    const unknown = [];
    let drawn = 0;
    const visible = (cp) => cp.x > -pad && cp.y > -pad && cp.x < s.x + pad && cp.y < s.y + pad;

    for (const c of this.cells) {
      const g = this._geometry(c.h3);
      const cp0 = this.map.latLngToContainerPoint(g.center);
      if (!visible(cp0)) continue;
      const key = tierKey(c);
      if (key === 'UNKNOWN') { unknown.push([c, g]); continue; }
      const { pts, r } = this._project(g.ring, g.center, MIN_RADIUS);
      this._path(ctx, pts);
      ctx.fillStyle = TIER_STYLE[key].fill;
      ctx.fill();
      const dc = DET_STROKE[c.determination];
      if (dc) {
        ctx.lineWidth = c.determination === 'DEGRADED' ? (r > 6 ? 2.4 : 1.6) : 1.6;
        ctx.strokeStyle = dc;
        ctx.stroke();
      }
      drawn += 1;
    }
    // UNKNOWN last, hollow: it can never hide a provable cell, and it is never absent.
    ctx.setLineDash([]);
    for (const [, g] of unknown) {
      const { pts, r } = this._project(g.ring, g.center, MIN_RADIUS);
      this._path(ctx, pts);
      if (r >= HATCH_RADIUS) {
        ctx.fillStyle = this.hatch;
        ctx.fill();
        ctx.setLineDash([4, 3]);
      }
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = UNKNOWN_STROKE;
      ctx.stroke();
      ctx.setLineDash([]);
      drawn += 1;
    }
    if (this.selected) {
      const g = this._geometry(this.selected.h3);
      const { pts, cp, r } = this._project(g.ring, g.center, 7);
      this._path(ctx, pts);
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(5,6,10,.85)';
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,.6)';
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, Math.max(24, r + 12), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.emptyNote) this.emptyNote.hidden = drawn > 0 || this.cells.length === 0;
    const ms = performance.now() - t0;
    const d = this.draw;
    d.last = ms; d.count += 1; d.total += ms; d.max = Math.max(d.max, ms);
    this.node.setAttribute('data-draw-ms', ms.toFixed(1));
    this.node.setAttribute('data-draw-avg-ms', (d.total / d.count).toFixed(2));
    this.node.setAttribute('data-draw-max-ms', d.max.toFixed(1));
    this.node.setAttribute('data-draws', String(d.count));
    this.node.setAttribute('data-cells-drawn', String(drawn));
  }

  _cellAt(latlng) {
    try {
      return this.byH3.get(window.h3.latLngToCell(latlng.lat, latlng.lng, 7)) || null;
    } catch (e) { return null; }
  }

  // The nearest cell within a few pixels, so a sub-pixel cell drawn at the minimum radius is still clickable.
  _pick(ev) {
    const direct = this._cellAt(ev.latlng);
    if (direct) return direct;
    const p = ev.containerPoint;
    const ring = [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5], [4, 4], [-4, -4], [4, -4], [-4, 4]];
    for (const [dx, dy] of ring) {
      const c = this._cellAt(this.map.containerPointToLatLng([p.x + dx, p.y + dy]));
      if (c) return c;
    }
    return null;
  }

  _click(ev) {
    const c = this._pick(ev);
    if (c && this.onPick) this.onPick(c);
  }

  _hover(ev) {
    const c = this._pick(ev);
    if (!c) { this.tip.hidden = true; this.node.style.cursor = ''; return; }
    this.node.style.cursor = 'pointer';
    const key = tierKey(c);
    this.tip.replaceChildren(
      document.createTextNode(`${c.h3}  ·  ${TIER_STYLE[key].word}  ·  ${c.determination}`),
      document.createElement('br'),
      document.createTextNode(key === 'UNKNOWN' ? 'no observation this hour' : `forecast p ${c.probability.toFixed(2)} (not evidence)`),
    );
    this.tip.style.left = `${ev.containerPoint.x + 14}px`;
    this.tip.style.top = `${ev.containerPoint.y + 14}px`;
    this.tip.hidden = false;
  }
}
