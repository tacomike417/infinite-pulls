// Supabase Edge Function: push-out  (25 Sep 2026)
//
// Two jobs, both "get people back to the app":
//
//  1. { notification_id }  -- called by the database the moment a row lands
//     in public.notifications (see push_out.sql). Sends that one row to the
//     person's phone(s): "@bob commented on your card", "You earned ...".
//     The row is claimed with pushed_at first, so it goes out ONCE no matter
//     how many times this is called -- which is also why this function can
//     be open to the database without a secret: all anybody can make it do
//     is send a real, unsent notification to the person it belongs to.
//
//  2. { digest: "shelf" }  -- called by cron at 6pm Eastern. If new cards
//     went up on the shelf since the last one, every device with
//     notifications on gets "N new cards hit the shelf today". Never twice
//     inside 20 hours, never on a day with nothing new.
//
// Deploy with --no-verify-jwt (the database calls it with no login).
// Uses the same VAPID secrets as send-notification and check-price-alerts.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT");

const SAYS: Record<string, string> = {
  comment: "commented on your card",
  reply: "replied to you",
  heart: "liked your comment",
  follow: "followed you",
  heat: "added heat to your card",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    return json({ error: "VAPID secrets are not set" }, 500);
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let payload: any = {};
  try { payload = await req.json(); } catch { /* empty body */ }

  if (payload?.digest === "shelf") return json(await shelfDigest(db));
  if (typeof payload?.notification_id === "string") {
    return json(await pushOne(db, payload.notification_id));
  }
  return json({ error: "Nothing to do" }, 400);
});

// ---------------------------------------------------------------- one row
async function pushOne(db: any, id: string) {
  // CLAIM IT. Only an unsent row younger than an hour; the update returns
  // nothing if somebody (or an earlier call) already sent it.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { data: rows, error } = await db.from("notifications")
    .update({ pushed_at: new Date().toISOString() })
    .eq("id", id).is("pushed_at", null).gt("created_at", hourAgo)
    .select("id, user_id, actor_id, kind, post_key, comment_id, detail, href");
  if (error) return { error: error.message };
  const n = rows && rows[0];
  if (!n) return { skipped: "already sent, too old, or not found" };

  let actor = "";
  if (n.actor_id) {
    const { data } = await db.from("profiles").select("username").eq("id", n.actor_id).maybeSingle();
    actor = data?.username ? "@" + data.username : "Someone";
  }

  let title = "Infinite Pulls";
  let body = "";
  let url = "/feed-next/?alerts=1";

  if (SAYS[n.kind]) {
    title = `${actor || "Someone"} ${SAYS[n.kind]}`;
    if ((n.kind === "comment" || n.kind === "reply" || n.kind === "heart") && n.comment_id) {
      const { data } = await db.from("post_comments").select("body").eq("id", n.comment_id).maybeSingle();
      if (data?.body) body = clip(data.body, 140);
    }
    if (n.kind === "follow" && actor) {
      body = "Tap to see their cards.";
      url = "/feed-next/?who=" + encodeURIComponent(actor.replace(/^@/, ""));
    } else if (n.post_key) {
      url = "/feed-next/?post=" + encodeURIComponent(n.post_key) + "&talk=1";
    }
  } else if (n.kind === "dex") {
    title = "You earned a card";
    body = n.detail || "A new card is in your Infinite Rewards.";
    url = "/feed-next/?rewards=1";
  } else if (n.kind === "goal") {
    title = "Goal complete";
    body = n.detail || "You finished a goal.";
    url = fixHref(n.href) || "/?page=goals";
  } else if (n.kind === "wishlist") {
    title = "A card you want is at the shop";
    body = n.detail || "Something on your wish list just showed up.";
    url = fixHref(n.href) || "/?page=shop";
  } else {
    title = "Infinite Pulls";
    body = n.detail || "You have something new.";
    url = fixHref(n.href) || url;
  }
  if (!body) body = "Tap to see it.";

  const { data: subs } = await db.from("push_subscriptions")
    .select("id, endpoint, p256dh, auth").eq("user_id", n.user_id);
  return await sendAll(db, subs || [], { title, body, url });
}

// ----------------------------------------------------------- shelf digest
async function shelfDigest(db: any) {
  const now = Date.now();
  const { data: last } = await db.from("push_digests").select("sent_at").eq("kind", "shelf").maybeSingle();
  const lastAt = last?.sent_at ? Date.parse(last.sent_at) : now - 24 * 3600_000;
  if (now - lastAt < 20 * 3600_000) return { skipped: "sent within the last 20 hours" };

  const since = new Date(Math.max(lastAt, now - 48 * 3600_000)).toISOString();
  const { data: fresh, error } = await db.from("shop_available")
    .select("name, added_at")
    .gt("added_at", since).gt("available", 0).eq("hidden_online", false)
    .order("added_at", { ascending: false }).limit(200);
  if (error) return { error: error.message };
  const items = fresh || [];
  if (!items.length) return { skipped: "nothing new on the shelf" };

  const names = [...new Set(items.map((i: any) => String(i.name || "").trim()).filter(Boolean))];
  const count = items.length;
  const title = count === 1 ? "New on the shelf" : `${count} new cards hit the shelf`;
  const body = names.slice(0, 3).join(", ") + (names.length > 3 ? ", and more" : "");

  // Recorded BEFORE sending, so a slow send can never let a second run in.
  await db.from("push_digests").upsert({ kind: "shelf", sent_at: new Date(now).toISOString() });

  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth");
  return { count, ...(await sendAll(db, subs || [], { title, body: clip(body, 140), url: "/?page=shop" })) };
}

// ------------------------------------------------------------------ shared
async function sendAll(db: any, subs: any[], msg: { title: string; body: string; url: string }) {
  const payload = JSON.stringify(msg);
  let sent = 0, failed = 0;
  const stale: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (err: any) {
      failed++;
      if (err?.statusCode === 404 || err?.statusCode === 410) stale.push(s.id);
    }
  }));
  if (stale.length) await db.from("push_subscriptions").delete().in("id", stale);
  return { sent, failed, removed: stale.length, devices: subs.length };
}

// Rows written for the old pages say "../?page=dex"; a notification needs
// an address from the site root.
function fixHref(h?: string | null) {
  if (!h) return "";
  if (h.startsWith("../")) return "/" + h.slice(3);
  if (h.startsWith("?")) return "/" + h;
  if (h.startsWith("/")) return h;
  return "";
}

function clip(s: string, n: number) {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
