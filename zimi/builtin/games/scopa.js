/* ZimiGames: Scopa, the Italian fishing game. You (south) against North, with
   the 40-card Italian deck (drawn by ZimiCards): coins, cups, swords and clubs, 1 to 7
   then Fante (8), Cavallo (9) and Re (10). Three cards each, four on the
   table. Play a card: if a table card has its value you must take that one,
   otherwise you may take a set of table cards that adds up to it, otherwise
   it stays on the table. Taking every table card is a scopa, worth a point
   (not on the last play). At the end the last player to capture takes what
   is left, then: most cards 1, most coins 1, the seven of coins (the
   settebello) 1, the best primiera 1, plus scope. First to 11 wins; ties play
   on.

   Card ids 0 to 39: suit = floor(id / 10) (0 coins, 1 cups, 2 swords, 3
   clubs), value = id % 10 + 1. State: deck, hands[2], table, captured[2],
   scope[2], dealer, turn, lastCapturer, lastPlay {seat, id, taken, scopa},
   scores[2], handNo, phase ('play' | 'sweep' | 'handEnd' | 'over'), result,
   moves. Seats: 0 you, 1 North. Pure functions; the page wiring at the bottom
   only runs in a browser. */
(function (root) {
  'use strict';
  var Z = root.ZimiCards, T = root.ZimiTable;

  var NAMES = ['You', 'North'], SUIT_NAMES = ['coins', 'cups', 'swords', 'clubs'], END_SCORE = 11, DECK = 40, PER_DEAL = 3, TABLE_START = 4, MAX_KINGS = 3, SETTEBELLO = 6;
  var COURT = { 8: 'Fante', 9: 'Cavallo', 10: 'Re' };
  var PRIMIERA = { 7: 21, 6: 18, 1: 16, 5: 15, 4: 14, 3: 13, 2: 12, 8: 10, 9: 10, 10: 10 };
  var value = function (id) { return id % 10 + 1; };
  var suitOf = function (id) { return Math.floor(id / 10); };
  var other = function (seat) { return 1 - seat; };
  var valueName = function (v) { return COURT[v] || String(v); };
  var nameOf = function (id) { return valueName(value(id)) + ' of ' + SUIT_NAMES[suitOf(id)]; };
  var sumOf = function (ids) { return ids.reduce(function (n, c) { return n + value(c); }, 0); };
  var nameList = function (ids) { return ids.map(nameOf).join(', '); };

  // ── Rules ───────────────────────────────────────────────────────────────
  // The ways `card` may capture from `table`: an equal value is forced (one
  // card, any of them); otherwise every set that adds up to its value.
  function captureOptions(table, card) {
    var v = value(card), same = table.filter(function (c) { return value(c) === v; });
    if (same.length) return same.map(function (c) { return [c]; });
    var out = [], n = table.length, mask, k, set, total;
    for (mask = 1; mask < (1 << n); mask++) {
      set = []; total = 0;
      for (k = 0; k < n; k++) if (mask & (1 << k)) { set.push(table[k]); total += value(table[k]); if (total > v) break; }
      if (total === v) out.push(set);
    }
    return out;
  }
  function isOption(table, card, set) {
    return captureOptions(table, card).some(function (o) { return o.length === set.length && o.every(function (c) { return set.indexOf(c) >= 0; }); });
  }

  function deal(order, handNo, scores, dealer) {
    var o = order.slice(), tries = 0;
    // Three or more kings on the table: deal again.
    while (o.slice(2 * PER_DEAL, 2 * PER_DEAL + TABLE_START).filter(function (c) { return value(c) === 10; }).length >= MAX_KINGS && tries++ < DECK) o.push(o.shift());
    return {
      deck: o.slice(2 * PER_DEAL + TABLE_START), hands: [o.slice(0, PER_DEAL), o.slice(PER_DEAL, 2 * PER_DEAL)], table: o.slice(2 * PER_DEAL, 2 * PER_DEAL + TABLE_START),
      captured: [[], []], scope: [0, 0], dealer: dealer, turn: other(dealer), lastCapturer: -1, lastPlay: null, scores: scores.slice(), handNo: handNo,
      phase: 'play', result: null, moves: 0
    };
  }
  function newGame(order, dealer) { return deal(order, 0, [0, 0], dealer === undefined ? 1 : dealer); }
  function nextHand(st, order) { return deal(order, st.handNo + 1, st.scores, other(st.dealer)); }

  function isLegal(st, seat, id, set) {
    if (st.phase !== 'play' || st.turn !== seat || st.hands[seat].indexOf(id) < 0) return false;
    var opts = captureOptions(st.table, id);
    return opts.length ? isOption(st.table, id, set || []) : !(set && set.length);
  }
  // Play `id` taking `set` (empty when it cannot capture).
  function play(st, seat, id, set) {
    var s = Z.clone(st), scopa = false;
    set = set || [];
    s.hands[seat].splice(s.hands[seat].indexOf(id), 1);
    s.moves++;
    if (set.length) {
      s.table = s.table.filter(function (c) { return set.indexOf(c) < 0; });
      s.captured[seat] = s.captured[seat].concat(set, [id]); s.lastCapturer = seat;
      var final = !s.deck.length && !s.hands[0].length && !s.hands[1].length;
      if (!s.table.length && !final) { s.scope[seat]++; scopa = true; }
    } else s.table.push(id);
    s.lastPlay = { seat: seat, id: id, taken: set.slice(), scopa: scopa };
    if (!s.hands[0].length && !s.hands[1].length) {
      if (s.deck.length) { s.hands = [s.deck.slice(0, PER_DEAL), s.deck.slice(PER_DEAL, 2 * PER_DEAL)]; s.deck = s.deck.slice(2 * PER_DEAL); s.turn = other(s.dealer); }
      else s.phase = 'sweep';
    } else s.turn = other(seat);
    return s;
  }
  // The last capturer takes what is left; the hand is scored.
  function finishHand(st) {
    var s = Z.clone(st), rest = s.table.slice();
    if (s.lastCapturer >= 0) s.captured[s.lastCapturer] = s.captured[s.lastCapturer].concat(rest);
    s.lastPlay = { seat: s.lastCapturer, id: null, taken: rest, scopa: false };
    s.table = []; s.moves++;
    s.result = scoreHand(s.captured, s.scope);
    s.scores = [s.scores[0] + s.result.points[0], s.scores[1] + s.result.points[1]];
    s.phase = gameWinner(s.scores) >= 0 ? 'over' : 'handEnd';
    return s;
  }
  function gameWinner(scores) {
    var top = Math.max(scores[0], scores[1]);
    if (top < END_SCORE || scores[0] === scores[1]) return -1;
    return scores[0] > scores[1] ? 0 : 1;
  }

  // A player's primiera: the best card of each suit; a player without all four suits has none.
  function primiera(cards) {
    var total = 0, suit;
    for (suit = 0; suit < 4; suit++) {
      var best = 0;
      cards.forEach(function (c) { if (suitOf(c) === suit) best = Math.max(best, PRIMIERA[value(c)]); });
      if (!best) return 0;
      total += best;
    }
    return total;
  }
  var coins = function (cards) { return cards.filter(function (c) { return suitOf(c) === 0; }).length; };
  function scoreHand(captured, scope) {
    var pts = [0, 0], lines = [], cards = captured.map(function (c) { return c.length; }), cn = captured.map(coins), pr = captured.map(primiera), s;
    var leader = function (a) { return a[0] === a[1] ? -1 : a[0] > a[1] ? 0 : 1; };
    var give = function (who, label, detail) { if (who >= 0) pts[who]++; lines.push(label + ': ' + detail + (who >= 0 ? ', ' + NAMES[who] + ' +1' : ', no point')); };
    give(leader(cards), 'Cards', cards[0] + ' to ' + cards[1]);
    give(leader(cn), 'Coins', cn[0] + ' to ' + cn[1]);
    s = captured[0].indexOf(SETTEBELLO) >= 0 ? 0 : captured[1].indexOf(SETTEBELLO) >= 0 ? 1 : -1;
    give(s, 'Settebello (the seven of coins)', s >= 0 ? NAMES[s] + ' took it' : 'nobody');
    give(leader(pr), 'Primiera', pr[0] + ' to ' + pr[1]);
    [0, 1].forEach(function (seat) { pts[seat] += scope[seat]; });
    lines.push('Scope: ' + scope[0] + ' to ' + scope[1]);
    return { points: pts, lines: lines, cards: cards, coins: cn, primiera: pr };
  }

  // ── The computer player ─────────────────────────────────────────────────
  function worth(card, set, st) {
    var v = 0, taken = set.concat([card]), table = st.table.filter(function (c) { return set.indexOf(c) < 0; });
    if (set.length) {
      v += taken.length;
      taken.forEach(function (c) { if (suitOf(c) === 0) v += 1.4; if (value(c) === 7) v += 2; if (value(c) === 6 || value(c) === 1) v += 0.7; if (c === SETTEBELLO) v += 12; });
      var final = !st.deck.length && st.hands[0].length + st.hands[1].length === 1;
      if (!table.length && !final) v += 7;
    } else {
      table = table.concat([card]);
      if (card === SETTEBELLO) v -= 12;
      v -= (suitOf(card) === 0 ? 2.5 : 0) + (value(card) === 7 ? 3 : 0) + (value(card) >= 8 ? -0.5 : 0) - value(card) * 0.05;
    }
    var left = sumOf(table);
    if (table.length && left <= 10) v -= 3.5;
    if (table.length && left > 10 && left <= 20 && table.length <= 3) v -= 0.5;
    return v;
  }
  function aiMove(st, seat) {
    var best = null, bestV = -1e9;
    st.hands[seat].forEach(function (card) {
      var opts = captureOptions(st.table, card);
      (opts.length ? opts : [[]]).forEach(function (set) {
        var v = worth(card, set, st);
        if (v > bestV) { bestV = v; best = { id: card, set: set }; }
      });
    });
    return best;
  }

  // ── The Italian deck ────────────────────────────────────────────────────
  // Drawn by the shared deck (ZimiCards.italianFaceMarkup), ids 0 to 39 as here.
  function scopaFace(id, standalone) { return Z.italianFaceMarkup(id, standalone); }

  // ── Layout ──────────────────────────────────────────────────────────────
  var ROW_GAP = 8, TABLE_GAP_SHARE = 0.12, HAND_STEP = 1.1;
  function geo(m) {
    var g = T.geometry(m, 1);
    g.showY = g.yTop;
    g.tableTop = g.yTop + g.ch + 16;
    g.gap = Math.round(g.cw * TABLE_GAP_SHARE);
    g.perRow = Math.max(1, Math.floor((g.W - 2 * g.pad + g.gap) / (g.cw + g.gap)));
    return g;
  }
  function tablePos(g, n) {
    var out = [], rows = Math.max(1, Math.ceil(n / g.perRow)), room = g.statusY - g.tableTop, rowStep = Math.min(g.ch + ROW_GAP, rows > 1 ? (room - g.ch) / (rows - 1) : g.ch);
    for (var k = 0; k < n; k++) {
      var r = Math.floor(k / g.perRow), inRow = Math.min(g.perRow, n - r * g.perRow), at = k - r * g.perRow;
      var x0 = (g.W - (inRow * g.cw + (inRow - 1) * g.gap)) / 2;
      out.push({ x: Math.round(x0 + at * (g.cw + g.gap)), y: Math.round(g.tableTop + r * rowStep) });
    }
    return out;
  }
  // view: { sel, build, show: {moves, stage} }
  function place(st, m, view) {
    var g = geo(m), cards = [], slots = [], sh = view && view.show && view.show.moves === st.moves ? view.show : null;
    var sel = view && view.sel !== null && view.sel !== undefined ? view.sel : null, build = (view && view.build) || [];
    var myTurn = st.phase === 'play' && st.turn === 0 && !sh;
    slots.push({ id: 'deck', x: g.W - g.pad - g.cw, y: g.northY, w: g.cw, h: g.ch, quiet: true, label: 'Deck' });
    slots.push({ id: 'table', x: g.pad, y: g.tableTop, w: g.W - 2 * g.pad, h: g.statusY - g.tableTop, quiet: true, label: 'Table' });
    // The cards that could be taken with the selected card.
    var options = sel !== null && st.hands[0].indexOf(sel) >= 0 ? captureOptions(st.table, sel) : [];
    var inOption = function (id) { return options.some(function (o) { return o.indexOf(id) >= 0; }); };
    var hand = T.handCards(g, st.hands[0], function (id) {
      var on = sel === id;
      return { raise: on, mark: on, label: nameOf(id) + (on ? ', selected' : ''), dim: false };
    }, null);
    var step = Math.min(g.cw * HAND_STEP, (g.W - 2 * g.pad - g.cw) / Math.max(1, st.hands[0].length - 1));
    // A hand of three spreads wider than a fan.
    var x0 = (g.W - (g.cw + (st.hands[0].length - 1) * step)) / 2;
    hand.cards.forEach(function (c, k) { c.x = Math.round(x0 + k * step); hand.slots[k].x = c.x; });
    slots = slots.concat(hand.slots); cards = cards.concat(hand.cards);
    cards = cards.concat(T.fan(g, 2, st.hands[1], false).map(function (c, k, a) { c.x = Math.round((g.W - (g.cw + (a.length - 1) * g.cw * 0.5)) / 2 + k * g.cw * 0.5); return c; }));
    st.deck.slice(0, 2).forEach(function (id, k) { cards.push({ id: id, pile: 'deck', idx: k, x: g.W - g.pad - g.cw + k * 2, y: g.northY + k * 2, up: false }); });
    var pos = tablePos(g, st.table.length);
    st.table.forEach(function (id, k) {
      var picked = build.indexOf(id) >= 0, hot = sel !== null && inOption(id);
      var played = sh && sh.stage === 0 && !sh.hasTaken && st.lastPlay && st.lastPlay.id === id;
      cards.push({ id: id, pile: 't' + id, idx: 0, x: pos[k].x, y: pos[k].y, up: true, mark: picked, glow: (hot && !picked) || !!played, dim: sel !== null && !hot });
      slots.push({ id: 't' + id, x: pos[k].x, y: pos[k].y, w: g.cw, h: g.ch, label: nameOf(id) + (picked ? ', chosen' : '') });
    });
    // What was just taken, held up for a moment and then swept to its owner.
    if (sh && st.lastPlay) {
      var lp = st.lastPlay, row = (lp.id === null ? [] : lp.taken.length ? [lp.id] : []).concat(lp.taken), n = row.length;
      var rs = n > 1 ? Math.min(g.cw * 0.7, (g.W - 2 * g.pad - g.cw) / (n - 1)) : 0, rx = (g.W - (g.cw + (n - 1) * rs)) / 2;
      var away = T.seatSpot(g, lp.seat === 0 ? 0 : 2);
      row.forEach(function (id, k) {
        var gone = sh.stage === 1;
        cards.push({ id: id, pile: 'show', idx: k, x: Math.round(gone ? away.x : rx + k * rs), y: Math.round(gone ? away.y : g.showY), up: true, glow: !gone });
      });
    }
    return { height: m.H, slots: slots, cards: cards };
  }

  var api = {
    NAMES: NAMES, END_SCORE: END_SCORE, value: value, suitOf: suitOf, nameOf: nameOf, captureOptions: captureOptions, isOption: isOption, isLegal: isLegal,
    deal: deal, newGame: newGame, nextHand: nextHand, play: play, finishHand: finishHand, gameWinner: gameWinner, primiera: primiera, scoreHand: scoreHand,
    aiMove: aiMove, face: scopaFace, geo: geo, place: place
  };
  root.ZimiScopa = api;

  // ── The page ────────────────────────────────────────────────────────────
  var AI_MS = 800, HOLD_MS = 1150, HOLD_YOU_MS = 450, SWEEP_MS = 400;
  function boot() {
    var d = root.document, t, board, session, view = { sel: null, build: [], show: null, flash: '' };
    var tallies = [Z.h('div', { class: 'sc-tally' }), Z.h('div', { class: 'sc-tally' })];
    Z.pageEls().table.appendChild(tallies[0]); Z.pageEls().table.appendChild(tallies[1]);
    var busy = function () { var st = session.state; return !!(view.show && view.show.moves === st.moves); };

    function setTally(g, st) {
      [0, 1].forEach(function (seat) {
        var el = tallies[seat], cap = st.captured[seat];
        el.textContent = '';
        [NAMES[seat], cap.length + ' cards', coins(cap) + ' coins', st.scope[seat] + (st.scope[seat] === 1 ? ' scopa' : ' scope')].forEach(function (line, k) {
          el.appendChild(Z.h('div', { class: k ? '' : 'sc-name', text: line }));
        });
        el.style.left = g.pad + 'px';
        el.style.top = (seat === 0 ? g.southY : g.northY) + 'px';
      });
    }
    function optionLabel(set) { return set.map(nameOf).join(' + '); }
    function hud(st) {
      var g = geo(board.metrics());
      setTally(g, st);
      var out = {
        chips: [{ name: 'You', text: String(st.scores[0]), turn: st.phase === 'play' && st.turn === 0 && !busy() }, { name: 'North', text: String(st.scores[1]), turn: st.phase === 'play' && st.turn === 1 && !busy() }, { name: 'Deck', text: String(st.deck.length) }],
        sub: 'Hand ' + (st.handNo + 1) + ' · to ' + END_SCORE, text: ''
      };
      var lp = st.lastPlay, told = '';
      if (lp && lp.id !== null) {
        told = (lp.seat === 0 ? 'You play ' : 'North plays ') + nameOf(lp.id) + (lp.taken.length ? ' and ' + (lp.seat === 0 ? 'take ' : 'takes ') + lp.taken.map(nameOf).join(', ') : '') + (lp.scopa ? '. Scopa!' : '');
      } else if (lp) told = (lp.seat === 0 ? 'You take' : 'North takes') + ' the last cards';
      if (st.phase === 'play') {
        if (busy()) out.text = told;
        else if (st.turn === 0) {
          var opts = view.sel !== null ? captureOptions(st.table, view.sel) : [];
          if (view.sel !== null && opts.length > 1) {
            out.text = 'Pick the cards to take, or choose a way below';
            out.choices = opts.map(function (o) { return { label: optionLabel(o), onclick: function () { doMove(0, view.sel, o); } }; });
          } else out.text = (told ? told + '. ' : '') + 'Your play';
        } else out.text = (told ? told + '. ' : '') + 'North is thinking';
      } else if (st.phase === 'handEnd') { out.text = 'Hand over'; out.label = 'Next hand'; out.action = startNextHand; }
      else if (st.phase === 'over') { out.text = 'Game over'; }
      return out;
    }

    function drive() {
      var st = session.state;
      if (st.phase === 'sweep') { session.later(finish, 300); return; }
      if (st.phase === 'play' && st.turn === 1 && !busy()) session.later(aiTurn, AI_MS);
    }
    function aiTurn() {
      var st = session.state;
      if (st.phase !== 'play' || st.turn !== 1 || busy()) return;
      var mv = aiMove(st, 1);
      doMove(1, mv.id, mv.set);
    }
    // Show the play (and what it took), sweep it to its owner, then go on.
    function doMove(seat, id, set) {
      var st = session.state;
      if (!isLegal(st, seat, id, set)) return;
      var next = play(st, seat, id, set);
      view.sel = null; view.build = [];
      if (seat === 0) session.commit(next); else session.follow(next);
      reveal(next, seat === 0 ? HOLD_YOU_MS : HOLD_MS);
    }
    function reveal(st, hold) {
      view.show = { moves: st.moves, stage: 0, hasTaken: !!(st.lastPlay && st.lastPlay.taken.length) };
      board.refresh(); t.paint();
      session.later(function () {
        if (!view.show) return;
        view.show.stage = 1; board.refresh();
        session.later(function () {
          view.show = null; board.refresh(); t.paint();
          var cur = session.state;
          if (cur.phase === 'handEnd') handOver(); else if (cur.phase === 'over') gameOver(); else drive();
        }, SWEEP_MS);
      }, hold);
    }
    function finish() {
      var st = session.state;
      if (st.phase !== 'sweep') return;
      var next = finishHand(st);
      session.follow(next);
      if (next.lastPlay.taken.length) reveal(next, HOLD_MS);
      else { if (next.phase === 'handEnd') handOver(); else gameOver(); }
    }
    function resultLines(st) {
      var r = st.result;
      return r.lines.concat(['This hand: You +' + r.points[0] + ', North +' + r.points[1] + '. Score ' + st.scores[0] + ' to ' + st.scores[1] + '.']);
    }
    function handOver() {
      var st = session.state;
      T.lineSheet('Hand ' + (st.handNo + 1), resultLines(st), [{ label: 'Next hand', primary: true, onclick: startNextHand }]);
    }
    function gameOver() {
      var st = session.state, won = gameWinner(st.scores) === 0, lines = resultLines(st);
      lines.push(won ? 'You win.' : 'North wins.');
      if (won) session.win(st.scores[0]); else session.lose('North wins', lines, st.scores[0]);
    }
    function startNextHand() {
      var st = session.state;
      if (st.phase !== 'handEnd') return;
      session.history = []; view.sel = null; view.build = [];
      session.follow(nextHand(st, Z.shuffled(Math.random).filter(function (c) { return c < DECK; })));
      drive();
    }
    var idOf = function (pile) { return parseInt(pile.slice(1), 10); };
    function tap(pile) {
      var st = session.state, id = idOf(pile), kind = pile.charAt(0);
      if (st.phase !== 'play' || isNaN(id)) return false;
      if (st.turn !== 0 || busy()) { t.flash('Wait for your turn'); return false; }
      if (kind === 'h') {
        if (view.sel === id) { view.sel = null; view.build = []; board.refresh(); t.paint(); return true; }
        var opts = captureOptions(st.table, id);
        if (opts.length === 1) { doMove(0, id, opts[0]); return true; }
        if (!opts.length) { doMove(0, id, []); return true; }
        view.sel = id; view.build = []; board.refresh(); t.paint();
        return true;
      }
      if (kind === 't') {
        if (view.sel === null) { t.flash('Choose a card from your hand first'); return false; }
        var at = view.build.indexOf(id);
        if (at >= 0) view.build.splice(at, 1); else view.build.push(id);
        var set = view.build.slice();
        if (isOption(st.table, view.sel, set)) { doMove(0, view.sel, set); return true; }
        var fits = captureOptions(st.table, view.sel).some(function (o) { return set.every(function (c) { return o.indexOf(c) >= 0; }); });
        if (!fits) { view.build.splice(view.build.indexOf(id), 1); t.flash('That does not add up to ' + value(view.sel)); }
        board.refresh(); t.paint();
        return true;
      }
      return false;
    }
    function startGame() {
      view.sel = null; view.build = []; view.show = null; view.flash = '';
      session.reset(newGame(Z.shuffled(Math.random).filter(function (c) { return c < DECK; }), Math.floor(Math.random() * 2)));
      drive();
    }
    var cards40 = function (st) { return [].concat(st.captured[0], st.captured[1]); };
    t = T.create({
      id: 'scopa', name: 'Scopa', view: view, geo: geo, place: place, hud: hud, newGame: startGame, tap: tap, cols: 5, heightShare: 0.13, face: scopaFace,
      canPick: function () { return false; },
      stat: function (sec, st) { return Z.fmtTime(sec) + ' · ' + st.scores[0] + '-' + st.scores[1]; },
      cascadeOrder: function (st) { return cards40(st).slice(0, 24).map(function (id) { return { id: id }; }); },
      winLines: function (sec, st) { return resultLines(st).concat(['You win, ' + st.scores[0] + ' to ' + st.scores[1] + ', after ' + Z.plural(st.handNo + 1, 'hand') + '.']); },
      rules: 'Play a card. If a table card has the same value you take it; otherwise you may take cards that add up to it; otherwise it stays on the table. Fante is 8, Cavallo 9, Re 10. Clearing the table is a scopa (1 point, not on the last play). The last player to capture takes the rest. Points: most cards, most coins, the seven of coins, the best primiera (sevens count most), and each scopa. First to 11 wins. Tap a card to play it; when several sets would work, tap the table cards you want or pick a way from the list.'
    });
    board = t.board; session = t.session;
    api.session = session; api.board = board;
    startGame();
  }

  if (root.document && root.document.getElementById('zc-table')) boot();
})(typeof globalThis !== 'undefined' ? globalThis : window);
