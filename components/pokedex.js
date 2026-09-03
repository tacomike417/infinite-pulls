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
    // The Infinite Dex has a card for discovering enough Pokémon, and this
    // is the only place in the app that knows the number.
    window.InfinitePullsDex?.noticePokedex?.(discoveredCount());
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

  function tileHtml(species){
    const info = discoveredMap[species.id] || { discovered: false, cardCount: 0 };
    return `
      <button type="button" class="pokedex-tile ${info.discovered ? '' : 'pokedex-tile-missing'}" data-dex-id="${species.id}">
        <span class="pokedex-tile-num">${String(species.id).padStart(3,'0')}</span>
        ${info.discovered ? '' : '<span class="pokedex-tile-mark pokedex-tile-mark-missing">?</span>'}
        <span class="pokedex-tile-sprite-wrap">${spriteImgHtml(species.id, info.discovered)}</span>
        <span class="pokedex-tile-foot">
          <span class="pokedex-tile-name">${escapeHtml(pd().displayName(species.name))}</span>
          ${info.discovered ? `<span class="pokedex-tile-mark pokedex-tile-mark-done" title="${info.cardCount} card${info.cardCount === 1 ? '' : 's'} in My Collection">${info.cardCount > 99 ? '99+' : info.cardCount}</span>` : ''}
        </span>
      </button>
    `;
  }

  // Splits whatever survived the filters into one block per generation, in
  // National Dex order, each with its own sticky region heading. Generations
  // with no surviving matches are dropped entirely rather than left as empty
  // headings, so a search or type filter reads as a short list of regions
  // instead of nine mostly-blank sections. The heading always states the
  // generation's TRUE dex range (Kanto is 1–151 whatever is filtered), while
  // the count on the right reflects what is actually on screen.
  function groupByGeneration(list){
    const groups = [];
    const claimed = new Set();
    pd().GENERATION_RANGES.forEach(g => {
      const members = list.filter(s => s.id >= g.min && s.id <= g.max);
      if(!members.length) return;
      members.forEach(s => claimed.add(s.id));
      groups.push({ label: (g.region || g.label), min: g.min, max: g.max, members });
    });
    // Anything outside every known range (a newer generation the roster
    // knows about but GENERATION_RANGES doesn't yet) still gets shown.
    const rest = list.filter(s => !claimed.has(s.id));
    if(rest.length){
      groups.push({ label: 'Other', min: rest[0].id, max: rest[rest.length - 1].id, members: rest });
    }
    return groups;
  }

  function renderGridHtml(){
    const filtered = getFilteredSpecies();
    if(!filtered.length){
      return `<div class="empty-state">No Pokémon match this search/filter.</div>`;
    }
    return groupByGeneration(filtered).map(group => {
      const have = group.members.filter(s => discoveredMap[s.id]?.discovered).length;
      // Each generation is its own <section> so its sticky heading is bounded
      // by that section: Kanto's heading scrolls away as Johto's arrives,
      // instead of every heading piling up under the topbar.
      return `
        <section class="pokedex-gen-block">
          <div class="pokedex-section-label pokedex-gen-heading">
            <span>
              <img src="./assets/icons/pokedex-nav.png" alt="" class="dex-mark">
              ${escapeHtml(group.label.toUpperCase())} · ${group.min}–${group.max}
            </span>
            <span class="pokedex-section-count">${have} / ${group.members.length}</span>
          </div>
          <div class="pokedex-grid">${group.members.map(tileHtml).join('')}</div>
        </section>
      `;
    }).join('');
  }

  // The ring answers "how complete is the thing I'm looking at". Unfiltered
  // that's the whole National Dex; pick a generation and it becomes that
  // generation. Deliberately ignores the Discovered/Missing, type and search
  // filters — those narrow what's ON SCREEN, they don't change how much of a
  // region exists to collect, and a ring that moved with a search box would
  // be measuring nothing meaningful.
  //
  // The denominator is spelled out inside the ring on purpose: at 5 of 1,025
  // the gold arc is under two degrees wide, so without "of 1,025" underneath
  // it a bare "5" on an apparently empty ring just reads as broken.
  // Rounded percentage is what the arc is drawn from, and 5 of 1,025 rounds
  // to 0 — which would draw NO arc at all despite five real discoveries.
  // Anything above zero therefore keeps a minimum visible sliver: the ring
  // reports a count, not a percentage, so this can't misstate a number.
  function ringArcPct(have, total){
    if(have <= 0 || total <= 0) return 0;
    return Math.max(Math.round((have / total) * 100), 1.5);
  }

  function updateRing(){
    const ringEl = document.getElementById('pokedex-ring');
    if(!ringEl) return;

    const inScope = rangeFilter
      ? allSpecies.filter(s => s.id >= rangeFilter.min && s.id <= rangeFilter.max)
      : allSpecies;
    const total = inScope.length || pd().NATIONAL_DEX_MAX;
    const have = inScope.filter(s => discoveredMap[s.id]?.discovered).length;
    ringEl.style.setProperty('--pct', ringArcPct(have, total));
    const labelEl = document.getElementById('pokedex-ring-label');
    const countEl = document.getElementById('pokedex-ring-count');
    const totalEl = document.getElementById('pokedex-ring-total');
    if(labelEl) labelEl.textContent = rangeFilter ? (rangeFilter.region || rangeFilter.label) : 'National Dex';
    if(countEl) countEl.textContent = have;
    if(totalEl) totalEl.textContent = `of ${total.toLocaleString()}`;
  }

  function renderGrid(){
    const gridEl = document.getElementById('pokedex-grid-wrap');
    if(!gridEl) return;
    gridEl.innerHTML = renderGridHtml();
    pd().attachSpriteFallback(gridEl);
    gridEl.querySelectorAll('.pokedex-tile').forEach(btn => {
      btn.addEventListener('click', () => openDetail(Number(btn.dataset.dexId)));
    });
    updateRing();
  }

  function setFilterMode(mode){
    filterMode = mode;
    document.querySelectorAll('#pokedex-filter-bar [data-filter]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.filter === mode);
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
    const pct = ringArcPct(have, total);

    // Regional stat is purely informational (Kanto / Gen I split-out of
    // the same live discoveredMap already loaded) — NOT a goal. The
    // middle column is the visitor's real, admin-editable Primary Goal,
    // filled in async below by renderPrimaryGoal() once Collector Goals
    // data loads; this never hardcodes a goal name here.
    const kanto = pd().GENERATION_RANGES.find(g => g.key === 'generation-i');
    let kantoHave = 0, kantoTotal = 0;
    if(kanto){
      const speciesInKanto = allSpecies.filter(s => s.id >= kanto.min && s.id <= kanto.max);
      kantoTotal = speciesInKanto.length || (kanto.max - kanto.min + 1);
      kantoHave = speciesInKanto.filter(s => discoveredMap[s.id]?.discovered).length;
    }

    return `
      <div class="pokedex-top">
        <h1 class="pokedex-page-title">My Pokédex</h1>

        <div class="pokedex-stats-card">
          <div class="pokedex-stats-col pokedex-stats-ring-col">
            <div class="pokedex-stats-label" id="pokedex-ring-label">National Dex</div>
            <div class="pokedex-ring" id="pokedex-ring" style="--pct:${pct}">
              <div class="pokedex-ring-inner">
                <strong id="pokedex-ring-count">${have}</strong>
                <span id="pokedex-ring-total">of ${total.toLocaleString()}</span>
              </div>
            </div>
            <div class="pokedex-stats-sub pokedex-stats-sub-wrap">Pokémon discovered</div>
          </div>
          <div class="pokedex-stats-col pokedex-stats-goal-col">
            <div class="pokedex-stats-label" id="pokedex-stats-goal-label">Primary Badge</div>
            <div id="pokedex-stats-goal-value">
              <div class="pokedex-stats-goal-frac">…</div>
            </div>
          </div>
          <div class="pokedex-stats-col">
            <div class="pokedex-stats-label">${kanto ? escapeHtml(kanto.region) : 'Kanto'}</div>
            <div class="pokedex-stats-value">${kantoTotal > 0 ? Math.round((kantoHave / kantoTotal) * 100) : 0}<small class="pct-sign">%</small></div>
            <div class="pokedex-stats-sub pokedex-stats-sub-wrap">Complete</div>
            <span class="pokedex-stats-decor" aria-hidden="true"></span>
          </div>
        </div>

        <div class="pokedex-search-row">
          <form id="pokedex-search-form" class="pokedex-search-pill">
            <span class="search-icon">🔍</span>
            <input name="q" placeholder="Search Pokémon or Dex #" value="${escapeHtml(searchQuery)}" autocomplete="off">
          </form>
          <a class="pokedex-goals-pill" href="?page=goals" data-route="goals"><span aria-hidden="true">🎯</span> Badges ›</a>
        </div>

        <div class="pokedex-pill-bar" id="pokedex-filter-bar">
          <button type="button" class="pokedex-pill-btn is-active" data-filter="all">All</button>
          <button type="button" class="pokedex-pill-btn" data-filter="discovered">Discovered</button>
          <button type="button" class="pokedex-pill-btn" data-filter="missing">Missing</button>
          <label class="pokedex-pill-select-wrap">
            <select id="pokedex-gen-select" class="pokedex-pill-select" aria-label="Filter by generation">
              <option value="">Gen</option>
              ${pd().GENERATION_RANGES.map(g => `<option value="${g.key}">${escapeHtml(g.short || g.label)}</option>`).join('')}
            </select>
          </label>
          <label class="pokedex-pill-select-wrap">
            <select id="pokedex-type-select" class="pokedex-pill-select" aria-label="Filter by type">
              <option value="">Type</option>
              ${pd().TYPE_LIST.map(t => `<option value="${t.key}">${t.emoji} ${escapeHtml(t.label)}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>

      <div id="pokedex-grid-wrap"></div>

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

      <button type="button" id="pokedex-to-top" class="pokedex-fab" aria-label="Back to top">▲</button>
    `;
  }

  // The Gen / Type filters are native <select>s (so phones still get the
  // OS picker) dressed as pills to sit in the same row as All/Discovered/
  // Missing — this just mirrors "something is selected" onto the wrapper
  // so the pill can go gold the same way an active filter button does.
  function markSelectPill(selectEl){
    selectEl?.closest('.pokedex-pill-select-wrap')?.classList.toggle('is-active', !!selectEl.value);
  }

  // Scroll-to-top button. The listener is attached once per page render
  // and always re-reads the button from the DOM, so navigating away (which
  // replaces #pokedex-page's contents) simply makes it a no-op.
  function wireScrollToTop(){
    const btn = document.getElementById('pokedex-to-top');
    if(!btn) return;
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    const onScroll = () => {
      const live = document.getElementById('pokedex-to-top');
      if(!live){ window.removeEventListener('scroll', onScroll); return; }
      live.classList.toggle('is-visible', window.scrollY > 420);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
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
      markSelectPill(e.target);
      setRangeFilter(g ? { min: g.min, max: g.max, label: g.label, region: g.region } : null);
    });
    document.getElementById('pokedex-type-select')?.addEventListener('change', (e) => {
      markSelectPill(e.target);
      setTypeFilter(e.target.value || null);
    });
    document.getElementById('pokedex-range-clear')?.addEventListener('click', () => {
      rangeFilter = null;
      const genSelect = document.getElementById('pokedex-gen-select');
      if(genSelect){ genSelect.value = ''; markSelectPill(genSelect); }
      setRangeFilter(null);
    });
    document.querySelectorAll('.pokedex-gen-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = pd().GENERATION_RANGES.find(x => x.key === btn.dataset.gen);
        if(!g) return;
        const genSelect = document.getElementById('pokedex-gen-select');
        if(genSelect){ genSelect.value = g.key; markSelectPill(genSelect); }
        setRangeFilter({ min: g.min, max: g.max, label: g.label, region: g.region });
      });
    });
    document.getElementById('pokedex-deep-stats-btn')?.addEventListener('click', () => runDeepStats(user));

    wireScrollToTop();
    renderGrid();
    renderAchievements(deepStats ? [...cheapAchievements(), ...deepAchievements(deepStats)] : cheapAchievements(), !deepStats);
    renderPrimaryGoal(user);
  }

  // ---- Collector Goals summary (components/collector-goals-data.js owns
  // the actual goal system now — My Pokédex just surfaces the visitor's
  // Primary Goal here as a quick glance, same spot the old hardcoded
  // "Original 151" card used to live. Reuses allSpecies/ownedRows/
  // discoveredMap already loaded by loadData() above instead of asking
  // collector-goals-data.js to fetch them again. ----
  async function renderPrimaryGoal(user){
    const labelEl = document.getElementById('pokedex-stats-goal-label');
    const miniVal = document.getElementById('pokedex-stats-goal-value');
    const descEl = document.getElementById('pokedex-goals-card-desc');
    const ctaEl = document.getElementById('pokedex-goals-card-cta');
    const cg = window.InfinitePullsCollectorGoals;
    if(!cg) return;
    let userGoals;
    try{ userGoals = await cg.loadUserGoals(user.id); }catch{ userGoals = []; }
    if(!userGoals.length){
      if(descEl) descEl.textContent = 'Pick a goal — Original 151, complete a set, collect a favorite Pokémon, and more. Progress tracks automatically from My Collection.';
      if(ctaEl) ctaEl.textContent = 'Choose Your Badges →';
      if(labelEl) labelEl.textContent = 'Primary Badge';
      if(miniVal) miniVal.innerHTML = `<a href="?page=goals" data-route="goals" class="pokedex-stats-setgoal">Set a Goal →</a>`;
      return;
    }
    const ctx = { allSpecies, ownedRows, discoveredMap, userId: user.id };
    const primaryRow = userGoals.find(g => g.is_primary) || userGoals[0];
    const eff = cg.effectiveGoal(primaryRow);
    const progress = await cg.computeGoalProgress(eff, ctx);

    // The compact promo card below no longer duplicates goal progress —
    // the header stats card is the one live progress readout now — so
    // this just says how many goals are being tracked and links onward.
    if(descEl){
      descEl.textContent = userGoals.length === 1
        ? `Tracking ${eff.name} — manage it or add more goals anytime.`
        : `Tracking ${userGoals.length} Badges — manage or add more anytime.`;
    }
    if(ctaEl) ctaEl.textContent = 'Manage Goals →';

    // Goal name lives in the label position (matches the header's other
    // two columns, which also lead with a label then a big value) —
    // avoids repeating the name a second time underneath the number.
    if(labelEl) labelEl.textContent = eff.name;

    if(miniVal){
      if(progress.complete){
        miniVal.innerHTML = `<div class="pokedex-stats-goal-frac"><strong>🏆 Complete!</strong></div>`;
      } else if(typeof progress.total === 'number' && progress.total > 0){
        miniVal.innerHTML = `
          <div class="pokedex-stats-goal-frac"><strong>${progress.current}</strong><small> / ${progress.total}</small></div>
          <div class="pokedex-progress-bar pokedex-progress-bar-small"><span class="pokedex-progress-fill" style="width:${progress.pct}%"></span></div>
        `;
      } else {
        miniVal.innerHTML = `
          <div class="pokedex-stats-goal-frac"><strong style="font-size:1.1rem;">${escapeHtml(progress.primaryLabel)}</strong></div>
        `;
      }
    }
  }

  // ---- Achievements ----
  // The first three don't need anything beyond discoveredMap (free,
  // instant); the last three need type/evolution data from
  // computeDeepStats() and show as locked until that's been run once.
  // (An "Original 151" badge used to live here too — that's now a proper,
  // admin-editable Collector Goal instead, see renderPrimaryGoal above.)
  function cheapAchievements(){
    const have = discoveredCount();
    return [
      { key: 'first', emoji: '🎉', title: 'FIRST DISCOVERY', desc: 'Discover your first Pokémon.', done: have >= 1 },
      { key: '25', emoji: '⭐', title: '25 DISCOVERED', desc: 'Represent 25 different Pokémon.', done: have >= 25 },
      { key: '100', emoji: '💯', title: 'CENTURY CLUB', desc: 'Represent 100 different Pokémon.', done: have >= 100 },
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
    // dexId is passed so a Japanese card counts here too — its printed
    // name (リザードンex) can't be name-matched against "Charizard", so the
    // dex number stored on the row is the only thing that finds it.
    const { discovered, cardCount } = pd().ownedSummaryForSpecies(info.species.name, ownedRows, dexId);
    const types = (info.pokemon?.types || []).map(t => pd().TYPE_LIST.find(x => x.key === t.type?.name)).filter(Boolean);
    const generation = pd().dexToGeneration(dexId);
    const chain = info.evolutionChain;
    const ownedForThisSpecies = (ownedRows || []).filter(r => pd().rowIsSpecies(r, info.species.name, dexId));

    const evoHtml = (Array.isArray(chain) && chain.length > 1) ? `
      <h3 style="margin-top:20px; margin-bottom:6px; font-size:1rem;">EVOLUTION FAMILY</h3>
      <div class="poke-evo-list">
        ${chain.map(stage => `<div class="poke-evo-item">${discoveredMap[stage.dexNumber]?.discovered ? '✅' : '⬜'} ${escapeHtml(pd().displayName(stage.name))}</div>`).join('')}
      </div>
      <p><small>${chain.filter(stage => discoveredMap[stage.dexNumber]?.discovered).length}/${chain.length} COMPLETE</small></p>
    ` : '';

    // Each owned printing is a button into My Collection's full card detail
    // (pricing, rarity, illustrator, other printings). Rows added before this
    // app stored card_id have none to open with, so those fall back to a
    // pre-filled card search on the card's name rather than doing nothing.
    const cardsListHtml = ownedForThisSpecies.length ? `
      <div class="card-grid" id="pokedex-owned-cards-grid" hidden>
        ${ownedForThisSpecies.map(r => `
          <button type="button" class="card pokedex-owned-card" style="padding:8px;text-align:left;"
                  data-card-id="${escapeHtml(r.card_id || '')}" data-card-name="${escapeHtml(r.card_name || '')}">
            ${r.image_url ? `<img src="${escapeHtml(r.image_url)}" alt="" loading="lazy" style="width:100%;aspect-ratio:245/337;object-fit:contain;margin-bottom:6px;">` : ''}
            <strong style="display:block; font-size:.85rem;">${escapeHtml(r.card_name)}</strong>
            <small>${escapeHtml(r.set_name || '')} · ${escapeHtml(r.variant)} · ×${escapeHtml(String(r.quantity))}</small>
            <span class="pokedex-owned-card-cue">View card info →</span>
          </button>
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
    document.getElementById('pokedex-view-cards-btn')?.addEventListener('click', (e) => {
      const grid = document.getElementById('pokedex-owned-cards-grid');
      if(!grid) return;
      grid.hidden = !grid.hidden;
      e.currentTarget.textContent = grid.hidden ? `VIEW MY ${name.toUpperCase()} CARDS` : `HIDE MY ${name.toUpperCase()} CARDS`;
    });
    el.querySelectorAll('.pokedex-owned-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const col = window.InfinitePullsCollection;
        if(!col) return;
        const cardId = btn.dataset.cardId;
        if(cardId && col.openCard) col.openCard(cardId);
        else col.findCards(btn.dataset.cardName || name);
      });
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
