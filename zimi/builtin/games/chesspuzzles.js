/* ZimiGames: Chess Puzzles, the page. About 15,000 puzzles from the Lichess puzzle database (CC0), picked by
   rating and theme, with a personal puzzle rating kept on this device. The rules are chess-engine.js; the
   puzzle rows and the UCI helpers are chess-content.js. No network: the puzzles are one data file. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined' || !root.ZimiChessEngine || !root.ZimiChessPuzzles) return;
  var E = root.ZimiChessEngine(), C = root.ZimiChessContent, BK = root.BoardKit, D = root.ZimiChessPuzzles;
  var $ = function (id) { return document.getElementById(id); };
  var WHITE = E.WHITE, BLACK = E.BLACK;
  var KEY = 'chesspuzzles', START_RATING = 1200, K_FACTOR = 28, MIN_RATING = 400, WINDOW = 140, RECENT_CAP = 60;
  var OPPONENT_DELAY_MS = 450, SOLUTION_STEP_MS = 650;

  var LEVELS = [['near', 'Near my rating'], ['600-1000', '600 to 1000'], ['1000-1400', '1000 to 1400'], ['1400-1800', '1400 to 1800'], ['1800-2200', '1800 to 2200'], ['2200-3200', '2200 and up']];
  var THEME_LABEL = { mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3', fork: 'Fork', pin: 'Pin', skewer: 'Skewer', discoveredAttack: 'Discovered attack', endgame: 'Endgame', backRankMate: 'Back rank mate', hangingPiece: 'Hanging piece', sacrifice: 'Sacrifice', deflection: 'Deflection', attraction: 'Attraction', trappedPiece: 'Trapped piece', promotion: 'Promotion', defensiveMove: 'Defensive move', quietMove: 'Quiet move', smotheredMate: 'Smothered mate', doubleCheck: 'Double check', xRayAttack: 'X-ray attack', zugzwang: 'Zugzwang', exposedKing: 'Exposed king', clearance: 'Clearance', interference: 'Interference', capturingDefender: 'Capturing the defender' };
  var THEME_ORDER = ['mateIn1', 'mateIn2', 'mateIn3', 'fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck', 'backRankMate', 'smotheredMate', 'hangingPiece', 'trappedPiece', 'sacrifice', 'deflection', 'attraction', 'clearance', 'interference', 'xRayAttack', 'capturingDefender', 'exposedKing', 'promotion', 'defensiveMove', 'quietMove', 'zugzwang', 'endgame'];

  var rows = D.rows.split('\n');
  var ratings = rows.map(function (r) { return +r.split('|')[2]; });   // rows are sorted by rating
  var themeOf = rows.map(function (r) { return r.split('|')[3]; });

  var state = BK.load(KEY, {});
  if (typeof state.rating !== 'number') state.rating = START_RATING;
  ['streak', 'best', 'solved', 'failed'].forEach(function (k) { if (typeof state[k] !== 'number') state[k] = 0; });
  if (!Array.isArray(state.recent)) state.recent = [];
  if (!state.filter || typeof state.filter !== 'object') state.filter = { level: 'near', theme: '' };
  var save = function () { BK.save(KEY, state); };

  var els = { board: $('cp-board'), status: $('cp-status'), hud: $('cp-hud'), info: $('cp-info'), hint: $('cp-hint'), solution: $('cp-solution'), next: $('cp-next') };
  var pos, puzzle, step, userColor, sel = -1, targets = {}, lastMove = 0, flipped = false;
  var hintLevel = 0, hinted = false, failed = false, done = false, rated = false, busy = false, pending = null, timer = 0, cue = null, isDaily = false;

  function colorName(c) { return c === WHITE ? 'White' : 'Black'; }
  function later(fn, ms) { clearTimeout(timer); timer = setTimeout(fn, ms); }

  // ── choosing a puzzle ──
  function levelRange(level) {
    if (level === 'near') return [Math.max(MIN_RATING, state.rating - WINDOW), state.rating + WINDOW];
    var p = level.split('-'); return [+p[0], +p[1]];
  }
  function matching(level, theme) {
    var r = levelRange(level), out = [], code = theme ? String.fromCharCode(97 + D.themes.indexOf(theme)) : '';
    for (var i = 0; i < rows.length; i++) {
      if (ratings[i] < r[0]) continue;
      if (ratings[i] > r[1]) break;
      if (!code || themeOf[i].indexOf(code) >= 0) out.push(i);
    }
    if (!out.length && level === 'near') {   // nothing in the window: widen it until something is
      for (var w = WINDOW * 2; !out.length && w < 4000; w *= 2) {
        for (var j = 0; j < rows.length; j++) if (Math.abs(ratings[j] - state.rating) <= w && (!code || themeOf[j].indexOf(code) >= 0)) out.push(j);
      }
    }
    return out;
  }
  function pick() {
    var pool = matching(state.filter.level, state.filter.theme);
    var fresh = pool.filter(function (i) { return state.recent.indexOf(i) < 0; });
    var from = fresh.length ? fresh : pool;
    return from[Math.floor(Math.random() * from.length)];
  }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dailyIndex(date) {
    var h = 0x811c9dc5;
    for (var i = 0; i < date.length; i++) { h ^= date.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0) % rows.length;
  }

  // ── drawing ──
  var view = root.ZimiChessBoard.create(els.board, E, onSquare);
  function paint() { view.paint(pos, { flipped: flipped, last: lastMove, sel: sel, targets: targets, cue: cue }); }
  function say(text) { els.status.textContent = text; }
  function paintHud() {
    els.hud.innerHTML = '<div class="pl-stat"><small>Your rating</small><b>' + state.rating + '</b></div>' +
      '<div class="pl-stat"><small>Streak</small><b>' + state.streak + '</b></div>' +
      '<div class="pl-stat"><small>Best streak</small><b>' + state.best + '</b></div>' +
      '<div class="pl-stat"><small>Puzzle</small><b>' + (puzzle ? puzzle.rating : '-') + '</b></div>';
  }
  function setButtons() {
    els.hint.disabled = done || busy;
    els.solution.disabled = done || busy || !failed;
    els.next.setAttribute('aria-pressed', String(done));
  }

  // ── the rating: Elo against the puzzle's rating; a hint or a miss is a loss, a clean solve a win ──
  function expected(you, them) { return 1 / (1 + Math.pow(10, (them - you) / 400)); }
  function settle(won) {
    if (rated || isDaily && state.daily && state.daily.date === today() && state.daily.rated) { rated = true; return 0; }
    rated = true;
    var before = state.rating, delta = Math.round(K_FACTOR * ((won ? 1 : 0) - expected(before, puzzle.rating)));
    state.rating = Math.max(MIN_RATING, before + delta);
    if (won) { state.streak++; state.solved++; state.best = Math.max(state.best, state.streak); } else { state.streak = 0; state.failed++; }
    if (isDaily) state.daily = { date: today(), result: won ? 'solved' : 'failed', rated: true };
    save();
    return state.rating - before;
  }
  function deltaHtml(d) { return d ? ' <span class="cp-delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '+' : '') + d + '</span>' : ''; }

  // ── a puzzle ──
  function startPuzzle(idx) {
    clearTimeout(timer);
    puzzle = C.parsePuzzle(rows[idx], D.themes); puzzle.idx = idx;
    state.recent.push(idx); if (state.recent.length > RECENT_CAP) state.recent.shift(); save();
    pos = E.parseFen(puzzle.fen); sel = -1; targets = {}; lastMove = 0; cue = null; pending = null;
    step = 0; hintLevel = 0; hinted = false; failed = false; done = false; rated = false; busy = true;
    userColor = -pos.turn; flipped = userColor === BLACK;
    els.board.classList.remove('solved', 'failed');
    els.info.textContent = '';
    paint(); paintHud(); setButtons();
    say((isDaily ? 'Daily puzzle. ' : '') + 'Watch the opponent move');
    later(function () { opponentMove(function () { busy = false; setButtons(); say('Your turn: find the best move for ' + colorName(userColor)); }); }, OPPONENT_DELAY_MS);
  }
  function opponentMove(after) {
    var m = C.fromUci(E, pos, puzzle.moves[step]);
    if (!m) { say('This puzzle did not load. Try the next one.'); busy = false; done = true; setButtons(); return; }
    E.make(pos, m); lastMove = m; step++; paint();
    if (after) after();
  }

  function solved() {
    done = true; busy = false; sel = -1; targets = {}; cue = null;
    var d = settle(!failed && !hinted);
    els.board.classList.add('solved'); paint(); setButtons();
    say(failed || hinted ? 'Solved' : 'Solved!');
    els.info.innerHTML = 'Puzzle rating ' + puzzle.rating + deltaHtml(d) + ' &middot; ' + puzzle.themes.map(function (t) { return THEME_LABEL[t] || t; }).join(', ');
    paintHud();
  }
  function miss() {
    sel = -1; targets = {}; cue = null;
    if (!failed) {
      failed = true;
      var d = settle(false);
      els.board.classList.add('failed');
      els.info.innerHTML = 'Puzzle rating ' + puzzle.rating + deltaHtml(d);
      paintHud();
    }
    say('That is not it. Try again, or show the solution');
    if (!BK.reducedMotion()) { els.board.classList.remove('shake'); void els.board.offsetWidth; els.board.classList.add('shake'); }
    paint(); setButtons();
  }

  function tryMove(m) {
    var expectedMove = C.fromUci(E, pos, puzzle.moves[step]);
    var mated = false;
    if (m !== expectedMove) { E.make(pos, m); mated = E.status(pos, []).result === 'mate'; E.unmake(pos); }
    if (m !== expectedMove && !mated) { miss(); return; }
    E.make(pos, m); lastMove = m; step++; sel = -1; targets = {}; cue = null; hintLevel = 0;
    if (mated || step >= puzzle.moves.length) { paint(); solved(); return; }
    busy = true; paint(); setButtons(); say('Good');
    later(function () {
      opponentMove(function () {
        if (step >= puzzle.moves.length) { solved(); return; }
        busy = false; setButtons(); say('Your turn');
      });
    }, OPPONENT_DELAY_MS);
  }

  function onSquare(s) {
    if (done || busy || pos.turn !== userColor) return;
    var v = pos.sq[s];
    if (sel >= 0 && targets.hasOwnProperty(s)) {
      var cands = E.legalMoves(pos).filter(function (m) { return E.from(m) === sel && E.to(m) === s; });
      if (cands.length > 1) { pending = cands; paintPromoColour(); promoSheet.open(); return; }
      tryMove(cands[0]); return;
    }
    if (v * pos.turn > 0 && s !== sel) { sel = s; targets = view.movesFrom(pos, s); cue = null; } else { sel = -1; targets = {}; }
    paint();
  }

  // ── hint, solution ──
  function hint() {
    if (done || busy) return;
    var m = C.fromUci(E, pos, puzzle.moves[step]);
    if (!m) return;
    hinted = true; hintLevel++;
    cue = { from: E.from(m), to: hintLevel > 1 ? E.to(m) : -1 };
    sel = -1; targets = {};
    say(hintLevel > 1 ? 'Move the highlighted piece to the marked square' : 'Move the highlighted piece');
    paint();
  }
  function showSolution() {
    if (done || busy) return;
    busy = true; setButtons(); sel = -1; targets = {}; cue = null;
    var go = function () {
      if (step >= puzzle.moves.length) { done = true; busy = false; paint(); setButtons(); say('That was the solution'); return; }
      var m = C.fromUci(E, pos, puzzle.moves[step]);
      if (!m) { done = true; busy = false; setButtons(); return; }
      E.make(pos, m); lastMove = m; step++; paint();
      later(go, SOLUTION_STEP_MS);
    };
    say('The solution'); go();
  }

  // ── promotion ──
  var promoSheet = BK.sheet($('cp-promo'), function () { pending = null; });
  function buildPromo() {
    root.ZimiChessBoard.promoButtons(E, $('cp-promo-choices'), function (t) {
      var m = pending && pending.filter(function (x) { return E.promo(x) === t; })[0];
      promoSheet.close();
      if (m) tryMove(m);
    });
  }
  function paintPromoColour() { root.ZimiChessBoard.promoColour($('cp-promo-choices'), pos.turn === WHITE); }

  // ── choose, daily, next ──
  var menu = BK.sheet($('cp-sheet'));
  function fillMenu() {
    var lv = $('cp-level'), th = $('cp-theme');
    if (!lv.options.length) {
      LEVELS.forEach(function (l) { lv.add(new Option(l[0] === 'near' ? l[1] + ' (' + state.rating + ')' : l[1], l[0])); });
      th.add(new Option('Any theme', ''));
      THEME_ORDER.filter(function (t) { return D.themes.indexOf(t) >= 0; }).forEach(function (t) { th.add(new Option(THEME_LABEL[t] || t, t)); });
      lv.addEventListener('change', countMenu); th.addEventListener('change', countMenu);
    }
    lv.options[0].text = LEVELS[0][1] + ' (' + state.rating + ')';
    lv.value = state.filter.level; th.value = state.filter.theme; countMenu();
  }
  function countMenu() {
    var n = matching($('cp-level').value, $('cp-theme').value).length;
    $('cp-count').textContent = n + ' puzzles match';
    $('cp-start').disabled = !n;
  }
  $('cp-choose').addEventListener('click', function () { fillMenu(); menu.open($('cp-level')); });
  $('cp-cancel').addEventListener('click', menu.close);
  $('cp-start').addEventListener('click', function () {
    state.filter = { level: $('cp-level').value, theme: $('cp-theme').value }; save();
    menu.close(); isDaily = false; startPuzzle(pick());
  });
  $('cp-daily').addEventListener('click', function () { isDaily = true; startPuzzle(dailyIndex(today())); });
  function nextPuzzle() {
    if (!done && !failed && hinted) { state.streak = 0; save(); }   // skipping after a hint breaks the streak; skipping unseen does not
    isDaily = false; startPuzzle(pick());
  }
  els.next.addEventListener('click', nextPuzzle);
  els.hint.addEventListener('click', hint);
  els.solution.addEventListener('click', showSolution);
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input,select')) return;
    var k = e.key.toLowerCase();
    if (k === 'h') hint(); else if (k === 'n') nextPuzzle(); else if (e.key === 'Escape' && sel >= 0) { sel = -1; targets = {}; paint(); }
  });

  buildPromo(); pos = E.startPosition();
  startPuzzle(pick());

  if (new URLSearchParams(location.search).has('debug')) {
    root.__cp = { puzzle: function () { return puzzle; }, pos: function () { return pos; }, state: state, step: function () { return step; }, start: startPuzzle, tryUci: function (u) { var m = C.fromUci(E, pos, u); if (m) tryMove(m); return !!m; }, busy: function () { return busy; }, done: function () { return done; } };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
