# Editions — 1st Edition, Shadowless, Unlimited

Written 18 September 2026, at the end of a long night. Nothing is built.
This is the note so it can be picked up cold.

## The idea underneath it, which matters more than the feature

This app cannot price a PSA 10. It cannot price a Shadowless Charizard. It
cannot price a 1st Edition Lugia. Neither can any free price source — they
give one market figure per printing and stop.

What it CAN do is let somebody describe the exact card in their hand —
printing, edition, condition or grade, grading company, cert number — and
hand that description to the one place that genuinely knows what it is
worth: **completed sales on eBay**.

So every option added to the add flow is another word in that query. That
is the product. It gives a test for anything Jeff asks for from here:

> **Does it make the eBay sold search sharper, or the record truer?**

Yes, it earns its place. No, it is decoration.

A consequence worth acting on: the eBay button currently sits under the Add
button like a footnote. On this framing it is the answer, not an
afterthought, and its position could say so.

## What 1st Edition actually is

Not a series. There is no 2nd or 3rd edition.

English cards from 1999 to 2002 had their first print run stamped with a
small black "1st Edition" symbol on the left of the card, below the art.
When that run sold out they reprinted without the stamp — those are
**Unlimited**. Base Set has a third state, **Shadowless**: an early
Unlimited print missing the drop shadow behind the art window.

Per card it is basically: stamped, or not.

**It can never auto-populate.** The stamp is a property of the physical
card. No API knows which copy somebody is holding. All the app can do is
offer the right choices and let them pick — which is the whole ask.

## The rule, confirmed

From Bulbapedia: 1st Edition runs were produced for **every English set up
to and including Neo Destiny, EXCEPT Base Set 2**. Neo Destiny was the
last. **Shadowless was exclusive to English Base Set.**

Legendary Collection came after and has no 1st Edition, despite the era.

## The ten sets

Match on SET NAME, not set id. TCGdex's ids for this era could not be
confirmed — `g1` is in the card cache and there is no way from here to
tell whether it is Gym Heroes or Gym Challenge, and the cache strips set
names. A list of names is also a list a person can read and correct; a
list of ids is not.

    Base Set          -> 1st Edition / Shadowless / Unlimited
    Jungle            -> 1st Edition / Unlimited
    Fossil            -> 1st Edition / Unlimited
    Team Rocket       -> 1st Edition / Unlimited
    Gym Heroes        -> 1st Edition / Unlimited
    Gym Challenge     -> 1st Edition / Unlimited
    Neo Genesis       -> 1st Edition / Unlimited
    Neo Discovery     -> 1st Edition / Unlimited
    Neo Revelation    -> 1st Edition / Unlimited
    Neo Destiny       -> 1st Edition / Unlimited

Everything else: no edition step at all. Base Set 2 included — it is in the
era and it is the one exception.

Normalize before matching: lowercase, strip punctuation, so "Base Set" and
"base set" and "Base" all land.

## Where it has to appear — ALL of it, not some of it

The lesson of 18 September. A field is not done when it saves; it is done
when every door that edits that card offers it.

- [ ] The add flow (`conditionStepHtml` area) — both My Collection and
      Card Lookup get it free, they share the function
- [ ] The edit panel (`showHoldingEditor`) — the one that got missed with
      cert numbers and had to be fixed after
- [ ] Read it in `renderYourList` BASE_COLUMNS, or the List and Binder
      views will not see it
- [ ] Include it in `groupOwnedRows`' key, or two editions of one card
      stack together
- [ ] Put the word in `ebaySoldUrl` — this is the point of the feature
- [ ] Show it wherever condition shows: Your Copies, list rows, binder
      tiles, the feed, the public profile

## Store it in its own column, NOT in `variant`

`variant` is the printing, and pricing looks up
`card.pricing.tcgplayer[variant]` by exact key. Writing `1st-edition-holofoil`
into it for a card whose pricing only has `holofoil` means no key match and
no price at all.

Edition is orthogonal to finish — a card can be 1st Edition AND Holofoil.
So: a new nullable `edition` column on `user_cards`, same shape as the
`cert_number` migration. Optional, never required.

## Say the same thing we say about grades

Picking an edition mostly will NOT change the price shown, because the
source gives one figure. Out of 138 cards in the local cache, exactly TWO
had an edition split:

    Lugia, Neo Genesis 9/111    1st Ed Holofoil $1,079.79 / Unlimited $518.99
    Shining Charizard, Neo 107  Unlimited Holofoil $1,495

So the raw-value note needs a sibling: the figure is for the printing, not
the edition, and the sold listings below are the real picture. Same
sentence as slabs, one word changed.

## Also worth knowing

Only 2 of 138 cached cards carried an edition split from TCGplayer at all,
even though TCGplayer's own website splits Base Set into 1st Edition /
Shadowless / Unlimited. Base Set Charizard comes back with a single
`holofoil` price. So this feature cannot wait on the price source — that
is exactly why the set-name list exists.

---

# Still open, same night

- **Card Lookup** — the gold SCAN A CARD ring in the feed's bottom bar
  lands on `?page=lookup`, which is a second implementation of My
  Collection's search. Decision not made: leave it, or teach My Collection
  `?scan=1` and `?q=` and point all seven links there.
- **The CSV importer throws grades away.** It recognizes thirteen grading
  companies and then saves every graded card as one of five raw
  conditions. Its comment says "if we ever add grading" — grading exists
  now.
- ~~**The public profile does not read `cert_number`.**~~ DONE 18 Sep.
  `tools/build-collection-pages.mjs` now carries grade, cert with the
  grader's report, and whether the value is up or down since it was added.
- ~~**The feed's card back** shows dates and prices but not the cert.~~
  DONE 18 Sep. The back now has a THIS COPY panel: set and number, finish,
  grade, cert linked to the report, quantity, value now with the move since
  added, and the raw-Near-Mint note with sold listings. Shared post pages
  (`tools/build-post-pages.mjs`) carry the same.
- **The card story / note** is written on the back of a card in the feed
  and nothing in the app can read or edit it. The only field in the system
  that lives in one place.
- **Jeff's Facebook test** — whether he can see a Hyde-Bot post now that
  the Meta app is published.
- **Token data access expires around mid-December.** Both share buttons
  stop working when it does. Steps to re-issue are in the session.
- **PUT THE PRICE-SYNC WORKER BACK.** On 18 Sep the price history was found
  empty -- `supabase/card_price_history.sql` had a `delete ... where
  recorded_on < today` in it, which wiped every reading on each re-run (four
  runs, 244,074 rows). That line is removed and the file carries a block
  explaining why nothing like it goes back. To refill without waiting for
  Sunday, cron job 4 (`infinite-pulls-price-sync-worker`) was temporarily
  set to `*/2 * * * *`. **It must go back to `*/2 6-23 * * 0`** once
  `price_sync_state.running` is false:

      select cron.alter_job(4, schedule := '*/2 6-23 * * 0');

  Sanity check any time: `select count(*) from public.card_price_history;`
  If it is ever 0 again, somebody re-ran a file with a delete in it.


---

# Parked: a price overlay for Whatnot

Jeff asked, 18 September. Not started, and there is a good reason to think
twice before starting.

## What he described

People buy $2 cards, get them slabbed by a grading company nobody in the
hobby has heard of — or invent their own label — then run live Whatnot
auctions and sell them for $40 to $100 to buyers who cannot tell the
difference. He had heard of an app that sits on top of Whatnot and shows
the real market price for whatever card is being sold.

## It exists, and it costs five dollars a month

- **TCG Snipe** (tcgsnipe.com) — Chrome extension plus a Windows/Mac
  desktop app. Ctrl+Shift+S over a running stream, AI recognizes the card
  from the screenshot, shows TCGplayer price, eBay sold comps and PSA
  values. Works on Whatnot, TikTok and YouTube. $5/month, 10 free scans.
- **Card Index** — a Whatnot card scanner in the Chrome Web Store.
- **TCG Automate** (tcgautomate.com).

## How they actually work, which is the useful part

None of them talk to Whatnot. There is no public Whatnot API. They take a
picture of the screen and identify the card from the image.

That is the same thing scan-card already does. The catalogue, the price
lookup and the eBay sold-comp link are all built. The new part is only
"point it at a screen instead of at a card in your hand."

## The wall

**iOS does not let any app draw over another app.** Not a limitation to
work around -- Apple does not permit it. Android does, but Infinite Pulls
is a PWA, and a PWA cannot overlay other apps on any phone. A real
floating overlay means a separate native Android app, iPhone never.

Most people watch Whatnot on a phone. So the honest version for this app is
a Chrome extension for people watching on a computer: real, buildable,
and a smaller audience than the pitch suggests. Worth saying out loud
before anybody spends a weekend on it.

## The version that would actually be his

The price is not what protects the buyer. **The grader is.** A $2 card in a
"GEM MINT 10" slab from a company nobody recognizes is the whole scam, and
a price lookup only tells half of that story.

This app already knows the five graders that count — PSA, BGS, CGC, SGC,
TAG — in `GRADE_COMPANIES` and `GRADER_LINKS`, and those tables now live in
three places (components/collection.js, feed-next/feed.js, and both page
builders). A tool that reads a slab label and says *this is not one of the
five the hobby recognizes* is simpler than card recognition, nobody is
leading with it, and it is the thing that would stop somebody's mother
paying $80. That is a story Jeff can tell. A price overlay is a copy of a
$5/month extension.

Start there if this is ever picked up.
