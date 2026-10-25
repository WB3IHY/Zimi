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
  var Play = root.ArcadePlay, $ = Play.$;
  var SETTINGS_KEY = 'zimi.games.echo.settings', BEST_KEY = 'zimi.games.echo.best';
  var NAMES = ['Red circle', 'Blue square', 'Green triangle', 'Gold diamond'], START_DELAY_MS = 700, REPLAY_DELAY_MS = 900, TAP_LIGHT_MS = 240;
  Play.applyTheme();

  var els = { board: $('ec-board'), len: $('ec-len'), best: $('ec-best'), msg: $('ec-msg'), sound: $('ec-sound'), pause: $('ec-pause'), sheet: $('ec-sheet'), title: $('ec-sheet-title'), text: $('ec-sheet-text'), go: $('ec-go'), mode: $('ec-mode') };
  var settings = Play.load(SETTINGS_KEY, { sound: false, strict: false }), best = Play.load(BEST_KEY, { length: 0 });
  var g = createGame(), status = 'idle', timer = null, pads = [], ac = null;

  // ── sound: off unless asked for, made only after a tap ──
  function tone(pad, ms) {
    if (!settings.sound) return;
    try {
      ac = ac || new (root.AudioContext || root.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      var o = ac.createOscillator(), gain = ac.createGain(), t = ac.currentTime, len = ms / 1000;
      o.type = 'sine'; o.frequency.value = FREQ[pad];
      gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(gain); gain.connect(ac.destination); o.start(t); o.stop(t + len + 0.05);
    } catch (e) { /* no audio on this device: play on silently */ }
  }
  function paintSound() { els.sound.setAttribute('aria-pressed', String(settings.sound)); els.sound.textContent = 'Sound: ' + (settings.sound ? 'on' : 'off'); }

  function build() {
    els.board.textContent = '';
    pads = [];
    for (var i = 0; i < PADS; i++) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'ec-pad'; b.dataset.c = i; b.innerHTML = Play.symbolSVG(i, 40);
      b.setAttribute('aria-label', NAMES[i]);
      (function (n) { b.addEventListener('pointerdown', function (e) { if (e.button) return; e.preventDefault(); tap(n); b.focus({ preventScroll: true }); }); b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(n); } }); })(i);
      els.board.appendChild(b); pads.push(b);
    }
  }
  function enable(on) { pads.forEach(function (b) { b.setAttribute('aria-disabled', String(!on)); }); }
  function light(pad, ms) {
    pads[pad].classList.add('on'); tone(pad, ms);
    Play.later(function () { pads[pad].classList.remove('on'); }, ms);
  }
  function hud() { els.len.textContent = g.seq.length; els.best.textContent = best.length; }

  function show() { // play the sequence for the player to watch
    status = 'show'; enable(false); g.pos = 0; els.msg.textContent = 'Watch.'; hud();
    var i = 0, t = timing(g.seq.length);
    function next() {
      if (i >= g.seq.length) { status = 'input'; enable(true); els.msg.textContent = 'Your turn.'; return; }
      light(g.seq[i], t.on);
      i++;
      timer = Play.later(next, t.gap);
    }
    timer = Play.later(next, START_DELAY_MS);
  }

  function tap(pad) {
    if (status !== 'input') return;
    light(pad, TAP_LIGHT_MS);
    var r = press(g, pad);
    if (r === 'ok') return;
    if (r === 'done') {
      if (g.done > best.length) { best.length = g.done; Play.save(BEST_KEY, best); }
      els.msg.textContent = 'Good. ' + g.done + ' in a row.'; status = 'wait'; enable(false);
      extend(g); hud();
      timer = Play.later(show, REPLAY_DELAY_MS);
      return;
    }
    // a slip
    status = 'wait'; enable(false);
    if (settings.strict) { finish(); return; }
    els.msg.textContent = 'Not quite. Watch again.';
    timer = Play.later(show, REPLAY_DELAY_MS + 400);
  }

  function finish() {
    status = 'over'; els.pause.disabled = true;
    var n = Math.max(0, g.seq.length - 1), text = 'You repeated ' + n + (n === 1 ? ' pad.' : ' pads.') + ' Best: ' + best.length + '.';
    els.msg.textContent = text;
    showSheet('Game over', text, 'Play again');
  }

  function paintMode() {
    els.mode.textContent = '';
    [[false, 'Show it again'], [true, 'Game over']].forEach(function (it) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = it[1]; b.setAttribute('aria-pressed', String(settings.strict === it[0]));
      b.addEventListener('click', function () { settings.strict = it[0]; Play.save(SETTINGS_KEY, settings); paintMode(); });
      els.mode.appendChild(b);
    });
  }
  function showSheet(title, text, label) { els.title.textContent = title; els.text.textContent = text; els.go.textContent = label; paintMode(); Play.openSheet(els.sheet, '#ec-go'); }
  function begin() {
    if (timer) timer.cancel();
    g = createGame(); Play.closeSheet(els.sheet); els.pause.disabled = false; hud(); show();
  }
  function pause() {
    if (status === 'idle' || status === 'over' || status === 'paused') return;
    if (timer) timer.cancel();
    pads.forEach(function (b) { b.classList.remove('on'); });
    status = 'paused'; enable(false);
    showSheet('Paused', 'The sequence starts again when you come back.', 'Resume');
  }
  els.go.addEventListener('click', function () { if (status === 'paused') { g.pos = 0; Play.closeSheet(els.sheet); show(); } else begin(); });
  els.pause.addEventListener('click', pause);
  els.sound.addEventListener('click', function () {
    settings.sound = !settings.sound; Play.save(SETTINGS_KEY, settings); paintSound();
    if (settings.sound) tone(0, 260); // a sample note, so the player knows it works
  });
  Play.onHidden(pause);

  var KEY = { 1: 0, 2: 1, 3: 2, 4: 3, q: 0, Q: 0, w: 1, W: 1, a: 2, A: 2, s: 3, S: 3 };
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || !els.sheet.hidden) return;
    if (e.key in KEY) { e.preventDefault(); tap(KEY[e.key]); }
    else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { e.preventDefault(); pause(); }
  });

  build(); paintSound(); hud();
  showSheet('Echo', 'Watch the pads, then repeat them in order. One more each round.', 'Start');
  root.__echo = { get g() { return g; }, get status() { return status; } };
})(this);
