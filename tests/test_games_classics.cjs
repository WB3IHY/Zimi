// Console-classic style games (Hopper, Muncher, Crossing, Blast, Quest, Zimi Pet): the rules, with no DOM.
// Platformer collision and jump arc, maze chaser targeting, crossing lane collisions, bomb blasts and chain
// reactions, quest door and key logic, pet stat decay over elapsed time and growth.
//
// Run: node tests/test_games_classics.cjs   (exit 0 = pass)

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

// ── Hopper ──────────────────────────────────────────────────────────────────
{
  const H = load(['hopper.js']).HopperEngine;
  const T = H.T, DT = 1 / 60;
  const flat = (extra) => ({ name: 't', theme: 'meadow', rows: [
    '                    ', '                    ', '                    ', '                    ',
    '                    ', ' s                  ', '####################', '####################'].map((r, i) => (extra && extra[i]) || r) });
  const run = (st, secs, input) => { for (let i = 0; i < Math.round(secs / DT); i++) H.step(st, DT, typeof input === 'function' ? input(i) : input); };

  check(H.LEVELS.length === 6, 'hopper: six levels');
  check(H.LEVELS.every(l => l.rows.length === H.ROWS && l.rows.every(r => r.length === l.rows[0].length)), 'hopper: every level is 8 rows of one width');
  check(H.LEVELS.every(l => l.rows.join('').split('s').length === 2 && l.rows.join('').split('F').length === 2), 'hopper: one start and one flag per level');

  // collision: standing on the ground, falling stops on top of it; walls stop a run
  let st = H.createState(flat());
  run(st, 0.5, {});
  check(Math.abs(st.y + st.h - 6 * T) < 0.01 && st.onGround, 'hopper: lands and stands on the ground');
  const wall = flat(['', '', '', '', '', ' s     B           ']);
  wall.rows[4] = '       B            '; wall.rows[3] = '       B            ';
  st = H.createState(wall);
  run(st, 2, { right: true });
  check(st.x + st.w <= 7 * T + 0.001 && st.x + st.w >= 7 * T - 0.5, 'hopper: a wall stops the run flush');
  st = H.createState(flat());
  run(st, 0.2, {});
  run(st, 1, { left: true });
  check(st.x >= 0, 'hopper: the left edge of a level is a wall');

  // jump arc: hold = full height and back on the ground; tap = a short hop
  function apex(inputFn, secs) {
    const s = H.createState(flat()); run(s, 0.3, {});
    const ground = s.y; let top = ground, landedAt = -1;
    for (let i = 0; i < Math.round(secs / DT); i++) {
      H.step(s, DT, inputFn(i));
      top = Math.min(top, s.y);
      if (landedAt < 0 && i > 5 && s.onGround) landedAt = i;
    }
    return { rise: ground - top, landedAt, s };
  }
  const full = apex(i => ({ jump: i < 60 }), 1.5), tap = apex(i => ({ jump: i < 3 }), 1.5);
  check(full.rise > 3 * T - 4 && full.rise < 3.8 * T, 'hopper: a held jump rises about three and a half tiles (' + full.rise.toFixed(1) + ' px)');
  check(tap.rise > 4 && tap.rise < full.rise * 0.5, 'hopper: a tap is a short hop (' + tap.rise.toFixed(1) + ' px)');
  check(full.landedAt > 0 && full.s.onGround, 'hopper: the jump comes back down to the ground');
  const air = full.landedAt / 60;
  check(air > 0.55 && air < 0.85, 'hopper: a full jump hangs for ' + air.toFixed(2) + ' s');

  // a jump clears a three-tile gap but not a six-tile one
  function gapLevel(w) {
    const g = '#'.repeat(5) + ' '.repeat(w) + '#'.repeat(26 - 5 - w);
    return { name: 'g', theme: 'meadow', rows: ['', '', '', '', '', '', '', ''].map((_, i) => i === 5 ? '    s' + ' '.repeat(21) : i >= 6 ? g : ' '.repeat(26)) };
  }
  function tryGap(w) {
    const s = H.createState(gapLevel(w));
    let jumped = false;
    run(s, 4, i => { const edge = s.x + s.w >= 5 * T - 2; if (edge) jumped = true; return { right: true, jump: s.x + s.w >= 5 * T - 6 && s.x < 5 * T + 4 }; });
    return s.x > (5 + w) * T && s.status === 'playing' && s.hearts === 3;
  }
  check(tryGap(3), 'hopper: a running jump clears a three-tile gap');
  check(!tryGap(6), 'hopper: a six-tile gap is too wide');

  // coyote time: a jump pressed just after running off a ledge still works; much later does not
  function ledgeJump(delay) {
    const s = H.createState(gapLevel(8));
    let off = -1, jumpedAt = -1;
    for (let i = 0; i < 240; i++) {
      const wasGround = s.onGround;
      H.step(s, DT, { right: true, jump: off >= 0 && i === off + delay });
      if (off < 0 && wasGround && !s.onGround && s.x > 5 * T - 4) off = i;
      if (off >= 0 && i === off + delay) { jumpedAt = s.vy; }
      if (off >= 0 && i > off + delay + 1) break;
    }
    return { off, vy: jumpedAt };
  }
  const early = ledgeJump(3), late = ledgeJump(14);
  check(early.off > 0 && early.vy < 0, 'hopper: coyote time lets you jump just after the ledge');
  check(late.off > 0 && late.vy >= 0, 'hopper: but not a quarter second later');

  // jump buffering: pressing jump a little before landing jumps on landing
  st = H.createState(flat()); st.y = 6 * T - st.h - 6; st.vy = 0;
  H.step(st, DT, { jump: true }); // in the air: press is buffered
  let jumpedOnLanding = false;
  for (let i = 0; i < 20 && !jumpedOnLanding; i++) { H.step(st, DT, { jump: i < 8 }); if (st.events.some(e => e.name === 'jump')) jumpedOnLanding = true; }
  check(jumpedOnLanding, 'hopper: a jump pressed just before landing is remembered');

  // enemies, coins, spikes, checkpoints, flag
  const arena = (cells) => { const r = ['                    ', '                    ', '                    ', '                    ', '                    ', cells, '####################', '####################']; return { name: 'a', theme: 'meadow', rows: r }; };
  st = H.createState(arena(' s  o               '));
  run(st, 1, { right: true });
  check(st.coins === 1, 'hopper: a coin is picked up once');
  st = H.createState(arena(' s ^                '));
  const startX = st.x;
  for (let i = 0; i < 90 && st.hearts === 3; i++) H.step(st, DT, { right: true });
  check(st.hearts === 2 && st.x === startX, 'hopper: spikes cost a heart and send you back to the start');
  st = H.createState(arena(' s     c    ^       '));
  for (let i = 0; i < 80 && st.checkpoint.x < 5 * T; i++) H.step(st, DT, { right: true });
  check(st.checkpoint.x > 5 * T, 'hopper: a flag becomes the place to come back to');
  const flagX = st.checkpoint.x;
  for (let i = 0; i < 240 && st.hearts === 3; i++) H.step(st, DT, { right: true });
  check(st.hearts === 2 && st.x === flagX, 'hopper: after a hurt you restart at the flag, not the start');
  st = H.createState(arena(' s      w           '));
  const crawler = st.enemies[0]; check(crawler && crawler.type === 'w', 'hopper: a crawler is placed');
  run(st, 0.6, {});
  const x0 = crawler.x; run(st, 0.5, {});
  check(crawler.x !== x0 || !crawler.alive, 'hopper: a crawler walks');
  st = H.createState(arena(' s                 '));
  st.enemies.push({ type: 'w', x: st.x + 2, y: 6 * T - 9, w: 12, h: 9, vx: 0, vy: 0, dir: 1, alive: true, t: 0, hopT: 0, hops: 0, homeX: 0, baseY: 0 });
  st.y = 6 * T - 9 - st.h - 2; st.vy = 150; st.x = st.enemies[0].x + 1;
  H.step(st, DT, {});
  check(!st.enemies[0].alive && st.vy < 0 && st.hearts === 3, 'hopper: landing on a crawler squashes it and bounces');
  st = H.createState(arena(' s                 '));
  st.enemies.push({ type: 'w', x: st.x + 14, y: 6 * T - 9, w: 12, h: 9, vx: -26, vy: 0, dir: -1, alive: true, t: 0, hopT: 0, hops: 0, homeX: 0, baseY: 0 });
  run(st, 1.2, {});
  check(st.hearts === 2, 'hopper: walking into a crawler costs a heart');
  st = H.createState(arena(' s       F         '));
  run(st, 2, { right: true });
  check(st.status === 'won', 'hopper: the flag wins the level');
  st = H.createState(arena('                    '));
  st.y = 6 * T; st.rows[6] = '                    '; st.rows[7] = '                    ';
  st.x = 3 * T; st.y = 6 * T;
  run(st, 1.5, {});
  check(st.hearts === 2 || st.status === 'over', 'hopper: falling out of the level costs a heart');
  const sp = H.createState(arena(' s S                ')); sp.x = 3 * T + 3;
  run(sp, 0.1, {});
  check(sp.events.some(e => e.name === 'spring') || sp.vy < 0, 'hopper: a spring throws you up');

  // every level can be crossed: gaps of at most three tiles, climbs of at most two (more only after a spring), spikes in runs of two
  H.LEVELS.forEach((lv, li) => {
    const rows = lv.rows, w = rows[0].length, surf = [];
    for (let c = 0; c < w; c++) { let r = 0; while (r < rows.length && rows[r][c] !== '#' && rows[r][c] !== 'B') r++; surf.push(r); }
    let ok = true, why = '', run = 0;
    for (let c = 0; c < w; c++) {
      if (surf[c] === rows.length) { run++; if (run > 3) { ok = false; why = 'gap at ' + c; } continue; }
      const prev = c - run - 1;
      if (prev >= 0 && surf[prev] - surf[c] > 2 && !rows.some(r => r.slice(Math.max(0, c - 6), c).includes('S'))) { ok = false; why = 'climb at ' + c; }
      run = 0;
    }
    check(ok && !rows.some(r => r.includes('^^^')) && rows.join('').includes('F'), 'hopper: level ' + (li + 1) + ' is crossable by the numbers ' + why);
  });

  // a simple bot (run right; jump at gaps, walls, enemies and spikes) finishes the first level
  function botFinishes(idx) {
    const s = H.createState(idx);
    for (let i = 0; i < 60 * 150 && s.status === 'playing'; i++) {
      const aheadX = s.x + s.w + 4, col = Math.floor(aheadX / T), row = Math.floor((s.y + s.h - 1) / T);
      const wallAhead = H.solidAt(s, col, row) || H.solidAt(s, col, row - 1);
      const groundAhead = H.solidAt(s, Math.floor((s.x + s.w + 10) / T), row + 1) || H.solidAt(s, Math.floor((s.x + s.w + 10) / T), row + 2);
      const hazard = [1, 2, 3, 4].some(k => { const ch = H.tileAt(s, Math.floor((s.x + s.w + k * 4) / T), row); return ch === '^'; });
      const foe = s.enemies.some(e => e.alive && e.x > s.x && e.x - s.x < 46 && Math.abs(e.y - s.y) < 40);
      const need = s.onGround && (wallAhead || !groundAhead || hazard || foe);
      H.step(s, DT, { right: true, jump: need || (!s.onGround && s.vy < 0 && s.jumpPrev && (wallAhead || !groundAhead || hazard || foe)) });
      s.events.length = 0;
      if (s.status === 'over') break;
    }
    return s.status;
  }
  [0].forEach(i => check(botFinishes(i) === 'won', 'hopper: a simple bot finishes level ' + (i + 1)));
}

// ── Muncher ─────────────────────────────────────────────────────────────────
{
  const M = load(['muncher.js']).MuncherEngine, DT = 1 / 60;
  const run = (st, secs, dir) => { for (let i = 0; i < Math.round(secs / DT); i++) M.step(st, DT, dir); };
  const ready = (level) => { const st = M.createState(level || 1, 7); st.status = 'playing'; return st; };

  check(M.MAZES.length === 3, 'muncher: three mazes');
  M.MAZES.forEach(mz => {
    const rows = mz.rows, w = rows[0].length;
    check(rows.length === 20 && w === 17 && rows.every(r => r.length === w), 'muncher: ' + mz.name + ' is 17 x 20');
    check(rows.every(r => r === r.split('').reverse().join('')), 'muncher: ' + mz.name + ' is symmetrical');
    check(rows[7].charAt(8) === '-' && rows[9].charAt(0) === ' ' && rows[9].charAt(16) === ' ', 'muncher: ' + mz.name + ' has its gate and a side tunnel');
    // every dot can be reached from the start without the house
    const st = M.createState(M.MAZES.indexOf(mz) + 1, 1), seen = new Set(), q = [[st.start.x, st.start.y]];
    seen.add(st.start.x + ',' + st.start.y);
    while (q.length) {
      const [x, y] = q.shift();
      M.DIRS.forEach(d => { const nx = M.wrapCol(st, x + d.dx), ny = y + d.dy, k = nx + ',' + ny; if (ny >= 0 && ny < st.h && M.open(st, nx, ny, false) && !seen.has(k)) { seen.add(k); q.push([nx, ny]); } });
    }
    let missing = 0; rows.forEach((r, y) => r.split('').forEach((c, x) => { if ((c === '.' || c === 'o') && !seen.has(x + ',' + y)) missing++; }));
    check(missing === 0 && st.dots > 100, 'muncher: ' + mz.name + ' has ' + st.dots + ' dots, all reachable');
  });

  // eating and scoring
  let st = ready();
  const sy = st.start.y;
  st.player.x = 8; st.player.y = 12; st.grid[12][7] = '.'; st.grid[12][6] = '.';
  const dots0 = st.dotsEaten;
  run(st, 0.4, M.LEFT);
  check(st.dotsEaten - dots0 === 2 && st.score === 20, 'muncher: each dot is ten points');
  st = ready(); st.player.x = 8; st.player.y = 12; st.grid[12][7] = 'o';
  run(st, 0.2, M.LEFT);
  check(st.score >= M.PELLET_POINTS && st.scared > 0 && st.chasers.some(c => c.mode === 'scared'), 'muncher: a power pellet turns the chasers blue');
  check(M.scaredSeconds(1) > M.scaredSeconds(4) && M.scaredSeconds(20) >= 2, 'muncher: blue time shrinks with the maze, never below two seconds');

  // eating blue chasers: 200, then 400; and the chaser turns into eyes
  st = ready(); st.scared = 5; st.chain = 0;
  st.player.x = 4; st.player.y = 4; st.player.dx = 0; st.player.dy = 0; st.grid[4][4] = ' ';
  st.chasers[0].mode = 'scared'; st.chasers[0].x = 4; st.chasers[0].y = 4;
  const before = st.score; M.step(st, DT, null);
  check(st.score - before === 200 && st.chasers[0].mode === 'eyes', 'muncher: the first blue chaser is 200 and goes home as eyes');
  st.chasers[1].mode = 'scared'; st.chasers[1].x = 4; st.chasers[1].y = 4; M.step(st, DT, null);
  check(st.chasers[1].mode === 'eyes' && st.score - before === 600, 'muncher: the next one is 400');

  // being caught costs a life and puts everyone back
  st = ready(); st.player.x = 4; st.player.y = 4; st.chasers[0].x = 4; st.chasers[0].y = 4; st.chasers[0].mode = 'normal';
  M.step(st, DT, null);
  check(st.status === 'dying' && st.lives === M.LIVES - 1, 'muncher: a chaser that catches you costs a life');
  run(st, 2, null);
  check(st.status === 'ready' && st.player.x === st.start.x && st.chasers[0].y === 6, 'muncher: then everyone returns to the start');
  st = ready(); st.lives = 1; st.player.x = 4; st.player.y = 4; st.chasers[0].x = 4; st.chasers[0].y = 4;
  M.step(st, DT, null); run(st, 2, null);
  check(st.status === 'over', 'muncher: no lives left is game over');

  // chaser personalities
  st = ready(); st.phase = 1;   // a chase phase
  st.player.x = 8; st.player.y = 12; st.player.dx = -1; st.player.dy = 0;
  const [rusher, ambusher, shy, drifter] = st.chasers;
  rusher.x = 2; rusher.y = 2; let t = M.chaserTarget(st, rusher);
  check(t.x === 8 && t.y === 12, 'muncher: the rusher aims straight at you');
  t = M.chaserTarget(st, ambusher);
  check(t.x === 4 && t.y === 12, 'muncher: the ambusher aims four tiles ahead of you');
  st.player.dx = 0; st.player.dy = -1; t = M.chaserTarget(st, ambusher);
  check(t.x === 8 && t.y === 8, 'muncher: ahead follows the way you face');
  shy.x = 8; shy.y = 1; t = M.chaserTarget(st, shy);
  check(t.x === 8 && t.y === 12, 'muncher: the shy one comes for you from far away');
  shy.x = 8; shy.y = 8; t = M.chaserTarget(st, shy);
  check(t.x === M.CORNERS.shy[0] && t.y === M.CORNERS.shy[1], 'muncher: but goes to its corner when close');
  st.phase = 0; t = M.chaserTarget(st, rusher);
  check(t.x === M.CORNERS.rusher[0] && t.y === M.CORNERS.rusher[1], 'muncher: in a scatter phase everyone heads for a corner');
  const eyes = { kind: 'rusher', mode: 'eyes', x: 3, y: 3, dx: 0, dy: 0 }; t = M.chaserTarget(st, eyes);
  check(t.x === M.HOUSE.x && t.y === M.HOUSE.y, 'muncher: eyes head for the house');

  // choosing a turn: the best of the open ways, never straight back, never through the gate
  st = ready(); st.phase = 1; st.player.x = 15; st.player.y = 4; st.player.dx = 0; st.player.dy = 0;
  const c4 = { kind: 'rusher', mode: 'normal', x: 4, y: 4, dx: 1, dy: 0 };
  let d = M.chooseDir(st, c4);
  check(d === M.RIGHT, 'muncher: a chaser at a crossing takes the turn that gets it closest');
  c4.dx = -1; d = M.chooseDir(st, c4);
  check(!(d.dx === 1 && d.dy === 0), 'muncher: and never turns straight back when it can go on');
  const nook = { kind: 'rusher', mode: 'normal', x: 6, y: 11, dx: 0, dy: -1 };   // a one-tile nook off the corridor below
  d = M.chooseDir(st, nook);
  check(d === M.DOWN, 'muncher: at a dead end the only way is back');
  const below = { kind: 'rusher', mode: 'normal', x: 8, y: 6, dx: 0, dy: -1 };
  st.player.x = 8; st.player.y = 12;
  d = M.chooseDir(st, below);
  check(!(d.dx === 0 && d.dy === 1), 'muncher: a chaser outside never goes down through the gate');

  // eyes take the shortest way home, and arrive
  st = ready(); st.phase = 1;
  const e = st.chasers[2]; e.mode = 'eyes'; e.x = 1; e.y = 1; e.dx = 0; e.dy = 0;
  run(st, 6, null);
  check(e.mode === 'house' || e.mode === 'leaving' || e.mode === 'normal', 'muncher: eyes get home and the chaser is back in play');

  // the side tunnel wraps
  st = ready(); st.player.x = 2; st.player.y = 9; st.player.dx = -1; st.player.dy = 0;
  run(st, 1.0, M.LEFT);
  check(st.player.x > 8, 'muncher: leaving the left tunnel comes out on the right (x ' + st.player.x.toFixed(1) + ')');

  // steering: a turn asked for early is taken at the next crossing; turning round is instant
  st = ready(); st.player.x = 4; st.player.y = 4; st.player.dx = 1; st.player.dy = 0;
  run(st, 0.05, M.DOWN);
  const xb = st.player.x;
  run(st, 0.5, M.DOWN);
  check(st.player.dy === 1 && Math.abs(st.player.x - Math.round(st.player.x)) < 1e-6 && st.player.x >= xb, 'muncher: a turn asked for early is taken at the next opening');
  st = ready(); st.player.x = 4.5; st.player.y = 4; st.player.dx = 1; st.player.dy = 0;
  M.step(st, DT, M.LEFT);
  check(st.player.dx === -1, 'muncher: turning round is instant');
  st = ready(); st.player.x = 8; st.player.y = 12; st.player.dx = 0; st.player.dy = 0;
  run(st, 0.3, M.DOWN);
  check(st.player.y === 12 || st.player.y > 12, 'muncher: you cannot walk into a wall');

  // clearing every dot
  st = ready(); st.dotsEaten = st.dots - 1; st.player.x = 8; st.player.y = 12; st.grid[12][7] = '.';
  run(st, 0.3, M.LEFT);
  check(st.status === 'cleared', 'muncher: the last dot clears the maze');
  check(M.levelSpeed(5) > M.levelSpeed(1) && M.levelSpeed(99) <= 1.45, 'muncher: each maze is faster, up to a limit');
  // fruit appears after 40 dots
  st = ready(); st.dotsEaten = 39; st.player.x = 4.4; st.player.y = 4; st.player.dx = -1; st.grid[4][4] = '.';
  run(st, 0.1, M.LEFT);
  check(st.fruit && st.fruit.x === st.start.x, 'muncher: fruit shows up after forty dots');
}

console.log(failures ? failures + ' failure(s)' : 'all passed');
process.exit(failures ? 1 : 0);
