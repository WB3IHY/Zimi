Chess opening names (chess-openings.js)
=======================================

Source and licence
  lichess-org/chess-openings, https://github.com/lichess-org/chess-openings
  (a.tsv to e.tsv, one per ECO volume). Licence: CC0 1.0. The repository's
  README says: "As a collection of facts, this data set is in the public
  domain. ... the work is released under the CC0 Public Domain Dedication."
  The repository carries no separate LICENSE file; the README is the notice.
  Downloaded: 2026-10-24 from the master branch.

What was derived
  3,865 named lines in one JavaScript file (386 KB). One row per line:
      ECO|name|UCI moves from the start position
  Each line's PGN was replayed with ZimiGames' own engine (chess-engine.js)
  to write UCI; all 3,865 lines parsed, none dropped.

How it is used
  Chess names the opening in its move list: the page loads this file after a
  game's first move, replays every line once to key it by position, and walks
  back from the current move to the nearest named position (so transpositions
  find the same name). The Opening Trainer lists the lines by family (the name
  before the first colon) and plays one against the board.
