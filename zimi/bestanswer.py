"""The best passage for a question, quoted from the library.

Search shows a card above its results: the sentence that answers, inside its
passage, with the article it came from. Nothing here writes a word. It reads
passages the library already holds (the same chunks /chunks serves), ranks
them, and either returns a quote it is sure of or returns nothing.

    worth_asking(q)         is this a question, not a keyword search?
    rank_answer(q, pool)    pure ranking: BM25 over passages, then sentences
                            scored by how much of the question they cover and
                            how close together the covered words sit
    best_answer(q, ...)     the whole path: top search hits -> chunks -> rank

Ranking is pure Python on strings; no model, no dependency. The seam for a
learned reranker is `rerank`: a callable that takes (query, candidates) and
returns the candidates in a better order. Nothing sets it today.

Languages: words are folded (case, accents), cut to a five-letter stem
(purify/purification, painter/painted), and a script written without spaces
(Han, kana) is read as characters and character pairs. Function words come
from a per-language list where there is one; every language, listed or not,
also gets them from IDF, since a word in nearly every passage weighs nothing.
"""

import collections
import logging
import math
import re
import threading
import time
import unicodedata

from zimi import query as _query

log = logging.getLogger("zimi")

# ── knobs, each with the reason it is what it is ──────────────────────────
PASSAGE_SIZE = 600  # chars per chunk: a paragraph, small enough to quote whole
MAX_CANDIDATES = 6  # articles read per question
MAX_CHUNKS_PER_ARTICLE = 60  # ~36k chars: the lead and a long way past it
CANDIDATE_POOL = 8  # passages whose sentences are scored after BM25
BUDGET_SECONDS = 1.5  # stop reading more articles after this long
CONFIDENCE = 0.62  # a sentence below this covers too little of the question
WEAK_MATCH = 0.35  # a word matched by its stem alone (president, preside) counts this much
LONG_FROM = 80  # chars: a sentence longer than this is a worse quote ...
LONG_PENALTY = 0.25  # ... losing up to this share of its score by LONG_FROM + LONG_SPAN
LONG_SPAN = 240
TIGHTNESS_FLOOR = 0.45  # a sentence with the words far apart keeps this share of its score
FRONT_MATTER_KINDS = ("books",)  # whose first passage is a title page and a licence
TITLE_LINE_SLACK = 12  # chars a sentence may exceed the title by and still be only the title
EXTRA_MAX = 2  # more passages under the card
EXTRA_RELATIVE = 0.7  # an extra must be this fraction as good as the best
CONTEXT_BEFORE = 240  # chars of the passage kept before the sentence
CONTEXT_AFTER = 160  # and after it
SENTENCE_MIN = 20  # chars; 8 for scripts written without spaces
SENTENCE_MIN_UNSPACED = 8
SENTENCE_MAX = 420
STEM_LEN = 5
BM25_K1 = 1.2
BM25_B = 0.75
TITLE_BONUS = 0.4   # max added when the article's title holds the question
LEAD_BONUS = 0.04  # the first passage of an article is its summary
RANK_DECAY = 0.015  # per search rank: the search already ordered the articles
SPARSE_HITS = 3  # fewer search hits than this: ask again without function words
CACHE_MAX = 64
CACHE_TTL = 120.0

# The seam for a reranker (see the module docstring): a callable taking the
# question and the candidate passages and returning them best first. None:
# BM25 order.
rerank = None

# Marks that are not part of a letter's identity for matching: Latin accents
# (folded by query.fold), Hebrew points, Arabic harakat.
_MARKS = [(0x591, 0x5C7), (0x64B, 0x65F), (0x670, 0x670)]
_NO_MARKS = {c: None for lo, hi in _MARKS for c in range(lo, hi + 1)}


def _fold(text):
    return _query.fold(text).translate(_NO_MARKS)


def _fast_fold_table():
    """text.lower().translate(table): the cheap fold the prefilter uses, the
    same letters _fold gives for Latin accents and marks."""
    table = dict(_NO_MARKS)
    for cp in range(0xC0, 0x250):
        ch = chr(cp)
        base = _query.fold(ch)
        if base != ch.lower():
            table[cp] = base
    return table


_FAST_FOLD = _fast_fold_table()

_WORD = re.compile("[\\ẁ-֑ͯ-ׇً-ٰٟऀ-෿]+", re.UNICODE)
_UNSPACED = re.compile("[぀-ヿ㐀-䶿一-鿿豈-﫿]+")
# Characters that are all function in an unspaced script ("is", "of", "who",
# "?"): dropped from the query and the text before pairs are made.
_UNSPACED_STOP = frozenset(
    "的是了在有和与或吗呢么谁什哪怎如何为麼誰什嗎的は、がをにへでとのもか"
)

# Opening words that make a query a question, per language (folded). "die" and
# "was" are German and English at once, so neither is listed bare.
_ASKING = frozenset("""what who whom whose when where why which how
    wer wie wo wann warum wieso weshalb welche welcher welches wohin woher
    qui que quoi quand ou pourquoi quel quelle quels quelles comment combien
    quien quienes cuando donde porque cual cuales como cuanto cuantos
    chi quando dove perche quale quali come quanto quanti
    quem quando onde qual quais quanto quantos
    wat wie waar wanneer waarom welke hoe
    кто что когда где почему зачем какой какая какое какие как сколько
    من ما ماذا متى اين لماذا كيف كم هل
    क्या कौन कब कहाँ क्यों कैसे कितना
    מי מה מתי איפה למה איך כמה""".split())
_ASKING_ANYWHERE = re.compile(
    "[?？؟]|什么|谁|怎么|怎样|如何|为什么|哪|吗|嗎|いつ|だれ|どこ|なぜ|どう|何"
)

_FUNCTION = {
    "en": "the a an of in on at to for from by with and or is are was were be been do does did can could how what who whom when where why which that this these those it its as into about than then there their".split(),
    "de": "der die das den dem des ein eine hat habe haben hatte hatten einen einem einer eines und oder ist sind war waren von zu zum zur mit in im am an auf aus bei nach fur uber wie was wer wo wann warum welche es sich nicht".split(),
    "fr": "le la les un une des de du et ou est sont etait en dans sur par pour avec que qui quoi quand ou pourquoi comment quel quelle il elle ce cette ces au aux ne pas".split(),
    "es": "el la los las un una unos unas de del y o es son era en por para con que quien como cuando donde porque cual se lo al no".split(),
    "it": "il lo la i gli le un uno una di del della e o e sono era in su per con che chi come quando dove perche quale non si al".split(),
    "pt": "o a os as um uma de do da dos das e ou e sao era em por para com que quem como quando onde porque qual se ao nao".split(),
    "nl": "de het een van en of is zijn was waren in op aan voor met dat die wat wie waar wanneer waarom hoe welke niet er".split(),
    "ru": "и в во не на с со что как это по но из за от для или он она они был была были есть кто где когда почему какой".split(),
    "ar": "في من على الى عن هذا هذه ذلك التي الذي هو هي ما ماذا متى اين كيف لماذا هل او ان كان".split(),
    "hi": "है हैं था थे के की का में से को पर और या एक यह वह क्या कौन कब कहाँ कैसे क्यों".split(),
    "he": "של על את עם זה זו הוא היא מי מה מתי איפה איך למה או גם לא".split(),
}
_FUNCTION = {k: frozenset(_query.fold(w) for w in v) for k, v in _FUNCTION.items()}

_ABBREV = frozenset(
    "dr mr mrs ms prof st vs etc ca approx no inc ltd jr sr fig cf al eg ie c".split()
)
_ENDERS = "。！？．｡"
_BOUNDARY = re.compile(r"[.!?؟।]+[\"'”’)\]]*\s+|[。！？]+[\"'”’）」』]*")


# ── words ──────────────────────────────────────────────────────────────────


def _stem(word):
    if word.isdigit():
        return word
    if word.startswith("ال") and len(word) > 4:  # Arabic "the"
        word = word[2:]
    if word[0] > "\u024f":
        # Cyrillic, Greek, Arabic, Hebrew, Indic: the ending is the inflection
        # (мону/мона), so cut one letter and keep the front.
        return word[: max(3, min(len(word) - 1, STEM_LEN + 1))]
    return word[:STEM_LEN]


def words(text, drop=frozenset()):
    """The stems of `text` in order. Stems in `drop` (function words) are left
    out. Scripts written without spaces give each character and each pair."""
    return [stem for stem, _ in read(text, drop)]


def read(text, drop=frozenset()):
    """(stem, word) for each word of `text`, the word as folded but not cut:
    purification is ("purif", "purification"). Two words with one stem
    (president, preside) are told apart by it."""
    out = []
    for m in _WORD.finditer(_fold(text)):
        tok = m.group()
        pos = 0
        for u in _UNSPACED.finditer(tok):
            if u.start() > pos:
                _add(out, tok[pos : u.start()], drop)
            # a stop character splits the run in two; pair what is left
            for part in _split_on_stops(u.group()):
                out.extend((c, c) for c in part)
                out.extend((part[i] + part[i + 1],) * 2 for i in range(len(part) - 1))
            pos = u.end()
        if pos < len(tok):
            _add(out, tok[pos:], drop)
    return out


def _split_on_stops(run):
    parts, cur = [], []
    for c in run:
        if c in _UNSPACED_STOP:
            if cur:
                parts.append(cur)
            cur = []
        else:
            cur.append(c)
    if cur:
        parts.append(cur)
    return parts


def _add(out, tok, drop):
    tok = tok.strip("_")
    if not tok:
        return
    s = _stem(tok)
    if s not in drop:
        out.append((s, tok))


def _drop_set(lang):
    """The function-word stems for a language. A language that could not be
    told gets every list, a few words dearer than the right one but never a
    sentence of function words counted as a match."""
    lists = [_FUNCTION[lang]] if lang in _FUNCTION else _FUNCTION.values()
    return frozenset(_stem(w) for words_ in lists for w in words_)


def query_language(q):
    """The query's language when it can be told, else ''."""
    from zimi.interlang import _detect_query_language

    return _detect_query_language(q) or ""


def content_query(q):
    """The query's own words with the function and question words left out,
    as typed (not stemmed): what a search that keeps them would find."""
    drop = _drop_set(query_language(q))
    keep = []
    for m in _WORD.finditer(q):
        tok = m.group()
        stem = _stem(_fold(tok).strip("_") or "_")
        if stem not in drop and stem not in _ASKING_STEMS:
            keep.append(tok)
    return " ".join(keep)


# ── is it a question? ─────────────────────────────────────────────────────


def worth_asking(q):
    """True when the query reads as a question to the library.

    A question mark, or an opening question word, in any language Zimi has a
    list for; or a phrase of three words that says something ("mona lisa
    painter"). One or two words are a keyword search: the results are the
    answer and the card would only repeat them. A query using the search
    grammar (quotes, minus, OR, in:) asks for something exact and gets none.
    """
    q = (q or "").strip()
    if not q or len(q) > 200 or not _query.parse_query(q)["plain"]:
        return False
    lang = query_language(q)
    content = words(q, _drop_set(lang))
    terms = [w for w in content if w not in _ASKING_STEMS]
    first = (_query.fold(q.split()[0]) if q.split() else "").strip("¿¡?")
    if first in _ASKING or _ASKING_ANYWHERE.search(q):
        return len(terms) >= 1
    phrase = len(q.split()) >= 3 or (bool(_UNSPACED.search(q)) and len(q) >= 6)
    return phrase and len(terms) >= 2


_ASKING_STEMS = frozenset(_stem(_query.fold(w)) for w in _ASKING)


# ── sentences ──────────────────────────────────────────────────────────────


def split_sentences(text):
    """(start, end) of each sentence in `text`, none across a line break (a
    heading or a table row is not the start of the next sentence). A period
    after an abbreviation or a single capital letter, or before a lower-case
    letter, is not an end."""
    out = []
    for block in re.finditer(r"[^\n]+", text):
        out.extend(_split_block(text, block.start(), block.end()))
    return out


def _split_block(text, lo, hi):
    spans, start = [], lo
    for m in _BOUNDARY.finditer(text, lo, hi):
        end = m.end()
        if m.group().strip()[0] not in _ENDERS:
            head = text[start : m.start()].split()
            last = head[-1].lower().strip("(\"'") if head else ""
            if m.group().startswith(".") and (
                last in _ABBREV or (len(last) == 1 and last.isalpha())
            ):
                continue
            if end < hi and text[end].islower():
                continue
        spans.append((start, end))
        start = end
    if start < hi:
        spans.append((start, hi))
    return [
        (s + len(text[s:e]) - len(text[s:e].lstrip()), e - (len(text[s:e]) - len(text[s:e].rstrip())))
        for s, e in spans
        if text[s:e].strip()
    ]


_CLOSERS = "\"'\u201d\u2019)]\u00bb\u300d\u300f \t"
_TERMINAL = ".!?\u3002\uff01\uff1f\u061f\u0964\u2026"


def _is_title_line(sent, title):
    """The title of the work said as a sentence (a book's title page): it
    holds the question's words and answers nothing."""
    s = _fold(sent).strip(" .:;,-")
    t = _fold(title).strip(" .:;,-")
    return bool(t) and (s in t or t in s) and len(s) < len(t) + TITLE_LINE_SLACK


def _sentence_ok(sent):
    """A whole sentence of prose: ends like one, starts like one, is neither
    a fragment cut by a passage edge nor a heading, a table row or a citation."""
    n = len(sent)
    unspaced = bool(_UNSPACED.search(sent))
    if n < (SENTENCE_MIN_UNSPACED if unspaced else SENTENCE_MIN) or n > SENTENCE_MAX:
        return False
    if sent.rstrip(_CLOSERS)[-1:] not in _TERMINAL:
        return False
    first = next((c for c in sent if c.isalpha()), "")
    if first.islower():
        return False
    letters = sum(1 for c in sent if c.isalpha())
    return letters >= n * 0.5


# ── ranking ────────────────────────────────────────────────────────────────


class _Pool:
    """Passages from the candidate articles. Only a passage holding one of the
    question's stems is read word by word (a string search finds those far
    faster than tokenising all of them); the others cannot score."""

    def __init__(self, passages, drop, terms):
        self.passages = passages
        self.tokens = []
        for p in passages:
            low = p["text"].lower().translate(_FAST_FOLD)
            self.tokens.append(
                words(p["text"], drop) if any(t in low for t in terms) else []
            )
        self.df = collections.Counter()
        for toks in self.tokens:
            self.df.update(set(toks))
        self.n = len(passages)
        live = [len(t) for t in self.tokens if t]
        self.avg = sum(live) / len(live) if live else 0

    def idf(self, term):
        df = self.df.get(term, 0)
        return math.log(1 + (self.n - df + 0.5) / (df + 0.5))

    def bm25(self, i, terms):
        toks = self.tokens[i]
        if not toks:
            return 0.0
        freq = collections.Counter(toks)
        norm = BM25_K1 * (1 - BM25_B + BM25_B * len(toks) / (self.avg or 1))
        return sum(
            self.idf(t) * freq[t] * (BM25_K1 + 1) / (freq[t] + norm)
            for t in terms
            if t in freq
        )


def _coverage(terms, weight, sent_tokens, exact=None):
    """(share of the question's weight the sentence holds, how many of its
    words, tightness 0..1). `sent_tokens`: the sentence's stems in order.
    `exact`: the terms the sentence holds as the very word asked, not only
    its stem (preside for president); those count WEAK_MATCH of their weight.
    None: every match is the very word."""
    present = set(sent_tokens)
    have = [t for t in terms if t in present]
    total = sum(weight[t] for t in terms)
    if not have or total <= 0:
        return 0.0, 0, 0.0
    held = lambda t: weight[t] * (1 if exact is None or t in exact else WEAK_MATCH)
    cover = sum(held(t) for t in have) / total
    # The shortest run of the sentence holding every covered word: 1 when the
    # words sit side by side, less the further apart they are.
    need = set(have)
    pos = [(i, t) for i, t in enumerate(sent_tokens) if t in need]
    best, left, seen = None, 0, collections.Counter()
    for right, (ri, rt) in enumerate(pos):
        seen[rt] += 1
        while len(seen) == len(need):
            width = ri - pos[left][0] + 1
            best = width if best is None else min(best, width)
            lt = pos[left][1]
            seen[lt] -= 1
            if not seen[lt]:
                del seen[lt]
            left += 1
    tight = len(need) / best if best else 0.0
    return cover, len(need), min(1.0, tight)


def _title_share(terms, weight, title, drop):
    held = set(words(title, drop))
    total = sum(weight[t] for t in terms)
    return sum(weight[t] for t in terms if t in held) / total if total else 0.0


def _window(passage, start, end, before, after):
    """The passage cut to a window around the sentence, at word edges."""
    b = passage[:start]
    if len(b) > before:
        b = passage[start - before : start]
        sp = b.find(" ")
        b = "…" + (b[sp + 1 :] if 0 <= sp < 60 else b)
    a = passage[end:]
    if len(a) > after:
        a = passage[end : end + after]
        sp = a.rfind(" ")
        a = (a[:sp] if sp > after - 60 else a) + "…"
    return b, passage[start:end], a


def rank_answer(q, passages, lang=None):
    """The best quote for `q` among `passages`, with up to EXTRA_MAX more.

    `passages`: dicts with zim, path, title, text, seq (position in its
    article), rank (the article's place in the search). Returns None when no
    sentence covers enough of the question, else
    {"answer": quote, "more": [quote, ...]}; a quote is {zim, path, title,
    before, sentence, after, score}.
    """
    lang = query_language(q) if lang is None else lang
    drop = _drop_set(lang)
    asked = [(st, w) for st, w in read(q, drop) if st not in _ASKING_STEMS]
    terms = list(dict.fromkeys(st for st, _ in asked))
    asked_as = collections.defaultdict(set)
    for st, w in asked:
        asked_as[st].add(w)
    if not terms or not passages:
        return None
    pool = _Pool(passages, drop, terms)
    weight = {t: pool.idf(t) for t in terms}
    # A term no passage holds weighs what a rare one does: the library does
    # not answer that part of the question, and the card must not pretend.
    floor = max(weight.values()) if weight else 0
    for t in terms:
        if pool.df.get(t, 0) == 0:
            weight[t] = max(weight[t], floor)

    scored = []
    for i, p in enumerate(passages):
        bonus = TITLE_BONUS * _title_share(terms, weight, p["title"], drop)
        scored.append((pool.bm25(i, terms) * (1 + bonus), i))
    scored.sort(reverse=True)
    top = [i for s, i in scored[:CANDIDATE_POOL] if s > 0]
    if rerank:
        order = {id(p): n for n, p in enumerate(rerank(q, [passages[i] for i in top]))}
        top.sort(key=lambda i: order.get(id(passages[i]), len(order)))

    quotes = []
    for i in top:
        p = passages[i]
        text = p["text"]
        title_bonus = TITLE_BONUS * _title_share(terms, weight, p["title"], drop)
        for s, e in split_sentences(text):
            sent = text[s:e]
            if not _sentence_ok(sent) or _is_title_line(sent, p["title"]):
                continue
            pairs = read(sent, drop)
            said = {w for _, w in pairs}
            exact = {t for t in terms if asked_as[t] & said}
            cover, matched, tight = _coverage(
                terms, weight, [st for st, _ in pairs], exact
            )
            if matched < min(2, len(terms)):
                continue
            score = cover * (TIGHTNESS_FLOOR + (1 - TIGHTNESS_FLOOR) * tight)
            score *= 1 - LONG_PENALTY * min(1, max(0, len(sent) - LONG_FROM) / LONG_SPAN)
            score += title_bonus * cover
            score += LEAD_BONUS * (p.get("seq", 1) == 0)
            score -= RANK_DECAY * p.get("rank", 0)
            quotes.append((score, i, s, e))
    if not quotes:
        return None
    quotes.sort(key=lambda x: (-x[0], x[1], x[2]))
    if quotes[0][0] < CONFIDENCE:
        return None

    def make(q_):
        score, i, s, e = q_
        p = passages[i]
        b, sent, a = _window(p["text"], s, e, CONTEXT_BEFORE, CONTEXT_AFTER)
        return {
            "zim": p["zim"],
            "path": p["path"],
            "title": p["title"],
            "before": b,
            "sentence": sent,
            "after": a,
            "score": round(score, 3),
        }

    best = quotes[0]
    chosen, taken = [], {(passages[best[1]]["zim"], passages[best[1]]["path"])}
    for q_ in quotes[1:]:
        key = (passages[q_[1]]["zim"], passages[q_[1]]["path"])
        if key in taken or q_[0] < CONFIDENCE * 0.9 or q_[0] < best[0] * EXTRA_RELATIVE:
            continue
        taken.add(key)
        chosen.append(make(q_))
        if len(chosen) == EXTRA_MAX:
            break
    return {"answer": make(best), "more": chosen}


# ── the whole path ─────────────────────────────────────────────────────────

_cache = collections.OrderedDict()
_cache_lock = threading.Lock()


def _cache_get(key):
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_TTL:
            _cache.move_to_end(key)
            return hit[1]
        _cache.pop(key, None)
    return None


def _cache_put(key, value):
    with _cache_lock:
        _cache[key] = (time.time(), value)
        while len(_cache) > CACHE_MAX:
            _cache.popitem(last=False)


def cache_clear():
    with _cache_lock:
        _cache.clear()


def _readable_hits(results, kinds):
    """The search results worth reading: articles, in the search's order, not
    maps, videos or a second page of one article."""
    seen, out = set(), []
    for r in results:
        key = (r.get("zim"), r.get("path"))
        if key in seen or kinds.get(r.get("zim")) in ("map", "video"):
            continue
        seen.add(key)
        out.append(r)
        if len(out) == MAX_CANDIDATES:
            break
    return out


def lead_text(text, title):
    """An article's first passage without the title said over again at its
    head (the page's <title> and its heading come out as the same words in
    front of the first paragraph), keeping the one a sentence may begin with."""
    low, t = text.lower(), title.lower().strip()
    if not t:
        return text
    while low.startswith(t) and low[len(t) :].lstrip().startswith(t):
        text = text[len(t) :].lstrip()
        low = text.lower()
    return text


def best_answer(q, hits, read_chunks, kinds=None, budget=BUDGET_SECONDS):
    """The card for `q`, or {"answer": None}.

    `hits`: the search's results, ranked. `read_chunks(zim, path)`: that
    article's chunks ({"seq", "text"}), taking whatever lock the library
    needs for as long as one article takes and no longer. Articles are read in
    rank order until `budget` seconds are spent, so a slow disk gives a card
    from fewer articles, never a late one.
    """
    if not worth_asking(q):
        return {"answer": None}
    t0 = time.time()
    passages = []
    kinds = kinds or {}
    for rank, hit in enumerate(_readable_hits(hits, kinds)):
        if rank and time.time() - t0 > budget:
            break
        try:
            chunks = read_chunks(hit["zim"], hit["path"])
        except Exception as e:  # one unreadable page must not lose the card
            log.debug("best answer: %s/%s unreadable: %s", hit["zim"], hit["path"], e)
            continue
        for c in chunks[:MAX_CHUNKS_PER_ARTICLE]:
            if c["seq"] == 0 and kinds.get(hit["zim"]) in FRONT_MATTER_KINDS:
                continue
            passages.append(
                {
                    "zim": hit["zim"],
                    "path": hit["path"],
                    "title": hit.get("title") or hit["path"],
                    "text": lead_text(c["text"], hit.get("title") or "")
                    if c["seq"] == 0
                    else c["text"],
                    "seq": c["seq"],
                    "rank": rank,
                }
            )
    found = rank_answer(q, passages)
    if not found:
        return {"answer": None}
    return found


def cached_best_answer(key, compute):
    """`compute()` once per key for CACHE_TTL: the same question asked again
    (Back, a second tab) costs nothing, and the cache is bounded."""
    hit = _cache_get(key)
    if hit is not None:
        return hit
    value = compute()
    _cache_put(key, value)
    return value
