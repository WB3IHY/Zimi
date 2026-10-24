/* Zimi Arcade cards: the pieces every card game shares. Rules helpers and the
   Microsoft deal (pure, tested in node), the card faces and animated backs
   (SVG), the board (layout, drag, tap, keyboard, the win cascade) and the
   session (undo, clock, stats, win sheet). A game supplies its rules and a
   `place` function; nothing here knows Klondike from FreeCell. */
(function (root) {
  'use strict';

  // ── Cards ─────────────────────────────────────────────────────────────
  // A card is 0..51: suit * 13 + (rank - 1). Suits in the Microsoft deck's
  // order, so the deal reads straight off its algorithm.
  var SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
  var RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var RANK_NAMES = ['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];
  var DECK = 52;
  var KING = 13;

  function rank(id) { return id % 13 + 1; }
  function suit(id) { return Math.floor(id / 13); }
  function isRed(id) { var s = suit(id); return s === 1 || s === 2; }
  function make(r, s) { return s * 13 + r - 1; }
  function cardName(id) { return RANK_NAMES[rank(id) - 1] + ' of ' + SUITS[suit(id)]; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // Same suit, one rank up on top of its own pile (or an ace on an empty one).
  function foundationAccepts(id, topId, count) {
    return count === 0 ? rank(id) === 1 : suit(id) === suit(topId) && rank(id) === rank(topId) + 1;
  }
  // `lower` may sit on `upper` in a tableau: opposite colour, one rank down.
  function stacksOn(upper, lower) { return isRed(upper) !== isRed(lower) && rank(lower) === rank(upper) - 1; }
  function isRun(ids) {
    for (var i = 1; i < ids.length; i++) if (!stacksOn(ids[i - 1], ids[i])) return false;
    return true;
  }

  function shuffled(rng) {
    var a = [], i, j, t;
    for (i = 0; i < DECK; i++) a.push(i);
    for (i = DECK - 1; i > 0; i--) { j = Math.floor(rng() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // The Microsoft FreeCell deal: a public LCG seeded with the deal number,
  // drawing from a deck ordered A-K, clubs/diamonds/hearts/spades, swapping
  // the last card into each hole. Returns the 52 cards in dealing order
  // (card i goes to column i % 8).
  var LCG_MUL = 214013, LCG_ADD = 2531011, LCG_SHIFT = 16, LCG_MASK = 0x7fff;
  function msDeal(n) {
    var seed = n >>> 0, deck = [], out = [], left = DECK, i, j;
    for (i = 0; i < DECK; i++) deck.push(i);
    for (i = 0; i < DECK; i++) {
      seed = (Math.imul(seed, LCG_MUL) + LCG_ADD) >>> 0;
      j = ((seed >>> LCG_SHIFT) & LCG_MASK) % left;
      out.push(make((deck[j] >> 2) + 1, deck[j] & 3));
      deck[j] = deck[--left];
    }
    return out;
  }

  // ── The Moon, for the night-sky back ──────────────────────────────────
  var SYNODIC_DAYS = 29.530588853;
  var NEW_MOON_REF_MS = Date.UTC(2000, 0, 6, 18, 14);
  var DAY_MS = 86400000;
  // 0 = new, 0.5 = full, back to 1 = new. Mean-month maths: within about
  // half a day of the real phase, which is invisible on a card.
  function moonPhase(date) {
    var f = ((date.getTime() - NEW_MOON_REF_MS) / DAY_MS / SYNODIC_DAYS) % 1;
    return f < 0 ? f + 1 : f;
  }
  // The lit part of the disc as an SVG path (northern sky: it waxes on the
  // right). A half circle on the lit side, closed by the terminator ellipse.
  function moonLitPath(f, cx, cy, r) {
    var c = Math.cos(2 * Math.PI * f), rx = Math.round(r * Math.abs(c) * 100) / 100, top = cy - r, bot = cy + r;
    var arc = function (rr, sweep, y) { return 'A' + rr + ' ' + r + ' 0 0 ' + sweep + ' ' + cx + ' ' + y; };
    if (f < 0.5) return 'M' + cx + ' ' + top + arc(r, 1, bot) + arc(rx, c > 0 ? 0 : 1, top) + 'Z';
    return 'M' + cx + ' ' + top + arc(r, 0, bot) + arc(rx, c > 0 ? 1 : 0, top) + 'Z';
  }

  // ── Faces ─────────────────────────────────────────────────────────────
  // Suit shapes centred on 0,0 inside ±10; one sprite, `use`d by every card.
  var SUIT_SHAPES = [
    '<circle cy="-5" r="4.8"/><circle cx="-5.2" cy="2.6" r="4.8"/><circle cx="5.2" cy="2.6" r="4.8"/><path d="M-1.3 2C-1 6-2.6 8-4.6 10h9.2C2.6 8 1 6 1.3 2z"/>',
    '<path d="M0-10 7 0 0 10-7 0z"/>',
    '<path d="M0 9C-14-1-10-10-4.5-8.5-2-7.8 0-5.5 0-4 0-5.5 2-7.8 4.5-8.5 10-10 14-1 0 9z"/>',
    '<path d="M0-10C-4-5-11-1-9 3.5-7.5 7-2.5 6-1.5 3-1.5 6-2 8-4 10h8C2 8 1.5 6 1.5 3 2.5 6 7.5 7 9 3.5 11-1 4-5 0-10z"/>'
  ];
  var CARD_RED = '#c62828', CARD_BLACK = '#1b1b1b', CARD_CREAM = '#fdfcf8', CARD_EDGE = '#c9c4b8'; // arcade.css tokens, repeated for the cascade's bitmaps
  var FACE_W = 100, FACE_H = 140;
  var PIP_SCALE = 1.15, PIP_SCALE_DENSE = 0.95, DENSE_FROM = 8, PIP_COLS = [34, 66], PIP_MID_X = 50, PIP_TOP = 32, PIP_BOTTOM = 108, PIP_CENTRE = 70, FLIP_AFTER_Y = 70;
  var PIPS = (function () {
    var sides = function (ys) { var o = []; ys.forEach(function (y) { PIP_COLS.forEach(function (x) { o.push([x, y]); }); }); return o; };
    var mid = function (y) { return [PIP_MID_X, y]; };
    var two = sides([PIP_TOP, PIP_BOTTOM]), three = sides([PIP_TOP, PIP_CENTRE, PIP_BOTTOM]), four = sides([PIP_TOP, 57, 83, PIP_BOTTOM]);
    return [null,
      [mid(PIP_CENTRE)], [mid(PIP_TOP), mid(PIP_BOTTOM)], [mid(PIP_TOP), mid(PIP_CENTRE), mid(PIP_BOTTOM)],
      two, two.concat([mid(PIP_CENTRE)]), three, three.concat([mid(51)]), three.concat([mid(51), mid(89)]),
      four.concat([mid(PIP_CENTRE)]), four.concat([mid(44.5), mid(95.5)])];
  })();
  var COURT_CROWN = [
    'M-12 6C-12-6 2-6 2-6 12-6 14-12 14-12 16 0 12 6 12 6z', // jack: a plumed cap
    'M-14 6-16-4-8 0-4-8 0 0 4-8 8 0 16-4 14 6z',            // queen
    'M-14 6-14-6-7 0 0-9 7 0 14-6 14 6z'                      // king
  ];
  var SERIF = "Georgia,'Times New Roman',serif";

  function placed(s, x, y, scale, turn, standalone) {
    var shape = standalone ? SUIT_SHAPES[s] : '<use href="#zc-s-' + s + '"/>';
    return '<g transform="translate(' + x + ' ' + y + ')' + (turn ? ' rotate(180)' : '') + ' scale(' + scale + ')">' + shape + '</g>';
  }
  // One card face as SVG markup. `standalone` inlines the suit shapes and a
  // card body, for the bitmaps the cascade draws from.
  function faceMarkup(id, standalone) {
    var r = rank(id), s = suit(id), label = RANK_LABELS[r - 1], body = '';
    var indexAt = function (turn) {
      return '<g' + (turn ? ' transform="rotate(180 50 70)"' : '') + '><text x="11" y="21" font-size="' + (r === 10 ? 17 : 21) +
        '" font-weight="700" text-anchor="middle" font-family="' + SERIF + '">' + label + '</text>' + placed(s, 11, 33, 0.62, false, standalone) + '</g>';
    };
    if (r === 1) body = placed(s, 50, 70, 3.3, false, standalone);
    else if (r <= 10) {
      PIPS[r].forEach(function (p) { body += placed(s, p[0], p[1], r >= DENSE_FROM ? PIP_SCALE_DENSE : PIP_SCALE, p[1] > FLIP_AFTER_Y, standalone); });
    } else {
      body = '<rect x="24" y="26" width="52" height="88" rx="4" fill-opacity="0.07" stroke="currentColor" stroke-width="1.6"/>' +
        '<g transform="translate(50 50)"><path d="' + COURT_CROWN[r - 11] + '"/></g>' +
        '<text x="50" y="94" font-size="36" font-weight="700" text-anchor="middle" font-family="' + SERIF + '">' + label + '</text>' +
        placed(s, 36, 38, 0.6, false, standalone) + placed(s, 64, 102, 0.6, true, standalone);
    }
    var open = standalone
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + FACE_W + ' ' + FACE_H + '" fill="currentColor" style="color:' + (isRed(id) ? CARD_RED : CARD_BLACK) + '">' +
        '<rect x="0.5" y="0.5" width="99" height="139" rx="7.5" fill="' + CARD_CREAM + '" stroke="' + CARD_EDGE + '"/>'
      : '<svg viewBox="0 0 ' + FACE_W + ' ' + FACE_H + '" fill="currentColor" aria-hidden="true">';
    return open + indexAt(false) + indexAt(true) + body + '</svg>';
  }

  // ── Backs ─────────────────────────────────────────────────────────────
  // Original designs, drawn in a 92x132 art box inside a cream margin. The
  // animation is CSS on a few groups per card; cards.css pauses it with the
  // tab and drops it under reduced motion.
  var BACKS = [
    { id: 'classic', name: 'Classic' },
    { id: 'night', name: 'Night sky' },
    { id: 'sea', name: 'The sea' },
    { id: 'robot', name: 'Robot' },
    { id: 'castle', name: 'Castle' }
  ];
  var DEFAULT_BACK = 'night';
  var ART_W = 92, ART_H = 132, ART_PAD = 4;
  var WAVE_PERIOD = 46, WAVE_REPEATS = 8;
  function wavePath(y, fill) {
    var d = 'M0 ' + y + 'q' + WAVE_PERIOD / 4 + '-6 ' + WAVE_PERIOD / 2 + ' 0', k;
    for (k = 0; k < WAVE_REPEATS; k++) d += 't' + WAVE_PERIOD / 2 + ' 0';
    return '<path d="' + d + 'V' + ART_H + 'H0z" fill="' + fill + '"/>';
  }
  function stars(cls, pts) {
    return '<g class="zc-tw ' + cls + '" fill="#fff">' + pts.map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + p[2] + '"/>'; }).join('') + '</g>';
  }
  var BACK_ART = {
    classic: function () {
      return '<rect width="92" height="132" fill="url(#zc-p-classic)"/><rect x="9" y="9" width="74" height="114" fill="none" stroke="#e8eefc" stroke-width="2" opacity=".85"/>' +
        '<path d="M46 34 70 66 46 98 22 66z" fill="#e8eefc" opacity=".92"/><path d="M46 44 60 66 46 88 32 66z" fill="#b3322f"/>';
    },
    night: function () {
      return '<rect width="92" height="132" fill="url(#zc-g-night)"/>' +
        stars('zc-tw1', [[12, 16, 1], [70, 10, 0.9], [30, 34, 0.8], [82, 44, 1], [16, 62, 0.8], [58, 26, 0.7]]) +
        stars('zc-tw2', [[44, 8, 0.8], [78, 24, 0.8], [8, 40, 1], [26, 12, 0.7], [84, 70, 0.8]]) +
        stars('zc-tw3', [[62, 40, 0.7], [20, 26, 0.9], [74, 58, 0.7], [38, 22, 0.6]]) +
        '<circle cx="46" cy="58" r="26" fill="#fff" opacity=".07"/><circle cx="46" cy="58" r="17" fill="#2a3556"/>' +
        '<path d="' + moonLitPath(moonPhase(new Date()), 46, 58, 17) + '" fill="#f6f0d8"/>' +
        '<path d="M0 112Q22 98 46 110T92 106V132H0z" fill="#0b1022"/><path d="M12 112l3-12 3 12zM70 108l3-14 3 14z" fill="#0b1022"/>';
    },
    sea: function () {
      return '<rect width="92" height="132" fill="url(#zc-g-sea)"/><circle cx="68" cy="32" r="11" fill="#ffe9a8"/><circle cx="68" cy="32" r="17" fill="#ffe9a8" opacity=".25"/>' +
        '<g class="zc-boat"><path d="M30 72h26l-5 8H35z" fill="#7a3b1d"/><path d="M43 46v26M43 48l12 20H43z" fill="#fff" stroke="#fff" stroke-width="1"/><path d="M42 52 31 68h11z" fill="#f4d35e"/></g>' +
        '<g class="zc-wv zc-wv1">' + wavePath(80, '#2d9cdb') + '</g><g class="zc-wv zc-wv2">' + wavePath(94, '#1b78b8') + '</g><g class="zc-wv zc-wv3">' + wavePath(108, '#10568f') + '</g>';
    },
    robot: function () {
      return '<rect width="92" height="132" fill="#123c4a"/><rect width="92" height="132" fill="url(#zc-p-grid)"/>' +
        '<path d="M46 34V22" stroke="#9fb3bd" stroke-width="2"/><circle class="zc-bulb" cx="46" cy="20" r="3.5" fill="#ff5d5d"/>' +
        '<rect x="22" y="34" width="48" height="36" rx="9" fill="#cfd8dc"/><rect x="27" y="40" width="38" height="20" rx="6" fill="#102a33"/>' +
        '<circle class="zc-eye" cx="37" cy="50" r="5" fill="#27e6ff"/><circle class="zc-eye" cx="55" cy="50" r="5" fill="#27e6ff"/>' +
        '<path d="M38 64h16" stroke="#8aa0aa" stroke-width="2" stroke-linecap="round"/>' +
        '<rect x="28" y="74" width="36" height="30" rx="7" fill="#b0bec5"/><circle cx="46" cy="89" r="5" fill="#27e6ff" opacity=".8"/>' +
        '<rect x="14" y="76" width="9" height="22" rx="4.5" fill="#9fb3bd"/>' +
        '<g class="zc-arm"><rect x="69" y="76" width="9" height="24" rx="4.5" fill="#9fb3bd"/></g>' +
        '<rect x="33" y="106" width="9" height="12" rx="3" fill="#9fb3bd"/><rect x="50" y="106" width="9" height="12" rx="3" fill="#9fb3bd"/>';
    },
    castle: function () {
      var bat = function (cls) {
        return '<g class="zc-bat ' + cls + '"><g class="zc-wing"><path d="M0 0C-4-5-9-4-12 0-9-1-6 0-4 2z"/><path d="M0 0C4-5 9-4 12 0 9-1 6 0 4 2z"/></g><ellipse rx="2" ry="3"/></g>';
      };
      return '<rect width="92" height="132" fill="url(#zc-g-castle)"/><circle cx="70" cy="26" r="10" fill="#fbe7b0"/>' +
        '<g fill="#0a0612"><path d="M10 132V86h6V80h6v6h6V80h6v6h6V132z"/><path d="M34 132V70h24v62z"/><path d="M34 70V62h5v-5h4v5h6v-5h4v5h5v8z"/>' +
        '<path d="M60 132V90h6V84h6v6h6V84h6v6h4V132z"/><path d="M42 58l4-16 4 16z"/><path d="M14 80l4-14 4 14z"/><path d="M64 84l4-14 4 14z"/></g>' +
        '<g fill="#ffd166"><rect class="zc-lit" x="44" y="76" width="4" height="7" rx="2"/><rect class="zc-lit" x="16" y="94" width="3" height="6" rx="1.5" style="animation-delay:-1s"/><rect class="zc-lit" x="68" y="98" width="3" height="6" rx="1.5" style="animation-delay:-1.8s"/><rect class="zc-lit" x="44" y="94" width="4" height="7" rx="2" style="animation-delay:-.6s"/></g>' +
        '<g fill="#0a0612">' + bat('zc-bat1') + bat('zc-bat2') + '</g>';
    }
  };
  // Gradients and patterns live once in the page's sprite: a reference into a
  // clone that is display:none would break.
  var SPRITE_DEFS = '<linearGradient id="zc-g-night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1a3d"/><stop offset="1" stop-color="#3a4f8a"/></linearGradient>' +
    '<linearGradient id="zc-g-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd6f5"/><stop offset="1" stop-color="#2b8fc9"/></linearGradient>' +
    '<linearGradient id="zc-g-castle" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1646"/><stop offset=".7" stop-color="#8a3f6b"/><stop offset="1" stop-color="#e58a4b"/></linearGradient>' +
    '<pattern id="zc-p-classic" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#1d3b7a"/><path d="M5 0 10 5 5 10 0 5z" fill="none" stroke="#c9d6f2" stroke-width=".8" opacity=".55"/></pattern>' +
    '<pattern id="zc-p-grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#27e6ff" stroke-width=".4" opacity=".25"/></pattern>';

  var currentBack = DEFAULT_BACK, backListeners = [];
  function backMarkup(id) {
    var art = (BACK_ART[id] || BACK_ART[DEFAULT_BACK])();
    return '<svg viewBox="0 0 ' + FACE_W + ' ' + FACE_H + '" preserveAspectRatio="xMidYMid slice" class="zc-bk" aria-hidden="true"><rect width="100" height="140" fill="' + CARD_CREAM + '"/>' +
      '<svg x="' + ART_PAD + '" y="' + ART_PAD + '" width="' + ART_W + '" height="' + ART_H + '" viewBox="0 0 ' + ART_W + ' ' + ART_H + '" overflow="hidden">' + art + '</svg></svg>';
  }
  function setBack(id) {
    currentBack = id;
    store.set('back', id);
    backListeners.forEach(function (fn) { fn(); });
  }

  // ── Storage: per-viewer conveniences, always in try/catch ─────────────
  var KEY_PREFIX = 'zimi.arcade.';
  var store = {
    get: function (key, fallback) {
      try { var v = root.localStorage.getItem(KEY_PREFIX + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set: function (key, value) { try { root.localStorage.setItem(KEY_PREFIX + key, JSON.stringify(value)); } catch (e) { /* private window, blocked storage */ } }
  };
  function loadBack() {
    var id = store.get('back', DEFAULT_BACK);
    currentBack = BACKS.some(function (b) { return b.id === id; }) ? id : DEFAULT_BACK;
  }

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  // A game's lifetime figures: played counts the games begun, so quitting
  // mid-game still shows up as a loss.
  function createStats(game) {
    var key = 'stats.' + game;
    var read = function () { var v = store.get(key, null); return v && typeof v === 'object' ? v : { played: 0, won: 0, best: 0 }; };
    return {
      get: read,
      began: function () { var v = read(); v.played++; store.set(key, v); },
      won: function (seconds) { var v = read(); v.won++; seconds = Math.max(1, seconds); if (!v.best || seconds < v.best) v.best = seconds; store.set(key, v); return v; },
      line: function () { var v = read(); return 'Played ' + v.played + '   Won ' + v.won + '   Best ' + (v.best ? fmtTime(v.best) : '-'); }
    };
  }

  // ── Small DOM helpers ─────────────────────────────────────────────────
  function h(tag, attrs, kids) {
    var e = root.document.createElement(tag), k;
    for (k in attrs || {}) {
      if (k === 'text') e.textContent = attrs[k];
      else if (typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function ensureSprite() {
    var d = root.document;
    if (d.getElementById('zc-sprite')) return;
    var holder = d.createElement('div');
    holder.innerHTML = '<svg id="zc-sprite" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
      SUIT_SHAPES.map(function (shape, s) { return '<symbol id="zc-s-' + s + '" overflow="visible">' + shape + '</symbol>'; }).join('') + SPRITE_DEFS + '</defs></svg>';
    d.body.insertBefore(holder.firstChild, d.body.firstChild);
  }
  function segmented(options, value, onPick) {
    var wrap = h('div', { class: 'zc-seg', role: 'group' });
    options.forEach(function (o) {
      var b = h('button', { class: 'ar-btn', type: 'button', 'aria-pressed': String(o.value === value), text: o.label });
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(wrap.children, function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        onPick(o.value);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  // ── Sheets ────────────────────────────────────────────────────────────
  // opts: { title, body: [nodes], actions: [{label, primary, onclick}] }
  function sheet(opts) {
    var d = root.document, prev = d.activeElement;
    var card = h('div', { class: 'ar-sheet-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title });
    card.appendChild(h('h2', { text: opts.title }));
    (opts.body || []).forEach(function (n) { card.appendChild(n); });
    var api = { el: null, close: function () {
      if (!api.el) return;
      d.removeEventListener('keydown', onKey, true);
      api.el.remove(); api.el = null;
      if (prev && prev.focus) try { prev.focus(); } catch (e) { /* gone */ }
    } };
    var onKey = function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.close(); } };
    if (opts.actions && opts.actions.length) {
      var row = h('div', { class: 'ar-sheet-actions' });
      opts.actions.forEach(function (a) {
        var b = h('button', { class: 'ar-btn', type: 'button', text: a.label });
        if (a.primary) b.setAttribute('aria-pressed', 'true');
        b.addEventListener('click', function () { api.close(); if (a.onclick) a.onclick(); });
        row.appendChild(b);
      });
      card.appendChild(row);
    }
    api.el = h('div', { class: 'ar-sheet' }, [card]);
    api.el.addEventListener('pointerdown', function (e) { if (e.target === api.el) api.close(); });
    d.addEventListener('keydown', onKey, true);
    d.body.appendChild(api.el);
    // Focus starts on the current choice, so its ring never reads as a second pick.
    var first = card.querySelector('[aria-pressed="true"]') || card.querySelector('button, input');
    if (first) first.focus();
    return api;
  }

  function backsSheet() {
    var grid = h('div', { class: 'zc-backs' }), picks = {};
    BACKS.forEach(function (b) {
      var face = h('div', { class: 'zc-card zc-down' });
      face.innerHTML = '<div class="zc-back">' + backMarkup(b.id) + '</div>';
      var pick = h('button', { class: 'zc-pick', type: 'button', 'aria-pressed': String(b.id === currentBack), 'aria-label': b.name + ' card back' }, [face, h('span', { text: b.name })]);
      pick.addEventListener('click', function () {
        setBack(b.id);
        Object.keys(picks).forEach(function (k) { picks[k].setAttribute('aria-pressed', String(k === b.id)); });
      });
      picks[b.id] = pick;
      grid.appendChild(pick);
    });
    return sheet({ title: 'Card backs', body: [grid], actions: [{ label: 'Done', primary: true }] });
  }

  // The menu row both games share: open the backs picker.
  function backsRow() {
    return h('div', { class: 'zc-row' }, [h('label', { text: 'Look' }), h('button', { class: 'ar-btn', type: 'button', text: 'Card backs\u2026', onclick: backsSheet })]);
  }

  // ── The board ─────────────────────────────────────────────────────────
  // o: { table, cols, place(state, m) -> {height, slots, cards},
  //      canPick(state, pile, idx), move(pile, idx, to) -> bool,
  //      tap(pile, idx) -> bool, slotTap(pile) }
  // place() returns slots [{id, x, y, w, h, label, mark}] and cards
  // [{id, pile, idx, x, y, up, hidden}] in stacking order.
  var MAX_CARD_W = 120, CARD_ASPECT = 1.4, CARD_H_SHARE = 0.14, DRAG_SLOP = 6, SETTLE_MS = 300, Z_HOT = 500, Z_DRAG = 1000;
  var DEAL_STAGGER_MS = 16, MIN_CARD_W = 24;

  function createBoard(o) {
    var d = root.document, table = o.table, stage = h('div', { class: 'zc-stage' });
    var live = h('div', { class: 'zc-live', 'aria-live': 'polite' });
    table.appendChild(stage); table.appendChild(live);
    var els = {}, slotEls = {}, cardPos = {}, byPile = {}, slotRects = {};
    var lastState = null, metrics = null, drag = null, sel = null, settleTimer = 0;

    function measure() {
      var W = table.clientWidth, H = table.clientHeight;
      var pad = Math.max(6, Math.min(16, Math.round(W * 0.02))), gap = Math.max(4, Math.round(W * 0.014));
      var cw = Math.floor((W - 2 * pad - (o.cols - 1) * gap) / o.cols);
      cw = Math.max(MIN_CARD_W, Math.min(cw, MAX_CARD_W, Math.floor(H * CARD_H_SHARE)));
      // `left` centres the columns when the cards stop growing before the width does.
      var left = Math.floor((W - (o.cols * cw + (o.cols - 1) * gap)) / 2);
      metrics = { cw: cw, ch: Math.round(cw * CARD_ASPECT), gap: gap, pad: pad, left: left, step: cw + gap, W: W, H: H, cols: o.cols };
      stage.style.setProperty('--cw', cw + 'px');
      return metrics;
    }
    function cardEl(id) {
      var e = els[id];
      if (!e) {
        e = els[id] = h('div', { class: 'zc-card' + (isRed(id) ? ' zc-red' : ''), 'data-id': String(id) });
        e.innerHTML = '<div class="zc-face"></div><div class="zc-back"></div>';
        e._up = null; e._face = false; e._back = '';
        e.addEventListener('animationend', function () { e.classList.remove('zc-flip', 'zc-hint'); });
        stage.appendChild(e);
      }
      return e;
    }
    function dress(e, id, up, hidden) {
      e.classList.toggle('zc-off', !!hidden);
      if (e._up !== up) {
        var flipping = e._up === false && up && !hidden;
        e._up = up;
        e.classList.toggle('zc-down', !up);
        if (flipping) { e.classList.remove('zc-flip'); void e.offsetWidth; e.classList.add('zc-flip'); }
      }
      if (up && !e._face) { e.firstChild.innerHTML = faceMarkup(id, false); e._face = true; }
      if (!up && !hidden && e._back !== currentBack) { e.lastChild.innerHTML = backMarkup(currentBack); e._back = currentBack; }
    }
    function put(e, x, y) {
      var t = 'translate(' + x + 'px,' + y + 'px)';
      e.style.transform = t; e.style.setProperty('--zc-t', t);
      e._x = x; e._y = y;
    }
    function slotEl(s) {
      var e = slotEls[s.id];
      if (!e) {
        e = slotEls[s.id] = h('div', { class: 'zc-slot', tabindex: '0', role: 'group', 'data-pile': s.id });
        e.addEventListener('keydown', function (ev) { onKey(ev, s.id); });
        stage.insertBefore(e, stage.firstChild);
      }
      return e;
    }
    function scheduleSettle() {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(function () {
        Object.keys(els).forEach(function (k) { var e = els[k]; if (e._hot) { e._hot = false; e.style.zIndex = e._z; } });
      }, SETTLE_MS);
    }

    // mode: 'deal' flies the cards out of the first slot; 'instant' skips
    // every transition (resize, first paint); otherwise cards ease to place.
    function render(state, mode) {
      lastState = state;
      var m = metrics || measure(), p = o.place(state, m), anyMoved = false;
      stage.style.height = Math.max(p.height, m.H) + 'px';
      slotRects = {};
      p.slots.forEach(function (s) {
        var e = slotEl(s);
        e.style.transform = 'translate(' + s.x + 'px,' + s.y + 'px)';
        e.style.width = s.w + 'px'; e.style.height = s.h + 'px';
        e.setAttribute('aria-label', s.label);
        if (s.mark) e.setAttribute('data-mark', s.mark); else e.removeAttribute('data-mark');
        slotRects[s.id] = s;
      });
      cardPos = {}; byPile = {};
      var origin = p.slots[0], dealing = mode === 'deal';
      p.cards.forEach(function (c, i) {
        var e = cardEl(c.id), z = i + 1;
        cardPos[c.id] = { pile: c.pile, idx: c.idx };
        (byPile[c.pile] = byPile[c.pile] || []).push(c.id);
        dress(e, c.id, c.up, c.hidden);
        e.classList.remove('zc-drag');
        var moved = e._x !== c.x || e._y !== c.y;
        anyMoved = anyMoved || moved;
        e._z = z;
        if (moved) e._hot = true;
        e.style.zIndex = e._hot ? z + Z_HOT : z;
        if (dealing) {
          e.classList.add('zc-instant'); put(e, origin.x, origin.y); e.style.transitionDelay = '0ms';
        } else {
          e.classList.toggle('zc-instant', mode === 'instant');
          e.style.transitionDelay = '';
          put(e, c.x, c.y);
        }
      });
      if (dealing) {
        void table.offsetWidth;
        p.cards.forEach(function (c, i) {
          var e = els[c.id];
          e.classList.remove('zc-instant');
          e.style.transitionDelay = i * DEAL_STAGGER_MS + 'ms';
          put(e, c.x, c.y);
        });
        setTimeout(function () { p.cards.forEach(function (c) { els[c.id].style.transitionDelay = ''; }); }, p.cards.length * DEAL_STAGGER_MS + 250);
      }
      if (anyMoved) scheduleSettle();
      paintSelection();
    }
    function refresh(mode) { if (lastState) render(lastState, mode); }

    // ── Pointer: drag, drop, tap ────────────────────────────────────────
    function overlap(a, b) {
      var w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), hh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      return w > 0 && hh > 0 ? w * hh : 0;
    }
    function beginDrag() {
      drag.ids = byPile[drag.pos.pile].slice(drag.pos.idx);
      drag.ids.forEach(function (id, k) {
        var e = els[id];
        e.classList.add('zc-drag'); e.style.zIndex = Z_DRAG + k; e._hot = true;
      });
    }
    function moveDrag(dr, dx, dy) {
      dr.ids.forEach(function (id) { var e = els[id]; e.style.transform = 'translate(' + (e._x + dx) + 'px,' + (e._y + dy) + 'px)'; });
    }
    // Slots the dragged cards overlap, biggest overlap first; the one under
    // the pointer counts extra. The game then takes the first that is legal.
    function dropTargets(dr, dx, dy, px, py) {
      var lead = els[dr.ids[0]], m = metrics, list = [];
      var box = { x: lead._x + dx, y: lead._y + dy, w: m.cw, h: m.ch };
      Object.keys(slotRects).forEach(function (id) {
        var s = slotRects[id];
        if (id === dr.pos.pile) return;
        var a = overlap(box, s) + (px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h ? m.cw * m.ch : 0);
        if (a > 0) list.push([a, id]);
      });
      return list.sort(function (a, b) { return b[0] - a[0]; });
    }

    table.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (d.querySelector('.zc-cascade')) return;
      var cardNode = e.target.closest('.zc-card'), slotNode = e.target.closest('.zc-slot');
      var pos = cardNode && cardPos[+cardNode.getAttribute('data-id')];
      if (!pos && !slotNode) return;
      drag = { pos: pos, slot: slotNode && slotNode.getAttribute('data-pile'), sx: e.clientX, sy: e.clientY, pid: e.pointerId, moved: false, ids: null, blocked: false };
      sel = null; paintSelection();
      try { table.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    });
    table.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.pid) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && !drag.blocked && Math.abs(dx) + Math.abs(dy) > DRAG_SLOP) {
        if (drag.pos && o.canPick(lastState, drag.pos.pile, drag.pos.idx)) { drag.moved = true; beginDrag(); } else drag.blocked = true;
      }
      if (drag.moved) { moveDrag(drag, dx, dy); e.preventDefault(); }
    });
    function endDrag(e, cancelled) {
      if (!drag || e.pointerId !== drag.pid) return;
      var dr = drag; drag = null;
      try { table.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      if (dr.moved) {
        var r = stage.getBoundingClientRect(), done = false;
        var targets = cancelled ? [] : dropTargets(dr, e.clientX - dr.sx, e.clientY - dr.sy, e.clientX - r.left, e.clientY - r.top);
        for (var i = 0; i < targets.length && !done; i++) done = o.move(dr.pos.pile, dr.pos.idx, targets[i][1]);
        if (!done) { refresh(); scheduleSettle(); }
        return;
      }
      if (cancelled || dr.blocked) return;
      if (dr.pos) { if (!o.tap(dr.pos.pile, dr.pos.idx)) nudge(dr.pos); } else if (dr.slot && o.slotTap) o.slotTap(dr.slot);
    }
    table.addEventListener('pointerup', function (e) { endDrag(e, false); });
    table.addEventListener('pointercancel', function (e) { endDrag(e, true); });
    // A tap that leads nowhere: a small shake, so it reads as "no".
    function nudge(pos) {
      var e = els[byPile[pos.pile][pos.idx]];
      if (!e) return;
      e.classList.remove('zc-hint'); void e.offsetWidth; e.classList.add('zc-hint');
    }

    // ── Keyboard: Tab to a pile, Enter/Space picks up, again drops ──────
    function say(text) { live.textContent = text; }
    function paintSelection() {
      Object.keys(els).forEach(function (k) { els[k].classList.remove('zc-sel'); });
      if (!sel || !byPile[sel.pile]) return;
      byPile[sel.pile].slice(sel.idx).forEach(function (id) { els[id].classList.add('zc-sel'); });
    }
    function onKey(ev, pile) {
      var ids = byPile[pile] || [], key = ev.key;
      if (key === 'Escape' && sel) { sel = null; paintSelection(); say('Cancelled'); return; }
      if (sel && (key === 'ArrowUp' || key === 'ArrowDown') && sel.pile === pile) {
        ev.preventDefault();
        var next = sel.idx + (key === 'ArrowUp' ? -1 : 1);
        if (next >= 0 && next < ids.length && o.canPick(lastState, pile, next)) { sel.idx = next; paintSelection(); say(ids.length - next + ' cards'); }
        return;
      }
      if (key !== 'Enter' && key !== ' ') return;
      ev.preventDefault();
      if (sel) {
        var from = sel; sel = null; paintSelection();
        if (from.pile === pile) { if (!o.tap(from.pile, from.idx)) say('No move'); return; }
        if (o.move(from.pile, from.idx, pile)) say('Moved');
        else { say('Not allowed there'); sel = from; paintSelection(); }
        return;
      }
      if (ids.length && o.canPick(lastState, pile, ids.length - 1)) {
        sel = { pile: pile, idx: ids.length - 1 }; paintSelection();
        say('Picked up ' + cardName(ids[ids.length - 1]) + '. Choose a pile, Enter to drop.');
      } else if (o.slotTap) o.slotTap(pile);
    }

    // ── The win cascade ─────────────────────────────────────────────────
    // order: [{id}], first launched first. Calls done() when the cards have
    // all gone or the player taps. Speeds are per frame at 60 fps for a card
    // BASE_CARD_W wide, scaled to the card size on screen.
    var GRAVITY = 0.55, BOUNCE = 0.82, LAUNCH_FRAMES = 11, FRAME_MS = 1000 / 60, MAX_DT = 3;
    var VX_MIN = 2, VX_SPAN = 5, VY_MIN = 2, VY_SPAN = 7, BASE_CARD_W = 71, END_PAUSE_MS = 600, MAX_DPR = 2;
    function bitmap(id, w, hh, dpr) {
      return new Promise(function (resolve) {
        var img = new root.Image();
        img.onload = function () {
          var c = d.createElement('canvas');
          c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c);
        };
        img.onerror = function () { resolve(null); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(faceMarkup(id, true));
      });
    }
    function cascade(order, done) {
      var m = metrics;
      if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
      var dpr = Math.min(MAX_DPR, root.devicePixelRatio || 1), W = root.innerWidth, H = root.innerHeight;
      var canvas = h('canvas', { class: 'zc-cascade', 'aria-hidden': 'true' });
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      d.body.appendChild(canvas);
      var ctx = canvas.getContext('2d'), scale = m.cw / BASE_CARD_W;
      var queue = order.slice(), flyers = [], bitmaps = {}, wait = 0, raf = 0, last = 0, stopped = false, hidden = [];
      function finish() {
        if (stopped) return;
        stopped = true; cancelAnimationFrame(raf);
        d.removeEventListener('keydown', finish, true);
        canvas.remove();
        hidden.forEach(function (e) { e.style.visibility = ''; });
        done();
      }
      canvas.addEventListener('pointerdown', finish);
      d.addEventListener('keydown', finish, true);
      Promise.all(order.map(function (c) { return bitmap(c.id, m.cw, m.ch, dpr).then(function (b) { bitmaps[c.id] = b; }); })).then(function () {
        if (!stopped) raf = requestAnimationFrame(frame);
      });
      function launch(c) {
        var e = els[c.id], r = e.getBoundingClientRect(), dir = Math.random() < 0.5 ? -1 : 1;
        e.style.visibility = 'hidden'; hidden.push(e);
        flyers.push({ id: c.id, x: r.left, y: r.top, vx: dir * (VX_MIN + Math.random() * VX_SPAN) * scale, vy: -(VY_MIN + Math.random() * VY_SPAN) * scale });
      }
      function frame(t) {
        if (stopped) return;
        var dt = last ? Math.min(MAX_DT, (t - last) / FRAME_MS) : 1;
        last = t; wait -= dt;
        if (wait <= 0 && queue.length) { launch(queue.shift()); wait = LAUNCH_FRAMES; }
        flyers = flyers.filter(function (f) {
          f.vy += GRAVITY * scale * dt; f.x += f.vx * dt; f.y += f.vy * dt;
          if (f.y + m.ch > H) { f.y = H - m.ch; f.vy = -Math.abs(f.vy) * BOUNCE; }
          var b = bitmaps[f.id];
          // No clearing: every frame's card stays on the canvas, which is the trail.
          if (b) ctx.drawImage(b, f.x * dpr, f.y * dpr, m.cw * dpr, m.ch * dpr);
          else { ctx.fillStyle = CARD_CREAM; ctx.fillRect(f.x * dpr, f.y * dpr, m.cw * dpr, m.ch * dpr); }
          return f.x + m.cw > 0 && f.x < W;
        });
        if (!queue.length && !flyers.length) { setTimeout(finish, END_PAUSE_MS); return; }
        raf = requestAnimationFrame(frame);
      }
    }

    measure();
    if (root.ResizeObserver) {
      var pending = 0;
      new root.ResizeObserver(function () {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(function () {
          if (metrics && table.clientWidth === metrics.W && table.clientHeight === metrics.H) return;
          measure(); refresh('instant');
        });
      }).observe(table);
    }
    backListeners.push(function () { refresh('instant'); });
    return {
      render: render, refresh: refresh, cascade: cascade, say: say, nudge: nudge,
      metrics: function () { return metrics; },
      cardEl: function (id) { return els[id]; },
      clearSelection: function () { sel = null; paintSelection(); }
    };
  }

  // ── The session: undo, clock, stats, keys, the win ────────────────────
  // cfg: { id, els: {undo, newBtn, menu, stat}, board, newGame(), openMenu(),
  //        statText(sec, state), cascadeOrder(state), winLines(sec, state) }
  var TICK_MS = 1000;
  function createSession(cfg) {
    var d = root.document, board = cfg.board, stats = createStats(cfg.id);
    var s = { state: null, history: [], won: false, stats: stats }, begun = false;
    var started = 0, banked = 0, ticker = 0, timers = [], running = false, resume = false;

    function seconds() { return Math.floor((banked + (running ? Date.now() - started : 0)) / 1000); }
    function paint() {
      cfg.els.stat.textContent = cfg.statText(seconds(), s.state);
      cfg.els.undo.disabled = !s.history.length || s.won;
    }
    function run() { if (running) return; running = true; started = Date.now(); ticker = setInterval(paint, TICK_MS); }
    function halt() { if (!running) return; banked += Date.now() - started; running = false; clearInterval(ticker); }
    function clearLater() { timers.forEach(clearTimeout); timers = []; }

    s.seconds = seconds;
    s.paint = paint;
    s.later = function (fn, ms) { timers.push(setTimeout(fn, ms)); };
    s.commit = function (next) {
      if (s.won) return;
      if (!begun) { begun = true; stats.began(); run(); }
      s.history.push(s.state); s.state = next;
      board.render(next); paint();
    };
    // A state that follows from the player's move without being one (an
    // auto-move): shown, and undone together with that move.
    s.follow = function (next) { s.state = next; board.render(next); paint(); };
    s.undo = function () {
      if (!s.history.length || s.won) return;
      clearLater(); board.clearSelection();
      s.state = s.history.pop(); board.render(s.state); paint();
    };
    s.reset = function (state) {
      clearLater(); halt(); banked = 0; s.history = []; s.won = false; begun = false; board.clearSelection();
      s.state = state; board.render(state, 'deal'); paint();
    };
    s.win = function () {
      s.won = true; halt(); clearLater();
      var sec = seconds(), best = stats.won(sec);
      paint();
      board.cascade(cfg.cascadeOrder(s.state), function () {
        var body = cfg.winLines(sec, s.state).map(function (t) { return h('p', { class: 'zc-note', text: t }); });
        body.push(h('p', { class: 'zc-stats', text: 'Won ' + best.won + ' of ' + best.played + '   Best ' + fmtTime(best.best) }));
        sheet({ title: 'You won', body: body, actions: [{ label: 'Close' }, { label: 'New game', primary: true, onclick: cfg.newGame }] });
      });
    };

    cfg.els.undo.addEventListener('click', s.undo);
    cfg.els.newBtn.addEventListener('click', cfg.newGame);
    cfg.els.menu.addEventListener('click', cfg.openMenu);
    d.addEventListener('keydown', function (e) {
      var t = e.target && e.target.tagName;
      if (e.ctrlKey || e.metaKey || e.altKey || t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      if (d.querySelector('.ar-sheet') || d.querySelector('.zc-cascade')) return;
      if (e.key === 'u' || e.key === 'U') { e.preventDefault(); s.undo(); } else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); cfg.newGame(); }
    });
    // The clock waits while the tab is hidden, and so do the backs' animations.
    d.addEventListener('visibilitychange', function () {
      d.documentElement.classList.toggle('zc-paused', d.hidden);
      if (d.hidden && running) { halt(); resume = true; } else if (!d.hidden && resume) { resume = false; run(); }
    });
    return s;
  }

  // Describe a pile for assistive tech: "Tableau 3, 5 cards, top 7 of hearts".
  function describePile(name, ids, topVisible) {
    var n = ids.length;
    return name + ', ' + (n === 0 ? 'empty' : n + (n === 1 ? ' card' : ' cards') + (topVisible ? ', top ' + cardName(ids[n - 1]) : ''));
  }
  // How far each card of a fan steps down so the tallest pile fits: `weight`
  // is the pile's step count, `room` the height under its first card.
  function fanStep(weight, room, ch, maxStep, minStep) {
    return Math.max(minStep, Math.min(maxStep, weight > 0 ? (room - ch) / weight : maxStep));
  }

  loadBack();
  root.ZimiCards = {
    SUITS: SUITS, RANK_LABELS: RANK_LABELS, KING: KING, DECK: DECK, BACKS: BACKS,
    rank: rank, suit: suit, isRed: isRed, make: make, cardName: cardName, clone: clone,
    foundationAccepts: foundationAccepts, stacksOn: stacksOn, isRun: isRun, shuffled: shuffled, msDeal: msDeal,
    moonPhase: moonPhase, moonLitPath: moonLitPath, faceMarkup: faceMarkup, backMarkup: backMarkup,
    fmtTime: fmtTime, describePile: describePile, fanStep: fanStep,
    store: store, createStats: createStats, h: h, sheet: sheet, segmented: segmented, backsSheet: backsSheet, backsRow: backsRow,
    createBoard: createBoard, createSession: createSession, ensureSprite: ensureSprite,
    currentBack: function () { return currentBack; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
