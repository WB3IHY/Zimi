/* ZimiGames: FreeCell. The numbered deals are the Microsoft ones (see
   ZimiCards.msDeal), so deal #617 here is deal #617 on the machine you
   remember. Rules are pure functions on a plain state; the page wiring at the
   bottom only runs in a browser.

   State: piles { c0..c7 columns, fr0..fr3 free cells (0 or 1 card),
   fd0..fd3 foundations }, each a list of card ids (the last is the top),
   plus the deal number and a move count. */
(function (root) {
  'use strict';
  var Z = root.ZimiCards;

  var COLUMNS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];
  var CELLS = ['fr0', 'fr1', 'fr2', 'fr3'];
  var FOUNDATION = ['fd0', 'fd1', 'fd2', 'fd3'];
  var MAX_DEAL = 1000000, RANDOM_DEAL_MAX = 32000, UNWINNABLE_DEAL = 11982;
  var COLS = 8, AUTO_KEY = 'freecell.auto';

  var kind = function (p) { return p.charAt(0) === 'c' ? 'column' : p.charAt(1) === 'r' ? 'cell' : 'foundation'; };
  var top = function (pile) { return pile[pile.length - 1]; };

  // ── Rules ───────────────────────────────────────────────────────────────
  function newState(dealNo) {
    var piles = {}, cards = Z.msDeal(dealNo);
    COLUMNS.concat(CELLS, FOUNDATION).forEach(function (p) { piles[p] = []; });
    cards.forEach(function (id, i) { piles[COLUMNS[i % COLS]].push(id); });
    return { piles: piles, deal: dealNo, moves: 0 };
  }

  // The classic limit: (free cells + 1) * 2^(empty columns), where a column
  // you are moving into does not count as one of the empties.
  function maxMovable(freeCells, emptyColumns, toEmptyColumn) {
    return (freeCells + 1) * Math.pow(2, emptyColumns - (toEmptyColumn ? 1 : 0));
  }
  function capacity(state, to) {
    var P = state.piles;
    var free = CELLS.filter(function (c) { return !P[c].length; }).length;
    var empty = COLUMNS.filter(function (c) { return !P[c].length; }).length;
    return maxMovable(free, empty, !P[to].length);
  }

  function canPick(state, pile, idx) {
    var p = state.piles[pile], k = kind(pile);
    if (idx < 0 || idx >= p.length) return false;
    if (k === 'foundation') return false;
    if (k === 'cell') return idx === 0;
    return Z.isRun(p.slice(idx));
  }

  function legalMove(state, from, idx, to) {
    if (from === to || !canPick(state, from, idx)) return false;
    var P = state.piles, moving = P[from].slice(idx), first = moving[0], k = kind(to);
    if (k === 'cell') return moving.length === 1 && !P[to].length;
    if (k === 'foundation') return moving.length === 1 && Z.foundationAccepts(first, P[to].length ? top(P[to]) : null, P[to].length);
    if (P[to].length && !Z.stacksOn(top(P[to]), first)) return false;
    return moving.length <= capacity(state, to);
  }

  function applyMove(state, from, idx, to) {
    var s = Z.clone(state);
    s.piles[to] = s.piles[to].concat(s.piles[from].splice(idx));
    s.moves++;
    return s;
  }

  // Where a tap sends a card: a foundation, then a column with cards on it,
  // then an empty column (not to move a column's own bottom card), then a
  // free cell (not from one).
  function bestMove(state, from, idx) {
    if (!canPick(state, from, idx)) return null;
    var P = state.piles, targets = [], single = P[from].length - idx === 1;
    if (single) targets = targets.concat(FOUNDATION);
    targets = targets.concat(COLUMNS.filter(function (c) { return P[c].length; }));
    if (!(kind(from) === 'column' && idx === 0)) targets = targets.concat(COLUMNS.filter(function (c) { return !P[c].length; }));
    if (single && kind(from) !== 'cell') targets = targets.concat(CELLS);
    for (var i = 0; i < targets.length; i++) if (legalMove(state, from, idx, targets[i])) return targets[i];
    return null;
  }

  // A card is safe to send up when nothing left in play could still want it
  // as a place to land: an ace or deuce, or both opposite-coloured suits are
  // already within one rank of it.
  function foundationRank(state, suit) {
    for (var i = 0; i < FOUNDATION.length; i++) {
      var p = state.piles[FOUNDATION[i]];
      if (p.length && Z.suit(top(p)) === suit) return p.length;
    }
    return 0;
  }
  function isSafe(state, id) {
    var r = Z.rank(id);
    if (r <= 2) return true;
    var opposite = Z.isRed(id) ? [0, 3] : [1, 2];
    return opposite.every(function (s) { return foundationRank(state, s) >= r - 1; });
  }
  function safeAutoMove(state) {
    var sources = CELLS.concat(COLUMNS), i, j, p;
    for (i = 0; i < sources.length; i++) {
      p = state.piles[sources[i]];
      if (!p.length || !isSafe(state, top(p))) continue;
      for (j = 0; j < FOUNDATION.length; j++) if (legalMove(state, sources[i], p.length - 1, FOUNDATION[j])) return { from: sources[i], idx: p.length - 1, to: FOUNDATION[j] };
    }
    return null;
  }

  function isWon(state) {
    return FOUNDATION.every(function (f) { return state.piles[f].length === Z.KING; });
  }
  // For the debug hook: one move from a win (the king of spades is the last card).
  function almostWon() {
    var s = newState(1);
    COLUMNS.concat(CELLS, FOUNDATION).forEach(function (p) { s.piles[p] = []; });
    for (var suit = 0; suit < 4; suit++) {
      for (var r = 1; r <= Z.KING; r++) {
        if (suit === 3 && r === Z.KING) s.piles.c0.push(Z.make(r, suit)); else s.piles['fd' + suit].push(Z.make(r, suit));
      }
    }
    return s;
  }

  // ── Layout ──────────────────────────────────────────────────────────────
  var UP_STEP_SHARE = 0.3, MIN_STEP_SHARE = 0.12, ROW_GAP_SHARE = 0.2;

  function place(state, m) {
    var P = state.piles, cw = m.cw, ch = m.ch, x = function (col) { return m.left + col * m.step; };
    var y1 = m.pad, y2 = y1 + ch + Math.round(ch * ROW_GAP_SHARE), slots = [], cards = [];
    var room = m.H - y2 - m.pad;
    var step = Z.fanStep(Math.max.apply(null, COLUMNS.map(function (c) { return P[c].length - 1; })), room, ch, ch * UP_STEP_SHARE, ch * MIN_STEP_SHARE);
    var bottom = y2 + ch;

    CELLS.forEach(function (c, n) {
      P[c].forEach(function (id, i) { cards.push({ id: id, pile: c, idx: i, x: x(n), y: y1, up: true }); });
    });
    FOUNDATION.forEach(function (f, n) {
      P[f].forEach(function (id, i) { cards.push({ id: id, pile: f, idx: i, x: x(COLS / 2 + n), y: y1, up: true, hidden: i < P[f].length - 2 }); });
    });
    COLUMNS.forEach(function (c, n) {
      P[c].forEach(function (id, i) { cards.push({ id: id, pile: c, idx: i, x: x(n), y: y2 + i * step, up: true }); });
      bottom = Math.max(bottom, y2 + Math.max(0, P[c].length - 1) * step + ch);
    });
    var height = bottom + m.pad;

    CELLS.forEach(function (c, n) {
      slots.push({ id: c, x: x(n), y: y1, w: cw, h: ch, label: P[c].length ? 'Free cell ' + (n + 1) + ', ' + Z.cardName(P[c][0]) : 'Free cell ' + (n + 1) + ', empty' });
    });
    FOUNDATION.forEach(function (f, n) {
      var t = P[f].length ? top(P[f]) : null;
      slots.push({ id: f, x: x(COLS / 2 + n), y: y1, w: cw, h: ch, mark: t === null ? 'A' : '', label: t === null ? 'Foundation, empty' : 'Foundation, ' + Z.SUITS[Z.suit(t)] + ', ' + P[f].length + (P[f].length === 1 ? ' card' : ' cards') });
    });
    COLUMNS.forEach(function (c, n) {
      slots.push({ id: c, x: x(n), y: y2, w: cw, h: Math.max(ch, height - y2), label: Z.describePile('Column ' + (n + 1), P[c], true) });
    });
    return { height: height, slots: slots, cards: cards };
  }

  var api = {
    COLUMNS: COLUMNS, CELLS: CELLS, FOUNDATION: FOUNDATION,
    newState: newState, maxMovable: maxMovable, canPick: canPick, legalMove: legalMove, applyMove: applyMove,
    bestMove: bestMove, safeAutoMove: safeAutoMove, isWon: isWon, almostWon: almostWon, place: place
  };
  root.ZimiFreeCell = api;

  // ── The page ────────────────────────────────────────────────────────────
  var AUTO_STEP_MS = 140;
  function boot() {
    var d = root.document, board, session, autoOn = Z.store.get(AUTO_KEY, true) !== false;
    Z.ensureSprite();
    var sub = d.getElementById('zc-sub'), params = new root.URLSearchParams(root.location.search);
    var dealNo = Math.min(MAX_DEAL, Math.max(1, parseInt(params.get('deal'), 10) || 0)) || 1 + Math.floor(Math.random() * RANDOM_DEAL_MAX);

    function startDeal(n) {
      dealNo = n;
      sub.textContent = 'Deal #' + n + (n === UNWINNABLE_DEAL ? ' · no winning line' : '');
      session.reset(newState(n));
    }
    function randomDeal() { startDeal(1 + Math.floor(Math.random() * RANDOM_DEAL_MAX)); }
    function autoRun() {
      if (!autoOn) return;
      session.later(function () {
        var step = safeAutoMove(session.state);
        if (!step) return;
        session.follow(applyMove(session.state, step.from, step.idx, step.to));
        if (isWon(session.state)) session.win(); else autoRun();
      }, AUTO_STEP_MS);
    }
    function move(pile, idx, to) {
      if (!legalMove(session.state, pile, idx, to)) return false;
      session.commit(applyMove(session.state, pile, idx, to));
      if (isWon(session.state)) session.win(); else autoRun();
      return true;
    }

    board = Z.createBoard({
      table: d.getElementById('zc-table'), cols: COLS, place: place,
      canPick: canPick, move: move,
      tap: function (pile, idx) { var to = bestMove(session.state, pile, idx); return to ? move(pile, idx, to) : false; }
    });
    session = Z.createSession({
      id: 'freecell', board: board, newGame: randomDeal,
      els: { undo: d.getElementById('zc-undo'), newBtn: d.getElementById('zc-new'), menu: d.getElementById('zc-menu'), stat: d.getElementById('zc-stat') },
      statText: function (sec, st) { return Z.fmtTime(sec) + ' · ' + st.moves; },
      cascadeOrder: function (st) {
        var order = [], r;
        for (r = Z.KING; r >= 1; r--) FOUNDATION.forEach(function (f) { order.push({ id: st.piles[f][r - 1] }); });
        return order;
      },
      winLines: function (sec, st) { return ['Deal #' + st.deal + ' in ' + Z.fmtTime(sec) + ', ' + st.moves + ' moves']; },
      openMenu: function () {
        var input = Z.h('input', { class: 'zc-input', type: 'number', min: '1', max: String(MAX_DEAL), inputmode: 'numeric', 'aria-label': 'Deal number', value: String(dealNo) });
        var note = Z.h('p', { class: 'zc-note', text: 'The classic deals are 1 to 32000.' });
        var sheet;
        var play = function () {
          var n = parseInt(input.value, 10);
          if (!(n >= 1 && n <= MAX_DEAL)) { note.textContent = 'Pick a number from 1 to ' + MAX_DEAL + '.'; return; }
          sheet.close(); startDeal(n);
        };
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); play(); } });
        var autoPick = Z.segmented([{ label: 'On', value: true }, { label: 'Off', value: false }], autoOn, function (v) { autoOn = v; Z.store.set(AUTO_KEY, v); });
        sheet = Z.sheet({
          title: 'FreeCell',
          body: [
            Z.h('div', { class: 'zc-row' }, [Z.h('label', { text: 'Deal number' }), input, Z.h('button', { class: 'ar-btn', type: 'button', text: 'Play', onclick: play })]),
            note,
            Z.h('div', { class: 'zc-row' }, [Z.h('label', { text: 'Safe cards go up by themselves' }), autoPick]),
            Z.backsRow(),
            Z.h('p', { class: 'zc-stats', text: session.stats.line() })
          ],
          actions: [{ label: 'Restart deal', onclick: function () { startDeal(dealNo); } }, { label: 'Random deal', onclick: randomDeal }, { label: 'Done', primary: true }]
        });
      }
    });

    api.session = session; api.board = board;
    startDeal(dealNo);
    if (/[?&]debug=win/.test(root.location.search)) session.reset(almostWon());
  }

  if (root.document && root.document.getElementById('zc-table')) boot();
})(typeof globalThis !== 'undefined' ? globalThis : window);
