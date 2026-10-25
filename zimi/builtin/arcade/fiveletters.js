/* Zimi Arcade: Five Letters (guess the word in six tries). Our own code, GPL-3.0.
   No network, no fonts, no modules. The rules (pure functions, no DOM, so node can test them)
   and the page (only when there is a document). The word lists are in fiveletters-words.js. */
(function (root) {
  'use strict';

  // ── the rules ────────────────────────────────────────────────────────────
  var LEN = 5, TRIES = 6;
  var DAILY_EPOCH = Date.UTC(2026, 0, 1), DAY_MS = 86400000;
  var RANK = { absent: 0, present: 1, correct: 2 };

  // Score a guess against the answer. Greens first; then each remaining letter of the guess
  // is yellow only while the answer still has an unmatched copy of it, so repeats count right:
  // guessing "allee" against "apple" gives one yellow l and one green e, not two of each.
  function scoreGuess(guess, answer) {
    var out = new Array(LEN).fill('absent'), left = {}, i;
    for (i = 0; i < LEN; i++) {
      if (guess[i] === answer[i]) out[i] = 'correct';
      else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (i = 0; i < LEN; i++) {
      if (out[i] === 'correct') continue;
      if (left[guess[i]] > 0) { out[i] = 'present'; left[guess[i]]--; }
    }
    return out;
  }

  // What each letter of the keyboard shows: the best thing learned about it so far.
  function keyStates(guesses, answer) {
    var keys = {};
    guesses.forEach(function (gs) {
      scoreGuess(gs, answer).forEach(function (st, i) {
        var ch = gs[i];
        if (!(ch in keys) || RANK[st] > RANK[keys[ch]]) keys[ch] = st;
      });
    });
    return keys;
  }

  // The lists are space-separated strings; sets make the lookups quick.
  function makeWords(allowedText, answersText) {
    var answers = answersText.split(' ').filter(Boolean), allowed = {};
    allowedText.split(' ').forEach(function (w) { if (w) allowed[w] = true; });
    answers.forEach(function (w) { allowed[w] = true; });
    return { answers: answers, allowed: allowed };
  }
  function isWord(words, w) { return w.length === LEN && words.allowed[w] === true; }

  // The same word for everyone on the same calendar day (local), walking the answer list in order.
  function dayNumber(date) { return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - DAILY_EPOCH) / DAY_MS); }
  function dailyAnswer(words, date) {
    var n = words.answers.length;
    return words.answers[((dayNumber(date) % n) + n) % n];
  }
  function dateKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  // The emoji squares people paste: one row a guess.
  var SQUARE = { correct: '🟩', present: '🟨', absent: '⬛' };
  function shareText(title, guesses, answer, won) {
    var rows = guesses.map(function (gs) { return scoreGuess(gs, answer).map(function (s) { return SQUARE[s]; }).join(''); });
    return title + ' ' + (won ? guesses.length : 'X') + '/' + TRIES + '\n' + rows.join('\n');
  }

  var Engine = {
    LEN: LEN, TRIES: TRIES, scoreGuess: scoreGuess, keyStates: keyStates, makeWords: makeWords, isWord: isWord,
    dayNumber: dayNumber, dailyAnswer: dailyAnswer, dateKey: dateKey, shareText: shareText
  };
  root.FiveLettersEngine = Engine;

  if (typeof document === 'undefined') return;

  // ── the page ─────────────────────────────────────────────────────────────
  var Play = root.ArcadePlay, $ = Play.$;
  var FLIP_MS = 230, SHAKE_MS = 420;       // each tile turns over 230 ms after the one before
  var MAX_TILE = 62, GAP = 6, SIDE_PAD = 24;
  var STATE_KEY = 'zimi.arcade.fiveletters.state', STATS_KEY = 'zimi.arcade.fiveletters.stats';
  var PRAISE = ['Genius', 'Magnificent', 'Impressive', 'Splendid', 'Great', 'Phew'];
  var ROWS = ['qwertyuiop', 'asdfghjkl', '#zxcvbnm<'];
  Play.applyTheme();

  var words = makeWords(root.FIVE_ALLOWED, root.FIVE_ANSWERS);
  var els = { board: $('fl-board'), keys: $('fl-keys'), msg: $('fl-msg'), mode: $('fl-mode'), stats: $('fl-stats'), sheet: $('fl-sheet'), title: $('fl-sheet-title'), text: $('fl-sheet-text'), grid: $('fl-dist'), share: $('fl-share'), again: $('fl-again'), close: $('fl-close') };
  var keyEls = {}, tileEls = [];
  var stored = Play.load(STATE_KEY, {});
  var stats = Play.load(STATS_KEY, { played: 0, won: 0, streak: 0, max: 0, dist: [0, 0, 0, 0, 0, 0], last: '' });
  var game = null, busy = false, today = dateKey(new Date());

  function blank(mode) {
    if (mode === 'daily') return { mode: 'daily', date: today, answer: dailyAnswer(words, new Date()), guesses: [], current: '', status: 'playing' };
    return { mode: 'practice', answer: words.answers[Math.floor(Math.random() * words.answers.length)], guesses: [], current: '', status: 'playing' };
  }
  function load(mode) {
    var s = stored[mode];
    if (mode === 'daily' && s && s.date === today && s.answer === dailyAnswer(words, new Date())) return s;
    if (mode === 'practice' && s && s.answer && words.allowed[s.answer]) return s;
    return blank(mode);
  }
  function persist() { stored[game.mode] = game; Play.save(STATE_KEY, stored); }

  function build() {
    for (var r = 0; r < TRIES; r++) {
      var row = document.createElement('div'); row.className = 'fl-row'; row.setAttribute('role', 'row');
      var tiles = [];
      for (var c = 0; c < LEN; c++) {
        var t = document.createElement('div'); t.className = 'fl-tile'; t.setAttribute('role', 'gridcell'); row.appendChild(t); tiles.push(t);
      }
      tileEls.push(tiles); els.board.appendChild(row);
    }
    ROWS.forEach(function (letters) {
      var row = document.createElement('div'); row.className = 'fl-krow';
      letters.split('').forEach(function (ch) {
        var b = document.createElement('button'); b.type = 'button';
        if (ch === '#') { b.className = 'fl-key wide'; b.textContent = 'Enter'; b.dataset.k = 'Enter'; }
        else if (ch === '<') { b.className = 'fl-key wide'; b.innerHTML = '&#9003;'; b.dataset.k = 'Backspace'; b.setAttribute('aria-label', 'Delete'); }
        else { b.className = 'fl-key'; b.textContent = ch; b.dataset.k = ch; keyEls[ch] = b; }
        row.appendChild(b);
      });
      els.keys.appendChild(row);
    });
  }
  function layout() {
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var byWidth = Math.floor((vw - SIDE_PAD - GAP * (LEN - 1)) / LEN), byHeight = Math.floor((vh - 52 - 250 - GAP * (TRIES - 1)) / TRIES);
    els.board.style.setProperty('--tile', Math.max(38, Math.min(MAX_TILE, byWidth, byHeight)) + 'px');
  }

  function paintRow(r, word, states) {
    for (var c = 0; c < LEN; c++) {
      var t = tileEls[r][c], ch = word[c] || '', st = states ? states[c] : '';
      t.className = 'fl-tile' + (ch ? ' filled' : '') + (st ? ' ' + st : '');
      t.textContent = ch;
      t.setAttribute('aria-label', ch ? ch + (st ? ', ' + st : '') : 'empty');
    }
  }
  function paintKeys() {
    var ks = keyStates(game.guesses, game.answer);
    Object.keys(keyEls).forEach(function (ch) { keyEls[ch].className = 'fl-key' + (ks[ch] ? ' ' + ks[ch] : ''); });
  }
  function paintAll() {
    for (var r = 0; r < TRIES; r++) {
      if (r < game.guesses.length) paintRow(r, game.guesses[r], scoreGuess(game.guesses[r], game.answer));
      else paintRow(r, r === game.guesses.length ? game.current : '', null);
    }
    paintKeys();
    els.mode.textContent = game.mode === 'daily' ? 'Daily' : 'Practice';
  }
  function say(text) { els.msg.textContent = text; }

  function type(ch) {
    if (busy || game.status !== 'playing' || game.current.length >= LEN) return;
    game.current += ch; say(''); paintRow(game.guesses.length, game.current, null);
    var t = tileEls[game.guesses.length][game.current.length - 1];
    if (!Play.reducedMotion()) { t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop'); }
  }
  function erase() {
    if (busy || game.status !== 'playing' || !game.current) return;
    game.current = game.current.slice(0, -1); say(''); paintRow(game.guesses.length, game.current, null);
  }
  function shake(r, text) {
    say(text);
    var row = els.board.children[r];
    if (Play.reducedMotion()) return;
    row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
    setTimeout(function () { row.classList.remove('shake'); }, SHAKE_MS);
  }

  function submit() {
    if (busy || game.status !== 'playing') return;
    var r = game.guesses.length, word = game.current;
    if (word.length < LEN) return shake(r, 'Not enough letters.');
    if (!isWord(words, word)) return shake(r, 'Not in the word list.');
    var states = scoreGuess(word, game.answer);
    game.guesses.push(word); game.current = '';
    if (word === game.answer) game.status = 'won'; else if (game.guesses.length >= TRIES) game.status = 'lost';
    persist();
    var done = function () {
      busy = false; paintKeys();
      if (game.status === 'won') { say(PRAISE[game.guesses.length - 1] + '.'); record(true); setTimeout(openSheet, 500); }
      else if (game.status === 'lost') { say('The word was ' + game.answer.toUpperCase() + '.'); record(false); setTimeout(openSheet, 500); }
    };
    if (Play.reducedMotion()) { paintRow(r, word, states); return done(); }
    busy = true;
    states.forEach(function (st, c) {
      var t = tileEls[r][c];
      setTimeout(function () { t.classList.add('flip'); }, c * FLIP_MS);
      setTimeout(function () { t.classList.add(st); t.setAttribute('aria-label', word[c] + ', ' + st); }, c * FLIP_MS + FLIP_MS / 2);
    });
    setTimeout(done, LEN * FLIP_MS + 100);
  }

  // Only the daily counts toward the streak and the spread.
  function record(won) {
    if (game.mode !== 'daily' || game.counted) return;
    game.counted = true; persist();
    stats.played++;
    if (won) {
      stats.won++; stats.dist[game.guesses.length - 1]++;
      stats.streak = stats.last === yesterdayKey() ? stats.streak + 1 : 1;
      stats.max = Math.max(stats.max, stats.streak);
    } else stats.streak = 0;
    stats.last = today;
    Play.save(STATS_KEY, stats);
  }
  function yesterdayKey() { var d = new Date(); d.setDate(d.getDate() - 1); return dateKey(d); }

  function openSheet() {
    var over = game.status !== 'playing';
    els.title.textContent = over ? (game.status === 'won' ? PRAISE[game.guesses.length - 1] : 'The word was ' + game.answer.toUpperCase()) : 'Your record';
    var pct = stats.played ? Math.round(100 * stats.won / stats.played) : 0;
    els.text.textContent = 'Daily games played ' + stats.played + ', won ' + pct + '%, streak ' + stats.streak + ', best streak ' + stats.max + '.';
    var most = Math.max.apply(null, stats.dist.concat(1));
    els.grid.innerHTML = '';
    stats.dist.forEach(function (n, i) {
      var li = document.createElement('div'); li.className = 'fl-bar';
      li.innerHTML = '<span>' + (i + 1) + '</span><i style="width:' + Math.max(8, Math.round(100 * n / most)) + '%">' + n + '</i>';
      els.grid.appendChild(li);
    });
    els.share.hidden = !over;
    els.again.textContent = game.mode === 'daily' ? 'Practice with a new word' : 'New word';
    els.again.hidden = !over && game.mode === 'daily';
    Play.openSheet(els.sheet, over ? '#fl-share' : '#fl-close');
  }

  els.keys.addEventListener('click', function (e) {
    var b = e.target.closest('.fl-key'); if (!b) return;
    var k = b.dataset.k;
    if (e.detail) b.blur(); // a tap or click: hand the keyboard back, so a physical Enter submits instead of re-pressing this key
    if (k === 'Enter') submit(); else if (k === 'Backspace') erase(); else type(k);
  });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || !els.sheet.hidden) { if (e.key === 'Escape' && !els.sheet.hidden) Play.closeSheet(els.sheet); return; }
    if (e.target.closest && e.target.closest('button') && (e.key === 'Enter' || e.key === ' ')) return; // let a focused button do its own thing
    var k = e.key;
    if (k === 'Enter') { e.preventDefault(); submit(); }
    else if (k === 'Backspace') { e.preventDefault(); erase(); }
    else if (/^[a-zA-Z]$/.test(k)) type(k.toLowerCase());
  });
  els.mode.addEventListener('click', function () { switchTo(game.mode === 'daily' ? 'practice' : 'daily'); });
  els.stats.addEventListener('click', openSheet);
  els.close.addEventListener('click', function () { Play.closeSheet(els.sheet); });
  els.again.addEventListener('click', function () {
    Play.closeSheet(els.sheet);
    stored.practice = null; switchTo('practice', true);
  });
  els.share.addEventListener('click', function () {
    var text = shareText('Five Letters' + (game.mode === 'daily' ? ' ' + game.date : ''), game.guesses, game.answer, game.status === 'won');
    try { navigator.clipboard.writeText(text).then(function () { say('Copied.'); }, function () { say(text); }); } catch (e) { say('Could not copy.'); }
  });
  function switchTo(mode, fresh) {
    if (busy) return;
    game = fresh ? blank(mode) : load(mode); persist(); say(''); paintAll();
  }

  build();
  layout();
  window.addEventListener('resize', layout);
  game = load('daily');
  paintAll();
  if (game.status === 'won') say(PRAISE[game.guesses.length - 1] + '.'); else if (game.status === 'lost') say('The word was ' + game.answer.toUpperCase() + '.');
  // A read-only window onto the live game, for the browser tests.
  root.__five = { get game() { return game; } };
})(this);
