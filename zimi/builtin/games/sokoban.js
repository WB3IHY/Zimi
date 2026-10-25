/* ZimiGames: Sokoban, the page. The rules are sokoban-engine.js; the levels are data/sokoban-levels.js (Boxoban,
   Apache-2.0, see data/README-sokoban.txt). The board is one svg redrawn from the state; the art is ours. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined' || !root.ZimiSokoban || !root.ZimiSokobanLevels) return;
  var S = root.ZimiSokoban, BK = root.BoardKit, D = root.ZimiSokobanLevels;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'sokoban', TILE = 40, SWIPE_PX = 24, WATCH_MS = 110;
  var KEYS = { ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r', w: 'u', s: 'd', a: 'l', d: 'r', W: 'u', S: 'd', A: 'l', D: 'r' };

  var state = BK.load(KEY, {});
  if (!state.best || typeof state.best !== 'object') state.best = {};
  var save = function () { BK.save(KEY, state); };

  var grades = D.grades, levels = D.levels;
  var cur = 0, st, ext, history, moves, pushes, facing = 'd', won = false, watching = 0, grade = grades[0].id;

  var board = $('sk-board');
  function levelRows(lv) { return lv.r.split('/'); }
  function label(i) {
    var lv = levels[i], n = 0;
    for (var k = 0; k <= i; k++) if (levels[k].g === lv.g) n++;
    return grades.filter(function (g) { return g.id === lv.g; })[0].name + ' ' + n;
  }
  function say(t) { $('sk-msg').textContent = t; }

  // ── drawing: one svg, our own tiles ──
  function tileSvg(r, c, k) {
    var x = c * TILE, y = r * TILE, out = '';
    if (st.wall[k]) {
      return '<rect x="' + x + '" y="' + y + '" width="40" height="40" rx="5" fill="var(--sk-wall-lo)"/>' +
        '<rect x="' + (x + 1.5) + '" y="' + (y + 1.5) + '" width="37" height="34" rx="4" fill="var(--sk-wall)"/>' +
        '<path d="M' + (x + 4) + ' ' + (y + 6) + 'H' + (x + 30) + '" stroke="var(--sk-wall-hi)" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M' + x + ' ' + (y + 19) + 'H' + (x + 40) + 'M' + (x + 20) + ' ' + (y + 19) + 'V' + (y + 36) + '" stroke="var(--sk-wall-lo)" stroke-width="1.6" opacity="0.7"/>';
    }
    if (!ext.floor[k]) return '';
    out += '<rect x="' + x + '" y="' + y + '" width="40" height="40" fill="var(--sk-floor' + ((r + c) % 2 ? '2' : '') + ')"/>';
    if (st.goal[k]) out += '<circle cx="' + (x + 20) + '" cy="' + (y + 20) + '" r="8" fill="none" stroke="var(--sk-goal)" stroke-width="3"/><circle cx="' + (x + 20) + '" cy="' + (y + 20) + '" r="2.5" fill="var(--sk-goal)"/>';
    return out;
  }
  function crateSvg(r, c, on) {
    var x = c * TILE, y = r * TILE, f = on ? 'var(--sk-crate-on)' : 'var(--sk-crate)', e = on ? 'var(--sk-crate-on-lo)' : 'var(--sk-crate-lo)';
    return '<rect x="' + (x + 4) + '" y="' + (y + 4) + '" width="32" height="32" rx="4" fill="' + f + '" stroke="' + e + '" stroke-width="2"/>' +
      (on ? '<path d="M' + (x + 12) + ' ' + (y + 21) + 'L' + (x + 18) + ' ' + (y + 27) + 'L' + (x + 29) + ' ' + (y + 13) + '" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
        : '<path d="M' + (x + 9) + ' ' + (y + 9) + 'L' + (x + 31) + ' ' + (y + 31) + 'M' + (x + 31) + ' ' + (y + 9) + 'L' + (x + 9) + ' ' + (y + 31) + '" stroke="' + e + '" stroke-width="2.6" opacity="0.7"/><path d="M' + (x + 7) + ' ' + (y + 7) + 'H' + (x + 28) + '" stroke="var(--sk-crate-hi)" stroke-width="2.4" stroke-linecap="round"/>');
  }
  function playerSvg(r, c) {
    var x = c * TILE + 20, y = r * TILE + 21, dx = facing === 'l' ? -1.6 : facing === 'r' ? 1.6 : 0, dy = facing === 'u' ? -1.6 : facing === 'd' ? 1.4 : 0;
    return '<ellipse cx="' + x + '" cy="' + (y + 13) + '" rx="11" ry="3" fill="#000" opacity="0.18"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="14" fill="var(--sk-me)" stroke="#1f3f66" stroke-width="2"/>' +
      '<path d="M' + (x - 9) + ' ' + (y - 6) + 'A11 11 0 0 1 ' + (x + 2) + ' ' + (y - 11) + '" fill="none" stroke="var(--sk-me-hi)" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="' + (x - 5 + dx) + '" cy="' + (y - 2 + dy) + '" r="3.8" fill="#fff"/><circle cx="' + (x + 5 + dx) + '" cy="' + (y - 2 + dy) + '" r="3.8" fill="#fff"/>' +
      '<circle cx="' + (x - 5 + dx * 1.6) + '" cy="' + (y - 2 + dy * 1.6) + '" r="1.7" fill="#14233a"/><circle cx="' + (x + 5 + dx * 1.6) + '" cy="' + (y - 2 + dy * 1.6) + '" r="1.7" fill="#14233a"/>';
  }
  function draw() {
    var cols = ext.c1 - ext.c0 + 1, rows = ext.r1 - ext.r0 + 1, parts = [];
    for (var r = ext.r0; r <= ext.r1; r++) for (var c = ext.c0; c <= ext.c1; c++) {
      var k = r * st.w + c;
      if (ext.show[k] || st.wall[k]) parts.push(tileSvg(r - ext.r0, c - ext.c0, k));
    }
    for (r = ext.r0; r <= ext.r1; r++) for (c = ext.c0; c <= ext.c1; c++) {
      k = r * st.w + c;
      if (st.box[k]) parts.push(crateSvg(r - ext.r0, c - ext.c0, st.goal[k]));
    }
    parts.push(playerSvg((st.player / st.w | 0) - ext.r0, st.player % st.w - ext.c0));
    board.innerHTML = '<svg viewBox="0 0 ' + cols * TILE + ' ' + rows * TILE + '" aria-hidden="true" preserveAspectRatio="xMidYMid meet">' + parts.join('') + '</svg>';
    var onGoal = 0, total = 0;
    for (var i = 0; i < st.box.length; i++) if (st.box[i]) { total++; if (st.goal[i]) onGoal++; }
    board.setAttribute('aria-label', label(cur) + ': ' + onGoal + ' of ' + total + ' crates on rings, ' + moves + ' moves');
    $('sk-moves').textContent = moves; $('sk-pushes').textContent = pushes;
    var best = state.best[levels[cur].id];
    $('sk-best').textContent = best ? best : '-';
    $('sk-undo').disabled = !history.length || !!watching;
  }

  // ── play ──
  function load(i) {
    stopWatching();
    cur = Math.max(0, Math.min(levels.length - 1, i)); won = false;
    st = S.parse(levelRows(levels[cur]).map(function (r) { return r.replace(/-/g, ' '); }));
    ext = S.extent(st); history = []; moves = 0; pushes = 0; facing = 'd';
    $('sk-name').textContent = label(cur).replace(/^[A-Za-z]+ /, '');
    $('sk-name-l').textContent = label(cur).replace(/ \d+$/, '');
    grade = levels[cur].g;
    state.level = levels[cur].id; save();
    say('Push every crate onto a ring'); draw();
  }
  function step(d) {
    if (won) return;
    var next = S.move(st, d);
    facing = d;
    if (!next) { draw(); return; }
    history.push({ st: st, moves: moves, pushes: pushes, facing: facing });
    st = next; moves++; if (next.pushed) pushes++;
    draw();
    if (S.solved(st)) win();
  }
  function undo() {
    if (!history.length || watching) return;
    var h = history.pop();
    st = h.st; moves = h.moves; pushes = h.pushes; won = false; say('');
    draw();
  }
  function win() {
    won = true;
    var id = levels[cur].id, prev = state.best[id], record = !prev || moves < prev;
    if (record) state.best[id] = moves;
    save(); draw();
    if (watching) { stopWatching(); say('That was a solution in ' + moves + ' moves'); return; }
    say('Level complete in ' + moves + ' moves');
    $('sk-win-text').textContent = moves + ' moves, ' + pushes + ' pushes.' + (record ? (prev ? ' A new best, up from ' + prev + '.' : ' Your first finish.') : ' Your best is ' + prev + '.');
    $('sk-win-next').hidden = cur >= levels.length - 1;
    winSheet.open($('sk-win-next').hidden ? $('sk-win-again') : $('sk-win-next'));
  }

  function stopWatching() { if (watching) { clearInterval(watching); watching = 0; } }
  function watch() {
    load(cur);
    var seq = levels[cur].m, i = 0;
    say('A solution of ' + seq.length + ' moves');
    watching = setInterval(function () {
      if (i >= seq.length) { stopWatching(); return; }
      step(seq[i++].toLowerCase());
    }, WATCH_MS);
    draw();
  }

  // ── input: keys, the pad, a swipe on the board ──
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet')) return;
    var d = KEYS[e.key];
    if (d) { if (watching) stopWatching(); e.preventDefault(); step(d); return; }
    var k = e.key.toLowerCase();
    if (k === 'z' || k === 'u' || e.key === 'Backspace') { e.preventDefault(); undo(); } else if (k === 'r') load(cur);
  });
  $('sk-pad').addEventListener('click', function (e) { var b = e.target.closest('button[data-d]'); if (b) { stopWatching(); step(b.dataset.d); } });
  var down = null;
  board.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY }; });
  board.addEventListener('pointerup', function (e) {
    if (!down) return;
    var dx = e.clientX - down.x, dy = e.clientY - down.y; down = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
    stopWatching();
    step(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u'));
  });
  board.addEventListener('pointercancel', function () { down = null; });

  // ── sheets ──
  var menu = BK.sheet($('sk-sheet')), winSheet = BK.sheet($('sk-win'));
  function paintMenu() {
    var tabs = $('sk-tabs'), grid = $('sk-grid');
    tabs.textContent = ''; grid.textContent = '';
    grades.forEach(function (g) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'sk-tab'; b.textContent = g.name; b.setAttribute('aria-pressed', String(g.id === grade));
      b.addEventListener('click', function () { grade = g.id; paintMenu(); });
      tabs.appendChild(b);
    });
    var n = 0;
    levels.forEach(function (lv, i) {
      if (lv.g !== grade) return;
      n++;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'sk-lv' + (state.best[lv.id] ? ' done' : '') + (i === cur ? ' now' : '');
      b.textContent = n;
      b.title = state.best[lv.id] ? 'Best ' + state.best[lv.id] + ' moves' : 'Not finished';
      b.setAttribute('aria-label', 'Level ' + n + (state.best[lv.id] ? ', best ' + state.best[lv.id] + ' moves' : ''));
      b.addEventListener('click', function () { menu.close(); load(i); });
      grid.appendChild(b);
    });
  }
  $('sk-levels').addEventListener('click', function () { paintMenu(); menu.open(); });
  $('sk-close').addEventListener('click', menu.close);
  $('sk-undo').addEventListener('click', undo);
  $('sk-restart').addEventListener('click', function () { load(cur); });
  $('sk-watch').addEventListener('click', watch);
  $('sk-win-next').addEventListener('click', function () { winSheet.close(); load(cur + 1); });
  $('sk-win-again').addEventListener('click', function () { winSheet.close(); load(cur); });
  $('sk-win-levels').addEventListener('click', function () { winSheet.close(); paintMenu(); menu.open(); });

  var start = 0;
  levels.forEach(function (lv, i) { if (lv.id === state.level) start = i; });
  load(start);

  if (new URLSearchParams(location.search).has('debug')) root.__sk = { load: load, step: step, state: function () { return st; }, levels: levels, won: function () { return won; }, undo: undo };
})(typeof globalThis !== 'undefined' ? globalThis : this);
