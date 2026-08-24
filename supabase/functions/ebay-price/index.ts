// Supabase Edge Function: ebay-price
//
// Called from the "Prices" section of a card's detail page (My Collection
// / Wish List search) to show a current eBay asking-price estimate right
// under the Cardmarket row. Uses eBay's Browse API (free, part of the
// standard eBay Developers Program, no eBay Partner Network / affiliate
// application needed for basic search — see supabase/SETUP.md for the
// one-time account setup, which only the shop owner can do).
//
// Important, and shown honestly in the app: this is an ASKING price, not
// a sold price. eBay's free tier has no sold/completed-listings API for
// an app like this (that's the Marketplace Insights API, which requires a
// business-justification application most hobby projects don't get
// approved for) — so this reflects what active listings are currently
// priced at, not what actually sold. It's still a genuinely useful,
// genuinely free signal, just a different one than TCGplayer/Cardmarket's
// market-price figures.
//
// Auth: standard eBay OAuth "client credentials" grant — an application
// access token, not tied to any customer or eBay account, minted
// server-side with the shop's own Client ID/Secret and cached in memory
// for its ~2 hour lifetime (see mintToken() below).

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const RESULT_SAMPLE_SIZE = 30; // how many active listings to pull before filtering
const MIN_USABLE_LISTINGS = 3; // below this, the median isn't worth showing

// Titles containing any of these are excluded from the price sample —
// lots/bulk/graded-slab listings and reprints/customs would otherwise
// badly skew a "what's this card going for" estimate.
const EXCLUDE_TERMS = [
  "lot", "bulk", "custom", "proxy", "fake", "reprint", "playmat",
  "sleeve", "binder", "box only", "empty box", "digital", "code card",
  "psa", "bgs", "cgc", "sgc", "graded",
];

// Cached across warm invocations of this function instance — an eBay
// application access token is valid for 2 hours, so there's no reason to
// mint a fresh one on every single request.
let cachedToken: { value: string; expiresAt: number } | null = null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    // Not configured yet — fail quietly with available:false so the front
    // end just skips the row, same as when card-news isn't deployed.
    return json({ available: false, reason: "eBay pricing isn't configured yet." });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const query = String(payload?.query || "").trim().slice(0, 200);
  if (!query) return json({ error: "A search query is required" }, 400);

  let token;
  try {
    token = await getToken(clientId, clientSecret);
  } catch (err) {
    return json({ available: false, reason: `Could not authenticate with eBay: ${err?.message || err}` });
  }

  let items = [];
  try {
    const url = `${EBAY_SEARCH_URL}?q=${encodeURIComponent(query)}&filter=${encodeURIComponent("buyingOptions:{FIXED_PRICE}")}&sort=price&limit=${RESULT_SAMPLE_SIZE}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      // A hard cap on the call — eBay hanging with no response at all
      // would otherwise leave this function running indefinitely. The
      // app's own client-side timeout works around that already, but no
      // reason to let this side sit there burning function time too.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return json({ available: false, reason: `eBay search returned ${res.status}` });
    }
    const data = await res.json();
    items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
  } catch (err) {
    return json({ available: false, reason: `Could not reach eBay: ${err?.message || err}` });
  }

  const prices = items
    .filter((it) => {
      const title = String(it?.title || "").toLowerCase();
      return !EXCLUDE_TERMS.some((term) => title.includes(term));
    })
    .map((it) => Number(it?.price?.value))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  if (prices.length < MIN_USABLE_LISTINGS) {
    return json({ available: false, reason: "Not enough current eBay listings to estimate a price." });
  }

  const low = prices[0];
  const high = prices[prices.length - 1];
  const median = prices.length % 2 === 0
    ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
    : prices[(prices.length - 1) / 2];

  return json({
    available: true,
    currency: items[0]?.price?.currency || "USD",
    median: round2(median),
    low: round2(low),
    high: round2(high),
    count: prices.length,
  });
});

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.value;

  // Trimmed on purpose. Pasting a credential into a secrets box very
  // easily carries a trailing newline or a stray space, and eBay answers
  // that with a flat 401 that looks identical to a wrong key — which is a
  // miserable thing to debug from the outside.
  const basic = btoa(`${clientId.trim()}:${clientSecret.trim()}`);
  const res = await fetch(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    // 401 here is always the credentials, never the query, so say so
    // rather than leaving a bare status code to be interpreted.
    if (res.status === 401) {
      throw new Error(
        "eBay rejected the credentials (401). Check that EBAY_CLIENT_ID is the App ID and " +
        "EBAY_CLIENT_SECRET is the Cert ID — not the Dev ID — and that both come from the " +
        "PRODUCTION keyset rather than Sandbox."
      );
    }
    throw new Error(`token request returned ${res.status}`);
  }

  const data = await res.json();
  if (!data?.access_token) throw new Error("no access_token in eBay's response");

  // expires_in is normally 7200 seconds — refresh 5 minutes early so a
  // request never lands right as the cached token expires.
  const expiresInMs = (Number(data.expires_in) || 7200) * 1000;
  cachedToken = { value: data.access_token, expiresAt: now + expiresInMs - 5 * 60 * 1000 };
  return cachedToken.value;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
