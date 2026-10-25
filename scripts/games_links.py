#!/usr/bin/env python3
"""Writes ZimiGames' "About" links from zimi/builtin/games/games.json, so no
page is edited by hand and none can drift from the Q-ID list.

    python3 scripts/games_links.py          rewrite the pages in place

Each game page gets one footer link, ``about.html?qid=Q718``, between two
markers (rewritten, never doubled). ``about.html`` is a plain page that says
what the game is and links to play it, so the link is never dead in Kiwix;
Zimi's reader catches the same link and opens the encyclopedia article in the
reader's language instead (app.js, _gamesAbout).
"""

import html
import json
import os
import re

GAMES = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "zimi", "builtin", "games"
)
OPEN, CLOSE = "<!-- zimi-about -->", "<!-- /zimi-about -->"
_BLOCK = re.compile(re.escape(OPEN) + r".*?" + re.escape(CLOSE) + r"\n?", re.S)


def load():
    with open(os.path.join(GAMES, "games.json"), encoding="utf-8") as f:
        return json.load(f)


def primary_by_path(rows):
    """The first entry of each page: the article its About link stands for."""
    out = {}
    for r in rows:
        out.setdefault(r["path"], r)
    return out


def footer(row):
    up = "../" * row["path"].count("/")
    return (
        f'{OPEN}<footer class="gm-about"><a href="{up}about.html?qid={row["qid"]}">'
        f'About {html.escape(row["title"])}</a></footer>{CLOSE}\n'
    )


def stamp(path, row):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    text = _BLOCK.sub("", text)
    if "</body>" not in text:
        raise SystemExit(f"{path}: no </body>")
    text = text.replace("</body>", footer(row) + "</body>", 1)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


ABOUT = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>About - ZimiGames</title>
<link rel="stylesheet" href="games.css">
</head>
<body>
<header class="ar-bar">
  <a class="ar-back" href="index.html" aria-label="Back to ZimiGames">&lsaquo;</a>
  <h1 id="ab-title">About</h1>
</header>
<main class="gm-about-page">
  <p id="ab-blurb"></p>
  <p><a class="ar-btn gm-play" id="ab-play" href="index.html">Play</a></p>
</main>
<script>
(function () {
  var games = %s;
  // Zimi's reader opens this page as about.html#qid=Q718 (a ZIM path takes no query).
  var q = new URLSearchParams(location.search).get('qid') || (location.hash.match(/Q\\d+/) || [])[0];
  var g = games[q];
  if (!g) return;
  document.title = 'About ' + g.title + ' - ZimiGames';
  document.getElementById('ab-title').textContent = g.title;
  document.getElementById('ab-blurb').textContent = g.blurb;
  var play = document.getElementById('ab-play');
  play.href = g.path;
  play.textContent = 'Play ' + g.title;
})();
</script>
</body>
</html>
"""


def write_about(rows):
    table = {
        r["qid"]: {"path": r["path"], "title": r["title"], "blurb": r["blurb"]}
        for r in rows
    }
    body = json.dumps(table, ensure_ascii=False, separators=(",", ":")).replace(
        "</", "<\\/"
    )
    with open(
        os.path.join(GAMES, "about.html"), "w", encoding="utf-8", newline="\n"
    ) as f:
        f.write(ABOUT % body)


def main():
    rows = load()
    for path, row in primary_by_path(rows).items():
        stamp(os.path.join(GAMES, path), row)
    write_about(rows)
    print(f"{len(primary_by_path(rows))} pages stamped, about.html written")


if __name__ == "__main__":
    main()
