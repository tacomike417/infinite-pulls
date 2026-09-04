/* THREE RAILS OF YOUR OWN STUFF — home page, signed in, cards owned.
 *
 *   My Collection      the cards you own, newest work first
 *   Badges             what you are chasing, and how far along
 *   Infinite Rewards   the shop's set, earned and still locked
 *
 * They sit under the tutorial videos, and they are the reason the home
 * page is worth opening twice. The scoreboard above says how much you
 * have; these say what it IS.
 *
 * WHEN THEY APPEAR
 *
 * Signed in, and owning at least one card. Somebody with an empty account
 * gets the sell page instead -- three empty rails would be a worse first
 * impression than none, and every one of them would be asking for work
 * before they have done anything.
 *
 * EACH RAIL LOADS ON ITS OWN
 *
 * Badges is the slow one: working out progress can mean fetching set
 * details per badge. If all three shared a load, one slow badge would
 * hold up a card rail that was ready immediately. So each fills itself in
 * when its own data lands, and a rail that fails simply never appears --
 * a home page missing a strip is survivable, a home page stuck on
 * "Loading…" is not.
 *
 * NOTHING HERE FETCHES ANYTHING TWICE
 *
 * The owned rows and the species list are the same promise-cached pair the
 * scoreboard and My Pokédex use, and the Infinite Rewards catalogue is the
 * one components/infinite-dex-data.js already caches. Opening the home
 * page warms all of it for the pages underneath.
 *
 * THE SAME CUT-OFF RULE AS EVERY OTHER RAIL
 *
 * The last visible item is always sliced by the right edge -- see the note
 * in components/home-rails.js for why that is a layout requirement here
 * and not a decoration.
 */
(function () {
  'use strict';

  const MAX_CARDS = 20;
  const MAX_DEX = 14;

  const sbWrap = () => window.InfinitePullsSupabase || {};
  const sb = () => (sbWrap().ready ? sbWrap().client : null);
  const pd = () => window.InfinitePullsPokemonData;
  const cg = () => window.InfinitePullsCollectorGoals;
  const dex = () => window.InfinitePullsDexData;
  const el = () => document.getElementById('home-mine');

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  /* Each rail is dropped in as a whole section when it is ready, in a
     fixed slot, so they cannot end up in a different order depending on
     which finished first. */
  function slot(id) {
    const root = el();
    if (!root) return null;
    let s = document.getElementById(id);
    if (!s) {
      s = document.createElement('div');
      s.id = id;
      root.appendChild(s);
    }
    return s;
  }

  function railHtml(title, href, route, body) {
    return `
      <section class="mine-rail">
        <div class="rail-head">
          <h2 class="rail-title">${esc(title)}</h2>
          <a class="rail-more" href="${esc(href)}" data-route="${esc(route)}">See all</a>
        </div>
        <div class="rail mine-scroller">${body}</div>
      </section>`;
  }

  /* ---- 1. My Collection --------------------------------------------- */

  /* One tile per CARD, not per row: three copies of the same Charizard is
     one tile with a ×3 on it, the way somebody thinks about their own
     collection. */
  function collectionRail(rows) {
    const byCard = new Map();
    (rows || []).forEach((r) => {
      if (!r.card_id) return;
      const found = byCard.get(r.card_id);
      if (found) { found.qty += Number(r.quantity) || 1; return; }
      byCard.set(r.card_id, {
        id: r.card_id,
        name: r.card_name || '',
        img: r.image_url || '',
        qty: Number(r.quantity) || 1
      });
    });

    const cards = [...byCard.values()].filter((c) => c.img).slice(0, MAX_CARDS);
    if (!cards.length) return '';

    return railHtml('My Collection', '?page=collection', 'collection', cards.map((c) => `
      <button type="button" class="mine-card" data-open-card="${esc(c.id)}" aria-label="${esc(c.name)}">
        <span class="mine-card-art">
          <img src="${esc(c.img)}" alt="" loading="lazy" decoding="async">
          ${c.qty > 1 ? `<span class="mine-qty">×${c.qty}</span>` : ''}
        </span>
      </button>`).join(''));
  }

  /* ---- 2. Badges ----------------------------------------------------- */

  function badgeTile(p) {
    const eff = p.eff || {};
    const prog = p.progress || {};
    const pct = Math.max(0, Math.min(100, Number(prog.pct) || 0));
    return `
      <a class="mine-badge${prog.complete ? ' is-complete' : ''}" href="?page=goals" data-route="goals">
        <span class="mine-badge-icon" aria-hidden="true">${esc(eff.icon || '🎯')}</span>
        <strong class="mine-badge-name">${esc(eff.name || 'Badge')}</strong>
        <span class="mine-badge-label">${esc(prog.primaryLabel || '')}${prog.complete ? ' 🏆' : ''}</span>
        ${prog.displayMode === 'fraction'
          ? `<span class="mine-bar"><span class="mine-bar-fill" style="width:${pct}%"></span></span>`
          : ''}
      </a>`;
  }

  /* Nobody has picked a badge yet. This is the one empty state worth
     drawing rather than hiding: badges are chosen, not earned, so a person
     who has never seen the page does not know there is anything to pick. */
  function badgesEmptyHtml() {
    return railHtml('Badges', '?page=goals', 'goals', `
      <a class="mine-badge is-invite" href="?page=goals" data-route="goals">
        <span class="mine-badge-icon" aria-hidden="true">🎯</span>
        <strong class="mine-badge-name">Pick your first badge</strong>
        <span class="mine-badge-label">Original 151, finish a set, chase a favourite — it tracks itself from your collection.</span>
      </a>`);
  }

  function badgesRail(progressList) {
    if (!progressList || !progressList.length) return badgesEmptyHtml();
    // Furthest along first: a rail that opens on something nearly finished
    // is an invitation; one that opens on 0% is a chore list.
    const sorted = [...progressList].sort((a, b) => {
      const ac = a.progress && a.progress.complete ? 1 : 0;
      const bc = b.progress && b.progress.complete ? 1 : 0;
      if (ac !== bc) return bc - ac;
      return ((b.progress && b.progress.pct) || 0) - ((a.progress && a.progress.pct) || 0);
    });
    return railHtml('Badges', '?page=goals', 'goals', sorted.map(badgeTile).join(''));
  }

  /* ---- 3. Infinite Rewards ------------------------------------------- */

  function dexRail(cards, earned) {
    const list = (cards || []).slice(0, MAX_DEX);
    if (!list.length) return '';
    return railHtml('Infinite Rewards', '?page=dex', 'dex', list.map((c) => {
      const has = earned.has(c.id);
      const art = c.thumb_url || c.art_url;
      return `
        <a class="mine-dex${has ? ' is-earned' : ''}" href="?page=dex" data-route="dex"
           aria-label="${has ? esc(c.name) : 'Not collected yet'}">
          <span class="mine-dex-art">
            ${art ? `<img src="${esc(art)}" alt="" loading="lazy" decoding="async">` : '<span class="mine-dex-noart">?</span>'}
            ${has ? '' : '<span class="mine-dex-lock">🔒</span>'}
          </span>
          <span class="mine-dex-name">${has ? esc(c.name) : '???'}</span>
        </a>`;
    }).join(''));
  }

  /* ---- Loading ------------------------------------------------------- */

  let mountedFor = null;

  async function mount() {
    const root = el();
    if (!root) return;

    const client = sb();
    if (!client) return;

    let user = null;
    try {
      const { data } = await client.auth.getSession();
      user = data && data.session && data.session.user;
    } catch (_) { /* signed out */ }
    if (!user) { root.innerHTML = ''; mountedFor = null; return; }

    // Re-rendering the same three rails on every home visit would restart
    // every image download for no gain.
    if (mountedFor === user.id && root.children.length) return;
    mountedFor = user.id;
    root.innerHTML = '';

    const data = pd();
    if (!data) return;

    let rows = [];
    try {
      rows = await data.fetchOwnedCollectionRows(user.id);
    } catch (_) {
      return;   // no collection, nothing below it means anything
    }
    if (!rows || !rows.length) return;   // the sell page stands on its own

    // 1. Cards — already in hand, so it draws immediately.
    const cardsHtml = collectionRail(rows);
    if (cardsHtml) slot('mine-cards').innerHTML = cardsHtml;

    // 2 and 3 fetch. Independently, so neither can hold up the other.
    loadBadges(user).catch(() => {});
    loadDex().catch(() => {});
  }

  async function loadBadges(user) {
    if (!cg()) return;
    const userGoals = await cg().loadUserGoals(user.id);
    if (!userGoals || !userGoals.length) {
      slot('mine-badges').innerHTML = badgesEmptyHtml();
      return;
    }
    const ctx = await cg().buildContext(user.id);
    const progressList = await cg().computeAllProgress(user.id, userGoals, ctx);
    slot('mine-badges').innerHTML = badgesRail(progressList);
  }

  async function loadDex() {
    const d = dex();
    if (!d) return;
    const sw = window.InfinitePullsDexSwitch;
    if (sw && !sw.dexOn()) return;   // switched off in the admin panel
    const [cards, earned] = await Promise.all([d.loadCatalogue(), d.loadEarned()]);
    const html = dexRail(cards, earned);
    if (html) slot('mine-dex').innerHTML = html;
  }

  /* A tap on a card opens that card in My Collection. Everything else in
     here is a real link and the app's own router handles it. */
  document.addEventListener('click', (e) => {
    const card = e.target.closest && e.target.closest('[data-open-card]');
    if (!card) return;
    const col = window.InfinitePullsCollection;
    if (col && col.openCard) {
      e.preventDefault();
      col.openCard(card.dataset.openCard);
    }
  });

  window.InfinitePullsHomeMine = { mount };
})();
