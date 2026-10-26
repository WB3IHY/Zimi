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
ROWS = [
    ("fourinarow", [".fr-col:nth-child(4)"], SAVE),
    ("gomoku", [".wk-board button:nth-child(113)"], SAVE),
    ("hex", [".wk-board button:nth-child(60)"], SAVE),
    ("dotsandboxes", [".db-edge:nth-child(3)"], SAVE),
    ("morris", [".mo-pt:nth-child(5)"], SAVE),
]


@pytest.mark.parametrize("page_name,moves,position", ROWS, ids=[r[0] for r in ROWS])
def test_leaving_and_returning_keeps_the_position(served, browser, page_name, moves, position):
    ctx = browser.new_context(viewport=VIEW)
    page = ctx.new_page()
    url = "%s/%s.html" % (served, page_name)
    page.goto(url)
    page.wait_for_timeout(SETTLE_MS)
    for sel in moves:
        tap(page, page.locator(sel).first)
        page.wait_for_timeout(300)
    page.wait_for_timeout(SETTLE_MS * 2)   # a computer reply lands
    before = page.evaluate(position)
    assert before, "a move was made, so there is a position to keep"
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    page.goto("about:blank")
    page.goto(url)
    page.wait_for_timeout(SETTLE_MS)
    after = page.evaluate(position)
    assert after == before, "the position came back different after leaving and returning"
    ctx.close()
