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
var SKY_SUN_RISE_ALT = -0.833;             // the Sun's centre at sunrise and sunset (refraction and semidiameter)
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

// Everything the facts say, as numbers (instants in ms, null where there is none).
function _skyFactsAt(ms, lat, lon) {
  var sunAlt = function (t) { return _skySunAltAt(t, lat, lon); }, now = sunAlt(ms), horizon = SKY_EVENT_HORIZON_MS;
  var sunUp = now > SKY_SUN_RISE_ALT, dark = now < SKY_ASTRO_ALT;
  var out = {
    sunUp: sunUp,
    sunset: _skyNextCrossing(sunAlt, ms, SKY_SUN_RISE_ALT, -1, horizon), sunrise: _skyNextCrossing(sunAlt, ms, SKY_SUN_RISE_ALT, 1, horizon),
    fullyDark: dark,
    darkFrom: dark ? null : _skyNextCrossing(sunAlt, ms, SKY_ASTRO_ALT, -1, horizon),
    darkUntil: dark ? _skyNextCrossing(sunAlt, ms, SKY_ASTRO_ALT, 1, horizon) : null
  };
  var moonAlt = function (t) { return _skyMoonAltAt(t, lat, lon); };
  out.moonUp = moonAlt(ms) > SKY_MOON_RISE_ALT;
  out.moonrise = _skyNextCrossing(moonAlt, ms, SKY_MOON_RISE_ALT, 1, horizon);
  out.moonset = _skyNextCrossing(moonAlt, ms, SKY_MOON_RISE_ALT, -1, horizon);
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
function _skyClock(ms) {
  var tz = typeof _almDisplayTz === 'function' ? _almDisplayTz() : null;
  try { return _tzFmt(tz, { hour: 'numeric', minute: '2-digit' }).format(new Date(ms)); }
  catch (e) { return _tzFmt(null, { hour: 'numeric', minute: '2-digit' }).format(new Date(ms)); }
}
function _skySolarClock(min) { return _tzFmt('UTC', { hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2000, 0, 1) + Math.round(min) * 60000)); }
// "Los Angeles" from "America/Los_Angeles": the zone's own name for its city.
function _skyZoneCity() {
  var tz = typeof _almDeviceTz === 'function' ? _almDeviceTz() : null;
  return tz && tz.indexOf('/') > 0 ? tz.split('/').pop().replace(/_/g, ' ') : '';
}
function _skySpan(ms) { return _orrFmtSpan(Math.max(0, ms) / 1000); }

// The rows: [label, value]. Under a minute of change nothing is rewritten.
function _skyFactRows(s, f) {
  var rows = [], lat = s.lat, now = s.nowTime;
  if (f.sunUp) rows.push([t('alm_sky_f_daylight_left'), f.sunset ? _skySpan(f.sunset - now) + ' · ' + _skyClock(f.sunset) : t('alm_midnight_sun')]);
  else rows.push([t('alm_sky_f_sunrise_in'), f.sunrise ? _skySpan(f.sunrise - now) + ' · ' + _skyClock(f.sunrise) : t('alm_polar_night')]);
  if (f.fullyDark) rows.push([t('alm_sky_f_dark_until'), f.darkUntil ? _skyClock(f.darkUntil) : t('alm_polar_night')]);
  else rows.push([t('alm_sky_f_dark_from'), f.darkFrom ? _skyClock(f.darkFrom) : t('alm_sky_f_not_dark')]);
  var moonNext = f.moonUp ? (f.moonset ? t('alm_sky_f_sets', { t: _skyClock(f.moonset) }) : '') : (f.moonrise ? t('alm_sky_f_rises', { t: _skyClock(f.moonrise) }) : '');
  rows.push([t('alm_moon'), t('alm_sky_f_moon_lit', { p: _orrNum(s.moonData.phase.illumination, null, 0) + '%' }) + (moonNext ? ' · ' + moonNext : '')]);
  var a = _skyDeg(Math.abs(lat));
  if (Math.abs(lat) < 2) rows.push([t('alm_sky_f_north'), t('alm_sky_f_equator_val')]);
  else if (lat > 0) rows.push([t('alm_sky_f_north'), t('alm_sky_f_north_val', { a: a })]);
  else rows.push([t('alm_sky_f_south'), t('alm_sky_f_south_val', { a: a })]);
  rows.push([t('alm_sky_f_solar'), _skySolarClock(_skySolarMinutes(new Date(now), s.lon))]);
  return rows;
}
var SKY_FACTS_MS = 30000;      // the rows are rewritten at most this often
function _skyFacts(s) {
  var el = document.getElementById('almanac-sky-facts');
  if (!el || !s.eph) return;
  var key = s.lat + ',' + s.lon, due = !s.factsAt || Math.abs(s.nowTime - s.factsAt) >= SKY_FACTS_MS || s.factsKey !== key;
  if (due) { s.facts = _skyFactsAt(s.nowTime, s.lat, s.lon); s.factsAt = s.nowTime; s.factsKey = key; }
  var rows = _skyFactRows(s, s.facts), html = '<dl>';
  for (var i = 0; i < rows.length; i++) html += '<div><dt>' + _almEsc(rows[i][0]) + '</dt><dd>' + _almEsc(rows[i][1]) + '</dd></div>';
  html += '</dl>';
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
  if (wrap) wrap.classList.toggle('sky-red', _skyRedOn());
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
