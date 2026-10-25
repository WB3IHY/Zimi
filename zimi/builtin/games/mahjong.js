/* ZimiGames: Mahjong solitaire. Our own code and our own tile art, GPL-3.0. No network, no modules.
   Two halves: the layouts, the free-tile rule and the solvable deal (pure functions, testable in
   node), then the page (runs only when there is a document). */
(function (root) {
  'use strict';

  // ── the layouts, as data ─────────────────────────────────────────────────
  // Positions are in half tiles: a tile covers a 2 x 2 box at (x, y) on its layer. A row is
  // [y, first x, how many tiles], one tile every 2 units; `at` lists single tiles as [x, y].
  var LAYOUTS = [
    { id: 'turtle', name: 'Turtle', layers: [
      { rows: [[0, 2, 12], [2, 6, 8], [4, 4, 10], [6, 2, 12], [8, 2, 12], [10, 4, 10], [12, 6, 8], [14, 2, 12]], at: [[0, 7], [26, 7], [28, 7]] },
      { rows: [[2, 8, 6], [4, 8, 6], [6, 8, 6], [8, 8, 6], [10, 8, 6], [12, 8, 6]] },
      { rows: [[4, 10, 4], [6, 10, 4], [8, 10, 4], [10, 10, 4]] },
      { rows: [[6, 12, 2], [8, 12, 2]] },
      { at: [[13, 7]] }
    ] },
    { id: 'pyramid', name: 'Pyramid', layers: [
      { rows: [[0, 2, 10], [2, 2, 10], [4, 2, 10], [6, 2, 10], [8, 2, 10], [10, 2, 10]] },
      { rows: [[1, 4, 8], [3, 4, 8], [5, 4, 8], [7, 4, 8], [9, 4, 8]] },
      { rows: [[2, 6, 6], [4, 6, 6], [6, 6, 6], [8, 6, 6]] },
      { rows: [[3, 8, 4], [5, 8, 4], [7, 8, 4]] },
      { rows: [[4, 10, 2], [6, 10, 2]] }
    ] },
    { id: 'towers', name: 'Twin towers', layers: [
      { rows: [[0, 0, 3], [2, 0, 3], [4, 0, 3], [6, 0, 3], [8, 0, 3], [10, 0, 3], [12, 0, 3], [0, 14, 3], [2, 14, 3], [4, 14, 3], [6, 14, 3], [8, 14, 3], [10, 14, 3], [12, 14, 3], [4, 6, 4], [6, 6, 4], [8, 6, 4]] },
      { rows: [[2, 1, 2], [4, 1, 2], [6, 1, 2], [8, 1, 2], [10, 1, 2], [2, 15, 2], [4, 15, 2], [6, 15, 2], [8, 15, 2], [10, 15, 2], [5, 7, 3], [7, 7, 3]] },
      { rows: [[4, 2, 1], [6, 2, 1], [8, 2, 1], [4, 16, 1], [6, 16, 1], [8, 16, 1]] }
    ] }
  ];

  // 144 faces: 0-8 circles, 9-17 bamboo, 18-26 characters, 27-30 winds, 31-33 dragons (four of each),
  // 34-37 flowers and 38-41 seasons (one of each; any flower pairs with any flower, any season with any season).
  var FACES = 42, FIRST_FLOWER = 34, FIRST_SEASON = 38, DEAL_ATTEMPTS = 400;

  function matches(a, b) {
    if (a === b) return true;
    if (a >= FIRST_FLOWER && a < FIRST_SEASON) return b >= FIRST_FLOWER && b < FIRST_SEASON;
    return a >= FIRST_SEASON && b >= FIRST_SEASON;
  }

  function tilesOf(layout) {
    var out = [];
    layout.layers.forEach(function (layer, l) {
      (layer.rows || []).forEach(function (row) { for (var k = 0; k < row[2]; k++) out.push({ l: l, x: row[1] + 2 * k, y: row[0] }); });
      (layer.at || []).forEach(function (p) { out.push({ l: l, x: p[0], y: p[1] }); });
    });
    return out;
  }

  // Who covers whom, and who sits to the left and right: worked out once per layout.
  function analyze(tiles) {
    var n = tiles.length, covers = [], lefts = [], rights = [];
    for (var i = 0; i < n; i++) {
      var t = tiles[i], c = [], lf = [], rt = [];
      for (var j = 0; j < n; j++) {
        if (i === j) continue;
        var u = tiles[j], dx = u.x - t.x, dy = Math.abs(u.y - t.y);
        if (u.l > t.l && Math.abs(dx) < 2 && dy < 2) c.push(j);
        else if (u.l === t.l && dy < 2) { if (dx < 0 && dx >= -2) lf.push(j); else if (dx > 0 && dx <= 2) rt.push(j); }
      }
      covers.push(c); lefts.push(lf); rights.push(rt);
    }
    return { n: n, tiles: tiles, covers: covers, lefts: lefts, rights: rights };
  }

  function anyAlive(list, alive) { for (var k = 0; k < list.length; k++) if (alive[list[k]]) return true; return false; }

  // A tile is free when nothing lies on top of it and one of its two sides is open.
  function isFree(an, alive, i) {
    if (!alive[i] || anyAlive(an.covers[i], alive)) return false;
    return !anyAlive(an.lefts[i], alive) || !anyAlive(an.rights[i], alive);
  }
  function freeList(an, alive) {
    var out = [];
    for (var i = 0; i < an.n; i++) if (isFree(an, alive, i)) out.push(i);
    return out;
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }

  function allPairs() {
    var pairs = [], id;
    for (id = 0; id < FIRST_FLOWER; id++) { pairs.push([id, id]); pairs.push([id, id]); }
    pairs.push([34, 35], [36, 37], [38, 39], [40, 41]);
    return pairs;
  }

  // Deal by playing the game backwards: take two free tiles off, again and again, and hand the
  // pairs out in that order. Replaying the same order always clears the board.
  function deal(an, alive0, pairs, rng) {
    for (var attempt = 0; attempt < DEAL_ATTEMPTS; attempt++) {
      var alive = Uint8Array.from(alive0), order = [], ok = true, left = 0, i;
      for (i = 0; i < an.n; i++) if (alive[i]) left++;
      for (var step = 0; step < left / 2; step++) {
        var free = freeList(an, alive);
        if (free.length < 2) { ok = false; break; }
        var a = free.splice(Math.floor(rng() * free.length), 1)[0], b = free[Math.floor(rng() * free.length)];
        alive[a] = alive[b] = 0; order.push([a, b]);
      }
      if (!ok) continue;
      var faces = new Int8Array(an.n).fill(-1), ps = shuffle(pairs.slice(), rng);
      for (i = 0; i < order.length; i++) {
        var flip = rng() < 0.5, pr = ps[i];
        faces[order[i][0]] = flip ? pr[1] : pr[0]; faces[order[i][1]] = flip ? pr[0] : pr[1];
      }
      return { faces: faces, order: order };
    }
    return null;
  }

  // A fresh deal for a layout; a layout of fewer than 144 tiles takes a random share of the pairs.
  function dealLayout(layout, rng) {
    var tiles = tilesOf(layout), an = analyze(tiles), alive = new Uint8Array(an.n).fill(1);
    var pairs = shuffle(allPairs(), rng).slice(0, an.n / 2);
    var d = deal(an, alive, pairs, rng);
    return d && { tiles: tiles, an: an, faces: d.faces, order: d.order };
  }

  // Shuffle what is left: the same faces, dealt again so the rest can still be cleared.
  function reshuffle(an, alive, faces, rng) {
    var groups = {}, i;
    for (i = 0; i < an.n; i++) {
      if (!alive[i]) continue;
      var g = faces[i] >= FIRST_SEASON ? 'S' : faces[i] >= FIRST_FLOWER ? 'F' : String(faces[i]);
      (groups[g] = groups[g] || []).push(faces[i]);
    }
    var pairs = [];
    Object.keys(groups).forEach(function (g) { var list = groups[g]; for (var k = 0; k + 1 < list.length; k += 2) pairs.push([list[k], list[k + 1]]); });
    var d = deal(an, alive, pairs, rng);
    if (!d) return null;
    for (i = 0; i < an.n; i++) if (alive[i]) faces[i] = d.faces[i];
    return d;
  }

  // Any pair that can be taken off right now: [i, j], or null.
  function findPair(an, alive, faces) {
    var free = freeList(an, alive);
    for (var a = 0; a < free.length; a++) for (var b = a + 1; b < free.length; b++) if (matches(faces[free[a]], faces[free[b]])) return [free[a], free[b]];
    return null;
  }

  var Engine = { LAYOUTS: LAYOUTS, FACES: FACES, matches: matches, tilesOf: tilesOf, analyze: analyze, isFree: isFree, freeList: freeList, allPairs: allPairs, deal: deal, dealLayout: dealLayout, reshuffle: reshuffle, findPair: findPair, shuffle: shuffle };
  root.MahjongEngine = Engine;

  // ── the page ─────────────────────────────────────────────────────────────
  if (typeof document === 'undefined') return;
  var BK = root.BoardKit, $ = function (id) { return document.getElementById(id); };
  var SETTINGS_KEY = 'mahjong.settings', STATS_KEY = 'mahjong.stats';
  var settings = BK.load(SETTINGS_KEY, {});
  if (!LAYOUTS.some(function (l) { return l.id === settings.layout; })) settings.layout = 'turtle';
  var stats = BK.load(STATS_KEY, {});
  var MIN_UNIT = 8, MAX_UNIT = 28, ZOOM_UNIT = 16, ROW_RATIO = 1.34, LAYER_SHIFT = 0.3, MIN_SHIFT_PX = 3, SIDE_PAD_PX = 6, REMOVE_MS = 260;
  var NAMES = ['circles', 'bamboo', 'characters'];
  var WIND = ['East', 'South', 'West', 'North'], DRAGON = ['Red dragon', 'Green dragon', 'White dragon'];
  var FLOWER = ['Plum', 'Orchid', 'Chrysanthemum', 'Bamboo flower'], SEASON = ['Spring', 'Summer', 'Autumn', 'Winter'];

  function faceName(f) {
    if (f < 27) return (f % 9 + 1) + ' of ' + NAMES[(f / 9) | 0];
    if (f < 31) return WIND[f - 27] + ' wind';
    if (f < 34) return DRAGON[f - 31];
    return f < FIRST_SEASON ? FLOWER[f - FIRST_FLOWER] : SEASON[f - FIRST_SEASON];
  }

  // ── tile faces, drawn here (no fonts beyond the system's Latin) ──
  var INK = { 0: '#1565c0', 1: '#2e7d32', 2: '#c62828' };
  function num(n, color) { return '<text x="20" y="29" text-anchor="middle" font-size="27" font-weight="800" font-family="Georgia,\'Times New Roman\',serif" fill="' + color + '">' + n + '</text>'; }
  function ring(cx, cy, r, color) { return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="2.6"/><circle cx="' + cx + '" cy="' + cy + '" r="' + (r / 2.6).toFixed(1) + '" fill="' + color + '"/>'; }
  function faceMarkup(f) {
    var s, c;
    if (f < 27) {
      var suit = (f / 9) | 0, n = f % 9 + 1; c = INK[suit];
      s = num(n, c);
      if (suit === 0) s += ring(20, 42, 5.6, c);
      else if (suit === 1) s += '<g stroke="' + c + '" stroke-width="2.4" stroke-linecap="round"><path d="M16 36v13M24 36v13" fill="none"/><path d="M14 41h4M22 41h4M14 46h4M22 46h4" stroke-width="1.6"/></g>';
      else s += '<path d="M12 38h16M20 35v14M13 45h14" stroke="' + c + '" stroke-width="3.4" stroke-linecap="round" fill="none"/>';
    } else if (f < 31) {
      s = '<text x="20" y="35" text-anchor="middle" font-size="31" font-weight="800" font-family="Georgia,serif" fill="#1a237e">' + 'ESWN'[f - 27] + '</text>';
      s += '<path d="M9 12h22" stroke="#1a237e" stroke-width="2.4" stroke-linecap="round"/>';
    } else if (f === 31) {
      s = '<path d="M20 8l13 18-13 18-13-18z" fill="#c62828"/><path d="M20 17l6 9-6 9-6-9z" fill="#f7f2e4"/>';
    } else if (f === 32) {
      s = '<path d="M10 40C8 22 20 10 32 11 33 24 26 38 10 40z" fill="#2e7d32"/><path d="M12 38C18 28 24 20 29 14" stroke="#f7f2e4" stroke-width="2" fill="none"/>';
    } else if (f === 33) {
      s = '<rect x="9" y="10" width="22" height="32" rx="3" fill="none" stroke="#1565c0" stroke-width="3.2"/><rect x="14" y="15" width="12" height="22" rx="1.5" fill="none" stroke="#1565c0" stroke-width="1.6"/>';
    } else if (f < FIRST_SEASON) {
      var k = f - FIRST_FLOWER, col = ['#d81b60', '#8e24aa', '#f9a825', '#43a047'][k];
      s = '';
      for (var p = 0; p < 5; p++) { var a = p * 1.2566 - 1.5708; s += '<circle cx="' + (20 + 8.5 * Math.cos(a)).toFixed(1) + '" cy="' + (24 + 8.5 * Math.sin(a)).toFixed(1) + '" r="6.2" fill="' + col + '"/>'; }
      s += '<circle cx="20" cy="24" r="4.2" fill="#fff3c4" stroke="' + col + '" stroke-width="1.2"/><text x="20" y="49" text-anchor="middle" font-size="11" font-weight="800" font-family="Georgia,serif" fill="' + col + '">' + (k + 1) + '</text>';
    } else {
      var q = f - FIRST_SEASON, sc = ['#2e7d32', '#e65100', '#8d6e63', '#0277bd'][q];
      s = '<circle cx="20" cy="24" r="14" fill="' + sc + '"/><text x="20" y="30" text-anchor="middle" font-size="16" font-weight="800" font-family="system-ui,Arial,sans-serif" fill="#fff">' + ['Sp', 'Su', 'Au', 'Wi'][q] + '</text><text x="20" y="49" text-anchor="middle" font-size="11" font-weight="800" font-family="Georgia,serif" fill="' + sc + '">' + (q + 1) + '</text>';
    }
    return '<svg viewBox="0 0 40 52" aria-hidden="true">' + s + '</svg>';
  }

  var els = { stage: $('mj-stage'), scroll: $('mj-scroll'), status: $('mj-status'), time: $('mj-time'), undo: $('mj-undo'), hint: $('mj-hint'), shuffle: $('mj-shuffle'), zoom: $('mj-zoom'), left: $('mj-left'), stats: $('mj-stats') };
  var deal0, an, faces, alive, buttons = [], removed = [], selected = -1, hintPair = null, seconds = 0, timer = 0, started = false, won = false, zoomed = false, rng = Math.random, layout;

  function updateTimeText() { els.time.textContent = BK.fmtTime(seconds); }
  function stopTimer() { clearInterval(timer); timer = 0; }
  function startTimer() { if (!timer) timer = setInterval(function () { seconds++; updateTimeText(); }, 1000); }

  var CHROME_PX = 260;
  // The size of one half-tile so the layout fits the room, and the layout's own bounds.
  function chooseUnit() {
    var g = { minX: Infinity, minY: Infinity, maxX: 0, maxY: 0 };
    an.tiles.forEach(function (t) { g.minX = Math.min(g.minX, t.x); g.minY = Math.min(g.minY, t.y); g.maxX = Math.max(g.maxX, t.x + 2); g.maxY = Math.max(g.maxY, t.y + 2); });
    var room = Math.min(root.innerWidth, 1100) - 24, fit = Math.floor((room - SIDE_PAD_PX) / (g.maxX - g.minX + 1));
    // On a short screen the layout also has to fit the height (the bar, status, buttons and notes take CHROME_PX).
    var fitH = Math.floor((root.innerHeight - CHROME_PX - SIDE_PAD_PX) / ((g.maxY - g.minY) * ROW_RATIO + 1));
    g.u = Math.max(MIN_UNIT, Math.min(MAX_UNIT, fit, fitH));
    if (zoomed) g.u = Math.max(g.u, ZOOM_UNIT);
    return g;
  }

  function layoutStage() {
    var g = chooseUnit(), u = g.u, v = u * ROW_RATIO, shift = Math.max(MIN_SHIFT_PX, u * LAYER_SHIFT), maxL = layout.layers.length - 1;
    els.stage.style.width = Math.ceil((g.maxX - g.minX) * u + maxL * shift + SIDE_PAD_PX) + 'px';
    els.stage.style.height = Math.ceil((g.maxY - g.minY) * v + maxL * shift + SIDE_PAD_PX) + 'px';
    an.tiles.forEach(function (t, i) {
      var b = buttons[i];
      b.style.left = ((t.x - g.minX) * u - t.l * shift + maxL * shift) + 'px';
      b.style.top = ((t.y - g.minY) * v - t.l * shift + maxL * shift) + 'px';
      b.style.width = (2 * u) + 'px'; b.style.height = (2 * v) + 'px';
      b.style.zIndex = String(t.l * 100 + (t.y >> 1) * 2 + 1);
    });
  }

  function buildTiles() {
    els.stage.textContent = '';
    buttons = an.tiles.map(function (t, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'mj-t'; b.dataset.i = i; b.tabIndex = -1;
      b.innerHTML = faceMarkup(faces[i]);
      b.setAttribute('aria-label', faceName(faces[i]));
      b.addEventListener('click', function () { onTile(i); });
      b.addEventListener('focus', function () { setTabStop(i); });
      els.stage.appendChild(b);
      return b;
    });
    var first = 0;
    for (var i = 0; i < an.n; i++) if (alive[i]) { first = i; break; }
    buttons[first].tabIndex = 0;
  }
  var tabStop = -1;
  function setTabStop(i) { if (tabStop >= 0 && buttons[tabStop]) buttons[tabStop].tabIndex = -1; tabStop = i; buttons[i].tabIndex = 0; }

  function remainingCount() { var n = 0; for (var i = 0; i < an.n; i++) if (alive[i]) n++; return n; }

  function paint() {
    var free = freeList(an, alive), isFreeArr = {}, i;
    free.forEach(function (f) { isFreeArr[f] = 1; });
    for (i = 0; i < an.n; i++) {
      var b = buttons[i];
      if (!alive[i]) { b.hidden = !b.classList.contains('going'); continue; }
      b.hidden = false;
      b.className = 'mj-t' + (isFreeArr[i] ? '' : ' blocked') + (i === selected ? ' sel' : '') + (hintPair && (i === hintPair[0] || i === hintPair[1]) ? ' hint' : '');
      b.setAttribute('aria-disabled', isFreeArr[i] ? 'false' : 'true');
    }
    els.left.textContent = remainingCount();
    els.undo.disabled = !removed.length || won;
    var moves = findPair(an, alive, faces);
    els.shuffle.classList.toggle('pulse', !moves && !won);
    els.hint.disabled = won; els.shuffle.disabled = won;
    if (tabStop < 0 || !alive[tabStop]) for (i = 0; i < an.n; i++) if (alive[i]) { setTabStop(i); break; }
    return !!moves;
  }

  function say(t) { els.status.textContent = t; }
  function showStats() {
    var s = stats[layout.id] || { won: 0, best: 0 };
    els.stats.textContent = layout.name + ': ' + s.won + ' won' + (s.best ? ', best ' + BK.fmtTime(s.best) : '');
  }

  function afterChange() {
    var hasMoves = paint();
    if (!remainingCount()) { win(); return; }
    say(hasMoves ? 'Match two free tiles.' : 'No moves left. Shuffle, or undo.');
  }

  function win() {
    if (won) return; // two quick last pairs each ask
    won = true; stopTimer();
    var s = stats[layout.id] = stats[layout.id] || { won: 0, best: 0 };
    s.won++;
    var record = !s.best || seconds < s.best;
    if (record) s.best = seconds;
    BK.save(STATS_KEY, stats);
    say('Cleared.'); showStats(); paint();
    $('mj-result-text').textContent = 'Board cleared in ' + BK.fmtTime(seconds) + (record ? ', your best on ' + layout.name + '.' : '.');
    resultSheet.open($('mj-again'));
  }

  function removePair(a, c) {
    alive[a] = alive[c] = 0; removed.push([a, c]);
    selected = -1; hintPair = null;
    var done = function () { buttons[a].classList.remove('going'); buttons[c].classList.remove('going'); afterChange(); };
    if (BK.reducedMotion()) { done(); return; }
    buttons[a].classList.add('going'); buttons[c].classList.add('going');
    setTimeout(done, REMOVE_MS);
  }

  function onTile(i) {
    if (won || !alive[i]) return;
    if (!isFree(an, alive, i)) {
      buttons[i].classList.add('shake'); setTimeout(function () { buttons[i].classList.remove('shake'); }, 320);
      say('That tile is blocked: it needs a free side and nothing on top.');
      return;
    }
    if (!started) { started = true; startTimer(); }
    if (selected === i) { selected = -1; hintPair = null; paint(); return; }
    if (selected >= 0 && matches(faces[selected], faces[i])) { removePair(selected, i); return; }
    selected = i; hintPair = null; paint();
    say(faceName(faces[i]) + ' selected.');
  }

  function undo() {
    if (!removed.length || won) return;
    var p = removed.pop();
    alive[p[0]] = alive[p[1]] = 1; selected = -1; hintPair = null;
    afterChange();
  }
  function hint() {
    var p = findPair(an, alive, faces);
    if (!p) { say('No moves left. Shuffle, or undo.'); return; }
    hintPair = p; selected = -1; paint(); say('These two match.');
  }
  function doShuffle() {
    if (won) return;
    var d = reshuffle(an, alive, faces, rng);
    if (!d) { say('Could not shuffle this position.'); return; }
    for (var i = 0; i < an.n; i++) if (alive[i]) { buttons[i].innerHTML = faceMarkup(faces[i]); buttons[i].setAttribute('aria-label', faceName(faces[i])); }
    selected = -1; hintPair = null; removed = []; // an undone step could bring back tiles the new deal does not account for
    afterChange(); say('Shuffled. The rest can still be cleared.');
  }

  function newGame() {
    stopTimer(); seconds = 0; started = false; won = false; selected = -1; hintPair = null; removed = [];
    layout = LAYOUTS.filter(function (l) { return l.id === settings.layout; })[0];
    deal0 = dealLayout(layout, rng);
    an = deal0.an; faces = deal0.faces; alive = new Uint8Array(an.n).fill(1);
    tabStop = -1;
    buildTiles(); layoutStage(); updateTimeText(); showStats(); resultSheet.close();
    afterChange(); say('Match two free tiles. Dim tiles are blocked.');
  }

  // ── bar, menu, keys ──
  var menu = BK.sheet($('mj-sheet')), resultSheet = BK.sheet($('mj-result'));
  $('mj-new').addEventListener('click', function () { BK.chipSet($('mj-f-layout'), settings.layout); menu.open(); });
  $('mj-cancel').addEventListener('click', menu.close);
  $('mj-start').addEventListener('click', function () { settings.layout = BK.chipValue($('mj-f-layout')); BK.save(SETTINGS_KEY, settings); menu.close(); newGame(); });
  $('mj-again').addEventListener('click', newGame);
  $('mj-close').addEventListener('click', function () { resultSheet.close(); });
  els.undo.addEventListener('click', undo);
  els.hint.addEventListener('click', hint);
  els.shuffle.addEventListener('click', doShuffle);
  els.zoom.addEventListener('click', function () { zoomed = !zoomed; els.zoom.setAttribute('aria-pressed', String(zoomed)); els.scroll.classList.toggle('zoomed', zoomed); layoutStage(); });
  root.addEventListener('resize', function () { if (an) layoutStage(); });

  // arrow keys: focus the nearest tile in that direction
  var DIRECTION = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  els.stage.addEventListener('keydown', function (e) {
    var d = DIRECTION[e.key], cur = +(e.target.dataset && e.target.dataset.i);
    if (!d || isNaN(cur)) return;
    e.preventDefault();
    var t = an.tiles[cur], best = -1, bestScore = Infinity;
    for (var i = 0; i < an.n; i++) {
      if (!alive[i] || i === cur) continue;
      var dx = an.tiles[i].x - t.x, dy = an.tiles[i].y - t.y, along = dx * d[0] + dy * d[1], across = Math.abs(dx * d[1] + dy * d[0]);
      if (along <= 0.5) continue;
      var score = along + 2.5 * across - an.tiles[i].l * 0.1;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0) buttons[best].focus();
  });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input')) return;
    var k = e.key.toLowerCase();
    if (k === 'u') undo(); else if (k === 'h') hint(); else if (k === 's') doShuffle(); else if (k === 'n') { BK.chipSet($('mj-f-layout'), settings.layout); menu.open(); }
    else if (e.key === 'Escape' && selected >= 0) { selected = -1; paint(); }
  });

  newGame();

  if (new URLSearchParams(location.search).has('debug')) {
    root.__mj = { engine: Engine, state: function () { return { an: an, alive: alive, faces: faces, order: deal0.order }; }, click: onTile };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
