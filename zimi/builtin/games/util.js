/* ZimiGames: the one seeded random generator every game shares. Our own code, GPL-3.0. No DOM, no modules.

     ZimiUtil.mulberry32(seed)        a function that returns the next number in [0, 1); one seed is one sequence
     ZimiUtil.counted(seed, skip)     the same sequence, but it knows its seed and how many it has given (rng.seed, rng.draws),
                                     so a game that holds one can be put back where it was: counted(seed, draws)
     ZimiUtil.snapshot(game)          the game's state as plain JSON (its `rng` becomes { seed, draws })
     ZimiUtil.restore(saved)          a game from a snapshot, its `rng` the same sequence at the same place

   Loaded before the engines (a page's script tag, a test's file list). A deal is a promise: never change the arithmetic. */
(function (root) {
  'use strict';

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function counted(seed, skip) {
    var next = mulberry32(seed), n = 0;
    function rng() { n++; return next(); }
    rng.seed = seed >>> 0;
    Object.defineProperty(rng, 'draws', { get: function () { return n; } });
    for (var i = 0; i < (skip || 0); i++) rng();
    return rng;
  }

  function snapshot(game) {
    var out = {};
    Object.keys(game).forEach(function (k) { if (k !== 'rng') out[k] = game[k]; });
    out.rng = { seed: game.rng.seed, draws: game.rng.draws };
    return JSON.parse(JSON.stringify(out));
  }

  function restore(saved) {
    var game = JSON.parse(JSON.stringify(saved));
    if (!game.rng || typeof game.rng.seed !== 'number' || typeof game.rng.draws !== 'number') throw new Error('no generator to put back');
    game.rng = counted(game.rng.seed, game.rng.draws);
    return game;
  }

  root.ZimiUtil = { mulberry32: mulberry32, counted: counted, snapshot: snapshot, restore: restore };
})(this);
