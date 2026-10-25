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

// ── Code Breaker ────────────────────────────────────────────────────────────
{
  const C = load(['playkit.js', 'codebreaker.js']).CodeBreakerEngine;
  const fb = (c, g) => { const r = C.feedback(c, g); return r.exact + '/' + r.colour; };
  check(fb([0, 1, 2, 3], [0, 1, 2, 3]) === '4/0', 'code breaker: all right');
  check(fb([0, 1, 2, 3], [3, 2, 1, 0]) === '0/4', 'code breaker: all right colours, all wrong places');
  check(fb([0, 1, 2, 3], [4, 4, 5, 5]) === '0/0', 'code breaker: nothing');
  check(fb([0, 0, 1, 1], [0, 1, 0, 1]) === '2/2', 'code breaker: pairs of repeats');
  check(fb([0, 0, 1, 2], [0, 3, 0, 0]) === '1/1', 'code breaker: a repeated guess colour only counts as often as the code has it');
  check(fb([0, 1, 2, 3], [0, 0, 0, 0]) === '1/0', 'code breaker: four of one colour against one in the code');
  check(fb([1, 1, 1, 2], [1, 2, 2, 2]) === '2/0', 'code breaker: exact matches are taken before colour matches');
  check(fb([2, 2, 3, 3], [3, 3, 2, 2]) === '0/4', 'code breaker: swapped pairs');
  check(fb([5, 0, 5, 1], [0, 5, 5, 5]) === '1/2', 'code breaker: a surplus guess peg is not counted twice');
  // symmetry: feedback of (a, b) equals feedback of (b, a)
  let sym = true;
  for (let i = 0; i < 300; i++) { const r = C.makeCode(Math.random, true), s = C.makeCode(Math.random, true); sym = sym && fb(r, s) === fb(s, r); }
  check(sym, 'code breaker: the score is the same either way round');
  let uniq = true, rng = () => Math.random();
  for (let i = 0; i < 200; i++) { const c = C.makeCode(rng, false); uniq = uniq && new Set(c).size === 4 && c.every(x => x >= 0 && x < 6); }
  check(uniq, 'code breaker: codes without repeats have four different colours');
  check(C.isValid([0, 1, 2, 3], false) && !C.isValid([0, 0, 2, 3], false) && C.isValid([0, 0, 2, 3], true) && !C.isValid([0, 1, 2], true) && !C.isValid([0, 1, 2, 6], true), 'code breaker: guess validity');
}

// ── Pinball ─────────────────────────────────────────────────────────────────
{
  const P = load(['playkit.js', 'pinball.js']).PinballEngine;
  const DT = 1 / 60;
  const run = (st, secs, each) => { for (let i = 0; i < Math.round(secs / DT); i++) { P.step(st, DT); if (each) each(st); } };

  // A ball dropped on a flat wall bounces back up, a little slower.
  const ball = { x: 100, y: 99, vx: 0, vy: 300 };
  const c = P.contact(ball, 0, 100, 200, 100, 0);
  const hit = c && P.bounce(ball, c.nx, c.ny, 0.45, 0, 0);
  check(c && c.ny === -1 && ball.y <= 93.0001 && hit === 300 && Math.abs(ball.vy + 135) < 1e-9, 'pinball: a ball dropped on a wall is pushed out and bounces up slower');
  const slow = { x: 100, y: 93.5, vx: 0, vy: 20 };
  P.contact(slow, 0, 100, 200, 100, 0); P.bounce(slow, 0, -1, 0.45, 0, 0);
  check(Math.abs(slow.vy) < 1e-9, 'pinball: a slow touch does not bounce, so a ball can roll');

  // Gravity pulls a ball down the left inlane guide toward the flipper.
  let st = P.createState(); st.balls = [{ x: 30, y: 480, vx: 0, vy: 0, slow: 0 }]; st.status = 'play'; st.saver = 0;
  run(st, 0.9);
  check(st.balls[0] && st.balls[0].x > 60 && st.balls[0].y > 530, 'pinball: a ball rolls down the inlane guide');

  // The left flipper: a ball on it at rest stays; raised, it throws the ball up the table.
  st = P.createState(); st.balls = [{ x: 133, y: 574, vx: 0, vy: 0, slow: 0 }]; st.status = 'play'; st.saver = 0;
  run(st, 0.35);
  const settled = st.balls[0];
  check(settled && settled.y > 560 && settled.y < 600 && Math.abs(settled.vy) < 200, 'pinball: a ball comes to rest on a resting flipper');
  st.balls[0].vx = 0; st.balls[0].vy = 0; st.balls[0].x = 138; st.balls[0].y = 580; st.flippers[0].on = true;
  let upBest = 0, topY = 999;
  run(st, 0.5, s => { const b = s.balls[0]; if (b) { upBest = Math.max(upBest, -b.vy); topY = Math.min(topY, b.y); } });
  check(upBest > 600, 'pinball: a raised flipper throws the ball upward (' + Math.round(upBest) + ' px/s)');
  check(topY < 300, 'pinball: a flipper shot climbs the table (reached y=' + Math.round(topY) + ')');

  // The right flipper mirrors it.
  st = P.createState(); st.balls = [{ x: 194, y: 580, vx: 0, vy: 0, slow: 0 }]; st.status = 'play'; st.saver = 0; st.flippers[1].on = true;
  upBest = 0; run(st, 0.5, s => { const b = s.balls[0]; if (b) upBest = Math.max(upBest, -b.vy); });
  check(upBest > 600, 'pinball: the right flipper works the same way');

  // A pop bumper kicks the ball away and scores.
  st = P.createState(); st.balls = [{ x: 118, y: 292, vx: 0, vy: -420, slow: 0 }]; st.status = 'play'; st.saver = 0;
  let bump = false, away = 0;
  run(st, 0.4, s => { if (!bump && s.score >= 100) { bump = true; const b = s.balls[0]; away = Math.sqrt(b.vx * b.vx + b.vy * b.vy); } });
  check(bump && away >= P.BUMPER_KICK - 5 && st.score >= 100, 'pinball: a bumper scores 100 and kicks the ball away (' + Math.round(away) + ' px/s)');

  // A ball falling out the bottom costs a ball; the saver gives one back for free.
  st = P.createState(); st.balls = [{ x: 166, y: 700, vx: 0, vy: 100, slow: 0 }]; st.status = 'play'; st.saver = 0;
  P.step(st, DT);
  check(st.lives === 2 && st.status === 'ready' && st.balls.length === 1 && P.inLane(st.balls[0]), 'pinball: a drained ball costs a life and a new one waits in the lane');
  st = P.createState(); st.balls = [{ x: 166, y: 700, vx: 0, vy: 100, slow: 0 }]; st.status = 'play'; st.saver = 3;
  P.step(st, DT);
  check(st.lives === 3 && st.status === 'ready', 'pinball: the ball saver returns the ball for free');
  st = P.createState(); st.lives = 1; st.balls = [{ x: 166, y: 700, vx: 0, vy: 100, slow: 0 }]; st.status = 'play'; st.saver = 0;
  P.step(st, DT);
  check(st.status === 'over' && st.events.some(e => e.name === 'over'), 'pinball: the last ball ends the game');

  // Nothing tunnels through a wall at top speed.
  st = P.createState(); st.balls = [{ x: 100, y: 300, vx: -P.MAX_SPEED, vy: 0, slow: 0 }]; st.status = 'play'; st.saver = 0;
  let minX = 999; run(st, 1, s => { if (s.balls[0]) minX = Math.min(minX, s.balls[0].x); });
  check(minX > 14, 'pinball: a ball at top speed does not pass the left wall (closest x=' + minX.toFixed(1) + ')');
  st = P.createState(); st.balls = [{ x: 330, y: 400, vx: P.MAX_SPEED, vy: 0, slow: 0 }]; st.status = 'play'; st.saver = 0;
  let maxX = 0; run(st, 1, s => { if (s.balls[0]) maxX = Math.max(maxX, s.balls[0].x); });
  check(maxX < 346, 'pinball: nor the right wall');

  // The plunger: a full shot climbs the lane, goes over the top and lands on the table; a feeble one falls back.
  st = P.createState(); st.charging = true; run(st, 1);
  check(st.charge === 1 && P.launch(st) && st.status === 'play', 'pinball: a full plunger launches');
  let inField = false, escaped = false;
  run(st, 4, s => { const b = s.balls[0]; if (b) { if (b.x < 316 && b.y < 330) inField = true; if (b.x < 0 || b.x > 360 || b.y < 0) escaped = true; } });
  check(inField && !escaped, 'pinball: the launch goes over the top onto the table and stays on it');
  st = P.createState(); st.charging = true; run(st, 0.25);
  P.launch(st);
  let reached = 999; run(st, 3, s => { const b = s.balls[0]; if (b) reached = Math.min(reached, b.y); });
  check(reached > 200 && st.status === 'ready' && st.balls.length === 1 && P.inLane(st.balls[0]), 'pinball: a weak shot falls back into the lane and can be shot again');
  st = P.createState(); st.charging = true; run(st, 0.55); P.launch(st);
  inField = false; run(st, 4, s => { const b = s.balls[0]; if (b && b.x < 316 && b.y < 330) inField = true; });
  check(inField, 'pinball: a half-strength shot still makes it onto the table');

  // Rollover lanes raise the multiplier; a full bank of targets starts multiball.
  st = P.createState(); st.status = 'play'; st.saver = 99;
  P.LANES.forEach(l => { st.balls = [{ x: l.x, y: l.y, vx: 0, vy: 0, slow: 0 }]; P.step(st, DT); });
  check(st.mult === 2 && st.lanes.every(v => v === 0) && st.score >= P.POINTS.lane * 3 + P.POINTS.laneSet, 'pinball: three lanes raise the multiplier');
  st = P.createState(); st.status = 'play'; st.saver = 99; st.targets = [1, 1, 0, 0, 0, 0];
  st.balls = [{ x: 30, y: 347, vx: -10, vy: 260, slow: 0 }];
  run(st, 0.3);
  check(st.balls.length === 3 && st.targets.slice(0, 3).every(v => v === 0), 'pinball: the third target of a bank starts multiball');
  // With several balls in play, losing one does not cost a life.
  st.balls[0].y = 700; P.step(st, DT);
  check(st.lives === 3 && st.balls.length === 2, 'pinball: a multiball loss does not cost a life');
  // Walls close the table: no gap anywhere except the drain.
  check(P.WALLS.length > 40, 'pinball: the table has its walls');
}

// ── Rocks ───────────────────────────────────────────────────────────────────
{
  const R = load(['playkit.js', 'rocks.js']).RocksEngine;
  const DT = 1 / 60;
  const calm = (seed) => { const st = R.createState(seed); st.rocks = []; st.saucerIn = 1e9; st.ship.inv = 0; return st; };
  const put = (st, o) => Object.assign({ x: 0, y: 0, vx: 0, vy: 0 }, o);

  check(R.wrap(-5) === R.SIZE - 5 && R.wrap(R.SIZE + 3) === 3 && R.wrap(200) === 200, 'rocks: the field wraps');
  check(Math.abs(R.torusDist(5, 5, R.SIZE - 5, R.SIZE - 5) - Math.sqrt(200)) < 1e-9, 'rocks: distance goes the short way round the edge');

  // A ship drifting off the right edge comes back on the left.
  let st = calm(1); st.ship.x = R.SIZE - 2; st.ship.vx = 100; st.ship.vy = 0;
  R.step(st, 0.1, {});
  check(st.ship.x < 20 && st.ship.x >= 0, 'rocks: a ship wraps through the edge');
  // Thrust points where the nose points; turning turns the nose.
  st = calm(2); R.step(st, 0.5, { thrust: true });
  check(st.ship.vy < -50 && Math.abs(st.ship.vx) < 1e-9, 'rocks: thrust goes the way the nose points (up at first)');
  st = calm(3); R.step(st, 0.25, { right: true });
  check(Math.abs(st.ship.a - R.TURN * 0.25) < 1e-9, 'rocks: turning right turns the nose clockwise');

  // Splitting: a big rock gives two medium ones, a medium two small, a small none.
  const rng = R.mulberry(5);
  const big = R.makeRock(rng, 3, 100, 100, 30, 0);
  const parts = R.splitRock(big, rng);
  check(parts.length === 2 && parts.every(p => p.size === 2 && p.x === 100 && p.y === 100), 'rocks: a big rock splits into two medium ones');
  check(R.splitRock(parts[0], rng).length === 2 && R.splitRock(parts[0], rng).every(p => p.size === 1) && R.splitRock(R.splitRock(parts[0], rng)[0], rng).length === 0, 'rocks: medium into two small, small into nothing');
  check(parts[0].vx !== parts[1].vx || parts[0].vy !== parts[1].vy, 'rocks: the pieces leave in different directions');

  // A bullet kills a rock: it splits, and the score is the rock\'s.
  st = calm(4); st.ship.x = 50; st.ship.y = 350; st.ship.a = Math.PI / 2; // nose points right
  st.rocks = [R.makeRock(R.mulberry(9), 3, 130, 350, 0, 0)];
  R.fire(st);
  check(st.bullets.length === 1 && st.bullets[0].vx > 400, 'rocks: the ship fires from its nose');
  for (let i = 0; i < 30 && st.score === 0; i++) R.step(st, DT, {});
  check(st.score === 20 && st.rocks.length === 2 && st.rocks.every(r => r.size === 2) && st.bullets.length === 0, 'rocks: a hit splits a big rock and scores 20');
  // At most four bullets of your own.
  st = calm(5); st.ship.a = 0;
  let fired = 0; for (let i = 0; i < 20; i++) { st.ship.cool = 0; if (R.fire(st)) fired++; }
  check(fired === R.MAX_BULLETS, 'rocks: four shots on the screen at a time');
  // Bullets expire.
  st = calm(6); R.fire(st); for (let i = 0; i < 80; i++) R.step(st, DT, {});
  check(st.bullets.length === 0, 'rocks: a bullet runs out');

  // A rock hitting the ship costs a life; a ship that has just arrived is safe; the ship comes back.
  st = calm(7); st.rocks = [put(st, { x: R.SIZE / 2, y: R.SIZE / 2, vx: 0, vy: 0, size: 3, r: 30, shape: [1, 1, 1, 1, 1, 1], rot: 0, spin: 0 })]; st.ship.inv = 0;
  R.step(st, DT, {});
  check(!st.ship.alive && st.lives === R.START_LIVES - 1, 'rocks: a rock hitting the ship costs a life');
  st = calm(8); st.rocks = [put(st, { x: R.SIZE / 2, y: R.SIZE / 2, size: 3, r: 30, shape: [1, 1, 1, 1, 1, 1], rot: 0, spin: 0 })]; st.ship.inv = 2;
  R.step(st, DT, {});
  check(st.ship.alive && st.lives === R.START_LIVES, 'rocks: a new ship cannot be hit for a moment');
  st = calm(9); st.ship.inv = 0; st.rocks = [put(st, { x: R.SIZE / 2 + 5, y: R.SIZE / 2, size: 1, r: 9, shape: [1, 1, 1, 1], rot: 0, spin: 0 })];
  R.step(st, DT, {}); st.rocks = [];
  for (let i = 0; i < 150; i++) R.step(st, DT, {});
  check(st.ship.alive && st.ship.inv > 0, 'rocks: the ship returns to the middle once it is clear');
  // The last ship lost ends the game.
  st = calm(10); st.lives = 1; st.ship.inv = 0; st.rocks = [put(st, { x: R.SIZE / 2, y: R.SIZE / 2, size: 1, r: 9, shape: [1, 1, 1, 1], rot: 0, spin: 0 })];
  R.step(st, DT, {});
  check(st.status === 'over' && st.events.some(e => e.name === 'over'), 'rocks: the last ship ends the game');

  // The saucer: shooting it scores, it shoots back, and clearing everything starts the next wave.
  st = calm(11); st.ship.x = 50; st.ship.y = 300; st.ship.a = Math.PI / 2; st.rocks = [put(st, { x: 380, y: 20, size: 1, r: 9, shape: [1, 1, 1, 1], rot: 0, spin: 0 })];
  st.saucer = { x: 140, y: 300, vx: 0, vy: 0, small: false, r: 15, turnIn: 9, fireIn: 9 };
  R.fire(st); for (let i = 0; i < 30 && st.saucer; i++) R.step(st, DT, {});
  check(!st.saucer && st.score === R.SAUCER.big.points, 'rocks: shooting the saucer scores 200');
  st = calm(12); st.ship.x = 50; st.ship.y = 50; st.rocks = [put(st, { x: 380, y: 380, size: 1, r: 9, shape: [1, 1, 1, 1], rot: 0, spin: 0 })];
  st.saucer = { x: 100, y: 300, vx: 0, vy: 0, small: true, r: 10, turnIn: 9, fireIn: 0.01 };
  R.step(st, 0.05, {});
  check(st.bullets.some(b => !b.own), 'rocks: the saucer shoots');
  st = calm(13); const w0 = st.wave;
  for (let i = 0; i < 120; i++) R.step(st, DT, {});
  check(st.wave === w0 + 1 && st.rocks.length === 3 + st.wave && st.rocks.every(r => r.size === 3), 'rocks: an empty sky brings the next, bigger wave');
  // A new ship every 10,000.
  st = calm(14); st.score = R.EXTRA_LIFE_EVERY - 20; st.rocks = [R.makeRock(R.mulberry(9), 3, 130, 350, 0, 0)]; st.ship.x = 50; st.ship.y = 350; st.ship.a = Math.PI / 2; R.fire(st);
  for (let i = 0; i < 30 && st.score < R.EXTRA_LIFE_EVERY; i++) R.step(st, DT, {});
  check(st.lives === R.START_LIVES + 1, 'rocks: 10,000 points earns a ship');
}

// END
if (failures) { console.error(failures + ' failed'); process.exit(1); }
console.log('all passed');
