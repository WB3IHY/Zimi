/* ZimiGames: Fairy-Stockfish behind the Strong and Master levels of Chess, Xiangqi, Shogi (and Minishogi),
   Janggi and Makruk. Our own code, GPL-3.0. No network, no modules.
   Two halves. The pure half turns a game's position and moves into Fairy-Stockfish's FEN and UCI text and the
   engine's answer back into the game's own move (it runs under node for the tests). The client half starts
   engines/fairy-worker.js the first time a game set to Strong or Master has to move, never at page load.
   A page asks like this:
     ZimiFairy.ask(game, E, pos, played, level, function (move, why) { ... })
   move is the game's own move, or null, and then the page plays its own engine instead (why 'unavailable' means
   the Worker or the WebAssembly failed to load: tell the player once with ZimiFairy.note()). `played` is the list
   of moves made so far, so the engine sees the history (repetition rules). */
(function (root) {
  'use strict';
  var STRONG_MS = 1500, MASTER_MS = 6000;
  var LEVELS = { fairy: { ms: STRONG_MS, label: 'Strong' }, master: { ms: MASTER_MS, label: 'Master' } };
  var CHOICES = [['fairy', 'Strong'], ['master', 'Master']];
  var LOAD_GRACE_MS = 20000;   // the first request also waits for the module to compile
  var NOTE = 'Strong is unavailable here, so the computer plays at its own best level. ';

  // ── the pure half ──
  function wantsFairy(level) { return Object.prototype.hasOwnProperty.call(LEVELS, level); }
  function levelName(level, renames) {
    if (renames && renames[level]) return renames[level];
    return wantsFairy(level) ? LEVELS[level].label.toLowerCase() : level;
  }

  function files(n) { return 'abcdefghijklmnopqrstuvwxyz'.slice(0, n); }
  // The square's text: a file letter and a rank number, rank 1 at the bottom (ranks run to 10 on a 9 x 10 board).
  function square(s, cols, rows) { return files(cols)[s % cols] + (rows - ((s / cols) | 0)); }
  function movesOf(E, pos) { return (E.movesOrPass || E.legalMoves)(pos); }
  function kingSquare(E, pos, kingType) {
    for (var s = 0; s < pos.sq.length; s++) if (pos.sq[s] === pos.turn * kingType) return s;
    return -1;
  }

  // Fairy-Stockfish writes the horse N and the elephant B in xiangqi and janggi; ours are H and E.
  function xiangFen(E, pos) {
    var parts = E.toFen(pos).split(' ');
    var board = parts[0].replace(/H/g, 'N').replace(/h/g, 'n').replace(/E/g, 'B').replace(/e/g, 'b');
    return board + ' ' + parts[1] + ' - - ' + (pos.noCapture | 0) + ' 1';
  }

  var CHESS_PROMO = { 2: 'n', 3: 'b', 4: 'r', 5: 'q' };

  var GAMES = {
    chess: {
      variant: 'chess', cols: function () { return 8; }, rows: function () { return 8; },
      fen: function (E, pos) { return E.toFen(pos); },
      uci: function (E, pos, m) { return E.squareName(E.from(m)) + E.squareName(E.to(m)) + (E.promo(m) ? CHESS_PROMO[E.promo(m)] : ''); }
    },
    xiangqi: {
      variant: 'xiangqi', cols: function (E) { return E.COLS; }, rows: function (E) { return E.ROWS; },
      fen: xiangFen,
      uci: function (E, pos, m) { var c = E.COLS, r = E.ROWS; return square(E.from(m), c, r) + square(E.to(m), c, r); }
    },
    janggi: {
      variant: 'janggi', cols: function (E) { return E.COLS; }, rows: function (E) { return E.ROWS; },
      fen: xiangFen,
      // A pass is the general's square twice.
      uci: function (E, pos, m) {
        var c = E.COLS, r = E.ROWS;
        if (m === E.PASS) { var k = square(kingSquare(E, pos, E.G), c, r); return k + k; }
        return square(E.from(m), c, r) + square(E.to(m), c, r);
      },
      isPass: function (E, text) { return text.length > 3 && text.slice(0, text.length / 2) === text.slice(text.length / 2); },
      pass: function (E) { return E.PASS; }
    },
    makruk: {
      variant: 'makruk', cols: function (E) { return E.SIZE; }, rows: function (E) { return E.SIZE; },
      fen: function (E, pos) { var p = E.toFen(pos).split(' '); return p[0] + ' ' + p[1] + ' - - ' + (pos.quiet | 0) + ' 1'; },
      uci: function (E, pos, m) { var n = E.SIZE; return square(E.from(m), n, n) + square(E.to(m), n, n) + (E.isPromo(m) ? 'm' : ''); }
    },
    shogi: shogiGame('shogi'),
    minishogi: shogiGame('minishogi')
  };

  // Shogi: the hands go in [brackets] after the board (capitals are sente's), sente is "w", a promoted piece is +X,
  // a drop is "P@e5" and a promoting move ends in "+".
  function shogiGame(variant) {
    var LETTERS = ' PLNSGBRK';
    return {
      variant: variant, cols: function (E) { return E.SIZE; }, rows: function (E) { return E.SIZE; },
      fen: function (E, pos) {
        var parts = E.toSfen(pos).split(' '), hands = '';
        [0, 1].forEach(function (side) {
          for (var t = E.R; t >= E.P; t--) {
            var letter = side === 0 ? LETTERS[t] : LETTERS[t].toLowerCase();
            for (var i = 0; i < pos.hand[side][t]; i++) hands += letter;
          }
        });
        return parts[0] + '[' + hands + '] ' + (pos.turn === E.SENTE ? 'w' : 'b') + ' - - 0 1';
      },
      uci: function (E, pos, m) {
        var n = E.SIZE;
        if (E.isDrop(m)) return LETTERS[E.from(m)] + '@' + square(E.to(m), n, n);
        return square(E.from(m), n, n) + square(E.to(m), n, n) + (E.isPromo(m) ? '+' : '');
      }
    };
  }

  function game(name) {
    var g = GAMES[name];
    if (!g) throw new Error('ZimiFairy: no game ' + name);
    return g;
  }
  function fen(name, E, pos) { return game(name).fen(E, pos); }
  function uci(name, E, pos, m) { return game(name).uci(E, pos, m); }

  // The position the game started from and the moves played since, as text: take the moves back and put them on again.
  function history(name, E, pos, played) {
    var g = game(name), n = Math.min(played.length, pos.undo.length), i, texts = [];
    for (i = 0; i < n; i++) E.unmake(pos);
    var start = g.fen(E, pos);
    for (i = played.length - n; i < played.length; i++) { texts.push(g.uci(E, pos, played[i])); E.make(pos, played[i]); }
    return { fen: start, moves: texts };
  }

  // The engine's answer as one of the game's own legal moves, or null when it is none of them.
  function pick(name, E, pos, text) {
    if (!text) return null;
    var g = game(name), legal = movesOf(E, pos), i;
    if (g.isPass && g.isPass(E, text)) return legal.indexOf(g.pass(E)) >= 0 || !E.inCheck(pos) ? g.pass(E) : null;   // the page lets a side pass when not in check
    for (i = 0; i < legal.length; i++) if (g.uci(E, pos, legal[i]) === text) return legal[i];
    return null;
  }

  // ── the client half ──
  var worker = null, failed = false, busy = null, seq = 0, told = false;

  // The Worker's file sits beside this one; document.currentScript is only set while this script runs, so keep it now.
  var SCRIPT_URL = root.document && root.document.currentScript && root.document.currentScript.src;
  function workerUrl() { return new URL('fairy-worker.js', SCRIPT_URL || root.location.href).href; }

  function kill() { if (worker) { try { worker.terminate(); } catch (e) { /* gone already */ } } worker = null; }
  function settle(result, why) {
    if (!busy) return;
    var b = busy; busy = null; clearTimeout(b.timer);
    b.cb(result, why);
  }
  function fail() { failed = true; kill(); settle(null, 'unavailable'); }
  function onMessage(e) {
    var d = e.data;
    if (!busy || d.id !== busy.id) return;
    if (d.error || !d.move) { fail(); return; }
    var b = busy, m = pick(b.name, b.E, b.pos, d.move);
    settle(m, m === null ? 'illegal' : 'ok');
  }
  function start() {
    if (worker || failed) return worker;
    try {
      worker = new root.Worker(workerUrl());
      worker.onmessage = onMessage;
      worker.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); fail(); };
    } catch (e) { fail(); }
    return worker;
  }

  function ask(name, E, pos, played, level, cb) {
    if (failed || typeof root.Worker !== 'function') { cb(null, 'unavailable'); return; }
    if (busy) { clearTimeout(busy.timer); busy = null; kill(); }   // the answer to an old question is not wanted; do not queue behind it
    var w = start();
    if (!w) { cb(null, 'unavailable'); return; }
    var ms = LEVELS[level] ? LEVELS[level].ms : STRONG_MS, h = history(name, E, pos, played), id = ++seq;
    busy = { id: id, name: name, E: E, pos: pos, cb: cb, timer: setTimeout(fail, ms + LOAD_GRACE_MS) };
    w.postMessage({ id: id, variant: game(name).variant, fen: h.fen, moves: h.moves, ms: ms });
  }
  function cancel() { if (busy) { clearTimeout(busy.timer); busy = null; } kill(); }
  // The line to show when Strong could not start: once per page visit.
  function note() { if (told) return ''; told = true; return NOTE; }

  root.ZimiFairy = {
    LEVELS: LEVELS, CHOICES: CHOICES, wants: wantsFairy, levelName: levelName, GAMES: GAMES,
    fen: fen, uci: uci, history: history, pick: pick,
    ask: ask, cancel: cancel, note: note, down: function () { return failed; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
