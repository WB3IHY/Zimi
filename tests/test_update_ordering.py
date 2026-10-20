"""What counts as "a newer Zimi", and that there is no channel to pick.

Only finished releases count: the check asks GitHub's /releases/latest, which
hides pre-releases, and a pre-release never reads as newer than the same
version's final or than another pre-release of it. There is no beta track, so
the channel setting, its endpoint and its env var are gone; a pref file an
older build wrote still loads.

ZIMI_OFFLINE outranks all of it: no force, no preference makes an air-gapped
instance talk to GitHub.
"""

import json
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import zimi.manage as manage  # noqa: E402
import zimi.server as server  # noqa: E402


@pytest.mark.parametrize(
    "remote,current,expected",
    [
        ("1.9.0-rc2", "1.9.0-rc1", False),  # pre-vs-pre stays quiet
        ("1.9.0-rc1", "1.9.0-beta3", False),
        ("1.9.0-beta1", "1.9.0", False),  # a pre never beats its final
        ("1.9.0", "1.9.0-rc1", True),  # the final always wins
        ("1.9.0-beta1", "1.8.2", True),  # higher numbers beat everything
        ("1.9.0", "1.8.2", True),
        ("1.9.0-rc1", "1.9.0-rc1", False),  # same build, no nag
        ("junk", "1.9.0", False),
    ],
)
def test_newer_release_ordering(remote, current, expected):
    assert manage._app_version_newer(remote, current) is expected


class _FakeResponse:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def fake_github(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "ZIMI_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ZIMI_OFFLINE", raising=False)
    calls = []

    def fake_urlopen(req, timeout=None, context=None):
        calls.append(req.full_url)
        return _FakeResponse({"tag_name": "v1.8.3", "html_url": "https://x/1.8.3"})

    monkeypatch.setattr(manage.urllib.request, "urlopen", fake_urlopen)
    return calls


def test_the_check_asks_for_the_latest_final_release_only(fake_github):
    entry = manage.check_app_update()
    assert fake_github == [manage._APP_UPDATE_URL]
    assert entry["latest"] == "1.8.3"


def test_a_channel_saved_by_an_older_build_changes_nothing(fake_github, tmp_path):
    with open(os.path.join(str(tmp_path), "app_update_channel.json"), "w") as f:
        json.dump({"channel": "beta"}, f)
    manage.check_app_update()
    assert fake_github == [manage._APP_UPDATE_URL]


def test_offline_kills_the_check(fake_github, monkeypatch):
    monkeypatch.setenv("ZIMI_OFFLINE", "1")
    assert manage.check_app_update().get("offline") is True
    assert manage.check_app_update(force=True).get("offline") is True
    assert fake_github == []


def _hit(path, method="GET", data=None):
    h = MagicMock()
    captured = {}

    def _json(status, payload):
        captured["status"] = status
        captured["payload"] = payload

    h._json = _json
    parsed = MagicMock()
    parsed.path = path
    if method == "GET":
        manage.handle_manage_get(h, parsed, {})
    else:
        manage.handle_manage_post(h, parsed, data or {})
    return captured.get("status"), captured.get("payload")


def test_the_payload_has_no_channel(fake_github, monkeypatch):
    monkeypatch.setattr(server, "ZIMI_MANAGE", True)
    monkeypatch.setattr(manage, "_manage_auth_challenge", lambda h: None)
    status, body = _hit("/manage/app-update")
    assert status == 200
    assert body["latest"] == "1.8.3"
    for gone in ("channel", "channels", "channel_locked", "channel_env", "prerelease"):
        assert gone not in body
