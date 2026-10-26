"""ZimiGames' strings: text.js is what text/en.json says, and every string id a game file asks for exists.

Run: ZIMI_TORRENT=0 ZIMI_OFFLINE=1 python3 -m pytest tests/test_games_text.py -q
"""

import json
import os
import re
import subprocess
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
GAMES = os.path.join(ROOT, "zimi", "builtin", "games")

# Files that draw strings through T(): the shared ones.
SHARED = ["shell.js", "cards.js", "cardtable.js", "shelf.js", "recent.js", "boardkit.js", "gamepad.js"]
_KEY = re.compile(r"""\bT\(\s*['"]([a-z][A-Za-z0-9_.]*)['"]""")


def table():
    with open(os.path.join(GAMES, "text", "en.json"), encoding="utf-8") as f:
        return json.load(f)


def test_text_js_is_current():
    out = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "games_text.py"), "--check"], capture_output=True, text=True)
    assert out.returncode == 0, out.stdout + out.stderr


def test_every_string_id_exists():
    have, missing = table(), []
    for name in SHARED:
        path = os.path.join(GAMES, name)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            for key in _KEY.findall(f.read()):
                # A key ending in a dot is a prefix a dynamic id is built from (cards.rank. + 12): its members are checked by the tests that build them.
                if not key.endswith(".") and key not in have:
                    missing.append(name + ": " + key)
    assert not missing, "string ids with no English text: " + ", ".join(sorted(set(missing)))


def test_plurals_have_one_and_other():
    for key, value in table().items():
        if isinstance(value, dict):
            assert "other" in value, key + " needs an 'other' form"
