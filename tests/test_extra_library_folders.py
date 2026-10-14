"""Other folders Zimi reads ZIMs from, without owning them.

A Project NOMAD box keeps its ZIMs in one folder and its own Kiwix serves them
from there. The promise to its owner: point Zimi at that folder and everything
is there; anything NOMAD downloads shows up in Zimi; Zimi never deletes,
renames or updates a file in a folder it does not own.

Run: pytest tests/test_extra_library_folders.py -v
"""

import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

import pytest

pytest.importorskip("libzim.writer")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import zimi.server as server  # noqa: E402
from zimi import libfolders  # noqa: E402

from conftest_zim import build_fixture_zim  # noqa: E402

OWN = "own_en_2026-01.zim"
NOMAD_WIKI = "wikipedia_en_100_mini_2026-01.zim"
NOMAD_MED = "medlineplus_en_all_2026-01.zim"


@pytest.fixture
def lib(tmp_path, monkeypatch):
    """Zimi's own library plus a NOMAD-shaped folder beside it."""
    own = tmp_path / "zims"
    nomad = tmp_path / "nomad" / "storage" / "zim"
    own.mkdir()
    nomad.mkdir(parents=True)
    data = tmp_path / "data"
    data.mkdir()
    build_fixture_zim(str(own / OWN))
    build_fixture_zim(str(nomad / NOMAD_WIKI))
    build_fixture_zim(str(nomad / NOMAD_MED))
    (nomad / "kiwix-library.xml").write_text("<library/>")
    monkeypatch.delenv(libfolders.ENV, raising=False)
    monkeypatch.setattr(server, "ZIM_DIR", str(own))
    monkeypatch.setattr(server, "ZIMI_DATA_DIR", str(data))
    server._zim_files_cache = None
    server._zim_list_cache = None
    return own, nomad


def _scan_names():
    return set(server._scan_zim_files())


# ---------------------------------------------------------------------------
# The scan
# ---------------------------------------------------------------------------


def test_without_extra_folders_the_scan_is_unchanged(lib):
    assert _scan_names() == {"own"}


def test_an_added_folder_is_read_in_place(lib):
    own, nomad = lib
    libfolders.add(str(nomad), "Project NOMAD")
    zims = server._scan_zim_files()
    assert set(zims) == {"own", "wikipedia_en_100", "medlineplus"}
    assert all(os.path.dirname(p) == str(nomad) for n, p in zims.items() if n != "own")
    # Nothing was copied, moved or created beside NOMAD's files.
    assert sorted(os.listdir(nomad)) == sorted(
        [NOMAD_WIKI, NOMAD_MED, "kiwix-library.xml"]
    )


def test_zimi_own_file_wins_a_name_collision(lib):
    own, nomad = lib
    build_fixture_zim(str(nomad / "own_en_2026-01.zim"))
    libfolders.add(str(nomad))
    assert server._scan_zim_files()["own"] == str(own / OWN)


def test_the_environment_names_folders_too(lib, monkeypatch):
    own, nomad = lib
    monkeypatch.setenv(libfolders.ENV, str(nomad))
    assert libfolders.dirs() == [str(nomad)]
    assert len(server._scan_zim_files()) == 3


def test_a_folder_that_is_not_there_is_skipped_quietly(lib, monkeypatch):
    monkeypatch.setenv(libfolders.ENV, "/no/such/place" + os.pathsep + str(lib[1]))
    assert libfolders.dirs() == [str(lib[1])]
    assert len(server._scan_zim_files()) == 3


# ---------------------------------------------------------------------------
# Ownership
# ---------------------------------------------------------------------------


def test_owner_names_the_folder_a_zim_is_in(lib):
    own, nomad = lib
    libfolders.add(str(nomad), "Project NOMAD")
    assert libfolders.owner(str(nomad / NOMAD_WIKI)) == "Project NOMAD"
    assert libfolders.owner(str(own / OWN)) is None


def test_a_label_defaults_to_the_folder_name(lib):
    libfolders.add(str(lib[1]))
    assert libfolders.owner(str(lib[1] / NOMAD_WIKI)) == "zim"


# ---------------------------------------------------------------------------
# Adding and removing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path,key",
    [
        ("{tmp}/missing", "folder_missing"),
        ("relative/path", "folder_missing"),
        ("{own}", "folder_is_library"),
        ("{own}/sub", "folder_is_library"),
        ("{data}", "folder_is_library"),
    ],
)
def test_add_refuses_what_it_cannot_read_or_already_has(lib, tmp_path, path, key):
    own, _ = lib
    (own / "sub").mkdir(exist_ok=True)
    path = path.format(tmp=tmp_path, own=own, data=tmp_path / "data")
    with pytest.raises(libfolders.FolderError) as e:
        libfolders.add(path)
    assert e.value.key == key


def test_add_twice_is_one_folder(lib):
    libfolders.add(str(lib[1]))
    with pytest.raises(libfolders.FolderError) as e:
        libfolders.add(str(lib[1]))
    assert e.value.key == "folder_known"
    assert len(libfolders.dirs()) == 1


def test_the_number_of_folders_is_bounded(lib, tmp_path):
    for i in range(libfolders.MAX_FOLDERS):
        d = tmp_path / f"f{i}"
        d.mkdir()
        libfolders.add(str(d))
    d = tmp_path / "one_more"
    d.mkdir()
    with pytest.raises(libfolders.FolderError) as e:
        libfolders.add(str(d))
    assert e.value.key == "folder_limit"


def test_remove_forgets_the_folder_and_touches_no_file(lib):
    own, nomad = lib
    libfolders.add(str(nomad))
    libfolders.remove(str(nomad))
    assert libfolders.dirs() == []
    assert _scan_names() == {"own"}
    assert os.path.exists(nomad / NOMAD_WIKI)


def test_a_folder_the_environment_names_cannot_be_removed(lib, monkeypatch):
    monkeypatch.setenv(libfolders.ENV, str(lib[1]))
    with pytest.raises(libfolders.FolderError) as e:
        libfolders.remove(str(lib[1]))
    assert e.value.key == "folder_env"


def test_saved_and_environment_folders_are_listed_with_their_source(
    lib, monkeypatch, tmp_path
):
    other = tmp_path / "other"
    other.mkdir()
    libfolders.add(str(other))
    monkeypatch.setenv(libfolders.ENV, str(lib[1]))
    got = {f["path"]: f["source"] for f in libfolders.folders()}
    assert got == {str(lib[1]): "env", str(other): "saved"}


# ---------------------------------------------------------------------------
# Finding NOMAD
# ---------------------------------------------------------------------------


def test_nomad_is_offered_when_its_folder_is_found(lib, monkeypatch):
    _, nomad = lib
    monkeypatch.setattr(libfolders, "NOMAD_CANDIDATES", (str(nomad),))
    got = libfolders.suggestions()
    assert [(s["path"], s["label"], s["zims"]) for s in got] == [
        (str(nomad), "Project NOMAD", 2)
    ]


def test_a_folder_already_added_is_not_offered_again(lib, monkeypatch):
    _, nomad = lib
    monkeypatch.setattr(libfolders, "NOMAD_CANDIDATES", (str(nomad),))
    libfolders.add(str(nomad))
    assert libfolders.suggestions() == []


def test_a_dismissed_offer_stays_dismissed(lib, monkeypatch):
    _, nomad = lib
    monkeypatch.setattr(libfolders, "NOMAD_CANDIDATES", (str(nomad),))
    libfolders.dismiss(str(nomad))
    assert libfolders.suggestions() == []


def test_a_folder_with_no_zims_is_not_offered(lib, monkeypatch, tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    monkeypatch.setattr(libfolders, "NOMAD_CANDIDATES", (str(empty),))
    assert libfolders.suggestions() == []


def test_ownership_with_the_labels_in_hand_asks_nothing_else(lib, monkeypatch):
    """A list of a thousand ZIMs asks the disk about folders once, then each
    ZIM is a string compare."""
    libfolders.add(str(lib[1]), "Project NOMAD")
    held = libfolders.labels()
    monkeypatch.setattr(
        libfolders, "folders", lambda: pytest.fail("per-ZIM question read the folders")
    )
    assert libfolders.owner(str(lib[1] / NOMAD_WIKI), held) == "Project NOMAD"
    assert libfolders.owner("/x/other.zim", held) is None


# ---------------------------------------------------------------------------
# Following NOMAD's downloads
# ---------------------------------------------------------------------------


def test_a_zim_nomad_downloads_appears_without_a_restart(lib):
    own, nomad = lib
    libfolders.add(str(nomad))
    server.load_cache(force=True)
    watch = libfolders.Watch()
    assert watch.tick() == ([], [])

    build_fixture_zim(str(nomad / "wikivoyage_en_all_2026-02.zim"))
    # First sighting: it might still be copying. Second tick, same size: done.
    assert watch.tick() == ([], [])
    added, gone = watch.tick()
    assert [os.path.basename(p) for p in added] == ["wikivoyage_en_all_2026-02.zim"]
    assert "wikivoyage" in server._zim_files_cache
    assert "wikivoyage" in {z["name"] for z in server._zim_list_cache}


def test_a_growing_file_is_not_registered_until_it_stops(lib):
    own, nomad = lib
    libfolders.add(str(nomad))
    server.load_cache(force=True)
    watch = libfolders.Watch()
    watch.tick()
    p = nomad / "partial_en_2026-02.zim"
    p.write_bytes(b"x" * 10)
    watch.tick()
    p.write_bytes(b"x" * 20)  # still arriving
    assert watch.tick() == ([], [])
    assert "partial" not in server._zim_files_cache


def test_a_zim_nomad_removes_leaves_the_library(lib):
    own, nomad = lib
    libfolders.add(str(nomad))
    server.load_cache(force=True)
    watch = libfolders.Watch()
    watch.tick()
    server.release_zim_handles(["medlineplus"])
    os.remove(nomad / NOMAD_MED)
    added, gone = watch.tick()
    assert [os.path.basename(p) for p in gone] == [NOMAD_MED]
    assert "medlineplus" not in server._zim_files_cache
    assert "wikipedia_en_100" in server._zim_files_cache


def test_an_update_nomad_makes_replaces_the_old_edition(lib):
    own, nomad = lib
    libfolders.add(str(nomad))
    server.load_cache(force=True)
    watch = libfolders.Watch()
    watch.tick()
    new = nomad / "medlineplus_en_all_2026-03.zim"
    build_fixture_zim(str(new))
    server.release_zim_handles(["medlineplus"])
    os.remove(nomad / NOMAD_MED)
    watch.tick()
    watch.tick()
    assert server._zim_files_cache["medlineplus"] == str(new)
    assert [
        z["file"] for z in server._zim_list_cache if z["name"] == "medlineplus"
    ] == ["medlineplus_en_all_2026-03.zim"]


def test_a_quiet_library_costs_one_listing_per_tick(lib, monkeypatch):
    libfolders.add(str(lib[1]))
    server.load_cache(force=True)
    watch = libfolders.Watch()
    watch.tick()
    monkeypatch.setattr(
        server,
        "load_cache",
        lambda force=False: pytest.fail("an unchanged folder must not rescan"),
    )
    monkeypatch.setattr(
        server,
        "_extract_zim_metadata",
        lambda *a, **k: pytest.fail("an unchanged folder must not open an archive"),
    )
    assert watch.tick() == ([], [])
    assert watch.tick() == ([], [])


# ---------------------------------------------------------------------------
# Never touch what is not ours
# ---------------------------------------------------------------------------


def test_updates_are_not_offered_for_a_folder_zimi_does_not_own(lib, monkeypatch):
    from zimi import library

    own, nomad = lib
    libfolders.add(str(nomad))
    server.load_cache(force=True)
    names = {os.path.basename(p) for p in library._owned_zim_files().values()}
    assert names == {OWN}


class TestRoutes(unittest.TestCase):
    """The settings card and the Delete button, against a real server."""

    def setUp(self):
        from http.server import ThreadingHTTPServer

        from zimi.http import ZimHandler
        from zimi.manage import _generate_api_token

        self._tmp = tempfile.mkdtemp(prefix="zimi-lf-")
        self._own = os.path.join(self._tmp, "zims")
        self._nomad = os.path.join(self._tmp, "nomad", "zim")
        os.makedirs(self._own)
        os.makedirs(self._nomad)
        build_fixture_zim(os.path.join(self._own, OWN))
        build_fixture_zim(os.path.join(self._nomad, NOMAD_WIKI))
        self._saved = (server.ZIM_DIR, server.ZIMI_DATA_DIR, server.ZIMI_MANAGE)
        os.environ.pop(libfolders.ENV, None)
        server.ZIM_DIR = self._own
        server.ZIMI_DATA_DIR = os.path.join(self._tmp, "data")
        os.makedirs(server.ZIMI_DATA_DIR)
        server.ZIMI_MANAGE = True
        server._zim_files_cache = None
        server._zim_list_cache = None
        server.load_cache(force=True)
        self._srv = ThreadingHTTPServer(("127.0.0.1", 0), ZimHandler)
        threading.Thread(target=self._srv.serve_forever, daemon=True).start()
        self._base = f"http://127.0.0.1:{self._srv.server_address[1]}"
        self._token = _generate_api_token()

    def tearDown(self):
        self._srv.shutdown()
        server.ZIM_DIR, server.ZIMI_DATA_DIR, server.ZIMI_MANAGE = self._saved
        server._zim_files_cache = None
        server._zim_list_cache = None
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _req(self, path, payload=None):
        body = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(
            self._base + path, data=body, method="POST" if body else "GET"
        )
        req.add_header("Authorization", f"Bearer {self._token}")
        if body:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def test_add_shows_the_folder_and_flags_its_zims(self):
        st, d = self._req(
            "/manage/library-folders",
            {"action": "add", "path": self._nomad, "label": "Project NOMAD"},
        )
        self.assertEqual(st, 200, d)
        st, listing = self._req("/list")
        by_name = {z["name"]: z for z in listing}
        self.assertEqual(by_name["wikipedia_en_100"]["external"], "Project NOMAD")
        self.assertNotIn("external", by_name["own"])

    def test_delete_refuses_a_zim_in_a_folder_zimi_does_not_own(self):
        self._req("/manage/library-folders", {"action": "add", "path": self._nomad})
        st, d = self._req("/manage/delete", {"filename": NOMAD_WIKI})
        self.assertEqual((st, d["error_key"]), (403, "folder_not_ours"))
        self.assertTrue(os.path.exists(os.path.join(self._nomad, NOMAD_WIKI)))

    def test_adding_a_folder_reads_only_that_folder(self):
        saved = server.load_cache
        server.load_cache = lambda force=False: self.fail("a rescan of the whole library")
        try:
            st, d = self._req("/manage/library-folders", {"action": "add", "path": self._nomad})
        finally:
            server.load_cache = saved
        self.assertEqual(st, 200, d)
        self.assertEqual(d["folders"][0]["zims"], 1)
        self.assertIn("wikipedia_en_100", server._zim_files_cache)

    def test_only_the_primary_admin_may_name_a_folder_on_the_server_disk(self):
        import zimi.manage as manage

        saved = manage._primary_admin_authorized
        manage._primary_admin_authorized = lambda handler: False
        try:
            st, _ = self._req("/manage/library-folders", {"action": "add", "path": self._nomad})
            st_get, _ = self._req("/manage/library-folders")
        finally:
            manage._primary_admin_authorized = saved
        self.assertEqual((st, st_get), (403, 403))
        self.assertEqual(libfolders.dirs(), [])

    def test_zimis_own_file_wins_a_name_collision_in_the_list(self):
        build_fixture_zim(os.path.join(self._nomad, OWN))
        self._req("/manage/library-folders", {"action": "add", "path": self._nomad})
        _, listing = self._req("/list")
        own = [z for z in listing if z["name"] == "own"]
        self.assertEqual(len(own), 1)
        self.assertNotIn("external", own[0])

    def test_removing_the_libraries_own_folder_is_refused_and_costs_nothing(self):
        st, d = self._req("/manage/library-folders", {"action": "remove", "path": self._own})
        self.assertEqual((st, d["error_key"]), (400, "folder_unknown"))
        _, listing = self._req("/list")
        self.assertEqual([z["name"] for z in listing], ["own"])
        self.assertIn(OWN, server._load_disk_cache() or {})

    def test_listing_never_parses_the_folder_file(self):
        self._req("/manage/library-folders", {"action": "add", "path": self._nomad})
        saved = libfolders._read_state
        libfolders._read_state = lambda: self.fail("/list read library_folders.json")
        try:
            st, listing = self._req("/list")
        finally:
            libfolders._read_state = saved
        self.assertEqual(st, 200)
        self.assertEqual(len(listing), 2)

    def test_a_bad_folder_says_why(self):
        st, d = self._req(
            "/manage/library-folders", {"action": "add", "path": "/no/such"}
        )
        self.assertEqual(st, 400)
        self.assertEqual(d["error_key"], "folder_missing")

    def test_remove_takes_the_zims_out_and_leaves_the_files(self):
        self._req("/manage/library-folders", {"action": "add", "path": self._nomad})
        st, d = self._req(
            "/manage/library-folders", {"action": "remove", "path": self._nomad}
        )
        self.assertEqual(st, 200, d)
        _, listing = self._req("/list")
        self.assertEqual([z["name"] for z in listing], ["own"])
        self.assertTrue(os.path.exists(os.path.join(self._nomad, NOMAD_WIKI)))

    def test_get_lists_folders_and_the_offer(self):
        libfolders.NOMAD_CANDIDATES, saved = (self._nomad,), libfolders.NOMAD_CANDIDATES
        try:
            st, d = self._req("/manage/library-folders")
            self.assertEqual(st, 200)
            self.assertEqual(d["folders"], [])
            self.assertEqual(d["suggestions"][0]["label"], "Project NOMAD")
            self._req(
                "/manage/library-folders", {"action": "dismiss", "path": self._nomad}
            )
            _, d = self._req("/manage/library-folders")
            self.assertEqual(d["suggestions"], [])
        finally:
            libfolders.NOMAD_CANDIDATES = saved


# ---------------------------------------------------------------------------
# Review round: the update swap, removal by registry, handles, drives, locks
# ---------------------------------------------------------------------------


def _live(lib):
    """NOMAD's folder added, the library scanned, a watcher baseline taken."""
    own, nomad = lib
    libfolders.add(str(nomad), "Project NOMAD")
    server.load_cache(force=True)
    watch = libfolders.Watch()
    watch.tick()
    return own, nomad, watch


def _count_rescans(monkeypatch):
    calls = []
    real = server.load_cache

    def counting(force=False):
        if force:
            calls.append(1)
        return real(force=force)

    monkeypatch.setattr(server, "load_cache", counting)
    return calls


def test_an_update_is_one_swap_and_never_a_rescan(lib, monkeypatch):
    """NOMAD renames the new edition in, then deletes the old one. One tick can
    see the old file gone while the new one is still settling; the library must
    keep serving the old one until the new one swaps in, with no full rescan."""
    own, nomad, watch = _live(lib)
    rescans = _count_rescans(monkeypatch)
    new = nomad / "medlineplus_en_all_2026-03.zim"
    build_fixture_zim(str(new))
    server.release_zim_handles(["medlineplus"])
    os.remove(nomad / NOMAD_MED)
    served = []
    for _ in range(3):
        watch.tick()
        served.append(server._zim_files_cache.get("medlineplus"))
    assert rescans == []
    assert all(served), "a tick left the ZIM unserved"
    assert served[-1] == str(new)
    assert [
        z["file"] for z in server._zim_list_cache if z["name"] == "medlineplus"
    ] == [new.name]


def test_an_update_never_opens_a_file_still_being_written(lib, monkeypatch):
    own, nomad, watch = _live(lib)
    opened = []
    real = server._extract_zim_metadata
    monkeypatch.setattr(
        server, "_extract_zim_metadata", lambda n, p: opened.append(p) or real(n, p)
    )
    rescans = _count_rescans(monkeypatch)
    new = nomad / "medlineplus_en_all_2026-03.zim"
    new.write_bytes(b"x" * 10)
    os.remove(nomad / NOMAD_MED)
    watch.tick()
    new.write_bytes(b"x" * 20)  # a cp still going
    watch.tick()
    assert opened == [] and rescans == []
    assert server._zim_files_cache["medlineplus"] == str(nomad / NOMAD_MED)


def test_a_file_that_cannot_be_read_is_the_only_reason_to_rescan(lib, monkeypatch):
    own, nomad, watch = _live(lib)
    rescans = _count_rescans(monkeypatch)
    (nomad / "broken_en_all_2026-03.zim").write_bytes(b"not a zim at all" * 100)
    watch.tick()
    watch.tick()
    assert rescans == [1]


def test_removing_a_folder_never_touches_the_libraries_own_zims(lib):
    own, nomad, watch = _live(lib)
    with pytest.raises(libfolders.FolderError) as e:
        libfolders.remove(str(own))
    assert e.value.key == "folder_unknown"
    assert "own" in server._zim_files_cache


def test_the_same_file_name_in_both_folders_is_two_files(lib):
    """NOMAD deleting its copy of a name Zimi also has must not cost Zimi's."""
    own, nomad, watch = _live(lib)
    build_fixture_zim(str(nomad / OWN))
    watch.tick()
    watch.tick()
    assert server._zim_files_cache["own"] == str(own / OWN)
    server.release_zim_handles(["own"])
    os.remove(nomad / OWN)
    watch.tick()
    assert server._zim_files_cache["own"] == str(own / OWN)
    assert [z["file"] for z in server._zim_list_cache if z["name"] == "own"] == [OWN]
    assert OWN in (server._load_disk_cache() or {})


def test_removing_a_folder_that_is_unplugged_still_drops_its_zims(lib, tmp_path):
    own, nomad, watch = _live(lib)
    assert "medlineplus" in server._zim_files_cache
    gone = tmp_path / "unplugged"
    nomad.rename(gone)  # the drive goes away
    path = libfolders.remove(str(nomad))
    libfolders.reconcile([], libfolders.registered_in(path))
    assert "medlineplus" not in server._zim_files_cache
    assert "own" in server._zim_files_cache


def test_a_name_that_leaves_is_served_again_by_the_copy_beside_it(lib):
    own, nomad, watch = _live(lib)
    second = nomad.parent / "second"
    second.mkdir()
    build_fixture_zim(str(second / NOMAD_MED))
    libfolders.add(str(second), "Second")
    server.load_cache(force=True)
    assert server._zim_files_cache["medlineplus"] == str(nomad / NOMAD_MED)
    server.release_zim_handles(["medlineplus"])
    os.remove(nomad / NOMAD_MED)
    libfolders.reconcile([], [str(nomad / NOMAD_MED)])
    assert server._zim_files_cache["medlineplus"] == str(second / NOMAD_MED)


def test_register_in_place_drops_the_stale_handles(lib):
    own, nomad, watch = _live(lib)
    server.open_archive(str(nomad / NOMAD_MED))
    for pool in (server._suggest_pool, server._fts_pool):
        pool["medlineplus"] = object()
    assert server.register_zim_file(str(nomad / NOMAD_MED)) is True
    assert "medlineplus" not in server._suggest_pool
    assert "medlineplus" not in server._fts_pool


def test_a_lower_tier_arrival_stays_shadowed_and_a_higher_one_takes_over(lib):
    own, nomad = lib
    build_fixture_zim(str(nomad / OWN))
    libfolders.add(str(nomad))
    server.load_cache(force=True)
    assert server._zim_files_cache["own"] == str(own / OWN)
    # Another program's copy arriving later does not displace Zimi's own.
    assert server.register_zim_file(str(nomad / OWN)) is True
    assert server._zim_files_cache["own"] == str(own / OWN)
    # The rule itself, both ways round, whatever the build.
    theirs, ours = str(nomad / OWN), str(own / OWN)
    assert server._zim_holder_keeps(ours, theirs) is True
    assert server._zim_holder_keeps(theirs, ours) is False


def test_a_collision_log_never_breaks_a_scan_across_drives(lib, monkeypatch):
    own, nomad = lib
    build_fixture_zim(str(nomad / OWN))
    libfolders.add(str(nomad))

    def other_drive(path, start=os.curdir):
        raise ValueError("path is on mount 'D:', start on mount 'C:'")

    monkeypatch.setattr(server.os.path, "relpath", other_drive)
    assert server._scan_zim_files()["own"] == str(own / OWN)


def test_listing_the_library_reads_no_file_for_ownership(lib, monkeypatch):
    own, nomad, watch = _live(lib)
    monkeypatch.setattr(
        libfolders, "_read_state", lambda: pytest.fail("a list read the folder file")
    )
    held = libfolders.labels()
    assert libfolders.owner(str(nomad / NOMAD_MED), held) == "Project NOMAD"
    assert libfolders.owner(str(nomad / NOMAD_MED)) == "Project NOMAD"


def test_the_environment_cannot_make_zimis_own_library_somebody_elses(lib, monkeypatch):
    own, nomad = lib
    monkeypatch.setenv(libfolders.ENV, str(own) + os.pathsep + str(nomad))
    assert libfolders.dirs() == [str(nomad)]
    assert libfolders.owner(str(own / OWN)) is None


def test_a_root_folder_still_has_a_label():
    assert libfolders._default_label(os.path.abspath(os.sep)) == os.path.abspath(os.sep)


def test_saved_folders_survive_threads_changing_them_at_once(lib, monkeypatch):
    import time

    real = libfolders._read_state

    def slow():
        state = real()
        time.sleep(0.01)
        return state

    monkeypatch.setattr(libfolders, "_read_state", slow)
    paths = [f"/dismissed/{i}" for i in range(12)]
    threads = [threading.Thread(target=libfolders.dismiss, args=(p,)) for p in paths]
    [t.start() for t in threads]
    [t.join() for t in threads]
    monkeypatch.setattr(libfolders, "_read_state", real)
    assert sorted(libfolders._read_state()["dismissed"]) == sorted(
        libfolders._norm(p) for p in paths
    )


def test_a_reset_waits_for_a_tick_in_flight(lib, monkeypatch):
    own, nomad, watch = _live(lib)
    seen = []
    real = libfolders.reconcile

    def slow(added, gone):
        seen.append("tick-start")
        time.sleep(0.2)
        seen.append("tick-end")
        return real(added, gone)

    monkeypatch.setattr(libfolders, "reconcile", slow)
    build_fixture_zim(str(nomad / "later_en_all_2026-04.zim"))
    watch.tick()  # first sighting
    t = threading.Thread(target=watch.tick)  # settled: reconciles, slowly
    t.start()
    time.sleep(0.05)
    watch.reset()
    seen.append("reset-done")
    t.join()
    assert seen.index("tick-end") < seen.index("reset-done")


if __name__ == "__main__":
    unittest.main()
