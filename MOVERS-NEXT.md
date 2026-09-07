# Movers & Shakers — what is built, and the one open question

_7 September 2026._

## Built and live

| Piece | Where |
|---|---|
| `top_movers()` — the public board's query | `supabase/top_movers.sql` |
| `card_trends()` — batch movement for any list of cards | `supabase/card_trends.sql` |
| The public board, risers + fallers | `components/movers.js` → `?page=movers` |
| Home-page rail with the wordless ▲/▼ sort | `components/home-mine.js` |
| Rising / falling / steady on prices, rows and artwork | `components/price-trend.js` |

Tests: `node tools/test/movers.mjs`, `tools/test/home-movers-rail.mjs`,
`tools/test/price-trend.mjs`.

## PARKED: a $500+ board

Asked for on 7 Sep, deliberately **not decided**. Two questions were put
and both were saved for later. Do not build this without answering them —
one of the available answers quietly rebuilds the movers rail a second
time.

### Question 1 — what is it for?

The whole design hangs on this, because it decides whether the new board
duplicates the one above it.

**A. The grails — ranked by price.** The most valuable cards, most
expensive first. *Zero* overlap with movers, because it sorts on a
different thing entirely. The cost is honest and real: it barely changes.
Same twenty cards most weeks. The movers rail earns its home-page slot
by changing on its own; a grails rail is wallpaper by the second visit.

**B. Big money — $500+ ranked by DOLLARS moved.** Different question from
the movers rail, which ranks by percentage, so the two rarely agree on an
order even when they share a card. Changes weekly. This is the board an
investor actually watches.

**C. $500+ ranked by percentage.** This is the movers query with a higher
floor and the same sort. Every card on it was already considered by the
rail above it. On a quiet week the two could look near-identical. If this
gets picked, pick it knowing that.

### Question 2 — where does it live?

Fifth rail on the home page · a third board on `?page=movers` · or both,
with the rail as a teaser linking to the board (least new code — one
query serves both, the way Movers & Shakers already does).

### Answer this first, with data

How many cards even qualify? If under about forty clear $500, the board
has barely more than the twenty it shows and can never change — which
settles Question 1 on its own.

```sql
select
  count(*)                                as cards_priced,
  count(*) filter (where price >= 500)    as at_500,
  count(*) filter (where price >= 250)    as at_250,
  count(*) filter (where price >= 100)    as at_100,
  count(*) filter (where price >=  50)    as at_50
from (
  -- Newest reading per card, whatever day it landed on. Do NOT anchor
  -- this on max(recorded_on): the newest date in the table is usually a
  -- handful of rows the browser wrote for cards somebody looked up that
  -- morning, not the weekly catalogue pass. Asking that question got the
  -- answer "12 cards over $50" out of a 30,000-card catalogue, which was
  -- a true fact about fifty-three cards and a useless one about the rest.
  select distinct on (card_id) card_id, price
  from card_price_history
  where source = 'tcgplayer'
  order by card_id, recorded_on desc, price desc
) t;
```

`cards_priced` is the sanity check. Anything in the dozens means the query
found one day's browser writes instead of the catalogue, and every number
beside it is meaningless.

### The answer, measured 7 Sep 2026

| | cards |
|---|---|
| priced on TCGplayer at all | **19,060** |
| $50 and up | 1,991 |
| $100 and up | 1,057 |
| $250 and up | 369 |
| **$500 and up** | **128** |

19,060 rather than 36,771 because this counts TCGplayer only: the 13,223
Japanese cards are Cardmarket-only, and TCGplayer does not carry every
English card either.

**What 128 settles.** It is plenty to build on — but it kills option A on
its own. The top twenty of a fixed 128, sorted by price, is the same
twenty cards indefinitely; the most expensive cards in Pokémon do not
reorder week to week. A price-sorted board would be correct, and dead.

**What 128 supports.** It is a good pool for option B. Every week some
subset of those 128 moves, and which subset changes — so a board of
"biggest dollar moves among the premium cards" has something new to say
each Sunday without ever repeating the percentage board above it.

**The number to watch is how many of the 128 clear the 3% floor in a given
week.** If that is regularly under ten, drop the threshold to $250 (369
cards) rather than showing a board with four rows on it. Worth measuring
once there is a real week of history:

```sql
select count(*) as premium_movers
from top_movers('up', 100, 7, 500)
union all
select count(*) from top_movers('down', 100, 7, 500);
```

## The tier vocabulary (outside consultation, 7 Sep 2026)

Mike came back with a four-tier breakdown from someone he asked:

| Tier | Range | Cards (measured 7 Sep) |
|---|---|---|
| — | under $50 | 17,069 |
| **Notable** | $50–99 | 934 |
| **High-value** | $100–249 | 688 |
| **Premium** | $250–499 | 241 |
| **Grails** | $500+ | 128 |

Each tier is roughly a third to a half the size of the one below it. None
is too thin to fill a board and none is so broad it says nothing — which
is more than can usually be said for a bracket scheme picked by feel.

Note the top line: **89.6% of the catalogue is under $50**, so the movers
board's $5 floor is currently drawing almost entirely from the bottom
bucket. That is not wrong, but it explains why the board reads the way it
does, and it is the reason a Grails view is worth having at all.

### What the tiers change about the parked question

They turn the $500+ board from a SECOND BOARD into a FILTER on the one
that exists. `top_movers()` already takes `p_min_price`; give it a max and
a chip row — Notable · High-value · Premium · Grails — and one board
serves four audiences. The duplication worry that started this whole
discussion dissolves: it is not a competing board, it is the same board
scoped.

That is the cheapest good answer available and probably where this lands.

### Two decisions the tiers create

**Which price sets the tier?** A card that crashed $600 → $180: a Grail
that fell, or a High-value card? Tier on the STARTING price and it stays
in Grails, where the story is. Tier on the current price and it demotes
itself out of the tier somebody most wants to see it in. Same shape as the
floor decision above, and the same answer for the same reason.

**Tiers move.** $498 is Premium; $505 next week is a Grail. Not a problem —
possibly a feature ("promoted to Grails this week") — but the label
describes a moment, not a property of the card. Anything that caches or
stores a tier will be wrong within a week.

### On the overlap worry specifically

The movers rail ranks by **percentage**, which structurally favours cheap
cards — a $6 card going to $8 is +33%, while a $700 card gaining a real
$35 is +5% and never places. So the top 25 by percentage lives in the
$5–$50 band, and a typical week should put **0–3 cards** on both boards.

When one card does appear on both, that is not duplication. A $500 card
that moved 30% is the biggest piece of news the site has that week.

Measure it for real once there is genuine history:

```sql
select count(*) as on_both
from top_movers('up', 25, 7)
where now_price >= 500;
```
