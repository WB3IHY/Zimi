Go Problems data (go-problems.js)
=================================

What is in it
  Life-and-death problems (tsumego), each proved by our own solver
  (tsumego-solver.js). Black plays first. Either kill the marked white group
  (capture it, or reduce it to a shape that cannot make two eyes) or make the
  marked black group live (two real eyes, or a living eye shape).
  Each problem: id, collection, goal, the diagram (x black, o white) at the
  top-left of a 19x19 board, the target stones, every first move for Black the
  solver proved wins, and one line of play (White choosing its most stubborn
  replies). The page uses the same solver to judge your moves, so any winning
  move counts, not only the one in the list.

Collections
  Eye shapes (generated, ours): every walled-in eye space of 3 to 6 points
    (the free polyominoes), put in the top-left corner and along the top edge,
    with the walling group inside and attackers outside; Black to kill the
    white group, or (colours swapped) to make the black group live. Built by a
    script that is not shipped; each result was kept only if the solver proves
    it AND the other side to move first stops it (so it is not trivial).
  Classical collections (Gokyo Shumyo, Xuanxuan Qijing, Igo Hatsuyoron): not
    shipped. The only transcription we found (github.com/tasuki/tsumego) states
    no licence, so none of its positions are used.
  Not used: Cho Chikun's and Lee Chang-ho's books (modern, permission needed),
  GoGameGuru's problems (CC BY-NC-SA).

How the solver judges
  The search is alpha-beta with a transposition table over a small zone (the
  eye space, or a few points around the target). Go rules (captures, suicide,
  simple ko) are go-engine.js's own. A kill is proved by capture, or when the
  group's liberties lie in at most two enclosed empty points walled by chains
  with room to breathe. A group lives when it holds two real eyes (neighbours
  all its own, not a false eye by the diagonals) or a straight line or T of four
  or more enclosed points. Moves outside the zone count as passing, which is how
  tsumego are read. The solver can be wrong only in the direction of
  missing a solution (a shape it does not recognise is searched on), not of
  claiming one; the "alive" rule is the textbook one and is not a full
  proof of life.

Checked by tests/test_games_content.cjs: every problem's line is legal from its
position and ends with the goal reached; the first move is in the list; a third
of them are searched again from scratch; and a sample of points outside the
answer list is searched to show they do not win.
