// Supabase Edge Function: sync-prices
//
// THE WEEKLY PRICE RUN. Walks all 36,771 cards in public.cards once a
// week, asks TCGdex what each one is worth today, and writes the answer
// into card_price_history. Thirty days of that is what every arrow, every
// "movers and shakers" list and every badge is eventually made of.
//
// WHY IT IS BATCHED
//
// 36,771 cards is 36,771 separate TCGdex requests -- the set endpoints
// carry no prices, so there is no bulk shortcut. That cannot happen in one
// invocation, and it should not happen in one burst either. So this
// function does a SLICE and stops, remembering where it got to in
// price_sync_state. Cron calls it again two minutes later and it carries
// on from the cursor. ~92 slices, about three hours, once a week.
//
// The cursor is a dataset_id and the walk is ordered by dataset_id, which
// means the run is resumable and idempotent: a slice that dies halfway
// simply gets redone, and a card priced twice on the same day overwrites
// its own row rather than making a second one.
//
// WHAT IT STORES, AND IN WHAT MONEY
//
//   tcgplayer   one row per printing ("normal", "reverse-holofoil", ...),
//               marketPrice, in USD.
//   cardmarket  one row, variant "trend", in EUR.
//
// NATIVE CURRENCY, ALWAYS. Cardmarket quotes euros and the app shows
// dollars, but the conversion happens at DISPLAY time and never here. If
// euros were converted before storage, next week's euro/dollar move would
// come back as a price change on a card that never moved -- a red arrow
// caused by a currency market. The `currency` column is what the row is
// in; converting is the reader's job.
//
// Cardmarket matters more than it looks: TCGplayer is null on every
// Japanese card. Verified on the live API, 5 Sep 2026 -- ja/M6-082 comes
// back with "tcgplayer": null and a full cardmarket object. Without the
// cardmarket row, 13,223 cards could never move at all.
//
// DEPLOY: supabase functions deploy sync-prices --no-verify-jwt
// (same as snapshot-collection-value -- it takes no user input and only
// writes public market data.)

import { createClient } from "npm:@supabase/supabase-js@2";

const TCGDEX_ROOT = "https://api.tcgdex.net/v2";

// One slice. 400 cards at a concurrency of 8 is about ten seconds of
// fetching -- comfortable inside the function's budget, and around three
// requests a second at TCGdex, which is polite for a job that is allowed
// to take all morning.
const DEFAULT_LIMIT = 400;
const CONCURRENCY = 8;

/* ------------------------------------------------------------------ *
 * The only part with real logic in it, kept pure so it can be tested
 * without a network or a database. tools/test/price-sync.mjs runs this
 * exact function, sliced out of this file.
 * ------------------------------------------------------------------ */
function priceRowsFor(card, cardId, today) {
  const rows = [];
  const pricing = (card && card.pricing) || {};

  // TCGplayer: one entry per printing, plus two housekeeping keys that
  // are NOT printings and must not become variants.
  const tp = pricing.tcgplayer || {};
  for (const key of Object.keys(tp)) {
    if (key === "updated" || key === "unit") continue;
    const amount = tp[key] && tp[key].marketPrice;
    if (typeof amount !== "number" || !isFinite(amount) || amount <= 0) continue;
    // `key` verbatim -- "normal", "reverse-holofoil". This is the same
    // string collection.js writes from a browser (priceTilesFor uses the
    // raw API key too), so both land on one history rather than starting
    // two that each fill half as fast.
    rows.push({
      card_id: cardId, variant: key, recorded_on: today,
      price: amount, currency: "USD", source: "tcgplayer",
    });
  }

  // Cardmarket: `trend` is Cardmarket's current trend price. Not `avg`,
  // which is a long-run average that barely moves and would make every
  // card look flat; not `avg7`/`avg30`, which were tried once and produced
  // a confident -46.2% on a Base Set Charizard that had not moved (see the
  // warning at the top of components/price-trend.js). We do our own maths
  // on our own readings; all we want from them is today's number.
  const cm = pricing.cardmarket;
  const usable = (v) => typeof v === "number" && isFinite(v) && v > 0;
  const trend = cm && usable(cm.trend) ? cm.trend
    : (cm && usable(cm["trend-holo"]) ? cm["trend-holo"] : null);
  if (trend !== null) {
    rows.push({
      card_id: cardId, variant: "trend", recorded_on: today,
      price: trend, currency: "EUR", source: "cardmarket",
    });
  }

  return rows;
}

/* Runs `worker` over `items` with at most `n` in flight. Promise.all over
   400 fetches at once would be rude to TCGdex and is the quickest way to
   get an IP rate-limited. */
async function pooled(items, n, worker) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const mine = i++;
      out[mine] = await worker(items[mine]);
    }
  }));
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Optional. Leave PRICE_SYNC_SECRET unset and this behaves like the
  // other scheduled functions here. Set it, and the cron job has to send
  // it -- worth doing eventually, since an open endpoint that makes 36,771
  // outbound requests is a nice thing for a stranger to find.
  const secret = Deno.env.get("PRICE_SYNC_SECRET");
  if (secret) {
    const sent = req.headers.get("x-price-sync-secret");
    if (sent !== secret) return json({ error: "Not authorised" }, 401);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Supabase service role is not configured on this function" }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const url = new URL(req.url);
  const startRequested = url.searchParams.get("start") === "1";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "", 10) || DEFAULT_LIMIT, 1), 1000);
  const today = new Date().toISOString().slice(0, 10);

  const { data: state, error: stateError } = await supabase
    .from("price_sync_state").select("*").eq("id", 1).maybeSingle();
  if (stateError) return json({ error: `Could not read sync state: ${stateError.message}` }, 500);

  /* ---- start of a run ---- */
  if (startRequested) {
    const { error } = await supabase.from("price_sync_state").upsert({
      id: 1, cursor: "", running: true, run_started_at: new Date().toISOString(),
      run_day: today, cards_done: 0, rows_written: 0, card_errors: 0, finished_at: null,
    });
    if (error) return json({ error: `Could not start the run: ${error.message}` }, 500);
    return json({ started: true, run_day: today });
  }

  // Not started, or already finished. This is the usual answer for most of
  // the cron firings on sync day and it costs one cheap read.
  if (!state || !state.running) return json({ idle: true });

  /* ---- one slice ---- */
  const { data: cards, error: cardsError } = await supabase
    .from("cards")
    .select("dataset_id, tcgdex_id, language")
    .gt("dataset_id", state.cursor || "")
    .order("dataset_id", { ascending: true })
    .limit(limit);
  if (cardsError) return json({ error: `Could not read cards: ${cardsError.message}` }, 500);

  if (!cards || !cards.length) {
    await supabase.from("price_sync_state").update({
      running: false, finished_at: new Date().toISOString(),
    }).eq("id", 1);
    return json({
      finished: true, run_day: state.run_day,
      cards_done: state.cards_done, rows_written: state.rows_written,
      card_errors: state.card_errors,
    });
  }

  let errors = 0;
  const results = await pooled(cards, CONCURRENCY, async (c) => {
    try {
      const res = await fetch(`${TCGDEX_ROOT}/${c.language}/cards/${encodeURIComponent(c.tcgdex_id)}`);
      if (!res.ok) { errors++; return []; }
      return priceRowsFor(await res.json(), c.tcgdex_id, today);
    } catch {
      // One card TCGdex would not serve is one card missing from this
      // week's history, not a failed run. It is counted and moved past --
      // next week it gets another go.
      errors++;
      return [];
    }
  });

  const rows = results.flat();
  if (rows.length) {
    // Same conflict target the browser uses. Re-running a slice, or the
    // whole day, overwrites rather than duplicating.
    const { error } = await supabase
      .from("card_price_history")
      .upsert(rows, { onConflict: "card_id,variant,source,recorded_on" });
    if (error) return json({ error: `Could not write prices: ${error.message}` }, 500);
  }

  // The cursor moves only after the write lands, so a crashed slice is
  // retried rather than skipped.
  const cursor = cards[cards.length - 1].dataset_id;
  await supabase.from("price_sync_state").update({
    cursor,
    cards_done: (state.cards_done || 0) + cards.length,
    rows_written: (state.rows_written || 0) + rows.length,
    card_errors: (state.card_errors || 0) + errors,
  }).eq("id", 1);

  return json({
    slice: cards.length, rows: rows.length, errors,
    cursor, cards_done: (state.cards_done || 0) + cards.length,
  });
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" },
  });
}
