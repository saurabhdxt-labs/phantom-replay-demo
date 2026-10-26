// Naming the country a cell sits in, offline.
//
// The cell list showed raw h3 ids, then coordinates. Coordinates are honest
// but still ask the reader to know where 53.8°N 1.2°W is. This adds the
// country, from a public-domain gazetteer shipped inside the bundle.
//
// Data: Natural Earth 1:110m Admin 0 Countries, public domain, the same source
// and licence as the coastline the map already draws. Reduced here to name +
// ISO code and 0.01° coordinates (~1 km, finer than the 110m source is), which
// takes it from 819 KB to 168 KB.
//
// A cell over water gets NO country rather than the nearest one. At 1:110m a
// coastline is approximate, and "probably Poland" is the kind of unsourced
// claim the rest of this product refuses to make. The coordinates are always
// there; the country is an extra when it is unambiguous.

// The list column is 372px wide and a handful of names overflow it. Browser
// truncation ("Unite…") is worse than a standard abbreviation, so these are
// mapped explicitly rather than cut. Every one is an everyday short form, and
// the full name stays in the row's tooltip. Natural Earth already abbreviates
// most long names; measured at the real column width, only the entries here
// clipped.
export const SHORT_NAME = {
  'United Kingdom': 'UK',
  'United Arab Emirates': 'UAE',
  'United States of America': 'USA',
  'Dem. Rep. Congo': 'DR Congo',
  'Central African Rep.': 'Cent. Afr. Rep.',
  'Bosnia and Herz.': 'Bosnia & Herz.',
  'Trinidad and Tobago': 'Trinidad & Tob.',
  'Fr. S. Antarctic Lands': 'Fr. S. Antarctic',
  'North Macedonia': 'N. Macedonia',
  'Papua New Guinea': 'Papua N. Guinea',
};

export function displayName(name) {
  return SHORT_NAME[name] || name;
}

let INDEX = null;          // [{ n, i, bbox:[w,s,e,n], rings:[[ [x,y], ... ]] }]
let LOADING = null;

function ringsOf(geom) {
  // Outer rings only. Holes are enclaves at this scale and ignoring them can
  // only misname a handful of cells; carrying them would double the work for
  // a case the 110m data does not really resolve anyway.
  if (geom.type === 'Polygon') return [geom.coordinates[0]];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((p) => p[0]);
  return [];
}

function bboxOf(rings) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const r of rings) {
    for (const [x, y] of r) {
      if (x < w) w = x; if (x > e) e = x;
      if (y < s) s = y; if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

/** Ray casting on one ring. Points exactly on an edge may fall either way;
 *  at 1 km precision that is below the resolution of the question. */
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y)
        && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Load the gazetteer once. Resolves to false if it is unavailable, so the
 *  caller degrades to coordinates instead of failing. */
export function loadCountries(url = '/vendor/geo/ne_110m_countries_slim.geojson') {
  if (INDEX) return Promise.resolve(true);
  if (LOADING) return LOADING;
  LOADING = fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((gj) => {
      INDEX = gj.features.map((f) => {
        const rings = ringsOf(f.geometry);
        return { n: f.properties.n, i: f.properties.i, rings, bbox: bboxOf(rings) };
      });
      return true;
    })
    .catch(() => { INDEX = null; return false; });
  return LOADING;
}

export function countriesReady() {
  return INDEX !== null;
}

/** { name, iso } for a point, or null over water / before the data loads. */
export function countryAt(lat, lng) {
  if (!INDEX) return null;
  for (const c of INDEX) {
    const [w, s, e, n] = c.bbox;
    if (lng < w || lng > e || lat < s || lat > n) continue;   // cheap reject
    for (const ring of c.rings) {
      if (inRing(lng, lat, ring)) {
        return { name: c.n, short: displayName(c.n), iso: c.i };
      }
    }
  }
  return null;
}

// Test seam: lets the suite exercise the lookup in node with a known fixture
// instead of a browser fetch.
export function _setIndexForTest(features) {
  INDEX = features === null ? null : features.map((f) => {
    const rings = ringsOf(f.geometry);
    return { n: f.properties.n, i: f.properties.i, rings, bbox: bboxOf(rings) };
  });
}
