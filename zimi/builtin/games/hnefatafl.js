/* ZimiGames: Hnefatafl (Copenhagen rules, 11 x 11), the page. The rules and the heuristic computer are in
   hnefatafl-engine.js, run in a Web Worker built from its own source (enginekit.js) with the main thread as the
   fallback. Our own code, GPL-3.0. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined' || !root.ZimiHnefataflEngine) return;
  var WK = root.WorldKit, BK = root.BoardKit, $ = function (id) { return document.getElementById(id); };
  var E = root.ZimiHnefataflEngine(root.ZimiSearch()), brain = root.EngineKit.client(root.ZimiHnefataflEngine, 400);
  var ATT = E.ATT, KING = E.KING, SIZE = E.N, N = E.SQUARES, HINT_MS = 1500, TOOK_MS = 900;
  var SIDE_NAME = ['Attackers', 'Defenders'];
  var CROWN = '<svg class="hn-crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18l-1-11 6 5 4-8 4 8 6-5-1 11z"/></svg>';

  var G = WK.create({
    id: 'hnefatafl',
    options: WK.standardOptions({ first: 'Attackers (first)', second: 'Defenders' }),
    checks: [{ key: 'hints', label: 'Show legal moves', def: true }, { key: 'shield', label: 'Shieldwall captures on the edge', def: false }],
    onNew: newGame, onUndo: undo, onHint: hint
  });
  var score = WK.scoreBar($('wk-score'), [{ color: 'var(--hn-att)' }, { color: 'var(--hn-def)', border: 'var(--hn-def-lo)' }]);
  var board = $('hn-board'), cells = [];
  var pos, keys, played, legal, sel = -1, targets = {}, lastMove = 0, tip = null, took = [], tookTimer = 0;

  function turnIdx() { return pos.turn === ATT ? 0 : 1; }
  function nameOf(p) { return G.vsComputer() ? (G.human(p) ? 'You' : 'The computer') : SIDE_NAME[p]; }

  function buildBoard() {
    board.textContent = '';
    for (var s = 0; s < N; s++) {
      var c = document.createElement('button');
      c.type = 'button'; c.dataset.s = s;
      c.addEventListener('click', onSquare);
      board.appendChild(c); cells.push(c);
    }
    BK.gridNav(board, cells, SIZE);
  }
  function pieceHtml(v) { return v === KING ? '<span class="hn-pc k">' + CROWN + '</span>' : '<span class="hn-pc ' + (v === ATT ? 'a' : 'd') + '"></span>'; }
  function label(s, v) {
    var what = v === ATT ? 'attacker' : v === E.DEF ? 'defender' : v === KING ? 'king' : s === E.THRONE ? 'throne, empty' : E.isCorner(s) ? 'corner' : 'empty';
    return E.squareName(s) + ', ' + what + (targets.hasOwnProperty(s) ? ', move here' : '') + (s === sel ? ', selected' : '');
  }

  function paint() {
    var open = !G.over && !G.thinking && G.human(turnIdx());
    for (var s = 0; s < N; s++) {
      var c = cells[s], v = pos.sq[s], cls = 'hn-sq';
      if (E.isCorner(s)) cls += ' corner'; else if (s === E.THRONE) cls += ' throne';
      if (lastMove && (s === E.from(lastMove) || s === E.to(lastMove))) cls += ' last';
      if (s === sel) cls += ' sel';
      if (tip && (s === tip[0] || s === tip[1])) cls += ' tip';
      if (took.indexOf(s) >= 0) cls += ' took';
      if (G.settings.hints && targets.hasOwnProperty(s)) cls += ' hint';
      c.className = cls;
      if (c.dataset.sig !== String(v)) { c.innerHTML = v ? pieceHtml(v) : ''; c.dataset.sig = String(v); }
      c.setAttribute('aria-label', label(s, v));
    }
    var att = 0, def = 0;
    for (var i = 0; i < N; i++) { if (pos.sq[i] === ATT) att++; else if (pos.sq[i]) def++; }
    var names = G.names(SIDE_NAME[0], SIDE_NAME[1]);
    score([names[0] + ' ' + att, names[1] + ' ' + def + ' + king'], null, G.over ? -1 : turnIdx());
    G.setUndo(played.length > 0); G.setHint(open);
  }

  var WHY = { 'king taken': 'The king is taken: the attackers win.', corner: 'The king reached a corner: the defenders win.', blocked: 'has no move left.', ringed: 'The attackers have ringed in every defender and win.', repetition: 'A draw: the same position came up three times.' };
  function finish(st) {
    sel = -1; targets = {}; tip = null;
    var msg, out, title, wi = st.winner === ATT ? 0 : 1;
    if (st.result === 'repetition') { msg = WHY.repetition; out = G.vsComputer() ? 'd' : null; title = 'A draw'; }
    else {
      msg = st.result === 'blocked' ? SIDE_NAME[1 - wi] + ' ' + WHY.blocked + ' ' + SIDE_NAME[wi] + ' win.' : WHY[st.result];
      if (G.vsComputer()) msg = (G.human(wi) ? 'You win. ' : 'The computer wins. ') + msg;
      out = G.vsComputer() ? (G.human(wi) ? 'w' : 'l') : null;
      title = G.vsComputer() && G.human(wi) ? 'You win' : 'Game over';
    }
    G.finish(msg, out, title);
    paint();
  }
  function afterMove(note) {
    sel = -1; targets = {}; tip = null;
    var st = E.status(pos, keys), p = turnIdx();
    if (st.over) { paint(); finish(st); return; }
    legal = E.moves(pos);
    paint();
    var line = !G.vsComputer() ? SIDE_NAME[p] + ' to move' : G.human(p) ? 'Your move (' + SIDE_NAME[p].toLowerCase() + ')' : 'Computer is thinking';
    G.say((note || '') + (st.kingThreat ? 'The king has a clear line to a corner. ' : '') + line, !G.human(p));
    if (!G.human(p)) computerTurn();
  }
  function play(m) {
    var who = nameOf(turnIdx());
    played.push(m);
    E.make(pos, m); keys.push(E.key(pos)); lastMove = m;
    took = E.lastCaptures(pos);
    clearTimeout(tookTimer);
    if (took.length) tookTimer = setTimeout(function () { took = []; paint(); }, TOOK_MS);
    var n = took.length;
    afterMove(who + (G.vsComputer() ? ' played ' : ': ') + E.notation(pos, m) + (n ? ', taking ' + n + (n === 1 ? ' piece' : ' pieces') : '') + '. ');
  }
  function request(extra) { return Object.assign({ sq: Array.from(pos.sq), turn: pos.turn, shield: pos.shield }, extra); }

  function computerTurn() {
    var token = G.begin();
    paint();
    brain.ask(request({ level: G.settings.level }), function (r) {
      if (!G.done(token)) return;
      play(r && legal.indexOf(r.move) >= 0 ? r.move : legal[0]);
    });
  }
  function hint() {
    var token = G.begin(); paint(); G.say('Thinking about a good move...', true);
    brain.ask(request({ level: 'hard', ms: HINT_MS }), function (r) {
      if (!G.done(token)) return;
      tip = r && r.move ? [E.from(r.move), E.to(r.move)] : null; paint();
      G.say(tip ? 'A good move is marked: ' + E.notation(pos, r.move) + '.' : 'No move to suggest.');
    });
  }

  function onSquare(e) {
    if (G.over || G.thinking || !G.human(turnIdx())) return;
    var s = +e.currentTarget.dataset.s, v = pos.sq[s];
    if (sel >= 0 && targets.hasOwnProperty(s)) { play(E.mk(sel, s)); return; }
    var mine = v && (pos.turn === ATT ? v === ATT : v !== ATT);
    if (mine && s !== sel) {
      sel = s; targets = {}; tip = null;
      legal.forEach(function (m) { if (E.from(m) === s) targets[E.to(m)] = true; });
      G.say(Object.keys(targets).length ? 'Choose where to move' : 'That piece cannot move');
    } else { sel = -1; targets = {}; }
    paint();
  }
  function undo() {
    if (!played.length) return;
    G.cancel(); G.over = false; G.closeResult();
    do { E.unmake(pos); played.pop(); keys.pop(); } while (played.length && G.vsComputer() && !G.human(turnIdx()));
    lastMove = played[played.length - 1] || 0; took = [];
    afterMove();
  }
  function newGame() {
    sel = -1; targets = {}; lastMove = 0; tip = null; took = [];
    pos = E.newPosition({ shield: G.settings.shield }); keys = [E.key(pos)]; played = [];
    afterMove();
  }

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('.ar-sheet,input')) return;
    if (e.key === 'Escape' && sel >= 0) { sel = -1; targets = {}; paint(); }
  });

  buildBoard();
  G.newGame();

  if (new URLSearchParams(location.search).has('debug')) {
    root.__hn = { engine: E, pos: function () { return pos; }, play: play, usingWorker: function () { return brain.usingWorker(); },
      setPosition: function (str, turn) { pos = E.fromString(str, turn, { shield: G.settings.shield }); keys = [E.key(pos)]; played = []; lastMove = 0; G.over = false; afterMove(); } };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
