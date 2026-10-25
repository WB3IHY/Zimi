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

// ── Makruk ──
{
  const sb = load(['enginekit.js', 'makruk-engine.js']);
  const E = sb.ZimiMakrukEngine(sb.ZimiSearch());
  const at = (r, f) => r * 8 + f;
  const mv = (fen, r, f) => { const p = E.parseFen(fen); return sortNum(E.legalMoves(p).filter(m => E.from(m) === at(r, f)).map(E.to)); };

  const start = E.startPosition();
  check(E.perft(start, 1) === 23, 'makruk: 23 moves from the start (8 Bia, 2 Ma, 3 + 3 Khon, 3 Khun, 2 Met, 2 Rua)');
  check(E.perft(start, 2) === 23 * 23, 'makruk: the two sides do not touch at ply two (529)');
  check(E.toFen(start) === E.START_FEN, 'makruk: the start position round-trips through its FEN');
  check(E.START_FEN.split(' ')[0] === 'rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR', 'makruk: the Khun and the Met stand so the two Khun do not face each other');

  check(same(mv('k7/8/8/8/3S4/8/8/7K w', 4, 3), sortNum([at(3, 2), at(3, 4), at(5, 2), at(5, 4), at(3, 3)])), 'makruk: a Khon steps on the four diagonals and straight ahead, never back');
  check(same(mv('k7/8/8/8/3M4/8/8/7K w', 4, 3), sortNum([at(3, 2), at(3, 4), at(5, 2), at(5, 4)])), 'makruk: a Met takes one step on a diagonal');
  check(mv('k7/8/8/8/3N4/8/8/7K w', 4, 3).length === 8, 'makruk: a Ma jumps like a knight');
  check(same(mv('k7/8/8/8/8/4P3/8/7K w', 5, 4), [at(4, 4)]), 'makruk: a Bia steps one square forward only');
  check(same(mv('k7/8/8/8/3p4/4P3/8/7K w', 5, 4), sortNum([at(4, 3), at(4, 4)])), 'makruk: a Bia takes one step on a forward diagonal');
  check(mv('k7/8/8/8/8/8/8/R6K w', 7, 0).length === 13, 'makruk: a Rua slides along ranks and files (7 up, 6 along to the Khun)');

  let pos = E.parseFen('k7/8/8/4P3/8/8/8/7K w');
  let m = E.findMove(pos, at(3, 4), at(2, 4));
  check(E.isPromo(m), 'makruk: a white Bia reaching the sixth rank becomes a Met');
  E.make(pos, m);
  check(pos.sq[at(2, 4)] === E.MET, 'makruk: ... and the board holds a Met');
  E.unmake(pos);
  check(pos.sq[at(3, 4)] === E.BIA && pos.sq[at(2, 4)] === 0, 'makruk: ... and unmaking brings the Bia back');
  pos = E.parseFen('k7/8/8/8/4P3/8/8/7K w');
  check(!E.isPromo(E.findMove(pos, at(4, 4), at(3, 4))), 'makruk: a Bia on its way, short of the sixth rank, does not promote');
  pos = E.parseFen('k7/8/8/8/4p3/8/8/7K b');
  check(E.isPromo(E.findMove(pos, at(4, 4), at(5, 4))), 'makruk: a black Bia promotes on the third rank');

  const sq = (r, f) => at(r, f);
  check(E.attacked(E.parseFen('k7/8/8/8/4S3/8/8/7K w'), sq(3, 4), E.WHITE) && !E.attacked(E.parseFen('k7/8/8/8/4S3/8/8/7K w'), sq(5, 4), E.WHITE), 'makruk: a Khon guards the square ahead of it but not the one behind');
  const bp = E.parseFen('k7/8/8/8/4P3/8/8/7K w');
  check(E.attacked(bp, sq(3, 3), E.WHITE) && E.attacked(bp, sq(3, 5), E.WHITE) && !E.attacked(bp, sq(3, 4), E.WHITE), 'makruk: a Bia guards its two forward diagonals, not the square ahead');

  const mate = E.parseFen('k6R/7R/8/8/8/8/8/K7 b');
  check(E.status(mate).result === 'mate' && E.status(mate).winner === E.WHITE, 'makruk: two Rua on the Khun\'s corner is checkmate');
  const stale = E.parseFen('k7/1R6/2K5/8/8/8/8/8 b');
  check(E.status(stale).result === 'stalemate', 'makruk: a Khun with no move and no check is a stalemate (a draw)');
  pos = E.parseFen('k7/8/8/8/8/8/8/7K w'); pos.quiet = E.MOVE_LIMIT_PLIES;
  check(E.status(pos).result === 'limit', 'makruk: sixty-four moves each without a capture or a Bia move end the game (the counting rules, simplified)');

  // The attack test agrees with the move generator: a dummy enemy piece put on a square is capturable by `by`
  // exactly when the square is attacked. Checked over every square of positions from random games.
  {
    const rng = seeded(11);
    let bad = 0, n = 0;
    for (let g = 0; g < 12; g++) {
      const p = E.startPosition();
      for (let ply = 0; ply < 70; ply++) {
        const ms = E.legalMoves(p);
        if (!ms.length) break;
        if (ply % 5 === 0) {
          for (let s = 0; s < 64; s++) for (const by of [E.WHITE, E.BLACK]) {
            if (p.sq[s] * by > 0) continue;
            const x = E.clone(p); x.sq[s] = -by * E.RUA;
            const viaMoves = E.pseudo(x, by).some(mm => E.to(mm) === s);
            n++;
            if (viaMoves !== E.attacked(x, s, by)) bad++;
          }
        }
        E.make(p, ms[Math.floor(rng() * ms.length)]);
      }
    }
    check(bad === 0 && n > 5000, 'makruk: attacked() agrees with the move generator on ' + n + ' squares of random games');
  }
  {
    const g = E.startPosition();
    let ok = true, plies = 0;
    for (; plies < 60; plies++) {
      if (E.status(g).over) break;
      const r = E.think(g, { level: 'easy', ms: 60, depth: 2 });
      if (!E.legalMoves(g).includes(r.move)) { ok = false; break; }
      E.make(g, r.move);
    }
    check(ok && plies > 20, 'makruk: the computer plays ' + plies + ' legal plies against itself');
  }
}

// ── International draughts ──
{
  const sb = load(['enginekit.js', 'draughts-engine.js']);
  const E = sb.ZimiDraughtsEngine(sb.ZimiSearch());
  const sqr = (r, f) => r * 10 + f;
  // A position from lists of [row, file]: men, kings, and the side to move.
  const setup = (w, b, wk, bk, turn) => {
    const a = new Array(100).fill('.');
    (w || []).forEach(p => { a[sqr(...p)] = 'w'; }); (b || []).forEach(p => { a[sqr(...p)] = 'b'; });
    (wk || []).forEach(p => { a[sqr(...p)] = 'W'; }); (bk || []).forEach(p => { a[sqr(...p)] = 'B'; });
    (w || []).concat(b || [], wk || [], bk || []).forEach(p => { if ((p[0] + p[1]) % 2 !== 1) throw new Error('light square ' + p); });
    return E.fromString(a.join(''), turn);
  };

  const start = E.newPosition();
  check([1, 2, 3, 4].map(d => E.perft(start, d)).join() === '9,81,658,4265', 'draughts: perft 1 to 4 from the start are 9, 81, 658, 4265 (the known counts)');
  let ok = true;
  for (let n = 1; n <= 50; n++) if (E.numberOf(E.squareOfNumber(n)) !== n || !E.isDark(E.squareOfNumber(n))) ok = false;
  check(ok && E.squareOfNumber(1) === sqr(0, 1) && E.squareOfNumber(5) === sqr(0, 9) && E.squareOfNumber(46) === sqr(9, 0) && E.squareOfNumber(50) === sqr(9, 8), 'draughts: the squares are numbered 1 to 50 from the top left, with a dark square at the bottom left');
  check(start.sq.filter(v => v > 0).length === 20 && start.sq.filter(v => v < 0).length === 20, 'draughts: twenty men each');

  // Majority: a capture of two must be taken in preference to a capture of one.
  let pos = setup([[8, 3], [4, 1]], [[7, 4], [3, 2], [1, 4]]);
  let ms = E.moves(pos);
  check(ms.length > 0 && ms.every(m => m.caps.length === 2 && m.from === sqr(4, 1)), 'draughts: the majority rule: the capture of two pieces is compulsory over a capture of one');
  pos = setup([[8, 3]], [[7, 4]]);
  ms = E.moves(pos);
  check(ms.length === 1 && ms[0].caps.length === 1, 'draughts: a capture is compulsory (the quiet moves are not offered)');

  // Men capture backwards.
  pos = setup([[5, 4]], [[6, 3]]);
  ms = E.moves(pos);
  check(ms.length === 1 && ms[0].to === sqr(7, 2), 'draughts: a man captures backwards');
  // ... but men only step forward.
  pos = setup([[5, 4]], [[0, 1]]);
  check(E.moves(pos).every(m => E.rowOf(m.to) === 4), 'draughts: men step forward only');

  // Flying kings.
  pos = setup([], [[5, 4]], [[9, 0]], []);
  ms = E.moves(pos);
  check(ms.length === 5 && ms.every(m => m.caps.length === 1 && m.caps[0] === sqr(5, 4)) && same(sortNum(ms.map(m => m.to)), sortNum([sqr(4, 5), sqr(3, 6), sqr(2, 7), sqr(1, 8), sqr(0, 9)])), 'draughts: a king captures from a distance and may land on any empty square beyond');
  pos = setup([], [[5, 4], [3, 4]], [[9, 0]], []);
  ms = E.moves(pos);
  check(ms.length === 3 && ms.every(m => m.caps.length === 2 && m.path[0] === sqr(4, 5)), 'draughts: a king must pick the landing that continues the capture (the majority)');
  pos = setup([], [], [[9, 0]], []);
  check(E.moves(pos).length === 9 && E.moves(pos).every(m => m.caps.length === 0), 'draughts: a king moves any distance along a free diagonal (9 squares from the corner)');
  pos = setup([], [[6, 3], [5, 4]], [[9, 0]], []);
  check(E.moves(pos).every(m => m.caps.length === 0) && E.moves(pos).length === 2, 'draughts: a king cannot jump two pieces standing together');

  // A loop of four captures comes back to the start square, and captured pieces stay on until the end.
  pos = setup([[6, 3]], [[5, 4], [3, 4], [3, 2], [5, 2]]);
  ms = E.moves(pos);
  check(ms.length > 0 && ms.every(m => m.caps.length === 4) && ms.some(m => m.to === m.from), 'draughts: a man may finish on the square it started from (a loop of four)');

  // Crowning.
  pos = setup([[1, 2]], [[8, 1]]);
  ms = E.moves(pos);
  check(ms.length === 2 && ms.every(m => m.crown), 'draughts: a man reaching the far row is crowned');
  pos = setup([[2, 1]], [[1, 2], [1, 4]]);
  ms = E.moves(pos);
  check(ms.length === 1 && ms[0].caps.length === 2 && ms[0].crown === false && ms[0].to === sqr(2, 5), 'draughts: a man that only passes the far row in a capture is not crowned');
  pos = setup([[2, 1]], [[1, 2]]);
  ms = E.moves(pos);
  check(ms.length === 1 && ms[0].crown === true, 'draughts: a man that ends a capture on the far row is crowned');
  E.make(pos, ms[0]);
  check(pos.sq[sqr(0, 3)] === 2 && pos.sq[sqr(1, 2)] === 0, 'draughts: the crowned piece is a king and the captured man is gone');
  E.unmake(pos);
  check(pos.sq[sqr(2, 1)] === 1 && pos.sq[sqr(1, 2)] === -1 && pos.sq[sqr(0, 3)] === 0 && pos.turn === 1, 'draughts: unmaking restores everything');

  // The end.
  pos = setup([[5, 4]], [], [], [], -1);
  check(E.status(pos).over && E.status(pos).winner === 1, 'draughts: a side with no pieces to move has lost');
  pos = setup([], [], [[9, 0]], [[0, 9]]); pos.quiet = E.QUIET_DRAW_PLIES;
  check(E.status(pos).result === 'quiet', 'draughts: twenty-five moves each of king moves alone is a draw');

  // The computer only ever plays legal moves, and takes compulsory captures.
  {
    const g = E.newPosition();
    let legal = true, plies = 0;
    for (; plies < 70; plies++) {
      if (E.status(g).over) break;
      const list = E.moves(g), r = E.handle({ sq: Array.from(g.sq), turn: g.turn, quiet: g.quiet, level: 'easy', ms: 50, depth: 2 });
      if (r.index < 0 || r.index >= list.length) { legal = false; break; }
      E.make(g, list[r.index]);
    }
    check(legal && plies >= 40, 'draughts: the computer plays ' + plies + ' legal plies against itself');
  }
}

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('all passed');
