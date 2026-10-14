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
    help_link: 'Help now: {name}', covers: 'Covers'
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

  // One quote: the source's own heading, where in the source, the words as
  // given, then who published it, when, under what licence, and the way on.
  function quoteHtml(q, S) {
    var s = q.source || {};
    return '<section class="fg-q" data-quote="' + esc(q.id) + '">' +
      '<h3 lang="en" dir="ltr">' + esc(q.heading) + '</h3>' +
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

  function wire(root, act) {
    root.addEventListener('click', function(e) {
      var el = e.target.closest ? e.target.closest('[data-act]') : null;
      if (el && root.contains(el)) { e.preventDefault(); act(el.getAttribute('data-act'), el); }
    });
  }

  return { esc: esc, word: word, ensureStyle: ensureStyle, sizeText: sizeText, bodyHtml: bodyHtml, tableHtml: tableHtml, footHtml: footHtml, quoteHtml: quoteHtml,
    answersHtml: answersHtml, missingHtml: missingHtml, libraryGroupHtml: libraryGroupHtml, wire: wire, DEFAULTS: DEFAULTS };
})();
