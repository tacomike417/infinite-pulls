/* SIGN IN WITH YOUR USERNAME, AND "FORGOT PASSWORD?" (28 Sep 2026, Mike).
 *
 *   signin { who, password } -> { access_token, refresh_token }
 *     who is a username (or an email). The email behind a username is
 *     looked up HERE, on the server, and never sent to the phone -- so
 *     nobody can use this to find out someone's email address.
 *   reset  { who, redirect } -> { sent_to: "j••••@gmail.com" }
 *     Sends the password reset email. Shows a hidden-middle copy of the
 *     address so someone who forgot WHICH email they used can recognize it.
 *
 * Guarded: 8 wrong passwords in 15 minutes locks that account's sign-in
 * for 15 minutes; 3 reset emails an hour per account.
 *
 * Deploy: npx supabase functions deploy login --no-verify-jwt --project-ref rrkyvcouxdmurwdyuugv
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const pub = () => createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

const mask = (email: string) => {
  const [name, domain] = email.split("@");
  if (!domain) return "your email";
  const keep = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2);
  return keep + "•".repeat(Math.max(3, Math.min(8, name.length - keep.length))) + "@" + domain;
};

async function emailFor(who: string): Promise<{ id: string; email: string } | null> {
  const w = who.trim().replace(/^@/, "");
  if (!w || w.length > 254) return null;
  if (w.includes("@")) {
    const { data } = await admin.rpc("login_user_by_email", { p_email: w.toLowerCase() });
    const row = Array.isArray(data) ? data[0] : data;
    return row ? { id: row.id, email: row.email } : null;
  }
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(w)) return null;
  const { data: p } = await admin.from("profiles").select("id").ilike("username", w.replace(/[_%\\]/g, "\\$&")).maybeSingle();
  if (!p) return null;
  const { data: u } = await admin.auth.admin.getUserById(p.id);
  return u?.user?.email ? { id: p.id, email: u.user.email } : null;
}

async function tooMany(id: string, kind: string, max: number, minutes: number) {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { count } = await admin.from("login_attempts").select("id", { count: "exact", head: true })
    .eq("user_id", id).eq("kind", kind).gt("at", since);
  return (count || 0) >= max;
}
const note = (id: string, kind: string) => admin.from("login_attempts").insert({ user_id: id, kind });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let p: any = {};
  try { p = await req.json(); } catch { return json({ error: "Bad request." }); }
  const who = String(p.who || "");

  if (p.action === "signin") {
    const password = String(p.password || "");
    if (!who || !password) return json({ error: "Enter your username and password." });
    const found = await emailFor(who);
    if (!found) return json({ error: "That username and password don't match." });
    if (await tooMany(found.id, "fail", 8, 15)) return json({ error: "Too many tries. Wait 15 minutes, or tap Forgot password." });
    const { data, error } = await pub().auth.signInWithPassword({ email: found.email, password });
    if (error || !data?.session) {
      if (error && /confirm/i.test(error.message)) return json({ error: "Confirm your email first. Look for the link we sent when you signed up." });
      await note(found.id, "fail");
      return json({ error: "That username and password don't match." });
    }
    return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  }

  if (p.action === "reset") {
    const generic = { sent_to: null, message: "If that account exists, a reset link is on its way to its email." };
    if (!who) return json({ error: "Enter your username or email." });
    const found = await emailFor(who);
    if (!found) return json(generic);
    if (await tooMany(found.id, "reset", 3, 60)) return json({ error: "We already sent a few links. Check your email (and spam), or try again in an hour." });
    let redirect = String(p.redirect || "");
    if (!/^https:\/\/(www\.)?infinitepulls\.com\//.test(redirect)) redirect = "https://infinitepulls.com/feed-next/?reset=1";
    const { error } = await pub().auth.resetPasswordForEmail(found.email, { redirectTo: redirect });
    await note(found.id, "reset");
    if (error) return json({ error: "Couldn't send the email right now. Try again in a little while." });
    return json({ sent_to: mask(found.email), message: "Reset link sent to " + mask(found.email) + ". Check your spam folder too." });
  }

  return json({ error: "Unknown action." });
});
