/* POST-TO-INSTAGRAM — the shop's Instagram, from the same one screen.

   WHY THIS LOOKS DIFFERENT FROM THE FACEBOOK ONE. Facebook takes a photo in
   a single call. Instagram does not: you hand it an address, it goes and
   fetches the picture into a "container", and only then do you tell it to
   publish that container. Two calls, and the first one can still be working
   when it answers -- so the status is checked before publishing rather than
   hoped about.

   IT POSTS THROUGH THE FACEBOOK PAGE. Nobody ever signs into Instagram.
   The Instagram account is connected to the shop's Facebook page, so the
   SAME page token that posts to Facebook posts here too. That is the whole
   reason this was possible without Jeff's Instagram password.

   WHAT INSTAGRAM WILL NOT TAKE, and the phone deals with before it gets
   here: anything that is not a JPEG, and anything taller than 4:5. The app
   sends a square JPEG copy; the original is untouched and is what Facebook
   and the feed get.

   SECRETS THIS NEEDS:
     IG_USER_ID        the Instagram professional account's numeric id
     FB_PAGE_TOKEN     the page token -- the same one Facebook posting uses
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

const GRAPH = 'https://graph.facebook.com/v21.0/';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const IG_ID = Deno.env.get('IG_USER_ID') || '';
  const PAGE_TOKEN = Deno.env.get('FB_PAGE_TOKEN') || '';
  const ALLOWED = (Deno.env.get('FB_ALLOWED_USERS') || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';

  if (!IG_ID || !PAGE_TOKEN) {
    return json({ error: 'Instagram is not connected yet (IG_USER_ID / FB_PAGE_TOKEN).' }, 503);
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
    return json({ error: 'This account is not allowed to post to Instagram.' }, 403);
  }

  /* ---- what to post ---- */
  let body: { imageUrl?: string; caption?: string } = {};
  try { body = await req.json(); } catch (_) {}
  const imageUrl = String(body.imageUrl || '');
  const typed = String(body.caption || '').trim().slice(0, 2000);
  if (!/^https:\/\//i.test(imageUrl)) return json({ error: 'No picture to post.' }, 400);

  /* A LINK IN AN INSTAGRAM CAPTION IS NOT A LINK. It is grey text nobody can
     tap. So the caption points at the bio instead, which is where Instagram
     has trained everybody to look, and the bio stays pointed at the site. */
  const caption = [typed, 'Link in bio.'].filter(Boolean).join('\n\n');

  try {
    /* ---- 1. build the container ---- */
    const make = new URLSearchParams();
    make.set('image_url', imageUrl);
    make.set('caption', caption);
    make.set('access_token', PAGE_TOKEN);

    const mr = await fetch(GRAPH + IG_ID + '/media', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: make.toString()
    });
    const made = await mr.json();
    if (!mr.ok || !made || !made.id) {
      const msg = (made && made.error && made.error.message) ||
                  ('Instagram refused the picture (' + mr.status + ').');
      return json({ error: msg }, 502);
    }
    const creationId = String(made.id);

    /* ---- 2. wait for Instagram to finish fetching it ----
       A single photo is usually FINISHED on the first look. It is checked
       anyway, because publishing a container that is still IN_PROGRESS
       fails with an error that reads like the token is broken, and that is
       a phone call nobody needs. */
    let state = '';
    for (let i = 0; i < 6; i++) {
      const sr = await fetch(GRAPH + creationId +
        '?fields=status_code,status&access_token=' + encodeURIComponent(PAGE_TOKEN));
      const st = await sr.json();
      state = (st && st.status_code) || '';
      if (state === 'FINISHED') break;
      if (state === 'ERROR') {
        return json({ error: (st && st.status) || 'Instagram could not read the picture.' }, 502);
      }
      await sleep(1200);
    }
    if (state !== 'FINISHED') {
      return json({ error: 'Instagram is still working on it. Try again in a minute.' }, 504);
    }

    /* ---- 3. publish it ---- */
    const pub = new URLSearchParams();
    pub.set('creation_id', creationId);
    pub.set('access_token', PAGE_TOKEN);

    const pr = await fetch(GRAPH + IG_ID + '/media_publish', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: pub.toString()
    });
    const out = await pr.json();
    if (!pr.ok || !out || !out.id) {
      const msg = (out && out.error && out.error.message) ||
                  ('Instagram would not publish it (' + pr.status + ').');
      return json({ error: msg }, 502);
    }

    /* ---- 4. where it landed ----
       Same reason the Facebook button now hands back a link: "it worked" and
       "it is on the account you are looking at" are not the same sentence. */
    let permalink = '';
    try {
      const lr = await fetch(GRAPH + out.id +
        '?fields=permalink&access_token=' + encodeURIComponent(PAGE_TOKEN));
      const l = await lr.json();
      permalink = (l && l.permalink) || '';
    } catch (_) { /* a missing link is not a failed post */ }

    return json({ ok: true, id: out.id, permalink });
  } catch (_) {
    return json({ error: 'Could not reach Instagram.' }, 502);
  }
});
