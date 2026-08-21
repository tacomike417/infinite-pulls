(function(){
  const CONDITIONS = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];
  const VARIANT_LABELS = {
    normal: 'Normal',
    holofoil: 'Holofoil',
    'reverse-holofoil': 'Reverse Holofoil',
    '1st-edition': '1st Edition',
    '1st-edition-holofoil': '1st Edition Holofoil',
    unlimited: 'Unlimited',
    'unlimited-holofoil': 'Unlimited Holofoil'
  };

  // Two lists share this exact same search/add/remove flow — the only
  // real difference is which table they write to and a bit of wording.
  // "My Collection" is cards a visitor owns; "Wish List" is cards they're
  // hunting for. Both get a condition field (for a wish list, it's the
  // condition they're hoping to find, not one they already have) and both
  // show an estimated dollar total using the same TCGdex pricing.
  const LIST_CONFIG = {
    collection: {
      table: 'user_cards',
      tabLabel: 'My Collection',
      addTitle: 'Add a Card',
      addButtonLabel: 'Add to Collection',
      yourEyebrow: 'Your Collection',
      yourTitle: 'Your Cards',
      totalLabel: 'Estimated Total Value *',
      emptyList: 'No cards yet — search above to add your first one.',
      conditionLabel: 'Condition',
      searchPlaceholder: 'e.g. Charizard',
      signedOutBody: 'Create a free account to add cards, track their condition, and see your collection\'s total value.'
    },
    wishlist: {
      table: 'wishlist_cards',
      tabLabel: 'Wish List',
      addTitle: 'Add to Wish List',
      addButtonLabel: 'Add to Wish List',
      yourEyebrow: 'Wish List',
      yourTitle: 'Cards You Want',
      totalLabel: 'Estimated Wish List Value *',
      emptyList: 'No cards yet — search above to add one you\'re hunting for.',
      conditionLabel: 'Condition Wanted',
      searchPlaceholder: 'e.g. Umbreon VMAX',
      signedOutBody: 'Create a free account to build a wish list of cards you\'re looking for.'
    }
  };

  // TCGdex: free, open-source, no API key required, and includes real
  // TCGplayer + Cardmarket pricing per card — unlike pokemontcg.io (which
  // this replaced), it isn't a legacy product being wound down. See
  // https://tcgdex.dev for docs. Card search only returns "brief" cards
  // (id/name/image, no pricing) — full pricing needs a second fetch per
  // card, done lazily only once a visitor picks a specific result below.
  const TCGDEX_BASE = 'https://api.tcgdex.net/v2/en';

  function escapeHtml(value=''){
    return String(value).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[m]));
  }

  function client(){
    return window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  }

  function root(){
    return document.getElementById('collection-page');
  }

  function currency(n){
    return typeof n === 'number' ? '$' + n.toFixed(2) : null;
  }

  function sleep(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function thumbUrl(image){
    return image ? `${image}/low.webp` : '';
  }

  // A couple of quick automatic retries smooths over the occasional
  // network blip instead of surfacing it as a search failure right away.
  async function fetchTcgdex(url, attempts = 3){
    let lastErr;
    for(let i = 0; i < attempts; i++){
      try{
        const res = await fetch(url);
        if(res.ok) return await res.json();
        lastErr = new Error('TCGdex returned ' + res.status);
      }catch(err){
        lastErr = err;
      }
      if(i < attempts - 1) await sleep(400 * (i + 1));
    }
    throw lastErr;
  }

  // TCGdex has no default result limit for a plain name search (pagination
  // is off unless asked for) — a search like "Charizard" can genuinely
  // match 100+ cards across every set it's ever been printed in. Capping
  // at just 20 (the old value here) was hiding the vast majority of real
  // matches compared to full card-database apps. This cap just keeps one
  // search from rendering an unreasonably huge grid; it's generous enough
  // that it should essentially never be hit for a real card name, and
  // renderSearchResults below says so plainly on the rare case it is.
  const SEARCH_RESULT_LIMIT = 120;

  async function searchCards(term){
    const cleaned = term.trim();
    if(!cleaned) return [];
    try{
      const json = await fetchTcgdex(`${TCGDEX_BASE}/cards?name=${encodeURIComponent(cleaned)}`);
      return Array.isArray(json) ? json.slice(0, SEARCH_RESULT_LIMIT) : [];
    }catch{
      throw new Error('Card search is having trouble right now — try again in a moment.');
    }
  }

  async function fetchCardDetail(id){
    return await fetchTcgdex(`${TCGDEX_BASE}/cards/${encodeURIComponent(id)}`);
  }

  // ---- Snap-to-scan: reads the printed text off a photo of a card and
  // feeds the best guess into the exact same search → confirm → add flow
  // used for typed searches. Tesseract.js (free, runs entirely in the
  // visitor's browser, no server or API key) is loaded on demand — it's
  // a few MB, so it's deliberately NOT in the service worker's precache
  // list, only fetched the first time someone actually taps "Scan a Card."
  let tesseractLoadPromise = null;
  function loadTesseract(){
    if(window.Tesseract) return Promise.resolve();
    if(tesseractLoadPromise) return tesseractLoadPromise;
    tesseractLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = () => resolve();
      script.onerror = () => { tesseractLoadPromise = null; reject(new Error('Scanning tool could not load — check your connection and try again')); };
      document.head.appendChild(script);
    });
    return tesseractLoadPromise;
  }

  // Downscaling before OCR both speeds recognition up a lot and keeps
  // a giant phone-camera photo from stalling on slower devices.
  function downscaleImageToCanvas(file, maxDim){
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that photo')); };
      img.src = url;
    });
  }

  // OCR text off a real card is messy (attack text, HP, symbols all mixed
  // in) — this pulls out short, name-shaped lines as guesses, in the order
  // they were read (a card's name is almost always printed near the top).
  // Nothing here needs to be perfect: whatever it guesses just becomes a
  // normal TCGdex search, and the visitor still taps the correct result
  // from real matches, same as typing a name in by hand.
  function extractNameCandidates(rawText){
    const skipWords = /^(HP|BASIC|STAGE ?1|STAGE ?2|EX|GX|V|VMAX|VSTAR|POK[EÉ]MON|TRAINER|ENERGY|ITEM|SUPPORTER|STADIUM|WEAKNESS|RESISTANCE|RETREAT|COST)$/i;
    return String(rawText || '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length >= 3 && l.length <= 28)
      .filter(l => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\- ]*$/.test(l))
      .filter(l => !skipWords.test(l))
      .slice(0, 5);
  }

  async function handleScanFile(file, user, mode, onAdded){
    const resultsEl = document.getElementById('card-search-results');
    if(!resultsEl || !file) return;
    resultsEl.innerHTML = '<div class="empty-state">📷 Reading your photo… this can take a few seconds.</div>';

    let text = '';
    try{
      await loadTesseract();
      const canvas = await downscaleImageToCanvas(file, 1200);
      const result = await window.Tesseract.recognize(canvas, 'eng');
      text = result?.data?.text || '';
    }catch(err){
      renderSearchResults([], user, onAdded, mode, err.message || 'Could not read that photo — try a clearer, well-lit shot, or search by name below.');
      return;
    }

    const candidates = extractNameCandidates(text);
    for(const guess of candidates){
      try{
        const cards = await searchCards(guess);
        if(cards.length){
          renderSearchResults(cards, user, onAdded, mode, `Matched from your photo as "${guess}" — tap the right card below.`);
          return;
        }
      }catch{ /* try the next candidate line */ }
    }

    renderSearchResults([], user, onAdded, mode, "Couldn't match that photo to a card — try a clearer, well-lit photo, or search by name below.");
  }

  function variantOptions(card){
    const prices = card?.pricing?.tcgplayer || {};
    const keys = Object.keys(prices).filter(k => k !== 'updated' && k !== 'unit');
    if(!keys.length) return [{ value: 'normal', label: 'Normal (no pricing available)' }];
    return keys.map(key => ({
      value: key,
      label: (VARIANT_LABELS[key] || key) + (typeof prices[key].marketPrice === 'number' ? ` — ${currency(prices[key].marketPrice)}` : ' (no market price)')
    }));
  }

  function priceForVariant(card, variantKey){
    const entry = card?.pricing?.tcgplayer?.[variantKey];
    return typeof entry?.marketPrice === 'number' ? entry.marketPrice : null;
  }

  // ---- Add-a-card search UI ----
  function renderSearchResults(cards, user, onAdded, mode, note){
    const resultsEl = document.getElementById('card-search-results');
    if(!resultsEl) return;

    if(!cards.length){
      resultsEl.innerHTML = `<div class="empty-state">${escapeHtml(note || 'No cards found — try a different spelling.')}</div>`;
      return;
    }

    // A name can genuinely match well over 100 cards once every set and
    // reprint over the years is counted (TCGdex itself doesn't cap this) —
    // when that many come back, say so plainly rather than quietly
    // showing a capped list with no explanation.
    const cappedNote = cards.length >= SEARCH_RESULT_LIMIT
      ? `Showing the first ${SEARCH_RESULT_LIMIT} matches — search a more specific name (like "Charizard ex") to narrow it down.`
      : null;
    const defaultNote = cards.length === 1 ? 'Tap the card to choose its variant, condition, and quantity.' : `${cards.length} cards found — tap the right one below.`;

    resultsEl.innerHTML = `
      <p><small>${escapeHtml(note || cappedNote || defaultNote)}</small></p>
      <div class="card-grid">
        ${cards.map(c => `
          <button type="button" class="card search-result-btn" data-card-id="${escapeHtml(c.id)}" style="text-align:left; cursor:pointer;">
            ${c.image
              ? `<img src="${escapeHtml(thumbUrl(c.image))}" alt="" loading="lazy" style="width:100%;aspect-ratio:245/337;object-fit:contain;margin-bottom:8px;">`
              : `<div style="width:100%;aspect-ratio:245/337;margin-bottom:8px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid var(--border);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:10px;">
                   <img src="./assets/logo.png" alt="" style="width:55%;opacity:.55;">
                   <small style="color:var(--muted);text-align:center;line-height:1.2;">No preview picture</small>
                 </div>`}
            <strong style="display:block">${escapeHtml(c.name)}</strong>
          </button>
        `).join('')}
      </div>
      <div id="card-picker-detail" style="margin-top:14px"></div>
    `;

    resultsEl.querySelectorAll('.search-result-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const detailEl = document.getElementById('card-picker-detail');
        detailEl.innerHTML = '<div class="empty-state">Loading card details…</div>';
        // Bring the picker into view right away — otherwise it renders below
        // the fold and looks like nothing happened until the visitor scrolls.
        detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try{
          const card = await fetchCardDetail(btn.dataset.cardId);
          showAddForm(card, user, onAdded, mode);
        }catch(err){
          detailEl.innerHTML = `<div class="empty-state">${escapeHtml(err.message || 'Could not load that card — try again.')}</div>`;
        }
      });
    });
  }

  function showAddForm(card, user, onAdded, mode){
    const detailEl = document.getElementById('card-picker-detail');
    if(!detailEl) return;
    const cfg = LIST_CONFIG[mode];
    const options = variantOptions(card);

    detailEl.innerHTML = `
      <div class="card section">
        <div style="display:flex; gap:12px;">
          ${card.image ? `<img src="${escapeHtml(thumbUrl(card.image))}" alt="" style="width:56px;height:78px;object-fit:contain;flex:0 0 auto;">` : ''}
          <div style="flex:1 1 auto; min-width:0;">
            <strong>${escapeHtml(card.name)}</strong>
            <small style="display:block">${escapeHtml(card.set?.name || '')}</small>
          </div>
        </div>
        <form id="add-card-form" class="form-grid" style="margin-top:10px">
          <label>Variant
            <select name="variant">
              ${options.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}
            </select>
          </label>
          <label>${escapeHtml(cfg.conditionLabel)}
            <select name="condition">
              ${CONDITIONS.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
            </select>
          </label>
          <label>Quantity<input type="number" name="quantity" value="1" min="1" style="width:100%"></label>
          <div class="form-actions"><button class="primary-btn" type="submit">${escapeHtml(cfg.addButtonLabel)}</button></div>
        </form>
      </div>
    `;

    document.getElementById('add-card-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const variant = e.target.elements.variant.value;
      const condition = e.target.elements.condition.value;
      const quantity = Math.max(1, parseInt(e.target.elements.quantity.value, 10) || 1);
      const button = e.target.querySelector('button');
      button.disabled = true;
      button.textContent = 'Adding…';

      const { error } = await client().from(cfg.table).insert({
        user_id: user.id,
        card_id: card.id,
        card_name: card.name,
        set_name: card.set?.name || null,
        image_url: card.image ? thumbUrl(card.image) : null,
        variant, condition, quantity
      });

      button.disabled = false;
      button.textContent = error ? 'Could not add — try again' : 'Added!';
      if(!error) setTimeout(onAdded, 400);
    });
  }

  // ---- Your list (collection or wish list) ----
  async function renderYourList(user, mode){
    const cfg = LIST_CONFIG[mode];
    const listWrap = document.getElementById('collection-list-wrap');
    if(!listWrap) return;
    listWrap.innerHTML = '<div class="empty-state">Loading…</div>';

    const { data: rows, error } = await client()
      .from(cfg.table)
      .select('id, card_id, card_name, set_name, image_url, variant, condition, quantity, added_at')
      .eq('user_id', user.id)
      .order('added_at', { ascending: false });

    if(error){ listWrap.innerHTML = `<div class="empty-state">Could not load this: ${escapeHtml(error.message)}</div>`; return; }
    if(!rows.length){ listWrap.innerHTML = `<div class="empty-state">${escapeHtml(cfg.emptyList)}</div>`; return; }

    // One fetch per unique card (pricing only lives on the full-card
    // endpoint, not the list endpoint) — run them together since TCGdex
    // has no rate limit to worry about for a single visitor's list.
    const uniqueIds = [...new Set(rows.map(r => r.card_id))];
    const cardById = {};
    await Promise.all(uniqueIds.map(async id => {
      try{ cardById[id] = await fetchCardDetail(id); }catch{ /* that card just shows "price unavailable" below */ }
    }));

    let total = 0;
    let anyMissing = false;

    const rowsHtml = rows.map(row => {
      const card = cardById[row.card_id];
      const market = card ? priceForVariant(card, row.variant) : null;
      const lineValue = typeof market === 'number' ? market * row.quantity : null;
      if(lineValue !== null) total += lineValue; else anyMissing = true;

      return `
        <div class="info-row" data-row-id="${escapeHtml(row.id)}" style="align-items:center">
          <span style="display:flex; align-items:center; gap:10px; min-width:0;">
            ${row.image_url ? `<img src="${escapeHtml(row.image_url)}" alt="" style="width:34px;height:47px;object-fit:contain;flex:0 0 auto;">` : ''}
            <span style="min-width:0;">
              <strong style="display:block">${escapeHtml(row.card_name)} ${row.quantity > 1 ? `×${row.quantity}` : ''}</strong>
              <small>${escapeHtml(row.set_name || '')} · ${escapeHtml(VARIANT_LABELS[row.variant] || row.variant)} · ${escapeHtml(row.condition)}</small>
            </span>
          </span>
          <span style="display:flex; align-items:center; gap:10px; flex:0 0 auto;">
            <strong>${lineValue !== null ? currency(lineValue) : 'price unavailable'}</strong>
            <button type="button" class="ghost-btn remove-card-btn" data-row-id="${escapeHtml(row.id)}" aria-label="Remove">✕</button>
          </span>
        </div>
      `;
    }).join('');

    listWrap.innerHTML = `
      <div class="notice" style="display:flex; justify-content:space-between; align-items:center;">
        <span>${escapeHtml(cfg.totalLabel)}</span>
        <strong style="font-size:1.3rem">${currency(total)}</strong>
      </div>
      ${anyMissing ? '<p><small>Some cards don\'t have current pricing available and aren\'t included in the total.</small></p>' : ''}
      <div class="info-list">${rowsHtml}</div>
    `;

    listWrap.querySelectorAll('.remove-card-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await client().from(cfg.table).delete().eq('id', btn.dataset.rowId);
        renderYourList(user, mode);
      });
    });
  }

  // ---- Page shells ----
  function renderSignedOut(){
    const el = root();
    if(!el) return;
    el.innerHTML = `
      <section class="hero">
        <div class="eyebrow">My Cards</div>
        <h1>Sign In To Get Started</h1>
        <p>Create a free account to track cards you own and cards you're looking for, each with a running estimated value.</p>
        <p><a class="primary-btn" href="?page=account" data-route="account">Sign In / Create Account</a></p>
      </section>
    `;
  }

  async function renderSignedIn(user, mode='collection'){
    const el = root();
    if(!el) return;
    const cfg = LIST_CONFIG[mode];

    el.innerHTML = `
      <section class="hero">
        <div class="eyebrow">My Cards</div>
        <div class="form-actions" style="margin-top:6px">
          <button type="button" data-tab="collection" class="${mode === 'collection' ? 'primary-btn' : 'ghost-btn'}">My Collection</button>
          <button type="button" data-tab="wishlist" class="${mode === 'wishlist' ? 'primary-btn' : 'ghost-btn'}">Wish List</button>
        </div>
      </section>

      <section class="hero section">
        <div class="eyebrow">${escapeHtml(cfg.tabLabel)}</div>
        <h1>${escapeHtml(cfg.addTitle)}</h1>
        <form id="card-search-form" class="form-grid">
          <label>Card Name<input name="term" placeholder="${escapeHtml(cfg.searchPlaceholder)}" required></label>
          <div class="form-actions">
            <button class="primary-btn" type="submit">Search</button>
            <button type="button" id="scan-card-btn" class="ghost-btn">📷 Scan a Card</button>
          </div>
        </form>
        <input type="file" id="scan-card-input" accept="image/*" capture="environment" style="display:none">
        <div id="card-search-results" style="margin-top:12px"></div>
      </section>

      <section class="hero section">
        <div class="eyebrow">${escapeHtml(cfg.yourEyebrow)}</div>
        <h1>${escapeHtml(cfg.yourTitle)}</h1>
        <div id="collection-list-wrap"></div>
        <p style="margin-top:14px"><small style="color:var(--muted)">* Card values shown are estimated market prices from <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a> (sourced from TCGplayer data), for reference only. Prices change often and are not set, guaranteed, or offered by Infinite Pulls.</small></p>
      </section>
    `;

    el.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        if(btn.dataset.tab !== mode) renderSignedIn(user, btn.dataset.tab);
      });
    });

    document.getElementById('card-search-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const term = e.target.elements.term.value.trim();
      const resultsEl = document.getElementById('card-search-results');
      if(!term) return;
      resultsEl.innerHTML = '<div class="empty-state">Searching…</div>';
      try{
        const cards = await searchCards(term);
        renderSearchResults(cards, user, () => renderYourList(user, mode), mode);
      }catch(err){
        resultsEl.innerHTML = `<div class="empty-state">Search failed: ${escapeHtml(err.message)}</div>`;
      }
    });

    document.getElementById('scan-card-btn')?.addEventListener('click', () => {
      document.getElementById('scan-card-input')?.click();
    });
    document.getElementById('scan-card-input')?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if(file) handleScanFile(file, user, mode, () => renderYourList(user, mode));
    });

    renderYourList(user, mode);
  }

  async function init(){
    const el = root();
    if(!el) return;
    if(!window.InfinitePullsSupabase || !window.InfinitePullsSupabase.ready){
      el.innerHTML = `<section class="hero"><div class="eyebrow">My Cards</div><h1>Not connected yet</h1><p>Connect Supabase in config.js to enable accounts and collections.</p></section>`;
      return;
    }

    const { data: { session } } = await client().auth.getSession();
    if(session) await renderSignedIn(session.user, 'collection');
    else renderSignedOut();
  }

  window.InfinitePullsCollection = { init };
})();
