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


def _paused(expr):
    """An arcade game runs between the two reads: pause it first (it restores paused, and a paused one is left alone)."""
    return ("(() => { const b = document.querySelector('.ar-bar [id$=\"pause\"]'); if (b && /^pause/i.test(b.textContent)) b.click(); "
            "return JSON.stringify(" + expr + "); })()")


# page, a selector to tap for a move (None: the computer plays), JS that returns the position as a string. Add a row for each game wired in.
ROWS = [
    ("solitaire", '[data-pile="stock"]', "JSON.stringify(ZimiSolitaire.session.state)"),
    ("golf", '[data-pile="stock"]', "JSON.stringify(ZimiGolf.session.state)"),
    ("euchre", None, "JSON.stringify(ZimiEuchre.session.state)"),
    # A full guess, then two letters of the next: the rows, the typed letters and the flags must all come back.
    ("fiveletters", ['.fl-key[data-k="%s"]' % k for k in "crane"] + ['.fl-key[data-k="Enter"]', '.fl-key[data-k="s"]', '.fl-key[data-k="o"]'], "JSON.stringify(__five.game) + [...document.querySelectorAll('.fl-tile')].map(t => t.getAttribute('aria-label') + t.textContent).join()"),
    ("letterbyletter", ['.lb-key[data-k="e"]', '.lb-key[data-k="q"]', '.lb-key[data-k="a"]'], "JSON.stringify(__letters.game) + document.getElementById('lb-word').textContent + [...document.querySelectorAll('.lb-key')].map(k => k.className).join()"),
    # Two answers' worth of state: the question set, where we are, the score, and which choice was picked and shown right or wrong.
    ("quizzical", [".qz-choice", "#qz-next", ".qz-choice"], "JSON.stringify(__quiz.round) + document.getElementById('qz-n').textContent + document.getElementById('qz-score').textContent + [...document.querySelectorAll('.qz-choice')].map(b => b.className + b.disabled).join()"),
    # Pieces where they were left (the scatter is random, so a restore that re-deals fails), with the clock's text.
    ("jigsaw", "#jg-peek", "JSON.stringify(__jig.puzzle.pieces.map(p => [p.fx, p.fy, p.locked])) + __jig.puzzle.pieces.map(p => p.node.style.left + p.node.style.top).join() + __jig.puzzle.pic.url.length"),
    # Start, then follow a link: the path, both ends and the click count.
    ("wikirace", [".rc-card .gm-play", ".rc-link"], "JSON.stringify(__race.race.steps) + __race.race.pair.start.path + __race.race.pair.end.path + document.getElementById('rc-clicks').textContent + document.getElementById('rc-pane').textContent.length"),
    # A pin, then the guess: the places, the pin, the points and the answered reveal.
    ("whereintheworld", ["#wm-svg", "#wm-guess"], "JSON.stringify(__world.round) + JSON.stringify(__world.pending) + document.getElementById('wm-score').textContent + document.getElementById('wm-msg').textContent + document.getElementById('wm-n').textContent"),
    ("snake", "#sn-board", _paused("__snake.pos")),
    ("bricks", "#br-board", "__bricks.pos"),
    ("pinball", "#pb-board", "__pinball.pos"),
    ("rocks", "#rk-board", "__rocks.pos"),
    ("lastline", "#ll-board", "__lastline.pos"),
    ("lander", "#ld2-board", "__lander.pos"),
    ("paddles", ".ar-sheet .gs-primary", "__paddles.pos"),
    ("circuit", ".ar-sheet .gs-primary", "__circuit.pos"),
    ("roadrush", "#rr-board", "__roadrush.pos"),
    ("hopper", "#hp-screen", _paused("[__hopper.st.index, __hopper.st.x, __hopper.st.y, __hopper.st.camX, __hopper.st.time, __hopper.st.hearts, __hopper.st.coins, __hopper.st.enemies.map(e => [e.x, e.y, e.alive])]")),
    ("muncher", "#mn-screen", _paused("[__muncher.st.level, __muncher.st.player, __muncher.st.chasers.map(c => [c.x, c.y]), __muncher.st.dots, __muncher.st.score, __muncher.st.lives, __muncher.st.time]")),
    ("crossing", "#cr-screen", _paused("[__crossing.st.level, __crossing.st.x, __crossing.st.row, __crossing.st.time, __crossing.st.left, __crossing.st.nests, __crossing.st.score]")),
    ("blast", ".ar-sheet-actions .gs-primary", _paused("[__blast.st.round, __blast.st.wins, __blast.st.grid, __blast.st.players.map(p => [p.x, p.y, p.alive]), __blast.st.bombs, __blast.st.time]")),
    ("quest", "#qs-screen", _paused("[__quest.st.screen, __quest.st.x, __quest.st.y, __quest.st.hp, __quest.st.keys, __quest.st.enemies.map(e => [e.x, e.y])]")),
    ("stacker", "#st-board", _paused("[__stacker.g.board, __stacker.g.cur, __stacker.g.queue, __stacker.g.hold, __stacker.g.score, __stacker.g.lines]")),
    ("kart", ".ar-sheet-actions .gs-primary", _paused("[__kart.g.T.def.id, __kart.g.race.t, __kart.g.race.karts.map(k => [k.x, k.y, k.a, k.total])]")),
    ("memory", ".mm-card", "JSON.stringify(__memory.g.cards) + __memory.g.first + ':' + __memory.g.moves + ':' + __memory.g.found"),
    ("echo", ".ec-board", "JSON.stringify(__echo.g.seq)"),
    ("noughts", ".nc-cell", "JSON.stringify(__noughts.board) + __noughts.turn"),
    ("snakesandladders", "#sl-roll", "__slState()"),
    ("2048", ["key:ArrowLeft", "key:ArrowUp", "key:ArrowRight"], "JSON.stringify(__t2048.g.cells.map(c => c && c.v)) + __t2048.g.score"),
    ("sudoku", [".su-c:not(.given) >> nth=0", "key:n", "key:3", "key:n", ".su-c:not(.given) >> nth=1", "key:5"], "JSON.stringify([__sudoku.s.puzzle, __sudoku.s.solution, __sudoku.s.grid, __sudoku.s.notes])"),
    ("minesweeper", [".ms-c >> nth=40", "key:ArrowRight", "key:ArrowRight", "key:f"], "JSON.stringify([Array.from(__ms.game().state), Array.from(__ms.game().mine), __ms.game().flags, __ms.game().opened])"),
    ("sokoban", ["key:ArrowRight", "key:ArrowDown", "key:ArrowLeft", "key:ArrowUp"], "JSON.stringify(__sk.state())"),
    ("codebreaker", ["#cb-palette .pl-peg", "#cb-palette .pl-peg", "#cb-palette .pl-peg", "#cb-palette .pl-peg", "#cb-check", "#cb-palette .pl-peg"], "JSON.stringify([__codebreaker.code, __codebreaker.cur, __codebreaker.rows])"),
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
            if sel.startswith("key:"):
                page.keyboard.press(sel[4:])
            else:
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
    # Leaving pauses a running arcade game, so its position stops moving before it is read.
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    page.wait_for_timeout(200)
    before = page.evaluate(position)
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


def test_a_grand_prix_between_races_comes_back_to_the_standings(served, browser):
    ctx = browser.new_context(viewport=VIEW)
    page = ctx.new_page()
    url = served + "/kart.html"
    page.goto(url)
    page.wait_for_timeout(SETTLE_MS)
    page.evaluate("document.querySelector('.ar-sheet-actions .gs-primary').click()")
    page.wait_for_timeout(SETTLE_MS)
    page.evaluate("__kart.g.race.over = true")
    page.wait_for_timeout(SETTLE_MS)
    before = page.evaluate("JSON.stringify(__kart.g.gp)")
    assert page.evaluate("__kart.g.mode") == "result"
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    page.goto("about:blank")
    page.goto(url)
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate("JSON.stringify(__kart.g.gp)") == before
    assert "Race 1 of 3" in page.evaluate("document.querySelector('.ar-sheet:not([hidden]) h2').textContent")
    ctx.close()


def test_circuit_phone_heats_survive_leaving(served, browser):
    """Two players share a phone, each racing in turn: leaving after the first heat keeps whose turn it is and the first result."""
    ctx = browser.new_context(viewport=VIEW, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    url = served + "/circuit.html"
    page.goto(url)
    page.evaluate("localStorage.setItem('zimi.games.circuit', JSON.stringify({players: 2, laps: 2, ai: 3}))")
    page.goto(url)
    page.wait_for_timeout(SETTLE_MS)
    page.click(".ar-sheet .gs-primary")
    page.wait_for_timeout(SETTLE_MS)
    page.evaluate("(() => { const r = __circuit.g.race; r.cars.forEach((c, i) => { c.finished = true; c.finishTime = 60 + i; }); r.events.push({type: 'done'}); })()")
    page.wait_for_timeout(SETTLE_MS)
    assert "Player 1" in page.evaluate("document.querySelector('.ar-sheet h2').textContent")
    before = page.evaluate("JSON.stringify(__circuit.g.heats)")
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    page.goto("about:blank")
    page.goto(url)
    page.wait_for_timeout(SETTLE_MS)
    assert "Player 1" in page.evaluate("document.querySelector('.ar-sheet h2').textContent"), "the pass-the-phone sheet came back"
    assert page.evaluate("JSON.stringify(__circuit.g.heats)") == before
    page.click(".ar-sheet .gs-primary")
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate("__circuit.g.heat") == 1, "player 2 is up"
    ctx.close()
