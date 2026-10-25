/* ZimiGames: Watch and learn, Solitaire. The computer plays the hand by a short list of rules,
   and each rule says what it did: the rule that picks the move and the sentence that explains
   it are the same code, so the words cannot disagree with the play. In order:
     1. a card that is safe to send up to a foundation (aces and twos, or when no card still
        in play could need it on the table)
     2. a move that turns over a face-down card
     3. a waste card that fits on a column
     4. draw from the stock (or turn the waste over again)
   After two trips through the stock with nothing else to do, it says it is stuck.
   Our own code, GPL-3.0.

     ZimiExplain.solitaire(S, Z, state, ctx) -> { text, next, kind } | null
   S is ZimiSolitaire, Z is ZimiCards, ctx a plain object kept between calls ({}). */
(function (root) {
  'use strict';
  var ALWAYS_SAFE_RANK = 2, STUCK_RECYCLES = 2;
  var COLOUR = ['black', 'red', 'red', 'black'];   // clubs, diamonds, hearts, spades

  function name(Z, id) { return Z.cardName(id); }
  function colour(Z, id) { return COLOUR[Z.suit(id)]; }
  function top(pile) { return pile[pile.length - 1]; }
  function col(S, pile) { return S.TABLEAU.indexOf(pile) + 1; }

  // How many cards of a suit are already on its foundation.
  function built(S, state, Z, suit) {
    for (var i = 0; i < S.FOUNDATION.length; i++) {
      var p = state.piles[S.FOUNDATION[i]];
      if (p.length && Z.suit(p[0].id) === suit) return p.length;
    }
    return 0;
  }
  // Could a card still in play want this one as a base? A red 7 takes a black 6, so it is safe
  // to send up once both black suits have their 6 on the foundations.
  function safeToSend(S, Z, state, id) {
    var r = Z.rank(id);
    if (r <= ALWAYS_SAFE_RANK) return true;
    var others = colour(Z, id) === 'red' ? [0, 3] : [1, 2];
    return others.every(function (s) { return built(S, state, Z, s) >= r - 1; });
  }

  function solitaire(S, Z, state, ctx) {
    var P = state.piles, sources = ['waste'].concat(S.TABLEAU), i, j, f, p, t;

    // 1. up to a foundation
    for (i = 0; i < sources.length; i++) {
      p = P[sources[i]];
      if (!p.length || !top(p).up) continue;
      var id = top(p).id;
      for (j = 0; j < S.FOUNDATION.length; j++) {
        f = S.FOUNDATION[j];
        if (!S.legalMove(state, sources[i], p.length - 1, f) || !safeToSend(S, Z, state, id)) continue;
        ctx.recycles = 0;
        var why = Z.rank(id) === 1 ? 'Aces start a suit, so ' + name(Z, id) + ' goes straight up to a foundation.'
          : Z.rank(id) <= ALWAYS_SAFE_RANK ? 'The ' + name(Z, id) + ' goes up to its foundation: nothing is built on a low card, so this is always safe.'
          : 'The ' + name(Z, id) + ' goes up to its foundation. It is safe: the other colour is far enough along that no card still in play needs it.';
        return { kind: 'foundation', text: why.replace(/^The the/, 'The'), next: S.applyMove(state, sources[i], p.length - 1, f) };
      }
    }

    // 2. a move that turns over a face-down card
    var best = null;
    S.TABLEAU.forEach(function (from) {
      var pile = P[from], k;
      for (k = 0; k < pile.length; k++) if (pile[k].up) break;
      if (k === 0 || k >= pile.length) return;            // nothing face down, or nothing face up
      S.TABLEAU.forEach(function (to) {
        if (to === from || !S.legalMove(state, from, k, to)) return;
        var hidden = k;                                     // how many cards lie face down beneath
        if (!best || hidden > best.hidden) best = { from: from, idx: k, to: to, hidden: hidden };
      });
    });
    if (best) {
      ctx.recycles = 0;
      var moving = P[best.from][best.idx].id, dest = P[best.to];
      var onto = dest.length ? 'onto the ' + name(Z, top(dest).id) : 'into the empty column';
      var count = P[best.from].length - best.idx;
      return { kind: 'reveal', text: 'Moves ' + (count > 1 ? 'the run from the ' : 'the ') + name(Z, moving) + ' ' + onto + ' to turn over a face-down card in column ' + col(S, best.from) + '.', next: S.applyMove(state, best.from, best.idx, best.to) };
    }

    // 3. waste onto a column
    if (P.waste.length) {
      var w = top(P.waste).id;
      for (i = 0; i < S.TABLEAU.length; i++) {
        t = S.TABLEAU[i];
        if (S.legalMove(state, 'waste', P.waste.length - 1, t)) {
          ctx.recycles = 0;
          return { kind: 'waste', text: 'Plays the ' + name(Z, w) + ' from the waste ' + (P[t].length ? 'onto the ' + name(Z, top(P[t]).id) : 'into the empty column, since only a king fits a gap') + ', so the next waste card shows.', next: S.applyMove(state, 'waste', P.waste.length - 1, t) };
        }
      }
    }

    // 4. the stock
    if (P.stock.length) {
      var n = Math.min(state.draw, P.stock.length);
      return { kind: 'draw', text: 'No move on the table helps, so it turns over ' + (n === 1 ? 'a card' : n + ' cards') + ' from the stock.', next: S.drawStock(state) };
    }
    if (P.waste.length) {
      ctx.recycles = (ctx.recycles || 0) + 1;
      if (ctx.recycles > STUCK_RECYCLES) return null;
      return { kind: 'recycle', text: 'The stock is empty and nothing else moves, so it turns the waste over to go through it again. That costs points.', next: S.drawStock(state) };
    }
    return null;
  }

  root.ZimiExplain = root.ZimiExplain || {};
  root.ZimiExplain.solitaire = solitaire;
  if (typeof module !== 'undefined' && module.exports) module.exports = solitaire;
})(typeof globalThis !== 'undefined' ? globalThis : this);
