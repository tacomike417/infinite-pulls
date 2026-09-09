/* FIVE RAILS ON THE HOME PAGE — signed in, cards owned.
 *
 *   My Collection      the cards you own, newest work first
 *   Collector Goals    what you are chasing, and how far along
 *   Movers & Shakers   what the market did this week
 *   By price           pick a bracket, see twenty cards in it
 *   Infinite Rewards   the shop's set, earned and still locked
 *
 * Three of those are about YOU. Movers is the odd one out and earns its
 * place for that reason: it is the only strip on the page that changes
 * without you doing anything, so it is the one that makes the home page
 * worth opening on a day you have not bought a card.
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
  const MAX_MOVERS = 20;
  const MAX_TIER = 20;

  /* THE TIERS. Brackets and names both settled 7 Sep 2026; the counts are
     what the catalogue actually held that day, and they are here because
     they are the reason the brackets sit where they do rather than on
     rounder numbers.

       Notable      $50-99      934 cards
       High-value   $100-249    688
       Premium      $250-499    241
       Grails       $500+       128

     `max` is exclusive so the four tile with no gap and no overlap, and
     null is the open top. Short labels: this is a chip row on a phone, and
     "High-value" already loses to "High" at 360px. */
  const TIERS = [
    { key: 'notable',    label: 'Notable',    min: 50,  max: 100 },
    { key: 'high-value', label: 'High-value', min: 100, max: 250 },
    { key: 'premium',    label: 'Premium',    min: 250, max: 500 },
    { key: 'grails',     label: 'Grails',     min: 500, max: null }
  ];

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
  /* opts.firstId  -- hoist this card to the front of the rail
     opts.flashId  -- give this card the just-added animation
     Both are used by Card Lookup after "+ Add to my collection". A card
     that lands somewhere in the middle of a rail that scrolls sideways has
     not visibly landed anywhere: leftmost is the only position guaranteed
     to be on screen when the rail redraws. */
  function collectionRail(rows, opts) {
    const o = opts || {};
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

    let cards = [...byCard.values()].filter((c) => c.img);
    const first = o.firstId && byCard.get(o.firstId);
    if (first && first.img) {
      cards = [first].concat(cards.filter((c) => c.id !== o.firstId));
    }
    cards = cards.slice(0, MAX_CARDS);
    if (!cards.length) return '';

    /* data-trend-card marks the tile for paintCardDots(), which fills the
       corner in afterwards. Artwork has no price on it and no room for
       words, so movement here is a single coloured dot: green rising, red
       falling, grey steady, and nothing at all for a card we have never
       priced. Top corner, because the ×N quantity badge owns the bottom
       one. */
    const html = railHtml('My Collection', '?page=collection', 'collection', cards.map((c) => `
      <button type="button" class="mine-card${c.id === o.flashId ? ' is-just-added' : ''}"
              data-open-card="${esc(c.id)}" aria-label="${esc(c.name)}">
        <span class="mine-card-art" data-trend-card="${esc(c.id)}">
          <img src="${esc(c.img)}" alt="" loading="lazy" decoding="async">
          ${c.qty > 1 ? `<span class="mine-qty">×${c.qty}</span>` : ''}
        </span>
      </button>`).join(''));

    /* The rail is a string, not yet in the document, so the dots cannot be
       painted here. One frame later they can, and by then the artwork has
       started loading -- the dot arriving a beat after the picture is the
       right order anyway. */
    setTimeout(paintCardDots, 0);
    return html;
  }

  /* Every card on screen, one request. Runs against whatever is in the
     document, so it covers this rail, the copy of it on the Card Lookup
     page, and anything else that marks a tile up the same way. */
  let dotToken = 0;
  async function paintCardDots() {
    const tr = window.InfinitePullsTrend;
    if (!tr || !tr.trendsFor) return;
    const nodes = [...document.querySelectorAll('.mine-card-art[data-trend-card]')];
    if (!nodes.length) return;

    const token = ++dotToken;
    const batch = await tr.trendsFor(nodes.map((n) => n.dataset.trendCard));
    if (token !== dotToken) return;   // the rail was redrawn under us

    nodes.forEach((n) => {
      if (!n.isConnected || n.querySelector('.trend-dot')) return;
      const ch = tr.fromBatchAny(batch, n.dataset.trendCard);
      if (ch) n.insertAdjacentHTML('beforeend', tr.dotHtml(ch));
    });
  }

  /* ---- Movers & Shakers ---------------------------------------------
   *
   * The same board as ?page=movers, cut to twenty and turned on its side.
   * Both halves are fetched once and the arrows switch between what is
   * already in hand -- a sort control that goes to the network would put a
   * spinner behind a button somebody is going to press twice in a row just
   * to see what it does.
   *
   * NO WORDS ON THE CONTROL. Two arrows, pointing the way the prices went,
   * in the same green and red used for movement everywhere else in the
   * app. By the time somebody reaches this rail they have already met that
   * colour language on a price and on a card. A label would be explaining
   * something they have been taught. */

  let moversCache = null;          // { up: [...], down: [...] }
  let moversDir = 'up';            // up is the default view, as asked

  /* ARTWORK, WHERE WE HAVE IT.
   *
   * image_base is the extensionless TCGdex URL now stored on cards, filled
   * free by the weekly price run out of an object it was already fetching.
   * '/low.webp' is the rail size; a card's own page asks for high.
   *
   * A card without art gets a framed placeholder rather than a gap. The
   * frame is the same size either way, so a rail does not reflow as
   * pictures arrive and nothing jumps under a thumb. */
  function cardArtHtml(r) {
    if (r.image_base) {
      return `<span class="mv-art">
                <img src="${esc(r.image_base)}/low.webp" alt="" loading="lazy" decoding="async">
              </span>`;
    }
    return `<span class="mv-art is-empty" aria-hidden="true"></span>`;
  }

  function moversTile(r) {
    const dir = Number(r.pct) >= 0 ? 'up' : 'down';
    const pct = Math.abs(Number(r.pct));
    const shown = pct >= 100 ? Math.round(pct) : Math.round(pct * 10) / 10;
    const where = [r.set_name, r.number].filter(Boolean).join(' · ');
    const money = (n) => '$' + Number(n).toFixed(2);

    /* Straight to that card in Card Lookup, carrying its number. A tile
       that only said a card had moved, without a way to go and look at
       it, would be a fact with nowhere to put it. */
    return `
      <a class="mv-tile is-${dir}" href="?page=lookup&q=${encodeURIComponent(r.number || r.name)}"
         data-route="lookup">
        ${cardArtHtml(r)}
        <span class="mv-tile-move">
          <span aria-hidden="true">${dir === 'up' ? '▲' : '▼'}</span>${shown}%
        </span>
        <strong class="mv-tile-name">${esc(r.name)}</strong>
        <small class="mv-tile-where">${esc(where)}</small>
        <small class="mv-tile-price">${money(r.then_price)} → ${money(r.now_price)}</small>
      </a>`;
  }

  function moversScrollerHtml() {
    const rows = (moversCache && moversCache[moversDir]) || [];
    if (!rows.length) {
      return `<p class="mv-rail-none">Nothing ${moversDir === 'up' ? 'rose' : 'fell'} by more than 3% this week.</p>`;
    }
    return rows.slice(0, MAX_MOVERS).map(moversTile).join('');
  }

  function moversRailHtml() {
    const on = (d) => (moversDir === d ? ' is-on' : '');
    return `
      <section class="mine-rail mv-rail">
        <div class="rail-head">
          <h2 class="rail-title">Movers &amp; Shakers</h2>
          <a class="rail-more" href="?page=movers" data-route="movers">See all</a>
        </div>
        <div class="mv-rail-body">
          <div class="mv-sort" role="group" aria-label="Show cards going up or down">
            <button type="button" class="mv-sort-btn is-up${on('up')}" data-mv-dir="up"
                    aria-label="Cards going up in price" aria-pressed="${moversDir === 'up'}">▲</button>
            <button type="button" class="mv-sort-btn is-down${on('down')}" data-mv-dir="down"
                    aria-label="Cards going down in price" aria-pressed="${moversDir === 'down'}">▼</button>
          </div>
          <div class="rail mine-scroller mv-scroller">${moversScrollerHtml()}</div>
        </div>
      </section>`;
  }

  async function loadMovers() {
    const client = sb();
    if (!client) return;
    const [a, b] = await Promise.all([
      client.rpc('top_movers', { p_direction: 'up',   p_limit: MAX_MOVERS, p_days: 7 }),
      client.rpc('top_movers', { p_direction: 'down', p_limit: MAX_MOVERS, p_days: 7 })
    ]);
    if (a.error || b.error) return;
    const up = a.data || [];
    const down = b.data || [];
    /* Nothing to say is said by not appearing. Before there is a week of
       history this rail is simply absent, rather than a strip of empty
       space explaining itself on somebody's own home page -- the public
       board is where that explanation belongs. */
    if (!up.length && !down.length) return;
    moversCache = { up, down };
    slot('mine-movers').innerHTML = moversRailHtml();
  }

  /* ---- By price -------------------------------------------------------
   *
   * "Pick your price point and see twenty cards in it." Four chips, one
   * rail, and the movement each card made shown on its tile.
   *
   * WHY IT IS NOT JUST MOVERS WITH A FILTER
   *
   * Movers ranks by percentage, which structurally favours cheap cards --
   * a $6 card going to $8 is +33%, while a $700 card gaining a real $35 is
   * +5% and never places. So the movers rail lives almost entirely in the
   * $5-$50 band and a collector could scroll it for a month without
   * learning anything about the top of the market. This rail is how the
   * expensive end becomes visible at all.
   *
   * THE PADDING, AND WHERE IT STOPS
   *
   * Fewer than twenty movers in a bracket and steady cards fill the rest --
   * that ordering happens inside tier_cards() and needs no help here. What
   * cannot fill it is a card with no week-old reading: calling that steady
   * would be the same false claim the arrows refuse to make. A thin
   * bracket returns a short rail, and a short true rail beats a full
   * invented one.
   *
   * ONE FETCH PER TIER, KEPT. Pressing a chip that was pressed before is
   * instant; the network is only asked about a bracket nobody has opened
   * yet. */

  let tierCache = {};              // key -> rows
  let tierKey = TIERS[0].key;      // Notable first: the widest bracket
  let tierBusy = false;

  function tierTile(r) {
    const pct = Number(r.pct);
    const dir = Math.abs(pct) < 3 ? 'flat' : (pct > 0 ? 'up' : 'down');
    const shown = Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.round(Math.abs(pct) * 10) / 10;
    const glyph = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '●';
    const money = (n) => '$' + Number(n).toFixed(2);

    /* The PRICE is the headline here, not the percentage. The whole point
       of the rail is what a card is worth; the move is the second line.
       That is the opposite weighting to the movers tile above it, and it
       is what stops the two rails reading as the same strip twice. */
    return `
      <a class="mv-tile tier-tile is-${dir}" href="?page=lookup&q=${encodeURIComponent(r.number || r.name)}"
         data-route="lookup">
        ${cardArtHtml(r)}
        <span class="tier-price">${money(r.now_price)}</span>
        <span class="tier-move is-${dir}">
          <span aria-hidden="true">${glyph}</span>${dir === 'flat' ? 'Steady' : shown + '%'}
        </span>
        <strong class="mv-tile-name">${esc(r.name)}</strong>
        <small class="mv-tile-where">${esc([r.set_name, r.number].filter(Boolean).join(' · '))}</small>
      </a>`;
  }

  function tierScrollerHtml() {
    const rows = tierCache[tierKey];
    if (!rows) return `<p class="mv-rail-none">Loading…</p>`;
    if (!rows.length) {
      const t = TIERS.find((x) => x.key === tierKey);
      return `<p class="mv-rail-none">No ${esc((t && t.label) || '')} cards have a week of price history yet.</p>`;
    }
    return rows.slice(0, MAX_TIER).map(tierTile).join('');
  }

  /* THE RANGE BELONGS IN THE HEAD, NOT ON THE CHIP.
   *
   * Standing the chips up in a column left of the rail is what the layout
   * wanted, and it left each chip about seventy pixels wide. "High-value"
   * plus "$100–249" does not go in seventy pixels without shrinking to a
   * size nobody reads.
   *
   * So the chip carries the NAME and the head carries the RANGE of
   * whichever bracket is open. Four names in a column is a menu you
   * understand at a glance; one range in the head answers "what counts as
   * Premium" exactly when somebody is looking at Premium, and takes no
   * room from the cards. */
  function tierRangeLabel(key) {
    const t = TIERS.find((x) => x.key === key);
    if (!t) return '';
    return t.max ? '$' + t.min + '–' + (t.max - 1) : '$' + t.min + '+';
  }

  function tierRailHtml() {
    return `
      <section class="mine-rail tier-rail">
        <div class="rail-head">
          <h2 class="rail-title">By price
            <span class="tier-range" id="tier-range">${esc(tierRangeLabel(tierKey))}</span>
          </h2>
        </div>
        <div class="mv-rail-body">
          <div class="tier-chips" role="group" aria-label="Pick a price bracket">
            ${TIERS.map((t) => `
              <button type="button" class="tier-chip${t.key === tierKey ? ' is-on' : ''}"
                      data-tier="${esc(t.key)}" aria-pressed="${t.key === tierKey}">
                ${esc(t.label)}
              </button>`).join('')}
          </div>
          <div class="rail mine-scroller tier-scroller">${tierScrollerHtml()}</div>
        </div>
      </section>`;
  }

  async function fetchTier(key) {
    if (tierCache[key]) return tierCache[key];
    const client = sb();
    const t = TIERS.find((x) => x.key === key);
    if (!client || !t) return null;
    const { data, error } = await client.rpc('tier_cards', {
      p_min: t.min, p_max: t.max, p_limit: MAX_TIER, p_days: 7
    });
    if (error) return null;
    tierCache[key] = data || [];
    return tierCache[key];
  }

  /* OPEN ON A BRACKET THAT HAS SOMETHING IN IT.
   *
   * Notable is the natural default -- it is the widest bracket and the one
   * most collectors live in. But defaulting to it blindly meant that if
   * Notable happened to be empty the entire rail hid itself, even with a
   * full set of Grails sitting one tap away. Somebody would never learn
   * the rail existed.
   *
   * So the tiers are tried in order and the first with cards wins. On a
   * normal week that is Notable and this loop stops immediately; on a thin
   * one it lands wherever the data actually is. The empty brackets are
   * cached on the way past, so pressing them afterwards is instant rather
   * than a round trip to be told nothing again. */
  async function loadTiers() {
    for (const t of TIERS) {
      const rows = await fetchTier(t.key);
      if (rows && rows.length) {
        tierKey = t.key;
        slot('mine-tiers').innerHTML = tierRailHtml();
        return;
      }
    }
    /* Nothing in any bracket means no week of history yet, and the rail
       simply does not appear -- the public board is where that gets
       explained, not somebody's own home page. */
  }

  /* ---- 2. Badges ----------------------------------------------------- */

  /* THE ARTWORK, NOT AN EMOJI. This drew a 🎯 while the Collector Goals
     page drew the badge itself, so the same badge was two different
     things depending which screen you were on. Unearned ones are greyed
     back here exactly as they are there. */
  function badgeTile(p) {
    const eff = p.eff || {};
    const prog = p.progress || {};
    const pct = Math.max(0, Math.min(100, Number(prog.pct) || 0));
    const done = !!prog.complete;
    const art = eff.badgeImage
      ? `<img class="mine-badge-art" src="${esc(eff.badgeImage)}" alt="" loading="lazy" decoding="async">`
      : `<span class="mine-badge-icon" aria-hidden="true">${esc(eff.icon || '🎯')}</span>`;
    return `
      <a class="mine-badge${done ? ' is-complete' : ''}" href="?page=goals" data-route="goals">
        ${art}
        <strong class="mine-badge-name">${esc(eff.name || 'Badge')}</strong>
        <span class="mine-badge-label">${done ? 'Earned' : esc(prog.primaryLabel || '')}</span>
        ${!done && prog.displayMode === 'fraction'
          ? `<span class="mine-bar"><span class="mine-bar-fill" style="width:${pct}%"></span></span>`
          : ''}
        ${done ? '<span class="mine-badge-trophy">🏆</span>' : ''}
      </a>`;
  }

  /* Nobody has picked a goal yet. This is the one empty state worth
     drawing rather than hiding: goals are chosen, not earned, so a person
     who has never seen the page does not know there is anything to pick. */
  function badgesEmptyHtml() {
    return railHtml('Collector Goals', '?page=goals', 'goals', `
      <a class="mine-badge is-invite" href="?page=goals" data-route="goals">
        <span class="mine-badge-icon" aria-hidden="true">🎯</span>
        <strong class="mine-badge-name">Add your first goal</strong>
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
    return railHtml('Collector Goals', '?page=goals', 'goals', sorted.map(badgeTile).join(''));
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

    /* THE ORDER IS CLAIMED BEFORE ANYTHING LOADS.
       slot() appends when a slot is missing, so until now the rails
       landed in whatever order their fetches happened to finish -- badges
       above rewards on a fast day, below it on a slow one. Creating all
       four up front makes the running order a decision rather than a race,
       which is what the comment on slot() always claimed it was. */
    ['mine-cards', 'mine-badges', 'mine-movers', 'mine-tiers', 'mine-dex'].forEach(slot);

    // 1. Cards — already in hand, so it draws immediately.
    const cardsHtml = collectionRail(rows);
    if (cardsHtml) slot('mine-cards').innerHTML = cardsHtml;

    // The rest fetch. Independently, so none can hold up another.
    loadBadges(user).catch(() => {});
    loadMovers().catch(() => {});
    loadTiers().catch(() => {});
    loadDex().catch(() => {});
  }

  /* THE BADGES THAT EARN THEMSELVES COUNT TOO.
     This asked only for the goals somebody had PICKED, so the badges the
     app awards on its own -- which are most of them, and the ones people
     actually have -- never reached the home page. Somebody with one
     earned badge saw two half-finished goals here and nothing they had
     won, while the Collector Goals page correctly showed the earned one
     first. Same two calls the goals page makes, so the two screens
     cannot disagree again. */
  async function loadBadges(user) {
    if (!cg()) return;
    const userGoals = await cg().loadUserGoals(user.id);
    const ctx = await cg().buildContext(user.id);

    const picked = await cg().computeAllProgress(user.id, userGoals || [], ctx);
    let auto = [];
    try {
      const selectedTemplateIds = new Set((userGoals || []).filter(g => g.template_id).map(g => g.template_id));
      auto = await cg().computeAutoProgress(user.id, ctx, selectedTemplateIds);
    } catch (_) { /* the picked ones are still worth showing */ }

    const progressList = picked.concat(auto);
    if (!progressList.length) {
      slot('mine-badges').innerHTML = badgesEmptyHtml();
      return;
    }
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

  /* Switching view redraws the tiles only -- the head, the arrows and the
     rail's own scroll box all stay put, so the control does not jump out
     from under the thumb that just pressed it. The scroller goes back to
     the left because position 1 of a new list is the only position worth
     starting at. */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-mv-dir]');
    if (!btn || !moversCache) return;
    e.preventDefault();
    const dir = btn.dataset.mvDir === 'down' ? 'down' : 'up';
    if (dir === moversDir) return;
    moversDir = dir;

    const rail = btn.closest('.mv-rail');
    if (!rail) return;
    rail.querySelectorAll('[data-mv-dir]').forEach((b) => {
      const on = b.dataset.mvDir === moversDir;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const scroller = rail.querySelector('.mv-scroller');
    if (scroller) {
      scroller.innerHTML = moversScrollerHtml();
      scroller.scrollLeft = 0;
    }
  });

  /* Pressing a bracket. The chips and the head stay put; only the tiles
     are replaced, and the scroller goes back to the left because position
     one of a new list is the only position worth starting at.

     A bracket never opened before has to be fetched, so the chip commits
     visually FIRST and the tiles say "Loading…" underneath. Doing it the
     other way round -- waiting for the answer before lighting the chip --
     leaves somebody pressing a button that appears not to work. */
  document.addEventListener('click', (e) => {
    const chip = e.target.closest && e.target.closest('[data-tier]');
    if (!chip) return;
    e.preventDefault();
    const key = chip.dataset.tier;
    if (key === tierKey || tierBusy) return;

    const rail = chip.closest('.tier-rail');
    if (!rail) return;
    tierKey = key;

    rail.querySelectorAll('[data-tier]').forEach((b) => {
      const on = b.dataset.tier === tierKey;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    // The head says which bracket you are in, so it moves with the chips.
    const range = rail.querySelector('#tier-range');
    if (range) range.textContent = tierRangeLabel(tierKey);

    const repaint = () => {
      const scroller = rail.querySelector('.tier-scroller');
      if (!scroller) return;
      scroller.innerHTML = tierScrollerHtml();
      scroller.scrollLeft = 0;
    };

    repaint();                       // cached -> instant; uncached -> "Loading…"
    if (tierCache[key]) return;

    tierBusy = true;
    fetchTier(key)
      .catch(() => { tierCache[key] = []; })
      .then(() => { tierBusy = false; if (tierKey === key) repaint(); });
  });

  window.InfinitePullsHomeMine = { mount, collectionRail, paintCardDots };
})();
