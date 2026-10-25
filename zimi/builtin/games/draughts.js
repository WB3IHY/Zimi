/* ZimiGames: International draughts (10 x 10), the page. The rules and the searcher are in draughts-engine.js, run in
   a Web Worker built from its own source (enginekit.js) with the main thread as the fallback. Our own code, GPL-3.0. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined' || !root.ZimiDraughtsEngine) return;
  var WK = root.WorldKit, BK = root.BoardKit, $ = function (id) { return document.getElementById(id); };
  var E = root.ZimiDraughtsEngine(root.ZimiSearch()), brain = root.EngineKit.client(root.ZimiDraughtsEngine, 300);
  var WHITE = E.WHITE, SIZE = E.N, N = E.SQUARES, HINT_MS = 1500;
  var SIDE_NAME = ['White', 'Black'];
  var CROWN = '<svg class="dr-crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18l-1-11 6 5 4-8 4 8 6-5-1 11z"/></svg>';

  var G = WK.create({
    id: 'draughts',
    options: WK.standardOptions({ first: 'White (first)', second: 'Black' }),
    checks: [{ key: 'hints', label: 'Show legal moves', def: true }, { key: 'numbers', label: 'Show square numbers', def: false }],
    onNew: newGame, onUndo: undo, onHint: hint
  });
  var score = WK.scoreBar($('wk-score'), [{ color: 'var(--dr-w)', border: 'var(--dr-w-lo)' }, { color: 'var(--dr-b)' }]);
  var board = $('dr-board'), flipBtn = $('dr-flip'), cells = [];
  var pos, keys, played, legal, sel = -1, prefix = [], cands = [], lastMove = null, manualFlip = false, tip = null;

  function turnIdx() { return pos.turn === WHITE ? 0 : 1; }
  function flipped() { return manualFlip !== (G.vsComputer() && G.settings.side === 'second'); }
  function sqAt(d) { return flipped() ? N - 1 - d : d; }
  function nameOf(p) { return G.vsComputer() ? (G.human(p) ? 'You' : 'The computer') : SIDE_NAME[p]; }

  function buildBoard() {
    board.textContent = '';
    for (var d = 0; d < N; d++) {
      var c = document.createElement('button');
      c.type = 'button'; c.dataset.d = d;
      c.addEventListener('click', onSquare);
      board.appendChild(c); cells.push(c);
    }
    BK.gridNav(board, cells, SIZE);
  }
  function pieceHtml(v) { return '<span class="dr-pc ' + (v > 0 ? 'w' : 'b') + '">' + (Math.abs(v) === E.KING ? CROWN : '') + '</span>'; }

  // The squares the next tap may land on: the next landing of every move still open.
  function nextLandings() { var o = {}; cands.forEach(function (m) { o[m.path[prefix.length]] = true; }); return o; }
  function movable() { var o = {}; legal.forEach(function (m) { o[m.from] = true; }); return o; }

  function paint() {
    var open = !G.over && !G.thinking && G.human(turnIdx());
    var land = sel >= 0 ? nextLandings() : {}, mov = open && G.settings.hints && sel < 0 ? movable() : {};
    var count = [0, 0], kings = [0, 0];
    for (var d = 0; d < N; d++) {
      var s = sqAt(d), c = cells[d], v = pos.sq[s], dark = E.isDark(s), cls = 'bg-sq' + (dark ? ' dk' : '');
      if (lastMove && (s === lastMove.from || s === lastMove.to || lastMove.path.indexOf(s) >= 0)) cls += ' last';
      if (s === sel) cls += ' sel';
      if (prefix.indexOf(s) >= 0) cls += ' path';
      if (tip && (s === tip.from || s === tip.path[0])) cls += ' tip';
      if (G.settings.hints && land[s]) cls += ' hint';
      if (mov[s]) cls += ' can';
      c.className = cls;
      var sig = v + '|' + (dark && G.settings.numbers ? E.numberOf(s) : '');
      if (c.dataset.sig !== sig) { c.innerHTML = (dark && G.settings.numbers ? '<span class="dr-n">' + E.numberOf(s) + '</span>' : '') + (v ? pieceHtml(v) : ''); c.dataset.sig = sig; }
      c.setAttribute('aria-label', (dark ? 'square ' + E.numberOf(s) : 'light square') + ', ' + (v ? (v > 0 ? 'white ' : 'black ') + (Math.abs(v) === E.KING ? 'king' : 'man') : land[s] ? 'land here' : 'empty') + (s === sel ? ', selected' : ''));
      if (v) { count[v > 0 ? 0 : 1]++; if (Math.abs(v) === E.KING) kings[v > 0 ? 0 : 1]++; }
    }
    var names = G.names(SIDE_NAME[0], SIDE_NAME[1]);
    score([names[0] + ' ' + count[0] + (kings[0] ? ' (' + kings[0] + ' kings)' : ''), names[1] + ' ' + count[1] + (kings[1] ? ' (' + kings[1] + ' kings)' : '')], null, G.over ? -1 : turnIdx());
    flipBtn.setAttribute('aria-pressed', String(flipped()));
    G.setUndo(played.length > 0); G.setHint(open);
  }

  var WHY = { repetition: 'A draw: the same position came up three times.', quiet: 'A draw: twenty-five moves each of kings alone, with no capture.' };
  function finish(st) {
    sel = -1; prefix = []; cands = []; tip = null;
    var msg, out, title;
    if (st.result === 'win') {
      var wi = st.winner === WHITE ? 0 : 1;
      msg = (G.vsComputer() ? (G.human(wi) ? 'You win' : 'The computer wins') : SIDE_NAME[wi] + ' wins') + ': ' + SIDE_NAME[1 - wi].toLowerCase() + ' has no move left.';
      out = G.vsComputer() ? (G.human(wi) ? 'w' : 'l') : null;
      title = G.vsComputer() && G.human(wi) ? 'You win' : 'Game over';
    } else { msg = WHY[st.result]; out = G.vsComputer() ? 'd' : null; title = 'A draw'; }
    G.finish(msg, out, title);
    paint();
  }
  function afterMove(note) {
    sel = -1; prefix = []; cands = []; tip = null;
    var st = E.status(pos, keys), p = turnIdx();
    if (st.over) { finish(st); return; }
    legal = E.moves(pos);
    paint();
    var line = !G.vsComputer() ? SIDE_NAME[p] + ' to move' : G.human(p) ? 'Your move' : 'Computer is thinking';
    if (st.mustCapture && G.human(p)) line += ': you must capture' + (legal[0].caps.length > 1 ? ' ' + legal[0].caps.length + ' pieces' : '');
    G.say((note || '') + line, !G.human(p));
    if (!G.human(p)) computerTurn();
  }
  function play(m) {
    var who = nameOf(turnIdx());
    played.push(m);
    E.make(pos, m); keys.push(E.key(pos)); lastMove = m;
    afterMove(who + (G.vsComputer() ? ' played ' : ': ') + E.notation(m) + '. ');
  }
  function request(extra) { return Object.assign({ sq: Array.from(pos.sq), turn: pos.turn, quiet: pos.quiet }, extra); }

  function computerTurn() {
    var token = G.begin();
    paint();
    brain.ask(request({ level: G.settings.level }), function (r) {
      if (!G.done(token)) return;
      play(r && r.index >= 0 && r.index < legal.length ? legal[r.index] : legal[0]);
    });
  }
  function hint() {
    var token = G.begin(); paint(); G.say('Thinking about a good move...', true);
    brain.ask(request({ level: 'hard', ms: HINT_MS }), function (r) {
      if (!G.done(token)) return;
      tip = r && r.index >= 0 && r.index < legal.length ? legal[r.index] : null; paint();
      G.say(tip ? 'A good move is marked: ' + E.notation(tip) + '.' : 'No move to suggest.');
    });
  }

  function onSquare(e) {
    if (G.over || G.thinking || !G.human(turnIdx())) return;
    var s = sqAt(+e.currentTarget.dataset.d), v = pos.sq[s], i;
    if (sel >= 0) {
      var next = cands.filter(function (m) { return m.path[prefix.length] === s; });
      if (!next.length) {   // the last square of a chain, tapped straight away, when only one move ends there
        var ends = cands.filter(function (m) { return m.to === s; });
        if (ends.length === 1) next = ends;
      }
      if (next.length === 1) { play(next[0]); return; }
      if (next.length > 1) { prefix = prefix.concat([s]); cands = next; G.say('Choose the next landing square'); paint(); return; }
    }
    if (v * pos.turn > 0 && s !== sel) {
      var mine = legal.filter(function (m) { return m.from === s; });
      if (mine.length) { sel = s; prefix = []; cands = mine; tip = null; G.say(mine[0].caps.length ? 'Tap where it lands' : 'Choose where to move'); }
      else { sel = -1; prefix = []; cands = []; G.say(legal[0].caps.length ? 'A capture is compulsory: that piece cannot take' : 'That piece has no move'); }
    } else { sel = -1; prefix = []; cands = []; }
    paint();
  }

  function undo() {
    if (!played.length) return;
    G.cancel(); G.over = false; G.closeResult();
    do { E.unmake(pos); played.pop(); keys.pop(); } while (played.length && G.vsComputer() && !G.human(turnIdx()));
    lastMove = played[played.length - 1] || null;
    afterMove();
  }
  function newGame() {
    sel = -1; prefix = []; cands = []; lastMove = null; tip = null; manualFlip = false;
    pos = E.newPosition(); keys = [E.key(pos)]; played = [];
    afterMove();
  }

  flipBtn.addEventListener('click', function () { manualFlip = !manualFlip; paint(); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input')) return;
    if (e.key.toLowerCase() === 'f') { manualFlip = !manualFlip; paint(); }
    else if (e.key === 'Escape' && sel >= 0) { sel = -1; prefix = []; cands = []; paint(); }
  });

  buildBoard();
  G.newGame();

  if (new URLSearchParams(location.search).has('debug')) {
    root.__dr = { engine: E, pos: function () { return pos; }, play: play, usingWorker: function () { return brain.usingWorker(); },
      setPosition: function (str, turn) { pos = E.fromString(str, turn); keys = [E.key(pos)]; played = []; lastMove = null; G.over = false; afterMove(); } };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
