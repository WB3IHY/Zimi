"""The Moon landing, in a real browser: the Almanac's hero is the live scene.

Open the Almanac and the Moon in the hero is the real one, in the live solar
system (zimi/static/almanac-landing.js), and a sideways drag pulls the camera
back through that scene along one axis of distance. Checked here on the
shipped files, served by Zimi, in headless Chromium (SwiftShader) on a 390 px
phone:

  1. The swap is invisible: the hero as the page paints it with the live scene
     in place, against the same hero as the picture it replaces, at three
     focus dates. The mean absolute difference must be under 3.5 of 255 AND
     under what moving the disc by one device pixel costs the same picture
     (what remains is texture filtering and the limb's antialiasing).
  2. Nothing is on the critical path: the first hero is the picture, and no
     three.js, no Earth view and no landing came before it.
  3. With WebGL off, nothing changes: the picture stays, with no canvas in the
     hero and no way to pull back.
  4. A sideways drag pulls back: the view opens on the axis, the stops are on
     a track with their true distances, a release near a stop settles on it,
     the picture's own vertical swipe is left to the page, and the Moon is
     always the way back.
  5. To scale or laid out: "Not to scale" is said, in words, where the planets
     have lost their size (laid out) and where the Earth and Moon are drawn
     larger to be read (the pair), and not at the Moon.
  6. The cause of the phase: the Sun's rays and a phase disc at the pair, and
     a drag on the Moon's line turns the date.
  7. Red night light: nothing in the view is lit but red.
  8. Reduced motion snaps to a stop rather than flying; at rest nothing draws.

Run: pytest tests/test_moon_landing_live.py -v
(ZIMI_SHOT_DIR=<dir> keeps the screenshots there.)
"""

import io
import math
import os
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

GL_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
VIEW = {"width": 390, "height": 844}
DPR = 2
MAD_MAX = 3.5
DATES = ["2026-10-14T03:00:00Z", "2026-10-03T12:00:00Z", "2026-09-25T12:00:00Z"]
HERO = "#almanac-head .almanac-moon-open"
POLL_MS = 100
# Waits poll on a timer: a page with nothing moving may not ask for frames.


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    import zimi.renderer as renderer

    if not renderer.browser_available():
        pytest.skip("playwright + chromium are not usable here")
    try:
        import numpy  # noqa: F401
        from PIL import Image  # noqa: F401
    except ImportError:
        pytest.skip("numpy and Pillow compare the pictures")
    from http.server import ThreadingHTTPServer

    import zimi.server as srv
    from zimi.http import ZimHandler

    tmp = tmp_path_factory.mktemp("landing")
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
def pw(served):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        yield p


@pytest.fixture(scope="module")
def browser(pw):
    br = pw.chromium.launch(args=GL_ARGS)
    yield br
    br.close()


@pytest.fixture
def shots(tmp_path):
    d = os.environ.get("ZIMI_SHOT_DIR") or str(tmp_path)
    os.makedirs(d, exist_ok=True)
    return d


def _almanac(browser, served, reduced=False, init=None, red=False, wait_live=True):
    ctx = browser.new_context(
        viewport=VIEW,
        device_scale_factor=DPR,
        color_scheme="dark",
        reduced_motion="reduce" if reduced else "no-preference",
    )
    if init:
        ctx.add_init_script(init)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(served + "/#almanac", wait_until="load")
    if red:
        pg.evaluate("() => document.documentElement.classList.add('night-red')")
    if wait_live:
        _wait_live(pg)
    return ctx, pg, errors


def _wait_live(pg):
    pg.wait_for_function(
        "() => !!document.querySelector('#almanac-view.lp-live') && !!_MOON_TEX_HI &&"
        " _ae.gl.moonUni.moonMap.value && _ae.gl.moonUni.moonMap.value.image.width === 4096",
        timeout=90000,
        polling=POLL_MS,
    )
    pg.wait_for_timeout(300)


def _settle(pg, iso):
    pg.evaluate("(iso) => _almScrubSettle(new Date(iso))", iso)
    pg.wait_for_function("() => !_heroMoonOverlay", timeout=20000, polling=POLL_MS)
    # The hero's picture is the resting one, and the live scene has been drawn over it.
    pg.wait_for_function(
        """() => { var img = document.querySelector('#almanac-head .almanac-moon-sprite');
      return img && img.getAttribute('src') === _renderMoonSprite(_heroMoonView(_almFocusInstant(), _getLocation()), 200)
        && !!document.querySelector('#almanac-view.lp-live') && !!document.querySelector('#almanac-head .lp-in-hero'); }""",
        timeout=20000,
        polling=POLL_MS,
    )
    pg.wait_for_timeout(400)


def _rect(pg, sel=HERO):
    return pg.evaluate(
        "(s) => { var r = document.querySelector(s).getBoundingClientRect();"
        " return { x: r.x, y: r.y, width: r.width, height: r.height }; }",
        sel,
    )


def _png(data):
    from PIL import Image

    return Image.open(io.BytesIO(data)).convert("RGB")


def _mad(a, b):
    import numpy as np

    return float(np.abs(np.asarray(a, dtype=float) - np.asarray(b, dtype=float)).mean())


def _drag(pg, dx, dy=0, steps=10, hold=False):
    """A finger on the hero, moved by (dx, dy); released unless held."""
    r = _rect(pg)
    x, y = r["x"] + r["width"] / 2, r["y"] + r["height"] / 2
    pg.mouse.move(x, y)
    pg.mouse.down()
    pg.mouse.move(x + dx, y + dy, steps=steps)
    if not hold:
        pg.mouse.up()
    return x + dx, y + dy


def _axis(pg):
    return pg.evaluate("() => _ae.axis ? _ae.axis.u : null")


# ── 1. The swap is invisible ──
# The Moon alone at rest is the picture's twin, pixel for pixel.
@pytest.mark.parametrize("iso", DATES)
def test_the_live_scene_is_the_picture(browser, served, shots, iso):
    ctx, pg, errors = _almanac(browser, served)
    _swap_is_invisible(ctx, pg, errors, shots, iso, "landing")


def test_the_live_scene_is_the_picture_on_an_iphone(browser, pw, served, shots):
    # Playwright's own iPhone 15: 393 px wide, three device pixels to a CSS one, touch, a phone's user agent.
    ctx = browser.new_context(**pw.devices["iPhone 15"], color_scheme="dark")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(served + "/#almanac", wait_until="load")
    _wait_live(pg)
    _swap_is_invisible(ctx, pg, errors, shots, DATES[1], "iphone15")


def _swap_is_invisible(ctx, pg, errors, shots, iso, name):
    from PIL import Image, ImageChops

    try:
        _settle(pg, iso)
        clip = _rect(pg)
        live = _png(pg.screenshot(clip=clip))
        # The same hero as the picture: the live scene let go of it (its watchers off, its canvas home).
        pg.evaluate("() => _lpRelease()")
        pg.wait_for_timeout(200)
        flat = _png(pg.screenshot(clip=clip))
        tag = iso[:13].replace(":", "")
        flat.save(os.path.join(shots, "%s-%s-picture.png" % (name, tag)))
        live.save(os.path.join(shots, "%s-%s-live.png" % (name, tag)))
        diff = ImageChops.difference(flat, live).point(lambda v: min(255, v * 4))
        diff.save(os.path.join(shots, "%s-%s-diff.png" % (name, tag)))
        mad = _mad(flat, live)
        moved = flat.transform(
            flat.size, Image.AFFINE, (1, 0, 1, 0, 1, 0), resample=Image.BILINEAR
        )
        pixel = _mad(flat, moved)
        print("%s: MAD %.2f, one device pixel's shift %.2f" % (iso, mad, pixel))
        assert mad < MAD_MAX and mad < pixel, (iso, mad, pixel)
        assert not errors, errors
    finally:
        ctx.close()


def test_the_live_scene_follows_the_clock_and_the_picture(browser, served):
    ctx, pg, errors = _almanac(browser, served)
    try:
        _settle(pg, "2026-10-14T03:00:00Z")
        assert pg.evaluate("() => _lpState.drawnMs === _almFocusInstant().getTime()")
        # While the time machine's sweep shows, the picture's own sweep is what is on screen: the scene is not drawn over it.
        pg.evaluate("() => _almScrubSettle(new Date('2026-10-03T12:00:00Z'))")
        assert pg.evaluate(
            "() => !!_heroMoonOverlay && !document.querySelector('#almanac-view.lp-live')"
        )
        # And when it has ended the scene is back, for the instant the page is at.
        pg.wait_for_function(
            "() => !_heroMoonOverlay && !!document.querySelector('#almanac-view.lp-live')",
            timeout=20000,
            polling=POLL_MS,
        )
        assert pg.evaluate(
            "() => _lpState.drawnMs === Date.parse('2026-10-03T12:00:00Z')"
        )
        # Back to now: the scene is drawn for the page's instant again.
        pg.evaluate("() => _almBackToToday()")
        pg.wait_for_function(
            "() => !_heroMoonOverlay && !!document.querySelector('#almanac-view.lp-live')",
            timeout=20000,
            polling=POLL_MS,
        )
        pg.wait_for_timeout(300)
        assert pg.evaluate("() => Math.abs(_lpState.drawnMs - Date.now()) < 5 * 60000")
        assert not errors, errors
    finally:
        ctx.close()


# ── 2. Nothing on the critical path ──
def test_the_first_hero_is_the_picture(browser, served):
    ctx = browser.new_context(
        viewport=VIEW, device_scale_factor=DPR, color_scheme="dark"
    )
    ctx.add_init_script("""(() => {
      window.__first = null;
      new MutationObserver(() => {
        if (window.__first) return;
        const img = document.querySelector('#almanac-head .almanac-moon-sprite');
        if (img) window.__first = { names: performance.getEntriesByType('resource').map(e => e.name),
          canvas: !!document.querySelector('#almanac-head canvas'), live: !!document.querySelector('.lp-live') };
      }).observe(document, { childList: true, subtree: true });
    })()""")
    pg = ctx.new_page()
    try:
        pg.goto(served + "/#almanac", wait_until="load")
        pg.wait_for_function("() => !!window.__first", timeout=30000, polling=POLL_MS)
        first = pg.evaluate("() => window.__first")
        assert not first["canvas"] and not first["live"], first
        late = [
            n
            for n in first["names"]
            if "three-r" in n
            or "almanac-earth" in n
            or "almanac-landing" in n
            or "almanac-ephem" in n
        ]
        assert not late, late
        # And it comes, once the page is idle.
        _wait_live(pg)
    finally:
        ctx.close()


# ── 3. With WebGL off ──
def test_without_webgl_nothing_changes(browser, served):
    ctx = browser.new_context(
        viewport=VIEW, device_scale_factor=DPR, color_scheme="dark"
    )
    ctx.add_init_script(
        "(() => { const o = HTMLCanvasElement.prototype.getContext;"
        " HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : o.call(this, t, ...a); }; })()"
    )
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    try:
        pg.goto(served + "/#almanac", wait_until="load")
        pg.wait_for_function(
            "() => typeof _aePrepare === 'function'", timeout=30000, polling=POLL_MS
        )
        assert pg.evaluate("() => _aePrepare()") is False
        pg.wait_for_timeout(800)
        assert pg.evaluate(
            "() => !document.querySelector('.lp-in-hero') && !document.querySelector('#almanac-view.lp-live')"
        )
        assert pg.evaluate(
            "() => !!document.querySelector('#almanac-head .almanac-moon-sprite') && document.querySelector('#almanac-head .almanac-moon-sprite').offsetWidth === 200"
        )
        assert pg.evaluate("() => !document.getElementById('lp-track')")
        # No hand to say it can be taken: the disc has no grab cursor.
        assert (
            pg.evaluate(
                "(s) => getComputedStyle(document.querySelector(s)).cursor", HERO
            )
            == "default"
        )

        assert not errs, errs
    finally:
        ctx.close()


# ── 4. A sideways drag pulls back ──
def test_a_drag_pulls_back_through_the_stops(browser, served, shots):
    ctx, pg, errors = _almanac(browser, served)
    try:
        _settle(pg, "2026-10-14T03:00:00Z")
        _drag(pg, -150, 0, hold=True)
        pg.wait_for_function(
            "() => _aeIsOpen && _ae.axis && !_ae.hand", timeout=15000, polling=POLL_MS
        )
        assert (_axis(pg) or 0) > 0.5, "the drag pulls the camera back"
        pg.mouse.up()
        pg.wait_for_function("() => !_ae.axis.fly", timeout=15000, polling=POLL_MS)
        # Released near a stop it settles on it; between stops it stays.
        u = _axis(pg)
        assert abs(u - round(u)) < 1e-6 or 0.3 < abs(u - round(u)), u
        assert pg.evaluate(
            "() => !!document.getElementById('lp-track') && getComputedStyle(document.getElementById('lp-track')).display !== 'none'"
        )
        # The track names every stop; the Moon's is always there, and the nearest says how far.
        names = pg.evaluate(
            "() => Array.from(document.querySelectorAll('#lp-track .lp-tick b')).map(e => e.textContent)"
        )
        assert names == [
            "Moon",
            "Earth and Moon",
            "Earth",
            "Inner planets",
            "Neptune",
        ], names
        # Fly to each stop by its tick: the distance is true, in km and in light.
        want = {
            0: "To the Moon",
            1: "To the Moon",
            2: "To the Sun",
            3: "To Mars",
            4: "To Neptune",
        }
        for i in range(5):
            pg.click("#lp-track .lp-tick[data-lp-stop='%d']" % i)
            pg.wait_for_function(
                "(i) => !_ae.axis.fly && Math.abs(_ae.axis.u - i) < 1e-6",
                arg=i,
                timeout=15000,
                polling=POLL_MS,
            )
            pg.wait_for_timeout(250)
            text = pg.evaluate(
                "() => document.querySelector('#lp-track .lp-tick.lp-on .lp-tick-text i').textContent"
            )
            assert text.startswith(want[i]) and " km" in text and "by light" in text, (
                i,
                text,
            )
            pg.screenshot(path=os.path.join(shots, "landing-stop-%d.png" % i))
        # And the Moon is the way back.
        pg.click("#lp-track .lp-tick[data-lp-stop='0']")
        pg.wait_for_function(
            "() => !_ae.axis.fly && _ae.axis.u === 0", timeout=15000, polling=POLL_MS
        )
        assert not errors, errors
    finally:
        ctx.close()


def _touch(ctx, pg, points):
    """A finger's path through CDP touch events: [(x, y), ...], down at the first, up at the last."""
    cdp = ctx.new_cdp_session(pg)
    cdp.send(
        "Input.dispatchTouchEvent",
        {"type": "touchStart", "touchPoints": [{"x": points[0][0], "y": points[0][1]}]},
    )
    for x, y in points[1:]:
        cdp.send(
            "Input.dispatchTouchEvent",
            {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]},
        )
        pg.wait_for_timeout(16)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def test_a_drag_before_the_scene_is_ready_is_played_when_it_is(browser, served):
    ctx = browser.new_context(
        viewport=VIEW, device_scale_factor=DPR, color_scheme="dark"
    )
    held = []
    ctx.route("**/three-r186.min.js", lambda route: held.append(route))
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    try:
        pg.goto(served + "/#almanac", wait_until="load")
        pg.wait_for_function(
            "() => !!document.querySelector('.almanac-moon-sprite') && typeof _aeReady === 'function'",
            timeout=30000,
            polling=POLL_MS,
        )
        # The scene is made ready when the page is idle (a few seconds at most): it is waiting for three.js.
        for _ in range(300):
            if held:
                break
            pg.wait_for_timeout(100)
        assert held, "the scene is waiting for three.js"
        _drag(pg, -150, 0)
        pg.wait_for_timeout(500)
        assert pg.evaluate(
            "() => !_aeIsOpen && !_ae.axis"
        ), "nothing opens before the scene is ready"
        assert pg.evaluate(
            "() => !!document.querySelector('.alm-moon-waking')"
        ), "the disc says it is waking"
        for route in held:
            route.continue_()
        # Ready: the view opens on the axis, and the travel the finger made is already in it.
        pg.wait_for_function(
            "() => _aeIsOpen && _ae.axis && !_ae.hand", timeout=60000, polling=POLL_MS
        )
        assert (_axis(pg) or 0) > 0.5, _axis(pg)
        assert not errors, errors
    finally:
        ctx.close()


def test_a_touch_drag_pulls_back_and_a_vertical_swipe_is_the_pages(browser, served):
    ctx = browser.new_context(
        viewport=VIEW,
        device_scale_factor=DPR,
        color_scheme="dark",
        has_touch=True,
        is_mobile=True,
    )
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    try:
        pg.goto(served + "/#almanac", wait_until="load")
        _wait_live(pg)
        r = _rect(pg)
        x, y = r["x"] + r["width"] / 2, r["y"] + r["height"] / 2
        assert (
            pg.evaluate(
                "(s) => getComputedStyle(document.querySelector(s)).touchAction", HERO
            )
            == "pan-y"
        )
        # Mostly vertical: the page's scroll. The Moon is not lifted.
        _touch(ctx, pg, [(x, y)] + [(x + 2, y - 8 * k) for k in range(1, 9)])
        pg.wait_for_timeout(500)
        assert pg.evaluate("() => !_aeIsOpen && !_ae.axis")
        # Sideways: the Moon is lifted and the camera pulls back along the finger.
        _touch(ctx, pg, [(x, y)] + [(x - 12 * k, y + 1) for k in range(1, 13)])
        pg.wait_for_function(
            "() => _aeIsOpen && _ae.axis", timeout=15000, polling=POLL_MS
        )
        pg.wait_for_timeout(500)
        assert (_axis(pg) or 0) > 0.3, _axis(pg)
        assert not errors, errors
    finally:
        ctx.close()


def test_the_axis_is_only_for_the_hero_drag(browser, served):
    ctx, pg, errors = _almanac(browser, served)
    try:
        # From the orrery (not the hero) the view is the classic one: no axis, the old buttons.
        pg.evaluate("() => openAlmanacEarth({ target: 'earth' })")
        pg.wait_for_function("() => _aeIsOpen", timeout=15000, polling=POLL_MS)
        assert pg.evaluate(
            "() => !_ae.axis && !document.querySelector('.ae-view.lp-axis')"
        )
        pg.click("#ae-views [data-ae-view='axis']")
        pg.wait_for_function(
            "() => _ae.axis && !_ae.axis.fly && _ae.axis.u === 2",
            timeout=15000,
            polling=POLL_MS,
        )
        # A tap on the Earth hands over to the Earth view (its own chips come back, the axis's marks go).
        pg.evaluate("() => _lpFlyTo(1, 1)")
        pg.wait_for_function(
            "() => !_ae.axis.fly && _ae.axis.u === 1", timeout=15000, polling=POLL_MS
        )
        pg.wait_for_timeout(300)
        at = pg.evaluate(
            "() => { const r = document.getElementById('ae-canvas').getBoundingClientRect(), e = _aeProject([0, 0, 0]);"
            " return { x: e.x + r.left, y: e.y + r.top }; }"
        )
        pg.mouse.click(at["x"], at["y"])
        pg.wait_for_function("() => !_ae.axis", timeout=15000, polling=POLL_MS)
        assert pg.evaluate(
            "() => _ae.target === 'earth' && !document.querySelector('.ae-view.lp-axis')"
            " && Array.from(document.querySelectorAll('[id^=lp-lbl-]')).every(e => e.hidden)"
        )
        # And the Solar System chip brings the axis back.
        pg.click("#ae-views [data-ae-view='axis']")
        pg.wait_for_function(
            "() => _ae.axis && !_ae.axis.fly && _ae.axis.u === 2",
            timeout=15000,
            polling=POLL_MS,
        )
        assert not errors, errors
    finally:
        ctx.close()


# ── 5. To scale, or laid out ──
def test_not_to_scale_is_said_where_it_is_true(browser, served):
    ctx, pg, errors = _almanac(browser, served)
    try:
        _settle(pg, "2026-10-14T03:00:00Z")
        _drag(pg, -40, 0)
        pg.wait_for_function(
            "() => _aeIsOpen && _ae.axis", timeout=15000, polling=POLL_MS
        )
        # At the Moon everything is true. At the pair the Earth and the Moon are drawn larger (the Moon is under a
        # pixel across at true size) though the layout is true; from the Earth stop out the layout is not.
        for i, said, laid in (
            (0, False, 0),
            (1, True, 0),
            (2, True, 1),
            (3, True, 1),
            (4, True, 1),
        ):
            pg.evaluate("(i) => _lpFlyTo(i, 1)", i)
            pg.wait_for_function(
                "(i) => !_ae.axis.fly && _ae.axis.u === i",
                arg=i,
                timeout=15000,
                polling=POLL_MS,
            )
            pg.wait_for_timeout(300)
            text = pg.evaluate("() => document.getElementById('lp-scale').textContent")
            shown = pg.evaluate(
                "() => document.getElementById('lp-scale').classList.contains('lp-show')"
            )
            assert shown is said and (text == "Not to scale") is said, (i, text, shown)
            assert round(pg.evaluate("() => _lpState.ax.lam")) == laid, (i, laid)
        assert not errors, errors
    finally:
        ctx.close()


# ── 6. The cause of the phase ──
def test_the_pair_shows_the_sun_and_a_drag_on_the_moon_turns_the_date(
    browser, served, shots
):
    ctx, pg, errors = _almanac(browser, served)
    try:
        _settle(pg, "2026-10-14T03:00:00Z")
        _drag(pg, -40, 0)
        pg.wait_for_function(
            "() => _aeIsOpen && _ae.axis && !_ae.hand", timeout=15000, polling=POLL_MS
        )
        pg.evaluate("() => _lpFlyTo(1, 1)")
        pg.wait_for_function(
            "() => !_ae.axis.fly && _ae.axis.u === 1", timeout=15000, polling=POLL_MS
        )
        pg.wait_for_timeout(400)
        assert pg.evaluate(
            "() => _ae.gl.solar.rays.visible && !!_lpState.places && !!_lpState.places.Ray"
        )
        assert pg.evaluate(
            "() => document.getElementById('lp-phase').classList.contains('lp-show')"
        )
        phase = pg.evaluate(
            "() => document.getElementById('lp-phase-text').textContent"
        )
        pg.screenshot(path=os.path.join(shots, "landing-pair.png"))
        # Grab the Moon and carry it a quarter of the way round the Earth.
        # The view stands below the page's header: its canvas coordinates are not the page's.
        pos = pg.evaluate(
            "() => { const r = document.getElementById('ae-canvas').getBoundingClientRect(), m = _aeProject(_ae.scene.moon), e = _aeProject([0, 0, 0]);"
            " return { moon: { x: m.x + r.left, y: m.y + r.top }, earth: { x: e.x + r.left, y: e.y + r.top }, top: r.top }; }"
        )
        assert (
            pos["top"] > 0
        ), "the view is under the header, so the two coordinate systems differ"
        m, e = pos["moon"], pos["earth"]
        import math

        r = math.hypot(m["x"] - e["x"], m["y"] - e["y"])
        a0 = math.atan2(m["y"] - e["y"], m["x"] - e["x"])
        before = pg.evaluate("() => _almFocusInstant().getTime()")
        pg.mouse.move(m["x"], m["y"])
        pg.mouse.down()
        for k in range(1, 13):
            a = (
                a0 - k * (math.pi / 2) / 12
            )  # against the clock hands on the screen: forward in time
            pg.mouse.move(e["x"] + r * math.cos(a), e["y"] + r * math.sin(a))
        pg.mouse.up()
        pg.wait_for_timeout(400)
        after = pg.evaluate("() => _almFocusInstant().getTime()")
        days = (after - before) / 86400000
        print("a quarter turn moved the date by %.1f days" % days)
        assert 5 < days < 9, days
        assert (
            pg.evaluate("() => document.getElementById('lp-phase-text').textContent")
            != phase
        )
        assert not errors, errors
    finally:
        ctx.close()


# ── 7. Red night light ──
def test_in_red_nothing_is_lit_but_red(browser, served, shots):
    import numpy as np

    ctx, pg, errors = _almanac(browser, served, red=True)
    try:
        _settle(pg, "2026-10-14T03:00:00Z")
        # The landing in Red is the picture in Red: the swap changes nothing you see.
        clip = _rect(pg)
        live = _png(pg.screenshot(clip=clip))
        pg.evaluate("() => _lpRelease()")
        pg.wait_for_timeout(200)
        flat = _png(pg.screenshot(clip=clip))
        live.save(os.path.join(shots, "landing-red-live.png"))
        flat.save(os.path.join(shots, "landing-red-picture.png"))
        mad = _mad(flat, live)
        print("red: MAD %.2f" % mad)
        assert mad < MAD_MAX, mad
        _drag(pg, -40, 0)
        pg.wait_for_function(
            "() => _aeIsOpen && _ae.axis && !_ae.hand", timeout=15000, polling=POLL_MS
        )
        for i in (1, 3):
            pg.evaluate("(i) => _lpFlyTo(i, 1)", i)
            pg.wait_for_function(
                "(i) => !_ae.axis.fly && _ae.axis.u === i",
                arg=i,
                timeout=15000,
                polling=POLL_MS,
            )
            pg.wait_for_timeout(500)
            shot = pg.screenshot(path=os.path.join(shots, "landing-red-%d.png" % i))
            px = np.asarray(_png(shot), dtype=float)
            r, g, b = px[..., 0], px[..., 1], px[..., 2]
            lit = px.max(axis=2) > 24
            # Every lit pixel is red: green and blue are a small share of it.
            bad = lit & ((g > 0.45 * r + 8) | (b > 0.45 * r + 8))
            share = bad.sum() / max(1, lit.sum())
            print("stop %d: %d lit pixels, %.4f not red" % (i, lit.sum(), share))
            assert share < 0.001, (i, share)
        assert not errors, errors
    finally:
        ctx.close()


# ── 8. Reduced motion and battery ──
def test_reduced_motion_snaps_and_rest_draws_nothing(browser, served):
    ctx, pg, errors = _almanac(browser, served, reduced=True)
    try:
        _settle(pg, "2026-10-14T03:00:00Z")
        _drag(pg, -40, 0)
        pg.wait_for_function(
            "() => _aeIsOpen && _ae.axis && !_ae.hand", timeout=15000, polling=POLL_MS
        )
        pg.evaluate("() => _lpFlyTo(3)")
        assert pg.evaluate(
            "() => !_ae.axis.fly && _ae.axis.u === 3"
        ), "no flight under reduced motion"
        # At rest (a stop, no clock running) frames come only at the idle interval, not every rAF.
        pg.wait_for_timeout(600)
        n = pg.evaluate(
            """() => new Promise((res) => { let n = 0; const r = _ae.gl.renderer;
          const o = r.render.bind(r); r.render = function (...a) { n++; return o(...a); };
          setTimeout(() => { r.render = o; res(n); }, 2000); })"""
        )
        print("renders in two idle seconds: %d" % n)
        assert n <= 10, n
        assert not errors, errors
    finally:
        ctx.close()


def test_the_hero_scene_draws_only_when_the_picture_changes(browser, served):
    ctx, pg, errors = _almanac(browser, served)
    try:
        pg.wait_for_timeout(500)
        # The page's own minute tick (the picture changes, so the scene is drawn for it) is not what is measured.
        pg.evaluate("() => _almHeroLiveStop()")
        n = pg.evaluate(
            """() => new Promise((res) => { let n = 0; const r = _ae.gl.renderer;
          const o = r.render.bind(r); r.render = function (...a) { n++; return o(...a); };
          setTimeout(() => { r.render = o; res(n); }, 3000); })"""
        )
        print("renders in three seconds at rest: %d" % n)
        assert n == 0, n
        assert not errors, errors
    finally:
        ctx.close()
