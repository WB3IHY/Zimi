"""A realistic library for judging the best answer card, and the judging.

The corpus (tests/fixtures/best_answer/corpus.json) is real text: lead
sections of 46 English, 6 German and 5 Hebrew Wikipedia articles, three
Wikivoyage pages, and six StackOverflow / Super User questions with their
answers (see the README in that folder for the sources and the licence). It
is set into ZIMs shaped as mwoffliner and sotoki shape them. The questions
(questions.json) each name the sentence that answers them, or say the library
holds none.

    build_library(dir)      writes the ZIMs into `dir`
    evaluate(srv)           asks every question; rows of what was shown
    summary(rows)           precision, coverage, false cards

Precision: of the cards shown, the share that quote a sentence containing
what the question's answer is. A card shown for a question the library cannot
answer is wrong. Coverage: of the questions the library answers, the share
that got a right card.
"""

import html
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "fixtures", "best_answer")


def corpus():
    with open(os.path.join(FIX, "corpus.json"), encoding="utf-8") as f:
        return json.load(f)


def questions(which="questions"):
    """`questions` were used while tuning the card; `questions_heldout` were
    written after and asked once, to say what the tuning did not see."""
    with open(os.path.join(FIX, which + ".json"), encoding="utf-8") as f:
        return json.load(f)


def _slug(title):
    return re.sub(r"\s+", "_", title)


def _article_html(title, text):
    """mwoffliner's shape in little: a heading, then paragraphs and the
    section headings Wikivoyage's plain text marks as == Heading ==."""
    body = ""
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        m = re.match(r"^(=+)\s*(.*?)\s*=+$", line)
        if m:
            body += "<h%d>%s</h%d>" % (min(6, len(m.group(1))), html.escape(m.group(2)), min(6, len(m.group(1))))
        else:
            body += "<p>%s</p>" % html.escape(line)
    return (
        "<html><head><title>%s</title></head><body><h1>%s</h1>%s</body></html>"
        % (html.escape(title), html.escape(title), body)
    ).encode("utf-8")


def sotoki_page(q):
    """One question in the shape sotoki writes it (see tests/sotoki_fixture.py
    and zimi/exchange.py): the question's post, then its answers, the accepted
    one marked."""
    slug = re.sub(r"[^a-z0-9]+", "-", q["title"].lower()).strip("-")
    answers = ""
    for a in q["answers"]:
        cls = "accepted-answer" if a["accepted"] else ""
        answers += (
            '<a name="%d"></a><div id="answer-%d" class="answer  %s" data-answerid="%d" '
            'data-ownerid="1" data-score="%d" itemprop="%s">'
            '<div class="s-prose js-post-body" itemprop="text">%s</div>'
            '<div class="mt24"><div class="user-details" itemprop="author">'
            '<span class="d-none" itemprop="name">someone</span></div></div></div>\n'
            % (
                a["id"],
                a["id"],
                cls,
                a["id"],
                a["score"],
                "acceptedAnswer" if a["accepted"] else "suggestedAnswer",
                a["body"],
            )
        )
    return (
        '<html><body><div class="question-page unified-theme">'
        '<h1 itemprop="name" class="fs-headline1"><a href="../../questions/%d/%s" class="question-hyperlink">%s</a></h1>\n'
        '<div class="question" data-questionid="%d"><div class="js-voting-container" data-post-id="%d">'
        '<div class="js-vote-count flex--item" itemprop="upvoteCount" data-value="%d">%d</div></div>\n'
        '<div class="postcell post-layout--right"><div class="s-prose js-post-body" itemprop="text">%s</div>\n'
        '<div class="mt24 mb12"><div class="post-taglist grid gs4 gsy fd-column"><div class="grid ps-relative">'
        '<a href="../../questions/tagged/x" class="post-tag js-gps-track" rel="tag">x</a></div></div></div>\n'
        '<div class="user-details" itemprop="author" itemscope="" itemtype="http://schema.org/Person">'
        '<span class="d-none" itemprop="name">asker</span></div></div></div>\n'
        '<div id="answers"><div id="answers-header"><h2 class="mb0" data-answercount="%d">%d Answers</h2></div>\n'
        '%s<div id="answers-footer"></div></div></div></body></html>'
        % (
            q["id"],
            slug,
            q["title"],
            q["id"],
            q["id"],
            q["score"],
            q["score"],
            q["body"],
            len(q["answers"]),
            len(q["answers"]),
            answers,
        )
    ).encode("utf-8"), slug


def build_library(path):
    from libzim.writer import Creator

    from conftest_zim import _Article

    c = corpus()
    wikis = (
        ("wikipedia_en_eval.zim", c["wikipedia_en"], "eng", "Wikipedia"),
        ("wikipedia_de_eval.zim", c["wikipedia_de"], "deu", "Wikipedia"),
        ("wikipedia_he_eval.zim", c["wikipedia_he"], "heb", "ויקיפדיה"),
        ("wikivoyage_en_eval.zim", c["wikivoyage_en"], "eng", "Wikivoyage"),
    )
    for fname, items, lang, title in wikis:
        with Creator(os.path.join(path, fname)).config_indexing(True, lang) as z:
            z.set_mainpath("A/" + _slug(items[0]["title"]))
            for it in items:
                z.add_item(
                    _Article(
                        "A/" + _slug(it["title"]),
                        it["title"],
                        _article_html(it["title"], it["text"]),
                    )
                )
            z.add_metadata("Title", title)
            z.add_metadata("Language", lang)
            z.add_metadata("Description", "evaluation corpus")
    with Creator(os.path.join(path, "stackoverflow.com_en_eval.zim")).config_indexing(
        True, "eng"
    ) as z:
        z.set_mainpath("questions/%d/x" % c["stackexchange"][0]["id"])
        for q in c["stackexchange"]:
            page, slug = sotoki_page(q)
            z.add_item(_Article("questions/%d/%s" % (q["id"], slug), q["title"], page))
        z.add_metadata("Title", "Stack Overflow")
        z.add_metadata("Language", "eng")
        z.add_metadata("Description", "evaluation corpus")
        z.add_metadata("Scraper", "sotoki 2.0")


def _norm(s):
    return re.sub(r"\s+", " ", html.unescape(s)).lower()


def evaluate(srv, which="questions"):
    """Ask every question of the library; one row per question."""
    rows = []
    for q in questions(which):
        srv._search_cache_clear()
        got = srv.best_answer_for(q["q"], "", None, 10)
        a = got.get("answer")
        quote = _norm(a["sentence"]) if a else ""
        expect = [_norm(e) for e in q["expect"]]
        answerable = bool(expect)
        shown = a is not None
        right = shown and answerable and any(e in quote for e in expect)
        rows.append(
            {
                "q": q["q"],
                "answerable": answerable,
                "shown": shown,
                "right": right,
                "title": a["title"] if a else "",
                "sentence": a["sentence"] if a else "",
                "score": a["score"] if a else 0,
            }
        )
    return rows


def summary(rows):
    shown = [r for r in rows if r["shown"]]
    answerable = [r for r in rows if r["answerable"]]
    right = [r for r in rows if r["right"]]
    return {
        "questions": len(rows),
        "answerable": len(answerable),
        "shown": len(shown),
        "right": len(right),
        "wrong": len(shown) - len(right),
        "precision": len(right) / len(shown) if shown else 1.0,
        "coverage": len(right) / len(answerable) if answerable else 1.0,
    }


def report(rows):
    out = []
    for r in rows:
        mark = (
            "ok   "
            if r["right"]
            else ("WRONG" if r["shown"] else ("miss " if r["answerable"] else "none "))
        )
        out.append(
            "%s %-52s %s"
            % (
                mark,
                r["q"][:52],
                (
                    (
                        "[%.2f] %s :: %s"
                        % (r["score"], r["title"][:30], r["sentence"][:110])
                    )
                    if r["shown"]
                    else ""
                ),
            )
        )
    s = summary(rows)
    out.append(
        "precision %.0f%% (%d right of %d shown), coverage %.0f%% (%d of %d answerable), %d wrong"
        % (
            s["precision"] * 100,
            s["right"],
            s["shown"],
            s["coverage"] * 100,
            s["right"],
            s["answerable"],
            s["wrong"],
        )
    )
    return "\n".join(out)
