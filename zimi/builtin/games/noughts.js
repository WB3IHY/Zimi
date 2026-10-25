/* ZimiGames: Noughts and Crosses. Our own code, GPL-3.0. No network, no fonts, no modules.
   The rules and the computer (pure functions, no DOM, so node can test them) and the page (only when there is a document). */
(function (root) {
  'use strict';

  // ── the rules ────────────────────────────────────────────────────────────
  var LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  var EASY_TAKES_WIN = 0.6, EASY_BLOCKS = 0.35; // the easy computer sees a win or a block only some of the time

  function mulberry(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function emptyBoard() { return [null, null, null, null, null, null, null, null, null]; }
  // The winning line, [a, b, c], or null.
  function winLine(b) {
    for (var i = 0; i < LINES.length; i++) { var l = LINES[i]; if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return l; }
    return null;
  }
  function winner(b) { var l = winLine(b); return l ? b[l[0]] : null; }
  function full(b) { return b.every(Boolean); }
  function moves(b) { var m = []; for (var i = 0; i < 9; i++) if (!b[i]) m.push(i); return m; }
  function other(p) { return p === 'X' ? 'O' : 'X'; }
  function play(b, i, p) { if (b[i] || winner(b)) return false; b[i] = p; return true; }

  // Minimax from the point of view of `me`, to move as `turn`: a win scores more the sooner it comes.
  function value(b, turn, me, depth, memo) {
    var w = winner(b);
    if (w) return w === me ? 10 - depth : depth - 10;
    if (full(b)) return 0;
    var key = b.join('-') + turn, seen = memo[key]; // the same position reached by another order of moves
    if (seen !== undefined) return seen;
    var best = turn === me ? -99 : 99;
    for (var i = 0; i < 9; i++) {
      if (b[i]) continue;
      b[i] = turn;
      var v = value(b, other(turn), me, depth + 1, memo);
      b[i] = null;
      if (turn === me ? v > best : v < best) best = v;
    }
    memo[key] = best;
    return best;
  }
  // Every best move for `me`.
  function perfectMoves(b, me) {
    var best = -99, out = [], memo = {};
    moves(b).forEach(function (i) {
      b[i] = me; var v = value(b, other(me), me, 1, memo); b[i] = null;
      if (v > best) { best = v; out = [i]; } else if (v === best) out.push(i);
    });
    return out;
  }
  // A move that wins at once for `p`, or -1.
  function winningMove(b, p) {
    var m = moves(b);
    for (var k = 0; k < m.length; k++) { b[m[k]] = p; var w = winner(b) === p; b[m[k]] = null; if (w) return m[k]; }
    return -1;
  }
  function pick(list, rng) { return list[Math.floor(rng() * list.length)]; }

  // The computer's move as `me`: 'perfect' never loses; 'easy' mostly plays at random.
  function bestMove(b, me, level, rng) {
    rng = rng || Math.random;
    var open = moves(b);
    if (!open.length) return -1;
    if (level !== 'easy') return pick(perfectMoves(b, me), rng);
    var win = winningMove(b, me), block = winningMove(b, other(me));
    if (win >= 0 && rng() < EASY_TAKES_WIN) return win;
    if (block >= 0 && rng() < EASY_BLOCKS) return block;
    return pick(open, rng);
  }

  var Engine = { LINES: LINES, emptyBoard: emptyBoard, winLine: winLine, winner: winner, full: full, moves: moves, other: other, play: play, bestMove: bestMove, perfectMoves: perfectMoves, mulberry: mulberry };
  root.NoughtsEngine = Engine;

  if (typeof document === 'undefined') return;

  // ── the page ─────────────────────────────────────────────────────────────
  var Play = root.ArcadePlay, $ = Play.$;
  var SETTINGS_KEY = 'zimi.games.noughts.settings', STATS_KEY = 'zimi.games.noughts.stats', CPU_DELAY_MS = 420;
  Play.applyTheme();

  var els = { board: $('nc-board'), msg: $('nc-msg'), a: $('nc-a'), b: $('nc-b'), d: $('nc-d'), aName: $('nc-a-name'), bName: $('nc-b-name'), sheet: $('nc-sheet'), title: $('nc-sheet-title'), text: $('nc-sheet-text'), go: $('nc-go'),
    opp: $('nc-opp'), level: $('nc-level'), mark: $('nc-mark'), levelRow: $('nc-level-row'), markRow: $('nc-mark-row'), nu: $('nc-new') };
  var settings = Play.load(SETTINGS_KEY, { opp: 'cpu', level: 'perfect', mark: 'X' }), stats = Play.load(STATS_KEY, { a: 0, b: 0, d: 0 });
  var board = emptyBoard(), turn = 'X', over = true, timer = null, cells = [], me = 'X', cpu = null, starts = 'X';

  function build() {
    els.board.textContent = '';
    cells = [];
    for (var i = 0; i < 9; i++) {
      var c = document.createElement('button'); c.type = 'button'; c.className = 'nc-cell'; c.setAttribute('role', 'gridcell');
      (function (n) { c.addEventListener('click', function () { click(n); }); })(i);
      els.board.appendChild(c); cells.push(c);
    }
    els.board.addEventListener('keydown', function (e) {
      var i = cells.indexOf(document.activeElement); if (i < 0) return;
      var d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key]; if (!d) return;
      e.preventDefault();
      var k = i + d; if (k >= 0 && k < 9 && !(Math.abs(d) === 1 && Math.floor(k / 3) !== Math.floor(i / 3))) cells[k].focus();
    });
  }
  function paint() {
    var line = winLine(board);
    cells.forEach(function (c, i) {
      var m = board[i];
      if (m) c.dataset.m = m; else delete c.dataset.m;
      c.setAttribute('aria-label', 'Row ' + (Math.floor(i / 3) + 1) + ', column ' + (i % 3 + 1) + ': ' + (m === 'X' ? 'cross' : m === 'O' ? 'nought' : 'empty'));
      c.setAttribute('aria-disabled', String(!!m || over || (cpu !== null && turn === cpu)));
      c.classList.toggle('nc-win', !!line && line.indexOf(i) >= 0);
    });
    els.a.textContent = stats.a; els.b.textContent = stats.b; els.d.textContent = stats.d;
    els.aName.textContent = settings.opp === 'cpu' ? 'You' : 'Crosses'; els.bName.textContent = settings.opp === 'cpu' ? 'Computer' : 'Noughts';
  }

  function say() {
    if (over) return;
    if (settings.opp === 'two') els.msg.textContent = (turn === 'X' ? 'Crosses' : 'Noughts') + ' to play.';
    else els.msg.textContent = turn === cpu ? 'The computer is thinking.' : 'Your turn.';
  }
  function end() {
    var w = winner(board);
    over = true;
    var text;
    if (w) {
      var mine = settings.opp === 'cpu' ? (w === me ? 'a' : 'b') : (w === 'X' ? 'a' : 'b');
      stats[mine]++;
      text = settings.opp === 'cpu' ? (w === me ? 'You win.' : 'The computer wins.') : (w === 'X' ? 'Crosses win.' : 'Noughts win.');
    } else { stats.d++; text = 'A draw.'; }
    Play.save(STATS_KEY, stats);
    els.msg.textContent = text; paint();
    Play.later(function () { showSheet('Game over', text, 'Play again'); }, 900);
  }
  function move(i) {
    if (!play(board, i, turn)) return;
    if (winner(board) || full(board)) { paint(); return end(); }
    turn = other(turn); paint(); say();
    if (cpu && turn === cpu) timer = Play.later(function () { move(bestMove(board, cpu, settings.level, Math.random)); }, CPU_DELAY_MS);
  }
  function click(i) { if (over || (cpu && turn === cpu)) return; move(i); }

  function paintSeg(el, items, current, set) {
    el.textContent = '';
    items.forEach(function (it) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = it[1]; b.setAttribute('aria-pressed', String(current === it[0]));
      b.addEventListener('click', function () { set(it[0]); });
      el.appendChild(b);
    });
  }
  function paintSetup() {
    paintSeg(els.opp, [['cpu', 'The computer'], ['two', 'A friend']], settings.opp, function (v) { settings.opp = v; Play.save(SETTINGS_KEY, settings); paintSetup(); });
    paintSeg(els.level, [['easy', 'Easy'], ['perfect', 'Perfect']], settings.level, function (v) { settings.level = v; Play.save(SETTINGS_KEY, settings); paintSetup(); });
    paintSeg(els.mark, [['X', 'Crosses (first)'], ['O', 'Noughts (second)']], settings.mark, function (v) { settings.mark = v; Play.save(SETTINGS_KEY, settings); paintSetup(); });
    els.levelRow.hidden = els.markRow.hidden = settings.opp === 'two';
  }
  function showSheet(title, text, label) { els.title.textContent = title; els.text.textContent = text; els.go.textContent = label; paintSetup(); Play.openSheet(els.sheet, '#nc-go'); }
  function begin() {
    if (timer) timer.cancel();
    board = emptyBoard(); over = false; turn = 'X'; me = settings.mark; cpu = settings.opp === 'cpu' ? other(me) : null;
    Play.closeSheet(els.sheet); paint(); say();
    if (cpu === 'X') timer = Play.later(function () { move(bestMove(board, cpu, settings.level, Math.random)); }, CPU_DELAY_MS);
    else { var first = cells.find(function (c) { return c.getAttribute('aria-disabled') !== 'true'; }); if (first) first.focus({ preventScroll: true }); }
  }
  els.go.addEventListener('click', begin);
  els.nu.addEventListener('click', function () { if (timer) timer.cancel(); over = true; showSheet('New game', 'Choose who to play and which mark you take.', 'Start'); });

  build(); paint();
  showSheet('Noughts and Crosses', 'Three in a row wins. Play the computer, easy or perfect, or a friend on the same screen.', 'Start');
  root.__noughts = { get board() { return board; }, get turn() { return turn; } };
})(this);
