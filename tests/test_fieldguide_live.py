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
    # The library list is what the first screen waits for; a search typed before
    # it arrives is drawn over by it.
    pg.wait_for_function(
        "!document.querySelector('#output .loading')", timeout=30000
    )


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
    assert names[:3] == ["Calling for help", "Bleeding", "Not breathing"] and len(names) == 25
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
    assert len(quotes) == 4
    # One chip per quotation, by the source's own heading, so a long one is a tap away.
    chips = f.eval_on_selector_all(
        "#c-jump .chip", "els => els.map(e => e.textContent)"
    )
    assert chips[0] == "Application of Direct Pressure"
    assert "Application of Tourniquets" in chips
    f.click("#c-jump .chip:nth-child(2)")
    phone.wait_for_timeout(900)
    assert f.evaluate("window.scrollY") > 300
    text = f.inner_text("#c-quotes")
    assert "Twist the rod until bleeding has stopped" in text
    assert "Chapter 4, paras 4-39 to 4-41, pp. 48 and 49" in text
    assert "US government work, public domain" in text
    assert f.eval_on_selector_all(
        ".fg-q .fg-foot a", "els => els.every(a => a.href.startsWith('https://'))"
    )
    # Not installed: one block for the situation says what would add the full text.
    lib = f.inner_text("#c-lib")
    assert "Your library" in lib
    assert "Add Army Publishing Directorate (8.2 GB) for the full text" in lib
    assert f.query_selector_all(".fg-q [data-act=get]") == []
    assert len(f.query_selector_all("#c-lib [data-act=get]")) == 1
    # Offline: nothing is built from here, so Build is not offered.
    assert f.query_selector("[data-act=build]") is None
    # Every tap target is a finger tall.
    short = f.evaluate(
        "Array.from(document.querySelectorAll('.fg-btn, #c-jump .chip, .fg-foot a, .fg-print')).filter(e => e.getBoundingClientRect().height < 43.5).length"
    )
    assert short == 0
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
    phone.wait_for_selector("[data-card=fieldguide] .fg-q", timeout=20000)
    phone.wait_for_function(
        "document.querySelector('.fg-answer-body .fg-body')", timeout=20000
    )
    assert phone.evaluate(
        "document.getElementById('output').firstElementChild.dataset.card"
    ) == "fieldguide", "the card is above the results"
    assert phone.inner_text("[data-card=fieldguide] h3") == "Bleeding"
    assert "Not medical advice" in phone.inner_text("[data-card=fieldguide]")
    assert "application of direct pressure" in phone.inner_text("[data-card=fieldguide]").lower()
    assert phone.query_selector("[data-card=fieldguide] .fg-foot a") is not None
    _shot(phone, "full-search")
    phone.click("[data-card=fieldguide] [data-act=situation]")
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    assert f.inner_text("#c-title") == "Bleeding"
    # Words that name nothing leave search alone.
    _open(phone, full)
    phone.fill(".topbar input", "water cycle")
    phone.keyboard.press("Enter")
    phone.wait_for_timeout(2500)
    assert phone.query_selector("[data-card=fieldguide]") is None


def _search(pg, text):
    pg.fill(".topbar input", text)
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(2500)


def test_the_answer_goes_when_search_is_left(full, phone):
    _open(phone, full)
    _search(phone, "tourniquet")
    phone.wait_for_selector("[data-card=fieldguide] .fg-q", timeout=20000)
    phone.evaluate("goHome()")
    phone.wait_for_timeout(600)
    assert phone.query_selector("[data-card=fieldguide]") is None
    _search(phone, "tourniquet")
    phone.wait_for_selector("[data-card=fieldguide] .fg-q", timeout=20000)
    phone.evaluate("renderHome()")
    assert phone.query_selector("[data-card=fieldguide]") is None
    _search(phone, "tourniquet")
    phone.wait_for_selector("[data-card=fieldguide] .fg-q", timeout=20000)
    phone.evaluate("void enterManage()")
    phone.wait_for_timeout(800)
    assert phone.query_selector("[data-card=fieldguide]") is None


def test_a_baby_choking_gets_the_infant_passage_not_the_adults(full, phone):
    _open(phone, full)
    _search(phone, "my baby is choking")
    h4 = phone.wait_for_selector("[data-card=fieldguide] .fg-body h4", timeout=20000)
    assert h4.text_content().startswith("Infants")
    _search(phone, "my friend is choking")
    phone.wait_for_function(
        "() => { const h = document.querySelector('[data-card=fieldguide] .fg-body h4'); return h && !/^Infants/.test(h.textContent); }",
        timeout=20000,
    )
    assert not phone.errors


def test_the_help_now_box_names_the_situation_and_opens_it(full, phone):
    _open(phone, full, "#fieldguide")
    f = _frame(phone)
    box = f.wait_for_selector("#t-q")
    assert box.get_attribute("placeholder") == "What’s happening?"
    box.fill("my baby is choking")
    f.wait_for_selector(".fg-hit.lead[data-id=choking]", timeout=10000)
    box.press("Enter")
    f.wait_for_selector("#card:not([hidden]) .fg-q")
    assert f.inner_text("#c-title") == "Choking"
    first = f.query_selector("#c-quotes .fg-q h3, #c-quotes .fg-q h4")
    assert first.text_content().startswith("Infants")
    assert not phone.errors


def test_the_help_now_box_searches_the_library_when_nothing_is_named(full, phone):
    _open(phone, full, "#fieldguide")
    f = _frame(phone)
    box = f.wait_for_selector("#t-q")
    box.fill("water cycle")
    # Enter at once, before the matcher has answered: it waits, then searches.
    box.press("Enter")
    phone.wait_for_function(
        "() => document.querySelector('.topbar input').value === 'water cycle' && !document.querySelector('[data-card=fieldguide] .fg-q')",
        timeout=20000,
    )
    assert not phone.errors


def test_no_answer_when_searching_inside_one_zim(full, phone):
    _open(phone, full)
    _search(phone, "tourniquet")
    phone.wait_for_selector("[data-card=fieldguide] .fg-q", timeout=20000)
    # The guide's own "Search X for ..." links search one ZIM.
    phone.evaluate("_searchInZim('wikipedia_en_top', 'tourniquet')")
    phone.wait_for_timeout(2500)
    assert phone.query_selector("[data-card=fieldguide]") is None
    assert phone.query_selector(".help-now") is None


def test_a_bare_ambiguous_word_is_a_small_link_never_the_quote(full, phone):
    _open(phone, full)
    _search(phone, "water")
    link = phone.wait_for_selector("[data-card=fieldguide] .help-now")
    assert link.inner_text().strip() == "Help now: Water"
    assert phone.query_selector("[data-card=fieldguide] .fg-q") is None
    assert link.bounding_box()["height"] >= 44
    link.click()
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    assert f.inner_text("#c-title") == "Water"


def test_a_sentence_names_the_situation_and_no_results_is_never_under_a_card(
    full, phone
):
    _open(phone, full)
    _search(phone, "my friend is bleeding")
    phone.wait_for_selector("[data-card=fieldguide] .fg-q", timeout=20000)
    assert phone.inner_text("[data-card=fieldguide] h3") == "Bleeding"
    assert "No results found" not in phone.inner_text("#output")
    assert "No results found" not in phone.inner_text("body")
    _search(phone, "which way is south")
    phone.wait_for_selector("[data-card=fieldguide] .fg-q", timeout=20000)
    assert phone.inner_text("[data-card=fieldguide] h3") == "Lost"
    # A tall passage is folded in the answer and whole behind Show all.
    assert phone.is_visible("[data-card=fieldguide] [data-act=more]")
    phone.click("[data-card=fieldguide] [data-act=more]")
    assert phone.evaluate(
        "document.querySelector('[data-card=fieldguide] .fg-body').scrollHeight <= document.querySelector('[data-card=fieldguide] .fg-body').clientHeight + 2"
    )


def test_normal_searches_get_no_card_and_no_link(full, phone):
    _open(phone, full)
    for text in ("signal processing", "generator docs", "sed", "water cycle"):
        _search(phone, text)
        assert phone.query_selector("[data-card=fieldguide]") is None, text


def test_the_guide_page_alone_may_ask_the_shell_to_search(full, phone):
    _open(phone, full, "#fieldguide")
    f = _frame(phone)
    f.wait_for_selector(".fg-sit")
    # The shell's own window is not the Field Guide page: refused.
    phone.evaluate(
        "window.postMessage({ zimi: 'search-in', zim: 'wikipedia_en_top', q: 'tourniquet' }, location.origin)"
    )
    phone.wait_for_timeout(800)
    assert "?q=" not in phone.url
    f.evaluate(
        "parent.postMessage({ zimi: 'search-in', zim: 'wikipedia_en_top', q: 'tourniquet' }, location.origin)"
    )
    phone.wait_for_function("location.href.indexOf('q=tourniquet') >= 0", timeout=15000)


def test_an_installed_zim_is_the_way_to_the_full_section_and_lists_its_pages(
    full, phone
):
    _open(phone, full, "#fieldguide/flood")
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    lib = f.inner_text("#c-lib")
    assert "In your library: Ready.gov" in lib and "Read the full section" in lib
    assert f.query_selector(".fg-q .fg-lib") is None, "no prompt under each quote"
    f.evaluate("window.scrollTo(0, 99999)")
    assert "Floods | Ready.gov" in f.inner_text("#c-more")
    _shot(phone, "full-flood")
    f.click("#c-lib .fg-btn[data-act=open]")
    phone.wait_for_timeout(1500)
    assert (
        "/w/www.ready.gov/www.ready.gov/floods" in phone.url or "ready.gov" in phone.url
    )


def test_a_big_download_asks_inside_the_page_not_with_a_dialog(full, phone):
    asked = []
    phone.on("dialog", lambda d: (asked.append(d.message), d.dismiss()))
    _open(phone, full, "#fieldguide")
    # The shell's download call, recorded instead of sent.
    phone.evaluate(
        "window.__posts = []; window.manageFetch = function(u, o) { window.__posts.push(u); return Promise.resolve(new Response('{\"started\": 1}', { status: 200 })); }; 0"
    )
    f = _frame(phone)
    f.wait_for_selector(".fg-sit")
    f.click("#t-library")
    f.wait_for_selector("[data-all]")
    f.click("[data-all=core]")
    f.wait_for_selector(".fg-confirm")
    assert "Download it?" in f.inner_text(".fg-confirm")
    assert phone.evaluate("window.__posts") == [] and asked == []
    f.click(".fg-confirm [data-no]")
    assert f.query_selector(".fg-confirm") is None
    assert phone.evaluate("window.__posts") == []
    f.click("[data-all=core]")
    f.click(".fg-confirm [data-yes]")
    phone.wait_for_timeout(800)
    assert phone.evaluate("window.__posts") == ["/manage/download-batch"]
    assert asked == []


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
    f.check(".fg-tools .night-box")
    assert f.evaluate("localStorage.getItem('zimi_app_theme')") == "red"
    assert f.evaluate("document.documentElement.classList.contains('night-red')")
    bg = f.evaluate("getComputedStyle(document.body).backgroundColor")
    assert bg == "rgb(0, 0, 0)"
    _shot(phone, "empty-red")
    # The shell turns red with it (the browser delivers the storage event to the other
    # document a moment later, not inside the write), and the key written elsewhere is honoured here.
    phone.wait_for_function("document.documentElement.classList.contains('night-red')")
    f.uncheck(".fg-tools .night-box")
    assert f.evaluate("localStorage.getItem('zimi_app_theme')") is None
    phone.evaluate("localStorage.setItem('zimi_app_theme', 'red'); _appThemeChanged()")
    assert phone.evaluate("document.documentElement.classList.contains('night-red')")
    phone.evaluate("localStorage.removeItem('zimi_app_theme')")


def test_a_situation_prints_as_its_quotations_alone(empty, phone):
    _open(phone, empty, "#fieldguide/cold")
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
    # The address of the original is on the paper, not only a link.
    assert "https://" in f.evaluate(
        "getComputedStyle(document.querySelector('.fg-foot a'), '::after').content"
    )
    phone.emulate_media(media="screen")


def _stub_print(phone):
    phone.evaluate("window.__printed = 0; window.print = function() { window.__printed++; }; 0")


def test_print_goes_through_the_shell_once_and_prints_the_card(empty, phone):
    _open(phone, empty, "#fieldguide/cold")
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    _stub_print(phone)
    f.evaluate("window.__framePrints = 0; window.print = function() { window.__framePrints++; }; 0")
    f.evaluate("document.getElementById('c-print').click(); document.getElementById('c-print').click()")
    phone.wait_for_function("window.__printed >= 1", timeout=10000)
    phone.wait_for_timeout(400)
    assert phone.evaluate("window.__printed") == 1, "one tap, one print"
    assert f.evaluate("window.__framePrints") == 0, "the sandboxed frame never prints"
    root = phone.inner_text("#zimi-print-root")
    assert "Hypothermia" in root and "Original" in root
    assert phone.evaluate(
        "document.querySelectorAll('#zimi-print-root .fg-q').length"
    ) >= 3


def test_print_all_is_every_situation_in_one_sheet(empty, phone):
    _open(phone, empty, "#fieldguide")
    f = _frame(phone)
    f.wait_for_selector(".fg-sit")
    _stub_print(phone)
    f.click("#t-printall")
    phone.wait_for_function("window.__printed >= 1", timeout=20000)
    assert (
        phone.evaluate("document.querySelectorAll('#zimi-print-root .fg-sheet-sit').length")
        == 25
    )
    assert phone.evaluate(
        "Array.from(document.querySelectorAll('#zimi-print-root a')).some(a => a.href.indexOf('https://www.ready.gov/') === 0)"
    )
    text = phone.evaluate("document.getElementById('zimi-print-root').textContent")
    assert "Calling for help" in text and "Carbon monoxide" in text


def test_the_sky_of_the_readers_hemisphere_leads(empty, phone):
    _open(phone, empty)
    phone.evaluate(
        "localStorage.setItem('zimi_almanac_place', JSON.stringify({lat: -33.9, lon: 18.4, name: 'Cape Town'}))"
    )
    _open(phone, empty, "#fieldguide/lost")
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    heads = f.eval_on_selector_all(".fg-q h3", "els => els.map(e => e.textContent)")
    assert heads.index("Navigation with the Southern Cross") < heads.index("Northern Sky")
    phone.evaluate(
        "localStorage.setItem('zimi_almanac_place', JSON.stringify({lat: 51.5, lon: -0.1, name: 'London'}))"
    )
    _open(phone, empty, "#fieldguide/lost")
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    heads = f.eval_on_selector_all(".fg-q h3", "els => els.map(e => e.textContent)")
    assert heads.index("Northern Sky") < heads.index("Navigation with the Southern Cross")
    phone.evaluate("localStorage.removeItem('zimi_almanac_place')")


def test_a_superseded_source_says_so_on_its_quote(empty, phone):
    _open(phone, empty, "#fieldguide/cold")
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    assert "Superseded by ATP 4-02.11" in f.inner_text("#c-quotes")


# ── red night, the whole shell ──────────────────────────────────────────────


def _lum(rgb):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2])


def _contrast(a, b):
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def _rgb(text):
    import re

    return tuple(int(x) for x in re.findall(r"\d+", text)[:3])


def test_red_night_text_is_readable_everywhere_the_guide_goes(empty, phone):
    _open(phone, empty, "#fieldguide")
    phone.evaluate("localStorage.setItem('zimi_app_theme', 'red'); _appThemeChanged()")
    f = _frame(phone)
    f.wait_for_selector(".fg-sit")
    for sel in (".fg-disc", ".fg-group-h", ".fg-sit .mark"):
        fg_c = _rgb(f.evaluate("s => getComputedStyle(document.querySelector(s)).color", sel))
        bg_c = _rgb(f.evaluate("getComputedStyle(document.body).backgroundColor"))
        assert _contrast(fg_c, bg_c) >= 4.5, sel
    for var in ("--text", "--text2", "--text3"):
        shell = _rgb(
            phone.evaluate(
                "v => { var d = document.createElement('div'); d.style.color = 'var(' + v + ')'; document.body.appendChild(d); var c = getComputedStyle(d).color; d.remove(); return c; }",
                var,
            )
        )
        for surface in ("#000000", "#0d0000", "#160000"):
            rgb = tuple(int(surface[i : i + 2], 16) for i in (1, 3, 5))
            assert _contrast(shell, rgb) >= 4.5, (var, surface)
    phone.evaluate("localStorage.removeItem('zimi_app_theme')")


def test_the_switch_is_in_the_header_and_in_the_card_while_the_guide_is_open(
    empty, phone
):
    _open(phone, empty)
    assert not phone.is_visible("#night-btn")
    _open(phone, empty, "#fieldguide/cold")
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    assert phone.is_visible("#night-btn")
    assert f.is_visible("#card .night-box")
    phone.click("#night-btn")
    assert phone.evaluate("document.documentElement.classList.contains('night-red')")
    phone.wait_for_timeout(300)
    assert f.evaluate("document.documentElement.classList.contains('night-red')")
    assert f.is_checked("#card .night-box")
    phone.click("#night-btn")
    assert not phone.evaluate("document.documentElement.classList.contains('night-red')")


def test_an_app_page_is_stamped_red_in_the_head_before_it_paints(empty, phone):
    html = phone.request.get(empty + "/static/fieldguide.html").text()
    assert "zimi_app_theme" in html[: html.index("<body")], "stamped in the head"
    assert html.index("zimi_app_theme") < html.index("<style>")


def test_the_whole_shell_is_red_at_night(empty, phone):
    pil = pytest.importorskip("PIL.Image")
    import io

    _open(phone, empty)
    phone.evaluate("localStorage.setItem('zimi_app_theme', 'red'); _appThemeChanged()")
    phone.wait_for_timeout(1200)
    img = pil.open(io.BytesIO(phone.screenshot())).convert("RGB")
    px = list(img.getdata())
    bad = sum(1 for (r, g, b) in px if max(g, b) > 100 and max(g, b) > 0.5 * r)
    assert bad / len(px) < 0.004, "no logo, moon card or icon left in colour"
    phone.evaluate("localStorage.removeItem('zimi_app_theme')")


# ── first run ───────────────────────────────────────────────────────────────


def test_help_now_is_reachable_from_the_first_run_and_sign_in_screens(empty, phone):
    _open(phone, empty)
    phone.evaluate("_openSetup({ inside: true })")
    link = phone.wait_for_selector("#setup-card .help-now-gate")
    assert "Help now" in link.inner_text() and link.bounding_box()["height"] >= 44
    link.click()
    phone.wait_for_selector(".fg-sit", timeout=15000)
    assert "fieldguide.html" in phone.url
    phone.go_back()
    _open(phone, empty)
    phone.evaluate("_enterLoginGate()")
    assert phone.is_visible("#pw-helpnow .help-now-gate")


def test_at_a_private_servers_door_the_box_still_names_a_baby_choking(
    empty, phone, monkeypatch
):
    from zimi import users

    monkeypatch.setattr(users, "get_public_access", lambda: ("private", None))
    _open(phone, empty)
    phone.wait_for_selector("body.login-gate #pw-helpnow .help-now-gate")
    brand = phone.query_selector(".pw-brand")
    assert brand.is_visible() and brand.inner_text().strip() == "Zimi"
    phone.click("#pw-helpnow .help-now-gate")
    box = phone.wait_for_selector("#t-q", timeout=15000)
    box.fill("my baby is choking")
    phone.wait_for_selector(".fg-hit.lead[data-id=choking]", timeout=10000)
    # No library to search from the door, so no row that would do nothing.
    assert not phone.query_selector(".fg-hit.lib")
    box.press("Enter")
    phone.wait_for_selector("#card:not([hidden]) .fg-q")
    first = phone.query_selector("#c-quotes .fg-q h3, #c-quotes .fg-q h4")
    assert first.text_content().startswith("Infants")
    assert not phone.errors


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
    # Arabic chrome, English quotes: the page reads right to left, the quoted words do not.
    phone.evaluate("localStorage.setItem('zimi_ui_lang', 'ar')")
    _open(phone, empty, "#fieldguide/cold")
    f = _frame(phone)
    f.wait_for_selector(".fg-q")
    assert f.evaluate("document.documentElement.dir") == "rtl"
    assert (
        f.evaluate("getComputedStyle(document.querySelector('.fg-body')).direction")
        == "ltr"
    )
    assert (
        f.evaluate("getComputedStyle(document.querySelector('.fg-q h3')).direction")
        == "ltr"
    )
    phone.evaluate("localStorage.removeItem('zimi_ui_lang')")
