# Infinite Pulls — what's left

Last updated 19 September 2026.

Ask Claude to pull this up and it will know where things stand. Nothing here
is on fire. The app works.

---

## Do this first (5 minutes)

**Put the price-sync worker back on its Sunday schedule.**

Job 4 (`infinite-pulls-price-sync-worker`) was temporarily set to run every
two minutes so the price history could be refilled. Check it finished, then
put it back:

```sql
select count(*) from public.card_price_history;
-- a full run writes about 57,000 rows. If it has stopped climbing:
select cron.alter_job(4, schedule := '*/2 6-23 * * 0');
```

If this is already done, delete this section.

---

## The one thing with a deadline

**Swap Hyde-Bot's Facebook token for a System User token.** ~20 minutes in
Meta Business Manager. Around **mid-December**.

The current token says "Expires: Never" in the Token Debugger and that is
true — but it is the wrong clock. Meta runs a separate **Data Access
Expiration**, about 90 days, on the *permission* rather than the token. When
that lapses the same never-expiring token starts getting refused and
Hyde-Bot quietly stops posting to Facebook and Instagram. Nothing errors
until it does.

A System User token, created in Business Manager, is built for long-running
services and does not carry that clock. It is a swap of the `FB_PAGE_TOKEN`
secret in Supabase — no code change.

Publishing the Meta app (the privacy policy work) fixed a *different*
problem: it is what made the posts visible to Jeff and to customers. That
stays fixed. It does not affect the 90-day clock.

---

## Real work, no rush

**The CSV importer throws grades away.** It recognizes thirteen grading
companies on the way in and then saves every card as one of five raw
conditions. Its own comment says "if we ever add grading" — grading exists
now, including cert numbers.

**Card Lookup is a second search screen.** The gold SCAN A CARD ring in the
feed's bottom bar lands on `?page=lookup`, which is a separate
implementation of the search already in My Collection. Decision never made:
kill it and point all seven links at My Collection, or teach My Collection
`?scan=1` and `?q=` and redirect. Mike parked this deliberately — he wanted
the app in his hand first.

**The card story can only be written in one place.** The note on the back of
a card in the feed is the only field in the system that cannot be read or
edited anywhere else. Breaks the "all doors look the same" rule.

---

## Parked ideas (spec'd, not started)

Both are written up in full in `EDITIONS-NEXT.md`:

**Editions picker** — 1st Edition / Shadowless / Unlimited. The price APIs
do not split editions (Base Set Charizard returns one `holofoil` price), so
this cannot wait on the price source. The point is letting somebody describe
the exact card in their hand and handing them a very good eBay sold search.

**A price overlay for Whatnot** — Jeff's idea, from people selling $2 cards
in no-name slabs at live auction. Tools like TCG Snipe already do this for
$5/month, as a Chrome extension. Worth knowing: iOS does not let any app
draw over another app, and this is a PWA, so a phone overlay is impossible
here. The version worth building is the *grader check*, not the price — this
app already knows the five graders that count.

---

## Traps — read before touching the database

**Never run a SQL file with a bare `delete` in it against this database.**

On 18 Sep the price history was found empty. `supabase/card_price_history.sql`
contained:

```sql
delete from public.card_price_history
where recorded_on < (now() at time zone 'utc')::date;
```

It deletes every reading not recorded today. It was written in May as a
one-time cleanup when the table held less than a day of junk, and the line
never came out — while the file stayed one that other scripts tell you to
re-run. It ran four times and deleted 244,074 rows: every price the weekly
sync had ever collected. Nothing errored, because deleting rows is not an
error. The only symptom was every card saying "no price was recorded back
then" while Card Lookup showed a live price a second later.

That line is now removed and the file carries a block explaining why nothing
like it goes back in. Pruning belongs in `prune_price_history()`, which is
scheduled and keeps thirty days.

**Sanity check, any time:**

```sql
select count(*) from public.card_price_history;
```

If that is ever 0, somebody re-ran a file with a delete in it.

---

## Done 18 Sep, so nobody re-does it

- The card back in the feed carries the card: set and number, finish, grade,
  cert linked to the grader's report, quantity, value now with the move
  since added, and the raw-Near-Mint note with sold listings.
- Shared post pages (`tools/build-post-pages.mjs`) carry the same. They used
  to be a picture, a name and a date — built for Facebook link previews and
  never given any card data.
- Public collection pages (`tools/build-collection-pages.mjs`) carry grade,
  cert with report link, and whether the value is up or down since added.
- The feed asked `card_price_history` for `variant = 'market'`. Nothing
  writes that — sync-prices writes the *printing* for TCGplayer and `trend`
  for Cardmarket. It matched zero rows on every card, forever. Fixed, with
  `tools/feed-price-test.mjs` guarding it (10 tests).
- A card opened from its own shared link asked the database for none of the
  new columns, so the certificate was missing on exactly the page people get
  sent to.
- `card_price_history` is now readable by signed-out visitors
  (`supabase/card_price_history_public.sql`). Market prices are public
  information; the policy gap was why the built pages had no values.
