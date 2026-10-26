/* ZimiGames: Shogi and Minishogi, the page. The rules and the searcher are in shogi-engine.js.
   The computer thinks in a Web Worker built from the engine's own source; if Workers are
   unavailable it thinks on the main thread for a short while. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined' || !root.ZimiShogiEngine || !root.BoardUI) return;
  var F = root.ZimiFairy, BK = root.BoardKit, UI = root.BoardUI, T = UI.t, $ = function (id) { return document.getElementById(id); };
  var SETTINGS_KEY = 'shogi.settings', STATS_KEY = 'shogi.stats';
  var FALLBACK_MS = 250, FALLBACK_DEPTH = 2, WORKER_GRACE_MS = 5000, COMPUTER_DELAY_MS = 250;
  var LEVELS = ['beginner', 'casual', 'club', 'strong', 'fairy', 'master'];   // 'strong' is shown as Advanced and 'fairy' as Strong
  var KANJI = { 1: '歩', 2: '香', 3: '桂', 4: '銀', 5: '金', 6: '角', 7: '飛', 8: '玉', 9: 'と', 10: '杏', 11: '圭', 12: '全', 14: '馬', 15: '龍' };
  var LATIN = { 1: 'P', 2: 'L', 3: 'N', 4: 'S', 5: 'G', 6: 'B', 7: 'R', 8: 'K', 9: '+P', 10: '+L', 11: '+N', 12: '+S', 14: '+B', 15: '+R' };
  var HAND_ORDER = [7, 6, 5, 4, 3, 2, 1];
  var PIECE_PATH = '20,2 33,9 37,42 3,42 7,9';

  var settings = BK.load(SETTINGS_KEY, {});
  var E = null, SIZE = 9, SENTE = 1, GOTE = -1, PROMOTED = 8;
  var stats = BK.load(STATS_KEY, {});
  // Show legal moves is the shell's Hints setting (Menu > Settings), not a New game option.
  function hintsOn() { return !root.ZimiShell || root.ZimiShell.settings.get('hints') !== 'off'; }

  var status = null, els = { board: $('sg-board'), status: $('sg-status'), undo: $('sg-undo'), moves: $('sg-moves'), stats: $('sg-stats'), flip: $('sg-flip') };
  status = UI.status(els.status);
  var cells = [], pos, keys, sans, played, over, sel = -1, selDrop = 0, targets = {}, lastMove = 0, flipped = false, requestId = 0, thinking = false;
  var worker = null, workerOk = true, watchdog = 0, pendingPromo = null;

  // The level our own engine plays at: the one chosen, or its best when Strong or Master were chosen and Fairy-Stockfish is not there.
  function engineLevel() { return F.wants(settings.level) ? 'strong' : settings.level; }
  function fairyGame() { return settings.variant === 'mini' ? 'minishogi' : 'shogi'; }
  function human(color) { return settings.mode === 'two' || color === (settings.side === 'sente' ? SENTE : GOTE); }
  function colorName(c) { return T(c === SENTE ? 'shogi.side.sente' : 'shogi.side.gote'); }
  function levelLabel(l) { return T('chess.level.' + l); }
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
      if (hintsOn() && targets.hasOwnProperty(s)) cls += ' hint' + (v ? ' cap' : '');
      c.className = cls;
      var html = v ? pieceSvg(Math.abs(v), v > 0 ? SENTE : GOTE) : '';
      var sig = html + settings.labels + bottomColor();
      if (c.dataset.sig !== sig) { c.innerHTML = html; c.dataset.sig = sig; }
      var name = E.squareName(s), label = v ? T('chess.sq.piece', { sq: name, color: colorName(v > 0 ? SENTE : GOTE).toLowerCase(), piece: T('shogi.piece.' + Math.abs(v)) }) : T(targets.hasOwnProperty(s) ? 'chess.sq.target' : 'chess.sq.empty', { sq: name });
      c.setAttribute('aria-label', s === sel ? T('chess.sq.selected', { label: label }) : label);
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
        html += '<button type="button" class="sg-h' + (picked ? ' sel' : '') + '" data-t="' + t + '" data-c="' + color + '"' + (canUse && n ? '' : ' disabled') + ' aria-label="' + T('shogi.hand.piece', { side: colorName(color), piece: T('shogi.piece.' + t), n: n }) + '">' + pieceSvg(t, color) + '<b>' + n + '</b></button>';
      });
      sig += settings.labels + bottom;
      if (box.dataset.sig !== sig) {
        box.innerHTML = html; box.dataset.sig = sig;
        Array.prototype.forEach.call(box.querySelectorAll('.sg-h'), function (b) { b.addEventListener('click', onHand); });
      }
    });
  }

  function say(text, busy) { status.turn(text, busy); }
  function showStats() { UI.record(els.stats, levelLabel(settings.level), settings.mode === 'cpu' ? stats[settings.variant + '.' + settings.level] : null); }
  function paintMoves() {
    var html = '';
    for (var i = 0; i < sans.length; i++) {
      if (i % 2 === 0) html += '<span class="sg-n">' + (i / 2 + 1) + '.</span>';
      html += '<span class="sg-m' + (i === sans.length - 1 ? ' now' : '') + '">' + sans[i] + '</span>';
    }
    els.moves.innerHTML = html;
    els.moves.scrollTop = els.moves.scrollHeight;
  }

  // ── turns ──
  var WHY = { repetition: 'shogi.why.repetition', long: 'shogi.why.long' };
  var lastEnd = null;   // how the game ended, kept so a finished game comes back to its end sheet
  function finish(st) {
    over = true; thinking = false; sel = -1; selDrop = 0; targets = {};
    var msg, result;
    if (st.result === 'mate') {
      msg = T('chess.why.mate');
      result = human(st.winner) ? 'win' : 'loss';
    } else { msg = T(WHY[st.result]); result = 'draw'; }
    if (settings.mode === 'cpu') {
      var key = settings.variant + '.' + settings.level, s = stats[key] = stats[key] || { w: 0, l: 0, d: 0 };
      if (result === 'win') s.w++; else if (result === 'loss') s.l++; else s.d++;
      BK.save(STATS_KEY, stats);
    }
    paint(); say(msg); showStats();
    lastEnd = settings.mode === 'two' && st.result === 'mate' ? { result: 'win', name: colorName(st.winner), text: msg } : { result: result === 'loss' ? 'lose' : result, text: msg };
    UI.end(lastEnd);
  }

  function afterMove() {
    sel = -1; selDrop = 0; targets = {};
    var st = E.status(pos, keys);
    paintMoves();
    if (st.over) { finish(st); return; }
    paint();
    var line = settings.mode === 'two' ? T('board.toMove', { name: colorName(pos.turn) }) : human(pos.turn) ? T('board.yourTurn') : T('shell.thinking');
    say(st.check ? T('chess.check', { line: line }) : line, !human(pos.turn));
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
      if (!Object.keys(targets).length) { sel = -1; UI.refuse(status, e.currentTarget, T('chess.cantMove')); }
      else say(settings.mode === 'two' ? T('board.toMove', { name: colorName(pos.turn) }) : T('board.chooseWhere'));
    } else { sel = -1; targets = {}; }
    paint();
  }
  function onHand(e) {
    if (over || thinking || !human(pos.turn)) return;
    var t = +e.currentTarget.dataset.t;
    sel = -1;
    if (selDrop === t) { selDrop = 0; targets = {}; } else {
      selDrop = t; targets = targetsFor(function (m) { return E.isDrop(m) && E.from(m) === t; });
      if (!Object.keys(targets).length) { selDrop = 0; UI.refuse(status, e.currentTarget, T('shogi.cantDrop')); }
      else say(T('shogi.chooseDrop'));
    }
    paint();
  }

  var promoSheet = null;
  function showPromo(cands) {
    var t = Math.abs(pos.sq[E.from(cands[0])]), box = UI.h('div', { class: 'sg-promo-choices' }), color = pos.turn;
    [[true, 'shogi.promote', t + PROMOTED], [false, 'shogi.noPromote', t]].forEach(function (o) {
      var b = UI.h('button', { class: 'ar-btn sg-promo-btn', type: 'button' });
      b.innerHTML = pieceSvg(o[2], color, true) + '<span>' + T(o[1]) + '</span>';
      b.addEventListener('click', function () {
        var m = cands.filter(function (x) { return !!E.isPromo(x) === o[0]; })[0];
        promoSheet.close();
        if (m) play(m);
      });
      box.appendChild(b);
    });
    promoSheet = root.ZimiShell.sheet({ title: T('shogi.promoteQ'), body: [box] });
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

  // The engine for the board in force (full or mini), and the board built for it.
  function useVariant() {
    var variant = settings.variant;
    if (!E || E.SIZE !== (variant === 'mini' ? 5 : 9)) {
      killWorker(); workerOk = true;
      E = root.ZimiShogiEngine(variant); SIZE = E.SIZE; SENTE = E.SENTE; GOTE = E.GOTE; PROMOTED = E.PROMOTED;
      buildBoard();
      $('sg-title').textContent = T(variant === 'mini' ? 'shogi.title.mini' : 'shogi.title');
      document.title = $('sg-title').textContent + ' - ZimiGames';
    }
  }
  function newGame() {
    requestId++; thinking = false; over = false; sel = -1; selDrop = 0; targets = {}; lastMove = 0; clearTimeout(watchdog); F.cancel();
    useVariant();
    pos = E.startPosition(); keys = [E.key(pos)]; sans = []; played = [];
    flipped = settings.mode === 'cpu' && settings.side === 'gote';
    cells.forEach(function (c) { delete c.dataset.sig; });
    showStats(); paintMoves(); paint();
    afterMove();
  }

  // ── bar, menu, keys ──
  // Menu > New game shows these rows with Start last; Start clicks #sg-new, which applies them and begins.
  var draft = null;
  function menuOptions() {
    draft = { variant: settings.variant, mode: settings.mode, level: settings.level, side: settings.side, labels: settings.labels };
    var rows = [], level, side;
    rows.push(UI.row(T('shogi.board'), [['full', T('shogi.board.full')], ['mini', T('shogi.board.mini')]], draft.variant, function (v) { draft.variant = v; }));
    rows.push(UI.row(T('board.opponent'), [['cpu', T('board.computer')], ['two', T('board.twoPlayers')]], draft.mode, function (v) { draft.mode = v; level.disable(v === 'two'); side.disable(v === 'two'); }));
    level = UI.row(T('board.level'), LEVELS.map(function (l) { return [l, levelLabel(l)]; }), draft.level, function (v) { draft.level = v; });
    side = UI.row(T('board.youPlay'), [['sente', T('shogi.side.senteFirst')], ['gote', T('shogi.side.gote')]], draft.side, function (v) { draft.side = v; });
    rows.push(level, side, UI.row(T('xiangqi.pieces'), [['kanji', T('shogi.pieces.kanji')], ['latin', T('xiangqi.pieces.latin')]], draft.labels, function (v) { draft.labels = v; }));
    level.disable(draft.mode === 'two'); side.disable(draft.mode === 'two');
    return UI.options(rows);
  }
  $('sg-new').addEventListener('click', function () {
    if (draft) { settings.variant = draft.variant; settings.mode = draft.mode; settings.level = draft.level; settings.side = draft.side; settings.labels = draft.labels; draft = null; BK.save(SETTINGS_KEY, settings); }
    newGame();
  });
  els.undo.addEventListener('click', undo);
  els.flip.addEventListener('click', function () { flipped = !flipped; paint(); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input')) return;
    var k = e.key.toLowerCase();
    if (k === 'n') root.ZimiShell.openMenu(); else if (k === 'u') undo(); else if (k === 'f') { flipped = !flipped; paint(); }
    else if (e.key === 'Escape' && (sel >= 0 || selDrop)) { sel = -1; selDrop = 0; targets = {}; paint(); }
  });

  if (settings.variant !== 'mini') settings.variant = 'full';
  if (!['beginner', 'casual', 'club', 'strong'].includes(settings.level) && !F.wants(settings.level)) settings.level = 'club';
  if (settings.mode !== 'two') settings.mode = 'cpu';
  if (settings.side !== 'gote') settings.side = 'sente';
  if (settings.labels !== 'latin') settings.labels = 'kanji';
  if (root.ZimiShell) {
    root.ZimiShell.settings.on(function (k) { if (k === 'hints' || k === '*') paint(); });
    root.ZimiShell.game({
      hints: true, menu: menuOptions,
      stats: function () { var s = stats[settings.variant + '.' + settings.level]; return s && s.w + s.l + s.d ? [T(s.d ? 'board.record.draws' : 'board.record', { level: levelLabel(settings.level), won: s.w, lost: s.l, drawn: s.d })] : []; },
      inProgress: function () { return !over && played.length > 0; }
    });
  }
  newGame();
  // Leaving and coming back: the settings in force, the moves (the position is played again from the start), and the end.
  UI.persist({
    save: function () { return !played.length ? null : { cfg: { variant: settings.variant, mode: settings.mode, level: settings.level, side: settings.side, labels: settings.labels }, played: played.slice(), flipped: flipped, end: over ? lastEnd : null }; },
    load: function (d) {
      ['variant', 'mode', 'level', 'side', 'labels'].forEach(function (k) { settings[k] = d.cfg[k]; });
      requestId++; thinking = false; clearTimeout(watchdog);
      useVariant();
      pos = E.startPosition(); keys = [E.key(pos)]; sans = []; played = [];
      d.played.forEach(function (m) { sans.push(E.san(pos, m)); played.push(m); E.make(pos, m); keys.push(E.key(pos)); });
      lastMove = played[played.length - 1] || 0; flipped = !!d.flipped; sel = -1; selDrop = 0; targets = {}; over = !!d.end; lastEnd = d.end;
      cells.forEach(function (c) { delete c.dataset.sig; });
      paintMoves(); paint(); showStats();
      if (over) { say(d.end.text); UI.end(d.end); }
    },
    resume: function () { if (!over) afterMove(); }
  });

  if (new URLSearchParams(location.search).has('debug')) {
    root.__sg = { finish: finish, engine: function () { return E; }, pos: function () { return pos; }, settings: settings, play: play, usingWorker: function () { return !!worker; } };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
