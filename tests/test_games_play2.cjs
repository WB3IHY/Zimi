// Dice, arcade and kids games: the rules, with no DOM. Yacht scoring, Liar's Dice bids, Fleet,
// Code Breaker feedback, Pinball / Rocks / Lander physics, Noughts and Crosses perfect play, and the rest.
//
// Run: node tests/test_games_play2.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'zimi', 'builtin', 'games');
function load(files) {
  const sandbox = {};
  vm.createContext(sandbox);
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f }));
  return sandbox;
}

let failures = 0;
const check = (ok, label) => {
  if (ok) console.log('ok: ' + label);
  else { console.error('FAIL: ' + label); failures++; }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── Yacht ───────────────────────────────────────────────────────────────────
{
  const Y = load(['playkit.js', 'yacht.js']).YachtEngine;
  const s = (cat, d) => Y.score(cat, d);
  check(Y.CATS.length === 13, 'yacht: thirteen rows');
  check(s('ones', [1, 1, 2, 3, 1]) === 3 && s('twos', [2, 2, 2, 2, 2]) === 10 && s('threes', [3, 1, 3, 4, 5]) === 6, 'yacht: upper rows count their face');
  check(s('fours', [4, 4, 4, 1, 2]) === 12 && s('fives', [5, 1, 2, 3, 4]) === 5 && s('sixes', [6, 6, 1, 2, 3]) === 12, 'yacht: fours, fives, sixes');
  check(s('three', [3, 3, 3, 1, 2]) === 12 && s('three', [3, 3, 4, 1, 2]) === 0 && s('three', [6, 6, 6, 6, 6]) === 30, 'yacht: three of a kind sums every die, or nothing');
  check(s('four', [2, 2, 2, 2, 5]) === 13 && s('four', [2, 2, 2, 5, 5]) === 0 && s('four', [4, 4, 4, 4, 4]) === 20, 'yacht: four of a kind sums every die, or nothing');
  check(s('house', [2, 2, 3, 3, 3]) === 13 && s('house', [2, 2, 2, 2, 3]) === 0 && s('house', [4, 4, 4, 4, 4]) === 0 && s('house', [1, 2, 3, 3, 3]) === 0, 'yacht: full house is three and two, not five alike');
  check(s('little', [3, 1, 2, 5, 4]) === 30 && s('little', [2, 3, 4, 5, 6]) === 0 && s('little', [1, 2, 3, 4, 4]) === 0, 'yacht: little straight is 1 to 5');
  check(s('big', [6, 5, 4, 3, 2]) === 30 && s('big', [1, 2, 3, 4, 5]) === 0, 'yacht: big straight is 2 to 6');
  check(s('choice', [1, 2, 3, 4, 6]) === 16, 'yacht: choice is the sum');
  check(s('yacht', [5, 5, 5, 5, 5]) === 50 && s('yacht', [5, 5, 5, 5, 4]) === 0, 'yacht: five alike is 50');

  const card = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 };
  check(Y.upper(card) === 63 && Y.bonus(card) === 35 && Y.total(card) === 98, 'yacht: 63 in the top six earns 35');
  card.sixes = 12;
  check(Y.upper(card) === 57 && Y.bonus(card) === 0 && Y.total(card) === 57, 'yacht: 57 earns no bonus');

  // A whole game plays to the end with each row used once; held dice stay put.
  const g = Y.createGame(1, 5);
  let turns = 0;
  check(Y.choose(g, 'ones') === false, 'yacht: cannot score before rolling');
  while (!g.over && turns < 200) {
    Y.roll(g);
    const keep = g.dice.slice();
    if (turns === 0) { Y.toggleHold(g, 0); Y.roll(g); check(g.dice[0] === keep[0], 'yacht: a held die keeps its value'); }
    const open = Y.openCats(g.players[g.turn].card);
    Y.choose(g, Y.bestRow(g.dice, open));
    turns++;
  }
  check(g.over && turns === 26 && g.players.every(p => Object.keys(p.card).length === 13), 'yacht: two players finish in 26 turns, 13 rows each');
  const g2 = Y.createGame(0, 9); Y.roll(g2); Y.choose(g2, 'choice');
  g2.dice = [1, 1, 1, 1, 1]; g2.rollsLeft = 2;
  check(Y.choose(g2, 'choice') === false, 'yacht: a row is used once');
  const mask = Y.bestHold([6, 6, 6, 6, 2], Y.openCats({}));
  check(mask.slice(0, 4).every(Boolean) && !mask[4], 'yacht: the computer keeps four sixes and rerolls the odd die');
}

// ── Liar's Dice ─────────────────────────────────────────────────────────────
{
  const L = load(['playkit.js', 'liarsdice.js']).LiarsDiceEngine;
  const legal = (p, q, f, t) => L.isLegal(p, q, f, t);
  check(legal(null, 1, 1, 10) && legal(null, 3, 6, 10) && !legal(null, 0, 3, 10) && !legal(null, 11, 3, 10) && !legal(null, 2, 7, 10), 'liars dice: an opening bid is any quantity on the table and any face');
  check(legal({ q: 3, f: 4 }, 4, 2, 10) && legal({ q: 3, f: 4 }, 3, 5, 10) && !legal({ q: 3, f: 4 }, 3, 4, 10) && !legal({ q: 3, f: 4 }, 3, 3, 10) && !legal({ q: 3, f: 4 }, 2, 6, 10), 'liars dice: raise the quantity, or the face at the same quantity');
  check(legal({ q: 5, f: 3 }, 3, 1, 12) && !legal({ q: 5, f: 3 }, 2, 1, 12), 'liars dice: a bid on ones needs half the quantity, rounded up');
  check(legal({ q: 3, f: 1 }, 7, 2, 12) && !legal({ q: 3, f: 1 }, 6, 2, 12) && legal({ q: 3, f: 1 }, 4, 1, 12) && !legal({ q: 3, f: 1 }, 3, 1, 12), 'liars dice: off ones takes twice the quantity plus one; ones over ones just goes up');
  check(L.minQty({ q: 5, f: 3 }, 1, 12) === 3 && L.minQty({ q: 3, f: 1 }, 6, 12) === 7 && L.minQty({ q: 3, f: 1 }, 6, 6) === 0, 'liars dice: minQty agrees with the rules');
  check(L.legalBids({ q: 4, f: 6 }, 8).every(b => legal({ q: 4, f: 6 }, b.q, b.f, 8)) && L.legalBids({ q: 4, f: 6 }, 8).length > 0, 'liars dice: every listed raise is legal');
  check(L.countFace([1, 1, 3, 4, 3], 3) === 4 && L.countFace([1, 1, 3, 4, 3], 1) === 2 && L.countFace([2, 2, 5, 6, 1], 4) === 1, 'liars dice: ones are wild except when bid on');

  // A challenge: the bid stands when there are enough dice, and the challenger loses one; otherwise the bidder does.
  const mk = (a, b, bid) => { const g = L.createGame(2, 3); g.players[0].dice = a; g.players[1].dice = b; g.players[0].n = a.length; g.players[1].n = b.length; g.bid = bid; g.turn = 0; return g; };
  let g = mk([2, 2, 3, 1, 6], [2, 5, 5, 4, 1], { q: 5, f: 2, by: 1 });
  let r = L.act(g, { type: 'challenge' });
  check(r && r.actual === 5 && r.bidTrue && r.loser === 0 && g.players[0].n === 4 && g.players[1].n === 5 && g.turn === 0 && g.bid === null, 'liars dice: a true bid costs the challenger a die, and the loser opens');
  g = mk([2, 2, 3, 1, 6], [2, 5, 5, 4, 1], { q: 6, f: 2, by: 1 });
  r = L.act(g, { type: 'challenge' });
  check(r && r.actual === 5 && !r.bidTrue && r.loser === 1 && g.players[1].n === 4 && g.turn === 1, 'liars dice: a false bid costs the bidder a die');
  check(L.act(mk([1, 2], [3, 4], null), { type: 'challenge' }) === false, 'liars dice: no challenge with nothing bid');
  g = mk([2], [3], { q: 2, f: 5, by: 0 }); g.turn = 1;
  r = L.act(g, { type: 'challenge' });
  check(g.over && g.winner === 1 && g.players[0].n === 0, 'liars dice: the last player with dice wins');
  g = mk([2, 2], [3, 3], { q: 2, f: 4, by: 0 }); g.turn = 1;
  check(L.act(g, { type: 'bid', q: 2, f: 4 }) === false && L.act(g, { type: 'bid', q: 2, f: 5 }) === true && g.turn === 0 && g.bid.by === 1, 'liars dice: an illegal bid is refused, a legal one passes the turn');

  // Computers only ever make legal moves, and a table of them plays to a winner.
  let illegal = 0, finished = 0, bids = 0, calls = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const t = L.createGame(2 + (seed % 5), seed);
    let guard = 0;
    while (!t.over && guard++ < 2000) {
      const m = L.aiMove(t);
      if (m.type === 'bid') { bids++; if (!L.isLegal(t.bid, m.q, m.f, L.totalDice(t))) { illegal++; break; } }
      else { calls++; if (!t.bid) { illegal++; break; } }
      const res = L.act(t, m);
      if (!res) { illegal++; break; }
      if (m.type === 'challenge') L.nextRound(t);
    }
    if (t.over) finished++;
  }
  check(illegal === 0 && finished === 40, "liars dice: forty computer-only games, " + bids + ' bids and ' + calls + ' calls, none illegal, all finished');
  check(calls > 100 && bids > 300, 'liars dice: the computers both bid and call');
  const strong = L.chance([5, 5, 5, 5, 5], 10, 8, 5), weak = L.chance([2, 3, 4, 6, 6], 10, 8, 5);
  check(strong > weak && L.chance([5, 5, 5], 3, 4, 5) === 0 && L.chance([5, 5, 5], 3, 3, 5) === 1, 'liars dice: the odds the computer works from are sane');
}

// ── Fleet ───────────────────────────────────────────────────────────────────
{
  const F = load(['playkit.js', 'fleet.js']).FleetEngine;
  const b = F.createBoard();
  check(F.addShip(b, 'Carrier', 5, 0, 0, true) && b.ships[0].cells.length === 5, 'fleet: a ship is placed across');
  check(F.addShip(b, 'X', 3, 3, 0, true) === null && F.addShip(b, 'X', 3, 8, 3, true) === null && F.addShip(b, 'X', 3, 0, 9, false) === null && F.addShip(b, 'X', 3, -1, 2, true) === null, 'fleet: no overlap, nothing off the edge');
  check(F.addShip(b, 'Cruiser', 4, 2, 0, false) === null && F.addShip(b, 'Cruiser', 4, 5, 0, false) !== null, 'fleet: ships may not cross');

  // Firing: miss, hit, sunk, repeat, and the win.
  const t = F.createBoard(); F.addShip(t, 'Skiff', 2, 3, 3, true); F.addShip(t, 'Sloop', 3, 0, 9, true);
  check(F.fire(t, 0, 0).result === 'miss' && t.shots[0][0] === F.MISS, 'fleet: a shot in open water is a miss');
  check(F.fire(t, 0, 0) === null, 'fleet: the same square twice is refused');
  const h = F.fire(t, 3, 3);
  check(h.result === 'hit' && h.ship.name === 'Skiff' && !h.win && t.shots[3][3] === F.HIT, 'fleet: a hit');
  const sk = F.fire(t, 4, 3);
  check(sk.result === 'sunk' && sk.ship.name === 'Skiff' && !sk.win && t.shots[3][3] === F.SUNK && t.shots[3][4] === F.SUNK, 'fleet: the last hit sinks it and marks every square');
  F.fire(t, 0, 9); F.fire(t, 1, 9);
  const last = F.fire(t, 2, 9);
  check(last.result === 'sunk' && last.win, 'fleet: sinking the last ship wins');
  check(F.remainingLens(t).length === 0, 'fleet: nothing left afloat');

  // Random fleets are legal: five ships, right lengths, no overlap, inside the grid.
  let legalFleets = true;
  for (let s = 1; s <= 200; s++) {
    const rf = F.randomFleet(F.mulberry(s)), seen = new Set();
    legalFleets = legalFleets && rf.ships.length === 5 && rf.ships.map(x => x.len).sort().join() === '2,3,3,4,5';
    rf.ships.forEach(sh => sh.cells.forEach(c => { const k = c[0] + ',' + c[1]; if (seen.has(k) || c[0] < 0 || c[1] < 0 || c[0] > 9 || c[1] > 9) legalFleets = false; seen.add(k); }));
  }
  check(legalFleets, 'fleet: 200 random fleets are all legal');

  // The computer hunts: after a hit it fires next to it, and it clears random fleets in well under 100 shots.
  const sh = F.createBoard().shots; sh[4][4] = F.HIT;
  const pick = F.aiShot(sh, [5, 4, 3, 3, 2], F.mulberry(1));
  check(Math.abs(pick[0] - 4) + Math.abs(pick[1] - 4) === 1, 'fleet: the computer fires beside a standing hit');
  const sh2 = F.createBoard().shots; sh2[4][4] = F.HIT; sh2[4][5] = F.HIT;
  const pk2 = F.aiShot(sh2, [5, 4, 3, 3, 2], F.mulberry(2));
  check(pk2[1] === 4 && (pk2[0] === 3 || pk2[0] === 6), 'fleet: two hits in a row, it follows the line');
  let totalShots = 0, worst = 0, ok = true;
  for (let s = 1; s <= 60; s++) {
    const rng = F.mulberry(s * 7), board = F.randomFleet(rng); let n = 0, win = false;
    while (!win && n < 100) { const p = F.aiShot(board.shots, F.remainingLens(board), rng); if (!p) { ok = false; break; } win = F.fire(board, p[0], p[1]).win; n++; }
    ok = ok && win; totalShots += n; worst = Math.max(worst, n);
  }
  check(ok && totalShots / 60 < 65, 'fleet: the computer clears 60 random fleets, averaging ' + (totalShots / 60).toFixed(1) + ' shots (worst ' + worst + ')');
}

// END
if (failures) { console.error(failures + ' failed'); process.exit(1); }
console.log('all passed');
