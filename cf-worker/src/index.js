/* =============================================================================
   INFINITE PULLS — CARD PHOTOS

   A small Cloudflare Worker sitting in front of one R2 bucket. It does two
   things and refuses everything else:

     POST /upload   a signed-in person hands it an image, it stores it and
                    hands back the KEY it stored it under
     GET  /p/<key>  anybody reads that image back

   WHY A WORKER AND NOT A DIRECT UPLOAD. R2 will not take a write from a
   browser without a signature, and the only thing that could sign one is a
   secret -- which cannot sit in a web page. So the write goes through here,
   where the secret lives on the server side and nowhere else.

   WHY IT RETURNS A KEY AND NOT A URL. The key goes in the database. If the
   photos ever move to a custom domain -- cards.infinitepulls.com instead of
   a workers.dev address -- that is one line of config in the app, not a
   rewrite of every row that was ever saved. A URL in a database is a promise
   about a hostname you may not want to keep.

   WHAT IT TRUSTS. Nothing the page says about who it is. It takes the
   caller's Supabase access token and asks Supabase whose it is. That costs
   one extra round trip on an upload -- which happens once per card scanned,
   not once per screen -- and in exchange there is no JWT secret to keep in
   sync here and no signing algorithm to guess wrong.
   ========================================================================== */

/* The page shrinks before it sends, so anything arriving here should be
   around 118KB and the biggest measured was 171KB. 600KB is generous room
   for an odd photo or a browser that fell back to JPEG, and still a tight
   ceiling on anybody trying to fill the bucket with something else. */
const MAX_BYTES = 600 * 1024;
const OK_TYPES  = ['image/webp', 'image/jpeg', 'image/png'];
const EXT       = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

/* Only these pages may call it. A wildcard here would let any site on the
   internet spend your storage using a token it phished elsewhere. */
const ALLOWED = [
  'https://infinitepulls.com',
  'https://www.infinitepulls.com',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
];

const cors = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin'
});

const say = (obj, status, origin) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) }
  });

/* Who is this? Supabase is the only thing that gets to answer. */
async function whoIs(token, env) {
  if (!token) return null;
  try {
    const r = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: env.SUPABASE_ANON_KEY }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) ? u.id : null;
  } catch (_) { return null; }
}

/* A key is only ever built here, from an id Supabase vouched for and a card
   id scrubbed down to characters that cannot climb out of a path. */
function keyFor(userId, cardId, type) {
  /* Dots are kept because real card ids have them -- me02.5-154 -- but a RUN
     of them is collapsed. Leaving `..` in the key would not escape the
     bucket, but the read handler refuses any key containing it, so the photo
     would upload happily and then 404 forever. The test caught exactly that. */
  const safe = String(cardId || 'card')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 60) || 'card';
  const rand = crypto.randomUUID().slice(0, 8);
  return `u/${userId}/${safe}-${Date.now()}-${rand}.${EXT[type]}`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    /* ---------------- read ---------------- */
    if (request.method === 'GET' && url.pathname.startsWith('/p/')) {
      const key = decodeURIComponent(url.pathname.slice(3));
      if (!key || key.includes('..')) return new Response('Not found', { status: 404 });

      /* THE EDGE ANSWERS FIRST.
         Every trip to the bucket is a billable operation, and a feed is the
         one thing on this app that reads the same picture over and over --
         one popular card scrolling past a hundred people is a hundred reads
         of one unchanging file. A key carries a timestamp, so it names one
         set of bytes forever and can be cached without any way to be wrong.
         With this, the bucket is touched once per photo per location and the
         edge serves the rest. Without it, the feed getting popular is the
         thing that puts a number on the bill. */
      const cache = (typeof caches !== 'undefined' && caches.default) || null;
      if (cache) {
        const hit = await cache.match(request);
        if (hit) return hit;
      }

      const obj = await env.CARD_PHOTOS.get(key);
      if (!obj) return new Response('Not found', { status: 404 });
      const h = new Headers();
      obj.writeHttpMetadata(h);
      h.set('etag', obj.httpEtag);
      h.set('Cache-Control', 'public, max-age=31536000, immutable');
      h.set('Access-Control-Allow-Origin', '*');
      const out = new Response(obj.body, { headers: h });
      /* the copy goes in the cache, the original goes to the reader --
         a body can only be read once */
      if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(request, out.clone()));
      return out;
    }

    /* ---------------- write ---------------- */
    if (request.method === 'POST' && url.pathname === '/upload') {
      const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
      if (!OK_TYPES.includes(type)) return say({ error: 'That is not an image we store.' }, 415, origin);

      const len = Number(request.headers.get('Content-Length') || 0);
      if (len > MAX_BYTES) return say({ error: 'Too big. Shrink it before sending.' }, 413, origin);

      const auth = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const userId = await whoIs(auth, env);
      if (!userId) return say({ error: 'Sign in first.' }, 401, origin);

      const body = await request.arrayBuffer();
      /* Content-Length can lie or be absent. This is the check that counts. */
      if (body.byteLength === 0) return say({ error: 'Nothing was sent.' }, 400, origin);
      if (body.byteLength > MAX_BYTES) return say({ error: 'Too big. Shrink it before sending.' }, 413, origin);

      const key = keyFor(userId, url.searchParams.get('card'), type);
      await env.CARD_PHOTOS.put(key, body, {
        httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' }
      });
      return say({ key }, 200, origin);
    }

    /* Anything else, including a bare GET of the root, gets nothing useful. */
    return say({ error: 'No.' }, 404, origin);
  }
};
