// Supabase Edge Function: sync-clover-inventory
//
// Pulls the shop's real item list from Clover (name, price, stock count)
// and mirrors it into shop_inventory, which the public Shop page reads
// directly. Meant to run both on a daily schedule (see supabase/SETUP.md
// for wiring up Supabase Cron, same pattern as check-price-alerts) and
// on demand from the admin panel's "Sync Now" button.
//
// Required function secret (same one as clover-oauth-callback):
//   CLOVER_API_BASE   e.g. "https://api.clover.com"
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// A note on confidence: the items endpoint shape (GET
// /v3/merchants/{merchantId}/items?expand=itemStock) and Clover storing
// prices in cents are both standard, well-documented Clover behavior.
// The token-refresh call right below is a reasonable best guess at the
// shape Clover expects (their docs describe the token endpoint and its
// expiring tokens, but not the refresh call in the exact detail the
// initial exchange gets) — if a sync ever fails specifically with an
// expired-token error, that's the first place to double check against
// Clover's actual response.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const CLOVER_API_BASE = Deno.env.get("CLOVER_API_BASE") || "https://api.clover.com";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Supabase service role is not configured on this function" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: conn, error: connError } = await supabase
    .from("clover_connection")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (connError) return json({ error: `Could not load Clover connection: ${connError.message}` }, 500);
  if (!conn?.connected || !conn.access_token || !conn.merchant_id) {
    return json({ error: "Clover isn't connected yet — connect it from the admin panel first." }, 400);
  }

  let accessToken = conn.access_token;

  // Refresh the access token first if it's expired (or about to be) —
  // Clover's access tokens are short-lived by design.
  /* A MERCHANT TOKEN NEVER EXPIRES, AND THAT USED TO BREAK THIS.
   *
   * A token minted by the shop from their own Clover dashboard has no
   * expiry and no refresh token, so both columns are null. The old check
   * read a null expiry as 0 -- the epoch -- decided the token had expired
   * in 1970, went looking for a refresh token that was never going to be
   * there, and answered "Access token expired and there's no refresh
   * token on file". A perfectly good token, refused every single time.
   *
   * The presence of a refresh token is what says this is an OAuth
   * connection worth refreshing. Without one, the token is static and is
   * used exactly as it is. */
  const isMerchantToken = !conn.refresh_token;
  const expiresAt = conn.access_token_expires_at ? new Date(conn.access_token_expires_at).getTime() : 0;
  if (!isMerchantToken && Date.now() >= expiresAt - 60_000) {
    if (!conn.refresh_token) {
      return json({ error: "Access token expired and there's no refresh token on file — reconnect Clover from the admin panel." }, 400);
    }
    try {
      const refreshRes = await fetch(`${CLOVER_API_BASE}/oauth/v2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: conn.client_id,
          client_secret: conn.client_secret,
          refresh_token: conn.refresh_token,
        }),
      });
      if (!refreshRes.ok) {
        const detail = await refreshRes.text().catch(() => "");
        await supabase.from("clover_connection").update({
          last_sync_error: `Could not refresh Clover access — reconnect from the admin panel. (${refreshRes.status}: ${detail})`.slice(0, 500),
        }).eq("id", 1);
        return json({ error: "Could not refresh Clover access — reconnect from the admin panel." }, 502);
      }
      const refreshData = await refreshRes.json();
      accessToken = refreshData.access_token;
      await supabase.from("clover_connection").update({
        access_token: refreshData.access_token || accessToken,
        refresh_token: refreshData.refresh_token || conn.refresh_token,
        access_token_expires_at: refreshData.access_token_expiration
          ? new Date(refreshData.access_token_expiration * 1000).toISOString()
          : null,
      }).eq("id", 1);
    } catch (err) {
      return json({ error: `Could not reach Clover to refresh access: ${err?.message || err}` }, 502);
    }
  }

  let items = [];
  try {
    const itemsRes = await fetch(
      `${CLOVER_API_BASE}/v3/merchants/${encodeURIComponent(conn.merchant_id)}/items?expand=itemStock&limit=1000`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!itemsRes.ok) {
      const detail = await itemsRes.text().catch(() => "");
      await supabase.from("clover_connection").update({
        last_sync_error: `Clover returned ${itemsRes.status} when fetching inventory. ${detail}`.slice(0, 500),
      }).eq("id", 1);
      return json({ error: `Clover returned ${itemsRes.status} when fetching inventory.` }, 502);
    }
    const itemsData = await itemsRes.json();
    items = Array.isArray(itemsData?.elements) ? itemsData.elements : [];
  } catch (err) {
    return json({ error: `Could not reach Clover: ${err?.message || err}` }, 502);
  }

  // Clover stores prices in cents.
  const rows = items
    .filter((it) => it?.id && it?.name)
    .map((it) => ({
      clover_item_id: it.id,
      name: String(it.name).slice(0, 200),
      price: typeof it.price === "number" ? it.price / 100 : null,
      stock_count: typeof it.itemStock?.stockCount === "number" ? it.itemStock.stockCount : null,
      updated_at: new Date().toISOString(),
    }));

  let upserted = 0;
  if (rows.length) {
    const { error: upsertError } = await supabase
      .from("shop_inventory")
      .upsert(rows, { onConflict: "clover_item_id" });
    if (upsertError) return json({ error: `Could not save inventory: ${upsertError.message}` }, 500);
    upserted = rows.length;
  }

  // Anything that used to exist but wasn't in this sync (removed from
  // Clover entirely) shouldn't keep showing as in stock forever. Only
  // runs when this sync actually returned rows, so a one-off empty
  // response from Clover can't wipe out a previously-good list.
  if (rows.length) {
    const syncedIds = new Set(rows.map((r) => r.clover_item_id));
    const { data: existingRows } = await supabase.from("shop_inventory").select("id, clover_item_id");
    const staleIds = (existingRows || [])
      .filter((r) => !syncedIds.has(r.clover_item_id))
      .map((r) => r.id);
    if (staleIds.length) {
      await supabase.from("shop_inventory").delete().in("id", staleIds);
    }
  }

  await supabase.from("clover_connection").update({
    last_synced_at: new Date().toISOString(),
    last_sync_error: null,
  }).eq("id", 1);

  return json({ synced: upserted });
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
