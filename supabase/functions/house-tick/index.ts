// HOUSE-TICK -- the house accounts' real clock (19 Nov 2026).
//
// GitHub's own 15-minute timer was only waking "House account posts" about
// three times a day, so most post slots were skipped. A Supabase timer
// (pg_cron job "infinite-pulls-house-tick") now calls this every 15 minutes,
// and this asks GitHub to run the workflow in normal mode for all accounts.
// The posting rules have not changed -- each account's script still decides
// whether a slot is due.
//
// Needs one secret: GH_DISPATCH_TOKEN, a GitHub token that can run Actions
// on the repo. When that token expires, posting slows back down -- make a
// new one and set the secret again.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const REPO = Deno.env.get("GH_REPO") ?? "tacomike417/infinite-pulls";
const WORKFLOW = "house-posts.yml";

Deno.serve(async () => {
  const token = Deno.env.get("GH_DISPATCH_TOKEN");
  if (!token) {
    return Response.json({ ok: false, error: "GH_DISPATCH_TOKEN is not set" }, { status: 500 });
  }
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "InfinitePulls-HouseTick/1.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { mode: "normal", account: "all" } }),
    },
  );
  const text = r.ok ? "" : (await r.text()).slice(0, 300);
  if (!r.ok) console.error("github said", r.status, text);
  return Response.json({ ok: r.ok, github_status: r.status, error: text || undefined },
    { status: r.ok ? 200 : 502 });
});
