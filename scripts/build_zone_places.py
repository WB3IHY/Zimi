#!/usr/bin/env python3
"""Rebuild the zone-to-place table in zimi/static/zone-places.js.

Every IANA zone gets the coordinates of its zone.tab city (public domain, the
tz database), and every link name (America/Buenos_Aires, Asia/Calcutta...) the
place of the zone it links to. The curated cities already in the file stay as
they are: they are the zone's best-known city, which is what a guessed sky
should stand over. Each entry is [latitude, longitude, ISO 3166 country], the country being
zone.tab's first column (the Field Guide reads it for the emergency number).
Zones with no place (Etc/UTC, UTC, GMT) get none, and the
sky then says it does not know the hemisphere instead of guessing one.

Run: python3 scripts/build_zone_places.py [zone.tab] [tzdata.zi]
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "zimi", "static", "zone-places.js")
BEGIN, END = "// <zone-places>\n", "// </zone-places>\n"
SKIP = re.compile(r"^(Etc/|posix|right|SystemV|US/|Canada/|Brazil/|Chile/|Mexico/)")


def iso6709(s):
    m = re.fullmatch(r"([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?", s)
    sign = lambda c: 1 if c == "+" else -1
    lat = sign(m[1]) * (int(m[2]) + int(m[3]) / 60 + int(m[4] or 0) / 3600)
    lon = sign(m[5]) * (int(m[6]) + int(m[7]) / 60 + int(m[8] or 0) / 3600)
    return round(lat, 2), round(lon, 2)


def main():
    tab = sys.argv[1] if len(sys.argv) > 1 else "/usr/share/zoneinfo/zone.tab"
    zi = sys.argv[2] if len(sys.argv) > 2 else "/usr/share/zoneinfo/tzdata.zi"
    places = {}
    for line in open(tab, encoding="utf-8"):
        if line.startswith("#") or not line.strip():
            continue
        cc, coord, name = line.split("\t")[:3]
        places[name.strip()] = (*iso6709(coord), cc)
    for line in open(zi, encoding="utf-8"):
        if line.startswith("L "):
            _, target, link = line.split()[:3]
            if target in places and link not in places and not SKIP.match(link):
                places[link] = places[target]
    src = open(TARGET, encoding="utf-8").read()
    a, b = src.index(BEGIN) + len(BEGIN), src.index(END)
    out = []
    for name in sorted(places):
        out.append("'%s':[%g,%g,'%s']" % (name, *places[name]))
    body = "var SKY_ZONE_GENERATED = {\n" + ",\n".join(
        ", ".join(out[i : i + 4]) for i in range(0, len(out), 4)
    ) + "\n};\n"
    open(TARGET, "w", encoding="utf-8").write(src[:a] + body + src[b:])
    print(len(places), "zones")


if __name__ == "__main__":
    main()
