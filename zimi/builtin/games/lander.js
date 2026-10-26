/* ZimiGames: Lander. Our own code, GPL-3.0. No network, no fonts, no modules.
   Thrust and rotate a small lander down onto a flat pad, gently, before the fuel runs out.
   The rules (pure functions, no DOM, so node can test them) and the page (only when there is a document). */
(function (root) {
  'use strict';

  // ── the rules ────────────────────────────────────────────────────────────
  var W = 400, H = 300, STEP = 8, POINTS = W / STEP + 1;       // terrain sampled every 8 px
  var GRAVITY = 17, THRUST = 52, TURN = 2.1, BURN = 14;         // px/s^2, px/s^2, rad/s, fuel per second
  var FUEL_START = 100, FUEL_LESS_PER_LEVEL = 8, FUEL_MIN = 56;
  var MAX_DOWN = 35, MAX_SIDE = 22, MAX_TILT = 0.21;            // what a landing can take
  var FOOT_X = 8, FOOT_Y = 9, START_LIVES = 3;
  var PAD_WIDTHS = [[64, 1], [44, 2], [30, 4]], PAD_SHRINK_PER_LEVEL = 3, PAD_MIN = 18;
  var TOP_LIMIT = -60;

  var mulberry = root.ZimiUtil.mulberry32;

  // The ground: a jagged line across the field with three flat pads of different widths (and pay).
  function makeTerrain(seed, level) {
    var rng = mulberry(seed * 7919 + level * 104729), ys = [], i, y = 200;
    for (i = 0; i < POINTS; i++) { y += (rng() - 0.5) * 38; y = Math.max(150, Math.min(272, y)); ys.push(y); }
    var pads = [], third = Math.floor(POINTS / 3);
    PAD_WIDTHS.forEach(function (pw, k) {
      var width = Math.max(PAD_MIN, pw[0] - PAD_SHRINK_PER_LEVEL * (level - 1)), n = Math.ceil(width / STEP);
      var lo = k * third + 1, hi = (k + 1) * third - n - 1, i0 = lo + Math.floor(rng() * Math.max(1, hi - lo + 1)), py = ys[i0];
      for (var j = 0; j <= n; j++) ys[i0 + j] = py;
      pads.push({ x0: i0 * STEP, x1: (i0 + n) * STEP, y: py, mult: pw[1] });
    });
    return { ys: ys, pads: pads };
  }
  function heightAt(t, x) {
    var f = Math.max(0, Math.min(W, x)) / STEP, i = Math.min(POINTS - 2, Math.floor(f)), u = f - i;
    return t.ys[i] * (1 - u) + t.ys[i + 1] * u;
  }
  function padAt(t, x) {
    for (var i = 0; i < t.pads.length; i++) if (x >= t.pads[i].x0 - 0.01 && x <= t.pads[i].x1 + 0.01) return t.pads[i];
    return null;
  }

  function feet(L) {
    var c = Math.cos(L.a), s = Math.sin(L.a);
    return [[-FOOT_X, FOOT_Y], [FOOT_X, FOOT_Y]].map(function (p) { return { x: L.x + p[0] * c - p[1] * s, y: L.y + p[0] * s + p[1] * c }; });
  }

  function createState(seed, level, score, lives, fuel) {
    seed = seed === undefined ? Math.floor(Math.random() * 100000) : seed; level = level || 1;
    var rng = mulberry(seed + level);
    return { seed: seed, level: level, terrain: makeTerrain(seed, level), score: score || 0, lives: lives === undefined ? START_LIVES : lives, status: 'flying', events: [], message: '', thrusting: false,
      fuel: fuel === undefined ? Math.max(FUEL_MIN, FUEL_START - FUEL_LESS_PER_LEVEL * (level - 1)) : fuel,
      lander: { x: 40 + rng() * (W - 80), y: 34, vx: (rng() - 0.5) * 30, vy: 0, a: 0 }, result: null };
  }

  // Judge a touchdown: {ok, reason, pad}. Both feet must rest on one pad, slow and upright.
  function checkLanding(L, t) {
    var f = feet(L), pad = padAt(t, f[0].x);
    if (!pad || padAt(t, f[1].x) !== pad) return { ok: false, reason: 'off the pad', pad: null };
    if (L.vy > MAX_DOWN) return { ok: false, reason: 'too fast', pad: pad };
    if (Math.abs(L.vx) > MAX_SIDE) return { ok: false, reason: 'too much sideways speed', pad: pad };
    if (Math.abs(L.a) > MAX_TILT) return { ok: false, reason: 'not upright', pad: pad };
    return { ok: true, reason: 'landed', pad: pad };
  }

  function touching(L, t) { return feet(L).some(function (p) { return p.y >= heightAt(t, p.x); }); }

  function landingScore(st, res) {
    var gentle = st.lander.vy < MAX_DOWN / 2 ? 50 : 0;
    return res.pad.mult * (100 + Math.floor(st.fuel)) + gentle;
  }

  function event(st, name, data) { st.events.push({ name: name, data: data }); }

  // Advance by dt seconds. input: {left, right, thrust}.
  function step(st, dt, input) {
    if (st.status !== 'flying') return;
    input = input || {};
    var L = st.lander;
    L.a += ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * TURN * dt;
    L.a = Math.max(-Math.PI, Math.min(Math.PI, L.a));
    st.thrusting = !!input.thrust && st.fuel > 0;
    if (st.thrusting) {
      L.vx += Math.sin(L.a) * THRUST * dt; L.vy -= Math.cos(L.a) * THRUST * dt;
      st.fuel = Math.max(0, st.fuel - BURN * dt);
    }
    L.vy += GRAVITY * dt;
    L.x += L.vx * dt; L.y += L.vy * dt;
    if (L.x < 0) L.x += W; if (L.x > W) L.x -= W;
    if (L.y < TOP_LIMIT) { L.y = TOP_LIMIT; if (L.vy < 0) L.vy = 0; }
    if (!touching(L, st.terrain)) return;
    var res = checkLanding(L, st.terrain);
    st.result = res;
    if (res.ok) {
      var pts = landingScore(st, res);
      st.score += pts; st.status = 'landed'; L.vx = L.vy = 0; st.thrusting = false;
      st.message = 'Landed on the ×' + res.pad.mult + ' pad: ' + pts + ' points.';
      event(st, 'landed', pts);
    } else {
      st.lives--; st.status = 'crashed'; st.thrusting = false;
      st.message = 'Crashed: ' + res.reason + '.';
      event(st, 'crashed', res.reason);
    }
  }

  // Next lander: after a landing, the next level; after a crash, the same ground again with a fresh tank.
  function next(st) {
    if (st.status === 'landed') return createState(st.seed + 1, st.level + 1, st.score, st.lives);
    return createState(st.seed, st.level, st.score, st.lives);
  }

  var Engine = { W: W, H: H, STEP: STEP, MAX_DOWN: MAX_DOWN, MAX_SIDE: MAX_SIDE, MAX_TILT: MAX_TILT, GRAVITY: GRAVITY, THRUST: THRUST, BURN: BURN, FUEL_START: FUEL_START, makeTerrain: makeTerrain, heightAt: heightAt, padAt: padAt, feet: feet, createState: createState, checkLanding: checkLanding, step: step, next: next, touching: touching, landingScore: landingScore, START_LIVES: START_LIVES };
  root.LanderEngine = Engine;

  if (typeof document === 'undefined') return;

  // ── the page ─────────────────────────────────────────────────────────────
  var Play = root.ArcadePlay, $ = Play.$, T = Play.T;
  var BEST_KEY = 'zimi.games.lander.best', CHROME_PX = 190, READY_ARM_MS = 650;
  Play.applyTheme();

  var els = { cv: $('ld2-board'), fuel: $('ld2-fuel'), vy: $('ld2-vy'), vx: $('ld2-vx'), lives: $('ld2-lives'), msg: $('ld2-msg'), pause: $('ld2-pause'), newBtn: $('ld2-new') };
  var best = Play.load(BEST_KEY, { score: 0 }), st = createState(1), runId = 0, mode = 'ready', ctx, status = Play.status(els.msg), armed = null, pad;
  var held = { left: false, right: false, thrust: false }, keyHeld = { left: false, right: false, thrust: false };
  var stars = (function () { var r = mulberry(11), a = []; for (var i = 0; i < 60; i++) a.push([r() * W, r() * 200, 0.6 + r() * 0.9, 0.2 + r() * 0.5]); return a; })();

  function layout() { ctx = Play.fitCanvas(els.cv, W, H, CHROME_PX, 640).ctx; draw(); }
  function speedText(v, limit) { var n = Math.round(Math.abs(v)); return n + (Math.abs(v) > limit ? '!' : ''); }
  function hud() {
    var L = st.lander;
    els.fuel.textContent = Play.num(Math.round(st.fuel)); els.lives.textContent = Play.num(Math.max(0, st.lives));
    els.vy.textContent = (L.vy < 0 ? '↑' : '') + speedText(L.vy, MAX_DOWN); els.vx.textContent = speedText(L.vx, MAX_SIDE);
  }
  function input() { return { left: held.left || keyHeld.left, right: held.right || keyHeld.right, thrust: held.thrust || keyHeld.thrust }; }

  var loop = Play.loop(function (dt) {
    step(st, dt, input());
    if (st.status !== 'flying') { st.events.length = 0; settle(); }
  }, function () { draw(); hud(); }, 60);

  function drawLander() {
    var L = st.lander;
    ctx.save(); ctx.translate(L.x, L.y); ctx.rotate(L.a);
    if (st.thrusting) { ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.moveTo(-4, 6); ctx.lineTo(0, 15 + Math.random() * 6); ctx.lineTo(4, 6); ctx.closePath(); ctx.fill(); }
    ctx.strokeStyle = '#e8e8ed'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-5, 4); ctx.lineTo(-FOOT_X, FOOT_Y); ctx.moveTo(5, 4); ctx.lineTo(FOOT_X, FOOT_Y); ctx.moveTo(-FOOT_X - 3, FOOT_Y); ctx.lineTo(-FOOT_X + 3, FOOT_Y); ctx.moveTo(FOOT_X - 3, FOOT_Y); ctx.lineTo(FOOT_X + 3, FOOT_Y); ctx.stroke();
    ctx.fillStyle = '#c8c6be'; ctx.beginPath(); ctx.moveTo(-6, 5); ctx.lineTo(-8, -2); ctx.lineTo(-4, -8); ctx.lineTo(4, -8); ctx.lineTo(8, -2); ctx.lineTo(6, 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3fc1e8'; ctx.beginPath(); ctx.arc(0, -3, 3.2, 0, 7); ctx.fill();
    ctx.restore();
  }
  function draw() {
    if (!ctx) return;
    var t = st.terrain, i;
    ctx.fillStyle = '#0e0e10'; ctx.fillRect(0, 0, W, H);
    stars.forEach(function (s) { ctx.fillStyle = 'rgba(255,255,255,' + s[3] + ')'; ctx.fillRect(s[0], s[1], s[2], s[2]); });
    ctx.beginPath(); ctx.moveTo(0, H);
    for (i = 0; i < POINTS; i++) ctx.lineTo(i * STEP, t.ys[i]);
    ctx.lineTo(W, H); ctx.closePath();
    ctx.fillStyle = '#2c2c30'; ctx.fill(); ctx.strokeStyle = '#8a8a94'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    t.pads.forEach(function (p) {
      ctx.fillStyle = '#f2a516'; ctx.fillRect(p.x0, p.y - 2, p.x1 - p.x0, 4);
      ctx.fillStyle = '#ffe3a3'; ctx.fillText('×' + p.mult, (p.x0 + p.x1) / 2, p.y + 16);
    });
    if (st.status !== 'crashed') drawLander();
    else {
      var L = st.lander; ctx.strokeStyle = '#ff7a6b'; ctx.lineWidth = 2;
      for (i = 0; i < 8; i++) { var a = i * 0.785 + 0.3; ctx.beginPath(); ctx.moveTo(L.x + Math.cos(a) * 5, L.y + Math.sin(a) * 5); ctx.lineTo(L.x + Math.cos(a) * 15, L.y + Math.sin(a) * 15); ctx.stroke(); }
    }
  }

  function clearHeld() { Object.keys(held).forEach(function (k) { held[k] = false; keyHeld[k] = false; }); if (pad) pad.release(); }
  var CRASH_IDS = { 'off the pad': 'lander.crashed.off', 'too fast': 'lander.crashed.fast', 'too much sideways speed': 'lander.crashed.side', 'not upright': 'lander.crashed.tilt' };
  function resultText() {
    return st.status === 'landed' ? T('lander.landed', { mult: st.result.pad.mult, n: landingScore(st, st.result) }) : T(CRASH_IDS[st.result.reason]);
  }
  // The ready line: a tap or a key starts. Armed again after a game, once the end sheet is up.
  function arm(touch, keysText, start) {
    if (armed) armed.cancel();
    armed = Play.ready({ say: status.say, target: pad.stage, start: start || begin, touch: touch || T('lander.readyTouch'), keys: keysText || T('lander.readyKeys') });
  }
  function begin() {
    if (armed) armed.cancel();
    st = createState(Math.floor(Math.random() * 100000)); runId = Play.runId(); mode = 'playing'; status.say(''); clearHeld();
    Play.pauseLabel(els.pause, false); els.pause.disabled = false; hud(); draw(); loop.start();
  }
  // After a landing or a crash: show it, then wait for the next lander (or end the game).
  function settle() {
    loop.stop(); clearHeld(); hud(); draw();
    status.say(resultText());
    if (st.score > best.score) { best.score = st.score; Play.save(BEST_KEY, best); }
    if (st.status === 'crashed' && st.lives <= 0) {
      mode = 'over'; els.pause.disabled = true; showEnd();
    } else {
      mode = 'between';
      setTimeout(function () { if (mode === 'between') arm(T('lander.nextTouch'), T('lander.nextKeys'), proceed); }, READY_ARM_MS);
    }
  }
  function showEnd() {
    ZimiShell.endSheet({ result: 'over', stats: [[T('play.score'), Play.num(st.score)], [T('play.best'), Play.num(best.score)]] });
    setTimeout(function () { if (mode === 'over') arm(); }, READY_ARM_MS);
  }
  function proceed() { st = next(st); mode = 'playing'; status.say(''); hud(); draw(); loop.start(); }
  function pause() { if (mode !== 'playing') return; mode = 'paused'; loop.stop(); clearHeld(); Play.pauseLabel(els.pause, true); status.say(T('play.paused')); }
  function resume() { if (mode !== 'paused') return; mode = 'playing'; Play.pauseLabel(els.pause, false); status.say(''); loop.start(); }
  function toggle() { if (mode === 'playing') pause(); else resume(); }
  els.newBtn.addEventListener('click', begin);
  els.pause.addEventListener('click', toggle);
  els.cv.addEventListener('pointerdown', function () { if (mode === 'paused') resume(); });
  Play.onHidden(pause);
  ZimiShell.game({
    inProgress: function () { return mode === 'playing' || mode === 'paused' || mode === 'between'; },
    stats: function () { return best.score ? [[T('play.best'), Play.num(best.score)]] : []; }
  });

  pad = Play.pad(els.cv, { dirs: ['left', 'right'], actions: [{ name: 'thrust', label: T('play.thrust') }], on: function (name, down) { held[name] = down; } });
  var KEY = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'thrust', w: 'thrust', W: 'thrust', ' ': 'thrust' };
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.ar-sheet:not([hidden])')) return;
    var k = KEY[e.key];
    if (k) { e.preventDefault(); keyHeld[k] = true; }
    else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { e.preventDefault(); if (mode === 'playing' || mode === 'paused') toggle(); }
  });
  document.addEventListener('keyup', function (e) { var k = KEY[e.key]; if (k) keyHeld[k] = false; });
  window.addEventListener('blur', clearHeld);

  window.addEventListener('resize', layout);
  layout(); hud(); arm();
  // A run in progress or over is kept (the ground is rebuilt from its seed); it comes back paused, or on its end sheet.
  function snapshot() {
    if (mode === 'ready') return null;
    var s = Play.plain(st); delete s.terrain;
    return { runId: runId, over: mode === 'over', between: mode === 'between', st: s };
  }
  function restore(d) {
    if (!d || !d.st) return false;
    if (armed) { armed.cancel(); armed = null; }
    st = Play.overlay(createState(d.st.seed, d.st.level), d.st); st.events = []; runId = d.runId;
    if (d.between) st = next(st);   // after a landing or a crash the next lander waits, paused
    hud(); draw();
    if (d.over) { mode = 'over'; els.pause.disabled = true; setTimeout(showEnd, 0); return true; }
    mode = 'paused'; els.pause.disabled = false; Play.pauseLabel(els.pause, true); status.say(T('play.paused'));
    return true;
  }
  ZimiShell.persist({ save: snapshot, load: restore });
  root.__lander = { get st() { return st; }, get mode() { return mode; }, get pos() { return JSON.stringify([runId, st.seed, st.level, st.score, st.lives, st.fuel, st.lander]); } };
})(this);
