// ── Almanac: the Moon landing ──
// Open the Almanac and the Moon in the hero is the real one, in the live scene:
// the same body, the same light and the same turn as the picture it replaces,
// drawn by the 3D Earth view's scene (almanac-earth.js) into the hero's own
// rectangle.
//
//   first paint   the hero is the picture (an <img>, app.js); nothing here is on
//                 the critical path. Once the view's scene is warm (idle, as it
//                 was for the hand-off), its canvas takes the hero's place under
//                 the same pixels, and goes back when the picture is the one to
//                 show (the time machine's sweeps, a rebuilt header).
//   no WebGL      nothing changes and nothing says the Moon can be taken.
//   drawing       only when the picture changes (the minute's tick, a new moment,
//                 a new place): a mutation on the header says so.
//
// Loaded after almanac-earth.js, whose functions it calls (one global scope).

// ── Styles, with the module ──
var LP_CSS = [
  // The canvas in the hero: over the picture, under the finger (the disc's own handlers take the touch).
  '.lp-in-hero{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;border-radius:50%;cursor:inherit}',
  '.almanac-view.lp-live .almanac-moon{visibility:hidden}',
  '.almanac-view.lp-nogl .almanac-moon-open{cursor:default}'
].join('\n');
function _lpEnsureStyles() {
  if (document.getElementById('lp-style')) return;
  var st = document.createElement('style');
  st.id = 'lp-style';
  st.textContent = LP_CSS;
  document.head.appendChild(st);
}

// ── State ──
var _lpState = {
  hero: null,          // the hero element the view's canvas stands in, or null
  canvas: null,        // the view's canvas, held while it stands in the hero
  drawnMs: null,       // the instant the hero's scene was last drawn for
  watchHead: null, watchHero: null,
  queued: false
};
function _lpById(id) { return document.getElementById(id); }

// ── The hero ──
// The hero's canvas draws the Earth view's own scene in the hero's rectangle: the Moon the
// hand-off already proves is the picture's twin (tests/test_moon_handoff_live.py), with
// the layers that are not the Moon faded out (_aeFadeU is 0) and the camera standing as the
// hand-off's first frame (_aeHandCam). It redraws when the picture beneath it changes (the
// minute's tick, the time machine, a rebuilt header): a mutation on the header says so, so
// the code that draws the picture needs no knowing of it.
function _lpHeroEl() { return document.querySelector(AE_HERO_SEL); }
function _lpPictureShows() {
  return (typeof _heroMoonOverlay !== 'undefined' && !!_heroMoonOverlay) ||
    (typeof _heroMoonAnim !== 'undefined' && !!_heroMoonAnim) ||
    (typeof _heroMoonTravelOn !== 'undefined' && _heroMoonTravelOn);
}
function _lpCanLive() {
  return typeof _aeReady === 'function' && _aeReady() && !_aeIsOpen && !_ae.hand &&
    (typeof _almanacOpen === 'undefined' || _almanacOpen) && !document.hidden;
}
// In a microtask, not a frame: a mutation's callback runs before the page paints, so the scene is drawn in the
// frame the picture changes (a frame later would show the new picture for one frame), and a page that is not
// asking for frames still gets it.
function _lpQueueSync() {
  if (_lpState.queued) return;
  _lpState.queued = true;
  (typeof queueMicrotask === 'function' ? queueMicrotask : function (f) { setTimeout(f, 0); })(_lpSync);
}
// The view's canvas. Held by reference while it stands in the hero: a rebuilt header (innerHTML) takes it out
// of the page with the old hero, and it must be found again to be put back.
function _lpCanvas() { return _lpState.canvas || _lpById('ae-canvas'); }
// The canvas goes back to the view (it is the view's), and the picture shows.
function _lpDetach() {
  var canvas = _lpCanvas(), view = _lpById('almanac-view');
  if (view) view.classList.remove('lp-live');
  if (canvas) {
    canvas.classList.remove('lp-in-hero');
    canvas.removeAttribute('aria-hidden');
    canvas.setAttribute('tabindex', '0');
    if (_ae && _ae.el && canvas.parentNode !== _ae.el) _ae.el.insertBefore(canvas, _ae.el.firstChild);
  }
  _lpState.hero = null;
  _lpForgetOwnMutations();
}
function _lpForgetOwnMutations() {
  if (_lpState.watchHead) _lpState.watchHead.takeRecords();
  if (_lpState.watchHero) _lpState.watchHero.takeRecords();
}
function _lpSync() {
  _lpState.queued = false;
  var hero = _lpHeroEl();
  if (!hero || !hero.offsetWidth || !_lpCanLive() || _lpPictureShows()) { _lpDetach(); _lpWatchHero(); return; }
  _lpDrawHero(hero);
  _lpWatchHero();
}
function _lpDrawHero(hero) {
  var S = _ae.gl, canvas = _lpCanvas(), view = _lpById('almanac-view');
  if (!S || !canvas || !view) return;
  _lpEnsureStyles();
  var w = hero.offsetWidth, h = hero.offsetHeight, ms = _aeDisplayMs();
  _lpState.canvas = canvas;
  if (canvas.parentNode !== hero) hero.appendChild(canvas);
  canvas.classList.add('lp-in-hero');
  // In the hero it is the picture's twin, not a control or a second picture to a screen reader: the view's own
  // description of it (set while the view is open) and its place in the tab order go with it.
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('tabindex', '-1');
  canvas.removeAttribute('aria-label');
  S.renderer.setSize(w, h, false);
  // The view's own numbers, put back as they were: the hero is drawn as the hand-off's first frame.
  var keep = { w: _ae.w, h: _ae.h, hand: _ae.hand, axis: _ae.axis, fade: _aeFadeU.value, scene: _ae.scene };
  try {
    _ae.w = w; _ae.h = h; _ae.axis = null;
    _ae.hand = { dir: 1, frame: { x: 0, y: 0, w: w, h: h }, daz: 0, del: 0, e0: 0, e: 0, xfade: false };
    _aeFadeU.value = 0;
    _ae.scene = _aeSceneAt(ms);
    _aeUpdate(ms);
    S.renderer.render(S.scene, S.camera);
  } finally {
    _ae.w = keep.w; _ae.h = keep.h; _ae.hand = keep.hand; _ae.axis = keep.axis; _aeFadeU.value = keep.fade; _ae.scene = keep.scene;
  }
  view.classList.add('lp-live');
  _lpState.hero = hero;
  _lpState.drawnMs = ms;
  _lpForgetOwnMutations();
}
// Watch the header (a rebuild) and the hero (the picture changing, a sweep's overlay coming and going).
function _lpWatchHero() {
  var head = _lpById('almanac-head');
  if (!head || typeof MutationObserver !== 'function') return;
  if (!_lpState.watchHead) {
    _lpState.watchHead = new MutationObserver(_lpQueueSync);
  }
  _lpState.watchHead.disconnect();
  _lpState.watchHead.observe(head, { childList: true });
  var hero = head.querySelector('.almanac-hero');
  if (!_lpState.watchHero) _lpState.watchHero = new MutationObserver(_lpQueueSync);
  _lpState.watchHero.disconnect();
  if (hero) _lpState.watchHero.observe(hero, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'style', 'class', 'data-k', 'data-limb', 'data-l', 'data-b'] });
}
// No WebGL here: the hero is the picture it always was, and nothing about it says it can be pulled.
function _lpUnsupported() {
  _lpEnsureStyles();
  var view = _lpById('almanac-view');
  if (view) view.classList.add('lp-nogl');
}
// The view's scene is ready (_aePrepare): the hero can be the live Moon.
function _lpWarmed() { _lpQueueSync(); }
// The Earth view opens: its canvas goes home first; closes: the hero takes the Moon back.
function _lpBeforeShow() { _lpDetach(); }
function _lpAfterClose() { _lpSync(); }
// Leaving the Almanac: nothing of the hero's is kept.
function _lpRelease() {
  if (_lpState.watchHead) { _lpState.watchHead.disconnect(); }
  if (_lpState.watchHero) { _lpState.watchHero.disconnect(); }
  _lpDetach();
  _lpState.canvas = null;
  _lpState.axis = null; _lpState.ax = null; _lpState.gesture = null;
  if (_ae) _ae.axis = null;
}
