/* ZimiGames: Hex (7, 9 or 11 a side; 11 is the classic board). Our own code, GPL-3.0.
   Red links top and bottom, Blue links left and right. The rules and the computer (pure
   functions, testable in node), then the page. */
(function (root) {
  'use strict';

  // ── the rules ────────────────────────────────────────────────────────────
  var RED = 1, BLUE = 2, INF = 999;
  var LEVELS = { easy: { top: 6 }, medium: { top: 1 }, hard: { depth: 3, width: 7 } };
  var NB_CACHE = {};

  // A cell's neighbours on the rhombus: left, right, the two above, the two below.
  function neighbors(n) {
    if (NB_CACHE[n]) return NB_CACHE[n];
    var out = [];
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var list = [], d = [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, -1], [1, 0]];
      d.forEach(function (x) { var rr = r + x[0], cc = c + x[1]; if (rr >= 0 && rr < n && cc >= 0 && cc < n) list.push(rr * n + cc); });
      out.push(list);
    }
    return (NB_CACHE[n] = out);
  }
  function empty(n) { return new Int8Array(n * n); }
  function isTarget(n, p, i) { return p === RED ? i >= n * (n - 1) : i % n === n - 1; }

  // The winner's chain as a list of cells (from their first side to their last), or null.
  function winningChain(b, n, p) {
    var nb = neighbors(n), prev = new Int16Array(n * n).fill(-2), queue = [], k, i;
    for (k = 0; k < n; k++) { i = p === RED ? k : k * n; if (b[i] === p) { prev[i] = -1; queue.push(i); } }
    for (var h = 0; h < queue.length; h++) {
      i = queue[h];
      if (isTarget(n, p, i)) { var chain = []; while (i >= 0) { chain.push(i); i = prev[i]; } return chain.reverse(); }
      for (var j = 0; j < nb[i].length; j++) { var x = nb[i][j]; if (b[x] === p && prev[x] === -2) { prev[x] = i; queue.push(x); } }
    }
    return null;
  }
  function winner(b, n) { return winningChain(b, n, RED) ? RED : winningChain(b, n, BLUE) ? BLUE : 0; }

  // ── the computer ─────────────────────────────────────────────────────────
  // The fewest empty cells p still has to fill to link its sides (own stones are free,
  // the other colour blocks): a 0-1 shortest path, level by level.
  function dist(b, n, p) {
    var nb = neighbors(n), d = new Int16Array(n * n).fill(INF), cur = [], next = [], q = 3 - p, k, i, c;
    for (k = 0; k < n; k++) {
      i = p === RED ? k : k * n;
      if (b[i] === q) continue;
      c = b[i] === p ? 0 : 1;
      if (c < d[i]) { d[i] = c; (c ? next : cur).push(i); }
    }
    for (var level = 0; cur.length || next.length; level++) {
      while (cur.length) {
        i = cur.pop();
        if (d[i] !== level) continue;
        if (isTarget(n, p, i)) return level;
        for (var j = 0; j < nb[i].length; j++) {
          var x = nb[i][j];
          if (b[x] === q) continue;
          c = b[x] === p ? 0 : 1;
          if (level + c < d[x]) { d[x] = level + c; (c ? next : cur).push(x); }
        }
      }
      cur = next; next = [];
    }
    return INF;
  }
  // How good the position is for p: the other side's distance minus ours, a little for the middle.
  function evaluate(b, n, p) {
    var mine = dist(b, n, p), theirs = dist(b, n, 3 - p);
    if (!mine) return 10000;
    if (!theirs) return -10000;
    return (theirs - mine) * 10;
  }
  function centreBonus(n, i) {
    var r = (i / n) | 0, c = i % n, m = (n - 1) / 2;
    return -(Math.abs(r - m) + Math.abs(c - m)) * 0.15;
  }
  // Empty cells with their one-move value for p, best first.
  function ranked(b, n, p) {
    var out = [];
    for (var i = 0; i < b.length; i++) {
      if (b[i]) continue;
      b[i] = p; var s = evaluate(b, n, p) + centreBonus(n, i); b[i] = 0;
      out.push({ idx: i, s: s });
    }
    out.sort(function (x, y) { return y.s - x.s; });
    return out;
  }
  function negamax(b, n, p, depth, alpha, beta, width) {
    var cs = ranked(b, n, p).slice(0, width), best = -Infinity;
    for (var i = 0; i < cs.length; i++) {
      var idx = cs[i].idx, s;
      b[idx] = p;
      if (!dist(b, n, p)) s = 10000 + depth;
      else if (depth <= 1) s = evaluate(b, n, p);
      else s = -negamax(b, n, 3 - p, depth - 1, -beta, -alpha, width);
      b[idx] = 0;
      if (s > best) best = s;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  // The computer's cell at a level.
  function chooseMove(b0, n, p, level, rng) {
    var b = b0.slice(0), cfg = LEVELS[level] || LEVELS.medium, rand = rng || Math.random, mid = (n >> 1) * n + (n >> 1), i, any = false;
    for (i = 0; i < b.length; i++) if (b[i]) { any = true; break; }
    if (!any) {
      if (level === 'easy') return mid + ((rand() * 3) | 0) - 1 + n * (((rand() * 3) | 0) - 1);
      return mid;
    }
    var r = ranked(b, n, p);
    if (!r.length) return -1;
    if (cfg.depth) {
      var cand = r.slice(0, cfg.width + 1), bestS = -Infinity, bestI = cand[0].idx;
      for (i = 0; i < cand.length; i++) {
        b[cand[i].idx] = p;
        var s = !dist(b, n, p) ? 10000 : -negamax(b, n, 3 - p, cfg.depth - 1, -Infinity, Infinity, cfg.width);
        b[cand[i].idx] = 0;
        s += centreBonus(n, cand[i].idx);
        if (s > bestS) { bestS = s; bestI = cand[i].idx; }
      }
      return bestI;
    }
    var pool = r.slice(0, cfg.top);
    return pool[(rand() * pool.length) | 0].idx;
  }
  // Whether the second player should take over the opening move (a middling move is worth taking).
  function worthSwapping(n, idx) {
    var r = (idx / n) | 0, c = idx % n, m = (n - 1) / 2, edge = Math.min(r, c, n - 1 - r, n - 1 - c);
    return edge >= 1 && Math.abs(r - m) + Math.abs(c - m) <= n * 0.55 && !(r + c <= 1 || r + c >= 2 * n - 3);
  }
  // A fair first move for the computer when the second player may swap: near an edge, not in the middle.
  function fairOpening(n, rand) {
    var pick = [[1, 2], [2, 1], [n - 3, n - 2], [n - 2, n - 3], [1, 3], [3, 1]][((rand || Math.random)() * 6) | 0];
    return pick[0] * n + pick[1];
  }

  root.HexEngine = { RED: RED, BLUE: BLUE, LEVELS: LEVELS, neighbors: neighbors, empty: empty, winner: winner, winningChain: winningChain, dist: dist, evaluate: evaluate, chooseMove: chooseMove, worthSwapping: worthSwapping, fairOpening: fairOpening };

  // ── the page ─────────────────────────────────────────────────────────────
  if (typeof document === 'undefined') return;
  var WK = root.WorldKit, BK = root.BoardKit, R = 20, SQ3 = Math.sqrt(3), PAD = 22;
  var COLORS = ['#d9453b', '#2f6fdd'], NAMES = ['Red', 'Blue'];
  var host = document.getElementById('wk-board'), cellsG, marksG, btns = [], n = 11, W = 0, Hh = 0;
  var state, history = WK.History(), last = -1, chain = null, hintIdx = -1, swapped = false, swapDone = false, moves = 0;
  var score = WK.scoreBar(document.getElementById('wk-score'), [{ color: COLORS[0] }, { color: COLORS[1] }]);
  var swapBtn = document.getElementById('hx-swap');
  var G = WK.create({
    id: 'hex',
    options: WK.standardOptions({ first: 'Red (top to bottom)', second: 'Blue (side to side)' }).concat([{ key: 'size', legend: 'Board', def: '11', choices: [['7', '7 by 7'], ['9', '9 by 9'], ['11', '11 by 11']] }]),
    checks: [{ key: 'swap', label: 'Swap rule: the second player may take over the opening move', def: false }],
    statKey: function (s) { return s.level + s.size + (s.swap ? 's' : ''); },
    onNew: newGame, onUndo: undo, onHint: hint
  });

  // Who plays colour c (0 red, 1 blue) now: the sides swap when the swap rule is used.
  function isHuman(c) { return !G.vsComputer() || ((G.settings.side === 'second' ? 1 : 0) ^ (swapped ? 1 : 0)) === c; }
  function nameOf(c) {
    if (!G.vsComputer()) return NAMES[c] + (swapped ? '' : '');
    return isHuman(c) ? 'You' : 'Computer';
  }

  function cx(r, c) { return PAD + R * SQ3 * (c + r / 2) + R * SQ3 / 2; }
  function cy(r) { return PAD + R * (1 + 1.5 * r); }
  function vert(r, c, k) { var a = (60 * k + 30) * Math.PI / 180; return [cx(r, c) + R * Math.cos(a), cy(r) + R * Math.sin(a)]; }
  function pts(list) { return list.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '); }
  function hexPoly(r, c, shrink) {
    var out = [];
    for (var k = 0; k < 6; k++) { var a = (60 * k + 30) * Math.PI / 180, rr = R - (shrink || 0); out.push([cx(r, c) + rr * Math.cos(a), cy(r) + rr * Math.sin(a)]); }
    return pts(out);
  }
  function sidePaths() {
    var top = [], bottom = [], left = [vert(0, 0, 3)], right = [vert(0, n - 1, 4)], c, r;
    for (c = 0; c < n; c++) { top.push(vert(0, c, 3), vert(0, c, 4), vert(0, c, 5)); bottom.push(vert(n - 1, c, 2), vert(n - 1, c, 1), vert(n - 1, c, 0)); }
    for (r = 0; r < n; r++) { left.push(vert(r, 0, 2), vert(r, 0, 1)); right.push(vert(r, n - 1, 5), vert(r, n - 1, 0)); }
    return '<polyline points="' + pts(top) + '" class="hx-side r"/><polyline points="' + pts(bottom) + '" class="hx-side r"/>' +
      '<polyline points="' + pts(left) + '" class="hx-side b"/><polyline points="' + pts(right) + '" class="hx-side b"/>';
  }
  function coord(i) { return 'ABCDEFGHIJK'[i % n] + (((i / n) | 0) + 1); }

  function buildBoard() {
    n = +G.settings.size;
    W = 2 * PAD + R * SQ3 * (n + (n - 1) / 2); Hh = 2 * PAD + R * (2 + 1.5 * (n - 1));
    host.innerHTML = '<svg viewBox="0 0 ' + W.toFixed(0) + ' ' + Hh.toFixed(0) + '" aria-hidden="true"><g id="hx-cells"></g>' + sidePaths() + '<g id="hx-marks"></g></svg>';
    cellsG = host.querySelector('#hx-cells'); marksG = host.querySelector('#hx-marks');
    var p = [];
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) p.push({ x: cx(r, c), y: cy(r), w: R * SQ3 * 0.98, h: R * 1.7 });
    btns = WK.overlay(host, W, Hh, p, onCell, 'hx-pt');
    host.style.setProperty('--ratio', (W / Hh).toFixed(3));
  }

  function paint() {
    var b = state.board, s = '', m = '', i, open = !G.over && !G.thinking && isHuman(state.turn) && !swapAsk();
    for (i = 0; i < n * n; i++) {
      var r = (i / n) | 0, c = i % n;
      s += '<polygon points="' + hexPoly(r, c, 0.8) + '" class="hx-cell' + (b[i] ? ' s' + b[i] : '') + '"/>';
    }
    if (last >= 0) m += '<circle cx="' + cx((last / n) | 0, last % n) + '" cy="' + cy((last / n) | 0) + '" r="5" class="hx-last"/>';
    if (chain) chain.forEach(function (j) { m += '<circle cx="' + cx((j / n) | 0, j % n) + '" cy="' + cy((j / n) | 0) + '" r="6.5" class="hx-win"/>'; });
    if (hintIdx >= 0) m += '<polygon points="' + hexPoly((hintIdx / n) | 0, hintIdx % n, 3) + '" class="hx-hint"/>';
    cellsG.innerHTML = s; marksG.innerHTML = m;
    btns.forEach(function (bt, j) { bt.setAttribute('aria-label', coord(j) + ', ' + (b[j] === 1 ? 'red' : b[j] === 2 ? 'blue' : 'empty')); bt.setAttribute('aria-disabled', (!open || b[j]) ? 'true' : 'false'); });
    var names = [nameOf(0), nameOf(1)];
    score(names, null, G.over ? -1 : state.turn);
    swapBtn.hidden = !(swapAsk() && isHuman(state.turn) && !G.over);
    G.setUndo(history.size() > 0); G.setHint(open);
  }
  // The second player may still take over the first move.
  function swapAsk() { return G.settings.swap && moves === 1 && !swapDone && !G.over; }

  function turnText() {
    var c = state.turn;
    if (swapAsk() && isHuman(c)) return 'You may swap sides and take the first move, or play as ' + NAMES[c].toLowerCase();
    if (!G.vsComputer()) return NAMES[c] + ' to play';
    return isHuman(c) ? 'Your move (' + NAMES[c].toLowerCase() + ', ' + (c ? 'left to right' : 'top to bottom') + ')' : 'Computer is thinking';
  }

  function onCell(i) { if (G.over || G.thinking || !isHuman(state.turn) || state.board[i]) return; place(i); }

  function snapshot() { return { board: state.board, turn: state.turn, last: last, swapped: swapped, swapDone: swapDone, moves: moves }; }

  function place(i) {
    history.push(snapshot());
    var nb = state.board.slice(0), c = state.turn;
    nb[i] = c + 1; state = { board: nb, turn: 1 - c }; last = i; hintIdx = -1; moves++;
    var ch = winningChain(nb, n, c + 1);
    if (ch) {
      chain = ch; paint();
      G.finish(G.vsComputer() ? (isHuman(c) ? 'You win: your chain links both sides.' : 'The computer wins: its chain links both sides.') : NAMES[c] + ' wins: the chain links both sides.',
        G.vsComputer() ? (isHuman(c) ? 'w' : 'l') : null, G.vsComputer() && isHuman(c) ? 'You win' : 'Game over');
      return;
    }
    afterMove();
  }

  function afterMove() {
    paint(); G.say(turnText(), !isHuman(state.turn));
    if (isHuman(state.turn)) return;
    G.later(function () {
      if (swapAsk() && G.vsComputer() && worthSwapping(n, last)) { doSwap(); return; }
      place(chooseMove(state.board, n, state.turn + 1, G.settings.level));
    });
  }

  // Swap: the colours change hands, the stone stays; the other player is now to move.
  function doSwap() {
    history.push(snapshot());
    swapped = !swapped; swapDone = true; paint();
    G.say(G.vsComputer() ? (isHuman(0) ? 'The computer swapped sides. You are red now, and it is your move.' : 'The computer swapped sides. You are blue now. Your move.') : 'Sides swapped. ' + turnText());
    if (!isHuman(state.turn)) G.later(function () { place(chooseMove(state.board, n, state.turn + 1, G.settings.level)); });
  }
  swapBtn.addEventListener('click', function () { if (swapAsk() && isHuman(state.turn) && !G.thinking) doSwap(); });

  function hint() {
    hintIdx = chooseMove(state.board, n, state.turn + 1, 'hard');
    paint(); G.say('A good cell is outlined. ' + turnText());
  }

  function undo() {
    if (!history.size()) return;
    G.cancel(); G.over = false; chain = null; hintIdx = -1;
    var h;
    do {
      h = history.pop(); swapped = h.swapped; swapDone = h.swapDone; state = { board: h.board, turn: h.turn };
    } while (history.size() && G.vsComputer() && !isHuman(h.turn));
    last = h.last; moves = h.moves;
    paint(); G.say(turnText());
    if (!isHuman(state.turn)) afterMoveAgain();
  }
  function afterMoveAgain() { G.later(function () { place(chooseMove(state.board, n, state.turn + 1, G.settings.level)); }); }

  function newGame() {
    if (+G.settings.size !== n || !cellsG) buildBoard();
    history.clear(); chain = null; hintIdx = -1; last = -1; swapped = false; swapDone = false; moves = 0;
    state = { board: empty(n), turn: 0 };
    paint(); G.say(turnText(), !isHuman(0));
    if (!isHuman(0)) G.later(function () { place(G.settings.swap ? fairOpening(n) : chooseMove(state.board, n, 1, G.settings.level)); });
  }

  G.newGame();
  if (new URLSearchParams(location.search).has('debug')) root.__hx = { state: function () { return state; }, engine: root.HexEngine, n: function () { return n; } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
