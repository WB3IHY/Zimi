"""Pages saved from a browser, packaged so they read the way the page did.

A browser saves a page one of four ways, and Zimi's folder packaging takes all:

- **Web page, complete** (Firefox, Chrome, Edge): ``Page.html`` beside a
  ``Page_files/`` folder of its parts. The HTML points into the folder.
- **HTML only** / **Page source**: the bytes the server sent, pointing at the
  live web. Nothing to find; the page keeps what it had.
- **Single file** (Chrome ``.mhtml``, Safari ``.webarchive``, SingleFile
  ``.html``): every part inside one file. The two archives are unpacked here
  into the first layout, so one path handles both.

What a saved page needs that a plain folder of HTML does not
(docs/features/saved-pages.md has the measured details):

- its ``_files`` folder belongs to it: not a gallery, not an index entry,
  not a search hit (``owners``);
- a stylesheet or script a browser saved without an extension is still one
  (``mime_for``): a browser refuses a stylesheet that does not say so;
- a reference Firefox wrote with a bare ``%`` is a valid one (``prepare``);
- a picture the page's own script would swap for its live-web address
  (``data-src`` and its kin) keeps the saved copy (``prepare``): the reader
  does not reach the web, and the copy is in the folder.
"""

import bisect
import email
import email.policy
import html as _html
import mimetypes
import os
import plistlib
import posixpath
import re
import urllib.parse

from zimi import folderfiles as _ff
from zimi.zimwriter import _split_srcset, attr_quote, attr_re, guess_mime, sub_markup

# The attributes lazy-loading scripts keep a picture's real address in, and set
# ``src`` / ``srcset`` from when it nears the screen.
LAZY_SRC_ATTRS = (
    "data-src",
    "data-original",
    "data-lazy-src",
    "data-lazy",
    "data-echo",
    "data-img-src",
    "data-hi-res-src",
)
LAZY_SRCSET_ATTRS = ("data-srcset", "data-lazy-srcset", "data-original-set")

_IMG_TAG_RE = re.compile(r"<(?:img|source)\b[^>]*>", re.I)
_PICTURE_RE = re.compile(r"<picture\b.*?</picture>", re.I | re.S)
_SOURCE_TAG_RE = re.compile(r"<source\b[^>]*>\s*", re.I)
_LINK_TAG_RE = re.compile(r"<link\b[^>]*>", re.I)
_SCRIPT_SRC_TAG_RE = re.compile(r"<script\b[^>]*>", re.I)
_URL_ATTR_RE = attr_re("src", "href", "srcset", "poster", "data", "action")
_SRC_RE = attr_re("src")
_SRCSET_RE = attr_re("srcset")
_HREF_RE = attr_re("href")
_REL_RE = attr_re("rel")
_BARE_PERCENT_RE = re.compile(r"%(?![0-9A-Fa-f]{2})")
_NOT_LOCAL_RE = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//|/|#)", re.I)


# ── what belongs to a page ──────────────────────────────────────────────────


def _children_by_dir(rels):
    """{folder: {names of the folders directly inside it}} for these paths."""
    out = {}
    for rel in rels:
        parts = rel.split("/")[:-1]
        for i, name in enumerate(parts):
            out.setdefault("/".join(parts[:i]), set()).add(name)
    return out


def owners(items, read_text):
    """``{path: page}`` for every file inside a folder a saved page owns.

    ``items`` are ``(fs, rel, family)``; ``read_text(fs)`` gives a page's text
    (asked only for a page whose folder is not named ``<page>_files``)."""
    rels = sorted(rel for _fs, rel, _fam in items)
    fs_of = {rel: fs for fs, rel, _fam in items}
    children = _children_by_dir(rels)
    owned = {}
    for rel in rels:
        if posixpath.splitext(rel.lower())[1] not in _ff.PAGE_EXTS:
            continue
        parent, name = posixpath.split(rel)
        names = sorted(children.get(parent, ()))
        if not names:
            continue
        for d in _ff.companion_dirs(name, names, lambda r=rel: read_text(fs_of[r])):
            prefix = posixpath.join(parent, d) + "/"
            i = bisect.bisect_left(rels, prefix)
            while i < len(rels) and rels[i].startswith(prefix):
                owned.setdefault(rels[i], rel)
                i += 1
    return owned


# ── what a file is ──────────────────────────────────────────────────────────

_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"%PDF-", "application/pdf"),
    (b"wOFF", "font/woff"),
    (b"wOF2", "font/woff2"),
    (b"OTTO", "font/otf"),
    (b"\x00\x01\x00\x00", "font/ttf"),
    (b"\x00\x00\x01\x00", "image/vnd.microsoft.icon"),
    (b"BM", "image/bmp"),
)
_TEXT_SNIFF_BYTES = 2048
_SVG_RE = re.compile(rb"<svg\b", re.I)
_HTML_RE = re.compile(rb"^\s*(?:<!doctype html|<html|<head|<body)", re.I)


def sniff_mime(head):
    """What the first bytes of a file say it is, or None."""
    for magic, mime in _MAGIC:
        if head.startswith(magic):
            return mime
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[4:8] == b"ftyp" and head[8:12] in (b"avif", b"avis"):
        return "image/avif"
    if _SVG_RE.search(head[:_TEXT_SNIFF_BYTES]):
        return "image/svg+xml"
    if _HTML_RE.match(head):
        return "text/html"
    return None


def mime_for(zim_path, fs_path, hints=None):
    """The mimetype to serve a file as: its extension's, else what the page that
    uses it says it is (a stylesheet, a script), else what its bytes are, else
    octet-stream. Browsers are strict where it matters: a stylesheet served as
    anything but text/css is dropped, with the page otherwise fine."""
    mime = guess_mime(zim_path, fallback="")
    if mime:
        return mime
    hinted = (hints or {}).get(zim_path)
    if hinted:
        return hinted
    try:
        with open(fs_path, "rb") as f:
            head = f.read(_TEXT_SNIFF_BYTES)
    except OSError:
        head = b""
    return sniff_mime(head) or "application/octet-stream"


# ── reading a saved page ────────────────────────────────────────────────────


def _is_local(ref):
    ref = _html.unescape(ref).strip()
    return bool(ref) and not _NOT_LOCAL_RE.match(ref)


def _fix_percent(ref):
    """Firefox writes a bare ``%`` in a folder named for the page's title
    ("50% off_files/a.png" becomes ``50%%20off_files/a.png``). A browser
    forgives it; make it the valid ``%25`` so every reader, and the one place
    that decodes it, agree."""
    return _BARE_PERCENT_RE.sub("%25", ref)


def _target(page_rel, ref):
    """The path in the folder a relative reference names, as the server reads it."""
    path = urllib.parse.urlsplit(_html.unescape(ref).strip()).path
    return posixpath.normpath(
        posixpath.join(posixpath.dirname(page_rel), urllib.parse.unquote(path))
    )


def _valid_ref(ref, page_rel, have):
    """One local reference made valid: a bare ``%`` is ``%25``; and when the
    reference, read as the server will (decoded once), names no file but its
    literal text does (a browser kept ``%C3%A9`` in the file's own name), it is
    escaped so it reads back as that name."""
    fixed = _fix_percent(ref)
    if not have or _target(page_rel, fixed) in have:
        return fixed
    path, sep, tail = _html.unescape(ref).strip().partition("#")
    path, qsep, query = path.partition("?")
    literal = posixpath.normpath(posixpath.join(posixpath.dirname(page_rel), path))
    if literal not in have:
        return fixed
    here = posixpath.dirname(page_rel) or "."
    out = urllib.parse.quote(posixpath.relpath(literal, here), safe="/")
    return out + (qsep + query if qsep else "") + (sep + tail if sep else "")


def _tidy_urls(tag, page_rel, have):
    """One tag's references made valid (see ``_valid_ref``)."""

    def fix(m):
        value = m.group("val")
        if m.group("attr").lower() == "srcset":
            fixed = ", ".join(
                (_valid_ref(u, page_rel, have) if _is_local(u) else u) + (" " + d if d else "")
                for u, d in _split_srcset(_html.unescape(value))
                if u
            )
            fixed = _html.escape(fixed, quote=False) if fixed != value else value
        elif _is_local(value):
            fixed = _valid_ref(value, page_rel, have)
        else:
            return m.group(0)
        if fixed == value:
            return m.group(0)
        return m.group("pre") + '"' + attr_quote(fixed) + '"'

    return _URL_ATTR_RE.sub(fix, tag)


def _local_srcset(value):
    candidates = _split_srcset(_html.unescape(value))
    return bool(candidates) and all(_is_local(u) for u, _d in candidates)


def _only_the_web_srcset(value):
    """A srcset whose every candidate is an address on the web (or the site's
    own root): nothing in it the reader can show. A data: candidate is the
    picture itself, not an address."""
    candidates = _split_srcset(_html.unescape(value))
    return bool(candidates) and all(
        not _is_local(u) and not u.strip().lower().startswith(("data:", "#"))
        for u, _d in candidates
    )


def _keep_saved_copy(tag):
    """An ``<img>``/``<source>`` whose ``src`` is the saved copy but whose lazy
    attributes still name the live web: the page's script would set ``src``
    from them and the reader cannot reach the web. Point them at the copy."""
    src_m = _SRC_RE.search(tag)
    src = src_m.group("val") if src_m else ""
    srcset_m = _SRCSET_RE.search(tag)
    srcset = srcset_m.group("val") if srcset_m else ""
    own_src = src if _is_local(src) else ""
    own_set = srcset if srcset and _local_srcset(srcset) else ""

    def swap(names, value):
        nonlocal tag
        if not value:
            return
        for name in names:
            tag = attr_re(name).sub(
                lambda m: (
                    m.group("pre") + '"' + attr_quote(value) + '"'
                    if not _is_local(m.group("val"))
                    else m.group(0)
                ),
                tag,
            )

    swap(LAZY_SRC_ATTRS, own_src)
    swap(LAZY_SRCSET_ATTRS, own_set or own_src)
    # srcset wins over src in a browser: a live-web srcset beside a saved src
    # is a picture that shows online and vanishes in the reader.
    if own_src and srcset and _only_the_web_srcset(srcset):
        tag = _SRCSET_RE.sub("", tag, count=1)
    return tag


def _drop_remote_sources(block):
    """A ``<picture>`` whose ``<img>`` is the saved copy loses its ``<source>``
    elements that only name the live web."""
    img = re.search(r"<img\b[^>]*>", block, re.I)
    src_m = _SRC_RE.search(img.group(0)) if img else None
    if not src_m or not _is_local(src_m.group("val")):
        return block

    def drop(m):
        s = _SRCSET_RE.search(m.group(0))
        return "" if s and _only_the_web_srcset(s.group("val")) else m.group(0)

    return _SOURCE_TAG_RE.sub(drop, block)


def _use_hints(text, page_rel):
    """``{path: mimetype}`` for what this page loads as a stylesheet or a script."""
    hints = {}
    for tag in _LINK_TAG_RE.findall(text):
        rel = _REL_RE.search(tag)
        href = _HREF_RE.search(tag)
        if rel and href and "stylesheet" in rel.group("val").lower():
            if _is_local(href.group("val")):
                hints[_target(page_rel, href.group("val"))] = "text/css"
    for tag in _SCRIPT_SRC_TAG_RE.findall(text):
        src = _SRC_RE.search(tag)
        if src and _is_local(src.group("val")):
            hints[_target(page_rel, src.group("val"))] = "text/javascript"
    return hints


def prepare(text, page_rel, have=()):
    """A saved page ready for the ZIM: ``(text, hints)``. ``hints`` maps the
    paths this page loads as a stylesheet or script to their mimetype. ``have`` is
    the folder's paths, so a reference can be checked against what exists."""
    hints = _use_hints(text, page_rel)
    text = sub_markup(
        re.compile(
            r"<(?:img|source|link|script|iframe|video|audio|object|embed|a)\b[^>]*>",
            re.I,
        ),
        lambda m: _tidy_urls(m.group(0), page_rel, have),
        text,
    )
    text = sub_markup(_IMG_TAG_RE, lambda m: _keep_saved_copy(m.group(0)), text)
    text = sub_markup(_PICTURE_RE, lambda m: _drop_remote_sources(m.group(0)), text)
    return text, hints


# ── a page saved as one file ────────────────────────────────────────────────

_EXT_FOR = {
    "text/html": ".html",
    "text/css": ".css",
    "text/javascript": ".js",
    "application/javascript": ".js",
    "application/x-javascript": ".js",
    "application/json": ".json",
    "image/jpeg": ".jpg",
    "image/svg+xml": ".svg",
    "image/vnd.microsoft.icon": ".ico",
    "image/x-icon": ".ico",
    "font/woff2": ".woff2",
    "font/woff": ".woff",
}
_BAD_NAME_RE = re.compile(r'[\x00-\x1f/\\:*?"<>|]')
_MAX_NAME = 120
_CSS_URL_RE = re.compile(r"""url\(\s*(["']?)(?P<u>[^)"']+?)\1\s*\)""", re.I)
_CSS_IMPORT_RE = re.compile(r"""@import\s+(["'])(?P<u>[^"']+)\1""", re.I)
_STYLE_BLOCK_RE = re.compile(r"(?is)(<style\b[^>]*>)(.*?)(</style\s*>)")
_STYLE_ATTR_RE = attr_re("style")
_BASE_TAG_RE = re.compile(r"<base\b[^>]*>\s*", re.I)
_DOCTYPE_RE = re.compile(r"<!doctype[^>]*>", re.I)
_MEDIA_ATTR_RE = attr_re(
    "src",
    "poster",
    "data",
    "srcset",
    "data-src",
    "data-srcset",
    "data-original",
    "xlink:href",
)
_TAG_RE = re.compile(r"<[a-zA-Z][^>]*>")


class ArchiveError(ValueError):
    """A single-file page that cannot be read; the message says why."""


class _Part:
    __slots__ = ("url", "mime", "data", "charset", "cid", "rel")

    def __init__(self, url, mime, data, charset="", cid=""):
        self.url, self.mime, self.data, self.charset, self.cid = (
            url,
            mime,
            data,
            charset,
            cid,
        )
        self.rel = ""


def _decode(data, charset):
    for enc in (charset, "utf-8"):
        if enc:
            try:
                return data.decode(enc)
            except (LookupError, UnicodeDecodeError):
                continue
    return data.decode("latin-1")


def _clean_name(name):
    name = _BAD_NAME_RE.sub("_", name).strip(" .") or "resource"
    if len(name) > _MAX_NAME:
        stem, ext = posixpath.splitext(name)
        name = stem[: _MAX_NAME - len(ext)] + ext
    return name


def _part_name(part, taken):
    """A file name for a part, the way a browser would choose one: the last
    segment of its address, an extension from its type when it has none,
    ``_2`` for a clash."""
    path = urllib.parse.urlsplit(part.url).path if part.url else ""
    name = _clean_name(urllib.parse.unquote(posixpath.basename(path)))
    want = _EXT_FOR.get(part.mime) or mimetypes.guess_extension(part.mime or "") or ""
    if want and not guess_mime(name, ""):
        name += want
    stem, ext = posixpath.splitext(name)
    n, candidate = 1, name
    while candidate.lower() in taken:
        n += 1
        candidate = f"{stem}_{n}{ext}"
    taken.add(candidate.lower())
    return candidate


def _url_key(url):
    return urllib.parse.urldefrag(urllib.parse.unquote(_html.unescape(url).strip()))[0]


def _retarget_css(css, base, here, urlmap):
    """CSS whose ``url()`` and ``@import`` name a part now names its file,
    relative to the stylesheet's own place."""

    def to_file(ref):
        if ref.startswith("data:") or ref.startswith("#"):
            return None
        found = urlmap.get(_url_key(urllib.parse.urljoin(base, ref)))
        return (
            urllib.parse.quote(posixpath.relpath(found, posixpath.dirname(here) or "."))
            if found
            else None
        )

    def url_sub(m):
        new = to_file(m.group("u"))
        return f'url("{new}")' if new else m.group(0)

    def import_sub(m):
        new = to_file(m.group("u"))
        return f'@import "{new}"' if new else m.group(0)

    return _CSS_IMPORT_RE.sub(import_sub, _CSS_URL_RE.sub(url_sub, css))


def _retarget_html(text, base, here, urlmap):
    """A page's references to its parts now name the files; its links to other
    addresses are made absolute (so the saved-from keys can match them)."""
    base_m = re.search(r"<base\b[^>]*>", text, re.I)
    if base_m:
        href = _HREF_RE.search(base_m.group(0))
        if href:
            base = urllib.parse.urljoin(base, _html.unescape(href.group("val")))
        text = _BASE_TAG_RE.sub("", text)
    folder = posixpath.dirname(here) or "."

    def file_for(ref):
        ref = _html.unescape(ref).strip()
        if not ref or ref.startswith(("#", "data:", "javascript:", "mailto:")):
            return None
        found = urlmap.get(_url_key(urllib.parse.urljoin(base, ref)))
        return urllib.parse.quote(posixpath.relpath(found, folder)) if found else None

    def media(m):
        if m.group("attr").lower().endswith("srcset"):
            value = _html.unescape(m.group("val"))
            out = []
            for u, d in _split_srcset(value):
                out.append((file_for(u) or u) + (" " + d if d else ""))
            return (
                m.group("pre")
                + '"'
                + attr_quote(_html.escape(", ".join(out), quote=False))
                + '"'
            )
        new = file_for(m.group("val"))
        return m.group("pre") + '"' + attr_quote(new) + '"' if new else m.group(0)

    def link(m):
        tag = m.group(0)
        href = _HREF_RE.search(tag)
        new = file_for(href.group("val")) if href else None
        if new:
            return _HREF_RE.sub(
                lambda h: h.group("pre") + '"' + attr_quote(new) + '"', tag, count=1
            )
        return tag

    def anchor(m):
        tag = m.group(0)
        href = _HREF_RE.search(tag)
        if not href:
            return tag
        ref = _html.unescape(href.group("val")).strip()
        if not ref or ref.startswith(("#", "javascript:", "mailto:", "tel:", "data:")):
            return tag
        full = urllib.parse.urljoin(base, ref)
        return _HREF_RE.sub(
            lambda h: h.group("pre")
            + '"'
            + attr_quote(_html.escape(full, quote=False))
            + '"',
            tag,
            count=1,
        )

    def style_attr(m):
        return (
            m.group("pre")
            + '"'
            + attr_quote(
                _retarget_css(_html.unescape(m.group("val")), base, here, urlmap)
            )
            + '"'
        )

    text = sub_markup(
        re.compile(r"<(?!link\b|a\b)[a-zA-Z][^>]*>"),
        lambda m: _MEDIA_ATTR_RE.sub(media, m.group(0)),
        text,
    )
    text = sub_markup(_LINK_TAG_RE, link, text)
    text = sub_markup(re.compile(r"<a\b[^>]*>", re.I), anchor, text)
    text = sub_markup(
        _TAG_RE,
        lambda m: (
            _STYLE_ATTR_RE.sub(style_attr, m.group(0))
            if " style" in m.group(0).lower()
            else m.group(0)
        ),
        text,
    )
    text = _STYLE_BLOCK_RE.sub(
        lambda m: m.group(1)
        + _retarget_css(m.group(2), base, here, urlmap)
        + m.group(3),
        text,
    )
    return text


def _saved_from_comment(text, url):
    """The comment Chrome writes, so the page still says where it came from."""
    if not url or "saved from url=" in text[:4096]:
        return text
    note = f"<!-- saved from url=({len(url):04d}){url} -->\n"
    m = _DOCTYPE_RE.search(text[:4096])
    if m:
        return text[: m.end()] + "\n" + note + text[m.end() :]
    return note + text


def unpack(main, parts, stage, rel_dir, stem):
    """Write a single-file page as ``<stem>.html`` and ``<stem>_files/`` under
    ``stage``, in the layout a browser's "complete" save uses. ``main`` and
    ``parts`` are ``_Part``s. Returns ``[(fs_path, rel_path)]``, rel under ``rel_dir``.
    """
    files_dir = stem + _ff.FILES_SUFFIX
    taken = set()
    everything = [main] + [p for p in parts if p is not main]
    for part in everything[1:]:
        part.rel = posixpath.join(files_dir, _part_name(part, taken))
    main.rel = stem + ".html"
    urlmap = {}
    for part in everything:
        if part.url:
            urlmap.setdefault(_url_key(part.url), part.rel)
        if part.cid:
            urlmap.setdefault("cid:" + part.cid, part.rel)
    out = []
    for part in everything:
        data = part.data
        if part.mime in ("text/html", "application/xhtml+xml"):
            text = _retarget_html(
                _decode(data, part.charset), part.url, part.rel, urlmap
            )
            if part is main:
                text = _saved_from_comment(text, part.url)
            data = text.encode("utf-8")
        elif part.mime == "text/css":
            data = _retarget_css(
                _decode(data, part.charset), part.url, part.rel, urlmap
            ).encode("utf-8")
        fs = os.path.join(stage, *part.rel.split("/"))
        os.makedirs(os.path.dirname(fs), exist_ok=True)
        with open(fs, "wb") as f:
            f.write(data)
        out.append((fs, posixpath.join(rel_dir, part.rel) if rel_dir else part.rel))
    return out


def _read_mhtml(fs):
    with open(fs, "rb") as f:
        msg = email.message_from_binary_file(f, policy=email.policy.compat32)
    if not msg.is_multipart():
        raise ArchiveError("not a multipart MHTML page")
    top = msg.get("Snapshot-Content-Location", "") or ""
    parts, main = [], None
    for sub in msg.walk():
        if sub.is_multipart():
            continue
        data = sub.get_payload(decode=True)
        if data is None:
            continue
        mime = sub.get_content_type()
        url = (sub.get("Content-Location") or "").strip()
        cid = (sub.get("Content-ID") or "").strip().strip("<>")
        part = _Part(url, mime, data, sub.get_content_charset() or "", cid)
        parts.append(part)
        if (
            main is None
            and mime in ("text/html", "application/xhtml+xml")
            and (not top or url == top or url == "")
        ):
            main = part
    if main is None:
        main = next((p for p in parts if p.mime == "text/html"), None)
    if main is None:
        raise ArchiveError("no page inside")
    return main, [p for p in parts if p is not main]


def _web_resource(d, charset_key="WebResourceTextEncodingName"):
    return _Part(
        d.get("WebResourceURL", "") or "",
        (d.get("WebResourceMIMEType") or "application/octet-stream").lower(),
        bytes(d.get("WebResourceData") or b""),
        d.get(charset_key) or "",
    )


def _read_webarchive(fs):
    try:
        with open(fs, "rb") as f:
            top = plistlib.load(f)
    except Exception as e:  # plistlib raises several kinds
        raise ArchiveError(f"not a readable web archive: {type(e).__name__}") from e
    if not isinstance(top, dict) or "WebMainResource" not in top:
        raise ArchiveError("not a Safari web archive")
    main = _web_resource(top["WebMainResource"])
    parts = []

    def collect(archive):
        for sub in archive.get("WebSubresources") or ():
            parts.append(_web_resource(sub))
        for frame in archive.get("WebSubframeArchives") or ():
            if isinstance(frame, dict) and "WebMainResource" in frame:
                parts.append(_web_resource(frame["WebMainResource"]))
                collect(frame)

    collect(top)
    return main, parts


def read_archive(fs):
    """``(main, parts)`` of a ``.mhtml`` / ``.mht`` / ``.webarchive`` file."""
    if fs.lower().endswith(".webarchive"):
        return _read_webarchive(fs)
    return _read_mhtml(fs)


def expand(fs, rel, stage):
    """A single-file saved page as the files of a "complete" save, under
    ``stage``: ``[(fs_path, rel_path)]``. Raises ArchiveError for one that
    cannot be read. The page keeps the archive's folder and name."""
    main, parts = read_archive(fs)
    rel_dir, name = posixpath.split(rel)
    stem = posixpath.splitext(name)[0]
    sub = os.path.join(stage, *(rel_dir.split("/") if rel_dir else []))
    return unpack(main, parts, sub, rel_dir, stem)
