"""Cold start of the installed app, offline and on lie-fi, in WebKit at iPhone size.

Not a test: a measurement, run by hand before and after a change to the
service worker or the boot path.

    python3 tests/bench_offline_start.py [webkit|chromium] [runs]

Warms the app online (the worker keeps the shell), then closes the page and
opens a new one (a cold start of the home-screen app) in three conditions:

  online   the server answers
  down     the server is stopped: connections are refused at once
  liefi    something holds the port open and answers nothing: the phone
           shows a connection and none works

and prints, per condition, the median of: first paint, "the library or the
offline panel is on screen", and "the page's load event".
"""

import os
import socket
import statistics
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fieldguide_fixture as fx  # noqa: E402
import test_offline_truth_live as _live  # noqa: E402
from test_offline_truth_live import Server, _free_port, poll  # noqa: E402

# ZIMI_ROOT=<checkout> measures another tree (a baseline) with the same harness.
_live.ROOT = os.environ.get("ZIMI_ROOT", _live.ROOT)

# What is on screen: the library (cards drawn from the list, kept or live) or
# the offline panel that says there is none. Anything else is still loading.
ARRIVED = """() => document.querySelector('.stat-card') ? 'library'
  : (document.querySelector('.conn-empty') ? 'offline panel' : '')"""
PAINT = """() => { const p = performance.getEntriesByName('first-contentful-paint')[0]; return p ? p.startTime : -1; }"""


class BlackHole:
    """Accepts connections on the port and never answers them."""

    def __init__(self, port):
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", port))
        self.sock.listen(64)
        self.held = []
        self.alive = True
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        while self.alive:
            try:
                c, _ = self.sock.accept()
                self.held.append(c)
            except OSError:
                return

    def stop(self):
        self.alive = False
        self.sock.close()
        for c in self.held:
            c.close()


def cold_start(ctx, base, timeout_s=20):
    pg = ctx.new_page()
    t0 = time.time()
    try:
        pg.goto(base + "/", wait_until="commit", timeout=timeout_s * 1000)
    except Exception:
        pg.close()
        return -1, -1, -1, ''
    try:
        pg.wait_for_function("() => !!(%s)()" % ARRIVED.strip(), timeout=timeout_s * 1000, polling=50)
        arrived = (time.time() - t0) * 1000
        shown = pg.evaluate(ARRIVED)
    except Exception:
        arrived = -1
        shown = ''
        if os.environ.get('BENCH_DEBUG'):
            print('  not arrived; page says:', pg.evaluate("() => document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200)"))
    paint = pg.evaluate(PAINT)
    try:
        pg.wait_for_load_state("load", timeout=timeout_s * 1000)
        loaded = (time.time() - t0) * 1000
    except Exception:
        loaded = -1
    pg.close()
    return paint, arrived, loaded, shown


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "webkit"
    runs = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    from playwright.sync_api import sync_playwright

    tmp = tempfile.mkdtemp()
    zims, data = os.path.join(tmp, "zims"), os.path.join(tmp, "data")
    os.makedirs(zims)
    os.makedirs(data)
    fx.build_library(zims, only=(fx.WIKI, fx.WATER, fx.READY))
    port = _free_port()
    srv = Server(zims, data, port)
    srv.start()
    with sync_playwright() as p:
        dev = {
            k: v
            for k, v in p.devices["iPhone 15"].items()
            if k != "default_browser_type"
        }
        # An ephemeral context: Playwright's WebKit keeps no Cache Storage in a
        # persistent one (writes are dropped), and no OPFS in an ephemeral one.
        ctx = getattr(p, which).launch().new_context(**dev)
        pg = ctx.new_page()
        pg.goto(srv.base + "/", wait_until="load")
        pg.wait_for_function(
            "() => !!navigator.serviceWorker.controller", timeout=30000
        )
        pg.evaluate("() => _keepAlmanac()")  # as a kept ZIM or the Almanac opened asks
        poll(
            pg,
            """async () => { for (const k of await caches.keys()) {
              const u = (await (await caches.open(k)).keys()).map(r => r.url);
              if (u.some(x => x.includes('/static/app.js')) && u.some(x => x.includes('/static/almanac.js'))) return true; }
              return false; }""",
        )
        pg.wait_for_timeout(1500)
        pg.close()
        rows = []
        # In this order, with no pause: the worker remembers a dead network for
        # 15 s, so "liefi" must come while the last answer it saw was live; and
        # Playwright's WebKit empties an ephemeral context's Cache Storage after
        # a few idle seconds with no page open, which a pause here would trigger.
        hole = None
        for label in ("online", "liefi", "down"):
            if label == "liefi":
                srv.stop()
                hole = BlackHole(port)
            elif label == "down" and hole:
                hole.stop()
                hole = None
            res = [cold_start(ctx, srv.base) for _ in range(runs)]
            med = [statistics.median(r[i] for r in res) for i in range(3)]  # paint, on screen, load
            rows.append((label, med, res))
            print(
                "%-7s first paint %6.0f ms   on screen %6.0f ms   load %6.0f ms   (runs: %s)   [-1 = not within 20 s]"
                % (label, med[0], med[1], med[2], ", ".join("%.0f" % r[1] for r in res))
            )
        ctx.close()
    srv.stop()


if __name__ == "__main__":
    main()
