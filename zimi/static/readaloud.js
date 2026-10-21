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
// What is selected in the article, as [start, end) of the text, or null.
function _ttsSelectedSpan(model) {
  var win = model.doc.defaultView, sel = win && win.getSelection && win.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  var r = sel.getRangeAt(0);
  var a = _ttsOffsetOf(model, r.startContainer, r.startOffset), b = _ttsOffsetOf(model, r.endContainer, r.endOffset);
  return a < b && /\S/.test(model.text.slice(a, b).replace(_TTS_BLOCK, '')) ? [a, b] : null;
}
// Which sentence of a chunk is being said ``ch`` characters into what the
// voice says of it.
function _ttsSpanAtChar(chunk, ch) {
  var pos = 0;
  for (var i = 0; i < chunk.spans.length; i++) {
    pos += chunk.spans[i].n;
    if (ch < pos) return i;
    pos++; // the space the chunk joins its sentences with
  }
  return chunk.spans.length - 1;
}
// The sentence of the text at offset ``off`` (the next, when it is between two),
// as {s, e}: the sentences of its block, so a tap costs one block, not the article.
function _ttsSentenceAt(model, off) {
  var t = model.text, hit = null;
  off = Math.min(off, t.length - 1);
  var a = t.lastIndexOf(_TTS_BLOCK, off - 1) + 1, b = t.indexOf(_TTS_BLOCK, off);
  var sp = _ttsSentenceSpans(t, a, b < 0 ? t.length : b, _ttsLang(model.doc));
  for (var i = 0; i < sp.length; i++) {
    hit = { s: sp[i][0], e: sp[i][1] };
    if (sp[i][1] > off) break;
  }
  return hit;
}
// How far to scroll (px, down is positive) to keep a sentence in view of a
// ``h`` px tall window: none while it is inside, else its top is brought up
// to a quarter or so of the way down (so the page moves once per screenful,
// not once per sentence).
function _ttsScrollBy(rect, h) {
  if (rect.top >= _TTS_VIEW_TOP && rect.bottom <= h - _TTS_VIEW_BOTTOM) return 0;
  return Math.round(rect.top - h * _TTS_VIEW_AT);
}
// Whether a point is on the text of a sentence's rects, give or take a line's gap.
function _ttsOnText(rects, x, y) {
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i];
    if (x >= r.left - _TTS_HIT_X && x <= r.right + _TTS_HIT_X && y >= r.top - _TTS_HIT_Y && y <= r.bottom + _TTS_HIT_Y) return true;
  }
  return false;
}

// What to read: the selection if there is one, else (in a book) from the
// page that is open, else all of the article.
function _ttsMakePlan(doc) {
  var main = _readerMainContent(doc) || doc.body;
  if (!main) return null;
  var model = _ttsReadModel(doc, main), sel = _ttsSelectedSpan(model), a = 0, b = model.text.length;
  if (sel) { a = sel[0]; b = sel[1]; }
  else if (doc.__zbHere) {
    var at = doc.__zbHere();
    if (at) a = Math.max(0, _ttsOffsetOf(model, at.startContainer, at.startOffset));
  }
  return _ttsPlanFrom(model, a, b, !!sel);
}
function _ttsPlanFrom(model, a, b, sel) {
  var chunks = _ttsPlanChunks(model.text, _TTS_CHUNK_MAX, _TTS_FIRST_CHUNK_MAX, a, b, _ttsLang(model.doc));
  return chunks.length ? { doc: model.doc, model: model, chunks: chunks, b: b, sel: sel } : null;
}

// ── marking and following ──
function _ttsHlOk(win) { return !!(win && win.CSS && win.CSS.highlights && win.Highlight); }
function _ttsPaint(ranges) {
  var st = _ttsRead, win = st && st.win;
  if (!_ttsHlOk(win)) return;
  try {
    if (!ranges.length) { win.CSS.highlights.delete(_TTS_HL); return; }
    if (!st.doc.getElementById(_TTS_HL_STYLE)) {
      var style = st.doc.createElement('style');
      style.id = _TTS_HL_STYLE; style.textContent = _TTS_HL_CSS;
      st.doc.head.appendChild(style);
    }
    st.doc.documentElement.classList.toggle(_TTS_NIGHT_CLASS, _nightRedOn());
    var hl = new win.Highlight();
    ranges.forEach(function(r) { hl.add(r); });
    win.CSS.highlights.set(_TTS_HL, hl);
  } catch (e) {}
}
// The reading is at chunk ``idx``, in its sentence ``k`` (null: not known
// yet, so the whole chunk is marked).
function _ttsAlongAt(idx, k) {
  var st = _ttsRead, chunk = st && st.plan.chunks[idx];
  if (!chunk || st.key === idx + ':' + k) return;
  st.key = idx + ':' + k;
  try {
    st.ranges = (k == null ? chunk.spans : [chunk.spans[k]]).map(function(sp) { return _ttsRange(st.plan.model, sp.s, sp.e); });
  } catch (e) { return; }
  _ttsPaint(st.ranges);
  _ttsFollow(false);
}
// Where in a chunk the audio is, by the share of it played.
function _ttsAlongAudio(idx, audio) {
  var st = _ttsRead, chunk = st && st.plan.chunks[idx], d = audio.duration;
  if (chunk) _ttsAlongAt(idx, d > 0 && isFinite(d) ? _ttsSpanAtChar(chunk, audio.currentTime / d * chunk.text.length) : null);
}
// The browser's voice says where it is by the character it reached
// (``boundary``); where it never does, the whole chunk stays marked. A word
// highlight would plug in here: neither engine's audio carries word times.
function _ttsAlongChar(idx, ch) {
  var st = _ttsRead, chunk = st && st.plan.chunks[idx];
  if (chunk) _ttsAlongAt(idx, _ttsSpanAtChar(chunk, ch));
}
// The nearest ancestor that scrolls by itself, or null (the page scrolls).
function _ttsScroller(el, win) {
  for (; el && el.nodeType === 1; el = el.parentElement) {
    var oy = win.getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1 && el !== el.ownerDocument.body && el !== el.ownerDocument.documentElement) return el;
  }
  return null;
}
// Keep the sentence in view. Only while following; once the person has moved
// the page, the reading follows again when it comes back to what is in view.
function _ttsFollow(force) {
  var st = _ttsRead, rs = st && st.ranges;
  if (!rs || !rs.length) return;
  var win = st.win, doc = st.doc, paged = doc.documentElement.classList.contains('zb-paged'), moved = false;
  try {
    if (paged) {
      var rc = rs[0].getClientRects()[0], seen = !!rc && rc.width > 0 && rc.left >= 0 && rc.left < win.innerWidth;
      if (seen) { st.following = true; return; }
      if (!force && !st.following) return;
      if (doc.__zbShowRange) { doc.__zbShowRange(rs[0]); moved = true; }
    } else {
      var box = rs[0].getBoundingClientRect(), end = rs[rs.length - 1].getBoundingClientRect();
      var scr = _ttsScroller(rs[0].startContainer.parentElement, win), cr = scr ? scr.getBoundingClientRect() : { top: 0, height: win.innerHeight };
      var by = _ttsScrollBy({ top: box.top - cr.top, bottom: end.bottom - cr.top }, cr.height);
      if (!by && !force) { st.following = true; return; }
      if (!force && !st.following) return;
      if (by) {
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        (scr || win).scrollBy({ top: by, behavior: reduce ? 'auto' : 'smooth' });
      }
      moved = true;
    }
  } catch (e) { return; }
  if (moved) { st.following = true; _ttsBarSync(); }
}
// The person moved the page: stop following until they ask or it comes back.
function _ttsLose() {
  if (_ttsRead && _ttsRead.following) { _ttsRead.following = false; _ttsBarSync(); }
}
function _ttsFollowResume() {
  if (_ttsRead) { _ttsRead.following = true; _ttsFollow(true); _ttsBarSync(); }
}
// A tap on a sentence moves the reading there.
function _ttsTap(e) {
  var st = _ttsRead, t = e.target;
  if (!st || e.defaultPrevented || e.button || !t || !t.closest || t.closest(_TTS_TAP_SKIP)) return;
  var win = st.win, sel = win.getSelection && win.getSelection();
  if (sel && !sel.isCollapsed && String(sel).trim()) return;
  // A book on pages turns them with a tap at either edge.
  if (st.doc.documentElement.classList.contains('zb-paged') && (e.clientX < win.innerWidth * _BOOK_EDGE || e.clientX > win.innerWidth * (1 - _BOOK_EDGE))) { _ttsLose(); return; }
  var at = _bookCaretAt(st.doc, e.clientX, e.clientY);
  if (!at) return;
  var model = st.plan.model, off = _ttsOffsetOf(model, at.node, at.off), sp = _ttsSentenceAt(model, off);
  if (!sp) return;
  var rects;
  try { rects = _ttsRange(st.plan.model, sp.s, sp.e).getClientRects(); } catch (err) { return; }
  if (!_ttsOnText(rects, e.clientX, e.clientY)) return;
  var plan = _ttsPlanFrom(model, sp.s, st.plan.b, false);
  if (plan) _ttsSpeak(0, plan);
}
// While it reads, the article is listened to: a hand on the page (wheel,
// finger, scroll keys, the scrollbar) is the person moving it; a tap seeks.
function _ttsAlongBegin(plan) {
  var doc = plan.doc, win = doc.defaultView, off = [];
  function on(type, fn, opts) { doc.addEventListener(type, fn, opts); off.push(function() { doc.removeEventListener(type, fn, opts); }); }
  var moved = { passive: true, capture: true };
  on('wheel', _ttsLose, moved);
  on('touchmove', _ttsLose, moved);
  on('keydown', function(e) { if (_TTS_SCROLL_KEYS.indexOf(' ' + e.key + ' ') >= 0) _ttsLose(); }, moved);
  on('mousedown', function(e) { if (e.clientX >= doc.documentElement.clientWidth) _ttsLose(); }, moved);
  on('click', _ttsTap, false);
  on('scroll', function() { if (_ttsRead && !_ttsRead.following) _ttsFollow(false); }, moved);
  _ttsRead = { plan: plan, doc: doc, win: win, following: true, ranges: null, key: '', off: off };
  if (plan.sel) { try { win.getSelection().removeAllRanges(); } catch (e) {} } // the mark takes its place
}
function _ttsAlongEnd() {
  var st = _ttsRead;
  if (!st) return;
  _ttsPaint([]);
  st.off.forEach(function(f) { f(); });
  _ttsRead = null;
}
function _ttsSetSpeaking(on) {
  _ttsSpeaking = on;
  if (!on) _ttsAlongEnd();
  _bookReadSync(_ttsFrameDoc());
  _syncTopbarMenuReaderItems(); // mobile: reflect speaking-state on the ... menu row
  _ttsBarSync();
  var btn = document.getElementById('tts-btn');
  if (!btn) return;
  btn.classList.toggle('speaking', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  var label = on ? t('tts_stop') : t('tts_speak');
  btn.title = label;
  btn.setAttribute('aria-label', label);
}
function _ttsStop() {
  _ttsRun++;
  _ttsPaused = false;
  if (_ttsAudio) {
    try { _ttsAudio.pause(); _ttsAudio.removeAttribute('src'); _ttsAudio.load(); } catch(e) {}
  }
  if (_TTS_AVAILABLE) { try { window.speechSynthesis.cancel(); } catch(e) {} }
  if (_ttsSpeaking) _ttsSetSpeaking(false);
}
// ``from``: a chunk of the reading in progress (a new voice or speed goes on
// from it); none starts afresh, with the selection if there is one. ``plan``:
// what to read, when it is not that (a tap on a sentence).
function _ttsSpeak(from, plan) {
  if (!_ttsCanSpeak()) return;
  var doc = _ttsFrameDoc();
  if (!doc) return;
  plan = plan || (from != null && _ttsRead && _ttsRead.doc === doc && _ttsRead.plan) || _ttsMakePlan(doc);
  if (!plan) return;
  from = from || 0;
  var chunks = plan.chunks.map(function(c) { return c.text; });
  var lang = _ttsLang(doc);
  _ttsStop(); // clear any residual queue or audio before starting fresh
  _ttsAlongBegin(plan);
  var engines = _ttsServerEngines(lang);
  if (!engines.length && !_TTS_AVAILABLE) return;
  _ttsSetSpeaking(true);
  _setStorageJSON(SK.TTS_LAST_USE, Date.now());
  // A chosen voice reads alone and, if it cannot keep up, is offered a faster
  // one; only Automatic moves on to the next engine by itself.
  var chosen = engines.length === 1 && engines[0] === _ttsChosenVoice();
  from = Math.min(from, chunks.length - 1);
  _ttsNow = { at: from, engine: engines[0] || _DEVICE_VOICE, playing: false, lang: lang };
  _ttsBarSync();
  if (engines.length) _ttsSpeakServer(chunks, lang, engines, ++_ttsRun, chosen ? function(e) { _ttsSuggestFaster(lang, e); } : null, from);
  else _ttsSpeakDevice(chunks, lang, from);
}
// This browser's own voices, from chunk ``from`` on.
function _ttsSpeakDevice(chunks, lang, from) {
  var synth = window.speechSynthesis;
  synth.cancel();
  chunks.slice(from).forEach(function(chunk, idx, rest) {
    var u = new SpeechSynthesisUtterance(chunk);
    if (lang) u.lang = lang;
    u.rate = _ttsRate();
    u.onstart = function() { _ttsNow.at = from + idx; _ttsNow.engine = _DEVICE_VOICE; _ttsNow.playing = true; _ttsAlongAt(from + idx, null); _ttsBarSync(); };
    u.onboundary = function(e) { _ttsAlongChar(from + idx, e.charIndex); };
    if (idx === rest.length - 1) u.onend = function() { _ttsSetSpeaking(false); };
    u.onerror = function() { _ttsSetSpeaking(false); };
    synth.speak(u);
  });
}
// The server's voices: one <audio> element plays the chunks in turn. Its src
// is set and played inside the tap for the first chunk, as iOS requires (an
// element started in a tap may play again from its own events).
function _ttsSpeakServer(chunks, lang, engines, run, onSlow, from) {
  var audio = _ttsAudio || (_ttsAudio = new Audio());
  var i = from || 0, eng = 0, retried = false, waiting = null, told = false;
  var started = false; // a word has been heard: from then on the voice stays
  var asked = {}; // chunk index -> true once the server has said it (or failed to)
  function live() { return run === _ttsRun; }
  // Too slow here: the next engine for the language says the rest, and this
  // one is tried last from now on.
  function slower() {
    _ttsMarkSlow(engines[eng]);
    eng++;
    asked = {};
  }
  // Ask for chunk ``idx`` ahead of time; the server keeps what it said, so
  // the <audio> element then gets it at once.
  // A chosen voice (``onSlow``) keeps reading; the person is told once.
  function tooSlow() {
    if (onSlow && !told) { told = true; onSlow(engines[eng]); }
  }
  // Late once words were heard: Automatic remembers the engine as slow for
  // the next reading; a chosen voice is offered a faster one instead.
  function late() {
    if (!onSlow) _ttsMarkSlow(engines[eng]);
    tooSlow();
  }
  function ask(idx) {
    if (idx >= chunks.length || asked[idx] !== undefined) return;
    var engine = engines[eng];
    asked[idx] = false;
    authedFetch(_ttsSpeakUrl(chunks[idx], lang, engine)).then(function(r) {
      if (!live()) return;
      if (r.status === 503) {
        delete asked[idx]; // busy: ask again shortly
        setTimeout(function() { if (live()) ask(idx); }, _TTS_SERVER_RETRY_MS);
        return;
      }
      if (engines[eng] === engine) asked[idx] = true;
    }).catch(function() { if (live()) delete asked[idx]; });
  }
  function play(idx) {
    // Not ready when it is needed: this engine is too slow here. Once words
    // were heard the voice stays (a new voice mid-article is worse than a
    // pause, Eric 2026-10-19: "can sound different between them"); it is
    // marked slow, so the next reading starts with one that keeps up.
    if (started && asked[idx] === false) late();
    audio.defaultPlaybackRate = _ttsRate(); // a new src starts at this rate
    audio.src = _ttsSpeakUrl(chunks[idx], lang, engines[eng]);
    audio.playbackRate = _ttsRate();
    _ttsNow.at = idx; _ttsNow.engine = engines[eng]; _ttsNow.playing = false;
    _ttsBarSync();
    var p = audio.play();
    // AbortError: this play() was cut short by the next src (a switch of
    // engine, or the next chunk), which is not a failure.
    if (p && p.catch) p.catch(function(e) { if (live() && !(e && e.name === 'AbortError')) fail(); });
    // Still silent after a while: before the first word, the next engine
    // says it instead; after, the voice stays and is marked slow.
    clearTimeout(waiting);
    if (eng + 1 < engines.length || onSlow) {
      waiting = setTimeout(function() {
        if (!live() || i !== idx || !audio.paused || _ttsPaused) return;
        if (!started && eng + 1 < engines.length) { slower(); play(idx); }
        else if (started) late(); else tooSlow();
      }, _TTS_START_WAIT_MS);
    }
  }
  function fail() {
    // Once more after a moment (the server may have been busy), then this
    // browser's voices for the rest, or stop when it has none.
    if (!retried) {
      retried = true;
      setTimeout(function() { if (live()) play(i); }, _TTS_SERVER_RETRY_MS);
      return;
    }
    _ttsRun++;
    if (_TTS_AVAILABLE) _ttsSpeakDevice(chunks, lang, i);
    else _ttsSetSpeaking(false);
  }
  audio.onplaying = function() {
    if (!live()) return;
    clearTimeout(waiting); retried = false; started = true;
    for (var k = 1; k <= _TTS_AHEAD; k++) ask(i + k);
    _ttsNow.playing = true; _ttsBarSync();
    _ttsAlongAudio(i, audio);
  };
  audio.ontimeupdate = function() { if (live()) _ttsAlongAudio(i, audio); };
  audio.onended = function() {
    if (!live()) return;
    i++;
    if (i >= chunks.length) { _ttsRun++; _ttsSetSpeaking(false); return; }
    play(i);
  };
  audio.onerror = function() { if (live() && audio.getAttribute('src')) fail(); };
  play(i);
}
