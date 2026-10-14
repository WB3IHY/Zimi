// The card over a search's results: the slot and the cards that fill it.
//
// Held here: cards take turns by priority and the first with something to say
// fills the slot (the rest are never asked); a new search clears the slot and
// aborts the request in flight; a card that arrives for an older search is
// dropped; "More results" keeps the card; a keyword search makes no request;
// the quote is escaped, labelled "From {title}, {source}", and the word
// "Answer" appears nowhere.
//
// Run: node tests/test_search_card.cjs   (exit 0 = pass)

const vm = require('vm');
const src = require('./app_source.cjs')();

let failures = 0;
const check = (ok, label) => { if (!ok) { console.error('FAIL: ' + label); failures++; } else console.log('ok: ' + label); };

function grab(head) {
  const i = src.indexOf('\n' + head);
  if (i < 0) throw new Error('not found: ' + head);
  const line = src.slice(i + 1, src.indexOf('\n', i + 1));
  if (/;\s*(\/\/.*)?$/.test(line) && !/[{[(]\s*$/.test(line)) return line + '\n';
  const end = src.indexOf('\n}', i + 1);
  const close = src.slice(end + 1, src.indexOf('\n', end + 1));
  return src.slice(i + 1, end + 1 + close.length) + '\n';
}
// The built-in card's registration, from "registerSearchCard({" to "});".
function grabBestCard() {
  const i = src.indexOf('\nregisterSearchCard({\n  id: \'best\'');
  if (i < 0) throw new Error('best card not registered');
  const end = src.indexOf('\n});', i);
  return src.slice(i + 1, end + 4) + '\n';
}

const STRINGS = { best_from: 'From {title}, {source}', best_label: 'From your library' };
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function makeSandbox() {
  const fakeEl = () => ({
    className: '', dataset: {}, innerHTML: '', removed: false,
    remove() { this.removed = true; },
  });
  const output = { firstChild: null, prepend(el) { this.firstChild = el; } };
  const sb = {
    console, AbortController, Promise, encodeURIComponent, setTimeout,
    output, mode: 'search',
    document: { createElement: fakeEl },
    t: k => STRINGS[k] || k,
    tH: k => esc(STRINGS[k] || k),
    esc, escAttr: esc,
    _zimTitle: z => 'Wikipedia',
    _articleDeepLinkPath: (z, p) => '/?a=' + encodeURIComponent(z + '/' + p),
    _spaNav: (e, fn) => { fn(); return false; },
    opened: [],
    _openResult(zim, path, title, opts) { sb.opened.push({ zim, path, title, opts }); },
    fetched: [],
    fetchImpl: null,
    fetch(url, opts) { sb.fetched.push(url); return sb.fetchImpl(url, opts); },
  };
  vm.createContext(sb);
  const decls = [
    'var SEARCH_CARDS = ', 'function registerSearchCard(', 'var _searchCard = ', 'function _searchCardClear(',
    'function _searchCardMount(', 'async function _searchCardStart(', 'const BEST_MIN_WORDS = ',
    'const BEST_ASKING = ', 'function _bestMayHelp(', 'function _bestQuoteHtml(', 'function _bestQuoteClick(',
  ];
  vm.runInContext(decls.map(grab).join('').replace(/^(const|let) /gm, 'var ') + grabBestCard(), sb);
  return sb;
}
const tick = () => new Promise(r => setTimeout(r, 5));
const answer = {
  answer: { zim: 'wiki', path: 'A/Water_purification', title: 'Water <purification>', before: 'Intro. ', sentence: 'Boil it for one minute.', after: ' More text.', score: 1 },
  more: [{ zim: 'wiki', path: 'A/Boiling', title: 'Boiling', before: '', sentence: 'People boil water to purify it.', after: '', score: 0.8 }],
};
const jsonRes = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });

(async () => {
  // ── keyword searches make no request ───────────────────────────────────
  {
    const S = makeSandbox();
    for (const q of ['water', 'water purification', 'mona lisa', '  ']) {
      check(S._bestMayHelp(q) === false, 'no request for the keyword search "' + q + '"');
    }
    for (const q of ['how to purify water', 'capital of france', 'who is einstein?', 'Einstein?', '谁画了蒙娜丽莎', 'кто написал мону лизу']) {
      check(S._bestMayHelp(q) === true, 'asks for "' + q + '"');
    }
  }

  // ── the quote's markup ─────────────────────────────────────────────────
  {
    const S = makeSandbox();
    const html = S._bestQuoteHtml(answer.answer, true);
    check(html.includes('<mark class="bq-hit">Boil it for one minute.</mark>'), 'the sentence is marked inside its passage');
    check(html.includes('From <bdi>Water &lt;purification&gt;</bdi>, <bdi>Wikipedia</bdi>'), 'labelled by its source, the title escaped');
    check(!/answer/i.test(S.SEARCH_CARDS[0].html(answer)), 'the word "answer" is nowhere in the card');
    check(html.includes('data-quote="Boil it for one minute."'), 'the sentence travels with the link');
    check(html.includes('href="/?a=wiki%2FA%2FWater_purification"'), 'a real link, so open-in-new-tab works');
    const more = S._bestQuoteHtml(answer.more[0], false);
    check(!more.includes('<mark') && more.includes('People boil water to purify it.'), 'an extra is the sentence alone, unmarked');
    check(S.SEARCH_CARDS[0].html(answer).split('class="best-quote').length === 3, 'the primary and its one extra');
    // a title that tries to be a tag, and a sentence that does
    const evil = S._bestQuoteHtml({ zim: 'z', path: 'p', title: '"><img src=x onerror=1>', before: '', sentence: '<b>x</b>', after: '' }, true);
    check(!evil.includes('<img') && !evil.includes('<b>'), 'nothing from an article becomes markup');
    S._bestQuoteClick({}, { dataset: { zim: 'wiki', path: 'A/X', title: 'X', quote: 'Q sentence.' } });
    check(S.opened.length === 1 && S.opened[0].opts.quote === 'Q sentence.', 'a tap opens the article with the sentence to show');
  }

  // ── the best card asks the server the way the search did ──────────────
  {
    const S = makeSandbox();
    S.fetchImpl = () => jsonRes(answer);
    S._searchCardStart('how to purify water', null, '&zim=wiki', 10, {});
    await tick();
    check(S.fetched.length === 1 && S.fetched[0] === '/bestanswer?q=how%20to%20purify%20water&limit=10&zim=wiki', 'same query, limit and scope as the search: ' + S.fetched[0]);
    check(S.output.firstChild && S.output.firstChild.innerHTML.includes('best-card'), 'the card is first in the results');
    check(S.output.firstChild.dataset.card === 'best', 'and says which card it is');
  }

  // ── nothing to say: no card, no error ──────────────────────────────────
  {
    const S = makeSandbox();
    S.fetchImpl = () => jsonRes({ answer: null });
    S._searchCardStart('how to purify water', null, '', 10, {});
    await tick();
    check(S.output.firstChild === null, 'no answer, no card');
    for (const bad of [() => jsonRes({}, false), () => Promise.reject(new Error('offline')), () => jsonRes(null)]) {
      const T = makeSandbox();
      T.fetchImpl = bad;
      T._searchCardStart('how to purify water', null, '', 10, {});
      await tick();
      check(T.output.firstChild === null, 'a failed or empty request leaves no card');
    }
  }

  // ── the slot: priority, first to answer, the rest never asked ─────────
  {
    const S = makeSandbox();
    const asked = [];
    S.registerSearchCard({ id: 'late', priority: 200, ask: () => { asked.push('late'); return 'x'; }, html: p => '<i>' + p + '</i>' });
    S.registerSearchCard({ id: 'first', priority: 1, ask: ctx => { asked.push('first'); return ctx.data.hint || null; }, html: p => '<b>' + p + '</b>' });
    S.fetchImpl = () => jsonRes(answer);
    S._searchCardStart('how to purify water', null, '', 10, { hint: 'bleeding' });
    await tick();
    check(asked.join() === 'first', 'a sync card with something to say is the only one asked: ' + asked.join());
    check(S.output.firstChild.dataset.card === 'first' && S.output.firstChild.innerHTML === '<b>bleeding</b>', 'and fills the slot at once');
    check(S.fetched.length === 0, 'the best card never made its request');
    S._searchCardClear();
    asked.length = 0;
    S._searchCardStart('how to purify water', null, '&zim=a', 10, {});
    await tick();
    check(asked.join() === 'first' && S.output.firstChild.dataset.card === 'best', 'nothing from the first: the best card is next, ahead of the late one');
    // a card that throws is skipped, not fatal
    S._searchCardClear();
    S.registerSearchCard({ id: 'boom', priority: 0, ask: () => { throw new Error('x'); }, html: () => '' });
    S._searchCardStart('how to purify water', null, '&zim=b', 10, {});
    await tick();
    check(S.output.firstChild.dataset.card === 'best', 'a card that throws is skipped');
  }

  // ── a new search cancels the card's request ───────────────────────────
  {
    const S = makeSandbox();
    let signal = null;
    S.fetchImpl = (url, opts) => new Promise((resolve, reject) => {
      signal = opts.signal;
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    S._searchCardStart('how to purify water', null, '', 10, {});
    await tick();
    check(signal && !signal.aborted, 'the request is out');
    S._searchCardClear();
    check(signal.aborted, 'a new search aborts it');
    await tick();
    check(S.output.firstChild === null, 'and nothing lands');
  }

  // ── an older search's card is dropped ──────────────────────────────────
  {
    const S = makeSandbox();
    const pending = [];
    S.fetchImpl = url => new Promise(resolve => pending.push({ url, resolve }));
    S._searchCardStart('how to purify water', null, '', 10, {});
    await tick();
    S._searchCardStart('who painted the mona lisa', null, '', 10, {});
    await tick();
    pending[0].resolve({ ok: true, json: () => Promise.resolve(answer) }); // the first answers late
    await tick();
    check(S.output.firstChild === null, 'the older search\'s card does not appear');
    pending[1].resolve({ ok: true, json: () => Promise.resolve(answer) });
    await tick();
    check(S.output.firstChild !== null, 'the current search\'s card does');
  }

  // ── leaving search while it loads ──────────────────────────────────────
  {
    const S = makeSandbox();
    let resolve;
    S.fetchImpl = () => new Promise(r => { resolve = r; });
    S._searchCardStart('how to purify water', null, '', 10, {});
    await tick();
    S.mode = 'home';
    resolve({ ok: true, json: () => Promise.resolve(answer) });
    await tick();
    check(S.output.firstChild === null, 'a card for a page no longer shown is dropped');
  }

  // ── "More results" keeps the card; a new query replaces it ────────────
  {
    const S = makeSandbox();
    S.fetchImpl = () => jsonRes(answer);
    S._searchCardStart('how to purify water', null, '&zim=w', 10, {});
    await tick();
    const first = S.output.firstChild;
    S._searchCardStart('how to purify water', null, '&zim=w', 50, {});
    await tick();
    check(S.fetched.length === 1 && S.output.firstChild === first && !first.removed, 'the same search again keeps its card and asks nothing');
    S._searchCardStart('how to boil water', null, '&zim=w', 10, {});
    await tick();
    check(first.removed && S.fetched.length === 2, 'a different question removes the old card and asks again');
  }

  // ── a quote is consumed where no page loads ───────────────────────────
  {
    const i = src.indexOf('_restoreMapPosition(flyPos, 0);');
    const block = src.slice(i, src.indexOf('return;', i));
    check(i > 0 && block.includes('_pendingQuote = null'), 'flying to a place on the open map drops a pending quote');
  }

  if (failures) { console.error(failures + ' failed'); process.exit(1); }
  console.log('all passed');
})();
