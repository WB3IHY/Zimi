"""A small library for the Field Guide: Ready.gov (a zimit crawl, pages at
www.ready.gov/<slug>), a water document library (nautiluszim's database.js
and a PDF), a Wikipedia with two articles, a Spanish Wikipedia medicine
build, and the field-manual ZIM Zimi builds (a folder ZIM, its listing at
zimi-database.js).

build_library(zdir) writes the ZIMs and returns their names.
"""

import os

from libzim.writer import Creator
from wiki_fixture import _Page

READY = "www.ready.gov_en_2024-12.zim"
WATER = "zimgit-water_en_2024-08.zim"
WIKI = "wikipedia_en_top_2026-06.zim"
WIKI_ES = "wikipedia_es_medicine_2026-03.zim"
MANUAL = "zimi_field_manual_2026-10.zim"
LIBRARY = (READY, WATER, WIKI, WIKI_ES, MANUAL)


def _html(title, body):
    return (
        "<html><head><title>%s</title></head><body><main><h1>%s</h1>%s</main></body></html>"
        % (title, title, body)
    ).encode()


def _zim(path, meta, pages, main):
    with Creator(path).config_indexing(True, meta.get("Language", "eng")) as c:
        c.set_mainpath(main)
        for p, title, blob, *mime in pages:
            c.add_item(_Page(p, title, blob, *(mime or ["text/html"])))
        for k, v in meta.items():
            c.add_metadata(k, v)


def build_library(zdir, only=None):
    only = only or LIBRARY
    if READY in only:
        _zim(
            os.path.join(zdir, READY),
            {
                "Name": "www.ready.gov_en",
                "Title": "Ready.gov",
                "Language": "eng",
                "Date": "2024-12-03",
            },
            [
                (
                    "www.ready.gov/index",
                    "Ready.gov",
                    _html("Ready.gov", "<p>Be informed.</p>"),
                ),
                (
                    "www.ready.gov/floods",
                    "Floods | Ready.gov",
                    _html("Floods", "<p>Know your risk for floods.</p>"),
                ),
                (
                    "www.ready.gov/water",
                    "Water | Ready.gov",
                    _html("Water", "<p>Store water.</p>"),
                ),
            ],
            "www.ready.gov/index",
        )
    if WATER in only:
        db = (
            "var DATABASE = [\n"
            "{'_id': '00000', 'ti': 'Distillation For Home Water Treatment', 'dsc': 'For people with a water quality problem', "
            "'aut': 'Michigan State University', 'fp': ['Distillation.pdf']},\n"
            "{'_id': '00001', 'ti': 'Giardia', 'dsc': 'EPA fact sheet', 'aut': 'EPA', 'fp': ['Giardia.pdf']},\n"
            "];\n"
        ).encode()
        _zim(
            os.path.join(zdir, WATER),
            {
                "Name": "zimgit-water_en",
                "Title": "Water Treatment Library",
                "Language": "eng",
                "Date": "2024-08-29",
            },
            [
                ("index.html", "Water", _html("Water", "<p>Library</p>")),
                ("database.js", "database", db, "text/javascript"),
                (
                    "files/Distillation.pdf",
                    "Distillation",
                    b"%PDF-1.4 distillation",
                    "application/pdf",
                ),
                (
                    "files/Giardia.pdf",
                    "Giardia",
                    b"%PDF-1.4 giardia",
                    "application/pdf",
                ),
            ],
            "index.html",
        )
    if WIKI in only:
        _zim(
            os.path.join(zdir, WIKI),
            {
                "Name": "wikipedia_en_top",
                "Title": "Best of Wikipedia",
                "Language": "eng",
                "Date": "2026-06-16",
            },
            [
                ("Main_Page", "Main Page", _html("Main Page", "<p>Welcome.</p>")),
                (
                    "Hypothermia",
                    "Hypothermia",
                    _html(
                        "Hypothermia",
                        "<p>Hypothermia is a body temperature below normal.</p>",
                    ),
                ),
                (
                    "Tourniquet",
                    "Tourniquet",
                    _html(
                        "Tourniquet",
                        "<p>A tourniquet is a device that constricts a limb.</p>",
                    ),
                ),
            ],
            "Main_Page",
        )
    if WIKI_ES in only:
        _zim(
            os.path.join(zdir, WIKI_ES),
            {
                "Name": "wikipedia_es_medicine",
                "Title": "WikiMed en espanol",
                "Language": "spa",
                "Date": "2026-03-01",
            },
            [
                ("Portada", "Portada", _html("Portada", "<p>Hola.</p>")),
                (
                    "Hipotermia",
                    "Hipotermia",
                    _html("Hipotermia", "<p>La hipotermia.</p>"),
                ),
            ],
            "Portada",
        )
    if MANUAL in only:
        db = (
            "var DATABASE = [\n"
            "{'_id': '2', 'ti': 'ATP 4-02.11 Casualty Response', 'dsc': 'Army Techniques Publication, 2026', 'aut': 'Department of the Army', "
            "'fp': ['ATP_4-02.11_Casualty_Response.pdf']},\n"
            "{'_id': '0', 'ti': 'TC 4-02.1 First Aid', 'dsc': 'Training Circular, 2016', 'aut': 'Department of the Army', "
            "'fp': ['TC_4-02.1_First_Aid.pdf']},\n"
            "{'_id': '1', 'ti': 'FM 21-76 Survival', 'dsc': 'Field Manual, 1992', 'aut': 'Department of the Army', "
            "'fp': ['FM_21-76_Survival.pdf']},\n"
            "];\n"
        ).encode()
        _zim(
            os.path.join(zdir, MANUAL),
            {
                "Name": "zimi_field_manual",
                "Title": "Field manual",
                "Language": "eng",
                "Date": "2026-10-14",
            },
            [
                ("index.html", "Field manual", _html("Field manual", "<p>Manuals</p>")),
                ("zimi-database.js", "listing", db, "text/javascript"),
                (
                    "ATP_4-02.11_Casualty_Response.pdf",
                    "ATP 4-02.11",
                    b"%PDF-1.4 atp",
                    "application/pdf",
                ),
                (
                    "TC_4-02.1_First_Aid.pdf",
                    "TC 4-02.1",
                    b"%PDF-1.4 tc",
                    "application/pdf",
                ),
                (
                    "FM_21-76_Survival.pdf",
                    "FM 21-76",
                    b"%PDF-1.4 fm",
                    "application/pdf",
                ),
            ],
            "index.html",
        )
    return only
