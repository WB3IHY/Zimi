// A carried ZIM replaced under the same name must not keep answering offline
// with the listing cached from the old archive: the phone's keep-changed
// message fetches each cached /catalog?zim= listing again. Only a fresh answer
// replaces one: offline, the listing a library was kept with stays, or a kept
// library would read empty (test_keep_pdf_live).
//
// Run: node tests/test_sw_catalog_replace.cjs   (exit 0 = pass)
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (label, cond) => { console.log((cond ? '  ok: ' : '  FAIL: ') + label); if (!cond) failures++; };

const cached = new Map([['/catalog?zim=water', 'old water'], ['/catalog?zim=wiki', 'old wiki'], ['/catalog', 'list'], ['/w/water/index.html', 'page']]);
const keyOf = (u) => { const x = new URL(u); return x.pathname + x.search; };
const listeners = {};
global.KeepStore = { forgetNames() { ok.forgot = true; } };
global.self = { addEventListener: (t, f) => { listeners[t] = f; }, KeepStore: global.KeepStore };
global.importScripts = () => {};
global.caches = { open: async () => ({
  keys: async () => [...cached.keys()].map((u) => ({ url: 'http://x' + u })),
  put: async (r, res) => { cached.set(keyOf(r.url), res.body); },
  delete: async (r) => cached.delete(keyOf(r.url)),
}) };
global.URL = URL;
let online = true;
const fetched = [];
global.fetch = async (u) => {
  fetched.push(keyOf(u));
  if (!online) throw new TypeError('offline');
  return { ok: true, body: 'new ' + new URL(u).searchParams.get('zim') };
};
// sw.js declares consts; evaluate it in a function scope so the names stay local.
const src = fs.readFileSync(path.join(__dirname, '..', 'zimi', 'static', 'sw.js'), 'utf8');
(0, eval)(src.replace(/^const /gm, 'var '));

const keepChanged = async () => {
  let waited = null;
  listeners.message({ data: { type: 'keep-changed' }, waitUntil: (p) => { waited = p; } });
  await waited;
};

(async () => {
  await keepChanged();
  ok('the kept names are forgotten', ok.forgot === true);
  ok('each cached catalog listing for a ZIM is fetched again and replaced', cached.get('/catalog?zim=water') === 'new water' && cached.get('/catalog?zim=wiki') === 'new wiki');
  ok('the library list and the ZIM pages are left alone', !fetched.includes('/catalog') && cached.get('/catalog') === 'list' && cached.get('/w/water/index.html') === 'page');
  online = false;
  cached.set('/catalog?zim=water', 'kept water');
  await keepChanged();
  ok('offline, the listing a library was kept with stays', cached.get('/catalog?zim=water') === 'kept water');
  process.exit(failures ? 1 : 0);
})();
