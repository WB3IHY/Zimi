// ── Almanac: what the sky tells a person who needs to act on it ──
// Beside the live sky (almanac-sky.js): how much daylight is left, when it is
// fully dark, when the Moon rises and how lit it is, where true north is, the
// time by the Sun, and, when the place is only a guess from the time zone,
// that it is a guess and where. Then the sky's settings. All from the
// Almanac's own functions, offline; nothing here asks for a place.
// Loaded after almanac-sky.js, before almanac.js.

// ══ The Sun's and the Moon's rising and setting ═════════════════════════
var SKY_EVENT_STEP_MS = 10 * 60000;        // stepping an altitude forward to bracket a crossing
var SKY_EVENT_TOL_MS = 1000;               // and bisected to this
var SKY_EVENT_HORIZON_MS = 36 * 3600000;   // looking ahead this far for the next
var SKY_MOON_RISE_ALT = -0.27;             // the Moon's apparent centre when its upper limb touches the horizon

// The next instant after fromMs that altOf(ms) (degrees) crosses level going
// down (dir -1) or up (dir +1), or null within maxMs.
function _skyNextCrossing(altOf, fromMs, level, dir, maxMs) {
  var a0 = altOf(fromMs) - level;
  for (var t = fromMs + SKY_EVENT_STEP_MS; t <= fromMs + maxMs + SKY_EVENT_STEP_MS; t += SKY_EVENT_STEP_MS) {
    var a1 = altOf(t) - level;
    if ((dir < 0 && a0 > 0 && a1 <= 0) || (dir > 0 && a0 < 0 && a1 >= 0)) {
      var lo = t - SKY_EVENT_STEP_MS, hi = t;
      while (hi - lo > SKY_EVENT_TOL_MS) {
        var mid = (lo + hi) / 2, am = altOf(mid) - level;
        if ((dir < 0 && am > 0) || (dir > 0 && am < 0)) lo = mid; else hi = mid;
      }
      return hi;
    }
    a0 = a1;
  }
  return null;
}
// The Sun's geometric altitude (degrees) at an instant and a place.
function _skySunAltAt(ms, lat, lon) {
  var d = new Date(ms), sq = _skySunRaDec(_jdToJulianCentury(_dateToJD(ms)));
  return _skyHorizontal(sq.ra, sq.dec, _skyLST(d, lon), Math.sin(lat * DEG_TO_RAD), Math.cos(lat * DEG_TO_RAD)).alt;
}
function _skyMoonAltAt(ms, lat, lon) { return _moonPosition(new Date(ms), lat, lon).altitude; }
function _skySunAzAt(ms, lat, lon) {
  var d = new Date(ms), sq = _skySunRaDec(_jdToJulianCentury(_dateToJD(ms)));
  return _skyHorizontal(sq.ra, sq.dec, _skyLST(d, lon), Math.sin(lat * DEG_TO_RAD), Math.cos(lat * DEG_TO_RAD)).az;
}
function _skyMoonAzAt(ms, lat, lon) { return _moonPosition(new Date(ms), lat, lon).azimuth; }

// Everything the facts say, as numbers (instants in ms, null where there is none).
function _skyFactsAt(ms, lat, lon) {
  var sunAlt = function (t) { return _skySunAltAt(t, lat, lon); }, now = sunAlt(ms), horizon = SKY_EVENT_HORIZON_MS;
  var sunUp = now > SKY_DAY_ALT, dark = now < SKY_ASTRO_ALT;
  var out = {
    sunUp: sunUp,
    sunset: _skyNextCrossing(sunAlt, ms, SKY_DAY_ALT, -1, horizon), sunrise: _skyNextCrossing(sunAlt, ms, SKY_DAY_ALT, 1, horizon),
    fullyDark: dark,
    darkFrom: dark ? null : _skyNextCrossing(sunAlt, ms, SKY_ASTRO_ALT, -1, horizon),
    darkUntil: dark ? _skyNextCrossing(sunAlt, ms, SKY_ASTRO_ALT, 1, horizon) : null
  };
  var moonAlt = function (t) { return _skyMoonAltAt(t, lat, lon); };
  out.moonUp = moonAlt(ms) > SKY_MOON_RISE_ALT;
  out.moonrise = _skyNextCrossing(moonAlt, ms, SKY_MOON_RISE_ALT, 1, horizon);
  out.moonset = _skyNextCrossing(moonAlt, ms, SKY_MOON_RISE_ALT, -1, horizon);
  // Where on the horizon each one happens.
  if (out.sunset) out.sunsetAz = _skySunAzAt(out.sunset, lat, lon);
  if (out.sunrise) out.sunriseAz = _skySunAzAt(out.sunrise, lat, lon);
  if (out.moonrise) out.moonriseAz = _skyMoonAzAt(out.moonrise, lat, lon);
  if (out.moonset) out.moonsetAz = _skyMoonAzAt(out.moonset, lat, lon);
  return out;
}
// The time by the Sun's own reckoning, minutes into the solar day (the
// equation of time and the longitude, as the Sun's position uses them).
function _skySolarMinutes(date, lon) {
  var EoT = _eqOfTime(_solarB(_dayOfYear(date)));
  var utc = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  return (((utc + EoT + lon * 4) % 1440) + 1440) % 1440;
}

// ══ In words ════════════════════════════════════════════════════════════
var SKY_GUESS_ROUND_MS = 15 * 60000;   // while the place is a guess, times are given to the quarter hour and said to be about
// A guessed time is given to the quarter hour in the direction that does no
// harm: dir -1 rounds down (the light ends, no later than said), +1 up (the
// dark lasts, no less than said). The span and the clock are cut from the same
// instant, so "10 min . 7:00 PM" adds up.
function _skyRoundMs(ms, guess, dir) {
  if (!guess) return ms;
  var q = ms / SKY_GUESS_ROUND_MS;
  return (dir < 0 ? Math.floor(q) : dir > 0 ? Math.ceil(q) : Math.round(q)) * SKY_GUESS_ROUND_MS;
}
function _skyClock(ms, guess, dir) {
  ms = _skyRoundMs(ms, guess, dir);
  var tz = typeof _almDisplayTz === 'function' ? _almDisplayTz() : null;
  try { return _tzFmt(tz, { hour: 'numeric', minute: '2-digit' }).format(new Date(ms)); }
  catch (e) { return _tzFmt(null, { hour: 'numeric', minute: '2-digit' }).format(new Date(ms)); }
}
function _skySolarClock(min, guess) {
  if (guess) min = Math.round(min / 15) * 15;
  return _tzFmt('UTC', { hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2000, 0, 1) + Math.round(min) * 60000));
}
// "Los Angeles" from "America/Los_Angeles": the zone's own name for its city.
function _skyZoneCity() {
  var tz = typeof _almDeviceTz === 'function' ? _almDeviceTz() : null;
  return tz && tz.indexOf('/') > 0 ? tz.split('/').pop().replace(/_/g, ' ') : '';
}
// The span from now to an instant, the instant rounded as _skyClock rounds it.
function _skySpan(at, now, guess, dir) { return _orrFmtSpan(Math.max(0, _skyRoundMs(at, guess, dir) - now) / 1000); }
// "SW 252°": the point of the compass and the bearing it stands for.
function _skyBearing(az) { return _azCompass(az) + ' ' + Math.round(az) + '\u00b0'; }

// The cards: [label, value, sub, wide]. The value is the one short thing the
// card is for (a span, a clock time, a share lit); the sub is where on the
// horizon and when, in the card's own small line; wide is a card whose words
// run long. A card that rests on a guessed place says "about" in itself.
function _skyFactRows(s, f) {
  var rows = [], lat = s.lat, now = s.nowTime, guess = !s.stored;
  var about = function (v) { return guess ? t('alm_sky_f_about', { v: v }) : v; };
  var at = function (ms, az, dir, qualify) { var c = _skyClock(ms, guess, dir); return (qualify ? about(c) : c) + ' · ' + _skyBearing(az); };
  // A guessed sunset less than a step away rounds down to now: said as what it is, not as a time already gone.
  var soon = guess && f.sunUp && f.sunset && _skyRoundMs(f.sunset, guess, -1) <= now;
  if (f.sunUp) rows.push([t('alm_sky_f_daylight_left'), soon ? t('alm_sky_f_under_step') : f.sunset ? about(_skySpan(f.sunset, now, guess, -1)) : t('alm_midnight_sun'), f.sunset && !soon ? at(f.sunset, f.sunsetAz, -1) : '']);
  else rows.push([t('alm_sky_f_sunrise_in'), f.sunrise ? about(_skySpan(f.sunrise, now, guess, 1)) : t('alm_polar_night'), f.sunrise ? at(f.sunrise, f.sunriseAz, 1) : '']);
  if (f.fullyDark) rows.push([t('alm_sky_f_dark_until'), f.darkUntil ? about(_skyClock(f.darkUntil, guess, 1)) : t('alm_polar_night'), '']);
  else rows.push([t('alm_sky_f_dark_from'), f.darkFrom ? about(_skyClock(f.darkFrom, guess, 1)) : t('alm_sky_f_not_dark'), '']);
  var moonNext = f.moonUp ? (f.moonset ? t('alm_sky_f_sets', { t: at(f.moonset, f.moonsetAz, -1, true) }) : '') : (f.moonrise ? t('alm_sky_f_rises', { t: at(f.moonrise, f.moonriseAz, 1, true) }) : '');
  rows.push([t('alm_moon'), t('alm_sky_f_moon_lit', { p: _orrNum(s.moonData.phase.illumination, null, 0) + '%' }), moonNext]);
  var a = _skyDeg(Math.abs(lat));
  if (s.known === false) rows.push([t('alm_sky_f_north'), t('alm_sky_f_pole_unknown'), '', true]);
  else if (Math.abs(lat) < 2) rows.push([t('alm_sky_f_north'), t('alm_sky_f_equator_val'), '', true]);
  else if (lat > 0) rows.push([t('alm_sky_f_north'), t('alm_sky_f_north_val', { a: a }), '', true]);
  else rows.push([t('alm_sky_f_south'), t('alm_sky_f_south_val', { a: a }), '', true]);
  rows.push([t('alm_sky_f_solar'), about(_skySolarClock(_skySolarMinutes(new Date(now), s.lon), guess)), '']);
  return rows;
}
// A line that breaks only at its dots (each piece, a time or a bearing, whole, the dot staying with the piece before it).
function _skyNoBreak(text) {
  var parts = text.split(' · ');
  return parts.map(function (p, i) { return '<span class="alm-nobr">' + _almEsc(p) + (i < parts.length - 1 ? ' ·' : '') + '</span>'; }).join(' ');
}
// The cards in the hero's own grammar (a label over a value, two columns),
// the short ones first and the wide ones under them.
function _skyFactCards(rows) {
  var html = '<div class="alm-sky-cards">';
  for (var pass = 0; pass < 2; pass++) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!!r[3] !== !!pass) continue;
      html += '<div class="alm-card' + (r[3] ? ' alm-card-wide' : '') + '"><div class="alm-card-lbl">' + _almEsc(r[0]) + '</div><div class="alm-card-val">' + _almEsc(r[1]) + '</div>' +
        (r[2] ? '<div class="alm-card-sub">' + _skyNoBreak(r[2]) + '</div>' : '') + '</div>';
    }
  }
  return html + '</div>';
}
var SKY_FACTS_MS = 30000;      // the rows are rewritten at most this often
function _skyFacts(s) {
  var el = document.getElementById('almanac-sky-facts');
  if (!el || !s.eph) return;
  var key = s.lat + ',' + s.lon, due = !s.factsAt || Math.abs(s.nowTime - s.factsAt) >= SKY_FACTS_MS || s.factsKey !== key;
  if (due) { s.facts = _skyFactsAt(s.nowTime, s.lat, s.lon); s.factsAt = s.nowTime; s.factsKey = key; }
  var html = _skyFactCards(_skyFactRows(s, s.facts));
  if (!s.stored) {
    var city = _skyZoneCity();
    html += '<p class="alm-sky-guess">' + _almEsc(city ? t('alm_sky_f_guess', { city: city }) : t('alm_sky_f_guess_nocity')) + '</p>';
  }
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}

// ══ The settings ════════════════════════════════════════════════════════
var SKY_DIAL_STEPS = 100;
function _skySelectHtml(id, labelKey, values, keyOf) {
  var h = '<label class="alm-sky-set-row"><span>' + _almEsc(t(labelKey)) + '</span><select data-sky-set="' + id + '">';
  for (var i = 0; i < values.length; i++) h += '<option value="' + values[i] + '">' + _almEsc(t(keyOf(values[i]))) + '</option>';
  return h + '</select></label>';
}
function _skySettingsHtml() {
  return '<summary>' + _almEsc(t('alm_sky_set')) + '</summary>' +
    '<label class="alm-sky-set-row"><span>' + _almEsc(t('alm_sky_set_dark')) + '</span>' +
    '<span class="alm-sky-dial"><small>' + _almEsc(t('alm_sky_set_dark_lo')) + '</small>' +
    '<input type="range" min="0" max="' + SKY_DIAL_STEPS + '" step="1" data-sky-set="dial" aria-label="' + _almEsc(t('alm_sky_set_dark')) + '">' +
    '<small>' + _almEsc(t('alm_sky_set_dark_hi')) + '</small></span></label>' +
    _skySelectHtml('lines', 'alm_sky_set_lines', SKY_SETTING_VALUES.lines, function (v) { return 'alm_sky_lines_' + v; }) +
    _skySelectHtml('size', 'alm_sky_set_size', SKY_SETTING_VALUES.size, function (v) { return 'alm_sky_size_' + v; }) +
    _skySelectHtml('skin', 'alm_sky_set_skin', SKY_SETTING_VALUES.skin, function (v) { return 'alm_sky_skin_' + v; }) +
    '<label class="alm-sky-set-row alm-sky-set-check"><input type="checkbox" data-sky-set="red"><span>' + _almEsc(t('alm_sky_set_red')) + '</span></label>';
}
// The panel and its controls, set to what is chosen; once per panel.
function _skyBindSettings() {
  var box = document.getElementById('almanac-sky-set');
  if (!box) return;
  var wrap = box.closest ? box.closest('.almanac-sky-wrap') : null;
  _skyWatchNight();
  _skyRedSeen = _skyRedOn();
  if (wrap) wrap.classList.toggle('sky-red', _skyRedSeen);
  if (box._skyBound) return;
  box._skyBound = true;
  box.innerHTML = _skySettingsHtml();
  var controls = box.querySelectorAll('[data-sky-set]');
  for (var i = 0; i < controls.length; i++) {
    (function (el) {
      var k = el.getAttribute('data-sky-set');
      if (k === 'red') el.checked = _skyRedOn();
      else if (k === 'dial') el.value = Math.round(_skySetting('dial') * SKY_DIAL_STEPS);
      else el.value = _skySetting(k);
      el.addEventListener(k === 'dial' ? 'input' : 'change', function () {
        _skySet(k, k === 'red' ? el.checked : k === 'dial' ? el.value / SKY_DIAL_STEPS : el.value);
      });
    })(controls[i]);
  }
}
