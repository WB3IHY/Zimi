/* ZimiGames: Yacht. Our own code, GPL-3.0. No network, no fonts, no modules.
   The rules (pure functions, no DOM, so node can test them) and the page (only when there is a document). */
(function (root) {
  'use strict';

  // ── the rules ────────────────────────────────────────────────────────────
  var DICE = 5, ROLLS = 3, BONUS_AT = 63, BONUS = 35, STRAIGHT = 30, YACHT = 50;
  var CATS = [
    { id: 'ones', label: 'Ones', face: 1 }, { id: 'twos', label: 'Twos', face: 2 }, { id: 'threes', label: 'Threes', face: 3 },
    { id: 'fours', label: 'Fours', face: 4 }, { id: 'fives', label: 'Fives', face: 5 }, { id: 'sixes', label: 'Sixes', face: 6 },
    { id: 'three', label: 'Three of a kind' }, { id: 'four', label: 'Four of a kind' }, { id: 'house', label: 'Full house' },
    { id: 'little', label: 'Little straight (1-5)' }, { id: 'big', label: 'Big straight (2-6)' },
    { id: 'choice', label: 'Choice' }, { id: 'yacht', label: 'Yacht' }
  ];
  // What a row usually ends up worth for a player who is doing fine; the computer's yardstick.
  var PAR = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18, three: 17, four: 12, house: 14, little: 12, big: 12, choice: 22, yacht: 8 };

  function sum(d) { return d.reduce(function (a, b) { return a + b; }, 0); }
  function counts(d) { var c = [0, 0, 0, 0, 0, 0, 0]; d.forEach(function (v) { c[v]++; }); return c; }

  // The score a set of five dice makes in a row.
  function score(cat, d) {
    var c = counts(d), top = Math.max.apply(null, c.slice(1)), i;
    for (i = 0; i < CATS.length; i++) if (CATS[i].id === cat && CATS[i].face) return CATS[i].face * c[CATS[i].face];
    switch (cat) {
      case 'three': return top >= 3 ? sum(d) : 0;
      case 'four': return top >= 4 ? sum(d) : 0;
      case 'house': return c.slice(1).filter(function (n) { return n === 3; }).length === 1 && c.slice(1).filter(function (n) { return n === 2; }).length === 1 ? sum(d) : 0;
      case 'little': return [1, 2, 3, 4, 5].every(function (v) { return c[v] === 1; }) ? STRAIGHT : 0;
      case 'big': return [2, 3, 4, 5, 6].every(function (v) { return c[v] === 1; }) ? STRAIGHT : 0;
      case 'choice': return sum(d);
      case 'yacht': return top === DICE ? YACHT : 0;
    }
    return 0;
  }

  function upper(card) { var t = 0; CATS.slice(0, 6).forEach(function (k) { if (card[k.id] !== undefined) t += card[k.id]; }); return t; }
  function bonus(card) { return upper(card) >= BONUS_AT ? BONUS : 0; }
  function total(card) { var t = bonus(card); CATS.forEach(function (k) { if (card[k.id] !== undefined) t += card[k.id]; }); return t; }
  function openCats(card) { return CATS.filter(function (k) { return card[k.id] === undefined; }).map(function (k) { return k.id; }); }

  function createGame(computers, seed) {
    var players = [{ name: 'You', ai: false, card: {} }], i;
    for (i = 0; i < computers; i++) players.push({ name: 'CPU ' + (i + 1), ai: true, card: {} });
    return { players: players, turn: 0, dice: [0, 0, 0, 0, 0], held: [false, false, false, false, false], rollsLeft: ROLLS, over: false, rng: root.ZimiUtil.counted(seed) };
  }

  function die(g) { return 1 + Math.floor(g.rng() * 6); }

  // Roll every die not held (all of them on the first roll). False when no roll is left.
  function roll(g) {
    if (g.over || g.rollsLeft <= 0) return false;
    for (var i = 0; i < DICE; i++) if (g.rollsLeft === ROLLS || !g.held[i]) g.dice[i] = die(g);
    g.rollsLeft--;
    return true;
  }
  function toggleHold(g, i) {
    if (g.rollsLeft === ROLLS || g.rollsLeft === 0 || i < 0 || i >= DICE) return false;
    g.held[i] = !g.held[i];
    return true;
  }
  // Score the current dice in a row for the player whose turn it is, and pass the turn.
  function choose(g, cat) {
    var p = g.players[g.turn];
    if (g.over || g.rollsLeft === ROLLS || p.card[cat] !== undefined || !CATS.some(function (k) { return k.id === cat; })) return false;
    p.card[cat] = score(cat, g.dice);
    g.turn = (g.turn + 1) % g.players.length;
    g.dice = [0, 0, 0, 0, 0]; g.held = [false, false, false, false, false]; g.rollsLeft = ROLLS;
    g.over = g.players.every(function (q) { return openCats(q.card).length === 0; });
    return true;
  }

  // The computer. How good a set of dice is to it: the best open row, measured against par.
  function worth(d, open) {
    var best = -99;
    for (var i = 0; i < open.length; i++) { var v = score(open[i], d) - PAR[open[i]]; if (v > best) best = v; }
    return best;
  }
  function bestRow(d, open) {
    var best = open[0], bv = -999;
    open.forEach(function (c) { var v = score(c, d) - PAR[c] + (score(c, d) === 0 ? -0.5 : 0); if (v > bv) { bv = v; best = c; } });
    return best;
  }
  // Which dice to keep: the mask whose average re-roll is worth most.
  function bestHold(d, open) {
    var bestMask = 0, bestV = -1e9;
    for (var mask = 0; mask < 32; mask++) {
      var free = [], base = d.slice(), i;
      for (i = 0; i < DICE; i++) if (!(mask & (1 << i))) free.push(i);
      var n = Math.pow(6, free.length), tot = 0, k, j, t;
      for (k = 0; k < n; k++) {
        t = k;
        for (j = 0; j < free.length; j++) { base[free[j]] = 1 + (t % 6); t = Math.floor(t / 6); }
        tot += worth(base, open);
      }
      var v = tot / n;
      if (v > bestV + 1e-9) { bestV = v; bestMask = mask; }
    }
    return [0, 1, 2, 3, 4].map(function (i) { return !!(bestMask & (1 << i)); });
  }

  var Engine = { CATS: CATS, DICE: DICE, ROLLS: ROLLS, BONUS_AT: BONUS_AT, BONUS: BONUS, score: score, upper: upper, bonus: bonus, total: total, openCats: openCats, createGame: createGame, roll: roll, toggleHold: toggleHold, choose: choose, bestHold: bestHold, bestRow: bestRow };
  root.YachtEngine = Engine;

  if (typeof document === 'undefined') return;

  // ── the page ─────────────────────────────────────────────────────────────
  var Play = root.ArcadePlay, $ = Play.$;
  var SETTINGS_KEY = 'zimi.games.yacht.settings', BEST_KEY = 'zimi.games.yacht.best';
  var CPU_DELAY_MS = 650;
  Play.applyTheme();

  var els = { dice: $('yc-dice'), roll: $('yc-roll'), rolls: $('yc-rolls'), msg: $('yc-msg'), card: $('yc-card'), sheet: $('yc-sheet'), title: $('yc-sheet-title'), text: $('yc-sheet-text'), go: $('yc-go'), opp: $('yc-opp'), nu: $('yc-new') };
  var settings = Play.load(SETTINGS_KEY, { computers: 0 }), best = Play.load(BEST_KEY, {});
  var g, seats, timer = null, dieEls = [];
  // Each seat is the Computer or a Person; people take turns at the same screen (nothing is hidden in Yacht).
  function newTable() {
    var n = settings.computers + 1;
    seats = root.ZimiSeats.create({ id: 'yacht', seats: n });
    g = createGame(settings.computers, Play.randomSeed());
    var cpu = 0;
    g.players.forEach(function (p, i) { p.ai = !seats.person(i); p.name = p.ai ? 'CPU ' + (++cpu) : seats.name(i); });
    if (n === 1) g.players[0].name = 'You';
  }
  newTable();

  function mine() { return !g.players[g.turn].ai && !g.over; }

  function buildDice() {
    els.dice.textContent = '';
    dieEls = [];
    for (var i = 0; i < DICE; i++) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pl-die';
      (function (n) { b.addEventListener('click', function () { if (mine() && toggleHold(g, n)) paint(); }); })(i);
      els.dice.appendChild(b); dieEls.push(b);
    }
  }

  function paintDice() {
    var rolled = g.rollsLeft < ROLLS;
    dieEls.forEach(function (b, i) {
      Play.pips(b, g.dice[i]);
      b.setAttribute('aria-pressed', String(g.held[i]));
      b.disabled = !mine() || !rolled || g.rollsLeft === 0;
      b.setAttribute('aria-label', rolled ? 'Die ' + (i + 1) + ': ' + g.dice[i] + (g.held[i] ? ', kept' : '') : 'Die ' + (i + 1) + ', not rolled');
    });
  }

  function paintCard() {
    var t = els.card, i, p, rolled = g.rollsLeft < ROLLS, human = mine();
    var cap = t.querySelector('caption');
    t.textContent = ''; t.appendChild(cap);
    var head = t.createTHead().insertRow(); head.appendChild(document.createElement('th'));
    g.players.forEach(function (pl, n) { var th = document.createElement('th'); th.scope = 'col'; th.textContent = pl.name; if (n === g.turn && !g.over) th.className = 'yc-turn'; head.appendChild(th); });
    var body = t.createTBody();
    function row(label, cls, cell) {
      var tr = body.insertRow(); if (cls) tr.className = cls;
      var th = document.createElement('th'); th.scope = 'row'; th.textContent = label; tr.appendChild(th);
      g.players.forEach(function (pl, n) { var td = tr.insertCell(); cell(td, pl, n); });
    }
    CATS.forEach(function (k, idx) {
      row(k.label, '', function (td, pl, n) {
        var v = pl.card[k.id];
        if (v !== undefined) { td.textContent = v; return; }
        if (n === g.turn && human && rolled) {
          var b = document.createElement('button'); b.type = 'button'; b.className = 'yc-can';
          b.textContent = score(k.id, g.dice);
          b.setAttribute('aria-label', k.label + ': score ' + b.textContent);
          b.addEventListener('click', function () { pick(k.id); });
          td.className = 'yc-open'; td.appendChild(b);
        } else td.textContent = '';
      });
      if (idx === 5) {
        row('Top six (63 earns 35)', 'yc-sum', function (td, pl) { td.textContent = upper(pl.card) + (bonus(pl.card) ? ' +' + BONUS : ''); });
      }
    });
    row('Total', 'yc-total', function (td, pl) { td.textContent = total(pl.card); });
  }

  function paint() {
    paintDice(); paintCard();
    els.rolls.textContent = g.over ? '' : (g.rollsLeft === ROLLS ? 'Rolls left: 3' : 'Rolls left: ' + g.rollsLeft);
    els.roll.disabled = !mine() || g.rollsLeft === 0;
    els.roll.textContent = g.rollsLeft === ROLLS ? 'Roll' : 'Roll again';
    var p = g.players[g.turn];
    if (g.over) return;
    els.msg.textContent = mine() ? (g.rollsLeft === 0 ? 'Choose a row to score.' : g.rollsLeft === ROLLS ? (g.players.length > 1 ? (seats.isYou(g.turn) ? 'Your turn' : p.name + ', your turn') + '. Roll the dice.' : 'Roll the dice.') : 'Tap dice to keep them, or score a row.') : p.name + ' is playing.';
  }

  function pick(cat) {
    if (!mine() || !choose(g, cat)) return;
    afterTurn();
  }
  function afterTurn() {
    paint();
    if (g.over) return finish();
    if (g.players[g.turn].ai) cpuTurn();
  }

  function cpuTurn() {
    var step = function () {
      if (g.over || !g.players[g.turn].ai) return;
      var open = openCats(g.players[g.turn].card);
      if (g.rollsLeft === ROLLS) roll(g);
      else if (g.rollsLeft > 0) {
        var hold = bestHold(g.dice, open);
        if (hold.every(Boolean)) { choose(g, bestRow(g.dice, open)); return afterTurn(); }
        g.held = hold; roll(g); g.held = [false, false, false, false, false];
        paint(); timer = Play.later(function () { g.held = [false, false, false, false, false]; step(); }, CPU_DELAY_MS); return;
      } else { choose(g, bestRow(g.dice, open)); return afterTurn(); }
      paint(); timer = Play.later(step, CPU_DELAY_MS);
    };
    timer = Play.later(step, CPU_DELAY_MS);
  }

  function finish() {
    var scores = g.players.map(function (p) { return total(p.card); }), top = Math.max.apply(null, scores);
    var key = String(g.players.length), text;
    var me = seats.people()[0];
    if (g.players.length === 1) text = 'You scored ' + scores[0] + '.';
    else {
      var winners = g.players.filter(function (p, i) { return scores[i] === top; });
      text = (winners.length > 1 ? 'A tie at ' + top + '.' : seats.isYou(g.players.indexOf(winners[0])) ? 'You win with ' + top + '.' : winners[0].name + ' wins with ' + top + (seats.hotseat() ? '.' : '. You scored ' + scores[me] + '.'));
    }
    if (seats.hotseat()) text += ' ' + g.players.map(function (p, i) { return p.name + ' ' + scores[i]; }).join(', ') + '.';
    else if (scores[me] > (best[key] || 0)) { best[key] = scores[me]; Play.save(BEST_KEY, best); text += ' A new best for this table.'; }
    else text += ' Best: ' + best[key] + '.';
    els.msg.textContent = text;
    showSheet('Game over', text, 'Play again');
  }

  function paintOpp() {
    els.opp.textContent = '';
    [0, 1, 2, 3].forEach(function (n) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = n === 0 ? 'Solo' : String(n + 1);
      b.setAttribute('aria-pressed', String(settings.computers === n));
      b.addEventListener('click', function () { settings.computers = n; Play.save(SETTINGS_KEY, settings); paintOpp(); });
      b.setAttribute('aria-label', n === 0 ? 'Solo' : n + 1 + ' players');
      els.opp.appendChild(b);
    });
  }
  function showSheet(title, text, label) {
    els.title.textContent = title; els.text.textContent = text; els.go.textContent = label; paintOpp();
    var host = $('yc-seats'); host.textContent = '';
    if (settings.computers > 0) host.appendChild(root.ZimiSeats.create({ id: 'yacht', seats: settings.computers + 1 }).block());
    Play.openSheet(els.sheet, '#yc-go');
  }
  function begin() {
    if (timer) timer.cancel();
    newTable();
    Play.closeSheet(els.sheet); els.msg.textContent = ''; paint();
    if (g.players[g.turn].ai) cpuTurn();
  }
  els.go.addEventListener('click', begin);
  els.nu.addEventListener('click', function () { if (timer) timer.cancel(); showSheet('New game', 'Start over with a fresh card?', 'Start'); });
  els.roll.addEventListener('click', function () { if (mine() && roll(g)) paint(); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || !els.sheet.hidden) return;
    if (e.target && e.target.closest && e.target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.key === ' ' || e.key === 'r' || e.key === 'R') { e.preventDefault(); if (mine() && roll(g)) paint(); }
    else if (e.key >= '1' && e.key <= '5') { if (mine() && toggleHold(g, +e.key - 1)) paint(); }
  });

  buildDice();
  paint();
  showSheet('Yacht', '13 rows, 13 turns. Play alone for a high score, or against computers.', 'Start');
  root.__yacht = { get g() { return g; } };
})(this);
