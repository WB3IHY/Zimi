"""Pack the real-format saved pages into tests/fixtures/saved_pages.zip: mkfixture.py CORPUS OUT.zip"""

import sys, os, zipfile

corpus, out = sys.argv[1:3]
want = [("firefox-complete", n) for n in ("odd", "lazy", "frames", "base")]
want += [("firefox-html", "odd")]
want += [("singlefile", n) for n in ("odd", "lazy")]
want += [("chrome-mhtml", n) for n in ("odd", "lazy", "frames", "base")]
want += [("chrome-complete", n) for n in ("odd", "lazy", "frames", "base")]
want += [("safari-webarchive", n) for n in ("odd", "lazy", "frames", "base")]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for style, name in want:
        d = os.path.join(corpus, style, name)
        for r, _, fs in os.walk(d):
            for f in sorted(fs):
                p = os.path.join(r, f)
                z.write(p, os.path.relpath(p, corpus))
print(out, os.path.getsize(out))
