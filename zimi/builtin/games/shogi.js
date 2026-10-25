/* ZimiGames: Shogi and Minishogi, the page. The rules and the searcher are in shogi-engine.js.
   The computer thinks in a Web Worker built from the engine's own source; if Workers are
   unavailable it thinks on the main thread for a short while. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined' || !root.ZimiShogiEngine) return;
  var F = root.ZimiFairy, BK = root.BoardKit, $ = function (id) { return document.getElementById(id); };
  var SETTINGS_KEY = 'shogi.settings', STATS_KEY = 'shogi.stats';
  var FALLBACK_MS = 250, FALLBACK_DEPTH = 2, WORKER_GRACE_MS = 5000, COMPUTER_DELAY_MS = 250;
  var OLD_NAMES = { strong: 'advanced' };   // the chip that used to be called Strong
  var NAMES = { 1: 'pawn', 2: 'lance', 3: 'knight', 4: 'silver', 5: 'gold', 6: 'bishop', 7: 'rook', 8: 'king', 9: 'tokin', 10: 'promoted lance', 11: 'promoted knight', 12: 'promoted silver', 14: 'horse', 15: 'dragon' };
  var KANJI = { 1: '歩', 2: '香', 3: '桂', 4: '銀', 5: '金', 6: '角', 7: '飛', 8: '玉', 9: 'と', 10: '杏', 11: '圭', 12: '全', 14: '馬', 15: '龍' };
  var LATIN = { 1: 'P', 2: 'L', 3: 'N', 4: 'S', 5: 'G', 6: 'B', 7: 'R', 8: 'K', 9: '+P', 10: '+L', 11: '+N', 12: '+S', 14: '+B', 15: '+R' };
  var HAND_ORDER = [7, 6, 5, 4, 3, 2, 1];
  var PIECE_PATH = '20,2 33,9 37,42 3,42 7,9';

  var settings = BK.load(SETTINGS_KEY, {});
  var E = null, SIZE = 9, SENTE = 1, GOTE = -1, PROMOTED = 8;
  var stats = BK.load(STATS_KEY, {});

  var els = { board: $('sg-board'), status: $('sg-status'), undo: $('sg-undo'), moves: $('sg-moves'), stats: $('sg-stats'), flip: $('sg-flip') };
  var cells = [], pos, keys, sans, played, over, sel = -1, selDrop = 0, targets = {}, lastMove = 0, flipped = false, requestId = 0, thinking = false;
  var worker = null, workerOk = true, watchdog = 0, pendingPromo = null;

  // The level our own engine plays at: the one chosen, or its best when Strong or Master were chosen and Fairy-Stockfish is not there.
  function engineLevel() { return F.wants(settings.level) ? 'strong' : settings.level; }
  function fairyGame() { return settings.variant === 'mini' ? 'minishogi' : 'shogi'; }
  function human(color) { return settings.mode === 'two' || color === (settings.side === 'sente' ? SENTE : GOTE); }
  function colorName(c) { return c === SENTE ? 'Sente' : 'Gote'; }
  function bottomColor() { return flipped ? GOTE : SENTE; }
  function sqAt(d) { return flipped ? SIZE * SIZE - 1 - d : d; }

  // ── drawing ──
  function pieceSvg(t, color, upright) {
    var latin = settings.labels === 'latin', up = t > PROMOTED;
    var ch = latin ? LATIN[t] : (t === 8 && color === GOTE ? '王' : KANJI[t]);
    var cls = 'sg-pc' + (upright || color === bottomColor() ? '' : ' g') + (latin ? ' latin' : '') + (up ? ' up' : '');
    return '<svg class="' + cls + '" viewBox="0 0 40 44" aria-hidden="true"><polygon points="' + PIECE_PATH + '"/><text x="20" y="25"' + (latin && ch.length > 1 ? ' style="font-size:16px"' : '') + '>' + ch + '</text></svg>';
  }

  function buildBoard() {
    els.board.textContent = '';
    cells = [];
    els.board.style.gridTemplateColumns = els.board.style.gridTemplateRows = 'repeat(' + SIZE + ', 1fr)';
    for (var d = 0; d < SIZE * SIZE; d++) {
      var c = document.createElement('button');
      c.type = 'button'; c.dataset.d = d;
      c.addEventListener('click', onSquare);
      els.board.appendChild(c); cells.push(c);
    }
    BK.gridNav(els.board, cells, SIZE);
    var files = '', ranks = '';
    for (var i = 0; i < SIZE; i++) { files += '<span></span>'; ranks += '<span></span>'; }
    $('sg-files').innerHTML = files; $('sg-ranks').innerHTML = ranks;
    $('sg-files').style.gridTemplateColumns = 'repeat(' + SIZE + ', 1fr)';
    $('sg-ranks').style.gridTemplateRows = 'repeat(' + SIZE + ', 1fr)';
  }
  function paintLabels() {
    var f = $('sg-files').children, r = $('sg-ranks').children;
    for (var i = 0; i < SIZE; i++) {
      f[i].textContent = flipped ? i + 1 : SIZE - i;
      r[i].textContent = String.fromCharCode(97 + (flipped ? SIZE - 1 - i : i));
    }
  }

  function isStar(r, c) { return SIZE === 9 && (r === 2 || r === 5) && (c === 2 || c === 5); }
  function paint() {
    var kingSq = E.inCheck(pos, pos.turn) ? pos.king[pos.turn === SENTE ? 0 : 1] : -1;
    var lastTo = lastMove ? E.to(lastMove) : -1, lastFrom = lastMove && !E.isDrop(lastMove) ? E.from(lastMove) : -1;
    for (var d = 0; d < SIZE * SIZE; d++) {
      var s = sqAt(d), c = cells[d], v = pos.sq[s], r = (d / SIZE) | 0, col = d % SIZE;
      var cls = 'sg-sq' + (col === SIZE - 1 ? ' ec' : '') + (r === SIZE - 1 ? ' er' : '') + (isStar(r, col) ? ' star-br' : '');
      if (s === lastTo || s === lastFrom) cls += ' last';
      if (s === sel) cls += ' sel';
      if (s === kingSq) cls += ' bad';
      if (settings.hints && targets.hasOwnProperty(s)) cls += ' hint' + (v ? ' cap' : '');
      c.className = cls;
      var html = v ? pieceSvg(Math.abs(v), v > 0 ? SENTE : GOTE) : '';
      var sig = html + settings.labels + bottomColor();
      if (c.dataset.sig !== sig) { c.innerHTML = html; c.dataset.sig = sig; }
      c.setAttribute('aria-label', E.squareName(s) + ', ' + (v ? (v > 0 ? 'sente ' : 'gote ') + NAMES[Math.abs(v)] : targets.hasOwnProperty(s) ? 'move here' : 'empty') + (s === sel ? ', selected' : ''));
    }
    paintLabels();
    paintHands();
    els.undo.disabled = !played.length || thinking;
    els.flip.setAttribute('aria-pressed', String(flipped !== (settings.mode === 'cpu' && settings.side === 'gote')));
  }

  function paintHands() {
    var bottom = bottomColor();
    [['top', -bottom], ['bottom', bottom]].forEach(function (h) {
      var box = $('sg-hand-' + h[0]), color = h[1], side = color === SENTE ? 0 : 1, canUse = !over && !thinking && pos.turn === color && human(color);
      box.classList.toggle('active', canUse);
      var sig = '', html = '';
      HAND_ORDER.forEach(function (t) {
        if (E.DROPPABLE.indexOf(t) < 0) return;
        var n = pos.hand[side][t], picked = canUse && selDrop === t && n > 0;
        sig += t + ':' + n + (picked ? '*' : '') + (canUse ? 'u' : '');
        html += '<button type="button" class="sg-h' + (picked ? ' sel' : '') + '" data-t="' + t + '" data-c="' + color + '"' + (canUse && n ? '' : ' disabled') + ' aria-label="' + colorName(color) + ' hand, ' + NAMES[t] + ', ' + n + '">' + pieceSvg(t, color) + '<b>' + n + '</b></button>';
      });
      sig += settings.labels + bottom;
      if (box.dataset.sig !== sig) {
        box.innerHTML = html; box.dataset.sig = sig;
        Array.prototype.forEach.call(box.querySelectorAll('.sg-h'), function (b) { b.addEventListener('click', onHand); });
      }
    });
  }

  function say(text, busy) {
    els.status.textContent = '';
    if (busy) { var s = document.createElement('span'); s.className = 'bg-spin'; els.status.appendChild(s); }
    if (!over) { var dot = document.createElement('i'); dot.className = 'bg-dot ' + (pos.turn === SENTE ? 's' : 'go'); dot.setAttribute('aria-hidden', 'true'); els.status.appendChild(dot); }
    els.status.appendChild(document.createTextNode(text));
  }
  function showStats() {
    var s = stats[settings.variant + '.' + settings.level] || { w: 0, l: 0, d: 0 };
    els.stats.textContent = settings.mode === 'cpu' ? 'vs ' + F.levelName(settings.level, OLD_NAMES) + ': ' + s.w + ' won, ' + s.l + ' lost, ' + s.d + ' drawn' : 'Two players on this device';
  }
  function paintMoves() {
    var html = '';
    for (var i = 0; i < sans.length; i++) {
      if (i % 2 === 0) html += '<span class="sg-n">' + (i / 2 + 1) + '.</span>';
      html += '<span class="sg-m' + (i === sans.length - 1 ? ' now' : '') + '">' + sans[i] + '</span>';
    }
    els.moves.innerHTML = html || '<span class="sg-none">No moves yet</span>';
    els.moves.scrollTop = els.moves.scrollHeight;
  }

  // ── turns ──
  var WHY = { repetition: 'A draw: the same position came up four times.', long: 'A draw: the game has gone on too long.' };
  function finish(st) {
    over = true; thinking = false; sel = -1; selDrop = 0; targets = {};
    var msg, result;
    if (st.result === 'mate') {
      msg = 'Checkmate. ' + (settings.mode === 'two' ? colorName(st.winner) + ' wins.' : human(st.winner) ? 'You win.' : 'The computer wins.');
      result = human(st.winner) ? 'win' : 'loss';
    } else { msg = WHY[st.result]; result = 'draw'; }
    if (settings.mode === 'cpu') {
      var key = settings.variant + '.' + settings.level, s = stats[key] = stats[key] || { w: 0, l: 0, d: 0 };
      if (result === 'win') s.w++; else if (result === 'loss') s.l++; else s.d++;
      BK.save(STATS_KEY, stats);
    }
    paint(); say(msg); showStats();
    $('sg-result-text').textContent = msg;
    resultSheet.open($('sg-again'));
  }

  function afterMove() {
    sel = -1; selDrop = 0; targets = {};
    var st = E.status(pos, keys);
    paintMoves();
    if (st.over) { finish(st); return; }
    paint();
    var line = settings.mode === 'two' ? colorName(pos.turn) + ' to move' : human(pos.turn) ? 'Your move' : 'Computer is thinking';
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

  // ── the computer ──
  function makeWorker() {
    if (worker || !workerOk) return worker;
    try {
      var src = 'var E=(' + root.ZimiShogiEngine.toString() + ')(' + JSON.stringify(settings.variant) + ');onmessage=function(e){var d=e.data,r=E.think(d.sfen,{level:d.level,seen:d.seen});postMessage({id:d.id,move:r.move,depth:r.depth});};';
      var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = function (e) { onAnswer(e.data.id, e.data.move); };
      worker.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); dropWorker(); thinkHere(requestId); };
    } catch (err) { workerOk = false; worker = null; }
    return worker;
  }
  function dropWorker() { workerOk = false; killWorker(); }
  function killWorker() { if (worker) { try { worker.terminate(); } catch (e) { /* gone already */ } } worker = null; }

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
    w.postMessage({ id: id, sfen: E.toSfen(pos), level: engineLevel(), seen: seenCounts() });
    watchdog = setTimeout(function () { if (id === requestId && thinking) { dropWorker(); thinkHere(id); } }, E.LEVELS[engineLevel()].ms + WORKER_GRACE_MS);
  }

  // Strong and Master: Fairy-Stockfish in its own Worker, started by the first move that needs it. If it cannot start,
  // say so once and play on with our own best level (engineLevel).
  function askFairy(id) {
    F.ask(fairyGame(), E, pos, played, settings.level, function (move, why) {
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
  function targetsFor(match) {
    var out = {};
    E.legalMoves(pos).forEach(function (m) { if (match(m)) out[E.to(m)] = true; });
    return out;
  }
  function pick(s) { // a square was chosen as the destination
    var cands = E.legalMoves(pos).filter(function (m) {
      return E.to(m) === s && (selDrop ? E.isDrop(m) && E.from(m) === selDrop : !E.isDrop(m) && E.from(m) === sel);
    });
    if (cands.length > 1) { pendingPromo = cands; showPromo(cands); return; }
    play(cands[0]);
  }
  function onSquare(e) {
    if (over || thinking || !human(pos.turn)) return;
    var s = sqAt(+e.currentTarget.dataset.d), v = pos.sq[s];
    if ((sel >= 0 || selDrop) && targets.hasOwnProperty(s)) { pick(s); return; }
    selDrop = 0;
    if (v * pos.turn > 0 && s !== sel) {
      sel = s; targets = targetsFor(function (m) { return !E.isDrop(m) && E.from(m) === s; });
      if (!Object.keys(targets).length) say('That piece has no legal move');
      else say(settings.mode === 'two' ? colorName(pos.turn) + ' to move' : 'Choose where to move');
    } else { sel = -1; targets = {}; }
    paint();
  }
  function onHand(e) {
    if (over || thinking || !human(pos.turn)) return;
    var t = +e.currentTarget.dataset.t;
    sel = -1;
    if (selDrop === t) { selDrop = 0; targets = {}; } else {
      selDrop = t; targets = targetsFor(function (m) { return E.isDrop(m) && E.from(m) === t; });
      if (!Object.keys(targets).length) say('That piece cannot be dropped anywhere');
      else say('Choose where to drop it');
    }
    paint();
  }

  var promoSheet = BK.sheet($('sg-promo'), function () { pendingPromo = null; });
  function showPromo(cands) {
    var t = Math.abs(pos.sq[E.from(cands[0])]), box = $('sg-promo-choices'), color = pos.turn;
    box.textContent = '';
    [[true, 'Promote', t + PROMOTED], [false, 'Do not promote', t]].forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ar-btn sg-promo-btn';
      b.innerHTML = pieceSvg(o[2], color, true) + '<span>' + o[1] + '</span>';
      b.addEventListener('click', function () {
        var m = cands.filter(function (x) { return !!E.isPromo(x) === o[0]; })[0];
        promoSheet.close();
        if (m) play(m);
      });
      box.appendChild(b);
    });
    promoSheet.open(box.firstChild);
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
    requestId++; thinking = false; over = false; sel = -1; selDrop = 0; targets = {}; lastMove = 0; clearTimeout(watchdog); F.cancel();
    var variant = settings.variant;
    if (!E || E.SIZE !== (variant === 'mini' ? 5 : 9)) {
      killWorker(); workerOk = true;
      E = root.ZimiShogiEngine(variant); SIZE = E.SIZE; SENTE = E.SENTE; GOTE = E.GOTE; PROMOTED = E.PROMOTED;
      buildBoard();
      $('sg-title').textContent = variant === 'mini' ? 'Minishogi' : 'Shogi';
      document.title = $('sg-title').textContent + ' - ZimiGames';
      $('sg-zone').textContent = variant === 'mini' ? 'far rank' : 'far three ranks';
    }
    pos = E.startPosition(); keys = [E.key(pos)]; sans = []; played = [];
    flipped = settings.mode === 'cpu' && settings.side === 'gote';
    resultSheet.close();
    cells.forEach(function (c) { delete c.dataset.sig; });
    showStats(); paintMoves(); paint();
    afterMove();
  }

  // ── bar, menu, keys ──
  var menu = BK.sheet($('sg-sheet')), resultSheet = BK.sheet($('sg-result'));
  function syncMenu() {
    BK.chipSet($('sg-f-variant'), settings.variant); BK.chipSet($('sg-f-mode'), settings.mode); BK.chipSet($('sg-f-level'), settings.level);
    BK.chipSet($('sg-f-side'), settings.side); BK.chipSet($('sg-f-labels'), settings.labels); $('sg-hints').checked = settings.hints;
    refreshMenu();
  }
  function refreshMenu() {
    var two = BK.chipValue($('sg-f-mode')) === 'two';
    $('sg-f-level').disabled = two; $('sg-f-side').disabled = two;
    $('sg-f-level').style.opacity = $('sg-f-side').style.opacity = two ? 0.45 : 1;
  }
  $('sg-new').addEventListener('click', function () { syncMenu(); menu.open(); });
  $('sg-f-mode').addEventListener('change', refreshMenu);
  $('sg-cancel').addEventListener('click', menu.close);
  $('sg-start').addEventListener('click', function () {
    settings.variant = BK.chipValue($('sg-f-variant')); settings.mode = BK.chipValue($('sg-f-mode')); settings.level = BK.chipValue($('sg-f-level'));
    settings.side = BK.chipValue($('sg-f-side')); settings.labels = BK.chipValue($('sg-f-labels')); settings.hints = $('sg-hints').checked;
    BK.save(SETTINGS_KEY, settings);
    menu.close(); newGame();
  });
  $('sg-again').addEventListener('click', newGame);
  $('sg-close').addEventListener('click', function () { resultSheet.close(); });
  els.undo.addEventListener('click', undo);
  els.flip.addEventListener('click', function () { flipped = !flipped; paint(); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input')) return;
    var k = e.key.toLowerCase();
    if (k === 'n') { syncMenu(); menu.open(); } else if (k === 'u') undo(); else if (k === 'f') { flipped = !flipped; paint(); }
    else if (e.key === 'Escape' && (sel >= 0 || selDrop)) { sel = -1; selDrop = 0; targets = {}; paint(); }
  });

  if (settings.variant !== 'mini') settings.variant = 'full';
  if (!['beginner', 'casual', 'club', 'strong'].includes(settings.level) && !F.wants(settings.level)) settings.level = 'club';
  if (settings.mode !== 'two') settings.mode = 'cpu';
  if (settings.side !== 'gote') settings.side = 'sente';
  if (settings.hints !== false) settings.hints = true;
  if (settings.labels !== 'latin') settings.labels = 'kanji';
  newGame();

  if (new URLSearchParams(location.search).has('debug')) {
    root.__sg = { engine: function () { return E; }, pos: function () { return pos; }, settings: settings, play: play, usingWorker: function () { return !!worker; } };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
