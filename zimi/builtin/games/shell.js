/* ZimiGames: the shell every game shares. Our own code, GPL-3.0. No network, no modules.

   One bar (back, title, the clock, Undo or Pause, Menu) and one Menu sheet with the same
   rows in every game: New game, Settings, How to play, Watch and learn, Stats.

   It loads synchronously in <head> (scripts/games_shell.py writes the tag), so the settings
   are on <html> before the first paint; the bar and the sheet are built when the page is
   ready. A game's own buttons are not rewritten: the shell moves them into the Menu and
   clicks the originals, so every game's own code keeps working as it was.

   A game may tell the shell more (all optional):
     ZimiShell.game({ stats: fn -> text or [text], sound: true, hints: true, inProgress: fn,
                      menu: fn -> { options: [nodes] }, newGame: fn,
                      moveTimer: true, watch: { script, start(ctl), stop(kind) } })
   and reads the settings with ZimiShell.settings.get('anim'), etc. */
(function (root) {
  'use strict';
  var d = root.document;
  // An app, not a page to read: a reader (Zimi's) leaves out highlight, note and lookup.
  if (d.head && !d.querySelector('meta[name="zimi-app"]')) {
    var app = d.createElement('meta'); app.name = 'zimi-app'; d.head.appendChild(app);
  }
  var KEY = 'zimi.games.settings';
  var DEFAULTS = { timer: 'show', moveTimer: 0, hints: 'on', anim: 'normal', sound: 'off', confirm: 'on' };
  var CHOICES = {
    timer: [['show', 'Shown'], ['hide', 'Hidden']],
    moveTimer: [[0, 'Off'], [15, '15 s'], [30, '30 s'], [60, '60 s']],
    hints: [['on', 'On'], ['off', 'Off']],
    anim: [['normal', 'Normal'], ['fast', 'Fast'], ['off', 'Off']],
    sound: [['off', 'Off'], ['on', 'On']],
    confirm: [['on', 'On'], ['off', 'Off']]
  };
  var LABELS = { timer: 'Timer', moveTimer: 'Move timer', hints: 'Hints', anim: 'Animation', sound: 'Sound', confirm: 'Confirm new game' };
  // Elements that are only a clock (a clock with a score in it is trimmed by stripClock instead).
  var TIMER_SELECTOR = '#su-clock, #mj-time, [data-gs-timer]';
  var CLOCK_PREFIX = /^\d+:\d\d(?: · )?/;
  var HINT_SELECTOR = '[id$="-hint"], [id$="-hints"]';
  var SPEEDS = [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']];
  var MOVE_TIMER_TICK_MS = 250;

  // ── the page ──
  var ID = (root.location.pathname.split('/').pop() || '').replace(/\.html?$/, '') || 'index';
  var Shell = { id: ID };
  root.ZimiShell = Shell;

  function h(tag, attrs, kids) {
    var e = d.createElement(tag), k;
    for (k in (attrs || {})) {
      if (k === 'text') e.textContent = attrs[k]; else if (k === 'class') e.className = attrs[k]; else if (k === 'onclick') e.addEventListener('click', attrs[k]); else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (n) { if (n) e.appendChild(typeof n === 'string' ? d.createTextNode(n) : n); });
    return e;
  }

  // ── settings: global, with per-game overrides ──
  var data = { g: {}, games: {} };
  function load() {
    try {
      var v = JSON.parse(root.localStorage.getItem(KEY));
      data = { g: (v && v.g) || {}, games: (v && v.games) || {} };
    } catch (e) { data = { g: {}, games: {} }; }
  }
  function save() { try { root.localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* private window: settings last for this page */ } }
  function reducedMotion() { try { return !!root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function valid(key, value) { return (CHOICES[key] || []).some(function (c) { return c[0] === value; }); }

  var listeners = [];
  var settings = Shell.settings = {
    // The value in force for a game: its own choice, else the global one, else the default.
    get: function (key, game) {
      var o = (data.games[game || ID] || {})[key];
      if (valid(key, o)) return o;
      if (valid(key, data.g[key])) return data.g[key];
      return key === 'anim' && reducedMotion() ? 'off' : DEFAULTS[key];
    },
    // Has anybody chosen this (so a game should not override it with its own default)?
    explicit: function (key, game) { return valid(key, (data.games[game || ID] || {})[key]) || valid(key, data.g[key]); },
    hasOverride: function (key, game) { return valid(key, (data.games[game || ID] || {})[key]); },
    // scope 'all' (default) or 'game'. Choosing for all games drops this game's own choice.
    set: function (key, value, scope) {
      if (!valid(key, value)) return;
      if (scope === 'game') { (data.games[ID] = data.games[ID] || {})[key] = value; }
      else { data.g[key] = value; if (data.games[ID]) delete data.games[ID][key]; }
      save(); apply(); emit(key);
    },
    // Forget this game's own choices.
    reset: function (game) { delete data.games[game || ID]; save(); apply(); emit('*'); },
    hasOverrides: function (game) { return Object.keys(data.games[game || ID] || {}).length > 0; },
    on: function (fn) { listeners.push(fn); },
    off: function (fn) { listeners = listeners.filter(function (f) { return f !== fn; }); },
    reload: function () { load(); apply(); emit('*'); }
  };
  function emit(key) { listeners.slice().forEach(function (fn) { try { fn(key); } catch (e) { /* a listener must not stop the others */ } }); }

  // The settings as attributes on <html>, for the stylesheet.
  function apply() {
    var r = d.documentElement;
    r.setAttribute('data-timer', settings.get('timer'));
    r.setAttribute('data-anim', settings.get('anim'));
    r.setAttribute('data-hints', settings.get('hints'));
    r.setAttribute('data-sound', settings.get('sound'));
  }
  load(); apply();
  d.documentElement.classList.add('gs');
  root.addEventListener('storage', function (e) { if (e.key === KEY) settings.reload(); });

  // Animation helpers for games that time things in script.
  var SPEED_SCALE = { normal: 1, fast: 0.35, off: 0 };
  Shell.anim = function () { return settings.get('anim'); };
  Shell.ms = function (ms) { return Math.round(ms * SPEED_SCALE[settings.get('anim')]); };
  // A clock's text without its time when the timer is hidden ("0:42 · 12" becomes "12").
  Shell.stripClock = function (text) { return settings.get('timer') === 'hide' ? String(text).replace(CLOCK_PREFIX, '') : text; };
  Shell.sound = function () { return settings.get('sound') === 'on'; };

  // ── what a game tells us ──
  var game = Shell.gameInfo = {};
  Shell.game = function (info) { Object.keys(info || {}).forEach(function (k) { game[k] = info[k]; }); return Shell; };

  // ── the narrator: one line under the bar while a demo runs ──
  var strip = null;
  Shell.narrate = function (text) {
    var el = strip && strip.querySelector('.gs-watch-text');
    if (el) el.textContent = text || '';
  };

  // ── the move timer: a thin bar under the bar, for a person's turn ──
  var mt = { key: undefined, timer: 0, left: 0, total: 0, expire: null, bar: null, label: null, held: false };
  Shell.moveTimer = {
    supported: function () { return !!game.moveTimer; },
    seconds: function () { return +settings.get('moveTimer') || 0; },
    // Begin a person's turn. onExpire runs when the time is up.
    start: function (onExpire) {
      Shell.moveTimer.stop();
      var secs = Shell.moveTimer.seconds();
      if (!secs || !mt.bar) return;
      mt.total = mt.left = secs * 1000; mt.expire = onExpire;
      mt.bar.hidden = false; paintTimer();
      mt.timer = root.setInterval(function () {
        if (mt.held || d.hidden) return;
        mt.left -= MOVE_TIMER_TICK_MS; paintTimer();
        if (mt.left <= 0) { var f = mt.expire; Shell.moveTimer.stop(); if (f) f(); }
      }, MOVE_TIMER_TICK_MS);
    },
    stop: function () { root.clearInterval(mt.timer); mt.timer = 0; mt.key = undefined; mt.expire = null; if (mt.bar) mt.bar.hidden = true; },
    hold: function (on) { mt.held = !!on; }
  };
  // A person's turn begins (active) or the turn is not a person's: one call for both.
  // `key` names the turn (a move count): the same turn asked again keeps its clock running.
  Shell.turn = function (active, onExpire, key) {
    if (!active) { Shell.moveTimer.stop(); return; }
    if (mt.timer && mt.key === key && key !== undefined) return;
    Shell.moveTimer.start(onExpire); mt.key = key;
  };
  function paintTimer() {
    var frac = Math.max(0, mt.left / mt.total);
    mt.bar.firstChild.style.transform = 'scaleX(' + frac + ')';
    mt.label.textContent = Math.ceil(Math.max(0, mt.left) / 1000) + ' s';
    mt.bar.classList.toggle('gs-low', mt.left <= 5000);
  }

  // ── the bar ──
  var bar, menuBtn, newBtn, extras = [], holder, hasUndo = false;
  function isNewLike(b) { return /(^|-)(new|menu|level|newgame)$/.test(b.id) || /^new\b/i.test(b.textContent.trim()); }
  function keepInBar(b) { return /undo$/.test(b.id) || /pause$/.test(b.id) || b.id === 'ms-flagmode'; }
  function buildBar() {
    bar = d.querySelector('.ar-bar');
    if (!bar) return false;
    var controls = Array.prototype.filter.call(bar.children, function (c) { return c.classList.contains('ar-btn'); });
    controls.forEach(function (b) {
      if (/undo$/.test(b.id)) hasUndo = true;
      if (keepInBar(b)) return;
      if (b.id === 'zc-menu') { b.hidden = true; return; }
      if (!newBtn && isNewLike(b)) { newBtn = b; b.hidden = true; return; }
      if (isNewLike(b)) { b.hidden = true; return; }
      extras.push(b);
    });
    // Out of the bar at once; the Menu puts them back in its own sheet.
    holder = h('div', { hidden: '' }, extras);
    d.body.appendChild(holder);
    // Timers are only a clock: tagged here so the stylesheet can hide them.
    Array.prototype.forEach.call(d.querySelectorAll(TIMER_SELECTOR), function (t) { t.setAttribute('data-gs-timer', ''); });
    menuBtn = h('button', { class: 'ar-btn gs-menu-btn', type: 'button', 'aria-haspopup': 'dialog', text: 'Menu' });
    menuBtn.addEventListener('click', openMenu);
    // The clock sits before the buttons, the Menu last.
    var firstBtn = Array.prototype.filter.call(bar.children, function (c) { return c.classList.contains('ar-btn') && !c.hidden; })[0];
    Array.prototype.forEach.call(bar.querySelectorAll('.ar-stat'), function (s) { bar.insertBefore(s, firstBtn || null); });
    bar.appendChild(menuBtn);
    // The move timer's thin bar, right under the header.
    mt.label = h('span', { class: 'gs-turn-n', 'aria-hidden': 'true' });
    mt.bar = h('div', { class: 'gs-turn', hidden: '', 'aria-hidden': 'true' }, [h('i'), mt.label]);
    bar.parentNode.insertBefore(mt.bar, bar.nextSibling);
    strip = h('div', { class: 'gs-watch', hidden: '', role: 'region', 'aria-label': 'Watch and learn' });
    mt.bar.parentNode.insertBefore(strip, mt.bar.nextSibling);
    return true;
  }

  function titleOf() {
    var t = d.querySelector('.ar-bar h1'), s = '';
    if (!t) return d.title.replace(/ - ZimiGames$/, '');
    Array.prototype.forEach.call(t.childNodes, function (n) { if (n.nodeType === 3) s += n.nodeValue; });
    return s.trim() || d.title;
  }

  // ── the Menu sheet ──
  var sheet, card, paneStack = [], opener = null, watchPaused = false;
  function ensureSheet() {
    if (sheet) return;
    card = h('div', { class: 'ar-sheet-card gs-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': titleOf() + ' menu' });
    sheet = h('div', { class: 'ar-sheet gs-sheet', hidden: '' }, [card]);
    sheet.addEventListener('pointerdown', function (e) { if (e.target === sheet) closeMenu(); });
    sheet.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (paneStack.length > 1) back(); else closeMenu(); return; }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(card.querySelectorAll('button:not([disabled]),input:not([disabled])'), function (n) { return n.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    d.body.appendChild(sheet);
  }
  function openMenu() {
    ensureSheet();
    if (!sheet.hidden) return;
    opener = d.activeElement;
    // A running arcade game waits while the menu is open.
    var pause = d.querySelector('.ar-bar [id$="pause"]');
    if (pause && /^pause/i.test(pause.textContent.trim())) { try { pause.click(); } catch (e) { /* not running */ } }
    Shell.moveTimer.hold(true); Shell.watchHold(true);
    paneStack = [];
    sheet.hidden = false;
    show(rootPane);
  }
  function closeMenu() {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true; paneStack = [];
    Shell.moveTimer.hold(false); Shell.watchHold(false);
    if (opener && opener.focus && d.contains(opener)) try { opener.focus(); } catch (e) { /* gone */ }
  }
  Shell.openMenu = openMenu; Shell.closeMenu = closeMenu;

  // A pane is a function that fills the card: show(fn) pushes it, back() pops.
  function show(fn) { paneStack.push(fn); render(); }
  function back() { paneStack.pop(); render(); }
  function render() {
    var fn = paneStack[paneStack.length - 1];
    card.textContent = '';
    fn();
    var f = card.querySelector('.gs-primary') || card.querySelector('button, input');
    if (f) try { f.focus({ preventScroll: true }); } catch (e) { /* no focus */ }
  }
  function head(title, isRoot) {
    var row = h('div', { class: 'gs-head' + (isRoot ? ' gs-head-root' : '') });
    if (!isRoot) row.appendChild(h('button', { class: 'gs-back', type: 'button', 'aria-label': 'Back to menu', onclick: back }));
    row.appendChild(h('h2', { text: title }));
    row.appendChild(h('button', { class: 'gs-x', type: 'button', 'aria-label': 'Close menu', onclick: closeMenu }));
    card.appendChild(row);
  }

  function hasHints() { return !!game.hints || !!d.querySelector(HINT_SELECTOR); }
  function hasTimer() { return !!d.querySelector('#zc-stat') || !!d.querySelector(TIMER_SELECTOR); }
  function hasBacks() { return !!(root.ZimiCards && root.ZimiCards.backsSheet && d.querySelector('.zc-table')); }
  var DIRTY_EVENTS = ['pointerdown', 'keydown'];
  var dirty = false;
  function markDirty(e) { if (e.target && e.target.closest && e.target.closest('main, .zc-table, [role="main"], #stage, canvas')) dirty = true; }
  function underway() { return game.inProgress ? !!game.inProgress() : dirty; }

  // Start a new game: confirm when one is under way, then through the game's own control.
  function startNew() {
    var go = function () { dirty = false; closeMenu(); stopWatching('new'); if (newBtn) newBtn.click(); };
    if (underway() && settings.get('confirm') === 'on') { show(confirmPane(go)); } else go();
  }
  function confirmPane(go) {
    return function () {
      head('Start a new game?', false);
      card.appendChild(h('p', { class: 'gs-text', text: 'The game you are playing will be lost.' }));
      card.appendChild(h('div', { class: 'gs-actions' }, [
        h('button', { class: 'ar-btn', type: 'button', text: 'Keep playing', onclick: back }),
        h('button', { class: 'ar-btn gs-primary', type: 'button', 'aria-pressed': 'true', text: 'New game', onclick: go })
      ]));
    };
  }

  function seg(key, opts) {
    var value = settings.get(key), row = h('div', { class: 'gs-seg', role: 'group', 'aria-label': LABELS[key] });
    CHOICES[key].forEach(function (c) {
      row.appendChild(h('button', { class: 'ar-btn', type: 'button', 'aria-pressed': String(c[0] === value), text: c[1], onclick: function () { opts.onPick(key, c[0]); } }));
    });
    return row;
  }
  function chevronRow(label, hint, onclick) {
    return h('button', { class: 'gs-item', type: 'button', onclick: onclick }, [h('span', { class: 'gs-item-l', text: label }), h('span', { class: 'gs-item-r', text: hint || '' })]);
  }

  // The root: the primary action, the game's own buttons, then the same list in every game.
  function rootPane() {
    head(titleOf(), true);
    var options = menuOptions();
    if (newBtn) card.appendChild(h('button', { class: 'ar-btn gs-new gs-primary', type: 'button', 'aria-pressed': 'true', text: options.length ? 'New game…' : 'New game', onclick: options.length ? function () { show(newPane); } : startNew }));
    if (extras.length) {
      var box = h('div', { class: 'gs-actions gs-extras' });
      extras.forEach(function (b) { b.classList.add('gs-moved'); box.appendChild(b); });
      card.appendChild(box);
      if (!box.dataset.wired) { box.dataset.wired = '1'; box.addEventListener('click', function (e) { if (e.target.closest('.ar-btn')) closeMenu(); }); }
    }
    var list = h('div', { class: 'gs-list' });
    list.appendChild(chevronRow('Settings', summary(), function () { show(settingsPane); }));
    if (helpFor(ID)) list.appendChild(chevronRow('How to play', '', function () { show(helpPane); }));
    if (historyFor(ID)) list.appendChild(chevronRow('History', '', function () { show(historyPane); }));
    if (game.watch) list.appendChild(chevronRow('Watch and learn', watching ? 'Running' : '', function () { show(watchPane); }));
    list.appendChild(chevronRow('Stats', '', function () { show(statsPane); }));
    card.appendChild(list);
  }
  function summary() {
    var bits = [];
    if (settings.get('anim') !== 'normal') bits.push('Animation ' + settings.get('anim'));
    if (hasTimer() && settings.get('timer') === 'hide') bits.push('Timer hidden');
    return bits.join(', ');
  }

  // New game with the game's own options (cards: draw one or three, players), then Start.
  var capturedOptions = null;
  function menuOptions() {
    capturedOptions = null;
    if (game.menu) {
      try { capturedOptions = game.menu() || null; } catch (e) { capturedOptions = null; }
    }
    return capturedOptions ? capturedOptions.options : [];
  }
  function newPane() {
    head('New game', false);
    var box = h('div', { class: 'gs-options' });
    (capturedOptions ? capturedOptions.options : []).forEach(function (n) { box.appendChild(n); });
    card.appendChild(box);
    card.appendChild(h('div', { class: 'gs-actions' }, [
      h('button', { class: 'ar-btn', type: 'button', text: 'Cancel', onclick: back }),
      h('button', { class: 'ar-btn gs-primary', type: 'button', 'aria-pressed': 'true', text: 'Start', onclick: startNew })
    ]));
  }

  function settingsPane() {
    head('Settings', false);
    var scope = paneState.scope || 'all';
    function pick(key, value) { settings.set(key, value, paneState.scope === 'game' ? 'game' : 'all'); render(); }
    function row(key, note) {
      card.appendChild(h('div', { class: 'gs-row' }, [h('label', { text: LABELS[key] }), seg(key, { onPick: pick }), note ? h('p', { class: 'gs-note', text: note }) : null]));
    }
    card.appendChild(h('div', { class: 'gs-scope' }, [
      h('span', { text: 'Applies to' }),
      h('div', { class: 'gs-seg', role: 'group', 'aria-label': 'Applies to' }, [
        h('button', { class: 'ar-btn', type: 'button', 'aria-pressed': String(scope === 'all'), text: 'All games', onclick: function () { paneState.scope = 'all'; render(); } }),
        h('button', { class: 'ar-btn', type: 'button', 'aria-pressed': String(scope === 'game'), text: 'This game only', onclick: function () { paneState.scope = 'game'; render(); } })
      ])
    ]));
    if (hasTimer()) row('timer');
    if (game.moveTimer) row('moveTimer', 'Time for each of your turns. When it runs out, a move is played for you.');
    if (hasHints()) row('hints');
    row('anim', reducedMotion() && !settings.explicit('anim') ? 'Off now, because your device asks for less motion.' : '');
    if (game.sound) row('sound');
    if (newBtn) row('confirm');
    if (hasBacks()) {
      card.appendChild(h('div', { class: 'gs-row' }, [h('label', { text: 'Card back' }), h('button', { class: 'ar-btn', type: 'button', text: 'Choose…', onclick: function () { closeMenu(); root.ZimiCards.backsSheet(); } })]));
    }
    if (settings.hasOverrides()) {
      card.appendChild(h('button', { class: 'gs-link', type: 'button', text: 'Use the settings for all games', onclick: function () { settings.reset(); render(); } }));
    }
  }
  var paneState = {};

  // How to play: goal, a turn, the end, a tip; the page's old key hint last.
  // The data for this game, with any part the game itself overrides (Mancala's two rule sets).
  function helpFor(id) {
    var base = root.ZimiGamesHelp && root.ZimiGamesHelp[id];
    if (!base) return null;
    var own = game.help ? game.help() : null;
    return own ? Object.assign({}, base, own) : base;
  }
  var HELP_PARTS = [['goal', 'Goal'], ['turn', 'Your turn'], ['end', 'The end'], ['tip', 'Tip']];
  function keysLine() {
    var p = d.querySelector('.bg-help'), s = '';
    if (!p) return '';
    (p.textContent.match(/[^.]+\./g) || []).forEach(function (t) { if (/\bkeys?\b|\bEnter\b|\bpress\b/i.test(t)) s += t.trim() + ' '; });
    return s.trim();
  }
  function helpPane() {
    head('How to play', false);
    var hp = helpFor(ID), dl = h('dl', { class: 'gs-help' });
    HELP_PARTS.forEach(function (p) { if (hp[p[0]]) { dl.appendChild(h('dt', { text: p[1] })); dl.appendChild(h('dd', { text: hp[p[0]] })); } });
    var keys = hp.keys || keysLine();
    if (keys) { dl.appendChild(h('dt', { text: 'Keys' })); dl.appendChild(h('dd', { text: keys })); }
    card.appendChild(dl);
  }

  // History: a few plain sentences, then the facts games.json holds about the game, if it has any.
  var META_KEYS = [['origin', 'Origin'], ['era', 'Era'], ['year', 'Year'], ['region', 'Region'], ['players', 'Players'], ['length', 'Length']];
  function historyFor(id) { return root.ZimiGamesHistory && root.ZimiGamesHistory[id]; }
  function historyPane() {
    head('History', false);
    card.appendChild(h('p', { class: 'gs-text gs-history', text: historyFor(ID) }));
    var facts = h('dl', { class: 'gs-help gs-meta' });
    card.appendChild(facts);
    if (!root.fetch) return;
    root.fetch('games.json').then(function (r) { return r.json(); }).then(function (rows) {
      var row = (rows || []).filter(function (x) { return x.path === ID + '.html'; })[0], m = row && (row.meta || row) || {};
      META_KEYS.forEach(function (k) {
        var v = m[k[0]];
        if (v === undefined || v === null || v === '' || !facts.isConnected) return;
        facts.appendChild(h('dt', { text: k[1] })); facts.appendChild(h('dd', { text: Array.isArray(v) ? v.join(', ') : String(v) }));
      });
    }).catch(function () { /* no metadata: the history stands alone */ });
  }

  function statsPane() {
    head('Stats', false);
    var lines = [], s = game.stats ? game.stats() : null;
    if (s) lines = [].concat(s);
    else {
      var el = d.querySelector('.bg-stats, .zc-stats, #wk-stats');
      if (el && el.textContent.trim()) lines = [el.textContent.trim()];
    }
    lines = lines.filter(function (t) { return t && String(t).trim(); });
    if (!lines.length) lines = ['Nothing yet. Finish a game and it shows here.'];
    card.appendChild(h('div', { class: 'gs-stats' }, lines.map(function (t) { return h('p', { text: String(t).trim() }); })));
  }

  // ── Watch and learn (the driver is in watch.js, fetched when first wanted) ──
  var watching = false, watchApi = null;
  Shell.isWatching = function () { return watching; };
  Shell.watchHold = function (on) { if (watchApi && watchApi.hold) watchApi.hold(on); };
  function watchPane() {
    head('Watch and learn', false);
    if (watching) {
      card.appendChild(h('p', { class: 'gs-text', text: 'The computer is playing both sides. Use the bar under the title to pause, step or take over.' }));
      card.appendChild(h('div', { class: 'gs-actions' }, [h('button', { class: 'ar-btn gs-primary', type: 'button', 'aria-pressed': 'true', text: 'Stop watching', onclick: function () { closeMenu(); stopWatching('stop'); } })]));
      return;
    }
    card.appendChild(h('p', { class: 'gs-text', text: 'The computer plays both sides and explains each move. You can pause, step or take over at any time.' }));
    card.appendChild(h('div', { class: 'gs-actions' }, [h('button', { class: 'ar-btn gs-primary', type: 'button', 'aria-pressed': 'true', text: 'Start watching', onclick: function () { closeMenu(); startWatching(); } })]));
  }
  function loadScript(src, done) {
    var s = d.createElement('script'); s.src = src; s.onload = function () { done(); }; s.onerror = function () { done(new Error(src)); };
    d.head.appendChild(s);
  }
  function startWatching() {
    var go = function (err) {
      if (err || !root.ZimiWatch) { return; }
      watching = true; watchApi = root.ZimiWatch.create({ strip: strip, game: game, id: ID, stop: stopWatching });
      d.documentElement.classList.add('gs-watching');
      watchApi.begin();
    };
    var need = [game.watch.script].filter(Boolean);
    loadScript('watch.js', function (err) {
      if (err) return go(err);
      if (!need.length || root.ZimiExplain && root.ZimiExplain[ID]) return go();
      loadScript(need[0], go);
    });
  }
  // kind: 'takeover' keeps the position and lets the person play on; 'stop' and 'new' end the demo.
  function stopWatching(kind) {
    if (!watching) return;
    watching = false; d.documentElement.classList.remove('gs-watching');
    var api = watchApi; watchApi = null;
    if (api) api.end(kind);
    if (game.watch && game.watch.stop) game.watch.stop(kind);
  }
  Shell.stopWatching = stopWatching;

  // ── start ──
  function ready() {
    if (!buildBar()) return;
    DIRTY_EVENTS.forEach(function (t) { d.addEventListener(t, markDirty, true); });
    d.documentElement.classList.add('gs-ready');
    if (helpFor(ID)) d.documentElement.classList.add('gs-help');
    // Settings that a game paints itself (a clock's text) are repainted when they change.
    settings.on(function () { if (game.paint) game.paint(); });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', ready); else ready();
})(typeof globalThis !== 'undefined' ? globalThis : window);
