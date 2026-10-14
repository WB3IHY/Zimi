// ── Almanac: the solar system you can fly through ──
// Tap "Fly through space" under the orrery and the page becomes a 3D solar
// system at the date it shows: the Sun, the planets, Pluto and Ceres, the big
// moons, Saturn's rings, and the probes where they really are. Pick a place and
// fly there in a ship that can go as fast as you like, up to 0.99 of the speed
// of light, and watch what light does to the view.
//
// Offline and honest:
//   - The planets and Pluto come from the orrery's own Keplerian elements
//     (almanac-orrery.js _planetHelio3D, JPL's approximate set), so the flat
//     orrery and this view cannot disagree. The Moon is the Earth view's
//     (almanac-earth.js _aeMoon, Meeus). The Galilean moons and Titan are on
//     mean circular orbits fitted to JPL Horizons (scripts/fit_moon_orbits.py)
//     and the page says so.
//   - The probes and Ceres are a table of JPL Horizons vectors that ships with
//     the page (earth/space-tracks-v1.json, scripts/build_space_tracks.py),
//     thinned until a cubic Hermite curve through its positions and velocities
//     stays within 4e-4 AU + 3e-4 of the distance from the Sun of every
//     Horizons sample. A probe is drawn only inside the years the table covers.
//   - The effects of speed are the textbook ones, computed here from the
//     ship's speed alone: relativistic aberration (the sky crowds toward the
//     heading), the Doppler shift and the searchlight effect (D^2 in energy
//     flux), the two clocks. The ship is a pretend one: no real ship could
//     change speed so freely; the page says that too.
//
// Loaded with the other almanac modules (they share one global scope); the
// heavy parts (three.js, the maps, the probe table) load only when the view
// is first opened. window.openAlmanacSpace() is the entry point: the pill under
// the orrery calls it. The pure functions below take and return plain numbers
// so tests/test_almanac_space.cjs can check them against Horizons.
//
// Frames and units: heliocentric, J2000 ecliptic and equinox, astronomical
// units, z toward the ecliptic's north pole. Times are Julian Days (UT); a
// moment's TDB differs by ~69 s, which moves the fastest probe ~1e-4 AU.
// Helpers (_aeDot, _aeSub, _aeLen, _aeScale, _aeNorm, _aeCross, _aeEqVec,
// _aeRad, _aeDeg) are the Earth view's, loaded before this file.

// ── Constants ──
// The light-time of one AU, the AU in km and the day in seconds are the
// orrery's (almanac-orrery.js LIGHT_SECONDS_PER_AU, AU_KM, SECONDS_PER_DAY).
var SP_MAX_BETA = 0.99;
var SP_MIN_BETA = 1e-4;            // 30 km/s, about a probe's speed
// A ship cannot change speed instantly. It eases up to its speed over the
// first SP_RAMP_FRACTION of the way and eases down over the last: the speed
// goes as sqrt(distance flown) there, so the clocks have closed forms.
var SP_RAMP_FRACTION = 0.05;
var SP_BETA_STEPS = 1000;          // the speed slider's resolution
var SP_OBLIQUITY_DEG = AE_OBLIQUITY_J2000_ARCSEC / 3600;
var SP_PRECESSION_DEG_PER_CENTURY = 5028.796195 / 3600;   // general precession in longitude (IAU 2006)

// Where the page's assets live. Static files are served immutable, so each
// name carries its version.
var SP_TRACKS_URL = '/static/earth/space-tracks-v1.json';
var SP_MAP_URL = '/static/earth/';
var SP_MAP_EXT = '-v1.webp';

// ── Light seen from a moving ship ──
// Let n be the direction of a star in the frame the Sun rests in, v̂ the ship's
// heading, cosT = n . v̂, and beta = v / c. In the ship's frame the star is at
// the angle with cos T' = (cosT + beta) / (1 + beta cosT): the sky crowds toward
// the heading. The light's frequency is multiplied by the Doppler factor
// D = gamma (1 + beta cosT) (above 1 ahead: blue; below 1 behind: red), the
// energy flux from a point by D^2 (aberration packs the same light into a
// smaller patch of sky ahead, and each photon is worth more and arrives more
// often), and a blackbody of temperature T looks like one of D T.
function _spAberrateCos(cosT, beta) { return (cosT + beta) / (1 + beta * cosT); }

// The direction n (unit) as the ship sees it, heading v̂ (unit).
function _spAberrateDir(n, v, beta) {
  var c = _aeDot(n, v);
  var side = _aeSub(n, _aeScale(v, c));           // the part across the heading
  var sideLen = _aeLen(side);
  var c2 = _spAberrateCos(c, beta);
  if (sideLen < 1e-12) return _aeScale(v, c2 >= 0 ? 1 : -1);
  var s2 = Math.sqrt(Math.max(0, 1 - c2 * c2));
  return _aeNorm(_spAdd(_aeScale(v, c2), _aeScale(side, s2 / sideLen)));
}
function _spAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

function _spDoppler(beta, cosT) { return _lorentzFactor(beta) * (1 + beta * cosT); }

// A star's temperature from its colour index (Ballesteros 2012, B-V to K).
function _spStarTemp(bv) { return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)); }

// A blackbody's colour as sRGB with the largest channel 1 (Tanner Helland's fit
// to Mitchell Charity's table, 1000 K to 40000 K). Brightness is separate.
function _spBlackbodyRGB(T) {
  var t = Math.min(400, Math.max(10, T / 100));
  var r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  var g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  var b = t >= 66 ? 255 : (t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307);
  var m = Math.max(r, g, b);
  return [Math.max(0, r) / m, Math.max(0, g) / m, Math.max(0, b) / m];
}

// The share of a blackbody's light that falls in 380-750 nm: Planck's law
// summed over 24 slices into a table of 160 temperatures, made at the first
// call and read in log T.
var SP_VIS_NM = [380, 750];
var SP_VIS_T = [300, 400000, 160];   // from, to (K), table entries
var SP_PLANCK_C2 = 1.438776877e-2;   // h c / k, m K
var SP_PLANCK_2HC2 = 1.191042972e-16; // 2 h c^2, W m^2
var SP_STEFAN_BOLTZMANN = 5.670374419e-8;
var _spVisTable = null;
function _spVisBuild() {
  var out = [], n = SP_VIS_T[2], slices = 24, dlam = (SP_VIS_NM[1] - SP_VIS_NM[0]) * 1e-9 / slices;
  for (var i = 0; i < n; i++) {
    var T = SP_VIS_T[0] * Math.pow(SP_VIS_T[1] / SP_VIS_T[0], i / (n - 1)), sum = 0;
    for (var k = 0; k < slices; k++) {
      var lam = (SP_VIS_NM[0] + (SP_VIS_NM[1] - SP_VIS_NM[0]) * (k + 0.5) / slices) * 1e-9;
      sum += SP_PLANCK_2HC2 / (Math.pow(lam, 5) * (Math.exp(SP_PLANCK_C2 / (lam * T)) - 1)) * dlam;
    }
    out.push(sum / (SP_STEFAN_BOLTZMANN * Math.pow(T, 4) / Math.PI));
  }
  return out;
}
function _spVisFraction(T) {
  if (!_spVisTable) _spVisTable = _spVisBuild();
  var n = SP_VIS_T[2];
  var x = Math.log(Math.min(SP_VIS_T[1], Math.max(SP_VIS_T[0], T)) / SP_VIS_T[0]) / Math.log(SP_VIS_T[1] / SP_VIS_T[0]) * (n - 1);
  var i = Math.min(n - 2, Math.floor(x)), f = x - i;
  return _spVisTable[i] * (1 - f) + _spVisTable[i + 1] * f;
}

// How much brighter the visible light of a blackbody of temperature T looks
// from a ship where its Doppler factor is D: D^2 in energy, times the share
// of the shifted spectrum that is still visible over the share that was.
function _spBeamGain(D, T) { return D * D * _spVisFraction(D * T) / _spVisFraction(T); }

// ── The trip ──
// Light takes LIGHT_SECONDS_PER_AU a unit. The ship eases up and down over
// SP_RAMP_FRACTION of the way at each end, its speed there going as the square
// root of the way flown (beta(s) = beta0 sqrt(s / R)), cruising at beta0 between.
// Both clocks have closed forms: the Earth's from integrating 1 / beta, the
// ship's from integrating sqrt(1 - beta^2) / beta. `s` is the share of the
// way flown.
function _spRampBeta(s, beta) {
  var R = SP_RAMP_FRACTION;
  return beta * Math.sqrt(Math.min(1, s / R, (1 - s) / R));
}
// asin(x)/x - 1, by series where the subtraction would lose it.
function _spAsincM1(x) {
  if (x > 0.1) return Math.asin(x) / x - 1;
  var x2 = x * x;
  return x2 * (1 / 6 + x2 * (3 / 40 + x2 * (5 / 112 + x2 * 35 / 1152)));
}
// The first ramp, flown to the share u of its length (s = R u^2), in units of
// (the way in light-seconds) / beta: the Earth clock, and how far the ship's
// clock has fallen behind it (kept as a difference: a real ship's is 1e-9 of the
// trip, which a subtraction of two clocks would lose).
function _spRampTo(u, beta) {
  var R = SP_RAMP_FRACTION, x = beta * u, root = Math.sqrt(1 - x * x);
  return { earth: 2 * R * u, lag: R * u * (x * x / (1 + root) - _spAsincM1(x)) };
}
// The clocks after the share s of the way flown, cruising at beta, for a way
// of `au` AU: seconds on the Earth clock, on the ship's, and the speed then.
function _spTripAt(au, beta, s) {
  var R = SP_RAMP_FRACTION, light = _lightDelaySeconds(au) / beta;
  var cruiseLag = beta * beta / (1 + Math.sqrt(1 - beta * beta));   // lag per unit of cruise way
  var up = _spRampTo(1, beta), earth, lag;
  s = Math.min(1, Math.max(0, s));
  if (s <= R) {
    var a = _spRampTo(Math.sqrt(s / R), beta);
    earth = a.earth; lag = a.lag;
  } else if (s < 1 - R) {
    earth = up.earth + (s - R); lag = up.lag + (s - R) * cruiseLag;
  } else {
    var back = _spRampTo(Math.sqrt((1 - s) / R), beta);
    earth = 2 * up.earth + (1 - 2 * R) - back.earth;
    lag = 2 * up.lag + (1 - 2 * R) * cruiseLag - back.lag;
  }
  return { earthSec: earth * light, shipSec: (earth - lag) * light, lagSec: lag * light, beta: _spRampBeta(s, beta) };
}
function _spTrip(au, beta) { return _spTripAt(au, beta, 1); }

// Fly from `from` (AU) at beta to a body that moves: `posAt(jd)` is where it is.
// The place to fly to is where the body will be when the ship gets there; the
// ship stops `standoff` short of it.
function _spIntercept(posAt, from, beta, jd0, standoff) {
  var stop = standoff || 0, pos = posAt(jd0), d = Math.max(0, _aeLen(_aeSub(pos, from)) - stop), days = 0;
  for (var i = 0; i < 12; i++) {
    days = _spTrip(d, beta).earthSec / SECONDS_PER_DAY;
    pos = posAt(jd0 + days);
    d = Math.max(0, _aeLen(_aeSub(pos, from)) - stop);
  }
  return { arriveJd: jd0 + _spTrip(d, beta).earthSec / SECONDS_PER_DAY, pos: pos, distAU: d, trip: _spTrip(d, beta) };
}

// A body as the light shows it to an observer at `observer` at jd: where it
// was when the light that arrives now left it.
function _spRetarded(posAt, observer, jd) {
  var pos = posAt(jd), lag = 0;
  for (var i = 0; i < 6; i++) {
    lag = _lightDelaySeconds(_aeLen(_aeSub(pos, observer)));
    pos = posAt(jd - lag / SECONDS_PER_DAY);
  }
  return { pos: pos, lagSec: _lightDelaySeconds(_aeLen(_aeSub(pos, observer))) };
}

// ── Where things are ──
// A planet or Pluto, or the Sun: heliocentric AU, J2000 ecliptic. The Earth's
// elements are the Earth-Moon barycentre's: 4700 km, 3e-5 AU, off the Earth.
function _spPlanetPos(name, jd) {
  if (name === 'Sun') return [0, 0, 0];
  var p = _planetHelio3D(name, _jdToJulianCentury(jd));
  return [p.x, p.y, p.z];
}

// Equatorial (ICRF/J2000) to ecliptic (J2000).
function _spEqToEcl(v) {
  var c = Math.cos(_aeRad(SP_OBLIQUITY_DEG)), s = Math.sin(_aeRad(SP_OBLIQUITY_DEG));
  return [v[0], c * v[1] + s * v[2], -s * v[1] + c * v[2]];
}
function _spStarDir(ra, dec) { return _spEqToEcl(_aeEqVec(ra, dec, 1)); }

// Each body's pole (IAU WGCCRE 2015, J2000: right ascension and declination of
// its north pole, degrees) and its turning (W0 at J2000 and Wd a day, degrees,
// measured from the node of its equator on the equator of J2000). Pluto's
// north is the IAU's. Earth is below: it turns by sidereal time.
var SP_POLES = {
  Mercury: { ra: 281.0103, dec: 61.4155, w0: 329.5988, wd: 6.1385108 },
  Venus:   { ra: 272.76, dec: 67.16, w0: 160.20, wd: -1.4813688 },
  Mars:    { ra: 317.269202, dec: 54.432516, w0: 176.049863, wd: 350.891982443297 },
  Jupiter: { ra: 268.056595, dec: 64.495303, w0: 284.95, wd: 870.5360000 },
  Saturn:  { ra: 40.589, dec: 83.537, w0: 38.90, wd: 810.7939024 },
  Uranus:  { ra: 257.311, dec: -15.175, w0: 203.81, wd: -501.1600928 },
  Neptune: { ra: 299.36, dec: 43.46, w0: 249.978, wd: 541.1397757 },
  Pluto:   { ra: 132.993, dec: -6.163, w0: 302.695, wd: 56.3625225 },
  Ceres:   { ra: 291.418, dec: 66.764, w0: 170.65, wd: 952.1532 }
};
function _spPoleEcl(name) {
  if (name === 'Earth') return _spEqToEcl([0, 0, 1]);
  var p = SP_POLES[name];
  return _spEqToEcl(_aeEqVec(_aeRad(p.ra), _aeRad(p.dec), 1));
}
// A body's axes in the ecliptic frame at jd: x toward longitude 0 on its
// equator, z its north pole, y = z x x (east).
function _spBodyFrame(name, jd) {
  var z = _spPoleEcl(name), x;
  if (name === 'Earth') {
    var nut = _aeNutation((jd - JD_J2000) / JULIAN_CENTURY);
    var g = _aeGast(jd, nut);
    x = _spEqToEcl([Math.cos(g), Math.sin(g), 0]);
  } else {
    var p = SP_POLES[name], d = jd - JD_J2000;
    var w = _aeRad(_aeNormDeg(p.w0 + p.wd * d));
    var node = _spEqToEcl([-Math.sin(_aeRad(p.ra)), Math.cos(_aeRad(p.ra)), 0]);   // the equator's node: RA + 90 deg
    var perp = _aeCross(z, node);
    x = _spAdd(_aeScale(node, Math.cos(w)), _aeScale(perp, Math.sin(w)));
  }
  return { x: x, y: _aeCross(z, x), z: z };
}

// The mean circular orbits of the big moons (scripts/fit_moon_orbits.py, JPL
// Horizons 1990-2060): the radius (km), the longitude in the planet's equator
// at J2000 (degrees from the node of that equator on the ecliptic) and the
// motion (degrees a day). Worst miss against Horizons: Io 0.5, Europa 1.2,
// Ganymede 0.4, Callisto 0.9, Titan 3.3 degrees (Titan's orbit is the most
// eccentric). Radii of the moons are the IAU mean radii.
var SP_MOONS = {
  Io:       { planet: 'Jupiter', a: 421769,  L0: 40.361,  rate: 203.488958, r: 1821.6 },
  Europa:   { planet: 'Jupiter', a: 671090,  L0: 234.918, rate: 101.374724, r: 1560.8 },
  Ganymede: { planet: 'Jupiter', a: 1070432, L0: 242.196, rate: 50.317608,  r: 2634.1 },
  Callisto: { planet: 'Jupiter', a: 1882794, L0: 101.383, rate: 21.571073,  r: 2410.3 },
  Titan:    { planet: 'Saturn',  a: 1222375, L0: 327.598, rate: 22.576976,  r: 2574.7 },
  Moon:     { planet: 'Earth',   a: 384400,  r: 1737.4 }
};
function _spMoonPlanet(name) { return SP_MOONS[name].planet; }
// A moon's place relative to its planet (AU, ecliptic axes).
function _spMoonOffset(name, jd) {
  var m = SP_MOONS[name];
  if (name === 'Moon') {
    // _aeMoon's longitude is of date; the frame here is J2000's.
    var q = _aeMoon(jd + _aeDeltaTDays(jd)), lo = _aeRad(q.lon - SP_PRECESSION_DEG_PER_CENTURY * (jd - JD_J2000) / JULIAN_CENTURY), la = _aeRad(q.lat), r = q.distKm / AU_KM;
    return [r * Math.cos(la) * Math.cos(lo), r * Math.cos(la) * Math.sin(lo), r * Math.sin(la)];
  }
  var pole = _spPoleEcl(m.planet);
  var x = _aeNorm(_aeCross([0, 0, 1], pole)), y = _aeCross(pole, x);
  var lam = _aeRad(m.L0 + m.rate * (jd - JD_J2000)), r2 = m.a / AU_KM;
  return _spAdd(_aeScale(x, r2 * Math.cos(lam)), _aeScale(y, r2 * Math.sin(lam)));
}

// ── The probe table ──
// Rows [jd, x, y, z, vx, vy, vz] (AU, AU/day), thinned so a cubic Hermite curve
// through them is within the table's tolerance of Horizons.
var _spTracks = {};
function _spSetTracks(json) { _spTracks = json && json.tracks ? json.tracks : {}; }
function _spTrack(key) { return _spTracks[key] || null; }
function _spHermite(a, b, jd) {
  var h = b[0] - a[0], t = (jd - a[0]) / h, t2 = t * t, t3 = t2 * t;
  var h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  var out = [0, 0, 0];
  for (var k = 0; k < 3; k++) out[k] = h00 * a[1 + k] + h10 * h * a[4 + k] + h01 * b[1 + k] + h11 * h * b[4 + k];
  return out;
}
// 'before' its launch (or the table's start), 'flying', or 'after' its end.
function _spTrackState(track, jd) { return jd < track.jd0 ? 'before' : (jd > track.jd1 ? 'after' : 'flying'); }
function _spTrackAt(track, jd) {
  if (!track || _spTrackState(track, jd) !== 'flying') return null;
  var s = track.s, lo = 0, hi = s.length - 1;
  while (hi - lo > 1) {
    var mid = (lo + hi) >> 1;
    if (s[mid][0] <= jd) lo = mid; else hi = mid;
  }
  return _spHermite(s[lo], s[hi], jd);
}

// ── Scale ──
// Readable: planets and moons drawn SP_READABLE_BOOST times their size, and the
// moons' orbits round them by the same factor so Io stays outside Jupiter
// (a boost on one and not the other would bury the moons). Orbits round the
// Sun are always true. The factor is the largest whole number for which the
// widest moon orbit drawn (Callisto's, 1.9 million km) stays under half an AU:
// less than the gap between Mars and Jupiter, and the Sun it makes (0.18 AU)
// stays well short of Mercury (0.39 AU).
var SP_MOON_ORBIT_AU_MAX = 0.5;
var SP_READABLE_BOOST = Math.floor(SP_MOON_ORBIT_AU_MAX * AU_KM / SP_MOONS.Callisto.a);
function _spScale(mode) {
  var k = mode === 'true' ? 1 : SP_READABLE_BOOST;
  return { body: k, moon: k };
}

// ═══════════════════════════════════════════════════════════════════════
// The view
// ═══════════════════════════════════════════════════════════════════════

// ── The bodies ──
// kind: sun, planet, dwarf, moon, probe. `km` is the equatorial radius (IAU
// 2015 nominal values), `flat` its flattening, `map` the file in earth/ named
// <map>-v1.webp, `proc` a surface drawn from the body's colours when no
// public-domain map exists, `atmo` the glow of its air, `period` its year in
// days (for its orbit line). Probes come from the track table, in the order
// they launched, after these.
var SP_BODIES = [
  { key: 'Sun', kind: 'sun', km: 695700, color: '#ffd27a' },
  { key: 'Mercury', kind: 'planet', km: 2439.7, color: '#b0a090', map: 'mercury', period: 87.969 },
  { key: 'Venus', kind: 'planet', km: 6051.8, color: '#e8c87a', map: 'venus', atmo: [1, 0.82, 0.5], period: 224.701 },
  { key: 'Earth', kind: 'planet', km: 6378.137, flat: 1 / 298.257223563, color: '#4a90d9', map: 'earth', night: true, atmo: [0.35, 0.55, 1], period: 365.256 },
  { key: 'Mars', kind: 'planet', km: 3396.2, flat: 0.00589, color: '#c46040', map: 'mars', atmo: [0.9, 0.55, 0.4], period: 686.98 },
  { key: 'Jupiter', kind: 'planet', km: 71492, flat: 0.06487, color: '#c49868', map: 'jupiter', period: 4332.59 },
  { key: 'Saturn', kind: 'planet', km: 60268, flat: 0.09796, color: '#d4b878', proc: 'saturn', rings: [74500, 140220], period: 10759.22 },
  { key: 'Uranus', kind: 'planet', km: 25559, flat: 0.0229, color: '#78c8c8', proc: 'uranus', atmo: [0.5, 0.85, 0.9], period: 30688.5 },
  { key: 'Neptune', kind: 'planet', km: 24764, flat: 0.0171, color: '#3868c8', proc: 'neptune', atmo: [0.3, 0.45, 1], period: 60182 },
  { key: 'Pluto', kind: 'dwarf', km: 1188.3, color: '#c8b8a8', map: 'pluto', period: 90560 },
  { key: 'Ceres', kind: 'dwarf', km: 469.7, color: '#a09890', proc: 'rock', track: 'ceres', period: 1681.6 },
  { key: 'Moon', kind: 'moon', km: 1737.4, color: '#c8c8c8', map: 'moon' },
  { key: 'Io', kind: 'moon', km: 1821.6, color: '#e8d870', map: 'io' },
  { key: 'Europa', kind: 'moon', km: 1560.8, color: '#d8cfc0', map: 'europa' },
  { key: 'Ganymede', kind: 'moon', km: 2634.1, color: '#a8a095', proc: 'ice' },
  { key: 'Callisto', kind: 'moon', km: 2410.3, color: '#7d7468', map: 'callisto' },
  { key: 'Titan', kind: 'moon', km: 2574.7, color: '#d9a550', map: 'titan', atmo: [1, 0.65, 0.2] }
];
// The Sun's blackbody, for the colour of everything it lights.
var SP_SUN_TEMP_K = 5772;
var SP_NO_MAP = { Moon: 1 };   // drawn from the Moon's own map (app.js), not earth/<name>-v1.webp
var _spBodyIndex = null;
var _spProbeKeys = [];         // track keys of the probes, by launch
function _spBodies() {
  if (!_spBodyIndex) {
    _spBodyIndex = {};
    _spProbeKeys = Object.keys(_spTracks).filter(function (k) { return k !== 'ceres'; }).sort(function (a, b) {
      return _spTracks[a].events[0][0] - _spTracks[b].events[0][0];
    });
    SP_BODIES.forEach(function (b) { _spBodyIndex[b.key] = b; });
    _spProbeKeys.forEach(function (k) {
      _spBodyIndex[k] = { key: k, kind: 'probe', color: '#6ee7d8', track: k };
    });
  }
  return _spBodyIndex;
}
function _spBody(key) { return _spBodies()[key]; }
function _spAllKeys() { _spBodies(); return SP_BODIES.map(function (b) { return b.key; }).concat(_spProbeKeys); }

// A body's name in the reader's language: the planets, the Sun and the Moon
// already have theirs; the rest are the page's own (sp_n_<key>).
function _spName(key) {
  var b = _spBody(key);
  if (key === 'Sun') return _aeT('alm_sun');
  if (key === 'Moon') return _aeT('alm_moon');
  if (b && b.kind === 'planet') return _tp(key);
  return _aeT('sp_n_' + key.toLowerCase());
}

// The deep link of a body's encyclopedia article, if the Almanac knows one.
var SP_LINK_KEYS = { Sun: 'planet:sun', Moon: 'planet:moon' };
function _spLinkKey(key) {
  var b = _spBody(key);
  if (SP_LINK_KEYS[key]) return SP_LINK_KEYS[key];
  if (b.kind === 'probe') return 'probe:' + key;
  return (b.kind === 'planet' ? 'planet:' : 'body:') + key.toLowerCase();
}

// Where a body is at jd (AU, heliocentric ecliptic J2000), or null where it
// is not (a probe before it launched or after it ended). Moons are placed
// round their planet, with their orbits drawn `moonK` times as wide.
function _spBodyPos(key, jd, moonK) {
  var b = _spBody(key);
  if (b.track) return _spTrackAt(_spTrack(b.track), jd);
  if (b.kind === 'moon') {
    var parent = _spPlanetPos(SP_MOONS[key].planet, jd), off = _spMoonOffset(key, jd), k = moonK || 1;
    return [parent[0] + off[0] * k, parent[1] + off[1] * k, parent[2] + off[2] * k];
  }
  return _spPlanetPos(key, jd);
}
function _spParentKey(key) { var b = _spBody(key); return b.kind === 'moon' ? SP_MOONS[key].planet : null; }

// A body's axes. A moon keeps one face to its planet: x toward it, z the
// planet's pole.
function _spFrameOf(key, jd, moonK) {
  var b = _spBody(key);
  if (b.kind === 'moon') {
    var z = SP_MOONS[key].planet === 'Earth' ? [0, 0, 1] : _spPoleEcl(SP_MOONS[key].planet);
    var to = _aeScale(_spMoonOffset(key, jd), -1);
    var x = _aeNorm(_aeSub(to, _aeScale(z, _aeDot(to, z))));
    return { x: x, y: _aeCross(z, x), z: z };
  }
  if (b.kind === 'planet' || b.kind === 'dwarf') return _spBodyFrame(key, jd);
  return { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
}

// A body's size as drawn (AU) at a scale.
function _spShownRadius(key, scale) {
  var b = _spBody(key);
  if (b.kind === 'probe') return 0;
  return b.km / AU_KM * scale.body;
}

// ── Strings and numbers ──
// A calendar date of an event (a launch, a flyby): in UTC, so no time zone moves it a day.
var SP_EVENT_DATE_OPTS = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
function _spFmtDate(jd) {
  return _aeDateFormatter('sp-date-utc', SP_EVENT_DATE_OPTS).format(new Date((jd - JD_UNIX_EPOCH) * MS_PER_DAY));
}
function _spFmtSpeed(beta) {
  var kms = beta * SPEED_OF_LIGHT_KM_S;
  return _orrNum(beta, null, beta < 0.01 ? 4 : 2) + ' c · ' + _orrNum(kms, null, 0) + ' km/s';
}
// The speed slider goes by rapidity, so the last 9 hundredths of c are not a sliver.
var SP_RAPIDITY_MIN = Math.atanh(SP_MIN_BETA), SP_RAPIDITY_MAX = Math.atanh(SP_MAX_BETA);
function _spSliderToBeta(v) {
  var u = Math.min(1, Math.max(0, v / SP_BETA_STEPS));
  return Math.tanh(SP_RAPIDITY_MIN * Math.pow(SP_RAPIDITY_MAX / SP_RAPIDITY_MIN, u));
}
function _spBetaToSlider(beta) {
  var r = Math.atanh(Math.min(SP_MAX_BETA, Math.max(SP_MIN_BETA, beta)));
  return Math.round(SP_BETA_STEPS * Math.log(r / SP_RAPIDITY_MIN) / Math.log(SP_RAPIDITY_MAX / SP_RAPIDITY_MIN));
}

// ── Camera and flight numbers ──
var SP_FOV_DEG = 50;
var SP_FAR_AU = 6000;
var SP_STAR_DIST_AU = 3000;          // the star sphere, carried with the camera
var SP_MAX_DPR = 2;
var SP_STANDOFF_RADII = 6;           // a flight ends this many radii from the middle
var SP_PROBE_STANDOFF_AU = 0.004;    // and 600,000 km from a probe, which is a marker anyway
var SP_MIN_RADII = 1.6;              // the closest the camera comes, in radii
var SP_PROBE_MIN_AU = 5e-4;
var SP_MAX_DIST_AU = 500;
var SP_OVERVIEW_DIST_AU = 60;        // wide enough for Neptune and Pluto's orbits
var SP_OVERVIEW_ELEVATION = 0.55;    // radians above the ecliptic
var SP_DRAG_RAD_PER_PX = 0.006;
var SP_WHEEL_ZOOM = 0.0015;
var SP_KEY_TURN = 0.09;
var SP_KEY_ZOOM = 1.18;
var SP_TAP_SLOP_PX = 6;
var SP_TAP_RADIUS_PX = 24;
var SP_FLIGHT_BASE_S = 6, SP_FLIGHT_PER_DECADE_S = 2.5, SP_FLIGHT_MAX_S = 13;
var SP_FLIGHT_EASE = 0.08;           // the share of the time spent speeding up, and again slowing down
var SP_TIME_RATES = [0, 1, 30, 365.25];   // days a second
var SP_TIME_KEYS = ['sp_time_stopped', 'sp_time_day', 'sp_time_month', 'sp_time_year'];
var SP_IDLE_TICK_MS = 500;
var SP_AU_TO_PX_MIN = 6;             // a body smaller than this (px radius) gets a ring so it can be found
var SP_RING_FADE_PX = 16;
var SP_MARKER_PX = 15;
var SP_SELECT_RING_MAX_PX = 30;      // a body bigger than this needs no ring round it
var SP_PROBE_PX = 8;
var SP_COVER_PX = 12;                // a body this big hides what is behind it, labels too
var SP_LABEL_H = 15, SP_LABEL_CHAR_W = 6.6;
var SP_MOON_APART_PX = 26;           // a moon is named and marked once this far from its planet
var SP_STAR_SIZE_MAX = 9;
var SP_STAR_FADE_MAG = [8, 9.5];     // brightness (V mag) where a star starts to go, and is gone
var SP_ORBIT_POINTS = 360;
var SP_MOON_ORBIT_POINTS = 96;
var SP_TRAIL_SUBDIV = 3;
var SP_CAPTION_BETA = { stars: 0.25, colour: 0.45 };   // where each effect has become plain to see

// ── Styles ──
// Shares the Earth view's (.ae-*): one look. These are the ones it lacks.
var SP_CSS = [
  '.sp-chips{display:flex;gap:6px;overflow-x:auto;max-width:100%;padding:2px 2px 4px;pointer-events:auto;scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,transparent,#000 14px,#000 calc(100% - 14px),transparent);mask-image:linear-gradient(90deg,transparent,#000 14px,#000 calc(100% - 14px),transparent)}',
  '.sp-chips::-webkit-scrollbar{display:none}',
  '.sp-chips .ae-btn{flex:0 0 auto}',
  '.sp-chips .ae-btn[aria-disabled="true"]{opacity:.5}',
  '.sp-chips .sp-gap{flex:0 0 1px;background:var(--border);margin:4px 4px}',
  '.sp-speed{display:flex;align-items:center;gap:10px;width:min(560px,100%);pointer-events:auto}',
  '.sp-speed label{font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;flex:0 0 auto}',
  '.sp-speed input{flex:1;min-width:80px;accent-color:var(--amber);height:28px}',
  '.sp-speed output{flex:0 0 auto;min-width:112px;text-align:end;font-size:12px;color:var(--amber);font-variant-numeric:tabular-nums}',
  '.sp-cap{display:flex;flex-direction:column;gap:6px;align-items:center;width:min(440px,calc(100% - 32px));box-sizing:border-box;background:rgba(14,14,16,.9);border:1px solid var(--amber-border);border-radius:12px;padding:10px 14px;font-size:13px;line-height:1.45;color:var(--text);pointer-events:auto;text-align:center}',
  '.sp-cap[hidden]{display:none}',
  '.sp-cap p{margin:0}',
  '.sp-cap .sp-why{color:var(--text2);font-size:12.5px}',
  '.sp-cap-row{display:flex;gap:8px}',
  '.sp-hud{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px 12px;width:min(440px,100%);font-size:11px;color:var(--text2);text-align:center;pointer-events:none}',
  '.sp-hud b{display:block;font-size:14px;color:var(--text);font-weight:600;font-variant-numeric:tabular-nums}',
  '.sp-hud[hidden]{display:none}',
  '.sp-card .sp-line{display:block;color:var(--text2)}',
  '.sp-card .sp-kind{font-size:12px;font-weight:400;color:var(--text2);margin-inline-start:6px}',
  '.sp-view.sp-flying .sp-card,.sp-view.sp-flying .sp-chips,.sp-view.sp-flying .ae-note{display:none}',
  '.sp-card .sp-line b{color:var(--text);font-weight:500}',
  '.sp-card .sp-go{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap}',
  '.sp-card .sp-lib{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap}',
  '.sp-card .sp-lib .ae-btn{font-size:12px;padding:6px 10px;min-height:30px}',
  '.sp-fly{color:#000;background:var(--amber);border-color:var(--amber);font-weight:600}',
  '.sp-fly:focus-visible{color:#000;background:var(--amber);filter:brightness(1.1)}',
  '@media (hover:hover){.sp-fly:hover{color:#000;background:var(--amber);filter:brightness(1.1)}}',
  '.sp-label.sp-sel{color:var(--amber)}',
  '.sp-label.sp-probe{color:#8ef0e4}',
  '.sp-label.sp-moon{opacity:.8;font-size:10.5px}',
  '@media (prefers-reduced-motion: reduce){.sp-cap{transition:none}}'
].join('\n');
function _spEnsureStyles() {
  _aeEnsureStyles();
  if (_aeById('sp-style')) return;
  var st = document.createElement('style');
  st.id = 'sp-style';
  st.textContent = SP_CSS;
  document.head.appendChild(st);
}

// ── Shaders ──
// Every position the GPU draws goes through spAberr: the camera is at the
// origin, positions are relative to it (so a planet 30 AU out and a probe
// 600,000 km off are both exact), and in flight each direction is turned as
// the ship sees it. Shapes are bent the way light bends them: a sphere stays
// a sphere (a moving ship sees no squashed planets, only turned ones: the
// Terrell-Penrose effect).
var SP_GLSL_ABERR = [
  'uniform vec3 uHead; uniform float uBeta;',
  'vec3 spAberr(vec3 p) {',
  '  if (uBeta <= 0.0) return p;',
  '  float d = length(p); if (d <= 0.0) return p;',
  '  vec3 n = p / d; float c = dot(n, uHead);',
  '  float c2 = (c + uBeta) / (1.0 + uBeta * c);',
  '  vec3 side = n - uHead * c; float sl = length(side);',
  '  vec3 n2 = sl < 1e-7 ? uHead * (c2 >= 0.0 ? 1.0 : -1.0) : uHead * c2 + side * (sqrt(max(0.0, 1.0 - c2 * c2)) / sl);',
  '  return n2 * d;',
  '}'
].join('\n');
// Light brighter or dimmer by the ship's speed, kept in range: the eye (and
// the screen) adapts, so a gain of 1 is left alone and a big one saturates.
var SP_GLSL_TONE = [
  'vec3 spTone(vec3 c, vec3 tint) {',
  '  vec3 v = c * tint;',
  '  if (uBeta <= 0.0) return v;',
  '  vec3 t = (1.0 - exp(-1.4 * v)) / (1.0 - exp(-1.4));',
  '  return mix(v, t, smoothstep(0.0, 0.04, uBeta));',
  '}'
].join('\n');
var SP_VERT_BODY = [
  SP_GLSL_ABERR,
  'varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal;',
  'void main() {',
  '  vUv = uv; vLocal = position;',
  '  vec4 w = modelMatrix * vec4(position, 1.0);',
  '  vWorld = w.xyz;',
  '  vNormal = normalize(mat3(modelMatrix) * normal);',
  '  gl_Position = projectionMatrix * viewMatrix * vec4(spAberr(w.xyz), 1.0);',
  '}'
].join('\n');
var SP_FRAG_PLANET = [
  'precision highp float;',
  SP_GLSL_ABERR, SP_GLSL_TONE,
  'uniform sampler2D uMap; uniform float uHasMap; uniform sampler2D uNight; uniform float uHasNight;',
  'uniform vec3 uColor; uniform vec3 uSunDir; uniform vec3 uAtmo; uniform vec3 uTint;',
  'varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal;',
  'void main() {',
  '  vec3 n = normalize(vNormal);',
  '  float ndl = dot(n, uSunDir);',
  '  float lit = smoothstep(-0.1, 0.14, ndl);',
  '  vec3 base = uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : uColor;',
  '  vec3 col = base * (max(ndl, 0.0) * 0.96 + 0.035);',
  '  if (uHasNight > 0.5) col += texture2D(uNight, vUv).rgb * (1.0 - lit) * vec3(1.0, 0.82, 0.55) * 0.9;',
  '  float ndv = max(dot(n, normalize(-vWorld)), 0.0);',
  '  col += uAtmo * pow(1.0 - ndv, 3.0) * (0.12 + 0.88 * lit) * 0.7;',
  '  gl_FragColor = vec4(spTone(col, uTint), 1.0);',
  '}'
].join('\n');
var SP_FRAG_SUN = [
  'precision highp float;',
  SP_GLSL_ABERR, SP_GLSL_TONE,
  'uniform vec3 uLimb[6]; uniform vec3 uTint;',
  'varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal;',
  'void main() {',
  '  float mu = clamp(dot(normalize(vNormal), normalize(-vWorld)), 0.0, 1.0);',
  '  vec3 limb = vec3(0.0);',
  '  for (int k = 5; k >= 0; k--) limb = uLimb[k] + mu * limb;',
  '  gl_FragColor = vec4(spTone(vec3(1.0, 0.93, 0.8) * limb * 1.15, uTint), 1.0);',
  '}'
].join('\n');
// Saturn's rings: a radial profile (alpha in the texture's alpha), lit from
// the Sun, in the planet's shadow where the planet is between.
var SP_FRAG_RING = [
  'precision highp float;',
  SP_GLSL_ABERR, SP_GLSL_TONE,
  'uniform sampler2D uProfile; uniform float uIn; uniform float uOut; uniform vec3 uSunDir; uniform vec3 uCenter; uniform float uRadius; uniform vec3 uTint;',
  'varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal;',
  'void main() {',
  '  float r = length(vLocal.xz);',
  '  float t = (r - uIn) / (uOut - uIn);',
  '  if (t < 0.0 || t > 1.0) discard;',
  '  vec4 p = texture2D(uProfile, vec2(t, 0.5));',
  '  vec3 toC = uCenter - vWorld;',
  '  float b = dot(toC, uSunDir);',
  '  float miss = sqrt(max(0.0, dot(toC, toC) - b * b));',
  '  float shadow = (b > 0.0 && miss < uRadius) ? 0.12 : 1.0;',
  '  gl_FragColor = vec4(spTone(p.rgb * shadow, uTint), p.a);',
  '}'
].join('\n');
var SP_VERT_POINTS = [
  SP_GLSL_ABERR,
  'attribute vec3 aColor; attribute float aAlpha; attribute float aSize; attribute float aKind;',
  'uniform float dpr;',
  'varying vec3 vColor; varying float vAlpha; varying float vKind;',
  'void main() {',
  '  vColor = aColor; vAlpha = aAlpha; vKind = aKind;',
  '  gl_PointSize = aSize * dpr;',
  '  gl_Position = projectionMatrix * viewMatrix * vec4(spAberr(position), 1.0);',
  '}'
].join('\n');
// Marker kinds: 0 soft dot (stars), 1 ring (a body too small to see), 2 square (a probe),
// 3 diamond outline (the place the light shows a body), 4 glow (the flash of light).
var SP_KIND_DOT = 0, SP_KIND_RING = 1, SP_KIND_PROBE = 2, SP_KIND_GHOST = 3, SP_KIND_GLOW = 4;
var SP_FRAG_POINTS = [
  'precision mediump float;',
  'varying vec3 vColor; varying float vAlpha; varying float vKind;',
  'void main() {',
  '  vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; float a;',
  '  if (vKind < 0.5) a = 1.0 - smoothstep(0.55, 1.0, r);',
  '  else if (vKind < 1.5) a = smoothstep(0.66, 0.74, r) * (1.0 - smoothstep(0.9, 0.98, r));',
  '  else if (vKind < 2.5) { float s = max(abs(c.x), abs(c.y)) * 2.0; a = 1.0 - smoothstep(0.82, 0.95, s); }',
  '  else if (vKind < 3.5) { float d = (abs(c.x) + abs(c.y)) * 2.0; a = smoothstep(0.72, 0.8, d) * (1.0 - smoothstep(0.9, 0.98, d)); }',
  '  else a = pow(max(0.0, 1.0 - r), 2.0);',
  '  if (a <= 0.003) discard;',
  '  gl_FragColor = vec4(vColor, vAlpha * a);',
  '}'
].join('\n');
var SP_VERT_LINE = [
  SP_GLSL_ABERR,
  'void main() {',
  '  vec4 w = modelMatrix * vec4(position, 1.0);',
  '  gl_Position = projectionMatrix * viewMatrix * vec4(spAberr(w.xyz), 1.0);',
  '}'
].join('\n');
var SP_FRAG_LINE = [
  'precision mediump float;',
  'uniform vec3 uColor; uniform float uAlpha;',
  'void main() { gl_FragColor = vec4(uColor, uAlpha); }'
].join('\n');
// The Sun's glow: a camera-facing square, its middle where the (turned) Sun is.
var SP_VERT_GLOW = [
  SP_GLSL_ABERR,
  'uniform vec3 uCenter; uniform float uSize;',
  'varying vec2 vOff;',
  'void main() {',
  '  vOff = position.xy;',
  '  vec4 vc = viewMatrix * vec4(spAberr(uCenter), 1.0);',
  '  gl_Position = projectionMatrix * (vc + vec4(position.xy * uSize, 0.0, 0.0));',
  '}'
].join('\n');
var SP_FRAG_GLOW = [
  'precision mediump float;',
  'uniform vec3 uTint; uniform float uStrength;',
  'varying vec2 vOff;',
  'void main() {',
  '  float r = length(vOff);',
  '  float g = (0.5 * exp(-3.4 * r) + 0.22 / (1.0 + 14.0 * r * r)) * (1.0 - smoothstep(0.75, 1.0, r));',
  '  gl_FragColor = vec4(vec3(1.0, 0.82, 0.55) * uTint * g * uStrength, 1.0);',
  '}'
].join('\n');

// ── Surfaces drawn from colours ──
// Saturn, Uranus, Neptune, Ceres and Ganymede have no public-domain map in
// the library, so each is painted here from what it looks like: bands and a
// few clouds for the giants, speckle for the rocks and ice.
var SP_PROC = {
  saturn:  { bands: [[0.93, 0.85, 0.66], [0.82, 0.72, 0.52], [0.9, 0.8, 0.6], [0.76, 0.66, 0.48]], freq: 11, amp: 0.17 },
  uranus:  { bands: [[0.62, 0.84, 0.86], [0.58, 0.8, 0.84], [0.66, 0.87, 0.88]], freq: 5, amp: 0.05 },
  neptune: { bands: [[0.2, 0.34, 0.78], [0.25, 0.4, 0.85], [0.17, 0.3, 0.7]], freq: 8, amp: 0.1 },
  rock:    { speckle: [0.5, 0.48, 0.45], spread: 0.16 },
  ice:     { speckle: [0.62, 0.6, 0.56], spread: 0.2 }
};
var SP_PROC_SIZE = [256, 128];
// Value noise from the orrery's seeded generator: the same picture every time.
function _spProcCanvas(kind) {
  var spec = SP_PROC[kind], w = SP_PROC_SIZE[0], h = SP_PROC_SIZE[1];
  var cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  var g = cv.getContext('2d'), img = g.createImageData(w, h), rnd = _lcgRand(kind.length * 7919 + kind.charCodeAt(0));
  var cell = [], i;
  for (i = 0; i < 64 * 32; i++) cell.push(rnd());
  function noise(x, y) {   // smooth, wrapping in x
    var fx = x * 64, fy = y * 32, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    function v(a, b) { return cell[((b + 32) % 32) * 64 + ((a + 64) % 64)]; }
    var sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) + (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
  }
  for (var y = 0; y < h; y++) {
    var lat = y / (h - 1);
    for (var x = 0; x < w; x++) {
      var u = x / w, c;
      if (spec.bands) {
        var pos = lat * spec.freq + noise(u * 3, lat * 2) * 0.35, i0 = Math.floor(pos), f = pos - i0;
        f = f * f * (3 - 2 * f);
        var c0 = spec.bands[i0 % spec.bands.length], c1 = spec.bands[(i0 + 1) % spec.bands.length];
        var n = (noise(u * 2, lat * 40) - 0.5) * spec.amp;
        c = [c0[0] + (c1[0] - c0[0]) * f + n, c0[1] + (c1[1] - c0[1]) * f + n, c0[2] + (c1[2] - c0[2]) * f + n];
      } else {
        var s = noise(u * 5, lat * 5) * 0.5 + noise(u * 20, lat * 20) * 0.35 + noise(u * 60, lat * 60) * 0.15 - 0.5;
        c = [spec.speckle[0] + s * spec.spread, spec.speckle[1] + s * spec.spread, spec.speckle[2] + s * spec.spread];
      }
      var p = (y * w + x) * 4;
      img.data[p] = Math.max(0, Math.min(255, c[0] * 255));
      img.data[p + 1] = Math.max(0, Math.min(255, c[1] * 255));
      img.data[p + 2] = Math.max(0, Math.min(255, c[2] * 255));
      img.data[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}
// Saturn's rings, from the planet outward (km from its centre): alpha 0..1 and
// a brightness. The C ring is faint, the B ring bright, the Cassini Division
// nearly empty, the A ring in between with the Encke gap near its edge.
var SP_RING_PROFILE = [
  [74500, 92000, 0.12, 0.55], [92000, 117500, 0.82, 0.95], [117500, 122200, 0.05, 0.6],
  [122200, 133300, 0.55, 0.85], [133300, 133700, 0.06, 0.6], [133700, 136800, 0.5, 0.8], [136800, 140220, 0.07, 0.6]
];
function _spRingCanvas() {
  var w = 256, cv = document.createElement('canvas');
  cv.width = w; cv.height = 1;
  var g = cv.getContext('2d'), lo = SP_RING_PROFILE[0][0], hi = SP_RING_PROFILE[SP_RING_PROFILE.length - 1][1];
  for (var x = 0; x < w; x++) {
    var km = lo + (hi - lo) * (x + 0.5) / w, row = SP_RING_PROFILE[SP_RING_PROFILE.length - 1];
    for (var i = 0; i < SP_RING_PROFILE.length; i++) if (km < SP_RING_PROFILE[i][1]) { row = SP_RING_PROFILE[i]; break; }
    var ripple = 0.88 + 0.12 * Math.sin(km / 160);
    var b = row[3] * ripple;
    g.fillStyle = 'rgba(' + Math.round(235 * b) + ',' + Math.round(215 * b) + ',' + Math.round(180 * b) + ',' + (row[2] * ripple).toFixed(3) + ')';
    g.fillRect(x, 0, 1, 1);
  }
  return cv;
}
function _spLoadTextureUrl(THREE, url) {
  return new Promise(function (resolve, reject) { new THREE.TextureLoader().load(url, resolve, undefined, reject); });
}

// ── The scene ──
var SP_THREE_DOUBLE_SIDE = 2;       // three's DoubleSide, not exported by name by the tree-shaken build
var SP_SPHERE_SEGMENTS = [64, 32];
var SP_BIG_SPHERE_SEGMENTS = [96, 48];
var SP_RING_SEGMENTS = 160;
var SP_ORBIT_COLOR = [0.55, 0.62, 0.78], SP_ORBIT_ALPHA = 0.28;
var SP_TRAIL_COLOR = [0.43, 0.9, 0.85], SP_TRAIL_PAST_ALPHA = 0.7, SP_TRAIL_FUTURE_ALPHA = 0.22;
var SP_MOON_ORBIT_ALPHA = 0.22;
var SP_STAR_CAPACITY = 9200;
var SP_MARKER_CAPACITY = 80;

function _spUniformsAber() { return { uHead: { value: null }, uBeta: { value: 0 } }; }

function _spLineMaterial(THREE, ab, rgb, alpha) {
  return new THREE.ShaderMaterial({
    uniforms: { uHead: ab.uHead, uBeta: ab.uBeta, uColor: { value: new THREE.Vector3(rgb[0], rgb[1], rgb[2]) }, uAlpha: { value: alpha } },
    vertexShader: SP_VERT_LINE, fragmentShader: SP_FRAG_LINE, transparent: true, depthWrite: false
  });
}
function _spLine(THREE, Kind, mat, count) {
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  var line = new Kind(g, mat);
  line.frustumCulled = false;
  line.renderOrder = 1;
  return line;
}
function _spPointsObject(THREE, ab, capacity, dpr, additive) {
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(capacity), 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(capacity), 1));
  g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(capacity), 1));
  g.setDrawRange(0, 0);
  var m = new THREE.ShaderMaterial({
    uniforms: { uHead: ab.uHead, uBeta: ab.uBeta, dpr: { value: dpr } },
    vertexShader: SP_VERT_POINTS, fragmentShader: SP_FRAG_POINTS, transparent: true, depthWrite: false, depthTest: false
  });
  if (additive) m.blending = THREE.AdditiveBlending;
  var p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}
function _spSetMarker(cloud, i, pos, rgb, alpha, size, kind) {
  var a = cloud.geometry.attributes;
  a.position.array[i * 3] = pos[0]; a.position.array[i * 3 + 1] = pos[1]; a.position.array[i * 3 + 2] = pos[2];
  a.aColor.array[i * 3] = rgb[0]; a.aColor.array[i * 3 + 1] = rgb[1]; a.aColor.array[i * 3 + 2] = rgb[2];
  a.aAlpha.array[i] = alpha; a.aSize.array[i] = size; a.aKind.array[i] = kind;
}
function _spCommitMarkers(cloud, count) {
  var a = cloud.geometry.attributes;
  a.position.needsUpdate = a.aColor.needsUpdate = a.aAlpha.needsUpdate = a.aSize.needsUpdate = a.aKind.needsUpdate = true;
  cloud.geometry.setDrawRange(0, count);
}
function _spHexRGB(hex) {
  var n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

// A ring's geometry (a flat annulus in the xz plane, in planet radii), by hand:
// the tree-shaken three has no RingGeometry.
function _spRingGeometry(THREE, rin, rout, segs) {
  var pos = new Float32Array((segs + 1) * 2 * 3), idx = [];
  for (var i = 0; i <= segs; i++) {
    var a = i / segs * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.set([c * rin, 0, s * rin, c * rout, 0, s * rout], i * 6);
    if (i < segs) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
function _spQuadGeometry(THREE) {
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
function _spCircle(THREE, segs) {
  var g = new THREE.BufferGeometry(), pos = new Float32Array(segs * 3);
  for (var i = 0; i < segs; i++) pos.set([Math.cos(i / segs * Math.PI * 2), Math.sin(i / segs * Math.PI * 2), 0], i * 3);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

// Build the three.js scene. Null if WebGL is not available.
function _spBuildGl(THREE, canvas, tracks) {
  var renderer, dpr = Math.min(window.devicePixelRatio || 1, SP_MAX_DPR);
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: dpr < AE_MSAA_BELOW_DPR, powerPreference: 'high-performance' });
  } catch (e) {
    return null;
  }
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 1);
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(SP_FOV_DEG, 1, 1e-6, SP_FAR_AU);
  camera.up.set(0, 0, 1);
  var ab = _spUniformsAber();
  ab.uHead.value = new THREE.Vector3(0, 0, -1);
  var S = {
    THREE: THREE, renderer: renderer, scene: scene, camera: camera, dpr: dpr, ab: ab, items: {}, maps: {},
    basis: new THREE.Matrix4(), v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(),
    starAb: _spUniformsAber(), orbits: {}, trails: {}, moonRings: {}
  };
  S.starAb.uHead.value = new THREE.Vector3(0, 0, -1);

  // The stars, turned and coloured on the CPU each time the speed or heading changes.
  S.stars = _spPointsObject(THREE, S.starAb, SP_STAR_CAPACITY, dpr, true);
  S.stars.renderOrder = -10;
  scene.add(S.stars);

  var limb = SUN_LIMB_POLY[0].map(function (_, k) { return new THREE.Vector3(SUN_LIMB_POLY[0][k], SUN_LIMB_POLY[1][k], SUN_LIMB_POLY[2][k]); });
  SP_BODIES.concat(Object.keys(tracks).filter(function (k) { return k !== 'ceres'; }).map(function (k) { return _spBody(k); })).forEach(function (b) {
    var it = S.items[b.key] = { body: b, mesh: null, uni: null };
    if (b.kind === 'probe') return;
    var segs = b.kind === 'planet' || b.kind === 'sun' ? SP_BIG_SPHERE_SEGMENTS : SP_SPHERE_SEGMENTS;
    var uni = {
      uHead: ab.uHead, uBeta: ab.uBeta, uTint: { value: new THREE.Vector3(1, 1, 1) }, uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uMap: { value: null }, uHasMap: { value: 0 }, uNight: { value: null }, uHasNight: { value: 0 },
      uColor: { value: new THREE.Vector3().fromArray(_spHexRGB(b.color)) },
      uAtmo: { value: new THREE.Vector3().fromArray(b.atmo || [0, 0, 0]) }
    };
    var mat;
    if (b.kind === 'sun') {
      uni.uLimb = { value: limb };
      mat = new THREE.ShaderMaterial({ uniforms: uni, vertexShader: SP_VERT_BODY, fragmentShader: SP_FRAG_SUN });
    } else {
      mat = new THREE.ShaderMaterial({ uniforms: uni, vertexShader: SP_VERT_BODY, fragmentShader: SP_FRAG_PLANET });
    }
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segs[0], segs[1]), mat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    it.mesh = mesh; it.uni = uni;
    if (b.rings) {
      var rUni = {
        uHead: ab.uHead, uBeta: ab.uBeta, uTint: uni.uTint, uSunDir: uni.uSunDir, uProfile: { value: null },
        uIn: { value: b.rings[0] / b.km }, uOut: { value: b.rings[1] / b.km }, uCenter: { value: new THREE.Vector3() }, uRadius: { value: 1 }
      };
      var ring = new THREE.Mesh(_spRingGeometry(THREE, b.rings[0] / b.km, b.rings[1] / b.km, SP_RING_SEGMENTS), new THREE.ShaderMaterial({
        uniforms: rUni, vertexShader: SP_VERT_BODY, fragmentShader: SP_FRAG_RING, transparent: true, depthWrite: false, side: SP_THREE_DOUBLE_SIDE
      }));
      ring.matrixAutoUpdate = false;
      ring.frustumCulled = false;
      ring.renderOrder = 3;
      scene.add(ring);
      it.ring = ring; it.ringUni = rUni;
    }
  });

  // The Sun's glow.
  var glowUni = { uHead: ab.uHead, uBeta: ab.uBeta, uCenter: { value: new THREE.Vector3() }, uSize: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uStrength: { value: 1 } };
  S.glow = new THREE.Mesh(_spQuadGeometry(THREE), new THREE.ShaderMaterial({
    uniforms: glowUni, vertexShader: SP_VERT_GLOW, fragmentShader: SP_FRAG_GLOW, transparent: true, depthWrite: false
  }));
  S.glow.material.blending = THREE.AdditiveBlending;
  S.glow.frustumCulled = false;
  S.glow.renderOrder = 4;
  S.glowUni = glowUni;
  scene.add(S.glow);

  // Orbit lines round the Sun for the planets, Pluto and Ceres; circles round
  // each planet for its big moons; the path of every probe, solid so far and
  // faint where it has still to go.
  var orbitMat = _spLineMaterial(THREE, ab, SP_ORBIT_COLOR, SP_ORBIT_ALPHA);
  S.orbitMat = orbitMat;
  SP_BODIES.forEach(function (b) {
    if (!b.period) return;
    var line = _spLine(THREE, THREE.LineLoop, orbitMat, SP_ORBIT_POINTS);
    scene.add(line);
    S.orbits[b.key] = { line: line, at: null };
  });
  var moonMat = _spLineMaterial(THREE, ab, SP_ORBIT_COLOR, SP_MOON_ORBIT_ALPHA);
  var circle = _spCircle(THREE, SP_MOON_ORBIT_POINTS);
  Object.keys(SP_MOONS).forEach(function (k) {
    var ring = new THREE.LineLoop(circle, moonMat);
    ring.matrixAutoUpdate = false;
    ring.frustumCulled = false;
    ring.renderOrder = 1;
    scene.add(ring);
    S.moonRings[k] = ring;
  });
  S.moonMat = moonMat;
  var pastMat = _spLineMaterial(THREE, ab, SP_TRAIL_COLOR, SP_TRAIL_PAST_ALPHA);
  var futureMat = _spLineMaterial(THREE, ab, SP_TRAIL_COLOR, SP_TRAIL_FUTURE_ALPHA);
  S.trailMats = [pastMat, futureMat];
  Object.keys(tracks).forEach(function (k) {
    if (k === 'ceres') return;
    var path = _spTrailPath(tracks[k]);
    var past = new THREE.BufferGeometry(), future = new THREE.BufferGeometry();
    var attr = new THREE.BufferAttribute(path, 3);
    past.setAttribute('position', attr); future.setAttribute('position', attr);
    var a = new THREE.Line(past, pastMat), b = new THREE.Line(future, futureMat);
    a.frustumCulled = b.frustumCulled = false;
    a.renderOrder = b.renderOrder = 1;
    scene.add(a); scene.add(b);
    S.trails[k] = { past: a, future: b, count: path.length / 3 };
  });

  S.markers = _spPointsObject(THREE, ab, SP_MARKER_CAPACITY, dpr, false);
  S.markers.renderOrder = 10;
  scene.add(S.markers);
  return S;
}

// A probe's whole path as a polyline: the table's samples with a few Hermite
// points between each pair, so a flyby bends smoothly.
function _spTrailPath(track) {
  var s = track.s, n = (s.length - 1) * SP_TRAIL_SUBDIV + 1, out = new Float32Array(n * 3), k = 0;
  for (var i = 0; i < s.length - 1; i++) {
    for (var j = 0; j < SP_TRAIL_SUBDIV; j++) {
      var p = _spHermite(s[i], s[i + 1], s[i][0] + (s[i + 1][0] - s[i][0]) * j / SP_TRAIL_SUBDIV);
      out[k++] = p[0]; out[k++] = p[1]; out[k++] = p[2];
    }
  }
  var last = s[s.length - 1];
  out[k++] = last[1]; out[k++] = last[2]; out[k++] = last[3];
  return out;
}
// The index in a trail of the moment jd (fractional), by the same sampling.
function _spTrailIndex(track, jd) {
  var s = track.s, lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (s[mid][0] <= jd) lo = mid; else hi = mid; }
  var f = (jd - s[lo][0]) / (s[hi][0] - s[lo][0]);
  return (lo + Math.min(1, Math.max(0, f))) * SP_TRAIL_SUBDIV;
}

// ── Maps ──
// A map is fetched the first time a flight is asked for (or the view opens
// with a body in view), uploaded when it lands, and the picture drawn again.
// A body whose map fails keeps its colour. Procedural surfaces are drawn once.
function _spMapUrl(b) {
  if (b.map === 'moon') return AE_TEX_MOON;
  if (b.map === 'earth') return AE_TEX_DAY;
  return SP_MAP_URL + b.map + SP_MAP_EXT;
}
function _spApplyTexture(S, it, tx, uniKey, flagKey) {
  tx.anisotropy = Math.min(8, S.renderer.capabilities.getMaxAnisotropy());
  it.uni[uniKey].value = tx;
  it.uni[flagKey].value = 1;
  _sp.dirty = true;
  _spKick();
}
function _spLoadMaps(S) {
  var THREE = S.THREE;
  Object.keys(S.items).forEach(function (k) {
    var it = S.items[k], b = it.body;
    if (!it.mesh || it.mapsRequested) return;
    it.mapsRequested = true;
    var url = b.map && _spMapUrl(b);
    if (b.proc) url = _spProcCanvas(b.proc).toDataURL('image/png');
    if (url) _spLoadTextureUrl(THREE, url).then(function (tx) { if (_sp.gl === S) _spApplyTexture(S, it, tx, 'uMap', 'uHasMap'); }, function () {});
    if (b.night) _spLoadTextureUrl(THREE, AE_TEX_NIGHT).then(function (tx) { if (_sp.gl === S) _spApplyTexture(S, it, tx, 'uNight', 'uHasNight'); }, function () {});
    if (b.rings) _spLoadTextureUrl(THREE, _spRingCanvas().toDataURL('image/png')).then(function (tx) {
      if (_sp.gl !== S) return;
      it.ringUni.uProfile.value = tx; _sp.dirty = true; _spKick();
    }, function () {});
  });
  if (!S.starsLoading && !S.starsLoaded) {
    S.starsLoading = true;
    fetch(AE_STARS_URL).then(function (r) { if (!r.ok) throw new Error('stars'); return r.arrayBuffer(); }).then(function (buf) {
      var stars = _aeDecodeStars(buf);
      if (!stars || _sp.gl !== S) throw new Error('stars');
      _spSetStars(S, stars);
    }).catch(function () {}).then(function () { S.starsLoading = false; });
  }
}

// The star list: the unit direction in the ecliptic frame, the temperature
// from B-V, and the magnitude. The first sky is the Almanac's 518 brightest.
function _spSetStars(S, list) {
  var n = Math.min(list.count, SP_STAR_CAPACITY), dirs = new Float32Array(n * 3), temp = new Float32Array(n), mag = new Float32Array(n), s = {};
  for (var i = 0; i < n; i++) {
    list.at(i, s);
    var d = _spStarDir(s.ra, s.dec);
    dirs[i * 3] = d[0]; dirs[i * 3 + 1] = d[1]; dirs[i * 3 + 2] = d[2];
    temp[i] = _spStarTemp(s.ci);
    mag[i] = s.mag;
  }
  S.starData = { n: n, dirs: dirs, temp: temp, mag: mag };
  S.starsLoaded = list.count > 600;
  S.starsKey = null;
  _sp.dirty = true;
  _spKick();
}
// Turn and colour the stars as the ship (speed beta, heading head) sees them.
// At rest this is the sky as it is. Ahead of the ship the light of a star is
// bluer and brighter (D > 1), behind it redder and dimmer.
function _spShadeStars(S, beta, head) {
  var sd = S.starData;
  if (!sd) return;
  var key = beta.toFixed(5) + '|' + (beta > 0 ? head.map(function (v) { return v.toFixed(5); }).join() : '');
  if (S.starsKey === key) return;
  S.starsKey = key;
  var cloud = S.stars, gamma = _lorentzFactor(beta), n = sd.n, hx = head[0], hy = head[1], hz = head[2];
  var R = SP_STAR_DIST_AU, i, p = [0, 0, 0], rgb;
  for (i = 0; i < n; i++) {
    var dx = sd.dirs[i * 3], dy = sd.dirs[i * 3 + 1], dz = sd.dirs[i * 3 + 2];
    var c = dx * hx + dy * hy + dz * hz, T = sd.temp[i], m = sd.mag[i], Tn = T;
    if (beta > 0) {
      var D = gamma * (1 + beta * c);
      Tn = D * T;
      m -= 2.5 * Math.log10(Math.max(1e-6, _spBeamGain(D, T)));
      var c2 = (c + beta) / (1 + beta * c);
      var sx = dx - hx * c, sy = dy - hy * c, sz = dz - hz * c, sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
      var k = sl < 1e-9 ? 0 : Math.sqrt(Math.max(0, 1 - c2 * c2)) / sl;
      p[0] = hx * c2 + sx * k; p[1] = hy * c2 + sy * k; p[2] = hz * c2 + sz * k;
    } else { p[0] = dx; p[1] = dy; p[2] = dz; }
    rgb = _spBlackbodyRGB(Tn);
    var alpha = _aeClamp(AE_STAR_ALPHA0 - AE_STAR_ALPHA_PER_MAG * m, 0, 1) * _aeClamp((SP_STAR_FADE_MAG[1] - m) / (SP_STAR_FADE_MAG[1] - SP_STAR_FADE_MAG[0]), 0, 1);
    var size = _aeClamp(AE_STAR_SIZE0 - AE_STAR_SIZE_PER_MAG * m, AE_STAR_SIZE_MIN, SP_STAR_SIZE_MAX);
    _spSetMarker(cloud, i, [p[0] * R, p[1] * R, p[2] * R], rgb, alpha, size, SP_KIND_DOT);
  }
  _spCommitMarkers(cloud, n);
}

