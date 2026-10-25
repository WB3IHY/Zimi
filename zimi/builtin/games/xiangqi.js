/* ZimiGames: Xiangqi, the page. The rules and the searcher are in xiangqi-engine.js.
   The computer thinks in a Web Worker built from the engine's own source (no second file to fetch);
   if Workers are unavailable it thinks on the main thread for a short while. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined' || !root.ZimiXiangqiEngine) return;
  var E = root.ZimiXiangqiEngine(), F = root.ZimiFairy, BK = root.BoardKit, $ = function (id) { return document.getElementById(id); };
  var RED = E.RED, BLACK = E.BLACK, COLS = E.COLS, ROWS = E.ROWS, N = COLS * ROWS;
  var SETTINGS_KEY = 'xiangqi.settings', STATS_KEY = 'xiangqi.stats';
  var FALLBACK_MS = 250, FALLBACK_DEPTH = 3, WORKER_GRACE_MS = 5000, COMPUTER_DELAY_MS = 250;
  var OLD_NAMES = { strong: 'advanced' };   // the chip that used to be called Strong
  var NAMES = { 1: 'soldier', 2: 'cannon', 3: 'rook', 4: 'horse', 5: 'elephant', 6: 'advisor', 7: 'general' };
  var HAN = { 1: { r: '兵', b: '卒' }, 2: { r: '炮', b: '砲' }, 3: { r: '俥', b: '車' }, 4: { r: '傌', b: '馬' }, 5: { r: '相', b: '象' }, 6: { r: '仕', b: '士' }, 7: { r: '帥', b: '將' } };
  var LATIN = { 1: 'P', 2: 'C', 3: 'R', 4: 'H', 5: 'E', 6: 'A', 7: 'K' };

  var settings = BK.load(SETTINGS_KEY, {});
  if (!E.LEVELS[settings.level] && !F.wants(settings.level)) settings.level = 'club';
  if (settings.mode !== 'two') settings.mode = 'cpu';
  if (settings.side !== 'black') settings.side = 'red';
  if (settings.hints !== false) settings.hints = true;
  if (settings.labels !== 'latin') settings.labels = 'han';
  var stats = BK.load(STATS_KEY, {});

  var els = { board: $('xq-board'), grid: $('xq-grid'), status: $('xq-status'), undo: $('xq-undo'), moves: $('xq-moves'), stats: $('xq-stats'), flip: $('xq-flip') };
  var cells = [], pos, keys, sans, played, over, sel = -1, targets = {}, lastMove = 0, flipped = false, requestId = 0, thinking = false;
  var worker = null, workerOk = true, watchdog = 0;

  // The level our own engine plays at: the one chosen, or its best when Strong or Master were chosen and Fairy-Stockfish is not there.
  function engineLevel() { return F.wants(settings.level) ? 'strong' : settings.level; }
  function human(color) { return settings.mode === 'two' || color === (settings.side === 'red' ? RED : BLACK); }
  function colorName(c) { return c === RED ? 'Red' : 'Black'; }

  // ── drawing ──
  function drawLines() {
    var h = '', i, ns = 'http://www.w3.org/2000/svg';
    function line(x1, y1, x2, y2, cls) { h += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"' + (cls ? ' class="' + cls + '"' : '') + '/>'; }
    for (i = 0; i < ROWS; i++) line(0.5, i + 0.5, COLS - 0.5, i + 0.5);
    line(0.5, 0.5, 0.5, ROWS - 0.5); line(COLS - 0.5, 0.5, COLS - 0.5, ROWS - 0.5);
    for (i = 1; i < COLS - 1; i++) { line(i + 0.5, 0.5, i + 0.5, 4.5); line(i + 0.5, 5.5, i + 0.5, ROWS - 0.5); }
    [[0.5, 3.5], [7.5, 3.5]].forEach(function (p) { line(p[1], p[0], p[1] + 2, p[0] + 2); line(p[1] + 2, p[0], p[1], p[0] + 2); });
    // the little ticks that mark the soldiers' and cannons' points
    var marks = [[2, 1], [2, 7], [3, 0], [3, 2], [3, 4], [3, 6], [3, 8], [6, 0], [6, 2], [6, 4], [6, 6], [6, 8], [7, 1], [7, 7]];
    marks.forEach(function (m) {
      var x = m[1] + 0.5, y = m[0] + 0.5, a = 0.09, b = 0.22;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (d) {
        if ((m[1] === 0 && d[0] < 0) || (m[1] === COLS - 1 && d[0] > 0)) return;
        line(x + d[0] * a, y + d[1] * a, x + d[0] * a, y + d[1] * b, 'mark'); line(x + d[0] * a, y + d[1] * a, x + d[0] * b, y + d[1] * a, 'mark');
      });
    });
    h += '<rect class="fat" x="0.5" y="0.5" width="8" height="9"/>';
    $('xq-lines').innerHTML = h;
  }

  function buildBoard() {
    els.grid.textContent = '';
    cells = [];
    for (var d = 0; d < N; d++) {
      var c = document.createElement('button');
      c.type = 'button'; c.className = 'xq-pt'; c.dataset.d = d;
      c.addEventListener('click', onSquare);
      els.grid.appendChild(c); cells.push(c);
    }
    navGrid();
  }
  // Arrow keys over the 9 x 10 points; one point is the tab stop.
  function navGrid() {
    var cur = 0, ARROWS = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    function mark(i) { cells[cur].tabIndex = -1; cur = i; cells[cur].tabIndex = 0; }
    cells.forEach(function (c, i) { c.tabIndex = i ? -1 : 0; c.addEventListener('focus', function () { mark(i); }); });
    els.grid.addEventListener('keydown', function (e) {
      var d = ARROWS[e.key];
      if (!d || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      var r = Math.min(ROWS - 1, Math.max(0, Math.floor(cur / COLS) + d[0])), c = Math.min(COLS - 1, Math.max(0, (cur % COLS) + d[1]));
      cells[r * COLS + c].focus();
    });
  }
  function sqAt(d) { return flipped ? N - 1 - d : d; }

  function pieceHtml(v) {
    var t = Math.abs(v), red = v > 0, latin = settings.labels === 'latin';
    return '<span class="xq-pc ' + (red ? 'r' : 'b') + (latin ? ' latin' : '') + '"><span>' + (latin ? LATIN[t] : HAN[t][red ? 'r' : 'b']) + '</span></span>';
  }

  function paint() {
    var kingSq = E.inCheck(pos, pos.turn) ? pos.king[pos.turn === RED ? 0 : 1] : -1;
    for (var d = 0; d < N; d++) {
      var s = sqAt(d), c = cells[d], v = pos.sq[s], cls = 'xq-pt';
      if (lastMove && (s === E.from(lastMove) || s === E.to(lastMove))) cls += ' last';
      if (s === sel) cls += ' sel';
      if (s === kingSq) cls += ' bad';
      if (settings.hints && targets.hasOwnProperty(s)) cls += ' hint' + (v ? ' cap' : '');
      c.className = cls;
      var html = v ? pieceHtml(v) : '';
      if (c.dataset.sig !== html) { c.innerHTML = html; c.dataset.sig = html; }
      c.setAttribute('aria-label', E.squareName(s) + ', ' + (v ? (v > 0 ? 'red ' : 'black ') + NAMES[Math.abs(v)] : targets.hasOwnProperty(s) ? 'move here' : 'empty') + (s === sel ? ', selected' : ''));
    }
    els.undo.disabled = !played.length || thinking;
    els.flip.setAttribute('aria-pressed', String(flipped !== (settings.mode === 'cpu' && settings.side === 'black')));
  }

  function say(text, busy) {
    els.status.textContent = '';
    if (busy) { var s = document.createElement('span'); s.className = 'bg-spin'; els.status.appendChild(s); }
    var dot = document.createElement('i');
    dot.className = 'bg-dot ' + (pos.turn === RED ? 'r' : 'k'); dot.setAttribute('aria-hidden', 'true');
    if (!over) els.status.appendChild(dot);
    els.status.appendChild(document.createTextNode(text));
  }
  function showStats() {
    var s = stats[settings.level] || { w: 0, l: 0, d: 0 };
    els.stats.textContent = settings.mode === 'cpu' ? 'vs ' + F.levelName(settings.level, OLD_NAMES) + ': ' + s.w + ' won, ' + s.l + ' lost, ' + s.d + ' drawn' : 'Two players on this device';
  }
  function paintMoves() {
    var html = '';
    for (var i = 0; i < sans.length; i++) {
      if (i % 2 === 0) html += '<span class="xq-n">' + (i / 2 + 1) + '.</span>';
      html += '<span class="xq-m' + (i === sans.length - 1 ? ' now' : '') + '">' + sans[i] + '</span>';
    }
    els.moves.innerHTML = html || '<span class="xq-none">No moves yet</span>';
    els.moves.scrollTop = els.moves.scrollHeight;
  }

  // ── turns ──
  var WHY = { repetition: 'A draw: the same position came up three times.', sixty: 'A draw: sixty moves each without a capture.' };
  function finish(st) {
    over = true; thinking = false; sel = -1; targets = {};
    var msg, result;
    if (st.result === 'mate') {
      msg = (st.check ? 'Checkmate. ' : 'No legal move, which loses in xiangqi. ') + (settings.mode === 'two' ? colorName(st.winner) + ' wins.' : human(st.winner) ? 'You win.' : 'The computer wins.');
      result = human(st.winner) ? 'win' : 'loss';
    } else { msg = WHY[st.result]; result = 'draw'; }
    if (settings.mode === 'cpu') {
      var s = stats[settings.level] = stats[settings.level] || { w: 0, l: 0, d: 0 };
      if (result === 'win') s.w++; else if (result === 'loss') s.l++; else s.d++;
      BK.save(STATS_KEY, stats);
    }
    paint(); say(msg); showStats();
    $('xq-result-text').textContent = msg;
    resultSheet.open($('xq-again'));
  }

  function afterMove() {
    sel = -1; targets = {};
    var st = E.status(pos, keys);
    paintMoves();
    if (st.over) { finish(st); return; }
    paint();
    var line = settings.mode === 'two' ? colorName(pos.turn) + ' to move' : human(pos.turn) ? 'Your turn' : 'Computer is thinking';
    say((st.check ? 'Check. ' : '') + line, !human(pos.turn));
    if (!human(pos.turn)) askComputer();
  }

  function play(m) {
    sans.push(E.san(pos, m)); played.push(m);
    E.make(pos, m); keys.push(E.key(pos)); lastMove = m;
    afterMove();
  }

  function seenCounts() {
    var seen = {};
    keys.forEach(function (k) { seen[k] = (seen[k] || 0) + 1; });
    return seen;
  }

  // ── the computer: a worker if there is one, the main thread if there is not ──
  function makeWorker() {
    if (worker || !workerOk) return worker;
    try {
      var src = 'var E=(' + root.ZimiXiangqiEngine.toString() + ')();onmessage=function(e){var d=e.data,r=E.think(d.fen,{level:d.level,seen:d.seen});postMessage({id:d.id,move:r.move,depth:r.depth});};';
      var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = function (e) { onAnswer(e.data.id, e.data.move); };
      worker.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); dropWorker(); thinkHere(requestId); };
    } catch (err) { workerOk = false; worker = null; }
    return worker;
  }
  function dropWorker() { workerOk = false; if (worker) { try { worker.terminate(); } catch (e) { /* gone already */ } } worker = null; }

  function onAnswer(id, move) {
    if (id !== requestId || !thinking) return;
    clearTimeout(watchdog);
    thinking = false;
    if (move) play(move); else afterMove();
  }
  function thinkHere(id) {
    setTimeout(function () {
      if (id !== requestId || !thinking) return;
      var r = E.think(pos, { level: engineLevel(), ms: FALLBACK_MS, depth: FALLBACK_DEPTH, seen: seenCounts() });
      onAnswer(id, r.move);
    }, 30);
  }
  function askLocal(id) {
    var w = makeWorker();
    if (!w) { thinkHere(id); return; }
    w.postMessage({ id: id, fen: E.toFen(pos), level: engineLevel(), seen: seenCounts() });
    watchdog = setTimeout(function () { if (id === requestId && thinking) { dropWorker(); thinkHere(id); } }, E.LEVELS[engineLevel()].ms + WORKER_GRACE_MS);
  }

  // Strong and Master: Fairy-Stockfish in its own Worker, started by the first move that needs it. If it cannot start,
  // say so once and play on with our own best level (engineLevel).
  function askFairy(id) {
    F.ask('xiangqi', E, pos, played, settings.level, function (move, why) {
      if (id !== requestId || !thinking) return;
      if (move) { onAnswer(id, move); return; }
      var note = why === 'unavailable' ? F.note() : '';
      if (note) say(note + 'Computer is thinking', true);
      askLocal(id);
    });
  }

  function askComputer() {
    var id = ++requestId; thinking = true;
    paint();
    setTimeout(function () {
      if (id !== requestId || !thinking) return;
      if (F.wants(settings.level)) askFairy(id); else askLocal(id);
    }, COMPUTER_DELAY_MS);
  }

  // ── input ──
  function movesFrom(s) {
    var out = {};
    E.legalMoves(pos).forEach(function (m) { if (E.from(m) === s) out[E.to(m)] = true; });
    return out;
  }
  function onSquare(e) {
    if (over || thinking || !human(pos.turn)) return;
    var s = sqAt(+e.currentTarget.dataset.d), v = pos.sq[s];
    if (sel >= 0 && targets.hasOwnProperty(s)) { play(E.findMove(pos, sel, s)); return; }
    if (v * pos.turn > 0 && s !== sel) {
      sel = s; targets = movesFrom(s);
      if (!Object.keys(targets).length) say('That piece cannot move');
      else say(settings.mode === 'two' ? colorName(pos.turn) + ' to move' : 'Choose where to move');
    } else { sel = -1; targets = {}; }
    paint();
  }

  function undo() {
    if (!played.length || thinking) return;
    over = false; requestId++;
    do {
      E.unmake(pos); played.pop(); sans.pop(); keys.pop();
    } while (played.length && settings.mode === 'cpu' && !human(pos.turn));
    lastMove = played[played.length - 1] || 0;
    afterMove();
  }

  function newGame() {
    requestId++; thinking = false; over = false; sel = -1; targets = {}; lastMove = 0; clearTimeout(watchdog); F.cancel();
    pos = E.startPosition(); keys = [E.key(pos)]; sans = []; played = [];
    flipped = settings.mode === 'cpu' && settings.side === 'black';
    resultSheet.close();
    showStats(); paintMoves(); paint();
    afterMove();
  }

  // ── bar, menu, keys ──
  var menu = BK.sheet($('xq-sheet')), resultSheet = BK.sheet($('xq-result'));
  function syncMenu() {
    BK.chipSet($('xq-f-mode'), settings.mode); BK.chipSet($('xq-f-level'), settings.level);
    BK.chipSet($('xq-f-side'), settings.side); BK.chipSet($('xq-f-labels'), settings.labels); $('xq-hints').checked = settings.hints;
    refreshMenu();
  }
  function refreshMenu() {
    var two = BK.chipValue($('xq-f-mode')) === 'two';
    $('xq-f-level').disabled = two; $('xq-f-side').disabled = two;
    $('xq-f-level').style.opacity = $('xq-f-side').style.opacity = two ? 0.45 : 1;
  }
  $('xq-new').addEventListener('click', function () { syncMenu(); menu.open(); });
  $('xq-f-mode').addEventListener('change', refreshMenu);
  $('xq-cancel').addEventListener('click', menu.close);
  $('xq-start').addEventListener('click', function () {
    settings.mode = BK.chipValue($('xq-f-mode')); settings.level = BK.chipValue($('xq-f-level'));
    settings.side = BK.chipValue($('xq-f-side')); settings.labels = BK.chipValue($('xq-f-labels')); settings.hints = $('xq-hints').checked;
    BK.save(SETTINGS_KEY, settings);
    menu.close(); newGame();
  });
  $('xq-again').addEventListener('click', newGame);
  $('xq-close').addEventListener('click', function () { resultSheet.close(); });
  els.undo.addEventListener('click', undo);
  els.flip.addEventListener('click', function () { flipped = !flipped; paint(); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input')) return;
    var k = e.key.toLowerCase();
    if (k === 'n') { syncMenu(); menu.open(); } else if (k === 'u') undo(); else if (k === 'f') { flipped = !flipped; paint(); }
    else if (e.key === 'Escape' && sel >= 0) { sel = -1; targets = {}; paint(); }
  });

  drawLines(); buildBoard();
  pos = E.startPosition();
  newGame();

  if (new URLSearchParams(location.search).has('debug')) {
    root.__xq = { engine: E, pos: function () { return pos; }, settings: settings, play: play,
      setFen: function (fen) { pos = E.parseFen(fen); keys = [E.key(pos)]; sans = []; played = []; lastMove = 0; over = false; afterMove(); }, usingWorker: function () { return !!worker; }, noWorker: function () { dropWorker(); } };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
