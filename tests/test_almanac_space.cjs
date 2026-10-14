// The flown solar system (zimi/static/almanac-space.js): the numbers behind
// every body, probe and effect, checked against JPL Horizons and against the
// physics, offline.
//
//   1. Light from a moving ship: aberration, Doppler factor, the searchlight
//      gain, star temperatures and colours.
//   2. The trip: the two clocks, the ship that meets a moving planet, the
//      planet as the light shows it.
//   3. Where things are: planets and Pluto, the moons, the probes and Ceres
//      against Horizons vectors stored in tests/fixtures
//      (scripts/build_space_tracks.py writes them; no network here).
//   4. Frames and scale: poles, the star sphere's ecliptic frame, the two
//      scales.
//   5. The shipped data: sizes, spans, events.
//
// Run: node tests/test_almanac_space.cjs   (exit 0 = pass)

process.env.TZ = 'America/Los_Angeles';   // the page shows UTC whatever the zone: so test in one that is not
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const STATIC = path.join(ROOT, 'zimi', 'static');
const almSrc = fs.readFileSync(path.join(STATIC, 'almanac.js'), 'utf8');

let failures = 0;
function check(ok, label) {
  if (!ok) { console.error('FAIL: ' + label); failures++; }
  else console.log('ok: ' + label);
}
function near(a, b, tol, label) {
  check(Math.abs(a - b) <= tol, label + ' (' + a + ' vs ' + b + ', tol ' + tol + ')');
}
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
  'function t(k) { return k; }', S);
for (const fn of ['_dateToJD', '_jdToJulianCentury', '_solveKepler', '_jdnToGregorian', '_cnDeltaTdays']) vm.runInContext(extractFn(almSrc, fn), S);
vm.runInContext(fs.readFileSync(path.join(STATIC, 'almanac-orrery.js'), 'utf8'), S);
vm.runInContext(require('./moon_model.cjs')(), S);
vm.runInContext(fs.readFileSync(path.join(STATIC, 'almanac-earth.js'), 'utf8'), S);
const spFile = path.join(STATIC, 'almanac-space.js');
if (!fs.existsSync(spFile)) { console.error('FAIL: almanac-space.js does not exist'); process.exit(1); }
vm.runInContext(fs.readFileSync(spFile, 'utf8'), S);

const tracksJson = JSON.parse(fs.readFileSync(path.join(STATIC, 'earth', 'space-tracks-v1.json'), 'utf8'));
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'horizons-space-reference.json'), 'utf8'));
S._spSetTracks(tracksJson);

const DEG = 180 / Math.PI;
const jdOf = (iso) => S._dateToJD(Date.parse(iso + 'T00:00:00Z'));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dotp = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const C_AU_DAY = 299792.458 * 86400 / 149597870.7;

// ── 1. Light from a moving ship ────────────────────────────────────────────
{
  const b = 0.5;
  near(S._spAberrateCos(0, b), 0.5, 1e-12, 'a star abeam at 0.5c moves to 60 deg from dead ahead');
  near(S._spAberrateCos(1, b), 1, 1e-12, 'a star dead ahead stays dead ahead');
  near(S._spAberrateCos(-1, b), -1, 1e-12, 'a star dead behind stays dead behind');
  near(Math.acos(S._spAberrateCos(0, 0.99)) * DEG, 8.1096, 1e-3, 'at 0.99c a star abeam is only 8.1 deg off the heading');
  // The inverse boost returns the original direction.
  for (const th of [0.3, 1.1, 2.0, 2.9]) {
    const c1 = S._spAberrateCos(Math.cos(th), 0.8);
    near(S._spAberrateCos(c1, -0.8), Math.cos(th), 1e-12, 'boosting and un-boosting returns the angle (' + th + ')');
  }
  // Vector form: unit length, same plane, scalar agreement.
  const v = [0, 0, 1], n = [Math.sin(1.2), 0, Math.cos(1.2)];
  const n2 = S._spAberrateDir(n, v, 0.7);
  near(len(n2), 1, 1e-12, 'the aberrated direction stays a unit vector');
  near(n2[2], S._spAberrateCos(Math.cos(1.2), 0.7), 1e-12, 'vector and scalar aberration agree');
  near(n2[1], 0, 1e-12, 'a star in the plane of the heading stays in it');
  // Along the axis nothing changes, and a zero speed changes nothing.
  const same = S._spAberrateDir(n, v, 0);
  near(dist(same, n), 0, 1e-12, 'at rest the sky is as it is');
  // Direction toward the star lies beside the heading, the heading may be any unit vector.
  const w = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  const nn = [1, 0, 0];
  const out = S._spAberrateDir(nn, w, 0.6);
  near(dotp(out, w), S._spAberrateCos(dotp(nn, w), 0.6), 1e-12, 'any heading: the angle to it follows the formula');

  near(S._spDoppler(0.6, 1), 2, 1e-12, 'Doppler factor dead ahead at 0.6c is 2');
  near(S._spDoppler(0.6, -1), 0.5, 1e-12, 'Doppler factor dead behind at 0.6c is 0.5');
  near(S._spDoppler(0.6, 0), 1.25, 1e-12, 'Doppler factor abeam (rest-frame angle) is gamma');
  // The same factor from the angle the ship sees: 1 / (gamma (1 - beta cos')).
  for (const c of [-0.9, -0.2, 0.4, 0.95]) {
    const cp = S._spAberrateCos(c, 0.8), g = 1 / Math.sqrt(1 - 0.64);
    near(S._spDoppler(0.8, c), 1 / (g * (1 - 0.8 * cp)), 1e-10, 'Doppler factor agrees with the ship-frame form (cos ' + c + ')');
  }
  near(S._spDoppler(0.99, 1), Math.sqrt(1.99 / 0.01), 1e-9, 'dead ahead at 0.99c the colours shift by 14.1');

  // Colour and temperature.
  const sunT = S._spStarTemp(0.65);
  check(sunT > 5500 && sunT < 5900, 'B-V 0.65 is a Sun-like star (' + sunT.toFixed(0) + ' K)');
  check(S._spStarTemp(-0.3) > 15000, 'B-V -0.3 is a hot blue star');
  check(S._spStarTemp(1.5) < 4200 && S._spStarTemp(1.5) > 3300, 'B-V 1.5 is a cool orange star');
  const white = S._spBlackbodyRGB(6500), red = S._spBlackbodyRGB(3000), blue = S._spBlackbodyRGB(20000);
  check(white[0] > 0.93 && white[1] > 0.93 && white[2] > 0.93, '6500 K is white');
  check(red[0] === 1 && red[2] < 0.5, '3000 K is orange-red');
  check(blue[2] === 1 && blue[0] < 0.8, '20000 K is blue');
  // Visible-band share of a blackbody: independent Planck sum 380-750 nm.
  function planckFrac(T) {
    const h = 6.62607015e-34, c = 299792458, k = 1.380649e-23;
    let vis = 0; const n = 400;
    for (let i = 0; i < n; i++) {
      const lam = (380 + (750 - 380) * (i + 0.5) / n) * 1e-9;
      vis += 2 * h * c * c / Math.pow(lam, 5) / (Math.exp(h * c / (lam * k * T)) - 1) * (750 - 380) * 1e-9 / n;
    }
    return vis / (5.670374419e-8 * Math.pow(T, 4) / Math.PI);
  }
  for (const T of [3000, 5800, 10000, 30000]) near(S._spVisFraction(T) / planckFrac(T), 1, 0.06, 'visible share of a ' + T + ' K blackbody');
  near(S._spBeamGain(1, 5800), 1, 1e-9, 'no Doppler shift, no change in brightness');
  const D = 2, g = S._spBeamGain(D, 5800);
  near(g / (D * D * planckFrac(11600) / planckFrac(5800)), 1, 0.06, 'searchlight gain is D squared times the visible share it gains or loses');
  check(S._spBeamGain(0.5, 5800) < 0.25, 'behind, a red-shifted star fades by more than the plain 1/4');
}

// ── 1b. The star sky from the ship, the way the page shades it ────────────
{
  const n = 8000, dirs = new Float32Array(n * 3), temp = new Float32Array(n), mag = new Float32Array(n);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let i = 0; i < n; i++) {
    const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z);
    dirs.set([r * Math.cos(a), r * Math.sin(a), z], i * 3);
    temp[i] = 5800; mag[i] = 3;
  }
  const attrs = {};
  for (const [k, w] of [['position', 3], ['aColor', 3], ['aAlpha', 1], ['aSize', 1], ['aKind', 1]]) attrs[k] = { array: new Float32Array(n * w), needsUpdate: false };
  const fake = () => ({ starData: { n, dirs, temp, mag }, stars: { geometry: { attributes: attrs, setDrawRange() {} } }, starsKey: null });
  const unit = (i) => { const x = attrs.position.array[i * 3], y = attrs.position.array[i * 3 + 1], z = attrs.position.array[i * 3 + 2], l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
  const band = (lo, hi) => { const out = []; for (let i = 0; i < n; i++) { const c = unit(i)[2]; if (c >= lo && c <= hi) out.push(i); } return out; };
  S._spShadeStars(fake(), 0, [0, 0, 1]);
  const restAhead = band(0.9, 1).length;
  check(Math.abs(restAhead / n - 0.05) < 0.01, 'at rest 5% of the sky is within 26 deg of any direction (' + (restAhead / n).toFixed(3) + ')');
  const restAlpha = attrs.aAlpha.array[0];
  S._spShadeStars(fake(), 0.9, [0, 0, 1]);
  const ahead = band(0.9, 1);
  check(Math.abs(ahead.length / n - 0.5) < 0.03, 'at 0.9c half of the stars crowd into the 26 deg round the heading (' + (ahead.length / n).toFixed(3) + ')');
  const mean = (idx, f) => idx.reduce((a, i) => a + f(i), 0) / Math.max(1, idx.length);
  const bMinusR = (i) => attrs.aColor.array[i * 3 + 2] - attrs.aColor.array[i * 3];
  const behind = band(-1, -0.9);
  check(mean(ahead, bMinusR) > 0.05, 'stars ahead are bluer than white (' + mean(ahead, bMinusR).toFixed(2) + ')');
  check(mean(behind, bMinusR) < -0.3 || behind.length === 0, 'stars behind are red');
  check(mean(ahead, (i) => attrs.aAlpha.array[i]) >= restAlpha, 'stars ahead are at least as bright');
  check(mean(behind, (i) => attrs.aAlpha.array[i]) < 0.2 * restAlpha, 'stars behind have faded');
  // The same stars, ship turned around: the crowd turns with it.
  S._spShadeStars(fake(), 0.9, [0, 0, -1]);
  check(Math.abs(band(-1, -0.9).length / n - 0.5) < 0.03, 'heading the other way the crowd is on the other side');
  // The tint a sunlit planet gets: blue ahead, red behind, nothing at rest.
  const ahead2 = S._spTintFor([0, 0, 1], 0.6, [0, 0, 1]), behind2 = S._spTintFor([0, 0, -1], 0.6, [0, 0, 1]), none = S._spTintFor([0, 0, 1], 0, [0, 0, 1]);
  check(none[0] === 1 && none[1] === 1 && none[2] === 1, 'no tint at rest');
  check(ahead2[2] / ahead2[0] > 1.3, 'a planet dead ahead at 0.6c is bluer');
  check(behind2[0] / behind2[2] > 1.5 || behind2[2] < behind2[0], 'a planet dead behind at 0.6c is redder');
}

// ── 2. The trip ────────────────────────────────────────────────────────────
{
  const R = S.SP_RAMP_FRACTION;
  const au = 4.2, beta = 0.5;
  const trip = S._spTrip(au, beta);
  const cruiseLight = au * 499.00478384 / beta;
  near(trip.earthSec / (cruiseLight * (1 + 2 * R)), 1, 1e-9, 'trip time is the distance over speed with the two ramps counted');
  // Independent numeric integral of the ship's clock over the speed profile.
  let ship = 0, earth = 0; const N = 400000;
  for (let i = 0; i < N; i++) {
    const s = (i + 0.5) / N;
    const bs = beta * Math.sqrt(Math.min(1, s / R, (1 - s) / R));
    const dt = au * 499.00478384 / (bs * N);
    earth += dt; ship += dt * Math.sqrt(1 - bs * bs);
  }
  near(trip.earthSec / earth, 1, 2e-3, 'trip time matches a numeric integral of the ramps');
  near(trip.shipSec / ship, 1, 2e-3, 'the ship clock matches a numeric integral of dt / gamma');
  check(trip.shipSec < trip.earthSec, 'the ship clock reads less than the Earth clock');
  const slow = S._spTrip(1, 1e-4);
  near((slow.earthSec - slow.shipSec) / slow.earthSec / 1e-8, (0.5 - R / 3) / (1 + 2 * R), 1e-3, 'at 30 km/s the clocks differ by about 0.44 beta^2 of the trip (kept, not lost to rounding)');
  const fast = S._spTrip(10, 0.99);
  check(fast.earthSec / fast.shipSec > 3.5, 'at 0.99c the clocks differ almost 4 to 1 (' + (fast.earthSec / fast.shipSec).toFixed(2) + ', the ramps count)');
  near(S._spTrip(1, 0.9999999).earthSec / (499.00478384 * (1 + 2 * R) / 0.9999999), 1, 1e-9, 'nothing arrives faster than light');

  // With no ramps the clocks are the orrery's own (_tripSecondsAtBeta, _properTime): one set of physics.
  {
    const saved = S.SP_RAMP_FRACTION;
    S.SP_RAMP_FRACTION = 1e-12;
    for (const [d, b] of [[4.2, 0.5], [30, 0.9], [170, 0.99], [1, 1e-4]]) {
      const t = S._spTrip(d, b), earth = S._tripSecondsAtBeta(d, b), ship = S._properTime(earth, b);
      check(Math.abs(t.earthSec / earth - 1) < 1e-9 && Math.abs(t.shipSec / ship - 1) < 1e-9, 'with no ramps the trip clocks are the orrery\'s (' + d + ' AU at ' + b + 'c)');
    }
    S.SP_RAMP_FRACTION = saved;
  }

  // Meeting a moving planet: the ship flies to where Jupiter will be.
  const t0 = jdOf('2026-10-13');
  const earthAt = (jd) => S._spPlanetPos('Earth', jd);
  const jupAt = (jd) => S._spPlanetPos('Jupiter', jd);
  const hit = S._spIntercept(jupAt, earthAt(t0), 0.1, t0);
  const flown = S._spTrip(dist(hit.pos, earthAt(t0)), 0.1).earthSec / 86400;
  near(hit.arriveJd - t0, flown, 1e-6, 'the intercept arrives when the trip to that place has taken that long');
  near(dist(jupAt(hit.arriveJd), hit.pos), 0, 1e-9, 'and Jupiter is there then');
  const now = dist(jupAt(t0), earthAt(t0));
  check(Math.abs(hit.distAU - now) > 1e-4, 'it is not the place Jupiter was at launch');

  // What the light shows.
  const seen = S._spRetarded(jupAt, earthAt(t0), t0);
  const dseen = dist(seen.pos, earthAt(t0));
  near(seen.lagSec, dseen * 499.00478384, 0.5, 'a retarded body is as far in light-seconds as the light was in flight');
  check(seen.lagSec > 33 * 60 && seen.lagSec < 54 * 60, 'Jupiter is 33-54 light-minutes away (' + (seen.lagSec / 60).toFixed(1) + ' min)');
  check(dist(seen.pos, jupAt(t0)) > 1e-4, 'and what you see is not where it is now');
  near(S._spRetarded(() => [0, 0, 0], [1, 0, 0], t0).lagSec, 499.00478384, 1e-6, 'the Sun is 8 min 19 s old');
}

// ── 3. Where things are, against Horizons ──────────────────────────────────
{
  // Positions of the planets: the Keplerian elements are JPL's approximate
  // set; the sizes of the misses are the model's, stated here. Pluto's are
  // larger because the fit is the loosest for it.
  const TOL = { Mercury: 0.004, Venus: 0.003, Earth: 0.001, Mars: 0.01, Jupiter: 5e-5, Saturn: 5e-5, Uranus: 5e-5, Neptune: 5e-5, Pluto: 5e-5 };   // Jupiter to Pluto: the shipped Horizons table (7,500 km)
  for (const [name, rows] of Object.entries(ref.bodies)) {
    for (const r of rows) {
      const p = S._spPlanetPos(name, jdOf(r.date));
      const miss = dist(p, r.xyz);
      check(miss < TOL[name], name + ' ' + r.date + ' is ' + miss.toFixed(4) + ' AU from Horizons (limit ' + TOL[name] + ')');
    }
  }
  // Angle seen from the Sun, the thing a picture shows.
  for (const name of ['Mars', 'Jupiter', 'Saturn']) {
    for (const r of ref.bodies[name]) {
      const p = S._spPlanetPos(name, jdOf(r.date));
      const ang = Math.acos(Math.min(1, dotp(p, r.xyz) / (len(p) * len(r.xyz)))) * DEG;
      check(ang < 0.5, name + ' ' + r.date + ' is ' + ang.toFixed(3) + ' deg from Horizons as the Sun sees it');
    }
  }
  // Moons: the angle round the planet (mean circular orbit), in the planet's plane.
  const MOON_TOL_DEG = { Io: 2, Europa: 3, Ganymede: 2, Callisto: 2.5, Titan: 5 };
  for (const [name, rows] of Object.entries(ref.moons)) {
    if (name === 'Moon') continue;
    for (const r of rows) {
      const off = S._spMoonOffset(name, jdOf(r.date));
      const mDist = len(off), hDist = len(r.xyz);
      check(Math.abs(mDist / hDist - 1) < 0.1, name + ' ' + r.date + ' orbit radius within 10% (' + (mDist / hDist).toFixed(3) + ')');
      const pole = S._spPoleEcl(S._spMoonPlanet(name));
      const proj = (v) => { const k = dotp(v, pole); return [v[0] - k * pole[0], v[1] - k * pole[1], v[2] - k * pole[2]]; };
      const a = proj(off), b = proj(r.xyz);
      const ang = Math.acos(Math.min(1, dotp(a, b) / (len(a) * len(b)))) * DEG;
      check(ang < MOON_TOL_DEG[name], name + ' ' + r.date + ' is ' + ang.toFixed(2) + ' deg round its planet from Horizons');
    }
  }
  for (const r of ref.moons.Moon) {
    const off = S._spMoonOffset('Moon', jdOf(r.date));
    const ang = Math.acos(Math.min(1, dotp(off, r.xyz) / (len(off) * len(r.xyz)))) * DEG;
    check(ang < 0.25, 'the Moon ' + r.date + ' is ' + ang.toFixed(3) + ' deg from Horizons (the ecliptic of date vs J2000 is 0.36)');
    near(len(off) / len(r.xyz), 1, 0.02, 'the Moon ' + r.date + ' distance');
  }
  // Probes: the shipped table, interpolated, against Horizons' own vectors.
  for (const [key, rows] of Object.entries(ref.probes)) {
    for (const r of rows) {
      const p = S._spTrackAt(S._spTrack(key), jdOf(r.date));
      const lim = 2 * (4e-4 + 3e-4 * len(r.xyz)) + 1e-4;
      check(p && dist(p, r.xyz) < lim, key + ' ' + r.date + ' is ' + (p ? dist(p, r.xyz).toExponential(2) : 'missing') + ' AU from Horizons (limit ' + lim.toExponential(2) + ')');
    }
  }
  // Voyager 1 today, in the words a person would use.
  const v1 = S._spTrackAt(S._spTrack('voyager1'), jdOf('2026-10-13'));
  const hv1 = ref.probes.voyager1[2].xyz;
  near(len(v1), len(hv1), 0.05, 'Voyager 1 is ' + len(v1).toFixed(2) + ' AU from the Sun');
  // Outside a probe's life there is nothing to draw.
  check(S._spTrackAt(S._spTrack('voyager1'), jdOf('1970-01-01')) === null, 'Voyager 1 is not anywhere before it launched');
  check(S._spTrackAt(S._spTrack('cassini'), jdOf('2026-10-13')) === null, 'Cassini is not anywhere after it ended');
  check(S._spTrackState(S._spTrack('cassini'), jdOf('2026-10-13')) === 'after', 'and the chip knows it is after');
  check(S._spTrackState(S._spTrack('juno'), jdOf('1999-01-01')) === 'before', 'Juno before launch is before');
  check(S._spTrackState(S._spTrack('juno'), jdOf('2020-01-01')) === 'flying', 'Juno in 2020 is flying');
  // Ceres from the same table, against Horizons-derived periodicity (4.6 yr).
  const c1 = S._spTrackAt(S._spTrack('ceres'), jdOf('2026-10-13'));
  check(len(c1) > 2.5 && len(c1) < 3.0, 'Ceres is in the belt (' + len(c1).toFixed(2) + ' AU)');
  // JWST is at L2: 1.01 AU from the Sun, about 0.01 AU beyond the Earth.
  const w = S._spTrackAt(S._spTrack('jwst'), jdOf('2026-10-13'));
  const earthNow = S._spPlanetPos('Earth', jdOf('2026-10-13'));
  const away = dist(w, earthNow);
  check(away > 0.007 && away < 0.02 && len(w) > len(earthNow), 'JWST is about 1.5 million km beyond the Earth (' + (away * 149597870.7 / 1e6).toFixed(2) + ' million km)');
}

// ── 4. Frames and scale ────────────────────────────────────────────────────
{
  const ecl = S._spEqToEcl([0, -Math.sin(23.4392911 / DEG), Math.cos(23.4392911 / DEG)]);
  near(ecl[0], 0, 1e-12, 'the ecliptic pole in the equatorial frame is the ecliptic z (x)');
  near(ecl[1], 0, 1e-8, '... (y)');
  near(ecl[2], 1, 1e-12, '... (z)');
  const pole = S._spPoleEcl('Saturn');
  near(len(pole), 1, 1e-12, 'a pole is a unit vector');
  // Saturn's axis is tilted 26.7 deg from its orbit's normal.
  const o = S._PLANETS.Saturn, I = o.I / DEG, N = o.N / DEG;
  const normal = [Math.sin(I) * Math.sin(N), -Math.sin(I) * Math.cos(N), Math.cos(I)];
  near(Math.acos(dotp(pole, normal)) * DEG, 26.73, 0.3, 'Saturn leans 26.7 deg from its orbit');
  const jp = S._spPoleEcl('Jupiter');
  near(Math.acos(dotp(jp, [0, 0, 1])) * DEG, 2.2, 0.8, 'Jupiter stands almost upright to the ecliptic');
  const um = S._spPoleEcl('Uranus');
  near(Math.acos(Math.abs(um[2])) * DEG, 82.2, 1, 'Uranus lies on its side');
  // The body frame: x lon 0, z pole, right handed.
  const f = S._spBodyFrame('Mars', jdOf('2026-10-13'));
  near(len(f.x), 1, 1e-9, 'frame x unit'); near(len(f.z), 1, 1e-9, 'frame z unit');
  near(dotp(f.x, f.z), 0, 1e-9, 'frame x is perpendicular to the pole');
  const y = [f.z[1] * f.x[2] - f.z[2] * f.x[1], f.z[2] * f.x[0] - f.z[0] * f.x[2], f.z[0] * f.x[1] - f.z[1] * f.x[0]];
  near(dist(y, f.y), 0, 1e-9, 'frame y is z cross x');
  // A day later Mars has turned 350.9 deg: the prime meridian is back near where it was, 9.1 deg behind.
  const f2 = S._spBodyFrame('Mars', jdOf('2026-10-14'));
  const turned = Math.atan2(dotp(f2.x, f.y), dotp(f2.x, f.x)) * DEG;
  near(((turned + 360) % 360), 350.892, 0.01, 'Mars turns 350.89 deg a day');
  // Stars: right ascension 18 h, declination 66.56 is the ecliptic pole.
  const sp = S._spStarDir(18 * 15 / DEG, 66.5607 / DEG);
  near(sp[2], 1, 1e-4, 'the star sphere is in the ecliptic frame: RA 18h Dec +66.56 is straight up');
  // Scale: readable draws a planet and its moons' orbits alike, so Io stays outside Jupiter.
  const r = S._spScale('readable'), tr = S._spScale('true');
  check(tr.body('Jupiter') === 1 && tr.moon('Jupiter') === 1 && tr.body('Io') === 1, 'true scale draws true sizes and puts moons where they are');
  check(r.body('Io') === r.moon('Jupiter') && r.body('Jupiter') === S.SP_READABLE_BOOST, 'readable scale enlarges a planet and its moons\' orbits alike when no spacecraft is near');
  check(r.moon('Jupiter') * 1.9e6 / 149597870.7 <= 0.5, 'a readable Callisto orbit is under half an AU');
  check(r.body('Sun') * 695700 / 149597870.7 < 0.387 * 0.6, 'a readable Sun does not reach Mercury');
  // No probe is drawn inside a body: the body is drawn only as big as keeps every spacecraft outside it,
  // sampled monthly over the years any of them flew.
  let worst = 1e9, samples = 0, worstWhat = '';
  const AU = 149597870.7;
  for (let jd = jdOf('2012-01-01'); jd < jdOf('2030-01-01'); jd += 31) {
    const sc = S._spScale('readable', jd);
    for (const pk of Object.keys(tracksJson.tracks)) {
      if (pk === 'ceres') continue;
      const pp = S._spTrackAt(S._spTrack(pk), jd);
      if (!pp) continue;
      for (const k of ['Sun', 'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']) {
        const R = (k === 'Sun' ? 695700 : S.SP_RADIUS_KM[k]) / AU * sc.body(k);
        const gap = dist(pp, S._spBodyPos(k, jd)) / R;
        samples++;
        if (gap < worst) { worst = gap; worstWhat = pk + ' at ' + k + ' ' + jd; }
      }
    }
  }
  check(samples > 500 && worst > 1.0, 'no probe is drawn inside a body: closest ' + worst.toFixed(2) + ' drawn radii (' + worstWhat + ', ' + samples + ' samples)');
  // The three the reviewers named.
  const parker = jdOf('2024-12-24'), pk = S._spTrackAt(S._spTrack('parker'), parker);
  check(dist(pk, [0, 0, 0]) > S._spScale('readable', parker).body('Sun') * 695700 / AU, 'Parker at perihelion is outside the Sun as drawn (' + (dist(pk, [0, 0, 0]) / (S._spScale('readable', parker).body('Sun') * 695700 / AU)).toFixed(2) + ' radii)');
  const juno = jdOf('2026-10-14'), junoPos = S._spTrackAt(S._spTrack('juno'), juno), jsc = S._spScale('readable', juno);
  check(dist(junoPos, S._spPlanetPos('Jupiter', juno)) > jsc.body('Jupiter') * 71492 / AU, 'Juno today is outside Jupiter as drawn');
  const jw = jdOf('2026-10-14'), wp = S._spTrackAt(S._spTrack('jwst'), jw), wsc = S._spScale('readable', jw);
  check(dist(wp, S._spPlanetPos('Earth', jw)) > wsc.moon('Earth') * 384400 / AU, 'JWST at L2 is outside the Moon\'s drawn orbit (' + wsc.moon('Earth') + 'x)');
  check(wsc.body('Earth') >= 1 && wsc.moon('Earth') >= 1, 'scales are whole and at least 1');
}

// ── 3b. Flybys fly by ──────────────────────────────────────────────────────
{
  // The probe against the planet it passes, at the closest approach: both from the one table.
  const LIM = { 'voyager2/Neptune': 1e5, 'newhorizons/Pluto': 3e4, 'voyager2/Uranus': 2e5, 'voyager1/Saturn': 3e5, 'pioneer11/Saturn': 3e5, 'cassini/Saturn': 3e5 };
  const AUK = 149597870.7;
  for (const f of ref.flybys) {
    const jd = S._dateToJD(Date.parse(f.time));
    const probe = S._spTrackAt(S._spTrack(f.probe), jd), planet = S._spPlanetPos(f.planet, jd);
    const drawn = dist(probe, planet) * AUK, truth = dist(f.probe_xyz, f.planet_xyz) * AUK;
    const lim = LIM[f.probe + '/' + f.planet];
    check(Math.abs(drawn - truth) < lim, f.probe + ' at ' + f.planet + ' ' + f.time + ': ' + drawn.toExponential(2) + ' km from it, Horizons ' + truth.toExponential(2) + ' (limit ' + lim + ')');
  }
  // Voyager 2 at Neptune, in Neptune's radii: skimming the cloud tops, not a hundred radii off.
  const f0 = ref.flybys.find((f) => f.probe === 'voyager2' && f.planet === 'Neptune');
  const jdN = S._dateToJD(Date.parse(f0.time));
  check(dist(S._spTrackAt(S._spTrack('voyager2'), jdN), S._spPlanetPos('Neptune', jdN)) * AUK < 1e5, 'Voyager 2 is within 1e5 km of Neptune on 1989-08-25');
  const jdP = S._dateToJD(Date.parse('2015-07-14T11:50:00Z'));
  check(dist(S._spTrackAt(S._spTrack('newhorizons'), jdP), S._spPlanetPos('Pluto', jdP)) * AUK < 3e4, 'New Horizons is within 3e4 km of Pluto on 2015-07-14');
  const jdS = S._dateToJD(Date.parse('1980-11-12T23:46:00Z'));
  check(dist(S._spTrackAt(S._spTrack('voyager1'), jdS), S._spPlanetPos('Saturn', jdS)) * AUK < 3e5, 'Voyager 1 is at Saturn on 1980-11-12');
  // Cassini about Saturn in 2010: always within a few million km of it, never off in the cruise.
  let cmax = 0, cmin = 1e12;
  for (let jd = jdOf('2010-01-01'); jd < jdOf('2011-01-01'); jd += 1) {
    const d = dist(S._spTrackAt(S._spTrack('cassini'), jd), S._spPlanetPos('Saturn', jd)) * AUK;
    cmax = Math.max(cmax, d); cmin = Math.min(cmin, d);
  }
  check(cmax < 6e7 && cmin > 1e5, 'Cassini circles Saturn through 2010 (' + cmin.toExponential(1) + ' to ' + cmax.toExponential(1) + ' km)');
  // The table's own limits are stated; the planets and probes are one table.
  check(S._spPlanetPos('Jupiter', jdOf('2026-10-13')) !== null && Object.keys(tracksJson.planets).sort().join() === 'Jupiter,Neptune,Pluto,Saturn,Uranus', 'the giant planets and Pluto are shipped from Horizons');
  // Outside the table's years the planets still come from the elements (no hole in the date range).
  check(len(S._spPlanetPos('Jupiter', jdOf('2100-01-01'))) > 4 && len(S._spPlanetPos('Jupiter', jdOf('2100-01-01'))) < 6.5, 'Jupiter in 2100 is still drawn, from the elements');
}

// ── 3c. The numbers on the card are true, at either scale ──────────────────
{
  const jd = jdOf('2026-10-13');
  // From Earth: the Moon is 1.3 light-seconds away, however far out it is drawn.
  const moon = S._spTripBetween('Earth', 'Moon', jd, 0.1);
  near(moon.lightSec, 1.28, 0.1, 'the Moon is 1.3 light-seconds from Earth');
  near(moon.distAU * 149597870.7, 384400, 25000, 'the Moon is 384,400 km from Earth');
  // The Moon's drawn place (x39 orbit) is for drawing only: a different number.
  const drawn = dist(S._spBodyPos('Moon', jd, S._spScale('readable')), S._spBodyPos('Earth', jd));   // x39, no spacecraft near
  check(drawn > 20 * moon.distAU, 'the drawn Moon is far out (' + (drawn / moon.distAU).toFixed(0) + 'x) but the card does not say so');
  // Io and Titan from Earth: the light time of their planet, to within the orbit.
  for (const [m, pl, a] of [['Io', 'Jupiter', 421769], ['Europa', 'Jupiter', 671090], ['Ganymede', 'Jupiter', 1070432], ['Callisto', 'Jupiter', 1882794], ['Titan', 'Saturn', 1222375]]) {
    const dm = S._spTripBetween('Earth', m, jd, 0.1).distAU, dp = S._spTripBetween('Earth', pl, jd, 0.1).distAU;
    check(Math.abs(dm - dp) <= 1.05 * a / 149597870.7, m + ' is as far from Earth as ' + pl + ' to within its orbit (' + dm.toFixed(4) + ' vs ' + dp.toFixed(4) + ' AU)');
  }
  // From Jupiter: Io is 1.4 light-seconds, Callisto 6.3.
  near(S._spTripBetween('Jupiter', 'Io', jd, 0.1).lightSec, 421769 / 299792.458, 0.1, 'Io is 1.4 light-seconds from Jupiter');
  near(S._spTripBetween('Jupiter', 'Callisto', jd, 0.1).lightSec, 1882794 / 299792.458, 0.2, 'Callisto is 6.3 light-seconds from Jupiter');
  // The trip does not depend on the scale: the function takes none, and the standoff is true radii.
  const t1 = S._spTripBetween('Earth', 'Jupiter', jd, 0.1);
  near(t1.legAU, t1.distAU - 6 * 71492 / 149597870.7, 1e-3, 'the Jupiter trip stops 6 true radii short, at either scale');
  check(t1.earthSec > 0 && t1.shipSec < t1.earthSec, 'a Jupiter trip has two clocks');
  // A body that will have gone: Parker at the end of its table cannot be reached at walking pace.
  const gone = S._spTripBetween('Earth', 'parker', jdOf('2029-12-30'), 1e-4);
  check(gone && gone.reachable === false, 'a probe whose table ends before the ship arrives cannot be reached');
  check(S._spTripBetween('Earth', 'juno', jdOf('2026-10-13'), 0.1).reachable === true, 'Juno can be reached today');
  check(S._spTripBetween('Earth', 'cassini', jdOf('2026-10-13'), 0.1) === null, 'Cassini is not there to be flown to');
  // The light-time of the Sun: 8 min 19 s.
  near(S._spTripBetween('Earth', 'Sun', jd, 0.1).lightSec, 499 * 1.0, 12, 'the Sun is 8 min 19 s of light from Earth');
}

// ── 3d. Dates are UTC, event dates the same ────────────────────────────────
{
  const jd = S._dateToJD(Date.parse('1989-08-25T03:56:00Z'));
  const when = S._spFmtWhen(jd);
  check(/Aug/.test(when) && /25/.test(when) && /1989/.test(when) && /03:56/.test(when) && /UTC/.test(when), 'the Neptune flyby is Aug 25, 1989 03:56 UTC in a zone eight hours behind (' + when + ')');
  check(/Aug 25, 1989/.test(S._spFmtDate(jd)), 'and an event date says Aug 25 too (' + S._spFmtDate(jd) + ')');
  check(/Oct 13, 2026/.test(S._spFmtDate(jdOf('2026-10-13'))), 'midnight UTC is that day, not the day before');
}

// ── 3e. Which body a tap meant ─────────────────────────────────────────────
{
  const planet = { key: 'Saturn', kind: 'planet', x: 100, y: 100, rpx: 8 }, moon = { key: 'Titan', kind: 'moon', parent: 'Saturn', x: 104, y: 100, rpx: 3 };
  check(S._spPick([planet, moon], 104, 100) === 'Saturn', 'a tap on a small planet is the planet, though its moon is nearer');
  const big = { key: 'Saturn', kind: 'planet', x: 100, y: 100, rpx: 90 }, moon2 = { key: 'Titan', kind: 'moon', parent: 'Saturn', x: 150, y: 100, rpx: 6 };
  check(S._spPick([big, moon2], 152, 100) === 'Titan', 'zoomed in on the planet, a tap on its moon is the moon');
  check(S._spPick([big, moon2], 100, 100) === 'Saturn', 'and a tap on the planet is still the planet');
  check(S._spPick([planet], 200, 200) === null, 'a tap on nothing is nothing');
  const probe = { key: 'juno', kind: 'probe', x: 108, y: 100, rpx: 0 };
  check(S._spPick([planet, probe], 108, 100) === 'juno', 'a probe beside a planet is picked when the tap is on it');
}

// ── 5. The shipped data ────────────────────────────────────────────────────
{
  const bytes = fs.statSync(path.join(STATIC, 'earth', 'space-tracks-v1.json')).size;
  check(bytes < 300000, 'the track table is ' + bytes + ' bytes');
  const kinds = new Set(['launch', 'flyby', 'orbit', 'arrive', 'record', 'interstellar', 'end', 'pale_blue_dot']);
  for (const [key, t] of Object.entries(tracksJson.tracks)) {
    check(t.s.length >= 2 && t.jd0 < t.jd1 && t.s[0][0] === t.jd0 && t.s[t.s.length - 1][0] === t.jd1, key + ' spans ' + t.jd0 + '-' + t.jd1);
    check(t.s.every((row, i) => i === 0 || row[0] > t.s[i - 1][0]), key + ' samples are in time order');
    check(t.events.every(e => kinds.has(e[1])), key + ' events use known kinds');
  }
  for (const k of ['voyager1', 'voyager2', 'pioneer10', 'pioneer11', 'newhorizons', 'parker', 'juno', 'jwst']) check(!!tracksJson.tracks[k], k + ' is shipped');
}

if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
console.log('all checks passed');
