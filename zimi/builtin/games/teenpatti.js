/* ZimiGames: Teen Patti, the Indian three-card game, you and three computer
   players (Asha, Dev and Rani) with chips and a standard 52-card deck.
   Everyone pays a boot into the pot and gets three cards face down. A player
   may play blind (without looking) or look at the cards and play seen. The
   stake is the blind bet: a blind player pays the stake (or double it to raise
   it), a seen player pays double the stake (or four times it to raise it, which
   doubles the stake). Pack folds. A seen player may ask the seen player before
   him for a side show (paying a chaal): if accepted the weaker hand packs, and
   a tie sends the asker out. With two players left either may ask for a show:
   pay a bet and both hands are turned over; a tie goes to the player who did
   not ask. Hands, best first: trail (three of a kind), pure sequence (a straight
   flush), sequence (a straight), colour (a flush), pair, high card. In a
   sequence A-2-3 is the highest, then A-K-Q, K-Q-J down to 4-3-2. If a bet is
   more than a player has, they go all in and the hands are shown. Reach
   1500 chips to win, or play until the others are out; you lose when you cannot pay the boot.

   State: hands[4], chips[4], paid[4], pot, stake, boot, seen[4], folded[4],
   out[4] (out of the match), allIn[4], dealer, turn, phase ('bet' | 'side' |
   'handEnd' | 'over'), side {from, to}, result {winner, kind, ...}, say {seat,
   text}, round, moves. Seats clockwise: 0 you, 1 West (Asha), 2 North (Dev),
   3 East (Rani). Pure functions; the page wiring at the bottom only runs in a
   browser. */
(function (root) {
  'use strict';
  var Z = root.ZimiCards, T = root.ZimiTable;

  var SEATS = 4, HAND = 3, START_CHIPS = 1000, BOOT = 10, MAX_STAKE = 160, TARGET = 1500;
  var NAMES = ['You', 'Asha', 'Dev', 'Rani'], STYLES = [null, 'careful', 'bold', 'bluffer'];
  var CATEGORIES = ['high card', 'pair', 'colour', 'sequence', 'pure sequence', 'trail'];
  var rankValue = function (id) { return Z.rank(id) === 1 ? 14 : Z.rank(id); };
  var suitOf = Z.suit;

  // ── Hands ───────────────────────────────────────────────────────────────
  // A hand as a list to compare: [category, tie-breakers...]; higher wins.
  function evaluate(cards) {
    var v = cards.map(rankValue).sort(function (a, b) { return b - a; }), flush = cards.every(function (c) { return suitOf(c) === suitOf(cards[0]); });
    var trail = v[0] === v[2], pair = v[0] === v[1] || v[1] === v[2];
    var lowAce = v[0] === 14 && v[1] === 3 && v[2] === 2; // A-2-3, the highest sequence
    var run = v[0] - 1 === v[1] && v[1] - 1 === v[2], seqTop = lowAce ? 15 : v[0];
    if (trail) return [5, v[0]];
    if (lowAce || run) return [flush ? 4 : 3, seqTop];
    if (flush) return [2].concat(v);
    if (pair) { var p = v[0] === v[1] ? v[0] : v[1], k = v[0] === v[1] ? v[2] : v[0]; return [1, p, k]; }
    return [0].concat(v);
  }
  function compare(a, b) {
    for (var i = 0; i < Math.max(a.length, b.length); i++) { var d = (a[i] || 0) - (b[i] || 0); if (d) return d; }
    return 0;
  }
  var describe = function (cards) { return CATEGORIES[evaluate(cards)[0]]; };

  // ── Rules ───────────────────────────────────────────────────────────────
  function deal(order, round, chips, dealer) {
    var cards = order.filter(function (c) { return c < 52; }), out = chips.map(function (c) { return c < BOOT; }), hands = [], i, pot = 0, paid = [0, 0, 0, 0], nc = chips.slice();
    var k = 0;
    for (i = 0; i < SEATS; i++) {
      if (out[i]) { hands.push([]); continue; }
      hands.push(cards.slice(k * HAND, (k + 1) * HAND)); k++;
      nc[i] -= BOOT; pot += BOOT; paid[i] = BOOT;
    }
    var s = {
      hands: hands, chips: nc, paid: paid, pot: pot, stake: BOOT, seen: [false, false, false, false], folded: out.slice(), out: out, allIn: [false, false, false, false], dealer: dealer, turn: 0, phase: 'bet',
      side: null, result: null, say: null, round: round, moves: 0
    };
    s.turn = nextSeat(s, dealer);
    return s;
  }
  function newGame(order, dealer) { return deal(order, 0, [START_CHIPS, START_CHIPS, START_CHIPS, START_CHIPS], dealer === undefined ? 3 : dealer); }
  function nextHand(st, order) {
    var dealer = st.dealer;
    do dealer = (dealer + 1) % SEATS; while (st.chips[dealer] < BOOT && dealer !== st.dealer);
    return deal(order, st.round + 1, st.chips, dealer);
  }
  var active = function (s) { return [0, 1, 2, 3].filter(function (i) { return !s.folded[i] && !s.out[i]; }); };
  // The next player after `seat` who can still act.
  function nextSeat(s, seat) {
    for (var i = 1; i <= SEATS; i++) { var n = (seat + i) % SEATS; if (!s.folded[n] && !s.out[n] && !s.allIn[n]) return n; }
    return seat;
  }
  function prevActive(s, seat) {
    for (var i = 1; i < SEATS; i++) { var n = (seat - i + SEATS) % SEATS; if (!s.folded[n] && !s.out[n]) return n; }
    return -1;
  }

  // What a bet costs `seat` now.
  function cost(s, seat, type) {
    var st = s.stake;
    return { blind: st, blindRaise: 2 * st, chaal: 2 * st, raise: 4 * st, sideshow: 2 * st, show: s.seen[seat] ? 2 * st : st }[type];
  }
  // The actions open to `seat`: [{ type, cost }].
  function actions(s, seat) {
    var out = [], push = function (type) { out.push({ type: type, cost: type === 'see' || type === 'pack' ? 0 : cost(s, seat, type) }); };
    if (s.phase !== 'bet' || s.turn !== seat || s.folded[seat] || s.out[seat]) return out;
    var raise = s.stake * 2 <= MAX_STAKE, many = active(s).length > 2;
    if (!s.seen[seat]) { push('see'); push('blind'); if (raise) push('blindRaise'); }
    else {
      push('chaal'); if (raise) push('raise');
      var prev = prevActive(s, seat);
      if (many && prev >= 0 && s.seen[prev]) push('sideshow');
    }
    if (!many) push('show');
    push('pack');
    return out;
  }
  function isLegal(s, seat, type) { return actions(s, seat).some(function (a) { return a.type === type; }); }
  function pay(s, seat, amount) {
    var a = Math.min(amount, s.chips[seat]);
    s.chips[seat] -= a; s.pot += a; s.paid[seat] += a;
    if (s.chips[seat] === 0) s.allIn[seat] = true;
    return a;
  }
  function endHand(s, winner, kind, extra) {
    s.chips[winner] += s.pot;
    s.result = Object.assign({ winner: winner, pot: s.pot, kind: kind }, extra || {});
    s.pot = 0; s.phase = gameWinner(s) !== -1 ? 'over' : 'handEnd';
    return s;
  }
  // The best hand among `seats`; on a tie the seat in `loses` (the one who asked) gives way.
  function showdown(s, seats, asker) {
    var best = null;
    seats.forEach(function (i) {
      if (best === null) { best = i; return; }
      var c = compare(evaluate(s.hands[i]), evaluate(s.hands[best]));
      if (c > 0 || (c === 0 && best === asker)) best = i;
    });
    return best;
  }
  // After a bet: one left wins; if nobody can bet on, the hands are shown.
  function settle(s) {
    var act = active(s);
    if (act.length === 1) return endHand(s, act[0], 'fold');
    var movers = act.filter(function (i) { return !s.allIn[i]; });
    if (movers.length <= 1 && act.some(function (i) { return s.allIn[i]; })) return endHand(s, showdown(s, act, -1), 'showdown', { seats: act });
    s.turn = nextSeat(s, s.turn);
    return s;
  }
  var SAY = { see: 'looks at the cards', blind: 'plays blind', blindRaise: 'raises blind', chaal: 'plays chaal', raise: 'raises', sideshow: 'asks for a side show', show: 'asks for a show', pack: 'packs' };
  function act(st, seat, type) {
    if (!isLegal(st, seat, type)) return st;
    var s = Z.clone(st), c = cost(s, seat, type);
    s.moves++;
    s.say = { seat: seat, type: type, text: SAY[type], amount: 0 };
    if (type === 'see') { s.seen[seat] = true; return s; }
    if (type === 'pack') { s.folded[seat] = true; return settle(s); }
    s.say.amount = pay(s, seat, c);
    if (type === 'blindRaise') s.stake = Math.min(MAX_STAKE, s.stake * 2);
    if (type === 'raise') s.stake = Math.min(MAX_STAKE, s.stake * 2);
    if (type === 'show') {
      var act2 = active(s), w = showdown(s, act2, seat);
      return endHand(s, w, 'show', { seats: act2, asker: seat });
    }
    if (type === 'sideshow') { s.side = { from: seat, to: prevActive(s, seat) }; s.phase = 'side'; return s; }
    return settle(s);
  }
  // The answer to a side show: accepted, the weaker hand packs; refused, play goes on.
  function respondSide(st, seat, accept) {
    if (st.phase !== 'side' || !st.side || st.side.to !== seat) return st;
    var s = Z.clone(st), from = s.side.from, to = s.side.to;
    s.moves++; s.phase = 'bet'; s.side = null;
    if (!accept) { s.say = { seat: seat, type: 'refuse', text: 'refuses the side show', amount: 0 }; s.turn = from; return settle(s); }
    var c = compare(evaluate(s.hands[from]), evaluate(s.hands[to])), loser = c > 0 ? to : from;
    s.folded[loser] = true;
    s.say = { seat: seat, type: 'accept', text: 'accepts: ' + NAMES[loser] + (loser === 0 ? ' pack' : ' packs'), amount: 0, loser: loser };
    s.turn = from;
    return settle(s);
  }
  // You win with TARGET chips or the table out of chips; you lose when you cannot pay the boot.
  var gameWinner = function (st) { return st.chips[0] < BOOT ? 1 : st.chips[0] >= TARGET || [1, 2, 3].every(function (i) { return st.chips[i] < BOOT; }) ? 0 : -1; };

  // ── The computer players ────────────────────────────────────────────────
  // 0..1: how good a hand is.
  function strength(cards) {
    var e = evaluate(cards), cat = e[0];
    if (cat === 5) return 1;
    if (cat === 4) return 0.93 + e[1] / 400;
    if (cat === 3) return 0.8 + e[1] / 300;
    if (cat === 2) return 0.62 + e[1] / 100;
    if (cat === 1) return 0.38 + e[1] / 60;
    return 0.08 + e[1] / 60 + e[2] / 300;
  }
  // Per style: how soon it looks, how much it bluffs, how high a stake it plays, how it raises.
  var PROFILE = {
    careful: { look: 0.55, bluff: 0.02, fold: 0.42, push: 0.08, raise: 0.74, side: 0.5 },
    bold: { look: 0.16, bluff: 0.1, fold: 0.25, push: 0.2, raise: 0.52, side: 0.8 },
    bluffer: { look: 0.3, bluff: 0.28, fold: 0.34, push: 0.14, raise: 0.62, side: 0.4 }
  };
  function aiAct(s, seat, rnd) {
    var p = PROFILE[STYLES[seat]] || PROFILE.careful, acts = actions(s, seat), can = function (t) { return acts.some(function (a) { return a.type === t; }); };
    var str = strength(s.hands[seat]), pressure = Math.log(s.stake / BOOT) / Math.log(2), bluffing = rnd() < p.bluff;
    var afford = s.chips[seat];
    if (!s.seen[seat]) {
      var lookP = p.look * (0.5 + pressure * 0.5);
      if (can('see') && rnd() < lookP) return { type: 'see' };
      if (can('show') && rnd() < 0.3) return { type: 'show' };
      if (can('blindRaise') && rnd() < (0.9 - p.raise) * 0.5) return { type: 'blindRaise' };
      return { type: can('blind') ? 'blind' : 'pack' };
    }
    var eff = bluffing ? Math.max(str, 0.8) : str, need = p.fold + pressure * p.push;
    if (eff < need && !(can('show') && eff > need - 0.12)) return { type: 'pack' };
    if (can('sideshow') && eff > 0.45 && rnd() < p.side * 0.6) return { type: 'sideshow' };
    if (can('raise') && eff > p.raise && rnd() < 0.7) return { type: 'raise' };
    if (can('show') && (eff > 0.55 || bluffing || rnd() < 0.15) && afford > cost(s, seat, 'show')) return { type: 'show' };
    return { type: can('chaal') ? 'chaal' : 'pack' };
  }
  // Accept a side show when the hand is good.
  function aiRespond(s, seat, rnd) {
    var p = PROFILE[STYLES[seat]] || PROFILE.careful, str = strength(s.hands[seat]);
    return str > 0.55 || (str > 0.42 && rnd() < p.side * 0.5) || rnd() < p.bluff;
  }

  // ── Layout ──────────────────────────────────────────────────────────────
  var HAND_STEP = 1.1;
  function geo(m) { return T.geometry(m, 1); }
  // view: { reveal: bool } cards of the players still in are shown at the end of a showdown.
  function place(st, m, view) {
    var g = geo(m), cards = [], slots = [], ended = st.phase === 'handEnd' || st.phase === 'over', shown = ended && st.result && (st.result.kind === 'show' || st.result.kind === 'showdown');
    slots.push({ id: 'pot', x: g.cx - g.cw, y: g.cy - g.ch / 2, w: 2 * g.cw, h: g.ch, quiet: true, label: 'Pot ' + st.pot });
    if (!st.out[0]) {
      var hand = T.handCards(g, st.hands[0], function (id) { return { up: st.seen[0] || shown, label: st.seen[0] || shown ? Z.cardName(id) : 'Hidden card' }; }, null);
      var step = Math.min(g.cw * HAND_STEP, (g.W - 2 * g.pad - g.cw) / Math.max(1, HAND - 1)), x0 = (g.W - (g.cw + (HAND - 1) * step)) / 2;
      hand.cards.forEach(function (c, k) { c.x = Math.round(x0 + k * step); hand.slots[k].x = c.x; if (st.folded[0]) c.dim = true; });
      slots = slots.concat(hand.slots); cards = cards.concat(hand.cards);
    }
    [1, 2, 3].forEach(function (seat) {
      if (st.out[seat]) return;
      var up = shown && st.result.seats && st.result.seats.indexOf(seat) >= 0;
      T.fan(g, seat, st.hands[seat], up).forEach(function (c) { if (st.folded[seat]) c.dim = true; cards.push(c); });
    });
    return { height: m.H, slots: slots, cards: cards };
  }

  var api = {
    NAMES: NAMES, STYLES: STYLES, BOOT: BOOT, START_CHIPS: START_CHIPS, MAX_STAKE: MAX_STAKE, evaluate: evaluate, compare: compare, describe: describe, strength: strength, deal: deal, newGame: newGame,
    nextHand: nextHand, actions: actions, isLegal: isLegal, cost: cost, act: act, respondSide: respondSide, prevActive: prevActive, active: active, gameWinner: gameWinner, aiAct: aiAct, aiRespond: aiRespond,
    geo: geo, place: place
  };
  root.ZimiTeenPatti = api;

  // ── The page ────────────────────────────────────────────────────────────
  var AI_MS = 850, END_MS = 700;
  function boot() {
    var d = root.document, t, board, session, view = { flash: '' };
    var who = function (seat) { return NAMES[seat]; };
    // What each computer player is doing (blind, seen, packed), under its cards.
    var tags = [null, Z.h('div', { class: 'tp-tag' }), Z.h('div', { class: 'tp-tag' }), Z.h('div', { class: 'tp-tag' })];
    [1, 2, 3].forEach(function (seat) { Z.pageEls().table.appendChild(tags[seat]); });
    function paintTags(g, st, over) {
      var sideH = g.ch + (HAND - 1) * T.sideStep(g, HAND);
      [1, 2, 3].forEach(function (seat) {
        var p = T.posOf(seat, SEATS), el = tags[seat];
        el.textContent = who(seat) + '\n' + (st.out[seat] ? 'out' : st.folded[seat] && !over ? 'packed' : st.seen[seat] ? 'seen' : 'blind');
        el.style.left = Math.round(p === 2 ? g.cx : (p === 1 ? g.westX : g.eastX) + g.cw / 2) + 'px';
        el.style.top = Math.round(p === 2 ? g.northY + g.ch + 4 : g.yTop + sideH + 4) + 'px';
      });
    }
    var LABEL = { see: 'See cards', blind: 'Blind', blindRaise: 'Raise blind', chaal: 'Chaal', raise: 'Raise', sideshow: 'Side show', show: 'Show', pack: 'Pack' };
    function sayLine(st) {
      var y = st.say;
      if (!y) return '';
      return who(y.seat) + ' ' + (y.seat === 0 ? youForm(y) : y.text) + (y.amount ? ' (' + y.amount + ')' : '') + '.';
    }
    function youForm(y) { return { see: 'look', blind: 'play blind', blindRaise: 'raise blind', chaal: 'play chaal', raise: 'raise', sideshow: 'ask for a side show', show: 'ask for a show', pack: 'pack', refuse: 'refuse', accept: y.text.replace(/^accepts/, 'accept') }[y.type] || y.text; }
    function resultLines(st) {
      var r = st.result, lines = [];
      if (r.kind === 'fold') lines.push(who(r.winner) + (r.winner === 0 ? ' take' : ' takes') + ' the pot of ' + r.pot + ': everyone else packed.');
      else {
        var list = (r.seats || []).map(function (i) { return who(i) + ': ' + describe(st.hands[i]); });
        lines.push(list.join(', ') + '.');
        lines.push(who(r.winner) + (r.winner === 0 ? ' win' : ' wins') + ' the pot of ' + r.pot + '.');
      }
      lines.push('Chips: ' + [0, 1, 2, 3].map(function (i) { return who(i) + ' ' + st.chips[i]; }).join(', ') + '.');
      return lines;
    }
    function hud(st) {
      var over = st.phase === 'handEnd' || st.phase === 'over';
      paintTags(geo(board.metrics()), st, over);
      var chips = [0, 1, 2, 3].map(function (seat) {
        return { name: who(seat), text: String(st.chips[seat]), turn: !over && st.phase === 'bet' && st.turn === seat || (st.phase === 'side' && st.side.to === seat) };
      });
      var out = { chips: chips, sub: 'Pot ' + st.pot + ' · stake ' + st.stake, text: '' };
      var said = sayLine(st);
      if (st.phase === 'handEnd') { out.text = resultLines(st)[st.result.kind === 'fold' ? 0 : 1]; out.label = 'Next hand'; out.action = startNextHand; return out; }
      if (st.phase === 'over') { out.text = 'Game over'; return out; }
      if (st.phase === 'side') {
        if (st.side.to === 0) {
          out.text = who(st.side.from) + ' asks you for a side show. The weaker hand packs';
          out.choices = [{ label: 'Accept', onclick: function () { respond(true); } }, { label: 'Refuse', onclick: function () { respond(false); } }];
        } else out.text = (said ? said + ' ' : '') + who(st.side.to) + ' is deciding';
        return out;
      }
      if (st.turn === 0) {
        var acts = actions(st, 0);
        out.text = (said ? said + ' ' : '') + (st.seen[0] ? 'Your bet' : 'Play blind, or look at your cards');
        out.choices = acts.map(function (a) {
          return { label: LABEL[a.type] + (a.cost ? ' ' + a.cost : ''), aria: LABEL[a.type] + (a.cost ? ', ' + a.cost + ' chips' : ''), onclick: function () { go(a.type); }, disabled: false };
        });
      } else out.text = (said ? said + ' ' : '') + who(st.turn) + ' is thinking';
      return out;
    }

    function drive() {
      var st = session.state;
      if (st.phase === 'over') { gameOver(); return; }
      if (st.phase === 'handEnd') { session.later(handOver, END_MS); return; }
      if (st.phase === 'side') { if (st.side.to !== 0) session.later(aiRespondTurn, AI_MS); return; }
      if (st.turn !== 0) session.later(aiTurn, AI_MS);
    }
    function aiTurn() {
      var st = session.state;
      if (st.phase !== 'bet' || st.turn === 0) return;
      var seat = st.turn, a = aiAct(st, seat, Math.random);
      session.follow(act(st, seat, a.type));
      announce(a.type);
      drive();
    }
    function aiRespondTurn() {
      var st = session.state;
      if (st.phase !== 'side' || st.side.to === 0) return;
      session.follow(respondSide(st, st.side.to, aiRespond(st, st.side.to, Math.random)));
      drive();
    }
    function announce(type) { if (session.state.say && type !== 'see') t.flash(sayLine(session.state)); }
    function go(type) {
      var st = session.state;
      if (st.phase !== 'bet' || st.turn !== 0 || !isLegal(st, 0, type)) return;
      var next = act(st, 0, type);
      if (type === 'see') session.follow(next); else session.commit(next);
      drive();
    }
    function respond(accept) {
      var st = session.state;
      if (st.phase !== 'side' || st.side.to !== 0) return;
      session.commit(respondSide(st, 0, accept));
      drive();
    }
    function handOver() {
      var st = session.state;
      if (st.phase !== 'handEnd') return;
      T.lineSheet('Hand ' + (st.round + 1), resultLines(st), [{ label: 'Next hand', primary: true, onclick: startNextHand }]);
    }
    function gameOver() {
      var st = session.state, won = gameWinner(st) === 0, lines = (st.result ? resultLines(st) : []).concat([won ? 'The table is yours: ' + st.chips[0] + ' chips.' : 'You are out of chips.']);
      session.stats.scored(st.chips[0]);
      if (won) session.win(st.chips[0]); else session.lose('Out of chips', lines, st.chips[0]);
    }
    var order = function () { return Z.shuffled(Math.random); };
    function startNextHand() {
      var st = session.state;
      if (st.phase !== 'handEnd') return;
      session.stats.scored(Math.max(st.chips[0], 0));
      session.history = [];
      session.follow(nextHand(st, order()));
      drive();
    }
    function startGame() {
      view.flash = '';
      session.reset(newGame(order(), Math.floor(Math.random() * SEATS)));
      drive();
    }
    t = T.create({
      id: 'teenpatti', name: 'Teen Patti', view: view, geo: geo, place: place, hud: hud, newGame: startGame, tap: function () { return false; }, cols: 6, heightShare: 0.13,
      canPick: function () { return false; },
      stat: function (sec, st) { return Z.fmtTime(sec) + ' · ' + st.chips[0]; },
      cascadeOrder: function (st) { return st.hands[0].map(function (id) { return { id: id }; }); },
      winLines: function (sec, st) { return ['You have all the chips: ' + st.chips[0] + '.']; },
      rules: 'Everyone puts in a boot of 10 and gets three cards face down. Play blind (without looking) or look and play seen. The stake starts at 10: a blind player pays the stake (or double to raise it); a seen player pays double (or four times to raise, which doubles the stake). Pack folds. A seen player may ask the seen player before him for a side show: the weaker hand packs (a tie packs the asker). With two players left, Show turns the hands over: the higher wins (a tie goes to the one who did not ask). Hands, best first: trail (three of a kind), pure sequence (straight flush), sequence (straight), colour (flush), pair, high card. A-2-3 is the highest sequence, then A-K-Q down to 4-3-2. Asha plays carefully, Dev boldly and Rani bluffs. If you run short you go all in and the hands are shown. Reach 1500 chips to win, or outlast the others; you lose when you cannot pay the boot.'
    });
    board = t.board; session = t.session;
    api.session = session; api.board = board;
    startGame();
  }

  if (root.document && root.document.getElementById('zc-table')) boot();
})(typeof globalThis !== 'undefined' ? globalThis : window);
