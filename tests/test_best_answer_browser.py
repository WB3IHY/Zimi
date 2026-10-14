"""The best answer card, in a real browser, the way a person meets it.

A question is asked on a phone (390px) and a desktop. The results come first;
the card follows from its own request, first in the list, a quote with its
sentence marked and its source named; a keyword search asks for no card; the
next search cancels the request of the last; a tap opens the article with the
sentence found, painted and in view. English, German and right-to-left Hebrew
chrome, light and dark.

Screenshots go to $ZIMI_SHOTS when it is set.
"""

import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PHONE = {"width": 390, "height": 844}
DESKTOP = {"width": 1280, "height": 900}
SHOTS = os.environ.get("ZIMI_SHOTS")
QUESTION = "how to purify water"


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    import zimi.renderer as renderer

    if not renderer.browser_available():
        pytest.skip("playwright + chromium are not usable here")
    from http.server import ThreadingHTTPServer

    import zimi.server as srv
    from conftest_zim import build_answer_fixture_zim, build_wiki_fixture_zim
    from zimi.http import ZimHandler

    tmp = tmp_path_factory.mktemp("bestbrowser")
    zdir = tmp / "zims"
    zdir.mkdir()
    build_answer_fixture_zim(str(zdir / "wikipedia_en_test.zim"))
    # A second source, as a library has: the search is then across all of them.
    build_wiki_fixture_zim(str(zdir / "almanac_en_test.zim"))
    old = (srv.ZIM_DIR, srv.ZIMI_DATA_DIR, os.environ.get("ZIMI_OFFLINE"))
    os.environ["ZIMI_OFFLINE"] = "1"
    srv.ZIM_DIR = str(zdir)
    srv.ZIMI_DATA_DIR = str(tmp / "data")
    os.makedirs(srv.ZIMI_DATA_DIR, exist_ok=True)
    srv.load_cache(force=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), ZimHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield "http://127.0.0.1:%d" % httpd.server_address[1]
    httpd.shutdown()
    srv.ZIM_DIR, srv.ZIMI_DATA_DIR = old[0], old[1]
    if old[2] is None:
        os.environ.pop("ZIMI_OFFLINE", None)
    else:
        os.environ["ZIMI_OFFLINE"] = old[2]


def _page(pw, base, phone=True, locale="en-US", scheme="dark"):
    br = pw.chromium.launch()
    ctx = br.new_context(
        viewport=PHONE if phone else DESKTOP,
        locale=locale,
        is_mobile=phone,
        has_touch=phone,
        color_scheme=scheme,
    )
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(base + "/")
    pg.wait_for_function(
        "() => typeof zimsCache !== 'undefined' && zimsCache && zimsCache.length === 2",
        timeout=30000,
    )
    return br, pg, errors


def _ask(pg, query):
    pg.locator("#q").fill(query)
    pg.locator("#q").press("Enter")
    pg.wait_for_function(
        "(q) => allResults && allResults._query === q && !allResults.partial",
        arg=query,
        timeout=30000,
    )


def _shot(pg, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        pg.screenshot(path=os.path.join(SHOTS, name + ".png"))


def _delay_card(monkeypatch, delays):
    """Hold the card on the server (a slow disk) for `delays[word]` seconds
    when the question holds `word`, so the order things arrive in can be
    seen. Returns the list of questions the server was asked."""
    import zimi.server as srv

    real = srv.best_answer_for
    asked = []

    def slow(q, *a, **k):
        asked.append(q)
        for word, seconds in delays.items():
            if word in q:
                time.sleep(seconds)
        return real(q, *a, **k)

    monkeypatch.setattr(srv, "best_answer_for", slow)
    return asked


@pytest.mark.parametrize(
    "phone,locale,scheme",
    [
        (True, "en-US", "dark"),
        (True, "en-US", "light"),
        (False, "en-US", "dark"),
        (True, "de-DE", "dark"),
        (True, "he-IL", "dark"),
    ],
)
def test_results_first_then_the_card_above_them(served, monkeypatch, phone, locale, scheme):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        br, pg, errors = _page(pw, served, phone, locale, scheme)
        asked = _delay_card(monkeypatch, {"purify": 1.0})
        _ask(pg, QUESTION)
        # The results are drawn; the card is still on its way.
        pg.wait_for_selector("#output a.result")
        assert pg.locator("#output .best-card").count() == 0
        _shot(
            pg,
            "results-first-%s-%s-%s"
            % ("phone" if phone else "desktop", locale, scheme),
        )
        pg.wait_for_selector("#output .best-card", timeout=15000)

        # First in the list, a quote with its sentence marked and its source.
        assert pg.evaluate(
            "document.querySelector('#output').firstElementChild.classList.contains('search-card-slot')"
        )
        mark = pg.locator("#output .best-card mark.bq-hit").first.inner_text()
        assert (
            "boil it for one minute" in mark.lower() or "Water purification is" in mark
        )
        card_text = pg.locator("#output .best-card").inner_text()
        assert "Water purification" in card_text and "Wikipedia" in card_text
        assert "answer" not in card_text.lower()
        assert "Water purification Water purification" not in card_text  # no title stutter
        # The label is the UI language's own, not the key.
        assert "best_from" not in card_text
        if locale.startswith("de"):
            assert "Aus Water purification, Wikipedia" in card_text
        if locale.startswith("he"):
            assert "מתוך" in card_text
        # The card fits the screen, however narrow.
        assert pg.evaluate(
            "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
        )
        assert asked == [QUESTION]
        _shot(pg, "card-%s-%s-%s" % ("phone" if phone else "desktop", locale, scheme))
        assert errors == [], errors
        br.close()


def test_a_keyword_search_asks_for_no_card(served):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        br, pg, errors = _page(pw, served)
        asked = []
        pg.on(
            "request", lambda r: asked.append(r.url) if "/bestanswer" in r.url else None
        )
        _ask(pg, "water purification")
        pg.wait_for_selector("#output a.result")
        time.sleep(0.5)
        assert asked == [] and pg.locator(".best-card").count() == 0
        assert errors == [], errors
        br.close()


def test_a_question_nothing_answers_leaves_the_results_alone(served):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        br, pg, errors = _page(pw, served)
        _ask(pg, "who won the world cup in 1998")
        time.sleep(1.0)
        assert pg.locator(".best-card").count() == 0
        assert pg.locator(".search-card-slot").count() == 0
        assert errors == [], errors
        br.close()


def test_the_next_search_cancels_the_card_before_it_lands(served, monkeypatch):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        br, pg, errors = _page(pw, served)
        failed = []
        pg.on(
            "requestfailed",
            lambda r: failed.append(r.url) if "/bestanswer" in r.url else None,
        )

        # The first question's card is held for four seconds, the second's is not.
        _delay_card(monkeypatch, {"purify": 4.0})
        _ask(pg, QUESTION)
        pg.wait_for_selector("#output a.result")
        _ask(pg, "who painted the mona lisa")
        pg.wait_for_selector("#output .best-card", timeout=15000)
        assert "Leonardo" in pg.locator("#output .best-card").inner_text()
        time.sleep(4.5)  # the held one would have landed by now
        text = pg.locator("#output").inner_text()
        assert "Leonardo" in text and "boil it for one minute" not in text.lower()
        assert pg.locator(".best-card").count() == 1
        assert any(
            "purify" in u for u in failed
        ), failed  # it was cancelled, not ignored
        assert errors == [], errors
        br.close()


@pytest.mark.parametrize("phone", [True, False])
def test_a_tap_opens_the_article_at_the_sentence(served, phone):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        br, pg, errors = _page(pw, served, phone)
        _ask(pg, QUESTION)
        pg.wait_for_selector("#output .best-card")
        quote = pg.locator("#output a.best-quote").first.get_attribute("data-quote")
        pg.locator("#output a.best-quote").first.click()
        pg.wait_for_selector("#reader.open")
        # The sentence is painted in the article (the highlight find-in-page
        # uses) and is on screen.
        pg.wait_for_function(
            """() => {
                const w = document.getElementById('reader-frame').contentWindow;
                const h = w && w.CSS && w.CSS.highlights && w.CSS.highlights.get('zimi-find');
                return !!h && h.size === 1;
            }""",
            timeout=15000,
        )
        got = pg.evaluate("""() => {
                const w = document.getElementById('reader-frame').contentWindow;
                const r = Array.from(w.CSS.highlights.get('zimi-find'))[0];
                const b = r.getBoundingClientRect();
                return { text: r.toString(), top: b.top, bottom: b.bottom, h: w.innerHeight };
            }""")
        assert got["text"].replace("\n", " ").strip() == quote.strip(), got
        assert 0 <= got["top"] and got["bottom"] <= got["h"], got
        pg.wait_for_function(
            "() => document.getElementById('reader-loading').classList.contains('hidden')"
        )
        pg.wait_for_timeout(600)  # the loading veil fades out over 0.3s
        _shot(pg, "opened-%s" % ("phone" if phone else "desktop"))
        # Touching the page lets the mark go.
        pg.evaluate(
            "document.getElementById('reader-frame').contentDocument.body.dispatchEvent(new Event('pointerdown', {bubbles: true}))"
        )
        pg.wait_for_function(
            """() => {
                const w = document.getElementById('reader-frame').contentWindow;
                const h = w.CSS.highlights.get('zimi-find');
                return !h || h.size === 0;
            }""",
            timeout=5000,
        )
        assert errors == [], errors
        br.close()


def test_a_sentence_far_down_the_article_is_scrolled_into_view(served):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        br, pg, errors = _page(pw, served, True)
        _ask(pg, "what causes the tides")
        pg.wait_for_selector("#output .best-card")
        assert "gravity of the Moon" in pg.locator("#output .best-card mark").first.inner_text()
        pg.locator("#output a.best-quote").first.click()
        pg.wait_for_selector("#reader.open")
        pg.wait_for_function(
            """() => {
                const w = document.getElementById('reader-frame').contentWindow;
                const h = w && w.CSS && w.CSS.highlights && w.CSS.highlights.get('zimi-find');
                if (!h || h.size !== 1) return false;
                const b = Array.from(h)[0].getBoundingClientRect();
                return w.scrollY > 500 && b.top >= 0 && b.bottom <= w.innerHeight;
            }""",
            timeout=15000,
        )
        pg.wait_for_timeout(800)
        _shot(pg, "opened-far-down-phone")
        assert errors == [], errors
        br.close()
