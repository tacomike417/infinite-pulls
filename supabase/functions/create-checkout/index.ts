// Supabase Edge Function: create-checkout
//
// TURNS A "BUY" TAP INTO A CLOVER PAYMENT PAGE.
//
// The order of operations here is the entire safety story, so it is worth
// stating plainly. Every item in this shop is quantity one, and Clover
// Hosted Checkout does not touch Clover inventory, so nothing about a
// completed sale reduces a count on its own.
//
//   1. ask Clover what the stock ACTUALLY is right now, because the copy
//      in our database is only as fresh as the last sync and somebody may
//      have bought it at the counter two minutes ago
//   2. take the hold -- claim_shop_item() locks the row, so two shoppers
//      on the last card cannot both be told yes
//   3. only then ask Clover for a checkout page
//
// Taking the hold AFTER creating the session would leave a gap where the
// same card is sold twice, and the gap is exactly as long as a network
// round trip to Clover. It looks fine every time you test it.
//
// If the hold fails, nobody reaches a payment form and nobody has typed a
// card number. "It just went" is a far better moment before paying than
// after.
//
// TWO TOKENS, DELIBERATELY DIFFERENT.
//   clover_connection  Inventory: Read/Write. Reads stock, and later
//                      reduces it. Cannot take money.
//   clover_ecom        The Ecommerce API key. Can take money. Nothing
//                      else in this codebase touches it.
//
// DEPLOY: supabase functions deploy create-checkout --project-ref rrkyvcouxdmurwdyuugv --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const CLOVER_API = "https://api.clover.com";
const CHECKOUT_API = "https://api.clover.com/invoicingcheckoutservice/v1/checkouts";

// Flat rate, decided 8 Sep 2026. One number for everything: it covers a
// tracked mailer on a card and loses a couple of dollars on a big box,
// which is the trade being made on purpose rather than a rate table
// nobody maintains.
const SHIPPING_CENTS = 800;
const SHIPPING_LABEL = "Shipping (flat rate)";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, 200);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Supabase service role is not configured on this function" }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is caught below */ }

  const itemId     = String(body?.itemId || "").trim();
  const qty        = Math.max(1, Math.min(parseInt(body?.qty, 10) || 1, 20));
  const fulfilment = body?.fulfilment === "ship" ? "ship" : "pickup";
  if (!itemId) return json({ error: "Which item?" }, 400);

  /* ---- the two connections ---- */
  const { data: inv } = await supabase
    .from("clover_connection").select("*").eq("id", 1).maybeSingle();
  const { data: ecom } = await supabase
    .from("clover_ecom").select("*").eq("id", 1).maybeSingle();

  if (!inv?.access_token || !inv?.merchant_id) {
    return json({ error: "The shop's inventory connection is not set up." }, 400);
  }
  if (!ecom?.private_token || !ecom?.merchant_id) {
    return json({ error: "Online payments are not switched on yet." }, 400);
  }

  /* ---- 1. what does the till actually say, right now ---- */
  let liveStock: number | null = null;
  let liveName = "";
  let livePriceCents: number | null = null;
  try {
    const res = await fetch(
      `${CLOVER_API}/v3/merchants/${encodeURIComponent(inv.merchant_id)}/items/${encodeURIComponent(itemId)}?expand=itemStock`,
      { headers: { Authorization: `Bearer ${inv.access_token}`, Accept: "application/json" } },
    );
    if (!res.ok) return json({ error: "Could not check that item with the shop." }, 502);
    const it = await res.json();
    liveName = String(it?.name || "").slice(0, 200);
    livePriceCents = typeof it?.price === "number" ? it.price : null;
    liveStock = typeof it?.itemStock?.stockCount === "number" ? it.itemStock.stockCount : null;
  } catch {
    return json({ error: "Could not reach the shop's till just now." }, 502);
  }

  if (liveStock === null || livePriceCents === null || !liveName) {
    // Refusing to sell something whose price or stock we cannot confirm
    // is the correct answer, not a failure to work around.
    return json({ error: "That item is not available online." }, 409);
  }
  if (liveStock < qty) return json({ sold: true, error: "That one just went." }, 409);

  /* ---- 2. the hold, before anything else ---- */
  const { data: holdId, error: claimError } = await supabase
    .rpc("claim_shop_item", { p_item_id: itemId, p_qty: qty, p_fulfilment: fulfilment });
  if (claimError) return json({ error: "Could not hold that item." }, 500);
  if (!holdId) return json({ sold: true, error: "That one just went." }, 409);

  /* ---- 3. now ask Clover for a page ---- */
  const lineItems: Array<Record<string, unknown>> = [
    { name: liveName, price: livePriceCents, unitQty: qty },
  ];
  if (fulfilment === "ship") {
    lineItems.push({ name: SHIPPING_LABEL, price: SHIPPING_CENTS, unitQty: 1 });
  }

  try {
    const res = await fetch(CHECKOUT_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Clover-Merchant-Id": ecom.merchant_id,
        Authorization: `Bearer ${ecom.private_token}`,
      },
      body: JSON.stringify({
        /* AN EMPTY CUSTOMER OBJECT IS NOT OPTIONAL.
           Clover's spec: "customer: Must include empty object; provide
           firstName, lastName, or email depending on merchant settings."
           Leaving it out entirely is rejected before anything else is
           looked at -- which is what the first version did, and the only
           thing it got back was a flat refusal with no reason in it.
           Nothing is put IN it here: the hosted page collects the name,
           email and address itself, and this shop has no business
           holding any of that. */
        customer: {},
        shoppingCart: { lineItems },
      }),
    });

    if (!res.ok) {
      /* SAY WHAT CLOVER SAID.
         The first version threw the response away and returned "could
         not start checkout", which is true and useless -- it took a
         DevTools session and a trip through the API spec to find out the
         request was missing one empty object. Clover's own words go to
         the log, and a short version comes back in `detail` so a
         misconfiguration is readable without opening a browser
         inspector. Nothing secret is in there: it is Clover complaining
         about the shape of a request we sent. */
      const body = await res.text().catch(() => "");
      console.error("create-checkout: Clover refused", res.status, body.slice(0, 800));
      await supabase.from("shop_holds").update({ status: "released" }).eq("id", holdId);
      return json({
        error: "Could not start checkout. Try again in a moment.",
        detail: `Clover said ${res.status}: ${body.slice(0, 300)}`,
      }, 502);
    }

    const session = await res.json();
    const href = session?.href || session?.checkoutPageUrl || null;
    const sessionId = session?.checkoutSessionId || null;
    if (!href || !sessionId) {
      await supabase.from("shop_holds").update({ status: "released" }).eq("id", holdId);
      return json({ error: "Checkout did not come back properly." }, 502);
    }

    await supabase.rpc("attach_checkout_session", { p_hold: holdId, p_session: sessionId });

    return json({
      url: href,
      sessionId,
      holdId,
      fulfilment,
      shipping: fulfilment === "ship" ? SHIPPING_CENTS / 100 : 0,
    });
  } catch {
    await supabase.from("shop_holds").update({ status: "released" }).eq("id", holdId);
    return json({ error: "Could not reach checkout just now." }, 502);
  }
});
