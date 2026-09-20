# Card art — the English gap

**Parked 20 Sep 2026, part-way through. Batch 01 is done and verified.**
Everything needed to carry on is in `card-art/`.

---

## Where it stands

| | cards |
|---|---|
| in the database | 36,771 |
| have art | 25,711 (70%) |
| **missing** | **11,060** |
| — Japanese | 9,341 — **parked, see the bottom** |
| — English | 1,719 |
| — of those, digital-only (TCG Pocket) | 159 — **excluded, they do not exist as cards** |
| **English cards actually to find** | **1,560** |
| found and verified so far | **242** (batch 01) |
| left | 1,318 — batches 02–07 |

## Do not go back to TCGdex for these

All 1,719 English were checked against TCGdex on 20 Sep and every one is
absent. This is not a pipeline bug and no backfill reaches them.

* 51 of the 67 sets return **zero** cards carrying art — so every card
  held in those sets is missing. 1,469 cards.
* 16 sets are partly covered. All 250 of ours in those sets were checked
  **individually by id**: TCGdex has none of them. That is *why* those
  sets read as partial — the residue is exactly what it lacks.

What is in the gap: Trainer Kits (16 sets × 30), the Trainer Galleries
inside Brilliant Stars / Astral Radiance / Lost Origin / Silver Tempest /
Crown Zenith, Black Star Promos (MEP, SM, SWSH, SVP, P-A), the yearly
McDonald's Collections 2011–2024, and the Aquapolis / Skyridge
H-numbered holos.

## How to run the next batch

One batch per ChatGPT conversation. Attach `card-art/batch-0N.csv`,
paste `card-art/PASTE-THIS-WITH-BATCH-0N.txt`. Each paste file already
lists what is in its own batch. Keep the size at 250 — that is what
worked.

**Then send the result back to be verified before loading anything.**

## The verification that matters, and why

An early run returned all 250 rows filled from `images.scrydex.com`,
every row annotated "Direct PNG verified HTTP 200". It was wrong on 230
of them. That host answers 200 with a real-looking image for **any** id,
including ones that cannot exist, and 230 rows were the same generic
Pokemon logo — 186,316 bytes, byte for byte identical.

Status codes prove nothing on a host like that. The test that works:

1. request an id that cannot exist
2. if an image comes back, record its exact byte length
3. any row matching that length is a miss, whatever the status says
4. across a good batch, byte sizes are nearly all **different**

Batch 01 passed it: pkmncards returns a true 404 for a fake id, all 242
links returned images, and there were **241 distinct byte sizes across
242 files** (126KB–905KB). The one repeat is two Darkness Energy cards
that really do share artwork. No two rows pointed at the same image.

Honest blanks in batch 01: 8 Aquapolis a/b variants (Porygon, Golduck,
Drowzee, Mr. Mime). Nobody separates those cleanly. A blank is the right
answer there.

## Still undecided — hosting

The links point at pkmncards.com, a fan database. Nothing has been
copied anywhere yet. The intent was Cloudflare R2, where storage for all
seven batches lands near 500MB (pennies a month, egress free).

Two things to settle before that happens:

* hotlinking pkmncards spends **their** bandwidth; copying to R2 makes us
  the one distributing the artwork. TCGdex is a credited arrangement and
  this is not. Worth a decision made on purpose rather than by default.
* the `source_page` column is kept on every row for exactly this reason —
  provenance stays traceable. Do not drop it.

## Japanese — parked

9,341 missing, and it is largely a **real** TCGdex gap, not a pipeline
one: coverage there is patchy by set. Sampled 20 Sep — SV3a
レイジングサーフ 92/92, PMCG1 拡張パック 0/102, M4 ニンジャスピナー
0/120. Modern SV-era sets are complete, older ones have nothing.

Worth asking whether Japanese cards need art at all before spending on
it — they are 36% of the database and probably a much smaller share of
what anyone looks up in an Ohio card shop.

## Files

```
card-art/english-missing-art-ALL.csv           all 1,560
card-art/batch-01.csv … batch-07.csv           250 at a time (07 is 60)
card-art/batch-01-VERIFIED.csv                 DONE — 242 verified links
card-art/PASTE-THIS-WITH-BATCH-0N.txt          one per batch
card-art/EXCLUDED-tcg-pocket-digital-only.csv  159 digital-only cards
```
