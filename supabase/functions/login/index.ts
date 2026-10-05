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
 *   join   { username, password, birthdate, invited_by } -> { access_token, refresh_token }
 *     THE FAST JOIN (5 Oct 2026, Mike: "least possible amount of steps to get on the site").
 *     Most people arrive from Instagram, inside Instagram's own little browser, and the old
 *     join made them leave to find a confirm email. Now: name, password, birthday, in.
 *     There is no email yet, so the account is made with a stand-in address
 *     (name@noemail.infinitepulls.com, which goes nowhere) and the feed asks for a real one after.
 *     Guarded: 6 new accounts an hour from one internet address (supabase/quick_join.sql).
 *   add_email { email } (signed in) -> { ok }
 *     Puts a real email on an account that still has the stand-in. It is NOT checked with a
 *     confirm link (that is the step we took out), so a typo means no password reset until
 *     they fix it in Edit profile. Only works while the account has the stand-in address.
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

const NOEMAIL = "@noemail.infinitepulls.com";
const yearsOld = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a >= 0 && a < 125 ? a : null;
};

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

  if (p.action === "join") {
    const username = String(p.username || "").trim().replace(/^@/, "");
    const password = String(p.password || "");
    const birthdate = String(p.birthdate || "");
    if (!/^[A-Za-z0-9_-]{3,24}$/.test(username)) return json({ error: "Names can only use letters, numbers, underscores, and hyphens (3 to 24 characters)." });
    if (password.length < 6 || password.length > 72) return json({ error: "Password must be at least 6 characters." });
    const age = yearsOld(birthdate);
    if (age == null) return json({ error: "Please enter your birthday." });
    if (age < 13) return json({ error: "Sorry, you have to be 13 or older to make an account. A parent or guardian can make one in their name." });
    let inviter = String(p.invited_by || "").trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9_-]{3,24}$/.test(inviter)) inviter = "";
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 60) || "unknown";
    try {      // no table yet = no limit, the join still works
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count, error } = await admin.from("join_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).gt("at", since);
      if (!error && (count || 0) >= 6) return json({ error: "A lot of accounts were just made from here. Try again in an hour." });
    } catch { /* fine */ }
    const { data: taken } = await admin.from("profiles").select("id").ilike("username", username.replace(/[_%\\]/g, "\\$&")).maybeSingle();
    if (taken) return json({ error: "That name is already taken. Try another." });
    const email = username.toLowerCase() + NOEMAIL;
    const { error: made } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { username, birthdate, invited_by: inviter || null, terms: true, no_email: true },
    });
    if (made) return json({ error: /already|registered|exists/i.test(made.message) ? "That name is already taken. Try another." : "That name can't be used. Try another." });
    try { await admin.from("join_attempts").insert({ ip }); } catch { /* fine */ }
    const { data, error } = await pub().auth.signInWithPassword({ email, password });
    if (error || !data?.session) return json({ error: "Your account was made. Tap Log in and use your name and password." });
    return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  }

  if (p.action === "add_email") {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    const user = u?.user;
    if (!user) return json({ error: "Log in first." });
    if (!String(user.email || "").endsWith(NOEMAIL)) return json({ error: "This account already has an email." });
    const email = String(p.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254 || email.endsWith(NOEMAIL)) return json({ error: "That email doesn't look right." });
    const { error } = await admin.auth.admin.updateUserById(user.id, { email, email_confirm: true, user_metadata: { ...(user.user_metadata || {}), no_email: false } });
    if (error) return json({ error: /already|registered|exists/i.test(error.message) ? "That email is on another account." : "Couldn't save it right now. Try again." });
    return json({ ok: true });
  }

  if (p.action === "reset") {
    const generic = { sent_to: null, message: "If that account has an email on it, a reset link is on its way. An account with no email on it can't be reset." };   // 5 Oct 2026 (Mike): "if they dont put in a recovery email then that is on them"
    if (!who) return json({ error: "Enter your username or email." });
    const found = await emailFor(who);
    if (!found) return json(generic);
    /* a fast-join account that never added an email: nowhere to send a link. The same words as
       "not found", so this can't be used to learn which names skipped the email. */
    if (found.email.endsWith(NOEMAIL)) return json(generic);
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
