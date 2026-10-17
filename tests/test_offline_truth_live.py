"""Offline that tells the truth, in a real browser, on an iPhone 15 at 390 px.

Opens the app online (so the service worker keeps what it keeps), then takes
the server away and checks what a person on the phone would see:

  - with no network at all: it says "offline", not "restarting", and lists what
    still works; the Almanac opens and renders; Help now names "my baby is
    choking" and opens the infant passage; a page already read opens;
  - with a connection but no server: a different, true sentence;
  - with a proxy answering 502 for a restarting server: a third;
  - and when the server comes back, the state clears by itself.

Playwright's context.set_offline does not reach a service worker's own
requests (the worker keeps reaching localhost), so "no server" is the server
process actually stopped, and set_offline is added for the device's own
signal (navigator.onLine false).

Run: pytest tests/test_offline_truth_live.py -v
Screenshots: ZIMI_SHOTS=/some/dir pytest tests/test_offline_truth_live.py
"""

import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fieldguide_fixture as fx  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get("ZIMI_SHOTS", "")
ZIM = "wikipedia_en_top"
ARTICLE = "Hypothermia"
ARTICLE_TEXT = "Hypothermia is a body temperature below normal."


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    """The real server as a process, so stopping it really takes it away."""

    def __init__(self, zims, data, port):
        self.zims, self.data, self.port = zims, data, port
        self.proc = None
        self.base = "http://127.0.0.1:%d" % port

    def start(self):
        env = dict(
            os.environ,
            ZIM_DIR=self.zims,
            ZIMI_DATA_DIR=self.data,
            ZIMI_OFFLINE="1",
            ZIMI_TORRENT="0",
            ZIMI_AUTO_UPDATE="0",
            ZIMI_PEER_DISCOVERY="0",
            PYTHONUNBUFFERED="1",
        )
        self.proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "zimi",
                "serve",
                "--port",
                str(self.port),
                "--host",
                "127.0.0.1",
            ],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 40
        while time.time() < deadline:
            try:
                urllib.request.urlopen(self.base + "/health", timeout=2).read()
                return
            except Exception:
                time.sleep(0.3)
        self.stop()
        raise RuntimeError("server did not start")

    def stop(self):
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=3)
            self.proc = None


class BadGateway:
    """A proxy answering for a server that is restarting: its own HTML 502."""

    def __init__(self, port):
        class H(BaseHTTPRequestHandler):
            def do_GET(self):
                body = b"<html><body><h1>502 Bad Gateway</h1></body></html>"
                self.send_response(502)
                self.send_header("Content-Type", "text/html")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            do_POST = do_GET

            def log_message(self, *a):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), H)
        self.httpd.daemon_threads = True
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture(scope="module")
def pw():
    import zimi.renderer as renderer

    if not renderer.browser_available():
        pytest.skip("playwright + chromium are not usable here")
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        yield p


@pytest.fixture
def world(tmp_path):
    zims, data = tmp_path / "zims", tmp_path / "data"
    zims.mkdir()
    data.mkdir()
    fx.build_library(str(zims), only=(fx.WIKI,))
    srv = Server(str(zims), str(data), _free_port())
    srv.start()
    yield srv
    srv.stop()


@pytest.fixture
def phone(pw, world):
    br = pw.chromium.launch()
    ctx = br.new_context(**pw.devices["iPhone 15"])
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    yield ctx, pg
    ctx.close()
    br.close()


def shot(pg, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        pg.screenshot(path=os.path.join(SHOTS, name + ".png"))


def warm(ctx, pg, base):
    """The app opened online: the worker is in control and has kept the
    shell, the Almanac and the guide; one article is read and saved."""
    pg.goto(base + "/", wait_until="load")
    pg.wait_for_function(
        "() => typeof openAlmanac === 'function' && typeof Saved === 'object'",
        timeout=30000,
    )
    pg.wait_for_function("() => !!navigator.serviceWorker.controller", timeout=30000)
    pg.wait_for_function(
        """async () => {
          const keys = await caches.keys();
          for (const k of keys) {
            const urls = (await (await caches.open(k)).keys()).map(r => r.url);
            if (urls.some(u => u.includes('/static/almanac.js')) && urls.some(u => u.includes('fieldguide-offline.json'))
                && urls.some(u => u.includes('/static/app.js'))) return true;
          }
          return false;
        }""",
        timeout=60000,
    )
    # Read a page: the reader's frame asks for it, the worker keeps it.
    pg.evaluate("([z, p]) => openArticle(z, p, 'Hypothermia')", [ZIM, ARTICLE])
    pg.wait_for_function(
        "() => { const f = document.querySelector('iframe'); try { return f && f.contentDocument.body.innerText.includes('body temperature'); } catch (e) { return false; } }",
        timeout=30000,
    )
    pg.evaluate(
        "([z, p]) => Saved.save({ kind: 'article', zim: z, path: p, title: 'Hypothermia' })",
        [ZIM, ARTICLE],
    )
    pg.wait_for_function(
        """async () => {
          for (const k of await caches.keys()) {
            if ((await (await caches.open(k)).keys()).some(r => r.url.includes('/w/wikipedia_en_top/Hypothermia'))) return true;
          }
          return false;
        }""",
        timeout=30000,
    )
    drop_kept_answers(pg)


def drop_kept_answers(pg):
    """The phone that has not kept the library's answers (a first visit, or after
    a sign-out): nothing stands in for /list, so the offline panel says what is
    true and what still works. With them kept, the home is drawn from them (see
    test_keep_phone_live.py)."""
    pg.evaluate("""async () => {
          for (const k of await caches.keys()) {
            const c = await caches.open(k);
            for (const r of await c.keys()) if (/\\/(list|whoami|manage\\/has-password)(\\?|$)/.test(r.url)) await c.delete(r);
          }
        }""")


def reopen(pg, base):
    pg.goto(base + "/", wait_until="load")
    pg.wait_for_selector("#offline-works li", timeout=30000)
    # The home is drawn once more a moment after boot (_renderHomeSoon, when the
    # library's kinds arrive): let that settle so the panel read is the last one.
    pg.wait_for_timeout(600)
    pg.wait_for_selector("#offline-works li", timeout=30000)


def works_list(pg):
    return pg.evaluate(
        "() => [...document.querySelectorAll('#offline-works li')].map(li => li.innerText.replace(/\\s+/g, ' '))"
    )


def panel_text(pg):
    return pg.inner_text(".conn-empty")


def frame_of(pg, needle):
    deadline = time.time() + 30
    while time.time() < deadline:
        for f in pg.frames:
            if needle in f.url:
                return f
        pg.wait_for_timeout(200)
    raise AssertionError("no frame for " + needle)


# ── no network at all ───────────────────────────────────────────────────────


def test_with_no_network_it_says_so_and_what_still_works_works(phone, world):
    ctx, pg = phone
    warm(ctx, pg, world.base)
    world.stop()
    ctx.set_offline(True)
    reopen(pg, world.base)
    shot(pg, "1-no-network")

    text = panel_text(pg)
    assert "You're offline" in text
    assert "restarting" not in pg.inner_text("body").lower()
    banner = pg.inner_text("#conn-banner")
    assert "No network" in banner
    rows = works_list(pg)
    assert any(r.startswith("Almanac") for r in rows), rows
    assert any(r.startswith("Help now") for r in rows), rows
    assert any(r.startswith("Saved") and "1 kept" in r for r in rows), rows

    # The Almanac opens and draws, all of it worked out on the device.
    pg.click("#offline-works a[href='/#almanac']")
    pg.wait_for_selector("#almanac-head-date", timeout=30000)
    pg.wait_for_function(
        "() => document.querySelector('#almanac-view').innerText.length > 200",
        timeout=30000,
    )
    shot(pg, "2-almanac-offline")
    assert not pg.errors, pg.errors
    pg.evaluate("() => closeAlmanac()")

    # Help now: the box names "my baby is choking" and the infant passage opens.
    pg.evaluate("() => openFieldguide(false)")
    fg = frame_of(pg, "fieldguide.html")
    fg.wait_for_selector("#t-q", timeout=30000)
    fg.fill("#t-q", "my baby is choking")
    fg.wait_for_selector(".fg-hit.lead", timeout=15000)
    shot(pg, "3-help-now-names-it")
    fg.press("#t-q", "Enter")
    fg.wait_for_selector("#c-quotes .fg-q", timeout=15000)
    first = fg.inner_text("#c-quotes .fg-q h3")
    assert first.startswith("Infants"), first
    shot(pg, "4-infant-passage")
    # Every situation's quotes are there, not only the one that was asked for.
    fg.evaluate("() => window.__home()")
    assert fg.evaluate("() => document.querySelectorAll('.fg-sit').length") >= 20

    # A page already read opens from what the phone kept.
    pg.evaluate("([z, p]) => openArticle(z, p, 'Hypothermia')", [ZIM, ARTICLE])
    pg.wait_for_function(
        "() => { const f = document.querySelector('iframe'); try { return f && f.contentDocument.body.innerText.includes('body temperature'); } catch (e) { return false; } }",
        timeout=30000,
    )
    shot(pg, "5-saved-page-offline")


def test_a_page_never_read_says_it_is_not_here_instead_of_pretending(phone, world):
    ctx, pg = phone
    warm(ctx, pg, world.base)
    world.stop()
    ctx.set_offline(True)
    reopen(pg, world.base)
    pg.evaluate("([z]) => openArticle(z, 'Tourniquet', 'Tourniquet')", [ZIM])
    pg.wait_for_function(
        "() => { const f = document.querySelector('iframe'); try { return f && f.contentDocument.body.innerText.length > 20; } catch (e) { return false; } }",
        timeout=30000,
    )
    said = pg.evaluate(
        "() => document.querySelector('iframe').contentDocument.body.innerText"
    )
    assert "body temperature" not in said and "constricts" not in said
    assert "restarting" not in said.lower()


# ── a connection, and no server ─────────────────────────────────────────────


def test_with_a_connection_but_no_server_it_says_that_instead(phone, world):
    ctx, pg = phone
    warm(ctx, pg, world.base)
    world.stop()
    reopen(pg, world.base)
    shot(pg, "6-server-unreachable")
    assert pg.evaluate("() => navigator.onLine") is True
    text = panel_text(pg)
    assert "Can't reach your Zimi server" in text and "You're offline" not in text
    assert "No network" not in pg.inner_text("#conn-banner")
    assert any(r.startswith("Almanac") for r in works_list(pg))


def test_a_proxy_answering_for_a_restarting_server_says_restarting(phone, world):
    ctx, pg = phone
    warm(ctx, pg, world.base)
    world.stop()
    proxy = BadGateway(world.port)
    try:
        reopen(pg, world.base)
        shot(pg, "7-restarting")
        assert "Your Zimi server is restarting" in panel_text(pg)
        assert "restarting" in pg.inner_text("#conn-banner")
    finally:
        proxy.stop()


def test_when_the_server_returns_the_state_clears_by_itself(phone, world):
    ctx, pg = phone
    warm(ctx, pg, world.base)
    world.stop()
    reopen(pg, world.base)
    assert pg.query_selector("#conn-banner")
    world.start()
    # The page probes on its own every few seconds: on a loaded machine it can
    # find the server before this tap does, which is the thing being tested.
    btn = pg.query_selector(".conn-retry-inline")
    if btn:
        try:
            btn.click(timeout=3000)
        except Exception:
            pass
    pg.wait_for_function("() => !document.getElementById('conn-banner')", timeout=30000)
    pg.wait_for_function("() => !document.querySelector('.conn-empty')", timeout=30000)


def test_the_red_night_light_reads_in_the_offline_state(phone, world):
    ctx, pg = phone
    warm(ctx, pg, world.base)
    pg.evaluate("() => localStorage.setItem('zimi_app_theme', 'red')")
    world.stop()
    ctx.set_offline(True)
    reopen(pg, world.base)
    assert pg.evaluate("() => document.documentElement.classList.contains('night-red')")
    shot(pg, "8-red-no-network")
    # Legible: the panel's text is not the page's own colour.
    colors = pg.evaluate(
        "() => { const c = getComputedStyle(document.querySelector('.conn-empty p')).color; const b = getComputedStyle(document.body).backgroundColor; return [c, b]; }"
    )
    assert colors[0] != colors[1], colors
