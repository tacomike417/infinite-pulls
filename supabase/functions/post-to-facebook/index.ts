/* POST-TO-FACEBOOK — the only thing that ever sees the page token.

   WHY THIS IS A SERVER AND NOT A FETCH FROM THE PHONE. A Facebook page
   token can post as the shop forever. Anything in browser code can be read
   with View Source by anybody who opens the app, so the token lives here as
   a Supabase secret and the phone only ever says "post this one".

   WHO IS ALLOWED. The caller's Supabase session is checked against
   FB_ALLOWED_USERS -- a list of user ids, nobody else, not even other
   signed-in collectors. An empty list means nobody, on purpose: a
   misconfigured deploy refuses rather than letting the whole roster post to
   the shop's Facebook page.

   SECRETS THIS NEEDS (npx supabase secrets set ...):
     FB_PAGE_ID        the numeric id of the Facebook page
     FB_PAGE_TOKEN     a long-lived PAGE access token for that page
     FB_ALLOWED_USERS  comma-separated Supabase user ids allowed to post
*/

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS }
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const PAGE_ID = Deno.env.get('FB_PAGE_ID') || '';
  const PAGE_TOKEN = Deno.env.get('FB_PAGE_TOKEN') || '';
  const ALLOWED = (Deno.env.get('FB_ALLOWED_USERS') || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';

  if (!PAGE_ID || !PAGE_TOKEN) {
    return json({ error: 'Facebook is not connected yet (FB_PAGE_ID / FB_PAGE_TOKEN).' }, 503);
  }

  /* ---- who is calling ---- */
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return json({ error: 'Sign in first.' }, 401);

  let userId = '';
  try {
    const who = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: ANON }
    });
    if (!who.ok) return json({ error: 'Sign in again.' }, 401);
    const u = await who.json();
    userId = (u && u.id) || '';
  } catch (_) {
    return json({ error: 'Could not check who you are.' }, 401);
  }
  if (!userId || ALLOWED.indexOf(userId) === -1) {
    return json({ error: 'This account is not allowed to post to Facebook.' }, 403);
  }

  /* ---- what to post ---- */
  let body: { imageUrl?: string; caption?: string; link?: string } = {};
  try { body = await req.json(); } catch (_) {}
  const imageUrl = String(body.imageUrl || '');
  const link = String(body.link || '');
  const caption = String(body.caption || '').slice(0, 5000);
  if (!/^https:\/\//i.test(imageUrl)) return json({ error: 'No picture to post.' }, 400);

  /* THE LINK IS PART OF THE CAPTION, on its own line at the end. A photo
     post shows the picture full size and leaves the address as tappable
     text underneath -- which is the whole point: the big picture AND the
     way back to the site. */
  const message = [caption, link].filter(Boolean).join('\n\n');

  /* Facebook fetches the picture itself from `url`, so nothing is uploaded
     twice and the original file is never re-encoded by us. */
  const form = new URLSearchParams();
  form.set('url', imageUrl);
  form.set('caption', message);
  form.set('published', 'true');
  form.set('access_token', PAGE_TOKEN);

  try {
    const r = await fetch('https://graph.facebook.com/v21.0/' + PAGE_ID + '/photos', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    const out = await r.json();
    if (!r.ok) {
      /* Facebook's own words are more useful than ours here -- an expired
         token and a rejected picture look identical from the outside. */
      const msg = (out && out.error && out.error.message) || ('Facebook refused it (' + r.status + ').');
      return json({ error: msg }, 502);
    }
    return json({ ok: true, id: out.post_id || out.id || null });
  } catch (e) {
    return json({ error: 'Could not reach Facebook.' }, 502);
  }
});
