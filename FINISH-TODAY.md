# Finish up — 7 September 2026

Everything below is already written into the repo and tested. What is left
is running it. Work top to bottom.

---

## 1. Wait for the artwork run to finish

Started 07:05, takes about three hours, so **around 10:05**.

```sql
select running, cards_done, rows_written, card_errors, finished_at
from price_sync_state where id = 1;
```

**Done when** `running` is false and `finished_at` has a time in it.
`cards_done` could be near 36,771.

Still going? `cards_done` climbs by ~400 every two minutes.

---

## 2. Put the cron schedule back — THE ONE THAT MATTERS

It is currently `*/2 * * * *` (every two minutes, every day). This puts it
back to Sunday mornings.

```sql
select cron.alter_job(
  (select jobid from cron.job where jobname = 'infinite-pulls-price-sync-worker'),
  schedule => '*/2 6-23 * * 0'
);
```

**Correct result:** one blank row. `cron.alter_job` returns void — blank
IS success.

**Check it took:**

```sql
select jobname, schedule, active from cron.job order by jobid;
```

Expect `infinite-pulls-price-sync-worker` at `*/2 6-23 * * 0`.

> Left widened it does NOT hammer TCGdex — sync-prices returns `idle`
> immediately when no run is in progress. It just wastes ~720 Edge
> Function invocations a day. Worth fixing, not an emergency.

---

## 3. Push everything and deploy the two Edge Functions

One block, paste it whole:

```bash
cd ~/Projects/tcg-sandbox && node tools/test/tcgdex-backoff.mjs && node tools/test/nav-empty-pages.mjs && node tools/test/price-trend.mjs && node tools/test/tier-rail.mjs && node tools/test/home-movers-rail.mjs && node tools/test/movers.mjs && git add -A && git commit -m "Hide empty menu pages, real arrow spans, and be a good TCGdex citizen" && git pull --rebase && git push && supabase functions deploy sync-prices --project-ref rrkyvcouxdmurwdyuugv --no-verify-jwt && supabase functions deploy snapshot-collection-value --project-ref rrkyvcouxdmurwdyuugv --no-verify-jwt
```

**Correct result:** `all passed` six times, the push goes through, then two
"Deployed Function" lines.

If a test fails it stops **before** committing. Nothing half-lands.

---

## 4. Hard refresh and look

**Cmd+Shift+R** on infinitepulls.com — the service worker is at v87.

- Home page signed in: Movers & Shakers, then **By price** with the
  bracket menu standing on the left
- Card art could be nearly complete now rather than ◈ placeholders
- Menu: **Events** and **Deals** gone, and gone from the home page's
  "At the shop" block too — they come back on their own the day Jeff
  posts something

---

## 5. The fake prices — Saturday or later, not before

The rows dated 2026-08-31 are what is making the boards show anything at
all right now. **Deleting them today empties both rails until the 12th.**

From Saturday they are superseded automatically (the real 5 September
readings are newer and win), so this is tidying, not a fix:

```sql
delete from card_price_history where recorded_on = date '2026-08-31';
```

Left alone entirely, the 30-day prune sweeps them on 1 October.

---

## What happens without you

- **Sat 12 Sep** — the 5 Sep readings turn seven days old. The candidate
  pool goes from ~60 cards to ~19,000 and every bracket fills.
- **Sun 13 Sep** — the weekly run writes fresh readings, and from then on
  every comparison is a true seven-day span, advancing one week every
  Sunday. Self-maintaining from there.

---

## Worth doing sometime

Drop TCGdex a line. They are a small open-source project handing us the
whole catalogue for free, and they now know us as
`InfinitePulls/1.0 (+https://infinitepulls.com)`. A note saying what the
traffic is and asking whether it is too much would land well — free APIs
almost never hear from anyone except to complain.
