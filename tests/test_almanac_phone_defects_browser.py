"""Almanac defects a phone-path test found, each held in a real browser.

On the shipped files, served by Zimi, in headless Chromium at an iPhone 15's
size (390 x 844, touch, mobile). One test per defect, named for it.

Run: pytest tests/test_almanac_phone_defects_browser.py -v
"""

import os
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

GL_ARGS = [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
]
VIEW = {"width": 390, "height": 844}
POLL_MS = 100
READY_MS = 240_000
PLACE = '{"lat":37.77,"lon":-122.42,"name":"San Francisco"}'

ON_PAGE = "() => !!document.getElementById('almanac-orrery') && !!document.getElementById('almanac-head')"


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    import zimi.renderer as renderer

    if not renderer.browser_available():
        pytest.skip("playwright + chromium are not usable here")
    from http.server import ThreadingHTTPServer

    import zimi.server as srv
    from zimi.http import ZimHandler

    tmp = tmp_path_factory.mktemp("phone")
    (tmp / "zims").mkdir()
    (tmp / "data").mkdir()
    old = (srv.ZIM_DIR, srv.ZIMI_DATA_DIR)
    srv.ZIM_DIR, srv.ZIMI_DATA_DIR = str(tmp / "zims"), str(tmp / "data")
    srv.load_cache(force=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), ZimHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield "http://127.0.0.1:%d" % httpd.server_address[1]
    httpd.shutdown()
    srv.ZIM_DIR, srv.ZIMI_DATA_DIR = old


@pytest.fixture(scope="module")
def browser(served):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        br = pw.chromium.launch(args=GL_ARGS)
        warm = br.new_page()
        warm.goto("about:blank")
        warm.evaluate("document.createElement('canvas').getContext('webgl2')")
        warm.close()
        yield br
        br.close()


def _page(
    browser, served, theme="dark", reduced=False, locale="en-US", init=None, query=""
):
    ctx = browser.new_context(
        viewport=VIEW,
        device_scale_factor=2,
        has_touch=True,
        is_mobile=True,
        service_workers="block",
        locale=locale,
        reduced_motion="reduce" if reduced else "no-preference",
        color_scheme="dark" if theme == "dark" else "light",
    )
    ctx.add_init_script(
        "try { localStorage.setItem('zimi_app_theme', %r);"
        " localStorage.setItem('zimi_almanac_place', %r);"
        " sessionStorage.setItem('zimi_almanac_location', %r); } catch (e) {}"
        % (theme, PLACE, PLACE)
    )
    if init:
        ctx.add_init_script(init)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(served + "/" + query + "#almanac", wait_until="load")
    pg.wait_for_function(ON_PAGE, timeout=60_000, polling=POLL_MS)
    pg.wait_for_timeout(800)
    return ctx, pg, errors


def _back_leaves_view_only(pg, open_js, open_flag):
    pg.evaluate(open_js)
    pg.wait_for_function("() => " + open_flag, timeout=READY_MS, polling=200)
    pg.evaluate("history.back()")
    pg.wait_for_function("() => !(" + open_flag + ")", timeout=10_000, polling=POLL_MS)
    pg.wait_for_timeout(400)
    assert pg.evaluate("_almanacOpen") is True
    assert pg.evaluate(
        "document.getElementById('almanac-view').classList.contains('open')"
    )


def test_back_from_earth_keeps_the_almanac(browser, served):
    ctx, pg, errors = _page(browser, served)
    try:
        pg.wait_for_function(
            "() => typeof _aeLoadThree === 'function'", timeout=60_000
        )
        _back_leaves_view_only(pg, "openAlmanacEarth({ target: 'earth' })", "(typeof _aeIsOpen !== 'undefined' && _aeIsOpen)")
    finally:
        ctx.close()


def test_back_from_space_keeps_the_almanac(browser, served):
    ctx, pg, errors = _page(browser, served)
    try:
        pg.wait_for_function("() => typeof _aeLoadThree === 'function'", timeout=60_000)
        _back_leaves_view_only(
            pg, "_almOpenSpace()", "(typeof _spIsOpen !== 'undefined' && _spIsOpen)"
        )
    finally:
        ctx.close()


def test_the_views_own_close_takes_its_step_back(browser, served):
    ctx, pg, errors = _page(browser, served)
    try:
        pg.wait_for_function(
            "() => typeof _aeLoadThree === 'function'", timeout=60_000
        )
        pg.evaluate("openAlmanacEarth({ target: 'earth' })")
        pg.wait_for_function("() => typeof _aeIsOpen !== 'undefined' && _aeIsOpen", timeout=READY_MS, polling=200)
        pg.click("#ae-back")
        pg.wait_for_function("() => !_aeIsOpen", timeout=10_000)
        pg.wait_for_timeout(400)
        assert not pg.evaluate("!!(history.state && history.state.aeView)")
        assert pg.evaluate("_almanacOpen") is True
    finally:
        ctx.close()


TOOLS = ".alm-sky-gear, .alm-sky-find, .alm-sky-below, .alm-sky-look"


@pytest.mark.parametrize("locale", ["en-US", "ar"])
def test_the_scene_tools_do_not_overlap_and_are_44px(browser, served, locale):
    ctx, pg, errors = _page(browser, served, locale=locale)
    try:
        pg.wait_for_selector("[data-sky-find]", state="attached", timeout=60_000)
        pg.wait_for_selector("[data-sky-below]", state="attached", timeout=60_000)
        boxes = pg.evaluate(
            "(sel) => [...document.querySelectorAll(sel)].map(e => { const r = e.getBoundingClientRect();"
            " return { n: e.className, x: r.x, y: r.y, w: r.width, h: r.height }; })",
            TOOLS,
        )
        assert len(boxes) == 4, boxes
        for b in boxes:
            assert b["w"] >= 44 and b["h"] >= 44, b
        for i, a in enumerate(boxes):
            for b in boxes[i + 1 :]:
                apart = a["x"] + a["w"] <= b["x"] or b["x"] + b["w"] <= a["x"] or a["y"] + a["h"] <= b["y"] or b["y"] + b["h"] <= a["y"]
                assert apart, (a, b)
    finally:
        ctx.close()


def test_a_jump_repaints_the_sky_even_when_the_observer_is_stale(browser, served):
    """The sky's in-view flag can be stale (the observer speaks only on crossing the screen's edge): after
    a jump of the clock the picture must still be drawn at the new instant, not left at the old one."""
    ctx, pg, errors = _page(browser, served)
    try:
        pg.wait_for_function("() => typeof _skyState !== 'undefined' && _skyState && _skyState.eph", timeout=60_000)
        for i in range(4):
            target = 1_790_000_000_000 + i * 86_400_000 * 3 + i * 7_000_000
            pg.evaluate("() => { _skyState.inView = false; }")
            pg.evaluate("(t) => _almScrubSettle(new Date(t), { land: true })", target)
            pg.wait_for_function(
                "(t) => _skyState && _skyState.paintedTime === t", arg=target, timeout=8_000, polling=POLL_MS
            )
        assert pg.evaluate("_skyState.inView") is True  # a measured, in-view sky wakes properly
    finally:
        ctx.close()
