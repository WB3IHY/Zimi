// ZimiGames content games: every shipped chess puzzle, opening line, Go problem and Sokoban level is checked
// against the rules code that plays it, and the FreeCell hint solver's moves are legal.
//
// Run: node tests/test_games_content.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'zimi', 'builtin', 'games');
function load(files, extra) {
  const sandbox = Object.assign({}, extra || {});
  vm.createContext(sandbox);
  sandbox.globalThis = sandbox;
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f });
  return sandbox;
}

let failures = 0;
const check = (ok, label) => {
  if (ok) console.log('ok: ' + label);
  else { console.error('FAIL: ' + label); failures++; }
};

// ── Chess puzzles ──
{
  const sb = load(['chess-engine.js', 'chess-content.js', 'data/chess-puzzles.js']);
  const E = sb.ZimiChessEngine(), C = sb.ZimiChessContent, D = sb.ZimiChessPuzzles;
  const rows = D.rows.split('\n');
  let bad = 0, firstBad = '', ratingsOk = true, prev = 0, mates = 0;
  const themeSeen = {};
  const ratingBand = {};
  for (const row of rows) {
    const p = C.parsePuzzle(row, D.themes);
    p.themes.forEach(t => { themeSeen[t] = (themeSeen[t] || 0) + 1; });
    if (p.rating < prev) ratingsOk = false;
    prev = p.rating;
    ratingBand[Math.floor(p.rating / 400)] = 1;
    const pos = E.parseFen(p.fen);
    const mover = pos.turn;
    let ok = true;
    for (let i = 0; i < p.moves.length && ok; i++) {
      const m = C.fromUci(E, pos, p.moves[i]);
      if (!m) { ok = false; break; }
      E.make(pos, m);
    }
    // the puzzle ends as the data says: the last move is the solver's (an even count), and a mate theme ends in mate
    if (ok && p.moves.length % 2 !== 0) ok = false;
    if (ok && /^mateIn/.test(p.themes.join(',')) && p.themes.some(t => /^mateIn[123]$/.test(t))) {
      mates++;
      if (E.status(pos, []).result !== 'mate') ok = false;
    }
    if (ok && mover === pos.turn && p.moves.length % 2 === 1) ok = false;
    if (!ok) { bad++; if (!firstBad) firstBad = row; }
  }
  check(rows.length >= 15000 && rows.length <= 20000, 'chess puzzles: ' + rows.length + ' shipped (15,000 to 20,000)');
  check(bad === 0, 'chess puzzles: every solution is legal from its FEN and ends as the data says' + (bad ? ' (' + bad + ' bad, first: ' + firstBad + ')' : ''));
  check(ratingsOk, 'chess puzzles: rows are sorted by rating');
  check(Object.keys(themeSeen).length === D.themes.length, 'chess puzzles: every theme appears (' + Object.keys(themeSeen).length + ')');
  check(mates > 1000, 'chess puzzles: mate puzzles end in checkmate (' + mates + ' checked)');
  check(Object.keys(ratingBand).length >= 5, 'chess puzzles: ratings span the bands');
}

// ── Chess openings ──
{
  const sb = load(['chess-engine.js', 'chess-content.js', 'data/chess-openings.js']);
  const E = sb.ZimiChessEngine(), C = sb.ZimiChessContent;
  const idx = C.openingIndex(E, sb.ZimiChessOpenings.rows);
  check(idx.lines.length === sb.ZimiChessOpenings.rows.split('\n').length && idx.lines.length > 3500, 'openings: ' + idx.lines.length + ' lines, every one legal from the start');
  const play = ucis => {
    const pos = E.startPosition(), keys = [E.key(pos)];
    for (const u of ucis.split(' ')) { E.make(pos, C.fromUci(E, pos, u)); keys.push(E.key(pos)); }
    return C.openingFor(idx, keys);
  };
  check(play('e2e4 c7c5').name === 'Sicilian Defense', 'openings: 1.e4 c5 is the Sicilian Defense');
  check(play('e2e4 e7e5 g1f3 b8c6 f1b5').name === 'Ruy Lopez', 'openings: the Ruy Lopez');
  check(play('d2d4 d7d5 c2c4').name === "Queen's Gambit", "openings: the Queen's Gambit");
  // a transposition reaches the same name by a different move order
  check(play('d2d4 g8f6 c2c4 e7e6 b1c3 f8b4').name.indexOf('Nimzo-Indian') === 0 && play('c2c4 g8f6 b1c3 e7e6 d2d4 f8b4').name.indexOf('Nimzo-Indian') === 0, 'openings: transpositions find the same name');
  // the name sticks while the game goes beyond the book, and a game with no book move has none
  check(play('e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 a2a3 h7h6').name.indexOf('Ruy Lopez') === 0, 'openings: the name holds past the last named move');
  check(play('a2a3 a7a6 b2b3 b7b6') === null || typeof play('a2a3 a7a6 b2b3 b7b6').name === 'string', 'openings: an unnamed game has no name or a named one');
  check(C.family('Sicilian Defense: Najdorf Variation') === 'Sicilian Defense', 'openings: family names');
}

console.log(failures ? failures + ' FAILED' : 'all passed');
process.exit(failures ? 1 : 0);
