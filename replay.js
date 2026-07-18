/* PHANTOM replay demo — vanilla JS, self-contained, works from file:// and
 * GitHub Pages. Data arrives via script-tag payloads (data/index.js +
 * data/replay_{day}.js) registered on window.__PHANTOM_REPLAY__, so no
 * fetch() and no third-party requests are ever made. */
(function () {
  'use strict';

  var HIGH_RISK = 0.5;
  var PLAY_MS = 800;

  function $(id) { return document.getElementById(id); }

  function showMsg(text) {
    var el = $('msg');
    el.textContent = text;
    el.hidden = false;
  }

  // ---- preconditions (fail loud, never a blank page) ----
  if (!window.L) { showMsg('Map library failed to load (vendor/leaflet.js missing).'); return; }
  var reg = window.__PHANTOM_REPLAY__;
  if (!reg || !reg.index || !reg.index.days || !reg.index.days.length) {
    showMsg('No replay data found. Run the exporter, then reload ' +
            '(data/index.js and data/replay_*.js must sit next to this page).');
    return;
  }

  // ---- map ----
  var map = L.map('map', {
    zoomControl: true,
    attributionControl: false,
    minZoom: 2,
    maxZoom: 10,
    worldCopyJump: true
  });
  var HOME_BOUNDS = [[24, -12], [62, 58]];   // the covered theatres: Europe + Middle East
  map.fitBounds(HOME_BOUNDS);

  if (window.__PHANTOM_LAND__) {
    L.geoJSON(window.__PHANTOM_LAND__, {
      style: {
        color: '#232b3a', weight: 0.7,
        fillColor: '#141a26', fillOpacity: 1, interactive: false
      }
    }).addTo(map);
  }

  var pointsPane = L.canvas({ padding: 0.3 });
  var ringsPane = L.canvas({ padding: 0.3 });
  var pointsLayer = L.layerGroup().addTo(map);
  var ringsLayer = L.layerGroup().addTo(map);

  // ---- risk color ramp: 0.5 amber -> 0.75 orange -> 1.0 red ----
  var STOPS = [
    [0.50, [0xff, 0xd1, 0x66]],
    [0.75, [0xf0, 0x89, 0x4f]],
    [1.00, [0xe6, 0x39, 0x46]]
  ];

  function riskColor(risk) {
    var t = Math.max(STOPS[0][0], Math.min(1, risk));
    var lo = STOPS[0], hi = STOPS[STOPS.length - 1];
    for (var i = 0; i < STOPS.length - 1; i++) {
      if (t >= STOPS[i][0] && t <= STOPS[i + 1][0]) { lo = STOPS[i]; hi = STOPS[i + 1]; break; }
    }
    var f = (t - lo[0]) / (hi[0] - lo[0] || 1);
    var c = [0, 1, 2].map(function (k) {
      return Math.round(lo[1][k] + (hi[1][k] - lo[1][k]) * f);
    });
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  }

  // ---- state ----
  var state = { day: null, data: null, hourIdx: 0, playing: false, timer: null };
  var ringMarkers = [];
  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- rendering ----
  function renderHour() {
    var hourObj = state.data.hours[state.hourIdx];
    pointsLayer.clearLayers();
    ringsLayer.clearLayers();
    ringMarkers = [];

    var flagged = 0, verified = 0, missed = 0;
    hourObj.points.forEach(function (p) {
      var isHigh = p.risk >= HIGH_RISK;
      if (isHigh) {
        flagged += 1;
        var opts = {
          renderer: pointsPane,
          radius: 3.5 + (p.risk - HIGH_RISK) * 6,
          color: riskColor(p.risk),
          weight: p.hit === null ? 1 : 0,
          dashArray: p.hit === null ? '2,3' : null,
          fillColor: riskColor(p.risk),
          fillOpacity: p.hit === null ? 0.35 : 0.78,
          interactive: false
        };
        pointsLayer.addLayer(L.circleMarker([p.lat, p.lng], opts));
        if (p.hit === true) {
          verified += 1;
          var base = opts.radius + 2;
          var ring = L.circleMarker([p.lat, p.lng], {
            renderer: ringsPane,
            radius: reduceMotion ? base + 3 : base,
            color: '#64ffda',
            weight: 1.6,
            opacity: 0.85,
            fill: false,
            interactive: false
          });
          ringsLayer.addLayer(ring);
          ringMarkers.push({ m: ring, base: base });
        }
      } else {
        // shown non-flagged points are the observed-but-missed record
        missed += 1;
        pointsLayer.addLayer(L.circleMarker([p.lat, p.lng], {
          renderer: pointsPane,
          radius: 3,
          weight: 0,
          fillColor: '#5b8db8',
          fillOpacity: 0.65,
          interactive: false
        }));
      }
    });

    var hh = String(hourObj.hour).padStart(2, '0');
    $('hourLabel').textContent = hh + ':00–' + hh + ':59 UTC';
    $('stHour').textContent = flagged + ' flagged · ' + verified +
      ' verified · ' + missed + ' missed' +
      (hourObj.downsampled ? ' · densest zones thinned for display' : '');
    $('hourSlider').value = String(state.hourIdx);
  }

  function renderDayStats() {
    var s = state.data.summary;
    $('stPrecision').textContent =
      s.day_precision === null ? '–' : (s.day_precision * 100).toFixed(1) + '%';
    $('stHits').textContent = s.n_hits.toLocaleString();
    $('stHigh').textContent = s.n_high_risk.toLocaleString();
    $('stMisses').textContent = s.n_misses.toLocaleString();
  }

  // ---- pulse animation for verified hits ----
  var PULSE_MS = 1500;
  var lastFrame = 0;
  function pulse(ts) {
    if (!reduceMotion && ringMarkers.length && ts - lastFrame > 33) {
      lastFrame = ts;
      var phase = (ts % PULSE_MS) / PULSE_MS;
      var grow = phase * 7;
      var fade = 0.85 * (1 - phase * phase);
      ringMarkers.forEach(function (r) {
        r.m.setRadius(r.base + grow);
        r.m.setStyle({ opacity: fade });
      });
    }
    window.requestAnimationFrame(pulse);
  }
  window.requestAnimationFrame(pulse);

  // ---- data loading (script-tag, file:// safe) ----
  function loadDay(day) {
    return new Promise(function (resolve, reject) {
      if (reg.days && reg.days[day]) { resolve(reg.days[day]); return; }
      var s = document.createElement('script');
      s.src = 'data/replay_' + day + '.js';
      s.onload = function () {
        if (reg.days && reg.days[day]) { resolve(reg.days[day]); }
        else { reject(new Error('payload for ' + day + ' did not register')); }
      };
      s.onerror = function () { reject(new Error('failed loading data for ' + day)); };
      document.head.appendChild(s);
    });
  }

  function setDay(day) {
    stopPlay();
    if (story.active) { exitStory(false); }
    loadDay(day).then(function (data) {
      state.day = day;
      state.data = data;
      state.hourIdx = 0;
      $('hourSlider').max = String(data.hours.length - 1);
      var n = (data.stories || []).length;
      $('storyBtn').disabled = !n;
      $('storyBtn').title = n ? '' : 'No showcase moments on this day';
      renderDayStats();
      renderHour();
    }).catch(function (err) { showMsg(String(err.message || err)); });
  }

  // ---- controls ----
  function stopPlay() {
    state.playing = false;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    $('playBtn').innerHTML = '&#9654; Play';
  }

  function startPlay() {
    if (!state.data) { return; }
    state.playing = true;
    $('playBtn').innerHTML = '&#10074;&#10074; Pause';
    state.timer = setInterval(function () {
      state.hourIdx = (state.hourIdx + 1) % state.data.hours.length;
      renderHour();
    }, PLAY_MS);
  }

  $('playBtn').addEventListener('click', function () {
    if (state.playing) { stopPlay(); } else { startPlay(); }
  });

  $('hourSlider').addEventListener('input', function () {
    if (!state.data) { return; }
    stopPlay();
    state.hourIdx = Math.min(parseInt(this.value, 10) || 0,
                             state.data.hours.length - 1);
    renderHour();
  });

  // ---- story mode: guided walkthrough of the day's showcase moments ----
  var BEAT_MS = 4500;
  var OUTRO_TEXT = 'Every one of these forecasts is in a Bitcoin-anchored ' +
                   'public record, committed before the event.';
  var story = { active: false, idx: 0, beat: 0, timer: null, outro: false };
  var storyRing = null;
  var canSpeak = typeof window.speechSynthesis !== 'undefined' &&
                 typeof window.SpeechSynthesisUtterance !== 'undefined';
  var voiceOn = false;

  // Voice quality: the API default is often the OS's compact robotic voice
  // even when far better ones are installed. Rank the available LOCAL English
  // voices and pin the best. localService===true is REQUIRED: Chrome also
  // offers Google-hosted voices that stream audio from remote servers, which
  // would silently break this page's zero-external-requests guarantee.
  var pickedVoice = null;
  function rankVoice(v) {
    if (!v || v.localService !== true) { return -1; }
    var lang = (v.lang || '').toLowerCase().replace('_', '-');
    if (lang.indexOf('en') !== 0) { return -1; }
    var n = (v.name || '').toLowerCase();
    var score = 1;
    if (lang === 'en-us' || lang === 'en-gb') { score += 1; }
    // macOS encodes quality tiers in the voice name; prefer the good ones.
    if (n.indexOf('premium') !== -1) { score += 8; }
    if (n.indexOf('enhanced') !== -1) { score += 6; }
    // Known-good named voices across macOS versions.
    if (/\b(ava|zoe|samantha|allison|serena|karen|daniel|moira|matilda)\b/.test(n)) { score += 3; }
    if (n.indexOf('compact') !== -1) { score -= 4; }
    return score;
  }
  function pickVoice() {
    if (!canSpeak) { return; }
    var voices = window.speechSynthesis.getVoices() || [];
    var best = null, bestScore = 0;
    for (var i = 0; i < voices.length; i++) {
      var s = rankVoice(voices[i]);
      if (s > bestScore) { best = voices[i]; bestScore = s; }
    }
    pickedVoice = best; // null -> engine default (still local-only)
  }
  if (canSpeak) {
    pickVoice(); // some engines expose the list synchronously...
    window.speechSynthesis.onvoiceschanged = pickVoice; // ...others async.
  }

  function dayStories() { return (state.data && state.data.stories) || []; }

  function stopSpeak() { if (canSpeak) { window.speechSynthesis.cancel(); } }

  function speak(text) {
    if (!canSpeak || !voiceOn) { return; }
    window.speechSynthesis.cancel();
    // One utterance per sentence: natural pauses at beat punctuation instead
    // of one breathless run-on, and interruption lands on a boundary.
    var sentences = String(text).match(/[^.!?]+[.!?]*/g) || [String(text)];
    for (var i = 0; i < sentences.length; i++) {
      var s = sentences[i].trim();
      if (!s) { continue; }
      var u = new window.SpeechSynthesisUtterance(s);
      u.rate = 0.97;   // slightly measured beats the rushed default
      u.pitch = 1.0;
      if (pickedVoice) { u.voice = pickedVoice; }
      window.speechSynthesis.speak(u);
    }
  }

  function clearStoryTimer() {
    if (story.timer) { clearTimeout(story.timer); story.timer = null; }
  }

  function removeStoryRing() {
    if (storyRing) { ringsLayer.removeLayer(storyRing); storyRing = null; }
  }

  function addStoryRing(st) {
    removeStoryRing();
    storyRing = L.circleMarker([st.lat, st.lng], {
      renderer: ringsPane,
      radius: 14,
      color: st.kind === 'miss' ? '#5b8db8' : '#64ffda',
      weight: 2.5,
      opacity: 0.95,
      fill: false,
      interactive: false
    });
    ringsLayer.addLayer(storyRing);
    ringMarkers.push({ m: storyRing, base: 14 });
  }

  function startStory(i, atBeat) {
    clearStoryTimer();
    stopSpeak();
    story.idx = i;
    story.beat = atBeat === 'last' ? dayStories()[i].beats.length - 1 : 0;
    story.outro = false;
    var st = dayStories()[i];
    var hourIdx = 0;
    for (var k = 0; k < state.data.hours.length; k++) {
      if (state.data.hours[k].hour === st.hour) { hourIdx = k; break; }
    }
    state.hourIdx = hourIdx;
    renderHour();               // clears rings, so re-add the highlight after
    addStoryRing(st);
    map.flyTo([st.lat, st.lng], 7, { duration: 1.4 });
    showBeat();
  }

  function showBeat() {
    clearStoryTimer();
    var sts = dayStories();
    var st = sts[story.idx];
    $('storyCounter').textContent = 'Story ' + (story.idx + 1) + ' of ' + sts.length;
    var kindEl = $('storyKind');
    if (st.kind === 'miss') {
      kindEl.textContent = 'Published miss — ' + st.area;
      kindEl.className = 'story-kind is-miss';
    } else {
      kindEl.textContent = 'Verified onset call — ' + st.area;
      kindEl.className = 'story-kind is-hit';
    }
    var text = st.beats[story.beat].text;
    var el = $('storyText');
    el.textContent = text;
    el.classList.remove('beat-in');
    void el.offsetWidth;        // restart the fade-in
    el.classList.add('beat-in');
    var lastBeat = story.beat === st.beats.length - 1;
    var lastStory = story.idx === sts.length - 1;
    $('storyNext').innerHTML = lastBeat
      ? (lastStory ? 'Finish &#8594;' : 'Next story &#8594;')
      : 'Next &#8594;';
    speak(text);
    story.timer = setTimeout(nextBeat, BEAT_MS);
  }

  function showOutro() {
    clearStoryTimer();
    stopSpeak();
    story.outro = true;
    $('storyCounter').textContent = 'The record';
    $('storyKind').textContent = '';
    $('storyKind').className = 'story-kind';
    var el = $('storyText');
    el.textContent = OUTRO_TEXT;
    el.classList.remove('beat-in');
    void el.offsetWidth;
    el.classList.add('beat-in');
    $('storyNext').innerHTML = 'Exit';
    removeStoryRing();
    map.flyTo(map.getCenter(), Math.max(map.getZoom() - 2, 4), { duration: 1.2 });
    speak(OUTRO_TEXT);
  }

  function nextBeat() {
    if (story.outro) { exitStory(true); return; }
    var sts = dayStories();
    var st = sts[story.idx];
    if (story.beat < st.beats.length - 1) {
      story.beat += 1;
      showBeat();
    } else if (story.idx < sts.length - 1) {
      startStory(story.idx + 1);
    } else {
      showOutro();
    }
  }

  function prevBeat() {
    if (story.outro) { startStory(dayStories().length - 1, 'last'); return; }
    if (story.beat > 0) {
      story.beat -= 1;
      showBeat();
    } else if (story.idx > 0) {
      startStory(story.idx - 1, 'last');
    }
  }

  function enterStory() {
    if (!dayStories().length) { return; }
    stopPlay();
    story.active = true;
    document.body.classList.add('story-on');
    $('storyPanel').hidden = false;
    startStory(0);
  }

  function exitStory(refit) {
    clearStoryTimer();
    stopSpeak();
    story.active = false;
    story.outro = false;
    document.body.classList.remove('story-on');
    $('storyPanel').hidden = true;
    removeStoryRing();
    if (refit !== false) { map.flyToBounds(HOME_BOUNDS, { duration: 1.2 }); }
    renderHour();
  }

  $('storyBtn').addEventListener('click', enterStory);
  $('storyExit').addEventListener('click', function () { exitStory(true); });
  $('storyNext').addEventListener('click', nextBeat);
  $('storyPrev').addEventListener('click', prevBeat);
  $('storyText').addEventListener('click', nextBeat);

  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function dayLabel(day) {
    var d = new Date(day + 'T00:00:00Z');
    return WEEKDAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' +
           MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  var select = $('daySelect');
  reg.index.days.forEach(function (day) {
    var opt = document.createElement('option');
    opt.value = day;
    opt.textContent = dayLabel(day);
    select.appendChild(opt);
  });
  select.value = reg.index.latest || reg.index.days[reg.index.days.length - 1];
  select.addEventListener('change', function () { setDay(this.value); });

  setDay(select.value);
})();
