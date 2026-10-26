"""The six library games added to ZimiGames (Timeline, Higher or Lower, Flags, First Lines, Spelling Bee, Mini Crossword), run
in a browser three ways: inside Zimi (a real server over tests/games_library_fixture.py's second library), inside a
kiwix-serve stand-in (tests/kiwix_stub.py over the same ZIMs) and with no server at all (their built-in sets). Each way:
the game draws on the right source, and a round left and returned to (page hidden, page reloaded, with the library there
and with it gone) is the same position.

Run: ZIMI_TORRENT=0 ZIMI_OFFLINE=1 pytest tests/test_games_library_more.py -v
"""

import functools
import http.server
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.request

import pytest

pytest.importorskip("playwright")
from playwright.sync_api import sync_playwright  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)
GAMES = os.path.join(ROOT, "zimi", "builtin", "games")
VIEW = {"width": 390, "height": 844}
SETTLE_MS = 600
MODES = ["builtin", "zimi", "kiwix"]
ZIMI_API = re.compile(r"^/(health|list|random|w/|dictionary/|wiki/|search|snippet)")
KIWIX_API = re.compile(r".*/(catalog|random|suggest|content/(?!games/))")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    import games_library_fixture as fx
    import kiwix_stub

    base = tmp_path_factory.mktemp("lib2")
    first = fx.build(str(base))   # the first six games' library (zims/) and, beside it, this file's (zims2/)
    zdir = os.path.join(str(base), "zims2")
    (base / "data").mkdir()
    port = free_port()
    env = dict(
        os.environ,
        ZIMI_TORRENT="0",
        ZIMI_OFFLINE="1",
        ZIM_DIR=zdir,
        ZIMI_DATA_DIR=str(base / "data"),
    )
    proc = subprocess.Popen(
        [sys.executable, "-m", "zimi", "serve", "--port", str(port)],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    kiwix, kiwix_url = kiwix_stub.serve(zdir, GAMES)
    kiwix_first, kiwix_first_url = kiwix_stub.serve(first, GAMES)
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(
                    "http://127.0.0.1:%d/health" % port, timeout=1
                ).read()
                break
            except Exception:
                time.sleep(0.5)
        else:
            pytest.skip("the fixture library did not start")
        api = "http://127.0.0.1:%d" % port

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *a, **k):
                pass

            def _proxy(self, method):
                try:
                    req = urllib.request.Request(api + self.path, method=method)
                    r = urllib.request.urlopen(req, timeout=15)
                    body = r.read() if method == "GET" else b""
                    self.send_response(200)
                    self.send_header(
                        "Content-Type",
                        r.headers.get("Content-Type", "application/octet-stream"),
                    )
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except urllib.error.HTTPError as e:
                    self.send_error(e.code)
                except Exception:
                    self.send_error(502)

            def do_GET(self):
                if ZIMI_API.match(self.path):
                    return self._proxy("GET")
                super().do_GET()

            def do_HEAD(self):
                if ZIMI_API.match(self.path):
                    return self._proxy("HEAD")
                super().do_HEAD()

        class Plain(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *a, **k):
                pass

        servers = []
        for h in (Handler, Plain):
            srv = http.server.ThreadingHTTPServer(
                ("127.0.0.1", 0), functools.partial(h, directory=GAMES)
            )
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            servers.append(srv)
        yield {
            "zimi": "http://127.0.0.1:%d/" % servers[0].server_address[1],
            "builtin": "http://127.0.0.1:%d/" % servers[1].server_address[1],
            "kiwix": kiwix_url + "/content/games/",
            "kiwix_first": kiwix_first_url + "/content/games/",
        }
        for srv in servers:
            srv.shutdown()
    finally:
        kiwix.shutdown()
        kiwix_first.shutdown()
        proc.terminate()


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
    box = locator.bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(250)


def open_game(browser, world, mode, name, ready, init=None):
    ctx = browser.new_context(viewport=VIEW)
    if init:
        ctx.add_init_script(init)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(world[mode] + name)
    page.wait_for_function(ready, timeout=30000)
    page.wait_for_timeout(SETTLE_MS)
    return ctx, page, errors


def leave_and_return(ctx, page, world, mode, name, gone):
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    page.goto("about:blank")
    if gone:
        pattern = ZIMI_API if mode == "zimi" else KIWIX_API
        ctx.route(
            re.compile(r".*"),
            lambda route: (
                route.abort()
                if pattern.match(re.sub(r"^https?://[^/]+", "", route.request.url))
                or (mode == "kiwix" and KIWIX_API.match(route.request.url))
                else route.continue_()
            ),
        )
    page.goto(world[mode] + name)
    page.wait_for_timeout(2500)


# ── the three rounds of choices ──────────────────────────────────────────────

ROUND_POSITION = (
    "JSON.stringify(__round.round) + __round.at + ':' + __round.score + document.getElementById('rk-n').textContent"
    " + document.getElementById('rk-score').textContent + [...document.querySelectorAll('.rk-choice')].map(b => b.className + b.disabled).join()"
)


def fixture():
    import games_library_fixture as fx

    return fx


@pytest.mark.parametrize("gone", [False, True], ids=["library there", "library gone"])
@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("name", ["firstlines.html", "flags.html", "higherlower.html"])
def test_a_round_of_choices_uses_its_source_and_comes_back_as_it_was(
    browser, world, name, mode, gone
):
    fx = fixture()
    ctx, page, errors = open_game(
        browser, world, mode, name, "window.__round && __round.round.length > 0"
    )
    rnd = page.evaluate("__round.round")
    zim = page.evaluate("__round.zim")
    assert len(rnd) >= 4 and all(
        len(q["choices"]) >= 2 and q["answer"] in q["choices"] for q in rnd
    )
    if mode == "builtin":
        assert zim == "", "no server: the built-in set"
    else:
        assert zim, "the library was not used in " + mode
        if name == "firstlines.html":
            titles = [t.split(";")[0].split(":")[0] for t, _, _, _ in fx.BOOKS]
            assert all(
                q["answer"] in titles for q in rnd
            ), "answers are not from the Gutenberg fixture"
            assert all(q["quote"] and "_____" not in q["answer"] for q in rnd)
        if name == "flags.html":
            assert {q["answer"] for q in rnd} <= {n for n, _ in fx.FLAGS}
            assert all("Flag_of_" in q["picture"] for q in rnd)
        if name == "higherlower.html":
            table = {
                "population": {n: p for n, p, a in fx.COUNTRIES},
                "area": {n: a for n, p, a in fx.COUNTRIES},
                "height": dict(fx.MOUNTAINS),
                "length": dict(fx.RIVERS),
            }
            for q in rnd:
                for n, v in q["facts"]:
                    assert (
                        table[q["kind"]][n] == v
                    ), "a figure that is not in the fixture's list: %s %s" % (n, v)
    # answer, go on, answer again
    tap(page, page.locator(".rk-choice").first)
    assert page.locator("#rk-next").is_visible()
    tap(page, page.locator("#rk-next"))
    tap(page, page.locator(".rk-choice").first)
    page.wait_for_timeout(SETTLE_MS)
    before = page.evaluate(ROUND_POSITION)
    leave_and_return(ctx, page, world, mode, name, gone)
    after = page.evaluate(ROUND_POSITION)
    assert before == after, "the round came back different after leaving and returning"
    assert not errors, errors
    ctx.close()


def test_the_built_in_note_says_what_it_is(browser, world):
    """Menu > About says plainly where the content comes from (the about hook of ZimiShell.game)."""
    ctx, page, _ = open_game(
        browser,
        world,
        "builtin",
        "flags.html",
        "window.__round && __round.round.length > 0",
    )
    note = page.evaluate("ZimiShell.gameInfo.about && ZimiShell.gameInfo.about()")
    assert (
        note
        == "Built-in flags. Open in Zimi or kiwix-serve to play from your own library."
    )
    ctx.close()
    ctx, page, _ = open_game(
        browser,
        world,
        "zimi",
        "flags.html",
        "window.__round && __round.round.length > 0",
    )
    assert "in Zimi" in page.evaluate("ZimiShell.gameInfo.about()")
    ctx.close()
    ctx, page, _ = open_game(
        browser,
        world,
        "kiwix",
        "flags.html",
        "window.__round && __round.round.length > 0",
    )
    assert "in kiwix-serve" in page.evaluate("ZimiShell.gameInfo.about()")
    ctx.close()


# ── Timeline ─────────────────────────────────────────────────────────────────

TIMELINE_POSITION = "JSON.stringify(__timeline.sets) + JSON.stringify(__timeline.order) + __timeline.checked + ':' + __timeline.score + ':' + __timeline.at"


@pytest.mark.parametrize("gone", [False, True], ids=["library there", "library gone"])
@pytest.mark.parametrize("mode", MODES)
def test_timeline(browser, world, mode, gone):
    fx = fixture()
    ctx, page, errors = open_game(
        browser,
        world,
        mode,
        "timeline.html",
        "window.__timeline && __timeline.sets.length > 0",
    )
    sets = page.evaluate("__timeline.sets")
    assert len(sets) in ((3,) if mode == "builtin" else (2, 3)) and all(len(s) == 5 for s in sets)
    if mode == "builtin":
        assert page.evaluate("__timeline.zim") == ""
    else:
        texts = {t for _, t, _ in fx.EVENTS}
        assert page.evaluate("__timeline.zim"), "the library was not used"
        assert all(
            e["text"] in texts for s in sets for e in s
        ), "an event that is not on the fixture's date pages"
    # place three, leave, return: the same three in the same order
    for i in (3, 1, 2):
        tap(page, page.locator("#tl-list li:nth-child(%d) button" % i))
    page.wait_for_timeout(SETTLE_MS)
    before = page.evaluate(TIMELINE_POSITION)
    leave_and_return(ctx, page, world, mode, "timeline.html", gone)
    assert page.evaluate(TIMELINE_POSITION) == before
    # place the rest, check: a score, the years, and it comes back checked
    for i in (4, 5):
        tap(page, page.locator("#tl-list li:nth-child(%d) button" % i))
    tap(page, page.locator("#tl-check"))
    assert (
        page.locator("#tl-next").is_visible() and page.locator(".tl-year").count() == 5
    )
    page.wait_for_timeout(SETTLE_MS)
    before = page.evaluate(TIMELINE_POSITION)
    leave_and_return(ctx, page, world, mode, "timeline.html", gone)
    assert page.evaluate(TIMELINE_POSITION) == before and page.evaluate(
        "__timeline.checked"
    )
    assert not errors, errors
    ctx.close()


# ── Spelling Bee ─────────────────────────────────────────────────────────────

def bee_seed():
    """The first built-in set, its first letter in the middle, laid out in order."""
    import games_library_fixture as fx

    letters, _ = fx.bee_first()
    return {"mode": "practice", "date": "", "idx": 0, "center": letters[0], "outer": list(letters[1:]), "found": [], "dict": ""}


def bee_word(page, word):
    for c in word:
        page.keyboard.press(c)
    page.keyboard.press("Enter")
    page.wait_for_timeout(700)


@pytest.mark.parametrize("gone", [False, True], ids=["library there", "library gone"])
@pytest.mark.parametrize("mode", MODES)
def test_spelling_bee(browser, world, mode, gone):
    fx = fixture()
    # a known set: afginor with a in the middle (the first built-in puzzle), put there once before the page first looks
    seed = (
        "try { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('zimi.games.save.spellingbee', "
        "JSON.stringify({v: 1, at: Date.now(), data: {g: %s}})); } } catch (e) {}" % json.dumps(bee_seed())
    )
    ctx, page, errors = open_game(browser, world, mode, "spellingbee.html", "window.__bee && __bee.g && __bee.g.idx === 0", init=seed)
    assert (page.evaluate("__bee.dict") != "") == (mode != "builtin")
    letters, common = fx.bee_first()
    word = [w for w in common if letters[0] in w and len(w) >= 5][0]  # a common word with the middle letter
    bee_word(page, word)
    assert page.evaluate("__bee.g.found") == [word]
    bee_word(page, word)
    assert "Already found" in page.locator("#bee-msg").inner_text()
    bee_word(page, word[:3])
    for _ in range(3):
        page.keyboard.press("Backspace")   # a too-short word is left for the player to finish or delete
    assert "Too short" in page.locator("#bee-msg").inner_text()
    bee_word(page, fx.bee_only_word())  # in the Wiktionary only
    found = page.evaluate("__bee.g.found")
    if mode == "builtin":
        assert (
            fx.bee_only_word() not in found
            and "Not in the word list" in page.locator("#bee-msg").inner_text()
        )
    else:
        assert fx.bee_only_word() in found, "the Wiktionary was not asked"
    page.wait_for_timeout(SETTLE_MS)
    before = page.evaluate(
        "JSON.stringify(__bee.g) + document.getElementById('bee-points').textContent"
    )
    leave_and_return(ctx, page, world, mode, "spellingbee.html", gone)
    assert (
        page.evaluate(
            "JSON.stringify(__bee.g) + document.getElementById('bee-points').textContent"
        )
        == before
    )
    assert not errors, errors
    ctx.close()


# ── Mini Crossword ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("gone", [False, True], ids=["library there", "library gone"])
@pytest.mark.parametrize("mode", MODES)
def test_mini_crossword(browser, world, mode, gone):
    ctx, page, errors = open_game(
        browser,
        world,
        mode,
        "minicrossword.html",
        "window.__cw && __cw.g && __cw.g.words",
    )
    g = page.evaluate("__cw.g")
    assert len(g["words"]) == 6 and len(set(g["words"])) == 6
    sol = page.evaluate("__cw.sol")
    # the grid is a real crossword: across words on rows 0, 2, 4 and down words on columns 0, 2, 4 agree where they cross
    across = ["".join(sol[r * 5 + c] for c in range(5)) for r in (0, 2, 4)]
    down = ["".join(sol[r * 5 + c] for r in range(5)) for c in (0, 2, 4)]
    assert across + down == g["words"]
    if mode == "builtin":
        assert not any(g["lib"]) and page.evaluate("__cw.dict") == ""
    else:
        assert all(g["lib"]) and all(
            c.startswith("Fixture sense number") for c in g["clues"]
        ), "the clues are not the Wiktionary's"
    # type the first word, then leave and return
    for c in g["words"][0]:
        page.keyboard.press(c)
    assert page.evaluate("__cw.g.cells.slice(0, 5).join('')") == g["words"][0]
    page.wait_for_timeout(SETTLE_MS)
    before = page.evaluate("JSON.stringify(__cw.g)")
    leave_and_return(ctx, page, world, mode, "minicrossword.html", gone)
    assert page.evaluate("JSON.stringify(__cw.g)") == before
    # a hint (one more letter right), then every other letter: solved, and the end sheet comes up
    page.evaluate("document.querySelectorAll('#cw-across button')[1].click()")   # across 4, still empty
    tap(page, page.locator("#cw-hint"))
    assert page.evaluate("__cw.g.hints") == 1
    for n, r in enumerate((0, 2, 4)):
        page.evaluate("document.querySelectorAll('#cw-across button')[%d].click()" % n)   # the across clue: selects its first square, across
        for c in sol[r * 5 : r * 5 + 5]:
            page.keyboard.press(c)
    for i in (5, 15, 7, 17, 9, 19):   # the cells only a down word passes through
        tap(page, page.locator('.cw-cell[data-i="%d"]' % i))
        page.keyboard.press(sol[i])
    page.wait_for_timeout(1500)
    assert page.evaluate("__cw.g.cells.join('')") == "".join(sol)
    assert page.locator(".ar-sheet:not([hidden])").count() >= 1, "no end sheet after solving"
    assert not errors, errors
    ctx.close()


# ── the first games that read through the kit, now in kiwix-serve too ─────────

OLD = [
    ("quizzical.html", "__quiz.zim && __quiz.round.length", "__quiz.zim", [".qz-choice", "#qz-next"],
     "JSON.stringify(__quiz.round) + document.getElementById('qz-n').textContent + document.getElementById('qz-score').textContent"),
    ("jigsaw.html", "__jig.puzzle && !/ZimiGames/.test(__jig.puzzle.pic.credit)", "__jig.puzzle.pic.zim", ["#jg-peek"],
     "JSON.stringify(__jig.puzzle.pieces.map(p => [p.fx, p.fy, p.locked])) + JSON.stringify(__jig.puzzle.pic)"),
    ("wikirace.html", "__race.provider && !__race.provider.built && __race.race", "__race.provider.zim", [".rc-card .gm-play", ".rc-link"],
     "JSON.stringify(__race.race.steps) + __race.race.pair.start.path + __race.race.pair.end.path"),
]


@pytest.mark.parametrize("name,ready,zim,moves,position", OLD, ids=[o[0].split(".")[0] for o in OLD])
def test_wikipedia_games_play_from_kiwix_serve(browser, world, name, ready, zim, moves, position):
    ctx, page, errors = open_game(browser, world, "kiwix_first", name, ready)
    assert page.evaluate("GamesLib.modeNow()") == "kiwix" and page.evaluate(zim), "the page did not find kiwix-serve and its Wikipedia"
    assert "in kiwix-serve" in page.evaluate("ZimiShell.gameInfo.about()")
    for sel in moves:
        tap(page, page.locator(sel).first)
        page.wait_for_timeout(400)
    page.wait_for_timeout(SETTLE_MS)
    before = page.evaluate(position)
    leave_and_return(ctx, page, world, "kiwix_first", name, False)
    assert page.evaluate(position) == before
    assert not errors, errors
    ctx.close()
