/* ZimiGames cards: the pieces every card game shares. Rules helpers and the
   Microsoft deal (pure, tested in node), the card faces and animated backs
   (SVG), the board (layout, drag, tap, keyboard, the win cascade) and the
   session (undo, clock, stats, win sheet). A game supplies its rules and a
   `place` function; nothing here knows Klondike from FreeCell. */
(function (root) {
  'use strict';

  // ── Cards ─────────────────────────────────────────────────────────────
  // A card is 0..51: suit * 13 + (rank - 1). Suits in the Microsoft deck's
  // order, so the deal reads straight off its algorithm.
  // Every visible and spoken string goes through ZimiText (text.js); a page that has none shows the string's id.
  var T = function (key, vars) { return root.ZimiText ? root.ZimiText.T(key, vars) : key; };
  var SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
  var RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var RANK_NAMES = ['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];
  var DECK = 52;
  var KING = 13;

  function rank(id) { return id % 13 + 1; }
  // Ids past 51 are further copies of the same 52 faces (Spider deals two decks).
  function suit(id) { return Math.floor((id % DECK) / 13); }
  function isRed(id) { var s = suit(id); return s === 1 || s === 2; }
  function make(r, s) { return s * 13 + r - 1; }
  function cardName(id) { return T('cards.name', { rank: T('cards.rank.' + rank(id)), suit: T('cards.suit.' + SUITS[suit(id)]) }); }
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

  // ── The Zimi deck ─────────────────────────────────────────────────────
  // Original French-suited deck. Everything is drawn: indices are stroked
  // paths (no font is ever needed), courts are geometric busts built from a
  // few shapes, and the Ace of Spades carries the ZimiGames mark. One face is
  // one SVG in a 100x140 box. Detail that cannot be seen on a small card is
  // marked `zc-fine`, a small card's own layout `zc-small` / `zc-idx-row`:
  // cards.css switches them by the card's width (container query), so the
  // same markup serves a phone's Spider (33 px) and a desktop's Solitaire.
  // Suit shapes centred on 0,0 inside ±10; one sprite, `use`d by every card.
  // The four suits as one family at card-maker proportions (clubs, diamonds, hearts, spades; a 20-unit box each): the spade's
  // cusp and flared stem are reused by the club; heart and diamond are matched to them for height and weight.
  var SUIT_SHAPES = [
    '<circle cy="-5.3" r="4.8"/><circle cx="-5.5" cy="1.7" r="4.8"/><circle cx="5.5" cy="1.7" r="4.8"/><circle cy="0.4" r="3.4"/><path d="M-2.1 3C-2.1 7-2.8 9-5 10H5C2.8 9 2.1 7 2.1 3Z"/>',
    '<path d="M0-10.6C1.5-6.4 4.8-2.8 8.6 0 4.8 2.8 1.5 6.4 0 10.6-1.5 6.4-4.8 2.8-8.6 0-4.8-2.8-1.5-6.4 0-10.6Z"/>',
    '<path d="M0 9.8C-1.8 7.6-10.4 2.6-10.4-3.4-10.4-7.4-7.6-9.8-4.9-9.8-2.7-9.8-.9-8.6 0-6.6 .9-8.6 2.7-9.8 4.9-9.8 7.6-9.8 10.4-7.4 10.4-3.4 10.4 2.6 1.8 7.6 0 9.8Z"/>',
    '<path d="M0-10.2C1-7.6 4.4-5.2 7.4-2.4 10.6 .6 10.8 5.6 6.8 6.8 4.9 7.3 3.1 6.7 2.1 5.3 2.2 7.6 2.9 9 5.2 10H-5.2C-2.9 9-2.2 7.6-2.1 5.3-3.1 6.7-4.9 7.3-6.8 6.8-10.8 5.6-10.6 .6-7.4-2.4-4.4-5.2-1 -7.6 0-10.2Z"/>'
  ];
  // The Italian suits, in the same hand: coins, cups, swords, clubs.
  var ITALIAN_SUITS = ['coins', 'cups', 'swords', 'clubs'];
  var ITALIAN_NAMES = ['ace', '2', '3', '4', '5', '6', '7', 'fante', 'cavallo', 're'];
  var ITALIAN_SHAPES = [
    '<path fill-rule="evenodd" d="M-9.5 0a9.5 9.5 0 1 0 19 0 9.5 9.5 0 1 0-19 0zM-6.6 0a6.6 6.6 0 1 1 13.2 0 6.6 6.6 0 1 1-13.2 0z"/><path d="M0-4.6 1.4-1.4 4.6 0 1.4 1.4 0 4.6-1.4 1.4-4.6 0-1.4-1.4z"/>',
    '<path d="M-8-9.5H8C8-3 4.6 0.6 1.7 1.6V6.4H6.4V9.8H-6.4V6.4H-1.7V1.6C-4.6 0.6-8-3-8-9.5z"/>',
    '<path d="M0-11 2.1-8.2V2.4H-2.1V-8.2z"/><path d="M-7 3H7V5.2H-7z"/><path d="M-1.2 5.2H1.2V8.2H-1.2z"/><circle cy="9.1" r="1.6"/>',
    '<g transform="rotate(32)"><path d="M-2.5-8.4a2.5 2.5 0 0 1 5 0V7.4a2.5 2.5 0 0 1-5 0z"/><circle cx="-3.6" cy="-3.4" r="1.8"/><circle cx="3.6" cy="0.8" r="1.8"/></g>'
  ];
  var ITALIAN_COLOURS = ['#b87500', '#c62828', '#2c4a86', '#2f7d4f'];
  var CARD_RED = '#b3261e', CARD_BLACK = '#1b1b1b', CARD_CREAM = '#fdfcf8', CARD_EDGE = '#c9c4b8'; // games.css tokens, repeated for the cascade's bitmaps
  var GOLD = '#e09400', MARK_FROM = '#fb8c14', MARK_TO = '#f2582a'; // Zimi's amber, and the two ends of the Z's gradient
  var FACE_W = 100, FACE_H = 140, ACE_SCALE = 3.3, ACE_SPADE_SCALE = 3.9;
  // The Ace of Spades carries the maker's mark: the Z alone, in the spade's belly (centre 0.3 of the spade's 20-unit box below its middle,
  // 9 units tall, clear of the outline on every side).
  var ACE_Z_DY = 0.3, ACE_Z_UNITS = 5.4, ACE_Z_Y = 70 + ACE_Z_DY * ACE_SPADE_SCALE, ACE_Z_H = ACE_Z_UNITS * ACE_SPADE_SCALE, BACK_Z_H = 32.2; // and the Zimi back's
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

  // The mark's numbers (the pebble, and the Z of Zimi's icon centred on 0,0 for the cards).
  // zimi-mark:begin -- generated by scripts/icons/build.py from icon.png's Z and the pebble; do not edit by hand
  var ZMARK = { box: '2 2 36 33', defs: '<linearGradient id="zmz" gradientUnits="userSpaceOnUse" x1="3.8999999999999986" y1="2.6999999999999993" x2="34.9" y2="33.7"><stop offset="0" stop-color="#f59e0b"/><stop offset=".5" stop-color="#f97316"/><stop offset="1" stop-color="#ef4444"/></linearGradient><linearGradient id="zmps" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f1a17"/><stop offset=".55" stop-color="#0d0b0a"/><stop offset="1" stop-color="#070605"/></linearGradient><filter id="zmpd" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.6" flood-color="#000" flood-opacity=".45"/></filter>', body: '<path d="M34.43 16.09C34.51 16.75 34.53 17.43 34.48 18.09C34.42 18.75 34.30 19.42 34.11 20.06C33.92 20.70 33.66 21.33 33.35 21.93C33.03 22.52 32.65 23.10 32.22 23.63C31.80 24.17 31.31 24.67 30.79 25.14C30.28 25.60 29.71 26.03 29.13 26.42C28.54 26.81 27.92 27.17 27.28 27.49C26.64 27.82 25.97 28.11 25.29 28.38C24.61 28.64 23.91 28.87 23.19 29.08C22.48 29.29 21.75 29.47 21.00 29.61C20.26 29.76 19.50 29.88 18.74 29.96C17.98 30.04 17.20 30.09 16.43 30.09C15.66 30.08 14.88 30.04 14.12 29.94C13.36 29.84 12.59 29.69 11.87 29.48C11.14 29.26 10.43 28.99 9.77 28.67C9.11 28.34 8.48 27.94 7.91 27.50C7.35 27.06 6.82 26.56 6.38 26.02C5.93 25.48 5.54 24.88 5.23 24.27C4.92 23.66 4.68 23.01 4.51 22.35C4.34 21.69 4.24 21.01 4.20 20.34C4.17 19.66 4.20 18.98 4.29 18.31C4.38 17.64 4.54 16.98 4.74 16.33C4.94 15.68 5.20 15.05 5.50 14.43C5.80 13.82 6.16 13.22 6.55 12.64C6.94 12.06 7.38 11.50 7.85 10.98C8.33 10.45 8.85 9.94 9.40 9.47C9.96 9.00 10.56 8.55 11.19 8.14C11.82 7.74 12.49 7.37 13.18 7.05C13.87 6.73 14.61 6.45 15.35 6.22C16.09 5.99 16.87 5.81 17.64 5.69C18.42 5.57 19.21 5.50 19.99 5.48C20.78 5.47 21.57 5.51 22.34 5.60C23.11 5.70 23.88 5.85 24.62 6.05C25.35 6.25 26.08 6.50 26.76 6.80C27.45 7.09 28.11 7.44 28.73 7.83C29.35 8.21 29.94 8.64 30.48 9.10C31.01 9.57 31.52 10.07 31.96 10.60C32.40 11.13 32.80 11.70 33.14 12.29C33.47 12.88 33.76 13.50 33.97 14.14C34.19 14.77 34.34 15.43 34.43 16.09Z" fill="url(#zmps)" filter="url(#zmpd)"/><path d="M34.43 16.09C34.51 16.75 34.53 17.43 34.48 18.09C34.42 18.75 34.30 19.42 34.11 20.06C33.92 20.70 33.66 21.33 33.35 21.93C33.03 22.52 32.65 23.10 32.22 23.63C31.80 24.17 31.31 24.67 30.79 25.14C30.28 25.60 29.71 26.03 29.13 26.42C28.54 26.81 27.92 27.17 27.28 27.49C26.64 27.82 25.97 28.11 25.29 28.38C24.61 28.64 23.91 28.87 23.19 29.08C22.48 29.29 21.75 29.47 21.00 29.61C20.26 29.76 19.50 29.88 18.74 29.96C17.98 30.04 17.20 30.09 16.43 30.09C15.66 30.08 14.88 30.04 14.12 29.94C13.36 29.84 12.59 29.69 11.87 29.48C11.14 29.26 10.43 28.99 9.77 28.67C9.11 28.34 8.48 27.94 7.91 27.50C7.35 27.06 6.82 26.56 6.38 26.02C5.93 25.48 5.54 24.88 5.23 24.27C4.92 23.66 4.68 23.01 4.51 22.35C4.34 21.69 4.24 21.01 4.20 20.34C4.17 19.66 4.20 18.98 4.29 18.31C4.38 17.64 4.54 16.98 4.74 16.33C4.94 15.68 5.20 15.05 5.50 14.43C5.80 13.82 6.16 13.22 6.55 12.64C6.94 12.06 7.38 11.50 7.85 10.98C8.33 10.45 8.85 9.94 9.40 9.47C9.96 9.00 10.56 8.55 11.19 8.14C11.82 7.74 12.49 7.37 13.18 7.05C13.87 6.73 14.61 6.45 15.35 6.22C16.09 5.99 16.87 5.81 17.64 5.69C18.42 5.57 19.21 5.50 19.99 5.48C20.78 5.47 21.57 5.51 22.34 5.60C23.11 5.70 23.88 5.85 24.62 6.05C25.35 6.25 26.08 6.50 26.76 6.80C27.45 7.09 28.11 7.44 28.73 7.83C29.35 8.21 29.94 8.64 30.48 9.10C31.01 9.57 31.52 10.07 31.96 10.60C32.40 11.13 32.80 11.70 33.14 12.29C33.47 12.88 33.76 13.50 33.97 14.14C34.19 14.77 34.34 15.43 34.43 16.09Z" fill="none" stroke="#fff" stroke-opacity=".10" stroke-width=".6"/><path d="M13.548 25.638L25.252 25.638L25.252 22.085L19.008 22.085L19.008 21.867L25.002 13.617L25.002 10.762L13.602 10.762L13.602 14.315L19.542 14.315L19.542 14.522L13.548 22.783Z" fill="url(#zmz)"/>', zc: 'M-5.852 7.438L5.852 7.438L5.852 3.885L-0.392 3.885L-0.392 3.667L5.602 -4.583L5.602 -7.438L-5.798 -7.438L-5.798 -3.885L0.142 -3.885L0.142 -3.678L-5.852 4.583Z', zh: 14.876, stops: [['0','#f59e0b'],['.5','#f97316'],['1','#ef4444']] };
  // zimi-mark:end
  var MARK_GRADIENT = '<linearGradient id="zc-g-mark" x1="0" y1="0" x2="1" y2="1">' + ZMARK.stops.map(function (s) { return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"/>'; }).join('') + '</linearGradient>';
  // The Z centred on cx,cy, `h` tall, in the mark's gradient.
  function markZ(cx, cy, h) {
    return '<path transform="translate(' + cx + ' ' + cy + ') scale(' + (h / ZMARK.zh) + ')" d="' + ZMARK.zc + '" fill="url(#zc-g-mark)"/>';
  }

  // Index glyphs: stroked paths on a 10 x 14 grid, square ends and mitred
  // corners like the Z's. `w` is the advance for the ones that are not 10.
  var GLYPH_STROKE = 2.4;
  var GLYPHS = {
    A: { d: 'M0 14 5 0 10 14M2.2 9.4H7.8' },
    '1': { d: 'M1.2 3.2 5 0V14', w: 6 },
    '2': { d: 'M1 4.6C1 1.6 3 0 5 0S9.2 1.6 9.2 4.2C9.2 7 6 9.6 1 14H10' },
    '3': { d: 'M1 1H9L4.6 6C8.6 6 10 8 10 10 10 12.6 8 14 5 14 2.6 14 1.2 13 .8 11.4' },
    '4': { d: 'M7.6 14V0L0 10H10.6' },
    '5': { d: 'M9 0H1.8L1 6.4C2 5.6 3.4 5.2 5 5.2 8 5.2 9.6 7.4 9.6 9.7 9.6 12.4 7.6 14 5 14 2.8 14 1.4 13 .8 11.4' },
    '6': { d: 'M8.6 1.2C7.6.4 6.4 0 5.2 0 2.4 0 .8 3 .8 8 .8 12 2.4 14 5 14 7.6 14 9.2 12.2 9.2 9.6 9.2 7.4 7.6 5.8 5.2 5.8 3.2 5.8 1.6 6.8.8 8.4' },
    '7': { d: 'M.4 0H9.8L3.8 14' },
    '8': { d: 'M5 0C2.6 0 1.2 1.4 1.2 3.4 1.2 5.4 2.8 6.6 5 7 7.4 7.4 9.2 8.6 9.2 10.6 9.2 12.6 7.4 14 5 14 2.6 14 .8 12.6.8 10.6.8 8.6 2.6 7.4 5 7 7.2 6.6 8.8 5.4 8.8 3.4 8.8 1.4 7.4 0 5 0z' },
    '9': { d: 'M8.6 1.2C7.6.4 6.4 0 5.2 0 2.4 0 .8 3 .8 8 .8 12 2.4 14 5 14 7.6 14 9.2 12.2 9.2 9.6 9.2 7.4 7.6 5.8 5.2 5.8 3.2 5.8 1.6 6.8.8 8.4', turn: true },
    '10': { d: 'M1.2 3.2 4.6 0V14M11 0C8 0 6.8 3 6.8 7S8 14 11 14 14.8 11 14.8 7 14 0 11 0z', w: 15 },
    J: { d: 'M8 0V9.6C8 12.6 6.4 14 4.2 14 2.2 14 .8 13 .3 11' },
    Q: { d: 'M5 0C2 0 .8 3 .8 7S2 14 5 14 9.2 11 9.2 7 8 0 5 0zM6 10.4 10.2 15.4' },
    K: { d: 'M1 0V14M9.6 0 1 8M3.8 6 10 14' },
    // Spanish courts' 11 and 12.
    '11': { d: 'M1.2 3.2 5 0V14M8.2 3.2 12 0V14', w: 13 },
    '12': { d: 'M1.2 3.2 5 0V14M8 4.6C8 1.6 10 0 12 0S16.2 1.6 16.2 4.2C16.2 7 13 9.6 8 14H17', w: 17.2 }
  };
  function glyphWidth(label) { return GLYPHS[label].w === undefined ? 10 : GLYPHS[label].w; }
  // A glyph, centred on x with its top at y, `s` times its grid size.
  function glyph(label, x, y, s) {
    var g = GLYPHS[label];
    return '<path transform="translate(' + (x - glyphWidth(label) * s / 2) + ' ' + y + ')' + (g.turn ? ' rotate(180 ' + 5 * s + ' ' + 7 * s + ')' : '') + ' scale(' + s + ')" d="' + g.d +
      '" fill="none" stroke="currentColor" stroke-width="' + GLYPH_STROKE + '" stroke-linejoin="miter" stroke-miterlimit="6"/>';
  }

  // Suits come from the page's sprite (`use`) or, for the cascade's bitmaps,
  // inline. `shapes` is the set (French or Italian) and `prefix` its sprite ids.
  function placed(s, x, y, scale, turn, standalone, shapes, prefix) {
    var shape = standalone ? (shapes || SUIT_SHAPES)[s] : '<use href="#' + (prefix || 'zc-s-') + s + '"/>';
    return '<g transform="translate(' + x + ' ' + y + ')' + (turn ? ' rotate(180)' : '') + ' scale(' + scale + ')">' + shape + '</g>';
  }

  // The corner index: rank above suit, and again on the far corner. A small
  // card gets the row version instead (rank beside suit, much larger), which
  // still reads in the sliver a fanned pile shows.
  // The index keeps a clear margin to the card's edge, like a printed card's (IDX_MARGIN units of the 100 x 140 face to
  // the outside of the stroke): the rank is set from the left edge in, whatever its width, and small enough to clear the
  // courts' frame.
  var IDX_MARGIN = 5.5, IDX_SCALE = 1.2, IDX_SCALE_TEN = 0.95, IDX_TEN_DROP = 1.4, IDX_SUIT_GAP = 12, IDX_SUIT_SCALE = 0.65;
  var ROW_MARGIN = 6, ROW_SCALE = 2.1, ROW_SUIT_X = 63, ROW_SUIT_Y = 23, ROW_SUIT_SCALE = 1.25;
  function indexMarkup(label, s, standalone, shapes, prefix) {
    var ten = label.length > 1, sc = ten ? IDX_SCALE_TEN : IDX_SCALE, half = GLYPH_STROKE * sc / 2;
    var cx = IDX_MARGIN + half + glyphWidth(label) * sc / 2, top = IDX_MARGIN + half + (ten ? IDX_TEN_DROP : 0);
    var one = function (turn) {
      return '<g class="zc-idx-std"' + (turn ? ' transform="rotate(180 50 70)"' : '') + '>' + glyph(label, cx, top, sc) +
        placed(s, cx, top + 14 * sc + IDX_SUIT_GAP, IDX_SUIT_SCALE, false, standalone, shapes, prefix) + '</g>';
    };
    var rowTop = ROW_MARGIN + GLYPH_STROKE * ROW_SCALE / 2;
    var row = standalone ? '' : '<g class="zc-idx-row" display="none">' + glyph(label, ROW_MARGIN + GLYPH_STROKE * ROW_SCALE / 2 + glyphWidth(label) * ROW_SCALE / 2, rowTop, ROW_SCALE) +
      placed(s, ROW_SUIT_X, ROW_SUIT_Y, ROW_SUIT_SCALE, false, standalone, shapes, prefix) + '</g>';
    return one(false) + one(true) + row;
  }

  // ── The courts ───────────────────────────────────────────────────────
  // Flat, two-way, one hand: the suit's colour is the figure, cream the faces
  // and the gaps cut between overlapping parts, Zimi's gold the one accent
  // (crowns, belts, collars and what each figure holds). Jack, Queen and
  // King differ in silhouette (cap and feather / long hair, tiara and veil /
  // broad shoulders, tall crown and beard); the suit is told by what is held.
  var COURT_KINDS = ['jack', 'queen', 'king', 'fante', 'cavallo', 're'];
  var COURT_BASE = 63;
  var CUT = ' stroke="' + CARD_CREAM + '" stroke-width="0.9" stroke-linejoin="round"'; // a cream edge keeps parts of one colour apart
  var LINE = ' fill="none" stroke="currentColor" stroke-linecap="round"';
  var HAND_X = 70, HAND_Y = 61.5;
  function gold(d, extra) { return '<path d="' + d + '" fill="' + GOLD + '"' + (extra || '') + '/>'; }
  function dot(x, y, r, fill) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '"' + (fill ? ' fill="' + fill + '"' : '') + '/>'; }
  function pearls(pts) { return '<g class="zc-fine">' + pts.map(function (p) { return dot(p[0], p[1], 1.4); }).join('') + '</g>'; }
  function eyes(y, r) { return dot(46.6, y, r || 1.2) + dot(53.4, y, r || 1.2); }
  function head(cy, r) { return '<circle cx="50" cy="' + cy + '" r="' + r + '" fill="' + CARD_CREAM + '" stroke="currentColor" stroke-width="1.5"/>'; }
  function shaft(top, w) { return '<path d="M' + HAND_X + ' ' + HAND_Y + 'V' + top + '" stroke="currentColor" stroke-width="' + (w || 1.9) + '" fill="none"/>'; }
  function round3(cx, cy, r) { return gold('M' + cx + ' ' + (cy - r) + 'a' + r + ' ' + r + ' 0 1 1 0 ' + 2 * r + ' ' + r + ' ' + r + ' 0 1 1 0-' + 2 * r + 'z'); }
  // What each figure holds, by suit (clubs, diamonds, hearts, spades) then
  // kind (jack, queen, king): gold heads on suit-coloured shafts.
  var HELD = [
    [ // clubs: a trefoil staff, a flower, an orb and cross
      shaft(31) + round3(70, 26.8, 2.5) + round3(67.2, 31.4, 2.5) + round3(72.8, 31.4, 2.5),
      shaft(33, 1.5) + [[70, 24], [73.6, 26.8], [66.4, 26.8], [68, 31], [72, 31]].map(function (c) { return round3(c[0], c[1], 2.4); }).join('') + dot(70, 28.4, 1.4, CARD_CREAM),
      dot(HAND_X, 54, 4.8, GOLD) + '<path d="M65.2 54H74.8" stroke="currentColor" stroke-width="1" fill="none"/>' + '<path d="M70 43.6V49.4M67.6 46H72.4" stroke="' + GOLD + '" stroke-width="1.9" fill="none"/>'
    ],
    [ // diamonds: a spear, a hand mirror, an axe
      shaft(30) + gold('M70 17.6 73.6 25 70 32.8 66.4 25z'),
      '<path d="M70 62V44" stroke="currentColor" stroke-width="1.7" fill="none"/><circle cx="70" cy="35.4" r="7.4" fill="' + CARD_CREAM + '" stroke="' + GOLD + '" stroke-width="2.4"/>',
      shaft(26, 1.8) + gold('M70.6 24.4C77.4 22.4 78 35.4 70.6 36.6z')
    ],
    [ // hearts: a leaf, a rose, a sword
      shaft(32, 1.6) + gold('M70 38.4C63.6 34.4 64.8 25.4 70 28.8 75.2 25.4 76.4 34.4 70 38.4z'),
      shaft(38, 1.4) + gold('M70 35.6C64.6 35 62.6 29.4 63.2 25.8 68.8 25.4 71.6 29.6 70 35.6zM70 40C75.6 39.4 77.8 33.4 77 29.8 71.6 29.4 68.4 33.6 70 40z') + dot(70, 28.6, 4.3, GOLD) + dot(70, 28.6, 2, CARD_CREAM),
      '<path d="M70 62V28" stroke="currentColor" stroke-width="2.8" fill="none"/><path d="M70 21 72.4 28H67.6z" fill="currentColor"/>' + gold('M64.4 55.6H75.6L74.6 52.4H65.4z') + gold('M68.8 52.4H71.2V59H68.8z')
    ],
    [ // spades: a halberd, a crescent wand, a fleur sceptre
      shaft(25, 1.7) + gold('M70 25.6C74.6 23 77.4 24.2 76.6 28.4L73.6 30.8 70 32.6z') + '<path d="M70 19.6 71.8 25H68.2z" fill="currentColor"/>',
      shaft(32, 1.5) + gold('M70 21.4a6.4 6.4 0 1 0 6.4 6.4 5 5 0 1 1-6.4-6.4z'),
      shaft(34, 2.2) + gold('M70 21C66.8 24.8 64.8 26.8 64.8 29 64.8 31.2 66.6 32 68.2 31.2 67.6 33.6 66.2 35 64.2 36H75.8C73.8 35 72.4 33.6 71.8 31.2 73.4 32 75.2 31.2 75.2 29 75.2 26.8 73.2 24.8 70 21z')
    ]
  ];
  var HELD_KIND = { jack: 0, queen: 1, king: 2 };
  var HELD_SCALE = 1.18, HELD_SHAFT_X = 67.5;
  function held(kind, s) { return '<g transform="translate(' + HELD_SHAFT_X + ' ' + HAND_Y + ') scale(' + HELD_SCALE + ') translate(-' + HAND_X + ' -' + HAND_Y + ')">' + HELD[s][HELD_KIND[kind]] + '</g>'; }

  var BODIES = {
    jack: '<path d="M29 63 31.4 55.4C34.6 52.2 41 51 50 51S65.4 52.2 68.6 55.4L71 63z"/>',
    queen: '<path d="M31 63 33.4 56C37 52.4 43 51.4 50 51.4S63 52.4 66.6 56L69 63z"/>',
    king: '<path d="M24.6 63 27.6 55C32 51.2 41 50 50 50S68 51.2 72.4 55L75.4 63z"/>'
  };
  // A court figure's top half in the box x 24..76, y 17..63, standing on
  // y = 63. The card's other half is the same turned round, the suit between.
  // `compact` leaves out what a 33 px card cannot show: what is held, trims.
  function bust(kind, s, compact) {
    var out = BODIES[kind], fine = function (m) { return compact ? '' : m; };
    if (kind === 'jack') {
      out += '<path d="M41.2 46V39.6C41.2 31 58.8 31 58.8 39.6V46C57.6 45.8 57 45 56.8 44H43.2C43 45 42.4 45.8 41.2 46z"/>' + head(41.4, 7.2) +
        '<path d="M40.2 38.6C39 29.6 49 26 58.6 29.2 62.8 30.6 62.2 36.4 60 38.2 55 35.4 46 35.4 40.2 38.6z"/>' +
        '<path d="M40.8 38C46 35.4 55 35.4 59.8 37.8" fill="none" stroke="' + GOLD + '" stroke-width="1.7"/>' +
        gold('M58 29.6C63.4 28.4 67.8 24 68.4 18.8 64.6 21.2 62.2 22 56.4 26.4z') +
        eyes(41.8) + '<path d="M48.2 45.8Q50 47 51.8 45.8"' + LINE + ' stroke-width="1"/>' +
        '<path d="M31 59.6H69" stroke="' + GOLD + '" stroke-width="2.2"/>' +
        fine('<path d="M43.4 51.6 50 58.4 56.6 51.6" fill="none" stroke="' + GOLD + '" stroke-width="1.9"/><rect x="47.2" y="57.6" width="5.6" height="4" fill="' + CARD_CREAM + '" stroke="currentColor" stroke-width="0.9"/>');
    } else if (kind === 'queen') {
      out = '<path d="M41.6 29C33.8 35 33.4 49 31 63H40.4C41 55 41.4 44 42.6 36z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="0.9"/>' +
        '<path d="M58.4 29C66.2 35 66.6 49 69 63H59.6C59 55 58.6 44 57.4 36z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="0.9"/>' + out +
        '<path d="M41 40C41 31 59 31 59 40C60.6 47 60.4 54 58.4 58.4L55.6 55.6C56.6 51 56.4 47.2 56.8 44.6H43.2C43.6 47.2 43.4 51 44.4 55.6L41.6 58.4C39.6 54 39.4 47 41 40z"' + CUT + '/>' + head(41.6, 7) +
        gold('M42.4 34.6 41.2 25.4 46 29.4 50 22.6 54 29.4 58.8 25.4 57.6 34.6z') + dot(50, 28.6, 1.3, CARD_CREAM) + pearls([[41.2, 24.8], [58.8, 24.8], [50, 21.8]]) +
        eyes(42, 1.15) + '<path d="M44.8 40.2 48 40M52 40 55.2 40.2"' + LINE + ' stroke-width="0.8"/>' + '<ellipse cx="50" cy="46.2" rx="1.9" ry="1" fill="' + GOLD + '"/>' +
        '<path d="M43 53.2C44.6 61 55.4 61 57 53.2" fill="none" stroke="' + GOLD + '" stroke-width="1.8"/>' +
        fine(dot(46.2, 59.4, 1.2, GOLD) + dot(50, 60.6, 1.3, GOLD) + dot(53.8, 59.4, 1.2, GOLD));
    } else {
      out += '<path d="M28 59C36 53 45 54.6 50 58.6 55 54.6 64 53 72 59L73.4 63H26.6z" fill="' + CARD_CREAM + '" stroke="currentColor" stroke-width="1.1"/>' +
        fine('<g fill="currentColor"><circle cx="33" cy="59.4" r="1.1"/><circle cx="39" cy="57.2" r="1.1"/><circle cx="61" cy="57.2" r="1.1"/><circle cx="67" cy="59.4" r="1.1"/></g>') +
        '<path d="M40.4 41C40.4 34 59.6 34 59.6 41V48H40.4z"/>' + head(41.4, 7.4) +
        '<path d="M42 43C41 52.8 45 58 50 58.8S59 52.8 58 43C56.6 46.4 53.6 48 50 48S43.4 46.4 42 43z"' + CUT + '/>' +
        '<path d="M44 46.4Q47 44.6 50 46.4Q53 44.6 56 46.4Q53.4 49.2 50 47.8Q46.6 49.2 44 46.4z"' + CUT + '/>' +
        eyes(40.8, 1.2) + '<path d="M44.4 37.8 48.6 38.6M55.6 37.8 51.4 38.6"' + LINE + ' stroke-width="1.1"/>' +
        gold('M40.6 33.8 38.2 20.4 44.6 26 50 18.4 55.4 26 61.8 20.4 59.4 33.8z') + '<path d="M40.8 31.4H59.2" stroke="currentColor" stroke-width="1.1" fill="none"/>' +
        pearls([[38.2, 19.8], [50, 17.6], [61.8, 19.8]]);
    }
    return out + (compact ? '' : held(kind, s));
  }

  // The Italian courts: one upright figure to a card, in the same hand.
  // Fante, a page in parti-coloured hose; Cavallo, a rider on his horse; Re, a
  // crowned king in his mantle. Each holds his suit's own emblem (the sprite).
  var ITALIAN_BASE = 99, ITALIAN_HELD_SCALE = [0.85, 0.95, 1.5, 1.35], ITALIAN_HELD_LIFT = [8, 9.5, 8, 9];
  function heldItalian(s, x, y, standalone, compact, set) {
    return compact ? '' : '<g paint-order="stroke"' + CUT + '>' + placed(s, x, y - ITALIAN_HELD_LIFT[s], ITALIAN_HELD_SCALE[s], false, standalone, set ? set.shapes : ITALIAN_SHAPES, set ? set.prefix : ITALIAN_PREFIX) + '</g>';
  }
  function italianFigure(kind, s, standalone, compact, set) {
    var hand = function (x, y) { return '<circle cx="' + x + '" cy="' + y + '" r="2.3" fill="' + CARD_CREAM + '" stroke="currentColor" stroke-width="1.2"/>'; };
    var limb = function (d, w) { return '<path d="' + d + '"' + LINE + ' stroke-width="' + w + '"/>'; };
    if (kind === 'fante') {
      return limb('M38.4 50 34 65', 4.4) + '<path d="M40 70H49.2L48.2 93H42z"/>' + '<path d="M50.8 70H60L58 93H51.8z" fill="' + CARD_CREAM + '" stroke="currentColor" stroke-width="1.3"/>' +
        gold('M40.8 93H48.4V96.4H39.4zM51.8 93H59.2L60.6 96.4H51.8z') +
        '<path d="M37 72 38.6 50C40 46.4 60 46.4 61.4 50L63 72z"/><path d="M38.4 63H61.6" stroke="' + GOLD + '" stroke-width="2.2" fill="none"/>' + limb('M62 50 66.8 62', 4.4) + hand(34, 66) + hand(67.4, 63.6) +
        '<path d="M43.2 48.6 50 55.6 56.8 48.6" fill="none" stroke="' + GOLD + '" stroke-width="1.8"/>' +
        '<path d="M43.6 42V36C43.6 29 56.4 29 56.4 36V42C55.4 41.6 55 40.4 55 39H45C45 40.4 44.6 41.6 43.6 42z"/>' + head(37.8, 6.2) +
        '<path d="M42 35.6C41 27.6 49 24.4 57.4 27.4 60.6 28.8 60.2 33.6 58.4 35.2 54 33 46.4 33 42 35.6z"/><path d="M42.4 35C46.6 32.8 53.6 32.8 57.6 34.8" fill="none" stroke="' + GOLD + '" stroke-width="1.5"/>' +
        gold('M56.6 28.4C61.4 27.4 64 25.6 64.6 23.6 62 24.8 60.4 25 55.8 26.6z') + eyes(38.4, 1) + '<path d="M47.6 42Q50 43.6 52.4 42"' + LINE + ' stroke-width="1"/>' + heldItalian(s, 68.6, 63.6, standalone, compact, set);
    }
    if (kind === 'cavallo') {
      return '<path d="M28.4 66C23 66 21.4 78 25.6 88 26 80 28.6 74.6 31 72z" fill="' + GOLD + '"/>' +
        '<path d="M33.6 76 31.6 93M40 77 41.4 93M57.4 78 63.4 85.6 60.8 93M62.8 76 69.6 82 69.4 92" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M28 71C27.4 64 34 61.6 41 61.6H59C62.6 61.6 64.4 65 64.4 69.4 64.4 75.8 60.4 80 56 80H34.4C30.6 80 28.4 76.6 28 71z"/>' +
        '<path d="M56 64C58.8 57 60.6 49.4 64 43.4L66.4 36.6 69 41.6 76 43.4C78.6 44.4 79.4 48 77 49.6L72.6 48.6C70 48.2 67.8 49.6 67 53C66 58 65.4 63.4 66.6 70z"/>' +
        gold('M59.6 50.4C58.4 56 57.8 60.6 57 64.4 54.4 62.4 54 60.8 54.6 58.4 57 56.6 58.2 53.4 59.6 50.4zM64.2 40.6 66.4 36.6 66.8 42z') + dot(72.4, 46.4, 1.1, CARD_CREAM) +
        '<path d="M39 63H55L56.4 77H37.6z" fill="' + CARD_CREAM + '" stroke="currentColor" stroke-width="1.2"/><path d="M38.2 73.4H55.8" stroke="' + GOLD + '" stroke-width="2.2" fill="none"/>' +
        '<path d="M44 47.4C44 44 53 44 53 47.4L55 63H42z"/>' + limb('M45 50 37.4 45', 3.8) + hand(36.4, 44.4) + '<path d="M44.4 62 50 64.4 49.4 78.4 45 77z"/>' +
        '<path d="M45.2 39.2V36C45.2 31 53 31 53 36V39.2C52 39.4 51.6 38.2 51.6 37H46.6C46.6 38.2 46.2 39.4 45.2 39.2z"/>' + head(38.8, 5.4) +
        '<path d="M43.4 37.2C42.6 31 48.4 28.6 54.4 30.6 56.6 31.6 56.4 35 55 36.2 52 34.4 46.6 34.4 43.4 37.2z"/>' +
        gold('M53.6 30.4C58 29.4 60.6 27.4 61 24.6 58.6 26 57.4 26.4 53.6 28z') + dot(48.2, 39.2, 0.95) + dot(51.6, 39.2, 0.95) +
        heldItalian(s, 36.4, 44.4, standalone, compact, set);
    }
    return '<path d="M31 99 36 54C37 49.6 63 49.6 64 54L69 99z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="0.9"/>' + // re: the king in his mantle
      '<path d="M35 99 39 53C40 48 60 48 61 53L65 99z"/><path d="M35.4 94.4H64.6V99H35.4z" fill="' + CARD_CREAM + '" stroke="currentColor" stroke-width="1.1"/>' +
      '<g class="zc-fine" fill="currentColor"><circle cx="40.5" cy="96.7" r="1"/><circle cx="46.5" cy="96.7" r="1"/><circle cx="53.5" cy="96.7" r="1"/><circle cx="59.5" cy="96.7" r="1"/></g>' +
      '<path d="M50 61V94" stroke="' + GOLD + '" stroke-width="1.8" fill="none"/><path d="M37.4 74H62.6" stroke="' + GOLD + '" stroke-width="2.2" fill="none"/>' +
      limb('M39.4 52 36 70', 4.6) + hand(36, 71.6) + limb('M60.6 52 66 64', 4.6) + hand(67, 65.6) +
      '<path d="M37 53C41 49.4 59 49.4 63 53L65 58C58 54 53 56.6 50 60 47 56.6 42 54 35 58z" fill="' + CARD_CREAM + '" stroke="currentColor" stroke-width="1.1"/>' +
      '<path d="M43 40V34H57V40C56.4 41.4 56 42.6 56 44H44C44 42.6 43.6 41.4 43 40z"/>' + head(38.8, 6.8) +
      '<path d="M43.8 41C43 49 46 53 50 53.6S57 49 56.2 41C55 43.6 52.8 44.8 50 44.8S45 43.6 43.8 41z"' + CUT + '/>' +
      '<path d="M45.6 42.4Q47.8 41 50 42.4Q52.2 41 54.4 42.4Q52.4 44.6 50 43.6Q47.6 44.6 45.6 42.4z"' + CUT + '/>' +
      eyes(37.4, 1.1) + '<path d="M44.8 34.8 48.4 35.4M55.2 34.8 51.6 35.4"' + LINE + ' stroke-width="1"/>' +
      gold('M43 32 41.4 24.4 46 27.6 50 22.4 54 27.6 58.6 24.4 57 32z') + '<path d="M43 30.2H57" stroke="currentColor" stroke-width="1" fill="none"/>' + heldItalian(s, 67, 65.6, standalone, compact, set);
  }

  var COURT_PIP_X = 31.5, COURT_PIP_Y = 27, COURT_PIP_SCALE = 0.55, COURT_BAND = 7, COURT_MID_PIP = 0.62;
  var SMALL_COURT = '<g class="zc-small" display="none" transform="translate(50 128) scale(1.55) translate(-50 -' + COURT_BASE + ')">';
  function courtMarkup(kind, s, standalone) {
    var half = bust(kind, s) + placed(s, COURT_PIP_X, COURT_PIP_Y, COURT_PIP_SCALE, false, standalone);
    var line = function (y) { return '<path d="M21 ' + y + 'H79" stroke="currentColor" stroke-width="0.8" opacity="0.55"/>'; };
    return '<g class="zc-big"><rect x="21" y="15" width="58" height="110" rx="3.5" fill="currentColor" fill-opacity="0.07" stroke="currentColor" stroke-width="1.2"/>' +
      '<rect class="zc-fine" x="23.6" y="17.6" width="52.8" height="104.8" rx="1.8" fill="none" stroke="' + GOLD + '" stroke-width="0.7"/>' +
      line(COURT_BASE) + line(140 - COURT_BASE) + '<path d="M26 70H40M60 70H74" stroke="' + GOLD + '" stroke-width="1"/>' +
      placed(s, 50, 70, COURT_MID_PIP, false, standalone) +
      '<g>' + half + '</g><g transform="rotate(180 50 70)">' + half + '</g></g>' +
      (standalone ? '' : SMALL_COURT + bust(kind, s, true) + '</g>');
  }

  // The same pip for the small card's simplified body.
  var SMALL_SUIT_Y = 92, SMALL_SUIT_SCALE = 3.1;
  function smallSuit(s, standalone, shapes, prefix, extra) {
    return standalone ? '' : '<g class="zc-small" display="none">' + placed(s, 50, SMALL_SUIT_Y, SMALL_SUIT_SCALE, false, false, shapes, prefix) + (extra || '') + '</g>';
  }

  // The svg around a face. `standalone` adds a card body and the defs, for
  // the bitmaps the cascade draws from.
  function faceFrame(inner, colour, standalone) {
    return standalone
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + FACE_W + ' ' + FACE_H + '" fill="currentColor" style="color:' + colour + '"><defs>' + MARK_GRADIENT + '</defs>' +
        '<rect x="0.5" y="0.5" width="99" height="139" rx="7.5" fill="' + CARD_CREAM + '" stroke="' + CARD_EDGE + '"/>' + inner + '</svg>'
      : '<svg viewBox="0 0 ' + FACE_W + ' ' + FACE_H + '" fill="currentColor" aria-hidden="true"' + (colour ? ' style="color:' + colour + '"' : '') + '>' + inner + '</svg>';
  }

  // One French-suited card face as SVG markup (ids 0..51, further decks
  // wrap). The page's card element sets the suit colour.
  function faceMarkup(id, standalone) {
    var r = rank(id), s = suit(id), label = RANK_LABELS[r - 1], body;
    if (r === 1) {
      var spadeAce = s === 3;
      body = '<g class="zc-big">' + placed(s, 50, 70, spadeAce ? ACE_SPADE_SCALE : ACE_SCALE, false, standalone) + (spadeAce ? markZ(50, ACE_Z_Y, ACE_Z_H) : '') + '</g>' +
        smallSuit(s, standalone, null, null, spadeAce ? markZ(50, SMALL_SUIT_Y + ACE_Z_DY * SMALL_SUIT_SCALE, ACE_Z_UNITS * SMALL_SUIT_SCALE) : '');
    } else if (r <= 10) {
      var pips = '';
      PIPS[r].forEach(function (p) { pips += placed(s, p[0], p[1], r >= DENSE_FROM ? PIP_SCALE_DENSE : PIP_SCALE, p[1] > FLIP_AFTER_Y, standalone); });
      body = '<g class="zc-big">' + pips + '</g>' + smallSuit(s, standalone);
    } else body = courtMarkup(COURT_KINDS[r - 11], s, standalone);
    return faceFrame(indexMarkup(label, s, standalone) + body, standalone ? (isRed(id) ? CARD_RED : CARD_BLACK) : '', standalone);
  }

  // The Italian deck, 40 cards: id = suit * 10 + (rank - 1), suits coins,
  // cups, swords, clubs; 1 to 7, then Fante (8), Cavallo (9), Re (10). The
  // court figures stand upright, one to a card, in the suit's own colour.
  function italianName(id) { return T('cards.name', { rank: T('cards.it.rank.' + ITALIAN_NAMES[id % 10]), suit: T('cards.it.suit.' + ITALIAN_SUITS[Math.floor(id / 10) % 4]) }); }
  var ITALIAN_PREFIX = 'zc-i-', ITALIAN_PIP_SCALE = 1.05;
  function italianFaceMarkup(id, standalone) {
    var r = id % 10 + 1, s = Math.floor(id / 10) % 4, body, p = ITALIAN_PREFIX;
    if (r === 1) body = '<g class="zc-big">' + placed(s, 50, 70, 3.4, false, standalone, ITALIAN_SHAPES, p) + '</g>' + smallSuit(s, standalone, ITALIAN_SHAPES, p);
    else if (r <= 7) {
      var pips = '';
      PIPS[r].forEach(function (pt) { pips += placed(s, pt[0], pt[1], ITALIAN_PIP_SCALE, false, standalone, ITALIAN_SHAPES, p); });
      body = '<g class="zc-big">' + pips + '</g>' + smallSuit(s, standalone, ITALIAN_SHAPES, p);
    } else {
      var kind = COURT_KINDS[r - 5]; // 8 fante, 9 cavallo, 10 re
      body = '<g class="zc-big"><rect x="20" y="20" width="60" height="100" rx="3.5" fill="currentColor" fill-opacity="0.07" stroke="currentColor" stroke-width="1.2"/>' +
        '<rect class="zc-fine" x="22.6" y="22.6" width="54.8" height="94.8" rx="1.8" fill="none" stroke="' + GOLD + '" stroke-width="0.7"/>' +
        italianFigure(kind, s, standalone) + '<path d="M20 ' + ITALIAN_BASE + 'H80" stroke="currentColor" stroke-width="0.8" opacity="0.5"/>' +
        placed(s, 50, 109.5, 0.75, false, standalone, ITALIAN_SHAPES, p) + '</g>' +
        (standalone ? '' : '<g class="zc-small" display="none" transform="translate(50 134) scale(1.1) translate(-50 -' + ITALIAN_BASE + ')">' + italianFigure(kind, s, false, true) + '</g>');
    }
    return faceFrame(indexMarkup(String(r), s, standalone, ITALIAN_SHAPES, p) + body, ITALIAN_COLOURS[s], standalone);
  }

  // A joker: a jester's three-pointed cap over a round face and a zigzag
  // collar, in black or red. Not part of the 0..51 ids.
  function jokerMarkup(red, standalone) {
    var star = function (x, y, k) { return '<path transform="translate(' + x + ' ' + y + ') scale(' + k + ')" d="M0-10 2.6-2.6 10 0 2.6 2.6 0 10-2.6 2.6-10 0-2.6-2.6z"/>'; };
    var gold = function (x, y) { return '<circle cx="' + x + '" cy="' + y + '" r="3.4" fill="' + GOLD + '"/>'; };
    var figure = '<path d="M33 66C28 50 30 38 36 28 40 40 44 46 50 47 56 46 60 40 64 28 70 38 72 50 67 66z"/>' + gold(36, 26.6) + gold(64, 26.6) + gold(50, 40) +
      '<circle cx="50" cy="66" r="12" fill="' + CARD_CREAM + '" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M30 92 36 82 42 92 50 82 58 92 64 82 70 92z" fill="' + GOLD + '"/><path d="M26 112C30 100 40 94 50 94S70 100 74 112z"/>';
    var inner = star(11, 18, 0.95) + '<g transform="rotate(180 50 70)">' + star(11, 18, 0.95) + '</g>' +
      '<rect x="24" y="22" width="52" height="96" rx="3.5" fill="currentColor" fill-opacity="0.07" stroke="currentColor" stroke-width="1.2"/>' + figure;
    return faceFrame(inner, red ? CARD_RED : CARD_BLACK, standalone);
  }

  // ── The Spanish deck, 40 cards ──────────────────────────────────────────
  // id = suit * 10 + k, suits oros, copas, espadas, bastos; k 0..9 is the
  // ace to the 7, then sota (10), caballo (11) and rey (12), the way a
  // Spanish baraja prints them. Same index, pips and size rules as the
  // others; the suits are drawn in the same hand (a sunburst coin, a lidded
  // goblet, a straight sword, a knotted baton) and the courts are the Italian
  // figures holding these emblems.
  var SPANISH_SUITS = ['oros', 'copas', 'espadas', 'bastos'];
  var SPANISH_NAMES = ['ace', '2', '3', '4', '5', '6', '7', 'sota', 'caballo', 'rey'];
  var SPANISH_LABELS = ['1', '2', '3', '4', '5', '6', '7', '10', '11', '12'];
  var SPANISH_PREFIX = 'zc-e-';
  var SPANISH_SHAPES = [
    '<path fill-rule="evenodd" d="M-9.5 0a9.5 9.5 0 1 0 19 0 9.5 9.5 0 1 0-19 0zM0-6.4 1.2-2.2 5-4.6 2.6-1 6.4 0 2.6 1 5 4.6 1.2 2.2 0 6.4-1.2 2.2-5 4.6-2.6 1-6.4 0-2.6-1-5-4.6-1.2-2.2z"/><circle r="1.7"/>',
    '<path d="M-6.4-9.6H6.4V-3.6C6.4-0.2 3.4 1.8 0 1.8S-6.4-0.2-6.4-3.6z"/><path d="M-6.4-6.8C-11.4-6.8-11.4-1.2-6-1.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6.4-6.8C11.4-6.8 11.4-1.2 6-1.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M-1.3 1.8H1.3V6.2H-1.3z"/><path d="M-4.4 7.2H4.4L5.4 10H-5.4z"/>',
    '<g transform="rotate(-24)"><path d="M0-11 2.2-8.6V3.2H-2.2V-8.6z"/><path d="M-7 3.2Q0 0.4 7 3.2V5.6Q0 3.2-7 5.6z"/><path d="M-1.2 5.6H1.2V8.6H-1.2z"/><circle cy="9.7" r="1.5"/></g>',
    '<g transform="rotate(-34)"><path d="M-3.8-8.6a3.8 3.8 0 0 1 7.6 0L2.2 9.2a2.2 2.2 0 0 1-4.4 0z"/><circle cx="4.4" cy="-2.6" r="2.3"/><circle cx="-4.2" cy="2.4" r="2.3"/><circle cx="3.6" cy="6" r="1.8"/></g>'
  ];
  function spanishName(id) { return T('cards.name', { rank: T('cards.es.rank.' + SPANISH_NAMES[id % 10]), suit: T('cards.es.suit.' + SPANISH_SUITS[Math.floor(id / 10) % 4]) }); }
  function spanishFaceMarkup(id, standalone) {
    var k = id % 10, r = k + 1, s = Math.floor(id / 10) % 4, body, p = SPANISH_PREFIX, set = { shapes: SPANISH_SHAPES, prefix: p };
    if (r === 1) body = '<g class="zc-big">' + placed(s, 50, 70, 3.4, false, standalone, SPANISH_SHAPES, p) + '</g>' + smallSuit(s, standalone, SPANISH_SHAPES, p);
    else if (r <= 7) {
      var pips = '';
      PIPS[r].forEach(function (pt) { pips += placed(s, pt[0], pt[1], ITALIAN_PIP_SCALE, false, standalone, SPANISH_SHAPES, p); });
      body = '<g class="zc-big">' + pips + '</g>' + smallSuit(s, standalone, SPANISH_SHAPES, p);
    } else {
      var kind = COURT_KINDS[r - 5]; // 8 sota (fante), 9 caballo, 10 rey
      body = '<g class="zc-big"><rect x="20" y="20" width="60" height="100" rx="3.5" fill="currentColor" fill-opacity="0.07" stroke="currentColor" stroke-width="1.2"/>' +
        '<rect class="zc-fine" x="22.6" y="22.6" width="54.8" height="94.8" rx="1.8" fill="none" stroke="' + GOLD + '" stroke-width="0.7"/>' +
        italianFigure(kind, s, standalone, false, set) + '<path d="M20 ' + ITALIAN_BASE + 'H80" stroke="currentColor" stroke-width="0.8" opacity="0.5"/>' +
        placed(s, 50, 109.5, 0.75, false, standalone, SPANISH_SHAPES, p) + '</g>' +
        (standalone ? '' : '<g class="zc-small" display="none" transform="translate(50 134) scale(1.1) translate(-50 -' + ITALIAN_BASE + ')">' + italianFigure(kind, s, false, true, set) + '</g>');
    }
    return faceFrame(indexMarkup(SPANISH_LABELS[k], s, standalone, SPANISH_SHAPES, p) + body, ITALIAN_COLOURS[s], standalone);
  }

  // ── The Hanafuda deck, 48 cards ─────────────────────────────────────────
  // id = month * 4 + k (months January to December, k 0..3). Each month has
  // its plant, drawn flat in one colour; the special card of a month (a
  // bright, an animal, a ribbon) is laid over it. A card is told by its
  // month number and a corner badge: a gold disc for a bright, an ink diamond
  // for an animal, a ribbon for a ribbon, a dot for chaff. Ribbons keep their
  // own red or blue so a game can be read at a glance. The art sits outside
  // `zc-big`, so a 33 px card still shows it under the large row index.
  var HANA_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var HANA_PLANTS = ['pine', 'plum', 'cherry', 'wisteria', 'iris', 'peony', 'bush clover', 'pampas', 'chrysanthemum', 'maple', 'willow', 'paulownia'];
  var HANA_COLOURS = ['#2f7d4f', '#c93a5e', '#e5628a', '#8b5fc7', '#3c4fb0', '#c2185b', '#b8324a', '#a97a2c', '#e07b00', '#d1451b', '#3a9a6a', '#6b3f8c'];
  // [kind, name, ribbon] for k = 0..3 of each month; kind: bright, animal, ribbon, chaff. The sake cup also counts as chaff in Koi-Koi.
  var HANA_CARDS = [
    [['bright', 'crane and sun'], ['ribbon', 'poetry ribbon', 'poetry'], ['chaff', 'pine'], ['chaff', 'pine']],
    [['animal', 'bush warbler'], ['ribbon', 'poetry ribbon', 'poetry'], ['chaff', 'plum'], ['chaff', 'plum']],
    [['bright', 'curtain'], ['ribbon', 'poetry ribbon', 'poetry'], ['chaff', 'cherry'], ['chaff', 'cherry']],
    [['animal', 'cuckoo'], ['ribbon', 'red ribbon', 'red'], ['chaff', 'wisteria'], ['chaff', 'wisteria']],
    [['animal', 'bridge'], ['ribbon', 'red ribbon', 'red'], ['chaff', 'iris'], ['chaff', 'iris']],
    [['animal', 'butterflies'], ['ribbon', 'blue ribbon', 'blue'], ['chaff', 'peony'], ['chaff', 'peony']],
    [['animal', 'boar'], ['ribbon', 'red ribbon', 'red'], ['chaff', 'bush clover'], ['chaff', 'bush clover']],
    [['bright', 'moon'], ['animal', 'geese'], ['chaff', 'pampas'], ['chaff', 'pampas']],
    [['animal', 'sake cup'], ['ribbon', 'blue ribbon', 'blue'], ['chaff', 'chrysanthemum'], ['chaff', 'chrysanthemum']],
    [['animal', 'deer'], ['ribbon', 'blue ribbon', 'blue'], ['chaff', 'maple'], ['chaff', 'maple']],
    [['bright', 'rain man'], ['animal', 'swallow'], ['ribbon', 'red ribbon', 'red'], ['chaff', 'lightning']],
    [['bright', 'phoenix'], ['chaff', 'paulownia'], ['chaff', 'paulownia'], ['chaff', 'paulownia']]
  ];
  function hanafudaCard(id) {
    var m = Math.floor(id / 4) % 12, k = id % 4, c = HANA_CARDS[m][k];
    return { month: m, k: k, kind: c[0], name: c[1], ribbon: c[2] || null, sake: m === 8 && k === 0 };
  }
  var hanaMonth = function (m, style) { return root.ZimiText ? root.ZimiText.month(m, style) : HANA_MONTHS[m]; };
  function hanafudaName(id) {
    var c = hanafudaCard(id);
    var name = T('cards.hana.' + c.name.replace(/ /g, '_'));
    return T(c.kind === 'chaff' ? 'cards.hana.chaff' : 'cards.hana.card', { name: name, month: hanaMonth(c.month) });
  }

  var HANA_LEAF = '#2f7d4f', HANA_WOOD = '#7a5230', HANA_SKY = '#2c4a86';
  var rd1 = function (n) { return Math.round(n * 10) / 10; };
  var inkP = function (d, extra) { return '<path d="' + d + '" fill="' + CARD_BLACK + '"' + (extra || '') + '/>'; };
  var leafP = function (d) { return '<path d="' + d + '" fill="' + HANA_LEAF + '"/>'; };
  var strokeP = function (d, w, col) { return '<path d="' + d + '" fill="none" stroke="' + (col || CARD_BLACK) + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round"/>'; };
  var ellipseP = function (cx, cy, rx, ry, fill, rot, extra) {
    return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '"' + (rot ? ' transform="rotate(' + rot + ' ' + cx + ' ' + cy + ')"' : '') + (extra || '') + '/>';
  };
  // Five round petals round a gold heart; cherry's get a notch cut in each tip.
  function hanaBlossom(x, y, r, notch) {
    var o = '', i, a;
    for (i = 0; i < 5; i++) {
      a = (i * 72 - 90) * Math.PI / 180;
      o += dot(rd1(x + Math.cos(a) * r * 0.95), rd1(y + Math.sin(a) * r * 0.95), rd1(r * 0.72));
      if (notch) o += dot(rd1(x + Math.cos(a) * r * 1.62), rd1(y + Math.sin(a) * r * 1.62), rd1(r * 0.24), CARD_CREAM);
    }
    return o + dot(x, y, rd1(r * 0.36), GOLD);
  }
  function hanaMaple(x, y, s, rot) {
    return '<g transform="translate(' + x + ' ' + y + ') rotate(' + rot + ') scale(' + s + ')"><path d="M0-14 3-7 9-9 6-2 13 0 5 4 7 11 0 8-7 11-5 4-13 0-6-2-9-9-3-7z"/><path d="M0 8V15" fill="none" stroke="' + CARD_BLACK + '" stroke-width="1.4"/></g>';
  }
  // One bird in flight, wings up, for the geese and the cuckoo.
  var bird = function (x, y, s, fill) { return '<path transform="translate(' + x + ' ' + y + ') scale(' + s + ')" d="M-10 2C-7-5-2-6 0 0 2-6 7-5 10 2 6 0 2 1 0 4-2 1-6 0-10 2z" fill="' + (fill || CARD_BLACK) + '"/>'; };

  function hanaPlant(m) {
    var i, o = '';
    switch (m) {
      case 0: return '<g' + CUT + '><path d="M50 24 70 54H30z"/><path d="M50 42 77 78H23z"/><path d="M50 62 84 104H16z"/></g>' + inkP('M46 104H54V124H46z');
      case 1:
        return strokeP('M18 122C34 100 36 82 52 66S74 44 82 26', 3.2) + strokeP('M44 78 30 74M62 56 76 62', 2) +
          hanaBlossom(50, 68, 8.4) + hanaBlossom(30, 74, 6.6) + hanaBlossom(75, 60, 7) + hanaBlossom(70, 38, 6.2) + hanaBlossom(40, 102, 6.4);
      case 2:
        return strokeP('M16 30C40 26 62 36 84 52', 3) + strokeP('M50 34C50 50 44 56 40 60M64 42C66 56 62 64 60 70', 1.8) +
          hanaBlossom(26, 38, 7, true) + hanaBlossom(46, 38, 7.4, true) + hanaBlossom(68, 48, 7.4, true) + hanaBlossom(40, 66, 7.6, true) + hanaBlossom(60, 76, 7.6, true) +
          hanaBlossom(34, 94, 6.4, true) + hanaBlossom(70, 104, 6.4, true) + leafP('M24 118C34 108 46 108 52 112 44 120 32 122 24 118z');
      case 3:
        o = strokeP('M14 28C40 18 66 20 88 34', 3) + leafP('M20 30C26 36 36 34 40 28 34 24 24 24 20 30z') + leafP('M60 24C66 32 76 32 82 28 76 22 66 20 60 24z');
        [[30, 5], [52, 7], [72, 6]].forEach(function (c) {
          for (i = 0; i < c[1]; i++) { var w = 6.2 - i * 0.62, yy = 40 + i * 10 + (c[0] === 52 ? 4 : 0); o += dot(rd1(c[0] - w * 0.7), yy, rd1(w * 0.82)) + dot(rd1(c[0] + w * 0.7), yy + 4, rd1(w * 0.82)); }
        });
        return o;
      case 4:
        return leafP('M38 126C34 96 40 66 46 38 54 66 54 98 50 126z') + leafP('M52 126C52 100 62 76 74 56 76 84 68 108 62 126z') + leafP('M30 126C26 108 32 92 24 78 38 92 42 110 40 126z') +
          '<path d="M50 24C42 32 42 46 50 52 58 46 58 32 50 24z"/><path d="M50 52C38 44 26 48 24 58 36 62 44 60 50 52z"/><path d="M50 52C62 44 74 48 76 58 64 62 56 60 50 52z"/>' +
          '<path d="M50 52C46 66 38 70 34 80 46 78 54 68 50 52z"/><path d="M50 52C54 66 62 70 66 80 54 78 46 68 50 52z" fill-opacity="0.8"/>' + strokeP('M50 34V50', 1.6, GOLD);
      case 5:
        o = '<g' + CUT + '>';
        for (i = 0; i < 8; i++) o += dot(rd1(52 + Math.cos(i * Math.PI / 4) * 17), rd1(58 + Math.sin(i * Math.PI / 4) * 17), 11.5);
        for (i = 0; i < 6; i++) o += dot(rd1(52 + Math.cos(i * Math.PI / 3 + 0.5) * 8.6), rd1(58 + Math.sin(i * Math.PI / 3 + 0.5) * 8.6), 8);
        return o + '</g>' + dot(52, 58, 5.2, GOLD) + dot(52, 58, 2, CARD_CREAM) + leafP('M52 126C34 118 24 104 20 92 36 94 48 106 52 126z') + leafP('M52 126C70 118 80 104 84 92 68 94 56 106 52 126z');
      case 6:
        o = strokeP('M22 126C18 90 34 56 72 38', 2.4, HANA_LEAF) + strokeP('M44 126C46 96 58 76 84 66', 2.4, HANA_LEAF) + strokeP('M30 126C34 108 40 96 40 84', 2, HANA_LEAF);
        [[24, 104, -70], [28, 84, -50], [34, 66, -40], [48, 54, -30], [62, 44, -20], [48, 108, 70], [58, 90, 60], [72, 76, 40], [40, 92, -90]].forEach(function (l) {
          o += ellipseP(l[0], l[1], 3, 5.4, HANA_LEAF, l[2]) + ellipseP(l[0] + 4, l[1] - 3, 3, 5.4, HANA_LEAF, l[2] + 40) + ellipseP(l[0] - 4, l[1] - 3, 3, 5.4, HANA_LEAF, l[2] - 40);
        });
        [[26, 76], [34, 58], [44, 48], [58, 38], [50, 100], [66, 84], [78, 70], [22, 94]].forEach(function (f) { o += dot(f[0], f[1], 2.6) + dot(f[0] + 4, f[1] + 3, 2.2); });
        return o;
      case 7:
        o = inkP('M16 128C24 98 76 98 84 128z');
        [[28, 26, -8], [42, 22, -2], [56, 24, 4], [70, 30, 10], [36, 48, -10], [64, 50, 8]].forEach(function (g) {
          o += strokeP('M' + (g[0] + (g[0] < 50 ? 8 : -8)) + ' 100Q' + g[0] + ' ' + (g[1] + 40) + ' ' + g[0] + ' ' + g[1], 1.8, HANA_COLOURS[7]) + ellipseP(g[0], g[1] + 8, 3.4, 11, 'currentColor', g[2]);
        });
        return o;
      case 8:
        o = '<g fill-opacity="1">';
        for (i = 0; i < 16; i++) o += '<ellipse cx="50" cy="48" rx="3.2" ry="13" transform="rotate(' + i * 22.5 + ' 50 62)"' + CUT + '/>';
        for (i = 0; i < 12; i++) o += '<ellipse cx="50" cy="55" rx="2.8" ry="7.8" transform="rotate(' + (i * 30 + 15) + ' 50 62)"' + CUT + '/>';
        return o + '</g>' + dot(50, 62, 5.4, GOLD) + dot(50, 62, 2, CARD_CREAM) + strokeP('M50 80C50 96 52 110 54 126', 2.4, HANA_LEAF) + leafP('M52 112C40 106 30 108 24 114 34 122 46 122 52 112z') + leafP('M52 100C62 92 74 92 80 98 72 108 60 108 52 100z');
      case 9:
        return strokeP('M20 120C40 100 56 70 84 40', 2.6) + hanaMaple(36, 50, 1.25, -18) + hanaMaple(66, 78, 1.45, 18) + hanaMaple(38, 100, 1.2, 190) + hanaMaple(70, 38, 0.9, 30);
      case 10:
        o = strokeP('M14 24H86', 3.4);
        [[22, 4], [36, -4], [50, 3], [64, -4], [78, 4]].forEach(function (s) {
          o += strokeP('M' + s[0] + ' 24C' + (s[0] + s[1]) + ' 56 ' + (s[0] - s[1]) + ' 90 ' + (s[0] + s[1] / 2) + ' 122', 1.8, HANA_LEAF);
          for (i = 0; i < 7; i++) o += ellipseP(s[0] + (i % 2 ? 3.4 : -3.4) + s[1] * (i % 2 ? 0.2 : -0.1), 34 + i * 12, 2.2, 6, 'currentColor', i % 2 ? -20 : 20);
        });
        return o;
      default:
        o = leafP('M50 126C30 118 22 100 30 88 38 92 46 100 50 112 54 100 62 92 70 88 78 100 70 118 50 126z') + strokeP('M50 112V30', 2.4, HANA_LEAF);
        [[34, 30], [50, 22], [66, 30]].forEach(function (c) {
          for (i = 0; i < 5; i++) o += dot(c[0], c[1] + i * 9, rd1(5.6 - i * 0.55));
          o += strokeP('M' + c[0] + ' ' + (c[1] + 40) + 'L50 ' + (c[1] + 54), 1.6, HANA_LEAF);
        });
        return o;
    }
  }

  // A ribbon laid down the middle: poetry (red, with writing), red or blue.
  function hanaRibbon(kind) {
    var col = kind === 'blue' ? HANA_SKY : CARD_RED, o = '<path d="M38 12H62V124L50 117 38 124z" fill="' + col + '" stroke="' + CARD_CREAM + '" stroke-width="1.6" stroke-linejoin="round"/>';
    if (kind === 'poetry') o += '<g fill="none" stroke="' + GOLD + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M45 24Q50 28 45 33T50 42M45 56Q50 60 45 65T50 74M45 88Q50 92 45 97T50 106"/></g>';
    else o += '<path class="zc-fine" d="M43 12V120M57 12V120" stroke="' + CARD_CREAM + '" stroke-width="0.8" opacity="0.7"/>';
    return o;
  }

  // The special cards, laid over their month's plant.
  function hanaSpecial(m, k) {
    var o;
    if (m === 0 && k === 0) { // crane and sun
      return '<g opacity="0.35"><g transform="translate(36 40) scale(0.62)">' + hanaPlant(0) + '</g></g>' + dot(64, 36, 15, CARD_RED) +
        strokeP('M56 78C68 70 64 58 58 54', 7.6) + strokeP('M56 78C68 70 64 58 58 54', 4.6, CARD_CREAM) +
        ellipseP(44, 84, 16, 9.6, CARD_CREAM, -10, ' stroke="' + CARD_BLACK + '" stroke-width="1.6"') + inkP('M30 84 22 76 22 91z') + inkP('M28 86Q42 70 58 80L42 91z', ' fill-opacity="0.88"') +
        '<circle cx="58" cy="51" r="4.4" fill="' + CARD_CREAM + '" stroke="' + CARD_BLACK + '" stroke-width="1.5"/>' + dot(59, 48.4, 2, CARD_RED) + gold('M62 50 74 53.4 62 55z') + dot(58.4, 50.6, 0.9, CARD_BLACK) +
        strokeP('M42 92 40 118M50 92 51 118M36 118H44M46 118H55', 1.8);
    }
    if (m === 2 && k === 0) { // curtain
      return '<g transform="translate(11 40) scale(0.78)">' + hanaPlant(2) + '</g>' + strokeP('M16 20H84', 2.4, GOLD) + dot(18, 24, 2.4, GOLD) + dot(82, 24, 2.4, GOLD) +
        '<path d="M18 24H82V66L76.4 62 70.8 66 65.2 62 59.6 66 54 62 48.4 66 42.8 62 37.2 66 31.6 62 26 66 18 62z" fill="' + CARD_BLACK + '"/>' +
        '<g fill="' + CARD_CREAM + '"><path d="M28 24H32V64H28z"/><path d="M44 24H48V64H44z"/><path d="M60 24H64V64H60z"/><path d="M74 24H78V64H74z"/></g>' + '<path class="zc-fine" d="M18 34H82" stroke="' + GOLD + '" stroke-width="1.4"/>';
    }
    if (m === 7 && k === 0) { // moon over the pampas hill
      return dot(50, 48, 27, GOLD) + '<circle class="zc-fine" cx="50" cy="48" r="21" fill="none" stroke="' + CARD_CREAM + '" stroke-width="1.2" opacity="0.7"/>' +
        '<g transform="translate(0 14) scale(1 0.8)">' + hanaPlant(7) + '</g>';
    }
    if (m === 10 && k === 0) { // rain man
      o = '<g opacity="0.7">' + hanaPlant(10) + '</g>';
      for (var i = 0; i < 9; i++) o += strokeP('M' + (22 + i * 7) + ' ' + (60 + (i % 3) * 14) + 'l-4 9', 1.6, HANA_SKY);
      return o + '<path d="M26 56A25 22 0 0 1 74 56z" fill="' + CARD_BLACK + '"/><path class="zc-fine" d="M50 34V56M38 38 42 56M62 38 58 56" stroke="' + GOLD + '" stroke-width="1.1" fill="none"/>' +
        strokeP('M50 56V84', 1.8) + '<circle cx="46" cy="70" r="4.6" fill="' + CARD_CREAM + '" stroke="' + CARD_BLACK + '" stroke-width="1.5"/>' +
        '<path d="M40 76H58L62 106H36z" fill="' + CARD_RED + '"/><path d="M38 90H60" stroke="' + GOLD + '" stroke-width="2.2"/>' + strokeP('M43 106V118M55 106V118M38 119H46M52 119H60', 2.2);
    }
    if (m === 11 && k === 0) { // phoenix
      return '<g opacity="0.45">' + hanaPlant(11) + '</g>' +
        strokeP('M46 70C28 80 22 100 30 124', 5, CARD_RED) + strokeP('M50 72C46 92 48 108 58 126', 5, GOLD) + strokeP('M54 70C66 84 74 100 72 124', 5, CARD_BLACK) +
        '<path d="M34 54C22 40 24 30 32 26 34 38 44 44 56 46z" fill="' + CARD_RED + '"/><path d="M40 60C22 62 14 50 12 44 28 46 40 50 52 58z" fill="' + GOLD + '"/>' +
        ellipseP(56, 62, 17, 11, GOLD, -18, ' stroke="' + CARD_BLACK + '" stroke-width="1.4"') + '<path d="M54 56C62 50 74 54 78 62 70 62 62 66 54 56z" fill="' + CARD_RED + '"/>' +
        strokeP('M66 54C68 44 66 38 62 34', 6) + '<circle cx="63" cy="32" r="5" fill="' + GOLD + '" stroke="' + CARD_BLACK + '" stroke-width="1.4"/>' + gold('M67 30 76 33 67 35z') +
        '<path d="M58 28 56 20 62 25 64 17 68 25 72 20 70 29z" fill="' + CARD_RED + '"/>' + dot(64, 31, 1, CARD_BLACK);
    }
    return '';
  }
  // The animals, over their plant.
  function hanaAnimal(m) {
    var o;
    if (m === 1) return '<g transform="translate(0 4)">' + strokeP('M20 120C36 100 38 84 54 70', 3) + '</g>' + '<g opacity="0.9"><g transform="translate(8 8) scale(0.86)">' + hanaBlossom(30, 78, 6) + hanaBlossom(70, 60, 6.4) + hanaBlossom(70, 38, 6) + '</g></g>' +
      inkP('M32 60 20 66 24 70 38 66z', ' fill="' + HANA_WOOD + '"') + ellipseP(46, 52, 14, 9.6, '#7d8a2a', -14) + ellipseP(54, 50, 8, 5.6, '#5a6420', -14) + dot(60, 44, 6.2, '#7d8a2a') + gold('M65 42 74 45 65 47z') + dot(62, 43, 1.1, CARD_CREAM);
    if (m === 3) return '<g opacity="0.8">' + hanaPlant(3) + '</g>' + dot(70, 28, 6, GOLD) + ellipseP(50, 90, 15, 8, CARD_BLACK, -36) + '<path d="M48 80C38 64 30 66 24 52 40 54 50 66 56 80z" fill="' + CARD_BLACK + '"/><path d="M54 82C62 64 72 60 82 52 80 68 70 80 62 90z" fill="' + CARD_BLACK + '"/>' +
      inkP('M34 104 20 122 30 120 42 108z') + dot(60, 78, 5.6, CARD_BLACK) + gold('M63 76 72 80 63 82z') + dot(61, 77, 1, CARD_CREAM) + '<path d="M44 92Q50 98 56 90" fill="none" stroke="' + CARD_CREAM + '" stroke-width="1.6"/>';
    if (m === 4) {
      o = '<g opacity="0.9">' + hanaPlant(4) + '</g>';
      for (var i = 0; i < 6; i++) {
        var t = i / 5, x = 20 + t * 56, y = 112 - t * 52;
        o += '<g transform="translate(' + rd1(x) + ' ' + rd1(y) + ') rotate(-34)"><path d="M-9-4H9L8 4H-8z" fill="' + (i % 2 ? HANA_WOOD : '#97683a') + '" stroke="' + CARD_CREAM + '" stroke-width="0.9"/></g>';
      }
      return o + strokeP('M16 116 28 108M36 94 48 86M60 74 74 64', 2, CARD_BLACK);
    }
    if (m === 5) return '<g opacity="0.95">' + hanaPlant(5) + '</g>' + hanaButterfly(30, 36, 1, -20) + hanaButterfly(72, 80, 0.9, 25);
    if (m === 6) return '<g opacity="0.85">' + hanaPlant(6) + '</g>' +
      ellipseP(50, 86, 23, 14, CARD_BLACK) + '<path d="M26 78 32 70 36 77 42 69 46 76 52 68 56 76 62 70 66 78z" fill="' + CARD_BLACK + '"/>' + ellipseP(72, 88, 12, 10.6, CARD_BLACK, -8) + '<path d="M78 82Q92 84 90 94 86 98 78 96z" fill="' + CARD_BLACK + '"/>' +
      '<path d="M66 78 64 68 72 74z" fill="' + CARD_BLACK + '"/>' + gold('M80 94 87 88 84 98z') + dot(70, 85, 1.5, CARD_CREAM) + dot(86, 91, 1, CARD_CREAM) + dot(89, 93, 1, CARD_CREAM) +
      strokeP('M34 98 32 116M44 99 44 118M58 98 60 116M66 98 70 116', 4) + strokeP('M28 82C22 82 20 90 24 96', 2.4);
    if (m === 7) return '<g transform="translate(0 14) scale(1 0.8)"><g opacity="0.9">' + hanaPlant(7) + '</g></g>' + dot(70, 30, 12, GOLD) + bird(34, 50, 1.3) + bird(52, 40, 1.1) + bird(26, 66, 1);
    if (m === 8) return '<g transform="translate(0 -6) scale(1)">' + hanaPlant(8) + '</g>' +
      '<path d="M22 78C26 108 74 108 78 78z" fill="' + CARD_RED + '"/>' + '<ellipse cx="50" cy="78" rx="28" ry="8.6" fill="' + CARD_CREAM + '" stroke="' + GOLD + '" stroke-width="2.6"/>' + '<ellipse cx="50" cy="80" rx="20" ry="4.6" fill="' + CARD_RED + '" fill-opacity="0.35"/>' +
      '<circle cx="50" cy="92" r="6" fill="' + GOLD + '"/><circle cx="50" cy="92" r="2.6" fill="' + CARD_RED + '"/>' + inkP('M40 104H60L62 109H38z');
    if (m === 9) return '<g opacity="0.9">' + hanaPlant(9) + '</g>' + ellipseP(46, 94, 18, 9.6, '#6b4a2b') + '<path d="M58 90C64 78 64 70 62 62L72 60C72 72 70 82 66 94z" fill="#6b4a2b"/>' +
      ellipseP(68, 58, 8, 5.4, '#6b4a2b', -14) + strokeP('M64 54C58 46 54 40 52 32M60 46 52 44M58 40 50 36M68 52C74 46 76 40 78 32M72 44 80 42', 2, CARD_BLACK) + strokeP('M32 100 30 124M40 102 40 124M54 102 56 124M62 100 66 122', 2.6, '#6b4a2b') +
      '<g fill="' + CARD_CREAM + '"><circle cx="40" cy="91" r="1.5"/><circle cx="48" cy="88" r="1.5"/><circle cx="54" cy="94" r="1.5"/><circle cx="44" cy="97" r="1.4"/></g>' + dot(76, 61, 1.2, CARD_CREAM) + strokeP('M30 88 24 82', 3, '#6b4a2b');
    if (m === 10) { // swallow under the willow and the rain
      o = '<g opacity="0.85">' + hanaPlant(10) + '</g>';
      for (var j = 0; j < 7; j++) o += strokeP('M' + (22 + j * 9) + ' ' + (52 + (j % 3) * 16) + 'l-3 8', 1.5, HANA_SKY);
      return o + ellipseP(52, 82, 14, 7, CARD_BLACK, 24) + ellipseP(54, 85, 8, 4, CARD_CREAM, 24) + '<path d="M50 76C40 62 30 60 22 58 34 70 42 80 50 84z" fill="' + CARD_BLACK + '"/>' + dot(64, 88, 5, CARD_BLACK) + gold('M67 90 74 94 66 94z') +
        inkP('M40 90 26 108 34 106 38 114 46 96z') + dot(65, 87, 0.9, CARD_CREAM);
    }
    return '';
  }
  function hanaButterfly(x, y, s, rot) {
    var w = function (cx, cy, rx, ry, r) { return ellipseP(cx, cy, rx, ry, GOLD, r, ' stroke="' + CARD_BLACK + '" stroke-width="1.2"'); };
    return '<g transform="translate(' + x + ' ' + y + ') rotate(' + rot + ') scale(' + s + ')">' + w(-9, -6, 9, 6, -30) + w(9, -6, 9, 6, 30) + w(-7, 6, 6, 4.4, 25) + w(7, 6, 6, 4.4, -25) +
      '<g fill="' + CARD_CREAM + '"><circle cx="-10" cy="-6" r="2"/><circle cx="10" cy="-6" r="2"/></g>' + ellipseP(0, 0, 1.8, 8.6, CARD_BLACK) + strokeP('M0-7C-2-12-5-13-6-13M0-7C2-12 5-13 6-13', 1, CARD_BLACK) + '</g>';
  }

  // The month number (two digits turned into one path run) and the kind badge.
  var HANA_BADGE_Y = 31;
  function hanaBadge(c, x, y, k) {
    if (c.kind === 'bright') return '<circle cx="' + x + '" cy="' + y + '" r="' + 4.6 * k + '" fill="' + GOLD + '"/>';
    if (c.kind === 'animal') return '<path d="M' + x + ' ' + (y - 5.4 * k) + ' ' + (x + 4.4 * k) + ' ' + y + ' ' + x + ' ' + (y + 5.4 * k) + ' ' + (x - 4.4 * k) + ' ' + y + 'z" fill="' + CARD_BLACK + '"/>';
    if (c.kind === 'ribbon') return '<path d="M' + (x - 2.6 * k) + ' ' + (y - 5.4 * k) + 'H' + (x + 2.6 * k) + 'V' + (y + 5.4 * k) + 'L' + x + ' ' + (y + 3.8 * k) + ' ' + (x - 2.6 * k) + ' ' + (y + 5.4 * k) + 'z" fill="' + (c.ribbon === 'blue' ? HANA_SKY : CARD_RED) + '"/>';
    return '<circle cx="' + x + '" cy="' + y + '" r="' + 2.2 * k + '" fill="currentColor"/>';
  }
  function hanaIndex(c) {
    var label = String(c.month + 1), two = label.length > 1;
    var one = function (turn) {
      return '<g class="zc-idx-std"' + (turn ? ' transform="rotate(180 50 70)"' : '') + '><rect x="2" y="3" width="17" height="42" rx="3" fill="' + CARD_CREAM + '" fill-opacity="0.95"/>' +
        glyph(label, 10.5, 6 + (two ? 1.5 : 0), two ? 0.88 : 1.2) + hanaBadge(c, 10.5, HANA_BADGE_Y + 3, 1) + '</g>';
    };
    var row = '<g class="zc-idx-row" display="none"><rect x="1.5" y="2" width="' + (two ? 55 : 42) + '" height="36" rx="5" fill="' + CARD_CREAM + '" fill-opacity="0.95"/>' + glyph(label, 4 + glyphWidth(label) * (two ? 1.5 : 2.1) / 2 + (two ? 2 : 0), 6, two ? 1.5 : 2.1) +
      hanaBadge(c, two ? 47 : 33, 20, 1.5) + '</g>';
    return one(false) + one(true) + row;
  }
  function hanafudaFaceMarkup(id, standalone) {
    var c = hanafudaCard(id), m = c.month, art, bright = c.kind === 'bright', frame;
    if (c.kind === 'bright') art = hanaSpecial(m, c.k);
    else if (c.kind === 'animal') art = c.sake ? hanaAnimal(8) : hanaAnimal(m);
    else if (c.kind === 'ribbon') art = '<g opacity="0.9">' + hanaPlant(m) + '</g>' + hanaRibbon(c.ribbon);
    else art = c.name === 'lightning' ? '<g opacity="0.85">' + hanaPlant(10) + '</g>' + '<path d="M58 28 44 66H56L46 106 72 56H58L68 28z" fill="' + GOLD + '" stroke="' + CARD_BLACK + '" stroke-width="1.2" stroke-linejoin="round"/>' :
      (c.k === 3 && m !== 11 ? '<g transform="translate(100 0) scale(-1 1)">' + hanaPlant(m) + '</g>' : hanaPlant(m));
    if (bright && !art) art = hanaPlant(m);
    frame = '<rect x="14" y="8" width="72" height="124" rx="3.5" fill="' + (bright ? GOLD : 'currentColor') + '" fill-opacity="' + (bright ? 0.14 : 0.07) + '" stroke="' + (bright ? GOLD : 'currentColor') + '" stroke-width="' + (bright ? 2.2 : 1.2) + '"/>' +
      '<rect class="zc-fine" x="16.6" y="10.6" width="66.8" height="118.8" rx="1.8" fill="none" stroke="' + GOLD + '" stroke-width="0.7"/>';
    return faceFrame(frame + '<g>' + art + '</g>' + hanaIndex(c), HANA_COLOURS[m], standalone);
  }

  // ── Backs ─────────────────────────────────────────────────────────────
  // The card backs are drawn by cardbacks.js (loaded before this file); it hands back their list, the markup of one
  // and the gradients they share. Their animation is CSS (cards.css pauses it with the tab and drops it under
  // reduced motion).
  var DEFAULT_BACK = 'zimi';
  var CB = root.ZimiCardBacks({ T: T, markZ: markZ, moonPhase: moonPhase, moonLitPath: moonLitPath, MARK_FROM: MARK_FROM, CARD_CREAM: CARD_CREAM, FACE_W: FACE_W, FACE_H: FACE_H, BACK_Z_H: BACK_Z_H });
  var BACKS = CB.BACKS, backMarkup = CB.backMarkup;
  // Gradients live once in the page's sprite: a reference into a clone that is display:none would break.
  var SPRITE_DEFS = MARK_GRADIENT + CB.defs;


  // ── The ZimiGames mark ─────────────────────────────────────────────────
  // Zimi's Z on its river pebble, the same mark as the app icon: a complete SVG
  // document (the shelf header inlines it; mark.svg is the same markup). The
  // numbers are ZMARK, generated by scripts/zimi_mark/zimi_mark.py.
  function markSvg() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + ZMARK.box + '" role="img" aria-label="ZimiGames"><defs>' + ZMARK.defs + '</defs>' + ZMARK.body + '</svg>';
  }

  var currentBack = DEFAULT_BACK, backListeners = [];
  function setBack(id) {
    currentBack = id;
    store.set('back', id);
    backListeners.forEach(function (fn) { fn(); });
  }

  // ── Storage: per-viewer conveniences, always in try/catch ─────────────
  var KEY_PREFIX = 'zimi.games.';
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

  // "3 cards": the word's plural entry (cards.n.<word>), by the language's own rules.
  function plural(n, word) { return root.ZimiText && root.ZimiText.has('cards.n.' + word) ? T('cards.n.' + word, { n: n }) : n + ' ' + word + (n === 1 ? '' : 's'); }
  function fmtTime(s) { return root.ZimiText ? root.ZimiText.clock(s) : Math.floor(s / 60) + ':' + ('0' + Math.floor(s % 60)).slice(-2); }
  // A game's lifetime figures: played counts the games begun, so quitting
  // mid-game still shows up as a loss.
  // `lowScore` is for games where fewer points is better (Hearts); a game
  // that reports a score also keeps its best, win or not.
  function createStats(game, lowScore) {
    var key = 'stats.' + game;
    var read = function () { var v = store.get(key, null); return v && typeof v === 'object' ? v : { played: 0, won: 0, best: 0 }; };
    var keepScore = function (v, score) {
      if (typeof score !== 'number') return;
      if (typeof v.bestScore !== 'number' || (lowScore ? score < v.bestScore : score > v.bestScore)) v.bestScore = score;
    };
    return {
      get: read,
      began: function () { var v = read(); v.played++; store.set(key, v); },
      won: function (seconds, score) {
        var v = read(); v.won++; seconds = Math.max(1, seconds);
        if (!v.best || seconds < v.best) v.best = seconds;
        keepScore(v, score); store.set(key, v); return v;
      },
      scored: function (score) { var v = read(); keepScore(v, score); store.set(key, v); return v; },
      // The record as labelled figures (the Menu's Stats list), and as one line for a sheet.
      rows: function () {
        var v = read();
        var out = [[T('cards.stats.played'), v.played], [T('cards.stats.won'), v.won]];
        if (v.best) out.push([T('cards.stats.bestTime'), fmtTime(v.best)]);
        if (typeof v.bestScore === 'number') out.push([T('cards.stats.bestScore'), v.bestScore]);
        return out;
      },
      line: function () { return this.rows().map(function (r) { return r[0] + ' ' + r[1]; }).join(' \u00b7 '); }
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
      SUIT_SHAPES.map(function (shape, s) { return '<symbol id="zc-s-' + s + '" overflow="visible">' + shape + '</symbol>'; }).join('') +
      ITALIAN_SHAPES.map(function (shape, s) { return '<symbol id="' + ITALIAN_PREFIX + s + '" overflow="visible">' + shape + '</symbol>'; }).join('') +
      SPANISH_SHAPES.map(function (shape, s) { return '<symbol id="' + SPANISH_PREFIX + s + '" overflow="visible">' + shape + '</symbol>'; }).join('') + SPRITE_DEFS + '</defs></svg>';
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
    // The one anatomy lives in the shell (title, text, options, actions; focus on the sheet, Esc closes).
    if (root.ZimiShell && root.ZimiShell.sheet) return root.ZimiShell.sheet(opts);
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
      var pick = h('button', { class: 'zc-pick', type: 'button', 'aria-pressed': String(b.id === currentBack), 'aria-label': T('cards.backLabel', { name: b.name }) }, [face, h('span', { text: b.name })]);
      pick.addEventListener('click', function () {
        setBack(b.id);
        Object.keys(picks).forEach(function (k) { picks[k].setAttribute('aria-pressed', String(k === b.id)); });
      });
      picks[b.id] = pick;
      grid.appendChild(pick);
    });
    return sheet({ title: T('cards.backs'), body: [grid], actions: [{ label: T('cards.done'), primary: true }] });
  }

  // The menu row both games share: open the backs picker.
  function backsRow() {
    return h('div', { class: 'zc-row', 'data-gs': 'backs' }, [h('label', { text: T('cards.look') }), h('button', { class: 'ar-btn', type: 'button', text: T('cards.backsMore'), onclick: backsSheet })]);
  }

  // ── The board ─────────────────────────────────────────────────────────
  // o: { table, cols, place(state, m) -> {height, slots, cards},
  //      canPick(state, pile, idx), move(pile, idx, to) -> bool,
  //      tap(pile, idx) -> bool, slotTap(pile), afterRender() }
  // place() returns slots [{id, x, y, w, h, label, mark}] and cards
  // [{id, pile, idx, x, y, up, hidden}] in stacking order.
  var SNAP_FELT = '#285c43', SNAP_CREAM = '#fdfcf8', SNAP_RED = '#b3261e', SNAP_BLACK = '#1b1b1b', SNAP_BACK = '#23232b', SNAP_BACK_EDGE = '#e8710a', SNAP_RX = 5;
  var SNAP_SUIT = ['\u2663', '\u2666', '\u2665', '\u2660'];
  var MAX_CARD_W = 120, CARD_ASPECT = 1.4, CARD_H_SHARE = 0.14, DRAG_SLOP = 6, SETTLE_MS = 300, Z_HOT = 500, Z_DRAG = 1000;
  var DEAL_STAGGER_MS = 16, MIN_CARD_W = 24;
  // More o: heightShare (how much of the table's height a card may take, for
  // layouts shorter than Klondike's columns), face(id, standalone) (a deck of
  // its own: Scopa's), enterTaps (Enter on a pile taps
  // its top card: for games where one tap is the whole move), centerY (the share of
  // spare height put above a short layout), and per card in
  // place(): mark (the game's own highlight), glow (a soft one) and dim (not playable now); a
  // slot may be quiet (a drop area with no outline and no tab stop).

  function createBoard(o) {
    var d = root.document, table = o.table, stage = h('div', { class: 'zc-stage' });
    var live = h('div', { class: 'zc-live', 'aria-live': 'polite' });
    table.appendChild(stage); table.appendChild(live);
    var els = {}, slotEls = {}, cardPos = {}, byPile = {}, slotRects = {};
    // The count chips of collapsed face-down hands (layout: counts [{ x, y, n }]), over the cards.
    var countLayer = h('div', { class: 'ct-counts', 'aria-hidden': 'true' });
    table.appendChild(countLayer);
    var lastPlace = null, lastState = null, metrics = null, drag = null, sel = null, settleTimer = 0, focusPile = null, slotOrder = [];

    function measure() {
      var W = table.clientWidth, H = table.clientHeight;
      var pad = Math.max(6, Math.min(16, Math.round(W * 0.02))), gap = Math.max(4, Math.round(W * 0.014));
      var cw = Math.floor((W - 2 * pad - (o.cols - 1) * gap) / o.cols);
      cw = Math.max(MIN_CARD_W, Math.min(cw, MAX_CARD_W, Math.floor(H * (o.heightShare || CARD_H_SHARE))));
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
      if (up && !e._face) { e.firstChild.innerHTML = (o.face || faceMarkup)(id, false); e._face = true; }
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
        // Only a keyboard focus shows the ring: a mouse click on empty felt should not.
        e.addEventListener('focus', function () {
          var visible = true;
          try { visible = e.matches(':focus-visible'); } catch (err) { /* old engine: show it */ }
          if (visible) { focusPile = s.id; paintSelection(); }
        });
        e.addEventListener('blur', function () { focusPile = null; paintSelection(); });
        stage.insertBefore(e, stage.firstChild);
      }
      return e;
    }
    // A pile that is gone (a pyramid card taken) loses its slot; a keyboard
    // player's focus moves to the nearest pile that is left.
    function pruneSlots(prevOrder, hadFocus) {
      var lost = prevOrder.indexOf(hadFocus && hadFocus.getAttribute && hadFocus.getAttribute('data-pile')), moveTo = null, i;
      Object.keys(slotEls).forEach(function (id) { if (!slotRects[id]) { slotEls[id].remove(); delete slotEls[id]; } });
      if (lost < 0 || (hadFocus && hadFocus.isConnected)) return;
      for (i = lost; i < prevOrder.length && !moveTo; i++) moveTo = slotEls[prevOrder[i]];
      for (i = lost - 1; i >= 0 && !moveTo; i--) moveTo = slotEls[prevOrder[i]];
      if (moveTo) moveTo.focus();
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
      lastPlace = p;
      // A short layout sits a little above the middle instead of hugging the top bar.
      var lift = o.centerY ? Math.max(0, Math.floor((m.H - p.height) * o.centerY)) : 0;
      if (lift) { p.slots.forEach(function (s) { s.y += lift; }); p.cards.forEach(function (c) { c.y += lift; }); p.height += lift; }
      stage.style.height = Math.max(p.height, m.H) + 'px';
      var prevOrder = slotOrder, hadFocus = d.activeElement;
      slotRects = {}; slotOrder = [];
      p.slots.forEach(function (s) {
        slotOrder.push(s.id);
        var e = slotEl(s);
        e.style.transform = 'translate(' + s.x + 'px,' + s.y + 'px)';
        e.style.width = s.w + 'px'; e.style.height = s.h + 'px';
        e.setAttribute('aria-label', s.label);
        if (s.mark) e.setAttribute('data-mark', s.mark); else e.removeAttribute('data-mark');
        // quiet: a drop area, not a pile: no outline, not in the tab order.
        if (s.quiet) { e.setAttribute('data-quiet', ''); e.setAttribute('tabindex', '-1'); }
        slotRects[s.id] = s;
      });
      pruneSlots(prevOrder, hadFocus);
      cardPos = {}; byPile = {};
      var origin = p.slots[0], dealing = mode === 'deal';
      p.cards.forEach(function (c, i) {
        var e = cardEl(c.id), z = i + 1;
        cardPos[c.id] = { pile: c.pile, idx: c.idx };
        (byPile[c.pile] = byPile[c.pile] || []).push(c.id);
        dress(e, c.id, c.up, c.hidden);
        e._mark = !!c.mark;
        e.classList.toggle('zc-sel', e._mark);
        e.classList.toggle('zc-dim', !!c.dim);
        e.classList.toggle('zc-glow', !!c.glow);
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
      // A pile with cards shows its focus on its top card; only an empty one rings its outline.
      Object.keys(slotEls).forEach(function (k) { slotEls[k].toggleAttribute('data-cards', !!byPile[k]); });
      // A card the layout no longer places has left the game (a debug state, a short deal).
      Object.keys(els).forEach(function (k) { if (!cardPos[k]) els[k].classList.add('zc-off'); });
      if (anyMoved) scheduleSettle();
      countLayer.textContent = '';
      (p.counts || []).forEach(function (n) { countLayer.appendChild(h('span', { class: 'ct-count', style: 'left:' + Math.round(n.x) + 'px;top:' + Math.round(n.y) + 'px', text: String(n.n) })); });
      paintSelection();
      if (o.afterRender) o.afterRender();
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
      if (root.ZimiShell && root.ZimiShell.shake) { root.ZimiShell.shake(e); return; }
      e.classList.remove('zc-hint'); void e.offsetWidth; e.classList.add('zc-hint');
    }

    // ── Keyboard: Tab to a pile, Enter/Space picks up, again drops ──────
    function say(text) { live.textContent = text; }
    function paintSelection() {
      Object.keys(els).forEach(function (k) { els[k].classList.remove('zc-focus'); if (!els[k]._mark) els[k].classList.remove('zc-sel'); });
      var focused = focusPile && byPile[focusPile];
      if (focused && focused.length) els[focused[focused.length - 1]].classList.add('zc-focus');
      if (!sel || !byPile[sel.pile]) return;
      byPile[sel.pile].slice(sel.idx).forEach(function (id) { els[id].classList.add('zc-sel'); });
    }
    // Left and right walk the piles in layout order, for hands and pyramids.
    function walk(pile, step) {
      var at = slotOrder.indexOf(pile) + step, next = slotEls[slotOrder[at]];
      while (next && next.hasAttribute('data-quiet')) { at += step; next = slotEls[slotOrder[at]]; }
      if (next) next.focus();
    }
    function onKey(ev, pile) {
      var ids = byPile[pile] || [], key = ev.key;
      if (key === 'Escape' && sel) { sel = null; paintSelection(); say(T('cards.cancelled')); return; }
      if (sel && (key === 'ArrowUp' || key === 'ArrowDown') && sel.pile === pile) {
        ev.preventDefault();
        var next = sel.idx + (key === 'ArrowUp' ? -1 : 1);
        if (next >= 0 && next < ids.length && o.canPick(lastState, pile, next)) { sel.idx = next; paintSelection(); say(plural(ids.length - next, 'card')); }
        return;
      }
      if (o.enterTaps && (key === 'ArrowLeft' || key === 'ArrowRight')) { ev.preventDefault(); walk(pile, key === 'ArrowLeft' ? -1 : 1); return; }
      if (key !== 'Enter' && key !== ' ') return;
      ev.preventDefault();
      if (o.enterTaps) {
        if (ids.length) { if (!o.tap(pile, ids.length - 1)) say(T('cards.noMove')); } else if (o.slotTap) o.slotTap(pile);
        return;
      }
      if (sel) {
        var from = sel; sel = null; paintSelection();
        if (from.pile === pile) { if (!o.tap(from.pile, from.idx)) say(T('cards.noMove')); return; }
        if (o.move(from.pile, from.idx, pile)) say(T('cards.moved'));
        else { say(T('cards.notAllowed')); sel = from; paintSelection(); }
        return;
      }
      if (ids.length && o.canPick(lastState, pile, ids.length - 1)) {
        sel = { pile: pile, idx: ids.length - 1 }; paintSelection();
        say(T('cards.picked', { card: cardName(ids[ids.length - 1]) }));
      } else if (o.slotTap) o.slotTap(pile);
    }

    // ── The win cascade ─────────────────────────────────────────────────
    // order: [{id}], first launched first. Calls done() when the cards have
    // all gone or the player taps. Speeds are per frame at 60 fps for a card
    // BASE_CARD_W wide, scaled to the card size on screen.
    var GRAVITY = 0.55, BOUNCE = 0.82, LAUNCH_FRAMES = 11, FRAME_MS = 1000 / 60, MAX_DT = 3;
    var VX_MIN = 2, VX_SPAN = 5, VY_MIN = 2, VY_SPAN = 7, BASE_CARD_W = 71, END_PAUSE_MS = 600, MAX_DPR = 2;
    function faceOf(id, standalone) { return (o.face || faceMarkup)(id, standalone); }
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
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(faceOf(id, true));
      });
    }
    function cascade(order, done) {
      var m = metrics;
      if ((root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) || (root.ZimiShell && root.ZimiShell.anim() === 'off')) { done(); return; }
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
    // The table as it stands, as a small svg for the shelf's live tile: plain cards (a corner label, no art), the
    // top of the table, since the tile is wider than tall.
    function snapshot() {
      if (!lastPlace || !metrics) return null;
      var m = metrics, ink = function (id) { return isRed(id) ? SNAP_RED : SNAP_BLACK; }, out = [];
      lastPlace.slots.forEach(function (s) {
        if (!s.quiet) out.push('<rect x="' + s.x + '" y="' + s.y + '" width="' + s.w + '" height="' + s.h + '" rx="' + SNAP_RX + '" fill="none" stroke="#fff" stroke-opacity=".22"/>');
      });
      lastPlace.cards.forEach(function (c) {
        if (c.hidden) return;
        var face = (c.up ? '<rect x="' + c.x + '" y="' + c.y + '" width="' + m.cw + '" height="' + m.ch + '" rx="' + SNAP_RX + '" fill="' + SNAP_CREAM + '" stroke="#c9c4b8"/>' +
          '<text x="' + (c.x + m.cw * 0.12) + '" y="' + (c.y + m.cw * 0.4) + '" font-size="' + Math.round(m.cw * 0.36) + '" font-weight="700" font-family="sans-serif" fill="' + ink(c.id) + '">' + RANK_LABELS[rank(c.id) - 1] + SNAP_SUIT[suit(c.id)] + '</text>'
          : '<rect x="' + c.x + '" y="' + c.y + '" width="' + m.cw + '" height="' + m.ch + '" rx="' + SNAP_RX + '" fill="' + SNAP_BACK + '" stroke="' + SNAP_BACK_EDGE + '"/>');
        out.push(face);
      });
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + m.W + ' ' + Math.round(m.W * 9 / 16) + '" preserveAspectRatio="xMidYMin slice"><rect width="' + m.W + '" height="' + m.H + '" fill="' + SNAP_FELT + '"/>' + out.join('') + '</svg>';
    }
    // The top of your hand as laid out (raised cards included): what the status line must stay above.
    function handTop() {
      if (!lastPlace || !metrics) return null;
      var band = metrics.H - 2.2 * metrics.ch, top = null;
      lastPlace.cards.forEach(function (c) { if (!c.hidden && c.y >= band && (top === null || c.y < top)) top = c.y; });
      return top;
    }
    return {
      handTop: handTop,
      snapshot: snapshot,
      render: render, refresh: refresh, cascade: cascade, say: say, nudge: nudge,
      metrics: function () { return metrics; },
      cardEl: function (id) { return els[id]; },
      clearSelection: function () { sel = null; paintSelection(); }
    };
  }

  // ── The session: undo, clock, stats, keys, the win ────────────────────
  // cfg: { id, els: {undo, newBtn, menu, stat}, board, newGame(), openMenu(),
  //        statText(sec, state), cascadeOrder(state), winLines(sec, state) }
  // Where a status line of height h goes: where the game's layout put it, or higher if your hand (raised cards
  // included, from board.handTop()) would reach into it.
  var STATUS_GAP = 6;
  function statusTop(statusY, handTop, h) { return handTop === null ? statusY : Math.min(statusY, handTop - STATUS_GAP - h); }
  var TICK_MS = 1000, HISTORY_KEPT = 40;
  // Run a game's openMenu without showing its sheet and hand back the parts that are options.
  function menuOptions(openMenu) {
    var real = root.ZimiCards.sheet, taken = null;
    root.ZimiCards.sheet = function (opts) { taken = opts; return { el: null, close: function () {} }; };
    try { openMenu(); } finally { root.ZimiCards.sheet = real; }
    return ((taken && taken.body) || []).filter(function (n, i) {
      var cls = n.className || '';
      return !(i === 0 && /\bzc-note\b/.test(cls)) && !/\bzc-stats\b/.test(cls) && n.getAttribute('data-gs') !== 'backs';
    });
  }
  function createSession(cfg) {
    var d = root.document, board = cfg.board;
    // s.stats can be swapped by a game whose variants keep separate records (Spider's suits).
    var s = { state: null, history: [], won: false, ending: null, stats: createStats(cfg.id, cfg.lowScore) }, begun = false;
    var started = 0, banked = 0, ticker = 0, timers = [], running = false, resume = false, restoreTried = false;

    function seconds() { return Math.floor((banked + (running ? Date.now() - started : 0)) / 1000); }
    function paint() {
      var text = cfg.statText(seconds(), s.state);
      cfg.els.stat.textContent = root.ZimiShell ? root.ZimiShell.stripClock(text) : text;
      cfg.els.undo.disabled = !s.history.length || s.won || !!(cfg.undoOff && cfg.undoOff());
    }
    function run() { if (running) return; running = true; started = Date.now(); ticker = setInterval(paint, TICK_MS); }
    function halt() { if (!running) return; banked += Date.now() - started; running = false; clearInterval(ticker); }
    function clearLater() { timers.forEach(clearTimeout); timers = []; }

    s.seconds = seconds;
    s.paint = paint;
    s.later = function (fn, ms) { timers.push(setTimeout(fn, ms)); };
    s.commit = function (next) {
      if (s.won) return;
      if (!begun) { begun = true; s.stats.began(); run(); }
      s.history.push(s.state); s.state = next;
      board.render(next); paint();
    };
    // A game that moves state with follow() (Blackjack's round) says when the player has really begun.
    s.began = function () { if (!begun) { begun = true; s.stats.began(); run(); } };
    // A state that follows from the player's move without being one (an
    // auto-move): shown, and undone together with that move.
    s.follow = function (next) { s.state = next; board.render(next); paint(); };
    s.undo = function () {
      if (!s.history.length || s.won || (cfg.undoOff && cfg.undoOff())) return;
      clearLater(); board.clearSelection();
      s.state = s.history.pop(); board.render(s.state); paint();
    };
    // Leaving a game and coming back never loses it: the position, the undo trail, the clock and a finished
    // game's end sheet are kept by the shell (ZimiShell.persist). The page's first new game is the place the
    // kept one is taken up instead, so the game's own code after reset (the deal, the computer's turn) runs as usual.
    function savedGame() {
      if (!begun || !s.state || (cfg.saveOff && cfg.saveOff())) return null;
      return { id: cfg.saveId || cfg.id, state: s.state, history: s.history.slice(-HISTORY_KEPT), ms: banked + (running ? Date.now() - started : 0), ending: s.ending };
    }
    function takeUp(kept) {
      s.state = kept.state; s.history = kept.history || []; banked = kept.ms || 0; begun = true; s.ending = kept.ending || null;
      board.render(s.state); paint();
      if (s.ending) { s.won = true; session_showEnd(s.ending, 0); } else run();
    }
    function keptGame() {
      var kept = root.ZimiShell && root.ZimiShell.saved ? root.ZimiShell.saved() : null;
      return kept && kept.id === (cfg.saveId || cfg.id) && kept.state && typeof kept.state === 'object' ? kept : null;
    }
    s.reset = function (state) {
      clearLater(); halt(); banked = 0; s.history = []; s.won = false; s.ending = null; begun = false; board.clearSelection();
      var kept = restoreTried ? null : keptGame();
      restoreTried = true;
      if (kept) {
        try { takeUp(kept); return; } catch (e) { if (root.ZimiShell && root.ZimiShell.forget) root.ZimiShell.forget(); s.won = false; s.ending = null; begun = false; halt(); }
      }
      s.state = state; board.render(state, 'deal'); paint();
    };
    // `after` is how long to wait for the last animation; a game coming back from being left has none.
    function session_showEnd(e, after) {
      if (root.ZimiShell && root.ZimiShell.endSheet) root.ZimiShell.endSheet({ result: e.result, text: e.text, stats: e.stats, onNew: cfg.newGame, after: after });
    }
    // A finished game that was not won (Hearts lost, Golf stuck): the clock
    // stops, the score is kept if it is a best, and the sheet says how it went.
    s.lose = function (title, lines, score) {
      s.won = true; halt(); clearLater();
      if (typeof score === 'number') s.stats.scored(score);
      paint();
      if (root.ZimiShell && root.ZimiShell.endSheet) { s.ending = { result: 'lose', text: lines[0] || title, stats: s.stats.rows().slice(0, 2) }; session_showEnd(s.ending); return; }
      var body = lines.map(function (t) { return h('p', { class: 'zc-note', text: t }); });
      body.push(h('p', { class: 'zc-stats', text: s.stats.line() }));
      sheet({ title: title, body: body, actions: [{ label: T('shell.close') }, { label: T('shell.menu.new'), primary: true, onclick: cfg.newGame }] });
    };
    s.win = function (score) {
      s.won = true; halt(); clearLater();
      var sec = seconds(), best = s.stats.won(sec, score);
      paint();
      if (root.ZimiShell && root.ZimiShell.endSheet) s.ending = { result: 'win', text: cfg.winLines(sec, s.state)[0], stats: [[T('cards.stats.time'), fmtTime(sec)], [T('cards.stats.won'), T('cards.stats.wonOf', { won: best.won, played: best.played })]] };
      board.cascade(cfg.cascadeOrder(s.state), function () {
        var lines = cfg.winLines(sec, s.state);
        if (s.ending) { session_showEnd(s.ending); return; }
        var body = lines.map(function (t) { return h('p', { class: 'zc-note', text: t }); });
        body.push(h('p', { class: 'zc-stats', text: s.stats.line() }));
        sheet({ title: T('shell.end.win'), body: body, actions: [{ label: T('shell.close') }, { label: T('shell.menu.new'), primary: true, onclick: cfg.newGame }] });
      });
    };

    if (root.ZimiShell && root.ZimiShell.persist) root.ZimiShell.persist({ save: savedGame });
    cfg.els.undo.addEventListener('click', s.undo);
    cfg.els.newBtn.addEventListener('click', cfg.newGame);
    cfg.els.menu.addEventListener('click', cfg.openMenu);
    if (root.ZimiShell) root.ZimiShell.game({
      stats: function () { return s.stats.rows(); },
      // The game's own menu sheet, taken apart: its options go into the shell's New game pane,
      // while its rules note, its card backs and its stats line are the shell's own rows.
      menu: function () { return { options: menuOptions(cfg.openMenu) }; },
      inProgress: function () { return begun && !s.won; },
      snapshot: function () { return board.snapshot(); },
      paint: paint
    });
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

  // A compact layout on a tall table sits a little above the middle: this much
  // of the room left over goes above it.
  var REST_ABOVE_SHARE = 0.3;
  function restShare(room) { return Math.max(0, Math.floor(room * REST_ABOVE_SHARE)); }

  // The one line of fact under the bar for the games with no status line of their own ("Draw 1", "Deal #1234",
  // "Streak 3"): a pill centred over the top of the table. A layout leaves FACT_H free at its top for it.
  var FACT_H = 30;
  function factLine(table) {
    var e = table.querySelector('.zc-fact');
    if (!e) { e = h('div', { class: 'zc-fact', role: 'status', 'aria-live': 'polite' }); table.appendChild(e); }
    return e;
  }
  // The page's fixed parts, by the ids every game page uses.
  function pageEls() {
    var g = function (id) { return root.document.getElementById(id); };
    return { table: g('zc-table'), sub: g('zc-sub'), undo: g('zc-undo'), newBtn: g('zc-new'), menu: g('zc-menu'), stat: g('zc-stat') };
  }
  // A pile's cards as plain ids (for games whose piles hold {id, up}).
  function idsOf(pile) { return pile.map(function (c) { return c.id; }); }

  // Describe a pile for assistive tech: "Tableau 3, 5 cards, top 7 of hearts".
  function describePile(name, ids, topVisible) {
    var n = ids.length;
    return n === 0 ? T('cards.pile.empty', { name: name }) : T(topVisible ? 'cards.pile.top' : 'cards.pile.count', { name: name, n: n, card: topVisible ? cardName(ids[n - 1]) : '' });
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
    FACT_H: FACT_H, factLine: factLine, moonPhase: moonPhase, moonLitPath: moonLitPath, faceMarkup: faceMarkup, backMarkup: backMarkup,
    italianFaceMarkup: italianFaceMarkup, italianName: italianName,
    spanishFaceMarkup: spanishFaceMarkup, spanishName: spanishName, hanafudaFaceMarkup: hanafudaFaceMarkup, hanafudaCard: hanafudaCard, hanafudaName: hanafudaName, HANA_MONTHS: HANA_MONTHS, jokerMarkup: jokerMarkup, markSvg: markSvg,
    fmtTime: fmtTime, plural: plural, describePile: describePile, fanStep: fanStep, statusTop: statusTop, pageEls: pageEls, idsOf: idsOf, restShare: restShare,
    store: store, createStats: createStats, h: h, sheet: sheet, segmented: segmented, backsSheet: backsSheet, backsRow: backsRow,
    T: T, createBoard: createBoard, createSession: createSession, ensureSprite: ensureSprite,
    currentBack: function () { return currentBack; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
