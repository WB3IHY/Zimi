/* ZimiGames' shelf: two views of the same tiles, Lobby and Index.

   The page is plain HTML and lists every game as a link without this file.
   Here the tiles already in the page (the sections of index.html) are read, not
   listed, so a game added to the shelf shows in both views, in the section chips
   and in search with no change here. Lobby is a feed of art tiles; Index is
   search first, one section at a time as thumbnail rows. The choice is kept in
   localStorage ("zimi.games.view"). recent.js draws the game table and Game of the
   day; this file only says where they sit. */
(function (root) {
  'use strict';

  var VIEW_KEY = 'zimi.games.view';
  var VIEWS = ['lobby', 'index'];
  var doc = root.document;
  var shelf = doc && doc.querySelector('.ar-shelf');
  if (!shelf) return;

  var LIST_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><line x1="5" y1="3.5" x2="14" y2="3.5"/><line x1="5" y1="8" x2="14" y2="8"/><line x1="5" y1="12.5" x2="14" y2="12.5"/><circle cx="2" cy="3.5" r="1"/><circle cx="2" cy="8" r="1"/><circle cx="2" cy="12.5" r="1"/></svg>';
  var GRID_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="2" width="4.5" height="4.5" rx="1"/><rect x="9.5" y="2" width="4.5" height="4.5" rx="1"/><rect x="2" y="9.5" width="4.5" height="4.5" rx="1"/><rect x="9.5" y="9.5" width="4.5" height="4.5" rx="1"/></svg>';
  var SEARCH_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>';
  var VIEW_LABEL = { lobby: 'Lobby', index: 'Index' };

  function el(tag, cls, html) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function savedView() {
    try {
      var v = root.localStorage.getItem(VIEW_KEY);
      if (VIEWS.indexOf(v) >= 0) return v;
    } catch (e) { /* blocked storage: the default */ }
    return 'lobby';
  }
  function saveView(v) {
    try { root.localStorage.setItem(VIEW_KEY, v); } catch (e) { /* nothing to remember it in */ }
  }

  // The sections, read from the page: id, label and the tiles each holds.
  var list = shelf.querySelector('.sh-list');
  var sections = Array.prototype.map.call(list.querySelectorAll(':scope > .ar-section'), function (s) {
    var h = s.querySelector('h2');
    var tiles = Array.prototype.slice.call(s.querySelectorAll('a.ar-game'));
    var count = el('span', 'sh-count', String(tiles.length));
    h.appendChild(count);
    return { id: h.id, label: h.firstChild.textContent, node: s, tiles: tiles };
  });
  var total = sections.reduce(function (n, s) { return n + s.tiles.length; }, 0);
  // A tile's words, lowercased, for search: its name and its line.
  var words = new Map();
  sections.forEach(function (s) { s.tiles.forEach(function (t) { words.set(t, t.textContent.toLowerCase()); }); });

  var state = { view: savedView(), sec: 'all', q: '' };
  state.sec = defaultSection();

  function defaultSection() { return state.view === 'index' && sections.length ? sections[0].id : 'all'; }

  // ── Header: search and the view toggle ───────────────────────────────────
  var header = shelf.querySelector('header');
  var tools = el('div', 'sh-tools');
  var search = el('label', 'sh-search', SEARCH_ICON);
  var input = el('input');
  input.type = 'search';
    input.setAttribute('aria-label', 'Search games');
  input.autocomplete = 'off';
  input.spellcheck = false;
  search.appendChild(input);
  var toggle = el('span', 'ar-view-toggle');
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Shelf view');
  var viewBtns = {};
  [['index', LIST_ICON], ['lobby', GRID_ICON]].forEach(function (v) {
    var b = el('button', 'ar-view-btn', v[1]);
    b.type = 'button';
    b.title = VIEW_LABEL[v[0]];
    b.setAttribute('aria-label', VIEW_LABEL[v[0]]);
    b.addEventListener('click', function () { setView(v[0]); });
    viewBtns[v[0]] = b;
    toggle.appendChild(b);
  });
  tools.appendChild(search);
  tools.appendChild(toggle);
  header.appendChild(tools);

  // ── Body: the rail (section chips), the top (the game table, Game of the day), the list ──
  var body = el('div', 'sh-body');
  var rail = el('div', 'sh-rail');
  var nav = el('nav', 'sh-nav');
  nav.setAttribute('aria-label', 'Sections');
  rail.appendChild(nav);
  var main = el('div', 'sh-main');
  var top = el('div', 'sh-top');
  var empty = el('p', 'sh-empty', 'No game matches that.');
  empty.hidden = true;
  list.parentNode.insertBefore(body, list);
  main.appendChild(top);
  main.appendChild(list);
  main.appendChild(empty);
  body.appendChild(rail);
  body.appendChild(main);

  var chips = {};
  function chip(id, label, count, cls) {
    var b = el('button', 'sh-chip' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.appendChild(doc.createTextNode(label));
    var n = el('span', 'sh-chip-n', String(count));
    b.appendChild(n);
    b.addEventListener('click', function () { state.sec = id; state.q = ''; input.value = ''; apply(); });
    chips[id] = { btn: b, n: n };
    nav.appendChild(b);
    return b;
  }
  chip('all', 'All games', total);
  var recentChip = chip('recent', 'Recent', 0, 'sh-chip-recent');
  recentChip.hidden = true;
  var head = el('span', 'sh-rail-head', 'Sections');
  nav.appendChild(head);
  sections.forEach(function (s) { chip(s.id, s.label, s.tiles.length); });

  // ── Layout and filtering ─────────────────────────────────────────────────
  function today() { return doc.querySelector('.ar-today'); }

  // Continue and Game of the day come from recent.js, after the page is up.
  function place() {
    var c = doc.querySelector('.ar-continue'), t = today();
    if (c && c.parentNode !== top) top.appendChild(c);
    if (t) {
      // The day's art fills its box, cropped, whatever shape the box is.
      var art = t.querySelector('svg.ar-game-art');
      if (art) art.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      if (state.view === 'index') rail.appendChild(t); else top.appendChild(t);
    }
    var n = c && !c.classList.contains('ar-table-idle') ? c.querySelectorAll('.ar-box').length : 0;
    recentChip.hidden = !n;
    chips.recent.n.textContent = String(n);
    if (!n && state.sec === 'recent') state.sec = defaultSection();
  }

  function apply() {
    var q = state.q.trim().toLowerCase();
    var searching = q !== '';
    shelf.dataset.view = state.view;
    shelf.dataset.sec = searching ? 'search' : state.sec;
    shelf.classList.add('sh-on');
    // A phone's lobby header has room for one word beside the mark and the toggle.
    input.placeholder = state.view === 'lobby' && root.matchMedia('(max-width: 699px)').matches ? 'Search' : 'Search ' + total + ' games';
    VIEWS.forEach(function (v) { viewBtns[v].setAttribute('aria-pressed', String(v === state.view)); });
    Object.keys(chips).forEach(function (id) { chips[id].btn.setAttribute('aria-pressed', String(!searching && id === state.sec)); });
    var shown = 0;
    sections.forEach(function (s) {
      var n = 0;
      s.tiles.forEach(function (t) {
        var hit = !searching || words.get(t).indexOf(q) >= 0;
        t.hidden = !hit;
        if (hit) n++;
      });
      var inSec = searching || state.sec === 'all' || state.sec === s.id;
      s.node.hidden = !inSec || n === 0;
      s.node.querySelector('.sh-count').textContent = String(n);
      if (inSec) shown += n;
    });
    var c = doc.querySelector('.ar-continue'), t = today();
    // The feed shows the table and the day's game on All only; Index keeps a resume row on every tab.
    var feedAll = state.sec === 'all';
    if (c) c.hidden = searching || (state.view === 'lobby' && !feedAll);
    if (t) t.hidden = searching || (state.view === 'lobby' && !feedAll);
    if (state.sec === 'recent' && !searching) { sections.forEach(function (s) { s.node.hidden = true; }); shown = 1; }
    empty.hidden = shown > 0;
    top.hidden = !!(c && t ? c.hidden && t.hidden : (c ? c.hidden : t ? t.hidden : true));
  }

  function setView(v) {
    if (v === state.view) return;
    state.view = v;
    state.sec = defaultSection();
    saveView(v);
    place();
    apply();
  }

  input.addEventListener('input', function () { state.q = input.value; apply(); });
  doc.addEventListener('keydown', function (e) {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && doc.activeElement !== input && !/^(INPUT|TEXTAREA)$/.test(doc.activeElement && doc.activeElement.tagName)) {
      e.preventDefault();
      input.focus();
    }
  });
  doc.addEventListener('zimi-shelf-today', function () { place(); apply(); });

  place();
  apply();
})(window);
