#!/usr/bin/env python3
"""Pack the Yale Bright Star Catalogue into the Almanac's 3D star sky.

    curl -O http://tdc-www.harvard.edu/catalogs/bsc5.dat.gz
    python3 scripts/build_star_catalog.py bsc5.dat.gz

Writes zimi/static/earth/stars-v1.bin from the Bright Star Catalogue, 5th
revised edition (Hoffleit and Warren, 1991; public domain; VizieR V/50). The
catalogue is fixed-width text, one star per line; the columns read here are
J2000 right ascension (76-83), J2000 declination (84-90), visual magnitude
(103-107) and the B-V colour index (110-114). Lines with no position (the
catalogue's novae and non-stellar objects, 14 of 9,110) are left out.
The stars are written brightest first, so a truncated read is still a sky.

File format (little endian; zimi/static/almanac-earth.js _aeDecodeStars reads
it, and must change with this):

    offset 0           uint16  N, the number of stars
    offset 2           uint16  FORMAT_VERSION (1)
    offset 4           uint16  x N   right ascension, 0..65535 = 0 .. 24 h
                                     (step 0.0055 degrees)
    offset 4 + 2N      uint16  x N   declination, 0..65535 = -90 .. +90 degrees
                                     (step 0.0027 degrees)
    offset 4 + 4N      uint8   x N   magnitude: (V + 2) * 25   (step 0.04)
    offset 4 + 5N      int8    x N   colour: (B-V) * 50   (step 0.02);
                                     -128 where the catalogue has no B-V

Planar, so every array is one typed-array view over the buffer. About 6 bytes
a star, 55 KB in all.
"""

import gzip
import json
import os
import struct
import sys

OUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "zimi",
    "static",
    "earth",
    "stars-v1.bin",
)
FORMAT_VERSION = 1
NAMES_PATH = os.path.join(os.path.dirname(OUT_PATH), "stars-names-v1.json")
U16_STEPS = 65536
U16_MAX = U16_STEPS - 1
RA_HOURS = 24.0
DEC_SPAN_DEG = 180.0
MAG_OFFSET = 2.0
MAG_SCALE = 25
MAG_MAX_CODE = 255
BV_SCALE = 50
BV_NONE = -128
BV_CODE_MIN, BV_CODE_MAX = -127, 127

# 0-based slices of the catalogue's fixed-width line.
COL_RA_H, COL_RA_M, COL_RA_S = slice(75, 77), slice(77, 79), slice(79, 83)
COL_DEC_SIGN, COL_DEC_D, COL_DEC_M, COL_DEC_S = (
    83,
    slice(84, 86),
    slice(86, 88),
    slice(88, 90),
)
COL_VMAG, COL_BV = slice(102, 107), slice(109, 114)


def parse_line(line):
    """(ra hours, dec degrees, V, B-V or None) for one catalogue line, or None
    when the entry has no position or no magnitude."""
    try:
        ra = (
            int(line[COL_RA_H])
            + int(line[COL_RA_M]) / 60.0
            + float(line[COL_RA_S]) / 3600.0
        )
        dec = (
            int(line[COL_DEC_D])
            + int(line[COL_DEC_M]) / 60.0
            + int(line[COL_DEC_S]) / 3600.0
        )
        if line[COL_DEC_SIGN] == "-":
            dec = -dec
        vmag = float(line[COL_VMAG])
    except (ValueError, IndexError):
        return None
    try:
        bv = float(line[COL_BV])
    except ValueError:
        bv = None
    return ra, dec, vmag, bv


def pack(stars):
    """stars: (ra hours, dec degrees, V, B-V or None) -> the file's bytes."""
    stars = sorted(stars, key=lambda s: s[2])
    n = len(stars)
    ra = [min(U16_MAX, round(s[0] / RA_HOURS * U16_STEPS) % U16_STEPS) for s in stars]
    dec = [round((s[1] + DEC_SPAN_DEG / 2) / DEC_SPAN_DEG * U16_MAX) for s in stars]
    mag = [
        max(0, min(MAG_MAX_CODE, round((s[2] + MAG_OFFSET) * MAG_SCALE))) for s in stars
    ]
    bv = [
        (
            BV_NONE
            if s[3] is None
            else max(BV_CODE_MIN, min(BV_CODE_MAX, round(s[3] * BV_SCALE)))
        )
        for s in stars
    ]
    return (
        struct.pack("<HH", n, FORMAT_VERSION)
        + struct.pack("<%dH" % n, *ra)
        + struct.pack("<%dH" % n, *dec)
        + struct.pack("<%dB" % n, *mag)
        + struct.pack("<%db" % n, *bv)
    )


def unpack(data):
    """The inverse of pack(), for the tests: [(ra hours, dec degrees, V, B-V or None)]."""
    n, version = struct.unpack_from("<HH", data, 0)
    if version != FORMAT_VERSION:
        raise ValueError("unknown star catalogue version %d" % version)
    ra = struct.unpack_from("<%dH" % n, data, 4)
    dec = struct.unpack_from("<%dH" % n, data, 4 + 2 * n)
    mag = struct.unpack_from("<%dB" % n, data, 4 + 4 * n)
    bv = struct.unpack_from("<%db" % n, data, 4 + 5 * n)
    return [
        (
            ra[i] / U16_STEPS * RA_HOURS,
            dec[i] / U16_MAX * DEC_SPAN_DEG - DEC_SPAN_DEG / 2,
            mag[i] / MAG_SCALE - MAG_OFFSET,
            None if bv[i] == BV_NONE else bv[i] / BV_SCALE,
        )
        for i in range(n)
    ]


GREEK = {
    "Alp": "\u03b1", "Bet": "\u03b2", "Gam": "\u03b3", "Del": "\u03b4", "Eps": "\u03b5", "Zet": "\u03b6",
    "Eta": "\u03b7", "The": "\u03b8", "Iot": "\u03b9", "Kap": "\u03ba", "Lam": "\u03bb", "Mu": "\u03bc",
    "Nu": "\u03bd", "Xi": "\u03be", "Omi": "\u03bf", "Pi": "\u03c0", "Rho": "\u03c1", "Sig": "\u03c3",
    "Tau": "\u03c4", "Ups": "\u03c5", "Phi": "\u03c6", "Chi": "\u03c7", "Psi": "\u03c8", "Ome": "\u03c9",
}
SUPERSCRIPT = {"1": "\u00b9", "2": "\u00b2", "3": "\u00b3"}
COL_FLAMSTEED, COL_BAYER, COL_BAYER_N, COL_CONSTELLATION = slice(4, 7), slice(7, 10), 10, slice(11, 14)
NAMED_MAX_V = 4.6   # stars this bright get a designation (the sky lets a tap on them say which)


def parse_name(line):
    """(designation, constellation id) from a catalogue line: the Bayer letter
    (alpha, beta, with a superscript where there are several) or else the
    Flamsteed number; None where the star has neither."""
    con = line[COL_CONSTELLATION].strip()
    bayer = line[COL_BAYER].strip()
    if con and bayer in GREEK:
        return GREEK[bayer] + SUPERSCRIPT.get(line[COL_BAYER_N].strip(), ""), con
    flam = line[COL_FLAMSTEED].strip()
    if con and flam:
        return flam, con
    return None


def names_json(pairs):
    """[[star number in stars-v1.bin, designation, constellation id], ...] for
    the stars with a designation and V <= NAMED_MAX_V, from (star, name) pairs
    in the order the file stores them (brightest first)."""
    rows = []
    for i, (star, name) in enumerate(sorted(pairs, key=lambda p: p[0][2])):
        if name and star[2] <= NAMED_MAX_V:
            rows.append([i, name[0], name[1]])
    return {"v": FORMAT_VERSION, "n": rows}


def main(argv):
    if len(argv) != 2:
        sys.exit("usage: build_star_catalog.py bsc5.dat.gz")
    opener = gzip.open if argv[1].endswith(".gz") else open
    pairs = []
    with opener(argv[1], "rt", encoding="ascii", errors="replace") as f:
        for line in f:
            star = parse_line(line)
            if star:
                pairs.append((star, parse_name(line)))
    stars = [p[0] for p in pairs]
    data = pack(stars)
    with open(OUT_PATH, "wb") as out:
        out.write(data)
    with open(NAMES_PATH, "w", encoding="utf-8") as out:
        json.dump(names_json(pairs), out, separators=(",", ":"), ensure_ascii=False)
    print("%d stars, %d bytes -> %s" % (len(stars), len(data), OUT_PATH))


if __name__ == "__main__":
    main(sys.argv)
