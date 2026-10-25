/* ZimiGames: the Worker behind the Strong and Master levels. Our own code, GPL-3.0.
   It loads Fairy-Stockfish (engines/fairy/, a single-threaded WebAssembly build) on the first request, so
   nothing here runs until a game set to Strong or Master has to move.
   In:  { id, variant, fen, moves: [uci...], ms }     Out: { id, move, score, depth } or { id, error }
   The module's bytes are fetched as an ArrayBuffer and handed over, so the Content-Type of fairy.wasm does not matter
   (Kiwix may send application/octet-stream). */
'use strict';
var BASE = new URL('fairy/', self.location.href).href;
var engine = null, loading = null, lines = [], variant = '';

function send(line) { engine.ccall('zimi_command', null, ['string'], [line]); }

function load() {
  importScripts(BASE + 'fairy.js');
  return fetch(BASE + 'fairy.wasm').then(function (r) {
    if (!r.ok) throw new Error('fairy.wasm ' + r.status);
    return r.arrayBuffer();
  }).then(function (bytes) {
    return self.FairyStockfish({ wasmBinary: bytes, print: function (l) { lines.push(l); }, printErr: function () {} });
  }).then(function (m) {
    engine = m;
    m._zimi_init();
    send('uci');
    send('setoption name Use NNUE value false');
    send('setoption name Hash value 16');
  });
}

function search(d) {
  lines.length = 0;
  if (d.variant !== variant) { send('setoption name UCI_Variant value ' + d.variant); variant = d.variant; }
  if (!d.moves.length) send('ucinewgame');
  send('position fen ' + d.fen + (d.moves.length ? ' moves ' + d.moves.join(' ') : ''));
  send('go movetime ' + Math.max(50, d.ms | 0));
  var best = null, info = null;
  lines.forEach(function (l) {
    if (l.indexOf('bestmove ') === 0) best = l.split(/\s+/)[1];
    else if (l.indexOf('info depth') === 0 && l.indexOf(' pv ') > 0) info = l;
  });
  var score = info && /score cp (-?\d+)/.exec(info), depth = info && /depth (\d+)/.exec(info);
  return { move: best, score: score ? +score[1] : null, depth: depth ? +depth[1] : 0 };
}

self.onmessage = function (e) {
  var d = e.data;
  loading = loading || load();
  loading.then(function () {
    var r = search(d);
    self.postMessage({ id: d.id, move: r.move, score: r.score, depth: r.depth });
  }).catch(function (err) {
    self.postMessage({ id: d.id, error: String(err && err.message || err) });
  });
};
