"""The service worker reads a kept document library's listing (database.js, a
Python literal) the way the server does: for every listing shape the
fixtures hold, sw.js's parsePyLiteral gives what zimi.nautilus.parse gives.

Run: pytest tests/test_sw_listing_parse.py
"""

import json
import os
import shutil
import subprocess
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
sys.path.insert(0, _HERE)

import books_sources_fixture as fx  # noqa: E402
from zimi import nautilus  # noqa: E402

_SW = os.path.join(_HERE, "..", "zimi", "static", "sw.js")

_NODE = """
global.self = { addEventListener() {} };
global.importScripts = () => {};
eval(require('fs').readFileSync(process.argv[1], 'utf8'));
const text = require('fs').readFileSync(0, 'utf8');
const s = text.indexOf('['), e = text.lastIndexOf(']');
process.stdout.write(JSON.stringify(self.parsePyLiteral(text.slice(s, e + 1))));
"""

LISTINGS = {
    "zimgit (single quotes)": fx.WATER_DATABASE,
    "prunelle (double quotes, escaped quote, curly quotes)": fx.PRUNELLE_DATABASE,
    "python-class (CJK)": fx.PYTHON_CLASS_DATABASE,
    "escapes": "var DATABASE = [{'ti': 'It\\'s \\xe9\\u00e8 \\\\ a\\tb', 'n': 3, 'x': None, 'ok': True, 'fp': ('a.pdf',)},];",
}


@pytest.mark.skipif(not shutil.which("node"), reason="node is not installed")
@pytest.mark.parametrize("label", list(LISTINGS))
def test_service_worker_reads_a_listing_as_the_server_does(label):
    text = LISTINGS[label]
    out = subprocess.run(
        ["node", "-e", _NODE, _SW], input=text, capture_output=True, text=True, timeout=30
    )
    assert out.returncode == 0, out.stderr
    want = json.loads(json.dumps(nautilus.parse(text)))
    assert want, "the fixture parses on the server"
    assert json.loads(out.stdout) == want
