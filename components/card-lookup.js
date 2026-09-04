/* CARD LOOKUP — the fast lane.
 *
 * A page with one job. Somebody is standing at a show, mid-negotiation,
 * with a card in one hand and a phone in the other. They need a price and
 * they need it now. Everything on this screen serves that and nothing
 * else: no hero, no logo, no explanation, no second question.
 *
 * WHY IT IS NOT MY COLLECTION
 *
 * My Collection's search exists to ADD a card to a collection: pick the
 * printing, pick the condition, set a quantity, save. Correct for what it
 * is, and four taps too many for a man being asked "what do you want for
 * it" in front of him. This page never asks a second question -- it takes
 * a number and gives back a number.
 *
 * WHAT THE BOX MEANS DEPENDS ON THE MODE
 *
 *   English / Japanese   a printed card number -- "112/150", exactly as
 *                        it reads on the bottom of the card. The two
 *                        modes are two separate TCGdex databases, not a
 *                        filter: a Japanese card id asked of the English
 *                        database simply 404s.
 *   Sealed Product       a SET name -- "Obsidian Flames" -- because
 *                        sealed product has no card number. This is the
 *                        one thing on the page that changes what typing
 *                        means, so the placeholder says so and the chip
 *                        stays visibly chosen.
 *
 * The chosen mode is remembered. Somebody who deals in Japanese cards
 * should not re-pick Japanese every time they open the page, and one
 * saved tap is a real saving on a screen built around single seconds.
 *
 * TYPED AND SCANNED ARE THE SAME PATH
 *
 * The scanner's whole job is to read "112/150" off the corner. Once there
 * is a number, this page cannot tell how it arrived -- which means the
 * scan path gets every improvement the typed path gets, for free, and the
 * OCR can be swapped underneath without touching this file.
 *
 * The engine is components/collection.js. Same TCGdex lookups, same
 * set-total narrowing, same single function that decides what a card is
 * worth, so a price here can never disagree with a price there.
 */
(function () {
  'use strict';

  /* Short labels on purpose. These sit beside Scan Card on one row, and a
     row that has to hold "Sealed Product" leaves the scan button too
     narrow to hit in a hurry. `full` is what a screen reader says and what
     the tooltip shows, so nothing is actually lost. */
  const MODES = [
    { key: 'en',     short: 'EN',  full: 'English',        placeholder: 'Card number, e.g. 112/150' },
    { key: 'ja',     short: 'JP',  full: 'Japanese',       placeholder: 'Card number, e.g. 112/150' },
    { key: 'sealed', short: '📦',  full: 'Sealed Product', placeholder: 'Set name, e.g. Obsidian Flames' }
  ];
  const MODE_KEY = 'infinite-pulls-lookup-mode';

  const sbWrap = () => window.InfinitePullsSupabase || {};
  const sb = () => (sbWrap().ready ? sbWrap().client : null);
  const col = () => window.InfinitePullsCollection;
  const sealed = () => window.InfinitePullsSealed;
  const root = () => document.getElementById('lookup-page');

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  const money = (n) => (typeof n === 'number' && isFinite(n))
    ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
    : null;

  let mode = 'en';
  let busy = false;
  let lastResults = [];

  function readMode() {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (MODES.some((m) => m.key === saved)) return saved;
    } catch (_) { /* private mode */ }
    return 'en';
  }
  function saveMode(m) {
    try { localStorage.setItem(MODE_KEY, m); } catch (_) { /* fine */ }
  }
  const modeMeta = () => MODES.find((m) => m.key === mode) || MODES[0];

  /* ---- The screen ---------------------------------------------------- */

  function shellHtml() {
    const meta = modeMeta();
    return `
      <section class="lookup-bar">
        <form id="lookup-form" autocomplete="off">
          <div class="lookup-row">
            <input id="lookup-input" type="text" name="q"
                   placeholder="${esc(meta.placeholder)}"
                   inputmode="${mode === 'sealed' ? 'text' : 'numeric'}"
                   enterkeyhint="search"
                   autocapitalize="none" autocorrect="off" spellcheck="false">
            <button type="submit" class="primary-btn lookup-go" aria-label="Look it up">Go</button>
          </div>
          <!-- Scan and the three modes share one row. The modes are what
               the scan and the box both act on, so they belong beside the
               thing they modify rather than on a line of their own. -->
          <div class="lookup-actions">
            <button type="button" class="secondary-btn lookup-scan" id="lookup-scan">
              <span aria-hidden="true">📷</span> Scan Card
            </button>
            <div class="lookup-modes" role="group" aria-label="What to look up">
              ${MODES.map((m) => `
                <button type="button" class="lookup-mode${m.key === mode ? ' is-on' : ''}"
                        data-mode="${m.key}" aria-pressed="${m.key === mode}"
                        title="${esc(m.full)}" aria-label="${esc(m.full)}">${esc(m.short)}</button>`).join('')}
            </div>
          </div>
        </form>
      </section>

      <div id="lookup-status" class="lookup-status" role="status" aria-live="polite"></div>
      <div id="lookup-results"></div>`;
  }

  function signedOutHtml() {
    return `
      <section class="hero">
        <div class="eyebrow">Card Lookup</div>
        <h1>Free account, then look up anything</h1>
        <p>Type a card number or scan the card, and see what it's worth — English, Japanese, or sealed product.</p>
        <p><a class="primary-btn" href="?page=account" data-route="account">Create a free account</a></p>
        <p><small style="color:var(--muted)">Already have one? The same button signs you in.</small></p>
      </section>`;
  }

  function status(msg, kind) {
    const el = document.getElementById('lookup-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'lookup-status' + (kind ? ' is-' + kind : '');
  }

  /* ---- Results ------------------------------------------------------- */

  /* Deliberately plain for now: picture, what it is, what it is worth. The
     price is the biggest thing on the row because it is the only thing
     being asked for. */
  function cardRowHtml(r) {
    const c = r.card || r.brief || {};
    const img = c.image ? c.image + '/low.webp' : '';
    const setName = (c.set && c.set.name) || '';
    const total = c.set && c.set.cardCount && c.set.cardCount.official;
    const num = c.localId ? esc(c.localId) + (total ? '/' + esc(String(total)) : '') : '';
    const price = money(r.amount);
    return `
      <button type="button" class="lookup-hit" data-pick="${esc(c.id || '')}">
        <span class="lookup-hit-art">
          ${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">` : ''}
        </span>
        <span class="lookup-hit-body">
          <strong>${esc(c.name || 'Unknown card')}</strong>
          <small>${esc(setName)}${num ? ' · ' + num : ''}</small>
        </span>
        <span class="lookup-hit-price${price ? '' : ' is-none'}">
          ${price ? (r.converted ? '≈ ' : '') + esc(price) : 'No price'}
        </span>
      </button>`;
  }

  /* ---- The card itself ------------------------------------------------
   *
   * Once the card is picked this is the whole screen: the card big enough
   * to check against the one in his hand, what it is underneath, and then
   * every price we can reach as a rail that slides sideways.
   *
   * A rail rather than a stacked list because the prices are SIBLINGS, not
   * a ranking. Normal, Reverse Holo, Cardmarket and eBay are four answers
   * to the same question from four different markets, and stacking them
   * would say the top one is the real one.
   */

  let picked = null;   // the card currently open, for going back to the list

  function priceTileHtml(t) {
    if (t.kind === 'cardmarket') {
      return `
        <div class="price-tile">
          <span class="price-tile-src">${esc(t.source)}</span>
          <strong class="price-tile-amount">€${t.euros.toFixed(2)}</strong>
          <span class="price-tile-note">${t.amount !== null ? '≈ ' + esc(money(t.amount)) : 'Europe'}</span>
        </div>`;
    }
    return `
      <div class="price-tile">
        <span class="price-tile-src">${esc(t.source)}</span>
        <strong class="price-tile-amount">${esc(money(t.amount))}</strong>
        <span class="price-tile-note">${esc(t.label)}</span>
      </div>`;
  }

  /* eBay is a link, not a figure. Its own API can only see what is being
     ASKED right now -- eBay has no free sold endpoint -- so the number on
     the tile is labelled as asking, and tapping goes to the real sold
     comps on eBay's site. It opens in a new tab because eBay blocks being
     put in a frame, and because he is mid-negotiation: he glances, comes
     back, and this page is exactly where he left it. */
  function ebayTileHtml(card, ebay) {
    const c = col();
    const href = (c && c.ebaySoldUrl) ? c.ebaySoldUrl(card) : '';
    const has = ebay && ebay.available;
    return `
      <a class="price-tile is-ebay" href="${esc(href)}" target="_blank" rel="noopener">
        <span class="price-tile-src">eBay <span aria-hidden="true">↗</span></span>
        <strong class="price-tile-amount">${has ? esc(money(ebay.median)) : 'Sold'}</strong>
        <span class="price-tile-note">${has ? 'asking · tap for sold' : 'see sold comps'}</span>
      </a>`;
  }

  function detailHtml(card, tiles) {
    const img = card.image ? card.image + '/high.webp' : '';
    const total = card.set && card.set.cardCount && card.set.cardCount.official;
    const num = card.localId ? esc(card.localId) + (total ? '/' + esc(String(total)) : '') : '';
    return `
      <div class="lookup-detail">
        <button type="button" class="ghost-btn lookup-back" data-back>← Back to results</button>
        <div class="lookup-card-art">
          ${img ? `<img src="${esc(img)}" alt="${esc(card.name || '')}">` : ''}
        </div>
        <h2 class="lookup-card-name">${esc(card.name || '')}</h2>
        <p class="lookup-card-meta">${esc((card.set && card.set.name) || '')}${num ? ' · ' + num : ''}${card.rarity ? ' · ' + esc(card.rarity) : ''}</p>

        <div class="rail price-rail" id="price-rail">
          ${tiles.length ? tiles.map(priceTileHtml).join('')
                         : '<div class="price-tile is-none"><span class="price-tile-src">No price</span><strong class="price-tile-amount">—</strong><span class="price-tile-note">not carried yet</span></div>'}
        </div>
      </div>`;
  }

  async function openCard(cardId) {
    const c = col();
    const hit = (lastResults || []).find((r) => r.card && r.card.id === cardId);
    if (!hit || !hit.card) return;
    picked = hit.card;

    status('');
    renderResults(detailHtml(hit.card, await c.priceTilesFor(hit.card)));
    window.scrollTo({ top: 0, behavior: 'instant' });

    /* eBay lands late and on its own. The rail is already usable without
       it, and a card that takes seven seconds because eBay was slow is a
       card he stopped waiting for. */
    try {
      const ebay = await c.ebayPriceFor(hit.card);
      const rail = document.getElementById('price-rail');
      if (rail && picked === hit.card) rail.insertAdjacentHTML('beforeend', ebayTileHtml(hit.card, ebay));
    } catch (_) {
      const rail = document.getElementById('price-rail');
      if (rail && picked === hit.card) rail.insertAdjacentHTML('beforeend', ebayTileHtml(hit.card, null));
    }
  }

  /* The sealed row leans on sealed.js's own price label, which already
     knows the difference between a sold price and an asking price and
     says so. Re-deciding that here is how the two screens end up quoting
     different numbers for the same box. */
  function sealedRowHtml(product, priced, setName) {
    const s = sealed();
    const price = priced || product;
    const img = price.imageUrl || product.imageUrl;
    const label = (s && s.priceLabelHtml) ? s.priceLabelHtml(price) : '';
    const unpriced = typeof price.price !== 'number';
    return `
      <div class="lookup-hit${unpriced ? ' is-unpriced' : ''}">
        <span class="lookup-hit-art">
          ${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">` : ''}
        </span>
        <span class="lookup-hit-body">
          <strong>${esc(product.name)}</strong>
          <small>${esc(setName || '')}</small>
        </span>
        <span class="lookup-hit-price${unpriced ? ' is-none' : ''}">${label}</span>
      </div>`;
  }

  function renderResults(html) {
    const el = document.getElementById('lookup-results');
    if (el) el.innerHTML = html;
  }

  /* ---- Looking things up --------------------------------------------- */

  async function runCardLookup(raw) {
    const c = col();
    if (!c || !c.lookupByNumber) { status('Lookup is not available right now.', 'bad'); return; }

    status('Looking it up…');
    renderResults('');
    try {
      const { results, setTotalMissed, parsed } = await c.lookupByNumber(raw, mode);
      if (!parsed) { status('Type the number from the bottom of the card, like 112/150.', 'bad'); return; }

      if (!results.length) {
        status(`Nothing found for ${parsed.number}${parsed.setTotal ? '/' + parsed.setTotal : ''} in ${mode === 'ja' ? 'Japanese' : 'English'}. ${mode === 'en' ? 'Try the Japanese chip.' : 'Try the English chip.'}`, 'bad');
        return;
      }

      lastResults = results;

      /* One match and no ambiguity about the set: there is nothing to
         choose, so choosing is a tap that exists only to be spent. Go
         straight to the card. */
      if (results.length === 1 && !setTotalMissed && results[0].card) {
        await openCard(results[0].card.id);
        return;
      }

      /* The set total narrowed to nothing, so what is on screen is every
         card with that number. Say so -- a silently widened search is how
         somebody quotes a price off the wrong card. */
      status(setTotalMissed
        ? `No set with ${parsed.setTotal} cards has a ${parsed.number} — showing every card numbered ${parsed.number}.`
        : `${results.length} match${results.length === 1 ? '' : 'es'}`);
      renderResults(results.map(cardRowHtml).join(''));
    } catch (err) {
      status('That did not go through — try again in a moment.', 'bad');
    }
  }

  /* Sealed is a set name, then that set's products -- two steps, because
     a flat list of every product of every set is thousands of rows and
     the upstream catalogue bills per product returned. Same reasoning,
     and the same functions, as the Sealed tab in My Collection. */
  async function runSealedLookup(query) {
    const s = sealed();
    if (!s || !s.matchingSets) { status('Sealed lookup is not available right now.', 'bad'); return; }

    status('Looking it up…');
    renderResults('');
    try {
      const sets = await s.loadSets('en');
      const hits = s.matchingSets(sets || [], query);
      if (!hits.length) { status(`No set matching "${query}".`, 'bad'); return; }

      const set = hits[0];
      status(`Looking up ${set.name}…`);
      const products = await s.catalogForSet(set);
      if (!products || !products.length) {
        status(`No sealed product catalogued for ${set.name}. Older sets and Japanese sets often are not.`, 'bad');
        return;
      }

      const prices = await s.pricesFor(products.map((p) => p.productId));

      // Priced first: an unpriced row is usually something that was never
      // made, and it has no business above a real box.
      const ordered = products.slice().sort((a, b) => {
        const pa = prices[a.productId] && prices[a.productId].price;
        const pb = prices[b.productId] && prices[b.productId].price;
        if (typeof pa === 'number' && typeof pb !== 'number') return -1;
        if (typeof pb === 'number' && typeof pa !== 'number') return 1;
        if (typeof pa === 'number' && typeof pb === 'number') return pb - pa;
        return String(a.name).localeCompare(String(b.name));
      });

      status(`${set.name}${hits.length > 1 ? ` — closest of ${hits.length} matching sets` : ''}`);
      renderResults(ordered.map((p) => sealedRowHtml(p, prices[p.productId], set.name)).join(''));
    } catch (err) {
      status('That did not go through — try again in a moment.', 'bad');
    }
  }

  async function submit(raw) {
    const q = String(raw || '').trim();
    if (!q || busy) return;
    busy = true;
    try {
      if (mode === 'sealed') await runSealedLookup(q);
      else await runCardLookup(q);
    } finally {
      busy = false;
    }
  }

  /* ---- Wiring -------------------------------------------------------- */

  function focusBox(select) {
    const input = document.getElementById('lookup-input');
    if (!input) return;
    input.focus({ preventScroll: true });
    // Selecting rather than clearing: the previous number is still there
    // to glance at, and the first keystroke replaces it.
    if (select) input.select();
  }

  function wire() {
    const form = document.getElementById('lookup-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submit(form.elements.q.value);
      });
    }

    document.getElementById('lookup-scan')?.addEventListener('click', async () => {
      const c = col();
      if (!c || !c.scanCardNumber) { status('The scanner is not available right now.', 'bad'); return; }
      status('📷 Reading the number in the corner…');
      const res = await c.scanCardNumber();

      if (res.status === 'cancelled') { status(''); return; }
      if (res.status === 'unavailable') { status('No camera available here — type the number instead.', 'bad'); focusBox(true); return; }
      if (res.status === 'unread' || res.status === 'error') {
        status('Could not read that card. Fill the outline, hold it straight on, light on the bottom corner — or just type the number.', 'bad');
        focusBox(true);
        return;
      }

      // It read a number. From here it is the typed path exactly.
      const input = document.getElementById('lookup-input');
      if (input) input.value = res.number;
      submit(res.number);
    });

    /* Delegated, because the results area is rewritten on every search
       and on every back. */
    document.getElementById('lookup-results')?.addEventListener('click', (e) => {
      const back = e.target.closest('[data-back]');
      if (back) {
        picked = null;
        status(`${lastResults.length} match${lastResults.length === 1 ? '' : 'es'}`);
        renderResults(lastResults.map(cardRowHtml).join(''));
        return;
      }
      const pick = e.target.closest('[data-pick]');
      if (pick && pick.dataset.pick) openCard(pick.dataset.pick);
    });

    root().querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === mode) return;
        mode = btn.dataset.mode;
        saveMode(mode);
        render();
        focusBox(true);
      });
    });
  }

  function render() {
    const el = root();
    if (!el) return;
    el.innerHTML = shellHtml();
    wire();
  }

  async function init() {
    const el = root();
    if (!el) return;

    const client = sb();
    if (!client) { el.innerHTML = signedOutHtml(); return; }

    let user = null;
    try {
      const { data } = await client.auth.getSession();
      user = data && data.session && data.session.user;
    } catch (_) { /* signed out */ }
    if (!user) { el.innerHTML = signedOutHtml(); return; }

    mode = readMode();
    render();
    // The cursor is in the box before the phone has finished settling. On
    // this page that is the entire point.
    focusBox(false);
  }

  window.InfinitePullsCardLookup = { init };
})();
