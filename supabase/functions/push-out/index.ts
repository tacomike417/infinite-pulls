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
//  4. { shop_order } -- "Sold online" to the shop staff (29 Sep)
//  3. { broadcast: "loops" } -- the one-time "Loops are here" alert (28 Sep)
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
  heat: "liked your card",
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
  if (payload?.broadcast === "loops") return json(await loopsLaunch(db));
  if (typeof payload?.post_report_id === "string") return json(await postReportAlert(db, payload.post_report_id));
  if (typeof payload?.shop_order === "string") return json(await shopOrderAlert(db, payload.shop_order));
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

  // ONE BUZZ, NOT A BUNCH (3 Oct 2026, Mike: "invasive but not annoying, like Recovery Misfits").
  // Every alert for one person lands on the SAME card on their phone (tag "ip-notes"), so the
  // newest replaces the last one instead of piling up. The phone only makes a sound when it
  // has been quiet for an hour, and never more than 5 times in a day. Everything in between
  // updates the card without a sound. Needs supabase/one_buzz.sql; until that has been run
  // this just buzzes every time, the way it always did.
  const nowMs = Date.now();
  const { data: buzzes } = await db.from("notifications").select("buzzed_at")
    .eq("user_id", n.user_id).not("buzzed_at", "is", null)
    .gt("buzzed_at", new Date(nowMs - 24 * 3600_000).toISOString())
    .order("buzzed_at", { ascending: false }).limit(5);
  const lastBuzz = buzzes && buzzes[0]?.buzzed_at ? Date.parse(buzzes[0].buzzed_at) : 0;
  const quiet = (nowMs - lastBuzz < 3600_000) || (buzzes || []).length >= 5;
  if (!quiet) await db.from("notifications").update({ buzzed_at: new Date(nowMs).toISOString() }).eq("id", n.id);

  // More than one waiting: the card says how many, and the newest one is the line under it.
  const { count: waiting } = await db.from("notifications").select("id", { count: "exact", head: true })
    .eq("user_id", n.user_id).is("read_at", null);
  if ((waiting || 0) > 1) {
    body = clip(title + (body && body !== "Tap to see it." ? ": " + body : ""), 140);
    title = `${waiting} new on Infinite Pulls 👀`;
    url = "/feed-next/?alerts=1";
  }

  const { data: subs } = await db.from("push_subscriptions")
    .select("id, endpoint, p256dh, auth").eq("user_id", n.user_id);
  return { quiet, waiting: waiting || 0, ...(await sendAll(db, subs || [], { title, body, url, tag: "ip-notes", quiet })) };
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


// ------------------------------------------------ one-time: Loops are here
// 28 Sep 2026 (Mike): a single alert to every phone with notifications on,
// to bring people back to try Loops (they'll meet the birthday screen and
// Messages on the way). The message is fixed and it can only EVER go out
// once -- push_digests remembers -- so calling this again does nothing.
async function loopsLaunch(db: any) {
  const { data: done } = await db.from("push_digests").select("sent_at").eq("kind", "loops-launch").maybeSingle();
  if (done) return { skipped: "already sent " + done.sent_at };
  await db.from("push_digests").upsert({ kind: "loops-launch", sent_at: new Date().toISOString() });
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth");
  return await sendAll(db, subs || [], {
    title: "∞ Infinite Loops are here 🎬",
    body: "15-second videos of your pulls. Open Infinite Pulls and make your first Loop.",
    url: "/feed-next/",
  });
}


// ------------------------------------------ a post was reported (28 Sep)
// Called by the database the moment a report lands. Goes once (alerted_at)
// to every moderator + shop staff phone. The owner is already frozen.
async function postReportAlert(db: any, id: string) {
  const fiveAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: rows } = await db.from("post_reports").update({ alerted_at: new Date().toISOString() })
    .eq("id", id).is("alerted_at", null).gt("created_at", fiveAgo)
    .select("post_owner, reporter_id, reason");
  const r = rows && rows[0];
  if (!r) return { skipped: "already alerted or not found" };
  const name = async (uid: string) => {
    if (!uid) return "someone";
    const { data } = await db.from("profiles").select("username").eq("id", uid).maybeSingle();
    return "@" + (data?.username || "someone");
  };
  const { data: fz } = await db.from("member_freeze").select("user_id").eq("user_id", r.post_owner).maybeSingle();
  const body = `${await name(r.reporter_id)} reported ${await name(r.post_owner)}'s post: ${clip(r.reason, 60)}.` + (fz ? " That's 3 reports: they're frozen until you look." : " Tap to review.");
  const { data: mods } = await db.rpc("dm_mod_ids");
  const ids = (mods || []).map((m: any) => m.user_id).filter((u: string) => u !== r.reporter_id);
  if (!ids.length) return { skipped: "no moderators" };
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", ids);
  return await sendAll(db, subs || [], { title: "🚩 A post was reported", body, url: "/feed-next/?reports=1" });
}


// ------------------------------------------- something sold online (29 Sep)
// The database calls this when an online order turns paid. Waits a moment
// so every card in a basket is marked paid, then sends ONE alert for the
// whole order (alerted_at) to every shop staff phone.
async function shopOrderAlert(db: any, key: string) {
  if (!/^[0-9a-f-]{36}$/.test(key)) return { skipped: "bad key" };
  await new Promise((r) => setTimeout(r, 3000));
  const { data: rows } = await db.from("shop_holds")
    .update({ alerted_at: new Date().toISOString() })
    .or(`order_ref.eq.${key},id.eq.${key}`).eq("status", "paid").is("alerted_at", null)
    .select("item_name, unit_price, qty, fulfilment");
  const items = rows || [];
  if (!items.length) return { skipped: "already alerted" };
  const total = items.reduce((t: number, r: any) => t + (Number(r.unit_price) || 0) * (Number(r.qty) || 1), 0);
  const names = items.map((r: any) => (r.qty > 1 ? r.qty + "× " : "") + (r.item_name || "Item"));
  const what = names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2} more` : "");
  const ship = items.some((r: any) => r.fulfilment === "ship");
  const title = `🛒 Sold online: $${total.toFixed(2)}`;
  const body = clip(`${what} · ${ship ? "SHIP IT, address in Clover" : "PICKUP, set it aside"}`, 140);
  const { data: staff } = await db.from("shop_staff").select("user_id");
  const ids = (staff || []).map((s: any) => s.user_id);
  if (!ids.length) return { skipped: "no staff" };
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", ids);
  return { items: items.length, ...(await sendAll(db, subs || [], { title, body, url: "/admin/?tab=clover" })) };
}

// ------------------------------------------------------------------ shared
async function sendAll(db: any, subs: any[], msg: { title: string; body: string; url: string; tag?: string; quiet?: boolean }) {
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
