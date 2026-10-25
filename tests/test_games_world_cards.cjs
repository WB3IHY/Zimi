// ZimiGames' card games from around the world (Spades, Euchre, Gin Rummy,
// Cribbage, Crazy Eights, Durak, Scopa): the rules as pure functions on plain
// states. Legal plays, scoring, the computer players (played through whole
// hands and games, every play checked legal). No DOM: the game files run
// their page wiring only when a #zc-table exists.
//
// Run: node tests/test_games_world_cards.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'zimi', 'builtin', 'games');
let failures = 0, passed = 0;
const check = (ok, label) => {
  if (ok) { passed++; console.log('ok: ' + label); } else { console.error('FAIL: ' + label); failures++; }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const sandbox = {
  console, Date, setTimeout, clearTimeout, setInterval, clearInterval,
  document: { addEventListener() {}, querySelector: () => null, getElementById: () => null, documentElement: { classList: { toggle() {} } }, hidden: false }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['cards.js', 'cardtable.js', 'spades.js']) {
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f });
}
const Z = sandbox.ZimiCards, T = sandbox.ZimiTable;
const L = 'A23456789TJQK', SU = 'CDHS';
// A card from its short name: "QS" is the queen of spades, "TH" the ten of hearts.
const id = s => Z.make(L.indexOf(s[0]) + 1, SU.indexOf(s[1]));
const ids = s => s.split(' ').map(id);
// A seeded generator, so a failure replays.
const lcg = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const order = seed => Z.shuffled(lcg(seed));

// ── The shared table ────────────────────────────────────────────────────────
{
  const hand = T.sortHand(ids('AS 2H 5C KD 3S'), T.rankHigh);
  check(same(hand, ids('5C KD 3S AS 2H')), 'a hand sorts by alternating suit, ace high');
  check(T.rowsFor({ W: 390, pad: 8, cw: 49 }, 13) === 1 && T.rowsFor({ W: 390, pad: 8, cw: 49 }, 26) === 2, 'a 13-card hand fits one row on a phone; 26 wrap to two');
  const sh = T.shuffleOf([1, 2, 3, 4, 5], lcg(3));
  check(sh.length === 5 && sh.slice().sort().join() === '1,2,3,4,5', 'shuffleOf keeps the cards');
}

// ── Spades ──────────────────────────────────────────────────────────────────
{
  const SP = sandbox.ZimiSpades;
  const t = (bids, tricks, bags = 0) => SP.scoreTeam(bids, tricks, bags);
  check(t([3, 4], [4, 4]).points === 71 && t([3, 4], [4, 4]).bags === 1, 'a made contract of 7 with 8 tricks: 70 + 1 bag');
  check(t([3, 4], [2, 4]).points === -70, 'a missed contract of 7 loses 70');
  check(t([0, 5], [0, 5]).points === 150, 'nil made (+100) with the partner making 5 (+50)');
  check(t([0, 5], [1, 5]).points === 50 - 100 + 1 && t([0, 5], [1, 5]).bags === 1, 'nil broken: -100, and the nil bidder’s trick is a bag');
  check(t([4, 3], [4, 3], 9).points === 70 && t([4, 3], [4, 3], 9).bags === 9, 'bags: no penalty without extras');
  check(t([4, 3], [5, 3], 9).points === 70 + 1 - 100 && t([4, 3], [5, 3], 9).bags === 0 && t([4, 3], [5, 3], 9).penalty === 100, 'the tenth bag costs 100 and the count wraps');
  check(t([0, 0], [0, 0]).points === 200 && t([0, 0], [0, 0]).made === null, 'both nil and both clean: +200, no contract');
  check(SP.gameWinner([500, 480]) === 0 && SP.gameWinner([510, 520]) === 1 && SP.gameWinner([300, -210]) === 0 && SP.gameWinner([400, 400]) === -1, 'game end: 500 wins, -200 loses, the higher team over 500 wins');

  // Trump and following suit.
  const win = (cards) => SP.trickWinner(cards.map(([seat, c]) => ({ seat, id: id(c) })));
  check(win([[0, '5H'], [1, 'KH'], [2, '2S'], [3, 'AH']]) === 2, 'the lowest spade beats the ace of the suit led');
  check(win([[0, '5H'], [1, 'KH'], [2, '2D'], [3, 'AH']]) === 3, 'a discard of another suit never wins');
  check(win([[0, '5S'], [1, 'KS'], [2, '2S'], [3, 'AH']]) === 1, 'the highest spade wins a spade trick');
  const st = (hands, extra) => Object.assign({ hands: hands.map(ids), bids: [3, 3, 3, 3], dealer: 3, turn: 0, leader: 0, trick: [], tricks: [0, 0, 0, 0], broken: false, played: [], scores: [0, 0], bags: [0, 0], handNo: 0, phase: 'play', result: null }, extra);
  const open = st(['AS KS 2H 3C', '4D', '5D', '6D']);
  check(same(SP.legalPlays(open, 0), ids('2H 3C')), 'spades cannot lead until broken');
  check(same(SP.legalPlays(st(['AS KS', '4D', '5D', '6D']), 0), ids('AS KS')), 'an all-spade hand may lead spades');
  check(same(SP.legalPlays(Object.assign(open, { broken: true }), 0), ids('AS KS 2H 3C')), 'once broken, spades may lead');
  const follow = st(['AH 2H 5S 3C', '4D', '5D', '6D'], { trick: [{ seat: 3, id: id('9H') }], turn: 0 });
  check(same(SP.legalPlays(follow, 0), ids('AH 2H')), 'you must follow suit');
  const voidH = st(['5S 3C', '4D', '5D', '6D'], { trick: [{ seat: 3, id: id('9H') }] });
  check(same(SP.legalPlays(voidH, 0), ids('5S 3C')), 'void in the suit: anything goes, spades included');
  check(SP.playCard(voidH, 0, id('5S')).broken === true, 'a spade played on another suit breaks spades');

  // Bidding turns into play.
  let s = SP.dealHand(order(5), 0, [0, 0], [0, 0], 3);
  check(s.phase === 'bid' && s.turn === 0 && s.hands.every(h => h.length === 13), 'a new hand: bidding starts left of the dealer');
  s = SP.placeBid(SP.placeBid(SP.placeBid(SP.placeBid(s, 0, 3), 1, 0), 2, 4), 3, 2);
  check(s.phase === 'play' && s.turn === 0 && same(s.bids, [3, 0, 4, 2]), 'after four bids the play starts, with Nil kept as 0');

  // The computer bids and plays whole hands and games: every play legal.
  let games = 0, hands = 0, bad = 0, nilMade = 0, nilBid = 0;
  for (let seed = 1; seed <= 12; seed++) {
    let g = SP.newGame(order(seed * 7), seed % 4), guard = 0;
    while (g.phase !== 'over' && guard++ < 40) {
      let steps = 0;
      while ((g.phase === 'bid' || g.phase === 'play') && steps++ < 200) {
        if (g.phase === 'bid') { g = SP.placeBid(g, g.turn, SP.aiBid(g, g.turn)); continue; }
        if (g.trick.length === 4) { g = SP.resolveTrick(g); continue; }
        const c = SP.aiPick(g, g.turn);
        if (!SP.isLegal(g, g.turn, c)) { bad++; break; }
        g = SP.playCard(g, g.turn, c);
      }
      if (g.phase === 'handEnd') { hands++; g.bids.forEach((b, i) => { if (b === 0) { nilBid++; if (g.tricks[i] === 0) nilMade++; } }); g = SP.nextHand(g, order(seed * 100 + guard)); } else if (g.phase === 'over') hands++;
    }
    if (g.phase === 'over') games++;
  }
  check(bad === 0, 'the computer never plays an illegal card (' + hands + ' hands)');
  check(games === 12, 'every simulated game reaches 500 or -200 (' + games + ' of 12)');
  check(SP.estimate(ids('AS KS QS JS 9S 5S AH KH AD AC KC QC 2D')) > 6 && SP.estimate(ids('2S 3S 4D 5D 6D 7D 8H 9H 3C 4C 5C 6C 7C')) < 1.5, 'the bid estimate tells a strong hand from a weak one');
}

// ── END ─────────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
