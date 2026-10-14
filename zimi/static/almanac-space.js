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
// Loaded with the other almanac modules (they share one global scope), and only
// when the pill under the orrery is first pressed (almanac.js _almOpenSpace); the
// heavy parts (three.js, the maps, the probe table) load once the view opens.
// window.openAlmanacSpace() is the entry point. The pure functions below take and return plain numbers
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
  var cruiseLag = _timeDilationLag(1, beta);   // lag per unit of cruise way (the orrery's)
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
// A planet or Pluto, or the Sun: heliocentric AU, J2000 ecliptic. Jupiter to
// Pluto come from the shipped Horizons table over 1970-2050, the same table the
// probes are in, so a flyby is where it was; elsewhere, and for the inner planets,
// from the orrery's elements. The Earth's elements are the Earth-Moon barycentre's:
// 4700 km, 3e-5 AU, off the Earth.
function _spPlanetPos(name, jd) {
  if (name === 'Sun') return [0, 0, 0];
  var tracked = _spTrackAt(_spPlanetTracks[name], jd);
  if (tracked) return tracked;
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
var _spPlanetTracks = {};   // Jupiter, Saturn, Uranus, Neptune, Pluto over 1970-2050, from the same Horizons table
function _spSetTracks(json) {
  _spTracks = json && json.tracks ? json.tracks : {};
  _spPlanetTracks = json && json.planets ? json.planets : {};
}
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
// Readable: planets and moons drawn up to SP_READABLE_BOOST times their size, and
// the moons' orbits round them by the same factor so Io stays outside Jupiter
// (a boost on one and not the other would bury the moons). Orbits round the Sun are
// always true, and so are the places of the probes. The factor is the largest whole
// number for which the widest moon orbit drawn (Callisto's, 1.9 million km) stays
// under half an AU: less than the gap between Mars and Jupiter, and the Sun it makes
// (0.18 AU) stays well short of Mercury (0.39 AU).
//
// A body is never inflated so far that a probe near it ends up inside it: where a
// spacecraft flies, the body is drawn only as big as keeps it SP_CLEAR_FRACTION of
// the probe's true distance (Parker near the Sun draws it 7 times, Juno at Jupiter
// 25 times), and the moons' orbits round a planet stay outside the probe too.
var SP_MOON_ORBIT_AU_MAX = 0.5;
var SP_READABLE_BOOST = Math.floor(SP_MOON_ORBIT_AU_MAX * AU_KM / SP_MOONS.Callisto.a);
var SP_CLEAR_FRACTION = 0.8;       // of a probe's distance, the most a body (or its moons' orbits) is drawn out to
var SP_MOON_CLEARANCE = 1.5;       // a moon's orbit is drawn at least this far outside its planet's drawn edge
var SP_SCALED_KEYS = ['Sun', 'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'Ceres'];

// The true distance (AU) from each body to the nearest spacecraft flying at jd.
function _spNearestProbeAU(jd) {
  var near = {};
  Object.keys(_spTracks).forEach(function (pk) {
    if (pk === 'ceres') return;
    var p = _spTrackAt(_spTracks[pk], jd);
    if (!p) return;
    SP_SCALED_KEYS.forEach(function (k) {
      var pos = k === 'Ceres' ? _spTrackAt(_spTracks.ceres, jd) : _spPlanetPos(k, jd);
      if (!pos) return;
      var d = _aeLen(_aeSub(p, pos));
      if (near[k] === undefined || d < near[k]) near[k] = d;
    });
  });
  return near;
}
// The scale at jd: body(key) is the factor a body's size is drawn at, moon(planet)
// the factor its moons' orbits (and the moons' sizes) are drawn at.
function _spScale(mode, jd) {
  var one = function () { return 1; };
  if (mode === 'true') return { mode: mode, body: one, moon: one };
  var near = jd === undefined ? {} : _spNearestProbeAU(jd);
  function cap(d, rAU) {
    return d === undefined ? SP_READABLE_BOOST : Math.max(1, Math.min(SP_READABLE_BOOST, Math.floor(SP_CLEAR_FRACTION * d / rAU)));
  }
  function planetFactor(key) {
    var km = key === 'Sun' ? 695700 : (SP_RADIUS_KM[key] || 1);
    return cap(near[key], km / AU_KM);
  }
  function moonFactor(planet) {
    var moons = Object.keys(SP_MOONS).filter(function (m) { return SP_MOONS[m].planet === planet; });
    if (!moons.length) return 1;
    var aMax = 0, aMin = Infinity;
    moons.forEach(function (m) { aMax = Math.max(aMax, SP_MOONS[m].a); aMin = Math.min(aMin, SP_MOONS[m].a); });
    var outward = cap(near[planet], aMax / AU_KM);   // stays outside a probe near the planet
    var inward = Math.ceil(SP_MOON_CLEARANCE * planetFactor(planet) * (SP_RADIUS_KM[planet] || 1) / aMin);   // and outside the planet
    return Math.max(1, outward, inward);
  }
  var moonCache = {};
  var moon = function (planet) { return moonCache[planet] || (moonCache[planet] = moonFactor(planet)); };
  return {
    mode: mode, moon: moon,
    body: function (key) { return SP_MOONS[key] ? moon(SP_MOONS[key].planet) : planetFactor(key); }
  };
}

// ── Numbers for the page's text ──
// Every figure the page prints (how far, how long the light takes, how long the
// trip) is the true one: the drawn places of the moons, ×39 on their orbits, are
// for drawing only. A trip is measured from where the ship is to where the body
// will be, stopping SP_STANDOFF_RADII of the body's own radii short of it (the
// same at either scale, so the figure does not move when the scale does).
var SP_RADIUS_KM = {
  Mercury: 2439.7, Venus: 6051.8, Earth: 6378.137, Mars: 3396.2, Jupiter: 71492, Saturn: 60268, Uranus: 25559,
  Neptune: 24764, Pluto: 1188.3, Ceres: 469.7
};
function _spTrueRadiusAU(key) {
  var b = SP_MOONS[key] ? SP_MOONS[key].r : (key === 'Sun' ? 695700 : SP_RADIUS_KM[key]);
  return b ? b / AU_KM : 0;
}
function _spTrueStandoffAU(key) {
  return _spTrueRadiusAU(key) ? SP_STANDOFF_RADII * _spTrueRadiusAU(key) : SP_PROBE_STANDOFF_AU;
}
// The true distance (AU) between two bodies at jd, or null if either is not there.
function _spTrueDistAU(aKey, bKey, jd) {
  var a = _spBodyPos(aKey, jd), b = _spBodyPos(bKey, jd);
  return a && b ? _aeLen(_aeSub(a, b)) : null;
}
// A trip at speed beta from where the ship is (at body `fromKey`) to body `key`:
// how far, the light's time, the trip on the two clocks, when it arrives, and whether
// the body is still there then (a probe's table ends).
function _spTripBetween(fromKey, key, jd, beta) {
  var from = _spBodyPos(fromKey, jd), now = _spBodyPos(key, jd);
  if (!from || !now) return null;
  var posAt = function (j) { return _spBodyPos(key, j) || now; };
  var hit = _spIntercept(posAt, from, beta, jd, _spTrueStandoffAU(key));
  var d = _aeLen(_aeSub(now, from));
  return {
    distAU: d, lightSec: _lightDelaySeconds(d), legAU: hit.distAU, earthSec: hit.trip.earthSec, shipSec: hit.trip.shipSec,
    arriveJd: hit.arriveJd, arrivePos: hit.pos, reachable: !!_spBodyPos(key, hit.arriveJd)
  };
}

// ── The moment, in UTC ──
// The page's clock and every event's date are shown in one zone, UTC: a flyby is
// "Aug 25, 1989" for everyone, whatever their clock says.
var SP_WHEN_OPTS = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC', timeZoneName: 'short' };
function _spFmtWhen(jd) {
  return _aeDateFormatter('sp-when-utc', SP_WHEN_OPTS).format(new Date((jd - JD_UNIX_EPOCH) * MS_PER_DAY));
}

// ── The overview's layout ──
// The whole system cannot be drawn to scale on a phone: Neptune is 30 AU out and Mercury
// 0.39, so in a 390 px width the inner planets would share 10 px. The overview draws
// distance as order instead: a body at r AU is shown at K ln(1 + r / R0), which puts
// Mercury to Pluto (and Voyager 1) on rings of their own, the way a flight time grows.
// It is a layout of the picture only, blended in and out (lam, 0 to 1) as the camera
// goes in: every number on the page is the true one, and a flight is flown in true space.
var SP_LAYOUT_K = 1.5, SP_LAYOUT_R0 = 0.15;
function _spLayoutMap(p, lam) {
  var r = _aeLen(p);
  if (!lam || r < 1e-9) return p;
  var f = SP_LAYOUT_K * Math.log(1 + r / SP_LAYOUT_R0) / r;
  var m = 1 - lam + lam * f;
  return [p[0] * m, p[1] * m, p[2] * m];
}
// A body's place in the picture: a moon keeps its true offset (drawn wider by the scale) round its planet's laid-out place.
function _spDisplayAt(key, abs, jd, lam) {
  if (!lam) return abs;
  if (SP_MOONS[key]) {
    var par = _spPlanetPos(SP_MOONS[key].planet, jd), mp = _spLayoutMap(par, lam);
    return [mp[0] + abs[0] - par[0], mp[1] + abs[1] - par[1], mp[2] + abs[2] - par[2]];
  }
  return _spLayoutMap(abs, lam);
}

// ── Which body a tap meant ──
// `items` are what the last frame drew: key, kind, parent (a moon's planet), the
// screen place and the radius in pixels. The nearest centre within reach wins; a
// moon beside its planet loses to it unless the planet is big on the screen (the
// person has zoomed in on it).
var SP_TAP_RADIUS_PX = 24;
var SP_ZOOMED_PX = 60;
function _spPick(items, x, y) {
  var reached = items.filter(function (p) { return Math.hypot(p.x - x, p.y - y) <= Math.max(p.rpx, SP_TAP_RADIUS_PX); });
  var planetsHit = {};
  reached.forEach(function (p) { if (p.kind !== 'moon') planetsHit[p.key] = p; });
  var best = null, bestD = Infinity;
  reached.forEach(function (p) {
    var parent = p.kind === 'moon' ? planetsHit[p.parent] : null;
    if (parent && parent.rpx < SP_ZOOMED_PX) return;
    var d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD || (d === bestD && best && p.rpx < best.rpx)) { best = p; bestD = d; }
  });
  return best ? best.key : null;
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
  { key: 'Ganymede', kind: 'moon', km: 2634.1, color: '#a8a095', map: 'ganymede' },
  { key: 'Callisto', kind: 'moon', km: 2410.3, color: '#7d7468', map: 'callisto' },
  { key: 'Titan', kind: 'moon', km: 2574.7, color: '#d9a550', map: 'titan', atmo: [1, 0.65, 0.2] }
];
// The Sun's blackbody, for the colour of everything it lights.
var SP_SUN_TEMP_K = 5772;
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
// is not (a probe before it launched or after it ended). Without a scale this is
// the true place, the one every number is made from; with one (_spScale) the
// moons are placed round their planet with their orbits drawn that much wider,
// for drawing only.
function _spBodyPos(key, jd, scale) {
  var b = _spBody(key);
  if (b.track) return _spTrackAt(_spTrack(b.track), jd);
  if (b.kind === 'moon') {
    var parent = _spPlanetPos(SP_MOONS[key].planet, jd), off = _spMoonOffset(key, jd), k = scale ? scale.moon(SP_MOONS[key].planet) : 1;
    return [parent[0] + off[0] * k, parent[1] + off[1] * k, parent[2] + off[2] * k];
  }
  return _spPlanetPos(key, jd);
}
function _spParentKey(key) { var b = _spBody(key); return b.kind === 'moon' ? SP_MOONS[key].planet : null; }

// A body's axes. A moon keeps one face to its planet: x toward it, z the
// planet's pole.
function _spFrameOf(key, jd) {
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
  return b.km / AU_KM * scale.body(key);
}

// ── Strings and numbers ──
// A calendar date of an event (a launch, a flyby): in UTC, so no time zone moves it a day.
var SP_EVENT_DATE_OPTS = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
function _spFmtDate(jd) {
  return _aeDateFormatter('sp-date-utc', SP_EVENT_DATE_OPTS).format(new Date((jd - JD_UNIX_EPOCH) * MS_PER_DAY));
}
// A speed in km/s, the unit in the reader's language ("км/с") where Intl has it.
function _spFmtKmS(kms) {
  try {
    return _orrFormatter('km-s', function (lang) { return new Intl.NumberFormat(lang, { style: 'unit', unit: 'kilometer-per-second', unitDisplay: 'short', maximumFractionDigits: 0 }); }).format(kms);
  } catch (e) { return _orrNum(kms, null, 0) + ' km/s'; }
}
function _spFmtSpeed(beta) {
  var kms = beta * SPEED_OF_LIGHT_KM_S;
  // Isolated left-to-right: inside right-to-left text the bidi algorithm would reorder "0.70 c · 209,253 km/s".
  return AE_LTR_ISOLATE + _orrNum(beta, null, beta < 0.01 ? 4 : 2) + ' c · ' + _spFmtKmS(kms) + AE_POP_ISOLATE;
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
var SP_OVERVIEW_DIST_AU = 46;        // in the laid-out picture's units: wide enough for Voyager 1 on a phone's width
var SP_OVERVIEW_ELEVATION = 1.1;     // radians above the ecliptic: nearly overhead, so the rings are round
var SP_START_AZIMUTH = -2.0;         // where the overview first looks from (radians round the ecliptic)
var SP_LAYOUT_MS = 900;              // the picture's layout blends in and out over this
var SP_LAYOUT_ZOOM_OFF = 14;         // zoom in past this many units and the layout gives way to true places
var SP_DRAG_RAD_PER_PX = 0.006;
var SP_WHEEL_ZOOM = 0.0015;
var SP_KEY_TURN = 0.09;
var SP_KEY_ZOOM = 1.18;
var SP_TAP_SLOP_PX = 6;
var SP_FLIGHT_BASE_S = 6, SP_FLIGHT_PER_DECADE_S = 2.5, SP_FLIGHT_MAX_S = 13;
var SP_TIME_RATES = [0, 1, 30, 365.25];   // days a second
var SP_TIME_KEYS = ['sp_time_stopped', 'sp_time_day', 'sp_time_month', 'sp_time_year'];
var SP_AU_TO_PX_MIN = 6;             // a body smaller than this (px radius) gets a ring so it can be found
var SP_RING_FADE_PX = 16;
var SP_MARKER_PX = 15;
var SP_SELECT_RING_MAX_PX = 30;      // a body bigger than this needs no ring round it
var SP_PROBE_PX = 8, SP_PROBE_SELECT_PX = 4;
var SP_COVER_PX = 12;                // a body this big hides what is behind it, labels too
var SP_MAX_PITCH = 1.5;              // the head and the orbiting camera turn no further than this up or down (radians)
var SP_MAX_LOOK_YAW = Math.PI;
var SP_CHIP_TITLE_CHARS = 34;        // a talk or question on a chip is cut to this
var SP_MARKER_LAYOUT_PX = 11;        // body rings are smaller in the laid-out picture, where bodies are close
var SP_SELECT_COLOUR = [1, 0.72, 0.2], SP_GHOST_COLOUR = [1, 1, 1], SP_LIGHT_COLOUR = [1, 0.96, 0.7];
var SP_SELECT_RING_MIN_PX = 24, SP_SELECT_RING_PAD_PX = 10, SP_GHOST_PX = 12, SP_LIGHT_PX = 30, SP_RING_ALPHA = 0.85, SP_GHOST_ALPHA = 0.9;
var SP_GHOST_MIN_OFFSET_PX = 12;     // the light's place is drawn only when it is this far from the body's
var SP_GLOW_RADII = 3.5, SP_GLOW_MIN_PX = 11;   // the Sun's glow: in its radii, and at least this wide on the screen
var SP_NEAR_FRACTION = 0.35, SP_NEAR_MIN_AU = 1e-10;   // the camera's near plane: of the nearest surface, and its floor
var SP_CAPTION_MS = 3200;            // an effect's caption stays this long before the next
var SP_LABEL_GAP_PX = 10;            // a name's distance from its body
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
  '.sp-top{flex-direction:column;align-items:stretch;gap:6px;justify-content:flex-start}',
  '.sp-top-row{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}',
  '.sp-tools{flex-direction:row;gap:6px;pointer-events:none}',
  '.sp-tools>*{pointer-events:auto}',
  '.sp-tabs{display:flex;gap:6px;width:min(560px,100%);pointer-events:auto}',
  '.sp-tabs .ae-btn{flex:1 1 0;min-width:0;padding-inline:4px;font-size:12px;overflow:hidden;text-overflow:ellipsis}',
  '.sp-tabs .ae-btn[data-sp-overview]{flex-grow:1.5}',
  '.sp-chips{display:flex;gap:6px;overflow-x:auto;max-width:100%;padding:2px 2px 4px;pointer-events:auto;scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,transparent,#000 14px,#000 calc(100% - 14px),transparent);mask-image:linear-gradient(90deg,transparent,#000 14px,#000 calc(100% - 14px),transparent)}',
  '.sp-chips::-webkit-scrollbar{display:none}',
  '.sp-chips .ae-btn{flex:0 0 auto}',
  '.sp-chips .ae-btn[hidden]{display:none}',
  '.sp-chips .ae-btn[aria-disabled="true"]{opacity:.5}',
  // A finger needs 44 px, not the 34 the Earth view's buttons give a mouse.
  '@media (pointer:coarse){.sp-view .ae-btn{min-height:44px}.sp-view .sp-lib .ae-btn,.sp-view .sp-cap .ae-btn{min-height:44px}}',
  '.sp-view.ae-blank .ae-tools,.sp-view.ae-blank .ae-when-col,.sp-view.ae-blank .sp-speed,.sp-view.ae-blank .sp-tabs,.sp-view.ae-blank .sp-chips{display:none}',
  '.sp-view .ae-when b{white-space:nowrap;font-size:12px}',
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
  '.sp-view.sp-flying .sp-card,.sp-view.sp-flying .sp-chips,.sp-view.sp-flying .sp-tabs{display:none}',
  '.sp-view.sp-arrived .sp-card{display:none}',
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
  'uniform float uLambda; uniform float uMapped; uniform vec3 uCam;',
  'varying float vDim;',
  // The overview's layout (_spLayoutMap), for a line whose points are heliocentric: K ln(1 + r / R0).
  'vec3 spLayout(vec3 p) {',
  '  float r = length(p); if (r < 1e-6) return p;',
  '  float f = ' + SP_LAYOUT_K.toFixed(4) + ' * log(1.0 + r / ' + SP_LAYOUT_R0.toFixed(4) + ') / r;',
  '  return p * (1.0 - uLambda + uLambda * f);',
  '}',
  'void main() {',
  '  vec3 w = (uMapped > 0.5 && uLambda > 0.0) ? spLayout(position) - uCam : (modelMatrix * vec4(position, 1.0)).xyz;',
  // A guide line is not light: aft, where the stars and bodies have dimmed (by D squared), it dims with them.
  '  vDim = 1.0;',
  '  if (uBeta > 0.0) { float c = dot(normalize(w), uHead); float D = inversesqrt(1.0 - uBeta * uBeta) * (1.0 + uBeta * c); vDim = clamp(D * D, 0.04, 1.0); }',
  '  gl_Position = projectionMatrix * viewMatrix * vec4(spAberr(w), 1.0);',
  '}'
].join('\n');
var SP_FRAG_LINE = [
  'precision mediump float;',
  'uniform vec3 uColor; uniform float uAlpha; varying float vDim;',
  'void main() { gl_FragColor = vec4(uColor, uAlpha * vDim); }'
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
// Saturn, Uranus, Neptune and Ceres have no public-domain map in the library,
// so each is painted here from what it looks like: bands and a few clouds for
// the giants, speckle for the rock.
var SP_PROC = {
  saturn:  { bands: [[0.93, 0.85, 0.66], [0.82, 0.72, 0.52], [0.9, 0.8, 0.6], [0.76, 0.66, 0.48]], freq: 11, amp: 0.17 },
  uranus:  { bands: [[0.62, 0.84, 0.86], [0.58, 0.8, 0.84], [0.66, 0.87, 0.88]], freq: 5, amp: 0.05 },
  neptune: { bands: [[0.2, 0.34, 0.78], [0.25, 0.4, 0.85], [0.17, 0.3, 0.7]], freq: 8, amp: 0.1 },
  rock:    { speckle: [0.5, 0.48, 0.45], spread: 0.16 }
};
var SP_PROC_SIZE = [256, 128];
var SP_BAND_WOBBLE = 0.35;           // how far the noise bends a giant's bands, in bands
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
        var pos = lat * spec.freq + noise(u * 3, lat * 2) * SP_BAND_WOBBLE, i0 = Math.floor(pos), f = pos - i0;
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

// ── The scene ──
var SP_THREE_DOUBLE_SIDE = 2;       // three's DoubleSide, not exported by name by the tree-shaken build
var SP_SPHERE_SEGMENTS = [64, 32];
var SP_BIG_SPHERE_SEGMENTS = [96, 48];
var SP_RING_SEGMENTS = 160;
var SP_ORBIT_COLOR = [0.55, 0.62, 0.78], SP_ORBIT_ALPHA = 0.28;
var SP_TRAIL_COLOR = [0.43, 0.9, 0.85], SP_TRAIL_PAST_ALPHA = 0.7, SP_TRAIL_FUTURE_ALPHA = 0.22;
var SP_MOON_ORBIT_ALPHA = 0.22;
var SP_STAR_CAPACITY = 9200;
var SP_FIRST_SKY_STARS = 600;        // the Almanac's own sky has fewer than this; the catalogue has more
var SP_MIN_DISC_PX = 0.35;           // a disc smaller than this (px radius) is left to its marker
var SP_MARKER_CAPACITY = 80;

function _spUniformsAber() { return { uHead: { value: null }, uBeta: { value: 0 } }; }

function _spLineMaterial(THREE, ab, lay, rgb, alpha, mapped) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHead: ab.uHead, uBeta: ab.uBeta, uLambda: lay.uLambda, uCam: lay.uCam, uMapped: { value: mapped ? 1 : 0 },
      uColor: { value: new THREE.Vector3(rgb[0], rgb[1], rgb[2]) }, uAlpha: { value: alpha }
    },
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
// Points (the markers, the stars): the Earth view's cloud, with the ship's aberration in its vertex shader and a kind.
function _spPointsObject(THREE, ab, capacity, dpr, additive) {
  return _aePointCloud(THREE, capacity, dpr, false, {
    kinds: true, depthTest: false, additive: additive,
    material: { uniforms: { uHead: ab.uHead, uBeta: ab.uBeta, dpr: { value: dpr } }, vertexShader: SP_VERT_POINTS, fragmentShader: SP_FRAG_POINTS }
  });
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
    starAb: _spUniformsAber(), orbits: {}, trails: {}, moonRings: {},
    lay: { uLambda: { value: 0 }, uCam: { value: new THREE.Vector3() } }
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
  var orbitMat = _spLineMaterial(THREE, ab, S.lay, SP_ORBIT_COLOR, SP_ORBIT_ALPHA, true);
  S.orbitMat = orbitMat;
  SP_BODIES.forEach(function (b) {
    if (!b.period) return;
    var line = _spLine(THREE, THREE.LineLoop, orbitMat, SP_ORBIT_POINTS);
    scene.add(line);
    S.orbits[b.key] = { line: line, at: null };
  });
  var moonMat = _spLineMaterial(THREE, ab, S.lay, SP_ORBIT_COLOR, SP_MOON_ORBIT_ALPHA, false);
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
  var pastMat = _spLineMaterial(THREE, ab, S.lay, SP_TRAIL_COLOR, SP_TRAIL_PAST_ALPHA, true);
  var futureMat = _spLineMaterial(THREE, ab, S.lay, SP_TRAIL_COLOR, SP_TRAIL_FUTURE_ALPHA, true);
  S.trailMats = [pastMat, futureMat];
  Object.keys(tracks).forEach(function (k) {
    if (k === 'ceres') return;
    var trail = _spTrailPath(tracks[k]);
    var past = new THREE.BufferGeometry(), future = new THREE.BufferGeometry();
    var attr = new THREE.BufferAttribute(trail.path, 3);
    past.setAttribute('position', attr); future.setAttribute('position', attr);
    var a = new THREE.Line(past, pastMat), b = new THREE.Line(future, futureMat);
    a.frustumCulled = b.frustumCulled = false;
    a.renderOrder = b.renderOrder = 1;
    scene.add(a); scene.add(b);
    S.trails[k] = { past: a, future: b, count: trail.path.length / 3, offsets: trail.offsets };
  });

  S.markers = _spPointsObject(THREE, ab, SP_MARKER_CAPACITY, dpr, false);
  S.markers.renderOrder = 10;
  scene.add(S.markers);
  return S;
}

// A probe's whole path as a polyline: the table's samples with Hermite points
// between each pair (more where the pair is far apart, so a long cruise arc is
// smooth, and curves rather than straightens when aberration bends it).
// `offsets[i]` is the index of sample i in the polyline.
var SP_TRAIL_SEGMENT_AU = 0.5, SP_TRAIL_MAX_PIECES = 32;
function _spTrailPath(track) {
  var s = track.s, offsets = new Int32Array(s.length), pieces = [], n = 1, i;
  for (i = 0; i < s.length - 1; i++) {
    var span = Math.hypot(s[i + 1][1] - s[i][1], s[i + 1][2] - s[i][2], s[i + 1][3] - s[i][3]);
    pieces.push(Math.min(SP_TRAIL_MAX_PIECES, Math.max(SP_TRAIL_SUBDIV, Math.ceil(span / SP_TRAIL_SEGMENT_AU))));
    offsets[i] = n - 1;
    n += pieces[i];
  }
  offsets[s.length - 1] = n - 1;
  var out = new Float32Array(n * 3), k = 0;
  for (i = 0; i < s.length - 1; i++) {
    for (var j = 0; j < pieces[i]; j++) {
      var p = _spHermite(s[i], s[i + 1], s[i][0] + (s[i + 1][0] - s[i][0]) * j / pieces[i]);
      out[k++] = p[0]; out[k++] = p[1]; out[k++] = p[2];
    }
  }
  var last = s[s.length - 1];
  out[k++] = last[1]; out[k++] = last[2]; out[k++] = last[3];
  return { path: out, offsets: offsets };
}
// The index in a trail of the moment jd (fractional).
function _spTrailIndex(track, offsets, jd) {
  var s = track.s, lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (s[mid][0] <= jd) lo = mid; else hi = mid; }
  var f = (jd - s[lo][0]) / (s[hi][0] - s[lo][0]);
  return offsets[lo] + Math.min(1, Math.max(0, f)) * (offsets[hi] - offsets[lo]);
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
    if (url) _aeLoadTexture(THREE, url).then(function (tx) { if (_sp.gl === S) _spApplyTexture(S, it, tx, 'uMap', 'uHasMap'); }, function () {});
    if (b.night) _aeLoadTexture(THREE, AE_TEX_NIGHT).then(function (tx) { if (_sp.gl === S) _spApplyTexture(S, it, tx, 'uNight', 'uHasNight'); }, function () {});
    if (b.rings) _aeLoadTexture(THREE, _spRingCanvas().toDataURL('image/png')).then(function (tx) {
      if (_sp.gl !== S) return;
      it.ringUni.uProfile.value = tx; _sp.dirty = true; _spKick();
    }, function () {});
  });
  if (!S.starsLoading && !S.starsLoaded) {
    S.starsLoading = true;
    _aeFetchStars().then(function (stars) {
      if (_sp.gl !== S) throw new Error('stars');
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
  S.starsLoaded = list.count > SP_FIRST_SKY_STARS;
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
    _aeSetPoint(cloud, i, [p[0] * R, p[1] * R, p[2] * R], rgb, alpha, size, SP_KIND_DOT);
  }
  _aeCommitPoints(cloud, n);
}

// ── State ──
var _sp = null;
var _spIsOpen = false;
function _spNewState(el) {
  return {
    el: el, gl: null, loading: false, failed: false, noProbes: false,
    dirty: true, raf: 0, idleTimer: 0, lastTs: 0, lastText: 0,
    jd: 0, rateIdx: 0, scaleMode: 'readable', beta: 0.1,
    // The camera: parked, it looks at `follow` (a body, or the free point `center` mid-glide) from `dist`
    // at azimuth `az` and elevation `el`; in flight it is the ship, and `look*` turn the head.
    cam: { follow: 'Sun', center: [0, 0, 0], dist: SP_OVERVIEW_DIST_AU, az: SP_START_AZIMUTH, el: SP_OVERVIEW_ELEVATION,
           pos: [0, 0, 0], fwd: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1], lookYaw: 0, lookPitch: 0 },
    glide: null, flight: null, selected: null, lastTrip: null, at: 'Earth', pendingFly: null,
    layout: 1, layoutTarget: 1, group: 'planets', capQueue: [], moved: false, openJd: 0, shift: 0,
    pointers: {}, drag: null, pinch: null, w: 1, h: 1,
    projected: [], seen: {}, caption: null, whyOpen: false, labelPool: {}, lastCard: ''
  };
}
function _spReduceMotion() { return _aeReduceMotion(); }
// The scale as drawn now (it follows the spacecraft near each body), made again only when the moment or mode changes.
// During a flight it is the scale of the moment the ship arrives, so no body changes size on the way
// (a planet a probe is leaving would grow under the ship) and the standoff fits the planet as it will be.
function _spScaleNow() {
  var jd = _sp.flight ? _sp.flight.arriveJd : _sp.jd, c = _sp.scaleCache;
  if (!c || c.mode !== _sp.scaleMode || c.jd !== jd) c = _sp.scaleCache = { mode: _sp.scaleMode, jd: jd, scale: _spScale(_sp.scaleMode, jd) };
  return c.scale;
}

// ── Camera ──
function _spSphericalOffset(dist, az, el) {
  return [dist * Math.cos(el) * Math.cos(az), dist * Math.cos(el) * Math.sin(az), dist * Math.sin(el)];
}
function _spMinDist(key, sc) {
  var b = _spBody(key);
  if (b.kind === 'probe') return SP_PROBE_MIN_AU;
  return Math.max(1e-9, _spShownRadius(key, sc || _spScaleNow()) * SP_MIN_RADII);
}
// Turn a heading by the head's yaw (left, about the ecliptic's up) and pitch.
function _spLookFrom(heading, yaw, pitch) {
  var up = Math.abs(heading[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
  var right = _aeNorm(_aeCross(heading, up)), top = _aeCross(right, heading);
  var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  var flat = _spAdd(_aeScale(heading, cy), _aeScale(right, -sy));
  return _aeNorm(_spAdd(_aeScale(flat, cp), _aeScale(top, sp)));
}
function _spSetFacing(cam, fwd) {
  var up = Math.abs(fwd[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
  cam.fwd = fwd;
  cam.right = _aeNorm(_aeCross(fwd, up));
  cam.up = _aeCross(cam.right, fwd);
}
// Where the camera is and which way it looks, at the view's moment.
// Where the picture puts a body (the laid-out place when the overview is on).
function _spFollowCenter(key) {
  var abs = _spBodyPos(key, _sp.jd, _spScaleNow());
  return abs ? _spDisplayAt(key, abs, _sp.jd, _sp.layout) : null;
}
function _spPlaceCamera() {
  var cam = _sp.cam, f = _sp.flight;
  if (f) {
    _spSetFacing(cam, _spLookFrom(f.heading, cam.lookYaw, cam.lookPitch));
    return;
  }
  var center = cam.follow ? _spFollowCenter(cam.follow) : cam.center;
  if (!center) center = cam.center;
  cam.center = center;
  var off = _spSphericalOffset(cam.dist, cam.az, cam.el);
  cam.pos = _spAdd(center, off);
  _spSetFacing(cam, _aeNorm(_aeScale(off, -1)));
}
// The ship's heading and speed for the light, or none when parked.
function _spBeta() { return _sp.flight ? _sp.flight.now.beta : 0; }
// Where the ship is: in flight, the camera; otherwise at the body it last reached (it starts at Earth).
function _spShipPos() {
  if (_sp.flight) return _sp.cam.pos;
  return _spBodyPos(_sp.at, _sp.jd, _spScaleNow()) || _sp.cam.pos;
}
// Fly: first turn the camera to a launch pose beside the ship, looking toward the target, then go.
function _spLaunch(key) {
  if (!_spCanFly(key)) return;
  var sc = _spScaleNow(), ship = _spShipPos(), target = _spBodyPos(key, _sp.jd, sc);
  var toward = _aeSub(target, ship), d = _aeLen(toward);
  _spSelect(key);
  if (key === _sp.at || d < 1e-9) { _sp.at = key; _spGlideToBody(key); return; }
  _spSetLayout(0);
  var u = _aeScale(toward, 1 / d), stand = _spStandoff(_sp.at);
  var pose = _spAdd(ship, _aeScale(u, stand));
  _sp.pendingFly = key;
  _spGlide({ follow: null, center: _spAdd(pose, _aeScale(u, stand)), dist: stand, az: Math.atan2(-u[1], -u[0]), el: Math.asin(_aeClamp(-u[2], -1, 1)) });
}

// ── Flight ──
function _spFlightSeconds(len) {
  return Math.min(SP_FLIGHT_MAX_S, SP_FLIGHT_BASE_S + SP_FLIGHT_PER_DECADE_S * Math.log10(1 + len));
}
// The share of the way flown at progress p (0..1) of the animation: the time
// is the Earth clock's, so the camera speeds up and slows down exactly as the
// ship's speed does (bisection on the monotone Earth clock).
function _spShareAt(len, beta, p) {
  var total = _spTrip(len, beta).earthSec, want = p * total, lo = 0, hi = 1;
  for (var i = 0; i < 40; i++) {
    var mid = (lo + hi) / 2;
    if (_spTripAt(len, beta, mid).earthSec < want) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
// How near the camera stops, in the drawn scene.
function _spStandoff(key, sc) {
  var b = _spBody(key);
  return b.kind === 'probe' ? SP_PROBE_STANDOFF_AU : Math.max(_spMinDist(key, sc), _spShownRadius(key, sc || _spScaleNow()) * SP_STANDOFF_RADII);
}
function _spCanFly(key) { return !_sp.flight && !_spNoGo(key); }
// Why the ship cannot go to a body from where it is: 'absent' (not flying on this date)
// or 'gone' (its data ends before the ship would arrive); '' when it can.
function _spNoGo(key) {
  var trip = _spTripBetween(_sp.at, key, _sp.jd, _sp.beta);
  return !trip ? 'absent' : (trip.reachable ? '' : 'gone');
}
function _spStartFlight(key) {
  if (!_spCanFly(key)) return;
  _spPlaceCamera();
  // The clocks are the true trip (_spTripBetween); the camera flies the drawn one, to the
  // drawn body where it will be when the ship arrives, and stops short of it by the drawn standoff.
  _sp.layout = _sp.layoutTarget = 0;
  var from = _sp.cam.pos.slice(), trip = _spTripBetween(_sp.at, key, _sp.jd, _sp.beta);
  var sc = _spScale(_sp.scaleMode, trip.arriveJd), stand = _spStandoff(key, sc);   // the scale of the arrival, held through the flight
  var target = _spBodyPos(key, trip.arriveJd, sc), toTarget = _aeSub(target, from), d = _aeLen(toTarget);
  var camLen = Math.max(0, d - stand);
  _spSelect(key);
  _sp.lastTrip = null;
  if (camLen < 1e-9 || trip.legAU < 1e-12) { _sp.at = key; _spGlideToBody(key); return; }
  var heading = _aeScale(toTarget, 1 / d);
  _sp.flight = {
    key: key, from: from, heading: heading, len: trip.legAU, camLen: camLen, trueDist: trip.distAU, beta: _sp.beta,
    jd0: _sp.jd, arriveJd: trip.arriveJd, p: 0, dur: _spFlightSeconds(camLen), stand: stand,
    now: _spTripAt(trip.legAU, _sp.beta, 0)
  };
  _sp.cam.lookYaw = _sp.cam.lookPitch = 0;
  _sp.glide = null;
  _spPlaceCamera();
  _sp.caption = null; _sp.capQueue = [];
  _spShowCaption('race');
  if (_spReduceMotion()) _spStepFlight(1e9);
  _spSyncControls();
  _sp.dirty = true;
  _spKick();
}
// Advance the flight by dt milliseconds; true while it flies.
function _spStepFlight(dt) {
  var f = _sp.flight;
  if (!f) return false;
  f.p = Math.min(1, f.p + dt / (f.dur * 1000));
  var s = f.p >= 1 ? 1 : _spShareAt(f.len, f.beta, f.p);
  f.share = s;
  f.now = _spTripAt(f.len, f.beta, s);
  _sp.jd = f.jd0 + f.now.earthSec / SECONDS_PER_DAY;
  _sp.cam.pos = _spAdd(f.from, _aeScale(f.heading, f.camLen * s));
  if (f.p >= 1) { _spFinishFlight(); return false; }
  return true;
}
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
  if (_spIsOpen) _spClose();
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
