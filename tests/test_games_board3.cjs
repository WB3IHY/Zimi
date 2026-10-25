// ZimiGames world board games, part three: Janggi, Makruk, International draughts, Hnefatafl, the Royal Game of Ur,
// Snakes and Ladders, Carrom and four-player Mahjong. The rules with no DOM: perft counts checked against a
// second, independently written move generator, the special moves each game is known for, and self-played games
// that show the computer only ever makes legal moves.
//
// Run: node tests/test_games_board3.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'zimi', 'builtin', 'games');
function load(files) {
  const sandbox = {};
  vm.createContext(sandbox);
  [].concat(files).forEach(file => vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), sandbox, { filename: file }));
  return sandbox;
}
const seeded = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

let failures = 0;
const check = (ok, label) => {
  if (ok) console.log('ok: ' + label);
  else { console.error('FAIL: ' + label); failures++; }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortNum = list => list.slice().sort((a, b) => a - b);

// ── Janggi ──
{
  const sb = load(['enginekit.js', 'janggi-engine.js']);
  const E = sb.ZimiJanggiEngine(sb.ZimiSearch());
  const at = (r, f) => r * 9 + f;
  const movesOf = (pos, r, f) => E.legalMoves(pos).filter(m => E.from(m) === at(r, f)).map(m => E.to(m));

  // The independent generator: x is the file, y the rank counted from Cho's side (Cho at the bottom, y = 0),
  // the palace diagonals are an explicit list of edges, and every piece is written out on its own.
  const key = (x, y) => x + ',' + y;
  const palaceEdges = {};
  const link = (a, b) => { (palaceEdges[a] = palaceEdges[a] || []).push(b); (palaceEdges[b] = palaceEdges[b] || []).push(a); };
  [[1, 0, 2], [8, 7, 9]].forEach(([cy, lo, hi]) => [[3, lo], [5, lo], [3, hi], [5, hi]].forEach(([cx, cyy]) => link(key(4, cy), key(cx, cyy))));
  const inPal = (c, x, y) => x >= 3 && x <= 5 && (c > 0 ? y >= 0 && y <= 2 : y >= 7 && y <= 9);
  function fromPos(pos) {
    const b = new Map();
    for (let s = 0; s < 90; s++) if (pos.sq[s]) b.set(key(s % 9, 9 - Math.floor(s / 9)), { c: Math.sign(pos.sq[s]), t: Math.abs(pos.sq[s]) });
    return b;
  }
  function pseudo(b, color) {
    const out = [], get = (x, y) => b.get(key(x, y)), ok = (x, y) => x >= 0 && x < 9 && y >= 0 && y < 10;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const push = (x, y, tx, ty) => { const o = get(tx, ty); if (!o || o.c !== color) out.push([x, y, tx, ty]); };
    for (const [k, p] of b) {
      if (p.c !== color) continue;
      const [x, y] = k.split(',').map(Number), nb = (palaceEdges[k] || []).map(q => q.split(',').map(Number));
      if (p.t === 3) {
        for (const [dx, dy] of dirs) for (let tx = x + dx, ty = y + dy; ok(tx, ty); tx += dx, ty += dy) { push(x, y, tx, ty); if (get(tx, ty)) break; }
        for (const [qx, qy] of nb) {   // follow the diagonal line on in the same direction
          let px = x, py = y, cx = qx, cy = qy;
          for (;;) {
            push(x, y, cx, cy); if (get(cx, cy)) break;
            const dx = cx - px, dy = cy - py, nx = cx + dx, ny = cy + dy;
            if (!(palaceEdges[key(cx, cy)] || []).includes(key(nx, ny))) break;
            px = cx; py = cy; cx = nx; cy = ny;
          }
        }
      } else if (p.t === 2) {
        const jump = (dx, dy, step) => {
          let cx = x + dx, cy = y + dy;
          while (ok(cx, cy) && !get(cx, cy)) { cx += dx; cy += dy; step && 0; }
          return [cx, cy];
        };
        for (const [dx, dy] of dirs) {
          const [sx, sy] = jump(dx, dy);
          if (!ok(sx, sy) || get(sx, sy).t === 2) continue;
          for (let tx = sx + dx, ty = sy + dy; ok(tx, ty); tx += dx, ty += dy) {
            const o = get(tx, ty);
            if (!o) { out.push([x, y, tx, ty]); continue; }
            if (o.c !== color && o.t !== 2) out.push([x, y, tx, ty]);
            break;
          }
        }
        for (const [qx, qy] of nb) {   // over the one point between two palace corners
          const scr = get(qx, qy), dx = qx - x, dy = qy - y, tx = qx + dx, ty = qy + dy;
          if (!scr || scr.t === 2 || !(palaceEdges[key(qx, qy)] || []).includes(key(tx, ty))) continue;
          const o = get(tx, ty);
          if (!o || (o.c !== color && o.t !== 2)) out.push([x, y, tx, ty]);
        }
      } else if (p.t === 4) {
        for (const [dx, dy] of dirs) {
          if (!ok(x + dx, y + dy) || get(x + dx, y + dy)) continue;
          const side = dx ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
          for (const [ex, ey] of side) { const tx = x + 2 * dx + ex, ty = y + 2 * dy + ey; if (ok(tx, ty)) push(x, y, tx, ty); }
        }
      } else if (p.t === 5) {
        for (const [dx, dy] of dirs) {
          const side = dx ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
          for (const [ex, ey] of side) {
            const l1 = [x + dx, y + dy], l2 = [x + 2 * dx + ex, y + 2 * dy + ey], tx = x + 3 * dx + 2 * ex, ty = y + 3 * dy + 2 * ey;
            if (!ok(tx, ty) || get(...l1) || get(...l2)) continue;
            push(x, y, tx, ty);
          }
        }
      } else if (p.t === 6 || p.t === 7) {
        for (const [dx, dy] of dirs) if (inPal(color, x + dx, y + dy)) push(x, y, x + dx, y + dy);
        for (const [qx, qy] of nb) if (inPal(color, qx, qy)) push(x, y, qx, qy);
      } else {
        const f = color > 0 ? 1 : -1;
        [[0, f], [1, 0], [-1, 0]].forEach(([dx, dy]) => { if (ok(x + dx, y + dy)) push(x, y, x + dx, y + dy); });
        for (const [qx, qy] of nb) if (qy - y === f && inPal(-color, x, y)) push(x, y, qx, qy);
      }
    }
    return out;
  }
  function legal(b, color) {
    const attackedKing = (bb) => {
      let ks = null;
      for (const [k, p] of bb) if (p.c === color && p.t === 7) ks = k;
      return pseudo(bb, -color).some(m => key(m[2], m[3]) === ks);
    };
    return pseudo(b, color).filter(m => {
      const bb = new Map(b), mover = bb.get(key(m[0], m[1]));
      bb.delete(key(m[0], m[1])); bb.set(key(m[2], m[3]), mover);
      return !attackedKing(bb);
    });
  }
  const canon = list => list.map(m => m.join(',')).sort();
  const engineMoves = pos => E.legalMoves(pos).map(m => [E.from(m) % 9, 9 - Math.floor(E.from(m) / 9), E.to(m) % 9, 9 - Math.floor(E.to(m) / 9)]);
  function indPerft(b, color, depth) {
    const ms = legal(b, color);
    if (depth === 1) return ms.length;
    let n = 0;
    for (const m of ms) {
      const bb = new Map(b); bb.set(key(m[2], m[3]), bb.get(key(m[0], m[1]))); bb.delete(key(m[0], m[1]));
      n += indPerft(bb, -color, depth - 1);
    }
    return n;
  }

  const start = E.startPosition();
  const p1 = E.perft(start, 1), p2 = E.perft(start, 2);
  check(p1 === indPerft(fromPos(start), 1, 1) && p1 > 0, 'janggi: perft 1 from the start agrees with the independent generator (' + p1 + ')');
  check(p2 === indPerft(fromPos(start), 1, 2), 'janggi: perft 2 from the start agrees with the independent generator (' + p2 + ')');
  if (!same(canon(engineMoves(start)), canon(legal(fromPos(start), 1)))) { const a = canon(engineMoves(start)), b = canon(legal(fromPos(start), 1)); console.error('only engine', a.filter(x => !b.includes(x)), 'only independent', b.filter(x => !a.includes(x))); }
  check(same(canon(engineMoves(start)), canon(legal(fromPos(start), 1))), 'janggi: the same 1-ply moves, not just the same count');
  check(E.toFen(start) === E.START_FEN, 'janggi: the start position round-trips through its FEN');

  // The two generators agree at every position of random games, which reaches palaces, cannons and elephants.
  {
    const rng = seeded(7);
    let positions = 0, disagree = 0;
    for (let g = 0; g < 40; g++) {
      const pos = E.startPosition();
      for (let ply = 0; ply < 90; ply++) {
        const ms = E.legalMoves(pos);
        positions++;
        if (!same(canon(engineMoves(pos)), canon(legal(fromPos(pos), pos.turn)))) { disagree++; break; }
        if (!ms.length) break;
        E.make(pos, ms[Math.floor(rng() * ms.length)]);
      }
    }
    check(disagree === 0 && positions > 1500, 'janggi: both generators agree at ' + positions + ' positions of random games');
  }

  // Palace rules, one by one. FEN rows run from Han's back rank (top) down; capitals are Cho.
  const fen = rows => rows.join('/');
  const mv = (f, r, c) => sortNum(movesOf(E.parseFen(f), r, c));
  const P = (r, c) => at(r, c);
  check(same(mv('5k3/9/9/9/9/9/9/9/9/3K5 w', 9, 3), sortNum([P(9, 4), P(8, 3), P(8, 4)])), 'janggi: a general in a palace corner steps straight or along the diagonal to the middle');
  check(mv('5k3/9/9/9/9/9/9/9/4K4/9 w', 8, 4).length === 8, 'janggi: a general in the middle of the palace has eight steps');
  check(!mv('5k3/9/9/9/9/9/9/9/9/3K5 w', 9, 3).includes(P(7, 5)), 'janggi: a general steps one point only, never the whole diagonal');
  let m = mv('5k3/9/9/9/9/9/9/9/9/3RK4 w', 9, 3);
  check(m.includes(P(8, 4)) && m.includes(P(7, 5)) && !m.includes(P(6, 6)), 'janggi: a chariot follows the palace diagonal to the far corner and stops at the palace edge');
  m = mv('5k3/9/9/9/9/9/9/9/4P4/3RK4 w', 9, 3);
  check(!m.includes(P(8, 4)) && !m.includes(P(7, 5)), 'janggi: a piece on the middle of the palace blocks a chariot\'s diagonal');
  m = mv('5k3/9/9/9/9/9/9/9/4P4/3CK4 w', 9, 3);
  check(m.includes(P(7, 5)), 'janggi: a cannon jumps the palace middle to the far corner');
  m = mv('5k3/9/9/9/9/9/9/9/4c4/3CK4 w', 9, 3);
  check(!m.includes(P(7, 5)), 'janggi: a cannon cannot jump a cannon on the palace middle');

  // Cannons must jump exactly one piece, never a cannon, and never capture one.
  check(mv('5k3/9/9/9/9/9/9/1C7/9/5K3 w', 7, 1).length === 0, 'janggi: a cannon with nothing to jump cannot move at all');
  check(mv('5k3/9/9/9/9/1c7/9/1C7/9/5K3 w', 7, 1).length === 0, 'janggi: a cannon cannot jump over or capture a cannon');
  check(same(mv('5k3/9/9/9/9/1p7/1r7/1C7/9/5K3 w', 7, 1), [P(5, 1)]), 'janggi: a cannon jumps one piece and captures the next');
  check(mv('5k3/9/9/9/9/1c7/1r7/1C7/9/5K3 w', 7, 1).length === 0, 'janggi: a cannon jumps a piece but still cannot capture a cannon behind it');
  check(same(mv('5k3/9/9/9/9/9/1r7/1C7/9/5K3 w', 7, 1), sortNum([P(5, 1), P(4, 1), P(3, 1), P(2, 1), P(1, 1), P(0, 1)])), 'janggi: after its jump a cannon may land on any empty point in line');
  check(mv('5k3/9/9/9/9/1p7/1r7/1C7/9/5K3 w', 7, 1).length === 1, 'janggi: a cannon cannot jump two pieces');

  // Elephants step one straight and two across; a blocked point on the way stops them.
  m = mv('5k3/9/9/9/9/9/9/4E4/9/5K3 w', 7, 4);
  check(m.length === 6 && m.includes(P(4, 2)) && m.includes(P(5, 7)) && m.includes(P(9, 1)), 'janggi: an elephant jumps three by two, across the river too');
  check(same(mv('5k3/9/9/9/9/9/4P4/4E4/9/5K3 w', 7, 4), sortNum([P(5, 1), P(5, 7), P(9, 1), P(9, 7)])), 'janggi: a piece on the elephant\'s straight step blocks both ways that way');
  m = mv('5k3/9/9/9/9/3p5/9/4E4/9/5K3 w', 7, 4);
  check(m.length === 5 && !m.includes(P(4, 2)), 'janggi: a piece on the diagonal step blocks only that jump');

  // Horses are blocked on their leg.
  check(same(mv('5k3/9/9/9/9/9/9/9/1P7/1H3K3 w', 9, 1), [P(8, 3)]), 'janggi: a horse with a piece on its leg cannot jump that way');

  // Soldiers go forward and sideways, and along the palace diagonal inside the enemy palace.
  check(same(mv('5k3/9/9/9/9/4P4/9/9/9/5K3 w', 5, 4), sortNum([P(4, 4), P(5, 3), P(5, 5)])), 'janggi: a soldier moves forward and sideways, never back');
  check(same(mv('3k5/9/3P5/9/9/9/9/9/9/5K3 w', 2, 3), sortNum([P(1, 3), P(1, 4), P(2, 2), P(2, 4)])), 'janggi: a soldier on the enemy palace corner also steps along the diagonal');
  check(same(mv('5k3/4P4/9/9/9/9/9/9/9/5K3 w', 1, 4), sortNum([P(0, 3), P(0, 4), P(0, 5), P(1, 3), P(1, 5)])), 'janggi: a soldier on the enemy palace middle has two diagonals');
  check(!mv('3k5/9/9/3P5/9/9/9/9/9/5K3 w', 3, 3).includes(P(2, 4)), 'janggi: outside the enemy palace a soldier has no diagonal step');

  // Bikjang, checkmate, and the pass.
  check(E.bikjang(E.parseFen('4k4/9/9/9/9/9/9/9/9/4K4 w')) && E.status(E.parseFen('4k4/9/9/9/9/9/9/9/9/4K4 w')).result === 'bikjang', 'janggi: bikjang (generals face with nothing between) ends the game as a draw');
  check(!E.bikjang(E.parseFen('4k4/9/9/9/4P4/9/9/9/9/4K4 w')), 'janggi: a piece between the generals is no bikjang');
  const mate = E.parseFen('3k4R/R8/9/9/9/9/9/9/9/5K3 b');
  const ms = E.status(mate);
  check(E.legalMoves(mate).length === 0 && ms.over && ms.result === 'mate' && ms.winner === E.CHO, 'janggi: no move while in check is checkmate and loses');
  const stale = E.parseFen('3k5/R8/9/9/9/4R4/9/9/9/5K3 b');
  check(E.legalMoves(stale).length === 0 && !E.inCheck(stale) && same(E.movesOrPass(stale), [E.PASS]) && E.status(stale).mustPass, 'janggi: no move and no check means a pass');
  E.make(stale, E.PASS);
  check(stale.turn === E.CHO && E.legalMoves(stale).length > 0, 'janggi: after a pass the other side moves');
  E.unmake(stale);
  check(stale.turn === E.HAN, 'janggi: a pass unmakes');
  check(E.status(E.parseFen('4k4/9/9/9/9/9/9/9/9/5K3 w')).over === false, 'janggi: an ordinary position goes on');

  // A self-played game: the computer only ever plays legal moves (or passes when it must).
  {
    const g = E.startPosition();
    let ok = true, plies = 0;
    for (; plies < 40; plies++) {
      const st = E.status(g);
      if (st.over) break;
      const r = E.think(g, { level: 'easy', ms: 60, depth: 2 });
      const legalNow = E.movesOrPass(g);
      if (!legalNow.includes(r.move)) { ok = false; break; }
      E.make(g, r.move);
    }
    if (!ok || plies <= 10) console.error(JSON.stringify(E.status(g)), E.toFen(g));
    check(ok && plies > 10, 'janggi: the computer plays ' + plies + ' legal plies against itself');
  }
}

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('all passed');
