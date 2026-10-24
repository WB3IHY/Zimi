"""Zimi's own ZIMs: folders shipped in the package (``zimi/builtin/<name>/``)
built into real ZIM files in Zimi's data folder and served as the library's
last tier.

A real ZIM, so Kiwix and every other reader opens the same file. Built from
the folder, never committed: the package carries the source, every install
kind (Docker, desktop, pip) builds the same file, and git never holds a
binary that changes with each edit.

Built in the background after start (``start``), skipped when the folder has
not changed since the last build (its hash is kept beside the ZIM), and
written atomically by the folder packer Create uses. Nothing here is on a
request's path: until a build lands, the library simply does not have it.
``ZIMI_BUILTIN_ZIMS=0`` builds and serves none.
"""

import collections
import hashlib
import logging
import os
import threading

log = logging.getLogger("zimi")

Own = collections.namedtuple("Own", "folder name category")

#: Each one: the folder under zimi/builtin/, the file it becomes, and the
#: Home section it sits in. The folder's zimi.txt names it (title,
#: description, language, tags, icon) and tags it OWN_TAG, so the library
#: never mistakes it for something the person made.
OWN = (Own("arcade", "zimi_arcade", "Games"),)
OWN_TAG = "zimi:own"

SOURCE_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "builtin")
_STAMP_EXT = ".source"  # beside the ZIM: the hash of the folder it was built from
_HASH_CHUNK = 1 << 16

_lock = threading.Lock()


def enabled():
    from zimi import server as _srv

    return os.environ.get("ZIMI_BUILTIN_ZIMS", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    ) and _srv.bundled("creator")


def out_dir():
    from zimi import server as _srv

    return os.path.join(_srv.ZIMI_DATA_DIR, "builtin")


def zim_path(own):
    return os.path.join(out_dir(), own.name + ".zim")


def zim_paths():
    """The built ZIMs on disk, for the library scan (empty while off)."""
    if not enabled():
        return []
    return [p for p in (zim_path(o) for o in OWN) if os.path.isfile(p)]


def category_of(path):
    """The Home section of one of these ZIMs, by its path; None for any other."""
    if not path or os.path.dirname(os.path.abspath(path)) != os.path.abspath(out_dir()):
        return None
    name = os.path.splitext(os.path.basename(path))[0]
    return next((o.category for o in OWN if o.name == name), None)


def source_hash(folder):
    """One hash of every file's path and bytes, in a fixed order, so the same
    folder gives the same hash on every machine."""
    h = hashlib.sha256()
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames.sort()
        for fn in sorted(filenames):
            fs = os.path.join(dirpath, fn)
            h.update(os.path.relpath(fs, folder).replace(os.sep, "/").encode() + b"\0")
            with open(fs, "rb") as f:
                for chunk in iter(lambda: f.read(_HASH_CHUNK), b""):
                    h.update(chunk)
            h.update(b"\0")
    return h.hexdigest()


def _stamp(path):
    try:
        with open(path + _STAMP_EXT, encoding="ascii") as f:
            return f.read().strip()
    except OSError:
        return ""


def build(own):
    """Build ``own`` when its folder changed since the last build. Returns the
    ZIM's path when a new file was written, else None."""
    from zimi import creator

    folder = os.path.join(SOURCE_ROOT, own.folder)
    path = zim_path(own)
    want = source_hash(folder)
    if os.path.isfile(path) and _stamp(path) == want:
        return None
    os.makedirs(out_dir(), exist_ok=True)
    # Built beside the old one, then swapped in: a reader never sees half a
    # file, and the old one serves until the new one is whole.
    fresh = path + ".new.zim"
    for stale in (fresh, fresh + ".tmp"):
        if os.path.exists(stale):
            os.remove(stale)
    creator.create_folder_zim(folder, out_path=fresh, register=False)
    os.replace(fresh, path)
    with open(path + _STAMP_EXT, "w", encoding="ascii") as f:
        f.write(want)
    return path


def build_all():
    """Every own ZIM brought up to date and into the library; one failing
    never stops the others or the server."""
    if not enabled():
        return []
    built = []
    with _lock:
        for own in OWN:
            try:
                path = build(own)
            except Exception as e:  # a failed build leaves the last good one serving
                log.warning("Could not build %s: %s", own.name, e)
                continue
            if path:
                log.info("Built %s", os.path.basename(path))
                built.append(path)
    if built:
        from zimi import zimwriter

        zimwriter._register_exports(built)
    return built


def start():
    threading.Thread(target=build_all, daemon=True, name="own-zims").start()
