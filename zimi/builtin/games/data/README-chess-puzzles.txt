Chess Puzzles data (chess-puzzles.js)
=====================================

Source and licence
  Lichess puzzle database, https://database.lichess.org/#puzzles
  Licence: CC0 1.0 (public domain dedication), stated on that page. Credit is
  given anyway: ZimiGames' About text for Chess Puzzles thanks Lichess.
  Downloaded: 2026-10-24, lichess_db_puzzle.csv.zst (6,157,341 puzzles).

What was derived
  15,580 puzzles in one JavaScript file (1.26 MB). One row per puzzle:
      FEN (first four fields)|UCI moves|rating|theme letters
  The first move is the opponent's, the one that sets the puzzle; the rest
  alternate solver, opponent. Rows are sorted by rating. Theme letters are
  indexes into the "themes" list at the top of the file (a = first theme).

How it was derived (the script is not shipped; the steps are exact)
  1. Download into a new empty scratch folder and decompress with zstd.
  2. Keep puzzles with rating 600 to 2699, rating deviation at most 90,
     popularity at least 95, at least 1,000 plays, and 2 to 10 plies.
  3. Keep a puzzle only if it carries one of 25 themes we ship (mateIn1,
     mateIn2, mateIn3, fork, pin, skewer, discoveredAttack, endgame,
     backRankMate, hangingPiece, sacrifice, deflection, attraction,
     trappedPiece, promotion, defensiveMove, quietMove, smotheredMate,
     doubleCheck, xRayAttack, zugzwang, exposedKing, clearance,
     interference, capturingDefender).
  4. For each theme, rarest first, take a quota (120 for smothered mate up
     to 1,350 for fork) round-robin across 100-point rating bins, most
     popular first, skipping puzzles already chosen. This spreads every
     theme over the ratings it has.
  5. Drop the move counters from each FEN, sort by rating, write the file.

Checked by tests/test_games_content.cjs: every solution is legal from its
FEN with chess-engine.js, has an even number of plies, and a mate-in-N puzzle
ends in checkmate.
