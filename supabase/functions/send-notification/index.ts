// Supabase Edge Function: send-notification
//
// Called from the admin panel (authenticated) with a title + message.
// Loads every subscribed device from the database (using the service-role
// key, which is only ever available inside this server-side function, never
// in the browser) and sends each one a real push notification.
//
// Required function secrets (set with `supabase secrets set ...`, see
// SETUP.md):
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT           e.g. "mailto:you@example.com"
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by
// Supabase to every Edge Function — you do not set those yourself.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const title = String(payload?.title || "Infinite Pulls").slice(0, 120);
  const body = String(payload?.body || "").slice(0, 500);
  const url = typeof payload?.url === "string" && payload.url ? payload.url : "/";

  if (!body) {
    return json({ error: "Message body is required" }, 400);
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

  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");

  if (error) {
    return json({ error: `Could not load subscriptions: ${error.message}` }, 500);
  }

  const notificationPayload = JSON.stringify({ title, body, url });

  let sent = 0;
  let failed = 0;
  const staleIds = [];

  await Promise.all(
    (subscriptions || []).map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(pushSubscription, notificationPayload);
        sent++;
      } catch (err) {
        failed++;
        // 404/410 means the browser unsubscribed or the device is gone for
        // good — clean it up so future sends don't keep retrying it.
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(sub.id);
        }
      }
    })
  );

  if (staleIds.length) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
  }

  return json({ sent, failed, removed: staleIds.length, total: (subscriptions || []).length });
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
