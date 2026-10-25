/* ZimiGames: TriPeaks. Three peaks of cards, 28 in all. Play a free card
   onto the waste when it is one rank above or below the waste's top card;
   kings and aces wrap round. A card is free when the two cards that overlap
   it are gone, and it turns face up when it becomes free. Each card played
   in a row (a streak) is worth more than the last; turning the stock breaks
   the streak.

   State: piles { 'k<row>_<i>' (0 or 1 card each), stock, waste }, plus the
   streak, score, moves. Whether a tableau card is face up is not stored: it
   is up exactly when it is free. Rules are pure functions; the page wiring at
   the bottom only runs in a browser. */
(function (root) {
  'use strict';
  var Z = root.ZimiCards;

  var SCORE = { perStreak: 5, peak: 30, stockLeft: 10 };
  var TABLEAU_CARDS = 28;
  // Each row's cards by horizontal position, in card widths from the left of
  // the bottom row. A card is overlapped by the row below's cards half a card
  // to either side of it.
  var ROW_X = [[1.5, 4.5, 7.5], [1, 2, 4, 5, 7, 8], [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]];
  var BOARD_WIDTH_CARDS = 10;
  var top = function (pile) { return pile[pile.length - 1]; };
  var pid = function (r, i) { return 'k' + r + '_' + i; };
  var rowOf = function (p) { return parseInt(p.slice(1), 10); };
  var idxOf = function (p) { return parseInt(p.split('_')[1], 10); };
  var TABLEAU = [];
  ROW_X.forEach(function (xs, r) { xs.forEach(function (x, i) { TABLEAU.push(pid(r, i)); }); });
  var isTableau = function (p) { return p.charAt(0) === 'k'; };

  // The piles that overlap a tableau card (none for the bottom row).
  var COVERS = {};
  TABLEAU.forEach(function (p) {
    var r = rowOf(p), x = ROW_X[r][idxOf(p)], out = [];
    if (r < 3) ROW_X[r + 1].forEach(function (cx, i) { if (Math.abs(cx - x) === 0.5) out.push(pid(r + 1, i)); });
    COVERS[p] = out;
  });
  var PEAK_TOPS = ['k0_0', 'k0_1', 'k0_2'];

  // ── Rules ───────────────────────────────────────────────────────────────
  function newState(order) {
    var piles = { stock: [], waste: [] }, k = 0;
    TABLEAU.forEach(function (p) { piles[p] = [order[k++]]; });
    piles.stock = order.slice(k);
    piles.waste.push(piles.stock.pop());
    return { piles: piles, streak: 0, score: 0, moves: 0 };
  }

  function isFree(state, pile) {
    var P = state.piles;
    return isTableau(pile) && P[pile].length > 0 && COVERS[pile].every(function (c) { return !P[c].length; });
  }
  // One rank up or down; a king and an ace are neighbours both ways.
  function fits(id, wasteTop) {
    if (wasteTop === undefined) return false;
    var d = Math.abs(Z.rank(id) - Z.rank(wasteTop));
    return d === 1 || d === Z.KING - 1;
  }
  function canPick(state, pile) { return isFree(state, pile); }
  function legalMove(state, from, idx, to) {
    return to === 'waste' && isFree(state, from) && fits(top(state.piles[from]), top(state.piles.waste));
  }
  function tableauLeft(state) { return TABLEAU.filter(function (p) { return state.piles[p].length; }).length; }
  function isWon(state) { return tableauLeft(state) === 0; }

  function applyMove(state, from, idx, to) {
    var s = Z.clone(state);
    s.piles.waste.push(s.piles[from].pop());
    s.streak++; s.moves++;
    s.score += SCORE.perStreak * s.streak;
    if (PEAK_TOPS.indexOf(from) >= 0) s.score += SCORE.peak;
    if (isWon(s)) s.score += SCORE.stockLeft * s.piles.stock.length;
    return s;
  }
  function drawStock(state) {
    if (!state.piles.stock.length) return null;
    var s = Z.clone(state);
    s.piles.waste.push(s.piles.stock.pop());
    s.streak = 0; s.moves++;
    return s;
  }
  function bestMove(state, from, idx) { return legalMove(state, from, idx, 'waste') ? 'waste' : null; }
  function peaksCleared(state) { return PEAK_TOPS.filter(function (p) { return !state.piles[p].length; }).length; }
  function isStuck(state) {
    return !isWon(state) && !state.piles.stock.length && !TABLEAU.some(function (p) { return legalMove(state, p, 0, 'waste'); });
  }

  // For the debug hook: one card left, and it fits.
  function almostWon() {
    var s = newState(Z.shuffled(function () { return 0.3; }));
    TABLEAU.forEach(function (p) { s.piles[p] = []; });
    s.piles.stock = [Z.make(2, 1), Z.make(9, 2)];
    s.piles.waste = [Z.make(Z.KING, 0)];
    s.piles.k3_4 = [Z.make(1, 3)];
    s.streak = 12;
    return s;
  }

  // ── Layout ──────────────────────────────────────────────────────────────
  var ROW_STEP_SHARE = 0.56, ROW_GAP_SHARE = 0.5, HEIGHT_SHARE = 0.17, FIT_COLS = 8.5;

  function place(state, m) {
    var P = state.piles, cw = m.cw, ch = m.ch, rowStep = ch * ROW_STEP_SHARE;
    var unit = (m.W - 2 * m.pad - cw) / (BOARD_WIDTH_CARDS - 1), x0 = Math.floor((m.W - (unit * (BOARD_WIDTH_CARDS - 1) + cw)) / 2);
    var block = rowStep * 3 + ch * 2 + Math.round(ch * ROW_GAP_SHARE), y1 = m.pad + Z.restShare(m.H - block - 2 * m.pad);
    var y2 = y1 + rowStep * 3 + ch + Math.round(ch * ROW_GAP_SHARE), slots = [], cards = [], height = y2 + ch + m.pad;
    var mid = m.W / 2, sx = Math.round(mid - cw - m.gap / 2), wx = Math.round(mid + m.gap / 2);

    TABLEAU.forEach(function (p) {
      if (!P[p].length) return;
      var r = rowOf(p), i = idxOf(p), px = x0 + ROW_X[r][i] * unit, py = y1 + r * rowStep, free = isFree(state, p);
      cards.push({ id: P[p][0], pile: p, idx: 0, x: px, y: py, up: free });
      slots.push({ id: p, x: px, y: py, w: cw, h: ch, label: free ? 'Row ' + (r + 1) + ', ' + Z.cardName(P[p][0]) : 'Row ' + (r + 1) + ', face down, covered' });
    });
    P.stock.forEach(function (id, i) { cards.push({ id: id, pile: 'stock', idx: i, x: sx, y: y2, up: false, hidden: i < P.stock.length - 2 }); });
    P.waste.forEach(function (id, i) { cards.push({ id: id, pile: 'waste', idx: i, x: wx, y: y2, up: true, hidden: i < P.waste.length - 2 }); });
    slots.push({ id: 'stock', x: sx, y: y2, w: cw, h: ch, mark: P.stock.length ? '' : '∅', label: Z.describePile('Stock', P.stock, false) + (P.stock.length ? ', Enter to turn a card' : '') });
    slots.push({ id: 'waste', x: wx, y: y2, w: cw, h: ch, label: Z.describePile('Waste', P.waste, true) });
    return { height: height, slots: slots, cards: cards };
  }

  var api = {
    TABLEAU: TABLEAU, COVERS: COVERS, ROW_X: ROW_X, PEAK_TOPS: PEAK_TOPS, SCORE: SCORE, TABLEAU_CARDS: TABLEAU_CARDS,
    newState: newState, isFree: isFree, fits: fits, canPick: canPick, legalMove: legalMove, applyMove: applyMove, drawStock: drawStock,
    bestMove: bestMove, tableauLeft: tableauLeft, peaksCleared: peaksCleared, isWon: isWon, isStuck: isStuck, almostWon: almostWon, place: place
  };
  root.ZimiTriPeaks = api;

  // ── The page ────────────────────────────────────────────────────────────
  function boot() {
    var el = Z.pageEls(), board, session;
    Z.ensureSprite();

    function afterMove() {
      var st = session.state;
      if (isWon(st)) { session.win(st.score); return; }
      if (isStuck(st)) {
        session.stats.scored(st.score);
        Z.sheet({
          title: 'No moves left',
          body: [Z.h('p', { class: 'zc-note', text: tableauLeft(st) + ' cards left on the peaks, score ' + st.score + '.' }), Z.h('p', { class: 'zc-stats', text: session.stats.line() })],
          actions: [{ label: 'Undo', onclick: session.undo }, { label: 'New game', primary: true, onclick: newGame }]
        });
      }
    }
    function commit(next) { session.commit(next); afterMove(); return true; }
    function move(pile, idx, to) {
      if (!legalMove(session.state, pile, idx, to)) return false;
      return commit(applyMove(session.state, pile, idx, to));
    }
    function newGame() { session.reset(newState(Z.shuffled(Math.random))); }

    board = Z.createBoard({
      table: el.table, cols: FIT_COLS, heightShare: HEIGHT_SHARE, enterTaps: true, place: place,
      canPick: canPick, move: move,
      tap: function (pile, idx) {
        if (pile === 'stock') { var next = drawStock(session.state); return next ? commit(next) : false; }
        var to = bestMove(session.state, pile, idx);
        return to ? move(pile, idx, to) : false;
      },
      slotTap: function (pile) { if (pile === 'stock') { var next = drawStock(session.state); if (next) commit(next); } }
    });
    session = Z.createSession({
      id: 'tripeaks', board: board, newGame: newGame, els: el,
      statText: function (sec, st) {
        el.sub.textContent = isStuck(st) ? 'No moves left' : st.streak > 1 ? 'Streak ' + st.streak : '';
        return Z.fmtTime(sec) + ' · ' + st.score;
      },
      cascadeOrder: function (st) { return st.piles.waste.slice().reverse().map(function (id) { return { id: id }; }); },
      winLines: function (sec, st) { return ['Score ' + st.score + ' (' + st.piles.stock.length + ' cards left in the stock, ' + SCORE.stockLeft + ' each)', 'Time ' + Z.fmtTime(sec) + ', ' + Z.plural(st.moves, 'move')]; },
      openMenu: function () {
        Z.sheet({
          title: 'TriPeaks',
          body: [
            Z.h('p', { class: 'zc-note', text: 'Play a free card onto the waste when it is one rank higher or lower. Kings and aces wrap. A card is free when nothing overlaps it; it turns face up then. Each card in a streak scores ' + SCORE.perStreak + ' times its place in the streak, and a cleared peak adds ' + SCORE.peak + '.' }),
            Z.backsRow(),
            Z.h('p', { class: 'zc-stats', text: session.stats.line() })
          ],
          actions: [{ label: 'New game', onclick: newGame }, { label: 'Done', primary: true }]
        });
      }
    });
    api.session = session; api.board = board;
    newGame();
    if (/[?&]debug=win/.test(root.location.search)) session.reset(almostWon());
  }

  if (root.document && root.document.getElementById('zc-table')) boot();
})(typeof globalThis !== 'undefined' ? globalThis : window);
