// Pure hour arithmetic for the adjudication console. No DOM, no network: every
// function here is deterministic given `now`, so each is testable in isolation.
//
// The one fact that makes this module necessary: the committed record runs AHEAD
// of the clock. A forecast is committed before the hour it covers, so
// /api/adjudicate/hour answers "in record" for hours that have not happened yet.
// Measured 2026-10-21T00:52Z: 01:00Z and 02:00Z were in record with 607 and 545
// cells and 0 adjudicable -- nothing had been observed in them. Treating such an
// hour as "the latest record" puts an empty screen in front of the reader that
// is indistinguishable from "we looked and saw nothing".
export const HOUR_MS = 3600000;

// The UTC hour `ms` falls in, as the API's hour key.
export function iso(ms) {
  return `${new Date(ms).toISOString().slice(0, 13)}:00:00Z`;
}

export function shift(hour, hours) {
  return iso(Date.parse(hour) + hours * HOUR_MS);
}

// The newest hour that has FULLY elapsed. The hour in progress is excluded: its
// aggregation is still being written, so it under-reports by construction.
export function lastCompleteHour(now = Date.now()) {
  return iso(now - HOUR_MS);
}

// True when `hour` has not finished yet -- reachable by deep link or the jump
// box even once LATEST can no longer reach it.
//
// Throws on anything unparseable rather than coercing. `Date.parse` returns NaN
// for junk, and `NaN > now` is false, so the old version reported a malformed
// hour as ALREADY ELAPSED -- the dangerous direction, because "elapsed" is what
// lets a bin render as an ordinary observed hour. Every caller receives hours
// from the API contract, so a bad value here is a contract break and should be
// loud (code-design rule 5: fail loud at boundaries, no silent coercion).
export function hourNotElapsed(hour, now = Date.now()) {
  const t = Date.parse(hour);
  if (!Number.isFinite(t)) {
    throw new TypeError(`hourNotElapsed: not a parseable hour: ${String(hour)}`);
  }
  return t + HOUR_MS > now;
}

// The hours a "newest hour in the record" search may probe, newest first.
//
// Every returned hour has FULLY elapsed, so a search over this list can never
// return an hour that has not happened. The list is contiguous -- no hour is
// skipped -- so a caller walking it never returns an hour it did not probe.
//
// Why not a binary search: it assumes the predicate is monotone (every hour up
// to the newest is in the record). A missing hour is a recurring incident in
// this project -- midnight hour-loss, thin hour-00, the orphaned hour -- and
// under a hole the search returns an hour it never tested. Walking costs one
// probe in the normal case, because the newest candidate is almost always in
// the record.
//
// `baseMs` is midnight of the record's last day. The scan starts at whichever
// is older: the record's reach (base + span) or the last complete hour. That
// keeps it correct both when the record runs AHEAD of the clock (the usual
// case: forecasts are committed before their hour) and when it LAGS.
export function latestHourCandidates(baseMs, nowMs = Date.now(), span = 26) {
  const cap = Date.parse(lastCompleteHour(nowMs));
  const start = Math.min(baseMs + span * HOUR_MS, cap);
  const floor = baseMs - span * HOUR_MS;
  const out = [];
  for (let t = start; t >= floor; t -= HOUR_MS) out.push(iso(t));
  return out;
}

// Which hour the time ribbon's window should END at, for a window `span` hours
// long showing `hour`.
//
// The window ends at the last complete hour, and only follows `hour` when that
// hour has fallen off the back of the window. The first version moved the end
// to `hour` whenever it was older than the cap, which looked right until the
// exported bundle landed on its richest hour in the MIDDLE of the window: the
// ribbon then asked for 48 hours ending there, got the 28 that existed before
// it, and hid the two most recent days. Seen on the 2026-10-21 bundle as
// "LAST 28H".
export function ribbonEndFor(hour, now = Date.now(), span = 48) {
  const cap = lastCompleteHour(now);
  if (!hour) return cap;
  const capMs = Date.parse(cap);
  const t = Date.parse(hour);
  if (!Number.isFinite(t)) return cap;
  // inside the window (including its oldest bin) -> keep the window put
  if (t > capMs - span * HOUR_MS && t <= capMs) return cap;
  // in the future -> the cap is still the newest thing we can show
  if (t > capMs) return cap;
  return hour;
}
