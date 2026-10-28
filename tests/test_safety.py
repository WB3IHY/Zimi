"""zimi.safety: what may go on a log line, and a path that stays in its root."""

import logging
import os

from zimi.safety import loggable, resolve_inside


def test_loggable_neutralises_line_breaks_and_controls():
    out = loggable("evil\r\nINFO forged line\x1b[31m\x00")
    assert "\n" not in out and "\r" not in out and "\x1b" not in out and "\x00" not in out
    assert "evil\\r\\nINFO forged line" in out


def test_loggable_leaves_ordinary_text_alone():
    assert loggable("wikipedia_en 2026-10 – café") == "wikipedia_en 2026-10 – café"
    assert loggable(42) == "42"
    assert loggable(ValueError("bad\nvalue")) == "bad\\nvalue"


def test_a_logged_name_stays_on_one_record_line(caplog):
    log = logging.getLogger("zimi.test_safety")
    with caplog.at_level(logging.INFO, logger="zimi.test_safety"):
        log.info("opened %s", loggable("a\nINFO zimi: forged"))
    assert len(caplog.text.strip().splitlines()) == 1


def test_resolve_inside_accepts_paths_under_the_root(tmp_path):
    (tmp_path / "a").mkdir()
    assert resolve_inside(tmp_path, "a", "x.zim") == os.path.join(os.path.realpath(tmp_path), "a", "x.zim")
    assert resolve_inside(tmp_path) == os.path.realpath(tmp_path)


def test_resolve_inside_refuses_escapes(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    assert resolve_inside(root, "..", "other") is None
    assert resolve_inside(root, "/etc/passwd") is None
    (tmp_path / "secret").mkdir()
    os.symlink(tmp_path / "secret", root / "link")
    assert resolve_inside(root, "link", "f") is None
    assert resolve_inside(root, "a", "..", "..", "secret") is None
