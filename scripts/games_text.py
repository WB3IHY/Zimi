#!/usr/bin/env python3
"""Writes ZimiGames' English strings into text.js from text/en.json, so the file is the one source and the
page has its strings before the first paint.

    python3 scripts/games_text.py           rewrite the block in text.js
    python3 scripts/games_text.py --check   exit 1 if text.js is not what text/en.json says
"""

import json
import os
import re
import sys

GAMES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "zimi", "builtin", "games")
JSON_PATH = os.path.join(GAMES, "text", "en.json")
JS_PATH = os.path.join(GAMES, "text.js")
_BLOCK = re.compile(r"/\* en:begin \*/.*?/\* en:end \*/", re.S)


def block():
    with open(JSON_PATH, encoding="utf-8") as f:
        table = json.load(f)
    body = json.dumps(table, ensure_ascii=False, indent=1, sort_keys=True)
    return "/* en:begin */" + body + "/* en:end */"


def main():
    with open(JS_PATH, encoding="utf-8") as f:
        text = f.read()
    new = _BLOCK.sub(lambda m: block(), text, count=1)
    if "--check" in sys.argv:
        if new != text:
            print("text.js is out of date: run scripts/games_text.py")
            raise SystemExit(1)
        print("text.js is current")
        return
    if new != text:
        with open(JS_PATH, "w", encoding="utf-8", newline="\n") as f:
            f.write(new)
    print("text.js written")


if __name__ == "__main__":
    main()
