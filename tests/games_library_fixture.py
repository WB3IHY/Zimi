"""A small library for the games that draw on the player's own ZIMs (builtin/games: Wiki Race,
Letter by Letter, Quizzical, Jigsaw, Where in the World, Five Letters).

    python3 tests/games_library_fixture.py <dir>    # writes <dir>/zims/*.zim

An English and a French Wikipedia whose articles link to each other and carry a lead sentence
(some a picture), an English and a French Wiktionary with five-letter words, and a map with a
place index. Pages are in mwoffliner's shape (relative ./Title links, ./I/ pictures).
"""

import json
import os
import shutil
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from libzim.writer import Creator  # noqa: E402

from wiki_fixture import MW, _Page, page  # noqa: E402

#: title -> (lead sentence, [links], picture colour or None)
EN = {
    "Paris": (
        "Paris is the capital and largest city of France.",
        ["France", "Seine", "Europe"],
        (200, 120, 90),
    ),
    "France": (
        "France is a country in Western Europe.",
        ["Paris", "Europe", "Germany"],
        (60, 90, 200),
    ),
    "Germany": (
        "Germany is a country in Central Europe.",
        ["Berlin", "Europe", "France", "Albert Einstein"],
        None,
    ),
    "Berlin": (
        "Berlin is the capital and largest city of Germany.",
        ["Germany", "Europe"],
        (90, 160, 90),
    ),
    "Europe": (
        "Europe is a continent located entirely in the Northern Hemisphere.",
        ["France", "Germany", "Asia", "Earth"],
        None,
    ),
    "Asia": (
        "Asia is the largest continent on Earth.",
        ["Europe", "Himalayas", "Earth"],
        None,
    ),
    "Himalayas": (
        "The Himalayas are a mountain range in Asia.",
        ["Asia", "Mount Everest"],
        (170, 190, 220),
    ),
    "Mount Everest": (
        "Mount Everest is the highest mountain above sea level.",
        ["Himalayas", "Earth"],
        (230, 230, 240),
    ),
    "Seine": (
        "The Seine is a river in northern France.",
        ["Paris", "France", "Water"],
        None,
    ),
    "Water": (
        "Water is an inorganic compound with the chemical formula H2O.",
        ["Energy", "Earth", "Seine"],
        (40, 120, 190),
    ),
    "Energy": (
        "Energy is the quantitative property that must be transferred to do work.",
        ["Physics", "Water", "Sun"],
        None,
    ),
    "Physics": (
        "Physics is the natural science of matter, motion and energy.",
        ["Energy", "Albert Einstein", "Moon"],
        None,
    ),
    "Albert Einstein": (
        "Albert Einstein was a German-born theoretical physicist.",
        ["Physics", "Germany", "Energy"],
        (120, 120, 120),
    ),
    "Earth": (
        "Earth is the third planet from the Sun.",
        ["Sun", "Moon", "Water", "Solar System"],
        (50, 110, 170),
    ),
    "Moon": (
        "The Moon is Earth's only natural satellite.",
        ["Earth", "Sun", "Solar System"],
        (180, 180, 170),
    ),
    "Sun": (
        "The Sun is the star at the center of the Solar System.",
        ["Earth", "Moon", "Solar System", "Energy"],
        (240, 190, 60),
    ),
    "Solar System": (
        "The Solar System is the gravitationally bound system of the Sun and the objects that orbit it.",
        ["Sun", "Earth", "Moon"],
        None,
    ),
    "Cat": (
        "The cat is a small carnivorous mammal.",
        ["Mammal", "Animal"],
        (190, 140, 80),
    ),
    "Mammal": (
        "A mammal is a vertebrate animal of the class Mammalia.",
        ["Animal", "Cat"],
        None,
    ),
    "Animal": (
        "Animals are multicellular eukaryotic organisms.",
        ["Mammal", "Cat", "Earth"],
        None,
    ),
    "Chess": (
        "Chess is a board game for two players.",
        ["Game", "Europe"],
        (110, 80, 60),
    ),
    "Game": ("A game is a structured form of play.", ["Chess", "Physics"], None),
}
FR = {
    "Paris": (
        "Paris est la capitale de la France.",
        ["France", "Seine"],
        (200, 120, 90),
    ),
    "France": (
        "La France est un pays d'Europe de l'Ouest.",
        ["Paris", "Seine", "Europe"],
        None,
    ),
    "Seine": (
        "La Seine est un fleuve du nord de la France.",
        ["Paris", "France"],
        None,
    ),
    "Europe": (
        "L'Europe est un continent de l'hémisphère nord.",
        ["France", "Paris"],
        (70, 140, 100),
    ),
    "Lyon": ("Lyon est une ville de France.", ["France", "Rhône"], (150, 100, 60)),
    "Rhône": ("Le Rhône est un fleuve de Suisse et de France.", ["Lyon", "France"], None),
    "Marseille": ("Marseille est une ville du sud de la France.", ["France", "Rhône"], (60, 150, 190)),
    "Alpes": ("Les Alpes sont une chaîne de montagnes d'Europe.", ["France", "Europe"], (200, 210, 230)),
    "Chat": (
        "Le chat est un petit mammifère carnivore.",
        ["Europe", "France"],
        (190, 140, 80),
    ),
}

WORDS_EN = {
    "table": "A piece of furniture with a flat top and legs.",
    "chair": "A seat for one person, with a back.",
    "water": "A clear liquid that falls as rain and fills rivers.",
    "house": "A building where people live.",
    "plant": "A living thing that grows in soil and makes its food from light.",
    "bread": "A food made by baking flour and water.",
    "stone": "A hard piece of rock.",
    "cloud": "A mass of tiny drops of water floating in the sky.",
    "river": "A large natural stream of water.",
    "light": "What lets us see; the opposite of dark.",
    "music": "Sounds arranged to be pleasant to hear.",
    "green": "The colour of grass.",
    "horse": "A large animal people ride.",
    "night": "The dark part of the day.",
    "ocean": "A very large body of salt water.",
    "paper": "A thin material for writing on.",
    "queen": "A woman who rules a country.",
    "sheep": "A woolly farm animal.",
    "smile": "A happy look on the face.",
    "train": "Railway carriages pulled by an engine.",
    "wheel": "A round thing that turns to move a cart.",
    "world": "The earth and everything on it.",
    "bridge": "A structure that carries a road over a river.",
    "garden": "A piece of ground where flowers and vegetables grow.",
}
WORDS_FR = {
    "arbre": "Grande plante ligneuse à tronc.",
    "livre": "Ensemble de pages reliées que l'on lit.",
    "nuage": "Amas de gouttelettes en suspension dans l'air.",
    "pomme": "Fruit rond du pommier.",
    "terre": "Planète où vivent les humains.",
    "monde": "L'ensemble de la Terre et de ses habitants.",
    "fleur": "Partie colorée d'une plante.",
    "ciel": "Espace au-dessus de nous.",
    "route": "Voie faite pour les voitures.",
    "lune": "Satellite naturel de la Terre.",
    "neige": "Eau congelée qui tombe en flocons.",
    "vache": "Femelle du taureau.",
    "forêt": "Grande étendue couverte d'arbres.",
}


def _picture(w, h, rgb):
    """A PNG with something to look at: a gradient from the colour to white with a ring and a diagonal band,
    so jigsaw pieces are told apart."""
    rows = []
    cx, cy = w * 0.5, h * 0.5
    for y in range(h):
        row = bytearray(b"\x00")
        for x in range(w):
            t = (x / w + y / h) / 2
            r, g, b = (int(c + (255 - c) * t * 0.7) for c in rgb)
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if abs(d - h * 0.3) < 6:
                r, g, b = 255 - r, 255 - g, 255 - b
            if (x - y) % 90 < 10:
                r, g, b = r // 2, g // 2, b // 2
            row += bytes((r, g, b))
        rows.append(bytes(row))

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"".join(rows)))
        + chunk(b"IEND", b"")
    )


def _slug(t):
    return t.replace(" ", "_")


def _article(lang, title, lead, links, rgb, titles=()):
    pic = ""
    if rgb:
        pic = (
            '<figure typeof="mw:File/Thumb"><a href="./File:%s.png"><img src="./I/%s.png" width="400" height="300" alt="%s"></a>'
            "<figcaption>%s</figcaption></figure>"
            % (_slug(title), _slug(title), title, title)
        )
    titles = list(titles)
    at = titles.index(title) if title in titles else 0
    # A real article links to a good many others: the named ones, then the next few of the library.
    more = [titles[(at + k) % len(titles)] for k in range(1, 7) if titles]
    shown = list(dict.fromkeys(list(links) + [m for m in more if m != title]))
    nav = " ".join(
        '<a rel="mw:WikiLink" href="./%s" title="%s">%s</a>.'
        % (_slug(link), link, link)
        for link in shown
    )
    body = (
        '<section data-mw-section-id="0">%s<p>%s</p><p>See also %s</p>'
        '<p>An <a rel="mw:WikiLink/Interwiki" href="https://www.wikidata.org/wiki/Q1" class="extiw">outside link</a>, '
        '<a href="./Category:Things" rel="mw:WikiLink">a category</a> and <a href="#cite_note-1">a note</a>.</p></section>'
        % (
            pic,
            lead,
            nav,
        )
    )
    return page(title, body, lang=lang)


def _wiki(path, name, title, lang, lang3, articles, main="Main_Page"):
    with Creator(path).config_indexing(True, lang3) as c:
        c.set_mainpath(main)
        front = " ".join(
            '<a rel="mw:WikiLink" href="./%s">%s</a>' % (_slug(t), t) for t in articles
        )
        c.add_item(
            _Page(
                main,
                "Main Page",
                page("Main Page", "<p>Welcome. %s</p>" % front, lang=lang),
            )
        )
        for t, (lead, links, rgb) in articles.items():
            c.add_item(
                _Page(_slug(t), t, _article(lang, t, lead, links, rgb, list(articles)))
            )
            if rgb:
                c.add_item(
                    _Page(
                        "I/%s.png" % _slug(t),
                        t + ".png",
                        _picture(400, 300, rgb),
                        "image/png",
                    )
                )
        for k, v in {
            "Scraper": MW,
            "Name": name,
            "Language": lang3,
            "Title": title,
            "Description": title,
        }.items():
            c.add_metadata(k, v)


def _word_page(lang, word, gloss, pos, heading):
    body = (
        '<section><div class="mw-heading mw-heading2"><h2 id="%s">%s</h2></div>'
        '<section><div class="mw-heading mw-heading3"><h3 id="%s">%s</h3></div>'
        '<p><strong class="Latn headword" lang="%s">%s</strong></p><ol><li>%s</li></ol></section></section>'
        % (heading, heading, pos, pos, lang, word, gloss)
    )
    return page(word, body, lang=lang)


def _wikt(path, name, title, lang, lang3, words, heading, pos):
    with Creator(path).config_indexing(True, lang3) as c:
        c.set_mainpath("Main_Page")
        c.add_item(
            _Page(
                "Main_Page",
                "Main Page",
                page("Main Page", "<p>Welcome.</p>", lang=lang),
            )
        )
        for w, gloss in words.items():
            c.add_item(_Page(w, w, _word_page(lang, w, gloss, pos, heading)))
        for k, v in {
            "Scraper": MW,
            "Name": name,
            "Language": lang3,
            "Title": title,
            "Description": title,
        }.items():
            c.add_metadata(k, v)


def _map(path):
    from conftest_zim import build_fixture_zim

    def place(n, la, lo, s="city"):
        return {"n": n, "t": "place", "a": la, "o": lo, "s": s}

    files = {
        "search-data/manifest.json": json.dumps(
            {"chunks": {"pa": 2, "to": 2}, "sub_chunks": {}}
        ).encode(),
        "search-data/pa.json": json.dumps(
            [place("Paris", 48.8567, 2.3508), place("Pau", 43.3, -0.37, "town")]
        ).encode(),
        "search-data/to.json": json.dumps(
            [place("Tokyo", 35.68, 139.69), place("Toronto", 43.65, -79.38)]
        ).encode(),
    }
    build_fixture_zim(
        path,
        {
            "Scraper": "streetzim",
            "Name": "osm_test",
            "Title": "Test map",
            "Language": "eng",
        },
        files=files,
        main_path="search-data/manifest.json",
    )


def build(base):
    out = os.path.join(os.path.abspath(base), "zims")
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    _wiki(
        os.path.join(out, "wikipedia_en_all_nopic_2026-01.zim"),
        "wikipedia_en_all",
        "Wikipedia",
        "en",
        "eng",
        EN,
    )
    _wiki(
        os.path.join(out, "wikipedia_fr_all_nopic_2026-01.zim"),
        "wikipedia_fr_all",
        "Wikipédia",
        "fr",
        "fra",
        FR,
    )
    _wikt(
        os.path.join(out, "wiktionary_en_all_nopic_2026-02.zim"),
        "wiktionary_en_all",
        "Wiktionary",
        "en",
        "eng",
        WORDS_EN,
        "English",
        "Noun",
    )
    _wikt(
        os.path.join(out, "wiktionary_fr_all_nopic_2026-01.zim"),
        "wiktionary_fr_all",
        "Wiktionnaire",
        "fr",
        "fra",
        WORDS_FR,
        "Français",
        "Nom commun",
    )
    try:
        _map(os.path.join(out, "osm_test_2026-01.zim"))
    except Exception as e:  # the map is only for the Where in the World test
        print("no map fixture:", e)
    return out


if __name__ == "__main__":
    print(build(sys.argv[1] if len(sys.argv) > 1 else "."))
