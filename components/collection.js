(function(){
  const CONDITIONS = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];
  const VARIANT_LABELS = {
    normal: 'Normal',
    holofoil: 'Holofoil',
    reverseHolofoil: 'Reverse Holofoil',
    '1stEditionNormal': '1st Edition',
    '1stEditionHolofoil': '1st Edition Holofoil',
    unlimited: 'Unlimited',
    unlimitedHolofoil: 'Unlimited Holofoil'
  };

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

  function pokemonHeaders(){
    const key = window.InfinitePullsSupabase?.config?.POKEMONTCG_API_KEY;
    return key ? { 'X-Api-Key': key } : {};
  }

  function currency(n){
    return typeof n === 'number' ? '$' + n.toFixed(2) : null;
  }

  // ---- pokemontcg.io lookups ----
  async function searchCards(term){
    const q = encodeURIComponent(`name:${term.replace(/["():]/g, ' ').trim()}*`);
    const res = await fetch(`https://api.pokemontcg.io/v2/cards?q=${q}&pageSize=12&orderBy=name`, { headers: pokemonHeaders() });
    if(!res.ok) throw new Error('Search failed (' + res.status + ')');
    const json = await res.json();
    return json.data || [];
  }

  async function fetchCardsByIds(ids){
    const unique = [...new Set(ids)];
    const chunks = [];
    for(let i = 0; i < unique.length; i += 20) chunks.push(unique.slice(i, i + 20));

    const byId = {};
    for(const chunk of chunks){
      const q = encodeURIComponent(chunk.map(id => `id:${id}`).join(' OR '));
      const res = await fetch(`https://api.pokemontcg.io/v2/cards?q=${q}&pageSize=${chunk.length}`, { headers: pokemonHeaders() });
      if(!res.ok) continue;
      const json = await res.json();
      (json.data || []).forEach(card => { byId[card.id] = card; });
    }
    return byId;
  }

  function variantOptions(card){
    const prices = card?.tcgplayer?.prices || {};
    const keys = Object.keys(prices);
    if(!keys.length) return [{ value: 'normal', label: 'Normal (no pricing available)', market: null }];
    return keys.map(key => ({
      value: key,
      label: (VARIANT_LABELS[key] || key) + (typeof prices[key].market === 'number' ? ` — ${currency(prices[key].market)}` : ' (no market price)'),
      market: typeof prices[key].market === 'number' ? prices[key].market : null
    }));
  }

  // ---- Add-a-card search UI ----
  function renderSearchResult(card){
    const options = variantOptions(card);
    return `
      <div class="card section" data-card-result="${escapeHtml(card.id)}">
        <div style="display:flex; gap:12px;">
          ${card.images?.small ? `<img src="${escapeHtml(card.images.small)}" alt="" style="width:56px;height:78px;object-fit:contain;flex:0 0 auto;">` : ''}
          <div style="flex:1 1 auto; min-width:0;">
            <strong>${escapeHtml(card.name)}</strong>
            <small style="display:block">${escapeHtml(card.set?.name || '')}</small>
          </div>
        </div>
        <form class="form-grid add-card-form" data-card-id="${escapeHtml(card.id)}" style="margin-top:10px">
          <label>Variant
            <select name="variant">
              ${options.map(o => `<option value="${escapeHtml(o.value)}" data-market="${o.market ?? ''}">${escapeHtml(o.label)}</option>`).join('')}
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
  }

  function wireSearchForms(user, onAdded){
    document.querySelectorAll('.add-card-form').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const cardId = form.dataset.cardId;
        const cardEl = form.closest('[data-card-result]');
        const cardName = cardEl.querySelector('strong').textContent;
        const setName = cardEl.querySelector('small').textContent;
        const imageEl = cardEl.querySelector('img');
        const variant = form.elements.variant.value;
        const condition = form.elements.condition.value;
        const quantity = Math.max(1, parseInt(form.elements.quantity.value, 10) || 1);

        const button = form.querySelector('button');
        button.disabled = true;
        button.textContent = 'Adding…';

        const { error } = await client().from('user_cards').insert({
          user_id: user.id,
          card_id: cardId,
          card_name: cardName,
          set_name: setName,
          image_url: imageEl ? imageEl.src : null,
          variant, condition, quantity
        });

        button.disabled = false;
        button.textContent = error ? 'Could not add — try again' : 'Added!';
        if(!error) setTimeout(onAdded, 400);
      });
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

    let priceByCardId = {};
    try{
      priceByCardId = await fetchCardsByIds(rows.map(r => r.card_id));
    }catch{ /* live pricing just won't show below — the rest of the list still works */ }

    let total = 0;
    let anyMissing = false;

    const rowsHtml = rows.map(row => {
      const liveCard = priceByCardId[row.card_id];
      const market = liveCard?.tcgplayer?.prices?.[row.variant]?.market;
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
        <span>Estimated Total Value</span>
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
        resultsEl.innerHTML = cards.length
          ? cards.map(renderSearchResult).join('')
          : '<div class="empty-state">No cards found — try a different spelling.</div>';
        wireSearchForms(user, () => renderYourCollection(user));
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
