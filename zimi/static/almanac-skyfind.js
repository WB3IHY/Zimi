// Find in the sky: ask for a named thing and be led to it. A planet, a bright
// star, a constellation, the Sun, the Moon, the space station, one of the
// deep-sky objects the sky already names (the Messier ones among them).
//
// Loaded on the first tap of Look's Find button, never with the Almanac: finding
// belongs to the phone-motion view and nowhere else. It adds no catalogue of its
// own: the names and places come from almanac-sky.js (the stars, the figures,
// the deep-sky list, the planets' own orbits, the Moon, the ISS), and a place
// is worked out for the instant and the place being looked at, never kept.
//
// What finding does:
//   - A phone with sensors: an arrow and the distance in degrees to it lead
//     you there, and it is ringed in the sky when it is in view.
//   - No sensors: the view turns to it, and it is ringed.
//   - Under the horizon is as findable as above it: Look shows the whole sphere.
//
// The maths (matching, the place of a thing, the way to it) touches no
// element and is tested alone (tests/test_almanac_skyfind.cjs).

var SF_MAX_RESULTS = 8;
var SF_SUGGEST_MAG = 1.6;          // with nothing typed: the stars this bright that are up are offered with the planets
var SF_IN_VIEW_FRAC = 0.35;        // inside this share of the field of view, from its centre, it is "in view"
var SF_RING_PX = 15;               // the ring round it in the sky (CSS px radius)
var SF_RING_INK = '255,208,128';
var SF_FAINT_PLANETS = ['Uranus', 'Neptune'];   // found by name, never offered: the eye does not see them
var SF_KIND_ORDER = { sun: 0, moon: 0, planet: 1, iss: 2, star: 3, dso: 4, con: 5 };
// Names people also call them by (folded, as typed), by designation: the data's own names are the English ones.
var SF_ALIASES = {
  'M45': ['seven sisters', 'subaru'], 'M31': ['andromeda', 'm 31', 'ngc 224'], 'M42': ['great orion nebula', 'orion nebula', 'ngc 1976'],
  'M44': ['praesepe', 'beehive'], 'NGC 5139': ['omega cen', 'omega centauri'], 'NGC 104': ['47 tuc', '47 tucanae'], 'M13': ['great globular cluster', 'hercules cluster'],
  'M8': ['lagoon'], 'M7': ['ptolemy'], 'M6': ['butterfly'], 'M33': ['triangulum', 'pinwheel galaxy'], 'LMC': ['lmc', 'large magellanic'], 'SMC': ['smc', 'small magellanic'],
  'NGC 3372': ['eta carinae nebula', 'carina'], 'NGC 4755': ['kappa crucis', 'jewel box'], 'M11': ['wild duck'], 'M35': ['m35'], 'Mel 25': ['hyades'], 'Mel 20': ['alpha persei']
};
// The proper names of the catalogue's stars that almanac-sky.js leaves unnamed (by _STARS index): the Big Dipper, Orion's belt,
// Cassiopeia's W, the sting of the Scorpion, the Cross, the Twins and the Dog.
var SF_EXTRA_STAR_NAMES = {
  2: 'Bellatrix', 3: 'Mintaka', 4: 'Alnilam', 5: 'Alnitak', 6: 'Saiph', 8: 'Merak', 9: 'Phecda', 10: 'Megrez', 11: 'Alioth', 12: 'Mizar', 13: 'Alkaid',
  14: 'Caph', 15: 'Schedar', 17: 'Ruchbah', 18: 'Segin', 21: 'Dschubba', 22: 'Graffias', 25: 'Sargas', 31: 'Sadr', 34: 'Albireo', 36: 'Mimosa', 37: 'Gacrux',
  39: 'Castor', 42: 'Mirzam', 43: 'Adhara', 44: 'Wezen', 46: 'Elnath', 57: 'Hamal'
};

// ── Matching ───────────────────────────────────────────────────────────────

// Lower case, accents and marks off, runs of spaces one: "Café" is "cafe".
function _sfFold(s) {
  var out = String(s == null ? '' : s).toLowerCase();
  try { out = out.normalize('NFD').replace(/\p{M}/gu, ''); } catch (e) { /* no unicode property escapes: left as typed */ }
  return out.replace(/\s+/g, ' ').trim();
}
// How well a query matches a folded term: 3 the whole term, 2 its start, 1 the start of a word in it, 0 not at all.
function _sfScoreTerm(q, term) {
  if (!q || !term) return 0;
  if (term === q) return 3;
  if (term.indexOf(q) === 0) return 2;
  return term.indexOf(' ' + q) >= 0 || term.indexOf('-' + q) >= 0 ? 1 : 0;
}
function _sfScore(q, target) {
  var best = 0;
  for (var i = 0; i < target.terms.length; i++) { var k = _sfScoreTerm(q, target.terms[i]); if (k > best) best = k; }
  return best;
}
// The targets that match, the best first: the closer the match, then the brighter and the more familiar kinds (the
// Moon and planets before a faint cluster).
function _sfMatch(list, query, limit) {
  var q = _sfFold(query), out = [];
  if (!q) return out;
  for (var i = 0; i < list.length; i++) { var k = _sfScore(q, list[i]); if (k > 0) out.push({ f: list[i], k: k }); }
  out.sort(function (a, b) {
    return b.k - a.k || SF_KIND_ORDER[a.f.kind] - SF_KIND_ORDER[b.f.kind] || (a.f.mag == null ? 9 : a.f.mag) - (b.f.mag == null ? 9 : b.f.mag) || (a.f.name < b.f.name ? -1 : 1);
  });
  return out.slice(0, limit || SF_MAX_RESULTS).map(function (r) { return r.f; });
}

// Every thing that can be found, in this language: its id, its kind, its name and the words it is found by.
function _sfBuild() {
  var out = [];
  function add(id, kind, name, extra, more) {
    var terms = [_sfFold(name)];
    (extra || []).forEach(function (x) { var f = _sfFold(x); if (f && terms.indexOf(f) < 0) terms.push(f); });
    var f = { id: id, kind: kind, name: name, terms: terms };
    for (var k in more) f[k] = more[k];
    out.push(f);
  }
  add('sun', 'sun', t('alm_sun'), ['Sun'], { mag: -26.7, key: 'planet:sun' });
  add('moon', 'moon', t('alm_moon'), ['Moon', 'Luna'], { mag: -12, key: 'planet:moon' });
  for (var i = 0; i < _VISIBLE_PLANETS.length; i++) {
    var nm = _VISIBLE_PLANETS[i];
    add('planet:' + nm, 'planet', _tp(nm), [nm], { planet: nm, mag: 0 + i * 0.01, faint: SF_FAINT_PLANETS.indexOf(nm) >= 0, key: 'planet:' + nm.toLowerCase() });
  }
  add('iss', 'iss', t('alm_earth_iss_name'), ['ISS', 'International Space Station', 'space station'], { mag: -3 });
  var seen = {};
  for (var s = 0; s < _STARS.length; s++) {
    var name = _STAR_NAMES[s] || SF_EXTRA_STAR_NAMES[s];
    if (!name || seen[name]) continue;
    seen[name] = 1;
    if (name === 'Rigil Kent.') add('star:' + s, 'star', 'Rigil Kentaurus', ['Rigil Kent', 'Alpha Centauri', 'Toliman'], { idx: s, mag: _STARS[s][2], key: _starLinkKey(s) });
    else add('star:' + s, 'star', name, name === 'Polaris' ? ['North Star', 'Pole Star'] : [], { idx: s, mag: _STARS[s][2], key: _starLinkKey(s) });
  }
  for (var d = 0; d < SKY_DSO.length; d++) {
    var o = SKY_DSO[d], designation = o[1], extra = [designation].concat(SF_ALIASES[designation] || []);
    var m = /^M(\d+)$/.exec(designation);
    if (m) extra.push('messier ' + m[1]);
    add('dso:' + d, 'dso', o[0] + ' · ' + designation, extra.concat([o[0]]), { dso: d, mag: o[4] });
  }
  if (typeof _skyConst !== 'undefined' && _skyConst) {
    for (var c = 0; c < _skyConst.length; c++) {
      var con = _skyConst[c];
      add('con:' + con.id, 'con', con.name, [con.gen, con.id], { con: con.id, mag: typeof _skyConMag === 'function' ? _skyConMag(con) : 3 });
    }
  }
  return out;
}

// ── Where it is ────────────────────────────────────────────────────────────

// The altitude and bearing of a found thing at an instant and a place (degrees; the altitude lifted by the air near the
// horizon, as the sky draws it), or null (the space station when it is not above the horizon).
function _sfPosition(f, now, lat, lon) {
  if (!f) return null;
  var T = _jdToJulianCentury(_dateToJD(now.getTime())), P = _skyPrecession(T), lst = _skyLST(now, lon);
  var sinLat = Math.sin(lat * DEG_TO_RAD), cosLat = Math.cos(lat * DEG_TO_RAD), h;
  function at(ra, dec) { return _skyHorizontal(ra, dec, lst, sinLat, cosLat); }
  function ofVec(v) { var rd = _skyRaDec(_skyMul(P, v)); return at(rd.ra, rd.dec); }
  if (f.kind === 'sun') { var sq = _skySunRaDec(T); h = at(sq.ra, sq.dec); return { alt: _skyRefract(h.alt), az: h.az }; }
  if (f.kind === 'moon') { var mp = _moonPosition(now, lat, lon); return { alt: mp.altitude, az: mp.azimuth }; }
  if (f.kind === 'planet') { var pq = _skyPlanet(f.planet, T, P); h = at(pq.ra, pq.dec); return { alt: _skyRefract(h.alt), az: h.az }; }
  if (f.kind === 'star') { h = ofVec(_skyCatalogue()[f.idx].v); return { alt: _skyRefract(h.alt), az: h.az }; }
  if (f.kind === 'dso') { var o = SKY_DSO[f.dso]; h = ofVec(_skyEquVec(o[2], o[3])); return { alt: _skyRefract(h.alt), az: h.az }; }
  if (f.kind === 'con') { var c = _skyConById(f.con); if (!c) return null; h = ofVec(c.vec); return { alt: _skyRefract(h.alt), az: h.az }; }
  if (f.kind === 'iss') { var iss = _skyIss({ lat: lat, lon: lon }, now.getTime()); return iss ? { alt: iss.alt, az: iss.az, km: iss.km } : null; }
  return null;
}
// The same, by id, for the thing that was asked for.
function _sfFindById(id) {
  var list = _sfBuild();
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

// The way from where the phone points to a place in the sky: the angle between them (degrees), the direction on the
// screen (degrees clockwise from straight up), and whether it is near enough the middle to be called in view.
// view: {az, alt, fov} (the field across the screen's width).
function _sfGuide(view, pos) {
  var lens = _skyMakeLens({ az: view.az, alt: view.alt, fov: view.fov || 60 }, 1), h = _skyEnu(pos.az, pos.alt);
  var c = _skyClamp(_skyDot3(h, lens.fwd), -1, 1), sep = Math.acos(c) / DEG_TO_RAD;
  var qx = _skyDot3(h, lens.right), qy = _skyDot3(h, lens.up);
  var angle = (Math.atan2(qx, qy) / DEG_TO_RAD + 360) % 360;
  return { sep: sep, angle: angle, inView: sep < (view.fov || 60) * SF_IN_VIEW_FRAC };
}

// ── What was asked for ─────────────────────────────────────────────────────

var _skyFind = null;          // the thing being found (an item of _sfBuild), or null
var _sfSheet = null;          // the open search sheet's state

// Said in words: where it is.
function _sfWhere(pos) {
  if (!pos) return t('sky_find_iss_down');
  var deg = _skyDeg(Math.abs(pos.alt));
  return pos.alt < 0 ? t('sky_find_below', { d: deg, dir: _azCompass(pos.az) }) : t('sky_find_up', { d: deg, dir: _azCompass(pos.az) });
}
// The instant and the place being looked at: the Look window's (it may be somewhere else), else the Almanac's.
function _sfNow() {
  var loc = typeof _look !== 'undefined' && _look ? _look.place : _getLocation();
  return { now: typeof _almFocusInstant === 'function' ? _almFocusInstant() : new Date(), lat: loc.lat, lon: loc.lon };
}

// Choose a thing: it is ringed, the view leads to it, and where it is is said.
function _sfPick(f, ctx) {
  var at = _sfNow(), pos = _sfPosition(f, at.now, at.lat, at.lon);
  if (f.kind === 'iss' && !pos) return false;
  _skyFind = f;
  if (typeof _look !== 'undefined' && _look && ctx === 'look') _sfLookPick(pos);
  _sfRefresh();
  return true;
}
function _sfClear() {
  _skyFind = null;
  var lk = document.getElementById('sf-look-chip'); if (lk) lk.remove();
  _sfRefresh();
}
// Everything that shows it: the Look window's sky (the ring) and its chip.
function _sfRefresh() {
  if (typeof AlmanacSkyView !== 'undefined' && typeof _look !== 'undefined' && _look && _look.skyMounted) AlmanacSkyView.redraw(_look.skyHost);
  _sfUpdateChips();
}

// ── Drawn where it is ──

// A ring round it in the Look window's sky, over the picture.
function _sfPaintMark(ctx, s) {
  var f = _skyFind;
  if (!f || !s.eph) return;
  var pos = _sfPosition(f, s.now, s.lat, s.lon);
  if (!pos) return;
  var pt = _skyScreen(s, pos.az, pos.alt, 40 * s.dpr);
  if (!pt.visible) return;
  var dpr = s.dpr, r = SF_RING_PX * dpr;
  ctx.save();
  ctx.strokeStyle = 'rgba(' + SF_RING_INK + ',0.95)'; ctx.lineWidth = 1.6 * dpr;
  ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.2 * dpr;
  ctx.beginPath();
  for (var i = 0; i < 4; i++) {
    var a = i * Math.PI / 2 + Math.PI / 4, c = Math.cos(a), n = Math.sin(a);
    ctx.moveTo(pt.x + c * (r + 3 * dpr), pt.y + n * (r + 3 * dpr)); ctx.lineTo(pt.x + c * (r + 8 * dpr), pt.y + n * (r + 8 * dpr));
  }
  ctx.stroke();
  ctx.font = '700 ' + Math.round(10 * dpr) + 'px ' + SKY_FONT; ctx.textBaseline = 'middle';
  var label = f.name, w = ctx.measureText(label).width, right = pt.x + r + 12 * dpr + w < s.W - 4 * dpr;
  ctx.textAlign = right ? 'left' : 'right';
  ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(5,7,12,0.75)';
  var lx = pt.x + (right ? 1 : -1) * (r + 12 * dpr);
  ctx.strokeText(label, lx, pt.y); ctx.fillStyle = 'rgba(' + SF_RING_INK + ',1)'; ctx.fillText(label, lx, pt.y);
  ctx.restore();
}
// ── Chips: what it is, where, and the way to it ──

var SF_ARROW_SVG = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V5M6 11l6-6 6 6"/></svg>';
var SF_RING_SVG = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>';
function _sfChipHtml(f, text, withArrow) {
  return '<span class="sf-chip-ico" id="' + (withArrow ? 'sf-arrow' : 'sf-ring') + '">' + (withArrow ? SF_ARROW_SVG : SF_RING_SVG) + '</span>' +
    '<span class="sf-chip-text"><b>' + _almEsc(f.name) + '</b> <span id="sf-chip-where">' + _almEsc(text) + '</span></span>';
}
function _sfUpdateChips() {
  var old = document.getElementById('sf-look-chip');
  if (old && !_skyFind) old.remove();
  var f = _skyFind, look = typeof _look !== 'undefined' && _look && document.getElementById('almanac-look');
  if (!f || !look) return;
  var at = _sfNow(), pos = _sfPosition(f, at.now, at.lat, at.lon), chip = old;
  var guide = _look.view && pos ? _sfGuide({ az: _look.view.az, alt: _look.view.alt, fov: _look.fov }, pos) : null;
  var text = guide ? (guide.inView ? t('sky_find_here') : t('sky_find_away', { d: _skyDeg(guide.sep) })) : _sfWhere(pos);
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'sf-look-chip'; chip.className = 'sf-chip sf-chip-look'; chip.setAttribute('role', 'status');
    look.appendChild(chip);
    chip.addEventListener('click', function (e) {
      if (e.target.closest('[data-sf-clear]')) { _sfClear(); return; }
      _sfOpen('look');
    });
  }
  var arrow = !!guide && !guide.inView;
  var html = _sfChipHtml(f, text, arrow);
  html += '<button type="button" class="sf-chip-x" data-sf-clear aria-label="' + _almEsc(t('sky_find_clear')) + '">✕</button>';
  if (chip._html !== html) { chip.innerHTML = html; chip._html = html; }
  var ico = document.getElementById('sf-arrow');
  if (ico && guide) ico.style.transform = 'rotate(' + guide.angle.toFixed(1) + 'deg)';
}

// ── The Look window ──

// With sensors the person turns; with none the view turns for them.
function _sfLookPick(pos) {
  var S = _look;
  if (!S || !pos) return;
  if (S.mode !== 'sensor') {
    S.target = { az: pos.az, alt: _skyClamp(pos.alt, -90, 90), roll: 0 };
    S.trim = { az: 0, alt: 0 };
    if (typeof _lookKick === 'function') _lookKick();
  }
}
// Called by the Look window with each new view: the way to it moves.
function _sfLookTick() {
  if (_skyFind && typeof _look !== 'undefined' && _look) _sfUpdateChips();
}

// ── The search sheet ──

function _sfOpen(ctx) {
  if (_sfSheet) { _sfSheet.input.focus(); return; }
  if (typeof _skyLoadConstellations === 'function') _skyLoadConstellations(function () { if (_sfSheet) { _sfSheet.all = _sfBuild(); _sfFill(); } });
  var root = document.createElement('div');
  root.className = 'sf-sheet'; root.id = 'sf-sheet'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', t('sky_find_btn'));
  root.innerHTML = '<div class="sf-bar"><input type="search" class="sf-input" id="sf-input" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go">' +
    '<button type="button" class="look-btn sf-close" id="sf-close" aria-label="' + _almEsc(t('close')) + '">' + LOOK_CLOSE_SVG + '</button></div>' +
    '<ul class="sf-list" id="sf-list" role="listbox"></ul>';
  document.body.appendChild(root);
  var input = root.querySelector('#sf-input');
  input.placeholder = t('sky_find_ph'); input.setAttribute('aria-label', t('sky_find_btn'));
  _sfSheet = { root: root, input: input, ctx: ctx, list: root.querySelector('#sf-list'), items: [], sel: 0, all: _sfBuild() };
  input.addEventListener('input', function () { _sfFill(); });
  input.addEventListener('keydown', _sfKey);
  root.querySelector('#sf-close').addEventListener('click', _sfShut);
  _sfSheet.list.addEventListener('click', function (e) {
    var li = e.target.closest('[data-sf-i]');
    if (li) _sfChoose(+li.getAttribute('data-sf-i'));
  });
  _sfFill();
  input.focus();
}
function _sfShut() {
  var S = _sfSheet;
  if (!S) return;
  _sfSheet = null;
  S.root.remove();
}
function _sfKey(e) {
  var S = _sfSheet;
  if (!S) return;
  if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); _sfShut(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    S.sel = (S.sel + (e.key === 'ArrowDown' ? 1 : -1) + S.items.length) % Math.max(1, S.items.length);
    _sfMarkSel();
  } else if (e.key === 'Enter') { e.preventDefault(); _sfChoose(S.sel); }
}
function _sfMarkSel() {
  var rows = _sfSheet.list.children;
  for (var i = 0; i < rows.length; i++) rows[i].setAttribute('aria-selected', i === _sfSheet.sel ? 'true' : 'false');
}
// With nothing typed: what is up and bright, so the first look is a list of things to find; else what matches.
function _sfSuggest(list, now, lat, lon) {
  var up = [];
  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    if (f.kind === 'con' || f.kind === 'dso' || f.faint) continue;
    if (f.kind === 'star' && f.mag > SF_SUGGEST_MAG) continue;
    var pos = _sfPosition(f, now, lat, lon);
    if (pos && pos.alt > 0) up.push(f);
  }
  up.sort(function (a, b) { return SF_KIND_ORDER[a.kind] - SF_KIND_ORDER[b.kind] || (a.mag || 0) - (b.mag || 0); });
  return up.slice(0, SF_MAX_RESULTS);
}
var SF_KIND_KEYS = { planet: 'sky_find_kind_planet', star: 'sky_find_kind_star', dso: 'sky_find_kind_dso', con: 'sky_find_kind_con', iss: 'sky_find_kind_iss' };
function _sfFill() {
  var S = _sfSheet;
  if (!S) return;
  var at = _sfNow(), q = S.input.value;
  S.items = q.trim() ? _sfMatch(S.all, q, SF_MAX_RESULTS) : _sfSuggest(S.all, at.now, at.lat, at.lon);
  S.sel = 0;
  var html = '';
  for (var i = 0; i < S.items.length; i++) {
    var f = S.items[i], pos = _sfPosition(f, at.now, at.lat, at.lon);
    html += '<li role="option" class="sf-row" data-sf-i="' + i + '" aria-selected="' + (i === 0 ? 'true' : 'false') + '"><span class="sf-name">' + _almEsc(f.name) + '</span>' +
      '<span class="sf-meta">' + (SF_KIND_KEYS[f.kind] ? _almEsc(t(SF_KIND_KEYS[f.kind])) + ' · ' : '') + _almEsc(_sfWhere(pos)) + '</span></li>';
  }
  if (!S.items.length && q.trim()) html = '<li class="sf-none">' + _almEsc(t('sky_find_none')) + '</li>';
  S.list.innerHTML = html;
}
function _sfChoose(i) {
  var S = _sfSheet, f = S && S.items[i];
  if (!f) return;
  var ctx = S.ctx;
  if (_sfPick(f, ctx)) _sfShut();
}

window.AlmanacFind = { open: _sfOpen, clear: _sfClear, pick: _sfPick, pickId: function (id, ctx) { var f = _sfFindById(id); return f ? _sfPick(f, ctx) : false; }, current: function () { return _skyFind; } };
window._sfLookTick = _sfLookTick;
