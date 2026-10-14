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
            3.9 < length + pg.evaluate("_spTrueStandoffAU('Jupiter')") < 6.6
        )
        assert pg.evaluate("_sp.jd") - jd0 == pytest.approx(
            trip["earthSec"] / 86400, abs=1e-8   # a Julian Day is a double near 2.46e6: good to 5e-10
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
# ── The review's findings, one test each ────────────────────────────────────

RESET = """() => {
  _spSelect(null); _sp.flight = null; _sp.glide = null; _sp.pendingFly = null; _sp.at = 'Earth';
  _sp.jd = _sp.openJd = _dateToJD(Date.now()); _sp.moved = false; _sp.layout = _sp.layoutTarget = 1;
  Object.assign(_sp.cam, { follow: 'Sun', dist: SP_OVERVIEW_DIST_AU, az: SP_START_AZIMUTH, el: SP_OVERVIEW_ELEVATION, lookYaw: 0, lookPitch: 0 });
  _sp.capQueue = []; _sp.caption = null; _sp.seen = {}; _sp.beta = 0.1; _sp.scaleMode = 'readable'; _sp.scaleCache = null; _sp.rateIdx = 0;
  _spRenderCaption(); _spShowGroup('planets'); _spSyncControls(); _sp.dirty = true; _spFrame();
}"""
STEP = "() => { _spStepGlide(1e6); _spStepLayout(1e6); _sp.dirty = true; _spFrame(); return !!_sp.flight; }"


@pytest.fixture(scope="module")
def space(browser, served):
    ctx, pg, seen, errors = _page(browser, served)
    _open(pg)
    pg.wait_for_function("() => !!_sp.gl.starsLoaded", timeout=60_000, polling=POLL_MS)
    yield pg, errors
    ctx.close()


def _card_lines(pg):
    return pg.evaluate("() => document.getElementById('sp-card').innerText")


def test_the_card_numbers_are_true_and_do_not_move_with_the_scale(space):
    pg, errors = space
    pg.evaluate(RESET)
    texts = {}
    for key, tab in (
        ("Moon", "moons"),
        ("Io", "moons"),
        ("Titan", "moons"),
        ("Jupiter", "planets"),
    ):
        for mode in ("readable", "true"):
            pg.evaluate(
                "(m) => { _sp.scaleMode = m; _sp.scaleCache = null; _spSyncControls(); }",
                mode,
            )
            pg.click('[data-sp-tab="%s"]' % tab)
            pg.click('[data-sp-key="%s"]' % key)
            texts[(key, mode)] = _card_lines(pg)
        # Distance, light time and the trip, whichever scale the moons are drawn at.
        assert texts[(key, "readable")] == texts[(key, "true")], (
            key,
            texts[(key, "readable")],
            texts[(key, "true")],
        )
    # The Moon is 1.3 light-seconds away, not the 52 the drawn x39 orbit would give.
    assert (
        "1.3 sec" in texts[("Moon", "readable")]
        and "52" not in texts[("Moon", "readable")]
    ), texts[("Moon", "readable")]
    assert not errors, errors


def test_now_is_offered_only_once_the_clock_has_moved_and_dates_are_utc(space):
    pg, errors = space
    pg.evaluate(RESET)
    pg.wait_for_timeout(3000)
    assert pg.evaluate("() => document.getElementById('sp-now').hidden") is True
    assert "UTC" in pg.evaluate("() => document.getElementById('sp-when').textContent")
    pg.evaluate("() => { _sp.jd += 2; _sp.moved = true; _spUpdateText(); }")
    assert pg.evaluate("() => document.getElementById('sp-now').hidden") is False
    pg.click("#sp-now")
    assert pg.evaluate("() => document.getElementById('sp-now').hidden") is True
    assert not errors, errors


def test_a_flight_to_a_probe_that_will_be_gone_is_refused_with_a_reason(space):
    pg, errors = space
    pg.evaluate(RESET)
    # Parker's table ends in a day; at 30 km/s Earth to Parker takes far longer than that.
    pg.evaluate(
        "() => { _sp.jd = _spTrack('parker').jd1 - 1; _sp.beta = SP_MIN_BETA; _sp.dirty = true; _spFrame(); }"
    )
    pg.click('[data-sp-tab="probes"]')
    pg.click('[data-sp-key="parker"]')
    assert pg.evaluate("() => document.getElementById('sp-fly').disabled") is True
    assert "gone before you get there" in _card_lines(pg)
    pg.evaluate("() => { _spLaunch('parker'); _spFrame(); }")
    assert pg.evaluate("() => !_sp.flight") is True
    pg.wait_for_timeout(500)  # frames keep coming without an error
    assert not errors, errors


def test_a_planet_does_not_grow_under_the_ship(space):
    pg, errors = space
    pg.evaluate(RESET)
    # The day Voyager 2 passed Neptune the planet is drawn true size; two days on, with it gone, x39.
    pg.evaluate(
        "() => { _sp.jd = _sp.openJd = Date.UTC(1989, 7, 25, 3, 56) / 86400000 + 2440587.5; _sp.dirty = true; _spFrame(); }"
    )
    pg.click('[data-sp-key="Neptune"]')
    pg.click("#sp-fly")
    assert pg.evaluate(STEP)
    before = pg.evaluate("() => _spShownRadius('Neptune', _spScaleNow())")
    pg.evaluate("() => { _spSkipFlight(); _spFrame(); }")
    after = pg.evaluate("() => _spShownRadius('Neptune', _spScaleNow())")
    assert before == after
    # And the camera stops outside the planet as drawn, not inside it.
    assert pg.evaluate("() => _sp.cam.dist") >= 1.5 * after
    assert not errors, errors


def test_the_overview_shows_the_whole_system_with_every_ring_apart(space):
    pg, errors = space
    pg.evaluate(RESET)
    out = pg.evaluate("""() => {
          const by = {}; _sp.items.forEach((i) => { by[i.key] = i; });
          const sun = by.Sun.scr, inside = (k) => by[k] && by[k].scr.x > 0 && by[k].scr.x < _sp.w && by[k].scr.y > 0 && by[k].scr.y < _sp.h;
          const ring = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'].map((k) => Math.hypot(by[k].scr.x - sun.x, by[k].scr.y - sun.y));
          return { inside: ['Sun', 'Neptune', 'Pluto', 'voyager1', 'voyager2', 'pioneer10', 'pioneer11', 'newhorizons'].filter((k) => by[k]).map((k) => [k, inside(k)]), ring, w: _sp.w };
        }""")
    assert all(ok for _, ok in out["inside"]), out["inside"]
    # Mercury to Mars are told apart: each a few pixels beyond the last (on a 390 px screen).
    assert all(b - a >= 3 for a, b in zip(out["ring"][:4], out["ring"][1:5])), out[
        "ring"
    ]
    assert out["w"] == 390
    assert not errors, errors


def test_choosing_something_out_of_view_shows_it_and_only_its_path_is_drawn(space):
    pg, errors = space
    pg.evaluate(RESET)
    assert (
        pg.evaluate(
            "() => Object.values(_sp.gl.trails).filter((t) => t.past.visible).length"
        )
        == 0
    )
    pg.click('[data-sp-tab="probes"]')
    pg.click('[data-sp-key="voyager1"]')
    pg.evaluate(STEP)
    assert pg.evaluate(
        "() => Object.entries(_sp.gl.trails).filter(([k, t]) => t.past.visible).map(([k]) => k)"
    ) == ["voyager1"]
    # Zoomed in on Jupiter, Voyager 1 is nowhere in view: choosing it goes back out to the whole system.
    pg.evaluate(
        "() => { _sp.layout = _sp.layoutTarget = 0; Object.assign(_sp.cam, { follow: 'Jupiter', dist: 0.05 }); _spSelect(null); _sp.dirty = true; _spFrame(); }"
    )
    pg.click('[data-sp-key="voyager1"]')
    assert pg.evaluate("() => _sp.layoutTarget") == 1
    pg.evaluate(STEP)
    assert pg.evaluate(
        "() => { const i = _sp.byKey.voyager1; return i.scr.x > 0 && i.scr.x < _sp.w && i.scr.y > 0 && i.scr.y < _sp.h; }"
    )
    assert not errors, errors


def test_a_tap_on_a_planet_is_the_planet_not_its_moon(space):
    pg, errors = space
    pg.evaluate(RESET)
    x, y = pg.evaluate("() => { const s = _sp.byKey.Saturn.scr; return [s.x, s.y]; }")
    pg.evaluate("([x, y]) => _spTapAt(x + 3, y + 2)", [x, y])
    assert pg.evaluate("() => _sp.selected") == "Saturn"
    assert not errors, errors


def test_the_light_effects_are_shown_in_turn_not_skipped(space):
    pg, errors = space
    pg.evaluate(RESET)
    _set_speed(pg, 0.99)
    pg.click('[data-sp-key="Neptune"]')
    pg.click("#sp-fly")
    assert pg.evaluate(STEP)
    shown = []
    pg.evaluate(
        "() => { const f = _sp.flight; f.p = 0.3; _spStepFlight(1); _spUpdateText(); }"
    )
    for _ in range(6):
        kind = pg.evaluate("() => _sp.caption && _sp.caption.kind")
        if not kind:
            break
        shown.append(kind)
        if kind == "colour":   # the last of the three stays up until the flight ends
            break
        pg.evaluate("() => { _sp.caption.until = 1; _spUpdateText(); }")
    assert shown == ["race", "stars", "colour"], shown
    pg.evaluate("() => { _spSkipFlight(); _spFrame(); }")
    assert pg.evaluate("() => _sp.caption && _sp.caption.kind") == "clocks"
    assert not errors, errors


def test_text_is_written_only_when_it_changes(space):
    pg, errors = space
    pg.evaluate(RESET)
    pg.click('[data-sp-key="Jupiter"]')
    pg.evaluate(
        "() => { window.__muts = 0; new MutationObserver((m) => { window.__muts += m.length; }).observe(document.getElementById('sp-view'), { subtree: true, childList: true, characterData: true }); }"
    )
    pg.evaluate(
        "() => { for (let i = 0; i < 30; i++) { _spUpdateText(); _spUpdateCardLines(); _spLabels(); } }"
    )
    assert pg.evaluate("window.__muts") == 0
    assert not errors, errors


def test_every_control_is_a_finger_wide(space):
    pg, errors = space
    pg.evaluate(RESET)
    small = pg.evaluate(
        """() => [...document.querySelectorAll('#sp-view button')].filter((b) => b.offsetParent && !b.hidden && b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 43)
                 .map((b) => [b.id || b.textContent.trim(), Math.round(b.getBoundingClientRect().height)])"""
    )
    assert small == [], small
    assert not errors, errors


def test_without_webgl_there_are_no_empty_pills_and_the_orrery_is_named(
    browser, served
):
    ctx, pg, seen, errors = _page(browser, served)
    try:
        pg.evaluate("() => { HTMLCanvasElement.prototype.getContext = () => null; }")
        pg.evaluate("_almOpenSpace()")
        pg.wait_for_function(
            "() => typeof _sp !== 'undefined' && _sp && document.getElementById('sp-msg').textContent.includes('orrery')",
            timeout=READY_MS,
            polling=250,
        )
        assert (
            pg.evaluate(
                "() => getComputedStyle(document.querySelector('#sp-view .ae-tools')).display"
            )
            == "none"
        )
        assert not errors, errors
    finally:
        ctx.close()


def test_the_russian_speed_unit_is_russian_and_the_date_is_one_line(browser, served):
    ctx = browser.new_context(
        viewport=VIEW,
        device_scale_factor=2,
        has_touch=True,
        is_mobile=True,
        service_workers="block",
        locale="ru-RU",
    )
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    try:
        pg.goto(served + "/#almanac", wait_until="load")
        pg.wait_for_function(ON_PAGE, timeout=60_000, polling=POLL_MS)
        _open(pg)
        unit = pg.evaluate("() => document.getElementById('sp-speedout').textContent")
        assert "км" in unit and "km/s" not in unit, unit
        assert (
            pg.evaluate(
                "() => document.getElementById('sp-when').getBoundingClientRect().height"
            )
            < 20
        )  # one line
        assert not errors, errors
    finally:
        ctx.close()
