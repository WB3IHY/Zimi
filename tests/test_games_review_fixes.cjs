// Fixes from CodeRabbit's review of the board games (1.15.0) that need no browser.
//
// Run: node tests/test_games_review_fixes.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'zimi', 'builtin', 'games');
let failures = 0;
const check = (ok, label) => {
  if (ok) console.log('ok: ' + label);
  else { console.error('FAIL: ' + label); failures++; }
};

// EngineKit: giving up on a silent worker answers every request waiting on it, not only the one that timed out.
async function engineKitDrop() {
  class SilentWorker { constructor() { this.terminated = false; } postMessage() {} terminate() { this.terminated = true; } }
  const sandbox = { Worker: SilentWorker, Blob: class {}, URL: { createObjectURL: () => 'blob:x' }, setTimeout, clearTimeout, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(dir, 'enginekit.js'), 'utf8'), sandbox, { filename: 'enginekit.js' });
  const factory = function () { return { handle: function () { return { answered: 'here' }; } }; };
  const c = sandbox.EngineKit.client(factory, 50);
  const got = [];
  c.ask({ n: 1 }, (r) => got.push(['budgeted', r]), 20);   // gives up on the worker after its budget plus the grace
  c.ask({ n: 2 }, (r) => got.push(['unbudgeted', r]));      // no budget: nothing else would ever answer it
  await new Promise((r) => setTimeout(r, 5500));
  check(got.some((g) => g[0] === 'budgeted'), 'enginekit: the request that timed out is answered');
  check(got.some((g) => g[0] === 'unbudgeted'), 'enginekit: a request waiting without a budget is answered when the worker is dropped');
}

engineKitDrop().then(() => process.exit(failures ? 1 : 0));
