/* ZimiGames: Pyramid. Twenty-eight cards in seven rows. Take cards in pairs
   that add up to 13 (ace 1 ... queen 12), kings on their own. A pyramid card
   is free once the two cards that overlap it are gone; the top of the waste
   is free too. Turn the stock one card at a time; the waste may go round
   again twice.

   State: piles { 'p<row>_<col>' (0 or 1 card each), stock, waste, out },
   plus redeals used, score, moves. Rules are pure functions; the page wiring
   at the bottom only runs in a browser. */
(function (root) {
  'use strict';
  var Z = root.ZimiCards;

  var ROWS = 7, TARGET = 13, MAX_REDEALS = 2;
  var SCORE = { card: 5, clear: 50, redealLeft: 25 };
  var COLS = 7;
  var top = function (pile) { return pile[pile.length - 1]; };
  var pid = function (r, c) { return 'p' + r + '_' + c; };
  var PYRAMID = [];
  (function () { for (var r = 0; r < ROWS; r++) for (var c = 0; c <= r; c++) PYRAMID.push(pid(r, c)); })();
  var isPyramid = function (p) { return p.charAt(0) === 'p'; };
  var rowOf = function (p) { return parseInt(p.slice(1), 10); };
  var colOf = function (p) { return parseInt(p.split('_')[1], 10); };
  var value = function (id) { return Z.rank(id); };

  // ── Rules ───────────────────────────────────────────────────────────────
  function newState(order) {
    var piles = { stock: [], waste: [], out: [] }, k = 0;
    PYRAMID.forEach(function (p) { piles[p] = [order[k++]]; });
    piles.stock = order.slice(k);
    return { piles: piles, redeals: 0, score: 0, moves: 0 };
  }

  // Free: a card nothing overlaps (the bottom row, or both cards below gone),
  // or the waste's top card.
  function isFree(state, pile) {
    var P = state.piles;
    if (pile === 'waste') return P.waste.length > 0;
    if (!isPyramid(pile) || !P[pile].length) return false;
    var r = rowOf(pile), c = colOf(pile);
    return r === ROWS - 1 || (!P[pid(r + 1, c)].length && !P[pid(r + 1, c + 1)].length);
  }
  function topId(state, pile) { return top(state.piles[pile]); }

  function canPick(state, pile) { return isFree(state, pile); }
  function isKing(state, pile) { return isFree(state, pile) && value(topId(state, pile)) === TARGET; }
  function isPair(state, a, b) {
    return a !== b && isFree(state, a) && isFree(state, b) && value(topId(state, a)) + value(topId(state, b)) === TARGET;
  }
  // A move is a pair; a king alone may be dropped on the out pile.
  function legalMove(state, from, idx, to) {
    if (to === 'out') return isKing(state, from);
    return isPair(state, from, to);
  }

  function pyramidLeft(state) { return PYRAMID.filter(function (p) { return state.piles[p].length; }).length; }
  function isWon(state) { return pyramidLeft(state) === 0; }

  // Take one or two free cards off the table.
  function takeAway(state, piles) {
    var s = Z.clone(state);
    piles.forEach(function (p) { s.piles.out.push(s.piles[p].pop()); s.score += SCORE.card; });
    s.moves++;
    if (isWon(s)) s.score += SCORE.clear + SCORE.redealLeft * (MAX_REDEALS - s.redeals);
    return s;
  }
  function applyMove(state, from, idx, to) { return takeAway(state, to === 'out' ? [from] : [from, to]); }

  function drawStock(state) {
    var P = state.piles;
    if (P.stock.length) {
      var s = Z.clone(state);
      s.piles.waste.push(s.piles.stock.pop());
      s.moves++;
      return s;
    }
    if (!P.waste.length || state.redeals >= MAX_REDEALS) return null;
    var r = Z.clone(state);
    r.piles.stock = r.piles.waste.reverse(); r.piles.waste = [];
    r.redeals++; r.moves++;
    return r;
  }
  function canDraw(state) { return !!drawStock(state); }

  function availableCards(state) { return PYRAMID.concat(['waste']).filter(function (p) { return isFree(state, p); }); }
  // A pair or a king the player can take right now, for hints and "stuck".
  function findMove(state) {
    var av = availableCards(state), i, j;
    for (i = 0; i < av.length; i++) {
      if (isKing(state, av[i])) return { from: av[i], to: 'out' };
      for (j = i + 1; j < av.length; j++) if (isPair(state, av[i], av[j])) return { from: av[i], to: av[j] };
    }
    return null;
  }
  // Out of play: no pair, no king, and no more of the stock to turn.
  function isStuck(state) { return !isWon(state) && !findMove(state) && !canDraw(state); }

  // For the debug hook: a pair away from a clear (queen and king left, plus a 6 and 7).
  function almostWon() {
    var s = newState(Z.shuffled(function () { return 0.3; }));
    PYRAMID.forEach(function (p) { s.piles[p] = []; });
    s.piles.stock = []; s.piles.waste = [Z.make(6, 0)];
    s.piles.p6_2 = [Z.make(7, 1)];
    s.piles.p6_4 = [Z.make(13, 2)];
    return s;
  }

  // ── Layout ──────────────────────────────────────────────────────────────
  var ROW_STEP_SHARE = 0.5, ROW_GAP_SHARE = 0.3, HEIGHT_SHARE = 0.125;

  function place(state, m, view) {
    var P = state.piles, cw = m.cw, ch = m.ch, rowStep = ch * ROW_STEP_SHARE, picked = view && view.picked;
    var x = function (col) { return m.left + col * m.step; };
    var block = rowStep * (ROWS - 1) + ch * 2 + Math.round(ch * ROW_GAP_SHARE), y1 = m.pad + Z.restShare(m.H - block - 2 * m.pad);
    var y2 = y1 + rowStep * (ROWS - 1) + ch + Math.round(ch * ROW_GAP_SHARE), slots = [], cards = [], height = y2 + ch + m.pad;
    var at = function (p) { return { x: x(COLS / 2 - 0.5 - rowOf(p) / 2 + colOf(p)), y: y1 + rowOf(p) * rowStep }; };

    PYRAMID.forEach(function (p) {
      if (!P[p].length) return;
      var a = at(p);
      cards.push({ id: P[p][0], pile: p, idx: 0, x: a.x, y: a.y, up: true, mark: picked === p, dim: !isFree(state, p) });
      slots.push({ id: p, x: a.x, y: a.y, w: cw, h: ch, label: 'Row ' + (rowOf(p) + 1) + ', card ' + (colOf(p) + 1) + ', ' + Z.cardName(P[p][0]) + (isFree(state, p) ? '' : ', covered') });
    });
    P.stock.forEach(function (id, i) { cards.push({ id: id, pile: 'stock', idx: i, x: x(0), y: y2, up: false, hidden: i < P.stock.length - 2 }); });
    P.waste.forEach(function (id, i) { cards.push({ id: id, pile: 'waste', idx: i, x: x(1), y: y2, up: true, hidden: i < P.waste.length - 2, mark: picked === 'waste' && i === P.waste.length - 1 }); });
    P.out.forEach(function (id, i) { cards.push({ id: id, pile: 'out', idx: i, x: x(COLS - 1), y: y2, up: true, hidden: i < P.out.length - 2 }); });

    slots.push({ id: 'stock', x: x(0), y: y2, w: cw, h: ch, mark: P.stock.length ? '' : (canDraw(state) ? '↻' : '∅'), label: Z.describePile('Stock', P.stock, false) + (P.stock.length ? ', Enter to turn a card' : canDraw(state) ? ', Enter to go round again' : ', empty') });
    slots.push({ id: 'waste', x: x(1), y: y2, w: cw, h: ch, label: Z.describePile('Waste', P.waste, true) });
    slots.push({ id: 'out', x: x(COLS - 1), y: y2, w: cw, h: ch, label: 'Taken cards, ' + P.out.length + '. Drop a king here.' });
    return { height: height, slots: slots, cards: cards };
  }

  var api = {
    PYRAMID: PYRAMID, SCORE: SCORE, MAX_REDEALS: MAX_REDEALS,
    newState: newState, isFree: isFree, canPick: canPick, isKing: isKing, isPair: isPair, legalMove: legalMove, applyMove: applyMove, takeAway: takeAway,
    drawStock: drawStock, canDraw: canDraw, findMove: findMove, isWon: isWon, isStuck: isStuck, pyramidLeft: pyramidLeft, almostWon: almostWon, place: place
  };
  root.ZimiPyramid = api;

  // ── The page ────────────────────────────────────────────────────────────
  function boot() {
    var el = Z.pageEls(), board, session, view = { picked: null };
    Z.ensureSprite();

    function paintSub() { var st = session && session.state; if (!st) return; el.sub.textContent = isStuck(st) ? 'No moves left' : 'Redeals ' + (MAX_REDEALS - st.redeals); }
    function afterMove() {
      var st = session.state;
      view.picked = null;
      paintSub();
      if (isWon(st)) { session.win(st.score); return; }
      if (isStuck(st)) {
        session.stats.scored(st.score);
        Z.sheet({
          title: 'No moves left',
          body: [Z.h('p', { class: 'zc-note', text: pyramidLeft(st) + ' cards left in the pyramid.' }), Z.h('p', { class: 'zc-stats', text: session.stats.line() })],
          actions: [{ label: 'Undo', onclick: session.undo }, { label: 'New game', primary: true, onclick: newGame }]
        });
      }
    }
    function commit(next) { session.commit(next); afterMove(); return true; }
    function move(pile, idx, to) {
      if (!legalMove(session.state, pile, idx, to)) return false;
      return commit(applyMove(session.state, pile, idx, to));
    }
    function select(pile) { view.picked = pile; board.refresh(); }
    function tap(pile) {
      var st = session.state;
      if (pile === 'stock') { var next = drawStock(st); return next ? commit(next) : false; }
      if (!isFree(st, pile)) return false;
      if (isKing(st, pile)) return commit(takeAway(st, [pile]));
      if (view.picked === pile) { select(null); return true; }
      if (view.picked && isPair(st, view.picked, pile)) return commit(takeAway(st, [view.picked, pile]));
      select(pile);
      return true;
    }
    function newGame() { view.picked = null; session.reset(newState(Z.shuffled(Math.random))); paintSub(); }

    board = Z.createBoard({
      table: el.table, cols: COLS, heightShare: HEIGHT_SHARE, centerY: 0.4, enterTaps: true,
      place: function (st, m) { return place(st, m, view); },
      canPick: function (st, pile, idx) { return canPick(st, pile, idx); },
      move: move, tap: tap,
      slotTap: function (pile) { if (pile === 'stock') tap(pile); }
    });
    session = Z.createSession({
      id: 'pyramid', board: board, newGame: newGame, els: el,
      statText: function (sec, st) { paintSub(); return Z.fmtTime(sec) + ' · ' + st.score; },
      cascadeOrder: function (st) { return st.piles.out.slice().reverse().map(function (id) { return { id: id }; }); },
      winLines: function (sec, st) { return ['Score ' + st.score + ' (clear bonus ' + (SCORE.clear + SCORE.redealLeft * (MAX_REDEALS - st.redeals)) + ')', 'Time ' + Z.fmtTime(sec) + ', ' + Z.plural(st.moves, 'move')]; },
      openMenu: function () {
        Z.sheet({
          title: 'Pyramid',
          body: [
            Z.h('p', { class: 'zc-note', text: 'Take two free cards that add up to 13, or a free king alone. Ace is 1, jack 11, queen 12. Tap one card, then its partner. Cards you can take are bright; covered ones are dim.' }),
            Z.backsRow(),
            Z.h('p', { class: 'zc-stats', text: session.stats.line() })
          ],
          actions: [{ label: 'New game', onclick: newGame }, { label: 'Done', primary: true }]
        });
      }
    });
    api.session = session; api.board = board;
    newGame();
    if (/[?&]debug=win/.test(root.location.search)) { session.reset(almostWon()); paintSub(); }
  }

  if (root.document && root.document.getElementById('zc-table')) boot();
})(typeof globalThis !== 'undefined' ? globalThis : window);
