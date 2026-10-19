// ZIMs kept on this phone: what lives in the browser's private file system
// (OPFS) and how the page, the download worker and the service worker agree on
// it. One file, loaded three ways: by the page (the controls and the storage
// questions), by keepworker.js (the one place bytes are written) and by the
// service worker (answers /w/<zim>/<path> from a kept ZIM when the server does
// not answer). Reading goes through zimreader.js.
//
// Layout, in the directory "zimi-keep": <zim>.zim, the file as it arrives, and
// <zim>.json beside it, which says what it is and how far it got:
//   {name, title, who, source, icon, size, etag, written, complete, at, main, mainTitle}
// `who` is the account it was kept under ('' when none): a sign-in or sign-out
// removes the ones kept under an account (purgeOwned), as it empties the pages
// the worker kept for reading; ZIMs kept with no account stay until removed.
// A ZIM is kept once `complete` is true; before that it is a partial that a
// pull resumes (written is flushed, so it never overstates what is on disk).
//
// Why a worker writes and anyone reads: Safari writes OPFS only through a
// synchronous access handle, which exists only in a worker; reading is a plain
// File (Blob.slice().arrayBuffer()), which works everywhere including the
// service worker, takes no lock and needs no handle.
var KeepStore = (function() {
  var DIR = 'zimi-keep';
  var META_SUFFIX = '.json', ZIM_SUFFIX = '.zim';
  var NAMES_TTL_MS = 30000;      // the service worker's memory of which ZIMs are kept
  var QUOTA_HEADROOM = 0.9;      // never plan to use more than this much of the quota

  var inWindow = typeof window !== 'undefined' && typeof document !== 'undefined';

  function supported() {
    return !!(self.navigator && navigator.storage && navigator.storage.getDirectory);
  }
  // A file name for a ZIM name: names are plain identifiers, but not trusted.
  function fileBase(name) { return encodeURIComponent(name).replace(/%/g, '~'); }

  async function dir(create) {
    var root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(DIR, { create: !!create });
  }

  async function readMeta(d, name) {
    try {
      var fh = await d.getFileHandle(fileBase(name) + META_SUFFIX);
      return JSON.parse(await (await fh.getFile()).text());
    } catch (e) {
      return null;
    }
  }

  // Worker only: the small file is written through a sync handle too.
  async function writeMeta(d, meta) {
    var fh = await d.getFileHandle(fileBase(meta.name) + META_SUFFIX, { create: true });
    var h = await fh.createSyncAccessHandle();
    try {
      var bytes = new TextEncoder().encode(JSON.stringify(meta));
      h.truncate(0);
      h.write(bytes, { at: 0 });
      h.flush();
    } finally {
      h.close();
    }
  }

  // Everything started or finished, newest first.
  async function list() {
    var d;
    try { d = await dir(false); } catch (e) { return []; }
    var out = [];
    for await (var entry of d.entries()) {
      if (entry[0].slice(-META_SUFFIX.length) !== META_SUFFIX) continue;
      try {
        var m = JSON.parse(await (await entry[1].getFile()).text());
        if (m && m.name) out.push(m);
      } catch (e) { /* being written: next time */ }
    }
    out.sort(function(a, b) { return (b.at || 0) - (a.at || 0); });
    return out;
  }
  async function kept() {
    return (await list()).filter(function(m) { return m.complete; });
  }

  // The reader for a kept ZIM, built once per copy of the file (a new copy has
  // a new `at`). The file is a snapshot: a ZIM replaced on disk is a new copy.
  var readers = new Map();
  async function reader(name) {
    var d;
    try { d = await dir(false); } catch (e) { return null; }
    var meta = await readMeta(d, name);
    if (!meta || !meta.complete) { readers.delete(name); return null; }
    var hit = readers.get(name);
    if (hit && hit.at === meta.at) return hit.reader;
    var file = await (await d.getFileHandle(fileBase(name) + ZIM_SUFFIX)).getFile();
    var r = await ZimReader.open(ZimReader.fileSource(file));
    readers.set(name, { at: meta.at, reader: r });
    return r;
  }

  // Which ZIMs are kept, remembered for a little so a page of fifty requests
  // asks the file system once.
  // A list read while a ZIM finished arriving is already old: forgetNames
  // during the read wins, and that read answers its own caller only.
  var names = { at: 0, set: null }, namesGen = 0;
  async function has(name) {
    if (!names.set || Date.now() - names.at > NAMES_TTL_MS) {
      var gen = namesGen, at = Date.now();
      var set = new Set((await kept()).map(function(m) { return m.name; }));
      if (gen === namesGen) names = { at: at, set: set };
      return set.has(name) || (gen !== namesGen && has(name));
    }
    return names.set.has(name);
  }
  function forgetNames() { namesGen++; names = { at: 0, set: null }; }

  async function remove(name) {
    readers.delete(name);
    forgetNames();
    if (inWindow) ftsDrop(name);
    var d;
    try { d = await dir(false); } catch (e) { return; }
    var base = fileBase(name);
    for (var suffix of [ZIM_SUFFIX, META_SUFFIX]) {
      try { await d.removeEntry(base + suffix); } catch (e) { /* not there */ }
    }
  }
  async function purgeOwned() {
    var all = await list();
    await Promise.all(all.filter(function(m) { return m.who; }).map(function(m) { return remove(m.name); }));
  }
  async function purge() {
    var all = await list();
    await Promise.all(all.map(function(m) { return remove(m.name); }));
    try { await (await navigator.storage.getDirectory()).removeEntry(DIR, { recursive: true }); } catch (e) {}
  }

  // ── The page's side: the questions before a pull, and the pull itself ──

  // What this phone will give Zimi, in bytes: the browser's own answer. Safari
  // on iPhone reports a quota and a usage; neither is a promise.
  async function room() {
    var e = (navigator.storage && navigator.storage.estimate) ? await navigator.storage.estimate() : {};
    var quota = e.quota || 0, usage = e.usage || 0;
    return { quota: quota, usage: usage, free: Math.max(0, quota * QUOTA_HEADROOM - usage) };
  }
  // Safari's estimate is rounded and shifted on purpose; it is a guess there.
  function estimateIsFuzzy() {
    var ua = (self.navigator && navigator.userAgent) || '';
    return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|CriOS|FxiOS|Android/.test(ua);
  }
  // Ask the browser not to clear this when the phone runs low. The answer is
  // the browser's to give (Safari decides for a home-screen app on its own).
  async function persist() {
    try {
      if (navigator.storage.persisted && await navigator.storage.persisted()) return true;
      return !!(navigator.storage.persist && await navigator.storage.persist());
    } catch (e) { return false; }
  }
  // How big a ZIM is, and whether this person may keep it, before anything is
  // written: one byte of the real route.
  async function probe(name, headers) {
    var r = await fetch('/keep/' + encodeURIComponent(name), {
      headers: Object.assign({ Range: 'bytes=0-0' }, headers || {}), credentials: 'same-origin'
    });
    if (r.status !== 206 && r.status !== 200) return { ok: false, status: r.status };
    var m = /\/(\d+)$/.exec(r.headers.get('Content-Range') || '');
    // A 206 with no Content-Range says only that its one byte is one byte: that is no size.
    return { ok: true, size: m ? +m[1] : (r.status === 200 ? +r.headers.get('Content-Length') || 0 : 0), etag: r.headers.get('ETag') || '' };
  }

  // One pull at a time, in one worker. `state` is what the controls draw.
  var worker = null, wake = null;
  var state = { name: '', phase: 'idle', written: 0, size: 0, error: '' };
  var listeners = [];
  function emit() { listeners.forEach(function(fn) { try { fn(state); } catch (e) {} }); }
  function subscribe(fn) { listeners.push(fn); return function() { listeners = listeners.filter(function(f) { return f !== fn; }); }; }

  async function holdScreen() {
    try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; }
  }
  function releaseScreen() { try { if (wake) wake.release(); } catch (e) {} wake = null; }

  function stopWorker() { if (worker) { worker.terminate(); worker = null; } releaseScreen(); }

  // KeepStore.workerUrl is set by the app (a versioned address).
  // `size` is the library's byte count, shown as the total from the first frame (the worker takes the server's own
  // figure once it answers). `speed` (bytes/s, smoothed) and `at` (when bytes last arrived) say whether it is moving;
  // `retrying` that the stream broke and the worker is asking again.
  var SPEED_SMOOTHING = 0.3;
  function pull(name, title, headers, who, icon, size) {
    if (worker) return false;
    state = { name: name, phase: 'pulling', written: 0, size: size || 0, error: '', speed: 0, at: Date.now(), retrying: false };
    var sampled = false;
    emit();
    worker = new Worker(KeepStore.workerUrl);
    worker.onmessage = function(e) {
      var m = e.data;
      if (m.type === 'progress' || m.type === 'retrying') {
        // The first message only says where a resumed pull starts: no speed is read from it.
        var now = Date.now(), moved = sampled ? m.written - state.written : 0, dt = (now - state.at) / 1000;
        var speed = state.speed;
        if (m.type === 'progress' && moved > 0 && dt > 0) speed = speed ? speed + SPEED_SMOOTHING * (moved / dt - speed) : moved / dt;
        var first = !sampled;
        if (m.type === 'progress') sampled = true;
        state = { name: name, phase: 'pulling', written: m.written, size: m.size || state.size, error: '',
                  speed: m.type === 'retrying' ? 0 : speed, at: (moved > 0 || first) ? now : state.at, retrying: m.type === 'retrying' };
      } else if (m.type === 'done') {
        stopWorker();
        forgetNames();
        state = { name: name, phase: 'idle', written: m.meta.size, size: m.meta.size, error: '' };
        notifyServiceWorker();
      } else if (m.type === 'stopped') {
        stopWorker();
        state = { name: name, phase: 'idle', written: m.written, size: m.size, error: '' };
      } else if (m.type === 'error') {
        stopWorker();
        state = { name: name, phase: 'idle', written: m.written || 0, size: m.size || 0, error: m.code };
      }
      emit();
    };
    worker.onerror = function() {
      stopWorker();
      state = { name: name, phase: 'idle', written: 0, size: 0, error: 'worker' };
      emit();
    };
    holdScreen();
    worker.postMessage({ cmd: 'pull', name: name, title: title || name, who: who || '', icon: !!icon, size: size || 0, headers: headers || {} });
    return true;
  }
  // A ZIM picked from Files (or iCloud Drive, a USB stick), copied into the
  // phone's storage with no server: the same worker, the same meta, marked
  // source 'files'. A name for it from the file's own.
  function nameFromFile(fileName) {
    return String(fileName || 'zim').replace(/\.zim$/i, '').replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'zim';
  }
  function importFile(file, name, title) {
    if (worker) return false;
    state = { name: name, phase: 'pulling', written: 0, size: file.size, error: '', importing: true };
    emit();
    worker = new Worker(KeepStore.workerUrl);
    worker.onmessage = function(e) {
      var m = e.data;
      if (m.type === 'progress') {
        state = { name: name, phase: 'pulling', written: m.written, size: m.size, error: '', importing: true };
      } else if (m.type === 'done') {
        stopWorker(); forgetNames();
        state = { name: name, phase: 'idle', written: m.meta.size, size: m.meta.size, error: '', importing: true, done: true };
        notifyServiceWorker();
      } else if (m.type === 'stopped') {
        stopWorker();
        state = { name: name, phase: 'idle', written: 0, size: file.size, error: '', importing: true };
      } else if (m.type === 'error') {
        stopWorker();
        state = { name: name, phase: 'idle', written: 0, size: file.size, error: m.code, importing: true };
      }
      emit();
    };
    worker.onerror = function(ev) {
      try { console.warn('keep worker: ' + (ev && ev.message)); } catch (x) {}
      stopWorker();
      state = { name: name, phase: 'idle', written: 0, size: file.size, error: 'worker', importing: true };
      emit();
    };
    holdScreen();
    worker.postMessage({ cmd: 'import', name: name, file: file, title: title || name });
    return true;
  }
  // Stop, keeping what was written: the next pull resumes from it.
  function stop() { if (worker) worker.postMessage({ cmd: 'stop' }); }

  async function removeKept(name) {
    if (state.name === name && worker) { stopWorker(); state = { name: '', phase: 'idle', written: 0, size: 0, error: '' }; }
    await remove(name);
    notifyServiceWorker();
    emit();
  }

  // The service worker remembers which ZIMs are kept for a while: tell it now.
  function notifyServiceWorker() {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'keep-changed' });
      }
    } catch (e) {}
  }

  // ── Full-text search: libzim (with Xapian) in a worker the page owns ──
  //
  // libzim-wasm reads a ZIM through WORKERFS, which exists only in a worker
  // that is handed the File itself, so the page (not the service worker) owns
  // it. Starting one reads the ZIM's index tables: seconds on a big ZIM, so it
  // is started when the page is idle or the search box is touched, and title
  // search (the service worker's reader) answers in the meantime. At most
  // FTS_MAX_WORKERS stay alive (each holds tens of megabytes).
  var FTS_MAX_WORKERS = 2;
  var FTS_INIT_MS = 120000;
  var fts = new Map();            // zim name -> {state, worker, ready, at}

  function workerCall(w, msg, ms) {
    return new Promise(function(resolve, reject) {
      var ch = new MessageChannel(), timer = setTimeout(function() { reject(new Error('timeout')); }, ms || FTS_INIT_MS);
      ch.port1.onmessage = function(e) { clearTimeout(timer); resolve(e.data); };
      w.onerror = function(ev) { clearTimeout(timer); reject(new Error(ev.message || 'worker')); };
      w.postMessage(msg, [ch.port2]);
    });
  }
  function ftsState(name) { var e = fts.get(name); return e ? e.state : 'cold'; }
  function ftsDrop(name) {
    var e = fts.get(name);
    if (e && e.worker) e.worker.terminate();
    fts.delete(name);
  }
  // Start (or find) the worker for a kept ZIM. Resolves when it can search.
  function ftsWarm(name) {
    var hit = fts.get(name);
    if (hit) { hit.at = Date.now(); return hit.ready; }
    var e = { state: 'warming', worker: null, at: Date.now() };
    fts.set(name, e);
    e.ready = (async function() {
      var d = await dir(false);
      var file = await (await d.getFileHandle(fileBase(name) + ZIM_SUFFIX)).getFile();
      e.worker = new Worker(KeepStore.libzimUrl);
      await workerCall(e.worker, { action: 'init', files: [file] });
      e.state = 'ready';
      emit();
      return e;
    })().catch(function(err) {
      e.state = 'failed';
      if (e.worker) e.worker.terminate();
      emit();
      throw err;
    });
    // Make room: the least recently used worker goes.
    if (fts.size > FTS_MAX_WORKERS) {
      var oldest = null;
      fts.forEach(function(v, k) { if (k !== name && (!oldest || v.at < fts.get(oldest).at)) oldest = k; });
      if (oldest) ftsDrop(oldest);
    }
    emit();
    return e.ready;
  }
  // Full-text hits [{path, title}] from one kept ZIM, warming it if need be.
  async function ftsSearch(name, query, limit) {
    var e = await ftsWarm(name);
    e.at = Date.now();
    var r = await workerCall(e.worker, { action: 'search', text: query, numResults: limit || 20 }, 30000);
    return (r && r.results || []).map(function(h) { return { path: h.path, title: h.title }; });
  }
  function ftsForget(name) { ftsDrop(name); }

  return {
    ftsWarm: ftsWarm, ftsSearch: ftsSearch, ftsState: ftsState, ftsForget: ftsForget,
    libzimUrl: '/static/libzim/libzim-wasm.js',
    supported: supported, estimateIsFuzzy: estimateIsFuzzy, fileBase: fileBase, dir: dir, readMeta: readMeta, writeMeta: writeMeta,
    list: list, kept: kept, reader: reader, has: has, forgetNames: forgetNames,
    remove: remove, purge: purge, purgeOwned: purgeOwned, room: room, persist: persist, probe: probe,
    pull: pull, importFile: importFile, nameFromFile: nameFromFile, stop: stop, removeKept: removeKept, subscribe: subscribe,
    state: function() { return state; }, workerUrl: '/static/keepworker.js', inWindow: inWindow
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = KeepStore;
