// ZimiGames: people on one device in the table card games (Big Two, Tien Len, Canasta,
// Blackjack, Hold'em, Bridge). With two or more person seats the table shows only the
// viewer's hand, face down when it is not their turn, and only a person other than the
// viewer needs the "Pass to" screen. No DOM beyond the stubs: the game files run their page
// wiring only when a #zc-table exists.
// Run: node tests/test_games_hotseat2.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'zimi', 'builtin', 'games');
let failures = 0, passed = 0;
const check = (ok, label) => {
  if (ok) { passed++; console.log('ok: ' + label); } else { console.error('FAIL: ' + label); failures++; }
};

const sandbox = {
  console, Date, setTimeout, clearTimeout, setInterval, clearInterval,
  document: { addEventListener() {}, querySelector: () => null, getElementById: () => null, documentElement: { classList: { toggle() {} } }, hidden: false }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['cards.js', 'handoff.js', 'cardtable.js', 'climbing.js', 'bigtwo.js', 'tienlen.js', 'canasta.js', 'blackjack.js', 'holdem.js', 'bridge.js']) {
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f });
}
const Z = sandbox.ZimiCards;
const lcg = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const metrics = () => ({ W: 390, H: 790, pad: 8, gap: 5, left: 8, cw: 48, ch: 67, step: 44, cols: 7 });
const faceUp = placed => placed.cards.filter(c => c.up).map(c => c.id);
// Face-up cards on the table that belong to a hand other than the viewer's.
const leaks = (placed, hands, viewer) => placed.cards.filter(c => c.up && hands.some((h, s) => s !== viewer && h.indexOf(c.id) >= 0));
const CARD_WORDS = /\b(ace|king|queen|jack|two|three|four|five|six|seven|eight|nine|ten|joker)\b/;

// ── The handoff rule the games rely on ──
{
  const S = sandbox.ZimiSeats;
  check(S.needsCover(['person', 'person', 'cpu', 'cpu'], 0, 1) && !S.needsCover(['person', 'person', 'cpu', 'cpu'], 1, 1), 'two people: the other person gets the Pass-to screen, the viewer does not');
  check(!S.needsCover(['person', 'cpu', 'cpu', 'cpu'], 0, 1) && !S.needsCover(['person', 'person', 'cpu', 'cpu'], 0, 2), 'a lone person, or a computer seat, never needs a cover');
}

// ── Big Two and Tien Len: the viewer's hand at the bottom, face down off their turn ──
for (const [name, G] of [['Big Two', sandbox.ZimiBigTwo], ['Tien Len', sandbox.ZimiTienLen]]) {
  const st = G.newHand(Z.shuffled(lcg(7)), [0, 0, 0, 0], 0, 0);
  const open = G.place(st, metrics(), { sel: [], viewer: 2, hideHand: false });
  const mine = open.cards.filter(c => c.pile[0] === 'h');
  check(mine.length === 13 && mine.every(c => c.up && st.hands[2].indexOf(c.id) >= 0), name + ': seat 2 looking sees its own 13 cards face up at the bottom');
  check(leaks(open, st.hands, 2).length === 0, name + ': nobody else\'s card is face up');
  const covered = G.place(st, metrics(), { sel: [], viewer: 2, hideHand: true });
  check(faceUp(covered).length === 0 && covered.cards.filter(c => c.pile[0] === 'h').length === 13, name + ': off the viewer\'s turn their hand is face down');
  check(covered.slots.every(s => !CARD_WORDS.test(s.label || '') || s.id === 'table'), name + ': hidden cards carry no card names');
  const solo = G.place(st, metrics(), { sel: [] });
  check(solo.cards.filter(c => c.pile[0] === 'h').every(c => c.up && st.hands[0].indexOf(c.id) >= 0), name + ': with no viewer set seat 0 is at the bottom, face up');
}

// ── Canasta: two people, each side's hand at the bottom for its own player ──
{
  const C = sandbox.ZimiCanasta, T = sandbox.ZimiTable;
  const all = Array.from({ length: C.TOTAL }, (_, i) => i);
  const st = C.newHand(T.shuffleOf(all, lcg(3)), [0, 0], 0, 5000);
  for (const V of [0, 1]) {
    const open = C.place(st, metrics(), { sel: [], viewer: V, hideHand: false });
    const mine = open.cards.filter(c => c.pile[0] === 'h');
    check(mine.length === st.hands[V].length && mine.every(c => c.up && st.hands[V].indexOf(c.id) >= 0), 'Canasta: side ' + V + ' looking sees its own hand face up');
    check(leaks(open, st.hands, V).length === 0, 'Canasta: side ' + V + ' looking, the other hand stays face down');
    const covered = C.place(st, metrics(), { sel: [], viewer: V, hideHand: true });
    check(faceUp(covered).every(id => st.hands[0].indexOf(id) < 0 && st.hands[1].indexOf(id) < 0) && covered.slots.every(s => !CARD_WORDS.test(s.label || '') || /pile|Stock/i.test(s.label)), 'Canasta: off side ' + V + '\'s turn neither hand shows');
  }
  const solo = C.place(st, metrics(), { sel: [] });
  check(solo.cards.filter(c => c.pile[0] === 'h').every(c => c.up && st.hands[0].indexOf(c.id) >= 0), 'Canasta: with no viewer set side 0 is at the bottom');
}

console.log(failures ? failures + ' failure(s), ' + passed + ' passed' : 'all passed (' + passed + ')');
process.exit(failures ? 1 : 0);
