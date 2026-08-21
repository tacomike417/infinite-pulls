// My Pokédex — a main section of the app (see components/navbar.js),
// entirely DERIVED from My Collection. There is no separate table a
// visitor maintains here: every screen in this file is computed, live,
// from their own `user_cards` rows (via components/pokemon-data.js,
// shared with the small "About [Pokémon]" section on card detail views
// — see components/pokemon-info.js) crossed with PokéAPI. Add a card to
// My Collection, and whatever Pokémon it represents is "discovered" here
// automatically; remove every card representing that Pokémon, and it
// stops being discovered. Nothing here is ever hand-edited.
//
// Performance (see also components/pokemon-data.js's own header comment,
// and the note above computeDeepStats() below): opening My Pokédex costs
// exactly two network requests the first time in a session — the whole
// national species roster (one bulk call) and the visitor's own
// collection rows (one query) — plus one small request per sprite image,
// lazily loaded. Everything else (a Pokémon's full detail, a type's full
// membership list, evolution-family completion) is fetched only when
// actually needed and cached from then on.
(function(){
  'use strict';

  function pd(){ return window.InfinitePullsPokemonData; }
  function client(){ return window.InfinitePullsSupabase && window.InfinitePullsSupabase.client; }
  function root(){ return document.getElementById('pokedex-page'); }

  function escapeHtml(value=''){
    return String(value).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[m]));
  }

  // ---- Page-lifetime state (persists across My Collection ↔ My Pokédex
  // navigation within this SPA — see app.js — since nothing here reloads
  // the page) ----
  let currentUser = null;
  let allSpecies = [];               // [{id, name}], National Dex order
  let discoveredMap = {};            // { [dexId]: {discovered, cardCount} }
  let ownedRows = [];                // this visitor's My Collection rows
  let filterMode = 'all';            // 'all' | 'discovered' | 'missing'
  let rangeFilter = null;            // { min, max, label } | null
  let typeFilter = null;             // a TYPE_LIST key | null
  let searchQuery = '';
  let deepStats = null;              // filled in by computeDeepStats() on demand
  let deepStatsPromise = null;

  // ---- Data loading / recompute ----
  async function loadData(user){
    const [species, rows] = await Promise.all([
      pd().loadAllSpecies(),
      pd().fetchOwnedCollectionRows(user.id),
    ]);
    allSpecies = species;
    ownedRows = rows;
    discoveredMap = pd().computeDiscoveredMap(allSpecies, ownedRows);
  }

  function discoveredCount(){
    return allSpecies.filter(s => discoveredMap[s.id]?.discovered).length;
  }

  // ---- Filtering (all in-memory — no network involved, safe to re-run
  // on every keystroke/filter click) ----
  function getFilteredSpecies(){
    let list = allSpecies;
    if(rangeFilter) list = list.filter(s => s.id >= rangeFilter.min && s.id <= rangeFilter.max);
    if(filterMode === 'discovered') list = list.filter(s => discoveredMap[s.id]?.discovered);
    if(filterMode === 'missing') list = list.filter(s => !discoveredMap[s.id]?.discovered);
    if(typeFilter && typeMembershipSets[typeFilter]) list = list.filter(s => typeMembershipSets[typeFilter].has(s.id));
    const q = searchQuery.trim().toLowerCase();
    if(q){
      const asNumber = /^\d+$/.test(q) ? parseInt(q, 10) : null;
      list = list.filter(s => asNumber !== null ? s.id === asNumber : pd().displayName(s.name).toLowerCase().includes(q));
    }
    return list;
  }

  // Resolved membership Sets for any type the visitor has actually
  // selected in the filter this session (see setTypeFilter) — kept
  // separate from the async loadTypeMembership cache in pokemon-data.js
  // so getFilteredSpecies() above can stay perfectly synchronous.
  const typeMembershipSets = {};

  // ---- Rendering ----
  function renderSignedOut(){
    const el = root();
    if(!el) return;
    el.innerHTML = `
      <section class="hero">
        <div class="eyebrow">My Pokédex</div>
        <h1>Sign In To Get Started</h1>
        <p>My Pokédex tracks which Pokémon your My Collection cards represent — sign in to see yours start filling in.</p>
        <p><a class="primary-btn" href="?page=account" data-route="account">Sign In / Create Account</a></p>
      </section>
    `;
  }

  function renderNotConnected(){
    const el = root();
    if(!el) return;
    el.innerHTML = `<section class="hero"><div class="eyebrow">My Pokédex</div><h1>Not connected yet</h1><p>Connect Supabase in config.js to enable accounts and collections.</p></section>`;
  }

  function progressBarHtml(count, total, label){
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
      <div class="pokedex-progress-row">
        <span>${escapeHtml(label)}</span>
        <strong>${count} / ${total}</strong>
      </div>
      <div class="pokedex-progress-bar"><div class="pokedex-progress-fill" style="width:${pct}%"></div></div>
      <p class="pokedex-progress-pct">${pct}% COMPLETE</p>
    `;
  }

  function spriteImgHtml(dexId, discovered, extraClass){
    const artwork = pd().spriteUrl(dexId, { artwork: true });
    const small = pd().spriteUrl(dexId, { artwork: false });
    return `<img src="${escapeHtml(artwork)}" data-fallback="${escapeHtml(small)}" alt="" loading="lazy" class="poke-sprite-img ${extraClass || ''} ${discovered ? 'poke-sprite-discovered' : 'poke-sprite-missing'}">`;
  }

  function renderGridHtml(){
    const filtered = getFilteredSpecies();
    if(!filtered.length){
      return `<div class="empty-state">No Pokémon match this search/filter.</div>`;
    }
    return `
      <div class="pokedex-grid">
        ${filtered.map(s => {
          const info = discoveredMap[s.id] || { discovered: false, cardCount: 0 };
          return `
            <button type="button" class="pokedex-tile ${info.discovered ? 'pokedex-tile-discovered' : 'pokedex-tile-missing'}" data-dex-id="${s.id}">
              ${spriteImgHtml(s.id, info.discovered)}
              <span class="pokedex-tile-num">#${String(s.id).padStart(3, '0')}</span>
              <span class="pokedex-tile-name">${escapeHtml(pd().displayName(s.name))}</span>
              <span class="pokedex-tile-mark">${info.discovered ? '✅' : '?'}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderGrid(){
    const gridEl = document.getElementById('pokedex-grid-wrap');
    if(!gridEl) return;
    gridEl.innerHTML = renderGridHtml();
    pd().attachSpriteFallback(gridEl);
    gridEl.querySelectorAll('.pokedex-tile').forEach(btn => {
      btn.addEventListener('click', () => openDetail(Number(btn.dataset.dexId)));
    });
  }

  function setFilterMode(mode){
    filterMode = mode;
    document.querySelectorAll('#pokedex-filter-bar [data-filter]').forEach(b => {
      b.classList.toggle('primary-btn', b.dataset.filter === mode);
      b.classList.toggle('ghost-btn', b.dataset.filter !== mode);
    });
    renderGrid();
  }

  function setRangeFilter(range){
    rangeFilter = range;
    const label = document.getElementById('pokedex-range-label');
    if(label) label.textContent = range ? `Showing ${range.label} (#${String(range.min).padStart(3,'0')}–#${String(range.max).padStart(3,'0')}) — ` : '';
    const clearBtn = document.getElementById('pokedex-range-clear');
    if(clearBtn) clearBtn.hidden = !range;
    document.getElementById('pokedex-grid-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    renderGrid();
  }

  async function setTypeFilter(typeKey){
    typeFilter = typeKey || null;
    if(typeFilter && !typeMembershipSets[typeFilter]){
      const gridEl = document.getElementById('pokedex-grid-wrap');
      if(gridEl) gridEl.innerHTML = `<div class="empty-state">Loading ${escapeHtml(typeFilter)}-type Pokémon…</div>`;
      try{
        typeMembershipSets[typeFilter] = await pd().loadTypeMembership(typeFilter);
      }catch{
        typeMembershipSets[typeFilter] = new Set();
      }
    }
    renderGrid();
  }

  function renderGenerationsListHtml(){
    return pd().GENERATION_RANGES.map(g => {
      const speciesInGen = allSpecies.filter(s => s.id >= g.min && s.id <= g.max);
      const have = speciesInGen.filter(s => discoveredMap[s.id]?.discovered).length;
      const total = speciesInGen.length || (g.max - g.min + 1);
      const pct = total > 0 ? Math.round((have / total) * 100) : 0;
      return `
        <button type="button" class="pokedex-gen-row" data-gen="${g.key}">
          <span class="pokedex-gen-row-top">
            <strong>${escapeHtml(g.label)}</strong>
            <span>${have} / ${total}</span>
          </span>
          <span class="pokedex-progress-bar pokedex-progress-bar-small"><span class="pokedex-progress-fill" style="width:${pct}%"></span></span>
        </button>
      `;
    }).join('');
  }

  function shellHtml(){
    const total = allSpecies.length || pd().NATIONAL_DEX_MAX;
    const have = discoveredCount();
    const original151 = allSpecies.filter(s => s.id <= 151);
    const have151 = original151.filter(s => discoveredMap[s.id]?.discovered).length;
    const total151 = original151.length || 151;
    const pct151 = total151 > 0 ? Math.round((have151 / total151) * 100) : 0;

    return `
      <section class="hero">
        <div class="eyebrow">My Pokédex</div>
        <h1>MY POKÉDEX</h1>
        <p>${have} Pokémon Discovered</p>
        ${progressBarHtml(have, total, `${have} / ${total} Total Pokémon`)}
        <p><small style="color:var(--muted)">Automatically built from the cards in My Collection — add a card, discover its Pokémon. No manual upkeep.</small></p>
      </section>

      <section class="hero section">
        <div class="eyebrow">Find A Pokémon</div>
        <form id="pokedex-search-form" class="form-grid">
          <label>Search by name or Dex #<input name="q" placeholder="Pikachu or 25" value="${escapeHtml(searchQuery)}"></label>
        </form>
        <div class="form-actions" id="pokedex-filter-bar" style="margin-top:10px;">
          <button type="button" class="primary-btn" data-filter="all">All</button>
          <button type="button" class="ghost-btn" data-filter="discovered">Discovered</button>
          <button type="button" class="ghost-btn" data-filter="missing">Missing</button>
        </div>
        <div class="form-grid" style="margin-top:10px;">
          <label>Generation
            <select id="pokedex-gen-select">
              <option value="">All Generations</option>
              ${pd().GENERATION_RANGES.map(g => `<option value="${g.key}">${escapeHtml(g.label)}</option>`).join('')}
            </select>
          </label>
          <label>Type
            <select id="pokedex-type-select">
              <option value="">All Types</option>
              ${pd().TYPE_LIST.map(t => `<option value="${t.key}">${t.emoji} ${escapeHtml(t.label)}</option>`).join('')}
            </select>
          </label>
        </div>
        <p style="margin-top:8px;"><small id="pokedex-range-label"></small><button type="button" id="pokedex-range-clear" class="ghost-btn" hidden style="padding:4px 10px;">Clear</button></p>
      </section>

      <section class="hero section">
        <button type="button" id="pokedex-original151-card" class="card pokedex-original151-card">
          <div class="eyebrow">Collector Goal</div>
          <strong style="font-size:1.15rem; display:block;">ORIGINAL 151</strong>
          <span>${have151} / ${total151}</span>
          <span class="pokedex-progress-bar"><span class="pokedex-progress-fill" style="width:${pct151}%"></span></span>
          <small>${pct151}% COMPLETE${total151 - have151 > 0 ? ` — only ${total151 - have151} missing` : ' — complete!'}</small>
        </button>
      </section>

      <section class="hero section">
        <div class="eyebrow">National Dex Order</div>
        <div id="pokedex-grid-wrap"></div>
      </section>

      <section class="hero section">
        <div class="eyebrow">Generations</div>
        <h1 style="font-size:1.2rem;">Progress By Generation</h1>
        <div class="pokedex-gen-list">${renderGenerationsListHtml()}</div>
      </section>

      <section class="hero section">
        <div class="eyebrow">Collection Stats</div>
        <h1 style="font-size:1.2rem;">Types &amp; Evolution Families</h1>
        <div id="pokedex-deep-stats">
          <p><small>Type breakdown and evolution-family completion take a little extra PokéAPI lookup work — tap below to calculate them (results are saved for the rest of this visit).</small></p>
          <button type="button" id="pokedex-deep-stats-btn" class="ghost-btn">📊 Calculate Collection Stats</button>
        </div>
      </section>

      <section class="hero section">
        <div class="eyebrow">Collector Achievements</div>
        <h1 style="font-size:1.2rem;">Achievements</h1>
        <div id="pokedex-achievements"></div>
      </section>
    `;
  }

  function wireShellEvents(user){
    document.getElementById('pokedex-search-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      searchQuery = e.target.elements.q.value;
      renderGrid();
    });
    document.getElementById('pokedex-search-form')?.querySelector('input[name="q"]')?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderGrid();
    });
    document.querySelectorAll('#pokedex-filter-bar [data-filter]').forEach(btn => {
      btn.addEventListener('click', () => setFilterMode(btn.dataset.filter));
    });
    document.getElementById('pokedex-gen-select')?.addEventListener('change', (e) => {
      const g = pd().GENERATION_RANGES.find(x => x.key === e.target.value);
      setRangeFilter(g ? { min: g.min, max: g.max, label: g.label } : null);
    });
    document.getElementById('pokedex-type-select')?.addEventListener('change', (e) => {
      setTypeFilter(e.target.value || null);
    });
    document.getElementById('pokedex-range-clear')?.addEventListener('click', () => {
      rangeFilter = null;
      const genSelect = document.getElementById('pokedex-gen-select');
      if(genSelect) genSelect.value = '';
      setRangeFilter(null);
    });
    document.getElementById('pokedex-original151-card')?.addEventListener('click', () => {
      const genSelect = document.getElementById('pokedex-gen-select');
      if(genSelect) genSelect.value = '';
      setRangeFilter({ min: 1, max: 151, label: 'Original 151' });
    });
    document.querySelectorAll('.pokedex-gen-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = pd().GENERATION_RANGES.find(x => x.key === btn.dataset.gen);
        if(!g) return;
        const genSelect = document.getElementById('pokedex-gen-select');
        if(genSelect) genSelect.value = g.key;
        setRangeFilter({ min: g.min, max: g.max, label: g.label });
      });
    });
    document.getElementById('pokedex-deep-stats-btn')?.addEventListener('click', () => runDeepStats(user));

    renderGrid();
    renderAchievements(deepStats ? [...cheapAchievements(), ...deepAchievements(deepStats)] : cheapAchievements(), !deepStats);
  }

  // ---- Achievements ----
  // The first four don't need anything beyond discoveredMap (free,
  // instant); the last two need type/evolution data from
  // computeDeepStats() and show as locked until that's been run once.
  function cheapAchievements(){
    const have = discoveredCount();
    const original151Have = allSpecies.filter(s => s.id <= 151 && discoveredMap[s.id]?.discovered).length;
    return [
      { key: 'first', emoji: '🎉', title: 'FIRST DISCOVERY', desc: 'Discover your first Pokémon.', done: have >= 1 },
      { key: '25', emoji: '⭐', title: '25 DISCOVERED', desc: 'Represent 25 different Pokémon.', done: have >= 25 },
      { key: '100', emoji: '💯', title: 'CENTURY CLUB', desc: 'Represent 100 different Pokémon.', done: have >= 100 },
      { key: 'original151', emoji: '🟡', title: 'ORIGINAL 151', desc: 'Represent all original 151 Pokémon.', done: original151Have >= 151 },
    ];
  }

  function renderAchievements(list, locked){
    const el = document.getElementById('pokedex-achievements');
    if(!el) return;
    el.innerHTML = `
      <div class="pokedex-achv-grid">
        ${list.map(a => `
          <div class="pokedex-achv ${a.done ? 'pokedex-achv-done' : ''}">
            <span class="pokedex-achv-emoji">${a.emoji}</span>
            <strong>${escapeHtml(a.title)}</strong>
            <small>${escapeHtml(a.desc)}</small>
            ${a.done ? '<span class="pokedex-achv-check">✅</span>' : ''}
          </div>
        `).join('')}
        ${locked ? `
          <div class="pokedex-achv pokedex-achv-locked">
            <span class="pokedex-achv-emoji">🔥💧</span>
            <strong>MORE TO UNLOCK</strong>
            <small>Calculate Collection Stats above to check Evolution Master, Fire Collector, and Water Collector.</small>
          </div>
        ` : ''}
      </div>
    `;
  }

  function deepAchievements(stats){
    const fireCount = stats.typeResults.find(t => t.key === 'fire')?.count || 0;
    const waterCount = stats.typeResults.find(t => t.key === 'water')?.count || 0;
    return [
      { key: 'evomaster', emoji: '🧬', title: 'EVOLUTION MASTER', desc: 'Complete 10 evolution families.', done: stats.familiesComplete >= 10 },
      { key: 'fire', emoji: '🔥', title: 'FIRE COLLECTOR', desc: 'Represent 15 Fire-type Pokémon.', done: fireCount >= 15 },
      { key: 'water', emoji: '💧', title: 'WATER COLLECTOR', desc: 'Represent 15 Water-type Pokémon.', done: waterCount >= 15 },
    ];
  }

  // Deliberately NOT run automatically — see the file header and
  // components/pokemon-data.js's performance notes. This is the one part
  // of My Pokédex that needs more than the two initial bulk requests
  // (18 requests for full type membership, plus one small lookup per
  // DISTINCT evolution family among Pokémon actually discovered — never
  // per Pokémon in the whole National Dex), so it only runs when a
  // visitor explicitly asks for it, and the result is cached for the
  // rest of this visit either way.
  async function runDeepStats(user){
    const btn = document.getElementById('pokedex-deep-stats-btn');
    const wrap = document.getElementById('pokedex-deep-stats');
    if(btn){ btn.disabled = true; btn.textContent = 'Calculating…'; }
    if(!deepStatsPromise) deepStatsPromise = computeDeepStats();
    try{
      deepStats = await deepStatsPromise;
    }catch{
      deepStatsPromise = null;
      if(wrap) wrap.innerHTML = `<p><small>Could not calculate stats right now — try again in a moment.</small></p><button type="button" id="pokedex-deep-stats-btn" class="ghost-btn">📊 Calculate Collection Stats</button>`;
      document.getElementById('pokedex-deep-stats-btn')?.addEventListener('click', () => runDeepStats(user));
      return;
    }
    if(wrap){
      wrap.innerHTML = `
        <p>${deepStats.familiesComplete} Evolution ${deepStats.familiesComplete === 1 ? 'Family' : 'Families'} Complete <small style="color:var(--muted)">(of ${deepStats.familiesConsidered} with at least one Pokémon discovered)</small></p>
        <div class="info-list">
          ${deepStats.typeResults.filter(t => t.count > 0).sort((a,b) => b.count - a.count).map(t => `
            <div class="info-row"><span>${t.emoji} ${escapeHtml(t.label)} Pokémon</span><strong>${t.count} discovered</strong></div>
          `).join('') || '<p><small>No typed Pokémon discovered yet.</small></p>'}
        </div>
      `;
    }
    renderAchievements([...cheapAchievements(), ...deepAchievements(deepStats)]);
  }

  async function computeDeepStats(){
    const discoveredIds = allSpecies.filter(s => discoveredMap[s.id]?.discovered).map(s => s.id);

    // ONE request per type (18 total, ever — see pokemon-data.js), not
    // one per discovered Pokémon.
    const typeResults = await Promise.all(pd().TYPE_LIST.map(async t => {
      try{
        const ids = await pd().loadTypeMembership(t.key);
        typeMembershipSets[t.key] = ids; // also warms the Type filter dropdown for free
        return { ...t, count: discoveredIds.filter(id => ids.has(id)).length };
      }catch{
        return { ...t, count: 0 };
      }
    }));

    // Evolution family completion — bounded by DISTINCT chains among
    // discovered Pokémon (siblings share one chain, deduped by URL
    // inside pokemon-data.js's loadPokemonInfo/loadChain caches).
    const chainSeen = new Set();
    let familiesComplete = 0;
    let familiesConsidered = 0;
    await Promise.all(discoveredIds.map(async id => {
      try{
        const info = await pd().loadPokemonInfo(id);
        const chainUrl = info.species?.evolution_chain?.url;
        if(!chainUrl || chainSeen.has(chainUrl)) return;
        chainSeen.add(chainUrl);
        const chain = info.evolutionChain;
        // A chain of length 1 is a Pokémon with no evolutions at all (e.g.
        // Pikachu, most legendaries) — not an "evolution family" in any
        // meaningful sense, and the detail view never shows an EVOLUTION
        // FAMILY block for one either (see openDetail's chain.length>1
        // check below). Skip it here too so discovering a single
        // non-evolving Pokémon doesn't silently count as a "family
        // complete" and inflate this stat.
        if(!Array.isArray(chain) || chain.length <= 1) return;
        familiesConsidered++;
        const allIn = chain.every(stage => discoveredMap[stage.dexNumber]?.discovered);
        if(allIn) familiesComplete++;
      }catch{ /* skip this one — not worth failing the whole panel over */ }
    }));

    return { typeResults, familiesComplete, familiesConsidered };
  }

  // ---- Detail view ----
  function backToGridHtml(){
    return `<button type="button" id="pokedex-back-btn" class="ghost-btn" style="margin-bottom:14px;">← Back to My Pokédex</button>`;
  }

  async function openDetail(dexId){
    const el = root();
    if(!el) return;
    el.innerHTML = `${backToGridHtml()}<div class="empty-state">Loading…</div>`;
    document.getElementById('pokedex-back-btn')?.addEventListener('click', renderMainFromCache);
    window.scrollTo({ top: 0, behavior: 'instant' });

    let info;
    try{
      info = await pd().loadPokemonInfo(dexId);
    }catch{
      el.innerHTML = `${backToGridHtml()}<div class="empty-state">Could not load this Pokémon right now — try again in a moment.</div>`;
      document.getElementById('pokedex-back-btn')?.addEventListener('click', renderMainFromCache);
      return;
    }
    if(!info?.species){
      el.innerHTML = `${backToGridHtml()}<div class="empty-state">Could not load this Pokémon right now — try again in a moment.</div>`;
      document.getElementById('pokedex-back-btn')?.addEventListener('click', renderMainFromCache);
      return;
    }

    const name = pd().displayName(info.species.name);
    const { discovered, cardCount } = pd().ownedSummaryForSpecies(info.species.name, ownedRows);
    const types = (info.pokemon?.types || []).map(t => pd().TYPE_LIST.find(x => x.key === t.type?.name)).filter(Boolean);
    const generation = pd().dexToGeneration(dexId);
    const cryUrl = info.pokemon?.cries?.latest || info.pokemon?.cries?.legacy || null;
    const chain = info.evolutionChain;
    const ownedForThisSpecies = (ownedRows || []).filter(r => pd().speciesMatchesCardName(info.species.name, r.card_name));

    const evoHtml = (Array.isArray(chain) && chain.length > 1) ? `
      <h3 style="margin-top:20px; margin-bottom:6px; font-size:1rem;">EVOLUTION FAMILY</h3>
      <div class="poke-evo-list">
        ${chain.map(stage => `<div class="poke-evo-item">${discoveredMap[stage.dexNumber]?.discovered ? '✅' : '⬜'} ${escapeHtml(pd().displayName(stage.name))}</div>`).join('')}
      </div>
      <p><small>${chain.filter(stage => discoveredMap[stage.dexNumber]?.discovered).length}/${chain.length} COMPLETE</small></p>
    ` : '';

    const cardsListHtml = ownedForThisSpecies.length ? `
      <div class="card-grid" id="pokedex-owned-cards-grid" hidden>
        ${ownedForThisSpecies.map(r => `
          <div class="card" style="padding:8px;">
            ${r.image_url ? `<img src="${escapeHtml(r.image_url)}" alt="" loading="lazy" style="width:100%;aspect-ratio:245/337;object-fit:contain;margin-bottom:6px;">` : ''}
            <strong style="display:block; font-size:.85rem;">${escapeHtml(r.card_name)}</strong>
            <small>${escapeHtml(r.set_name || '')} · ${escapeHtml(r.variant)} · ×${escapeHtml(String(r.quantity))}</small>
          </div>
        `).join('')}
      </div>
    ` : '';

    el.innerHTML = `
      ${backToGridHtml()}
      <div class="card section">
        <div style="display:flex; flex-direction:column; align-items:center; text-align:center; gap:10px;">
          ${spriteImgHtml(dexId, discovered, 'pokedex-detail-sprite')}
          <div>
            <div class="eyebrow">#${String(dexId).padStart(3, '0')}</div>
            <strong style="display:block; font-size:1.4rem;">${escapeHtml(name).toUpperCase()}</strong>
            ${types.length ? `<small style="display:block; color:var(--muted);">${types.map(t => `${t.emoji} ${escapeHtml(t.label)}`).join(' / ')}</small>` : ''}
            ${generation ? `<small style="display:block; color:var(--muted);">${escapeHtml(generation.region)} · ${escapeHtml(generation.short)}</small>` : ''}
          </div>
        </div>

        ${cryUrl ? `<p style="text-align:center; margin-top:10px;"><button type="button" class="ghost-btn poke-cry-btn" data-cry-url="${escapeHtml(cryUrl)}">🔊 HEAR CRY</button></p>` : ''}

        ${discovered ? `
          <div class="notice" style="text-align:center;">
            <strong style="font-size:1.1rem;">${cardCount} ${escapeHtml(name)} Card${cardCount === 1 ? '' : 's'} Owned</strong>
          </div>
          ${ownedForThisSpecies.length ? `<p style="text-align:center;"><button type="button" id="pokedex-view-cards-btn" class="primary-btn">VIEW MY ${escapeHtml(name).toUpperCase()} CARDS</button></p>${cardsListHtml}` : ''}
        ` : `
          <div class="notice" style="text-align:center;">
            <strong>NOT YET DISCOVERED</strong>
          </div>
          <p style="text-align:center;"><button type="button" id="pokedex-find-cards-btn" class="primary-btn">FIND ${escapeHtml(name).toUpperCase()} CARDS</button></p>
        `}

        ${evoHtml}
      </div>
    `;

    document.getElementById('pokedex-back-btn')?.addEventListener('click', renderMainFromCache);
    pd().attachSpriteFallback(el);
    el.querySelector('.poke-cry-btn')?.addEventListener('click', (e) => {
      const url = e.currentTarget.dataset.cryUrl;
      if(!url) return;
      try{ new Audio(url).play().catch(() => {}); }catch{ /* best-effort */ }
    });
    document.getElementById('pokedex-view-cards-btn')?.addEventListener('click', (e) => {
      const grid = document.getElementById('pokedex-owned-cards-grid');
      if(!grid) return;
      grid.hidden = !grid.hidden;
      e.currentTarget.textContent = grid.hidden ? `VIEW MY ${name.toUpperCase()} CARDS` : `HIDE MY ${name.toUpperCase()} CARDS`;
    });
    document.getElementById('pokedex-find-cards-btn')?.addEventListener('click', () => {
      if(window.InfinitePullsCollection) window.InfinitePullsCollection.findCards(name);
    });
  }

  function renderMainFromCache(){
    const el = root();
    if(!el || !currentUser) return;
    el.innerHTML = shellHtml();
    wireShellEvents(currentUser);
  }

  async function renderMain(user, focusDex){
    currentUser = user;
    const el = root();
    if(!el) return;
    el.innerHTML = `<div class="empty-state">Loading My Pokédex…</div>`;
    try{
      await loadData(user);
    }catch{
      el.innerHTML = `<div class="empty-state">Could not load My Pokédex right now — check your connection and try again.</div>`;
      return;
    }
    if(!root()) return; // navigated away while loading

    if(focusDex && allSpecies.some(s => s.id === focusDex)){
      openDetail(focusDex);
    } else {
      renderMainFromCache();
    }
  }

  async function init(focusDex){
    const el = root();
    if(!el) return;
    if(!window.InfinitePullsSupabase || !window.InfinitePullsSupabase.ready){
      renderNotConnected();
      return;
    }
    // Reset per-visit filter state each time My Pokédex is (re)entered
    // via navigation, so a filter chosen last time doesn't silently
    // carry over and confuse "why is this Pokémon missing from the grid."
    // deepStats is NOT reset here — once calculated it stays cached (and
    // cheap to redisplay) for the rest of this visit, per its own copy.
    filterMode = 'all';
    rangeFilter = null;
    typeFilter = null;
    searchQuery = '';

    const { data: { session } } = await client().auth.getSession();
    if(!session){ renderSignedOut(); return; }
    await renderMain(session.user, focusDex);
  }

  window.InfinitePullsPokedex = { init };
})();
