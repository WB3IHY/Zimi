/* ZimiGames: Watch and learn, Reversi. One sentence for a move, from facts checked on the
   board: corners and edges, discs flipped, how many moves the opponent has before and after,
   passes forced, and the squares beside an empty corner. Our own code, GPL-3.0.

     ZimiExplain.reversi(E, board, player, move) -> { text, facts }

   E is ReversiEngine (reversi.js); move is { idx, flips }. */
(function (root) {
  'use strict';
  var N = 8, FEW_MOVES = 2;
  var CORNERS = [0, 7, 56, 63];
  // The three squares touching each corner: the two on its edge, and the diagonal one (the X square).
  var NEAR = { 0: [1, 8, 9], 7: [6, 15, 14], 56: [48, 57, 49], 63: [55, 62, 54] };

  function coord(i) { return 'abcdefgh'[i % N] + (N - ((i / N) | 0)); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function reversiExplain(E, b, p, m) {
    var side = p === E.BLACK ? 'Black' : 'White', other = E.other(p), sq = coord(m.idx);
    var after = E.play(b, p, m.idx, m.flips);
    var before = E.legalMoves(b, other).length, theirs = E.legalMoves(after, other).length;
    var passes = theirs === 0 && E.legalMoves(after, p).length > 0;
    var over = theirs === 0 && E.legalMoves(after, p).length === 0;
    var row = (m.idx / N) | 0, col = m.idx % N, edge = row === 0 || row === N - 1 || col === 0 || col === N - 1;
    var corner = CORNERS.indexOf(m.idx) >= 0;
    // A square next to a corner that is still empty gives that corner away.
    var besideCorner = null;
    CORNERS.forEach(function (c) { if (b[c] === E.EMPTY && NEAR[c].indexOf(m.idx) >= 0) besideCorner = c; });
    var cornerOpen = besideCorner !== null && E.legalMoves(after, other).some(function (x) { return x.idx === besideCorner; });
    var k = E.count(after), mine = p === E.BLACK ? k.black : k.white;
    var facts = { side: side, square: sq, flips: m.flips.length, corner: corner, edge: edge, before: before, after: theirs, passes: passes, besideCorner: besideCorner !== null, cornerOpen: cornerOpen, over: over };

    var text;
    if (over) text = side + ' plays ' + sq + ', flipping ' + plural(m.flips.length, 'disc') + ', and neither side has a move left: the game is over.';
    else if (corner) text = side + ' takes the corner ' + sq + ', flipping ' + plural(m.flips.length, 'disc') + '. A corner disc can never be flipped back.';
    else if (passes) text = side + ' plays ' + sq + ' and leaves ' + (p === E.BLACK ? 'White' : 'Black') + ' with no legal move, so ' + side + ' goes again.';
    else if (theirs > 0 && theirs <= FEW_MOVES && theirs < before) text = side + ' plays ' + sq + ', cutting the opponent’s choices from ' + before + ' to ' + theirs + '.';
    else if (cornerOpen) text = side + ' plays ' + sq + ' beside the empty corner, which now lets the opponent take it. A risk.';
    else if (besideCorner !== null) text = side + ' plays ' + sq + ' beside an empty corner; the opponent cannot reach the corner yet.';
    else if (edge && theirs < before) text = side + ' takes the edge square ' + sq + ' and trims the opponent’s moves from ' + before + ' to ' + theirs + '.';
    else if (edge) text = side + ' takes the edge square ' + sq + ', flipping ' + plural(m.flips.length, 'disc') + '. Edge discs are hard to flip.';
    else if (m.flips.length <= 2 && theirs < before) text = side + ' flips only ' + plural(m.flips.length, 'disc') + ' at ' + sq + ', which shrinks the opponent’s moves from ' + before + ' to ' + theirs + '.';
    else if (theirs < before) text = side + ' plays ' + sq + ', flipping ' + plural(m.flips.length, 'disc') + ' and cutting the opponent’s moves from ' + before + ' to ' + theirs + '.';
    else text = side + ' plays ' + sq + ', flipping ' + plural(m.flips.length, 'disc') + '; ' + side + ' now has ' + mine + ' of ' + (k.black + k.white) + ' discs.';
    return { text: text, facts: facts };
  }

  root.ZimiExplain = root.ZimiExplain || {};
  root.ZimiExplain.reversi = reversiExplain;
  if (typeof module !== 'undefined' && module.exports) module.exports = reversiExplain;
})(typeof globalThis !== 'undefined' ? globalThis : this);
