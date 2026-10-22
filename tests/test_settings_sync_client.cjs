// Settings sync in the browser (app.js), on users.py's convention: the server
// orders changes and no device clock is asked; a change made signed in is
// pending until the account takes it; coming down, the account wins every key
// it holds that is not pending; a change made signed out stays here; a new
// account is never handed the last one's changes; the first account a
// browser ever follows, if it never held a setting, takes the browser's own
// (from before sync) once, on the keys it lacks.
//
// Runs app.js's own functions in a sandbox whose Date throws: a clock read
// anywhere in the sync is a failure.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'zimi', 'static', 'app.js'), 'utf8');
function grab(re, label) {
  const m = src.match(re);
  if (!m) throw new Error('could not extract ' + label + ' from app.js');
  return m[0];
}
const fn = (name) => grab(new RegExp('\\nfunction ' + name + '\\([^]*?\\n\\}\\n'), name);

let failures = 0;
function ok(label, cond, extra) {
  if (cond) console.log('PASS  ' + label);
  else { failures++; console.log('FAIL  ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}

function browser() {
  const store = {};
  const ctx = {
    console, JSON, Object, Array, String, Promise,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    Blob: class { constructor(parts) { this.size = parts.join('').length; } },
    Date: { now() { throw new Error('a device clock was read'); } },
    timers: [], sent: [], applied: [], answer: null,
    _SAVED_PUSH_MS: 2000, _SAVED_KEEPALIVE_MAX: 60000,
    Saved: { use: () => false }, _savedBase: null,
    _savedChanged() {}, _savedPull() {},
  };
  ctx.setTimeout = (f) => { ctx.timers.push(f); return ctx.timers.length; };
  ctx.clearTimeout = (id) => { if (id) ctx.timers[id - 1] = null; };
  ctx._prefApplied = (keys) => ctx.applied.push(...keys);
  // The server: answers with what the test says it holds after the change.
  ctx.fetch = (url, opts) => {
    ctx.sent.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    const d = typeof ctx.answer === 'function' ? ctx.answer(ctx.sent[ctx.sent.length - 1]) : ctx.answer;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(d) });
  };
  vm.createContext(ctx);
  vm.runInContext([
    grab(/var SK = \{[^]*?\n\};/, 'SK'),
    grab(/var _PREF_KEYS = \[[^]*?\];/, '_PREF_KEYS'),
    fn('_getStorageJSON'),
    'var _accountId = null, _prefPushTimer = null, _prefPushing = null;',
    ...['_isPrefKey', '_rawGet', '_prefState', '_prefSaveState', '_prefChanged', '_prefWrite',
      '_accountSet', '_prefPushSoon', '_prefPush', '_prefTake'].map(fn),
  ].join('\n'), ctx);
  ctx.store = store;
  ctx.fire = async () => { const t = ctx.timers.filter(Boolean); ctx.timers.length = 0; for (const f of t) await f(); await new Promise((r) => setImmediate(r)); };
  return ctx;
}
const settle = () => new Promise((r) => setImmediate(r));
const THEME = 'zimi_reader_theme', LANGS = 'zimi_pref_languages', VIEW = 'zimi_library_view';

(async () => {
  // signed out: a change is this browser's
  {
    const b = browser();
    b._prefWrite(THEME, 'sepia');
    ok('signed out, a change stays here: nothing pending, nothing sent', b.store[THEME] === 'sepia' && !b.timers.filter(Boolean).length && !b.sent.length);
    b._accountSet('kid', true);
    ok('...and signing in later does not make it the account\'s', !Object.keys(b._prefState().pending).length);
  }

  // signed in: pending until taken, with no clock and no loop
  {
    const b = browser();
    b._accountSet('kid', true);
    b._prefState(); // owner set
    b._prefWrite(THEME, 'sepia');
    ok('signed in, a change is pending and goes soon', b._prefState().pending[THEME] === 1 && b.timers.filter(Boolean).length === 1);
    b.answer = { rev: 7, settings: { [THEME]: { v: 'sepia', r: 7 } } };
    await b.fire();
    const body = b.sent[0].body;
    ok('what goes up is the value alone: no time, no revision of this device\'s', b.sent[0].url === '/userdata/settings' && JSON.stringify(body) === JSON.stringify({ changes: { [THEME]: { v: 'sepia' } } }), body);
    ok('taken, it is no longer pending', !Object.keys(b._prefState().pending).length);
    await b.fire();
    ok('and nothing more goes: no loop', b.sent.length === 1, b.sent.length);
  }

  // a change made again while the first was on its way stays pending
  {
    const b = browser();
    b._accountSet('kid', true);
    b._prefWrite(THEME, 'sepia');
    b.answer = () => { b.store[THEME] = 'dark'; return { rev: 1, settings: { [THEME]: { v: 'sepia', r: 1 } } }; };
    await b.fire();
    ok('changed again since it was sent: still pending, and kept', b._prefState().pending[THEME] === 1 && b.store[THEME] === 'dark');
  }

  // coming down: the account wins every key it holds that is not pending
  {
    const b = browser();
    b._accountSet('kid', true);
    b.store[VIEW] = 'list';          // set here signed out, before
    b.store['zimi_reader_family'] = 'serif'; // a key the account lacks
    b._prefWrite(THEME, 'dark');     // pending here
    b._prefTake({ rev: 4, settings: { [VIEW]: { v: 'tiles', r: 2 }, [THEME]: { v: 'sepia', r: 3 }, [LANGS]: { v: null, r: 4 } } });
    ok('the account\'s value is taken', b.store[VIEW] === 'tiles' && b.applied.includes(VIEW));
    ok('a pending change here is not overwritten', b.store[THEME] === 'dark');
    ok('a key the account lacks stays this browser\'s', b.store['zimi_reader_family'] === 'serif');
  }

  // a second account on this browser starts from its own
  {
    const b = browser();
    b._accountSet('alice', true);
    b._prefWrite(THEME, 'dark');
    ok('alice\'s change is pending', b._prefState().pending[THEME] === 1);
    b._accountSet('bob', true);
    ok('bob is not handed alice\'s pending changes', !Object.keys(b._prefState().pending).length && b._prefState().owner === 'bob');
    b._prefTake({ rev: 2, settings: { [THEME]: { v: 'light', r: 2 } } });
    ok('bob\'s account wins every key it holds', b.store[THEME] === 'light');
    b.timers.length = 0;
    await settle();
    ok('nothing of alice\'s goes to bob', !b.sent.length);
  }

  // an account that never held a setting takes this browser's own, once
  {
    const b = browser();
    b.store[LANGS] = '["en","es"]';
    b._accountSet('kid', true);
    b.answer = (req) => ({ rev: 1, settings: { [LANGS]: { v: '["en","es"]', r: 1 } } });
    b._prefTake({ rev: 0, settings: {} });
    await settle(); await settle();
    const first = b.sent[0] && b.sent[0].body;
    ok('first sync: this browser\'s settings fill it', first && first.fill === true && first.changes[LANGS].v === '["en","es"]', first);
    b._prefTake({ rev: 0, settings: {} });
    await settle();
    ok('...once', b.sent.length === 1, b.sent.length);
    b._accountLeave = null;
    b._accountSet('other', true);
    b._prefTake({ rev: 0, settings: {} });
    await settle();
    ok('a browser that followed an account before never fills the next: they were not its own', b.sent.length === 1, b.sent.length);
    const c = browser();
    c.store[LANGS] = '["de"]';
    c._accountSet('kid', true);
    c._prefTake({ rev: 1, settings: { [LANGS]: { v: '["en","es"]', r: 1 } } });
    await settle();
    ok('an account that holds settings is never filled: it wins', !c.sent.length && c.store[LANGS] === '["en","es"]');
  }

  if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
  console.log('all settings-sync client checks passed');
})();
