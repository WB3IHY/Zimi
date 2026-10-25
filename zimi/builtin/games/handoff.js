/* ZimiGames: people sharing one device. Each seat of a game is the Computer or a Person; with
   two or more people a full-screen "Pass to <name>" screen hides the hand until the next person
   taps "I'm <name>, show my cards". Computer seats play in between without a handoff. Names are
   editable and remembered (zimi.games.players), seat kinds per game (zimi.games.<id>.seats).
   Our own code, GPL-3.0. No network, no modules; the rules half is pure and tested in node.

   A page asks:  var seats = ZimiSeats.create({ id: 'hearts', seats: 4 });
     seats.person(s)         is this seat a person at the screen?
     seats.view()            the seat whose hand is face up now (it sits at the bottom)
     seats.rel(s)            where seat s sits on screen, 0 bottom, then clockwise
     seats.name(s)           "You" (one person), the person's name, or the computer's name
     seats.needsCover(s)     true when seat s is a person other than the one looking
     seats.cover(s, done)    show the handoff, then call done
     seats.begin(done, first) a fresh deal: nobody has seen it yet
     seats.block(onChange)   the Players rows for the New game sheet */
(function (root) {
  'use strict';
  var PREFIX = 'zimi.games.', NAMES_KEY = PREFIX + 'players', MAX_NAME = 14;
  var COMPASS = { 2: ['South', 'North'], 3: ['South', 'West', 'East'], 4: ['South', 'West', 'North', 'East'] };

  // ── storage (guarded: private mode and blocked data must not stop a game) ──
  function read(key, fallback) {
    try { var v = JSON.parse(root.localStorage.getItem(key)); return v && typeof v === 'object' ? v : fallback; } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { root.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* play on without it */ }
  }

  // ── pure rules ──
  function defaultName(i) { return 'Player ' + (i + 1); }
  function cleanName(text, i) {
    var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    return t || defaultName(i);
  }
  // A seat list of n kinds: only 'person' or 'cpu', and at least one person (seat 0 by default).
  function cleanKinds(kinds, n) {
    var out = [], i;
    for (i = 0; i < n; i++) out.push(kinds && kinds[i] === 'cpu' ? 'cpu' : kinds && kinds[i] === 'person' ? 'person' : i === 0 ? 'person' : 'cpu');
    if (out.indexOf('person') < 0) out[0] = 'person';
    return out;
  }
  function peopleOf(kinds) { return kinds.map(function (k, i) { return k === 'person' ? i : -1; }).filter(function (i) { return i >= 0; }); }
  // Where seat s sits when seat `view` is at the bottom of an n-seat table: 0 bottom, then clockwise.
  function relOf(seat, view, n) { return (seat - view + n) % n; }
  // Should the handoff come up before `seat` plays? Only for a second person, never for a
  // computer, never for the person already looking.
  function needsCover(kinds, viewer, seat) {
    return peopleOf(kinds).length >= 2 && kinds[seat] === 'person' && viewer !== seat;
  }
  function compassName(n, rel) { return (COMPASS[n] || COMPASS[4])[rel]; }
  function loadNames(count) {
    var saved = read(NAMES_KEY, []), out = [], i;
    for (i = 0; i < count; i++) out.push(cleanName(Array.isArray(saved) ? saved[i] : '', i));
    return out;
  }

  // ── styles (injected, so a page needs only the script) ──
  var CSS = '.zs-cover{position:fixed;inset:0;z-index:90;display:grid;place-items:center;padding:24px;background:var(--ground,#eef0f3);color:var(--ink,#1d2433);text-align:center;font-family:var(--font,system-ui,sans-serif)}' +
    '.zs-cover-card{width:min(420px,100%);display:grid;gap:14px;justify-items:center}' +
    '.zs-cover img{width:44px;height:44px}' +
    '.zs-cover small{font-size:13px;color:var(--ink2,#4b5568);letter-spacing:.04em;text-transform:uppercase}' +
    '.zs-cover h2{margin:0;font-size:34px;line-height:1.15;overflow-wrap:anywhere}' +
    '.zs-cover p{margin:0;color:var(--ink2,#4b5568);font-size:15px}' +
    '.zs-btn{font:inherit;font-size:15px;min-height:44px;padding:8px 16px;border:1px solid var(--line,#d5d9e0);border-radius:8px;background:var(--surface,#fff);color:var(--ink,#1d2433);cursor:pointer}' +
    '.zs-btn[aria-pressed="true"]{background:var(--accent,#d97706);border-color:var(--accent,#d97706);color:var(--accent-ink,#fff)}' +
    '.zs-btn:focus-visible,.zs-name:focus-visible{outline:3px solid var(--accent,#d97706);outline-offset:2px}' +
    '.zs-cover .zs-btn{font-size:17px;padding:10px 22px}' +
    '.zs-seats{display:grid;gap:8px;margin:12px 0}' +
    '.zs-seats h3{margin:0;font-size:12px;font-weight:600;color:var(--ink2,#4b5568);text-transform:uppercase;letter-spacing:.04em}' +
    '.zs-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}' +
    '.zs-row>span{flex:0 0 64px;font-size:14px;color:var(--ink2,#4b5568)}' +
    '.zs-seg{display:inline-flex}.zs-seg .zs-btn{min-height:40px;padding:6px 12px;border-radius:0;margin-left:-1px}' +
    '.zs-seg .zs-btn:first-child{border-radius:8px 0 0 8px;margin-left:0}.zs-seg .zs-btn:last-child{border-radius:0 8px 8px 0}' +
    '.zs-name{flex:1 1 110px;min-width:0;font:inherit;font-size:15px;min-height:40px;padding:6px 10px;border:1px solid var(--line,#d5d9e0);border-radius:8px;background:var(--surface,#fff);color:var(--ink,#1d2433)}' +
    '.zs-note{margin:0;font-size:12px;color:var(--ink3,#7c8698)}';
  function ensureStyle() {
    var d = root.document;
    if (!d || d.getElementById('zs-style')) return;
    var s = d.createElement('style'); s.id = 'zs-style'; s.textContent = CSS; (d.head || d.documentElement).appendChild(s);
  }

  function el(tag, cls, text) {
    var e = root.document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // cfg: { id, seats, cpuNames (by seat, optional), seatLabels (optional), onChange() }
  function create(cfg) {
    var n = cfg.seats, kinds = cleanKinds((read(PREFIX + cfg.id + '.seats', {}) || {}).kinds, n), names = loadNames(Math.max(n, 4));
    var S = { n: n, viewer: -1, covering: false };

    S.kinds = function () { return kinds.slice(); };
    S.person = function (seat) { return kinds[seat] === 'person'; };
    S.people = function () { return peopleOf(kinds); };
    S.hotseat = function () { return peopleOf(kinds).length >= 2; };
    // The seat whose hand is face up: the one person alone, or whoever last took the screen.
    S.view = function () { return S.hotseat() && S.viewer >= 0 ? S.viewer : peopleOf(kinds)[0]; };
    S.rel = function (seat) { return relOf(seat, S.view(), n); };
    S.compass = function (seat) { return compassName(n, S.rel(seat)); };
    S.name = function (seat) {
      if (kinds[seat] === 'cpu') return cfg.cpuNames ? cfg.cpuNames[seat] : S.compass(seat);
      return S.hotseat() ? names[seat] : 'You';
    };
    // "You" is spoken to the viewer only; a sentence about someone else uses their name.
    S.isYou = function (seat) { return !S.hotseat() && kinds[seat] === 'person'; };
    S.needsCover = function (seat) { return needsCover(kinds, S.viewer, seat); };
    S.setKind = function (seat, kind) { kinds = cleanKinds(kinds.map(function (k, i) { return i === seat ? kind : k; }), n); write(PREFIX + cfg.id + '.seats', { kinds: kinds }); };
    S.setName = function (seat, text) { names[seat] = cleanName(text, seat); write(NAMES_KEY, names); };

    // The handoff. It cannot be dismissed with Escape or a click outside: only the button shows the cards.
    S.cover = function (seat, done, note) {
      if (S.covering) return;
      if (!root.document) { S.viewer = seat; if (done) done(); return; }
      ensureStyle();
      S.covering = true;
      var who = names[seat], host = el('div', 'zs-cover'), card = el('div', 'zs-cover-card');
      host.setAttribute('role', 'dialog'); host.setAttribute('aria-modal', 'true'); host.setAttribute('aria-label', 'Pass to ' + who);
      var logo = el('img'); logo.src = 'mark.svg'; logo.alt = '';
      var go = el('button', 'zs-btn', "I'm " + who + ', show my cards'); go.type = 'button'; go.setAttribute('aria-pressed', 'true');
      card.appendChild(logo); card.appendChild(el('small', null, 'Pass to')); card.appendChild(el('h2', null, who));
      card.appendChild(el('p', null, note || 'Pass the device. Your cards stay hidden until you tap.'));
      card.appendChild(go); host.appendChild(card);
      host.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); } else if (e.key === 'Tab') { e.preventDefault(); go.focus(); }
      });
      var prev = root.document.activeElement;
      go.addEventListener('click', function () {
        host.remove(); S.covering = false; S.viewer = seat;
        if (prev && prev.blur) try { prev.blur(); } catch (e) { /* gone */ }
        if (cfg.onChange) cfg.onChange();
        if (done) done();
      });
      root.document.body.appendChild(host); go.focus();
    };
    // Cover for `seat` when it needs one, then run `done`; otherwise just run `done`.
    S.ensure = function (seat, done, note) {
      if (S.needsCover(seat)) S.cover(seat, done, note); else if (done) done();
    };
    // A fresh deal or game: nobody has seen it. With several people the first person-to-move's
    // screen comes up first (or the first person if a computer opens); with one person, no handoff.
    S.begin = function (done, first) {
      S.covering = false;
      var old = root.document && root.document.querySelector && root.document.querySelector('.zs-cover');
      if (old) old.remove();
      if (!S.hotseat()) { S.viewer = peopleOf(kinds)[0]; if (cfg.onChange) cfg.onChange(); if (done) done(); return; }
      S.viewer = -1;
      if (cfg.onChange) cfg.onChange();
      S.cover(first != null && kinds[first] === 'person' ? first : peopleOf(kinds)[0], done);
    };

    // The Players rows of the New game sheet. Changes are saved at once and take effect
    // from the next game. A name box shows for each person once there are two.
    // opts: { labels (row names), note, cpuLabel (what a seat that is not a person is called) }
    S.block = function (onChange, opts) {
      ensureStyle();
      opts = opts || {};
      var box = el('div', 'zs-seats'), rows = [];
      box.appendChild(el('h3', null, 'Players'));
      function refresh() {
        var multi = S.hotseat();
        rows.forEach(function (r, i) {
          var isP = kinds[i] === 'person';
          Array.prototype.forEach.call(r.seg.children, function (b) { b.setAttribute('aria-pressed', String((b.dataset.kind === 'person') === isP)); });
          r.input.hidden = !(isP && multi);
        });
        note.hidden = !multi;
      }
      for (var i = 0; i < n; i++) (function (i) {
        var row = el('div', 'zs-row'), seg = el('div', 'zs-seg'), input = el('input', 'zs-name');
        seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', (opts.labels ? opts.labels[i] : 'Seat ' + (i + 1)) + ' is');
        [['cpu', opts.cpuLabel || 'Computer'], ['person', 'Person']].forEach(function (k) {
          var b = el('button', 'zs-btn', k[1]); b.type = 'button'; b.dataset.kind = k[0];
          b.addEventListener('click', function () { S.setKind(i, k[0]); refresh(); if (onChange) onChange(); });
          seg.appendChild(b);
        });
        input.type = 'text'; input.maxLength = MAX_NAME; input.value = names[i]; input.setAttribute('aria-label', 'Name for seat ' + (i + 1));
        input.addEventListener('change', function () { S.setName(i, input.value); input.value = names[i]; });
        row.appendChild(el('span', null, opts.labels ? opts.labels[i] : 'Seat ' + (i + 1)));
        row.appendChild(seg); row.appendChild(input); box.appendChild(row); rows.push({ seg: seg, input: input });
      })(i);
      var note = el('p', 'zs-note', 'With two or more people, the screen hides each hand until its owner taps. ' + (opts.note || ''));
      box.appendChild(note);
      refresh();
      return box;
    };
    return S;
  }

  root.ZimiSeats = { create: create, cleanKinds: cleanKinds, cleanName: cleanName, defaultName: defaultName, peopleOf: peopleOf, relOf: relOf, needsCover: needsCover, compassName: compassName, loadNames: loadNames, NAMES_KEY: NAMES_KEY };
})(typeof globalThis !== 'undefined' ? globalThis : window);
