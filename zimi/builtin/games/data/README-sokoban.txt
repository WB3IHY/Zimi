Sokoban levels (sokoban-levels.js)
==================================

Source and licence
  DeepMind Boxoban levels, https://github.com/google-deepmind/boxoban-levels
  Licence: Apache License 2.0 (the repository's LICENSE file). Credit:
  Guez, Mirza, Gregor, Kabra, Racaniere, Weber, Raposo, Santoro, Orseau,
  Eccles, Wayne, Silver, Lillicrap, Valdes, "An investigation of model-free
  planning: boxoban levels", 2018. Not an official Google product.
  Downloaded: 2026-10-24: unfiltered/train/000.txt, medium/train/000.txt,
  hard/000.txt (1,000 levels each; the first 250 of each were used).
  This is a derived work (levels re-graded, re-encoded, with solutions added);
  the Apache-2.0 text applies to the levels, and this note states the change.

Microban
  Not used. David Skinner's Microban is described on the Sokoban levels pages
  we could read (sneezingtiger.com) as a level set "released" by its author,
  but those pages state no licence or redistribution terms and the author's own
  site is gone, so nothing there clearly allows redistribution with credit.

What was derived
  300 levels (100 per grade) in one JavaScript file (65 KB). Each row of the
  file: id, grade, the ten rows of the level joined by "/" (# wall, - floor,
  . goal, $ box, * box on a goal, @ player), a solution, and its push count.

How it was derived
  1. Download into a new empty scratch folder; the files are untrusted data.
  2. Solve every level in the 750 taken (250 per source) with a push-level
     breadth-first search (a state is the box positions and the player's
     reachable region), which finds a solution with the fewest pushes. All 750
     were solved. The solution is written as moves: lower case walks, upper
     case pushes.
  3. Grade by pushes of the shortest solution: Easy up to 13, Medium 14 to 17,
     Hard 18 and up (thirds of the 750). Take 100 evenly spaced across each
     grade, by pushes. The sources' own labels (easy-ish, medium, hard) turned
     out not to match difficulty for a person, so they are not used.

Checked by tests/test_games_content.cjs: every level parses (one player, four
boxes and four goals), and playing its stored solution with sokoban-engine.js
ends with every box on a goal.
