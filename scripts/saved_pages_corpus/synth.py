"""Reproductions of the two formats that cannot be driven headless here.
 - safari-webarchive: a real Chrome MHTML snapshot's parts written with Safari's .webarchive keys (plistlib)
 - chrome-complete: a real Firefox 'complete' save with Chrome's conventions
   (./ prefix on every reference, `<!-- saved from url=... -->`, `name (1).ext` for a clash, no %-less names)
usage: synth.py CORPUS name ..."""

import sys, os, re, plistlib, email, email.policy, shutil, glob, urllib.parse

corpus = os.path.abspath(sys.argv[1])
for name in sys.argv[2:]:
    # --- safari
    mh = glob.glob(f"{corpus}/chrome-mhtml/{name}/*.mhtml")[0]
    msg = email.message_from_binary_file(open(mh, "rb"), policy=email.policy.compat32)
    top = msg.get("Snapshot-Content-Location")
    parts = [p for p in msg.walk() if not p.is_multipart()]
    main = next(p for p in parts if p.get("Content-Location") == top)

    def res(p):
        return {
            "WebResourceData": p.get_payload(decode=True),
            "WebResourceMIMEType": p.get_content_type(),
            "WebResourceURL": p.get("Content-Location") or "",
            **(
                {"WebResourceTextEncodingName": p.get_content_charset()}
                if p.get_content_charset()
                else {}
            ),
        }

    arch = {
        "WebMainResource": {**res(main), "WebResourceFrameName": ""},
        "WebSubresources": [
            res(p)
            for p in parts
            if p is not main and p.get_content_type() != "text/html"
        ],
        "WebSubframeArchives": [
            {"WebMainResource": {**res(p), "WebResourceFrameName": ""}}
            for p in parts
            if p is not main and p.get_content_type() == "text/html"
        ],
    }
    d = f"{corpus}/safari-webarchive/{name}"
    os.makedirs(d, exist_ok=True)
    title = os.path.splitext(os.path.basename(mh))[0]
    with open(f"{d}/{title}.webarchive", "wb") as f:
        plistlib.dump(arch, f, fmt=plistlib.FMT_BINARY)
    # --- chrome complete
    src = f"{corpus}/firefox-complete/{name}"
    dst = f"{corpus}/chrome-complete/{name}"
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(src, dst)
    html = [f for f in os.listdir(dst) if f.endswith(".html")][0]
    folder = [f for f in os.listdir(dst) if f.endswith("_files")][0]
    # clash names: logo_002.png -> logo (1).png
    ren = {}
    for r, _, fs in os.walk(f"{dst}/{folder}"):
        for f in fs:
            m = re.match(r"^(.*)_00(\d)(\.[^.]*)?$", f)
            if m and os.path.exists(os.path.join(r, m.group(1) + (m.group(3) or ""))):
                new = f"{m.group(1)} ({int(m.group(2)) - 1}){m.group(3) or ''}"
                os.rename(os.path.join(r, f), os.path.join(r, new))
                ren[f] = new
    text = open(f"{dst}/{html}", encoding="utf-8").read()
    for a, b in ren.items():
        text = text.replace(urllib.parse.quote(a), urllib.parse.quote(b))

    # Chrome escapes the % of a name; Firefox leaves it bare
    text = re.sub(
        r'(src|href|srcset|data|poster)="(?!\.?/|https?:|data:|#|mailto:|javascript:)([^"]*?_files/)',
        lambda m: f'{m.group(1)}="./' + re.sub(r"%(?![0-9A-Fa-f]{2})", "%25", m.group(2)),
        text,
    )
    url = "http://localhost:8765/" + name + ".html"
    text = f"<!-- saved from url=({len(url):04d}){url} -->\n" + text
    open(f"{dst}/{html}", "w", encoding="utf-8").write(text)
    print("synthesized", name)
