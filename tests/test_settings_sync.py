"""Settings follow the account (Eric, 2026-10-21: "Things a user changes while
signed in should sync to all sessions all browsers").

Two parts:
  • whose /userdata a request is (users.request_data_owner): a named user's
    own, the primary admin's, nobody's for an anonymous visitor, and never a
    name from the body; and
  • the account's settings, merged key by key, the newer change winning.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import zimi.http as http  # noqa: E402
import zimi.server as server  # noqa: E402
from zimi import manage, users  # noqa: E402

ADMIN_PW = "adminpw-settings"


@pytest.fixture
def data(monkeypatch, tmp_path):
    d = tmp_path / "data"
    d.mkdir()
    monkeypatch.setattr(server, "ZIMI_DATA_DIR", str(d))
    for var in (
        "ZIMI_MANAGE_PASSWORD",
        "ZIMI_MANAGE_USER",
        "ZIMI_API_TOKEN",
        "ZIMI_MANAGE_OPEN",
    ):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(manage, "_env_pw_hash_cache", None, raising=False)
    server.clear_request_allow()
    yield d
    server.clear_request_allow()


class _Handler(http.ZimHandler):
    """No socket: headers in, the JSON answer captured."""

    def __init__(self, headers=None):
        self.headers = headers or {}
        self.status = None
        self.body = None

    def _is_private_client(self):
        return True

    def _json(self, status, body):
        self.status = status
        self.body = body
        return None


def _cookie(token):
    return {"Cookie": "zimi_session=" + token}


# ── whose data ──


def test_a_named_user_is_their_own(data):
    users.create_user("Kid", "pw123")
    tok = users.create_session("Kid")
    assert users.request_data_owner(_Handler(_cookie(tok))) == "Kid"


def test_the_primary_admin_has_an_account_of_its_own(data):
    manage._set_manage_password(ADMIN_PW)
    tok = users.create_admin_session()
    assert users.request_data_owner(_Handler(_cookie(tok))) == users.PRIMARY_ADMIN_DATA
    # signed in with the password itself too
    h = _Handler({"Authorization": "Bearer " + ADMIN_PW})
    assert users.request_data_owner(h) == users.PRIMARY_ADMIN_DATA
    # and no account can be named for it
    ok, _ = users.create_user(users.PRIMARY_ADMIN_DATA, "pw123")
    assert not ok


def test_an_anonymous_visitor_has_none(data):
    manage._set_manage_password(ADMIN_PW)
    assert users.request_data_owner(_Handler()) is None
    assert users.request_data_owner(_Handler({"Authorization": "Bearer wrong"})) is None


def test_no_password_no_admin_account(data):
    # Every private visitor counts as the admin here: one shared account would
    # hand each the others' settings.
    assert users.request_data_owner(_Handler()) is None


def test_admin_userdata_round_trips(data):
    manage._set_manage_password(ADMIN_PW)
    tok = users.create_admin_session()
    h = _Handler(_cookie(tok))
    h._handle_userdata_post({"settings": {"zimi_reader_theme": {"v": "sepia", "t": 5}}})
    assert h.status == 200 and h.body["settings"]["zimi_reader_theme"]["v"] == "sepia"
    g = _Handler(_cookie(tok))
    g._handle_userdata_get()
    assert g.status == 200 and g.body["settings"]["zimi_reader_theme"] == {
        "v": "sepia",
        "t": 5,
    }


def test_a_name_in_the_body_is_ignored(data):
    users.create_user("Kid", "pw123")
    users.create_user("Other", "pw123")
    tok = users.create_session("Kid")
    h = _Handler(_cookie(tok))
    h._handle_userdata_post(
        {
            "name": "Other",
            "user": "Other",
            "settings": {"zimi_reader_theme": {"v": "dark", "t": 9}},
        }
    )
    assert h.status == 200
    assert users.load_user_data("Kid")["settings"]["zimi_reader_theme"]["v"] == "dark"
    assert users.load_user_data("Other")["settings"] == {}
    # anonymous, a body name changes nothing either
    a = _Handler()
    a._handle_userdata_post(
        {"name": "Kid", "settings": {"zimi_reader_theme": {"v": "x", "t": 99}}}
    )
    assert a.status == 401


# ── the merge ──


def _sync(name, settings):
    ok, err, doc = users.sync_user_data(name, {"settings": settings})
    assert ok, err
    return doc["settings"]


def test_settings_merge_key_by_key_newer_wins(data):
    _sync("kid", {"zimi_pref_languages": {"v": '["en","es"]', "t": 100}})
    # another browser changes a different setting: both stay
    got = _sync("kid", {"zimi_reader_theme": {"v": "sepia", "t": 200}})
    assert got["zimi_pref_languages"]["v"] == '["en","es"]'
    assert got["zimi_reader_theme"]["v"] == "sepia"
    # an older change loses, a newer one wins, a tie keeps what is kept
    assert (
        _sync("kid", {"zimi_reader_theme": {"v": "dark", "t": 150}})[
            "zimi_reader_theme"
        ]["v"]
        == "sepia"
    )
    assert (
        _sync("kid", {"zimi_reader_theme": {"v": "dark", "t": 200}})[
            "zimi_reader_theme"
        ]["v"]
        == "sepia"
    )
    assert (
        _sync("kid", {"zimi_reader_theme": {"v": "dark", "t": 201}})[
            "zimi_reader_theme"
        ]["v"]
        == "dark"
    )


def test_a_value_from_before_sync_fills_only_a_gap(data):
    _sync("kid", {"zimi_ui_lang": {"v": "es", "t": 50}})
    got = _sync(
        "kid",
        {
            "zimi_ui_lang": {"v": "de", "t": 0},
            "zimi_reader_font_scale": {"v": "120", "t": 0},
        },
    )
    assert (
        got["zimi_ui_lang"]["v"] == "es"
    ), "an unstamped value never outranks the account's"
    assert (
        got["zimi_reader_font_scale"]["v"] == "120"
    ), "but fills a setting the account lacks"


def test_a_setting_back_at_its_default_travels_as_none(data):
    _sync("kid", {"zimi_pref_languages": {"v": '["en","es"]', "t": 10}})
    assert _sync("kid", {"zimi_pref_languages": {"v": None, "t": 20}})[
        "zimi_pref_languages"
    ] == {"v": None, "t": 20}


def test_settings_are_cleaned(data):
    now = users._now_ms()
    got = _sync(
        "kid",
        {
            "zimi_reader_theme": {"v": "sepia", "t": now + 10**12},  # a clock far ahead
            "not_ours": {"v": "x", "t": 1},
            "zimi_bad": {"v": 5, "t": 1},
            "zimi_neg": {"v": "x", "t": -1},
            "zimi_big": {"v": "x" * (users._SETTINGS_VALUE_MAX + 1), "t": 1},
        },
    )
    assert set(got) == {"zimi_reader_theme"}
    assert got["zimi_reader_theme"]["t"] <= now + users._SAVED_FUTURE_MS + 1000


def test_saved_and_other_fields_are_untouched_by_a_settings_sync(data):
    users.save_user_data("kid", {"history": [{"zim": "a", "path": "b"}]})
    _sync("kid", {"zimi_reader_theme": {"v": "sepia", "t": 1}})
    blob = users.load_user_data("kid")
    assert blob["history"] == [{"zim": "a", "path": "b"}]
    # and a sync without settings keeps them
    users.sync_user_data("kid", {"history": []})
    assert users.load_user_data("kid")["settings"]["zimi_reader_theme"]["v"] == "sepia"
