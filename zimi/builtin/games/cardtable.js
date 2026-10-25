/* ZimiGames: the table the world's card games share (Spades, Euchre, Gin
   Rummy, Cribbage, Crazy Eights, Durak, Scopa). You sit south; the computer
   players sit west, north and east. This file lays out hands and fans, keeps
   the score chips, the status line and the choice buttons over the felt, and
   wires a board and a session around a game's rules. A game supplies pure
   rules plus `place`, `hud` and a few handlers; nothing here knows Spades
   from Durak. Pure helpers (geometry, sorting) are tested in node. */
(function (root) {
  'use strict';
  var Z = root.ZimiCards;

  var SCORE_BAR_H = 26, STATUS_H = 46, RAISE_SHARE = 0.3, SUIT_GAP_SHARE = 0.18, HAND_STEP_SHARE = 0.78;
  var SIDE_STEP_MIN = 0.07, SIDE_STEP_MAX = 0.2, TOP_STEP_SHARE = 0.3, SIDE_OFFSET_CARDS = 3.4, TRICK_DX = 0.72, TRICK_DY = 0.62;
  var MIN_STEP_SHARE = 0.42, ROW_STEP_SHARE = 0.5, FLASH_MS = 1800, PANEL_GAP = 8;
  // Where each seat sits on the table, by the number of players: 0 south, 1 west, 2 north, 3 east.
  var SEAT_POS = { 2: [0, 2], 3: [0, 1, 3], 4: [0, 1, 2, 3] };
  var SUIT_ORDER = [0, 1, 3, 2]; // clubs, diamonds, spades, hearts: alternating colours in a hand
  var SUIT_GLYPH = ['♣', '♦', '♥', '♠']; // by ZimiCards suit: clubs, diamonds, hearts, spades

  // ── Pure helpers ────────────────────────────────────────────────────────
  var next = function (seat, n) { return (seat + 1) % n; };
  // Sorted for the hand: suits alternate colour, `high(id)` orders within a suit.
  function sortHand(ids, high) {
    return ids.slice().sort(function (a, b) { return SUIT_ORDER.indexOf(Z.suit(a)) - SUIT_ORDER.indexOf(Z.suit(b)) || high(a) - high(b) || a - b; });
  }
  var rankHigh = function (id) { return Z.rank(id) === 1 ? 14 : Z.rank(id); };
  var short = function (id) { return Z.RANK_LABELS[Z.rank(id) - 1] + SUIT_GLYPH[Z.suit(id)]; };
  var shortList = function (ids) { return ids.map(short).join(' '); };
  // The deck as a shuffled list of the ids in `ids`.
  function shuffleOf(ids, rng) {
    var a = ids.slice(), i, j, t;
    for (i = a.length - 1; i > 0; i--) { j = Math.floor(rng() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function countBy(list, f) { return list.reduce(function (n, x) { return n + (f(x) ? 1 : 0); }, 0); }
  function maxBy(list, f) { return list.reduce(function (b, c) { return b === null || f(c) > f(b) ? c : b; }, null); }
  function minBy(list, f) { return maxBy(list, function (c) { return -f(c); }); }

  // Where everything sits on a table of this size. `rows` is how many rows
  // your hand takes (a long hand wraps).
  function geometry(m, rows) {
    var cw = m.cw, ch = m.ch, cx = m.W / 2, g = { cw: cw, ch: ch, cx: cx, rows: rows || 1 };
    g.raise = Math.round(ch * RAISE_SHARE);
    g.rowStep = Math.round(ch * ROW_STEP_SHARE);
    g.northY = m.pad + SCORE_BAR_H;
    g.southY = m.H - ch - m.pad - (g.rows - 1) * g.rowStep;
    g.yTop = g.northY + ch + 8;
    g.yBot = g.southY - g.raise - 6;
    g.statusY = g.yBot - STATUS_H;
    g.cy = (g.yTop + g.statusY) / 2;
    g.westX = Math.max(m.pad, Math.round(cx - SIDE_OFFSET_CARDS * cw));
    g.eastX = Math.min(m.W - m.pad - cw, Math.round(cx + (SIDE_OFFSET_CARDS - 1) * cw));
    g.topStep = cw * TOP_STEP_SHARE;
    g.pad = m.pad; g.W = m.W; g.H = m.H;
    return g;
  }
  // How many rows a hand of n cards takes on this table.
  function rowsFor(m, n) {
    var perRow = Math.max(1, Math.floor((m.W - 2 * m.pad - m.cw) / (m.cw * MIN_STEP_SHARE)) + 1);
    return Math.max(1, Math.ceil(n / perRow));
  }
  function sideStep(g, n) { return Math.max(g.ch * SIDE_STEP_MIN, Math.min(g.ch * SIDE_STEP_MAX, (g.statusY - g.yTop - g.ch) / Math.max(1, n - 1))); }
  // A card's corner in the middle for each position's play, and where a position's cards sit.
  function trickSpot(g, pos) {
    var x = g.cx - g.cw / 2, y = g.cy - g.ch / 2;
    return [{ x: x, y: y + g.ch * TRICK_DY }, { x: x - g.cw * TRICK_DX, y: y }, { x: x, y: y - g.ch * TRICK_DY }, { x: x + g.cw * TRICK_DX, y: y }][pos];
  }
  function seatSpot(g, pos) {
    return [{ x: g.cx - g.cw / 2, y: g.southY }, { x: g.westX, y: g.yTop }, { x: g.cx - g.cw / 2, y: g.northY }, { x: g.eastX, y: g.yTop }][pos];
  }
  function posOf(seat, players) { return SEAT_POS[players][seat]; }
  // Where a seat sits for the person looking (a ZimiSeats object): the viewer is south.
  function posFor(seats, seat, players) { return SEAT_POS[players][seats.rel(seat)]; }

  // Your hand: `ids` left to right (wrapping into rows when it would be too
  // tight). `gapAfter(prevId, id)` adds a little space (between suits).
  // `info(id, k)` -> { label, up, dim, mark, glow, y }. Returns cards and
  // slots, each card its own pile 'h<id>' so a tap or a drag names it.
  function handCards(g, ids, info, gapAfter, prefix) {
    var n = ids.length, gap = g.cw * (g.gapShare || SUIT_GAP_SHARE), avail = g.W - 2 * g.pad - g.cw, out = { cards: [], slots: [], rows: 1 };
    var perRow = Math.max(1, Math.floor(avail / (g.cw * MIN_STEP_SHARE)) + 1), rows = Math.max(1, Math.ceil(n / perRow)), r;
    out.rows = rows;
    prefix = prefix || 'h';
    for (r = 0; r < rows; r++) {
      var part = ids.slice(Math.ceil(n * r / rows), Math.ceil(n * (r + 1) / rows)), gaps = 0, i;
      if (gapAfter) for (i = 1; i < part.length; i++) if (gapAfter(part[i - 1], part[i])) gaps++;
      var step = part.length > 1 ? Math.min(g.cw * HAND_STEP_SHARE, (avail - gaps * gap) / (part.length - 1)) : 0;
      var x = (g.W - (g.cw + (part.length - 1) * step + gaps * gap)) / 2, base = g.southY - (rows - 1 - r) * g.rowStep;
      part.forEach(function (id, k) {
        if (k > 0 && gapAfter && gapAfter(part[k - 1], id)) x += gap;
        var f = info(id) || {}, y = base - (f.raise ? g.raise : 0), px = Math.round(x);
        out.cards.push({ id: id, pile: prefix + id, idx: 0, x: px, y: y, up: f.up !== false, mark: f.mark, glow: f.glow, dim: f.dim });
        out.slots.push({ id: prefix + id, x: px, y: y, w: g.cw, h: g.ch, label: f.label || Z.cardName(id) });
        x += step;
      });
    }
    return out;
  }
  // Face-down (or face-up when `up`) fan of a seat's hand at a table position.
  function fan(g, pos, ids, up) {
    var cards = [], n = ids.length, p = 'p' + pos;
    if (pos === 2) {
      var nx = g.cx - (g.cw + (n - 1) * g.topStep) / 2, ts = Math.min(g.topStep, n > 1 ? (g.W - 2 * g.pad - g.cw) / (n - 1) : 0);
      nx = g.cx - (g.cw + (n - 1) * ts) / 2;
      ids.forEach(function (id, k) { cards.push({ id: id, pile: p, idx: k, x: Math.round(nx + k * ts), y: g.northY, up: !!up }); });
    } else {
      var sx = pos === 1 ? g.westX : g.eastX, st = sideStep(g, n);
      ids.forEach(function (id, k) { cards.push({ id: id, pile: p, idx: k, x: sx, y: g.yTop + k * st, up: !!up }); });
    }
    return cards;
  }

  // ── The table's own text and buttons ────────────────────────────────────
  // cfg: { id, name, rules, lowScore, players (seats; for geometry only),
  //   geo(m, st) -> geometry, place(st, m, view), canPick(st, pile), move(pile, idx, to),
  //   tap(pile, idx), slotTap(pile), hud(st, view) -> {chips, text, label, action, choices, sub},
  //   stat(sec, st), cascadeOrder(st), winLines(sec, st), newGame(), menuExtra() -> nodes,
  //   cols, heightShare, face }
  // chips: [{ name, text, turn }]; choices: [{ label, onclick, disabled, primary, pressed }].
  function create(cfg) {
    var d = root.document, el = Z.pageEls(), board, session, view = cfg.view || {};
    view.flash = view.flash || '';
    Z.ensureSprite();
    var scoreRow = Z.h('div', { class: 'ct-scores', 'aria-live': 'off' });
    var statusText = Z.h('span', { class: 'ct-status-text' });
    var statusBtn = Z.h('button', { class: 'ar-btn', type: 'button' });
    var status = Z.h('div', { class: 'ct-status', role: 'status' }, [statusText, statusBtn]);
    var panel = Z.h('div', { class: 'ct-panel', role: 'group', 'aria-label': 'Choices' });
    el.table.appendChild(scoreRow); el.table.appendChild(status); el.table.appendChild(panel);
    var statusAction = null, last = '', choicesNow = [];
    statusBtn.addEventListener('click', function () { if (statusAction) statusAction(); });

    function paint() {
      var st = session && session.state, m = board && board.metrics();
      if (!st || !m) return;
      var g = cfg.geo ? cfg.geo(m, st) : geometry(m), hd = cfg.hud(st, view) || {};
      var sig = JSON.stringify([hd.chips, hd.text, hd.label, !!hd.action, hd.choices && hd.choices.map(function (c) { return [c.label, !!c.disabled, !!c.pressed]; }), hd.lines, hd.sub, view.flash, g.statusY, m.W]);
      statusAction = hd.action || null; choicesNow = hd.choices || [];
      if (sig === last) return;
      last = sig;
      scoreRow.textContent = '';
      (hd.chips || []).forEach(function (c) {
        scoreRow.appendChild(Z.h('span', { class: 'ct-chip' + (c.turn ? ' ct-turn' : '') }, [Z.h('b', { text: c.name }), Z.h('span', { text: c.text || '' })]));
      });
      scoreRow.style.top = m.pad + 'px';
      status.style.top = Math.round(g.statusY) + 'px'; status.style.height = STATUS_H + 'px';
      panel.style.bottom = Math.round(m.H - g.statusY + PANEL_GAP) + 'px';
      statusText.textContent = view.flash || hd.text || '';
      statusBtn.textContent = hd.label || ''; statusBtn.hidden = !hd.label; statusBtn.disabled = !hd.action;
      panel.textContent = ''; panel.hidden = !(hd.choices && hd.choices.length);
      (hd.choices || []).forEach(function (c, i) {
        var b = Z.h('button', { class: 'ar-btn ct-choice' + (c.cls ? ' ' + c.cls : ''), type: 'button', text: c.label });
        if (c.pressed !== undefined) b.setAttribute('aria-pressed', String(!!c.pressed));
        if (c.primary) b.setAttribute('aria-pressed', 'true');
        if (c.aria) b.setAttribute('aria-label', c.aria);
        b.disabled = !!c.disabled;
        b.addEventListener('click', function () { if (choicesNow[i] && choicesNow[i].onclick) choicesNow[i].onclick(); });
        panel.appendChild(b);
      });
      if (hd.lines && hd.lines.length) {
        var box = Z.h('div', { class: 'ct-lines' }, hd.lines.map(function (t) { return Z.h('p', { class: t.cls || '', text: t.text }, []); }));
        panel.hidden = false; panel.insertBefore(box, panel.firstChild);
      }
      el.sub.textContent = hd.sub || '';
    }
    function flash(text) { view.flash = text; board.say(text); paint(); session.later(function () { view.flash = ''; paint(); }, FLASH_MS); }

    board = Z.createBoard({
      table: el.table, cols: cfg.cols || 7, heightShare: cfg.heightShare || 0.11, enterTaps: true, face: cfg.face,
      place: function (st, m) { return cfg.place(st, m, view); },
      canPick: function (st, pile) { return cfg.canPick ? cfg.canPick(st, pile) : false; },
      move: function (pile, idx, to) { return cfg.move ? cfg.move(pile, idx, to) : false; },
      tap: function (pile, idx) { return cfg.tap ? cfg.tap(pile, idx) : false; },
      slotTap: function (pile) { if (cfg.slotTap) cfg.slotTap(pile); }
    });
    session = Z.createSession({
      id: cfg.id, lowScore: cfg.lowScore, board: board, newGame: cfg.newGame, els: el,
      undoOff: cfg.seats ? function () { return cfg.seats.hotseat(); } : null,
      statText: function (sec, st) { paint(); return cfg.stat(sec, st); },
      cascadeOrder: cfg.cascadeOrder || function () { return []; },
      winLines: cfg.winLines,
      openMenu: function () {
        Z.sheet({
          title: cfg.name,
          body: [Z.h('p', { class: 'zc-note', text: cfg.rules })].concat(cfg.menuExtra ? cfg.menuExtra() : [], cfg.seats ? [cfg.seats.block(null, cfg.seatsBlock)] : [], [Z.backsRow(), Z.h('p', { class: 'zc-stats', text: session.stats.line() })]),
          actions: [{ label: 'New game', onclick: cfg.newGame }, { label: 'Done', primary: true }]
        });
      }
    });
    d.addEventListener('visibilitychange', function () { if (!d.hidden) paint(); });
    return { board: board, session: session, view: view, flash: flash, paint: function () { last = ''; paint(); }, el: el };
  }

  // A sheet of plain lines (a hand's result).
  function lineSheet(title, lines, actions) {
    return Z.sheet({ title: title, body: lines.map(function (t) { return Z.h('p', { class: 'zc-note', text: t }); }), actions: actions });
  }
  // Which saved choice (key in zimi.games.*) a segmented menu row holds.
  function choiceRow(label, key, options, fallback, onPick) {
    var value = Z.store.get(key, fallback);
    if (!options.some(function (o) { return o.value === value; })) value = fallback;
    return Z.h('div', { class: 'zc-row' }, [Z.h('label', { text: label }), Z.segmented(options, value, function (v) { Z.store.set(key, v); onPick(v); })]);
  }

  root.ZimiTable = {
    SEAT_POS: SEAT_POS, SUIT_GLYPH: SUIT_GLYPH, STATUS_H: STATUS_H, SCORE_BAR_H: SCORE_BAR_H,
    next: next, sortHand: sortHand, rankHigh: rankHigh, short: short, shortList: shortList, shuffleOf: shuffleOf,
    countBy: countBy, maxBy: maxBy, minBy: minBy,
    geometry: geometry, rowsFor: rowsFor, sideStep: sideStep, trickSpot: trickSpot, seatSpot: seatSpot, posOf: posOf, posFor: posFor, handCards: handCards, fan: fan,
    create: create, lineSheet: lineSheet, choiceRow: choiceRow
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
