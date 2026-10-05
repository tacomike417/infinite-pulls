/* INFINITE PULLS TV -- the house Loops (4 Oct 2026, Mike).
 *
 * Three shows, one Loop from each every day, posted by @InfinitePullsTCG:
 *   Crazy J at 9am Eastern, Pulls News at noon, The Collector at 6pm.
 *
 * Two jobs:
 *   1. THE UPLOAD DOORS (Mike's computer only, with the HOUSE_KEY password):
 *        slot     -- make an empty video on Bunny for number n and hand back
 *                    a short-lived signature so the video uploads straight there
 *        uploaded -- the video arrived; put it in line
 *        status   -- how many are waiting / posted
 *   2. THE HOURLY KNOCK (no password, body {}): for each show, if it is past
 *      its hour and nothing from that show went up today, post the next one.
 *
 * Secrets: HOUSE_KEY, BUNNY_STREAM_KEY, BUNNY_STREAM_LIBRARY (the last two are
 * already there for Loops).
 *
 * Deploy: npx supabase functions deploy house-loops --no-verify-jwt --project-ref rrkyvcouxdmurwdyuugv
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://video.bunnycdn.com";
const POSTER = "infinitepullstcg";
const SHOWS = [
  { name: "crazy_j", from: 1001, hour: 9 },
  { name: "pulls_news", from: 2001, hour: 12 },
  { name: "collector", from: 3001, hour: 18 },
];

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const HOUSE_KEY = Deno.env.get("HOUSE_KEY") || "";
const KEY = Deno.env.get("BUNNY_STREAM_KEY") || "";
const LIB = Deno.env.get("BUNNY_STREAM_LIBRARY") || "";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const bunny = (path: string, init: RequestInit = {}) =>
  fetch(`${API}/library/${LIB}${path}`, {
    ...init,
    headers: { AccessKey: KEY, accept: "application/json", "content-type": "application/json", ...(init.headers || {}) },
  });
async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function eastern() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).reduce((a: Record<string, string>, x) => { a[x.type] = x.value; return a; }, {});
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

async function door(b: Record<string, any>) {
  if (!HOUSE_KEY || String(b.key || "") !== HOUSE_KEY) return json({ ok: false, error: "wrong upload password" }, 403);
  if (b.action === "status") {
    const { data } = await admin.from("house_loops").select("n, status");
    const out: Record<string, Record<string, number>> = {};
    for (const s of SHOWS) out[s.name] = {};
    (data || []).forEach((r: any) => { const s = SHOWS.find((x) => r.n >= x.from && r.n < x.from + 999); if (s) out[s.name][r.status] = (out[s.name][r.status] || 0) + 1; });
    return json({ ok: true, counts: out });
  }
  const n = Number(b.n);
  if (!Number.isInteger(n) || n < 1001 || n > 3999) return json({ ok: false, error: "which loop?" }, 400);
  const { data: row } = await admin.from("house_loops").select("*").eq("n", n).maybeSingle();
  if (b.action === "uploaded") {
    if (!row) return json({ ok: false, error: "no slot for loop " + n }, 404);
    if (row.status === "uploading") await admin.from("house_loops").update({ status: "queued" }).eq("n", n);
    return json({ ok: true, status: row.status === "uploading" ? "queued" : row.status });
  }
  if (b.action === "slot") {
    if (row && row.status !== "uploading") return json({ ok: true, skip: true, status: row.status });
    let guid = row ? String(row.video_guid) : "";
    if (!guid) {
      /* THE COVER (5 Oct 2026, Mike: "make the cover We're taking our seat at the table on these"). The still you see
         before a Loop plays is a frame the video host picks from the middle, which gave away the punchline. cover_ms
         says which moment to use instead (the end card). Nothing sent = the host picks, as before. */
      const cover = Math.round(Number(b.cover_ms) || 0);
      const made = await bunny("/videos", { method: "POST", body: JSON.stringify({ title: `house loop ${n} ${String(b.title || "").slice(0, 60)}`, ...(cover > 0 && cover < 60000 ? { thumbnailTime: cover } : {}) }) });
      if (!made.ok) return json({ ok: false, error: "the video host said no (" + made.status + ")" }, 502);
      guid = String((await made.json()).guid || "");
      if (!guid) return json({ ok: false, error: "the video host gave no id" }, 502);
      const { error } = await admin.from("house_loops").insert({ n, video_guid: guid, title: String(b.title || "").slice(0, 120) || null, caption: String(b.caption || "").slice(0, 500) || null });
      if (error) { try { await bunny(`/videos/${guid}`, { method: "DELETE" }); } catch { /* fine */ } return json({ ok: false, error: error.message }, 500); }
    }
    const expire = Math.floor(Date.now() / 1000) + 6 * 3600;
    const signature = await sha256Hex(`${LIB}${KEY}${expire}${guid}`);
    return json({ ok: true, guid, library: LIB, expire, signature });
  }
  return json({ ok: false, error: "unknown" }, 400);
}

async function publish(row: any, userId: string, day: string) {
  const r = await bunny(`/videos/${row.video_guid}`);
  if (!r.ok) return "the video host didn't answer";
  const v = await r.json();
  const st = Number(v.status);
  if (st === 5 || st === 6) { await admin.from("house_loops").update({ status: "failed" }).eq("n", row.n); return "failed on the video host"; }
  if (st !== 4) return "still being processed";
  const { data: loop, error } = await admin.from("user_loops").insert({
    user_id: userId, video_guid: row.video_guid, caption: row.caption || null, status: "ready",
    length_s: Number(v.length) || null, width: Number(v.width) || null, height: Number(v.height) || null,
    resolutions: String(v.availableResolutions || "") || null,
    expires_at: new Date(Date.now() + 3650 * 86400000).toISOString(),      // house Loops stay
  }).select("id").single();
  if (error || !loop) return error ? error.message : "no loop";
  await admin.from("house_loops").update({ status: "posted", loop_id: loop.id, posted_on: day, posted_at: new Date().toISOString() }).eq("n", row.n);
  return "";
}

/* WHO GOES NEXT (5 Oct 2026, Mike: Big Pull Energy "takes turns with Crazy J", and Seat at the Table is
   "shuffled together" with Crazy J). The 9am slot holds three sets: Crazy J (1001+), A Seat at the Table (1101+)
   and Big Pull Energy (1201+). One day it's Big Pull Energy, in order; the next day it's a random pick from
   Crazy J and Seat mixed together. When one side runs out the other takes every day. Other shows: in order. */
const isBpe = (n: number) => n >= 1201 && n < 1300;
function pick(show: string, mine: any[], queue: any[]) {
  if (show !== "crazy_j") return queue[0];
  const bpe = queue.filter((r: any) => isBpe(r.n));
  const mix = queue.filter((r: any) => !isBpe(r.n));
  if (!bpe.length) return mix[Math.floor(Math.random() * mix.length)];
  if (!mix.length) return bpe[0];
  const last = mine.filter((r: any) => r.status === "posted" && r.posted_at).sort((a: any, b: any) => String(b.posted_at).localeCompare(String(a.posted_at)))[0];
  return last && isBpe(last.n) ? mix[Math.floor(Math.random() * mix.length)] : bpe[0];
}

async function knock() {
  const { day, hour } = eastern();
  const out: Record<string, unknown> = { ok: true, day, hour };
  const { data: p } = await admin.from("profiles").select("id").ilike("username", POSTER).maybeSingle();
  if (!p) return { ok: false, error: "InfinitePullsTCG was not found" };
  const { data: all, error } = await admin.from("house_loops").select("*").order("n", { ascending: true });
  if (error) return { ok: false, error: "no list yet (run house_loops.sql)" };
  for (const s of SHOWS) {
    const mine = (all || []).filter((r: any) => r.n >= s.from && r.n < s.from + 999);
    const queue = mine.filter((r: any) => r.status === "queued");
    if (hour < s.hour) { out[s.name] = { posted: 0, why: "not time yet", waiting: queue.length }; continue; }
    if (mine.some((r: any) => r.status === "posted" && r.posted_on === day)) { out[s.name] = { posted: 0, why: "today's is up", waiting: queue.length }; continue; }
    if (!queue.length) { out[s.name] = { posted: 0, why: "none waiting" }; continue; }
    const next = pick(s.name, mine, queue);
    const why = await publish(next, p.id, day);
    out[s.name] = why ? { posted: 0, why: "loop " + next.n + ": " + why, waiting: queue.length } : { posted: 1, number: next.n, waiting: queue.length - 1 };
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!KEY || !LIB) return json({ ok: false, error: "the video host isn't set up on the server" }, 500);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* the timer sends nothing */ }
  try {
    if (typeof body.action === "string") return await door(body);
    return json(await knock());
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 500);
  }
});
