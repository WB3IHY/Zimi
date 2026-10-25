/* ZimiGames: Big Two (see climbing.js for the rules both climbing games
   share). You and three computer players; twos are high, suits rank
   diamonds, clubs, hearts, spades. */
(function (root) {
  'use strict';
  var C = root.ZimiClimbing, game = C.api(C.RULES.bigtwo);
  game.rulesText = 'Four players, 13 cards each. Whoever holds the 3 of diamonds leads a hand that includes it. Each player must play the same kind of hand, higher, or pass; when all others pass the last player leads anything. Hands: single, pair, three of a kind, and five cards: straight, flush, full house, four of a kind plus a card, straight flush (in that order; straights run 3 up to 10 J Q K A). Twos are highest, then aces; suits rank diamonds, clubs, hearts, spades. First out wins the hand and is paid one point a card from each other player (double at 10 or more, triple at 13). First to 30 wins. Tap cards to pick them, then Play. P plays, S passes, H hints.';
  root.ZimiBigTwo = game;
  if (root.document && root.document.getElementById('zc-table')) C.boot(game);
})(typeof globalThis !== 'undefined' ? globalThis : window);
