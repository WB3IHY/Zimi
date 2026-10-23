// Signing in as a limited user while the clean home page is already drawn must draw it again from the
// new (filtered) list. goHome() on a clean home only scrolls to the top, so the anonymous library stayed
// on screen until a reload.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'zimi', 'static', 'app.js'), 'utf8').replace(/\r\n/g, '\n'); // a Windows checkout's line ends
const m = src.match(/async function _refreshAfterAuthChange\(\) \{[\s\S]*?\n\}\n/);
if (!m) { console.log('FAIL _refreshAfterAuthChange not found'); process.exit(1); }
let failures = 0;
const check = (ok, what) => { if (!ok) failures++; console.log((ok ? 'ok   ' : 'FAIL ') + what); };
async function run(state) {
  const calls = [];
  const env = Object.assign({
    zimsCache: null, _fetchList: async () => [{ name: 'allowed' }], _rebuildZimsMap() {}, _libraryKnown: false,
    _noteConnFailure() {}, _renderConnBanner() {}, readerOpen: false, currentSource: null, homeScope: null,
    renderHome() { calls.push('renderHome'); },
    goHome() { calls.push('goHome'); }, route() { calls.push('route'); },
  }, state);
  const names = Object.keys(env);
  const fn = new Function(...names, m[0].replace('async function _refreshAfterAuthChange', 'return async function') );
  await fn(...names.map((n) => env[n]))();
  return calls;
}
(async () => {
  check((await run({ mode: 'home' })).join() === 'renderHome', 'clean home, signed in: drawn again from the new list');
  check((await run({ mode: 'home', readerOpen: true })).join() === 'goHome', 'an open reader still goes home');
  check((await run({ mode: 'manage' })).join() === 'goHome', 'from Manage it goes home');
  if (failures) process.exit(1);
})();
