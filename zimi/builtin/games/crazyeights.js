/* ZimiGames: Crazy Eights, two to four players: you (south) against the
   computer players. Seven cards each (five with three or four players), one
   turned up. Play a card that matches the top card's suit or rank; an 8 is
   wild and names the suit. With no play you draw from the stock until you can
   play (the discards are shuffled back if the stock runs out; with nothing
   left to draw you pass). Going out scores the points left in the other hands
   (8 = 50, K Q J = 10, ace = 1, others their number); first to 100 wins.

   State: players, hands[n], stock, discard (top last), suit (the suit to
   match), turn, dealer, phase ('play' | 'handEnd' | 'over'), scores[n],
   handNo, result. Pure functions; the page wiring only runs in a browser. */
(function (root) {
  'use strict';
  var Z = root.ZimiCards, T = root.ZimiTable;

  var MAX_RECYCLES = 3, END_SCORE = 100, EIGHT = 8, EIGHT_POINTS = 50, FACE_POINTS = 10, POS_NAMES = ['You', 'West', 'North', 'East'];
  var GLYPH = T.SUIT_GLYPH, SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'];
  var rankOf = function (id) { return Z.rank(id); };
  var low = function (id) { return rankOf(id); };

  var dealSize = function (players) { return players === 2 ? 7 : 5; };
  function seatName(players, seat) { return POS_NAMES[T.SEAT_POS[players][seat]]; }
  function cardPoints(id) {
    var r = rankOf(id);
    return r === EIGHT ? EIGHT_POINTS : r >= 11 ? FACE_POINTS : r;
  }

  // ── Rules ───────────────────────────────────────────────────────────────
  function sorted(ids) { return T.sortHand(ids, low); }
  // A hand from a shuffled 52: the first non-8 left over is turned up.
  function dealHand(order, players, handNo, scores, dealer) {
    var n = dealSize(players), hands = [], s, rest = order.slice(players * n);
    for (s = 0; s < players; s++) hands.push(sorted(order.slice(s * n, (s + 1) * n)));
    var at = rest.findIndex(function (c) { return rankOf(c) !== EIGHT; }), up = rest.splice(at, 1)[0];
    return { players: players, hands: hands, stock: rest, discard: [up], suit: Z.suit(up), turn: (dealer + 1) % players, dealer: dealer, phase: 'play', scores: scores.slice(), handNo: handNo, result: null, passes: 0, recycles: 0, moves: 0 };
  }
  function freshGame(order, players, dealer) { return dealHand(order, players, 0, new Array(players).fill(0), dealer === undefined ? players - 1 : dealer); }
  function nextHand(st, order) { return dealHand(order, st.players, st.handNo + 1, st.scores, (st.dealer + 1) % st.players); }

  var top = function (st) { return st.discard[st.discard.length - 1]; };
  function legalPlays(st, seat) {
    var t = top(st);
    return st.hands[seat].filter(function (c) { return rankOf(c) === EIGHT || Z.suit(c) === st.suit || rankOf(c) === rankOf(t); });
  }
  function isLegal(st, seat, id) { return st.phase === 'play' && st.turn === seat && legalPlays(st, seat).indexOf(id) >= 0; }
  function whyNot(st) { return 'Match ' + SUIT_NAMES[st.suit] + ' or ' + Z.RANK_LABELS[rankOf(top(st)) - 1] + ', or play an 8'; }
  // The discards go back into the stock at most MAX_RECYCLES times a hand, so a hand always ends.
  var canDraw = function (st) { return st.stock.length > 0 || (st.discard.length > 1 && st.recycles < MAX_RECYCLES); };
  // No play, and nothing to draw.
  var mustPass = function (st, seat) { return st.phase === 'play' && st.turn === seat && !legalPlays(st, seat).length && !canDraw(st); };

  // `suit` names the suit after an 8; otherwise the card's own.
  function playCard(st, seat, id, suit) {
    var s = Z.clone(st);
    s.hands[seat].splice(s.hands[seat].indexOf(id), 1);
    s.discard.push(id); s.suit = rankOf(id) === EIGHT && suit !== undefined ? suit : Z.suit(id); s.moves++; s.passes = 0;
    if (!s.hands[seat].length) endHand(s, seat); else s.turn = (seat + 1) % s.players;
    return s;
  }
  function endHand(s, winner) {
    var pts = 0;
    s.hands.forEach(function (h, seat) { if (seat !== winner) pts += h.reduce(function (n, c) { return n + cardPoints(c); }, 0); });
    s.scores[winner] += pts; s.result = { winner: winner, points: pts };
    s.phase = Math.max.apply(null, s.scores) >= END_SCORE ? 'over' : 'handEnd';
  }
  // Draw one card; an empty stock is refilled from under the top discard.
  function draw(st, seat, rng) {
    var s = Z.clone(st);
    if (!s.stock.length && canDraw(s)) { s.recycles++; var t = s.discard.pop(); s.stock = T.shuffleOf(s.discard, rng || Math.random); s.discard = [t]; }
    if (!s.stock.length) return s;
    s.hands[seat] = sorted(s.hands[seat].concat([s.stock.pop()])); s.moves++; s.passes = 0;
    return s;
  }
  // A pass with nobody able to play or draw: when every player has passed in a
  // row the hand is blocked and the lowest hand goes out.
  function pass(st, seat) {
    var s = Z.clone(st); s.turn = (seat + 1) % s.players; s.moves++; s.passes++;
    if (s.passes >= s.players) {
      var total = function (h) { return h.reduce(function (n, c) { return n + cardPoints(c); }, 0); };
      var best = 0;
      s.hands.forEach(function (h, i) { if (total(h) < total(s.hands[best])) best = i; });
      endHand(s, best); s.result.blocked = true;
    }
    return s;
  }
  // Who is ahead when the game ends: the highest score.
  function gameWinner(scores) { var hi = Math.max.apply(null, scores); return scores.indexOf(hi); }

  // ── The computer players ────────────────────────────────────────────────
  // The suit this hand holds most of (ignoring 8s), else the one in play.
  function commonestSuit(hand, fallback) {
    var n = [0, 0, 0, 0], best = fallback, bn = 0;
    hand.forEach(function (c) { if (rankOf(c) !== EIGHT) n[Z.suit(c)]++; });
    n.forEach(function (v, s) { if (v > bn) { bn = v; best = s; } });
    return best;
  }
  // {id, suit} to play, or null to draw.
  function aiPlay(st, seat) {
    var hand = st.hands[seat], legal = legalPlays(st, seat);
    if (!legal.length) return null;
    var plain = legal.filter(function (c) { return rankOf(c) !== EIGHT; });
    if (plain.length) {
      var pick = T.maxBy(plain, function (c) { return hand.filter(function (x) { return Z.suit(x) === Z.suit(c); }).length * 2 + cardPoints(c) / 10; });
      return { id: pick, suit: Z.suit(pick) };
    }
    var eight = legal[0], rest = hand.filter(function (c) { return c !== eight; });
    return { id: eight, suit: commonestSuit(rest, st.suit) };
  }

  // ── Layout ──────────────────────────────────────────────────────────────
  var SHOW_STOCK = 2, SHOW_DISCARD = 3, DISCARD_FAN = 5;
  function geo(m, st) { return T.geometry(m, T.rowsFor(m, st.hands[0].length)); }
  function piles(g) {
    var y = Math.round(g.cy - g.ch / 2);
    return { stock: { x: Math.round(g.cx - g.cw * 1.1), y: y }, discard: { x: Math.round(g.cx + g.cw * 0.1), y: y } };
  }
  function place(st, m, view) {
    var g = geo(m, st), p = piles(g), slots = [], cards = [], myTurn = st.phase === 'play' && st.turn === 0;
    slots.push({ id: 'stock', x: p.stock.x, y: p.stock.y, w: g.cw, h: g.ch, label: 'Stock, ' + Z.plural(st.stock.length, 'card') });
    slots.push({ id: 'discard', x: p.discard.x, y: p.discard.y, w: g.cw, h: g.ch, label: 'Discard pile, top ' + Z.cardName(top(st)) });
    var pend = view && view.pending;
    var hand = T.handCards(g, st.hands[0], function (id) { return { dim: myTurn && !pend && !isLegal(st, 0, id), raise: id === pend, mark: id === pend }; });
    slots = slots.concat(hand.slots); cards = cards.concat(hand.cards);
    for (var seat = 1; seat < st.players; seat++) cards = cards.concat(T.fan(g, T.SEAT_POS[st.players][seat], st.hands[seat], false));
    st.stock.forEach(function (id, k) { cards.push({ id: id, pile: 'stock', idx: k, x: p.stock.x, y: p.stock.y, up: false, hidden: k < st.stock.length - SHOW_STOCK }); });
    st.discard.forEach(function (id, k) {
      var from = st.discard.length - SHOW_DISCARD, off = Math.max(0, k - from) * DISCARD_FAN;
      cards.push({ id: id, pile: 'discard', idx: k, x: p.discard.x + off, y: p.discard.y + off, up: true, hidden: k < from });
    });
    return { height: m.H, slots: slots, cards: cards };
  }

  var api = {
    END_SCORE: END_SCORE, cardPoints: cardPoints, seatName: seatName, dealSize: dealSize, dealHand: dealHand, newGame: freshGame, nextHand: nextHand,
    legalPlays: legalPlays, isLegal: isLegal, whyNot: whyNot, canDraw: canDraw, mustPass: mustPass, playCard: playCard, draw: draw, pass: pass,
    gameWinner: gameWinner, commonestSuit: commonestSuit, aiPlay: aiPlay, geo: geo, place: place
  };
  root.ZimiCrazyEights = api;

  // ── The page ────────────────────────────────────────────────────────────
  var AI_MS = 650, PASS_MS = 1000, PLAYERS_KEY = 'crazyeights.players', DEFAULT_PLAYERS = 3, SUIT_MARK_GAP = 6;
  function boot() {
    var d = root.document, t, board, session, view = { flash: '', pending: null, note: '' }, players = DEFAULT_PLAYERS;
    var marker = Z.h('div', { class: 'ce-suit', 'aria-live': 'polite' });
    var markerGlyph = Z.h('span', { class: 'ce-glyph' }), markerText = Z.h('span', { class: 'ce-word' });
    marker.appendChild(markerGlyph); marker.appendChild(markerText);
    var count = Z.h('div', { class: 'ce-suit ce-count' });
    Z.pageEls().table.appendChild(marker); Z.pageEls().table.appendChild(count);
    var name = function (st, seat) { return seatName(st.players, seat); };

    function paintMarker(st) {
      var m = board.metrics();
      if (!m) return;
      var g = geo(m, st), p = piles(g), wild = Z.suit(top(st)) !== st.suit || rankOf(top(st)) === EIGHT;
      marker.style.left = Math.round(p.discard.x + g.cw / 2) + 'px';
      marker.style.top = Math.round(p.discard.y + g.ch + SUIT_MARK_GAP + 4 * DISCARD_FAN / 2) + 'px';
      marker.className = 'ce-suit' + (wild ? ' ce-wild' : '') + (st.suit === 1 || st.suit === 2 ? ' ce-red' : '');
      count.style.left = Math.round(p.stock.x + g.cw / 2) + 'px'; count.style.top = Math.round(p.stock.y - 28) + 'px';
      count.textContent = Z.plural(st.stock.length, 'card');
      markerGlyph.textContent = GLYPH[st.suit]; markerText.textContent = wild ? 'suit called' : 'match';
    }
    function scoreLine(st) { return st.scores.map(function (v, seat) { return name(st, seat)[0] + ' ' + v; }).join(' · '); }
    function hud(st) {
      paintMarker(st);
      var chips = st.hands.map(function (h, seat) { return { name: name(st, seat), text: String(h.length), turn: st.phase === 'play' && st.turn === seat }; });
      var out = { chips: chips, sub: scoreLine(st), text: '' };
      if (st.phase === 'handEnd') { out.text = 'Hand over'; out.label = 'Next hand'; out.action = startNextHand; return out; }
      if (st.phase === 'over') { out.text = 'Game over'; out.label = 'New game'; out.action = newGame; return out; }
      var note = view.note ? ' ' + view.note : '';
      if (st.turn !== 0) { out.text = name(st, st.turn) + ' is thinking.' + note; return out; }
      if (view.pending !== null) {
        out.text = 'Choose the suit';
        out.choices = [0, 1, 2, 3].map(function (s) { return { label: GLYPH[s], aria: SUIT_NAMES[s], cls: s === 1 || s === 2 ? 'ct-red' : '', onclick: function () { chooseSuit(s); } }; });
        out.choices.push({ label: 'Cancel', onclick: function () { view.pending = null; board.refresh(); t.paint(); } });
      } else if (legalPlays(st, 0).length) out.text = 'Your turn.' + note;
      else out.text = (canDraw(st) ? 'No play: tap the stock to draw.' : 'No play and nothing to draw.') + note;
      return out;
    }

    function drive() {
      var st = session.state;
      if (st.phase !== 'play') return;
      if (st.turn !== 0) session.later(aiTurn, AI_MS);
      else if (mustPass(st, 0)) session.later(passNow, PASS_MS);
    }
    function finish() {
      var st = session.state;
      if (st.phase === 'handEnd') handOver(); else if (st.phase === 'over') gameOver(); else drive();
    }
    function aiTurn() {
      var st = session.state, seat = st.turn;
      if (st.phase !== 'play' || seat === 0) return;
      var mv = aiPlay(st, seat), me = name(st, seat);
      if (mv) {
        view.note = me + ' played ' + T.short(mv.id) + (rankOf(mv.id) === EIGHT ? ' and called ' + SUIT_NAMES[mv.suit] : '') + '.';
        session.follow(playCard(st, seat, mv.id, mv.suit));
        finish(); return;
      }
      if (canDraw(st)) { view.note = me + ' drew a card.'; session.follow(draw(st, seat)); } else { view.note = me + ' passed.'; session.follow(pass(st, seat)); }
      drive();
    }
    function resultLines(st) {
      var r = st.result, me = name(st, r.winner);
      return [(r.blocked ? 'Nobody can move: ' + (r.winner === 0 ? 'you hold' : me + ' holds') + ' the fewest points, and ' : (r.winner === 0 ? 'You went out' : me + ' went out') + ' and ') + (r.winner === 0 ? 'score ' : 'scores ') + r.points + '.', scoreLine(st, true)];
    }
    function handOver() { T.lineSheet('Hand ' + (session.state.handNo + 1), resultLines(session.state), [{ label: 'Next hand', primary: true, onclick: startNextHand }]); }
    function gameOver() {
      var st = session.state, w = gameWinner(st.scores), lines = resultLines(st).concat([w === 0 ? 'You win with ' + st.scores[0] + '.' : name(st, w) + ' wins with ' + st.scores[w] + '.']);
      if (w === 0) session.win(st.scores[0]); else session.lose('Game over', lines, st.scores[0]);
    }
    function startNextHand() {
      var st = session.state;
      if (st.phase !== 'handEnd') return;
      session.history = []; view.note = '';
      session.follow(nextHand(st, Z.shuffled(Math.random)));
      drive();
    }
    function passNow() {
      var st = session.state;
      if (!mustPass(st, 0)) return;
      view.note = 'You passed.'; session.follow(pass(st, 0)); t.flash('Nothing to play or draw: you pass'); drive();
    }
    function play(id, suit) {
      var st = session.state;
      if (!isLegal(st, 0, id)) return false;
      view.note = '';
      session.commit(playCard(st, 0, id, suit));
      finish();
      return true;
    }
    function chooseSuit(s) { var id = view.pending; view.pending = null; if (id !== null) play(id, s); }
    // An 8 asks for its suit first; any other card plays at once.
    function tryPlay(id) {
      var st = session.state;
      if (!isLegal(st, 0, id)) return false;
      if (rankOf(id) === EIGHT) { view.pending = id; board.refresh(); t.paint(); return true; }
      return play(id);
    }
    var idOf = function (pile) { return parseInt(pile.slice(1), 10); };
    function drawTap() {
      var st = session.state;
      if (st.phase !== 'play' || st.turn !== 0) { t.flash('Wait for your turn'); return; }
      if (legalPlays(st, 0).length) { t.flash('You have a card to play'); return; }
      if (!canDraw(st)) return;
      view.note = ''; session.commit(draw(st, 0)); drive();
    }
    function tap(pile) {
      var st = session.state;
      if (pile === 'stock') { drawTap(); return true; }
      if (pile === 'discard') return false;
      var id = idOf(pile);
      if (pile.charAt(0) !== 'h' || isNaN(id) || st.phase !== 'play') return false;
      view.pending = null;
      if (st.turn !== 0) { t.flash('Wait for your turn'); return false; }
      if (!isLegal(st, 0, id)) { t.flash(whyNot(st)); return false; }
      return tryPlay(id);
    }
    function newGame() {
      players = Z.store.get(PLAYERS_KEY, DEFAULT_PLAYERS);
      if (players !== 2 && players !== 3 && players !== 4) players = DEFAULT_PLAYERS;
      view.flash = ''; view.pending = null; view.note = '';
      session.reset(freshGame(Z.shuffled(Math.random), players, Math.floor(Math.random() * players)));
      drive();
    }
    t = T.create({
      id: 'crazyeights', name: 'Crazy Eights', view: view, geo: geo, place: place, hud: hud, newGame: newGame, tap: tap, slotTap: drawTap, cols: 7, heightShare: 0.11,
      canPick: function (st, pile) { return st.phase === 'play' && pile.charAt(0) === 'h' && isLegal(st, 0, idOf(pile)); },
      move: function (pile, idx, to) { return (to === 'discard' || to === 'stock') && pile.charAt(0) === 'h' ? tryPlay(idOf(pile)) : false; },
      stat: function (sec, st) { return Z.fmtTime(sec) + ' · ' + st.scores[0]; },
      cascadeOrder: function (st) { return st.discard.map(function (id) { return { id: id }; }); },
      winLines: function (sec, st) { return resultLines(st).concat(['You win with ' + st.scores[0] + '.']); },
      menuExtra: function () {
        return [T.choiceRow('Players', PLAYERS_KEY, [{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }], DEFAULT_PLAYERS, function () {}),
          Z.h('p', { class: 'zc-note', text: 'The number of players applies to the next new game.' })];
      },
      rules: 'Play a card that matches the top card’s suit or rank. An 8 is wild: you name the suit. No play? Tap the stock to draw until you can. Go out first to score the points left in the other hands (8 = 50, K Q J = 10, ace = 1). First to 100 wins. Tap a card to play it, or drag it to the discard pile.'
    });
    board = t.board; session = t.session;
    api.session = session; api.board = board;
    newGame();
  }

  if (root.document && root.document.getElementById('zc-table')) boot();
})(typeof globalThis !== 'undefined' ? globalThis : window);
