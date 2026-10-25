/* ZimiGames: Go, 9 by 9 and 13 by 13. Our own code, GPL-3.0. The rules, scoring and the Monte
   Carlo computer live in go-engine.js (also run in a Worker made from a Blob, with the main
   thread as a fallback). This file is the page. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  var WK = root.WorldKit, BK = root.BoardKit, Engine = root.makeGoEngine(), BLACK = 1, WHITE = 2;
  var VIEW = 420, PAD = 30, NAMES = ['Black', 'White'];
  var THINK_MS = { easy: 350, medium: 1600, hard: 4200 }, FALLBACK_MS = 800, HINT_MS = 1800, DEAD_MS = 900;
  var HOSHI = { 9: [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]], 13: [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6], [3, 6], [6, 3], [6, 9], [9, 6]] };

  var host = document.getElementById('wk-board'), stonesG, marksG, btns = [], n = 9, cell = 45;
  var st, history = WK.History(), phase = 'play', dead = null, hintIdx = -1, lastMsg = '';
  var passBtn = document.getElementById('go-pass'), doneBtn = document.getElementById('go-done'), resumeBtn = document.getElementById('go-resume');
  var score = WK.scoreBar(document.getElementById('wk-score'), [{ color: '#1c222d' }, { color: '#f4f0e4' }]);
  var G = WK.create({
    id: 'go',
    options: WK.standardOptions({ first: 'Black (first)', second: 'White' }).concat([{ key: 'size', legend: 'Board', def: '9', choices: [['9', '9 by 9'], ['13', '13 by 13']] }]),
    statKey: function (s) { return s.size + s.level; },
    onNew: newGame, onUndo: undo, onHint: hint
  });

  // ── the computer, in a Worker when the page allows one ──
  var worker = null, workerFailed = false, reqId = 0, waiting = {};
  function startWorker() {
    if (worker || workerFailed) return;
    try {
      var src = '(function(){var E=(' + root.makeGoEngine.toString() + ')();self.onmessage=function(e){var d=e.data,r;try{r=E.handle(d);}catch(x){r={error:String(x)};}self.postMessage({id:d.id,result:r});};})();';
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = function (e) { var cb = waiting[e.data.id]; delete waiting[e.data.id]; if (cb) cb(e.data.result); };
      worker.onerror = function () { workerFailed = true; worker = null; var all = waiting; waiting = {}; Object.keys(all).forEach(function (k) { all[k](null); }); };
    } catch (e) { workerFailed = true; worker = null; }
  }
  // Ask the engine; the reply comes to cb (null if the engine could not answer).
  function ask(req, cb) {
    var id = ++reqId, body = { cmd: req.cmd, n: st.n, board: Array.prototype.slice.call(st.board), turn: st.turn, caps: st.caps, ko: st.ko, passes: st.passes, last: st.last, moves: st.moves, ms: req.ms, level: req.level, seed: (Date.now() & 0x7fffffff) | 1, id: id };
    startWorker();
    if (worker) { waiting[id] = function (r) { if (r === null) fallback(); else cb(r); }; worker.postMessage(body); return; }
    fallback();
    function fallback() {
      body.ms = Math.min(body.ms, FALLBACK_MS);
      setTimeout(function () { var r = null; try { r = Engine.handle(body); } catch (e) { r = null; } cb(r); }, 40);
    }
  }
  function thinkMs() { return THINK_MS[G.settings.level] * (n === 13 ? 1.5 : 1); }

  // ── drawing ──
  function xy(i) { return { x: PAD + (i % n) * cell, y: PAD + ((i / n) | 0) * cell }; }
  function coord(i) { return 'ABCDEFGHJKLMN'[i % n] + (n - ((i / n) | 0)); }
  function buildBoard() {
    n = +G.settings.size; cell = (VIEW - 2 * PAD) / (n - 1);
    var g = '', k, stars = '';
    for (k = 0; k < n; k++) { var o = PAD + k * cell; g += 'M' + PAD + ' ' + o + 'H' + (VIEW - PAD) + 'M' + o + ' ' + PAD + 'V' + (VIEW - PAD); }
    HOSHI[n].forEach(function (p) { stars += '<circle cx="' + (PAD + p[1] * cell) + '" cy="' + (PAD + p[0] * cell) + '" r="3.6" class="go-star"/>'; });
    host.innerHTML = '<svg viewBox="0 0 ' + VIEW + ' ' + VIEW + '" aria-hidden="true">' + WK.STONE_DEFS + '<rect width="' + VIEW + '" height="' + VIEW + '" rx="8" class="go-wood"/><path d="' + g + '" class="go-grid"/>' + stars + '<g id="go-marks"></g><g id="go-stones"></g><g id="go-top"></g></svg>';
    stonesG = host.querySelector('#go-stones'); marksG = host.querySelector('#go-marks');
    var pts = [];
    for (var i = 0; i < n * n; i++) { var p = xy(i); pts.push({ x: p.x, y: p.y, w: cell }); }
    btns = WK.overlay(host, VIEW, VIEW, pts, onPoint, 'go-pt');
  }

  function liveScore() { return Engine.score(st.board, n, dead, st.caps); }

  function paint() {
    var b = st.board, s = '', m = '', i, p, r = cell * 0.47, marking = phase === 'mark', sc = marking ? liveScore() : null;
    for (i = 0; i < n * n; i++) {
      if (!b[i]) continue;
      p = xy(i);
      var isDead = marking && dead[i];
      s += '<g' + (isDead ? ' class="go-dead"' : '') + '><circle cx="' + p.x + '" cy="' + (p.y + 1.5) + '" r="' + r + '" class="go-shadow"/><circle cx="' + p.x + '" cy="' + p.y + '" r="' + r + '" fill="url(#wk-stone-' + (b[i] === BLACK ? 'b' : 'w') + ')"/>' +
        (isDead ? '<path d="M' + (p.x - r * 0.45) + ' ' + (p.y - r * 0.45) + 'l' + (r * 0.9) + ' ' + (r * 0.9) + 'm0 ' + (-r * 0.9) + 'l' + (-r * 0.9) + ' ' + (r * 0.9) + '" class="go-x ' + (b[i] === BLACK ? 'on-b' : 'on-w') + '"/>' : '') + '</g>';
    }
    if (marking) {
      for (i = 0; i < n * n; i++) {
        if (!sc.territory[i]) continue;
        p = xy(i);
        m += '<rect x="' + (p.x - cell * 0.17) + '" y="' + (p.y - cell * 0.17) + '" width="' + (cell * 0.34) + '" height="' + (cell * 0.34) + '" class="go-terr ' + (sc.territory[i] === BLACK ? 'b' : 'w') + '"/>';
      }
    } else {
      if (st.last >= 0) { p = xy(st.last); m += '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (r * 0.34) + '" class="go-last ' + (b[st.last] === BLACK ? 'on-b' : 'on-w') + '"/>'; }
      if (st.ko >= 0 && !G.over) { p = xy(st.ko); m += '<rect x="' + (p.x - cell * 0.2) + '" y="' + (p.y - cell * 0.2) + '" width="' + (cell * 0.4) + '" height="' + (cell * 0.4) + '" class="go-ko"/>'; }
      if (hintIdx >= 0) { p = xy(hintIdx); m += '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (r * 0.8) + '" class="go-hint"/>'; }
    }
    stonesG.innerHTML = s; marksG.innerHTML = m;
    var open = !G.over && !G.thinking && G.human(st.turn - 1);
    btns.forEach(function (bt, j) {
      bt.setAttribute('aria-label', coord(j) + ', ' + (b[j] === BLACK ? 'black' : b[j] === WHITE ? 'white' : 'empty') + (marking && b[j] ? (dead[j] ? ', dead' : ', alive') : ''));
      bt.setAttribute('aria-disabled', (marking ? (!b[j] || G.over) : (!open || b[j])) ? 'true' : 'false');
    });
    var names = G.names(NAMES[0], NAMES[1]);
    if (marking) score([names[0] + ' ' + fmt(sc.black), names[1] + ' ' + fmt(sc.white)], null, -1);
    else score([names[0] + ' ' + st.caps[0] + ' taken', names[1] + ' ' + st.caps[1] + ' taken'], null, G.over ? -1 : st.turn - 1);
    passBtn.hidden = marking; doneBtn.hidden = !marking || G.over; resumeBtn.hidden = !marking || G.over;
    passBtn.disabled = !open;
    G.setUndo(history.size() > 0); G.setHint(open && !marking);
  }
  function fmt(x) { return x % 1 ? x.toFixed(1) : String(x); }

  function turnText() {
    var p = st.turn - 1, nm = NAMES[p];
    if (phase === 'mark') return 'Tap stones that are dead. Black ' + fmt(liveScore().black) + ', White ' + fmt(liveScore().white) + ' (komi ' + Engine.KOMI + ').';
    if (!G.vsComputer()) return nm + ' to play';
    return G.human(p) ? 'Your move (' + nm.toLowerCase() + ')' : 'Computer is thinking';
  }
  function nameOf(p) { return G.vsComputer() ? (G.human(p) ? 'You' : 'The computer') : NAMES[p]; }

  // ── playing ──
  function onPoint(i) {
    if (G.over) return;
    if (phase === 'mark') { toggleDead(i); return; }
    if (G.thinking || !G.human(st.turn - 1) || st.board[i]) return;
    var ns = Engine.move(st, i);
    if (!ns) { flash(i, i === st.ko ? 'That would repeat the earlier position (ko). Play somewhere else first.' : 'That point has no liberties: suicide is not allowed.'); return; }
    commit(ns, 'You');
  }
  function flash(i, msg) {
    var bt = btns[i]; bt.classList.add('bad'); setTimeout(function () { bt.classList.remove('bad'); }, 350);
    G.say(msg);
  }
  function commit(ns, who) {
    history.push(st); hintIdx = -1;
    var took = ns.taken ? ns.taken.length : 0, passed = ns.passes > 0;
    st = ns;
    var note = passed ? who + ' passed. ' : took ? who + (took === 1 ? ' took a stone. ' : ' took ' + took + ' stones. ') : '';
    if (st.passes >= 2) { paint(); enterMark(); return; }
    paint(); G.say(note + turnText(), !G.human(st.turn - 1));
    if (!G.human(st.turn - 1)) computerTurn();
  }
  function computerTurn() {
    var token = G.begin();
    paint(); G.say(lastMsg = 'Computer is thinking', true);
    ask({ cmd: 'move', ms: thinkMs(), level: G.settings.level }, function (r) {
      if (!G.done(token)) return;
      var mv = r && typeof r.move === 'number' ? r.move : -1, ns = Engine.move(st, mv);
      if (!ns) ns = Engine.move(st, -1);
      commit(ns, 'The computer');
    });
  }
  function pass() {
    if (G.over || G.thinking || phase !== 'play' || !G.human(st.turn - 1)) return;
    commit(Engine.move(st, -1), 'You');
  }
  passBtn.addEventListener('click', pass);

  function hint() {
    var token = G.begin(); paint(); G.say('Thinking about a good move...', true);
    ask({ cmd: 'move', ms: HINT_MS, level: 'hard' }, function (r) {
      if (!G.done(token)) return;
      hintIdx = r && r.move >= 0 ? r.move : -1; paint();
      G.say(hintIdx >= 0 ? 'A good point is ringed. ' + turnText() : 'The computer would pass here. ' + turnText());
    });
  }

  // ── the end: mark dead stones, then count ──
  function enterMark() {
    var token = G.begin();
    phase = 'mark'; dead = new Array(n * n).fill(false);
    paint(); G.say('Both passed. Working out which stones are dead...', true);
    ask({ cmd: 'dead', ms: DEAD_MS }, function (r) {
      if (!G.done(token)) return;
      if (r && r.dead) dead = r.dead;
      paint(); G.say(turnText());
    });
  }
  function toggleDead(i) {
    if (!st.board[i] || G.thinking) return;
    var grp = Engine.groupAt(st.board, n, i), to = !dead[i];
    grp.forEach(function (q) { dead[q] = to; });
    paint(); G.say(turnText());
  }
  function accept() {
    if (phase !== 'mark' || G.over) return;
    var sc = liveScore(), diff = sc.black - sc.white, w = diff > 0 ? 0 : 1;
    var detail = 'Black ' + fmt(sc.black) + ' (' + sc.terrB + ' points + ' + sc.prisB + ' prisoners), White ' + fmt(sc.white) + ' (' + sc.terrW + ' points + ' + (sc.prisW) + ' prisoners + ' + sc.komi + ' komi).';
    var margin = fmt(Math.abs(diff));
    var msg = (G.vsComputer() ? (G.human(w) ? 'You win' : 'The computer wins') : NAMES[w] + ' wins') + ' by ' + margin + '. ' + detail;
    G.finish(msg, G.vsComputer() ? (G.human(w) ? 'w' : 'l') : null, G.vsComputer() && G.human(w) ? 'You win' : 'Game over');
    paint();
  }
  doneBtn.addEventListener('click', accept);
  resumeBtn.addEventListener('click', function () {
    if (phase !== 'mark' || G.over) return;
    phase = 'play'; dead = null;
    st = { n: st.n, board: st.board, turn: st.turn, caps: st.caps, ko: st.ko, passes: 0, last: st.last, moves: st.moves, taken: [] };
    paint(); G.say('Play goes on. ' + turnText(), !G.human(st.turn - 1));
    if (!G.human(st.turn - 1)) computerTurn();
  });

  function undo() {
    if (!history.size()) return;
    G.cancel(); G.over = false; phase = 'play'; dead = null; hintIdx = -1;
    var h;
    do { h = history.pop(); st = h; } while (history.size() && G.vsComputer() && !G.human(st.turn - 1));
    paint(); G.say(turnText());
    if (!G.human(st.turn - 1)) computerTurn();
  }

  function newGame() {
    if (+G.settings.size !== n || !stonesG) buildBoard();
    history.clear(); phase = 'play'; dead = null; hintIdx = -1;
    st = Engine.newGame(n);
    paint(); G.say(turnText(), !G.human(0));
    if (!G.human(0)) computerTurn();
  }

  G.newGame();
  if (new URLSearchParams(location.search).has('debug')) root.__go = { state: function () { return st; }, engine: Engine, phase: function () { return phase; }, dead: function () { return dead; }, ask: ask };
})(typeof globalThis !== 'undefined' ? globalThis : this);
