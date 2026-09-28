/* INFINITE MESSENGER -- the server half (28 Sep 2026, private test).
 *
 * Every message goes through here. Nothing is saved until it passes:
 *   * WORDS  -- sexual talk and slurs are refused outright; ordinary
 *               cussing is starred out (f***).
 *   * PHOTOS -- the picture is fetched from our photo store and checked by
 *               Google SafeSearch (the same Google Vision key the card
 *               scanner uses). Adult content is refused and logged; a
 *               second refused photo shuts that person's messaging off.
 *   * WHO    -- both people have to be on the dm_access list.
 *
 *   open  { to }                                 -> { thread_id }
 *   send  { thread_id, body?, photo_key?, share_key? } -> { message }
 *
 * Deploy: npx supabase functions deploy messages --project-ref rrkyvcouxdmurwdyuugv
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PHOTO_BASE = (Deno.env.get("CARD_PHOTO_BASE") || "https://infinite-pulls-cards.mnasvadi.workers.dev").replace(/\/+$/, "");
const VISION_URL = "https://vision.googleapis.com/v1/images:annotate";
const PER_MINUTE = 20;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

/* ---------------- the words ---------------- */
const LEET: Record<string, string> = {
  a: "[a@4*]", e: "[e3*]", i: "[i1!|*]", o: "[o0*]", s: "[s$5*]", u: "[uv*]", t: "[t7+]", g: "[g9]",
};
const pat = (w: string) =>
  w.split("").map((ch) => (ch === " " ? "\\s*" : (LEET[ch] || ch) + "+")).join("[\\W_]*");
const words = (list: string[]) => new RegExp("(?<![a-z])(?:" + list.map(pat).join("|") + ")(?![a-z])", "gi");

/* refused outright: sexual talk and slurs (a kid-safe app) */
const BLOCK = words([
  "nudes", "nude", "naked", "send pics", "dick pic", "dickpic", "sext", "sexting", "horny", "porn", "porno",
  "blowjob", "handjob", "onlyfans", "nsfw", "boobs", "tits", "cum",
  "nigger", "nigga", "faggot", "fag", "retard", "tranny", "chink", "spic", "kike", "wetback",
]);
/* starred out: ordinary cussing */
const CUSS = words([
  "motherfucker", "fucking", "fucker", "fuck", "shit", "bullshit", "bitch", "asshole", "bastard",
  "cunt", "dick", "pussy", "cock", "piss", "whore", "slut",
]);
const star = (s: string) => s.replace(CUSS, (m) => m[0] + "*".repeat(Math.max(1, m.length - 1)));

/* ---------------- the photo ---------------- */
const LEVEL: Record<string, number> = { UNKNOWN: 0, VERY_UNLIKELY: 1, UNLIKELY: 2, POSSIBLE: 3, LIKELY: 4, VERY_LIKELY: 5 };

async function photoIsClean(key: string, visionKey: string): Promise<{ ok: boolean; why?: string }> {
  const url = PHOTO_BASE + "/p/" + key.split("/").map(encodeURIComponent).join("/");
  const r = await fetch(url);
  if (!r.ok) return { ok: false, why: "missing" };
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) return { ok: false, why: "too big" };
  const v = await fetch(VISION_URL + "?key=" + encodeURIComponent(visionKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ image: { content: encodeBase64(buf) }, features: [{ type: "SAFE_SEARCH_DETECTION" }] }] }),
  });
  if (!v.ok) return { ok: false, why: "check failed" };
  const out = await v.json();
  const s = out?.responses?.[0]?.safeSearchAnnotation;
  if (!s) return { ok: false, why: "check failed" };
  const adult = LEVEL[s.adult] || 0, racy = LEVEL[s.racy] || 0, violence = LEVEL[s.violence] || 0;
  if (adult >= LEVEL.LIKELY) return { ok: false, why: "adult:" + s.adult };
  if (racy >= LEVEL.VERY_LIKELY) return { ok: false, why: "racy:" + s.racy };
  if (violence >= LEVEL.VERY_LIKELY) return { ok: false, why: "violence:" + s.violence };
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Log in to send messages." });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let me = "";
  try {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data?.user) return json({ error: "Log in to send messages." });
    me = data.user.id;
  } catch {
    return json({ error: "Log in to send messages." });
  }

  const allowed = async (id: string) => {
    const { data } = await admin.from("dm_access").select("user_id").eq("user_id", id).maybeSingle();
    return !!data;
  };
  if (!(await allowed(me))) return json({ error: "Messages aren't turned on for your account yet." });

  let p: any = {};
  try { p = await req.json(); } catch { return json({ error: "Bad request." }); }

  /* ---- open (or find) the chat with someone ---- */
  if (p.action === "open") {
    const to = String(p.to || "");
    if (!/^[0-9a-f-]{36}$/.test(to) || to === me) return json({ error: "Pick someone to message." });
    if (!(await allowed(to))) return json({ error: "You can't message that person yet." });
    const [a, b] = me < to ? [me, to] : [to, me];
    const { data: found } = await admin.from("dm_threads").select("id").eq("user_a", a).eq("user_b", b).maybeSingle();
    if (found) return json({ thread_id: found.id });
    const { data: made, error } = await admin.from("dm_threads").insert({ user_a: a, user_b: b }).select("id").single();
    if (error) {
      const { data: again } = await admin.from("dm_threads").select("id").eq("user_a", a).eq("user_b", b).maybeSingle();
      if (again) return json({ thread_id: again.id });
      return json({ error: "Could not start that chat." });
    }
    return json({ thread_id: made.id });
  }

  /* ---- send ---- */
  if (p.action === "send") {
    const threadId = String(p.thread_id || "");
    const { data: t } = await admin.from("dm_threads").select("id, user_a, user_b").eq("id", threadId).maybeSingle();
    if (!t || (t.user_a !== me && t.user_b !== me)) return json({ error: "That chat isn't yours." });
    const other = t.user_a === me ? t.user_b : t.user_a;
    if (!(await allowed(other))) return json({ error: "They can't get messages right now." });

    const since = new Date(Date.now() - 60_000).toISOString();
    const { count } = await admin.from("dm_messages").select("id", { count: "exact", head: true })
      .eq("sender_id", me).gt("created_at", since);
    if ((count || 0) >= PER_MINUTE) return json({ error: "Slow down a little, then try again." });

    let body: string | null = typeof p.body === "string" ? p.body.trim().slice(0, 2000) : null;
    if (body === "") body = null;
    const photoKey: string | null = typeof p.photo_key === "string" && p.photo_key ? p.photo_key : null;
    const shareKey: string | null = typeof p.share_key === "string" && p.share_key ? p.share_key : null;
    if (!body && !photoKey && !shareKey) return json({ error: "Type something first." });
    if (shareKey && !/^[cprl]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(shareKey)) {
      return json({ error: "That can't be shared." });
    }
    if (photoKey && (!/^[A-Za-z0-9/_.-]{3,300}$/.test(photoKey) || photoKey.includes(".."))) {
      return json({ error: "That photo can't be sent." });
    }

    if (body) {
      BLOCK.lastIndex = 0;
      if (BLOCK.test(body)) {
        await admin.from("dm_flags").insert({ user_id: me, kind: "words", detail: body.slice(0, 300) });
        return json({ error: "Keep it clean. That message wasn't sent." });
      }
      CUSS.lastIndex = 0;
      body = star(body);
    }

    if (photoKey) {
      let visionKey: string | null = null;
      try {
        const { data } = await admin.from("app_secrets").select("value").eq("name", "google_vision").maybeSingle();
        if (data?.value) visionKey = String(data.value).trim();
      } catch { /* fall through */ }
      if (!visionKey) visionKey = Deno.env.get("GOOGLE_VISION_KEY") || null;
      if (!visionKey) return json({ error: "Photos can't be checked right now, so they can't be sent." });

      let check: { ok: boolean; why?: string };
      try { check = await photoIsClean(photoKey, visionKey); } catch { check = { ok: false, why: "check failed" }; }
      if (!check.ok) {
        if (check.why && /^(adult|racy|violence)/.test(check.why)) {
          await admin.from("dm_flags").insert({ user_id: me, kind: "photo", detail: check.why + " " + photoKey });
          /* the second one in 30 days turns their messaging off (moderators excepted) */
          const month = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
          const { count: strikes } = await admin.from("dm_flags").select("id", { count: "exact", head: true })
            .eq("user_id", me).eq("kind", "photo").gt("created_at", month);
          const { data: mod } = await admin.from("moderators").select("user_id").eq("user_id", me).maybeSingle();
          if ((strikes || 0) >= 2 && !mod) await admin.from("dm_access").delete().eq("user_id", me);
          return json({ error: "That photo isn't allowed here, so it wasn't sent." });
        }
        return json({ error: "Couldn't check that photo. Try again." });
      }
    }

    const { data: msg, error } = await admin.from("dm_messages")
      .insert({ thread_id: t.id, sender_id: me, body, photo_key: photoKey, share_key: shareKey })
      .select("id, thread_id, sender_id, body, photo_key, share_key, created_at").single();
    if (error) return json({ error: "Could not send that. Try again." });
    await admin.from("dm_threads").update({ last_at: msg.created_at }).eq("id", t.id);
    return json({ message: msg });
  }

  return json({ error: "Unknown action." });
});
