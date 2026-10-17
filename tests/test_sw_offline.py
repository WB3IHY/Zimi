"""The service worker, offline: what it keeps, and what it says when it cannot reach the server.

Loads the real zimi/static/sw.js in a stubbed ServiceWorker global (node) with
an in-memory Cache Storage and a scripted network, then drives install, fetch
and message the way a browser would:

  1. Install keeps the shell and everything the Almanac and Field Guide need
     (SHELL_URLS, filled in by http.py); one file that cannot be fetched does
     not stop the worker installing.
  2. A navigation with no server is answered by the shell last kept (the exact
     page, else "/"), never by the "restarting" page; a proxy's 502/503/504 is
     not the server speaking either. Only a device that never kept the shell
     sees the offline page, and that page says which of two things is true.
  3. The reader's frame (a navigation too) keeps the article and serves it
     offline; a whole-window navigation to /w/ still gets the shell.
  4. Pages kept for reading are forgotten at sign-in and sign-out, so the next
     person offline is never shown what the last could read.
  5. The Field Guide's answers are never kept (they name the library); its own
     copy of the quotes is.

Run: pytest tests/test_sw_offline.py -v
"""

import json
import os
import re
import shutil
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_HERE = os.path.dirname(os.path.abspath(__file__))
_SW = os.path.join(_HERE, "..", "zimi", "static", "sw.js")

_DRIVER = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync(process.argv[1], 'utf8').replace(
  /const SHELL_URLS = \[\];/, 'const SHELL_URLS = ' + JSON.stringify(SHELL) + ';');
const ORIGIN = 'http://x';

function headers(h) {
  const lower = {}; for (const k of Object.keys(h || {})) lower[k.toLowerCase()] = h[k];
  return { get: (k) => (k.toLowerCase() in lower ? lower[k.toLowerCase()] : null),
           has: (k) => k.toLowerCase() in lower };
}
class FakeResponse {
  constructor(body, o) { o = o || {}; this.body = body; this.status = o.status === undefined ? 200 : o.status;
    this.ok = this.status >= 200 && this.status < 300; this.headers = headers(o.headers); }
  clone() { return new FakeResponse(this.body, { status: this.status, headers: this.rawHeaders }); }
}
function reply(spec) {  // a scripted answer, or a thrown network error
  if (spec === 'down') return Promise.reject(new TypeError('Failed to fetch'));
  const r = new FakeResponse(spec.body === undefined ? 'live' : spec.body, spec);
  r.rawHeaders = spec.headers;
  return Promise.resolve(r);
}

const stores = {};           // cache name -> Map(url -> response)
const store = (n) => stores[n] || (stores[n] = new Map());
const mkCache = (n) => ({
  match: (r, o) => { const u = typeof r === 'string' ? ORIGIN + r : r.url;
    return Promise.resolve(store(n).get(u)); },
  put: (r, resp) => { store(n).set(r.url, resp); return Promise.resolve(); },
  add: (u) => net(new FakeRequest(u)).then((resp) => { if (!resp.ok) throw new TypeError('bad status'); store(n).set(ORIGIN + u, resp); }),
  addAll: (us) => Promise.all(us.map((u) => mkCache(n).add(u))),
  keys: () => Promise.resolve([...store(n).keys()].map((u) => ({ url: u }))),
  delete: (r) => Promise.resolve(store(n).delete(typeof r === 'string' ? r : r.url)),
});
const caches = {
  open: (n) => Promise.resolve(mkCache(n)),
  match: (r) => { const u = typeof r === 'string' ? ORIGIN + r : r.url;
    for (const m of Object.values(stores)) if (m.has(u)) return Promise.resolve(m.get(u));
    return Promise.resolve(undefined); },
  keys: () => Promise.resolve(Object.keys(stores)),
  delete: (n) => { delete stores[n]; return Promise.resolve(true); },
};
class FakeRequest { constructor(u, o) { o = o || {}; this.url = u.startsWith('http') ? u : ORIGIN + u;
  this.method = o.method || 'GET'; this.mode = o.mode || 'cors'; this.destination = o.destination || ''; this.headers = headers(o.headers || {}); } }

const network = {};          // path -> scripted answer ('down' by default when OFFLINE)
const asked = [];
function net(req) {
  const path = new URL(req.url).pathname + new URL(req.url).search;
  asked.push(path);
  if (OFFLINE) return reply('down');
  return reply(network[path] || network[new URL(req.url).pathname] || { body: 'live ' + path });
}

const listeners = {};
const ctx = {
  self: { addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting: () => {},
          clients: { claim: () => Promise.resolve() }, registration: { unregister: () => Promise.resolve() } },
  caches, URL, fetch: net, Response: FakeResponse, setInterval: () => {}, setTimeout, clearTimeout, AbortController, Headers, console, Promise,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const CV = vm.runInContext('CACHE_VERSION', ctx);

async function install() {
  let done; const p = new Promise((r) => { done = r; });
  let waited = Promise.resolve();
  listeners.install({ waitUntil: (x) => { waited = x; } });
  try { await waited; return 'installed'; } catch (e) { return 'failed'; }
}
async function request(url, o) {
  let responded = null;
  const req = new FakeRequest(url, o);
  listeners.fetch({ request: req, respondWith: (p) => { responded = p; }, waitUntil: () => {} });
  if (!responded) return { passed: true };
  const r = await responded;
  return { status: r.status, body: r.body, offline: r.headers.get('X-Zimi-Offline'), passed: false };
}
const keptPaths = () => [...store(CV).keys()].map((u) => u.replace(ORIGIN, ''));

// SCENARIO is a string literal written in this test file, never input.
eval('(async () => {' + SCENARIO + '})()').then((out) => process.stdout.write(JSON.stringify(out)),
  (e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
"""


def _run(scenario, shell=(), offline=False):
    node = shutil.which("node")
    if not node:
        raise unittest.SkipTest("node not available")
    driver = (
        "const SHELL = %s;\nlet OFFLINE = %s;\nconst SCENARIO = %s;\n"
        % (
            json.dumps(list(shell)),
            "true" if offline else "false",
            json.dumps(scenario),
        )
    ) + _DRIVER
    proc = subprocess.run(
        [node, "-e", driver, os.path.abspath(_SW)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
    )
    if proc.returncode != 0:
        raise AssertionError("SW driver failed: " + proc.stderr)
    return json.loads(proc.stdout)


SHELL = [
    "/static/app.js?v=a1",
    "/static/almanac.js?v=a2",
    "/static/fieldguide-offline.json",
]


class TestInstall(unittest.TestCase):
    def test_install_keeps_the_shell_and_what_the_almanac_and_guide_need(self):
        out = _run(
            "const r = await install(); return { r, kept: keptPaths() };", shell=SHELL
        )
        self.assertEqual(out["r"], "installed")
        for u in ["/"] + SHELL:
            self.assertIn(u, out["kept"])

    def test_one_file_that_cannot_be_had_does_not_stop_the_install(self):
        # Failing the install would leave a phone with no worker at all.
        out = _run(
            "network['/static/almanac.js'] = { status: 404 };"
            "const r = await install(); return { r, kept: keptPaths() };",
            shell=SHELL,
        )
        self.assertEqual(out["r"], "installed")
        self.assertIn("/static/app.js?v=a1", out["kept"])
        self.assertNotIn("/static/almanac.js?v=a2", out["kept"])


class TestNavigationWithNoServer(unittest.TestCase):
    PRIME = "await install();"

    def test_a_navigation_is_answered_by_the_shell_last_kept(self):
        out = _run(
            self.PRIME + "OFFLINE = true;"
            "return [await request('/', { mode: 'navigate', destination: 'document' }),"
            " await request('/?q=water', { mode: 'navigate', destination: 'document' }),"
            " await request('/#almanac', { mode: 'navigate', destination: 'document' })];",
            shell=SHELL,
        )
        for r in out:
            self.assertEqual(r["status"], 200, r)
            self.assertEqual(r["body"], "live /", "the kept shell, not an offline page")
            self.assertIsNone(r["offline"])

    def test_a_proxy_answering_for_a_dead_server_is_not_the_server(self):
        for status in (502, 503, 504):
            out = _run(
                self.PRIME
                + "network['/'] = { status: %d, headers: { 'Content-Type': 'text/html' }, body: 'proxy' };"
                "return await request('/', { mode: 'navigate', destination: 'document' });"
                % status,
                shell=SHELL,
            )
            self.assertEqual(out["status"], 200, status)
            self.assertEqual(out["body"], "live /", status)

    def test_a_json_503_from_the_app_itself_passes_through(self):
        out = _run(
            "network['/health'] = { status: 503, headers: { 'Content-Type': 'application/json' }, body: 'setup' };"
            "return await request('/health');"
        )
        self.assertEqual(out["status"], 503)
        self.assertEqual(out["body"], "setup")

    def test_only_a_device_that_never_kept_the_shell_sees_the_offline_page(self):
        out = _run(
            "OFFLINE = true; return await request('/', { mode: 'navigate', destination: 'document' });"
        )
        self.assertEqual(out["status"], 503)
        self.assertEqual(out["offline"], "1")
        self.assertIn(
            "navigator.onLine", out["body"], "the page tells the two apart itself"
        )

    def test_the_offline_page_never_claims_a_restart_it_cannot_know_about(self):
        out = _run(
            "OFFLINE = true; return await request('/', { mode: 'navigate', destination: 'document' });"
        )
        self.assertNotIn("restarting", out["body"].lower())
        self.assertIn("offline_title_nonet", out["body"])
        self.assertIn("offline_title_server", out["body"])

    def test_the_offline_page_script_is_valid_and_decides_by_the_browser(self):
        """The page runs in a browser; here it runs with a stub DOM, once with
        the device offline and once online, and says the two different things."""
        node = shutil.which("node")
        if not node:
            self.skipTest("node not available")
        script = r"""
const fs = require('node:fs');
const src = fs.readFileSync(process.argv[1], 'utf8');
const html = eval('`' + src.match(/const OFFLINE_HTML = `([\s\S]*?)`;/)[1] + '`');
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function run(onLine, kept) {
  const els = {}; const el = (id) => els[id] || (els[id] = { textContent: '' });
  const store = kept ? { zimi_ui_lang: 'de', zimi_i18n_kept_de: JSON.stringify(kept) } : {};
  new Function('document', 'navigator', 'localStorage', 'window', 'setInterval', 'fetch', 'location', js)(
    { getElementById: el }, { onLine, language: 'en-US' }, { getItem: (k) => store[k] || null },
    { addEventListener() {} }, () => {}, () => Promise.resolve({}), { reload() {} });
  return [els.h.textContent, els.p.textContent, els.b.textContent];
}
process.stdout.write(JSON.stringify({
  nonet: run(false), server: run(true),
  german: run(false, { offline_title_nonet: 'Sie sind offline', conn_retry: 'Erneut versuchen' }),
}));
"""
        proc = subprocess.run(
            [node, "-e", script, os.path.abspath(_SW)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        got = json.loads(proc.stdout)
        self.assertEqual(got["nonet"][0], "You're offline")
        self.assertEqual(got["server"][0], "Can't reach your Zimi server")
        self.assertNotEqual(got["nonet"][1], got["server"][1])
        self.assertEqual(
            got["german"][0],
            "Sie sind offline",
            "the words the app kept for the language",
        )
        self.assertEqual(got["german"][2], "Erneut versuchen")


class TestKeptReading(unittest.TestCase):
    ART = "/w/wiki/Hypothermia"

    def test_the_readers_frame_keeps_the_article_and_serves_it_offline(self):
        out = _run(
            "await install();"
            "const online = await request('%s', { mode: 'navigate', destination: 'iframe' });"
            "const kept = keptPaths();"
            "OFFLINE = true;"
            "const off = await request('%s', { mode: 'navigate', destination: 'iframe' });"
            "return { online, kept, off };" % (self.ART, self.ART),
            shell=SHELL,
        )
        self.assertIn(self.ART, out["kept"])
        self.assertEqual(out["off"]["status"], 200)
        self.assertEqual(out["off"]["body"], "live " + self.ART)

    def test_a_whole_window_navigation_to_an_article_still_gets_the_shell(self):
        out = _run(
            "await install(); OFFLINE = true;"
            "return await request('%s', { mode: 'navigate', destination: 'document' });"
            % self.ART,
            shell=SHELL,
        )
        self.assertEqual(out["body"], "live /")

    def test_an_article_not_kept_says_so_instead_of_pretending(self):
        out = _run(
            "await install(); OFFLINE = true;"
            "return await request('/w/wiki/Never_read', { mode: 'navigate', destination: 'iframe' });",
            shell=SHELL,
        )
        self.assertEqual(out["status"], 503)
        self.assertEqual(out["offline"], "1")

    def test_a_proxys_error_page_does_not_replace_a_kept_article(self):
        out = _run(
            "await install();"
            "await request('%s', { mode: 'navigate', destination: 'iframe' });"
            "network['%s'] = { status: 502, headers: { 'Content-Type': 'text/html' }, body: 'proxy' };"
            "return await request('%s', { mode: 'navigate', destination: 'iframe' });"
            % (self.ART, self.ART, self.ART),
            shell=SHELL,
        )
        self.assertEqual(out["body"], "live " + self.ART)

    def test_signing_in_or_out_forgets_what_was_kept_for_reading(self):
        for path in ("/login", "/logout"):
            out = _run(
                "await install();"
                "await request('%s', { mode: 'navigate', destination: 'iframe' });"
                "await request('/w/wiki/img.png');"
                "const before = keptPaths();"
                "await request('%s', { method: 'POST' });"
                "return { before, after: keptPaths() };" % (self.ART, path),
                shell=SHELL,
            )
            self.assertIn(self.ART, out["before"])
            self.assertNotIn(self.ART, out["after"], path)
            self.assertNotIn("/w/wiki/img.png", out["after"], path)
            # The shell and the Almanac are not anyone's: they stay.
            self.assertIn("/static/app.js?v=a1", out["after"], path)
            self.assertIn("/", out["after"], path)

    def test_a_failed_sign_in_keeps_what_was_kept(self):
        out = _run(
            "await install();"
            "await request('%s', { mode: 'navigate', destination: 'iframe' });"
            "network['/login'] = { status: 401, body: 'no' };"
            "await request('/login');"
            "return keptPaths();" % self.ART,
            shell=SHELL,
        )
        self.assertIn(self.ART, out)


class TestFieldGuideKept(unittest.TestCase):
    def test_the_guides_answers_are_never_kept_but_its_own_copy_is(self):
        out = _run(
            "await install();"
            "for (const p of ['/fieldguide', '/fieldguide/situation?id=choking', '/fieldguide/match?q=x', '/fieldguide/library'])"
            "  await request(p);"
            "const kept = keptPaths();"
            "OFFLINE = true;"
            "return { kept, copy: await request('/static/fieldguide-offline.json'),"
            "         answer: await request('/fieldguide/situation?id=choking') };",
            shell=SHELL,
        )
        self.assertFalse([p for p in out["kept"] if p.startswith("/fieldguide")])
        self.assertEqual(out["copy"]["status"], 200, "the copy answers with no server")
        self.assertEqual(out["answer"]["offline"], "1", "the page then reads its copy")


class TestServerFillsTheShellList(unittest.TestCase):
    def test_served_worker_names_the_addresses_the_pages_ask_for(self):
        from zimi import http

        with open(_SW, encoding="utf-8") as f:
            raw = f.read()
        self.assertIn("const SHELL_URLS = [];", raw, "the source file is the template")
        urls = http._offline_shell_urls()
        # The Almanac's scripts at the addresses the shell asks for, with their hashes.
        for name in (
            "almanac.js",
            "almanac-sky.js",
            "app.js",
            "app.css",
            "fieldguide.html",
            "zone-places.js",
        ):
            self.assertTrue(
                any(
                    re.match(r"/static/%s\?v=[0-9a-f]{8}$" % re.escape(name), u)
                    for u in urls
                ),
                name,
            )
        self.assertIn("/static/fieldguide-offline.json", urls)
        self.assertIn("/static/earth/moon-v1.webp", urls)
        # The big pictures are kept the first time they are opened, not at install.
        self.assertFalse(
            [u for u in urls if "three" in u or "earth-day" in u or "moon-4k" in u]
        )

    def test_the_worker_a_browser_is_sent_carries_the_list_and_this_deploys_version(self):
        import threading
        import urllib.request
        from http.server import ThreadingHTTPServer

        from zimi import http

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), http.ZimHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            url = "http://127.0.0.1:%d/static/sw.js" % httpd.server_address[1]
            with urllib.request.urlopen(url, timeout=10) as r:
                served = r.read().decode("utf-8")
        finally:
            httpd.shutdown()
        m = re.search(r"const SHELL_URLS = (\[[^\]]*\]);", served)
        self.assertTrue(m, "the served worker has its list")
        self.assertEqual(json.loads(m.group(1)), http._offline_shell_urls())
        self.assertIn(http._asset_version(), served)
        self.assertNotIn("const SHELL_URLS = [];", served)


if __name__ == "__main__":
    unittest.main()
