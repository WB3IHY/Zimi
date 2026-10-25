"""ZimiGames and the encyclopedia, linked both ways.

The games' Wikidata Q-IDs live in the ZIM's source (builtin/games/games.json:
Q-ID, the game's page, its English article title). Which installed Wikipedia
article carries each Q-ID is worked out in the background whenever the library
changes (``refresh_async``), from what Zimi already keeps: the per-ZIM Q-ID
index and the passive Q-ID cache, both plain SQLite reads, and for an English
ZIM with neither an exact-title probe. Nothing is built for this: a ZIM with no
Q-ID index only gets the links its cache holds (plus the English title probe).

``links()`` hands that answer to ``GET /games-links``, which the reader asks
for the first time a wiki article opens (never on page load). The reader then
checks its article's path in memory: a hit shows Play; the games' "About" link
(about.html?qid=) opens the article for the reader's language.
"""

import json
import logging
import os
import threading

import zimi.server as _srv
from zimi import ownzims
from zimi.interlang import (
    _ALMANAC_ENC_RE,
    _almanac_title_entry_path,
    _qid_find_in_zim,
)

log = logging.getLogger("zimi")

_GAMES_ZIM = "zimi_games"
_lock = threading.Lock()
_rows = None  # games.json, read once
_memo = {"token": None, "articles": {}}
_building = threading.Lock()
_dirty = threading.Event()


def rows():
    """games.json: [{qid, wiki, path, title, blurb}]."""
    global _rows
    if _rows is None:
        path = os.path.join(ownzims.SOURCE_ROOT, "games", "games.json")
        try:
            with open(path, encoding="utf-8") as f:
                _rows = json.load(f)
        except (OSError, ValueError) as e:
            log.warning("games.json unreadable: %s", e)
            _rows = []
    return _rows


def _wiki_zims():
    return [
        z
        for z in (_srv._zim_list_cache or [])
        if _ALMANAC_ENC_RE.match(z.get("name", ""))
    ]


def build():
    """{qid: [{zim, lang, path}]} over every installed encyclopedia ZIM."""
    games = rows()
    zims = _wiki_zims()
    articles = {}
    probe = []  # (zim, row) an English ZIM's index did not answer
    for z in zims:
        name, lang = z.get("name", ""), z.get("language", "")
        for r in games:
            path = _qid_find_in_zim(name, int(r["qid"][1:]))
            if path:
                articles.setdefault(r["qid"], []).append(
                    {"zim": name, "lang": lang, "path": path}
                )
            elif lang == "en" and r.get("wiki"):
                probe.append((name, r))
    if probe:
        with _srv._zim_lock:  # libzim: one hold for a few dozen memory-mapped probes
            for name, r in probe:
                path = _almanac_title_entry_path(name, r["wiki"])
                if path:
                    articles.setdefault(r["qid"], []).append(
                        {"zim": name, "lang": "en", "path": path}
                    )
    return articles


def _refresh():
    """Work the answer out now (callers are background threads, or the first
    request after a library change). A call during a pass asks it to go round
    again, so no change is lost."""
    _dirty.set()
    if not _building.acquire(blocking=False):
        return
    try:
        while _dirty.is_set():
            _dirty.clear()
            token = _srv._listing_seen
            try:
                articles = build()
            except Exception as e:
                log.warning("games links not built: %s", e)
                break
            with _lock:
                _memo["token"], _memo["articles"] = token, articles
    finally:
        _building.release()


def qids_changed(qid=None):
    """The Q-ID answers moved (an index was built, or a viewed article's Q-ID
    was learned): rework the links, unless that Q-ID is no game's."""
    if qid is None or any(r["qid"] == "Q%d" % qid for r in rows()):
        _refresh()


def refresh_async():
    """Rework the answer in the background (the library changed)."""
    threading.Thread(target=_refresh, name="games-links", daemon=True).start()


def links():
    """The data GET /games-links serves: {games: {qid: {zim, path, title}},
    articles: {qid: [{zim, lang, path}]}}, for what this request may see."""
    if not ownzims.enabled() or not any(
        z.get("name") == _GAMES_ZIM for z in _srv._zim_list_cache or []
    ):
        return {"games": {}, "articles": {}}
    with _lock:
        fresh = _memo["token"] is _srv._listing_seen
        articles = _memo["articles"]
    if not fresh:
        _refresh()
        with _lock:
            articles = _memo["articles"]
    games = {
        r["qid"]: {"zim": _GAMES_ZIM, "path": r["path"], "title": r["title"]}
        for r in rows()
        if _srv.zim_allowed(_GAMES_ZIM)
    }
    shown = {
        q: [a for a in found if _srv.zim_allowed(a["zim"])]
        for q, found in articles.items()
    }
    return {"games": games, "articles": {q: a for q, a in shown.items() if a}}
