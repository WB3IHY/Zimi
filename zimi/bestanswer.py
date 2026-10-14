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
TITLE_BONUS = 0.25  # max added when the article's title holds the question
LEAD_BONUS = 0.04  # the first passage of an article is its summary
RANK_DECAY = 0.015  # per search rank: the search already ordered the articles
CACHE_MAX = 64
CACHE_TTL = 120.0

# The seam for a reranker (see the module docstring): a callable taking the
# question and the candidate passages and returning them best first. None:
# BM25 order.
rerank = None

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
    out = []
    for m in _WORD.finditer(_query.fold(text)):
        tok = m.group()
        pos = 0
        for u in _UNSPACED.finditer(tok):
            if u.start() > pos:
                _add(out, tok[pos : u.start()], drop)
            # a stop character splits the run in two; pair what is left
            for part in _split_on_stops(u.group()):
                out.extend(part)
                out.extend(part[i] + part[i + 1] for i in range(len(part) - 1))
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
    s = _stem(tok.strip("_"))
    if s and s not in drop:
        out.append(s)


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
    """(start, end) of each sentence in `text`. A period after an abbreviation
    or a single capital letter, or before a lower-case letter, is not an end."""
    spans, start, n = [], 0, len(text)
    for m in _BOUNDARY.finditer(text):
        end = m.end()
        stripped = text[start : m.start() + 1]
        if text[m.start()] in _ENDERS or m.group().strip()[0] in _ENDERS:
            pass
        else:
            word = re.split(r"\s", stripped.rstrip(".!?"))[-1] if stripped else ""
            tail = word.lower().strip("(\"'")
            nxt = text[end : end + 1]
            if m.group().startswith(".") and (
                tail in _ABBREV or (len(tail) == 1 and tail.isalpha())
            ):
                continue
            if nxt and nxt.islower():
                continue
        spans.append((start, m.end()))
        start = end
    if start < n:
        spans.append((start, n))
    # trim whitespace inside each span
    out = []
    for s, e in spans:
        while s < e and text[s].isspace():
            s += 1
        while e > s and text[e - 1].isspace():
            e -= 1
        if e > s:
            out.append((s, e))
    return out


def _sentence_ok(sent):
    n = len(sent)
    unspaced = bool(_UNSPACED.search(sent))
    if n < (SENTENCE_MIN_UNSPACED if unspaced else SENTENCE_MIN) or n > SENTENCE_MAX:
        return False
    letters = sum(1 for c in sent if c.isalpha())
    return letters >= n * 0.5  # not a table row, a list of numbers, a citation


# ── ranking ────────────────────────────────────────────────────────────────


class _Pool:
    """Passages from the candidate articles, tokenised once."""

    def __init__(self, passages, drop):
        self.passages = passages
        self.tokens = [words(p["text"], drop) for p in passages]
        self.df = collections.Counter()
        for toks in self.tokens:
            self.df.update(set(toks))
        self.n = len(passages)
        self.avg = (sum(len(t) for t in self.tokens) / self.n) if self.n else 0

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


def _coverage(terms, weight, sent_tokens):
    """(share of the question's weight the sentence holds, tightness 0..1)."""
    have = [t for t in terms if t in sent_tokens]
    total = sum(weight[t] for t in terms)
    if not have or total <= 0:
        return 0.0, 0, 0.0
    cover = sum(weight[t] for t in have) / total
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
    terms = list(dict.fromkeys(t for t in words(q, drop) if t not in _ASKING_STEMS))
    if not terms or not passages:
        return None
    pool = _Pool(passages, drop)
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
            if not _sentence_ok(sent):
                continue
            cover, matched, tight = _coverage(terms, weight, set(words(sent, drop)))
            if matched < min(2, len(terms)):
                continue
            score = cover * (0.7 + 0.3 * tight) + title_bonus * cover
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
    for rank, hit in enumerate(_readable_hits(hits, kinds or {})):
        if rank and time.time() - t0 > budget:
            break
        try:
            chunks = read_chunks(hit["zim"], hit["path"])
        except Exception as e:  # one unreadable page must not lose the card
            log.debug("best answer: %s/%s unreadable: %s", hit["zim"], hit["path"], e)
            continue
        for c in chunks[:MAX_CHUNKS_PER_ARTICLE]:
            passages.append(
                {
                    "zim": hit["zim"],
                    "path": hit["path"],
                    "title": hit.get("title") or hit["path"],
                    "text": c["text"],
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
