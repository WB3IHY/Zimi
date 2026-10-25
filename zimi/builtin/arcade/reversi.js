/* Zimi Arcade: Reversi. Our own code, GPL-3.0. No network, no fonts, no modules.
   Two halves: the rules and the computer player (pure functions, testable in node),
   then the page (runs only when there is a document). */
(function (root) {
  'use strict';

  // ── the rules ────────────────────────────────────────────────────────────
  var EMPTY = 0, BLACK = 1, WHITE = 2, N = 8, SIZE = 64;
  var DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  var WIN_SCORE = 100000;
  var EXACT_EMPTIES = 9; // with this few empty squares the computer plays the game out to the end

  // Corners are gold, the squares beside them are poison, edges are good.
  var WEIGHTS = [
    120, -25, 10, 5, 5, 10, -25, 120,
    -25, -45, -2, -2, -2, -2, -45, -25,
    10, -2, 3, 1, 1, 3, -2, 10,
    5, -2, 1, 0, 0, 1, -2, 5,
    5, -2, 1, 0, 0, 1, -2, 5,
    10, -2, 3, 1, 1, 3, -2, 10,
    -25, -45, -2, -2, -2, -2, -45, -25,
    120, -25, 10, 5, 5, 10, -25, 120
  ];
  var LEVELS = { easy: { depth: 1, noise: 40 }, medium: { depth: 3, noise: 0 }, hard: { depth: 5, noise: 0 } };

  function other(p) { return p === BLACK ? WHITE : BLACK; }

  function initial() {
    var b = new Int8Array(SIZE);
    b[27] = WHITE; b[36] = WHITE; b[28] = BLACK; b[35] = BLACK;
    return b;
  }

  // The discs p would flip by playing idx ([] when the move is illegal).
  function flipsFor(b, p, idx) {
    if (b[idx] !== EMPTY) return [];
    var r0 = (idx / N) | 0, c0 = idx % N, out = [], q = other(p);
    for (var d = 0; d < 8; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1], r = r0 + dr, c = c0 + dc, run = [];
      while (r >= 0 && r < N && c >= 0 && c < N && b[r * N + c] === q) { run.push(r * N + c); r += dr; c += dc; }
      if (run.length && r >= 0 && r < N && c >= 0 && c < N && b[r * N + c] === p) out = out.concat(run);
    }
    return out;
  }

  function legalMoves(b, p) {
    var out = [];
    for (var i = 0; i < SIZE; i++) {
      if (b[i] !== EMPTY) continue;
      var f = flipsFor(b, p, i);
      if (f.length) out.push({ idx: i, flips: f });
    }
    return out;
  }

  // Whether p could play idx, without building the list of flips (the search asks this a lot).
  function canPlay(b, p, idx) {
    if (b[idx] !== EMPTY) return false;
    var r0 = (idx / N) | 0, c0 = idx % N, q = other(p);
    for (var d = 0; d < 8; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1], r = r0 + dr, c = c0 + dc, n = 0;
      while (r >= 0 && r < N && c >= 0 && c < N && b[r * N + c] === q) { n++; r += dr; c += dc; }
      if (n && r >= 0 && r < N && c >= 0 && c < N && b[r * N + c] === p) return true;
    }
    return false;
  }
  function countMoves(b, p) { var n = 0; for (var i = 0; i < SIZE; i++) if (canPlay(b, p, i)) n++; return n; }
  function hasMove(b, p) {
    for (var i = 0; i < SIZE; i++) if (canPlay(b, p, i)) return true;
    return false;
  }

  function play(b, p, idx, flips) {
    var nb = b.slice(0);
    nb[idx] = p;
    for (var i = 0; i < flips.length; i++) nb[flips[i]] = p;
    return nb;
  }

  function count(b) {
    var k = { black: 0, white: 0, empty: 0 };
    for (var i = 0; i < SIZE; i++) { if (b[i] === BLACK) k.black++; else if (b[i] === WHITE) k.white++; else k.empty++; }
    return k;
  }

  function isOver(b) { return !hasMove(b, BLACK) && !hasMove(b, WHITE); }

  // Who is to move after p has played: the opponent, or p again after a pass, or nobody.
  function nextTurn(b, p) {
    if (hasMove(b, other(p))) return other(p);
    if (hasMove(b, p)) return p;
    return 0;
  }

  // ── the computer ─────────────────────────────────────────────────────────
  function evaluate(b, me) {
    var you = other(me), pos = 0, discs = 0, i;
    for (i = 0; i < SIZE; i++) {
      if (b[i] === me) { pos += WEIGHTS[i]; discs++; } else if (b[i] === you) { pos -= WEIGHTS[i]; discs--; }
    }
    var mine = countMoves(b, me), theirs = countMoves(b, you);
    var mobility = mine + theirs ? 100 * (mine - theirs) / (mine + theirs) : 0;
    return pos + 0.6 * mobility + discs * 0.5;
  }

  function discDiff(b, me) { var k = count(b); return me === BLACK ? k.black - k.white : k.white - k.black; }

  // Moves ordered by their square's weight, so the alpha-beta cut-offs come early.
  function ordered(b, p) {
    var m = legalMoves(b, p);
    m.sort(function (x, y) { return WEIGHTS[y.idx] - WEIGHTS[x.idx]; });
    return m;
  }

  // Negamax from `p`'s side: the score is for p. `me` stays the side the leaf eval is read for.
  function search(b, p, depth, alpha, beta, exact) {
    var moves = ordered(b, p);
    if (!moves.length) {
      var opp = ordered(b, other(p));
      if (!opp.length) { var d = discDiff(b, p); return d === 0 ? 0 : (d > 0 ? WIN_SCORE : -WIN_SCORE) + d; }
      return -search(b, other(p), depth, -beta, -alpha, exact);
    }
    if (depth <= 0 && !exact) return evaluate(b, p);
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var s = -search(play(b, p, moves[i].idx, moves[i].flips), other(p), depth - 1, -beta, -alpha, exact);
      if (s > best) best = s;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // The computer's move at a level: { idx, flips } or null when it must pass.
  function chooseMove(b, p, level, rng) {
    var moves = ordered(b, p);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];
    var cfg = LEVELS[level] || LEVELS.medium, rand = rng || Math.random;
    var empties = count(b).empty, exact = level === 'hard' && empties <= EXACT_EMPTIES;
    var depth = exact ? empties : cfg.depth, best = null, bestScore = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var nb = play(b, p, moves[i].idx, moves[i].flips);
      var s = depth <= 1 && !exact ? -evaluate(nb, other(p)) : -search(nb, other(p), depth - 1, -Infinity, Infinity, exact);
      if (cfg.noise && !exact) s += (rand() - 0.5) * 2 * cfg.noise;
      if (s > bestScore) { bestScore = s; best = moves[i]; }
    }
    return best;
  }

  var Engine = {
    EMPTY: EMPTY, BLACK: BLACK, WHITE: WHITE, N: N, LEVELS: LEVELS,
    other: other, initial: initial, flipsFor: flipsFor, legalMoves: legalMoves, hasMove: hasMove, play: play,
    count: count, isOver: isOver, nextTurn: nextTurn, chooseMove: chooseMove, evaluate: evaluate
  };
  root.ReversiEngine = Engine;

  // ── the page ─────────────────────────────────────────────────────────────
  if (typeof document === 'undefined') return;
  var BK = root.BoardKit, $ = function (id) { return document.getElementById(id); };
  var SETTINGS_KEY = 'reversi.settings', STATS_KEY = 'reversi.stats';
  var settings = BK.load(SETTINGS_KEY, {});
  if (!LEVELS[settings.level]) settings.level = 'medium';
  if (settings.mode !== 'two') settings.mode = 'cpu';
  if (settings.side !== 'white') settings.side = 'black';
  if (settings.hints !== false) settings.hints = true;
  var stats = BK.load(STATS_KEY, {});
  var COMPUTER_DELAY_MS = 380;

  var els = { board: $('rv-board'), status: $('rv-status'), black: $('rv-black'), white: $('rv-white'), undo: $('rv-undo'), stats: $('rv-stats') };
  var cells = [], state, history = [], thinking = 0, lastMove = -1, flipped = [], over = false;

  function human(p) { return settings.mode === 'two' || p === (settings.side === 'black' ? BLACK : WHITE); }
  function name(p) {
    if (settings.mode === 'two') return p === BLACK ? 'Black' : 'White';
    return human(p) ? 'You' : 'Computer';
  }

  function buildBoard() {
    els.board.textContent = '';
    for (var i = 0; i < SIZE; i++) {
      var c = document.createElement('button');
      c.type = 'button'; c.className = 'bg-sq'; c.dataset.i = i;
      c.addEventListener('click', onSquare);
      els.board.appendChild(c); cells.push(c);
    }
    BK.gridNav(els.board, cells, N);
  }

  function coord(i) { return 'abcdefgh'[i % N] + (N - ((i / N) | 0)); }

  function paint() {
    var b = state.board, legal = {}, moves = over ? [] : legalMoves(b, state.turn), i;
    if (settings.hints && human(state.turn) && !thinking) moves.forEach(function (m) { legal[m.idx] = 1; });
    for (i = 0; i < SIZE; i++) {
      var c = cells[i], v = b[i], disc = c.firstChild;
      if (v && !disc) { disc = document.createElement('span'); c.appendChild(disc); }
      if (!v && disc) { c.removeChild(disc); disc = null; }
      if (disc) {
        disc.className = 'rv-disc ' + (v === BLACK ? 'b' : 'w') + (flipped.indexOf(i) >= 0 ? ' flip' : '');
      }
      c.className = 'bg-sq' + ((i + ((i / N) | 0)) % 2 ? ' dk' : '') + (legal[i] ? ' hint' : '') + (i === lastMove ? ' last' : '');
      c.setAttribute('aria-label', coord(i) + ', ' + (v === BLACK ? 'black' : v === WHITE ? 'white' : legal[i] ? 'legal move' : 'empty'));
    }
    var k = count(b);
    els.black.textContent = k.black; els.white.textContent = k.white;
    els.undo.disabled = !history.length || !!thinking;
  }

  function say(html, busy) {
    els.status.textContent = '';
    if (busy) { var s = document.createElement('span'); s.className = 'bg-spin'; els.status.appendChild(s); }
    els.status.appendChild(document.createTextNode(html));
  }

  function showStats() {
    var s = stats[settings.level] || { w: 0, l: 0, d: 0 };
    els.stats.textContent = settings.mode === 'cpu' ? 'vs ' + settings.level + ': ' + s.w + ' won, ' + s.l + ' lost, ' + s.d + ' drawn' : 'Two players on this device';
  }

  function finish() {
    over = true;
    var k = count(state.board), msg;
    if (k.black === k.white) msg = 'A draw, ' + k.black + ' each.';
    else {
      var w = k.black > k.white ? BLACK : WHITE, top = Math.max(k.black, k.white), low = Math.min(k.black, k.white);
      msg = (settings.mode === 'two' ? (w === BLACK ? 'Black' : 'White') + ' wins' : human(w) ? 'You win' : 'The computer wins') + ', ' + top + ' to ' + low + '.';
    }
    if (settings.mode === 'cpu') {
      var s = stats[settings.level] = stats[settings.level] || { w: 0, l: 0, d: 0 };
      if (k.black === k.white) s.d++; else if (human(k.black > k.white ? BLACK : WHITE)) s.w++; else s.l++;
      BK.save(STATS_KEY, stats);
    }
    paint(); say(msg); showStats();
    $('rv-result-text').textContent = msg;
    resultSheet.open($('rv-again'));
  }

  function afterMove() {
    var p = state.turn, next = nextTurn(state.board, p);
    if (!next) { finish(); return; }
    var passed = next === p ? other(p) : 0;
    state.turn = next;
    paint();
    var base = settings.mode === 'two' ? (next === BLACK ? 'Black' : 'White') + ' to move' : human(next) ? 'Your move' : 'Computer is thinking';
    say((passed ? name(passed) + (settings.mode === 'cpu' && human(passed) ? ' have' : ' has') + ' no move and passes. ' : '') + base, !human(next));
    if (!human(next)) scheduleComputer();
  }

  function commit(idx, flips) {
    history.push({ board: state.board, turn: state.turn, last: lastMove });
    var p = state.turn;
    state = { board: play(state.board, p, idx, flips), turn: p };
    lastMove = idx; flipped = BK.reducedMotion() ? [] : flips;
    afterMove();
  }

  function scheduleComputer() {
    var token = ++thinking;
    paint();
    setTimeout(function () {
      if (token !== thinking) return;
      var m = chooseMove(state.board, state.turn, settings.level);
      thinking = 0;
      if (m) commit(m.idx, m.flips);
    }, COMPUTER_DELAY_MS);
  }

  function onSquare(e) {
    if (over || thinking || !human(state.turn)) return;
    var i = +e.currentTarget.dataset.i, f = flipsFor(state.board, state.turn, i);
    if (!f.length) {
      cells[i].classList.add('bad'); setTimeout(function () { cells[i].classList.remove('bad'); }, 260);
      return;
    }
    commit(i, f);
  }

  function undo() {
    if (!history.length) return;
    thinking = 0; over = false; flipped = [];
    var h;
    do { h = history.pop(); } while (history.length && settings.mode === 'cpu' && !human(h.turn));
    state = { board: h.board, turn: h.turn }; lastMove = h.last;
    paint();
    say(settings.mode === 'two' ? (state.turn === BLACK ? 'Black' : 'White') + ' to move' : 'Your move');
    if (!human(state.turn)) scheduleComputer();
  }

  function newGame() {
    thinking = 0; over = false; history = []; lastMove = -1; flipped = [];
    state = { board: initial(), turn: BLACK };
    resultSheet.close();
    paint(); showStats();
    if (human(BLACK)) say(settings.mode === 'two' ? 'Black to move' : 'Your move, you play black');
    else { say('Computer is thinking', true); scheduleComputer(); }
  }

  // ── bar, menu, keys ──
  var menu = BK.sheet($('rv-sheet')), resultSheet = BK.sheet($('rv-result'));
  function syncMenu() {
    BK.chipSet($('rv-f-mode'), settings.mode); BK.chipSet($('rv-f-level'), settings.level);
    BK.chipSet($('rv-f-side'), settings.side); $('rv-hints').checked = settings.hints;
    refreshMenu();
  }
  // Opponent vs two players: the level and side only matter against the computer.
  function refreshMenu() {
    var two = BK.chipValue($('rv-f-mode')) === 'two';
    $('rv-f-level').disabled = two; $('rv-f-side').disabled = two;
    $('rv-f-level').style.opacity = $('rv-f-side').style.opacity = two ? 0.45 : 1;
  }
  $('rv-new').addEventListener('click', function () { syncMenu(); menu.open(); });
  $('rv-f-mode').addEventListener('change', refreshMenu);
  $('rv-cancel').addEventListener('click', menu.close);
  $('rv-start').addEventListener('click', function () {
    settings.mode = BK.chipValue($('rv-f-mode')); settings.level = BK.chipValue($('rv-f-level'));
    settings.side = BK.chipValue($('rv-f-side')); settings.hints = $('rv-hints').checked;
    BK.save(SETTINGS_KEY, settings);
    menu.close(); newGame();
  });
  $('rv-again').addEventListener('click', newGame);
  $('rv-close').addEventListener('click', function () { resultSheet.close(); });
  els.undo.addEventListener('click', undo);
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input')) return;
    if (e.key === 'n' || e.key === 'N') { syncMenu(); menu.open(); } else if (e.key === 'u' || e.key === 'U') undo();
  });

  buildBoard();
  newGame();

  if (new URLSearchParams(location.search).has('debug')) {
    root.__rv = { state: function () { return state; }, engine: Engine, settings: settings };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
