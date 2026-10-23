"""An open window hears its account's changes as they happen (Eric,
2026-10-19: "I'd in general want the site to expect server-side changes to
anything at any time and update live"): changes.py's log, the writes that
announce into it, and where a reopened stream picks up.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zimi import changes, users  # noqa: E402
from tests.test_settings_sync import data  # noqa: E402,F401  (the fixture)


def _heard(after, owner):
    return changes.wait(after, owner, 0)[1]


def test_a_change_is_heard_by_its_account_only():
    start = changes.resume_from(None)
    changes.announce("settings", "alice", "tab-1")
    assert _heard(start, "alice") == [{"topic": "settings", "by": "tab-1"}]
    assert _heard(start, "bob") == []


def test_a_quiet_stream_waits_then_says_nothing():
    start = changes.resume_from(None)
    assert changes.wait(start, "alice", 0.05) == (start, [])


def test_a_setting_that_changed_is_announced_with_the_window_that_sent_it(data):
    start = changes.resume_from(None)
    users.change_settings("alice", {"zimi_reader_theme": {"v": "sepia"}}, by="tab-1")
    assert _heard(start, "alice") == [{"topic": "settings", "by": "tab-1"}]
    # The same value again changes nothing, and nobody is told.
    again = changes.resume_from(None)
    users.change_settings("alice", {"zimi_reader_theme": {"v": "sepia"}}, by="tab-2")
    assert _heard(again, "alice") == []


def test_the_saved_store_is_announced_only_when_it_changed(data):
    start = changes.resume_from(None)
    users.sync_user_data("alice", {"history": []}, by="tab-1")
    assert _heard(start, "alice") == []
    saved = {"lists": {"trips": {"name": "Trips", "order": 1, "ts": 1000}}}
    users.sync_user_data("alice", {"saved": saved}, now_ms=2000, by="tab-1")
    assert _heard(start, "alice") == [{"topic": "saved", "by": "tab-1"}]
    # The same store again: nothing new to hear.
    again = changes.resume_from(None)
    users.sync_user_data("alice", {"saved": saved}, now_ms=3000, by="tab-2")
    assert _heard(again, "alice") == []


def test_a_reopened_stream_picks_up_where_it_left_off():
    place = changes.place(changes.resume_from(None))
    changes.announce("saved", "alice")
    after = changes.resume_from(place)
    assert _heard(after, "alice") == [{"topic": "saved", "by": None}]


def test_a_place_from_before_a_restart_hears_everything_once():
    after = changes.resume_from("feedface.3")
    assert after == -1
    topics = {c["topic"] for c in _heard(after, "alice")}
    assert topics == {"settings", "saved"}


def test_a_stream_further_behind_than_the_log_hears_everything():
    start = changes.resume_from(None)
    for _ in range(changes._LOG_MAX + 5):
        changes.announce("settings", "bob")
    assert {c["topic"] for c in _heard(start, "alice")} == {"settings", "saved"}


def test_one_change_said_once_however_often_it_was_announced():
    start = changes.resume_from(None)
    for _ in range(3):
        changes.announce("settings", "alice", "tab-1")
    assert _heard(start, "alice") == [{"topic": "settings", "by": "tab-1"}]
