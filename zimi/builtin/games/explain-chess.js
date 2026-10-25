/* ZimiGames: Watch and learn, Chess. One sentence for a move, built from facts the engine
   can check on the position (what is captured, what can take back, what is attacked after
   the move, check and mate) and, when nothing else stands out, its own search score.
   Nothing here is a script of lines: every clause is tested on the board before it is said.
   Our own code, GPL-3.0.

     ZimiExplain.chess(E, pos, move, { score, ply }) -> { text, facts }

   E is the engine (chess-engine.js), pos the position before the move, move the engine's move,
   score the search score for the side to move in centipawns (optional). */
(function (root) {
  'use strict';
  var NAME = { 1: 'pawn', 2: 'knight', 3: 'bishop', 4: 'rook', 5: 'queen', 6: 'king' };
  var VALUE = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9, 6: 100 };
  var MATE_SCORE = 29000, OPENING_PLIES = 20, CENTRE_FILES = 'cdef', CENTRE_PAWN_SQUARES = ['d4', 'e4', 'd5', 'e5'];
  var EVEN_CP = 30, BIG_CP = 150;

  function article(name) { return /^[aeiou]/.test(name) ? 'an ' + name : 'a ' + name; }

  function chessExplain(E, pos, m, info) {
    info = info || {};
    var us = pos.turn, them = -us, side = us === E.WHITE ? 'White' : 'Black', other = us === E.WHITE ? 'Black' : 'White';
    var f = E.from(m), t = E.to(m), piece = Math.abs(pos.sq[f]), pname = NAME[piece];
    var isEp = !!(E.flag(m) & 1), castle = !!(E.flag(m) & 2), promo = E.promo(m);
    var captured = isEp ? 1 : Math.abs(pos.sq[t]);
    var toName = E.squareName(t), fromName = E.squareName(f);

    // The cheapest piece of `color` that could take what stands on `sq` in position p.
    function cheapestTaker(p, sq, color) {
      var q = E.clone(p); q.turn = color; q.ep = -1;
      var best = 0;
      E.legalMoves(q).forEach(function (mv) {
        if (E.to(mv) !== sq) return;
        var v = Math.abs(q.sq[E.from(mv)]);
        if (!best || VALUE[v] < VALUE[best]) best = v;
      });
      return best;
    }
    // Is the piece on sq, owned by `color`, in danger: taken for nothing, or for less than it is worth?
    function inDanger(p, sq, color) {
      var taker = cheapestTaker(p, sq, -color);
      if (!taker) return false;
      var defended = E.attacked(p, sq, color);
      return !defended || VALUE[taker] < VALUE[Math.abs(p.sq[sq])];
    }

    // The position after the move, for the facts about what it leaves behind.
    var after = E.clone(pos); E.make(after, m);
    var gives = E.inCheck(after), st = E.status(after, [E.key(after)]);
    var mate = st.over && st.result === 'mate', stalemate = st.over && st.result === 'stalemate';
    var takerAfter = cheapestTaker(after, t, them);
    var recapturable = !!takerAfter;

    // What the moved piece attacks now: enemy pieces our side could capture next, worth the trade.
    var next = E.clone(after); next.turn = us; next.ep = -1;
    var targets = [], seen = {};
    E.legalMoves(next).forEach(function (mv) {
      var tt = E.to(mv), v = Math.abs(next.sq[tt]);
      if (!v || v === 6 || E.from(mv) !== t || seen[tt]) return;
      seen[tt] = 1;
      var attacker = Math.abs(next.sq[E.from(mv)]);
      var guarded = E.attacked(after, tt, them);
      if (!guarded || VALUE[v] > VALUE[attacker]) targets.push({ type: v, sq: tt, loose: !guarded });
    });
    targets.sort(function (a, b) { return VALUE[b.type] - VALUE[a.type]; });

    // Did the piece leave a square where it was in danger?
    var escaped = !captured && inDanger(pos, f, us) && !inDanger(after, t, us);

    var facts = { side: side, piece: pname, from: fromName, to: toName, captured: captured ? NAME[captured] : null, castle: castle, promotion: promo ? NAME[promo] : null,
      check: gives, mate: mate, stalemate: stalemate, recapturable: recapturable, escaped: escaped, targets: targets.map(function (x) { return NAME[x.type]; }), score: info.score };

    var text;
    if (mate) text = side + ' plays ' + pname + ' to ' + toName + ': checkmate.';
    else if (stalemate) text = side + ' plays ' + pname + ' to ' + toName + ', and it is stalemate: a draw.';
    else if (castle) text = side + ' castles ' + (t > f ? 'kingside' : 'queenside') + ', tucking the king away and bringing the rook into play.';
    else if (promo) text = side + ' promotes the pawn to ' + article(NAME[promo]) + ' on ' + toName + (captured ? ', capturing ' + article(NAME[captured]) : '') + '.';
    else if (captured) {
      var gain = VALUE[captured], risk = recapturable ? VALUE[piece] : 0;
      if (!recapturable) text = side + ' takes ' + article(NAME[captured]) + ' on ' + toName + ' with the ' + pname + ', and nothing can take back.';
      else if (gain > risk) text = side + ' wins ' + article(NAME[captured]) + ' for ' + article(pname) + ': the ' + pname + ' takes on ' + toName + ' and can be taken back.';
      else if (gain === risk) text = side + ' trades ' + article(pname) + ' for ' + article(NAME[captured]) + ' on ' + toName + '.';
      else text = side + ' takes ' + article(NAME[captured]) + ' on ' + toName + ' with the ' + pname + ', which can be taken back; the engine still prefers it.';
      if (gives) text = text.replace(/\.$/, ', with check.');
    } else if (gives) {
      text = side + ' gives check with the ' + pname + ' on ' + toName + (targets.length ? ', and it also attacks the ' + NAME[targets[0].type] : '') + '.';
    } else if (targets.length > 1) {
      text = side + ' forks the ' + NAME[targets[0].type] + ' and the ' + NAME[targets[1].type] + ' with the ' + pname + ' on ' + toName + '.';
    } else if (targets.length) {
      var tg = targets[0];
      text = side + ' moves the ' + pname + ' to ' + toName + ' and now attacks the ' + NAME[tg.type] + (tg.loose ? ', which nothing protects.' : '.');
    } else if (escaped) {
      text = side + ' moves the ' + pname + ' from ' + fromName + ' to ' + toName + ' because it was under attack.';
    } else if ((info.ply || 0) <= OPENING_PLIES && (piece === 2 || piece === 3) && (f >> 3) === (us === E.WHITE ? 7 : 0)) {
      text = side + ' develops the ' + pname + ' to ' + toName + (CENTRE_FILES.indexOf(toName[0]) >= 0 ? ', toward the centre.' : ', getting it off the back rank.');
    } else if (piece === 1 && CENTRE_PAWN_SQUARES.indexOf(toName) >= 0) {
      text = side + ' pushes a pawn to ' + toName + ' to claim space in the centre.';
    } else {
      text = side + ' plays the ' + pname + ' to ' + toName + '.';
      var s = info.score;
      if (typeof s === 'number') {
        if (s >= MATE_SCORE) text = side + ' plays the ' + pname + ' to ' + toName + ', and the engine sees a forced checkmate ahead.';
        else if (s <= -MATE_SCORE) text = side + ' plays the ' + pname + ' to ' + toName + '; the engine sees ' + other + ' winning, and this holds out longest.';
        else if (Math.abs(s) < EVEN_CP) text += ' The engine sees the game as about even.';
        else text += ' The engine rates this ' + (s > 0 ? 'in ' + side + '’s favour' : 'in ' + other + '’s favour') + (Math.abs(s) >= BIG_CP ? ' by more than a pawn.' : ' by a little.');
      }
    }
    return { text: text, facts: facts };
  }

  root.ZimiExplain = root.ZimiExplain || {};
  root.ZimiExplain.chess = chessExplain;
  if (typeof module !== 'undefined' && module.exports) module.exports = chessExplain;
})(typeof globalThis !== 'undefined' ? globalThis : this);
