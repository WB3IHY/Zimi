/* ZimiGames: Echo. Our own code, GPL-3.0. No network, no fonts, no modules.
   Repeat a growing sequence of pads. Tones come from WebAudio only when the player has turned Sound on.
   The rules (pure functions, no DOM, so node can test them) and the page (only when there is a document). */
(function (root) {
  'use strict';

  // ── the rules ────────────────────────────────────────────────────────────
  var PADS = 4, FREQ = [261.63, 329.63, 392.0, 523.25]; // C, E, G and the C above

  function mulberry(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function createGame(seed) {
    var g = { seq: [], pos: 0, rng: mulberry(seed === undefined ? Math.floor(Math.random() * 4294967296) : seed), done: 0 };
    extend(g);
    return g;
  }
  function extend(g) { g.seq.push(Math.floor(g.rng() * PADS)); g.pos = 0; return g.seq.length; }

  // The player taps a pad: 'ok' (right, more to go), 'done' (the whole sequence is right) or 'wrong'.
  function press(g, pad) {
    if (pad !== g.seq[g.pos]) { g.pos = 0; return 'wrong'; }
    g.pos++;
    if (g.pos === g.seq.length) { g.pos = 0; g.done = g.seq.length; return 'done'; }
    return 'ok';
  }
  // How long a pad is lit and how long the gap is, in ms: quicker as the sequence grows.
  function timing(length) {
    var gap = Math.max(240, 620 - 22 * length);
    return { on: Math.round(gap * 0.62), gap: gap };
  }

  var Engine = { PADS: PADS, FREQ: FREQ, createGame: createGame, extend: extend, press: press, timing: timing };
  root.EchoEngine = Engine;

  if (typeof document === 'undefined') return;

  // ── the page ─────────────────────────────────────────────────────────────
  var Play = root.ArcadePlay, $ = Play.$, T = Play.T;
  var SETTINGS_KEY = 'zimi.games.echo.settings', BEST_KEY = 'zimi.games.echo.best';
  var START_DELAY_MS = 700, REPLAY_DELAY_MS = 900, TAP_LIGHT_MS = 240, READY_ARM_MS = 650;
  Play.applyTheme();

  var els = { board: $('ec-board'), len: $('ec-len'), best: $('ec-best'), msg: $('ec-msg'), pause: $('ec-pause'), nu: $('ec-new') };
  var line = Play.status(els.msg);
  var settings = Play.load(SETTINGS_KEY, { strict: false }), best = Play.load(BEST_KEY, { length: 0 });
  var g = createGame(), status = 'idle', timer = null, pads = [], ac = null, armed = null;

  // ── sound: off unless asked for in Settings, made only after a tap ──
  function tone(pad, ms) {
    if (!ZimiShell.sound()) return;
    try {
      ac = ac || new (root.AudioContext || root.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      var o = ac.createOscillator(), gain = ac.createGain(), t = ac.currentTime, len = ms / 1000;
      o.type = 'sine'; o.frequency.value = FREQ[pad];
      gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(gain); gain.connect(ac.destination); o.start(t); o.stop(t + len + 0.05);
    } catch (e) { /* no audio on this device: play on silently */ }
  }

  function build() {
    els.board.textContent = '';
    pads = [];
    for (var i = 0; i < PADS; i++) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'ec-pad'; b.dataset.c = i; b.innerHTML = Play.symbolSVG(i, 40);
      b.setAttribute('aria-label', T('echo.pad.' + i));
      (function (n) { b.addEventListener('pointerdown', function (e) { if (e.button) return; e.preventDefault(); tap(n); b.focus({ preventScroll: true }); }); b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(n); } }); })(i);
      els.board.appendChild(b); pads.push(b);
    }
  }
  function enable(on) { pads.forEach(function (b) { b.setAttribute('aria-disabled', String(!on)); }); }
  function light(pad, ms) {
    pads[pad].classList.add('on'); tone(pad, ms);
    Play.later(function () { pads[pad].classList.remove('on'); }, ms);
  }
  function hud() { els.len.textContent = Play.num(Math.max(0, g.seq.length - (status === 'idle' || status === 'over' ? 1 : 0))); els.best.textContent = Play.num(best.length); }

  function show() { // play the sequence for the player to watch
    status = 'show'; enable(false); g.pos = 0; line.say(T('echo.watch')); hud();
    var i = 0, t = timing(g.seq.length);
    function next() {
      if (i >= g.seq.length) { status = 'input'; enable(true); line.say(T('echo.yourTurn')); return; }
      light(g.seq[i], t.on);
      i++;
      timer = Play.later(next, t.gap);
    }
    timer = Play.later(next, START_DELAY_MS);
  }

  function tap(pad) {
    if (status !== 'input') { if (status === 'show' || status === 'wait') ZimiShell.shake(els.board); return; }
    light(pad, TAP_LIGHT_MS);
    var r = press(g, pad);
    if (r === 'ok') return;
    if (r === 'done') {
      if (g.done > best.length) { best.length = g.done; Play.save(BEST_KEY, best); }
      line.say(T('echo.good', { n: g.done })); status = 'wait'; enable(false);
      extend(g); hud();
      timer = Play.later(show, REPLAY_DELAY_MS);
      return;
    }
    // a slip
    status = 'wait'; enable(false);
    if (settings.strict) { finish(); return; }
    line.say(T('echo.slip'));
    timer = Play.later(show, REPLAY_DELAY_MS + 400);
  }

  function finish() {
    status = 'over'; els.pause.disabled = true; Play.pauseLabel(els.pause, false);
    var n = Math.max(0, g.seq.length - 1);
    hud(); line.say('');
    ZimiShell.endSheet({ result: 'over', stats: [[T('echo.length'), Play.num(n)], [T('play.best'), Play.num(best.length)]] });
    setTimeout(function () { if (status === 'over') arm(); }, READY_ARM_MS);
  }

  function arm() {
    if (armed) armed.cancel();
    armed = Play.ready({ say: line.say, target: els.board, start: begin });
  }
  function begin() {
    if (armed) armed.cancel();
    if (timer) timer.cancel();
    g = createGame(); Play.pauseLabel(els.pause, false); els.pause.disabled = false; hud(); show();
  }
  function pause() {
    if (status === 'idle' || status === 'over' || status === 'paused') return;
    if (timer) timer.cancel();
    pads.forEach(function (b) { b.classList.remove('on'); });
    status = 'paused'; enable(false); Play.pauseLabel(els.pause, true); line.say(T('play.paused'));
  }
  function resume() { if (status !== 'paused') return; g.pos = 0; Play.pauseLabel(els.pause, false); show(); }
  els.nu.addEventListener('click', begin);
  els.pause.addEventListener('click', function () { if (status === 'paused') resume(); else pause(); });
  Play.onHidden(pause);
  ZimiShell.game({
    sound: true,
    inProgress: function () { return status === 'show' || status === 'input' || status === 'wait' || status === 'paused'; },
    stats: function () { return [[T('echo.longest'), Play.num(best.length)]]; },
    // What happens on a slip is a choice about the game, so it sits in the New game pane.
    menu: function () {
      return { options: [Play.optionRow(T('echo.onSlip'), [[false, T('echo.showAgain')], [true, T('shell.end.over')]], !!settings.strict, function (v) { settings.strict = v; Play.save(SETTINGS_KEY, settings); })] };
    }
  });

  var KEY = { 1: 0, 2: 1, 3: 2, 4: 3, q: 0, Q: 0, w: 1, W: 1, a: 2, A: 2, s: 3, S: 3 };
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.ar-sheet:not([hidden])')) return;
    if (e.key in KEY) { e.preventDefault(); tap(KEY[e.key]); }
    else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { e.preventDefault(); if (status === 'paused') resume(); else pause(); }
  });

  // Leaving keeps the sequence; it comes back paused (a tap or Resume plays it again). A finished game comes back to its end sheet.
  function kept() {
    if (status === 'idle') return null;
    return { seq: g.seq.slice(), over: status === 'over', strict: !!settings.strict };
  }
  function takeUp(d) {
    if (!d || !Array.isArray(d.seq) || !d.seq.length || d.seq.some(function (p) { return !(p >= 0 && p < PADS); })) return false;
    if (armed) armed.cancel();
    if (timer) timer.cancel();
    g = createGame(); g.seq = d.seq.slice(); g.pos = 0;
    if (d.over) { status = 'over'; finish(); return true; }
    els.pause.disabled = false; status = 'wait'; hud(); pause();
    return true;
  }
  build(); hud();
  arm();
  ZimiShell.persist({ save: kept, load: takeUp });
  root.__echo = { get g() { return g; }, get status() { return status; } };
})(this);
