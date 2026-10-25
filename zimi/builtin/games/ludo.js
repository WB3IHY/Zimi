/* ZimiGames: Ludo. Our own code, GPL-3.0. The first half is the rules and the computer players
   (no DOM, tested under node); the second half is the page. No network, no modules.
   A token's place is a number: -1 in the yard, 0..50 along the ring from its own start square,
   51..55 up its home column, 56 home. */
(function (root) {
  'use strict';

  var RING_SIZE = 52, ENTER = 0, LAST_RING = 50, HOME_COLUMN = 51, HOME = 56, TOKENS = 4, EXIT_ROLL = 6, MAX_SIXES = 3;
  var START = [0, 13, 26, 39];                       // ring square where each colour enters
  var STARS = [8, 21, 34, 47];                       // the other safe squares
  var SAFE = {};
  START.concat(STARS).forEach(function (a) { SAFE[a] = true; });
  var SEATINGS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
  var COLOR_NAMES = ['Red', 'Green', 'Yellow', 'Blue'];

  // The ring on a 15 x 15 board as [row, col], clockwise from Red's entry square.
  var RING = [];
  (function () {
    function run(r, c, dr, dc, n) { for (var i = 0; i < n; i++) RING.push([r + dr * i, c + dc * i]); }
    run(6, 1, 0, 1, 5); run(5, 6, -1, 0, 6); run(0, 7, 0, 1, 2); run(1, 8, 1, 0, 5);
    run(6, 9, 0, 1, 6); run(7, 14, 1, 0, 2); run(8, 13, 0, -1, 5); run(9, 8, 1, 0, 6);
    run(14, 7, 0, -1, 2); run(13, 6, -1, 0, 5); run(8, 5, 0, -1, 6); run(7, 0, -1, 0, 2);
  })();
  var HOME_CELLS = [[[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]], [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]], [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]], [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]]];
  var YARDS = [[0, 0], [0, 9], [9, 9], [9, 0]];

  function ringIndex(color, p) { return (START[color] + p) % RING_SIZE; }
  function isSafeSquare(a) { return !!SAFE[a]; }

  // ── a game ──
  function newState(count) {
    var seats = SEATINGS[count].slice(), tokens = seats.map(function () { return [-1, -1, -1, -1]; });
    return { seats: seats, tokens: tokens, turn: 0, sixes: 0, winner: -1 };
  }
  function cloneState(st) { return { seats: st.seats, tokens: st.tokens.map(function (t) { return t.slice(); }), turn: st.turn, sixes: st.sixes, winner: st.winner }; }

  // Opponent tokens a move to ring place p would capture: a lone token on a square that is not safe.
  function capturesAt(st, seat, p) {
    if (p > LAST_RING || p < ENTER) return [];
    var a = ringIndex(st.seats[seat], p);
    if (isSafeSquare(a)) return [];
    var out = [];
    st.seats.forEach(function (color, s) {
      if (s === seat) return;
      var here = [];
      st.tokens[s].forEach(function (q, t) { if (q >= ENTER && q <= LAST_RING && ringIndex(color, q) === a) here.push({ seat: s, token: t }); });
      if (here.length === 1) out.push(here[0]);
    });
    return out;
  }
  // The moves a die roll allows: { token, from, to, captures, exits }.
  function legalMoves(st, seat, die) {
    var out = [];
    st.tokens[seat].forEach(function (p, t) {
      var to;
      if (p === -1) { if (die !== EXIT_ROLL) return; to = ENTER; } else { to = p + die; if (to > HOME) return; }
      out.push({ token: t, from: p, to: to, captures: capturesAt(st, seat, to), exits: p === -1 });
    });
    return out;
  }
  function applyMove(st, seat, mv) {
    st.tokens[seat][mv.token] = mv.to;
    mv.captures.forEach(function (c) { st.tokens[c.seat][c.token] = -1; });
    if (st.tokens[seat].every(function (p) { return p === HOME; })) st.winner = seat;
  }
  function homeCount(st, seat) { return st.tokens[seat].filter(function (p) { return p === HOME; }).length; }
  function rollDie(rng) { return 1 + Math.floor((rng || Math.random)() * 6); }

  // Is a token on ring square a within reach (1 to 6 steps) of an opponent token behind it?
  function threatened(st, seat, a) {
    if (isSafeSquare(a)) return false;
    var hit = false;
    st.seats.forEach(function (color, s) {
      if (s === seat) return;
      st.tokens[s].forEach(function (q) {
        if (q < ENTER || q > LAST_RING) return;
        var gap = (a - ringIndex(color, q) + RING_SIZE) % RING_SIZE;
        if (gap >= 1 && gap <= 6) hit = true;
      });
    });
    return hit;
  }

  var LEVELS = { easy: { noise: 1000, smart: false }, medium: { noise: 14, smart: false }, hard: { noise: 3, smart: true } };
  var SCORE = { capture: 80, home: 70, exit: 55, column: 35, safe: 22, escape: 30, danger: -26, progress: 0.5 };
  function scoreMove(st, seat, mv, smart) {
    var color = st.seats[seat], s = mv.to * SCORE.progress;
    if (mv.captures.length) {
      s += SCORE.capture;
      mv.captures.forEach(function (c) { s += st.tokens[c.seat][c.token] * 0.4; });
    }
    if (mv.to === HOME) s += SCORE.home;
    else if (mv.to >= HOME_COLUMN) s += SCORE.column;
    if (mv.exits) s += SCORE.exit;
    if (mv.to <= LAST_RING && isSafeSquare(ringIndex(color, mv.to))) s += SCORE.safe;
    if (mv.from >= ENTER && mv.from <= LAST_RING && threatened(st, seat, ringIndex(color, mv.from))) s += SCORE.escape;
    if (smart && mv.to <= LAST_RING && threatened(st, seat, ringIndex(color, mv.to))) s += SCORE.danger;
    return s;
  }
  // Choose a move for `seat`. rng() gives a number in [0, 1).
  function chooseMove(st, seat, die, level, rng) {
    var moves = legalMoves(st, seat, die);
    if (!moves.length) return null;
    var cfg = LEVELS[level] || LEVELS.medium, best = null, bestScore = -Infinity;
    rng = rng || Math.random;
    moves.forEach(function (mv) {
      var s = scoreMove(st, seat, mv, cfg.smart) + rng() * cfg.noise;
      if (s > bestScore) { bestScore = s; best = mv; }
    });
    return best;
  }

  var Engine = {
    RING: RING, HOME_CELLS: HOME_CELLS, YARDS: YARDS, START: START, STARS: STARS, SEATINGS: SEATINGS, COLOR_NAMES: COLOR_NAMES, LEVELS: LEVELS,
    HOME: HOME, TOKENS: TOKENS, MAX_SIXES: MAX_SIXES, EXIT_ROLL: EXIT_ROLL, LAST_RING: LAST_RING, HOME_COLUMN: HOME_COLUMN, RING_SIZE: RING_SIZE,
    ringIndex: ringIndex, isSafeSquare: isSafeSquare, newState: newState, cloneState: cloneState, legalMoves: legalMoves, applyMove: applyMove,
    homeCount: homeCount, rollDie: rollDie, chooseMove: chooseMove, capturesAt: capturesAt, threatened: threatened
  };
  root.LudoEngine = Engine;

  if (typeof document === 'undefined') return;

  // ═══════════ the page ═══════════
  var BK = root.BoardKit, $ = function (id) { return document.getElementById(id); };
  var SETTINGS_KEY = 'ludo.settings', STATS_KEY = 'ludo.stats', SVG_NS = 'http://www.w3.org/2000/svg';
  var COLORS = ['#d32f2f', '#2e9e4f', '#f2b01e', '#1e63c9'], TINTS = ['#f6c9c9', '#c8e8d1', '#fbe6ae', '#c3d6f4'];
  var MAX_TRIES = 3;
  var ROLL_FRAMES = 7, ROLL_FRAME_MS = 70, STEP_MS = 120, AUTO_MOVE_MS = 520, COMPUTER_ROLL_MS = 650, COMPUTER_MOVE_MS = 600, PASS_MS = 1100;
  var FINISH = [[6.6, 7.5], [7.5, 6.6], [8.4, 7.5], [7.5, 8.4]], FINISH_GAP = 0.56, FINISH_SCALE = 0.55;   // [x, y] where a colour's home tokens sit

  var settings = BK.load(SETTINGS_KEY, {});
  if ([2, 3, 4].indexOf(settings.count) < 0) settings.count = 4;
  if (!LEVELS[settings.level]) settings.level = 'medium';
  if (!Array.isArray(settings.humans)) settings.humans = [true, false, false, false];
  if (settings.hints !== false) settings.hints = true;
  var stats = BK.load(STATS_KEY, {});

  var svg = $('ld-svg'), tokenLayer, state, phase = 'roll', die = 0, legal = [], over = false, anim = null, timer = 0, tokenEls = [], dieEl = $('ld-die');
  var reduced = BK.reducedMotion();

  function isHuman(seat) { return !!settings.humans[seat]; }
  function colorOf(seat) { return state.seats[seat]; }
  function seatName(seat) { return COLOR_NAMES[colorOf(seat)]; }
  function humansCount() { return state.seats.filter(function (c, s) { return isHuman(s); }).length; }
  function el(name, attrs, parent) {
    var e = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  // ── the board ──
  function buildBoard() {
    svg.setAttribute('viewBox', '0 0 15 15');
    var g = el('g', {}, svg), i, c;
    el('rect', { x: 0, y: 0, width: 15, height: 15, rx: 0.5, class: 'ld-ground' }, g);
    for (c = 0; c < 4; c++) { // yards
      var y = YARDS[c];
      el('rect', { x: y[1], y: y[0], width: 6, height: 6, fill: COLORS[c], class: 'ld-yard' }, g);
      el('rect', { x: y[1] + 0.8, y: y[0] + 0.8, width: 4.4, height: 4.4, rx: 0.6, class: 'ld-yard-in' }, g);
      for (i = 0; i < 4; i++) el('circle', { cx: y[1] + 2 + (i % 2) * 2, cy: y[0] + 2 + Math.floor(i / 2) * 2, r: 0.62, fill: TINTS[c], class: 'ld-spot' }, g);
    }
    RING.forEach(function (rc, a) {
      var startOf = START.indexOf(a);
      var sq = el('rect', { x: rc[1] + 0.04, y: rc[0] + 0.04, width: 0.92, height: 0.92, rx: 0.12, class: 'ld-cell' }, g);
      if (startOf >= 0) sq.style.fill = COLORS[startOf];
      if (startOf < 0 && STARS.indexOf(a) >= 0) el('text', { x: rc[1] + 0.5, y: rc[0] + 0.52, class: 'ld-star' }, g).textContent = '★';
    });
    HOME_CELLS.forEach(function (cells, color) {
      cells.forEach(function (rc) { el('rect', { x: rc[1] + 0.04, y: rc[0] + 0.04, width: 0.92, height: 0.92, rx: 0.12, class: 'ld-cell' }, g).style.fill = COLORS[color]; });
    });
    // the middle: one triangle per colour on its own side, Red left, Green top, Yellow right, Blue bottom
    var sides = [[[6, 6], [6, 9]], [[6, 6], [9, 6]], [[9, 6], [9, 9]], [[6, 9], [9, 9]]];
    sides.forEach(function (s, color) {
      el('polygon', { points: s[0][0] + ',' + s[0][1] + ' ' + s[1][0] + ',' + s[1][1] + ' 7.5,7.5', fill: COLORS[color], class: 'ld-center' }, g);
    });
    tokenLayer = el('g', {}, svg);
  }

  // Where a token is drawn, as [x, y] in board units.
  function spot(seat, t, p) {
    var color = colorOf(seat);
    if (p === -1) { var y = YARDS[color]; return [y[1] + 2 + (t % 2) * 2, y[0] + 2 + Math.floor(t / 2) * 2]; }
    if (p <= LAST_RING) { var rc = RING[ringIndex(color, p)]; return [rc[1] + 0.5, rc[0] + 0.5]; }
    if (p < HOME) { var h = HOME_CELLS[color][p - HOME_COLUMN]; return [h[1] + 0.5, h[0] + 0.5]; }
    var f = FINISH[color], along = (t - 1.5) * FINISH_GAP;   // the four finished tokens line up along the triangle's base
    return color % 2 === 0 ? [f[0], f[1] + along] : [f[0] + along, f[1]];
  }
  function shownPlace(seat, t) { return anim && anim.seat === seat && anim.token === t ? anim.p : state.tokens[seat][t]; }

  function paintTokens() {
    tokenLayer.textContent = '';
    tokenEls = [];
    var places = {}, drawn = [];
    state.seats.forEach(function (color, seat) {
      state.tokens[seat].forEach(function (_, t) {
        var p = shownPlace(seat, t), xy = spot(seat, t, p), key = p === -1 || p === HOME ? 'u' + seat + t : xy[0] + ',' + xy[1];
        (places[key] = places[key] || []).push({ seat: seat, t: t, p: p, xy: xy });
      });
    });
    var movable = {};
    if (phase === 'move' && !over && isHuman(state.turn)) legal.forEach(function (m) { movable[state.turn + ':' + m.token] = m; });
    Object.keys(places).forEach(function (k) {
      var group = places[k];
      group.forEach(function (tk, idx) {
        var n = group.length, dx = 0, dy = 0, scale = tk.p === HOME ? FINISH_SCALE : 1;
        if (n > 1) { var ang = Math.PI * 2 * idx / n + Math.PI / 4; dx = Math.cos(ang) * 0.2; dy = Math.sin(ang) * 0.2; scale = n > 2 ? 0.78 : 0.86; }
        drawn.push({ tk: tk, dx: dx, dy: dy, scale: scale });
      });
    });
    drawn.sort(function (a, b) { return (movable[a.tk.seat + ':' + a.tk.t] ? 1 : 0) - (movable[b.tk.seat + ':' + b.tk.t] ? 1 : 0); });   // the ones you can tap are drawn last, on top
    drawn.forEach(function (d) {
      var tk = d.tk, color = colorOf(tk.seat), mv = movable[tk.seat + ':' + tk.t];
      var g = el('g', { class: 'ld-token' + (mv ? ' can' : '') + (anim && anim.seat === tk.seat && anim.token === tk.t ? ' moving' : ''), transform: 'translate(' + (tk.xy[0] + d.dx) + ',' + (tk.xy[1] + d.dy) + ')' }, tokenLayer);
      if (mv) {
        g.setAttribute('role', 'button'); g.setAttribute('tabindex', '0');
        g.setAttribute('aria-label', COLOR_NAMES[color] + ' token ' + (tk.t + 1) + (mv.exits ? ', leave home' : ', move ' + die) + (mv.captures.length ? ', captures' : ''));
        g.addEventListener('click', function () { choose(mv); });
        g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(mv); } });
        el('circle', { r: 0.78, class: 'ld-hit' }, g);
        el('circle', { r: 0.62 * d.scale + 0.16, class: 'ld-halo' }, g);
      }
      el('circle', { r: 0.5 * d.scale, fill: COLORS[color], class: 'ld-disc c' + color }, g);
      el('circle', { r: 0.5 * d.scale * 0.62, class: 'ld-disc-in' }, g);
      var tx = el('text', { class: 'ld-num c' + color, 'font-size': 0.6 * d.scale }, g);
      tx.textContent = tk.t + 1;
      if (mv) tokenEls.push(g);
    });
  }

  function paintScores() {
    var box = $('ld-scores');
    box.textContent = '';
    state.seats.forEach(function (color, seat) {
      var s = document.createElement('span');
      s.className = 'ld-score' + (seat === state.turn && !over ? ' now' : '');
      var dot = document.createElement('i');
      dot.className = 'ld-swatch'; dot.style.background = COLORS[color]; dot.setAttribute('aria-hidden', 'true');
      s.appendChild(dot);
      s.appendChild(document.createTextNode(COLOR_NAMES[color] + (isHuman(seat) ? '' : ' (cpu)') + ' '));
      var b = document.createElement('b'); b.textContent = homeCount(state, seat) + '/' + TOKENS;
      s.appendChild(b); box.appendChild(s);
    });
  }

  // The die: pips on a rounded square. It is also the Roll button when it is a person's turn to roll.
  var PIPS = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]] };
  function paintDie(v) {
    var h = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="3" y="3" width="58" height="58" rx="12" class="ld-die-face"/>';
    (PIPS[v] || []).forEach(function (p) { h += '<circle cx="' + (16 + p[1] * 16) + '" cy="' + (16 + p[0] * 16) + '" r="5.5" class="ld-pip"/>'; });
    dieEl.innerHTML = h + '</svg>';
  }
  function setDieState() {
    var canRoll = phase === 'roll' && !over && isHuman(state.turn);
    dieEl.disabled = !canRoll;
    dieEl.setAttribute('aria-label', canRoll ? 'Roll the die' : 'Die showing ' + (die || 'nothing'));
    dieEl.classList.toggle('ready', canRoll);
    $('ld-die-hint').textContent = canRoll ? 'Roll' : '';
  }

  function say(text, busy) {
    var s = $('ld-status');
    s.textContent = '';
    if (busy) { var sp = document.createElement('span'); sp.className = 'bg-spin'; s.appendChild(sp); }
    if (!over) { var d = document.createElement('i'); d.className = 'ld-swatch'; d.style.background = COLORS[colorOf(state.turn)]; d.setAttribute('aria-hidden', 'true'); s.appendChild(d); }
    s.appendChild(document.createTextNode(text));
  }
  function render() { paintTokens(); paintScores(); setDieState(); }
  function who(seat) { return humansCount() > 1 || !isHuman(seat) ? seatName(seat) : 'You'; }

  // ── turns ──
  function startTurn() {
    clearTimeout(timer);
    phase = 'roll'; die = 0; legal = [];
    render();
    var seat = state.turn;
    if (isHuman(seat)) say((humansCount() > 1 ? seatName(seat) + ', roll' : 'Your turn, roll') + ' the die');
    else { say(seatName(seat) + ' is rolling', true); timer = setTimeout(function () { roll(); }, humansCount() ? COMPUTER_ROLL_MS : 300); }
  }
  function nextSeat() { state.turn = (state.turn + 1) % state.seats.length; state.sixes = 0; state.tries = 0; }

  function roll() {
    if (phase !== 'roll' || over) return;
    phase = 'busy'; setDieState();
    var value = rollDie(), n = 0;
    function frame() {
      if (n < ROLL_FRAMES && !reduced) { paintDie(1 + Math.floor(Math.random() * 6)); n++; timer = setTimeout(frame, ROLL_FRAME_MS); return; }
      die = value; paintDie(die); afterRoll();
    }
    frame();
  }
  function afterRoll() {
    var seat = state.turn;
    if (die === EXIT_ROLL) state.sixes++; else state.sixes = 0;
    if (state.sixes >= MAX_SIXES) {
      say(who(seat) + ' rolled a third six in a row, and loses the turn');
      timer = setTimeout(function () { nextSeat(); startTurn(); }, PASS_MS); return;
    }
    legal = legalMoves(state, seat, die);
    if (!legal.length) {
      var waiting = state.tokens[seat].every(function (p) { return p === -1 || p === HOME; });   // nothing on the board: three tries to roll a six
      var again = die === EXIT_ROLL || (waiting && state.tries < MAX_TRIES - 1);
      if (waiting && die !== EXIT_ROLL) state.tries++;
      say(who(seat) + ' rolled ' + die + ' and cannot move.' + (again ? ' Roll again.' : ''));
      timer = setTimeout(function () { if (again) startTurn(); else { nextSeat(); startTurn(); } }, PASS_MS); return;
    }
    phase = 'move';
    var distinct = {};
    legal.forEach(function (m) { distinct[m.from + ':' + m.to] = m; });
    var options = Object.keys(distinct);
    if (isHuman(seat)) {
      render();
      if (options.length === 1) { say('Rolled ' + die + ', moving'); timer = setTimeout(function () { choose(distinct[options[0]]); }, AUTO_MOVE_MS); }
      else say('Rolled ' + die + ', pick a token to move');
    } else {
      render();
      say(seatName(seat) + ' rolled ' + die);
      timer = setTimeout(function () { choose(chooseMove(state, seat, die, settings.level)); }, COMPUTER_MOVE_MS);
    }
  }

  function choose(mv) {
    if (phase !== 'move' || over) return;
    clearTimeout(timer);
    phase = 'busy'; legal = [];
    var seat = state.turn, from = mv.from, steps = [];
    if (mv.exits) steps.push(mv.to); else for (var p = from + 1; p <= mv.to; p++) steps.push(p);
    var i = 0;
    function step() {
      if (i < steps.length && !reduced) { anim = { seat: seat, token: mv.token, p: steps[i++] }; render(); timer = setTimeout(step, STEP_MS); return; }
      anim = null;
      applyMove(state, seat, mv);
      last = { seat: seat, mv: mv };
      render();
      if (state.winner >= 0) { finish(state.winner); return; }
      var extra = die === EXIT_ROLL;
      if (mv.captures.length) say(who(seat) + ' sent ' + mv.captures.map(function (c) { return seatName(c.seat); }).join(' and ') + ' home');
      timer = setTimeout(function () { if (!extra) nextSeat(); startTurn(); }, mv.captures.length ? PASS_MS * 0.7 : 220);
    }
    step();
  }
  var last = null;

  function finish(winner) {
    over = true; clearTimeout(timer); phase = 'roll';
    var msg = humansCount() === 1 ? (isHuman(winner) ? 'You win.' : seatName(winner) + ' (computer) wins.') : seatName(winner) + (isHuman(winner) ? '' : ' (computer)') + ' wins.';
    var humans = state.seats.map(function (c, s) { return s; }).filter(isHuman);
    if (humans.length === 1) {
      var k = settings.count + '.' + settings.level, st = stats[k] = stats[k] || { w: 0, l: 0 };
      if (winner === humans[0]) st.w++; else st.l++;
      BK.save(STATS_KEY, stats);
    }
    render(); say(msg); showStats();
    $('ld-result-text').textContent = msg;
    resultSheet.open($('ld-again'));
  }
  function showStats() {
    var s = stats[settings.count + '.' + settings.level];
    $('ld-stats').textContent = humansCount() === 1 ? 'vs ' + settings.level + ', ' + settings.count + ' players: ' + (s ? s.w : 0) + ' won, ' + (s ? s.l : 0) + ' lost' : '';
  }

  function newGame() {
    clearTimeout(timer);
    state = newState(settings.count); state.tries = 0; over = false; anim = null; last = null; die = 0; paintDie(0);
    resultSheet.close(); showStats();
    startTurn();
  }

  // ── controls ──
  dieEl.addEventListener('click', roll);
  var menu = BK.sheet($('ld-sheet')), resultSheet = BK.sheet($('ld-result'));
  function buildSeatRows() {
    var box = $('ld-seats'), count = +BK.chipValue($('ld-f-count')) || settings.count;
    box.textContent = '';
    SEATINGS[count].forEach(function (color, s) {
      var row = document.createElement('div'); row.className = 'ld-seat';
      var dot = document.createElement('i'); dot.className = 'ld-swatch'; dot.style.background = COLORS[color];
      var name = document.createElement('span'); name.textContent = COLOR_NAMES[color];
      var chips = document.createElement('div'); chips.className = 'bg-chips'; chips.dataset.seat = s;
      [['human', 'Person'], ['cpu', 'Computer']].forEach(function (o) {
        var lab = document.createElement('label'), inp = document.createElement('input'), sp = document.createElement('span');
        lab.className = 'bg-chip'; inp.type = 'radio'; inp.name = 'ld-seat-' + s; inp.value = o[0];
        inp.checked = (o[0] === 'human') === !!settings.humans[s];
        sp.textContent = o[1]; lab.appendChild(inp); lab.appendChild(sp); chips.appendChild(lab);
      });
      row.appendChild(dot); row.appendChild(name); row.appendChild(chips); box.appendChild(row);
    });
  }
  function syncMenu() { BK.chipSet($('ld-f-count'), settings.count); BK.chipSet($('ld-f-level'), settings.level); buildSeatRows(); }
  $('ld-new').addEventListener('click', function () { syncMenu(); menu.open(); });
  $('ld-f-count').addEventListener('change', buildSeatRows);
  $('ld-cancel').addEventListener('click', menu.close);
  $('ld-start').addEventListener('click', function () {
    settings.count = +BK.chipValue($('ld-f-count')); settings.level = BK.chipValue($('ld-f-level'));
    Array.prototype.forEach.call($('ld-seats').querySelectorAll('.bg-chips'), function (g) { settings.humans[+g.dataset.seat] = BK.chipValue(g) === 'human'; });
    BK.save(SETTINGS_KEY, settings);
    menu.close(); newGame();
  });
  $('ld-again').addEventListener('click', newGame);
  $('ld-close').addEventListener('click', function () { resultSheet.close(); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input')) return;
    var k = e.key.toLowerCase();
    if (k === 'n') { syncMenu(); menu.open(); }
    else if ((k === 'r' || (e.key === ' ' && e.target === document.body)) && phase === 'roll' && isHuman(state.turn) && !over) { e.preventDefault(); roll(); }
    else if (k >= '1' && k <= '4' && phase === 'move' && isHuman(state.turn)) {
      var mv = legal.filter(function (m) { return m.token === +k - 1; })[0];
      if (mv) choose(mv);
    }
  });

  buildBoard(); paintDie(0);
  newGame();

  if (new URLSearchParams(location.search).has('debug')) {
    root.__ld = { engine: Engine, state: function () { return state; }, settings: settings, phase: function () { return phase; }, die: function () { return die; }, legal: function () { return legal; }, choose: choose, roll: roll };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
