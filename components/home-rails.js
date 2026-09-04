/* THE TWO HORIZONTAL RAILS ON THE HOME PAGE.
 *
 *   1. The quick rail — six round-cornered chips straight under the white
 *      scoreboard: My Profile, Scanner, My Collection, Badges, Infinite
 *      Rewards, My Pokédex.
 *   2. The tutorial rail — up to five YouTube videos Jeff writes into the
 *      admin panel, further down, under the gallery tile.
 *
 * WHY A SIDEWAYS RAIL AND NOT MORE BOXES
 *
 * The nine-box grid below already proved the point: nine things of equal
 * size is not a menu, it is wallpaper. A rail puts the six most-used
 * destinations in one line at thumb height and lets the rest of the page
 * keep its shape.
 *
 * THE ONE RULE BOTH RAILS OBEY: SHOW A CUT-OFF ITEM
 *
 * Jeff did not know the admin panel's tab strip scrolled sideways. He is
 * not slow -- he worked it the second it was pointed out -- he simply does
 * not poke at things to find out what they do, and neither do most people
 * standing in a shop. A rail whose last visible item is a WHOLE item looks
 * like the end of the list. A rail with a card sliced by the right edge is
 * a question anybody answers with their thumb without being told.
 *
 * So the video rail is sized to show one and a half cards, never two, and
 * the chips are sized so the sixth is always part-way off screen. That is
 * a layout constraint here, not a nicety.
 *
 * WHERE THE VIDEOS COME FROM
 *
 * store_info.data.videos -- the same single JSON row the admin panel
 * already loads and saves for the store name, hours and announcement. No
 * new table, no new policy, nothing to migrate: Jeff gets fields in a
 * panel he already uses. Five is the cap, and it is enforced here as well
 * as in the panel, because a rail is a rail and not a library.
 *
 * Nothing renders at all when the list is empty, so this is invisible
 * until Jeff has something to show.
 */
(function () {
  'use strict';

  const MAX_VIDEOS = 5;

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  /* ---- 1. The quick rail ------------------------------------------- */

  /* Labels are the app's exact product names. "My Collection" and "My
     Pokédex" are never shortened to "Collection"/"Pokédex" anywhere --
     see the note at the top of components/navbar.js. */
  function chips() {
    const dexOn = window.InfinitePullsApp ? window.InfinitePullsApp.dexOn() : true;
    const list = [
      { page: 'account',    label: 'My Profile',       icon: '👤' },
      { page: 'collection', label: 'Scanner',          icon: '📷', scan: true },
      { page: 'collection', label: 'My Collection',    icon: '▣' },
      { page: 'goals',      label: 'Badges',           icon: '🏅' },
      { page: 'dex',        label: 'Infinite Rewards', icon: '∞', dex: true },
      { page: 'pokedex',    label: 'My Pokédex',       icon: '⬡' }
    ];
    // The rewards chip comes out entirely when the admin switch is off --
    // same reasoning as the ∞ tab in the nav bar.
    return list.filter((c) => !c.dex || dexOn);
  }

  function quickRailHtml() {
    return `
      <nav class="rail quick-rail" aria-label="Jump to">
        ${chips().map((c) => `
          <a class="rail-chip" href="?page=${c.page}" data-route="${c.page}"${c.scan ? ' data-scan' : ''}>
            <span class="rail-chip-icon" aria-hidden="true">${c.icon}</span>
            <span class="rail-chip-label">${esc(c.label)}</span>
          </a>`).join('')}
      </nav>`;
  }

  /* ---- 2. The tutorial rail ---------------------------------------- */

  /* Accepts whatever Jeff pastes: a watch link, a share link, an embed
     link, or the bare id on its own. Anything it cannot read is dropped
     rather than rendered as a broken tile. */
  function videoId(raw) {
    const v = String(raw || '').trim();
    if (!v) return '';
    if (/^[\w-]{11}$/.test(v)) return v;
    const m = v.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
    return m ? m[1] : '';
  }

  function videos() {
    const data = (window.InfinitePullsApp && window.InfinitePullsApp.storeData)
      ? window.InfinitePullsApp.storeData()
      : {};
    const raw = Array.isArray(data.videos) ? data.videos : [];
    return raw
      .map((v) => ({ id: videoId(v && (v.url || v.id || v)), title: (v && v.title) || '' }))
      .filter((v) => v.id)
      .slice(0, MAX_VIDEOS);
  }

  function videoRailHtml() {
    const list = videos();
    if (!list.length) return '';   // invisible until Jeff has something to show
    return `
      <section class="video-rail-wrap">
        <h2 class="rail-title">How it works</h2>
        <div class="rail video-rail">
          ${list.map((v) => `
            <button type="button" class="video-card" data-video="${esc(v.id)}"
                    aria-label="Play${v.title ? ' ' + esc(v.title) : ' video'}">
              <span class="video-thumb">
                <img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy" decoding="async">
                <span class="video-play" aria-hidden="true">▶</span>
              </span>
              ${v.title ? `<span class="video-title">${esc(v.title)}</span>` : ''}
            </button>`).join('')}
        </div>
      </section>`;
  }

  /* A tap swaps the thumbnail for the real player, rather than loading
     five YouTube iframes on the home page of a shop's app. Each of those
     is a few hundred KB and a pile of third-party cookies for a video
     most visitors never play. */
  function play(btn) {
    const id = btn.dataset.video;
    if (!id) return;
    const holder = document.createElement('div');
    holder.className = 'video-card is-playing';
    holder.innerHTML =
      '<div class="video-thumb"><iframe src="https://www.youtube-nocookie.com/embed/' + esc(id) +
      '?autoplay=1&rel=0" title="Tutorial" frameborder="0" allow="accelerometer; autoplay; ' +
      'encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>';
    btn.replaceWith(holder);
  }

  /* ---- Wiring ------------------------------------------------------- */

  function init() {
    const rail = document.querySelector('.video-rail');
    if (!rail || rail.dataset.wired === '1') return;
    rail.dataset.wired = '1';
    rail.addEventListener('click', (e) => {
      const btn = e.target.closest('.video-card[data-video]');
      if (btn) play(btn);
    });
  }

  window.InfinitePullsHomeRails = { quickRailHtml, videoRailHtml, init, MAX_VIDEOS };
})();
