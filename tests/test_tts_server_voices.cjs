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
vm.runInContext(['_ttsServerEngines', '_ttsSlowEngines', '_ttsMarkSlow', '_ttsServerSays', '_ttsCanSpeak', '_ttsSpeakUrl'].map(fn).join('\n'), ctx);
const engines = lang => JSON.stringify(ctx._ttsServerEngines(lang));

ok('Automatic: the server\'s choice first, then the rest', engines('en') === '["kokoro","piper"]', engines('en'));
ok('a ZIM\'s three-letter code and a region find the language', engines('eng') === '["kokoro","piper"]' && engines('en-GB') === '["kokoro","piper"]');
prefs = { voice: 'piper', off: [] };
ok('the chosen voice (Clear) reads first', engines('en') === '["piper","kokoro"]', engines('en'));
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
ok('a slow engine that was chosen still reads first', engines('en') === '["kokoro","piper"]', engines('en'));
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

if (failures) { console.log(failures + ' failed'); process.exit(1); }
console.log('all passed');
