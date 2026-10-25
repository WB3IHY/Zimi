/* ZimiGames: Watch and learn, Hearts. One sentence per pass, card played and trick taken, from
   facts checked on the hand: what was led, what the table already holds, what the player could
   legally play, which suits it is out of, who wins and how many points. Our own code, GPL-3.0.

     ZimiExplain.hearts.play(H, Z, state, seat, id)  -> { text, facts }   a card played
     ZimiExplain.hearts.pass(H, Z, hand, picks, dir) -> { text, facts }   three cards passed
     ZimiExplain.hearts.trick(H, Z, trick)           -> { text, facts }   a trick taken
     ZimiExplain.hearts.hand(H, state)               -> { text }          a hand over

   H is ZimiHearts (hearts.js), Z is ZimiCards (cards.js), state the state before the card. */
(function (root) {
  'use strict';
  var SEAT = ['South', 'West', 'North', 'East'];
  var PASS_DIR = ['to the left', 'to the right', 'across', 'not at all'];
  var HEARTS = 2, SPADES = 3, ACE = 14, FEW_SPADES = 4, TRICK_SIZE = 4;

  function high(Z, id) { return Z.rank(id) === 1 ? ACE : Z.rank(id); }
  function suitOf(Z, id) { return Z.SUITS[Z.suit(id)]; }
  function card(Z, id) { return 'the ' + Z.cardName(id); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function playedSoFar(state) { return [].concat.apply([], state.taken).concat(state.trick.map(function (t) { return t.id; })); }
  function count(Z, hand, suit) { return hand.filter(function (c) { return Z.suit(c) === suit; }).length; }
  function list(items) { return items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]; }

  function play(H, Z, state, seat, id) {
    var hand = state.hands[seat], legal = H.legalPlays(state, seat), trick = state.trick, who = SEAT[seat];
    var name = Z.cardName(id), QS = H.QUEEN_SPADES, queenOut = playedSoFar(state).indexOf(QS) < 0 && hand.indexOf(QS) < 0;
    var facts = { seat: who, card: name, led: !trick.length, legal: legal.length, void: false, ducks: false, forced: false };
    var text, lead;
    if (!trick.length) {
      var allHearts = legal.every(function (c) { return Z.suit(c) === HEARTS; });
      var lowest = legal.every(function (c) { return high(Z, c) >= high(Z, id); });
      if (state.tricksPlayed === 0 && id === H.TWO_CLUBS) text = who + ' holds the 2 of clubs, and that card always opens the hand.';
      else if (legal.length === 1) text = who + ' has only one legal card to lead, ' + card(Z, id) + '.';
      else if (allHearts) text = who + ' has only hearts left, so it has to lead ' + card(Z, id) + '.';
      else if (!state.broken && hand.some(function (c) { return Z.suit(c) === HEARTS; })) text = who + ' leads ' + card(Z, id) + '. Hearts have not been broken yet, so it cannot lead one.';
      else if (lowest) text = who + ' leads its lowest legal card, ' + card(Z, id) + ', a card that is unlikely to win the trick.';
      else text = who + ' leads ' + card(Z, id) + '.';
      return { text: text, facts: facts };
    }
    lead = Z.suit(trick[0].id);
    var follows = hand.some(function (c) { return Z.suit(c) === lead; });
    if (follows) {
      var inLead = trick.filter(function (t) { return Z.suit(t.id) === lead; });
      var curHigh = Math.max.apply(null, inLead.map(function (t) { return high(Z, t.id); }));
      var mine = high(Z, id), pts = H.trickPoints(trick), last = trick.length === TRICK_SIZE - 1;
      var under = legal.filter(function (c) { return high(Z, c) < curHigh; });
      if (mine < curHigh) {
        facts.ducks = true;
        var best = under.every(function (c) { return high(Z, c) <= mine; });
        text = who + ' plays ' + card(Z, id) + ' under the ' + curHigh2name(Z, inLead, curHigh) + ' already on the table, so it should not win the trick' + (best && under.length > 1 ? ' (it is the highest card that still stays under)' : '') + '.';
      } else if (!under.length) {
        facts.forced = true;
        text = who + ' has to follow ' + Z.SUITS[lead] + ' and every card it can play beats the table, so it plays the lowest, ' + card(Z, id) + (pts ? ', and takes ' + plural(pts, 'point') + '.' : '.');
      } else if (last && pts === 0) {
        text = who + ' plays last, and no points are on the table, so ' + card(Z, id) + ' wins the trick at no cost.';
      } else {
        text = who + ' plays ' + card(Z, id) + ' over the table.';
      }
      return { text: text, facts: facts };
    }
    facts.void = true;
    var inHand = Z.suit(id);
    var heartsHeld = hand.filter(function (c) { return Z.suit(c) === HEARTS; });
    var first = state.tricksPlayed === 0;
    if (id === QS) text = who + ' has no ' + Z.SUITS[lead] + ', so it dumps ' + card(Z, id) + ': 13 points for whoever wins this trick.';
    else if (inHand === HEARTS && heartsHeld.every(function (c) { return high(Z, c) <= high(Z, id); })) text = who + ' has no ' + Z.SUITS[lead] + ' and sheds its highest heart, ' + card(Z, id) + ', a point it would rather not keep.';
    else if (inHand === SPADES && (Z.rank(id) === 1 || Z.rank(id) === 13) && queenOut) text = who + ' has no ' + Z.SUITS[lead] + ' and discards ' + card(Z, id) + ' while the queen of spades is still out, so it cannot be forced to take her.';
    else {
      var counts = [0, 1, 2, 3].map(function (s) { return count(Z, hand, s); }).filter(function (n) { return n > 0; });
      var shortest = count(Z, hand, inHand) === Math.min.apply(null, counts);
      text = who + ' has no ' + Z.SUITS[lead] + ' and discards ' + card(Z, id) + (shortest ? ' from its shortest suit, which helps it run out of that suit' : '') + (first ? ', a card with no points, because points cannot be played on the first trick' : '') + '.';
    }
    return { text: text, facts: facts };
  }
  // The rank word of the highest card of the lead suit on the table ("10 of clubs").
  function curHigh2name(Z, inLead, curHigh) {
    var t = inLead.filter(function (x) { return high(Z, x.id) === curHigh; })[0];
    return Z.cardName(t.id);
  }

  function pass(H, Z, hand, picks, dir) {
    if (dir === 3) return { text: 'This hand nobody passes. The player with the 2 of clubs leads.', facts: {} };
    var spades = count(Z, hand, SPADES), why = [];
    if (picks.indexOf(H.QUEEN_SPADES) >= 0) why.push('the queen of spades is 13 points' + (spades <= FEW_SPADES ? ' and only ' + plural(spades, 'spade') + ' are there to protect it' : ''));
    var honours = picks.filter(function (c) { return Z.suit(c) === SPADES && (Z.rank(c) === 1 || Z.rank(c) === 13); });
    if (honours.length) why.push('high spades are the cards most likely to be forced to take the queen');
    var hearts = picks.filter(function (c) { return Z.suit(c) === HEARTS; });
    if (hearts.length) why.push('high hearts are points waiting to happen');
    var text = 'South passes ' + list(picks.map(function (c) { return card(Z, c); })) + ' ' + PASS_DIR[dir] + (why.length ? ': ' + list(why) + '.' : ', its most awkward cards.') + ' The others pass three each too.';
    return { text: text, facts: { picks: picks.length, reasons: why.length } };
  }

  function trick(H, Z, tr) {
    var win = H.trickWinner(tr), w = tr.filter(function (t) { return t.seat === win; })[0], pts = H.trickPoints(tr);
    var hearts = tr.filter(function (t) { return Z.suit(t.id) === HEARTS; }).length, queen = tr.some(function (t) { return t.id === H.QUEEN_SPADES; });
    var parts = [];
    if (queen) parts.push('the queen of spades');
    if (hearts) parts.push(plural(hearts, 'heart'));
    var text = SEAT[win] + ' takes the trick with ' + card(Z, w.id) + (pts ? ' and collects ' + plural(pts, 'point') + ': ' + list(parts) + '.' : ', and no points are in it.');
    return { text: text, facts: { winner: SEAT[win], points: pts } };
  }

  function hand(H, state) {
    var low = Math.min.apply(null, state.scores);
    var text = state.moon >= 0 ? SEAT[state.moon] + ' took every heart and the queen of spades: shooting the moon, so everyone else gets 26.' : 'Hand over. Points this hand: ' + state.handPoints.map(function (p, i) { return SEAT[i] + ' ' + p; }).join(', ') + '.';
    return { text: text + ' Lowest total: ' + state.scores.map(function (s, i) { return s === low ? SEAT[i] : null; }).filter(Boolean).join(' and ') + ' on ' + low + '.', facts: {} };
  }

  root.ZimiExplain = root.ZimiExplain || {};
  root.ZimiExplain.hearts = { play: play, pass: pass, trick: trick, hand: hand };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ZimiExplain.hearts;
})(typeof globalThis !== 'undefined' ? globalThis : this);
