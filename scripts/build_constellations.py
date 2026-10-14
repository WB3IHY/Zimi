#!/usr/bin/env python3
"""Pack the 88 IAU constellations' figures into the sky's line file.

    curl -O https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json
    curl -O https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.json
    python3 scripts/build_constellations.py constellations.lines.json constellations.json

Writes zimi/static/earth/constellations-v1.json from d3-celestial (Olaf
Frohn, BSD 3-Clause; the lines follow the IAU's constellation pages, with
the author's modifications). Stellarium's data is GPL and is not used.

Format: {"v": 1, "c": [[id, name, genitive, ra, dec, [line, ...]], ...]}
where ra is hours-of-arc in degrees 0..360 and dec in degrees (two
decimals), the label's place; a line is a flat [ra, dec, ra, dec, ...] run
of J2000 positions the figure's stars stand at.
"""

import json
import os
import sys

OUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "zimi",
    "static",
    "earth",
    "constellations-v1.json",
)
FORMAT_VERSION = 1
DECIMALS = 2


def _ra360(lon):
    """d3-celestial writes right ascension as -180..180 degrees."""
    return round(lon % 360, DECIMALS)


def build(lines_path, names_path):
    with open(lines_path, encoding="utf-8") as f:
        lines = {
            x["id"]: x["geometry"]["coordinates"] for x in json.load(f)["features"]
        }
    with open(names_path, encoding="utf-8") as f:
        names = {x["id"]: x for x in json.load(f)["features"]}
    out = []
    for cid in sorted(names):
        feat = names[cid]
        props = feat["properties"]
        lon, lat = feat["geometry"]["coordinates"]
        figure = []
        for run in lines.get(cid, []):
            flat = []
            for lo, la in run:
                flat += [_ra360(lo), round(la, DECIMALS)]
            figure.append(flat)
        out.append(
            [cid, props["name"], props["gen"], _ra360(lon), round(lat, DECIMALS), figure]
        )
    return {"v": FORMAT_VERSION, "c": out}


def main(argv):
    if len(argv) != 3:
        sys.exit(__doc__)
    data = build(argv[1], argv[2])
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    print(
        "%d constellations, %d bytes -> %s"
        % (len(data["c"]), os.path.getsize(OUT_PATH), OUT_PATH)
    )


if __name__ == "__main__":
    main(sys.argv)
