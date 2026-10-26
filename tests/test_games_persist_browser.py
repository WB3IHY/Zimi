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
    ("fiveletters", '.fl-key[data-k="q"]', "JSON.stringify(__five.game)"),
    ("letterbyletter", '.lb-key[data-k="q"]', "JSON.stringify(__letters.game)"),
    ("quizzical", ".qz-choice", "JSON.stringify(__quiz.round) + document.getElementById('qz-score').textContent + document.querySelectorAll('.qz-choice.right').length"),
    ("jigsaw", "#jg-peek", "JSON.stringify(__jig.puzzle.pieces.map(p => [p.fx, p.fy, p.locked]))"),
    ("wikirace", ".rc-card .gm-play", "JSON.stringify(__race.race.steps) + __race.race.pair.start.path + __race.race.pair.end.path"),
    ("whereintheworld", "#wm-svg", "JSON.stringify(__world.round) + JSON.stringify(__world.pending)"),
    ("bricks", "#br-board", "__bricks.pos"),
    ("pinball", "#pb-board", "__pinball.pos"),
    ("rocks", "#rk-board", "__rocks.pos"),
    ("lastline", "#ll-board", "__lastline.pos"),
    ("hopper", "#hp-screen", "JSON.stringify([__hopper.st.index, __hopper.st.hearts, __hopper.st.coins, __hopper.st.checkpoint])"),
    ("muncher", "#mn-screen", "JSON.stringify([__muncher.st.level, __muncher.st.score, __muncher.st.lives, __muncher.st.dotsEaten])"),
    ("crossing", "#cr-screen", "JSON.stringify([__crossing.st.level, __crossing.st.score, __crossing.st.lives, __crossing.st.nests])"),
    ("blast", ".ar-sheet-actions .gs-primary", "JSON.stringify([__blast.st.round, __blast.st.wins, __blast.st.kinds])"),
    ("quest", "#qs-screen", "JSON.stringify([__quest.st.screen, __quest.st.hp, __quest.st.keys, __quest.st.sword])"),
    ("stacker", "#st-board", "JSON.stringify([__stacker.g.board, __stacker.g.score, __stacker.g.lines])"),
    ("kart", ".ar-sheet-actions .gs-primary", "JSON.stringify([__kart.g.race.karts.length, __kart.g.race.laps, __kart.g.T.def.id])"),
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
        # a list taps its selectors in turn (a piece, then its square); each one is the first match
        for sel in ([move] if isinstance(move, str) else move):
            tap(page, page.locator(sel).first if not isinstance(move, str) else page.locator(sel).last)
            page.wait_for_timeout(300)
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


@pytest.mark.parametrize("page_name", ["checkers", "solitaire", "chess"])
def test_history_and_about_read_as_words_in_the_menu(served, browser, page_name):
    """About opens in the Menu (the game stays where it is) and no fact reads as raw data."""
    ctx = browser.new_context(viewport=VIEW)
    page = ctx.new_page()
    url = "%s/%s.html" % (served, page_name)
    page.goto(url)
    page.wait_for_timeout(SETTLE_MS)
    page.locator(".ar-bar button", has_text="Menu").first.click()
    for row, fact in (("History", "Origin"), ("About", "Players")):
        page.locator(".gs-item", has_text=row).first.click()
        page.wait_for_function("() => document.querySelector('.gs-meta dt')", timeout=5000)
        text = page.evaluate("document.querySelector('.ar-sheet').innerText")
        assert "[object" not in text and "undefined" not in text and "null" not in text
        assert fact in text
        assert page.url == url, "reading it never leaves the game"
        page.locator(".gs-back").first.click()
    ctx.close()
