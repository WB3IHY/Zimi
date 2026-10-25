/* ZimiGames: Hearts. You (south) against three computer players: west,
   north and east. Each hand: pass three cards (left, right, across, then
   none), the holder of the 2 of clubs leads, follow suit if you can, hearts
   cannot lead until one has been played, no points on the first trick. Each
   heart costs 1 and the queen of spades 13; take all 26 and you shoot the
   moon: you score 0 and the others 26. The game ends when someone reaches
   100, and the lowest score wins.

   State: hands[4], taken[4] (cards won this hand), trick [{seat, id}], leader,
   turn, phase ('pass' | 'play' | 'handEnd' | 'over'), passDir, handNo,
   scores[4], handPoints[4] (set when a hand ends), broken, tricksPlayed,
   received (cards just passed to you). Seats run clockwise: 0 you, 1 west,
   2 north, 3 east. Rules and the computer players are pure functions; the
   page wiring at the bottom only runs in a browser. */
(function (root) {
  'use strict';
  var Z = root.ZimiCards;

  var SEATS = 4, HAND = 13, NAMES = ['You', 'West', 'North', 'East'], END_SCORE = 100, MOON = 26, PASS_COUNT = 3;
  var PASS_NAMES = ['to the left', 'to the right', 'across', 'none'];
  var PASS_SHORT = ['pass left', 'pass right', 'pass across', 'hold'];
  var PASS_OFFSET = [1, 3, 2, 0]; // seats clockwise; left is the next player to act
  var CLUBS = 0, DIAMONDS = 1, HEARTS = 2, SPADES = 3;
  var TWO_CLUBS = Z.make(2, CLUBS), QUEEN_SPADES = Z.make(12, SPADES), KING_SPADES = Z.make(Z.KING, SPADES), ACE_SPADES = Z.make(1, SPADES);
  var SUIT_ORDER = [CLUBS, DIAMONDS, SPADES, HEARTS]; // alternating colours in a hand

  // Ace high in Hearts.
  var high = function (id) { return Z.rank(id) === 1 ? 14 : Z.rank(id); };
  var isHeart = function (id) { return Z.suit(id) === HEARTS; };
  function points(id) { return isHeart(id) ? 1 : id === QUEEN_SPADES ? 13 : 0; }
  function sortHand(ids) {
    return ids.slice().sort(function (a, b) { return SUIT_ORDER.indexOf(Z.suit(a)) - SUIT_ORDER.indexOf(Z.suit(b)) || high(a) - high(b); });
  }
  var sum = function (ids) { return ids.reduce(function (n, id) { return n + points(id); }, 0); };
  var next = function (seat) { return (seat + 1) % SEATS; };

  // ── Rules ───────────────────────────────────────────────────────────────
  function holderOf(hands, id) { for (var s = 0; s < SEATS; s++) if (hands[s].indexOf(id) >= 0) return s; return 0; }

  // A new hand from a shuffled 52. Hand 0 passes left, then right, across, none.
  function dealHand(order, handNo, scores) {
    var hands = [], s;
    for (s = 0; s < SEATS; s++) hands.push(sortHand(order.slice(s * HAND, (s + 1) * HAND)));
    var passDir = handNo % 4, st = {
      hands: hands, taken: [[], [], [], []], trick: [], leader: 0, turn: 0, phase: passDir === 3 ? 'play' : 'pass',
      passDir: passDir, handNo: handNo, scores: scores.slice(), handPoints: [0, 0, 0, 0], broken: false, tricksPlayed: 0, received: [], moves: 0
    };
    if (st.phase === 'play') st.leader = st.turn = holderOf(hands, TWO_CLUBS);
    return st;
  }
  function freshGame(order) { return dealHand(order, 0, [0, 0, 0, 0]); }
  function nextHand(state, order) { return dealHand(order, state.handNo + 1, state.scores); }

  // The cards a seat may play now.
  function legalPlays(state, seat) {
    var hand = state.hands[seat], trick = state.trick, first = state.tricksPlayed === 0;
    if (!trick.length) {
      if (first) return hand.indexOf(TWO_CLUBS) >= 0 ? [TWO_CLUBS] : hand.slice();
      if (state.broken) return hand.slice();
      var safe = hand.filter(function (c) { return !isHeart(c); });
      return safe.length ? safe : hand.slice();
    }
    var lead = Z.suit(trick[0].id), follow = hand.filter(function (c) { return Z.suit(c) === lead; });
    if (follow.length) return follow;
    if (first) { var clean = hand.filter(function (c) { return !points(c); }); return clean.length ? clean : hand.slice(); }
    return hand.slice();
  }
  // Why a card is refused, in words.
  function whyNot(state, seat, id) {
    var hand = state.hands[seat], trick = state.trick;
    if (!trick.length) {
      if (state.tricksPlayed === 0) return 'The 2 of clubs leads';
      return 'Hearts have not been broken';
    }
    var lead = Z.suit(trick[0].id);
    if (hand.some(function (c) { return Z.suit(c) === lead; })) return 'Follow ' + Z.SUITS[lead];
    return 'No points on the first trick';
  }
  function isLegal(state, seat, id) { return state.phase === 'play' && state.trick.length < SEATS && state.turn === seat && legalPlays(state, seat).indexOf(id) >= 0; }

  function playCard(state, seat, id) {
    var s = Z.clone(state);
    s.hands[seat].splice(s.hands[seat].indexOf(id), 1);
    s.trick.push({ seat: seat, id: id });
    if (isHeart(id)) s.broken = true;
    if (seat === 0) s.received = [];
    s.moves++;
    if (s.trick.length < SEATS) s.turn = next(seat);
    return s;
  }
  // Highest card of the suit led takes the trick.
  function trickWinner(trick) {
    var lead = Z.suit(trick[0].id), best = trick[0];
    trick.forEach(function (t) { if (Z.suit(t.id) === lead && high(t.id) > high(best.id)) best = t; });
    return best.seat;
  }
  function trickPoints(trick) { return sum(trick.map(function (t) { return t.id; })); }

  // The finished trick goes to its winner, who leads next; the last one ends the hand.
  function resolveTrick(state) {
    var s = Z.clone(state), w = trickWinner(s.trick);
    s.taken[w] = s.taken[w].concat(s.trick.map(function (t) { return t.id; }));
    s.trick = []; s.leader = s.turn = w; s.tricksPlayed++;
    if (s.tricksPlayed === HAND) endHand(s);
    return s;
  }
  function endHand(s) {
    var pts = s.taken.map(sum), moon = pts.indexOf(MOON);
    s.moon = moon;
    s.handPoints = moon >= 0 ? pts.map(function (p, seat) { return seat === moon ? 0 : MOON; }) : pts;
    s.scores = s.scores.map(function (v, seat) { return v + s.handPoints[seat]; });
    s.phase = Math.max.apply(null, s.scores) >= END_SCORE ? 'over' : 'handEnd';
  }
  function winners(scores) { var low = Math.min.apply(null, scores); return scores.map(function (v, i) { return v === low ? i : -1; }).filter(function (i) { return i >= 0; }); }
  function humanWon(state) { return state.phase === 'over' && winners(state.scores).indexOf(0) >= 0; }
  // Points taken so far this hand, for the table.
  function liveSoFar(state, seat) { return sum(state.taken[seat]); }

  // Everyone hands over three cards at once. picks[seat] is that seat's three.
  function applyPass(state, picks) {
    var s = Z.clone(state), off = PASS_OFFSET[s.passDir], seat;
    for (seat = 0; seat < SEATS; seat++) s.hands[seat] = s.hands[seat].filter(function (c) { return picks[seat].indexOf(c) < 0; });
    for (seat = 0; seat < SEATS; seat++) s.hands[(seat + off) % SEATS] = s.hands[(seat + off) % SEATS].concat(picks[seat]);
    s.received = picks[(SEATS - off) % SEATS].slice();
    for (seat = 0; seat < SEATS; seat++) s.hands[seat] = sortHand(s.hands[seat]);
    s.phase = 'play'; s.leader = s.turn = holderOf(s.hands, TWO_CLUBS); s.moves++;
    return s;
  }

  // ── The computer players ────────────────────────────────────────────────
  var count = function (hand, suit) { return hand.filter(function (c) { return Z.suit(c) === suit; }).length; };
  var maxBy = function (list, f) { return list.reduce(function (b, c) { return b === null || f(c) > f(b) ? c : b; }, null); };
  var minBy = function (list, f) { return maxBy(list, function (c) { return -f(c); }); };

  // How badly a card wants to leave the hand in a pass.
  function passWeight(hand, id) {
    var suit = Z.suit(id), r = high(id), spades = count(hand, SPADES), short = count(hand, suit) <= 2;
    if (id === QUEEN_SPADES) return spades <= 4 ? 100 : 35;
    if (id === KING_SPADES || id === ACE_SPADES) return spades <= 4 ? 70 : 15;
    if (suit === HEARTS) return r >= 11 ? 40 + r : r * 1.5;
    return r >= 12 ? r * 3 : r * 0.4 + (short ? 14 : 0);
  }
  function choosePass(hand) {
    return hand.slice().sort(function (a, b) { return passWeight(hand, b) - passWeight(hand, a) || a - b; }).slice(0, PASS_COUNT);
  }

  var playedSoFar = function (state) { return [].concat.apply([], state.taken).concat(state.trick.map(function (t) { return t.id; })); };

  // A sensible player: lead low and away from hearts, duck tricks, never take
  // the queen unless forced, and when void get rid of the queen, then the
  // spade honours while she is out, then the highest heart, then the highest
  // card of the shortest suit (to make another void).
  function aiPick(state, seat) {
    var hand = state.hands[seat], legal = legalPlays(state, seat), trick = state.trick;
    if (legal.length === 1) return legal[0];
    var queenOut = playedSoFar(state).indexOf(QUEEN_SPADES) < 0, haveQueen = hand.indexOf(QUEEN_SPADES) >= 0;

    if (!trick.length) {
      return minBy(legal, function (c) {
        var cost = high(c) + count(hand, Z.suit(c)) * 0.1;
        if (isHeart(c)) cost += 14;
        if (c === QUEEN_SPADES) cost += 100;
        if (Z.suit(c) === SPADES && (c === KING_SPADES || c === ACE_SPADES) && queenOut && !haveQueen) cost += 40;
        return cost;
      });
    }
    var lead = Z.suit(trick[0].id), follow = legal.filter(function (c) { return Z.suit(c) === lead; });
    if (follow.length) {
      var curHigh = Math.max.apply(null, trick.filter(function (t) { return Z.suit(t.id) === lead; }).map(function (t) { return high(t.id); }));
      var ducks = follow.filter(function (c) { return high(c) < curHigh; });
      if (ducks.length) return maxBy(ducks, high);
      var over = follow.filter(function (c) { return c !== QUEEN_SPADES; });
      if (!over.length) over = follow;
      var last = trick.length === SEATS - 1;
      return last && trickPoints(trick) === 0 ? maxBy(over, high) : minBy(over, high);
    }
    // Void: dump.
    if (legal.indexOf(QUEEN_SPADES) >= 0) return QUEEN_SPADES;
    var honours = legal.filter(function (c) { return (c === KING_SPADES || c === ACE_SPADES) && queenOut; });
    if (honours.length) return maxBy(honours, high);
    var hearts = legal.filter(isHeart);
    if (hearts.length) return maxBy(hearts, high);
    return maxBy(legal, function (c) { return high(c) + (4 - count(hand, Z.suit(c))) * 2; });
  }

  // For the debug hook: the last trick, and the human is well ahead.
  function almostWon() {
    var st = dealHand(Z.shuffled(function () { return 0.4; }), 5, [20, 95, 90, 98]);
    st.hands = [[Z.make(3, CLUBS)], [QUEEN_SPADES], [Z.make(Z.KING, CLUBS)], [Z.make(5, CLUBS)]];
    st.taken = [[], [], [], []]; st.phase = 'play'; st.leader = st.turn = 0; st.tricksPlayed = HAND - 1; st.broken = true; st.received = [];
    return st;
  }

  // ── Layout ──────────────────────────────────────────────────────────────
  var SCORE_BAR_H = 26, STATUS_H = 46, RAISE_SHARE = 0.3, SUIT_GAP_SHARE = 0.18, HAND_STEP_SHARE = 0.78, HEIGHT_SHARE = 0.11;
  var SIDE_STEP_MIN = 0.07, SIDE_STEP_MAX = 0.2, TOP_STEP_SHARE = 0.3, SIDE_OFFSET_CARDS = 3.4, TRICK_DX = 0.72, TRICK_DY = 0.62;

  // Where everything sits on a table of this size.
  function geometry(m) {
    var cw = m.cw, ch = m.ch, cx = m.W / 2, g = { cw: cw, ch: ch, cx: cx };
    g.raise = Math.round(ch * RAISE_SHARE);
    g.northY = m.pad + SCORE_BAR_H;
    g.southY = m.H - ch - m.pad;
    g.yTop = g.northY + ch + 8;
    g.yBot = g.southY - g.raise - 6;
    g.statusY = g.yBot - STATUS_H;
    g.cy = (g.yTop + g.statusY) / 2;
    g.westX = Math.max(m.pad, Math.round(cx - SIDE_OFFSET_CARDS * cw));
    g.eastX = Math.min(m.W - m.pad - cw, Math.round(cx + (SIDE_OFFSET_CARDS - 1) * cw));
    g.sideStep = Math.max(ch * SIDE_STEP_MIN, Math.min(ch * SIDE_STEP_MAX, (g.statusY - g.yTop - ch) / (HAND - 1)));
    g.topStep = cw * TOP_STEP_SHARE;
    return g;
  }
  // A card's corner in the middle for each seat's play, and where a seat's cards sit.
  function trickSpot(g, seat) {
    var x = g.cx - g.cw / 2, y = g.cy - g.ch / 2;
    return [{ x: x, y: y + g.ch * TRICK_DY }, { x: x - g.cw * TRICK_DX, y: y }, { x: x, y: y - g.ch * TRICK_DY }, { x: x + g.cw * TRICK_DX, y: y }][seat];
  }
  function seatSpot(g, seat) {
    return [{ x: g.cx - g.cw / 2, y: g.southY }, { x: g.westX, y: g.yTop }, { x: g.cx - g.cw / 2, y: g.northY }, { x: g.eastX, y: g.yTop }][seat];
  }

  function place(state, m, view) {
    var g = geometry(m), cards = [], slots = [], chosen = (view && view.chosen) || [];
    var sweep = view && state.trick.length === SEATS ? view.sweep : null;
    var myTurn = state.phase === 'play' && state.turn === 0 && state.trick.length < SEATS;
    var passing = state.phase === 'pass';

    // Quiet slots first: the deal comes out of the middle, and a card dropped there is played.
    slots.push({ id: 'deck', x: g.cx - g.cw / 2, y: g.cy - g.ch / 2, w: g.cw, h: g.ch, quiet: true, label: 'Table' });
    slots.push({ id: 'trick', x: g.cx - 1.6 * g.cw, y: g.cy - 1.1 * g.ch, w: 3.2 * g.cw, h: 2.2 * g.ch, quiet: true, label: 'Trick' });

    // Your hand, left to right, a little space between suits.
    var mine = state.hands[0], n = mine.length, gaps = 0, i;
    for (i = 1; i < n; i++) if (Z.suit(mine[i]) !== Z.suit(mine[i - 1])) gaps++;
    var gap = g.cw * SUIT_GAP_SHARE, avail = m.W - 2 * m.pad - g.cw - gaps * gap;
    var step = n > 1 ? Math.min(g.cw * HAND_STEP_SHARE, avail / (n - 1)) : 0;
    var x = (m.W - (g.cw + (n - 1) * step + gaps * gap)) / 2;
    mine.forEach(function (id, k) {
      if (k > 0 && Z.suit(id) !== Z.suit(mine[k - 1])) x += gap;
      var picked = chosen.indexOf(id) >= 0, fresh = state.received.indexOf(id) >= 0;
      cards.push({ id: id, pile: 'h' + id, idx: 0, x: Math.round(x), y: g.southY - (picked ? g.raise : 0), up: true, mark: picked, glow: fresh && !picked, dim: myTurn && !isLegal(state, 0, id) });
      slots.push({ id: 'h' + id, x: Math.round(x), y: g.southY - (picked ? g.raise : 0), w: g.cw, h: g.ch, label: Z.cardName(id) + (picked ? ', chosen to pass' : fresh ? ', passed to you' : '') });
      x += step;
    });
    // The others: face-down fans.
    var west = state.hands[1], north = state.hands[2], east = state.hands[3];
    west.forEach(function (id, k) { cards.push({ id: id, pile: 'p1', idx: k, x: g.westX, y: g.yTop + k * g.sideStep, up: false }); });
    east.forEach(function (id, k) { cards.push({ id: id, pile: 'p3', idx: k, x: g.eastX, y: g.yTop + k * g.sideStep, up: false }); });
    var nx = g.cx - (g.cw + (north.length - 1) * g.topStep) / 2;
    north.forEach(function (id, k) { cards.push({ id: id, pile: 'p2', idx: k, x: Math.round(nx + k * g.topStep), y: g.northY, up: false }); });
    // The trick, or on its way to the winner.
    state.trick.forEach(function (t, k) {
      var spot = sweep !== null && sweep !== undefined ? seatSpot(g, sweep) : trickSpot(g, t.seat);
      cards.push({ id: t.id, pile: 'trick', idx: k, x: Math.round(spot.x), y: Math.round(spot.y), up: true });
    });
    // Won cards wait out of sight at their winner's seat.
    state.taken.forEach(function (list, seat) {
      var spot = seatSpot(g, seat);
      list.forEach(function (id, k) { cards.push({ id: id, pile: 't' + seat, idx: k, x: spot.x, y: spot.y, up: false, hidden: true }); });
    });
    return { height: m.H, slots: slots, cards: cards, passing: passing };
  }

  var api = {
    NAMES: NAMES, PASS_NAMES: PASS_NAMES, END_SCORE: END_SCORE, TWO_CLUBS: TWO_CLUBS, QUEEN_SPADES: QUEEN_SPADES,
    points: points, sortHand: sortHand, dealHand: dealHand, newGame: freshGame, nextHand: nextHand, legalPlays: legalPlays, whyNot: whyNot, isLegal: isLegal,
    playCard: playCard, trickWinner: trickWinner, trickPoints: trickPoints, resolveTrick: resolveTrick, winners: winners, humanWon: humanWon, liveSoFar: liveSoFar,
    applyPass: applyPass, choosePass: choosePass, aiPick: aiPick, almostWon: almostWon, geometry: geometry, place: place
  };
  root.ZimiHearts = api;

  // ── The page ────────────────────────────────────────────────────────────
  var AI_MS = 520, HOLD_MS = 900, SWEEP_MS = 380, FLASH_MS = 1800;
  function boot() {
    var d = root.document, el = Z.pageEls(), board, session, view = { chosen: [], sweep: null, flash: '' };
    Z.ensureSprite();

    // The table's own text: the score row and a status line with one button.
    var scoreRow = Z.h('div', { class: 'hz-scores', 'aria-live': 'off' });
    var statusText = Z.h('span', { class: 'hz-status-text' });
    var statusBtn = Z.h('button', { class: 'ar-btn', type: 'button' });
    var status = Z.h('div', { class: 'hz-status', role: 'status' }, [statusText, statusBtn]);
    el.table.appendChild(scoreRow); el.table.appendChild(status);
    var statusAction = null;
    statusBtn.addEventListener('click', function () { if (statusAction) statusAction(); });

    function paintHud() {
      var st = session && session.state, m = board && board.metrics();
      if (!st || !m) return;
      var g = geometry(m);
      scoreRow.textContent = '';
      NAMES.forEach(function (name, seat) {
        var live = st.phase === 'play' ? liveSoFar(st, seat) : 0, turn = st.phase === 'play' && st.turn === seat && st.trick.length < SEATS;
        var chip = Z.h('span', { class: 'hz-chip' + (turn ? ' hz-turn' : '') }, [Z.h('b', { text: name }), Z.h('span', { text: String(st.scores[seat]) + (live ? ' +' + live : '') })]);
        scoreRow.appendChild(chip);
      });
      scoreRow.style.top = m.pad + 'px';
      status.style.top = Math.round(g.statusY) + 'px'; status.style.height = STATUS_H + 'px';
      var text = '', label = '', action = null;
      if (st.phase === 'pass') {
        var left = PASS_COUNT - view.chosen.length;
        text = left > 0 ? 'Choose ' + left + ' more to pass ' + PASS_NAMES[st.passDir] : 'Pass them ' + PASS_NAMES[st.passDir] + '?';
        label = 'Pass'; action = left === 0 ? passNow : null;
      } else if (st.phase === 'handEnd') { text = 'Hand over'; label = 'Next hand'; action = startNextHand; }
      else if (st.phase === 'over') { text = 'Game over'; label = 'New game'; action = newGame; }
      else if (view.flash) text = view.flash;
      else if (st.trick.length === SEATS) text = NAMES[trickWinner(st.trick)] + (trickWinner(st.trick) === 0 ? ' take' : ' takes') + ' the trick';
      else text = st.turn === 0 ? (st.received.length ? 'Your turn. The glowing cards came from ' + NAMES[(SEATS - PASS_OFFSET[st.passDir]) % SEATS] : 'Your turn') : NAMES[st.turn] + ' is thinking';
      statusText.textContent = text;
      statusBtn.textContent = label; statusBtn.hidden = !label;
      statusBtn.disabled = !action; statusAction = action;
      el.sub.textContent = 'Hand ' + (st.handNo + 1) + ' \u00b7 ' + PASS_SHORT[st.passDir];
    }
    function flash(text) { view.flash = text; board.say(text); paintHud(); session.later(function () { view.flash = ''; paintHud(); }, FLASH_MS); }

    // ── Turn order ───────────────────────────────────────────────────────
    function drive() {
      var st = session.state;
      if (st.phase !== 'play') return;
      if (st.trick.length === SEATS) { session.later(sweepTrick, HOLD_MS); return; }
      if (st.turn !== 0) session.later(aiTurn, AI_MS);
    }
    function aiTurn() {
      var st = session.state;
      if (st.phase !== 'play' || st.turn === 0 || st.trick.length === SEATS) return;
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
    function handLines(st) {
      var lines = NAMES.map(function (name, seat) { return name + ': ' + (st.handPoints[seat] ? '+' + st.handPoints[seat] : '0') + ', total ' + st.scores[seat]; });
      if (st.moon >= 0) lines.unshift(NAMES[st.moon] + (st.moon === 0 ? ' shoot' : ' shoots') + ' the moon. Everyone else takes 26.');
      return lines;
    }
    function handOver() {
      var st = session.state;
      Z.sheet({
        title: 'Hand ' + (st.handNo + 1),
        body: handLines(st).map(function (t) { return Z.h('p', { class: 'zc-note', text: t }); }),
        actions: [{ label: 'Next hand', primary: true, onclick: startNextHand }]
      });
    }
    function gameOver() {
      var st = session.state, lines = handLines(st), won = humanWon(st);
      lines.push(won ? 'You have the lowest score.' : NAMES[winners(st.scores)[0]] + ' has the lowest score.');
      if (won) session.win(st.scores[0]); else session.lose('Game over', lines, st.scores[0]);
    }
    function startNextHand() {
      var st = session.state;
      if (st.phase !== 'handEnd') return;
      session.history = [];
      view.chosen = [];
      session.follow(nextHand(st, Z.shuffled(Math.random)));
      drive();
    }

    // ── The human's choices ──────────────────────────────────────────────
    function passNow() {
      var st = session.state;
      if (st.phase !== 'pass' || view.chosen.length !== PASS_COUNT) return;
      var picks = [view.chosen.slice(), choosePass(st.hands[1]), choosePass(st.hands[2]), choosePass(st.hands[3])];
      view.chosen = [];
      session.commit(applyPass(st, picks));
      drive();
    }
    function play(id) {
      var st = session.state;
      if (!isLegal(st, 0, id)) return false;
      session.commit(playCard(st, 0, id));
      drive();
      return true;
    }
    var idOf = function (pile) { return parseInt(pile.slice(1), 10); };
    function tap(pile) {
      var st = session.state, id = idOf(pile);
      if (pile.charAt(0) !== 'h' || isNaN(id)) return false;
      if (st.phase === 'pass') {
        var at = view.chosen.indexOf(id);
        if (at >= 0) view.chosen.splice(at, 1);
        else if (view.chosen.length < PASS_COUNT) view.chosen.push(id);
        else { flash('Pass three cards. Tap one to put it back'); return true; }
        board.refresh(); paintHud();
        return true;
      }
      if (st.phase !== 'play') return false;
      if (st.turn !== 0 || st.trick.length === SEATS) { flash(st.trick.length === SEATS ? 'Wait for the trick' : 'Wait for your turn'); return false; }
      if (!isLegal(st, 0, id)) { flash(whyNot(st, 0, id)); return false; }
      return play(id);
    }
    function newGame() {
      view.chosen = []; view.sweep = null; view.flash = '';
      session.reset(freshGame(Z.shuffled(Math.random)));
      drive();
    }

    board = Z.createBoard({
      table: el.table, cols: 7, heightShare: HEIGHT_SHARE, enterTaps: true,
      place: function (st, m) { return place(st, m, view); },
      canPick: function (st, pile) { return st.phase === 'play' && pile.charAt(0) === 'h' && isLegal(st, 0, idOf(pile)); },
      move: function (pile, idx, to) { return (to === 'trick' || to === 'deck') && pile.charAt(0) === 'h' ? play(idOf(pile)) : false; },
      tap: tap
    });
    session = Z.createSession({
      id: 'hearts', lowScore: true, board: board, newGame: newGame, els: el,
      statText: function (sec, st) { paintHud(); return Z.fmtTime(sec) + ' · ' + st.scores[0]; },
      cascadeOrder: function (st) { return [].concat.apply([], st.taken).map(function (id) { return { id: id }; }); },
      winLines: function (sec, st) { return handLines(st).concat(['You have the lowest score, ' + st.scores[0] + ', after ' + (st.handNo + 1) + (st.handNo ? ' hands' : ' hand') + '.']); },
      openMenu: function () {
        Z.sheet({
          title: 'Hearts',
          body: [
            Z.h('p', { class: 'zc-note', text: 'Avoid hearts (1 each) and the queen of spades (13). Take all 26 to shoot the moon: you score 0 and the others 26. The game ends at 100; lowest score wins. Tap a card to play it, or drag it to the middle. Tap three cards to pass them.' }),
            Z.backsRow(),
            Z.h('p', { class: 'zc-stats', text: session.stats.line() })
          ],
          actions: [{ label: 'New game', onclick: newGame }, { label: 'Done', primary: true }]
        });
      }
    });
    api.session = session; api.board = board;
    d.addEventListener('visibilitychange', function () { if (!d.hidden) paintHud(); });
    newGame();
    if (/[?&]debug=win/.test(root.location.search)) { session.reset(almostWon()); drive(); }
  }

  if (root.document && root.document.getElementById('zc-table')) boot();
})(typeof globalThis !== 'undefined' ? globalThis : window);
