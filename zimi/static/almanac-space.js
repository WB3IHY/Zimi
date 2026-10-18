function _spFinishFlight() {
  var f = _sp.flight, cam = _sp.cam;
  _sp.at = f.key;
  _sp.lastTrip = { key: f.key, beta: f.beta, earthSec: f.now.earthSec, shipSec: f.now.shipSec };
  _sp.jd = f.jd0 + f.now.earthSec / SECONDS_PER_DAY;
  _sp.moved = true;
  var end = _spAdd(f.from, _aeScale(f.heading, f.camLen));
  // The body where the ship stops; if its table has ended the ship stops where it was bound.
  var center = _spFollowCenter(f.key) || _spAdd(end, _aeScale(f.heading, f.stand));
  var off = _aeSub(end, center);
  cam.follow = f.key;
  cam.center = center;
  cam.dist = Math.max(_aeLen(off), _spMinDist(f.key));
  cam.az = Math.atan2(off[1], off[0]);
  cam.el = Math.asin(_aeClamp(off[2] / Math.max(_aeLen(off), 1e-18), -1, 1));
  cam.lookYaw = cam.lookPitch = 0;
  _sp.flight = null;
  if (_orrFmtSpan(f.now.earthSec) !== _orrFmtSpan(f.now.shipSec)) _spShowCaption('clocks');
  _spSyncControls();
  _sp.dirty = true;
}
// Fly cut short: arrive at once.
function _spSkipFlight() { if (_sp.flight) _spStepFlight(1e12); _spKick(); }

// A smooth turn of the camera between parked views (no ship, no speed).
function _spGlide(to) {
  var cam = _sp.cam;
  var toCenter = to.follow ? (_spFollowCenter(to.follow) || cam.center) : (to.center || [0, 0, 0]);
  var g = { from: { center: cam.center.slice(), dist: cam.dist, az: cam.az, el: cam.el }, to: { follow: to.follow, center: toCenter, dist: to.dist, az: to.az, el: to.el }, p: 0 };
  var dAz = g.to.az - g.from.az;
  g.to.az = g.from.az + Math.atan2(Math.sin(dAz), Math.cos(dAz));
  if (_spReduceMotion()) { _spApplyGlide(g, 1); return; }
  cam.follow = null;
  _sp.glide = g;
  _spKick();
}
var SP_GLIDE_MS = 900;
function _spApplyGlide(g, p) {
  var cam = _sp.cam, e = _aeEaseInOut(p);
  if (p >= 1) {
    cam.follow = g.to.follow; cam.center = g.to.center; cam.dist = g.to.dist; cam.az = g.to.az; cam.el = g.to.el;
    _sp.glide = null;
    if (_sp.pendingFly) { var k = _sp.pendingFly; _sp.pendingFly = null; _spStartFlight(k); }
  } else {
    cam.center = [0, 1, 2].map(function (i) { return g.from.center[i] + (g.to.center[i] - g.from.center[i]) * e; });
    cam.dist = Math.exp(Math.log(g.from.dist) + (Math.log(g.to.dist) - Math.log(g.from.dist)) * e);
    cam.az = g.from.az + (g.to.az - g.from.az) * e;
    cam.el = g.from.el + (g.to.el - g.from.el) * e;
  }
  _sp.dirty = true;
}
function _spStepGlide(dt) {
  var g = _sp.glide;
  if (!g) return false;
  g.p = Math.min(1, g.p + dt / SP_GLIDE_MS);
  _spApplyGlide(g, g.p);
  return !!_sp.glide;
}
function _spGlideToBody(key) {
  _spSetLayout(0);
  var stand = _spStandoff(key);
  _spGlide({ follow: key, dist: stand, az: _sp.cam.az, el: Math.max(0.25, _sp.cam.el) });
}
// The layout blends to its target (1 in the overview, 0 anywhere a place is to be flown to).
function _spSetLayout(target) {
  _sp.layoutTarget = target;
  if (_spReduceMotion()) _sp.layout = target;
  _sp.dirty = true; _spKick();
}
function _spStepLayout(dt) {
  var d = _sp.layoutTarget - _sp.layout;
  if (!d) return false;
  var step = dt / SP_LAYOUT_MS;
  _sp.layout = Math.abs(d) <= step ? _sp.layoutTarget : _sp.layout + (d > 0 ? step : -step);
  _sp.dirty = true;
  return _sp.layout !== _sp.layoutTarget;
}
// Back to the whole system, laid out; the selection stays unless `keep` is false.
function _spOverview(keep) {
  if (_sp.flight) return;
  _sp.pendingFly = null;
  _spSetLayout(1);
  _spGlide({ follow: 'Sun', dist: SP_OVERVIEW_DIST_AU, az: _sp.cam.az, el: SP_OVERVIEW_ELEVATION });
  if (!keep) _spSelect(null);
}

// ── What the scene shows, for one frame ──
// The light's colour and brightness on a thing sunlit and seen from the ship: its
// direction against the heading gives the Doppler factor D; the Sun's spectrum
// shifts by it. A point of light (a star) gains D^2 (_spBeamGain); an extended
// surface gains D^4, because the same light is also packed into a patch of sky
// D^2 smaller. The planet's lighting itself (the terminator, the limb) is rest-frame
// geometry of a body at rest in the Sun's frame, and is correctly not aberrated.
var SP_SURFACE_GAIN_MAX = 400;
function _spTintFor(dirToBody, beta, head) {
  if (!(beta > 0)) return [1, 1, 1];
  var D = _lorentzFactor(beta) * (1 + beta * _aeDot(dirToBody, head));
  var bb = _spBlackbodyRGB(D * SP_SUN_TEMP_K), bb0 = _spBlackbodyRGB(SP_SUN_TEMP_K);
  var gain = Math.min(D * D * _spBeamGain(D, SP_SUN_TEMP_K), SP_SURFACE_GAIN_MAX);
  return [bb[0] / bb0[0] * gain, bb[1] / bb0[1] * gain, bb[2] / bb0[2] * gain];
}
// How much smaller (or larger) a thing in direction dirToBody looks from the ship: 1 / D.
function _spApparentScale(dirToBody, beta, head) {
  if (!(beta > 0)) return 1;
  return 1 / Math.max(0.05, _lorentzFactor(beta) * (1 + beta * _aeDot(dirToBody, head)));
}
// Projection of a camera-relative vector (AU), as the ship sees it: pixels, or null if behind.
function _spProject(rel, beta, head) {
  var cam = _sp.cam, r = _aeLen(rel);
  if (r <= 0) return null;
  var n = _aeScale(rel, 1 / r);
  if (beta > 0) n = _spAberrateDir(n, head, beta);
  var depth = _aeDot(n, cam.fwd);
  if (depth <= 1e-6) return null;
  var tanH = Math.tan(_aeRad(SP_FOV_DEG) / 2);
  var x = _aeDot(n, cam.right) / depth / (tanH * _sp.w / _sp.h), y = _aeDot(n, cam.up) / depth / tanH;
  return { x: (x * 0.5 + 0.5) * _sp.w, y: (0.5 - y * 0.5) * _sp.h - (_sp.shift || 0), depth: depth * r, n: n };
}
function _spFocalPx() { return (_sp.h / 2) / Math.tan(_aeRad(SP_FOV_DEG) / 2); }

function _spApplyMatrix(mesh, basis, scale3, rel, S) {
  var m = S.basis, e = m.elements;
  // Columns: local x -> body x (lon 0), local y -> pole, local z -> minus east.
  e[0] = basis.x[0] * scale3[0]; e[1] = basis.x[1] * scale3[0]; e[2] = basis.x[2] * scale3[0]; e[3] = 0;
  e[4] = basis.z[0] * scale3[1]; e[5] = basis.z[1] * scale3[1]; e[6] = basis.z[2] * scale3[1]; e[7] = 0;
  e[8] = -basis.y[0] * scale3[2]; e[9] = -basis.y[1] * scale3[2]; e[10] = -basis.y[2] * scale3[2]; e[11] = 0;
  e[12] = rel[0]; e[13] = rel[1]; e[14] = rel[2]; e[15] = 1;
  mesh.matrix.copy(m);
  mesh.matrixWorldNeedsUpdate = true;
}

// The orbit round the Sun of one body, as a loop, from the model over one year.
function _spBuildOrbit(S, key, jd) {
  var o = S.orbits[key], b = _spBody(key), n = SP_ORBIT_POINTS, arr = o.line.geometry.attributes.position.array, ok = true;
  for (var i = 0; i < n && ok; i++) {
    var p = _spBodyPos(key, jd + b.period * i / n, 1);
    if (!p) { ok = false; break; }
    arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2];
  }
  o.line.geometry.setDrawRange(0, ok ? n : 0);
  o.line.geometry.attributes.position.needsUpdate = true;
  o.at = jd;
  o.line.visible = ok;
}
var SP_ORBIT_REBUILD_DAYS = 3652.5;

// Everything for one frame: place the camera, the bodies and the lines, and
// fill the list the labels and taps work from.
function _spUpdate() {
  var S = _sp.gl, cam = _sp.cam;
  _spPlaceCamera();
  var u = { S: S, cam: cam, jd: _sp.jd, sc: _spScaleNow(), beta: _spBeta(), lam: _sp.layout, focal: _spFocalPx(), head: _sp.flight ? _sp.flight.heading : [0, 1, 0] };
  S.ab.uBeta.value = u.beta;
  S.ab.uHead.value.set(u.head[0], u.head[1], u.head[2]);
  S.lay.uLambda.value = u.lam;
  S.lay.uCam.value.set(cam.pos[0], cam.pos[1], cam.pos[2]);
  var placed = _spPlaceBodies(u), byKey = {};
  placed.items.forEach(function (it) { byKey[it.key] = it; });
  _spDrawMarkers(u, placed.items, byKey);
  _spDrawLines(u, byKey);
  _spShadeStars(S, u.beta, u.head);   // the stars, as the ship sees them
  _spPointCamera(u, placed.minSurf);
  _sp.items = placed.items;
  _sp.byKey = byKey;
}

// Each body that is there: its place in the picture, its size on the screen, and its mesh. Returns
// what the labels and taps work from, and the distance to the nearest surface (for the near plane).
function _spPlaceBodies(u) {
  var S = u.S, cam = u.cam, items = [], minSurf = Infinity, keys = _spAllKeys();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], b = _spBody(k), it = S.items[k], abs = _spBodyPos(k, u.jd, u.sc);
    if (!abs) { if (it.mesh) { it.mesh.visible = false; if (it.ring) it.ring.visible = false; } continue; }
    var rel = _aeSub(_spDisplayAt(k, abs, u.jd, u.lam), cam.pos), dist = _aeLen(rel), R = _spShownRadius(k, u.sc);
    // The disc's size on the screen, as the ship sees it: turned by aberration too (1 / D).
    var rpx = R / Math.max(dist, 1e-18) * u.focal * _spApparentScale(_aeScale(rel, 1 / Math.max(dist, 1e-18)), u.beta, u.head);
    minSurf = Math.min(minSurf, Math.max(dist - R, 1e-12));
    var item = { key: k, kind: b.kind, parent: b.kind === 'moon' ? SP_MOONS[k].planet : null, abs: abs, rel: rel, dist: dist, R: R, rpx: rpx, scr: _spProject(rel, u.beta, u.head) };
    items.push(item);
    if (it.mesh) _spPlaceMesh(u, b, it, item);
  }
  return { items: items, minSurf: minSurf };
}
// A body's mesh (and its ring, and the Sun's glow): orientation, size, light and tint.
function _spPlaceMesh(u, b, it, item) {
  var S = u.S, rel = item.rel, R = item.R, frame = _spFrameOf(item.key, u.jd), flat = b.flat || 0;
  _spApplyMatrix(it.mesh, frame, [R, R * (1 - flat), R], rel, S);
  it.mesh.visible = item.rpx > SP_MIN_DISC_PX;
  var toSun = b.kind === 'sun' ? [1, 0, 0] : _aeNorm(_aeScale(item.abs, -1));
  it.uni.uSunDir.value.set(toSun[0], toSun[1], toSun[2]);
  var tint = _spTintFor(_aeNorm(rel), u.beta, u.head);
  it.uni.uTint.value.set(tint[0], tint[1], tint[2]);
  if (it.ring) {
    _spApplyMatrix(it.ring, frame, [R, R, R], rel, S);
    it.ring.visible = item.rpx > SP_MIN_DISC_PX;
    it.ringUni.uCenter.value.set(rel[0], rel[1], rel[2]);
    it.ringUni.uRadius.value = R;
  }
  if (b.kind === 'sun') {
    S.glowUni.uCenter.value.set(rel[0], rel[1], rel[2]);
    S.glowUni.uSize.value = Math.max(R * SP_GLOW_RADII, item.dist * SP_GLOW_MIN_PX / u.focal);
    S.glowUni.uTint.value.set(tint[0], tint[1], tint[2]);
  }
}

// Markers: a ring round anything too small to see as a disc, a square on a probe, a ring on the
// chosen body, the place the light shows it, the flash of light that left with the ship.
function _spDrawMarkers(u, items, byKey) {
  var S = u.S, M = S.markers, markers = 0, ringPx = u.lam > 0.5 ? SP_MARKER_LAYOUT_PX : SP_MARKER_PX;
  function mark(rel, rgb, alpha, size, kind) { if (markers < SP_MARKER_CAPACITY) _aeSetPoint(M, markers++, rel, rgb, alpha, size, kind); }
  items.forEach(function (t) {
    var tb = _spBody(t.key), sel = _sp.selected === t.key, col = _spHexRGB(tb.color);
    if (tb.kind === 'probe') { mark(t.rel, col, 1, sel ? SP_PROBE_PX + SP_PROBE_SELECT_PX : SP_PROBE_PX, SP_KIND_PROBE); return; }
    var a = _aeClamp((SP_RING_FADE_PX - t.rpx) / (SP_RING_FADE_PX - SP_AU_TO_PX_MIN), 0, 1);
    var par = tb.kind === 'moon' ? byKey[t.parent] : null;
    if (par && t.scr && par.scr && Math.hypot(t.scr.x - par.scr.x, t.scr.y - par.scr.y) < SP_MOON_APART_PX) a = 0;
    if (a > 0.01) mark(t.rel, col, SP_RING_ALPHA * a, ringPx, SP_KIND_RING);
    if (sel && t.rpx < SP_SELECT_RING_MAX_PX) mark(t.rel, SP_SELECT_COLOUR, 1, Math.max(SP_SELECT_RING_MIN_PX, t.rpx * 2 + SP_SELECT_RING_PAD_PX), SP_KIND_RING);
  });
  // The place the light shows the selected body to the ship, if that is not where it is
  // (parked, and in the true places: the laid-out picture has no such place).
  S.ghost = null;
  if (_sp.selected && byKey[_sp.selected] && !_sp.flight && !u.lam) {
    var sk = _sp.selected, st = byKey[sk];
    var seen = _spRetarded(function (j) { return _spBodyPos(sk, j, u.sc) || st.abs; }, _spShipPos(), u.jd);
    var gp = _spProject(_aeSub(seen.pos, u.cam.pos), u.beta, u.head);
    if (gp && st.scr && Math.hypot(gp.x - st.scr.x, gp.y - st.scr.y) > SP_GHOST_MIN_OFFSET_PX) {
      mark(_aeSub(seen.pos, u.cam.pos), SP_GHOST_COLOUR, SP_GHOST_ALPHA, SP_GHOST_PX, SP_KIND_GHOST);
      S.ghost = { x: gp.x, y: gp.y, lagSec: seen.lagSec };
    }
  }
  S.lightDot = null;
  if (_sp.flight) {
    var f = _sp.flight, lightAU = Math.min(f.trueDist, f.now.earthSec / LIGHT_SECONDS_PER_AU);
    var lp = _spAdd(f.from, _aeScale(f.heading, (f.camLen + f.stand) * lightAU / f.trueDist)), lrel = _aeSub(lp, u.cam.pos);
    mark(lrel, SP_LIGHT_COLOUR, 1, SP_LIGHT_PX, SP_KIND_GLOW);
    var lpr = _spProject(lrel, u.beta, u.head);
    if (lpr) S.lightDot = { x: lpr.x, y: lpr.y };
  }
  _aeCommitPoints(M, markers);
}

// Lines. In the laid-out picture their points are mapped in the vertex shader (and need no offset);
// in true places each is moved by the camera's place so a point is exact however far out it is.
function _spDrawLines(u, byKey) {
  var S = u.S, cam = u.cam, neg = u.lam > 0 ? [0, 0, 0] : [-cam.pos[0], -cam.pos[1], -cam.pos[2]];
  Object.keys(S.orbits).forEach(function (ok) {
    var o = S.orbits[ok];
    if (o.at === null || Math.abs(u.jd - o.at) > SP_ORBIT_REBUILD_DAYS) _spBuildOrbit(S, ok, u.jd);
    o.line.position.set(neg[0], neg[1], neg[2]);
  });
  Object.keys(S.moonRings).forEach(function (mk) {
    var ring = S.moonRings[mk], parent = SP_MOONS[mk].planet, pp = byKey[parent];
    ring.visible = !!pp && u.lam < 0.5;
    if (!ring.visible) return;
    var pole = parent === 'Earth' ? [0, 0, 1] : _spPoleEcl(parent), x = parent === 'Earth' ? [1, 0, 0] : _aeNorm(_aeCross([0, 0, 1], pole));
    var y = _aeCross(pole, x), r = SP_MOONS[mk].a / AU_KM * u.sc.moon(parent), e = S.basis.elements;
    e[0] = x[0] * r; e[1] = x[1] * r; e[2] = x[2] * r; e[3] = 0;
    e[4] = y[0] * r; e[5] = y[1] * r; e[6] = y[2] * r; e[7] = 0;
    e[8] = pole[0]; e[9] = pole[1]; e[10] = pole[2]; e[11] = 0;
    e[12] = pp.rel[0]; e[13] = pp.rel[1]; e[14] = pp.rel[2]; e[15] = 1;
    ring.matrix.copy(S.basis);
    ring.matrixWorldNeedsUpdate = true;
  });
  // A probe's path is drawn for the one chosen: a dozen paths at once say "things went out there", not where.
  Object.keys(S.trails).forEach(function (tk) {
    var tr = S.trails[tk], track = _spTrack(tk), shown = tk === _sp.selected && track && _spTrackState(track, u.jd) === 'flying';
    tr.past.visible = tr.future.visible = !!shown;
    if (!shown) return;
    var idx = _spTrailIndex(track, tr.offsets, u.jd), whole = Math.floor(idx) + 1;
    tr.past.geometry.setDrawRange(0, whole);
    tr.future.geometry.setDrawRange(whole - 1, tr.count - whole + 1);
    tr.past.position.set(neg[0], neg[1], neg[2]);
    tr.future.position.set(neg[0], neg[1], neg[2]);
  });
}

// The camera: where it looks, its depth range and the middle of its picture.
function _spPointCamera(u, minSurf) {
  var S = u.S, cam = u.cam, m = S.basis.elements;
  m[0] = cam.right[0]; m[1] = cam.right[1]; m[2] = cam.right[2]; m[3] = 0;
  m[4] = cam.up[0]; m[5] = cam.up[1]; m[6] = cam.up[2]; m[7] = 0;
  m[8] = -cam.fwd[0]; m[9] = -cam.fwd[1]; m[10] = -cam.fwd[2]; m[11] = 0;
  m[12] = m[13] = m[14] = 0; m[15] = 1;
  S.camera.quaternion.setFromRotationMatrix(S.basis);
  S.camera.near = _aeClamp(SP_NEAR_FRACTION * minSurf, SP_NEAR_MIN_AU, 1);
  S.camera.far = SP_FAR_AU;
  S.camera.aspect = _sp.w / _sp.h;
  // The scene's middle sits in the clear part of the screen, above the card.
  if (_sp.shift) S.camera.setViewOffset(_sp.w, _sp.h, 0, _sp.shift, _sp.w, _sp.h);
  else if (S.camera.view) S.camera.clearViewOffset();
  S.camera.updateProjectionMatrix();
}

// ── Labels and taps ──
function _spLabelEl(key) {
  var el = _sp.labelPool[key];
  if (el) return el;
  el = document.createElement('span');
  el.className = 'ae-label sp-label';
  el.hidden = true;
  _aeById('sp-labels').appendChild(el);
  return (_sp.labelPool[key] = el);
}
var SP_LABEL_ORDER = { sun: 0, planet: 1, dwarf: 2, probe: 3, moon: 4 };
function _spLabels() {
  var items = _sp.items || [], placed = [], W = _sp.w, H = _sp.h;
  var order = items.slice().sort(function (a, b) {
    if ((_sp.selected === a.key) !== (_sp.selected === b.key)) return _sp.selected === a.key ? -1 : 1;
    return (SP_LABEL_ORDER[a.kind] - SP_LABEL_ORDER[b.kind]) || (a.dist - b.dist);
  });
  var shown = {};
  _sp.projected = [];
  order.forEach(function (it) {
    var s = it.scr;
    if (!s || s.x < -40 || s.x > W + 40 || s.y < -20 || s.y > H + 20) return;
    _sp.projected.push({ key: it.key, x: s.x, y: s.y, rpx: it.rpx, kind: it.kind, parent: it.parent });
    var par = it.kind === 'moon' ? _sp.byKey[it.parent] : null;
    if (par && par.scr && Math.hypot(s.x - par.scr.x, s.y - par.scr.y) < SP_MOON_APART_PX) return;
    if (items.some(function (o) { return o !== it && o.scr && o.dist < it.dist && o.rpx > SP_COVER_PX && Math.hypot(s.x - o.scr.x, s.y - o.scr.y) < o.rpx; })) return;
    var el = _spLabelEl(it.key), name = _spName(it.key);
    _spSetText(el, name);
    // A name goes beside its body, or if that is taken to the other side, above or below it:
    // one is dropped only when all four are taken.
    var w = name.length * SP_LABEL_CHAR_W + 8, gap = Math.max(SP_LABEL_GAP_PX, it.rpx + 6), x = 0, y = 0, rect = null;
    var spots = [[s.x + gap, s.y - SP_LABEL_H / 2], [s.x - gap - w, s.y - SP_LABEL_H / 2], [s.x - w / 2, s.y - gap - SP_LABEL_H], [s.x - w / 2, s.y + gap]];
    for (var c = 0; c < spots.length && !rect; c++) {
      var r = [spots[c][0], spots[c][1], spots[c][0] + w, spots[c][1] + SP_LABEL_H];
      var taken = r[0] < 0 || r[2] > W || placed.some(function (q) { return r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]; });
      if (!taken) { rect = r; x = spots[c][0]; y = spots[c][1]; }
    }
    if (!rect) return;
    placed.push(rect);
    shown[it.key] = true;
    el.hidden = false;
    el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    el.classList.toggle('sp-sel', _sp.selected === it.key);
    el.classList.toggle('sp-probe', it.kind === 'probe');
    el.classList.toggle('sp-moon', it.kind === 'moon');
  });
  Object.keys(_sp.labelPool).forEach(function (k) { if (!shown[k]) _sp.labelPool[k].hidden = true; });
  var S = _sp.gl, g = _aeById('sp-ghost'), l = _aeById('sp-light');
  if (g) {
    g.hidden = !S.ghost;
    if (S.ghost) {
      g.style.transform = 'translate(' + (S.ghost.x + 10).toFixed(1) + 'px,' + (S.ghost.y - 7).toFixed(1) + 'px)';
      _spSetText(g, _aeT('sp_ghost_label', { body: _spName(_sp.at) }));
    }
  }
  if (l) {
    l.hidden = !S.lightDot;
    if (S.lightDot) {
      l.style.transform = 'translate(' + (S.lightDot.x + 14).toFixed(1) + 'px,' + (S.lightDot.y - SP_LABEL_H * 1.6).toFixed(1) + 'px)';
      _spSetText(l, _aeT('sp_light_label'));
    }
  }
}
function _spTapAt(x, y) { _spSelect(_spPick(_sp.projected || [], x, y)); }

// ── The page ──
function _spDom() {
  var host = _aeById('almanac-view');
  if (!host) return null;
  var el = document.createElement('div');
  el.className = 'ae-view sp-view';
  el.id = 'sp-view';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', _aeT('sp_open'));
  var tab = function (id, key) { return '<button type="button" class="ae-btn" ' + id + ' aria-pressed="false">' + _almEsc(_aeT(key)) + '</button>'; };
  el.innerHTML =
    '<canvas class="ae-canvas" id="sp-canvas" tabindex="0" role="img"></canvas>' +
    '<div class="ae-labels" id="sp-labels">' +
      '<span class="ae-label sp-label" id="sp-ghost" hidden></span><span class="ae-label sp-label" id="sp-light" hidden></span>' +
    '</div>' +
    '<div class="ae-msg" id="sp-msg"></div>' +
    '<div class="ae-top sp-top">' +
      '<div class="sp-top-row">' +
        '<button type="button" class="ae-btn ae-back" id="sp-back"><span class="ae-chev" aria-hidden="true">‹</span> ' + _almEsc(_aeT('alm_solar_system')) + '</button>' +
        '<div class="ae-when-col"><div class="ae-when"><b id="sp-when"></b></div>' +
          '<button type="button" class="ae-btn ae-now" id="sp-now" hidden>' + _almEsc(_aeT('alm_now')) + '</button></div>' +
      '</div>' +
      '<div class="ae-tools sp-tools">' +
        '<button type="button" class="ae-btn" id="sp-scale" aria-pressed="false"></button>' +
        '<button type="button" class="ae-btn" id="sp-time"></button>' +
      '</div>' +
    '</div>' +
    '<div class="ae-bottom">' +
      '<div class="ae-card sp-card" id="sp-card" hidden></div>' +
      '<div class="sp-cap" id="sp-cap" hidden aria-live="polite"></div>' +
      '<div class="sp-hud" id="sp-hud" hidden></div>' +
      '<div class="sp-speed"><label for="sp-slider">' + _almEsc(_aeT('sp_speed')) + '</label>' +
        '<input type="range" id="sp-slider" min="0" max="' + SP_BETA_STEPS + '" step="1"><output id="sp-speedout" for="sp-slider"></output></div>' +
      '<div class="sp-tabs" id="sp-tabs" role="group" aria-label="' + _almEsc(_aeT('sp_destinations')) + '">' +
        '<button type="button" class="ae-btn" data-sp-overview="1">' + _almEsc(_aeT('sp_overview')) + '</button>' +
        SP_GROUPS.map(function (g) { return tab('data-sp-tab="' + g.id + '"', g.label); }).join('') +
      '</div>' +
      '<div class="sp-chips" id="sp-chips" role="group"></div>' +
    '</div>';
  host.appendChild(el);
  return el;
}
// The destinations in three groups, the way the person thinks of them.
var SP_GROUPS = [
  { id: 'planets', label: 'sp_group_planets', kinds: ['sun', 'planet', 'dwarf'] },
  { id: 'moons', label: 'sp_group_moons', kinds: ['moon'] },
  { id: 'probes', label: 'sp_group_probes', kinds: ['probe'] }
];
function _spGroupOf(key) {
  var kind = _spBody(key).kind;
  return SP_GROUPS.filter(function (g) { return g.kinds.indexOf(kind) >= 0; })[0].id;
}
function _spChipsHtml() {
  return _spAllKeys().map(function (k) {
    return '<button type="button" class="ae-btn" data-sp-key="' + k + '" data-sp-group="' + _spGroupOf(k) + '" aria-pressed="false">' + _almEsc(_spName(k)) + '</button>';
  }).join('');
}
// Only the chips of the chosen group show.
function _spShowGroup(id) {
  _sp.group = id;
  var tabs = _aeById('sp-tabs').querySelectorAll('[data-sp-tab]'), chips = _aeById('sp-chips').querySelectorAll('[data-sp-key]'), i;
  for (i = 0; i < tabs.length; i++) tabs[i].setAttribute('aria-pressed', String(tabs[i].getAttribute('data-sp-tab') === id));
  for (i = 0; i < chips.length; i++) chips[i].hidden = chips[i].getAttribute('data-sp-group') !== id;
}

function _spEnsure() {
  if (_sp) return true;
  _spEnsureStyles();
  var el = _spDom();
  if (!el) return false;
  _sp = _spNewState(el);
  _spBindControls();
  _spBindCanvas(_aeById('sp-canvas'));
  // The view follows its own size (a phone turned over), and draws again when the tab comes back.
  if (typeof ResizeObserver === 'function') new ResizeObserver(_spResize).observe(_sp.el);
  else window.addEventListener('resize', _spResize);
  document.addEventListener('visibilitychange', function () {
    if (!_spIsOpen || document.hidden) return;
    setTimeout(_aePauseAlmanac, 0);   // the Almanac resumes its own loops on return; the view covers them
    _sp.lastTs = 0; _sp.dirty = true;
    _spKick();
  });
  return true;
}

// ── Loading ──
var _spLoading = null;
function _spPrepare() {
  if (_sp.gl) return Promise.resolve(true);
  if (_sp.failed) return Promise.resolve(false);
  if (_spLoading) return _spLoading;
  var tracks = fetch(SP_TRACKS_URL).then(function (r) { if (!r.ok) throw new Error('tracks'); return r.json(); })
    .then(function (j) { _spSetTracks(j); return true; }, function () { _sp.noProbes = true; return false; });
  _spLoading = Promise.all([_aeLoadThree(), tracks]).then(function (res) {
    _spLoading = null;
    if (!_spIsOpen) return false;
    _spBodyIndex = null;
    var S = _spBuildGl(res[0], _aeById('sp-canvas'), _spTracks);
    if (!S) { _sp.failed = true; return false; }
    _sp.gl = S;
    _spSetStars(S, _aeStarList());
    _aeById('sp-chips').innerHTML = _spChipsHtml();
    _spShowGroup(_sp.group);
    _spLoadMaps(S);
    return true;
  }, function () { _spLoading = null; return false; });
  return _spLoading;
}

// ── Open and close ──
function openAlmanacSpace() {
  if (_spIsOpen || !_spEnsure()) return;
  _spIsOpen = true;
  _sp.opener = document.activeElement;
  _sp.el.classList.add('open');
  _aePauseAlmanac();
  if (typeof _sgRetryLoads === 'function') _sgRetryLoads();   // an open asks again for the stars that failed before
  // The idle-prepared 3D Earth is covered by this view: its GPU memory goes back (it is made again when it is opened).
  if (typeof _aeRelease === 'function' && !(typeof _aeIsOpen !== 'undefined' && _aeIsOpen)) _aeRelease();
  _aeStepIn();
  // The page's moment (its time machine, or now), with the orrery's own speed settled into it as the Earth view does.
  if (typeof _aeAdoptOrreryClock === 'function') _aeAdoptOrreryClock();
  _sp.jd = _dateToJD(_aeDisplayMs());
  _sp.openJd = _sp.jd;
  _sp.selected = null; _sp.flight = null; _sp.glide = null; _sp.lastTrip = null; _sp.caption = null;
  _sp.rateIdx = 0; _sp.beta = 0.1; _sp.at = 'Earth'; _sp.pendingFly = null;
  Object.assign(_sp.cam, { follow: 'Sun', dist: SP_OVERVIEW_DIST_AU, az: SP_START_AZIMUTH, el: SP_OVERVIEW_ELEVATION, lookYaw: 0, lookPitch: 0 });
  _sp.layout = _sp.layoutTarget = 1; _sp.moved = false; _sp.group = 'planets'; _sp.capQueue = []; _sp.seen = {};
  _aeById('sp-back').focus({ preventScroll: true });
  _spMessage(_aeT('sp_loading'));
  _spPrepare().then(function (ok) {
    if (!_spIsOpen) return;
    if (!ok) { _spMessage(_aeT(_sp.failed ? 'sp_nogl' : 'sp_unavailable')); return; }
    _spMessage('');
    _spSyncControls();
    _spShowCaption('start');
    _spResize();
    _sp.dirty = true;
    _spKick();
    _aeCoverAlmanac(true);
  });
  _aeCoverAlmanac(true);
}
function _spMessage(text) {
  var m = _aeById('sp-msg');
  if (!m) return;
  m.textContent = text || '';
  m.hidden = !text;
  _sp.el.classList.toggle('ae-blank', !!text);
}
function _spClose() {
  if (!_spIsOpen) return;
  _spIsOpen = false;
  _aeStepOut();
  _spStop();
  _sp.el.classList.remove('open');
  _spDisposeGl();
  _aeCoverAlmanac(false);
  if (typeof _almanacOpen === 'undefined' || _almanacOpen) _aeResumeAlmanac();
  var back = _sp.opener;
  if (back && back.focus && document.contains(back)) back.focus({ preventScroll: true, focusVisible: !!_sp.closedByKey });
  _sp.closedByKey = false;
}
function _spStop() {
  if (_sp.raf) { cancelAnimationFrame(_sp.raf); _sp.raf = 0; }
  if (_sp.idleTimer) { clearTimeout(_sp.idleTimer); _sp.idleTimer = 0; }
  _sp.flight = null; _sp.glide = null; _sp.pointers = {}; _sp.drag = _sp.pinch = null;
}
// Give the GPU back: every geometry, material and map, then the context itself.
// A lost context cannot be had again from its canvas, so a fresh one takes its place.
function _spDisposeGl() {
  var S = _sp && _sp.gl;
  if (!S) return;
  _sp.gl = null;
  _aeFreeGl(S);
  _aeFreshCanvas('sp-canvas', _spBindCanvas);
  Object.keys(_sp.labelPool).forEach(function (k) { _sp.labelPool[k].remove(); });
  _sp.labelPool = {};
}
// Leaving the Almanac: the view closes and gives the GPU back.
function _spRelease() {
  if (!_sp) return;
  if (_spIsOpen) { _aeStepped = false; _spClose(); }
  else _spDisposeGl();
}

// The scene is centred in what the controls leave clear: the screen between the
// top bar and the card (or the bottom controls), not behind them.
var SP_TOP_GRADIENT_PX = 28;   // the top bar's fade below its last control (.ae-top padding)
function _spUpdateShift() {
  if (!_sp || !_sp.el || !_sp.h) return;
  var box = _sp.el.getBoundingClientRect(), edge = _sp.el.querySelector('.ae-bottom').getBoundingClientRect().top - box.top;
  var top = _sp.el.querySelector('.ae-top').getBoundingClientRect().bottom - box.top - SP_TOP_GRADIENT_PX;
  var card = _aeById('sp-card');
  if (!card.hidden && card.getClientRects().length) edge = Math.min(edge, card.getBoundingClientRect().top - box.top);
  var shift = Math.round(_aeClamp(_sp.h / 2 - (top + edge) / 2, 0, _sp.h * 0.4));
  if (shift !== _sp.shift) { _sp.shift = shift; _sp.dirty = true; _spKick(); }
}
function _spResize() {
  if (!_sp || !_sp.gl) return;
  var c = _aeById('sp-canvas'), r = c.getBoundingClientRect();
  _sp.w = Math.max(1, Math.round(r.width)); _sp.h = Math.max(1, Math.round(r.height));
  _sp.gl.renderer.setSize(_sp.w, _sp.h, false);
  _spUpdateShift();
  _sp.dirty = true;
  _spKick();
}

// ── The loop ──
// Draws while something moves (a flight, a drag, a running clock) or after a
// change, and not at all otherwise: a parked, still view costs nothing.
function _spKick() {
  if (!_spIsOpen || !_sp.gl) return;
  if (!_sp.raf) _sp.raf = requestAnimationFrame(_spFrame);
}
function _spRate() { return SP_TIME_RATES[_sp.rateIdx]; }
function _spBusy() { return !!(_sp.flight || _sp.glide || _sp.drag || _sp.pinch || _spRate() > 0 || _sp.layout !== _sp.layoutTarget); }
function _spFrame() {
  _sp.raf = 0;
  if (!_spIsOpen || !_sp.gl || document.hidden) return;
  if (typeof _almanacOpen !== 'undefined' && !_almanacOpen) { _spClose(); return; }
  var now = performance.now(), dt = _sp.lastTs ? Math.min(now - _sp.lastTs, 100) : 16;
  _sp.lastTs = now;
  if (_sp.flight) _spStepFlight(dt);
  else if (_spRate() > 0) { _sp.jd += _spRate() * dt / 1000; _sp.moved = true; }
  _spStepGlide(dt);
  _spStepLayout(dt);
  var busy = _spBusy();
  if (_sp.dirty || busy) {
    _spUpdate();
    _sp.gl.renderer.render(_sp.gl.scene, _sp.gl.camera);
    _spLabels();
    _sp.dirty = false;
    _spUpdateText();
  }
  if (busy || _sp.dirty) _sp.raf = requestAnimationFrame(_spFrame);
  else _sp.lastTs = 0;
}

// ── Input ──
function _spZoomBy(f) {
  var cam = _sp.cam;
  if (_sp.flight) return;
  _sp.glide = null; _sp.pendingFly = null;
  if (!cam.follow) cam.follow = 'Sun';
  cam.dist = _aeClamp(cam.dist * f, _spMinDist(cam.follow), SP_MAX_DIST_AU);
  if (_sp.layoutTarget && cam.dist < SP_LAYOUT_ZOOM_OFF) _spSetLayout(0);   // zoomed in, the true places take over
  _sp.dirty = true; _spKick();
}
function _spTurnBy(dx, dy) {
  var cam = _sp.cam;
  if (_sp.flight) {
    cam.lookYaw = _aeClamp(cam.lookYaw + dx * SP_DRAG_RAD_PER_PX, -SP_MAX_LOOK_YAW, SP_MAX_LOOK_YAW);
    cam.lookPitch = _aeClamp(cam.lookPitch + dy * SP_DRAG_RAD_PER_PX, -SP_MAX_PITCH, SP_MAX_PITCH);
  } else {
    _sp.glide = null; _sp.pendingFly = null;
    if (!cam.follow) cam.follow = 'Sun';
    cam.az -= dx * SP_DRAG_RAD_PER_PX;
    cam.el = _aeClamp(cam.el + dy * SP_DRAG_RAD_PER_PX, -SP_MAX_PITCH, SP_MAX_PITCH);
  }
  _sp.dirty = true; _spKick();
}
function _spBindCanvas(canvas) {
  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId);
    _sp.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(_sp.pointers);
    if (ids.length === 1) _sp.drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false };
    else if (ids.length === 2) {
      var a = _sp.pointers[ids[0]], b = _sp.pointers[ids[1]];
      _sp.pinch = { span: Math.hypot(a.x - b.x, a.y - b.y) };
      _sp.drag = null;
    }
    canvas.classList.add('ae-dragging');
    _spKick();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!_sp.pointers[e.pointerId]) return;
    _sp.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(_sp.pointers);
    if (_sp.pinch && ids.length >= 2) {
      var a = _sp.pointers[ids[0]], b = _sp.pointers[ids[1]], span = Math.hypot(a.x - b.x, a.y - b.y);
      if (span > 0 && _sp.pinch.span > 0) _spZoomBy(_sp.pinch.span / span);
      _sp.pinch.span = span;
    } else if (_sp.drag) {
      var dx = e.clientX - _sp.drag.x, dy = e.clientY - _sp.drag.y;
      _sp.drag.x = e.clientX; _sp.drag.y = e.clientY;
      if (Math.hypot(e.clientX - _sp.drag.x0, e.clientY - _sp.drag.y0) > SP_TAP_SLOP_PX) _sp.drag.moved = true;
      if (_sp.drag.moved) _spTurnBy(dx, dy);
    }
  });
  function end(e) {
    if (!_sp.pointers[e.pointerId]) return;
    delete _sp.pointers[e.pointerId];
    var left = Object.keys(_sp.pointers).length;
    if (_sp.drag && !_sp.drag.moved && left === 0 && e.type === 'pointerup') {
      var r = canvas.getBoundingClientRect();
      _spTapAt(e.clientX - r.left, e.clientY - r.top);
    }
    if (left < 2) _sp.pinch = null;
    if (left === 0) { _sp.drag = null; canvas.classList.remove('ae-dragging'); }
    else if (left === 1) {
      var p = _sp.pointers[Object.keys(_sp.pointers)[0]];
      _sp.drag = { x: p.x, y: p.y, x0: p.x, y0: p.y, moved: true };
    }
    _sp.dirty = true; _spKick();
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); _spZoomBy(Math.exp(e.deltaY * SP_WHEEL_ZOOM)); }, { passive: false });
}
var SP_KEY_ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
function _spBindControls() {
  var el = _sp.el;
  el.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _sp.closedByKey = true; _spClose(); return; }
    if (e.target !== _aeById('sp-canvas')) return;
    var arrow = SP_KEY_ARROWS[e.key], handled = true;
    if (arrow) _spTurnBy(arrow[0] * SP_KEY_TURN / SP_DRAG_RAD_PER_PX, arrow[1] * SP_KEY_TURN / SP_DRAG_RAD_PER_PX);
    else if (e.key === '+' || e.key === '=') _spZoomBy(1 / SP_KEY_ZOOM);
    else if (e.key === '-' || e.key === '_') _spZoomBy(SP_KEY_ZOOM);
    else handled = false;
    if (handled) e.preventDefault();
  });
  _aeById('sp-back').addEventListener('click', _spClose);
  _aeById('sp-scale').addEventListener('click', function () {
    if (_sp.flight) return;
    _sp.scaleMode = _sp.scaleMode === 'true' ? 'readable' : 'true';
    if (_sp.cam.follow) _sp.cam.dist = Math.max(_sp.cam.dist, _spMinDist(_sp.cam.follow));
    _spSyncControls(); _spShowCaption('scale'); _sp.dirty = true; _spKick();
  });
  _aeById('sp-time').addEventListener('click', function () {
    _sp.rateIdx = (_sp.rateIdx + 1) % SP_TIME_RATES.length;
    _spSyncControls(); _sp.dirty = true; _spKick();
  });
  _aeById('sp-now').addEventListener('click', function () {
    if (_sp.flight) return;
    _sp.jd = _sp.openJd = _dateToJD(Date.now()); _sp.rateIdx = 0; _sp.moved = false;
    _spSyncControls(); _spUpdateText(); _sp.dirty = true; _spKick();
  });
  _aeById('sp-slider').addEventListener('input', function (e) {
    if (_sp.flight) return;
    _sp.beta = _spSliderToBeta(+e.target.value);
    _spSyncControls(); _sp.dirty = true; _spKick();
  });
  function tabsOrChips(e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-sp-overview')) _spOverview();
    else if (b.hasAttribute('data-sp-tab')) _spShowGroup(b.getAttribute('data-sp-tab'));
    else if (b.hasAttribute('data-sp-key')) _spSelect(b.getAttribute('data-sp-key'));
  }
  _aeById('sp-chips').addEventListener('click', tabsOrChips);
  _aeById('sp-tabs').addEventListener('click', tabsOrChips);
  _aeById('sp-card').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-sp-fly')) _spLaunch(b.getAttribute('data-sp-fly'));
    else if (b.hasAttribute('data-sp-skip')) _spSkipFlight();
    else if (b.hasAttribute('data-sp-close')) _spSelect(null);
    else if (b.hasAttribute('data-sp-lib')) _spOpenLibrary(b);
  });
  _aeById('sp-cap').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !_sp.caption) return;
    if (b.hasAttribute('data-sp-why')) { _sp.whyOpen = !_sp.whyOpen; _sp.caption.until = 0; _spRenderCaption(); }
    else if (b.hasAttribute('data-sp-ok')) _spDismissCaption();
  });
}

// Markup and text are written only when they change: rewriting a node every frame
// loses a tap that landed on it and makes a live region announce the same words again.
function _spSetHtml(el, html) { if (el._spHtml !== html) { el.innerHTML = html; el._spHtml = html; } }
function _spSetText(el, text) { if (el._spText !== text) { el.textContent = text; el._spText = text; } }

// ── Selecting, and the card ──
function _spSelect(key) {
  if (key && _sp.caption && _sp.caption.kind === 'start') _spDismissCaption();
  _sp.selected = key;
  _sp.libToken = (_sp.libToken || 0) + 1;
  _spRenderCard();
  if (key && _spGroupOf(key) !== _sp.group) _spShowGroup(_spGroupOf(key));
  var chips = _aeById('sp-chips').querySelectorAll('[data-sp-key]');
  for (var i = 0; i < chips.length; i++) chips[i].setAttribute('aria-pressed', String(chips[i].getAttribute('data-sp-key') === key));
  if (key) {
    var chip = _aeById('sp-chips').querySelector('[data-sp-key="' + key + '"]');
    if (chip && chip.scrollIntoView) chip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: _spReduceMotion() ? 'auto' : 'smooth' });
    _spLoadLibrary(key);
    _spShowSelection(key);
  }
  _sp.dirty = true;
  _spKick();
}
// What was chosen is shown: if it is off the screen (a spacecraft 170 AU out, seen from beside
// Jupiter) the camera goes back out to the whole system, where everything is in view.
function _spShowSelection(key) {
  if (_sp.flight || _sp.glide || _sp.pendingFly) return;
  var it = _sp.byKey && _sp.byKey[key], on = it && it.scr && it.scr.x > 0 && it.scr.x < _sp.w && it.scr.y > 0 && it.scr.y < _sp.h;
  if (!on && !_sp.layoutTarget) _spOverview(true);
}
function _spFmtDist(au) {
  return au < 0.01 ? _orrNum(au * AU_KM, 'kilometer', 0) : _orrNum(au, null, au < 10 ? 2 : 1) + ' AU';
}
function _spKindLine(key) {
  var b = _spBody(key);
  if (b.kind === 'moon') return _aeT('sp_kind_moon', { planet: _spName(SP_MOONS[key].planet) });
  return _aeT('sp_kind_' + b.kind);
}
function _spEventText(ev) {
  var kind = ev[1], body = ev[2] ? (ev[2] === 'L2' ? _aeT('sp_l2') : (_spBody(ev[2]) ? _spName(ev[2]) : _aeT('sp_n_' + ev[2].toLowerCase()))) : '';
  return _aeT('sp_ev_' + kind, { body: body });
}
// The most recent milestone of a probe at jd, and its date.
function _spLastEvent(track, jd) {
  var last = null;
  track.events.forEach(function (ev) { if (ev[0] <= jd && (!last || ev[0] >= last[0])) last = ev; });
  return last;
}
function _spRenderCard() {
  var card = _aeById('sp-card'), key = _sp.selected;
  if (!key) { card.hidden = true; card.innerHTML = ''; _spUpdateShift(); return; }
  var b = _spBody(key), link = _spLinkKey(key), nameHtml = _almEsc(_spName(key));
  if (typeof _aeLinked === 'function' && _aeLinked(link)) nameHtml = _aeLink(link, nameHtml);
  card.innerHTML =
    '<button type="button" class="ae-card-x" data-sp-close="1" aria-label="' + _almEsc(_aeT('close')) + '">×</button>' +
    '<h3>' + nameHtml + ' <small class="sp-kind">' + _almEsc(_spKindLine(key)) + '</small></h3>' +
    '<div id="sp-card-lines"></div>' +
    '<div class="sp-go"><button type="button" class="ae-btn sp-fly" id="sp-fly" data-sp-fly="' + key + '">' + _almEsc(_aeT('alm_orr_fly')) + '</button></div>' +
    '<div class="sp-lib" id="sp-lib"></div>';
  card.hidden = false;
  _sp.lastCard = '';
  _spUpdateCardLines();
  _spUpdateShift();
}
// The lines that change with the time and the camera: how far, how old the light is, how long the trip.
function _spUpdateCardLines() {
  var key = _sp.selected, box = _aeById('sp-card-lines');
  if (!key || !box) return;
  var b = _spBody(key), jd = _sp.jd, lines = [];
  var fly = _aeById('sp-fly'), trip = _spTripBetween(_sp.at, key, jd, _sp.beta);
  var here = key === _sp.at && !_sp.flight, nogo = _spNoGo(key);
  if (!trip) {
    var track = _spTrack(b.track), before = track && jd < track.jd0;
    lines.push(_aeT(before ? 'sp_not_yet' : 'sp_over', { date: _spFmtDate(before ? track.events[0][0] : track.jd1) }));
  } else {
    lines.push(here ? _aeT('sp_here') : _aeT('sp_dist_light', { au: _spFmtDist(trip.distAU), time: _orrFmtSpan(trip.lightSec) }));
    if (!_sp.flight && !here && !nogo && trip.legAU > 1e-9) {
      var diff = (trip.earthSec - trip.shipSec) / trip.earthSec > 0.005;
      lines.push(diff ? _aeT('sp_trip_two', { speed: _orrFmtBeta(_sp.beta), earth: _orrFmtSpan(trip.earthSec), ship: _orrFmtSpan(trip.shipSec) })
                      : _aeT('sp_trip', { speed: _orrFmtBeta(_sp.beta), time: _orrFmtSpan(trip.earthSec) }));
    }
    if (nogo === 'gone') lines.push(_aeT('sp_gone_before'));
    if (b.kind === 'probe') {
      lines.push(_aeT('sp_from_sun', { au: _spFmtDist(_aeLen(_spBodyPos(key, jd))) }));
      var ev = _spLastEvent(_spTrack(b.track), jd);
      if (ev) lines.push(_spEventText(ev) + ', ' + _spFmtDate(ev[0]));
    }
  }
  if (fly) { fly.disabled = !!_sp.flight || !!nogo; fly.hidden = here; }
  if (_sp.lastTrip && _sp.lastTrip.key === key && !_sp.flight) {
    var te = _orrFmtSpan(_sp.lastTrip.earthSec), ts = _orrFmtSpan(_sp.lastTrip.shipSec);
    lines.push(te === ts ? _aeT('sp_took_one', { time: te }) : _aeT('sp_took', { earth: te, ship: ts }));
  }
  _spSetHtml(box, lines.map(function (l) { return '<span class="sp-line">' + _almEsc(l) + '</span>'; }).join(''));
  _spUpdateShift();
}

// ── The library: what the installed ZIMs say about the body ──
// Found when a body is selected, never before: its article by Q-ID (the name
// above, when it resolves), talks about it, a question about it, an orbit
// sandbox. A chip appears only for something that is installed.
function _spZimsLike(re) { return (typeof zimsCache !== 'undefined' && zimsCache ? zimsCache : []).filter(function (z) { return re.test(z.name || ''); }); }
function _spLibChip(label, attrs) {
  return '<button type="button" class="ae-btn" data-sp-lib="1" ' + attrs + '>' + _almEsc(label) + '</button>';
}
function _spLoadLibrary(key) {
  var token = _sp.libToken, box = _aeById('sp-lib');
  if (!box) return;
  box.innerHTML = '';
  var add = function (html) { if (token === _sp.libToken && _aeById('sp-lib')) _aeById('sp-lib').insertAdjacentHTML('beforeend', html); };
  var name = _spName(key), english = _spBody(key).kind === 'probe' ? _spTrack(_spBody(key).track).name : key;
  // Talks.
  if (typeof _installedVideoZims === 'function' && _installedVideoZims().length) {
    fetch('/tube?q=' + encodeURIComponent(english) + '&limit=2').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      ((j && j.items) || []).slice(0, 2).forEach(function (v) {
        add(_spLibChip(_aeT('sp_watch', { title: String(v.title || '').slice(0, SP_CHIP_TITLE_CHARS) }), 'data-app="tube" data-zim="' + _almEsc(v.zim) + '" data-path="' + _almEsc(v.page) + '"'));
      });
    }).catch(function () {});
  }
  // A question on the space Q&A site.
  var qa = _spZimsLike(/^space\.stackexchange/)[0];
  if (qa) {
    fetch('/search?q=' + encodeURIComponent(english) + '&limit=1&zim=' + encodeURIComponent(qa.name)).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var hit = j && j.results && j.results[0];
      if (hit) add(_spLibChip(_aeT('sp_ask', { title: String(hit.title || '').slice(0, SP_CHIP_TITLE_CHARS) }), 'data-app="exchange" data-zim="' + _almEsc(hit.zim || qa.name) + '" data-path="' + _almEsc(hit.path) + '"'));
    }).catch(function () {});
  }
  // The orbit sandbox, for the planets and moons.
  var phet = _spZimsLike(/^phet_/)[0];
  if (phet && _spBody(key).kind !== 'probe') {
    var lang = (phet.name.match(/^phet_([a-z_]+?)_/) || [0, 'en'])[1];
    add(_spLibChip(_aeT('sp_orbits'), 'data-app="" data-zim="' + _almEsc(phet.name) + '" data-path="gravity-and-orbits_' + _almEsc(lang) + '.html"'));
  }
}
function _spOpenLibrary(btn) {
  var app = btn.getAttribute('data-app'), zim = btn.getAttribute('data-zim'), path = btn.getAttribute('data-path');
  if (app && typeof _openAppItem === 'function') _openAppItem(app, zim, path);
  else if (typeof openArticle === 'function') openArticle(zim, path, btn.textContent);
}

// ── What the person is told, one idea at a time ──
// The surprise first; the reason one tap away. Each shows once a session, when its
// effect has become plain to see, and they come in turn: at 0.99c all three cross
// their threshold within a second, so a flight shows the race, then the stars, then
// the colours, each for SP_CAPTION_MS, and not only the last. A `plain` caption has no
// reason behind it; an `auto` one makes way for the next by itself (never while its
// reason is open); `scale` shows every time the scale is changed.
var SP_CAPTIONS = {
  start:  { plain: true },
  scale:  { plain: true, again: true },
  race:   { auto: true, link: 'phys:lightspeed' },
  stars:  { auto: true, link: 'phys:aberration' },
  colour: { auto: true, link: 'phys:doppler' },
  clocks: { link: 'phys:timedilation' },
  old:    { link: 'phys:lightspeed' }
};
function _spShowCaption(kind) {
  var spec = SP_CAPTIONS[kind];
  if (!spec.again && _sp.seen[kind]) return;
  if (_sp.capQueue.indexOf(kind) >= 0 || (_sp.caption && _sp.caption.kind === kind && !spec.again)) return;
  if (spec.again && _sp.caption && _sp.caption.kind === kind) { _spRenderCaption(); return; }
  // The newest note about the scale replaces a note or a hint that is up, never the clocks.
  if (spec.again && _sp.caption && SP_CAPTIONS[_sp.caption.kind].plain) _sp.caption = null;
  _sp.capQueue.push(kind);
  _spPumpCaption();
}
// Show the next caption in the queue, if none is up.
function _spPumpCaption() {
  if (_sp.caption || !_sp.capQueue.length) return;
  var kind = _sp.capQueue.shift();
  _sp.seen[kind] = true;
  _sp.caption = { kind: kind, until: SP_CAPTIONS[kind].auto ? performance.now() + SP_CAPTION_MS : 0 };
  _sp.whyOpen = false;
  _spRenderCaption();
}
function _spDismissCaption() {
  var kind = _sp.caption && _sp.caption.kind;
  _sp.caption = null;
  _spRenderCaption();
  // After the clocks, the last surprise: home is seen as it was.
  if (kind === 'clocks' && _spHomeLagSeconds() >= 60) _spShowCaption('old');
  _spPumpCaption();
}
// The caption on show makes way once its time is up, if another waits (and not while its reason is open).
function _spAdvanceCaptions() {
  var c = _sp.caption;
  if (c && c.until && !_sp.whyOpen && _sp.capQueue.length && performance.now() > c.until) _spDismissCaption();
}
function _spHomeLagSeconds() {
  return _lightDelaySeconds(_spTrueDistAU(_sp.at, 'Earth', _sp.jd) || 0);
}
function _spCaptionVars(kind) {
  var vars = { body: _spName('Earth'), k: _orrNum(SP_READABLE_BOOST, null, 0) };
  if (kind === 'old') vars.time = _orrFmtSpan(_spHomeLagSeconds());
  if (kind === 'clocks' && _sp.lastTrip) {
    vars.earth = _orrFmtSpan(_sp.lastTrip.earthSec); vars.ship = _orrFmtSpan(_sp.lastTrip.shipSec);
    vars.gamma = _orrFmtGamma(_lorentzFactor(_sp.lastTrip.beta));
  }
  var f = _sp.flight;
  if (kind === 'race') {
    // How far behind the flash the ship arrives: the whole trip less the light's time to the same place.
    var total = f ? _spTrip(f.len, f.beta).earthSec : (_sp.lastTrip ? _sp.lastTrip.earthSec : 0);
    var lightSec = f ? _lightDelaySeconds(f.trueDist) : 0;
    vars.gap = _orrFmtSpan(Math.max(0, total - lightSec));
  }
  return vars;
}
// What a caption says: its text key, and the paragraph behind it.
function _spCaptionText(kind, vars) {
  if (kind === 'scale') return { text: _aeT(_sp.scaleMode === 'true' ? 'sp_note_true' : 'sp_note_readable', vars), why: '' };
  if (kind === 'start') return { text: _aeT('sp_cap_start'), why: _aeT('sp_note_ship') };
  return { text: _aeT('sp_cap_' + kind, vars), why: _aeT('sp_why_' + kind, vars) };
}
function _spRenderCaption() {
  var box = _aeById('sp-cap'), c = _sp.caption;
  if (!c) { box.hidden = true; _spSetHtml(box, ''); _spUpdateShift(); return; }
  var spec = SP_CAPTIONS[c.kind], text = _spCaptionText(c.kind, _spCaptionVars(c.kind)), read = spec.link;
  var more = read && _aeLinked(read) ? _aeLink(read, _almEsc(_aeT('sp_read_more'))) : '';
  // The start and scale notes are shown whole; the others keep the reason behind a button.
  var behind = spec.plain ? text.why : (_sp.whyOpen ? text.why : '');
  _spSetHtml(box,
    '<p>' + _almEsc(text.text) + '</p>' +
    (behind ? '<p class="sp-why">' + _almEsc(behind) + (more && !spec.plain ? ' ' + more : '') + '</p>' : '') +
    '<div class="sp-cap-row">' + (spec.plain ? '' : '<button type="button" class="ae-btn" data-sp-why="1" aria-expanded="' + _sp.whyOpen + '">' + _almEsc(_aeT('sp_why')) + '</button>') +
    '<button type="button" class="ae-btn" data-sp-ok="1">' + _almEsc(_aeT('sp_got_it')) + '</button></div>');
  box.hidden = false;
  _spUpdateShift();
}

// ── Text: the date, the clocks, the speed, the notes ──
function _spSyncControls() {
  var flying = !!_sp.flight;
  var scaleBtn = _aeById('sp-scale');
  _spSetText(scaleBtn, _sp.scaleMode === 'true' ? _aeT('sp_scale_true') : _aeT('sp_scale_readable', { k: _orrNum(SP_READABLE_BOOST, null, 0) }));
  scaleBtn.setAttribute('aria-pressed', String(_sp.scaleMode === 'true'));
  scaleBtn.disabled = flying;
  _spSetText(_aeById('sp-time'), _aeT(SP_TIME_KEYS[_sp.rateIdx]));
  _aeById('sp-time').disabled = flying;
  var slider = _aeById('sp-slider');
  slider.value = String(_spBetaToSlider(_sp.beta));
  slider.disabled = flying;
  slider.setAttribute('aria-valuetext', _spFmtSpeed(_sp.beta));
  var hud = _aeById('sp-hud');
  hud.hidden = !flying;
  if (flying && !hud.firstChild) {
    hud.innerHTML = '<span>' + _almEsc(_aeT('sp_hud_earth')) + '<b id="sp-h-earth"></b></span><span>' + _almEsc(_aeT('sp_hud_you')) + '<b id="sp-h-you"></b></span>' +
      '<span>' + _almEsc(_aeT('sp_hud_speed')) + '<b id="sp-h-speed"></b></span>' +
      '<span style="grid-column:1/-1"><button type="button" class="ae-btn" data-sp-skip="1" style="pointer-events:auto">' + _almEsc(_aeT('sp_skip')) + '</button></span>';
    hud.onclick = function (e) { if (e.target.closest('[data-sp-skip]')) _spSkipFlight(); };
  } else if (!flying) hud.innerHTML = '';
  // A flight over: the effects that were its own go, with what was queued behind them.
  if (!flying) {
    _sp.capQueue = _sp.capQueue.filter(function (k) { return !SP_CAPTIONS[k].auto; });
    if (_sp.caption && SP_CAPTIONS[_sp.caption.kind].auto) { _sp.caption = null; _spRenderCaption(); _spPumpCaption(); }
  }
  _spSetText(_aeById('sp-speedout'), _spFmtSpeed(_sp.beta));
  _sp.el.classList.toggle('sp-flying', flying);
  // Arrived with something to say: the sheet carries it, and the planet is left in view.
  _sp.el.classList.toggle('sp-arrived', !flying && !!_sp.caption && (_sp.caption.kind === 'clocks' || _sp.caption.kind === 'old'));
  _spUpdateShift();
}
function _spUpdateText() {
  _spSetText(_aeById('sp-when'), _spFmtWhen(_sp.jd));
  // "Now" is offered once the clock has been moved (by a flight, or time running) or the page's was moved before
  // the view opened: not for a clock that is simply a few seconds behind the wall's.
  var wall = _dateToJD(Date.now());
  _aeById('sp-now').hidden = !((_sp.moved || Math.abs(_sp.openJd - wall) > 60 / SECONDS_PER_DAY) && Math.abs(_sp.jd - wall) > 2 / SECONDS_PER_DAY);
  var f = _sp.flight;
  if (f) {
    _spSetText(_aeById('sp-h-earth'), _orrFmtSpan(f.now.earthSec));
    _spSetText(_aeById('sp-h-you'), _orrFmtSpan(f.now.shipSec));
    _spSetText(_aeById('sp-h-speed'), _orrFmtBeta(f.now.beta));
    _spSetText(_aeById('sp-speedout'), _spFmtSpeed(f.now.beta));
    if (f.now.beta >= SP_CAPTION_BETA.stars) _spShowCaption('stars');
    if (f.now.beta >= SP_CAPTION_BETA.colour) _spShowCaption('colour');
  }
  _spAdvanceCaptions();
  _spUpdateCardLines();
  if (_sp.caption && (_sp.caption.kind === 'old' || _sp.caption.kind === 'clocks')) _spRenderCaption();
  var c = _aeById('sp-canvas');
  var aria = _aeT('sp_aria', { when: _spFmtWhen(_sp.jd) });
  if (c.getAttribute('aria-label') !== aria) c.setAttribute('aria-label', aria);
}

window.openAlmanacSpace = openAlmanacSpace;
