/* ZimiGames: what was played lately, and the game of the day.

   Every game page includes this file (scripts/games_recent.py writes the tag).
   On a game it notes the page in localStorage ("zimi.games.recent"); on the
   shelf it draws two sections from the shelf's own tiles: Continue (the last
   six games, newest first) and Game of the day. Nothing here leaves the device.

   The day's game is a function of the date and games.json alone, so it is the
   same for everyone on that day, and the same one Zimi's Discover shows:
   zimi/gamelinks.py game_of_day() is this algorithm in Python (a test holds
   the two together). */
(function (root) {
  'use strict';

  var KEY = 'zimi.games.recent';
  var CAP = 6;
  var SKIP_PAGES = { 'index.html': 1, 'about.html': 1, 'puzzles.html': 1 };

  // FNV-1a over the UTF-8 bytes of a string, as an unsigned 32-bit number.
  function fnv1a(text) {
    var bytes = unescape(encodeURIComponent(text)), h = 0x811c9dc5, i;
    for (i = 0; i < bytes.length; i++) {
      h ^= bytes.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // One row per game page, in games.json order (a game with two Q-IDs has two rows).
  function uniqueByPath(rows) {
    var seen = {}, out = [];
    (rows || []).forEach(function (r) {
      if (r && r.path && !seen[r.path]) { seen[r.path] = 1; out.push(r); }
    });
    return out;
  }

  // The game of a day ("YYYY-MM-DD"): the hash of the day over the games.
  function dayPick(rows, day) {
    var games = uniqueByPath(rows);
    return games.length ? games[fnv1a(day) % games.length] : null;
  }

  // The list after playing `entry` {path, title}: it goes first, an older
  // copy of it goes away, and the list is cut to `cap`.
  function record(list, entry, at, cap) {
    var rest = (list || []).filter(function (e) { return e && e.path && e.path !== entry.path; });
    return [{ path: entry.path, title: entry.title, at: at }].concat(rest).slice(0, cap || CAP);
  }

  function read(storage) {
    try {
      var v = JSON.parse(storage.getItem(KEY));
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function localDay(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  var api = { KEY: KEY, CAP: CAP, fnv1a: fnv1a, uniqueByPath: uniqueByPath, dayPick: dayPick, record: record, read: read, localDay: localDay };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.ZimiRecent = api;

  var doc = root.document;
  if (!doc) return;
  var script = doc.currentScript;
  var base = script && script.src ? new URL('.', script.src) : null;

  // The page's path from the games' folder: "chess.html", "puzzles/fifteen.html".
  function pagePath() {
    if (!base) return '';
    var p = decodeURIComponent(root.location.pathname);
    var b = decodeURIComponent(base.pathname);
    return p.indexOf(b) === 0 ? p.slice(b.length) : '';
  }

  // "Mancala - ZimiGames" and "Fifteen, from Simon Tatham's ..." are both just the name.
  function pageTitle() {
    return (doc.title || '').replace(/ - ZimiGames$/, '').replace(/, from .*$/, '').trim();
  }

  function note() {
    var path = pagePath();
    if (!path || SKIP_PAGES[path]) return;
    try {
      root.localStorage.setItem(KEY, JSON.stringify(record(read(root.localStorage), { path: path, title: pageTitle() }, Date.now(), CAP)));
    } catch (e) { /* private window, blocked storage: nothing to remember */ }
  }

  // A tile for a game: the shelf's own, copied, so the art matches; a plain
  // one (name and line) for a game the shelf has no tile of.
  function tileFor(path, title, line) {
    var tile = doc.querySelector('a.ar-game[href="' + path + '"]');
    var el;
    if (tile) {
      el = tile.cloneNode(true);
    } else {
      el = doc.createElement('a');
      el.className = 'ar-game';
      el.setAttribute('href', path);
      el.innerHTML = '<span class="ar-game-text"><strong></strong><span></span></span>';
      el.querySelector('strong').textContent = title;
    }
    var spans = el.querySelectorAll('.ar-game-text > span');
    if (line !== null && spans.length) spans[spans.length - 1].textContent = line;
    return el;
  }

  function section(cls, label, tiles) {
    var s = doc.createElement('section');
    s.className = 'ar-section ' + cls;
    var h = doc.createElement('h2');
    h.textContent = label;
    var nav = doc.createElement('nav');
    nav.className = 'ar-games';
    nav.setAttribute('aria-label', label);
    tiles.forEach(function (t) { nav.appendChild(t); });
    s.appendChild(h);
    s.appendChild(nav);
    return s;
  }

  function shelf() {
    var first = doc.querySelector('.ar-section');
    if (!first) return;
    var recent = read(root.localStorage).slice(0, CAP);
    var cont = null;
    if (recent.length) {
      cont = section('ar-continue', 'Continue', recent.map(function (e) { return tileFor(e.path, e.title, null); }));
      first.parentNode.insertBefore(cont, first);
    }
    fetch(new URL('games.json', base).href).then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
      var g = dayPick(rows, localDay(new Date()));
      if (!g) return;
      var s = section('ar-today', 'Game of the day', [tileFor(g.path, g.title, g.why || g.blurb || '')]);
      s.querySelector('a.ar-game').classList.add('ar-feature');
      first.parentNode.insertBefore(s, cont ? cont.nextSibling : first);
    }).catch(function () { /* opened from a place that cannot fetch: the shelf stays as it was */ });
  }

  if (doc.querySelector('.ar-shelf')) shelf(); else note();
})(typeof window !== 'undefined' ? window : globalThis);
