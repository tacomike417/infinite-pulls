// Supabase Edge Function: infinite-grade
//
// THE INFINITE GRADE. The Pre-grading Lab sends eight photos of one card
// here. Claude inspects every one of them for defects and says what the
// card would PROBABLY grade. The person decides what to do with that.
//
// WHAT THIS IS NOT (Mike, 26 Oct 2026): not money, not fees, not "grade
// it or don't". Not a certificate. "This is about us saying we detected
// this card is either pristine or it's got these things that might throw
// it off." And never a grade off bad photos: "we never want to put out a
// false grade based on their shitty technological hangups."
//
// TWO PASSES, ONE CALL EACH
//
//   1. PHOTO CHECK. Every shot is looked at for blur, glare, darkness,
//      the card not filling the frame, the wrong side, the wrong corner.
//      Any REQUIRED shot that fails = the whole thing stops, the person is
//      told exactly which shots to redo and what to fix, and NOTHING is
//      graded. This run does not count against their monthly checks.
//
//   2. INSPECTION. All eight shots at once, with the centering the person
//      measured. Claude returns a strict JSON report: every defect with
//      which photo it is on, where on that photo (so the app can circle
//      it), how bad it is; what it could NOT check; a likely grade range.
//
// THE RULES ARE ENFORCED HERE, IN CODE, NOT ASKED FOR IN THE PROMPT
// (same idea as gallery-caption):
//   - a grade is a range of whole numbers 1..10, never wider than 3
//   - a range is only allowed when every required shot passed
//   - anything the model says it could not see is kept and shown
//   - a defect without a photo and a region is dropped (it cannot be
//     circled, so the person cannot check it, so it does not count)
//   - the answer is parsed as JSON; malformed = one retry, then an honest
//     "could not inspect this time" rather than a made-up report
//
// QUOTA: 15 completed inspections per account per calendar month during
// beta, counted in infinite_grade_runs by the service role. Reshoots and
// failures are not counted. Not a paywall; an abuse stop on Mike's card.
//
// SECRETS
//   ANTHROPIC_API_KEY                         (Mike's API org: the $100/mo)
//   INFINITE_GRADE_MODEL   optional           (default claude-sonnet-4-5)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (set for you already)
//
// Deploy:  supabase functions deploy infinite-grade --project-ref rrkyvcouxdmurwdyuugv
// Table:   supabase/infinite_grade.sql (run once)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MONTHLY_LIMIT = Number(Deno.env.get("INFINITE_GRADE_MONTHLY") || 15);
const MODEL = Deno.env.get("INFINITE_GRADE_MODEL") || "claude-sonnet-4-5";
const FETCH_TIMEOUT_MS = 90000;
const MAX_SHOT_B64 = 2_200_000;     // ~1.6 MB a shot, plenty at 1400px
const MAX_SHOTS = 10;

/* The shoot. `required` shots have to pass the photo check before anything
   is graded. The app shows these in this order with an outline for each. */
const SHOTS: Record<string, { label: string; required: boolean; what: string }> = {
  "front":     { label: "Front, straight on",        required: true,  what: "the whole front of the card, filling the frame, straight on, no tilt" },
  "back":      { label: "Back, straight on",         required: true,  what: "the whole back of the card, filling the frame, straight on" },
  "corner-tl": { label: "Top-left corner, close",    required: true,  what: "a close-up of the top-left corner of the FRONT" },
  "corner-tr": { label: "Top-right corner, close",   required: true,  what: "a close-up of the top-right corner of the FRONT" },
  "corner-bl": { label: "Bottom-left corner, close", required: true,  what: "a close-up of the bottom-left corner of the FRONT" },
  "corner-br": { label: "Bottom-right corner, close",required: true,  what: "a close-up of the bottom-right corner of the FRONT" },
  "front-tilt":{ label: "Front, tilted under a light", required: true, what: "the front of the card tilted so a light rakes across the surface, to show scratches, print lines, dents" },
  "back-tilt": { label: "Back, tilted under a light",  required: false, what: "the back of the card tilted under a light" },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Sign in to use the Pre-grading Lab." }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let userId: string;
  try {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data?.user) return json({ error: "Sign in to use the Pre-grading Lab." }, 401);
    userId = data.user.id;
  } catch {
    return json({ error: "Sign in to use the Pre-grading Lab." }, 401);
  }

  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ status: "off", reason: "The Infinite Grade isn't switched on yet." });

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  // ---- the shots ---------------------------------------------------------
  const shotsIn = Array.isArray(payload?.shots) ? payload.shots.slice(0, MAX_SHOTS) : [];
  const shots: { kind: string; media_type: string; data: string }[] = [];
  for (const s of shotsIn) {
    const kind = String(s?.kind || "");
    if (!SHOTS[kind]) continue;
    let b64 = String(s?.image || "");
    let media = "image/jpeg";
    const m = b64.match(/^data:(image\/(?:jpeg|png|webp));base64,/);
    if (m) { media = m[1]; b64 = b64.slice(m[0].length); }
    b64 = b64.trim();
    if (!b64 || b64.length > MAX_SHOT_B64) continue;
    shots.push({ kind, media_type: media, data: b64 });
  }
  const have = new Set(shots.map((s) => s.kind));
  const missing = Object.keys(SHOTS).filter((k) => SHOTS[k].required && !have.has(k));
  if (missing.length) return json({ status: "reshoot", shots: missing.map((k) => ({ kind: k, ok: false, why: "missing", fix: `Take the ${SHOTS[k].label.toLowerCase()} shot.` })) });

  // ---- quota (only completed inspections count) ---------------------------
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  let used = 0;
  try {
    const { count } = await admin.from("infinite_grade_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("completed", true).gte("created_at", monthStart.toISOString());
    used = count || 0;
  } catch { /* a missing table must not block the lab; it just will not count */ }
  if (used >= MONTHLY_LIMIT) {
    return json({ status: "limit", used, limit: MONTHLY_LIMIT, reason: `You've used your ${MONTHLY_LIMIT} Infinite Grades for this month. More on the 1st.` });
  }

  const card = {
    name: String(payload?.card?.name || "").slice(0, 120),
    set: String(payload?.card?.set || "").slice(0, 120),
    num: String(payload?.card?.num || "").slice(0, 40),
  };
  const centering = payload?.centering && typeof payload.centering === "object" ? payload.centering : null;

  // ---- pass 1: are the photos good enough? --------------------------------
  let check: any;
  try {
    check = await askJson(photoCheckPrompt(shots), shots);
  } catch (e) {
    return json({ status: "error", reason: "Could not look at the photos just now. Try again in a minute." });
  }
  const results: { kind: string; ok: boolean; why: string; fix: string }[] = [];
  let anyRequiredBad = false;
  for (const s of shots) {
    const r = (check?.shots || []).find((x: any) => x?.kind === s.kind) || {};
    const ok = r.ok === true;
    const why = String(r.why || (ok ? "" : "not clear enough")).slice(0, 160);
    const fix = String(r.fix || (ok ? "" : "Retake it in brighter light, closer, and hold still.")).slice(0, 200);
    results.push({ kind: s.kind, ok, why, fix });
    if (!ok && SHOTS[s.kind].required) anyRequiredBad = true;
  }
  if (anyRequiredBad) {
    // Not counted, not graded. The person is told exactly what to redo.
    try { await admin.from("infinite_grade_runs").insert({ user_id: userId, card_name: card.name, completed: false, result: { status: "reshoot", shots: results } }); } catch { /* fine */ }
    return json({ status: "reshoot", shots: results });
  }

  // ---- pass 2: the inspection ----------------------------------------------
  let report: any;
  try {
    report = await askJson(inspectPrompt(card, centering, shots), shots);
  } catch {
    return json({ status: "error", reason: "The inspection didn't come back this time. Nothing was counted. Try again in a minute." });
  }
  const clean = enforce(report, shots, centering);
  if (!clean) return json({ status: "error", reason: "The inspection came back in a shape we couldn't trust, so we're not showing it. Nothing was counted. Try again." });

  try {
    await admin.from("infinite_grade_runs").insert({ user_id: userId, card_name: card.name, completed: true, result: clean });
  } catch { /* the report still goes back; the count is best effort */ }

  return json({ status: "ok", used: used + 1, limit: MONTHLY_LIMIT, report: clean, photos: results });
});

/* ---- prompts --------------------------------------------------------------- */

function shotList(shots: { kind: string }[]) {
  return shots.map((s, i) => `Image ${i + 1} = "${s.kind}": ${SHOTS[s.kind].what}.`).join("\n");
}

function photoCheckPrompt(shots: { kind: string }[]) {
  return `You are checking photos of a Pokémon trading card before a condition inspection. For EACH image decide if it is good enough to judge the card's condition from.

${shotList(shots)}

A photo is NOT ok if: it is blurry; there is glare or a reflection covering part of the card; it is too dark to see the surface; the card is small in the frame (less than about half the image); it is the wrong side or the wrong corner for what it is supposed to be; the card is in a sleeve or case that hides it; the corner close-ups do not clearly show the corner tip and the edges beside it; the tilted shot shows no light raking across the surface.

Be strict. A photo that is "probably fine" is not fine. A bad photo leads to a wrong grade and that costs the owner money.

Reply with ONLY this JSON, nothing else:
{"shots":[{"kind":"front","ok":true,"why":"","fix":""}, ...one per image, in order...]}
"why" is a few plain words on what is wrong (empty if ok). "fix" is one short sentence telling the person how to retake it (empty if ok). No markdown.`;
}

function inspectPrompt(card: { name: string; set: string; num: string }, centering: any, shots: { kind: string }[]) {
  const cardLine = card.name ? `The card is ${card.name}${card.set ? ", " + card.set : ""}${card.num ? " #" + card.num : ""}.` : "The card has not been identified.";
  const centerLine = centering
    ? `The owner measured centering on the straight-on photos: front left/right ${centering.front?.lr ?? "?"}, top/bottom ${centering.front?.tb ?? "?"}; back left/right ${centering.back?.lr ?? "?"}, top/bottom ${centering.back?.tb ?? "?"} (bigger margin / smaller margin, 50 = perfect). Check these against the photos and use your own reading if theirs looks wrong.`
    : "Centering was not measured; read it from the straight-on photos.";
  return `You are a careful trading-card condition inspector, like a grader's assistant doing a pre-submission review. ${cardLine}

${shotList(shots)}

${centerLine}

Inspect EVERY image for every defect you can actually see. Look for: corner whitening, soft or rounded corners, dinged corners; edge chipping, edge whitening, edge wear; creases, bends, dents, indentations; scratches, print lines, surface wear, holo scratching; stains, dirt, residue; print defects, color fading, off-color, miscut, factory damage; and centering.

RULES, strictly:
- Only report what is VISIBLE in these photos. If something cannot be judged from them (for example the back corners were not photographed up close), list it under "unseen" instead of guessing.
- Every defect must say which image it is on (the image's kind) and WHERE on that image as a box of fractions 0..1 (x, y from the top-left, w, h), tight around the defect, so the owner can look at exactly that spot.
- Severity is one of: "light", "moderate", "heavy".
- Grade range: whole numbers 1 to 10, PSA-style, at most 3 apart (e.g. 8-9). Base it on the worst defects and the centering. A card with a crease or heavy damage is 1-5. A card with heavy corner wear is rarely above 6. Clean corners, clean edges, clean surface and good centering (within 55/45 front) is 9-10. Be conservative: when in doubt, the lower end.
- If the photos are good but something important is still unseen, widen the range toward the low end and say so in "unseen".
- No sales talk, no advice about whether to grade, no prices.

Reply with ONLY this JSON, nothing else, no markdown:
{
 "centering": {"front": {"lr": 55, "tb": 52}, "back": {"lr": 60, "tb": 58}},
 "defects": [{"kind": "corner whitening", "image": "corner-tl", "box": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}, "severity": "light", "note": "small white spot at the tip"}],
 "unseen": ["back corners up close"],
 "grade": {"low": 8, "high": 9, "why": "one sentence on what set the range"},
 "summary": "two plain sentences on the card's condition, no advice"
}`;
}

/* ---- the call --------------------------------------------------------------- */

async function askJson(prompt: string, shots: { media_type: string; data: string }[]) {
  const content: unknown[] = [];
  shots.forEach((s, i) => {
    content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: s.media_type, data: s.data } });
  });
  content.push({ type: "text", text: prompt });

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, temperature: 0, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`provider returned ${res.status}`);
    const data = await res.json();
    const text = (data?.content || []).map((c: any) => c?.text || "").join("");
    const parsed = parseJson(text);
    if (parsed) return parsed;
  }
  throw new Error("no json");
}

function parseJson(text: string) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch { /* try the first {...} block */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a > -1 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* no */ } }
  return null;
}

/* ---- the rules, in code -------------------------------------------------- */

function enforce(r: any, shots: { kind: string }[], centering: any) {
  if (!r || typeof r !== "object") return null;
  const kinds = new Set(shots.map((s) => s.kind));
  const SEV = new Set(["light", "moderate", "heavy"]);
  const pct = (v: any) => { const n = Math.round(Number(v)); return isFinite(n) && n >= 50 && n <= 100 ? n : null; };
  const frac = (v: any) => { const n = Number(v); return isFinite(n) ? Math.min(1, Math.max(0, n)) : null; };

  const defects = (Array.isArray(r.defects) ? r.defects : []).map((d: any) => {
    if (!d || !kinds.has(String(d.image))) return null;
    const b = d.box || {};
    const x = frac(b.x), y = frac(b.y), w = frac(b.w), h = frac(b.h);
    if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0) return null;
    return {
      kind: String(d.kind || "defect").slice(0, 60),
      image: String(d.image),
      box: { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) },
      severity: SEV.has(String(d.severity)) ? String(d.severity) : "moderate",
      note: String(d.note || "").slice(0, 200),
    };
  }).filter(Boolean).slice(0, 40);

  const unseen = (Array.isArray(r.unseen) ? r.unseen : []).map((u: any) => String(u).slice(0, 120)).filter(Boolean).slice(0, 12);
  if (!kinds.has("back-tilt") && !unseen.some((u: string) => /back/i.test(u) && /tilt|surface|scratch/i.test(u))) unseen.push("back surface under a raking light (no tilted back shot)");
  unseen.push("back corners up close (not part of the shoot yet)");

  let low = Math.round(Number(r?.grade?.low)), high = Math.round(Number(r?.grade?.high));
  if (!isFinite(low) || !isFinite(high)) return null;
  low = Math.min(10, Math.max(1, low)); high = Math.min(10, Math.max(1, high));
  if (high < low) [low, high] = [high, low];
  if (high - low > 3) high = low + 3;
  // A heavy defect or a crease caps the top, whatever the model said.
  const heavy = defects.some((d: any) => d.severity === "heavy" || /crease|bend/i.test(d.kind));
  if (heavy && high > 6) high = 6;
  if (heavy && low > 6) low = Math.min(low, 6);

  const c = r.centering || {};
  const cent = {
    front: { lr: pct(c?.front?.lr) ?? pct(centering?.front?.lr), tb: pct(c?.front?.tb) ?? pct(centering?.front?.tb) },
    back: { lr: pct(c?.back?.lr) ?? pct(centering?.back?.lr), tb: pct(c?.back?.tb) ?? pct(centering?.back?.tb) },
  };

  return {
    centering: cent,
    defects,
    unseen: [...new Set(unseen)],
    grade: { low, high, why: String(r?.grade?.why || "").slice(0, 300) },
    summary: String(r.summary || "").slice(0, 500),
    model: MODEL,
    at: new Date().toISOString(),
  };
}
