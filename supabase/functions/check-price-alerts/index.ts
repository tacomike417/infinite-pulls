// Supabase Edge Function: check-price-alerts
//
// Meant to run on a daily schedule (see supabase/SETUP.md for wiring up
// Supabase's built-in Cron to call this automatically) rather than being
// triggered by a person. For every account that has turned on price
// alerts (My Account → Price Alerts) and has at least one subscribed
// device, this checks current TCGdex pricing against what was last
// alerted on and, when something's moved enough to be worth a nudge,
// sends a real push notification:
//
//   - A wish list card dropped in price since the last time it was
//     checked (or since it was added, if never checked before).
//   - Their chosen "grail card" moved in price, in either direction.
//   - It's been at least a week since their last collection-value
//     summary push, so they get a fresh "here's what it's worth now."
//
// Runs with the service-role key (server-side only), so it can read
// across every account's cards regardless of Row Level Security, and
// reuses the same VAPID secrets + web-push sending already set up for
// send-notification — nothing new to configure there.
//
// This function is meant to be called by a scheduled job, not a signed-in
// visitor, so deploy it with --no-verify-jwt (see SETUP.md). It never
// takes any input from the caller — everything it does is based on
// what's already stored in the database — so skipping per-request auth
// here is safe.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const TCGDEX_BASE = "https://api.tcgdex.net/v2/en";
const DROP_THRESHOLD = 0.10; // a card has to move at least 10% to be worth a push
const VALUE_DIGEST_DAYS = 7; // how often to send the "here's what it's worth" summary

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
  const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
  const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    return json({ error: "VAPID secrets are not configured on this function" }, 500);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Supabase service role is not configured on this function" }, 500);
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Only accounts that (a) opted in and (b) have at least one device on
  // file are worth doing any work for.
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, grail_card_id, last_value_alert_total, last_value_alert_at")
    .eq("price_alerts_enabled", true);

  if (profilesError) return json({ error: `Could not load profiles: ${profilesError.message}` }, 500);
  if (!profiles || !profiles.length) return json({ checked: 0, notified: 0 });

  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", profiles.map((p) => p.id));

  if (subsError) return json({ error: `Could not load subscriptions: ${subsError.message}` }, 500);

  const subsByUser = new Map();
  for (const sub of subs || []) {
    if (!subsByUser.has(sub.user_id)) subsByUser.set(sub.user_id, []);
    subsByUser.get(sub.user_id).push(sub);
  }

  const activeProfiles = profiles.filter((p) => subsByUser.has(p.id));
  if (!activeProfiles.length) return json({ checked: 0, notified: 0 });

  const activeIds = activeProfiles.map((p) => p.id);

  const { data: allWishRows } = await supabase
    .from("wishlist_cards")
    .select("id, user_id, card_id, card_name, variant, last_alert_price")
    .in("user_id", activeIds);

  const { data: allOwnedRows } = await supabase
    .from("user_cards")
    .select("id, user_id, card_id, card_name, variant, quantity, last_alert_price")
    .in("user_id", activeIds);

  // One TCGdex fetch per unique card, shared across every account being
  // checked this run — a card that's on ten different wish lists only
  // gets fetched once, not ten times.
  const uniqueCardIds = [...new Set([
    ...(allWishRows || []).map((r) => r.card_id),
    ...(allOwnedRows || []).map((r) => r.card_id),
  ])];

  const cardById = new Map();
  await Promise.all(uniqueCardIds.map(async (id) => {
    try {
      const res = await fetch(`${TCGDEX_BASE}/cards/${encodeURIComponent(id)}`);
      if (res.ok) cardById.set(id, await res.json());
    } catch {
      // That card just gets skipped below — one TCGdex hiccup shouldn't
      // fail the whole run for every other account being checked.
    }
  }));

  function priceFor(cardId, variant) {
    const card = cardById.get(cardId);
    const entry = card?.pricing?.tcgplayer?.[variant];
    return typeof entry?.marketPrice === "number" ? entry.marketPrice : null;
  }

  const wishByUser = new Map();
  for (const row of allWishRows || []) {
    if (!wishByUser.has(row.user_id)) wishByUser.set(row.user_id, []);
    wishByUser.get(row.user_id).push(row);
  }
  const ownedByUser = new Map();
  for (const row of allOwnedRows || []) {
    if (!ownedByUser.has(row.user_id)) ownedByUser.set(row.user_id, []);
    ownedByUser.get(row.user_id).push(row);
  }

  const wishlistUpdates = [];
  const ownedUpdates = [];
  const profileUpdates = [];
  let notified = 0;
  const now = Date.now();

  for (const profile of activeProfiles) {
    const messages = [];

    // 1. Wish list price drops.
    const drops = [];
    for (const row of wishByUser.get(profile.id) || []) {
      const price = priceFor(row.card_id, row.variant);
      if (price === null) continue;
      const baseline = row.last_alert_price;
      if (baseline == null || price <= baseline * (1 - DROP_THRESHOLD)) {
        drops.push({ ...row, price });
        wishlistUpdates.push({ id: row.id, last_alert_price: price });
      }
    }
    if (drops.length === 1) {
      messages.push(`🔥 ${drops[0].card_name} on your wish list just dropped to $${drops[0].price.toFixed(2)}.`);
    } else if (drops.length > 1) {
      messages.push(`🔥 ${drops.length} cards on your wish list just dropped in price — take a look!`);
    }

    // 2. Grail card movement, either direction.
    const owned = ownedByUser.get(profile.id) || [];
    if (profile.grail_card_id) {
      const grailRow = owned.find((r) => r.id === profile.grail_card_id);
      if (grailRow) {
        const price = priceFor(grailRow.card_id, grailRow.variant);
        const baseline = grailRow.last_alert_price;
        if (price !== null && (baseline == null || Math.abs(price - baseline) >= baseline * DROP_THRESHOLD)) {
          if (baseline != null) {
            const pct = Math.round(((price - baseline) / baseline) * 100);
            messages.push(`⭐ Your grail card, ${grailRow.card_name}, just ${pct >= 0 ? "jumped" : "dropped"} ${Math.abs(pct)}% — now $${price.toFixed(2)}.`);
          }
          ownedUpdates.push({ id: grailRow.id, last_alert_price: price });
        }
      }
    }

    // 3. Weekly collection value digest.
    const lastAt = profile.last_value_alert_at ? new Date(profile.last_value_alert_at).getTime() : null;
    if (lastAt === null || now - lastAt >= VALUE_DIGEST_DAYS * 24 * 60 * 60 * 1000) {
      let total = 0;
      let anyPriced = false;
      for (const row of owned) {
        const price = priceFor(row.card_id, row.variant);
        if (price !== null) { total += price * row.quantity; anyPriced = true; }
      }
      if (anyPriced) {
        if (profile.last_value_alert_total != null) {
          const delta = total - profile.last_value_alert_total;
          const sign = delta >= 0 ? "+" : "-";
          messages.push(`📊 Your collection is worth $${total.toFixed(2)} (${sign}$${Math.abs(delta).toFixed(2)} this week).`);
        } else {
          messages.push(`📊 Your collection is worth $${total.toFixed(2)}.`);
        }
        profileUpdates.push({ id: profile.id, last_value_alert_total: total, last_value_alert_at: new Date().toISOString() });
      }
    }

    if (!messages.length) continue;

    const devices = subsByUser.get(profile.id) || [];
    const payload = JSON.stringify({
      title: "Infinite Pulls",
      body: messages.join(" ").slice(0, 500),
      url: "/collection",
    });

    for (const device of devices) {
      try {
        await webpush.sendNotification(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          payload
        );
        notified++;
      } catch (err) {
        // 404/410 means the browser unsubscribed or the device is gone
        // for good — clean it up so future runs stop retrying it.
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", device.id);
        }
      }
    }
  }

  // Persist the new baselines so tomorrow's run compares against today's
  // prices, not the original ones forever.
  await Promise.all(wishlistUpdates.map((u) =>
    supabase.from("wishlist_cards").update({ last_alert_price: u.last_alert_price }).eq("id", u.id)
  ));
  await Promise.all(ownedUpdates.map((u) =>
    supabase.from("user_cards").update({ last_alert_price: u.last_alert_price }).eq("id", u.id)
  ));
  await Promise.all(profileUpdates.map((u) =>
    supabase.from("profiles").update({
      last_value_alert_total: u.last_value_alert_total,
      last_value_alert_at: u.last_value_alert_at,
    }).eq("id", u.id)
  ));

  return json({ checked: activeProfiles.length, notified });
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
