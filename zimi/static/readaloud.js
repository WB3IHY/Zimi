// Read aloud: the reading itself, loaded the first time something is read
// (app.js _ttsLoad), or when an article opens for someone who read aloud this
// week. What the page needs before then stays in app.js: whether the button
// shows (_ttsCanSpeak, the voice list), the speed and the measurements that
// Settings > Voices shows. This file's functions replace app.js's stand-ins
// for _ttsToggle, _ttsStop and _ttsSetSpeaking.


// Read aloud in the server's voices (voices.py: Kokoro, Piper, ...) when it
// has one for the article's language, as the Dictionary's Say does: the same
// voice on every device, and a natural one where the browser's own is robotic
// or missing (a Linux browser often has only espeak, or none at all). The
// browser's speechSynthesis stays the fallback, and is used as before when the
// server can say nothing or the viewer chose Device in Settings > Voices.
// Each chunk is one /dictionary/speak?kind=sentence request (chunks are 240
// characters, under voices.SENTENCE_MAX), played by one <audio> element; the
// next chunk is asked for while this one plays, so the server has said it by
// the time it is needed. An engine too slow for that on this server (Kokoro on
// a small NAS takes longer to say a chunk than to play it) gives way to the
// next engine for the language for the rest of the article.
var _TTS_SERVER_RETRY_MS = 2000; // voices.RETRY_AFTER_S: the server was busy
// How long a chunk may take to start before the next engine says it instead.
// Piper says a 240-character chunk in 1 to 3 s on an Intel N150; Kokoro takes
// 18 to 24 s there (2026-10-17), longer than the chunk plays.
var _TTS_START_WAIT_MS = 6000;
var _TTS_CHUNK_MAX = 240, _TTS_FIRST_CHUNK_MAX = 120; // characters
var _TTS_AHEAD = 2; // chunks asked for ahead of the one playing, so the voice never waits
var _ttsAudio = null;
var _ttsRun = 0; // bumped by every start and stop: callbacks of an older run do nothing
var _TTS_SUGGEST_MS = 9000;
// Read aloud may be used soon: have the voice list; and for someone who reads
// aloud (this week), have the server load the article's voice now, so the
// first chunk does not wait for the model (the Dictionary does the same on
// opening). Nothing is fetched or downloaded for it.
var _TTS_WARM_ENGINES = ['kokoro', 'piper']; // the voices that load a model
var _ttsWarmed = {};
// The voice Read aloud reads in when the person chose one: its own (Settings >
// Voices) or else the default there. '' is Automatic.
function _ttsChosenVoice() {
  var p = _voicePrefs();
  return p.read || p.voice;
}
// The server's engines for a language, best first. A chosen voice reads
// alone: it is the person's setting, so it neither gives way mid-read nor is
// marked slow (a slow one is suggested against, _ttsSuggestFaster). Only when
// it cannot say the language does Automatic pick: the server's own choice, then
// the rest, none that Settings turned off, an engine too slow to read with
// here last. Empty when the chosen voice is Device, or the server cannot say
// the language.
function _ttsServerEngines(lang) {
  var langs = (_ttsVoices && _ttsVoices.langs) || {};
  var row = langs[_normLang(_langPrimary(lang))];
  var prefs = _voicePrefs(), chosen = _ttsChosenVoice();
  if (!row || chosen === _DEVICE_VOICE) return [];
  var order = _ttsRowOrder(row, prefs);
  if (chosen && order.indexOf(chosen) >= 0) return [chosen];
  var quick = order.filter(function(e) { return !_ttsTooSlow(e); });
  return quick.concat(order.filter(function(e) { return quick.indexOf(e) < 0; }));
}
// The engines the server has for a language row, its own choice first, none
// that Settings turned off.
function _ttsRowOrder(row, prefs) {
  var order = [row.engine].concat(row.engines || []);
  return order.filter(function(e, i) {
    return e && order.indexOf(e) === i && (row.engines || []).indexOf(e) >= 0 && prefs.off.indexOf(e) < 0;
  });
}
// A server voice for ``lang`` that keeps up at this speed, other than ``slow``; '' when none.
function _ttsFasterThan(lang, slow) {
  var row = ((_ttsVoices && _ttsVoices.langs) || {})[_normLang(_langPrimary(lang))];
  if (!row) return '';
  return _ttsRowOrder(row, _voicePrefs()).filter(function(e) { return e !== slow && !_ttsTooSlow(e); })[0] || '';
}
// Chosen, and not keeping up: once per engine, a quiet offer of another.
function _ttsSuggestFaster(lang, slowEngine) {
  var said = _getStorageJSON(SK.TTS_SUGGESTED, []);
  if (!Array.isArray(said)) said = [];
  if (said.indexOf(slowEngine) >= 0) return;
  var faster = _ttsFasterThan(lang, slowEngine);
  if (!faster) return;
  said.push(slowEngine);
  _setStorageJSON(SK.TTS_SUGGESTED, said);
  _showToast(t('tts_slow_suggest', { slow: _voiceEngineName(slowEngine), fast: _voiceEngineName(faster) }), _TTS_SUGGEST_MS,
    function() { _setVoicePrefs({ read: faster }); }, t('tts_slow_use', { fast: _voiceEngineName(faster) }));
}
function _ttsSlowEngines() {
  var s = _getStorageJSON(SK.TTS_SLOW, []);
  return Array.isArray(s) ? s : [];
}
function _ttsMarkSlow(engine) {
  var s = _ttsSlowEngines();
  if (s.indexOf(engine) < 0) { s.push(engine); _setStorageJSON(SK.TTS_SLOW, s); }
}
// Too slow to read with at this speed: as the server measured it, else as
// this browser found it (a reading that waited for it).
function _ttsTooSlow(engine) {
  var k = _ttsKeepsUp(engine, _ttsRate());
  return k === null ? _ttsSlowEngines().indexOf(engine) >= 0 : !k;
}
function _ttsSpeakUrl(text, lang, engine) {
  return '/dictionary/speak?kind=sentence&lang=' + encodeURIComponent(_normLang(_langPrimary(lang))) +
    '&engine=' + encodeURIComponent(engine) + '&text=' + encodeURIComponent(text);
}

// ``first`` caps the first chunk alone: a voice says nothing until a whole
// chunk is made, so a short one starts the reading sooner.
var _TTS_BLOCK = ' '; // between two blocks of the text that is read: no sentence runs across it
// The sentences of text[from, to) as [start, end) spans, trimmed. They are
// cut as the platform cuts them (Intl.Segmenter: Unicode's sentence rules, so
// quotes, ellipses, ?! and decimals, and CJK, Arabic and Indic marks), then a
// cut after an abbreviation is joined back, as ICU's suppressions and Punkt
// do: those rules alone read "Dr. | Smith", "J. | R. | R. | Tolkien" and
// "Jan. | 3" as sentences (Eric, 2026-10-20: "Dr. Smith isn't two sentences").
// Joining by mistake costs one longer mark; cutting by mistake, a pause.
var _TTS_ABBREVS = (function(lists) {
  var out = {};
  Object.keys(lists).forEach(function(l) { out[l] = {}; lists[l].split(' ').forEach(function(w) { out[l][w] = 1; }); });
  return out;
})({
  en: 'mr mrs ms mx dr prof sr jr st mt ft vs etc approx ca no nos fig figs vol vols ch pp ed eds inc ltd co corp bros gen col lt sgt capt cmdr adm gov sen rep rev hon pres ave blvd rd jan feb mar apr jun jul aug sep sept oct nov dec mon tue wed thu fri sat sun dept univ est op cit al ibid',
  de: 'dr prof nr bzw usw ca evtl ggf vgl sog str abs hr fr jh jhd mio mrd bd',
  fr: 'm mme mlle mm dr pr st ste cf env etc vol chap av bd',
  es: 'sr sra srta dr dra ud uds pág núm av etc vol cap',
  pt: 'sr sra dr dra prof etc pág av vol cap',
  it: 'sig sigra dott prof ecc pag vol cap',
  nl: 'dhr mevr dr prof blz nr bijv enz',
  ru: 'г гг др им ул см тыс млн млрд руб стр т е'
});
var _TTS_INITIAL_NOT = { en: 'I' }; // a one-letter word that ends sentences, not an initial
var _TTS_SAID_END = /[.!?。！？।؟…:;,"'”’»)\]]$/; // a sentence the voice already hears end
var _TTS_SENTENCE_RE = /(?:[^.!?。！？।؟]|\.(?=\d))+[.!?。！？।؟]+(?!\d)["'”’»)\]]*|\S(?:[^.!?。！？।؟]|\.(?=\d))*$/g;
var _ttsSegmenters = {};
function _ttsSegmenter(lang) {
  var key = lang || '';
  if (!(key in _ttsSegmenters)) {
    try { _ttsSegmenters[key] = new Intl.Segmenter(lang || undefined, { granularity: 'sentence' }); }
    catch (e) { _ttsSegmenters[key] = null; } // no Intl.Segmenter (older browsers): the pattern below
  }
  return _ttsSegmenters[key];
}
// [start, end) of each sentence of ``seg``, untrimmed.
function _ttsSegments(seg, lang) {
  var sg = _ttsSegmenter(lang), out = [], m;
  if (sg) {
    for (var it = sg.segment(seg)[Symbol.iterator](), x = it.next(); !x.done; x = it.next()) out.push([x.value.index, x.value.index + x.value.segment.length]);
    return out;
  }
  _TTS_SENTENCE_RE.lastIndex = 0;
  while ((m = _TTS_SENTENCE_RE.exec(seg))) out.push([m.index, m.index + m[0].length]);
  return out;
}
// Whether sentence ``next`` goes on the one before (``prev``, both trimmed):
// it opens in lower case, or ``prev`` ends at one full stop after an
// initial, a dotted abbreviation (U.S., e.g., p.m.) or a listed one.
function _ttsJoinsNext(prev, next, lang) {
  if (!/[^.]\.$/.test(prev)) return false; // "?", "!", "..." and a closing quote end a sentence
  if (/^\p{Ll}/u.test(next)) return true;
  var tok = (prev.match(/(\S+)\.$/) || ['', ''])[1].replace(/^[("'\[«„“‘]+/, '');
  var l = _langPrimary(lang || 'en');
  if (/^\p{Lu}$/u.test(tok)) return tok !== (_TTS_INITIAL_NOT[l] || '');
  if (/\p{L}\.\p{L}/u.test(tok)) return true;
  tok = tok.toLowerCase();
  return !!((_TTS_ABBREVS[l] && _TTS_ABBREVS[l][tok]) || _TTS_ABBREVS.en[tok]);
}
function _ttsSentenceSpans(text, from, to, lang) {
  var out = [];
  for (var a = from; a < to;) {
    var b = text.indexOf(_TTS_BLOCK, a);
    if (b < 0 || b > to) b = to;
    var first = out.length, seg = text.slice(a, b);
    _ttsSegments(seg, lang).forEach(function(r) {
      var s = a + r[0], e = a + r[1];
      while (s < e && /\s/.test(text[s])) s++;
      while (e > s && /\s/.test(text[e - 1])) e--;
      if (s >= e) return;
      var prev = out.length > first ? out[out.length - 1] : null;
      if (prev && _ttsJoinsNext(text.slice(prev[0], prev[1]), text.slice(s, e), lang)) prev[1] = e; else out.push([s, e]);
    });
    a = b + 1;
  }
  return out;
}
// text[from, to) as chunks: {text, spans}, the text a voice says and the
// spans {s, e, n} of the sentences in it (n: characters said, whitespace
// collapsed), so a chunk can be followed back to where it is in ``text``.
function _ttsPlanChunks(text, maxLen, first, from, to, lang) {
  maxLen = maxLen || 240;
  to = to == null ? text.length : to;
  var out = [], buf = null;
  function cap() { return out.length || !first ? maxLen : first; }
  function flush() { if (buf) { out.push(buf); buf = null; } }
  var stop = /^(zh|ja)$/.test(_langPrimary(lang || '')) ? '\u3002' : '.';
  _ttsSentenceSpans(text, from || 0, to, lang).forEach(function(sp) {
    var piece = text.slice(sp[0], sp[1]), s = piece.replace(/\s+/g, ' ');
    // A heading or list item ends where its block does, with no stop of its
    // own: the voice is given one, or it runs on into the next block.
    var gap = text.slice(sp[1], to).match(/^\s*/)[0];
    if (!_TTS_SAID_END.test(s) && (sp[1] + gap.length >= to || gap.indexOf(_TTS_BLOCK) >= 0)) s += stop;
    // A single sentence longer than maxLen: hard-split on word boundaries.
    if (s.length > cap()) {
      flush();
      var line = null, re = /\S+/g, w;
      while ((w = re.exec(piece))) {
        if (line && line.text.length + 1 + w[0].length > cap()) { out.push(line); line = null; }
        if (line) { line.text += ' ' + w[0]; line.spans[0].e = sp[0] + re.lastIndex; line.spans[0].n = line.text.length; }
        else line = { text: w[0], spans: [{ s: sp[0] + w.index, e: sp[0] + re.lastIndex, n: w[0].length }] };
      }
      buf = line; // carry remainder to pack with the next sentence
      return;
    }
    if (buf && buf.text.length + 1 + s.length > cap()) flush();
    var span = { s: sp[0], e: sp[1], n: s.length };
    if (buf) { buf.text += ' ' + s; buf.spans.push(span); } else buf = { text: s, spans: [span] };
  });
  flush();
  return out;
}
function _ttsChunkText(text, maxLen, first, lang) {
  return text ? _ttsPlanChunks(String(text), maxLen, first, 0, null, lang).map(function(c) { return c.text; }) : [];
}
// ── Read along: the sentence being read, marked in the article ──
// The text to read is taken from the article's own text nodes (not innerText),
// each piece keeping its node, so every chunk and sentence maps back to a DOM
// Range. The mark is the CSS Custom Highlight API: the article's DOM is never
// changed, and where the API is missing nothing is marked and nothing breaks.
// Nothing here runs until Read aloud starts.
var _TTS_SKIP_TAGS = ' script style noscript template svg canvas iframe object audio video select ';
var _TTS_HL = 'zimi-tts', _TTS_HL_STYLE = 'zimi-tts-style';
// A quiet amber tint, never the selection's blue: Reader View's own link
// colour of its theme where there is one (light, dark, sepia, black), else amber.
var _TTS_HL_CSS = '::highlight(' + _TTS_HL + '){background-color:rgba(245,158,11,.3)}' +
  '@supports (background-color:color-mix(in srgb,red 50%,transparent)){' +
  '.zimi-reader-active ::highlight(' + _TTS_HL + '){background-color:color-mix(in srgb,var(--rv-link) 26%,transparent)}}' +
  // Night red is a filter on the frame that turns an amber tint into a solid red under red text: a faint light veil instead.
  'html.zimi-tts-night ::highlight(' + _TTS_HL + '){background-color:rgba(255,255,255,.05)}';
var _TTS_NIGHT_CLASS = 'zimi-tts-night';
var _TTS_VIEW_TOP = 56;     // px: a sentence above this has left the view
var _TTS_VIEW_BOTTOM = 120; // px kept clear at the foot, where the reading bar floats
var _TTS_VIEW_AT = 0.28;    // share of the height a sentence is brought up to
var _TTS_HIT_X = 10, _TTS_HIT_Y = 14; // px: a tap this near a sentence's text is on it
var _TTS_SCROLL_KEYS = ' ArrowUp ArrowDown ArrowLeft ArrowRight PageUp PageDown Home End  ';
// Not a tap on text: what a tap does something else with.
var _TTS_TAP_SKIP = 'a[href],button,input,select,textarea,label,summary,video,audio,[contenteditable],.zimi-zoomable,.zimi-img-lightbox,.zb-bar,.zb-sheet,.zb-scrim';
var _ttsRead = null; // the reading in progress: its plan, its document, whether the page follows

// The text of ``main`` as it is read: the text nodes in order (none of script,
// style or hidden text), a _TTS_BLOCK between blocks and at each <br>. A
// piece is a text node and where it starts in the text.
function _ttsReadModel(doc, main) {
  var win = doc.defaultView, parts = [], pieces = [], index = new Map(), len = 0;
  function split() { if (len && parts[parts.length - 1] !== _TTS_BLOCK) { parts.push(_TTS_BLOCK); len++; } }
  function walk(el) {
    var cs = win.getComputedStyle(el), tag = el.localName;
    // A book lays out one section at a time and hides the others: they are still its text.
    if (_TTS_SKIP_TAGS.indexOf(' ' + tag + ' ') >= 0 || (cs.display === 'none' && !el.classList.contains('zb-sec'))) return;
    var block = cs.display.indexOf('inline') !== 0 && cs.display !== 'contents', shown = cs.visibility === 'visible';
    if (block || tag === 'br') split();
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1) walk(n);
      else if (n.nodeType === 3 && shown && n.data) {
        index.set(n, pieces.length);
        pieces.push({ node: n, at: len });
        parts.push(n.data); len += n.data.length;
      }
    }
    if (block) split();
  }
  walk(main);
  return { doc: doc, main: main, text: parts.join(''), pieces: pieces, index: index };
}
// The piece holding offset ``off`` of the text: the last that starts at or before it.
function _ttsPieceAt(model, off) {
  var p = model.pieces, lo = 0, hi = p.length - 1;
  while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (p[mid].at <= off) lo = mid; else hi = mid - 1; }
  return p[lo];
}
// The DOM Range of text[s, e).
function _ttsRange(model, s, e) {
  var a = _ttsPieceAt(model, s), b = _ttsPieceAt(model, e - 1), r = model.doc.createRange();
  r.setStart(a.node, s - a.at); r.setEnd(b.node, e - b.at);
  return r;
}
// Where a point of the DOM is in the text: a text node's own offset, else the
// start of the first text from that point on (the end of the text past it).
function _ttsOffsetOf(model, node, off) {
  var i = model.index.get(node);
  if (i !== undefined) return model.pieces[i].at + off;
  var ref = node.nodeType === 1 ? node.childNodes[off] : node;
  function from(n) {
    if (ref) return ref === n || ref.contains(n) || !!(ref.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
    return !node.contains(n) && !!(node.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  var p = model.pieces, lo = 0, hi = p.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (from(p[mid].node)) hi = mid; else lo = mid + 1; }
  return lo < p.length ? p[lo].at : model.text.length;
}
