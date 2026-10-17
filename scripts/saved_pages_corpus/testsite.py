"""A license-safe page that exercises every way a browser names and references a page's parts.
Serve: python3 testsite.py PORT   (pages: /odd.html /base.html /frames.html /lazy.html)
"""

import io, sys, http.server, urllib.parse
from PIL import Image, ImageDraw


def png(color, label, size=(160, 100)):
    im = Image.new("RGB", size, color)
    d = ImageDraw.Draw(im)
    d.rectangle([4, 4, size[0] - 5, size[1] - 5], outline="white", width=3)
    d.text((12, 40), label, fill="white")
    b = io.BytesIO()
    im.save(b, "PNG")
    return b.getvalue()


def jpg(color, label):
    im = Image.open(io.BytesIO(png(color, label)))
    b = io.BytesIO()
    im.save(b, "JPEG")
    return b.getvalue()


CSS_MAIN = b"""@import url("/css/extra");
body{font-family:Georgia,serif;margin:20px;background:#fafafa}
.bg{width:160px;height:100px;background:url('/img/bg%20image.png') no-repeat;border:1px solid #333}
.bg2{width:160px;height:100px;background-image:url(/img/bgq.php?id=7);}
@font-face{font-family:Fnt;src:url(/fonts/f.woff2) format('woff2')}
"""
CSS_EXTRA = b".extra{color:#c00;font-weight:bold}\n"

SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#0a8"/><text x="8" y="35" fill="#fff">file.svg</text></svg>'

PAGES = {}
PAGES["/odd.html"] = """<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Café (50% off) – naïve & "more"?</title>
<link rel="stylesheet" href="/css/main.css"><link rel="stylesheet" href="/css/style">
<link rel="icon" href="/img/favicon.png">
<script src="/js/app.js"></script>
</head><body><h1 class="extra">Café 50% off</h1>
<p>Plain png: <img src="/img/plain.png" alt="plain"></p>
<p>No extension: <img src="/img/noext" alt="noext"></p>
<p>Query string: <img src="/img/pic.php?id=3&amp;size=big" alt="query"> and <img src="/img/pic.php?id=4" alt="query4"></p>
<p>Spaces/parens/percent/unicode: <img src="/img/my%20pic%20(1).png" alt="sp"> <img src="/img/100%25.png" alt="pc"> <img src="/img/%C3%A9t%C3%A9.png" alt="u"></p>
<p>Collision: <img src="/a/logo.png" alt="la"> <img src="/b/logo.png" alt="lb"></p>
<p>srcset: <img src="/img/s1.png" srcset="/img/s1.png 1x, /img/s2.png 2x" alt="srcset"></p>
<picture><source srcset="/img/pic_wide.png 800w, /img/pic_narrow.png 400w" media="(min-width:600px)"><img src="/img/pic_fallback.png" alt="picture"></picture>
<p>CSS bg: <span class="bg"></span> <span class="bg2"></span></p>
<p>Inline style: <span style="display:inline-block;width:160px;height:100px;background:url('/img/inline bg.png')"></span></p>
<p>SVG file: <img src="/img/file.svg" alt="svg"> object: <object data="/img/file.svg" type="image/svg+xml" width="120" height="60"></object></p>
<p>Inline SVG: <svg width="120" height="60" viewBox="0 0 120 60"><rect width="120" height="60" fill="#a0a"/><circle cx="60" cy="30" r="20" fill="#ff0"/></svg></p>
<video poster="/img/poster.png" width="160" height="100"></video>
<p>Link to image: <a href="/img/big.png">big</a> and another page <a href="/base.html">base</a></p>
</body></html>"""

PAGES[
    "/base.html"
] = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>Base tag page</title>
<base href="/sub/dir/"><link rel="stylesheet" href="rel.css"></head><body>
<h1 class="rel">Relative to base</h1><img src="rel.png" alt="rel"><img src="../up.png" alt="up"></body></html>"""

PAGES[
    "/frames.html"
] = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>Frames page</title></head><body>
<h1>Outer</h1><img src="/img/outer.png" alt="outer">
<iframe src="/frame-inner.html" width="360" height="200"></iframe>
<iframe srcdoc="&lt;p&gt;srcdoc&lt;/p&gt;&lt;img src=/img/srcdoc.png&gt;" width="300" height="160"></iframe>
</body></html>"""
PAGES[
    "/frame-inner.html"
] = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>inner</title><link rel="stylesheet" href="/css/main.css"></head><body>
<h3 class="extra">Inner frame</h3><img src="/img/inner.png" alt="inner"></body></html>"""

PAGES[
    "/lazy.html"
] = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lazy page</title></head><body>
<h1>Lazy</h1>
<img class="lazy" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="http://localhost:8765/img/lazy1.png" alt="lazy1" loading="lazy">
<img class="lazy" data-src="http://localhost:8765/img/lazy2.png" data-srcset="http://localhost:8765/img/lazy2.png 1x, http://localhost:8765/img/lazy2x.png 2x" alt="lazy2">
<div style="height:2500px"></div>
<img src="/img/below.png" loading="lazy" alt="below the fold" width="160" height="100">
<script>addEventListener('DOMContentLoaded',()=>{document.querySelectorAll('img.lazy').forEach(i=>{i.src=i.dataset.src});});</script>
</body></html>"""

COLORS = ["#c33", "#3a3", "#33c", "#c93", "#939", "#399", "#666", "#a52"]


def route(path, query):
    if path in PAGES:
        return "text/html; charset=utf-8", PAGES[path].encode()
    if path == "/css/main.css":
        return "text/css", CSS_MAIN
    if path == "/css/style":
        return "text/css", b".style{color:#06c}\n"
    if path == "/css/extra":
        return "text/css", CSS_EXTRA
    if path == "/sub/dir/rel.css":
        return "text/css", b".rel{color:#080}\n"
    if path == "/js/app.js":
        return "application/javascript", b"document.title=document.title;"
    if path == "/fonts/f.woff2":
        return "font/woff2", b"wOF2" + b"\0" * 60
    if path.endswith(".svg"):
        return "image/svg+xml", SVG
    if path == "/img/noext":
        return "image/jpeg", jpg("#a52", "noext")
    if path == "/img/pic.php":
        return "image/jpeg", jpg(
            COLORS[int(query.get("id", ["0"])[0]) % 8], "id" + query.get("id", ["0"])[0]
        )
    if path == "/img/bgq.php":
        return "image/png", png("#285", "bgq")
    if path.endswith(".png"):
        name = path.rsplit("/", 1)[-1]
        if path.startswith("/a/"):
            return "image/png", png("#e33", "a/logo")
        if path.startswith("/b/"):
            return "image/png", png("#33e", "b/logo")
        return "image/png", png(COLORS[sum(map(ord, path)) % 8], name[:14])
    return None


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        r = route(urllib.parse.unquote(u.path), urllib.parse.parse_qs(u.query))
        if not r:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", r[0])
        self.send_header("Content-Length", str(len(r[1])))
        self.end_headers()
        self.wfile.write(r[1])

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
