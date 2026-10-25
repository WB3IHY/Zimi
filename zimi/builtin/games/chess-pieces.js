/* ZimiGames: the chess pieces, our own drawing, shared by Chess, Chess Puzzles and the Opening Trainer.
   Each piece is a small inline svg painted from the colour variables in chess.css. GPL-3.0. */
(function (root) {
  'use strict';
  var NAMES = { 1: 'pawn', 2: 'knight', 3: 'bishop', 4: 'rook', 5: 'queen', 6: 'king' };
  var PIECE_SVG = {
    1: '<circle cx="22.5" cy="12.5" r="5.4"/><path d="M16.5 36c0-8.500 2-12.500 6-15 4 2.500 6 6.500 6 15z"/><rect x="12" y="35" width="21" height="4.500" rx="2"/>',
    2: '<path d="M11.500 37c-.5-9 3.500-13 7-17-3 .5-5 2-7 4.500-2 .5-3.500-.5-3.500-2.500 2-3.500 5-6.500 7.500-10.500L17 8l3.500 2C30 9.500 36 16 35 37z"/><circle class="e" cx="22" cy="14.500" r="1.400"/><path class="d" d="M10 21.500l3-1.500M25 18c2.500 2 4.500 6 4 11"/><rect x="11" y="35" width="24" height="4.500" rx="2"/>',
    3: '<circle cx="22.500" cy="8.500" r="2.800"/><path d="M22.500 11.500c-6.500 4.500-9 8.500-9 12.500 0 3 2 5 4.500 6h9c2.500-1 4.500-3 4.500-6 0-4-2.500-8-9-12.500z"/><path class="d" d="M22.500 16.500v6M19.500 19.500h6"/><rect x="15" y="30" width="15" height="3.500" rx="1.500"/><rect x="12" y="35" width="21" height="4.500" rx="2"/>',
    4: '<path d="M12 17V9h4.500v3h3.500V9h5v3h3.500V9H33v8z"/><path d="M14.500 17v16h16V17z"/><path class="d" d="M14.500 20.500h16"/><rect x="12" y="33" width="21" height="3" rx="1"/><rect x="11" y="36" width="23" height="3.500" rx="1.500"/>',
    5: '<circle cx="9" cy="13" r="2.300"/><circle cx="15.800" cy="8.500" r="2.300"/><circle cx="22.500" cy="7" r="2.300"/><circle cx="29.200" cy="8.500" r="2.300"/><circle cx="36" cy="13" r="2.300"/><path d="M9 14.500l4.500 15h18l4.500-15-6.500 8-3-12.500-3.500 12-3.500-12-3 12.500z"/><rect x="12" y="30" width="21" height="4" rx="1.500"/><rect x="11" y="35" width="23" height="4.500" rx="2"/>',
    6: '<path d="M22.500 3.500v8M18.500 7.500h8" fill="none" class="cross"/><path d="M22.500 17c-2.500-6.500-13-5-13 3 0 4 2.500 7 5 10.500h16c2.500-3.500 5-6.500 5-10.500 0-8-10.500-9.500-13-3z"/><path class="d" d="M22.500 17v12"/><rect x="12" y="30" width="21" height="4" rx="1.500"/><rect x="11" y="35" width="23" height="4.500" rx="2"/>'
  };
  // t is 1..6 (pawn..king); white is true for the light side.
  function pieceSvg(t, white) {
    return '<svg class="cs-pc ' + (white ? 'w' : 'b') + '" viewBox="0 0 45 45" aria-hidden="true">' + PIECE_SVG[t] + '</svg>';
  }
  root.ZimiChessPieces = { NAMES: NAMES, svg: pieceSvg };
})(typeof globalThis !== 'undefined' ? globalThis : this);
