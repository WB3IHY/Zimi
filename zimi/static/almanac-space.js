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
var SP_DAY_MS = 86400000;
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
  return _aeNorm(_aeAdd(_aeScale(v, c2), _aeScale(side, s2 / sideLen)));
}
function _aeAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

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
// The place to fly to is where the body will be when the ship gets there.
function _spIntercept(posAt, from, beta, jd0) {
  var days = 0, pos = posAt(jd0), d = _aeLen(_aeSub(pos, from));
  for (var i = 0; i < 12; i++) {
    days = _spTrip(d, beta).earthSec / SECONDS_PER_DAY;
    pos = posAt(jd0 + days);
    d = _aeLen(_aeSub(pos, from));
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
    x = _aeAdd(_aeScale(node, Math.cos(w)), _aeScale(perp, Math.sin(w)));
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
  return _aeAdd(_aeScale(x, r2 * Math.cos(lam)), _aeScale(y, r2 * Math.sin(lam)));
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
