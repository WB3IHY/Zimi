# Field Guide

Help now: what is happening, and what the open sources say about it, in their own words.

Zimi writes no first-aid or survival instruction. A situation is a name (Bleeding, Water, Lost, Flood and twenty more), an order and a list of quotations: short passages quoted word for word from public-domain and openly licensed sources, each with its source, edition, the place in it, its licence and a link to the original. The quotations ship inside Zimi, so every situation works with no ZIM installed. The ZIMs you install are the depth behind each quote: the full section, the pages around it, the rest of the manual. A situation with nothing installed says which ZIM would add what, how large it is, and downloads it in one tap through the ordinary download machinery.

## How it works

Each situation is in the order of what to do in the next minute: the quotations are listed in the data's own order, plain civilian passages before tactical ones, and a card opens on a passage a frightened person can act on (bleeding: direct pressure, then the tourniquet; cold: hypothermia, then frostbite; lost: stay put first). Where a situation has a current manual and an older one, the older is kept only for a passage the current lacks and carries a "Superseded by" badge.

Every situation carries "Not medical advice. Call emergency services if you can."

## Where it is

- Home: a plain "Help now" button, on an empty library too; the first-run setup and the sign-in screen carry it as well, answered with the quotes and nothing of the library.
- Search: words that name a situation put an answer above the results, in the reader's language and English only. A clear emergency ("my friend is bleeding", "he is not breathing", "which way is south", "blutet") gets a compact card with its first plain passage (a tall one folds behind Show all). A bare word that could be about anything ("water", "storm", "food", "fire", "generator", "shock", "cold", "signal") gets a small "Help now: Water" link, never the quote. Everything else ("signal processing", "generator docs", "sed") gets nothing, and "No results found" is never shown under an answer. The answer goes with the search (home, Settings) and is not shown when searching inside one ZIM.
- The page: `/#fieldguide` (the situations) and `/#fieldguide/<situation>` (one of them). Print goes through the shell (the page is a sandboxed frame): one card, or the whole set of every situation, compact, with the address of each original printed.
- Red night light: one switch (below), in every card, on the front and in the shell header while the guide is open.

## The search hint (for the card above results)

`GET /search?q=...` carries a `fieldguide` field when the typed words name a situation, and omits it otherwise (a search inside one ZIM, a collection or a language never carries it):

```json
{"fieldguide": {"id": "bleeding", "kind": "card", "href": "/#fieldguide/bleeding", "installed": [{"piece": "wikipedia", "name": "Wikipedia"}]}}
```

`id` is a situation, or `""` for the Field Guide itself ("first aid", "survival"); `kind` is `card` or `link`. The search request carries `ui=` (the reader's language); only that language and English are read. A situation's keywords come in three kinds in `assets/fieldguide.json`: `keywords` (the whole query, or a phrase of two or more words inside it), `within` (a single word safe inside any query) and `ambiguous` (a bare word that is only a link). The field is in both phases of a streamed search. Computing it reads a keyword table and the library list the server already holds: no ZIM is opened and nothing is fetched on the search path. The Field Guide is the first card of the slot above the results (`registerSearchCard`, priority 50, before the best answer at 100), so when it answers no other card is asked: no `/bestanswer` request, and no Wikipedia passage under a government quote. The shell asks `GET /fieldguide/match` as the search starts, so the card is up in a moment rather than when a library-wide search ends; a situation's own word is never offered a spelling ("lost" is not offered "lit"). The card fills from `GET /fieldguide/situation?id=`.

`static/fieldguide-card.js` is the renderer both the page and the shell use (`FieldGuideCard.quoteHtml`, `answersHtml`, `missingHtml`, `bodyHtml`): a quote, its source line and the way deeper, drawn from the situation's JSON. A slot that wants to host a quote calls those, with the shell's `fieldguide_*` words.

## The API

- `GET /fieldguide`: the groups in order (`hurt` with the MARCH letters ATP states, `survive`, `disaster`), each situation with its quote count and how many of the sources that go deeper are installed. `GET /fieldguide/print` gives every situation's quotes in order, for one printed set. `/fieldguide`, `/situation` and `/print` also answer the private-mode sign-in and a fresh install's setup, with the quotes only.
- `GET /fieldguide/situation?id=&lang=`: `{id, mark, quotes, answers, missing, disclaimer}`. A quote is `{id, heading, locator, lines, table?, source: {title, edition, publisher, licence, year, superseded}, url, library}`; `library` is `{state: "installed", name, open: {zim, path | q}}` or `{state: "missing", options: [{name, size_bytes, url | build}]}`. `answers` are the pages the installed ZIMs hold on the situation (pages and documents before searches, then the source's tier, then newest). `lang` other than `en` adds that language's Wikipedia, searched in that language's words; the quotes stay English.
- `GET /fieldguide/library`: the ZIMs that fill the guide, in sets, each with its catalog size, installed state and download address.
- `GET /fieldguide/match?q=&ui=`: the situation a typed query names and its kind, for a client that wants to ask itself.
- `GET` and `POST /manage/fieldmanual` (admin): build, and watch, the field-manual ZIM. The build is a Create job (one slot, a queue, the journal, a cancel). Offline answers `409 offline`; an installed manual `409 installed`.

## Sources and licences

Every quote names its source and why it may be quoted. Allowed: US federal public domain (17 U.S.C. 105) and CC BY, CC BY-SA. The test suite holds each quote's licence to that list and each line of each quote to the source's text (kept in `tests/fixtures/fieldguide`, with what a text layer changes noted in the quote's `ocr`).

| Source | Edition | Licence |
|---|---|---|
| ATP 4-02.11 Casualty Response, TCCC and First Aid (Army) | 23 March 2026 | US Army work, approved for public release |
| TC 4-02.1 First Aid (superseded by ATP 4-02.11) | January 2016, Change 2 of 7 December 2018 | US Army work |
| FM 21-76 Survival | 5 June 1992 (dated: shown with its year) | US Army work |
| Ready.gov (FEMA) | each page's own "last updated" | US federal work |
| Emergency Disinfection of Drinking Water (EPA) | page updated February 24, 2026 | US federal work |
| If You Get Lost (USFS); Outdoor Emergency Plan (NPS) | 2026; June 21, 2023 | US federal work |
| Calling 911 and its FAQ (National 911 Program) | 2023 | US federal work |
| Calling Poison Help (HRSA) | retrieved 14 October 2026 | US federal work |
| Cardiac arrest, heart attack, carbon monoxide (CDC); Venomous Snakes (NIOSH) | 2024, 2024, 2026; 23 Sept 2026 | US federal work |
| Crux, Navigation (Wikipedia, revision 1379511054) | 10 October 2026 | CC BY-SA 4.0 |
| Choking, Infants (Wikipedia, revision 1369110407) | 13 August 2026 | CC BY-SA 4.0 |
| List of emergency telephone numbers (Wikipedia, revision 1377218654) | the emergency number line | CC BY-SA 4.0 |

Pages that refuse a script were read from the Internet Archive's copy of the original and the snapshot's date is the edition. TCCC is not quoted (its licence is not confirmed). Choking quotes ATP 4-02.11 (back blows, then abdominal thrusts; the Army text states no age) and, for infants, the Choking article of Wikipedia; each quote carries the source's own scope sentence ("Covers").

Never quoted: MedlinePlus's A.D.A.M. encyclopedia pages (copyrighted; a link is fine), Hesperian, wikiHow, the Red Cross, commercial books. WikEM is never in a lay flow. No plant identification.

## Languages

The words of the page (names of situations, buttons, the disclaimer) are in all ten languages. The quotes are in English until a person has checked a translation; a first-aid step is never machine-translated. In another language a situation says the sources are in English and adds that language's Wikipedia (the medicine build where there is one) searched in the language's words.

## The field manual

`zimi.fieldguide.build_field_manual` (the Build button, `POST /manage/fieldmanual`, run as a Create job) downloads ATP 4-02.11 (Army Publishing Directorate), TC 4-02.1, FM 21-76 and the Ranger Handbook (TC 3-21.76, 2017) (Wikimedia Commons) over https from pinned addresses, refuses any redirect, checks each against the size and SHA-256 it was verified with, and packages them with Create's folder mode as `zimi_field_manual`: about 82 MB. It is a fetch someone asked for (the Create row of "What Zimi fetches"), refused under ZIMI_OFFLINE, where Build is not offered. A failure shows Create's own sentence, or a generic one for anything unexpected. The Field Guide finds the manuals in it.

## Red night light

One browser key, `zimi.night`, value `red`, shared by the Field Guide and the sky. `apps.js` (`nightApply`, `nightSet`) and the shell (`app.js` `_nightApply`, stamped before first paint in `index.html`) put `night-red` on `<html>`; `app.css` and `apps.css` turn it into deep red on black. Whoever draws a switch writes the key and calls `_nightApply()`. At night every tier of text is at least 4.5:1 on every surface, pictures (the logo, the moon card, covers) become red monochrome through one SVG filter, and an app page is stamped red in its head, before it paints.

## Configure

Nothing to set. The emergency number line (top of Help now and of every card for someone who is hurt) reads the device's time zone: `static/zone-places.js` (the sky's own time zone table, built by `scripts/build_zone_places.py` from the tz database's zone.tab) maps each IANA zone to `[latitude, longitude, country]`, and `static/fieldguide-numbers.json` holds the country's row of Wikipedia's List of emergency telephone numbers (CC BY-SA 4.0, named on the line), word for word: one number when the source gives one for everything, else police, ambulance and fire, and the mobile-phone number when it differs. A zone or country the tables lack says "Emergency number: 112 / 911". The same zone gives the place the sky strip (Lost, Signal, Shelter, Flood, Cold) and the hemisphere order of the Lost card are read for when no place was chosen in the Almanac; a guessed place is said to be a guess. Under `ZIMI_OFFLINE` everything here still works: it is all in the install. The field manual build (above) is the only part that fetches.

## Troubleshoot

- *The number line says "Emergency number: 112 / 911" at home*: the device reports a time zone the table lacks (Etc/UTC, or a blank one in a privacy-hardened browser). It is an honest "country not known"; the sky strip then names no place.
- *Lost shows the northern sky first in the south*: no place is chosen and the zone is unknown; choose a place in the Almanac.
- *Help now does not show in search*: searching inside one ZIM is not asking for help; clear the source chip.
