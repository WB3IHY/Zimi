#!/usr/bin/env node
// Redraws the card-game tiles and the header lockup of ZimiGames' shelf
// (zimi/builtin/games/index.html) from the deck itself, as static inline SVG,
// so the shelf stays plain HTML for Kiwix and cannot drift from the cards.
//
//   node scripts/build_games_shelf.js          rewrite index.html in place
//
// Only each listed card tile's `ar-game-art` svg, the lockup and one hidden
// sprite (suits, gradients, the card clip) are touched; the rest is left as is.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'zimi', 'builtin', 'games');
const file = path.join(dir, 'index.html');

// The deck, loaded the way the tests load it; ensureSprite is asked for its sprite.
let sprite = '';
const doc = {
  getElementById: () => null,
  createElement: () => ({ set innerHTML(v) { sprite = v; }, get firstChild() { return {}; } }),
  body: { insertBefore() {} },
  addEventListener() {}, querySelector: () => null, documentElement: { classList: { toggle() {} } }, hidden: false
};
const sandbox = { console, Date, setTimeout, clearTimeout, setInterval, clearInterval, document: doc };
sandbox.window = sandbox;
vm.createContext(sandbox);
// cardbacks.js draws the backs and cards.js asks it for them, so it is loaded first.
for (const name of ['text.js', 'cardbacks.js', 'cards.js']) vm.runInContext(fs.readFileSync(path.join(dir, name), 'utf8'), sandbox, { filename: name });
const Z = sandbox.ZimiCards;
Z.ensureSprite();

const CARD_W = 100, CARD_H = 140, CARD_R = 7.5;
const CREAM = '#fdfcf8', EDGE = '#c9c4b8', RED = '#b3261e', BLACK = '#1b1b1b';
const FELT = '#285c43', FELT_DEEP = '#1a4130';
const CLIP = 'zs-card';

// 'KS' is the king of spades, 'TH' the ten of hearts, 'AC' the ace of clubs.
const RANKS = 'A23456789TJQK', SUITS = 'CDHS';
const cid = (s) => Z.make(RANKS.indexOf(s[0]) + 1, SUITS.indexOf(s[1]));

const num = (n) => String(Math.round(n * 100) / 100);
const place = (x, y, rot, w) => 'translate(' + num(x) + ' ' + num(y) + ')' + (rot ? ' rotate(' + rot + ')' : '') + ' scale(' + num(w / CARD_W) + ')';
const sized = (svg) => svg.replace('<svg viewBox', '<svg width="' + CARD_W + '" height="' + CARD_H + '" viewBox');

// One face-up card at (x, y), `w` wide, turned `rot` degrees about its corner.
function face(id, x, y, w, rot) {
  const colour = Z.isRed(id) ? RED : BLACK;
  return '<g transform="' + place(x, y, rot, w) + '" style="color:' + colour + '"><rect y="1.6" width="100" height="140" rx="' + CARD_R + '" fill="rgba(0,0,0,0.32)"/>' +
    '<rect width="100" height="140" rx="' + CARD_R + '" fill="' + CREAM + '" stroke="' + EDGE + '"/>' + sized(Z.faceMarkup(id, false)) + '</g>';
}
function italian(id, x, y, w, rot) {
  return '<g transform="' + place(x, y, rot, w) + '"><rect y="1.6" width="100" height="140" rx="' + CARD_R + '" fill="rgba(0,0,0,0.32)"/>' +
    '<rect width="100" height="140" rx="' + CARD_R + '" fill="' + CREAM + '" stroke="' + EDGE + '"/>' + sized(Z.italianFaceMarkup(id, false)) + '</g>';
}
function spanish(id, x, y, w, rot) {
  return '<g transform="' + place(x, y, rot, w) + '"><rect y="1.6" width="100" height="140" rx="' + CARD_R + '" fill="' + CREAM + '" stroke="' + EDGE + '"/>' + sized(Z.spanishFaceMarkup(id, false)) + '</g>';
}
function hanafuda(id, x, y, w, rot) {
  return '<g transform="' + place(x, y, rot, w) + '"><rect y="1.6" width="100" height="140" rx="' + CARD_R + '" fill="rgba(0,0,0,0.32)"/>' +
    '<rect width="100" height="140" rx="' + CARD_R + '" fill="' + CREAM + '" stroke="' + EDGE + '"/>' + sized(Z.hanafudaFaceMarkup(id, false)) + '</g>';
}
// A face-down card with the Zimi back.
function back(x, y, w, rot) {
  return '<g transform="' + place(x, y, rot, w) + '"><rect y="1.6" width="100" height="140" rx="' + CARD_R + '" fill="rgba(0,0,0,0.32)"/>' +
    '<g clip-path="url(#' + CLIP + ')">' + sized(Z.backMarkup('zimi')).replace(' class="zc-bk"', '') + '</g></g>';
}
// The edge of a card lying under another.
function edge(x, y, w) {
  return '<g transform="' + place(x, y, 0, w) + '"><rect width="100" height="140" rx="' + CARD_R + '" fill="' + CREAM + '" stroke="' + EDGE + '"/></g>';
}
// An empty slot's outline.
function slot(x, y, w) {
  return '<g transform="' + place(x, y, 0, w) + '"><rect x="1" y="1" width="98" height="138" rx="' + CARD_R + '" fill="rgba(0,0,0,0.12)" stroke="rgba(255,255,255,0.35)" stroke-width="3"/></g>';
}
const tile = (felt, inner) => '<svg class="ar-game-art" viewBox="0 0 320 180" aria-hidden="true">\n        <rect width="320" height="180" fill="' + felt + '"/>\n        ' + inner + '\n      </svg>';

const TILES = {
  solitaire: () => tile(FELT, face(cid('KS'), 70, 38, 76, -14) + face(cid('QH'), 122, 34, 76, 0) + face(cid('JC'), 176, 38, 76, 14)),
  freecell: () => tile(FELT_DEEP, slot(24, 22, 56) + slot(92, 22, 56) + face(cid('AD'), 172, 22, 56) + face(cid('AS'), 240, 22, 56) +
    [[52, ['9C', '8H']], [138, ['KS', 'QH', 'JC']], [224, ['7D', '6S']]].map(([x, col]) =>
      col.map((c, i) => face(cid(c), x, 106 + i * 18, 44)).join('')).join('')),
  spider: () => tile(FELT, ['KS', 'QS', 'JS', 'TS', '9S'].map((c, k) => face(cid(c), 56 + 24 * k, 24 + 18 * k, 56)).join('') +
    [214, 223, 232].map((x) => edge(x, 104, 40)).join('') + face(cid('AS'), 241, 104, 40)),
  hearts: () => tile(FELT_DEEP, back(20, 30, 40) + back(140, -30, 40) + back(260, 30, 40) + face(cid('QS'), 100, 48, 58, -8) + face(cid('AH'), 160, 44, 58, 8)),
  pyramid: () => {
    const rows = [['KS'], ['QH', '6C'], ['7S', 'AD', 'KD'], ['AC', '6H', 'QD', '7C']];
    let out = '';
    rows.forEach((r, i) => r.forEach((c, j) => { out += face(cid(c), 138 - 22 * i + 44 * j, 22 + 34 * i, 40); }));
    return tile(FELT, out);
  },
  golf: () => {
    const cols = [['2C', '2H', '7S'], ['8H', '8S', '3D'], ['4S', '4D', 'JC'], ['KD', 'KC', '9C'], ['6C', '6S', '5H']];
    let out = '';
    cols.forEach((col, i) => col.forEach((c, j) => { out += face(cid(c), 28 + 54 * i, 18 + 16 * j, 46); }));
    return tile(FELT_DEEP, out + back(110, 112, 46) + face(cid('8D'), 166, 112, 46));
  },
  tripeaks: () => {
    let out = '';
    [53, 149, 245].forEach((x) => { out += back(x, 22, 22) + back(x - 12, 44, 22) + back(x + 12, 44, 22); });
    ['4C', '5D', '6S', '7D', '8C', '9D', 'TS', 'JH', 'QC'].forEach((c, k) => { out += face(cid(c), 30 + 30 * k, 74, 28); });
    out += back(120, 128, 30) + face(cid('7H'), 158, 128, 30) +
      '<circle cx="270" cy="150" r="16" fill="#d97706"/><text x="270" y="156" font-size="15" font-weight="800" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif">x5</text>';
    return tile(FELT, out);
  }
};
// The world card games.
const pill = (x, y, w, label) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="22" rx="11" fill="rgba(0,0,0,0.3)"/><text x="' + (x + w / 2) + '" y="' + (y + 16) + '" font-size="15" font-weight="700" text-anchor="middle" fill="rgba(255,255,255,0.85)" font-family="ui-monospace,Menlo,monospace">' + label + '</text>';
const label = (x, y, size, text) => '<text x="' + x + '" y="' + y + '" font-size="' + size + '" font-weight="700" text-anchor="middle" fill="rgba(255,255,255,0.85)" font-family="system-ui,sans-serif">' + text + '</text>';
function cribBoard() {
  const groups = (x0, n) => Array.from({ length: n }, (_, k) => x0 + 12 * k);
  const top = [].concat(groups(40, 5), groups(106, 5), groups(172, 5), groups(238, 4)), low = [].concat(groups(40, 5), groups(106, 5), groups(172, 5));
  const holes = (xs, y) => xs.map((x) => '<circle cx="' + x + '" cy="' + y + '" r="1.8"/>').join('');
  return '<rect x="24" y="22" width="272" height="64" rx="9" fill="#8a5a2e" stroke="#5e3b1a"/><g fill="rgba(30,16,4,0.7)">' + holes(top, 38) + holes(top, 50) + holes(low, 66) + holes(low, 78) + '</g>' +
    '<circle cx="196" cy="38" r="4.4" fill="#f59e0b" stroke="#fff" stroke-width="1.2"/><circle cx="172" cy="38" r="3.2" fill="#f59e0b" stroke="#000" stroke-opacity=".5"/>' +
    '<circle cx="130" cy="50" r="4.4" fill="#38bdf8" stroke="#fff" stroke-width="1.2"/><circle cx="106" cy="50" r="3.2" fill="#38bdf8" stroke="#000" stroke-opacity=".5"/>';
}
Object.assign(TILES, {
  spades: () => tile(FELT_DEEP, face(cid('KS'), 78, 40, 62, -12) + face(cid('AS'), 130, 32, 62) + face(cid('QS'), 182, 40, 62, 12) + pill(106, 142, 48, 'Nil') + pill(166, 142, 48, '500')),
  euchre: () => tile(FELT_DEEP, face(cid('JD'), 66, 34, 72, -12) + face(cid('JH'), 124, 30, 72) + face(cid('AH'), 182, 34, 72, 12) + label(160, 164, 14, 'right bower, left bower, trump')),
  gin: () => tile(FELT, face(cid('5H'), 54, 40, 58, -10) + face(cid('6H'), 100, 34, 58) + face(cid('7H'), 146, 36, 58, 10) + face(cid('KS'), 236, 52, 46, 6) +
    '<rect x="96" y="136" width="128" height="26" rx="13" fill="rgba(0,0,0,0.35)"/><text x="160" y="154" font-size="15" font-weight="700" text-anchor="middle" fill="#fff" font-family="ui-monospace,Menlo,monospace">GIN  0</text>'),
  cribbage: () => tile(FELT_DEEP, cribBoard() + face(cid('5H'), 70, 102, 52) + face(cid('JS'), 134, 102, 52) + face(cid('5D'), 198, 102, 52) +
    '<text x="272" y="150" font-size="30" font-weight="700" text-anchor="middle" fill="rgba(255,255,255,0.85)" font-family="ui-monospace,Menlo,monospace">29</text>'),
  crazyeights: () => tile(FELT, back(28, 48, 56) + face(cid('8S'), 112, 32, 76, -8) + face(cid('8H'), 176, 34, 76, 8) +
    [[1, 56], [0, 92]].map((p) => '<g transform="translate(270 ' + p[1] + ') scale(1.2)" fill="rgba(255,255,255,0.85)"><use href="#zc-s-' + p[0] + '"/></g>').join('')),
  durak: () => tile(FELT_DEEP, back(96, -34, 40) + back(142, -34, 40) + back(188, -34, 40) + face(cid('7C'), 112, 44, 58) + face(cid('9S'), 132, 58, 58, 8) + face(cid('AH'), 26, 92, 46) + back(46, 92, 46)),
  bridge: () => tile(FELT_DEEP, back(144, 8, 32)),
  scopa: () => tile(FELT, italian(0, 56, 34, 64, -12) + italian(19, 128, 28, 64) + italian(26, 200, 34, 64, 12) + label(160, 160, 22, 'Scopa!')),
  belote: () => tile(FELT_DEEP, face(cid('JS'), 70, 34, 70, -12) + face(cid('9S'), 126, 30, 70) + face(cid('AS'), 182, 34, 70, 12) + label(160, 164, 14, 'jack and nine of trump')),
  skat: () => tile(FELT_DEEP, face(cid('JC'), 66, 34, 66, -14) + face(cid('JS'), 112, 30, 66, -5) + face(cid('JH'), 158, 30, 66, 5) + face(cid('JD'), 204, 34, 66, 14) + pill(112, 142, 96, 'Grand')),
  truco: () => tile(FELT, spanish(20, 66, 34, 66, -12) + spanish(30, 126, 28, 66) + spanish(26, 186, 34, 66, 12) + pill(120, 142, 80, 'Envido')),
  koikoi: () => tile(FELT_DEEP, hanafuda(0, 62, 34, 62, -12) + hanafuda(8, 129, 28, 62) + hanafuda(28, 196, 34, 62, 12) + pill(110, 142, 100, 'Koi-koi!')),
  bigtwo: () => tile(FELT, face(cid('2S'), 76, 36, 70, -12) + face(cid('2H'), 126, 30, 70) + face(cid('AS'), 176, 36, 70, 12) + label(160, 164, 14, 'twos are high')),
  tienlen: () => tile(FELT_DEEP, face(cid('2S'), 76, 36, 70, -12) + face(cid('2C'), 126, 30, 70) + face(cid('2D'), 176, 36, 70, 12) + pill(120, 142, 80, 'Chop!')),
  canasta: () => tile(FELT, face(cid('7C'), 66, 34, 66, -12) + face(cid('7D'), 112, 30, 66, -4) + face(cid('7H'), 158, 30, 66, 4) + face(cid('2S'), 204, 34, 66, 12) + pill(110, 142, 100, 'Canasta')),
  holdem: () => tile(FELT_DEEP, ['QH', 'JH', 'TH', '2C', '7D'].map((c, k) => face(cid(c), 52 + 44 * k, 24, 40)).join('') + face(cid('AS'), 118, 78, 46, -8) + face(cid('KS'), 160, 78, 46, 8) + pill(110, 152, 100, 'All in')),
  blackjack: () => tile(FELT, face(cid('AS'), 98, 34, 72, -8) + face(cid('KH'), 150, 30, 72, 8) + pill(124, 142, 72, '21')),
  teenpatti: () => tile(FELT_DEEP, face(cid('AS'), 76, 36, 70, -12) + face(cid('AD'), 126, 30, 70) + face(cid('AH'), 176, 36, 70, 12) + pill(120, 142, 80, 'Trail'))
});

// ── Write ──────────────────────────────────────────────────────────────────
let html = fs.readFileSync(file, 'utf8');

const spriteSvg = sprite.replace('</defs>', '<clipPath id="' + CLIP + '"><rect width="100" height="140" rx="' + CARD_R + '"/></clipPath></defs>');
html = /<!-- zimi-shelf:sprite -->[\s\S]*?<!-- \/zimi-shelf:sprite -->/.test(html)
  ? html.replace(/<!-- zimi-shelf:sprite -->[\s\S]*?<!-- \/zimi-shelf:sprite -->/, () => '<!-- zimi-shelf:sprite -->' + spriteSvg + '<!-- /zimi-shelf:sprite -->')
  : html.replace('<main class="ar-shelf">', () => '<!-- zimi-shelf:sprite -->' + spriteSvg + '<!-- /zimi-shelf:sprite -->\n<main class="ar-shelf">');

// The header: the ZimiGames icon (icon.svg, from scripts/icons) then the name as text in the page's own heading face (selectable, translatable).
const brand = '<h1 class="ar-brand"><img class="ar-lockup" src="icon.svg" alt="" width="44" height="44"><span>ZimiGames</span></h1>';
html = html.replace(/<h1 class="ar-brand">[\s\S]*?<\/h1>/, () => brand);

let redrawn = [];
// The art runs to the tile's text: a redrawn tile holds card svgs of its own,
// so stopping at the first </svg> would leave the rest behind on a second run.
html = html.replace(/(<a class="ar-game" href="([a-z0-9]+)\.html">\s*)<svg class="ar-game-art"[\s\S]*?(\s*<span class="ar-game-text">)/g, (all, head, name, text) => {
  if (!TILES[name]) return all;
  redrawn.push(name);
  return head + TILES[name]() + text;
});
fs.writeFileSync(file, html);
console.log('redrawn: ' + redrawn.join(', '));

// ── Thumbnails ─────────────────────────────────────────────────────────────
// Each tile's art again as a standalone svg (thumbs/<game>.svg, 320x180): what
// Zimi's Discover card loads for the day's game, a small file inside the ZIM
// that needs nothing else. Whatever a tile points at by id (the card sprite,
// the clip, a pattern) is copied in beside it.
const thumbDir = path.join(dir, 'thumbs');
fs.mkdirSync(thumbDir, { recursive: true });
const DEF_TAGS = 'symbol|linearGradient|radialGradient|clipPath|pattern';
const defined = (svg, id) => svg.indexOf('id="' + id + '"') >= 0;
const grab = (id) => {
  const m = new RegExp('<(' + DEF_TAGS + ')\\b[^>]*\\bid="' + id + '"[\\s\\S]*?</\\1>').exec(html);
  return m ? m[0] : '';
};
let thumbs = 0;
html.replace(/<a class="ar-game" href="([a-z0-9]+)\.html">\s*(<svg class="ar-game-art"[\s\S]*?<\/svg>)(?=\s*<span class="ar-game-text">)/g, (all, name, art) => {
  let body = art.replace(/^<svg class="ar-game-art"[^>]*>/, '').replace(/<\/svg>$/, '');
  let defs = '';
  for (let pass = 0; pass < 2; pass++) {
    const ids = new Set();
    (defs + body).replace(/(?:href="#|url\(#)([\w-]+)/g, (m, id) => { ids.add(id); return m; });
    ids.forEach((id) => { if (!defined(body + defs, id)) defs += grab(id); });
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">' + (defs ? '<defs>' + defs + '</defs>' : '') + body.trim() + '</svg>\n';
  fs.writeFileSync(path.join(thumbDir, name + '.svg'), svg);
  thumbs++;
  return all;
});
console.log('thumbnails: ' + thumbs);
