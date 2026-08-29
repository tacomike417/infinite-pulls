/* Card data, from our own database first.
 *
 * WHAT CHANGED AND WHY
 *
 * Every TCGdex call used to go straight from the browser to
 * api.tcgdex.net. On 29 August 2026 that host stopped answering — not an
 * error, no response at all — and card search and prices went with it for
 * as long as it lasted.
 *
 * TCGdex is free, community-run, and has no paid tier and no SLA. You
 * cannot buy uptime from them. TCGplayer's API is closed to new
 * applicants. The commercial middlemen sell prices but not card images.
 * There is no API purchase that fixes this.
 *
 * So the app keeps its own copy, in the Supabase project — which answered
 * in half a second while TCGdex was dead.
 *
 * THE ORDER OF PREFERENCE, WHICH IS THE WHOLE DESIGN
 *
 *   1. Our cache, if it is fresh          — no network call at all, ~50ms
 *   2. The tcgdex edge function           — refreshes it and stores it
 *   3. Our cache, however old it is       — because upstream is unwell
 *   4. Only now, an error                 — we have simply never had this
 *
 * Step 3 is the point. Freshness is a preference; availability is the
 * requirement. A price from this morning shown with a date on it is a
 * good afternoon. A spinner is not.
 *
 * WHAT STALE ACTUALLY LOOKS LIKE
 *
 * TCGdex returns prices inside the card object, so a stale copy is a
 * whole card that is slightly old rather than a fresh card with old
 * prices. In practice every permanent field — name, set, number, rarity,
 * illustrator, Dex number, image — is still exactly right, because those
 * never change once a card is printed. Only the prices are from earlier.
 * Callers get `stale` and `fetchedAt` so they can say so.
 */
(function () {
  'use strict';

  const ROOT = 'https://api.tcgdex.net/v2/';

  // What the last call actually did, so the UI can mention it without
  // every call site having to thread a flag back up.
  let lastResult = { source: null, stale: false, fetchedAt: null };

  function sb() {
    const s = window.InfinitePullsSupabase;
    return s && s.ready ? s.client : null;
  }

  /* Full URL in, cache path out. Keeps every existing call site unchanged:
   * they still build a TCGdex URL, this quietly turns it into a lookup. */
  function pathOf(url) {
    const s = String(url || '');
    return s.startsWith(ROOT) ? s.slice(ROOT.length) : null;
  }

  async function readCache(client, path) {
    const { data, error } = await client
      .from('tcgdex_cache_public')
      .select('payload, fresh, fetched_at')
      .eq('path', path)
      .maybeSingle();
    if (error || !data) return null;
    return { payload: data.payload, fresh: data.fresh === true, fetchedAt: data.fetched_at };
  }

  /* Fire and forget. Knowing which cards get looked at is what makes a
   * sensible pre-warm possible later; it is not worth a millisecond of
   * anybody's wait. */
  function countHit(client, path) {
    try { client.rpc('tcgdex_cache_hit', { p_path: path }).then(() => {}, () => {}); } catch (_) {}
  }

  async function refresh(client, path) {
    const res = await client.functions.invoke('tcgdex', { body: { path } });
    if (res.error) throw new Error(res.error.message || 'refresh failed');
    const d = res.data || {};
    if (d.error) throw new Error(d.error);
    return d;   // { payload, source, fresh, fetched_at, note? }
  }

  /* The replacement for what used to be a bare fetch(). */
  async function fetchCached(url) {
    const client = sb();
    const path = pathOf(url);

    // Not a TCGdex URL, or Supabase is not configured. Fall back to the
    // old behaviour rather than refusing — with a timeout, because the
    // whole reason we are here is that this call can hang forever.
    if (!client || !path) {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('TCGdex returned ' + res.status);
      lastResult = { source: 'direct', stale: false, fetchedAt: null };
      return res.json();
    }

    // 1 — our own copy, if it is current
    let cached = null;
    try { cached = await readCache(client, path); } catch (_) {}

    if (cached && cached.fresh) {
      countHit(client, path);
      lastResult = { source: 'cache', stale: false, fetchedAt: cached.fetchedAt };
      return cached.payload;
    }

    // 2 — refresh it
    try {
      const fresh = await refresh(client, path);
      if (fresh && fresh.payload !== undefined) {
        countHit(client, path);
        lastResult = {
          source: fresh.source || 'upstream',
          stale: fresh.fresh === false,
          fetchedAt: fresh.fetched_at || null
        };
        return fresh.payload;
      }
    } catch (_) {
      // deliberate: fall through to whatever we already have
    }

    // 3 — upstream is unwell, and old data is still data
    if (cached) {
      countHit(client, path);
      lastResult = { source: 'stale', stale: true, fetchedAt: cached.fetchedAt };
      return cached.payload;
    }

    // 4 — never had it, cannot get it
    lastResult = { source: 'none', stale: false, fetchedAt: null };
    throw new Error('Card data is unavailable right now.');
  }

  /* "Prices from Tuesday" — a short, honest line the card view can show
   * when what it is displaying did not come from upstream just now. */
  function stalenessNote() {
    if (!lastResult.stale || !lastResult.fetchedAt) return '';
    const then = new Date(lastResult.fetchedAt);
    if (isNaN(then)) return '';
    const hours = Math.round((Date.now() - then.getTime()) / 3600000);
    if (hours < 2)  return 'Prices from the last hour or so.';
    if (hours < 24) return `Prices from about ${hours} hours ago.`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'Prices from yesterday.'
                      : `Prices from about ${days} days ago.`;
  }

  window.InfinitePullsTcgdex = {
    fetch: fetchCached,
    last: () => ({ ...lastResult }),
    stalenessNote,
    ROOT
  };
})();
