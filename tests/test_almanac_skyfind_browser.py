"""Find in the sky, and the sky under the horizon, in a real browser.

On the shipped files, served by Zimi, in headless Chromium at a phone's
width, San Francisco at 23:00 on 30 September 2026 (Saturn up in the
southeast, Mars, Jupiter, Venus and the Sun under the horizon):

  1. Find. A tap on the scene's Find button loads the module and opens the
     sheet; with nothing typed it offers what is up; a name finds its thing;
     choosing it rings it, says where it is, and turns the star chart to put
     it at the top.
  2. Under the horizon. A thing that is below it turns the sky under the
     horizon on (and the choice is kept); the button toggles it by hand.
  3. Look. Opened to lead to something on a device with no sensors, the view
     turns to it and says it is in view; clearing takes the chip away.

The maths (matching, places against Horizons, the way to a thing) is
tests/test_almanac_skyfind.cjs.

Run: pytest tests/test_almanac_skyfind_browser.py -v
"""

import json
import os
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

GL_ARGS = (
    []
    if sys.platform == "darwin"
    else ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
)
VIEW = {"width": 390, "height": 844}
PLACE = {"lat": 37.7749, "lon": -122.4194, "name": "San Francisco"}
NIGHT = "2026-10-01T06:00:00Z"
POLL_MS = 100


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    import zimi.renderer as renderer

    if not renderer.browser_available():
        pytest.skip("playwright + chromium are not usable here")
    from http.server import ThreadingHTTPServer

    import zimi.server as srv
    from zimi.http import ZimHandler

    tmp = tmp_path_factory.mktemp("skyfind")
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
        yield br
        br.close()


def _almanac(browser, served, no_sensors=False):
    ctx = browser.new_context(
        viewport=VIEW,
        device_scale_factor=1,
        has_touch=True,
        is_mobile=True,
        service_workers="block",
    )
    ctx.add_init_script(
        "localStorage.setItem('zimi_almanac_place', %s);"
        % json.dumps(json.dumps(PLACE))
    )
    if no_sensors:
        ctx.add_init_script("window.DeviceOrientationEvent = undefined;")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(served + "/#almanac", wait_until="load")
    pg.wait_for_function(
        "() => typeof _skyState !== 'undefined' && _skyState && _skyState.eph",
        polling=POLL_MS,
        timeout=60000,
    )
    pg.evaluate("(iso) => _almScrubSettle(new Date(iso))", NIGHT)
    pg.wait_for_function(
        "(t) => _skyState.nowTime === t && !_skyState.moonAnim",
        arg=_ms(NIGHT),
        polling=POLL_MS,
        timeout=60000,
    )
    return ctx, pg, errors


def _ms(iso):
    from datetime import datetime

    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)


def _find(pg, query):
    pg.evaluate("() => document.querySelector('[data-sky-find]').click()")
    pg.wait_for_selector("#sf-input", timeout=60000)
    pg.fill("#sf-input", query)
    pg.wait_for_function(
        "() => document.querySelectorAll('#sf-list .sf-row').length > 0",
        polling=POLL_MS,
    )
    pg.keyboard.press("Enter")
    pg.wait_for_function("() => !document.getElementById('sf-sheet')", polling=POLL_MS)


def test_find_offers_what_is_up_and_leads_to_a_planet(browser, served):
    ctx, pg, errors = _almanac(browser, served)
    try:
        assert pg.query_selector("[data-sky-find]"), "the scene has a Find button"
        pg.evaluate("() => document.querySelector('[data-sky-find]').click()")
        pg.wait_for_selector("#sf-input", timeout=60000)
        pg.wait_for_function(
            "() => document.querySelectorAll('#sf-list .sf-row').length > 0",
            polling=POLL_MS,
        )
        offered = pg.evaluate(
            "() => [...document.querySelectorAll('#sf-list .sf-name')].map(e => e.textContent)"
        )
        assert "Saturn" in offered and "Moon" in offered, offered
        assert "Mars" not in offered, "Mars is under the horizon: not on offer"
        pg.keyboard.press("Escape")
        pg.wait_for_function("() => !document.getElementById('sf-sheet')")
        _find(pg, "saturn")
        assert pg.evaluate("() => _skyFind && _skyFind.id") == "planet:Saturn"
        chip = pg.inner_text("#sf-chip")
        assert "Saturn" in chip and "up" in chip, chip
        # The chart is turned to put it at the top: Saturn's bearing is 130.5 degrees.
        pg.wait_for_function(
            "() => Math.abs(_starChartRot - 130.47) < 1.5", polling=POLL_MS
        )
        # Clearing takes it all away.
        pg.evaluate("() => document.querySelector('[data-sf-clear]').click()")
        assert pg.evaluate("() => _skyFind") is None
        assert pg.query_selector("#sf-chip") is None
        assert pg.evaluate("() => _starChartRot") == 0
        assert not errors, errors
    finally:
        ctx.close()


def test_a_thing_under_the_horizon_turns_the_sky_under_it_on(browser, served):
    ctx, pg, errors = _almanac(browser, served)
    try:
        assert pg.evaluate("() => _skyBelowOn()") is False
        _find(pg, "mars")
        assert pg.evaluate("() => _skyFind.id") == "planet:Mars"
        assert pg.evaluate("() => _skyBelowOn()") is True
        assert "below the horizon" in pg.inner_text("#sf-chip")
        assert (
            json.loads(pg.evaluate("() => localStorage.getItem('zimi_sky_settings')"))[
                "below"
            ]
            == "on"
        ), "the choice is kept"
        pg.evaluate("() => document.querySelector('[data-sky-below]').click()")
        assert pg.evaluate("() => _skyBelowOn()") is False
        assert (
            pg.get_attribute("[data-sky-below]", "aria-pressed") == "false"
        ), "the button says so"
        assert not errors, errors
    finally:
        ctx.close()


def test_look_without_sensors_turns_to_what_is_found(browser, served):
    ctx, pg, errors = _almanac(browser, served, no_sensors=True)
    try:
        pg.evaluate("() => openAlmanacLook({ find: 'planet:Saturn' })")
        pg.wait_for_selector("#sf-look-chip", timeout=60000)
        pg.wait_for_function(
            "() => { const r = document.getElementById('look-read').textContent; return /SE/.test(r) && /\\+4[23]/.test(r); }",
            polling=POLL_MS,
            timeout=30000,
        )
        assert "In view" in pg.inner_text("#sf-look-chip")
        # Turn the view away by a finger's worth: the chip leads back with an arrow and degrees.
        pg.evaluate(
            "() => { _look.target = { az: 300, alt: 10, roll: 0 }; _lookKick(); }"
        )
        pg.wait_for_function(
            "() => /away/.test(document.getElementById('sf-look-chip').textContent)",
            polling=POLL_MS,
            timeout=30000,
        )
        assert pg.query_selector("#sf-arrow"), "an arrow when it is out of view"
        pg.evaluate(
            "() => document.querySelector('#sf-look-chip [data-sf-clear]').click()"
        )
        assert pg.query_selector("#sf-look-chip") is None
        assert not errors, errors
    finally:
        ctx.close()
