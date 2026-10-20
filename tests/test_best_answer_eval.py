"""How good the best answer card is, on real text.

tests/best_answer_eval.py builds ZIMs from real Wikipedia, Wikivoyage and
Stack Exchange text (tests/fixtures/best_answer/README.md) and asks 64 + 24
questions of them, each with the sentence that answers it or the fact that
the library holds none. Two numbers matter:

    precision   of the cards shown, the share that quote a right sentence
                (a card for a question the library cannot answer is wrong)
    coverage    of the questions the library answers, the share that got a
                right card

A missing card is cheaper than a wrong one, so the floor is on precision.
`questions` were used while tuning the card; `questions_heldout` were written
afterwards and asked once. Run with -s to see every question and what came
back.
"""

import os
import re
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import best_answer_eval as ev  # noqa: E402

PRECISION_FLOOR = 0.90
COVERAGE_FLOOR = 0.55  # what the tuning set reached (61%) less a margin
COVERAGE_FLOOR_HELDOUT = 0.80


@pytest.fixture(scope="module")
def library(tmp_path_factory):
    import zimi.server as srv

    tmp = tmp_path_factory.mktemp("eval")
    zdir = tmp / "zims"
    zdir.mkdir()
    ev.build_library(str(zdir))
    old = (srv.ZIM_DIR, srv.ZIMI_DATA_DIR, os.environ.get("ZIMI_OFFLINE"))
    os.environ["ZIMI_OFFLINE"] = "1"
    srv.ZIM_DIR = str(zdir)
    srv.ZIMI_DATA_DIR = str(tmp / "data")
    os.makedirs(srv.ZIMI_DATA_DIR, exist_ok=True)
    srv.load_cache(force=True)
    yield srv
    srv._search_cache_clear()
    srv.ZIM_DIR, srv.ZIMI_DATA_DIR = old[0], old[1]
    if old[2] is None:
        os.environ.pop("ZIMI_OFFLINE", None)
    else:
        os.environ["ZIMI_OFFLINE"] = old[2]


def _run(srv, which):
    rows = ev.evaluate(srv, which)
    print("\n" + ev.report(rows))
    return rows, ev.summary(rows), ev.report(rows)


def test_precision_and_coverage_on_the_tuning_questions(library):
    rows, s, report = _run(library, "questions")
    assert s["precision"] >= PRECISION_FLOOR, report
    assert s["coverage"] >= COVERAGE_FLOOR, report


def test_precision_and_coverage_on_questions_the_card_was_not_tuned_on(library):
    rows, s, report = _run(library, "questions_heldout")
    assert s["precision"] >= PRECISION_FLOOR, report
    assert s["coverage"] >= COVERAGE_FLOOR_HELDOUT, report


def test_no_question_the_library_cannot_answer_gets_more_than_one_false_card(library):
    """Cards for questions with no answer are the failure a reader trusts least."""
    rows = ev.evaluate(library, "questions") + ev.evaluate(library, "questions_heldout")
    false_cards = [r["q"] for r in rows if not r["answerable"] and r["shown"]]
    assert len(false_cards) <= 1, false_cards


def test_a_card_over_a_question_and_answer_page_never_quotes_the_question(library):
    """The asker's post is not an answer (sotoki's pages hold both)."""
    from zimi import exchange  # noqa: F401  (the card's reader of these pages)

    for q in ev.corpus()["stackexchange"]:
        body = re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", q["body"]))
        title = re.sub(r"&quot;", '"', q["title"])
        library._search_cache_clear()
        got = library.best_answer_for(title.rstrip("?") + "?", "", None, 10)
        card = got.get("answer")
        if card and card["zim"].startswith("stackoverflow"):
            quote = re.sub(r"\s+", " ", card["sentence"])
            assert quote not in body, (title, quote)


def test_questions_with_did_does_can_are_searched_as_questions(library):
    """'did', 'does', 'do' went to the index as words an article must hold:
    these found nothing (and so no card) before they were left out."""
    for q, title in (
        ("when did the berlin wall fall", "Berlin Wall"),
        ("what does insulin do", "Insulin"),
        ("what do vaccines do", "Vaccine"),
        ("could the roman empire fall", "Roman Empire"),
    ):
        library._search_cache_clear()
        got = library.search_all(q, limit=10)
        assert title in [r["title"] for r in got["results"]], (
            q,
            [r["title"] for r in got["results"]],
        )


def test_a_question_asked_of_one_source_is_found_in_it(library):
    library._search_cache_clear()
    got = library.search_all(
        "how to purify water", limit=10, filter_zim="wikipedia_en_eval"
    )
    assert "Water purification" in [r["title"] for r in got["results"]]
    card = library.best_answer_for(
        "how to purify water", "wikipedia_en_eval", "wikipedia_en_eval", 10
    )
    assert card["answer"]["title"] == "Water purification"


def test_concurrent_questions_do_not_confuse_each_other(library):
    out = {}

    def ask(q):
        out[q] = library.best_answer_for(q, "", None, 10)

    qs = [
        "who painted the mona lisa",
        "what is photosynthesis",
        "how tall is the eiffel tower",
        "what is dna",
    ]
    ts = [threading.Thread(target=ask, args=(q,)) for q in qs]
    [t.start() for t in ts]
    [t.join(60) for t in ts]
    assert out["who painted the mona lisa"]["answer"]["title"] == "Mona Lisa"
    assert out["what is photosynthesis"]["answer"]["title"] == "Photosynthesis"
    assert out["how tall is the eiffel tower"]["answer"]["title"] == "Eiffel Tower"
    assert out["what is dna"]["answer"]["title"] == "DNA"
