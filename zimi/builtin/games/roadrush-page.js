/* ZimiGames: Road Rush, the page: the projected road drawn strip by strip, sprites, input, the clock and the sheets.
   The rules are in roadrush.js (RoadRushEngine) and the pictures in roadrush-art.js. Our own code, GPL-3.0. */
(function (root) {
  'use strict';
  var E = root.RoadRushEngine, Art = root.RoadRushArt, Play = root.ArcadePlay, $ = Play.$;
  var SEG = E.SEG, ROAD_W = E.ROAD_W, CAM_H = E.CAM_H, CAM_DEPTH = E.CAM_DEPTH, PLAYER_Z = E.PLAYER_Z, DRAW = E.DRAW, LANES = E.LANES, MAX_SPEED = E.MAX_SPEED;
  var STORE = 'zimi.games.roadrush', FOG_DENSITY = 5, MAX_RES = 1.25, COUNTDOWN_S = 3, TOAST_S = 2.4, CAR_VIS = 1.1, SCENE_VIS = 1.4, PLAYER_DRAW_W = E.PLAYER_W * CAR_VIS;
  var HILL_RATE = [14, 30], SUN_R = 0.07, STARS = 70;
  Play.applyTheme();

  var prefs = Play.load(STORE, {});
  prefs = { best: prefs.best || 0, stage: prefs.stage || 0, auto: prefs.auto };
  var coarse = false;
  try { coarse = matchMedia('(pointer: coarse)').matches; } catch (e) { /* desktop */ }
  if (prefs.auto === undefined) prefs.auto = coarse;
  function savePrefs() { Play.save(STORE, prefs); }
  if (coarse || 'ontouchstart' in root) document.body.classList.add('touch');
  document.addEventListener('touchstart', function () { document.body.classList.add('touch'); layout(); }, { once: true, passive: true });
  function syncAuto() { document.body.classList.toggle('rr-auto', !!prefs.auto); }

  var els = { cv: $('rr-board'), speed: $('rr-speed'), time: $('rr-time'), score: $('rr-score'), best: $('rr-best'), msg: $('rr-msg'), pause: $('rr-pause'),
    sheet: $('rr-sheet'), title: $('rr-sheet-title'), body: $('rr-body'), actions: $('rr-actions'), gas: $('rr-gas'), brake: $('rr-brake') };
  var ctx, cssW = 0, cssH = 0, res = 1, reduce = Play.reducedMotion();
  var game = null, mode = 'setup', countdown = 0, toast = '', toastT = 0, tables = {}, stars = [], bg = [0, 0], skyGrad = null, skyTheme = '', crashFlash = 0, wasBraking = false;
  var held = {}, pad = { gas: false, brake: false }, touchSteer = {};

  // ── the picture ──────────────────────────────────────────────────────────
  function poly4(x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill();
  }
  function table(theme) { return tables[theme] || (tables[theme] = Art.table(Art.PALETTES[theme], DRAW, FOG_DENSITY)); }

  function drawSky(pal, theme, w, h) {
    if (skyTheme !== theme || !skyGrad || skyGrad.h !== h) {
      var gr = ctx.createLinearGradient(0, 0, 0, h / 2); gr.addColorStop(0, pal.skyTop); gr.addColorStop(1, pal.skyBot);
      skyGrad = { g: gr, h: h }; skyTheme = theme;
    }
    ctx.fillStyle = skyGrad.g; ctx.fillRect(0, 0, w, h / 2 + 2);
    if (pal.stars) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; stars.forEach(function (s) { ctx.fillRect(s[0] * w, s[1] * h * 0.45, s[2], s[2]); }); }
    ctx.fillStyle = pal.sun; ctx.globalAlpha = pal.stars ? 1 : 0.9;
    ctx.beginPath(); ctx.arc(pal.sunAt[0] * w, pal.sunAt[1] * h / 2, SUN_R * w, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    Art.hills(ctx, w, h / 2, h * 0.16, 1.3, bg[0], pal.far);
    Art.hills(ctx, w, h / 2, h * 0.09, 4.1, bg[1], pal.near);
  }

  function segmentStrip(row, x1, y1, w1, x2, y2, w2, shade, w) {
    ctx.fillStyle = shade ? row.grassD : row.grassL; ctx.fillRect(0, y2, w, y1 - y2);
    var r1 = w1 / Math.max(6, 2 * LANES), r2 = w2 / Math.max(6, 2 * LANES), rc = shade ? row.rumbleB : row.rumbleA;
    poly4(x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, rc);
    poly4(x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, rc);
    poly4(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, shade ? row.roadD : row.roadL);
    if (!shade) {
      var lw1 = w1 / 32, lw2 = w2 / 32, lx1 = x1 - w1 + w1 * 2 / LANES, lx2 = x2 - w2 + w2 * 2 / LANES;
      for (var l = 1; l < LANES; l++, lx1 += w1 * 2 / LANES, lx2 += w2 * 2 / LANES) poly4(lx1 - lw1 / 2, y1, lx1 + lw1 / 2, y1, lx2 + lw2 / 2, y2, lx2 - lw2 / 2, y2, row.lane);
    }
  }

  // One sprite: its box is `dw` wide with its base at (x, y); hidden below `clip` (the hill in front of it).
  function drawSprite(fn, x, y, dw, aspect, clip, alpha) {
    if (dw < 2 || x + dw < 0 || x - dw > cssW) return;
    var cut = y > clip;
    if (cut) { if (y - dw * aspect >= clip) return; ctx.save(); ctx.beginPath(); ctx.rect(0, 0, cssW, clip); ctx.clip(); }
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.save(); ctx.translate(x, y); ctx.scale(dw, dw); fn(ctx); ctx.restore();
    if (alpha < 1) ctx.globalAlpha = 1;
    if (cut) ctx.restore();
  }

  function render() {
    if (!ctx) return;
    var g = game, w = cssW, h = cssH;
    if (!g) { ctx.fillStyle = '#3f9be6'; ctx.fillRect(0, 0, w, h); return; }
    var road = g.road, segs = road.segments, N = segs.length, p = g.player, theme = road.theme, pal = Art.PALETTES[theme], tbl = table(theme), night = theme === 'night';
    var base = E.findSegment(road, p.pos), basePct = E.percentRemaining(p.pos, SEG);
    var pseg = E.findSegment(road, p.pos + PLAYER_Z), ppct = E.percentRemaining(p.pos + PLAYER_Z, SEG);
    var pY = E.interpolate(pseg.p1.world.y, pseg.p2.world.y, ppct), maxY = h, x = 0, dx = -(base.curve * basePct), n, i, seg, row;
    drawSky(pal, theme, w, h);
    ctx.fillStyle = pal.grassL; ctx.fillRect(0, h / 2, w, h / 2);
    var last = Math.min(DRAW, N - base.index);
    for (n = 0; n < last; n++) {
      seg = segs[base.index + n]; seg.clip = maxY;
      E.project(seg.p1, p.x * ROAD_W - x, pY + CAM_H, p.pos, CAM_DEPTH, w, h, ROAD_W);
      E.project(seg.p2, p.x * ROAD_W - x - dx, pY + CAM_H, p.pos, CAM_DEPTH, w, h, ROAD_W);
      x += dx; dx += seg.curve;
      if (seg.p1.camera.z <= CAM_DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxY) continue;
      row = tbl[n];
      segmentStrip(row, seg.p1.screen.x, seg.p1.screen.y, seg.p1.screen.w, seg.p2.screen.x, seg.p2.screen.y, seg.p2.screen.w, seg.shade, w);
      maxY = seg.p1.screen.y;
    }
    // sprites and traffic from the far end back to the near
    var half = w / 2;
    for (n = last - 1; n >= 0; n--) {
      seg = segs[base.index + n]; row = tbl[n];
      var alpha = 1 - row.fog * 0.85;
      for (i = 0; i < seg.cars.length; i++) {
        var car = seg.cars[i], sc = E.interpolate(seg.p1.screen.scale, seg.p2.screen.scale, car.percent);
        var cx = E.interpolate(seg.p1.screen.x, seg.p2.screen.x, car.percent) + sc * car.offset * ROAD_W * half, cy = E.interpolate(seg.p1.screen.y, seg.p2.screen.y, car.percent);
        drawSprite(function (c) { Art.traffic(c, car, car.speed < MAX_SPEED * 0.28); }, cx, cy, sc * car.w * CAR_VIS * ROAD_W * half, Art.TRAFFIC_ASPECT[car.type], seg.clip, alpha);
      }
      for (i = 0; i < seg.sprites.length; i++) {
        var sp = seg.sprites[i];
        if (sp.hit) continue;
        var ss = seg.p1.screen.scale, sx = seg.p1.screen.x + ss * sp.offset * ROAD_W * half, sy = seg.p1.screen.y;
        drawSprite(function (c) { Art.scenery(c, sp, night); }, sx, sy, ss * sp.w * ROAD_W * half * (sp.gate ? 1 : SCENE_VIS), Art.ASPECT[sp.type], seg.clip, alpha);
      }
    }
    // headlights pool at night, then the player's car at the foot of the picture
    var pScale = CAM_DEPTH / PLAYER_Z, destY = h / 2 - pScale * E.interpolate(pseg.p1.camera.y, pseg.p2.camera.y, ppct) * h / 2, destX = w / 2;
    if (night) {
      var lg = ctx.createRadialGradient(destX, destY - h * 0.1, 0, destX, destY - h * 0.1, w * 0.65);
      lg.addColorStop(0, 'rgba(255,244,190,0.2)'); lg.addColorStop(1, 'rgba(255,244,190,0)');
      ctx.fillStyle = lg; ctx.fillRect(0, h * 0.4, w, h * 0.6);
    }
    var braking = !!(held.ArrowDown || held.s || pad.brake);
    drawSprite(function (c) { Art.player(c, p.steer, braking, night); }, destX, destY, pScale * PLAYER_DRAW_W * ROAD_W * half, 0.85, h, 1);
    if (crashFlash > 0 && !reduce) { ctx.fillStyle = 'rgba(217,71,61,' + (crashFlash * 0.45) + ')'; ctx.fillRect(0, 0, w, h); }
    // the words on the road
    if (document.body.classList.contains('touch')) steerHints();
    if (mode === 'ready' && countdown > 0) bigText(String(Math.ceil(countdown)), '#fff');
    else if (toastT > 0) bigText(toast, '#f2a516', 26);
    hud();
  }
  // Two faint arrows at the edges: hold that half of the road to steer that way.
  function steerHints() {
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.35)'; var y = cssH * 0.56, s = 14;
    ctx.beginPath(); ctx.moveTo(14 + s, y - s); ctx.lineTo(14, y); ctx.lineTo(14 + s, y + s); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cssW - 14 - s, y - s); ctx.lineTo(cssW - 14, y); ctx.lineTo(cssW - 14 - s, y + s); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function bigText(text, color, size) {
    ctx.save(); ctx.font = '800 ' + (size || 64) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(text, cssW / 2, cssH * 0.3); ctx.fillStyle = color; ctx.fillText(text, cssW / 2, cssH * 0.3); ctx.restore();
  }

  function hud() {
    if (!game) return;
    els.speed.textContent = Math.round(game.player.speed / MAX_SPEED * E.KMH);
    els.time.textContent = Math.ceil(game.time);
    var sc = E.totalScore(game);
    els.score.textContent = sc; els.best.textContent = Math.max(prefs.best, sc);
    els.time.parentNode.style.color = game.time < 10 ? 'var(--bad)' : '';
  }

  // ── the run ──────────────────────────────────────────────────────────────
  function inputNow() {
    var left = held.ArrowLeft || held.a || touchSteer.l, right = held.ArrowRight || held.d || touchSteer.r;
    var gas = held.ArrowUp || held.w || pad.gas || prefs.auto, brake = held.ArrowDown || held.s || pad.brake;
    return { steer: (right ? 1 : 0) - (left ? 1 : 0), gas: gas && !brake ? 1 : 0, brake: brake ? 1 : 0 };
  }
  function say(text) { toast = text; toastT = TOAST_S; els.msg.textContent = text; }

  var loop = Play.loop(function (dt) {
    if (mode === 'ready') {
      countdown -= dt; bgScroll(0, dt);
      if (countdown <= 0) { mode = 'playing'; say('Go'); }
      return;
    }
    toastT = Math.max(0, toastT - dt); crashFlash = Math.max(0, crashFlash - dt * 2.5);
    if (toastT === 0 && els.msg.textContent) els.msg.textContent = '';
    E.update(game, dt, inputNow());
    bgScroll(game.player.lastCurve * game.player.speed / MAX_SPEED, dt);
    game.events.splice(0).forEach(onEvent);
  }, render, 60);

  function bgScroll(k, dt) { bg[0] += k * HILL_RATE[0] * dt * 60; bg[1] += k * HILL_RATE[1] * dt * 60; }

  function onEvent(e) {
    if (e.type === 'checkpoint') say('Checkpoint +' + e.bonus + ' s');
    else if (e.type === 'finish') say(e.stage + ' done. Next: ' + e.next);
    else if (e.type === 'crash' || e.type === 'cone') { if (e.type === 'crash') say('Crash'); crashFlash = 1; }
    else if (e.type === 'over') finish();
  }

  function begin() {
    game = E.newGame(Math.floor(Math.random() * 1e6), prefs.stage);
    game.events.length = 0;
    mode = 'ready'; countdown = COUNTDOWN_S; toastT = 0; crashFlash = 0; els.msg.textContent = '';
    Play.closeSheet(els.sheet); els.pause.disabled = false;
    layout(); render(); loop.start();
  }
  function pause() {
    if (mode !== 'playing' && mode !== 'ready') return;
    var was = mode; mode = 'paused'; pausedFrom = was; loop.stop(); releaseAll();
    sheet('Paused', function (b) { note(b, 'The car waits.'); }, [['Resume', resume, true], ['Quit', setup, false]]);
  }
  var pausedFrom = 'playing';
  function resume() { mode = pausedFrom; Play.closeSheet(els.sheet); loop.start(); }
  function releaseAll() { clearKeys(); pad.gas = pad.brake = false; touchSteer = {}; padCtl.forEach(function (h) { h.release(); }); }

  function finish() {
    mode = 'over'; loop.stop(); els.pause.disabled = true; releaseAll(); render();
    var sc = E.totalScore(game), fresh = sc > prefs.best;
    if (fresh) { prefs.best = sc; savePrefs(); }
    sheet('Out of time', function (b) {
      note(b, 'Score ' + sc + (fresh ? '. A new best.' : '. Best ' + prefs.best + '.'));
      note(b, 'You reached ' + game.stage.name + (game.lap ? ', second time round.' : '.'));
    }, [['Drive again', begin, true], ['Setup', setup, false]]);
  }

  // ── sheets ───────────────────────────────────────────────────────────────
  function sheet(title, build, actions) {
    els.title.textContent = title; els.body.textContent = ''; els.actions.textContent = '';
    build(els.body);
    actions.forEach(function (a) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'ar-btn'; b.textContent = a[0]; b.setAttribute('aria-pressed', String(!!a[2]));
      b.addEventListener('click', a[1]); els.actions.appendChild(b);
    });
    Play.openSheet(els.sheet, '.ar-sheet-actions .ar-btn[aria-pressed="true"]');
  }
  function note(parent, text) { var p = document.createElement('p'); p.className = 'rr-note'; p.textContent = text; parent.appendChild(p); }
  function setup() {
    mode = 'setup'; loop.stop(); els.pause.disabled = true;
    sheet('Road Rush', function (b) {
      note(b, 'Beat the clock to each checkpoint. Weave through traffic, keep off the grass, and lift for hard bends: a bend pushes you outward the faster you go.');
      var row = document.createElement('div'), sp = document.createElement('span'), box = document.createElement('div');
      row.className = 'rr-row'; sp.textContent = 'Start in'; row.appendChild(sp);
      box.className = 'pl-seg'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Start in');
      [['Day', 0], ['Dusk', 1], ['Night', 2]].forEach(function (c) {
        var btn = document.createElement('button'); btn.type = 'button'; btn.textContent = c[0]; btn.setAttribute('aria-pressed', String(prefs.stage === c[1]));
        btn.addEventListener('click', function () {
          prefs.stage = c[1]; savePrefs();
          Array.prototype.forEach.call(box.children, function (o) { o.setAttribute('aria-pressed', 'false'); }); btn.setAttribute('aria-pressed', 'true');
        });
        box.appendChild(btn);
      });
      row.appendChild(box); b.appendChild(row);
      var lab = document.createElement('label'), cb = document.createElement('input');
      lab.className = 'rr-check'; cb.type = 'checkbox'; cb.checked = !!prefs.auto;
      cb.addEventListener('change', function () { prefs.auto = cb.checked; savePrefs(); syncAuto(); });
      lab.appendChild(cb); lab.appendChild(document.createTextNode('Accelerate by itself')); b.appendChild(lab);
      note(b, coarse ? 'Hold the left or right half of the road to steer.' : 'Best score on this device: ' + prefs.best + '.');
    }, [['Start', begin, true]]);
  }

  // ── input ────────────────────────────────────────────────────────────────
  var padCtl = [Play.hold(els.gas, function (v) { pad.gas = v; }), Play.hold(els.brake, function (v) { pad.brake = v; })];
  function keyName(e) { return e.key.length === 1 ? e.key.toLowerCase() : e.key; }
  var USED = { a: 1, d: 1, w: 1, s: 1, ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, ' ': 1 };
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = keyName(e);
    if (!els.sheet.hidden) { if (k === 'Escape' && mode === 'paused') resume(); return; }
    if (k === ' ') { e.preventDefault(); held.s = true; }
    else if (USED[k]) { e.preventDefault(); held[k] = true; }
    else if (k === 'p' || k === 'Escape') { e.preventDefault(); pause(); }
  });
  document.addEventListener('keyup', function (e) { var k = keyName(e); held[k === ' ' ? 's' : k] = false; });
  window.addEventListener('blur', function () { clearKeys(); touchSteer = {}; });
  // Touch and mouse: hold the left or right half of the picture to steer that way.
  function clearKeys() { Object.keys(held).forEach(function (k) { held[k] = false; }); }
  var pointers = {};
  function sideOf(e) { var r = els.cv.getBoundingClientRect(); return e.clientX < r.left + r.width / 2 ? 'l' : 'r'; }
  function syncTouch() { touchSteer = {}; Object.keys(pointers).forEach(function (id) { touchSteer[pointers[id]] = true; }); }
  els.cv.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    try { els.cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no capture */ }
    pointers[e.pointerId] = sideOf(e); syncTouch();
  });
  els.cv.addEventListener('pointermove', function (e) { if (pointers[e.pointerId]) { pointers[e.pointerId] = sideOf(e); syncTouch(); } });
  function lift(e) { delete pointers[e.pointerId]; syncTouch(); }
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (n) { els.cv.addEventListener(n, lift); });
  els.cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  els.pause.addEventListener('click', pause);
  Play.onHidden(pause);

  // ── layout ───────────────────────────────────────────────────────────────
  function layout() {
    var vw = document.documentElement.clientWidth, vh = window.innerHeight, touch = document.body.classList.contains('touch');
    var chrome = 52 + 58 + 24 + (touch ? 100 : 64) + 40;
    cssW = Math.floor(Math.min(vw - 16, 960));
    cssH = Math.floor(Math.max(240, Math.min(vh - chrome, cssW * (cssW < 500 ? 1.25 : 0.62))));
    res = Math.min(window.devicePixelRatio || 1, MAX_RES);
    els.cv.style.width = cssW + 'px'; els.cv.style.height = cssH + 'px';
    els.cv.width = Math.floor(cssW * res); els.cv.height = Math.floor(cssH * res);
    ctx = els.cv.getContext('2d'); ctx.setTransform(res, 0, 0, res, 0, 0);
    skyGrad = null; stars = [];
    var rng = E.mulberry(3);
    for (var i = 0; i < STARS; i++) stars.push([rng(), rng(), rng() < 0.2 ? 2 : 1]);
    render();
  }
  window.addEventListener('resize', layout);
  syncAuto(); layout(); setup();
  root.__roadrush = { get game() { return game; }, get mode() { return mode; }, held: held, pad: pad, prefs: prefs, begin: begin, E: E, render: render };
})(this);
