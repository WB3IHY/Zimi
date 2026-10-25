/* ZimiGames: Watch and learn, Backgammon. One or two sentences for a whole turn, from facts
   found by playing the steps out on the position: hits, points made, checkers brought in from
   the bar, checkers borne off, a back checker running, and what is left exposed (the chance the
   other side hits it is counted over all 36 rolls, by searching their legal plays). Our own
   code, GPL-3.0.

     ZimiExplain.backgammon(E, state, steps, dice) -> { text, facts }

   E is BackgammonEngine (backgammon.js), state the position with the dice rolled, steps the play
   (each { from, to, die } in pip numbers, 25 is the bar and 0 is off), dice the two numbers rolled. */
(function (root) {
  'use strict';
  var NAMES = ['White', 'Black'], ROLLS = 36, BAR = 25, BACK_ZONE = 19;

  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function spot(r) { return r === BAR ? 'the bar' : r === 0 ? 'off' : String(r); }

  // In how many of the 36 rolls can the side to move hit a checker?
  function hitRolls(E, s) {
    var o = E.copy(s), n = 0, a, b;
    function canHit(state) {
      var list = E.legalSteps(state), i;
      for (i = 0; i < list.length; i++) {
        var next = E.applyStep(state, list[i]);
        if (next.hit) return true;
        if (next.dice.length && canHit(next)) return true;
      }
      return false;
    }
    for (a = 1; a <= 6; a++) for (b = 1; b <= 6; b++) {
      o.dice = a === b ? [a, a, a, a] : [a, b]; o.rolled = true;
      if (canHit(o)) n++;
    }
    return n;
  }

  function backgammonExplain(E, s, steps, dice) {
    var p = s.turn, who = NAMES[p], cur = s, hits = 0, made = [], entered = 0, off = 0, ran = null, moves = [];
    steps.forEach(function (st) {
      var landing = st.to ? E.idxOf(p, st.to) : -1;
      var own = landing >= 0 ? E.countAt(cur, p, landing) : 0;
      cur = E.applyStep(cur, st);
      if (cur.hit) hits++;
      if (own === 1 && st.to) made.push(st.to);
      if (st.from === BAR) entered++;
      if (st.to === 0) off++;
      if (st.from >= BACK_ZONE && st.from < BAR && st.to < st.from && !ran) ran = st;
      moves.push(spot(st.from) + '/' + spot(st.to) + (cur.hit ? '*' : ''));
    });
    var after = E.copy(cur); after.turn = 1 - p; after.dice = []; after.rolled = false;
    var blots = [];
    for (var r = 1; r <= 24; r++) if (E.countAt(after, p, E.idxOf(p, r)) === 1) blots.push(r);
    var contact = E.hasContact(after);
    var risk = contact && blots.length ? hitRolls(E, after) : 0;
    var rolled = dice && dice.length ? who + ' rolls ' + dice.join(' and ') : who + ' rolls';
    var facts = { side: who, hits: hits, madePoints: made.length, entered: entered, off: off, blots: blots.length, risk: risk, contact: contact, steps: steps.length };

    if (!steps.length) return { text: who + ' has no legal move with that roll and loses the turn.', facts: facts };
    var parts = [];
    if (entered) parts.push('brings ' + (entered === 1 ? 'a checker' : entered + ' checkers') + ' in from the bar');
    if (hits) parts.push('hits ' + (hits === 1 ? 'a blot' : hits + ' blots') + ', sending ' + (hits === 1 ? 'it' : 'them') + ' to the bar');
    if (made.length) parts.push('makes the ' + made.join(' and ') + ' point' + (made.length > 1 ? 's' : '') + ', which the other side cannot land on');
    if (off) parts.push('bears off ' + plural(off, 'checker'));
    if (ran && !hits && !made.length) parts.push('runs a back checker from the ' + ran.from + ' point toward home');
    var text = rolled + ': ' + moves.join(', ') + '.';
    if (parts.length) text += ' It ' + parts.slice(0, 2).join(' and ') + '.';
    if (!contact) text += ' The sides have passed each other, so it is a pure race: fewer pips to go wins (White ' + E.pips(after, 0) + ', Black ' + E.pips(after, 1) + ').';
    else if (!blots.length) text += ' It leaves no blot to hit.';
    else text += ' It leaves ' + (blots.length === 1 ? 'a blot' : blots.length + ' blots') + ' that can be hit by ' + risk + ' of ' + ROLLS + ' rolls.';
    return { text: text, facts: facts };
  }

  root.ZimiExplain = root.ZimiExplain || {};
  root.ZimiExplain.backgammon = backgammonExplain;
  if (typeof module !== 'undefined' && module.exports) module.exports = backgammonExplain;
})(typeof globalThis !== 'undefined' ? globalThis : this);
