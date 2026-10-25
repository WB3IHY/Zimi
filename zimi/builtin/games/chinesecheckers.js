/* ZimiGames: Chinese Checkers. Our own code, GPL-3.0. The first half is the rules and the computer
   player (no DOM, tested under node); the second half is the page. No network, no modules.
   The board is the 121-hole star, in cube coordinates (x, y, z with x + y + z = 0). */
(function (root) {
  'use strict';

  // ── the board ──
  var TIP = 4;                                    // the hexagon in the middle has radius 4; each tip holds 10 holes
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];   // axial (q, r) neighbours
  var HOME_SIZE = 10;
  // The six camps, clockwise from the top: top, upper right, lower right, bottom, lower left, upper left.
  var CAMP_TEST = [
    function (x, y, z) { return y <= -TIP - 1; }, function (x, y, z) { return x >= TIP + 1; }, function (x, y, z) { return z <= -TIP - 1; },
    function (x, y, z) { return y >= TIP + 1; }, function (x, y, z) { return x <= -TIP - 1; }, function (x, y, z) { return z >= TIP + 1; }
  ];
  var SEATINGS = { 2: [0, 3], 3: [0, 2, 4], 4: [1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
  var COLOR_NAMES = ['Red', 'Yellow', 'Green', 'Blue', 'Black', 'White'];   // by camp, clockwise from the top
  var MAX_ROUNDS = 300;

  function inStar(q, r) {
    var s = -q - r;
    return (q >= -TIP && r >= -TIP && s >= -TIP) || (q <= TIP && r <= TIP && s <= TIP);
  }
  var CELLS = [], INDEX = {};
  for (var qq = -2 * TIP; qq <= 2 * TIP; qq++) for (var rr = -2 * TIP; rr <= 2 * TIP; rr++) {
    if (!inStar(qq, rr)) continue;
    INDEX[qq + ',' + rr] = CELLS.length;
    var cell = { q: qq, r: rr, x: qq + rr / 2, y: rr * Math.sqrt(3) / 2, camp: -1, n: [], j: [] };
    for (var c = 0; c < 6; c++) if (CAMP_TEST[c](qq, rr, -qq - rr)) cell.camp = c;
    CELLS.push(cell);
  }
  function indexOf(q, r) { var i = INDEX[q + ',' + r]; return i === undefined ? -1 : i; }
  CELLS.forEach(function (cl, i) {
    cl.i = i;
    DIRS.forEach(function (d, k) {
      var a = indexOf(cl.q + d[0], cl.r + d[1]), b = indexOf(cl.q + 2 * d[0], cl.r + 2 * d[1]);
      cl.n.push(a);                           // the neighbour in each direction, or -1
      cl.j.push(a >= 0 && b >= 0 ? b : -1);   // the hole beyond it, or -1
    });
  });
  var CAMPS = [[], [], [], [], [], []];
  CELLS.forEach(function (cl) { if (cl.camp >= 0) CAMPS[cl.camp].push(cl.i); });
  function opposite(camp) { return (camp + 3) % 6; }
  function hexDistance(a, b) {
    var dq = a.q - b.q, dr = a.r - b.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  }
  // The deepest hole of each camp, the one a marble heading there aims for.
  var APEX = CAMPS.map(function (list) {
    var best = list[0];
    list.forEach(function (i) { if (Math.hypot(CELLS[i].x, CELLS[i].y) > Math.hypot(CELLS[best].x, CELLS[best].y)) best = i; });
    return best;
  });
  // DIST_TO[camp][i]: how far hole i is from the apex of that camp.
  var DIST_TO = APEX.map(function (a) { return CELLS.map(function (cl) { return hexDistance(cl, CELLS[a]); }); });

  // ── a game ──
  // state: { owner: Int8Array(121) holding seat + 1 or 0, seats: [camp], turn, rounds, passes }
  function newState(count) {
    var seats = SEATINGS[count].slice(), owner = new Int8Array(CELLS.length);
    seats.forEach(function (camp, s) { CAMPS[camp].forEach(function (i) { owner[i] = s + 1; }); });
    return { owner: owner, seats: seats, turn: 0, rounds: 0, passes: 0 };
  }
  function cloneState(st) { return { owner: new Int8Array(st.owner), seats: st.seats, turn: st.turn, rounds: st.rounds, passes: st.passes }; }
  function goalOf(st, seat) { return opposite(st.seats[seat]); }

  // Where can the marble on `from` go? Returns { destination: [path of holes from `from`] }: one step, or a chain of jumps.
  function movesFrom(st, from) {
    var owner = st.owner, out = {}, seen = {}, queue = [], k, c = CELLS[from];
    seen[from] = true;
    for (k = 0; k < 6; k++) if (c.n[k] >= 0 && !owner[c.n[k]]) { out[c.n[k]] = [from, c.n[k]]; seen[c.n[k]] = true; }
    queue.push([from, [from]]);
    while (queue.length) {
      var item = queue.shift(), at = item[0], path = item[1], cl = CELLS[at];
      for (k = 0; k < 6; k++) {
        var over = cl.n[k], land = cl.j[k];
        if (over < 0 || land < 0 || !owner[over] || owner[land] || seen[land]) continue;
        seen[land] = true;
        var next = path.concat(land);
        out[land] = next;
        queue.push([land, next]);
      }
    }
    return out;
  }
  function marblesOf(st, seat) {
    var list = [];
    for (var i = 0; i < st.owner.length; i++) if (st.owner[i] === seat + 1) list.push(i);
    return list;
  }
  function allMoves(st, seat) {
    var out = [];
    marblesOf(st, seat).forEach(function (from) {
      var m = movesFrom(st, from);
      Object.keys(m).forEach(function (to) { out.push({ from: from, to: +to, path: m[to] }); });
    });
    return out;
  }
  function applyMove(st, seat, from, to) { st.owner[from] = 0; st.owner[to] = seat + 1; }
  function homeCount(st, seat) { // marbles of this seat inside the goal camp
    var n = 0;
    CAMPS[goalOf(st, seat)].forEach(function (i) { if (st.owner[i] === seat + 1) n++; });
    return n;
  }
  function hasWon(st, seat) { return homeCount(st, seat) === HOME_SIZE; }

  // ── the computer ──
  var LEVELS = { easy: { lookahead: false, noise: 6, blunder: 0.3 }, medium: { lookahead: false, noise: 1.2, blunder: 0 }, hard: { lookahead: true, noise: 0.15, blunder: 0 } };
  var GOAL_BONUS = 4, LEAVE_GOAL_PENALTY = 30, STRAGGLER_WEIGHT = 0.6, SIDE_PENALTY = 0.35;
  // How good it is for `seat` to have a marble on hole i: nearer the apex of its goal is better, and so is staying near the middle line.
  function holeValue(st, seat, i) {
    var camp = goalOf(st, seat), cl = CELLS[i], a = CELLS[APEX[camp]];
    var along = Math.hypot(a.x, a.y), ux = a.x / along, uy = a.y / along;
    var side = Math.abs(cl.x * -uy + cl.y * ux);        // distance from the line through the middle and the apex
    return -DIST_TO[camp][i] - (cl.camp === camp ? 0 : side * SIDE_PENALTY);
  }
  function moveScore(st, seat, mv) {
    var gain = holeValue(st, seat, mv.to) - holeValue(st, seat, mv.from), camp = goalOf(st, seat);
    var score = gain * 10 + (-holeValue(st, seat, mv.from)) * STRAGGLER_WEIGHT;
    if (CELLS[mv.to].camp === camp) score += GOAL_BONUS;
    if (CELLS[mv.from].camp === camp && CELLS[mv.to].camp !== camp) score -= LEAVE_GOAL_PENALTY;
    return score;
  }
  // Choose a move for `seat`. rng() gives a number in [0, 1).
  function chooseMove(st, seat, level, rng) {
    var cfg = LEVELS[level] || LEVELS.medium, moves = allMoves(st, seat), i;
    if (!moves.length) return null;
    rng = rng || Math.random;
    if (cfg.blunder && rng() < cfg.blunder) return moves[Math.floor(rng() * moves.length)];
    var best = null, bestScore = -Infinity;
    for (i = 0; i < moves.length; i++) {
      var mv = moves[i], s = moveScore(st, seat, mv);
      if (cfg.lookahead) { // the best follow-up for the same marble after this move
        var after = cloneState(st);
        applyMove(after, seat, mv.from, mv.to);
        var follow = movesFrom(after, mv.to), bestFollow = 0;
        Object.keys(follow).forEach(function (to) {
          var g = holeValue(st, seat, +to) - holeValue(st, seat, mv.to);
          if (g > bestFollow) bestFollow = g;
        });
        s += bestFollow * 3;
      }
      s += (rng() - 0.5) * 2 * cfg.noise;
      if (s > bestScore) { bestScore = s; best = mv; }
    }
    return best;
  }

  var Engine = {
    CELLS: CELLS, CAMPS: CAMPS, APEX: APEX, SEATINGS: SEATINGS, COLOR_NAMES: COLOR_NAMES, HOME_SIZE: HOME_SIZE, LEVELS: LEVELS, MAX_ROUNDS: MAX_ROUNDS,
    indexOf: indexOf, opposite: opposite, hexDistance: hexDistance, newState: newState, cloneState: cloneState, goalOf: goalOf,
    movesFrom: movesFrom, allMoves: allMoves, applyMove: applyMove, marblesOf: marblesOf, homeCount: homeCount, hasWon: hasWon,
    chooseMove: chooseMove, holeValue: holeValue
  };
  root.ChineseCheckersEngine = Engine;

  if (typeof document === 'undefined') return;

  // ═══════════ the page ═══════════
  var BK = root.BoardKit, $ = function (id) { return document.getElementById(id); };
  var SETTINGS_KEY = 'chinesecheckers.settings', STATS_KEY = 'chinesecheckers.stats';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var HOLE_R = 0.43, MARBLE_R = 0.41, SNAP = 0.8, PAD = 0.9;
  var COMPUTER_DELAY_MS = 380, FAST_DELAY_MS = 140;
  var MARBLE_COLORS = ['#d32f2f', '#f2b01e', '#2e9e4f', '#1e63c9', '#2b2f36', '#f3efe4'];

  var settings = BK.load(SETTINGS_KEY, {});
  if ([2, 3, 4, 6].indexOf(settings.count) < 0) settings.count = 2;
  if (!LEVELS[settings.level]) settings.level = 'medium';
  if (!Array.isArray(settings.humans)) settings.humans = [true, false, false, false, false, false];
  if (settings.hints !== false) settings.hints = true;
  var stats = BK.load(STATS_KEY, {});

  var svg = $('cc-svg'), layer, holes = [], state, history = [], over = false, sel = -1, targets = {}, lastPath = null, cursor = 0, timer = 0;
  var hasHuman = true;

  function isHuman(seat) { return !!settings.humans[seat]; }
  function seatName(seat) { return COLOR_NAMES[state.seats[seat]]; }
  function colorOf(seat) { return MARBLE_COLORS[state.seats[seat]]; }

  function el(name, attrs, parent) {
    var e = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  function build() {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    CELLS.forEach(function (c) { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y); });
    svg.setAttribute('viewBox', (minX - PAD) + ' ' + (minY - PAD) + ' ' + (maxX - minX + 2 * PAD) + ' ' + (maxY - minY + 2 * PAD));
    // the star is two big triangles through the tip holes, drawn with a round stroke so it has a rim
    [[[8, -4], [-4, 8], [-4, -4]], [[-8, 4], [4, -8], [4, 4]]].forEach(function (tri) {
      var pts = tri.map(function (p) { var c = CELLS[indexOf(p[0], p[1])]; return c.x + ',' + c.y; }).join(' ');
      el('polygon', { points: pts, class: 'cc-star' }, svg);
    });
    layer = { lines: el('g', {}, svg), holes: el('g', {}, svg), marks: el('g', {}, svg), marbles: el('g', {}, svg), cursor: el('g', {}, svg) };
    CELLS.forEach(function (c) {
      var h = el('circle', { cx: c.x, cy: c.y, r: HOLE_R, class: 'cc-hole' + (c.camp >= 0 ? ' camp camp-' + c.camp : '') }, layer.holes);
      holes.push(h);
    });
  }

  // ── drawing ──
  function paintMarbles() {
    layer.marbles.textContent = '';
    for (var i = 0; i < CELLS.length; i++) {
      var o = state.owner[i];
      if (!o) continue;
      var c = CELLS[i], camp = state.seats[o - 1];
      var g = el('g', { class: 'cc-marble m' + camp + (i === sel ? ' sel' : '') }, layer.marbles);
      el('circle', { cx: c.x, cy: c.y, r: MARBLE_R, fill: MARBLE_COLORS[camp] }, g);
      el('circle', { cx: c.x - 0.12, cy: c.y - 0.14, r: 0.12, class: 'shine' }, g);
    }
  }
  function paintMarks() {
    layer.marks.textContent = '';
    if (lastPath) {
      var pts = lastPath.map(function (i) { return CELLS[i].x + ',' + CELLS[i].y; }).join(' ');
      el('polyline', { points: pts, class: 'cc-trail' }, layer.marks);
      el('circle', { cx: CELLS[lastPath[0]].x, cy: CELLS[lastPath[0]].y, r: HOLE_R + 0.08, class: 'cc-ring last' }, layer.marks);
    }
    if (sel >= 0) el('circle', { cx: CELLS[sel].x, cy: CELLS[sel].y, r: MARBLE_R + 0.12, class: 'cc-ring sel' }, layer.marks);
    if (settings.hints) Object.keys(targets).forEach(function (t) {
      el('circle', { cx: CELLS[t].x, cy: CELLS[t].y, r: 0.2, class: 'cc-hint' }, layer.marks);
    });
  }
  function paintCursor() {
    layer.cursor.textContent = '';
    if (document.activeElement === svg) el('circle', { cx: CELLS[cursor].x, cy: CELLS[cursor].y, r: 0.52, class: 'cc-cursor' }, layer.cursor);
  }
  function paintScores() {
    var box = $('cc-scores');
    box.textContent = '';
    state.seats.forEach(function (camp, s) {
      var item = document.createElement('span');
      item.className = 'cc-score' + (s === state.turn && !over ? ' now' : '');
      var dot = document.createElement('i');
      dot.className = 'cc-swatch'; dot.style.background = MARBLE_COLORS[camp]; dot.setAttribute('aria-hidden', 'true');
      item.appendChild(dot);
      item.appendChild(document.createTextNode(COLOR_NAMES[camp] + (isHuman(s) ? '' : ' (cpu)') + ' '));
      var b = document.createElement('b');
      b.textContent = homeCount(state, s) + '/' + HOME_SIZE;
      item.appendChild(b);
      box.appendChild(item);
    });
  }
  function paintAll() {
    paintMarbles(); paintMarks(); paintCursor(); paintScores();
    $('cc-undo').disabled = !history.length || !hasHuman;
  }
  function say(text, busy) {
    var s = $('cc-status');
    s.textContent = '';
    if (busy) { var sp = document.createElement('span'); sp.className = 'bg-spin'; s.appendChild(sp); }
    if (!over) { var d = document.createElement('i'); d.className = 'cc-swatch'; d.style.background = colorOf(state.turn); d.setAttribute('aria-hidden', 'true'); s.appendChild(d); }
    s.appendChild(document.createTextNode(text));
  }

  // ── turns ──
  function finish(winnerSeat, how) {
    over = true; sel = -1; targets = {}; clearTimeout(timer);
    var msg;
    if (winnerSeat >= 0) msg = (isHuman(winnerSeat) ? (settings.humans.filter(Boolean).length > 1 ? seatName(winnerSeat) + ' wins.' : 'You win.') : seatName(winnerSeat) + ' (computer) wins.');
    else msg = 'It ends in a draw.';
    if (how) msg += ' ' + how;
    var humans = state.seats.map(function (c, s) { return s; }).filter(isHuman);
    if (humans.length === 1) {
      var k = settings.count + '.' + settings.level, st = stats[k] = stats[k] || { w: 0, l: 0 };
      if (winnerSeat === humans[0]) st.w++; else st.l++;
      BK.save(STATS_KEY, stats);
    }
    paintAll(); say(msg); showStats();
    $('cc-result-text').textContent = msg;
    resultSheet.open($('cc-again'));
  }
  function showStats() {
    var s = stats[settings.count + '.' + settings.level];
    $('cc-stats').textContent = hasHuman && settings.humans.slice(0, settings.count).filter(Boolean).length === 1 ? 'vs ' + settings.level + ', ' + settings.count + ' players: ' + (s ? s.w : 0) + ' won, ' + (s ? s.l : 0) + ' lost' : '';
  }

  function nextTurn() {
    clearTimeout(timer);
    sel = -1; targets = {};
    var seat = state.turn;
    if (state.rounds >= MAX_ROUNDS) {
      var best = -1, most = -1;
      state.seats.forEach(function (c, s) { var h = homeCount(state, s); if (h > most) { most = h; best = s; } });
      finish(best, 'No one got all ten home in ' + MAX_ROUNDS + ' rounds, so the most marbles home wins.'); return;
    }
    var moves = allMoves(state, seat);
    if (!moves.length) {
      state.passes++;
      if (state.passes >= state.seats.length) { finish(-1, 'No one can move.'); return; }
      say(seatName(seat) + ' cannot move and passes');
      advance(); timer = setTimeout(nextTurn, FAST_DELAY_MS * 3); paintAll(); return;
    }
    state.passes = 0;
    paintAll();
    if (isHuman(seat)) say(settings.humans.slice(0, settings.count).filter(Boolean).length > 1 ? seatName(seat) + ' to move' : 'Your turn');
    else {
      say(seatName(seat) + ' is thinking', true);
      timer = setTimeout(function () { computerMove(seat); }, state.seats.some(function (c, s) { return isHuman(s); }) ? COMPUTER_DELAY_MS : FAST_DELAY_MS);
    }
  }
  function advance() { state.turn = (state.turn + 1) % state.seats.length; if (state.turn === 0) state.rounds++; }

  function commit(seat, mv) {
    applyMove(state, seat, mv.from, mv.to);
    lastPath = mv.path;
    if (hasWon(state, seat)) { paintAll(); finish(seat); return; }
    advance();
    nextTurn();
  }
  function computerMove(seat) {
    if (over || state.turn !== seat) return;
    var mv = chooseMove(state, seat, settings.level);
    if (!mv) { nextTurn(); return; }
    commit(seat, mv);
  }
  function humanMove(from, to) {
    var seat = state.turn, path = movesFrom(state, from)[to];
    history.push({ owner: new Int8Array(state.owner), turn: state.turn, rounds: state.rounds, passes: state.passes, lastPath: lastPath });
    commit(seat, { from: from, to: to, path: path });
  }

  function tap(i) {
    if (over || !isHuman(state.turn)) return;
    var seat = state.turn;
    if (sel >= 0 && targets.hasOwnProperty(i)) { humanMove(sel, i); return; }
    if (state.owner[i] === seat + 1 && i !== sel) {
      sel = i; targets = movesFrom(state, i);
      delete targets[i];
      if (!Object.keys(targets).length) say('That marble cannot move');
      else say('Choose where it goes');
    } else { sel = -1; targets = {}; say(settings.humans.slice(0, settings.count).filter(Boolean).length > 1 ? seatName(seat) + ' to move' : 'Your turn'); }
    paintMarks(); paintMarbles(); paintCursor();
  }

  // The nearest hole to a point of the board, preferring a legal destination when there is one close by.
  function holeAt(clientX, clientY) {
    var pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    var p = pt.matrixTransform(svg.getScreenCTM().inverse()), best = -1, bd = Infinity, bestT = -1, bt = Infinity;
    CELLS.forEach(function (c, i) {
      var d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bd) { bd = d; best = i; }
      if (targets.hasOwnProperty(i) && d < bt) { bt = d; bestT = i; }
    });
    if (bestT >= 0 && bt <= SNAP) return bestT;
    return bd <= SNAP ? best : -1;
  }
  svg.addEventListener('click', function (e) {
    var i = holeAt(e.clientX, e.clientY);
    if (i < 0) return;
    cursor = i;
    tap(i);
  });

  // Keyboard: the arrow keys move a cursor hole to the nearest hole in that direction; Enter or Space taps it.
  var KEYDIR = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  svg.addEventListener('keydown', function (e) {
    var d = KEYDIR[e.key];
    if (d) {
      e.preventDefault();
      var c = CELLS[cursor], best = -1, bs = Infinity;
      CELLS.forEach(function (o, i) {
        var dx = o.x - c.x, dy = o.y - c.y, along = dx * d[0] + dy * d[1];
        if (along < 0.5) return;
        var across = Math.abs(dx * d[1] - dy * d[0]), score = along + across * 2.5;
        if (score < bs) { bs = score; best = i; }
      });
      if (best >= 0) cursor = best;
      paintCursor(); announce();
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(cursor); }
  });
  svg.addEventListener('focus', function () { paintCursor(); announce(); });
  svg.addEventListener('blur', paintCursor);
  function announce() {
    var c = CELLS[cursor], o = state.owner[cursor];
    svg.setAttribute('aria-label', 'Chinese Checkers board. Hole ' + (c.q + 5) + ', ' + (c.r + 9) + (o ? ', ' + COLOR_NAMES[state.seats[o - 1]] + ' marble' : targets.hasOwnProperty(cursor) ? ', move here' : ', empty') + (cursor === sel ? ', selected' : ''));
  }

  function undo() {
    if (!history.length) return;
    clearTimeout(timer);
    var h = history.pop();
    state.owner = h.owner; state.turn = h.turn; state.rounds = h.rounds; state.passes = h.passes; lastPath = h.lastPath;
    over = false; resultSheet.close();
    nextTurn();
  }

  function newGame() {
    clearTimeout(timer);
    state = newState(settings.count); history = []; over = false; sel = -1; targets = {}; lastPath = null;
    hasHuman = state.seats.some(function (c, s) { return isHuman(s); });
    cursor = CAMPS[state.seats[0]][0];
    resultSheet.close();
    showStats();
    nextTurn();
  }

  // ── bar, menu, keys ──
  var menu = BK.sheet($('cc-sheet')), resultSheet = BK.sheet($('cc-result'));
  function buildSeatRows() {
    var box = $('cc-seats'), count = +BK.chipValue($('cc-f-count')) || settings.count;
    box.textContent = '';
    SEATINGS[count].forEach(function (camp, s) {
      var row = document.createElement('div');
      row.className = 'cc-seat';
      var dot = document.createElement('i');
      dot.className = 'cc-swatch'; dot.style.background = MARBLE_COLORS[camp];
      var name = document.createElement('span');
      name.textContent = COLOR_NAMES[camp];
      var chips = document.createElement('div');
      chips.className = 'bg-chips'; chips.dataset.seat = s;
      [['human', 'Person'], ['cpu', 'Computer']].forEach(function (o) {
        var lab = document.createElement('label'), inp = document.createElement('input'), sp = document.createElement('span');
        lab.className = 'bg-chip'; inp.type = 'radio'; inp.name = 'cc-seat-' + s; inp.value = o[0];
        inp.checked = (o[0] === 'human') === !!settings.humans[s];
        sp.textContent = o[1];
        lab.appendChild(inp); lab.appendChild(sp); chips.appendChild(lab);
      });
      row.appendChild(dot); row.appendChild(name); row.appendChild(chips);
      box.appendChild(row);
    });
  }
  function syncMenu() {
    BK.chipSet($('cc-f-count'), settings.count); BK.chipSet($('cc-f-level'), settings.level); $('cc-hints').checked = settings.hints;
    buildSeatRows();
  }
  $('cc-new').addEventListener('click', function () { syncMenu(); menu.open(); });
  $('cc-f-count').addEventListener('change', buildSeatRows);
  $('cc-cancel').addEventListener('click', menu.close);
  $('cc-start').addEventListener('click', function () {
    settings.count = +BK.chipValue($('cc-f-count')); settings.level = BK.chipValue($('cc-f-level')); settings.hints = $('cc-hints').checked;
    Array.prototype.forEach.call($('cc-seats').querySelectorAll('.bg-chips'), function (g) { settings.humans[+g.dataset.seat] = BK.chipValue(g) === 'human'; });
    BK.save(SETTINGS_KEY, settings);
    menu.close(); newGame();
  });
  $('cc-again').addEventListener('click', newGame);
  $('cc-close').addEventListener('click', function () { resultSheet.close(); });
  $('cc-undo').addEventListener('click', undo);
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input')) return;
    var k = e.key.toLowerCase();
    if (k === 'n') { syncMenu(); menu.open(); } else if (k === 'u') undo();
    else if (e.key === 'Escape' && sel >= 0) { sel = -1; targets = {}; paintMarks(); paintMarbles(); }
  });

  build();
  newGame();

  if (new URLSearchParams(location.search).has('debug')) {
    root.__cc = { engine: Engine, state: function () { return state; }, settings: settings, tap: tap, humanMove: humanMove };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
