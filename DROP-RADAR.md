# Drop Radar — researched, decided against, kept

**Decision, 6 September 2026: NO. Not built, not started.**

Revisit at roughly 1,000 users, and when it comes back it comes back as a
user-submission feature, not a scraper.

This file exists so the research does not have to happen twice. Everything
below was measured on 6 September 2026, not assumed.

## What it was going to be

A spec dated 4 September 2026 — *Infinite Pulls Drop Radar, Zero-Cost
Source Map* — proposed turning Infinite Pulls into the publisher of Pokemon
TCG drop news for $0/month. Three report types (confirmed release, retailer
listing detected, in stock online), twelve launch sources, a scheduled
collector every 15 minutes, and one-click admin approval before anything
published.

Its opening promise was that this would work *"without depending on user
submissions or paid data services."*

That promise is the reason the answer is no. See the last section.

## What the research found

Every URL below was actually fetched. The spec's own confidence ratings
turned out to be inverted: the sources it rated "Very high" are the ones
that are shut.

| Source | Spec rating | Reality |
|---|---|---|
| Pokemon TCG News | Very high | Incapsula bot wall |
| Pokemon Center | Very high | 403 |
| Costco | High | 403 — including on their robots.txt itself |
| ALDI Upcoming Finds | High | robots.txt disallows |
| Walmart | Medium-high | robots.txt disallows |
| Target search | High | robots.txt disallows `/s?` |
| GameStop | High | Page shell only; products render in JavaScript |
| r/PKMNTCGDeals | — | Blocked; and see Reddit below |
| Best Buy search | High | Worked — names, prices, availability |
| Dollar General | Medium-high | Worked — names and prices |
| PokeGuardian | — | Worked — headlines and dates |
| press.pokemon.com | Very high | Responded, but newest items read as 2024 |

Two cautions on the rows that worked. First, the test ran through a hosted
fetcher with a browser-like identity and a good IP reputation; a Cloudflare
Worker is a bare datacenter request and will do worse, not better. The
failures are solid — a 403 is a 403 — but the successes are an upper bound.

Second, a correction worth keeping: Target was initially recorded as
working, because the fetch used a path-form URL that slipped past the rule.
Their robots.txt disallows search. Individual product pages appear
permitted, which means Target could confirm stock on a product already
known, but cannot be used to discover a new one. That is a stock checker,
not a radar.

## The five stores that actually matter

The stores people want drop news about are Walmart, ALDI, Costco, Sam's
Club and Target. **Zero of the five are usable for discovery.**

| Store | Page | API |
|---|---|---|
| Walmart | robots.txt disallows | Affiliate API behind approval — unconfirmed, the only real maybe |
| ALDI | robots.txt disallows | None |
| Costco | 403 | None |
| Sam's Club | Blocks automated clients | Developer catalog API behind approval/membership |
| Target | Search disallowed; product pages likely permitted | None public |

This is not bad luck. Drop-alert traffic is precisely what those retailers
block, because bots clearing shelves is their problem too. The door was
closed on purpose.

And robots.txt is not an obstacle to route around. The spec's own rule says
do not bypass retailer controls. Honouring that takes four of its twelve
launch sources off the board before anything is written.

## APIs

There is no "Pokemon drop radar" API. There are three legitimate free ones
that cover parts, and two notable closures.

**Available**

- **Best Buy Developer API** — official, free key, Products API returns
  price and availability, joined with the Stores API for in-store
  availability. One retailer, through the front door. The single best find.
- **pokemontcg.io** — free, key optional. Sets with release dates, which
  automates the coming-soon calendar without touching pokemon.com at all.
- **eBay Browse API** — already wired here as `ebay-price`. New listings
  appearing for a product is an early signal not currently used.

**Closed**

- **TCGplayer** — *"We are no longer granting new API access at this
  time."* This one hurts: a sealed product entering TCGplayer's catalog is
  one of the earliest drop signals there is. Third-party mirrors resell the
  same data on free tiers of around 100 requests/day, but that means
  depending on somebody else's scrape.
- **Reddit** — free-tier access now requires approval under the
  Responsible Builder Policy (2–4 weeks, not guaranteed), and commercial
  use starts around $12,000/month. A shop's site is commercial. This figure
  came from a third-party summary rather than Reddit's own documentation,
  so verify before treating it as final — but plan for no.

## The volume, measured

Counted by hand from the live sites on 6 September 2026:

| Source | Articles | Over | Rate |
|---|---|---|---|
| PokeBeach | 15 | 11 days | 1.4/day |
| PokeGuardian | 13 | 51 days | 0.25/day |

Strip out tournament coverage and deck strategy, dedupe the overlap — both
ran Mega Greninja ex on 27 August, both ran 30th Celebration — and trade
press yields roughly **one drop-relevant item per day**.

Add set releases (1–2 a month) and Best Buy availability flips (bursty:
nothing for days, then several during a launch) and the honest figure is:

> **1–3 posts per day on average. Release weeks spike to 5–10. Quiet weeks
> are near silent. Around 80% of it is "Pokemon announced a thing" rather
> than "go to this store now."**

A feed that is mostly announcements, carrying no news about the five stores
the audience cares about, is not the product the spec was selling.

## What the Facebook pages actually are

Pages like facebook.com/Pokenotify01 are the benchmark, so it is worth
being clear about how they work: **people standing in stores.** Submissions,
DMs and photos from members. There is no API behind them.

Facebook itself is closed to us regardless. robots.txt disallows the page,
Graph API reading of a Page you do not own needs Page Public Content Access
(App Review, effectively never granted to a card shop), Page RSS died in
2015, and Meta litigates scrapers. Of everything in the spec this was the
only item carrying real legal exposure rather than difficulty. The
legitimate route is a relationship: those pages are run by people, and
asking to credit and link them costs a message.

## Why this comes back as user submissions

The spec set out to avoid depending on user submissions. That constraint is
the whole reason it cannot deliver what it promised — because submissions
are how this category of product actually works.

What Infinite Pulls will have that a Facebook page does not:

- a physical shop with regular customers
- an app those customers already hold accounts in
- an approval queue already built and in daily use for the gallery
- a badge mechanic already built, looking for reasons to fire

"Spotted a drop at the Belden Village Target" → Jeff approves it in the
panel he already knows → the reporter earns a badge. Local, real, the exact
content the audience wants, and nothing any API can sell you. Every
approved sighting is also a reason to open the app and a reason to walk
into the shop.

Automation then becomes the supporting cast rather than the engine: trade
press for announcements, the release calendar for what is coming, Best Buy
for online stock. Its job is to keep the feed alive on quiet days, which is
the real failure mode of a submission product.

**The trigger is roughly 1,000 users.** Below that there are not enough
people in enough stores for submissions to fill a feed, and a Drop Radar
that updates twice a week makes the whole app look abandoned — worse than
not having one.

## What to reuse when it comes back

- The data model in the original spec is sound and worth keeping: source,
  product title, canonical URL, SKU, price, previous and current
  availability, first seen, last checked, scope, source class, confidence,
  evidence excerpt, review status.
- Its publication rules are sound too, and matter more for submissions than
  for scraping: what evidence licenses what headline, "Checked [time]" on
  every item, a direct source link, online-stock items expiring after 2–4
  hours, advance-release stories living until their release date.
- Deduplicate by retailer + item number, then canonical URL, then a
  normalised title fingerprint.

## One thing to check before any of this restarts

Whatever this ends up riding on, confirm the pipeline works first. As of
4 September 2026 `snapshot-collection-value` had never been deployed and
`check-price-alerts` had never been scheduled — both reporting "succeeded"
daily while doing nothing, because pg_cron's success only means
`net.http_post` queued the request. On a news feed that failure mode is
silence that looks like there is simply no news.

## Method and limits

Sources were fetched live on 6 September 2026 and the article counts read
off the rendered pages. Retailer defences, robots.txt rules and free-tier
terms all change without notice, and some pages serve different
availability by account, ZIP code, cookies or membership. Re-run the fetches
before trusting any row above; treat this file as a record of what was true
on the day, not a standing fact.
