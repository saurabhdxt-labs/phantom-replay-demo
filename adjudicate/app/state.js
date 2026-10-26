// Minimal pub-sub state store. No framework.
export class State {
  constructor() {
    this.data = {
      hour: null,       // ISO hour currently on the map (hour-aligned, trailing Z)
      hourData: null,   // last 200 body from /api/adjudicate/hour, including out_of_record bodies
      selected: null,   // h3 of the clicked cell, or null (hour view)
      verdict: null,    // last 200 body from /api/adjudicate for the selected cell
      error: null,      // { code, message } from a 4xx/5xx/network failure, never a verdict
      loading: false,
      caseKey: null,
    };
    this.subs = new Map();
  }
  set(key, value) {
    this.data[key] = value;
    (this.subs.get(key) || []).forEach((fn) => {
      try { fn(value, this.data); } catch (e) { console.error('subscriber failed for', key, e); }
    });
  }
  get(key) { return this.data[key]; }
  on(key, fn) {
    if (!this.subs.has(key)) this.subs.set(key, new Set());
    this.subs.get(key).add(fn);
    return () => this.subs.get(key).delete(fn);
  }
}
