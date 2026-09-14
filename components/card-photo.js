/* =============================================================================
   CARD PHOTOS — the client half.

   The scanner already takes a photograph of the card. It goes off to be
   identified and, until now, was dropped on the floor. This keeps it.

   Three jobs, and nothing else:
     shrink(dataUrl)   a 4MB camera frame becomes a ~150KB WebP
     upload(blob, id)  hands it to the worker, gets back the KEY it stored
     urlFor(key)       turns a stored key into an address to put in an <img>

   NOTHING HERE IS ALLOWED TO BREAK AN ADD. If the upload fails -- no signal,
   worker down, storage not set up yet -- the card still gets added with the
   catalog art, exactly as it does today. A photo is a bonus, never a gate.
   Every function returns null rather than throwing for that reason.
   ========================================================================== */
(function () {
  'use strict';

  const cfg = () => window.InfinitePullsConfig || {};
  const base = () => String(cfg().CARD_PHOTO_BASE || '').replace(/\/+$/, '');

  /* ---- is this even switched on? ----------------------------------------
     Until CARD_PHOTO_BASE is filled in, everything below quietly does
     nothing. That is what lets this ship before the bucket exists. */
  const ready = () => !!base();

  /* SIZE, MEASURED RATHER THAN GUESSED. On eight real photos off the shelf,
     1200px at 80% averages 118KB and never went over 171KB. That is 89,000
     photos inside Cloudflare's free 10GB.
     1200 is not arbitrary: a phone at full width on a 3x screen asks for
     about 1180 pixels, so this is exactly sharp and anything smaller is
     visibly soft. Dropping to 800px would save 63KB a card -- photos nobody
     is going to take -- in exchange for pictures that look it. */
  const MAX_DIM = 1200;
  const QUALITY = 0.80;

  /* ---- 4MB of camera into something worth storing ----------------------- */
  function shrink(src, maxDim, quality) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const lim = maxDim || MAX_DIM;
            const scale = Math.min(1, lim / Math.max(img.naturalWidth, img.naturalHeight));
            const w = Math.max(1, Math.round(img.naturalWidth * scale));
            const h = Math.max(1, Math.round(img.naturalHeight * scale));
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            /* WebP first. Safari has taken it since 14, but if a browser
               hands back nothing, JPEG is asked for instead rather than
               storing an empty file. */
            c.toBlob((blob) => {
              if (blob && blob.size) return resolve(blob);
              c.toBlob((jpg) => resolve(jpg && jpg.size ? jpg : null), 'image/jpeg', quality || QUALITY);
            }, 'image/webp', quality || QUALITY);
          } catch (_) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = src;
      } catch (_) { resolve(null); }
    });
  }

  /* ---- hand it over ------------------------------------------------------
     The worker decides the key, from an id Supabase vouched for. The page
     does not get to say whose folder a photo lands in. */
  async function upload(blob, cardId) {
    if (!ready() || !blob || !blob.size) return null;
    try {
      /* the one client the whole app shares -- the same session, so nobody
         is asked to sign in twice */
      const sb = window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
      if (!sb) return null;
      const { data } = await sb.auth.getSession();
      const token = data && data.session && data.session.access_token;
      if (!token) return null;

      const r = await fetch(base() + '/upload?card=' + encodeURIComponent(cardId || ''), {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'image/webp', Authorization: 'Bearer ' + token },
        body: blob
      });
      if (!r.ok) { console.warn('[card-photo] upload refused: ' + r.status); return null; }
      const out = await r.json();
      return (out && out.key) ? out.key : null;
    } catch (e) {
      console.warn('[card-photo] upload failed: ' + ((e && e.message) || 'unknown'));
      return null;
    }
  }

  /* Take the frame the scanner handed back and see it through, start to
     finish. Returns a key or null; never throws, never blocks the add. */
  async function keep(dataUrl, cardId) {
    if (!ready() || !dataUrl) return null;
    const blob = await shrink(dataUrl);
    if (!blob) return null;
    return upload(blob, cardId);
  }

  /* ---- reading one back -------------------------------------------------- */
  function urlFor(key) {
    if (!key) return '';
    if (/^https?:\/\//i.test(key)) return key;   /* already an address; leave it */
    return base() + '/p/' + key.split('/').map(encodeURIComponent).join('/');
  }

  window.InfinitePullsCardPhoto = { ready, shrink, upload, keep, urlFor, MAX_DIM };
})();
