# Collector Goals — where we got to, and what is next

Written 6 September 2026. Read this first when picking the goals work
back up; it is meant to be enough to restart cold.

## The decision underneath all of it

The app is COLLECTOR FIRST. Mike and Jeff agreed it 6 Sep 2026: the
collector comes above the shop. Every call below follows from that.

Two more standing decisions:

- **User-defined goals are dead.** "Create My Own Goal" was a free-text
  name plus a manual +/- counter, and it went on 6 Sep — too fiddly to
  use, too vague to be worth the screen. The `custom_manual` calculator
  and its stepper are still in the code so nobody's existing goal
  vanished, but nothing new can be created. Do not bring it back.
- **A badge with no finish line does not ship.** A bar that can never
  fill is worse than no badge at all. This is why two of the 25 are
  parked (see below).

## What is live now

Eight goals, all tracking themselves off data the app already had.

**Five earn themselves** — no setting to choose, so nobody opts in:
Gem Mint Ten, Grade Ladder, Monthly Momentum, Yearlong Collector,
Value Milestone.

**Three are picked** — they carry a setting the app cannot guess:
Set Complete, Master Set, Regional Pokédex.

The split is the `auto_track` flag on `collector_goal_templates`, set by
`goal_type` rather than by name, so a future goal of the same shape is
automatic the day it is added.

Ordering on the page: earned first, then closest to done. Automatic
badges at 0% fold away behind "See all badges (N more)" — a wall of
zeroes reads as failing at everything. A goal the collector PICKED is
never folded, however far off, because they chose it.

Automatic badges are computed LIVE and nothing is written. No row per
user per badge, no `completed_at`, and no un-earning when a collection
value dips under a threshold on a bad market week. Making the earned
moment permanent needs a column marking a row "earned, and it stays
earned" before it would be safe — that is a decision, not a task.

## Where the pieces are

| Thing | File |
|---|---|
| Calculators, ctx, auto progress | `components/collector-goals-data.js` |
| The visitor page | `components/collector-goals.js` |
| Collection rows fed to the engine | `components/pokemon-data.js` |
| Badge artwork, 256px WebP | `assets/goal-badges/` |
| badge_image column + 5 goal types | `supabase/goal_badges.sql` |
| auto_track flag | `supabase/goal_auto_track.sql` |
| Badge and card styles | `style.css`, search `goal-badge` |

All 25 badge images exist as 512px PNGs in the delivery zip; only the 8
in use were converted and committed. `*.zip` is gitignored — the drop
carries a 53 MB `originals/` folder that no browser ever needs.

## NEXT: the set and region picker

The obvious next job, and the one that makes "collector first" true.

Right now "picked" means picked from three goals Jeff made, each
hardcoded to one set in its config. A collector chasing Surging Sparks
has no way to say so. The fix: tap "Complete a Set", choose from a
searchable list of every set, and that becomes their own goal.

Most of it already exists:

- `loadAllSets()` in `collector-goals-data.js` already fetches every set
  from TCGdex, sorted newest first.
- `user_collector_goals.custom_config` already carries per-row config —
  it is how the old custom goals stored theirs.
- `GENERATION_RANGES` in `pokemon-data.js` already has the nine regions.

So it is a picker plus wiring, not new machinery. It also unlocks
Species Quest ("pick your Pokémon") and Illustrator Archive.

**This is NOT the thing that was killed.** Create My Own Goal was free
text and a manual counter. This is the shop defining what the goal IS,
with the collector answering only the one question the app genuinely
cannot guess. Still fully automatic afterwards.

## NEXT: showing badges around the rest of the site

The badges only exist on the Collector Goals page and the home rail so
far. Mike asked 6 Sep 2026 for them wherever they make sense.

**Done:** the home rail (`components/home-mine.js`). Artwork on the left
of each tile, name and progress beside it, earned in full colour with the
gold edge, unearned desaturated, automatic badges included. It used to
say "Add your first goal" to everybody who had not picked one — which
stopped being true the moment five badges started earning themselves.

**Still to do, in the order I would take them:**

1. **The profile / public collector page — the trophy case.** Earned
   badges only, big, in colour. This is the one worth doing first: it is
   the only place a badge gets seen by somebody OTHER than the person who
   earned it, and being seen is what makes people chase them. It also
   feeds the social direction the app keeps circling. `profiles.is_public`
   and public collector pages already exist.
2. **My Collection** — a strip above the cards showing what the
   collection is currently earning. Good fit because it is the page where
   the numbers actually move, so it is where a badge ticking over gets
   noticed. Careful: `components/collection.js` is 236 KB, so find the
   render point rather than reading the lot.
3. **My Pokédex** — already draws a Primary Goal card
   (`renderPrimaryGoal` in `components/pokedex.js`); the artwork could
   drop straight into what is there.

**Deliberately NOT Card Lookup.** That page exists to put a price in
front of somebody mid-negotiation in about three seconds. Anything else
on it is in the way. Do not decorate it.

**The earned moment.** Completion currently shows as a filled bar and
nothing else. A toast when a badge lands would make it feel earned — but
it needs the "earned, and it stays earned" column first, otherwise it
would fire again every time a value crossed back over a threshold. See
the note above about automatic badges being computed live.

**The rule that governs all of these placements:** the artwork never
appears without the goal name as real text. At small sizes all 25
medallions share one silhouette and their title banners are unreadable,
so a row of art alone is a row of identical silver blobs.

## NEXT: the remaining 17 of the 25

ChatGPT generated 25 collector goals and badge art for all of them. Nine
shipped or are ready; the rest sort into three groups.

**One derivable piece away** — no new systems, just work:

- **Vintage Near Mint** — needs a card's release date, which comes off
  the TCGdex set record the app already fetches and caches.
- **Secret Rare Sweep** — collector number versus the set's stated
  denominator; both are already available.
- **Release Race** — set release date plus `added_at`, both in hand.
- **Grail Holder** — needs the highest single-card value. My Collection
  already prices every card to total them; it just never keeps the max.

**Parked, and why** — these need a decision, not code:

- **Species Quest** and **Illustrator Archive** have no finish line. We
  can count what somebody owns, never the total, so the bar never fills.
  They work the moment they are given a target number — "own 25 different
  Pikachu cards" — but that changes what the goal means, so it is Mike's
  call.
- **Birth-Year Binder** needs customers' birth year. The app does not ask
  for it, and starting to collect dates of birth is a customer-data
  decision, especially with kids in the customer base.

**Need real machinery:**

- **Six of them fail for the same single reason** — Species Quest,
  Illustrator Archive, Promo Archive, Art Story Set, Vintage Era Run,
  Cameo Hunter. We can count what is owned but not what the total is.
  One piece of infrastructure — a curated checklist — unlocks all six,
  and **the mechanism is already built**: `chase_list` is exactly that,
  and it has sat disabled with an empty `cardIds` array since day one.
  Filling it is a conversation with Jeff about what is in his case.
- **Growth Streak** needs month-end value snapshots. NO LONGER BLOCKED
  as of 7 Sep 2026: the `collection_value_snapshots` cron is healthy —
  four active pg_cron jobs, `net._http_response` returning 200, and the
  table holding 4 consecutive days of rows for every user with no gaps.
  The date column is `snapshot_date`. Once about a month of history has
  accumulated this one can be built off real data.
- **Era Diversifier** needs per-card value, which is not stored.
- **Trade-Only Build** needs an acquisition method on each card.
- **Shop Challenge Champion** is a challenge-board feature, not a goal.
- **Language Passport** needs a cross-language card identity mapping.

## NEXT: pokenomics personality badges

Separate strand, deliberately untouched so far. Mike uploaded
`infinitepullsinvestorpersonalitybadges 1.pdf` on 6 Sep 2026 — investor
personality badges built on the pokenomics reference package — and asked
for it to wait until the collection goals were done.

⚠ That PDF was uploaded to a chat and is not in this repo. Put a copy in
the repo before restarting this strand, or it will need supplying again.

The pokenomics package itself (`pokemon_identification_master.zip`,
5 Sep 2026) carries the schema and rules these would build on.

## The thing to remember about the artwork

The badges are a medallion set — gunmetal, silver bevels, teal and violet
holo, a title banner. They read well at 128px and turn to mush at 64px,
and at a glance all 25 share one silhouette with only the centre symbol
differing. So: never smaller than 84px, and the goal NAME always renders
as real text beside the badge. Never let the picture be the only thing
identifying a goal.
