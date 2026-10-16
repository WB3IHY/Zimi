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
    return { tp: center, dist: _aeFitDist(extent, aspect || vp.aspect), az: azel.az, el: azel.el,
             roll: roll === undefined ? _lpRollForUp(_aeScale(dir, -1), sunDir) : roll };
  }
  var centers = _lpCenters(sc, lam);
  var towardEarth = _aeScale(sc.moon, -1);
  return [
    cam(centers[0], AE_FIT_MOON, towardEarth, vp.moonRoll),
    cam(centers[1], LP_MOON_APOGEE_KM / AE_EARTH_RADIUS_KM * LP_ORBIT_MARGIN, north),
    cam(centers[2], _aeLen(centers[2]) * LP_SUN_MARGIN, north, undefined, (vp.height - LP_CLEAR_TOP_PX - LP_CLEAR_BOTTOM_PX) / vp.height),
    cam(centers[3], _aeLen(_lpLaid([LP_INNER_REACH_AU, 0, 0], lam[3])) * LP_OUT_MARGIN, tilted),
    cam(centers[4], _aeLen(_lpLaid([LP_OUTER_REACH_AU, 0, 0], lam[4])) * LP_OUT_MARGIN, tilted)
  ].map(function (c, i) { c.stop = LP_STOPS[i]; return c; });
}

// Two cameras `e` of the way from a to b: the point linearly, the distance by its log, the turns the short way.
// The point the camera looks at moves by the share of the distance covered (`ft`), not of the ease: what the
// camera looked at stays in view as it pulls back (the Moon, leaving the pair's centre behind).
function _lpBlendCam(a, b, e, ft) {
  return {
    tp: _lpLerp3(a.tp, b.tp, ft === undefined ? e : ft), dist: _aeLogLerp(a.dist, b.dist, e),
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
function _lpLamFor(dist, tp, sc, vp) {
  var th = Math.tan(_aeRad(AE_FOV_DEG) / 2);
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
  var lam = _lpLamFor(dist, tpNominal, sc, vp);
  var lams = LP_NOMINAL_LAM.map(function (n, i) { return i < LP_EARTH ? 0 : lam; });
  var cams = _lpStopCams(sc, vp, lams);
  var span = nominal[seg.i + 1].dist - nominal[seg.i].dist;
  var cam = _lpBlendCam(cams[seg.i], cams[seg.i + 1], seg.e, span > 0 ? Math.max(0, Math.min(1, (dist - nominal[seg.i].dist) / span)) : seg.e);
  cam.dist = dist;
  if (tilt) cam.el = Math.max(-AE_MAX_ELEVATION, Math.min(AE_MAX_ELEVATION, cam.el + tilt));
  return { cam: cam, lam: lam, u: u, grow: _lpExaggeration(u, dist, _lpFocalPx(vp.height, Math.tan(_aeRad(AE_FOV_DEG) / 2))) };
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

// ── Styles, with the module ──
var LP_CSS = [
  // The canvas in the hero: over the picture, under the finger (the disc's own handlers take the touch).
  '.lp-in-hero{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;border-radius:50%;cursor:inherit}',
  '.almanac-view.lp-live .almanac-moon{visibility:hidden}',
  '.almanac-view.lp-nogl .almanac-moon-open{cursor:default}'
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
  queued: false
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
  if (view) view.classList.remove('lp-live');
  if (canvas) {
    canvas.classList.remove('lp-in-hero');
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
  S.renderer.setSize(w, h, false);
  // The view's own numbers, put back as they were: the hero is drawn as the hand-off's first frame.
  var keep = { w: _ae.w, h: _ae.h, hand: _ae.hand, axis: _ae.axis, fade: _aeFadeU.value, scene: _ae.scene };
  try {
    _ae.w = w; _ae.h = h; _ae.axis = null;
    _ae.hand = { dir: 1, frame: { x: 0, y: 0, w: w, h: h }, daz: 0, del: 0, e0: 0, e: 0, xfade: false };
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
