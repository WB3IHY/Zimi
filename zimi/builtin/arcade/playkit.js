/* Zimi Arcade: the little helpers the puzzle and arcade pages share. Our own code, GPL-3.0.
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

  root.ArcadePlay = Play;
})(this);
