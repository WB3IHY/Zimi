"""Zimi Earth's places: reading where an article is, and asking for a view.

Run: pytest tests/test_earth.py -v
"""

import os
import sys

import pytest

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import zimi.server as srv  # noqa: E402
from zimi import earth  # noqa: E402

MW = "mwoffliner 1.14.0"

# English Wikipedia's head, with enough styles before the line that a short
# read of the page would miss it (Everest's is 58 KB).
BIG_HEAD = b"<style>" + b"x" * 70_000 + b"</style>"


def page(body=b"", head=b""):
    return b"<html><head>" + head + b"</head><body>" + body + b"</body></html>"


def meta(lat, lon):
    return b'<meta name="geo.position" content="%s;%s"/>' % (lat, lon)


def link(lat, lon):
    return b'<a rel="mw:ExtLink" href="geo:%s,%s" class="external text">' % (lat, lon)


# ── reading a page ──


def test_the_meta_line_names_the_place():
    assert earth.parse_geo(page(head=meta(b"48.8567", b"2.3522"))) == (48.8567, 2.3522)


def test_the_meta_line_is_found_behind_a_long_head():
    assert earth.parse_geo(
        page(head=BIG_HEAD + meta(b"27.98833333", b"86.92527778"))
    ) == (
        27.98833333,
        86.92527778,
    )


def test_a_geo_link_stands_in_where_there_is_no_meta_line():
    assert earth.parse_geo(page(body=link(b"-41.61", b"173.52"))) == (-41.61, 173.52)


def test_an_infoboxs_hidden_decimal_is_the_last_resort():
    data = page(
        body=b'<span class="geo-dec">25.5\xc2\xb0G</span><span style="display:none"> / '
        b'<span class="geo">-25.56250; -67.88083</span></span>'
    )
    assert earth.parse_geo(data) == (-25.5625, -67.88083)


def test_the_meta_line_wins_over_a_link():
    got = earth.parse_geo(page(head=meta(b"10.5", b"20.5"), body=link(b"1", b"2")))
    assert got == (10.5, 20.5)


def test_content_before_name_is_read_too():
    data = page(head=b'<meta content="35.2;74.6" name="geo.position"/>')
    assert earth.parse_geo(data) == (35.2, 74.6)


@pytest.mark.parametrize(
    "data",
    [
        page(),
        page(head=meta(b"91", b"10")),  # not on Earth
        page(head=meta(b"10", b"181")),
        page(head=meta(b"0", b"0")),  # a blank field, not Null Island
        page(head=b'<meta name="geo.position" content="n/a"/>'),
        b"",
    ],
)
def test_nothing_is_not_a_place(data):
    assert earth.parse_geo(data) is None


# ── the library ──


def _article(path, title, html):
    from conftest_zim import _Article

    return _Article(path, title, html)


def _zim(path, articles, name, project, language="eng"):
    from libzim.writer import Creator

    with Creator(path).config_indexing(False, language) as creator:
        creator.set_mainpath(articles[0][0])
        for p, t, h in articles:
            creator.add_item(_article(p, t, h))
        for k, v in {
            "Title": project.title(),
            "Language": language,
            "Description": "fixture",
            "Scraper": MW,
            "Name": name,
        }.items():
            creator.add_metadata(k, v)
    return path


PARIS = (b"48.8567", b"2.3522")
LIBRARY = {
    "wikipedia_en_all_maxi_2026-08.zim": (
        "wikipedia_en_all",
        "wikipedia",
        "eng",
        [
            ("A/Paris", "Paris", page(b"p" * 3000, meta(*PARIS))),
            (
                "A/Eiffel_Tower",
                "Eiffel Tower",
                page(b"e" * 900, meta(b"48.8582", b"2.2945")),
            ),
            ("A/Sydney", "Sydney", page(b"s" * 2000, meta(b"-33.8688", b"151.2093"))),
            ("A/Taveuni", "Taveuni", page(b"t" * 400, meta(b"-16.8", b"179.9"))),
            ("A/Apia", "Apia", page(b"a" * 300, meta(b"-13.8", b"-171.8"))),
            ("A/Water", "Water", page(b"no place here")),
        ],
    ),
    "wikivoyage_fr_all_nopic_2026-08.zim": (
        "wikivoyage_fr_all",
        "wikivoyage",
        "fra",
        [("A/Paris", "Paris (guide)", page(link(b"48.85", b"2.35")))],
    ),
}


@pytest.fixture
def library(tmp_path, monkeypatch):
    zdir = tmp_path / "zims"
    zdir.mkdir()
    for filename, (name, project, lang, articles) in LIBRARY.items():
        _zim(str(zdir / filename), articles, name, project, lang)
    monkeypatch.setattr(srv, "ZIM_DIR", str(zdir))
    monkeypatch.setattr(srv, "ZIMI_DATA_DIR", str(tmp_path / "data"))
    os.makedirs(str(tmp_path / "data"), exist_ok=True)
    earth._reset_for_tests()
    srv.load_cache(force=True)
    earth.build_all_places()
    return tmp_path


def _name(prefix):
    return next(z["name"] for z in srv._zim_list_cache if z["name"].startswith(prefix))


def test_every_geo_wiki_is_read_into_a_file_of_its_own(library):
    assert earth.place_count(_name("wikipedia")) == 5  # Water has none
    assert earth.place_count(_name("wikivoyage")) == 1
    assert earth.has_places()


def test_a_view_holds_the_places_in_it_biggest_first(library):
    got = earth.places_in(2.2, 48.8, 2.4, 48.9)
    assert [p["title"] for p in got] == ["Paris", "Eiffel Tower"]
    assert got[0]["zim"] == _name("wikipedia") and got[0]["path"] == "A/Paris"


def test_the_whole_globe_is_asked_by_size_and_stops_at_the_limit(library):
    got = earth.places_in(-180, -90, 180, 90, limit=2)
    assert [p["title"] for p in got] == ["Paris", "Sydney"]


def test_a_view_over_the_antimeridian_holds_both_sides(library):
    got = earth.places_in(170, -30, -170, -10)
    assert {p["title"] for p in got} == {"Taveuni", "Apia"}


def test_a_neighbourhood_is_one_dot(library):
    # The tower stands 5 km from Paris: in a view the size of France it is
    # the same dot; close in, they are two.
    wide = earth.places_in(-5, 41, 9, 51)
    assert [p["title"] for p in wide] == ["Paris"]
    close = earth.places_in(2.2, 48.8, 2.4, 48.9)
    assert [p["title"] for p in close] == ["Paris", "Eiffel Tower"]


def test_wikivoyage_is_asked_for_by_name(library):
    got = earth.places_in(0, 40, 10, 55, project="wikivoyage")
    assert [p["title"] for p in got] == ["Paris (guide)"]


def test_a_tapped_point_gets_its_article_and_its_guide(library):
    got = earth.near(48.86, 2.34)
    assert [a["title"] for a in got["articles"]] == ["Paris"]
    assert got["articles"][0]["km"] < 5
    assert [g["title"] for g in got["guides"]] == ["Paris (guide)"]
    assert got["guides"][0]["language"] == "fr"


def test_open_sea_has_no_article_and_a_far_guide_is_not_offered(library):
    got = earth.near(0.0, -30.0)
    assert got == {"articles": [], "guides": []}


def test_nothing_read_yet_is_an_empty_globe(tmp_path, monkeypatch):
    monkeypatch.setattr(srv, "ZIMI_DATA_DIR", str(tmp_path))
    earth._reset_for_tests()
    assert earth.places_in(-180, -90, 180, 90) == []
    assert not earth.has_places()
