#!/bin/bash
# Rebuilds fairy.js and fairy.wasm. Needs an activated Emscripten SDK (emcc 6.0.13 was used).
# From a checkout of the upstream repository (see ../README.txt for the commit):
#   patch -p1 < <this folder>/zimi-inline-search.patch    (touches src/thread.cpp, src/tt.cpp, src/uci.cpp, src/uci.h)
#   cp <this folder>/zimi_wasm.cpp src/
#   bash <this folder>/build.sh                           (from the repo root; writes fairy.js and fairy.wasm there)
set -e
cd src
em++ -O3 -std=c++17 -DNDEBUG -DNNUE_EMBEDDING_OFF -DNO_THREADS -DZIMI_INLINE_SEARCH -DLARGEBOARDS -DPRECOMPUTED_MAGICS \
  -s ASSERTIONS=0 -s SAFE_HEAP=0 -s INITIAL_MEMORY=64MB -s ALLOW_MEMORY_GROWTH=1 -s STACK_SIZE=8MB -s MAXIMUM_MEMORY=512MB \
  -s MODULARIZE=1 -s EXPORT_NAME=FairyStockfish -s ENVIRONMENT=web,worker,node \
  -s EXPORTED_FUNCTIONS=_zimi_init,_zimi_command -s EXPORTED_RUNTIME_METHODS=ccall \
  benchmark.cpp bitbase.cpp bitboard.cpp endgame.cpp evaluate.cpp material.cpp misc.cpp movegen.cpp movepick.cpp pawns.cpp position.cpp psqt.cpp \
  search.cpp thread.cpp timeman.cpp tt.cpp uci.cpp ucioption.cpp tune.cpp syzygy/tbprobe.cpp nnue/evaluate_nnue.cpp nnue/features/half_ka_v2.cpp \
  partner.cpp parser.cpp piece.cpp variant.cpp xboard.cpp nnue/features/half_ka_v2_variants.cpp zimi_wasm.cpp \
  -o ../fairy.js
