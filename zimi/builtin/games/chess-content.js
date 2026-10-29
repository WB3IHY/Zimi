/* ZimiGames: what Chess Puzzles, the Opening Trainer and Chess's opening names share. Our own code, GPL-3.0.
   Pure helpers over the chess engine (UCI moves, puzzle rows, the opening index); nothing here touches the page,
   so node runs it for the tests. The data files (data/chess-puzzles.js, data/chess-openings.js) are derived from
   CC0 sources; see their README files. */
(function (root) {
  'use strict';
  var PROMO = { n: 2, b: 3, r: 4, q: 5 };

  // "e2e4" or "e7e8q" -> the engine's move integer for this position, or 0 when it is not legal.
  function fromUci(E, pos, uci) {
    if (!uci || uci.length < 4) return 0;
    return E.findMove(pos, E.squareFromName(uci.slice(0, 2)), E.squareFromName(uci.slice(2, 4)), PROMO[uci[4]] || 0);
  }
  function toUci(E, m) {
    return E.squareName(E.from(m)) + E.squareName(E.to(m)) + (E.promo(m) ? 'nbrq'[E.promo(m) - 2] : '');
  }

  // A puzzle row: "fen|moves|rating|theme letters" -> an object. The first move is the opponent's, the one that sets the puzzle.
  function parsePuzzle(row, themes) {
    var p = row.split('|');
    return { fen: p[0], moves: p[1].split(' '), rating: +p[2], themes: p[3].split('').map(function (c) { return themes[c.charCodeAt(0) - 97]; }) };
  }

  // The opening index: a map from position key to the longest-named line reaching it, built lazily by replaying
  // every named line once. Names are looked up by walking back from the current move to the nearest named position.
  function addOpening(E, index, row) {
    var p = row.split('|'), pos = E.startPosition(), moves = p[2].split(' ');
    for (var i = 0; i < moves.length; i++) {
      var m = fromUci(E, pos, moves[i]);
      if (!m) return;
      E.make(pos, m);
    }
    var line = { eco: p[0], name: p[1], moves: moves };
    index.lines.push(line);
    var k = E.key(pos);
    // keep the entry with the most moves: the most specific name for a transposition
    if (!index.byKey[k] || index.byKey[k].moves.length < moves.length) index.byKey[k] = line;
  }
  function openingIndex(E, rows) {
    var index = { byKey: {}, lines: [] };
    rows.split('\n').forEach(function (row) { addOpening(E, index, row); });
    return index;
  }
  // The same index built a slice at a time, so a page that is in use (a game in play) is never frozen for the length of the replay.
  var OPENING_SLICE = 150;
  function openingIndexLater(E, rows, done) {
    var index = { byKey: {}, lines: [] }, list = rows.split('\n'), at = 0;
    (function slice() {
      for (var end = Math.min(list.length, at + OPENING_SLICE); at < end; at++) addOpening(E, index, list[at]);
      if (at < list.length) setTimeout(slice, 0); else done(index);
    })();
  }

  // The named opening for a game so far: keys[i] is E.key after i moves (keys[0] is the start). Returns the
  // latest named position reached, or null while the game has not yet reached any named line.
  function openingFor(index, keys) {
    for (var i = keys.length - 1; i > 0; i--) {
      var hit = index.byKey[keys[i]];
      if (hit) return hit;
    }
    return null;
  }

  // "Sicilian Defense: Najdorf Variation, English Attack" -> "Sicilian Defense"
  function family(name) { return name.split(':')[0]; }

  root.ZimiChessContent = { fromUci: fromUci, toUci: toUci, parsePuzzle: parsePuzzle, openingIndex: openingIndex, openingIndexLater: openingIndexLater, openingFor: openingFor, family: family };
})(typeof globalThis !== 'undefined' ? globalThis : this);
