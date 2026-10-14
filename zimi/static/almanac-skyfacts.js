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
function _skyClock(ms, guess) {
  if (guess) ms = Math.round(ms / SKY_GUESS_ROUND_MS) * SKY_GUESS_ROUND_MS;
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
function _skySpan(ms, guess) { return _orrFmtSpan(Math.max(0, guess ? Math.round(ms / SKY_GUESS_ROUND_MS) * SKY_GUESS_ROUND_MS : ms) / 1000); }
// "SW 252°": the point of the compass and the bearing it stands for.
function _skyBearing(az) { return _azCompass(az) + ' ' + Math.round(az) + '\u00b0'; }

// The rows: [label, value]. A row that rests on a guessed place says "about" in the row itself.
function _skyFactRows(s, f) {
  var rows = [], lat = s.lat, now = s.nowTime, guess = !s.stored;
  var about = function (v) { return guess ? t('alm_sky_f_about', { v: v }) : v; };
  var at = function (ms, az) { return _skyClock(ms, guess) + ' \u00b7 ' + _skyBearing(az); };
  if (f.sunUp) rows.push([t('alm_sky_f_daylight_left'), f.sunset ? about(_skySpan(f.sunset - now, guess) + ' \u00b7 ' + at(f.sunset, f.sunsetAz)) : t('alm_midnight_sun')]);
  else rows.push([t('alm_sky_f_sunrise_in'), f.sunrise ? about(_skySpan(f.sunrise - now, guess) + ' \u00b7 ' + at(f.sunrise, f.sunriseAz)) : t('alm_polar_night')]);
  if (f.fullyDark) rows.push([t('alm_sky_f_dark_until'), f.darkUntil ? about(_skyClock(f.darkUntil, guess)) : t('alm_polar_night')]);
  else rows.push([t('alm_sky_f_dark_from'), f.darkFrom ? about(_skyClock(f.darkFrom, guess)) : t('alm_sky_f_not_dark')]);
  var moonNext = f.moonUp ? (f.moonset ? t('alm_sky_f_sets', { t: at(f.moonset, f.moonsetAz) }) : '') : (f.moonrise ? t('alm_sky_f_rises', { t: at(f.moonrise, f.moonriseAz) }) : '');
  rows.push([t('alm_moon'), t('alm_sky_f_moon_lit', { p: _orrNum(s.moonData.phase.illumination, null, 0) + '%' }) + (moonNext ? ' \u00b7 ' + (guess ? about(moonNext) : moonNext) : '')]);
  var a = _skyDeg(Math.abs(lat));
  if (Math.abs(lat) < 2) rows.push([t('alm_sky_f_north'), t('alm_sky_f_equator_val')]);
  else if (lat > 0) rows.push([t('alm_sky_f_north'), t('alm_sky_f_north_val', { a: a })]);
  else rows.push([t('alm_sky_f_south'), t('alm_sky_f_south_val', { a: a })]);
  rows.push([t('alm_sky_f_solar'), about(_skySolarClock(_skySolarMinutes(new Date(now), s.lon), guess))]);
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
  if (_sgReady() && _sg.mwReady) html += '<p class="alm-sky-credit">' + _almEsc(t('alm_sky_credit')) + '</p>';
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

// ══ The place a time zone stands for ═════════════════════════════════════
// Until a place is chosen the sky is drawn for the middle of the device's time
// zone: its most-known city. Latitude and longitude, degrees. (A longitude read
// off the UTC offset put Chicago's sunrise an hour early.)
var SKY_ZONE_PLACES = {
  'America/New_York': [40.71, -74.01], 'America/Detroit': [42.33, -83.05], 'America/Toronto': [43.65, -79.38], 'America/Chicago': [41.88, -87.63],
  'America/Winnipeg': [49.9, -97.14], 'America/Denver': [39.74, -104.99], 'America/Edmonton': [53.55, -113.49], 'America/Boise': [43.62, -116.2],
  'America/Phoenix': [33.45, -112.07], 'America/Los_Angeles': [34.05, -118.24], 'America/Vancouver': [49.28, -123.12], 'America/Anchorage': [61.22, -149.9],
  'Pacific/Honolulu': [21.31, -157.86], 'America/Halifax': [44.65, -63.57], 'America/St_Johns': [47.56, -52.71], 'America/Regina': [50.45, -104.62],
  'America/Mexico_City': [19.43, -99.13], 'America/Bogota': [4.71, -74.07], 'America/Lima': [-12.05, -77.04], 'America/Santiago': [-33.45, -70.67],
  'America/Argentina/Buenos_Aires': [-34.6, -58.38], 'America/Buenos_Aires': [-34.6, -58.38], 'America/Sao_Paulo': [-23.55, -46.63], 'America/Caracas': [10.48, -66.9],
  'America/Havana': [23.11, -82.37], 'America/Panama': [8.98, -79.52], 'America/Guatemala': [14.63, -90.51], 'America/Costa_Rica': [9.93, -84.08],
  'America/La_Paz': [-16.5, -68.15], 'America/Montevideo': [-34.9, -56.16], 'America/Puerto_Rico': [18.47, -66.1], 'America/Jamaica': [18.0, -76.8],
  'America/Indiana/Indianapolis': [39.77, -86.16], 'America/Kentucky/Louisville': [38.25, -85.76], 'America/Guayaquil': [-2.19, -79.89], 'America/Asuncion': [-25.26, -57.58],
  'Europe/London': [51.51, -0.13], 'Europe/Dublin': [53.35, -6.26], 'Europe/Lisbon': [38.72, -9.14], 'Europe/Madrid': [40.42, -3.7], 'Europe/Paris': [48.86, 2.35],
  'Europe/Brussels': [50.85, 4.35], 'Europe/Amsterdam': [52.37, 4.9], 'Europe/Berlin': [52.52, 13.4], 'Europe/Rome': [41.9, 12.5], 'Europe/Zurich': [47.37, 8.54],
  'Europe/Vienna': [48.21, 16.37], 'Europe/Prague': [50.08, 14.44], 'Europe/Warsaw': [52.23, 21.01], 'Europe/Budapest': [47.5, 19.04], 'Europe/Stockholm': [59.33, 18.07],
  'Europe/Oslo': [59.91, 10.75], 'Europe/Copenhagen': [55.68, 12.57], 'Europe/Helsinki': [60.17, 24.94], 'Europe/Athens': [37.98, 23.73], 'Europe/Istanbul': [41.01, 28.98],
  'Europe/Kyiv': [50.45, 30.52], 'Europe/Kiev': [50.45, 30.52], 'Europe/Moscow': [55.76, 37.62], 'Europe/Bucharest': [44.43, 26.1], 'Europe/Sofia': [42.7, 23.32],
  'Europe/Belgrade': [44.8, 20.47], 'Europe/Minsk': [53.9, 27.57], 'Europe/Kaliningrad': [54.71, 20.51], 'Atlantic/Reykjavik': [64.15, -21.94], 'Europe/Zagreb': [45.81, 15.98],
  'Africa/Cairo': [30.04, 31.24], 'Africa/Johannesburg': [-26.2, 28.05], 'Africa/Lagos': [6.52, 3.38], 'Africa/Nairobi': [-1.29, 36.82], 'Africa/Casablanca': [33.57, -7.59],
  'Africa/Algiers': [36.75, 3.06], 'Africa/Accra': [5.6, -0.19], 'Africa/Addis_Ababa': [9.03, 38.74], 'Africa/Khartoum': [15.5, 32.56], 'Africa/Tunis': [36.8, 10.18],
  'Africa/Tripoli': [32.89, 13.19], 'Africa/Dar_es_Salaam': [-6.79, 39.21], 'Africa/Kinshasa': [-4.44, 15.27], 'Africa/Luanda': [-8.84, 13.23], 'Africa/Maputo': [-25.97, 32.57],
  'Africa/Harare': [-17.83, 31.05], 'Africa/Dakar': [14.72, -17.47], 'Africa/Abidjan': [5.36, -4.01],
  'Asia/Dubai': [25.2, 55.27], 'Asia/Riyadh': [24.71, 46.68], 'Asia/Tehran': [35.69, 51.39], 'Asia/Baghdad': [33.31, 44.36], 'Asia/Jerusalem': [31.77, 35.22],
  'Asia/Karachi': [24.86, 67.0], 'Asia/Kolkata': [22.57, 88.36], 'Asia/Calcutta': [22.57, 88.36], 'Asia/Dhaka': [23.81, 90.41], 'Asia/Kathmandu': [27.72, 85.32],
  'Asia/Colombo': [6.93, 79.86], 'Asia/Bangkok': [13.76, 100.5], 'Asia/Ho_Chi_Minh': [10.82, 106.63], 'Asia/Saigon': [10.82, 106.63], 'Asia/Jakarta': [-6.2, 106.85],
  'Asia/Singapore': [1.35, 103.82], 'Asia/Kuala_Lumpur': [3.14, 101.69], 'Asia/Manila': [14.6, 120.98], 'Asia/Hong_Kong': [22.32, 114.17], 'Asia/Shanghai': [31.23, 121.47],
  'Asia/Taipei': [25.03, 121.57], 'Asia/Seoul': [37.57, 126.98], 'Asia/Tokyo': [35.68, 139.69], 'Asia/Yangon': [16.87, 96.2], 'Asia/Tashkent': [41.3, 69.24],
  'Asia/Almaty': [43.24, 76.95], 'Asia/Yekaterinburg': [56.84, 60.6], 'Asia/Novosibirsk': [55.03, 82.92], 'Asia/Vladivostok': [43.12, 131.89], 'Asia/Kabul': [34.53, 69.17],
  'Asia/Baku': [40.41, 49.87], 'Asia/Tbilisi': [41.72, 44.79], 'Asia/Yerevan': [40.18, 44.51], 'Asia/Ulaanbaatar': [47.89, 106.91], 'Asia/Kuwait': [29.38, 47.99],
  'Asia/Qatar': [25.29, 51.53], 'Asia/Beirut': [33.89, 35.5], 'Asia/Amman': [31.95, 35.93], 'Asia/Damascus': [33.51, 36.29], 'Asia/Krasnoyarsk': [56.01, 92.85],
  'Australia/Sydney': [-33.87, 151.21], 'Australia/Melbourne': [-37.81, 144.96], 'Australia/Brisbane': [-27.47, 153.03], 'Australia/Perth': [-31.95, 115.86],
  'Australia/Adelaide': [-34.93, 138.6], 'Australia/Darwin': [-12.46, 130.84], 'Australia/Hobart': [-42.88, 147.33], 'Pacific/Auckland': [-36.85, 174.76],
  'Pacific/Fiji': [-18.14, 178.44], 'Pacific/Port_Moresby': [-9.44, 147.18], 'Pacific/Guam': [13.44, 144.79], 'Pacific/Tongatapu': [-21.14, -175.2], 'Pacific/Apia': [-13.83, -171.76]
};
// The place for an IANA zone name, [lat, lon], or null where the table has none.
function _skyZonePlace(tz) { return (tz && SKY_ZONE_PLACES[tz]) || null; }
