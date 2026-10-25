Fairy-Stockfish, vendored into ZimiGames as the Strong and Master levels
========================================================================

What this is
  fairy.js + fairy.wasm: Fairy-Stockfish compiled to a single-threaded
  WebAssembly module. It plays chess, xiangqi, shogi, minishogi, janggi and
  makruk (and many more variants) with Stockfish's search. Strong and Master
  in Chess, Xiangqi, Shogi (and Minishogi), Janggi and Makruk use it, in a Web
  Worker started the first time one of those levels has to move
  (engines/fairy.js and engines/fairy-worker.js are ours, one folder up).

Source and version
  Engine:     https://github.com/fairy-stockfish/Fairy-Stockfish
              commit 9f778da667f6e07dae1e85d3e2ea204fc6dee94d (2026-09-23)
  Licence:    GPL-3.0 (LICENCE here is upstream's Copying.txt, unchanged;
              AUTHORS is upstream's, unchanged). Zimi is GPL-3.0 too.
  Built:      2026-10-24 with Emscripten 6.0.13, see source/build.sh
  Size:       fairy.wasm 1,020,194 bytes, fairy.js 61,963 bytes

Why we build it ourselves
  The prebuilt WebAssembly builds do not fit. npm "fairy-stockfish-nnue.wasm"
  (the official engine build, 1.1.12) needs pthreads and so SharedArrayBuffer,
  which a browser only gives pages served with COOP/COEP headers; a ZIM in
  Kiwix and plain http.server send neither, and the engine refuses to start.
  npm "ffish" (0.7.10) is single-threaded but has the rules and no search.
  Upstream's own ffish build already compiles with -DNO_THREADS; we do the same
  for the search.

What is changed from upstream (source/zimi-inline-search.patch, applied to the commit above)
  1. src/thread.cpp, src/tt.cpp: under -DZIMI_INLINE_SEARCH no std::thread is
     created. The search runs on the caller's stack inside start_searching(),
     and the hash is cleared on the calling thread.
  2. src/uci.cpp, src/uci.h: UCI::wasm_init() and UCI::wasm_command(line), the
     body of UCI::loop() as one call per command with the position kept
     between calls (the loop blocks reading stdin, which a Worker cannot do).
  3. src/zimi_wasm.cpp (source/zimi_wasm.cpp, a new file): zimi_init() and
     zimi_command(line), the two functions the Worker calls.
  Nothing else differs. No NNUE network is shipped: the classical evaluation is
  used (Use NNUE is set to false), which is why the module is 1 MB. A net per
  variant would add several MB each. The largeboards build (needed for xiangqi,
  shogi and janggi) is compiled, without ALLVARS (no duck, amazons and the like).

How to re-vendor
  1. Clone the repository, check out the new commit, apply
     source/zimi-inline-search.patch (fix a conflict by hand; the places are
     small), copy source/zimi_wasm.cpp into src/.
  2. Run source/build.sh from the repository root (needs emsdk).
  3. Copy fairy.js and fairy.wasm here, update the commit, date and sizes above,
     and replace LICENCE and AUTHORS from the new tree if they changed.
  4. Run node tests/test_games_fairy.cjs: it runs the module in node and
     compares its legal moves with ours for all six variants.

How it is served
  fairy-worker.js fetches fairy.wasm as an ArrayBuffer and instantiates the
  bytes itself (the module's own loader would refuse a wrong Content-Type), so
  the type the .wasm is sent with does not matter (Kiwix may send
  application/octet-stream). Nothing is fetched from the network.
