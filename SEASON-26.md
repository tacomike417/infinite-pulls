# S26 — the twenty-five

Written 15 September 2026. The season Infinite Dex actually ships with,
after Jeff stepped out of the in-store half and the set grew from ten
cards to twenty-five. Read `INFINITE-DEX.md` for the machinery underneath
and `REWARDS-FLOW.md` for what happens when a reward is claimed.

## What changed and why

The old season was ten cards, six earned in the app and four earned in
the shop with a code Jeff wrote on a board. He asked to stop running that
half, so the four shop cards are gone and the set is rebuilt around
things the app can see for itself.

It also got **much more social**. The app is feed-first since v2.1, so
the season pulls people into the feed rather than into a spreadsheet:
nine of the twenty-five are earned by posting, commenting or being
hearted. That is deliberate. A reward system that only counts what you
own rewards the person who was already going to collect anyway.

**Rewards now land at 5, 10, 15 and 25 cards.**

## The pacing, and the one thing that creates it

Difficulty does not create duration. A determined collector adds a
hundred cards in one evening, so any card that is merely *hard* gets done
tonight. **Only the calendar cannot be rushed** — a card that needs
activity in eight different weeks takes eight weeks from anybody, at any
level of enthusiasm.

So the top of the set is a calendar spine, and it is what sets the 60-90
days. The other twenty-four cards do not extend it; the longest one does.

At the bottom the opposite is true. The first six are instant, so **the
5-card reward lands in the first session** — somebody gets a real prize
before they have finished setting up. That is the hook, and it is worth
protecting: do not make any of cards 1-6 harder.

| Reward | Lands around |
|---|---|
| 5 cards | first session |
| 10 cards | first week or two |
| 15 cards | about a month |
| 25 cards | 60-90 days |

The stretch from 15 to 25 is the long one, and it is mostly calendar. It
is also the part that needs the best prize, because it is the part people
have to keep coming back for.

## The twenty-five

`existing` means the trigger is already implemented in
`dex_trigger_met()`. `NEW` means one `when` branch has to be added — no
new tables, no new machinery, and `dex_sweep()` picks it up on its own.

### Starter — instant, first session

| # | Card | Earned by | Trigger | State |
|---|---|---|---|---|
| 1 | The Initiate | Account created | `account_created` | existing |
| 2 | The Collection Keeper | First card added | `first_card_added` | existing |
| 3 | The Portal Opens | App installed | `app_installed` | existing, app-asserted |
| 4 | The Wishfinder | First wish saved | `first_wish_saved` | existing |
| 5 | Snapsnout | First card scanned | `first_card_scanned` | existing — **can now be checked in SQL, see below** |
| 6 | The Tenfold Titan | 10 cards collected | `cards_10` | existing |

### Who you are — minutes, but deliberate

| # | Card | Earned by | Trigger | State |
|---|---|---|---|---|
| 7 | Infinite Original | Claimed the founding badge | `founder_badge` | NEW — `profiles.verified_at is not null` |
| 8 | The Face | Put a picture on your profile | `avatar_set` | NEW — `profiles.avatar_url is not null` |
| 9 | The Herald | Made your collection public | `collection_public` | existing, currently parked |

### Camera and scanner — the tools, used for real

| # | Card | Earned by | Trigger | State |
|---|---|---|---|---|
| 10 | First Light | Took your own photo of a card | `first_own_photo` | NEW — `card_photos` where `kind='mine'` |
| 11 | The Portrait Set | Five of your own photos | `own_photos_5` | NEW |
| 12 | Sharp Eye | Ten cards scanned | `scans_10` | NEW — `card_scans` |
| 13 | The Archivist | Twenty-five cards scanned | `scans_25` | NEW |

### The feed — nine of twenty-five, on purpose

| # | Card | Earned by | Trigger | State |
|---|---|---|---|---|
| 14 | First Word | Left your first comment | `first_comment` | NEW — `post_comments` |
| 15 | The Regular | Ten comments | `comments_10` | NEW |
| 16 | The Voice | Twenty-five comments | `comments_25` | NEW |
| 17 | Open Hearted | Hearted ten comments | `hearts_given_10` | NEW — `comment_hearts` |
| 18 | Well Received | Ten hearts on your own comments | `hearts_received_10` | NEW |
| 19 | The Showcase | Five photo posts | `posts_5` | NEW — `user_photos` |

### The collection — still counts, just not the whole story

| # | Card | Earned by | Trigger | State |
|---|---|---|---|---|
| 20 | The Quarter | Twenty-five cards | `cards_25` | NEW |
| 21 | The Half | Fifty cards | `cards_50` | NEW |
| 22 | The Cartographer | Cards from ten different sets | `sets_10` | NEW — `count(distinct set_name)` |

### The calendar spine — this is the 60-90 days

| # | Card | Earned by | Trigger | State |
|---|---|---|---|---|
| 23 | The Return | Added a card in four different weeks | `weeks_active_4` | NEW — `user_cards.added_at` |
| 24 | The Seasoned | Added a card in eight different weeks | `weeks_active_8` | NEW |
| 25 | The Ninety | Account ninety days old | `account_90_days` | NEW — `auth.users.created_at` |

## The chase series — nothing built gets thrown away

Six cards were parked on 3 September to make room for the in-store ones.
They are all still wired and still earn themselves, and rather than
deleting them they move to `series = 'chase'`.

**This is not a new mechanism.** The season fraction already counts only
`series = 'set'`, so a chase card shows in the Dex, is real, and has real
art, but does not sit between anybody and their 25-card reward.

That matters because of a rule this project already holds: *a badge with
no finish line does not ship.* Every one of the numbered twenty-five has
to be genuinely reachable by an ordinary customer in ninety days. A card
for a hundred posts is not that — but it is a perfectly good chase card.

| Card | Earned by | State |
|---|---|---|
| The Hundredfold | 100 cards collected | existing — **and it has art** |
| The Dexwarden | 50 Pokemon discovered | existing, app-asserted |
| The Unbroken Seal | First sealed product | existing |
| The Signal | Alerts turned on | existing |
| The Oathkeeper | First collector goal completed | existing — **blocked, see below** |
| The Chronicler | 100 photo posts | NEW |
| Grand Opening | Was there, 12 September 2026 | existing, needs art and switching on |

## What a "post" is, and why it is not what it looks like

In the feed a post is one of two things: a card somebody added, or a
photo they put up. Counting both would make "100 posts" mean "100 cards
added" — the collection track again, wearing a different label.

**So a post is a photo you chose to put up.** A `user_photos` row, or a
card you attached your own picture to. Scanning a card into a binder is
inventory; photographing it and writing a line about it is a post. Cards
19 and The Chronicler both count it that way.

## Prerequisites — things that have to happen first

### 1. `dex_sweep()` does not scale to twenty-five

It loops over every unearned auto card and runs a separate query for each
one, on page load and on every route change. At six cards that is
invisible. At twenty-five, a brand-new account fires twenty-five
subqueries every time somebody taps anything.

It has to become one set-based query, or be throttled to once a session.
Small fix, but it belongs in the same change as the new cards rather than
after them.

### 2. `first_card_scanned` can stop being a guess

It is currently one of three triggers the database is blind to, and the
app asserts it. That was correct when the Dex was built: `card_scans` did
not exist yet. **It exists now**, with a `user_id` and a `scanned_at` on
every row, so this trigger and the two new scan cards can all be checked
properly in SQL.

That leaves only two blind triggers — `app_installed` and `pokedex_50` —
which is the right number for a card shop.

### 3. Collector-goal cards need a column before they work

Five of the eight collector goals are **computed live and never written
down**. No `completed_at`, no row, nothing to detect — and a collection
that dips under a value threshold silently un-earns its badge.

So The Oathkeeper can only ever see the three *picked* goals until
`user_collector_goals` gains a column meaning "earned, and it stays
earned". `GOALS-NEXT.md` already names this and calls it a decision
rather than a task.

It is worth doing for its own sake: it is also the thing standing between
us and a toast when a badge lands, which currently passes in silence.
Until then, The Oathkeeper stays in the chase series where it blocks
nothing.

### 4. Followers cannot be counted

The follows model is "everybody follows everybody, and a row only records
an unfollow". There is no positive follower count to reward, and that
model is not worth changing for this.

### 5. Purchases cannot be tied to an account

`shop_holds` has no `user_id` — the schema comment says "no personal
data, ever". So "bought something from the shop" is not available as a
card without adding a column and wiring it through checkout. Probably the
most obvious card Jeff would ask for, so it is worth saying before he
asks.

## The reward tiers change

From 6 / 8 / 10 to **5 / 10 / 15 / 25**.

`cards_required` is unique and `dex_reward_redemptions` references
tiers, so tiers are never deleted. But **nothing has ever been redeemed**
— the reward half has been switched off since it was built — so the
existing three rows can be changed cleanly rather than disabled around.

All four still read "Prize to be decided". They are free pulls from
binders in the shop; Jeff names which binder goes with which tier.

## The real bottleneck is art, not code

Five of the twenty-five have finished art. **Twenty do not.**

Every trigger in this document is a few lines of SQL and none of them are
hard. Twenty pieces of card art is the actual project. The Dex Card
builder under Marketing writes the ChatGPT prompt and links the three
example cards so the frame matches — but it is still twenty rounds.

Worth deciding early whether the season ships all at once or in waves, 
because a card with no art is a gray rectangle in the grid and there is
no good way to hide it.
