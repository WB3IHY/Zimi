/* ZimiGames: Letter by Letter. Guess the word one letter at a time; every miss lets some air out of the
   balloon, and with the last of it the balloon is flat (nothing worse). The words and their clues come, inside
   Zimi, from a Wiktionary in the player's library, in their language; in Kiwix or from a folder, from the
   words shipped in letterbyletter-words.js. Our own code, GPL-3.0.
   The rules (pure functions, no DOM, so node can test them) and the page (only when there is a document). */
(function (root) {
  'use strict';
  var Lib = root.GamesLib;

  // ── the rules ────────────────────────────────────────────────────────────
  var LIVES = 7, MIN_LEN = 4, MAX_LEN = 12;
  // Alphabets a letter keyboard can stand for: not Chinese, Japanese or the like, whose "letters" number in thousands.
  var LETTER_WORD = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Hebrew}\p{Script=Arabic}]+$/u;
  var QWERTY = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  var COLUMNS = 9;            // letters per row on a keyboard that is not QWERTY

  // A word the game can use: only letters, of a length that makes a game, in lower case.
  function usable(word) {
    return typeof word === 'string' && word.length >= MIN_LEN && word.length <= MAX_LEN && word === word.toLowerCase() && LETTER_WORD.test(word);
  }
  // A letter as the keyboard knows it: "é" is "e".
  function keyOf(ch) { return Lib.fold(ch); }

  function newGame(word, clue) {
    return { word: word, clue: clue || '', guessed: [], misses: 0, hints: 0 };
  }
  function hasKey(game, key) { return Array.from(game.word).some(function (c) { return keyOf(c) === key; }); }

  // Play a letter. Returns 'hit', 'miss' or 'repeat' (already tried, or not a letter at all) and changes the game.
  function guess(game, key) {
    if (!key || game.guessed.indexOf(key) >= 0 || status(game) !== 'playing') return 'repeat';
    game.guessed.push(key);
    if (hasKey(game, key)) return 'hit';
    game.misses++;
    return 'miss';
  }
  // The word with the letters not yet guessed as null.
  function shown(game) {
    return Array.from(game.word).map(function (c) { return game.guessed.indexOf(keyOf(c)) >= 0 ? c : null; });
  }
  function status(game) {
    if (game.misses >= LIVES) return 'lost';
    return shown(game).every(function (c) { return c !== null; }) ? 'won' : 'playing';
  }
  function airLeft(game) { return Math.max(0, LIVES - game.misses); }

  // A hint turns over one letter the player has not found, and costs a breath of air.
  function hint(game, rng) {
    if (status(game) !== 'playing' || airLeft(game) < 2) return null;
    var open = Array.from(new Set(Array.from(game.word).map(keyOf))).filter(function (k) { return game.guessed.indexOf(k) < 0; });
    if (open.length < 2) return null; // the last letter is the player's to find
    var k = open[Math.floor((rng || Math.random)() * open.length)];
    game.guessed.push(k); game.misses++; game.hints++;
    return k;
  }

  // The clue without the word in it (a dictionary often uses the word it explains).
  function cleanClue(clue, word) {
    var out = String(clue || '').replace(/\s+/g, ' ').trim();
    var stem = word.length > 4 ? word.slice(0, -1) : word;
    out = out.replace(new RegExp(stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\p{L}*', 'giu'), '_____');
    return out.length > 220 ? out.slice(0, 220).replace(/\s\S*$/, '') + '...' : out;
  }

  // The keys: QWERTY for a Latin word, else the word's own letters with the other letters the library showed
  // (so the keyboard is the right alphabet without the game knowing every language).
  function keyboard(word, extra) {
    var keys = Array.from(new Set(Array.from(word).map(keyOf)));
    if (keys.every(function (k) { return /^[a-z]$/.test(k); })) return QWERTY.map(function (r) { return r.split(''); });
    (extra || []).forEach(function (w) { Array.from(w).forEach(function (c) { var k = keyOf(c); if (keys.indexOf(k) < 0) keys.push(k); }); });
    keys.sort(function (a, b) { return a.localeCompare(b); });
    var rows = [];
    for (var i = 0; i < keys.length; i += COLUMNS) rows.push(keys.slice(i, i + COLUMNS));
    return rows;
  }

  // The built-in words are "word|clue". The day's is the same for everyone.
  function parseMini(list) { return list.map(function (s) { var i = s.indexOf('|'); return { word: s.slice(0, i), clue: s.slice(i + 1) }; }); }
  function dailyMini(list, dayKey) { return list[Lib.hash('letters|' + dayKey) % list.length]; }

  // The clue of a Wiktionary entry as /dictionary/word answers: the first sense of the first part of speech.
  function senseOf(lookup) {
    try {
      var langs = (lookup && lookup.langs) || [];
      for (var i = 0; i < langs.length; i++) {
        var entries = langs[i].entries || [];
        for (var j = 0; j < entries.length; j++) {
          var groups = entries[j].groups || [];
          for (var g = 0; g < groups.length; g++) {
            var parts = groups[g].parts || [];
            for (var p = 0; p < parts.length; p++) {
              var senses = parts[p].senses || [];
              for (var s = 0; s < senses.length; s++) if (senses[s].d && senses[s].d[0]) return senses[s].d[0];
            }
          }
        }
      }
    } catch (e) { /* a shape we do not know: no clue */ }
    return '';
  }

  var Engine = { LIVES: LIVES, usable: usable, keyOf: keyOf, newGame: newGame, guess: guess, shown: shown, status: status, airLeft: airLeft, hint: hint,
    cleanClue: cleanClue, keyboard: keyboard, parseMini: parseMini, dailyMini: dailyMini, senseOf: senseOf };
  root.LettersEngine = Engine;

  if (typeof document === 'undefined') return;

  // ── the page ─────────────────────────────────────────────────────────────
  var Play = root.ArcadePlay, $ = Play.$, SVGNS = 'http://www.w3.org/2000/svg';
  Play.applyTheme();
  var STATE_KEY = 'zimi.games.letters.state', STATS_KEY = 'zimi.games.letters.stats';
  var POOL_BATCH_LANGS = 1, TRIES = 6;
  var els = { mode: $('lb-mode'), fig: $('lb-fig'), air: $('lb-air'), clue: $('lb-clue'), word: $('lb-word'), msg: $('lb-msg'), keys: $('lb-keys'), hint: $('lb-hint'),
    next: $('lb-next'), source: $('lb-source'), sheet: $('lb-sheet'), title: $('lb-sheet-title'), text: $('lb-sheet-text'), entry: $('lb-entry'), again: $('lb-again'), close: $('lb-close'), rec: $('lb-rec') };
  var today = Lib.dayKey(new Date());
  var source = null;            // {zim, title, lang} for a library Wiktionary, null for the built-in words
  var pool = [], mini = parseMini(root.LETTERS_MINI || []);
  var game = null, mode = 'daily', busy = false, keyEls = {};
  var stored = Play.load(STATE_KEY, {});
  var stats = Play.load(STATS_KEY, { played: 0, won: 0, streak: 0, max: 0, last: '' });

  function say(t) { els.msg.textContent = t; }

  // ── the balloon ──
  var fig = {};
  function svg(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function buildFigure() {
    var s = svg('svg', { viewBox: '0 0 200 240', role: 'img', 'aria-label': 'A balloon' }, els.fig);
    svg('ellipse', { cx: 100, cy: 232, rx: 70, ry: 5, fill: 'var(--cell-line)' }, s);
    fig.string = svg('path', { fill: 'none', stroke: 'var(--ink3)', 'stroke-width': 1.6, 'stroke-linecap': 'round' }, s);
    fig.basket = svg('g', {}, s);
    svg('rect', { x: 86, y: 205, width: 28, height: 20, rx: 4, fill: 'var(--ink2)' }, fig.basket);
    svg('path', { d: 'M86 211H114', stroke: 'var(--ground)', 'stroke-width': 1.5 }, fig.basket);
    fig.body = svg('g', {}, s);
    fig.balloon = svg('path', { fill: 'var(--accent)' }, fig.body);
    fig.shine = svg('ellipse', { fill: '#fff', opacity: 0.3 }, fig.body);
    fig.knot = svg('path', { fill: 'var(--accent)' }, fig.body);
    fig.eyeL = svg('circle', { r: 3.2, fill: 'var(--accent-ink)' }, fig.body);
    fig.eyeR = svg('circle', { r: 3.2, fill: 'var(--accent-ink)' }, fig.body);
    fig.mouth = svg('path', { fill: 'none', stroke: 'var(--accent-ink)', 'stroke-width': 2.4, 'stroke-linecap': 'round' }, fig.body);
  }
  // Draw the balloon for the air it has left: smaller, lower and less happy as the air goes, flat at the end.
  function paintFigure() {
    var air = airLeft(game) / LIVES, lost = status(game) === 'lost';
    var s = lost ? 0.3 : 0.35 + 0.65 * air, rx = 58 * s, ry = 70 * s;
    var knotY = lost ? 205 : 205 - 38 * air, cy = knotY - ry;
    if (lost) {
      // Flat on the ground beside its basket, the string trailing back to it.
      fig.balloon.setAttribute('d', 'M26 230Q66 204 112 230Z');
      fig.balloon.setAttribute('opacity', 0.75);
      fig.shine.setAttribute('opacity', 0); fig.knot.setAttribute('d', '');
      fig.string.setAttribute('d', 'M112 230Q128 222 112 218');
      fig.eyeL.setAttribute('cx', 58); fig.eyeL.setAttribute('cy', 222); fig.eyeR.setAttribute('cx', 76); fig.eyeR.setAttribute('cy', 222);
      fig.eyeL.setAttribute('r', 2); fig.eyeR.setAttribute('r', 2);
      fig.mouth.setAttribute('d', 'M62 227H72');
      return;
    }
    fig.balloon.setAttribute('opacity', 1); fig.shine.setAttribute('opacity', 0.3);
    fig.eyeL.setAttribute('r', 3.2); fig.eyeR.setAttribute('r', 3.2);
    fig.balloon.setAttribute('d', 'M100 ' + (cy - ry) + 'C' + (100 + rx * 1.1) + ' ' + (cy - ry) + ' ' + (100 + rx * 1.05) + ' ' + (cy + ry * 0.55) + ' 100 ' + knotY +
      'C' + (100 - rx * 1.05) + ' ' + (cy + ry * 0.55) + ' ' + (100 - rx * 1.1) + ' ' + (cy - ry) + ' 100 ' + (cy - ry) + 'Z');
    fig.shine.setAttribute('cx', 100 - rx * 0.45); fig.shine.setAttribute('cy', cy - ry * 0.45); fig.shine.setAttribute('rx', rx * 0.16); fig.shine.setAttribute('ry', ry * 0.28);
    fig.knot.setAttribute('d', 'M100 ' + knotY + 'l-5 7h10z');
    fig.string.setAttribute('d', 'M100 ' + (knotY + 7) + 'C94 ' + (knotY + 18) + ' 106 ' + (knotY + 24) + ' 100 205');
    var ex = rx * 0.32;
    fig.eyeL.setAttribute('cx', 100 - ex); fig.eyeL.setAttribute('cy', cy - ry * 0.1); fig.eyeR.setAttribute('cx', 100 + ex); fig.eyeR.setAttribute('cy', cy - ry * 0.1);
    var my = cy + ry * 0.22, w = rx * 0.3, bend = (air * 2 - 1) * 9 * s + 2;
    fig.mouth.setAttribute('d', 'M' + (100 - w) + ' ' + my + 'Q100 ' + (my + bend) + ' ' + (100 + w) + ' ' + my);
  }
  function paintAir() {
    els.air.innerHTML = '';
    for (var i = 0; i < LIVES; i++) { var d = document.createElement('i'); if (i >= airLeft(game)) d.className = 'gone'; els.air.appendChild(d); }
    els.air.setAttribute('aria-label', airLeft(game) + ' of ' + LIVES + ' breaths of air left');
  }

  // ── the word and the keys ──
  function paintWord() {
    els.word.innerHTML = '';
    shown(game).forEach(function (c) {
      var d = document.createElement('span'); d.className = 'lb-slot' + (c ? ' on' : ''); d.textContent = c || '';
      d.setAttribute('aria-label', c || 'blank');
      els.word.appendChild(d);
    });
    els.word.setAttribute('dir', 'auto');
  }
  function buildKeys() {
    els.keys.innerHTML = ''; keyEls = {};
    keyboard(game.word, pool.map(function (p) { return p.word; })).forEach(function (letters) {
      var row = document.createElement('div'); row.className = 'lb-krow';
      letters.forEach(function (k) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'lb-key'; b.textContent = k; b.dataset.k = k; keyEls[k] = b; row.appendChild(b);
      });
      els.keys.appendChild(row);
    });
  }
  function paintKeys() {
    Object.keys(keyEls).forEach(function (k) {
      var b = keyEls[k], tried = game.guessed.indexOf(k) >= 0;
      b.className = 'lb-key' + (tried ? (hasKey(game, k) ? ' hit' : ' miss') : '');
      b.disabled = tried || status(game) !== 'playing';
    });
  }
  function paint() {
    var over = status(game) !== 'playing';
    els.clue.textContent = game.clue ? game.clue : '';
    els.clue.hidden = !game.clue;
    paintWord(); paintKeys(); paintFigure(); paintAir();
    els.hint.disabled = over || airLeft(game) < 2;
    els.next.hidden = mode === 'daily' && !over;
    els.mode.textContent = mode === 'daily' ? 'Daily' : 'Practice';
    els.source.textContent = source ? 'Words from ' + source.title + ' (' + source.lang + '), in your library.' : 'The built-in words. Open ZimiGames inside Zimi to play with the words of your own Wiktionary.';
  }
  function persist() { stored[mode] = { word: game.word, clue: game.clue, guessed: game.guessed, misses: game.misses, hints: game.hints, date: mode === 'daily' ? today : '', zim: source ? source.zim : '', counted: game.counted || false }; Play.save(STATE_KEY, stored); }

  // ── a round ──
  function afterMove() {
    persist(); paint();
    var st = status(game);
    if (st === 'playing') return;
    if (mode === 'daily' && !game.counted) {
      game.counted = true; persist();
      stats.played++;
      if (st === 'won') { stats.won++; stats.streak = stats.last === yesterday() ? stats.streak + 1 : 1; stats.max = Math.max(stats.max, stats.streak); } else stats.streak = 0;
      stats.last = today; Play.save(STATS_KEY, stats);
    }
    say(st === 'won' ? 'You kept the balloon up.' : 'The balloon is flat. The word was ' + game.word + '.');
    setTimeout(openSheet, Play.reducedMotion() ? 0 : 450);
  }
  function yesterday() { var d = new Date(); d.setDate(d.getDate() - 1); return Lib.dayKey(d); }

  function press(key) {
    if (busy || !game) return;
    var r = guess(game, key);
    if (r === 'repeat') return;
    say(r === 'hit' ? '' : 'Not in this word.');
    afterMove();
  }
  function useHint() {
    if (busy || !game) return;
    var k = hint(game);
    if (k) { say('One letter shown. It cost some air.'); afterMove(); }
  }

  function openSheet() {
    var st = status(game), over = st !== 'playing';
    els.title.textContent = over ? (st === 'won' ? 'Saved' : 'Flat') : 'Your record';
    var pct = stats.played ? Math.round(100 * stats.won / stats.played) : 0;
    els.text.textContent = (over ? game.word + (game.clue ? ': ' + game.clue : '') + ' ' : '') + 'Daily words played ' + stats.played + ', saved ' + pct + '%, streak ' + stats.streak + ', best streak ' + stats.max + '.';
    els.entry.hidden = !(over && source);
    if (source) els.entry.href = '/w/' + encodeURIComponent(source.zim) + '/' + encodeURIComponent(game.word);
    els.again.hidden = mode === 'daily' && !over;
    Play.openSheet(els.sheet, over ? '#lb-again' : '#lb-close');
  }

  // Where the next word comes from.
  function fromMini(daily) {
    var w = daily ? dailyMini(mini, today) : mini[Math.floor(Math.random() * mini.length)];
    return Promise.resolve({ word: w.word, clue: w.clue });
  }
  function clueFor(zim, word) {
    return Lib.json('/dictionary/word?w=' + encodeURIComponent(word) + '&names=' + encodeURIComponent(zim)).then(senseOf, function () { return ''; });
  }
  function refill() {
    var langs = Lib.uiLang();
    return Lib.json('/dictionary/random?langs=' + encodeURIComponent(langs)).then(function (r) {
      var mine = (r.words || []).filter(function (w) { return w.zim === source.zim && usable(w.w); });
      mine.forEach(function (w) { pool.push({ word: w.w }); });
    }, function () { /* try again next time */ });
  }
  function fromLibrary(daily) {
    var step = daily
      ? Lib.json('/wiki/today?day=' + today + '&zim=' + encodeURIComponent(source.zim) + '&parts=picks').then(function (r) {
        var p = r && r.picks && r.picks[source.zim];
        return p && usable(p.title) ? { word: p.title, clue: p.blurb || '' } : null;
      }, function () { return null; })
      : Promise.resolve(null);
    return step.then(function (got) {
      if (got) return got;
      var tries = 0;
      function take() {
        if (!pool.length && tries++ < TRIES) return refill().then(take);
        var c = pool.shift();
        if (!c) return null;
        return clueFor(source.zim, c.word).then(function (clue) { return clue ? { word: c.word, clue: clue } : take(); });
      }
      return take();
    });
  }
  function next(daily) {
    var ask = source ? fromLibrary(daily).then(function (w) { return w || (daily ? fromMini(true) : fromMini(false)); }) : fromMini(daily);
    return ask.then(function (w) {
      var g = newGame(w.word, cleanClue(w.clue, w.word));
      g.guessed = []; return g;
    });
  }

  function start(m, fresh) {
    mode = m; busy = true; say('Finding a word...');
    var s = stored[m];
    var same = s && s.word && (s.zim || '') === (source ? source.zim : '') && (m === 'practice' || s.date === today);
    var ready = !fresh && same ? Promise.resolve(Object.assign(newGame(s.word, s.clue), { guessed: s.guessed, misses: s.misses, hints: s.hints || 0, counted: s.counted })) : next(m === 'daily');
    return ready.then(function (g) {
      game = g; busy = false; say(''); buildKeys(); persist(); paint();
      if (status(game) !== 'playing') say(status(game) === 'won' ? 'You kept the balloon up.' : 'The balloon is flat. The word was ' + game.word + '.');
    });
  }

  // ── wiring ──
  els.keys.addEventListener('click', function (e) { var b = e.target.closest('.lb-key'); if (b) { if (e.detail) b.blur(); press(b.dataset.k); } });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!els.sheet.hidden) { if (e.key === 'Escape') Play.closeSheet(els.sheet); return; }
    if (e.key.length === 1 && /\p{L}/u.test(e.key)) press(keyOf(e.key));
  });
  els.hint.addEventListener('click', useHint);
  els.next.addEventListener('click', function () { start('practice', true); });
  els.mode.addEventListener('click', function () { start(mode === 'daily' ? 'practice' : 'daily'); });
  els.again.addEventListener('click', function () { Play.closeSheet(els.sheet); start('practice', true); });
  els.close.addEventListener('click', function () { Play.closeSheet(els.sheet); });
  els.rec.addEventListener('click', openSheet);

  buildFigure();
  paintFigureEmpty();
  function paintFigureEmpty() { game = newGame('....', ''); paintFigure(); paintAir(); game = null; }
  Lib.isZimi().then(function (yes) { return yes ? Lib.zims() : []; }).then(function (list) {
    var found = Lib.pickZim(list, 'wiktionary', Lib.uiLang());
    if (found) source = { zim: found.zim.name, title: found.zim.title || found.zim.name, lang: Lib.primaryLang(found.zim.language) };
    return start('daily');
  });
  root.__letters = { get game() { return game; }, get source() { return source; } };
})(this);
