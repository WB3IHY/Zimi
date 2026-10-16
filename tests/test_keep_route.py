"""/keep/<zim>: the raw .zim for a phone's own private storage.

The same bytes as /dl/ through a different door. /dl/ is LAN peer sharing
(private clients and the sharing switch); /keep/ is for a person signed in over
any network, so that a phone away from home can carry a ZIM. These tests hold
the rules:

  - a signed-in user, an admin, a direct private-network client or whoever
    /dl/'s sharing rules admit may pull; an anonymous visitor over the internet
    may not, even on an open instance (a whole library is the most bandwidth a
    request can ask for);
  - the ZIM must be in the caller's allowlist: one outside it is "not found",
    not "forbidden", so a restricted user cannot learn it exists;
  - Range answers 206 and resumes; the ETag is the file's identity, and
    If-Range with a stale one answers the whole new file, so a pull resumed
    after the ZIM was replaced in place (auto-update) starts over instead of
    appending the new file's tail to the old one's head;
  - never stored by a cache.

Run: pytest tests/test_keep_route.py -v
"""

import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

import zimi.server as _srv
import zimi.users as _users
from zimi.http import ZimHandler

_BODY = bytes(range(256)) * 64  # 16 KiB


def _get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


class KeepRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls._path = os.path.join(cls._tmp.name, "keepme_2026-01.zim")
        with open(cls._path, "wb") as f:
            f.write(_BODY)
        cls._other = os.path.join(cls._tmp.name, "other_2026-01.zim")
        with open(cls._other, "wb") as f:
            f.write(b"x" * 100)
        cls._saved = _srv._zim_files_cache
        _srv._zim_files_cache = {"keepme": cls._path, "other": cls._other}
        # Sharing off: the /dl/ switch must not be what lets /keep/ through.
        os.environ["ZIMI_PEER_SHARE"] = "0"
        cls._server = ThreadingHTTPServer(("127.0.0.1", 0), ZimHandler)
        cls._port = cls._server.server_address[1]
        threading.Thread(target=cls._server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls._server.shutdown()
        cls._server.server_close()
        _srv._zim_files_cache = cls._saved
        cls._tmp.cleanup()
        os.environ.pop("ZIMI_PEER_SHARE", None)

    def url(self, name="keepme"):
        return "http://127.0.0.1:%d/keep/%s" % (self._port, name)

    def _internet_anonymous(self):
        """The request as a stranger over the internet: not a direct private
        client, nobody signed in, no sharing."""
        return (
            mock.patch.object(ZimHandler, "_is_direct_private_client", lambda s: False),
            mock.patch.object(ZimHandler, "_peer_share_allowed", lambda s: False),
            mock.patch.object(_users, "resolve_request_user", lambda h: None),
            mock.patch.object(_users, "_request_is_admin", lambda h: False),
        )

    def _as(self, patches):
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    # ── who may ─────────────────────────────────────────────────────────

    def test_a_direct_private_client_may_pull(self):
        status, _, body = _get(self.url())
        self.assertEqual((status, body), (200, _BODY))

    def test_an_anonymous_visitor_over_the_internet_may_not(self):
        self._as(self._internet_anonymous())
        status, _, body = _get(self.url())
        self.assertEqual(status, 403)
        self.assertNotIn(b"\x00\x01\x02", body)

    def test_a_signed_in_user_over_the_internet_may(self):
        patches = list(self._internet_anonymous())
        patches[2] = mock.patch.object(_users, "resolve_request_user", lambda h: "eric")
        self._as(patches)
        status, headers, body = _get(self.url(), {"Range": "bytes=10-19"})
        self.assertEqual(status, 206)
        self.assertEqual(body, _BODY[10:20])
        self.assertEqual(headers["Content-Range"], "bytes 10-19/%d" % len(_BODY))

    def test_an_admin_over_the_internet_may(self):
        patches = list(self._internet_anonymous())
        patches[3] = mock.patch.object(_users, "_request_is_admin", lambda h: True)
        self._as(patches)
        self.assertEqual(_get(self.url())[0], 200)

    def test_a_zim_outside_the_users_allowlist_is_not_found(self):
        patches = list(self._internet_anonymous())
        patches[2] = mock.patch.object(_users, "resolve_request_user", lambda h: "kid")
        patches.append(mock.patch.object(_users, "request_allow", lambda h: {"other"}))
        self._as(patches)
        self.assertEqual(_get(self.url("keepme"))[0], 404)
        self.assertEqual(_get(self.url("other"))[0], 200)

    def test_an_unknown_zim_is_not_found(self):
        self.assertEqual(_get(self.url("nope"))[0], 404)

    def test_a_path_cannot_leave_the_library(self):
        self.assertEqual(_get(self.url("..%2F..%2Fetc%2Fpasswd"))[0], 404)

    # ── resuming ────────────────────────────────────────────────────────

    def test_it_says_which_file_it_is_and_is_never_stored(self):
        status, headers, _ = _get(self.url())
        self.assertEqual(status, 200)
        self.assertRegex(headers["ETag"], r'^"%d-\d+"$' % len(_BODY))
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["Accept-Ranges"], "bytes")

    def test_a_pull_resumes_from_where_it_stopped(self):
        _, headers, _ = _get(self.url(), {"Range": "bytes=0-0"})
        etag = headers["ETag"]
        status, _, body = _get(self.url(), {"Range": "bytes=8192-", "If-Range": etag})
        self.assertEqual(status, 206)
        self.assertEqual(body, _BODY[8192:])

    def test_a_pull_after_the_zim_was_replaced_starts_over(self):
        _, headers, _ = _get(self.url(), {"Range": "bytes=0-0"})
        old = headers["ETag"]
        replaced = bytes(reversed(_BODY)) + b"more"
        with open(self._path, "wb") as f:
            f.write(replaced)
        try:
            status, headers, body = _get(
                self.url(), {"Range": "bytes=8192-", "If-Range": old}
            )
            self.assertEqual(
                status, 200, "a stale If-Range must get the whole new file"
            )
            self.assertEqual(body, replaced)
            self.assertNotEqual(headers["ETag"], old)
            # And with the new identity, resuming works again.
            status, _, body = _get(
                self.url(), {"Range": "bytes=100-", "If-Range": headers["ETag"]}
            )
            self.assertEqual((status, body), (206, replaced[100:]))
        finally:
            with open(self._path, "wb") as f:
                f.write(_BODY)

    def test_a_range_without_if_range_is_still_honoured(self):
        status, _, body = _get(self.url(), {"Range": "bytes=-16"})
        self.assertEqual((status, body), (206, _BODY[-16:]))


if __name__ == "__main__":
    unittest.main()
