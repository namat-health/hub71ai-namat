# Namat original logo source

Downloaded 17 September 2026 through the native Claude Design application, using the source file’s Download menu. No prompt was sent to Claude and the project was not edited.

- Project: **Design strategy and decision framework**
- Project URL: https://claude.ai/design/p/4cc756b7-d514-4f1e-b728-8609d084fcb0
- Original file: `Short Deck. V1.dc.html` (downloaded unchanged)
- SHA-256: `e66f8340c88f9ed8cb11951746d01ee8663a8fb1fbc57848c63c49d4a1d23013`

The current deck’s logo is an HTML/CSS typographic composition, not a linked raster/vector file. The standalone files contain exact logo markup isolated from the downloaded deck source, with only a transparent wrapper added:

- `namat-wordmark-original.html`: source line 25, the title-slide wordmark, 150px original nominal size.
- `namat-health-lockup-original.html`: source line 305, the stacked health lockup, 88px original nominal size.

Both use Archivo variable font, width 125%, weight 700, tracking -0.035em for the wordmark. The wordmark ends with a small square below the t. The line on the title slide sits above the confidentiality/date text and is a separate layout element; it is not part of the wordmark markup. The stacked health line uses width125%, weight250, and exact spacing from the source. Font loading must retain the variable width axis; a normal-width fallback changes the shape.

Use the attached PDF as the only source for company facts. This downloaded source is retained solely for logo provenance and implementation, not as an alternative deck-content authority.

## Font and visual validation

`archivo-original-latin.woff2` was retrieved from the Google Fonts stylesheet URL already embedded in the downloaded source (exact URLs in `FONT-SOURCE.txt`). It is the normal Latin Archivo variable face, supporting weights100–900 and width62%–125%; no font outline modification was made. `logo-font.css` changes only its asset URL to the local file. The standalone logo assets now use that local font. Font SHA-256: `4c98b9d490d1698ec95f2ff17a6c7d0e72691864c0c5d7bc2a2c161b45afe5ad`. The accompanying Archivo SIL Open Font License was retrieved from the official Google Fonts repository: https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/OFL.txt.

Both standalone assets were rendered in Chrome with the local font and visually compared with the supplied PDF’s rendered slide1 and slide8. Wordmark shape, below-t square, and stacked health spacing match. This is original typographic logo markup, not a new SVG or a redrawing.
