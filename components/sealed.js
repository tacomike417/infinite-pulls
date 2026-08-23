// Sealed product — booster boxes, ETBs, blisters, bundles, tins — as a
// third tab beside My Collection and Wish List.
//
// WHERE THE PRODUCTS COME FROM, which differs by language and was settled
// by probing the real APIs rather than reading their docs:
//
//   English — a real catalogue from PokemonPriceTracker, by way of
//     supabase/functions/sealed-price. Real TCGplayer product ids, real
//     product photos, real market prices. Surging Sparks alone has 26
//     products, including several nothing template-shaped would ever
//     produce: Half Booster Box, Sleeved Booster Pack Case, Single Pack
//     Blister [Wooper], a Pokemon Center exclusive ETB.
//
//   Japanese — that same API returns ZERO sealed products for every
//     Japanese query; their Japanese coverage is cards only. So Japanese
//     products are derived (set x product type) and priced from eBay,
//     which is thinner, and the tab says so instead of pretending.
//
// The browser never talks to either pricing API and never holds a key.
// It reads the shared public.sealed_products table, and asks the edge
// function to fill in anything missing or stale.
(function(){
  'use strict';

  const TCGDEX_ROOT = 'https://api.tcgdex.net/v2';

  const LANGUAGES = {
    en: { code: 'en', short: 'EN', label: 'English',  native: 'English' },
    ja: { code: 'ja', short: 'JP', label: 'Japanese', native: '日本語' },
  };

  const CONDITIONS = ['Sealed', 'Sealed — damaged box', 'Opened'];

  function client(){
    return window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  }

  function escapeHtml(value=''){
    return String(value).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[m]));
  }

  function currency(n){
    return typeof n === 'number' && isFinite(n) ? '$' + n.toFixed(2) : null;
  }

  function langOf(value){
    return LANGUAGES[value] ? value : 'en';
  }

  // ---- the set list ----------------------------------------------------
  // One request per language, ever. The list arrives in release order
  // (Base Set first, newest last) and the brief set objects carry NO
  // release date — only the per-set detail endpoint does — so position in
  // this list is the only free way to sort by recency.
  const setListPromises = {};
  function loadSets(lang){
    lang = langOf(lang);
    if(setListPromises[lang]) return setListPromises[lang];
    setListPromises[lang] = (async () => {
      const res = await fetch(`${TCGDEX_ROOT}/${lang}/sets`);
      if(!res.ok) throw new Error('Set list is unavailable right now');
      const sets = await res.json();
      if(!Array.isArray(sets)) return [];
      return sets
        .filter(s => s && s.id && s.name)
        .map((s, i) => ({ id: s.id, name: s.name, logo: s.logo || null, order: i, lang }));
    })();
    setListPromises[lang].catch(() => { setListPromises[lang] = null; });
    return setListPromises[lang];
  }

  // Newest first: a shop cares about what's on the shelf far more than
  // about Base Set.
  function matchingSets(sets, term){
    const q = String(term || '').trim().toLowerCase();
    const hits = q
      ? sets.filter(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase() === q)
      : sets;
    return hits.slice().sort((a, b) => b.order - a.order);
  }

  function setLogoUrl(logo){
    return logo ? `${logo}.png` : null;
  }

  // ---- catalogue and prices -------------------------------------------
  // A set's catalogue is fetched once and kept forever — product names
  // and photos don't change, only prices do — because the upstream API
  // bills one credit per product returned. The edge function owns that
  // decision; this just asks and takes what it gets.
  async function catalogForSet(set){
    try{
      const { data, error } = await client().functions.invoke('sealed-price', {
        body: { action: 'catalog', setLabel: set.name, setCode: set.id, lang: set.lang }
      });
      if(error) throw error;
      return Array.isArray(data?.products) ? data.products : [];
    }catch{
      return [];
    }
  }

  // Reads the shared table first, then asks the edge function to refresh
  // only what's missing or stale. Opening the tab twice costs nothing.
  async function pricesFor(productIds){
    const out = {};
    if(!productIds.length) return out;
    try{
      const { data } = await client()
        .from('sealed_products')
        .select('product_id, name, image_url, external_url, price, price_source, is_asking_price, not_found, checked_at')
        .in('product_id', productIds);
      (data || []).forEach(row => {
        out[row.product_id] = {
          productId: row.product_id, name: row.name,
          imageUrl: row.image_url, externalUrl: row.external_url,
          price: row.price === null ? null : Number(row.price),
          priceSource: row.price_source, isAskingPrice: !!row.is_asking_price,
          notFound: !!row.not_found, checkedAt: row.checked_at,
        };
      });
    }catch{ /* the refresh below still runs */ }

    const DAY = 24 * 60 * 60 * 1000;
    const stale = productIds.filter(id => {
      const hit = out[id];
      if(!hit) return true;
      const age = Date.now() - new Date(hit.checkedAt || 0).getTime();
      return hit.notFound ? age > 14 * DAY : age > DAY;
    });

    if(stale.length){
      try{
        const { data } = await client().functions.invoke('sealed-price', {
          body: { action: 'prices', productIds: stale.slice(0, 40) }
        });
        (data?.prices || []).forEach(p => { out[p.productId] = p; });
      }catch{ /* whatever was cached still renders */ }
    }
    return out;
  }

  // A price always says which market it came from, because a TCGplayer
  // market price and an eBay asking price are not the same claim.
  function priceLabelHtml(price){
    if(!price || typeof price.price !== 'number'){
      return '<small style="color:var(--muted)">No price found</small>';
    }
    const amount = escapeHtml(currency(price.price));
    if(price.priceSource === 'ebay'){
      return `<strong>${amount}</strong> <small style="color:var(--muted)">eBay asking</small>`;
    }
    return `<strong>${amount}</strong> <small style="color:var(--muted)">market</small>`;
  }

  // ---- what somebody owns ---------------------------------------------
  async function fetchOwned(userId){
    const { data, error } = await client()
      .from('user_sealed')
      .select('id, product_id, product_name, set_label, card_lang, image_url, condition, quantity, added_at')
      .eq('user_id', userId)
      .order('added_at', { ascending: false });
    if(error) throw new Error(error.message);
    return data || [];
  }

  // The number My Collection folds into its Estimated Total Value. Only
  // ever counts a real dollar figure — a box with no price adds nothing
  // rather than being guessed at, and the caller is told so it can say so.
  function sumOwned(rows, prices){
    let total = 0, anyMissing = false;
    (rows || []).forEach(row => {
      const p = prices[row.product_id];
      if(p && typeof p.price === 'number') total += p.price * (Number(row.quantity) || 1);
      else anyMissing = true;
    });
    return { total: Math.round(total * 100) / 100, anyMissing };
  }

  async function totalValueFor(userId){
    try{
      const rows = await fetchOwned(userId);
      if(!rows.length) return { total: 0, count: 0, anyMissing: false };
      const prices = await pricesFor([...new Set(rows.map(r => r.product_id))]);
      return { ...sumOwned(rows, prices), count: rows.length };
    }catch{
      return { total: 0, count: 0, anyMissing: false };
    }
  }


  // ---- the tab ---------------------------------------------------------
  // Two steps: pick the set, then pick the product. A flat list of every
  // product of every set would be thousands of rows, and it would also
  // mean paying to catalogue sets nobody ever opens. This way a set costs
  // its credits once, the first time somebody looks at it.
  let sealedLang = 'en';
  let openSet = null;
  let sealedUser = null;
  let onSealedChanged = null;

  function byId(id){ return document.getElementById(id); }

  async function renderSealedTab(container, user, onChanged){
    sealedUser = user;
    onSealedChanged = onChanged || (() => {});

    container.innerHTML = `
      <section class="hero section">
        <div class="eyebrow">Sealed</div>
        <h1>Add Sealed Product</h1>
        <div class="lang-switch" role="group" aria-label="Product language">
          ${Object.keys(LANGUAGES).map(code => {
            const on = code === sealedLang;
            return `<button type="button" data-sealed-lang="${code}" class="${on ? 'primary-btn' : 'ghost-btn'}" aria-pressed="${on}">${escapeHtml(LANGUAGES[code].label)}${code === 'ja' ? ` <span class="lang-native">${escapeHtml(LANGUAGES.ja.native)}</span>` : ''}</button>`;
          }).join('')}
        </div>
        <form id="sealed-search-form" class="form-grid" onsubmit="return false">
          <label>Set<input name="term" placeholder="e.g. Surging Sparks, Evolving Skies" autocomplete="off"></label>
          <p><small style="color:var(--muted)">${sealedLang === 'ja'
            ? 'Japanese sealed has no market-price source, so prices here come from live eBay listings and some products won\'t have one.'
            : 'Pick the set, then the product. Newest sets first.'}</small></p>
        </form>
        <div id="sealed-results" style="margin-top:12px"></div>
      </section>

      <section class="hero section">
        <div class="eyebrow">Your Sealed</div>
        <h1 style="margin-bottom:8px">Boxes &amp; Packs</h1>
        <div id="sealed-list"></div>
        <p style="margin-top:14px"><small style="color:var(--muted)">* Anything marked <strong>market</strong> is a TCGplayer market price. Anything marked <strong>eBay asking</strong> is what live listings are priced at right now — not what anything sold for.</small></p>
      </section>
    `;

    container.querySelectorAll('[data-sealed-lang]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = langOf(btn.dataset.sealedLang);
        if(next === sealedLang) return;
        sealedLang = next;
        openSet = null;
        renderSealedTab(container, user, onChanged);
      });
    });

    const form = byId('sealed-search-form');
    // Filtering as you type: the set list is already in memory, so there
    // is nothing to wait for and no request to make.
    form?.elements.term.addEventListener('input', (e) => { openSet = null; runSetSearch(e.target.value); });

    runSetSearch('');
    renderOwned();
  }

  async function runSetSearch(term){
    const results = byId('sealed-results');
    if(!results) return;
    results.innerHTML = '<div class="empty-state">Loading sets…</div>';

    let sets;
    try{ sets = await loadSets(sealedLang); }
    catch(err){ results.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`; return; }

    const hits = matchingSets(sets, term).slice(0, 40);
    if(!hits.length){
      results.innerHTML = `<div class="empty-state">No ${escapeHtml(LANGUAGES[sealedLang].label)} set matches that.</div>`;
      return;
    }

    results.innerHTML = `
      <p><small style="color:var(--muted)">${hits.length}${hits.length === 40 ? '+' : ''} set${hits.length === 1 ? '' : 's'} — tap one to see its sealed products.</small></p>
      <div class="sealed-set-list">
        ${hits.map(s => `
          <button type="button" class="sealed-set-row" data-set-id="${escapeHtml(s.id)}">
            ${setLogoUrl(s.logo) ? `<img src="${escapeHtml(setLogoUrl(s.logo))}" alt="" loading="lazy">` : '<span class="sealed-set-nologo"></span>'}
            <span class="sealed-set-name">${escapeHtml(s.name)}</span>
            <span class="sealed-set-id">${escapeHtml(s.id)}</span>
          </button>
        `).join('')}
      </div>
    `;

    results.querySelectorAll('.sealed-set-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const set = hits.find(s => s.id === btn.dataset.setId);
        if(set) showProductsForSet(set);
      });
    });
  }

  async function showProductsForSet(set){
    openSet = set;
    const results = byId('sealed-results');
    if(!results) return;
    results.innerHTML = '<div class="empty-state">Looking up this set’s products…</div>';

    const products = await catalogForSet(set);
    if(openSet !== set) return;  // a different set was tapped while we waited

    if(!products.length){
      results.innerHTML = `
        <button type="button" id="sealed-back" class="ghost-btn" style="margin-bottom:10px">← Back to sets</button>
        <div class="empty-state">No sealed products found for ${escapeHtml(set.name)}. Older sets and Japanese sets often aren't catalogued.</div>
      `;
      byId('sealed-back')?.addEventListener('click', backToSets);
      return;
    }

    const prices = await pricesFor(products.map(p => p.productId));
    if(openSet !== set) return;

    // Priced products first — an unpriced row is usually something that
    // was never made, and it shouldn't sit above a real box.
    const ordered = products.slice().sort((a, b) => {
      const pa = prices[a.productId]?.price, pb = prices[b.productId]?.price;
      if(typeof pa === 'number' && typeof pb !== 'number') return -1;
      if(typeof pb === 'number' && typeof pa !== 'number') return 1;
      if(typeof pa === 'number' && typeof pb === 'number') return pb - pa;
      return a.name.localeCompare(b.name);
    });

    results.innerHTML = `
      <button type="button" id="sealed-back" class="ghost-btn" style="margin-bottom:10px">← Back to sets</button>
      <h3 style="margin:0 0 8px; font-size:1rem;">${escapeHtml(set.name)}${set.lang === 'ja' ? ` <span class="lang-tag">${escapeHtml(LANGUAGES.ja.native)}</span>` : ''}</h3>
      <div class="sealed-product-list">
        ${ordered.map(p => {
          const price = prices[p.productId] || p;
          const unpriced = typeof price.price !== 'number';
          const image = price.imageUrl || p.imageUrl;
          return `
            <div class="sealed-product-row${unpriced ? ' is-unpriced' : ''}">
              ${image ? `<img class="sealed-product-img" src="${escapeHtml(image)}" alt="" loading="lazy">` : '<span class="sealed-product-img sealed-product-noimg"></span>'}
              <span class="sealed-product-name">${escapeHtml(p.name)}</span>
              <span class="sealed-product-price">${priceLabelHtml(price)}</span>
              <button type="button" class="ghost-btn sealed-add-btn" data-product-id="${escapeHtml(p.productId)}">Add</button>
            </div>
          `;
        }).join('')}
      </div>
      <div id="sealed-add-form"></div>
    `;

    byId('sealed-back')?.addEventListener('click', backToSets);
    results.querySelectorAll('.sealed-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const product = ordered.find(p => p.productId === btn.dataset.productId);
        if(product) showAddForm(product, prices[product.productId] || product, set);
      });
    });
  }

  function backToSets(){
    openSet = null;
    runSetSearch(byId('sealed-search-form')?.elements.term.value || '');
  }

  function showAddForm(product, price, set){
    const wrap = byId('sealed-add-form');
    if(!wrap) return;
    wrap.innerHTML = `
      <form class="form-grid" id="sealed-add" style="margin-top:14px; border-top:1px solid var(--border); padding-top:14px;">
        <strong>${escapeHtml(product.name)}</strong>
        <p style="margin:2px 0 0">${priceLabelHtml(price)}</p>
        <label>Condition
          <select name="condition">${CONDITIONS.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>
        </label>
        <label>How many<input name="quantity" type="number" min="1" max="999" value="1"></label>
        <div class="form-actions">
          <button class="primary-btn" type="submit">Add to Sealed</button>
          <button type="button" class="ghost-btn" id="sealed-add-cancel">Cancel</button>
        </div>
      </form>
    `;
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    byId('sealed-add-cancel')?.addEventListener('click', () => { wrap.innerHTML = ''; });

    byId('sealed-add')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = e.target.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Adding…';
      const condition = e.target.elements.condition.value;
      const quantity = Math.max(1, Math.min(999, parseInt(e.target.elements.quantity.value, 10) || 1));
      const message = await addSealed(product, price, set, condition, quantity);
      button.disabled = false;
      button.textContent = message;
      if(message.startsWith('Added')){
        setTimeout(() => { wrap.innerHTML = ''; renderOwned(); onSealedChanged(); }, 500);
      }
    });
  }

  // A duplicate holding is refused by a unique index in the database, not
  // merely avoided here, so a double-tap bumps the quantity instead of
  // quietly creating a second identical line.
  async function addSealed(product, price, set, condition, quantity){
    try{
      const { data: existing } = await client()
        .from('user_sealed')
        .select('id, quantity')
        .eq('user_id', sealedUser.id)
        .eq('product_id', product.productId)
        .eq('condition', condition)
        .limit(1);

      if(existing && existing.length){
        const next = (Number(existing[0].quantity) || 0) + quantity;
        const { error } = await client().from('user_sealed').update({ quantity: next }).eq('id', existing[0].id);
        return error ? 'Could not add — try again' : `Added — you now have ${next}`;
      }

      const { error } = await client().from('user_sealed').insert({
        user_id: sealedUser.id,
        product_id: product.productId,
        // Name, set and picture are copied onto the row, not only joined
        // from the catalogue, so this still reads right if a product is
        // ever renamed or dropped upstream.
        product_name: product.name,
        set_label: product.setLabel || set.name,
        card_lang: langOf(product.lang || set.lang),
        image_url: price?.imageUrl || product.imageUrl || setLogoUrl(set.logo),
        condition, quantity,
      });
      return error ? 'Could not add — try again' : 'Added!';
    }catch{
      return 'Could not add — try again';
    }
  }

  async function renderOwned(){
    const list = byId('sealed-list');
    if(!list) return;
    list.innerHTML = '<div class="empty-state">Loading…</div>';

    let rows;
    try{ rows = await fetchOwned(sealedUser.id); }
    catch(err){ list.innerHTML = `<div class="empty-state">Could not load this: ${escapeHtml(err.message)}</div>`; return; }

    if(!rows.length){
      list.innerHTML = '<div class="empty-state">No sealed product yet — find a set above to add your first box.</div>';
      return;
    }

    const prices = await pricesFor([...new Set(rows.map(r => r.product_id))]);
    const { total, anyMissing } = sumOwned(rows, prices);

    list.innerHTML = `
      <div class="info-row" style="font-size:1.05rem"><span>Sealed Value *</span><strong>${escapeHtml(currency(total))}</strong></div>
      ${anyMissing ? '<p><small style="color:var(--muted)">Some sealed product has no price available and isn\'t counted above.</small></p>' : ''}
      ${rows.map(row => {
        const price = prices[row.product_id];
        const qty = Number(row.quantity) || 1;
        const line = price && typeof price.price === 'number' ? price.price * qty : null;
        return `
          <div class="info-row sealed-owned-row">
            <span style="display:flex; align-items:center; gap:10px; min-width:0;">
              ${row.image_url ? `<img src="${escapeHtml(row.image_url)}" alt="" loading="lazy" class="sealed-owned-logo">` : ''}
              <span style="min-width:0">
                <strong style="display:block">${escapeHtml(row.product_name)}</strong>
                <small style="color:var(--muted)">${escapeHtml(row.condition)}${qty > 1 ? ` · ${qty}×` : ''}${langOf(row.card_lang) === 'ja' ? ` · ${escapeHtml(LANGUAGES.ja.native)}` : ''}</small>
              </span>
            </span>
            <span style="display:flex; align-items:center; gap:12px;">
              <span>${line === null ? '<small style="color:var(--muted)">No price</small>' : `<strong>${escapeHtml(currency(line))}</strong>`}</span>
              <button type="button" class="sealed-remove-btn" data-row-id="${escapeHtml(row.id)}" aria-label="Remove ${escapeHtml(row.product_name)}">✕</button>
            </span>
          </div>
        `;
      }).join('')}
    `;

    list.querySelectorAll('.sealed-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await client().from('user_sealed').delete().eq('id', btn.dataset.rowId);
        renderOwned();
        onSealedChanged();
      });
    });
  }

  window.InfinitePullsSealed = {
    LANGUAGES, CONDITIONS,
    loadSets, matchingSets, setLogoUrl, langOf, currency,
    catalogForSet, pricesFor, priceLabelHtml,
    fetchOwned, sumOwned, totalValueFor,
    renderSealedTab,
  };
})();
