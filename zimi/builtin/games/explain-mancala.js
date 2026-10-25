/* ZimiGames: Watch and learn, Mancala (Oware and Kalah). One sentence per move from what the
   rules say sowing does: where the last seed lands, what is captured, an extra turn, a forced
   feed, and the best capture the other side would have next, before and after the move (each
   worked out by sowing it). Our own code, GPL-3.0.

     ZimiExplain.mancala(R, state, pit) -> { text, facts }

   R is the rule set (MancalaEngine.Oware or .Kalah), state the position, pit the pit sown. */
(function (root) {
  'use strict';
  var SIDE = ['South', 'North'];

  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  // The most seeds the side to move could capture right now.
  function bestCapture(R, s) {
    var best = 0;
    R.moves(s).forEach(function (m) {
      var r = R.sow(s, m), took = r.captured.reduce(function (a, c) { return a + c.n; }, 0);
      if (took > best) best = took;
    });
    return best;
  }
  // The other side's best capture if it were its turn on this position.
  function threatOn(R, s, side) {
    var t = { pits: s.pits, score: s.score, turn: 1 - side, quiet: s.quiet, done: false };
    return bestCapture(R, t);
  }

  function mancalaExplain(R, s, p) {
    var me = s.turn, who = SIDE[me], them = SIDE[1 - me];
    var perSide = R.stores ? 7 : 6, num = p - me * perSide + 1, n = s.pits[p];
    var res = R.sow(s, p), took = res.captured.reduce(function (a, c) { return a + c.n; }, 0);
    var feeding = R.seedsOn(s, 1 - me) === 0;
    var before = threatOn(R, s, me), after = res.state.done ? 0 : bestCapture(R, res.state);
    // after the move it is the other side's turn (unless an extra turn): their best capture is `after`
    var theirNext = res.extra ? threatOn(R, res.state, me) : after;
    var lastPit = res.path.length ? res.path[res.path.length - 1] : p;
    var facts = { side: who, pit: num, seeds: n, captured: took, extra: res.extra, grandSlam: res.grandSlam, feeding: feeding, threatBefore: before, threatAfter: theirNext, done: res.state.done };

    var text;
    if (took) text = who + ' sows pit ' + num + ' (' + plural(n, 'seed') + ') and the last seed lands on ' + them + '’s side, capturing ' + plural(took, 'seed') + '.';
    else if (res.extra) text = who + ' sows pit ' + num + ' (' + plural(n, 'seed') + ') and the last seed drops in the store, so ' + who + ' plays again.';
    else if (res.grandSlam) text = who + ' sows pit ' + num + ' and the last seed would capture every seed ' + them + ' has. That is a grand slam, so nothing is taken.';
    else if (feeding) text = who + ' sows pit ' + num + ' (' + plural(n, 'seed') + '): ' + them + ' has no seeds, so this move has to give some over.';
    else if (before > 0 && theirNext < before) text = who + ' sows pit ' + num + ' (' + plural(n, 'seed') + '), which cuts ' + them + '’s best capture from ' + plural(before, 'seed') + ' to ' + (theirNext ? plural(theirNext, 'seed') : 'nothing') + '.';
    else if (before > 0 && theirNext >= before) text = who + ' sows pit ' + num + ' (' + plural(n, 'seed') + '), but ' + them + ' can still capture ' + plural(theirNext, 'seed') + ' next.';
    else if (theirNext === 0) text = who + ' sows pit ' + num + ' (' + plural(n, 'seed') + ') and leaves ' + them + ' no capture next turn.';
    else text = who + ' sows pit ' + num + ' (' + plural(n, 'seed') + '); ' + them + ' could then capture ' + plural(theirNext, 'seed') + '.';
    if (res.state.done && !took) text = text.replace(/\.$/, ', and the game ends.');
    return { text: text, facts: facts };
  }

  root.ZimiExplain = root.ZimiExplain || {};
  root.ZimiExplain.mancala = mancalaExplain;
  if (typeof module !== 'undefined' && module.exports) module.exports = mancalaExplain;
})(typeof globalThis !== 'undefined' ? globalThis : this);
