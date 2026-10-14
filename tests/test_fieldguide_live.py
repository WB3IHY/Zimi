"""The Field Guide in a real browser, on a phone's width.

Help now is one quiet line on home; it opens the situations, each situation
opens the quotations with their sources (with no ZIM installed at all), a
search for "tourniquet" puts the situation above the results, an installed
ZIM shows up as the way to the full section, the red night light follows one
shared key, and the page prints as the quotations alone.

Run: pytest tests/test_fieldguide_live.py -v
"""

import os
import shutil
import subprocess
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fieldguide_fixture as fx  # noqa: E402
import zimi.renderer as renderer  # noqa: E402
import zimi.server as srv  # noqa: E402
from zimi import fieldguide as fg  # noqa: E402

STATIC = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "zimi", "static"
)
FRAME = "f => f.url.indexOf('fieldguide.html') >= 0"
SHOTS = os.environ.get("ZIMI_SHOTS", "")


def _serve(tmp, monkeypatch, library):
    from http.server import ThreadingHTTPServer

    from zimi.http import ZimHandler

    zdir = tmp / "zims"
    zdir.mkdir()
    if library:
        fx.build_library(str(zdir))
    monkeypatch.setattr(srv, "ZIM_DIR", str(zdir))
    monkeypatch.setattr(srv, "ZIMI_DATA_DIR", str(tmp / "data"))
    os.makedirs(str(tmp / "data"), exist_ok=True)
    monkeypatch.setenv("ZIMI_OFFLINE", "1")
    monkeypatch.setenv("ZIMI_TORRENT", "0")
    monkeypatch.setenv("ZIMI_MANAGE_PASSWORD", "x")
    srv.load_cache(force=True)
    fg._reset_for_tests()
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), ZimHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, "http://127.0.0.1:%d" % httpd.server_address[1]


@pytest.fixture(scope="module")
def pw():
    if not renderer.browser_available():
        pytest.skip("playwright + chromium are not usable here")
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        yield p


@pytest.fixture(scope="module")
def empty(pw, tmp_path_factory):
    mp = pytest.MonkeyPatch()
    httpd, base = _serve(tmp_path_factory.mktemp("fg-empty"), mp, library=False)
    yield base
    httpd.shutdown()
    mp.undo()


@pytest.fixture(scope="module")
def full(pw, tmp_path_factory):
    mp = pytest.MonkeyPatch()
    httpd, base = _serve(tmp_path_factory.mktemp("fg-full"), mp, library=True)
    yield base
    httpd.shutdown()
    mp.undo()


@pytest.fixture
def phone(pw):
    b = pw.chromium.launch()
    ctx = b.new_context(**pw.devices["iPhone 15"])
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    yield pg
    ctx.close()
    b.close()


def _frame(pg):
    for _ in range(100):
        f = next((f for f in pg.frames if "fieldguide.html" in f.url), None)
        if f:
            return f
        pg.wait_for_timeout(100)
    raise AssertionError("the Field Guide page never opened")


def _shot(pg, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        pg.screenshot(path=os.path.join(SHOTS, name + ".png"))


def _open(pg, base, hash_=""):
    pg.goto("about:blank")
    pg.goto(base + "/" + hash_, wait_until="domcontentloaded")
    pg.wait_for_timeout(800)


def test_the_scripts_are_valid_javascript():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    for name in ("fieldguide-card.js", "apps.js"):
        r = subprocess.run(
            [node, "--check", os.path.join(STATIC, name)],
            capture_output=True,
            text=True,
        )
        assert r.returncode == 0, name + ": " + r.stderr


def test_help_now_is_on_home_even_with_nothing_installed_and_opens_the_situations(
    empty, phone
):
    _open(phone, empty)
    phone.wait_for_selector(".help-now")
    _shot(phone, "empty-home")
    phone.click(".help-now")
    f = _frame(phone)
    f.wait_for_selector(".fg-sit")
    names = f.eval_on_selector_all(
        ".fg-sit .name", "els => els.map(e => e.textContent)"
    )
    assert names[:3] == ["Bleeding", "Choking", "Not breathing"] and len(names) == 17
    assert f.inner_text("#t-disc") == fg.DISCLAIMER
    # Every row is one finger tall and the page does not scroll sideways.
    heights = f.eval_on_selector_all(
        ".fg-sit", "els => els.map(e => e.getBoundingClientRect().height)"
    )
    assert min(heights) >= 44
    assert f.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    _shot(phone, "empty-front")
    assert phone.url.endswith("/#fieldguide")
    assert phone.errors == []


def test_a_situation_works_with_no_zim_at_all_and_says_where_each_quote_is_from(
    empty, phone
):
    _open(phone, empty, "#fieldguide/bleeding")
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    assert f.inner_text("#c-title") == "Bleeding"
    assert f.inner_text("#c-disc") == fg.DISCLAIMER
    quotes = f.query_selector_all(".fg-q")
    assert len(quotes) == 5
    # One chip per quotation, by the source's own heading, so a long one is a tap away.
    chips = f.eval_on_selector_all(
        "#c-jump .chip", "els => els.map(e => e.textContent)"
    )
    assert chips[0] == "Massive Hemorrhage" and "Apply a Tourniquet" in chips
    f.click("#c-jump .chip:nth-child(4)")
    phone.wait_for_timeout(900)
    assert f.evaluate("window.scrollY") > 300
    text = f.inner_text("#c-quotes")
    assert "Twist the windlass until the bleeding stops." in text
    assert "Chapter 6, para 6-7, p. 6-2" in text
    assert "US government work, public domain" in text
    assert f.eval_on_selector_all(
        ".fg-q .fg-foot a", "els => els.every(a => a.href.startsWith('https://'))"
    )
    # Not installed: what would add the full text, with its size.
    assert "Add Army Publishing Directorate (8.2 GB) for the full text" in text
    assert f.query_selector("[data-act=build]") is not None
    assert f.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    _shot(phone, "empty-bleeding")
    assert phone.errors == []


def test_the_front_to_a_situation_is_a_step_back_goes_to_the_front(empty, phone):
    _open(phone, empty, "#fieldguide")
    f = _frame(phone)
    f.wait_for_selector(".fg-sit")
    f.click(".fg-sit[data-id=water]")
    f.wait_for_selector(".fg-q")
    assert phone.url.endswith("#fieldguide/water")
    phone.go_back()
    phone.wait_for_timeout(600)
    f = _frame(phone)
    f.wait_for_selector(".fg-sit")
    assert f.is_visible("#front") and not f.is_visible("#card")


def test_search_puts_the_situation_above_the_results(full, phone):
    _open(phone, full)
    phone.fill(".topbar input", "tourniquet")
    phone.keyboard.press("Enter")
    phone.wait_for_selector("#fg-answer .fg-q", timeout=20000)
    phone.wait_for_function(
        "document.querySelector('#fg-answer-body .fg-body')", timeout=20000
    )
    top = phone.evaluate(
        "[document.getElementById('fg-answer').getBoundingClientRect().top, document.getElementById('output').getBoundingClientRect().top]"
    )
    assert top[0] < top[1], "the card is above the results"
    assert phone.inner_text("#fg-answer h3") == "Bleeding"
    assert "Not medical advice" in phone.inner_text("#fg-answer")
    _shot(phone, "full-search")
    phone.click("#fg-answer [data-act=situation]")
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    assert f.inner_text("#c-title") == "Bleeding"
    # Words that name nothing leave search alone.
    _open(phone, full)
    phone.fill(".topbar input", "water cycle")
    phone.keyboard.press("Enter")
    phone.wait_for_timeout(2500)
    assert phone.query_selector("#fg-answer") is None


def test_an_installed_zim_is_the_way_to_the_full_section_and_lists_its_pages(
    full, phone
):
    _open(phone, full, "#fieldguide/flood")
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    lib = f.inner_text(".fg-q .fg-lib")
    assert "In your library: Ready.gov" in lib and "Read the full section" in lib
    f.evaluate("window.scrollTo(0, 99999)")
    assert "Floods | Ready.gov" in f.inner_text("#c-more")
    _shot(phone, "full-flood")
    f.click(".fg-q .fg-btn[data-act=open]")
    phone.wait_for_timeout(1500)
    assert (
        "/w/www.ready.gov/www.ready.gov/floods" in phone.url or "ready.gov" in phone.url
    )


def test_documents_in_a_library_are_listed_by_their_titles(full, phone):
    _open(phone, full, "#fieldguide/water")
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    more = f.inner_text("#c-more")
    assert "Distillation For Home Water Treatment" in more and "Giardia" in more


def test_the_library_lists_what_fills_the_guide_with_sizes(full, phone):
    _open(phone, full, "#fieldguide")
    f = _frame(phone)
    f.wait_for_selector(".fg-sit")
    f.click("#t-library")
    f.wait_for_selector(".fg-set")
    text = f.inner_text("#l-sets")
    assert "Water Treatment Library" in text and "Installed" in text
    assert "Medical Library" in text and "MB" in text
    assert f.query_selector("[data-all]") is not None
    _shot(phone, "full-library")


def test_red_night_follows_the_one_shared_key(empty, phone):
    _open(phone, empty, "#fieldguide")
    f = _frame(phone)
    f.wait_for_selector(".fg-sit")
    assert not f.evaluate("document.documentElement.classList.contains('night-red')")
    f.check("#night")
    assert f.evaluate("localStorage.getItem('zimi.night')") == "red"
    assert f.evaluate("document.documentElement.classList.contains('night-red')")
    bg = f.evaluate("getComputedStyle(document.body).backgroundColor")
    assert bg == "rgb(0, 0, 0)"
    _shot(phone, "empty-red")
    # The shell turns red with it, and the key written elsewhere is honoured here.
    assert phone.evaluate("document.documentElement.classList.contains('night-red')")
    f.uncheck("#night")
    assert f.evaluate("localStorage.getItem('zimi.night')") is None
    phone.evaluate("localStorage.setItem('zimi.night', 'red'); _nightApply()")
    assert phone.evaluate("document.documentElement.classList.contains('night-red')")
    phone.evaluate("localStorage.removeItem('zimi.night')")


def test_a_situation_prints_as_its_quotations_alone(empty, phone):
    _open(phone, empty, "#fieldguide/choking")
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    phone.emulate_media(media="print")
    assert (
        f.evaluate("getComputedStyle(document.querySelector('.fg-btn')).display")
        == "none"
    )
    assert (
        f.evaluate("getComputedStyle(document.getElementById('front')).display")
        == "none"
    )
    assert (
        f.evaluate("getComputedStyle(document.querySelector('.fg-q')).display")
        != "none"
    )
    assert (
        f.evaluate("getComputedStyle(document.body).backgroundColor")
        == "rgb(255, 255, 255)"
    )
    assert (
        f.evaluate("getComputedStyle(document.querySelector('.fg-q')).breakInside")
        == "avoid"
    )
    phone.emulate_media(media="screen")


def test_the_chrome_speaks_the_readers_language_and_the_quotes_stay_in_the_sources(
    empty, phone
):
    _open(phone, empty)
    phone.evaluate("localStorage.setItem('zimi_ui_lang', 'ru')")
    _open(phone, empty, "#fieldguide/cold")
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    assert f.inner_text("#c-title") == "Холод"
    assert f.inner_text("#c-disc").startswith("Это не медицинская консультация")
    assert f.is_visible("#c-en"), "says the sources are in English"
    assert f.eval_on_selector(".fg-q h3", "e => e.getAttribute('lang')") == "en"
    assert "First Aid for Hypothermia" in f.inner_text("#c-quotes")
    _shot(phone, "empty-cold-ru")
    phone.evaluate("localStorage.removeItem('zimi_ui_lang')")
