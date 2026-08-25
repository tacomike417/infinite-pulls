# Infinite Dex — the plan

Chunks 1, 2 and 3 are done. The rest is not. This file is the plan, written down
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
4. **Reward tiers** — Jeff sets the number and writes the reward.
5. **Progress, customer side** — bar on the Dex page, and what they have
   unlocked.
6. **Redemption** — username lookup in admin, mark redeemed, stamped.
7. **The automatic triggers** — wire the app to `award_dex_card()`.
8. **Docs and a test** — this file kept honest, plus a Playwright run in the
   shape of `tools/test-marketing.mjs`.
9. **Admin panel tabs** — `/admin/` is now eleven sections on one scroll and
   Jeff meets all of it at once. Group it into tabs. Nothing about Infinite
   Dex depends on this, which is why it is last, but it is the difference
   between a panel he uses and one he avoids. Tidy up the dead
   `renderAttachments()`/`loadBrandFiles()` in `admin.js` in the same pass.

**A QR code is the whole journey.** `?page=dex&code=GRANDOPENING` fills the
claim box in and claims it on arrival, so a QR on the board in the shop
means: point phone, card arrives. Signed-out visitors get the code held for
them with a nudge to make an account. Nothing surfaces that URL to Jeff yet
— worth adding to his card form.

Card art generation is its own chunk after 3 — a new row in
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
- Whether Infinite Dex earns a place in the bottom nav. It is in the menu
  for now, because the bottom bar already holds six and a seventh crowds a
  phone.
