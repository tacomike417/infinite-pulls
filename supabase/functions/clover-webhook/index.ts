// Supabase Edge Function: clover-webhook
//
// CLOVER TELLING US THE MONEY LANDED.
//
// Hosted Checkout does not touch Clover inventory, so this is the only
// moment the shop's own stock count can be reduced for an online sale.
// Without it, Jeff sells a card on the website at 2pm and then sells the
// same card across the counter at 4pm, because his till never heard about
// the first one.
//
// WHAT IT DOES, IN ORDER
//   1. checks the signature -- an unverified webhook is an open endpoint
//      that marks things sold for anybody who finds the URL
//   2. marks the hold paid, ONCE, even if Clover sends it twice
//   3. reduces the count in Clover with the inventory token
//
// Step 2 returns `already` when the webhook is a repeat, and step 3 is
// skipped in that case. Clover retries webhooks; decrementing twice for
// one sale would take a second card off the shelf that nobody bought.
//
// SETUP: the webhook URL and its signing secret are set by the merchant
// in the Clover dashboard, Settings > Ecommerce > Hosted Checkout. The
// secret goes into the admin panel here so this can verify it.
//
// DEPLOY: supabase functions deploy clover-webhook --project-ref rrkyvcouxdmurwdyuugv --no-verify-jwt
// (--no-verify-jwt because Clover calls this, not a signed-in person. The
// signature check below is what stands in for auth, and it is not
// optional.)

import { createClient } from "npm:@supabase/supabase-js@2";

const CLOVER_API = "https://api.clover.com";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" },
  });
}

/* Clover-Signature: t=<unix seconds>,v1=<hex hmac sha256 of "t.body">
 *
 * Compared byte by byte in constant time. A plain === on a hex string
 * leaks how much of the guess was right through how long it takes to
 * fail, which is a real attack on a real endpoint and costs nothing to
 * avoid. */
async function verify(secret: string, header: string, raw: string): Promise<boolean> {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;
  const t = parts["t"];
  const sent = parts["v1"];
  if (!t || !sent) return false;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`));
  const mine = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  if (mine.length !== sent.length) return false;
  let diff = 0;
  for (let i = 0; i < mine.length; i++) diff |= mine.charCodeAt(i) ^ sent.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "Not configured" }, 500);
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const raw = await req.text();

  const { data: ecom } = await supabase
    .from("clover_ecom").select("webhook_secret").eq("id", 1).maybeSingle();

  /* NO SECRET, NO SALE.
     It is tempting to let webhooks through while the secret is still
     being set up. That endpoint marks things paid and reduces stock, so
     an open version of it is somebody else emptying the shelf. It fails
     closed and says why in the log. */
  if (!ecom?.webhook_secret) {
    console.error("clover-webhook: no signing secret stored — refusing.");
    return json({ error: "Webhook not configured" }, 503);
  }

  const ok = await verify(ecom.webhook_secret, req.headers.get("Clover-Signature") || "", raw);
  if (!ok) return json({ error: "Bad signature" }, 401);

  let evt: any = {};
  try { evt = JSON.parse(raw); } catch { return json({ error: "Bad payload" }, 400); }

  // Clover also sends a plain verification ping when the URL is first
  // saved. Answering 200 is what makes the dashboard accept it.
  const type = String(evt?.type || evt?.Type || "");
  const status = String(evt?.status || evt?.Status || "").toUpperCase();
  const sessionId = String(evt?.data || evt?.Data || "");

  if (type !== "PAYMENT") return json({ ok: true, ignored: type || "verification" });
  if (status !== "APPROVED") return json({ ok: true, ignored: status });
  if (!sessionId) return json({ ok: true, ignored: "no session" });

  const { data: rows, error } = await supabase.rpc("mark_hold_paid", { p_session: sessionId });
  if (error) { console.error("mark_hold_paid:", error.message); return json({ error: "db" }, 500); }

  const hit = Array.isArray(rows) ? rows[0] : rows;
  if (!hit) return json({ ok: true, ignored: "no matching hold" });
  if (hit.already) return json({ ok: true, repeat: true });

  /* ---- reduce the count in Clover ----
     The one thing that keeps the till and the website agreeing. It runs
     after the hold is marked paid, so a failure here loses the stock
     adjustment and never the sale -- and the next inventory sync is
     still working from a count that is one too high, which is why the
     error is logged loudly rather than swallowed. */
  const { data: inv } = await supabase
    .from("clover_connection").select("access_token, merchant_id").eq("id", 1).maybeSingle();

  if (inv?.access_token && inv?.merchant_id) {
    try {
      const url = `${CLOVER_API}/v3/merchants/${encodeURIComponent(inv.merchant_id)}/item_stocks/${encodeURIComponent(hit.clover_item_id)}`;
      const cur = await fetch(url, {
        headers: { Authorization: `Bearer ${inv.access_token}`, Accept: "application/json" },
      });
      const now = cur.ok ? await cur.json() : null;
      const have = typeof now?.stockCount === "number" ? now.stockCount : null;
      if (have !== null) {
        const next = Math.max(0, have - (hit.qty || 1));
        const put = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${inv.access_token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ stockCount: next }),
        });
        if (!put.ok) console.error("clover-webhook: stock update refused", put.status);
      } else {
        console.error("clover-webhook: could not read current stock for", hit.clover_item_id);
      }
    } catch (err) {
      console.error("clover-webhook: stock update failed", err);
    }
  }

  // Bring our own copy in line straight away rather than waiting for the
  // next scheduled sync, so the Shop page stops offering it immediately.
  await supabase.rpc("release_expired_shop_holds").catch(() => {});

  return json({ ok: true, item: hit.clover_item_id, qty: hit.qty });
});
