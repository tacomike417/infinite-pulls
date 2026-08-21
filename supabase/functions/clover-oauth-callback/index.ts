// Supabase Edge Function: clover-oauth-callback
//
// Called by admin/clover-callback.html right after your buddy clicks
// "Allow" on Clover's own site. Clover redirects his browser back with
// a `code` (and `merchant_id`) in the URL — that page hands both of
// those to this function, which trades the code for real access/refresh
// tokens and stores them, server-side only, in clover_connection.
//
// Required function secret (set with `supabase secrets set ...`, see
// SETUP.md):
//   CLOVER_API_BASE   e.g. "https://api.clover.com" (see SETUP.md for
//                     the EU/Latin America alternates)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// A note on confidence: the redirect-back shape (?code=...&merchant_id=...)
// and the token endpoint + required fields (client_id, client_secret,
// code) are both straight from Clover's own docs. The exact request
// encoding below (JSON body) is a reasonable best guess consistent with
// the rest of Clover's REST API — if the very first real connection
// attempt fails here, this is the first thing worth checking against
// whatever Clover's response actually says.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const code = String(payload?.code || "");
  const merchantId = String(payload?.merchant_id || "");
  if (!code) return json({ error: "Missing authorization code from Clover" }, 400);

  const CLOVER_API_BASE = Deno.env.get("CLOVER_API_BASE") || "https://api.clover.com";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Supabase service role is not configured on this function" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: conn, error: connError } = await supabase
    .from("clover_connection")
    .select("client_id, client_secret")
    .eq("id", 1)
    .maybeSingle();

  if (connError) return json({ error: `Could not load stored credentials: ${connError.message}` }, 500);
  if (!conn?.client_id || !conn?.client_secret) {
    return json({ error: "Save your Clover Client ID and Client Secret in the admin panel first." }, 400);
  }

  let tokenRes;
  try {
    tokenRes = await fetch(`${CLOVER_API_BASE}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: conn.client_id,
        client_secret: conn.client_secret,
        code,
      }),
    });
  } catch (err) {
    return json({ error: `Could not reach Clover: ${err?.message || err}` }, 502);
  }

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    await supabase.from("clover_connection").update({
      last_sync_error: `Connection failed: Clover returned ${tokenRes.status}. ${detail}`.slice(0, 500),
    }).eq("id", 1);
    return json({ error: `Clover rejected the connection (status ${tokenRes.status}). ${detail}` }, 502);
  }

  const tokenData = await tokenRes.json();
  const accessExpiresAt = tokenData.access_token_expiration
    ? new Date(tokenData.access_token_expiration * 1000).toISOString()
    : null;
  const refreshExpiresAt = tokenData.refresh_token_expiration
    ? new Date(tokenData.refresh_token_expiration * 1000).toISOString()
    : null;

  const { error: updateError } = await supabase.from("clover_connection").update({
    merchant_id: merchantId || null,
    access_token: tokenData.access_token || null,
    refresh_token: tokenData.refresh_token || null,
    access_token_expires_at: accessExpiresAt,
    refresh_token_expires_at: refreshExpiresAt,
    connected: true,
    last_sync_error: null,
  }).eq("id", 1);

  if (updateError) return json({ error: `Connected, but could not save tokens: ${updateError.message}` }, 500);

  return json({ ok: true, merchant_id: merchantId || null });
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
