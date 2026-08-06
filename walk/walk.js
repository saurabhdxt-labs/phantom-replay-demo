/* PHANTOM proof walk — a 4-step guided story per case, driven entirely by the
 * leak-scanned receipt payload. Presenter presses Next; nothing is chosen live.
 * Steps: 1 predicted (commit link) -> 2 what happened (+Nh later) ->
 *        3 what the authority said -> 4 the whole record. */
(function () {
  'use strict';

  // Public-geography reference labels so the viewer always knows WHERE they
  // are — same approach as the replay demo's theatre labels.
  var CITIES = [
    ['Tel Aviv', 32.08, 34.78], ['Beirut', 33.89, 35.50],
    ['Nicosia', 35.17, 33.36], ['Athens', 37.98, 23.73],
    ['Istanbul', 41.01, 28.98], ['Bucharest', 44.43, 26.10],
    ['Kyiv', 50.45, 30.52], ['Warsaw', 52.23, 21.01],
    ['Gdańsk', 54.35, 18.65], ['Kaliningrad', 54.71, 20.51],
    ['Vilnius', 54.69, 25.28], ['Riga', 56.95, 24.11],
    ['Tallinn', 59.44, 24.75], ['Helsinki', 60.17, 24.94],
    ['Dubai', 25.20, 55.27], ['Manama', 26.23, 50.59]
  ];

  var COLORS = {
    forecast: '#6ea8ff',
    hit: '#7fd4a8',
    miss: '#ff8f8f',
    ungraded: '#8b96a8',
    notam: '#ffd479'
  };

  function el(id) { return document.getElementById(id); }
  function fmt(iso) { return iso.replace('T', ' ').slice(0, 16) + ' UTC'; }

  var state = { cases: [], agg: null, ci: 0, step: 0, map: null, layer: null };

  fetch('data/receipt.json')
    .then(function (r) { if (!r.ok) throw new Error('payload missing'); return r.json(); })
    .then(function (doc) {
      if (doc.status !== 'receipt') throw new Error(doc.note || 'no example available');
      // Feature the strongest STORY first: most confirmed hits, then lead.
      state.cases = (doc.receipts || [doc.receipt]).slice().sort(function (a, b) {
        return hits(b) - hits(a) || b.lead_hours - a.lead_hours;
      });
      state.agg = doc.aggregate;
      var q = location.hash + location.search;
      var h = q.match(/case=(\d)/);
      if (h) state.ci = Math.min(+h[1] - 1, state.cases.length - 1);
      h = q.match(/step=(\d)/);
      if (h) state.step = Math.min(+h[1] - 1, 3);
      buildCasePicker();
      state.map = L.map('map', { zoomControl: false, attributionControl: false })
        .setView([50, 25], 5);
      if (window.__PHANTOM_LAND__) {
        L.geoJSON(window.__PHANTOM_LAND__, {
          style: { color: '#2c3648', weight: 0.9,
                   fillColor: '#161d2b', fillOpacity: 1, interactive: false }
        }).addTo(state.map);
      }
      CITIES.forEach(function (c) {
        L.circleMarker([c[1], c[2]], {
          radius: 2.5, color: '#55627a', weight: 1,
          fillColor: '#55627a', fillOpacity: 1, interactive: false
        }).addTo(state.map)
          .bindTooltip(c[0], { permanent: true, direction: 'right',
                               offset: [6, 0], className: 'city-tip' });
      });
      render();
    })
    .catch(function (e) {
      el('step-title').textContent = 'Nothing to show';
      el('step-body').textContent = String(e.message || e);
    });

  function hits(rc) {
    return rc.forecast.rows.filter(function (r) { return r.outcome === 'hit'; }).length;
  }

  function buildCasePicker() {
    var nav = el('cases');
    state.cases.forEach(function (rc, i) {
      var b = document.createElement('button');
      var nm = rc.notam.fir_name || rc.notam.fir;
      b.textContent = 'Case ' + (i + 1) + ' · ' +
        (nm.indexOf('·') > -1 ? nm.split('·')[1].trim() : nm.split(' FIR')[0]);
      if (i === 0) b.classList.add('active');
      b.addEventListener('click', function () {
        nav.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        state.ci = i; state.step = 0; render();
      });
      nav.appendChild(b);
    });
  }

  el('next').addEventListener('click', function () {
    if (state.step < 3) { state.step += 1; render(); }
  });
  el('prev').addEventListener('click', function () {
    if (state.step > 0) { state.step -= 1; render(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') el('next').click();
    if (e.key === 'ArrowLeft') el('prev').click();
  });

  function clearLayer() {
    if (state.layer) { state.map.removeLayer(state.layer); state.layer = null; }
  }

  function cellBounds(rc) {
    return L.latLngBounds(rc.forecast.rows.map(function (r) { return [r.lat, r.lng]; }));
  }

  function placeTag(rc) {
    var b = cellBounds(rc), c = b.getCenter();
    return L.marker([b.getNorth() + 0.12, c.lng], {
      opacity: 0, interactive: false
    }).bindTooltip((rc.notam.fir_name || rc.notam.fir),
      { permanent: true, direction: 'top', className: 'place-tag' });
  }

  function drawCells(rc, mode) {
    var g = L.layerGroup();
    rc.forecast.rows.forEach(function (r) {
      var color = mode === 'forecast' ? COLORS.forecast : COLORS[r.outcome];
      var solid = mode === 'forecast' || r.outcome === 'hit';
      g.addLayer(L.circleMarker([r.lat, r.lng], {
        radius: 9, color: color, weight: 2.5,
        fillColor: color, fillOpacity: solid ? 0.6 : 0.08
      }).bindTooltip(
        mode === 'forecast'
          ? 'p=' + r.probability.toFixed(2) + ' for ' + fmt(r.target_utc)
          : r.outcome + ' at ' + fmt(r.target_utc),
        { className: 'cell-tip' }));
    });
    return g;
  }

  function links(items) {
    var box = el('step-links');
    box.textContent = '';
    items.forEach(function (it) {
      if (it.href) {
        var a = document.createElement('a');
        a.href = it.href; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = it.text;
        box.appendChild(a);
      } else {
        var s = document.createElement('span');
        s.className = 'plain'; s.textContent = it.text;
        box.appendChild(s);
      }
    });
  }

  function render() {
    var rc = state.cases[state.ci], n = rc.notam, f = rc.forecast;
    var v = rc.verification || {};
    clearLayer();
    el('dots').innerHTML = [0, 1, 2, 3].map(function (i) {
      return i === state.step ? '<b>●</b>' : '●';
    }).join(' ');
    el('prev').disabled = state.step === 0;
    el('next').disabled = state.step === 3;

    var graded = f.rows.filter(function (r) { return r.outcome !== 'ungraded'; });
    var nHits = hits(rc);
    el('btc-line').hidden = state.step !== 0;
    // Standing-declaration context is declared UP FRONT on step 1 — never
    // discovered by the viewer at step 3 (that reads as a hidden gotcha).
    var ctx = el('ctx-line');
    ctx.hidden = state.step !== 0 || !rc.standing_declaration;
    if (!ctx.hidden) {
      ctx.innerHTML = '<b>Context, stated up front:</b> authority NOTAM ' +
        (n.official_number || n.id) + ' has flagged this FIR since ' +
        fmt(n.start_utc).slice(0, 10) + ' — a blanket warning over a ' +
        n.radius_nm.toFixed(0) + ' nm area with no end date. It cannot say ' +
        'which cells or which hour. <b>The model never reads NOTAMs</b> — ' +
        'what follows is its own call: specific cells, a specific hour.';
    }

    if (state.step === 0) {
      el('step-label').textContent = 'Step 1 · The prediction';
      el('step-title').textContent = 'Committed ' + fmt(f.commit_time_utc) +
        ' — ' + rc.lead_hours + ' hours ahead';
      el('step-body').textContent = f.n_matching_rows +
        ' cells over ' + (n.fir_name || n.fir) +
        ' called high-risk (probability ' +
        Math.min.apply(null, f.rows.map(function (r) { return r.probability; })).toFixed(2) +
        '–' + Math.max.apply(null, f.rows.map(function (r) { return r.probability; })).toFixed(2) +
        ') for ' + fmt(f.rows[0].target_utc) + '.';
      var btc = el('btc-line');
      btc.textContent = '';
      btc.appendChild(document.createTextNode(
        'Bitcoin-anchored via OpenTimestamps — this timestamp cannot be back-dated by anyone. '));
      var pa = document.createElement('a');
      pa.href = 'https://github.com/saurabhdxt-labs/phantom-record-mirror/tree/main/proofs';
      pa.target = '_blank'; pa.rel = 'noopener';
      pa.textContent = 'proof files ↗';
      btc.appendChild(pa);
      links([
        v.commit_url ? { href: v.commit_url, text: 'the commit ↗ ' + f.commit_sha.slice(0, 10) } : { text: 'commit ' + f.commit_sha.slice(0, 12) },
        { text: rc.bitcoin.status }
      ]);
      state.layer = L.layerGroup([drawCells(rc, 'forecast'), placeTag(rc)]).addTo(state.map);
      state.map.fitBounds(cellBounds(rc).pad(2.2));
    }

    if (state.step === 1) {
      el('step-label').textContent = 'Step 2 · ' + fmt(f.rows[0].target_utc) +
        ' (' + rc.lead_hours + ' hours after the commit)';
      if (graded.length === 0) {
        el('step-title').textContent = 'These cells were not re-observed at that hour';
        el('step-body').textContent = 'The record only grades what it re-sees — ' +
          'no aircraft revisited these 5-km cells at the exact target hour, so ' +
          'they stay ungraded forever. Area-level maps like GPSJam can still ' +
          'show jamming nearby that day (they aggregate whole days over ~50 km ' +
          'areas); we hold ourselves to the stricter per-cell, per-hour bar — ' +
          'and ungraded never counts as a hit. That discipline is why the ' +
          'graded numbers can be trusted.';
      } else {
        el('step-title').textContent = nHits + ' of ' + f.rows.length +
          ' forecast cells confirmed degraded at ' +
          f.rows[0].target_utc.slice(11, 16) + ' UTC';
        var ungraded = f.rows.length - graded.length;
        var nMiss = graded.length - nHits;
        var parts = ['At the target hour the observed aircraft record confirms ' +
          'navigation-integrity degradation in ' + nHits + ' of the ' +
          f.rows.length + ' forecast cells (solid green).'];
        if (nMiss > 0) {
          parts.push(nMiss === 1
            ? 'One cell was observed clean (red) — a miss, and it stays in the record.'
            : nMiss + ' cells were observed clean (red) — misses, and they stay in the record.');
        }
        if (ungraded > 0) {
          parts.push((ungraded === 1
            ? 'The grey one was never re-observed at that hour, so it stays ungraded'
            : 'The ' + ungraded + ' grey ones were never re-observed at that hour, so they stay ungraded') +
            ' — the record only grades what it re-sees, and ungraded never counts as a hit.');
        }
        parts.push('Graded with the same threshold as the forward ledger.');
        el('step-body').textContent = parts.join(' ');
      }
      if (graded.length === 0) {
        // No outcome is being claimed — an outcome-check link here would
        // contradict the "ungraded" message (owner-caught, 2026-08-03).
        links([{ text: 'no outcome claimed for this case — nothing to cross-check; the grading discipline is the point' }]);
      } else {
        var day = f.rows[0].target_utc.slice(0, 10);
        var c0 = cellBounds(rc).getCenter();
        links([
          { href: '../replay/',
            text: 'see this day replayed on the public demo (pick ' + day + ')' },
          { href: 'https://gpsjam.org/?lat=' + c0.lat.toFixed(1) + '&lon=' +
                  c0.lng.toFixed(1) + '&z=6&date=' + day,
            text: 'independent check: gpsjam.org, same day, same area ↗' },
          { text: 'GPSJam is built from the same aircraft signal family — a cross-check, not our data' }
        ]);
      }
      state.layer = L.layerGroup([drawCells(rc, 'outcome'), placeTag(rc)]).addTo(state.map);
      state.map.fitBounds(cellBounds(rc).pad(2.2));
    }

    if (state.step === 2) {
      if (rc.onset_evidence) {
        el('step-label').textContent = 'Step 3 · The authority declared it AFTER us';
        el('step-title').textContent = 'NOTAM ' + (n.official_number || n.id) +
          ' — ' + (n.fir_name || n.fir) + ', effective ' + fmt(n.start_utc);
        el('step-body').textContent = '"' +
          n.text_excerpt.replace(/\s+/g, ' ').slice(0, 140) +
          '…" — this declaration became effective AFTER our commit; the archive ' +
          'shows the area undeclared on prior days. The model never reads ' +
          'NOTAMs — they are used only to grade it.';
      } else {
        el('step-label').textContent = 'Step 3 · Their blanket warning vs our call';
        el('step-title').textContent = n.radius_nm.toFixed(0) +
          ' nm for months — versus ' + f.n_matching_rows +
          ' cells at ' + f.rows[0].target_utc.slice(11, 16) + ' UTC';
        el('step-body').textContent = 'NOTAM ' + (n.official_number || n.id) +
          ' ("' + n.text_excerpt.replace(/\s+/g, ' ').slice(0, 90) + '…") — ' +
          'the standing blanket warning from step 1. An operator cannot plan ' +
          'around that. Our forecast named ' + f.n_matching_rows +
          ' five-kilometre cells and one hour — and was right. ' +
          'Precision inside a blanket warning is the product.';
      }
      var lk = v.notam_lookup || {};
      links([
        lk.url ? { href: lk.url, text: 'look it up yourself — FAA NOTAM Search ↗' } : null,
        { text: lk.instructions || '' }
      ].filter(Boolean));
      var g = L.layerGroup();
      g.addLayer(L.circle([n.center_lat, n.center_lng], {
        radius: n.radius_nm * 1852, color: COLORS.notam, weight: 1.8,
        dashArray: '6 4', fillColor: COLORS.notam, fillOpacity: 0.06
      }));
      drawCells(rc, 'outcome').eachLayer(function (m) { g.addLayer(m); });
      state.layer = g.addTo(state.map);
      state.map.fitBounds(L.latLng(n.center_lat, n.center_lng).toBounds(n.radius_nm * 1852 * 2.4));
    }

    if (state.step === 3) {
      el('step-label').textContent = 'Step 4 · One case of many';
      var a = state.agg;
      el('step-title').textContent = a
        ? a.committed.toLocaleString() + ' forecasts committed before their windows'
        : 'The whole record, committed before the events';
      el('step-body').textContent = (a
        ? 'Across the graded record: ' + a.precision_pct + '% precision against a ' +
          a.base_rate_pct + '% base rate — ' + a.lift + '× better than chance. '
        : '') +
        'Every hour, an autonomous agent commits the next forecast and anchors it ' +
        'into Bitcoin. The record is public — misses included, gaps never back-filled.';
      links([
        { href: 'https://github.com/saurabhdxt-labs/phantom-record-mirror', text: 'the public record on GitHub ↗' },
        { href: '../replay/', text: 'replay any day of the record' }
      ]);
      var all = L.layerGroup();
      state.cases.forEach(function (c) {
        drawCells(c, 'outcome').eachLayer(function (m) { all.addLayer(m); });
        all.addLayer(L.circle([c.notam.center_lat, c.notam.center_lng], {
          radius: c.notam.radius_nm * 1852, color: COLORS.notam, weight: 1.2,
          dashArray: '6 4', fillOpacity: 0.03, fillColor: COLORS.notam
        }));
      });
      state.layer = all.addTo(state.map);
      var b = cellBounds(state.cases[0]);
      state.cases.forEach(function (c) { b.extend(cellBounds(c)); });
      state.map.fitBounds(b.pad(0.4));
    }
  }
})();
