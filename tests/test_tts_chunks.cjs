// Read aloud's chunks: a voice says nothing until a whole chunk is made, so
// the first is short (the reading starts sooner) and the rest are full size.
//
// Run: node tests/test_tts_chunks.cjs   (exit 0 = pass)

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'zimi', 'static', 'app.js'), 'utf8');
const pick = (re, name) => { const m = src.match(re); if (!m) throw new Error('not found: ' + name); return m[0]; };
eval(pick(/var _TTS_BLOCK = [^\n]*/, '_TTS_BLOCK'));
eval(pick(/var _TTS_ABBREV = [^\n]*/, '_TTS_ABBREV'));
for (const name of ['_ttsSentenceSpans', '_ttsPlanChunks', '_ttsChunkText']) {
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

if (failures) { console.log(failures + ' failed'); process.exit(1); }
console.log('\nall chunk checks passed');
