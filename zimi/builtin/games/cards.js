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

  // ── The Zimi deck ─────────────────────────────────────────────────────
  // Original French-suited deck. Everything is drawn: indices are stroked
  // paths (no font is ever needed), courts are geometric busts built from a
  // few shapes, and the Ace of Spades carries the ZimiGames mark. One face is
  // one SVG in a 100x140 box. Detail that cannot be seen on a small card is
  // marked `zc-fine`, a small card's own layout `zc-small` / `zc-idx-row`:
  // cards.css switches them by the card's width (container query), so the
  // same markup serves a phone's Spider (33 px) and a desktop's Solitaire.
  // Suit shapes centred on 0,0 inside ±10; one sprite, `use`d by every card.
  var SUIT_SHAPES = [
    '<circle cy="-5" r="4.8"/><circle cx="-5.2" cy="2.6" r="4.8"/><circle cx="5.2" cy="2.6" r="4.8"/><path d="M-1.3 2C-1 6-2.6 8-4.6 10h9.2C2.6 8 1 6 1.3 2z"/>',
    '<path d="M0-11C1.6-6 4.6-2.6 7.6 0 4.6 2.6 1.6 6 0 11-1.6 6-4.6 2.6-7.6 0-4.6-2.6-1.6-6 0-11z"/>',
    '<path d="M0 9.5C-14-1-10-10-4.5-8.5-2-7.8 0-5.5 0-4 0-5.5 2-7.8 4.5-8.5 10-10 14-1 0 9.5z"/>',
    '<path d="M0-10C-4-5-11-1-9 3.5-7.5 7-2.5 6-1.5 3-1.5 6-2 8-4 10h8C2 8 1.5 6 1.5 3 2.5 6 7.5 7 9 3.5 11-1 4-5 0-10z"/>'
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
  var CARD_RED = '#c62828', CARD_BLACK = '#1b1b1b', CARD_CREAM = '#fdfcf8', CARD_EDGE = '#c9c4b8'; // games.css tokens, repeated for the cascade's bitmaps
  var GOLD = '#e09400', MARK_FROM = '#fb8c14', MARK_TO = '#f2582a'; // Zimi's amber, and the two ends of the Z's gradient
  var FACE_W = 100, FACE_H = 140, ACE_SCALE = 3.3, ACE_SPADE_SCALE = 3.9;
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

  // The Z of Zimi's icon: two bars and the diagonal, 40 wide, 52 tall.
  var MARK_Z = 'M0 0H40V10.5L17 41.5H40V52H0V41.5L23 10.5H0z', MARK_Z_W = 40, MARK_Z_H = 52;
  var MARK_GRADIENT = '<linearGradient id="zc-g-mark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + MARK_FROM + '"/><stop offset="1" stop-color="' + MARK_TO + '"/></linearGradient>';
  // The Z centred on cx,cy at `k` times its drawn size, in the mark's gradient.
  function markZ(cx, cy, k) {
    return '<path transform="translate(' + (cx - MARK_Z_W * k / 2) + ' ' + (cy - MARK_Z_H * k / 2) + ') scale(' + k + ')" d="' + MARK_Z + '" fill="url(#zc-g-mark)"/>';
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
    // Only the wordmark uses these.
    Z: { d: 'M0 1.2H10L0 12.8H10' },
    I: { d: 'M0 0V14', w: 0 },
    M: { d: 'M0 14V0L5 8.6 10 0V14' },
    G: { d: 'M9.6 3C8.6 1.2 7 0 5.2 0 2.4 0 .8 3 .8 7S2.4 14 5.2 14C7.8 14 9.4 12.4 9.4 9.2H5.4' },
    E: { d: 'M10 0H0V14H10M0 7H8' },
    S: { d: 'M9.2 3C8.6 1.2 7 0 5 0 2.8 0 1.2 1.2 1.2 3.4 1.2 5.6 3 6.4 5 7 7 7.6 9.2 8.4 9.2 10.6 9.2 12.8 7.4 14 5 14 2.8 14 1.2 12.8.6 11' }
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
  var IDX_X = 10.5, IDX_Y = 5, IDX_SCALE = 1.35, IDX_SCALE_TEN = 1.05, IDX_TEN_DROP = 1.5, IDX_SUIT_Y = 38, IDX_SUIT_SCALE = 0.7;
  var ROW_Y = 5, ROW_SCALE = 2.1, ROW_SUIT_X = 60, ROW_SUIT_Y = 21, ROW_SUIT_SCALE = 1.25, ROW_RANK_X = 4;
  function indexMarkup(label, s, standalone, shapes, prefix) {
    var ten = label === '10';
    var one = function (turn) {
      return '<g class="zc-idx-std"' + (turn ? ' transform="rotate(180 50 70)"' : '') + '>' + glyph(label, IDX_X, IDX_Y + (ten ? IDX_TEN_DROP : 0), ten ? IDX_SCALE_TEN : IDX_SCALE) +
        placed(s, IDX_X, IDX_SUIT_Y, IDX_SUIT_SCALE, false, standalone, shapes, prefix) + '</g>';
    };
    var row = standalone ? '' : '<g class="zc-idx-row" display="none">' + glyph(label, ROW_RANK_X + glyphWidth(label) * ROW_SCALE / 2, ROW_Y, ROW_SCALE) +
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
  function heldItalian(s, x, y, standalone, compact) {
    return compact ? '' : '<g paint-order="stroke"' + CUT + '>' + placed(s, x, y - ITALIAN_HELD_LIFT[s], ITALIAN_HELD_SCALE[s], false, standalone, ITALIAN_SHAPES, ITALIAN_PREFIX) + '</g>';
  }
  function italianFigure(kind, s, standalone, compact) {
    var hand = function (x, y) { return '<circle cx="' + x + '" cy="' + y + '" r="2.3" fill="' + CARD_CREAM + '" stroke="currentColor" stroke-width="1.2"/>'; };
    var limb = function (d, w) { return '<path d="' + d + '"' + LINE + ' stroke-width="' + w + '"/>'; };
    if (kind === 'fante') {
      return limb('M38.4 50 34 65', 4.4) + '<path d="M40 70H49.2L48.2 93H42z"/>' + '<path d="M50.8 70H60L58 93H51.8z" fill="' + CARD_CREAM + '" stroke="currentColor" stroke-width="1.3"/>' +
        gold('M40.8 93H48.4V96.4H39.4zM51.8 93H59.2L60.6 96.4H51.8z') +
        '<path d="M37 72 38.6 50C40 46.4 60 46.4 61.4 50L63 72z"/><path d="M38.4 63H61.6" stroke="' + GOLD + '" stroke-width="2.2" fill="none"/>' + limb('M62 50 66.8 62', 4.4) + hand(34, 66) + hand(67.4, 63.6) +
        '<path d="M43.2 48.6 50 55.6 56.8 48.6" fill="none" stroke="' + GOLD + '" stroke-width="1.8"/>' +
        '<path d="M43.6 42V36C43.6 29 56.4 29 56.4 36V42C55.4 41.6 55 40.4 55 39H45C45 40.4 44.6 41.6 43.6 42z"/>' + head(37.8, 6.2) +
        '<path d="M42 35.6C41 27.6 49 24.4 57.4 27.4 60.6 28.8 60.2 33.6 58.4 35.2 54 33 46.4 33 42 35.6z"/><path d="M42.4 35C46.6 32.8 53.6 32.8 57.6 34.8" fill="none" stroke="' + GOLD + '" stroke-width="1.5"/>' +
        gold('M56.6 28.4C61.4 27.4 64 25.6 64.6 23.6 62 24.8 60.4 25 55.8 26.6z') + eyes(38.4, 1) + '<path d="M47.6 42Q50 43.6 52.4 42"' + LINE + ' stroke-width="1"/>' + heldItalian(s, 68.6, 63.6, standalone, compact);
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
        heldItalian(s, 36.4, 44.4, standalone, compact);
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
      gold('M43 32 41.4 24.4 46 27.6 50 22.4 54 27.6 58.6 24.4 57 32z') + '<path d="M43 30.2H57" stroke="currentColor" stroke-width="1" fill="none"/>' + heldItalian(s, 67, 65.6, standalone, compact);
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
      body = '<g class="zc-big">' + placed(s, 50, 70, spadeAce ? ACE_SPADE_SCALE : ACE_SCALE, false, standalone) + (spadeAce ? markZ(50, 67, 0.52) : '') + '</g>' +
        smallSuit(s, standalone, null, null, spadeAce ? markZ(50, SMALL_SUIT_Y - 2, 0.42) : '');
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
  function italianName(id) { return ITALIAN_NAMES[id % 10] + ' of ' + ITALIAN_SUITS[Math.floor(id / 10) % 4]; }
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

  // ── Backs ─────────────────────────────────────────────────────────────
  // Original designs, drawn in a 92x132 art box inside a cream margin. The
  // animation is CSS on a few groups per card; cards.css pauses it with the
  // tab and drops it under reduced motion.
  var BACKS = [
    { id: 'zimi', name: 'Zimi' },
    { id: 'classic', name: 'Classic' },
    { id: 'night', name: 'Night sky' },
    { id: 'sea', name: 'The sea' },
    { id: 'robot', name: 'Robot' },
    { id: 'castle', name: 'Castle' }
  ];
  var DEFAULT_BACK = 'zimi';
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
    // The Zimi back: the mark on a dark lattice, a slow sheen across it now
    // and then, and a glow behind the Z that breathes.
    zimi: function () {
      return '<rect width="92" height="132" fill="#0c0c0e"/><rect width="92" height="132" fill="url(#zc-p-zimi)"/>' +
        '<rect x="7" y="7" width="78" height="118" rx="2" fill="none" stroke="url(#zc-g-mark)" stroke-width="1.3"/>' +
        '<rect x="11" y="11" width="70" height="110" rx="1" fill="none" stroke="' + MARK_FROM + '" stroke-width=".5" opacity=".45"/>' +
        '<circle class="zc-tw zc-tw2" cx="46" cy="66" r="30" fill="url(#zc-g-glow)"/>' +
        '<path d="M46 24 76 66 46 108 16 66z" fill="#141012" stroke="url(#zc-g-mark)" stroke-width="1.4"/>' +
        '<path d="M46 31 69 66 46 101 23 66z" fill="none" stroke="' + MARK_FROM + '" stroke-width=".5" opacity=".5"/>' +
        markZ(46, 66, 0.62) +
        '<g fill="' + MARK_FROM + '"><path d="M18 18l3 3-3 3-3-3zM74 18l3 3-3 3-3-3zM18 108l3 3-3 3-3-3zM74 108l3 3-3 3-3-3z"/></g>' +
        '<g class="zc-sheen"><path d="M-60 0H-40L-14 132H-34z" fill="url(#zc-g-sheen)"/></g>';
    },
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
  var SPRITE_DEFS = MARK_GRADIENT +
    '<radialGradient id="zc-g-glow"><stop offset="0" stop-color="' + MARK_FROM + '" stop-opacity=".34"/><stop offset="1" stop-color="' + MARK_FROM + '" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="zc-g-sheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".2"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    '<pattern id="zc-p-zimi" width="11" height="11" patternUnits="userSpaceOnUse"><path d="M5.5 0 11 5.5 5.5 11 0 5.5z" fill="none" stroke="' + MARK_FROM + '" stroke-width=".45" opacity=".26"/></pattern>' +
    '<linearGradient id="zc-g-night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1a3d"/><stop offset="1" stop-color="#3a4f8a"/></linearGradient>' +
    '<linearGradient id="zc-g-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd6f5"/><stop offset="1" stop-color="#2b8fc9"/></linearGradient>' +
    '<linearGradient id="zc-g-castle" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1646"/><stop offset=".7" stop-color="#8a3f6b"/><stop offset="1" stop-color="#e58a4b"/></linearGradient>' +
    '<pattern id="zc-p-classic" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#1d3b7a"/><path d="M5 0 10 5 5 10 0 5z" fill="none" stroke="#c9d6f2" stroke-width=".8" opacity=".55"/></pattern>' +
    '<pattern id="zc-p-grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#27e6ff" stroke-width=".4" opacity=".25"/></pattern>';


  // ── The ZimiGames mark and wordmark ────────────────────────────────────
  // The mark is Zimi's Z dealt onto a card, a second card in the Z's
  // gradient fanned behind it. Built here once so the Ace of Spades, the
  // ZIM icon, mark.svg and the shelf header cannot drift apart: `markSvg`
  // and `wordmarkSvg` return complete SVG documents (see
  // docs/plans/2026-10-24-zimigames-identity.md).
  var MARK_CARD = { x: 22, y: 11, w: 56, h: 78, r: 6, fan: 14, ink: '#0a0a0b', zw: 30 };
  function markSvg(opts) {
    opts = opts || {};
    var c = MARK_CARD, rect = function (extra) { return '<rect x="' + c.x + '" y="' + c.y + '" width="' + c.w + '" height="' + c.h + '" rx="' + c.r + '" ' + extra + '/>'; };
    var k = c.zw / MARK_Z_W;
    var art = '<g transform="translate(4 3)">' + rect('transform="rotate(' + c.fan + ' 50 50)" fill="url(#zm-g)"') + '</g>' +
      '<g transform="translate(-4 3)">' + rect('fill="' + c.ink + '" stroke="rgba(255,255,255,0.22)" stroke-width="1.5"') +
      '<path transform="translate(' + (50 - c.zw / 2) + ' ' + (50 - MARK_Z_H * k / 2) + ') scale(' + k + ')" d="' + MARK_Z + '" fill="url(#zm-g)"/></g>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>' + MARK_GRADIENT.replace('zc-g-mark', 'zm-g') + '</defs>' +
      (opts.tile ? '<rect width="100" height="100" rx="22" fill="' + c.ink + '"/><g transform="translate(10 10) scale(0.8)">' + art + '</g>' : art) + '</svg>';
  }
  // The lockup: the mark's Z, on its dark card with the second card fanned
  // behind, is the first letter, then IMI in a bold stroke and GAMES in a
  // light one, so the Z is drawn once and the line reads ZimiGames. The
  // letters are paths on the Z's own 14-high grid; ink is `currentColor`.
  var WORD_BOLD = 3.1, WORD_LIGHT = 1.7, WORD_H = 14, WORD_BOLD_GAP = 4.4, WORD_LIGHT_GAP = 3.6, WORD_BREAK = 6, WORD_S_KERN = 1.2;
  var WORD_CHIP = { padX: 3.6, padY: 5, r: 2.6, fan: 8, fanDx: 1.2, fanDy: 0.8, gap: 3.4 };
  function wordmarkSvg() {
    var c = WORD_CHIP, k = WORD_H / MARK_Z_H, zw = MARK_Z_W * k, x, out = '', gapAfter = 0;
    var w = zw + 2 * c.padX, h = WORD_H + 2 * c.padY, y0 = -c.padY;
    var rect = function (extra) { return '<rect x="' + -c.padX + '" y="' + y0 + '" width="' + w + '" height="' + h + '" rx="' + c.r + '" ' + extra + '/>'; };
    var cx = w / 2 - c.padX, cy = WORD_H / 2;
    out += '<g transform="translate(' + c.fanDx + ' ' + c.fanDy + ') rotate(' + c.fan + ' ' + cx + ' ' + cy + ')">' + rect('fill="url(#zw-g)"') + '</g>' +
      rect('fill="' + MARK_CARD.ink + '" stroke="rgba(255,255,255,0.22)" stroke-width="0.5"') + '<path d="' + MARK_Z + '" transform="scale(' + k + ')" fill="url(#zw-g)"/>';
    var fanEdge = cx + c.fanDx + (w * Math.cos(c.fan * Math.PI / 180) + h * Math.sin(c.fan * Math.PI / 180)) / 2;
    x = Math.max(w - c.padX, fanEdge) + c.gap;
    var minX = cx + c.fanDx - (w * Math.cos(c.fan * Math.PI / 180) + h * Math.sin(c.fan * Math.PI / 180)) / 2;
    var run = function (text, stroke, between) {
      text.split('').forEach(function (ch) {
        if (ch === 'S') x -= WORD_S_KERN;
        out += '<path transform="translate(' + x + ' 0)" d="' + GLYPHS[ch].d + '" fill="none" stroke="currentColor" stroke-width="' + stroke + '" stroke-miterlimit="8"/>';
        x += glyphWidth(ch) + between;
      });
      gapAfter = between;
    };
    run('IMI', WORD_BOLD, WORD_BOLD_GAP);
    x += WORD_BREAK - WORD_BOLD_GAP;
    run('GAMES', WORD_LIGHT, WORD_LIGHT_GAP);
    var pad = 1.5, top = y0 - 2, bottom = y0 + h + 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (minX - pad) + ' ' + top + ' ' + (x - gapAfter - minX + 2 * pad) + ' ' + (bottom - top) + '" role="img" aria-label="ZimiGames"><defs>' +
      MARK_GRADIENT.replace('zc-g-mark', 'zw-g') + '</defs>' + out + '</svg>';
  }

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

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
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
      line: function () {
        var v = read();
        var parts = ['Played ' + v.played, 'Won ' + v.won];
        if (v.best) parts.push('Best time ' + fmtTime(v.best));
        if (typeof v.bestScore === 'number') parts.push('Best score ' + v.bestScore);
        return parts.join(' \u00b7 ');
      }
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
      ITALIAN_SHAPES.map(function (shape, s) { return '<symbol id="' + ITALIAN_PREFIX + s + '" overflow="visible">' + shape + '</symbol>'; }).join('') + SPRITE_DEFS + '</defs></svg>';
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
    var lastState = null, metrics = null, drag = null, sel = null, settleTimer = 0, focusPile = null, slotOrder = [];

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
      if (key === 'Escape' && sel) { sel = null; paintSelection(); say('Cancelled'); return; }
      if (sel && (key === 'ArrowUp' || key === 'ArrowDown') && sel.pile === pile) {
        ev.preventDefault();
        var next = sel.idx + (key === 'ArrowUp' ? -1 : 1);
        if (next >= 0 && next < ids.length && o.canPick(lastState, pile, next)) { sel.idx = next; paintSelection(); say(ids.length - next + ' cards'); }
        return;
      }
      if (o.enterTaps && (key === 'ArrowLeft' || key === 'ArrowRight')) { ev.preventDefault(); walk(pile, key === 'ArrowLeft' ? -1 : 1); return; }
      if (key !== 'Enter' && key !== ' ') return;
      ev.preventDefault();
      if (o.enterTaps) {
        if (ids.length) { if (!o.tap(pile, ids.length - 1)) say('No move'); } else if (o.slotTap) o.slotTap(pile);
        return;
      }
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
    var d = root.document, board = cfg.board;
    // s.stats can be swapped by a game whose variants keep separate records (Spider's suits).
    var s = { state: null, history: [], won: false, stats: createStats(cfg.id, cfg.lowScore) }, begun = false;
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
      if (!begun) { begun = true; s.stats.began(); run(); }
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
    // A finished game that was not won (Hearts lost, Golf stuck): the clock
    // stops, the score is kept if it is a best, and the sheet says how it went.
    s.lose = function (title, lines, score) {
      s.won = true; halt(); clearLater();
      if (typeof score === 'number') s.stats.scored(score);
      paint();
      var body = lines.map(function (t) { return h('p', { class: 'zc-note', text: t }); });
      body.push(h('p', { class: 'zc-stats', text: s.stats.line() }));
      sheet({ title: title, body: body, actions: [{ label: 'Close' }, { label: 'New game', primary: true, onclick: cfg.newGame }] });
    };
    s.win = function (score) {
      s.won = true; halt(); clearLater();
      var sec = seconds(), best = s.stats.won(sec, score);
      paint();
      board.cascade(cfg.cascadeOrder(s.state), function () {
        var body = cfg.winLines(sec, s.state).map(function (t) { return h('p', { class: 'zc-note', text: t }); });
        body.push(h('p', { class: 'zc-stats', text: 'Won ' + best.won + ' of ' + best.played + '   Best ' + fmtTime(best.best) + (typeof best.bestScore === 'number' ? '   Best score ' + best.bestScore : '') }));
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

  // A compact layout on a tall table sits a little above the middle: this much
  // of the room left over goes above it.
  var REST_ABOVE_SHARE = 0.3;
  function restShare(room) { return Math.max(0, Math.floor(room * REST_ABOVE_SHARE)); }

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
    italianFaceMarkup: italianFaceMarkup, italianName: italianName, jokerMarkup: jokerMarkup, markSvg: markSvg, wordmarkSvg: wordmarkSvg,
    fmtTime: fmtTime, plural: plural, describePile: describePile, fanStep: fanStep, pageEls: pageEls, idsOf: idsOf, restShare: restShare,
    store: store, createStats: createStats, h: h, sheet: sheet, segmented: segmented, backsSheet: backsSheet, backsRow: backsRow,
    createBoard: createBoard, createSession: createSession, ensureSprite: ensureSprite,
    currentBack: function () { return currentBack; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
