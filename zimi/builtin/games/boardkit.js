/* ZimiGames: the little kit the board games share (storage, a seeded generator,
   sheets, option chips). Our own code, GPL-3.0. No network, no modules. */
(function (root) {
  'use strict';
  var PREFIX = 'zimi.games.';

  // localStorage can throw (private mode, blocked data): every read and write is guarded.
  function load(name, fallback) {
    try { var v = JSON.parse(localStorage.getItem(PREFIX + name)); return v && typeof v === 'object' ? v : fallback; } catch (e) { return fallback; }
  }
  function save(name, value) {
    try { localStorage.setItem(PREFIX + name, JSON.stringify(value)); } catch (e) { /* play on without it */ }
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function reducedMotion() {
    if (root.ZimiShell && root.ZimiShell.anim() === 'off') return true;
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  function fmtTime(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  // A sheet over the page: Escape and a click outside close it, focus goes back where it was.
  function sheet(el, onClose) {
    var from = null;
    function close() {
      if (el.hidden) return;
      el.hidden = true;
      if (from && from.focus) from.focus();
      if (onClose) onClose();
    }
    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = el.querySelectorAll('button:not([disabled]),input:not([disabled])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    return {
      el: el,
      open: function (focusEl) {
        from = document.activeElement;
        el.hidden = false;
        var t = focusEl || el.querySelector('input:checked,button');
        if (t) t.focus();
      },
      close: close
    };
  }

  // A group of radio chips: read the value, set it.
  function chipValue(group) { var c = group.querySelector('input:checked'); return c ? c.value : null; }
  function chipSet(group, value) {
    var inputs = group.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) inputs[i].checked = inputs[i].value === String(value);
  }

  // Arrow keys move focus over a grid of buttons (display order); one is the tab stop. n is the width
  // (and the height, unless rows says otherwise).
  var ARROWS = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
  function gridNav(board, cells, n, rows) {
    var cur = 0, h = rows || n;
    function mark(i) { cells[cur].tabIndex = -1; cur = i; cells[cur].tabIndex = 0; }
    cells.forEach(function (c, i) { c.tabIndex = i ? -1 : 0; c.addEventListener('focus', function () { mark(i); }); });
    board.addEventListener('keydown', function (e) {
      var d = ARROWS[e.key];
      if (!d || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      var r = Math.min(h - 1, Math.max(0, Math.floor(cur / n) + d[0])), c = Math.min(n - 1, Math.max(0, (cur % n) + d[1]));
      cells[r * n + c].focus();
    });
  }

  root.BoardKit = { gridNav: gridNav, load: load, save: save, mulberry32: mulberry32, reducedMotion: reducedMotion, fmtTime: fmtTime, sheet: sheet, chipValue: chipValue, chipSet: chipSet };
})(typeof globalThis !== 'undefined' ? globalThis : this);
