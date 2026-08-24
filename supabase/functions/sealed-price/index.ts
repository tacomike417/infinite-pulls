// Supabase Edge Function: sealed-price
//
// The catalogue and prices behind the Sealed tab in My Collection.
//
// WHY IT EXISTS: TCGdex, where every card price in this app comes from,
// is cards only — it has no concept of a sealed product. Jeff was right
// that TCGplayer tracks them, so sealed needs its own source.
//
// EVERYTHING BELOW WAS SETTLED BY PROBING THE LIVE API, NOT BY READING
// ITS DOCS, AND THE TWO DISAGREE ON THINGS THAT MATTER:
//
//   * The price field is `unopenedPrice`. The documentation calls it
//     `marketPrice`, which does not appear in a real response at all. A
//     client written from the docs finds no price on any product.
//   * Results are wrapped in { data: [...], metadata: {...} }.
//   * `setName` arrives as "SV08: Surging Sparks" — the part before the
//     colon is the set code, which is what lets a TCGdex set be matched
//     to this catalogue.
//   * A set has far more products than any template would guess. Surging
//     Sparks has 26, including Half Booster Box, Sleeved Booster Pack
//     Case, Single Pack Blister [Wooper] and a Pokemon Center exclusive
//     ETB. That is why the catalogue is fetched rather than derived.
//   * "Surging Sparks Booster Box" is $307. "Surging Sparks Booster Box
//     Case" is $2,103. Anything matching products by substring will
//     happily hand somebody the Case. See scoreProductMatch below.
//   * language=japanese returns ZERO sealed products for every query.
//     Their Japanese coverage is cards only. So Japanese sealed is
//     derived (set x product type) and priced from eBay instead.
//
// COST: they bill one credit per product returned, not per request. So a
// set's catalogue is fetched once and stored forever — names and photos
// don't change, only prices do — and prices are refreshed only for
// products somebody actually owns. That is the difference between paying
// once per set and paying per page view.
//
// NO KEY EVER REACHES THE BROWSER. Both API keys live only in this
// function's environment, and public.sealed_products has a read policy
// and deliberately no write policy.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PPT_BASE = "https://www.pokemonpricetracker.com/api/v2";
const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

const PRICE_FRESH_FOR_MS = 20 * 60 * 60 * 1000;        // TCGplayer updates daily
const MISSING_RECHECK_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const CATALOG_REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // new products do get added to a set
const PPT_PAGE_SIZE = 50;
const PPT_MAX_PRODUCTS_PER_SET = 120;
const MAX_PRICE_ITEMS = 40;

const EBAY_EXCLUDE = [
  "empty", "box only", "no packs", "opened", "resealed", "proxy", "custom",
  "wrapper", "code card", "digital", "psa", "bgs", "cgc", "sgc", "graded",
  "damaged", "reprint", "lot of", "bundle lot",
];
const EBAY_SAMPLE_SIZE = 40;
const EBAY_MIN_LISTINGS = 3;

// Japanese sealed, which PokemonPriceTracker does not carry at all.
const JA_PRODUCT_TYPES = [
  { key: "booster-box",  name: "Booster Box" },
  { key: "booster-pack", name: "Booster Pack" },
  { key: "gift-box",     name: "Gift Box" },
  { key: "starter-deck", name: "Starter Deck" },
];

let cachedEbayToken: { value: string; expiresAt: number } | null = null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: any;
  try { payload = await req.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const pptKey = Deno.env.get("POKEMONPRICETRACKER_API_KEY");
  const ebayId = Deno.env.get("EBAY_CLIENT_ID");
  const ebaySecret = Deno.env.get("EBAY_CLIENT_SECRET");

  // ---- probe -----------------------------------------------------------
  // Returns the raw upstream response. Kept in permanently: it is how the
  // discrepancies documented at the top of this file were found, and it is
  // how the next one gets found. Spends credits; returns no prices and
  // writes nothing.
  if (payload?.probe) {
    if (!pptKey) return json({ probe: true, configured: false, reason: "POKEMONPRICETRACKER_API_KEY is not set" });
    const search = String(payload.search || "Surging Sparks booster box");
    const url = `${PPT_BASE}/sealed-products?search=${encodeURIComponent(search)}&limit=3`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${pptKey}` } });
      const text = await res.text();
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* fall back to text */ }
      return json({
        probe: true, configured: true, requested: url, status: res.status,
        dailyRemaining: res.headers.get("X-RateLimit-Daily-Remaining"),
        body: parsed ?? text.slice(0, 4000),
      });
    } catch (err) {
      return json({ probe: true, error: String((err as Error)?.message || err) });
    }
  }

  const db = makeDb();
  const action = payload?.action === "prices" ? "prices" : "catalog";

  if (action === "catalog") {
    const setLabel = String(payload?.setLabel || "").trim().slice(0, 120);
    const setCode = String(payload?.setCode || "").trim().slice(0, 20);
    const lang = payload?.lang === "ja" ? "ja" : "en";
    if (!setLabel) return json({ error: "setLabel is required" }, 400);
    return json(await catalogForSet(db, { setLabel, setCode, lang }, { pptKey, ebayId, ebaySecret }));
  }

  const ids: string[] = Array.isArray(payload?.productIds)
    ? payload.productIds.map((x: unknown) => String(x)).slice(0, MAX_PRICE_ITEMS)
    : [];
  if (!ids.length) return json({ error: "productIds is required" }, 400);
  return json(await refreshPrices(db, ids, { pptKey, ebayId, ebaySecret }));
});

function makeDb() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

// ---------- catalogue ----------------------------------------------------
async function catalogForSet(db: any, set: any, keys: any) {
  // Already paid for this set? Serve it from the table and spend nothing.
  if (db) {
    const { data: seen } = await db.from("sealed_set_catalog")
      .select("fetched_at, product_count")
      .eq("set_label", set.setLabel).eq("card_lang", set.lang)
      .maybeSingle();
    const age = seen ? Date.now() - new Date(seen.fetched_at).getTime() : Infinity;
    if (seen && age < CATALOG_REFRESH_AFTER_MS) {
      return { products: await readProducts(db, set), cached: true, spentCredits: 0 };
    }
  }

  const products = set.lang === "ja"
    ? derivedJapaneseProducts(set)
    : await fetchEnglishCatalog(keys.pptKey, set);

  if (!products.length) {
    // Nothing upstream. Fall back to the derived shape so the tab still
    // offers something priceable through eBay, rather than an empty screen.
    const fallback = derivedJapaneseProducts({ ...set, lang: set.lang });
    if (db) await writeProducts(db, fallback);
    if (db) await markCatalogued(db, set, fallback.length);
    return { products: fallback, cached: false, derived: true, spentCredits: 0 };
  }

  if (db) {
    await writeProducts(db, products);
    await markCatalogued(db, set, products.length);
  }
  return { products, cached: false, derived: set.lang === "ja", spentCredits: products.length };
}

async function fetchEnglishCatalog(pptKey: string | undefined, set: any) {
  if (!pptKey) return [];
  const out: any[] = [];
  let offset = 0;
  while (out.length < PPT_MAX_PRODUCTS_PER_SET) {
    const url = `${PPT_BASE}/sealed-products?search=${encodeURIComponent(set.setLabel)}`
      + `&language=english&limit=${PPT_PAGE_SIZE}&offset=${offset}`;
    let body: any;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${pptKey}` } });
      if (!res.ok) break;                 // 429 = out of credits; keep whatever we have
      body = await res.json();
    } catch { break; }

    const rows = Array.isArray(body?.data) ? body.data : [];
    if (!rows.length) break;

    for (const row of rows) {
      // A search for "Surging Sparks" also returns products from other
      // sets whose name happens to contain it. Only keep rows whose OWN
      // set matches, comparing on the code ("SV08") when there is one and
      // the label otherwise.
      const { code, label } = splitSetName(row?.setName);
      const sameSet = set.setCode && code
        ? code.toLowerCase() === set.setCode.toLowerCase()
        : label.toLowerCase() === set.setLabel.toLowerCase();
      if (!sameSet) continue;

      const price = numberOrNull(row?.unopenedPrice);
      out.push({
        productId: `tcgplayer:${row?.tcgPlayerId ?? row?.id}`,
        source: "tcgplayer",
        name: String(row?.name || "").trim(),
        setCode: code || set.setCode || null,
        setLabel: label || set.setLabel,
        lang: "en",
        imageUrl: row?.imageCdnUrl400 || row?.imageCdnUrl || row?.imageUrl || null,
        externalUrl: row?.tcgPlayerUrl || null,
        price,
        priceSource: price === null ? null : "tcgplayer",
        isAskingPrice: false,
        notFound: price === null,
      });
    }

    if (!body?.metadata?.hasMore) break;
    offset += PPT_PAGE_SIZE;
  }
  return out.filter(p => p.name);
}

// "SV08: Surging Sparks" -> { code: 'SV08', label: 'Surging Sparks' }
function splitSetName(raw: unknown) {
  const text = String(raw || "").trim();
  const at = text.indexOf(":");
  if (at > 0) return { code: text.slice(0, at).trim(), label: text.slice(at + 1).trim() };
  return { code: "", label: text };
}

function derivedJapaneseProducts(set: any) {
  return JA_PRODUCT_TYPES.map(t => ({
    productId: `derived:${set.setCode || set.setLabel}:${t.key}:${set.lang}`,
    source: "derived",
    name: t.name,
    setCode: set.setCode || null,
    setLabel: set.setLabel,
    lang: set.lang,
    imageUrl: null,
    externalUrl: null,
    price: null,
    priceSource: null,
    isAskingPrice: false,
    notFound: false,       // not yet looked up — eBay decides
  }));
}

async function readProducts(db: any, set: any) {
  const { data } = await db.from("sealed_products")
    .select("product_id, source, name, set_code, set_label, card_lang, image_url, external_url, price, price_source, is_asking_price, not_found, checked_at")
    .eq("set_label", set.setLabel).eq("card_lang", set.lang);
  return (data || []).map(rowToProduct);
}

function rowToProduct(r: any) {
  return {
    productId: r.product_id, source: r.source, name: r.name,
    setCode: r.set_code, setLabel: r.set_label, lang: r.card_lang,
    imageUrl: r.image_url, externalUrl: r.external_url,
    price: r.price === null ? null : Number(r.price),
    priceSource: r.price_source, isAskingPrice: !!r.is_asking_price,
    notFound: !!r.not_found, checkedAt: r.checked_at,
  };
}

async function writeProducts(db: any, products: any[]) {
  if (!products.length) return;
  try {
    await db.from("sealed_products").upsert(products.map(p => ({
      product_id: p.productId, source: p.source, name: p.name,
      set_code: p.setCode, set_label: p.setLabel, card_lang: p.lang,
      image_url: p.imageUrl, external_url: p.externalUrl,
      price: p.price, price_source: p.priceSource,
      is_asking_price: !!p.isAskingPrice, not_found: !!p.notFound,
      checked_at: p.price === null ? null : new Date().toISOString(),
    })), { onConflict: "product_id" });
  } catch { /* the caller still gets the products back */ }
}

async function markCatalogued(db: any, set: any, count: number) {
  try {
    await db.from("sealed_set_catalog").upsert({
      set_label: set.setLabel, card_lang: set.lang,
      product_count: count, fetched_at: new Date().toISOString(),
    }, { onConflict: "set_label,card_lang" });
  } catch { /* worst case the set is catalogued again later */ }
}

// ---------- prices -------------------------------------------------------
async function refreshPrices(db: any, ids: string[], keys: any) {
  if (!db) return { prices: [] };
  const { data } = await db.from("sealed_products")
    .select("product_id, source, name, set_code, set_label, card_lang, image_url, external_url, price, price_source, is_asking_price, not_found, checked_at")
    .in("product_id", ids);

  const now = Date.now();
  const out: any[] = [];

  for (const row of data || []) {
    const product = rowToProduct(row);
    const age = product.checkedAt ? now - new Date(product.checkedAt).getTime() : Infinity;
    const fresh = product.notFound ? age < MISSING_RECHECK_AFTER_MS : age < PRICE_FRESH_FOR_MS;
    if (fresh && product.price !== null) { out.push(product); continue; }

    let priced: any = null;
    if (product.source === "tcgplayer" && keys.pptKey) priced = await priceFromTracker(keys.pptKey, product);
    if (!priced && keys.ebayId && keys.ebaySecret) priced = await priceFromEbay(keys.ebayId, keys.ebaySecret, product);

    const merged = priced
      ? { ...product, ...priced, notFound: false }
      : { ...product, price: product.price, notFound: product.price === null };

    await writeProducts(db, [merged]);
    out.push(merged);
  }
  return { prices: out };
}

// How well an upstream row answers the product we asked about. The whole
// reason this is not a substring test: "Surging Sparks Booster Box" is a
// substring of "Surging Sparks Booster Box Case", and the Case costs
// seven times as much. An exact name is the only confident answer;
// anything else is rejected rather than guessed.
function scoreProductMatch(wantedName: string, candidateName: string) {
  const a = wantedName.trim().toLowerCase();
  const b = String(candidateName || "").trim().toLowerCase();
  if (!a || !b) return -1;
  if (a === b) return 2;
  // Same words in a different order is still the same product.
  const words = (s: string) => s.split(/[^a-z0-9]+/).filter(Boolean).sort().join(" ");
  if (words(a) === words(b)) return 1;
  return -1;
}

async function priceFromTracker(key: string, product: any) {
  const url = `${PPT_BASE}/sealed-products?search=${encodeURIComponent(product.name)}&language=english&limit=10`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return null;               // 429 = out of credits; caller falls through to eBay
    const body = await res.json();
    const rows = Array.isArray(body?.data) ? body.data : [];
    if (!rows.length) return null;

    // Only an exact name (or the same words reordered) is accepted. A
    // near match is refused outright rather than guessed at, because the
    // nearest miss here is "Booster Box" vs "Booster Box Case" and taking
    // the wrong one would put $2,103 in somebody's collection instead of
    // $307. No price is a fine answer; a confidently wrong one is not.
    let best: any = null;
    let bestScore = 0;
    for (const row of rows) {
      const score = scoreProductMatch(product.name, row?.name);
      if (score > bestScore) { bestScore = score; best = row; }
    }
    if (!best) return null;

    const price = numberOrNull(best?.unopenedPrice);
    if (price === null) return null;

    return {
      price,
      priceSource: "tcgplayer",
      isAskingPrice: false,             // a real market price
      imageUrl: best?.imageCdnUrl400 || best?.imageCdnUrl || product.imageUrl || null,
      externalUrl: best?.tcgPlayerUrl || product.externalUrl || null,
      checkedAt: new Date().toISOString(),
    };
  } catch { return null; }
}

async function priceFromEbay(id: string, secret: string, product: any) {
  // For an English product the catalogue name already reads like a
  // listing title ("Surging Sparks Booster Box"), so it is used as-is.
  // A Japanese one cannot be: its set label is Japanese text
  // (黒炎の支配者) and no US seller titles a listing that way. The set
  // CODE is the part that does appear — "SV8 Japanese Booster Box" is a
  // real listing title shape — so that is what gets searched. Japanese
  // sealed pricing is genuinely thinner than English as a result, and the
  // app says so rather than pretending otherwise.
  const query = product.lang === "ja"
    ? [product.setCode || product.setLabel, "japanese pokemon", product.name].filter(Boolean).join(" ")
    : [product.name, "pokemon"].filter(Boolean).join(" ");
  try {
    const token = await ebayToken(id, secret);
    const url = `${EBAY_SEARCH_URL}?q=${encodeURIComponent(query)}`
      + `&filter=${encodeURIComponent("buyingOptions:{FIXED_PRICE}")}`
      + `&sort=price&limit=${EBAY_SAMPLE_SIZE}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    });
    if (!res.ok) return null;
    const data = await res.json();

    const prices = (data?.itemSummaries || [])
      .filter((it: any) => {
        const title = String(it?.title || "").toLowerCase();
        return !EBAY_EXCLUDE.some(bad => title.includes(bad));
      })
      .map((it: any) => Number(it?.price?.value))
      .filter((n: number) => isFinite(n) && n > 0)
      .sort((a: number, b: number) => a - b);

    if (prices.length < EBAY_MIN_LISTINGS) return null;
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;

    return {
      price: Math.round(median * 100) / 100,
      priceSource: "ebay",
      isAskingPrice: true,          // live listings, NOT sold prices
      checkedAt: new Date().toISOString(),
    };
  } catch { return null; }
}

async function ebayToken(id: string, secret: string) {
  if (cachedEbayToken && cachedEbayToken.expiresAt > Date.now() + 60_000) return cachedEbayToken.value;
  const res = await fetch(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Trimmed for the same reason ebay-price trims: a pasted credential
    // carrying a newline gets a 401 that looks exactly like a wrong key.
    Authorization: "Basic " + btoa(`${id.trim()}:${secret.trim()}`),
    },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!res.ok) throw new Error("eBay token request failed: " + res.status);
  const data = await res.json();
  cachedEbayToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 7200) * 1000 };
  return cachedEbayToken.value;
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v) && v > 0) return v;
  if (typeof v === "string" && v.trim() && isFinite(Number(v)) && Number(v) > 0) return Number(v);
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
