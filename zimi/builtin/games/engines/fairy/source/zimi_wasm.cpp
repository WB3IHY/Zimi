// ZimiGames: Fairy-Stockfish as a single-threaded WebAssembly module with a plain C entry point.
// Built with -DZIMI_INLINE_SEARCH (see thread.cpp): no pthreads, no SharedArrayBuffer.
#include <emscripten.h>
#include <string>

#include "bitboard.h"
#include "endgame.h"
#include "position.h"
#include "psqt.h"
#include "search.h"
#include "syzygy/tbprobe.h"
#include "thread.h"
#include "tt.h"
#include "tune.h"
#include "uci.h"
#include "piece.h"
#include "variant.h"
#include "xboard.h"

using namespace Stockfish;

extern "C" {

EMSCRIPTEN_KEEPALIVE void zimi_init() {
  pieceMap.init();
  variants.init();
  UCI::init(Options);
  Tune::init();
  PSQT::init(variants.find(Options["UCI_Variant"])->second);
  Bitboards::init();
  Position::init();
  Bitbases::init();
  Endgames::init();
  Threads.set(1);
  Search::clear();
  Eval::NNUE::init();
  UCI::wasm_init();
}

// One UCI line in. Output (info, bestmove) goes to stdout, which the page's glue collects line by line.
EMSCRIPTEN_KEEPALIVE void zimi_command(const char* line) {
  UCI::wasm_command(std::string(line));
}

}
