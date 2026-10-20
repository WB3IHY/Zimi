// Field Guide card parts: one quoted passage with its source, and the rows
// that say where the library goes deeper. Shared by the Field Guide page
// (inlined at <!--@fieldguide-card.js@-->) and by the shell, which loads it to
// draw a situation above search results (search's `fieldguide` field, see
// zimi/fieldguide.py hint()). Nothing here writes advice: a quote is the
// source's own words, drawn as given, with where it came from.
//
// The words around it are the host's: S is the strings object (the shell's
// fieldguide_* words without the prefix); English stands in where one is
// missing. Actions are data-act buttons; wire(root, act) hands each tap to
// the host as act(name, element).
var FieldGuideCard = (function() {
  var STYLE_ID = 'fg-card-style';
  var DEFAULTS = {
    disclaimer: 'Not medical advice. Call emergency services if you can.',
    from: 'From {title} ({edition})', licence: 'Licence: {licence}', original: 'Original',
    in_library: 'In your library: {name}', read_full: 'Read the full section',
    add_for_full: 'Add {name} ({size}) for the full text', build: 'Build it here', get: 'Get',
    search_in: 'Search {zim} for “{q}”', show_all: 'Show all', dated: 'Dated', open_card: 'Open', quotes_n: '{n} passages',
    lic_US_PD: 'US government work, public domain', more_in_library: 'More in your library',
    add_to_library: 'Add to your library', nothing: 'Nothing installed answers this yet.', loading: 'Loading…',
    superseded: 'Superseded by {by}', your_library: 'Your library', build_note: '{size} from {source}',
    help_link: 'Help now: {name}', covers: 'Covers', as_of: 'Guidance as of {date}',
    num_here: 'Emergency number here: {n}', nums_here: 'Emergency numbers here: {n}', num_unknown: 'Emergency number: {n}',
    num_police: 'Police', num_ambulance: 'Ambulance', num_fire: 'Fire', num_mobile: 'Mobile phones',
    num_source: 'Emergency numbers from {title}, {licence}'
  };
  // Source text carries its own marks for what must not be missed.
  var CALLOUT = /^(NOTE|Note\.|CAUTION|WARNING)\s*/;
  var LEAD = /^(\d+-\d+\.|Step \d+\.|\d+\.\s)/;
  // a., b., c. in the source's own enumeration
  var ENUM = /^[a-z]\.\s/;
  var BYTES_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
  var CSS = [
    '.fg-q{margin:0 0 14px;padding:14px 16px;border:1px solid var(--border,#e4dfd4);border-radius:var(--radius,12px);background:var(--surface,#faf8f4);color:var(--text,#26241f)}',
    '.fg-q h3{margin:0;font-size:15px;line-height:1.3;font-weight:700;unicode-bidi:plaintext}',
    '.fg-q .fg-where{margin:2px 0 10px;font-size:12px;color:var(--text2,#6a675e)}',
    '.fg-q .fg-asof{margin:0;font-size:12px;font-weight:600;color:var(--text,#2a2925)}',
    '.fg-q [lang=en]{unicode-bidi:isolate}',
    '.fg-q .fg-scope{margin:0 0 10px;font-size:13px;line-height:1.4;color:var(--text2,#6a675e)}.fg-scope b{font-weight:700}',
    '.fg-body p{margin:0 0 8px;font-size:15px;line-height:1.5}',
    '.fg-body h4{margin:12px 0 4px;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--text2,#6a675e)}',
    '.fg-body ul{margin:0 0 10px;padding-inline-start:20px}',
    '.fg-body li{margin:0 0 6px;font-size:15px;line-height:1.5}',
    '.fg-body .fg-callout{padding:8px 10px;border-inline-start:3px solid var(--amber,#b5541c);background:var(--amber-glow,rgba(181,84,28,.08));border-radius:0 var(--radius-s,8px) var(--radius-s,8px) 0}',
    '.fg-body .fg-callout b{margin-inline-end:4px;font-weight:700}',
    '.fg-body .fg-lead b{font-weight:700}',
    '.fg-body li.fg-enum{list-style:none;margin-inline-start:-4px}',
    '.fg-table{border-collapse:collapse;margin:6px 0 10px;font-size:13.5px;max-width:100%}',
    '.fg-table th,.fg-table td{border:1px solid var(--border,#e4dfd4);padding:4px 8px;text-align:start}',
    '.fg-table caption{caption-side:bottom;text-align:start;font-size:12px;color:var(--text2,#6a675e);padding-top:4px}',
    '.fg-foot{margin-top:10px;padding-top:8px;border-top:1px solid var(--border,#e4dfd4);font-size:12px;line-height:1.5;color:var(--text2,#6a675e)}',
    '.fg-foot a{display:inline-flex;align-items:center;min-height:44px;padding:0 6px;color:var(--text2,#6a675e);text-decoration:underline;text-underline-offset:2px}',
    '.fg-num{margin:0 0 14px;padding:12px 16px;border:1px solid var(--amber,#b5541c);border-radius:var(--radius,12px);background:var(--amber-glow,rgba(181,84,28,.08));color:var(--text,#26241f);font-size:16px;line-height:1.4}.fg-num b{font-weight:700}.fg-num-src{display:block;margin-top:4px;font-size:12px;color:var(--text2,#6a675e)}.fg-num-src a{color:inherit}',
    '.fg-lib{margin-top:6px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}',
    '.fg-btn{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:18px;border:1px solid var(--border,#e4dfd4);background:var(--surface,#faf8f4);color:var(--text,#26241f);font:inherit;font-size:13px;cursor:pointer}',
    '.fg-btn:hover,.fg-btn:focus-visible{border-color:var(--amber,#b5541c);color:var(--amber,#b5541c)}',
    '.fg-btn.on{background:var(--amber,#b5541c);border-color:var(--amber,#b5541c);color:var(--on-amber,#fff)}',
    '.fg-rows{margin:0;padding:0;list-style:none}',
    '.fg-row{display:block;width:100%;text-align:start;padding:11px 0;border:0;border-top:1px solid var(--border,#e4dfd4);background:none;color:inherit;font:inherit;cursor:pointer}',
    '.fg-row:first-child{border-top:0}',
    '.fg-row b{display:block;font-size:14.5px;font-weight:600;line-height:1.3}',
    '.fg-row span{display:block;margin-top:2px;font-size:12px;color:var(--text2,#6a675e)}',
    '.fg-dated{display:inline-block;margin-inline-start:6px;padding:0 6px;border-radius:6px;border:1px solid var(--amber,#b5541c);color:var(--amber,#b5541c);font-size:11px;font-style:normal}',
    '.fg-libgroup{margin:0 0 14px}',
    '.fg-libgroup h3{margin:0 0 4px;font-size:15px;font-weight:700}',
    '.fg-libgroup .fg-row{display:flex;align-items:center;gap:10px;cursor:default}',
    '.fg-libgroup .fg-row>div{flex:1;min-width:0}',
    '.fg-confirm{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}',
    // The search answer is compact: a tall passage is folded, whole behind Show all.
    '.fg-answer .fg-body{position:relative;max-height:15em;overflow:hidden}',
    '.fg-answer .fg-body.fg-fold::after{content:"";position:absolute;inset:auto 0 0 0;height:3em;background:linear-gradient(transparent,var(--surface,#faf8f4))}',
    '.fg-answer.fg-open .fg-body{max-height:none}.fg-answer.fg-open .fg-body::after{display:none}',
    '@media print{.fg-q{break-inside:avoid;border:1px solid #000;background:#fff;color:#000;border-radius:0}.fg-lib,.fg-libgroup,.fg-btn{display:none!important}.fg-foot,.fg-foot a,.fg-q .fg-where,.fg-dated{color:#000;border-color:#000}.fg-foot a{display:inline;min-height:0;padding:0;text-decoration:none}.fg-foot a::after{content:" " attr(href);word-break:break-all}}'
  ].join('');

  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function word(S, key, vars) {
    var s = (S && S[key]) || DEFAULTS[key] || key;
    return s.replace(/\{(\w+)\}/g, function(m, k) { return vars && vars[k] != null ? vars[k] : m; });
  }
  function ensureStyle(doc) {
    doc = doc || document;
    if (doc.getElementById(STYLE_ID)) return;
    var el = doc.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    doc.head.appendChild(el);
  }
  // 8,200,000,000 -> "8.2 GB"; 21,000,000 -> "21 MB".
  function sizeText(bytes) {
    var n = Number(bytes) || 0, i = 0;
    while (n >= 1000 && i < BYTES_UNITS.length - 1) { n /= 1000; i++; }
    return (n >= 100 || i === 0 ? Math.round(n) : Math.round(n * 10) / 10) + ' ' + BYTES_UNITS[i];
  }

  // The quoted lines, in the order and the grouping the source gives them: a
  // numbered paragraph leads the items under it, an upper-case line or one
  // ending in a colon heads a list, Note/CAUTION/WARNING stand out.
  function bodyHtml(lines) {
    var out = '', list = false;
    // Short lines in a row are a list, whatever the source leads them with.
    var listy = (lines || []).length >= 3 && !(lines || []).some(function(l) { return l.length > 220; });
    function close() { if (list) { out += '</ul>'; list = false; } }
    (lines || []).forEach(function(line) {
      var m = CALLOUT.exec(line);
      var plain = line.replace(/[^A-Za-z]/g, '');
      if (m) {
        close();
        out += '<p class="fg-callout"><b>' + esc(m[1]) + '</b>' + esc(line.slice(m[0].length)) + '</p>';
      } else if ((plain.length > 3 && line === line.toUpperCase() && line.length < 80) || (/:$/.test(line) && line.length < 40)) {
        close();
        out += '<h4>' + esc(line.replace(/:$/, '')) + '</h4>';
        list = true; out += '<ul>';
      } else if (LEAD.test(line)) {
        close();
        var num = LEAD.exec(line)[0];
        out += '<p class="fg-lead"><b>' + esc(num) + '</b>' + esc(line.slice(num.length)) + '</p>';
        list = true; out += '<ul>';
      } else if (list || listy) {
        if (!list) { out += '<ul>'; list = true; }
        out += '<li' + (ENUM.test(line) ? ' class="fg-enum"' : '') + '>' + esc(line) + '</li>';
      } else {
        out += '<p>' + esc(line) + '</p>';
      }
    });
    close();
    return out.replace(/<ul><\/ul>/g, '');
  }
  function tableHtml(t) {
    if (!t) return '';
    return '<table class="fg-table"><thead><tr>' + t.head.map(function(c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      t.rows.map(function(r) { return '<tr>' + r.map(function(c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody>' + (t.foot ? '<caption>' + esc(t.foot) + '</caption>' : '') + '</table>';
  }
  function button(S, act, label, attrs, cls) {
    return '<button type="button" class="fg-btn' + (cls ? ' ' + cls : '') + '" data-act="' + act + '"' + (attrs || '') + '>' + esc(label) + '</button>';
  }
  function dataAttrs(o) {
    return Object.keys(o).map(function(k) { return ' data-' + k + '="' + esc(o[k]) + '"'; }).join('');
  }

  // Where the library goes deeper, once for the whole situation: one row per
  // source the quotes come from, "In your library" with the way in when its
  // ZIM is installed, "Add X (size)" with Get (or Build) when it is not. A
  // source several quotes share is one row.
  function libraryGroupHtml(quotes, S) {
    var rows = [], seen = {};
    (quotes || []).forEach(function(q) {
      var lib = q.library;
      if (!lib) return;
      if (lib.state === 'installed') {
        if (seen['in:' + lib.piece]) return;
        seen['in:' + lib.piece] = 1;
        var open = lib.open || {};
        var act = open.path ? 'open' : 'search';
        var attrs = open.path ? dataAttrs({ zim: open.zim, path: open.path }) : dataAttrs({ zim: open.zim, q: open.q });
        rows.push('<li class="fg-row"><div><b>' + esc(word(S, 'in_library', { name: lib.name })) + '</b></div>' + button(S, act, word(S, 'read_full'), attrs) + '</li>');
        return;
      }
      (lib.options || []).forEach(function(o) {
        if (seen['add:' + o.piece]) return;
        seen['add:' + o.piece] = 1;
        var go = o.build ? button(S, 'build', word(S, 'build'), dataAttrs({ build: o.build, size: o.size_bytes })) :
          (o.url ? button(S, 'get', word(S, 'get'), dataAttrs({ url: o.url, size: o.size_bytes })) : '');
        var note = o.build ? word(S, 'build_note', { size: '~' + sizeText(o.size_bytes), source: o.source || '' }) : '';
        rows.push('<li class="fg-row"><div><b>' + esc(word(S, 'add_for_full', { name: o.name, size: o.build ? sizeText(o.size_bytes) : sizeText(o.size_bytes) })) + '</b>' +
          (note ? '<span>' + esc(note) + '</span>' : '') + '</div>' + go + '</li>');
      });
    });
    if (!rows.length) return '';
    return '<section class="fg-libgroup"><h3>' + esc(word(S, 'your_library')) + '</h3><ul class="fg-rows">' + rows.join('') + '</ul></section>';
  }

  function licenceText(code, S) {
    return word(S, 'lic_' + String(code).replace(/[^A-Za-z0-9]/g, '_'), {}).replace(/^lic_.*$/, code);
  }

  // The guidance's date ("2026-08", or "1992" with no month) in the reader's language.
  function asOfText(asOf, S) {
    var parts = String(asOf).split('-'), y = +parts[0], m = parts[1] ? +parts[1] : 0;
    if (!m) return String(y);
    try {
      return new Intl.DateTimeFormat((S && S.lang) || 'en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, 1));
    } catch (e) { return asOf; }
  }

  // One quote: the source's own heading, where in the source, the words as
  // given, then who published it, when, under what licence, and the way on.
  function quoteHtml(q, S) {
    var s = q.source || {};
    return '<section class="fg-q" data-quote="' + esc(q.id) + '">' +
      '<h3 lang="en" dir="ltr">' + esc(q.heading) + '</h3>' +
      (s.as_of ? '<p class="fg-asof">' + esc(word(S, 'as_of', { date: asOfText(s.as_of, S) })) + '</p>' : '') +
      '<div class="fg-where" lang="en" dir="ltr">' + esc(s.title) + ' · ' + esc(q.locator) +
      (s.dated ? '<i class="fg-dated">' + esc(word(S, 'dated')) + '</i>' : '') +
      (s.superseded ? '<i class="fg-dated">' + esc(word(S, 'superseded', { by: s.superseded })) + '</i>' : '') + '</div>' +
      (q.scope ? '<p class="fg-scope"><b>' + esc(word(S, 'covers')) + ':</b> <span lang="en" dir="ltr">' + esc(q.scope) + '</span></p>' : '') +
      '<div class="fg-body" lang="en" dir="ltr">' + bodyHtml(q.lines) + tableHtml(q.table) + '</div>' +
      footHtml(q, S) + '</section>';
  }
  // Where it came from: the source, its edition and publisher, the licence, and the original.
  function footHtml(q, S) {
    var s = q.source || {};
    return '<div class="fg-foot">' + esc(word(S, 'from', { title: s.title, edition: s.edition })) + ' · ' + esc(s.publisher) + '<br>' +
      esc(word(S, 'licence', { licence: licenceText(s.licence, S) })) + ' · <a href="' + esc(q.url) + '" target="_blank" rel="noopener noreferrer">' + esc(word(S, 'original')) + '</a></div>';
  }

  // Pages the installed ZIMs hold on the situation, each a tap away.
  function answersHtml(rows, S) {
    if (!rows || !rows.length) return '';
    return '<ul class="fg-rows">' + rows.map(function(r) {
      var act = r.kind === 'search' ? 'search' : 'open';
      var attrs = r.kind === 'search' ? dataAttrs({ zim: r.zim, q: r.q }) : dataAttrs({ zim: r.zim, path: r.path });
      var title = r.kind === 'search' ? word(S, 'search_in', { zim: r.zim_title, q: r.q }) : r.title;
      var meta = r.name + (r.year ? ' · ' + r.year : '');
      return '<li><button type="button" class="fg-row" data-act="' + act + '"' + attrs + '><b>' + esc(title) + (r.dated ? '<i class="fg-dated">' + esc(word(S, 'dated')) + '</i>' : '') +
        '</b><span>' + esc(meta) + '</span></button></li>';
    }).join('') + '</ul>';
  }

  // ZIMs that are not here and would add to the situation.
  function missingHtml(rows, S) {
    if (!rows || !rows.length) return '';
    return '<ul class="fg-rows">' + rows.map(function(m) {
      var go = m.build ? button(S, 'build', word(S, 'build'), dataAttrs({ build: m.build, size: m.size_bytes })) : button(S, 'get', word(S, 'get'), dataAttrs({ url: m.url, size: m.size_bytes }));
      var note = m.note + (m.build ? ' · ' + word(S, 'build_note', { size: '~' + sizeText(m.size_bytes), source: m.source || '' }) : '');
      return '<li class="fg-row" style="cursor:default"><b>' + esc(m.name) + ' · ' + esc(sizeText(m.size_bytes)) + '</b><span>' + esc(note) + '</span>' + go + '</li>';
    }).join('') + '</ul>';
  }

  // ── The reader's country and place, from the time zone ──
  // zones: {place(tz) -> [lat, lon] | null, country(tz) -> ISO 3166 code | null}, the sky's own time zone table
  // (static/zone-places.js: _skyZonePlace, _skyZoneCountry);
  // numbers: static/fieldguide-numbers.json (the country table and its source).
  var NUM_ORDER = ['police', 'ambulance', 'fire'];
  // The number(s) for a country: {all} when the source gives one for everything,
  // else its police / ambulance / fire, plus the mobile one when it differs.
  function numberParts(rec) {
    if (!rec) return null;
    var parts = [];
    if (rec.all) parts.push({ k: 'all', v: rec.all });
    else NUM_ORDER.forEach(function(k) { if (rec[k]) parts.push({ k: k, v: rec[k] }); });
    if (rec.mobile && !(rec.all && rec.mobile.indexOf(rec.all) >= 0)) parts.push({ k: 'mobile', v: rec.mobile });
    return parts.length ? parts : null;
  }
  // {known, parts, text}: what the line says for this zone. An unknown zone or
  // country says the table's default (112 and 911) and that it is unknown.
  function emergencyFor(zones, numbers, tz) {
    var cc = zones && tz ? zones.country(tz) : null, rec = cc && numbers && numbers.countries ? numbers.countries[cc] : null;
    var parts = numberParts(rec);
    if (!parts) return { known: false, parts: [{ k: 'all', v: ((numbers && numbers.default) || ['112', '911']).join(' / ') }] };
    return { known: true, cc: cc, parts: parts };
  }
  function emergencyHtml(info, numbers, S) {
    var one = info.parts.length === 1 && info.parts[0].k === 'all';
    var txt = info.parts.map(function(p) { return p.k === 'all' ? p.v : word(S, 'num_' + p.k) + ' ' + p.v; }).join(' · ');
    var head = !info.known ? word(S, 'num_unknown', { n: txt }) : one ? word(S, 'num_here', { n: txt }) : word(S, 'nums_here', { n: txt });
    var src = numbers && numbers.source;
    return '<p class="fg-num" data-num="' + esc(info.known ? info.cc : '') + '"><b>' + esc(head) + '</b>' +
      (src ? '<span class="fg-num-src">' + esc(word(S, 'num_source', { title: src.title, licence: src.licence })) + ' · <a href="' + esc(src.url) + '" target="_blank" rel="noopener noreferrer">' + esc(word(S, 'original')) + '</a></span>' : '') + '</p>';
  }
  // "Los Angeles" from "America/Los_Angeles": the zone's own city.
  function zoneCity(tz) { return tz && tz.indexOf('/') > 0 ? tz.split('/').pop().replace(/_/g, ' ') : ''; }
  // The place the sky is read for: the one chosen in the Almanac (its latitude, longitude and name), else the
  // middle of the device's time zone, said to be a guess; null when neither is known.
  function placeLat(chosenLat, zones, tz, chosenLon, chosenName) {
    var c = parseFloat(chosenLat), o = parseFloat(chosenLon);
    if (isFinite(c)) return { lat: c, lon: isFinite(o) ? o : 0, guessed: false, name: chosenName || '' };
    var z = zones && tz ? zones.place(tz) : null;
    return z ? { lat: z[0], lon: z[1], guessed: true, city: zoneCity(tz) } : null;
  }
  // Quotes tagged with a sky ('north', 'south', 'any'): the reader's hemisphere's first, those that serve
  // anywhere next, the other hemisphere's last, in the slots the sky quotes held. Without a place, as given.
  function skyFirst(quotes, lat) {
    if (typeof lat !== 'number' || !isFinite(lat)) return quotes;
    var want = lat < 0 ? 'south' : 'north', rank = function(q) { return q.sky === want ? 0 : q.sky === 'any' ? 1 : 2; };
    var spots = [], sky = [];
    quotes.forEach(function(q, i) { if (q.sky) { spots.push(i); sky.push(q); } });
    sky = sky.map(function(q, i) { return { q: q, i: i }; }).sort(function(a, b) { return rank(a.q) - rank(b.q) || a.i - b.i; });
    var out = quotes.slice();
    spots.forEach(function(at, n) { out[at] = sky[n].q; });
    return out;
  }

  // The passage for whoever the words named ('infant' for "baby choking"), else the first.
  function forWho(quotes, who) {
    for (var i = 0; who && i < quotes.length; i++) if (quotes[i].who === who) return quotes[i];
    return quotes[0];
  }

  function wire(root, act) {
    root.addEventListener('click', function(e) {
      var el = e.target.closest ? e.target.closest('[data-act]') : null;
      if (el && root.contains(el)) { e.preventDefault(); act(el.getAttribute('data-act'), el); }
    });
  }

  return { esc: esc, word: word, ensureStyle: ensureStyle, sizeText: sizeText, bodyHtml: bodyHtml, tableHtml: tableHtml, footHtml: footHtml, quoteHtml: quoteHtml, asOfText: asOfText,
    answersHtml: answersHtml, missingHtml: missingHtml, libraryGroupHtml: libraryGroupHtml, wire: wire, emergencyFor: emergencyFor, emergencyHtml: emergencyHtml, placeLat: placeLat, skyFirst: skyFirst, forWho: forWho, numberParts: numberParts, DEFAULTS: DEFAULTS };
})();
