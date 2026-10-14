"""Pointing the phone, and Zimi Earth, in a real browser.

On the shipped files, served by Zimi, in headless Chromium (SwiftShader for
the globe), at a phone's width, with the orientation events a phone sends
simulated:

  1. Look. Opened from the sky, asks for motion on a tap (iOS's way) and
     never before; the view follows the compass heading and the tilt (east,
     west, up 45, down); tipped to the ground the globe replaces the sky;
     denied and no-sensor devices say so and turn by finger; closing gives
     the sky its card back; and a held phone costs no frames.
  2. Zimi Earth. The globe draws, the library's places appear as it comes
     down to one, a touched place offers its article and its guide, an
     installed map covering it is one tap away, and an address says where
     the globe is.

The maths behind each is tests/test_almanac_look.cjs and tests/test_globe.cjs.

Run: pytest tests/test_almanac_look_browser.py -v
"""

import json
import os
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Linux CI needs SwiftShader asked for; a Mac has its own and the flags make it crawl.
GL_ARGS = (
    []
    if sys.platform == "darwin"
    else ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
)
VIEW = {"width": 390, "height": 844}
PLACE = {"lat": 37.7749, "lon": -122.4194, "name": "San Francisco"}
POLL_MS = 100
SETTLE_S = 0.6

# What a phone's browser does that headless Chromium does not: iOS's
# permission request, and a way to send its events.
INIT = """
(() => {
  localStorage.setItem('zimi_almanac_place', %s);
  const mode = %s;
  if (mode === 'none') { window.DeviceOrientationEvent = undefined; }
  else if (mode === 'ios' || mode === 'denied') {
    window.DeviceOrientationEvent = window.DeviceOrientationEvent || function () {};
    window.__asked = 0;
    window.DeviceOrientationEvent.requestPermission = () => { window.__asked++; return Promise.resolve(mode === 'denied' ? 'denied' : 'granted'); };
  }
  const RO = window.ResizeObserver;
  window.__ro = { made: 0, off: 0 };
  window.ResizeObserver = class extends RO {
    constructor(cb) { super(cb); window.__ro.made++; const d = this.disconnect.bind(this); this.disconnect = () => { window.__ro.off++; d(); }; }
  };
  window.__fire = (o, abs) => {
    const e = new Event(abs ? 'deviceorientationabsolute' : 'deviceorientation');
    Object.assign(e, { alpha: o.alpha, beta: o.beta, gamma: o.gamma, absolute: !!abs });
    if (o.heading != null) { e.webkitCompassHeading = o.heading; e.webkitCompassAccuracy = o.acc == null ? 5 : o.acc; }
    window.dispatchEvent(e);
  };
})();
"""

CITIES = [
    ("A/Paris", "Paris", 48.8567, 2.3522, 9000),
    ("A/Eiffel_Tower", "Eiffel Tower", 48.8584, 2.2945, 4000),
    ("A/Sydney", "Sydney", -33.8688, 151.2093, 7000),
]


def _page(title, lat, lon, size):
    return (
        '<html><head><meta name="geo.position" content="%s;%s"/></head><body>%s</body></html>'
        % (lat, lon, "x" * size)
    ).encode()


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    import zimi.renderer as renderer

    if not renderer.browser_available():
        pytest.skip("playwright + chromium are not usable here")
    from http.server import ThreadingHTTPServer

    from conftest_zim import _Article, build_fixture_zim
    from libzim.writer import Creator

    import zimi.server as srv
    from zimi import earth
    from zimi.http import ZimHandler

    tmp = tmp_path_factory.mktemp("look")
    zims = tmp / "zims"
    zims.mkdir()
    (tmp / "data").mkdir()
    with Creator(str(zims / "wikipedia_en_cities_2026-10.zim")).config_indexing(
        False, "eng"
    ) as c:
        c.set_mainpath("A/Paris")
        for path, title, lat, lon, size in CITIES:
            c.add_item(_Article(path, title, _page(title, lat, lon, size)))
        for k, v in {
            "Title": "Wikipedia",
            "Language": "eng",
            "Description": "cities",
            "Scraper": "mwoffliner 1.14.0",
            "Name": "wikipedia_en_cities",
        }.items():
            c.add_metadata(k, v)
    with Creator(str(zims / "wikivoyage_fr_all_nopic_2026-10.zim")).config_indexing(
        False, "fra"
    ) as c:
        c.set_mainpath("A/Paris")
        c.add_item(
            _Article(
                "A/Paris",
                "Paris",
                b'<html><body><a href="geo:48.85,2.35">map</a>'
                + b"g" * 800
                + b"</body></html>",
            )
        )
        for k, v in {
            "Title": "Wikivoyage",
            "Language": "fra",
            "Description": "guide",
            "Scraper": "mwoffliner 1.14.0",
            "Name": "wikivoyage_fr_all",
        }.items():
            c.add_metadata(k, v)
    build_fixture_zim(
        str(zims / "osm-ile-de-france-2026-10.zim"),
        {"Scraper": "streetzim 1.0", "Name": "osm_ile-de-france", "Tags": "maps"},
        indexing=False,
        files={
            "map-config.json": json.dumps({"bounds": [1.5, 48.3, 3.5, 49.3]}).encode()
        },
        main_path="map-config.json",
    )
    old = (srv.ZIM_DIR, srv.ZIMI_DATA_DIR)
    srv.ZIM_DIR, srv.ZIMI_DATA_DIR = str(zims), str(tmp / "data")
    srv.load_cache(force=True)
    earth._reset_for_tests()
    for z in srv._zim_list_cache:
        if z["kind"] == "wiki":
            earth.build_one(z["name"])
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


def _context(browser, mode="ios"):
    ctx = browser.new_context(
        viewport=VIEW,
        has_touch=True,
        is_mobile=True,
        service_workers="block",
    )
    ctx.add_init_script(INIT % (json.dumps(json.dumps(PLACE)), json.dumps(mode)))
    return ctx


NEAR = {
    "articles": [
        {"title": "Oakland, California", "zim": "wikipedia_en_cities", "path": "A/Oakland", "km": 3.4}
    ],
    "guides": [],
}


def _look(browser, served, mode="ios", init=None):
    ctx = _context(browser, mode)
    if init:
        ctx.add_init_script(init)
    # The library under the test server has places only around Paris and Sydney.
    ctx.route(
        "**/earth/near*",
        lambda r: r.fulfill(
            status=200, content_type="application/json", body=json.dumps(NEAR)
        ),
    )
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(served + "/#almanac", wait_until="load")
    pg.wait_for_function(
        "() => !!document.querySelector('.alm-sky-look') && typeof _skyState !== 'undefined' && _skyState && _skyState.eph",
        polling=POLL_MS,
    )
    pg.evaluate("() => document.querySelector('.alm-sky-look').click()")
    pg.wait_for_function(
        "() => !!document.getElementById('almanac-look')", polling=POLL_MS
    )
    return ctx, pg, errors


def _tap(pg, selector):
    """A click in the page itself: Playwright's own waits for a still element
    ride on animation frames, which a swiftshader page busy drawing a globe
    gives slowly."""
    pg.evaluate("(s) => document.querySelector(s).click()", selector)


def _fire(pg, alpha, beta, gamma, heading=None, absolute=False):
    for _ in range(3):
        pg.evaluate(
            "([o, a]) => window.__fire(o, a)",
            [
                {"alpha": alpha, "beta": beta, "gamma": gamma, "heading": heading},
                absolute,
            ],
        )
        pg.wait_for_timeout(60)
    pg.wait_for_timeout(int(SETTLE_S * 1000))


def _reading(pg):
    return pg.inner_text("#look-read")


def _reads(pg, prefix, seconds=10):
    """The reading, once the view has caught up with the sensors: a slow page
    draws few frames a second, so this waits for the answer, not for a time."""
    try:
        pg.wait_for_function(
            "(p) => document.getElementById('look-read').textContent.indexOf(p) === 0",
            arg=prefix,
            polling=POLL_MS,
            timeout=seconds * 1000,
        )
    except Exception:
        pass
    return _reading(pg)


def _globe_opacity(pg):
    return float(
        pg.evaluate(
            "() => getComputedStyle(document.getElementById('look-globe')).opacity"
        )
    )


def test_look_asks_for_motion_on_the_tap_and_not_before(browser, served):
    ctx, pg, errors = _look(browser, served, "ios")
    try:
        assert pg.evaluate("() => window.__asked") == 0
        assert pg.is_visible("#look-ask")
        _tap(pg, "#look-ask")
        pg.wait_for_function("() => window.__asked === 1", polling=POLL_MS)
        assert not pg.is_visible("#look-ask")
        assert not errors
    finally:
        ctx.close()


def test_look_follows_the_compass_and_the_tilt(browser, served):
    ctx, pg, _ = _look(browser, served, "ios")
    try:
        _tap(pg, "#look-ask")
        # iOS: alpha is arbitrary; webkitCompassHeading carries north.
        for heading, word in ((0, "N 0"), (90, "E 90"), (180, "S 180"), (270, "W 270")):
            _fire(pg, 33, 90, 0, heading)
            assert _reads(pg, word).startswith(word), (heading, _reading(pg))
        _fire(pg, 33, 135, 0, 180)
        assert _reads(pg, "S 180\u00b0   +45").startswith("S 180\u00b0   +45")
        # The sky shows above the horizon, the globe not at all.
        assert _globe_opacity(pg) == 0
        _fire(pg, 33, 45, 0, 180)
        assert _reads(pg, "S 180\u00b0   \u221245").startswith("S 180\u00b0   \u221245")
        pg.wait_for_function(
            "() => document.getElementById('look-globe').style.opacity === '1'",
            polling=POLL_MS,
        )
        assert pg.is_visible("#look-earth")
        _fire(pg, 33, 90, 0, 180)
        _reads(pg, "S 180\u00b0   0")
        pg.wait_for_function(
            "() => document.getElementById('look-earth').hidden", polling=POLL_MS
        )
        assert _globe_opacity(pg) == 0
    finally:
        ctx.close()


def test_look_takes_android_absolute_readings(browser, served):
    ctx, pg, _ = _look(browser, served, "android")
    try:
        for heading in (0, 90, 180, 270):
            _fire(pg, (360 - heading) % 360, 90, 0, None, absolute=True)
            want = "%s %d\u00b0" % ("NESW"[heading // 90], heading)
            assert _reads(pg, want).startswith(want), _reading(pg)
        # Chrome fires both events; the relative one must not pull the view.
        pg.evaluate("() => window.__fire({alpha: 10, beta: 90, gamma: 0}, false)")
        pg.wait_for_timeout(300)
        assert _reading(pg).startswith("W 270\u00b0")
    finally:
        ctx.close()


def test_look_says_when_the_compass_needs_calibrating(browser, served):
    ctx, pg, _ = _look(browser, served, "ios")
    try:
        _tap(pg, "#look-ask")
        _fire(pg, 33, 90, 0, 180)
        assert not pg.is_visible("#look-note")
        poor = "() => window.__fire({alpha: 33, beta: 90, gamma: 0, heading: 180, acc: 60})"
        for _ in range(10):
            pg.evaluate(poor)
            pg.wait_for_timeout(300)
        assert "figure eight" in pg.inner_text("#look-note")
        pg.evaluate(
            "() => window.__fire({alpha: 33, beta: 90, gamma: 0, heading: 180, acc: 5})"
        )
        pg.wait_for_timeout(300)
        assert not pg.is_visible("#look-note")
    finally:
        ctx.close()


def test_look_without_sensors_or_permission_turns_by_finger(browser, served):
    for mode, words in (("denied", "Motion is off"), ("none", "no motion sensors")):
        ctx, pg, _ = _look(browser, served, mode)
        try:
            if pg.is_visible("#look-ask"):
                _tap(pg, "#look-ask")
            pg.wait_for_function(
                "() => !document.getElementById('look-note').hidden", polling=POLL_MS
            )
            assert words in pg.inner_text("#look-note")
            before = _reading(pg)
            pg.mouse.move(195, 400)
            pg.mouse.down()
            pg.mouse.move(300, 400, steps=6)
            pg.mouse.up()
            pg.wait_for_timeout(400)
            assert _reading(pg) != before
            pg.keyboard.press("ArrowUp")
            pg.wait_for_timeout(200)
        finally:
            ctx.close()


def test_a_held_phone_costs_no_frames_and_closing_gives_the_card_back(browser, served):
    ctx, pg, errors = _look(browser, served, "none")
    try:
        pg.wait_for_timeout(2000)
        pg.evaluate(
            "() => { window.__raf = 0; const r = window.requestAnimationFrame.bind(window);"
            " window.requestAnimationFrame = (f) => r((t) => { window.__raf++; f(t); }); }"
        )
        pg.wait_for_timeout(3000)
        assert pg.evaluate("() => window.__raf") == 0
        _tap(pg, "#look-close")
        assert pg.query_selector("#almanac-look") is None
        assert pg.evaluate(
            "() => !!document.querySelector('.almanac-sky-wrap #almanac-sky-canvas')"
        )
        assert (
            pg.evaluate("() => SKY_SPAN_DEG") == 240
            and pg.evaluate("() => SKY_ASPECT") == 1.8
        )
        assert not errors
    finally:
        ctx.close()


def _earth(browser, served, hash_="#earth"):
    ctx = browser.new_context(
        viewport=VIEW, has_touch=True, is_mobile=True, service_workers="block"
    )
    ctx.add_init_script(
        "(() => { const RO = window.ResizeObserver; window.__ro = { made: 0, off: 0 };"
        " window.ResizeObserver = class extends RO { constructor(cb) { super(cb); window.__ro.made++;"
        " const d = this.disconnect.bind(this); this.disconnect = () => { window.__ro.off++; d(); }; } }; })();"
    )
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(served + "/" + hash_, wait_until="load")
    pg.wait_for_function(
        "() => { const f = document.getElementById('reader-frame'); return !!(f && f.contentWindow && f.contentWindow.__earth); }",
        polling=POLL_MS,
        timeout=40000,
    )
    frame = next(f for f in pg.frames if "earth.html" in f.url)
    return ctx, pg, frame, errors


def test_the_globe_draws_and_the_library_appears_as_it_comes_down(browser, served):
    ctx, pg, f, errors = _earth(browser, served)
    try:
        # Far out: no places, and the hint says to come closer.
        assert f.evaluate("() => document.querySelectorAll('.dot').length") == 0
        f.evaluate("() => window.__earth.set({lat: 48.86, lon: 2.35, alt: 0.009})")
        pg.wait_for_function(
            "() => { const f = document.getElementById('reader-frame').contentDocument; return f.querySelectorAll('.dot').length >= 2; }",
            polling=POLL_MS,
        )
        names = f.evaluate(
            "() => Array.from(document.querySelectorAll('.dot')).map((d) => d.getAttribute('aria-label')).sort()"
        )
        assert names == ["Eiffel Tower", "Paris"]
        # The installed map covers Paris: one tap from here.
        assert f.evaluate("() => !document.getElementById('map-chip').hidden")
        assert not errors
    finally:
        ctx.close()


def test_a_touched_place_offers_its_article_and_the_map(browser, served):
    ctx, pg, f, _ = _earth(browser, served, "#earth/48.8567,2.3522,0.012")
    try:
        pg.wait_for_function(
            "() => document.getElementById('reader-frame').contentDocument.querySelectorAll('.dot').length >= 1",
            polling=POLL_MS,
        )
        f.evaluate("() => document.querySelector('.dot[aria-label=Paris]').click()")
        pg.wait_for_function(
            "() => document.getElementById('reader-frame').contentDocument.querySelectorAll('#acts .act').length >= 3",
            polling=POLL_MS,
        )
        acts = f.evaluate(
            "() => Array.from(document.querySelectorAll('#acts .act')).map((a) => a.textContent)"
        )
        assert (
            acts[0] == "Read"
            and "Look up from here" in acts
            and "Open the map here" in acts
        )
        f.evaluate("() => document.querySelector('[data-map]').click()")
        pg.wait_for_function("() => location.hash.indexOf('map=') > 0", polling=POLL_MS)
        assert "map=" in pg.url and "/48.8567/2.3522" in pg.url
    finally:
        ctx.close()


def test_the_globe_has_an_address(browser, served):
    ctx, pg, f, _ = _earth(browser, served, "#earth/-33.8688,151.2093,0.05")
    try:
        v = f.evaluate("() => window.__earth.get()")
        assert abs(v["lat"] + 33.8688) < 1e-3 and abs(v["lon"] - 151.2093) < 1e-3
        f.evaluate("() => window.__earth.set({lat: 10, lon: 20, alt: 0.5})")
        pg.wait_for_function(
            "() => location.hash.indexOf('#earth/10,20,') === 0", polling=POLL_MS
        )
    finally:
        ctx.close()


def _spy_open(pg):
    pg.evaluate(
        "() => { window.__opened = []; const o = window.openArticle;"
        " window.openArticle = function () { window.__opened.push(Array.from(arguments).slice(0, 2));"
        " return o.apply(this, arguments); }; }"
    )


def test_read_and_travel_guide_open_the_article_they_name(browser, served):
    ctx, pg, f, _ = _earth(browser, served, "#earth/48.8567,2.3522,0.012")
    try:
        pg.wait_for_function(
            "() => document.getElementById('reader-frame').contentDocument.querySelectorAll('.dot').length >= 1",
            polling=POLL_MS,
        )
        _spy_open(pg)
        f.evaluate("() => document.querySelector('.dot[aria-label=Paris]').click()")
        pg.wait_for_function(
            "() => document.getElementById('reader-frame').contentDocument.querySelectorAll('#acts [data-zim]').length >= 2",
            polling=POLL_MS,
        )
        wiki = pg.evaluate(
            "() => zimsCache.find((z) => z.kind === 'wiki' && z.project === 'wikipedia').name"
        )
        guide = pg.evaluate(
            "() => zimsCache.find((z) => z.kind === 'wiki' && z.project === 'wikivoyage').name"
        )
        f.evaluate("() => document.querySelector('#acts .act.main').click()")
        pg.wait_for_function("() => window.__opened.length === 1", polling=POLL_MS)
        assert pg.evaluate("() => window.__opened[0]") == [wiki, "A/Paris"]
        # Back to Earth, then the guide.
        _spy_open(pg)
        ctx2, pg2, f2, _ = _earth(browser, served, "#earth/48.8567,2.3522,0.012")
        try:
            pg2.wait_for_function(
                "() => document.getElementById('reader-frame').contentDocument.querySelectorAll('.dot').length >= 1",
                polling=POLL_MS,
            )
            _spy_open(pg2)
            f2.evaluate(
                "() => document.querySelector('.dot[aria-label=Paris]').click()"
            )
            pg2.wait_for_function(
                (
                    "() => document.querySelectorAll('#acts [data-zim]').length >= 2"
                    if False
                    else "() => document.getElementById('reader-frame').contentDocument.querySelectorAll('#acts [data-zim]').length >= 2"
                ),
                polling=POLL_MS,
            )
            f2.evaluate(
                "() => document.querySelectorAll('#acts [data-zim]')[1].click()"
            )
            pg2.wait_for_function("() => window.__opened.length === 1", polling=POLL_MS)
            assert pg2.evaluate("() => window.__opened[0]") == [guide, "A/Paris"]
        finally:
            ctx2.close()
    finally:
        ctx.close()


def test_earth_says_which_wikis_are_still_being_read(browser, served, monkeypatch):
    from zimi import earth

    monkeypatch.setattr(
        earth,
        "status",
        lambda: {
            "places": True,
            "finding": [{"zim": "x", "title": "Wikipedia (English)", "pct": 34}],
            "skipped": [{"zim": "y", "title": "Wikipedia (German)"}],
        },
    )
    ctx, pg, f, _ = _earth(browser, served)
    try:
        pg.wait_for_function(
            "() => !document.getElementById('reader-frame').contentDocument.getElementById('status').hidden",
            polling=POLL_MS,
        )
        text = f.inner_text("#status")
        assert "Places from Wikipedia (English) are still being found: 34%" in text
        assert "Wikipedia (German) are not read on this device" in text
    finally:
        ctx.close()


def test_the_globe_lets_go_of_its_resize_observer(browser, served):
    ctx, pg, f, _ = _earth(browser, served)
    try:
        got = f.evaluate("() => { window.__earth.dispose(); return window.__ro; }")
        assert got["made"] >= 1 and got["off"] >= got["made"], got
    finally:
        ctx.close()


def _almanac_open(pg):
    return pg.evaluate("() => _almanacOpen")


def test_escape_closes_look_and_leaves_the_almanac(browser, served):
    ctx, pg, _ = _look(browser, served, "none")
    try:
        pg.keyboard.press("Escape")
        pg.wait_for_function(
            "() => !document.getElementById('almanac-look')", polling=POLL_MS
        )
        assert _almanac_open(pg) and pg.is_visible(".almanac-sky-wrap")
        assert pg.evaluate("() => !document.body.classList.contains('look-open')")
    finally:
        ctx.close()


def _look_from_home(browser, served):
    """The Almanac opened from the home page, so Back has somewhere to go."""
    ctx = _context(browser, "none")
    pg = ctx.new_page()
    pg.goto(served + "/", wait_until="load")
    pg.wait_for_function("() => typeof openAlmanac === 'function'", polling=POLL_MS)
    pg.evaluate("() => openAlmanac()")
    pg.wait_for_function(
        "() => !!document.querySelector('.alm-sky-look') && typeof _skyState !== 'undefined' && _skyState && _skyState.eph",
        polling=POLL_MS,
    )
    pg.evaluate("() => document.querySelector('.alm-sky-look').click()")
    pg.wait_for_function(
        "() => !!document.getElementById('almanac-look')", polling=POLL_MS
    )
    return ctx, pg


def test_the_back_gesture_closes_look_first_and_the_almanac_second(browser, served):
    ctx, pg = _look_from_home(browser, served)
    try:
        assert pg.evaluate("() => history.state && history.state.look") == 1
        pg.evaluate("() => history.back()")
        pg.wait_for_function(
            "() => !document.getElementById('almanac-look')", polling=POLL_MS
        )
        assert _almanac_open(pg)
        pg.evaluate("() => history.back()")
        pg.wait_for_function("() => !_almanacOpen", polling=POLL_MS)
        assert pg.evaluate("() => !document.getElementById('almanac-look')")
    finally:
        ctx.close()


def test_closing_look_by_its_button_takes_back_the_step_it_made(browser, served):
    ctx, pg = _look_from_home(browser, served)
    try:
        before = pg.evaluate("() => history.length")
        assert pg.evaluate("() => history.state && history.state.look") == 1
        _tap(pg, "#look-close")
        pg.wait_for_function(
            "() => !document.getElementById('almanac-look')", polling=POLL_MS
        )
        pg.wait_for_function(
            "() => !(history.state && history.state.look)", polling=POLL_MS
        )
        assert _almanac_open(pg)
        # One Back from here leaves the Almanac, not a step that is not there.
        pg.evaluate("() => history.back()")
        pg.wait_for_function("() => !_almanacOpen", polling=POLL_MS)
        assert before >= 3
    finally:
        ctx.close()


def test_closing_the_almanac_takes_look_with_it(browser, served):
    ctx, pg, _ = _look(browser, served, "none")
    try:
        pg.evaluate("() => closeAlmanac()")
        pg.wait_for_function(
            "() => !document.getElementById('almanac-look')", polling=POLL_MS
        )
        assert pg.evaluate("() => !document.body.classList.contains('look-open')")
    finally:
        ctx.close()


def _centre(pg, selector):
    return pg.evaluate(
        "(s) => { const r = document.querySelector(s).getBoundingClientRect();"
        " return [r.left + r.width / 2, r.top + r.height / 2]; }",
        selector,
    )


def _hit(pg, selector):
    """True when what a finger lands on at the control's middle is the control."""
    x, y = _centre(pg, selector)
    return pg.evaluate(
        "([s, x, y]) => { const e = document.elementFromPoint(x, y);"
        " return !!e && !!e.closest(s); }",
        [selector, x, y],
    )


def test_look_controls_are_under_the_finger_not_under_the_sky(browser, served):
    """The sky's canvas once shared the Look button's class and covered every
    control. Taps here are real touches at the control's middle, not clicks."""
    ctx, pg, errors = _look(browser, served, "ios")
    try:
        for sel in ("#look-close", "#look-ask"):
            assert _hit(pg, sel), sel
        x, y = _centre(pg, "#look-ask")
        pg.touchscreen.tap(x, y)
        pg.wait_for_function("() => window.__asked === 1", polling=POLL_MS)
        x, y = _centre(pg, "#look-close")
        pg.touchscreen.tap(x, y)
        pg.wait_for_function(
            "() => !document.getElementById('almanac-look')", polling=POLL_MS
        )
        assert not errors
    finally:
        ctx.close()


def _earth_dots(pg):
    pg.wait_for_function(
        "() => document.getElementById('reader-frame').contentDocument.querySelectorAll('.dot').length >= 1",
        polling=POLL_MS,
    )


def test_back_from_an_article_read_at_a_place_returns_to_that_place(browser, served):
    ctx, pg, f, _ = _earth(browser, served, "#earth/48.8567,2.3522,0.012")
    try:
        _earth_dots(pg)
        wiki = pg.evaluate(
            "() => zimsCache.find((z) => z.kind === 'wiki' && z.project === 'wikipedia').name"
        )
        pg.evaluate("(z) => openArticle(z, 'A/Paris')", wiki)
        pg.wait_for_function("() => !_earthOpen && !!currentArticle", polling=POLL_MS)
        pg.evaluate("() => history.back()")
        pg.wait_for_function("() => _earthOpen", polling=POLL_MS)
        # The page reloads at the place it was left, not at the far globe.
        pg.wait_for_function(
            "() => { const w = document.getElementById('reader-frame').contentWindow;"
            " if (!(w && w.__earth)) return false; const v = w.__earth.get();"
            " return Math.abs(v.lat - 48.8567) < 1e-3 && Math.abs(v.lon - 2.3522) < 1e-3 && v.alt < 0.05; }",
            polling=POLL_MS,
            timeout=15000,
        )
        assert pg.evaluate("() => location.hash").startswith("#earth/48.85")
    finally:
        ctx.close()


def _look_up_from_a_place(pg):
    _earth_dots(pg)
    pg.evaluate(
        "() => document.getElementById('reader-frame').contentDocument.querySelector('.dot[aria-label=Paris]').click()"
    )
    pg.wait_for_function(
        "() => document.getElementById('reader-frame').contentDocument.querySelectorAll('#acts .act').length >= 3",
        polling=POLL_MS,
    )
    pg.evaluate(
        "() => Array.from(document.getElementById('reader-frame').contentDocument.querySelectorAll('#acts .act'))"
        ".find((a) => a.textContent === 'Look up from here').click()"
    )
    pg.wait_for_function(
        "() => !!document.getElementById('almanac-look')",
        polling=POLL_MS,
        timeout=40000,
    )


def _earth_is_back(pg):
    pg.wait_for_function("() => !_almanacOpen", polling=POLL_MS)
    assert pg.evaluate("() => _earthOpen && readerOpen")
    assert pg.evaluate("() => !!document.querySelector('#reader-frame')")


def test_earth_look_up_then_back_twice_leaves_earth_properly_open(browser, served):
    ctx, pg, f, _ = _earth(browser, served, "#earth/48.8567,2.3522,0.012")
    try:
        _look_up_from_a_place(pg)
        pg.evaluate("() => history.back()")
        pg.wait_for_function(
            "() => !document.getElementById('almanac-look')", polling=POLL_MS
        )
        pg.evaluate("() => history.back()")
        _earth_is_back(pg)
    finally:
        ctx.close()


def test_earth_look_up_then_closing_the_almanac_leaves_earth_properly_open(
    browser, served
):
    ctx, pg, f, _ = _earth(browser, served, "#earth/48.8567,2.3522,0.012")
    try:
        _look_up_from_a_place(pg)
        pg.evaluate("() => closeAlmanac()")
        _earth_is_back(pg)
    finally:
        ctx.close()


def _look_down(pg):
    _tap(pg, "#look-ask")
    _fire(pg, 33, 45, 0, 180)
    pg.wait_for_function(
        "() => !document.getElementById('look-under').hidden",
        polling=POLL_MS,
        timeout=20000,
    )


def _rgb(css):
    return [int(float(v)) for v in css[css.index("(") + 1 : css.index(")")].split(",")[:3]]


def _is_red(css):
    r, g, b = _rgb(css)
    return r > 0 and g * 2 <= r and b * 2 <= r


def test_looking_down_names_what_is_under_you(browser, served):
    ctx, pg, errors = _look(browser, served, "ios")
    try:
        _look_down(pg)
        pg.wait_for_function(
            "() => !document.getElementById('look-under-read').hidden", polling=POLL_MS
        )
        assert "San Francisco" in pg.inner_text("#look-under-name")
        assert "Oakland, California" in pg.inner_text("#look-under-read")
        assert "3.4 km" in pg.inner_text("#look-under-read")
        assert _hit(pg, "#look-under-read")
        # Zimi Earth stays, but is not the loudest thing on the screen.
        bg = pg.evaluate(
            "() => getComputedStyle(document.getElementById('look-earth')).backgroundColor"
        )
        assert bg != "rgb(224, 134, 58)"
        _spy_open(pg)
        x, y = _centre(pg, "#look-under-read")
        pg.touchscreen.tap(x, y)
        pg.wait_for_function("() => window.__opened.length === 1", polling=POLL_MS)
        assert pg.evaluate("() => window.__opened[0]") == [
            "wikipedia_en_cities",
            "A/Oakland",
        ]
        assert pg.query_selector("#almanac-look") is None
        assert not errors
    finally:
        ctx.close()


def test_looking_down_without_webgl_says_what_is_there_and_leads_nowhere(
    browser, served
):
    nogl = browser.browser_type.launch(
        args=["--disable-gpu", "--disable-webgl", "--disable-webgl2", "--disable-3d-apis"]
    )
    try:
        ctx, pg, errors = _look(nogl, served, "ios")
        assert pg.evaluate("() => !document.createElement('canvas').getContext('webgl2')")
        _look_down(pg)
        pg.wait_for_function(
            "() => !document.getElementById('look-under-read').hidden", polling=POLL_MS
        )
        assert "San Francisco" in pg.inner_text("#look-under-name")
        assert pg.evaluate("() => document.getElementById('look-earth').hidden")
        assert _globe_opacity(pg) == 0
        assert not errors
        ctx.close()
    finally:
        nogl.close()


def test_red_night_paints_the_look_view_red(browser, served):
    ctx, pg, _ = _look(
        browser, served, "ios", "localStorage.setItem('zimi.night', 'red')"
    )
    try:
        _look_down(pg)
        pg.wait_for_function(
            "() => !document.getElementById('look-under-read').hidden", polling=POLL_MS
        )
        css = pg.evaluate(
            "() => { const c = (s, p) => getComputedStyle(document.querySelector(s))[p];"
            " return { you: c('.look-you', 'backgroundColor'), close: c('#look-close', 'color'),"
            " name: c('#look-under-name', 'color'), read: c('#look-under-read', 'color'),"
            " ask: c('#look-ask', 'backgroundColor'), read_: c('#look-read', 'color') }; }"
        )
        for k, v in css.items():
            assert _is_red(v), (k, v)
    finally:
        ctx.close()


def test_the_point_of_the_compass_is_in_the_persons_language(browser, served):
    ctx, pg, _ = _look(
        browser, served, "ios", "localStorage.setItem('zimi_ui_lang', 'de')"
    )
    try:
        _tap(pg, "#look-ask")
        _fire(pg, 33, 90, 0, 90)
        assert _reads(pg, "O 90").startswith("O 90"), _reading(pg)
    finally:
        ctx.close()


def test_the_sensor_note_is_let_go_after_a_finger_has_turned_the_view(browser, served):
    ctx, pg, _ = _look(browser, served, "none")
    try:
        pg.wait_for_function(
            "() => !document.getElementById('look-note').hidden", polling=POLL_MS
        )
        assert not pg.evaluate("() => document.getElementById('look-note').classList.contains('gone')")
        pg.mouse.move(195, 400)
        pg.mouse.down()
        pg.mouse.move(250, 400, steps=4)
        pg.mouse.up()
        assert pg.evaluate("() => document.getElementById('look-note').classList.contains('gone')")
    finally:
        ctx.close()


def test_a_link_that_names_a_place_does_not_give_the_first_visit_hint(browser, served):
    ctx, pg, f, _ = _earth(browser, served, "#earth/48.8567,2.3522,0.012")
    try:
        _earth_dots(pg)
        assert f.evaluate("() => document.getElementById('hint').hidden")
    finally:
        ctx.close()
    ctx, pg, f, _ = _earth(browser, served)
    try:
        # A first visit with no place named still says how to turn the globe.
        assert not f.evaluate("() => document.getElementById('hint').hidden")
    finally:
        ctx.close()


def test_place_labels_stay_inside_the_screen(browser, served):
    ctx, pg, f, _ = _earth(browser, served, "#earth/48.8567,2.3522,0.012")
    try:
        _earth_dots(pg)
        for dlon in (-0.05, -0.02, 0.0, 0.02, 0.05):
            f.evaluate(
                "(d) => window.__earth.set({lat: 48.8567, lon: 2.3522 + d, alt: 0.012}, 0)", dlon
            )
            pg.wait_for_timeout(500)
            out = f.evaluate(
                "() => Array.from(document.querySelectorAll('.dot span')).filter((s) => s.style.display !== 'none' && s.parentElement.style.display !== 'none')"
                ".map((s) => { const r = s.getBoundingClientRect(); return [r.left, r.right]; })"
            )
            for left, right in out:
                assert left >= 0 and right <= VIEW["width"], (dlon, left, right)
    finally:
        ctx.close()


def test_show_where_i_am_explains_itself_when_location_is_off(browser, served):
    ctx, pg, f, _ = _earth(browser, served)
    try:
        f.evaluate("() => document.getElementById('t-me').click()")
        pg.wait_for_function(
            "() => { const s = document.getElementById('reader-frame').contentDocument.getElementById('status'); return !s.hidden && s.textContent.indexOf('location is off') >= 0; }",
            polling=POLL_MS,
            timeout=20000,
        )
    finally:
        ctx.close()
