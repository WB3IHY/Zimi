/* ZimiGames: Snake. Our own code, GPL-3.0. No network, no fonts, no modules.
   The rules (pure functions, no DOM, so node can test them) and the page (only when there is a document). */
(function (root) {
  'use strict';

  // ── the rules ────────────────────────────────────────────────────────────
  var COLS = 20, ROWS = 20, START_LENGTH = 3, QUEUE_MAX = 2;
  var STEP_START_MS = 150, STEP_MIN_MS = 60, STEP_FASTER_MS = 3; // each apple takes 3 ms off a step
  var DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  var mulberry32 = root.ZimiUtil.mulberry32;

  function placeFood(g) {
    var free = [];
    for (var y = 0; y < g.rows; y++) {
      for (var x = 0; x < g.cols; x++) free.push([x, y]);
    }
    g.snake.forEach(function (s) { free[s[1] * g.cols + s[0]] = null; });
    free = free.filter(Boolean);
    if (!free.length) { g.food = null; return; }
    g.food = free[Math.floor(g.rng() * free.length)];
  }

  // The snake starts in the middle heading right, head first in the list.
  function createGame(cols, rows, wrap, seed) {
    var g = {
      cols: cols || COLS, rows: rows || ROWS, wrap: !!wrap, snake: [], dir: 'right', queue: [],
      score: 0, status: 'ready', food: null,
      rng: mulberry32(seed === undefined ? Math.floor(Math.random() * 4294967296) : seed)
    };
    var y = Math.floor(g.rows / 2), x = Math.floor(g.cols / 2);
    for (var i = 0; i < START_LENGTH; i++) g.snake.push([x - i, y]);
    placeFood(g);
    return g;
  }

  function opposite(a, b) { return DIRS[a][0] + DIRS[b][0] === 0 && DIRS[a][1] + DIRS[b][1] === 0; }

  // Queue a turn: ignores a reversal and a repeat, so two quick swipes both count
  // and a fast U-turn cannot fold the snake into itself.
  function turn(g, name) {
    if (!DIRS[name]) return false;
    var from = g.queue.length ? g.queue[g.queue.length - 1] : g.dir;
    if (name === from || opposite(name, from) || g.queue.length >= QUEUE_MAX) return false;
    g.queue.push(name);
    return true;
  }

  function wrapTo(v, n) { return (v % n + n) % n; }

  // One step. Returns 'moved', 'ate', 'dead' or 'won'.
  function step(g) {
    if (g.status === 'over') return 'dead';
    g.status = 'playing';
    if (g.queue.length) g.dir = g.queue.shift();
    var d = DIRS[g.dir], head = g.snake[0], nx = head[0] + d[0], ny = head[1] + d[1];
    if (g.wrap) { nx = wrapTo(nx, g.cols); ny = wrapTo(ny, g.rows); }
    else if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) { g.status = 'over'; return 'dead'; }
    var eats = !!g.food && g.food[0] === nx && g.food[1] === ny;
    // The tail leaves its cell on this step unless the snake grows, so it is safe to enter.
    var body = eats ? g.snake : g.snake.slice(0, -1);
    for (var i = 0; i < body.length; i++) {
      if (body[i][0] === nx && body[i][1] === ny) { g.status = 'over'; return 'dead'; }
    }
    g.snake.unshift([nx, ny]);
    if (!eats) { g.snake.pop(); return 'moved'; }
    g.score++;
    placeFood(g);
    if (!g.food) { g.status = 'over'; return 'won'; }
    return 'ate';
  }

  function stepMs(g) { return Math.max(STEP_MIN_MS, STEP_START_MS - STEP_FASTER_MS * g.score); }

  var Engine = { COLS: COLS, ROWS: ROWS, DIRS: DIRS, createGame: createGame, turn: turn, step: step, stepMs: stepMs, placeFood: placeFood };
  root.SnakeEngine = Engine;

  if (typeof document === 'undefined') return;

  // ── the page ─────────────────────────────────────────────────────────────
  var Play = root.ArcadePlay, $ = Play.$, T = Play.T;
  var SWIPE_PX = 22, MAX_BOARD = 560, CHROME_PX = 120, READY_ARM_MS = 650;
  var SETTINGS_KEY = 'zimi.games.snake.settings', BEST_KEY = 'zimi.games.snake.best';
  Play.applyTheme();

  var els = { cv: $('sn-board'), stat: $('sn-stat'), msg: $('sn-msg'), pause: $('sn-pause'), newBtn: $('sn-new') };
  var ctx = els.cv.getContext('2d'), status = Play.status(els.msg);
  var settings = Play.load(SETTINGS_KEY, { wrap: false }), best = Play.load(BEST_KEY, {});
  var g, cs = 18, mode = 'ready', last = 0, acc = 0, pal = {}, armed = null;
  function modeKey() { return settings.wrap ? 'wrap' : 'walls'; }

  function readPalette() {
    var s = getComputedStyle(document.documentElement);
    function v(n) { return s.getPropertyValue(n).trim(); }
    pal = { a: v('--cell'), b: v('--cell-line'), head: v('--p-s'), tail: v('--p-i'), food: v('--p-z'), leaf: v('--ok'), eye: v('--surface'), ink: v('--ink') };
  }
  function layout() {
    var room = Play.room(CHROME_PX);
    cs = Math.max(12, Math.floor(Math.min(room.w, room.h, MAX_BOARD) / COLS));
    var dpr = window.devicePixelRatio || 1, px = cs * COLS;
    els.cv.width = px * dpr; els.cv.height = px * dpr; els.cv.style.width = px + 'px'; els.cv.style.height = px + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function mix(c1, c2, t) { // colours as #rrggbb, blended
    function p(c) { return [1, 3, 5].map(function (i) { return parseInt(c.substr(i, 2), 16); }); }
    var a = p(c1), b = p(c2);
    return 'rgb(' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * t); }).join(',') + ')';
  }

  function draw() {
    if (!g) return;
    var n = g.cols;
    for (var y = 0; y < g.rows; y++) for (var x = 0; x < n; x++) { ctx.fillStyle = (x + y) % 2 ? pal.a : pal.b; ctx.fillRect(x * cs, y * cs, cs, cs); }
    if (g.wrap) { ctx.strokeStyle = pal.tail; ctx.globalAlpha = 0.5; ctx.setLineDash([4, 4]); ctx.strokeRect(1, 1, cs * n - 2, cs * g.rows - 2); ctx.setLineDash([]); ctx.globalAlpha = 1; }
    if (g.food) {
      var fx = g.food[0] * cs + cs / 2, fy = g.food[1] * cs + cs / 2;
      ctx.fillStyle = pal.food; ctx.beginPath(); ctx.arc(fx, fy + 1, cs * 0.38, 0, 7); ctx.fill();
      ctx.fillStyle = pal.leaf; ctx.beginPath(); ctx.ellipse(fx + cs * 0.12, fy - cs * 0.34, cs * 0.18, cs * 0.09, -0.5, 0, 7); ctx.fill();
    }
    var len = g.snake.length;
    for (var i = len - 1; i >= 0; i--) {
      var s = g.snake[i], pad = cs * 0.08;
      ctx.fillStyle = mix(pal.head, pal.tail, len > 1 ? i / (len - 1) : 0);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(s[0] * cs + pad, s[1] * cs + pad, cs - 2 * pad, cs - 2 * pad, cs * 0.3); else ctx.rect(s[0] * cs + pad, s[1] * cs + pad, cs - 2 * pad, cs - 2 * pad);
      ctx.fill();
    }
    var h = g.snake[0], d = DIRS[g.dir], px = -d[1], py = d[0];
    ctx.fillStyle = pal.eye;
    [-1, 1].forEach(function (side) {
      ctx.beginPath();
      ctx.arc(h[0] * cs + cs / 2 + d[0] * cs * 0.16 + px * side * cs * 0.2, h[1] * cs + cs / 2 + d[1] * cs * 0.16 + py * side * cs * 0.2, cs * 0.1, 0, 7);
      ctx.fill();
    });
  }

  // The bar's one stat: the apples this game and the best, "3 · Best 12".
  function hud() { els.stat.textContent = Play.num(g.score) + ' \u00b7 ' + T('play.best') + ' ' + Play.num(Math.max(best[modeKey()] || 0, g.score)); }

  function frame(t) {
    if (mode !== 'playing') return;
    acc += Math.min(200, t - last); last = t;
    var ms = stepMs(g), res;
    while (acc >= ms && mode === 'playing') {
      acc -= ms; res = step(g);
      if (res === 'dead' || res === 'won') { draw(); hud(); return finish(res === 'won'); }
    }
    draw(); hud();
    requestAnimationFrame(frame);
  }
  function startLoop() { last = performance.now(); requestAnimationFrame(frame); }

  // The ready line says the gesture once; a tap or a key starts. Armed again after a game, once the end sheet is up.
  function arm() {
    if (armed) armed.cancel();
    armed = Play.ready({ say: status.say, target: els.cv, start: begin, touch: T('snake.readyTouch'), keys: T('snake.readyKeys') });
  }
  function begin() {
    if (armed) armed.cancel();
    g = createGame(COLS, ROWS, settings.wrap); acc = 0; mode = 'playing'; status.say('');
    Play.pauseLabel(els.pause, false); els.pause.disabled = false; hud(); draw(); startLoop();
  }
  function pause() { if (mode !== 'playing') return; mode = 'paused'; Play.pauseLabel(els.pause, true); status.say(T('play.paused')); }
  function resume() { if (mode !== 'paused') return; mode = 'playing'; Play.pauseLabel(els.pause, false); status.say(''); startLoop(); }
  function toggle() { if (mode === 'playing') pause(); else resume(); }
  function showEnd(won) {
    var k = modeKey();
    ZimiShell.endSheet({ result: won ? 'win' : 'over', stats: [[T('snake.apples'), Play.num(g.score)], [T('play.best'), Play.num(best[k] || 0)]] });
    setTimeout(function () { if (mode === 'over') arm(); }, READY_ARM_MS);
  }
  function finish(won) {
    mode = 'over'; els.pause.disabled = true; Play.pauseLabel(els.pause, false);
    var k = modeKey();
    if (g.score > (best[k] || 0)) { best[k] = g.score; Play.save(BEST_KEY, best); }
    hud();
    showEnd(won);
  }
  els.newBtn.addEventListener('click', begin);
  els.pause.addEventListener('click', toggle);
  els.cv.addEventListener('pointerdown', function () { if (mode === 'paused') resume(); });
  Play.onHidden(pause);
  ZimiShell.game({
    inProgress: function () { return mode === 'playing' || mode === 'paused'; },
    stats: function () { return [[T('snake.bestWalls'), Play.num(best.walls || 0)], [T('snake.bestWrap'), Play.num(best.wrap || 0)]]; },
    // Edges are a choice about the game, so they sit in the New game pane; the page takes them when it starts.
    menu: function () {
      return { options: [Play.optionRow(T('snake.wrap'), [[false, T('shell.off')], [true, T('shell.on')]], !!settings.wrap, function (v) { settings.wrap = v; Play.save(SETTINGS_KEY, settings); })] };
    }
  });

  var KEY_DIR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', a: 'left', s: 'down', d: 'right', W: 'up', A: 'left', S: 'down', D: 'right' };
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.ar-sheet:not([hidden])')) return;
    var dir = KEY_DIR[e.key];
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P' || e.key === ' ') {
      e.preventDefault();
      if (mode === 'playing' || mode === 'paused') toggle();
    } else if (dir) {
      e.preventDefault();
      if (mode === 'playing') turn(g, dir);
    }
  });

  var doneX = 0, doneY = 0;
  Play.gesture(els.cv, {
    down: function () { doneX = 0; doneY = 0; },
    drag: function (dx, dy) {
      if (mode !== 'playing') return;
      var dir = Play.swipeDir(dx - doneX, dy - doneY, SWIPE_PX);
      if (dir) { turn(g, dir); doneX = dx; doneY = dy; }
    }
  });

  // A game in progress or over is kept; it comes back paused, or on its end sheet.
  function snapshot() {
    if (mode === 'ready') return null;
    return { over: mode === 'over', g: Play.plain(g) };
  }
  function restore(d) {
    if (!d || !d.g || !d.g.snake) return false;
    g = Play.overlay(createGame(d.g.cols, d.g.rows, d.g.wrap), d.g); acc = 0;
    if (armed) { armed.cancel(); armed = null; }
    hud(); draw();
    if (d.over) { mode = 'over'; els.pause.disabled = true; setTimeout(function () { showEnd(g.snake.length >= g.cols * g.rows); }, 0); return true; }
    mode = 'paused'; els.pause.disabled = false; Play.pauseLabel(els.pause, true); status.say(T('play.paused'));
    return true;
  }

  readPalette();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { readPalette(); draw(); });
  window.addEventListener('resize', layout);
  g = createGame(COLS, ROWS, settings.wrap);
  hud();
  layout();
  arm();
  ZimiShell.persist({ save: snapshot, load: restore });
  // A read-only window onto the live game, for the browser tests.
  root.__snake = { get g() { return g; }, get mode() { return mode; }, get pos() { return JSON.stringify([g.snake, g.dir, g.food, g.score, g.wrap]); } };
})(this);
