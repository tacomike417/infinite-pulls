// Supabase Edge Function: scan-card
//
// Photograph a card, get back what it is. Replaces reading the tiny
// number in the corner with recognising the whole card.
//
// WHY THIS RUNS ON THE SERVER AND NOT IN THE BROWSER
//
// The Ximilar token is money. Anything in the browser can be read by
// anyone who opens the developer tools, and a leaked token is somebody
// else's scanning bill charged to this shop. It lives here as a secret,
// and the browser never sees it.
//
// It also means every scan passes through one place that can count it --
// see the card_scans table, which exists because Ximilar does not publish
// what a card identification costs and we are not running a paid feature
// on a number nobody knows.
//
// WHAT IT RETURNS, AND WHAT IT DELIBERATELY DOES NOT
//
// It returns Ximilar's reading: name, set, set code, card number. It does
// NOT return a TCGdex card id, because Ximilar has never heard of TCGdex.
// The browser takes the number and runs it through the same lookup path a
// typed number goes through -- code that is already tested, already
// handles both languages, and already knows what to do with an ambiguous
// number. One route in, one route to debug.
//
// NOT CONFIGURED IS NOT AN ERROR. With no token set it answers
// available:false and the app quietly falls back to the old scanner,
// exactly like ebay-price does.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const XIMILAR_TCG_URL = "https://api.ximilar.com/collectibles/v2/tcg_id";
const XIMILAR_ACCOUNT_URL = "https://api.ximilar.com/account/v2/details/";

// A phone photo is a couple of hundred KB. Ten is a generous ceiling that
// still refuses somebody posting a video frame by frame.
const MAX_BASE64_CHARS = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  /* SIGNED IN, OR NO SCAN. Every call spends real credits, so this is not
     left open to the internet. The user's own JWT is verified here rather
     than trusted -- the id is what the scan gets logged against. */
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Sign in to scan a card." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let userId: string | null = null;
  try {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data?.user) return json({ error: "Sign in to scan a card." }, 401);
    userId = data.user.id;
  } catch {
    return json({ error: "Sign in to scan a card." }, 401);
  }

  /* THE KEY COMES FROM THE DATABASE FIRST.
   *
   * It is typed into the admin panel, so whoever runs the shop can change
   * it without a terminal, a Supabase login, or anybody's help -- which
   * matters because the account paying for this changes hands in
   * November. The environment variable is still read as a fallback, so a
   * project set up the old way keeps working and there is no flag day.
   *
   * Read here with the service role. The table it comes from has row
   * level security on and no policies at all, so this is the only thing
   * anywhere that can see the value. */
  let token: string | null = null;
  try {
    const { data } = await admin
      .from("app_secrets").select("value").eq("name", "ximilar").maybeSingle();
    if (data?.value) token = String(data.value).trim();
    /* Ximilar's docs show the header as `Authorization: Token abc123`, so
       a fair number of people copy the word "Token" in with the key. That
       would send `Token Token abc123` and fail as a flat 401 with nothing
       to explain it. Strip it rather than let that be a mystery. */
    if (token) token = token.replace(/^Token\s+/i, "").trim();
  } catch { /* fall through to the environment */ }
  if (!token) token = Deno.env.get("XIMILAR_TOKEN") || null;

  if (!token) {
    // Not an error: the app quietly falls back to the old scanner.
    return json({ available: false, reason: "Card recognition isn't configured yet." });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Accepts a bare base64 string or a full data: URL, because the browser
  // produces the latter and stripping it there is one more thing to get
  // wrong in two places.
  let b64 = String(payload?.image || "");
  const comma = b64.indexOf(",");
  if (b64.startsWith("data:") && comma > -1) b64 = b64.slice(comma + 1);
  b64 = b64.trim();

  if (!b64) return json({ error: "No image supplied" }, 400);
  if (b64.length > MAX_BASE64_CHARS) return json({ error: "That image is too large" }, 413);

  const started = Date.now();
  let best: any = null;
  let alternatives = 0;
  let errText: string | null = null;

  try {
    const res = await fetch(XIMILAR_TCG_URL, {
      method: "POST",
      headers: { "Authorization": `Token ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ _base64: b64 }] }),
    });

    if (!res.ok) {
      /* THE STATUS CODE ON ITS OWN IS USELESS. A 401 could be a bad key, a
         key with the word "Token" pasted in front of it, a plan that has
         not been activated, or a service the account cannot reach -- and
         Ximilar says which in the body. Throwing that away and logging
         "returned 401" turned a five-second fix into guesswork. */
      let detail = "";
      try { detail = (await res.text()).slice(0, 400).replace(/\s+/g, " ").trim(); } catch { /* no body */ }
      errText = `Ximilar returned ${res.status}${detail ? ": " + detail : ""}`;
    } else {
      const body = await res.json();
      const record = body?.records?.[0];
      /* _objects can hold several things -- the card, and for a graded
         card the slab label as well. Only the card is of any use here. */
      const objects = Array.isArray(record?._objects) ? record._objects : [];
      const cardObj = objects.find((o: any) => o?.name === "Card") || objects[0];
      const ident = cardObj?._identification;
      best = ident?.best_match || null;
      alternatives = Array.isArray(ident?.alternatives) ? ident.alternatives.length : 0;
      if (!best) errText = "No card recognised in that photo";
    }
  } catch (err) {
    errText = `Could not reach Ximilar: ${(err as Error)?.message || err}`;
  }

  const duration = Date.now() - started;

  const result = best
    ? {
        available: true,
        matched: true,
        name: str(best.name),
        fullName: str(best.full_name),
        set: str(best.set),
        setCode: str(best.set_code),
        cardNumber: str(best.card_number),
        year: typeof best.year === "number" ? best.year : null,
        rarity: str(best.rarity),
        alternatives,
      }
    : { available: true, matched: false, reason: errText || "Nothing recognised" };

  /* THE MEASUREMENT. Ximilar bills in credits and will not say how many a
     card identification costs, so the remaining balance is read after
     every scan and stored beside it. The gap between one row and the next
     is the real price, observed. This runs AFTER the answer has been
     handed back where the runtime allows it, because nobody at a show
     should wait on our bookkeeping. */
  const logIt = async () => {
    let creditsAfter: number | null = null;
    let accountNote = "";
    try {
      const acc = await fetch(XIMILAR_ACCOUNT_URL, { headers: { "Authorization": `Token ${token}` } });
      if (acc.ok) {
        const a = await acc.json();
        if (typeof a?.credits_counter === "number") creditsAfter = a.credits_counter;
        /* Only recorded when the scan already failed. If the account
           endpoint accepts this key but the card endpoint does not, the
           key is fine and the PLAN is the problem -- and these two numbers
           say so at a glance. */
        if (errText) {
          accountNote = ` | account ok: credits_counter=${a?.credits_counter}, credits_limit=${a?.credits_limit}`;
        }
      } else if (errText) {
        accountNote = ` | account also failed: ${acc.status}`;
      }
    } catch { /* the scan still happened; the price of it is a nice-to-have */ }

    try {
      await admin.from("card_scans").insert({
        user_id: userId,
        service: "ximilar",
        matched: !!best,
        card_name: best ? str(best.name) : null,
        set_name: best ? str(best.set) : null,
        set_code: best ? str(best.set_code) : null,
        card_number: best ? str(best.card_number) : null,
        alternatives,
        credits_after: creditsAfter,
        duration_ms: duration,
        error: errText ? (errText + accountNote).slice(0, 800) : null,
      });
    } catch { /* never let logging break a scan */ }
  };

  // @ts-ignore -- present on Supabase's runtime, absent when running local
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(logIt());
  } else {
    await logIt();
  }

  return json(result);
});

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  return s ? s : null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
