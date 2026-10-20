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
import os
import re
import threading
import time

from zimi import query as _query

log = logging.getLogger("zimi")

# The card is off unless the operator turns it on. The release gate (30 real
# questions, tests/data/bestanswer_eval_questions.json) found it quoting a
# wrong or off-topic sentence far more often than 1 time in 15, and a
# confident wrong answer is worse than none.
ENV = "ZIMI_BEST_ANSWER"


def enabled():
    return os.environ.get(ENV, "").strip().lower() in ("1", "true", "yes", "on")


# ── knobs, each with the reason it is what it is ──────────────────────────
PASSAGE_SIZE = 2000  # chars per chunk: an article lead whole, so its sentences keep their order
MAX_CANDIDATES = 6  # articles read per question
MAX_CHUNKS_PER_ARTICLE = 18  # ~36k chars: the lead and a long way past it
CANDIDATE_POOL = 8  # passages whose sentences are scored after BM25
BUDGET_SECONDS = 1.5  # stop reading more articles after this long
CONFIDENCE = 0.75  # a sentence below this covers too little of the question
WEAK_MATCH = 0.65 # a word matched by its stem alone (president, preside) counts this much
TITLE_CREDIT = 0.55  # a word of the question that is in the article's title, not in the sentence
IMPLIED_CREDIT = 0.7  # the same, for a sentence that says "It ..." in the first sentences of a lead
SUBJECT_MIN = 0.5  # share of the question an article's title must hold for any sentence of it but its first to be quoted
COPULA_PENALTY = 0.15  # "It is ..." answering what something does
ORDINAL_PENALTY = 0.5  # "the second largest" answering the largest
COVER_MIN = 0.75  # share of the question a sentence must stand for before it is a candidate
LEAD_SPAN = 6  # sentences of an article's opening that count as its lead
LEAD_EXTRA = 4  # opening passages of articles titled as asked, read though BM25 ranks them low
DEFINE_BONUS = 0.3  # for the first sentence of the lead, answering "what is X" (halved for each sentence after)
FUNCTION_BONUS = 0.2  # for a lead sentence that says "It ...", answering "what does X do"
DATE_BONUS = 0.12  # a sentence with a year in it, answering "when"; with a number, "how many/tall/long"
DATE_PENALTY = 0.3  # the same question, a sentence with none
CAUSE_BONUS = 0.15  # a sentence with a cause in it, answering "what causes" (one without is not quoted)
NAME_BONUS = 0.15  # a sentence with a name in it, answering "who"
LONG_FROM = 220  # chars: a sentence longer than this is a worse quote ...
LONG_PENALTY = 0.12  # ... losing up to this share of its score by LONG_FROM + LONG_SPAN
LONG_SPAN = 300  # (Wikipedia's opening sentences run 150 to 350)
TIGHTNESS_FLOOR = 0.6  # a sentence with the words far apart keeps this share of its score
UNQUOTABLE_KINDS = ("map", "video", "books")  # a card quotes an article, not a place, a talk or a shelf of old books
TITLE_LINE_SLACK = 12  # chars a sentence may exceed the title by and still be only the title
EXTRA_MAX = 2  # more passages under the card
EXTRA_RELATIVE = 0.7  # an extra must be this fraction as good as the best
CONTEXT_BEFORE = 240  # chars of the passage kept before the sentence
CONTEXT_AFTER = 160  # and after it
SENTENCE_MIN = 20  # chars; 8 for scripts written without spaces
SENTENCE_MIN_UNSPACED = 8
SENTENCE_MAX = 700
STEM_LEN = 5
BM25_K1 = 1.2
BM25_B = 0.75
TITLE_BONUS = 0.6   # max added when the article's title holds the question
LEAD_BONUS = 0.15  # the first sentence of an article is its summary (halved for each sentence after)
RANK_DECAY = 0.015  # per search rank: the search already ordered the articles
TITLE_QUERIES_MAX = 14  # title-index lookups a sparse question may make
SPARSE_HITS = 3  # fewer search hits than this: ask again without function words
CACHE_MAX = 64
CACHE_TTL = 120.0

# The seam for a reranker (see the module docstring): a callable taking the
# question and the candidate passages and returning them best first. None:
# BM25 order.
rerank = None
# A list to which rank_answer appends what it considered, for a person tuning it.
TRACE = None

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

# A word: letters and digits, plus the marks that belong to a letter (Latin
# accents, Hebrew points, Arabic vowels) and the whole Indic block (its vowel
# signs are marks, and \w would cut a word at each). Raw, so no tool rewrites
# the escapes into characters nobody can read.
_WORD = re.compile(
    r"[\w\u0300-\u036f\u0591-\u05c7\u064b-\u065f\u0670\u0900-\u0dff]+"
)
# Scripts written without spaces: kana, Han and its compatibility forms.
_UNSPACED = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+")
# Characters that are all function in an unspaced script ("is", "of", "who",
# "?"): dropped from the query and the text before pairs are made.
_UNSPACED_STOP = frozenset(
    "的是了在有和与或吗呢么谁什哪怎如何为麼誰什嗎的は、がをにへでとのもか"
)

_ASKING = _query.ASKING
QUESTION_WORDS = _query.QUESTION_WORDS
_ASKING_ANYWHERE = re.compile(
    "[?？؟]|什么|谁|怎么|怎样|如何|为什么|哪|吗|嗎|いつ|だれ|どこ|なぜ|どう|何"
)

_FUNCTION = {
    "en": "the a an of in on at to for from by with and or is are was were be been do does did can could how what who whom when where why which that this these those it its as into about than then there their like".split(),
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
_DOTTED = re.compile(r"^(?:\w\.)+\w$")
_ENDERS = "。！？．｡"
_BOUNDARY = re.compile(r"[.!?؟।]+[\"'”’)\]]*\s+|[。！？]+[\"'”’）」』]*")


# ── words ──────────────────────────────────────────────────────────────────


_SUFFIXES = ("ings", "ing", "ed", "es", "s")
# The few verbs a question asks with whose forms do not share a stem: wrote and
# written, began and started. One word each, so a question and its answer meet.
_IRREGULAR = {
    w: base
    for base, forms in {
        "write": "wrote written writes writing",
        "begin": "began begun begins beginning start starts started starting",
        "build": "built builds building",
        "make": "made makes making",
        "win": "won wins winning",
        "fall": "fell fallen falls falling",
        "run": "ran runs running",
        "lead": "led leads leading",
        "teach": "taught teaches",
        "find": "found finds",
    }.items()
    for w in forms.split()
}


def _stem(word):
    if word.isdigit():
        return word
    if word.startswith("ال") and len(word) > 4:  # Arabic "the"
        word = word[2:]
    if word[0] > "\u024f":
        # Cyrillic, Greek, Arabic, Hebrew, Indic: the ending is the inflection
        # (мону/мона), so cut one letter and keep the front.
        return word[: max(3, min(len(word) - 1, STEM_LEN + 1))]
    word = _IRREGULAR.get(word, word)
    # Latin: the commonest endings off (landed, landing, lands: land; causes,
    # cause: caus), then the front. A four-letter word and its inflection
    # would not meet at five letters otherwise.
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            word = word[: -len(suffix)]
            break
    if word.endswith("e") and len(word) >= 5:
        word = word[:-1]
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
        # the word as folded, one number: vaccine and vaccines are the same word
        tok = _IRREGULAR.get(tok, tok)
        out.append((s, tok[:-1] if len(tok) > 3 and tok.endswith("s") and not tok.endswith("ss") else tok))


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


def title_queries(q, cap=TITLE_QUERIES_MAX):
    """Title-index queries for a question the search found little for: runs of
    consecutive content words, longest first, each as typed and then cut to
    its stems ("purif water" is a title that begins "Water" and holds "purif").
    At most `cap`."""
    words_ = content_query(q).split()
    stems = [_stem(_fold(w)) if len(w) > STEM_LEN else w for w in words_]
    out = []
    for n in range(len(words_), 0, -1):
        for i in range(len(words_) - n + 1):
            for run in (words_[i : i + n], stems[i : i + n]):
                text = " ".join(run)
                if text not in out:
                    out.append(text)
    return out[:cap]


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
            last = head[-1].lower().strip("([\"'") if head else ""
            if m.group().startswith(".") and (
                last in _ABBREV
                or (len(last) == 1 and last.isalpha())
                or _DOTTED.match(last)  # O.S. U.S. a.m.
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
    if _PATHS.search(sent):
        return False
    # a bracket left open is a sentence cut in the middle
    if sent.count("(") != sent.count(")") or sent.count("[") != sent.count("]"):
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


# What a question is after, from how it opens, in the languages with a list.
# The kind decides what a good sentence looks like: a definition is the first
# sentence of the article about the thing; a date has a number in it.
_DEFINE = re.compile(
    r"^\s*(?:what(?:\s+is|\s+are|\s+was|\s+were|['’]s)\b|who(?:\s+is|\s+are|\s+was|\s+were|['’]s)\b"
    r"|define\b|was\s+(?:ist|sind|war|waren)\b|wer\s+(?:ist|war)\b"
    r"|qu['’]?est-ce\s+qu|qui\s+(?:est|était|etait)\b|qu[eé]\s+(?:es|son)\b|qui[eé]n\s+(?:es|fue)\b"
    r"|cos['’]?è\b|chi\s+è\b|o\s+que\s+é\b|quem\s+é\b|wat\s+is\b|wie\s+is\b"
    r"|что\s+так|кто\s+так|кто\s+был|что\s+за\b|ما\s+هو|ما\s+هي|من\s+هو|من\s+هي"
    r"|क्या\s+है|कौन\s+है|מה\s+(?:היא|הוא|זה|זאת|הם)\b|מי\s+(?:היה|היתה|היא|הוא)\b|什么是|谁是)",
    re.I,
)
_FUNCTION_Q = re.compile(
    r"^\s*(?:what\s+(?:does|do)\b.*\b(?:do|mean)\b|how\s+(?:does|do)\b.*\bwork\b)", re.I
)
_WHEN_Q = re.compile(
    r"^\s*(?:when|wann|quand|cuando|cuándo|quando|wanneer|когда|متى|מתי|कब)\b|什么时候|何时",
    re.I,
)
_COUNT_Q = re.compile(
    r"^\s*(?:how\s+(?:many|much|tall|long|high|big|large|far|old|fast|deep|wide|heavy|hot)\b"
    r"|wie\s+(?:viel|viele|lang|hoch|groß|gross|alt|weit|schnell|tief)\b|combien\b"
    r"|cu[aá]nt[oa]s?\b|quant[oi]s?\b|hoeveel\b|сколько\b|כמה\b|كم\b|कितना\b|多少|多长|多高)",
    re.I,
)
_NUMBER = re.compile(r"\d")
_YEAR = re.compile(r"\b\d{3,4}\b")
# A sentence that speaks of the article's subject without naming it: "It
# regulates ...", "He is the creator of ...", in the first sentences of a lead.
_PRONOUN_START = re.compile(
    r"^(?:it|he|she|they|this|these|its|his|her|their|er|sie|es|dies|dieser|diese|il|elle|ils|elles|ce|cette"
    r"|él|ella|ello|esto|ele|ela|lui|isso|הוא|היא|הם|הן|זה|זו|он|она|они|это|هو|هي|هذا|هذه|वह|यह)\b",
    re.I,
)


_CAUSE_Q = re.compile(r"^\s*(?:what\s+(?:causes|caused|makes|made)|why\s+(?:do|does|did|is|are|was|were))\b", re.I)
_CAUSAL = re.compile(
    r"\b(?:caused?|causing|due\s+to|because|result(?:s|ed|ing)?\s+(?:of|from|in)|driven\s+by|leads?\s+to|led\s+to"
    r"|owing\s+to|arises?\s+from|stems?\s+from)\b",
    re.I,
)
# Words of a question that ask for a kind of fact and are not about the subject:
# "how tall" (the sentence has a number), "how does it work", "what causes".
_ASKS = {
    "count": "tall long high big large far old fast deep wide heavy hot much many lang hoch groß gross alt weit schnell tief",
    "function": "work works do does mean",
    "cause": "cause causes caused make makes made why",
}
# What a sentence says when it answers "how tall / long / old ...": the measure's
# own words or its units, beside a number. "how many / much" needs only the number.
_TALL = r"tall|height|high|elevation|metres?|meters?|feet|foot|ft|hoch|höhe"
_MEASURE_CUES = {
    "long": r"long|length|lang|länge|km(?![\d²³])|(?<!cubic )(?<!square )kilomet\w*|(?<!cubic )(?<!square )miles?",
    "tall": _TALL,
    "high": _TALL,
    "big": r"size|area|large|big|square|km2|groß|größe",
    "large": r"size|area|large|big|square|km2|groß|größe",
    "old": r"years?|age|aged|old|born|founded|alt|jahre",
    "deep": r"depth|deep|metres?|meters?|tief",
    "wide": r"width|wide|metres?|meters?|breit",
    "heavy": r"weigh\w*|mass|kg|tonnes?|tons?|pounds?|schwer|gewicht",
    "fast": r"speed|fast|km/h|mph|schnell",
    "far": r"distance|far|km(?![\d²³])|(?<!cubic )(?<!square )kilomet\w*|(?<!cubic )(?<!square )miles?|weit",
    "hot": r"temperature|°|degrees|hot|heiß",
    "lang": r"long|length|lang|länge|km(?![\d²³])|(?<!cubic )(?<!square )kilomet\w*|(?<!cubic )(?<!square )miles?",
    "hoch": _TALL,
}
_QUANTITY_Q = re.compile(r"^\s*(?:how\s+(?:many|much)|wie\s+viel|combien|cu[aá]nt|quant|hoeveel|сколько|כמה|كم)", re.I)
_WHO_Q = re.compile(r"^\s*(?:who|wer|qui|qui[eé]n|chi|quem|wie|кто|מי|من|कौन|谁)\b", re.I)
# A name inside a sentence: a word with a capital that is not its first.
_CAPITAL_WORD = re.compile(r"(?<=\s)[A-ZÀ-ÖØ-Þ]\w+")
_COPULA = re.compile(r"^(?:it|he|she|they)\s+(?:is|are|was|were)\b", re.I)
_SUPERLATIVE = re.compile(r"\b\w{3,}est\b", re.I)
_ORDINAL_SUPERLATIVE = re.compile(
    r"\b(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)[- ](?:\w+[- ])?\w{3,}est\b", re.I
)
_PATHS = re.compile(r"\w/[^/\n]{1,40}/\w")  # "Japan/Get around/Smart cards": a link, not a sentence


def _measures(q, sent):
    """Whether `sent` gives the measure `q` asks for: a number and, for "how
    tall", the words of height; for "how many", the number alone."""
    if not _NUMBER.search(sent):
        return False
    if _QUANTITY_Q.search(q):
        return True
    for adj, cue in _MEASURE_CUES.items():
        if re.search(r"\b%s\b" % adj, q, re.I) and re.search(
            r"(?<![a-z])(?:%s)(?![a-z])" % cue, sent, re.I
        ):
            return True
    return False


def _has_name(sent, terms, title_stems, drop):
    """A capitalised word in `sent` that the question did not say and the
    article's title does not: a name, which is what "who" asks for."""
    for m in _CAPITAL_WORD.finditer(sent):
        st = _stem(_fold(m.group()))
        if st not in terms and st not in title_stems and st not in drop:
            return True
    return False


def question_kind(q):
    """'define', 'function', 'when', 'count', 'who' or 'other'."""
    if _DEFINE.search(q):
        return "define"
    if _FUNCTION_Q.search(q):
        return "function"
    if _WHEN_Q.search(q):
        return "when"
    if _COUNT_Q.search(q):
        return "count"
    if _CAUSE_Q.search(q):
        return "cause"
    if _WHO_Q.search(q):
        return "who"
    return "other"


def _cover(terms, weight, pairs, exact, title_stems, implied_credit=None):
    """(share of the question's weight the sentence stands for, how many of the
    question's words are in the sentence itself, tightness 0..1).

    A word of the question is credited as the very word asked (1), as its stem
    alone (WEAK_MATCH: preside for president), or, absent from the sentence,
    as part of the article's title (TITLE_CREDIT: the article is about it) or,
    in a sentence that speaks of the article's subject without naming it, as
    that subject (IMPLIED_CREDIT)."""
    tokens = [st for st, _ in pairs]
    present = set(tokens)
    total = sum(weight[t] for t in terms)
    if total <= 0:
        return 0.0, 0, 0.0
    held, inside = 0.0, []
    for t in terms:
        credit = 0.0
        if t in present:
            credit = 1.0 if t in exact else WEAK_MATCH
            inside.append(t)
        if t in title_stems:
            credit = max(credit, implied_credit or TITLE_CREDIT)
        held += weight[t] * credit
    # The shortest run of the sentence holding every word it has: 1 when the
    # words sit side by side, less the further apart they are.
    tight = 1.0
    if len(inside) > 1:
        need = set(inside)
        pos = [(i, t) for i, t in enumerate(tokens) if t in need]
        best, left, seen = None, 0, collections.Counter()
        for ri, rt in pos:
            seen[rt] += 1
            while len(seen) == len(need):
                width = ri - pos[left][0] + 1
                best = width if best is None else min(best, width)
                lt = pos[left][1]
                seen[lt] -= 1
                if not seen[lt]:
                    del seen[lt]
                left += 1
        tight = min(1.0, len(need) / best) if best else 0.0
    return held / total, len(inside), tight


def _title_stems(title, drop):
    return set(words(title, drop))


def _title_share(terms, weight, title, drop):
    held = _title_stems(title, drop)
    total = sum(weight[t] for t in terms)
    return sum(weight[t] for t in terms if t in held) / total if total else 0.0


def _title_count(terms, title, drop):
    """The share of the question's words that are in the title, each as one
    (the weights make a rare verb outweigh the subject)."""
    held = _title_stems(title, drop)
    return sum(1 for t in terms if t in held) / len(terms) if terms else 0.0


def _prose(text, title):
    """[(start, end)] of the sentences of `text` that are prose, in order."""
    return [
        (s, e)
        for s, e in split_sentences(text)
        if _sentence_ok(text[s:e]) and not _is_title_line(text[s:e], title)
    ]


def _window(text, spans, k, before, after):
    """The sentence `k` of `spans` with whole sentences of its passage around
    it: those before it that fit in `before` characters and those after that
    fit in `after`, never a heading or a part of a sentence. '…' says there is
    more in the passage than is shown."""
    s, e = spans[k]
    lo = k
    while lo > 0 and s - spans[lo - 1][0] <= before:
        lo -= 1
    hi = k
    while hi + 1 < len(spans) and spans[hi + 1][1] - e <= after:
        hi += 1
    b = text[spans[lo][0] : s]
    a = text[e : spans[hi][1]]
    if lo > 0:
        b = "… " + b
    if hi + 1 < len(spans):
        a = a + " …"
    return b, text[s:e], a


def rank_answer(q, passages, lang=None, trace=None):
    """The best quote for `q` among `passages`, with up to EXTRA_MAX more.

    `passages`: dicts with zim, path, title, text, seq (position in its
    article), rank (the article's place in the search). Returns None when no
    sentence stands for enough of the question, else
    {"answer": quote, "more": [quote, ...]}; a quote is {zim, path, title,
    before, sentence, after, score}.
    """
    lang = query_language(q) if lang is None else lang
    drop = _drop_set(lang)
    kind = question_kind(q)
    asked = [(st, w) for st, w in read(q, drop) if st not in _ASKING_STEMS]
    # What the question asks of its subject is not a word to find in the
    # sentence: its shape (a number, a cause) is judged below instead.
    ask = {_stem(_fold(w)) for w in _ASKS.get(kind, "").split()}
    asked = [(st, w) for st, w in asked if st not in ask] or asked
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

    # The passages worth reading sentence by sentence: the best by BM25, and
    # the opening passage of every article whose title is what is asked about
    # (a definition is there, whatever BM25 makes of the rest of the page).
    scored = []
    for i, p in enumerate(passages):
        bonus = TITLE_BONUS * _title_share(terms, weight, p["title"], drop)
        scored.append((pool.bm25(i, terms) * (1 + bonus), i))
    scored.sort(reverse=True)
    top = [i for s, i in scored[:CANDIDATE_POOL] if s > 0]
    leads = [
        i
        for i, p in enumerate(passages)
        if p["seq"] == 0
        and i not in top
        and _title_share(terms, weight, p["title"], drop) >= 0.5
    ]
    top += leads[:LEAD_EXTRA]
    if rerank:
        order = {id(p): n for n, p in enumerate(rerank(q, [passages[i] for i in top]))}
        top.sort(key=lambda i: order.get(id(passages[i]), len(order)))

    quotes = []
    for i in top:
        p = passages[i]
        text = p["text"]
        tstems = set() if p.get("qa") else _title_stems(p["title"], drop)
        tshare = 0.0 if p.get("qa") else _title_share(terms, weight, p["title"], drop)
        tcount = 1.0 if p.get("qa") else _title_count(terms, p["title"], drop)
        spans = _prose(text, p["title"])
        for k, (s, e) in enumerate(spans):
            sent = text[s:e]
            pairs = read(sent, drop)
            said = {w for _, w in pairs}
            exact = {t for t in terms if asked_as[t] & said}
            # A lead is an encyclopedia's: a Q&A answer has none, and its "It" is
            # not the title's subject.
            lead = p["seq"] == 0 and k < LEAD_SPAN and not p.get("qa")
            implied = (
                lead
                and k > 0
                and kind != "define"
                and (kind == "count" or bool(_PRONOUN_START.match(sent)))
            )
            alone = implied and set(terms) <= tstems  # a question about the subject and nothing else
            cover, inside, tight = _cover(
                terms, weight, pairs, exact, tstems, 1.0 if alone else IMPLIED_CREDIT if implied else None
            )
            # A sentence with none of the question's words is only a candidate
            # when it speaks ("It ...") of a subject the whole question names.
            if cover < COVER_MIN or (not inside and not alone):
                continue
            # A sentence is quoted for a question when it is about the question's
            # subject: its article is titled for it, or this is the article's
            # first sentence, saying every word of the question as it was asked
            # ("Canberra is the capital city of Australia").
            if tcount < SUBJECT_MIN and not (
                lead and k == 0 and all(t in exact for t in terms)
            ):
                continue
            score = cover * (TIGHTNESS_FLOOR + (1 - TIGHTNESS_FLOOR) * tight)
            score *= 1 - LONG_PENALTY * min(
                1, max(0, len(sent) - LONG_FROM) / LONG_SPAN
            )
            score += TITLE_BONUS * tshare * cover
            if lead:
                # The opening sentence is the article's own statement of what
                # it is about; the next few say what it does.
                if kind == "define":
                    score += DEFINE_BONUS / (1 + k)
                elif kind == "function":
                    score += (FUNCTION_BONUS if implied else 0) + LEAD_BONUS / (1 + k)
                    score -= COPULA_PENALTY if _COPULA.match(sent) else 0
                else:
                    score += LEAD_BONUS / (1 + k)
            if kind == "who" and _has_name(sent, terms, tstems, drop):
                score += NAME_BONUS
            if _SUPERLATIVE.search(q) and _ORDINAL_SUPERLATIVE.search(sent):
                score -= ORDINAL_PENALTY
            if kind == "cause":
                if not _CAUSAL.search(sent):
                    continue
                score += CAUSE_BONUS
            if kind == "count" and not _measures(q, sent):
                continue
            if kind == "when":
                score += DATE_BONUS if _YEAR.search(sent) else -DATE_PENALTY
            elif kind == "count":
                score += DATE_BONUS if _NUMBER.search(sent) else -DATE_PENALTY
            score -= RANK_DECAY * p.get("rank", 0)
            quotes.append((score, i, k))
            if trace is not None:
                trace.append((round(score, 2), round(cover, 2), kind, p["title"][:24], p["seq"], k, len(sent), sent[:60]))
    if not quotes:
        return None
    quotes.sort(key=lambda x: (-x[0], x[1], x[2]))
    if quotes[0][0] < CONFIDENCE:
        return None

    spans_of = {}

    def make(q_):
        score, i, k = q_
        p = passages[i]
        if i not in spans_of:
            spans_of[i] = _prose(p["text"], p["title"])
        b, sent, a = _window(p["text"], spans_of[i], k, CONTEXT_BEFORE, CONTEXT_AFTER)
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
        if key in taken or q_[0] < CONFIDENCE or q_[0] < best[0] * EXTRA_RELATIVE:
            continue
        taken.add(key)
        chosen.append(make(q_))
        if len(chosen) == EXTRA_MAX:
            break
    return {"answer": make(best), "more": chosen}
# ── the whole path ─────────────────────────────────────────────────────────

_cache = collections.OrderedDict()
_cache_lock = threading.Lock()
_inflight = {}  # key -> Event, set when the card being made for it is cached


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


_UNQUOTABLE_PATH = re.compile(r"\.(pdf|epub)$", re.IGNORECASE)
_UNQUOTABLE_ZIM = "zimgit-"  # collections of PDFs


def _readable_hits(results, kinds):
    """The search results worth reading: articles, in the search's order, not
    maps, videos, PDFs (a whole one would be read under the library lock) or a
    second page of one article."""
    seen, out = set(), []
    for r in results:
        key = (r.get("zim"), r.get("path"))
        if (
            key in seen
            or kinds.get(r.get("zim")) in UNQUOTABLE_KINDS
            or _UNQUOTABLE_PATH.search(r.get("path") or "")
            or (r.get("zim") or "").startswith(_UNQUOTABLE_ZIM)
        ):
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


def best_answer(
    q, hits, read_chunks, kinds=None, budget=None, started=None
):
    """The card for `q`, or {"answer": None}.

    `hits`: the search's results, ranked. `read_chunks(zim, path)`: that
    article's chunks ({"seq", "text"}), taking whatever lock the library
    needs for as long as one article takes and no longer. Articles are read in
    rank order until `budget` seconds are spent, so a slow disk gives a card
    from fewer articles, never a late one. `started`: when the card's work
    began, if before this call (the searches that found `hits` count).
    """
    if not worth_asking(q):
        return {"answer": None}
    budget = BUDGET_SECONDS if budget is None else budget
    t0 = time.time() if started is None else started
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
                    "qa": bool(c.get("qa")),
                }
            )
    found = rank_answer(q, passages, trace=TRACE)
    if not found:
        return {"answer": None}
    return found


def cached_best_answer(key, compute):
    """`compute()` once per key for CACHE_TTL: the same question asked again
    (Back, a second tab) costs nothing, one asked while it is being made waits
    for that and shares it, and the cache is bounded."""
    while True:
        hit = _cache_get(key)
        if hit is not None:
            return hit
        with _cache_lock:
            slot = _inflight.get(key)
            owner = slot is None
            if owner:
                slot = _inflight[key] = threading.Event()
        if owner:
            break
        slot.wait(BUDGET_SECONDS * 4)
        hit = _cache_get(key)
        if hit is not None:
            return hit
        break  # the owner failed or took too long: make it here
    try:
        value = compute()
        _cache_put(key, value)
        return value
    finally:
        if owner:
            with _cache_lock:
                _inflight.pop(key, None)
            slot.set()
