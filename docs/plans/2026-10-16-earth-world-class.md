# Earth, world class (1.15)

Eric, 2026-10-16: "Earth I want this release like rock solid world class high res option to download local satellite and/or road on the fly look at gods eye view project. Not the same but we can be awesome. And Richard Feynman throughout this whole page subtly helping it sink in effortlessly (few words). Zimi is special, we're making this amazing thing that will be there when nothing else really is."

Status: plan only, no code. Facts below marked (verify) were read from a summary of a page or a search result, not from the licence text itself; each is a Phase 0 check before anything ships.

## 1. The one job, and one globe or two

**One job:** hold the whole planet in your hand, come down to your street, and keep the part you need when the internet is gone.

**Recommendation: one globe.** Today there are two: the Almanac's 3D Earth (`almanac-earth.js`, 3,135 lines, Sun, Moon, eclipses, GPS and ISS, its own 128x64 sphere, atmosphere, star field) and Zimi Earth (`earth.html` + `globe.js`, 396 lines, the library's places, which `almanac-look.js` also uses). They load the same two 2048x1024 textures (`earth-day-v1.webp` 91 KB, `earth-night-v1.webp` 56 KB) and the same three.js r186, but each makes its own scene. Every imagery improvement would have to be built twice.

- `globe.js` becomes the one Earth: textures, tile layer, atmosphere, terminator, camera, projection, dots. It already has the right API (`set`, `get`, `project`, `bounds`, `setTime`).
- The Almanac's view keeps what only it has (Moon, Sun, eclipse shadow, star field, orbits) and mounts `ZimiGlobe` for the planet itself. Same ball, more sky around it.
- Cost: this is the riskiest refactor in the plan. Do it in Phase 1, behind the Almanac's existing tests, and only if the Almanac's eclipse render is pixel-equal afterwards. If it is not, the Almanac keeps its own sphere and shares only the texture and tile code (fallback, still one imagery pipeline).

## 2. What world class means here

**Visual bar**
- Resolution is a ladder, never a blur: a sharp picture at every altitude. Today `ALT_MIN` is 0.0016 Earth radii (about 10 km up) while a 2048 px map is about 19.6 km per pixel: coming down to a street shows mush. That is the single biggest gap.
- Tiers: T0 shipped 2K (instant, works with no setup, today's files); T1 the World pack (optional download, about 500 m per pixel, to roughly 100 km up); T2 Area packs (10 m satellite, roads, terrain, for a place you choose).
- Atmosphere as a thin blue limb glow, brighter on the sunlit side, plus a soft terminator (the Almanac's `AE_ATMOSPHERE_SCALE` shell already does this; unify).
- Night lights at T1 resolution so cities are points of light, and the terminator moves through them in real time.
- Terrain: shaded relief is baked into Blue Marble topo. For areas, Terrarium elevation tiles drive hillshade and mild vertex relief (Phase 3). No fake clouds.
- Clouds: **cut from this release.** A static cloud layer is a lie about today, and a Feynman page cannot afford one. If wanted later: NASA GIBS true-colour, fetched only under the consent rule, labelled with its date.

**Performance bar (iPhone, Safari, 390 px, DPR capped at 2)**
- 60 fps while dragging on a recent iPhone, 30 on an iPhone XR-class; first paint of the T0 globe under 1 s on LAN; never more than about 64 MB of resident tile textures, with eviction; no main-thread work on tile decode (use `createImageBitmap`).
- Texture memory is the trap. A single 8192x4096 texture is 134 MB uncompressed (about 180 MB with mips) and older iPhones cap textures at 4096. So no giant texture: **tiled globe** (quadtree of 256 px or 512 px tiles over the sphere, 32x32 mesh per tile) with the T0 map as the always-there fallback under it.
- **Not yet measured.** I did not run an emulated iPhone for this plan. Phase 0 records the baseline (fps while dragging, JS heap, GPU texture bytes) for `earth.html` and the Almanac Earth on the 390 px emulation and on Eric's phone; every later phase is compared to it, on the largest realistic input (the T1 pack plus a 30 km area pack).

**Offline bar**
- T0 and every kept pack work in airplane mode on the phone, proven on Eric's iPhone, as Keep was.
- Zero outbound calls without the consent rule (section 3). Under `ZIMI_OFFLINE`, none, ever.
- The Earth page never shows an empty tile or a spinner when offline: it shows the best tier it has, and one calm line saying which ("Sharp here. Softer beyond.").

## 3. Imagery and roads

| Source | Licence | Quality | Offline keep? | Verdict |
|---|---|---|---|---|
| NASA Blue Marble Next Generation (topo + bathymetry), 500 m, already our T0 source | NASA imagery, generally not copyrighted in the US, credit NASA | 500 m global, monthly, seamless | Yes | **T1 base.** Cut a tile pyramid to about z7 from the 86400x43200 master. |
| NASA Black Marble (VIIRS night lights) | NASA, same | 500 m to 3 km products | Yes | **T1 night.** |
| NASA GIBS (WMTS, MODIS/VIIRS daily, Blue Marble layers to zoom 8) | NASA data, free (terms page not read; verify) | 250 m to 500 m daily | Allowed in spirit, check rate limits | Optional "today" layers later, behind consent. Not in the base plan. |
| Sentinel-2 cloudless, EOX | The 2016 mosaic is CC BY 4.0, later years are CC BY-NC-SA 4.0 with a commercial licence on request (verify each year on the licence page). Attribution: "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data <year>)" | 10 m, cloud free, best looking global 10 m | Yes under its licence | **Use 2016 only unless EOX confirms in writing.** NC is a problem for Zimi (GPL, anyone may redistribute and sell it; a pack with NC data cannot be inside that promise). 2016 at 10 m is visibly dated (cities grown) and must say "2016" on the page. |
| Copernicus Sentinel-2 raw (free, full and open, attribution "Contains modified Copernicus Sentinel data") | Free, full, open | 10 m, current | Yes | **The no-doubt path for current imagery**, but we would build our own composite: heavy (cloud masking, mosaicking). Park as a post-release build script run by us, not by phones. |
| USGS NAIP via The National Map | US federal, public domain (verify service terms) | 0.6 to 1 m, US only, 2 to 3 year cycle | Yes | **Phase 3 stretch for US areas**: the "oh wow" tier. Small bbox only (see sizes). |
| Esri World Imagery | Free terms do not allow exporting or systematically caching tiles for offline; a separate "for Export" layer sits under ArcGIS licensing | Excellent | **No** | Excluded. |
| Mapbox, Google, Bing | Forbidden to cache/retain | Excellent | **No** | Excluded. (God's Eye View uses Google's tiles at runtime; that is exactly the part that cannot exist offline.) |
| OpenStreetMap via Protomaps PMTiles | The tiles are an ODbL "Produced Work": attribute "(c) OpenStreetMap contributors", say it is ODbL, link the licence. Share-alike applies to a derived database, not to the picture, so a downloaded area for display needs attribution only; if we publish a modified OSM database we must publish it under ODbL | Vector, z0 to z15, current, daily builds; planet about 120 GB | Yes, `pmtiles extract --bbox --maxzoom` | **The road layer.** |
| Terrarium elevation tiles (Mapterhorn or AWS Terrain Tiles; source mix, verify) | Open, per-source attribution | 10 to 30 m | Yes | Phase 3, small. |
| StreetZim regions (already supported: `streetzim.py`, `mapsearch.py`) | OSM-based, ODbL; some carry satellite, terrain, routing | Already works, on Internet Archive | Yes, they are ZIMs | **Use first.** If the library holds a StreetZim region for where you are, Earth uses it with no new download and no new format. |

**Sizes (estimates; Phase 0 measures them from real extracts, I have not):**
- Web Mercator z14 is about 9.5 m per pixel at the equator (about 7 m at 40 degrees), so Sentinel-2's 10 m is fully used at z14 and oversampled at z15.
- A 30 km by 30 km city at z0 to z14, JPEG at q70, 256 px tiles of about 25 to 30 KB: roughly 200 tiles at z14 plus the lower levels, so single-digit MB to about 15 MB. Add z15 and it is about 4x that.
- Roads for the same box, vector z0 to z15: tens of MB for a dense metro, a few MB for a rural box. Each extra zoom about doubles it.
- NAIP at z17 (about 1 m): a 5 km square is about 4,400 tiles, about 130 MB; 30 km square is about 160,000 tiles, about 4.5 GB. So NAIP is for "my neighbourhood", capped by a size shown before you tap.
- T1 world pyramid to z7 from Blue Marble: about 21,800 tiles, ocean tiles are tiny; guess 100 to 200 MB with night; this is the only large "everyone" download, optional and resumable.

**"Download this area" flow (one tap)**
1. On the globe, come down to a place. A single chip appears: `Keep this area  38 MB`. The size is a label, computed before the tap from the bbox and zoom range (tile count times measured average), never a warning dialog.
2. Default box: a rectangle around the view centre (or the "me" dot) sized to the screen at the current zoom, snapped to tiles, zoom range chosen by size budget: satellite z0 to z14 plus roads z0 to z15 by default. A "Sharper" stepper adds a zoom level and the label updates (38 MB, 150 MB). A "Wider" stepper does the same for the box. No sliders, no map-drawing tool.
3. Server side, one background job (a sibling of the Create job's single slot): fetch tiles with `zimi.outbound.FetchPolicy` (already the repo's rule: Ask first / Automatically / Never, `ZIMI_OFFLINE` forces never), low rate, Zimi's user agent, nothing about the user, write one `area-<id>.pmtiles` into `ZIMI_DATA_DIR/earth/`, with a sidecar JSON for bbox, zoom range, sources, licence text and fetch date.
4. **Consent.** First tap with the setting on Ask shows one sentence: which host Zimi will contact, how much, and a single Keep button. After one yes, the setting can be Automatically. Never leaves the chip off and says why. Same three words and same place in Manage as the satellite setting, not a new vocabulary.
5. **Where it lives.** Two places, one file: the server keeps the PMTiles for everyone on that Zimi (the NAS, a NOMAD box), and the phone's **Keep** copies the same file into OPFS using the existing Keep machinery (`keepstore.js`, `keepworker.js`, the service worker's range reads). PMTiles is one static file read by HTTP range, so the same reader works from the server or from OPFS; no tile database to build on the phone. On the page, kept areas show as a soft outline on the globe; the chip says `Kept  38 MB`, and Manage lists them with a delete.
6. Order of preference when drawing: kept phone pack, then server pack, then T1, then T0. Never a network fetch from the browser to a third party: the server is the only thing that talks out, so a phone on a plane or a hostile Wi-Fi leaks nothing.
7. Attribution is part of the pack: a small, always-present credit line on the globe while a pack is showing ("OpenStreetMap contributors, ODbL. Imagery: Copernicus Sentinel 2016, EOX."), and the licence text in the sidecar and in `THIRD_PARTY_NOTICES.md` and `static/earth/SOURCES.txt`, which already carries this discipline.

## 4. Layers

God's Eye View (MIT, CesiumJS, Google Photorealistic 3D Tiles, 20+ live layers: 11,000 flights, ships, satellites, USGS quakes, NASA FIRMS fires, weather radar and lightning, about 4,000 CCTV and ALPR camera points, traffic, transit, a voice agent, cockpit riding live aircraft, seven sensor looks, shareable cinematic scenes). What makes it feel world class is not the data, it is that it is one continuous move from space to a street with a live world on top, plus cinematic camera moves and shareable scenes. Almost all of it needs live internet and several paid or keyed services (Google, OpenAI, TomTom). Not copying it; learning from three things: the unbroken zoom, the "scene" you can share, and layers that are toggles on one ball.

**Layers worth having (all work with no internet unless noted)**
- The library's places (exists: Wikipedia/Wikivoyage coordinates, `earth.py` R*Tree). Keep it the soul of the page: touch a place, get the article.
- Day and night with the live terminator and the subsolar point (exists in `globe.js` `subsolar`). The sun marker becomes visible as a thing.
- Satellites: GPS and ISS from the shipped snapshot, propagated locally by SGP4 (exists in the Almanac). Same freshness rules as `satellites.py`. Show the ground track.
- Eclipses: the Moon's shadow path across the Earth for the next and last eclipse, pure maths already in `almanac-earth.js`.
- Kept areas: the user's own packs, outlined.
- Quakes and volcanoes: only if the library holds the data. Wikipedia lists have coordinates; a "big quakes and volcanoes the library knows" layer can come from `earth.py` rows whose article is in those categories, with no live feed. Cheap to try, valued only if it is clean; otherwise cut.
- Live online-only extras (later, not this release): USGS quakes in the last day, GIBS daily clouds, each off by default behind consent.

**Deliberately not doing:** CCTV, ALPR, plate readers, live aircraft or ship tracking of individuals, military traffic, street-level photos of people's streets, face or person search. Zimi's promise is knowledge that outlives the network and a person standing somewhere with a battery, not surveillance, and live feeds are the opposite of offline. God's Eye View itself declines named-person search; we go further and skip the genre. No voice agent, no cockpit mode, no sensor-filter gimmicks. One restrained exception worth considering later: "scene" links that encode lat, lon, altitude, time into a URL, because that is how a place is shared with nobody's data attached.

## 5. Feynman, throughout

Voice: plain, curious, few words, a question or a "notice that" at the moment the thing is on screen. Our own sentences, written in the spirit of his plainness; no quotations of him, no name on the page (the page never says "Feynman"). One caption at a time, shown once per visit (remembered per device), dismissed by touch, never a modal, never over a tapped place card. Text is i18n strings (10 languages) and must pass the Red theme and RTL.

| # | Line | Where it appears |
|---|---|---|
| 1 | "The dark edge is curved because the Earth is round. Nothing else could do that." | First time the terminator is visible on the T0 globe |
| 2 | "It is noon somewhere right now. Always." | When the sun marker is on screen |
| 3 | "That's the ISS. It goes round in 90 minutes. Sixteen sunrises a day." | Tapping the ISS dot |
| 4 | "Falling, and always missing the ground. That's an orbit." | ISS card, second line |
| 5 | "Your phone knows where you are by listening to clocks in the sky." | Tapping a GPS satellite |
| 6 | "Those clocks run fast up there. Gravity is weaker. Without the fix, you'd be off by miles a day." | GPS card, second line (physics-educator review before it ships) |
| 7 | "The Moon's shadow is the size of a city. Where it lands, day turns to dusk." | Eclipse layer, shadow on the globe |
| 8 | "Each light is a town. Count them: that's where the electricity is." | First time the night side shows in the T1 night map |
| 9 | "Same Earth, closer. The picture is sharper because your phone kept it." | The moment a kept area replaces the soft tier on zoom |
| 10 | "This took a satellite one pass to see. You're holding it offline." | The `Kept  38 MB` chip, after the first successful keep |
| 11 | "Roads follow rivers and valleys. Find the water, find the town." | Roads layer on first view over relief |
| 12 | "Fewer tiles, less to carry. Zoom out and it all fits in your hand." | The size label stepper when you choose Wider |

All twelve are candidates; ship the 6 or 8 that land best on the phone, not all. Rules: never more than one a screen, never explaining what a button does (that is the UI's job), and the physics ones go through the `physics-educator` agent before they ship (line 6 especially: "miles a day" must be checked against the usual 38 microseconds a day, about 10 km of drift).

## 6. Phased build

**Phase 0, baseline and facts (first):** emulated iPhone and Eric's phone numbers for both globes (fps, heap, texture bytes, first paint); read each licence in full (EOX per year, NAIP and National Map service terms, GIBS terms, Terrarium/Mapterhorn attribution); extract one real city PMTiles and one NAIP box to replace every size estimate above. Write the actual numbers into this doc. Acceptance: table of measured values; licences either confirmed or the source dropped.

**Phase 1, one globe and a tiled sphere:** `globe.js` becomes the single Earth with a quadtree tile layer over the T0 map, atmosphere and terminator unified; Almanac mounts it. Acceptance: Almanac eclipse render unchanged, `tests/test_globe.cjs` passes, dragging at least as smooth as baseline on the phone, texture cache stays under budget with eviction, WebGL2-off and reduced-motion paths still show the T0 globe, Red theme recolours it.

**Phase 2, T1 World pack and a reader:** PMTiles reader in JS (range reads from the server and from OPFS), server `/earth/tiles` serving a pack by range, Manage entry "World pack  about 150 MB" with Keep. Acceptance: offline after keep proven in airplane mode on Eric's iPhone; T0 shows with no pack and no network; no unexpected outbound call (server log checked), `ZIMI_OFFLINE` forced never.

**Phase 3, Area packs:** the chip, the size label, the stepper, the server job, consent Ask / Automatically / Never, satellite (2016 CC BY) plus OSM roads, kept outline, Manage list with delete, attribution line, notices. Acceptance, all on the 390 px emulation and the real phone: tap Keep on a city, size label within 15 percent of the real file, airplane mode afterwards, zoom to the street in both themes including Red, delete removes the file on server and phone, setting Never hides the chip with a reason, interrupted job resumes, a second user cannot read a pack the first was not allowed (per-user rules unchanged), no hard-wrapped or em-dash text in strings, CodeRabbit clean.

**Phase 4, Feynman and polish:** the 6 to 8 captions, one at a time, per-device once; phone-path-tester screenshots read by eye (a pass of every tier and caption), `physics-educator` review, `survival-instructor` review of Earth-as-a-tool, a Jony Ive review of the chip and the credit line.

**Stretch only if everything above is green:** NAIP for US boxes; Terrarium relief; the library-quakes layer; scene links.

**Waits (not this release):** current-year imagery composite built from Copernicus raw; live layers (quakes, clouds); EOX later years; any globe-wide 10 m pack (tens of GB); Android-specific Keep polish if it differs.

## 7. Risks

- **Scope.** This is a release in itself. Mitigation: Phases 0 to 2 are the minimum credible "world class" (sharp planet, offline, one globe); Phase 3 is the headline; stop at the first red phase rather than ship four half things. Pattern flag (once): Earth is the new energy while search, NOMAD proof and the Almanac verification are still open on this branch.
- **Licence.** NC-SA imagery in a GPL product is a real trap; the plan uses 2016 CC BY only and treats anything else as excluded until written confirmation. ODbL attribution must be visible, not buried. A mistake here cannot be re-cut (merged versions are spent).
- **iOS memory and WebGL limits.** Tiled textures with eviction and a measured budget; a hard fallback to T0. Test on the phone, not only the emulation.
- **Merging the globes.** The Almanac eclipse render is the thing most likely to regress; the fallback is sharing the tile code only.
- **Outbound traffic.** Area jobs hit third-party tile servers. Must go through `FetchPolicy`, rate limited, with a respectful user agent; check each provider's tile usage policy (bulk download of a handful of MB per user is normally fine, a bulk crawl is not; EOX's WMTS terms in particular, verify). Fallback: we build and host packs ourselves and Zimi fetches a ready file.
- **Size surprises.** Estimates above are guesses until Phase 0. If a default area is over about 100 MB it is the wrong default.
- **Dated imagery.** 2016 at 10 m will show old cities. Say the year, in the chip and credit. Current imagery is a post-release build.
- **Feynman tone.** Cute is the failure mode. Few words, true, one at a time, and the physics lines reviewed before they ship.
- **NOMAD and shared hosts.** Packs are big files on a box someone else owns; they go in Zimi's own data dir, never in NOMAD's ZIM folder.
