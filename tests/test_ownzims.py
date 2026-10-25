"""Zimi's own ZIMs (zimi/ownzims.py): real ZIM files committed in the package,
built from source by ``python -m zimi.ownzims``, served as the library's last
tier and downloadable for any reader.

Eric, 2026-10-16: "When we do arcade I want that and almanac quietly converted
to zim files in the repo that we load ... Other readers can open and use
them." And 2026-10-24: "Why have Zimi build the game zim instead of it
coming with the repo (ie a file others can download easily for their own
viewers)"

Run: pytest tests/test_ownzims.py -v
"""

import os
import shutil
import sys

import pytest
from libzim.reader import Archive

from zimi import ownzims, server

ARCADE = os.path.join(ownzims.SOURCE_ROOT, "arcade")


@pytest.fixture
def home(tmp_path, monkeypatch):
    """An empty library, an empty place to build into, and a copy of the
    Arcade's source to change freely."""
    zims, data, src = tmp_path / "zims", tmp_path / "data", tmp_path / "src"
    zims.mkdir()
    shutil.copytree(ARCADE, src / "arcade")
    monkeypatch.setattr(server, "ZIM_DIR", str(zims))
    monkeypatch.setattr(ownzims, "SOURCE_ROOT", str(src))
    monkeypatch.setattr(ownzims, "OUT_DIR", str(data))
    monkeypatch.delenv("ZIMI_BUILTIN_ZIMS", raising=False)
    return {"zims": zims, "data": data, "src": src / "arcade", "own": ownzims.OWN[0]}


def test_the_arcade_is_a_real_zim_any_reader_opens(home):
    path = ownzims.build(home["own"])
    assert path == os.path.join(str(home["data"]), "zimi_arcade.zim")
    a = Archive(path)
    assert a.main_entry.get_item().path == "index.html"
    assert a.get_metadata("Title").decode() == "Zimi Arcade"
    assert a.get_metadata("Language").decode() == "eng"
    assert a.get_metadata("Creator").decode() == "Zimi"
    tags = a.get_metadata("Tags").decode().split(";")
    assert tags[0] == "_category:games" and "_category:other" not in tags
    assert a.has_illustration(48)
    assert not a.has_entry_by_path(
        "zimi.txt"
    ), "the sidecar describes the ZIM, it is not in it"


def test_built_once_then_skipped_until_the_folder_changes(home):
    own = home["own"]
    first = ownzims.build(own)
    stamp = open(first + ".source").read()
    assert ownzims.build(own) is None, "same folder: nothing is built"
    (home["src"] / "index.html").write_text(
        "<!doctype html><title>Changed</title><p>changed</p>"
    )
    assert not ownzims.fresh(own), "a changed source makes the built file stale"
    assert ownzims.build(own) == first, "a changed file builds it again"
    assert ownzims.fresh(own)
    assert open(first + ".source").read() != stamp
    assert not [
        n
        for n in os.listdir(os.path.dirname(first))
        if ".new" in n or n.endswith(".tmp")
    ]


def test_the_hash_is_the_same_everywhere_and_sees_names_and_bytes(home):
    h = ownzims.source_hash(str(home["src"]))
    assert h == ownzims.source_hash(str(home["src"]))
    (home["src"] / "arcade.css").rename(home["src"] / "arcade2.css")
    assert ownzims.source_hash(str(home["src"])) != h, "a renamed file is a change"


def test_a_failed_build_leaves_the_last_good_one_serving(home, monkeypatch):
    path = ownzims.build(home["own"])
    good = os.path.getsize(path)
    (home["src"] / "index.html").write_text("<p>new</p>")

    def boom(*a, **k):
        raise RuntimeError("disk full")

    from zimi import creator

    monkeypatch.setattr(creator, "create_folder_zim", boom)
    with pytest.raises(RuntimeError):
        ownzims.build(home["own"])
    assert os.path.getsize(path) == good


def test_served_as_the_last_tier_never_over_the_operators_file(home):
    ownzims.build(home["own"])
    zims = server._scan_zim_files()
    assert zims["zimi_arcade"].startswith(str(home["data"]))
    mine = home["zims"] / "zimi_arcade.zim"
    shutil.copy(ownzims.zim_path(home["own"]), mine)
    assert server._scan_zim_files()["zimi_arcade"] == str(mine)


def test_off_serves_none(home, monkeypatch):
    ownzims.build(home["own"])
    monkeypatch.setenv("ZIMI_BUILTIN_ZIMS", "0")
    assert ownzims.zim_paths() == []
    assert "zimi_arcade" not in server._scan_zim_files()


def test_every_own_zim_is_committed_in_the_package():
    for own in ownzims.OWN:
        folder = os.path.join(os.path.dirname(ownzims.__file__), "builtin", own.folder)
        assert os.path.isfile(os.path.join(folder, "index.html")), own
        assert os.path.isfile(os.path.join(folder, "zimi.txt")), own
        assert os.path.isfile(ownzims.zim_path(own)), own
        Archive(ownzims.zim_path(own))  # opens: a real ZIM, not an LFS pointer
    with open(
        os.path.join(os.path.dirname(server.__file__), "..", "pyproject.toml")
    ) as f:
        assert '"builtin/**"' in f.read(), "pip installs must carry the sources"


def test_on_home_under_its_own_section_never_as_something_you_made(home):
    """The Arcade sat under Created with a Folder badge, as if the person had
    packed it: its section comes from OWN, and its tag tells provenance it
    ships with Zimi."""
    from zimi import http as zhttp

    path = ownzims.build(home["own"])
    assert ownzims.category_of(path) == "Games"
    assert server._effective_category("zimi_arcade", path) == "Games"
    assert ownzims.category_of(str(home["zims"] / "zimi_arcade.zim")) is None, "only Zimi's own copy"
    a = Archive(path)
    meta = {k: a.get_metadata(k).decode() for k in ("Tags", "Scraper") if k in a.metadata_keys}
    assert ownzims.OWN_TAG in meta["Tags"].split(";")
    assert zhttp._zimi_kind(meta) is None


@pytest.mark.skipif(
    not os.environ.get("CI") or sys.platform == "win32",
    reason="CI only (a source edit need not rebuild the ZIMs until the pull request), and not on Windows, whose checkout may turn line ends into CRLF",
)
def test_the_committed_zims_are_built_from_the_source_as_it_is():
    """A download, Kiwix and Zimi all get these bytes: a pull request whose
    ZIMs are older than their source fails until python -m zimi.ownzims runs."""
    assert ownzims.main(["--check"]) == 0
