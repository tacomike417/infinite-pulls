# S26 — the fifty, reconciled against the database

Written 16 September 2026, after the master roster
(`infinite-dex-season-26-master.md`) landed. This file supersedes the
twenty-five in `SEASON-26.md`. Nothing has been written to the database
yet — this is the check that has to happen first.

## The good news, first

**Nothing gets deleted.** All twelve cards already seeded in
`infinite_dex_cards` appear in the new fifty under the same names:

| Code in the database now | Becomes |
|---|---|
| SCN-001 Snapsnout | 05/50 |
| COL-001 The Collection Keeper | 06/50 |
| PRO-001 The Herald | 09/50 |
| ACC-001 The Initiate | 10/50 |
| APP-001 The Portal Opens | 12/50 |
| NTF-001 The Signal | 13/50 |
| SLD-001 The Unbroken Seal | 15/50 |
| WSH-001 The Wishfinder | 16/50 |
| COL-010 The Tenfold Titan | 17/50 |
| PDX-050 The Dexwarden | 35/50 |
| GOL-001 The Oathkeeper | 41/50 |
| COL-100 The Hundredfold | 44/50 |

So the migration is **12 renumbers, 38 inserts, 0 deletes**. `user_dex_cards`
has a foreign key into these rows, so anything anybody has already earned
survives untouched. That was the risk and it is not a risk.

`EVT-001` (Grand Opening) and the three `EVT-00[234]` empty slots are not
in the fifty. They get parked, not dropped — same reason.

## Three things in the schema that will break if ignored

### 1. The renumber will collide unless it is done in two passes

`infinite_dex_cards_season_number_idx` is a plain unique index on
`(season, number)` — not deferrable, so it is checked row by row. Card 2
becoming 6 while card 6 is still card 6 fails mid-statement.

Do it as: bump all twelve to `number + 1000` in one statement, then assign
the final numbers in a second. No collisions either way.

### 2. Card 51 cannot be `series = 'set'`

The season fraction is counted at read time as "enabled `set` cards this
season". If `51/50` is a set card the app starts saying **x / 51**, and the
whole point of the secret card is that it sits outside the fifty.

So it needs its own series — `'secret'`. But
`infinite_dex_cards.series` is `check (series in ('set', 'event'))`, and
`SEASON-26.md` also wants `'chase'`.

**A check constraint is rewritten, not appended.** Whichever migration
touches it has to list every value at once — `set`, `event`, `chase`,
`secret` — or it silently deletes the others. This exact bug already cost
us a round in `post_heat.sql`. One statement, all four values, once.

### 3. `dex_sweep()` does not survive fifty cards

It already loops one query per unearned card, on page load and on every
route change. At twelve that is invisible. At fifty, a new account fires
fifty subqueries every time somebody taps anything, on shop wifi.

This has to become one set-based query before the cards go in, not after.

## What each of the fifty actually costs

**8 already work.** 05, 06, 09, 10, 12, 13, 15, 16, 17 (minus the blind
ones below) are live branches in `dex_trigger_met()`.

**33 are a `when` branch and nothing else.** No new table, no new
machinery, `dex_sweep()` picks them up on its own. Every one of these reads
a table that already exists with the column already on it:

- comments and hearts → `post_comments`, `comment_hearts`
  (`post_comments.post_owner` is already there, so 34 "commented on ten
  people" is a `count(distinct post_owner)`)
- photos → `card_photos` where `kind='mine'`, and `user_photos`
- scans → `card_scans` (has `user_id` and `scanned_at`)
- profile → `verified_at`, `avatar_url`, `bio`, `display_name` (card 11, The Namer, is NAME ADDED since 25 Sep 2026; the grail card was retired)
- collection → `user_cards` counts, `count(distinct set_name)`,
  `added_at` for every calendar card
- membership age → `auth.users.created_at`

**51/50 is the easiest one in the set** — count this season's earned `set`
cards, is it 50.

### 9 need a decision before they can be written

| # | Card | The problem |
|---|---|---|
| 12 | The Portal Opens | app-asserted. The browser knows it is installed; nothing is written down. Already accepted. |
| 35 | The Dexwarden | Pokedex is derived live from National Dex numbers `user_cards` does not store. Already accepted. |
| 20 | The Mirror | `user_cards.variant` is free text. Live values include `reverse holo`, `Reverse Holofoil`, `Reverse holo`. Checkable with a `lower() like '%reverse%'`, but it is a string match, not a flag. |
| 22 | The Shiny | Same, `%holo%` and not reverse. Same fragility. |
| 33 | The Graded | Grades live in `user_cards.condition` as `PSA 10`, `BGS 10 black label`, `CGC 10 pristine`. Parseable, still free text. |
| 42 | The Perfect Ten | Same, plus pulling the number out. |
| 28 | The Appraiser ($100) | `profiles.collection_value` is a **cached figure written by the browser** and its own comment says "not authoritative". A card that hands itself out based on a number the client writes is a card the client can hand itself. |
| 50 | The Thousand ($1,000) | Same, and this one is the last card before the 10% off. |
| 46 | The Climber | Needs `collection_value_snapshots` to actually have rows. The `snapshot-collection-value` Edge Function exists in the repo — nobody has confirmed it is deployed and scheduled. |
| 41 | The Oathkeeper | Still blocked on the same thing `GOALS-NEXT.md` names: five of the eight collector goals are computed live and never written down, so there is no "completed" to detect. |
| 31 | The Hunter | "A wish became yours" = same `card_id` in both `wishlist_cards` and `user_cards`. Works, unless people tidy the wish off the list after buying — then it never fires for the people who earned it most. |

None of these is fatal. 20, 22, 33, 42 and 31 ship with string matching and
are fine. 28, 50 and 46 are the ones worth saying out loud, because they sit
directly under the discount.

## The reward tiers

`dex_reward_tiers` currently holds 6 / 8 / 10, all reading "Prize to be
decided". **Nothing has ever been redeemed** — the reward half has been
off since it was built — so these can be rewritten cleanly rather than
disabled around.

Under the new model there is only one register reward, so this becomes
**one row: 50 cards → 10% off.** Card `51/50` is the trophy for it, not a
second mechanism. The app-only rewards (ribbon, goal badge, dex card,
title) are not tiers and do not belong in this table.

## The number worth taking to Jeff

The calendar cards set the floor and nothing shortens it. Card 47 is "cards
added in three months" and card 48 is "ninety days a member". So:

> **Nobody can reach the 10% off in under three months**, no matter how
> hard they try, and they have to be posting, commenting, scanning and
> adding cards the whole way.

One discounted order, at the end of a quarter of real activity. That is a
much easier sentence to say to him than "10% off" on its own.

## The bill nobody has priced yet

`infinite-dex-season-26-complete-v1.zip` is **170 MB** — fifty-one cards at
1060x1484. `SEASON-26.md` worried about twelve cards being 38 MB on shop
wifi. This is four and a half times that.

`infinite_dex_cards` already has `thumb_url` beside `art_url`, so the
machinery is there. But **fifty-one WebP thumbnails have to be generated
and uploaded**, and the Dex grid must never load a full-size card. That is
now a hard requirement, not an optimisation.

## Run this before anything is written

```sql
-- 1. What is actually in the catalogue right now
select code, name, season, series, number, award_type, enabled
  from public.infinite_dex_cards
 order by season, series, number nulls last;

-- 2. Has anybody earned anything (this is what the renumber has to protect)
select c.code, c.name, count(u.id) as holders
  from public.infinite_dex_cards c
  left join public.user_dex_cards u on u.card_id = c.id
 group by c.code, c.name
 order by holders desc, c.code;

-- 3. The reward tiers, and whether anything was ever redeemed
select cards_required, reward, enabled from public.dex_reward_tiers order by 1;
select count(*) as redemptions from public.dex_reward_redemptions;

-- 4. Is the value history real? (card 46 depends on this)
select count(*) as snapshot_rows,
       count(distinct user_id) as people,
       max(snapshot_date) as newest
  from public.collection_value_snapshots;

-- 5. Is the switch on?
select * from public.dex_settings;
```
