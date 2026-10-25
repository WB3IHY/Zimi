/* ZimiGames: what the engine-backed board games share. Our own code, GPL-3.0. No network, no modules.
   ZimiSearch is one self-contained function (so a Web Worker can be built from its source): a
   negamax alpha-beta searcher with iterative deepening, a time limit and a little noise at the
   root for the gentler levels. A game hands it an adapter:
     moves(pos) -> the legal moves (any values)      make(pos, m), unmake(pos)
     evaluate(pos) -> score for the side to move     order(pos, m) -> number, higher is tried first (optional)
     terminal(pos, ply) -> a score or null (draws, decided games) (optional)
     extend(pos) -> true to search one ply deeper (a forced capture, a check) (optional)
     noMoves(pos, ply) -> the score when there is no legal move (optional, default a loss)
   EngineKit.client runs a game's engine in a Worker from a Blob and falls back to the main thread. */
function ZimiSearch() {
  'use strict';
  var MATE = 30000, INF = 32000, MAX_PLY = 64, CHECK_TIME_EVERY = 255;
  function Timeout() { this.name = 'Timeout'; }

  function search(a, pos, opts) {
    var maxDepth = opts.depth || 4, deadline = Date.now() + (opts.ms || 1000), noise = opts.noise || 0, rnd = opts.rng || Math.random;
    var nodes = 0, killers = [];
    function order(list, ply, first) {
      if (!a.order) return list;
      var sc = list.map(function (m, i) { return { m: m, s: (m === first ? 1e9 : a.order(pos, m)) + (killers[ply] === m ? 5e4 : 0), i: i }; });
      sc.sort(function (x, y) { return y.s - x.s || x.i - y.i; });
      return sc.map(function (x) { return x.m; });
    }
    function negamax(depth, alpha, beta, ply) {
      if ((++nodes & CHECK_TIME_EVERY) === 0 && Date.now() > deadline) throw new Timeout();
      var t = a.terminal ? a.terminal(pos, ply) : null;
      if (t !== null && t !== undefined) return t;
      var list = a.moves(pos);
      if (!list.length) return a.noMoves ? a.noMoves(pos, ply) : -MATE + ply;
      if (a.extend && ply < MAX_PLY && depth <= 1 && a.extend(pos)) depth++;
      if (depth <= 0) return a.evaluate(pos);
      list = order(list, ply);
      var best = -INF;
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        a.make(pos, m);
        var s;
        try { s = -negamax(depth - 1, -beta, -alpha, ply + 1); } finally { a.unmake(pos); }
        if (s > best) best = s;
        if (s > alpha) alpha = s;
        if (alpha >= beta) { killers[ply] = m; break; }
      }
      return best;
    }
    var roots = a.moves(pos);
    if (!roots.length) return { move: null, score: 0, depth: 0 };
    if (roots.length === 1) return { move: roots[0], score: 0, depth: 0 };
    var best = roots[0], bestScore = 0, reached = 0;
    for (var depth = 1; depth <= maxDepth; depth++) {
      var iterBest = null, iterScore = -INF, alpha = -INF, noisy = -INF;
      roots = order(roots, 0, best);
      try {
        for (var i = 0; i < roots.length; i++) {
          a.make(pos, roots[i]);
          var s;
          // With noise every root move gets a full window, so every score is exact and can be jittered fairly.
          try { s = -negamax(depth - 1, -INF, noise ? INF : -alpha, 1); } finally { a.unmake(pos); }
          if (s > iterScore) { iterScore = s; if (!noise) iterBest = roots[i]; }
          if (noise) { var j = s + (rnd() - 0.5) * 2 * noise; if (j > noisy) { noisy = j; iterBest = roots[i]; } }
          if (s > alpha) alpha = s;
        }
        best = iterBest; bestScore = iterScore; reached = depth;
      } catch (e) {
        if (!(e instanceof Timeout)) throw e;
        break;
      }
      if (Math.abs(bestScore) > MATE - MAX_PLY) break;
    }
    return { move: best, score: bestScore, depth: reached, nodes: nodes };
  }
  return { search: search, MATE: MATE };
}
if (typeof globalThis !== 'undefined') globalThis.ZimiSearch = ZimiSearch;

(function (root) {
  'use strict';
  var DEFAULT_FALLBACK_MS = 300, FALLBACK_DEPTH = 3;
  // factory: a function (S) -> engine, where engine.handle(request) answers a request.
  // client(factory).ask(request, cb): cb(answer), or cb(null) if the engine failed. The Worker's source is built from
  // ZimiSearch and the factory, so there is no second file to fetch (it works from a ZIM and from Kiwix).
  function client(factory, fallbackMs) {
    var worker = null, failed = false, seq = 0, waiting = {}, engine = null;
    function here() { if (!engine) engine = factory(root.ZimiSearch()); return engine; }
    function start() {
      if (worker || failed) return;
      try {
        var src = 'var S=(' + root.ZimiSearch.toString() + ')();var E=(' + factory.toString() + ')(S);' +
          'onmessage=function(e){var d=e.data,r;try{r=E.handle(d.req);}catch(x){r={error:String(x)};}postMessage({id:d.id,result:r});};';
        worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        worker.onmessage = function (e) { var cb = waiting[e.data.id]; delete waiting[e.data.id]; if (cb) cb(e.data.result); };
        worker.onerror = function (e) {
          if (e && e.preventDefault) e.preventDefault();
          failed = true; worker = null;
          var all = waiting; waiting = {};
          Object.keys(all).forEach(function (k) { all[k](null); });
        };
      } catch (e) { failed = true; worker = null; }
    }
    function main(req, cb) {
      var cap = fallbackMs || DEFAULT_FALLBACK_MS;
      var r = Object.assign({}, req, { ms: Math.min(req.ms || cap, cap), depth: Math.min(req.depth || FALLBACK_DEPTH, FALLBACK_DEPTH) });
      setTimeout(function () { var out = null; try { out = here().handle(r); } catch (e) { out = null; } cb(out); }, 30);
    }
    function ask(req, cb) {
      start();
      if (!worker) { main(req, cb); return; }
      var id = ++seq;
      waiting[id] = function (r) { if (r === null || (r && r.error)) main(req, cb); else cb(r); };
      worker.postMessage({ id: id, req: req });
    }
    return { ask: ask, usingWorker: function () { return !!worker; }, local: here, drop: function () { failed = true; if (worker) worker.terminate(); worker = null; } };
  }
  root.EngineKit = { client: client };
})(typeof globalThis !== 'undefined' ? globalThis : this);
