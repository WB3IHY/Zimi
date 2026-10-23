"""#119: no text at the colour of its own background, in Red or in Dark.

Red turns a page to red light with one CSS filter (--red-picture). It has to keep every grey in its
place between black and full red: the chain before sent every grey from 30% up to full red, so a
dark grey page and its white text were one red (foss.cooking). A page's own dark mode turns its
text light but cannot reach a colour written on an element (the LGBTQIA+ Wiki's boxes, style=
"background-color:#FEC2DC"): those boxes go dark with the page and come back with the light face.

Run: pytest tests/test_red_contrast_browser.py -v
"""

import io
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import zimi.renderer as renderer  # noqa: E402

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "zimi", "static")
STEP_MIN = 15  # each 10% of grey stays this much redder than the one below (of 255)


def _read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


def _red_pictures():
    """Every --red-picture chain: the shell's and the apps' stylesheets."""
    return [re.search(r"--red-picture:\s*([^;]+);", _read(n)).group(1) for n in ("app.css", "apps.css")]


def _fn(src, name):
    m = re.search(r"function " + name + r"\([^)]*\) \{[\s\S]*?\n\}", src)
    assert m, name
    return m.group(0)


@pytest.fixture(scope="module")
def page():
    if not renderer.browser_available():
        pytest.skip("playwright + chromium are not usable here")
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b.new_page(viewport={"width": 220, "height": 20})
        b.close()


def test_red_keeps_every_grey_in_its_place(page):
    Image = pytest.importorskip("PIL.Image")  # optional in pyproject; CI's test job may not have it

    levels = [i / 10 for i in range(11)]
    for chain in _red_pictures():
        cells = "".join(
            '<i style="display:inline-block;width:20px;height:20px;background:rgb(%d,%d,%d)"></i>' % ((round(v * 255),) * 3)
            for v in levels
        )
        page.set_content('<body style="margin:0;line-height:0;filter:%s">%s</body>' % (chain, cells))
        im = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
        reds = [im.getpixel((i * 20 + 10, 10)) for i in range(len(levels))]
        assert reds[0] == (0, 0, 0), chain
        assert reds[-1][0] >= 240, ("white is full red", chain, reds[-1])
        for lo, hi in zip(reds[:-2], reds[1:-1]):  # the top step may meet the ceiling
            assert hi[0] - lo[0] >= STEP_MIN, ("a grey step was lost", chain, reds)
        assert all(g < 40 and b < 10 for _r, g, b in reds), ("red light only", reds)


def test_a_light_box_goes_dark_with_the_page_and_comes_back(page):
    src = _read("app.js")
    consts = re.search(r"var _DARK_BG_MAX_LUM = [^\n]*", src).group(0) + "\n" + re.search(r"var _ISLAND_DARK_L = [^;]*;", src).group(0)
    fns = "\n".join(_fn(src, n) for n in ("_cssColorLum", "_cssColorWithLightness", "_darkenLightIslands", "_restoreLightIslands"))
    page.set_viewport_size({"width": 390, "height": 400})
    page.set_content(
        '<body style="background:#101418;color:#eaecf0">'
        '<div id="box" style="padding:10px; background-color:#FEC2DC">Welcome to the wiki</div>'
        '<div id="ok" style="background-color:#202122">Already dark</div>'
        '<div id="pic" style="background-image:linear-gradient(red,blue)">A picture</div></body>'
    )
    page.add_script_tag(content=consts + "\n" + fns)
    lum = "id => _cssColorLum(getComputedStyle(document.getElementById(id)).backgroundColor).lum"
    assert page.evaluate(lum, "box") > 0.6
    page.evaluate("_darkenLightIslands(document)")
    assert page.evaluate(lum, "box") < 0.25, "light text now reads on it"
    hue = page.evaluate("getComputedStyle(document.getElementById('box')).backgroundColor")
    r, g, b = map(int, re.findall(r"\d+", hue)[:3])
    assert r > b > g, ("still the box's pink, darkened", hue)
    assert page.evaluate("getComputedStyle(document.getElementById('ok')).backgroundColor") == "rgb(32, 33, 34)"
    assert page.evaluate("document.getElementById('pic').dataset.zimiBg") is None
    page.evaluate("_restoreLightIslands(document)")
    assert page.evaluate("getComputedStyle(document.getElementById('box')).backgroundColor") == "rgb(254, 194, 220)"
    assert page.evaluate("document.getElementById('box').dataset.zimiBg") is None
