"""A game left mid-move comes back as it was: the position survives leaving the page and coming back.

ZimiGames keep every game they can (ZimiShell.persist): a move, then the page is hidden or closed, then
the game is opened again, and the same position is on the table. Each family has a row here; the lanes
add one for every game they wire. A row is (page, how to make a move, how to read the position).

Run: pytest tests/test_games_persist_browser.py -v
"""

import functools
import http.server
import os
import threading

import pytest

pytest.importorskip("playwright")
from playwright.sync_api import sync_playwright  # noqa: E402

GAMES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "zimi", "builtin", "games")
VIEW = {"width": 390, "height": 844}
SETTLE_MS = 1000

# page, a selector to tap for a move (None: the computer plays), JS that returns the position as a string. Add a row for each game wired in.
ROWS = [
    ("solitaire", '[data-pile="stock"]', "JSON.stringify(ZimiSolitaire.session.state)"),
    ("golf", '[data-pile="stock"]', "JSON.stringify(ZimiGolf.session.state)"),
    ("euchre", None, "JSON.stringify(ZimiEuchre.session.state)"),
]


@pytest.fixture(scope="module")
def served():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=GAMES)
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield "http://127.0.0.1:%d" % srv.server_address[1]
    srv.shutdown()


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        for kind in (p.chromium, p.webkit):
            try:
                b = kind.launch()
            except Exception:
                continue
            yield b
            b.close()
            return
        pytest.skip("no browser installed")


def tap(page, locator):
    """A tap at the middle of the element, as a finger would (the cards and slots are not buttons to the DOM)."""
    box = locator.bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


@pytest.mark.parametrize("page_name,move,position", ROWS, ids=[r[0] for r in ROWS])
def test_leaving_and_returning_keeps_the_position(served, browser, page_name, move, position):
    ctx = browser.new_context(viewport=VIEW)
    page = ctx.new_page()
    url = "%s/%s.html" % (served, page_name)
    page.goto(url)
    page.wait_for_timeout(SETTLE_MS)
    if move:
        tap(page, page.locator(move).last)
        page.wait_for_timeout(SETTLE_MS)
    else:
        # A game with the computer in it: answer whatever it asks until the table has changed once.
        for _ in range(40):
            if page.evaluate("ZimiEuchre.session.history.length") > 0:
                break
            choice = page.locator(".ct-choice:not([disabled])")
            if choice.count():
                tap(page, choice.first)
            page.wait_for_timeout(400)
    page.wait_for_timeout(SETTLE_MS)
    before = page.evaluate(position)
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    page.goto("about:blank")
    page.goto(url)
    page.wait_for_timeout(SETTLE_MS)
    after = page.evaluate(position)
    assert before and after
    assert after == before, "the position came back different after leaving and returning"
    ctx.close()


def test_a_new_game_is_the_one_way_to_lose_one(served, browser):
    ctx = browser.new_context(viewport=VIEW)
    page = ctx.new_page()
    url = served + "/solitaire.html"
    page.goto(url)
    page.wait_for_timeout(SETTLE_MS)
    tap(page, page.locator('[data-pile="stock"]').last)
    page.wait_for_timeout(SETTLE_MS)
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    kept = page.evaluate("ZimiShell.saved()")
    assert kept, "a game with a move in it is kept"
    page.evaluate("document.getElementById('zc-new').click()")
    page.wait_for_timeout(SETTLE_MS)
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    assert page.evaluate("ZimiShell.saved()") is None, "a fresh deal with no move made is not kept"
    ctx.close()
