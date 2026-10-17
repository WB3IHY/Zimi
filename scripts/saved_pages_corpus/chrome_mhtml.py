"""Real Google Chrome, Page.captureSnapshot (what 'Save as > Webpage, Single File' writes): chrome_mhtml.py OUT url name ..."""

import sys, os, time
from playwright.sync_api import sync_playwright

out = os.path.abspath(sys.argv[1])
pairs = list(zip(sys.argv[2::2], sys.argv[3::2]))
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    print(b.version)
    for url, name in pairs:
        try:
            pg = b.new_page(viewport={"width": 1280, "height": 900})
            pg.goto(url, wait_until="load", timeout=60000)
            pg.evaluate(
                "async()=>{for(let y=0;y<document.body.scrollHeight;y+=400){scrollTo(0,y);await new Promise(r=>setTimeout(r,200))}scrollTo(0,0);await new Promise(r=>setTimeout(r,2500))}"
            )
            title = pg.title()
            cdp = pg.context.new_cdp_session(pg)
            snap = cdp.send("Page.captureSnapshot", {"format": "mhtml"})["data"]
            d = os.path.join(out, "chrome-mhtml", name)
            os.makedirs(d, exist_ok=True)
            open(
                os.path.join(d, title.replace("/", "_") + ".mhtml"),
                "w",
                encoding="utf-8",
                newline="",
            ).write(snap)
            print("saved", name, repr(title), len(snap))
            pg.close()
        except Exception as e:
            print("FAIL", name, e)
    b.close()
