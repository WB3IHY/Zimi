/* ZimiGames: Fleet. Our own code, GPL-3.0. No network, no fonts, no modules.
   The rules (pure functions, no DOM, so node can test them) and the page (only when there is a document). */
(function (root) {
  'use strict';

  // ── the rules ────────────────────────────────────────────────────────────
  var SIZE = 10;
  var FLEET = [['Carrier', 5], ['Cruiser', 4], ['Frigate', 3], ['Sloop', 3], ['Skiff', 2]];
  var UNKNOWN = 0, MISS = 1, HIT = 2, SUNK = 3;
  var HIT_WEIGHT = 40; // a ship that could cover a standing hit is worth this many empty-water ones

  function mulberry(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function emptyGrid() { var g = []; for (var y = 0; y < SIZE; y++) { g.push([]); for (var x = 0; x < SIZE; x++) g[y].push(UNKNOWN); } return g; }
  function createBoard() { return { ships: [], shots: emptyGrid() }; }

  function cellsFor(len, x, y, horiz) {
    var c = [];
    for (var i = 0; i < len; i++) c.push(horiz ? [x + i, y] : [x, y + i]);
    return c;
  }
  function inBounds(x, y) { return x >= 0 && y >= 0 && x < SIZE && y < SIZE; }
  function shipAt(board, x, y) {
    for (var i = 0; i < board.ships.length; i++) {
      var s = board.ships[i];
      for (var k = 0; k < s.cells.length; k++) if (s.cells[k][0] === x && s.cells[k][1] === y) return s;
    }
    return null;
  }
  function canPlace(board, cells) {
    return cells.every(function (c) { return inBounds(c[0], c[1]) && !shipAt(board, c[0], c[1]); });
  }
  function addShip(board, name, len, x, y, horiz) {
    var cells = cellsFor(len, x, y, horiz);
    if (!canPlace(board, cells)) return null;
    var s = { name: name, len: len, cells: cells, hits: 0 };
    board.ships.push(s);
    return s;
  }
  function randomFleet(rng) {
    var b = createBoard();
    FLEET.forEach(function (f) {
      for (var tries = 0; tries < 1000; tries++) {
        var horiz = rng() < 0.5, x = Math.floor(rng() * (horiz ? SIZE - f[1] + 1 : SIZE)), y = Math.floor(rng() * (horiz ? SIZE : SIZE - f[1] + 1));
        if (addShip(b, f[0], f[1], x, y, horiz)) return;
      }
    });
    return b;
  }

  // Fire at a square. null when it was already fired on, else {result, ship, win}.
  function fire(board, x, y) {
    if (!inBounds(x, y) || board.shots[y][x] !== UNKNOWN) return null;
    var s = shipAt(board, x, y);
    if (!s) { board.shots[y][x] = MISS; return { result: 'miss', ship: null, win: false }; }
    board.shots[y][x] = HIT; s.hits++;
    if (s.hits < s.len) return { result: 'hit', ship: s, win: false };
    s.cells.forEach(function (c) { board.shots[c[1]][c[0]] = SUNK; });
    return { result: 'sunk', ship: s, win: board.ships.every(function (q) { return q.hits === q.len; }) };
  }
  function remainingLens(board) { return board.ships.filter(function (s) { return s.hits < s.len; }).map(function (s) { return s.len; }); }

  // The computer's shot, from what it can see: the shots grid and the lengths still afloat. Every way a ship
  // could still lie is counted; squares that fit more of them are better, and ways that cover a standing
  // hit count far more, so it finishes a ship it has found before it hunts anew.
  function aiShot(shots, lens, rng) {
    var w = emptyGrid(), x, y, i, k;
    for (i = 0; i < lens.length; i++) {
      var len = lens[i];
      for (var dir = 0; dir < 2; dir++) {
        for (y = 0; y < SIZE; y++) for (x = 0; x < SIZE; x++) {
          var cells = cellsFor(len, x, y, dir === 0), ok = true, hits = 0;
          for (k = 0; k < len; k++) {
            var c = cells[k];
            if (!inBounds(c[0], c[1])) { ok = false; break; }
            var v = shots[c[1]][c[0]];
            if (v === MISS || v === SUNK) { ok = false; break; }
            if (v === HIT) hits++;
          }
          if (!ok) continue;
          var add = hits ? HIT_WEIGHT * hits : 1;
          for (k = 0; k < len; k++) if (shots[cells[k][1]][cells[k][0]] === UNKNOWN) w[cells[k][1]][cells[k][0]] += add;
        }
      }
    }
    var best = -1, picks = [];
    for (y = 0; y < SIZE; y++) for (x = 0; x < SIZE; x++) {
      if (shots[y][x] !== UNKNOWN) continue;
      if (w[y][x] > best) { best = w[y][x]; picks = [[x, y]]; } else if (w[y][x] === best) picks.push([x, y]);
    }
    return picks.length ? picks[Math.floor(rng() * picks.length)] : null;
  }

  function label(x, y) { return String.fromCharCode(65 + x) + (y + 1); }

  var Engine = { SIZE: SIZE, FLEET: FLEET, UNKNOWN: UNKNOWN, MISS: MISS, HIT: HIT, SUNK: SUNK, createBoard: createBoard, cellsFor: cellsFor, canPlace: canPlace, addShip: addShip, shipAt: shipAt, randomFleet: randomFleet, fire: fire, remainingLens: remainingLens, aiShot: aiShot, label: label, mulberry: mulberry };
  root.FleetEngine = Engine;

  if (typeof document === 'undefined') return;

  // ── the page ─────────────────────────────────────────────────────────────
  var Play = root.ArcadePlay, $ = Play.$;
  var STATS_KEY = 'zimi.games.fleet.stats', CPU_DELAY_MS = 700;
  Play.applyTheme();

  var els = { msg: $('fl-msg'), tools: $('fl-tools'), enemy: $('fl-enemy'), enemyWrap: $('fl-enemy-wrap'), mine: $('fl-mine'), eships: $('fl-enemy-ships'), sheet: $('fl-sheet'), title: $('fl-sheet-title'), text: $('fl-sheet-text'), go: $('fl-go'), nu: $('fl-new') };
  var stats = Play.load(STATS_KEY, { played: 0, won: 0, bestShots: 0 });
  var boards = [], lastShot = [null, null], seats, actor = 0, placeIdx = 0, shotsBy = [0, 0];
  var phase = 'place', mine, theirs, sel = 0, horiz = true, timer = null, rng, shotsFired = 0, lastMine = null, lastTheirs = null, cpuGrid;

  // Seats: Player 1 and Player 2 are each the Computer or a Person. Two people place and fire in turn,
  // each behind a handoff, so neither sees the other's fleet.
  function setActor(i) {
    actor = i; mine = boards[i]; theirs = boards[1 - i]; lastMine = lastShot[i]; lastTheirs = lastShot[1 - i];
    $('fl-mine-h').textContent = seats.hotseat() ? seats.name(i) + "'s fleet" : 'Your fleet';
    shotsFired = shotsBy[i];
  }
  function setMine(b) { boards[actor] = mine = b; }
  function otherPerson() { return seats.hotseat(); }

  function buildGrid(el, handler) {
    el.textContent = '';
    var cells = [];
    for (var y = 0; y < SIZE; y++) for (var x = 0; x < SIZE; x++) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'fl-c'; b.dataset.x = x; b.dataset.y = y;
      b.setAttribute('role', 'gridcell');
      (function (cx, cy) { b.addEventListener('click', function () { handler(cx, cy); }); })(x, y);
      el.appendChild(b); cells.push(b);
    }
    el.addEventListener('keydown', function (e) {
      var t = e.target; if (!t || !t.dataset || t.dataset.x === undefined) return;
      var dx = { ArrowLeft: -1, ArrowRight: 1 }[e.key] || 0, dy = { ArrowUp: -1, ArrowDown: 1 }[e.key] || 0;
      if (!dx && !dy) return;
      e.preventDefault();
      var nx = Math.max(0, Math.min(SIZE - 1, +t.dataset.x + dx)), ny = Math.max(0, Math.min(SIZE - 1, +t.dataset.y + dy));
      cells[ny * SIZE + nx].focus();
    });
    return cells;
  }
  var mineCells, enemyCells;

  function stateOf(board, x, y, reveal) {
    var v = board.shots[y][x], s = shipAt(board, x, y);
    var cls = '', name = label(x, y);
    if (v === SUNK) { cls = 'fl-hit fl-sunk'; name += ', ship sunk'; }
    else if (v === HIT) { cls = 'fl-hit'; name += ', hit'; }
    else if (v === MISS) { cls = 'fl-miss'; name += ', miss'; }
    else if (reveal && s) { cls = 'fl-ship'; name += ', your ship'; }
    return { cls: cls, name: name, s: s };
  }
  function paintMine() {
    mineCells.forEach(function (b) {
      var x = +b.dataset.x, y = +b.dataset.y, st = stateOf(mine, x, y, true);
      b.className = 'fl-c ' + st.cls + (st.s ? ' fl-ship' : '') + (lastTheirs && lastTheirs[0] === x && lastTheirs[1] === y ? ' fl-last' : '');
      b.setAttribute('aria-label', st.name);
      b.disabled = phase !== 'place';
    });
  }
  function paintEnemy() {
    enemyCells.forEach(function (b) {
      var x = +b.dataset.x, y = +b.dataset.y, st = stateOf(theirs, x, y, phase === 'over');
      b.className = 'fl-c ' + st.cls + (lastMine && lastMine[0] === x && lastMine[1] === y ? ' fl-last' : '');
      b.setAttribute('aria-label', st.name);
      b.disabled = phase !== 'battle' || theirs.shots[y][x] !== UNKNOWN;
    });
    els.enemy.classList.toggle('fl-aim', phase === 'battle');
    els.eships.textContent = '';
    theirs.ships.forEach(function (s, i) {
      var e = document.createElement(s.hits === s.len ? 's' : 'span'); e.textContent = s.name + ' ' + s.len; els.eships.appendChild(e);
      if (i < theirs.ships.length - 1) els.eships.appendChild(document.createTextNode(' · '));
    });
  }
  function paintTools() {
    els.tools.textContent = '';
    if (phase === 'pass') {
      var nx = 1 - actor;
      var pb = document.createElement('button'); pb.type = 'button'; pb.className = 'ar-btn'; pb.setAttribute('aria-pressed', 'true');
      pb.textContent = 'Done, pass to ' + seats.name(nx); pb.addEventListener('click', function () { handTo(nx, 'battle'); });
      els.tools.appendChild(pb); return;
    }
    if (phase !== 'place') return;
    FLEET.forEach(function (f, i) {
      var placed = mine.ships.some(function (s) { return s.name === f[0]; });
      var b = document.createElement('button'); b.type = 'button'; b.className = 'ar-btn' + (placed ? ' fl-done' : '');
      b.textContent = f[0] + ' ' + f[1]; b.setAttribute('aria-pressed', String(sel === i && !placed));
      b.setAttribute('aria-label', f[0] + ', ' + f[1] + ' squares' + (placed ? ', placed' : ''));
      b.addEventListener('click', function () { if (!placed) { sel = i; paintTools(); } });
      els.tools.appendChild(b);
    });
    function tool(text, fn, dis) { var b = document.createElement('button'); b.type = 'button'; b.className = 'ar-btn'; b.textContent = text; b.disabled = !!dis; b.addEventListener('click', fn); els.tools.appendChild(b); return b; }
    tool(horiz ? 'Rotate (now across)' : 'Rotate (now down)', function () { horiz = !horiz; paintTools(); });
    tool('Shuffle', function () { setMine(randomFleet(rng)); sel = FLEET.length; paintAll(); });
    var all = mine.ships.length === FLEET.length;
    var more = seats.hotseat() && placeIdx < seats.people().length - 1;
    var go = tool(more ? 'Done, pass to ' + seats.name(seats.people()[placeIdx + 1]) : 'Start battle', startBattle, !all); go.setAttribute('aria-pressed', String(all));
  }
  function paintAll() { paintMine(); paintEnemy(); paintTools(); els.enemyWrap.hidden = phase === 'place'; els.mine.classList.toggle('fl-small', phase !== 'place'); }

  function nextUnplaced() {
    for (var i = 0; i < FLEET.length; i++) if (!mine.ships.some(function (s) { return s.name === FLEET[i][0]; })) return i;
    return FLEET.length;
  }
  function onMine(x, y) {
    if (phase !== 'place') return;
    var existing = shipAt(mine, x, y);
    if (existing) { mine.ships.splice(mine.ships.indexOf(existing), 1); sel = FLEET.findIndex(function (f) { return f[0] === existing.name; }); paintAll(); return; }
    if (sel >= FLEET.length) return;
    var f = FLEET[sel], px = horiz ? Math.min(x, SIZE - f[1]) : x, py = horiz ? y : Math.min(y, SIZE - f[1]);
    if (!addShip(mine, f[0], f[1], px, py, horiz)) { els.msg.textContent = 'That ship does not fit there.'; return; }
    sel = nextUnplaced(); els.msg.textContent = sel >= FLEET.length ? 'All placed. Start the battle, or tap a ship to move it.' : 'Place the ' + FLEET[sel][0] + ' (' + FLEET[sel][1] + ' squares).';
    paintAll();
  }

  // Pass the device: the cover first, then the next person's screen.
  function handTo(i, nextPhase) {
    phase = nextPhase;
    seats.cover(i, function () { setActor(i); turnMessage(); paintAll(); }, 'Hand the device over. Your fleet and your shots stay hidden until you tap.');
    setActor(i); paintAll();
  }
  function turnMessage() {
    if (phase === 'place') els.msg.textContent = 'Place the Carrier (5 squares). Tap a square on your grid.' + (seats.hotseat() ? ' ' + seats.name(actor) + ' places first.' : '');
    else els.msg.textContent = (seats.hotseat() ? seats.name(actor) + ', fire' : 'Your turn. Fire') + ' on the enemy waters.' + (seats.hotseat() && lastTheirs ? ' Last shot at you: ' + label(lastTheirs[0], lastTheirs[1]) + '.' : '');
  }
  function startBattle() {
    if (seats.hotseat() && placeIdx < seats.people().length - 1) { placeIdx++; sel = 0; horiz = true; handTo(seats.people()[placeIdx], 'place'); return; }
    phase = 'battle'; shotsBy = [0, 0]; lastShot = [null, null];
    if (seats.hotseat()) { handTo(seats.people()[0], 'battle'); return; }
    setActor(seats.people()[0]); turnMessage();
    paintAll();
    enemyCells[0].focus({ preventScroll: true });
  }
  function onEnemy(x, y) {
    if (phase !== 'battle') return;
    var r = fire(theirs, x, y); if (!r) return;
    shotsBy[actor]++; shotsFired = shotsBy[actor]; lastMine = lastShot[actor] = [x, y];
    phase = 'busy';
    els.msg.textContent = label(x, y) + ': ' + (r.result === 'miss' ? 'Miss.' : r.result === 'hit' ? 'Hit!' : 'You sank the ' + r.ship.name + '!');
    if (r.win) { phase = 'over'; paintAll(); return finish(true); }
    if (otherPerson()) { phase = 'pass'; paintAll(); return; }
    paintAll();
    timer = Play.later(cpuTurn, CPU_DELAY_MS);
  }
  function cpuTurn() {
    var pick = aiShot(mine.shots, remainingLens(mine), rng);
    var r = fire(mine, pick[0], pick[1]);
    lastTheirs = lastShot[1 - actor] = pick;
    var t = els.msg.textContent;
    els.msg.textContent = t + ' Computer fires at ' + label(pick[0], pick[1]) + ': ' + (r.result === 'miss' ? 'miss.' : r.result === 'hit' ? 'hit!' : 'it sank your ' + r.ship.name + '.');
    if (r.win) { phase = 'over'; paintAll(); return finish(false); }
    phase = 'battle'; paintAll();
  }
  function finish(won) {
    var text;
    if (seats.hotseat()) {
      text = seats.name(actor) + ' sank the whole fleet in ' + shotsFired + ' shots.';
      els.msg.textContent = seats.name(actor) + ' wins.';
      showSheet(seats.name(actor) + ' wins', text, 'Play again');
      return;
    }
    stats.played++;
    if (won) { stats.won++; text = 'You sank the whole enemy fleet in ' + shotsFired + ' shots.'; if (!stats.bestShots || shotsFired < stats.bestShots) { stats.bestShots = shotsFired; text += ' A new fewest.'; } }
    else text = 'Your fleet is gone. The computer found every ship.';
    text += ' You have won ' + stats.won + ' of ' + stats.played + '.';
    Play.save(STATS_KEY, stats);
    els.msg.textContent = won ? 'Victory.' : 'Defeat.';
    showSheet(won ? 'Victory' : 'Defeat', text, 'Play again');
  }

  function showSheet(title, text, label2) {
    var host = $('fl-seats'); host.textContent = ''; host.appendChild(root.ZimiSeats.create({ id: 'fleet', seats: 2 }).block(null, { labels: ['Player 1', 'Player 2'] }));
    els.title.textContent = title; els.text.textContent = text; els.go.textContent = label2; Play.openSheet(els.sheet, '#fl-go'); }
  function begin() {
    if (timer) timer.cancel();
    rng = Engine.mulberry(Play.randomSeed());
    seats = root.ZimiSeats.create({ id: 'fleet', seats: 2, onChange: function () { paintAll(); } });
    boards = [createBoard(), createBoard()];
    seats.kinds().forEach(function (k, i) { if (k === 'cpu') boards[i] = randomFleet(rng); });
    phase = 'place'; sel = 0; horiz = true; placeIdx = 0; shotsBy = [0, 0]; lastShot = [null, null];
    setActor(seats.people()[0]); turnMessage();
    Play.closeSheet(els.sheet); paintAll();
    seats.begin(function () { paintAll(); });
  }
  els.go.addEventListener('click', begin);
  els.nu.addEventListener('click', function () { if (timer) timer.cancel(); if (phase === 'busy') phase = 'battle'; showSheet('New game', 'Start over with new waters?', 'Start'); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || !els.sheet.hidden) return;
    if ((e.key === 'r' || e.key === 'R') && phase === 'place') { horiz = !horiz; paintTools(); }
  });

  rng = Engine.mulberry(Play.randomSeed());
  seats = root.ZimiSeats.create({ id: 'fleet', seats: 2 });
  boards = [createBoard(), createBoard()]; actor = 0; mine = boards[0]; theirs = boards[1];
  mineCells = buildGrid(els.mine, onMine); enemyCells = buildGrid(els.enemy, onEnemy);
  paintAll();
  showSheet('Fleet', "Hide your ships, hunt the computer's. Five ships each on a ten by ten sea.", 'Place my ships');
  root.__fleet = { get mine() { return mine; }, get theirs() { return theirs; }, get phase() { return phase; } };
})(this);
