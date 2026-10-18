}
function _lpForgetOwnMutations() {
  if (_lpState.watchHead) _lpState.watchHead.takeRecords();
  if (_lpState.watchHero) _lpState.watchHero.takeRecords();
}
function _lpSync() {
  _lpState.queued = false;
  var hero = _lpHeroEl();
  if (!hero || !hero.offsetWidth || !_lpCanLive() || _lpPictureShows()) { _lpDetach(); _lpWatchHero(); return; }
  _lpDrawHero(hero);
  _lpWatchHero();
}
function _lpDrawHero(hero) {
  var S = _ae.gl, canvas = _lpCanvas(), view = _lpById('almanac-view');
  if (!S || !canvas || !view) return;
  _lpEnsureStyles();
  var w = hero.offsetWidth, h = hero.offsetHeight, ms = _aeDisplayMs();
  _lpState.canvas = canvas;
  if (canvas.parentNode !== hero) hero.appendChild(canvas);
  canvas.classList.add('lp-in-hero');
  // In the hero it is the picture's twin, not a control or a second picture to a screen reader: the view's own
  // description of it (set while the view is open) and its place in the tab order go with it.
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('tabindex', '-1');
  canvas.removeAttribute('aria-label');
  // The Moon alone fills the hero.
  var frame = { x: 0, y: 0, w: w, h: h };
  canvas.style.left = canvas.style.top = canvas.style.width = canvas.style.height = '';
  S.renderer.setSize(w, h, false);
  // The view's own numbers, put back as they were: the hero is drawn as the hand-off's first frame.
  var keep = { w: _ae.w, h: _ae.h, hand: _ae.hand, axis: _ae.axis, fade: _aeFadeU.value, scene: _ae.scene };
  try {
    _ae.w = w; _ae.h = h; _ae.axis = null;
    _ae.hand = { dir: 1, frame: frame, daz: 0, del: 0, e0: 0, e: 0, xfade: false };
    _aeFadeU.value = 0;
    _ae.scene = _aeSceneAt(ms);
    _aeUpdate(ms);
    S.renderer.render(S.scene, S.camera);
  } finally {
    _ae.w = keep.w; _ae.h = keep.h; _ae.hand = keep.hand; _ae.axis = keep.axis; _aeFadeU.value = keep.fade; _ae.scene = keep.scene;
  }
  view.classList.add('lp-live');
  _lpState.hero = hero;
  _lpState.drawnMs = ms;
  _lpForgetOwnMutations();
}
// Watch the header (a rebuild) and the hero (the picture changing, a sweep's overlay coming and going).
function _lpWatchHero() {
  var head = _lpById('almanac-head');
  if (!head || typeof MutationObserver !== 'function') return;
  if (!_lpState.watchHead) {
    _lpState.watchHead = new MutationObserver(_lpQueueSync);
  }
  _lpState.watchHead.disconnect();
  _lpState.watchHead.observe(head, { childList: true });
  var hero = head.querySelector('.almanac-hero');
  if (!_lpState.watchHero) _lpState.watchHero = new MutationObserver(_lpQueueSync);
  _lpState.watchHero.disconnect();
  if (hero) _lpState.watchHero.observe(hero, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'style', 'class', 'data-k', 'data-limb', 'data-l', 'data-b'] });
}
// A turned phone or a resized window draws the hero again.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('resize', function () { if (_lpState.hero) _lpQueueSync(); });
}
// No WebGL here: the hero is the picture it always was, and nothing about it says it can be pulled.
function _lpUnsupported() {
  _lpEnsureStyles();
  var view = _lpById('almanac-view');
  if (view) view.classList.add('lp-nogl');
}
// The view's scene is ready (_aePrepare): the hero can be the live Moon.
function _lpWarmed() { _lpQueueSync(); }
// The Earth view opens: its canvas goes home first; closes: the hero takes the Moon back.
function _lpBeforeShow() { _lpPreviewPull(0); _lpDetach(); }
function _lpAfterClose() { _lpSync(); }
// Leaving the Almanac: nothing of the hero's is kept.
function _lpRelease() {
  if (_lpState.watchHead) { _lpState.watchHead.disconnect(); }
  if (_lpState.watchHero) { _lpState.watchHero.disconnect(); }
  _lpDetach();
  _lpState.canvas = null;
  _lpState.axis = null; _lpState.ax = null; _lpState.gesture = null;
  if (_ae) _ae.axis = null;
}

// ── The axis in the open view ──
function _lpReduceMotion() { return _aeReduceMotion(); }
// A drag that began before the scene was ready is not lost: its travel waits (a drag's end, a slow network, a
// page still painting) and is played the moment the view opens on the axis.
var LP_PENDING_MS = 15000;
// Which way a finger travels to pull back is settled by the first drag from the Moon and kept for every
// drag after it (a hand that pulled to the left keeps pulling to the left): the other way brings the camera in.
function _lpOutDir(dx, u) {
  if (!_lpState.outDir && dx) _lpState.outDir = u > 0 ? 1 : (dx > 0 ? 1 : -1);
  return _lpState.outDir || 1;
}
function _lpQueueDrag(dx, dy) {
  var now = performance.now(), p = _lpState.pending;
  if (!p || now - p.at > LP_PENDING_MS) p = _lpState.pending = { dx: 0, dy: 0, at: now };
  p.dx += dx * _lpOutDir(dx, 0); p.dy += dy; p.at = now;
  _lpPreviewPull(Math.max(0, Math.min(1, p.dx / LP_PX_PER_STOP)));
}
// While the live scene is not ready the pull is the picture's own: the Moon draws back as the finger does, at once,
// and stands full size again when the view opens (_lpBeforeShow) and takes the pull on from there.
var LP_PREVIEW_SHRINK = 0.4;
function _lpPreviewPull(u) {
  var hero = _lpHeroEl();
  if (!hero) return;
  hero.classList.toggle('alm-moon-pulling', u > 0);
  if (u > 0) hero.style.setProperty('--alm-pull', (u * LP_PREVIEW_SHRINK).toFixed(3));
  else hero.style.removeProperty('--alm-pull');
}
function _lpEnterAxis(u) {
  if (!_ae.gl || !_ae.gl.solar) return;   // the layer did not build: the view stays the classic one
  _lpEnsureStyles();
  _lpEnsureDom();
  var pend = _lpState.pending && performance.now() - _lpState.pending.at <= LP_PENDING_MS ? _lpState.pending : null;
  _lpState.pending = null;
  _lpState.axis = { u: pend ? Math.max(0, Math.min(LP_LAST, u + Math.max(0, pend.dx) / LP_PX_PER_STOP)) : u, fly: null,
               tilt: pend ? Math.max(-LP_TILT_MAX, Math.min(LP_TILT_MAX, pend.dy * LP_TILT_PER_PX)) : 0 };
  _lpState.uiKey = _lpState.phaseKey = null;
  // The view's target is the Moon while the axis is on (as the hand-off sets it): a tap on the Earth or the Sun
  // is then a tap on something else, and hands over to the view's own flight to it.
  _ae.target = 'moon';
  _ae.axis = _lpState.axis;
  _ae.el.classList.add('lp-axis');
  _ae.dirty = true;
}
function _lpActive() { return !!(_ae && _ae.axis); }
// Fly the axis to stop `to` (or settle on it); `done` runs when it has arrived.
function _lpFlyTo(to, ms, done) {
  var ax = _ae.axis;
  if (!ax) return;
  var from = ax.u, span = Math.abs(to - from);
  if (_lpReduceMotion() || span < 1e-3) { ax.u = to; ax.fly = null; _ae.dirty = true; _aeKick(); if (done) done(); return; }
  ax.fly = { from: from, to: to, start: performance.now(), ms: ms || Math.max(LP_SNAP_MS, LP_FLY_MS_PER_STOP * Math.sqrt(span)), done: done };
  _aeKick();
}
function _lpStepAxis(now) {
  var ax = _ae.axis, f = ax && ax.fly;
  if (!f) return false;
  var p = Math.max(0, Math.min(1, (now - f.start) / f.ms)), e = _aeEaseInOut(p);
  ax.u = f.from + (f.to - f.from) * e;
  if (p >= 1) { ax.u = f.to; ax.fly = null; if (f.done) f.done(); }
  _ae.dirty = true;
  return true;
}
function _lpBusy() { return !!(_ae.axis && (_ae.axis.fly || _lpState.gesture)); }
// A way back that goes by the axis: from the far stops the camera flies home to the Moon first.
function _lpCloseFirst(then) {
  var ax = _ae && _ae.axis;
  if (!ax || ax.u < 0.02) return false;
  _lpFlyTo(0, Math.min(900, LP_FLY_MS_PER_STOP * Math.sqrt(ax.u)), then);
  return true;
}

// ── The camera and the scene, each frame ──
// The view's camera for this frame (it replaces the view's own while the axis is on).
function _lpViewport() {
  var sc = _ae.scene;
  return { aspect: _ae.w / _ae.h, height: _ae.h, moonRoll: _aeRollDeg('moon', sc.ms) };
}
function _lpAxisView(c) {
  var ax = _ae.axis, sc = _ae.scene;
  var st = _lpAxisCam(ax.u, sc, _lpViewport(), ax.tilt);
  _lpState.ax = st;
  var cam = st.cam;
  return { tp: cam.tp, az: cam.az, el: cam.el, dist: cam.dist, tanHalf: cam.th, roll: cam.roll, frame: { x: 0, y: -LP_VIEW_SHIFT_PX, w: _ae.w, h: _ae.h } };
}
// After the camera stands: the solar layer, and what the camera needs of it. Where the axis is off the layer is
// folded away and the Sun is the view's own again.
function _lpFrame(pos) {
  var S = _ae.gl, L = S.solar, sc = _ae.scene;
  if (!L) return null;
  if (!_ae.axis || !_lpState.ax) { _lpIdle(S); return null; }
  var ax = _lpState.ax, focal = _aeFocalPx();
  _lpState.places = _lpUpdateSolar(S, sc, ax, _lpViewport(), focal);
  var sunDist = _aeLen(_aeSub([S.sun.position.x, S.sun.position.y, S.sun.position.z], pos));
  var reach = Math.max(ax.cam.dist, sunDist) * LP_FAR_FACTOR;
  return { far: Math.max(AE_FAR, reach) };
}
function _lpIdle(S) {
  var L = S.solar;
  if (L.group.visible) L.group.visible = false;
  _aeCommitPoints(L.dots, 0);
  if (L.rays.visible) L.rays.visible = false;
  if (S.sun.scale.x !== 1) { S.sun.scale.setScalar(1); S.sunGlowUni.radius.value = AE_SUN_SHOW_R; }
  _lpSizeBodies(S, 1);
  _lpState.places = null;
}
// ── Taps, drags and keys ──
// The view's zoom (a wheel, a pinch): along the axis, a stop's worth for a sixfold change of distance.
var LP_ZOOM_PER_STOP = 6;
function _lpZoomBy(factor) {
  var ax = _ae.axis;
  ax.fly = null;
  ax.u = Math.max(0, Math.min(LP_LAST, ax.u + Math.log(factor) / Math.log(LP_ZOOM_PER_STOP)));
  _ae.dirty = true;
  _aeKick();
  _lpSettleSoon();
}
// A wheel or pinch has no release: settle on a stop when it has been still a moment.
var LP_SETTLE_IDLE_MS = 450;
function _lpSettleSoon() {
  clearTimeout(_lpState.settleTimer);
  _lpState.settleTimer = setTimeout(_lpDragEnd, LP_SETTLE_IDLE_MS);
}
var LP_DATE_FROM = 0.7, LP_DATE_TO = 1.5;       // where a drag on the Moon's line changes the date (the Moon is a dot beyond)
var LP_MOON_GRAB_PX = 48, LP_LINE_GRAB_PX = 26;
var LP_SIDEREAL_MONTH_DAYS = 27.321661;
var LP_MS_PER_DAY = 86400000;
function _lpDist2Seg(p, a, b) {
  var dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  var t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
// A pointer's place on the view's canvas (the view stands below the page's header): what _aeProject returns.
function _lpOnCanvas(x, y) {
  var r = _lpCanvas().getBoundingClientRect();
  return { x: x - r.left, y: y - r.top };
}
// A drag that begins on the Moon or the line to it, between the pair and the Earth, turns the date.
function _lpStartGesture(key) {
  var g = { key: key, kind: 'axis' };
  var ax = _ae.axis, sc = _ae.scene;
  if (key !== 'hero' && key && ax.u >= LP_DATE_FROM && ax.u <= LP_DATE_TO && sc) {
    var moon = _aeProject(sc.moon), earth = _aeProject([0, 0, 0]);
    var at = _lpOnCanvas(key.x0, key.y0), now = _lpOnCanvas(key.x, key.y);
    if (moon && earth && (Math.hypot(at.x - moon.x, at.y - moon.y) <= LP_MOON_GRAB_PX || _lpDist2Seg(at, earth, moon) <= LP_LINE_GRAB_PX)) {
      g.kind = 'date';
      g.center = earth;
      g.angle = Math.atan2(now.y - earth.y, now.x - earth.x);
    }
  }
  return g;
}
// The Moon follows the finger round the Earth: its angle on the screen is the date's, a sidereal month a turn.
function _lpDateDrag(g) {
  var d = _ae.drag;
  if (!d) return;
  var at = _lpOnCanvas(d.x, d.y);
  var a = Math.atan2(at.y - g.center.y, at.x - g.center.x);
  var turn = ((a - g.angle + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  g.angle = a;
  // On the screen the Moon runs against the clock hands as seen from the ecliptic's north: screen angle (y down) falls as longitude rises.
  _aeRunClock(-turn / AE_TWO_PI * LP_SIDEREAL_MONTH_DAYS * LP_MS_PER_DAY);
  _ae.dirty = true;
}
function _lpDragBy(dx, dy) {
  var ax = _ae.axis;
  var key = _ae.drag || 'hero';
  if (!_lpState.gesture || _lpState.gesture.key !== key) _lpState.gesture = _lpStartGesture(key);
  var g = _lpState.gesture;
  ax.fly = null;
  clearTimeout(_lpState.settleTimer);
  if (g.kind === 'date') { _lpDateDrag(g); _aeKick(); return; }
  ax.u = Math.max(0, Math.min(LP_LAST, ax.u + dx * _lpOutDir(dx, ax.u) / LP_PX_PER_STOP));
  ax.tilt = Math.max(-LP_TILT_MAX, Math.min(LP_TILT_MAX, ax.tilt + dy * LP_TILT_PER_PX));
  _ae.dirty = true;
  _aeKick();
}
// The finger lifted: a date's drag lands the page's clock; an axis drag near a stop settles on it.
function _lpDragEnd() {
  var ax = _ae && _ae.axis, g = _lpState.gesture;
  _lpState.gesture = null;
  if (!ax) return;
  if (g && g.kind === 'date') { _aeLandClock(); return; }
  var s = _lpSnap(ax.u);
  if (s.near && Math.abs(ax.u - s.stop) > 1e-3) _lpFlyTo(s.stop, LP_SNAP_MS);
}
// Arrow keys and Home/End walk the stops; + and - are the zoom's.
function _lpKeyDown(e) {
  if (!_ae.axis || e.target !== _lpById('ae-canvas')) return false;
  var step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 1, PageDown: -1 }[e.key];
  if (step) { _lpFlyTo(Math.max(0, Math.min(LP_LAST, Math.round(_ae.axis.u) + step))); return true; }
  if (e.key === 'Home') { _lpFlyTo(0); return true; }
  if (e.key === 'End') { _lpFlyTo(LP_LAST); return true; }
  return false;
}

// ── The controls ──
function _lpStopName(i) {
  var k = LP_STOPS[i];
  if (k === 'moon') return _aeT('alm_moon');
  if (k === 'pair') return _aeT('lp_stop_pair');
  if (k === 'earth') return _tp('Earth');
  if (k === 'inner') return _aeT('lp_stop_inner');
  return _tp('Neptune');
}
var LP_REACH_KEYS = { Moon: 'lp_reach_moon', Sun: 'lp_reach_sun', Mars: 'lp_reach_mars', Neptune: 'lp_reach_neptune' };
function _lpReachLine(i, sc) {
  return _aeT(LP_REACH_KEYS[LP_STOP_REACH[LP_STOPS[i]]]) + ': ' + _lpFmtReach(_lpStopKm(LP_STOPS[i], sc));
}
function _lpEnsureDom() {
  if (_lpState.dom && _lpById('lp-track')) return;
  var el = _ae.el;
  var ticks = '';
  LP_STOPS.forEach(function (k, i) {
    ticks += '<button type="button" class="lp-tick" data-lp-stop="' + i + '" style="bottom:' + (i / LP_LAST * 100).toFixed(2) + '%">' +
      '<span class="lp-tick-text"><b></b><i></i></span></button>';
  });
  var track = document.createElement('div');
  track.className = 'lp-track'; track.id = 'lp-track'; track.setAttribute('role', 'group'); track.setAttribute('aria-label', _aeT('lp_track'));
  track.innerHTML = ticks + '<i class="lp-knob" id="lp-knob"></i>';
  el.appendChild(track);
  var phase = document.createElement('div');
  phase.className = 'lp-phase'; phase.id = 'lp-phase';
  phase.innerHTML = '<img id="lp-phase-img" alt="" width="56" height="56"><span id="lp-phase-text"></span>';
  el.appendChild(phase);
  var views = _lpById('ae-views');
  var note = document.createElement('div');
  note.className = 'lp-scale'; note.id = 'lp-scale';
  views.parentNode.insertBefore(note, views);
  var labels = _lpById('ae-labels');
  ['Moon', 'Earth', 'Sun'].concat(EPH_PLANET_KEYS.filter(function (k) { return k !== 'Earth'; })).concat(['Ray']).forEach(function (k) {
    var span = document.createElement('span');
    span.className = 'ae-label'; span.id = 'lp-lbl-' + k; span.hidden = true;
    labels.appendChild(span);
  });
  var onTap = function (e) {
    var t = e.target.closest ? e.target.closest('[data-lp-stop]') : null;
    if (t) _lpFlyTo(+t.getAttribute('data-lp-stop'));
  };
  track.addEventListener('click', onTap);
  _lpState.dom = true;
}
var LP_UI_MS = 60000;               // the stops' distances and the phase disc are written afresh each minute
var LP_TICK_NEAR = 0.45;           // the stop whose distance is written: the one the camera is nearest, within this
function _lpSetText(el, text) { if (el && el.textContent !== text) el.textContent = text; }
// Per frame, the words and marks that follow the axis: ticks, knob, chips, the layout's note, the phase disc, the labels.
function _lpUpdateUi() {
  var ax = _ae.axis, st = _lpState.ax, sc = _ae.scene;
  if (!ax || !st || !sc) return;
  var near = Math.round(ax.u), on = Math.abs(ax.u - near) <= LP_TICK_NEAR;
  var track = _lpById('lp-track');
  var key = Math.floor(sc.ms / LP_UI_MS) + ':' + (on ? near : -1) + ':' + _orrLang();
  if (key !== _lpState.uiKey) {
    _lpState.uiKey = key;
    var ticks = track.querySelectorAll('.lp-tick');
    for (var i = 0; i < LP_STOPS.length; i++) {
      var t = ticks[i], isOn = on && i === near;
      t.classList.toggle('lp-on', isOn);
      _lpSetText(t.querySelector('b'), _lpStopName(i));
      if (isOn) _lpSetText(t.querySelector('i'), _lpReachLine(i, sc));
      t.setAttribute('aria-label', _lpStopName(i) + ', ' + _lpFmtReach(_lpStopKm(LP_STOPS[i], sc)));
      t.setAttribute('aria-pressed', String(isOn));
    }
  }
  _lpById('lp-knob').style.bottom = (ax.u / LP_LAST * 100).toFixed(2) + '%';
  var scale = _lpById('lp-scale'), show = _lpSaysNotToScale(st.lam, st.grow);
  _lpSetText(scale, show ? _aeT('lp_not_to_scale') : '');
  scale.classList.toggle('lp-show', show);
  // The Moon's phase at the clock, small, from the pair outward: what the pair's picture is the cause of.
  var phase = _lpById('lp-phase'), fade = ax.u >= LP_PHASE_FROM && ax.u <= LP_PHASE_TO;
  phase.classList.toggle('lp-show', fade);
  if (fade && _lpState.phaseKey !== Math.floor(sc.ms / LP_UI_MS)) {
    _lpState.phaseKey = Math.floor(sc.ms / LP_UI_MS);
    var date = new Date(sc.ms), view = _moonView(date, null, null), m = _moonPhase(date);
    var img = _lpById('lp-phase-img'), url = _renderMoonSprite(view, 56);
    if (img.getAttribute('src') !== url) img.setAttribute('src', url);
    _lpSetText(_lpById('lp-phase-text'), _localMoonName(m.name) + ' · ' + m.illumination + '%');
  }
  _lpUpdateLabels(st);
  // Once, as the camera reaches the pair: what a drag on the Moon does there.
  if (!_lpState.dateHinted && ax.u >= LP_DATE_FROM + 0.2 && ax.u <= LP_PAIR + 0.3 && !ax.fly) { _lpState.dateHinted = true; _aeShowHint(_aeT('lp_date_hint')); }
}
// Where a label may stand: below the header and clear of the track and the controls.
function _lpInClearArea(pos) {
  var s = _aeProject(pos);
  return !!s && s.y > LP_CLEAR_TOP_PX && s.y < _ae.h - LP_CLEAR_BOTTOM_PX && s.x > 8 && s.x < _ae.w - LP_CLEAR_END_PX;
}
// Names beside the bodies the axis shows: the Moon and the Earth from the pair out, the Sun, the planets once they are drawn, the sunlight.
function _lpUpdateLabels(st) {
  var P = _lpState.places, u = st.u;
  var set = function (k, text, pos, show) {
    var el = _lpById('lp-lbl-' + k);
    if (!el) return;
    _lpSetText(el, text);
    _aePlaceLabel('lp-lbl-' + k, pos, show && pos && _lpInClearArea(pos));
  };
  var pair = u >= LP_NAMES_FROM[0], planets = _lpPlanetsIn(u) > LP_NAME_SHOWN;
  // The Moon's name stands unless the Moon is on top of the Earth's (a dot beside a dot).
  var moonS = P && _aeProject(P.Moon), earthS = P && _aeProject(P.Earth);
  var apart = !moonS || !earthS || Math.hypot(moonS.x - earthS.x, moonS.y - earthS.y) > LP_LABEL_APART_PX;
  set('Moon', _aeT('alm_moon'), P && P.Moon, !!P && pair && apart);
  set('Earth', _tp('Earth'), P && P.Earth, !!P && pair);
  set('Sun', _aeT('alm_sun'), P && P.Sun, !!P && u >= LP_NAMES_FROM[1]);
  EPH_PLANET_KEYS.forEach(function (k) {
    if (k !== 'Earth') set(k, _tp(k), P && P[k], !!P && planets);
  });
  set('Ray', _aeT('lp_to_sun'), P && P.Ray, !!P && !!P.Ray && _lpRaysIn(u) > LP_NAME_SHOWN);
}

// From the classic view (Earth, satellites, Moon, Sun) back onto the axis: where its camera stood, flying to the Earth stop.
function _lpEnterFromView() {
  var from = _ae.target === 'sun' ? LP_EARTH : (_ae.target === 'earth' ? LP_PAIR : 0);
  _ae.fly = null;
  _ae.preset = 'axis';
  _lpEnterAxis(from);
  _aeMarkViews();
  _lpFlyTo(LP_EARTH);
}
// Off the axis (a preset, a tap on a body, closing): the view's own camera takes over where the axis left it.
function _lpLeaveAxis() {
  if (!_ae || !_ae.axis) return;
  var ax = _ae.axis, st = _lpState.ax;
  if (st) {
    _ae.target = ax.u < LP_PAIR - 0.5 ? 'moon' : (ax.u < LP_EARTH - 0.5 ? 'earth' : 'sun');
    _ae.az = st.cam.az; _ae.el_ = st.cam.el;
    _ae.dist = _aeClampDist(st.cam.dist);
  }
  _ae.axis = null; _lpState.axis = null; _lpState.ax = null; _lpState.gesture = null;
  _ae.el.classList.remove('lp-axis');
  // The names pinned to bodies go with it (the view's own labels are its own).
  var names = _ae.el.querySelectorAll('[id^="lp-lbl-"]');
  for (var i = 0; i < names.length; i++) names[i].hidden = true;
  _ae.dirty = true;
}
// From the pair out the Earth's satellites are a speck on it: not drawn.
function _lpAfterPlace(S) {
  var far = !!(_ae.axis && _ae.axis.u > LP_SATS_HIDDEN_FROM);
  S.sats.visible = !far;
  if (far) { S.gpsRings.visible = false; S.issRing.visible = false; } else S.issRing.visible = true;
}

// ── Joining the Earth view ──
// The pieces the view calls (guarded there): the solar layer is built with its scene, the dom with its own.
function _lpSceneBuilt(S) { S.solar = _lpBuildSolar(S); }
