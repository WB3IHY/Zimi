// A ZIM file read in JavaScript, written from the openZIM format description
// (https://wiki.openzim.org/wiki/ZIM_file_format): the 80-byte header, the
// MIME list, the URL and title pointer lists, directory entries, clusters.
// No Kiwix code is used. Clusters compressed with zstd are decoded by fzstd (MIT, bundled
// beside this file as fzstd.js); uncompressed clusters are read in place.
// xz clusters are refused with a ZimUnsupported error, not guessed at.
//
// The reader asks a *source* for bytes: {size, read(offset, length) -> a
// Promise of a Uint8Array}. fileSource wraps a File (an OPFS file on the
// phone), httpSource a URL answered by HTTP Range, bufferSource a Uint8Array
// (the node tests). Nothing is held in memory but a few pages of the pointer
// lists, a few hundred directory entries and a few clusters.
//
// Shared by the service worker (importScripts), the keep worker and the node
// tests (module.exports).
var ZimReader = (function() {
  var MAGIC = 72173914;            // 0x044D495A, little-endian at byte 0
  var HEADER_BYTES = 80;
  var NO_PAGE = 0xFFFFFFFF;        // header mainPage when there is none
  var MIME_REDIRECT = 0xFFFF;      // directory entries that are not content
  var MIME_LINKTARGET = 0xFFFE;
  var MIME_DELETED = 0xFFFD;
  var COMP_NONE = 1, COMP_NONE_OLD = 0, COMP_XZ = 4, COMP_ZSTD = 5;
  var EXTENDED_CLUSTER = 0x10;     // offsets are 8 bytes, not 4
  var ENTRY_PEEK = 512;            // first read of a directory entry
  var ENTRY_MAX = 65536;           // a directory entry is never longer than this
  var PAGE_BYTES = 4096;           // pointer lists are read in pages this size
  var PAGE_CACHE_MAX = 2048;       // pages kept (8 MB)
  var ENTRY_CACHE_MAX = 4096;
  var CLUSTER_CACHE_BYTES = 32 * 1024 * 1024;
  var MAX_REDIRECTS = 8;
  var SEARCH_SCAN_MAX = 200;       // entries looked at per spelling of a query
  var NEW_NAMESPACE_MINOR = 1;     // from 6.1 content lives in one namespace, C
  var TEXT = new TextDecoder('utf-8');
  var ENCODE = new TextEncoder();

  function ZimUnsupported(what) {
    var e = new Error('zim-unsupported: ' + what);
    e.zimUnsupported = what;
    return e;
  }

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  // 64-bit offsets as Numbers: exact below 2^53, which is 8 petabytes.
  function u64(b, o) { return u32(b, o) + u32(b, o + 4) * 4294967296; }

  function indexOfByte(b, v, from) {
    var i = b.indexOf(v, from);
    return i < 0 ? b.length : i;
  }

  // Byte-wise order, which is the order a ZIM sorts in (UTF-8 bytes, not
  // UTF-16 code units).
  function compareBytes(a, b) {
    var n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return a.length === b.length ? 0 : (a.length < b.length ? -1 : 1);
  }
  function startsWith(a, prefix) {
    if (a.length < prefix.length) return false;
    for (var i = 0; i < prefix.length; i++) if (a[i] !== prefix[i]) return false;
    return true;
  }
  function keyOf(ns, bytes) {
    var k = new Uint8Array(bytes.length + 1);
    k[0] = ns;
    k.set(bytes, 1);
    return k;
  }

  // ── Sources ──
  function fileSource(file) {
    return {
      size: file.size,
      read: function(offset, length) {
        var end = Math.min(file.size, offset + length);
        return file.slice(offset, end).arrayBuffer().then(function(ab) { return new Uint8Array(ab); });
      }
    };
  }
  function bufferSource(u8) {
    return {
      size: u8.length,
      read: function(offset, length) {
        return Promise.resolve(u8.subarray(offset, Math.min(u8.length, offset + length)));
      }
    };
  }
  // A URL that answers Range requests (Zimi's /keep/<zim>). `size` is learnt
  // from the first answer's Content-Range.
  function httpSource(url, init) {
    var src = {
      size: 0,
      read: function(offset, length) {
        var headers = Object.assign({}, (init && init.headers) || {},
          { Range: 'bytes=' + offset + '-' + (offset + length - 1) });
        return fetch(url, Object.assign({}, init || {}, { headers: headers })).then(function(r) {
          if (r.status !== 206 && r.status !== 200) throw new Error('zim-http-' + r.status);
          var m = /\/(\d+)$/.exec(r.headers.get('Content-Range') || '');
          if (m) src.size = +m[1];
          return r.arrayBuffer();
        }).then(function(ab) { return new Uint8Array(ab); });
      }
    };
    return src;
  }

  // ── The reader ──
  function ZimReader(source, header, mimes) {
    this.src = source;
    this.h = header;
    this.mimes = mimes;
    this.ns = header.minor >= NEW_NAMESPACE_MINOR ? 0x43 /* C */ : 0x41 /* A */;
    this.pages = new Map();
    this.entries = new Map();
    this.clusters = new Map();     // index -> Uint8Array (decompressed), insertion order = recency
    this.clusterBytes = 0;
    this._main = undefined;
  }

  ZimReader.open = async function(source) {
    var b = await source.read(0, HEADER_BYTES);
    if (b.length < HEADER_BYTES || u32(b, 0) !== MAGIC) throw new Error('zim-not-a-zim');
    var h = {
      major: u16(b, 4), minor: u16(b, 6),
      entryCount: u32(b, 24), clusterCount: u32(b, 28),
      urlPtrPos: u64(b, 32), titlePtrPos: u64(b, 40), clusterPtrPos: u64(b, 48), mimeListPos: u64(b, 56),
      mainPage: u32(b, 64), checksumPos: u64(b, 72)
    };
    if (h.major !== 5 && h.major !== 6) throw ZimUnsupported('version ' + h.major);
    // The MIME list sits between the header and the URL list; each MIME type
    // is a null-terminated string and an empty one ends the list.
    var mb = await source.read(h.mimeListPos, Math.min(65536, Math.max(0, h.urlPtrPos - h.mimeListPos)));
    var mimes = [], at = 0;
    while (at < mb.length) {
      var z = indexOfByte(mb, 0, at);
      if (z === at) break;
      mimes.push(TEXT.decode(mb.subarray(at, z)));
      at = z + 1;
    }
    return new ZimReader(source, h, mimes);
  };

  var P = ZimReader.prototype;

  // A few bytes of a pointer list, through a page cache: the top of a binary
  // search is the same few pages for every query.
  P._ptrBytes = async function(offset, length) {
    var out = new Uint8Array(length), got = 0;
    while (got < length) {
      var at = offset + got, page = Math.floor(at / PAGE_BYTES), within = at - page * PAGE_BYTES;
      var data = this.pages.get(page);
      if (!data) {
        data = await this.src.read(page * PAGE_BYTES, PAGE_BYTES);
        if (this.pages.size >= PAGE_CACHE_MAX) this.pages.delete(this.pages.keys().next().value);
        this.pages.set(page, data);
      }
      var take = Math.min(length - got, data.length - within);
      if (take <= 0) throw new Error('zim-short-read');
      out.set(data.subarray(within, within + take), got);
      got += take;
    }
    return out;
  };

  P._urlPtr = async function(i) { return u64(await this._ptrBytes(this.h.urlPtrPos + 8 * i, 8), 0); };
  P._titleIdx = async function(i) { return u32(await this._ptrBytes(this.h.titlePtrPos + 4 * i, 4), 0); };
  P._clusterPtr = async function(i) { return u64(await this._ptrBytes(this.h.clusterPtrPos + 8 * i, 8), 0); };

  // The directory entry at URL-list index i.
  P.entry = async function(i) {
    var hit = this.entries.get(i);
    if (hit) return hit;
    if (i < 0 || i >= this.h.entryCount) return null;
    var ptr = await this._urlPtr(i);
    var want = ENTRY_PEEK, buf, z1, z2;
    for (;;) {
      buf = await this.src.read(ptr, want);
      var mime = u16(buf, 0);
      var start = (mime === MIME_REDIRECT || mime === MIME_LINKTARGET || mime === MIME_DELETED) ? 12 : 16;
      if (mime === MIME_LINKTARGET || mime === MIME_DELETED) start = 8;
      z1 = buf.indexOf(0, start);
      z2 = z1 < 0 ? -1 : buf.indexOf(0, z1 + 1);
      if (z2 >= 0 || buf.length < want || want >= ENTRY_MAX) break;
      want *= 4;
    }
    var m = u16(buf, 0);
    var isRedirect = m === MIME_REDIRECT, isContent = m < this.mimes.length;
    var s = (m === MIME_LINKTARGET || m === MIME_DELETED) ? 8 : (isRedirect ? 12 : 16);
    if (z1 < 0) z1 = buf.length;
    if (z2 < 0) z2 = buf.length;
    var urlBytes = buf.slice(s, z1), titleBytes = buf.slice(z1 + 1, z2);
    var e = {
      idx: i, nsByte: buf[3],
      mimeIdx: m, mime: isContent ? this.mimes[m] : '',
      redirect: isRedirect ? u32(buf, 8) : -1,
      cluster: isContent ? u32(buf, 8) : -1,
      blob: isContent ? u32(buf, 12) : -1,
      urlBytes: urlBytes, titleBytes: titleBytes.length ? titleBytes : urlBytes
    };
    if (this.entries.size >= ENTRY_CACHE_MAX) this.entries.delete(this.entries.keys().next().value);
    this.entries.set(i, e);
    return e;
  };

  // The first index in [0, n) whose key is >= target, `keyAt(j)` giving the
  // key of the j-th item.
  async function lowerBound(n, target, keyAt) {
    var lo = 0, hi = n;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (compareBytes(await keyAt(mid), target) < 0) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  // The entry for a key (namespace byte + path bytes) in the URL list.
  P._findKey = async function(nsByte, pathBytes) {
    var self = this, target = keyOf(nsByte, pathBytes);
    var i = await lowerBound(this.h.entryCount, target, async function(j) {
      var e = await self.entry(j);
      return keyOf(e.nsByte, e.urlBytes);
    });
    if (i >= this.h.entryCount) return null;
    var e = await this.entry(i);
    return compareBytes(keyOf(e.nsByte, e.urlBytes), target) === 0 ? e : null;
  };

  // The path a page asks for (libzim's: no namespace on a new-scheme ZIM's
  // content, "A/..." and the like on an old one) to the entry that holds it.
  // The same fallbacks the server's /w/ route tries.
  P.lookup = async function(path) {
    var self = this, tried = {};
    var explicit = /^[A-Z\-]\//.test(path);
    var cands = [];
    if (this.h.minor >= NEW_NAMESPACE_MINOR) {
      cands.push([0x43, path]);
      if (explicit) cands.push([path.charCodeAt(0), path.slice(2)]);
    } else {
      if (explicit) cands.push([path.charCodeAt(0), path.slice(2)]);
      else cands.push([0x41, path]);
    }
    var bare = explicit ? path.slice(2) : path;
    ['A', 'I', 'C', '-'].forEach(function(n) { cands.push([n.charCodeAt(0), bare]); });
    for (var k = 0; k < cands.length; k++) {
      var key = cands[k][0] + ':' + cands[k][1];
      if (tried[key]) continue;
      tried[key] = 1;
      var e = await self._findKey(cands[k][0], ENCODE.encode(cands[k][1]));
      if (e) return e;
    }
    return null;
  };

  // The path (in the form /w/<zim>/<path> uses) of an entry.
  P.pathOf = function(e) {
    var url = TEXT.decode(e.urlBytes);
    return (this.h.minor >= NEW_NAMESPACE_MINOR && e.nsByte === 0x43) ? url : String.fromCharCode(e.nsByte) + '/' + url;
  };
  P.titleOf = function(e) { return TEXT.decode(e.titleBytes); };

  // Follow redirects to the entry that holds content.
  P.resolve = async function(e) {
    for (var n = 0; e && e.redirect >= 0 && n < MAX_REDIRECTS; n++) e = await this.entry(e.redirect);
    return e && e.cluster >= 0 ? e : null;
  };

  P.compressionOf = async function(clusterIdx) {
    var b = await this.src.read(await this._clusterPtr(clusterIdx), 1);
    return b[0] & 0x0F;
  };

  // The decompressed bytes of a compressed cluster, kept for the next blob.
  P._cluster = async function(idx, start, end, comp, ext) {
    var hit = this.clusters.get(idx);
    if (hit) { this.clusters.delete(idx); this.clusters.set(idx, hit); return hit; }
    var raw = (await this.src.read(start + 1, end - start - 1));
    var data;
    if (comp === COMP_ZSTD) {
      var zs = (typeof fzstd !== 'undefined' && fzstd) || ZimReader.fzstd;
      if (!zs) throw ZimUnsupported('zstd decoder missing');
      data = zs.decompress(raw);
    } else if (comp === COMP_XZ) {
      throw ZimUnsupported('xz');
    } else {
      throw ZimUnsupported('compression ' + comp);
    }
    this.clusters.set(idx, data);
    this.clusterBytes += data.length;
    while (this.clusterBytes > CLUSTER_CACHE_BYTES && this.clusters.size > 1) {
      var oldest = this.clusters.keys().next().value;
      this.clusterBytes -= this.clusters.get(oldest).length;
      this.clusters.delete(oldest);
    }
    return data;
  };

  // Where a cluster is and how it is stored.
  P._locate = async function(cluster) {
    var start = await this._clusterPtr(cluster);
    var end = cluster + 1 < this.h.clusterCount ? await this._clusterPtr(cluster + 1) : this.h.checksumPos;
    var info = (await this.src.read(start, 1))[0];
    return { start: start, end: end, comp: info & 0x0F, sz: (info & EXTENDED_CLUSTER) ? 8 : 4 };
  };

  // For an uncompressed cluster, where in the file a blob is: {abs, len}.
  P._blobPlace = async function(e, c) {
    var get = c.sz === 8 ? u64 : u32;
    var first = await this.src.read(c.start + 1, c.sz);
    var count = get(first, 0) / c.sz;      // blobs + 1
    if (e.blob + 1 >= count) throw new Error('zim-bad-blob');
    var tab = await this.src.read(c.start + 1 + e.blob * c.sz, c.sz * 2);
    var a = get(tab, 0), b = get(tab, c.sz);
    return { abs: c.start + 1 + a, len: b - a };
  };

  // An entry's bytes.
  P.read = async function(e) {
    var c = await this._locate(e.cluster);
    if (c.comp === COMP_NONE || c.comp === COMP_NONE_OLD) {
      // In place: the offset table, then only the blob asked for.
      var at = await this._blobPlace(e, c);
      return this.src.read(at.abs, at.len);
    }
    var get = c.sz === 8 ? u64 : u32;
    var data = await this._cluster(e.cluster, c.start, c.end, c.comp, c.sz);
    return data.subarray(get(data, e.blob * c.sz), get(data, (e.blob + 1) * c.sz));
  };

  // The title order: the listing a ZIM from 6.1 on keeps as an entry
  // (X/listing/titleOrdered/v1, the front articles by title, as entry numbers),
  // else the old title pointer list (every entry, by namespace and title).
  // Returns {count, at(j) -> entry number}.
  P._titleList = async function() {
    if (this._tl) return this._tl;
    var self = this, e = await this._findKey(0x58, ENCODE.encode('listing/titleOrdered/v1'));
    e = e ? await this.resolve(e) : null;
    if (e) {
      var c = await this._locate(e.cluster);
      if (c.comp === COMP_NONE || c.comp === COMP_NONE_OLD) {
        var at = await this._blobPlace(e, c);
        this._tl = { count: at.len / 4, at: async function(j) { return u32(await self._ptrBytes(at.abs + 4 * j, 4), 0); } };
      } else {
        var data = await this.read(e);
        this._tl = { count: data.length / 4, at: async function(j) { return u32(data, 4 * j); } };
      }
    } else if (this.h.titlePtrPos < this.src.size) {
      this._tl = { count: this.h.entryCount, at: function(j) { return self._titleIdx(j); } };
    } else {
      this._tl = { count: 0, at: async function() { return 0; } };
    }
    return this._tl;
  };

  // The ZIM's front page: the header's, else W/mainPage (a redirect).
  P.main = async function() {
    if (this._main !== undefined) return this._main;
    var e = null;
    if (this.h.mainPage !== NO_PAGE) e = await this.entry(this.h.mainPage);
    if (!e) e = await this._findKey(0x57, ENCODE.encode('mainPage'));
    e = e ? await this.resolve(e) : null;
    this._main = e;
    return e;
  };

  // A metadata value (Title, Description, Language, Name, Date...), as text.
  P.meta = async function(name) {
    var e = await this._findKey(0x4D, ENCODE.encode(name));
    if (!e) return '';
    e = await this.resolve(e);
    return e ? TEXT.decode(await this.read(e)) : '';
  };

  // Spellings of a query to look for: a title index is case sensitive, and a
  // phone's keyboard capitalises the first word at most.
  function spellings(q) {
    var words = q.split(' ');
    var cap = function(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; };
    var all = [
      q,
      cap(q),
      cap(q.toLowerCase()),
      words.map(cap).join(' '),
      words.map(function(w) { return cap(w.toLowerCase()); }).join(' '),
      q.toLowerCase(),
      q.toUpperCase()
    ];
    var seen = {};
    return all.filter(function(s) { return s && !seen[s] && (seen[s] = 1); });
  }

  // Articles whose title starts with the query, by binary search over the
  // title list (sorted by namespace then title). No full text: that is
  // Xapian's index, which this reader does not read. Redirects ("USA") count
  // and are shown as the article they lead to.
  // Returns [{path, title}] and sets .scanned on the array.
  P.search = async function(query, limit) {
    limit = limit || 20;
    var q = (query || '').trim().replace(/\s+/g, ' ');
    var out = [], seen = {}, self = this, tl = await this._titleList(), n = tl.count;
    if (!q || !n) return out;
    var keyAt = async function(j) {
      var e = await self.entry(await tl.at(j));
      return keyOf(e.nsByte, e.titleBytes);
    };
    var variants = spellings(q);
    for (var v = 0; v < variants.length && out.length < limit; v++) {
      var prefix = keyOf(this.ns, ENCODE.encode(variants[v]));
      var j = await lowerBound(n, prefix, keyAt), scanned = 0;
      for (; j < n && scanned < SEARCH_SCAN_MAX && out.length < limit; j++, scanned++) {
        var e = await this.entry(await tl.at(j));
        if (!startsWith(keyOf(e.nsByte, e.titleBytes), prefix)) break;
        var target = await this.resolve(e);
        if (!target || !/^text\/html/.test(target.mime)) continue;
        var path = this.pathOf(target);
        if (seen[path]) continue;
        seen[path] = 1;
        out.push({ path: path, title: this.titleOf(target) });
      }
    }
    return out;
  };

  P.info = async function() {
    return {
      title: await this.meta('Title'), description: await this.meta('Description'),
      language: await this.meta('Language'), entries: this.h.entryCount
    };
  };

  ZimReader.fileSource = fileSource;
  ZimReader.bufferSource = bufferSource;
  ZimReader.httpSource = httpSource;
  ZimReader.ZimUnsupported = ZimUnsupported;
  ZimReader.COMP = { NONE: COMP_NONE, XZ: COMP_XZ, ZSTD: COMP_ZSTD };
  return ZimReader;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ZimReader;
