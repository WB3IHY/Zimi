// The one seeded generator: it gives exactly the numbers every game's own copy used to, so no deal changes,
// and no game carries a copy of its own any more.
//
// Run: node tests/test_games_rng.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'zimi', 'builtin', 'games');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(dir, 'util.js'), 'utf8'), sandbox, { filename: 'util.js' });
const R = sandbox.ZimiUtil;

let failures = 0;
const check = (ok, label) => {
  if (ok) console.log('ok: ' + label);
  else { console.error('FAIL: ' + label); failures++; }
};

// The implementation every game carried (23 byte-identical copies), kept here as the reference.
function reference(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const SEEDS = [];
for (let i = 0; i < 100; i++) SEEDS.push(i < 10 ? i : (i * 2654435761 + 12345) >>> 0);
SEEDS.push(4294967295, 2147483648, -1, 1.5e9);

let same = true, countedSame = true;
SEEDS.forEach(s => {
  const a = reference(s), b = R.mulberry32(s), c = R.counted(s);
  for (let k = 0; k < 200; k++) { const x = a(); if (b() !== x) same = false; if (c() !== x) countedSame = false; }
});
check(same, 'mulberry32 matches the reference over 100+ seeds x 200 draws');
check(countedSame, 'counted() is the same sequence');

const c = R.counted(77);
for (let k = 0; k < 30; k++) c();
const again = R.counted(c.seed, c.draws), next = [c(), c(), c()], resumed = [again(), again(), again()];
check(c.draws === 33 && again.draws === 33 && JSON.stringify(next) === JSON.stringify(resumed), 'counted(seed, draws) resumes exactly where it was');

const game = { turn: 2, dice: [1, 2, 3], rng: R.counted(5, 9) };
const snap = R.snapshot(game), back = R.restore(snap);
check(JSON.stringify(snap) === JSON.stringify({ turn: 2, dice: [1, 2, 3], rng: { seed: 5, draws: 9 } }), 'snapshot is plain JSON');
check(back.rng() === game.rng() && back.turn === 2, 'restore puts the generator back');
let threw = false; try { R.restore({ turn: 1 }); } catch (e) { threw = true; }
check(threw, 'a snapshot with no generator is refused');

// No game carries a copy of its own.
const copies = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'util.js' && fs.readFileSync(path.join(dir, f), 'utf8').includes('0x6D2B79F5'));
check(copies.length === 0, 'no other file implements the generator: ' + copies.join(', '));

process.exit(failures ? 1 : 0);
