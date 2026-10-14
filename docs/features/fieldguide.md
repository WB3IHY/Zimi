# Field Guide

Help now: what is happening, and what the open sources say about it, in their own words.

Zimi writes no first-aid or survival instruction. A situation is a name (Bleeding, Water, Lost, Flood and thirteen more), an order and a list of quotations: short passages quoted word for word from public-domain and openly licensed sources, each with its source, edition, the place in it, its licence and a link to the original. The quotations ship inside Zimi, so every situation works with no ZIM installed. The ZIMs you install are the depth behind each quote: the full section, the pages around it, the rest of the manual. A situation with nothing installed says which ZIM would add what, how large it is, and downloads it in one tap through the ordinary download machinery.

Every situation carries "Not medical advice. Call emergency services if you can."

## Where it is

- Home: one quiet "Help now" line, on an empty library too.
- Search: typing "bleeding", "tourniquet", "water", "lost", "hypothermia" and the like (ten languages) puts the situation's card above the results.
- The page: `/#fieldguide` (the situations) and `/#fieldguide/<situation>` (one of them). Print gives the quotations alone, a quotation never split across pages.
- Red night light: one switch (below).

## The search hint (for the card above results)

`GET /search?q=...` carries a `fieldguide` field when the typed words name a situation, and omits it otherwise (a search inside one ZIM, a collection or a language never carries it):

```json
{"fieldguide": {"id": "bleeding", "href": "/#fieldguide/bleeding", "installed": [{"piece": "wikipedia", "name": "Wikipedia"}]}}
```

`id` is a situation, or `""` for the Field Guide itself ("first aid", "survival"). The field is in both phases of a streamed search. Computing it reads a keyword table and the library list the server already holds: no ZIM is opened and nothing is fetched on the search path. The shell keeps it per query (`_fieldguideMount` in app.js) and draws the card in its own container, `#fg-answer`, above `#output`, so another slot above the results (the best answer card) sits beside it, not inside it. The card fills from `GET /fieldguide/situation?id=` after the results have drawn.

`static/fieldguide-card.js` is the renderer both the page and the shell use (`FieldGuideCard.quoteHtml`, `answersHtml`, `missingHtml`, `bodyHtml`): a quote, its source line and the way deeper, drawn from the situation's JSON. A slot that wants to host a quote calls those, with the shell's `fieldguide_*` words.

## The API

- `GET /fieldguide`: the groups in order (`hurt` with the MARCH marks, `survive` with the Rule of Threes marks, `disaster`), each situation with its quote count and how many of the sources that go deeper are installed.
- `GET /fieldguide/situation?id=&lang=`: `{id, mark, quotes, answers, missing, disclaimer}`. A quote is `{id, heading, locator, lines, table?, source: {title, edition, publisher, licence, year}, url, library}`; `library` is `{state: "installed", name, open: {zim, path | q}}` or `{state: "missing", options: [{name, size_bytes, url | build}]}`. `answers` are the pages the installed ZIMs hold on the situation (pages and documents before searches, then the source's tier, then newest). `lang` other than `en` adds that language's Wikipedia, searched in that language's words; the quotes stay English.
- `GET /fieldguide/library`: the ZIMs that fill the guide, in sets, each with its catalog size, installed state and download address.
- `GET /fieldguide/match?q=`: the situation a typed query names, for a client that wants to ask itself.
- `GET` and `POST /manage/fieldmanual` (admin): build, and watch, the field-manual ZIM.

## Sources and licences

Every quote names its source and why it may be quoted. Allowed: US federal public domain (17 U.S.C. 105) and CC BY, CC BY-SA. The test suite holds each quote's licence to that list and each line of each quote to the source's text (kept in `tests/fixtures/fieldguide`, with what a text layer changes noted in the quote's `ocr`).

| Source | Edition | Licence |
|---|---|---|
| TC 4-02.1 First Aid | January 2016, Change 2 of 7 December 2018 | US Army work, approved for public release |
| FM 21-76 Survival | 5 June 1992 (dated: shown with its year) | US Army work, approved for public release |
| TCCC Guidelines, CoTCCC | 01 May 2026 | US Department of Defense work |
| Ready.gov (FEMA) | each page's own "last updated" | US federal work |
| Emergency Disinfection of Drinking Water (EPA) | page updated February 24, 2026 | US federal work |

Never quoted: MedlinePlus's A.D.A.M. encyclopedia pages (copyrighted; a link is fine), Hesperian, wikiHow, the Red Cross, commercial books. WikEM is never in a lay flow. No plant identification.

## Languages

The words of the page (names of situations, buttons, the disclaimer) are in all ten languages. The quotes are in English until a person has checked a translation; a first-aid step is never machine-translated. In another language a situation says the sources are in English and adds that language's Wikipedia (the medicine build where there is one) searched in the language's words.

## The field manual

`zimi.fieldguide.build_field_manual` (the Build button, `POST /manage/fieldmanual`) downloads TC 4-02.1, FM 21-76 and the Ranger Handbook (TC 3-21.76, 2017) from their Wikimedia Commons originals, checks each against the size and SHA-256 it was verified with, and packages them with Create's folder mode as `zimi_field_manual`. It is a fetch someone asked for (the Create row of "What Zimi fetches"), refused under ZIMI_OFFLINE. The Field Guide finds the manuals in it.

## Red night light

One browser key, `zimi.night`, value `red`, shared by the Field Guide and the sky. `apps.js` (`nightApply`, `nightSet`) and the shell (`app.js` `_nightApply`, stamped before first paint in `index.html`) put `night-red` on `<html>`; `app.css` and `apps.css` turn it into deep red on black. Whoever draws a switch writes the key and calls `_nightApply()`.
