# Where the next release stands (2026-10-16, evening)

Last shipped: **1.13.3** (2026-10-13). Since then: 206 commits on `v1.15`, nothing shipped. The `v1.14` branch is fully shipped (it became 1.13.3), so the next unused number is **1.14.0**.

## What's built

**In your pocket (offline on the phone)**
- Keep offline: one tap from a ZIM's menu or About, ring while it comes, tick when it's here, resumable.
- On this phone: a section and view with a storage bar and Manage; the offline home is the same library tiles.
- Kept ZIMs read and search offline: articles with pictures from the phone, title search instantly, full-text search via Kiwix's libzim (WebAssembly).
- Offline is a mode: a calm Offline pill, no warning bar; a hanging connection no longer freezes the app.
- Discover offline shows only cards that open.
- Proven on Eric's iPhone in airplane mode.

**In the box (Project NOMAD)**
- Zimi reads NOMAD's ZIM folder in place, never writing to it; ZIMs NOMAD adds or removes appear or leave within a minute.
- Project NOMAD mode (opt-in): Zimi's downloads, updates and deletes go through NOMAD's own API.
- Zimi can replace NOMAD's Kiwix as the Information Library through Manage > Edit, and switch back; proven on NOMAD 1.35.1.
- Old Kiwix links (`/content`, `/viewer`, a pasted search) work.
- The Docker image sets up a fresh data folder itself; the guide uses an admin password, not LAN trust.
- nomad.zosia.lan for our own VM.

**Your own pages (Create)**
- Pages saved from Firefox, Chrome or Safari become a ZIM that looks like the original: lazy-loaded pictures kept, `_files` folders part of their page, links between saved pages work, `.mhtml` and `.webarchive` open too.
- browsertrix-behaviors and the warc2zim tools ship in the Docker image (+343 MB), so every capture engine works out of the box.

**Everywhere**
- Red theme: deep red on black in every screen, app, the sky and over articles, iOS-safe.
- Search: questions ("how do I", "when did") find answers; the best-answer card quotes the sentence.
- Sign-in screen: the Zimi wordmark, Help now.
- License: GPL-3.0-or-later (1.13.3 and earlier stay MIT).

**Also built, not part of the story**
- The Almanac (Easter egg, never in the notes): GPU sky, the 3D Earth, the flown solar system, the Moon pull-back to Neptune, section bar, saved clocks, calmer tides, below the horizon, Find, faster load.
- Zimi Earth: a globe of the library's places.
- Field Guide and Help now: 25 emergencies as quoted cards.

## What we planned vs what happened

The plan was "the field kit": sky, Earth, the flown solar system, Field Guide, best answer. Then on 10-16 it grew to NOMAD and the phone. Eric's read on 10-16: "a bit of a hodgepodge".

## The story (recommended)

**Zimi wherever there's no internet:** in your pocket (Keep offline), in the box (NOMAD), and your own saved pages. Red, search fixes, bundled capture tools and GPL are one-line plumbing. The Almanac rides along quietly.

## Decisions (Eric, 2026-10-16 22:09: "let's execute and take our time")

- Field Guide and Help now: out of this release. Important; to be figured out (How to, anything).
- NOMAD: do all we can without stepping on toes, ship, prove it, then post the issue.
- Earth: in this release, world-class, with downloadable local satellite and road imagery and Feynman-plain captions (plan: docs/plans/2026-10-16-earth-world-class.md).

## Still open

1. **Field Guide and Help now:** pull from this release (behind a flag) and redesign as "How to (anything)"? It is wired into home, first run, sign-in and search. Recommended: pull.
2. **Best-answer card:** keep (it's search, fits) or pull? Needs your look.
3. **Zimi Earth:** quiet like the Almanac, or in the notes?
4. **Version:** 1.14.0 (next unused) or 1.15.0 (what the docs and branch say).
5. **The Moon at rest:** the plain Moon (now) or the Sun-and-planets prototype (`?rest=system`, two layout flaws)?

## Left before shipping

- [ ] Phone agent: confirm before remove, Add from Files, the too-big message with real numbers (Gutenberg on a 2 TB phone), feedback in compact tiles, grouped menu.
- [x] The Almanac's 16 phone defects fixed and merged (f1fac7e5); each has a test that fails on the old code.
- [ ] Eric: the Almanac now keeps its GPU scenes 30 s after closing (faster reopen, more memory on iOS); keep or revert. Holiday names newly translated into Hindi, Hebrew and Arabic need a native speaker.
- [x] CI green (run 39068587372, all jobs, 2026-10-17). Found on the way: the service worker answered the offline page at 8 s when nothing was kept (fixed); tide labels under the clock's dot (fixed); Chrome 156 never reports SW-claimed requests finished (tests wait on _swPrimed).
- [ ] Eric's iPhone pass: Red, Keep offline, airplane mode, Almanac.
- [ ] Pull the Field Guide if decided.
- [ ] Draft PR to main so CI and CodeRabbit run on it; answer every CodeRabbit finding.
- [ ] Ultracode review, then fixes (when Eric says).
- [ ] CHANGELOG cut to one-line bullets in story order; release notes are Eric's.
- [ ] Docs: the NOMAD guide's image tag matches the chosen version; CLAUDE.md line counts.
- [ ] A full test-suite run on the final tree.
- [ ] Eric: reply to lervatti; NAS cleanup `ssh nas "rm -r /volume1/docker/nomad-vm"`.

## After this release

- Post the NOMAD proposal (draft in docs/drafts, needs the published image).
- Apps written offline first, Bookshelf first, with index sidecars.
- How to (anything), replacing the Field Guide.
- ZimiArcade; the Almanac and Arcade as ZIM files.
- Chat with your library on a local Ollama; a starter kit on first run.
- Earth: a sharper texture tier when zoomed, stations and Hubble.
- The phone reader learns old xz-compressed ZIMs.
</content>
</invoke>

## Zosia HI review (2026-10-16 23:04)

Why, in one line: "Zimi works where the internet doesn't, in your pocket and in the box, and it doesn't break." Version 1.14.0.

Each experience gets a written review from fresh eyes on the real thing (phone screenshots, first 10 seconds, failure states): why, how it feels, verdict (ship / reshape / let's not). Eric signs.

What "ready" means:
- **Keep offline:** fresh install, a large ZIM, lock and kill mid-download then resume, airplane mode reads pictures, instant title search, full-text works, real numbers in "too big", remove asks, no endless spinner offline.
- **NOMAD:** a fresh agent follows the guide word for word on a clean NOMAD 1.35.1; replace Kiwix and switch back; NOMAD's ZIM folder byte-identical before and after; uninstall leaves NOMAD as it was. One unwritten step means not ready.
- **Create (saved pages):** 10 real pages from Firefox, Chrome and Safari (one .webarchive, one .mhtml) opened on the phone; links and pictures work; a bad input gives a plain sentence.
- **Search answers:** 30 real questions chosen before looking; if the card quotes a wrong or misleading sentence more than about 1 in 15, pull the card. The question-finding fix stays either way.
- **Red:** every screen at night on the iPhone, no white flash, the sky readable.
- **Upgrade from 1.13.3:** a real install upgrades with library, settings, kept files and sign-in intact; the GPL change stated plainly in the notes.

Sound overall: feature freeze, zero known data loss or crash, CI green, every CodeRabbit finding answered, a full suite run on the final tree, all six signed.

Recommended cuts and holds:
- Earth world-class: hold to the next release; Phase 0 (baseline, licences) can run now since it ships nothing.
- The Almanac: pull behind a flag until it passes its own review.
- Zimi Earth: ship only if it passes the phone pass, quiet either way.
- Field Guide / Help now: pulled; nothing in home, first run, sign-in or search may point at it.
- Docker +343 MB for capture tools: reshape (a -full tag, or install on first use) or state the size in the notes.
- Phone polish: only what fixes confusion.
