"""Zimi Earth's places: who may see them, how they are read, and when.

Run: pytest tests/test_earth_scan.py -v
"""

import os
import sqlite3
import sys
import threading
import time

import pytest

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import zimi.server as srv  # noqa: E402
from test_earth import _zim, link, meta, page  # noqa: E402
from zimi import earth  # noqa: E402


def _cities(n, lat0=48.8, lon0=2.3, size=3000, step=0.0001, prefix="C"):
    return [
        (
            "A/%s%d" % (prefix, i),
            "%s%d" % (prefix, i),
            page(b"x" * size, meta(b"%.5f" % (lat0 + i * step), b"%.5f" % lon0)),
        )
        for i in range(n)
    ]


def _library(tmp_path, monkeypatch, zims):
    zdir = tmp_path / "zims"
    zdir.mkdir()
    for filename, name, project, lang, articles in zims:
        _zim(str(zdir / filename), articles, name, project, lang)
    monkeypatch.setattr(srv, "ZIM_DIR", str(zdir))
    monkeypatch.setattr(srv, "ZIMI_DATA_DIR", str(tmp_path / "data"))
    os.makedirs(str(tmp_path / "data"), exist_ok=True)
    earth._reset_for_tests()
    srv.load_cache(force=True)


TWO = [
    (
        "wikipedia_en_all_maxi_2026-08.zim",
        "wikipedia_en_all",
        "wikipedia",
        "eng",
        [("A/Paris", "Paris", page(b"p" * 3000, meta(b"48.8567", b"2.3522")))],
    ),
    (
        "wikipedia_fr_all_maxi_2026-08.zim",
        "wikipedia_fr_all",
        "wikipedia",
        "fra",
        [("A/Lyon", "Lyon", page(b"l" * 3000, meta(b"45.76", b"4.83")))],
    ),
]


def _names():
    return sorted(z["name"] for z in srv._zim_list_cache if z["kind"] == "wiki")


@pytest.fixture
def two(tmp_path, monkeypatch):
    _library(tmp_path, monkeypatch, TWO)
    for name in _names():
        earth.build_one(name)
    yield _names()
    srv.clear_request_allow()


# ── who may see them ──


def test_a_restricted_request_sees_only_the_wikis_it_may(two):
    first, second = two
    srv.set_request_allow({first})
    got = earth.places_in(-180, -90, 180, 90)
    assert {p["zim"] for p in got} == {first}
    assert {a["zim"] for a in earth.near(45.76, 4.83)["articles"]} <= {first}
    st = earth.status()
    assert st["places"] is True
    srv.set_request_allow(set())
    assert earth.places_in(-180, -90, 180, 90) == []
    assert earth.near(48.85, 2.35) == {"articles": [], "guides": []}
    assert earth.status() == {"places": False, "finding": [], "skipped": []}
    srv.clear_request_allow()
    assert len(earth.places_in(-180, -90, 180, 90)) == 2


def test_the_routes_honour_a_limited_visitor_and_a_restricted_user(two, monkeypatch):
    import json
    import urllib.request
    from http.server import ThreadingHTTPServer

    from zimi import users
    from zimi.http import ZimHandler

    first, second = two
    monkeypatch.setattr(srv, "apps_shown", lambda: frozenset(["earth"]))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), ZimHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % httpd.server_address[1]

    def get(path, cookie=None):
        req = urllib.request.Request(base + path)
        if cookie:
            req.add_header("Cookie", cookie)
        return json.loads(urllib.request.urlopen(req, timeout=10).read())

    try:
        assert not earth.wanted()
        assert get("/earth")["places"] is True  # asking is opening Earth
        assert earth.wanted()
        everyone = get("/earth/places?w=-180&s=-90&e=180&n=90&limit=10")["places"]
        assert len(everyone) == 2
        # A signed-in user limited to one wiki.
        users.create_user("kid", "pw", allowlist=[first], role="limited")
        cookie = "zimi_session=%s" % users.create_session("kid")
        mine = get("/earth/places?w=-180&s=-90&e=180&n=90&limit=10", cookie)["places"]
        assert {p["zim"] for p in mine} == {first}
        near = get("/earth/near?lat=45.76&lon=4.83", cookie)
        assert all(a["zim"] == first for a in near["articles"])
        assert get("/earth", cookie)["places"] is True
        # A visitor the public policy limits to the other wiki: the same
        # request context the handler sets for an anonymous WAN visitor.
        users.set_public_access("limited", [second])
        srv.set_request_allow(users.request_allow(_Wan()))
        try:
            assert {p["zim"] for p in earth.places_in(-180, -90, 180, 90)} == {second}
            assert earth.status()["places"] is True
        finally:
            srv.clear_request_allow()
    finally:
        httpd.shutdown()
        users.set_public_access("open", [])


class _Wan:
    """A visitor from outside the network, signed in as nobody."""

    headers = {}
    client_address = ("203.0.113.9", 1234)

    def __init__(self):
        self.private = False


# ── how they are read ──


def test_the_scan_checkpoints_and_resumes_after_it_is_killed(tmp_path, monkeypatch):
    _library(
        tmp_path,
        monkeypatch,
        [
            (
                "wikipedia_en_all_maxi_2026-08.zim",
                "wikipedia_en_all",
                "wikipedia",
                "eng",
                _cities(60),
            )
        ],
    )
    name = _names()[0]
    path = srv.get_zim_files()[name]
    monkeypatch.setattr(earth, "BATCH", 5)
    monkeypatch.setattr(earth, "PROGRESS_EVERY", 5)
    real = earth.parse_geo
    seen = []

    def dies_at_forty(data):
        seen.append(1)
        if len(seen) == 40:
            raise SystemExit("killed")
        return real(data)

    monkeypatch.setattr(earth, "parse_geo", dies_at_forty)
    with pytest.raises(SystemExit):
        earth.scan(name, path)
    tmp = earth.db_path(name) + ".tmp"
    assert os.path.exists(tmp) and not os.path.exists(earth.db_path(name))
    kept = sqlite3.connect(tmp).execute("SELECT COUNT(*) FROM places").fetchone()[0]
    assert 25 <= kept <= 39  # whole batches, not the entry it died on
    # The next run takes up where the last stopped: it parses what is left, not everything.
    seen.clear()
    monkeypatch.setattr(earth, "parse_geo", lambda d: (seen.append(1), real(d))[1])
    earth.scan(name, path)
    assert len(seen) <= 60 - 25
    assert not os.path.exists(tmp)
    assert (
        sqlite3.connect(earth.db_path(name))
        .execute("SELECT COUNT(*) FROM places")
        .fetchone()[0]
        == 60
    )


def test_one_bad_entry_does_not_stop_the_scan(tmp_path, monkeypatch):
    _library(
        tmp_path,
        monkeypatch,
        [
            (
                "wikipedia_en_all_maxi_2026-08.zim",
                "wikipedia_en_all",
                "wikipedia",
                "eng",
                _cities(20),
            )
        ],
    )
    name = _names()[0]
    real = earth.parse_geo
    calls = []

    def flaky(data):
        calls.append(1)
        if len(calls) == 7:
            raise ValueError("a page libzim could not decode")
        return real(data)

    monkeypatch.setattr(earth, "parse_geo", flaky)
    earth.scan(name, srv.get_zim_files()[name])
    n = (
        sqlite3.connect(earth.db_path(name))
        .execute("SELECT COUNT(*) FROM places")
        .fetchone()[0]
    )
    assert n == 19


def test_the_scan_holds_a_batch_and_never_the_whole_wiki(tmp_path, monkeypatch):
    _library(
        tmp_path,
        monkeypatch,
        [
            (
                "wikipedia_en_all_maxi_2026-08.zim",
                "wikipedia_en_all",
                "wikipedia",
                "eng",
                _cities(50),
            )
        ],
    )
    name = _names()[0]
    monkeypatch.setattr(earth, "BATCH", 10)
    monkeypatch.setattr(earth, "PROGRESS_EVERY", 10)
    writes = []
    real = sqlite3.Connection.executemany

    class Spy(sqlite3.Connection):
        def executemany(self, sql, rows):
            rows = list(rows)
            if "INTO places" in sql:
                writes.append(len(rows))
            return real(self, sql, rows)

    monkeypatch.setattr(earth, "_connect", lambda p: sqlite3.connect(p, factory=Spy))
    earth.scan(name, srv.get_zim_files()[name])
    assert sum(writes) == 50 and max(writes) <= 10 and len(writes) >= 5


def test_the_child_runs_at_low_priority(monkeypatch):
    import zimi.search as search

    order = []
    monkeypatch.setattr(earth, "lower_priority", lambda: order.append("nice"))
    monkeypatch.setattr(earth, "scan", lambda n, p: order.append("scan"))
    search._build_index_child_main("places", "/tmp/x", "n", "/tmp/n.zim")
    assert order == ["nice", "scan"]


def test_lower_priority_niceness_and_ionice(monkeypatch):
    calls = []
    monkeypatch.setattr(os, "nice", lambda n: calls.append(("nice", n)), raising=False)
    monkeypatch.setattr(earth.shutil, "which", lambda c: "/usr/bin/ionice")
    monkeypatch.setattr(
        earth.subprocess, "run", lambda cmd, **kw: calls.append(("run", cmd[:3]))
    )
    earth.lower_priority()
    assert ("nice", 19) in calls
    assert ("run", ["/usr/bin/ionice", "-c3", "-p"]) in calls


# ── when ──


def test_nothing_is_read_until_earth_has_been_opened(tmp_path, monkeypatch):
    _library(tmp_path, monkeypatch, TWO)
    monkeypatch.setattr(srv, "apps_shown", lambda: frozenset(["earth"]))
    built = []
    monkeypatch.setattr(earth, "build_all", lambda: built.append(1))
    earth.maybe_build_all()
    assert built == [] and not earth.wanted()
    # The first open remembers it, and reading begins.
    started = []
    monkeypatch.setattr(
        earth.threading,
        "Thread",
        lambda target=None, **kw: type(
            "T", (), {"start": lambda s: started.append(target)}
        )(),
    )
    earth.want()
    assert earth.wanted() and len(started) == 1
    earth.want()
    assert len(started) == 1  # once
    earth.maybe_build_all()
    assert built == [1]


def test_a_server_that_does_not_offer_earth_never_reads(tmp_path, monkeypatch):
    _library(tmp_path, monkeypatch, TWO)
    earth.want_marker()
    monkeypatch.setattr(srv, "apps_shown", lambda: frozenset(["maps"]))
    built = []
    monkeypatch.setattr(earth, "build_all", lambda: built.append(1))
    earth.maybe_build_all()
    earth.request_places("anything")
    assert built == []


def test_the_biggest_value_goes_first(tmp_path, monkeypatch):
    _library(
        tmp_path,
        monkeypatch,
        [
            (
                "wikipedia_en_all_maxi_2026-08.zim",
                "wikipedia_en_all",
                "wikipedia",
                "eng",
                _cities(30, prefix="E"),
            ),
            (
                "wikipedia_fr_all_maxi_2026-08.zim",
                "wikipedia_fr_all",
                "wikipedia",
                "fra",
                _cities(5, prefix="F"),
            ),
            (
                "wikivoyage_en_all_maxi_2026-08.zim",
                "wikivoyage_en_all",
                "wikivoyage",
                "eng",
                _cities(40, prefix="V"),
            ),
        ],
    )
    order = []
    monkeypatch.setattr(earth, "build_one", lambda name: order.append(name))
    earth.build_all()
    projects = [
        next(z["project"] for z in srv._zim_list_cache if z["name"] == n) for n in order
    ]
    assert projects[0] == "wikivoyage"
    sizes = [
        next(z["entries"] for z in srv._zim_list_cache if z["name"] == n)
        for n in order[1:]
    ]
    assert sizes == sorted(sizes)


def test_a_new_download_is_read_without_a_restart(tmp_path, monkeypatch):
    _library(tmp_path, monkeypatch, TWO)
    earth.want_marker()
    monkeypatch.setattr(srv, "apps_shown", lambda: frozenset(["earth"]))
    ran = []
    monkeypatch.setattr(earth, "build_one", lambda name: ran.append(name))
    done = threading.Event()
    real_thread = threading.Thread

    def run_now(target=None, args=(), **kw):
        class T:
            def start(self_inner):
                target(*args)
                done.set()

        return T()

    monkeypatch.setattr(earth.threading, "Thread", run_now)
    earth.request_places(_names()[0])
    assert ran == [_names()[0]]
    del real_thread


def test_a_frozen_build_skips_what_it_would_stall_on_and_says_so(tmp_path, monkeypatch):
    _library(tmp_path, monkeypatch, TWO)
    first, second = _names()
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(earth, "FROZEN_MAX_ENTRIES", 0)
    earth.build_one(first)
    st = earth.status()
    assert [s["zim"] for s in st["skipped"]] == [first] or first in {
        s["zim"] for s in st["skipped"]
    }
    assert not os.path.exists(earth.db_path(first))
    monkeypatch.setattr(earth, "FROZEN_MAX_ENTRIES", 1000)
    earth.build_one(second)
    assert os.path.exists(earth.db_path(second))


def test_a_scan_in_progress_is_reported_with_its_share(tmp_path, monkeypatch):
    _library(
        tmp_path,
        monkeypatch,
        [
            (
                "wikipedia_en_all_maxi_2026-08.zim",
                "wikipedia_en_all",
                "wikipedia",
                "eng",
                _cities(40),
            )
        ],
    )
    name = _names()[0]
    path = srv.get_zim_files()[name]
    monkeypatch.setattr(earth, "BATCH", 5)
    monkeypatch.setattr(earth, "PROGRESS_EVERY", 5)
    real = earth.parse_geo
    n = []

    def stops(data):
        n.append(1)
        if len(n) == 21:
            raise SystemExit
        return real(data)

    monkeypatch.setattr(earth, "parse_geo", stops)
    with pytest.raises(SystemExit):
        earth.scan(name, path)
    got = earth.status()
    assert got["places"] is False
    (row,) = got["finding"]
    assert row["zim"] == name and 0 < row["pct"] < 100 and row["title"]


# ── asking ──


def test_the_nearest_article_is_found_in_a_dense_cluster(tmp_path, monkeypatch):
    # 3,000 big articles within 330 m of one another, the one that is nearest
    # to the touched point the smallest of them all.
    cluster = _cities(3000, lat0=48.8, lon0=2.3, size=3000, step=0.0001)
    tiny = ("A/Tiny", "Tiny chapel", page(b"x", meta(b"48.90000", b"2.40000")))
    _library(
        tmp_path,
        monkeypatch,
        [
            (
                "wikipedia_en_all_maxi_2026-08.zim",
                "wikipedia_en_all",
                "wikipedia",
                "eng",
                cluster + [tiny],
            )
        ],
    )
    name = _names()[0]
    earth.build_one(name)
    got = earth.near(48.9, 2.4)
    assert [a["title"] for a in got["articles"]] == ["Tiny chapel"]


def test_a_guide_is_still_found_within_the_wider_reach(tmp_path, monkeypatch):
    _library(
        tmp_path,
        monkeypatch,
        [
            (
                "wikivoyage_en_all_maxi_2026-08.zim",
                "wikivoyage_en_all",
                "wikivoyage",
                "eng",
                [("A/Lyon", "Lyon", page(link(b"45.76", b"4.83")))],
            ),
        ],
    )
    earth.build_one(_names()[0])
    got = earth.near(46.3, 4.83)  # 60 km north
    assert [g["title"] for g in got["guides"]] == ["Lyon"]
    assert earth.near(48.9, 2.4)["guides"] == []


def _synthetic(path, rows):
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE places (path TEXT PRIMARY KEY, title TEXT, lat REAL, lon REAL, size INTEGER)"
    )
    import random

    rnd = random.Random(7)
    conn.executemany(
        "INSERT INTO places VALUES (?,?,?,?,?)",
        (
            (
                "p%d" % i,
                "t%d" % i,
                rnd.uniform(-60, 70),
                rnd.uniform(-180, 180),
                rnd.randint(500, 200000),
            )
            for i in range(rows)
        ),
    )
    earth._create_indexes(conn)
    conn.commit()
    return conn


def test_each_view_is_read_the_way_that_costs_least(tmp_path):
    conn = _synthetic(str(tmp_path / "s.db"), 20000)
    # A city or a county: the R*Tree of every place.
    assert earth.explain(conn, 2, 48.5, 3, 49.5).startswith("rtree: ")
    # A country or a continent: the biggest places' R*Tree, not a sort of everyone.
    assert earth.explain(conn, -10, 35, 30, 60).startswith("top: ")
    # A hemisphere or the globe: the size order, stopping at the limit.
    assert earth.explain(conn, -180, -90, 180, 90).startswith("size: ")
    conn.close()


def test_every_way_of_reading_gives_the_same_biggest_places(tmp_path, monkeypatch):
    monkeypatch.setattr(srv, "ZIMI_DATA_DIR", str(tmp_path))
    os.makedirs(earth._dir(), exist_ok=True)
    conn = _synthetic(earth.db_path("syn"), 30000)
    boxes = [
        (2, 48.5, 3, 49.5),  # a city
        (-10, 35, 30, 60),  # a continent
        (-170, -60, -110, -20),  # open ocean: few places, none of them big
        (170, -30, -170, 10),  # over the antimeridian
        (-180, -90, 180, 90),
    ]
    for west, south, east, north in boxes:
        spans = earth._lon_ranges(west, east)
        lon = " OR ".join("(lon BETWEEN ? AND ?)" for _ in spans)
        args = [south, north] + [v for sp in spans for v in sp]
        want = conn.execute(
            "SELECT path FROM places WHERE lat BETWEEN ? AND ? AND (%s) ORDER BY size DESC, path LIMIT 40" % lon,
            args,
        ).fetchall()
        got = earth._query_box("syn", west, south, east, north, limit=40)
        assert [r[0] for r in got][: len(want)] == [r[0] for r in want] or {
            r[4] for r in got
        } == {
            conn.execute("SELECT size FROM places WHERE path=?", (w[0],)).fetchone()[0]
            for w in want
        }, (west, south, east, north)
        assert len(got) == len(want)
    conn.close()


def test_an_unknown_earth_path_is_answered_not_left_hanging(two, monkeypatch):
    import urllib.error
    import urllib.request
    from http.server import ThreadingHTTPServer

    from zimi.http import ZimHandler

    monkeypatch.setattr(srv, "apps_shown", lambda: frozenset(["earth"]))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), ZimHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = "http://127.0.0.1:%d/earth/bogus" % httpd.server_address[1]
    try:
        with pytest.raises(urllib.error.HTTPError) as got:
            urllib.request.urlopen(url, timeout=5)
        assert got.value.code == 404
    finally:
        httpd.shutdown()
