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

  const MODES = [
    { key: 'en',     label: 'English',        placeholder: 'Card number, e.g. 112/150' },
    { key: 'ja',     label: 'Japanese',       placeholder: 'Card number, e.g. 112/150' },
    { key: 'sealed', label: 'Sealed Product', placeholder: 'Set name, e.g. Obsidian Flames' }
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
          <button type="button" class="secondary-btn lookup-scan" id="lookup-scan">
            <span aria-hidden="true">📷</span> Scan Card
          </button>
        </form>

        <!-- Under the box, as three chips. They change what the box means,
             so they sit with it rather than in a menu somewhere. -->
        <div class="lookup-modes" role="group" aria-label="What to look up">
          ${MODES.map((m) => `
            <button type="button" class="lookup-mode${m.key === mode ? ' is-on' : ''}"
                    data-mode="${m.key}" aria-pressed="${m.key === mode}">${esc(m.label)}</button>`).join('')}
        </div>
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
      <div class="lookup-hit">
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
      </div>`;
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
