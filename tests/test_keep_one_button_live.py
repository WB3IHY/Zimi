"""Keep offline is one button in the tile's bottom-right corner, at 390 px.

  - the mark sits bottom right, a 44px target, faded until touched;
  - under 1 GB one tap starts and the mark is the ring at once; from 1 GB the
    same button grows into the size and a second tap starts (it goes back to the
    arrow on a tap elsewhere or after a few seconds);
  - the check turns into a trash can on the first tap and the second deletes;
  - a ring opens the detail (percent, bytes, speed; Pause or Resume, Cancel); a
    failed pull says so on the ring and offers Retry;
  - a 74 GB pull shows movement: a sliver of ring from the first byte, numbers
    in the detail, and a total even when the proxy sends no length;
  - offline: Discover first, the pill's hint wraps inside its popover, and an
    app's back arrow leads home; online: On this phone opens the categories.

Run: pytest tests/test_keep_one_button_live.py -v
"""

import http.client
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import test_keep_phone_live as kp  # noqa: E402
from test_keep_flow_live import library  # noqa: E402
from test_keep_phone_live import _device, pw, wait_shell_kept  # noqa: E402,F401
from test_offline_truth_live import Server, _free_port  # noqa: E402
import wiki_fixture as wf  # noqa: E402

BIG_NAME = "wikipedia_en_simple"
SMALL = "wikiquote"
BIG = 74 * 10**9


class BigProxy:
    """Forwards to the real server, except that the whole-file stream of BIG_NAME claims to be 74 GB and arrives slowly;
    `chunked` leaves out every length header, as a proxy that re-chunks a long stream can.
    """

    def __init__(self, upstream_port, port):
        outer = self
        self.chunked = False

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def do_GET(self):
                rng = self.headers.get("Range", "")
                stream = self.path.startswith("/keep/" + BIG_NAME) and (
                    rng == "" or (rng.endswith("-") and rng != "bytes=0-0")
                )
                if stream:
                    return self.big(int(rng[6:-1]) if rng else 0)
                conn = http.client.HTTPConnection(
                    "127.0.0.1", upstream_port, timeout=30
                )
                try:
                    conn.request(
                        "GET",
                        self.path,
                        headers={
                            k: v
                            for k, v in self.headers.items()
                            if k.lower() not in ("host", "connection")
                        },
                    )
                    r = conn.getresponse()
                    body = r.read()
                    self.send_response(r.status)
                    for k, v in r.getheaders():
                        if k.lower() not in (
                            "transfer-encoding",
                            "connection",
                            "content-length",
                        ):
                            self.send_header(k, v)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except Exception:
                    pass
                finally:
                    conn.close()

            def big(self, start):
                self.send_response(200 if outer.chunked else 206)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("ETag", '"big"')
                if outer.chunked:
                    self.send_header("Transfer-Encoding", "chunked")
                else:
                    self.send_header(
                        "Content-Range", "bytes %d-%d/%d" % (start, BIG - 1, BIG)
                    )
                    self.send_header("Content-Length", str(BIG - start))
                self.end_headers()
                chunk = b"\0" * 65536
                try:
                    while True:
                        self.wfile.write(
                            (b"%x\r\n" % len(chunk) + chunk + b"\r\n")
                            if outer.chunked
                            else chunk
                        )
                        time.sleep(0.02)
                except Exception:
                    return

        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), H)
        self.httpd.daemon_threads = True
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % port

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def world(tmp_path):
    zims, data = tmp_path / "zims", tmp_path / "data"
    zims.mkdir()
    data.mkdir()
    wf.build_library(str(zims))
    srv = Server(str(zims), str(data), _free_port())
    srv.start()
    proxy = BigProxy(srv.port, _free_port())
    yield srv, proxy
    proxy.stop()
    srv.stop()


def mark(pg, zim):
    return pg.evaluate(
        """(z) => { const b = document.querySelector(`.stat-card[data-zim='${z}'] .keep-ico`); if (!b) return null;
          const r = b.getBoundingClientRect(), c = b.closest('.stat-card').getBoundingClientRect();
          return { k: b.dataset.k, w: r.width, h: r.height, right: c.right - r.right, bottom: c.bottom - r.bottom,
                   opacity: +getComputedStyle(b).opacity, text: b.innerText.trim(),
                   dash: (b.querySelector('.kr-arc') || document.body).getAttribute('stroke-dasharray') }; }""",
        zim,
    )


def tap(pg, zim):
    pg.evaluate(
        "(z) => document.querySelector(`.stat-card[data-zim='${z}']`).scrollIntoView({block: 'center'})",
        zim,
    )
    pg.wait_for_timeout(250)
    b = pg.evaluate(
        "(z) => { const r = document.querySelector(`.stat-card[data-zim='${z}'] .keep-ico`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }",
        zim,
    )
    pg.mouse.click(b[0], b[1])
    pg.wait_for_timeout(200)


def keep_one(pg):
    """One ZIM kept, so every tile carries the arrow; the pull spy is installed after it."""
    pg.evaluate("(z) => _keepStart(z)", "wikipedia")
    pg.wait_for_selector(
        ".stat-card[data-zim='wikipedia'] .keep-ico.kept", timeout=30000
    )


def spy_pull(pg):
    pg.evaluate(
        """() => { window.__pulls = []; const real = KeepStore.pull; KeepStore.pull = function() { window.__pulls.push([...arguments]); return real.apply(KeepStore, arguments); };
                   KeepStore.room = async () => ({ quota: 0, usage: 0, free: 5e11 }); }"""
    )


def test_the_mark_is_bottom_right_a_44px_target_and_faded(pw, world):
    br, ctx, pg = library(pw, world)
    keep_one(pg)
    pg.evaluate(
        "(z) => document.querySelector(`.stat-card[data-zim='${z}']`).scrollIntoView({block: 'center'})",
        SMALL,
    )
    m = mark(pg, SMALL)
    assert m["k"] == "can" and m["w"] >= 44 and m["h"] >= 44, m
    assert m["right"] <= 8 and m["bottom"] <= 8, m
    assert m["opacity"] < 0.7, "faded until touched: %r" % m
    kept = mark(pg, "wikipedia")
    assert kept["right"] <= 8 and kept["bottom"] <= 8, (
        "the check shares the spot: %r" % kept
    )
    # In the compact grid too, and clear of the corner badges at the top.
    pg.evaluate(
        "() => { localStorage.setItem('zimi_library_view', 'tiles'); renderHome(); }"
    )
    pg.wait_for_timeout(500)
    pg.evaluate(
        "(z) => document.querySelector(`.stat-card[data-zim='${z}']`).scrollIntoView({block: 'center'})",
        SMALL,
    )
    m = mark(pg, SMALL)
    assert m["right"] <= 8 and m["bottom"] <= 8, m
    ctx.close()
    br.close()


def test_a_small_zim_starts_on_one_tap_and_is_the_ring_at_once(pw, world):
    br, ctx, pg = library(pw, world)
    keep_one(pg)
    spy_pull(pg)
    pg.evaluate(
        "() => { KeepStore.probe = async () => { await new Promise(r => setTimeout(r, 1500)); return { ok: true, size: 60000 }; }; }"
    )
    tap(pg, SMALL)
    # The probe has not answered yet and the mark is already the ring.
    assert mark(pg, SMALL)["k"] == "pull", mark(pg, SMALL)
    assert pg.evaluate("() => window.__pulls.length") == 0
    pg.wait_for_function("() => window.__pulls.length === 1", timeout=10000)
    assert not pg.query_selector(".pw-overlay.open"), "no sheet on the way"
    ctx.close()
    br.close()


def test_a_big_zim_grows_into_its_size_and_the_same_button_starts_it(pw, world):
    br, ctx, pg = library(pw, world)
    keep_one(pg)
    spy_pull(pg)
    pg.evaluate(
        "([z, b]) => { _zimInfo(z).size_bytes = b; _zimInfo(z).size_gb = b / 1e9; }",
        [SMALL, BIG],
    )
    pg.evaluate(
        "() => { KeepStore.probe = async () => ({ ok: true, size: 74e9 }); KeepStore.pull = function() { window.__pulls.push([...arguments]); return true; }; }"
    )
    tap(pg, SMALL)
    m = mark(pg, SMALL)
    assert m["k"] == "ask" and m["text"] == "74 GB", m
    assert (
        pg.evaluate("() => window.__pulls.length") == 0
    ), "the first tap starts nothing"
    assert m["right"] <= 8 and m["bottom"] <= 8 and m["w"] > 44, m
    # A tap elsewhere puts the arrow back.
    pg.mouse.click(195, 8)
    pg.wait_for_timeout(250)
    assert mark(pg, SMALL)["k"] == "can"
    # So does waiting.
    pg.evaluate("() => { KEEP_ARM_MS = 400; }")
    tap(pg, SMALL)
    assert mark(pg, SMALL)["k"] == "ask"
    pg.wait_for_function(
        "(z) => document.querySelector(`.stat-card[data-zim='${z}'] .keep-ico`).dataset.k === 'can'",
        arg=SMALL,
        timeout=5000,
    )
    # Same button again, then again: it starts, with the size it showed.
    pg.evaluate("() => { KEEP_ARM_MS = 4000; }")
    tap(pg, SMALL)
    assert mark(pg, SMALL)["k"] == "ask"
    tap(pg, SMALL)
    pg.wait_for_function("() => window.__pulls.length === 1", timeout=10000)
    assert pg.evaluate("() => window.__pulls[0][5]") == BIG
    assert not pg.query_selector(".pw-overlay.open")
    ctx.close()
    br.close()


def test_too_big_for_the_phone_still_refuses_plainly(pw, world):
    br, ctx, pg = library(pw, world)
    keep_one(pg)
    pg.evaluate(
        "([z, b]) => { _zimInfo(z).size_bytes = b; KeepStore.room = async () => ({ quota: 0, usage: 0, free: 38e9 }); KeepStore.probe = async () => ({ ok: true, size: b }); KeepStore.estimateIsFuzzy = () => false; }",
        [SMALL, BIG],
    )
    tap(pg, SMALL)
    tap(pg, SMALL)
    pg.wait_for_selector(".keep-sheet", timeout=10000)
    rows = pg.inner_text(".keep-sheet-rows")
    assert "Needs 74 GB" in rows and "38 GB" in rows, rows
    pg.click(".keep-sheet [data-act='cancel']")
    pg.wait_for_function(
        "(z) => document.querySelector(`.stat-card[data-zim='${z}'] .keep-ico`).dataset.k === 'can'",
        arg=SMALL,
        timeout=5000,
    )
    ctx.close()
    br.close()


def test_the_check_turns_into_a_trash_can_and_the_second_tap_deletes(pw, world):
    br, ctx, pg = library(pw, world)
    keep_one(pg)
    tap(pg, "wikipedia")
    assert mark(pg, "wikipedia")["k"] == "trash"
    assert "wikipedia" in pg.evaluate(
        "() => [..._keepNames]"
    ), "the first tap deletes nothing"
    pg.mouse.click(195, 8)  # elsewhere: back to the check
    pg.wait_for_timeout(250)
    assert mark(pg, "wikipedia")["k"] == "kept"
    tap(pg, "wikipedia")
    tap(pg, "wikipedia")
    assert not pg.query_selector(".pw-overlay.open"), "no sheet"
    pg.wait_for_function("() => !document.querySelector('.keep-ico')", timeout=15000)
    ctx.close()
    br.close()


def test_a_74gb_pull_visibly_moves_and_the_ring_opens_a_detail(pw, world):
    srv, proxy = world
    br, ctx, pg = library(pw, world)
    keep_one(pg)
    pg.evaluate(
        "([z, b]) => { _zimInfo(z).size_bytes = b; KeepStore.room = async () => ({ quota: 0, usage: 0, free: 5e11 }); }",
        [BIG_NAME, BIG],
    )
    tap(pg, BIG_NAME)
    tap(pg, BIG_NAME)
    pg.wait_for_function(
        "(z) => { const b = document.querySelector(`.stat-card[data-zim='${z}'] .keep-ico`); return b && b.dataset.k === 'pull'; }",
        arg=BIG_NAME,
        timeout=15000,
    )
    pg.wait_for_function("() => KeepStore.state().written > 2e6", timeout=20000)
    # At this size a percent is 740 MB: the arc still shows from the first byte.
    m = mark(pg, BIG_NAME)
    assert float(m["dash"].split()[0]) >= 4, m
    st = pg.evaluate("() => KeepStore.state()")
    assert st["size"] == BIG and st["speed"] > 0, st
    tap(pg, BIG_NAME)
    pg.wait_for_selector("#keep-detail:not([hidden])")
    acts = pg.evaluate(
        "() => [...document.querySelectorAll('#keep-detail button')].map(b => b.innerText.trim())"
    )
    assert acts == ["Pause", "Cancel download"], acts
    text = pg.inner_text("#keep-detail")
    assert "74 GB" in text and "/s" in text, text
    first = pg.evaluate("() => KeepStore.state().written")
    pg.wait_for_timeout(1500)
    assert pg.evaluate("() => KeepStore.state().written") > first
    box = pg.evaluate(
        "() => { const r = document.getElementById('keep-detail').getBoundingClientRect(); return [r.left, r.right, innerWidth]; }"
    )
    assert box[0] >= 0 and box[1] <= box[2], box
    # Pause keeps it as a ring that offers Resume.
    pg.click("#keep-detail [data-act='pause']")
    pg.wait_for_function(
        "(z) => document.querySelector(`.stat-card[data-zim='${z}'] .keep-ico`).dataset.k === 'paused'",
        arg=BIG_NAME,
        timeout=10000,
    )
    tap(pg, BIG_NAME)
    assert pg.evaluate(
        "() => [...document.querySelectorAll('#keep-detail button')].map(b => b.innerText.trim())"
    ) == ["Resume", "Cancel download"]
    pg.click("#keep-detail [data-act='cancel']")
    pg.wait_for_function(
        "(z) => document.querySelector(`.stat-card[data-zim='${z}'] .keep-ico`).dataset.k === 'can'",
        arg=BIG_NAME,
        timeout=10000,
    )
    ctx.close()
    br.close()


def test_a_proxy_that_sends_no_length_still_gives_the_ring_a_total(pw, world):
    srv, proxy = world
    proxy.chunked = True
    br, ctx, pg = library(pw, world)
    keep_one(pg)
    pg.evaluate(
        "([z, b]) => { _zimInfo(z).size_bytes = b; KeepStore.room = async () => ({ quota: 0, usage: 0, free: 5e11 }); KeepStore.probe = async () => ({ ok: true, size: 0 }); }",
        [BIG_NAME, BIG],
    )
    tap(pg, BIG_NAME)
    tap(pg, BIG_NAME)
    pg.wait_for_function("() => KeepStore.state().written > 1e6", timeout=20000)
    assert (
        pg.evaluate("() => KeepStore.state().size") == BIG
    ), "the library's byte count is the total when the stream has none"
    pg.evaluate("() => KeepStore.stop()")
    # And a one-byte answer with no Content-Range is not mistaken for a one-byte ZIM.
    size = pg.evaluate(
        """async () => { const f = window.fetch; window.fetch = async () => new Response('x', { status: 206 });
                         const p = await KeepStore.probe('a', {}); window.fetch = f; return p.size; }"""
    )
    assert size == 0, size
    ctx.close()
    br.close()


def test_a_failed_pull_shows_on_the_ring_and_offers_retry(pw, world):
    br, ctx, pg = library(pw, world)
    keep_one(pg)
    pg.evaluate(
        """(z) => { const real = KeepStore.state; KeepStore.state = () => ({ name: z, phase: 'idle', written: 5e9, size: 74e9, error: 'network', speed: 0, at: 0, retrying: false });
                   window.__real = real; _keepIconSync(); }""",
        BIG_NAME,
    )
    assert mark(pg, BIG_NAME)["k"] == "failed"
    tap(pg, BIG_NAME)
    pg.wait_for_selector("#keep-detail:not([hidden])")
    text = pg.inner_text("#keep-detail")
    assert "connection dropped" in text and "Retry" in text and "6.8%" in text, text
    ctx.close()
    br.close()


# ── offline and the home ─────────────────────────────────────────────────────


def go_offline(pw, world):
    srv, proxy = world
    br, ctx, pg = library(pw, world)
    keep_one(pg)
    pg.wait_for_timeout(1500)
    srv.stop()
    ctx.set_offline(True)
    pg.close()
    pg = ctx.new_page()
    pg.goto(proxy.base + "/", wait_until="commit")
    pg.wait_for_selector(".stat-card.kept", timeout=20000)
    pg.wait_for_timeout(1500)
    return br, ctx, pg


def test_offline_the_pill_hint_wraps_and_an_apps_back_arrow_goes_home(pw, world):
    br, ctx, pg = go_offline(pw, world)
    pg.click("#conn-pill")
    pg.wait_for_selector("#zim-ctx-menu.visible")
    r = pg.evaluate(
        """() => { const i = document.querySelector('#zim-ctx-menu .ctx-info'), m = document.getElementById('zim-ctx-menu').getBoundingClientRect(), b = i.getBoundingClientRect();
                   return { ws: getComputedStyle(i).whiteSpace, over: i.scrollWidth > i.clientWidth + 1, right: m.right, left: m.left, w: innerWidth, h: b.height }; }"""
    )
    assert (
        r["ws"] == "normal"
        and not r["over"]
        and r["left"] >= 0
        and r["right"] <= r["w"]
    ), r
    assert r["h"] > 30, "it wraps onto more than one line: %r" % r
    pg.keyboard.press("Escape")
    # An app opened offline: the arrow is there and goes back to the home it came from.
    pg.evaluate("() => window.scrollTo(0, 0)")
    pg.click("a.stat-card[href='#dictionary']")
    pg.wait_for_function("() => _isAppPage()", timeout=10000)
    assert (
        pg.evaluate(
            "() => getComputedStyle(document.getElementById('back-btn')).display"
        )
        != "none"
    )
    pg.click("#back-btn")
    pg.wait_for_function(
        "() => !_isAppPage() && !!document.querySelector('.stat-card.kept')",
        timeout=10000,
    )
    assert pg.evaluate("() => location.pathname + location.hash") == "/"
    ctx.close()
    br.close()


def test_online_on_this_phone_opens_the_categories(pw, world):
    br, ctx, pg = library(pw, world)
    keep_one(pg)
    pg.evaluate(
        "() => { collectionsCache = Object.assign({}, collectionsCache, { collections: { mine: { label: 'Mine', zims: ['wikiquote'] } } }); renderHome(); }"
    )
    pg.wait_for_selector(".cat-heading")
    heads = pg.evaluate(
        "() => [...document.querySelectorAll('#output .cat-heading')].map(e => e.innerText.trim().toLowerCase())"
    )
    # Directly below the collections, before the big library flow.
    assert heads.index("mine") + 1 == heads.index("on this phone") < heads.index("encyclopedias"), heads
    ctx.close()
    br.close()
