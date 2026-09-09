# The shop, next — pricing, alerts and offers

Written 9 Sep 2026, from Jeff's own words. Nothing here is built yet.
Read this before starting any of it.

> Under $50 round up a buck or two. $50-$100 the same. $100 and up to the
> nearest $5. Ideally, I would like for price alerts to me when a card
> shifts up or down by $5. Just spit balling now, but a buy it now price
> and maybe some sort of make offer option would be amazing. It would need
> to be capped off at no more than 5% off asking price. The option for me
> to toggle this feature on and off for each item in the inventory would be
> best. I want people to feel like they can get a good deal with me, but
> not lose too much potential profits. Trading cards and collectibles
> markets go up and down daily like the stock market. So an alert for
> drastic market movements on things would be nice to adjust prices
> accordingly. But repricing the entire inventory daily or even weekly is
> unrealistic. So major fluctuation alerts is the key.

## What he actually asked for

Four things, and it is worth seeing that three of them are one thing.

1. **A rounding rule**, so a scanned card gets a shelf price without him
   thinking about it.
2. **An alert when a card he owns moves.**
3. **Buy It Now and Make Offer**, capped at 5% off, switchable per item.
4. **Alerts on drastic moves so he can reprice selectively** — because
   repricing everything weekly is not going to happen.

2 and 4 are the same feature. And 1 is that feature's twin: one turns a
market price into a shelf price at the counter, the other tells him when a
shelf price has drifted away from the market. Both are *"tell me what to
charge"*. Build the pricing rule once and both use it.

That reframe matters, because it means the alert is not really an alert. An
alert that only says "this moved" hands him a list of homework. What he is
asking for is **one tap to accept the new price**. The notification is the
delivery mechanism, not the feature.

---

## 1. The rounding rule

Turns a market price into a shelf price. Always rounds UP, never down.

| Market price | Rule | Example |
|---|---|---|
| under $100 | up to the next whole dollar, then add the markup | $12.30 → $13 → **$14** |
| $100 and over | up to the next $5 | $132.40 → **$135** |

**"A buck or two" is the one thing that has to be pinned down.** It is a
range, and a rule cannot be a range. Proposal: round up to the next whole
dollar and then add a **markup Jeff sets himself**, defaulting to $1. He
can move it to $0 or $2 in the admin panel and every future scan follows.
That way the vagueness becomes a knob instead of a guess.

He wrote "$50-$100 the same", so there is no separate band in the middle —
the rule is simply: under $100 one way, $100+ the other.

### The parts he did not mention, that will come up on day one

- **Cards with no market price at all.** About 6,000 of the 36,771 in the
  index have never carried one. The field stays blank and he types it.
  Never invent a price.
- **Cards worth pennies.** Rounding a 22¢ card up to $1.22 is not what any
  shop does with bulk. Needs a **floor** — the least he will put a single
  on the shelf for. He has a number for this in his head already; it just
  needs asking.
- The suggestion is always editable. It is a starting point on the screen,
  not a decision the app makes for him.

---

## 2. Big-move alerts

**Jeff's threshold as written — "up or down by $5" — will not work, and it
is worth showing him why rather than just changing it.**

- A $3 card cannot move $5. He would never hear about a card tripling.
- A $600 card moves $5 while you are looking at it. He would hear about it
  constantly, and stop reading them within a week.

An alert people stop reading is worse than no alert.

**Proposal: alert when a card moves by $5 or more AND 5% or more.** Both
have to be true.

| Card | Move | $5+ | 5%+ | Alert |
|---|---|---|---|---|
| $10 | +$5 | yes | yes (50%) | **yes** |
| $600 | +$5 | yes | no (0.8%) | no |
| $600 | +$60 | yes | yes (10%) | **yes** |
| $3 | +$2 | no | yes | no |

Both numbers become settings, so if he wants it chattier he turns them down
himself.

**Only cards he actually has in stock.** This is the part that makes it
useful instead of noise — the index has 36,771 cards and he owns a few
hundred. The alert is about his shelf, not the hobby.

### What the alert looks like

The same yellow banner already built for online orders, because he has seen
that one work and it does not need explaining twice. It opens a list:

    Charizard · Base Set 4/102
    You are asking $240      Market moved to $286      [Use $290]

The `[Use $290]` button is the whole point — it repricies the item in Clover
in one tap, running the same rounding rule from section 1. Anything he does
not tap stays exactly as it is.

**Machinery that already exists:** `card_price_history` and the price sync
are live and healthy. `check-price-alerts` exists in the repo but has never
been scheduled in `cron.job`, so no price alert has ever actually been sent
— that is customer-facing and separate, but the shape is a useful reference.
See `[[infinite-pulls-prices]]` notes before touching any of it.

---

## 3. Buy It Now and Make Offer

The biggest of the four, and the only one that touches money, so it goes
last.

Straightforward parts:

- A per-item **switch** on whether that item takes offers. He asked for
  this explicitly and he is right to.
- The floor is **95% of asking** by default.
- An accepted offer has to become a real checkout at the agreed price, and
  hold the card while the customer pays. Both already exist — the Clover
  Hosted Checkout we built takes a line-item price we control, and
  `shop_holds` already reserves stock for 15 minutes.

### The thing to decide before writing any of it

**If an offer auto-accepts at 95%, then within a week every offer will be
exactly 95%, and this is a 5% discount with extra clicking.** That may be
completely fine — he said he wants people to *feel* like they got a deal,
and feeling is a real product goal. But he should choose it on purpose
rather than discover it.

Three ways to go:

1. **Auto-accept at 95%.** Simplest. Honest about what it is: a 5% coupon
   that feels earned. Costs 5% on every item with the switch on.
2. **He reviews every offer.** Keeps the feeling, and he can take 97% when
   he feels like it. Costs him attention, and attention is the thing he
   said he does not have.
3. **Auto-accept above a floor he sets per item.** Same as 1 but the floor
   is his, not a constant — 97% on the hot card, 92% on the one that has
   been in the case since spring. Automatic, but not a blanket discount.

**Recommendation: 3, defaulting to 5%.** It does exactly what he asked,
keeps the feel, and does not hand every customer the same number.

One guard whichever way it goes: the floor must not be discoverable from
the page. If the browser knows the answer, someone will read it.

---

## The order to build it

1. **The rounding rule, and "Add to Clover".** Finishes the card scanner,
   which is his actual daily pain — he is typing cards into the Clover
   system by hand right now. Everything for it already exists.
2. **The scheduled inventory sync.** Fifteen minutes of work. Until it
   runs, the website shelf and the till disagree the moment he sells
   anything at the counter.
3. **Big-move alerts.** Needs 1 to exist, because the "use the new price"
   button is the rounding rule again.
4. **Offers.** After a decision on the three options above.

## What the scanner already has

Worth knowing before starting, so none of it gets rebuilt:

- `admin/scan-inventory-admin.js` — camera, Google Vision, number parsing,
  TCGdex lookup, pricing, and a review queue. All of it working. It uses
  `components/collection.js`, the same engine as the customer scanner, so
  there is no second copy to maintain.
- `supabase/functions/clover-add-item/index.ts` — creates the item in
  Clover, sets its stock, and mirrors it into `shop_inventory` so it shows
  on the shop page immediately. Complete.
- `supabase/scan_queue.sql` — the `shop_scan_queue` table behind the review
  list.

**It currently ends in a CSV download instead of adding to Clover, and its
own header explains why: when it was written in early September, every
Clover token this account could generate returned 401. That was fixed on
8 September — the merchant id was wrong (`89KBZESAGQP41`, not
`R9KBZ85AGQP41`). The file predicted this exact moment:**

> THE LAST STEP IS THE ONLY PART THAT CHANGES LATER. Every row lands in
> shop_scan_queue carrying what clover-add-item needs. When a token finally
> works, "Download sheet" becomes "Add to Clover" and the flow is scan,
> add, done. Nothing above that line gets rewritten.

So step 1 is smaller than it looks.

### One thing the scanner does not handle yet

`clover-add-item` always creates a **new** item. Scanning a second copy of
a card already on the shelf will put a duplicate in his Clover inventory
rather than moving its stock from 1 to 2. For a shop that buys collections
in, that will happen constantly. Needs deciding: match on the SKU (the
TCGdex id is already used as one, and it is stable across reprints) and
bump the existing item instead.

## Open questions

For Jeff:

1. **The markup.** "A buck or two" — is the default $1 or $2?
2. **The bulk floor.** What is the least he puts a single on the shelf for?
3. **The alert rule.** $5 *and* 5%, both true?
4. **Offers.** Auto-accept at 95%, review each one, or a floor he sets per
   item?

For Mike:

5. Is the build order above the right one?
