/* ZimiGames: what the games that draw on the player's own library share. Our own code, GPL-3.0.
   Inside Zimi this page is same-origin with Zimi's API, so it can ask for the player's ZIMs. In Kiwix (or from a
   plain folder) there is no such API: isZimi() finds out with one cheap request that fails fast, and each game
   then plays from the small set it ships, never a dead page. Nothing here runs until a game calls it.
   The pure parts (seeded chance, folding, choosing a ZIM, resolving a link) work in node for the tests. */
(function (root) {
  'use strict';
  var Lib = {};
  var PROBE_MS = 1500, JSON_MS = 10000;

  // ── pure helpers ─────────────────────────────────────────────────────────
  // FNV-1a over the string's UTF-16 units: the same seed from the same text, everywhere.
  Lib.hash = function (s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  };
  // mulberry32: a small seeded generator, so a daily race or word is one thing for everyone on a server.
  Lib.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  Lib.shuffle = function (arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor((rng || Math.random)() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };
  Lib.sample = function (arr, n, rng) { return Lib.shuffle(arr, rng).slice(0, n); };

  // Letters without their accents or case: "École" and "ecole" are one word to a keyboard.
  Lib.fold = function (s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  Lib.primaryLang = function (tag) { return String(tag || '').toLowerCase().split(/[-_]/)[0]; };

  // The server's day key: YYYYMMDD on the player's calendar (the server accepts yesterday to tomorrow).
  Lib.dayKey = function (date) {
    var d = date || new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  };

  // Which of the library's ZIMs to play from: the project's ZIMs (kind "wiki"), the player's language first,
  // then English, then the biggest. {zim, exact} or null when the library has none of that project.
  Lib.pickZim = function (list, project, lang) {
    var mine = (list || []).filter(function (z) { return z.kind === 'wiki' && z.project === project; });
    if (!mine.length) return null;
    var size = function (z) { return z.article_count || z.entries || 0; };
    var best = function (zs) { return zs.slice().sort(function (a, b) { return size(b) - size(a); })[0]; };
    var want = Lib.primaryLang(lang);
    var exact = mine.filter(function (z) { return Lib.primaryLang(z.language) === want; });
    if (exact.length) return { zim: best(exact), exact: true };
    var en = mine.filter(function (z) { return Lib.primaryLang(z.language) === 'en'; });
    return { zim: best(en.length ? en : mine), exact: false };
  };

  // An article link, as a path inside the same ZIM, or null when it leads anywhere else (another site,
  // another ZIM, a namespace page such as File: or Category:, the page itself, a bare anchor).
  var BASE = 'http://zimi.invalid';
  Lib.resolvePath = function (zim, fromPath, href) {
    if (!href || href.charAt(0) === '#') return null;
    var u;
    try { u = new URL(href, BASE + '/w/' + encodeURIComponent(zim) + '/' + fromPath.split('/').map(encodeURIComponent).join('/')); } catch (e) { return null; }
    if (u.origin !== BASE) return null;
    var prefix = '/w/' + encodeURIComponent(zim) + '/';
    if (u.pathname.indexOf(prefix) !== 0) return null;
    var path;
    try { path = decodeURIComponent(u.pathname.slice(prefix.length)); } catch (e) { return null; }
    if (!path || path.indexOf(':') >= 0 || path === fromPath) return null;
    return path;
  };

  Lib.titleOfPath = function (path) { return path.replace(/_/g, ' '); };

  // ── asking Zimi ──────────────────────────────────────────────────────────
  Lib.json = function (url, ms) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms || JSON_MS) : null;
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  };
  Lib.text = function (url, ms) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms || JSON_MS) : null;
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  };

  // Is this page being served by Zimi? One request to /health, which only Zimi answers with {status: "ok"}.
  // From a folder (file:) there is nothing to ask. Asked once per page.
  var zimiAnswer = null;
  Lib.isZimi = function () {
    if (!zimiAnswer) {
      zimiAnswer = typeof location === 'undefined' || !/^https?:$/.test(location.protocol)
        ? Promise.resolve(false)
        : Lib.json('/health', PROBE_MS).then(function (j) { return !!(j && j.status === 'ok'); }, function () { return false; });
    }
    return zimiAnswer;
  };

  // The library, once: the cached ZIM list Zimi already keeps.
  var listAnswer = null;
  Lib.zims = function () {
    if (!listAnswer) listAnswer = Lib.json('/list').then(function (l) { return Array.isArray(l) ? l : []; }, function () { return []; });
    return listAnswer;
  };

  // The player's language: ?lang= (for testing), Zimi's own language setting (same origin, so readable),
  // then the browser's.
  Lib.uiLang = function () {
    var q = '';
    try { q = new URLSearchParams(location.search).get('lang') || ''; } catch (e) { /* no location in node */ }
    if (q) return Lib.primaryLang(q);
    try {
      var v = localStorage.getItem('zimi_ui_lang');
      if (v) { try { v = JSON.parse(v); } catch (e) { /* a bare code */ } if (typeof v === 'string' && v) return Lib.primaryLang(v); }
    } catch (e) { /* blocked storage */ }
    return Lib.primaryLang(typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en';
  };

  // The line under a game that says what its content came from.
  Lib.sourceLine = function (el, text) { if (el) el.textContent = text; };

  root.GamesLib = Lib;
})(this);
