"""Behaviour fixed after CodeRabbit's review of the arcade games (1.15.0): each test fails on the code before the fix.

Run: pytest tests/test_games_review_fixes.py -v
Set ZIMI_GAMES_DIR to run the same tests against another copy of the games folder (to prove them against older code).
"""

import functools
import http.server
import json
import os
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from games_wait import frames, game_ready, truthy  # noqa: E402

pytest.importorskip("playwright")
from playwright.sync_api import sync_playwright  # noqa: E402

GAMES = os.environ.get("ZIMI_GAMES_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "zimi", "builtin", "games")
VIEW = {"width": 390, "height": 844}


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


@pytest.fixture
def open_game(served, browser):
    ctxs = []

    def go(name, query=""):
        ctx = browser.new_context(viewport=VIEW)
        ctxs.append(ctx)
        page = ctx.new_page()
        page.errors = []
        page.on("pageerror", lambda e: page.errors.append(str(e)))
        page.url_of = "%s/%s.html%s" % (served, name, query)
        page.goto(page.url_of)
        return page

    yield go
    for c in ctxs:
        c.close()


def test_snake_draws_a_full_board_without_throwing(open_game):
    """With no food left (the board is full) draw() read a shadowed `fx` and threw, so the win never finished."""
    page = open_game("snake")
    game_ready(page, "__snake.g")
    page.keyboard.press("ArrowRight")
    page.wait_for_function(truthy("__snake.mode === 'playing'"))
    page.evaluate("__snake.g.food = null")
    frames(page, 5)
    assert not page.errors, page.errors


def test_2048_two_quick_moves_leave_the_board_matching_the_tiles(open_game):
    page = open_game("2048")
    game_ready(page, "__t2048.g")
    for key in ("ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"):
        page.evaluate("k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))", key)
    page.wait_for_timeout(400)   # past the slide: the pending tiles have arrived
    shown = page.evaluate("[...document.querySelectorAll('.tf-tile')].map(t => [Number(t.dataset.at), t.textContent]).sort((a, b) => a[0] - b[0])")
    cells = page.evaluate("__t2048.g.cells.map((c, i) => c && [i, String(c.v)]).filter(Boolean)")
    assert shown == cells


def test_a_replayed_sokoban_solution_is_not_the_players_best(open_game):
    page = open_game("sokoban")
    game_ready(page, "window.__sk")
    page.evaluate("document.getElementById('sk-solution').click()")
    page.wait_for_function(truthy("__sk.won()"), timeout=60000)
    frames(page, 3)
    kept = page.evaluate("localStorage.getItem('zimi.games.sokoban')")
    assert not (json.loads(kept).get("best") if kept else None), kept


def test_a_matched_memory_card_keeps_the_arrow_keys_working(open_game):
    page = open_game("memory")
    game_ready(page, "__memory.g")
    ids = page.evaluate("__memory.g.cards.map(c => c.id)")
    first = ids[0]
    other = ids.index(first, 1)
    cards = page.locator(".mm-card")
    cards.nth(0).click()
    cards.nth(other).click()
    frames(page, 3)
    page.keyboard.press("ArrowRight")
    assert page.evaluate("document.activeElement.classList.contains('mm-card')")


def test_changing_the_mode_in_the_menu_mid_race_does_not_change_the_race(open_game):
    page = open_game("kart")
    game_ready(page, "__kart.g")
    page.evaluate("document.querySelector('.ar-sheet-actions .gs-primary').click()")
    page.wait_for_function(truthy("__kart.g.race"))
    page.evaluate("__kart.prefs.mode = 'trial'")   # what the in-game Menu does when Mode is changed
    page.evaluate("__kart.g.race.over = true")
    page.wait_for_function(truthy("__kart.g.mode === 'result'"))
    page.wait_for_function(truthy("document.querySelector('.ar-sheet:not([hidden]) h2')"))
    assert "Race 1 of 3" in page.evaluate("document.querySelector('.ar-sheet:not([hidden]) h2').textContent")
    assert not page.errors, page.errors
    assert not page.evaluate("Object.keys(__kart.prefs.best || {}).length"), "no record from a race that was not a trial"


def test_roadrush_checkpoints_passed_stay_passed_after_a_reload(open_game):
    page = open_game("roadrush")
    game_ready(page, "__roadrush.game")
    page.evaluate("__roadrush.begin()")
    page.wait_for_function(truthy("__roadrush.mode === 'playing' || __roadrush.mode === 'countdown'"))
    page.evaluate("""(() => { const g = __roadrush.game, cp = g.road.checkpoints[0];
      cp.hit = true; g.player.pos = cp.index * __roadrush.E.SEG + 50; g.time = 40; })()""")
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    page.goto("about:blank")
    page.goto(page.url_of)
    game_ready(page, "__roadrush.game && __roadrush.mode === 'paused'")
    assert page.evaluate("__roadrush.game.road.checkpoints.map(c => c.hit)") == [True, False]


def test_pet_tabs_keep_the_focus_between_ticks(open_game):
    page = open_game("pet")
    game_ready(page, "__pet.pet")
    page.evaluate("document.querySelector('#pt-tabs button').focus()")
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    page.wait_for_timeout(2500)   # the clock ticks hud() every second
    assert page.evaluate("document.activeElement.parentElement && document.activeElement.parentElement.id") == "pt-tabs"


def test_minesweeper_ignores_keys_after_the_game_ends(open_game):
    page = open_game("minesweeper", "?debug")
    game_ready(page, "window.__msLose")
    page.evaluate("window.__ends = 0; const o = ZimiShell.endSheet; ZimiShell.endSheet = function () { window.__ends++; return o.apply(this, arguments); }; 0")
    page.evaluate("__msLose()")
    page.wait_for_function(truthy("__ms.game().status === 'lost'"))
    before = page.evaluate("document.getElementById('ms-time').textContent")
    page.wait_for_function(truthy("document.querySelector('.ar-sheet:not([hidden])')"))   # the end sheet
    page.get_by_role("button", name="Close").first.click()   # the board is left finished, with the keys live again
    page.wait_for_function(truthy("!document.querySelector('.ar-sheet:not([hidden])')"))
    for key in ("ArrowRight", "ArrowRight", "Space", "Enter", "c"):
        page.keyboard.press(key)
    page.wait_for_timeout(300)
    assert page.evaluate("document.getElementById('ms-time').textContent") == before
    assert page.evaluate("window.__ends") == 1, "the end sheet opens once"
    assert not page.errors, page.errors


def test_a_waiting_shogi_hand_keeps_its_counts(open_game):
    """The side not to move has its pieces disabled; their counts stay visible, and only an empty slot fades."""
    page = open_game("shogi")
    game_ready(page, "document.getElementById('sg-hand-top')")
    seen = page.evaluate("""(() => {
      const box = document.getElementById('sg-hand-top');
      const mk = (cls, n) => { const b = document.createElement('button'); b.className = 'sg-h' + cls; b.disabled = true; b.innerHTML = '<b>' + n + '</b>'; box.appendChild(b); return getComputedStyle(b.querySelector('b')).visibility; };
      return [mk('', 2), mk(' empty', 0)];
    })()""")
    assert seen == ["visible", "hidden"], seen


def test_go_problems_reply_does_not_outlive_a_restart(open_game):
    page = open_game("goproblems", "?debug")
    game_ready(page, "window.__gp")
    fresh = page.evaluate("""(() => {
      const gp = __gp, i = gp.problems.indexOf(gp.problem()), board = document.getElementById('gp-board');
      for (let p = 0; p < 400 && !gp.thinking(); p++) { try { gp.play(p); } catch (e) {} }
      if (!gp.thinking()) return null;
      gp.load(i);   // Restart while White is still to answer
      return [board.innerHTML, document.body.innerText];
    })()""")
    assert fresh, "no first move that White answers was found"
    page.wait_for_timeout(1200)   # past the reply delay
    assert page.evaluate("[document.getElementById('gp-board').innerHTML, document.body.innerText]") == fresh, "White answered on the restarted problem"
    assert page.evaluate("[__gp.thinking(), __gp.over()]") == [False, False]
    assert not page.errors, page.errors
