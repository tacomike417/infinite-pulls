> **ON HOLD — 16 September 2026.** Paused while Mike talks to Jeff again.
> Do not build from the redemption section below until this block is
> removed: Jeff has moved twice since it was written.
>
> **Where the conversation actually landed:**
>
> - Free binder pulls are OUT. Jeff says monitoring somebody flipping
>   through a binder costs him more time than handing over a discount.
> - The reward is now **a Clover discount**, applied by Jeff tapping a
>   named discount button already sitting on his register. No barcode —
>   a scan looks up items, and a discount is not an item.
> - **Fixed dollar amounts, not percentages** — recommended, not yet
>   agreed. A percentage of an unbounded order means a 10% reward on a
>   $600 slab costs him sixty dollars. Jeff has not been told this yet
>   and it is the single most important thing to raise.
> - The app never talks to Clover. Four discounts get made by hand, once.
>   This also removes the bug where a $0 reward item would have appeared
>   for sale in the online shop.
> - Online orders stay fully automatic — we build that cart ourselves,
>   so the reward is a line we subtract before checkout. Jeff is not
>   involved at all on that path.
>
> **Unanswered, and blocking:**
>
> 1. Dollar amounts or percentages?
> 2. What are the four amounts, at 5 / 10 / 15 / 25 cards?
> 3. Does a saved discount actually apply cleanly on his register? Five
>    minute test: make `Infinite Dex $5`, open a test order, apply it,
>    confirm the total drops by exactly five dollars.
>
> **What is still true below**, and did not change: everything about how
> a reward is EARNED, the burn-on-reveal rule, the four screen states,
> the server-side timestamp being Jeff's whole check, and the decision to
> accept multiple accounts. Only the thing being handed over changed.

# Infinite Rewards — how a reward is redeemed

Written 15 September 2026, after Jeff said the in-store half of Infinite
Dex was too much for him to run. Read this alongside `INFINITE-DEX.md`,
which describes the card system underneath it. This file is only about
the moment a reward changes hands.

## The decision this file exists because of

**Jeff is out of the loop.** He asked to stop running rewards in the
store — codes written on a board, events he has to remember, a customer
looked up by username at the counter while a line builds. He forgot the
Grand Opening card and was upset about it, which is the whole argument in
one sentence: a system that depends on a busy shop owner remembering
something is a system that fails on the busy days.

So the app does all of it. Every card is earned by something the app can
see for itself, and the redemption is carried out by the customer on
their own phone.

**The prizes are free pulls from binders in the shop.** No discounts, no
register, nothing that touches Clover, nothing that takes money out of
the till. "Go over to the blue binder and pick a card." That is the whole
prize, and it is why the rules below can be as light as they are — the
worst possible cheat costs Jeff one common card.

## The one rule everything else follows from

**Revealing the reward IS claiming it.** There is no way to find out what
you won without burning it.

This is not a flourish. An earlier design had the customer show Jeff a
"you have earned a reward" screen and then tap Redeem afterward — and a
customer who simply never tapped could show that same screen every month
forever. The tap was voluntary, so it was worthless.

Making the reveal the record closes it completely: the only screen that
names a prize is a screen that has already been written down.

## The four states

### 1. Waiting

Does not say what the prize is. That is the point.

> **A reward is waiting.**
> You've collected 6 cards.
>
> `REVEAL MY REWARD`
>
> *Only tap this at the counter. It can only be used once, and it burns
> the second you tap it.*

### 2. Confirming

> **Are you standing at the counter?**
>
> The moment you confirm, your reward is revealed and marked collected.
> If you're not with Jeff right now, back out — you won't get another
> one.
>
> ☐ I'm at the counter and I understand this can only be used once.
>
> `Not yet`   `Reveal it`

The checkbox starts unticked and `Reveal it` does nothing until it is
ticked. Two deliberate actions, so nobody burns a reward with a thumb.

`Not yet` is the way out, and nothing is written when it is taken — every
screen needs a visible way out, and a confirm panel needs it most.

### 3. Revealed

> **THE BLUE BINDER**
> Go pick any card.
>
> Collected September 15 at 2:43 PM · **2 minutes ago**
> *Show this screen to Jeff.*

The relative line ticks — 2 minutes ago becomes 3, becomes 4. A
screenshot cannot do that, which is the cheapest possible defense against
somebody presenting a photograph of an old reward.

### 4. Spent

The same panel, grayed and struck through, and the relative line now
reads **3 weeks ago**. This is what the customer sees from then on,
forever. There is no other state to return to.

## Jeff's entire job

**Read the date. Does it say today?**

That is it. No lookup, no username, no typing, no button, nothing to
remember. If the screen says two minutes ago, they earned it just now
and are standing in front of him. If it says three weeks ago, they very
likely already took their pull.

He can still honor a stale one — it is his shop and his call — but he
knows, which he did not before.

**The timestamp comes from the server.** The app renders the stored
`redeemed_at` value, never a date computed on the phone, so changing the
clock on a handset does nothing at all.

## Why this is not "trust the customer"

It looks permissive and it is not, because the customer is not being
trusted with anything that matters:

- The record is written server-side the instant they confirm, with a
  unique constraint on (person, tier). **The database physically cannot
  record the same reward twice.**
- The customer never learns what they won until after it is written, so
  there is nothing to gain by stalling.
- Every redemption is already stored with who, which tier, and when.

What the customer controls is only *when* they burn it. If they burn it
in the parking lot, that is their loss and nobody else's.

## What this replaces

The old flow was: customer says their username out loud → Jeff types it
into the admin panel → finds their row → hands the prize over → taps
redeem. Four steps for him, at a counter, from a spoken username that
might have an underscore in it.

`dex_lookup_customer()` and `dex_redeem_reward()` still exist and still
work. They become the fallback for when something goes wrong, not the
everyday path.

## Multiple accounts: deliberately not defended against

Somebody can make several accounts and collect several rewards. **This is
an accepted trade, decided 15 September 2026.** A second account is a
second collection, more cards in the app, more posts in the feed. For a
prize that costs a common out of a binder, a farmed account that adds
real content to the site is a fair exchange, and defending against it
would cost honest customers friction they did not earn.

Do not add email normalization, device fingerprinting or signup gates to
this feature on anti-farming grounds without revisiting this paragraph
first.

## Open — decide before building

**Can Jeff undo a redemption?** Somebody will burn a reward by accident —
in the car, or handing their phone to a kid — and Jeff will want to give
it to them anyway, because he is Jeff. Right now he cannot:
`dex_reward_redemptions` has no update or delete policy on purpose, and
undoing one means opening the Supabase dashboard, which is not happening
at a counter on a Saturday.

The recommendation is a single "undo this" button in the admin panel that
logs who undid it and when. It turns the ledger from a pure record into
something he can edit, which is acceptable as long as it is his hand
doing it and the edit is itself recorded.

**Which binder goes with 6, 8 and 10 cards?** All three tiers currently
read "Prize to be decided." Nothing above works until Jeff names them.

**The counter QR, if it is ever needed.** A QR code taped to the register
that never changes, which has to be scanned before the reveal will fire.
It makes burning a reward anywhere but the counter impossible, and costs
Jeff one piece of tape, once. Deliberately held back from version one —
build it only if stale reveals turn out to be a real problem rather than
a theoretical one.

## Screen

Built for **phone, at 393px**, and made not to look broken on a desktop.
Phone wins wherever the two disagree. Decided 15 September 2026.
