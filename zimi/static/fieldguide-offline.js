// The Field Guide with no server: what zimi/fieldguide.py answers from the
// guide's own data, answered here from the same data (static/
// fieldguide-offline.json, served from fieldguide.offline_bundle()). Used only
// when the server cannot be reached: the page asks the server first.
//
// normalize, lookup and who are ports of the Python of the same names, and
// tests/test_fieldguide_offline.py holds the two to the same answers for every
// phrase in every language. Change one, change the other.
//
// Shared by the Field Guide page (inlined at <!--@fieldguide-offline.js@-->)
// and the node tests (module.exports).
var FieldGuideOffline = (function() {
  var BUNDLE_URL = '/static/fieldguide-offline.json';
  var MAX_QUERY_CHARS = 80;   // fieldguide.MAX_QUERY_CHARS
  var MAX_PHRASE_WORDS = 8;
  var MAX_CJK_RUN = 8;
  var CJK = /[぀-ヿ㐀-鿿豈-﫿]/;
  var COMBINING = /[̀-ͯ]/g;
  var PUNCT_OR_SPACE = /[\p{P}\p{S}\p{Z}\p{C}]/u;
  // Python's casefold folds a few letters lowercasing leaves alone.
  var FOLD = { 'ß': 'ss', 'ς': 'σ', 'ſ': 's', 'ẞ': 'ss' };

  function chars(s) { return Array.from(s); }

  // Words as they are compared: case folded, Latin and Cyrillic accents off
  // (other scripts keep their marks), punctuation to spaces except the hyphen,
  // apostrophes dropped.
  function normalize(text) {
    var t = String(text == null ? '' : text).normalize('NFKC').toLowerCase();
    t = chars(t).map(function(c) { return FOLD[c] || c; }).join('');
    t = t.normalize('NFD').replace(COMBINING, '').normalize('NFC');
    var out = chars(t).map(function(c) {
      if (c === '\'' || c === '’' || c === 'ʼ') return '';
      return c !== '-' && PUNCT_OR_SPACE.test(c) ? ' ' : c;
    });
    return out.join('').split(' ').filter(Boolean).join(' ');
  }

  // {language: {exact, within, cjk, link}} and {language: filler words}, from
  // the matcher's data. First writer wins, as in Python.
  function keywordIndex(m) {
    if (m._index) return m._index;
    var tables = {};
    function of(lang) {
      return tables[lang] || (tables[lang] = { exact: new Map(), within: new Map(), cjk: new Map(), link: new Map() });
    }
    function put(map, key, sid) { if (!map.has(key)) map.set(key, sid); }
    Object.keys(m.home).forEach(function(lang) {
      m.home[lang].forEach(function(w) { put(of(lang).exact, normalize(w), ''); });
    });
    Object.keys(m.situations).forEach(function(sid) {
      var sit = m.situations[sid];
      Object.keys(sit.keywords || {}).forEach(function(lang) {
        var t = of(lang);
        sit.keywords[lang].forEach(function(w) {
          var n = normalize(w);
          put(t.exact, n, sid);
          if (n.split(' ').length >= 2) put(t.within, n, sid);
        });
      });
      Object.keys(sit.within || {}).forEach(function(lang) {
        var t = of(lang);
        sit.within[lang].forEach(function(w) {
          var n = normalize(w);
          put(CJK.test(n) ? t.cjk : t.within, n, sid);
        });
      });
      Object.keys(sit.ambiguous || {}).forEach(function(lang) {
        var t = of(lang);
        sit.ambiguous[lang].forEach(function(w) { put(t.link, normalize(w), sid); });
      });
    });
    var stop = {};
    Object.keys(m.stop).forEach(function(lang) {
      stop[lang] = new Set(m.stop[lang].map(normalize));
    });
    m._index = { tables: tables, stop: stop };
    return m._index;
  }

  // The whole typed query (or what is left without filler) as a keyword
  // ("card") or a bare ambiguous word ("link"); null when it is neither.
  function whole(wholes, tables, langs) {
    for (var i = 0; i < wholes.length; i++) {
      var w = wholes[i], x, t;
      for (x = 0; x < langs.length; x++) {
        t = tables[langs[x]];
        if (t && t.exact.has(w)) { var sid = t.exact.get(w); return [sid, sid ? 'card' : 'link']; }
      }
      for (x = 0; x < langs.length; x++) {
        t = tables[langs[x]];
        if (t && t.link.has(w)) return [t.link.get(w), 'link'];
      }
    }
    return null;
  }

  // A phrase or a CJK run anywhere in the query, the longest first.
  function inside(words, q, tables, langs) {
    var x, t, n, i;
    for (n = Math.min(words.length, MAX_PHRASE_WORDS); n > 0; n--) {
      for (i = 0; i + n <= words.length; i++) {
        var gram = words.slice(i, i + n).join(' ');
        for (x = 0; x < langs.length; x++) {
          t = tables[langs[x]];
          if (t && t.within.has(gram)) return [t.within.get(gram), 'card'];
        }
      }
    }
    if (!CJK.test(q)) return null;
    var cs = chars(q);
    for (n = Math.min(cs.length, MAX_CJK_RUN); n > 1; n--) {
      for (i = 0; i + n <= cs.length; i++) {
        var run = cs.slice(i, i + n).join('');
        for (x = 0; x < langs.length; x++) {
          t = tables[langs[x]];
          if (t && t.cjk.has(run)) return [t.cjk.get(run), 'card'];
        }
      }
    }
    return null;
  }

  // [situation id, kind] for what was typed, or null. See fieldguide.lookup.
  function lookup(m, query, lang) {
    lang = lang || 'en';
    var q = normalize(query);
    if (!q || chars(q).length > MAX_QUERY_CHARS) return null;
    var idx = keywordIndex(m);
    var langs = idx.tables[lang] && lang !== 'en' ? [lang] : [];
    langs.push('en');
    var words = q.split(' ');
    var rest = words.filter(function(w) {
      return !langs.some(function(x) { return idx.stop[x] && idx.stop[x].has(w); });
    }).join(' ');
    var wholes = [q];
    if (rest && rest !== q) wholes.push(rest);
    return whole(wholes, idx.tables, langs) || inside(words, q, idx.tables, langs);
  }

  // Who the words say needs help ("infant" for "baby choking"), or null.
  function who(m, query, lang) {
    lang = lang || 'en';
    var q = normalize(query);
    if (!q || chars(q).length > MAX_QUERY_CHARS) return null;
    var words = new Set(q.split(' '));
    var names = Object.keys(m.who || {});
    for (var i = 0; i < names.length; i++) {
      var byLang = m.who[names[i]];
      var langs = lang === 'en' ? ['en'] : [lang, 'en'];
      for (var j = 0; j < langs.length; j++) {
        var ws = byLang[langs[j]] || [];
        for (var k = 0; k < ws.length; k++) {
          var n = normalize(ws[k]);
          var phrase = n.indexOf(' ') >= 0 || CJK.test(n);
          if (phrase ? q.indexOf(n) >= 0 : words.has(n)) return names[i];
        }
      }
    }
    return null;
  }

  // What /fieldguide/match answers: {id, kind, who}.
  function match(m, query, lang) {
    var got = lookup(m, query, lang);
    return {
      id: got ? got[0] : null,
      kind: got ? got[1] : null,
      who: got && got[1] === 'card' ? who(m, query, lang) : null
    };
  }

  // The bundle, asked for once; null when it cannot be had (never cached, and
  // the server cannot be reached).
  var kept = null;
  function load(fetchFn) {
    if (!kept) {
      kept = (fetchFn || fetch)(BUNDLE_URL).then(function(r) {
        if (!r.ok) throw new Error('status ' + r.status);
        return r.json();
      }).catch(function() { kept = null; return null; });
    }
    return kept;
  }

  // Every situation's quotes in the front's order, for one printed set (what
  // /fieldguide/print answers).
  function printAll(b) {
    var out = [];
    b.home.groups.forEach(function(g) {
      g.situations.forEach(function(s) {
        var sit = b.situations[s.id];
        out.push({ id: s.id, quotes: sit ? sit.quotes : [] });
      });
    });
    return { situations: out, disclaimer: b.home.disclaimer };
  }

  return { normalize: normalize, lookup: lookup, who: who, match: match, load: load, printAll: printAll, BUNDLE_URL: BUNDLE_URL };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = FieldGuideOffline;
