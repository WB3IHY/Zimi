# Saved web pages

Pages saved from a browser go into a ZIM through Create, Folder (`zimi create <folder>`). This is what each browser writes, what Zimi does with it, and where it stops.

Measured against real saves: Firefox 147 (its own Save Page As code path, driven over Marionette), Chrome 155 (`Page.captureSnapshot`, the engine behind "Single File"), SingleFile 2.2 (CLI). Chrome's "Webpage, Complete" and Safari's "Web Archive" could not be driven without taking over a desktop; those two are reproduced from the real Chrome snapshot's parts in the layout their browsers use, and are marked below. The tests use the real saves (`tests/fixtures/saved_pages.zip`).

## How it works

### What each export is

| Export | Written as | Zimi |
| --- | --- | --- |
| Firefox "Web Page, complete" | `Title.html` beside `Title_files/` | page, parts belong to it |
| Chrome / Edge "Webpage, Complete" | same layout (reproduced, see below) | same |
| Firefox "Web Page, HTML only", Chrome "HTML Only", Safari "Page Source" | the bytes the site sent, still pointing at the web | a page; its pictures are not in it |
| Firefox "Text" | plain text of the page | a text page |
| Chrome "Single File" | `.mhtml`, one MIME multipart | unpacked into the layout above |
| Safari "Web Archive" | `.webarchive`, a binary plist (reproduced) | unpacked into the layout above |
| SingleFile (extension or CLI) | one `.html`, parts as `data:` URIs | a page, nothing to unpack |

### Firefox "Web Page, complete", measured

- The folder is `<page name>_files`. Current Firefox never translates the suffix; older ones and other browsers in other languages wrote `Seite_Dateien`, `Page_fichiers`. Zimi takes any sibling folder that starts with the page's name and is named by the page.
- The page name is the document title, so it can hold spaces, parentheses, `&`, quotes, `?`, `%` and non-ASCII (`Café (50% off) – naïve & "more"?.html`).
- A part is named by the last segment of its address, query dropped; an extension is added from its type when it has none (`/img/noext` became `noext.jpg`, `/css/style` became `style.css`, `pic.php?id=3` became `pic.jpg`); a clash gets `_002`, `_003`; `%` in a name becomes `_` (`100%.png` became `100_.png`); spaces, parentheses and non-ASCII stay. A type Firefox cannot place leaves the name bare (`js`, `rum`, seen on news and blog pages); `saved_resource` is what it names a part with no usable name at all (reported by users; not in this corpus).
- Wikimedia pictures saved as `Flag_of_India.svg.webp`: the extension of the type is appended to the original name.
- An iframe is saved as `<frame name>.html` inside `_files`, its own parts in `<frame name>_data/`. A `srcdoc` frame becomes `a.html` and `a_data/`.
- References in the HTML are relative with no `./`, percent-encoded, with one exception: a literal `%` in the folder name is written bare, so a title with `50% off` makes `50%%20off_files/`. Markup is entity-escaped (`&amp;`). Firefox rewrites `src`, `srcset` and `<source>` for what it saved, and drops `<base>`.
- A name can also contain percent escapes literally (a file named `%C4%90...jpg`), so a reference and a file name can disagree about what the `%` means.
- Not rewritten: `data-src` and the other lazy-load attributes, a stylesheet's own `url()` and `@import` (the CSS file is saved as it came, its backgrounds are not), inline `style="background:url(...)"`, `<video poster>`, `<link rel=icon>`. A picture the browser had not loaded when you saved is not saved at all, and its reference stays an address on the web.
- Scripts are saved and run again when the page is opened.

### Chrome

- "Single File" is `Page.captureSnapshot`: MHTML written by Blink, `From: <Saved by Blink>`, the page's address in `Snapshot-Content-Location`, the title in an encoded `Subject`. Each part has a `Content-Location` (its absolute address as the server wrote it) and, for a frame, `Content-ID: <frame-HEX@mhtml.blink>`. Text is quoted-printable, pictures base64. The HTML is left pointing at absolute addresses; the parts carry the rest, including pictures named only in CSS and in `style` attributes (which Firefox does not keep). Frames are referenced by `cid:`.
- "Webpage, Complete" uses the same `Title.html` and `Title_files/`, an `<!-- saved from url=(NNNN)... -->` comment first, references written `./Title_files/name`, and a clash named `name (1).ext`. Reproduced here, not captured from Chrome.

### Safari

"Web Archive" is a binary property list: `WebMainResource` (`WebResourceData`, `WebResourceURL`, `WebResourceMIMEType`, `WebResourceTextEncodingName`), `WebSubresources` (the same keys, plus an archived response), and `WebSubframeArchives` (each a nested archive). The page's HTML is unchanged; its parts are found by `WebResourceURL`. Reproduced, not captured from Safari.

### What Zimi does

- **The parts belong to the page.** A saved page's `_files` folder is carried but not a gallery, not an index row, not a search hit; a frame saved as HTML in it is not an article. A page picked alone in the tree takes its folder with it.
- **Titles** are the page's `<title>`. The index lists a saved page with the site it came from (Chrome's comment, SingleFile's, `canonical`, `og:url`) and links to it with an encoded address.
- **Mimetypes.** A part with no extension is served as the type the page loads it as (a stylesheet, a script), else what its bytes are (PNG, JPEG, GIF, WebP, AVIF, SVG, fonts, ICO, PDF). A browser drops a stylesheet that is not `text/css`.
- **References.** A bare `%` is made `%25`. A reference that reads back as another name (the literal-escapes case) is escaped so it finds its file.
- **Lazy pictures.** A page's script that sets `src` from `data-src` (and `data-original`, `data-lazy-src`, `data-srcset` and their kin) would replace the saved picture with the web address, which the reader's content policy blocks. When `src` is the saved copy, those attributes now point at it. A `srcset` or `<picture>` source that names only the web, beside a saved `src`, is dropped; a `data:` source stays.
- **Single-file pages.** `.mhtml`, `.mht` and `.webarchive` are unpacked into `Title.html` and `Title_files/` with every reference retargeted (HTML, `srcset`, `style`, stylesheets' `url()` and `@import`), `<base>` folded in, links to other addresses made absolute so saved pages link to each other, and the "saved from" comment added. An unreadable one is left out with the reason in the log.
- **A note** in the build log names a page that still has pictures pointing at the web: the browser did not save them, so they will not show.

## Configure

Nothing to set. Put the saved pages (any mix of `Title.html` with its `Title_files/`, `.mhtml`, `.mht`, `.webarchive` and SingleFile `.html`) in one folder and choose Create, Folder, or run `zimi create <folder>`. Picking a single page in the folder tree takes its `_files` folder with it.

### Regenerating the test fixtures

`scripts/saved_pages_corpus/` holds what made them: `testsite.py` serves the test page, `ffsave.py` saves it through Firefox (Marionette), `chrome_mhtml.py` through Chrome, `sf.py` through the SingleFile CLI, `synth.py` writes the two reproduced formats, `mkfixture.py` packs the zip. Each takes real pages the same way.

## Troubleshoot

- **A picture is missing.** The browser did not save it (the build log names such pages). Scroll the page to the end, wait for it, then save again.
- **Backgrounds are missing from a Firefox save.** Firefox does not keep CSS backgrounds; Chrome's Single File does.
- **A picture flips back to a web address.** A page whose script builds an address of its own at run time can still replace a saved picture; the data-attribute rule covers the usual libraries.
- **A page looks empty.** Scripts run in the ZIM as they did in the save, so a page that depends on its server shows what it shows offline.
