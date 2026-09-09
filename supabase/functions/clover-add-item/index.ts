// Supabase Edge Function: clover-add-item
//
// Called from the admin panel's "Price cards in" card.
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

  /* LISTING HIS CATEGORIES LIVES HERE RATHER THAN IN ITS OWN FUNCTION,
   * and that is on purpose. Everything above -- loading the connection,
   * knowing a merchant token never expires, refreshing an OAuth one -- is
   * the part that has actually gone wrong before. A second function would
   * be a second copy of it to get wrong separately. */
  const listingCategories = payload?.action === "categories";
  const filingBacklog = payload?.action === "file-uncategorised";

  const name = String(payload?.name || "").trim().slice(0, 200);
  const price = Number(payload?.price);
  const stockCount = Number.isFinite(Number(payload?.stock_count)) ? Math.max(0, Math.round(Number(payload.stock_count))) : 0;

  // What the counter scanner knows about the card that Clover has no
  // field for. All optional: an item added by hand from the admin panel
  // sends none of it and is still a perfectly good item.
  const categoryId = payload?.category_id ? String(payload.category_id).slice(0, 120) : null;
  const cardId = payload?.card_id ? String(payload.card_id).slice(0, 120) : null;
  const setName = payload?.set_name ? String(payload.set_name).slice(0, 200) : null;
  const cardNumber = payload?.card_number ? String(payload.card_number).slice(0, 40) : null;
  const artUrl = payload?.art_url ? String(payload.art_url).slice(0, 500) : null;
  const photoUrl = payload?.photo_url ? String(payload.photo_url).slice(0, 500) : null;
  const marketPrice = Number.isFinite(Number(payload?.market_price)) ? Number(payload.market_price) : null;

  if (!listingCategories && !filingBacklog) {
    if (!name) return json({ error: "Missing item name" }, 400);
    if (!Number.isFinite(price) || price < 0) return json({ error: "Missing or invalid price" }, 400);
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

  // Refresh the access token first if it's expired (or about to be) — same
  // approach as sync-clover-inventory.
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

  // GET /v3/merchants/{mId}/categories — his own category list, so the
  // admin panel offers what is actually in his till rather than a list
  // invented here that he would have to keep in step.
  if (listingCategories) {
    try {
      const res = await fetch(`${CLOVER_API_BASE}/v3/merchants/${merchantId}/categories?limit=200`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return json({ error: `Clover would not list categories (status ${res.status}). ${detail}`.trim() }, 502);
      }
      const body = await res.json();
      const categories = (Array.isArray(body?.elements) ? body.elements : [])
        .filter((c) => c?.id && c?.name)
        .map((c) => ({ id: c.id, name: String(c.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return json({ ok: true, categories });
    } catch (err) {
      return json({ error: `Could not reach Clover: ${err?.message || err}` }, 502);
    }
  }

  /* FILING A BACKLOG OF SCANNED CARDS, all at once.
   *
   * The category picker did not exist for the first afternoon of
   * scanning, so a stack of cards went into Clover with no category on
   * them. Rather than making somebody open two hundred items in Clover,
   * this files every card the scanner added that still has no category.
   *
   * Only cards the SCANNER added: those carry a card_id. The Smart Water
   * and the Starburst came from Clover with their own categories and are
   * none of this function's business.
   *
   * Done here rather than in the browser because the alternative is two
   * hundred separate calls from a phone on shop wifi. */
  if (filingBacklog) {
    if (!categoryId) return json({ error: "Pick a category first" }, 400);

    const { data: waiting, error: readError } = await supabase
      .from("shop_inventory")
      .select("clover_item_id")
      .not("card_id", "is", null)
      .is("category_id", null)
      .limit(1000);

    if (readError) return json({ error: `Could not read the shelf: ${readError.message}` }, 500);
    const list = waiting || [];
    if (!list.length) return json({ ok: true, filed: 0, failed: 0, message: "Nothing needed filing." });

    /* Clover takes several associations in one call, so this goes up in
       batches rather than one request per card. */
    let filed = 0;
    const failures = [];
    for (let i = 0; i < list.length; i += 50) {
      const slice = list.slice(i, i + 50);
      try {
        const res = await fetch(`${CLOVER_API_BASE}/v3/merchants/${merchantId}/category_items`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            elements: slice.map((r) => ({ category: { id: categoryId }, item: { id: r.clover_item_id } })),
          }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          failures.push(`${res.status}: ${detail}`.slice(0, 200));
          continue;
        }
        await supabase.from("shop_inventory").update({
          category_id: categoryId,
          category_name: payload?.category_name ? String(payload.category_name).slice(0, 120) : null,
        }).in("clover_item_id", slice.map((r) => r.clover_item_id));
        filed += slice.length;
      } catch (err) {
        failures.push(String(err?.message || err).slice(0, 200));
      }
    }

    return json({
      ok: true,
      filed,
      failed: list.length - filed,
      detail: failures.length ? failures[0] : null,
    });
  }

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

  /* 2b. Put it in a category, if one was chosen.
   *
   * POST /v3/merchants/{mId}/category_items with
   *   { elements: [ { category: {id}, item: {id} } ] }
   * straight out of Clover's "Manage categories" docs, not guessed.
   *
   * A failure here is worth reporting and not worth undoing the card
   * over: an item in no category still sells, it just lands in the shop
   * page's "Everything else" until the next sync or a hand-fix. */
  let categoryName = null;
  if (categoryId) {
    try {
      const catRes = await fetch(`${CLOVER_API_BASE}/v3/merchants/${merchantId}/category_items`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ elements: [{ category: { id: categoryId }, item: { id: created.id } }] }),
      });
      if (!catRes.ok) {
        const detail = await catRes.text().catch(() => "");
        stockWarning = [stockWarning, `Added, but it could not be filed under that category (status ${catRes.status}). ${detail}`.trim()]
          .filter(Boolean).join(" ");
      } else {
        categoryName = payload?.category_name ? String(payload.category_name).slice(0, 120) : null;
      }
    } catch (err) {
      stockWarning = [stockWarning, `Added, but filing it under that category failed: ${err?.message || err}`]
        .filter(Boolean).join(" ");
    }
  }

  // 3. Mirror it into shop_inventory right away so it shows on the Shop
  // page immediately, without waiting for the next scheduled sync.
  /* MARKET PRICE IS STORED AS IT WAS TODAY, and that is the point of it.
   * The Sunday price check compares this against the market later on. It
   * must never be compared against `price`, which carries the shop's
   * margin -- that would report every card in the shop as having dropped,
   * every week, forever, and the sheet would stop being read. */
  const { error: mirrorError } = await supabase.from("shop_inventory").upsert({
    clover_item_id: created.id,
    name,
    price,
    stock_count: stockWarning ? null : stockCount,
    card_id: cardId,
    set_name: setName,
    card_number: cardNumber,
    art_url: artUrl,
    photo_url: photoUrl,
    market_price: marketPrice,
    market_checked_at: marketPrice === null ? null : new Date().toISOString(),
    category_id: categoryId,
    category_name: categoryName,
    updated_at: new Date().toISOString(),
  }, { onConflict: "clover_item_id" });

  /* THIS USED TO FAIL IN SILENCE, and that is exactly how it went wrong.
   *
   * The whole point of this step is that a card shows on the website the
   * moment it is added, without waiting for a sync. The result of the
   * upsert was never looked at, so when it failed the function still
   * answered "ok" -- Clover had the item, the website did not, and
   * nothing anywhere said so. The only symptom was a shopkeeper pressing
   * Sync and assuming that was normal.
   *
   * It is a warning rather than an error because the card IS in Clover
   * and the next sync will bring it across. But it says so. */
  if (mirrorError) {
    stockWarning = [stockWarning, `Added to Clover, but it did not reach the website yet (${mirrorError.message}). The next sync will bring it across.`]
      .filter(Boolean).join(" ");
  }

  return json({
    ok: true,
    item_id: created.id,
    name,
    price,
    stock_count: stockCount,
    on_website: !mirrorError,
    warning: stockWarning,
  });
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
