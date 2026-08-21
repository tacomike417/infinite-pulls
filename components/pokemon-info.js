// Shared "About [Pokémon]" section — a small, fun Pokédex-style panel
// added near the bottom of any card detail view (My Collection / Wish
// List search results, My Collection / Wish List cards, and a public
// collector page's single-card view all call into this one file instead
// of each reimplementing it).
//
// Data source: PokéAPI (https://pokeapi.co) — free, keyless, and
// explicitly built for direct browser use (it sends its own permissive
// CORS headers), so this fetches straight from the client with no
// Supabase Edge Function needed, unlike card-news/ebay-price.
//
// Deliberately kept light per how this was scoped: national dex #, name,
// type(s), region/generation, evolution chain, official artwork, and a
// cry button. No stats, moves, breeding data, or egg groups — this is a
// fun add-on to a card page, not a full Pokédex.
(function(){
  'use strict';

  const POKEAPI_BASE = 'https://pokeapi.co/api/v2';
  const FETCH_TIMEOUT_MS = 6000;

  // generation-i .. generation-ix are the whole stable set PokéAPI has had
  // for years; anything newer just falls back to a title-cased version of
  // the raw slug below rather than erroring.
  const GENERATION_LABELS = {
    'generation-i': 'Kanto (Generation I)',
    'generation-ii': 'Johto (Generation II)',
    'generation-iii': 'Hoenn (Generation III)',
    'generation-iv': 'Sinnoh (Generation IV)',
    'generation-v': 'Unova (Generation V)',
    'generation-vi': 'Kalos (Generation VI)',
    'generation-vii': 'Alola (Generation VII)',
    'generation-viii': 'Galar (Generation VIII)',
    'generation-ix': 'Paldea (Generation IX)',
  };

  function escapeHtml(value=''){
    return String(value).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[m]));
  }

  function capitalize(s){
    return typeof s === 'string' && s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // PokéAPI species/pokemon "name" fields are lowercase-hyphenated
  // (e.g. "mr-mime", "nidoran-f") — good enough for display once title
  // cased word-by-word, and it's what gets matched against a card's own
  // (human-written) name below.
  function displayName(slug){
    return String(slug || '').split('-').map(capitalize).join(' ');
  }

  function escapeRegExp(s){
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async function fetchJson(url){
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if(!res.ok) throw new Error(`PokéAPI returned ${res.status}`);
    return res.json();
  }

  function idFromUrl(url){
    const m = /\/(\d+)\/?$/.exec(url || '');
    return m ? Number(m[1]) : null;
  }

  // Walks the (possibly branching, e.g. Eevee) evolution-chain tree into
  // one flat, depth-first list. Branch structure isn't preserved — for a
  // simple "which of these have you got" checklist that's not needed, and
  // it keeps the display dead simple per how this was scoped.
  function flattenEvolutionChain(node, out){
    out = out || [];
    if(!node) return out;
    out.push({ name: node.species?.name, dexNumber: idFromUrl(node.species?.url) });
    (node.evolves_to || []).forEach(child => flattenEvolutionChain(child, out));
    return out;
  }

  // Cached by national dex number, and the in-flight PROMISE is what's
  // cached (not just the eventual value) — same reasoning as the rest of
  // the app's "don't hammer a free API" caches: several cards on screen
  // in quick succession (Other Printings, a binder page) can easily be
  // the same Pokémon, and this stops overlapping requests for it.
  const infoCache = {};
  function loadPokemonInfo(dexNumber){
    if(infoCache[dexNumber]) return infoCache[dexNumber];
    const promise = (async () => {
      const species = await fetchJson(`${POKEAPI_BASE}/pokemon-species/${dexNumber}`);
      const pokemon = await fetchJson(`${POKEAPI_BASE}/pokemon/${dexNumber}`);
      let evolutionChain = null;
      if(species?.evolution_chain?.url){
        try{
          const chainData = await fetchJson(species.evolution_chain.url);
          evolutionChain = flattenEvolutionChain(chainData?.chain);
        }catch{
          evolutionChain = null; // evolution family just won't show — not worth failing the whole section over
        }
      }
      return { species, pokemon, evolutionChain };
    })();
    infoCache[dexNumber] = promise;
    // Don't leave a failed lookup permanently cached — a transient PokéAPI
    // hiccup shouldn't mean this Pokémon never shows info again this page load.
    promise.catch(() => { if(infoCache[dexNumber] === promise) delete infoCache[dexNumber]; });
    return promise;
  }

  // A card's printed name almost always contains the Pokémon's own name
  // as a whole word ("Bulbasaur", "Dark Bulbasaur", "Bulbasaur ex",
  // "Shining Bulbasaur") — this is how owned-card rows (which only store
  // a free-text card_name, not a dex number) get matched back to a
  // species without an extra TCGdex lookup per row. \b keeps "Porygon"
  // from matching "Porygon2" or "Porygon-Z", which are different Pokémon.
  function speciesMatchesCardName(speciesSlugOrName, cardName){
    if(!speciesSlugOrName || !cardName) return false;
    const name = displayName(speciesSlugOrName);
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i');
    return re.test(cardName);
  }

  function ownedSummaryForSpecies(speciesSlugOrName, ownedRows){
    const matches = (ownedRows || []).filter(r => speciesMatchesCardName(speciesSlugOrName, r.card_name));
    const cardCount = matches.reduce((sum, r) => sum + (Number(r.quantity) || 1), 0);
    return { discovered: matches.length > 0, cardCount };
  }

  function renderBody(info, card, opts){
    const { species, pokemon, evolutionChain } = info;
    const name = displayName(species.name);
    const dexNumber = species.id;
    const types = (pokemon.types || []).map(t => capitalize(t.type?.name)).filter(Boolean).join(' / ');
    const generation = GENERATION_LABELS[species.generation?.name] || displayName((species.generation?.name || '').replace('generation-', 'Generation '));
    const artwork = pokemon.sprites?.other?.['official-artwork']?.front_default || pokemon.sprites?.front_default || '';
    const cryUrl = pokemon.cries?.latest || pokemon.cries?.legacy || null;

    const ownedRows = opts.ownedRows || null;
    const showCollectionStats = Array.isArray(ownedRows);
    // "Your" (default) reads naturally lowercased mid-sentence ("in your
    // Pokédex"); a custom label like "Ash's" (used on a public collector
    // page, for the profile owner rather than whoever's viewing it) is
    // already a proper possessive and stays as-is either way.
    const possessive = opts.ownerLabel || 'Your';
    const possessiveLower = possessive === 'Your' ? 'your' : possessive;

    let collectionHtml = '';
    if(showCollectionStats){
      const { discovered, cardCount } = ownedSummaryForSpecies(species.name, ownedRows);
      collectionHtml = `
        <div class="poke-info-collection">
          <p>${escapeHtml(possessive)} ${escapeHtml(name)} Collection: ${cardCount} card${cardCount === 1 ? '' : 's'}</p>
          <p>${discovered ? '✅' : '⬜'} ${escapeHtml(name)} ${discovered ? 'discovered in' : 'not yet in'} ${escapeHtml(possessiveLower)} Pokédex</p>
        </div>
      `;
    }

    let evoHtml = '';
    if(Array.isArray(evolutionChain) && evolutionChain.length > 1){
      const stages = evolutionChain.slice(0, 12).map(stage => {
        const stageName = displayName(stage.name);
        const mark = showCollectionStats
          ? (ownedSummaryForSpecies(stage.name, ownedRows).discovered ? '✅' : '⬜')
          : '·';
        return `<div class="poke-evo-item">${mark} ${escapeHtml(stageName)}</div>`;
      }).join('');
      const ownedCountInChain = showCollectionStats
        ? evolutionChain.filter(stage => ownedSummaryForSpecies(stage.name, ownedRows).discovered).length
        : null;
      evoHtml = `
        <h4 class="poke-info-subhead">Evolution Family</h4>
        <div class="poke-evo-list">${stages}</div>
        ${showCollectionStats ? `<p><small>${ownedCountInChain}/${evolutionChain.length} represented in ${escapeHtml(possessiveLower)} collection</small></p>` : ''}
      `;
    }

    return `
      <div class="poke-info-body">
        <div class="poke-info-top">
          ${artwork ? `<img src="${escapeHtml(artwork)}" alt="${escapeHtml(name)}" class="poke-info-sprite" loading="lazy">` : ''}
          <div class="info-list" style="flex:1; min-width:0;">
            <div class="info-row"><span>National Dex #</span><strong>${String(dexNumber).padStart(3, '0')}</strong></div>
            <div class="info-row"><span>Name</span><strong>${escapeHtml(name)}</strong></div>
            ${types ? `<div class="info-row"><span>Type${types.includes('/') ? 's' : ''}</span><strong>${escapeHtml(types)}</strong></div>` : ''}
            ${generation ? `<div class="info-row"><span>Region</span><strong>${escapeHtml(generation)}</strong></div>` : ''}
          </div>
        </div>
        ${cryUrl ? `<button type="button" class="ghost-btn poke-cry-btn" data-cry-url="${escapeHtml(cryUrl)}" style="margin-top:10px;">🔊 Play ${escapeHtml(name)}'s Cry</button>` : ''}
        ${collectionHtml}
        ${evoHtml}
      </div>
    `;
  }

  // container: a DOM element already on the page (an empty <div> is fine)
  // where the collapsible "About [Pokémon]" block gets inserted.
  // card: a TCGdex full card object — needs card.dexId to look anything
  // up; cards with no dex # (Trainer/Energy cards, mostly) render nothing.
  // opts:
  //   ownedRows       — array of { card_name, quantity } already in
  //                      memory (profile.js has this on hand already), OR
  //   fetchOwnedRows  — () => Promise<Array<{card_name, quantity}>|null>,
  //                      called lazily only when there's a dex # to show
  //                      info for (collection.js uses this, since it
  //                      would otherwise run this query on every card,
  //                      even ones with no Dex # to match against).
  //   ownerLabel      — e.g. 'Your' (default) or "Ash's", used in the
  //                      collection-count / Pokédex / evolution copy.
  //   openByDefault   — boolean, whether the <details> starts expanded.
  async function mount(container, card, opts){
    opts = opts || {};
    if(!container) return;
    const dexNumber = Array.isArray(card?.dexId) && card.dexId.length ? card.dexId[0] : null;
    if(!dexNumber){ container.innerHTML = ''; return; }

    container.innerHTML = `<details class="poke-info-block"><summary>Loading Pokémon info…</summary></details>`;

    let info;
    try{
      info = await loadPokemonInfo(dexNumber);
    }catch{
      container.innerHTML = ''; // this is a bonus section — never block or blank the rest of the card over it
      return;
    }
    if(!info?.species || !info?.pokemon){ container.innerHTML = ''; return; }

    let ownedRows = opts.ownedRows;
    if(!Array.isArray(ownedRows) && typeof opts.fetchOwnedRows === 'function'){
      try{ ownedRows = await opts.fetchOwnedRows(); }catch{ ownedRows = null; }
    }

    const name = displayName(info.species.name);
    container.innerHTML = `
      <details class="poke-info-block" ${opts.openByDefault ? 'open' : ''}>
        <summary>About ${escapeHtml(name)}</summary>
        ${renderBody(info, card, { ...opts, ownedRows })}
      </details>
    `;

    container.querySelector('.poke-cry-btn')?.addEventListener('click', (e) => {
      const url = e.currentTarget.dataset.cryUrl;
      if(!url) return;
      try{ new Audio(url).play().catch(() => {}); }catch{ /* best-effort — no audio, no big deal */ }
    });
  }

  window.InfinitePullsPokemonInfo = { mount };
})();
