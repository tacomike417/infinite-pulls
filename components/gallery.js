/* The public gallery — infinitepulls.com/?page=gallery and /pulls/<slug>.
 *
 * WHAT THIS IS
 *
 * Jeff asked for somewhere to put pictures. This is the half a customer
 * sees: a grid of photos, and a page of its own for every one of them.
 *
 * WHY EVERY PHOTO GETS ITS OWN ADDRESS
 *
 * Because a link is the unit of sharing. A gallery you can only link to
 * as a whole gives Jeff one URL to post forever, and Facebook renders the
 * same generic card every time he posts it. A photo with its own address
 * — /pulls/moonbreon-alt-art-just-landed — is a thing he can paste into a
 * post, a text, or a group chat, and it arrives as a picture with a name.
 *
 * The static page builder (tools/build-gallery-pages.mjs) writes a real
 * HTML file at that address with the proper preview tags baked in, since
 * Facebook's crawler does not run JavaScript and GitHub Pages has no
 * server to answer for us. This file is what a PERSON gets: the same
 * address, rendered live in the app, with the rest of the site around it.
 *
 * ON REACTIONS AND THE ABSENCE OF COMMENTS
 *
 * A tap, never a text box. A comment thread on the shop's own page is a
 * job somebody has to do every single day, and the one surface most
 * likely to produce a bad afternoon. Reactions cannot turn on the shop.
 * If comments are ever wanted they are a new table and a switch, not a
 * change to this file.
 */
(function () {
  'use strict';

  const SETTINGS_KEY = 'infinitePullsGallerySettings';
  const VOTER_KEY    = 'infinitePullsGalleryVoter';
  const PAGE_SIZE    = 24;

  let settings = null;    // live, once loaded
  let photos   = [];      // the current page of the grid
  let loadedAll = false;
  let loading   = false;
  let filter   = 'all';   // 'all' | 'shop' | 'customer' -- see loadMore()

  /* ---------- small helpers ------------------------------------------ */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function sb() {
    const s = window.InfinitePullsSupabase;
    return s && s.ready ? s.client : null;
  }

  /* A stable-enough id for one browser, so a person can react without an
   * account and still not count twenty times. Not fraud-proof, and not
   * trying to be — this is a number that tells Jeff people liked a photo,
   * not a ballot. */
  function voterId() {
    // The anonymous fallback. A signed-in voter is resolved in
    // currentVoter() below, where awaiting the session is allowed.
    try {
      let id = window.localStorage.getItem(VOTER_KEY);
      if (!id) {
        id = 'a:' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        window.localStorage.setItem(VOTER_KEY, id);
      }
      return id;
    } catch (_) {
      return 'a:' + Math.random().toString(36).slice(2);
    }
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (!then) return '';
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 2)     return 'just now';
    if (mins < 60)    return mins + ' minutes ago';
    const hrs = Math.round(mins / 60);
    if (hrs < 24)     return hrs === 1 ? 'an hour ago' : hrs + ' hours ago';
    const days = Math.round(hrs / 24);
    if (days === 1)   return 'yesterday';
    if (days < 7)     return days + ' days ago';
    if (days < 14)    return 'last week';
    if (days < 60)    return Math.round(days / 7) + ' weeks ago';
    return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  /* ---------- the master switch --------------------------------------- */

  /* Cached in localStorage so the home page can decide whether to draw the
   * gallery tile SYNCHRONOUSLY, before any network call comes back. Same
   * reasoning as components/infinite-dex-switch.js: a tile that appears a
   * second late looks like a bug, and a page that reflows under somebody's
   * thumb is worse than one that waits.
   *
   * The cached answer is corrected the moment the live one arrives. */
  function cachedSettings() {
    if (settings) return settings;
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    // Same keys, same order as the select below, so a cached guess and a
    // live answer are actually comparable.
    return { gallery_on: true, submissions_on: false, captions_on: true,
             reactions_on: true, home_tile_on: true,
             home_tile_label: 'See what just landed', submit_blurb: '' };
  }

  async function loadSettings() {
    const client = sb();
    if (!client) return cachedSettings();

    const { data, error } = await client
      .from('gallery_settings')
      .select('gallery_on, submissions_on, captions_on, reactions_on, home_tile_on, home_tile_label, submit_blurb')
      .limit(1)
      .maybeSingle();

    if (error || !data) return cachedSettings();

    settings = data;
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch (_) {}

    /* This used to call InfinitePullsApp.renderPage() whenever the live
       answer differed from the cached guess, which it always does on a
       first visit — the cached default has one fewer key than the row.
       That re-entered the page renderer while init() was still awaiting
       this very call, so two init()s ran against the same module state,
       both assigned root.innerHTML, and whichever finished second could
       wipe the grid the first had just filled. A blank gallery, only ever
       on a first visit, which is the worst possible visit to be blank on.

       Nothing needs a full re-render. The only live answer that changes
       what is on screen is whether the gallery is on at all, and
       fillHomeTile() below now checks that itself. */
    return data;
  }

  function galleryOn() {
    return cachedSettings().gallery_on !== false;
  }

  /* ---------- the home page tile --------------------------------------- */

  /* Not a nav link. A link says "there is a gallery"; the newest photo,
   * full width, says "something happened here this week", which is the
   * only one of those two a person comes back for.
   *
   * Rendered empty at first and filled in by fillHomeTile() below, because
   * pages.home() in app.js is synchronous. */
  function homeTileHtml() {
    const s = cachedSettings();
    if (!galleryOn() || s.home_tile_on === false) return '';
    return `
      <section class="gallery-tile" id="gallery-home-tile" hidden>
        <a class="gallery-tile-link" href="/?page=gallery" data-route="gallery">
          <img class="gallery-tile-img" id="gallery-tile-img" alt="" loading="eager">
          <div class="gallery-tile-body">
            <strong>${esc(s.home_tile_label || 'See what just landed')}</strong>
            <small id="gallery-tile-count"></small>
          </div>
        </a>
      </section>`;
  }

  async function fillHomeTile() {
    const wrap = document.getElementById('gallery-home-tile');
    if (!wrap) return;
    const client = sb();
    if (!client) return;

    // The tile was drawn from a cached guess. If the live answer disagrees
    // — the gallery was switched off, or the tile was — it stays hidden.
    // This is what replaces the full re-render that used to happen here.
    await loadSettings();
    const s = cachedSettings();
    if (!galleryOn() || s.home_tile_on === false) { wrap.hidden = true; return; }

    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const [{ data: newest }, { count }] = await Promise.all([
      client.from('gallery_public')
        .select('slug, caption, alt_text, image_url, image_square_url')
        .limit(1),
      client.from('gallery_items')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'published')
        .gte('published_at', since)
    ]);

    const item = newest && newest[0];
    if (!item) return;   // nothing posted yet: no tile, rather than an empty one

    const img = document.getElementById('gallery-tile-img');
    if (img) {
      img.src = item.image_square_url || item.image_url;
      img.alt = item.alt_text || item.caption || '';
    }
    const countEl = document.getElementById('gallery-tile-count');
    if (countEl && count) {
      countEl.textContent = count === 1 ? '1 new this week' : count + ' new this week';
    }
    wrap.hidden = false;
  }

  /* ---------- the grid --------------------------------------------------- */

  /* WHOSE PHOTO IS THIS. Added 3 Sep 2026, because Jeff asked for it after
     watching people use the gallery.

     BOTH get a badge, not just customers. If only customer photos were
     marked, "the shop took this one" would be signalled by ABSENCE -- and an
     absence only reads as a signal to somebody who already knows the
     convention. Nobody arriving from a Facebook link does.

     A customer's badge is their NAME where there is one. It is a credit, not
     a category: their pull is the thing worth showing off, and a label
     reading "customer" would file them under second class on a wall they are
     the point of. */
  function whoBadge(item) {
    if (item.source !== 'customer') {
      return '<span class="gallery-tile-who is-shop">Shop</span>';
    }
    const name = (item.submitted_name || '').trim();
    return `<span class="gallery-tile-who is-fan">${esc(name || 'Customer pull')}</span>`;
  }

  function tileHtml(item) {
    const reactions = cachedSettings().reactions_on !== false && item.reaction_count > 0
      ? `<span class="gallery-tile-reacts">🔥 ${item.reaction_count}</span>` : '';
    return `
      <a class="gallery-cell" href="/pulls/${esc(item.slug)}" data-path>
        <img src="${esc(item.image_square_url || item.image_url)}"
             alt="${esc(item.alt_text || item.caption || '')}"
             loading="lazy" decoding="async">
        ${item.featured ? '<span class="gallery-tile-pin">Pinned</span>' : ''}
        ${whoBadge(item)}
        ${reactions}
      </a>`;
  }

  async function init() {
    const root = document.getElementById('gallery-page');
    if (!root) return;

    await loadSettings();

    if (!galleryOn()) {
      root.innerHTML = `<div class="empty-state">The gallery is taking a short break. Back soon.</div>`;
      return;
    }

    root.innerHTML = `
      <section class="hero">
        <div class="eyebrow">The Gallery</div>
        <h1>Inside Infinite Pulls</h1>
        <p>What is on the shelf, what came out of the case, and what people
           have pulled here.</p>
      </section>
      <!-- Three buttons, not a dropdown: a dropdown hides two of its three
           options behind a tap, and the whole point is that both kinds are
           visible without hunting. -->
      <div class="gallery-filter" role="group" aria-label="Which photos to show">
        <button type="button" class="gallery-filter-btn is-on" data-filter="all" aria-pressed="true">Everything</button>
        <button type="button" class="gallery-filter-btn" data-filter="shop" aria-pressed="false">From the shop</button>
        <button type="button" class="gallery-filter-btn" data-filter="customer" aria-pressed="false">From customers</button>
      </div>
      <div id="gallery-grid" class="gallery-grid"><div class="empty-state">Loading…</div></div>
      <div id="gallery-more-wrap" class="gallery-more" hidden>
        <button type="button" class="secondary-btn" id="gallery-more">Show more</button>
      </div>
      <div id="gallery-submit"></div>`;

    photos = [];
    loadedAll = false;
    await loadMore(true);
    renderSubmit();

    const more = document.getElementById('gallery-more');
    if (more) more.addEventListener('click', () => loadMore(false));

    const filterRow = root.querySelector('.gallery-filter');
    if (filterRow) filterRow.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-filter]');
      if (!btn || btn.dataset.filter === filter) return;

      filter = btn.dataset.filter;
      filterRow.querySelectorAll('[data-filter]').forEach((b) => {
        const on = b.dataset.filter === filter;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      /* Start the list again from nothing. Keeping the old photos and adding
         to them would mix the two kinds back together, which is the one thing
         this control exists to stop. */
      photos = [];
      loadedAll = false;
      const grid = document.getElementById('gallery-grid');
      if (grid) grid.innerHTML = `<div class="empty-state">Loading…</div>`;
      await loadMore(true);
    });
  }

  async function loadMore(first) {
    if (loading || loadedAll) return;
    loading = true;

    const client = sb();
    const grid = document.getElementById('gallery-grid');
    if (!client) {
      if (grid) grid.innerHTML = `<div class="empty-state">The gallery is not connected yet.</div>`;
      loading = false;
      return;
    }

    const from = photos.length;

    /* `source` and `submitted_name` added 3 Sep 2026. The grid could not tell
       a shop photo from a customer's because it never asked for the two
       columns that say so -- the detail page had been crediting people by
       name all along. */
    let query = client
      .from('gallery_public')
      .select('slug, caption, alt_text, image_url, image_square_url, reaction_count, featured, published_at, source, submitted_name');

    /* Filtered in the QUERY, not in the page we already have. Filtering after
       the fetch would quietly break Show more: a page of twelve holding four
       customer photos would look like "four exist" and the button would go. */
    if (filter !== 'all') query = query.eq('source', filter);

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);

    loading = false;

    if (error) {
      if (grid && first) grid.innerHTML = `<div class="empty-state">Could not load the gallery just now.</div>`;
      return;
    }

    if (!data || !data.length) {
      loadedAll = true;
      if (grid && first) {
        // An empty gallery is not an error, and the copy says so. Nothing
        // here is anybody's fault and nobody is being told to fix it. Each
        // filter gets its own line: "no photos yet" under From customers
        // would read as the whole gallery being empty.
        grid.innerHTML = `<div class="empty-state">${
          filter === 'customer'
            ? 'No customer pulls up here yet — yours could be the first.'
            : filter === 'shop'
              ? 'Nothing from the shop up yet — there could be some by the weekend.'
              : 'No photos up yet — there could be some by the weekend.'
        }</div>`;
      }
      const wrap = document.getElementById('gallery-more-wrap');
      if (wrap) wrap.hidden = true;
      return;
    }

    photos = photos.concat(data);
    if (grid) grid.innerHTML = photos.map(tileHtml).join('');

    if (data.length < PAGE_SIZE) loadedAll = true;
    const wrap = document.getElementById('gallery-more-wrap');
    if (wrap) wrap.hidden = loadedAll;
  }

  /* ---------- one photo --------------------------------------------------- */

  /* Resolving a slug, including one that used to belong to this photo.
   *
   * Rule 2 from supabase/gallery.sql: a link Jeff posted in March has to
   * keep working after somebody fixes a typo in the slug in June. The
   * alias table holds every address a photo has ever had. */
  async function findBySlug(slug) {
    const client = sb();
    if (!client) return null;

    const { data } = await client
      .from('gallery_public')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();
    if (data) return data;

    const { data: alias } = await client
      .from('gallery_slug_aliases')
      .select('item_id')
      .eq('slug', slug)
      .maybeSingle();
    if (!alias) return null;

    const { data: moved } = await client
      .from('gallery_public')
      .select('*')
      .eq('id', alias.item_id)
      .maybeSingle();

    // Put the current address in the bar without adding a history entry —
    // Back should return where they came from, not to the old link.
    if (moved) history.replaceState(null, '', '/pulls/' + moved.slug);
    return moved || null;
  }

  async function initPhoto(slug) {
    const root = document.getElementById('gallery-page');
    if (!root) return;

    await loadSettings();
    const item = await findBySlug(slug);

    if (!item) {
      root.innerHTML = `
        <section class="hero">
          <h1>That photo has moved on</h1>
          <p>It could have been taken down, or the link could have a typo in it.
             The rest of the gallery is still here.</p>
          <p><a class="primary-btn" href="/?page=gallery" data-route="gallery">See the gallery</a></p>
        </section>`;
      return;
    }

    document.title = (item.title || item.caption || 'Photo') + ' — Infinite Pulls';

    /* WHOSE PHOTO, ON THE PHOTO'S OWN PAGE. Amended 3 Sep 2026.

       This used to credit customers and say nothing at all for the shop --
       so on the one page a stranger lands on from Facebook, "Infinite Pulls
       took this" was communicated by silence. Same fault the grid had.

       An anonymous customer photo gets a line too. Falling through to no
       credit at all would make it read as the shop's, which is the exact
       distinction all of this exists to draw.

       KEEP IN STEP with tools/build-gallery-pages.mjs, which renders the
       version crawlers and Facebook actually get. Two renderers, one page:
       if they drift, the thing people see and the thing Google reads stop
       agreeing and neither of them looks wrong on its own. */
    const credit = item.source === 'customer'
      ? (item.submitted_name
          ? `<p class="gallery-credit">Pulled by
               <a href="/${esc(item.submitted_name)}">${esc(item.submitted_name)}</a>
               at the shop.</p>`
          : `<p class="gallery-credit">Pulled by a customer at the shop.</p>`)
      : `<p class="gallery-credit">Posted by Infinite Pulls.</p>`;

    const reacts = cachedSettings().reactions_on !== false ? `
      <div class="gallery-reacts" id="gallery-reacts">
        <button type="button" class="react-btn" data-kind="fire">🔥 <span id="react-count">${esc(item.reaction_count || 0)}</span></button>
        <button type="button" class="react-btn" data-kind="heart">❤️</button>
      </div>` : '';

    root.innerHTML = `
      <article class="gallery-photo">
        <img class="gallery-photo-img"
             src="${esc(item.image_url)}"
             alt="${esc(item.alt_text || item.caption || '')}"
             ${item.image_width ? `width="${esc(item.image_width)}"` : ''}
             ${item.image_height ? `height="${esc(item.image_height)}"` : ''}>

        <div class="gallery-photo-body">
          <p class="gallery-caption">${esc(item.caption)}</p>
          ${credit}
          <p class="gallery-meta">
            <span>${esc(timeAgo(item.published_at))}</span>
            ${item.view_count ? `<span> · ${esc(item.view_count)} views</span>` : ''}
          </p>
          ${reacts}
          <div class="gallery-actions">
            <button type="button" class="secondary-btn" id="gallery-share">Share this</button>
            <a class="secondary-btn" href="/?page=gallery" data-route="gallery">Back to the gallery</a>
          </div>
        </div>
      </article>
      <nav class="gallery-nav" id="gallery-nav"></nav>`;

    bumpView(item.slug);
    wireReactions(item);
    wireShare(item);
    wireNeighbours(item);
  }

  async function bumpView(slug) {
    const client = sb();
    if (!client) return;
    // Fire and forget. A view that fails to count is not worth a message.
    try { await client.rpc('gallery_bump_view', { p_slug: slug }); } catch (_) {}
  }

  async function currentVoter() {
    const client = sb();
    if (client && client.auth) {
      try {
        const { data } = await client.auth.getUser();
        if (data && data.user) return 'u:' + data.user.id;
      } catch (_) {}
    }
    return voterId();
  }

  function wireReactions(item) {
    const wrap = document.getElementById('gallery-reacts');
    if (!wrap) return;

    wrap.addEventListener('click', async (e) => {
      const btn = e.target.closest('.react-btn');
      if (!btn || btn.disabled) return;
      const client = sb();
      if (!client) return;

      btn.disabled = true;
      btn.classList.add('is-on');

      const voter = await currentVoter();
      const { error } = await client.from('gallery_reactions')
        .insert({ item_id: item.id, voter, kind: btn.dataset.kind });

      // A duplicate is the ordinary case — somebody tapped twice, or came
      // back to the page. Nothing to say about it.
      if (!error && btn.dataset.kind === 'fire') {
        const count = document.getElementById('react-count');
        if (count) count.textContent = String(Number(count.textContent || 0) + 1);
      }
    });
  }

  function wireShare(item) {
    const btn = document.getElementById('gallery-share');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      const url = location.origin + '/pulls/' + item.slug;
      const client = sb();
      if (client) { try { await client.rpc('gallery_bump_share', { p_slug: item.slug }); } catch (_) {} }

      if (navigator.share) {
        try {
          await navigator.share({ title: item.title || 'Infinite Pulls', text: item.caption, url });
          return;
        } catch (_) { /* they closed the sheet; fall through to copy */ }
      }

      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = 'Link copied';
        setTimeout(() => { btn.textContent = 'Share this'; }, 2500);
      } catch (_) {
        window.prompt('Copy this link:', url);
      }
    });
  }

  /* Previous/next, plus a swipe, because on a phone this is a photo viewer
   * and a photo viewer that does not swipe feels broken. */
  async function wireNeighbours(item) {
    const nav = document.getElementById('gallery-nav');
    const client = sb();
    if (!nav || !client) return;

    const [{ data: newer }, { data: older }] = await Promise.all([
      client.from('gallery_public').select('slug, alt_text, image_square_url, image_url')
        .gt('published_at', item.published_at).order('published_at', { ascending: true }).limit(1),
      client.from('gallery_public').select('slug, alt_text, image_square_url, image_url')
        .lt('published_at', item.published_at).limit(1)
    ]);

    const prev = newer && newer[0];
    const next = older && older[0];

    nav.innerHTML = `
      ${prev ? `<a class="gallery-nav-link" href="/pulls/${esc(prev.slug)}" data-path>← Newer</a>` : '<span></span>'}
      ${next ? `<a class="gallery-nav-link" href="/pulls/${esc(next.slug)}" data-path>Older →</a>` : '<span></span>'}`;

    const img = document.querySelector('.gallery-photo-img');
    if (!img) return;

    let startX = 0, startY = 0;
    img.addEventListener('touchstart', (e) => {
      startX = e.changedTouches[0].clientX;
      startY = e.changedTouches[0].clientY;
    }, { passive: true });

    img.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      // Horizontal, and clearly horizontal — otherwise this hijacks scroll.
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const target = dx < 0 ? next : prev;
      if (target && window.InfinitePullsNavigateToPath) {
        window.InfinitePullsNavigateToPath('/pulls/' + target.slug);
      }
    }, { passive: true });
  }

  /* ---------- customer submissions ------------------------------------- */

  /* Two independent gates, exactly as agreed: the master switch decides
   * whether this appears at all, and Jeff's approval decides whether
   * anything sent through it is ever seen by another person. */
  async function renderSubmit() {
    const root = document.getElementById('gallery-submit');
    if (!root) return;
    const s = cachedSettings();
    if (!s.submissions_on) { root.innerHTML = ''; return; }

    const client = sb();
    if (!client) { root.innerHTML = ''; return; }

    let user = null;
    try {
      const { data } = await client.auth.getUser();
      user = data && data.user;
    } catch (_) {}

    if (!user) {
      root.innerHTML = `
        <section class="section gallery-submit">
          <div class="eyebrow">Your pulls</div>
          <p>${esc(s.submit_blurb || '')}</p>
          <p><a class="secondary-btn" href="/?page=account" data-route="account">Sign in to send a photo</a></p>
        </section>`;
      return;
    }

    root.innerHTML = `
      <section class="section gallery-submit">
        <div class="eyebrow">Your pulls</div>
        <p>${esc(s.submit_blurb || '')}</p>
        <label class="primary-btn gallery-submit-btn" for="gallery-submit-file">Choose a photo</label>
        <input type="file" id="gallery-submit-file" accept="image/*" hidden>
        <p class="gallery-submit-note" id="gallery-submit-note"></p>
      </section>`;

    const input = document.getElementById('gallery-submit-file');
    const note  = document.getElementById('gallery-submit-note');

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;

      note.textContent = 'Making it look good…';

      try {
        // crops:false on purpose — see components/gallery-image.js. The
        // shop's watermark does not go on a photo before the shop has
        // agreed to publish it.
        const prepared = await window.InfinitePullsGalleryImage.prepare(file, { crops: false });

        const path = `submissions/${user.id}/${Date.now()}.jpg`;
        const up = await client.storage.from('gallery')
          .upload(path, prepared.full, { contentType: 'image/jpeg', upsert: false });
        if (up.error) throw up.error;

        const { data: pub } = client.storage.from('gallery').getPublicUrl(path);

        let name = null;
        try {
          const { data: profile } = await client.from('profiles')
            .select('username').eq('id', user.id).maybeSingle();
          name = profile && profile.username;
        } catch (_) {}

        const slug = 'pull-' + Date.now().toString(36);
        const ins = await client.from('gallery_items').insert({
          slug,
          image_url: pub.publicUrl,
          image_width: prepared.width,
          image_height: prepared.height,
          source: 'customer',
          status: 'pending',
          submitted_by: user.id,
          submitted_name: name,
          chips: ['customer-pull']
        });
        if (ins.error) throw ins.error;

        note.textContent = 'Sent. If it goes up, we will put your name on it.';
      } catch (err) {
        note.textContent = 'That did not go through. You could try once more.';
      } finally {
        input.value = '';
      }
    });
  }

  window.InfinitePullsGallery = {
    init,
    initPhoto,
    loadSettings,
    galleryOn,
    homeTileHtml,
    fillHomeTile
  };
})();
