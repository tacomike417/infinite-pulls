/* THE SHOP — the shelf, one product page per thing, and a basket.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * One flat alphabetical list of every item in the till, text only, with a
 * Buy button that went straight to a payment page. On a shelf that is 102
 * Funko Pops, 17 card supplies and 4 singles, a Pokemon collector landed
 * on a wall of Funkos and had to hunt. The app is collector-first; the
 * shop page was not.
 *
 * SO IT IS GROUPED BY JEFF'S OWN CLOVER CATEGORIES. Not a set of headings
 * invented here -- his, read live, named however he named them. There is
 * no second list to keep in step with his till, and when he adds a
 * category it simply appears.
 *
 * Cards open, everything else shut with a count beside it. His decision,
 * and the right one: it makes the page agree with what the app is for
 * without hiding two thirds of what he sells.
 *
 * A BASKET, NOT A BUY BUTTON. Every single is quantity one, so the danger
 * is never "too many in the cart", it is two people reaching for the same
 * card. Nothing is held while it sits in a basket -- a card is only taken
 * off the shelf at the moment somebody starts paying, by claim_shop_item()
 * in the database. A basket that has gone stale finds out at checkout,
 * before any money moves, which is the only good moment to find out.
 */
(function () {
  'use strict';

  const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  const CART_KEY = 'ip-cart';
  const SORT_KEY = 'ip-shop-sort';
  const OPEN_KEY = 'ip-shop-open';
  const SHIPPING_FLAT = 8;

  /* Cards first. Everything else keeps its own name and falls in behind,
     alphabetically. A category Jeff invents tomorrow needs no code. */
  const CARD_FIRST = [
    'Single Cards', 'Graded Cards', 'Pokemon Sealed',
    'Magic Sealed Product', 'Other Sealed Product', 'Lorcana'
  ];
  const OPEN_BY_DEFAULT = ['Single Cards', 'Graded Cards', 'Pokemon Sealed'];
  const NO_CATEGORY = 'Everything else';

  /* TWENTY-FIVE AT A TIME.
     "Everything else" is a hundred and ten things. Every one of them
     loads a picture, so a category opening in full is a hundred and ten
     images onto a phone at once -- slow, and a scroll nobody reaches the
     bottom of. Each section counts its own page, because the pages are
     per category: opening Funkos does not knock Single Cards back to
     page one. */
  const PER_PAGE = 25;
  const pageOf = {};   // category name -> which page it is showing

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  const money = (n) => (typeof n === 'number' && isFinite(n))
    ? '$' + n.toFixed(2) : null;

  let shelf = [];      // everything buyable, as the database sees it

  /* ---- the basket ----------------------------------------------------
   * Lives in this browser. Nothing is reserved by being in it -- see the
   * note at the top. It carries the price it was added at only so the
   * basket can show a total; the price that gets charged is read live
   * from the till at checkout, and always Jeff's, never this copy. */

  function cart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch (_) { return []; }
  }
  function saveCart(list) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(list)); } catch (_) { /* still works for this page */ }
    drawCartBar();
  }
  const inCart = (id) => cart().some((c) => c.id === id);

  function addToCart(item) {
    if (inCart(item.clover_item_id)) return false;
    saveCart([...cart(), {
      id: item.clover_item_id,
      name: item.name,
      price: item.price,
      photo: item.art_url || item.photo_url || null
    }]);
    return true;
  }
  function removeFromCart(id) { saveCart(cart().filter((c) => c.id !== id)); }
  const clearCart = () => saveCart([]);

  /* ---- pictures ------------------------------------------------------
   * CATALOGUE ART FIRST, the shop's own photo second, a named tile last.
   *
   * This way round on purpose. These tiles are going to appear all over
   * the site -- rails on the home page, wish lists, price movers -- and
   * the catalogue picture is the one that looks the same everywhere. Two
   * hundred cards shot on a shop counter under different light, at
   * slightly different angles, is a listing page that looks like a car
   * boot sale however good each individual photo is.
   *
   * The real photo is not hidden, it is one tap away on the card's own
   * page, and that is the right place for it: the shelf is for browsing,
   * the product page is where somebody decides whether to buy THIS copy
   * and wants to see the actual corners.
   *
   * Never a broken image icon and never an empty grey square -- half
   * this shelf is drinks and Legos with no artwork anywhere until Jeff
   * photographs them, and those fall through to the tile. */

  function picture(item, big) {
    const src = item.art_url || item.photo_url;
    if (src) {
      return `<img class="shop-pic${big ? ' big' : ''}" src="${esc(src)}" alt="${esc(item.name)}" loading="lazy">`;
    }
    const initials = String(item.name || '?').replace(/[^A-Za-z0-9 ]/g, ' ')
      .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    return `<div class="shop-pic${big ? ' big' : ''} is-blank" aria-hidden="true"><span>${esc(initials || '?')}</span></div>`;
  }

  /* ---- sorting -------------------------------------------------------- */

  const SORTS = {
    'az':     { label: 'A to Z',            fn: (a, b) => a.name.localeCompare(b.name) },
    'za':     { label: 'Z to A',            fn: (a, b) => b.name.localeCompare(a.name) },
    'newest': { label: 'Newest first',      fn: (a, b) => String(b.added_at || '').localeCompare(String(a.added_at || '')) },
    'oldest': { label: 'Oldest first',      fn: (a, b) => String(a.added_at || '').localeCompare(String(b.added_at || '')) },
    'high':   { label: 'Most expensive',    fn: (a, b) => (b.price || 0) - (a.price || 0) },
    'low':    { label: 'Least expensive',   fn: (a, b) => (a.price || 0) - (b.price || 0) }
  };
  function currentSort() {
    let s = null;
    try { s = localStorage.getItem(SORT_KEY); } catch (_) { /* default below */ }
    return SORTS[s] ? s : 'az';
  }

  /* ---- which sections are open --------------------------------------- */

  function openSet() {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) || 'null');
      if (Array.isArray(saved)) return new Set(saved);
    } catch (_) { /* fall through to the default */ }
    return new Set(OPEN_BY_DEFAULT);
  }
  function rememberOpen(set) {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...set])); } catch (_) { /* fine */ }
  }

  /* ---- the shelf ------------------------------------------------------ */

  async function init() {
    const host = document.getElementById('shop-inventory-list');
    if (!host || !sb()) return;

    const { data, error } = await sb()
      .from('shop_available')
      .select('clover_item_id, name, price, available, category_name, photo_url, art_url, card_id, set_name, card_number, added_at, hidden_online');

    if (error || !data || !data.length) {
      host.innerHTML = '<div class="empty-state">Nothing listed here yet — check back soon.</div>';
      return;
    }

    /* WHAT JEFF HAS TAKEN OFF THE WEBSITE.
       He still sells the drinks and the Funkos across the counter; he
       just does not want them on a page that is meant to be about cards.
       Hidden, never deleted -- the stock is untouched and putting a
       category back is one tap in the admin. */
    shelf = data.filter((i) =>
      typeof i.price === 'number' && (i.available || 0) > 0 && !i.hidden_online);
    if (!shelf.length) {
      host.innerHTML = '<div class="empty-state">Everything is spoken for right now — check back soon.</div>';
      return;
    }

    draw(host);
    drawCartBar();
    drawShowcase(host);
    freshenInBackground();
  }

  /* ---- THE SHOWCASE ---------------------------------------------------
   *
   * The shelf below is sorted by name, price or date -- fair, and
   * completely indifferent. None of those put the Base Set Charizard in
   * front of anybody; it lands wherever the alphabet drops it, between
   * Blastoise and a booster pack. This row is Jeff's: up to twenty-five
   * cards he picked, in the order he picked them.
   *
   * A SIDEWAYS SCROLL, NOT A CAROUSEL. No timer, no arrows moving things
   * on their own, nothing that slides away while somebody is looking at
   * it. A thumb pushes it; that is the whole interaction, and it is the
   * one everybody already knows from every phone they have ever held.
   *
   * DRAWN AFTER THE SHELF, ON PURPOSE. It is a second request, and the
   * shop is useful without it -- so the shelf paints first and this drops
   * in above when it arrives, rather than the whole page waiting on a
   * decorative row.
   *
   * IF IT IS EMPTY, NOTHING APPEARS. A shop window with no cards in it is
   * worse than no shop window: an empty heading reads as broken. */
  async function drawShowcase(host) {
    const client = sb();
    if (!client || !host || !host.parentNode) return;

    let rows = [];
    try {
      const { data, error } = await client.rpc('shop_showcase_list');
      if (error) throw error;
      rows = Array.isArray(data) ? data : [];
    } catch (_) { return; }   // the shop works perfectly well without it

    document.getElementById('shop-showcase')?.remove();
    if (!rows.length) return;

    const wrap = document.createElement('section');
    wrap.id = 'shop-showcase';
    wrap.className = 'showcase';
    wrap.innerHTML = `
      <div class="showcase-head">
        <strong>Infinite Pulls Showcase</strong>
        <small>Hand-picked by Jeff. Swipe →</small>
      </div>
      <div class="showcase-rail">
        ${rows.map(showcaseTile).join('')}
      </div>`;

    /* Above the sort control and the categories: it is the first thing
       the shop should say. */
    host.parentNode.insertBefore(wrap, host);
  }

  /* THE WHOLE TILE IS THE LINK. Tapping anywhere on it opens the card's
     own page, where the picture is big, the flip to the real photo lives,
     and Add to cart sits under the price. No Add button out here -- a
     shop window is for looking at, and a buy button on a 150px tile is a
     mis-tap waiting to happen. */
  function showcaseTile(item) {
    const meta = [item.set_name, item.card_number].filter(Boolean).join(' · ');
    return `<a class="showcase-card" href="?page=item&id=${encodeURIComponent(item.clover_item_id)}"
               data-item-link="${esc(item.clover_item_id)}">
      ${picture(item)}
      <strong>${esc(item.name)}</strong>
      ${meta ? `<small>${esc(meta)}</small>` : ''}
      <span class="showcase-price">${esc(money(item.price))}</span>
    </a>`;
  }

  /* ---- KEEPING UP WITH THE TILL, WITHOUT A CRON ----------------------
   *
   * Clover is the truth: a card sold at the counter is gone, a price
   * Jeff changed on the register is the new price. The website only
   * learns that when the sync runs, and until now that meant somebody
   * remembering to press a button. Nobody remembers a button.
   *
   * So the shelf checks its own age. If the last sync is old, this asks
   * for a refresh and forgets about it. It does NOT wait for it and it
   * does NOT redraw: the shopper looking at this page gets the page they
   * came for, at the speed they came for it, and the next person to open
   * it gets the fresh data. Making somebody wait on Clover to see a
   * shelf that is twenty minutes out of date would be a worse page, not
   * a better one.
   *
   * WHY THIS CANNOT STAMPEDE. Twenty phones on the shop page all read
   * the same "stale" in the same second. claim_shop_sync() is a single
   * UPDATE ... WHERE in the database, so exactly one of them gets true
   * and the other nineteen are told no -- see supabase/shop_autosync.
   * The worst this page can do to Clover is one sync per window. */
  async function freshenInBackground() {
    const client = sb();
    if (!client) return;
    try {
      const { data } = await client.rpc('shop_sync_due', { p_max_age_minutes: 15 });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.due) return;

      /* Fire and forget, deliberately. Errors are swallowed: a shopper
         must never see a word about Clover, a sync, or anything else
         going on behind the shop. */
      client.functions.invoke('sync-clover-inventory', { body: { auto: true } }).catch(() => {});
    } catch (_) { /* the shelf on screen is still a shelf */ }
  }

  function draw(host) {
    const sortKey = currentSort();
    const sorter = SORTS[sortKey].fn;
    const open = openSet();

    const groups = new Map();
    shelf.forEach((item) => {
      const key = item.category_name || NO_CATEGORY;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    const names = [...groups.keys()].sort((a, b) => {
      const ai = CARD_FIRST.indexOf(a), bi = CARD_FIRST.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      if (a === NO_CATEGORY) return 1;
      if (b === NO_CATEGORY) return -1;
      return a.localeCompare(b);
    });

    host.innerHTML = `
      <div class="shop-controls">
        <label>Sort
          <select id="shop-sort">
            ${Object.entries(SORTS).map(([k, s]) =>
              `<option value="${k}"${k === sortKey ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
          </select>
        </label>
        <small>${shelf.length} thing${shelf.length === 1 ? '' : 's'} on the shelf</small>
      </div>
      ${names.map((name) => {
        const items = groups.get(name).slice().sort(sorter);
        const isOpen = open.has(name);
        const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));

        /* Clamped rather than trusted: sorting or a sold-out card can
           shrink a category under somebody sitting on page five. */
        const page = Math.min(Math.max(pageOf[name] || 1, 1), pages);
        pageOf[name] = page;
        const from = (page - 1) * PER_PAGE;
        const shown = items.slice(from, from + PER_PAGE);

        return `<section class="shop-cat${isOpen ? ' is-open' : ''}" data-cat="${esc(name)}">
          <button type="button" class="shop-cat-head" aria-expanded="${isOpen}">
            <span class="shop-cat-name">${esc(name)}</span>
            <span class="shop-cat-count">${items.length}</span>
            <span class="shop-cat-arrow" aria-hidden="true">▸</span>
          </button>
          <div class="shop-cat-body">
            ${shown.map(tile).join('')}
            ${pages > 1 ? pager(name, page, pages, from, shown.length, items.length) : ''}
          </div>
        </section>`;
      }).join('')}`;
  }

  /* WHICH ONES YOU ARE LOOKING AT, NOT JUST WHICH PAGE.
     "Page 2 of 5" makes somebody do the arithmetic to work out whether
     they have seen the thing they are hunting for. "26-50 of 110" does
     not. */
  function pager(name, page, pages, from, count, total) {
    const first = from + 1, last = from + count;
    return `<nav class="shop-pager" data-pager="${esc(name)}">
      <button type="button" class="ghost-btn" data-page="${page - 1}"${page <= 1 ? ' disabled' : ''}>← Back</button>
      <small>${first}–${last} of ${total}</small>
      <button type="button" class="ghost-btn" data-page="${page + 1}"${page >= pages ? ' disabled' : ''}>Next →</button>
    </nav>`;
  }

  function tile(item) {
    const id = esc(item.clover_item_id);
    const already = inCart(item.clover_item_id);
    return `<article class="shop-tile">
      <a class="shop-tile-open" href="?page=item&id=${encodeURIComponent(item.clover_item_id)}" data-item-link="${id}">
        ${picture(item)}
        <strong>${esc(item.name)}</strong>
        <span class="shop-ask">Asking price: ${esc(money(item.price))}</span>
      </a>
      <button type="button" class="primary-btn shop-add${already ? ' in-cart' : ''}" data-add="${id}">
        ${already ? 'In your cart' : 'Add to cart'}
      </button>
    </article>`;
  }

  /* ---- one product ---------------------------------------------------- */

  async function initItem() {
    const host = document.getElementById('shop-item-page');
    if (!host || !sb()) return;

    let id = '';
    try { id = new URLSearchParams(location.search).get('id') || ''; } catch (_) { id = ''; }
    if (!id) { host.innerHTML = notFound(); return; }

    const { data, error } = await sb()
      .from('shop_available')
      .select('clover_item_id, name, price, available, category_name, photo_url, art_url, card_id, set_name, card_number, hidden_online')
      .eq('clover_item_id', id)
      .maybeSingle();

    /* A hidden item is treated exactly like one that is not there. If it
       only disappeared from the shelf, the direct link would still work
       and an old link, a bookmark or a search result would walk straight
       past the curtain. */
    if (error || !data || data.hidden_online) { host.innerHTML = notFound(); return; }

    const item = data;
    const gone = (item.available || 0) < 1;
    const both = Boolean(item.photo_url && item.art_url);

    host.innerHTML = `
      <a class="shop-back" href="?page=shop" data-route="shop">← Back to the shop</a>
      <div class="shop-item">
        <div class="shop-item-pics">
          <div id="shop-item-pic">${picture(item, true)}</div>
          ${both ? `<div class="shop-flip">
            <button type="button" class="ghost-btn is-on" data-view="art">Catalogue picture</button>
            <button type="button" class="ghost-btn" data-view="photo">The actual card</button>
          </div><small class="shop-flip-note">The actual card is a photo of the exact one you would be getting, taken in the shop.</small>` : ''}
        </div>
        <div class="shop-item-facts">
          <h1>${esc(item.name)}</h1>
          ${item.set_name || item.card_number
            ? `<p class="shop-item-meta">${esc([item.set_name, item.card_number].filter(Boolean).join(' · '))}</p>` : ''}
          ${item.category_name ? `<p class="shop-item-cat">${esc(item.category_name)}</p>` : ''}
          <p class="shop-item-price">Asking price: <strong>${esc(money(item.price))}</strong></p>
          ${gone
            ? `<p class="shop-item-gone">This one has gone.</p>`
            : `<button type="button" class="primary-btn shop-add big${inCart(item.clover_item_id) ? ' in-cart' : ''}" data-add="${esc(item.clover_item_id)}">
                 ${inCart(item.clover_item_id) ? 'In your cart' : 'Add to cart'}
               </button>`}
          <p class="shop-item-note">One of these exists. Collect it at the shop, or have it posted for $${SHIPPING_FLAT} flat.</p>
        </div>
      </div>
      <!-- A WAY OUT AT THE BOTTOM TOO.
           The one at the top has scrolled off by the time somebody has
           read the page, and a phone's own Back button is not something
           to rely on when they arrived here from a link. -->
      <div class="shop-item-out">
        <a class="ghost-btn shop-back-btn" href="?page=shop" data-route="shop">← Back to the shop</a>
      </div>`;

    if (both) {
      host.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => {
        const wantArt = btn.dataset.view === 'art';
        host.querySelector('#shop-item-pic').innerHTML =
          picture(wantArt ? { name: item.name, art_url: item.art_url } : { name: item.name, photo_url: item.photo_url }, true);
        host.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('is-on', b === btn));
      }));
    }
    drawCartBar();
  }

  const notFound = () => `
    <a class="shop-back" href="?page=shop" data-route="shop">← Back to the shop</a>
    <div class="empty-state">That one is not on the shelf any more.</div>
    <div class="shop-item-out">
      <a class="ghost-btn shop-back-btn" href="?page=shop" data-route="shop">← Back to the shop</a>
    </div>`;

  /* ---- the basket on screen ------------------------------------------- */

  function drawCartBar() {
    const list = cart();
    let bar = document.getElementById('shop-cart-bar');

    if (!list.length) { if (bar) bar.remove(); return; }

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'shop-cart-bar';
      bar.className = 'shop-cart-bar';
      document.body.appendChild(bar);
      bar.addEventListener('click', (e) => { if (e.target.closest('[data-open-cart]')) openCart(); });
    }
    const total = list.reduce((sum, c) => sum + (c.price || 0), 0);
    bar.innerHTML = `<button type="button" data-open-cart>
      <span>${list.length} in your cart</span><strong>${esc(money(total))}</strong><em>Check out</em></button>`;
  }

  function closeCart() {
    document.getElementById('shop-cart-sheet')?.remove();
    document.removeEventListener('keydown', cartKeys);
  }
  function cartKeys(e) { if (e.key === 'Escape') closeCart(); }

  function openCart() {
    closeCart();
    const list = cart();
    if (!list.length) return;

    /* Same sheet the shop has always used: .buy-sheet does the
       positioning, .buy-backdrop is the dimmed layer inside it, and
       tapping either the backdrop or Cancel closes it. Reusing it means
       the cart behaves exactly like the thing customers have already
       seen, and there is one set of dialog styles rather than two. */
    const wrap = document.createElement('div');
    wrap.id = 'shop-cart-sheet';
    wrap.className = 'buy-sheet';
    wrap.innerHTML = `
      <div class="buy-backdrop" data-close="1"></div>
      <div class="buy-panel" role="dialog" aria-modal="true" aria-label="Your cart">
        <h3>Your cart</h3>
        <div class="cart-lines">
          ${list.map((c) => `<div class="cart-line">
            ${c.photo ? `<img src="${esc(c.photo)}" alt="">` : '<div class="cart-line-blank"></div>'}
            <span><strong>${esc(c.name)}</strong><small>${esc(money(c.price))}</small></span>
            <button type="button" class="ghost-btn" data-drop="${esc(c.id)}">Remove</button>
          </div>`).join('')}
        </div>
        <p class="buy-price">Total ${esc(money(list.reduce((s, c) => s + (c.price || 0), 0)))}</p>
        <p class="buy-q">How do you want them?</p>
        <div class="buy-choices">
          <button type="button" class="primary-btn" data-go="pickup">Pick up at the shop<small>No extra charge</small></button>
          <button type="button" class="primary-btn" data-go="ship">Ship them to me<small>+ $${SHIPPING_FLAT.toFixed(2)} flat, however many</small></button>
        </div>
        <div class="buy-status" id="cart-status"></div>
        <button type="button" class="ghost-btn" data-close="1">Keep shopping</button>
      </div>`;
    document.body.appendChild(wrap);
    document.addEventListener('keydown', cartKeys);

    wrap.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) { closeCart(); return; }
      const drop = e.target.closest('[data-drop]');
      if (drop) { removeFromCart(drop.dataset.drop); closeCart(); if (cart().length) openCart(); refresh(); return; }
      const go = e.target.closest('[data-go]');
      if (go) await checkout(go.dataset.go, wrap);
    });
  }

  /* ---- paying --------------------------------------------------------- */

  async function checkout(fulfilment, wrap) {
    const status = wrap.querySelector('#cart-status');
    wrap.querySelectorAll('[data-go]').forEach((b) => (b.disabled = true));
    status.textContent = 'Holding them for you…';

    try {
      const { data, error } = await sb().functions.invoke('create-checkout', {
        body: { items: cart().map((c) => ({ itemId: c.id, qty: 1 })), fulfilment }
      });

      let payload = data || {};
      if (!data && error && error.context && typeof error.context.json === 'function') {
        try { payload = await error.context.json(); } catch (_) { payload = {}; }
      }

      /* SOMETHING IN THE BASKET WENT WHILE THEY WERE SHOPPING.
         Named, removed, and the rest kept -- a basket emptied without
         explanation is how somebody decides the shop is broken. */
      if (payload && payload.sold) {
        const goneName = payload.soldName || 'One of those';
        if (payload.soldItem) removeFromCart(payload.soldItem);
        status.innerHTML = `<strong>${esc(goneName)} just went.</strong> Somebody got there first — it has been taken out of your cart.`;
        wrap.querySelectorAll('[data-go]').forEach((b) => (b.disabled = false));
        refresh();
        return;
      }

      if (error || !data || !data.url) {
        status.textContent = payload.error || 'Could not start checkout — try again in a moment.';
        if (payload.detail) {
          const d = document.createElement('small');
          d.style.cssText = 'display:block;margin-top:6px;opacity:.7;font-size:.8em';
          d.textContent = payload.detail;
          status.appendChild(d);
        }
        wrap.querySelectorAll('[data-go]').forEach((b) => (b.disabled = false));
        return;
      }

      /* localStorage, not sessionStorage: a trip out to Clover and back
         does not reliably come home to the same tab, and the receipt
         needs to know which order this was. Stamped, and ignored after
         two hours so last week's cannot resurface as somebody's receipt. */
      try {
        localStorage.setItem('ip-order', JSON.stringify({ ref: data.orderRef || '', at: Date.now() }));
      } catch (_) { /* the payment still works; the receipt falls back */ }
      clearCart();
      window.location.href = data.url;
    } catch (_) {
      status.textContent = 'Could not start checkout — try again in a moment.';
      wrap.querySelectorAll('[data-go]').forEach((b) => (b.disabled = false));
    }
  }

  function refresh() {
    const host = document.getElementById('shop-inventory-list');
    if (host && shelf.length) draw(host);
    drawCartBar();
  }

  /* ---- one listener, on the document ---------------------------------
   * The shelf is redrawn every time the cart changes, and listeners bound
   * to redrawn HTML are the classic reason a second tap does nothing. */

  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      e.preventDefault();
      const id = add.dataset.add;
      const item = shelf.find((i) => i.clover_item_id === id);
      if (item) addToCart(item);
      else addToCart({ clover_item_id: id, name: add.closest('.shop-item')?.querySelector('h1')?.textContent || 'Item', price: null });
      add.textContent = 'In your cart';
      add.classList.add('in-cart');
      return;
    }
    /* Paging, before the section header -- the buttons sit inside the
       section and a header click would otherwise fold it shut under
       somebody who only wanted the next twenty-five. */
    const pageBtn = e.target.closest('[data-page]');
    if (pageBtn && !pageBtn.disabled) {
      e.preventDefault();
      const nav = pageBtn.closest('[data-pager]');
      const section = pageBtn.closest('.shop-cat');
      if (nav) {
        pageOf[nav.dataset.pager] = Number(pageBtn.dataset.page);
        const host = document.getElementById('shop-inventory-list');
        if (host) draw(host);
        /* Back to the top of the category, not left halfway down where
           page one ended -- otherwise page two opens mid-list. */
        const again = host && host.querySelector(`.shop-cat[data-cat="${CSS.escape(nav.dataset.pager)}"]`);
        (again || section)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
      return;
    }

    const head = e.target.closest('.shop-cat-head');
    if (head) {
      const section = head.closest('.shop-cat');
      const open = openSet();
      const name = section.dataset.cat;
      if (section.classList.toggle('is-open')) open.add(name); else open.delete(name);
      head.setAttribute('aria-expanded', section.classList.contains('is-open'));
      rememberOpen(open);
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id !== 'shop-sort') return;
    try { localStorage.setItem(SORT_KEY, e.target.value); } catch (_) { /* applies anyway */ }
    const host = document.getElementById('shop-inventory-list');
    if (host) draw(host);
  });

  window.InfinitePullsShop = { init, initItem, drawCartBar, clearCart, cart };
})();
