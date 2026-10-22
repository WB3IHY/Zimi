"""Settings follow the account (Eric, 2026-10-21: "Things a user changes while
signed in should sync to all sessions all browsers"), on the convention in
users.py's docstring.

  • whose settings a request has (users.request_data_owner, and /whoami's
    ``account``): a named user's own, the primary admin's, nobody's for an
    anonymous visitor or where the password is switched off, never a name from
    the body; and
  • the account's settings: the server orders changes with its own revision
    (no device clock), the same value again is no change and no write, and a
    browser's first sync fills only an account that never held one.
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
    monkeypatch.setattr(server, "ZIMI_MANAGE", True)
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
        self.client_address = ("127.0.0.1", 0)

    def _is_private_client(self):
        return True

    def _json(self, status, body):
        self.status = status
        self.body = body
        return None

    def _json_cookie(self, status, body, cookie):
        return self._json(status, body)


def _cookie(token):
    return {"Cookie": "zimi_session=" + token}


def _whoami(headers=None):
    h = _Handler(headers)
    h._handle_whoami()
    return h.body


# ── whose settings ──


def test_a_named_user_is_their_own(data):
    users.create_user("Kid", "pw123")
    tok = users.create_session("Kid")
    assert users.request_data_owner(_Handler(_cookie(tok))) == "Kid"
    assert _whoami(_cookie(tok))["account"] == "Kid"


def test_the_primary_admin_has_an_account_of_its_own(data):
    manage._set_manage_password(ADMIN_PW)
    tok = users.create_admin_session()
    assert users.request_data_owner(_Handler(_cookie(tok))) == users.PRIMARY_ADMIN_DATA
    assert _whoami(_cookie(tok))["account"] == users.PRIMARY_ADMIN_DATA
    h = _Handler({"Authorization": "Bearer " + ADMIN_PW})
    assert users.request_data_owner(h) == users.PRIMARY_ADMIN_DATA
    ok, _ = users.create_user(users.PRIMARY_ADMIN_DATA, "pw123")
    assert not ok, "no account may take the admin's name"


def test_a_secondary_admin_is_their_own(data):
    manage._set_manage_password(ADMIN_PW)
    users.create_user("Deputy", "pw123", role="admin")
    tok = users.create_session("Deputy")
    assert _whoami(_cookie(tok))["account"] == "Deputy"


def test_an_anonymous_visitor_has_none(data):
    manage._set_manage_password(ADMIN_PW)
    assert users.request_data_owner(_Handler()) is None
    assert users.request_data_owner(_Handler({"Authorization": "Bearer wrong"})) is None
    assert _whoami()["account"] is None


def test_password_switched_off_every_browser_is_the_admins(data, monkeypatch):
    # Eric, 2026-10-22: "Password off should still sync."
    manage._set_manage_password(ADMIN_PW)
    monkeypatch.setenv("ZIMI_MANAGE_OPEN", "1")
    me = _whoami()
    assert me["role"] == "admin" and me["account"] == users.PRIMARY_ADMIN_DATA
    p = _Handler()
    p._handle_settings_post({"changes": {"zimi_reader_theme": {"v": "sepia"}}})
    g = _Handler()
    g._handle_settings_get()
    assert g.status == 200 and g.body["settings"]["zimi_reader_theme"]["v"] == "sepia"
    # a named user signed in there is still their own
    users.create_user("Kid", "pw123")
    assert _whoami(_cookie(users.create_session("Kid")))["account"] == "Kid"


def test_no_password_no_admin_account(data):
    assert users.request_data_owner(_Handler()) is None


def test_a_name_in_the_body_is_ignored(data):
    users.create_user("Kid", "pw123")
    users.create_user("Other", "pw123")
    tok = users.create_session("Kid")
    h = _Handler(_cookie(tok))
    h._handle_settings_post(
        {
            "name": "Other",
            "user": "Other",
            "changes": {"zimi_reader_theme": {"v": "dark"}},
        }
    )
    assert h.status == 200
    assert users.load_settings("Kid")["settings"]["zimi_reader_theme"]["v"] == "dark"
    assert users.load_settings("Other") == {"rev": 0, "settings": {}}
    a = _Handler()
    a._handle_settings_post(
        {"name": "Kid", "changes": {"zimi_reader_theme": {"v": "x"}}}
    )
    assert a.status == 401


# ── the account's settings ──


def _change(name, changes, fill=False):
    ok, err, doc = users.change_settings(name, changes, fill_only=fill)
    assert ok, err
    return doc


def test_the_server_orders_changes_with_its_own_revision(data):
    d = _change("kid", {"zimi_pref_languages": {"v": '["en","es"]'}})
    assert d["rev"] == 1 and d["settings"]["zimi_pref_languages"] == {
        "v": '["en","es"]',
        "r": 1,
    }
    # another browser changes another key: both stay; the last change to arrive wins
    d = _change("kid", {"zimi_reader_theme": {"v": "sepia"}, "t": 10**15})
    assert d["rev"] == 2 and d["settings"]["zimi_pref_languages"]["v"] == '["en","es"]'
    d = _change("kid", {"zimi_reader_theme": {"v": "dark", "t": 0, "r": 999}})
    assert d["settings"]["zimi_reader_theme"] == {
        "v": "dark",
        "r": 3,
    }, "a device's numbers are never taken"


def test_the_same_value_again_is_no_change_and_no_write(data):
    _change("kid", {"zimi_reader_theme": {"v": "sepia"}})
    path = users._settings_path("kid")
    before = os.stat(path).st_mtime_ns
    os.utime(path, ns=(before - 10**9, before - 10**9))
    d = _change("kid", {"zimi_reader_theme": {"v": "sepia"}})
    assert d["rev"] == 1
    assert (
        os.stat(path).st_mtime_ns == before - 10**9
    ), "nothing changed, nothing written"


def test_a_setting_back_at_its_default_travels_as_none(data):
    _change("kid", {"zimi_pref_languages": {"v": '["en","es"]'}})
    assert _change("kid", {"zimi_pref_languages": {"v": None}})["settings"][
        "zimi_pref_languages"
    ] == {"v": None, "r": 2}


def test_a_first_sync_fills_only_an_account_that_never_held_one(data):
    d = _change(
        "kid",
        {"zimi_ui_lang": {"v": "es"}, "zimi_reader_font_scale": {"v": "120"}},
        fill=True,
    )
    assert d["rev"] == 2
    d = _change(
        "kid",
        {"zimi_ui_lang": {"v": "de"}, "zimi_reader_theme": {"v": "dark"}},
        fill=True,
    )
    assert (
        d["rev"] == 2
        and d["settings"]["zimi_ui_lang"]["v"] == "es"
        and "zimi_reader_theme" not in d["settings"]
    )


def test_settings_are_cleaned(data):
    d = _change(
        "kid",
        {
            "zimi_reader_theme": {"v": "sepia"},
            "not_ours": {"v": "x"},
            "zimi_bad": {"v": 5},
            "zimi_big": {"v": "x" * (users._SETTINGS_VALUE_MAX + 1)},
            "zimi_shape": "x",
        },
    )
    assert set(d["settings"]) == {"zimi_reader_theme"}


def test_settings_change_leaves_the_saved_store_alone(data):
    users.save_user_data("kid", {"history": [{"zim": "a", "path": "b"}]})
    blob = os.path.join(server.ZIMI_DATA_DIR, "userdata", "kid.json")
    before = os.stat(blob).st_mtime_ns
    _change("kid", {"zimi_reader_theme": {"v": "sepia"}})
    assert (
        os.stat(blob).st_mtime_ns == before
    ), "a setting never rewrites the saved store"
    assert users.load_user_data("kid")["history"] == [{"zim": "a", "path": "b"}]


def test_settings_ride_the_server_backup(data):
    users.save_user_data("kid", {"history": []})
    _change("kid", {"zimi_reader_theme": {"v": "sepia"}})
    snap = users.all_user_data()
    assert snap["kid"]["settings"]["settings"]["zimi_reader_theme"]["v"] == "sepia"
    users.restore_user_data({"kid": {"settings": {"rev": 0}}}, overwrite=True)
    assert users.load_settings("kid")["rev"] == 0
    users.restore_user_data(snap, overwrite=True)
    assert users.load_settings("kid")["settings"]["zimi_reader_theme"]["v"] == "sepia"


def test_deleting_an_account_takes_its_settings(data):
    users.create_user("Kid", "pw123")
    _change("Kid", {"zimi_reader_theme": {"v": "sepia"}})
    users.delete_user("Kid")
    assert not os.path.exists(users._settings_path("Kid"))
