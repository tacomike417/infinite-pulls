# Selling Jeff's cards on the site — the plan

_7 September 2026. Clover is a dead end; this replaces it._

## The workflow this is built around

Mike's words, and the spec: *"run in there, take pics of the 40 cards he
has set aside, put them on the site with pricing, boom, online for sale."*

Everything below is judged against that. If listing a card takes more than
about fifteen seconds on a phone, standing in the shop, it is wrong.

**No per-card setup anywhere.** No Stripe dashboard, no product objects
made by hand, no links to retire when something sells.

## Decisions already made

| | |
|---|---|
| Payments | Stripe Checkout. 2.9% + 30¢, no monthly fee |
| Fulfilment | Buyer picks: collect at the shop, or shipped |
| eBay / TCGplayer | No. Explicitly ruled out |
| Photos | REAL photos of the actual card, never TCGdex stock art |

### Why real photos, not the catalogue art we already have

Because a single is sold on its condition, and the buyer is paying for
*that* copy. Stock art on a listing for a specific physical card is the
kind of thing that turns into an "item not as described" chargeback, and
on card singles that dispute is unwinnable — condition is a judgement
call and the seller loses. The photo IS the description.

The catalogue art stays where it belongs: the price rails and the lookup.

## The one failure that really hurts

**Two people buying the same Charizard.** Every listing is quantity one,
so this has to be impossible rather than unlikely. Four states:

```
draft ──▶ live ──▶ held ──▶ sold
             ▲        │
             └────────┘   hold expires, back on sale
```

`held` is taken the moment somebody opens Checkout, by a conditional
update that only succeeds if the card was still buyable. Two shoppers, one
card: the second gets told, before they reach a payment form, that it just
went. The webhook turns `held` into `sold` when Stripe confirms payment,
and an abandoned checkout expires back to `live` on its own.

The guarantee is the conditional update, not the honesty of the app.

## What gets built, in order

1. **`supabase/shop_listings.sql`** — the table, the RLS, and
   `claim_listing()`, which is where the sold-once guarantee lives.
2. **Admin "Sell" screen** — photo, price, condition, publish. Phone
   first, built for doing forty in a row. The price PREFILLS from the
   market price already in `card_price_history`, and Jeff can override it.
3. **Public store page** — the cards, their photos, their prices.
4. **`create-checkout-session`** Edge Function — takes the hold, then
   hands off to Stripe.
5. **`stripe-webhook`** Edge Function — marks sold, releases expired
   holds. This is the only thing that may write `sold`.

Steps 1–3 work with no Stripe account at all: cards list as **Ask in
store**. Steps 4–5 switch payments on later without relisting anything.

## What only Jeff can do

- **Open the Stripe account.** The money lands in his bank, so it is his
  signup. ~15 minutes. This is the real critical path — start it first.
- **Decide shipping.** A flat rate is simplest; whatever it is, it has to
  cover a tracked, rigid mailer on a card that might be worth $900.
- **Decide the hold window** for a shop pickup. 48 hours is the default
  below.

## Deliberately NOT stored

Buyer names, addresses, emails, or anything about their card. Stripe holds
all of it and is built to. This database keeps a session id and a status,
which is everything the shop needs and nothing it would have to protect.

The same line the Customers tab drew, drawn again.

## Sales tax

Out of scope for the build and NOT out of scope for Jeff. Shipping to
another state can create an obligation there, and Stripe Tax can handle
the calculation if it turns out he needs it. Worth ten minutes with
whoever does his books before the first out-of-state sale, not after.
