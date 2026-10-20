"""kiwix-serve addresses that are in links people already have.

Project NOMAD's Information Library is kiwix-serve. What it puts in the address
bar (``/content/<book>/<page>``, ``/viewer#<book>/<page>``, a search) is what
gets bookmarked and pasted, and its translation add-on forwards the same paths.
Zimi answers exactly those, and nothing else of Kiwix's.

The oracle test compares against a real kiwix-serve when one is named:

    ZIMI_KIWIX_ORACLE=http://nomad:8090 ZIMI_KIWIX_ZIMI=http://nomad:8600 \\
    ZIMI_KIWIX_BOOK=wikipedia_en_100_2026-08 pytest tests/test_kiwix_addresses.py

Run: pytest tests/test_kiwix_addresses.py -v
"""

import http.client
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.parse
import urllib.request

import pytest

pytest.importorskip("libzim.writer")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import zimi.server as server  # noqa: E402
from zimi import http as zhttp  # noqa: E402

from conftest_zim import build_fixture_zim  # noqa: E402

FILE = "wikipedia_en_100_2026-08.zim"
BOOK = "wikipedia_en_100_2026-08"  # Kiwix's name for it
NAME = "wikipedia_en_100"  # Zimi's


def _alias(path, query="", document=False, resolve=lambda b: b):
    parsed = urllib.parse.urlparse(path + ("?" + query if query else ""))
    return zhttp._kiwix_alias(
        parsed, urllib.parse.parse_qs(parsed.query), document, resolve
    )


class TestAliasRules(unittest.TestCase):
    def test_a_page_opened_by_a_browser_goes_to_the_shell_address(self):
        self.assertEqual(
            _alias("/content/b/A/Water", document=True),
            ("redirect", "/w/b/A/Water"),
        )

    def test_a_page_fetched_by_anything_else_is_served_as_the_w_address(self):
        self.assertEqual(_alias("/content/b/A/Water"), ("path", "/w/b/A/Water"))

    def test_a_books_own_address_goes_to_its_main_page_for_everyone(self):
        self.assertEqual(_alias("/content/b"), ("redirect", "/w/b"))
        self.assertEqual(_alias("/content/b/"), ("redirect", "/w/b"))

    def test_the_book_is_named_the_way_zimi_names_it(self):
        resolve = lambda b: NAME if b == BOOK else b  # noqa: E731
        self.assertEqual(
            _alias(f"/content/{BOOK}/A/Water", resolve=resolve),
            ("path", f"/w/{NAME}/A/Water"),
        )

    def test_a_search_from_kiwix_goes_to_the_shell_search_scoped_to_its_book(self):
        self.assertEqual(
            _alias("/search", "content=b&pattern=clean+water", document=True),
            ("redirect", "/w/b?q=clean%20water"),
        )
        self.assertEqual(
            _alias("/search", "pattern=water", document=True), ("redirect", "/?q=water")
        )

    def test_zimis_own_search_and_everything_else_are_left_alone(self):
        self.assertIsNone(_alias("/search", "q=water&pattern=x", document=True))
        self.assertIsNone(_alias("/search", "pattern=water"))  # a script, not a page
        self.assertIsNone(_alias("/w/b/A/Water", document=True))
        self.assertIsNone(_alias("/content/", document=True))
        self.assertIsNone(_alias("/catalog/v2/entries"))


class TestAgainstARealServer(unittest.TestCase):
    def setUp(self):
        from http.server import ThreadingHTTPServer

        self._tmp = tempfile.mkdtemp(prefix="zimi-kx-")
        build_fixture_zim(os.path.join(self._tmp, FILE))
        self._saved = (server.ZIM_DIR, server.ZIMI_DATA_DIR)
        server.ZIM_DIR = self._tmp
        server.ZIMI_DATA_DIR = os.path.join(self._tmp, ".zimi")
        os.makedirs(server.ZIMI_DATA_DIR)
        server._zim_files_cache = None
        server._zim_list_cache = None
        server.load_cache(force=True)
        self._srv = ThreadingHTTPServer(("127.0.0.1", 0), zhttp.ZimHandler)
        threading.Thread(target=self._srv.serve_forever, daemon=True).start()
        self._port = self._srv.server_address[1]

    def tearDown(self):
        self._srv.shutdown()
        server.ZIM_DIR, server.ZIMI_DATA_DIR = self._saved
        server._zim_files_cache = None
        server._zim_list_cache = None
        shutil.rmtree(self._tmp, ignore_errors=True)

    def get(self, path, dest=None, accept=None):
        """One request, redirects not followed: (status, location, body)."""
        c = http.client.HTTPConnection("127.0.0.1", self._port, timeout=20)
        headers = {"Sec-Fetch-Dest": dest} if dest else {}
        if accept:
            headers["Accept"] = accept
        c.request("GET", path, headers=headers)
        r = c.getresponse()
        body = r.read()
        c.close()
        return r.status, r.getheader("Location"), body

    def test_the_library_names_it_without_the_date(self):
        self.assertIn(NAME, server.get_zim_files())

    def test_a_page_by_its_kiwix_address_is_the_same_bytes_as_its_zimi_address(self):
        status, _, body = self.get(f"/content/{BOOK}/A/Water")
        self.assertEqual(status, 200)
        self.assertIn(b"Water purification", body)
        self.assertEqual(body, self.get(f"/w/{NAME}/A/Water")[2])

    def test_an_iframe_gets_the_page_and_a_browser_tab_gets_the_shell(self):
        self.assertEqual(self.get(f"/content/{BOOK}/A/Water", "iframe")[0], 200)
        status, location, _ = self.get(f"/content/{BOOK}/A/Water", "document")
        self.assertEqual((status, location), (302, f"/w/{NAME}/A/Water"))

    def test_a_browser_on_a_lan_address_is_known_by_its_accept_alone(self):
        """Browsers send Sec-Fetch-Dest only to https and localhost; a NOMAD box
        is plain http on a LAN address, so the page open is told by Accept."""
        page = "text/html,application/xhtml+xml,*/*;q=0.8"
        status, location, _ = self.get(f"/content/{BOOK}/A/Water", accept=page)
        self.assertEqual((status, location), (302, f"/w/{NAME}/A/Water"))
        self.assertEqual(self.get(f"/content/{BOOK}/A/Water", accept="*/*")[0], 200)
        self.assertEqual(
            self.get(f"/search?content={BOOK}&pattern=water", accept=page)[1],
            f"/w/{NAME}?q=water",
        )

    def test_the_zimi_name_works_in_a_kiwix_address_too(self):
        self.assertEqual(self.get(f"/content/{NAME}/A/Fire")[0], 200)

    def test_a_book_root_goes_to_its_main_page(self):
        for path in (f"/content/{BOOK}", f"/content/{BOOK}/"):
            status, location, _ = self.get(path)
            self.assertEqual((status, location), (302, f"/w/{NAME}"), path)

    def test_a_book_that_is_not_there_is_a_404_not_a_page(self):
        self.assertEqual(self.get("/content/nobook/A/Water")[0], 404)
        self.assertEqual(
            self.get("/content/nobook/A/Water", "document")[1], "/w/nobook/A/Water"
        )

    def test_a_page_that_is_not_in_the_book_is_a_404(self):
        self.assertEqual(self.get(f"/content/{BOOK}/A/Nope")[0], 404)

    def test_the_viewer_hands_its_fragment_to_the_shell(self):
        status, _, body = self.get("/viewer")
        self.assertEqual(status, 200)
        text = body.decode()
        self.assertIn("location.replace", text)
        self.assertIn("'/content/' + h", text)
        # It can only ever send the reader to this server's own /w/ or /.
        self.assertNotIn("http", text.replace("</noscript>", ""))

    def test_a_kiwix_search_link_opens_the_shell_search(self):
        status, location, _ = self.get(
            f"/search?content={BOOK}&pattern=water", "document"
        )
        self.assertEqual((status, location), (302, f"/w/{NAME}?q=water"))

    def test_zimis_own_search_is_unchanged(self):
        status, _, body = self.get("/search?q=water&limit=3")
        self.assertEqual(status, 200)
        self.assertIn("results", json.loads(body))
        self.assertEqual(
            self.get("/search?pattern=water")[0], 400
        )  # a script, as before


ORACLE = os.environ.get("ZIMI_KIWIX_ORACLE", "").rstrip("/")
ZIMI = os.environ.get("ZIMI_KIWIX_ZIMI", "").rstrip("/")
ORACLE_BOOK = os.environ.get("ZIMI_KIWIX_BOOK", "")


class _NoFollow(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def _fetch(base, path, dest=None):
    req = urllib.request.Request(base + path)
    if dest:
        req.add_header("Sec-Fetch-Dest", dest)
    opener = urllib.request.build_opener(_NoFollow)
    try:
        r = opener.open(req, timeout=30)
        return r.status, r.headers.get("Location"), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Location"), e.read()


@pytest.mark.skipif(
    not (ORACLE and ZIMI and ORACLE_BOOK),
    reason="set ZIMI_KIWIX_ORACLE, ZIMI_KIWIX_ZIMI and ZIMI_KIWIX_BOOK to compare with a real kiwix-serve",
)
class TestAgainstKiwixServe(unittest.TestCase):
    """The same address, asked of kiwix-serve and of Zimi."""

    def _title(self, html):
        m = re.search(rb"<title>(.*?)</title>", html, re.S | re.I)
        return m.group(1).strip() if m else None

    def _an_article(self):
        status, location, _ = _fetch(ORACLE, f"/random?content={ORACLE_BOOK}")
        self.assertEqual(status, 302)
        return location.split(f"/content/{ORACLE_BOOK}/", 1)[1]

    def test_a_page_has_the_same_title_in_both(self):
        entry = self._an_article()
        k = _fetch(ORACLE, f"/content/{ORACLE_BOOK}/{entry}")
        z = _fetch(ZIMI, f"/content/{ORACLE_BOOK}/{entry}")
        self.assertEqual((k[0], z[0]), (200, 200), entry)
        self.assertEqual(self._title(k[2]), self._title(z[2]))

    def test_a_missing_page_and_a_missing_book_are_404_in_both(self):
        for path in (
            f"/content/{ORACLE_BOOK}/A/No_Such_Page_Anywhere",
            "/content/no_such_book/A/x",
        ):
            self.assertEqual(_fetch(ORACLE, path)[0], _fetch(ZIMI, path)[0], path)

    def test_a_book_root_is_a_redirect_in_both(self):
        for base in (ORACLE, ZIMI):
            status, location, _ = _fetch(base, f"/content/{ORACLE_BOOK}")
            self.assertEqual(status, 302, base)
            self.assertTrue(location, base)

    def test_a_pasted_search_link_lands_on_a_page_in_both(self):
        for base in (ORACLE, ZIMI):
            status, location, _ = _fetch(
                base, f"/search?content={ORACLE_BOOK}&pattern=water", "document"
            )
            self.assertIn(status, (200, 302), base)

    def test_the_viewer_opens_in_both(self):
        for base in (ORACLE, ZIMI):
            self.assertEqual(_fetch(base, "/viewer")[0], 200, base)
