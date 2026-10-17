"""ZIMI_FIELDGUIDE: the Field Guide and Help now are out of the release.

Off (the default), nothing reaches them: the routes and the guide's static
files answer 404, a search carries no hint and no match, the shell is not
stamped for the client (which then draws no Help now), the service worker
precaches no guide file, and the door's allowlists leave the guide out. On,
all of it is as it was.

Run: pytest tests/test_fieldguide_switch.py -v
"""

import json
import os
import sys
import threading
import urllib.error
import urllib.request

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import zimi.server as srv  # noqa: E402
from zimi import http  # noqa: E402


@pytest.fixture
def base(tmp_path, monkeypatch):
    from http.server import ThreadingHTTPServer

    monkeypatch.setattr(srv, "ZIM_DIR", str(tmp_path))
    monkeypatch.setattr(srv, "ZIMI_DATA_DIR", str(tmp_path / "data"))
    os.makedirs(str(tmp_path / "data"), exist_ok=True)
    monkeypatch.setenv("ZIMI_OFFLINE", "1")
    srv.load_cache(force=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), http.ZimHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield "http://127.0.0.1:%d" % httpd.server_address[1]
    httpd.shutdown()


def _get(base, path):
    try:
        with urllib.request.urlopen(base + path, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


GUIDE_ROUTES = (
    "/fieldguide",
    "/fieldguide/home",
    "/fieldguide/situation?id=bleeding",
    "/fieldguide/match?q=bleeding",
    "/fieldguide/print",
    "/manage/fieldmanual",
    "/static/fieldguide.html",
    "/static/fieldguide-card.js",
    "/static/fieldguide-offline.json",
)


def test_it_is_off_by_default():
    assert not srv.fieldguide_enabled()


@pytest.mark.parametrize("path", GUIDE_ROUTES)
def test_off_the_guide_routes_and_files_are_not_found(base, path):
    assert _get(base, path)[0] == 404


def test_off_a_search_for_bleeding_carries_no_guide(base):
    status, body = _get(base, "/search?q=bleeding")
    assert status == 200 and b"fieldguide" not in body
    first = json.loads(
        _get(base, "/search?q=tourniquet&stream=1&fast=1")[1].splitlines()[0]
    )
    assert "fieldguide" not in first["result"]


def test_off_the_shell_is_not_stamped_and_help_now_is_not_in_it(base):
    status, body = _get(base, "/")
    assert status == 200
    assert b"data-zimi-fieldguide" not in body


def test_off_the_offline_shell_keeps_no_guide_file():
    assert not [u for u in http._offline_shell_urls() if "fieldguide" in u]


def test_off_the_door_lists_leave_the_guide_out():
    for surface in (http._PRIVATE_LOGIN_SURFACE_EXACT, http._SETUP_SURFACE):
        assert not any(
            http._open_at_the_door(p, surface) for p in http._FIELDGUIDE_DOOR
        )


@pytest.mark.fieldguide_on
def test_on_everything_answers_and_the_shell_is_stamped(base):
    assert _get(base, "/fieldguide")[0] == 200
    assert _get(base, "/static/fieldguide.html")[0] == 200
    assert b'data-zimi-fieldguide="1"' in _get(base, "/")[1]
    assert any("fieldguide" in u for u in http._offline_shell_urls())


@pytest.mark.fieldguide_on
def test_on_the_door_lists_carry_only_the_guides_quotes():
    for surface in (http._PRIVATE_LOGIN_SURFACE_EXACT, http._SETUP_SURFACE):
        assert all(http._open_at_the_door(p, surface) for p in http._FIELDGUIDE_DOOR)
    assert not http._open_at_the_door("/fieldguide/library", http._SETUP_SURFACE)
