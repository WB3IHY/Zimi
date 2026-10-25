/* ZimiGames: the Mahjong tile faces, drawn here (no fonts beyond the system's Latin), shared by Mahjong solitaire
   and the four-player game. A face is a number 0 to 41: 0-8 circles, 9-17 bamboo, 18-26 characters, 27-30 winds,
   31-33 dragons, 34-37 flowers, 38-41 seasons. Our own art, GPL-3.0. No network, no modules. */
(function (root) {
  'use strict';
  var FIRST_FLOWER = 34, FIRST_SEASON = 38;
  var NAMES = ['circles', 'bamboo', 'characters'];
  var WIND = ['East', 'South', 'West', 'North'], DRAGON = ['Red dragon', 'Green dragon', 'White dragon'];
  var FLOWER = ['Plum', 'Orchid', 'Chrysanthemum', 'Bamboo flower'], SEASON = ['Spring', 'Summer', 'Autumn', 'Winter'];

  function faceName(f) {
    if (f < 27) return (f % 9 + 1) + ' of ' + NAMES[(f / 9) | 0];
    if (f < 31) return WIND[f - 27] + ' wind';
    if (f < 34) return DRAGON[f - 31];
    return f < FIRST_SEASON ? FLOWER[f - FIRST_FLOWER] : SEASON[f - FIRST_SEASON];
  }

  // ── tile faces, drawn here (no fonts beyond the system's Latin) ──
  var INK = { 0: '#1565c0', 1: '#2e7d32', 2: '#c62828' };
  function num(n, color) { return '<text x="20" y="29" text-anchor="middle" font-size="27" font-weight="800" font-family="Georgia,\'Times New Roman\',serif" fill="' + color + '">' + n + '</text>'; }
  function ring(cx, cy, r, color) { return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="2.6"/><circle cx="' + cx + '" cy="' + cy + '" r="' + (r / 2.6).toFixed(1) + '" fill="' + color + '"/>'; }
  function faceMarkup(f) {
    var s, c;
    if (f < 27) {
      var suit = (f / 9) | 0, n = f % 9 + 1; c = INK[suit];
      s = num(n, c);
      if (suit === 0) s += ring(20, 42, 5.6, c);
      else if (suit === 1) s += '<g stroke="' + c + '" stroke-width="2.4" stroke-linecap="round"><path d="M16 36v13M24 36v13" fill="none"/><path d="M14 41h4M22 41h4M14 46h4M22 46h4" stroke-width="1.6"/></g>';
      else s += '<path d="M12 38h16M20 35v14M13 45h14" stroke="' + c + '" stroke-width="3.4" stroke-linecap="round" fill="none"/>';
    } else if (f < 31) {
      s = '<text x="20" y="35" text-anchor="middle" font-size="31" font-weight="800" font-family="Georgia,serif" fill="#1a237e">' + 'ESWN'[f - 27] + '</text>';
      s += '<path d="M9 12h22" stroke="#1a237e" stroke-width="2.4" stroke-linecap="round"/>';
    } else if (f === 31) {
      s = '<path d="M20 8l13 18-13 18-13-18z" fill="#c62828"/><path d="M20 17l6 9-6 9-6-9z" fill="#f7f2e4"/>';
    } else if (f === 32) {
      s = '<path d="M10 40C8 22 20 10 32 11 33 24 26 38 10 40z" fill="#2e7d32"/><path d="M12 38C18 28 24 20 29 14" stroke="#f7f2e4" stroke-width="2" fill="none"/>';
    } else if (f === 33) {
      s = '<rect x="9" y="10" width="22" height="32" rx="3" fill="none" stroke="#1565c0" stroke-width="3.2"/><rect x="14" y="15" width="12" height="22" rx="1.5" fill="none" stroke="#1565c0" stroke-width="1.6"/>';
    } else if (f < FIRST_SEASON) {
      var k = f - FIRST_FLOWER, col = ['#d81b60', '#8e24aa', '#f9a825', '#43a047'][k];
      s = '';
      for (var p = 0; p < 5; p++) { var a = p * 1.2566 - 1.5708; s += '<circle cx="' + (20 + 8.5 * Math.cos(a)).toFixed(1) + '" cy="' + (24 + 8.5 * Math.sin(a)).toFixed(1) + '" r="6.2" fill="' + col + '"/>'; }
      s += '<circle cx="20" cy="24" r="4.2" fill="#fff3c4" stroke="' + col + '" stroke-width="1.2"/><text x="20" y="49" text-anchor="middle" font-size="11" font-weight="800" font-family="Georgia,serif" fill="' + col + '">' + (k + 1) + '</text>';
    } else {
      var q = f - FIRST_SEASON, sc = ['#2e7d32', '#e65100', '#8d6e63', '#0277bd'][q];
      s = '<circle cx="20" cy="24" r="14" fill="' + sc + '"/><text x="20" y="30" text-anchor="middle" font-size="16" font-weight="800" font-family="system-ui,Arial,sans-serif" fill="#fff">' + ['Sp', 'Su', 'Au', 'Wi'][q] + '</text><text x="20" y="49" text-anchor="middle" font-size="11" font-weight="800" font-family="Georgia,serif" fill="' + sc + '">' + (q + 1) + '</text>';
    }
    return '<svg viewBox="0 0 40 52" aria-hidden="true">' + s + '</svg>';
  }

  root.MahjongTiles = { faceName: faceName, faceMarkup: faceMarkup, FIRST_FLOWER: FIRST_FLOWER, FIRST_SEASON: FIRST_SEASON };
})(typeof globalThis !== 'undefined' ? globalThis : this);
