# ZimiGames identity

**The idea:** ZimiGames is Zimi's Z dealt as a card, so every game in the ZIM, from a pip card to a chess board, signs itself with the same gradient Z and the same amber.

## The mark

- Geometry: the Z of Zimi's app icon (two bars and a diagonal, 40 x 52, bar thickness 10.5) set on a portrait card (56 x 78, corner radius 6, near-black `#0a0a0b`), with a second card in the Z's gradient fanned 14 degrees behind it. Built once in `cards.js` (`ZimiCards.markSvg`, `MARK_Z`, `MARK_CARD`) and written out as `mark.svg`.
- Reads at 20 px (the Z and the orange edge survive) and at 96 px (`icon.png`: the mark at 80 percent on Zimi's near-black rounded tile, generated from `markSvg({tile: true})`).
- Wordmark: the mark's own Z in the gradient, then IMI in a bold stroke and GAMES in a light stroke, all drawn paths on a 10 x 14 grid with square ends and mitred corners (no font). `ZimiCards.wordmarkSvg()`; ink is `currentColor`.

## Colour

| Token | Value | Use |
| --- | --- | --- |
| mark-from | `#fb8c14` | gradient start (top left), hairlines, back lattice |
| mark-to | `#f2582a` | gradient end (bottom right) |
| gold | `#e09400` | court crowns, trims, collars |
| ink | `#0a0a0b` | mark card, Zimi back ground |
| card | `#fdfcf8` | face, both themes |
| suit red / black | `#c62828` / `#1b1b1b` | games.css tokens |
| Italian suits | coins `#b87500`, cups `#c62828`, swords `#2c4a86`, clubs `#2f7d4f` | `ITALIAN_COLOURS` |

The UI accent stays games.css `--accent` (amber). The felt stays green, the face stays cream in light and dark.

## Type

No font anywhere in the deck or the mark. Indices are stroked paths (`GLYPHS`, stroke 2.4 on a 10 x 14 grid): A, 2 to 10, J, Q, K, plus the letters of the wordmark. Page text keeps the system stack.

## The deck (`faceMarkup`, 100 x 140 viewBox)

- Corner index: rank 1.35 x grid (10 at 1.05 x) over a suit at 0.7 x, repeated turned on the far corner. Pip layouts are the standard ones.
- Suits: clubs and spades as before, hearts pointed, diamonds a slightly concave kite.
- Courts: one geometric bust per rank, two-way, standing on a centre band that holds the suit. Jack: cap with a gold feather. Queen: three-point gold crown. King: five-point gold crown and beard. Faces are blank by design. Suit colour carries the figure, gold carries the rank.
- Ace of Spades: a larger spade carrying the mark's Z. Jokers: `ZimiCards.jokerMarkup(red, standalone)`.
- Sizes, switched by the card's own width (container query in `cards.css`): above 64 px full detail; 41 to 64 px no `zc-fine` detail (pearls, collar, inner trim); 41 px and below, the index becomes one large row (rank beside suit, 2.1 x) and the body one big suit or one figure, so a Spider column (about 33 px) reads in a 14 px sliver. Minimum supported card width is 24 px.
- Italian deck: `ZimiCards.italianFaceMarkup(id, standalone)`, ids 0 to 39, suit = floor(id / 10) (coins, cups, swords, clubs), rank = id % 10 + 1 with 8 Fante, 9 Cavallo, 10 Re; `italianName(id)`. Same index, pips and size rules; upright pips; one upright figure per court.
- The cascade draws the same faces standalone (suits inline, card body added).

## Backs

Zimi back (default): dark lattice, a diamond frame, the Z, a slow sheen every nine seconds and a breathing glow. CSS transforms and opacity only, paused with the tab, off under reduced motion. The five older backs stay as choices.

## Where the mark appears

1. Shelf header: mark and wordmark lockup (inline SVG, `index.html` header only).
2. Every game's bar: `.ar-back` draws a chevron and the mark (`games.css`); the page's own text and `aria-label` stay.
3. Every sheet title (win, menus, backs): the mark at 22 px before the heading.
4. Card backs and the Ace of Spades.
5. The ZIM icon, `icon.png`, 96 x 96.

## Open

Joker and the Italian courts are a first pass in the same language. The mark appears twice in the shelf header (card, then wordmark's Z); that is the lockup, not an accident.
