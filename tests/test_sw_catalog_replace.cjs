// A carried ZIM replaced under the same name must not keep answering offline
// with the listing cached from the old archive: the phone's keep-changed
// message drops the cached /catalog?zim= entries (and only those).
//
// Run: node tests/test_sw_catalog_replace.cjs   (exit 0 = pass)
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (label, cond) => { console.log((cond ? '  ok: ' : '  FAIL: ') + label); if (!cond) failures++; };

const cached = new Set(['/catalog?zim=water', '/catalog?zim=wiki', '/catalog', '/w/water/index.html']);
const keys = () => [...cached].map((u) => ({ url: 'http://x' + u }));
const listeners = {};
global.KeepStore = { forgetNames() { ok.forgot = true; } };
global.self = { addEventListener: (t, f) => { listeners[t] = f; }, KeepStore: global.KeepStore };
global.importScripts = () => {};
global.caches = { open: async () => ({ keys: async () => keys(), delete: async (r) => cached.delete(new URL(r.url).pathname + new URL(r.url).search) }) };
global.URL = URL;
// sw.js declares consts; evaluate it in a function scope so the names stay local.
const src = fs.readFileSync(path.join(__dirname, '..', 'zimi', 'static', 'sw.js'), 'utf8');
(0, eval)(src.replace(/^const /gm, 'var '));

(async () => {
  let waited = null;
  listeners.message({ data: { type: 'keep-changed' }, waitUntil: (p) => { waited = p; } });
  await waited;
  ok('the kept names are forgotten', ok.forgot === true);
  ok('every cached catalog listing for a ZIM is dropped', !cached.has('/catalog?zim=water') && !cached.has('/catalog?zim=wiki'));
  ok('the library list and the ZIM pages stay', cached.has('/catalog') && cached.has('/w/water/index.html'));
  process.exit(failures ? 1 : 0);
})();
