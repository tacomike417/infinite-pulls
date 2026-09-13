# The feed — your collection as the content

Written 13 Sep 2026, from a conversation with Mike. **Nothing here is built.**
Read this before starting any of it. The mockup it describes is beside this
file as `FEED-MOCKUP.png`.

> "basically it runs like instagram, comments, yadda yadda, but what we want is
> the collection to become the content of the feed. and it hinges on this: when
> people take a pic of a card for valuation, that becomes the pic in the feed.
> and we want it to have a glamour photo feel to it, not some shitty pics like
> I was doing the other day under his fluorescent lights in the store."

That last sentence is the product. Not an app that *stores* your collection —
an app that makes your collection **look like something**. None of the other
collector apps Jeff uses do that, and it is the reason to build this at all.

---

## The shape of it

A vertical feed of posts, phone-first, dark with the blue/gold glow in the
mockup. Each post is one card.

- **Scroll up and down** — the feed.
- **Swipe left and right inside a post** — that person's own pictures of it.
  Selfies, the pack it came out of, whatever. The card is slide one.
- **Tap the card** — it flips to its history.

**Two names in the mockup are placeholders and Mike has rejected both.**
"Living Binder" and "Card Passport" were ChatGPT filler. The strip under the
post is the card's stats — price, condition, status. Call it that. The feed is
the feed.

## Decided

- **The feed is everyone's cards**, not just people you follow. Following can
  arrive later as a filter. At this user count a following-only feed would be
  empty, and an empty feed reads as abandoned.
- **When it runs out, it shows the shop's cards that are for sale.** Those
  already carry catalogue art, so the filler is clean by default and sits on
  the same backdrop as everything else. Nobody can tell where the feed stops
  and the shop starts, which is the idea.
- **HYPE, comment, share, wishlist** as the action row. HYPE is a like with a
  better name and it fits the vocabulary already settled on.
- **An optional note per card** — "pulled at Infinite Pulls", "bought off Danny
  at the show". One text field. This is the line that makes it a scrapbook
  rather than a spreadsheet.
- **People control their own posts**, deletion included, and the way out is
  visible before they post rather than after.
- **No video.** Deliberate, and the single biggest reason the running costs
  stay near zero. Images only.
- **Mobile look becomes the default.** See the open question about the toggle.

## Build order — the feed ships before the camera does

> "there are enough shop cards, my cards, etc to fill it up for now... we'll
> just use those images at first"

This matters more than it sounds. **The catalogue art already in the database
is clean, square and correctly lit.** It needs no straightening, no background
removal and no colour correction — it can be composed straight onto the
branded backdrop.

So:

- **Phase one: the feed, staged catalogue art.** Shop listings, everyone's
  collections, Jeff's tutorial posts. Looks exactly like the mockup. None of
  the camera work below has to exist.
- **Phase two: photographs of actual cards** through the pipeline below.

The point of splitting it this way is that the hard part stops being
load-bearing. If de-skewing and glare turn out fiddlier than they look, the
feed is already up and already looks right — phase two upgrades it rather than
unblocking it.

## The glamour pipeline

What makes a card photo look cheap is mostly geometry, not light.

1. **Find the card and straighten it.** A card is always 2.5 x 3.5, so its
   corners can be found and warped to a perfect rectangle. That also gives an
   exact mask of where the card is.
2. **Throw the background away.** The counter, the clutter, Jeff's strip
   lights — gone. Drop the card onto one fixed branded backdrop, made once.
3. **Re-apply a consistent tilt and shadow.** Having straightened it, stage it
   again at the *same* angle every time. Two hundred cards at an identical
   angle on an identical mat is what the eye reads as "professionally shot".
   Consistency is worth more than perfecting any single photo.
4. **Correct the colour.** The card border is a known reference, so the
   fluorescent cast can be measured and removed. Dividing by a blurred copy of
   the image flattens uneven lighting while keeping the detail.

**What cannot be done:** a blown-out glare streak on a holo has no information
left under it, and shimmer the camera never caught cannot be invented.
Multi-frame capture (two or three frames while the phone moves, keeping the
darkest unblown pixel) would mitigate it, but that is a real build and should
be last if at all.

**So the real answer to "no more shitty pics" is not processing — it is
refusing a bad photo at the moment of capture.** Same move as the oversized
video check in the trip apps: check it while the person is still holding the
card. Is it square enough in frame, sharp enough, not blown out? If not, say
so there and then. A card-shaped guide on the camera screen does most of this
by itself, because people line it up and instinctively tilt away from the
light.

**And there is a safety net already owned:** the app identifies the card, so it
has the catalogue picture. When someone's own photo will not come good, offer
that on the same backdrop. Their post still looks right. Their own photo stays
the default, because that is the whole point, but nobody is ever stuck with a
bad one.

**Two staging templates will be needed** — a slab stands up, a raw card lies
flat. One lighting style, two arrangements.

## What already exists (do not rebuild it)

- Price per card, and **`card_price_history` has been filling since the price
  work**. The "look back in a year" view is a query against data already
  accruing, not something to start collecting.
- Nightly `collection_value_snapshots`, healthy since 7 Sep.
- `user_cards.added_at` on every card.
- Collector Goals, with live progress calculation.
- The scanner, the lookup, sold listings, card details.
- **The Thunkagram** — the swipeable media frame from Our Trip and the food
  truck page. Photos and videos, dots along the bottom, videos that pause when
  scrolled away. The "1 / 5" and the dots in the mockup are literally what it
  already draws. Reuse it.

## What is new

- Follows, comments and HYPE. Three tables and their policies. Routine.
- The feed query, and the shop-inventory fallback.
- The staging pipeline and the capture gate.
- Image storage on R2 (see below).
- **A written record of goal progress** — see the catch below.

## The catch that unlocks three features at once

Goal progress is worked out live, on the spot. It knows where you are today;
it has no memory of where you were on Tuesday. That blocks three things:

- "This card pushed you 2% closer to Set Complete" — needs the before and after.
- Badges beside every username in the feed — recomputing every author's whole
  collection on every scroll is not viable.
- A timeline of when each goal actually moved.

**All three are the same missing piece: progress is never written down.** Store
it at the moment it changes and all three become possible. One change, three
features. Do this before the feed, not after.

Attribution reads best on goals with a finish line — Set Complete, Master Set,
Regional Pokedex, Value Milestone. Open-ended goals have no percentage to move.

## Flags raised, and what to do about them

**"2 collectors nearby need this" is a privacy decision, not a feature.** To
say *nearby* you must know where people are and tell others roughly where they
are. The Customers tab deliberately stopped short of contact details; this goes
further. Drop the word and almost nothing is lost: **"2 collectors want this"**
is just as motivating, needs no location at all, and wishlists already exist.

**The badge art will not survive at that size.** The 25 medallions are readable
at 128px and mush at 64px — which is why goals always show the name as text
beside them. The mockup has them at roughly 44px with the words *inside*. On a
real phone they will be two grey smudges. Either a simplified small version is
made, or in the feed they become a name and a colour.

**A feed needs feeding.** Jeff has around a hundred Facebook followers. An
empty Instagram looks worse than no Instagram. **Answered 13 Sep — see Day one
below.**

**Do not put a "make it beautiful" step on the lookup screen.** Card Lookup
exists because those guys need a price NOW, mid-negotiation. Keep the lookup
instant and do the staging quietly afterwards, then offer it: *"nice card —
want to put it on your page?"* The price arrives in two seconds and the feed
gets fed as a side effect.

**Force one aspect ratio across every slide of a carousel.** What makes a
carousel feel cheap is the frame resizing as you swipe. Keep the box identical
and a candid selfie sits next to a studio card perfectly happily.

**The gesture is the fiddly bit.** Vertical scroll for the feed and horizontal
swipe inside each post, in the same square of screen. The dominant axis has to
be decided in the first few pixels of movement and then locked, or the page
jitters diagonally. Solvable, but it needs care — it is the difference between
feeling like an app and feeling like a website. The Thunkagram has not faced
this yet because on the trip page it does not sit inside a vertical feed.

## What it costs (checked 13 Sep 2026)

Today: **$25/month**, Supabase Pro. The site is on GitHub Pages, which is free.

A staged feed image is about **300KB**, plus a 40KB thumbnail — call it 350KB
a card. WebP instead of JPEG roughly halves that.

**Storage is a non-issue.** Pro includes 100GB of file storage, which is about
**300,000 cards** before paying anything. A million cards would be about
$5/month.

**Bandwidth is the cost that matters.** Pro includes 250GB out per month, then
$0.09/GB. Someone scrolling a hundred posts pulls about 30MB.

| Daily users | Images out per month | On Supabase Storage | On Cloudflare R2 |
|---|---|---|---|
| 50 | ~45 GB | included | ~$1 |
| 250 | ~225 GB | included | ~$2 |
| 1,000 | ~900 GB | ~$83/mo | ~$5 |
| 10,000 | ~9 TB | ~$810/mo | ~$5 |

**DECIDED: card images go to Cloudflare R2.** Storage is $0.015/GB and egress
is free at any volume. This is an either/or, not additive — R2 simply does not
bill for data going out.

**No migration.** The gallery photos and shop listing images stay in Supabase
Storage where they already work; only *new* feed images go to R2. Two buckets,
two jobs, nothing to break. This is why it is worth setting up before launch:
trivial with zero images in the bucket, a migration with a hundred thousand.

What it involves: an R2 bucket, `images.infinitepulls.com` pointed at it (the
domain's DNS on Cloudflare while GitHub Pages carries on serving the site), and
a small function handing the phone a one-time upload link so nothing sensitive
is ever in the page. Roughly a day. Independent of the feed, so it does not
block the design work.

Three things that matter more than they sound:

- **Generate the thumbnail.** A collection grid loading full-size images is
  seven times the bandwidth for pictures nobody is looking at properly.
- **Do not keep originals.** Staged image and thumbnail only — the original is
  still on their phone. Keeping originals triples everything for a file nobody
  ever sees.
- **Cache hard.** These images never change once made, so most views never
  touch storage at all — which is also what keeps R2's read charges inside the
  free tier.

At 10,000 daily users the *database* would want a bigger engine, roughly
$60-100/month. That is a cost that grows gently and can be seen coming.
Bandwidth is the one that explodes, and R2 removes it.

## Day one — Jeff is Tom

> "day one, i want a pic of jeff in there, and he will be encouraging you to
> add your first card, almost like a tutorial meme, also jeff is your first
> friend, like how Tom was on MySpace"

Mike is supplying the photos. This answers the empty-feed problem for a new
account, and the shop-inventory fallback answers it for the feed overall.

- **Jeff is already your friend when you arrive.** Follower count is never
  zero, the feed is never an empty room, and the first HYPE somebody taps
  teaches them the gesture on a post that cannot be embarrassed by it.
- **His posts are the tutorial.** A picture of Jeff with a line encouraging the
  next thing — add your first card, pick a goal, have a look at the shop.
  Onboarding inside the feed, so no separate tutorial screen has to exist or
  be maintained.
- **They are CONDITIONAL and they retire themselves.** Which post shows depends
  on where the person actually is: no cards yet, one card, no goal picked. A
  post still saying "add your first card" to somebody with two hundred is the
  app not paying attention. This is the part that needs building — the photos
  are the easy half.
- **He can be unfollowed.** Tom was removable eventually and it mattered.
  Almost nobody will, but an account you are locked into reads as a trick
  rather than a welcome.

**The caveat worth keeping in view: seeded posts get you through day one, not
week three.** If Jeff never posts a real pull the feed still empties out. The
machinery for him posting easily already exists — the Jeff Hyde persona, the
10-second rule, picking from generated options rather than writing. His posts
want to land in the feed, not only in the gallery.

**Voice rules apply to these posts like any other:** inclusive, funny,
self-deprecating, the shop is the butt of the joke and never the hobby or the
collector. Mike writes them, not Jeff — no free-text tone input.

## Settled since first draft

- **The look is decided by screen width, not by a setting.** Mike on the
  toggle: *"not married to it"*. So: this look on phones, the current look on
  desktop. One codebase deciding, nothing a person can get stuck inside, and
  no second front end to keep in step. It also matches how they are genuinely
  used — collectors on phones, Jeff on the counter machine. An escape hatch
  can be added later if anyone actually asks for one.

## Still open

**Do you ask what they paid?** Without it, the card's value since the day they
added it — real, useful, no typing. With it, whether they are up or down, which
is what "investment" means to them, but a number to enter on every card that
plenty will skip. If it is built: optional, and the display adapts — paid price
known, show the gain; not known, show the value line.

**Where the personal pictures are asked for.** After the price, not before.

---

*One boundary worth keeping: showing someone their own numbers is useful. An
app that starts telling people when to sell is a different product with
different responsibilities attached. Keep it firmly on the "here is what
happened" side of that line.*
