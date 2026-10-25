/* ZimiGames: Tien Len, the southern Vietnamese climbing game (see
   climbing.js). Runs, pairs in a row, and chops for twos. */
(function (root) {
  'use strict';
  var C = root.ZimiClimbing, game = C.api(C.RULES.tienlen);
  game.rulesText = 'Four players, 13 cards each. Whoever holds the 3 of spades leads a hand that includes it. Play a single, pair, three or four of a kind, a run of three or more cards in a row, or a run of three or more pairs in a row, matching what is on the table and higher, or pass; a pass keeps you out of that round. Twos are highest (never in a run); suits rank spades, clubs, diamonds, hearts. Chop a two: four of a kind or three pairs in a row beats a single two; four of a kind or four pairs in a row beats a pair of twos. Play goes on until three are out; finishing first to last scores 4, 1, -1, -4. First to 12 wins. Tap cards to pick them, then Play. P plays, S passes, H hints.';
  root.ZimiTienLen = game;
  if (root.document && root.document.getElementById('zc-table')) C.boot(game);
})(typeof globalThis !== 'undefined' ? globalThis : window);
