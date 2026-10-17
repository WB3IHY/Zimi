"""The Field Guide where the reader is: the emergency number for the time
zone's country, the sky of their hemisphere and the sky strip, and a search
that answers at once. Run in a real browser at a phone's width, with the
device's time zone and clock set.

Run: pytest tests/test_fieldguide_live_place.py -v
"""

import os
import sys

import pytest

pytestmark = pytest.mark.fieldguide_on

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_fieldguide_live import (
    _frame,
    _open,
    _search,
    _shot,
    empty,
    full,
    pw,
)  # noqa: E402,F401


@pytest.fixture
def at(pw):
    """A phone whose time zone (and, optionally, clock) is chosen."""
    opened = []

    def make(tz, now=None):
        b = pw.chromium.launch()
        ctx = b.new_context(**pw.devices["iPhone 15"], timezone_id=tz)
        if now:
            ctx.clock.set_fixed_time(now)
        pg = ctx.new_page()
        pg.errors = []
        pg.on("pageerror", lambda e: pg.errors.append(str(e)))
        opened.append((ctx, b))
        return pg

    yield make
    for ctx, b in opened:
        ctx.close()
        b.close()


def _card(pg, base, sid):
    _open(pg, base, "#fieldguide/" + sid)
    f = _frame(pg)
    f.wait_for_selector(".fg-q")
    return f


def test_every_card_for_someone_hurt_leads_with_the_number_where_they_are(empty, at):
    sydney = at("Australia/Sydney")
    f = _card(sydney, empty, "bleeding")
    f.wait_for_selector("#c-num .fg-num")
    assert f.inner_text("#c-num b") == "Emergency number here: 000"
    assert "CC BY-SA 4.0" in f.inner_text("#c-num")
    # It is above the first quote, and on screen without scrolling.
    top = f.evaluate(
        "[document.querySelector('#c-num').getBoundingClientRect().bottom, document.querySelector('.fg-q').getBoundingClientRect().top]"
    )
    assert top[0] <= top[1] and top[0] < 400
    _shot(sydney, "number-bleeding-sydney")
    # The front says it too; a card for a disaster does not.
    sydney.goto("about:blank")
    _open(sydney, empty, "#fieldguide")
    f = _frame(sydney)
    f.wait_for_selector("#t-num .fg-num")
    assert "000" in f.inner_text("#t-num")
    _shot(sydney, "number-front-sydney")
    f = _card(sydney, empty, "flood")
    sydney.wait_for_timeout(500)
    assert f.inner_text("#c-num") == ""
    assert f.query_selector("#c-num .fg-num") is None


def test_the_number_follows_the_country_and_an_unknown_one_says_so(empty, at):
    for tz, want in (
        ("America/Denver", "Emergency number here: 911"),
        ("Europe/London", "Emergency number here: 999 or 112"),
        ("Africa/Windhoek", "Emergency numbers here: Police 10 111"),
        ("Etc/UTC", "Emergency number: 112 / 911"),
    ):
        pg = at(tz)
        f = _card(pg, empty, "not_breathing")
        f.wait_for_selector("#c-num .fg-num")
        assert f.inner_text("#c-num b").startswith(want), (tz, f.inner_text("#c-num b"))


def test_not_breathing_puts_the_compression_steps_on_the_first_screen(empty, at):
    pg = at("America/Denver")
    f = _card(pg, empty, "not_breathing")
    f.wait_for_selector("#c-num .fg-num")
    box = f.evaluate(
        "(() => { var li = Array.from(document.querySelectorAll('.fg-q p, .fg-q li')).find(e => /Hand Placement/.test(e.textContent)); return li.getBoundingClientRect().bottom })()"
    )
    assert box < pg.viewport_size["height"], (
        "Hand Placement is on the first screen (%s)" % box
    )
    _shot(pg, "not-breathing-first-screen")


def test_choking_is_a_card_with_its_scope_and_an_infant_passage(empty, at):
    pg = at("America/Denver")
    f = _card(pg, empty, "choking")
    text = f.inner_text("#c-quotes")
    assert (
        "Prior to applying abdominal thrust, first responders should administer five back blows."
        in text
    )
    assert "Covers:" in text and "Infants (babies under 1 year-old)" in text
    assert "CC BY-SA 4.0" in text and "US government work" in text
    assert (
        "Abdominal thrusts are not recommended in children less than one year old"
        in text
    )
    assert f.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    _shot(pg, "choking")


def test_lost_in_sydney_leads_with_the_southern_cross_and_the_sky_strip_says_it_is_a_guess(
    empty, at
):
    # 15 October 2026, 18:50 in Sydney: about 15 minutes of light left.
    pg = at("Australia/Sydney", "2026-10-15T18:50:00+11:00")
    f = _card(pg, empty, "lost")
    f.wait_for_selector("#c-sky dt", timeout=30000)
    heads = f.eval_on_selector_all(".fg-q h3", "els => els.map(e => e.textContent)")
    cross = heads.index("Navigation with the Southern Cross")
    assert cross < heads.index("Northern Sky"), heads
    assert heads[:3] == [
        "Stop, Think, Observe, Plan",
        "If You Get Lost: self rescue, seek help",
        "Hug-A-Tree (for children)",
    ]
    sky = f.inner_text("#c-sky")
    for want in (
        "Daylight left",
        "Fully dark from",
        "Moon",
        "True south",
        "Place guessed from your time zone (Sydney)",
    ):
        assert want in sky, (want, sky)
    assert "about" in sky
    _shot(pg, "lost-sydney")
    assert f.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    assert pg.errors == []


def test_the_sky_strip_is_on_signal_shelter_flood_and_cold_and_not_on_bleeding(
    empty, at
):
    pg = at("America/Denver", "2026-10-15T12:00:00-06:00")
    for sid in ("signal", "shelter", "flood", "cold"):
        f = _card(pg, empty, sid)
        f.wait_for_selector("#c-sky dt", timeout=30000)
        assert "True north" in f.inner_text("#c-sky"), sid
    f = _card(pg, empty, "bleeding")
    pg.wait_for_timeout(1500)
    assert f.is_hidden("#c-sky")


def test_flood_has_the_electricity_warning_second_and_a_way_to_power_out(empty, at):
    pg = at("America/Denver")
    f = _card(pg, empty, "flood")
    heads = f.eval_on_selector_all(".fg-q h3", "els => els.map(e => e.textContent)")
    assert heads[:2] == ["During a Flood", "After a Flood: electricity and water"]
    chip = f.wait_for_selector("#c-related [data-sit=power_out]")
    assert chip.inner_text() == "Power out"
    _shot(pg, "flood")
    chip.click()
    f.wait_for_function(
        "document.querySelector('#c-title').textContent === 'Power out'"
    )


def test_a_bare_lost_shows_help_now_at_once_while_the_search_hangs(full, at):
    pg = at("America/Denver")
    pg.route("**/search?*", lambda route: None)  # the library-wide search never answers
    _open(pg, full)
    pg.fill(".topbar input", "lost")
    pg.keyboard.press("Enter")
    link = pg.wait_for_selector("[data-card=fieldguide] .help-now", timeout=3000)
    assert link.inner_text().strip() == "Help now: Lost"
    assert pg.query_selector(".did-you-mean") is None


def test_the_best_answer_is_never_asked_when_the_guide_answers(full, at):
    pg = at("America/Denver")
    asked = []
    pg.on("request", lambda r: asked.append(r.url) if "/bestanswer" in r.url else None)
    _open(pg, full)
    _search(pg, "how do i stop bleeding")
    pg.wait_for_selector("[data-card=fieldguide] .fg-q", timeout=20000)
    pg.wait_for_timeout(1500)
    assert asked == []
    assert pg.query_selector(".best-card") is None
    # A question the guide does not answer is still the best answer's to ask.
    _search(pg, "how do plants make sugar from light")
    pg.wait_for_timeout(2500)
    assert pg.query_selector("[data-card=fieldguide]") is None
    assert asked, "the best answer card still asks when the guide has nothing to say"


def test_help_now_is_the_first_pill_of_the_apps_row(full, at):
    pg = at("America/Denver")
    _open(pg, full)
    row = pg.evaluate(
        "(() => { var h = document.querySelector('#output .cat-heading'); var p = document.querySelector('#output .apps-help .help-now'); "
        "return [h.textContent, h.getBoundingClientRect().bottom, p.getBoundingClientRect().top, p.getBoundingClientRect().height, "
        "document.querySelectorAll('.help-now').length, p.querySelector('svg path').getAttribute('d')] })()"
    )
    assert (
        row[0].strip().startswith("Apps") and row[1] <= row[2] and row[3] >= 44 and row[4] == 1
    )
    _shot(pg, "home-help-now")
