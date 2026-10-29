// Fixes from CodeRabbit's review of the board games (1.15.0) that need no browser.
//
// Run: node tests/test_games_review_fixes.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'zimi', 'builtin', 'games');
let failures = 0;
const check = (ok, label) => {
  if (ok) console.log('ok: ' + label);
  else { console.error('FAIL: ' + label); failures++; }
};

// EngineKit: giving up on a silent worker answers every request waiting on it, not only the one that timed out.
async function engineKitDrop() {
  class SilentWorker { constructor() { this.terminated = false; } postMessage() {} terminate() { this.terminated = true; } }
  const sandbox = { Worker: SilentWorker, Blob: class {}, URL: { createObjectURL: () => 'blob:x' }, setTimeout, clearTimeout, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(dir, 'enginekit.js'), 'utf8'), sandbox, { filename: 'enginekit.js' });
  const factory = function () { return { handle: function () { return { answered: 'here' }; } }; };
  const c = sandbox.EngineKit.client(factory, 50);
  const got = [];
  c.ask({ n: 1 }, (r) => got.push(['budgeted', r]), 20);   // gives up on the worker after its budget plus the grace
  c.ask({ n: 2 }, (r) => got.push(['unbudgeted', r]));      // no budget: nothing else would ever answer it
  await new Promise((r) => setTimeout(r, 5500));
  check(got.some((g) => g[0] === 'budgeted'), 'enginekit: the request that timed out is answered');
  check(got.some((g) => g[0] === 'unbudgeted'), 'enginekit: a request waiting without a budget is answered when the worker is dropped');
}

// Quest: an open screen edge is the hero's way out; enemies that wander into it stay on the screen.
function questKeepsEnemiesOnScreen() {
  const sb = {}; vm.createContext(sb);
  ['util.js', 'quest.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sb, { filename: f }));
  const Q = sb.QuestEngine, DT = 1 / 60;
  let tried = 0, outside = 0;
  Object.keys(Q.SCREENS).forEach((id) => {
    for (let r = 0; r < Q.ROWS; r++) for (const side of [-1, 1]) {
      const st = Q.createState(null, 1);
      st.screen = id; st.x = Q.W / 2; st.y = Q.H / 2; st.inv = 1e9;
      st.enemies = [{ id: 0, type: 'slime', x: side < 0 ? 0 : Q.W - 10, y: r * Q.TILE + 3, w: 10, h: 10, hp: 1, vx: side * 30, vy: 0, t: 1e9, flash: 0, face: 'down' }];
      tried++;
      for (let i = 0; i < 90; i++) {
        Q.step(st, DT, { dx: 0, dy: 0 });
        const e = st.enemies[0];
        if (e && (e.x < 0 || e.x > Q.W - e.w)) { outside++; break; }
      }
    }
  });
  check(tried > 50 && outside === 0, 'quest: no slime leaves the screen by an open edge (' + tried + ' tried)');
}
questKeepsEnemiesOnScreen();

// Backgammon explanation: a point is "made" only if it still holds two checkers when the turn is over.
function backgammonMadePoints() {
  const sb = {}; vm.createContext(sb);
  ['util.js', 'text.js', 'backgammon.js', 'explain-backgammon.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sb, { filename: f }));
  const B = sb.BackgammonEngine, explain = sb.ZimiExplain.backgammon;
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let n = 0, bad = 0;
  for (let g = 0; g < 150; g++) {
    let s = B.newGame();
    for (let ply = 0; ply < 30; ply++) {
      s.dice = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
      if (s.dice[0] === s.dice[1]) s.dice = [s.dice[0], s.dice[0], s.dice[0], s.dice[0]];
      s.rolled = true;
      const opts = B.turnOptions(s);
      if (!opts.length) { s.turn = 1 - s.turn; continue; }
      const o = opts[Math.floor(rnd() * opts.length)], p = s.turn, made = new Set();
      let cur = s;
      o.steps.forEach((st) => { const land = st.to ? B.idxOf(p, st.to) : -1, own = land >= 0 ? B.countAt(cur, p, land) : 0; cur = B.applyStep(cur, st); if (own === 1 && st.to) made.add(st.to); });
      const expect = [...made].filter((pt) => B.countAt(cur, p, B.idxOf(p, pt)) >= 2).length;
      n++; if (explain(B, s, o.steps, s.dice).facts.madePoints !== expect) bad++;
      cur.turn = 1 - p; cur.dice = []; cur.rolled = false; s = cur;
    }
  }
  check(n > 1000 && bad === 0, 'backgammon explanation: a point later vacated is not reported as made (' + n + ' turns, ' + bad + ' wrong)');
}
backgammonMadePoints();

// The opening index built a slice at a time is the one built at once; the built-in Bluff meanings are long enough to hide among the fakes.
function openingsAndBluff() {
  const sb = { setTimeout }; vm.createContext(sb);
  ['util.js', 'chess-engine.js', 'chess-content.js', 'data/chess-openings.js', 'bluff-data.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sb, { filename: f }));
  const E = sb.ZimiChessEngine(), C = sb.ZimiChessContent, rows = sb.ZimiChessOpenings.rows;
  const whole = C.openingIndex(E, rows);
  C.openingIndexLater(E, rows, (later) => {
    check(later.lines.length === whole.lines.length && Object.keys(later.byKey).length === Object.keys(whole.byKey).length, 'openings: the sliced index equals the whole one (' + later.lines.length + ' lines)');
  });
  check(sb.BLUFF_WORDS.every((w) => w[1].length >= 25), 'bluff: every built-in meaning is at least the 25 characters real definitions are held to');
}
openingsAndBluff();

// Favorites: choosing "Remove" on a game kept under an alias page removes that item instead of adding a second one.
function favoritesRemoveAlias() {
  const items = [{ kind: 'article', zim: 'zimi_games', path: 'puzzles/mines.html', title: 'Mines' }];
  const Saved = {
    all: () => items.slice(),
    save: (ref) => items.push(ref),
    unsave: (ref) => { const i = items.findIndex((it) => it.zim === ref.zim && it.path === ref.path); if (i >= 0) items.splice(i, 1); },
    has: (ref) => items.some((it) => it.zim === ref.zim && it.path === ref.path)
  };
  const doc = { addEventListener() {}, getElementById: () => null, querySelector: () => null, createElement: () => ({ setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {}, style: {} }), head: { appendChild() {} } };
  const win = { document: doc, addEventListener() {}, ZimiRecent: { canon: (p) => (p === 'puzzles/mines.html' ? 'minesweeper.html' : p) } };
  win.parent = { Saved, document: { getElementById: () => ({}) } };
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(dir, 'favorites.js'), 'utf8'), win, { filename: 'favorites.js' });
  const F = win.ZimiFavorites;
  check(F.has('minesweeper.html') === true, 'favorites: a game kept under its alias page counts as kept');
  F.toggle('minesweeper.html', 'Minesweeper');
  check(items.length === 0 && F.has('minesweeper.html') === false, 'favorites: removing it removes the alias item, and adds nothing');
  F.toggle('minesweeper.html', 'Minesweeper');
  check(items.length === 1 && items[0].path === 'minesweeper.html', 'favorites: a game not kept is kept');
}
favoritesRemoveAlias();

engineKitDrop().then(() => process.exit(failures ? 1 : 0));
