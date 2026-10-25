/* ZimiGames: Watch and learn, Go. One sentence per move from facts read off the board after
   the move is tried: stones captured, a group left with one liberty (atari), a group of its own
   rescued from atari, groups joined, the opening points, how far from the edge, and the
   computer's own playout win rate for the move. Our own code, GPL-3.0.

     ZimiExplain.go(E, st, move, { rate, playouts }) -> { text, facts }

   E is the Go engine (go-engine.js), st the state before the move, move a point index or -1 for a pass. */
(function (root) {
  'use strict';
  var BLACK = 1;
  var STAR = { 9: [20, 24, 56, 60, 40], 13: [42, 48, 120, 126, 84, 45, 81, 87, 123] };   // points as row * n + col
  var OPENING_MOVES = 8, SURE = 0.6, CLOSE = 0.45;
  var ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth'];

  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  function goExplain(E, st, mv, info) {
    info = info || {};
    var n = st.n, color = st.turn, side = color === BLACK ? 'Black' : 'White', foe = color === BLACK ? 'White' : 'Black', enemy = 3 - color;
    var facts = { side: side, pass: mv < 0, score: info.rate };
    if (mv < 0) {
      facts.pass = true;
      return { text: side + ' passes: the computer finds no move worth playing. When both sides pass, the game ends and the territory is counted.', facts: facts };
    }
    var ns = E.move(st, mv);
    var nb = E.neighbors(n);
    function name(i) { return 'ABCDEFGHJKLMN'[i % n] + (n - ((i / n) | 0)); }
    function libs(board, i) {
      var group = E.groupAt(board, n, i), seen = {}, count = 0;
      group.forEach(function (g) { nb[g].forEach(function (q) { if (!board[q] && !seen[q]) { seen[q] = 1; count++; } }); });
      return { count: count, size: group.length, group: group };
    }
    var sq = name(mv), taken = ns.taken ? ns.taken.length : 0;
    // Enemy groups touching the move that are down to one liberty now.
    var atari = [], seenG = {};
    nb[mv].forEach(function (q) {
      if (ns.board[q] !== enemy) return;
      var l = libs(ns.board, q), key = Math.min.apply(null, l.group);
      if (!seenG[key] && l.count === 1) { seenG[key] = 1; atari.push(l.size); }
    });
    // Our own groups beside the move: were they in atari before, and are they now safe?
    var rescued = null, joined = {}, ownSeen = {};
    nb[mv].forEach(function (q) {
      if (st.board[q] !== color) return;
      var before = libs(st.board, q), key = Math.min.apply(null, before.group);
      if (ownSeen[key]) return;
      ownSeen[key] = 1; joined[key] = 1;
      if (before.count === 1) { var after = libs(ns.board, mv); rescued = { size: before.size, libs: after.count }; }
    });
    var groupsJoined = Object.keys(joined).length;
    var row = (mv / n) | 0, col = mv % n, edgeDist = Math.min(row, col, n - 1 - row, n - 1 - col);
    var star = (STAR[n] || []).indexOf(mv) >= 0;
    var near = 0;
    for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) {
      var r = row + dr, c = col + dc;
      if ((dr || dc) && r >= 0 && r < n && c >= 0 && c < n && st.board[r * n + c]) near++;
    }
    facts.captured = taken; facts.atari = atari.length; facts.rescued = !!rescued; facts.joined = groupsJoined; facts.edge = edgeDist + 1; facts.star = star; facts.near = near;

    var text;
    if (taken) text = side + ' plays ' + sq + ' and captures ' + plural(taken, 'stone') + '. Stones with no liberties left are removed.';
    else if (rescued) text = side + ' plays ' + sq + ' to save a group of ' + plural(rescued.size, 'stone') + ' that was in atari (one liberty left); it now has ' + plural(rescued.libs, 'liberty') + '.';
    else if (atari.length) text = side + ' plays ' + sq + ', putting ' + (atari[0] === 1 ? 'a stone' : 'a group of ' + atari[0] + ' stones') + ' in atari: ' + foe + ' has one liberty left, and the next move there captures.';
    else if (groupsJoined >= 2) text = side + ' plays ' + sq + ' and joins ' + groupsJoined + ' groups into one, which share their liberties.';
    else if (star && st.moves < OPENING_MOVES) text = side + ' plays ' + sq + ', a star point, one of the marked points that are the usual places to start.';
    else if (edgeDist === 0) text = side + ' plays ' + sq + ' on the edge, where it has few liberties.';
    else if (near === 0) text = side + ' plays ' + sq + ', far from every stone, to claim open space (' + ORDINAL[Math.min(edgeDist, 4)] + ' line from the edge).';
    else text = side + ' plays ' + sq + ', next to stones already on the board' + (groupsJoined === 1 ? ', extending its group.' : '.');
    var r2 = info.rate;
    if (typeof r2 === 'number' && info.playouts > 0 && st.moves >= OPENING_MOVES) {
      var pct = Math.round(r2 * 100);
      text += r2 >= SURE ? ' The computer’s playouts favour ' + side + ' (' + pct + '%).' : r2 <= CLOSE ? ' The computer’s playouts favour ' + foe + ' (' + (100 - pct) + '% for ' + foe + ').' : ' The playouts see it as close.';
    }
    return { text: text, facts: facts };
  }

  root.ZimiExplain = root.ZimiExplain || {};
  root.ZimiExplain.go = goExplain;
  if (typeof module !== 'undefined' && module.exports) module.exports = goExplain;
})(typeof globalThis !== 'undefined' ? globalThis : this);
