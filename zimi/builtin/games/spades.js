/* ZimiGames: Spades. You (south) and North against West and East. Spades
   are always trump. Each player bids how many tricks they will take (0 is
   Nil: a bet to take none). A partnership's bids add up to its contract:
   make it and you score 10 a trick plus 1 for each extra trick (a bag); miss
   it and you lose 10 a trick. A made Nil is +100, a broken one -100. Ten
   bags cost 100. Spades cannot be led until one has been played, unless the
   hand is all spades. First to 500 wins; a team at -200 loses.

   Rules for a nil bidder's tricks: they never help the partner's contract
   and count as bags. State: hands[4], bids[4] (null until bid), dealer, turn,
   leader, trick [{seat, id}], tricks[4] (won this hand), broken, played
   (ids of finished tricks), scores[2], bags[2], handNo, phase ('bid' | 'play'
   | 'handEnd' | 'over'), result (set when a hand ends). Seats run clockwise:
   0 you, 1 west, 2 north, 3 east; seats 0 and 2 are a team. Pure functions;
   the page wiring at the bottom only runs in a browser. */
(function (root) {
  'use strict';
  var Z = root.ZimiCards, T = root.ZimiTable, Seats = root.ZimiSeats, TX = Z.T;

  var SEATS = 4, HAND = 13, NAMES = [TX('cards.you'), TX('cards.seat.west'), TX('cards.seat.north'), TX('cards.seat.east')], TEAMS = [TX('cards.team.us'), TX('cards.team.them')];
  var END_SCORE = 500, LOSE_SCORE = -200, BAG_LIMIT = 10, BAG_PENALTY = 100, NIL_BONUS = 100, TRICK_POINTS = 10, SPADES = 3;
  var high = T.rankHigh, team = function (seat) { return seat % 2; }, partnerOf = function (seat) { return (seat + 2) % SEATS; };
  var isSpade = function (id) { return Z.suit(id) === SPADES; };
  var bidName = function (b) { return b === null || b === undefined ? '...' : b === 0 ? 'Nil' : String(b); };

  // ── Rules ───────────────────────────────────────────────────────────────
  function dealHand(order, handNo, scores, bags, dealer) {
    var hands = [], s;
    for (s = 0; s < SEATS; s++) hands.push(T.sortHand(order.slice(s * HAND, (s + 1) * HAND), high));
    return {
      hands: hands, bids: [null, null, null, null], dealer: dealer, turn: (dealer + 1) % SEATS, leader: (dealer + 1) % SEATS, trick: [],
      tricks: [0, 0, 0, 0], broken: false, played: [], scores: scores.slice(), bags: bags.slice(), handNo: handNo, phase: 'bid', result: null, moves: 0
    };
  }
  function freshGame(order, dealer) { return dealHand(order, 0, [0, 0], [0, 0], dealer === undefined ? 3 : dealer); }
  function nextHand(st, order) { return dealHand(order, st.handNo + 1, st.scores, st.bags, (st.dealer + 1) % SEATS); }

  function placeBid(st, seat, n) {
    var s = Z.clone(st);
    s.bids[seat] = n; s.moves++;
    if (s.bids.every(function (b) { return b !== null; })) { s.phase = 'play'; s.turn = s.leader = (s.dealer + 1) % SEATS; } else s.turn = (seat + 1) % SEATS;
    return s;
  }

  function legalPlays(st, seat) {
    var hand = st.hands[seat], trick = st.trick;
    if (!trick.length) {
      if (st.broken) return hand.slice();
      var safe = hand.filter(function (c) { return !isSpade(c); });
      return safe.length ? safe : hand.slice();
    }
    var lead = Z.suit(trick[0].id), follow = hand.filter(function (c) { return Z.suit(c) === lead; });
    return follow.length ? follow : hand.slice();
  }
  function whyNot(st, seat) {
    if (!st.trick.length) return TX('spades.notBroken');
    return TX('cards.follow', { suit: TX('cards.suit.' + Z.SUITS[Z.suit(st.trick[0].id)]) });
  }
  function isLegal(st, seat, id) { return st.phase === 'play' && st.trick.length < SEATS && st.turn === seat && legalPlays(st, seat).indexOf(id) >= 0; }

  function playCard(st, seat, id) {
    var s = Z.clone(st);
    s.hands[seat].splice(s.hands[seat].indexOf(id), 1);
    s.trick.push({ seat: seat, id: id });
    if (isSpade(id)) s.broken = true;
    s.moves++;
    if (s.trick.length < SEATS) s.turn = (seat + 1) % SEATS;
    return s;
  }
  // Does `a` beat `b` in a trick that was led in `lead`?
  function beats(a, b, lead) {
    var sa = Z.suit(a), sb = Z.suit(b);
    if (sa === sb) return high(a) > high(b);
    return sa === SPADES || (sb !== SPADES && sa === lead && sb !== lead);
  }
  function trickWinner(trick) {
    var lead = Z.suit(trick[0].id), best = trick[0];
    trick.forEach(function (t) { if (beats(t.id, best.id, lead)) best = t; });
    return best.seat;
  }

  // A team's hand score. bids and tricks are for its two seats; bagsIn the
  // bags it carried in. Returns { points, bags (carried out), made, bagsMade, nil: [+/-] }.
  function scoreTeam(bids, tricks, bagsIn) {
    var pts = 0, bagsNow = 0, contract = 0, got = 0, nil = [], i;
    for (i = 0; i < 2; i++) {
      if (bids[i] === 0) { nil.push(tricks[i] === 0 ? NIL_BONUS : -NIL_BONUS); pts += nil[nil.length - 1]; bagsNow += tricks[i]; }
      else { contract += bids[i]; got += tricks[i]; }
    }
    var made = contract === 0 ? null : got >= contract;
    if (made === true) { pts += TRICK_POINTS * contract; bagsNow += got - contract; } else if (made === false) pts -= TRICK_POINTS * contract;
    pts += bagsNow;
    var bags = bagsIn + bagsNow, penalty = 0;
    while (bags >= BAG_LIMIT) { bags -= BAG_LIMIT; penalty += BAG_PENALTY; }
    return { points: pts - penalty, bags: bags, made: made, contract: contract, tricks: got, nil: nil, bagsGained: bagsNow, penalty: penalty };
  }

  function resolveTrick(st) {
    var s = Z.clone(st), w = trickWinner(s.trick);
    s.tricks[w]++;
    s.played = s.played.concat(s.trick.map(function (t) { return t.id; }));
    s.trick = []; s.leader = s.turn = w;
    if (s.played.length === SEATS * HAND) endHand(s);
    return s;
  }
  function endHand(s) {
    var r = [0, 1].map(function (t) { return scoreTeam([s.bids[t], s.bids[t + 2]], [s.tricks[t], s.tricks[t + 2]], s.bags[t]); });
    s.result = r;
    s.scores = [s.scores[0] + r[0].points, s.scores[1] + r[1].points];
    s.bags = [r[0].bags, r[1].bags];
    s.phase = gameWinner(s.scores) >= 0 ? 'over' : 'handEnd';
  }
  // The winning team once the game is decided, else -1.
  function gameWinner(scores) {
    var lose = scores.findIndex(function (v) { return v <= LOSE_SCORE; });
    if (lose >= 0) return 1 - lose;
    var top = scores.map(function (v) { return v >= END_SCORE; });
    if (top[0] && top[1]) return scores[0] === scores[1] ? -1 : scores[0] > scores[1] ? 0 : 1;
    return top[0] ? 0 : top[1] ? 1 : -1;
  }
  var teamTricks = function (st, t) { return st.tricks[t] + st.tricks[t + 2]; };
  var teamContract = function (st, t) { return [t, t + 2].reduce(function (n, s) { return n + (st.bids[s] > 0 ? st.bids[s] : 0); }, 0); };

  // ── The computer players ────────────────────────────────────────────────
  var suitCards = function (hand, suit) { return hand.filter(function (c) { return Z.suit(c) === suit; }); };
  // About how many tricks a hand takes with spades as trump.
  function estimate(hand) {
    var sp = suitCards(hand, SPADES), n = sp.length, t = 0, suit;
    sp.forEach(function (c) { var r = high(c); if (r === 14) t += 1; else if (r === 13) t += n >= 2 ? 0.9 : 0.4; else if (r === 12) t += n >= 3 ? 0.55 : 0.1; });
    t += Math.max(0, n - 3) * 0.6;
    for (suit = 0; suit < 4; suit++) {
      if (suit === SPADES) continue;
      var cs = suitCards(hand, suit), len = cs.length;
      cs.forEach(function (c) { var r = high(c); if (r === 14) t += 0.95; else if (r === 13) t += len >= 2 ? 0.65 : 0.25; else if (r === 12) t += len >= 3 ? 0.25 : 0; });
      if (n >= 3) { if (len === 0) t += 1.1; else if (len === 1) t += 0.45; }
    }
    return t;
  }
  function nilWorthy(hand) {
    var sp = suitCards(hand, SPADES), top = Math.max.apply(null, hand.map(high)), spadeTop = sp.length ? Math.max.apply(null, sp.map(high)) : 0;
    var aces = T.countBy(hand, function (c) { return high(c) === 14; }), kings = T.countBy(hand, function (c) { return high(c) === 13; });
    return estimate(hand) < 1.6 && spadeTop <= 8 && sp.length <= 3 && aces === 0 && kings <= 1 && top <= 13;
  }
  function aiBid(st, seat) {
    var hand = st.hands[seat], t = estimate(hand), bid = Math.max(1, Math.round(t));
    if (nilWorthy(hand) && st.bids[partnerOf(seat)] !== 0) return 0;
    // Keep the table's total from running past the 13 tricks there are.
    var others = st.bids.reduce(function (n, b, s) { return n + (s !== seat && b > 0 ? b : 0); }, 0);
    if (bid + others > 14) bid = Math.max(1, 14 - others);
    return Math.min(bid, HAND);
  }

  function aiPick(st, seat) {
    var legal = legalPlays(st, seat);
    if (legal.length === 1) return legal[0];
    var hand = st.hands[seat], trick = st.trick, me = team(seat), partner = partnerOf(seat);
    var lowest = T.minBy(legal, high), highest = T.maxBy(legal, high);
    var played = st.played.concat(trick.map(function (t) { return t.id; }));
    var lead = trick.length ? Z.suit(trick[0].id) : -1;
    var winning = trick.length ? trick.reduce(function (b, t) { return beats(t.id, b.id, lead) ? t : b; }, trick[0]) : null;
    var winners = winning ? legal.filter(function (c) { return beats(c, winning.id, lead); }) : [];
    var cheapestWinner = winners.length ? T.minBy(winners, function (c) { return (isSpade(c) ? 100 : 0) + high(c); }) : null;
    var iNil = st.bids[seat] === 0, partnerNil = st.bids[partner] === 0 && st.tricks[partner] === 0;
    var needs = teamContract(st, me) - teamTricks(st, me) > 0;

    // Your own Nil: stay under everything.
    if (iNil && st.tricks[seat] === 0) {
      if (!winning) return T.minBy(legal, function (c) { return high(c) + (isSpade(c) ? 20 : 0); });
      var safe = legal.filter(function (c) { return winners.indexOf(c) < 0; });
      return safe.length ? T.maxBy(safe, function (c) { return high(c) - (isSpade(c) ? 20 : 0); }) : lowest;
    }
    // Partner's Nil: take the trick so they do not have to.
    if (partnerNil) {
      if (!winning) { var aces = legal.filter(function (c) { return high(c) === 14 && !isSpade(c); }); return aces.length ? aces[0] : highest; }
      return cheapestWinner !== null ? cheapestWinner : lowest;
    }
    var oppNil = [(seat + 1) % SEATS, (seat + 3) % SEATS].some(function (s) { return st.bids[s] === 0 && st.tricks[s] === 0; });

    if (!winning) {
      // Leading: a sure winner first, else a low card from a short side suit.
      var offs = legal.filter(function (c) { return !isSpade(c); });
      var sure = offs.filter(function (c) {
        if (high(c) === 14) return true;
        var above = [];
        for (var r = high(c) + 1; r <= 14; r++) above.push(Z.make(r === 14 ? 1 : r, Z.suit(c)));
        return above.every(function (a) { return played.indexOf(a) >= 0; });
      });
      if (sure.length && (needs || !oppNil)) return T.maxBy(sure, high);
      if (offs.length) return T.minBy(offs, function (c) { return suitCards(hand, Z.suit(c)).length * 3 + high(c) * (oppNil ? -1 : 1); });
      var sp = legal.filter(isSpade), topSpade = T.maxBy(sp, high);
      return needs && high(topSpade) >= 13 ? topSpade : T.minBy(sp, high);
    }
    var partnerWinning = winning.seat === partner;
    var following = legal.some(function (c) { return Z.suit(c) === lead; });
    if (partnerWinning && !oppNil) return T.minBy(legal, function (c) { return (isSpade(c) ? 50 : 0) + high(c); });
    if (needs || oppNil) {
      if (cheapestWinner !== null) return cheapestWinner;
    } else if (cheapestWinner !== null && trick.length === SEATS - 1 && !following) {
      return cheapestWinner;
    }
    // Ducking, or void with nothing to win: shed the weakest card of the longest side suit.
    if (!following) {
      var off = legal.filter(function (c) { return !isSpade(c); });
      if (off.length) return T.minBy(off, function (c) { return high(c) - suitCards(hand, Z.suit(c)).length * 0.5; });
    }
    return T.minBy(legal, function (c) { return (isSpade(c) ? 50 : 0) + high(c); });
  }

  // ── Layout ──────────────────────────────────────────────────────────────
  function geo(m, st) { return T.geometry(m, T.rowsFor(m, st.hands[0].length)); }
  function place(st, m, view) {
    var g = geo(m, st), slots = [], cards = [], V = (view && view.viewer) || 0, up = !(view && view.hideHand), rel = function (seat) { return (seat - V + SEATS) % SEATS; };
    var myTurn = st.phase === 'play' && st.turn === V && st.trick.length < SEATS;
    var sweep = view && st.trick.length === SEATS ? view.sweep : null;
    slots.push({ id: 'deck', x: g.cx - g.cw / 2, y: g.cy - g.ch / 2, w: g.cw, h: g.ch, quiet: true, label: TX('cards.slot.table') });
    slots.push({ id: 'trick', x: g.cx - 1.6 * g.cw, y: g.cy - 1.1 * g.ch, w: 3.2 * g.cw, h: 2.2 * g.ch, quiet: true, label: TX('cards.slot.trick') });
    var hand = T.handCards(g, st.hands[V], function (id) { return { up: up, dim: up && myTurn && !isLegal(st, V, id) }; }, function (a, b) { return Z.suit(a) !== Z.suit(b); });
    slots = slots.concat(hand.slots); cards = cards.concat(hand.cards);
    [1, 2, 3].forEach(function (pos) { cards = cards.concat(T.fan(g, pos, st.hands[(V + pos) % SEATS], false)); });
    st.trick.forEach(function (t, k) {
      var spot = sweep !== null && sweep !== undefined ? T.seatSpot(g, rel(sweep)) : T.trickSpot(g, rel(t.seat));
      cards.push({ id: t.id, pile: 'trick', idx: k, x: Math.round(spot.x), y: Math.round(spot.y), up: true });
    });
    return { height: m.H, slots: slots, cards: cards };
  }

  var api = {
    NAMES: NAMES, END_SCORE: END_SCORE, LOSE_SCORE: LOSE_SCORE, BAG_LIMIT: BAG_LIMIT,
    dealHand: dealHand, newGame: freshGame, nextHand: nextHand, placeBid: placeBid, legalPlays: legalPlays, whyNot: whyNot, isLegal: isLegal,
    playCard: playCard, trickWinner: trickWinner, resolveTrick: resolveTrick, scoreTeam: scoreTeam, gameWinner: gameWinner,
    estimate: estimate, aiBid: aiBid, aiPick: aiPick, geo: geo, place: place
  };
  root.ZimiSpades = api;

  // ── The page ────────────────────────────────────────────────────────────
  var AI_MS = 560, HOLD_MS = 1000, SWEEP_MS = 380, MAX_BID = 13;
  function boot() {
    var d = root.document, t, board, session, view;
    var seats = Seats.create({ id: 'spades', seats: SEATS, onChange: function () { if (t) t.paint(); if (board) board.refresh(); } });
    var viewTeam = function () { return team(seats.view()); };
    var teamLabel = function (k) { return k === viewTeam() ? TX('cards.team.us') : TX('cards.team.them'); };
    var teamNames = function (k) { return TX('cards.pair', { a: seats.name(k), b: seats.name(k + 2) }); };
    function syncView(st) { view.viewer = seats.view(); view.hideHand = seats.hotseat() && st.turn !== view.viewer; }
    function repaint() { board.refresh(); t.paint(); }
    function handLine(st, k) {
      var r = st.result[k], c = r.contract;
      var parts = [c ? TX('spades.line.bid', { team: teamLabel(k), bid: c, tricks: r.tricks }) : TX('spades.line.none', { team: teamLabel(k) })];
      if (r.nil.length) parts.push(r.nil.map(function (v) { return TX(v > 0 ? 'spades.nilMade' : 'spades.nilBroken'); }).join(', '));
      parts.push(TX(r.penalty ? 'spades.points.penalty' : r.bagsGained ? 'spades.points.bags' : 'spades.points', { points: (r.points >= 0 ? '+' : '') + r.points, gained: r.bagsGained ? Z.plural(r.bagsGained, 'bag') : '', penalty: r.penalty, total: st.scores[k], bags: st.bags[k] }));
      return parts.join(' · ');
    }
    function hud(st) {
      var chips = [0, 1, 2, 3].map(function (i) { return (seats.view() + i) % SEATS; }).map(function (seat) {
        var name = seats.name(seat), bid = st.bids[seat], text = st.phase === 'bid' ? (bid === null ? '' : TX('spades.chip.bid', { bid: bidName(bid) })) : st.tricks[seat] + '/' + bidName(bid);
        return { name: name, text: text, dealer: seat === st.dealer, turn: (st.phase === 'play' || st.phase === 'bid') && st.turn === seat && st.trick.length < SEATS };
      });
      var V = seats.view(), out = { chips: chips, fact: TX('cards.fact.hand', { n: st.handNo + 1 }), text: '' };
      if (st.phase === 'bid') {
        if (seats.person(st.turn) && st.turn !== V) out.text = TX('cards.bidding', { name: seats.name(st.turn) });
        else if (seats.person(st.turn)) {
          out.text = seats.hotseat() ? TX('spades.yourBid.name', { name: seats.name(V) }) : TX('spades.yourBid');
          out.choices = [{ label: TX('spades.nil'), onclick: function () { bid(0); }, aria: TX('spades.bidNil') }];
          for (var n = 1; n <= MAX_BID; n++) out.choices.push(bidChoice(n));
          out.lines = [{ text: TX('spades.estimate', { n: Math.round(estimate(st.hands[V])) }) + (st.bids[partnerOf(V)] !== null ? ' ' + TX('spades.partnerBid', { name: seats.name(partnerOf(V)), bid: bidName(st.bids[partnerOf(V)]) }) : '') }];
        } else out.text = TX('cards.bidding', { name: seats.name(st.turn) });
      } else if (st.phase === 'handEnd') { out.text = TX('cards.handEnd'); out.label = TX('cards.nextHand'); out.action = startNextHand; }
      else if (st.phase === 'over') { out.text = TX('shell.end.over'); out.label = TX('shell.menu.new'); out.action = newGame; }
      else if (st.trick.length === SEATS) { var w = trickWinner(st.trick); out.text = seats.isYou(w) ? TX('cards.trick.you') : TX('cards.trick.name', { name: seats.name(w) }); }
      else out.text = !seats.person(st.turn) ? TX('cards.thinking', { name: seats.name(st.turn) }) : seats.isYou(st.turn) ? TX('cards.turn.you') : TX('cards.turn.name', { name: seats.name(st.turn) });
      return out;
    }
    function bidChoice(n) { return { label: String(n), onclick: function () { bid(n); } }; }

    function drive() {
      var st = session.state;
      if (st.phase === 'bid') { if (seats.person(st.turn)) seats.ensure(st.turn, repaint); else session.later(aiBidTurn, AI_MS); return; }
      if (st.phase !== 'play') return;
      if (st.trick.length === SEATS) { session.later(sweepTrick, HOLD_MS); return; }
      if (seats.person(st.turn)) seats.ensure(st.turn, repaint); else session.later(aiTurn, AI_MS);
    }
    function aiBidTurn() {
      var st = session.state;
      if (st.phase !== 'bid' || seats.person(st.turn)) return;
      session.follow(placeBid(st, st.turn, aiBid(st, st.turn)));
      drive();
    }
    function aiTurn() {
      var st = session.state;
      if (st.phase !== 'play' || seats.person(st.turn) || st.trick.length === SEATS) return;
      session.follow(playCard(st, st.turn, aiPick(st, st.turn)));
      drive();
    }
    function sweepTrick() {
      view.sweep = trickWinner(session.state.trick);
      board.refresh();
      session.later(function () {
        view.sweep = null;
        session.follow(resolveTrick(session.state));
        var st = session.state;
        if (st.phase === 'handEnd') handOver(); else if (st.phase === 'over') gameOver(); else drive();
      }, SWEEP_MS);
    }
    function handOver() {
      var st = session.state;
      T.lineSheet(TX('cards.fact.hand', { n: st.handNo + 1 }), [handLine(st, viewTeam()), handLine(st, 1 - viewTeam())], [{ label: TX('cards.nextHand'), primary: true, onclick: startNextHand }]);
    }
    function gameOver() {
      var st = session.state, w = gameWinner(st.scores), vt = viewTeam(), hot = seats.hotseat();
      var lines = [handLine(st, vt), handLine(st, 1 - vt), TX(hot ? 'cards.result.hot' : w === vt ? 'cards.result.you' : 'cards.result.them', { team: hot ? teamNames(w) : '', a: st.scores[w], b: st.scores[1 - w] })];
      if (hot) session.lose({ name: teamNames(w), team: true }, lines);
      else if (w === vt) session.win(st.scores[vt]); else session.lose('', lines, st.scores[vt]);
    }
    function startNextHand() {
      var st = session.state;
      if (st.phase !== 'handEnd') return;
      session.history = [];
      session.follow(nextHand(st, Z.shuffled(Math.random)));
      deal();
    }
    function bid(n) {
      var st = session.state;
      if (st.phase !== 'bid' || st.turn !== seats.view()) return;
      session.commit(placeBid(st, st.turn, n));
      drive();
    }
    function play(id) {
      var st = session.state;
      if (!isLegal(st, seats.view(), id)) return false;
      session.commit(playCard(st, seats.view(), id));
      drive();
      return true;
    }
    var idOf = function (pile) { return parseInt(pile.slice(1), 10); };
    function tap(pile) {
      var st = session.state, id = idOf(pile);
      if (pile.charAt(0) !== 'h' || isNaN(id) || st.phase !== 'play') return false;
      if (st.turn !== seats.view() || st.trick.length === SEATS) { t.flash(st.trick.length === SEATS ? TX('cards.wait.trick') : TX('cards.wait.turn')); return false; }
      if (!isLegal(st, st.turn, id)) { t.flash(whyNot(st, st.turn, id)); return false; }
      return play(id);
    }
    function newGame() {
      view.sweep = null; view.flash = '';
      session.reset(freshGame(Z.shuffled(Math.random), Math.floor(Math.random() * SEATS)));
      deal();
    }
    // A fresh deal: nobody has seen it, so a table of people starts at a handoff.
    function deal() { seats.begin(function () { repaint(); drive(); }, session.state.turn); }

    view = { sweep: null, flash: '' };
    t = T.create({
      id: 'spades', name: 'Spades', liftPlay: function (st) { return st.phase === 'play'; }, seats: seats, view: view, geo: geo, place: function (st, m, v) { syncView(st); return place(st, m, v); }, hud: hud, newGame: newGame, tap: tap, cols: 7, heightShare: 0.11,
      canPick: function (st, pile) { return st.phase === 'play' && pile.charAt(0) === 'h' && isLegal(st, seats.view(), idOf(pile)); },
      move: function (pile, idx, to) { return (to === 'trick' || to === 'deck') && pile.charAt(0) === 'h' ? play(idOf(pile)) : false; },
      stat: function (sec, st) { return Z.fmtTime(sec) + ' · ' + st.scores[viewTeam()] + '-' + st.scores[1 - viewTeam()]; },
      cascadeOrder: function (st) { return st.played.concat(st.trick.map(function (x) { return x.id; })).map(function (id) { return { id: id }; }); },
      winLines: function (sec, st) { var vt = viewTeam(); return [handLine(st, vt), handLine(st, 1 - vt), TX('spades.result.won', { a: st.scores[vt], b: st.scores[1 - vt], hands: Z.plural(st.handNo + 1, 'hand') })]; },
      rules: TX('spades.rules')
    });
    board = t.board; session = t.session;
    api.session = session; api.board = board;
    newGame();
  }

  if (root.document && root.document.getElementById('zc-table')) boot();
})(typeof globalThis !== 'undefined' ? globalThis : window);
