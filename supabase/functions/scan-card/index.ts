// Supabase Edge Function: scan-card
//
// Photograph a card, get back what it is.
//
// WHY GOOGLE VISION AND NOT A CARD-RECOGNITION SERVICE
//
// The app only ever wants one thing off a card: its number, "4/102". That
// string goes into the same lookup a typed number goes into, and our own
// code does the rest. Paying a whole-card recognition service to hand back
// five characters cost EUR 59 a month; reading the text costs $1.50 per
// thousand images, with the first thousand a month free.
//
// WHY THIS BEATS THE ON-DEVICE SCANNER IT SITS IN FRONT OF
//
// The old scanner crops four guessed rectangles around the bottom corner
// and asks Tesseract for five characters of 2mm foil print. When glare
// lands on that corner there is nothing to read and nothing to fall back
// on.
//
// This reads the WHOLE card and gets every piece of text on it. That gives
// two independent ways to win:
//
//   1. The number, found anywhere in the text rather than in a guessed
//      rectangle.
//   2. THE CARD'S NAME. "Charizard" is the largest, highest-contrast text
//      on the card -- the easiest thing to read and the last thing glare
//      kills. When the corner is unreadable the name usually is not, and a
//      name search plus one tap is a perfectly good answer at a table.
//
// The second path is the real gain. Today the app only ever tries the
// hardest thing on the card.
//
// NOT CONFIGURED IS NOT AN ERROR. With no key it answers available:false
// and the app falls back to the on-device scanner -- which is also what
// happens with no signal, and card shows have famously bad signal.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VISION_URL = "https://vision.googleapis.com/v1/images:annotate";
const SECRET_NAME = "google_vision";
const MAX_BASE64_CHARS = 10 * 1024 * 1024;

/* Lines that are never a card's name. A card's name sits at the top, but
   so do the stage line and the HP, and OCR returns them in the same
   breath. */
/* Note these are matched AFTER digits are stripped, which is why "STAGE"
   is here on its own: "Stage 2" becomes "Stage", and without this the
   scanner would go and search the card database for a card called Stage.
   The test suite caught exactly that. */
const NOT_A_NAME = new Set([
  "BASIC", "STAGE", "STAGE 1", "STAGE 2", "STAGE1", "STAGE2", "RESTORED",
  "TRAINER", "SUPPORTER", "ITEM", "STADIUM", "TOOL", "POKEMON TOOL",
  "POKEMON", "ENERGY", "SPECIAL ENERGY", "BASIC ENERGY", "HP", "LV",
  "EVOLVES FROM", "EVOLVES", "PUT ONTO",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Sign in to scan a card." }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let userId: string | null = null;
  try {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data?.user) return json({ error: "Sign in to scan a card." }, 401);
    userId = data.user.id;
  } catch {
    return json({ error: "Sign in to scan a card." }, 401);
  }

  // The key is typed into the admin panel and read here with the service
  // role. The table it lives in has RLS on and no policies, so this is the
  // only thing anywhere that can see it.
  let key: string | null = null;
  try {
    const { data } = await admin
      .from("app_secrets").select("value").eq("name", SECRET_NAME).maybeSingle();
    if (data?.value) key = String(data.value).trim();
  } catch { /* fall through to the environment */ }
  if (!key) key = Deno.env.get("GOOGLE_VISION_KEY") || null;
  if (!key) return json({ available: false, reason: "Card reading isn't configured yet." });

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  let b64 = String(payload?.image || "");
  const comma = b64.indexOf(",");
  if (b64.startsWith("data:") && comma > -1) b64 = b64.slice(comma + 1);
  b64 = b64.trim();
  if (!b64) return json({ error: "No image supplied" }, 400);
  if (b64.length > MAX_BASE64_CHARS) return json({ error: "That image is too large" }, 413);

  const started = Date.now();
  let text = "";
  let errText: string | null = null;

  try {
    const res = await fetch(`${VISION_URL}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          image: { content: b64 },
          features: [{ type: "TEXT_DETECTION" }],
        }],
      }),
    });

    /* KEEP GOOGLE'S OWN WORDS. A bare status code explains nothing -- a
       403 could be a bad key, an unenabled API, or no billing account, and
       Google says which in the body. Throwing that away is what turned the
       last provider's failure into an afternoon of guessing. */
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 400).replace(/\s+/g, " ").trim(); } catch { /* no body */ }
      errText = `Vision returned ${res.status}${detail ? ": " + detail : ""}`;
    } else {
      const body = await res.json();
      const r = body?.responses?.[0];
      if (r?.error?.message) {
        errText = `Vision error: ${String(r.error.message).slice(0, 300)}`;
      } else {
        text = String(r?.fullTextAnnotation?.text || r?.textAnnotations?.[0]?.description || "");
        if (!text.trim()) errText = "No text found on that photo";
      }
    }
  } catch (err) {
    errText = `Could not reach Vision: ${(err as Error)?.message || err}`;
  }

  const duration = Date.now() - started;
  const number = findNumber(text);
  const name = number ? null : guessName(text);

  /* When neither worked, keep a snippet of what it actually read. That is
     the only way to tell "the photo was blank" from "it read the card fine
     and our patterns missed", and the two need opposite fixes. */
  if (!errText && !number && !name) {
    errText = `Read text but found no number or name: ${text.slice(0, 200).replace(/\s+/g, " ").trim()}`;
  }

  const result = (number || name)
    ? { available: true, matched: true, cardNumber: number, name, source: "vision" }
    : { available: true, matched: false, reason: errText || "Nothing readable" };

  const logIt = async () => {
    try {
      await admin.from("card_scans").insert({
        user_id: userId,
        service: "google_vision",
        matched: !!(number || name),
        card_name: name,
        card_number: number,
        duration_ms: duration,
        error: errText ? errText.slice(0, 800) : null,
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

/* ---- Pulling the number out of a whole card's text ------------------- */

/* A card carries a lot of numbers -- HP, damage, retreat cost, a
   copyright year. The set number is the one shaped "n/m", and the LAST
   one on the card, because it is printed at the bottom. Reading order is
   why the last match is taken rather than the first: "60/60" in an attack
   would otherwise win over "004/102" in the corner. */
function findNumber(text: string): string | null {
  if (!text) return null;
  const flat = text.replace(/\s*\/\s*/g, "/");

  const pairs = [...flat.matchAll(/([A-Za-z]{0,4}\d{1,4})\/([A-Za-z]{0,4}\d{1,4})/g)];
  if (pairs.length) {
    const m = pairs[pairs.length - 1];
    const left = cleanPart(m[1]);
    const right = cleanPart(m[2]);
    if (left && right) return `${left}/${right}`;
  }

  // Promos and modern sets print a bare code with no total: SWSH284, SV044.
  const code = flat.match(/\b([A-Z]{2,4}\d{2,4})\b/);
  if (code) return code[1];

  return null;
}

/* A REAL set code has two or more letters -- TG12, SV044, SWSH284. A
   SINGLE letter in front of the digits is almost always the card's set
   symbol clipping into the text, or a bit of the border read as a
   character.
   
   Seen live: the same card scanned twice came back "082/198" once and
   "E082/198" the next time. Nothing on that card says E. Sending E082 to
   the card database finds nothing at all, so the scan looks like a total
   failure when the number was actually read correctly. */
function cleanPart(part: string): string {
  const m = String(part || "").match(/^([A-Za-z]*)(\d{1,4})$/);
  if (!m) return "";
  const letters = m[1];
  return (letters.length >= 2 ? letters.toUpperCase() : "") + m[2];
}

/* ---- Guessing the card's name --------------------------------------- */

/* The name is the top line, but the top of a card also carries the stage
   ("BASIC") and the HP. Walk the first few lines and take the first that
   still reads like a name once the furniture is stripped off. */
function guessName(text: string): string | null {
  if (!text) return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6);

  for (const line of lines) {
    const cleaned = line
      .replace(/\bHP\b/gi, " ")
      .replace(/\d+/g, " ")
      .replace(/[^A-Za-z'’\-.\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length < 3) continue;
    if (NOT_A_NAME.has(cleaned.toUpperCase())) continue;
    // "Stage 2", "Stage 1" -- the digit is already gone by here.
    if (/^stage\b/i.test(cleaned)) continue;
    // "Evolves from Charmeleon" names the card BEFORE this one, not this one.
    if (/^evolves\b/i.test(cleaned)) continue;
    return cleaned;
  }
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
