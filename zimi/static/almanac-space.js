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
