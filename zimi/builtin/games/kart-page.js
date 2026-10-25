/* ZimiGames: ZimiKart, the page: setup, Grand Prix and Time Trial, the race loop, keys and the touch pad, split screen, saving.
   The rules are in kart.js (KartEngine), the pictures in kart-art.js and kart-view.js. Our own code, GPL-3.0. */
(function (root) {
  'use strict';
  var E = root.KartEngine, V = root.KartView, Play = root.ArcadePlay, $ = Play.$, TRACKS = E.TRACKS, DRIVERS = E.DRIVERS;
  var STORE = 'zimi.games.kart', GHOST_KEY = 'zimi.games.kart.ghost.', TOAST_S = 1.6, MAX_W = 1180, BAR_H = 52, DPR_MAX = 2, MSG_GAP_S = 2.5;
  var TILT_RANGE = 24, TILT_DEAD = 0.06;
  Play.applyTheme();

  var coarse = false;
  try { coarse = matchMedia('(pointer: coarse)').matches; } catch (e) { /* desktop */ }
  if (coarse || 'ontouchstart' in root) document.body.classList.add('touch');
  document.addEventListener('touchstart', function () { document.body.classList.add('touch'); layout(); }, { once: true, passive: true });
  function isTouch() { return document.body.classList.contains('touch'); }

  var saved = Play.load(STORE, {});
  var prefs = { mode: saved.mode || 'gp', players: saved.players || 1, cup: saved.cup || 0, track: saved.track || 'tidewalk', diff: saved.diff || 'normal', driver: saved.driver == null ? 0 : saved.driver, driver2: saved.driver2 == null ? 1 : saved.driver2,
    auto: saved.auto == null ? isTouch() : !!saved.auto, tilt: !!saved.tilt, best: saved.best || {}, cups: saved.cups || {} };
  function savePrefs() { Play.save(STORE, prefs); }

  var els = { cv: $('kt-board'), stage: $('kt-stage'), pads: $('kt-pads'), msg: $('kt-msg'), pause: $('kt-pause'), sheet: $('kt-sheet'), title: $('kt-sheet-title'), body: $('kt-body'), actions: $('kt-actions') };
  var ctx, cssW = 0, cssH = 0, pxs = 1;
  var g = { mode: 'setup', race: null, T: null, assets: null, cams: [], humans: [], gp: null, rects: [], split: false, banner: null, bannerT: 0, rec: null, ghost: null, ghostRec: null, lastPlace: [], lastSay: 0, assetsFor: '' };
  var keys = {}, pads = [{}, {}], tiltSteer = 0, assetCache = {};

  // ── tracks ───────────────────────────────────────────────────────────────
  function assetsFor(id) {
    if (!assetCache[id]) { var T = E.buildTrack(id); assetCache = {}; assetCache[id] = V.prepare(T); }
    return assetCache[id];
  }

  // ── starting a race ──────────────────────────────────────────────────────
  function trackFor() { return prefs.mode === 'gp' ? TRACKS[E.CUPS[prefs.cup].tracks[g.gp.race]] : E.track(prefs.track); }
  function startRace() {
    var def = trackFor(), a = assetsFor(def.id), humans = prefs.mode === 'trial' ? 1 : prefs.players;
    var opts = { humans: humans, driver: prefs.driver, driver2: prefs.driver2, diff: prefs.diff, laps: 3, seed: Math.floor(Math.random() * 1e9), trial: prefs.mode === 'trial' };
    if (prefs.mode === 'gp' && g.gp.race > 0) opts.grid = E.cupOrder(g.gp.totals);
    g.T = a.T; g.assets = a; g.race = E.createRace(a.T, opts);
    g.humans = g.race.karts.filter(function (k) { return k.human >= 0; }).sort(function (x, y) { return x.human - y.human; });
    g.split = humans === 2; g.cams = g.humans.map(function (k) { var c = { x: 0, y: 0, yaw: 0, lift: 0 }; V.follow(c, k, 0, true); return c; });
    g.rec = prefs.mode === 'trial' ? E.ghostNew() : null; g.ghostRec = prefs.mode === 'trial' ? Play.load(GHOST_KEY + def.id, null) : null;
    g.lastPlace = []; g.banner = null; els.msg.textContent = '';
    g.mode = 'playing'; Play.closeSheet(els.sheet); els.pause.disabled = false;
    buildPads(); layout(); loop.start();
  }
  function startCup() { g.gp = { race: 0, totals: DRIVERS.map(function () { return 0; }), cup: prefs.cup }; startRace(); }

  function toast(text) { g.banner = text; g.bannerT = TOAST_S; }
  function say(text) { els.msg.textContent = text; }

  // ── the loop ─────────────────────────────────────────────────────────────
  function inputFor(p) {
    var n = g.humans.length, kb = n === 1 ? ONE : p === 0 ? P1 : P2, pd = pads[p], any = function (list) { return list.some(function (c) { return keys[c]; }); };
    var steer = (any(kb.right) || pd.right ? 1 : 0) - (any(kb.left) || pd.left ? 1 : 0);
    if (!steer && p === 0 && prefs.tilt) steer = tiltSteer;
    var brake = any(kb.brake) || !!pd.brake;
    return { steer: steer, gas: !brake && (prefs.auto || any(kb.gas) || !!pd.gas), brake: brake, drift: any(kb.drift) || !!pd.drift, item: any(kb.item) || !!pd.item };
  }
  var ONE = { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], gas: ['ArrowUp', 'KeyW'], brake: ['ArrowDown', 'KeyS'], drift: ['ShiftLeft', 'ShiftRight', 'KeyZ'], item: ['Space', 'Enter', 'NumpadEnter', 'KeyX'] };
  var P1 = { left: ['KeyA'], right: ['KeyD'], gas: ['KeyW'], brake: ['KeyS'], drift: ['ShiftLeft'], item: ['Space'] };
  var P2 = { left: ['ArrowLeft'], right: ['ArrowRight'], gas: ['ArrowUp'], brake: ['ArrowDown'], drift: ['ShiftRight', 'Slash'], item: ['Enter', 'NumpadEnter'] };
  var USED = {};
  [ONE, P1, P2].forEach(function (m) { Object.keys(m).forEach(function (k) { m[k].forEach(function (c) { USED[c] = true; }); }); });

  function update(dt) {
    var r = g.race, inputs = g.humans.map(function (k, p) { return inputFor(p); });
    var ev = E.step(r, inputs, dt), clock = E.clockOf(r);
    if (g.rec && r.go && g.humans[0].finished == null) E.ghostPush(g.rec, clock, g.humans[0]);
    ev.forEach(handle);
    g.humans.forEach(function (k, p) { V.follow(g.cams[p], k, dt, false); });
    if (g.bannerT > 0) { g.bannerT -= dt; if (g.bannerT <= 0) g.banner = null; }
    var lead = g.humans[0];
    if (lead && r.go && lead.place !== g.lastPlace[0] && r.t - g.lastSay > MSG_GAP_S) { if (g.lastPlace[0] != null) say(E.ordinal(lead.place) + ' place'); g.lastPlace[0] = lead.place; g.lastSay = r.t; }
    if (r.over && g.mode === 'playing') finishRace();
  }
  function isMine(k) { return k && k.human >= 0; }
  function handle(e) {
    var k = e.kart, one = g.humans.length === 1;
    if (!isMine(k)) return;
    var who = one ? '' : 'Player ' + (k.human + 1) + ': ';
    if (e.type === 'lap' && k.finished == null) { var t = e.lap + 1 === g.race.laps ? 'Final lap!' : 'Lap ' + (e.lap + 1); if (one) toast(t); say(who + t); }
    else if (e.type === 'finish') { say(who + 'Finished ' + E.ordinal(k.place)); toast('Finished ' + E.ordinal(k.place)); }
    else if (e.type === 'hit' && one) toast('Spun out');
    else if (e.type === 'blocked' && one) toast('Shield held');
    else if (e.type === 'fall' && one) toast('Missed the jump');
    else if (e.type === 'miniboost' && one) toast(['', 'Boost', 'Big boost', 'Mega boost'][e.level]);
  }
  function render() {
    if (!g.race || !ctx) return;
    var r = g.race, t = performance.now() / 1000, reduced = Play.reducedMotion(), clock = E.clockOf(r);
    ctx.setTransform(pxs, 0, 0, pxs, 0, 0);
    var ghost = null;
    if (g.ghostRec && r.go) { var gp = E.ghostAt(g.ghostRec.rec || g.ghostRec, clock); if (gp) ghost = { x: gp.x, y: gp.y, a: gp.a, driver: DRIVERS[(g.ghostRec.driver || 0)] }; }
    g.humans.forEach(function (k, p) {
      V.draw(ctx, g.rects[p], g.cams[p], k, r, g.assets, { slot: p, t: t, still: reduced, ghost: ghost, small: g.split, banner: p === 0 || g.split ? (g.humans.length === 1 || p === 0 ? g.banner : null) : null });
    });
    if (g.split) { ctx.fillStyle = '#0b1020'; var a = g.rects[0], b = g.rects[1]; if (a.y === b.y) ctx.fillRect(a.x + a.w, 0, b.x - a.x - a.w, cssH); else ctx.fillRect(0, a.y + a.h, cssW, b.y - a.y - a.h); }
  }
  var loop = Play.loop(update, render, 60);

  // ── the end of a race ────────────────────────────────────────────────────
  function finishRace() {
    g.mode = 'result'; loop.stop(); releaseAll(); els.pause.disabled = true;
    var r = g.race, order = r.order || E.rankKarts(r), me = g.humans[0], clock = me.finished;
    if (prefs.mode === 'trial') return trialResult(me, clock);
    var drvOrder = order.map(function (k) { return k.drvIndex; }), before = prefs.mode === 'gp' ? g.gp.totals.slice() : null;
    if (prefs.mode === 'gp') g.gp.totals = E.addPoints(g.gp.totals, drvOrder);
    var last = prefs.mode === 'gp' && g.gp.race === 2;
    sheet(last ? 'Race 3 of 3' : prefs.mode === 'gp' ? 'Race ' + (g.gp.race + 1) + ' of 3' : g.humans.length === 2 ? raceWinner(order) : E.ordinal(me.place) + ' of ' + r.karts.length, function (b) {
      table(b, order.map(function (k, i) { return { me: isMine(k), cells: [E.ordinal(i + 1), nameOf(k), k.finished != null ? E.fmtTime(k.finished) : '-', prefs.mode === 'gp' ? '+' + (E.GP_POINTS[i] || 0) : ''] }; }));
      if (prefs.mode !== 'gp') g.humans.forEach(function (k) { if (k.laps.length) note(b, (g.humans.length > 1 ? nameOf(k) + ': best lap ' : 'Best lap ') + E.fmtTime(Math.min.apply(null, k.laps))); });
    }, prefs.mode === 'gp' ? [[last ? 'Cup result' : 'Next: ' + TRACKS[E.CUPS[prefs.cup].tracks[g.gp.race + 1]].name, function () { if (last) cupResult(); else { g.gp.race++; startRace(); } }, true]] :
      [['Race again', startRace, true], ['Menu', goSetup, false]]);
  }
  function raceWinner(order) { var w = order.filter(isMine)[0]; return nameOf(w) + ' wins'; }
  function nameOf(k) { return isMine(k) ? (g.humans.length > 1 ? 'Player ' + (k.human + 1) : 'You') + ' (' + k.driver.name + ')' : k.driver.name; }
  function cupResult() {
    var order = E.cupOrder(g.gp.totals), me = g.humans[0].drvIndex, rank = order.indexOf(me) + 1, cup = E.CUPS[prefs.cup];
    var rec = prefs.cups[cup.id];
    if (!rec || rank < rec.rank || (rank === rec.rank && g.gp.totals[me] > rec.points)) { prefs.cups[cup.id] = { rank: rank, points: g.gp.totals[me] }; savePrefs(); }
    sheet(cup.name + ': ' + (rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : E.ordinal(rank)), function (b) {
      table(b, order.map(function (di, i) { return { me: di === me || (g.humans[1] && di === g.humans[1].drvIndex), cells: [E.ordinal(i + 1), DRIVERS[di].name, '', g.gp.totals[di] + ' pts'] }; }));
      if (rank > 3) note(b, 'The top three get a cup. Try again?');
    }, [['Another Grand Prix', startCup, true], ['Menu', goSetup, false]]);
  }
  function trialResult(me, ms) {
    var def = g.T.def, best = prefs.best[def.id], rec = !best || ms < best.ms, bestLap = Math.min.apply(null, me.laps);
    if (rec) { prefs.best[def.id] = { ms: ms, lap: bestLap }; savePrefs(); Play.save(GHOST_KEY + def.id, { rec: g.rec, driver: me.drvIndex }); }
    else if (best && bestLap < best.lap) { best.lap = bestLap; savePrefs(); }
    sheet(def.name + ': ' + E.fmtTime(ms), function (b) {
      table(b, me.laps.map(function (l, i) { return { me: false, cells: ['Lap ' + (i + 1), '', '', E.fmtTime(l)] }; }));
      note(b, rec ? (best ? 'A new record, ' + E.fmtTime(best.ms - ms) + ' faster. Your ghost is saved.' : 'A first record. Your ghost is saved, and races you next time.') : 'Record on this device: ' + E.fmtTime(best.ms) + '.');
    }, [['Try again', startRace, true], ['Menu', goSetup, false]]);
  }

  // ── pause ────────────────────────────────────────────────────────────────
  function pause() {
    if (g.mode !== 'playing') return;
    g.mode = 'paused'; loop.stop(); releaseAll();
    sheet('Paused', function (b) { note(b, 'The karts wait.'); }, [['Resume', resume, true], ['Restart', function () { if (prefs.mode === 'gp') g.gp.totals = g.gp.totals; startRace(); }, false], ['Menu', goSetup, false]]);
  }
  function resume() { g.mode = 'playing'; Play.closeSheet(els.sheet); loop.start(); }
  function releaseAll() { Object.keys(keys).forEach(function (k) { keys[k] = false; }); pads.forEach(function (p) { Object.keys(p).forEach(function (k) { p[k] = false; }); }); holds.forEach(function (h) { h.release(); }); }

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
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function note(parent, text) { parent.appendChild(mk('p', 'kt-note', text)); }
  function table(parent, rows) {
    var t = mk('table', 'kt-table'), tb = mk('tbody');
    rows.forEach(function (r) { var tr = mk('tr', r.me ? 'me' : ''); r.cells.forEach(function (c) { tr.appendChild(mk('td', '', c)); }); tb.appendChild(tr); });
    t.appendChild(tb); parent.appendChild(t);
  }
  function seg(parent, label, key, choices, after) {
    var row = mk('div', 'kt-row'), box = mk('div', 'pl-seg');
    row.appendChild(mk('span', '', label)); box.setAttribute('role', 'group'); box.setAttribute('aria-label', label);
    choices.forEach(function (c) {
      var b = mk('button', '', c[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(prefs[key] === c[0]));
      b.addEventListener('click', function () {
        prefs[key] = c[0]; savePrefs();
        Array.prototype.forEach.call(box.children, function (o) { o.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true'); if (after) after();
      });
      box.appendChild(b);
    });
    row.appendChild(box); parent.appendChild(row);
  }
  function check(parent, label, key, after) {
    var lab = mk('label', 'kt-check'), cb = mk('input'); cb.type = 'checkbox'; cb.checked = prefs[key];
    cb.addEventListener('change', function () { prefs[key] = cb.checked; savePrefs(); if (after) after(cb.checked); });
    lab.appendChild(cb); lab.appendChild(document.createTextNode(label)); parent.appendChild(lab);
  }
  function cast(parent, label, key, other) { // the critter to drive
    parent.appendChild(mk('div', 'kt-note', label));
    var grid = mk('div', 'kt-cast'), kids = [];
    grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', label);
    DRIVERS.forEach(function (d, i) {
      var b = mk('button', 'kt-pick'), cv = mk('canvas'), c;
      b.type = 'button'; b.setAttribute('aria-pressed', String(prefs[key] === i)); b.setAttribute('aria-label', d.name + ', ' + d.note); cv.width = cv.height = 96;
      c = cv.getContext('2d'); V.drawKartPreview(c, d, 48, 90, 4.6, 'back');
      b.appendChild(cv); b.appendChild(mk('small', '', d.name)); kids.push(b);
      b.addEventListener('click', function () { prefs[key] = i; savePrefs(); kids.forEach(function (o, j) { o.setAttribute('aria-pressed', String(j === i)); }); if (other) other(); });
      grid.appendChild(b);
    });
    parent.appendChild(grid); return kids;
  }

  function goSetup() {
    g.mode = 'setup'; loop.stop(); releaseAll(); els.pause.disabled = true; g.gp = null;
    sheet('ZimiKart', function (b) {
      var detail = mk('div');
      function fill() {
        detail.textContent = '';
        if (prefs.mode === 'gp') {
          seg(detail, 'Cup', 'cup', E.CUPS.map(function (c, i) { return [i, c.name]; }), fill);
          var cup = E.CUPS[prefs.cup], rec = prefs.cups[cup.id];
          note(detail, cup.tracks.map(function (t) { return TRACKS[t].name; }).join(', ') + (rec ? '. Best: ' + (rec.rank === 1 ? 'gold' : rec.rank === 2 ? 'silver' : rec.rank === 3 ? 'bronze' : E.ordinal(rec.rank)) + ', ' + rec.points + ' points.' : '.'));
        } else {
          var row = mk('div', 'kt-row'), sel = mk('select', 'kt-sel');
          row.appendChild(mk('span', '', 'Track')); sel.setAttribute('aria-label', 'Track');
          TRACKS.forEach(function (t) { var o = mk('option', '', t.name + (prefs.best[t.id] ? ' (' + E.fmtTime(prefs.best[t.id].ms / 1) + ')' : '')); o.value = t.id; o.selected = prefs.track === t.id; sel.appendChild(o); });
          sel.addEventListener('change', function () { prefs.track = sel.value; savePrefs(); });
          row.appendChild(sel); detail.appendChild(row);
          if (prefs.mode === 'trial') note(detail, 'Three laps alone. Your best run is saved and its ghost races you.');
        }
        if (prefs.mode !== 'trial') seg(detail, 'Players', 'players', [[1, 'One'], [2, 'Two']], fill);
        if (prefs.mode !== 'trial' && prefs.players === 2) note(detail, isTouch() ? 'Split screen, each half with its own buttons.' : 'Split screen. Left: WASD, Left Shift to drift, Space for items. Right: arrows, Right Shift, Enter.');
        seg(detail, 'Rivals', 'diff', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']]);
        var k1 = cast(detail, prefs.mode !== 'trial' && prefs.players === 2 ? 'Player 1 drives' : 'You drive', 'driver', function () { if (prefs.players === 2 && prefs.driver2 === prefs.driver) { prefs.driver2 = (prefs.driver + 1) % DRIVERS.length; fill(); } });
        if (prefs.mode !== 'trial' && prefs.players === 2) cast(detail, 'Player 2 drives', 'driver2', function () { if (prefs.driver2 === prefs.driver) { prefs.driver = (prefs.driver2 + 1) % DRIVERS.length; fill(); } });
        check(detail, 'Accelerate by itself (the brake still works)', 'auto');
        if (isTouch() && root.DeviceOrientationEvent) check(detail, 'Tilt the phone to steer', 'tilt', function (on) { if (on) askTilt(); });
      }
      seg(b, 'Play', 'mode', [['gp', 'Grand Prix'], ['race', 'Single race'], ['trial', 'Time Trial']], fill);
      b.appendChild(detail); fill();
    }, [['Start', function () { if (prefs.mode === 'gp') startCup(); else startRace(); }, true]]);
  }

  // ── input ────────────────────────────────────────────────────────────────
  var holds = [];
  function buildPads() {
    els.pads.textContent = ''; holds = []; els.pads.classList.toggle('over', g.split); els.stage.classList.toggle('kt-split', g.split);
    if (!isTouch()) return;
    g.humans.forEach(function (k, p) {
      var pad = mk('div', 'kt-pad'), steer = mk('div', 'kt-steer'), act = mk('div', 'kt-act');
      pad.setAttribute('role', 'group'); pad.setAttribute('aria-label', g.split ? 'Player ' + (p + 1) + ' controls' : 'Controls'); pad.dataset.p = p;
      function btn(parent, cls, text, aria, name) {
        var b = mk('button', 'kt-btn ' + cls, text); b.type = 'button'; b.setAttribute('aria-label', aria); b.setAttribute('aria-pressed', 'false'); parent.appendChild(b);
        holds.push(Play.hold(b, function (v) { pads[p][name] = v; }));
      }
      btn(steer, 'kt-left', '←', 'Steer left', 'left'); btn(steer, 'kt-right', '→', 'Steer right', 'right');
      btn(act, 'kt-brake', 'Brake', 'Brake', 'brake'); btn(act, 'kt-item', 'Item', 'Use item', 'item'); btn(act, 'kt-drift', 'Drift', 'Drift', 'drift');
      pad.appendChild(steer); pad.appendChild(act); els.pads.appendChild(pad);
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!els.sheet.hidden) { if (e.key === 'Escape' && g.mode === 'paused') resume(); return; }
    if (USED[e.code]) { e.preventDefault(); keys[e.code] = true; }
    else if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); pause(); }
  });
  document.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { Object.keys(keys).forEach(function (k) { keys[k] = false; }); });
  els.pause.addEventListener('click', pause);
  Play.onHidden(pause);

  function askTilt() {
    try {
      if (root.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) DeviceOrientationEvent.requestPermission().catch(function () { prefs.tilt = false; savePrefs(); });
    } catch (e) { prefs.tilt = false; }
  }
  window.addEventListener('deviceorientation', function (e) {
    if (!prefs.tilt || e.gamma == null) return;
    var portrait = window.innerHeight >= window.innerWidth, ang = (screen.orientation && screen.orientation.angle) || 0;
    var v = portrait ? e.gamma : (ang === 270 ? -e.beta : e.beta);
    v = E.clamp((v || 0) / TILT_RANGE, -1, 1);
    tiltSteer = Math.abs(v) < TILT_DEAD ? 0 : v;
  });

  // ── layout ───────────────────────────────────────────────────────────────
  function layout() {
    var vw = document.documentElement.clientWidth, vh = window.innerHeight, touch = isTouch(), landscape = vw > vh, split = g.split;
    var padBelow = touch && !landscape && !split ? 190 : 0, avail = vh - BAR_H - (touch && landscape ? 10 : 48) - padBelow - (touch ? 0 : 56);
    cssW = Math.floor(Math.min(vw - (touch ? 0 : 20), MAX_W));
    var ratio = touch && !landscape && !split ? 1.5 : split && !touch ? 0.5 : 0.62;
    cssH = Math.floor(Math.max(220, Math.min(avail, cssW * ratio)));
    pxs = Math.min(root.devicePixelRatio || 1, DPR_MAX);
    els.cv.style.width = cssW + 'px'; els.cv.style.height = cssH + 'px';
    els.cv.width = Math.floor(cssW * pxs); els.cv.height = Math.floor(cssH * pxs);
    ctx = els.cv.getContext('2d'); ctx.setTransform(pxs, 0, 0, pxs, 0, 0);
    var gap = 4;
    if (!split) g.rects = [{ x: 0, y: 0, w: cssW, h: cssH }];
    else if (touch) { var hh = Math.floor((cssH - gap) / 2); g.rects = [{ x: 0, y: 0, w: cssW, h: hh }, { x: 0, y: hh + gap, w: cssW, h: hh }]; }
    else { var ww = Math.floor((cssW - gap) / 2); g.rects = [{ x: 0, y: 0, w: ww, h: cssH }, { x: ww + gap, y: 0, w: ww, h: cssH }]; }
    // a pad per half over the canvas in split screen; one pad under (or over) the canvas otherwise
    Array.prototype.forEach.call(els.pads.children, function (pad, p) {
      if (!g.split) { pad.style.top = pad.style.bottom = ''; return; }
      var r = g.rects[p]; pad.style.top = (r.y + r.h - 62) + 'px'; pad.style.bottom = 'auto';
    });
    render();
  }
  window.addEventListener('resize', layout);
  layout();
  goSetup();
  root.__kart = { get g() { return g; }, prefs: prefs, keys: keys, pads: pads, E: E, startRace: startRace, startCup: startCup, update: update, render: render, loop: loop };
})(this);
