"""Zimi Earth: the library's places on a globe.

A Wikipedia or Wikivoyage article about a place says where it is, in its own
head: English Wikipedia's mwoffliner build writes
``<meta name="geo.position" content="48.8567;2.3522"/>``, and the other
languages' builds and Wikivoyage keep the place's ``geo:48.85,2.35`` link.
Nothing in a ZIM lists them, so each wiki is read once, in the background and
in a child process, into a file of its own beside the others:
``<data dir>/places/<name>.db``, one row per article that has a place.
Asking the globe for the places in a box is then one indexed read of that
file, and nothing on the way to a page waits for a ZIM to be read.

Reading a whole Wikipedia takes hours, so it is done politely:

* **When.** Only once Earth has been opened (remembered in the data dir, so a
  server whose people never open it never reads a thing), only where the
  server offers Earth, and after everything else the startup does. A ZIM
  downloaded later is read when it lands.
* **Order.** Wikivoyage first (small, and the most use per byte), then the
  smaller wikis, then the big Wikipedias.
* **How.** At the lowest CPU and disk priority, in a child process, in
  batches of a few thousand rows. A page that cannot be read is skipped, not
  fatal. The last entry read is kept with the rows, so a read that is killed
  (a restart, a power cut) takes up where it stopped, never from the start.
  Nothing holds more than a batch in memory.
* **Honesty.** While a wiki is being read the page says so, with how far along
  it is. A desktop build that cannot start a child process skips the wikis
  that would stall search, and says which.

A row is ``path, title, lat, lon, size``; the article's size in bytes stands
for how much the library has to say about it, which orders places when a view
holds more than it can label (Paris before a street in Paris).
"""

import logging
import math
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import threading

from zimi import server as _srv

log = logging.getLogger("zimi")

# The head of an article is searched, not all of it: mwoffliner puts the
# page's meta tags before the body, but a long article's head can carry tens
# of kilobytes of styles (Mount Everest's is 58 KB) before the meta line.
HEAD_BYTES = 400_000
_META_RE = re.compile(
    rb'<meta[^>]*name="geo\.position"[^>]*content="\s*(-?[0-9.]+)\s*;\s*(-?[0-9.]+)\s*"'
    rb'|<meta[^>]*content="\s*(-?[0-9.]+)\s*;\s*(-?[0-9.]+)\s*"[^>]*name="geo\.position"'
)
_LINK_RE = re.compile(rb'href="geo:(-?[0-9.]+),(-?[0-9.]+)')
# The hidden decimal an infobox keeps in builds that strip the rest
# (wikipedia_tr_geography: 42 of 5,325 pages).
_SPAN_RE = re.compile(rb'<span class="geo">\s*(-?[0-9.]+)\s*;\s*(-?[0-9.]+)\s*</span>')
WIKI_PROJECTS = ("wikipedia", "wikivoyage")

VERSION = "2"
BATCH = 2000  # rows written (and the read checkpointed) this often
PROGRESS_EVERY = 4000  # entries between checkpoints when few of them are places
ISOLATE_MIN_ENTRIES = 5_000  # a wiki this big is read in a child process
FROZEN_MAX_ENTRIES = 50_000  # in a build that cannot start one: ~4 minutes of stall
NICE_LEVEL = 19
IONICE_CLASS = "-c3"  # idle: the disk is ours only when nobody else wants it

# The most places one answer carries, and how far a touched point looks.
MAX_PLACES = 400
NEAR_KM = 40  # a Wikipedia article this close to a tapped point is "there"
GUIDE_KM = 250  # a Wikivoyage destination this close is the guide to read
NEAR_ROWS_MAX = (
    50_000  # a safety cap on a box read for its nearest, never reached in practice
)
EARTH_KM = 6371.0
# A box this share of the globe or wider is read in size order from the top and
# stops at its limit (most of what it holds qualifies); a narrower one goes
# through the spatial index and sorts what it holds.
WIDE_SHARE = 0.25
# From this share of the globe (a country) up to the wide ones, the biggest places
# are read from an R*Tree of their own: TOP_SHARE of all the places.
TOP_FROM_SHARE = 0.005
TOP_SHARE = 0.03

_build_lock = threading.Lock()
_state_lock = threading.Lock()
_building = set()
_skipped = set()


# ── reading a page ─────────────────────────────────────────────────────────


def parse_geo(data):
    """(lat, lon) of the place an article's head names, or None.

    ``data`` is the article's bytes. The meta line wins; the first geo: link,
    then an infobox's hidden decimal, stand in for builds without it. Zeros
    and out-of-range pairs are nobody's place."""
    head = data[:HEAD_BYTES]
    m = _META_RE.search(head)
    if m:
        pair = m.group(1) or m.group(3), m.group(2) or m.group(4)
    else:
        m = _LINK_RE.search(head) or _SPAN_RE.search(head)
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


# ── where things are kept, and whether anyone wants them ───────────────────


def _dir():
    return os.path.join(_srv.ZIMI_DATA_DIR, "places")


def db_path(name):
    return os.path.join(_dir(), f"{name}.db")


def _wanted_path():
    return os.path.join(_dir(), ".wanted")


def wanted():
    """Whether Earth has ever been opened on this server."""
    return os.path.exists(_wanted_path())


def want_marker():
    os.makedirs(_dir(), exist_ok=True)
    with open(_wanted_path(), "w") as f:
        f.write("1\n")


def want():
    """Earth was opened. The first time, remember it and begin reading; the
    page then says how far along each wiki is."""
    if wanted():
        return
    want_marker()
    threading.Thread(target=maybe_build_all, name="earth-places", daemon=True).start()


def _offered():
    try:
        return "earth" in _srv.apps_shown()
    except Exception:
        return False


def maybe_build_all():
    """Read every wiki's places, if Earth is wanted here and offered here."""
    if wanted() and _offered():
        build_all()


def request_places(name):
    """A ZIM arrived (a download finished): read it now, in the background,
    if Earth is wanted and offered; it does not wait for a restart."""
    if wanted() and _offered():
        threading.Thread(
            target=build_one, args=(name,), name="earth-places", daemon=True
        ).start()


def _geo_wikis():
    return [
        z for z in list(_srv._zim_list_cache or []) if _is_geo_wiki(z) and z.get("name")
    ]


def build_all():
    """Every wiki that has places, one after another: Wikivoyage first, then
    the smaller wikis, then the big Wikipedias."""
    for z in sorted(
        _geo_wikis(),
        key=lambda z: (z.get("project") != "wikivoyage", z.get("entries") or 0),
    ):
        build_one(z["name"])


def _is_current(name, path):
    from zimi.search import _index_is_current

    return _index_is_current(db_path(name), path, VERSION)


def build_one(name):
    """Bring ``name``'s file up to date. One at a time; a read that fails is
    left as far as it got (the next try resumes it)."""
    from zimi.search import _build_index_isolated

    with _build_lock:
        path = _srv.get_zim_files().get(name)
        z = next((z for z in _geo_wikis() if z["name"] == name), None)
        if not path or z is None:
            return
        if _is_current(name, path):
            return
        # A build with no child process to hand it to would stall search for
        # the length of the read: it reads the small wikis and says which it
        # left out.
        if (
            getattr(sys, "frozen", False)
            and (z.get("entries") or 0) > FROZEN_MAX_ENTRIES
        ):
            with _state_lock:
                _skipped.add(name)
            return
        with _state_lock:
            _skipped.discard(name)
            _building.add(name)
        try:
            _build_index_isolated(
                "places",
                name,
                path,
                scan,
                lambda _n: None,
                min_entries=ISOLATE_MIN_ENTRIES,
            )
            log.info("Zimi Earth: read the places of %s", name)
        except Exception as e:
            log.warning("Zimi Earth: reading the places of %s stopped: %s", name, e)
        finally:
            with _state_lock:
                _building.discard(name)


def lower_priority():
    """The child's: the lowest CPU priority and, where there is ionice, the
    idle disk class, so a read that takes hours is never what anyone waits on."""
    try:
        os.nice(NICE_LEVEL)
    except (AttributeError, OSError):
        pass
    ionice = shutil.which("ionice")
    if ionice:
        try:
            subprocess.run(
                [ionice, IONICE_CLASS, "-p", str(os.getpid())],
                check=False,
                timeout=5,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except (OSError, subprocess.SubprocessError):
            pass


# ── the read ───────────────────────────────────────────────────────────────


def _connect(path):
    return sqlite3.connect(path, timeout=30)


def _create_indexes(conn):
    """What asking needs, made once the rows are all there: the size order
    (the whole globe), the latitude (a fallback), and two R*Trees (a place is
    a point in one): every place, for a view narrow enough that it holds few,
    and the biggest few in a hundred, for a view wide enough that sorting
    everything in it would be the cost."""
    conn.execute("CREATE INDEX IF NOT EXISTS places_size ON places (size DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS places_lat ON places (lat)")
    try:
        for table in ("places_rt", "places_top"):
            conn.execute(
                f"CREATE VIRTUAL TABLE IF NOT EXISTS {table} USING rtree(id, min_lat, max_lat, min_lon, max_lon)"
            )
        conn.execute("INSERT OR REPLACE INTO places_rt SELECT rowid, lat, lat, lon, lon FROM places")
        n = conn.execute("SELECT COUNT(*) FROM places").fetchone()[0]
        cut = conn.execute(
            "SELECT size FROM places ORDER BY size DESC LIMIT 1 OFFSET ?",
            (int(n * TOP_SHARE),),
        ).fetchone()
        floor = cut[0] if cut else 0
        conn.execute(
            "INSERT OR REPLACE INTO places_top SELECT rowid, lat, lat, lon, lon FROM places WHERE size > ?",
            (floor,),
        )
    except sqlite3.OperationalError as e:  # SQLite built without R*Tree
        log.info("Zimi Earth: no R*Tree here (%s); the latitude index serves", e)


def _open_scan(tmp, key, total):
    """The unfinished file for this ZIM, to carry on from, or a new one."""
    if os.path.exists(tmp):
        conn = _connect(tmp)
        try:
            row = conn.execute("SELECT value FROM progress WHERE key='zim'").fetchone()
            last = conn.execute(
                "SELECT value FROM progress WHERE key='last_id'"
            ).fetchone()
            if row and row[0] == key and last:
                return conn, int(last[0]) + 1
        except sqlite3.Error:
            pass
        conn.close()
        os.remove(tmp)
    conn = _connect(tmp)
    conn.execute(
        "CREATE TABLE places (path TEXT PRIMARY KEY, title TEXT, lat REAL, lon REAL, size INTEGER)"
    )
    conn.execute("CREATE TABLE progress (key TEXT PRIMARY KEY, value TEXT)")
    conn.executemany(
        "INSERT INTO progress VALUES (?, ?)",
        [("zim", key), ("last_id", "-1"), ("total", str(total))],
    )
    conn.commit()
    return conn, 0


def scan(zim_name, zim_path):
    """Read every article's place into ``<name>.db``. Opens an archive of its
    own, never the pool's; runs in a child process for a big ZIM. Rows go in
    in batches, each committed with the number of the last entry read, so a
    read that dies is taken up again, not begun again."""
    from zimi.search import _write_index_meta

    archive = _srv.open_archive(zim_path)
    total = archive.all_entry_count
    os.makedirs(_dir(), exist_ok=True)
    final = db_path(zim_name)
    tmp = final + ".tmp"
    key = "%s:%s:%s" % (os.path.getmtime(zim_path), os.path.getsize(zim_path), VERSION)
    conn, start = _open_scan(tmp, key, total)
    try:
        batch, flushed, count = [], start - 1, 0

        def flush(upto):
            nonlocal batch, flushed
            if batch:
                conn.executemany(
                    "INSERT OR REPLACE INTO places VALUES (?,?,?,?,?)", batch
                )
                batch = []
            conn.execute(
                "UPDATE progress SET value=? WHERE key='last_id'", (str(upto),)
            )
            conn.commit()
            flushed = upto

        for i in range(start, total):
            try:
                entry = archive._get_entry_by_id(i)
                if not entry.is_redirect:
                    item = entry.get_item()
                    if item.mimetype == "text/html":
                        data = bytes(item.content)
                        got = parse_geo(data)
                        if got:
                            batch.append(
                                (entry.path, entry.title, got[0], got[1], len(data))
                            )
            except Exception as e:  # a page libzim cannot read is skipped, not fatal
                log.debug("Zimi Earth: skipping entry %d of %s: %s", i, zim_name, e)
            if len(batch) >= BATCH or i - flushed >= PROGRESS_EVERY:
                flush(i)
        flush(total - 1)
        count = conn.execute("SELECT COUNT(*) FROM places").fetchone()[0]
        _create_indexes(conn)
        conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
        _write_index_meta(conn, archive, zim_path, VERSION, count)
        conn.commit()
    except BaseException:
        conn.close()
        raise
    conn.close()
    os.replace(tmp, final)
    return count


# ── what is known, for the page ────────────────────────────────────────────


def place_count(name):
    """How many places ``name``'s file holds; None until it is read."""
    try:
        conn = sqlite3.connect(db_path(name), timeout=5)
        try:
            row = conn.execute(
                "SELECT value FROM meta WHERE key='entry_count'"
            ).fetchone()
        finally:
            conn.close()
        return int(row[0]) if row else None
    except (sqlite3.Error, OSError):
        return None


def _ready(name):
    return os.path.exists(db_path(name))


def _wikis():
    """The wikis this request may read whose places have been read."""
    return [
        z for z in _geo_wikis() if _srv.zim_allowed(z["name"]) and _ready(z["name"])
    ]


def _share(name):
    """How far along an unfinished read is, 0 to 99; None when none is."""
    tmp = db_path(name) + ".tmp"
    if not os.path.exists(tmp):
        return None
    try:
        conn = sqlite3.connect(tmp, timeout=2)
        try:
            rows = dict(conn.execute("SELECT key, value FROM progress").fetchall())
        finally:
            conn.close()
        total = int(rows.get("total") or 0)
        return (
            min(99, max(0, int(100 * (int(rows.get("last_id", -1)) + 1) / total)))
            if total
            else 0
        )
    except (sqlite3.Error, ValueError, OSError):
        return None


def status():
    """What this request may be told: whether any place is known, which wikis
    are still being read and how far along, which were left out."""
    ready, finding, skipped = False, [], []
    for z in _geo_wikis():
        name = z["name"]
        if not _srv.zim_allowed(name):
            continue
        if _ready(name):
            ready = True
            continue
        row = {"zim": name, "title": z.get("title") or name}
        if name in _skipped:
            skipped.append(row)
            continue
        pct = _share(name)
        if pct is not None or name in _building or wanted():
            finding.append(dict(row, pct=pct or 0))
    return {"places": ready, "finding": finding, "skipped": skipped}


def has_places():
    """Whether any place this request may see has been read."""
    return bool(_wikis())


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


def _has_table(conn, name):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE name=?", (name,)).fetchone() is not None


def _kinds(conn, west, south, east, north, ordered):
    """How a box is read, in the order to try: the size order from the top,
    stopping at the limit, for a view of a quarter of the globe or more (most
    of what it holds qualifies); for a smaller one the biggest places' R*Tree,
    then, if that held too few, the R*Tree of them all; for a small one just
    that. Without an R*Tree, the size or latitude index."""
    share = _box_share(west, south, east, north)
    if not _has_table(conn, "places_rt"):
        return ["size" if share >= WIDE_SHARE else "lat"]
    if not ordered or share < TOP_FROM_SHARE:
        return ["rtree"]
    if share >= WIDE_SHARE:
        return ["size"]
    return ["top", "rtree"]


def _select(kind, spans, south, north, ordered, limit, west=None):
    """The query for one way of reading a box; (sql, args)."""
    cols = "p.path, p.title, p.lat, p.lon, p.size"
    if kind in ("rtree", "top"):
        table = "places_rt" if kind == "rtree" else "places_top"
        lon = " OR ".join("(r.min_lon <= ? AND r.max_lon >= ?)" for _ in spans)
        sql = (
            f"SELECT {cols} FROM {table} r JOIN places p ON p.rowid = r.id "
            f"WHERE r.min_lat <= ? AND r.max_lat >= ? AND ({lon})"
        )
        args = [north, south] + [v for lo, hi in spans for v in (hi, lo)]
    else:
        index = "places_size" if kind == "size" else "places_lat"
        lon = " OR ".join("(p.lon BETWEEN ? AND ?)" for _ in spans)
        sql = (
            f"SELECT {cols} FROM places p INDEXED BY {index} "
            f"WHERE p.lat BETWEEN ? AND ? AND ({lon})"
        )
        args = [south, north] + [v for lo, hi in spans for v in (lo, hi)]
    if ordered:
        sql += " ORDER BY p.size DESC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return sql, args


def explain(conn, west, south, east, north):
    """The way a box is read first, and the plan SQLite makes for it, for the
    tests and for anyone asking why."""
    kind = _kinds(conn, west, south, east, north, True)[0]
    sql, args = _select(kind, _lon_ranges(west, east), south, north, True, 60)
    plan = " ".join(r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, args))
    return f"{kind}: {plan}"


def _query_box(name, west, south, east, north, limit=None, ordered=True):
    conn = sqlite3.connect(db_path(name), timeout=5)
    try:
        spans = _lon_ranges(west, east)
        kinds = _kinds(conn, west, south, east, north, ordered)
        rows = []
        for i, kind in enumerate(kinds):
            sql, args = _select(kind, spans, south, north, ordered, limit)
            rows = conn.execute(sql, args).fetchall()
            # A narrower way that found enough is the answer; one that found
            # too few has left out places a wider way would have kept.
            if i == len(kinds) - 1 or (limit and len(rows) >= limit):
                break
        return rows
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
    (as wide as a twentieth of the view): from every Wikipedia this request
    may read for the globe, or from Wikivoyage. [] when nothing has been read
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


def _reach(lat, lon, km):
    """The box ``km`` around a point: (west, south, east, north)."""
    dlat = km / 111.0
    dlon = min(180.0, km / (111.0 * max(0.05, math.cos(math.radians(lat)))))
    west, east = lon - dlon, lon + dlon
    if west < -180:
        west += 360
    if east > 180:
        east -= 360
    if dlon >= 180:
        west, east = -180.0, 180.0
    return west, max(-90.0, lat - dlat), east, min(90.0, lat + dlat)


def near(lat, lon):
    """What the library has for a point: the nearest Wikipedia article within
    NEAR_KM per wiki, and the nearest Wikivoyage guide within GUIDE_KM, each
    with its language and distance. The guides are the local language's where
    the library has that Wikivoyage. A box is read whole and the nearest taken
    from it: it is never cut short by article size."""
    out = {"articles": [], "guides": []}
    for z in _wikis():
        km_max = NEAR_KM if z["project"] == "wikipedia" else GUIDE_KM
        try:
            rows = _query_box(
                z["name"], *_reach(lat, lon, km_max), limit=NEAR_ROWS_MAX, ordered=False
            )
        except sqlite3.Error:
            continue
        best = None
        for r in rows:
            km = km_between(lat, lon, r[2], r[3])
            if km <= km_max and (best is None or km < best[0]):
                best = (km, r)
        if best is None:
            continue
        item = dict(
            _row(z, best[1]), km=round(best[0], 1), language=z.get("language") or ""
        )
        out["articles" if z["project"] == "wikipedia" else "guides"].append(item)
    out["articles"].sort(key=lambda a: a["km"])
    out["guides"].sort(key=lambda a: a["km"])
    return out


def _reset_for_tests():
    with _state_lock:
        _building.clear()
        _skipped.clear()
