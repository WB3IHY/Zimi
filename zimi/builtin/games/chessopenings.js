/* ZimiGames: the Opening Trainer, the page. Pick an opening from the 3,800 named lines of lichess-org/chess-openings
   (CC0), then play your side of the line against the board: the book move is right, anything else is told what the
   line plays. The computer plays the other side's moves. No engine thinking, no network. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined' || !root.ZimiChessEngine || !root.ZimiChessOpenings) return;
  var E = root.ZimiChessEngine(), C = root.ZimiChessContent, BK = root.BoardKit, Board = root.ZimiChessBoard;
  var $ = function (id) { return document.getElementById(id); };
  var WHITE = E.WHITE, BLACK = E.BLACK;
  var KEY = 'chessopenings', REPLY_DELAY_MS = 450, MIN_PLIES = 4, DEFAULT_FAMILY = 'Italian Game';

  var index = C.openingIndex(E, root.ZimiChessOpenings.rows);
  var lines = index.lines.filter(function (l) { return l.moves.length >= MIN_PLIES; });
  var families = {};
  lines.forEach(function (l) { (families[C.family(l.name)] = families[C.family(l.name)] || []).push(l); });
  var familyNames = Object.keys(families).sort();
  Object.keys(families).forEach(function (f) { families[f].sort(function (a, b) { return a.moves.length - b.moves.length || (a.name < b.name ? -1 : 1); }); });

  var state = BK.load(KEY, {});
  if (!families[state.family]) state.family = families[DEFAULT_FAMILY] ? DEFAULT_FAMILY : familyNames[0];
  if (state.side !== 'black') state.side = 'white';
  if (!state.done || typeof state.done !== 'object') state.done = {};
  var save = function () { BK.save(KEY, state); };

  var els = { name: $('co-name'), status: $('co-status'), moves: $('co-moves'), stats: $('co-stats'), hint: $('co-hint'), next: $('co-next') };
  var line, pos, step, sans, lastMove = 0, sel = -1, targets = {}, cue = null, userColor, busy = false, finished = false, mistakes = 0, hinted = false, hintLevel = 0, pending = null, timer = 0;
  var view = Board.create($('co-board'), E, onSquare);

  function lineKey(l) { return l.eco + '|' + l.name; }
  function colorName(c) { return c === WHITE ? 'White' : 'Black'; }
  function paint() { view.paint(pos, { flipped: userColor === BLACK, last: lastMove, sel: sel, targets: targets, cue: cue }); }
  function say(t) { els.status.textContent = t; }
  function later(fn, ms) { clearTimeout(timer); timer = setTimeout(fn, ms); }
  function paintMoves() {
    var html = '';
    for (var i = 0; i < sans.length; i++) {
      if (i % 2 === 0) html += '<span class="cs-n">' + (i / 2 + 1) + '.</span>';
      html += '<span class="cs-m' + (i === sans.length - 1 ? ' now' : '') + '">' + sans[i] + '</span>';
    }
    els.moves.innerHTML = html || '<span class="cs-none">No moves yet</span>';
    els.moves.scrollTop = els.moves.scrollHeight;
  }
  function paintStats() {
    var n = state.done[lineKey(line)] || 0, total = Object.keys(state.done).length;
    els.stats.textContent = (n ? 'You have played this line ' + n + (n === 1 ? ' time' : ' times') + '. ' : '') + total + ' of ' + lines.length + ' lines played';
  }

  function play(m) {
    sans.push(E.san(pos, m)); E.make(pos, m); lastMove = m; step++; sel = -1; targets = {}; cue = null;
    paintMoves(); paint();
  }
  function lineMove() { return C.fromUci(E, pos, line.moves[step]); }

  function start(l) {
    clearTimeout(timer);
    line = l; pos = E.startPosition(); step = 0; sans = []; lastMove = 0; sel = -1; targets = {}; cue = null;
    userColor = state.side === 'white' ? WHITE : BLACK; finished = false; mistakes = 0; hinted = false; hintLevel = 0; busy = false;
    els.name.textContent = line.eco + ' · ' + line.name;
    els.next.setAttribute('aria-pressed', 'false');
    paintMoves(); paintStats(); paint(); advance();
  }
  // Play the computer's moves until it is the player's turn or the line ends.
  function advance() {
    if (step >= line.moves.length) { complete(); return; }
    if (pos.turn === userColor) { busy = false; say('Your move: ' + (step === 0 ? 'play the first move of the line' : 'what does the line play?')); return; }
    busy = true; say('The line continues');
    later(function () { play(lineMove()); advance(); }, step === 0 ? 150 : REPLY_DELAY_MS);
  }
  function complete() {
    finished = true; busy = false;
    var k = lineKey(line); state.done[k] = (state.done[k] || 0) + 1; save();
    els.next.setAttribute('aria-pressed', 'true');
    say(mistakes || hinted ? 'Line complete: ' + line.name : 'Line complete, no mistakes: ' + line.name);
    paintStats();
  }

  function onSquare(s) {
    if (finished || busy || pos.turn !== userColor) return;
    var v = pos.sq[s];
    if (sel >= 0 && targets.hasOwnProperty(s)) {
      var cands = E.legalMoves(pos).filter(function (m) { return E.from(m) === sel && E.to(m) === s; });
      if (cands.length > 1) { pending = cands; Board.promoColour($('co-promo-choices'), pos.turn === WHITE); promoSheet.open(); return; }
      attempt(cands[0]); return;
    }
    if (v * pos.turn > 0 && s !== sel) { sel = s; targets = view.movesFrom(pos, s); cue = null; } else { sel = -1; targets = {}; }
    paint();
  }
  function attempt(m) {
    if (m === lineMove()) { play(m); advance(); return; }
    // not the book move: say what the line plays, and name what this move is if it is another opening
    var book = E.san(pos, lineMove()), other = '';
    E.make(pos, m);
    var keys = [E.key(pos)], hit = index.byKey[keys[0]];
    E.unmake(pos);
    if (hit) other = ' That is the ' + hit.name + '.';
    mistakes++; sel = -1; targets = {};
    cue = { from: E.from(lineMove()), to: E.to(lineMove()) };
    say('Not this line. It plays ' + book + '.' + other);
    paint();
  }
  var promoSheet = BK.sheet($('co-promo'), function () { pending = null; });
  Board.promoButtons(E, $('co-promo-choices'), function (t) {
    var m = pending && pending.filter(function (x) { return E.promo(x) === t; })[0];
    promoSheet.close();
    if (m) attempt(m);
  });

  function hint() {
    if (finished || busy) return;
    hinted = true; hintLevel++;
    var m = lineMove();
    cue = { from: E.from(m), to: hintLevel > 1 ? E.to(m) : -1 };
    sel = -1; targets = {}; say(hintLevel > 1 ? 'The line moves it here' : 'The line moves this piece'); paint();
  }
  function nextLine() {
    var pool = families[state.family];
    var fresh = pool.filter(function (l) { return !state.done[lineKey(l)] && l !== line; });
    var from = fresh.length ? fresh : pool.filter(function (l) { return l !== line; });
    start(from.length ? from[Math.floor(Math.random() * from.length)] : pool[0]);
  }

  // ── the menu ──
  var menu = BK.sheet($('co-sheet'));
  function fillFamilies(filter) {
    var sel_ = $('co-family'), f = (filter || '').trim().toLowerCase(), keep = sel_.value;
    sel_.textContent = '';
    familyNames.filter(function (n) { return !f || n.toLowerCase().indexOf(f) >= 0; }).forEach(function (n) { sel_.add(new Option(n + ' (' + families[n].length + ')', n)); });
    if (keep && families[keep] && sel_.querySelector('option[value="' + keep.replace(/"/g, '\\"') + '"]')) sel_.value = keep;
    fillLines();
  }
  function fillLines() {
    var ln = $('co-line'), fam = $('co-family').value;
    ln.textContent = '';
    (families[fam] || []).forEach(function (l, i) { ln.add(new Option(l.name.replace(fam + ': ', '').replace(fam, 'Main line') + ' · ' + l.eco + ' · ' + Math.ceil(l.moves.length / 2) + ' moves', i)); });
    $('co-start').disabled = !ln.options.length;
  }
  function openMenu() {
    BK.chipSet($('co-f-side'), state.side);
    $('co-search').value = '';
    fillFamilies('');
    $('co-family').value = state.family; fillLines();
    var i = families[state.family].indexOf(line); if (i >= 0) $('co-line').value = i;
    menu.open($('co-family'));
  }
  $('co-search').addEventListener('input', function (e) { fillFamilies(e.target.value); });
  $('co-family').addEventListener('change', fillLines);
  $('co-choose').addEventListener('click', openMenu);
  $('co-cancel').addEventListener('click', menu.close);
  $('co-start').addEventListener('click', function () {
    state.side = BK.chipValue($('co-f-side')) || 'white';
    state.family = $('co-family').value; save();
    var l = families[state.family][+$('co-line').value];
    menu.close(); if (l) start(l);
  });
  els.hint.addEventListener('click', hint);
  $('co-restart').addEventListener('click', function () { start(line); });
  els.next.addEventListener('click', nextLine);
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input,select')) return;
    var k = e.key.toLowerCase();
    if (k === 'h') hint(); else if (k === 'n') nextLine(); else if (k === 'r') start(line);
    else if (e.key === 'Escape' && sel >= 0) { sel = -1; targets = {}; paint(); }
  });

  start(families[state.family][0]);

  if (new URLSearchParams(location.search).has('debug')) {
    root.__co = { line: function () { return line; }, pos: function () { return pos; }, busy: function () { return busy; }, finished: function () { return finished; }, state: state, start: start, lines: lines, families: families, attemptUci: function (u) { var m = C.fromUci(E, pos, u); if (m) attempt(m); return !!m; } };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
