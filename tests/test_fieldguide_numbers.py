"""The Field Guide's emergency numbers by country, and the time zone table that
says which country a device is in.

The numbers are Wikipedia's List of emergency telephone numbers (CC BY-SA 4.0),
kept as the page gives them and named as the source. Zimi writes none of them.

Run: pytest tests/test_fieldguide_numbers.py -v
"""

import gzip
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zimi import fieldguide as fg  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "zimi", "static")
FIXTURES = os.path.join(ROOT, "tests", "fixtures", "fieldguide")


def _static_json(*parts):
    with open(os.path.join(STATIC, *parts), encoding="utf8") as f:
        return json.load(f)


def _fixture(name):
    with gzip.open(
        os.path.join(FIXTURES, name + ".txt.gz"), "rt", encoding="utf8"
    ) as f:
        return f.read()


def test_every_emergency_number_is_in_the_source_it_names():
    """Each cell is in the fixture of the page's rows."""
    table = _static_json("fieldguide-numbers.json")
    src = table["source"]
    assert src["licence"] in fg.quotes()["licences"] and "oldid=" in src["url"]
    rows = _fixture(src["fixture"]).splitlines()
    assert len(table["countries"]) > 200
    for cc, rec in table["countries"].items():
        row = next((r for r in rows if r.startswith(rec["name"] + " |")), None)
        assert row, (cc, rec["name"])
        for key in ("all", "police", "ambulance", "fire"):
            if key in rec:
                assert rec[key] in row, (cc, key, rec[key])
        if "mobile" in rec:
            assert rec["mobile"].split(" or ")[0] in row, (cc, "mobile")
    assert table["default"] == ["112", "911"]
    for cc, num in (
        ("AU", "000"),
        ("US", "911"),
        ("NZ", "111"),
        ("GB", "999 or 112"),
        ("IN", "112"),
    ):
        assert table["countries"][cc]["all"] == num, cc


def test_every_time_zone_knows_its_country_and_the_table_knows_nearly_every_country():
    zones = _static_json("earth", "zones-v1.json")
    table = _static_json("fieldguide-numbers.json")["countries"]
    assert len(zones) > 400
    for tz, (lat, lon, cc) in zones.items():
        assert (
            -90 <= lat <= 90 and -180 <= lon <= 180 and re.fullmatch("[A-Z]{2}", cc)
        ), tz
    assert zones["Australia/Sydney"][2] == "AU" and zones["Africa/Windhoek"][0] < 0
    assert zones["America/Manaus"][0] < 0 and zones["Asia/Calcutta"][2] == "IN"
    # A country the table lacks gets the default and says so; keep that rare.
    assert {v[2] for v in zones.values()} - set(table) <= {"NF", "PN", "SJ", "TF", "UM"}


def test_the_shell_hands_the_page_every_word_the_number_line_uses():
    with open(os.path.join(STATIC, "app.js"), encoding="utf8") as f:
        js = f.read()
    words = re.search(r"var _FIELDGUIDE_WORDS = \[(.*?)\];", js, re.S).group(1)
    for key in (
        "num_here",
        "nums_here",
        "num_unknown",
        "num_police",
        "num_ambulance",
        "num_fire",
        "num_mobile",
        "num_source",
    ):
        assert "'fieldguide_%s'" % key in words, key
