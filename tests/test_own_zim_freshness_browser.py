"""A page of Zimi's own ZIMs and the scripts it loads are one version, even when the server is slow.

After a deploy a busy NAS answers slowly. The service worker used to give a slow request a deadline and then answer
from its kept copy, so the games' new sokoban.js ran beside an old text.js and every label showed as a raw key
("sokoban.moves"). Own ZIMs now wait for the server, and a rebuilt own ZIM is a different worker
(http._own_zims_version), so the kept copies are dropped and open windows reload.

Run: pytest tests/test_own_zim_freshness_browser.py -v
"""

import os
import shutil
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SLOW_S = 3.5   # longer than the worker's deadline for a kept copy (2.5 s)
PAGE = (
    '<!doctype html><html><head><meta charset="utf-8"><title>t</title><script src="text.js"></script></head>'
    '<body><p id="o">x</p><script>document.getElementById("o").textContent = window.TEXT;</script></body></html>'
)


def _zim(tmp, version, out):
    from zimi import creator

    src = tmp / ("src_" + version)
    src.mkdir()
    (src / "index.html").write_text(PAGE)
    (src / "text.js").write_text('window.TEXT = "%s";' % version)
    (src / "zimi.txt").write_text("title: Freshness\n")
    creator.create_folder_zim(str(src), out_path=str(out), register=False)


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    import zimi.renderer as renderer

    if not renderer.browser_available():
        pytest.skip("playwright + chromium are not usable here")
    from http.server import ThreadingHTTPServer

    import zimi.server as srv
    from zimi.http import ZimHandler

    tmp = tmp_path_factory.mktemp("fresh")
    (tmp / "zims").mkdir()
    (tmp / "data").mkdir()
    _zim(tmp, "v1", tmp / "v1.zim")
    _zim(tmp, "v2", tmp / "v2.zim")
    target = tmp / "zims" / "zimi_games_2026-10.zim"
    shutil.copy(tmp / "v1.zim", target)
    old = (srv.ZIM_DIR, srv.ZIMI_DATA_DIR)
    srv.ZIM_DIR, srv.ZIMI_DATA_DIR = str(tmp / "zims"), str(tmp / "data")
    srv.load_cache(force=True)
    slow = {"on": False}

    class Slow(ZimHandler):
        def do_GET(self):
            if slow["on"] and self.path.split("?")[0].endswith("/text.js"):
                time.sleep(SLOW_S)
            return super().do_GET()

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Slow)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield {
        "base": "http://127.0.0.1:%d" % httpd.server_address[1],
        "slow": slow,
        "swap": lambda: (shutil.copy(tmp / "v2.zim", target), srv.load_cache(force=True)),
    }
    httpd.shutdown()
    srv.ZIM_DIR, srv.ZIMI_DATA_DIR = old


def test_a_slow_server_never_mixes_an_old_script_with_a_new_page(served):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        br = pw.chromium.launch()
        ctx = br.new_context(viewport={"width": 390, "height": 844})
        pg = ctx.new_page()

        def shown():
            pg.goto(served["base"] + "/?a=zimi_games%2Findex.html", wait_until="load")
            pg.wait_for_function(
                "() => { const f = document.getElementById('reader-frame'); return f && f.contentDocument && f.contentDocument.getElementById('o'); }",
                timeout=60000,
            )
            return pg.evaluate("() => document.getElementById('reader-frame').contentDocument.getElementById('o').textContent")

        try:
            pg.goto(served["base"] + "/", wait_until="load")
            pg.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.controller", timeout=30000)
            assert shown() == "v1"
            assert shown() == "v1"           # the worker now keeps text.js
            served["swap"]()
            served["slow"]["on"] = True       # a NAS right after a deploy
            assert shown() == "v2", "a kept text.js answered for a slow server"
        finally:
            served["slow"]["on"] = False
            br.close()


def test_a_rebuilt_own_zim_is_a_different_worker(tmp_path):
    from zimi import http, ownzims

    def version(stamp):
        d = tmp_path / stamp
        d.mkdir(exist_ok=True)
        (d / "zimi_games_2026-10.zim.source").write_text(stamp + "\n")
        ownzims.OUT_DIR = str(d)
        return http.own_zims_version()

    saved = ownzims.OUT_DIR

    try:
        assert version("a") == version("a")
        assert version("a") != version("b")
    finally:
        ownzims.OUT_DIR = saved
