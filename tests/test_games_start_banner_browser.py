"""The "This game failed to start" banner is for a game that drew nothing, never for a working table.

Eric saw it over a Truco hand he was playing: a stray error while the page started (a ResizeObserver note, a late
listener) raised the alarm over a game that had started fine. The banner now waits out the start and appears only
when the page has nothing of the game on screen; a script that would not load still raises it at once.

Run: pytest tests/test_games_start_banner_browser.py -v
"""

import functools
import http.server
import os
import threading

import pytest

GAMES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "zimi",
    "builtin",
    "games",
)
GRACE_WAIT_MS = (
    6000  # the shell's start grace (2.5 s) after load, then its own grace, with room
)

THROWS_BUT_PLAYS = "setTimeout(function () { throw new Error('a late corner'); }, 300);"
BLANK = (
    '<!doctype html><html><head><meta charset="utf-8"><title>Blank</title><script src="shell.js"></script></head>'
    "<body><script>throw new Error('the game never started');</script></body></html>"
)


@pytest.fixture(scope="module")
def site():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=GAMES)
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield "http://127.0.0.1:%d/" % srv.server_address[1]
    srv.shutdown()


@pytest.fixture(scope="module")
def browser():
    sync_api = pytest.importorskip("playwright.sync_api")
    with sync_api.sync_playwright() as p:
        b = p.webkit.launch()
        yield b
        b.close()


def _banner(page):
    return page.locator('[role="alert"]', has_text="failed to start").count()


def test_an_error_in_a_game_that_started_raises_no_banner(site, browser):
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.add_init_script(THROWS_BUT_PLAYS)
    page.goto(site + "truco.html")
    page.wait_for_timeout(GRACE_WAIT_MS)
    assert _banner(page) == 0
    page.close()


def test_a_game_that_drew_nothing_says_so(site, browser):
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.route(
        "**/blank-game.html",
        lambda r: r.fulfill(status=200, content_type="text/html", body=BLANK),
    )
    page.goto(site + "blank-game.html")
    page.wait_for_timeout(GRACE_WAIT_MS)
    assert _banner(page) == 1
    page.close()
