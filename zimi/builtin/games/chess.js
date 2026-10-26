/* ZimiGames: Chess, the page. The rules and the searcher are in chess-engine.js.
   The computer thinks in a Web Worker built from the engine's own source (no second file
   to fetch); if Workers are unavailable it thinks on the main thread for a short while. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined' || !root.ZimiChessEngine || !root.ZimiChessPieces || !root.BoardUI) return;
  var E = root.ZimiChessEngine(), F = root.ZimiFairy, BK = root.BoardKit, UI = root.BoardUI, T = UI.t, $ = function (id) { return document.getElementById(id); };
  var WHITE = E.WHITE, BLACK = E.BLACK, SETTINGS_KEY = 'chess.settings', STATS_KEY = 'chess.stats';
  var FALLBACK_MS = 250, FALLBACK_DEPTH = 3;   // main-thread thinking when there is no worker
  var WORKER_GRACE_MS = 5000;                  // a worker that stays silent this long past its budget is given up on
  var COMPUTER_DELAY_MS = 250;
  var LEVELS = ['beginner', 'casual', 'club', 'strong', 'fairy', 'master'];   // 'strong' is shown as Advanced and 'fairy' as Strong

  var settings = BK.load(SETTINGS_KEY, {});
  if (!E.LEVELS[settings.level] && !F.wants(settings.level)) settings.level = 'club';
  if (settings.mode !== 'two') settings.mode = 'cpu';
  if (settings.side !== 'black') settings.side = 'white';
  var stats = BK.load(STATS_KEY, {});
  // Show legal moves is the shell's Hints setting (Menu > Settings), not a New game option.
  function hintsOn() { return !root.ZimiShell || root.ZimiShell.settings.get('hints') !== 'off'; }

  var els = { board: $('cs-board'), status: $('cs-status'), undo: $('cs-undo'), moves: $('cs-moves'), opening: $('cs-opening'), stats: $('cs-stats'), flip: $('cs-flip'), capsTop: $('cs-caps-top'), capsBot: $('cs-caps-bot'), capsHtml: {} };
  var cells = [], pos, keys, sans, played, over, sel = -1, targets = {}, lastMove = 0, flipped = false, requestId = 0, thinking = false;
  var worker = null, workerOk = true, watchdog = 0, pendingPromo = null;
  var status = UI.status(els.status);

  var watch = null, watchSaved = null;   // Watch and learn: the driver's controller, and the settings to give back
  // The level our own engine plays at: the one chosen, or its best when Strong or Master were chosen and Fairy-Stockfish is not there.
  function engineLevel() { return F.wants(settings.level) ? 'strong' : settings.level; }
  function human(color) { if (watch) return false; return settings.mode === 'two' || color === (settings.side === 'white' ? WHITE : BLACK); }
  function colorName(c) { return UI.side(c === WHITE ? 'white' : 'black'); }
  function levelLabel(l) { return T('chess.level.' + l); }

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
    BK.dragPieces(els.board, cells, {
      grab: function (i) { if (sel !== sqAt(i)) onSquare({ currentTarget: cells[i] }); },
      drop: function (i) { if (targets.hasOwnProperty(sqAt(i))) onSquare({ currentTarget: cells[i] }); }
    });
  }
  function sqAt(d) { return flipped ? 63 - d : d; }

  function paint() {
    var kingSq = E.inCheck(pos) ? pos.king[pos.turn === WHITE ? 0 : 1] : -1;
    for (var d = 0; d < 64; d++) {
      var s = sqAt(d), c = cells[d], v = pos.sq[s], cls = 'bg-sq' + (((s >> 3) + (s & 7)) % 2 ? ' dk' : '');
      if (lastMove && (s === E.from(lastMove) || s === E.to(lastMove))) cls += ' last';
      if (s === sel) cls += ' sel';
      if (s === kingSq) cls += ' bad';
      if (hintsOn() && targets.hasOwnProperty(s)) cls += ' hint' + (v || targets[s] ? ' cap' : '');
      c.className = cls;
      var html = v ? pieceSvg(Math.abs(v), v > 0 ? WHITE : BLACK) : '';
      var edge = '';
      if ((d >> 3) === 7) edge += '<i class="cs-co f">' + 'abcdefgh'[s & 7] + '</i>';
      if ((d & 7) === 0) edge += '<i class="cs-co r">' + (8 - (s >> 3)) + '</i>';
      var sig = html + edge;
      if (c.dataset.sig !== sig) { c.innerHTML = sig; c.dataset.sig = sig; }
      var name = E.squareName(s), label = v ? T('chess.sq.piece', { sq: name, color: colorName(v > 0 ? WHITE : BLACK).toLowerCase(), piece: T('chess.piece.' + Math.abs(v)) }) : T(targets.hasOwnProperty(s) ? 'chess.sq.target' : 'chess.sq.empty', { sq: name });
      c.setAttribute('aria-label', s === sel ? T('chess.sq.selected', { label: label }) : label);
    }
    paintCaps();
    els.undo.disabled = !played.length || thinking;
    els.flip.setAttribute('aria-pressed', String(flipped !== (settings.mode === 'cpu' && settings.side === 'black')));
  }

  // The strips over and under the board: what each side has taken (a pawn..queen icon each, biggest first) and the lead in pawns.
  function paintCaps() {
    var bottom = (flipped ? BLACK : WHITE), top = -bottom, lead = E.takenFrom(pos, top).worth - E.takenFrom(pos, bottom).worth;
    [[els.capsBot, bottom, lead], [els.capsTop, top, -lead]].forEach(function (c) {
      var gone = E.takenFrom(pos, -c[1]), html = '', prev = 0;
      gone.list.forEach(function (t) { html += pieceSvg(t, -c[1]).replace('class="', 'class="' + (prev && prev !== t ? 'gap ' : '')); prev = t; });
      if (c[2] > 0) html += '<b>+' + c[2] + '</b>';
      if (els.capsHtml[c[0].id] !== html) { c[0].innerHTML = html; els.capsHtml[c[0].id] = html; }
    });
  }

  function say(text, busy) { status.turn(text, busy); }
  function showStats() { UI.record(els.stats, levelLabel(settings.level), settings.mode === 'cpu' ? stats[settings.level] : null); }
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
      html += '<span class="cs-m' + (i === sans.length - 1 ? ' now' : '') + '">' + sans[i] + '</span> ';
    }
    els.moves.innerHTML = html;
    els.moves.scrollLeft = els.moves.scrollWidth; els.moves.scrollTop = els.moves.scrollHeight;
    els.opening.textContent = '';
    wantOpenings(); paintOpening();
  }

  // ── turns ──
  var WHY = { stalemate: 'chess.why.stalemate', repetition: 'chess.why.repetition', fifty: 'chess.why.fifty', material: 'chess.why.material' };
  var lastEnd = null;   // how the game ended, kept so a finished game comes back to its end sheet
  function finish(st) {
    over = true; thinking = false; sel = -1; targets = {};
    if (root.ZimiShell) root.ZimiShell.turn(false);
    var msg, result;
    if (st.result === 'mate') {
      msg = T('chess.why.mate');
      result = human(st.winner) ? 'win' : 'loss';
    } else { msg = T(WHY[st.result]); result = 'draw'; }
    if (watch) { paint(); say(msg); watch.finish(T('board.watch.done', { text: msg })); return; }
    if (settings.mode === 'cpu') {
      var s = stats[settings.level] = stats[settings.level] || { w: 0, l: 0, d: 0 };
      if (result === 'win') s.w++; else if (result === 'loss') s.l++; else s.d++;
      BK.save(STATS_KEY, stats);
    }
    paint(); say(msg); showStats();
    lastEnd = settings.mode === 'two' && st.result === 'mate' ? { result: 'win', name: colorName(st.winner), text: msg } : { result: result === 'loss' ? 'lose' : result, text: msg };
    UI.end(lastEnd);
  }

  function afterMove() {
    sel = -1; targets = {};
    var st = E.status(pos, keys);
    paintMoves();
    if (st.over) { finish(st); return; }
    paint();
    var line = watch || settings.mode === 'two' ? T('board.toMove', { name: colorName(pos.turn) }) : human(pos.turn) ? T('board.yourTurn') : T('shell.thinking');
    say(st.check ? T('chess.check', { line: line }) : line, !human(pos.turn) && !watch);
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
      if (why === 'unavailable') say(T('board.fairyNote', { thinking: T('shell.thinking') }), true);
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
      if (cands.length > 1) { askPromotion(cands); return; }
      play(cands[0]); return;
    }
    if (v * pos.turn > 0 && s !== sel) {
      sel = s; targets = movesFrom(s);
      if (!Object.keys(targets).length) { sel = -1; UI.refuse(status, e.currentTarget, T('chess.cantMove')); }
      else say(settings.mode === 'two' ? T('board.toMove', { name: colorName(pos.turn) }) : T('board.chooseWhere'));
    } else { sel = -1; targets = {}; }
    paint();
  }

  // The pawn reaches the far rank: a sheet of the four pieces it can become, in the colour of whoever is promoting.
  var promoSheet = null;
  function askPromotion(cands) {
    pendingPromo = cands;
    var box = UI.h('div', { class: 'cs-promo-choices' });
    [E.Q, E.R, E.B, E.N].forEach(function (t) {
      if (!cands.some(function (x) { return E.promo(x) === t; })) return;
      var b = UI.h('button', { class: 'ar-btn cs-promo-btn', type: 'button', 'aria-label': T('chess.piece.' + t) });
      b.innerHTML = pieceSvg(t, pos.turn) + '<span>' + T('chess.piece.' + t) + '</span>';
      b.addEventListener('click', function () {
        var m = cands.filter(function (x) { return E.promo(x) === t; })[0];
        promoSheet.close();
        if (m) play(m);
      });
      box.appendChild(b);
    });
    promoSheet = root.ZimiShell.sheet({ title: T('chess.promote'), body: [box], onClose: function () { pendingPromo = null; } });
  }

  // The move timer ran out: the computer's quickest choice is played for the person.
  function timeUp() {
    if (over || thinking || !human(pos.turn)) return;
    if (promoSheet) promoSheet.close();
    pendingPromo = null;
    var r = E.think(pos, { level: 'beginner', ms: 80, depth: 1, seen: seenCounts() });
    if (!r.move) return;
    say(T('board.timeUp'));
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
    showStats(); paintMoves(); paint();
    afterMove();
  }

  // ── bar, menu, keys ──
  // Menu > New game shows these rows with Start last; Start clicks #cs-new, which applies them and begins.
  var draft = null;
  function menuOptions() {
    draft = { mode: settings.mode, level: settings.level, side: settings.side };
    var rows = [], level;
    rows.push(UI.row(T('board.opponent'), [['cpu', T('board.computer')], ['two', T('board.twoPlayers')]], draft.mode, function (v) { draft.mode = v; level.disable(v === 'two'); side.disable(v === 'two'); }));
    level = UI.row(T('board.level'), LEVELS.map(function (l) { return [l, levelLabel(l)]; }), draft.level, function (v) { draft.level = v; });
    var side = UI.row(T('board.youPlay'), [['white', T('chess.side.white')], ['black', T('board.black')]], draft.side, function (v) { draft.side = v; });
    rows.push(level, side);
    level.disable(draft.mode === 'two'); side.disable(draft.mode === 'two');
    return UI.options(rows);
  }
  $('cs-new').addEventListener('click', function () {
    if (draft) { settings.mode = draft.mode; settings.level = draft.level; settings.side = draft.side; draft = null; BK.save(SETTINGS_KEY, settings); }
    newGame();
  });
  els.undo.addEventListener('click', undo);
  els.flip.addEventListener('click', function () { flipped = !flipped; paint(); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input')) return;
    var k = e.key.toLowerCase();
    if (k === 'n') root.ZimiShell.openMenu(); else if (k === 'u') undo(); else if (k === 'f') { flipped = !flipped; paint(); }
    else if (e.key === 'Escape' && sel >= 0) { sel = -1; targets = {}; paint(); }
  });

  if (root.ZimiShell) root.ZimiShell.settings.on(function (k) { if (k === 'hints' || k === '*') paint(); });
  if (root.ZimiShell) root.ZimiShell.game({
    moveTimer: true, hints: true,
    menu: menuOptions,
    stats: function () { var s = stats[settings.level]; return s && s.w + s.l + s.d ? [T(s.d ? 'board.record.draws' : 'board.record', { level: levelLabel(settings.level), won: s.w, lost: s.l, drawn: s.d })] : []; },
    inProgress: function () { return !over && played.length > 0; },
    watch: {
      script: 'explain-chess.js',
      start: function (ctl) {
        watchSaved = { mode: settings.mode, level: settings.level, side: settings.side };
        settings.mode = 'cpu'; settings.level = 'club'; settings.side = 'white';
        watch = ctl; newGame();
        ctl.say(T('chess.watch.intro'));
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
  pos = E.startPosition();
  newGame();
  // Leaving and coming back: the settings in force, the moves (the position is played again from the start), and the end.
  UI.persist({
    save: function () { return watch || !played.length ? null : { cfg: { mode: settings.mode, level: settings.level, side: settings.side }, played: played.slice(), flipped: flipped, end: over ? lastEnd : null }; },
    load: function (d) {
      settings.mode = d.cfg.mode; settings.level = d.cfg.level; settings.side = d.cfg.side;
      requestId++; thinking = false; clearTimeout(watchdog);
      pos = E.startPosition(); keys = [E.key(pos)]; sans = []; played = [];
      d.played.forEach(function (m) { sans.push(E.san(pos, m)); played.push(m); E.make(pos, m); keys.push(E.key(pos)); });
      lastMove = played[played.length - 1] || 0; flipped = !!d.flipped; sel = -1; targets = {}; over = !!d.end; lastEnd = d.end;
      paintMoves(); paint(); showStats();
      if (over) { say(d.end.text); UI.end(d.end); }
    },
    resume: function () { if (!over) afterMove(); }
  });

  if (new URLSearchParams(location.search).has('debug')) {
    root.__cs = { engine: E, pos: function () { return pos; }, settings: settings, play: play,
      setFen: function (fen) { pos = E.parseFen(fen); keys = [E.key(pos)]; sans = []; played = []; lastMove = 0; over = false; afterMove(); }, usingWorker: function () { return !!worker; }, noWorker: function () { dropWorker(); } };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
