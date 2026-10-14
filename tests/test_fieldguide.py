"""The Field Guide: situations over the open sources and the library.

Zimi writes no first-aid or survival instruction. What a situation shows is
quoted word for word from a source with its edition, place, licence and a
link, and these tests hold that to the letter: every quote is complete, its
licence is on the allowed list, its words are in the source it names (the
sources' text is kept in tests/fixtures/fieldguide), and nothing from a
source we may not quote is there. The keyword table finds a situation in ten
languages without hijacking a search for something else, the search answer
carries the hint, and a situation finds its pages in the installed ZIMs and
names, with sizes, the ZIMs that would add more.

Run: pytest tests/test_fieldguide.py -v
"""

import gzip
import json
import os
import re
import sys
import threading
import urllib.parse
import urllib.request

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fieldguide_fixture as fx  # noqa: E402
import zimi.server as srv  # noqa: E402
from zimi import fieldguide as fg  # noqa: E402

FIXTURES = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "fixtures", "fieldguide"
)
LANGS = ("en", "es", "fr", "de", "pt", "ru", "ar", "he", "hi", "zh")
# What a source's text layer gives and a quote does not: bullet glyphs, the
# whitespace of wrapped lines, hyphens (a word split at a line end).
_GLYPHS = ""


def _fixture(name):
    with gzip.open(
        os.path.join(FIXTURES, name + ".txt.gz"), "rt", encoding="utf8"
    ) as f:
        return f.read()


def _flat(text):
    return re.sub(r"[\s\-" + _GLYPHS + "]+", "", text)


# The running heads, feet and page numbers a text layer puts between the lines
# of a page break: not the source's words.
_FURNITURE = re.compile(
    r"^\s*(?:\d{1,3}(?:-\d{1,3})?"
    r"|Chapter \d+"
    r"|TCCC Guidelines 2026"
    r"|.*\(081-[A-Z0-9-]+\)"
    r"|\d{1,2} \w+ \d{4}\s+TC 4-02\.1.*"
    r"|.*TC 4-02\.1(?:, C\d)?\s+\d{1,2} \w+ \d{4})\s*$"
)


def _source_text(name):
    return _flat(
        "\n".join(
            ln for ln in re.split(r"[\n\f]", _fixture(name)) if not _FURNITURE.match(ln)
        )
    )


def _all_quotes():
    return [(sid, q) for sid, qs in fg.quotes()["quotes"].items() for q in qs]


def _fixture_name(q):
    return {
        "tccc": "tccc2026",
        "epa": "epa-water",
        "ready": "ready-" + q.get("slug", ""),
    }.get(q["source"], q["source"])


# ── the quotes ──────────────────────────────────────────────────────────────


def test_every_quote_has_source_edition_place_licence_and_link():
    doc = fg.quotes()
    assert doc["quotes"], "no quotes"
    for sid, q in _all_quotes():
        where = sid + " / " + q.get("id", "?")
        src = doc["sources"][q["source"]]
        assert q["heading"].strip(), where
        assert q["locator"].strip(), where
        assert q["lines"] and all(
            isinstance(x, str) and x.strip() for x in q["lines"]
        ), where
        assert (q.get("edition") or src["edition"]).strip(), where + " has no edition"
        assert (q.get("year") or src["year"]) > 1900, where + " has no year"
        assert src["publisher"].strip() and src["title"].strip(), where
        assert src["licence"] in doc["licences"], "%s: licence %r is not allowed" % (
            where,
            src["licence"],
        )
        assert q["url"].startswith("https://"), where


def test_nothing_from_a_source_we_may_not_quote():
    blob = (
        json.dumps(fg.quotes()["sources"]).lower()
        + json.dumps([q["url"] for _s, q in _all_quotes()]).lower()
    )
    for banned in (
        "hesperian",
        "wikihow",
        "redcross.org",
        "adam",
        "/ency/",
        "medlineplus",
    ):
        assert banned not in blob, banned
    assert set(fg.quotes()["licences"]) <= {
        "US-PD",
        "CC BY 4.0",
        "CC BY-SA 4.0",
        "CC BY 3.0",
        "CC BY-SA 3.0",
    }


def test_quotes_are_the_sources_own_words():
    """Each line is in the text of the source it names (kept as a fixture),
    allowing for what a text layer changes (listed in the quote's ocr)."""
    texts = {}
    for sid, q in _all_quotes():
        name = _fixture_name(q)
        texts.setdefault(name, _source_text(name))
        lines = list(q["lines"])
        if q.get("table"):
            t = q["table"]
            lines += (
                t["head"] + [c for row in t["rows"] for c in row] + [t.get("foot", "")]
            )
        for line in lines:
            printed = line
            for right, wrong in q.get("ocr", []):
                printed = printed.replace(right, wrong)
            assert _flat(printed) in texts[name], "%s / %s: not in %s: %r" % (
                sid,
                q["id"],
                name,
                line[:90],
            )


def test_a_quote_cut_short_or_changed_is_caught():
    """The check above is not vacuous: a changed word is not found."""
    text = _source_text("tc4021")
    assert _flat("Twist the windlass until the bleeding stops.") in text
    assert _flat("Twist the windlass until the bleeding slows.") not in text


def test_every_situation_has_quotes_and_the_groups_name_each_once():
    d = fg.data()
    in_groups = [s for g in d["groups"] for s in g["situations"]]
    assert sorted(in_groups) == sorted(
        d["situations"]
    ), "a situation is in no group or two"
    for sid in in_groups:
        assert fg.quotes()["quotes"].get(sid), sid + " has no quotes"


def test_quotes_run_newest_source_first():
    for sid, qs in fg.quotes()["quotes"].items():
        years = [q["year"] for q in qs]
        assert years == sorted(years, reverse=True), sid


def test_the_disclaimer_is_the_one_sentence():
    assert fg.DISCLAIMER == "Not medical advice. Call emergency services if you can."
    assert fg.home()["disclaimer"] == fg.DISCLAIMER


def test_the_shell_knows_every_situation_and_has_every_word_it_asks_for():
    """app.js lists the situations (to check an address) and the words it
    hands the page; each must exist, in every language."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, "zimi", "static", "app.js"), encoding="utf8") as f:
        js = f.read()
    listed = re.search(r"var _FIELDGUIDE_SITUATIONS = \[(.*?)\];", js, re.S).group(1)
    assert sorted(re.findall(r"'(\w+)'", listed)) == sorted(fg.data()["situations"])
    words = re.search(r"var _FIELDGUIDE_WORDS = \[(.*?)\];", js, re.S).group(1)
    keys = re.findall(r"'(fieldguide_\w+)'", words) + [
        "fieldguide",
        "fieldguide_search_placeholder",
    ]
    keys += ["fieldguide_s_" + sid for sid in fg.data()["situations"]]
    for lang in LANGS:
        with open(
            os.path.join(root, "zimi", "static", "i18n", lang + ".json"),
            encoding="utf8",
        ) as f:
            have = json.load(f)
        assert not [k for k in keys if k not in have], lang


def test_no_authored_instruction_in_the_data():
    """Our own words are names and navigation: the situation data holds no
    sentences of advice (the keywords are words people type)."""
    for sid, sit in fg.data()["situations"].items():
        for lang, words in sit["keywords"].items():
            assert all(len(w.split()) <= 6 for w in words), (sid, lang)


# ── what is typed ───────────────────────────────────────────────────────────

TYPED = {
    "bleeding": [
        "bleeding",
        "tourniquet",
        "how to stop bleeding",
        "Stop Bleeding!",
        "saignement",
        "blutung",
        "止血",
        "кровотечение",
    ],
    "water": [
        "water",
        "drinking water",
        "purify water",
        "agua potable",
        "wasser",
        "вода",
        "水",
    ],
    "lost": ["lost", "i'm lost", "perdido", "迷路"],
    "cold": ["hypothermia", "frostbite", "hipotermia", "unterkühlung", "低温症"],
    "heat": ["heat stroke", "dehydration", "golpe de calor", "hitzschlag"],
    "choking": ["choking", "heimlich maneuver", "atragantamiento"],
    "not_breathing": ["cpr", "not breathing", "reanimación"],
    "burns": ["burn", "burns", "quemadura", "brûlure"],
    "shock": ["shock", "état de choc"],
    "shelter": ["shelter", "build a shelter", "make a fire", "refugio"],
    "food": ["food", "preserve food", "comida"],
    "signal": ["signal for help", "sos", "pedir ayuda"],
    "flood": ["flood", "flash flood", "inundación", "hochwasser"],
    "earthquake": ["earthquake", "terremoto", "地震"],
    "wildfire": ["wildfire", "forest fire", "incendio forestal"],
    "storm": ["tornado", "hurricane", "thunderstorm", "ouragan"],
    "power_out": ["power outage", "blackout", "stromausfall", "apagón"],
}


@pytest.mark.parametrize("sid", sorted(TYPED))
def test_typed_words_name_their_situation(sid):
    for text in TYPED[sid]:
        assert fg.match(text) == sid, text


def test_every_language_can_find_every_situation():
    for sid, sit in fg.data()["situations"].items():
        for lang in LANGS:
            assert sit["keywords"].get(lang), "%s has no %s keywords" % (sid, lang)


def test_first_aid_and_survival_name_the_field_guide_itself():
    for text in ("first aid", "survival", "primeros auxilios", "erste hilfe", "急救"):
        assert fg.match(text) == "", text


def test_other_words_in_the_query_name_nothing():
    for text in (
        "water cycle",
        "the lost city of atlantis",
        "burn notice",
        "",
        "   ",
        "x" * 200,
        "heat pump installation",
    ):
        assert fg.match(text) is None, text


def test_no_phrase_names_two_situations():
    seen = {}
    for sid, sit in fg.data()["situations"].items():
        for words in sit["keywords"].values():
            for w in words:
                n = fg.normalize(w)
                assert seen.setdefault(n, sid) == sid, "%r is in %s and %s" % (
                    w,
                    seen[n],
                    sid,
                )


def test_normalize_keeps_scripts_it_must_and_drops_accents_it_may():
    assert fg.normalize("  Hipotermía! ") == "hipotermia"
    assert fg.normalize("I'm LOST") == "im lost"
    assert fg.normalize("प्राथमिक चिकित्सा") == "प्राथमिक चिकित्सा"
    assert fg.normalize("نزيف") == "نزيف"


def test_matching_is_a_lookup_not_a_scan():
    """The search path pays an in-memory dict lookup (the table is built
    once) and reads no ZIM."""
    fg.match("bleeding")
    built = fg._index
    for _ in range(3):
        fg.match("water")
    assert fg._index is built


# ── a library to open a situation in ────────────────────────────────────────


@pytest.fixture(scope="module")
def library(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("fieldguide")
    zdir = tmp / "zims"
    zdir.mkdir()
    fx.build_library(str(zdir))
    mp = pytest.MonkeyPatch()
    mp.setattr(srv, "ZIM_DIR", str(zdir))
    mp.setattr(srv, "ZIMI_DATA_DIR", str(tmp / "data"))
    os.makedirs(str(tmp / "data"), exist_ok=True)
    mp.setenv("ZIMI_OFFLINE", "1")
    srv.load_cache(force=True)
    fg._reset_for_tests()
    yield str(zdir)
    mp.undo()
    fg._reset_for_tests()


@pytest.fixture
def empty_library(tmp_path, monkeypatch):
    monkeypatch.setattr(srv, "ZIM_DIR", str(tmp_path))
    monkeypatch.setattr(srv, "ZIMI_DATA_DIR", str(tmp_path / "data"))
    os.makedirs(str(tmp_path / "data"), exist_ok=True)
    srv.load_cache(force=True)
    fg._reset_for_tests()
    yield
    fg._reset_for_tests()


def test_an_empty_library_still_answers_every_situation(empty_library):
    for sid in fg.data()["situations"]:
        s = fg.situation(sid)
        assert s["quotes"], sid
        assert s["answers"] == []
        for q in s["quotes"]:
            assert q["source"]["licence"] and q["url"].startswith("https://")
            assert q["library"]["state"] == "missing"


def test_a_missing_zim_is_named_with_its_size_and_a_way_to_get_it(empty_library):
    s = fg.situation("flood")
    pieces = {m["piece"]: m for m in s["missing"]}
    assert "ready" in pieces and pieces["ready"]["size_bytes"] > 1_000_000_000
    assert pieces["ready"]["url"].startswith("https://")
    quote_options = {o["piece"] for q in s["quotes"] for o in q["library"]["options"]}
    assert "ready" in quote_options


def test_a_manual_quote_offers_the_field_manual_and_the_full_army_library(
    empty_library,
):
    s = fg.situation("bleeding")
    tc = next(q for q in s["quotes"] if q["source"]["id"] == "tc4021")
    options = {o["piece"]: o for o in tc["library"]["options"]}
    assert set(options) == {"field_manual", "armypubs"}
    assert (
        options["field_manual"]["build"] == "field_manual"
        and not options["field_manual"]["url"]
    )
    assert options["armypubs"]["size_bytes"] > 1_000_000_000


def test_a_dated_source_says_so_and_a_current_one_does_not(empty_library):
    shelter = fg.situation("shelter")
    assert {q["source"]["id"]: q["source"]["dated"] for q in shelter["quotes"]} == {
        "fm2176": True
    }
    bleeding = fg.situation("bleeding")
    assert not any(q["source"]["dated"] for q in bleeding["quotes"])
    assert all(q["source"]["year"] >= 2016 for q in bleeding["quotes"])


def test_a_quote_with_no_zim_behind_it_links_only_to_its_source(empty_library):
    s = fg.situation("water")
    epa = next(q for q in s["quotes"] if q["source"]["id"] == "epa")
    assert epa["library"] == {"state": "missing", "options": []}
    assert epa["url"].startswith("https://www.epa.gov/")


def test_installed_zims_deepen_the_quotes_and_list_their_pages(library):
    s = fg.situation("flood")
    ready = next(q for q in s["quotes"] if q["source"]["id"] == "ready")
    assert ready["library"]["state"] == "installed"
    assert ready["library"]["open"] == {
        "zim": "www.ready.gov",
        "path": "www.ready.gov/floods",
    }
    page = next(a for a in s["answers"] if a["kind"] == "page")
    assert page["path"] == "www.ready.gov/floods" and page["piece"] == "ready"
    assert page["year"] == 2024


def test_a_document_library_is_listed_by_title(library):
    s = fg.situation("water")
    docs = [a for a in s["answers"] if a["kind"] == "doc"]
    assert {d["title"] for d in docs} == {
        "Distillation For Home Water Treatment",
        "Giardia",
    }
    assert all(
        d["path"].startswith("files/") and d["zim"] == "zimgit-water" for d in docs
    )


def test_the_field_manual_zim_carries_the_manual_quotes(library):
    s = fg.situation("bleeding")
    tc = next(q for q in s["quotes"] if q["source"]["id"] == "tc4021")
    assert tc["library"]["state"] == "installed"
    assert tc["library"]["open"] == {
        "zim": "zimi_field_manual",
        "path": "TC_4-02.1_First_Aid.pdf",
    }
    fm = next(
        q for q in fg.situation("shelter")["quotes"] if q["source"]["id"] == "fm2176"
    )
    assert fm["library"]["open"]["path"] == "FM_21-76_Survival.pdf"


def test_encyclopedia_pages_are_found_by_title(library):
    s = fg.situation("cold")
    titles = [a["title"] for a in s["answers"] if a["piece"] == "wikipedia"]
    assert "Hypothermia" in titles


def test_pages_come_before_searches_and_newer_before_older(library):
    s = fg.situation("bleeding")
    kinds = [a["kind"] for a in s["answers"]]
    assert kinds == sorted(kinds, key=lambda k: k == "search")


def test_other_languages_get_their_own_wikipedia_searched_in_their_words(library):
    es = fg.situation("cold", lang="es")
    row = next(a for a in es["answers"] if a["piece"] == "wikipedia_es")
    assert (
        row["kind"] == "search"
        and row["zim"] == "wikipedia_es_medicine"
        and row["q"] == "hipotermia"
    )
    assert not any(
        a["piece"] == "wikipedia_es" for a in fg.situation("cold")["answers"]
    )
    # The quotes stay English until a person has checked a translation.
    assert [q["lines"] for q in es["quotes"]] == [
        q["lines"] for q in fg.situation("cold")["quotes"]
    ]


def test_the_search_hint_names_the_situation_and_what_is_installed(library):
    h = fg.hint("tourniquet")
    assert h["id"] == "bleeding" and h["href"] == "/#fieldguide/bleeding"
    assert {"piece": "wikipedia", "name": "Wikipedia"} in h["installed"]
    assert fg.hint("water cycle") is None
    assert fg.hint("first aid") == {"id": "", "href": "/#fieldguide", "installed": []}


def test_the_search_hint_reads_no_zim(library, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("the search path opened a ZIM")

    monkeypatch.setattr(srv, "get_archive", boom)
    monkeypatch.setattr(srv, "open_archive", boom)
    assert fg.hint("flood")["id"] == "flood"


def test_the_library_lists_sizes_and_installed_state(library):
    sets = {s["id"]: s for s in fg.library()["sets"]}
    core = {p["piece"]: p for p in sets["core"]["pieces"]}
    assert (
        core["zimgit_water"]["installed"]
        and core["zimgit_water"]["zim"] == "zimgit-water"
    )
    assert (
        not core["zimgit_medicine"]["installed"]
        and core["zimgit_medicine"]["size_bytes"] > 0
    )
    assert core["zimgit_medicine"]["url"].startswith("https://")
    assert core["field_manual"]["installed"]
    assert sets["core"]["missing"] > 0 and sets["core"]["missing_bytes"] > 0


def test_the_catalog_names_in_the_data_exist():
    from zimi import catalog_snapshot

    names = {e["name"] for e in catalog_snapshot.entries()}
    for pid, piece in fg.data()["pieces"].items():
        for n in piece.get("catalog", []):
            assert n in names, "%s: %s is not in the catalog" % (pid, n)


# ── over HTTP ───────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def served(library):
    from http.server import ThreadingHTTPServer

    from zimi.http import ZimHandler

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), ZimHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield "http://127.0.0.1:%d" % httpd.server_address[1]
    httpd.shutdown()


def _get(base, path):
    try:
        with urllib.request.urlopen(base + path, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def test_the_front_lists_the_groups_in_order(served):
    status, body = _get(served, "/fieldguide")
    assert status == 200
    assert [g["id"] for g in body["groups"]] == ["hurt", "survive", "disaster"]
    assert [s["id"] for s in body["groups"][0]["situations"]][:3] == [
        "bleeding",
        "choking",
        "not_breathing",
    ]
    assert body["groups"][0]["situations"][0]["mark"] == "M"
    assert body["disclaimer"] == fg.DISCLAIMER


def test_a_situation_over_http_and_unknown_is_404(served):
    status, body = _get(served, "/fieldguide/situation?id=bleeding")
    assert status == 200 and body["quotes"] and body["disclaimer"]
    status, body = _get(served, "/fieldguide/situation?id=../../etc")
    assert status == 404
    status, body = _get(served, "/fieldguide/situation")
    assert status == 404


def test_the_library_and_match_routes(served):
    status, body = _get(served, "/fieldguide/library")
    assert status == 200 and body["sets"]
    status, body = _get(served, "/fieldguide/match?q=hypothermia")
    assert status == 200 and body == {"id": "cold"}
    status, body = _get(served, "/fieldguide/match?q=water+cycle")
    assert status == 200 and body == {"id": None}


def test_search_answers_with_the_situation_and_stays_quiet_otherwise(served):
    status, body = _get(served, "/search?q=" + urllib.parse.quote("hypothermia"))
    assert status == 200
    assert (
        body["fieldguide"]["id"] == "cold"
        and body["fieldguide"]["href"] == "/#fieldguide/cold"
    )
    status, body = _get(served, "/search?q=" + urllib.parse.quote("water cycle"))
    assert "fieldguide" not in body
    status, body = _get(served, "/search?q=hypothermia&zim=wikipedia_en_top")
    assert "fieldguide" not in body, "a search inside one ZIM is not asking for help"


def test_the_stream_carries_the_hint_in_its_first_line(served):
    with urllib.request.urlopen(
        served + "/search?q=tourniquet&stream=1&fast=1", timeout=30
    ) as r:
        first = json.loads(r.readline())
    assert (
        first["phase"] == "fast" and first["result"]["fieldguide"]["id"] == "bleeding"
    )


def test_the_guide_routes_are_rate_limited_like_the_apps():
    from zimi import http

    assert "/fieldguide" in http._RATE_LIMITED_API_PATHS
    assert "/fieldguide/" in http._RATE_LIMITED_API_PREFIXES


# ── the field manual ────────────────────────────────────────────────────────


def _tiny_manuals():
    import hashlib

    items, blobs = [], {}
    for name, title in (
        ("A_First_Aid.pdf", "Manual A"),
        ("B_Survival.pdf", "Manual B"),
    ):
        body = b"%PDF-1.4 " + name.encode()
        url = "https://example.invalid/" + name
        items.append(
            {
                "file": name,
                "title": title,
                "date": "1992-06-05",
                "description": "A test manual.",
                "url": url,
                "bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
            }
        )
        blobs[url] = body
    return tuple(items), blobs


@pytest.fixture
def build_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(srv, "ZIM_DIR", str(tmp_path / "zims"))
    monkeypatch.setattr(srv, "ZIMI_DATA_DIR", str(tmp_path / "data"))
    os.makedirs(str(tmp_path / "zims"))
    os.makedirs(str(tmp_path / "data"))
    monkeypatch.delenv("ZIMI_OFFLINE", raising=False)
    fg._reset_for_tests()
    yield tmp_path / "zims"
    fg._reset_for_tests()


def test_the_field_manual_is_built_from_checked_downloads_with_creates_folder_mode(
    build_dir, monkeypatch
):
    import io

    from zimi import p2p

    monkeypatch.setattr(p2p, "is_offline", lambda: False)
    manuals, blobs = _tiny_manuals()
    heard = []
    out = fg.build_field_manual(
        out_dir=str(build_dir),
        progress=heard.append,
        fetch=lambda url: io.BytesIO(blobs[url]),
        manuals=manuals,
    )
    assert out["assets"] == 2 and os.path.exists(out["path"]) and out["registered"]
    assert any("Manual A" in h for h in heard)
    srv.load_cache(force=True)
    docs = fg._docs("zimi_field_manual", ["*"], "zimi-database.js")
    assert sorted(d[1] for d in docs) == ["Manual A", "Manual B"]
    assert not [
        f for f in os.listdir(str(build_dir)) if f.startswith("zimi-field-manual-")
    ], "scratch left behind"


def test_a_file_that_is_not_the_expected_one_is_refused(build_dir, monkeypatch):
    import io

    from zimi import creator, p2p

    monkeypatch.setattr(p2p, "is_offline", lambda: False)
    manuals, blobs = _tiny_manuals()
    blobs[manuals[0]["url"]] = b"%PDF-1.4 something else entirely"
    with pytest.raises(creator.CreateError, match="not the file"):
        fg.build_field_manual(
            out_dir=str(build_dir),
            fetch=lambda url: io.BytesIO(blobs[url]),
            manuals=manuals,
        )
    assert not [f for f in os.listdir(str(build_dir)) if f.endswith(".zim")]


def test_offline_builds_nothing(build_dir, monkeypatch):
    from zimi import creator, p2p

    monkeypatch.setattr(p2p, "is_offline", lambda: True)
    with pytest.raises(creator.CreateError, match="OFFLINE"):
        fg.build_field_manual(
            out_dir=str(build_dir),
            fetch=lambda url: (_ for _ in ()).throw(AssertionError("fetched")),
        )


def test_the_shipped_manual_addresses_are_the_verified_originals():
    for m in fg.MANUALS:
        assert m["url"].startswith(
            "https://upload.wikimedia.org/wikipedia/commons/"
        ), m["file"]
        assert len(m["sha256"]) == 64 and m["bytes"] > 1_000_000
    assert {m["title"] for m in fg.MANUALS} == {
        "TC 4-02.1 First Aid",
        "FM 21-76 Survival",
        "TC 3-21.76 Ranger Handbook",
    }


def test_one_build_at_a_time(build_dir):
    fg._set_manual(state="running")
    assert fg.start_manual_build() is False
    fg._set_manual(state="idle")
