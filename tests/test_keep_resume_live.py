"""A pull to the phone survives a pause, a dropped server and a replaced ZIM.

Through the real About-panel control, the real worker and the real /keep route,
behind a proxy that makes the download slow enough to interrupt:

  - Pause keeps what was written; Resume asks for the rest by Range and the file
    that ends up in the phone's storage is byte for byte the ZIM;
  - the server going away mid-pull leaves a partial a later Resume completes;
  - a ZIM replaced on the server between Pause and Resume (same name, new file)
    is not spliced to the old head: the pull starts over and the phone ends with
    the NEW file, byte for byte.

Uses a real 70 MB ZIM from this Mac when there is one (else a generated one of
the same shape, ~20 MB).

Run: pytest tests/test_keep_resume_live.py -v -s
"""

import hashlib
import http.client
import os
import shutil
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_offline_truth_live import Server, _free_port  # noqa: E402
from test_keep_phone_live import _device, keep_from_about, poll, pw  # noqa: E402,F401

REAL = os.path.expanduser("~/Zimi/zimgit-medicine_en_2024-08.zim")
NAME = "zimgit-medicine"
CHUNK = 64 * 1024
PAUSE_S = 0.012  # per chunk: about 5 MB/s, a 70 MB ZIM takes ~14 s


class SlowProxy:
    """Forwards to the real server; /keep/ bodies are sent slowly."""

    def __init__(self, upstream_port, port):
        outer = self
        self.up = upstream_port
        self.slow = True

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def do_GET(self):
                conn = http.client.HTTPConnection("127.0.0.1", outer.up, timeout=30)
                headers = {
                    k: v
                    for k, v in self.headers.items()
                    if k.lower() not in ("host", "connection")
                }
                try:
                    conn.request("GET", self.path, headers=headers)
                    r = conn.getresponse()
                    self.send_response(r.status)
                    for k, v in r.getheaders():
                        if k.lower() not in ("transfer-encoding", "connection"):
                            self.send_header(k, v)
                    self.end_headers()
                    slow = outer.slow and self.path.startswith("/keep/")
                    while True:
                        chunk = r.read(CHUNK)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        if slow:
                            time.sleep(PAUSE_S)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                except Exception:
                    try:
                        self.send_error(502)
                    except Exception:
                        pass
                finally:
                    conn.close()

        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), H)
        self.httpd.daemon_threads = True
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % port

    def stop(self):
        if getattr(self, "stopped", False):
            return
        self.stopped = True
        self.httpd.shutdown()
        self.httpd.server_close()


def _sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


@pytest.fixture
def world(tmp_path):
    zims, data = tmp_path / "zims", tmp_path / "data"
    zims.mkdir()
    data.mkdir()
    target = zims / os.path.basename(REAL)
    if os.path.exists(REAL):
        shutil.copy(REAL, target)
    else:  # pragma: no cover - a Mac without it
        import wiki_fixture as wf

        wf.build_library(str(zims))
        pytest.skip("the real ZIM is not here")
    srv = Server(str(zims), str(data), _free_port())
    srv.start()
    proxy = SlowProxy(srv.port, _free_port())
    yield srv, proxy, target
    proxy.stop()
    srv.stop()


OPFS_SHA = """async (name) => {
  const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('zimi-keep');
  const f = await (await d.getFileHandle(KeepStore.fileBase(name) + '.zim')).getFile();
  const h = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
  return [f.size, [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')];
}"""
META = "async (name) => await KeepStore.list().then(l => l.filter(m => m.name === name)[0] || null)"


def _open_about(pg, proxy):
    pg.goto(proxy.base + "/", wait_until="load")
    pg.wait_for_function(
        "(z) => typeof _zimInfo === 'function' && !!_zimInfo(z)",
        arg=NAME,
        timeout=30000,
    )
    pg.evaluate("(z) => _openZimAbout(z)", NAME)
    pg.wait_for_selector("#zi-keep .keep-btn", timeout=30000)
    pg.evaluate("() => _keepLoad()")


def _start(pg):
    pg.click("#zi-keep .keep-btn")
    pg.wait_for_function(
        "() => /to keep/.test(document.querySelector('#zi-keep').innerText)",
        timeout=30000,
    )
    pg.click("#zi-keep .keep-btn")


def _written(pg):
    return pg.evaluate("() => KeepStore.state().written")


def _wait_written(pg, at_least, timeout_s=60):
    poll(
        pg,
        "() => KeepStore.state().phase === 'pulling' && KeepStore.state().written >= %d"
        % at_least,
        timeout_s,
    )


def test_pause_resume_and_a_replaced_zim(pw, world):
    srv, proxy, target = world
    size = os.path.getsize(target)
    old_sha = _sha(target)
    br = pw.chromium.launch()
    ctx = br.new_context(**_device(pw))
    pg = ctx.new_page()
    _open_about(pg, proxy)

    # 1. Pause part way, then resume to the end.
    _start(pg)
    _wait_written(pg, 15 * 1024 * 1024)
    pg.click("#zi-keep .keep-btn")  # Pause
    pg.wait_for_function(
        "() => /Paused/.test(document.querySelector('#zi-keep').innerText)",
        timeout=20000,
    )
    meta = pg.evaluate(META, NAME)
    assert meta and not meta["complete"] and 0 < meta["written"] < size, meta
    print("\npaused at %.1f of %.1f MB" % (meta["written"] / 1e6, size / 1e6))
    proxy.slow = False
    pg.click("#zi-keep .keep-btn")  # Resume
    pg.wait_for_function(
        "() => /On this phone/.test(document.querySelector('#zi-keep .keep-line')?.innerText || '')",
        timeout=90000,
    )
    got_size, got_sha = pg.evaluate(OPFS_SHA, NAME)
    assert (got_size, got_sha) == (
        size,
        old_sha,
    ), "a resumed pull is the same bytes as the ZIM"

    # 2. Remove, pull again slowly, stop part way; replace the ZIM on the server.
    pg.click("#zi-keep .keep-btn")  # Remove
    pg.wait_for_selector("#zi-keep .keep-btn", timeout=20000)
    assert pg.evaluate(META, NAME) is None
    proxy.slow = True
    pg.wait_for_function(
        "() => /Keep on this phone/.test(document.querySelector('#zi-keep .keep-btn').innerText)"
    )
    _start(pg)
    _wait_written(pg, 10 * 1024 * 1024)
    pg.click("#zi-keep .keep-btn")  # Pause
    pg.wait_for_function(
        "() => /Paused/.test(document.querySelector('#zi-keep').innerText)",
        timeout=20000,
    )
    partial = pg.evaluate(META, NAME)["written"]
    assert 0 < partial < size

    # The ZIM is replaced in place (an auto-update): a different file, same name.
    with open(target, "r+b") as f:
        f.seek(size // 2)
        f.write(b"REPLACED-ON-THE-SERVER" * 8)
    os.utime(target, (time.time() + 5, time.time() + 5))
    new_sha = _sha(target)
    assert new_sha != old_sha
    proxy.slow = False
    pg.click("#zi-keep .keep-btn")  # Resume
    pg.wait_for_function(
        "() => /On this phone/.test(document.querySelector('#zi-keep .keep-line')?.innerText || '')",
        timeout=90000,
    )
    got_size, got_sha = pg.evaluate(OPFS_SHA, NAME)
    assert (
        got_sha == new_sha
    ), "the phone has the NEW file, not the old head spliced to the new tail"
    assert got_sha != old_sha
    print(
        "replaced mid-pull (partial %.1f MB): the phone ended with the new file, byte for byte"
        % (partial / 1e6)
    )
    ctx.close()
    br.close()


def test_a_server_that_blinks_mid_pull_is_waited_for_and_the_pull_finishes(pw, world):
    """The line drops while bytes are coming: the worker retries with backoff,
    asks for the rest by Range when the server is back, and ends with the ZIM."""
    srv, proxy, target = world
    size = os.path.getsize(target)
    sha = _sha(target)
    br = pw.chromium.launch()
    ctx = br.new_context(**_device(pw))
    pg = ctx.new_page()
    _open_about(pg, proxy)
    _start(pg)
    _wait_written(pg, 12 * 1024 * 1024)
    port = proxy.httpd.server_address[1]
    proxy.stop()  # connections reset mid-body, then refused
    pg.wait_for_timeout(2500)
    mid = _written(pg)
    assert mid < size, "the pull was cut off"
    again = SlowProxy(srv.port, port)
    again.slow = False
    try:
        pg.wait_for_function(
            "() => /On this phone/.test(document.querySelector('#zi-keep .keep-line')?.innerText || '')",
            timeout=90000,
        )
    finally:
        again.stop()
    got_size, got_sha = pg.evaluate(OPFS_SHA, NAME)
    assert (got_size, got_sha) == (size, sha)
    print(
        "\ncut off at %.1f MB, back after a blink: finished, byte for byte"
        % (mid / 1e6)
    )
    ctx.close()
    br.close()
