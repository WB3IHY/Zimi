"""The Moon landing's hero, in a real browser: the hero is the live scene.

Open the Almanac and the Moon in the hero is the real one, drawn by the 3D
view's scene (zimi/static/almanac-landing.js) in the hero's own rectangle.
Checked here on the shipped files, served by Zimi, in headless Chromium
(SwiftShader) on a 390 px phone:

  1. The swap is invisible: the hero as the page paints it with the live scene
     in place, against the same hero as the picture it replaces, at three
     focus dates. The mean absolute difference must be under 3.5 of 255 AND
     under what moving the disc by one device pixel costs the same picture
     (what remains is texture filtering and the limb's antialiasing).
  2. Nothing is on the critical path: the first hero is the picture, and no
     three.js, no Earth view and no landing came before it.
  3. With WebGL off, nothing changes: the picture stays, with no canvas in the
     hero and no hand on it.
  4. The scene follows the page's clock and steps aside for the picture's own
     sweeps; at rest nothing draws.

Run: pytest tests/test_moon_landing_live.py -v
(ZIMI_SHOT_DIR=<dir> keeps the screenshots there.)
"""

import io
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


# ── 1. The swap is invisible ──
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
        _settle(pg, "2026-10-03T12:00:00Z")
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
