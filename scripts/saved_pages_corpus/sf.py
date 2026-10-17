"""SingleFile CLI saves: sf.py OUT name url ..."""

import sys, os, subprocess

out = os.path.abspath(sys.argv[1])
CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for name, url in zip(sys.argv[2::2], sys.argv[3::2]):
    d = os.path.join(out, "singlefile", name)
    os.makedirs(d, exist_ok=True)
    r = subprocess.run(
        [
            "single-file",
            url,
            os.path.join(d, name + ".html"),
            f"--browser-executable-path={CH}",
            "--browser-wait-until=networkidle0",
        ],
        capture_output=True,
        text=True,
        timeout=180,
    )
    print(name, r.returncode, (r.stderr or r.stdout)[-200:])
