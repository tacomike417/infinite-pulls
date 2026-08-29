// Supabase Edge Function: tcgdex
//
// The only thing in this project that talks to api.tcgdex.net. Everything
// else reads public.tcgdex_cache.
//
// WHAT IT IS FOR
//
// On 29 August 2026 TCGdex stopped answering entirely — no error, no
// response, connections timing out. Card search and prices went with it.
// They are free, community-run, with no paid tier and no SLA; TCGplayer's
// API is closed to new applicants; the commercial middlemen cover prices
// but not images. There is no API you can buy that fixes this.
//
// What fixes it is keeping our own copy. This function is what fills it.
//
// THE ONE RULE
//
//   A stale answer beats no answer. Always.
//
// If upstream is healthy, this refreshes and returns fresh data. If
// upstream is slow, it gives up quickly. If upstream is dead, it returns
// what we stored last time and says so. The only way a caller gets
// nothing is if we have never successfully fetched that path at all.
//
// WHY THE BROWSER DOES NOT CALL TCGDEX DIRECTLY ANY MORE
//
// Two reasons. The service role key is needed to write the cache and
// cannot go in the browser. And routing every call through one place
// means a dead upstream is handled once, correctly, instead of in every
// call site — which is how the app ended up hanging for minutes in the
// first place.
//
// SSRF: `path` comes from the browser and is pasted onto a URL, so it is
// validated hard below rather than trusted. Without that this is an open
// proxy that will happily fetch anything anybody asks it to.
//
// SECRETS: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, both already set.
// No TCGdex key exists or is needed — they are free and keyless.
//
// Deploy: supabase functions deploy tcgdex

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TCGDEX_ROOT = "https://api.tcgdex.net/v2";

// Eight seconds, same as the browser-side timeout this replaces. Long
// enough for a healthy JSON call, short enough that a struggling upstream
// does not become our problem.
const UPSTREAM_TIMEOUT_MS = 8000;

// A pre-warm walks a list of cards. Spacing the calls out is the polite
// way to use a free service that owes us nothing.
const WARM_DELAY_MS = 250;
const WARM_MAX = 40;

/* Only these shapes are ever fetched. Anything else is refused before it
 * reaches a URL. Two-letter language code, then plain path segments, then
 * an optional query string. No dots, so no traversal; no slashes at the
 * start, so no host swapping; no protocol-relative anything. */
// A colon is allowed in the QUERY only, never in the path. TCGdex's own
// syntax needs it — the app sends ?dexId=eq:6 and ?name=eq:Charizard for
// Dex-number search and Other Printings — and a colon after the ? cannot
// change the host, because the host is fixed by the template literal and
// this is appended after /v2/. In the path it would be a scheme separator,
// so it stays out of there.
const SAFE_PATH = /^[a-z]{2}(?:\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)*(?:\?[A-Za-z0-9=&_~%+.,:-]*)?$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Not configured." }, 500);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // ---- pre-warm, staff only ------------------------------------------
  if (body?.warm === true) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Sign in to the admin panel first." }, 401);
    if (!(await isShopStaff(supabaseUrl, serviceKey, token))) {
      return json({ error: "Only the shop can pre-warm the cache." }, 403);
    }
    return await warm(supabaseUrl, serviceKey, Number(body?.limit) || 25, String(body?.lang || "en"));
  }

  // ---- the ordinary case: give me this path ---------------------------
  const path = String(body?.path || "").trim().replace(/^\/+/, "");
  if (!path || path.length > 200 || !SAFE_PATH.test(path) || path.includes("..")) {
    return json({ error: "That is not a path this function will fetch." }, 400);
  }
  const kind = kindOf(path, body?.kind);

  const cached = await readCache(supabaseUrl, serviceKey, path);

  // Fresh enough. Never touch the network.
  if (cached && cached.fresh) {
    return json({ payload: cached.payload, source: "cache", fresh: true, fetched_at: cached.fetched_at });
  }

  // Stale or missing. Try upstream — but a stale row is already in hand,
  // so a failure here is a shrug, not an error.
  try {
    const payload = await fetchUpstream(path);
    await writeCache(supabaseUrl, serviceKey, path, payload, kind);
    return json({ payload, source: "upstream", fresh: true, fetched_at: new Date().toISOString() });
  } catch (err) {
    const message = (err as Error)?.message || String(err);

    if (cached) {
      // THE WHOLE POINT OF THIS FILE.
      await noteError(supabaseUrl, serviceKey, path, message);
      return json({
        payload: cached.payload,
        source: "stale",
        fresh: false,
        fetched_at: cached.fetched_at,
        note: "TCGdex did not answer, so this is the copy we already had.",
      });
    }

    // Never fetched successfully, and cannot now. This is the only case
    // where the caller genuinely gets nothing.
    return json({ error: "Card data is unavailable right now.", detail: message }, 503);
  }
});

/* ------------------------------------------------------------------ */

function kindOf(path: string, given: unknown): string {
  const k = String(given || "");
  if (["set-list", "set", "card", "search", "other"].includes(k)) return k;
  const bare = path.split("?")[0];
  if (/^[a-z]{2}\/sets\/?$/.test(bare)) return "set-list";
  if (/^[a-z]{2}\/sets\/[^/]+$/.test(bare)) return "set";
  if (/^[a-z]{2}\/cards\/[^/]+$/.test(bare)) return "card";
  if (/^[a-z]{2}\/cards\/?$/.test(bare)) return "search";
  return "other";
}

async function fetchUpstream(path: string): Promise<unknown> {
  const res = await fetch(`${TCGDEX_ROOT}/${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`TCGdex returned ${res.status}`);
  return await res.json();
}

async function readCache(url: string, key: string, path: string) {
  const res = await fetch(
    `${url}/rest/v1/tcgdex_cache_public?path=eq.${encodeURIComponent(path)}&select=payload,fresh,fetched_at`,
    { headers: sbHeaders(key), signal: AbortSignal.timeout(6000) },
  ).catch(() => null);
  if (!res || !res.ok) return null;
  const rows = await res.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? { payload: row.payload, fresh: row.fresh === true, fetched_at: row.fetched_at } : null;
}

async function writeCache(url: string, key: string, path: string, payload: unknown, kind: string) {
  // merge-duplicates so a refresh updates in place rather than colliding
  // on the primary key.
  await fetch(`${url}/rest/v1/tcgdex_cache`, {
    method: "POST",
    headers: { ...sbHeaders(key), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      path, payload, kind,
      fetched_at: new Date().toISOString(),
      last_error: null, last_error_at: null,
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => { /* a cache write that fails is not worth failing the request over */ });
}

async function noteError(url: string, key: string, path: string, message: string) {
  await fetch(`${url}/rest/v1/tcgdex_cache?path=eq.${encodeURIComponent(path)}`, {
    method: "PATCH",
    headers: { ...sbHeaders(key), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ last_error: message.slice(0, 300), last_error_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(6000),
  }).catch(() => {});
}

/* Fills the cache with the cards these customers actually own, most-wanted
 * first. A cache that starts empty protects nobody on the day it ships. */
async function warm(url: string, key: string, limit: number, lang: string) {
  const capped = Math.min(Math.max(limit, 1), WARM_MAX);

  const listRes = await fetch(`${url}/rest/v1/rpc/tcgdex_warm_list`, {
    method: "POST",
    headers: { ...sbHeaders(key), "Content-Type": "application/json" },
    body: JSON.stringify({ p_limit: capped }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);

  if (!listRes || !listRes.ok) return json({ error: "Could not read the warm list." }, 500);
  const wanted = await listRes.json().catch(() => []);
  if (!Array.isArray(wanted) || !wanted.length) {
    return json({ warmed: 0, remaining: 0, note: "Everything customers own is already cached." });
  }

  // The set list first — it is one call, it is what every search needs,
  // and it has the longest life of anything in here.
  let warmed = 0;
  const failures: string[] = [];
  try {
    const sets = await fetchUpstream(`${lang}/sets`);
    await writeCache(url, key, `${lang}/sets`, sets, "set-list");
    warmed++;
  } catch (err) {
    failures.push(`sets: ${(err as Error)?.message}`);
  }

  for (const row of wanted) {
    const id = String(row?.card_id || "").trim();
    if (!id || !/^[A-Za-z0-9._~-]+$/.test(id)) continue;
    const path = `${lang}/cards/${id}`;
    try {
      const payload = await fetchUpstream(path);
      await writeCache(url, key, path, payload, "card");
      warmed++;
    } catch (err) {
      failures.push(`${id}: ${(err as Error)?.message}`);
      // Upstream is unwell. Stop rather than grind through forty more
      // eight-second timeouts.
      if (failures.length >= 3) break;
    }
    await new Promise((r) => setTimeout(r, WARM_DELAY_MS));
  }

  return json({
    warmed,
    attempted: wanted.length,
    failures: failures.slice(0, 5),
    note: failures.length >= 3
      ? "Stopped early — TCGdex is not answering. Run it again when it is back."
      : "Run it again to warm the next batch.",
  });
}

async function isShopStaff(url: string, key: string, jwt: string): Promise<boolean> {
  const me = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: key },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!me || !me.ok) return false;
  const user = await me.json().catch(() => null);
  if (!user?.id) return false;

  const res = await fetch(
    `${url}/rest/v1/shop_staff?user_id=eq.${encodeURIComponent(user.id)}&select=user_id`,
    { headers: sbHeaders(key), signal: AbortSignal.timeout(8000) },
  ).catch(() => null);
  if (!res || !res.ok) return false;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
