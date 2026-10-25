"""Zimi's own ZIMs: real ZIM files committed in the package
(``zimi/builtin/<name>.zim``), served as the library's last tier, and attached
to each release so anyone can download them for Kiwix or any other reader.

Each is built from source by ``python -m zimi.ownzims``: a folder under
``zimi/builtin/<folder>/``, or a folder staged from files that live elsewhere
in the package (the Almanac's pages are the ones Zimi serves, see
almanacstage.py). A build is skipped when the source has not changed since
the committed file was made: the source's hash is committed beside it
(``<name>.zim.source``), so a ZIM's bytes change only when its source did.
CI fails a pull request whose ZIMs are older than their source.

Nothing is built while Zimi runs: the scan finds the committed files, so
every install kind (Docker, desktop, pip, zimi-mcp) serves the same bytes a
download gets. ``ZIMI_BUILTIN_ZIMS=0`` serves none.
"""

import collections
import hashlib
import os
import sys
import tempfile

#: ``folder``: its source under zimi/builtin/; ``name``: the file it becomes;
#: ``category``: its Home section; ``stage``: None for a plain folder, else a
#: function writing the folder to build into an empty directory. The source's
#: zimi.txt names it (title, description, language, tags, icon) and tags it
#: OWN_TAG, so the library never mistakes it for something the person made.
Own = collections.namedtuple("Own", "folder name category stage", defaults=(None,))


def _stage_almanac(dest):
    from zimi import almanacstage

    almanacstage.stage(dest)


OWN = (
    Own("arcade", "zimi_arcade", "Games"),
    Own("almanac", "zimi_almanac", "Education", _stage_almanac),
)
OWN_TAG = "zimi:own"

SOURCE_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "builtin")
#: Where the built files are committed. A module global so tests build elsewhere.
OUT_DIR = SOURCE_ROOT
_STAMP_EXT = ".source"  # beside the ZIM: the hash of the source it was built from
_HASH_CHUNK = 1 << 16


def enabled():
    return os.environ.get("ZIMI_BUILTIN_ZIMS", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def zim_path(own):
    return os.path.join(OUT_DIR, own.name + ".zim")


def zim_paths():
    """The committed ZIMs, for the library scan (empty while off)."""
    if not enabled():
        return []
    return [p for p in (zim_path(o) for o in OWN) if os.path.isfile(p)]


def category_of(path):
    """The Home section of one of these ZIMs, by its path; None for any other."""
    if not path or os.path.dirname(os.path.abspath(path)) != os.path.abspath(OUT_DIR):
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


def _with_source(own, fn):
    """``fn(folder)`` on ``own``'s source folder, staged first if it is."""
    if not own.stage:
        return fn(os.path.join(SOURCE_ROOT, own.folder))
    with tempfile.TemporaryDirectory(prefix=own.name + "-") as dest:
        own.stage(dest)
        return fn(dest)


def fresh(own):
    """Whether the committed ZIM was built from the source as it is now."""
    path = zim_path(own)
    return os.path.isfile(path) and _with_source(own, source_hash) == _stamp(path)


def build(own):
    """Build ``own`` when its source changed since the committed file was
    made. Returns the ZIM's path when a new file was written, else None."""

    def _build(folder):
        from zimi import creator

        path = zim_path(own)
        want = source_hash(folder)
        if os.path.isfile(path) and _stamp(path) == want:
            return None
        os.makedirs(OUT_DIR, exist_ok=True)
        # Built beside the old one, then swapped in: never half a file.
        new = path + ".new.zim"
        for stale in (new, new + ".tmp"):
            if os.path.exists(stale):
                os.remove(stale)
        creator.create_folder_zim(folder, out_path=new, register=False)
        os.replace(new, path)
        with open(path + _STAMP_EXT, "w", encoding="ascii") as f:
            f.write(want + "\n")
        return path

    return _with_source(own, _build)


def main(argv=None):
    """``python -m zimi.ownzims [--check]``: build what changed, or (--check)
    list what is stale and exit 1."""
    argv = sys.argv[1:] if argv is None else argv
    if "--check" in argv:
        stale = [o.name for o in OWN if not fresh(o)]
        for name in stale:
            print("%s.zim is older than its source: run python -m zimi.ownzims" % name)
        return 1 if stale else 0
    for own in OWN:
        path = build(own)
        print(
            "built %s (%d KB)" % (path, os.path.getsize(path) // 1024)
            if path
            else "%s.zim is current" % own.name
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
