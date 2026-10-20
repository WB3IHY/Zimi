"""Drive real Firefox over Marionette and save pages the way File > Save Page As does
(contentAreaUtils internalPersist -> nsIWebBrowserPersist). Usage: ffsave.py OUTDIR url name [url name ...]
"""

import json, socket, subprocess, sys, time, os, shutil, tempfile

FF = "/Applications/Firefox.app/Contents/MacOS/firefox"


class M:
    def __init__(s, port=2828):
        for _ in range(60):
            try:
                s.sock = socket.create_connection(("127.0.0.1", port))
                break
            except OSError:
                time.sleep(0.5)
        s.id = 0
        s.buf = b""
        s.read()

    def read(s):
        while b":" not in s.buf:
            s.buf += s.sock.recv(65536)
        n, rest = s.buf.split(b":", 1)
        n = int(n)
        while len(rest) < n:
            rest += s.sock.recv(65536)
        s.buf = rest[n:]
        return json.loads(rest[:n])

    def cmd(s, name, params=None):
        s.id += 1
        b = json.dumps([0, s.id, name, params or {}]).encode()
        s.sock.sendall(str(len(b)).encode() + b":" + b)
        while True:
            m = s.read()
            if m[1] == s.id:
                if m[2]:
                    raise RuntimeError(m[2])
                return m[3]

    def js(s, script, args=None):
        return s.cmd("WebDriver:ExecuteScript", {"script": script, "args": args or []})[
            "value"
        ]

    def jsasync(s, script, args=None):
        return s.cmd(
            "WebDriver:ExecuteAsyncScript", {"script": script, "args": args or []}
        )["value"]


SCROLL = """const done=arguments[arguments.length-1];(async()=>{for(let y=0;y<document.body.scrollHeight;y+=400){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,200));}window.scrollTo(0,0);await new Promise(r=>setTimeout(r,2500));done(document.title)})()"""

PERSIST = """
const [style,path]=arguments;
const br=window.gBrowser.selectedBrowser;
const f=Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile); f.initWithPath(path);
br.frameLoader.startPersistence(null,{onDocumentReady(doc){
 const uri=Services.io.newURI(doc.documentURI);
 window.internalPersist({sourceURI:uri,sourceOriginalURI:null,sourcePrincipal:doc.principal,sourceReferrerInfo:doc.referrerInfo,
  sourceDocument: style=="html"?null:doc, targetContentType: style=="text"?"text/plain":null,
  targetFile:f, sourceCacheKey:doc.cacheKey, sourcePostData:null, bypassCache:false,
  contentPolicyType:Ci.nsIContentPolicy.TYPE_SAVEAS_DOWNLOAD, cookieJarSettings:doc.cookieJarSettings, isPrivate:false});
 },onError(st){}});
return String(br.contentTitle);
"""


def stable(d, quiet=8, cap=120):
    last, t0, still = None, time.time(), time.time()
    while time.time() - t0 < cap:
        cur = sorted((os.path.join(r, f), os.path.getsize(os.path.join(r, f))) for r, _, fs in os.walk(d) for f in fs)
        if cur != last:
            last, still = cur, time.time()
        elif time.time() - still > quiet:
            return
        time.sleep(1)


def main():
    out = os.path.abspath(sys.argv[1])
    pairs = list(zip(sys.argv[2::2], sys.argv[3::2]))
    prof = tempfile.mkdtemp(prefix="ffprof")
    open(os.path.join(prof, "user.js"), "w").write(
        'user_pref("browser.shell.checkDefaultBrowser",false);user_pref("datareporting.policy.dataSubmissionEnabled",false);'
        'user_pref("browser.tabs.remote.autostart",false);user_pref("fission.autostart",false);'
        'user_pref("marionette.port",2828);user_pref("browser.startup.homepage_override.mstone","ignore");'
    )
    p = subprocess.Popen(
        [
            FF,
            "--headless",
            "--marionette", "-remote-allow-system-access",
            "--profile",
            prof,
            "--no-remote",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        m = M()
        m.cmd("WebDriver:NewSession", {"capabilities": {}})
        m.cmd("WebDriver:SetWindowRect", {"width": 1280, "height": 900})
        for url, name in pairs:
            try:
                m.cmd("Marionette:SetContext", {"value": "content"})
                m.cmd("WebDriver:Navigate", {"url": url})
                title = m.jsasync(SCROLL)
                m.cmd("Marionette:SetContext", {"value": "chrome"})
                for style in ("complete", "html", "text"):
                    d = os.path.join(out, "firefox-" + style, name)
                    shutil.rmtree(d, ignore_errors=True)
                    os.makedirs(d)
                    ext = ".txt" if style == "text" else ".html"
                    path = os.path.join(d, title.replace("/", "_") + ext)
                    r = m.js(PERSIST, [style, path])
                print("saved", name, repr(title), r)
                stable(os.path.join(out, 'firefox-complete', name))
            except Exception as e:
                print("FAIL", name, e)
    finally:
        p.terminate()
        shutil.rmtree(prof, ignore_errors=True)


main()
