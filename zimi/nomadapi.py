"""Project NOMAD's own API as the back end for the library folder NOMAD owns.

By default a NOMAD folder is read-only to Zimi (zimi/libfolders.py). With the
opt-in on, and NOMAD's admin API answering with the shapes of the version this
module was written against, Zimi's catalog Download, Update and Delete for ZIMs
in NOMAD's folder go through NOMAD instead of touching its files: NOMAD
downloads (staging ``.zim.tmp``, renaming when whole), records what it
installed, rebuilds its Kiwix library, indexes the ZIM for its assistant, and
removes the old edition itself. Zimi only asks, shows NOMAD's progress, and
reads the folder as before.

Anything unexpected (API missing, version not listed in ``SUPPORTED``, a route
this module needs absent from NOMAD's OpenAPI document) falls back to
read-only. NOMAD's admin API has no authentication and CSRF is off; there is
nothing to sign in with.
"""

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import zimi.server as _srv
from zimi import libfolders

log = logging.getLogger("zimi")

ENV = "ZIMI_NOMAD_API"
STATE_KEY = "nomad"

#: The API shapes this module was written against: NOMAD 1.35.x. A release
#: outside the list is read-only until someone has looked at what changed.
SUPPORTED = ("1.35.",)

#: Where NOMAD's admin answers from a custom app's container: its Docker
#: network name first, then the host's address as the container sees it.
CANDIDATES = (
    "http://nomad_admin:8080",
    "http://host.docker.internal:8080",
    "http://172.17.0.1:8080",
    "http://127.0.0.1:8080",
)

#: Routes this module calls, as NOMAD's OpenAPI document spells them.
REQUIRED_PATHS = (
    "/api/zim/list",
    "/api/zim/download-remote",
    "/api/zim/{filename}",
    "/api/downloads/jobs",
    "/api/downloads/jobs/{jobId}/cancel",
)

TIMEOUT_S = 6
PROBE_TTL_S = 60
POLL_S = 2
#: A finished job leaves NOMAD's queue; the file is the proof it finished.
GONE_GRACE_POLLS = 3
#: NOMAD is busy while it rebuilds Kiwix's library; a few missed answers in a
#: row are not a failed download.
POLL_ERRORS_MAX = 15
#: Deleting makes NOMAD purge its knowledge base and rebuild Kiwix's library.
DELETE_TIMEOUT_S = 90

REASON_OFF = "off"
REASON_NO_FOLDER = "no_folder"
REASON_UNREACHABLE = "unreachable"
REASON_VERSION = "version"
REASON_SHAPE = "shape"
REASON_OK = "ok"


class NomadError(Exception):
    """NOMAD refused or did not answer; ``status`` is its HTTP status or 0."""

    def __init__(self, message, status=0):
        super().__init__(message)
        self.status = status


# ── the opt-in ─────────────────────────────────────────────────────────────


def settings():
    """``{enabled, url, locked}``. ``ZIMI_NOMAD_API`` (the address) turns it on
    and wins over the page; otherwise the choice saved from the Storage card."""
    env = os.environ.get(ENV, "").strip()
    if env:
        return {"enabled": True, "url": env, "locked": True}
    saved = libfolders._read_state().get(STATE_KEY) or {}
    return {
        "enabled": bool(saved.get("enabled")),
        "url": str(saved.get("url") or ""),
        "locked": False,
    }


def save(enabled, url=""):
    """Remember the choice. Raises ValueError on an address that is not http(s)."""
    url = (url or "").strip().rstrip("/")
    if url and urllib.parse.urlparse(url).scheme not in ("http", "https"):
        raise ValueError("nomad_bad_url")
    with libfolders._state_lock:
        state = libfolders._read_state()
        state[STATE_KEY] = {"enabled": bool(enabled), "url": url}
        libfolders._write_state(state)
    _forget_probe()


# ── talking to NOMAD ───────────────────────────────────────────────────────


def _call(base, method, path, body=None, timeout=TIMEOUT_S):
    """One JSON request to NOMAD's admin; returns the decoded body."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            raw = resp.read()
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8")).get("message", "")
        except Exception:
            pass
        raise NomadError(detail or "NOMAD answered %d" % e.code, e.code) from e
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise NomadError("NOMAD did not answer") from e
    try:
        return json.loads(raw.decode("utf-8")) if raw else {}
    except ValueError as e:
        raise NomadError("NOMAD answered with something unexpected") from e


def _supported(version):
    return any(str(version).startswith(prefix) for prefix in SUPPORTED)


def _probe_one(base):
    """Ask one address who it is: ``(reason, version)``."""
    try:
        if _call(base, "GET", "/api/health").get("status") != "ok":
            return REASON_SHAPE, ""
        spec = _call(base, "GET", "/api/openapi.json")
    except NomadError:
        return REASON_UNREACHABLE, ""
    version = str((spec.get("info") or {}).get("version") or "")
    if not _supported(version):
        return REASON_VERSION, version
    paths = spec.get("paths") or {}
    if any(p not in paths for p in REQUIRED_PATHS):
        return REASON_SHAPE, version
    try:
        listing = _call(base, "GET", "/api/zim/list")
    except NomadError:
        return REASON_SHAPE, version
    if not isinstance(listing.get("files"), list):
        return REASON_SHAPE, version
    return REASON_OK, version


_probe_lock = threading.Lock()
_probe = {"at": 0.0, "reason": REASON_OFF, "version": "", "url": ""}


def _forget_probe():
    with _probe_lock:
        _probe.update(at=0.0, reason=REASON_OFF, version="", url="")


def has_folder():
    """A folder Zimi reads that is NOMAD's."""
    return any(f["label"] == libfolders.NOMAD_LABEL for f in libfolders.folders())


def probe(force=False):
    """Look at NOMAD's API (at most once a minute unless ``force``) and say
    whether it can be the back end. Safe from any thread; one network round
    trip per candidate address, only ever while the opt-in is on."""
    cfg = settings()
    with _probe_lock:
        fresh = time.monotonic() - _probe["at"] < PROBE_TTL_S
        if fresh and not force and _probe["reason"] != REASON_OFF:
            return dict(_probe)
    if not cfg["enabled"]:
        reason, version, url = REASON_OFF, "", ""
    elif not has_folder():
        reason, version, url = REASON_NO_FOLDER, "", ""
    else:
        reason, version, url = REASON_UNREACHABLE, "", ""
        for base in [cfg["url"]] if cfg["url"] else list(CANDIDATES):
            r, v = _probe_one(base)
            if r == REASON_OK:
                reason, version, url = r, v, base
                break
            # A version or shape answer is more useful than "unreachable".
            if r != REASON_UNREACHABLE:
                reason, version, url = r, v, base
    with _probe_lock:
        _probe.update(at=time.monotonic(), reason=reason, version=version, url=url)
        return dict(_probe)


def managed():
    """True when Zimi may act through NOMAD for its folder. Memory only: the
    watcher (and the Storage card) keep it fresh, so a list never waits on
    NOMAD."""
    with _probe_lock:
        return _probe["reason"] == REASON_OK


def view():
    """What the Storage card draws about NOMAD mode: the last probe, fresh
    within a minute (the watcher keeps it so), asked again after a settings or
    folder change forgot it. Probing every candidate can take ~48 s when none
    answers, too long for the card to wait on at every open."""
    cfg = settings()
    state = probe()
    return {
        "available": has_folder(),
        "enabled": cfg["enabled"],
        "locked": cfg["locked"],
        "url": cfg["url"],
        "reason": state["reason"],
        "version": state["version"],
        "supported": list(SUPPORTED),
    }


def tick():
    """The watcher's pass: refresh the answer while the opt-in is on."""
    if settings()["enabled"]:
        probe()


def _base():
    with _probe_lock:
        if _probe["reason"] != REASON_OK:
            raise NomadError("Project NOMAD's API is not available")
        return _probe["url"]


def is_nomad_path(path):
    return libfolders.owner(path) == libfolders.NOMAD_LABEL


# ── what the library actions do through NOMAD ──────────────────────────────


def nomad_files():
    """``{filename: path}`` of the ZIMs Zimi serves from NOMAD's folder."""
    return {
        os.path.basename(p): p
        for p in _srv.get_zim_files().values()
        if is_nomad_path(p)
    }


def delete(filename):
    """Delete a ZIM through NOMAD (its database, Kiwix library and knowledge
    base follow), then let the library notice at once. NomadError on refusal."""
    path = nomad_files().get(filename)
    if path is None:
        raise NomadError("not a Project NOMAD ZIM", 404)
    _call(
        _base(),
        "DELETE",
        "/api/zim/" + urllib.parse.quote(filename, safe=""),
        timeout=DELETE_TIMEOUT_S,
    )
    libfolders.settle(gone=[path])


def _job(base, job_id):
    for row in _call(base, "GET", "/api/downloads/jobs"):
        if str(row.get("jobId")) == str(job_id):
            return row
    return None


def _listed(base):
    files = _call(base, "GET", "/api/zim/list").get("files") or []
    return {f.get("name") for f in files}


def hand_off(dl, title):
    """Give a download to NOMAD and keep Zimi's record of it honest. ``dl`` is
    the record library built (id, url, filename, size, is_update); the caller
    puts it among the active downloads. Returns the NOMAD job id, or raises
    NomadError (the record is then never started)."""
    base = _base()
    meta = {"title": title or dl["filename"]}
    if dl.get("size_bytes"):
        meta["size_bytes"] = dl["size_bytes"]
    out = _call(
        base,
        "POST",
        "/api/zim/download-remote",
        {"url": dl["url"], "metadata": meta},
        timeout=20,
    )
    job_id = out.get("jobId")
    if job_id is None:
        raise NomadError("NOMAD did not name the download")
    return str(job_id)


def follow(dl, job_id, on_ok, on_fail):
    """Mirror NOMAD's job into Zimi's download record until it ends, on its own
    thread. ``on_ok`` runs once the file is listed; ``on_fail`` gets a short
    reason. A cancel in Zimi cancels NOMAD's job."""

    def run():
        base = _base_or_none()
        missing = errors = 0
        try:
            while base:
                if dl.get("cancelled"):
                    try:
                        _call(base, "POST", "/api/downloads/jobs/%s/cancel" % job_id)
                    except NomadError as e:
                        log.warning("NOMAD cancel failed: %s", e)
                    dl["done"], dl["error"] = True, "Cancelled"
                    return
                try:
                    row = _job(base, job_id)
                    landed = row is None and dl["filename"] in _listed(base)
                    errors = 0
                except NomadError:
                    errors += 1
                    if errors >= POLL_ERRORS_MAX:
                        raise
                    time.sleep(POLL_S)
                    continue
                if landed:
                    dl["done"] = True
                    on_ok(base)
                    return
                if row is None:
                    missing += 1
                    if missing >= GONE_GRACE_POLLS:
                        raise NomadError("NOMAD no longer lists this download")
                else:
                    missing = 0
                    dl["downloaded_bytes"] = int(row.get("downloadedBytes") or 0)
                    dl["total_bytes"] = int(
                        row.get("totalBytes") or dl.get("size_bytes") or 0
                    )
                    if row.get("status") == "failed":
                        raise NomadError(
                            row.get("failedReason") or "NOMAD's download failed"
                        )
                time.sleep(POLL_S)
            raise NomadError("Project NOMAD's API is not available")
        except NomadError as e:
            dl["done"], dl["error"] = True, "Download failed"
            on_fail(str(e))
        except Exception:
            log.exception("Following NOMAD's download of %s failed", dl["filename"])
            dl["done"], dl["error"] = True, "Download failed"

    threading.Thread(target=run, daemon=True, name="zimi-nomad-follow").start()


def _base_or_none():
    try:
        return _base()
    except NomadError:
        return None
