/* ZimiGames: Code Breaker. Our own code, GPL-3.0. No network, no fonts, no modules.
   The rules (pure functions, no DOM, so node can test them) and the page (only when there is a document). */
(function (root) {
  'use strict';

  // ── the rules ────────────────────────────────────────────────────────────
  var PEGS = 4, COLOURS = 6, ROWS = 10;

  // Score a guess: `exact` pegs right in colour and place, `colour` right in colour only.
  // Each peg of the code answers at most one peg of the guess, so repeats are never counted twice.
  function feedback(code, guess) {
    var exact = 0, cc = [], gc = [], i, total = 0;
    for (i = 0; i < COLOURS; i++) { cc.push(0); gc.push(0); }
    for (i = 0; i < code.length; i++) {
      if (code[i] === guess[i]) exact++;
      else { cc[code[i]]++; gc[guess[i]]++; }
    }
    for (i = 0; i < COLOURS; i++) total += Math.min(cc[i], gc[i]);
    return { exact: exact, colour: total };
  }

  function makeCode(rng, repeats) {
    var code = [], pool = [], i;
    for (i = 0; i < COLOURS; i++) pool.push(i);
    while (code.length < PEGS) {
      var k = Math.floor(rng() * pool.length);
      code.push(pool[k]);
      if (!repeats) pool.splice(k, 1);
    }
    return code;
  }
  function isValid(guess, repeats) {
    if (guess.length !== PEGS) return false;
    if (!guess.every(function (c) { return c >= 0 && c < COLOURS && c === Math.floor(c); })) return false;
    return repeats || guess.every(function (c, i) { return guess.indexOf(c) === i; });
  }

  var Engine = { PEGS: PEGS, COLOURS: COLOURS, ROWS: ROWS, feedback: feedback, makeCode: makeCode, isValid: isValid };
  root.CodeBreakerEngine = Engine;

  if (typeof document === 'undefined') return;

  // ── the page ─────────────────────────────────────────────────────────────
  var Play = root.ArcadePlay, $ = Play.$;
  var SETTINGS_KEY = 'zimi.games.codebreaker.settings', BEST_KEY = 'zimi.games.codebreaker.best';
  var NAMES = ['Red circle', 'Blue square', 'Green triangle', 'Gold diamond', 'Purple star', 'Teal cross'];
  Play.applyTheme();

  var els = { secret: $('cb-secret'), rows: $('cb-rows'), msg: $('cb-msg'), palette: $('cb-palette'), undo: $('cb-undo'), check: $('cb-check'), sheet: $('cb-sheet'), title: $('cb-sheet-title'), text: $('cb-sheet-text'), go: $('cb-go'), rep: $('cb-rep'), nu: $('cb-new') };
  var settings = Play.load(SETTINGS_KEY, { repeats: true }), best = Play.load(BEST_KEY, {});
  var code, rows, cur, status; // status: 'playing' | 'won' | 'lost'

  function peg(c, size) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pl-peg';
    if (c >= 0) { b.dataset.c = c; b.innerHTML = Play.symbolSVG(c, size || 22); b.setAttribute('aria-label', NAMES[c]); }
    return b;
  }
  function fbEl(fb) {
    var d = document.createElement('span'); d.className = 'cb-fb';
    d.setAttribute('role', 'img'); d.setAttribute('aria-label', fb ? fb.exact + ' right place, ' + fb.colour + ' wrong place' : 'not scored');
    for (var i = 0; i < PEGS; i++) {
      var k = document.createElement('i');
      k.className = fb ? (i < fb.exact ? 'cb-x' : i < fb.exact + fb.colour ? 'cb-c' : 'cb-0') : 'cb-0';
      d.appendChild(k);
    }
    return d;
  }

  function paint() {
    // the secret
    els.secret.textContent = '';
    for (var i = 0; i < PEGS; i++) {
      var s = status === 'playing' ? peg(-1) : peg(code[i]); s.disabled = true;
      if (status === 'playing') s.textContent = '?';
      els.secret.appendChild(s);
    }
    els.secret.setAttribute('aria-label', status === 'playing' ? 'The hidden code' : 'The code: ' + code.map(function (c) { return NAMES[c]; }).join(', '));
    // the rows
    els.rows.textContent = '';
    for (var r = 0; r < ROWS; r++) {
      var li = document.createElement('li'), now = r === rows.length && status === 'playing';
      li.className = 'cb-row' + (now ? ' cb-now' : '');
      var n = document.createElement('span'); n.className = 'cb-n'; n.textContent = r + 1; n.setAttribute('aria-hidden', 'true'); li.appendChild(n);
      var pegs = document.createElement('span'); pegs.className = 'cb-pegs';
      for (var k = 0; k < PEGS; k++) {
        var c = r < rows.length ? rows[r].guess[k] : now ? cur[k] : -1, b = peg(c);
        if (now) { b.setAttribute('aria-label', c >= 0 ? NAMES[c] + ', tap to remove' : 'Empty place ' + (k + 1)); (function (slot) { b.addEventListener('click', function () { cur[slot] = -1; paint(); }); })(k); }
        else b.disabled = true;
        pegs.appendChild(b);
      }
      li.appendChild(pegs);
      li.appendChild(fbEl(r < rows.length ? rows[r].fb : null));
      els.rows.appendChild(li);
    }
    // the palette
    els.palette.textContent = '';
    for (var p = 0; p < COLOURS; p++) {
      var pb = peg(p, 26);
      pb.disabled = status !== 'playing' || cur.indexOf(-1) < 0 || (!settings.repeats && cur.indexOf(p) >= 0);
      (function (c) { pb.addEventListener('click', function () { add(c); }); })(p);
      els.palette.appendChild(pb);
    }
    els.check.disabled = status !== 'playing' || cur.indexOf(-1) >= 0;
    els.undo.disabled = status !== 'playing' || cur.every(function (c) { return c < 0; });
  }

  function add(c) {
    if (status !== 'playing') return;
    var i = cur.indexOf(-1);
    if (i < 0 || (!settings.repeats && cur.indexOf(c) >= 0)) return;
    cur[i] = c; paint();
  }
  function back() {
    for (var i = PEGS - 1; i >= 0; i--) if (cur[i] >= 0) { cur[i] = -1; break; }
    paint();
  }
  function check() {
    if (status !== 'playing' || !isValid(cur, settings.repeats)) return;
    var fb = feedback(code, cur);
    rows.push({ guess: cur.slice(), fb: fb });
    cur = [-1, -1, -1, -1];
    if (fb.exact === PEGS) { status = 'won'; paint(); return finish(); }
    if (rows.length >= ROWS) { status = 'lost'; paint(); return finish(); }
    els.msg.textContent = fb.exact + ' in the right place, ' + fb.colour + ' in the wrong place. ' + (ROWS - rows.length) + ' guesses left.';
    paint();
  }
  function finish() {
    var k = settings.repeats ? 'repeats' : 'single', text;
    if (status === 'won') {
      text = 'Cracked it in ' + rows.length + (rows.length === 1 ? ' guess.' : ' guesses.');
      if (!best[k] || rows.length < best[k]) { best[k] = rows.length; Play.save(BEST_KEY, best); text += ' A new best.'; } else text += ' Best: ' + best[k] + '.';
    } else text = 'Out of guesses. The code is shown at the top.';
    els.msg.textContent = text;
    showSheet(status === 'won' ? 'Cracked' : 'Not this time', text, 'New code');
  }

  function paintRep() { els.rep.setAttribute('aria-pressed', String(!!settings.repeats)); els.rep.textContent = 'Colours may repeat: ' + (settings.repeats ? 'on' : 'off'); }
  function showSheet(title, text, label) { els.title.textContent = title; els.text.textContent = text; els.go.textContent = label; paintRep(); Play.openSheet(els.sheet, '#cb-go'); }
  function begin() {
    code = makeCode(Math.random, settings.repeats); rows = []; cur = [-1, -1, -1, -1]; status = 'playing';
    els.msg.textContent = 'Ten guesses. Pick four pegs.';
    Play.closeSheet(els.sheet); paint();
  }
  els.go.addEventListener('click', begin);
  els.rep.addEventListener('click', function () { settings.repeats = !settings.repeats; Play.save(SETTINGS_KEY, settings); paintRep(); });
  els.nu.addEventListener('click', function () { showSheet('New code', 'Start over with a fresh code?', 'Start'); });
  els.undo.addEventListener('click', back);
  els.check.addEventListener('click', check);
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || !els.sheet.hidden || status !== 'playing') return;
    if (e.key >= '1' && e.key <= '6') add(+e.key - 1);
    else if (e.key === 'Backspace') { e.preventDefault(); back(); }
    else if (e.key === 'Enter' && !(e.target.closest && e.target.closest('button'))) { e.preventDefault(); check(); }
  });

  code = makeCode(Math.random, settings.repeats); rows = []; cur = [-1, -1, -1, -1]; status = 'playing';
  paint();
  showSheet('Code Breaker', 'Crack the four-peg code in ten guesses.', 'Start');
  root.__codebreaker = { get code() { return code; }, get rows() { return rows; } };
})(this);
