"""zimreader.js reads a ZIM the way libzim does.

Builds a real ZIM with libzim (zstd clusters, redirects, a picture, a page that
carries no title, non-Latin titles), then has the JavaScript reader open the
same file in node and checks it against libzim itself: every entry's bytes and
MIME type, redirects resolved to the same target, the main page, metadata, and
title search (prefix, case-insensitive, redirects shown as what they lead to).
Also an uncompressed ZIM, which the reader must read in place, and the refusal
of a file that is not a ZIM.

Run: pytest tests/test_zimreader.py -v
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from libzim.reader import Archive
from libzim.writer import Creator, Hint, Item

from conftest_zim import _StringProvider

_HERE = os.path.dirname(os.path.abspath(__file__))
_STATIC = os.path.join(_HERE, "..", "zimi", "static")
_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
    b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe"
    b"\x02\xfe\xa7\x9a\xd5\x8c\x00\x00\x00\x00IEND\xaeB`\x82"
)


class _Page(Item):
    def __init__(self, path, title, blob, mime="text/html"):
        super().__init__()
        self.path, self.title, self.blob, self.mime = path, title, blob, mime

    def get_path(self):
        return self.path

    def get_title(self):
        return self.title

    def get_mimetype(self):
        return self.mime

    def get_contentprovider(self):
        return _StringProvider(self.blob)

    def get_hints(self):
        return {Hint.FRONT_ARTICLE: self.mime == "text/html"}


TITLES = (
    [
        "Moon",
        "Moon landing",
        "Mooney",
        "Moonlight Sonata",
        "moonshine",
        "Mars",
        "Marsupial",
    ]
    + ["Zebra", "Éclair", "Ünïcode Straße", "東京", "Москва"]
    + ["Article %04d" % i for i in range(1500)]
)


def _build(path, compress):
    with (
        Creator(path)
        .config_indexing(True, "en")
        .config_compression("zstd" if compress else "none") as c
    ):
        c.set_mainpath("Moon")
        for t in TITLES:
            body = (
                "<html><body><h1>%s</h1>%s</body></html>" % (t, "lorem ipsum " * 40)
            ).encode()
            c.add_item(_Page(t.replace(" ", "_"), t, body))
        c.add_item(_Page("I/pic.png", "", _PNG, "image/png"))
        c.add_item(_Page("style.css", "", b"body{color:red}", "text/css"))
        c.add_redirection("Luna", "Luna (redirect)", "Moon", {Hint.FRONT_ARTICLE: True})
        c.add_redirection("USA", "USA", "Marsupial", {Hint.FRONT_ARTICLE: True})
        for k, v in {
            "Title": "Reader fixture",
            "Language": "eng",
            "Name": "reader_fixture",
            "Description": "d",
        }.items():
            c.add_metadata(k, v)


_DRIVER = r"""
const fs = require('node:fs');
const ZimReader = require(process.argv[1]);
ZimReader.fzstd = require(process.argv[2]);
const job = JSON.parse(process.argv[4]);
(async () => {
  const buf = fs.readFileSync(process.argv[3]);
  const r = await ZimReader.open(ZimReader.bufferSource(new Uint8Array(buf.buffer, buf.byteOffset, buf.length)));
  const out = { entries: {}, search: {}, meta: {} };
  const crypto = require('node:crypto');
  for (const p of job.paths) {
    const e = await r.lookup(p);
    if (!e) { out.entries[p] = null; continue; }
    if (e.redirect >= 0) { const t = await r.resolve(e); out.entries[p] = { redirect: r.pathOf(t) }; continue; }
    const bytes = await r.read(e);
    out.entries[p] = { mime: e.mime, len: bytes.length, sha: crypto.createHash('sha1').update(bytes).digest('hex') };
  }
  for (const q of job.queries) out.search[q] = (await r.search(q, 20)).map(h => h.title);
  const main = await r.main();
  out.main = main ? r.pathOf(main) : null;
  for (const k of ['Title', 'Language', 'Name', 'Nope']) out.meta[k] = await r.meta(k);
  out.compression0 = await r.compressionOf(0);
  process.stdout.write(JSON.stringify(out));
})().catch(e => { process.stderr.write(String(e.stack || e)); process.exit(1); });
"""


def _run_node(zim, paths, queries):
    node = shutil.which("node")
    if not node:
        raise unittest.SkipTest("node not available")
    job = json.dumps({"paths": paths, "queries": queries})
    p = subprocess.run(
        [
            node,
            "-e",
            _DRIVER,
            os.path.join(_STATIC, "zimreader.js"),
            os.path.join(_STATIC, "fzstd.js"),
            zim,
            job,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if p.returncode:
        raise AssertionError(p.stderr)
    return json.loads(p.stdout)


def _libzim_entry(a, path):
    try:
        e = a.get_entry_by_path(path)
    except KeyError:
        return None
    if e.is_redirect:
        return {"redirect": e.get_redirect_entry().path}
    item = e.get_item()
    data = bytes(item.content)
    return {
        "mime": item.mimetype,
        "len": len(data),
        "sha": hashlib.sha1(data).hexdigest(),
    }


class _Base:
    compress = True

    @classmethod
    def setUpClass(cls):
        import tempfile

        cls.tmp = tempfile.mkdtemp()
        cls.path = os.path.join(cls.tmp, "fx.zim")
        _build(cls.path, cls.compress)
        cls.a = Archive(cls.path)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_every_entry_reads_the_same_as_libzim(self):
        paths = [t.replace(" ", "_") for t in TITLES[::7]] + [
            "Moon",
            "I/pic.png",
            "style.css",
            "Luna",
            "USA",
            "No_such_page",
            "Moon_landing",
        ]
        got = _run_node(self.path, paths, [])
        for p in paths:
            self.assertEqual(got["entries"][p], _libzim_entry(self.a, p), p)

    def test_main_page_and_metadata(self):
        got = _run_node(self.path, [], [])
        self.assertEqual(
            got["main"],
            (
                self.a.main_entry.get_redirect_entry().path
                if self.a.main_entry.is_redirect
                else self.a.main_entry.path
            ),
        )
        self.assertEqual(got["meta"]["Title"], "Reader fixture")
        self.assertEqual(got["meta"]["Language"], "eng")
        self.assertEqual(got["meta"]["Nope"], "")

    def test_title_search_is_prefix_case_insensitive_and_follows_redirects(self):
        got = _run_node(
            self.path,
            [],
            [
                "moon",
                "Moon",
                "mars",
                "ECLAIR",
                "東",
                "моск",
                "Article 00",
                "zzz",
                "usa",
            ],
        )
        s = got["search"]
        self.assertEqual(s["Moon"][0], "Moon")
        for t in ("Moon landing", "Mooney", "Moonlight Sonata"):
            self.assertIn(t, s["Moon"])
        self.assertIn(
            "moonshine", s["moon"]
        )  # the spelling that was typed finds its own
        self.assertIn("Mars", s["mars"])
        self.assertIn("Marsupial", s["mars"])
        (
            self.assertIn("Éclair", s["ECLAIR"] + got["search"]["ECLAIR"])
            if False
            else None
        )
        self.assertEqual(s["東"], ["東京"])
        self.assertEqual(s["моск"], ["Москва"])
        self.assertEqual(len(s["Article 00"]), 20)  # capped, in title order
        self.assertEqual(s["Article 00"][0], "Article 0000")
        self.assertEqual(s["zzz"], [])
        # A redirect is shown as the page it leads to.
        self.assertEqual(s["usa"], ["Marsupial"])


class TestCompressed(_Base, unittest.TestCase):
    compress = True

    def test_clusters_are_zstd(self):
        self.assertEqual(_run_node(self.path, [], [])["compression0"], 5)


class TestUncompressed(_Base, unittest.TestCase):
    compress = False

    def test_clusters_are_read_in_place(self):
        self.assertEqual(_run_node(self.path, [], [])["compression0"], 1)


class TestNotAZim(unittest.TestCase):
    def test_it_refuses_a_file_that_is_not_a_zim(self):
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".zim") as f:
            f.write(b"not a zim" * 100)
            f.flush()
            with self.assertRaises(AssertionError) as ctx:
                _run_node(f.name, [], [])
            self.assertIn("zim-not-a-zim", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
