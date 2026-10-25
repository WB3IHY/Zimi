// ZimiGames: the recent list and the game of the day (builtin/games/recent.js), no DOM.
//
// Run: node tests/test_games_recent.cjs   (exit 0 = pass)
// Prints, with --days YYYY-MM-DD ..., one "day path" line per day from the real
// games.json: tests/test_games_links.py compares them with gamelinks.game_of_day.

const path = require('path');
const R = require(path.join(__dirname, '..', 'zimi', 'builtin', 'games', 'recent.js'));

const days = process.argv.indexOf('--days');
if (days > 0) {
  const rows = require(path.join(__dirname, '..', 'zimi', 'builtin', 'games', 'games.json'));
  process.argv.slice(days + 1).forEach(d => console.log(d + ' ' + R.dayPick(rows, d).path));
  process.exit(0);
}

let failures = 0;
const check = (ok, label) => {
  if (!ok) { failures++; console.log('FAIL ' + label); }
};
const paths = list => list.map(e => e.path).join(',');

// record: newest first, a repeat moves up rather than doubling, the list is capped.
let list = [];
['a', 'b', 'c'].forEach((p, i) => { list = R.record(list, { path: p + '.html', title: p }, 100 + i, 6); });
check(paths(list) === 'c.html,b.html,a.html', 'newest first');
list = R.record(list, { path: 'a.html', title: 'A' }, 200, 6);
check(paths(list) === 'a.html,c.html,b.html', 'a repeat moves to the front, once');
check(list[0].title === 'A' && list[0].at === 200, 'the repeat carries its new title and time');
for (let i = 0; i < 10; i++) list = R.record(list, { path: 'g' + i + '.html', title: 'g' + i }, 300 + i, 6);
check(list.length === 6 && list[0].path === 'g9.html' && list[5].path === 'g4.html', 'capped at six, oldest dropped');
check(R.record(null, { path: 'x.html', title: 'x' }, 1).length === 1, 'no list yet');
check(paths(R.record([null, { title: 'no path' }, { path: 'k.html' }], { path: 'z.html', title: 'z' }, 1)) === 'z.html,k.html', 'junk entries are dropped');

// read: storage that is missing, broken or the wrong shape is an empty list.
const store = v => ({ getItem: () => v });
check(R.read(store(null)).length === 0, 'nothing stored');
check(R.read(store('{oops')).length === 0, 'broken JSON');
check(R.read(store('{"a":1}')).length === 0, 'not a list');
check(R.read({ getItem() { throw new Error('blocked'); } }).length === 0, 'blocked storage');
check(R.read(store(JSON.stringify(list))).length === 6, 'a stored list comes back');

// fnv1a: the published test vectors, so Python's copy can be held to the same numbers.
check(R.fnv1a('') === 0x811c9dc5, 'fnv1a of nothing');
check(R.fnv1a('a') === 0xe40c292c, 'fnv1a of a');
check(R.fnv1a('foobar') === 0xbf9cf968, 'fnv1a of foobar');

// dayPick: one game per page, by the day, the same every time.
const rows = [
  { path: 'one.html', title: 'One' },
  { path: 'one.html', title: 'One again' },
  { path: 'two.html', title: 'Two' },
  { path: 'three.html', title: 'Three' }
];
check(R.uniqueByPath(rows).length === 3, 'a page with two Q-IDs is one game');
check(R.dayPick(rows, '2026-10-24').path === R.dayPick(rows, '2026-10-24').path, 'deterministic');
check(R.dayPick(rows, '2026-10-24').path === 'two.html', 'a fixed day gives a fixed game (2026-10-24 -> two.html)');
check(R.dayPick(rows, '2026-10-25').path === 'one.html', 'the next day, another game (2026-10-25 -> one.html)');
check(R.dayPick([], '2026-10-24') === null, 'no games, no pick');
const seen = new Set();
for (let d = 1; d <= 31; d++) seen.add(R.dayPick(rows, '2026-12-' + String(d).padStart(2, '0')).path);
check(seen.size === 3, 'over a month every game comes up');

check(R.localDay(new Date(2026, 0, 5)) === '2026-01-05', 'localDay pads month and day');

if (failures) { console.log(failures + ' failed'); process.exit(1); }
console.log('games recent: ok');
