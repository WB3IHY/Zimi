"""The board and tile games keep their position across leaving the page and coming back (ZimiShell.persist).

One row per game: the page, the taps that make a move (a list, in order, the first match of each selector),
and JS that returns the position as a string. The world-kit games answer ZimiGameSave(): the page's own state
plus the options in force. The shared fixtures and the tap helper are in test_games_persist_browser.py.

Run: pytest tests/test_games_persist_boards.py -v
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_games_persist_browser import SETTLE_MS, VIEW, browser, served, tap  # noqa: F401

SAVE = "ZimiGameSave()"
# moves that need the page's own hooks (?debug) or a wait for the person's turn
CC_MOVE = """(function () { var c = __cc, s = c.state();
  for (var i = 0; i < s.owner.length; i++) {
    if (s.owner[i] === 1) { var to = Object.keys(c.engine.movesFrom(s, i)).filter(function (k) { return +k !== i; }); if (to.length) { c.tap(i); c.tap(+to[0]); return 1; } }
  } })()"""
LUDO_MOVE = """(async function () {
  for (var k = 0; k < 80; k++) {
    if (__ld.state().turn === 0 && __ld.phase() === 'roll') __ld.roll();
    await new Promise(function (r) { setTimeout(r, 150); });
    if (__ld.state().turn === 0 && __ld.phase() === 'move' && __ld.legal().length) { __ld.choose(__ld.legal()[0]); return 1; }
  } })()"""
DOMINO_MOVE = """(async function () {
  for (var k = 0; k < 40; k++) {
    var card = document.querySelector('.dm-card.can');
    if (card) { card.click(); await new Promise(function (r) { setTimeout(r, 300); }); var g = document.querySelector('.dm-tile.ghost'); if (g) g.click(); return 1; }
    await new Promise(function (r) { setTimeout(r, 250); });
  } })()"""
ROWS = [
    ("fourinarow", [".fr-col:nth-child(4)"], SAVE),
    ("gomoku", [".wk-board button:nth-child(113)"], SAVE),
    ("hex", [".wk-board button:nth-child(60)"], SAVE),
    ("dotsandboxes", [".db-edge:nth-child(3)"], SAVE),
    ("morris", [".mo-pt:nth-child(5)"], SAVE),
    ("reversi", [".bg-sq.hint"], SAVE),
    ("checkers", [".bg-sq:has(.ck-pc.r.mv)", ".bg-sq.hint"], SAVE),
    ("mancala", [".mc-pit-btn[aria-disabled=false]"], SAVE),
    ("go", [".go-pt:nth-child(41)"], SAVE),
    ("ur", ["#ur-roll"], SAVE),
    ("carrom", ["#cr-shoot"], SAVE, 9000),
    ("draughts", (".bg-sq.can", ".bg-sq.hint"), SAVE),
    ("hnefatafl", (".hn-sq:has(.hn-pc)", ".hn-sq.hint"), SAVE),
    ("janggi", (".jg-pt:has(.jg-pc.cho)", ".jg-pt.hint"), SAVE),
    ("makruk", (".bg-sq:has(.mk-pc.w)", ".bg-sq.hint"), SAVE),
    ("backgammon", [], SAVE, 6000),
    ("chinesecheckers", ["js:" + CC_MOVE], SAVE, 2500, "?debug"),
    ("ludo", ["js:" + LUDO_MOVE], SAVE, 2500, "?debug"),
    ("dominoes", ["js:" + DOMINO_MOVE], SAVE, 6000),
    ("mahjong", [".mj-t:not(.blocked)"], "(function () { var d = JSON.parse(ZimiGameSave()); delete d.seconds; return JSON.stringify(d); })()"),   # the clock runs on
    ("fleet", ["#fl-tools .ar-btn:nth-child(2)"], SAVE),
    ("chesspuzzles", [], SAVE),
    ("chessopenings", [], SAVE),
    ("goproblems", ["js:__gp.play(__gp.problem().f[0])"], SAVE, 2000, "?debug"),
    ("mahjong4", [".m4-hand .m4-t", ".m4-hand .m4-t"], SAVE, 9000),
    ("chess", (".bg-sq:has(.cs-pc.w)", ".bg-sq.hint"), SAVE),
    ("xiangqi", (".xq-pt:has(.xq-pc.r)", ".xq-pt.hint"), SAVE),
    ("shogi", (".sg-sq:has(.sg-pc:not(.g))", ".sg-sq.hint"), SAVE),
]


@pytest.mark.parametrize("row", ROWS, ids=[r[0] for r in ROWS])
def test_leaving_and_returning_keeps_the_position(served, browser, row):
    page_name, moves, position = row[:3]
    settle = row[3] if len(row) > 3 and row[3] else SETTLE_MS * 2   # a longer wait where a shot or a roll plays out
    query = row[4] if len(row) > 4 else ""   # ?debug where the test needs the page's own hooks
    ctx = browser.new_context(viewport=VIEW)
    page = ctx.new_page()
    url = "%s/%s.html%s" % (served, page_name, query)
    page.goto(url)
    page.wait_for_timeout(SETTLE_MS)
    if isinstance(moves, tuple):
        # (own pieces, targets): tap pieces until one shows somewhere to go, then go
        pieces, target = moves
        for i in range(page.locator(pieces).count()):
            tap(page, page.locator(pieces).nth(i))
            page.wait_for_timeout(200)
            if page.locator(target).count():
                break
        tap(page, page.locator(target).first)
        page.wait_for_timeout(300)
    else:
        for sel in moves:
            if sel.startswith("js:"):
                page.evaluate(sel[3:])
            else:
                tap(page, page.locator(sel).first)
            page.wait_for_timeout(300)
    page.wait_for_timeout(settle)   # the computer's reply lands
    before = page.evaluate(position)
    assert before, "a move was made, so there is a position to keep"
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    page.goto("about:blank")
    page.goto(url)
    page.wait_for_timeout(SETTLE_MS)
    after = page.evaluate(position)
    assert after == before, "the position came back different after leaving and returning"
    ctx.close()
