// The service worker remembers which ZIMs are kept (KeepStore.has). A ZIM
// that finishes arriving while that list is being read must not be left out
// for the next half minute: the forget that comes with it wins over the read
// already under way. CI hit this as a PDF library "not on the phone" offline.
//
// Run: node tests/test_keepstore_names.cjs   (exit 0 = pass)

const path = require('path');

let failures = 0;
function ok(label, cond) { console.log((cond ? '  ok: ' : '  FAIL: ') + label); if (!cond) failures++; }

// A private file system whose listing can be held mid-read.
const files = new Map();
let hold = null;
const meta = (name, complete) => files.set(name + '.json', JSON.stringify({ name, complete, at: 1 }));
const dirHandle = {
  async *entries() {
    const snapshot = [...files.entries()];
    if (hold) await hold;
    for (const [k, v] of snapshot) yield [k, { getFile: async () => ({ text: async () => v }) }];
  },
};
global.self = global;
Object.defineProperty(global, 'navigator', { configurable: true, value: { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => dirHandle }) } } });

const KeepStore = require(path.join(__dirname, '..', 'zimi', 'static', 'keepstore.js'));

(async () => {
  meta('wiki', true);
  meta('zimgit-water', false); // still arriving
  let release; hold = new Promise((r) => { release = r; });
  const asking = KeepStore.has('zimgit-water'); // the read starts: water is not done
  await new Promise((r) => setImmediate(r));
  meta('zimgit-water', true); // it finishes...
  KeepStore.forgetNames(); // ...and the worker is told
  hold = null; release();
  ok('the read under way still finds the ZIM that arrived during it', await asking);
  ok('and the next question is not answered by the old list', await KeepStore.has('zimgit-water'));
  ok('a ZIM never kept is not kept', !(await KeepStore.has('nope')));
  if (failures) { console.log(failures + ' failed'); process.exit(1); }
  console.log('\nall kept-names checks passed');
})();
