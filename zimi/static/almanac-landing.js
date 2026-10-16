// ── Almanac: the Moon landing ──
// Open the Almanac and the Moon in the hero is the real one, in the live
// solar system: the same body, the same light and the same turn as the picture
// it replaces, drawn by the 3D Earth view's scene (almanac-earth.js) into the
// hero's own rectangle. Drag it sideways and the camera pulls back through
// that scene along one axis of distance: the Moon, the Earth and Moon, the
// Earth and the Sun, the inner planets, Neptune. The page's clock drives all
// of it, as everywhere else in the Almanac.
//
//   first paint   the hero is the picture (an <img>, app.js); nothing here is on
//                 the critical path. Once the view's scene is warm (idle, as it
//                 was for the hand-off), its canvas takes the hero's place under
//                 the same pixels, and goes back when the picture is the one to
//                 show (the time machine's sweeps, a rebuilt header).
//   no WebGL      nothing changes and nothing offers the drag.
//   the axis      one number, u, from 0 (the Moon) to 4 (Neptune), the stops at
//                 whole numbers. A camera is made for every stop from where the
//                 bodies are (almanac-ephem.js); between stops the camera eases,
//                 slowest at the stops, so a release near one settles on it.
//   to scale      the scene is true where the planets can be seen at their size
//                 and laid out (almanac-ephem.js _ephLayoutMap) where they cannot:
//                 the blend comes from the smallest planet in view against a pixel
//                 floor, and the view says so, in words, while it is laid out.
//
// Pure functions first (tests/test_almanac_landing.cjs), then the scene layer,
// the hero, the axis and its controls. Frames: the scene's are the Earth view's,
// Earth radii on the true equator and equinox of date; the solar bodies are made
// in the J2000 ecliptic of almanac-ephem.js and turned into it once.

// ── The axis ──
var LP_STOPS = ['moon', 'pair', 'earth', 'inner', 'neptune'];
var LP_LAST = LP_STOPS.length - 1;
var LP_PAIR = 1, LP_EARTH = 2;              // the stops the text and the layout turn on
var LP_PX_PER_STOP = 110;                   // a drag this long moves the camera one stop
var LP_SNAP_WINDOW = 0.3;                   // a release this near a stop (in stops) settles on it
var LP_SNAP_MS = 320;
var LP_FLY_MS_PER_STOP = 480;
var LP_TILT_MAX = _aeRad(35);               // a vertical drag tips the camera this far at most
var LP_TILT_PER_PX = 0.006;
var LP_NOMINAL_LAM = [0, 0, 1, 1, 1];       // each stop's layout: true up to the pair, laid out beyond
// What each stop holds, from the Earth: 'moon' the Moon, 'pair' the Moon too (the pair is
// the Earth and what it carries), 'earth' the Sun, 'inner' Mars, 'neptune' Neptune.
var LP_STOP_REACH = { moon: 'Moon', pair: 'Moon', earth: 'Sun', inner: 'Mars', neptune: 'Neptune' };

// ── Cameras ──
var LP_AU_RE = AU_KM / AE_EARTH_RADIUS_KM;  // Earth radii in an AU
var LP_MOON_APOGEE_KM = 406700;             // the Moon at its farthest: the pair's view holds its whole orbit
var LP_ORBIT_MARGIN = 1.1;
// The part of the screen the picture is composed in: below the header, above the controls. Cameras look at the
// middle of it (the view is shifted up by half the difference), and a line up the screen fits its height.
var LP_NAMES_FROM = [0.6, 1.4];             // where the Earth's and Moon's names come in, and the Sun's (stops)
var LP_NAME_SHOWN = 0.5;                    // a name stands once what it names is this far in
var LP_LABEL_APART_PX = 36;                  // two bodies' names stand apart by at least this
var LP_CLEAR_TOP_PX = 100, LP_CLEAR_BOTTOM_PX = 230, LP_CLEAR_END_PX = 110;   // and the track's width at the end edge
var LP_VIEW_SHIFT_PX = (LP_CLEAR_BOTTOM_PX - LP_CLEAR_TOP_PX) / 2;
var LP_OUT_MARGIN = 1.18;                   // the outermost orbit's share of the half view
var LP_SUN_MARGIN = 1.1;
var LP_PLANET_ELEVATION = _aeRad(58);       // the planets are seen from this far over the ecliptic
var LP_INNER_REACH_AU = 1.67;               // Mars at its farthest from the Sun
var LP_OUTER_REACH_AU = 30.3;               // Neptune at its farthest
var LP_FAR_FACTOR = 1.6;                    // the far plane, past the farthest thing drawn
var LP_STAR_FAR_SHARE = 0.9;                 // the stars' sphere stays inside the far plane by this much
var LP_STAR_NEAR_FACTOR = 3;                // the stars stand this many near planes out when the near plane passes 5000 Re

// ── To scale, or laid out ──
var LP_PX_LOST = 0.6;                       // a planet smaller than this (radius, pixels) has lost its size
var LP_PX_TRUE = 2;                         // and one this large is plainly drawn to scale
var LP_NOT_TO_SCALE_FROM = 0.35;            // laid out this far, the view says so
var LP_SUN_FLOOR_PX = 7;                    // the Sun is drawn at least this wide (radius) where it is far
var LP_SUN_MIX_FROM = 300, LP_SUN_MIX_TO = 2500;   // camera distances (Re) between the Earth view's near Sun and the true one
var LP_DOT_PX = 4;
// The pair is too small to read at its true size (the Moon is under a pixel across at a phone's width): from
// the Moon outward to the pair, the Earth and the Moon are drawn larger by one factor, the Moon at least this
// many pixels (radius), and the view says "Not to scale" for as long as they are.
var LP_MOON_FLOOR_PX = 5, LP_EXAGGERATE_MAX = 8;
var LP_EXAG_IN = [0.2, 0.6], LP_EXAG_OUT = [1.0, 1.4];   // in stops: where the factor comes in and where it goes
var LP_EXAG_NOTE = 1.5;                                    // drawn this much larger, the view says so
var LP_DOT_PX_PER_DECADE = 2;               // bigger planets' dots, by decades of radius over Mercury's
var LP_DOT_FADE_PX = [1.5, 3.5];            // the Earth's and Moon's dots take over as their discs fall to this

// ── Pure: small things ──
function _lpLerp3(a, b, e) { return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e]; }
function _lpHexRGB(hex) {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}
// The camera's focal length in pixels for a view `h` tall.
function _lpFocalPx(h, tanHalf) { return (h / 2) / tanHalf; }

// ── Pure: where the solar bodies are, in the scene's frame ──
// The scene is the Earth's, so the Sun-centred layout sits in a frame of its own: the J2000
// ecliptic in Earth radii, laid out by lam, turned into the scene by the instant's rotation
// and carried to where the Sun is. Everything the landing draws far out is made through it.
function _lpToScene(v, sc) { return _ephEclJ2000ToEqOfDate(v, sc.jde); }
// A heliocentric position (AU, J2000 ecliptic) as the picture draws it, relative to the Sun, in Re.
function _lpLaid(p, lam) { return _aeScale(_ephLayoutMap(p, lam), LP_AU_RE); }
// The Sun's place in the scene when the layout is lam: the Earth stays where it is, at the origin.
function _lpSunScene(sc, lam) {
  return _aeScale(_lpToScene(_lpLaid(_lpEarthHelio(sc), lam), sc), -1);
}
// The Earth from the Sun (AU, J2000 ecliptic), made once for a scene.
function _lpEarthHelio(sc) { return sc.lpEarth || (sc.lpEarth = _ephBodyJ2000('Earth', sc.jd)); }
// A body's place in the scene: where the laid-out Sun is, plus the body's place round it, turned into the scene.
function _lpBodyScene(key, sc, lam) {
  var sun = _lpSunScene(sc, lam), p = _ephBodyJ2000(key, sc.jd);
  var q = _lpToScene(_lpLaid(p, lam), sc);
  return [sun[0] + q[0], sun[1] + q[1], sun[2] + q[2]];
}
// The scene's turn of one ecliptic direction (unit, J2000).
function _lpEclDir(v, sc) { return _aeNorm(_lpToScene(v, sc)); }

// ── Pure: the camera's roll ──
// The turn about the line of sight (degrees, from celestial north toward east: _aeViewUp)
// that stands `want` up on the screen, for a camera looking along `fwd`.
function _lpRollForUp(fwd, want) {
  var f = _aeNorm(fwd);
  var n = _aeSub([0, 0, 1], _aeScale(f, f[2]));
  if (_aeLen(n) < 1e-9) return 0;
  n = _aeNorm(n);
  var e = _aeCross(n, f);
  var up = _aeSub(want, _aeScale(f, _aeDot(want, f)));
  if (_aeLen(up) < 1e-12) return 0;
  up = _aeNorm(up);
  return _aeDeg(Math.atan2(_aeDot(up, e), _aeDot(up, n)));
}

// ── Pure: the Moon at rest ──
// What the hero is before any drag, one of three (LP_REST, or ?rest= / zimi.lpRest to compare):
//   moon   the Moon alone, as the picture is.
//   limb   the same Moon, the same size and phase, seen from behind the Earth: the camera stands back
//          along the line from the Moon through the Earth and a little aside, so the Earth's limb
//          stands beside the Moon at its true size, lit by the true Sun. All of it to scale.
//   sky    the same Moon, and round it where the Sun and the planets are in the sky: their true
//          directions from the Moon, their distances in the sky shrunk to fit (it says so).
var LP_REST = 'limb';
var LP_REST_MODES = ['moon', 'limb', 'sky'];
var LP_REST_EARTH_MOONS = 6;          // limb: the Earth drawn this many Moon radii across (radius): how far back the camera stands
var LP_REST_GAP_MOONS = 0.3;          // limb: the Earth's limb this many Moon radii from the Moon's
var LP_REST_EARTH_SPREAD = _aeRad(80);   // limb: the Earth stands opposite the Sun on the screen, within this of straight down (clear of the date above)
// limb: the words under the Moon (its phase, which way is up) as a box in Moon radii from the disc's centre, x across
// and y up, until the hero's own are measured (_lpCaptionBox); the Earth's limb keeps this far (Moon radii) clear of them.
var LP_REST_CAPTION = { hw: 0.9, top: -1.15, bottom: -1.6 };
var LP_REST_CAPTION_GAP_MOONS = 0.15;
var LP_REST_MOON_PX = 100;            // the Moon's radius in the open view at rest (CSS px), as in the hero
function _lpRestMode() {
  try {
    var q = /[?&]rest=([a-z]+)/.exec(location.search), s = q ? q[1] : localStorage.getItem('zimi.lpRest');
    if (LP_REST_MODES.indexOf(s) >= 0) return s;
  } catch (e) { /* storage blocked: the default */ }
  return LP_REST;
}
// limb: how far from straight down (radians) the Earth must stand on the screen for its disc to clear the caption
// box `cap`: the Earth drawn LP_REST_EARTH_MOONS Moon radii across, its limb LP_REST_GAP_MOONS from the Moon's.
// The nearest point of the box to the Earth's centre decides; up to LP_REST_EARTH_SPREAD, past which it does not go.
function _lpEarthClear(cap) {
  var R = LP_REST_EARTH_MOONS, D = 1 + LP_REST_GAP_MOONS + R;
  function clears(t) {
    var cx = D * Math.sin(t), cy = -D * Math.cos(t);
    var nx = Math.max(-cap.hw, Math.min(cap.hw, cx)), ny = Math.max(cap.bottom, Math.min(cap.top, cy));
    return Math.hypot(cx - nx, cy - ny) >= R + LP_REST_CAPTION_GAP_MOONS;
  }
  if (clears(0)) return 0;
  if (!clears(LP_REST_EARTH_SPREAD)) return LP_REST_EARTH_SPREAD;
  var lo = 0, hi = LP_REST_EARTH_SPREAD;
  for (var i = 0; i < 32; i++) { var mid = (lo + hi) / 2; if (clears(mid)) hi = mid; else lo = mid; }
  return hi;
}
// The screen's axes for a camera looking along `fwd` with `roll`: up and right (three.js: right = forward x up).
function _lpScreenAxes(fwd, roll) {
  var up = _aeViewUp(fwd, roll);
  return { up: up, right: _aeNorm(_aeCross(_aeNorm(fwd), up)) };
}
// A direction's place on the screen, as an angle (radians, counterclockwise from right) about the line of sight.
function _lpScreenAngle(v, ax) { return Math.atan2(_aeDot(v, ax.up), _aeDot(v, ax.right)); }
// limb: { tp, az, el, dist, roll, tanMoon }, for the Moon's roll in the observer's sky: the camera behind the Earth (tanMoon is the tangent of the
// Moon's angular radius from it), or null when the rest is not the limb. The Earth's limb stands on the
// side away from the Sun (its lit edge toward the Moon), kept in the screen's lower half and `clear` (radians, from
// _lpEarthClear) or more from straight down, where the Moon's words are.
function _lpRestPose(sc, roll, clear) {
  if (clear == null) clear = _lpEarthClear(LP_REST_CAPTION);
  var L = _aeLen(sc.moon), mh = _aeNorm(sc.moon);
  var ax = _lpScreenAxes(mh, roll);
  var sunAt = _lpScreenAngle(_aeNorm(sc.sun), ax);
  var down = -Math.PI / 2, away = _aeAngleDeltaRad(down, sunAt + Math.PI);
  var at = down + (away < 0 ? -1 : 1) * Math.max(clear, Math.min(LP_REST_EARTH_SPREAD, Math.abs(away)));
  var toward = _lpAdd3(_aeScale(ax.right, Math.cos(at)), _aeScale(ax.up, Math.sin(at)));   // where the Earth is drawn
  var k = L / (AE_MOON_RADIUS_RE * LP_REST_EARTH_MOONS - 1);
  // The camera aside by s, away from where the Earth is to stand: the Earth's limb this far from the Moon's.
  function place(s) { return _lpAdd3(_aeScale(mh, -k), _aeScale(toward, -s)); }
  function miss(s) {
    var P = place(s), dm = _aeSub(sc.moon, P), de = _aeScale(P, -1);
    var mu = Math.asin(AE_MOON_RADIUS_RE / _aeLen(dm)), rho = Math.asin(1 / _aeLen(de));
    var apart = Math.acos(Math.max(-1, Math.min(1, _aeDot(_aeNorm(dm), _aeNorm(de)))));
    return apart - rho - mu - Math.tan(mu) * LP_REST_GAP_MOONS;
  }
  var lo = 0, hi = 4 * k;
  for (var i = 0; i < 48; i++) { var mid = (lo + hi) / 2; if (miss(mid) < 0) lo = mid; else hi = mid; }
  var P = place(hi), off = _aeSub(P, sc.moon), azel = _aeAzElOf(off), dist = _aeLen(off);
  return { tp: sc.moon, az: azel.az, el: azel.el, dist: dist, roll: roll, tanMoon: Math.tan(Math.asin(AE_MOON_RADIUS_RE / dist)) };
}
// The hero's camera when the rest is the limb (the Earth view's hand-off asks: _aeHandCam): the pose,
// framed as the picture is, the Moon's disc across the frame's width.
function _lpRestHandCam(sc, hand) {
  if (_lpRestMode() !== 'limb') return null;
  var p = _lpRestPose(sc, _aeRollDeg('moon', sc.ms), _lpState.restClear), f = hand.frame;
  return { tp: p.tp, az: p.az + hand.daz, el: _aeClamp(p.el + hand.del, -AE_MAX_ELEVATION, AE_MAX_ELEVATION),
           dist: p.dist, tanHalf: p.tanMoon * f.h / f.w, roll: p.roll, frame: f };
}

// ── Pure: a camera for each stop ──
// A camera is { tp, dist, az, el, roll }: the point it looks at, how far it stands (Re), the
// direction it stands in (_aeCameraOffset), and its roll. `vp` is what the view is:
// { aspect, moonRoll } (the Moon's roll in the observer's sky, from the Earth view).
// The first stop is the Earth view's own Moon preset, so the hand-off from the hero lands on it.
function _lpCenters(sc, lam) {
  var sun = [_lpSunScene(sc, lam[2]), _lpSunScene(sc, lam[3]), _lpSunScene(sc, lam[4])];
  return [sc.moon, [0, 0, 0], _aeScale(sun[0], 0.5), sun[1], sun[2]];
}
function _lpStopCams(sc, vp, lams) {
  var lam = lams || LP_NOMINAL_LAM;
  var sunDir = _aeNorm(sc.sun);
  var north = _lpEclDir([0, 0, 1], sc);
  // The camera over the Earth's side of the system, the Sun in the screen's up: its direction from
  // the Sun, tipped up over the ecliptic.
  var earth = _lpEarthHelio(sc);
  var earthLon = Math.atan2(earth[1], earth[0]);
  var tilted = _lpEclDir([Math.cos(LP_PLANET_ELEVATION) * Math.cos(earthLon), Math.cos(LP_PLANET_ELEVATION) * Math.sin(earthLon), Math.sin(LP_PLANET_ELEVATION)], sc);
  // `aspect` is how much of the view's width the extent may take: the view's own, or 1 for a line that
  // runs up the screen (the Earth to the Sun, the Sun being in the screen's up), which has the height.
  function cam(center, extent, dir, roll, aspect) {
    var azel = _aeAzElOf(dir);
    return { tp: center, dist: _aeFitDist(extent, aspect || vp.aspect), az: azel.az, el: azel.el, th: LP_TAN_HALF,
             roll: roll === undefined ? _lpRollForUp(_aeScale(dir, -1), sunDir) : roll };
  }
  var centers = _lpCenters(sc, lam);
  var towardEarth = _aeScale(sc.moon, -1);
  return [
    _lpRestStop(sc, vp) || cam(centers[0], AE_FIT_MOON, towardEarth, vp.moonRoll),
    cam(centers[1], LP_MOON_APOGEE_KM / AE_EARTH_RADIUS_KM * LP_ORBIT_MARGIN, north),
    cam(centers[2], _aeLen(centers[2]) * LP_SUN_MARGIN, north, undefined, (vp.height - LP_CLEAR_TOP_PX - LP_CLEAR_BOTTOM_PX) / vp.height),
    cam(centers[3], _aeLen(_lpLaid([LP_INNER_REACH_AU, 0, 0], lam[3])) * LP_OUT_MARGIN, tilted),
    cam(centers[4], _aeLen(_lpLaid([LP_OUTER_REACH_AU, 0, 0], lam[4])) * LP_OUT_MARGIN, tilted)
  ].map(function (c, i) { c.stop = LP_STOPS[i]; return c; });
}

var LP_TAN_HALF = Math.tan(_aeRad(AE_FOV_DEG) / 2);   // the view's own field, every stop's but a limb rest's
// The first stop when the rest is the limb: the hero's camera, its field narrowed so the Moon is as large
// in the open view as in the hero (a drag from the hero starts where the picture is).
function _lpRestStop(sc, vp) {
  if (_lpRestMode() !== 'limb') return null;
  var p = _lpRestPose(sc, vp.moonRoll, vp.restClear);
  return { tp: p.tp, dist: p.dist, az: p.az, el: p.el, roll: p.roll, th: p.tanMoon * (vp.height / 2) / LP_REST_MOON_PX };
}
// Two cameras `e` of the way from a to b: the point linearly, the distance by its log, the turns the short way.
// The point the camera looks at moves by the share of the distance covered (`ft`), not of the ease: what the
// camera looked at stays in view as it pulls back (the Moon, leaving the pair's centre behind).
function _lpBlendCam(a, b, e, ft) {
  return {
    tp: _lpLerp3(a.tp, b.tp, ft === undefined ? e : ft), dist: _aeLogLerp(a.dist, b.dist, e), th: _aeLogLerp(a.th, b.th, e),
    az: a.az + _aeAngleDeltaRad(a.az, b.az) * e, el: a.el + (b.el - a.el) * e,
    roll: a.roll + _angleDelta(a.roll, b.roll) * e
  };
}
// Where on the axis u lies: the stop below it and the eased share of the way to the next.
function _lpSegment(u) {
  var c = Math.max(0, Math.min(LP_LAST, u));
  var i = Math.min(Math.floor(c), LP_LAST - 1);
  return { i: i, f: c - i, e: _smoothstep(0, 1, c - i) };
}

// ── Pure: true or laid out ──
// The smallest planet in view, in pixels (radius), against a floor, is the layout: 0 where every
// planet in view is drawn plainly, 1 where one has lost its size. The Earth is always the reference
// (the Moon is no planet, and from the pair outward the Earth is the first planet and the largest
// of the small ones): any other planet within a half-view of what the camera looks at counts too,
// and is smaller still. So it is a function of how far back the camera stands, and rises smoothly.
function _lpLamFor(dist, tp, sc, vp, th) {
  var half = dist * th * Math.min(1, vp.aspect);
  var focal = _lpFocalPx(vp.height, th);
  var smallest = EPH_PLANET.Earth.km / AE_EARTH_RADIUS_KM / dist * focal;
  EPH_PLANET_KEYS.forEach(function (k) {
    if (k === 'Earth' || _aeLen(_aeSub(_lpBodyScene(k, sc, 0), tp)) > half) return;
    smallest = Math.min(smallest, EPH_PLANET[k].km / AE_EARTH_RADIUS_KM / dist * focal);
  });
  return 1 - _smoothstep(LP_PX_LOST, LP_PX_TRUE, smallest);
}

// ── Pure: the camera at u ──
// { cam, lam, u }: the camera on the axis, and how far the picture is laid out there. The
// distances are each stop's own; the layout follows from the distance; the points the camera
// looks at are then made in that layout, so what it looks at is where it is drawn.
function _lpAxisCam(u, sc, vp, tilt) {
  var seg = _lpSegment(u);
  var nominal = _lpStopCams(sc, vp);
  var dist = _aeLogLerp(nominal[seg.i].dist, nominal[seg.i + 1].dist, seg.e);
  var tpNominal = _lpLerp3(nominal[seg.i].tp, nominal[seg.i + 1].tp, seg.e);
  var lam = _lpLamFor(dist, tpNominal, sc, vp, _aeLogLerp(nominal[seg.i].th, nominal[seg.i + 1].th, seg.e));
  var lams = LP_NOMINAL_LAM.map(function (n, i) { return i < LP_EARTH ? 0 : lam; });
  var cams = _lpStopCams(sc, vp, lams);
  var span = nominal[seg.i + 1].dist - nominal[seg.i].dist;
  var cam = _lpBlendCam(cams[seg.i], cams[seg.i + 1], seg.e, span > 0 ? Math.max(0, Math.min(1, (dist - nominal[seg.i].dist) / span)) : seg.e);
  cam.dist = dist;
  if (tilt) cam.el = Math.max(-AE_MAX_ELEVATION, Math.min(AE_MAX_ELEVATION, cam.el + tilt));
  return { cam: cam, lam: lam, u: u, grow: _lpExaggeration(u, dist, _lpFocalPx(vp.height, cam.th)) };
}
// Where a camera stands: its point plus its offset.
function _lpCamPos(cam) { return _lpAdd3(cam.tp, _aeCameraOffset(cam.az, cam.el, cam.dist)); }
// The nearest stop, and whether u is close enough to it for a release to settle there.
function _lpSnap(u) {
  var s = Math.max(0, Math.min(LP_LAST, Math.round(u)));
  return { stop: s, near: Math.abs(u - s) <= LP_SNAP_WINDOW };
}
function _lpSaysNotToScale(lam, grow) { return lam >= LP_NOT_TO_SCALE_FROM || (grow || 1) >= LP_EXAG_NOTE; }
// How much larger the Earth and the Moon are drawn at u, for a camera `dist` away with `focal` pixels.
function _lpExaggeration(u, dist, focal) {
  var moonPx = AE_MOON_RADIUS_RE / dist * focal;
  var grow = Math.min(LP_EXAGGERATE_MAX, Math.max(1, LP_MOON_FLOOR_PX / moonPx));
  var w = _smoothstep(LP_EXAG_IN[0], LP_EXAG_IN[1], u) * (1 - _smoothstep(LP_EXAG_OUT[0], LP_EXAG_OUT[1], u));
  return 1 + (grow - 1) * w;
}

// ── Pure: distances, in words ──
// A stop's distance from the Earth, km: the farthest body it holds, now.
function _lpStopKm(stop, sc) {
  var reach = LP_STOP_REACH[stop];
  if (reach === 'Moon') return sc.moonEq.distKm;
  if (reach === 'Sun') return sc.sunEq.distKm;
  var p = _ephBodyJ2000(reach, sc.jd), e = _lpEarthHelio(sc);
  return _aeLen(_aeSub(p, e)) * AU_KM;
}
function _lpLightSeconds(km) { return km / SPEED_OF_LIGHT_KM_S; }
var LP_COMPACT_FROM_KM = 1e6;
function _lpFmtKm(km) {
  if (km < LP_COMPACT_FROM_KM) return _orrNum(Math.round(km), 'kilometer');
  return _orrFormatter('lp-km', function (lang) {
    try { return new Intl.NumberFormat(lang, { style: 'unit', unit: 'kilometer', unitDisplay: 'short', notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }); }
    catch (e) { return { format: function (x) { return Math.round(x / 1e6) + 'M km'; } }; }
  }).format(km);
}
// "384,400 km · 1.3 sec by light", in the reader's language.
function _lpFmtReach(km) {
  return _lpFmtKm(km) + ' · ' + _aeT('lp_by_light', { time: _orrFmtSpan(_lpLightSeconds(km)) });
}

// The stars stand at infinity: a sphere carried with the camera, which a near plane out past it would clip.
function _lpStarScale(near, far) {
  var radius = AE_STAR_RADIUS;
  if (near * LP_STAR_NEAR_FACTOR > radius) radius = near * LP_STAR_NEAR_FACTOR;
  return Math.min(radius, far * LP_STAR_FAR_SHARE) / AE_STAR_RADIUS;
}

// ── The scene's solar layer ──
// Built into the Earth view's scene when it is: the planets' orbits (one loop each, in the layout's
// frame and moved with the Sun), a dot for each planet, the Earth and the Moon (for when their discs
// fall under a pixel), and the two rays of sunlight. Nothing here is drawn while the camera is at the
// Moon or the Earth and Moon, except the rays.
var LP_ORBIT_POINTS = 128;
var LP_ORBIT_ALPHA = 0.26, LP_ORBIT_EARTH_ALPHA = 0.4;
var LP_RAY_ALPHA = 0.5;
var LP_RAY_FROM = 0.15, LP_RAY_TO = 0.55;        // the rays come in as the camera leaves the Moon
var LP_RAY_OUT = 1.5;                            // and are gone by here, past the pair (stops)
var LP_SATS_HIDDEN_FROM = 0.45;                 // the Earth's satellites are a speck on it from here out
var LP_PHASE_FROM = 0.6, LP_PHASE_TO = 2.3;      // the phase disc stands from the pair out to the Earth stop
var LP_RAY_LENGTH_RE = 38;                       // each ray's length at the pair, at least
var LP_RAY_ORBIT_SHARE = 0.6;                    // and a share of the Moon's distance, so it stands out of the pair's view
var LP_ORBITS_FROM = 1.6, LP_ORBITS_TO = 2.0;    // orbits and dots come in between the pair and the Earth stop
var LP_DOT_COLORS = { Moon: '#c8c8c8' };

function _lpBuildSolar(S) {
  var THREE = S.THREE;
  var group = new THREE.Group();
  group.matrixAutoUpdate = false;
  var orbits = EPH_PLANET_KEYS.map(function (k) {
    var line = _aeLine(THREE, THREE.LineLoop, LP_ORBIT_POINTS, _lpHexInt(EPH_PLANET[k].color), k === 'Earth' ? LP_ORBIT_EARTH_ALPHA : LP_ORBIT_ALPHA);
    line.geometry.setDrawRange(0, LP_ORBIT_POINTS);
    group.add(line);
    return { key: k, line: line };
  });
  S.scene.add(group);
  var dots = _aePointCloud(THREE, EPH_PLANET_KEYS.length + 1, S.dpr, true, { depthTest: true });
  S.scene.add(dots);
  var rays = _aeLine(THREE, THREE.LineSegments, 4, 0xffe9a8, LP_RAY_ALPHA);
  S.scene.add(rays);
  return { group: group, orbits: orbits, dots: dots, rays: rays, orbitsAt: null, basis: new THREE.Matrix4(), vx: new THREE.Vector3(), vy: new THREE.Vector3(), vz: new THREE.Vector3(), v: new THREE.Vector3() };
}
function _lpHexInt(hex) { return parseInt(hex.slice(1), 16); }

// The Earth and the Moon, drawn `grow` times their size (1 is true): the meshes' own scales, about their centres.
function _lpSizeBodies(S, grow) {
  var L = S.solar;
  S.earth.scale.set(grow, grow, grow * (1 - AE_EARTH_FLATTENING));
  S.atmo.scale.setScalar(grow);
  if (grow !== 1) S.moon.matrix.scale(L.v.set(grow, grow, grow));
}
// The orbit loops, in the layout's frame (Sun-centred, J2000 ecliptic, Re): remade when the
// instant moves by a day or the layout by a hundredth, not every frame.
var LP_ORBIT_REFRESH_DAYS = 1, LP_ORBIT_REFRESH_LAM = 0.01;
function _lpUpdateOrbits(L, sc, lam) {
  if (L.orbitsAt && Math.abs(sc.jd - L.orbitsAt.jd) < LP_ORBIT_REFRESH_DAYS && Math.abs(lam - L.orbitsAt.lam) < LP_ORBIT_REFRESH_LAM) return;
  L.orbits.forEach(function (o) {
    var arr = o.line.geometry.attributes.position.array, period = EPH_PLANET[o.key].periodDays;
    for (var i = 0; i < LP_ORBIT_POINTS; i++) {
      var p = _lpLaid(_ephBodyJ2000(o.key, sc.jd + period * i / LP_ORBIT_POINTS), lam);
      arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2];
    }
    o.line.geometry.attributes.position.needsUpdate = true;
  });
  L.orbitsAt = { jd: sc.jd, lam: lam };
}
// The layout frame's turn into the scene, and its origin where the Sun is.
function _lpOrientGroup(L, sc, sun) {
  var x = _lpToScene([1, 0, 0], sc), y = _lpToScene([0, 1, 0], sc), z = _lpToScene([0, 0, 1], sc);
  L.vx.set(x[0], x[1], x[2]); L.vy.set(y[0], y[1], y[2]); L.vz.set(z[0], z[1], z[2]);
  L.basis.makeBasis(L.vx, L.vy, L.vz);
  L.basis.setPosition(sun[0], sun[1], sun[2]);
  L.group.matrix.copy(L.basis);
  L.group.matrixWorldNeedsUpdate = true;
}
// Dot sizes: Mercury's, and a little more for each decade of radius.
function _lpDotSize(km) { return LP_DOT_PX + LP_DOT_PX_PER_DECADE * Math.max(0, Math.log10(km / EPH_PLANET.Mercury.km)); }
// How much of an orbit's alpha a stop's distance leaves: orbits belong to the planets' stops.
function _lpPlanetsIn(u) { return _smoothstep(LP_ORBITS_FROM, LP_ORBITS_TO, u); }
function _lpRaysIn(u) { return _smoothstep(LP_RAY_FROM, LP_RAY_TO, u) * (1 - _smoothstep(1, LP_RAY_OUT, u)); }

// One frame's worth of the layer: the orbits and dots at the layout lam for a camera at `cam`
// (distance `dist` from what it looks at, `focal` pixels), the Sun moved between the Earth view's near
// one and the true one, the rays. Returns where each planet is drawn, for the labels.
function _lpUpdateSolar(S, sc, ax, vp, focal) {
  var L = S.solar, u = ax.u, lam = ax.lam, dist = ax.cam.dist, grow = ax.grow;
  var sun = _lpSunScene(sc, lam);
  _lpSizeBodies(S, grow);
  var planets = _lpPlanetsIn(u);
  var places = {};
  // The orbits and dots.
  L.group.visible = planets > 0;
  if (planets > 0) {
    _lpUpdateOrbits(L, sc, lam);
    _lpOrientGroup(L, sc, sun);
    L.orbits.forEach(function (o) { o.line.material.opacity = (o.key === 'Earth' ? LP_ORBIT_EARTH_ALPHA : LP_ORBIT_ALPHA) * planets * _aeFadeU.value; });
  }
  var n = 0;
  EPH_PLANET_KEYS.forEach(function (k) {
    var pos = k === 'Earth' ? [0, 0, 0] : _lpBodyScene(k, sc, lam);
    places[k] = pos;
    var alpha = planets;
    // The Earth's dot comes in as its disc falls under a pixel or two, wherever the axis is; the others' with the planets.
    if (k === 'Earth') alpha = 1 - _smoothstep(LP_DOT_FADE_PX[0], LP_DOT_FADE_PX[1], grow / dist * focal);
    if (alpha > 0.01) _aeSetPoint(L.dots, n++, pos, _lpHexRGB(EPH_PLANET[k].color), alpha, _lpDotSize(EPH_PLANET[k].km));
  });
  // The Moon: a dot as its disc falls under a pixel or two, from the pair outward.
  var moonPx = grow * AE_MOON_RADIUS_RE / Math.max(1e-6, _aeLen(_aeSub(sc.moon, _lpCamPos(ax.cam)))) * focal;
  var moonAlpha = _smoothstep(0, LP_PAIR, u) * (1 - _smoothstep(LP_DOT_FADE_PX[0], LP_DOT_FADE_PX[1], moonPx));
  if (moonAlpha > 0.01) _aeSetPoint(L.dots, n++, sc.moon, _lpHexRGB(LP_DOT_COLORS.Moon), moonAlpha, LP_DOT_PX);
  places.Moon = sc.moon;
  _aeCommitPoints(L.dots, n);
  // The Sun: the Earth view's near one at the Moon and the pair, the true one (laid out) from the Earth stop on.
  var mix = _smoothstep(Math.log(LP_SUN_MIX_FROM), Math.log(LP_SUN_MIX_TO), Math.log(dist));
  var nearDist = AE_SUN_SHOW_DIST, farDist = _aeLen(sun);
  var d = _aeLogLerp(nearDist, farDist, mix), dir = _aeNorm(sc.sun);
  S.sun.position.set(dir[0] * d, dir[1] * d, dir[2] * d);
  var camToSun = Math.max(1, _aeLen(_aeSub([dir[0] * d, dir[1] * d, dir[2] * d], _lpCamPos(ax.cam))));
  var farR = Math.max(AE_SUN_RADIUS_RE, LP_SUN_FLOOR_PX * camToSun / focal);
  var r = _aeLogLerp(AE_SUN_SHOW_R, farR, mix);
  S.sun.scale.setScalar(r / AE_SUN_SHOW_R);
  S.sunGlowUni.center.value.copy(S.sun.position);
  S.sunGlowUni.radius.value = r;
  places.Sun = [dir[0] * d, dir[1] * d, dir[2] * d];
  // The two rays of sunlight, Earth's and Moon's, parallel, as long as the pair's view is wide.
  var rays = _lpRaysIn(u);
  L.rays.visible = rays > 0;
  if (rays > 0) {
    var len = Math.max(LP_RAY_LENGTH_RE, _aeLen(sc.moon) * LP_RAY_ORBIT_SHARE), arr = L.rays.geometry.attributes.position.array;
    var seg = [[0, 0, 0], sc.moon];
    for (var i = 0; i < 2; i++) {
      var a = seg[i], b = _lpAdd3(a, _aeScale(dir, len));
      arr.set(a, i * 6); arr.set(b, i * 6 + 3);
    }
    L.rays.geometry.attributes.position.needsUpdate = true;
    L.rays.geometry.setDrawRange(0, 4);
    L.rays.material.opacity = LP_RAY_ALPHA * rays * _aeFadeU.value;
    places.Ray = _lpAdd3(sc.moon, _aeScale(dir, len));
  }
  return places;
}
function _lpAdd3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

// ── Styles, with the module ──
var LP_TRACK_BOTTOM_PX = 236;
var LP_BAND_ABOVE_PX = 40, LP_BAND_BELOW_PX = 84, LP_BAND_FADE_PX = 28;   // the rest's band, round the hero                // the track stops above the controls and the hint
var LP_CSS = [
  // The canvas in the hero: over the picture, under the finger (the disc's own handlers take the touch).
  '.lp-in-hero{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;border-radius:50%;cursor:inherit}',
  '.almanac-view.lp-live .almanac-moon{visibility:hidden}',
  // Red night light: the live Moon in the hero is turned red the way the picture it stands in for is (an image's
  // filter, app.css), not the way a canvas is (brighter): the swap from one to the other changes nothing you see.
  ':root.night-red canvas.lp-in-hero:not([data-red]){filter:var(--red-picture)}',
  '.almanac-view.lp-nogl .almanac-moon-open{cursor:default}',
  // At rest beyond the Moon alone, the canvas is a band the width of the view behind the hero and its words: the
  // Moon where the picture's is, what is round it fading into the page at the band's top and foot.
  '.almanac-view.lp-live .almanac-hero{isolation:isolate}',
  '.lp-in-hero.lp-band,.lp-sky{position:absolute;inset:auto;border-radius:0;z-index:-1;pointer-events:none;' +
    '-webkit-mask-image:linear-gradient(to bottom,transparent,#000 ' + LP_BAND_FADE_PX + 'px,#000 calc(100% - ' + LP_BAND_FADE_PX + 'px),transparent);' +
    'mask-image:linear-gradient(to bottom,transparent,#000 ' + LP_BAND_FADE_PX + 'px,#000 calc(100% - ' + LP_BAND_FADE_PX + 'px),transparent)}',
  '.almanac-view.lp-live.lp-rest .almanac-moon-name,.almanac-view.lp-live.lp-rest .almanac-moon-name ~ *{text-shadow:0 1px 3px #000,0 0 8px #000}',
  ':root.night-red .lp-sky{filter:var(--red-picture)}',
  // The limb's Moon is seen from a degree aside of the Earth's (the camera clears the Earth), a pixel or two from
  // the picture's: the band comes in under the picture, then the picture fades into it, instead of a swap.
  '.almanac-view.lp-live.lp-limb .almanac-moon{visibility:visible;opacity:0;animation:lp-out .3s ease .35s backwards}',
  '.lp-in-hero.lp-band,.lp-sky{animation:lp-in .35s ease backwards}',
  '@keyframes lp-in{from{opacity:0}to{opacity:1}}',
  '@keyframes lp-out{from{opacity:1}to{opacity:0}}',
  '@media (prefers-reduced-motion: reduce){.almanac-view.lp-live.lp-limb .almanac-moon,.lp-in-hero.lp-band,.lp-sky{animation:none}}',
  // The axis: a thin track on the end edge, the stops on it, the way back at its foot.
  '.lp-track{position:absolute;inset-inline-end:10px;top:118px;bottom:' + LP_TRACK_BOTTOM_PX + 'px;width:2px;background:rgba(255,255,255,.22);border-radius:1px;display:none;opacity:var(--ae-ui,1);pointer-events:none}',
  '.ae-view.lp-axis .lp-track{display:block}',
  // A tick is a 44 px target (a finger's), its mark a 12 px dot, its words beside it.
  '.lp-tick{position:absolute;inset-inline-end:-21px;width:44px;height:44px;margin-bottom:-22px;padding:0;border:0;background:none;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent}',
  '.lp-tick::before{content:"";position:absolute;inset:16px;border-radius:50%;background:rgba(18,18,20,.9);border:1.5px solid var(--text2)}',
  '.lp-tick:focus-visible{outline:none}.lp-tick:focus-visible::before{border-color:var(--amber);box-shadow:0 0 0 3px var(--amber-glow)}',
  '.lp-tick.lp-on::before{background:var(--amber);border-color:var(--amber)}',
  '.lp-tick-text{position:absolute;inset-inline-end:36px;top:50%;transform:translateY(-50%);text-align:end;white-space:nowrap;font-size:11px;line-height:1.3;color:var(--text2);text-shadow:0 1px 2px #000,0 0 4px #000;pointer-events:none}',
  '.lp-tick-text b{display:block;font-weight:500;color:var(--text)}',
  '.lp-tick-text i{display:none;font-style:normal;font-size:10.5px;color:var(--text2)}',
  '.lp-tick.lp-on .lp-tick-text i{display:block}',
  '.lp-knob{position:absolute;inset-inline-end:-4px;width:10px;height:10px;margin-bottom:-5px;border-radius:50%;background:var(--amber);box-shadow:0 0 6px rgba(245,158,11,.7);pointer-events:none}',
  '.lp-scale{display:none;font-size:12px;line-height:1.3;color:var(--amber);text-shadow:0 1px 3px #000;pointer-events:none}',
  '.ae-view.lp-axis .lp-scale.lp-show{display:block}',
  '.ae-view.lp-axis #ae-views{display:none}',
  '.lp-phase{position:absolute;inset-inline-start:16px;top:62px;width:56px;text-align:center;font-size:10.5px;line-height:1.25;color:var(--text2);text-shadow:0 1px 2px #000;pointer-events:none;display:none;opacity:0;transition:opacity .25s}',
  '.ae-view.lp-axis .lp-phase{display:block}',
  '.lp-phase img{display:block;width:56px;height:56px;border-radius:50%}',
  '.lp-phase.lp-show{opacity:1}',
  '@media (prefers-reduced-motion: reduce){.lp-phase{transition:none}}',
  // Red night light: every tint here is the one red.
  '.night-red .lp-knob,.night-red .lp-tick.lp-on::before{box-shadow:none}',
  '.night-red .lp-scale{color:var(--text)}',
  '.night-red .lp-track{background:var(--border-strong)}',
  '.night-red .lp-tick::before{background:rgba(0,0,0,.9)}'
].join('\n');
function _lpEnsureStyles() {
  if (document.getElementById('lp-style')) return;
  var st = document.createElement('style');
  st.id = 'lp-style';
  st.textContent = LP_CSS;
  document.head.appendChild(st);
}

// ── State ──
var _lpState = {
  hero: null,          // the hero element the view's canvas stands in, or null
  canvas: null,        // the view's canvas, held while it stands in the hero
  drawnMs: null,       // the instant the hero's scene was last drawn for
  watchHead: null, watchHero: null,
  queued: false,
  axis: null,          // { u, fly, tilt }: the axis while the view is open on it
  ax: null,            // the camera on the axis this frame: { cam, lam, u }
  gesture: null,       // the drag under way: { key, kind, dir }
  places: null,        // where each body was drawn last frame, for the labels
  pending: null,       // a drag's travel before the scene was ready: { dx, dy, dir, at }
  uiKey: null, phaseKey: null,   // what the ticks' words and the phase disc were last written for
  dom: false, hinted: false,
  restClear: null      // limb: how far from straight down the Earth stands, from the hero's words (_lpCaptionBox)
};
function _lpById(id) { return document.getElementById(id); }

// ── The hero ──
// The hero's canvas draws the Earth view's own scene in the hero's rectangle: the Moon the
// hand-off already proves is the picture's twin (tests/test_moon_handoff_live.py), with
// the layers that are not the Moon faded out (_aeFadeU is 0) and the camera standing as the
// hand-off's first frame (_aeHandCam). It redraws when the picture beneath it changes (the
// minute's tick, the time machine, a rebuilt header): a mutation on the header says so, so
// the code that draws the picture needs no knowing of it.
function _lpHeroEl() { return document.querySelector(AE_HERO_SEL); }
function _lpPictureShows() {
  return (typeof _heroMoonOverlay !== 'undefined' && !!_heroMoonOverlay) ||
    (typeof _heroMoonAnim !== 'undefined' && !!_heroMoonAnim) ||
    (typeof _heroMoonTravelOn !== 'undefined' && _heroMoonTravelOn);
}
function _lpCanLive() {
  return typeof _aeReady === 'function' && _aeReady() && !_aeIsOpen && !_ae.hand &&
    (typeof _almanacOpen === 'undefined' || _almanacOpen) && !document.hidden;
}
// In a microtask, not a frame: a mutation's callback runs before the page paints, so the scene is drawn in the
// frame the picture changes (a frame later would show the new picture for one frame), and a page that is not
// asking for frames still gets it.
function _lpQueueSync() {
  if (_lpState.queued) return;
  _lpState.queued = true;
  (typeof queueMicrotask === 'function' ? queueMicrotask : function (f) { setTimeout(f, 0); })(_lpSync);
}
// The view's canvas. Held by reference while it stands in the hero: a rebuilt header (innerHTML) takes it out
// of the page with the old hero, and it must be found again to be put back.
function _lpCanvas() { return _lpState.canvas || _lpById('ae-canvas'); }
// The canvas goes back to the view (it is the view's), and the picture shows.
function _lpDetach() {
  var canvas = _lpCanvas(), view = _lpById('almanac-view');
  if (view) view.classList.remove('lp-live', 'lp-rest', 'lp-limb');
  var sky = _lpById('lp-sky');
  if (sky) sky.remove();
  if (canvas) {
    canvas.classList.remove('lp-in-hero', 'lp-band');
    canvas.style.left = canvas.style.top = canvas.style.width = canvas.style.height = '';
    if (!canvas.getAttribute('style')) canvas.removeAttribute('style');   // the canvas as it was, attribute for attribute
    canvas.removeAttribute('aria-hidden');
    canvas.setAttribute('tabindex', '0');
    if (_ae && _ae.el && canvas.parentNode !== _ae.el) _ae.el.insertBefore(canvas, _ae.el.firstChild);
  }
  _lpState.hero = null;
  _lpForgetOwnMutations();
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
  // The Moon alone fills the hero; a limb rest draws a band round it, the hero its frame within.
  var rest = _lpRestMode(), band = rest === 'moon' ? null : _lpBand(hero, view);
  var frame = { x: 0, y: 0, w: w, h: h };
  canvas.classList.toggle('lp-band', rest === 'limb');
  if (rest === 'limb') {
    _lpState.restClear = _lpEarthClear(_lpCaptionBox(hero) || LP_REST_CAPTION);
    _lpPlaceBand(canvas, band);
    frame = { x: -band.x, y: -band.y, w: w, h: h };
    w = band.w; h = band.h;
  } else {
    canvas.style.left = canvas.style.top = canvas.style.width = canvas.style.height = '';
  }
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
  if (rest === 'sky') _lpDrawSky(hero, band, _aeSceneAt(ms));
  else { var old = _lpById('lp-sky'); if (old) old.remove(); }
  view.classList.add('lp-live');
  view.classList.toggle('lp-rest', rest !== 'moon');
  view.classList.toggle('lp-limb', rest === 'limb');
  _lpState.hero = hero;
  _lpState.drawnMs = ms;
  _lpForgetOwnMutations();
}
// The hero's words under the Moon as a box in Moon radii from the disc's centre (x across, y up), their text's own
// extent (the language's width, not the line's); null when there is no disc to measure from.
function _lpCaptionBox(hero) {
  var disc = hero.querySelector('.almanac-moon'), open = hero.querySelector('.almanac-moon-open');
  if (!disc || !open) return null;
  var d = disc.getBoundingClientRect(), R = d.width / 2, cx = d.left + R, cy = d.top + R, range = document.createRange(), box = null;
  if (!R) return null;
  for (var el = open.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.tagName === 'CANVAS' || !el.textContent.trim()) continue;
    range.selectNodeContents(el);
    var r = range.getBoundingClientRect();
    if (!r.width) continue;
    var hw = Math.max(Math.abs(r.left - cx), Math.abs(r.right - cx)) / R, top = (cy - r.top) / R, bottom = (cy - r.bottom) / R;
    box = box ? { hw: Math.max(box.hw, hw), top: Math.max(box.top, top), bottom: Math.min(box.bottom, bottom) } : { hw: hw, top: top, bottom: bottom };
  }
  return box;
}
// The band round the hero, in the hero's own coordinates: the view's width, from above the disc to below its words.
function _lpBand(hero, view) {
  var hr = hero.getBoundingClientRect(), vr = view.getBoundingClientRect();
  return { x: Math.round(vr.left - hr.left), y: -LP_BAND_ABOVE_PX, w: Math.round(vr.width), h: Math.round(hr.height) + LP_BAND_ABOVE_PX + LP_BAND_BELOW_PX };
}
function _lpPlaceBand(el, band) {
  el.style.left = band.x + 'px'; el.style.top = band.y + 'px';
  el.style.width = band.w + 'px'; el.style.height = band.h + 'px';
}
// sky: where the Sun and the planets are from the Moon, on a ring round it. Each stands at its true direction
// from the Moon in the sky (the way to it, turned as the hero is), named with how far away in the sky it is.
var LP_SKY_RING_GAP_PX = 14, LP_SKY_LABEL_GAP_PX = 10, LP_SKY_LABEL_STEP_PX = 13, LP_SKY_EDGE_PX = 4;
var LP_SKY_SUN = '#ffd27a';
function _lpSkyBodies(sc) {
  var fwd = _aeNorm(sc.moon), ax = _lpScreenAxes(fwd, _aeRollDeg('moon', sc.ms));
  var list = [{ name: _aeT('alm_sun'), dir: _aeNorm(sc.sun), color: LP_SKY_SUN, r: 5 }];
  EPH_PLANET_KEYS.forEach(function (k) {
    if (k !== 'Earth') list.push({ name: _tp(k), dir: _aeNorm(_lpBodyScene(k, sc, 0)), color: EPH_PLANET[k].color, r: 2.5 });
  });
  return list.map(function (b) {
    return { name: b.name, color: b.color, r: b.r, angle: _lpScreenAngle(b.dir, ax),
             deg: Math.round(_aeDeg(Math.acos(Math.max(-1, Math.min(1, _aeDot(b.dir, fwd)))))) };
  });
}
function _lpDrawSky(hero, band, sc) {
  var cv = _lpById('lp-sky');
  if (!cv) { cv = document.createElement('canvas'); cv.id = 'lp-sky'; cv.className = 'lp-sky'; cv.setAttribute('aria-hidden', 'true'); }
  if (cv.parentNode !== hero) hero.appendChild(cv);
  _lpPlaceBand(cv, band);
  var dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(band.w * dpr); cv.height = Math.round(band.h * dpr);
  var g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  var cx = -band.x + hero.offsetWidth / 2, cy = -band.y + hero.offsetHeight / 2, ring = hero.offsetWidth / 2 + LP_SKY_RING_GAP_PX;
  g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, ring, 0, AE_TWO_PI); g.stroke();
  g.font = '11px system-ui,-apple-system,sans-serif'; g.textBaseline = 'middle';
  var placed = [];
  _lpSkyBodies(sc).forEach(function (b) {
    var ux = Math.cos(b.angle), uy = -Math.sin(b.angle);
    g.fillStyle = b.color;
    g.beginPath(); g.arc(cx + ux * ring, cy + uy * ring, b.r, 0, AE_TWO_PI); g.fill();
    var text = b.name + ' ' + b.deg + '\u00b0', tw = g.measureText(text).width, rr = ring + LP_SKY_LABEL_GAP_PX, box;
    // Out along its own direction until it is clear of the names already written.
    // Out along its own direction until it is clear of the names already written, inside the band; a name with
    // no room is left out (its dot stays).
    var clear = false;
    for (var i = 0; i < 6 && !clear; i++, rr += LP_SKY_LABEL_STEP_PX) {
      var x = cx + ux * rr, y = cy + uy * rr;
      box = { x: ux < -0.2 ? x - tw : (ux > 0.2 ? x : x - tw / 2), y: y - 7, w: tw, h: 14 };
      box.x = Math.max(LP_SKY_EDGE_PX, Math.min(band.w - LP_SKY_EDGE_PX - tw, box.x));
      clear = box.y > LP_BAND_FADE_PX / 2 && box.y + box.h < band.h - LP_BAND_FADE_PX / 2 &&
        !placed.some(function (p) { return box.x < p.x + p.w && p.x < box.x + box.w && box.y < p.y + p.h && p.y < box.y + box.h; }) &&
        Math.hypot(box.x + tw / 2 - cx, box.y + 7 - cy) > ring;
    }
    if (!clear) return;
    placed.push(box);
    g.fillStyle = 'rgba(232,232,236,.85)';
    g.fillText(text, box.x, box.y + 7);
  });
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
// The band is the view's width: a turned phone or a resized window draws the hero again.
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
function _lpBeforeShow() { _lpDetach(); }
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
function _lpQueueDrag(dx, dy) {
  var now = performance.now(), p = _lpState.pending;
  if (!p || now - p.at > LP_PENDING_MS) p = _lpState.pending = { dx: 0, dy: 0, dir: 0, at: now };
  if (!p.dir && dx) p.dir = dx > 0 ? 1 : -1;
  p.dx += dx * (p.dir || 1); p.dy += dy; p.at = now;
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
  return { aspect: _ae.w / _ae.h, height: _ae.h, moonRoll: _aeRollDeg('moon', sc.ms), restClear: _lpState.restClear };
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
  var g = { key: key, kind: 'axis', dir: 0 };
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
  // The first move says which way is back; the finger going the other way brings the camera in again.
  if (!g.dir && dx) g.dir = dx > 0 ? 1 : -1;
  ax.u = Math.max(0, Math.min(LP_LAST, ax.u + dx * (g.dir || 1) / LP_PX_PER_STOP));
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
    // The view's own field is wider than a limb rest's: it stands nearer, so what it looked at stays the size it was.
    _ae.dist = _aeClampDist(st.cam.dist * st.cam.th / LP_TAN_HALF);
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
