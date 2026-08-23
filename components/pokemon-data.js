// Shared Pokémon/PokéAPI data layer — the ONE place this app talks to
// PokéAPI (https://pokeapi.co, free, keyless) and the ONE place it
// connects a card's National Dex # to an actual Pokémon identity. Both
// the small "About [Pokémon]" section on card detail views
// (components/pokemon-info.js) and the full My Pokédex page
// (components/pokedex.js) are built on top of this file rather than each
// having their own copy of the same fetching/caching/matching logic.
//
// Performance notes (see also each function's own comments):
//  - Every PokéAPI response this file fetches is cached in memory for the
//    page's lifetime (an SPA — see app.js — so this genuinely persists
//    across navigating between My Collection and My Pokédex, not just
//    within one page view).
//  - The full ~1025-entry National Dex roster (id + name only) comes from
//    ONE bulk request (loadAllSpecies), not one request per Pokémon.
//  - Sprite images are built from PokéAPI's own static, predictable asset
//    URLs (the same GitHub-hosted files `sprites.front_default` etc.
//    would have pointed to) — no fetch needed at all to show a sprite.
//  - "Which Pokémon of type X" comes from ONE request per type
//    (loadTypeMembership — PokéAPI's /type/{name} endpoint already lists
//    every Pokémon of that type), not one request per Pokémon to ask its
//    type — that's the difference between ~18 requests, ever, and over a
//    thousand.
//  - Full per-Pokémon detail (species + pokemon + evolution chain, for a
//    card's "About" section or My Pokédex's detail view) is only ever
//    fetched for a Pokémon someone actually looked at or discovered —
//    never for the whole Dex at once.
(function(){
  'use strict';

  const POKEAPI_BASE = 'https://pokeapi.co/api/v2';
  const SPRITES_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
  const FETCH_TIMEOUT_MS = 6000;

  // The stable, unchanged-for-years generation ranges by National Dex #.
  // Hardcoded rather than fetched — PokéAPI's own /generation/{n}
  // endpoint would work too, but that's 9 extra requests for information
  // that hasn't moved in years, for no real benefit.
  const GENERATION_RANGES = [
    { key: 'generation-i',    region: 'Kanto',   label: 'Kanto (Generation I)',    short: 'Gen I',    min: 1,    max: 151  },
    { key: 'generation-ii',   region: 'Johto',   label: 'Johto (Generation II)',   short: 'Gen II',   min: 152,  max: 251  },
    { key: 'generation-iii',  region: 'Hoenn',   label: 'Hoenn (Generation III)',  short: 'Gen III',  min: 252,  max: 386  },
    { key: 'generation-iv',   region: 'Sinnoh',  label: 'Sinnoh (Generation IV)',  short: 'Gen IV',   min: 387,  max: 493  },
    { key: 'generation-v',    region: 'Unova',   label: 'Unova (Generation V)',    short: 'Gen V',    min: 494,  max: 649  },
    { key: 'generation-vi',   region: 'Kalos',   label: 'Kalos (Generation VI)',   short: 'Gen VI',   min: 650,  max: 721  },
    { key: 'generation-vii',  region: 'Alola',   label: 'Alola (Generation VII)',  short: 'Gen VII',  min: 722,  max: 809  },
    { key: 'generation-viii', region: 'Galar',   label: 'Galar (Generation VIII)', short: 'Gen VIII', min: 810,  max: 905  },
    { key: 'generation-ix',   region: 'Paldea',  label: 'Paldea (Generation IX)',  short: 'Gen IX',   min: 906,  max: 1025 },
  ];
  // Fallback total if the live species roster fetch fails — updated to
  // the roster's real length once it loads (see loadAllSpecies below).
  let nationalDexMax = GENERATION_RANGES[GENERATION_RANGES.length - 1].max;

  const TYPE_LIST = [
    { key: 'normal',   label: 'Normal',   emoji: '⚪' },
    { key: 'fire',     label: 'Fire',     emoji: '🔥' },
    { key: 'water',    label: 'Water',    emoji: '💧' },
    { key: 'electric', label: 'Electric', emoji: '⚡' },
    { key: 'grass',    label: 'Grass',    emoji: '🌿' },
    { key: 'ice',      label: 'Ice',      emoji: '❄️' },
    { key: 'fighting', label: 'Fighting', emoji: '👊' },
    { key: 'poison',   label: 'Poison',   emoji: '☠️' },
    { key: 'ground',   label: 'Ground',   emoji: '⛰️' },
    { key: 'flying',   label: 'Flying',   emoji: '🪽' },
    { key: 'psychic',  label: 'Psychic',  emoji: '🔮' },
    { key: 'bug',      label: 'Bug',      emoji: '🐛' },
    { key: 'rock',     label: 'Rock',     emoji: '🪨' },
    { key: 'ghost',    label: 'Ghost',    emoji: '👻' },
    { key: 'dragon',   label: 'Dragon',   emoji: '🐉' },
    { key: 'dark',     label: 'Dark',     emoji: '🌑' },
    { key: 'steel',    label: 'Steel',    emoji: '⚙️' },
    { key: 'fairy',    label: 'Fairy',    emoji: '✨' },
  ];

  function client(){
    return window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  }

  function capitalize(s){
    return typeof s === 'string' && s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // PokéAPI species/pokemon "name" fields are lowercase-hyphenated
  // (e.g. "mr-mime", "nidoran-f") — title-cased word-by-word for display,
  // and also what gets matched against a card's own (human-written) name.
  function displayName(slug){
    return String(slug || '').split('-').map(capitalize).join(' ');
  }

  function escapeRegExp(s){
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function idFromUrl(url){
    const m = /\/(\d+)\/?$/.exec(url || '');
    return m ? Number(m[1]) : null;
  }

  async function fetchJson(url){
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if(!res.ok) throw new Error(`PokéAPI returned ${res.status}`);
    return res.json();
  }

  // Static, predictable sprite URLs — no PokéAPI request needed at all.
  // artwork:true gets the bigger "official artwork" image (detail views);
  // otherwise the small in-game sprite (grid tiles). Some very new dex
  // numbers occasionally lack one of these two assets — callers should
  // treat a failed image load as "no artwork," not an error (see
  // attachSpriteFallback below for a ready-made <img> error handler).
  function spriteUrl(dexNumber, opts){
    opts = opts || {};
    return opts.artwork
      ? `${SPRITES_BASE}/other/official-artwork/${dexNumber}.png`
      : `${SPRITES_BASE}/${dexNumber}.png`;
  }

  // Wires one delegated 'error' listener (capture phase — image load
  // errors don't bubble) onto a container so every sprite <img class=
  // "poke-sprite-img" data-fallback="..."> inside it quietly swaps to its
  // fallback (or hides itself with no data-fallback) instead of showing a
  // broken-image icon. Safe to call more than once on the same container
  // — a small dataset flag stops it from double-attaching.
  function attachSpriteFallback(container){
    if(!container || container.dataset.spriteFallbackWired) return;
    container.dataset.spriteFallbackWired = '1';
    container.addEventListener('error', (e) => {
      const img = e.target;
      if(!img || !img.classList || !img.classList.contains('poke-sprite-img')) return;
      const fallback = img.dataset.fallback;
      if(fallback && img.src !== fallback){
        img.src = fallback;
      } else {
        img.style.visibility = 'hidden';
      }
    }, true);
  }

  function dexToGeneration(dexNumber){
    return GENERATION_RANGES.find(g => dexNumber >= g.min && dexNumber <= g.max) || null;
  }

  // The full National Dex roster — id + name only (no types/evolution/
  // sprites — those are fetched per-Pokémon, lazily, only as needed). ONE
  // request total for the whole app's lifetime; PokéAPI's plain resource
  // list endpoint is built exactly for this ("give me every name+url").
  let allSpeciesPromise = null;
  function loadAllSpecies(){
    if(allSpeciesPromise) return allSpeciesPromise;
    allSpeciesPromise = (async () => {
      const data = await fetchJson(`${POKEAPI_BASE}/pokemon-species?limit=${nationalDexMax}`);
      const list = (Array.isArray(data?.results) ? data.results : [])
        .map(r => ({ id: idFromUrl(r.url), name: r.name }))
        .filter(s => s.id && s.id > 0)
        .sort((a, b) => a.id - b.id);
      if(list.length) nationalDexMax = list[list.length - 1].id;
      return list;
    })();
    allSpeciesPromise.catch(() => { allSpeciesPromise = null; }); // let a failed load be retried later
    return allSpeciesPromise;
  }

  // Walks a (possibly branching, e.g. Eevee) evolution-chain tree into
  // one flat, depth-first list. Branch structure isn't kept — a simple
  // "which of these have you got" checklist doesn't need it.
  function flattenEvolutionChain(node, out){
    out = out || [];
    if(!node) return out;
    out.push({ name: node.species?.name, dexNumber: idFromUrl(node.species?.url) });
    (node.evolves_to || []).forEach(child => flattenEvolutionChain(child, out));
    return out;
  }

  // Evolution chains are shared by every member of a family (Bulbasaur,
  // Ivysaur, and Venusaur's species records all point at the same
  // evolution-chain URL) — caching by that URL, separately from the
  // per-species cache below, means checking a whole family's completion
  // only ever fetches the chain once no matter how many of its members
  // get looked up.
  const chainCache = {};
  function loadChain(url){
    if(!url) return Promise.resolve(null);
    if(chainCache[url]) return chainCache[url];
    const promise = fetchJson(url).then(data => flattenEvolutionChain(data?.chain)).catch(() => null);
    chainCache[url] = promise;
    return promise;
  }

  // Full per-Pokémon detail: species (generation, evolution chain link)
  // + pokemon (types, sprites, cries). Cached by dex number, and the
  // in-flight PROMISE is what's cached (not just the eventual value) —
  // several cards on screen in quick succession (Other Printings, a
  // binder page, My Pokédex's own detail view) can easily be the same
  // Pokémon, and this stops overlapping requests for it.
  const infoCache = {};
  function loadPokemonInfo(dexNumber){
    if(infoCache[dexNumber]) return infoCache[dexNumber];
    const promise = (async () => {
      const species = await fetchJson(`${POKEAPI_BASE}/pokemon-species/${dexNumber}`);
      const pokemon = await fetchJson(`${POKEAPI_BASE}/pokemon/${dexNumber}`);
      const evolutionChain = species?.evolution_chain?.url ? await loadChain(species.evolution_chain.url) : null;
      return { species, pokemon, evolutionChain };
    })();
    infoCache[dexNumber] = promise;
    // Don't leave a failed lookup permanently cached — a transient
    // PokéAPI hiccup shouldn't mean this Pokémon never loads again.
    promise.catch(() => { if(infoCache[dexNumber] === promise) delete infoCache[dexNumber]; });
    return promise;
  }

  // Every current member of one type, straight from PokéAPI's own
  // /type/{name} endpoint — ONE request tells us every Fire-type Pokémon
  // at once, instead of asking each of ~1025 Pokémon individually "are
  // you Fire-type?" Used for both the Type filter and the Types stats
  // panel. Cached per type, so switching the filter back and forth (or
  // opening the stats panel after using the filter) never re-fetches.
  const typeMembershipCache = {};
  function loadTypeMembership(typeKey){
    if(typeMembershipCache[typeKey]) return typeMembershipCache[typeKey];
    const promise = (async () => {
      const data = await fetchJson(`${POKEAPI_BASE}/type/${encodeURIComponent(typeKey)}`);
      const ids = new Set(
        (Array.isArray(data?.pokemon) ? data.pokemon : [])
          .map(p => idFromUrl(p.pokemon?.url))
          .filter(id => id && id > 0)
      );
      return ids;
    })();
    typeMembershipCache[typeKey] = promise;
    promise.catch(() => { if(typeMembershipCache[typeKey] === promise) delete typeMembershipCache[typeKey]; });
    return promise;
  }

  // A card's printed name almost always contains the Pokémon's own name
  // as a whole word ("Bulbasaur", "Dark Bulbasaur", "Bulbasaur ex",
  // "Shining Bulbasaur") — this is how a My Collection row (which only
  // stores a free-text card_name, not a dex number) gets matched back to
  // a species without an extra TCGdex lookup per row. \b keeps "Porygon"
  // from matching "Porygon2" or "Porygon-Z", which are different Pokémon.
  function speciesMatchesCardName(speciesSlugOrName, cardName){
    if(!speciesSlugOrName || !cardName) return false;
    const name = displayName(speciesSlugOrName);
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i');
    return re.test(cardName);
  }

  // A row counts for a species if EITHER its stored dex number says so or
  // its printed name contains the species name. The dex number is checked
  // first and is the only thing that works for a Japanese card: リザードンex
  // will never match the word "Charizard", so before rows carried a dex
  // number a Japanese card was invisible to My Pokédex. Name matching
  // stays for every row added before that column existed.
  function rowDexNumber(row){
    const n = Number(row && row.dex_id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function rowIsSpecies(row, speciesSlugOrName, dexNumber){
    const rowDex = rowDexNumber(row);
    if(rowDex !== null && dexNumber) return rowDex === dexNumber;
    return speciesMatchesCardName(speciesSlugOrName, row && row.card_name);
  }

  function ownedSummaryForSpecies(speciesSlugOrName, ownedRows, dexNumber){
    const matches = (ownedRows || []).filter(r => rowIsSpecies(r, speciesSlugOrName, dexNumber));
    const cardCount = matches.reduce((sum, r) => sum + (Number(r.quantity) || 1), 0);
    return { discovered: matches.length > 0, cardCount };
  }

  // Builds { [dexId]: {discovered, cardCount} } for every species in
  // `allSpecies`, from a visitor's My Collection rows — the one
  // computation My Pokédex's whole main screen (and its header stats,
  // Original 151 card, Generations list) is derived from, done once per
  // rows/species snapshot rather than per grid render. Regex per species
  // is compiled once and reused across every row, not recompiled per
  // row×species pair — with realistic collection sizes (tens to a few
  // hundred rows) against ~1025 species this comfortably finishes in well
  // under a second, even though it's technically O(species × rows).
  function computeDiscoveredMap(allSpecies, ownedRows){
    const rows = ownedRows || [];
    const map = {};
    // Rows that already know which Pokémon they are (dex_id, set at add
    // time) are bucketed once up front rather than being re-tested against
    // all ~1025 regexes — and they're the only rows a Japanese card name
    // can ever be counted through, since the regex pass below matches
    // English species names against the printed card name.
    const byDex = {};
    const unlabelled = [];
    for(const row of rows){
      const dex = rowDexNumber(row);
      if(dex !== null) byDex[dex] = (byDex[dex] || 0) + (Number(row.quantity) || 1);
      else unlabelled.push(row);
    }

    for(const species of allSpecies){
      const name = displayName(species.name);
      const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i');
      let cardCount = byDex[species.id] || 0;
      for(const row of unlabelled){
        if(row.card_name && re.test(row.card_name)) cardCount += (Number(row.quantity) || 1);
      }
      map[species.id] = { discovered: cardCount > 0, cardCount };
    }
    return map;
  }


  // ---- The English → Japanese bridge --------------------------------
  //
  // TCGdex keeps a separate Japanese card database (api.tcgdex.net/v2/ja)
  // with its own sets, its own numbering and cards that never got an
  // English printing. It indexes those cards by their JAPANESE name —
  // リザードン, not "Charizard" — and its romaji is NOT searchable: a
  // plain `name=Lizardon` query returns an empty array, verified against
  // the live API. So nobody standing at the counter with a US keyboard
  // can reach a Japanese card by name unless something translates first.
  //
  // Two routes, in this order, because the first is both exact and free:
  //
  //  1. dexId. TCGdex's Japanese cards ARE indexed by National Dex number
  //     (`/ja/cards?dexId=eq:6` returns every Japanese Charizard card),
  //     and loadAllSpecies() below already holds every English name → dex
  //     number in memory after ONE request the app makes anyway. So
  //     "Charizard" → 6 → every Japanese Charizard, with no extra network
  //     call and no translation to get wrong.
  //
  //  2. The Japanese name, when route 1 finds nothing. PokéAPI's species
  //     endpoint carries it (`ja-Hrkt`), one request per Pokémon ever
  //     looked up, cached for the page's lifetime.
  //
  // Neither route reaches Trainer, Item or Energy cards — those aren't
  // Pokémon and have no dex number or species entry. The card search says
  // so plainly rather than returning a silent empty result.

  // Card names people type carry printing suffixes a species name never
  // has ("Charizard ex", "Pikachu VMAX"). Rather than maintain a list of
  // them, resolveSpecies below matches the LONGEST species name the typed
  // text starts with, which handles every suffix past and future — and
  // still won't let "Char" resolve to Charizard.
  function normalizeSpeciesKey(value){
    return String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]/g, '');
  }

  // Typed English text → a species from the roster, or null. Normalizing
  // both sides to letters-and-digits is what lets a name someone types
  // the way it's printed match the roster's slug: "Mr. Mime" → mrmime vs.
  // "mr-mime" → mrmime, "Farfetch'd" → farfetchd, "Type: Null" → typenull.
  async function resolveSpecies(englishName){
    const key = normalizeSpeciesKey(englishName);
    if(!key) return null;
    let all;
    try{ all = await loadAllSpecies(); }catch{ return null; }

    const exact = all.find(s => normalizeSpeciesKey(s.name) === key);
    if(exact) return exact;

    // Longest-prefix wins so "Charizard ex" resolves to Charizard, and
    // "Nidoran" doesn't beat "Nidorina" on a search for Nidorina.
    let best = null;
    let bestLen = 0;
    for(const s of all){
      const k = normalizeSpeciesKey(s.name);
      if(k && key.startsWith(k) && k.length > bestLen){ best = s; bestLen = k.length; }
    }
    return best;
  }

  // { dexNumber, english, japanese, romaji } for a typed English name, or
  // null if it isn't a Pokémon this can place. dexNumber alone is enough
  // for the Japanese card search (route 1 above) — `japanese` is the
  // fallback, and `romaji` is only ever shown to a human, never sent to
  // TCGdex, since TCGdex doesn't match on it.
  const japaneseNameCache = {};
  async function japaneseNameFor(englishName){
    const species = await resolveSpecies(englishName);
    if(!species) return null;
    if(japaneseNameCache[species.id]) return japaneseNameCache[species.id];
    try{
      const data = await fetchJson(`${POKEAPI_BASE}/pokemon-species/${species.id}`);
      const names = Array.isArray(data && data.names) ? data.names : [];
      const pick = (code) => {
        const hit = names.find(n => n && n.language && n.language.name === code);
        return hit ? hit.name : null;
      };
      const japanese = pick('ja-Hrkt') || pick('ja');
      if(!japanese) return null;
      const result = {
        dexNumber: species.id,
        english: displayName(species.name),
        japanese,
        romaji: pick('ja-roma') || pick('roomaji') || null,
      };
      japaneseNameCache[species.id] = result;
      return result;
    }catch{
      return null; // the dexId route above doesn't need this to have worked
    }
  }

  // English name → National Dex number only. Costs nothing beyond the one
  // roster request the app already makes, so the Japanese card search can
  // call it on every query without thinking about it.
  async function dexNumberFor(englishName){
    const species = await resolveSpecies(englishName);
    return species ? species.id : null;
  }

  // My Collection rows (id, card_id, card_name, set_name, image_url,
  // variant, condition, quantity) for the signed-in visitor — the single
  // source My Pokédex is derived from (see file header). Deliberately
  // 'user_cards' only, never 'wishlist_cards' — wanting a card isn't the
  // same as a Pokémon being discovered. Cached per user (the in-flight
  // promise, same "don't let overlapping calls double-fetch" reasoning as
  // everywhere else in this file); invalidateOwnedCollectionCache() below
  // is called after any My Collection add/remove so this never goes stale.
  let ownedRowsPromise = null;
  let ownedRowsUserId = null;
  function fetchOwnedCollectionRows(userId){
    if(ownedRowsPromise && ownedRowsUserId === userId) return ownedRowsPromise;
    ownedRowsUserId = userId;
    ownedRowsPromise = (async () => {
      // rarity/illustrator/set_id added for Collector Goals (card-based
      // goal types — Set Completion, Master Set, Rarity, Artist — see
      // components/collector-goals-data.js); older rows may still have
      // these as null until collection.js's opportunistic backfill
      // touches them. dex_id/card_lang came later still, with the Japanese
      // card support, and only exist once supabase/card_language.sql has
      // been run — so a database that hasn't had it yet drops back to the
      // older column list rather than returning nothing and emptying out
      // somebody's whole Pokédex.
      const BASE = 'id, card_id, card_name, set_name, image_url, variant, condition, quantity, rarity, illustrator, set_id';
      const read = (columns) => client().from('user_cards').select(columns).eq('user_id', userId);
      try{
        let { data, error } = await read(`${BASE}, dex_id, card_lang`);
        if(error){
          const text = `${error.message || ''} ${error.details || ''}`.toLowerCase();
          const missingNewColumn = (text.includes('dex_id') || text.includes('card_lang')) &&
            (text.includes('does not exist') || text.includes('could not find') || text.includes('schema cache'));
          if(missingNewColumn) ({ data, error } = await read(BASE));
        }
        return error ? [] : (data || []);
      }catch{
        return [];
      }
    })();
    return ownedRowsPromise;
  }

  function invalidateOwnedCollectionCache(){
    ownedRowsPromise = null;
    ownedRowsUserId = null;
  }

  window.InfinitePullsPokemonData = {
    GENERATION_RANGES,
    TYPE_LIST,
    get NATIONAL_DEX_MAX(){ return nationalDexMax; },
    displayName,
    capitalize,
    spriteUrl,
    attachSpriteFallback,
    dexToGeneration,
    loadAllSpecies,
    loadPokemonInfo,
    loadChain,
    loadTypeMembership,
    speciesMatchesCardName,
    dexNumberFor,
    japaneseNameFor,
    ownedSummaryForSpecies,
    rowIsSpecies,
    computeDiscoveredMap,
    fetchOwnedCollectionRows,
    invalidateOwnedCollectionCache,
  };
})();
