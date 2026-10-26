// Turning a cell id into something a person can place on a map.
//
// The cell list used to be a column of `871e15015ffffff`, which tells a reader
// nothing: they cannot tell one row from the next, or north from south. The id
// still matters -- it is the API key, and it is what you curl -- so it stays,
// demoted to a tooltip and to the inspector header.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// A first version of this file also named the operating area a cell fell in,
// ported from the forecaster's own bounding boxes. The console's
// forbidden-token guard rejected it, correctly: those boxes are the model's
// geometry, they are withheld from this public surface on purpose, and the
// area names are on the same list. Naming them here would have published the
// method's shape to a prospective buyer. Coordinates carry no such
// problem -- they are a pure function of the h3 id the API already returns, so
// anyone holding a verdict can compute them already.
//
// The country comes from a public-domain gazetteer shipped in the bundle (see
// countries.js). A cell over water gets no country, not the nearest one:
// measured on a real hour, 96% of 2,370 cells resolved, and the rest are at
// sea or on a coastline the 110m source does not resolve. Coordinates are
// always shown, so a blank country costs the reader nothing.
//
// Everything here is offline: `h3-js` is already vendored for the map.
import { countryAt } from './countries.js';

/** "54.31°N 19.84°E". Two decimals is ~1.1 km. A res-7 cell is ~2.8 km across,
 *  so one decimal (~11 km) collapsed neighbouring cells onto the same row and
 *  the list read as duplicates. Two keeps adjacent cells distinguishable. */
export function formatLatLng(lat, lng) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lng).toFixed(2)}°${ew}`;
}

/** Rough latitude band. NOT shown in the cell list: within one hour nearly
 *  every row lands in the same band, so it cost a column and told the reader
 *  nothing the coordinates do not. Kept because it is tested and cheap, for a
 *  future grouped view where it would actually separate rows. */
export function bandOf(lat) {
  const a = Math.abs(lat);
  if (a >= 66.5) return lat > 0 ? 'ARCTIC' : 'ANTARCTIC';
  if (a >= 55) return lat > 0 ? 'N HIGH' : 'S HIGH';
  if (a >= 35) return lat > 0 ? 'N MID' : 'S MID';
  if (a >= 23.5) return lat > 0 ? 'N SUBTROP' : 'S SUBTROP';
  return 'TROPICAL';
}

/**
 * Where a cell is, for display. Returns null when h3 is unavailable rather
 * than inventing a position — the caller then shows the id as before.
 */
export function cellPlace(h3id) {
  if (typeof window === 'undefined' || !window.h3) return null;
  let lat, lng;
  try {
    [lat, lng] = window.h3.cellToLatLng(h3id);
  } catch (e) {
    return null;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const c = countryAt(lat, lng);
  return {
    lat, lng,
    coords: formatLatLng(lat, lng),
    band: bandOf(lat),
    country: c ? c.name : null,
    countryShort: c ? c.short : null,
    iso: c ? c.iso : null,
  };
}
