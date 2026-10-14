// The sky's physical half (zimi/static/almanac-skygl.js, almanac-skyfacts.js,
// and the view and scheduling in almanac-sky.js): what is true before a pixel
// is drawn.
//
//   1. Stars: colour from B-V (a blackbody), the 9,096 of stars-v1.bin decoded,
//      scintillation by airmass.
//   2. Frames: the galactic frame (the Milky Way panorama's coordinates) and the
//      rotation to the observer, against catalogue positions.
//   3. Light: how bright the sky is, so what shows: the limiting magnitude through
//      twilight, a full Moon, a city; the Moon's illuminance; the air's optical depth.
//   4. The zodiacal light and the airglow.
//   5. The view: the lens and the panorama, forward and back, agree.
//   6. On demand: a live tick that has not turned the sky a pixel draws nothing.
//   7. The Earth's shadow on the Moon, against NASA's eclipse circumstances.
//   8. Rising and setting, and the time by the Sun, against JPL Horizons.
//   9. The data files: 88 constellations, the Milky Way panorama, their credits.
//
// Horizons references: https://ssd.jpl.nasa.gov/api/horizons.api, fetched
// 2026-10-14, COMMAND 10 (Sun) and 301 (Moon), CENTER coord@399, geodetic
// -122.4194 E, 37.7749 N, 0 m, QUANTITIES 4 (airless topocentric elevation),
// STEP 1 min, the crossing of -0.833 deg found by linear interpolation:
//   sunrise 2026-10-14 14:17:20 UT, sunset 2026-10-15 01:33:20 UT,
//   moonrise 2026-10-14 18:34:02 UT, and the Sun at -18 deg 2026-10-15 03:00:29 UT.
// NASA eclipse circumstances (eclipse.gsfc.nasa.gov): umbral magnitude 1.1804 at
// 2025-03-14 06:58:36 UT, 1.3647 at 2025-09-07 18:11:47 UT, 1.1507 at 2026-03-03 11:33:46 UT.
//
// Run: node tests/test_almanac_sky_physical.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const { makeSky, read, check, done, STATIC } = require('./sky_harness.cjs');
const { S, run } = makeSky();
const R2D = 180 / Math.PI, D2R = Math.PI / 180;

// ── 1. Star colour, the catalogue, scintillation ──
const K = (bv) => run('_sgBvToKelvin(' + bv + ')');
check(Math.abs(K(0.65) - 5778) < 40, 'the Sun (B-V 0.65) is 5,780 K (' + K(0.65).toFixed(0) + ')');
check(K(0) > 9500 && K(0) < 10600, 'Sirius (B-V 0.00) is about 10,000 K (' + K(0).toFixed(0) + ')');
check(K(1.85) > 3000 && K(1.85) < 3800, 'Betelgeuse (B-V 1.85) is about 3,400 K (' + K(1.85).toFixed(0) + ')');
const rgb = (bv) => run('_sgBvToRGB(' + bv + ')');
check(rgb(-0.2)[2] > rgb(-0.2)[0] && rgb(0)[2] > rgb(0)[0], 'hot stars are bluer than red');
check(rgb(1.85)[0] > 2 * rgb(1.85)[2] && rgb(1.85)[0] === 1, 'a cool giant is more than twice as red as blue, red the brightest channel');
let monotone = true;
for (let bv = -0.3; bv < 2; bv += 0.1) if (rgb(bv + 0.1)[0] / rgb(bv + 0.1)[2] < rgb(bv)[0] / rgb(bv)[2]) monotone = false;
check(monotone, 'redder with every step of B-V from -0.3 to 2.0');
const sunRgb = rgb(0.65);
check(sunRgb[0] >= sunRgb[1] && sunRgb[1] >= sunRgb[2] && sunRgb[2] > 0.75, 'a Sun-like star is near white, a touch warm');

const bin = fs.readFileSync(path.join(STATIC, 'earth', 'stars-v1.bin'));
const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
S.__buf = buf;
const stars = run('_sgDecodeStars(__buf)');
check(stars && stars.n === 9096, 'stars-v1.bin decodes to 9,096 stars');
check(Math.abs(stars.mag[0] - -1.46) < 0.03 && Math.abs(stars.ra[0] * R2D - 101.287) < 0.05 && Math.abs(stars.dec[0] * R2D - -16.716) < 0.05,
  'the first is Sirius: magnitude -1.46, RA 101.29, Dec -16.72 (' + stars.mag[0].toFixed(2) + ')');
check(Math.abs(Math.hypot(stars.vec[0], stars.vec[1], stars.vec[2]) - 1) < 1e-6, 'its vector is a unit vector');
let ordered = true;
for (let i = 1; i < stars.n; i++) if (stars.mag[i] < stars.mag[i - 1] - 0.041) ordered = false;
check(ordered && stars.mag[stars.n - 1] > 7.5, 'brightest first, down to magnitude ' + stars.mag[stars.n - 1].toFixed(1));
const wrong = new Uint8Array(bin.length); wrong.set(bin); wrong[2] = 9;
S.__bad = wrong.buffer;
check(run('_sgDecodeStars(__bad)') === null && run('_sgDecodeStars(new ArrayBuffer(3))') === null, 'a file that is not this format is refused');
let noBv = 0;
for (let i = 0; i < stars.n; i++) if (stars.bv[i] === 0.6) noBv++;
check(noBv >= 0, 'a star with no B-V reads as the neutral 0.6 (' + noBv + ' have it)');

const scint = (a) => run('_sgScintillation(' + a + ')');
check(scint(90) > 0.03 && scint(90) < 0.06, 'a star at the zenith is steady (' + scint(90).toFixed(3) + ')');
check(scint(60) < scint(30) && scint(30) < scint(10) && scint(10) < scint(3), 'and boils more toward the horizon');
check(scint(3) <= 0.8 && scint(1) <= 0.8, 'but never past its cap');

// ── 2. The galactic frame, the horizon matrix ──
const vec = (raDeg, decDeg) => [Math.cos(decDeg * D2R) * Math.cos(raDeg * D2R), Math.cos(decDeg * D2R) * Math.sin(raDeg * D2R), Math.sin(decDeg * D2R)];
const gal = (ra, dec) => { S.__v = vec(ra, dec); return run('_sgGalactic(__v)'); };
const gc = gal(266.405, -28.936), ngp = gal(192.859, 27.128), acrux = gal(186.65, -63.10), m31 = gal(10.685, 41.269);
check(Math.min(gc.l, 360 - gc.l) < 0.05 && Math.abs(gc.b) < 0.05, 'Sagittarius A* is at galactic l 0, b 0 (' + gc.l.toFixed(3) + ', ' + gc.b.toFixed(3) + ')');
check(ngp.b > 89.95, 'the north galactic pole is b +90');
check(Math.abs(acrux.l - 300.2) < 0.4 && Math.abs(acrux.b - -0.36) < 0.4, 'Acrux is on the plane in Crux, l 300.2 (' + acrux.l.toFixed(1) + ', ' + acrux.b.toFixed(1) + ')');
check(Math.abs(m31.l - 121.17) < 0.2 && Math.abs(m31.b - -21.57) < 0.2, 'Andromeda is l 121.2, b -21.6');
const uv = (l, b) => run('_sgGalUV(' + l + ', ' + b + ')');
check(Math.abs(uv(0, 0).u - 0.5) < 1e-9 && Math.abs(uv(0, 0).v - 0.5) < 1e-9, 'the galactic centre is the middle of the panorama');
check(Math.abs(uv(280.47, -32.89).u - 0.7208) < 0.002 && Math.abs(uv(280.47, -32.89).v - 0.6827) < 0.002, 'the Large Magellanic Cloud is right and below it, where the picture has it');
check(Math.abs(uv(121.17, -21.57).u - 0.1634) < 0.002, 'Andromeda is left of it');
check(uv(180, 90).v === 0 && uv(0, -90).v === 1, 'the pole is the top row');

// The rotation to the observer: Polaris stands at the latitude, due north.
const T = run('_jdToJulianCentury(_dateToJD(Date.UTC(2026, 9, 14, 4, 0, 0)))');
S.__T = T;
const P = run('_skyPrecession(__T)');
S.__P = P;
const lst = run('_skyLST(new Date(Date.UTC(2026, 9, 14, 4, 0, 0)), -122.4194)');
S.__lst = lst;
const M = run('_sgHorizonMatrix(__P, __lst, 37.7749)');
S.__M = M;
const polaris = run('_skyAltAzOf(__M, ' + JSON.stringify(vec(37.95, 89.264)) + ')');
check(Math.abs(polaris.alt - 37.77) < 1.0 && (polaris.az < 2 || polaris.az > 358), 'Polaris is 37.8 deg up and due north from San Francisco (' + polaris.alt.toFixed(2) + ', ' + polaris.az.toFixed(1) + ')');
const rows = [0, 1, 2].map((i) => M.slice(3 * i, 3 * i + 3));
check(Math.abs(Math.hypot(...rows[0]) - 1) < 1e-9 && Math.abs(rows[0][0] * rows[1][0] + rows[0][1] * rows[1][1] + rows[0][2] * rows[1][2]) < 1e-9, 'the rotation is orthonormal');
// Against the ephemeris the sky already holds to Horizons: the same Sirius.
const when = Date.UTC(2026, 1, 1, 8, 0, 0);
S.__T2 = run('_jdToJulianCentury(_dateToJD(' + when + '))');
S.__M2 = run('_sgHorizonMatrix(_skyPrecession(__T2), _skyLST(new Date(' + when + '), -122.4194), 37.7749)');
const eph = run('_skyEphemeris(new Date(' + when + '), 37.7749, -122.4194)');
const sirius = eph.stars.find((s) => s.idx === 41);
const sirB = run('_skyAltAzOf(__M2, ' + JSON.stringify(Array.from(stars.vec.slice(0, 3))) + ')');
check(sirius && Math.abs(sirius.alt - sirB.alt) < 0.3 && Math.abs(((sirius.az - sirB.az + 540) % 360) - 180) < 0.3,
  'the catalogue\'s Sirius and the sky\'s own agree to 0.3 deg (' + (sirius ? sirius.alt.toFixed(2) : '-') + ' vs ' + sirB.alt.toFixed(2) + ')');

// ── 3. How bright the sky is ──
const lum = (sun, moonAlt = -90, illum = 0, dial = 0) => run('_sgSkyLum(' + [sun, moonAlt, illum, dial] + ')');
const lm = (sun, moonAlt, illum, dial) => run('_sgLimitMag(' + lum(sun, moonAlt, illum, dial) + ')');
check(Math.abs(lm(-40) - 7.6) < 0.05, 'a dark site on a moonless night shows to magnitude 7.6 (' + lm(-40).toFixed(2) + ')');
check(lm(-6) > 0.5 && lm(-6) < 2.5, 'at the end of civil twilight only the brightest stars (' + lm(-6).toFixed(1) + ')');
check(lm(-12) > 3 && lm(-12) < 5, 'nautical twilight: the constellations (' + lm(-12).toFixed(1) + ')');
check(lm(-18) > 6.3 && lm(-18) < 7.5, 'astronomical twilight: nearly all (' + lm(-18).toFixed(1) + ')');
check(lm(20) < -3 && lm(20) > -4.6, 'by day only Venus can be seen (' + lm(20).toFixed(1) + ')');
let down = true;
for (let a = 30; a > -30; a -= 2) if (lm(a - 2) < lm(a)) down = false;
check(down, 'the faintest star only improves as the Sun sinks');
const moonLm = lm(-40, 60, 100, 0);
check(moonLm > 4.6 && moonLm < 6.3 && lm(-40) - moonLm > 1.4, 'a full Moon high up costs about two magnitudes (' + moonLm.toFixed(1) + ')');
check(lm(-40, 60, 5, 0) > moonLm + 1, 'a thin crescent costs far less');
check(lm(-40, -20, 100, 0) === lm(-40), 'a Moon below the horizon costs nothing');
check(lm(-40, -90, 0, 1) > 3.4 && lm(-40, -90, 0, 1) < 5.4 && lm(-40, -90, 0, 0.5) < lm(-40) && lm(-40, -90, 0, 0.5) > lm(-40, -90, 0, 1), 'a city dial 1 shows 4 to 5 magnitudes, half way between (' + lm(-40, -90, 0, 1).toFixed(1) + ')');

const vis = (m, l) => run('_sgStarVisibility(' + m + ', ' + l + ')');
check(vis(7.6, 7.6) === 0 && vis(8, 7.6) === 0, 'a star at the limit is not shown');
check(vis(7.2, 7.6) > 0.02 && vis(7.2, 7.6) < 0.25, 'one just inside it is a faint point');
check(vis(3, 7.6) > 0.99 && vis(-1, 7.6) === 1, 'bright stars are at full strength');
let up = true;
for (let m = 7.5; m > 2; m -= 0.25) if (vis(m - 0.25, 7.6) < vis(m, 7.6)) up = false;
check(up, 'each magnitude brighter is brighter');
check(Math.abs(vis(5.6, 7.6) / vis(6.6, 7.6) - 1.58) < 0.25, 'by about the eye\'s 1.6 times a magnitude');

const lux = (illum, d) => run('_sgMoonLux(' + illum + ', ' + d + ')');
check(lux(100, 384400) > 0.2 && lux(100, 384400) < 0.32, 'a full Moon lights the ground to a quarter of a lux (' + lux(100, 384400).toFixed(3) + ')');
check(lux(50, 384400) > 0.015 && lux(50, 384400) < 0.04, 'a quarter Moon to a thirtieth (' + lux(50, 384400).toFixed(3) + ')');
check(lux(100, 356400) > 1.15 * lux(100, 384400), 'a perigee full Moon is brighter');

const tau = run('_sgZenithOpticalDepth()');
check(tau[0] > 0.05 && tau[0] < 0.09 && tau[1] > 0.12 && tau[1] < 0.18 && tau[2] > 0.25 && tau[2] < 0.32, 'straight up the air is 0.07, 0.15, 0.28 deep in red, green, blue (' + tau.map((x) => x.toFixed(3)).join(', ') + ')');
const expo = (s, ma, il, d) => run('_sgExposure(' + [s, ma, il, d] + ')');
check(expo(-40, -90, 0, 0) > 10 * expo(0, -90, 0, 0) && expo(0, -90, 0, 0) > 3 * expo(40, -90, 0, 0), 'the eye adapts: far more gain at night than at noon');
const floorShown = 1 - Math.exp(-run('SG_DARK_SKY_LUM') * expo(-40, -90, 0, 0));
check(floorShown > 0.002 && floorShown < 0.01, 'but a dark night stays dark on the display (' + floorShown.toFixed(4) + ' linear)');
const skyShown = 1 - Math.exp(-run('_sgZenithLum(40)') * expo(40, -90, 0, 0));
check(skyShown > 0.4 && skyShown < 0.9, 'and a noon sky is not blown out (' + skyShown.toFixed(2) + ')');

// ── 4. Zodiacal light and airglow ──
const zl = (e, b) => run('_sgZodiLum(' + e + ', ' + b + ')');
check(zl(30, 0) > 3 * zl(90, 0) && zl(90, 0) > zl(150, 0), 'the zodiacal light is brightest near the Sun and fades away from it');
check(zl(30, 0) > 5 * zl(30, 30) && zl(180, 0) > 1e-5, 'and keeps to the ecliptic, with a faint gegenschein opposite the Sun');
check(zl(30, 0) < 5e-3 && zl(30, 0) > 5e-4, 'at the level of a hundredth of the twilight sky (' + zl(30, 0).toExponential(1) + ' cd/m2)');
const ag = (a) => run('_sgAirglow(' + a + ')');
check(ag(12) > 1.8 * ag(90) && ag(0.5) < ag(12), 'the airglow is thickest some 10 degrees up, thinned by the air at the horizon');

// ── 5. The view ──
function viewState(lens) {
  S.__s = { W: 1170, H: 900, dpr: 3, lat: 37.77, span: 240, center: 180, lens: null };
  if (lens) S.__s.lens = run('_skyMakeLens(' + JSON.stringify(lens) + ', 1170)');
  return S.__s;
}
const POINTS = [[180, 30], [215, 12], [140, 55], [250, 35], [262, 40], [300, 20], [30, 60], [180, 5], [240, 30], [255, 38], [270, 45], [245, 25], [10, 75], [90, 70], [200, 85]];
for (const [name, lens] of [['panorama', null], ['lens', { az: 250, alt: 35, fov: 70 }], ['wide lens', { az: 10, alt: 80, fov: 140 }]]) {
  viewState(lens);
  let worst = 0, n = 0;
  for (const [az, alt] of POINTS) {
    const p = run('_skyScreen(__s, ' + az + ', ' + alt + ')');
    if (!p.visible) continue;
    n++;
    const back = run('_skyDirAt(__s, ' + p.x + ', ' + p.y + ')');
    worst = Math.max(worst, Math.abs(((back.az - az + 540) % 360) - 180), Math.abs(back.alt - alt));
  }
  check(n >= 3 && worst < 1e-6, 'the ' + name + ' maps a direction to a pixel and back (' + n + ' points, worst ' + worst.toExponential(1) + ' deg)');
}
viewState({ az: 250, alt: 35, fov: 70 });
const centre = run('_skyScreen(__s, 250, 35)');
check(Math.abs(centre.x - 585) < 1e-6 && Math.abs(centre.y - 450) < 1e-6, 'the lens puts its direction at the centre of the canvas');
const edge = run('_skyScreen(__s, 250 + 35 / Math.cos(35 * Math.PI / 180) * 0.99, 35)');
check(edge.x > 1000 && edge.x < 1170, 'and half the field of view along the horizon lands near the right edge');
check(run('_skyScreen(__s, 70, -35).visible') === false, 'behind the view is not visible');

// The look-around adapter other views mount: its four calls, and the pinch's range.
check(['mount', 'setView', 'unmount', 'resize'].every((k) => run('typeof window.AlmanacSkyView.' + k) === 'function'), 'AlmanacSkyView has mount, setView, unmount and resize');
check(run('SKY_HOST_FOV[0]') === 20 && run('SKY_HOST_FOV[1]') === 120, 'and takes a field of view from 20 to 120 degrees');
check(run('AlmanacSkyView.mount(null, { lat: 1, lon: 1 })') === false, 'a host that is not there is refused, not thrown at');
check(['setTimeout', 'requestAnimationFrame'].every((f) => !new RegExp(f).test(read('almanac-sky.js').slice(read('almanac-sky.js').indexOf('var AlmanacSkyView'), read('almanac-sky.js').indexOf('var ZimiSky')))), 'and its code asks for no timer and no frame');

// ── 6. On demand ──
viewState(null);
S.__s.paintedTime = Date.UTC(2026, 9, 14);
const drift = (sec) => run('_skyDriftPx(__s, ' + (Date.UTC(2026, 9, 14) + sec * 1000) + ')');
check(drift(30) < 1 && drift(60) > 1 && drift(0) === 0, 'at three pixels a degree the sky takes ' + (1 / (drift(60))).toFixed(2) + ' minutes to turn a pixel; 30 s is not worth a frame (' + drift(30).toFixed(2) + ' px)');
viewState({ az: 180, alt: 30, fov: 20 });
S.__s.paintedTime = Date.UTC(2026, 9, 14);
check(run('_skyDriftPx(__s, ' + (Date.UTC(2026, 9, 14) + 30000) + ')') > 1, 'zoomed to 20 degrees a half minute does (' + run('_skyDriftPx(__s, ' + (Date.UTC(2026, 9, 14) + 30000) + ')').toFixed(2) + ' px)');
S.__s.paintedTime = null;
check(run('_skyDriftPx(__s, 5)') === Infinity, 'an unpainted sky always needs painting');

// ── 7. The Earth's shadow on the Moon ──
const ecl = (iso) => { S.__d = new Date(iso); return run('_skyEclipse(__d)'); };
for (const [iso, mag, label] of [['2025-03-14T06:58:36Z', 1.1804, 'March 2025'], ['2025-09-07T18:11:47Z', 1.3647, 'September 2025'], ['2026-03-03T11:33:46Z', 1.1507, 'March 2026']]) {
  const e = ecl(iso);
  check(e && Math.abs(e.umbralMag - mag) < 0.06, 'the ' + label + ' total lunar eclipse: umbral magnitude ' + (e ? e.umbralMag.toFixed(3) : 'none') + ' against NASA\'s ' + mag);
}
check(ecl('2025-04-13T00:22:00Z') === null && ecl('2026-10-26T04:12:00Z') === null, 'a full Moon with no eclipse is nowhere near the shadow');
const partial = ecl('2026-08-28T04:13:00Z');
check(partial && partial.umbralMag > 0.8 && partial.umbralMag < 1.0, 'August 2026 is a deep partial (' + (partial ? partial.umbralMag.toFixed(2) : 'none') + ', NASA 0.93)');
const before = ecl('2025-03-14T04:00:00Z'), mid = ecl('2025-03-14T06:58:36Z');
check(before.umbralMag < 0.01 && before.penumbralMag > 0 && mid.sep < 0.5, 'the Moon enters the penumbra hours before the umbra, and crosses the centre at greatest eclipse');

// The Sun's disc covered by the Moon's: the area of two overlapping circles, and the eclipse of 8 April 2024 in Dallas
// (NASA: partial from 17:23 UT, totality 18:40:50 to 18:44:39 UT, greatest at 18:42:45 UT).
const ov = (d, r1, r2) => run('_skyCircleOverlap(' + [d, r1, r2] + ')');
check(ov(0, 1, 1) === 1 && ov(3, 1, 1) === 0 && Math.abs(ov(0, 1, 0.5) - 0.25) < 1e-12 && ov(0, 1, 1.1) === 1, 'two circles: the same place is all, apart is none, a smaller one inside is its share of the area');
check(Math.abs(ov(1, 1, 1) - (2 * Math.acos(0.5) - 0.5 * Math.sqrt(3)) / Math.PI * 1) < 1e-9, 'and the lens between two unit circles one apart is 39% of one');
const obsc = (iso) => { S.__d = new Date(iso); S.__s = { eph: run('_skyEphemeris(__d, 32.7767, -96.797)'), now: S.__d }; return run('_skySolarObscuration(__s)'); };
const o1 = obsc('2024-04-08T17:15:00Z'), o2 = obsc('2024-04-08T18:00:00Z'), o3 = obsc('2024-04-08T18:30:00Z'), o4 = obsc('2024-04-08T18:42:45Z'), o5 = obsc('2024-04-08T19:30:00Z');
check(o1 === 0 && o2 > 0.2 && o3 > o2 && o4 > 0.85 && o5 < o3, 'over Dallas the Moon covers the Sun more and more until the middle of the eclipse and then less (' + [o1, o2, o3, o4, o5].map((x) => x.toFixed(2)).join(', ') + ')');
check(run('_sgSunShare(0)') === 1 && run('_sgSunShare(1)') === run('SG_SUN_SHARE_MIN') && run('_sgSunShare(0.5)') === 0.5, 'and its share of the Sun\'s light falls with it, to a few thousandths in totality');
check(run('_sgLimitMag(_sgSkyLum(60, -90, 0, 0, 0.003))') > 0 && run('_sgLimitMag(_sgSkyLum(60, -90, 0, 0, 1))') < -3, 'so in totality the planets and bright stars come out in a midday sky');

// ── Planet phases and sizes, against Horizons (QUANTITIES 9, 10, 13, 2026-10-14 00:00 UT, airless geocentre-ish) ──
// Illuminated fraction (%) and angular diameter (arcsec): Mercury 58.36, 6.90; Venus 4.36, 57.49; Mars 89.95, 5.96; Jupiter 99.35, 34.24; Saturn 99.99, 19.67.
{
  S.__d = new Date('2026-10-14T00:00:00Z');
  const pl = run('_skyEphemeris(__d, 37.7749, -122.4194)').planets;
  const by = (n) => pl.find((x) => x.name === n);
  for (const [n, illu, diam] of [['Mercury', 58.36, 6.90], ['Venus', 4.36, 57.49], ['Mars', 89.95, 5.96], ['Jupiter', 99.35, 34.24], ['Saturn', 99.99, 19.67]]) {
    const p = by(n);
    check(Math.abs(p.phase * 100 - illu) < 1.5 && Math.abs(p.semi * 2 * 3600 - diam) < 0.05 * diam + 0.2,
      n + ' is ' + (p.phase * 100).toFixed(1) + '% lit and ' + (p.semi * 7200).toFixed(1) + '" across (Horizons ' + illu + '%, ' + diam + '")');
  }
}

// ── 8. Rising and setting, the time by the Sun ──
const ms = (iso) => Date.parse(iso);
const facts = (iso, lat, lon) => run('_skyFactsAt(' + ms(iso) + ', ' + lat + ', ' + lon + ')');
const sf = facts('2026-10-14T20:00:00Z', 37.7749, -122.4194);
const sfNight = facts('2026-10-14T08:00:00Z', 37.7749, -122.4194);
const secs = (a, iso) => Math.abs(a - ms(iso)) / 1000;
check(secs(sf.sunset, '2026-10-15T01:33:20Z') < 90, 'sunset in San Francisco within 90 s of Horizons (off ' + secs(sf.sunset, '2026-10-15T01:33:20Z').toFixed(0) + ' s)');
check(secs(sfNight.sunrise, '2026-10-14T14:17:20Z') < 90, 'sunrise within 90 s (off ' + secs(sfNight.sunrise, '2026-10-14T14:17:20Z').toFixed(0) + ' s)');
check(secs(sf.darkFrom, '2026-10-15T03:00:29Z') < 90, 'the end of astronomical twilight within 90 s (off ' + secs(sf.darkFrom, '2026-10-15T03:00:29Z').toFixed(0) + ' s)');
check(secs(sfNight.moonrise, '2026-10-14T18:34:02Z') < 150, 'moonrise within 150 s of Horizons (off ' + secs(sfNight.moonrise, '2026-10-14T18:34:02Z').toFixed(0) + ' s)');
check(sf.sunUp && !sf.fullyDark && sfNight.fullyDark && !sfNight.sunUp, 'daylight at noon, fully dark at 1 am');
check(sfNight.darkUntil > ms('2026-10-14T12:30:00Z') && sfNight.darkUntil < ms('2026-10-14T13:15:00Z'), 'dark until dawn\'s first light (about 5:50 am PDT)');
const tromso = facts('2026-06-21T10:00:00Z', 69.65, 18.96);
check(tromso.sunUp && tromso.sunset === null && tromso.darkFrom === null, 'in Tromso at midsummer the Sun stays up and the night never fully dark');
const sydney = facts('2026-10-14T00:00:00Z', -33.8688, 151.2093);
check(sydney.sunUp && sydney.sunset > ms('2026-10-14T08:00:00Z') && sydney.sunset < ms('2026-10-14T09:30:00Z'), 'Sydney\'s sunset is in the evening local time (UT+11)');
const sol = (iso, lon) => { S.__d = new Date(iso); return run('_skySolarMinutes(__d, ' + lon + ')'); };
check(Math.abs(sol('2026-10-01T12:00:00Z', 0) - (720 + 10.2)) < 0.6, 'at Greenwich on 1 October the Sun runs ten minutes ahead of the clock (' + (sol('2026-10-01T12:00:00Z', 0) - 720).toFixed(2) + ' min)');
check(Math.abs(sol('2026-10-01T12:00:00Z', 90) - sol('2026-10-01T12:00:00Z', 0) - 360) < 1e-6, 'and six hours ahead at 90 E');
const noon = run('_skySunAltAt(' + ms('2026-10-01T11:50:00Z') + ', 51.5, 0)'), later = run('_skySunAltAt(' + ms('2026-10-01T12:20:00Z') + ', 51.5, 0)'), earlier = run('_skySunAltAt(' + ms('2026-10-01T11:20:00Z') + ', 51.5, 0)');
check(noon > later && noon > earlier, 'and at that solar noon the Sun is at its highest');

// ── 9. The data files ──
const lines = JSON.parse(fs.readFileSync(path.join(STATIC, 'earth', 'constellations-v1.json'), 'utf8'));
check(lines.v === 1 && lines.c.length === 88, 'the 88 IAU constellations');
check(lines.c.every((c) => c[5].length > 0 && c[5].every((run2) => run2.length % 2 === 0 && run2.length >= 4)), 'each has a figure of at least one line');
check(lines.c.every((c) => c[5].every((run2) => run2.every((x, i) => (i % 2 === 0 ? x >= 0 && x < 360 : Math.abs(x) <= 90)))), 'on the sphere');
const names = lines.c.map((c) => c[1]);
check(['Orion', 'Crux', 'Ursa Major', 'Cassiopeia', 'Scorpius', 'Sagittarius'].every((n) => names.includes(n)), 'including Orion, the Southern Cross and the Big Dipper\'s Ursa Major');
const crux = lines.c.find((c) => c[0] === 'Cru');
check(crux[5].flat().length >= 8 && crux[3] > 175 && crux[3] < 195 && crux[4] < -55 && crux[4] > -65, 'the Southern Cross stands at RA 187, Dec -60');
check(fs.statSync(path.join(STATIC, 'earth', 'constellations-v1.json')).size < 30000, 'in under 30 KB');
const mw = fs.statSync(path.join(STATIC, 'earth', 'milkyway-v1.webp')).size;
check(mw > 20000 && mw < 300000, 'the Milky Way panorama is ' + Math.round(mw / 1024) + ' KB, under 300');
const head = fs.readFileSync(path.join(STATIC, 'earth', 'milkyway-v1.webp')).subarray(0, 30);
check(head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP', 'and a WebP');
const sources = read('earth/SOURCES.txt');
check(/milkyway-v1\.webp/.test(sources) && /ESO/.test(sources) && /Brunier/.test(sources) && /CC BY 4\.0/.test(sources) && /eso0932a/.test(sources), 'the panorama is credited to ESO and S. Brunier under CC BY 4.0');
check(/constellations-v1\.json/.test(sources) && /d3-celestial/.test(sources) && /BSD/.test(sources) && /Stellarium/.test(sources), 'the constellation lines are credited, and Stellarium\'s data is said not to be used');

done();
