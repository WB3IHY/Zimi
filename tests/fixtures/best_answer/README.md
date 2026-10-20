# Best answer evaluation corpus

Real text, kept as fetched on 2026-10-14, used only to judge the best answer card (tests/best_answer_eval.py, tests/test_best_answer_eval.py).

- `corpus.json`: lead sections of 46 English, 6 German and 5 Hebrew Wikipedia articles, and the text of three English Wikivoyage pages (Paris, Berlin, Tokyo, cut at about 24,000 characters). Wikipedia and Wikivoyage text is available under the Creative Commons Attribution-ShareAlike 4.0 license (CC BY-SA 4.0); each item's `url` is its source page, whose history lists its authors. Fetched with the MediaWiki API (`action=query&prop=extracts`).
- `corpus.json`, `stackexchange`: six questions with their top answers from Stack Overflow and Super User, fetched with the Stack Exchange API. User contributions on Stack Exchange sites are licensed under CC BY-SA (4.0 or earlier, by date of posting); each item's `url` is its page, which credits the authors.
- `questions.json`: 64 questions. `expect` lists phrases of which the quoted sentence must hold one to be a right answer; an empty list means the library holds no answer and a card is wrong.
