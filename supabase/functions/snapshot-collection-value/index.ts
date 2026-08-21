// Supabase Edge Function: snapshot-collection-value
//
// Meant to run once a day on a schedule (see supabase/SETUP.md — same
// Supabase Cron pattern already used for check-price-alerts), not
// triggered by a person. For every account that owns at least one
// card, this totals up their collection's current estimated market
// value (the same TCGdex pricing used everywhere else on the site)
// and saves one row for today in collection_value_snapshots.
//
// That's what lets the Portfolio view on the My Collection page show
// a real value-over-time chart and % change instead of just today's
// number — but there's no way to backfill what a collection was
// worth before this function started running. The chart only starts
// filling in from whatever day this gets deployed and scheduled.
//
// This function takes no input from the caller and only ever touches
// data already in the database, so it's safe to deploy with
// --no-verify-jwt (see SETUP.md) so Cron can call it directly.

import { createClient } from "npm:@supabase/supabase-js@2";

const TCGDEX_BASE = "https://api.tcgdex.net/v2/en";

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Supabase service role is not configured on this function" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: ownedRows, error: ownedError } = await supabase
    .from("user_cards")
    .select("user_id, card_id, variant, quantity");

  if (ownedError) return json({ error: `Could not load collections: ${ownedError.message}` }, 500);
  if (!ownedRows || !ownedRows.length) return json({ snapshotted: 0 });

  // One TCGdex fetch per unique card across every account being
  // snapshotted this run — a card owned by fifty different collectors
  // only gets fetched once, same batching pattern as check-price-alerts.
  const uniqueCardIds = [...new Set(ownedRows.map((r) => r.card_id))];
  const cardById = new Map();
  await Promise.all(uniqueCardIds.map(async (id) => {
    try {
      const res = await fetch(`${TCGDEX_BASE}/cards/${encodeURIComponent(id)}`);
      if (res.ok) cardById.set(id, await res.json());
    } catch {
      // That card's value just gets skipped below for everyone holding
      // it — one TCGdex hiccup shouldn't fail every account's snapshot.
    }
  }));

  function priceFor(cardId, variant) {
    const card = cardById.get(cardId);
    const entry = card?.pricing?.tcgplayer?.[variant];
    return typeof entry?.marketPrice === "number" ? entry.marketPrice : null;
  }

  const totalsByUser = new Map();
  for (const row of ownedRows) {
    const price = priceFor(row.card_id, row.variant);
    if (price === null) continue; // unpriced cards just don't contribute to the total
    const prior = totalsByUser.get(row.user_id) || 0;
    totalsByUser.set(row.user_id, prior + price * row.quantity);
  }

  const today = new Date().toISOString().slice(0, 10);
  const snapshotRows = [...totalsByUser.entries()].map(([user_id, total_value]) => ({
    user_id,
    snapshot_date: today,
    total_value,
  }));

  if (!snapshotRows.length) return json({ snapshotted: 0 });

  // Upserting on (user_id, snapshot_date) means re-running this on the
  // same day (a manual retry, or Cron firing twice) safely overwrites
  // today's number instead of erroring or duplicating rows.
  const { error: upsertError } = await supabase
    .from("collection_value_snapshots")
    .upsert(snapshotRows, { onConflict: "user_id,snapshot_date" });

  if (upsertError) return json({ error: `Could not save snapshots: ${upsertError.message}` }, 500);

  return json({ snapshotted: snapshotRows.length });
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
