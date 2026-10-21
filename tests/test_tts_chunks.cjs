// Read aloud's chunks: a voice says nothing until a whole chunk is made, so
// the first is short (the reading starts sooner) and the rest are full size.
//
// Run: node tests/test_tts_chunks.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');

// Read aloud's reading is readaloud.js (fetched on first use), the rest app.js;
// readaloud.js first, so its functions are found before app.js's stand-ins.
const src = ['readaloud.js', 'app.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'zimi', 'static', f), 'utf8')).join('\n');
const pick = (re, name) => { const m = src.match(re); if (!m) throw new Error('not found: ' + name); return m[0]; };
eval(pick(/var _TTS_BLOCK = [^\n]*/, '_TTS_BLOCK'));
const _langPrimary = (l) => String(l || '').split(/[-_]/)[0].toLowerCase();
eval(pick(/var _TTS_ABBREVS[\s\S]*?\nfunction _ttsSentenceSpans[\s\S]*?\n}\n/, 'the sentence splitter'));
for (const name of ['_ttsPlanChunks', '_ttsChunkText']) {
  eval(pick(new RegExp('function ' + name + '\\([\\s\\S]*?\\n}'), name));
}
eval(pick(/var _TTS_CHUNK_MAX = [^\n]*/, '_TTS_CHUNK_MAX'));

let failures = 0;
function ok(label, cond, got) { console.log((cond ? '  ok: ' : '  FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(got))); if (!cond) failures++; }

const text = 'The Family Man is a 2000 American romantic fantasy comedy-drama film directed by Brett Ratner. It stars Nicolas Cage and Tea Leoni. '.repeat(4);
const c = _ttsChunkText(text, _TTS_CHUNK_MAX, _TTS_FIRST_CHUNK_MAX);
ok('the first chunk is short', c[0].length <= _TTS_FIRST_CHUNK_MAX, c.map((x) => x.length));
ok('and ends where its sentence does', /\.$/.test(c[0]), c[0]);
ok('the rest are packed up to the full size', c.slice(1, -1).every((x) => x.length > _TTS_FIRST_CHUNK_MAX && x.length <= _TTS_CHUNK_MAX), c.map((x) => x.length));
ok('nothing is lost or repeated', c.join(' ') === text.replace(/\s+/g, ' ').trim());
ok('without a first cap every chunk is full size', _ttsChunkText(text, _TTS_CHUNK_MAX)[0].length > _TTS_FIRST_CHUNK_MAX);

// Sentences as people read them (Eric, 2026-10-20: "Dr. Smith isn't two
// sentences ... there's probably conventions"): the platform's sentence rules,
// then a cut after an abbreviation joined back.
const said = (t, lang) => _ttsSentenceSpans(t, 0, t.length, lang || 'en').map(([a, b]) => t.slice(a, b));
const tricky = 'Is that so? It is. Dr. Smith, who wrote it in 1801, was sure. The U.S. Army left at 5 p.m. on Jan. 3. ' +
  'J. R. R. Tolkien wrote it, e.g. in 1937. It cost $3.50 vs. $4. Mt. Everest is 8,849 m high. He said "Stop." Then he left... ' +
  'And so on! See Fig. 2 and No. 5. It was the end of the st. lawrence trip.';
const got = said(tricky);
const want = ['Is that so?', 'It is.', 'Dr. Smith, who wrote it in 1801, was sure.', 'The U.S. Army left at 5 p.m. on Jan. 3.',
  'J. R. R. Tolkien wrote it, e.g. in 1937.', 'It cost $3.50 vs. $4.', 'Mt. Everest is 8,849 m high.', 'He said "Stop."', 'Then he left...',
  'And so on!', 'See Fig. 2 and No. 5.', 'It was the end of the st. lawrence trip.'];
ok('titles, initials, dotted and listed abbreviations, a date and a decimal stay in their sentence', JSON.stringify(got) === JSON.stringify(want), got);
ok('"?", "!", "..." and a closing quote still end one', said('Why? Because! Wait... "Go." Now.').length === 5, said('Why? Because! Wait... "Go." Now.'));
ok('"I." ends an English sentence, not an initial', said('So did I. Then we left.').length === 2, said('So did I. Then we left.'));
ok('a German abbreviation is known in German', said('Das ist z.B. gut. Nr. 5 ist da.', 'de').length === 2, said('Das ist z.B. gut. Nr. 5 ist da.', 'de'));
ok('Hindi and Arabic sentence marks cut', said('यह एक है। यह दो है।', 'hi').length === 2 && said('ما هذا؟ هذا كتاب.', 'ar').length === 2,
  [said('यह एक है। यह दो है।', 'hi'), said('ما هذا؟ هذا كتاب.', 'ar')]);
ok('a spoken chunk never ends at "Dr."', _ttsChunkText('It is. Dr. Smith was sure. '.repeat(12), _TTS_CHUNK_MAX, _TTS_FIRST_CHUNK_MAX, 'en').every((x) => !/\bDr\.$/.test(x)));

if (failures) { console.log(failures + ' failed'); process.exit(1); }
console.log('\nall chunk checks passed');
