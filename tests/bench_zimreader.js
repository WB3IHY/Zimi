// Cold-open and search timings of zimreader.js over a real file read through
// the file system (each read is an async positioned read, as Blob.slice is).
//
//   node tests/bench_zimreader.js <file.zim> [query ...]
//
// Prints: open, main page, the first article after open, and each title search
// (first run cold, then warm: the pointer-list pages are cached after the first).
const fs = require('node:fs');
const path = require('node:path');
const ZimReader = require(path.join(__dirname, '..', 'zimi', 'static', 'zimreader.js'));
ZimReader.fzstd = require(path.join(__dirname, '..', 'zimi', 'static', 'fzstd.js'));

function fileSource(file) {
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size;
  let reads = 0;
  return {
    size, reads: () => reads,
    read: (offset, length) => new Promise((resolve, reject) => {
      reads++;
      const n = Math.min(length, size - offset), buf = Buffer.allocUnsafe(n);
      fs.read(fd, buf, 0, n, offset, (err, got) => err ? reject(err) : resolve(new Uint8Array(buf.buffer, buf.byteOffset, got)));
    })
  };
}
const ms = (t) => (performance.now() - t).toFixed(1) + ' ms';

(async () => {
  const file = process.argv[2], queries = process.argv.slice(3);
  const src = fileSource(file);
  let t = performance.now();
  const r = await ZimReader.open(src);
  console.log('open:', ms(t), ' entries', r.h.entryCount, ' clusters', r.h.clusterCount, ' size', (src.size / 1e6).toFixed(1), 'MB');
  t = performance.now();
  const main = await r.main();
  console.log('main page entry:', ms(t), main ? r.pathOf(main) : '(none)');
  if (main) {
    t = performance.now();
    const bytes = await r.read(main);
    console.log('first article (cold cluster):', ms(t), bytes.length, 'bytes', main.mime);
  }
  for (const q of queries) {
    for (const pass of ['cold', 'warm']) {
      const before = src.reads();
      t = performance.now();
      const hits = await r.search(q, 20);
      console.log('title search "' + q + '" (' + pass + '):', ms(t), hits.length, 'hits,', src.reads() - before, 'reads', hits[0] ? '-> ' + hits[0].title : '');
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
