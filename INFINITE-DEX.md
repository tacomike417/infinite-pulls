# Infinite Dex — the plan

Chunks 1 to 7 are done, plus the nav reshuffle and admin tabs. Only
the docs pass is left. This file is the plan, written down
first, so that a session that dies takes nothing with it.

## What it is

Infinite Pulls' customer rewards system. A customer does something — online
in the app, or in the shop — and gets a unique Infinite Pulls card in their
Infinite Dex. Collect enough of them and Jeff gives them a real reward at
the counter.

It is a set, not a punch card. Every card is its own creature with its own
name, its own art, and a collector number, and people will want to complete
it. That is the whole point, and every decision below serves it.

## The two ways a card is earned

**Automatic.** The app already knows the thing happened — they added their
first card, they hit ten. Nothing to type. The card just shows up.

**A code.** Jeff writes `GRANDOPENING` on a board in the shop. Customers who
turned up type it into their Dex and get the card. This is how anything in
the real world gets credited, because the app cannot see the shop.

Same card record either way; `award_type` says which.

## Two series, and why

`series = 'set'` is the numbered season — twelve cards for S26, fixed, so
the app can honestly say "5 / 12 collected".

`series = 'event'` is Jeff's in-store cards. Open-ended and unnumbered,
because he will invent a new one every time something happens in the shop
and a fixed denominator would be wrong by October. Event cards do not count
toward the season total.

The denominator is never stored. It is counted at read time, so adding a
thirteenth card cannot leave a stale "12" printed somewhere.

## The season — S26

| # | Code | Name | Task line | Flavor | Trigger | Art |
|---|---|---|---|---|---|---|
| 1 | `ACC-001` | The Initiate | ACCOUNT CREATED | Welcome, collector. | `account_created` | — |
| 2 | `COL-001` | The Collection Keeper | FIRST CARD ADDED | Your collection begins. | `first_card_added` | ✓ |
| 3 | `APP-001` | The Portal Opens | APP INSTALLED | Your journey is live. | `app_installed` | ✓ |
| 4 | `WSH-001` | The Wishfinder | FIRST WISH SAVED | The hunt begins. | `first_wish_saved` | ✓ |
| 5 | `SCN-001` | Snapsnout | FIRST CARD SCANNED | Found it! | `first_card_scanned` | ✓ |
| 6 | `COL-010` | The Tenfold Titan | 10 CARDS COLLECTED | Your vault is growing. | `cards_10` | ✓ |
| 7 | `COL-100` | The Hundredfold | 100 CARDS COLLECTED | The vault has awakened. | `cards_100` | ✓ gold |
| 8 | `PDX-050` | The Dexwarden | 50 POKÉMON DISCOVERED | The dex remembers. | `pokedex_50` | — |
| 9 | `GOL-001` | The Oathkeeper | FIRST GOAL COMPLETED | You said you would. | `first_goal_completed` | — |
| 10 | `SLD-001` | The Unbroken Seal | FIRST SEALED PRODUCT | Still shrink-wrapped. | `first_sealed_added` | — |
| 11 | `NTF-001` | The Signal | ALERTS TURNED ON | You'll know first. | `alerts_enabled` | — |
| 12 | `PRO-001` | The Herald | COLLECTION MADE PUBLIC | Now the world sees. | `collection_public` | — |

Plus `EVT-001` Grand Opening, code `GRANDOPENING`, September 12th. Seeded
**disabled** with no art, so chunk 2 and 3 have a real code card to build
against and no customer can claim a card that does not exist yet.

Six of thirteen have art. Seven to draw.

The code is `PREFIX-NNN`. The prefix is the feature area; the number is the
threshold. `COL-001`, `COL-010`, `COL-100` is one ladder, so a "50 cards
collected" card later is a row and nothing else.

## What the database can and cannot see

Nine of the twelve triggers are checked in SQL before a card is handed
over. Three cannot be, and it is worth being honest about which:

- `app_installed` — the browser knows it is running as an installed PWA.
  Nothing is written down anywhere.
- `first_card_scanned` — scanning happens entirely in the browser, by
  design. There is no scan log to count.
- `pokedex_50` — the Pokédex is derived live from National Dex numbers
  that `user_cards` does not store.

Those three are taken on the app's word. Someone determined can give
themselves three cards. They cannot give themselves the other nine, and
the discount is handed over by Jeff, who can see their Dex. That is the
right amount of security for a card shop.

`pokedex_50` is also the only trigger that costs a calculation, so check it
when the Pokédex page opens rather than on every app load.

**`PRO-001` has a wrinkle worth remembering.** `profiles.is_public`
defaults to *true* in `schema.sql`, so awarding on that flag alone would
hand the card to everybody at signup — the opposite of the point. It also
requires an avatar, i.e. a page actually worth looking at. If the art ends
up reading "PROFILE COMPLETED" rather than "COLLECTION MADE PUBLIC", this
is why.

## Art, and why the thumbnail is not optional

The art is 1060×1484 — a true 5:7 card — at about 3.2 MB a piece. Twelve of
those is 38 MB to open the Dex on a phone on shop wifi. So the upload writes
a small WebP alongside the original, the grid shows thumbnails, and the full
art loads only when a card is tapped.

Three lines at upload time, and a miserable afternoon later.

## The reward

Jeff sets a number of cards and writes what they get. "5 cards — 10% off a
pack." The app counts, shows progress, and tells them to give their username
at the counter.

He asks their username, finds them in the admin panel, gives them the
discount, and marks it redeemed. Redemptions have no update or delete
policy: a redemption is a record of something that happened in the real
world, and undoing one is a job for the Supabase dashboard, which is
exactly the amount of friction it deserves.

## The build order

Each chunk is one session, ends in something visible, and gets committed on
its own. Nothing here should ever be a large rewrite of an existing file.

1. ~~**Schema** — `supabase/infinite_dex.sql`.~~ **Done.** Four tables, three
   functions, a storage bucket, and the season seeded.
2. ~~**Jeff's card authoring** — an Infinite Dex section in `/admin/`.~~
   **Done.** `admin/infinite-dex-admin.js`, its own file, watching Supabase
   auth itself so `admin.js` needed no edit at all. Covered by
   `tools/test-dex-admin.mjs` (54 checks).
3. ~~**The customer Dex page.**~~ **Done.** `components/infinite-dex.js` +
   `components/infinite-dex-data.js`, reached from Menu → Infinite Dex
   (`?page=dex`). Covered by `tools/test-dex.mjs` (38 checks). Three-line
   edits to `app.js`, `navbar.js` and `index.html`; `collection.js` never
   opened.
4. ~~**Reward tiers** — Jeff sets the number and writes the reward.~~
   **Done.** An Infinite Dex Rewards section in `/admin/`, in the same file
   as the card authoring. No delete, same reasoning as the cards: a tier's
   redemptions are the record of what he has handed over. A tier set higher
   than the number of cards that exist is flagged *unreachable* rather than
   left to look broken.
5. ~~**Progress, customer side.**~~ **Done.** A line at the top of the Dex
   page — either "N more cards for X" or a gold callout naming the reward
   and their username — plus a Rewards list under the grids showing every
   tier's state. Crossing a tier fires a second toast behind the card's.
6. ~~**Redemption** — username lookup in admin, mark redeemed, stamped.~~
   **Done.** A Redeem a Reward section in `/admin/`, backed by
   `supabase/infinite_dex_redeem.sql`. Both halves are database functions
   rather than queries — see below.
7. ~~**The automatic triggers.**~~ **Done.** `supabase/infinite_dex_auto.sql`
   adds `dex_sweep()`, which checks all nine visible triggers in one call
   and hands over whatever is owed. The app calls it on load, on every
   route change and after a claim. The three blind ones are asserted
   separately — see below. One line each in `app.js`, `pokedex.js` and
   `collection.js`; nothing was rewritten.
8. **Docs and a test** — this file kept honest, plus a Playwright run in the
   shape of `tools/test-marketing.mjs`.
9. ~~**Nav reshuffle.**~~ **Done.** Infinite Dex took Events' place in the
   bottom bar — `∞`, five along. Events moved into the Menu list rather
   than out of the app. Also a card on the home screen.
10. ~~**Admin panel tabs.**~~ **Done.** `admin/admin-tabs.js`, a separate
    file that regroups the page at runtime — it moves the sections that are
    already there into panels and builds a strip above them. `admin.js` was
    not touched and `index.html` gained one script tag. Grouped by what he
    came to do: Today · Infinite Dex · Promote · Marketing · The Store. A
    section added later and not listed lands in the last tab rather than
    disappearing.

    Still to tidy whenever `admin.js` is next opened for another reason:
    `renderAttachments()` and `loadBrandFiles()` are dead now the attach
    box is gone. They cost nothing — `renderAttachments` returns before it
    fetches anything — so they were left rather than opening a 54 KB file
    to delete two functions.

**A QR code is the whole journey.** `?page=dex&code=GRANDOPENING` fills the
claim box in and claims it on arrival, so a QR on the board in the shop
means: point phone, card arrives. Signed-out visitors get the code held for
them with a nudge to make an account. Nothing surfaces that URL to Jeff yet
— worth adding to his card form.

**Card art generation is done** — an Infinite Dex Card builder sits beside
the poster builder under Marketing. Jeff types what goes on the card, picks
one of seven colour schemes taken off the cards that already exist, and it
writes the prompt. `supabase/marketing_dexcard.sql`, slug `dexcard` — a new
row and a bit of UI, never a schema change, exactly as `marketing.sql`
promised. Three example cards live in `brand-kit/` and the prompt links to
them, so ChatGPT matches the frame instead of guessing at it. The size is
stated as 1060 × 1484, measured off the real cards.

Card art generation was its own chunk after 3 — a new row in
`marketing_prompts` with its own slug, exactly as `MARKETING.md` describes.
Not a schema change.

**September 12th is the deadline that matters.** Chunks 1, 2 and 3 have to
be done and tested before then, because a code on a board in the shop with
nowhere to type it is worse than no card at all.

## Rules for whoever builds this

**New files, not edits to big ones.** `components/infinite-dex.js`,
`components/infinite-dex-data.js`. `components/collection.js` is 155 KB — a
feature added by rewriting a file that size is one enormous operation that
produces no output until it finishes, which is indistinguishable from a
hang. The only edits to existing files are a few lines in `navbar.js` and
`app.js`.

**An Infinite Dex card is not a Pokémon card.** It never touches
`user_cards`, never appears in My Collection, never counts toward portfolio
value. Separate track, separate page.

**Never insert into `user_dex_cards` from the app.** There is no insert
policy on it, on purpose. Everything goes through `award_dex_card(code)` or
`claim_dex_card(code)`, which check first. If the app could write there
directly, a customer could hand themselves the whole set from the browser
console, and the set is worth a real discount.

**Codes are public and that is fine.** `GRANDOPENING` is on a board;
someone will text it to a friend who never showed up. It is a card shop,
not a bank. `claim_dex_card` returns the same `invalid` for a wrong code
and a disabled one, so guessing tells you nothing — that is as far as it
goes, and far enough.

## The marketing trim

The prompt preview and the attach-the-brand-files checklist came out of the
Marketing section: the prompt fetches the brand files by URL itself, and he
does not need to read a prompt to trust a button he has watched work.
Marketing now ends at Send to ChatGPT / Copy the prompt.

Two consequences. `tools/test-marketing.mjs` now reads the built prompt off
the Send link's href rather than the preview, which is the thing that
actually carries it to ChatGPT and so the better assertion anyway. And the
"scan the QR code on the finished poster with your own phone" line lived in
that box and is gone — it belongs in the prompt template now, which is one
`update` on `marketing_prompts` whenever somebody wants it back.

## The numbering, and one thing to settle

The Grand Opening art came back reading `KNT-912 · S26 · 001/012` — which
puts it at slot 1 of the numbered season, not outside it. The database has
it the other way: `EVT-001`, series `event`, no number, with `ACC-001` The
Initiate at slot 1.

Both are defensible and it is a one-line fix either way. Either the art is
right and the Grand Opening card takes slot 1 (The Initiate moves, or goes),
or the printed number is decorative and the row stays as it is. Nothing
breaks while they disagree — the app reads the row, not the picture — but
somebody will notice.

## The wiggle

An earned card the visitor has not yet laid eyes on wiggles, with a NEW
badge alongside it for anybody who has animation turned off (the badge is
not decoration — `prefers-reduced-motion` kills the movement entirely and
the badge is all that is left).

**Only `.dex-tile` can ever wiggle**, and that class exists in exactly one
file. Nothing in My Collection, My Pokédex, search results or the binder is
touched by this.

"Seen" lives in `localStorage`, keyed by user id, and is a nicety rather
than a record — a cleared cache costs one extra wiggle, which is a fine
thing to get wrong. Everything on screen is marked seen about two and a
half seconds after it is drawn, without redrawing, so the wiggle carries on
for that visit and is simply gone the next. The same behaviour as an unread
badge, for the same reason.

**How long a card wiggles:** from the moment the grid is drawn until it is
tapped, or until the visitor leaves the Dex and comes back — whichever
happens first. Sitting on the page, it keeps going.

A backfill of more than three cards at once gets ONE toast with the number
on it rather than one toast each. Nine toasts 0.8s apart is seven seconds
of things sliding in and out and it stops being a pleasure around the
fourth; the wiggling grid says the rest.

On a first-ever visit that means everything they hold wiggles at once.
That is the honest answer and it makes opening the Dex for the first time
feel like something — but it is one line to limit it to arrivals only, if
it reads as noise.

## Two numbers, and why they differ

The season fraction ("5 of 12 collected") counts the numbered set only.
The rewards count EVERY card in the Dex, season and shop together — it is a
pile of cards, and somebody who turned up to the grand opening should not be
told that one does not count.

Both appear within a few centimetres of each other, so the reward line
always says which it means: "3 of 4 cards collected, season and shop
together". Do not quietly make them the same number; make the labels do the
work.

## How a card arrives without being asked for

`dex_sweep()` is one call, not nine. Nine round trips from a phone on shop
wifi every time somebody opens a page is not a thing to do; this does the
same work in one and returns only what changed, so the usual answer is an
empty array.

**A sweep never acts on NULL.** `dex_trigger_met` returns NULL for the
three the database cannot see, and the sweep skips those entirely. They are
asserted one at a time by the app through `award_dex_card()`:

| Trigger | Who says so | Where |
|---|---|---|
| `app_installed` | the browser | `display-mode: standalone`, plus the `appinstalled` event |
| `first_card_scanned` | the app | one line in `collection.js`, after a scan actually runs |
| `pokedex_50` | the app | one line in `pokedex.js`, where the count already exists |

Keeping those on a different code path from the swept nine is the point —
"the database decided" and "the browser said so" should never be the same
line of code.

The Pokédex threshold is read off the trigger key (`pokedex_50` → 50), not
written in the client, so a later "100 Pokémon" card is a database row and
nothing else.

**The scanner card fires when a scan runs, not when the OCR guesses right.**
Somebody whose card was misread still scanned a card, and withholding it
would teach them the wrong lesson.

## The counter, and who is allowed to stand at it

`dex_lookup_customer()` and `dex_redeem_reward()` are SECURITY DEFINER
functions, not queries, for two reasons.

**Row-level security.** The panel cannot read another person's
`user_dex_cards` at all — the policy allows a visitor their own rows plus
anyone whose profile is public. A customer who turned their public page off
would be invisible at the counter, which is exactly the customer most likely
to be annoyed about it. Widening that policy would expose every collection
to every signed-in visitor. The functions hand back four things and nothing
else: the name, the card count, the rewards, which are already paid.

**The count is re-checked at the moment of paying out**, inside
`dex_redeem_reward`, rather than trusting a number that has been sitting on
a screen for ten minutes.

### Closed — supabase/admin_lockdown.sql

**Confirmed as a live bug and fixed.** Every admin policy read
`to authenticated using (true)`, which means "signed in" — and a signed-in
CUSTOMER is also authenticated. Through the ordinary REST API, with the
public anon key and their own login, and without ever opening `/admin/`,
anyone with an account could:

- rewrite the banner every visitor sees
- change the shop's address and opening hours
- edit, disable or delete any Infinite Dex card
- **set a reward tier to "1 card — a free booster box"**
- rewrite the marketing prompts
- insert a redemption against somebody else's account

The reward tier is the one that costs money.

`admin_lockdown.sql` replaces all eight with a check against
`public.is_shop_staff()` — strict now, no "empty list means everyone".
Reading is untouched throughout, so the app still shows everybody the
banner, the hours and the cards. The file refuses to run at all if the
staff list would end up empty, so it cannot lock the shop out.

`admin/admin-guard.js` is the second lock and the lesser one: it tells a
customer who signs in at `/admin/` that the account is not staff, instead
of handing them a panel whose every button fails silently. It fails OPEN
when `is_shop_staff()` does not exist, so a project that has not run the
lockdown yet is left exactly as it was.

Deliberately left alone: everything already scoped to `auth.uid()`, and
`push_subscriptions`, whose endpoint URL is a secret token in its own right
and holds nothing personal.

### The wider problem this exposed

Every admin policy in this schema is `to authenticated using (true)` —
which means "signed in" and "staff" are the same thing, and a signed-in
*customer* is also authenticated. For a banner that is a fair trade. For a
function that decides who gets money off, it is not.

So the counter has an allowlist, `public.shop_staff`. **An empty table means
every signed-in user passes** — exactly today's behaviour, so nothing broke
when this shipped. Adding one row switches it to staff-only, permanently:

    insert into public.shop_staff (user_id, label)
    select id, email from auth.users where email = 'jeff@example.com';

The panel says which state it is in, at the bottom of the Redeem section.

This was never Infinite Dex's problem alone — it was the whole panel's,
and Infinite Dex was simply the first part of it worth real money. Fixed
above for every table, not just this feature's.

## Found along the way

`.admin-form{display:grid}` is an author rule, so it beat the browser's own
`[hidden]{display:none}` regardless of specificity — which meant every
admin form marked `hidden` was on screen anyway, Collector Goals' "New Goal
Template" form included. Fixed in `admin.css` with one line, which fixes
that section too.

## Open

- Seven cards still need art: `ACC-001`, `PDX-050`, `GOL-001`, `SLD-001`,
  `NTF-001`, `PRO-001`, `EVT-001`.
- Jeff's wording for the grand opening card.
- The first reward tier — how many cards, and what he gives.
- Infinite Dex is moving into the bottom nav — decided, not yet done. It
  ties the shop and the app together, which is the argument. The bar
  already holds six, so something gives up its place; that call comes with
  the reshuffle.
