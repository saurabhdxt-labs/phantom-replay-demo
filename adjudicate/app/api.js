// Typed fetch wrappers for /api/adjudicate (v1.0 verdict) and the v1.1 additions
// /api/adjudicate/hour and /api/adjudicate/coverage.
// A REFUSED determination and an out-of-record hour are HTTP 200 and returned as ordinary data.
// Only malformed input (4xx), an unavailable archive (503) or a server fault (5xx) yields { ok: false }.
// Every result carries `call` ({ method, path, params }): the exact request, so the console can
// show the embeddable call that produced each panel.
export class Api {
  constructor(base = '') {
    this.base = base;
  }

  async _get(path, params) {
    const call = { method: 'GET', path, params };
    const qs = Object.entries(params)
      .map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join('&');
    const t0 = performance.now();
    let resp;
    try {
      resp = await fetch(`${this.base}${path}${qs ? `?${qs}` : ''}`, { credentials: 'omit' });
    } catch (e) {
      return { ok: false, status: 0, call, ms: 0,
        error: { code: 'network', message: 'Could not reach the server' } };
    }
    let body = null;
    try { body = await resp.json(); } catch (e) { body = null; }
    const ms = Math.round(performance.now() - t0);
    if (resp.ok) return { ok: true, status: resp.status, body, call, ms };
    const err = body && body.error ? body.error : { code: 'http_error', message: `HTTP ${resp.status}` };
    return { ok: false, status: resp.status, call, ms, error: { code: err.code, message: err.message } };
  }

  async getVerdict(area, hour) {
    const r = await this._get('/api/adjudicate', { area, hour });
    return r.ok ? { ok: true, verdict: r.body, call: r.call, ms: r.ms } : r;
  }

  async getHour(hour, horizon = null, minProbability = null) {
    const params = { hour };
    if (horizon !== null) params.horizon = horizon;
    if (minProbability !== null) params.min_probability = minProbability;
    const r = await this._get('/api/adjudicate/hour', params);
    return r.ok ? { ok: true, data: r.body, call: r.call, ms: r.ms } : r;
  }

  // v1.2: per-hour counts for the time ribbon. Counts only -- no cell ids.
  async getRibbon(end = null, hours = null) {
    const params = {};
    if (end !== null) params.end = end;
    if (hours !== null) params.hours = hours;
    const r = await this._get('/api/adjudicate/ribbon', params);
    return r.ok ? { ok: true, data: r.body, call: r.call, ms: r.ms } : r;
  }

  async getCoverage() {
    const r = await this._get('/api/adjudicate/coverage', {});
    return r.ok ? { ok: true, data: r.body, call: r.call, ms: r.ms } : r;
  }

  async getVerification() {
    const r = await this._get('/api/adjudicate/verification', {});
    return r.ok ? r.body : null;
  }
}
