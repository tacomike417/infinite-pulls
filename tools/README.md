# tools

Checks for the card scanner and the Japanese card search. Nothing in here
ships to a customer — these only run on a development machine.

## The two that always run

    node tools/scan-test.mjs        # what the scanner does with OCR text
    node tools/japanese-test.mjs    # the English -> Japanese card bridge
    node tools/sealed-test.mjs      # the sealed catalogue and its totals
    node tools/holdings-test.mjs    # editing a card you already own

No dependencies and no network. Both read the real functions straight out
of `components/collection.js` rather than keeping their own copy, so if a
function gets renamed they fail loudly instead of quietly passing against
a stale duplicate.

`sealed-test.mjs` is built on responses captured from the **live**
PokemonPriceTracker API, and the reason it exists is that their docs and
their API disagree on things that matter. Two of its checks are load-
bearing:

- **"Surging Sparks Booster Box" is $307. "Surging Sparks Booster Box
  Case" is $2,103.** Any product matching done by substring takes the
  Case, and somebody's collection quietly gains seventeen hundred
  dollars. Only an exact name is accepted; a near miss is refused.
- **An unpriced box adds nothing to a total** rather than being guessed
  at, and an eBay figure is never labelled a market price.

`holdings-test.mjs` covers the highest-stakes arithmetic in the app —
changing the condition or printing of a card somebody already owns, and
splitting part of a stack off. Every case asserts the TOTAL number of
cards is conserved, because the failure mode here is cards silently
appearing or vanishing from a collection with nothing on screen to
suggest anything happened. It replays each plan against an in-memory
collection, so it checks what actually happens rather than what the plan
claims.

`japanese-test.mjs` is built on JSON captured from the live TCGdex API
(`api.tcgdex.net/v2/ja`) rather than invented shapes, including the detail
of a real Japanese card showing `tcgplayer: null` next to a populated
`cardmarket` — which is the whole reason Japanese cards need their own
handling.

## The one that needs setting up

    npm install --no-save playwright tesseract.js @tesseract.js-data/eng
    npx playwright install chromium
    python3 tools/make-test-cards.py
    node tools/ocr-check.mjs

If Playwright can't download its own browser, point it at one you have:

    CHROMIUM_PATH=/path/to/chrome node tools/ocr-check.mjs

This is the only check that proves the scanner can read a number off an
actual image: it runs the real crop / threshold / OCR pipeline in a real
browser against generated card photos. Deliberately kept out of
`package.json` — it is for working on the scanner, not for building the
site. Tesseract's model files are served from a local folder, so it works
with no internet.

Expect roughly:

    ok   clean.jpg    read 066/108  (from the bottom left)
    ok   dark.jpg     read 025/091  (from the bottom strip)
    ok   secret.jpg   read 199/165  (from the bottom left)
    ok   tilted.jpg   read 004/162  (from the bottom left)

## Why the scanner reads the number and not the name

The previous version read the card's name and essentially never worked.
Running the old approach over these same four photos returns **nothing at
all** for every one of them, even though the name is large clean text —
because the OCR reads the top line as something like `Charizard ex HP 330`
and the old filter discarded any line containing a digit.

The number in the corner is small, but it is dark text on a plain
background in a plain font with no artwork behind it. It is both the most
readable thing on the card and the most identifying: a name search for
Charizard returns a hundred printings, a number plus a set total pins down
essentially one. It is also language-independent, which is how the scanner
finds a Japanese card whose name nobody here could type.
