// Read aloud in the server's voices: which engine reads an article, and how
// a reading moves on when an engine is too slow on this server. The
// browser's own voices (speechSynthesis) were all Read aloud had; on Linux
// they are often espeak, or nothing.
//
// Run: node tests/test_tts_server_voices.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'zimi', 'static', 'app.js'), 'utf8');
function extract(re, label) {
  const m = src.match(re);
  if (!m) throw new Error('could not extract ' + label + ' from app.js');
  return m[0];
}
let failures = 0;
function ok(label, cond, detail) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  ' + detail : ''));
  if (!cond) failures++;
}
function fn(name) { return extract(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\r?\\n\\}'), name); }

// ── which engine reads ───────────────────────────────────────────────────
const store = {};
let prefs = { voice: '', off: [] };
const ctx = {
  SK: { TTS_SLOW: 'zimi_tts_slow' },
  _DEVICE_VOICE: 'device',
  _TTS_AVAILABLE: false,
  _ttsVoices: { langs: { en: { engine: 'kokoro', engines: ['kokoro', 'piper'] }, fr: { engine: 'kokoro', engines: ['kokoro'] } } },
  _voicePrefs: () => prefs,
  _langPrimary: tag => String(tag || '').split('-')[0],
  _normLang: c => ({ eng: 'en', fra: 'fr' })[c] || c,
  _getStorageJSON: (k, fb) => (k in store ? JSON.parse(store[k]) : fb),
  _setStorageJSON: (k, v) => { store[k] = JSON.stringify(v); },
};
vm.createContext(ctx);
vm.runInContext(['_ttsServerEngines', '_ttsChosenVoice', '_ttsRowOrder', '_ttsSlowEngines', '_ttsMarkSlow', '_ttsServerSays', '_ttsCanSpeak', '_ttsSpeakUrl'].map(fn).join('\n'), ctx);
const engines = lang => JSON.stringify(ctx._ttsServerEngines(lang));

ok('Automatic: the server\'s choice first, then the rest', engines('en') === '["kokoro","piper"]', engines('en'));
ok('a ZIM\'s three-letter code and a region find the language', engines('eng') === '["kokoro","piper"]' && engines('en-GB') === '["kokoro","piper"]');
prefs = { voice: 'piper', off: [] };
ok('the chosen voice (Clear) reads alone: no engine to give way to', engines('en') === '["piper"]', engines('en'));
prefs = { voice: '', off: ['kokoro'] };
ok('a voice Settings turned off never reads', engines('en') === '["piper"]', engines('en'));
prefs = { voice: 'device', off: [] };
ok('Device: no server voice, the browser reads as before', engines('en') === '[]');
prefs = { voice: '', off: [] };
ok('a language the server cannot say: none', engines('de') === '[]');

ctx._ttsMarkSlow('kokoro');
ctx._ttsMarkSlow('kokoro');
ok('a slow engine is remembered once', store.zimi_tts_slow === '["kokoro"]', store.zimi_tts_slow);
ok('Automatic: a slow engine reads last', engines('en') === '["piper","kokoro"]', engines('en'));
ok('...and still reads when it is the only one', engines('fr') === '["kokoro"]');
prefs = { voice: 'kokoro', off: [] };
ok('a slow engine that was chosen still reads, alone', engines('en') === '["kokoro"]', engines('en'));
prefs = { voice: '', off: [] };

ok('the button shows when only the server can speak', ctx._ttsCanSpeak() === true);
ctx._ttsVoices = { langs: {} };
ok('...and not when nothing can', ctx._ttsCanSpeak() === false);
ctx._TTS_AVAILABLE = true;
ok('...and when only the browser can', ctx._ttsCanSpeak() === true);

const url = ctx._ttsSpeakUrl('A & B?', 'eng', 'piper');
ok('a chunk is asked for as a sentence, in the voice\'s language code', url === '/dictionary/speak?kind=sentence&lang=en&engine=piper&text=A%20%26%20B%3F', url);

// ── a reading ─────────────────────────────────────────────────────────────
// A fake <audio> and clock: the test plays, ends and times out by hand.
const timers = [];
const fetched = [];
class FakeAudio {
  constructor() { this.paused = true; this.src = ''; this.played = []; }
  play() { this.played.push(this.src); return Promise.resolve(); }
  pause() { this.paused = true; }
  getAttribute(n) { return n === 'src' ? this.src : null; }
  removeAttribute() { this.src = ''; }
  load() {}
}
function freshReading() {
  for (const k of Object.keys(store)) delete store[k];
  timers.length = 0; fetched.length = 0;
  const r = { speaking: null, device: null };
  Object.assign(ctx, {
    _ttsAudio: new FakeAudio(), _ttsRun: 1,
    _TTS_SERVER_RETRY_MS: 2000, _TTS_START_WAIT_MS: 6000,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    clearTimeout: id => { if (id) timers[id - 1] = null; },
    authedFetch: u => { fetched.push(u); return new Promise(() => {}); }, // never answers: the server is still saying it
    _ttsSetSpeaking: on => { r.speaking = on; },
    _ttsSpeakDevice: (c, l, from) => { r.device = from; },
  });
  return r;
}
vm.runInContext(fn('_ttsSpeakServer'), ctx);
const engineOf = u => (u.match(/engine=(\w+)/) || [])[1];
const textOf = u => decodeURIComponent((u.match(/text=([^&]*)$/) || [])[1] || '');
const chunks = ['one.', 'two.', 'three.'];

let r = freshReading();
let a = ctx._ttsAudio;
ctx._ttsSpeakServer(chunks, 'en', ['kokoro', 'piper'], 1);
ok('the first chunk plays in the first engine', engineOf(a.src) === 'kokoro' && textOf(a.src) === 'one.', a.src);
a.paused = true;
timers.filter(Boolean).pop().f(); // six seconds and still silent
ok('silent too long: the next engine says it', engineOf(a.src) === 'piper' && textOf(a.src) === 'one.', a.src);
ok('...and the slow one is remembered', store.zimi_tts_slow === '["kokoro"]', store.zimi_tts_slow);
a.paused = false; a.onplaying();
ok('while a chunk plays the next is asked for, in the engine now reading', fetched.length === 1 && engineOf(fetched[0]) === 'piper' && textOf(fetched[0]) === 'two.', fetched[0]);
a.onended(); a.onplaying(); a.onended();
ok('chunks play in turn', textOf(a.src) === 'three.', a.src);
a.onplaying(); a.onended();
ok('the last chunk ends the reading', r.speaking === false);

r = freshReading();
a = ctx._ttsAudio;
ctx._ttsSpeakServer(chunks, 'en', ['piper'], 1);
ok('one engine: no switch is armed', timers.filter(Boolean).length === 0);
a.onplaying();
a.onended(); // "two." was asked for and has not come back: the only engine waits for it
ok('...it waits for a late chunk', engineOf(a.src) === 'piper' && textOf(a.src) === 'two.');
a.onerror();
ok('a failed chunk is tried again after a moment', timers.filter(Boolean).some(t => t.ms === 2000));
timers.filter(t => t && t.ms === 2000).pop().f();
a.onerror();
ok('twice failed: the browser reads the rest, from that chunk', r.device === 1, String(r.device));

r = freshReading();
a = ctx._ttsAudio;
ctx._ttsSpeakServer(chunks, 'en', ['piper'], 1);
ctx._ttsRun = 2; // Stop, or another start
a.onplaying(); a.onended();
ok('a stopped reading does nothing more', fetched.length === 0 && textOf(a.src) === 'one.' && r.speaking === null);

// ── a: voices are asked for on intent, not at page load ──────────────────
ok('nothing asks for the voice list when the page loads', !/^_ttsLoadVoices\(\);/m.test(src));
ok('opening the ... menu is one intent', /function _toggleTopbarMenu[\s\S]*?_ttsPrepare\(\)/.test(src));
ok('Reader View opening is the other, for someone who read aloud lately',
  /function _readerViewApply[\s\S]*?if \(_ttsUsedRecently\(\)\) _ttsPrepare\(\)/.test(src));
ok('speaking does not ask again on every start', !/function _ttsSpeak\(\)[\s\S]*?_ttsLoadVoices\(\)[\s\S]*?\n\}/.test(extract(/function _ttsSpeak\(\) \{[\s\S]*?\r?\n\}/, '_ttsSpeak')));

const intent = { calls: [], now: 1e12, answer: null, rebuilt: 0, topbar: 0, readerOpen: true, speakingOn: true, lang: 'en', posts: [] };
Object.assign(ctx, {
  Date: { now: () => intent.now },
  Promise,
  readerOpen: true,
  _ttsVoices: null,
  _ttsVoicesAt: 0,
  _ttsVoicesBusy: null,
  _ttsWarmed: {},
  _TTS_VOICES_FRESH_MS: 60000,
  _TTS_RECENT_MS: 7 * 86400000,
  _TTS_WARM_ENGINES: ['kokoro', 'piper'],
  updateTopbar: () => { intent.topbar++; },
  _rebuildTopbarMenu: () => { intent.rebuilt++; },
  _speakingOn: () => intent.speakingOn,
  _ttsFrameDoc: () => ({}),
  _ttsLang: () => intent.lang,
  authedFetch: (u, o) => {
    if (o && o.method === 'POST') { intent.posts.push([u, JSON.parse(o.body)]); return Promise.resolve({ ok: true }); }
    intent.calls.push(u);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(intent.answer) });
  },
});
Object.assign(ctx.SK, { TTS_LAST_USE: 'zimi_tts_last_use', TTS_SUGGESTED: 'zimi_tts_suggested' });
vm.runInContext(['_ttsLoadVoices', '_ttsUsedRecently', '_ttsPrepare'].map(fn).join('\n'), ctx);
const reset = () => { for (const k of Object.keys(store)) delete store[k]; Object.assign(intent, { calls: [], posts: [], rebuilt: 0, topbar: 0, speakingOn: true }); ctx._ttsVoices = null; ctx._ttsVoicesAt = 0; ctx._ttsVoicesBusy = null; ctx._ttsWarmed = {}; };
const row = { engine: 'piper', engines: ['piper'] };
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  reset();
  intent.answer = { langs: { en: row } };
  ok('before any intent no request has been made', intent.calls.length === 0);
  ctx._ttsPrepare(); await tick(); await tick();
  ok('the menu opening asks for the list once', intent.calls.length === 1 && intent.calls[0] === '/dictionary/voices', intent.calls.join());
  ok('...and the menu is rebuilt when it arrives, for the Read aloud row', intent.rebuilt === 1 && ctx._ttsVoices && ctx._ttsServerSays());
  ctx._ttsPrepare(); await tick();
  ok('a second open inside a minute asks nothing', intent.calls.length === 1);
  intent.now += 61000;
  ctx._ttsPrepare(); await tick();
  ok('later it asks again (a voice downloaded since is found)', intent.calls.length === 2);
  ok('someone who never read aloud: no warm', intent.posts.length === 0);

  reset();
  intent.answer = { langs: { en: row } };
  store.zimi_tts_last_use = JSON.stringify(intent.now - 86400000);
  ctx._ttsPrepare(); await tick(); await tick();
  ok('read aloud yesterday: the article\'s voice is warmed', intent.posts.length === 1 && intent.posts[0][0] === '/dictionary/voices/warm' && JSON.stringify(intent.posts[0][1].langs) === '["en"]', JSON.stringify(intent.posts));
  ctx._ttsPrepare(); await tick(); await tick();
  ok('...once per language and voice', intent.posts.length === 1);

  reset();
  intent.answer = { langs: { en: row } };
  store.zimi_tts_last_use = JSON.stringify(intent.now - 8 * 86400000);
  ctx._ttsPrepare(); await tick(); await tick();
  ok('last read aloud over a week ago: no warm', intent.posts.length === 0);

  reset();
  intent.answer = { langs: { en: { engine: 'piper', engines: ['piper', 'kokoro'] } } };
  store.zimi_tts_last_use = JSON.stringify(intent.now);
  prefs = { voice: 'kokoro', off: [] };
  ctx._ttsPrepare(); await tick(); await tick();
  ok('warm loads the server\'s own pick, so a different chosen voice is not warmed', intent.posts.length === 0);
  prefs = { voice: '', off: [] };

  reset();
  intent.speakingOn = false;
  ctx._ttsPrepare(); await tick();
  ok('Speaking off: nothing is asked', intent.calls.length === 0);

  // ── b: a chosen voice reads alone, and is offered a faster one ─────────
  let r2 = freshReading();
  let au = ctx._ttsAudio;
  const told = [];
  ctx._ttsSpeakServer(chunks, 'en', ['kokoro'], 1, e => told.push(e));
  ok('a chosen voice still reads first', engineOf(au.src) === 'kokoro' && textOf(au.src) === 'one.');
  au.paused = true;
  timers.filter(Boolean).pop().f(); // six seconds and still silent
  ok('too slow to start: it keeps reading, no switch', engineOf(au.src) === 'kokoro' && textOf(au.src) === 'one.', au.src);
  ok('...is not marked slow', store.zimi_tts_slow === undefined, store.zimi_tts_slow);
  ok('...and the person is told once', told.length === 1 && told[0] === 'kokoro', JSON.stringify(told));
  au.paused = false; au.onplaying(); au.onended();
  ok('a chunk not ready in time is told once more at most', told.length === 1, JSON.stringify(told));

  r2 = freshReading();
  au = ctx._ttsAudio;
  const told2 = [];
  ctx._ttsSpeakServer(chunks, 'en', ['kokoro'], 1, e => told2.push(e));
  au.onplaying(); // chunk 1 plays; two. is asked for and does not come
  au.onended();
  ok('the next chunk late on a chosen voice: offered, still reading it', told2.length === 1 && textOf(au.src) === 'two.' && engineOf(au.src) === 'kokoro' && store.zimi_tts_slow === undefined);

  r2 = freshReading();
  au = ctx._ttsAudio;
  ctx._ttsSpeakServer(chunks, 'en', ['kokoro', 'piper'], 1, null);
  au.paused = true;
  timers.filter(Boolean).pop().f();
  ok('Automatic keeps the switch: the next engine says it', engineOf(au.src) === 'piper' && store.zimi_tts_slow === '["kokoro"]', au.src);

  // the offer itself
  const toasts = [];
  Object.assign(ctx, {
    _showToast: (msg, ms, undo, label) => toasts.push({ msg, ms, undo, label }),
    t: (k, v) => k + (v ? JSON.stringify(v) : ''),
    _voiceEngineName: e => e.toUpperCase(),
    _TTS_SUGGEST_MS: 9000,
    _setVoicePrefs: ch => { prefs = Object.assign({}, prefs, ch); },
  });
  vm.runInContext(fn('_ttsSuggestFaster'), ctx);
  for (const k of Object.keys(store)) delete store[k];
  ctx._ttsVoices = { langs: { en: { engine: 'kokoro', engines: ['kokoro', 'piper'] } } };
  prefs = { voice: 'kokoro', off: [] };
  ctx._ttsSuggestFaster('en', 'kokoro');
  ok('a quiet offer: one line, with a button naming the faster engine', toasts.length === 1 && /KOKORO/.test(toasts[0].msg) && /PIPER/.test(toasts[0].msg) && /PIPER/.test(toasts[0].label), JSON.stringify(toasts));
  toasts[0].undo();
  ok('the button switches Read aloud\'s voice, not the default', prefs.read === 'piper' && prefs.voice === 'kokoro', JSON.stringify(prefs));
  ctx._ttsSuggestFaster('en', 'kokoro');
  ok('once per engine: never nagged again', toasts.length === 1);
  for (const k of Object.keys(store)) delete store[k];
  ctx._ttsVoices = { langs: { en: { engine: 'kokoro', engines: ['kokoro'] } } };
  ctx._ttsSuggestFaster('en', 'kokoro');
  ok('nothing faster to offer: nothing said', toasts.length === 1);

  // ── c: Read aloud's own voice ──────────────────────────────────────────
  prefs = { voice: 'kokoro', off: [] };
  ok('Automatic Read aloud follows the default voice', ctx._ttsChosenVoice() === 'kokoro');
  prefs = { voice: 'kokoro', read: 'piper', off: [] };
  ok('Read aloud\'s own voice wins over the default', ctx._ttsChosenVoice() === 'piper');
  ctx._ttsVoices = { langs: { en: { engine: 'kokoro', engines: ['kokoro', 'piper'] } } };
  ok('...and reads alone', engines('en') === '["piper"]', engines('en'));
  prefs = { voice: 'piper', read: 'device', off: [] };
  ok('Read aloud on Device while the default is a server voice: the browser reads', engines('en') === '[]');
  prefs = { voice: '', read: 'piper', off: ['piper'] };
  ok('a voice Settings turned off is not read with, whatever was picked', engines('en') === '["kokoro"]', engines('en'));

  // the preference itself: kept, shown, saved
  const sandbox = { SK: { VOICE_PREFS: 'zimi_voice_prefs' }, _VOICE_ENGINES: ['kokoro', 'piper', 'say', 'espeak', 'device'], _getStorageJSON: (k, fb) => (k in store ? JSON.parse(store[k]) : fb), _setStorageJSON: (k, v) => { store[k] = JSON.stringify(v); }, localStorage: { removeItem: k => delete store[k] }, _voicesTellDictionary() {}, _paintVoices() {}, esc: x => x, escAttr: x => x, tH: k => k, t: k => k, _voiceEngineName: e => e };
  vm.createContext(sandbox);
  vm.runInContext(['_voicePrefs', '_setVoicePrefs', '_voicePickHtml', '_voiceReadHtml', '_voiceDefaultHtml'].map(fn).join('\n'), sandbox);
  for (const k of Object.keys(store)) delete store[k];
  ok('no Read aloud voice by default (Automatic)', sandbox._voicePrefs().read === undefined);
  sandbox._setVoicePrefs({ read: 'piper' });
  ok('a pick is saved beside the others', JSON.parse(store.zimi_voice_prefs).read === 'piper' && sandbox._voicePrefs().read === 'piper', store.zimi_voice_prefs);
  sandbox._setVoicePrefs({ voice: 'kokoro' });
  ok('the default voice does not lose it', sandbox._voicePrefs().read === 'piper' && sandbox._voicePrefs().voice === 'kokoro');
  sandbox._setVoicePrefs({ read: '' });
  ok('Automatic again forgets it, and an empty preference is not kept', sandbox._voicePrefs().read === undefined && JSON.parse(store.zimi_voice_prefs).read === undefined);
  sandbox._setVoicePrefs({ voice: '' });
  ok('nothing left to say: the key goes', !('zimi_voice_prefs' in store));
  sandbox._setVoicePrefs({ read: 'piper', off: ['piper'] });
  ok('a voice turned off cannot stay Read aloud\'s', sandbox._voicePrefs().read === undefined);
  const html = sandbox._voiceReadHtml([{ engine: 'kokoro' }, { engine: 'piper' }]);
  ok('Settings > Voices has a Read aloud row: Automatic and each voice', /tts_speak/.test(html) && (html.match(/role="radio"/g) || []).length === 3 && /voice-read/.test(html) && /read/.test(html), html.slice(0, 120));
  ok('...hidden with only one voice to choose', sandbox._voiceReadHtml([{ engine: 'piper' }]) === '');
  ok('...and the default row is as it was', /voices_default/.test(sandbox._voiceDefaultHtml([{ engine: 'kokoro' }, { engine: 'piper' }])));

  if (failures) { console.log(failures + ' failed'); process.exit(1); }
  console.log('all passed');
})();
