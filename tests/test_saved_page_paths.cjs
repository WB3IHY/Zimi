// A saved page's file name can hold a bare '%' ("Café (50% off).html": Firefox
// names the file for the page's title). The reader read that path back with
// decodeURIComponent, which throws on "% o", and the page never opened.
//
// Run: node tests/test_saved_page_paths.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'zimi', 'static', 'app.js'), 'utf8');
function fn(name) {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\r?\\n\\}'));
  if (!m) throw new Error('could not extract ' + name + ' from app.js');
  return m[0];
}
let failures = 0;
function ok(label, cond, detail) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  ' + detail : ''));
  if (!cond) failures++;
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext([fn('_splitPathFragment'), fn('_decodeSafe'), fn('_titleFromPath')].join('\n'), ctx);

ok('a name with a bare % opens (is titled, does not throw)', (() => {
  try { return ctx._titleFromPath('Café (50% off) – naïve.html') === 'Café (50% off) – naïve.html'; } catch (e) { return false; }
})());
ok('a name with an encoded space is decoded', ctx._titleFromPath('Tea%20-%20Wikipedia.html') === 'Tea - Wikipedia.html');
ok('underscores become spaces as before', ctx._titleFromPath('A/B_c.html') === 'B c.html');
ok('a decodable name is decoded', ctx._decodeSafe('%C3%A9t%C3%A9') === 'été');
ok('an undecodable one is kept as it is', ctx._decodeSafe('50% off') === '50% off');

process.exit(failures ? 1 : 0);
