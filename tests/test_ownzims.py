"""Zimi's own ZIMs (zimi/ownzims.py): folders in the package built into real
ZIM files in Zimi's data folder, served as the library's last tier.

Eric, 2026-10-16: "When we do arcade I want that and almanac quietly converted
to zim files in the repo that we load ... Other readers can open and use
them."

Run: pytest tests/test_ownzims.py -v
"""

import os
import shutil

import pytest
from libzim.reader import Archive

from zimi import ownzims, server

ARCADE = os.path.join(ownzims.SOURCE_ROOT, "arcade")


@pytest.fixture
def home(tmp_path, monkeypatch):
    """An empty library and data folder, and a copy of the Arcade's source to
    change freely."""
    zims, data, src = tmp_path / "zims", tmp_path / "data", tmp_path / "src"
    zims.mkdir()
    shutil.copytree(ARCADE, src / "arcade")
    monkeypatch.setattr(server, "ZIM_DIR", str(zims))
    monkeypatch.setattr(server, "ZIMI_DATA_DIR", str(data))
    monkeypatch.setattr(ownzims, "SOURCE_ROOT", str(src))
    monkeypatch.delenv("ZIMI_BUILTIN_ZIMS", raising=False)
    return {"zims": zims, "data": data, "src": src / "arcade", "own": ownzims.OWN[0]}


def test_the_arcade_is_a_real_zim_any_reader_opens(home):
    path = ownzims.build(home["own"])
    assert path == os.path.join(str(home["data"]), "builtin", "zimi_arcade.zim")
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
    assert ownzims.build(own) == first, "a changed file builds it again"
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
    assert ownzims.build_all() == []
    assert os.path.getsize(path) == good


def test_served_as_the_last_tier_never_over_the_operators_file(home):
    ownzims.build(home["own"])
    zims = server._scan_zim_files()
    assert zims["zimi_arcade"].startswith(str(home["data"]))
    mine = home["zims"] / "zimi_arcade.zim"
    shutil.copy(ownzims.zim_path(home["own"]), mine)
    assert server._scan_zim_files()["zimi_arcade"] == str(mine)


def test_off_builds_and_serves_none(home, monkeypatch):
    ownzims.build(home["own"])
    monkeypatch.setenv("ZIMI_BUILTIN_ZIMS", "0")
    assert ownzims.zim_paths() == []
    assert ownzims.build_all() == []
    assert "zimi_arcade" not in server._scan_zim_files()


def test_every_own_folder_is_in_the_package():
    for own in ownzims.OWN:
        folder = os.path.join(os.path.dirname(ownzims.__file__), "builtin", own.folder)
        assert os.path.isfile(os.path.join(folder, "index.html")), own
        assert os.path.isfile(os.path.join(folder, "zimi.txt")), own
    with open(
        os.path.join(os.path.dirname(server.__file__), "..", "pyproject.toml")
    ) as f:
        assert '"builtin/**"' in f.read(), "pip installs must carry the sources"
