// The Field Guide's sky strip (app.js _fgSkyRows, fieldguideSky): the Almanac's
// own facts for the card, with every figure rounded the safe way while the
// place is only a guess from the time zone.
//
// Run: node tests/test_fieldguide_sky.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const { makeSky, check, done } = require('./sky_harness.cjs');

const app = fs.readFileSync(path.join(__dirname, '..', 'zimi', 'static', 'app.js'), 'utf8');
function pull(re, label) {
  const m = app.match(re);
  if (!m) throw new Error('could not extract ' + label + ' from app.js');
  return m[0];
}
function fn(name) {
  const start = app.indexOf('function ' + name + '(');
  let i = app.indexOf('{', start), depth = 0;
  for (; i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}' && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(name);
}

const sky = makeSky();
const { run } = sky;
// Plain tokens for what the strip formats, so the numbers can be read back.
run('function _skySpan(ms) { return "SPAN:" + Math.round(ms); }');
run('function _skyClock(ms) { return "CLK:" + Math.round(ms); }');
run('function _skyBearing(az) { return "AZ"; }');
run('function _skyDeg(x) { return Math.round(x) + "d"; }');
run('function _orrNum(n) { return String(Math.round(n)); }');
run('function fmtPct(n) { return Math.round(n) + "%"; }');
run(pull(/var FG_SKY_ROUND_MS = [^;]+;/, 'round'));
run(fn('_fgRound'));
run(fn('_fgSkyRows'));

const Q = 15 * 60000;
// Sydney, 15 October 2026 18:50 local (AEDT, UTC+11): sunset a little after 19:00.
const now = Date.UTC(2026, 9, 15, 7, 50);
const facts = run('_skyFactsAt(' + now + ', -33.87, 151.21)');
const trueLeft = facts.sunset - now;
const value = (rows, label) => rows.filter((r) => r[0] === label)[0][1];
const num = (s, tag) => Number(new RegExp(tag + ':(-?\\d+)').exec(s)[1]);

run('var _rowsGuess = _fgSkyRows({ lat: -33.87, lon: 151.21, guessed: true }, ' + now + ');');
run('var _rowsKnown = _fgSkyRows({ lat: -33.87, lon: 151.21, guessed: false }, ' + now + ');');
const guess = run('_rowsGuess'), known = run('_rowsKnown');

const left = value(guess, 'alm_sky_f_daylight_left');
check(/alm_sky_f_about/.test(left), 'a guessed place says "about"');
check(num(left, 'SPAN') <= trueLeft && trueLeft - num(left, 'SPAN') < Q, 'daylight left rounds down, never up (true ' + Math.round(trueLeft / 60000) + ' min, said ' + Math.round(num(left, 'SPAN') / 60000) + ')');
check(num(left, 'CLK') <= facts.sunset && facts.sunset - num(left, 'CLK') < Q, 'the sunset it names is not later than the sunset');
const exact = value(known, 'alm_sky_f_daylight_left');
check(!/about/.test(exact) && num(exact, 'SPAN') === Math.round(trueLeft), 'a chosen place is exact and does not say about');

const from = value(guess, 'alm_sky_f_dark_from');
check(num(from, 'CLK') <= facts.darkFrom && facts.darkFrom - num(from, 'CLK') < Q, 'fully dark from is the earlier quarter hour');

// After dark: sunrise and the end of darkness round later; the Moon sets earlier and rises later.
const night = Date.UTC(2026, 9, 14, 15, 0);
const nf = run('_skyFactsAt(' + night + ', -33.87, 151.21)');
run('var _nightRows = _fgSkyRows({ lat: -33.87, lon: 151.21, guessed: true }, ' + night + ');');
const nr = run('_nightRows');
const rise = value(nr, 'alm_sky_f_sunrise_in');
check(num(rise, 'CLK') >= nf.sunrise && num(rise, 'CLK') - nf.sunrise < Q && num(rise, 'SPAN') >= nf.sunrise - night, 'sunrise in rounds later');
const until = nr.filter((r) => r[0] === 'alm_sky_f_dark_until');
if (until.length) check(num(until[0][1], 'CLK') >= nf.darkUntil && num(until[0][1], 'CLK') - nf.darkUntil < Q, 'fully dark until is the later quarter hour');
const moon = value(nr, 'alm_moon');
check(/alm_sky_f_moon_lit/.test(moon), 'the Moon is lit by a figure');
if (nf.moonUp && nf.moonset) check(num(moon, 'CLK') <= nf.moonset, 'the Moon sets earlier than it does');
if (!nf.moonUp && nf.moonrise) check(num(moon, 'CLK') >= nf.moonrise, 'the Moon rises later than it does');

// True north or south for the hemisphere.
check(value(guess, 'alm_sky_f_south').indexOf('34d') >= 0, 'Sydney: true south, 34 up');
run('var _rowsN = _fgSkyRows({ lat: 40, lon: -105, guessed: false }, ' + now + ');');
check(run('_rowsN').some((r) => r[0] === 'alm_sky_f_north'), 'Denver: true north (Polaris)');

done();
