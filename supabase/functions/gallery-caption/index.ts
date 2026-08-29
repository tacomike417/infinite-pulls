// Supabase Edge Function: gallery-caption
//
// Writes the three caption options the admin panel offers when Jeff
// uploads a photo. He taps one. He never sees this, and he never sees a
// blank box.
//
// WHY THIS RUNS SERVER-SIDE AND NOT IN THE BROWSER
//
// Three reasons, and the third is the one that matters most.
//
// 1. An AI provider key cannot go in the browser. config.js is public by
//    design; anything put there is public too.
//
// 2. The prompt itself lives in the `marketing_prompts` table, edited at
//    /admin/?prompts=1 without a deploy. Reading it here means the
//    wording can be tuned from a phone and the next caption uses it.
//
// 3. THE GUARDRAILS ARE ENFORCED HERE, IN CODE, NOT ASKED FOR IN THE
//    PROMPT. A prompt that says "under 30 words" is a request. The check
//    below is a rule. Same for the banned list, the hashtag rule and the
//    bare-word could-never-should rule — a model that forgets gets its answer
//    rejected and asked again rather than handing Jeff something to
//    publish. Anything that survives all of it is safe to put in front of
//    him; anything that does not never reaches the panel.
//
// WHY IT IS STAFF-ONLY
//
// This function costs money per call. The anon key is public. Without the
// staff check below, anybody who viewed the site could run up a bill on
// the shop's account for as long as they felt like it. The check is not
// about secrecy — there is nothing secret in a caption — it is about
// somebody else's credit card.
//
// SECRETS
//
//   ANTHROPIC_API_KEY   or   OPENAI_API_KEY     (either; Anthropic wins
//                                                if both are set)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY     (set for you already)
//
// Deploy:  supabase functions deploy gallery-caption
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROMPT_SLUG = "gallery-caption";
const FETCH_TIMEOUT_MS = 25000;
const IMAGE_TIMEOUT_MS = 10000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// The spec is "one or two short sentences and under 30 words".
//
// WORTH KNOWING, because it is a real trade and not a free change: Facebook
// folds a post behind "See More" at roughly 80 characters, which is about
// 13 words, and posts under that fold see meaningfully higher engagement.
// A 29-word caption will be truncated in the feed. The spec wins anyway —
// a caption that gets rejected and never appears is worse than one that
// folds — but if engagement ever looks flat, this is the first place to
// look.
const MIN_WORDS = 4;
const MAX_WORDS = 29;
const MAX_CHARS = 190;

// The half of the house style that is a rule rather than a preference.
// Matched case-insensitively as whole words.
//
// Three groups, and the first is the one that matters most.
const BANNED = [
  // 1. DIMINISHING THE HOBBY. These customers treat this as a real market
  //    and a real investment. A joke about cardboard or wasted money does
  //    not read as the shop being humble — it reads as the shop calling
  //    them a mark, and they leave without telling anybody why. There is
  //    no good caption for this shop containing the word "cardboard".
  "cardboard", "waste of money", "wasted money", "just paper",
  "kids' cards", "kids cards", "childrens cards", "children's cards",

  // 2. BEGGING FOR ENGAGEMENT. Asking is the shop requesting a favour, and
  //    it fails visibly: no replies makes the post look abandoned. The
  //    caption has to earn the comment instead.
  "what do you think", "thoughts", "comment below", "tag a friend",
  "who else", "let us know", "drop a", "sound off", "weigh in",

  // 3. FAKE DEADPAN AND RELUCTANT ACCEPTANCE. Named explicitly in the
  //    spec. These are the tics of the previous, drier voice — including
  //    a line the old prompt used as a worked example.
  "we have made peace with it", "made peace with it",
  "we are fine with that", "we're fine with that",
  "apparently", "somehow", "this happened", "we have seen this before",
  "we've seen this before",

  // 4. Talking down, instructing, or manufacturing urgency.
  //
  //    "should", "must" and "need to" are banned as bare words, by the
  //    shop's own standing rule: could, never should. This is stricter
  //    than it strictly needs to be — it will occasionally reject a
  //    perfectly innocent line like "this must be somebody's grail" — and
  //    that is the deliberate choice. The cost of a false rejection is one
  //    extra retry nobody sees. The cost of a false pass is a sentence
  //    that tells a customer what they owe the shop.
  //
  //    "have to" is not on the list bare; it is far more common in
  //    innocent phrasing, so only the second-person form is blocked.
  "kids", "guys", "folks", "gang", "fam", "y'all", "yall",
  "should", "must", "need to", "you have to",
  "don't miss", "dont miss", "miss out", "act now", "hurry",
  "limited time", "while supplies last", "sleeping on",
  "check it out", "take a look", "swipe up", "link in bio",
  "excited to announce", "proud to present", "introducing",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "This function is not configured yet." }, 500);
  }

  // ---- who is asking -----------------------------------------------------
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Sign in to the admin panel first." }, 401);

  const staff = await isShopStaff(supabaseUrl, serviceKey, token);
  if (!staff) return json({ error: "Only the shop can write captions." }, 403);

  // ---- what they sent ----------------------------------------------------
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const imageUrl = String(payload?.image_url || "").trim();
  const keyword = String(payload?.keyword || "").trim().slice(0, 80);
  const notes = String(payload?.notes || "").trim().slice(0, 300);
  const chipIds: string[] = Array.isArray(payload?.chips)
    ? (payload.chips as unknown[]).map((c) => String(c)).slice(0, 6)
    : [];

  // ---- the prompt, as it currently reads in the panel ---------------------
  const prompt = await loadPrompt(supabaseUrl, serviceKey);
  if (!prompt) {
    return json({ error: "The caption prompt has not been set up yet. Run supabase/gallery_caption.sql." }, 500);
  }

  // A chip's `instruction` is what reaches the model; its `label` never
  // does. Same arrangement as the poster prompt's palette — "Just Pulled"
  // is a word on a button, and the sentence behind it is the useful part.
  const options = Array.isArray(prompt.options) ? prompt.options : [];
  const chipText = chipIds
    .map((id) => options.find((o: any) => o?.id === id)?.instruction)
    .filter(Boolean)
    .join(" ");

  const filled = fillTemplate(prompt.template, {
    photo: imageUrl
      ? "The photograph is attached. Describe what is actually in it — never guess at a card, a set or a price you cannot see."
      : "No photograph was provided. Work from the notes below only, and stay general rather than inventing detail.",
    chips: chipText || "A photo from the shop.",
    keyword: keyword || "(none given — pick the most obvious subject of the photo)",
    notes: notes ? `Also worth knowing: ${notes}` : "",
  });

  // ---- the image ----------------------------------------------------------
  let image: { media_type: string; data: string } | null = null;
  if (imageUrl) {
    try {
      image = await fetchImageAsBase64(imageUrl);
    } catch (_) {
      // A photo we cannot read is not a reason to fail. The model works
      // from the chips instead and Jeff still gets three options.
      image = null;
    }
  }

  // ---- ask, check, and ask once more if it came back wrong ---------------
  const provider = Deno.env.get("ANTHROPIC_API_KEY")
    ? "anthropic"
    : Deno.env.get("OPENAI_API_KEY")
    ? "openai"
    : null;
  if (!provider) {
    return json({ error: "No AI provider key is set. See supabase/SETUP.md." }, 500);
  }

  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    try {
      raw = await ask(provider, attempt === 0 ? filled : filled + "\n\nYOUR LAST ANSWER WAS REJECTED: " +
        lastProblem + "\nFix it and reply with JSON only.", image);
    } catch (err) {
      return json({ error: `The caption writer did not answer: ${(err as Error)?.message || err}` }, 502);
    }

    const parsed = parseJson(raw);
    if (!parsed) { lastProblem = "That was not valid JSON."; continue; }

    const checked = validate(parsed);
    if (checked.ok) {
      return json({
        captions: checked.captions,
        slug: cleanSlug(parsed.slug || keyword || "photo"),
        title: str(parsed.title, 60),
        alt_text: str(parsed.alt_text, 125),
        meta_description: str(parsed.meta_description, 155),
        hashtags: Array.isArray(parsed.hashtags)
          ? parsed.hashtags.map((h: unknown) => String(h).replace(/^#/, "").toLowerCase()).slice(0, 8)
          : [],
      });
    }
    lastProblem = checked.problem;
  }

  // Both attempts failed the house rules. Say so plainly rather than
  // handing over something that breaks them — the panel offers him a
  // plain caption box instead, which is a fine outcome.
  return json({ error: "Could not get three captions that fit. You could write one yourself, or try again.", detail: lastProblem }, 422);
});

/* ------------------------------------------------------------------ */

async function isShopStaff(url: string, key: string, jwt: string): Promise<boolean> {
  // Who the token belongs to.
  const meRes = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: key },
    signal: AbortSignal.timeout(8000),
  });
  if (!meRes.ok) return false;
  const me = await meRes.json();
  if (!me?.id) return false;

  // Are they on the list. Service role, because shop_staff is not
  // readable by the account being checked.
  const res = await fetch(
    `${url}/rest/v1/shop_staff?user_id=eq.${encodeURIComponent(me.id)}&select=user_id`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function loadPrompt(url: string, key: string) {
  const res = await fetch(
    `${url}/rest/v1/marketing_prompts?slug=eq.${PROMPT_SLUG}&select=template,options,enabled`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.enabled === false || !row.template) return null;
  return row;
}

/* A placeholder the form left empty takes its whole line with it, rather
 * than leaving "Notes:" with nothing after it — a prompt with blanks in it
 * reads as a question, and a model will happily invent an answer. Same
 * behaviour as the poster prompt, deliberately.
 *
 * A placeholder the template asks for that we do not have is left exactly
 * as written, so a typo like {{keyworm}} shows up in the output instead of
 * silently deleting the keyword. */
function fillTemplate(template: string, values: Record<string, string>): string {
  return template
    .split("\n")
    .map((line) => {
      let dropLine = false;
      const out = line.replace(/\{\{(\w+)\}\}/g, (whole, name) => {
        if (!(name in values)) return whole;
        const v = values[name];
        if (!v) { dropLine = true; return ""; }
        return v;
      });
      return dropLine ? null : out;
    })
    .filter((l) => l !== null)
    .join("\n");
}

async function fetchImageAsBase64(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`image ${res.status}`);

  const type = res.headers.get("content-type") || "image/jpeg";
  if (!type.startsWith("image/")) throw new Error("not an image");

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error("image too large");

  // Chunked, because String.fromCharCode(...bigArray) blows the stack on
  // anything above a few hundred kilobytes.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return { media_type: type.split(";")[0], data: btoa(binary) };
}

async function ask(provider: string, prompt: string, image: { media_type: string; data: string } | null) {
  if (provider === "anthropic") {
    const content: unknown[] = [];
    if (image) {
      content.push({ type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } });
    }
    content.push({ type: "text", text: prompt });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: Deno.env.get("CAPTION_MODEL") || "claude-sonnet-4-5",
        max_tokens: 1200,
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`provider returned ${res.status}`);
    const data = await res.json();
    return (data?.content || []).map((c: any) => c?.text || "").join("");
  }

  const content: unknown[] = [{ type: "text", text: prompt }];
  if (image) {
    content.push({ type: "image_url", image_url: { url: `data:${image.media_type};base64,${image.data}` } });
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
    },
    body: JSON.stringify({
      model: Deno.env.get("CAPTION_MODEL") || "gpt-4o-mini",
      max_tokens: 1200,
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`provider returned ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

/* Models sometimes wrap JSON in prose or a code fence however firmly they
 * were asked not to. Take the outermost braces and try those. */
function parseJson(raw: string): any | null {
  const trimmed = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  try { return JSON.parse(trimmed); } catch (_) {}
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(trimmed.slice(start, end + 1)); } catch (_) { return null; }
}

function wordCount(s: string) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function bannedIn(s: string): string | null {
  const hay = " " + s.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ") + " ";
  for (const term of BANNED) {
    if (hay.includes(" " + term + " ") || hay.includes(" " + term + "'")) return term;
  }
  return null;
}

/* The rules, applied. Not asked for — applied. */
function validate(parsed: any): { ok: true; captions: any[] } | { ok: false; problem: string } {
  const list = Array.isArray(parsed?.captions) ? parsed.captions : [];
  if (list.length < 3) return { ok: false, problem: "Give exactly three captions." };

  const captions = [];
  for (const c of list.slice(0, 3)) {
    const text = String(c?.text || "").replace(/\s+/g, " ").trim();
    const style = String(c?.style || "").slice(0, 24);

    if (!text) return { ok: false, problem: "One caption was empty." };

    const words = wordCount(text);
    if (words < MIN_WORDS || words > MAX_WORDS) {
      return { ok: false, problem: `"${text}" is ${words} words. Every caption must be ${MIN_WORDS}-${MAX_WORDS} words.` };
    }
    if (text.length > MAX_CHARS) {
      return { ok: false, problem: `"${text}" is ${text.length} characters. The limit is ${MAX_CHARS}.` };
    }

    const bad = bannedIn(text);
    if (bad) return { ok: false, problem: `"${text}" uses "${bad}", which is on the never-write list.` };

    if ((text.match(/!/g) || []).length > 1) {
      return { ok: false, problem: `"${text}" has more than one exclamation mark.` };
    }

    // The spec says no hashtags. They are returned separately for
    // Instagram and never belong in the caption itself.
    if (text.includes("#")) {
      return { ok: false, problem: `"${text}" contains a hashtag. Hashtags are returned separately, never in a caption.` };
    }

    captions.push({ style, text, words, chars: text.length });
  }

  // Three variations of one joke is one option, not three.
  const shapes = new Set(captions.map((c) => c.text.toLowerCase().slice(0, 18)));
  if (shapes.size < 3) return { ok: false, problem: "The three captions are too alike. Make them genuinely different." };

  return { ok: true, captions };
}

function str(v: unknown, max: number) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanSlug(v: unknown) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70)
    .replace(/-$/, "") || "photo";
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
