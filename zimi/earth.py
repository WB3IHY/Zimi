"""Zimi Earth: the library's places on a globe.

A Wikipedia or Wikivoyage article about a place says where it is, in its own
head: English Wikipedia's mwoffliner build writes
``<meta name="geo.position" content="48.8567;2.3522"/>``, and the other
languages' builds and Wikivoyage keep the place's ``geo:48.85,2.35`` link.
Nothing in a ZIM lists them, so each wiki is read once, in the background and
in a child process (details.py), into a file of its own beside the ZIM:
``<data dir>/places/<name>.db``, one row per article that has a place.
Asking the globe for the places in a box is then one indexed read of that
file, and nothing on the way to a page waits for a ZIM to be read.

A row is ``path, title, lat, lon, size``; the article's size in bytes stands
for how much the library has to say about it, which orders places when a view
holds more than it can label (Paris before a street in Paris).
"""

import logging
import math
import re
import sqlite3
import threading

from zimi import server as _srv
from zimi.details import DetailsBuilder

log = logging.getLogger("zimi")

# The head of an article is searched, not all of it: mwoffliner puts the
# page's meta tags before the body, but a long article's head can carry tens
# of kilobytes of styles (Mount Everest's is 58 KB) before the meta line.
HEAD_BYTES = 160_000
_META_RE = re.compile(
    rb'<meta[^>]*name="geo\.position"[^>]*content="\s*(-?[0-9.]+)\s*;\s*(-?[0-9.]+)\s*"'
    rb'|<meta[^>]*content="\s*(-?[0-9.]+)\s*;\s*(-?[0-9.]+)\s*"[^>]*name="geo\.position"'
)
_LINK_RE = re.compile(rb'href="geo:(-?[0-9.]+),(-?[0-9.]+)')
WIKI_PROJECTS = ("wikipedia", "wikivoyage")

# The most places one answer carries, and the nearest-article reach.
MAX_PLACES = 400
NEAR_KM = 40  # a Wikipedia article this close to a tapped point is "there"
GUIDE_KM = 250  # a Wikivoyage destination this close is the guide to read
EARTH_KM = 6371.0
# A view this share of the globe or smaller reads the file by latitude (the
# box is small, its rows few); a wider one reads by size and stops early.
_SMALL_BOX_SHARE = 0.02


def parse_geo(data):
    """(lat, lon) of the place an article's head names, or None.

    ``data`` is the article's bytes. The meta line wins; the first geo: link
    stands in for builds without it. Zeros and out-of-range pairs are
    nobody's place."""
    head = data[:HEAD_BYTES]
    m = _META_RE.search(head)
    if m:
        pair = m.group(1) or m.group(3), m.group(2) or m.group(4)
    else:
        m = _LINK_RE.search(head)
        if not m:
            return None
        pair = m.group(1), m.group(2)
    try:
        lat, lon = float(pair[0]), float(pair[1])
    except ValueError:
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
        return None
    return lat, lon


def _is_geo_wiki(z):
    return z.get("kind") == "wiki" and z.get("project") in WIKI_PROJECTS


def build_places(zim_name, zim_path):
    """Read every article's place into the ZIM's file. Opens an archive of
    its own, never the pool's; runs in a child process."""
    archive = _srv.open_archive(zim_path)
    rows = []
    for i in range(archive.entry_count):
        entry = archive._get_entry_by_id(i)
        if entry.is_redirect:
            continue
        item = entry.get_item()
        if item.mimetype != "text/html":
            continue
        data = bytes(item.content)
        got = parse_geo(data)
        if got:
            rows.append((entry.path, entry.title, got[0], got[1], len(data)))
    return _builder.write(zim_name, zim_path, archive, rows)


class _PlacesBuilder(DetailsBuilder):
    """A file of places can hold millions of rows; what the app keeps is how
    many, and the file is read per request."""

    def write(self, zim_name, zim_path, archive, rows):
        n = super().write(zim_name, zim_path, archive, rows)
        conn = sqlite3.connect(self.path(zim_name))
        try:
            conn.execute("CREATE INDEX places_size ON places (size DESC)")
            conn.execute("CREATE INDEX places_lat ON places (lat)")
            conn.commit()
        finally:
            conn.close()
        return n

    def read(self, name):
        conn = sqlite3.connect(self.path(name), timeout=5)
        try:
            return conn.execute("SELECT COUNT(*) FROM places").fetchall()
        finally:
            conn.close()


_lock = threading.Lock()
_counts = {}


def _kept(name, _key, count):
    _counts[name] = count


_builder = _PlacesBuilder(
    "places",
    zims=_is_geo_wiki,
    label="Zimi Earth",
    what="places",
    version="1",
    table="places",
    columns=(
        "path TEXT PRIMARY KEY",
        "title TEXT",
        "lat REAL",
        "lon REAL",
        "size INTEGER",
    ),
    # Looked up when it runs, as the child process looks it up.
    build=lambda name, path: build_places(name, path),
    load=lambda rows: rows[0][0] if rows else 0,
    lock=_lock,
    on_keep=_kept,
)
request_places = _builder.request
build_all_places = _builder.build_all


def place_count(name):
    """How many places ``name``'s file holds; None until it is read."""
    return _counts.get(name)


def _wikis():
    """The geo-bearing wikis in the library: (name, zim list entry) with a
    file that has been read."""
    return [
        z
        for z in list(_srv._zim_list_cache or [])
        if _is_geo_wiki(z) and _counts.get(z.get("name"))
    ]


# ── asking ─────────────────────────────────────────────────────────────────


def km_between(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (
        math.sin((p2 - p1) / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_KM * math.asin(min(1.0, math.sqrt(a)))


def _lon_ranges(west, east):
    """The longitude spans a box covers: two when it crosses the antimeridian."""
    if west <= east:
        return [(west, east)]
    return [(west, 180.0), (-180.0, east)]


def _box_share(west, south, east, north):
    width = east - west if east >= west else east + 360 - west
    return max(0.0, (north - south) * width) / (180 * 360)


def _query_box(name, west, south, east, north, limit):
    spans = _lon_ranges(west, east)
    index = (
        "places_lat"
        if _box_share(west, south, east, north) < _SMALL_BOX_SHARE
        else "places_size"
    )
    lon_sql = " OR ".join("(lon BETWEEN ? AND ?)" for _ in spans)
    args = [south, north]
    for span in spans:
        args.extend(span)
    conn = sqlite3.connect(_builder.path(name), timeout=5)
    try:
        return conn.execute(
            f"SELECT path, title, lat, lon, size FROM places INDEXED BY {index} "
            f"WHERE lat BETWEEN ? AND ? AND ({lon_sql}) "
            f"ORDER BY size DESC LIMIT {int(limit)}",
            args,
        ).fetchall()
    finally:
        conn.close()


def thin(places, min_km):
    """Keep the biggest place in each neighbourhood: a place within
    ``min_km`` of a bigger one that is kept is the same dot on the globe.
    ``places`` is ordered biggest first."""
    kept = []
    for p in places:
        if all(
            km_between(p["lat"], p["lon"], k["lat"], k["lon"]) >= min_km for k in kept
        ):
            kept.append(p)
    return kept


def _row(z, r):
    return {
        "zim": z["name"],
        "project": z.get("project") or "",
        "path": r[0],
        "title": r[1],
        "lat": r[2],
        "lon": r[3],
        "size": r[4],
    }


def places_in(west, south, east, north, limit=60, project="wikipedia"):
    """The places a view holds, biggest first, one dot to a neighbourhood
    (as wide as a twentieth of the view): from every Wikipedia in the
    library for the globe, or from Wikivoyage. [] when nothing has been read
    yet."""
    limit = max(1, min(int(limit), MAX_PLACES))
    pool = []
    for z in _wikis():
        if z.get("project") != project:
            continue
        try:
            pool.extend(
                _row(z, r)
                for r in _query_box(z["name"], west, south, east, north, limit * 3)
            )
        except sqlite3.Error as e:
            log.warning("Zimi Earth: %s could not be read: %s", z["name"], e)
    pool.sort(key=lambda p: -p["size"])
    width = east - west if east >= west else east + 360 - west
    min_km = km_between(south, west, south, west + width / 20) if width > 0 else 0
    return thin(pool, min_km)[:limit]


def near(lat, lon):
    """What the library has for a point: the nearest Wikipedia article within
    NEAR_KM per language, and the Wikivoyage guides within GUIDE_KM, each
    with its language and distance. The guides are the local language's
    where the library has that Wikivoyage."""
    out = {"articles": [], "guides": []}
    dlat = GUIDE_KM / 111.0
    dlon = min(180.0, GUIDE_KM / (111.0 * max(0.05, math.cos(math.radians(lat)))))
    west, east = lon - dlon, lon + dlon
    if west < -180:
        west += 360
    if east > 180:
        east -= 360
    for z in _wikis():
        try:
            rows = _query_box(
                z["name"], west, max(-90, lat - dlat), east, min(90, lat + dlat), 2000
            )
        except sqlite3.Error:
            continue
        best = None
        for r in rows:
            km = km_between(lat, lon, r[2], r[3])
            if best is None or km < best[0]:
                best = (km, r)
        if best is None:
            continue
        item = dict(
            _row(z, best[1]), km=round(best[0], 1), language=z.get("language") or ""
        )
        if z["project"] == "wikipedia" and best[0] <= NEAR_KM:
            out["articles"].append(item)
        elif z["project"] == "wikivoyage":
            out["guides"].append(item)
    out["articles"].sort(key=lambda a: a["km"])
    out["guides"].sort(key=lambda a: a["km"])
    return out


def has_places():
    """Whether any place has been read: the globe can show articles."""
    return bool(_wikis())


def _reset_for_tests():
    _counts.clear()
    _builder.forget()
