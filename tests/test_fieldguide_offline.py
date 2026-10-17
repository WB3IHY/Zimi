"""The Field Guide with no server answers as the server does.

static/fieldguide-offline.js is a port of fieldguide.normalize, lookup and who,
reading the same data (fieldguide.offline_bundle(), served at
/static/fieldguide-offline.json). With no signal the "What's happening?" box
must name the situation the search bar would have named, so every phrase in the
guide's tables, in every language, and every query the Python tests hold the
matcher to, goes through both and must come back identical. The bundle itself
must carry the same quotes the server's bare answers do.

Run: pytest tests/test_fieldguide_offline.py -v
"""

import json
import os
import shutil
import subprocess
import sys
import unicodedata

import pytest

pytestmark = pytest.mark.fieldguide_on

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from zimi import fieldguide as fg  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MODULE = os.path.join(HERE, "..", "zimi", "static", "fieldguide-offline.js")

_DRIVER = r"""
const fs = require('node:fs');
const FG = require(process.argv[1]);
const { bundle, cases } = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = cases.map(([q, lang]) => [
  FG.normalize(q),
  FG.lookup(bundle.matcher, q, lang),
  FG.who(bundle.matcher, q, lang),
]);
process.stdout.write(JSON.stringify(out));
"""


def _node(cases):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available")
    proc = subprocess.run(
        [node, "-e", _DRIVER, os.path.abspath(MODULE)],
        input=json.dumps({"bundle": fg.offline_bundle(), "cases": cases}),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def _phrases():
    """Every phrase the data names, with the language it is in."""
    d = fg.data()
    for lang, words in d["home"].items():
        for w in words:
            yield w, lang
    for sit in d["situations"].values():
        for kind in ("keywords", "within", "ambiguous"):
            for lang, words in sit.get(kind, {}).items():
                for w in words:
                    yield w, lang
    for by_lang in d["who"].values():
        for lang, words in by_lang.items():
            for w in words:
                yield w, lang
    for lang, words in d["stop"].items():
        for w in words:
            yield w, lang


def _existing_test_queries():
    import test_fieldguide as t

    for sid, by_lang in t.TYPED.items():
        for lang, texts in by_lang.items():
            for text in texts:
                yield text, lang
    for word in t.AMBIGUOUS:
        yield word, "en"
    for text in t.SENTENCES:
        yield text, "en"
    for text in t.CHOKING_WORDS:
        yield text, "en"
    for text in t.NOT_ABOUT_HELP:
        for lang in t.LANGS:
            yield text, lang
    for q, lang in (
        ("baby choking", "en"),
        ("my infant is choking", "en"),
        ("newborn choked", "en"),
        ("bebé atragantado", "es"),
        ("婴儿噎住", "zh"),
        ("my baby is choking", "en"),
        ("blutet", "en"),
        ("blutet", "de"),
        ("agua", "en"),
        ("agua", "es"),
        ("止血", "en"),
        ("止血", "zh"),
        ("bleeding", "de"),
        ("blutet", "xx"),
        ("first aid", "en"),
        ("primeros auxilios", "es"),
        ("erste hilfe", "de"),
        ("急救", "zh"),
        ("cardiac arrest", "en"),
        ("pain in my chest", "en"),
        ("lost", "en"),
        ("heart attack", "en"),
    ):
        yield q, lang


def _corpus():
    """Each phrase as written, shouted, stripped of accents, inside a sentence,
    and in the reader's language, English and one the guide has no words for."""
    cases = set()
    for w, lang in list(_phrases()) + list(_existing_test_queries()):
        flat = "".join(
            c for c in unicodedata.normalize("NFD", w) if not unicodedata.combining(c)
        )
        for text in (
            w,
            w.upper(),
            w.title(),
            flat,
            "my friend is " + w,
            w + "!!",
            "  " + w + "  ",
            "the " + w + " please",
        ):
            for lang in {lang, "en", "xx"}:
                cases.add((text, lang))
    return sorted(cases)


def test_the_port_answers_what_the_server_answers_for_every_phrase():
    cases = _corpus()
    assert len(cases) > 5000, "the corpus should cover the tables, not a few"
    got = _node([list(c) for c in cases])
    wrong = []
    for (text, lang), (norm, look, who) in zip(cases, got):
        want = (fg.normalize(text), fg.lookup(text, lang), fg.who(text, lang))
        have = (norm, tuple(look) if look else None, who)
        if want != have:
            wrong.append((text, lang, want, have))
    assert not wrong, "%d differ, first: %r" % (len(wrong), wrong[:5])


def test_the_case_the_survivor_types():
    got = _node([["my baby is choking", "en"]])[0]
    assert got[1] == ["choking", "card"] and got[2] == "infant"


def test_the_bundle_carries_the_bare_answers_and_the_front():
    b = fg.offline_bundle()
    assert b["home"] == fg.home(bare=True)
    assert set(b["situations"]) == set(fg.data()["situations"])
    for sid, s in b["situations"].items():
        assert s == fg.situation_bare(sid)
        assert s["quotes"], sid + " has no quotes to show with no server"
    # No ZIM is named in it: it is what a visitor at the sign-in screen is shown.
    assert "installed" in json.dumps(b["home"]) and all(
        row["installed"] == 0 for g in b["home"]["groups"] for row in g["situations"]
    )


def test_the_bundle_is_served_as_a_static_file_the_worker_keeps():
    from zimi import http

    assert "/static/" + http.FIELDGUIDE_OFFLINE in http._offline_shell_urls()
    body = fg.offline_bundle_bytes()
    assert json.loads(body)["home"]["groups"], "served bytes are the bundle"
