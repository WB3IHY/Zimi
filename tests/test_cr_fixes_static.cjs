// Review fixes pinned against the shipped files (Escape focus, RTL speed slider).
// Run: node tests/test_cr_fixes_static.cjs   (exit 0 = pass)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const STATIC = path.join(__dirname, '..', 'zimi', 'static');
const read = (f) => fs.readFileSync(path.join(STATIC, f), 'utf8');
let failures = 0;
const check = (ok, label) => { if (!ok) { console.error('FAIL: ' + label); failures++; } };

// The speed slider sits inside the always-LTR bar: no RTL overrides on its fill or marks.
const css = read('app.css');
check(/\.tts-bar \{ direction: ltr/.test(css), 'the bar is direction: ltr');
check(!/\[dir="rtl"\][^{]*tts-speed/.test(css), 'no [dir=rtl] override on the speed slider or its marks');

// Escape from inside Earth's settings returns focus to the gear.
const src = read('almanac.js');
const body = src.slice(src.indexOf('var _almDismissables'), src.indexOf('function _almDismissX'));
const listeners = {};
let focused = null;
const gear = { focus() { focused = 'gear'; } };
const radio = {};
const panel = { getClientRects: () => [1], contains: (n) => n === radio };
const doc = {
  activeElement: radio,
  addEventListener: (t, f) => { listeners[t] = f; },
  getElementById: (id) => (id === 'ae-set' ? panel : id === 'ae-gear' ? gear : null),
};
let hidden = 0;
const ctx = { document: doc, console, __hide: () => { hidden++; } };
vm.createContext(ctx);
vm.runInContext(body, ctx);
vm.runInContext("_almDismissable('ae-set', function () { __hide(); }, null, 'ae-gear');", ctx);
listeners.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
check(hidden === 1, 'Escape hides the settings panel');
check(focused === 'gear', 'Escape from a settings control focuses #ae-gear');
process.exit(failures ? 1 : 0);
