/* ZimiGames: Chess, the page. The rules and the searcher are in chess-engine.js.
   The computer thinks in a Web Worker built from the engine's own source (no second file
   to fetch); if Workers are unavailable it thinks on the main thread for a short while. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined' || !root.ZimiChessEngine || !root.ZimiChessPieces) return;
  var E = root.ZimiChessEngine(), F = root.ZimiFairy, BK = root.BoardKit, $ = function (id) { return document.getElementById(id); };
  var WHITE = E.WHITE, BLACK = E.BLACK, SETTINGS_KEY = 'chess.settings', STATS_KEY = 'chess.stats';
  var FALLBACK_MS = 250, FALLBACK_DEPTH = 3;   // main-thread thinking when there is no worker
  var WORKER_GRACE_MS = 5000;                  // a worker that stays silent this long past its budget is given up on
  var COMPUTER_DELAY_MS = 250;
  var OLD_NAMES = { strong: 'advanced' };   // the chip that used to be called Strong
  var NAMES = root.ZimiChessPieces.NAMES;

  var settings = BK.load(SETTINGS_KEY, {});
  if (!E.LEVELS[settings.level] && !F.wants(settings.level)) settings.level = 'club';
  if (settings.mode !== 'two') settings.mode = 'cpu';
  if (settings.side !== 'black') settings.side = 'white';
  if (settings.hints !== false) settings.hints = true;
  var stats = BK.load(STATS_KEY, {});

  var els = { board: $('cs-board'), status: $('cs-status'), undo: $('cs-undo'), moves: $('cs-moves'), opening: $('cs-opening'), stats: $('cs-stats'), flip: $('cs-flip') };
  var cells = [], pos, keys, sans, played, over, sel = -1, targets = {}, lastMove = 0, flipped = false, requestId = 0, thinking = false;
  var worker = null, workerOk = true, watchdog = 0, pendingPromo = null;

  var watch = null, watchSaved = null;   // Watch and learn: the driver's controller, and the settings to give back
  // The level our own engine plays at: the one chosen, or its best when Strong or Master were chosen and Fairy-Stockfish is not there.
  function engineLevel() { return F.wants(settings.level) ? 'strong' : settings.level; }
  function human(color) { if (watch) return false; return settings.mode === 'two' || color === (settings.side === 'white' ? WHITE : BLACK); }
  function colorName(c) { return c === WHITE ? 'White' : 'Black'; }

  // ── drawing ──
  function pieceSvg(t, color) {
    return root.ZimiChessPieces.svg(t, color === WHITE);
  }

  function buildBoard() {
    els.board.textContent = '';
    cells = [];
    for (var d = 0; d < 64; d++) {
      var c = document.createElement('button');
      c.type = 'button'; c.className = 'bg-sq'; c.dataset.d = d;
      c.addEventListener('click', onSquare);
      els.board.appendChild(c); cells.push(c);
    }
    BK.gridNav(els.board, cells, 8);
  }
  function sqAt(d) { return flipped ? 63 - d : d; }

  function paint() {
    var kingSq = E.inCheck(pos) ? pos.king[pos.turn === WHITE ? 0 : 1] : -1;
    for (var d = 0; d < 64; d++) {
      var s = sqAt(d), c = cells[d], v = pos.sq[s], cls = 'bg-sq' + (((s >> 3) + (s & 7)) % 2 ? ' dk' : '');
      if (lastMove && (s === E.from(lastMove) || s === E.to(lastMove))) cls += ' last';
      if (s === sel) cls += ' sel';
      if (s === kingSq) cls += ' bad';
      if (settings.hints && targets.hasOwnProperty(s)) cls += ' hint' + (v || targets[s] ? ' cap' : '');
      c.className = cls;
      var html = v ? pieceSvg(Math.abs(v), v > 0 ? WHITE : BLACK) : '';
      var edge = '';
      if ((d >> 3) === 7) edge += '<i class="cs-co f">' + 'abcdefgh'[s & 7] + '</i>';
      if ((d & 7) === 0) edge += '<i class="cs-co r">' + (8 - (s >> 3)) + '</i>';
      var sig = html + edge;
      if (c.dataset.sig !== sig) { c.innerHTML = sig; c.dataset.sig = sig; }
      c.setAttribute('aria-label', E.squareName(s) + ', ' + (v ? (v > 0 ? 'white ' : 'black ') + NAMES[Math.abs(v)] : targets.hasOwnProperty(s) ? 'move here' : 'empty') + (s === sel ? ', selected' : ''));
    }
    els.undo.disabled = !played.length || thinking;
    els.flip.setAttribute('aria-pressed', String(flipped !== (settings.mode === 'cpu' && settings.side === 'black')));
  }

  function say(text, busy) {
    els.status.textContent = '';
    if (busy) { var s = document.createElement('span'); s.className = 'bg-spin'; els.status.appendChild(s); }
    els.status.appendChild(document.createTextNode(text));
  }
  function showStats() {
    var s = stats[settings.level] || { w: 0, l: 0, d: 0 };
    els.stats.textContent = settings.mode === 'cpu' ? 'vs ' + F.levelName(settings.level, OLD_NAMES) + ': ' + s.w + ' won, ' + s.l + ' lost, ' + s.d + ' drawn' : 'Two players on this device';
  }
  // The opening's name: the data (data/chess-openings.js, lichess-org/chess-openings, CC0) loads once a game has a move,
  // after the page is up, and its index is built in a later task so a move never waits on it.
  var openingIndex = null, openingRequested = false;
  function paintOpening() {
    if (!openingIndex) return;
    var o = root.ZimiChessContent.openingFor(openingIndex, keys);
    els.opening.textContent = o ? o.eco + ' \u00b7 ' + o.name : '';
  }
  function wantOpenings() {
    if (openingRequested || !sans.length || !root.ZimiChessContent) return;
    openingRequested = true;
    var s = document.createElement('script');
    s.src = 'data/chess-openings.js';
    s.onload = function () { setTimeout(function () { openingIndex = root.ZimiChessContent.openingIndex(E, root.ZimiChessOpenings.rows); paintOpening(); }, 0); };
    document.head.appendChild(s);
  }
  function paintMoves() {
    var html = '';
    for (var i = 0; i < sans.length; i++) {
      if (i % 2 === 0) html += '<span class="cs-n">' + (i / 2 + 1) + '.</span>';
      html += '<span class="cs-m' + (i === sans.length - 1 ? ' now' : '') + '">' + sans[i] + '</span>';
    }
    els.moves.innerHTML = html || '<span class="cs-none">No moves yet</span>';
    els.moves.scrollLeft = els.moves.scrollWidth; els.moves.scrollTop = els.moves.scrollHeight;
    els.opening.textContent = '';
    wantOpenings(); paintOpening();
  }

  // ── turns ──
  var WHY = { stalemate: 'Stalemate, a draw.', repetition: 'A draw by threefold repetition.', fifty: 'A draw by the fifty-move rule.', material: 'A draw, neither side has enough pieces to mate.' };
  function finish(st) {
    over = true; thinking = false; sel = -1; targets = {};
    if (root.ZimiShell) root.ZimiShell.turn(false);
    var msg, result;
    if (st.result === 'mate') {
      msg = 'Checkmate. ' + (settings.mode === 'two' ? colorName(st.winner) + ' wins.' : human(st.winner) ? 'You win.' : 'The computer wins.');
      result = human(st.winner) ? 'win' : 'loss';
    } else { msg = WHY[st.result]; result = 'draw'; }
    if (watch) { paint(); say(msg); watch.finish(msg + ' That was the whole game. Press Done to play one yourself.'); return; }
    if (settings.mode === 'cpu') {
      var s = stats[settings.level] = stats[settings.level] || { w: 0, l: 0, d: 0 };
      if (result === 'win') s.w++; else if (result === 'loss') s.l++; else s.d++;
      BK.save(STATS_KEY, stats);
    }
    paint(); say(msg); showStats();
    $('cs-result-text').textContent = msg;
    resultSheet.open($('cs-again'));
  }

  function afterMove() {
    sel = -1; targets = {};
    var st = E.status(pos, keys);
    paintMoves();
    if (st.over) { finish(st); return; }
    paint();
    var line = watch ? colorName(pos.turn) + ' to move' : settings.mode === 'two' ? colorName(pos.turn) + ' to move' : human(pos.turn) ? 'Your turn' : 'Computer is thinking';
    say((st.check ? 'Check. ' : '') + line, !human(pos.turn) && !watch);
    if (root.ZimiShell) root.ZimiShell.turn(human(pos.turn) && !over, timeUp, played.length);
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
      var src = 'var E=(' + root.ZimiChessEngine.toString() + ')();onmessage=function(e){var d=e.data,r=E.think(d.fen,{level:d.level,seen:d.seen});postMessage({id:d.id,move:r.move,depth:r.depth,score:r.score});};';
      var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = function (e) { onAnswer(e.data.id, e.data.move, e.data.score); };
      worker.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); dropWorker(); thinkHere(requestId); };
    } catch (err) { workerOk = false; worker = null; }
    return worker;
  }
  function dropWorker() { workerOk = false; if (worker) { try { worker.terminate(); } catch (e) { /* gone already */ } } worker = null; }

  function onAnswer(id, move, score) {
    if (id !== requestId || !thinking) return;
    clearTimeout(watchdog);
    thinking = false;
    if (!move) { afterMove(); return; }
    if (!watch) { play(move); return; }
    // Watch and learn: say why, then play it when the driver says so.
    var why = root.ZimiExplain.chess(E, pos, move, { score: score, ply: played.length });
    var mine = watch;
    mine.offer(why.text, function () { if (watch === mine && !over) play(move); });
  }

  function thinkHere(id) { // main thread: a short, shallow search, after a paint so the page shows it is thinking
    setTimeout(function () {
      if (id !== requestId || !thinking) return;
      var r = E.think(pos, { level: engineLevel(), ms: FALLBACK_MS, depth: FALLBACK_DEPTH, seen: seenCounts() });
      onAnswer(id, r.move, r.score);
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
    F.ask('chess', E, pos, played, settings.level, function (move, why) {
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
    E.legalMoves(pos).forEach(function (m) { if (E.from(m) === s) out[E.to(m)] = !!(pos.sq[E.to(m)] || (E.flag(m) & 1)); });
    return out;
  }
  function onSquare(e) {
    if (over || thinking || !human(pos.turn)) return;
    var s = sqAt(+e.currentTarget.dataset.d), v = pos.sq[s];
    if (sel >= 0 && targets.hasOwnProperty(s)) {
      var cands = E.legalMoves(pos).filter(function (m) { return E.from(m) === sel && E.to(m) === s; });
      if (cands.length > 1) { pendingPromo = cands; promoSheet.open(); return; }
      play(cands[0]); return;
    }
    if (v * pos.turn > 0 && s !== sel) {
      sel = s; targets = movesFrom(s);
      if (!Object.keys(targets).length) say('That piece cannot move');
      else say(settings.mode === 'two' ? colorName(pos.turn) + ' to move' : 'Choose where to move');
    } else { sel = -1; targets = {}; }
    paint();
  }

  var promoSheet = BK.sheet($('cs-promo'), function () { pendingPromo = null; });
  function buildPromo() {
    var box = $('cs-promo-choices');
    [E.Q, E.R, E.B, E.N].forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ar-btn cs-promo-btn'; b.dataset.t = t;
      b.setAttribute('aria-label', NAMES[t]);
      b.innerHTML = pieceSvg(t, pos ? pos.turn : WHITE) + '<span>' + NAMES[t] + '</span>';
      b.addEventListener('click', function () {
        var m = pendingPromo.filter(function (x) { return E.promo(x) === t; })[0];
        promoSheet.close();
        if (m) play(m);
      });
      box.appendChild(b);
    });
  }
  function paintPromoColour() {
    var svgs = $('cs-promo-choices').querySelectorAll('svg');
    for (var i = 0; i < svgs.length; i++) svgs[i].setAttribute('class', 'cs-pc ' + (pos.turn === WHITE ? 'w' : 'b'));
  }

  // The move timer ran out: the computer's quickest choice is played for the person.
  function timeUp() {
    if (over || thinking || !human(pos.turn)) return;
    promoSheet.close(); pendingPromo = null;
    var r = E.think(pos, { level: 'beginner', ms: 80, depth: 1, seen: seenCounts() });
    if (!r.move) return;
    say('Time ran out. A move was played for you.');
    play(r.move);
  }

  function undo() {
    if (!played.length || thinking || watch) return;
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
  var menu = BK.sheet($('cs-sheet')), resultSheet = BK.sheet($('cs-result'));
  function syncMenu() {
    BK.chipSet($('cs-f-mode'), settings.mode); BK.chipSet($('cs-f-level'), settings.level);
    BK.chipSet($('cs-f-side'), settings.side); $('cs-hints').checked = settings.hints;
    refreshMenu();
  }
  // Opponent vs two players: the level and side only matter against the computer.
  function refreshMenu() {
    var two = BK.chipValue($('cs-f-mode')) === 'two';
    $('cs-f-level').disabled = two; $('cs-f-side').disabled = two;
    $('cs-f-level').style.opacity = $('cs-f-side').style.opacity = two ? 0.45 : 1;
  }
  $('cs-new').addEventListener('click', function () { syncMenu(); menu.open(); });
  $('cs-f-mode').addEventListener('change', refreshMenu);
  $('cs-cancel').addEventListener('click', menu.close);
  $('cs-start').addEventListener('click', function () {
    settings.mode = BK.chipValue($('cs-f-mode')); settings.level = BK.chipValue($('cs-f-level'));
    settings.side = BK.chipValue($('cs-f-side')); settings.hints = $('cs-hints').checked;
    BK.save(SETTINGS_KEY, settings);
    menu.close(); newGame();
  });
  $('cs-again').addEventListener('click', newGame);
  $('cs-close').addEventListener('click', function () { resultSheet.close(); });
  els.undo.addEventListener('click', undo);
  els.flip.addEventListener('click', function () { flipped = !flipped; paint(); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input')) return;
    var k = e.key.toLowerCase();
    if (k === 'n') { syncMenu(); menu.open(); } else if (k === 'u') undo(); else if (k === 'f') { flipped = !flipped; paint(); }
    else if (e.key === 'Escape' && sel >= 0) { sel = -1; targets = {}; paint(); }
  });
  // the promotion sheet shows the colour of whoever is promoting
  var promoObserver = new MutationObserver(function () { if (!$('cs-promo').hidden) paintPromoColour(); });
  promoObserver.observe($('cs-promo'), { attributes: true, attributeFilter: ['hidden'] });

  if (root.ZimiShell) root.ZimiShell.game({
    moveTimer: true, hints: true,
    stats: function () { var s = stats[settings.level] || { w: 0, l: 0, d: 0 }; return 'Against the computer, ' + settings.level + ': ' + s.w + ' won, ' + s.l + ' lost, ' + s.d + ' drawn'; },
    inProgress: function () { return !over && played.length > 0; },
    watch: {
      script: 'explain-chess.js',
      start: function (ctl) {
        watchSaved = { mode: settings.mode, level: settings.level, side: settings.side };
        settings.mode = 'cpu'; settings.level = 'club'; settings.side = 'white';
        watch = ctl; newGame();
        ctl.say('White moves first. The computer plays both sides at club level.');
      },
      // takeover: play on from here as the side to move; stop: a fresh game; new: the game's own New game sheet follows.
      stop: function (kind) {
        watch = null; requestId++; thinking = false; clearTimeout(watchdog);
        var turn = pos.turn;
        settings.mode = 'cpu'; settings.level = watchSaved.level; settings.side = watchSaved.side;
        if (kind === 'takeover') { settings.side = turn === WHITE ? 'white' : 'black'; flipped = settings.side === 'black'; afterMove(); }
        else { settings.mode = watchSaved.mode; if (kind === 'stop') newGame(); }
      }
    }
  });

  buildBoard();
  pos = E.startPosition(); buildPromo();
  newGame();

  if (new URLSearchParams(location.search).has('debug')) {
    root.__cs = { engine: E, pos: function () { return pos; }, settings: settings, play: play,
      setFen: function (fen) { pos = E.parseFen(fen); keys = [E.key(pos)]; sans = []; played = []; lastMove = 0; over = false; afterMove(); }, usingWorker: function () { return !!worker; }, noWorker: function () { dropWorker(); } };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
