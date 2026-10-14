"""The flown solar system (zimi/static/almanac-space.js) in a real browser.

On the shipped files, served by Zimi, in headless Chromium (software GL) at a
phone's width:

  1. Nothing on the Almanac's own path: opening the Almanac asks for neither
     the module, the probe table, nor a single planet map.
  2. The view opens on its own pill and draws the whole system; a parked,
     still view asks for no frames.
  3. A flight to Jupiter at 0.5c ends there, and the clocks it ends with are
     the physics: the Earth clock is the trip at that speed with the ramps
     counted, the ship's is less, and nothing arrives faster than light.
  4. At 0.9c half of the stars crowd into the 26 degrees round the heading, and
     the ones ahead are bluer than the ones behind.
  5. Under reduced motion the flight arrives at once.
  6. Closing gives the GPU back: the context is lost, the canvas is a fresh
     one, and the Almanac is as it was.

The numbers themselves are held to Horizons in tests/test_almanac_space.cjs.

Run: pytest tests/test_almanac_space_browser.py -v
"""

import math
import os
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

GL_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
VIEW = {"width": 390, "height": 844}
POLL_MS = 100
READY_MS = 240_000  # software GL spends about a minute on its first context
LIGHT_SECONDS_PER_AU = 499.00478384
RAMP_FRACTION = 0.05

ON_PAGE = "() => !!document.getElementById('almanac-orrery') && typeof _almOpenSpace === 'function' && typeof _aeLoadThree === 'function'"
READY = "() => typeof _sp !== 'undefined' && !!_sp && !!_sp.gl && document.getElementById('sp-msg').hidden"


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    import zimi.renderer as renderer

    if not renderer.browser_available():
        pytest.skip("playwright + chromium are not usable here")
    from http.server import ThreadingHTTPServer

    import zimi.server as srv
    from zimi.http import ZimHandler

    tmp = tmp_path_factory.mktemp("space")
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
        # The first WebGL context of a software renderer takes a minute: pay it here, once.
        warm = br.new_page()
        warm.goto("about:blank")
        warm.evaluate("document.createElement('canvas').getContext('webgl2')")
        warm.close()
        yield br
        br.close()


def _page(browser, served, **opts):
    ctx = browser.new_context(
        viewport=VIEW,
        device_scale_factor=2,
        has_touch=True,
        is_mobile=True,
        service_workers="block",
        locale="en-US",
        **opts,
    )
    pg = ctx.new_page()
    seen, errors = [], []
    pg.on("request", lambda r: seen.append(r.url))
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(served + "/#almanac", wait_until="load")
    pg.wait_for_function(ON_PAGE, timeout=60_000, polling=POLL_MS)
    return ctx, pg, seen, errors


def _open(pg):
    pg.evaluate("_almOpenSpace()")
    pg.wait_for_function(READY, timeout=READY_MS, polling=250)


def _set_speed(pg, beta):
    return pg.evaluate(
        "(b) => { const s = document.getElementById('sp-slider'); s.value = String(_spBetaToSlider(b));"
        " s.dispatchEvent(new Event('input', { bubbles: true })); return _sp.beta; }",
        beta,
    )


def _launch(pg, key):
    """Select a body, press Fly there, and finish the camera's turn to the launch pose (not the flight)."""
    pg.click('[data-sp-key="%s"]' % key)
    pg.click("#sp-fly")
    return pg.evaluate("() => { _spStepGlide(1e6); _spFrame(); return !!_sp.flight; }")


def test_nothing_loads_until_the_pill_is_pressed(browser, served):
    ctx, pg, seen, errors = _page(browser, served)
    try:
        assert not [
            u
            for u in seen
            if "almanac-space" in u
            or "space-tracks" in u
            or "-v1.webp" in u
            and "earth-" not in u
            and "moon" not in u
        ], seen
        _open(pg)
        assert any("almanac-space.js" in u for u in seen)
        assert any("space-tracks-v1.json" in u for u in seen)
        assert not errors, errors
    finally:
        ctx.close()


def test_a_parked_view_asks_for_no_frames(browser, served):
    ctx, pg, seen, errors = _page(browser, served)
    try:
        _open(pg)
        # The maps and stars land and are drawn; then nothing is pending.
        pg.wait_for_function(
            "() => _sp.gl.starsLoaded && Object.values(_sp.gl.items).every((it) => !it.mesh || it.uni.uHasMap.value || !(it.body.map || it.body.proc))"
            " && !_sp.raf && !_sp.dirty",
            timeout=120_000,
            polling=250,
        )
        pg.evaluate(
            "() => { window.__raf = 0; window.__who = []; const o = window.requestAnimationFrame.bind(window);"
            " window.requestAnimationFrame = (f) => { window.__raf++; window.__who.push(String(f).slice(0, 90)); return o(f); }; }"
        )
        pg.wait_for_timeout(4000)
        assert pg.evaluate("window.__raf") == 0, pg.evaluate("window.__who")
        assert pg.evaluate(
            "() => document.getElementById('sp-view').classList.contains('open')"
        )
        assert not errors, errors
    finally:
        ctx.close()


def test_a_flight_ends_at_its_body_with_the_physics_clocks(browser, served):
    ctx, pg, seen, errors = _page(browser, served)
    try:
        _open(pg)
        assert _set_speed(pg, 0.5) == pytest.approx(0.5, abs=0.005)
        assert _launch(
            pg, "Jupiter"
        ), "the flight did not begin after the camera's turn"
        beta = pg.evaluate("_sp.flight.beta")
        length = pg.evaluate("_sp.flight.len")
        jd0 = pg.evaluate("_sp.flight.jd0")
        pg.evaluate("() => { _spSkipFlight(); _spFrame(); }")
        trip = pg.evaluate("_sp.lastTrip")
        assert pg.evaluate("_sp.flight") is None
        assert (
            pg.evaluate("_sp.at") == "Jupiter"
            and pg.evaluate("_sp.cam.follow") == "Jupiter"
        )
        light = length * LIGHT_SECONDS_PER_AU
        # The Earth clock is the way over the speed, the two ramps counted: 1 + 2R of the cruise time.
        assert trip["earthSec"] == pytest.approx(
            light / beta * (1 + 2 * RAMP_FRACTION), rel=1e-6
        )
        assert trip["earthSec"] > light  # nothing arrives faster than light
        assert trip["shipSec"] < trip["earthSec"]
        assert 0.5 < trip["shipSec"] / trip["earthSec"] < 0.95
        # Earth to Jupiter (a little less than the orbit's reach) is 3.9 to 6.5 AU at any date.
        assert (
            3.9 < length + pg.evaluate("_sp.flight ? 0 : _spStandoff('Jupiter')") < 6.6
        )
        assert pg.evaluate("_sp.jd") - jd0 == pytest.approx(
            trip["earthSec"] / 86400, rel=1e-9
        )
        assert not errors, errors
    finally:
        ctx.close()


def test_at_nine_tenths_light_speed_the_stars_crowd_ahead(browser, served):
    ctx, pg, seen, errors = _page(browser, served)
    try:
        _open(pg)
        pg.wait_for_function(
            "() => !!_sp.gl.starsLoaded", timeout=60_000, polling=POLL_MS
        )
        _set_speed(pg, 0.9)
        assert _launch(pg, "Neptune")
        # Mid-cruise, as the ship sees them: the fraction of stars within acos(beta) of the heading, and their colour.
        out = pg.evaluate("""() => {
          const f = _sp.flight; f.p = 0.5; _spStepFlight(1); _spFrame();
          const S = _sp.gl, a = S.stars.geometry.attributes, n = S.starData.n, h = f.heading;
          let near = 0, ahead = 0, behind = 0, aheadBlue = 0, behindRed = 0;
          for (let i = 0; i < n; i++) {
            const x = a.position.array[i * 3], y = a.position.array[i * 3 + 1], z = a.position.array[i * 3 + 2], l = Math.hypot(x, y, z);
            const c = (x * h[0] + y * h[1] + z * h[2]) / l;
            const r = a.aColor.array[i * 3], b = a.aColor.array[i * 3 + 2];
            if (c >= f.beta) { near++; ahead++; if (b > r) aheadBlue++; }
            if (c <= -f.beta) { behind++; if (r > b) behindRed++; }
          }
          return { n, near, aheadBlue, ahead, behind, behindRed, beta: f.now.beta, want: f.beta };
        }""")
        assert out["beta"] == pytest.approx(out["want"], abs=1e-6)  # cruising
        assert out["near"] / out["n"] == pytest.approx(
            0.5, abs=0.06
        )  # half the sky within acos(0.9) = 26 degrees
        assert out["aheadBlue"] / out["ahead"] > 0.9
        assert out["behind"] == 0 or out["behindRed"] / out["behind"] > 0.9
        assert not errors, errors
    finally:
        ctx.close()


def test_reduced_motion_arrives_at_once(browser, served):
    ctx, pg, seen, errors = _page(browser, served, reduced_motion="reduce")
    try:
        _open(pg)
        pg.click('[data-sp-key="Saturn"]')
        pg.click("#sp-fly")
        assert pg.evaluate(
            "() => !_sp.flight && _sp.at === 'Saturn' && !_sp.glide && !_sp.pendingFly"
        )
        assert not errors, errors
    finally:
        ctx.close()


def test_closing_gives_the_gpu_back(browser, served):
    ctx, pg, seen, errors = _page(browser, served)
    try:
        _open(pg)
        pg.evaluate("() => { window.__old = document.getElementById('sp-canvas'); }")
        pg.click("#sp-back")
        assert pg.evaluate("() => _sp.gl === null && !_spIsOpen")
        assert pg.evaluate(
            "() => window.__old.getContext('webgl2') === null || window.__old.getContext('webgl2').isContextLost()"
        )
        assert pg.evaluate(
            "() => document.getElementById('sp-canvas') !== window.__old"
        )
        assert not pg.evaluate(
            "() => document.getElementById('sp-view').classList.contains('open')"
        )
        assert not pg.evaluate(
            "() => document.getElementById('almanac-view').classList.contains('ae-covered')"
        )
        # Open again: the page draws from scratch on the fresh canvas.
        _open(pg)
        assert pg.evaluate("() => !!_sp.gl")
        assert not errors, errors
    finally:
        ctx.close()


def test_the_speed_slider_goes_by_rapidity_not_a_sliver():
    """The last tenth of the slider is not squeezed into 0.9c-0.99c (pure maths, no browser)."""
    atanh = math.atanh
    lo, hi = atanh(1e-4), atanh(0.99)
    u_09 = math.log(atanh(0.9) / lo) / math.log(hi / lo)
    assert 0.9 < u_09 < 0.95
