/* PHANTOM forecast receipt — renders data/receipt.json. Zero hardcoded claims:
 * every number, time, id and caveat on this page comes from the generated
 * payload (which is leak-scanned at generation time). */
(function () {
  'use strict';

  function fmtUtc(iso) {
    if (!iso) return '—';
    return iso.replace('T', ' ').replace(/:\d\d(\.\d+)?\+00:00$/, ' UTC');
  }

  function show(id) { document.getElementById(id).hidden = false; }
  function el(id) { return document.getElementById(id); }

  fetch('data/receipt.json')
    .then(function (r) {
      if (!r.ok) throw new Error('receipt.json missing (' + r.status + ')');
      return r.json();
    })
    .then(render)
    .catch(function (e) {
      show('empty');
      el('stages').textContent = String(e);
    });

  function render(doc) {
    el('generated').textContent = 'generated ' + fmtUtc(doc.generated_utc);
    if (doc.status !== 'receipt') {
      show('empty');
      el('stages').textContent = JSON.stringify(doc.stages || {}, null, 2) +
        '\n' + (doc.note || '');
      return;
    }
    var r = doc.receipt, n = r.notam, f = r.forecast;
    show('main');

    // type badge
    var badge = el('type-badge');
    if (r.type === 'onset') {
      badge.textContent = 'DECLARATION ONSET';
    } else {
      badge.textContent = 'AUTHORITY CORROBORATION';
      badge.classList.add('corroboration');
    }

    // step 1 — commit (linked to the actual commit when a repo URL exists)
    el('commit-time').textContent = fmtUtc(f.commit_time_utc);
    var v = r.verification || {};
    if (v.commit_url) {
      var a = document.createElement('a');
      a.href = v.commit_url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = f.commit_sha.slice(0, 12) + ' ↗';
      el('commit-sha').textContent = '';
      el('commit-sha').appendChild(a);
    } else {
      el('commit-sha').textContent = f.commit_sha.slice(0, 12);
    }
    el('bitcoin-line').textContent = r.bitcoin.status;

    // arrow
    el('lead-hours').textContent = r.lead_hours + ' h';
    el('lead-basis').textContent = r.lead_basis === 'commit_to_notam_start'
      ? 'commit → declaration effective' : 'commit → target hour';

    // step 2 — target
    var targets = f.rows.map(function (x) { return x.target_utc; }).sort();
    el('target-time').textContent = fmtUtc(targets[0]);
    var probs = f.rows.map(function (x) { return x.probability; });
    el('rows-line').textContent = f.n_matching_rows +
      ' high-confidence cell(s), probability ' +
      Math.min.apply(null, probs).toFixed(2) + '–' +
      Math.max.apply(null, probs).toFixed(2);

    // step 3 — NOTAM (official number is the buyer-checkable identity)
    el('notam-id').textContent = 'NOTAM ' +
      (n.official_number || n.id) + ' · ' + n.fir;
    el('notam-window').textContent = 'effective ' + fmtUtc(n.start_utc) +
      (n.end_utc ? ' → ' + fmtUtc(n.end_utc) : '') +
      (n.issuing_office ? ' · issued by ' + n.issuing_office : '');

    // panel
    el('notam-text').textContent = n.text_excerpt;
    var dists = f.rows.map(function (x) { return x.dist_nm; });
    var trail = [
      'commit  ' + f.commit_sha,
      'file    ' + f.file,
      'anchor  ' + r.bitcoin.status,
      'notam   ' + (n.official_number || n.id) + ' (' + n.fir + '), r=' +
        n.radius_nm + ' nm, effective ' + fmtUtc(n.start_utc),
      'inside  all ' + f.rows.length + ' cell(s) ' +
        Math.min.apply(null, dists).toFixed(0) + '–' +
        Math.max.apply(null, dists).toFixed(0) +
        ' nm from NOTAM center ≤ ' + n.radius_nm + ' nm radius'
    ];
    if (r.onset_evidence) {
      trail.push('onset   area ABSENT from authority-declared archive on ' +
        r.onset_evidence.prior_days_absent.join(', '));
      trail.push('        first declared: ' + r.onset_evidence.first_declared_day);
    }
    if (r.standing_declaration) {
      trail.push('archive authority-declared set of ' +
        r.standing_declaration.archived_day + ' contains the area');
    }
    el('verify-trail').textContent = trail.join('\n');

    // verify-yourself: clickable links + exact commands
    var links = el('verify-links');
    function addLink(href, label) {
      if (!href) return;
      var li = document.createElement('li'), a = document.createElement('a');
      a.href = href; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = label;
      li.appendChild(a); links.appendChild(li);
    }
    addLink(v.commit_url, 'the commit on the record repository ↗');
    addLink(v.file_url, 'the committed forecast file at that commit ↗');
    if (v.notam_lookup) {
      addLink(v.notam_lookup.url,
        'look up ' + (n.official_number || 'the NOTAM') + ' on ' +
        v.notam_lookup.service + ' ↗');
      var note = document.createElement('li');
      note.textContent = v.notam_lookup.instructions;
      note.className = 'link-note';
      links.appendChild(note);
    }
    if (v.commands) { el('verify-cmds').textContent = v.commands.join('\n'); }

    var srcs = el('sources');
    Object.keys(r.sources).forEach(function (k) {
      var li = document.createElement('li');
      li.textContent = r.sources[k];
      srcs.appendChild(li);
    });

    // honesty strip
    el('h-claim').textContent = r.honesty.claim;
    el('h-notclaim').textContent = r.honesty.not_claim;
    el('h-stat').textContent = r.honesty.statistical_proof;
    if (r.standing_declaration) {
      var sn = el('standing-note');
      sn.hidden = false;
      sn.textContent = r.standing_declaration.note;
    }

    // A map failure must never take down the evidence panels (the flow strip
    // and verification trail are the load-bearing content on a call).
    try {
      renderMap(r);
    } catch (e) {
      el('map').textContent = 'map unavailable: ' + e.message;
    }
  }

  function renderMap(r) {
    var n = r.notam, f = r.forecast;
    // setView BEFORE any layer: Leaflet throws layerPointToLatLng if layers
    // (tooltips especially) attach while the map has no center/zoom yet
    // (caught in the 2026-08-01 headless render test).
    var map = L.map('map', { zoomControl: true, attributionControl: false })
      .setView([n.center_lat, n.center_lng], 6);
    if (window.__PHANTOM_LAND__) {
      L.geoJSON(window.__PHANTOM_LAND__, {
        style: { color: '#232b3a', weight: 0.7, fillColor: '#141a26',
                 fillOpacity: 1, interactive: false }
      }).addTo(map);
    }
    // NOTAM area (radius in nautical miles -> meters)
    var circle = L.circle([n.center_lat, n.center_lng], {
      radius: n.radius_nm * 1852,
      color: '#ffd479', weight: 1.6, dashArray: '6 4',
      fillColor: '#ffd479', fillOpacity: 0.06
    }).addTo(map);
    circle.bindTooltip('NOTAM ' + n.id + ' — declared area', { className: 'cell-tip' });

    f.rows.forEach(function (row) {
      var m = L.circleMarker([row.lat, row.lng], {
        radius: 7, color: '#7fd4a8', weight: 2,
        fillColor: '#7fd4a8', fillOpacity: 0.55
      }).addTo(map);
      m.bindTooltip(
        'forecast p=' + row.probability.toFixed(2) +
        ' · target ' + row.target_utc.replace('T', ' ').slice(0, 16) + ' UTC' +
        ' · committed ' + r.lead_hours + ' h earlier' +
        ' · ' + row.dist_nm + ' nm from NOTAM center',
        { className: 'cell-tip' });
    });

    map.fitBounds(circle.getBounds().pad(0.25));
  }
})();
