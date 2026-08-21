// Supabase Edge Function: card-news
//
// Called from the "Recent News" section of a card's detail page (My
// Collection / Wish List search) to show actual headlines inline, not
// just a link out. Proxies a keyword search to the GDELT Project's free,
// keyless DOC 2.0 API (https://www.gdeltproject.org) — GDELT explicitly
// licenses its data/APIs for "unlimited and unrestricted use for any
// academic, commercial, or governmental use of any kind without fee."
// That's why it's the source here instead of Google News (whose
// robots.txt disallows automated access to news.google.com generally)
// or NewsAPI.org (whose free tier explicitly forbids production use —
// their cheapest production-legal plan is $359+/mo).
//
// This runs server-side specifically so the browser never has to deal
// with a third-party API's CORS policy (GDELT's isn't documented either
// way — routing through here sidesteps needing to know).
//
// No secrets required — this is a stateless proxy that trims GDELT's
// response down to what the card detail page actually shows.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";
const RESULT_LIMIT = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const query = String(payload?.query || "").trim().slice(0, 200);
  if (!query) return json({ error: "A search query is required" }, 400);

  // hybridrel = relevance-weighted-by-recency, a better fit than pure
  // "most recent" for a card name that could otherwise pull in noise;
  // timespan caps it to the last 3 months so results stay current.
  const url = `${GDELT_BASE}?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=${RESULT_LIMIT}&sort=hybridrel&timespan=3months`;

  // GDELT has been observed rejecting/rate-limiting requests carrying a
  // custom, non-browser User-Agent (a self-identifying string like
  // "InfinitePulls/1.0 ..." used to be sent here) even at very low
  // traffic — a real browser-style UA avoids that. One short retry is
  // also included since a stray 429 here should degrade to "try once
  // more," not straight to "show nothing."
  const fetchHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };

  let data;
  try {
    let res = await fetch(url, { headers: fetchHeaders });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 700));
      res = await fetch(url, { headers: fetchHeaders });
    }
    if (!res.ok) return json({ error: `News source returned ${res.status}` }, 502);
    data = await res.json();
  } catch (err) {
    return json({ error: `Could not reach the news source: ${err?.message || err}` }, 502);
  }

  const articles = (Array.isArray(data?.articles) ? data.articles : [])
    .slice(0, RESULT_LIMIT)
    .map((a) => ({
      title: typeof a?.title === "string" ? a.title.slice(0, 200) : "Untitled",
      url: typeof a?.url === "string" ? a.url : null,
      source: typeof a?.domain === "string" ? a.domain : null,
      publishedAt: parseGdeltDate(a?.seendate),
    }))
    .filter((a) => a.url);

  return json({ articles });
});

// GDELT's seendate looks like "20250815T120000Z" — reshape into a real
// ISO 8601 string the front end can just hand to `new Date(...)`.
function parseGdeltDate(seendate) {
  if (typeof seendate !== "string" || seendate.length < 15) return null;
  const y = seendate.slice(0, 4), mo = seendate.slice(4, 6), d = seendate.slice(6, 8);
  const h = seendate.slice(9, 11), mi = seendate.slice(11, 13), s = seendate.slice(13, 15);
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
