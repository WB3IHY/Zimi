// A catalog row offers Update only for a ZIM Zimi owns.
//
// A ZIM in a folder another program owns (Project NOMAD) is read in place and
// never updated by Zimi: Update would download a second full copy into Zimi's
// own library beside the original.
//
// Run: node tests/test_library_folders_ui.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'zimi', 'static', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
let failures = 0;
function ok(label, cond) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) failures++;
}

const m = src.match(/function _catalogHasUpdate\(inst, upd\) \{[\s\S]*?\n\}\n/);
if (!m) throw new Error('app.js has no _catalogHasUpdate');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[0] + '\nthis.f = _catalogHasUpdate;', ctx);
const has = ctx.f;

const newer = { date: '2026-03-01', download_url: 'https://x/y_2026-03.zim' };
ok('an owned ZIM with a newer edition offers Update', has({ _installedDate: '2026-01' }, newer) === true);
ok('the same date offers nothing', has({ _installedDate: '2026-03' }, newer) === false);
ok('a ZIM in another program\'s folder never offers Update', has({ _installedDate: '2026-01', _installedExternal: 'Project NOMAD' }, newer) === false);
ok('no download link offers nothing', has({ _installedDate: '2026-01' }, { date: '2026-03-01' }) === false);
ok('the catalog row asks the function', /const hasUpdate = _catalogHasUpdate\(instVariant, updVariant\);/.test(src));

process.exit(failures ? 1 : 0);
