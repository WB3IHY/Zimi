#!/usr/bin/env python3
"""The best answer: question gate, sentence splitting, ranking, threshold.

Pure functions on strings, so every case here is a passage and a question.
Languages: English, German (a Latin script with its own function words),
Russian and Chinese (other scripts; Chinese has no spaces).
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zimi import bestanswer as ba  # noqa: E402


def passage(title, text, seq=0, rank=0, zim="wiki", path=None):
    return {
        "zim": zim,
        "path": path or title.replace(" ", "_"),
        "title": title,
        "text": text,
        "seq": seq,
        "rank": rank,
    }


WATER = passage(
    "Water purification",
    "Water purification is the process of removing undesirable chemicals, "
    "biological contaminants and suspended solids from raw water. Boiling "
    "water for one minute kills most pathogens. Filters remove sediment.",
)
WATER_BOIL = passage(
    "Boiling",
    "Boiling is the rapid vaporization of a liquid. People boil water to "
    "purify it when camping, because heat kills bacteria and viruses.",
    rank=1,
)
MONA = passage(
    "Mona Lisa",
    "The Mona Lisa is a half-length portrait painting by Italian artist "
    "Leonardo da Vinci. It is considered an archetypal masterpiece of the "
    "Italian Renaissance. It was painted in the early sixteenth century.",
)
PARIS = passage(
    "Paris",
    "Paris is the capital and most populous city of France. The city sits "
    "on the Seine. It has been a major centre of finance and culture.",
)
NOISE = passage(
    "Rivers of Europe",
    "The Danube flows through ten countries. The Rhine rises in the Alps. "
    "Many rivers were used for trade.",
    rank=2,
)


class TestWorthAsking(unittest.TestCase):
    def test_questions(self):
        for q in (
            "how to purify water",
            "who painted the mona lisa",
            "what is the capital of france?",
            "wer hat die mona lisa gemalt",
            "кто написал мону лизу",
            "谁画了蒙娜丽莎",
            "mona lisa painter",
            "capital of france",
        ):
            self.assertTrue(ba.worth_asking(q), q)

    def test_keyword_searches_get_no_card(self):
        for q in (
            "water purification",
            "python",
            "mona lisa",
            "linux kernel",
            "",
            "  ",
        ):
            self.assertFalse(ba.worth_asking(q), q)

    def test_search_grammar_asks_for_something_exact(self):
        for q in (
            '"mona lisa" painter who',
            "how to purify water -boil",
            "in:wiki who is x",
        ):
            self.assertFalse(ba.worth_asking(q), q)

    def test_a_question_word_alone_asks_nothing(self):
        self.assertFalse(ba.worth_asking("what is"))
        self.assertFalse(ba.worth_asking("how"))


class TestSentences(unittest.TestCase):
    def sents(self, text):
        return [text[s:e] for s, e in ba.split_sentences(text)]

    def test_plain(self):
        self.assertEqual(
            self.sents("One is here. Two is there! Three?"),
            ["One is here.", "Two is there!", "Three?"],
        )

    def test_abbreviations_and_initials_do_not_end_a_sentence(self):
        got = self.sents("Dr. Smith met J. K. Rowling in St. Louis. They talked.")
        self.assertEqual(len(got), 2)
        self.assertTrue(got[0].startswith("Dr. Smith"))

    def test_lower_case_after_a_period_continues(self):
        self.assertEqual(
            len(self.sents("It weighs 3.5 kg. approx. ten grams, e.g. this.")), 1
        )

    def test_cjk_enders_need_no_space(self):
        self.assertEqual(
            self.sents("蒙娜丽莎是油画。它很有名！"), ["蒙娜丽莎是油画。", "它很有名！"]
        )


class TestRanking(unittest.TestCase):
    def best(self, q, *ps):
        return ba.rank_answer(q, list(ps))

    def test_the_sentence_that_answers_is_the_quote(self):
        got = self.best("who painted the mona lisa", MONA, PARIS, NOISE)
        a = got["answer"]
        self.assertEqual(a["title"], "Mona Lisa")
        self.assertIn("Leonardo da Vinci", a["sentence"])
        self.assertEqual(a["before"] + a["sentence"] + a["after"], MONA["text"])

    def test_how_to_purify_water(self):
        got = self.best("how to purify water", WATER, WATER_BOIL, NOISE)
        a = got["answer"]
        self.assertEqual(a["title"], "Water purification")
        self.assertIn("purification", a["sentence"])
        # one more passage, from the other article, never the same article twice
        self.assertEqual([m["title"] for m in got["more"]], ["Boiling"])

    def test_quote_is_text_from_the_passage(self):
        a = self.best("capital of france", PARIS, NOISE)["answer"]
        self.assertIn(a["sentence"], PARIS["text"])

    def test_nothing_answers_no_card(self):
        self.assertIsNone(self.best("who painted the mona lisa", PARIS, NOISE))

    def test_half_a_question_is_not_an_answer(self):
        self.assertIsNone(
            self.best("why does the ocean have tides", WATER, WATER_BOIL, NOISE)
        )

    def test_unknown_part_of_the_question_lowers_confidence(self):
        self.assertIsNone(
            self.best("who painted the mona lisa in 1503 for zorblax", MONA)
        )

    def test_scattered_words_score_below_a_sentence_that_holds_them(self):
        tight = passage("A", "Leonardo painted the Mona Lisa in Florence around 1503.")
        loose = passage(
            "B",
            "Leonardo left Florence for Milan, and years later in another "
            "city a different artist painted a portrait of a woman named Lisa, "
            "not the one from Mona.",
            rank=0,
        )
        got = self.best("who painted the mona lisa", loose, tight)
        self.assertEqual(got["answer"]["title"], "A")

    def test_extras_are_capped_and_different_articles(self):
        ps = [
            passage(
                f"Boil {i}",
                f"People boil water to purify it, method number {i} here.",
                rank=i,
            )
            for i in range(5)
        ]
        got = self.best("how to purify water", *ps)
        self.assertLessEqual(len(got["more"]), ba.EXTRA_MAX)
        titles = [got["answer"]["title"]] + [m["title"] for m in got["more"]]
        self.assertEqual(len(titles), len(set(titles)))

    def test_table_rows_are_not_quotes(self):
        row = passage(
            "T",
            "1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 water purify 21 22 23",
        )
        self.assertIsNone(self.best("how to purify water", row))

    def test_deterministic(self):
        a = self.best("how to purify water", WATER, WATER_BOIL, NOISE)
        b = self.best("how to purify water", WATER, WATER_BOIL, NOISE)
        self.assertEqual(a, b)

    def test_long_passage_is_windowed_around_the_sentence(self):
        filler = "Unrelated words about rivers and stones go on here. " * 12
        p = passage(
            "Mona Lisa", filler + "Leonardo da Vinci painted the Mona Lisa. " + filler
        )
        a = self.best("who painted the mona lisa", p)["answer"]
        self.assertLessEqual(len(a["before"]), ba.CONTEXT_BEFORE + 1)
        self.assertLessEqual(len(a["after"]), ba.CONTEXT_AFTER + 1)
        self.assertTrue(a["before"].startswith("…"))
        self.assertTrue(a["after"].endswith("…"))


class TestLeadText(unittest.TestCase):
    def test_the_title_said_twice_before_the_first_sentence_is_dropped_once(self):
        got = ba.lead_text(
            "Water purification Water purification Water purification is the process.",
            "Water purification",
        )
        self.assertEqual(got, "Water purification is the process.")

    def test_a_sentence_that_begins_with_the_title_keeps_it(self):
        text = "Water purification is the process."
        self.assertEqual(ba.lead_text(text, "Water purification"), text)
        self.assertEqual(ba.lead_text(text, ""), text)


class TestContentQuery(unittest.TestCase):
    def test_function_and_question_words_go_the_content_words_stay_as_typed(self):
        self.assertEqual(ba.content_query("how to purify water"), "purify water")
        self.assertEqual(
            ba.content_query("wer hat die Mona Lisa gemalt"), "Mona Lisa gemalt"
        )
        self.assertEqual(ba.content_query("кто написал Мону Лизу"), "написал Мону Лизу")


class TestProximity(unittest.TestCase):
    def test_tightness_follows_word_order_not_hash_order(self):
        w = {"a": 1.0, "b": 1.0}
        cover, matched, tight = ba._coverage(["a", "b"], w, ["a", "x", "x", "b"])
        self.assertEqual((cover, matched, tight), (1.0, 2, 0.5))
        _, _, side = ba._coverage(["a", "b"], w, ["x", "a", "b", "x"])
        self.assertEqual(side, 1.0)


class TestWhatIsNotAQuote(unittest.TestCase):
    """Found reading real books: a title line, the licence boilerplate and a
    sentence cut by the passage edge all matched the question's words."""

    def test_a_heading_line_is_not_a_sentence_start(self):
        text = "Our Legal Heritage: King Aethelbert - King George III, 600 A.D.\n\nProduced by Al Haines\n\nThe law of England grew from the laws of Aethelbert."
        got = [text[s:e] for s, e in ba.split_sentences(text)]
        self.assertEqual(got[0], "Our Legal Heritage: King Aethelbert - King George III, 600 A.D.")
        self.assertEqual(len(got), 3)

    def test_a_title_line_alone_answers_nothing(self):
        p = passage("Our Legal Heritage", "Our Legal Heritage: King Aethelbert - King George III, 600 A.D.\n\nProduced by Al Haines")
        self.assertIsNone(ba.rank_answer("what is the legal heritage of england", [p]))

    def test_a_fragment_cut_by_the_passage_edge_is_not_quoted(self):
        p = passage("Mona Lisa", "and the painting by Leonardo da Vinci of the Mona Lisa was sold. Leonardo da Vinci painted the Mona Lisa in Florence")
        self.assertIsNone(ba.rank_answer("who painted the mona lisa", [p]))

    def test_underscores_and_empty_tokens_do_not_break_reading(self):
        self.assertEqual(ba.words("_ __init__ a_b"), ["init", "a_b"])


class TestLanguages(unittest.TestCase):
    def test_german(self):
        mona = passage(
            "Mona Lisa",
            "Die Mona Lisa ist ein Gemälde, das von Leonardo da Vinci gemalt wurde. "
            "Es hängt im Louvre in Paris.",
        )
        other = passage(
            "Louvre", "Der Louvre ist ein Museum in Paris. Er ist sehr groß.", rank=1
        )
        got = ba.rank_answer("wer hat die Mona Lisa gemalt", [other, mona])
        self.assertEqual(got["answer"]["title"], "Mona Lisa")
        self.assertIn("Leonardo", got["answer"]["sentence"])

    def test_german_function_words_do_not_carry_the_match(self):
        other = passage(
            "Zeug", "Der die das und ist von zu mit auf ein eine nicht sich wurde."
        )
        self.assertIsNone(ba.rank_answer("wer hat die Mona Lisa gemalt", [other]))

    def test_russian(self):
        mona = passage(
            "Мона Лиза",
            "Мона Лиза — портрет, который написал Леонардо да Винчи. Он хранится в Лувре.",
        )
        other = passage(
            "Река", "Волга впадает в Каспийское море. Это длинная река.", rank=1
        )
        got = ba.rank_answer("кто написал Мону Лизу", [other, mona])
        self.assertEqual(got["answer"]["title"], "Мона Лиза")

    def test_chinese_without_spaces(self):
        mona = passage(
            "蒙娜丽莎",
            "《蒙娜丽莎》是列奥纳多·达·芬奇创作的油画。这幅画收藏在卢浮宫。",
        )
        other = passage("长江", "长江是亚洲最长的河流。它流经许多城市。", rank=1)
        got = ba.rank_answer("谁画了蒙娜丽莎", [other, mona])
        self.assertEqual(got["answer"]["title"], "蒙娜丽莎")
        self.assertIn("油画", got["answer"]["sentence"])

    def test_chinese_no_answer(self):
        other = passage("长江", "长江是亚洲最长的河流。它流经许多城市。")
        self.assertIsNone(ba.rank_answer("谁画了蒙娜丽莎", [other]))

    def test_accents_and_case_do_not_matter(self):
        p = passage(
            "Café",
            "The Café de Flore is a famous coffee house in Paris, founded in 1887.",
        )
        self.assertIsNotNone(ba.rank_answer("when was the cafe de flore founded", [p]))

    def test_astral_characters_do_not_shift_the_quote(self):
        p = passage(
            "Mona Lisa",
            "Intro \U0001f600 text. Leonardo da Vinci painted the Mona Lisa. Tail.",
        )
        a = ba.rank_answer("who painted the mona lisa", [p])["answer"]
        self.assertEqual(a["before"] + a["sentence"] + a["after"], p["text"])


class TestBestAnswerPath(unittest.TestCase):
    HITS = [
        {"zim": "wiki", "path": "Mona_Lisa", "title": "Mona Lisa"},
        {"zim": "wiki", "path": "Paris", "title": "Paris"},
        {"zim": "maps", "path": "Paris", "title": "Paris"},
    ]
    BODY = {"Mona_Lisa": MONA["text"], "Paris": PARIS["text"]}

    def chunks(self, zim, path):
        return [{"seq": 0, "text": self.BODY[path]}]

    def test_reads_in_rank_order_and_answers(self):
        got = ba.best_answer("who painted the mona lisa", self.HITS, self.chunks)
        self.assertEqual(got["answer"]["title"], "Mona Lisa")

    def test_keyword_search_reads_nothing(self):
        def boom(zim, path):
            raise AssertionError("must not read an article for a keyword search")

        self.assertEqual(ba.best_answer("mona lisa", self.HITS, boom), {"answer": None})

    def test_maps_are_not_read(self):
        seen = []

        def chunks(zim, path):
            seen.append(zim)
            return self.chunks(zim, path)

        ba.best_answer(
            "who painted the mona lisa", self.HITS, chunks, kinds={"maps": "map"}
        )
        self.assertNotIn("maps", seen)

    def test_budget_stops_reading_but_the_first_article_is_always_read(self):
        seen = []

        def chunks(zim, path):
            seen.append(path)
            return self.chunks(zim, path)

        ba.best_answer("who painted the mona lisa", self.HITS, chunks, budget=-1)
        self.assertEqual(seen, ["Mona_Lisa"])

    def test_an_unreadable_article_is_skipped(self):
        def chunks(zim, path):
            if path == "Mona_Lisa":
                raise KeyError(path)
            return self.chunks(zim, path)

        got = ba.best_answer("what is the capital of france", self.HITS, chunks)
        self.assertEqual(got["answer"]["title"], "Paris")

    def test_cache_is_bounded_and_per_key(self):
        ba.cache_clear()
        calls = []
        for i in range(ba.CACHE_MAX + 10):
            ba.cached_best_answer(
                ("k", i), lambda i=i: calls.append(i) or {"answer": None}
            )
        self.assertLessEqual(len(ba._cache), ba.CACHE_MAX)
        n = len(calls)
        ba.cached_best_answer(("k", ba.CACHE_MAX + 9), lambda: calls.append(0))
        self.assertEqual(len(calls), n)


if __name__ == "__main__":
    unittest.main()
