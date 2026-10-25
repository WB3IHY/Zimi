/* ZimiGames: the little helpers the puzzle and arcade pages share. Our own code, GPL-3.0.
   No network, no modules. Only the pages use it; the rules in each game file stand alone. */
(function (root) {
  'use strict';
  var Play = {};

  Play.$ = function (id) { return document.getElementById(id); };

  // localStorage can throw (private mode, blocked site data): every read and write is guarded.
  Play.load = function (key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : fallback; } catch (e) { return fallback; }
  };
  Play.save = function (key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* play on without it */ }
  };

  Play.reducedMotion = function () {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  };

  // ?theme=light|dark pins the look (the screenshots use it).
  Play.applyTheme = function () {
    var t = new URLSearchParams(location.search).get('theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  };

  Play.fmtClock = function (ms) {
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  };

  // Call fn when the tab is hidden, so a running game can pause itself.
  Play.onHidden = function (fn) {
    document.addEventListener('visibilitychange', function () { if (document.hidden) fn(); });
  };

  // A sheet over the game; focus goes in on open and back to where it was on close.
  var opener = null;
  Play.openSheet = function (sheet, focusSel) {
    opener = document.activeElement;
    sheet.hidden = false;
    var f = sheet.querySelector(focusSel || 'button, input');
    if (f) f.focus();
  };
  Play.closeSheet = function (sheet) {
    sheet.hidden = true;
    if (opener && opener.focus && document.contains(opener)) opener.focus();
    opener = null;
  };

  // Pointer gestures on one element. Handlers: down(x, y), drag(dx, dy, ev) with the totals
  // since the press, up({dx, dy, ms, vx, vy, tap}), cancel(). Velocities are pixels per
  // millisecond over the last VELOCITY_WINDOW_MS, so a flick at the end of a drag counts and a
  // slow drag that ends in a pause does not.
  var TAP_PX = 10, TAP_MS = 350, VELOCITY_WINDOW_MS = 120;
  Play.gesture = function (el, h) {
    var s = null;
    function velocity() {
      var trail = s.trail, last = trail[trail.length - 1], first = trail[0];
      var dt = last.t - first.t;
      return dt > 0 ? { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt } : { vx: 0, vy: 0 };
    }
    el.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      var now = performance.now();
      s = { x: e.clientX, y: e.clientY, t: now, id: e.pointerId, trail: [{ t: now, x: e.clientX, y: e.clientY }] };
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no capture */ }
      if (h.down) h.down(e.clientX, e.clientY, e);
    });
    el.addEventListener('pointermove', function (e) {
      if (!s || e.pointerId !== s.id) return;
      var now = performance.now();
      s.trail.push({ t: now, x: e.clientX, y: e.clientY });
      while (s.trail.length > 2 && now - s.trail[0].t > VELOCITY_WINDOW_MS) s.trail.shift();
      if (h.drag) h.drag(e.clientX - s.x, e.clientY - s.y, e);
    });
    function end(e) {
      if (!s || e.pointerId !== s.id) return;
      var dx = e.clientX - s.x, dy = e.clientY - s.y, ms = performance.now() - s.t, v = velocity();
      s = null;
      if (e.type === 'pointercancel') { if (h.cancel) h.cancel(); return; }
      if (h.up) h.up({ dx: dx, dy: dy, ms: ms, vx: v.vx, vy: v.vy, tap: Math.hypot(dx, dy) < TAP_PX && ms < TAP_MS });
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  // The direction of a swipe, or null when it was too short.
  Play.swipeDir = function (dx, dy, min) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return null;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  };

  // ── dice, symbols, loop and hold buttons (the dice, arcade and kids games) ──
  Play.mulberry32 = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  Play.randomSeed = function () { return Math.floor(Math.random() * 4294967296); };
  Play.shuffle = function (arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };

  // Fill a die element with nine pip cells, lit for the face n (0 = blank).
  var PIPS = { 0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  Play.pips = function (el, n) {
    if (!el.firstChild) { for (var i = 0; i < 9; i++) el.appendChild(document.createElement('i')); }
    var on = PIPS[n] || [];
    for (var k = 0; k < 9; k++) el.children[k].className = on.indexOf(k) >= 0 ? 'on' : '';
  };

  // Six shapes that tell colours apart without colour: circle, square, triangle, diamond, star, cross.
  var SYMBOLS = [
    '<circle cx="12" cy="12" r="7.5"/>',
    '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
    '<path d="M12 4.5 20 19H4z"/>',
    '<path d="M12 3.5 20.5 12 12 20.5 3.5 12z"/>',
    '<path d="m12 3.5 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 17l-5.4 3 1.2-6-4.5-4.2 6.1-.7z"/>',
    '<path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z"/>'
  ];
  Play.SYMBOL_COUNT = SYMBOLS.length;
  Play.symbolSVG = function (i, size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true" fill="currentColor" stroke="rgba(0,0,0,.55)" stroke-width="1.2" stroke-linejoin="round">' + SYMBOLS[i % SYMBOLS.length] + '</svg>';
  };

  // A timer for turn-based games: fn runs after ms, but never while the tab is hidden
  // (it waits for the tab to come back). Returns {cancel}.
  Play.later = function (fn, ms) {
    var h = { dead: false, id: 0, cancel: function () { h.dead = true; clearTimeout(h.id); } };
    function run() {
      if (h.dead) return;
      if (!document.hidden) { fn(); return; }
      var wait = function () { if (document.hidden) return; document.removeEventListener('visibilitychange', wait); run(); };
      document.addEventListener('visibilitychange', wait);
    }
    h.id = setTimeout(run, ms);
    return h;
  };

  // A fixed-step loop: update(dt) in whole steps of 1/hz, render() once per frame.
  // Stops by itself when the tab is hidden (the caller pauses its own state with Play.onHidden).
  Play.loop = function (update, render, hz) {
    var step = 1 / (hz || 60), acc = 0, last = 0, raf = 0, running = false, MAX_FRAME = 0.1;
    function frame(t) {
      if (!running) return;
      acc += Math.min(MAX_FRAME, (t - last) / 1000); last = t;
      while (acc >= step) { acc -= step; update(step); if (!running) return; }
      render();
      raf = requestAnimationFrame(frame);
    }
    return {
      start: function () { if (running) return; running = true; acc = 0; last = performance.now(); raf = requestAnimationFrame(frame); },
      stop: function () { running = false; cancelAnimationFrame(raf); },
      get running() { return running; }
    };
  };

  // A button that is "down" while held, by pointer or by key; fn(true|false).
  Play.hold = function (el, fn) {
    var down = false;
    function set(v) { if (v !== down) { down = v; el.setAttribute('aria-pressed', String(v)); fn(v); } }
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ } set(true); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (n) { el.addEventListener(n, function () { set(false); }); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); set(true); } });
    el.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') set(false); });
    el.addEventListener('blur', function () { set(false); });
    return { release: function () { set(false); } };
  };

  // Fit a canvas of logical size w x h into the room left on screen (chrome = pixels used by everything else).
  Play.fitCanvas = function (cv, w, h, chrome, maxW) {
    var vw = document.documentElement.clientWidth - 24, vh = window.innerHeight - chrome;
    var s = Math.min(vw / w, vh / h, (maxW || w) / w);
    s = Math.max(0.4, s);
    var dpr = window.devicePixelRatio || 1;
    cv.style.width = Math.floor(w * s) + 'px'; cv.style.height = Math.floor(h * s) + 'px';
    cv.width = Math.floor(w * s * dpr); cv.height = Math.floor(h * s * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
    return { scale: s, ctx: ctx };
  };

  root.ArcadePlay = Play;
})(this);
