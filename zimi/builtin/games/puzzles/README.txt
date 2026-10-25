Simon Tatham's Portable Puzzle Collection, vendored into ZimiGames
=================================================================

What this is
  The collection's official WebAssembly build: 41 puzzles, each one a page
  (<name>.html), an Emscripten loader (<name>.js) and the puzzle itself
  (<name>.wasm). Plus the manual (doc/) and the puzzles' own icons (icons/).

Source and version
  Web build:  https://www.chiark.greenend.org.uk/~sgtatham/puzzles/js/
  Manual:     https://www.chiark.greenend.org.uk/~sgtatham/puzzles/doc/
  Icons:      https://www.chiark.greenend.org.uk/~sgtatham/puzzles/<name>-web.png
  Licence:    https://git.tartarus.org/simon/puzzles.git (file LICENCE)
  Version:    20260923.616da16  (the version string in the manual's licence page;
              upstream git commit 616da16f25da428ccda805536209095bd062676e,
              dated 2026-09-22; the built files are stamped 2026-09-23)
  Fetched:    2026-10-24

Licence
  MIT. Copyright 2004-2024 Simon Tatham, portions copyright the contributors
  named in LICENCE. The icons and the manual are part of the same source tree
  and carry the same licence. LICENCE here is the file from the source,
  unchanged. Group (group.html) is marked unfinished by its author; it is
  vendored as shipped and is not linked from upstream's own puzzle list.

What is unmodified
  Every <name>.js and <name>.wasm, byte for byte. The icons are the upstream
  <name>-web.png renamed to icons/<name>.png (Group has none upstream; the
  shelf draws its own).

What is changed in the HTML (all done mechanically by the script below)
  1. "../doc/" becomes "doc/", so the Full instructions link resolves inside
     this folder (the manual lives at puzzles/doc/).
  2. href="../" (Back to main puzzles page) becomes href="../puzzles.html",
     ZimiGames' own shelf for the collection.
  3. Links that leave the ZIM (https:, http:, mailto:) become plain <span>
     text, in the puzzle pages and the manual. Nothing is fetched from the
     network by any page; the manual's footnote URLs are shown as text only.
  4. ONE line is added to each puzzle page, just before its own script tag:
       <link rel="stylesheet" href="zimi-fit.css"><script defer src="zimi-fit.js"></script>
     zimi-fit.css and zimi-fit.js are the only files that are ours.

zimi-fit.css / zimi-fit.js
  Make the pages usable on a phone without touching puzzle code: a back bar,
  a box the puzzle fits itself to (the loader already supports this through
  #puzzlecanvascontain), touch-sized and themed menus, light and dark. On touch
  devices the script adds a tap-mode button (left, right or middle button, as
  the puzzles are written for a mouse) and, for the puzzles that take digits
  or letters (Solo, Keen, Towers, Unequal, Filling, Group), a keypad.
  The script is deferred and listed before the puzzle's own script, so it
  runs first and the fit box exists when the puzzle looks for it.

WebAssembly and the content type
  Emscripten tries WebAssembly.instantiateStreaming, which needs the response
  type application/wasm, and falls back to fetching an ArrayBuffer when the
  type is wrong (it logs "falling back to ArrayBuffer instantiation"). Tested
  with .wasm served as application/octet-stream: all 41 puzzles start.

Re-vendoring
  1. Fetch into a NEW empty scratch folder (treat it as untrusted data):
       base=https://www.chiark.greenend.org.uk/~sgtatham/puzzles
       curl -sL $base/js/ | grep -o 'href="[^"?/][^"]*"' | cut -d'"' -f2 > files.txt
       mkdir js doc icons
       (cd js && while read f; do curl -sfLO $base/js/$f; done < ../files.txt)
       (cd doc && for f in $(curl -sL $base/doc/ | grep -o 'href="[^"#]*\.html' | cut -d'"' -f2 | sort -u) index.html; do curl -sfLO $base/doc/$f; done)
       (cd icons && for p in $(ls ../js/*.html | xargs -n1 basename | sed 's/.html//'); do curl -sfLO $base/$p-web.png; done)
       git clone --depth 1 https://git.tartarus.org/simon/puzzles.git src
  2. Copy js/*.js js/*.wasm to this folder, icons/<name>-web.png to
     icons/<name>.png, src/LICENCE to LICENCE.
  3. Rewrite the HTML with this script (python3 -I rewrite.py js doc .):
       import re, sys, pathlib
       src, docs, dest = map(pathlib.Path, sys.argv[1:4])
       EXT = re.compile(r'<a\s+href="(?:https?:|mailto:)[^"]*"[^>]*>(.*?)</a>', re.S)
       FIT = '<link rel="stylesheet" href="zimi-fit.css"><script defer src="zimi-fit.js"></script>\n'
       SCRIPT = re.compile(r'<script defer type="text/javascript" src="[a-z]+\.js"></script>')
       for f in sorted(src.glob('*.html')):
           t = f.read_text(encoding='latin-1')
           t = t.replace('../doc/', 'doc/').replace('href="../"', 'href="../puzzles.html"')
           t = EXT.sub(r'<span>\1</span>', t)
           t, n = SCRIPT.subn(lambda m: FIT + m.group(0), t, 1)
           assert n == 1, f.name
           (dest / f.name).write_text(t, encoding='latin-1')
       (dest / 'doc').mkdir(exist_ok=True)
       for f in sorted(docs.glob('*.html')):
           t = EXT.sub(r'<span>\1</span>', f.read_text(encoding='latin-1'))
           (dest / 'doc' / f.name).write_text(t, encoding='latin-1')
  4. If the puzzle list changed, update puzzles.html (the shelf, one tile each)
     and the version line above. If a puzzle gained a digit keypad need, add it
     to KEYPAD in zimi-fit.js.
