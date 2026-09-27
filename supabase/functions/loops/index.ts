/* INFINITE LOOPS -- the server half (27 Sep 2026).
 *
 * The Bunny Stream key never leaves here. It is the Supabase secret
 * BUNNY_STREAM_KEY; the library is BUNNY_STREAM_LIBRARY (763994).
 *
 *   start  -- make an empty video on Bunny, write the row, and hand the
 *             phone a short-lived signature so it can upload straight to
 *             Bunny (the video never passes through this function).
 *   done   -- ask Bunny whether the video has finished; mark it ready.
 *   delete -- the owner (or staff) removes a Loop, video and all.
 *
 * Every start also sweeps a little: Loops 3 days past their 30 (unpinned),
 * and uploads that never finished, are deleted from Bunny and the table.
 * The 3 extra days are the owner's window to pin one before it goes.
 *
 * Deploy: npx supabase functions deploy loops --project-ref rrkyvcouxdmurwdyuugv
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API = "https://video.bunnycdn.com";
const PER_DAY = 10;              // Loops one person can start in 24 hours
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_SECONDS = 16;          // 15, plus a second of slack for rounding

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const KEY = Deno.env.get("BUNNY_STREAM_KEY") || "";
  const LIB = Deno.env.get("BUNNY_STREAM_LIBRARY") || "";
  if (!KEY || !LIB) return json({ error: "Loops are not set up on the server yet." }, 500);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Log in to post a Loop." }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let userId = "";
  try {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data?.user) return json({ error: "Log in to post a Loop." }, 401);
    userId = data.user.id;
  } catch {
    return json({ error: "Log in to post a Loop." }, 401);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const action = String(body.action || "");

  const bunny = (path: string, init: RequestInit = {}) =>
    fetch(`${API}/library/${LIB}${path}`, {
      ...init,
      headers: { AccessKey: KEY, accept: "application/json", "content-type": "application/json", ...(init.headers || {}) },
    });

  const dropVideo = async (guid: string) => {
    try { await bunny(`/videos/${guid}`, { method: "DELETE" }); } catch { /* already gone is fine */ }
  };

  /* ---------------- start ---------------- */
  if (action === "start") {
    const bytes = Number(body.bytes) || 0;
    if (bytes > MAX_BYTES) return json({ error: "That video is too big. Try a shorter clip." }, 400);
    const caption = String(body.caption || "").trim().slice(0, 500) || null;
    const muted = !!body.muted;

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await admin.from("user_loops").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("created_at", since);
    if ((count || 0) >= PER_DAY) return json({ error: `That's ${PER_DAY} Loops today. Try again tomorrow.` }, 429);

    const made = await bunny("/videos", { method: "POST", body: JSON.stringify({ title: `loop ${userId.slice(0, 8)} ${Date.now()}` }) });
    if (!made.ok) return json({ error: "Could not start the upload. Try again in a minute." }, 502);
    const vid = await made.json();
    const guid = String(vid.guid || "");
    if (!guid) return json({ error: "Could not start the upload." }, 502);

    const { data: row, error } = await admin.from("user_loops")
      .insert({ user_id: userId, video_guid: guid, caption, muted, status: "uploading" })
      .select("id").single();
    if (error || !row) { await dropVideo(guid); return json({ error: "Could not save the Loop." }, 500); }

    const expire = Math.floor(Date.now() / 1000) + 6 * 3600;
    const signature = await sha256Hex(`${LIB}${KEY}${expire}${guid}`);

    // A little housekeeping, after the answer is worked out.
    const sweep = (async () => {
      const cut = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
      const stale = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [old, stuck] = await Promise.all([
        admin.from("user_loops").select("id, video_guid").eq("pinned", false).lt("expires_at", cut).limit(20),
        admin.from("user_loops").select("id, video_guid").neq("status", "ready").lt("created_at", stale).limit(20),
      ]);
      const gone = [...(old.data || []), ...(stuck.data || [])];
      for (const g of gone) {
        await dropVideo(g.video_guid);
        await admin.from("user_loops").delete().eq("id", g.id);
        await admin.from("post_comments").delete().eq("post_key", "l-" + g.id);
        await admin.from("post_heat").delete().eq("post_key", "l-" + g.id);
      }
    })().catch(() => {});
    // @ts-ignore EdgeRuntime exists on Supabase
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(sweep); else await sweep;

    return json({ id: row.id, guid, library: LIB, expire, signature });
  }

  /* The other two act on one Loop. */
  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "Which Loop?" }, 400);
  const { data: loop } = await admin.from("user_loops").select("*").eq("id", id).maybeSingle();
  if (!loop) return json({ error: "That Loop is gone." }, 404);

  /* ---------------- done ---------------- */
  if (action === "done") {
    if (loop.user_id !== userId) return json({ error: "Not your Loop." }, 403);
    if (loop.status === "ready") return json({ status: "ready" });
    const r = await bunny(`/videos/${loop.video_guid}`);
    if (!r.ok) return json({ status: loop.status });
    const v = await r.json();
    const st = Number(v.status);
    if (st === 5 || st === 6) {
      await admin.from("user_loops").update({ status: "failed" }).eq("id", id);
      return json({ status: "failed", error: "Bunny could not read that video. Try another one." });
    }
    const len = Number(v.length) || 0;
    if (len > MAX_SECONDS) {
      await dropVideo(loop.video_guid);
      await admin.from("user_loops").delete().eq("id", id);
      return json({ status: "failed", error: "Loops are 15 seconds max. Trim it and try again." });
    }
    // 4 = finished. 3 (transcoding) with a resolution out is watchable too,
    // but the MP4 copies come last, so wait for 4.
    if (st === 4) {
      await admin.from("user_loops").update({
        status: "ready",
        length_s: len || null,
        width: Number(v.width) || null,
        height: Number(v.height) || null,
        resolutions: String(v.availableResolutions || "") || null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      }).eq("id", id);
      return json({ status: "ready" });
    }
    return json({ status: "uploading", progress: Number(v.encodeProgress) || 0 });
  }

  /* ---------------- delete ---------------- */
  if (action === "delete") {
    let ok = loop.user_id === userId;
    if (!ok) {
      const { data: staff } = await admin.from("shop_staff").select("user_id").eq("user_id", userId).maybeSingle();
      ok = !!staff;
    }
    if (!ok) return json({ error: "Not your Loop." }, 403);
    await dropVideo(loop.video_guid);
    await admin.from("user_loops").delete().eq("id", id);
    await admin.from("post_comments").delete().eq("post_key", "l-" + id);
    await admin.from("post_heat").delete().eq("post_key", "l-" + id);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
