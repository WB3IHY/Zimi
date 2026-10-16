# The Moon in the real sky, Zimi with NOMAD, the library in your pocket

Eric, 2026-10-16 00:04: "Yes I said to setup NOMAD let's see how proper we can interstate and if we can be their default ZIM reader and search. I've asked so many times for the landing in the solar system feature with moon zoomed do it finally please. Then I drag and same solar system is in 3D moving. Let's find all the great things in the kiwix web app and improve and expand behind. These aren't next release let's start. Yes plan first. Involve Ive and three other influential thinkers / makers that fit here. We're building something."

Three pieces of work, built on v1.15's branch line but not gated on its release. Each is reviewed before it is built (Ive, Bret Victor, Brewster Kahle, Stewart Brand; see the end) and checked on Eric's iPhone before it is called done.

## The one idea

One library, three places it lives: the sky above you, the box on the shelf (Zimi beside NOMAD), and the phone in your pocket when there is no signal. Each place shows the same true thing: the Moon's real phase from the real geometry, the same ZIMs NOMAD downloaded, the same pages offline.

## 1. Land on the Moon, inside the solar system

What Eric asked for, repeatedly: open the Almanac and you are already in the live, true-position solar system, the camera on the Moon, so the first thing you see is tonight's Moon. Drag, and the camera pulls back through the same scene: Earth, the Sun, the planets where they are now, moving.

What already exists (code survey, 2026-10-16):

- The hero is an `<img>` sprite from `_moonView` (`app.js:6527`), the one derivation the sky, the Today card and the 3D Earth view share. Free on first paint, already correct.
- A horizontal drag on the hero already lifts it into a live 3D Moon in the Earth view (`_aeHandIn`, `almanac-earth.js`), frame-matched to the disc, with the pointer adopted so the finger never lifts. Three.js and the maps load when idle after first paint (`_aePrepareWhenIdle`), never on it.
- The flown solar system (`almanac-space.js`) is a second three.js scene: heliocentric J2000, planets from the orrery's Keplerian elements, the Moon from Meeus 47 precessed, probes from JPL tracks. Its own renderer, camera, loop, input and Moon mesh.

The shape:

1. **First paint stays the image.** No WebGL on the critical path; with WebGL off or a weak phone, the hero is the still Moon it is today.
2. **One ephemeris.** Extract `almanac-ephem.js`: `bodyPos(key, jd)` and the Moon's orientation basis, from `_aeSun` (VSOP87D), `_aeMoon` (Meeus 47) and `_planetHelio3D`, in one frame (heliocentric J2000 ecliptic, as Space uses), converted once at the edge for the Earth view. The page clock (focus time, time machine, orrery speed) drives it; there is no second clock.
3. **One scene for the landing.** Space's scene gains the Earth view's Moon (hi-res map, libration basis, Sun lighting, earthshine) and a camera state "the Moon from your place on Earth": target Moon, azimuth/elevation and roll from the observer, field of view matched to the hero disc. When the scene is warm (idle, as today), it replaces the image under the same pixels: you are now inside it, and nothing visibly changed.
4. **Drag pulls back.** Horizontal drag (vertical stays page scroll; the established rule) eases the camera out on a log scale from the Moon past Earth to the Sun-follow overview; Space's layout blend takes over from true scale where true scale would make the planets invisible, and says so. Release and it keeps moving at the page clock's rate. A tap on Earth hands to the Earth view for the surface and satellites.
5. **Then retire the duplicate.** The Earth view stops owning a Moon mesh and a renderer of its own for this hand-off.

Done means: the hero and the first GL frame match by screenshot diff on a 390 px phone; the landing paints no later than today (measured, cold and warm); ephemeris tests pin the Moon, Sun and planets at fixed dates against the existing values (`tests/test_almanac_*.cjs`) and JPL; sky-astronomer and physics-educator review it; Eric drags it on his iPhone.

Risks: bytes and battery (draw only when dirty, as `_aeDraw` does; one GL context at a time, as now); depth range from 1.35 Earth radii to Neptune (Space already uses a camera-relative origin); two Moon positions today (of-date vs precessed), which the single ephemeris removes.

## 2. Zimi with NOMAD

Facts from NOMAD's source (Apache-2.0, very active, 40k stars):

- Its apps are rows in a services table seeded on every boot; the Information Library is `kiwix-serve` on port 8090 over `<storage>/zim`. NOMAD's own UI never calls kiwix-serve over HTTP: the Open button is just a link.
- Anyone can add an app without forking: Supply Depot, "Add a custom app" (image, ports, binds, env), with Manage, Logs and Update. A tile's launch URL can be set by the user.
- Its AI assistant does not use kiwix at all: it chunks ZIM HTML into Qdrant and retrieves by vectors only. Its open issues name the gaps: no lexical lane (#947), boilerplate chunks (#1438), PDF ZIMs not indexed (#1445).
- It installs on Debian 12 / Ubuntu 24.04, x86_64, systemd; macOS is unsupported.

Pushback on "be their default reader": NOMAD has no reader contract to win. A user can point the Information Library tile at Zimi today. The seam where Zimi is clearly better is search: the assistant's missing lexical lane is exactly `/search`, `/chunks` and MCP.

The work:

1. **A real NOMAD.** Ubuntu 24.04 x86_64 VM in Parallels (installed on this Mac; check the licence), 4 vCPU, 8 GB, 60 GB, the stock installer, no AI assistant at first, one small ZIM. Never on the NAS.
2. **Works today, proven.** Zimi as a NOMAD custom app (pinned tag, `<storage>/zim:/nomad:ro`, `<storage>/zimi:/config`), the Information Library tile's launch URL set to Zimi. Test: a ZIM NOMAD downloads appears in Zimi within a minute; removal leaves it; NOMAD's Kiwix keeps running for its own plumbing. Write the paste-ready custom-app spec (admin password via `ZIMI_MANAGE_PASSWORD` in its env, never `ZIMI_LAN_ADMIN`: behind a proxy or tunnel everything looks local) into `docs/integrations/project-nomad.md`.
3. **A drop-in for any Kiwix client.** kiwix-serve's URL shapes Zimi lacks: `/content/<book>/<path>` (alias of `/w/`), `/viewer#<book>/<path>` (to the shell), `/raw/<book>/content|meta/...`, `/catalog/v2/` OPDS (root, entries, illustration), `/search?content=&pattern=`. These make Kiwix apps, scripts and NOMAD add-on links work against Zimi, and they are tested against kiwix-serve itself as the oracle.
4. **The pitch upstream, only with Eric's go and his words.** An issue first (their rule): a lexical retrieval lane for the assistant, shown working against the VM, with numbers on their own issues' examples. Not "replace Kiwix".
5. **Then hardlink adoption** (planned 1.15.x) on the real install.

## 3. The library in your pocket

Today the home-screen app needs the server; off the network it shows "Zimi is restarting…", which is untrue when it is the phone that is offline.

What the Kiwix web app does well (from its source): reads ZIMs in the browser (pure-JS reader, libzim WASM for full-text search), stores whole ZIMs in the browser's private storage with a quota panel, downloads from the Kiwix catalogue, link-hover previews of articles, follows a ZIM's own colour scheme, a trust prompt and a restricted mode for ZIMs with scripts, contents list, lazy image decompression for small phones. On iPhone it falls short: it cannot download or import into storage on Safari, so a ZIM must be picked from Files every session.

Where Zimi is already ahead: search across the whole library, did-you-mean and the best answer, the apps, Create, sharing, MCP.

Licence: kiwix-js and libzim's WASM build are GPL; Zimi is MIT. Reuse the ideas freely, not the code. The phone reader is written from the public ZIM specification with permissively licensed decompressors (zstd, xz); its search is the index Zimi's server already builds, packed beside the ZIM, so the phone gets Zimi's ranking without Xapian.

The work:

1. **Offline that tells the truth, now.** The service worker precaches the shell, the Almanac (all math, no server) and the Field Guide (quotes plus a JavaScript port of the phrase matcher, so Help now works with no signal). Pages you read and bookmark are kept for offline. Off the network the app says so and shows what still works.
2. **The iPhone spike.** One page, not committed to the tree, served over HTTPS from the NAS, added to Eric's home screen: a worker streams a small ZIM from Zimi's `/dl/` (HTTP Range, resumable) into the private file system with a synchronous access handle (the route Kiwix does not use, which is why it fails on Safari), asks for persistent storage, reads an article back, survives airplane mode and a relaunch. Then 1-2 GB. The answer decides the design; nothing is promised before it.
3. **Your library, packed for the phone.** In the app: choose ZIMs to carry, see sizes against the phone's free space, download while the app is open, read and search them with no signal. The phone pack is a ZIM plus Zimi's index for it.
4. **Kiwix's good ideas, in Zimi too.** Link previews in the reader; a ZIM's own colour scheme when it has one; a trust prompt before a stranger's ZIM runs scripts; contents for long articles (check what the reader already has first).

## Order

1. The Moon landing first: it is the oldest promise.
2. NOMAD's VM in parallel (mostly waiting on installs), then the custom app proven, then the kiwix-serve shapes.
3. Offline shell and Field Guide offline; the iPhone spike as soon as Eric can add a page to his home screen.

Every piece: a test that fails on the old code, a screenshot strip read at 390 px, a reviewer agent where one fits (sky-astronomer, physics-educator, survival-instructor, phone-path-tester), then Eric's iPhone. Nothing ships without Eric's go; nothing public goes out without his words.

## The review (2026-10-16, 00:20)

Four lenses, each a method from the person's published principles, not an impersonation: Jony Ive (craft, inevitability), Bret Victor (direct manipulation, explorable explanation), Brewster Kahle (universal access, open formats, lots of copies), Stewart Brand (access to tools, pace layers, the long now). What changes in the plan:

**The Moon landing**
- The landing looks exactly as it does today (Eric, 00:25: "same exact almanac landing as we had but it's a live solar system centered around that actual moon"). Ive's suggestion to enlarge the Moon is declined: the hero's size and place stay; what changes is that it is the real Moon in the live scene.
- The pull-back is one axis with named stops that snap softly: Moon, Earth and Moon, Earth, inner planets, Neptune. Each stop carries its true distance ("384,400 km, 1.3 light-seconds"); a thin distance track on the edge shows where you are and takes a tap to fly back (Ive, Victor).
- The cause of the phase is in the scene: the Sun's direction and the lit half, and once pulled back past Earth a drag changes the date while a small phase disc follows the angle (Victor). This is what a person learns from the gesture.
- The switch from true scale to the laid-out view is derived (the smallest planet in view under a pixel floor) and says "not to scale" in words (Ive, Brand).
- Defined edges: a drag before the scene is warm queues the pull-back; with no WebGL there is no drag affordance at all; a release stays where it is, with the way back always visible (Ive).
- The clock rate is shown when the view is moving ("real time"), with the orrery's speed control (Victor).
- `almanac-ephem.js` ships first as its own unit with no GL, pinned to JPL at fixed dates; the scene on top can be thrown away without touching the math (Brand's pace layers).
- One tool test beside the pixel tests: with no network, moonrise, phase and direction in two taps from the landing (Brand).

**Order** (Ive and Brand: split the certain from the uncertain)
1. Offline that tells the truth (3.1) and the ephemeris unit, in parallel with the landing. Both small and certain.
2. The landing.
3. NOMAD: the paste-ready custom app and tile URL first, then only the kiwix-serve URL shapes NOMAD or its add-ons link to (grep their source); the rest parked (Ive, Brand).
4. The phone spike, then the carried library.

**NOMAD** (Kahle, Ive)
- Write the 60-second experience first: a NOMAD owner taps the Information Library tile and lands in Zimi with their ZIMs already there. Design the one-ZIM, zero-ZIM and "NOMAD is still downloading" states.
- A ZIM NOMAD removes shows as "removed from NOMAD", its bookmarks kept; controls that would write to the read-only mount are off with a plain reason.
- Be a user first: ship the spec and the doc with no ask. Zimi works if Crosstalk never replies. The lexical-lane offer comes later as an optional adapter, never a scorecard on their issues. Say "reads the same files" and "speaks kiwix-serve's URLs", never "compatible" in a way that implies endorsement. Report any kiwix-serve ambiguity the oracle tests find to Kiwix.

**The library in your pocket** (Kahle, Brand, Ive)
- The phone pack's index is an open, versioned sidecar bound to the ZIM's UUID and checksum, with a written spec, the ranking recipe and a conformance file, published before any phone code; then proposed to openZIM. The ZIM itself stays byte-identical and is verified against its published checksum. The reader also reads a ZIM's own Xapian index where one exists.
- Clean-room discipline: the openZIM, zstd and xz specs as sources, kiwix-js not opened while the reader is written, libzim as the byte-level oracle in tests; the reader as a small standalone MIT library others can take.
- Never the only copy: "Save .zim to Files" so Kiwix on the same phone can open it, "Fetch again from my Zimi" as recovery, and an evict-and-recover step in the spike. The spike works on home Wi-Fi only (`/dl/` is private-network gated); say so.
- Choosing what to carry: one bar of the phone's free space filling as ZIMs are ticked, a tick that would not fit refused in words; resumable downloads with "keep this screen on", resumed first thing on reopen.
- Offline says which it is: "can't reach your server" apart from "no network".
- From Kiwix's ideas, link previews and the trust prompt for a stranger's ZIM with scripts; colour scheme and contents parked.
- Lasting past the software: a printable sky sheet (the year's Moon phases, rise and set for your latitude, finding north) beside the Field Guide's, and both as plain HTML with no JavaScript (Brand).

## NOMAD for real (2026-10-16, 01:30 to 02:05)

NOMAD v1.35.1 runs in a Multipass VM on the iMac (Eric chose the Mac over the NAS: less work for him), installed by its own installer after Eric accepted its terms. Every image pinned to its digest, its three auto-update switches off. A 100-article Wikipedia in its storage, rescanned by its own API.

Zimi added as a Supply Depot custom app through NOMAD's own API (`POST /api/system/services/custom`): image `zimi:1.15-dev` built in the VM from this branch, port 8600, `<storage>/zim` at `/nomad` with `ZIMI_EXTRA_ZIM_DIRS=/nomad`, `<storage>/zimi` at `/config`. It reads NOMAD's ZIM and searches it; NOMAD's folder is unchanged (nothing written beside the ZIM).

What a NOMAD user would hit, to fix in Zimi:
- **The data folder.** Docker creates a missing bind-mount folder owned by root; Zimi's image runs as `zimi` (1000:1000), so it stopped at start with "data dir /config is not writable" and NOMAD restarted it in a loop. The image should handle a fresh root-owned data folder itself (start as root only long enough to take ownership of the data folder, then drop to `zimi`), or the docs' custom-app spec must say how. Fixed by hand here with a chown.
- **A published image.** The NOMAD path needs 1.15 (`ZIMI_EXTRA_ZIM_DIRS`); 1.13.3 would have to mount NOMAD's folder as its own and could write there.
- NOMAD has no read-only option for a custom app's volumes; Zimi's own rule (extra folders are never written) is what keeps NOMAD's files safe.

## 1.15 has to feel complete (Eric, 2026-10-16 13:31)

"This is a mega release. ... This release has to be incredible, feel complete, and be bulletproof."

- [ ] CI green on v1.15 (3 Almanac browser failures after the merges, being fixed)
- [ ] The Moon at rest shows the system without a drag: camera stepped back past the Earth's limb, or the Sun and planets with no Earth. Both built, Eric picks from screenshots
- [ ] NOMAD done properly: image takes a fresh data folder, the Information Library tile opens Zimi, the kiwix-serve URLs NOMAD uses, the assistant seam, docs/integrations/project-nomad.md
- [ ] Full offline on the phone: ZIMs carried in the app, read and title-searched in airplane mode
- [x] Saved web pages (Firefox/Chrome "Web page, complete") link to each other in a folder ZIM
- [ ] Offline leftovers: versioned zone-places/almanac-space requests, /health?ping cached, the shell's own Help now
- [ ] Moon leftovers: the Moon as a dot mid-pull, RTL and keyboard, the plain tap, the duplicate Moon mesh, the silent catch in _aePrepare
- [ ] Eric's phone pass: Red everywhere, airplane mode, the Moon drag, section bar, tides, clocks
- [ ] Ultracode review when Eric says, then fixes
- [ ] Version, PR text and release notes (Eric's)
