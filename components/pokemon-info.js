// Shared "About [Pokémon]" section — a small, fun Pokédex-style panel
// added near the bottom of any card detail view (My Collection / Wish
// List search results, My Collection / Wish List cards, and a public
// collector page's single-card view all call into this one file instead
// of each reimplementing it).
//
// This file is now just the RENDERING layer for that one section — all
// the actual PokéAPI fetching/caching and "does this owned card match
// this Pokémon" matching logic lives in components/pokemon-data.js
// (loaded before this file — see index.html), shared with the full My
// Pokédex page (components/pokedex.js) so there's exactly one Pokémon
// identity system in this app, not two.
//
// Deliberately kept light per how this was scoped: national dex #, name,
// type(s), region/generation, evolution chain, official artwork, and a
// cry button. No stats, moves, breeding data, or egg groups — this is a
// fun add-on to a card page, not the full Pokédex (that's My Pokédex).
(function(){
  'use strict';

  function PD(){ return window.InfinitePullsPokemonData; }

  function escapeHtml(value=''){
    return String(value).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[m]));
  }

  function renderBody(info, opts){
    const pd = PD();
    const { species, pokemon, evolutionChain } = info;
    const name = pd.displayName(species.name);
    const dexNumber = species.id;
    const types = (pokemon.types || []).map(t => pd.capitalize(t.type?.name)).filter(Boolean).join(' / ');
    const generation = pd.dexToGeneration(dexNumber);
    const generationLabel = generation ? generation.label : '';
    const artwork = pokemon.sprites?.other?.['official-artwork']?.front_default || pd.spriteUrl(dexNumber, { artwork: true });
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
      const { discovered, cardCount } = pd.ownedSummaryForSpecies(species.name, ownedRows);
      // A Wish List card for a Pokémon not yet in My Pokédex gets a
      // gentler, forward-looking line instead of "not yet in your
      // Pokédex" — the same identity, just framed as an opportunity
      // rather than a gap, since this card isn't owned (yet).
      const discoveredLine = discovered
        ? `<p>✅ ${escapeHtml(name)} discovered in ${escapeHtml(possessiveLower)} Pokédex</p>`
        : (opts.wishlist
            ? `<p>🆕 Adding this would be a new Pokédex entry</p>`
            : `<p>⬜ ${escapeHtml(name)} not yet in ${escapeHtml(possessiveLower)} Pokédex</p>`);
      collectionHtml = `
        <div class="poke-info-collection">
          <p>${escapeHtml(possessive)} ${escapeHtml(name)} Collection: ${cardCount} card${cardCount === 1 ? '' : 's'}</p>
          ${discoveredLine}
        </div>
      `;
    }

    let evoHtml = '';
    if(Array.isArray(evolutionChain) && evolutionChain.length > 1){
      const stages = evolutionChain.slice(0, 12).map(stage => {
        const stageName = pd.displayName(stage.name);
        const mark = showCollectionStats
          ? (pd.ownedSummaryForSpecies(stage.name, ownedRows).discovered ? '✅' : '⬜')
          : '·';
        return `<div class="poke-evo-item">${mark} ${escapeHtml(stageName)}</div>`;
      }).join('');
      const ownedCountInChain = showCollectionStats
        ? evolutionChain.filter(stage => pd.ownedSummaryForSpecies(stage.name, ownedRows).discovered).length
        : null;
      evoHtml = `
        <h4 class="poke-info-subhead">Evolution Family</h4>
        <div class="poke-evo-list">${stages}</div>
        ${showCollectionStats ? `<p><small>${ownedCountInChain}/${evolutionChain.length} represented in ${escapeHtml(possessiveLower)} collection</small></p>` : ''}
      `;
    }

    const fallbackSprite = pd.spriteUrl(dexNumber, { artwork: false });

    return `
      <div class="poke-info-body">
        <div class="poke-info-top">
          <img src="${escapeHtml(artwork)}" data-fallback="${escapeHtml(fallbackSprite)}" alt="${escapeHtml(name)}" class="poke-sprite-img poke-info-sprite" loading="lazy">
          <div class="info-list" style="flex:1; min-width:0;">
            <div class="info-row"><span>National Dex #</span><strong>${String(dexNumber).padStart(3, '0')}</strong></div>
            <div class="info-row"><span>Name</span><strong>${escapeHtml(name)}</strong></div>
            ${types ? `<div class="info-row"><span>Type${types.includes('/') ? 's' : ''}</span><strong>${escapeHtml(types)}</strong></div>` : ''}
            ${generationLabel ? `<div class="info-row"><span>Region</span><strong>${escapeHtml(generationLabel)}</strong></div>` : ''}
          </div>
        </div>
        ${cryUrl ? `<button type="button" class="ghost-btn poke-cry-btn" data-cry-url="${escapeHtml(cryUrl)}" style="margin-top:10px;">🔊 Play ${escapeHtml(name)}'s Cry</button>` : ''}
        ${collectionHtml}
        ${evoHtml}
        <p style="margin-top:12px"><a href="?page=pokedex&dex=${dexNumber}" data-route="pokedex" class="ghost-btn" style="display:inline-block; text-decoration:none;">View in My Pokédex →</a></p>
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
  //   wishlist        — true when this card is being viewed from Wish
  //                      List, not My Collection — softens the "not
  //                      discovered" line into a "would be new" one.
  //   openByDefault   — boolean, whether the <details> starts expanded.
  async function mount(container, card, opts){
    opts = opts || {};
    if(!container) return;
    const pd = PD();
    if(!pd){ container.innerHTML = ''; return; } // pokemon-data.js failed to load — fail quiet, this is a bonus section
    const dexNumber = Array.isArray(card?.dexId) && card.dexId.length ? card.dexId[0] : null;
    if(!dexNumber){ container.innerHTML = ''; return; }

    container.innerHTML = `<details class="poke-info-block"><summary>Loading Pokémon info…</summary></details>`;

    let info;
    try{
      info = await pd.loadPokemonInfo(dexNumber);
    }catch{
      container.innerHTML = ''; // this is a bonus section — never block or blank the rest of the card over it
      return;
    }
    if(!info?.species || !info?.pokemon){ container.innerHTML = ''; return; }

    let ownedRows = opts.ownedRows;
    if(!Array.isArray(ownedRows) && typeof opts.fetchOwnedRows === 'function'){
      try{ ownedRows = await opts.fetchOwnedRows(); }catch{ ownedRows = null; }
    }

    const name = pd.displayName(info.species.name);
    container.innerHTML = `
      <details class="poke-info-block" ${opts.openByDefault ? 'open' : ''}>
        <summary>About ${escapeHtml(name)}</summary>
        ${renderBody(info, { ...opts, ownedRows })}
      </details>
    `;

    pd.attachSpriteFallback(container);
    container.querySelector('.poke-cry-btn')?.addEventListener('click', (e) => {
      const url = e.currentTarget.dataset.cryUrl;
      if(!url) return;
      try{ new Audio(url).play().catch(() => {}); }catch{ /* best-effort — no audio, no big deal */ }
    });
  }

  window.InfinitePullsPokemonInfo = { mount };
})();
