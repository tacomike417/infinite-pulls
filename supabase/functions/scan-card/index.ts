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

  /* SEALED PRODUCT HAS NO CARD NUMBER. A booster box has a SET NAME on it
     -- "Obsidian Flames" -- which is exactly what the sealed search wants,
     and no 4/102 anywhere. Reading it as a card was worse than useless:
     the promo-code branch of findNumber() would happily return "SV03" off
     a box, and the sealed search matches a set id exactly, so the app
     could confidently show a real but completely unrelated set's boxes
     and prices as the answer.

     So in sealed mode the function returns the text lines and lets the
     client match them against the set list it already has. */
  const mode = String(payload?.mode || "en");
  if (mode === "sealed") {
    const lines = candidateLines(text);
    const sealedResult = lines.length
      ? { available: true, matched: true, mode: "sealed", lines, source: "vision" }
      : { available: true, matched: false, reason: errText || "No readable text on that box" };
    await logScan(admin, userId, {
      matched: lines.length > 0, card_name: lines[0] || null, card_number: null,
      duration_ms: duration, error: errText,
    });
    return json(sealedResult);
  }

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

  await logScan(admin, userId, {
    matched: !!(number || name),
    card_name: name,
    card_number: number,
    duration_ms: duration,
    error: errText,
  });

  return json(result);
});

async function logScan(admin: any, userId: string | null, row: any) {
  const write = async () => {
    try {
      await admin.from("card_scans").insert({
        user_id: userId,
        service: "google_vision",
        matched: !!row.matched,
        card_name: row.card_name || null,
        card_number: row.card_number || null,
        duration_ms: row.duration_ms,
        error: row.error ? String(row.error).slice(0, 800) : null,
      });
    } catch { /* never let logging break a scan */ }
  };
  // @ts-ignore -- present on Supabase's runtime, absent when running local
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(write());
    return;
  }
  await write();
}

/* The lines off a sealed box worth trying as a set name, longest first --
   "Obsidian Flames" beats "Pokemon" and beats "36 BOOSTER PACKS". */
function candidateLines(text: string): string[] {
  if (!text) return [];
  return text.split("\n")
    .map((l) => l.replace(/[^\p{L}\p{N}'’\-:&.\s]/gu, " ").replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 4 && /\p{L}{3}/u.test(l) && !isFurniture(l))
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);
}

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
    /* Punctuation and digits go; LETTERS DO NOT, in any alphabet. The
       first version of this stripped everything outside A-Z, which meant a
       Japanese card's name was deleted down to nothing and the loop walked
       on and returned whatever Latin debris was left further down -- a
       glared JP Arceus came back as the name "VSTAR", and a JP promo as
       "S-P". Searching those returns real, unrelated cards with real
       prices. */
    const cleaned = line
      .replace(/\bHP\b/gi, " ")
      .replace(/[0-9]+/g, " ")
      .replace(/[^\p{L}'’\-.\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length < 3) continue;
    if (isFurniture(cleaned)) continue;
    return cleaned;
  }
  return null;
}

/* Is this line part of the card's furniture rather than its name?
 *
 * The check folds accents first. It did not, and so "Pokémon" -- which is
 * on the copyright line of every single card -- became "Pok mon", sailed
 * past a stopword list that contained "POKEMON", and got searched for. */
function isFurniture(s: string): boolean {
  /* Accents folded so "Pokémon" matches "POKEMON", and a leading count
     dropped so "36 BOOSTER PACKS" matches "BOOSTER PACKS". */
  const flat = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/^[0-9]+\s*/, "").trim();
  if (NOT_A_NAME.has(flat)) return true;
  if (/^STAGE\b/.test(flat)) return true;          // "Stage 2" -> "STAGE"
  if (/^EVOLVES\b/.test(flat)) return true;        // names the PREVIOUS card
  if (/^POKEMON\b/.test(flat)) return true;        // wordmark, copyright line
  if (/^ILLUS\b/.test(flat)) return true;
  /* Words printed on every sealed box. No set and no card is called any of
     these, and without them "TRADING CARD GAME" outranks "Obsidian Flames"
     on the longest-line-first sort and gets tried against the set list
     first. */
  if (/^(TRADING CARD GAME|TRADING CARDS?|BOOSTER|BOOSTER PACKS?|BOOSTER BOX|ELITE TRAINER BOX|PACKS?|CARDS?|CODE CARD|NINTENDO|CREATURES|GAMEFREAK|WIZARDS|THE POKEMON COMPANY)$/.test(flat)) return true;
  /* Suffixes are not names. A Japanese card's name is kana, so when the
     kana is unreadable these Latin fragments are all that survives -- and
     TCGdex's name filter is a substring match, so "VSTAR" alone returns a
     pile of unrelated cards. */
  if (/^(V|VMAX|VSTAR|GX|EX|BREAK|PRISM|S-P|SR|HR|UR|RR|AR|CHR|CSR)$/.test(flat.replace(/\s+/g, ""))) return true;
  return false;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
