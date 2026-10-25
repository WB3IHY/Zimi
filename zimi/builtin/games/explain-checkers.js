/* ZimiGames: Watch and learn, Checkers. One sentence for a move, from facts checked on the
   board: jumps taken, a king made, whether the moved man can be jumped back, whether the
   reply is forced and what it costs, and the engine's own search score when nothing else
   stands out. Our own code, GPL-3.0.

     ZimiExplain.checkers(E, board, player, move, { score }) -> { text, facts }

   E is CheckersEngine (checkers.js); move is { from, to, path, caps }. */
(function (root) {
  'use strict';
  var N = 8, CENTRE_COLS = [2, 3, 4, 5], CENTRE_ROWS = [3, 4];
  var EVEN = 20, BIG = 100;

  function coord(i) { return 'abcdefgh'[i % N] + (N - ((i / N) | 0)); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function checkersExplain(E, b, p, m, info) {
    info = info || {};
    var side = p === E.RED ? 'Red' : 'White', other = E.other(p);
    var piece = b[m.from], isKing = E.isKing(piece), caps = m.caps.length;
    var jumpedKings = m.caps.filter(function (i) { return E.isKing(b[i]); }).length;
    var after = E.apply(b, m);
    var crowned = !isKing && E.isKing(after[m.to]);
    var from = coord(m.from), to = coord(m.to);
    var row = (m.to / N) | 0, col = m.to % N;

    // Replies: can the moved piece be jumped, and is a reply forced?
    var replies = E.moves(after, other);
    var forced = replies.length > 0 && replies[0].caps.length > 0;
    var exposed = replies.some(function (r) { return r.caps.length && r.caps.indexOf(m.to) >= 0; });
    // What a forced exchange costs: the opponent takes the reply that leaves us best off after our recapture.
    var exchange = null;
    if (forced) {
      replies.forEach(function (r) {
        var back = E.moves(E.apply(after, r), p), won = back.length && back[0].caps.length ? Math.max.apply(null, back.map(function (x) { return x.caps.length; })) : 0;
        var net = won - r.caps.length;
        if (!exchange || net < exchange.net) exchange = { lost: r.caps.length, won: won, net: net };
      });
    }
    var onEdge = col === 0 || col === N - 1;
    var advance = p === E.RED ? (m.from / N | 0) - row : row - (m.from / N | 0);
    var centre = CENTRE_COLS.indexOf(col) >= 0 && CENTRE_ROWS.indexOf(row) >= 0;
    var facts = { side: side, from: from, to: to, captures: caps, kingsTaken: jumpedKings, crowned: crowned, exposed: exposed, forced: forced, exchange: exchange, edge: onEdge, score: info.score };

    var text;
    if (caps) {
      var how = caps === 1 ? 'jumps ' + (jumpedKings ? 'a king' : 'a man') : 'jumps ' + plural(caps, 'piece') + ' in one turn';
      text = side + ' ' + how + ', ' + from + ' to ' + to;
      if (crowned) text += ', and is crowned';
      text += '.';
      if (exchange && exchange.lost) text += ' The reply jumps ' + plural(exchange.lost, 'piece') + ' back' + (exchange.won ? ', and ' + side + ' then jumps ' + plural(exchange.won, 'piece') : '') + '.';
      else if (!exposed && !crowned) text += ' Nothing can jump back.';
    } else if (crowned) {
      text = side + ' reaches the far row at ' + to + ' and is crowned: a king moves backward too.';
    } else if (forced && exchange && exchange.net > 0) {
      text = side + ' offers a man at ' + to + ': the jump is forced, and the recapture then takes ' + plural(exchange.won, 'piece') + ' for ' + plural(exchange.lost, 'piece') + '.';
    } else if (forced && exchange && exchange.net === 0) {
      text = side + ' moves ' + from + ' to ' + to + ' and forces a jump; the two sides trade ' + plural(exchange.lost, 'piece') + ' each.';
    } else if (forced) {
      text = side + ' moves ' + from + ' to ' + to + ', which allows a jump the engine judges worth it.';
    } else if (onEdge) {
      text = side + ' moves ' + from + ' to ' + to + ' on the edge, where a man cannot be jumped.';
    } else if (centre && !exposed) {
      text = side + ' moves ' + from + ' to ' + to + ', taking the centre; nothing can jump it.';
    } else if (advance > 0 && !exposed && !isKing) {
      text = side + ' advances a man from ' + from + ' to ' + to + ', and it is safe from a jump.';
    } else {
      text = side + ' moves ' + from + ' to ' + to + '.';
      var s = info.score;
      if (typeof s === 'number') {
        if (Math.abs(s) < EVEN) text += ' The engine sees the game as even.';
        else text += ' The engine rates it ' + (s > 0 ? 'in ' + side + '’s favour' : 'in ' + (side === 'Red' ? 'White' : 'Red') + '’s favour') + (Math.abs(s) >= BIG ? ' by about a man.' : ' by a little.');
      }
    }
    return { text: text, facts: facts };
  }

  root.ZimiExplain = root.ZimiExplain || {};
  root.ZimiExplain.checkers = checkersExplain;
  if (typeof module !== 'undefined' && module.exports) module.exports = checkersExplain;
})(typeof globalThis !== 'undefined' ? globalThis : this);
