#!/usr/bin/env python3
"""Draws the card index alphabet (A 2-10 J Q K, and 11 and 12 for the Spanish deck and Hanafuda's months) as filled outlines.

Each glyph is built from centre-lines swept by a flat or oval pen (stems heavy, hairlines light, like a Clarendon-cut
printed index), plus slab serifs and ball terminals, then merged into one outline. Grid: cap height 14, y down, x from 0 at
the glyph's ink. Needs shapely (a dev tool only; the game ships the generated paths).

    python3 scripts/cardglyphs.py            # print the JS table
    python3 scripts/cardglyphs.py --write    # replace the block between the glyphs:begin/end markers in cards.js
"""
import math, re, sys, os
from shapely.geometry import Polygon, Point, box, MultiPolygon
from shapely.ops import unary_union
from shapely import affinity

STEM, HAIR, SLAB, BALL = 2.5, 1.3, 1.25, 1.5   # heavy stroke, hairline, serif thickness, terminal ball radius
CAP = 14.0
STEP = 0.12

def ell(w, h, n=24):
    return Polygon([(w / 2 * math.cos(2 * math.pi * i / n), h / 2 * math.sin(2 * math.pi * i / n)) for i in range(n)])

def sweep(pts, pen):
    """The area a pen covers moving along a polyline."""
    parts = []
    for a, b in zip(pts, pts[1:]):
        parts.append(unary_union([affinity.translate(pen, *a), affinity.translate(pen, *b)]).convex_hull)
    return unary_union(parts)

def dense(pts):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / STEP))
        out += [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(1, n + 1)]
    return out

def arc(cx, cy, rx, ry, a0, a1):
    n = max(4, int(abs(a1 - a0) / 4))
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]

def bez(p0, p1, p2, p3, n=30):
    return [tuple((1 - t) ** 3 * p0[k] + 3 * (1 - t) ** 2 * t * p1[k] + 3 * (1 - t) * t * t * p2[k] + t ** 3 * p3[k] for k in (0, 1)) for t in [i / n for i in range(n + 1)]]

def stroke(pts, w, h):
    return sweep(dense(pts), ell(w, h))

def rect(x0, y0, x1, y1): return box(x0, y0, x1, y1)
def ball(x, y, r=BALL): return Point(x, y).buffer(r, 16)
def quad(*p): return Polygon(p)
def stem(x, y0, y1, w=STEM): return rect(x - w / 2, y0, x + w / 2, y1)
def slab(cx, y, w, t=SLAB, up=False): return rect(cx - w / 2, y - t if up else y, cx + w / 2, y if up else y + t)
def U(*s): return unary_union(s)

# Foot and cap serifs: a slab with a small fillet where it meets the stem.
def footed(x, y, w, up=False):
    t = SLAB
    return U(slab(x, y, w, t, up))

def one(foot=2.9, flag=2.0):
    x = flag + STEM / 2 + 0.2
    flagp = quad((x + STEM / 2, 0), (x - STEM / 2 + 0.05, 0), (x - STEM / 2 - flag, 2.45), (x - STEM / 2 - flag, 3.95), (x - STEM / 2 + 0.1, 2.35))
    return U(stem(x, 0, CAP), flagp, slab(x, CAP, foot, SLAB, up=True))

def zero(w, stem_w=2.3):
    rx = (w - stem_w) / 2
    return stroke(arc(w / 2, 7, rx, 7 - HAIR / 2, 0, 360), stem_w, HAIR)

def ends(pts): return pts[0], pts[-1]

def two(w=9.0):
    f = w / 9.0
    sx = lambda pts: [(x * f, y) for x, y in pts]
    top = sx(arc(4.5, 3.75, 3.35, 3.1, 195, 360) + arc(4.5, 3.75, 3.35, 3.1, 0, 38)[1:])
    diag = sx(bez((4.5 + 3.35 * math.cos(math.radians(38)), 3.75 + 3.1 * math.sin(math.radians(38))), (5.9, 7.1), (3.4, 9.6), (1.0, 13.0)))
    return U(stroke(top, STEM * 0.92, HAIR), stroke(diag, STEM * 0.9, HAIR * 1.25), ball(top[0][0] + 0.15, top[0][1] + 0.3, BALL - 0.15), rect(0.6 * f, CAP - SLAB - 0.1, w, CAP))

def three():
    upper = arc(4.5, 3.45, 3.0, 2.8, 200, 360) + arc(4.5, 3.45, 3.0, 2.8, 0, 78)[1:]
    lower = arc(4.6, 10.2, 3.75, 3.15, 262, 360) + arc(4.6, 10.2, 3.75, 3.15, 0, 165)[1:]
    return U(stroke(upper, STEM * 0.9, HAIR), stroke(lower, STEM, HAIR), stroke([upper[-1], lower[0]], HAIR * 1.4, HAIR),
             ball(upper[0][0] + 0.1, upper[0][1] + 0.3, BALL - 0.15), ball(lower[-1][0] + 0.15, lower[-1][1] - 0.3, BALL - 0.15))

def four():
    xs = 7.3
    diag = quad((xs - 1.2, -0.5), (xs + 0.2, -0.5), (1.3, 10.6), (-0.3, 10.6))
    return U(stem(xs, -0.5, CAP), diag, rect(-0.3, 9.2, 10.5, 10.55), slab(xs, CAP, 5.0, SLAB, up=True))

def five():
    bowl = arc(4.85, 9.5, 3.7, 3.85, 252, 360) + arc(4.85, 9.5, 3.7, 3.85, 0, 150)[1:]
    return U(stroke(bowl, STEM, HAIR), stem(2.35, 0.0, 7.0, STEM * 0.9), rect(1.2, 0, 8.6, 1.55), rect(7.9, 0, 8.6, 2.6), stroke([(2.35, 6.6), bowl[0]], STEM * 0.7, HAIR * 1.3),
             ball(bowl[-1][0] + 0.15, bowl[-1][1] - 0.3, BALL - 0.15))

def six():
    bowl = arc(5.0, 9.5, 3.7, 3.85 - 0.0, 0, 360)
    up = bez((1.55, 9.0), (1.0, 4.4), (3.2, 1.2), (7.0, 0.65))
    return U(stroke(bowl, STEM, HAIR), stroke(up, STEM * 0.95, HAIR), ball(7.15, 1.55, BALL - 0.15))

def nine(): return affinity.rotate(six(), 180, origin=(5.1, 7))

def seven():
    diag = quad((9.2, 0.9), (9.5, 0), (4.9, 14), (2.4, 14))
    return U(rect(0.0, 0, 9.5, 1.65), rect(0.0, 0, 1.55, 3.6), diag, slab(3.65, CAP, 4.4, SLAB, up=True))

def eight():
    up = arc(5, 3.5, 2.95, 2.85, 0, 360)
    lo = arc(5, 10.25, 3.75, 3.1, 0, 360)
    return U(stroke(up, STEM * 0.9, HAIR), stroke(lo, STEM, HAIR))

def ace():
    L = quad((4.4, -0.55), (6.0, -0.55), (1.9, CAP), (0.2, CAP))
    R = quad((4.9, -0.55), (7.7, -0.55), (10.6, CAP), (7.9, CAP))
    return U(L, R, rect(2.4, 9.35, 8.8, 10.6), slab(1.0, CAP, 3.0, SLAB, up=True), slab(9.4, CAP, 3.6, SLAB, up=True))

def jack():
    xs = 6.9
    hook = arc(4.4, 10.5, xs - 4.4, 2.85, 0, 160)
    return U(stem(xs, 0, 10.5), stroke(hook, STEM, HAIR), ball(hook[-1][0] + 0.1, hook[-1][1] - 0.3, BALL - 0.15), slab(xs, 0, 6.2), rect(xs - 3.1, 0, xs - 3.1 + 1.5, 3.0))

def queen():
    q = stroke(arc(5, 7, 3.9, 7 - HAIR / 2, 0, 360), STEM, HAIR)
    tail = stroke(bez((5.2, 11.4), (7.3, 12.0), (8.2, 14.3), (10.4, 15.1)), STEM * 0.75, HAIR * 1.1)
    return U(q, tail)

def king():
    s = 1.35
    arm = quad((2.4, 7.8), (7.2, 0), (8.9, 0), (4.1, 8.4))
    leg = quad((3.7, 7.6), (6.4, 6.8), (10.0, CAP), (7.0, CAP))
    return U(stem(s, 0, CAP, STEM), arm, leg, slab(s, 0, 5.0), slab(s, CAP, 5.0, SLAB, up=True),
             rect(6.0, 0, 10.0, SLAB), slab(8.6, CAP, 4.0, SLAB, up=True))

def pair(a, b, gap):
    ax0, _, ax1, _ = a.bounds
    a = affinity.translate(a, -ax0)
    bx0, _, bx1, _ = b.bounds
    return U(a, affinity.translate(b, a.bounds[2] + gap - bx0))

GAP2 = 2.25   # clear paper between the digits of a two-digit rank: one stem plus a hair

def glyph_set():
    ten = pair(one(), zero(6.5), GAP2)
    return {
        'A': ace(), '1': one(4.6, 2.6), '2': two(), '3': three(), '4': four(), '5': five(), '6': six(), '7': seven(), '8': eight(), '9': nine(),
        '10': ten, 'J': jack(), 'Q': queen(), 'K': king(),
        '11': pair(one(), one(), GAP2),
        '12': pair(one(), two(6.2), GAP2),
    }

def path_d(g):
    g = g.simplify(0.015)
    polys = list(g.geoms) if isinstance(g, MultiPolygon) else [g]
    d = ''
    for p in polys:
        for ring in [p.exterior] + list(p.interiors):
            c = list(ring.coords)[:-1]
            d += 'M' + ' '.join('%s %s' % (fmt(x), fmt(y)) for x, y in c) + 'z'
    return d

def fmt(v):
    s = ('%.2f' % v).rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s

def table():
    out = []
    for k, g in glyph_set().items():
        x0, y0, x1, y1 = g.bounds
        g = affinity.translate(g, -x0, 0)
        out.append((k, round(x1 - x0, 2), g, (y0, y1)))
    return out

if __name__ == '__main__':
    rows = table()
    lines = ["    %s: { d: '%s', w: %s }" % ("'%s'" % k if k[0].isdigit() else k, path_d(g), w) for k, w, g, _ in rows]
    js = '  var GLYPHS = {\n' + ',\n'.join(lines) + '\n  };'
    if '--write' in sys.argv:
        p = os.path.join(os.path.dirname(__file__), '..', 'zimi', 'builtin', 'games', 'cards.js')
        s = open(p).read()
        s = re.sub(r'(// glyphs:begin[^\n]*\n).*?(  // glyphs:end)', lambda m: m.group(1) + js + '\n' + m.group(2), s, flags=re.S)
        open(p, 'w').write(s)
    else:
        print(js)
    for k, w, g, (y0, y1) in rows: sys.stderr.write('%s w=%s y=%.2f..%.2f\n' % (k, w, y0, y1))
