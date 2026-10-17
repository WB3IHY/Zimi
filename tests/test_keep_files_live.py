"""Remove asks first; a ZIM can be added from Files with no server at all.

  - Removing a kept ZIM asks in one line, in the app's own dialog (not a browser
    confirm), with Remove and Cancel: from the menu, from About and from Manage.
    Cancel keeps it.
  - "Add from Files" in the On this phone view copies a picked .zim into the
    phone's storage in slices, with progress, with the server stopped and the
    device offline. It is then a kept ZIM like any other: a tile marked From
    Files, its pictures, title search, its own About, and remove.
  - A file that is not a ZIM, and one compressed with xz, are refused before
    anything is stored.
  - WebKit (persistent context, where OPFS works): the copy time of a ~250 MB
    ZIM, and the first article read from it afterwards. Printed (run with -s).

Screenshots: ZIMI_SHOTS=/some/dir pytest tests/test_keep_files_live.py -s
"""

import os
import sys
import tempfile
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import test_keep_phone_live as kp  # noqa: E402
from test_keep_flow_live import (
    library,
    menu_labels,
    open_menu,
    phone,
    world,
)  # noqa: E402,F401
from test_keep_phone_live import (
    _device,
    poll,
    pw,
    shot,
    wait_shell_kept,
)  # noqa: E402,F401

ZIM = "wikipedia"
NOTES = "notes_en_2026-10"
BIG = os.path.expanduser("~/Zimi/gutenberg_en_lcc-k_2026-03.zim")


@pytest.fixture(scope="module")
def notes_zim(tmp_path_factory):
    """A ZIM the server has never seen: a page, an article with a picture."""
    d = tmp_path_factory.mktemp("notes")
    path = str(d / (NOTES + ".zim"))
    img = kp.wf._png(30, 20)
    page = kp.wf.page
    kp.wf._zim(
        path,
        "notes",
        "eng",
        "Field Notes",
        [
            (
                "Main_Page",
                "Main Page",
                page("Main Page", "<p>Welcome to the field notes.</p>"),
                "text/html",
            ),
            (
                "Boat",
                "Boat",
                page(
                    "Boat",
                    '<p>A boat on the water.</p><img src="./I/pic.png" width="30" height="20">',
                ),
                "text/html",
            ),
            ("I/pic.png", "", img, "image/png"),
        ],
        "Main_Page",
    )
    return path


def confirm_text(pg):
    pg.wait_for_selector(".pw-overlay.open h3", timeout=5000)
    return pg.inner_text(".pw-overlay.open h3"), pg.inner_text(
        ".pw-overlay.open .pw-actions"
    )


def test_removing_asks_first_from_the_menu_about_and_manage(pw, world):
    br, ctx, pg = library(pw, world)
    pg.evaluate("(z) => _keepStart(z)", ZIM)
    pg.wait_for_selector(
        ".stat-card[data-zim='%s'] .keep-ico.kept" % ZIM, timeout=30000
    )

    # The menu: one line in the app's own dialog; Cancel keeps it.
    open_menu(pg, ZIM)
    pg.click("[data-action='keep-remove']")
    line, buttons = confirm_text(pg)
    assert line == "Remove Wikipedia from this phone?", line
    assert "Remove" in buttons and "Cancel" in buttons
    shot(pg, "r1-confirm")
    pg.click("#ac-cancel")
    pg.wait_for_timeout(400)
    assert pg.query_selector(
        ".stat-card[data-zim='%s'] .keep-ico.kept" % ZIM
    ), "cancel keeps it"

    # About: the same question.
    pg.evaluate("(z) => _openZimAbout(z)", ZIM)
    pg.wait_for_selector("#zi-keep .keep-btn")
    pg.click("#zi-keep .keep-btn")
    assert confirm_text(pg)[0] == "Remove Wikipedia from this phone?"
    pg.click("#ac-cancel")
    pg.evaluate("() => _closeZimAbout()")

    # Manage: the same question; yes removes it.
    pg.evaluate("() => _keepOpenView()")
    pg.wait_for_selector("button.keep-manage-btn")
    pg.click("button.keep-manage-btn")
    pg.click(".keep-rm")
    assert confirm_text(pg)[0] == "Remove Wikipedia from this phone?"
    pg.click("#ac-ok")
    pg.wait_for_function(
        "() => !document.querySelector('.stat-card.kept')", timeout=15000
    )
    ctx.close()
    br.close()


def add_from_files(pg, path):
    pg.evaluate("() => _keepOpenView()")
    pg.wait_for_selector(".keep-file-input", state="attached")
    pg.set_input_files(".keep-file-input", path)


def test_add_from_files_with_the_server_stopped_and_the_device_offline(
    pw, world, notes_zim, tmp_path
):
    srv, proxy = world
    br, ctx, pg = library(pw, world)
    pg.on('console', lambda m: print('CONSOLE', m.text[:300]) if 'keep worker' in m.text else None)
    srv.stop()
    ctx.set_offline(True)

    # Not a ZIM: refused, nothing kept.
    bad = tmp_path / "not_a_zim.zim"
    bad.write_bytes(b"this is only text" * 500)
    add_from_files(pg, str(bad))
    pg.wait_for_selector(".keep-note.keep-err", timeout=15000)
    assert pg.inner_text(".keep-note.keep-err") == "That file is not a ZIM."
    shot(pg, "a1-not-a-zim")
    assert (
        pg.evaluate(
            "async () => (await (await fetch('/keep-local/list')).json()).zims.length"
        )
        == 0
    )

    # A real ZIM: copied with progress, then a kept ZIM like any other.
    add_from_files(pg, notes_zim)
    pg.wait_for_selector(".stat-card[data-zim='%s']" % NOTES, timeout=30000)
    tile = pg.inner_text(".stat-card[data-zim='%s']" % NOTES)
    assert "Field Notes" in tile and "From Files" in tile, tile
    assert pg.query_selector(".stat-card[data-zim='%s'] .keep-ico.kept" % NOTES)
    shot(pg, "a2-view-from-files")
    meta = pg.evaluate(
        "async () => (await (await fetch('/keep-local/list')).json()).zims[0]"
    )
    assert (
        meta["source"] == "files"
        and meta["title"] == "Field Notes"
        and meta["complete"]
    ), meta

    # Opens from its tile, with its picture; titles search; the server never knew it.
    pg.click(".stat-card[data-zim='%s']" % NOTES)
    kp.wait_article(pg, "Welcome to the field notes")
    pg.evaluate("([z]) => openArticle(z, 'Boat', 'Boat')", [NOTES])
    kp.wait_article(pg, "A boat on the water")
    poll(pg, kp.PICTURE_LOADED, 10)
    shot(pg, "a3-article-from-files")
    hits = pg.evaluate(
        "async () => (await (await fetch('/keep-local/search?q=boat')).json()).results.map(r => r.title)"
    )
    assert hits == ["Boat"], hits

    # Its own About says where it came from.
    pg.evaluate("(z) => _openZimAbout(z)", NOTES)
    pg.wait_for_selector("#zi-keep")
    pg.wait_for_function(
        "() => /From Files/.test(document.querySelector('.zi-panel').innerText)"
    )
    assert "Copied from Files" in pg.inner_text("#zi-keep")
    shot(pg, "a4-about-from-files")
    ctx.close()
    br.close()


def test_an_xz_zim_is_refused_before_anything_is_stored(pw, world, notes_zim, tmp_path):
    # libzim's Python writer has no xz: mark every cluster of a small ZIM as xz
    # (compression 4 in the cluster's first byte), which is all the preflight reads.
    import struct

    data = bytearray(open(notes_zim, "rb").read())
    clusters, ptrs = struct.unpack("<I", data[28:32])[0], struct.unpack("<Q", data[48:56])[0]
    for i in range(clusters):
        at = struct.unpack("<Q", data[ptrs + 8 * i: ptrs + 8 * i + 8])[0]
        data[at] = (data[at] & 0xF0) | 4
    path = tmp_path / "old_xz.zim"
    path.write_bytes(bytes(data))
    br, ctx, pg = library(pw, world)
    add_from_files(pg, str(path))
    pg.wait_for_selector(".keep-note.keep-err", timeout=15000)
    assert "older compression (xz)" in pg.inner_text(".keep-note.keep-err")
    assert pg.evaluate("async () => (await (await fetch('/keep-local/list')).json()).zims.length") == 0
    ctx.close()
    br.close()


@pytest.mark.skipif(
    not os.path.exists(BIG), reason="the ~250 MB real ZIM is not on this Mac"
)
def test_webkit_copy_time_of_a_big_zim_offline(pw, world):
    srv, proxy = world
    try:
        ctx = pw.webkit.launch_persistent_context(tempfile.mkdtemp(), **_device(pw))
    except Exception as e:  # pragma: no cover
        pytest.skip("webkit not available: %s" % e)
    pg = ctx.new_page()
    pg.goto(proxy.base + "/", wait_until="load")
    pg.wait_for_selector(".stat-card", timeout=30000)
    pg.wait_for_function("() => !!navigator.serviceWorker.controller", timeout=30000)
    pg.evaluate("() => _keepLoad()")
    # Playwright's WebKit keeps no Cache Storage where OPFS works, so the worker
    # script could not load with the server gone. What is proven here instead:
    # the copy asks the network for nothing (the Chromium test has the server
    # stopped and the device offline), and the ZIM reads after the server stops.
    seen = []
    pg.on("request", lambda r: seen.append(r.url))
    pg.evaluate("() => { window.__t = performance.now(); }")
    t0 = time.time()
    add_from_files(pg, BIG)
    pg.wait_for_selector(".keep-import-box", timeout=15000)
    shot(pg, "w-copying")
    pg.wait_for_selector(".stat-card[data-zim='gutenberg_en_lcc-k_2026-03']", timeout=300000)
    network = [u for u in seen if "/keep/" in u or "/dl/" in u]
    assert not network, "the copy must not touch the server: %s" % network
    srv.stop()
    secs = time.time() - t0
    size = os.path.getsize(BIG)
    t1 = time.time()
    pg.evaluate(
        "([z, p, t]) => openArticle(z, p, t)",
        ["gutenberg_en_lcc-k_2026-03", "Home", "Home"],
    )
    pg.wait_for_function(
        "() => { const f = document.querySelector('iframe'); try { return f && f.contentDocument.body.innerText.length > 50; } catch (e) { return false; } }",
        timeout=30000,
    )
    first_ms = (time.time() - t1) * 1000
    print(
        "\nwebkit: copied %.0f MB from a picked file in %.1f s (%.0f MB/s) with no server; first article %.0f ms"
        % (size / 1e6, secs, size / 1e6 / secs, first_ms)
    )
    ctx.close()
