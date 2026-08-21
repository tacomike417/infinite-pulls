// Supabase Edge Function: clover-add-item
//
// Called from the admin panel's "Bulk Add Inventory (Snap a Pic)" card.
// An admin snaps a photo of a card (same OCR flow as the customer-facing
// "Scan a Card" feature), taps the right match, sets a price and stock
// count, and this function creates that as a real item directly in the
// shop's live Clover inventory — no manual re-typing into Clover itself.
//
// Required function secret (same one as clover-oauth-callback and
// sync-clover-inventory):
//   CLOVER_API_BASE   e.g. "https://api.clover.com"
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// Requires the Clover app's Requested Permissions to include
// Inventory -> Write, not just Read (Read is all sync-clover-inventory
// ever needed). If that permission isn't checked in the Clover Developer
// Dashboard, Clover will reject the create call with a 403 — the error
// message below is written to make that specific case recognizable.
//
// A note on confidence: item creation (POST /v3/merchants/{mId}/items
// with name + price in cents) and setting stock (POST
// /v3/merchants/{mId}/item_stocks/{itemId} with { quantity }) are both
// taken directly from Clover's own current developer docs, not guessed.
// Everything else here (token refresh, error shapes) follows the same
// pattern already proven out in sync-clover-inventory.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const name = String(payload?.name || "").trim().slice(0, 200);
  const price = Number(payload?.price);
  const stockCount = Number.isFinite(Number(payload?.stock_count)) ? Math.max(0, Math.round(Number(payload.stock_count))) : 0;

  if (!name) return json({ error: "Missing item name" }, 400);
  if (!Number.isFinite(price) || price < 0) return json({ error: "Missing or invalid price" }, 400);

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

  // Refresh the access token first if it's expired (or about to be) — same
  // approach as sync-clover-inventory.
  const expiresAt = conn.access_token_expires_at ? new Date(conn.access_token_expires_at).getTime() : 0;
  if (Date.now() >= expiresAt - 60_000) {
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
        return json({ error: `Could not refresh Clover access — reconnect from the admin panel. (${refreshRes.status}: ${detail})` }, 502);
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

  const merchantId = encodeURIComponent(conn.merchant_id);
  const priceCents = Math.round(price * 100);

  // 1. Create the item.
  let created;
  try {
    const createRes = await fetch(`${CLOVER_API_BASE}/v3/merchants/${merchantId}/items`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, price: priceCents, priceType: "FIXED" }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text().catch(() => "");
      const permissionHint = createRes.status === 403
        ? " This usually means the Clover app's Requested Permissions don't include Inventory -> Write yet — check that in the Clover Developer Dashboard, then reconnect."
        : "";
      return json({ error: `Clover rejected adding this item (status ${createRes.status}).${permissionHint} ${detail}`.trim() }, 502);
    }
    created = await createRes.json();
  } catch (err) {
    return json({ error: `Could not reach Clover: ${err?.message || err}` }, 502);
  }

  if (!created?.id) return json({ error: "Clover didn't return an item ID — the item may not have been created." }, 502);

  // 2. Set its stock count. If this step fails, the item still exists in
  // Clover (just at whatever default stock Clover gives a new item) —
  // report that partial state rather than pretending nothing happened.
  let stockWarning = null;
  try {
    const stockRes = await fetch(`${CLOVER_API_BASE}/v3/merchants/${merchantId}/item_stocks/${encodeURIComponent(created.id)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: stockCount }),
    });
    if (!stockRes.ok) {
      const detail = await stockRes.text().catch(() => "");
      stockWarning = `Item was created, but setting its stock count failed (status ${stockRes.status}). You can set it directly in Clover. ${detail}`.trim();
    }
  } catch (err) {
    stockWarning = `Item was created, but setting its stock count failed: ${err?.message || err}`;
  }

  // 3. Mirror it into shop_inventory right away so it shows on the Shop
  // page immediately, without waiting for the next scheduled sync.
  await supabase.from("shop_inventory").upsert({
    clover_item_id: created.id,
    name,
    price,
    stock_count: stockWarning ? null : stockCount,
    updated_at: new Date().toISOString(),
  }, { onConflict: "clover_item_id" });

  return json({ ok: true, item_id: created.id, name, price, stock_count: stockCount, warning: stockWarning });
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
