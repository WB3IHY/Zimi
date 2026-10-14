"""Other folders Zimi reads ZIMs from, without owning them.

A second program (Project NOMAD's Information Library, a Kiwix box, a shared
drive) keeps ZIMs in a folder of its own. Zimi reads them where they are: no
copy, no move, nothing written beside them. That folder stays the other
program's, so Zimi never deletes, renames or updates a file in it, and a
same-named ZIM in Zimi's own library always wins.

Folders come from ``ZIMI_EXTRA_ZIM_DIRS`` (a path list, ``os.pathsep``
separated; the file ``extra_zim_dirs`` key is the same setting) and from
``library_folders.json`` in the data folder, which is what the Storage card
edits. The environment wins the way it does everywhere: its folders are listed
but cannot be removed from the page.

Each folder is read flat: its own ``*.zim`` files, no subfolders. That is how
NOMAD (``storage/zim``) and Kiwix lay out a library.
"""

import glob
import logging
import os
import threading

import zimi.server as _srv

log = logging.getLogger("zimi")

ENV = "ZIMI_EXTRA_ZIM_DIRS"
STATE_FILE = "library_folders.json"
MAX_FOLDERS = 8
_LABEL_MAX = 64

NOMAD_LABEL = "Project NOMAD"
# Where a NOMAD box keeps its ZIMs on the host (install_nomad.sh), and where
# the docs mount that folder inside a container.
NOMAD_CANDIDATES = ("/opt/project-nomad/storage/zim", "/nomad")

#: How often a quiet library is looked at for ZIMs another program added or
#: removed: one directory listing per folder, nothing else.
WATCH_SECONDS = 30


class FolderError(Exception):
    """A folder that cannot be added or removed; ``key`` is the i18n key."""

    def __init__(self, key):
        super().__init__(key)
        self.key = key


def _norm(path):
    return os.path.normpath(os.path.abspath(os.path.expanduser(str(path).strip())))


def _default_label(path):
    return NOMAD_LABEL if path in NOMAD_CANDIDATES else os.path.basename(path)


def _state_path():
    return os.path.join(_srv.ZIMI_DATA_DIR, STATE_FILE)


def _read_state():
    import json

    try:
        with open(_state_path(), encoding="utf-8") as f:
            state = json.load(f)
    except (OSError, ValueError):
        return {"folders": [], "dismissed": []}
    if not isinstance(state, dict):
        return {"folders": [], "dismissed": []}
    state.setdefault("folders", [])
    state.setdefault("dismissed", [])
    return state


def _write_state(state):
    _srv._atomic_write_json(_state_path(), state)


def folders():
    """Every folder asked for, ``[{path, label, source}]``: the environment's
    first, then the ones saved from the page. A folder that is not there right
    now is still listed (an unplugged drive comes back), just not read."""
    out, seen = [], set()
    for raw in os.environ.get(ENV, "").split(os.pathsep):
        if raw.strip():
            p = _norm(raw)
            if p not in seen:
                seen.add(p)
                out.append({"path": p, "label": _default_label(p), "source": "env"})
    for item in _read_state()["folders"]:
        p = _norm(item.get("path", ""))
        if p not in seen:
            seen.add(p)
            label = str(item.get("label") or _default_label(p))[:_LABEL_MAX]
            out.append({"path": p, "label": label, "source": "saved"})
    return out


def dirs():
    """The folders that exist right now, in the order they were asked for."""
    return [f["path"] for f in folders() if os.path.isdir(f["path"])]


def labels():
    """``{folder: label}``, taken once per question so a list of a thousand
    ZIMs asks the disk nothing per ZIM."""
    return {f["path"]: f["label"] for f in folders()}


def owner(path, folder_labels=None):
    """The label of the folder ``path`` lives in, or None when it is in Zimi's
    own library. Pure string work on a path the scan already produced."""
    folder_labels = labels() if folder_labels is None else folder_labels
    return folder_labels.get(os.path.dirname(os.path.normpath(path)))


def zim_paths():
    """Every ``*.zim`` in the folders, folder by folder, name order."""
    return [p for d in dirs() for p in sorted(glob.glob(os.path.join(d, "*.zim")))]


def _inside(child, parent):
    child, parent = os.path.realpath(child), os.path.realpath(parent)
    return child == parent or child.startswith(parent + os.sep)


def add(path, label=""):
    """Start reading ZIMs from ``path``. Raises FolderError(key) when it is
    not a readable folder, is Zimi's own, is already listed, or is one too many."""
    p = _norm(path)
    if not os.path.isdir(p):
        raise FolderError("folder_missing")
    if not os.access(p, os.R_OK | os.X_OK):
        raise FolderError("folder_unreadable")
    if _inside(p, _srv.ZIM_DIR) or _inside(p, _srv.ZIMI_DATA_DIR):
        raise FolderError("folder_is_library")
    held = folders()
    if any(f["path"] == p for f in held):
        raise FolderError("folder_known")
    if len(held) >= MAX_FOLDERS:
        raise FolderError("folder_limit")
    state = _read_state()
    state["folders"].append(
        {"path": p, "label": (label.strip() or _default_label(p))[:_LABEL_MAX]}
    )
    _write_state(state)
    _watch.reset()


def remove(path):
    """Stop reading from a saved folder. Its files are not touched."""
    p = _norm(path)
    if any(f["path"] == p and f["source"] == "env" for f in folders()):
        raise FolderError("folder_env")
    state = _read_state()
    state["folders"] = [f for f in state["folders"] if _norm(f.get("path", "")) != p]
    _write_state(state)
    _watch.reset()


def dismiss(path):
    """Stop offering this folder."""
    p = _norm(path)
    state = _read_state()
    if p not in state["dismissed"]:
        state["dismissed"].append(p)
        _write_state(state)


def suggestions():
    """Folders worth offering once: a Project NOMAD library found at one of its
    well-known places, not added and not turned down. Asked when the Storage
    card opens, never at boot or on a page people wait for."""
    known = {f["path"] for f in folders()}
    turned_down = set(_read_state()["dismissed"])
    out = []
    for c in NOMAD_CANDIDATES:
        if c in known or c in turned_down or not os.path.isdir(c):
            continue
        n = len(glob.glob(os.path.join(c, "*.zim")))
        if n:
            out.append({"path": c, "label": NOMAD_LABEL, "zims": n, "kind": "nomad"})
    return out


# ── following the other program's downloads ────────────────────────────────


class Watch:
    """Notices ZIMs another program added to or removed from a folder.

    One directory listing per tick, with sizes. A new file is acted on only
    once its size has held for a whole tick, so a copy still arriving is not
    opened. NOMAD stages downloads as ``.zim.tmp`` and renames, which never
    shows a half file, but a sideload with ``cp`` does.
    """

    def __init__(self):
        self.known = None
        self.pending = {}

    def reset(self):
        self.known = None
        self.pending = {}

    @staticmethod
    def _listing():
        out = {}
        for p in zim_paths():
            try:
                st = os.stat(p)
            except OSError:
                continue
            out[p] = (st.st_size, st.st_mtime)
        return out

    def tick(self):
        """Returns ``(added, gone)`` paths acted on this tick."""
        now = self._listing()
        if self.known is None:
            self.known, self.pending = now, {}
            return [], []
        gone = [p for p in self.known if p not in now]
        changed = [p for p in now if self.known.get(p) != now[p]]
        stable = [p for p in changed if self.pending.get(p) == now[p]]
        self.pending = {p: now[p] for p in changed}
        if not gone and not stable:
            return [], []
        if self._reconcile(stable, gone):
            self.known, self.pending = now, {}
        else:
            known = dict(self.known)
            known.update({p: now[p] for p in stable})
            for p in gone:
                known.pop(p, None)
            self.known = known
        return stable, gone

    @staticmethod
    def _reconcile(added, gone):
        """Splice the change into the live library. True when a full rescan
        had to be used (which also read everything on disk)."""
        removed = [os.path.basename(p) for p in gone]
        spliced = True
        for p in added:
            spliced = _srv.register_zim_file(p, removed_files=removed) and spliced
        if spliced:
            for name in removed:
                if not _srv.unregister_zim_file(name):
                    spliced = False
                    break
        if not spliced:
            with _srv._zim_lock:
                _srv.load_cache(force=True)
        _srv._search_cache_clear()
        _srv._suggest_cache_clear()
        log.info(
            "Other library folders changed: %d added, %d gone", len(added), len(gone)
        )
        return not spliced


_watch = Watch()
_watch_thread = None
_watch_lock = threading.Lock()


def _watch_loop():
    import time

    while True:
        time.sleep(WATCH_SECONDS)
        try:
            _watch.tick()
        except Exception as e:
            log.warning("Watching the other library folders failed: %s", e)


def ensure_watch():
    """Start the watcher once. A listing of no folders is free, so it does not
    wait for the first folder to be added."""
    global _watch_thread
    with _watch_lock:
        if _watch_thread is None:
            _watch_thread = threading.Thread(
                target=_watch_loop, daemon=True, name="zimi-library-folders"
            )
            _watch_thread.start()
