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
