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

  async function searchCards(term){
    const cleaned = term.trim();
    if(!cleaned) return [];
    try{
      const json = await fetchTcgdex(`${TCGDEX_BASE}/cards?name=${encodeURIComponent(cleaned)}`);
      return Array.isArray(json) ? json.slice(0, 20) : [];
    }catch{
      throw new Error('Card search is having trouble right now — try again in a moment.');
    }
  }

  async function fetchCardDetail(id){
    return await fetchTcgdex(`${TCGDEX_BASE}/cards/${encodeURIComponent(id)}`);
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
  function renderSearchResults(cards, user, onAdded){
    const resultsEl = document.getElementById('card-search-results');
    if(!resultsEl) return;

    if(!cards.length){
      resultsEl.innerHTML = '<div class="empty-state">No cards found — try a different spelling.</div>';
      return;
    }

    resultsEl.innerHTML = `
      <p><small>Tap a card to choose its variant, condition, and quantity.</small></p>
      <div class="card-grid">
        ${cards.map(c => `
          <button type="button" class="card search-result-btn" data-card-id="${escapeHtml(c.id)}" style="text-align:left; cursor:pointer;">
            ${c.image
              ? `<img src="${escapeHtml(thumbUrl(c.image))}" alt="" style="width:100%;aspect-ratio:245/337;object-fit:contain;margin-bottom:8px;">`
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
          showAddForm(card, user, onAdded);
        }catch(err){
          detailEl.innerHTML = `<div class="empty-state">${escapeHtml(err.message || 'Could not load that card — try again.')}</div>`;
        }
      });
    });
  }

  function showAddForm(card, user, onAdded){
    const detailEl = document.getElementById('card-picker-detail');
    if(!detailEl) return;
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
          <label>Condition
            <select name="condition">
              ${CONDITIONS.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
            </select>
          </label>
          <label>Quantity<input type="number" name="quantity" value="1" min="1" style="width:100%"></label>
          <div class="form-actions"><button class="primary-btn" type="submit">Add to Collection</button></div>
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

      const { error } = await client().from('user_cards').insert({
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

  // ---- Your collection list ----
  async function renderYourCollection(user){
    const listWrap = document.getElementById('collection-list-wrap');
    if(!listWrap) return;
    listWrap.innerHTML = '<div class="empty-state">Loading your collection…</div>';

    const { data: rows, error } = await client()
      .from('user_cards')
      .select('id, card_id, card_name, set_name, image_url, variant, condition, quantity, added_at')
      .eq('user_id', user.id)
      .order('added_at', { ascending: false });

    if(error){ listWrap.innerHTML = `<div class="empty-state">Could not load your collection: ${escapeHtml(error.message)}</div>`; return; }
    if(!rows.length){ listWrap.innerHTML = '<div class="empty-state">No cards yet — search above to add your first one.</div>'; return; }

    // One fetch per unique card (pricing only lives on the full-card
    // endpoint, not the list endpoint) — run them together since TCGdex
    // has no rate limit to worry about for a single visitor's collection.
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
        <span>Estimated Total Value *</span>
        <strong style="font-size:1.3rem">${currency(total)}</strong>
      </div>
      ${anyMissing ? '<p><small>Some cards don\'t have current pricing available and aren\'t included in the total.</small></p>' : ''}
      <div class="info-list">${rowsHtml}</div>
    `;

    listWrap.querySelectorAll('.remove-card-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await client().from('user_cards').delete().eq('id', btn.dataset.rowId);
        renderYourCollection(user);
      });
    });
  }

  // ---- Page shells ----
  function renderSignedOut(){
    const el = root();
    if(!el) return;
    el.innerHTML = `
      <section class="hero">
        <div class="eyebrow">My Collection</div>
        <h1>Sign In To Get Started</h1>
        <p>Create a free account to add cards, track their condition, and see your collection's total value.</p>
        <p><a class="primary-btn" href="?page=account" data-route="account">Sign In / Create Account</a></p>
      </section>
    `;
  }

  async function renderSignedIn(user){
    const el = root();
    if(!el) return;
    el.innerHTML = `
      <section class="hero">
        <div class="eyebrow">My Collection</div>
        <h1>Add a Card</h1>
        <form id="card-search-form" class="form-grid">
          <label>Card Name<input name="term" placeholder="e.g. Charizard" required></label>
          <div class="form-actions"><button class="primary-btn" type="submit">Search</button></div>
        </form>
        <div id="card-search-results" style="margin-top:12px"></div>
      </section>

      <section class="hero section">
        <div class="eyebrow">Your Collection</div>
        <h1>Your Cards</h1>
        <div id="collection-list-wrap"></div>
        <p style="margin-top:14px"><small style="color:var(--muted)">* Card values shown are estimated market prices from <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a> (sourced from TCGplayer data), for reference only. Prices change often and are not set, guaranteed, or offered by Infinite Pulls.</small></p>
      </section>
    `;

    document.getElementById('card-search-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const term = e.target.elements.term.value.trim();
      const resultsEl = document.getElementById('card-search-results');
      if(!term) return;
      resultsEl.innerHTML = '<div class="empty-state">Searching…</div>';
      try{
        const cards = await searchCards(term);
        renderSearchResults(cards, user, () => renderYourCollection(user));
      }catch(err){
        resultsEl.innerHTML = `<div class="empty-state">Search failed: ${escapeHtml(err.message)}</div>`;
      }
    });

    renderYourCollection(user);
  }

  async function init(){
    const el = root();
    if(!el) return;
    if(!window.InfinitePullsSupabase || !window.InfinitePullsSupabase.ready){
      el.innerHTML = `<section class="hero"><div class="eyebrow">My Collection</div><h1>Not connected yet</h1><p>Connect Supabase in config.js to enable accounts and collections.</p></section>`;
      return;
    }

    const { data: { session } } = await client().auth.getSession();
    if(session) await renderSignedIn(session.user);
    else renderSignedOut();
  }

  window.InfinitePullsCollection = { init };
})();
