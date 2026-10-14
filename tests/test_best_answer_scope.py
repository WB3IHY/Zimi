"""The best answer card: who may be given one, what it may cost, what it reads.

Runs against the same small served library as test_best_answer_live (its
`served` fixture): a wiki source with the articles the questions find, and a
second source with nothing about them.
"""

import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_best_answer_live import fresh, served  # noqa: E402,F401  (fixtures)

QUESTION = "how to purify water"


def _as_allowed(allow, fn):
    import zimi.server as srv

    srv.set_request_allow(allow)
    try:
        return fn()
    finally:
        srv.clear_request_allow()


def _ask(scope=None):
    import zimi.server as srv

    return srv.best_answer_for(QUESTION, scope or "", scope or None, 10)


# ── who may be given a card ────────────────────────────────────────────────


def test_a_restricted_session_is_never_given_a_card_made_for_all_access(served):
    """An all-access session asks and the card is cached; a user limited to
    the other source asks the same thing, scoped and unscoped, and gets none."""
    full = _ask()
    assert full["answer"]["title"] == "Water purification"
    assert _ask("wiki_en_test")["answer"]["title"] == "Water purification"
    for scope in (None, "wiki_en_test"):
        got = _as_allowed({"almanac_en_test"}, lambda: _ask(scope))
        assert got == {"answer": None}, (scope, got)
    assert _ask() == full  # and all-access still has its own


def test_a_limited_public_visitor_is_never_given_a_card_made_for_all_access(served):
    from test_public_access import _FakeHandler

    from zimi import users

    assert _ask()["answer"]["title"] == "Water purification"
    users.set_public_access("limited", ["almanac_en_test"])
    try:
        allow = users.request_allow(_FakeHandler(private=False))
        assert allow == {"almanac_en_test"}
        for scope in (None, "wiki_en_test"):
            got = _as_allowed(allow, lambda: _ask(scope))
            assert got == {"answer": None}, (scope, got)
    finally:
        users.set_public_access("open")


# ── the card's own work stays inside its budget ────────────────────────────


def _record_searches(monkeypatch, first_takes=0.0):
    """Wrap search_all; returns the list of (query, fast) it was called with."""
    import zimi.search as search

    real = search.search_all
    calls = []

    def spy(q, limit=5, filter_zim=None, fast=False):
        calls.append((q, fast))
        if len(calls) == 1 and first_takes:
            time.sleep(first_takes)
        return real(q, limit=limit, filter_zim=filter_zim, fast=fast)

    monkeypatch.setattr(search, "search_all", spy)
    return calls


def test_no_full_text_search_runs_after_the_budget_is_spent(served, monkeypatch):
    """The first search (as slow as a Pi's) uses the whole budget on a question
    the search cannot read; the card must not start another full-text one."""
    import zimi.bestanswer as ba
    import zimi.server as srv

    monkeypatch.setattr(ba, "BUDGET_SECONDS", 0.05)
    calls = _record_searches(monkeypatch, first_takes=0.2)
    q = "wer hat die Mona Lisa wirklich gemalt"  # "wirklich" is in no article
    got = srv.best_answer_for(q, "", None, 10)
    assert got == {"answer": None}
    assert calls == [(q, False)], calls


def test_the_second_search_for_a_sparse_question_is_titles_only(served, monkeypatch):
    import zimi.server as srv

    calls = _record_searches(monkeypatch)
    got = srv.best_answer_for("wer hat die Mona Lisa gemalt", "", None, 10)
    assert got["answer"]["title"] == "Mona Lisa (Gemälde)"
    assert len(calls) > 1 and all(fast for _, fast in calls[1:]), calls


def test_the_same_card_asked_at_once_is_made_once(served, monkeypatch):
    import threading

    import zimi.bestanswer as ba
    import zimi.search as search

    real = ba.best_answer
    made = []

    def slow(*a, **k):
        made.append(1)
        time.sleep(0.3)
        return real(*a, **k)

    monkeypatch.setattr(ba, "best_answer", slow)
    out = []
    ts = [threading.Thread(target=lambda: out.append(_ask())) for _ in range(5)]
    [t.start() for t in ts]
    [t.join(30) for t in ts]
    assert len(made) == 1 and len(out) == 5 and all(o == out[0] for o in out)
    assert search  # imported for the monkeypatched module's side


# ── what is read ───────────────────────────────────────────────────────────


def test_a_pdf_or_a_collection_of_pdfs_is_never_read_for_a_card():
    import zimi.bestanswer as ba

    hits = [
        {"zim": "wiki_en_test", "path": "files/paper.PDF", "title": "A paper"},
        {"zim": "zimgit-water_en_2024-08", "path": "files/x", "title": "Water"},
        {"zim": "wiki_en_test", "path": "A/Book.epub", "title": "A book"},
        {
            "zim": "wiki_en_test",
            "path": "A/Water_purification",
            "title": "Water purification",
        },
    ]
    assert [h["path"] for h in ba._readable_hits(hits, {})] == ["A/Water_purification"]


# ── a scoped question reads as a question ──────────────────────────────────


def test_a_question_scoped_to_one_source_is_cleaned_like_an_unscoped_one(served):
    """Scoped, 'how' went to the index as a word the article must hold and the
    search found nothing (v1.6.0 to 1.15); unscoped it always found it."""
    import zimi.server as srv

    srv._search_cache_clear()
    scoped = srv.search_all(QUESTION, limit=10, filter_zim="wiki_en_test")
    assert [r["path"] for r in scoped["results"]] == ["A/Water_purification"]
    unscoped = srv.search_all(QUESTION, limit=10)
    assert [r["path"] for r in unscoped["results"]] == ["A/Water_purification"]


def test_a_scoped_search_of_only_function_words_still_runs(served):
    import zimi.server as srv

    srv._search_cache_clear()
    got = srv.search_all("how to", limit=10, filter_zim="wiki_en_test")
    assert "results" in got and "error" not in got


def test_the_card_does_not_add_to_the_searchs_cached_results(served):
    import zimi.server as srv

    q = "wer hat die Mona Lisa gemalt"
    srv._search_cache_clear()
    before = len(srv.search_all(q, limit=10)["results"])
    srv.best_answer_for(q, "", None, 10)
    assert len(srv.search_all(q, limit=10)["results"]) == before
