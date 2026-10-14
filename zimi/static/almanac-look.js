// Pointing the phone: look up and you are in the sky above where you stand,
// look down and you are over the globe where you stand. One object, two
// faces. This file is the part that knows where the phone points (the
// sensors, the compass, the fall-back when there are none) and the overlay
// that shows the sky and the globe by it. The maths comes first and touches
// nothing but numbers, so it is tested alone (tests/test_almanac_look.cjs).
//
// Loaded on the first tap of the sky's Look button, never with the Almanac.
// Motion permission (iOS asks) is requested on that tap, never on load.

// ── The maths ──────────────────────────────────────────────────────────────

var LOOK_RAD = Math.PI / 180;
var LOOK_FOV_DEFAULT_DEG = 60;        // a phone held at arm's length covers about this
var LOOK_FOV_MIN_DEG = 15;
var LOOK_FOV_MAX_DEG = 100;
// The globe shows through from this far below the horizon, and fills the
// view at the second: tipping the phone to the ground is the change, a
// wobble at the horizon is not.
var LOOK_FADE_FROM_DEG = 4;
var LOOK_FADE_TO_DEG = 30;
// Looking nearly straight up or down, the back of the phone has no heading
// (it points at the sky); the top edge says which way instead. The two are
// blended between these cosines of the altitude.
var LOOK_HEADING_BACK_COS = 0.5;      // below 60 degrees up the back decides
var LOOK_HEADING_TOP_COS = 0.25;      // above 75 degrees only the top does
var LOOK_KEY_STEP_DEG = 5;
var LOOK_SMOOTH_TAU_MS = 90;          // a reading settles in about a fifth of a second
var LOOK_COMPASS_POOR_DEG = 25;       // iOS: worse than this and the compass wants a figure eight
var LOOK_POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function _lookNorm360(x) { return ((x % 360) + 360) % 360; }
function _lookDelta(from, to) { return ((to - from) % 360 + 540) % 360 - 180; }
function _lookClamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function _lookSmoothstep(lo, hi, x) { var t = _lookClamp((x - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); }
function _lookDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function _lookCross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function _lookUnit(a) { var n = Math.sqrt(_lookDot(a, a)) || 1; return [a[0] / n, a[1] / n, a[2] / n]; }

// A device axis in the Earth's frame (x east, y north, z up) for the W3C
// orientation: R = Rz(alpha) Rx(beta) Ry(gamma), degrees.
function _lookDeviceAxis(alpha, beta, gamma, axis) {
  var a = alpha * LOOK_RAD, b = beta * LOOK_RAD, g = gamma * LOOK_RAD;
  var ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  // Ry(gamma) on the axis, then Rx(beta), then Rz(alpha).
  var x = axis[0] * cg + axis[2] * sg, y = axis[1], z = -axis[0] * sg + axis[2] * cg;
  var y2 = y * cb - z * sb, z2 = y * sb + z * cb;
  return [x * ca - y2 * sa, x * sa + y2 * ca, z2];
}

// Where the person looks: through the back of the phone, as a heading
// (degrees clockwise from north), an altitude, and the roll of the screen
// from level (degrees, clockwise positive). `screenDeg` is the angle the
// display has been turned from the phone's natural position.
function _lookViewFromEuler(alpha, beta, gamma, screenDeg) {
  var back = _lookDeviceAxis(alpha, beta, gamma, [0, 0, -1]);
  var s = (screenDeg || 0) * LOOK_RAD;
  var up = _lookDeviceAxis(alpha, beta, gamma, [Math.sin(s), Math.cos(s), 0]);
  var alt = Math.asin(_lookClamp(back[2], -1, 1)) / LOOK_RAD;
  var h = Math.sqrt(back[0] * back[0] + back[1] * back[1]);
  var hb = h > 1e-9 ? [back[0] / h, back[1] / h] : [0, 0];
  // The top edge points forward when looking down and backward when looking
  // up, so up's horizontal part is flipped for a view above the horizon.
  var uh = Math.sqrt(up[0] * up[0] + up[1] * up[1]);
  var flip = back[2] > 0 ? -1 : 1;
  var hu = uh > 1e-9 ? [flip * up[0] / uh, flip * up[1] / uh] : hb;
  var w = _lookSmoothstep(LOOK_HEADING_TOP_COS, LOOK_HEADING_BACK_COS, h);
  var vx = w * hb[0] + (1 - w) * hu[0], vy = w * hb[1] + (1 - w) * hu[1];
  var az = (vx === 0 && vy === 0) ? 0 : _lookNorm360(Math.atan2(vx, vy) / LOOK_RAD);
  var roll = 0;
  if (h > 1e-6) {
    var d = [back[0], back[1], back[2]];
    var zen = [0, 0, 1];
    var u0 = _lookUnit([zen[0] - d[0] * d[2], zen[1] - d[1] * d[2], zen[2] - d[2] * d[2]]);
    var r0 = _lookUnit(_lookCross(d, u0));
    roll = Math.atan2(_lookDot(up, r0), _lookDot(up, u0)) / LOOK_RAD * w;
  }
  return { az: az, alt: alt, roll: roll };
}

// iOS gives a heading of its own, true to the compass, with alpha relative to
// wherever the phone woke. The difference carries the one onto the other.
function _lookHeadingOffset(rawAz, compassAz) { return _lookDelta(rawAz, compassAz); }
function _lookApplyOffset(view, offsetDeg) { return { az: _lookNorm360(view.az + offsetDeg), alt: view.alt, roll: view.roll }; }

// `reading`: {accuracy: iOS's figure in degrees (-1 when it has none) or
// null, absolute: whether the angles are from north}. True when the person
// should be told to wave the phone in a figure eight, or that north is a
// guess.
function _lookCompassNeedsCalibrating(reading) {
  if (reading.accuracy != null) return reading.accuracy < 0 || reading.accuracy > LOOK_COMPASS_POOR_DEG;
  return !reading.absolute;
}

// An exponential step toward the reading, headings across north the short way.
function _lookSmooth(prev, next, dtMs, tauMs) {
  if (!prev) return { az: next.az, alt: next.alt, roll: next.roll || 0 };
  var k = 1 - Math.exp(-dtMs / tauMs);
  return {
    az: _lookNorm360(prev.az + _lookDelta(prev.az, next.az) * k),
    alt: prev.alt + (next.alt - prev.alt) * k,
    roll: prev.roll + ((next.roll || 0) - prev.roll) * k
  };
}

// How much of the picture is the globe, from the altitude looked at.
function _lookGlobeShare(altDeg) {
  return _lookSmoothstep(LOOK_FADE_FROM_DEG, LOOK_FADE_TO_DEG, -altDeg);
}

// Without sensors: the picture follows a finger, as the sky does in a planetarium.
function _lookDragBy(view, dx, dy, fovDeg, widthPx) {
  var k = fovDeg / widthPx;
  return { az: _lookNorm360(view.az - dx * k), alt: _lookClamp(view.alt + dy * k, -90, 90) };
}
function _lookKeyBy(view, key) {
  var step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[key];
  if (!step) return null;
  return { az: _lookNorm360(view.az + step[0] * LOOK_KEY_STEP_DEG), alt: _lookClamp(view.alt + step[1] * LOOK_KEY_STEP_DEG, -90, 90) };
}
function _lookFovByPinch(startFov, startDist, dist) {
  return _lookClamp(startFov * startDist / Math.max(dist, 1), LOOK_FOV_MIN_DEG, LOOK_FOV_MAX_DEG);
}
function _lookCompassPoint(az) { return LOOK_POINTS[Math.round(_lookNorm360(az) / 22.5) % 16]; }

// ── The sensors ────────────────────────────────────────────────────────────

var LOOK_SENSOR_WAIT_MS = 1500;        // no reading by then: this device has no sensors to read
var LOOK_OFFSET_JUMP_DEG = 25;
var LOOK_OFFSET_FAST_TAU_MS = 60;
var LOOK_OFFSET_TAU_MS = 400;          // the compass's correction settles slower than the view
var LOOK_NOTE_AFTER_MS = 1500;         // a calibration note appears only if the compass stays poor this long
var LOOK_MAX_STEP_MS = 250;            // a late frame still takes its whole step (the smoothing is exact for any step)
var LOOK_SETTLED_DEG = 0.05;           // the view has caught up with the reading
var LOOK_REPAINT_DEG = 0.12;           // the sky is repainted past this much turn
// The globe under your feet hangs this high (Earth radii; 640 km) at the
// default field, and as much higher as the field is wider: the maps it is
// drawn from are 20 km to a pixel, so a lower view is a smear, and the maps
// of Zimi Earth are one tap away for the street.
var LOOK_GROUND_ALT = 0.1;
var LOOK_START_ALT_DEG = 20;
var LOOK_CLOCK_MS = 60000;             // the sky moves a quarter degree a minute: drawn again that often
var LOOK_ROOT_ID = 'almanac-look';
var LOOK_STOPGAP_FOV_DEG = 60;         // the panorama is shown 60 degrees across...
var LOOK_STOPGAP_DOWN_DEG = 120;       // ...and 120 down: square degrees, so a pixel is the same angle both ways

var _look = null;                      // the open overlay's state

function _lookT(key, vars) { return typeof t === 'function' ? t(key, vars) : key; }
function _lookEl(id) { return document.getElementById(id); }
function _lookScreenAngle() {
  var a = (window.screen && screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle
    : (typeof window.orientation === 'number' ? window.orientation : 0);
  return _lookNorm360(a);
}
function _lookNeedsPermission() {
  return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
}
// Motion events need a secure address (https or localhost) on every phone.
function _lookHasSensors() { return typeof DeviceOrientationEvent !== 'undefined' && window.isSecureContext !== false; }

// iOS asks, once, in answer to a tap; everything else just listens.
function _lookAskSensors() {
  if (_lookNeedsPermission()) {
    return DeviceOrientationEvent.requestPermission().then(function (r) { return r === 'granted' ? 'granted' : 'denied'; }, function () { return 'denied'; });
  }
  return Promise.resolve(_lookHasSensors() ? 'granted' : 'unavailable');
}

function _lookStartSensors() {
  var S = _look;
  if (S.sensing) return;
  S.sensing = { absSeen: false, offset: null, lastEvent: 0, poorSince: 0, got: false };
  S.onAbs = function (e) { _lookOnOrientation(e, true); };
  S.onRel = function (e) { _lookOnOrientation(e, false); };
  window.addEventListener('deviceorientationabsolute', S.onAbs);
  window.addEventListener('deviceorientation', S.onRel);
  // No reading by then: say so and let a finger turn the view. The listeners
  // stay, so a reading that comes late takes over and clears the note.
  S.sensorTimer = setTimeout(function () {
    if (_look !== S || !S.sensing || S.sensing.got) return;
    S.mode = 'drag';
    _lookNote(_lookT('look_none'), 'sensors');
    _lookButtons();
  }, LOOK_SENSOR_WAIT_MS);
}
function _lookStopSensors(S) {
  if (!S.sensing) return;
  window.removeEventListener('deviceorientationabsolute', S.onAbs);
  window.removeEventListener('deviceorientation', S.onRel);
  clearTimeout(S.sensorTimer);
  S.sensing = null;
}
function _lookSensorsFailed(noteKey) {
  _lookStopSensors(_look);
  _look.mode = 'drag';
  _lookNote(_lookT(noteKey), 'sensors');
  _lookButtons();
}

function _lookOnOrientation(e, absolute) {
  var S = _look, sn = S && S.sensing;
  if (!sn) return;
  var ios = typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0;
  if (e.alpha == null && !ios) return;                  // a desktop's empty first event
  if (absolute) sn.absSeen = true; else if (sn.absSeen) return;   // Chrome fires both; the absolute one knows north
  var now = performance.now();
  var alpha = e.alpha || 0, beta = e.beta || 0, gamma = e.gamma || 0;
  var view = _lookViewFromEuler(alpha, beta, gamma, _lookScreenAngle());
  if (ios) {
    // alpha is from wherever the phone woke; the heading says where north is.
    var nat = _lookViewFromEuler(alpha, beta, gamma, 0);
    var off = _lookHeadingOffset(nat.az, e.webkitCompassHeading);
    // Slow, so a noisy compass does not shake the view; fast when it is far off
    // (the first readings, a phone picked up after being still), so it is not
    // wrong for long.
    var tau = sn.offset != null && Math.abs(_lookDelta(sn.offset, off)) > LOOK_OFFSET_JUMP_DEG ? LOOK_OFFSET_FAST_TAU_MS : LOOK_OFFSET_TAU_MS;
    var k = sn.offset == null ? 1 : 1 - Math.exp(-(now - sn.lastEvent) / tau);
    sn.offset = sn.offset == null ? off : sn.offset + _lookDelta(sn.offset, off) * k;
    view = _lookApplyOffset(view, sn.offset);
  }
  sn.lastEvent = now;
  if (!sn.got) { sn.got = true; S.mode = 'sensor'; _lookNote('', 'sensors'); _lookButtons(); }
  var poor = _lookCompassNeedsCalibrating({ accuracy: ios ? e.webkitCompassAccuracy : null, absolute: absolute || !!e.absolute || ios });
  if (poor) {
    if (!sn.poorSince) sn.poorSince = now;
    if (now - sn.poorSince > LOOK_NOTE_AFTER_MS) _lookNote(_lookT(ios ? 'look_calibrate' : 'look_no_north'), 'compass');
  } else { sn.poorSince = 0; _lookNote('', 'compass'); }
  S.target = { az: view.az, alt: view.alt, roll: view.roll };
  _lookKick();
}

// ── The view ───────────────────────────────────────────────────────────────

// One line of note at a time. `kind` says who wrote it, so a compass that
// settles clears its own note and never one about the sensors.
function _lookNote(text, kind) {
  var n = _lookEl('look-note');
  if (!n) return;
  if (!text && _look.noteKind !== kind) return;
  _look.noteKind = text ? kind : '';
  n.textContent = text;
  n.hidden = !text;
}

function _lookKick() { if (_look && !_look.raf) _look.raf = requestAnimationFrame(_lookFrame); }

// One frame: the view takes a step toward the reading (and the finger's
// trim), the layers follow. It asks for another only while it is still
// moving: a held phone is a still picture and spends nothing.
function _lookFrame(ts) {
  var S = _look;
  if (!S) return;
  S.raf = 0;
  var dt = S.last ? Math.min(ts - S.last, LOOK_MAX_STEP_MS) : 16;
  S.last = ts;
  var goal = { az: _lookNorm360(S.target.az + S.trim.az), alt: _lookClamp(S.target.alt + S.trim.alt, -90, 90), roll: S.target.roll };
  S.view = _lookSmooth(S.view, goal, dt, _lookReduceMotion() ? 1 : LOOK_SMOOTH_TAU_MS);
  var moving = Math.abs(_lookDelta(S.view.az, goal.az)) > LOOK_SETTLED_DEG || Math.abs(S.view.alt - goal.alt) > LOOK_SETTLED_DEG;
  if (!moving) S.view = goal;
  _lookApply(S.view);
  if (moving) S.raf = requestAnimationFrame(_lookFrame); else S.last = 0;
}
function _lookReduceMotion() { return typeof _almReduceMotion === 'function' && _almReduceMotion(); }

function _lookSkyView() { return window.AlmanacSkyView || _lookStopgapSky; }

function _lookApply(v) {
  var S = _look, share = _lookGlobeShare(v.alt);
  S.share = share;
  var turned = !S.drawn || Math.abs(_lookDelta(S.drawn.az, v.az)) > LOOK_REPAINT_DEG || Math.abs(S.drawn.alt - v.alt) > LOOK_REPAINT_DEG || S.drawn.fov !== S.fov;
  if (turned) {
    S.drawn = { az: v.az, alt: v.alt, fov: S.fov };
    if (S.skyMounted) _lookSkyView().setView(S.skyHost, v.az, v.alt, S.fov);
    if (share > 0.01 && S.globe) S.globe.set({ bearing: v.az, alt: LOOK_GROUND_ALT * S.fov / LOOK_FOV_DEFAULT_DEG }, 0);
  }
  S.skyHost.style.opacity = String(1 - share);
  S.globeEl.style.opacity = String(share);
  S.root.classList.toggle('look-ground', share > 0.5);
  S.skyHost.style.pointerEvents = share > 0.5 ? 'none' : '';
  _lookEl('look-earth').hidden = share <= 0.5;
  var altR = Math.round(v.alt), azR = Math.round(v.az) % 360;
  var read = _lookCompassPoint(v.az) + ' ' + azR + '°   ' + (altR > 0 ? '+' : altR < 0 ? '−' : '') + Math.abs(altR) + '°';
  var r = _lookEl('look-read');
  if (r.textContent !== read) r.textContent = read;
}

// The sky as the Almanac draws it, shown through the window. This is the
// contract a renderer that projects a view direction takes over, by
// assigning window.AlmanacSkyView = {mount(host, place) -> bool,
// setView(host, az, alt, fov), unmount(host)} (azimuth clockwise from north
// and altitude in degrees, field of view across the screen's width). This
// stopgap drives the panorama in almanac-sky.js through state it already has
// (its centre azimuth and its field, both script globals) and moves the
// canvas under the window so the altitude looked at is the middle of the
// screen. Its field is fixed: the panorama's own.
var _lookStopgapSky = {
  mount: function (host, place) {
    var wrap = document.querySelector('.almanac-sky-wrap');
    if (!wrap || typeof _initSkyScene !== 'function') return false;
    host._wrap = wrap;
    host._home = { parent: wrap.parentNode, next: wrap.nextSibling };
    host._was = { aspect: SKY_ASPECT, span: SKY_SPAN_DEG, half: SKY_SPAN_HALF };
    SKY_SPAN_DEG = LOOK_STOPGAP_FOV_DEG; SKY_SPAN_HALF = SKY_SPAN_DEG / 2;
    SKY_ASPECT = LOOK_STOPGAP_FOV_DEG / LOOK_STOPGAP_DOWN_DEG;
    wrap.classList.add('look-wrap');
    host.appendChild(wrap);
    _initSkyScene(typeof _almFocusInstant === 'function' ? _almFocusInstant() : new Date(), place.lat, place.lon);
    // Its observer asks whether the card is on screen; the window is always
    // on screen, and the observer's answer for a canvas moved under it is not
    // to be trusted. It watches the card again when the card is back.
    var st = _skyState;
    if (st.observer) st.observer.disconnect();
    st.inView = true;
    return true;
  },
  setView: function (host, az, alt) {
    var s = typeof _skyState !== 'undefined' ? _skyState : null, wrap = host._wrap;
    if (!s || !wrap) return;
    var cv = s.canvas, cssH = cv.clientHeight, yh = cssH * SKY_HORIZON_Y;
    var yc = yh - alt * (yh - cssH * SKY_ZENITH_Y) / 90;
    cv.style.transform = 'translateY(' + Math.round(wrap.clientHeight / 2 - yc) + 'px)';
    s.center = az; s.baseDirty = true;
    _skyKick();
  },
  unmount: function (host) {
    var wrap = host._wrap;
    if (!wrap) return;
    var cv = wrap.querySelector('canvas');
    if (cv) cv.style.transform = '';
    wrap.classList.remove('look-wrap');
    SKY_ASPECT = host._was.aspect; SKY_SPAN_DEG = host._was.span; SKY_SPAN_HALF = host._was.half;
    var home = host._home;
    if (home.next && home.next.parentNode === home.parent) home.parent.insertBefore(wrap, home.next); else home.parent.appendChild(wrap);
    host._wrap = null;
    var loc = typeof _getLocation === 'function' ? _getLocation() : null;
    if (loc) _initSkyScene(typeof _almFocusInstant === 'function' ? _almFocusInstant() : new Date(), loc.lat, loc.lon);
    var st = _skyState;
    if (st && st.observer) st.observer.observe(st.canvas);
  },
  // Re-lay the sky out after the window changed shape.
  resize: function (host, place) {
    _initSkyScene(typeof _almFocusInstant === 'function' ? _almFocusInstant() : new Date(), place.lat, place.lon);
  }
};

// ── The overlay ────────────────────────────────────────────────────────────

var LOOK_CLOSE_SVG = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
var LOOK_EARTH_SVG = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3.5 9.5c2.5.4 3.5 2 4.5 3.5s2.5 1 3 2.5-1 3 .5 4.5M13 3.2c-.4 2 .6 3 2 3.6s3.5.4 5 2.2"/></svg>';

function _lookPlaceLabel(place) {
  var f = function (x, p, n) { return Math.abs(x).toFixed(1) + '° ' + (x >= 0 ? p : n); };
  var coords = '⁦' + f(place.lat, 'N', 'S') + ', ' + f(place.lon, 'E', 'W') + '⁩';
  return place.name ? place.name + ' · ' + coords : coords;
}

function _lookButtons() {
  var S = _look;
  if (S) _lookEl('look-ask').hidden = !(S.mode === 'idle' && !S.sensing && _lookHasSensors() && _lookNeedsPermission());
}

function _lookOpen(opts) {
  if (_look) return;
  opts = opts || {};
  var loc = typeof _getLocation === 'function' ? _getLocation() : { lat: 34, lon: 0, name: '' };
  var place = opts.lat != null ? { lat: opts.lat, lon: opts.lon, name: opts.name || '' } : { lat: loc.lat, lon: loc.lon, name: loc.name || '' };
  var root = document.createElement('div');
  root.id = LOOK_ROOT_ID;
  root.className = 'almanac-look';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', _lookT('look_title'));
  root.innerHTML =
    '<div class="look-layers"><div class="look-sky" id="look-sky"></div><canvas class="look-globe" id="look-globe"></canvas><div class="look-you" id="look-you"></div></div>' +
    '<div class="look-top"><button type="button" class="look-btn" id="look-close"></button>' +
    '<div class="look-info"><div class="look-read" id="look-read"></div><div class="look-place" id="look-place"></div></div></div>' +
    '<div class="look-note" id="look-note" role="status" hidden></div>' +
    '<div class="look-bottom"><button type="button" class="look-main" id="look-ask"></button>' +
    '<button type="button" class="look-main" id="look-earth" hidden>' + LOOK_EARTH_SVG + '<span></span></button></div>';
  document.body.appendChild(root);
  _lookEl('look-close').innerHTML = LOOK_CLOSE_SVG;
  _lookEl('look-close').setAttribute('aria-label', _lookT('close'));
  _lookEl('look-ask').textContent = _lookT('look_enable');
  _lookEl('look-earth').lastChild.textContent = _lookT('look_earth');
  _lookEl('look-place').textContent = _lookPlaceLabel(place);
  document.body.classList.add('look-open');
  var startAz = place.lat >= 0 ? 180 : 0;
  var S = _look = {
    root: root, skyHost: _lookEl('look-sky'), globeEl: _lookEl('look-globe'), place: place, mode: 'idle', fov: LOOK_FOV_DEFAULT_DEG,
    target: { az: startAz, alt: LOOK_START_ALT_DEG, roll: 0 }, view: { az: startAz, alt: LOOK_START_ALT_DEG, roll: 0 },
    trim: { az: 0, alt: 0 }, share: 0, raf: 0, last: 0, drawn: null, sensing: null, globe: null, resizeTimer: 0, noteKind: ''
  };
  S.skyMounted = !!_lookSkyView().mount(S.skyHost, place);
  // The Almanac under the window rests: its orrery, clocks and the sky's own
  // breeze would each ask for frames all the while nothing here moves.
  if (typeof _cancelAllRAF === 'function') _cancelAllRAF();
  S.clock = setInterval(_lookRefreshClock, LOOK_CLOCK_MS);
  _lookEl('look-close').onclick = _lookClose;
  _lookEl('look-ask').onclick = _lookAskTap;
  _lookEl('look-earth').onclick = function () {
    var p = S.place;
    _lookClose();
    if (typeof openEarth === 'function') openEarth(false, { lat: p.lat, lon: p.lon, alt: 0.01 });
  };
  _lookBindInput(root);
  S.onKey = _lookKey;
  S.onResize = function () { clearTimeout(S.resizeTimer); S.resizeTimer = setTimeout(_lookResize, 200); };
  document.addEventListener('keydown', S.onKey);
  window.addEventListener('resize', S.onResize);
  if (!_lookHasSensors()) {
    S.mode = 'drag';
    _lookNote(_lookT(window.isSecureContext === false && typeof DeviceOrientationEvent !== 'undefined' ? 'look_insecure' : 'look_none'), 'sensors');
  } else if (!_lookNeedsPermission()) {
    _lookStartSensors();     // nothing to ask: listen at once
  }
  _lookButtons();
  _lookApply(S.view);
  _lookWarmGlobe();
}

// The stars turn: the sky is worked out for now again, once a minute.
function _lookRefreshClock() {
  var S = _look, st = typeof _skyState !== 'undefined' ? _skyState : null;
  if (!S || !st || !S.skyMounted || window.AlmanacSkyView) return;
  if (typeof _almFocus === 'undefined' || !_almFocus) _skyCompute(st, new Date());
  S.drawn = null;
  _lookKick();
}

function _lookAskTap() {
  var S = _look;
  _lookAskSensors().then(function (r) {
    if (_look !== S) return;
    if (r === 'granted') { _lookStartSensors(); _lookButtons(); }
    else _lookSensorsFailed(r === 'denied' ? 'look_denied' : 'look_none');
  });
}

// The globe is made once the sky is up, so the first tilt to the ground has
// it ready; nothing draws until it shows.
function _lookWarmGlobe() {
  var S = _look;
  var go = function () {
    if (_look !== S || typeof ZimiGlobe === 'undefined') return;
    ZimiGlobe.create(S.globeEl, { interactive: false, lat: S.place.lat, lon: S.place.lon, alt: LOOK_GROUND_ALT }).then(function (g) {
      if (_look !== S) { g.dispose(); return; }
      S.globe = g;
      g.set({ bearing: S.view.az, alt: LOOK_GROUND_ALT * S.fov / LOOK_FOV_DEFAULT_DEG }, 0);
    }).catch(function () { /* no WebGL: the ground stays dark, as the sky below the horizon already is */ });
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 1500 }); else setTimeout(go, 300);
}

function _lookResize() {
  var S = _look;
  if (!S) return;
  var sky = _lookSkyView();
  if (S.skyMounted && sky.resize) sky.resize(S.skyHost, S.place);
  S.drawn = null;
  if (S.globe) S.globe.resize();
  _lookKick();
}

// A finger or a mouse turns the view: with no sensors it is the view; with
// them it trims the compass (a drifting north is one swipe from right).
// Two fingers change the field.
function _lookBindInput(root) {
  var S = _look, pts = new Map(), last = null, pinch = null;
  var layers = root.querySelector('.look-layers');
  layers.style.touchAction = 'none';
  layers.addEventListener('pointerdown', function (e) {
    layers.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) last = { x: e.clientX, y: e.clientY };
    if (pts.size === 2) { var a = Array.from(pts.values()); pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), fov: S.fov }; }
  });
  layers.addEventListener('pointermove', function (e) {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) {
      var a = Array.from(pts.values());
      S.fov = _lookFovByPinch(pinch.fov, pinch.d, Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y));
      _lookKick();
      return;
    }
    if (!last || pts.size !== 1) return;
    var sensing = S.mode === 'sensor';
    var base = sensing ? S.trim : S.target;
    var next = _lookDragBy({ az: base.az, alt: base.alt }, e.clientX - last.x, e.clientY - last.y, S.fov, root.clientWidth);
    last = { x: e.clientX, y: e.clientY };
    if (sensing) S.trim = { az: next.az, alt: next.alt };
    else S.target = { az: next.az, alt: next.alt, roll: 0 };
    _lookKick();
  });
  var end = function (e) { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) last = null; };
  layers.addEventListener('pointerup', end);
  layers.addEventListener('pointercancel', end);
}
function _lookKey(e) {
  var S = _look;
  if (!S) return;
  if (e.key === 'Escape') { _lookClose(); return; }
  var base = S.mode === 'sensor' ? S.trim : S.target;
  var next = _lookKeyBy({ az: base.az, alt: base.alt }, e.key);
  if (!next) return;
  e.preventDefault();
  if (S.mode === 'sensor') S.trim = { az: next.az, alt: next.alt };
  else S.target = { az: next.az, alt: next.alt, roll: 0 };
  _lookKick();
}

function _lookClose() {
  var S = _look;
  if (!S) return;
  _look = null;
  _lookStopSensors(S);
  if (S.raf) cancelAnimationFrame(S.raf);
  clearTimeout(S.resizeTimer);
  clearInterval(S.clock);
  document.removeEventListener('keydown', S.onKey);
  window.removeEventListener('resize', S.onResize);
  if (S.globe) S.globe.dispose();
  if (S.skyMounted) {
    var prev = _look;
    _look = S;                      // unmount may ask for the open overlay's host
    _lookSkyView().unmount(S.skyHost);
    _look = prev;
  }
  if (typeof _resumeAllRAF === 'function' && typeof _almanacOpen !== 'undefined' && _almanacOpen) _resumeAllRAF();
  S.root.remove();
  document.body.classList.remove('look-open');
}

window.openAlmanacLookNow = _lookOpen;
window.closeAlmanacLook = _lookClose;
