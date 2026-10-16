// The Moon landing's numbers (zimi/static/almanac-landing.js): the axis, the
// camera made for each stop, the layout between true and laid out, the words
// for a distance. Pure functions, run from the shipped files with the same
// ephemeris the views use (almanac-ephem.js), checked against what a stop is
// meant to show and against JPL Horizons for the distances it names.
//
//   1. The axis: segments, soft snapping, the stops' order.
//   2. The first stop is the Earth view's Moon preset, so the hand-off from
//      the hero lands on it.
//   3. Every stop holds what it is named for, with the Sun in the screen's
//      up, at a phone's width and a desktop's.
//   4. True or laid out: from the smallest planet in view against a pixel
//      floor, monotone along the axis, saying so only where it is laid out.
//   5. The solar bodies' places in the scene's frame: the Earth stays at the
//      origin whatever the layout; at layout 0 the Sun is where the Earth
//      view puts it and Mars where Horizons has it.
//   6. A stop's distance, in km and in light, against Horizons.
//
// Run: node tests/test_almanac_landing.cjs   (exit 0 = pass)

process.env.TZ = 'America/Los_Angeles';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const STATIC = path.join(__dirname, '..', 'zimi', 'static');
const read = (f) => fs.readFileSync(path.join(STATIC, f), 'utf8');
const almSrc = read('almanac.js');

let failures = 0;
function check(ok, label) {
  if (!ok) { console.error('FAIL: ' + label); failures++; } else console.log('ok: ' + label);
}
function near(a, b, tol, label) { check(Math.abs(a - b) <= tol, label + ' (' + a + ' vs ' + b + ', tol ' + tol + ')'); }
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function ' + name + ' not found');
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced braces extracting ' + name);
}

const S = { Math, Date, Intl, Object, JSON, console, String, Number, Array, isNaN, window: {}, document: { getElementById: () => null } };
vm.createContext(S);
vm.runInContext(
  'var JD_UNIX_EPOCH = 2440587.5; var JD_J2000 = 2451545.0; var MS_PER_DAY = 86400000;' +
  'var JULIAN_CENTURY = 36525; var DEG_TO_RAD = Math.PI / 180;' +
  'function t(k, v) { return v ? k + JSON.stringify(v) : k; } var _currentLang = "en";', S);
for (const fn of ['_dateToJD', '_jdToJulianCentury', '_solveKepler', '_jdnToGregorian', '_cnDeltaTdays', '_tp']) vm.runInContext(extractFn(almSrc, fn), S);
vm.runInContext('function _tLookup(k, d) { return d; }', S);
vm.runInContext(extractFn(read('app.js'), '_smoothstep'), S);
vm.runInContext(extractFn(read('almanac-sky.js'), '_angleDelta'), S);
vm.runInContext(read('almanac-orrery.js'), S);
vm.runInContext(require('./moon_model.cjs')(), S);
vm.runInContext(read('almanac-ephem.js'), S);
vm.runInContext(read('almanac-earth.js'), S);
vm.runInContext(read('almanac-landing.js'), S);
const E = (expr) => vm.runInContext(expr, S);
const DEG = 180 / Math.PI;
const vlen = (v) => Math.hypot(v[0], v[1], v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const AU_KM = E('AU_KM');
const RE = E('AE_EARTH_RADIUS_KM');

const PHONE = { aspect: 390 / 844, height: 844, moonRoll: 12 };
const DESKTOP = { aspect: 1440 / 900, height: 900, moonRoll: -30 };
const at = (iso) => E('_aeSceneAt(' + Date.parse(iso) + ')');
const DATES = ['2026-10-16T09:00:00Z', '2025-11-21T00:00:00Z', '2026-03-03T12:00:00Z', '2030-07-01T18:00:00Z'];

// ── 1. The axis ──
{
  check(E('LP_STOPS').join() === 'moon,pair,earth,inner,neptune', 'the stops, in order from the Moon out');
  const seg = (u) => E('_lpSegment(' + u + ')');
  check(seg(0).i === 0 && seg(0).e === 0, 'u = 0 is the Moon');
  check(seg(4).i === 3 && seg(4).e === 1, 'u = 4 is Neptune, at the end of the last segment');
  check(seg(-3).i === 0 && seg(9).i === 3, 'the axis is clamped');
  near(seg(1.5).e, 0.5, 1e-12, 'halfway between two stops is halfway eased');
  check(E('_smoothstep(0, 1, 0.1)') < 0.1 && E('_smoothstep(0, 1, 0.9)') > 0.9, 'the ease lingers near the stops, so a release near one settles on it');
  check(E('_lpSnap(2.2)').stop === 2 && E('_lpSnap(2.2)').near, 'a release 0.2 from a stop settles on it');
  check(E('_lpSnap(2.5)').near === false, 'a release between stops stays where it is');
  check(E('_lpSnap(3.9)').stop === 4 && E('_lpSnap(-1)').stop === 0, 'snapping stays on the axis');
}

// ── 2. The first stop is the Earth view's Moon preset ──
for (const iso of DATES) {
  const sc = at(iso);
  const cam = E('_lpStopCams(_aeSceneAt(' + Date.parse(iso) + '), ' + JSON.stringify(PHONE) + ')')[0];
  const azel = E('_aeAzElOf(_aeScale(_aeSceneAt(' + Date.parse(iso) + ').moon, -1))');
  check(vlen(sub(cam.tp, sc.moon)) < 1e-9, iso + ': stop 0 looks at the Moon');
  near(cam.dist, E('_aeFitDist(AE_FIT_MOON, ' + PHONE.aspect + ')'), 1e-9, iso + ': stop 0 stands where the Moon preset stands');
  near(cam.az, azel.az, 1e-12, iso + ': from the Earth\'s side (azimuth)');
  near(cam.el, azel.el, 1e-12, iso + ': from the Earth\'s side (elevation)');
  check(cam.roll === PHONE.moonRoll, iso + ': in the observer\'s sky (the roll is the Moon\'s)');
}

// ── 3. Every stop holds what it is named for, Sun up ──
// The camera's frame from its parts, as the view builds it: where it stands, which way is up.
function frame(cam) {
  const off = E('_aeCameraOffset(' + cam.az + ', ' + cam.el + ', ' + cam.dist + ')');
  const pos = [cam.tp[0] + off[0], cam.tp[1] + off[1], cam.tp[2] + off[2]];
  const fwd = E('_aeNorm(' + JSON.stringify(sub(cam.tp, pos)) + ')');
  const up = E('_aeViewUp(' + JSON.stringify(fwd) + ', ' + cam.roll + ')');
  const right = E('_aeCross(' + JSON.stringify(fwd) + ', ' + JSON.stringify(up) + ')');
  return { pos, fwd, up, right };
}
// Where a point lands on the screen, in half-widths of the view (x right, y up) and its depth.
function project(cam, vp, p) {
  const f = frame(cam), d = sub(p, f.pos), z = dot(d, f.fwd);
  const th = Math.tan((E('AE_FOV_DEG') * Math.PI / 180) / 2);
  const hx = z * th * Math.min(1, vp.aspect), hy = z * th * (vp.aspect >= 1 ? 1 / vp.aspect : 1) * (vp.aspect >= 1 ? vp.aspect : 1);
  const halfH = z * th;                      // the vertical half-height, the fov being vertical
  return { x: dot(d, f.right) / (z * th * vp.aspect), y: dot(d, f.up) / halfH, z };
}
for (const [vpName, vp] of [['phone', PHONE], ['desktop', DESKTOP]]) {
  for (const iso of DATES) {
    const ms = Date.parse(iso), sc = at(iso);
    const cams = E('_lpStopCams(_aeSceneAt(' + ms + '), ' + JSON.stringify(vp) + ')');
    const sunUp = (cam) => {
      // The Earth-to-Sun direction, on the screen: straight up (its screen x is nothing, its y is positive).
      const f = frame(cam), s = E('_aeNorm(_aeSceneAt(' + ms + ').sun)');
      const x = dot(s, f.right), y = dot(s, f.up);
      return { x, y };
    };
    for (let i = 1; i < 5; i++) {
      const s = sunUp(cams[i]);
      check(Math.abs(s.x) < 1e-6 && s.y > 0, vpName + ' ' + iso + ': stop ' + cams[i].stop + ' has the Sun in the screen\'s up (x ' + s.x.toExponential(1) + ', y ' + s.y.toFixed(2) + ')');
    }
    // The pair: the Earth and the Moon both in view.
    const e1 = project(cams[1], vp, [0, 0, 0]), m1 = project(cams[1], vp, sc.moon);
    check(Math.abs(e1.x) <= 1 && Math.abs(e1.y) <= 1 && Math.abs(m1.x) <= 1 && Math.abs(m1.y) <= 1 && e1.z > 0, vpName + ' ' + iso + ': the pair holds the Earth and the Moon');
    // The Earth stop: the Earth and the (laid-out) Sun.
    const sun2 = E('_lpSunScene(_aeSceneAt(' + ms + '), 1)');
    const e2 = project(cams[2], vp, [0, 0, 0]), s2 = project(cams[2], vp, sun2);
    check(Math.abs(e2.x) <= 1 && Math.abs(e2.y) <= 1 && Math.abs(s2.x) <= 1 && Math.abs(s2.y) <= 1, vpName + ' ' + iso + ': the Earth stop holds the Earth and the Sun');
    // The inner planets: Mars, anywhere on its orbit, in view; Neptune's orbit in the last.
    for (let k = 0; k < 24; k++) {
      const a = 2 * Math.PI * k / 24;
      const marsOrbit = E('_lpToScene(_lpLaid([' + 1.67 * Math.cos(a) + ',' + 1.67 * Math.sin(a) + ', 0], 1), _aeSceneAt(' + ms + '))');
      const sun3 = E('_lpSunScene(_aeSceneAt(' + ms + '), 1)');
      const p3 = project(cams[3], vp, [sun3[0] + marsOrbit[0], sun3[1] + marsOrbit[1], sun3[2] + marsOrbit[2]]);
      const neptune = E('_lpToScene(_lpLaid([' + 30.3 * Math.cos(a) + ',' + 30.3 * Math.sin(a) + ', 0], 1), _aeSceneAt(' + ms + '))');
      const p4 = project(cams[4], vp, [sun3[0] + neptune[0], sun3[1] + neptune[1], sun3[2] + neptune[2]]);
      if (!(Math.abs(p3.x) <= 1 && Math.abs(p3.y) <= 1 && Math.abs(p4.x) <= 1 && Math.abs(p4.y) <= 1)) {
        check(false, vpName + ' ' + iso + ': the planets\' orbits fit their stops (angle ' + k + ')');
        break;
      }
      if (k === 23) check(true, vpName + ' ' + iso + ': Mars\'s orbit fits the inner planets\' stop and Neptune\'s the last');
    }
  }
}

// ── 4. True or laid out ──
{
  for (const iso of DATES) {
    const ms = Date.parse(iso);
    const lam = (u, vp) => E('_lpAxisCam(' + u + ', _aeSceneAt(' + ms + '), ' + JSON.stringify(vp) + ', 0).lam');
    for (const [vpName, vp] of [['phone', PHONE], ['desktop', DESKTOP]]) {
      check(lam(0, vp) === 0, vpName + ' ' + iso + ': true at the Moon');
      near(lam(1, vp), 0, 1e-9, vpName + ' ' + iso + ': true at the Earth and Moon (nothing in view has lost its size)');
      near(lam(2, vp), 1, 1e-9, vpName + ' ' + iso + ': laid out at the Earth stop');
      near(lam(3, vp), 1, 1e-9, vpName + ' ' + iso + ': laid out at the inner planets');
      near(lam(4, vp), 1, 1e-9, vpName + ' ' + iso + ': laid out at Neptune');
      let prev = -1, mono = true;
      for (let k = 0; k <= 80; k++) { const l = lam(k / 20, vp); if (l < prev - 1e-9) mono = false; prev = l; }
      check(mono, vpName + ' ' + iso + ': the layout only grows going out along the axis');
      let step = 0;
      for (let k = 1; k <= 400; k++) step = Math.max(step, Math.abs(lam(k / 100, vp) - lam((k - 1) / 100, vp)));
      check(step < 0.2, vpName + ' ' + iso + ': and never jumps (largest step in a hundredth of the axis ' + step.toFixed(3) + ')');
      check(E('_lpSaysNotToScale(' + lam(1, vp) + ')') === false && E('_lpSaysNotToScale(' + lam(2, vp) + ')') === true, vpName + ' ' + iso + ': the words "Not to scale" are for the laid-out stops only');
    }
  }
}

// The Earth and the Moon, drawn larger where they are too small to read: one factor, none at the Moon, most at the
// pair, none again where the dots take over, and the words say so.
for (const iso of DATES) {
  const ms = Date.parse(iso);
  for (const [vpName, vp] of [['phone', PHONE], ['desktop', DESKTOP]]) {
    const g = (u) => E('_lpAxisCam(' + u + ', _aeSceneAt(' + ms + '), ' + JSON.stringify(vp) + ', 0).grow');
    check(g(0) === 1, vpName + ' ' + iso + ': nothing is enlarged at the Moon (the hero is the picture)');
    check(g(1) > 3 && g(1) <= E('LP_EXAGGERATE_MAX'), vpName + ' ' + iso + ': the pair is drawn ' + g(1).toFixed(1) + ' times larger');
    check(g(1.5) === 1 && g(3) === 1, vpName + ' ' + iso + ': and true again from the Earth stop out');
    let prev = 0, up = true;
    for (let k = 0; k <= 10; k++) { const v = g(k / 10); if (v < prev - 1e-9) up = false; prev = v; }
    check(up, vpName + ' ' + iso + ': it comes in as the camera leaves the Moon');
    // The Moon, enlarged, is at least the floor's pixels across at the pair.
    const th = Math.tan(E('AE_FOV_DEG') * Math.PI / 360), focal = (vp.height / 2) / th;
    const dist = E('_lpAxisCam(1, _aeSceneAt(' + ms + '), ' + JSON.stringify(vp) + ', 0).cam.dist');
    check(g(1) * E('AE_MOON_RADIUS_RE') / dist * focal >= E('LP_MOON_FLOOR_PX') - 1e-6 || g(1) === E('LP_EXAGGERATE_MAX'), vpName + ' ' + iso + ': the Moon is at least ' + E('LP_MOON_FLOOR_PX') + ' px (radius) at the pair');
    check(E('_lpSaysNotToScale(0, ' + g(1) + ')') === true && E('_lpSaysNotToScale(0, 1)') === false, vpName + ' ' + iso + ': enlarged, the view says "Not to scale"');
  }
}

// ── 5. The solar bodies in the scene's frame ──
for (const iso of DATES) {
  const ms = Date.parse(iso), sc = at(iso);
  for (const lam of [0, 0.4, 1]) {
    const earth = E('_lpBodyScene("Earth", _aeSceneAt(' + ms + '), ' + lam + ')');
    check(vlen(earth) < 1e-6, iso + ': the Earth stays at the origin when the layout is ' + lam + ' (' + vlen(earth).toExponential(1) + ' Re)');
  }
  const sun = E('_lpSunScene(_aeSceneAt(' + ms + '), 0)');
  const cosA = dot(sun, sc.sun) / (vlen(sun) * vlen(sc.sun));
  check(Math.acos(Math.min(1, cosA)) * DEG < 0.01, iso + ': at layout 0 the Sun is in the direction the Earth view draws it (' + (Math.acos(Math.min(1, cosA)) * DEG).toExponential(1) + ' deg)');
  near(vlen(sun) / vlen(sc.sun), 1, 1e-4, iso + ': and at its distance');
  const laid = E('_lpSunScene(_aeSceneAt(' + ms + '), 1)');
  check(dot(laid, sun) / (vlen(laid) * vlen(sun)) > 1 - 1e-12, iso + ': laid out, the Sun stays on the same line from the Earth');
  check(vlen(laid) > vlen(sun), iso + ': and farther off (the layout spreads the inner system)');
}
{
  // Mars at 2025-11-21 00:00 TT, JPL Horizons (km, heliocentric ecliptic J2000), with the Earth's.
  const marsH = [-3.747736868505748E+07, -2.176726841409163E+08, -3.642484547867596E+06];
  const earthH = [7.708376728830616E+07, 1.261109714907015E+08, -7.507945428729057E+03];
  const sc = E('_aeSceneAt(' + (Date.UTC(2025, 10, 21) + 69184) + ')');   // 00:00 TT is 69 s before 00:00 UT... the TT-UT of the day
  const mars = E('_lpBodyScene("Mars", _aeSceneAt(' + (Date.UTC(2025, 10, 21) - 69184) + '), 0)');
  const trueRe = vlen(sub(marsH, earthH)) / RE;
  near(vlen(mars) / trueRe, 1, 0.003, 'Mars from the Earth at layout 0, in Earth radii, against Horizons');
}

// ── 6. Distances, in km and in light ──
{
  const sc = E('_aeSceneAt(' + Date.UTC(2025, 10, 21) + ')');
  // Horizons, 2025-11-21 00:00 TT: Neptune and the Earth (km, heliocentric, J2000 ecliptic).
  const nep = [4.469266233825270E+09, 5.826605184834480E+07, -1.041906261802228E+08];
  const earth = [7.708376728830616E+07, 1.261109714907015E+08, -7.507945428729057E+03];
  near(E('_lpStopKm("neptune", _aeSceneAt(' + Date.UTC(2025, 10, 21) + '))') / vlen(sub(nep, earth)), 1, 0.005, 'the last stop is Neptune\'s distance from the Earth, against Horizons');
  near(E('_lpStopKm("earth", _aeSceneAt(' + Date.UTC(2025, 10, 21) + '))') / vlen(earth), 1, 2e-4, 'the Earth stop is the Earth\'s distance from the Sun, against Horizons');
  near(E('_lpStopKm("moon", _aeSceneAt(' + Date.UTC(2025, 10, 21) + '))'), 406444.5, 40, 'the Moon stop is the Moon\'s distance (Horizons 406,444 km)');
  near(E('_lpLightSeconds(384400)'), 1.2823, 1e-3, 'light takes 1.28 s to the Moon at its mean distance');
  near(E('_lpLightSeconds(149597870.7)'), 499.005, 1e-3, 'and 499 s to the Sun at 1 AU');
  check(/384,400/.test(E('_lpFmtKm(384400)')), 'the Moon\'s distance is written whole, in km: ' + E('_lpFmtKm(384400)'));
  check(/149\.6M/.test(E('_lpFmtKm(149597870.7)')), 'the Sun\'s is compact: ' + E('_lpFmtKm(149597870.7)'));
  check(/4\.\d.*B|4,\d+M/.test(E('_lpFmtKm(4.4e9)')), 'and Neptune\'s: ' + E('_lpFmtKm(4.4e9)'));
  check(E('_lpFmtReach(384400)').indexOf('lp_by_light') > 0 && E('_lpFmtReach(384400)').indexOf('1.3 sec') > 0, 'with the light\'s time beside it: ' + E('_lpFmtReach(384400)'));
}

// ── 7. The roll that stands a direction up ──
{
  for (const f of [[0.3, 0.5, -0.8], [0, 0, -1], [0.9, -0.1, 0.2], [-0.4, -0.4, 0.3]]) {
    const want = [0.2, 0.7, 0.4];
    const roll = E('_lpRollForUp(' + JSON.stringify(f) + ', ' + JSON.stringify(want) + ')');
    const up = E('_aeViewUp(' + JSON.stringify(f) + ', ' + roll + ')');
    const fn = E('_aeNorm(' + JSON.stringify(f) + ')');
    const perp = E('_aeNorm(_aeSub(' + JSON.stringify(want) + ', _aeScale(' + JSON.stringify(fn) + ', _aeDot(' + JSON.stringify(want) + ', ' + JSON.stringify(fn) + '))))');
    check(Math.abs(dot(up, perp) - 1) < 1e-9 || Math.abs(f[0]) + Math.abs(f[1]) < 1e-9, 'a roll of ' + roll.toFixed(1) + ' stands the wanted direction up for a camera looking along ' + JSON.stringify(f));
  }
}

// ── 8. The sky stays in view ──
{
  check(E('_lpStarScale(0.001, 6000)') === 1, 'the stars stand where they always did while the near plane is near');
  const k = E('_lpStarScale(20000, 600000)');
  check(k * 5000 > 20000 && k * 5000 < 600000, 'and are carried out past a far near plane, inside the far one (radius ' + k * 5000 + ')');
}

// ── 9. One global scope: nothing here is named as something another script defines ──
// (The state object was once `_lp`, which almanac.js already is: a function the sheets call. The unit tests above load
// only some of the files, so only a whole-page check can catch that: this reads every static script.)
{
  const top = (src) => [...src.matchAll(/^(?:function|var|let|const)\s+(\w+)/gm)].map((m) => m[1]);
  const mine = new Map();
  for (const f of ['almanac-landing.js', 'almanac-ephem.js']) for (const n of top(read(f))) mine.set(n, f);
  const clashes = [];
  for (const f of fs.readdirSync(STATIC).filter((x) => x.endsWith('.js') && x !== 'almanac-landing.js' && x !== 'almanac-ephem.js')) {
    for (const n of top(read(f))) if (mine.has(n)) clashes.push(n + ' (' + mine.get(n) + ' and ' + f + ')');
  }
  check(clashes.length === 0, 'no global of the landing or the ephemeris is also defined by another script' + (clashes.length ? ': ' + clashes.join(', ') : ''));
  for (const f of ['almanac-landing.js', 'almanac-ephem.js']) {
    const names = top(read(f));
    check(new Set(names).size === names.length, f + ' defines nothing twice');
  }
}

if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
console.log('all passed');
