// Pulls one ZIM from /keep/<zim> into the phone's private file system.
//
// A dedicated worker because Safari writes OPFS only through a synchronous
// access handle, which exists only here. One request streams the rest of the
// file by HTTP Range and writes each chunk where it belongs; the byte count is
// flushed with the file every META_EVERY bytes, so a pull that is cut off (the
// app closed, the phone locked, the signal gone) resumes from what is really
// on disk. If-Range carries the file's ETag: a ZIM replaced on the server in
// the meantime comes back whole, and the pull starts over instead of joining
// two different files.
//
// Messages in:  {cmd: 'pull', name, title, who, headers}  (who: the account it is kept under, '' for none)   {cmd: 'stop'}
// Messages out: {type: 'progress', written, size}  {type: 'done', meta}
//               {type: 'stopped', written, size}   {type: 'error', code, written, size}
// Error codes:  auth (not allowed to keep it), gone (no such ZIM), xz (this
// reader cannot open that compression), quota (the phone is full), locked
// (another copy of this pull holds the file), network (gave up after retries;
// the partial stays for a resume), corrupt (arrived whole but would not open).
var V = (self.location.search || '');   // the worker's own ?v= is the imports' too
importScripts('/static/fzstd.js' + V, '/static/zimreader.js' + V, '/static/keepstore.js' + V);

var META_EVERY = 16 * 1024 * 1024;   // flush and record progress this often
var SAY_EVERY_MS = 250;
var RETRIES = 6;
var BACKOFF_MS = [500, 1500, 4000, 8000, 15000, 30000];
var ABORTED = { aborted: true };

var ctl = null;
var current = { written: 0, size: 0 };

function say(o) { self.postMessage(o); }
function coded(code) { var e = new Error(code); e.code = code; return e; }
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

self.onmessage = function(e) {
  var m = e.data;
  if (m.cmd === 'pull') pull(m);
  else if (m.cmd === 'stop' && ctl) ctl.abort();
};

// Can this reader open what is in the file? Asked of the real file over the
// wire before a byte is stored: the first and last cluster's compression.
async function preflight(url, headers) {
  var src = ZimReader.httpSource(url, { headers: headers, credentials: 'same-origin' });
  var r;
  try { r = await ZimReader.open(src); } catch (e) {
    if (/zim-http-40[13]/.test(e.message)) throw coded('auth');
    if (/zim-http-404/.test(e.message)) throw coded('gone');
    throw e;
  }
  var count = r.h.clusterCount;
  if (!count) return;
  var probes = count > 1 ? [0, count - 1] : [0];
  for (var i = 0; i < probes.length; i++) {
    var comp = await r.compressionOf(probes[i]);
    if (comp !== ZimReader.COMP.NONE && comp !== ZimReader.COMP.ZSTD && comp !== 0) throw coded(comp === ZimReader.COMP.XZ ? 'xz' : 'unsupported');
  }
}

async function pull(m) {
  var name = m.name, url = '/keep/' + encodeURIComponent(name), h = null, d = null;
  try {
    d = await KeepStore.dir(true);
    var meta = await KeepStore.readMeta(d, name);
    if (meta && meta.complete) { say({ type: 'done', meta: meta }); return; }
    var fresh = !meta || !meta.written;
    if (fresh) await preflight(url, m.headers);

    var fh = await d.getFileHandle(KeepStore.fileBase(name) + '.zim', { create: true });
    try { h = await fh.createSyncAccessHandle(); } catch (e) { throw coded('locked'); }
    var written = meta ? Math.min(meta.written || 0, h.getSize()) : 0;
    h.truncate(written);
    var etag = meta ? meta.etag || '' : '', total = meta ? meta.size || 0 : 0;
    ctl = new AbortController();
    var attempt = 0, lastSay = 0;

    while (!total || written < total) {
      var headers = Object.assign({}, m.headers || {});
      if (written > 0) { headers.Range = 'bytes=' + written + '-'; if (etag) headers['If-Range'] = etag; }
      var resp = null;
      try {
        resp = await fetch(url, { headers: headers, credentials: 'same-origin', signal: ctl.signal });
      } catch (e) {
        if (ctl.signal.aborted) throw ABORTED;
        resp = null;
      }
      if (resp && (resp.status === 401 || resp.status === 403)) throw coded('auth');
      if (resp && resp.status === 404) throw coded('gone');
      if (!resp || (resp.status !== 200 && resp.status !== 206)) {
        if (attempt >= RETRIES) throw coded('network');
        await sleep(BACKOFF_MS[attempt++]);
        continue;
      }
      if (resp.status === 200 && written > 0) { written = 0; h.truncate(0); }   // the file changed: start over
      etag = resp.headers.get('ETag') || '';
      var range = /\/(\d+)$/.exec(resp.headers.get('Content-Range') || '');
      total = range ? +range[1] : +resp.headers.get('Content-Length');
      current = { written: written, size: total };
      meta = { name: name, title: m.title, who: m.who || '', icon: !!m.icon, size: total, etag: etag, written: written, complete: false, at: 0 };
      await KeepStore.writeMeta(d, meta);

      var reader = resp.body.getReader(), lastMeta = written;
      try {
        for (;;) {
          var chunk = await reader.read();
          if (chunk.done) break;
          h.write(chunk.value, { at: written });
          written += chunk.value.length;
          attempt = 0;
          current = { written: written, size: total };
          if (written - lastMeta >= META_EVERY) {
            h.flush();
            meta.written = written;
            await KeepStore.writeMeta(d, meta);
            lastMeta = written;
          }
          var now = Date.now();
          if (now - lastSay >= SAY_EVERY_MS) { lastSay = now; say({ type: 'progress', written: written, size: total }); }
        }
      } catch (e) {
        if (ctl.signal.aborted) throw ABORTED;
        if (e && e.name === 'QuotaExceededError') throw coded('quota');
        if (attempt >= RETRIES) throw coded('network');
        h.flush();
        await sleep(BACKOFF_MS[attempt++]);   // the stream broke: ask again from here
      }
    }

    h.flush();
    h.close();
    h = null;
    var file = await (await d.getFileHandle(KeepStore.fileBase(name) + '.zim')).getFile();
    if (file.size !== total) throw coded('corrupt');
    var opened = null;
    try {
      var r = await ZimReader.open(ZimReader.fileSource(file));
      var main = await r.main();
      opened = { main: main ? r.pathOf(main) : '', mainTitle: main ? r.titleOf(main) : '' };
    } catch (e) { throw coded('corrupt'); }
    meta = { name: name, title: m.title, who: m.who || '', icon: !!m.icon, size: total, etag: etag, written: total, complete: true,
             at: Date.now(), main: opened.main, mainTitle: opened.mainTitle };
    await KeepStore.writeMeta(d, meta);
    say({ type: 'done', meta: meta });
  } catch (e) {
    var out = { written: current.written, size: current.size };
    if (e === ABORTED) {
      // Keep what is on disk, and say so, so the pull resumes from it.
      try {
        if (h) { h.flush(); }
        var m2 = await KeepStore.readMeta(d, name);
        if (m2 && !m2.complete) { m2.written = current.written; await KeepStore.writeMeta(d, m2); }
      } catch (x) {}
      say(Object.assign({ type: 'stopped' }, out));
    } else if (e && e.name === 'QuotaExceededError') {
      say(Object.assign({ type: 'error', code: 'quota' }, out));
    } else if (e && e.code === 'corrupt') {
      await KeepStore.remove(name);
      say(Object.assign({ type: 'error', code: 'corrupt' }, out));
    } else {
      say(Object.assign({ type: 'error', code: (e && e.code) || 'network' }, out));
    }
  } finally {
    try { if (h) h.close(); } catch (e) {}
  }
}
