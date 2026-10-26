/* ZimiGames: Golf. Seven columns of five, all face up. Play the bottom
   card of a column onto the waste when it is one rank higher or lower; kings
   and aces do not wrap. The stock turns one card at a time onto the waste.
   Like the game it is named for, the score is what is left: fewer cards in
   the columns is better, and a clear is a win.

   State: piles { stock, waste, c0..c6 }, each a list of card ids (the last
   is the top), plus moves. Rules are pure functions; the page wiring at the
   bottom only runs in a browser. */
(function (root) {
  'use strict';
  var Z = root.ZimiCards, TX = root.ZimiCards.T;

  var COLUMNS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
  var COLS = 7, DEPTH = 5, TABLEAU_CARDS = COLS * DEPTH;
  var top = function (pile) { return pile[pile.length - 1]; };

  // ── Rules ───────────────────────────────────────────────────────────────
  function newState(order) {
    var piles = { stock: [], waste: [] }, k = 0;
    COLUMNS.forEach(function (c) { piles[c] = order.slice(k, k + DEPTH); k += DEPTH; });
    piles.stock = order.slice(k);
    piles.waste.push(piles.stock.pop());
    return { piles: piles, moves: 0 };
  }

  // One rank up or down from the waste's top card. No wrap: a king never goes
  // on an ace, nor the ace on a king.
  function fits(id, wasteTop) { return wasteTop !== undefined && Math.abs(Z.rank(id) - Z.rank(wasteTop)) === 1; }

  function canPick(state, pile, idx) {
    var p = state.piles[pile];
    return pile.charAt(0) === 'c' && idx === p.length - 1 && idx >= 0;
  }
  function legalMove(state, from, idx, to) {
    return to === 'waste' && canPick(state, from, idx) && fits(state.piles[from][idx], top(state.piles.waste));
  }
  function applyMove(state, from, idx, to) {
    var s = Z.clone(state);
    s.piles[to].push(s.piles[from].pop());
    s.moves++;
    return s;
  }
  function drawStock(state) {
    if (!state.piles.stock.length) return null;
    var s = Z.clone(state);
    s.piles.waste.push(s.piles.stock.pop());
    s.moves++;
    return s;
  }
  function bestMove(state, from, idx) { return legalMove(state, from, idx, 'waste') ? 'waste' : null; }

  function left(state) { return COLUMNS.reduce(function (n, c) { return n + state.piles[c].length; }, 0); }
  function isWon(state) { return left(state) === 0; }
  function playable(state) { return COLUMNS.some(function (c) { return state.piles[c].length && fits(top(state.piles[c]), top(state.piles.waste)); }); }
  // Nothing on the stock and nothing the waste will take: the round is over.
  function isStuck(state) { return !isWon(state) && !state.piles.stock.length && !playable(state); }

  // For the debug hook: one card left, and it fits.
  function almostWon() {
    var s = newState(Z.shuffled(function () { return 0.3; }));
    COLUMNS.forEach(function (c) { s.piles[c] = []; });
    s.piles.stock = [];
    s.piles.waste = [Z.make(6, 0)];
    s.piles.c3 = [Z.make(7, 1)];
    return s;
  }

  // ── Layout ──────────────────────────────────────────────────────────────
  var UP_STEP_SHARE = 0.62, MIN_STEP_SHARE = 0.16, ROW_GAP_SHARE = 0.35, HEIGHT_SHARE = 0.19;

  function place(state, m) {
    var P = state.piles, cw = m.cw, ch = m.ch, x = function (col) { return m.left + col * m.step; };
    // The columns start under the bar and fan as far as the room allows; stock and waste sit in the bottom row, under the thumb.
    var gap = Math.round(ch * ROW_GAP_SHARE), y1 = m.pad, natural = y1 + ch * (1 + (DEPTH - 1) * UP_STEP_SHARE) + gap;
    var y2 = Math.max(m.H - m.pad - ch, natural);
    var step = Z.fanStep(DEPTH - 1, y2 - y1 - gap, ch, ch * UP_STEP_SHARE, ch * MIN_STEP_SHARE);
    var slots = [], cards = [], height = y2 + ch + m.pad;

    COLUMNS.forEach(function (c, n) {
      P[c].forEach(function (id, i) { cards.push({ id: id, pile: c, idx: i, x: x(n), y: y1 + i * step, up: true }); });
    });
    P.stock.forEach(function (id, i) { cards.push({ id: id, pile: 'stock', idx: i, x: x(2), y: y2, up: false, hidden: i < P.stock.length - 2 }); });
    P.waste.forEach(function (id, i) { cards.push({ id: id, pile: 'waste', idx: i, x: x(3), y: y2, up: true, hidden: i < P.waste.length - 2 }); });

    COLUMNS.forEach(function (c, n) {
      slots.push({ id: c, x: x(n), y: y1, w: cw, h: Math.max(ch, DEPTH * step), label: Z.describePile(TX('fc.column', { n: n + 1 }), P[c], true) });
    });
    slots.push({ id: 'stock', x: x(2), y: y2, w: cw, h: ch, mark: P.stock.length ? '' : '∅', label: Z.describePile(TX('sol.stock'), P.stock, false) + (P.stock.length ? TX('pyr.enterTurn') : '') });
    slots.push({ id: 'waste', x: x(3), y: y2, w: cw, h: ch, label: Z.describePile(TX('sol.waste'), P.waste, true) });
    return { height: height, slots: slots, cards: cards };
  }

  var api = {
    COLUMNS: COLUMNS, TABLEAU_CARDS: TABLEAU_CARDS,
    newState: newState, fits: fits, canPick: canPick, legalMove: legalMove, applyMove: applyMove, drawStock: drawStock,
    bestMove: bestMove, left: left, isWon: isWon, isStuck: isStuck, almostWon: almostWon, place: place
  };
  root.ZimiGolf = api;

  // ── The page ────────────────────────────────────────────────────────────
  function boot() {
    var el = Z.pageEls(), board, session;
    Z.ensureSprite();

    function afterMove() {
      var st = session.state;
      if (isWon(st)) { session.win(0); return; }
      if (isStuck(st)) {
        el.sub.textContent = TX('cards.noMoves');
        session.stats.scored(left(st));
        Z.sheet({
          title: TX('golf.outOfMoves'),
          body: [Z.h('p', { class: 'zc-note', text: TX('golf.left', { n: left(st) }) }), Z.h('p', { class: 'zc-stats', text: session.stats.line() })],
          actions: [{ label: TX('shell.undo'), onclick: session.undo }, { label: TX('shell.menu.new'), primary: true, onclick: newGame }]
        });
      } else el.sub.textContent = '';
    }
    function move(pile, idx, to) {
      if (!legalMove(session.state, pile, idx, to)) return false;
      session.commit(applyMove(session.state, pile, idx, to));
      afterMove();
      return true;
    }
    function draw() {
      var next = drawStock(session.state);
      if (!next) return false;
      session.commit(next);
      afterMove();
      return true;
    }
    function newGame() { el.sub.textContent = ''; session.reset(newState(Z.shuffled(Math.random))); }

    board = Z.createBoard({
      table: el.table, cols: COLS, place: place, heightShare: HEIGHT_SHARE, enterTaps: true,
      canPick: canPick, move: move,
      tap: function (pile, idx) {
        if (pile === 'stock') return draw();
        var to = bestMove(session.state, pile, idx);
        return to ? move(pile, idx, to) : false;
      },
      slotTap: function (pile) { if (pile === 'stock') draw(); }
    });
    session = Z.createSession({
      id: 'golf', lowScore: true, board: board, newGame: newGame,
      els: el,
      statText: function (sec, st) { el.sub.textContent = isStuck(st) ? TX('cards.noMoves') : ''; return Z.fmtTime(sec) + ' · ' + TX('golf.leftShort', { n: left(st) }); },
      cascadeOrder: function (st) { return st.piles.waste.slice().reverse().map(function (id) { return { id: id }; }); },
      winLines: function (sec, st) { return [TX('golf.win', { time: Z.fmtTime(sec), moves: Z.plural(st.moves, 'move'), stock: st.piles.stock.length })]; },
      openMenu: function () {
        Z.sheet({
          title: 'Golf',
          body: [
            Z.h('p', { class: 'zc-note', text: TX('golf.rules') }),
            Z.backsRow(),
            Z.h('p', { class: 'zc-stats', text: session.stats.line() })
          ],
          actions: [{ label: TX('shell.menu.new'), onclick: newGame }, { label: TX('shell.close'), primary: true }]
        });
      }
    });
    api.session = session; api.board = board;
    newGame();
    if (/[?&]debug=win/.test(root.location.search)) session.reset(almostWon());
  }

  if (root.document && root.document.getElementById('zc-table')) boot();
})(typeof globalThis !== 'undefined' ? globalThis : window);
