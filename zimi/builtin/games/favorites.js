/* ZimiGames: the games kept as favorites, on the shelf. Our own code, GPL-3.0. No network, no modules.

   Inside Zimi the header's heart keeps a game in Zimi's Saved (hearts and lists), so this row is
   Saved's items of this ZIM, read from the page that holds us (same origin: window.parent.Saved).
   Anywhere else there is no Saved and no row. It is drawn after shelf.js has laid out the top of
   the shelf, and it hides with it when a search or a section chip takes the shelf over. */
(function (root) {
  'use strict';
  var doc = root.document;
  var ZIM = 'zimi_games';
  var NOT_GAMES = { 'index.html': 1, 'about.html': 1, 'puzzles.html': 1 };

  // Saved's items of this ZIM that are games, the latest kept first; [] outside Zimi.
  function favorites() {
    try {
      var saved = root.parent !== root && root.parent.Saved;
      if (!saved || !root.parent.document.getElementById('reader-frame')) return [];
      return saved.all().filter(function (it) { return it.zim === ZIM && it.path && !NOT_GAMES[it.path]; });
    } catch (e) { return []; }
  }

  // The tile's own art is a file of this ZIM (thumbs/<game>.svg; a Tatham puzzle shows its icon).
  function artFor(path) {
    var stem = path.replace(/^.*\//, '').replace(/\.html$/, '');
    return path.indexOf('puzzles/') === 0 ? 'puzzles/icons/' + stem + '.png' : 'thumbs/' + stem + '.svg';
  }

  function tile(item) {
    var a = doc.createElement('a');
    a.className = 'ar-game';
    a.setAttribute('href', item.path);
    var img = doc.createElement('img');
    img.className = 'ar-game-art';
    img.alt = '';
    img.src = artFor(item.path);
    img.addEventListener('error', function () { img.remove(); });
    var text = doc.createElement('span');
    text.className = 'ar-game-text';
    var name = doc.createElement('strong');
    name.textContent = item.title || item.path.replace(/\.html$/, '');
    text.appendChild(name);
    a.appendChild(img);
    a.appendChild(text);
    return a;
  }

  // A row to swipe along, not a grid: a heart is a bookmark, and a long list must not push the shelf down.
  var STYLE = '.ar-favorites .ar-games { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x proximity; padding-bottom: 4px; }' +
    '.ar-favorites .ar-game { flex: 0 0 132px; scroll-snap-align: start; }' +
    '.ar-favorites .ar-game-text { padding: 8px 10px 10px; }';

  function draw() {
    var top = doc.querySelector('.sh-top'), items = favorites();
    var old = doc.getElementById('sh-favorites');
    if (old) old.remove();
    if (!top || !items.length) return;
    var s = doc.createElement('section');
    if (!doc.getElementById('sh-favorites-css')) {
      var css = doc.createElement('style');
      css.id = 'sh-favorites-css';
      css.textContent = STYLE;
      doc.head.appendChild(css);
    }
    s.id = 'sh-favorites';
    s.className = 'ar-section ar-favorites';
    var h = doc.createElement('h2');
    h.textContent = 'Favorites';
    var nav = doc.createElement('nav');
    nav.className = 'ar-games';
    nav.setAttribute('aria-label', 'Favorites');
    items.forEach(function (it) { nav.appendChild(tile(it)); });
    s.appendChild(h);
    s.appendChild(nav);
    // Before Game of the day, after the table.
    top.insertBefore(s, doc.querySelector('.sh-top .ar-today'));
  }

  doc.addEventListener('zimi-shelf-today', draw);
  // The page comes back from a game (the back button restores it): hearts may have changed.
  root.addEventListener('pageshow', function (e) { if (e.persisted) draw(); });
})(typeof window !== 'undefined' ? window : globalThis);
