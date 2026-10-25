/* ZimiGames: Wiki Race. Get from one article to another by following links only.
   Inside Zimi the race is run on the player's own Wikipedia (their language), reading the articles the reader
   already serves; the end is found by walking a few links from the start, so a route always exists. In Kiwix
   or from a folder it is run on a small web of articles shipped in wikirace-data.js. Our own code, GPL-3.0.
   The rules (pure functions, no DOM, so node can test them) and the page (only when there is a document). */
(function (root) {
  'use strict';
  var Lib = root.GamesLib;

  // ── the rules ────────────────────────────────────────────────────────────
  var MIN_LINKS = 6;          // an article with fewer links is a dead end, not a place to race from or to
  var WALK_LINKS = 60;        // the walk chooses among an article's first links (its body, not its far notes)
  var WALK_TRIES = 14;        // pages tried, in all, to take the hops of one walk
  var MIN_HOPS = 3, MAX_HOPS = 4;

  function normTitle(t) { return Lib.fold(String(t || '')).replace(/[_\s]+/g, ' ').trim(); }

  // Has the player reached the target? The same path, or the same title (a redirect lands on its article).
  function isTarget(page, target) {
    return page.path === target.path || normTitle(page.title) === normTitle(target.title);
  }

  // Is a race honest? steps: [{path, via}] with via 'start', 'link' or 'back'. A link step must be one of the
  // links of the page before it; a back step returns to the page before that one.
  function validatePath(steps, linksOf) {
    if (!steps.length || steps[0].via !== 'start') return { ok: false, at: 0 };
    for (var i = 1; i < steps.length; i++) {
      var s = steps[i], prev = steps[i - 1];
      if (s.via === 'back') { if (i < 2 || steps[i - 2].path !== s.path) return { ok: false, at: i }; }
      else if (s.via === 'link') { if ((linksOf(prev.path) || []).indexOf(s.path) < 0) return { ok: false, at: i }; }
      else return { ok: false, at: i };
    }
    return { ok: true, at: -1 };
  }

  // The fewest clicks from one page to another (breadth first). -1 when there is no route.
  function shortest(linksOf, from, to) {
    if (from === to) return 0;
    var dist = {}, queue = [from];
    dist[from] = 0;
    for (var q = 0; q < queue.length; q++) {
      var here = queue[q], next = linksOf(here) || [];
      for (var i = 0; i < next.length; i++) {
        if (dist[next[i]] !== undefined) continue;
        dist[next[i]] = dist[here] + 1;
        if (next[i] === to) return dist[to];
        queue.push(next[i]);
      }
    }
    return -1;
  }

  // From a first page, follow `hops` links chosen by chance among each page's first links, never to a page
  // already on the way and never to a dead end. open(path) answers {path, title, links:[{path, title}]};
  // the pages walked come back, the first included, fewer when the walk gets stuck.
  function walk(open, first, hops, rng) {
    var pages = [first], seen = {}, tries = 0;
    seen[first.path] = true;
    function step() {
      if (pages.length > hops || tries >= WALK_TRIES) return Promise.resolve(pages);
      var cands = pages[pages.length - 1].links.filter(function (l) { return !seen[l.path]; }).slice(0, WALK_LINKS);
      if (!cands.length) return Promise.resolve(pages);
      var pick = cands[Math.floor(rng() * cands.length)];
      seen[pick.path] = true; tries++;
      return open(pick.path).then(function (p) {
        if (p && p.links.length >= MIN_LINKS) pages.push(p);
        return step();
      }, step);
    }
    return step();
  }

  function raceText(title, date, steps, ms) {
    return title + ' ' + date + '\n' + steps.map(function (s) { return s.title; }).join(' > ') + '\n' + (steps.length - 1) + ' clicks, ' + Math.floor(ms / 1000) + ' s';
  }

  var Engine = { isTarget: isTarget, validatePath: validatePath, shortest: shortest, walk: walk, normTitle: normTitle, raceText: raceText, MIN_LINKS: MIN_LINKS, MIN_HOPS: MIN_HOPS, MAX_HOPS: MAX_HOPS };
  root.WikiRaceEngine = Engine;

  if (typeof document === 'undefined') return;

  // ── the page ─────────────────────────────────────────────────────────────
  var Play = root.ArcadePlay, $ = Play.$;
  Play.applyTheme();
  var DAILY_KEY = 'zimi.games.wikirace.daily', BEST_KEY = 'zimi.games.wikirace.best';
  var TICK_MS = 250, CAP_CHARS = 60000, HINT_CHARS = 150;
  // Parts of an article the race leaves out: boxes, notes, pictures, menus.
  var DROP_TAGS = /^(SCRIPT|STYLE|TABLE|FIGURE|IMG|NOSCRIPT|SUP|IFRAME|OBJECT|SVG|MATH|AUDIO|VIDEO|FORM|BUTTON|INPUT|HEAD|LINK|META|NAV|ASIDE|TEMPLATE|H1)$/;
  var DROP_CLASS = /\b(navbox|reflist|mw-references-wrap|hatnote|noprint|mw-editsection|metadata|sistersitebox|shortdescription|infobox|thumb|gallery|toc)\b/;
  var KEEP_TAGS = /^(P|B|I|EM|STRONG|UL|OL|LI|H2|H3|H4|DL|DT|DD|BLOCKQUOTE|SPAN|BR|SMALL|U|SUB|CODE)$/;

  var els = { sub: $('rc-source'), main: $('rc-main'), mode: $('rc-mode'), clicks: $('rc-clicks'), time: $('rc-time'), par: $('rc-par'), trail: $('rc-trail'),
    pane: $('rc-pane'), back: $('rc-back'), give: $('rc-give'), target: $('rc-target'), sheet: $('rc-sheet'), title: $('rc-sheet-title'), text: $('rc-sheet-text'),
    route: $('rc-route'), share: $('rc-share'), again: $('rc-again'), close: $('rc-close') };
  var provider = null, race = null, timer = null, busy = false;
  var today = Lib.dayKey(new Date());

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function say(node) { els.pane.innerHTML = ''; els.pane.appendChild(node); els.pane.scrollTop = 0; }
  function notice(title, text, button, onClick) {
    var box = el('div', 'rc-card'); box.appendChild(el('h2', null, title));
    if (text) box.appendChild(el('p', null, text));
    if (button) { var b = el('button', 'ar-btn gm-play', button); b.type = 'button'; b.addEventListener('click', onClick); box.appendChild(b); }
    say(box);
  }

  // A link inside an article: a span the page handles (no href, so Zimi's reader does not take it for a page change).
  function makeLink(path, text) {
    var a = el('a', 'rc-link', text); a.setAttribute('role', 'link'); a.tabIndex = 0; a.dataset.path = path; return a;
  }
  function firstSentence(node) {
    var p = node.querySelector('p'), t = (p ? p.textContent : node.textContent).replace(/\s+/g, ' ').trim();
    var cut = t.search(/[.!?](\s|$)/);
    if (cut > 20 && cut < HINT_CHARS) t = t.slice(0, cut + 1);
    return t.length > HINT_CHARS ? t.slice(0, HINT_CHARS).replace(/\s\S*$/, '') + '...' : t;
  }

  // ── Zimi's library: the player's Wikipedia, read the way the reader reads it ──
  function zimiProvider(zimRec) {
    var zim = zimRec.name, cache = {};
    // Rebuild an article from its HTML into plain, safe elements: only the tags above, no attributes but a link's path.
    function clean(src, into, from, state) {
      for (var n = src.firstChild; n; n = n.nextSibling) {
        if (state.chars > CAP_CHARS) return;
        if (n.nodeType === 3) { into.appendChild(document.createTextNode(n.nodeValue)); state.chars += n.nodeValue.length; continue; }
        if (n.nodeType !== 1) continue;
        var tag = n.tagName.toUpperCase();
        if (DROP_TAGS.test(tag) || DROP_CLASS.test(n.getAttribute('class') || '') || /display\s*:\s*none/.test(n.getAttribute('style') || '')) continue;
        if (tag === 'A') {
          var path = Lib.resolvePath(zim, from, n.getAttribute('href'));
          if (path) {
            var a = makeLink(path, ''); clean(n, a, from, state);
            if (!a.textContent.trim()) continue;
            state.links.push({ path: path, title: (n.getAttribute('title') || a.textContent).trim() });
            into.appendChild(a);
          } else clean(n, into, from, state);
          continue;
        }
        if (KEEP_TAGS.test(tag)) { var e = document.createElement(tag.toLowerCase()); clean(n, e, from, state); into.appendChild(e); }
        else clean(n, into, from, state);
      }
    }
    function open(path) {
      if (cache[path]) return Promise.resolve(cache[path]);
      return Lib.text('/w/' + encodeURIComponent(zim) + '/' + path.split('/').map(encodeURIComponent).join('/')).then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var body = doc.querySelector('#mw-content-text') || doc.body;
        var h1 = doc.querySelector('h1'), title = ((h1 && h1.textContent) || doc.title || Lib.titleOfPath(path)).trim();
        var state = { chars: 0, links: [] }, node = el('div', 'rc-article');
        clean(body, node, path, state);
        var seen = {}, links = state.links.filter(function (l) { return !seen[l.path] && (seen[l.path] = true); });
        return (cache[path] = { path: path, title: title, node: node, links: links });
      });
    }
    // The pair: a start (the day's for the daily, else by chance), and an end that is a few links away.
    function pickStart(daily) {
      var url = '/random?zim=' + encodeURIComponent(zim) + (daily ? '&day=' + today + '&seed=' + today : '');   // the day's card, else a pick seeded by the day: one start for everyone
      return Lib.json(url).then(function (r) {
        if (!r || !r.path || r.path === zimRec.main_path || r.path.indexOf(':') >= 0) throw new Error('no start');
        return open(r.path);
      });
    }
    // The front page always has links, and the walk can leave from one of them: the same one for the same seed.
    function fromMain(rng) {
      return open(zimRec.main_path || '').then(function (m) {
        return m.links.length ? open(m.links[Math.floor(rng() * Math.min(m.links.length, WALK_LINKS))].path) : Promise.reject(new Error('empty'));
      });
    }
    // The daily race leaves from the day's card, else from the front page (never from chance, or it would not be one race);
    // a race of practice from a few random tries, then the front page.
    function startFrom(daily, rng, tries) {
      return pickStart(daily).then(function (p) {
        if (p.links.length >= MIN_LINKS) return p;
        throw new Error('dead end');
      }).catch(function () {
        return daily || tries >= 4 ? fromMain(rng) : startFrom(daily, rng, tries + 1);
      });
    }
    function pick(daily) {
      var rng = Lib.rng(Lib.hash(zim + '|' + (daily ? today : String(Math.random()))));
      var hops = MIN_HOPS + Math.floor(rng() * (MAX_HOPS - MIN_HOPS + 1));
      return startFrom(daily, rng, 0).then(function (first) {
        return walk(open, first, hops, rng);
      }).then(function (pages) {
        var s = pages[0], e = pages[pages.length - 1];
        if (pages.length < 3 || e.path === s.path) throw new Error('no pair');
        return { start: s, end: e, par: pages.length - 1, parLabel: 'a route of ' + (pages.length - 1) + ' exists' };
      });
    }
    return { label: zimRec.title || zim, zim: zim, lang: zimRec.language, open: open, pick: pick, built: false };
  }

  // ── the built-in set: for a page with no Zimi behind it ──
  function miniProvider() {
    var articles = {}, pages = {};
    root.WIKIRACE_MINI.forEach(function (a) { articles[a[0]] = a[1]; });
    var LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    function linksOf(title) { var out = [], m; LINK.lastIndex = 0; while ((m = LINK.exec(articles[title] || ''))) if (out.indexOf(m[1]) < 0) out.push(m[1]); return out; }
    function open(path) {
      if (!articles[path]) return Promise.reject(new Error('no such page'));
      if (!pages[path]) {
        var node = el('div', 'rc-article'), p = el('p'), text = articles[path], last = 0, m;
        LINK.lastIndex = 0;
        while ((m = LINK.exec(text))) {
          p.appendChild(document.createTextNode(text.slice(last, m.index)));
          p.appendChild(makeLink(m[1], m[2] || m[1]));
          last = LINK.lastIndex;
        }
        p.appendChild(document.createTextNode(text.slice(last)));
        node.appendChild(p);
        pages[path] = { path: path, title: path, node: node, links: linksOf(path).map(function (t) { return { path: t, title: t }; }) };
      }
      return Promise.resolve(pages[path]);
    }
    function pick(daily) {
      var titles = Object.keys(articles).sort(), rng = Lib.rng(Lib.hash('mini|' + (daily ? today : String(Math.random()))));
      for (var i = 0; i < 400; i++) {
        var a = titles[Math.floor(rng() * titles.length)], b = titles[Math.floor(rng() * titles.length)];
        var d = shortest(linksOf, a, b);
        if (d >= 3 && d <= 5) return Promise.all([open(a), open(b)]).then(function (ab) { return { start: ab[0], end: ab[1], par: d, parLabel: 'the shortest route is ' + d }; });
      }
      return Promise.reject(new Error('no pair'));
    }
    return { label: 'the built-in articles', zim: 'mini', open: open, pick: pick, built: true };
  }

  // ── a race ──
  function clicks() { return race.steps.length - 1; }
  function elapsed() { return race.ms + (race.since ? performance.now() - race.since : 0); }
  function paintHud() {
    els.clicks.textContent = race ? clicks() : 0;
    els.time.textContent = race ? Play.fmtClock(elapsed()) : '0:00';
    els.par.textContent = race ? race.pair.par : '-';
  }
  function resume() { if (race && !race.done && !race.since && race.begun) race.since = performance.now(); }
  function pause() { if (race && race.since) { race.ms += performance.now() - race.since; race.since = 0; saveDaily(); } }
  Play.onHidden(pause);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) resume(); });

  function saveDaily() {
    if (!race || race.mode !== 'daily') return;
    Play.save(DAILY_KEY, { date: today, zim: provider.zim, steps: race.steps, ms: Math.round(race.ms), done: race.done, begun: race.begun });
  }

  function paintTrail() {
    els.trail.innerHTML = '';
    race.steps.forEach(function (s, i) {
      if (i) els.trail.appendChild(el('span', 'rc-sep', '›'));
      els.trail.appendChild(el('span', 'rc-chip' + (i === race.steps.length - 1 ? ' here' : ''), s.title));
    });
    els.trail.scrollLeft = els.trail.scrollWidth;
    els.back.disabled = race.done || race.steps.length < 2;
    els.give.disabled = race.done;
  }
  function paintTarget() {
    els.target.innerHTML = '';
    els.target.appendChild(el('span', 'rc-from', race.pair.start.title));
    els.target.appendChild(el('span', 'rc-arrow', '→'));
    els.target.appendChild(el('b', 'rc-to', race.pair.end.title));
    if (race.hint) els.target.title = race.hint;
  }

  function show(page) {
    var box = el('div'); box.appendChild(el('h2', 'rc-title', page.title)); box.appendChild(page.node);
    say(box);
    race.page = page;
    paintTrail(); paintHud();
  }

  function beginRace() {
    race.begun = true; race.since = performance.now();
    if (!timer) timer = setInterval(function () { if (race && race.since) paintHud(); }, TICK_MS);
    provider.open(race.steps[race.steps.length - 1].path).then(show, function () { notice('That page is not in your library.', null, 'Try another race', function () { newRace('practice'); }); });
  }

  function arrive(page) {
    race.done = true; pause(); saveDaily(); paintTrail(); paintHud();
    var ms = Math.round(race.ms), n = clicks();
    if (race.mode === 'daily') {
      var best = Play.load(BEST_KEY, {});
      if (!best.clicks || n < best.clicks) { best.clicks = n; Play.save(BEST_KEY, best); }
    }
    openResult(ms, n);
  }
  function openResult(ms, n) {
    els.title.textContent = 'Arrived in ' + n + (n === 1 ? ' click' : ' clicks');
    els.text.textContent = Play.fmtClock(ms) + ' on the clock, ' + race.pair.parLabel + '.';
    els.route.innerHTML = '';
    race.steps.forEach(function (s, i) { els.route.appendChild(el('li', null, s.title)); });
    Play.openSheet(els.sheet, '#rc-share');
  }

  function go(path) {
    if (busy || !race || race.done || !race.begun) return;
    busy = true;
    provider.open(path).then(function (page) {
      busy = false;
      race.steps.push({ path: page.path, title: page.title, via: 'link' });
      saveDaily();
      if (Engine.isTarget(page, race.pair.end)) { show(page); arrive(page); } else show(page);
    }, function () {
      busy = false;
      var note = el('p', 'rc-note', 'That page is not in your library, so it did not count.');
      els.pane.insertBefore(note, els.pane.firstChild);
      setTimeout(function () { if (note.parentNode) note.parentNode.removeChild(note); }, 2600);
    });
  }
  function goBack() {
    if (busy || !race || race.done || race.steps.length < 2) return;
    var prev = race.steps[race.steps.length - 2];
    busy = true;
    provider.open(prev.path).then(function (page) { busy = false; race.steps.push({ path: prev.path, title: prev.title, via: 'back' }); saveDaily(); show(page); }, function () { busy = false; });
  }
  function giveUp() {
    if (!race || race.done) return;
    race.done = true; pause(); saveDaily(); paintTrail();
    els.title.textContent = 'Not this time';
    els.text.textContent = 'The target was ' + race.pair.end.title + ', ' + race.pair.parLabel + '.';
    els.route.innerHTML = '';
    race.steps.forEach(function (s) { els.route.appendChild(el('li', null, s.title)); });
    Play.openSheet(els.sheet, '#rc-again');
  }

  function intro(pair, mode, doneBefore) {
    var box = el('div', 'rc-card');
    box.appendChild(el('h2', null, mode === 'daily' ? 'Today’s race' : 'A new race'));
    var line = el('p', 'rc-pair'); line.appendChild(el('span', null, pair.start.title)); line.appendChild(el('span', 'rc-arrow', '→')); line.appendChild(el('b', null, pair.end.title));
    box.appendChild(line);
    box.appendChild(el('p', 'rc-hint', race.hint));
    box.appendChild(el('p', null, 'Follow the links in each article to get there. ' + (pair.par ? 'Par is ' + pair.par + ' ' + (pair.par === 1 ? 'click' : 'clicks') + '.' : '')));
    if (doneBefore) box.appendChild(el('p', 'rc-best', 'You finished this one in ' + doneBefore + '.'));
    var b = el('button', 'ar-btn gm-play', 'Start'); b.type = 'button'; b.addEventListener('click', beginRace); box.appendChild(b);
    say(box);
    setTimeout(function () { b.focus(); }, 0);
  }

  function newRace(mode) {
    pause(); race = null; busy = false; paintHud();
    els.mode.textContent = mode === 'daily' ? 'Daily' : 'Practice';
    els.trail.innerHTML = ''; els.back.disabled = els.give.disabled = true; els.target.innerHTML = '';
    notice('Finding two articles...');
    var saved = mode === 'daily' ? Play.load(DAILY_KEY, null) : null;
    provider.pick(mode === 'daily').then(function (pair) {
      race = { mode: mode, pair: pair, steps: [{ path: pair.start.path, title: pair.start.title, via: 'start' }], ms: 0, since: 0, begun: false, done: false, page: null, hint: firstSentence(pair.end.node) };
      paintTarget(); paintHud();
      if (saved && saved.date === today && saved.zim === provider.zim && saved.steps && saved.steps[0].path === pair.start.path) {
        race.steps = saved.steps; race.ms = saved.ms || 0; race.begun = saved.begun; race.done = saved.done;
        if (race.done) {
          paintTrail();
          provider.open(race.steps[race.steps.length - 1].path).then(function (p) { show(p); openResult(race.ms, clicks()); });
          return;
        }
        if (race.begun) { race.since = performance.now(); if (!timer) timer = setInterval(function () { if (race && race.since) paintHud(); }, TICK_MS); return provider.open(race.steps[race.steps.length - 1].path).then(show); }
      }
      intro(pair, mode, null);
    }, function () {
      notice('Could not find a race in this library.', provider.built ? null : 'Wikipedia in your library needs links between its articles. Try again, or play the built-in articles.', 'Try again', function () { newRace(mode); });
    });
  }

  // ── wiring ──
  els.pane.addEventListener('click', function (e) { var a = e.target.closest('.rc-link'); if (a) go(a.dataset.path); });
  els.pane.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.classList.contains('rc-link')) go(e.target.dataset.path); });
  els.back.addEventListener('click', goBack);
  els.give.addEventListener('click', giveUp);
  els.mode.addEventListener('click', function () { newRace(race && race.mode === 'daily' ? 'practice' : 'daily'); });
  els.again.addEventListener('click', function () { Play.closeSheet(els.sheet); newRace('practice'); });
  els.close.addEventListener('click', function () { Play.closeSheet(els.sheet); });
  els.share.addEventListener('click', function () {
    var t = raceText('Wiki Race', race.mode === 'daily' ? today : 'practice', race.steps, race.ms);
    try { navigator.clipboard.writeText(t).then(function () { els.share.textContent = 'Copied'; }, function () { els.text.textContent = t; }); } catch (err) { els.text.textContent = t; }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !els.sheet.hidden) Play.closeSheet(els.sheet); });

  // Which articles to race on: your Wikipedia in your language inside Zimi, else the built-in ones.
  function boot() {
    notice('Looking for your library...');
    Lib.isZimi().then(function (yes) { return yes ? Lib.zims() : []; }).then(function (list) {
      var found = Lib.pickZim(list, 'wikipedia', Lib.uiLang());
      provider = found ? zimiProvider(found.zim) : miniProvider();
      els.sub.textContent = found ? 'Racing on ' + (found.zim.title || found.zim.name) + ' (' + found.zim.language + '), from your library.' + (found.exact ? '' : ' No Wikipedia in your language yet.') : 'Built-in articles. Open ZimiGames inside Zimi to race on your own Wikipedia.';
      newRace('daily');
    });
  }
  root.__race = { get race() { return race; }, get provider() { return provider; } };
  boot();
})(this);
