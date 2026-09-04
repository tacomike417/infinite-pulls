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
      searchPlaceholder: 'e.g. Charizard, 134, or 234/265',
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
      searchPlaceholder: 'e.g. Umbreon VMAX, 134, or 234/265',
      signedOutBody: 'Create a free account to build a wish list of cards you\'re looking for.'
    }
  };

  // TCGdex: free, open-source, no API key required, and includes real
  // TCGplayer + Cardmarket pricing per card — unlike pokemontcg.io (which
  // this replaced), it isn't a legacy product being wound down. See
  // https://tcgdex.dev for docs. Card search only returns "brief" cards
  // (id/name/image, no pricing) — full pricing needs a second fetch per
  // card, done lazily only once a visitor picks a specific result below.
  // TCGdex is multilingual: the language sits in the URL path, and each
  // language is its OWN card database — not translations of the same
  // rows. /v2/ja has Japanese sets, Japanese set numbering, and cards
  // that never got an English printing at all. The same Pokémon in the
  // same artwork carries a different number in each, which is exactly
  // what makes a single hardcoded language wrong here.
  const TCGDEX_ROOT = 'https://api.tcgdex.net/v2';

  const LANGUAGES = {
    en: { code: 'en', short: 'EN', label: 'English',  native: 'English' },
    ja: { code: 'ja', short: 'JP', label: 'Japanese', native: '日本語' },
  };
  const DEFAULT_LANG = 'en';

  function langOf(value){
    return LANGUAGES[value] ? value : DEFAULT_LANG;
  }

  function tcgdexBase(lang){
    return `${TCGDEX_ROOT}/${langOf(lang)}`;
  }

  // Which database the SEARCH box is pointed at. Only ever changed by the
  // language switch on the search form — never inferred from a card,
  // because a card already knows its own language (see cardLang below)
  // and a card someone owns must keep resolving against the database it
  // came from no matter what the switch happens to be set to today.
  let searchLang = DEFAULT_LANG;

  // Every card object this file hands around is stamped with the database
  // it came out of, so any follow-up request about that card (its full
  // detail, its set, its other printings, its price) goes back to the
  // right one. A card from a search result grid carries the stamp from
  // the search; a card opened out of somebody's collection carries the
  // stamp saved on their row.
  function stampLang(card, lang){
    if(card && typeof card === 'object') card._lang = langOf(lang);
    return card;
  }

  function stampAll(cards, lang){
    if(Array.isArray(cards)) cards.forEach(c => stampLang(c, lang));
    return cards;
  }

  function cardLang(card){
    return langOf(card && card._lang);
  }

  function isJapanese(card){
    return cardLang(card) === 'ja';
  }

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

  // Shared small, lightweight toast (not a modal — the Add-to-Collection
  // flow above it already just said "Added!" and moves on) — used for
  // both the "NEW POKÉDEX ENTRY!" moment below and the "GOAL COMPLETE!"
  // moment a Collector Goal fires when it crosses from incomplete to
  // complete (see checkGoalCompletionsAfterAdd below). One shared visual
  // language for "something you didn't have to ask for just happened."
  function showAppToast(innerHtml){
    const toast = document.createElement('div');
    toast.className = 'pokedex-toast';
    toast.innerHTML = innerHtml;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('pokedex-toast-in'));
    setTimeout(() => {
      toast.classList.remove('pokedex-toast-in');
      setTimeout(() => toast.remove(), 400);
    }, 3200);
  }

  // "NEW POKÉDEX ENTRY!" — shown only the moment a card causes a Pokémon
  // to be represented in My Collection for the very first time. See the
  // add-card-form submit handler below for when this fires; My Pokédex
  // itself (components/pokedex.js) is what actually tracks discovery —
  // this is just a nod to it at the moment it happens.
  function showNewPokedexEntryToast(dexNumber, name){
    showAppToast(`
      <strong>NEW POKÉDEX ENTRY!</strong>
      <span>#${String(dexNumber).padStart(3, '0')} ${escapeHtml(name).toUpperCase()}</span>
      <small>Added to My Pokédex</small>
    `);
  }

  // "GOAL COMPLETE!" — shown the moment a selected Collector Goal crosses
  // from incomplete to complete because of a card just added. Fires at
  // most one toast per add even if several goals complete at once (e.g.
  // one card happens to finish both a set and a rarity goal) — a stack of
  // toasts would stop being "not obnoxious" fast.
  function showGoalCompleteToast(newlyCompleted){
    if(!newlyCompleted || !newlyCompleted.length) return;
    if(newlyCompleted.length === 1){
      const { eff, progress } = newlyCompleted[0];
      showAppToast(`
        <strong>GOAL COMPLETE!</strong>
        <span>${escapeHtml(eff.icon || '🏆')} ${escapeHtml(eff.name).toUpperCase()}</span>
        <small>${escapeHtml(progress.primaryLabel)}</small>
      `);
    } else {
      showAppToast(`
        <strong>GOALS COMPLETE!</strong>
        <span>🏆 ${newlyCompleted.length} goals at once</span>
        <small>${newlyCompleted.map(n => escapeHtml(n.eff.name)).join(' · ')}</small>
      `);
    }
  }

  // Fires after a successful My Collection insert — not awaited by the
  // caller (see the submit handler below), since Collector Goals are an
  // extra, optional layer on top of the core add-to-collection flow and
  // shouldn't ever make adding a card feel slower. Silently does nothing
  // if the visitor hasn't selected any goals, or if Collector Goals isn't
  // loaded for some reason.
  async function checkGoalCompletionsAfterAdd(userId){
    const cg = window.InfinitePullsCollectorGoals;
    if(!cg) return;
    try{
      const { newlyCompleted } = await cg.checkAndUpdateGoalCompletions(userId);
      showGoalCompleteToast(newlyCompleted);
    }catch{ /* not worth surfacing — the card itself was already added fine */ }
  }

  // The two newest columns (card_lang, dex_id) only exist once
  // supabase/card_language.sql has been run. If the code reaches a
  // database that hasn't had it yet, Postgres rejects the whole select for
  // naming a column that isn't there — which would blank out somebody's
  // entire collection over a feature they aren't even using. So every read
  // and write that mentions those columns knows how to drop them and try
  // again. Deploy order stops being something anyone has to get right.
  const NEW_COLUMNS = ['card_lang', 'dex_id'];

  function isMissingNewColumn(error){
    const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    return NEW_COLUMNS.some(c => text.includes(c)) &&
      (text.includes('does not exist') || text.includes('could not find') || text.includes('schema cache'));
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
  //
  // THE TIMEOUT IS NOT OPTIONAL. A browser fetch with no signal has no
  // timeout of its own — it waits on the operating system, which can be
  // minutes. Without it, a slow or unreachable TCGdex did not fail here,
  // it hung: three sequential attempts that each waited indefinitely,
  // with backoff between them, while the page sat there looking frozen
  // and the visitor had no idea anything was wrong.
  //
  // Eight seconds is generous for a JSON call. Three attempts puts the
  // worst case near 25 seconds and, crucially, bounded — after which the
  // caller shows a real message instead of a spinner forever.
  const TCGDEX_TIMEOUT_MS = 8000;

  /* Goes through components/tcgdex-cache.js, which reads our own copy in
     Supabase first and only reaches TCGdex when that copy is old — and
     which serves the old copy anyway if TCGdex is not answering. Read the
     header of that file for why.

     `attempts` is kept in the signature because call sites pass it, but
     retrying is now the cache layer's business, not this function's: when
     upstream is down, a second and third attempt buy nothing that the
     stored copy has not already given us. */
  async function fetchTcgdex(url, attempts = 3){
    const cache = window.InfinitePullsTcgdex;
    if(cache) return cache.fetch(url);

    // tcgdex-cache.js did not load. Old behaviour, still bounded.
    let lastErr;
    for(let i = 0; i < attempts; i++){
      try{
        const res = await fetch(url, { signal: AbortSignal.timeout(TCGDEX_TIMEOUT_MS) });
        if(res.ok) return await res.json();
        lastErr = new Error('TCGdex returned ' + res.status);
      }catch(err){
        lastErr = err;
        if(err && (err.name === 'TimeoutError' || err.name === 'AbortError')) break;
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

  async function searchCards(term, lang){
    lang = langOf(lang === undefined ? searchLang : lang);
    const cleaned = term.trim();
    if(!cleaned) return [];
    try{
      const [json, setIndex] = await Promise.all([
        fetchTcgdex(`${tcgdexBase(lang)}/cards?name=${encodeURIComponent(cleaned)}`),
        loadSetIndex(lang),
      ]);
      if(!Array.isArray(json)) return [];
      // Newest first, and with the set attached — neither was possible
      // before, because a brief carries no set at all.
      const stamped = stampSets(stampAll(json, lang), setIndex);
      return sortByNewestSet(stamped, setIndex).slice(0, SEARCH_RESULT_LIMIT);
    }catch{
      throw new Error('Card search is having trouble right now — try again in a moment.');
    }
  }

  // Every Japanese card whose Pokémon is dex number N. This is the whole
  // trick that lets an English keyboard reach the Japanese database: see
  // the bridge in components/pokemon-data.js for why dexId is the primary
  // route and the translated name is only the fallback.
  async function searchCardsByDex(dexNumber, lang){
    lang = langOf(lang === undefined ? searchLang : lang);
    if(!dexNumber) return [];
    try{
      const [json, setIndex] = await Promise.all([
        fetchTcgdex(`${tcgdexBase(lang)}/cards?dexId=eq:${encodeURIComponent(dexNumber)}`),
        loadSetIndex(lang),
      ]);
      if(!Array.isArray(json)) return [];
      const stamped = stampSets(stampAll(json, lang), setIndex);
      return sortByNewestSet(stamped, setIndex).slice(0, SEARCH_RESULT_LIMIT);
    }catch{
      return [];
    }
  }

  // A typed English name → Japanese results, by both routes, merged and
  // de-duplicated. Returns what it found AND how it got there, because
  // the search screen tells the visitor which Pokémon it decided they
  // meant — "Showing Japanese cards for Charizard (リザードン)" — so a
  // wrong guess is visible rather than silently returning odd cards.
  async function searchJapaneseFromEnglish(term){
    const pd = window.InfinitePullsPokemonData;
    if(!pd || typeof pd.dexNumberFor !== 'function'){
      return { cards: [], species: null, reason: 'bridge-missing' };
    }

    let dexNumber = null;
    try{ dexNumber = await pd.dexNumberFor(term); }catch{ /* fall through */ }

    let cards = [];
    if(dexNumber) cards = await searchCardsByDex(dexNumber, 'ja');

    // Fallback route: the translated name. Also the only route that can
    // pick up a card whose dexId TCGdex hasn't filled in for the Japanese
    // database yet — which does happen, so this isn't dead code.
    let species = null;
    if(dexNumber !== null){
      try{ species = await pd.japaneseNameFor(term); }catch{ /* optional */ }
    }
    if(species && species.japanese){
      let byName = [];
      try{ byName = await searchCards(species.japanese, 'ja'); }catch{ /* optional */ }
      const seen = new Set(cards.map(c => c.id));
      cards = cards.concat(byName.filter(c => !seen.has(c.id)));
    }

    if(!dexNumber && !species){
      // Not a Pokémon this can place — a Trainer, an Item, an Energy, or
      // simply a misspelling. Saying which is more use than "no results".
      return { cards: [], species: null, reason: 'not-a-pokemon' };
    }

    return {
      cards: cards.slice(0, SEARCH_RESULT_LIMIT),
      species: species || (dexNumber ? { dexNumber, english: term, japanese: null, romaji: null } : null),
      reason: null,
    };
  }

  // People naturally search the way the back of a real card reads —
  // "Charizard 199" or "Charizard #199" — but TCGdex's name search only
  // matches against the card's NAME, so a trailing card number just made
  // the whole search match nothing. This splits a number off the end of
  // the query (only when it's preceded by a space or "#", so it doesn't
  // misfire on a name that's genuinely got a digit in it, like Porygon2)
  // so the name search still runs on just the name part, and the number
  // is used to narrow the results afterward — see matchesCardNumber below.
  function parseSearchTerm(term){
    const cleaned = term.trim();

    // Number-only queries. Two shapes, both of which people type straight
    // off the bottom-right of a physical card:
    //   "234/265" — card number AND set size, which together pin down one
    //               printing almost exactly
    //   "134"     — just the number, which could mean either the set number
    //               or a National Dex number, so we go looking for both
    const numbered = cleaned.match(/^#?\s*(\d{1,4}[a-zA-Z]?)\s*(?:\/\s*(\d{1,4}))?$/);
    if(numbered){
      return { namePart: '', number: numbered[1], setTotal: numbered[2] || null, numberOnly: true };
    }

    const match = cleaned.match(/^(.+?)(?:\s+#?|#)(\d{1,4}[a-zA-Z]?)(?:\s*\/\s*\d+)?$/);
    if(!match || !match[1].trim()) return { namePart: cleaned, number: null, setTotal: null, numberOnly: false };
    return { namePart: match[1].trim(), number: match[2], setTotal: null, numberOnly: false };
  }

  // The card-number half of the Card Brief object (localId) sometimes has
  // leading zeros TCGdex-side ("004") that a visitor wouldn't naturally
  // type ("4") — normalize both sides before comparing so that still
  // counts as a match.
  function matchesCardNumber(localId, number){
    if(localId === undefined || localId === null) return false;
    const a = String(localId).trim().toLowerCase();
    const b = String(number).trim().toLowerCase();
    if(a === b) return true;
    return a.replace(/^0+(?=\d)/, '') === b.replace(/^0+(?=\d)/, '');
  }

  // TCGdex's card objects carry no release date (only the full Set object
  // does), so sorting a big result set by recency would otherwise mean one
  // /sets/{id} request per distinct set. The /sets list is a single request
  // that covers every set at once — fetched lazily, cached for the session,
  // and entirely optional: if it fails or carries no dates, results simply
  // stay in the order TCGdex returned them.
  // Sorting a big result set newest-first needs to know when each set came
  // out. The obvious source is the release date on the set — except the
  // bulk /sets list does NOT carry one. Checked against the live API: all
  // 218 English sets come back with id, name, logo, symbol and cardCount,
  // and not one of them has a releaseDate. Only the per-set detail
  // endpoint has it, and fetching 218 of those to sort one search would be
  // absurd.
  //
  // This used to read set.releaseDate off that list, which meant the map
  // was always empty and sortByNewestSet never actually sorted anything —
  // results came back in whatever order TCGdex returned them, silently.
  //
  // The list is itself in release order (Base Set first, newest last), so
  // a set's POSITION in it is the release ordering, free, in the one
  // request already being made. That's what's used now.
  // A card list response is thinner than it looks. Verified against the
  // live API: a "brief" card is EXACTLY { id, localId, name, image } — no
  // set object at all, in either language. Every set-aware thing this file
  // wanted to do off a search result was therefore reading undefined:
  // the set name under each result, narrowing "052/225" to a 225-card set,
  // and sorting by newest.
  //
  // But a card's id already contains its set: svp-052 is card 052 of set
  // svp, SV3-066 is 066 of SV3. Everything before the LAST hyphen is the
  // set id. Checked against 239 cards across both languages — no misses.
  // Joined to the set list (one request, already cached) that gives back
  // the set's name, its size and its release position, for free.
  function setIdFromCardId(cardId){
    const id = String(cardId || '');
    const at = id.lastIndexOf('-');
    return at > 0 ? id.slice(0, at) : '';
  }

  // The set behind a card, whether or not the card object carries one.
  function setInfoFor(card, setIndex){
    if(card?.set?.id && card.set.name) return card.set;
    if(card?._set) return card._set;
    const derived = setIndex ? setIndex[setIdFromCardId(card?.id)] : null;
    return derived || null;
  }

  // Attaches the set to every card in a list. Search results are briefs
  // with no set of their own, so without this the grid under a search has
  // no set name to show and nothing to sort by.
  function stampSets(cards, setIndex){
    if(Array.isArray(cards) && setIndex){
      cards.forEach(c => {
        if(c && !c.set) {
          const info = setIndex[setIdFromCardId(c.id)];
          if(info) c._set = info;
        }
      });
    }
    return cards;
  }

  const setIndexPromises = {};
  function loadSetIndex(lang){
    lang = langOf(lang === undefined ? searchLang : lang);
    if(setIndexPromises[lang]) return setIndexPromises[lang];
    setIndexPromises[lang] = (async () => {
      try{
        const sets = await fetchTcgdex(`${tcgdexBase(lang)}/sets`, 1);
        if(!Array.isArray(sets)) return {};
        const index = {};
        sets.forEach((set, i) => {
          if(!set?.id) return;
          index[set.id] = { id: set.id, name: set.name, logo: set.logo || null, cardCount: set.cardCount || null, order: i };
        });
        return index;
      }catch{
        return {};
      }
    })();
    setIndexPromises[lang].catch(() => { setIndexPromises[lang] = null; });
    return setIndexPromises[lang];
  }

  // Newest set first. The set list arrives in release order, so a set's
  // position in it IS its recency — and setIdFromCardId above is what
  // finally makes that reachable from a search result.
  function sortByNewestSet(cards, setIndex){
    return cards
      .map((card, i) => {
        const info = setInfoFor(card, setIndex);
        const order = info && typeof info.order === 'number' ? info.order : null;
        return { card, i, order };
      })
      .sort((a, b) => {
        if(a.order !== null && b.order !== null && a.order !== b.order) return b.order - a.order;
        if(a.order !== null && b.order === null) return -1;
        if(a.order === null && b.order !== null) return 1;
        return a.i - b.i;   // stable: unknown sets keep their original order
      })
      .map(x => x.card);
  }

  async function searchByNumber(number, setTotal, lang){
    lang = langOf(lang === undefined ? searchLang : lang);
    const base = tcgdexBase(lang);
    const isPlainNumber = /^\d{1,4}$/.test(number);
    const dexNum = isPlainNumber ? parseInt(number, 10) : null;
    const wantDex = !setTotal && dexNum !== null && dexNum >= 1 && dexNum <= 1200;

    const [bySetNumber, byDex, setIndex] = await Promise.all([
      // NOT localId=eq:. Verified against the live API: the eq: operator
      // returns ZERO rows on this field for every value tried — eq:052 and
      // eq:52 both give nothing, while the plain (laxist) form gives 214.
      // So every number search this app has ever run came back empty here
      // and quietly fell through to the National Dex route.
      //
      // The plain form is a substring match, which brings in near misses
      // (a search for 52 also matching 152), so the exact comparison is
      // done here instead — by matchesCardNumber, which was already
      // written for precisely this and was simply never reached.
      fetchTcgdex(`${base}/cards?localId=${encodeURIComponent(number)}`)
        .then(r => Array.isArray(r) ? stampAll(r.filter(c => matchesCardNumber(c.localId, number)), lang) : [])
        .catch(() => []),
      wantDex
        ? fetchTcgdex(`${base}/cards?dexId=eq:${dexNum}`, 1)
            .then(r => Array.isArray(r) ? stampAll(r, lang) : [])
            .catch(() => [])
        : Promise.resolve([]),
      loadSetIndex(lang),
    ]);

    let setMatches = bySetNumber;
    let setTotalMissed = false;
    if(setTotal){
      // The set total is the other half of a printed card number and it is
      // what makes "052/225" mean one card rather than a hundred and forty.
      // It could never work before: this read c.set.cardCount.official off
      // a brief, and briefs carry no set. setInfoFor looks it up from the
      // card's id instead.
      const want = String(parseInt(setTotal, 10));
      const exact = bySetNumber.filter(c => {
        const info = setInfoFor(c, setIndex);
        return info && String(info.cardCount?.official || '') === want;
      });
      if(exact.length) setMatches = exact;
      else setTotalMissed = bySetNumber.length > 0;
    }

    // A card can legitimately answer to both readings (a Vaporeon that is
    // also #134 in its set). Show it once, under the set-number heading.
    const seen = new Set(setMatches.map(c => c.id));
    const dexMatches = byDex.filter(c => !seen.has(c.id));

    return {
      setMatches: sortByNewestSet(stampSets(setMatches, setIndex), setIndex).slice(0, SEARCH_RESULT_LIMIT),
      dexMatches: sortByNewestSet(stampSets(dexMatches, setIndex), setIndex).slice(0, SEARCH_RESULT_LIMIT),
      setTotalMissed,
    };
  }

  // `lang` is required in spirit even though it defaults: a card id alone
  // does not say which database it lives in, and asking the wrong one for
  // a Japanese id just 404s. Callers pass the stamp from the card they're
  // following, or the language saved on the owner's row.
  async function fetchCardDetail(id, lang){
    lang = langOf(lang === undefined ? searchLang : lang);
    return stampLang(await fetchTcgdex(`${tcgdexBase(lang)}/cards/${encodeURIComponent(id)}`), lang);
  }

  // Used when a card id was saved before rows recorded their language, or
  // if a row's language is somehow wrong: try the language we believe,
  // then the other one, rather than showing "could not load that card"
  // for a card the visitor definitely owns.
  async function fetchCardDetailAnyLang(id, preferredLang){
    const first = langOf(preferredLang);
    try{
      return await fetchCardDetail(id, first);
    }catch(err){
      const others = Object.keys(LANGUAGES).filter(l => l !== first);
      for(const other of others){
        try{ return await fetchCardDetail(id, other); }catch{ /* keep trying */ }
      }
      throw err;
    }
  }

  // A bigger picture for the detail view than the thumbnail grid uses.
  function fullImageUrl(image){
    return image ? `${image}/high.webp` : '';
  }

  // Release date only lives on the FULL Set object (not the brief one
  // embedded in a card), so it needs its own fetch — cached by set ID
  // since most searches turn up several cards from the same set.
  const setDetailCache = {};
  async function fetchSetDetail(setId, lang){
    lang = langOf(lang === undefined ? searchLang : lang);
    if(!setId) return null;
    // Keyed by language as well as id — Japanese and English set ids look
    // alike (SV3 vs sv3) and caching one under the other's key would show
    // the wrong release date.
    const key = `${lang}:${setId}`;
    if(setDetailCache[key]) return setDetailCache[key];
    try{
      const data = await fetchTcgdex(`${tcgdexBase(lang)}/sets/${encodeURIComponent(setId)}`);
      setDetailCache[key] = data;
      return data;
    }catch{
      return null; // release date just won't show for this card — not worth failing the whole detail view over
    }
  }

  function formatReleaseDate(dateStr){
    if(!dateStr) return null;
    try{
      return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    }catch{
      return dateStr;
    }
  }

  // The same card gets printed across different sets/years (a base
  // Charizard vs. a modern reprint) — TCGdex has no direct "other
  // printings" endpoint, so this does an EXACT name match (the `eq:`
  // filter, unlike a plain search, only matches the identical name —
  // see the TCGdex filtering docs) and drops the card already being
  // looked at.
  async function fetchOtherPrintings(card){
    if(!card?.name) return [];
    const lang = cardLang(card);
    try{
      const json = await fetchTcgdex(`${tcgdexBase(lang)}/cards?name=eq:${encodeURIComponent(card.name)}`);
      return Array.isArray(json) ? stampAll(json.filter(c => c.id !== card.id).slice(0, 24), lang) : [];
    }catch{
      return [];
    }
  }

  function priceRowsHtml(card, ebayPrice){
    const tcg = card?.pricing?.tcgplayer || {};
    const variantKeys = Object.keys(tcg).filter(k => k !== 'updated' && k !== 'unit');
    const tcgRows = variantKeys.map(key => {
      const price = tcg[key]?.marketPrice;
      return `
        <div class="info-row">
          <span>TCGplayer · ${escapeHtml(VARIANT_LABELS[key] || key)}</span>
          <strong>${typeof price === 'number' ? currency(price) : 'No market price'}</strong>
        </div>
      `;
    }).join('');

    // Cardmarket pricing on TCGdex is in EUR, not USD — shown with its
    // own € prefix rather than reusing currency() so it's never mistaken
    // for a dollar figure.
    const cm = card?.pricing?.cardmarket;
    const cmTrend = typeof cm?.trend === 'number' ? cm.trend
      : (typeof cm?.['trend-holo'] === 'number' ? cm['trend-holo'] : null);
    // When a card has no TCGplayer price, the Cardmarket figure is the only
    // thing standing between it and counting as zero — so the converted
    // dollar value is shown right beside the euro one, marked as converted.
    // This is the card Jeff reported: svp-052 Mewtwo, €65.65 and no US
    // price at all.
    const fx = lastFxRate;
    const convertedHere = (cmTrend !== null && !tcgRows && fx && fx.rate)
      ? Math.round(cmTrend * fx.rate * 100) / 100
      : null;
    const cmRow = cmTrend !== null
      ? `<div class="info-row"><span>Cardmarket · Trend Price</span><strong>€${cmTrend.toFixed(2)}${convertedHere !== null ? ` <small style="color:var(--muted); font-weight:normal;">≈ ${escapeHtml(currency(convertedHere))}</small>` : ''}</strong></div>`
      : '';

    // eBay row goes right under Cardmarket, per how this section is
    // ordered — clearly labeled as a *current asking price*, not a sold
    // price, since that's the honest distinction (see fetchEbayPrice).
    // Quietly omitted whenever eBay pricing isn't configured/available.
    const ebayRow = ebayPrice?.available
      ? `
        <div class="info-row">
          <span>eBay · Current Listings</span>
          <strong>${currency(ebayPrice.median)} <small style="color:var(--muted); font-weight:normal;">median of ${ebayPrice.count}</small></strong>
        </div>
        <p><small>eBay figure is the current asking price across active listings (not a confirmed sold price) — range ${currency(ebayPrice.low)}–${currency(ebayPrice.high)}.</small></p>
      `
      : '';

    // Japanese cards need the extra sentence. TCGdex carries no TCGplayer
    // data for them, so the US market-price rows above are simply absent —
    // without saying why, an empty Prices box reads as "this card is
    // worthless" rather than "the US price source doesn't cover it". What
    // IS there for a Japanese card is Cardmarket (a European marketplace,
    // in euros) and the eBay row, which is the only figure here quoted in
    // dollars off a market that actually trades Japanese singles.
    const convertedNote = convertedHere !== null
      ? `<p><small>No US market price for this card, so <strong>≈ ${escapeHtml(currency(convertedHere))}</strong> is what its collection value counts as — Cardmarket's European price converted${fx.date ? ` at the ${escapeHtml(fx.date)} rate` : ''}. A guide, not a quote.</small></p>`
      : '';

    const jpNote = isJapanese(card) && !tcgRows
      ? `<p><small>No TCGplayer price: TCGdex doesn't carry US market data for Japanese cards.${cmRow ? ' The Cardmarket figure above is a European marketplace price, in euros.' : ''}${ebayRow ? ' The eBay figure is the dollar number to go by.' : ''}</small></p>`
      : '';

    return (tcgRows || cmRow || ebayRow)
      ? `${tcgRows}${cmRow}${ebayRow}${convertedNote}${jpNote}`
      : `<p><small>No pricing available for this card yet.${isJapanese(card) ? ' TCGdex carries no US market data for Japanese cards, and eBay had too few live listings of this one to average.' : ''}</small></p>`;
  }

  // ---- Snap-to-scan ---------------------------------------------------
  //
  // This used to read the card's NAME and it essentially never worked. The
  // name is the single hardest text on a Pokémon card to machine-read: a
  // stylized display face, often laid over holo foil and busy artwork, and
  // the old code shrank the whole photo to 1200px before looking at it,
  // which left the name around forty pixels tall. Tesseract's model is
  // trained on document text — dark body copy on pale paper — so that was
  // close to a worst-case input. Then `extractNameCandidates` threw away
  // any line containing a digit, which discarded the one piece of text on
  // the card that actually reads cleanly.
  //
  // So this reads the NUMBER instead — "199/165", printed small and dark
  // in a corner, on a plain background, in a plain font, with no artwork
  // behind it. It is the most legible text on the card AND the most
  // identifying: a name search for Charizard returns a hundred printings,
  // while a number plus a set total pins down essentially one. The app
  // already knew how to search that way (parseSearchTerm and
  // searchByNumber, both used by the typed search box) — the scanner just
  // never called it.
  //
  // The number also happens to be language-independent, which is why the
  // scanner can find a Japanese card whose name nobody at the counter
  // could type. See searchScannedNumber below.
  //
  // Honest about the ceiling: this is still Tesseract in a browser, not a
  // card-recognition service. It will not be right every time. The name
  // pass is kept as a fallback, and a plain search box sits underneath
  // both, so a failed scan costs a few seconds and never blocks anyone.

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

  // One worker, reused for every pass of every scan. Spinning one up costs
  // a couple of seconds (it fetches the recognition model), and this scan
  // makes several passes over different crops — a worker per pass would
  // make the whole thing unusably slow. Kept alive for the page's life.
  let ocrWorkerPromise = null;
  function getOcrWorker(){
    if(ocrWorkerPromise) return ocrWorkerPromise;
    ocrWorkerPromise = (async () => {
      await loadTesseract();
      return await window.Tesseract.createWorker('eng');
    })();
    ocrWorkerPromise.catch(() => { ocrWorkerPromise = null; }); // let a failed load be retried
    return ocrWorkerPromise;
  }

  // Full-resolution-ish, unlike the old downscale-to-1200. A crop of the
  // bottom strip gets scaled UP before it's read, so throwing pixels away
  // at load time is exactly backwards — but a 4000px phone photo still
  // gets a ceiling so a mid-range phone doesn't run out of memory.
  const SCAN_MAX_DIM = 2400;
  function loadImageToCanvas(file, maxDim){
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

  // Cuts a region out by fractions of the whole image and scales it up to
  // a target height. Tesseract wants roughly 30-40px of x-height to work
  // with; a card number in a phone photo is nowhere near that, so this
  // enlarges the crop rather than handing over something too small to read.
  function cropRegion(src, fx, fy, fw, fh, targetHeight){
    const sx = Math.max(0, Math.round(src.width * fx));
    const sy = Math.max(0, Math.round(src.height * fy));
    const sw = Math.max(1, Math.min(src.width - sx, Math.round(src.width * fw)));
    const sh = Math.max(1, Math.min(src.height - sy, Math.round(src.height * fh)));
    const scale = Math.max(1, targetHeight / sh);
    const out = document.createElement('canvas');
    out.width = Math.round(sw * scale);
    out.height = Math.round(sh * scale);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out;
  }

  // Grayscale, stretch the contrast, then hard-threshold to pure black and
  // white using Otsu's method (the standard "split the histogram where it
  // separates best" rule). Card corners are printed on a light strip most
  // of the time but a dark one often enough to matter, so afterwards this
  // checks which tone is in the minority and flips the image if needed —
  // Tesseract expects dark text on a light ground, and text is always the
  // minority of the pixels in a crop like this.
  // Local (adaptive) thresholding, as a second opinion when the global one
  // fails.
  //
  // Otsu below picks ONE cut point for the whole crop, which assumes the
  // crop is lit evenly. Tested on real cards, that assumption breaks in a
  // very specific and very common way: a card on a glass desk reads
  // nothing, and the same card on a black mat reads fine. Glass throws
  // reflections and shows whatever is under it, so one half of the strip
  // is blown out and the other is in shadow — and any single threshold
  // that keeps the bright half legible crushes the dark half, and the
  // other way round.
  //
  // This compares every pixel to the average of the window AROUND it
  // instead, so a bright patch and a dark patch each get judged on their
  // own terms. Computed off an integral image so the window size costs
  // nothing — a naive version would be far too slow on a phone.
  function adaptiveBinarize(canvas, windowFraction, bias){
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = img.data;
    const w = canvas.width, h = canvas.height;

    const gray = new Uint8Array(w * h);
    for(let i = 0, g = 0; i < px.length; i += 4, g++){
      gray[g] = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    }

    // Integral image: sum of every pixel above and left. One pass to
    // build, then any rectangle's total is four lookups.
    const integral = new Float64Array((w + 1) * (h + 1));
    for(let y = 0; y < h; y++){
      let rowSum = 0;
      for(let x = 0; x < w; x++){
        rowSum += gray[y * w + x];
        integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
      }
    }

    const radius = Math.max(4, Math.floor(Math.min(w, h) * (windowFraction || 0.2)));

    // Which tone is the text? Decided ONCE for the whole crop rather than
    // per pixel: a card number is dark on a light strip far more often
    // than the reverse, but the reverse does happen, so this measures it.
    let total = 0;
    for(let g = 0; g < gray.length; g++) total += gray[g];
    const mean = total / gray.length;
    let darkCount = 0;
    for(let g = 0; g < gray.length; g++) if(gray[g] < mean) darkCount++;
    const textIsDark = darkCount <= gray.length / 2;

    const cut = typeof bias === 'number' ? bias : 0.92;

    for(let y = 0; y < h; y++){
      const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
      for(let x = 0; x < w; x++){
        const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const sum =
            integral[(y1 + 1) * (w + 1) + (x1 + 1)]
          - integral[y0 * (w + 1) + (x1 + 1)]
          - integral[(y1 + 1) * (w + 1) + x0]
          + integral[y0 * (w + 1) + x0];
        const localMean = sum / area;
        const g = gray[y * w + x];
        const on = textIsDark ? (g < localMean * cut) : (g > localMean * (2 - cut));
        const v = on ? 0 : 255;
        const i = (y * w + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = v;
        px[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function binarizeForOcr(canvas){
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = img.data;
    const n = canvas.width * canvas.height;

    const gray = new Uint8Array(n);
    const hist = new Uint32Array(256);
    for(let i = 0, g = 0; i < px.length; i += 4, g++){
      const v = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
      gray[g] = v;
      hist[v]++;
    }

    // Otsu: pick the threshold maximising between-class variance.
    let sum = 0;
    for(let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = 0, threshold = 128;
    for(let t = 0; t < 256; t++){
      wB += hist[t];
      if(!wB) continue;
      const wF = n - wB;
      if(!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if(between > best){ best = between; threshold = t; }
    }

    let dark = 0;
    for(let g = 0; g < n; g++) if(gray[g] <= threshold) dark++;
    const invert = dark > n / 2; // text should be the minority tone

    for(let i = 0, g = 0; i < px.length; i += 4, g++){
      let on = gray[g] <= threshold;
      if(invert) on = !on;
      const v = on ? 0 : 255;
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  async function readText(worker, canvas, whitelist, psm){
    try{
      await worker.setParameters({
        tessedit_char_whitelist: whitelist,
        tessedit_pageseg_mode: String(psm),
      });
      const { data } = await worker.recognize(canvas);
      return (data && data.text) || '';
    }catch{
      return '';
    }
  }

  // Where a card number sits. Modern English cards print it bottom-left,
  // older ones bottom-right, Japanese cards bottom-left with the set code
  // beside it — and a photo taken by hand usually has some table showing
  // around the card, so the strips are deliberately generous rather than
  // tight. Ordered cheapest-and-likeliest first; the scan stops at the
  // first region that yields a usable number.
  const NUMBER_REGIONS = [
    { fx: 0.00, fy: 0.86, fw: 1.00, fh: 0.14, psm: 11, label: 'bottom strip' },
    { fx: 0.00, fy: 0.82, fw: 0.50, fh: 0.18, psm: 7,  label: 'bottom left' },
    { fx: 0.50, fy: 0.82, fw: 0.50, fh: 0.18, psm: 7,  label: 'bottom right' },
    { fx: 0.00, fy: 0.74, fw: 1.00, fh: 0.26, psm: 11, label: 'lower quarter' },
  ];

  // When the card was framed in the guide, the image IS the card — no
  // table, no fingers, no rotation to speak of. So the corner can be cut
  // much tighter, which is most of why guided scans beat casual ones: the
  // regions above have to be generous enough to survive a card sitting
  // small and crooked in a snapshot, and generous means the crop is mostly
  // things that aren't the number.
  const GUIDED_NUMBER_REGIONS = [
    { fx: 0.02, fy: 0.88, fw: 0.46, fh: 0.11, psm: 7,  label: 'number corner' },
    { fx: 0.00, fy: 0.86, fw: 1.00, fh: 0.14, psm: 11, label: 'bottom strip' },
    { fx: 0.52, fy: 0.88, fw: 0.46, fh: 0.11, psm: 7,  label: 'bottom right' },
  ];

  // A Pokémon card is 63 × 88 mm. The guide uses that exact ratio so a
  // card that fills the frame really is the whole image.
  const CARD_ASPECT = 63 / 88;

  // Pulls "199/165" shapes out of whatever the OCR returned, in reading
  // order.
  //
  // Two rules that look obvious are deliberately NOT here, because both
  // are wrong:
  //
  //   "the number can't exceed the set total" — it absolutely can, and the
  //   cards where it does are the secret rares: 199/165, 201/185. Those
  //   are the most valuable cards in a modern set and the ones somebody is
  //   most likely to be scanning. An earlier version of this rejected
  //   them, which would have made the scanner fail hardest on exactly the
  //   cards it most needed to get right.
  //
  //   "treat a 1 between two numbers as a misread slash" — a slash read as
  //   a 1 turns 066/108 into 0661108, and splitting that back apart would
  //   just as happily invent a split inside a genuine run of digits and
  //   send somebody to the wrong card. A confidently wrong answer is worse
  //   than none: when the slash is lost, this finds nothing and
  //   extractLooseNumbers below picks the digits up as the weaker guess
  //   they are.
  //
  // The OCR pass runs with a 0-9 and / whitelist, so a real separator can
  // only ever come back as a slash — the pipe is kept only because a
  // future pass with a wider whitelist would produce one.
  function extractNumberCandidates(rawText){
    const text = String(rawText || '');
    const out = [];
    const seen = new Set();
    const re = /(\d{1,3})\s*[\/\|]\s*(\d{1,3})/g;
    let m;
    while((m = re.exec(text)) !== null){
      const number = m[1];
      const total = m[2];
      if(parseInt(total, 10) <= 0) continue; // a set of zero cards isn't a set
      const key = `${number}/${total}`;
      if(seen.has(key)) continue;
      seen.add(key);
      out.push({ number, setTotal: total });
    }
    return out;
  }

  // A bare number with no total — much weaker evidence, so it's only ever
  // tried after every "number/total" candidate has failed.
  function extractLooseNumbers(rawText){
    const out = [];
    const seen = new Set();
    const re = /\b(\d{1,3})\b/g;
    let m;
    while((m = re.exec(String(rawText || ''))) !== null){
      if(seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ number: m[1], setTotal: null });
    }
    return out.slice(0, 6);
  }

  // The old name-reading path, kept as a fallback and improved: it reads
  // only the top of the card (where the name is printed) rather than the
  // whole thing, at a readable size, and it no longer discards a line just
  // because a digit landed in it.
  function extractNameCandidates(rawText){
    const skipWords = /^(HP|BASIC|STAGE ?1|STAGE ?2|EX|GX|V|VMAX|VSTAR|POK[EÉ]MON|TRAINER|ENERGY|ITEM|SUPPORTER|STADIUM|WEAKNESS|RESISTANCE|RETREAT|COST)$/i;
    return String(rawText || '')
      .split('\n')
      .map(l => l.replace(/[^A-Za-zÀ-ÿ'.\- ]/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(l => l.length >= 3 && l.length <= 28)
      .filter(l => /[A-Za-zÀ-ÿ]{3}/.test(l))
      .filter(l => !skipWords.test(l))
      .slice(0, 5);
  }

  // ---- The framing guide ------------------------------------------------
  //
  // "Scan a Card" used to open the phone's own camera app, which is a
  // black box — you cannot draw on it, so there was no way to tell anybody
  // where to put the card. Tested on real cards, a casual snapshot reads
  // wrong and a careful close-up reads right, and the reason is entirely
  // framing: the crop regions are fractions OF THE PHOTO, so a card
  // sitting small and crooked in the middle of a table puts its number
  // nowhere near where the reader is looking.
  //
  // So the camera comes into the page. That buys two things:
  //
  //   1. Marks to line the card up against, which is what was asked for.
  //   2. A crop that is the CARD rather than the photo — which is the
  //      bigger win, because every region is then measured against the
  //      card itself and the tight corner crop in GUIDED_NUMBER_REGIONS
  //      becomes usable.
  //
  // The old file picker stays as the fallback: a browser that won't give
  // up a camera (permission denied, an insecure context, an in-app browser
  // that blocks it) drops back to exactly what it did before rather than
  // losing the feature.
  function cameraAvailable(){
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);
  }

  // Maps a rectangle drawn over a `object-fit: cover` video back to
  // coordinates in the video's own pixels. Getting this wrong is the
  // classic bug in a scanner overlay: the guide looks right on screen and
  // the captured crop is offset, so it silently reads the wrong strip of
  // the card.
  function coverSourceRect(video, boxRect, guideRect){
    const vw = video.videoWidth, vh = video.videoHeight;
    if(!vw || !vh) return null;
    const scale = Math.max(boxRect.width / vw, boxRect.height / vh);
    const drawnW = vw * scale, drawnH = vh * scale;
    const offsetX = (boxRect.width - drawnW) / 2;
    const offsetY = (boxRect.height - drawnH) / 2;
    return {
      sx: Math.max(0, (guideRect.x - offsetX) / scale),
      sy: Math.max(0, (guideRect.y - offsetY) / scale),
      sw: Math.min(vw, guideRect.width / scale),
      sh: Math.min(vh, guideRect.height / scale),
    };
  }

  // Opens the viewfinder. Resolves with a canvas holding just the card, or
  // null if the visitor backed out, or the string 'unavailable' so the
  // caller knows to fall back to the file picker rather than treating it
  // as a cancellation.
  function openCardCamera(){
    return new Promise(async (resolve) => {
      if(!cameraAvailable()) return resolve('unavailable');

      let stream;
      try{
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1920 },
          },
          audio: false,
        });
      }catch{
        return resolve('unavailable');
      }

      const overlay = document.createElement('div');
      overlay.className = 'scan-overlay';
      overlay.innerHTML = `
        <div class="scan-stage">
          <video class="scan-video" playsinline muted autoplay></video>
          <div class="scan-mask" aria-hidden="true">
            <div class="scan-guide">
              <span class="scan-corner tl"></span><span class="scan-corner tr"></span>
              <span class="scan-corner bl"></span><span class="scan-corner br"></span>
              <div class="scan-number-hint"><span>number goes here</span></div>
            </div>
          </div>
        </div>
        <div class="scan-controls">
          <p class="scan-tip">Fill the outline with the card. Get the bottom corner sharp — that's the bit being read.</p>
          <div class="scan-buttons">
            <button type="button" class="primary-btn scan-shoot">Capture</button>
            <button type="button" class="ghost-btn scan-cancel">Cancel</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      document.body.classList.add('scan-open');

      const video = overlay.querySelector('.scan-video');
      const guide = overlay.querySelector('.scan-guide');
      const stage = overlay.querySelector('.scan-stage');
      video.srcObject = stream;
      try{ await video.play(); }catch{ /* autoplay attribute covers most cases */ }

      const close = (value) => {
        stream.getTracks().forEach(t => t.stop());
        document.body.classList.remove('scan-open');
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const onKey = (e) => { if(e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);

      overlay.querySelector('.scan-cancel').addEventListener('click', () => close(null));

      overlay.querySelector('.scan-shoot').addEventListener('click', () => {
        const boxRect = stage.getBoundingClientRect();
        const gRect = guide.getBoundingClientRect();
        const src = coverSourceRect(video, boxRect, {
          x: gRect.left - boxRect.left,
          y: gRect.top - boxRect.top,
          width: gRect.width,
          height: gRect.height,
        });
        if(!src) return close('unavailable');

        // Captured at the sensor's own resolution for that region rather
        // than at screen size — the number is small, and every pixel
        // thrown away here is one the reader doesn't get.
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(src.sw));
        canvas.height = Math.max(1, Math.round(src.sh));
        canvas.getContext('2d').drawImage(video, src.sx, src.sy, src.sw, src.sh, 0, 0, canvas.width, canvas.height);
        close(canvas);
      });
    });
  }

  function scanStatus(message){
    const resultsEl = document.getElementById('card-search-results');
    if(resultsEl) resultsEl.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  }

  // Runs a scanned number through the same search a typed "199/165" uses.
  // Tries the language the switch is set to first, then the other one —
  // which is the quiet payoff of reading the number rather than the name:
  // a Japanese card scans exactly as well as an English one, and someone
  // who forgot to flip the switch still gets their card, labelled.
  async function searchScannedNumber(candidate){
    const order = [searchLang].concat(Object.keys(LANGUAGES).filter(l => l !== searchLang));
    for(const lang of order){
      let found;
      try{
        found = await searchByNumber(candidate.number, candidate.setTotal, lang);
      }catch{
        continue;
      }
      if(found.setMatches.length || found.dexMatches.length){
        return { lang, found };
      }
    }
    return null;
  }

  // `source` is either a File the visitor picked, or a canvas already
  // cropped to the card by the framing guide. A guided capture reads from
  // tighter regions because the image is known to BE the card.
  async function handleScanFile(source, user, mode, onAdded, guided){
    const resultsEl = document.getElementById('card-search-results');
    if(!resultsEl || !source) return;
    const onDone = () => renderYourList(user, mode);
    const regions = guided ? GUIDED_NUMBER_REGIONS : NUMBER_REGIONS;

    scanStatus('📷 Getting the scanner ready…');

    let worker, photo;
    try{
      [worker, photo] = await Promise.all([
        getOcrWorker(),
        source instanceof HTMLCanvasElement ? Promise.resolve(source) : loadImageToCanvas(source, SCAN_MAX_DIM),
      ]);
    }catch(err){
      renderSearchResults([], user, onAdded, mode,
        err.message || 'Could not read that photo — try a clearer, well-lit shot, or search by name below.');
      return;
    }

    // A scan has now actually run. The Infinite Dex has a card for the
    // first one; it is asserted here rather than after the OCR result,
    // because somebody whose card was misread still scanned a card.
    window.InfinitePullsDex?.noticeScan?.();

    // ---- Pass 1: the number in the corner -----------------------------
    scanStatus('📷 Reading the number in the corner…');
    // Every region with the global threshold first, because it is faster
    // and it is what wins on an evenly lit card.
    const numberTexts = [];
    for(const region of regions){
      const crop = binarizeForOcr(cropRegion(photo, region.fx, region.fy, region.fw, region.fh, 260));
      const text = await readText(worker, crop, '0123456789/', region.psm);
      if(!text.trim()) continue;
      numberTexts.push(text);

      for(const candidate of extractNumberCandidates(text)){
        const hit = await searchScannedNumber(candidate);
        if(hit) return renderScanHit(hit, candidate, user, onAdded, mode, onDone);
      }
    }

    // Nothing yet. Retry the likeliest region only, with a local threshold
    // — deliberately not every region, so a scan that is going to fail
    // doesn't take twice as long before saying so. The local pass judges
    // each pixel against its own neighbourhood, which is what can survive
    // a reflection lying across half the strip.
    for(const region of regions.slice(0, 2)){
      const crop = adaptiveBinarize(cropRegion(photo, region.fx, region.fy, region.fw, region.fh, 260), 0.22);
      const text = await readText(worker, crop, '0123456789/', region.psm);
      if(!text.trim()) continue;
      numberTexts.push(text);

      for(const candidate of extractNumberCandidates(text)){
        const hit = await searchScannedNumber(candidate);
        if(hit) return renderScanHit(hit, candidate, user, onAdded, mode, onDone);
      }
    }

    // Every "number/total" reading failed — fall back to bare numbers off
    // the same crops before giving up on the corner entirely.
    for(const text of numberTexts){
      for(const candidate of extractLooseNumbers(text)){
        const hit = await searchScannedNumber(candidate);
        if(hit) return renderScanHit(hit, candidate, user, onAdded, mode, onDone);
      }
    }

    // ---- Pass 2: the name across the top ------------------------------
    scanStatus('📷 No number found — trying the name…');
    const nameAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.- ";
    let nameText = await readText(
      worker, binarizeForOcr(cropRegion(photo, 0.04, 0.03, 0.92, 0.20, 200)), nameAlphabet, 7);
    if(!nameText.trim()){
      nameText = await readText(
        worker, adaptiveBinarize(cropRegion(photo, 0.04, 0.03, 0.92, 0.20, 200), 0.25), nameAlphabet, 7);
    }

    for(const guess of extractNameCandidates(nameText)){
      try{
        const cards = await searchCards(guess, searchLang);
        if(cards.length){
          renderSearchResults(cards, user, onAdded, mode,
            `Read the name off your photo as "${guess}" — tap the right card below.`);
          return;
        }
      }catch{ /* try the next candidate line */ }
    }

    renderSearchResults([], user, onAdded, mode,
      guided
        ? "Couldn't read that card. Try again with the card filling the outline, held straight on, with light on the bottom corner — that's the part being read. Or just type the number in the search box above."
        : "Couldn't read that card. The number in the bottom corner (like 199/165) is what this looks for — tap Scan a Card again to use the framing guide, which works far better than a loose photo. Or type the number in the search box above.");
  }

  // A scan that landed. Says out loud what it read and which database it
  // matched in, so a wrong read is obvious at a glance instead of quietly
  // showing somebody the wrong card.
  function renderScanHit(hit, candidate, user, onAdded, mode, onDone){
    const { lang, found } = hit;
    const printed = candidate.setTotal ? `${candidate.number}/${candidate.setTotal}` : `#${candidate.number}`;
    const langNote = lang === searchLang ? '' : ` — these are ${LANGUAGES[lang].label} cards`;

    const groups = [];
    if(found.setMatches.length){
      groups.push({ label: `Scanned ${printed}`, cards: found.setMatches });
    }
    if(found.dexMatches.length){
      groups.push({ label: `National Dex #${candidate.number}`, cards: found.dexMatches });
    }

    renderSearchResults([], user, onAdded || onDone, mode,
      `Read ${printed} off your photo${langNote}. Tap the right card below.`, groups);
  }

  // ---- Euros, and the cards that were counting as nothing ---------------
  //
  // Jeff found this: some cards carry a Cardmarket price and no TCGplayer
  // one, so they showed a value on screen and contributed ZERO to the
  // collection total. His example, checked against the live API:
  //
  //   svp-052 Mewtwo, SVP Black Star Promos, 052/225
  //   tcgplayer: null
  //   cardmarket: { unit: "EUR", trend: 65.65, avg: 62.63, low: 30 }
  //
  // A roughly seventy dollar card counting as zero. It is not really a
  // promo problem — it is every card TCGplayer does not cover, and promos
  // are simply where that is common.
  //
  // So a euro price is converted rather than discarded. The rate comes from
  // Frankfurter (European Central Bank reference rates, free, no key, one
  // request for the life of the page). Two honesty rules go with it:
  //
  //   1. A converted figure is ALWAYS marked as converted, wherever it is
  //      shown. It is a European marketplace price wearing a dollar sign,
  //      and a shop pricing off it should know that.
  //   2. If the rate cannot be fetched, the card goes back to counting as
  //      nothing rather than being converted at some guessed rate. A
  //      missing number is recoverable; a wrong one quietly is not.
  const FX_URL = 'https://api.frankfurter.dev/v1/latest?from=EUR&to=USD';

  // Held so the card detail panel can show a converted figure without
  // making its own request or becoming async. Filled the first time
  // loadEurToUsd resolves; null until then, which simply means the detail
  // view shows euros only for a moment.
  let lastFxRate = null;

  let eurToUsdPromise = null;
  function loadEurToUsd(){
    if(eurToUsdPromise) return eurToUsdPromise;
    eurToUsdPromise = (async () => {
      try{
        // Same reasoning as fetchTcgdex above. This one already fails
        // softly to null, but only if it fails at all.
        const res = await fetch(FX_URL, { signal: AbortSignal.timeout(6000) });
        if(!res.ok) return null;
        const data = await res.json();
        const rate = Number(data?.rates?.USD);
        if(!isFinite(rate) || rate <= 0) return null;
        lastFxRate = { rate, date: data?.date || null };
        return lastFxRate;
      }catch{
        return null;
      }
    })();
    eurToUsdPromise.catch(() => { eurToUsdPromise = null; });
    return eurToUsdPromise;
  }

  // Cardmarket quotes one price per card rather than one per printing, but
  // it does keep a separate set of figures for holo, so a holo variant is
  // matched to the holo numbers where they exist. Trend first, then the
  // average — trend is what the card's own price panel already shows, so
  // the total and the detail view agree.
  function cardmarketEur(card, variantKey){
    const cm = card?.pricing?.cardmarket;
    if(!cm) return null;
    const holo = typeof variantKey === 'string' && /holo/i.test(variantKey);
    const order = holo
      ? ['trend-holo', 'avg-holo', 'trend', 'avg']
      : ['trend', 'avg', 'trend-holo', 'avg-holo'];
    for(const key of order){
      const value = Number(cm[key]);
      if(isFinite(value) && value > 0) return value;
    }
    return null;
  }

  // The single place that decides what one copy of a card is worth in US
  // dollars, and where that number came from. `fx` is passed in rather than
  // fetched here so a list of two hundred cards resolves one rate, not two
  // hundred.
  function usdValueFor(card, variantKey, fx){
    const market = card?.pricing?.tcgplayer?.[variantKey]?.marketPrice;
    if(typeof market === 'number' && isFinite(market)) return { amount: market, converted: false };

    const euros = cardmarketEur(card, variantKey);
    if(euros !== null && fx && fx.rate) {
      return { amount: Math.round(euros * fx.rate * 100) / 100, converted: true, euros };
    }
    return { amount: null, converted: false };
  }

  // Which printings of this card exist, for the picker on the add form.
  //
  // TCGplayer prices are the ideal source because each priced key IS a
  // real printing, but TCGdex carries no TCGplayer data for Japanese
  // cards at all (verified: a Japanese card comes back with
  // `tcgplayer: null` and a populated `cardmarket`). This used to mean a
  // Japanese card collapsed to a single "Normal (no pricing available)"
  // option, so somebody adding a Japanese holo had no way to say it was a
  // holo. TCGdex's own `variants` flags say which printings exist
  // regardless of language, so they're the fallback.
  const TCGDEX_VARIANT_KEYS = {
    normal: 'normal',
    holo: 'holofoil',
    reverse: 'reverse-holofoil',
    firstEdition: '1st-edition',
  };

  function variantOptions(card){
    const prices = card?.pricing?.tcgplayer || {};
    const keys = Object.keys(prices).filter(k => k !== 'updated' && k !== 'unit');
    if(keys.length){
      return keys.map(key => ({
        value: key,
        label: (VARIANT_LABELS[key] || key) + (typeof prices[key].marketPrice === 'number' ? ` — ${currency(prices[key].marketPrice)}` : ' (no market price)')
      }));
    }

    const flags = card?.variants || {};
    const fromFlags = Object.keys(TCGDEX_VARIANT_KEYS)
      .filter(flag => flags[flag])
      .map(flag => {
        const value = TCGDEX_VARIANT_KEYS[flag];
        return { value, label: VARIANT_LABELS[value] || value };
      });

    if(fromFlags.length) return fromFlags;
    return [{ value: 'normal', label: 'Normal' }];
  }

  // The straight TCGplayer market price, with no conversion. Kept separate
  // from usdValueFor above because "what does TCGplayer say" and "what is
  // this worth in dollars" are different questions, and the price panel
  // needs to be able to ask the first one without the second's answer
  // being folded in.
  function priceForVariant(card, variantKey){
    const entry = card?.pricing?.tcgplayer?.[variantKey];
    return typeof entry?.marketPrice === 'number' ? entry.marketPrice : null;
  }

  // ---- Add-a-card search UI ----
  // The search grid and the single-card detail view take turns occupying
  // the exact same spot (#card-search-results) instead of the detail
  // stacking below a long grid — tapping a card swaps straight to its
  // detail, front and center, no scrolling past a big list to reach it
  // or back past it to search again. lastSearch remembers the most
  // recent grid so "← Back to Search Results" can restore it instantly,
  // without re-querying TCGdex.
  let lastSearch = null; // { cards, user, onAdded, mode, note }

  function searchResultsGridHtml(cards){
    return `
      <div class="card-grid">
        ${cards.map(c => `
          <button type="button" class="card search-result-btn" data-card-id="${escapeHtml(c.id)}" data-card-lang="${escapeHtml(cardLang(c))}" data-en-name="${escapeHtml(c._enName || '')}" data-dex-id="${escapeHtml(c._dexId ? String(c._dexId) : '')}" style="text-align:left; cursor:pointer;">
            ${c.image
              ? `<img src="${escapeHtml(thumbUrl(c.image))}" alt="" loading="lazy" style="width:100%;aspect-ratio:245/337;object-fit:contain;margin-bottom:8px;">`
              : `<div style="width:100%;aspect-ratio:245/337;margin-bottom:8px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid var(--border);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:10px;">
                   <img src="./assets/logo.png" alt="" style="width:55%;opacity:.55;">
                   <small style="color:var(--muted);text-align:center;line-height:1.2;">No preview picture</small>
                 </div>`}
            <strong style="display:block">${escapeHtml(c.name)}</strong>
            ${c._enName ? `<small style="display:block; color:var(--muted);">${escapeHtml(c._enName)}</small>` : ''}
            ${(() => {
              if(!c.localId) return '';
              const info = setInfoFor(c);
              const total = info?.cardCount?.official ? `/${escapeHtml(String(info.cardCount.official))}` : '';
              const name = info?.name ? ` · ${escapeHtml(info.name)}` : '';
              return `<small style="display:block; color:var(--muted);">#${escapeHtml(String(c.localId))}${total}${name}</small>`;
            })()}
            ${isJapanese(c) ? `<small class="lang-tag">${escapeHtml(LANGUAGES.ja.native)}</small>` : ''}
          </button>
        `).join('')}
      </div>
    `;
  }

  // `groups` (optional) renders several labelled grids instead of one flat
  // one — used by number searches, where "cards numbered 134" and "Pokémon
  // #134 in the National Dex" are two different answers to the same query
  // and running them together would be confusing.
  function renderSearchResults(cards, user, onAdded, mode, note, groups){
    const resultsEl = document.getElementById('card-search-results');
    if(!resultsEl) return;
    lastSearch = { cards, user, onAdded, mode, note, groups };

    if(groups && groups.length){
      resultsEl.innerHTML = `
        ${note ? `<p><small>${escapeHtml(note)}</small></p>` : ''}
        ${groups.map(g => `
          <div class="search-group">
            <div class="search-group-head">
              <strong>${escapeHtml(g.label)}</strong>
              <span class="search-group-count">${g.cards.length}${g.cards.length >= SEARCH_RESULT_LIMIT ? '+' : ''}</span>
            </div>
            ${searchResultsGridHtml(g.cards)}
          </div>
        `).join('')}
      `;
      wireSearchResultButtons(resultsEl, user, onAdded, mode);
      return;
    }

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
    const defaultNote = cards.length === 1 ? 'Tap the card to see its full details.' : `${cards.length} cards found — tap the right one below.`;

    resultsEl.innerHTML = `
      <p><small>${escapeHtml(note || cappedNote || defaultNote)}</small></p>
      ${searchResultsGridHtml(cards)}
    `;

    wireSearchResultButtons(resultsEl, user, onAdded, mode);
  }

  function wireSearchResultButtons(resultsEl, user, onAdded, mode){
    resultsEl.querySelectorAll('.search-result-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        resultsEl.innerHTML = '<div class="empty-state">Loading card details…</div>';
        resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try{
          const card = await fetchCardDetail(btn.dataset.cardId, btn.dataset.cardLang);
          // Carried across from the search that found it: a Japanese card
          // knows nothing about "Charizard", but eBay, the news feed and
          // My Pokédex all need that to be useful. See searchJapaneseFromEnglish.
          if(btn.dataset.enName) card._enName = btn.dataset.enName;
          if(btn.dataset.dexId) card._dexId = parseInt(btn.dataset.dexId, 10) || null;
          showCardDetail(card, user, onAdded, mode);
        }catch(err){
          resultsEl.innerHTML = `<div class="empty-state">${escapeHtml(err.message || 'Could not load that card — try again.')}</div>`;
        }
      });
    });
  }

  // Restores the last search grid without re-querying TCGdex — this is
  // what "← Back to Search Results" calls.
  function showSearchResultsGrid(){
    if(!lastSearch) return;
    renderSearchResults(lastSearch.cards, lastSearch.user, lastSearch.onAdded, lastSearch.mode, lastSearch.note, lastSearch.groups);
  }

  // Simple outbound search links — not pulled in via any API (TCGdex has
  // no eBay/TCGplayer-marketplace data of its own, and eBay's own API
  // only exposes live listings, not the sold/market pricing that would
  // actually be useful, without a special-access application) — just a
  // fast way to jump straight to that card's live listings elsewhere.
  // Shop owner can turn the section below off entirely from /admin/ (Card
  // Search — Shop This Card Links) — reused/duplicated store_info read here
  // rather than sharing state with app.js, matching this file's existing
  // "independent script, not a module" pattern. Cached for the page's
  // lifetime; defaults on (undefined === not-yet-set-by-any-shop) so
  // existing shops see no behavior change until they actively turn it off.
  let shopLinksEnabledCache = null;
  async function shopLinksEnabled(){
    if(shopLinksEnabledCache !== null) return shopLinksEnabledCache;
    try{
      const { data, error } = await client().from('store_info').select('data').eq('id', 1).maybeSingle();
      shopLinksEnabledCache = (!error && data?.data?.shopLinksEnabled === false) ? false : true;
    }catch{
      shopLinksEnabledCache = true;
    }
    return shopLinksEnabledCache;
  }

  // Feeds the "About [Pokémon]" section's collection-count / Pokédex /
  // evolution-family stats (see components/pokemon-info.js) — the
  // signed-in visitor's own My Collection rows, always, regardless of
  // which tab (My Collection or Wish List) the card detail was opened
  // from. This is just a thin pass-through to the shared cache in
  // components/pokemon-data.js — the same cache My Pokédex itself is
  // built on (see components/pokedex.js) — so opening a card's "About"
  // section and opening My Pokédex don't each fetch My Collection's rows
  // separately; whichever happens first warms the cache for the other.
  function fetchOwnedCardNames(userId){
    return window.InfinitePullsPokemonData.fetchOwnedCollectionRows(userId);
  }

  // How many of THIS exact card the visitor already has in whichever list
  // (My Collection or Wish List) the detail view is currently open for —
  // summed across every variant/condition row for this card_id, since
  // what a visitor wants to know is simply "do I already have this," not
  // a per-variant breakdown. Drives the small quantity badge on the card
  // image, and (see showCardDetail) is why viewing a card from My Cards
  // no longer offers an "Add" form that would silently create a
  // duplicate row instead of just showing the count you already have.
  // The holdings themselves, grouped the same way the list groups them, so
  // the card's own page can show and edit them. fetchOwnedQuantity below
  // only ever returned a total, which is all the old read-only message
  // needed.
  async function fetchOwnedHoldings(table, userId, cardId){
    try{
      const { data, error } = await client().from(table)
        .select('id, card_id, card_name, set_name, image_url, variant, condition, quantity, added_at')
        .eq('user_id', userId).eq('card_id', cardId);
      if(error || !data) return [];
      return groupOwnedRows(data);
    }catch{
      return [];
    }
  }

  async function fetchOwnedQuantity(table, userId, cardId){
    try{
      const { data, error } = await client().from(table).select('quantity').eq('user_id', userId).eq('card_id', cardId);
      if(error || !Array.isArray(data)) return 0;
      return data.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
    }catch{
      return 0;
    }
  }

  function shopLinksHtml(card){
    // Same reasoning as ebayQueryFor: a Japanese card's own name is not
    // what an English-language marketplace listing is titled with.
    const raw = isJapanese(card)
      ? [card._enName || '', card.set?.id || '', card.localId || '', 'japanese pokemon card'].filter(Boolean).join(' ')
      : `${card.name} ${card.set?.name || ''} pokemon card`.trim();
    const query = encodeURIComponent(raw);
    const links = [
      { label: 'eBay (live listings)', url: `https://www.ebay.com/sch/i.html?_nkw=${query}` },
      { label: 'TCGplayer', url: `https://www.tcgplayer.com/search/pokemon/product?q=${query}` },
      { label: 'Cardmarket', url: `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(isJapanese(card) ? raw : `${card.name} ${card.set?.name || ''}`.trim())}` },
    ];
    return links.map(l => `<a class="ghost-btn" href="${escapeHtml(l.url)}" target="_blank" rel="noopener" style="display:inline-block; text-decoration:none; margin:0 8px 8px 0;">${escapeHtml(l.label)} ↗</a>`).join('');
  }

  // Fallback/supplement to the inline news panel below — a plain search
  // link that always works even before card-news is deployed, or if
  // GDELT comes back empty for this particular card.
  function moreNewsLinkHtml(card){
    const query = encodeURIComponent(`${card.name} pokemon card`.trim());
    return `<a class="ghost-btn" href="https://news.google.com/search?q=${query}" target="_blank" rel="noopener" style="display:inline-block; text-decoration:none; margin:0 8px 8px 0;">📰 Search all news for "${escapeHtml(card.name)}" ↗</a>`;
  }

  // Markup for the #recent-news-section body once fetchCardNews resolves
  // (or times out) — pulled into its own function so showCardDetail can
  // fill this section in after the fact instead of blocking the rest of
  // the card on it.
  function newsSectionHtml(card, newsArticles){
    return newsArticles.length ? `
      <div class="info-list">
        ${newsArticles.map(a => `
          <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="info-row" style="text-decoration:none; color:inherit; align-items:center;">
            <span style="min-width:0;">
              <strong style="display:block;">${escapeHtml(a.title)}</strong>
              <small>${escapeHtml(a.source || '')}${formatNewsDate(a.publishedAt) ? ` · ${escapeHtml(formatNewsDate(a.publishedAt))}` : ''}</small>
            </span>
            <span style="flex:0 0 auto; color:var(--muted);">↗</span>
          </a>
        `).join('')}
      </div>
      <p style="margin-top:10px">${moreNewsLinkHtml(card)}</p>
    ` : `
      <p><small>Restocks, tournament results, anything currently being written about this card.</small></p>
      <div>${moreNewsLinkHtml(card)}</div>
    `;
  }

  // Real headlines pulled inline, via a Supabase Edge Function that
  // proxies GDELT's free, keyless news-search API (see
  // supabase/functions/card-news — GDELT is used specifically because
  // it's explicitly licensed for this, unlike Google News or NewsAPI's
  // free tier). Never throws: if the function isn't deployed yet, or
  // GDELT hiccups, this just quietly returns no articles and the detail
  // view falls back to the plain search link above.
  // Races any promise against a plain timer so a slow/hanging upstream
  // (GDELT, eBay, or just a slow connection) can never freeze the rest of
  // the page waiting on it — after `ms`, this just resolves with
  // `fallback` instead, same as if that call had failed outright. Used
  // for every "nice to have" fetch below (news, eBay pricing) so a card's
  // detail view always finishes rendering promptly even when one of those
  // extras is having a bad moment.
  function withTimeout(promise, ms, fallback){
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => { if(!settled){ settled = true; resolve(fallback); } }, ms);
      promise.then(
        (value) => { if(!settled){ settled = true; clearTimeout(timer); resolve(value); } },
        () => { if(!settled){ settled = true; clearTimeout(timer); resolve(fallback); } }
      );
    });
  }

  async function fetchNews(query){
    try{
      const { data, error } = await withTimeout(
        client().functions.invoke('card-news', { body: { query } }),
        7000,
        { data: null, error: new Error('timed out') }
      );
      if(error) throw error;
      return Array.isArray(data?.articles) ? data.articles : [];
    }catch{
      return [];
    }
  }

  async function fetchCardNews(card){
    // A Japanese card name would return Japanese-language news at best and
    // nothing at all in practice — the English name is what an English
    // news feed indexes, so use it when the search that found this card
    // knew it, and skip the section entirely when it didn't.
    if(isJapanese(card)){
      return card._enName ? fetchNews(`${card._enName} pokemon card`) : [];
    }
    return fetchNews(`${card.name} pokemon card`);
  }

  // Current eBay asking-price estimate, via a Supabase Edge Function that
  // proxies eBay's Browse API (see supabase/functions/ebay-price — free,
  // no eBay Partner Network application needed for basic search, but does
  // need the shop's own eBay Developer credentials set as a secret, so
  // this quietly returns unavailable until that's configured). Never
  // throws: same graceful-degradation pattern as fetchCardNews above.
  // The search string matters more than it looks. For an English card the
  // printed name plus its set is what listings say. For a JAPANESE card
  // that same string would be Japanese text (リザードンex 黒炎の支配者),
  // which is not how eBay's US sellers title Japanese singles — they write
  // the set code and number in Latin characters and the word "Japanese".
  // So a Japanese card is searched by set code + number + "japanese",
  // which is exactly the shape of a real listing title, plus the English
  // Pokémon name whenever the search that found this card knew it.
  function ebayQueryFor(card){
    if(!isJapanese(card)){
      return `${card.name} ${card.set?.name || ''} pokemon card`.trim();
    }
    const parts = [
      card._enName || '',
      card.set?.id || '',
      card.localId || '',
      'japanese pokemon card',
    ];
    return parts.filter(Boolean).join(' ').trim();
  }

  async function fetchEbayPrice(card){
    try{
      const { data, error } = await withTimeout(
        client().functions.invoke('ebay-price', {
          body: { query: ebayQueryFor(card) }
        }),
        7000,
        { data: null, error: new Error('timed out') }
      );
      if(error) throw error;
      return data?.available ? data : null;
    }catch{
      return null;
    }
  }

  function formatNewsDate(iso){
    if(!iso) return null;
    try{
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }catch{
      return null;
    }
  }

  // Full card detail — image, prices across every variant and (when
  // Cardmarket has data) Cardmarket too, illustrator/rarity/etc., outbound
  // shopping links, and other printings of the same card to switch
  // between — plus the add form itself. This is the "tap a search
  // result" destination; tapping an Other Printings thumbnail re-runs
  // this for that printing instead. Renders into the same spot the
  // search grid was in, replacing it (see renderSearchResults above).
  // Bumped every time a new card detail view starts rendering — lets the
  // slow-extras callbacks below (news, eBay) recognize when the visitor's
  // already moved on to a different card before they resolve, so a late
  // response never overwrites what's now on screen.
  let cardDetailRenderToken = 0;

  async function showCardDetail(card, user, onAdded, mode, origin='search'){
    const resultsEl = document.getElementById('card-search-results');
    if(!resultsEl) return;
    const cfg = LIST_CONFIG[mode];
    const backLabel = origin === 'collection' ? '← Back to My Cards' : '← Back to Search Results';
    const options = variantOptions(card);
    const myToken = ++cardDetailRenderToken;

    // Only the fast stuff is awaited before anything shows up — set info,
    // other printings, and the shop-links flag have always come back
    // quickly. News (GDELT) and eBay pricing are the two calls that can
    // occasionally take several seconds, and blocking the *entire* card
    // on them meant a slow news lookup held up prices, rarity, everything
    // else too. They're kicked off in parallel further down instead, each
    // filling in its own section once it's ready.
    const [setDetail, otherPrintings, showShopLinks, ownedQty, holdings] = await Promise.all([
      fetchSetDetail(card.set?.id, cardLang(card)),
      fetchOtherPrintings(card),
      shopLinksEnabled(),
      fetchOwnedQuantity(cfg.table, user.id, card.id),
      fetchOwnedHoldings(cfg.table, user.id, card.id),
    ]);

    if(myToken !== cardDetailRenderToken) return; // a different card opened while we were waiting

    const releaseDate = formatReleaseDate(setDetail?.releaseDate);
    const cardNumber = card.localId && card.set?.cardCount?.official
      ? `${card.localId}/${card.set.cardCount.official}`
      : (card.localId || null);

    const attrRows = [];
    // Language first, and only when it isn't English — on a Japanese card
    // it's the single most important fact about the thing, and the printed
    // name won't tell an English reader which one they're looking at.
    if(isJapanese(card)){
      attrRows.push(['Language', `${LANGUAGES.ja.label} (${LANGUAGES.ja.native})`]);
      if(card._enName) attrRows.push(['Pokémon', card._enName]);
    }
    if(card.illustrator) attrRows.push(['Illustrator', card.illustrator]);
    if(releaseDate) attrRows.push(['Release Date', releaseDate]);
    if(card.rarity) attrRows.push(['Rarity', card.rarity]);
    if(Array.isArray(card.dexId) && card.dexId.length) attrRows.push(['National Dex #', card.dexId.join(', ')]);
    else if(card._dexId) attrRows.push(['National Dex #', String(card._dexId)]);
    if(Array.isArray(card.types) && card.types.length) attrRows.push(['Energy Type', card.types.join(' / ')]);
    if(card.regulationMark) attrRows.push(['Regulation Mark', card.regulationMark]);

    resultsEl.innerHTML = `
      <button type="button" id="back-to-search-btn" class="ghost-btn" style="margin-bottom:14px;">${escapeHtml(backLabel)}</button>
      <div class="card section">
        <div style="display:flex; flex-direction:column; align-items:center; text-align:center; gap:10px;">
          ${card.image ? `
            <div style="position:relative; width:100%; max-width:260px;">
              <img src="${escapeHtml(fullImageUrl(card.image))}" alt="" style="width:100%; height:auto; object-fit:contain; border-radius:14px; box-shadow:0 10px 30px rgba(0,0,0,.35); display:block;">
              ${ownedQty > 0 ? `<span class="owned-qty-badge" aria-label="You have ${ownedQty}">${ownedQty}</span>` : ''}
            </div>
          ` : (ownedQty > 0 ? `<span class="owned-qty-badge owned-qty-badge-standalone" aria-label="You have ${ownedQty}">${ownedQty}</span>` : '')}
          <div>
            <strong style="display:block; font-size:1.25rem;">${escapeHtml(card.name)}</strong>
            <small style="display:block; color:var(--muted);">${escapeHtml(card.set?.name || '')}${cardNumber ? ` · #${escapeHtml(cardNumber)}` : ''}</small>
            ${ownedQty > 0 ? `<small style="display:block; color:var(--gold); margin-top:4px;">You have ${ownedQty} of ${ownedQty === 1 ? 'this' : 'these'}${cfg.table === 'wishlist_cards' ? ' on your wish list' : ' in your collection'}.</small>` : ''}
          </div>
        </div>

        ${origin === 'collection' ? `
          ${holdingsSectionHtml(holdings, cfg)}
        ` : `
          <form id="add-card-form" class="form-grid" style="margin-top:14px">
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
          ${ownedQty > 0 ? `<p><small>Adding again adds a separate copy rather than replacing what you already have.</small></p>` : ''}
        `}

        <h3 style="margin-top:20px; margin-bottom:6px; font-size:1rem;">Prices</h3>
        <div class="info-list" id="price-info-list">${priceRowsHtml(card, null)}</div>

        ${attrRows.length ? `
          <h3 style="margin-top:20px; margin-bottom:6px; font-size:1rem;">Card Details</h3>
          <div class="info-list">
            ${attrRows.map(([label, value]) => `<div class="info-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}
          </div>
        ` : ''}

        ${showShopLinks ? `
          <h3 style="margin-top:20px; margin-bottom:6px; font-size:1rem;">Shop This Card</h3>
          <p><small>Opens a live search on that site in a new tab — prices there aren't pulled into Infinite Pulls, just a quick way to compare.</small></p>
          <div>${shopLinksHtml(card)}</div>
        ` : ''}

        <h3 style="margin-top:20px; margin-bottom:6px; font-size:1rem;">Recent News</h3>
        <div id="recent-news-section"><p><small>Loading recent news…</small></p></div>

        ${otherPrintings.length ? `
          <h3 style="margin-top:20px; margin-bottom:6px; font-size:1rem;">Other Printings</h3>
          <p><small>${otherPrintings.length} other printing${otherPrintings.length === 1 ? '' : 's'} of this card — tap one to see its price and rarity, or add that printing instead.</small></p>
          <div class="card-grid">
            ${otherPrintings.map(c => `
              <button type="button" class="card other-printing-btn" data-card-id="${escapeHtml(c.id)}" data-card-lang="${escapeHtml(cardLang(c))}" style="text-align:left; cursor:pointer; padding:8px;">
                ${c.image
                  ? `<img src="${escapeHtml(thumbUrl(c.image))}" alt="" loading="lazy" style="width:100%;aspect-ratio:245/337;object-fit:contain;">`
                  : `<div style="width:100%;aspect-ratio:245/337;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid var(--border);"></div>`}
              </button>
            `).join('')}
          </div>
        ` : ''}

        <div id="pokemon-info-section" style="margin-top:14px"></div>
      </div>
    `;

    document.getElementById('back-to-search-btn')?.addEventListener('click', () => {
      if(origin === 'collection'){
        resultsEl.innerHTML = '';
        document.getElementById('collection-list-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        showSearchResultsGrid();
        resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    document.getElementById('add-card-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const variant = e.target.elements.variant.value;
      const condition = e.target.elements.condition.value;
      const quantity = Math.max(1, parseInt(e.target.elements.quantity.value, 10) || 1);
      const button = e.target.querySelector('button');
      button.disabled = true;
      button.textContent = 'Adding…';

      // My Pokédex's "new entry" moment (see maybeShowNewPokedexEntry
      // below) needs to know whether this Pokémon was ALREADY discovered
      // — checked before the insert, using whatever's already cached, so
      // this essentially never costs an extra request in practice (the
      // card detail view above already warmed both caches via its own
      // "About [Pokémon]" section moments ago).
      // TCGdex fills dexId in on English cards; on Japanese ones it often
      // doesn't, so _dexId — carried across from the dex-number search that
      // found the card — is the fallback. Without it a Japanese card would
      // save with no idea which Pokémon it is and never reach My Pokédex.
      const dexNumber = (Array.isArray(card.dexId) && card.dexId.length ? card.dexId[0] : null) || card._dexId || null;
      let wasAlreadyDiscovered = true;
      let speciesDisplayName = card.name;
      if(dexNumber && cfg.table === 'user_cards'){
        try{
          const pd = window.InfinitePullsPokemonData;
          const [info, ownedRows] = await Promise.all([pd.loadPokemonInfo(dexNumber), pd.fetchOwnedCollectionRows(user.id)]);
          speciesDisplayName = pd.displayName(info.species.name);
          wasAlreadyDiscovered = pd.ownedSummaryForSpecies(info.species.name, ownedRows, dexNumber).discovered;
        }catch{
          wasAlreadyDiscovered = true; // couldn't tell — safer to stay quiet than falsely claim "new"
        }
      }

      // Adding a card you already hold in the SAME variant and condition
      // bumps that row's quantity rather than inserting a second identical
      // line. Variant/condition are part of the match on purpose: a NM holo
      // and a played reverse are genuinely different holdings and should
      // stay separate rows.
      let error = null;
      let existingRow = null;
      try{
        const { data: dupes } = await client().from(cfg.table)
          .select('id, quantity')
          .eq('user_id', user.id)
          .eq('card_id', card.id)
          .eq('variant', variant)
          .eq('condition', condition)
          .limit(1);
        existingRow = (dupes && dupes.length) ? dupes[0] : null;
      }catch{ /* fall through to a plain insert */ }

      if(existingRow){
        ({ error } = await client().from(cfg.table)
          .update({ quantity: (Number(existingRow.quantity) || 0) + quantity })
          .eq('id', existingRow.id));
      } else {
      const newRow = {
        user_id: user.id,
        card_id: card.id,
        card_name: card.name,
        set_name: card.set?.name || null,
        image_url: card.image ? thumbUrl(card.image) : null,
        // rarity/illustrator/set_id — added for Collector Goals (Set
        // Completion, Master Set, Rarity, Artist goal types all need
        // these per-card; see components/collector-goals-data.js). Only
        // meaningful for My Collection, but harmless to include on Wish
        // List adds too since Collector Goals never reads that table.
        rarity: card.rarity || null,
        illustrator: card.illustrator || null,
        set_id: card.set?.id || null,
        // card_lang: which TCGdex database this card id belongs to. A card
        // id alone does not say — asking the English database for a
        // Japanese id just 404s — so without this a Japanese card could be
        // saved but never loaded again.
        card_lang: cardLang(card),
        // dex_id: which Pokémon it is, saved at add time because a Japanese
        // card's printed name (リザードンex) can never be matched against
        // the English species name My Pokédex counts by.
        dex_id: dexNumber,
        variant, condition, quantity
      };

      ({ error } = await client().from(cfg.table).insert(newRow));
      if(error && isMissingNewColumn(error)){
        // Database hasn't had card_language.sql run against it yet. Save
        // the card anyway rather than refusing — an English card loses
        // nothing, and backfillCardMetadata fills both columns in later.
        const { card_lang, dex_id, ...withoutNewColumns } = newRow;
        ({ error } = await client().from(cfg.table).insert(withoutNewColumns));
      }
      }

      button.disabled = false;
      button.textContent = error ? 'Could not add — try again' : (existingRow ? 'Added — you now have ' + ((Number(existingRow.quantity) || 0) + quantity) : 'Added!');
      // A newly-added My Collection card can change "Your X Collection: N
      // cards" / Pokédex-discovered for whichever Pokémon this is (Wish
      // List adds don't — the Pokédex is ownership-based, not wish-based).
      if(!error && cfg.table === 'user_cards'){
        window.InfinitePullsPokemonData.invalidateOwnedCollectionCache();
        if(dexNumber && !wasAlreadyDiscovered) showNewPokedexEntryToast(dexNumber, speciesDisplayName);
        // Not awaited — Collector Goals progress is an extra layer on top
        // of the core add-to-collection flow and shouldn't slow it down.
        checkGoalCompletionsAfterAdd(user.id);
      }
      if(!error) setTimeout(onAdded, 400);
    });

    // Editing or removing a copy re-renders this same card rather than
    // bouncing back to the list — you were reading the card, you should
    // still be on it afterwards.
    const refreshDetail = () => showCardDetail(card, user, onAdded, mode, origin);

    resultsEl.querySelectorAll('.holding-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.rowIds;
        const row = holdings.find(h => h.rowIds.join(',') === key);
        if(row) showHoldingEditor(btn.closest('.holding-row'), row, card, cfg, user, mode, refreshDetail);
      });
    });

    resultsEl.querySelectorAll('.holding-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await client().from(cfg.table).delete().in('id', btn.dataset.rowIds.split(','));
        if(cfg.table === 'user_cards') window.InfinitePullsPokemonData.invalidateOwnedCollectionCache();
        refreshDetail();
      });
    });

    resultsEl.querySelectorAll('.other-printing-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        resultsEl.innerHTML = '<div class="empty-state">Loading card details…</div>';
        resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try{
          const nextCard = await fetchCardDetail(btn.dataset.cardId, btn.dataset.cardLang || cardLang(card));
          if(card._enName) nextCard._enName = card._enName;
          if(card._dexId) nextCard._dexId = card._dexId;
          showCardDetail(nextCard, user, onAdded, mode);
        }catch(err){
          resultsEl.innerHTML = `<div class="empty-state">${escapeHtml(err.message || 'Could not load that card — try again.')}</div>`;
        }
      });
    });

    // The slow extras — kicked off now, not awaited. Each fills in its
    // own section once ready; if the visitor's already tapped into a
    // different card (or Other Printings) by then, myToken no longer
    // matches and the stale response is just dropped on the floor.
    // Not awaited: the price panel re-renders when the eBay row arrives
    // anyway, and a card with a euro-only price wants the rate ready.
    loadEurToUsd();

    fetchCardNews(card).then(newsArticles => {
      if(myToken !== cardDetailRenderToken) return;
      const newsEl = document.getElementById('recent-news-section');
      if(newsEl) newsEl.innerHTML = newsSectionHtml(card, newsArticles);
    });

    fetchEbayPrice(card).then(ebayPrice => {
      if(myToken !== cardDetailRenderToken || !ebayPrice?.available) return;
      const priceEl = document.getElementById('price-info-list');
      if(priceEl) priceEl.innerHTML = priceRowsHtml(card, ebayPrice);
    });

    // "About [Pokémon]" — a free PokéAPI lookup keyed off this card's own
    // National Dex #, shared with the Wish List/search-result detail
    // views and the public collector page (see components/pokemon-info.js
    // for why this lives in its own file instead of being built here).
    // Deferred like news/eBay above so a slow PokéAPI response can't hold
    // up the rest of the card either; skips itself entirely (no fetch at
    // all) for cards with no Dex # to look up, like Trainer/Energy cards.
    // infoEl is captured once, by direct reference — if a different card
    // opens before this resolves, resultsEl.innerHTML has already been
    // replaced wholesale and this reference is quietly orphaned, same as
    // the effect myToken produces for news/eBay above, so no extra guard
    // is needed here.
    const infoEl = document.getElementById('pokemon-info-section');
    if(infoEl && window.InfinitePullsPokemonInfo){
      window.InfinitePullsPokemonInfo.mount(infoEl, card, {
        fetchOwnedRows: () => fetchOwnedCardNames(user.id),
        wishlist: mode === 'wishlist'
      });
    }
  }

  // ---- Your list (collection or wish list) ----
  // Three ways to see your own cards: 'list' (compact rows, the original
  // view), 'portfolio' (value dashboard + chart — collection tab only, a
  // wish list has no "value over time" to speak of), and 'binder' (the
  // swipeable 4×4 grid). The tab switcher resets this back to the default
  // so a stray 'portfolio' selection can't carry over to Wish List.
  // Held for the life of one render pass so switching between List,
  // Portfolio and Binder doesn't re-price every sealed box three times.
  // Cleared whenever the Sealed tab changes anything.
  let sealedValueCache = null;
  async function sealedValue(userId){
    const sealed = window.InfinitePullsSealed;
    if(!sealed) return { total: 0, count: 0, anyMissing: false };
    if(sealedValueCache && sealedValueCache.userId === userId) return sealedValueCache.value;
    const value = await sealed.totalValueFor(userId);
    sealedValueCache = { userId, value };
    return value;
  }

  let viewMode = 'binder';

  // Tapping a card in List or Binder view — refetches full detail
  // (pricing, illustrator, other printings, etc. aren't on the list-row
  // data we already have) and opens it in the same detail view search
  // results use, just with a back button that returns to the collection
  // instead of a search grid.
  // `row` is the owner's saved row when there is one — it carries the
  // language the card was added in, which is the only reliable way to know
  // which TCGdex database a saved card id belongs to. Rows added before
  // that column existed have none, and fetchCardDetailAnyLang covers them.
  async function openOwnedCardDetail(cardId, user, mode, row){
    const resultsEl = document.getElementById('card-search-results');
    if(!resultsEl) return;
    resultsEl.innerHTML = '<div class="empty-state">Loading card details…</div>';
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try{
      const card = await fetchCardDetailAnyLang(cardId, row?.card_lang || DEFAULT_LANG);
      if(row?.dex_id) card._dexId = Number(row.dex_id) || null;
      if(card._dexId && isJapanese(card)) card._enName = await englishNameForDex(card._dexId);
      showCardDetail(card, user, () => renderYourList(user, mode), mode, 'collection');
      if(mode === 'collection') backfillCardMetadata(user.id, card);
    }catch(err){
      resultsEl.innerHTML = `<div class="empty-state">${escapeHtml(err.message || 'Could not load that card — try again.')}</div>`;
    }
  }

  // Opportunistic backfill for rows added to My Collection before this
  // app tracked rarity/illustrator/set_id (see the insert in the
  // add-card-form handler above) — every time an owned card's full detail
  // is loaded, quietly fill in whatever's now known for any matching
  // row(s) that are still missing it, so Collector Goals' card-based
  // types (Set Completion, Master Set, Rarity, Artist) fill in over time
  // with normal use rather than needing a one-off bulk migration. Fire
  // and forget — never worth surfacing an error for.
  async function backfillCardMetadata(userId, card){
    if(!card?.id) return;
    const patch = {};
    if(card.rarity) patch.rarity = card.rarity;
    if(card.illustrator) patch.illustrator = card.illustrator;
    if(card.set?.id) patch.set_id = card.set.id;
    // card_lang and dex_id joined this backfill for the same reason the
    // other three did: rows added before the column existed can fill
    // themselves in through normal use instead of a bulk migration. dex_id
    // is what lets a Japanese card ever appear in My Pokédex, since its
    // printed name can't be matched against an English species name.
    const lang = cardLang(card);
    if(lang) patch.card_lang = lang;
    const dex = card._dexId || (Array.isArray(card.dexId) && card.dexId.length ? card.dexId[0] : null);
    if(dex) patch.dex_id = dex;
    if(!Object.keys(patch).length) return;
    const write = (body) => client().from('user_cards')
      .update(body)
      .eq('user_id', userId)
      .eq('card_id', card.id);
    try{
      const { error } = await write(patch);
      if(error && isMissingNewColumn(error)){
        const { card_lang, dex_id, ...older } = patch;
        if(Object.keys(older).length) await write(older);
      }
    }catch{ /* not worth surfacing */ }
  }

  // Dex number → English species name, for a Japanese card someone owns
  // (where the search that would have known the English name happened on
  // some earlier visit). Free after the roster request the app already
  // makes; null rather than throwing, since every caller treats the
  // English name as a bonus.
  async function englishNameForDex(dexNumber){
    try{
      const pd = window.InfinitePullsPokemonData;
      const all = await pd.loadAllSpecies();
      const hit = all.find(sp => sp.id === Number(dexNumber));
      return hit ? pd.displayName(hit.name) : null;
    }catch{
      return null;
    }
  }

  // The original compact-row view — one line per card, image/name/value,
  // tap anywhere on a row to open its full detail (same as Binder view),
  // ✕ to remove.
  // Shown wherever a total contains a converted figure. A euro price
  // turned into dollars is still a European marketplace price, and
  // somebody pricing a card off this number deserves to know that rather
  // than discovering it later.
  function convertedNoteHtml(money){
    if(!money || !money.anyConverted) return '';
    const rate = money.fx && money.fx.rate ? money.fx.rate.toFixed(4) : null;
    const on = money.fx && money.fx.date ? ` (rate of ${escapeHtml(money.fx.date)})` : '';
    return `<p><small style="color:var(--muted)">Figures marked <strong>≈</strong> have no US market price and are converted from Cardmarket's European price${rate ? ` at €1 = $${escapeHtml(rate)}` : ''}${on}. Treat them as a guide, not a quote.</small></p>`;
  }

  function renderListView(listWrap, cfg, priced, total, anyMissing, user, mode, money){
    const cardByRowKey = {};
    priced.forEach(({ row, card }) => { cardByRowKey[row.rowIds.join(',')] = card; });

    const rowsHtml = priced.map(({ row, lineValue, converted }) => `
      <div class="info-row list-view-row" data-card-id="${escapeHtml(row.card_id)}" data-card-lang="${escapeHtml(row.card_lang || '')}" data-dex-id="${escapeHtml(row.dex_id ? String(row.dex_id) : '')}" style="align-items:center; cursor:pointer;">
        <span style="display:flex; align-items:center; gap:10px; min-width:0;">
          ${row.image_url ? `<img src="${escapeHtml(row.image_url)}" alt="" style="width:34px;height:47px;object-fit:contain;flex:0 0 auto;">` : ''}
          <span style="min-width:0;">
            <strong style="display:block">${escapeHtml(row.card_name)}</strong>
            <small>${escapeHtml(row.set_name || '')} · ${escapeHtml(VARIANT_LABELS[row.variant] || row.variant)} · ${escapeHtml(row.condition)}</small>
          </span>
        </span>
        <span class="list-row-actions">
          <span class="qty-stepper">
            <button type="button" class="qty-btn qty-down" data-row-ids="${escapeHtml(row.rowIds.join(','))}" data-qty="${row.quantity}" aria-label="One fewer ${escapeHtml(row.card_name)}">−</button>
            <span class="qty-value">${row.quantity}</span>
            <button type="button" class="qty-btn qty-up" data-row-ids="${escapeHtml(row.rowIds.join(','))}" data-qty="${row.quantity}" aria-label="One more ${escapeHtml(row.card_name)}">+</button>
          </span>
          <strong>${lineValue !== null ? `${converted ? '≈' : ''}${currency(lineValue)}` : 'price unavailable'}</strong>
          <button type="button" class="ghost-btn edit-holding-btn" data-row-ids="${escapeHtml(row.rowIds.join(','))}" aria-label="Change condition or printing for ${escapeHtml(row.card_name)}">Edit</button>
          <button type="button" class="ghost-btn remove-card-btn" data-row-ids="${escapeHtml(row.rowIds.join(','))}" aria-label="Remove">✕</button>
        </span>
      </div>
    `).join('');

    listWrap.innerHTML = `
      <div class="notice" style="display:flex; justify-content:space-between; align-items:center;">
        <span>${escapeHtml(cfg.totalLabel)}</span>
        <strong style="font-size:1.3rem">${currency(total)}</strong>
      </div>
      ${anyMissing ? '<p><small>Some cards don\'t have current pricing available and aren\'t included in the total.</small></p>' : ''}
      ${convertedNoteHtml(money)}
      <div class="info-list">${rowsHtml}</div>
    `;

    listWrap.querySelectorAll('.remove-card-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        await client().from(cfg.table).delete().in('id', btn.dataset.rowIds.split(','));
        if(cfg.table === 'user_cards') window.InfinitePullsPokemonData.invalidateOwnedCollectionCache();
        renderYourList(user, mode);
      });
    });

    listWrap.querySelectorAll('.qty-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation(); // the whole row is a tap target for the detail view
        const current = parseInt(btn.dataset.qty, 10) || 0;
        const next = btn.classList.contains('qty-up') ? current + 1 : current - 1;
        btn.closest('.qty-stepper')?.querySelectorAll('.qty-btn').forEach(b => { b.disabled = true; });
        await setCardQuantity(cfg, btn.dataset.rowIds.split(','), next, user, mode);
      });
    });

    listWrap.querySelectorAll('.edit-holding-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // the whole row opens the card detail
        const key = btn.dataset.rowIds;
        const entry = priced.find(p => p.row.rowIds.join(',') === key);
        if(entry) showHoldingEditor(btn.closest('.list-view-row'), entry.row, cardByRowKey[key], cfg, user, mode);
      });
    });

    listWrap.querySelectorAll('.list-view-row').forEach(rowEl => {
      rowEl.addEventListener('click', () => openOwnedCardDetail(rowEl.dataset.cardId, user, mode, rowFromDataset(rowEl)));
    });
  }

  // Rows that are the same card in the same variant and condition are one
  // holding as far as a collector is concerned. New adds merge at write
  // time (see the add form above), but rows created before that behaviour
  // existed are still separate, so they're folded together here too — the
  // The two bits of a saved row that a re-fetch needs, read back off the
  // element that was clicked: which TCGdex database this card id lives in,
  // and which Pokémon it is. Both are blank for rows added before those
  // columns existed, which every caller handles.
  function rowFromDataset(el){
    if(!el || !el.dataset) return null;
    return {
      card_lang: el.dataset.cardLang || null,
      dex_id: el.dataset.dexId ? parseInt(el.dataset.dexId, 10) || null : null,
    };
  }

  // grouped entry carries every underlying row id so remove and quantity
  // edits can act on all of them at once.
  function groupOwnedRows(rows){
    const byKey = new Map();
    rows.forEach(row => {
      const key = [row.card_id, row.variant, row.condition].join('|');
      const found = byKey.get(key);
      const qty = Number(row.quantity) || 0;
      if(found){
        found.quantity += qty;
        found.rowIds.push(row.id);
      } else {
        byKey.set(key, { ...row, quantity: qty, rowIds: [row.id] });
      }
    });
    return [...byKey.values()];
  }

  // ---- Changing a card you already own --------------------------------
  //
  // Until now the only things you could do to a card in your collection
  // were change how many you had and delete it. Condition and variant were
  // decided at the moment you added the card and frozen forever, so fixing
  // a mistake meant deleting the card and adding it again — losing when you
  // added it, and every Collector Goal that counted it in between.
  //
  // The awkward part isn't the edit, it's that changing a holding can
  // COLLIDE with one you already have. Own 3 Near Mint and 1 Lightly
  // Played, fix the played one, and there should now be one row of 4, not
  // two rows that happen to match. And the real-world action is usually a
  // SPLIT rather than an edit: one of your four got dinged at a show, so
  // one copy moves to Lightly Played and three stay put.
  //
  // Both fall out of one operation — move `count` copies of a holding to a
  // different variant/condition — so that is what this implements, and
  // "change the condition of all of them" is just the case where count is
  // the whole stack.
  //
  // The arithmetic is separated from the database work so it can be tested
  // on its own; a bug here silently changes how many cards somebody owns,
  // which is the worst kind of bug this app could have. See
  // tools/holdings-test.mjs.
  function planHoldingMove(state){
    const sourceRowIds = state.sourceRowIds || [];
    const targetRowIds = state.targetRowIds || [];
    const sourceQty = Number(state.sourceQty) || 0;
    const targetQty = Number(state.targetQty) || 0;

    if(!sourceRowIds.length || sourceQty <= 0) return { noop: true, reason: 'nothing-to-move' };
    if(state.sameHolding) return { noop: true, reason: 'unchanged' };

    // Moving more than you have, or fewer than one, is a mistake rather
    // than an instruction — clamped instead of refused so a fat-fingered
    // number still does the sensible thing.
    const move = Math.max(1, Math.min(sourceQty, Math.floor(Number(state.moveCount) || 0)));
    const remaining = sourceQty - move;

    const updates = [];
    const inserts = [];
    const deletes = [];

    if(targetRowIds.length){
      // Somewhere to merge into. Fold every matching row into the first.
      updates.push({ id: targetRowIds[0], patch: { quantity: targetQty + move } });
      deletes.push(...targetRowIds.slice(1));
    } else if(remaining === 0){
      // The whole stack is moving and there's nothing to merge with, so
      // the row itself simply becomes the new holding. Cheapest path, and
      // it keeps the original added_at rather than resetting it.
      updates.push({ id: sourceRowIds[0], patch: { variant: state.variant, condition: state.condition, quantity: move } });
    } else {
      inserts.push({ fromId: sourceRowIds[0], values: { variant: state.variant, condition: state.condition, quantity: move } });
    }

    if(remaining > 0){
      updates.push({ id: sourceRowIds[0], patch: { quantity: remaining } });
      deletes.push(...sourceRowIds.slice(1));
    } else if(targetRowIds.length){
      deletes.push(...sourceRowIds);
    } else {
      deletes.push(...sourceRowIds.slice(1));
    }

    return { noop: false, move, remaining, updates, inserts, deletes };
  }

  // Carries out a plan. The insert copies the source row rather than
  // building a fresh one, so rarity/illustrator/set_id/dex_id/card_lang —
  // everything Collector Goals and My Pokédex read — survive a split
  // instead of being quietly dropped.
  async function applyHoldingMove(cfg, plan, user, mode){
    if(plan.noop) return true;
    try{
      for(const insert of plan.inserts){
        const { data: source } = await client().from(cfg.table).select('*').eq('id', insert.fromId).maybeSingle();
        if(!source) return false;
        const copy = { ...source, ...insert.values };
        delete copy.id;
        delete copy.added_at;
        const { error } = await client().from(cfg.table).insert(copy);
        if(error) return false;
      }
      for(const update of plan.updates){
        const { error } = await client().from(cfg.table).update(update.patch).eq('id', update.id);
        if(error) return false;
      }
      if(plan.deletes.length){
        await client().from(cfg.table).delete().in('id', [...new Set(plan.deletes)]);
      }
    }catch{
      return false;
    }
    if(cfg.table === 'user_cards') window.InfinitePullsPokemonData.invalidateOwnedCollectionCache();
    return true;
  }

  // Finds the rows that a move would land on, so the plan knows whether it
  // is merging or creating.
  async function findTargetHolding(cfg, userId, cardId, variant, condition){
    try{
      const { data } = await client().from(cfg.table)
        .select('id, quantity')
        .eq('user_id', userId).eq('card_id', cardId)
        .eq('variant', variant).eq('condition', condition);
      const rows = data || [];
      return {
        targetRowIds: rows.map(r => r.id),
        targetQty: rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0),
      };
    }catch{
      return { targetRowIds: [], targetQty: 0 };
    }
  }

  // What you own of this card, on the card's own page.
  //
  // This replaces a dead end. Opening a card from your collection used to
  // show only "This is already in My Collection — use the ✕ on its row
  // back in the list to remove or adjust it", which was wrong twice over:
  // ✕ has never adjusted anything, and the one screen where you'd expect
  // to fix a condition was the one screen with no way to. The gate is on
  // WHERE YOU CAME FROM rather than on ownership, so anybody browsing
  // their own collection hit it every single time.
  function holdingsSectionHtml(holdings, cfg){
    if(!holdings.length){
      return `<p style="margin-top:14px"><small>Not in ${escapeHtml(cfg.tabLabel)} yet.</small></p>`;
    }
    const noun = cfg.table === 'wishlist_cards' ? 'on your wish list' : 'in your collection';
    return `
      <h3 style="margin-top:20px; margin-bottom:6px; font-size:1rem;">Your ${holdings.length === 1 ? 'Copy' : 'Copies'}</h3>
      <p><small style="color:var(--muted)">Each line is one printing in one condition ${escapeHtml(noun)}. Edit to change either, or to split part of a stack off.</small></p>
      <div class="info-list" id="holdings-list">
        ${holdings.map(row => `
          <div class="info-row holding-row" data-row-ids="${escapeHtml(row.rowIds.join(','))}">
            <span style="min-width:0">
              <strong style="display:block">${escapeHtml(VARIANT_LABELS[row.variant] || row.variant)}</strong>
              <small style="color:var(--muted)">${escapeHtml(row.condition)}${row.quantity > 1 ? ` · ${row.quantity}×` : ''}</small>
            </span>
            <span style="display:flex; align-items:center; gap:8px;">
              <button type="button" class="ghost-btn holding-edit-btn" data-row-ids="${escapeHtml(row.rowIds.join(','))}">Edit</button>
              <button type="button" class="ghost-btn holding-remove-btn" data-row-ids="${escapeHtml(row.rowIds.join(','))}" aria-label="Remove this copy">✕</button>
            </span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // The edit panel itself. Opens inline underneath whatever was clicked
  // rather than in a dialog, so the row you're fixing stays on screen next
  // to the thing you're changing.
  //
  // "How many" is the whole feature in one field: leave it at the full
  // stack and you've changed the condition of all of them, turn it down
  // and you've split one off. Same control, and nobody has to be taught
  // there are two operations.
  // `onSaved` lets the card detail page refresh itself instead of throwing
  // the visitor back to the list, which is what the list view wants but
  // would be jarring from a card you were reading.
  function showHoldingEditor(anchorEl, row, card, cfg, user, mode, onSaved){
    if(!anchorEl) return;
    document.querySelectorAll('.holding-editor').forEach(el => el.remove());

    const variants = card ? variantOptions(card) : [{ value: row.variant, label: VARIANT_LABELS[row.variant] || row.variant }];
    // A holding can be on a printing the price source no longer lists.
    // Keep it as an option regardless, so opening the editor can't quietly
    // move somebody's card to a different printing.
    if(!variants.some(v => v.value === row.variant)){
      variants.unshift({ value: row.variant, label: (VARIANT_LABELS[row.variant] || row.variant) + ' (current)' });
    }

    const panel = document.createElement('div');
    panel.className = 'holding-editor';
    panel.innerHTML = `
      <div class="holding-editor-head">
        <strong>${escapeHtml(row.card_name)}</strong>
        <small>${escapeHtml(row.quantity)} in your ${cfg.table === 'user_cards' ? 'collection' : 'wish list'}</small>
      </div>
      <div class="holding-editor-grid">
        <label>Printing
          <select name="variant">
            ${variants.map(v => `<option value="${escapeHtml(v.value)}"${v.value === row.variant ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}
          </select>
        </label>
        <label>${escapeHtml(cfg.conditionLabel)}
          <select name="condition">
            ${CONDITIONS.map(c => `<option value="${escapeHtml(c)}"${c === row.condition ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </label>
        <label>How many
          <input name="count" type="number" min="1" max="${row.quantity}" value="${row.quantity}"${row.quantity === 1 ? ' disabled' : ''}>
        </label>
      </div>
      <p class="holding-editor-note" aria-live="polite"></p>
      <div class="form-actions">
        <button type="button" class="primary-btn holding-save">Save</button>
        <button type="button" class="ghost-btn holding-cancel">Cancel</button>
      </div>
    `;
    anchorEl.insertAdjacentElement('afterend', panel);

    const variantEl = panel.querySelector('[name="variant"]');
    const conditionEl = panel.querySelector('[name="condition"]');
    const countEl = panel.querySelector('[name="count"]');
    const noteEl = panel.querySelector('.holding-editor-note');
    const saveBtn = panel.querySelector('.holding-save');

    // Says out loud what Save is about to do. The split is the case people
    // get wrong, so it is spelled out before it happens rather than
    // explained afterwards by a row count they didn't expect.
    function describe(){
      const count = Math.max(1, Math.min(row.quantity, parseInt(countEl.value, 10) || 1));
      const staying = row.quantity - count;
      const sameHolding = variantEl.value === row.variant && conditionEl.value === row.condition;
      const label = `${VARIANT_LABELS[variantEl.value] || variantEl.value} · ${conditionEl.value}`;
      if(sameHolding){
        noteEl.textContent = 'Nothing to change yet — pick a different printing or condition.';
        saveBtn.disabled = true;
        return;
      }
      saveBtn.disabled = false;
      noteEl.textContent = staying > 0
        ? `${count} of your ${row.quantity} become ${label}. The other ${staying} stay as they are.`
        : `All ${row.quantity} become ${label}.`;
    }

    [variantEl, conditionEl, countEl].forEach(input => {
      input.addEventListener('input', describe);
      input.addEventListener('change', describe);
    });
    describe();

    panel.querySelector('.holding-cancel').addEventListener('click', () => panel.remove());

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      const variant = variantEl.value;
      const condition = conditionEl.value;
      const moveCount = Math.max(1, Math.min(row.quantity, parseInt(countEl.value, 10) || 1));

      const { targetRowIds, targetQty } = await findTargetHolding(cfg, user.id, row.card_id, variant, condition);
      const plan = planHoldingMove({
        sourceRowIds: row.rowIds,
        sourceQty: row.quantity,
        targetRowIds, targetQty,
        variant, condition, moveCount,
        sameHolding: variant === row.variant && condition === row.condition,
      });

      const ok = await applyHoldingMove(cfg, plan, user, mode);
      if(!ok){
        saveBtn.disabled = false;
        saveBtn.textContent = 'Could not save — try again';
        return;
      }
      panel.remove();
      if(typeof onSaved === 'function') onSaved();
      else renderYourList(user, mode);
    });
  }

  // Writes a new total for one grouped holding. Any extra rows folded into
  // the group are removed as part of the write, so touching a quantity also
  // quietly tidies up historical duplicates. A total of 0 drops the card.
  async function setCardQuantity(cfg, rowIds, nextQty, user, mode){
    const ids = Array.isArray(rowIds) ? rowIds : [rowIds];
    if(nextQty <= 0){
      await client().from(cfg.table).delete().in('id', ids);
    } else {
      const [keep, ...extras] = ids;
      await client().from(cfg.table).update({ quantity: nextQty }).eq('id', keep);
      if(extras.length) await client().from(cfg.table).delete().in('id', extras);
    }
    if(cfg.table === 'user_cards') window.InfinitePullsPokemonData.invalidateOwnedCollectionCache();
    renderYourList(user, mode);
  }

  async function renderYourList(user, mode){
    const cfg = LIST_CONFIG[mode];
    const listWrap = document.getElementById('collection-list-wrap');
    if(!listWrap) return;
    listWrap.innerHTML = '<div class="empty-state">Loading…</div>';

    const BASE_COLUMNS = 'id, card_id, card_name, set_name, image_url, variant, condition, quantity, added_at';
    const readRows = (columns) => client()
      .from(cfg.table)
      .select(columns)
      .eq('user_id', user.id)
      .order('added_at', { ascending: false });

    let { data: rows, error } = await readRows(`${BASE_COLUMNS}, card_lang, dex_id`);
    if(error && isMissingNewColumn(error)){
      ({ data: rows, error } = await readRows(BASE_COLUMNS));
    }

    if(error){ listWrap.innerHTML = `<div class="empty-state">Could not load this: ${escapeHtml(error.message)}</div>`; return; }
    if(!rows.length){ listWrap.innerHTML = `<div class="empty-state">${escapeHtml(cfg.emptyList)}</div>`; return; }

    // One fetch per unique card (pricing only lives on the full-card
    // endpoint, not the list endpoint) — run them together since TCGdex
    // has no rate limit to worry about for a single visitor's list.
    // Keyed by id AND language: a Japanese card id has to be asked of the
    // Japanese database or it simply 404s, and the two databases can carry
    // similar-looking ids. Rows saved before card_lang existed fall back to
    // trying both, which is what fetchCardDetailAnyLang does.
    const uniqueCards = new Map();
    rows.forEach(r => {
      const lang = langOf(r.card_lang || DEFAULT_LANG);
      if(!uniqueCards.has(r.card_id)) uniqueCards.set(r.card_id, lang);
    });
    const cardById = {};
    await Promise.all([...uniqueCards.entries()].map(async ([id, lang]) => {
      try{ cardById[id] = await fetchCardDetailAnyLang(id, lang); }catch{ /* that card just shows "price unavailable" below */ }
    }));

    // One rate for the whole list, resolved alongside the card lookups
    // rather than per row.
    const fx = await loadEurToUsd();

    const priced = groupOwnedRows(rows).map(row => {
      const card = cardById[row.card_id];
      const value = card ? usdValueFor(card, row.variant, fx) : { amount: null, converted: false };
      const lineValue = typeof value.amount === 'number' ? value.amount * row.quantity : null;
      // The card comes along so the edit panel can offer the printings that
      // actually exist for it rather than a fixed list. `converted` follows
      // so every view can mark a euro-derived figure as one.
      return { row, lineValue, card, converted: value.converted };
    });

    let total = priced.reduce((sum, p) => sum + (p.lineValue || 0), 0);
    let anyMissing = priced.some(p => p.lineValue === null);

    // Sealed product lives in its own tab but its value belongs in the one
    // total, because somebody asking what their collection is worth means
    // all of it. Only ever counts real dollar figures — a box with no
    // price adds nothing rather than being guessed at, and folds into the
    // same "some things aren't counted" note the card list already shows.
    // Wish List is left alone: a total of things you don't own yet
    // shouldn't gain the boxes you do.
    if(mode === 'collection'){
      const sealed = await sealedValue(user.id);
      total += sealed.total;
      if(sealed.anyMissing) anyMissing = true;
      // The home page's scoreboard reads this. Pricing a whole collection
      // means one TCGdex lookup per unique card, which is fine on the page
      // somebody opened to see prices and far too much for a home screen --
      // so the number is kept the moment it is worked out here, and the
      // home page shows this rather than doing the work again. See
      // cacheCollectionValue() below for why it does not rely on the
      // once-a-day snapshot alone.
      cacheCollectionValue(user.id, total);
    }

    const anyConverted = priced.some(p => p.converted);

    if(mode === 'collection' && viewMode === 'portfolio'){
      await renderPortfolioView(user, listWrap, priced, total, anyMissing, mode, { fx, anyConverted });
      return;
    }

    if(viewMode === 'list'){
      renderListView(listWrap, cfg, priced, total, anyMissing, user, mode, { fx, anyConverted });
      return;
    }

    // Shown like a real binder: a fixed 4×4 grid per "page," with extra
    // cards spilling onto additional pages a visitor swipes/flips between
    // horizontally, rather than one long vertical list. Tapping a card
    // opens the exact same detail view search results use; the small ✕
    // badge is the only way to remove a card now that the whole tile is
    // a tap target.
    const PAGE_SIZE = 16; // 4 wide × 4 high
    const pages = [];
    for(let i = 0; i < priced.length; i += PAGE_SIZE) pages.push(priced.slice(i, i + PAGE_SIZE));

    const pagesHtml = pages.map(pageItems => `
      <div class="binder-page">
        ${pageItems.map(({ row, lineValue, converted }) => `
          <div class="binder-card" data-card-id="${escapeHtml(row.card_id)}" data-card-lang="${escapeHtml(row.card_lang || '')}" data-dex-id="${escapeHtml(row.dex_id ? String(row.dex_id) : '')}" tabindex="0" role="button" aria-label="View ${escapeHtml(row.card_name)}">
            <button type="button" class="binder-remove-btn" data-row-ids="${escapeHtml(row.rowIds.join(','))}" aria-label="Remove ${escapeHtml(row.card_name)}">✕</button>
            <button type="button" class="binder-edit-btn" data-row-ids="${escapeHtml(row.rowIds.join(','))}" aria-label="Change condition or printing for ${escapeHtml(row.card_name)}" title="Change condition or printing">✎</button>
            ${row.quantity > 1 ? `<span class="binder-qty" title="${row.quantity} copies">${row.quantity}</span>` : ''}
            ${row.image_url
              ? `<img src="${escapeHtml(row.image_url)}" alt="" loading="lazy">`
              : `<img src="./assets/logo.png" alt="" style="opacity:.35;">`}
            <strong>${escapeHtml(row.card_name)}</strong>
            <small>${lineValue !== null ? `${converted ? '≈' : ''}${currency(lineValue)}` : '—'}</small>
          </div>
        `).join('')}
      </div>
    `).join('');

    listWrap.innerHTML = `
      <div class="notice" style="display:flex; justify-content:space-between; align-items:center;">
        <span>${escapeHtml(cfg.totalLabel)}</span>
        <strong style="font-size:1.3rem">${currency(total)}</strong>
      </div>
      ${anyMissing ? '<p><small>Some cards don\'t have current pricing available and aren\'t included in the total.</small></p>' : ''}
      ${convertedNoteHtml({ fx, anyConverted })}
      <div class="binder-scroll" id="binder-scroll">${pagesHtml}</div>
      ${pages.length > 1 ? `
        <div class="binder-nav">
          <button type="button" class="ghost-btn" id="binder-prev" aria-label="Previous page">‹</button>
          <div class="binder-dots" id="binder-dots">
            ${pages.map((_, i) => `<span class="binder-dot${i === 0 ? ' active' : ''}"></span>`).join('')}
          </div>
          <button type="button" class="ghost-btn" id="binder-next" aria-label="Next page">›</button>
        </div>
        <p style="text-align:center; margin-top:4px;"><small id="binder-page-label" style="color:var(--muted)">Page 1 of ${pages.length} — swipe or use the arrows to flip through</small></p>
      ` : ''}
    `;

    const scrollEl = document.getElementById('binder-scroll');
    const dots = Array.from(document.querySelectorAll('#binder-dots .binder-dot'));
    const pageLabel = document.getElementById('binder-page-label');

    function updateActivePage(){
      if(!scrollEl || !scrollEl.clientWidth) return;
      const pageIndex = Math.min(pages.length - 1, Math.max(0, Math.round(scrollEl.scrollLeft / scrollEl.clientWidth)));
      dots.forEach((d, i) => d.classList.toggle('active', i === pageIndex));
      if(pageLabel) pageLabel.textContent = `Page ${pageIndex + 1} of ${pages.length} — swipe or use the arrows to flip through`;
    }

    let scrollTimer = null;
    scrollEl?.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(updateActivePage, 80);
    });
    document.getElementById('binder-prev')?.addEventListener('click', () => {
      scrollEl?.scrollBy({ left: -scrollEl.clientWidth, behavior: 'smooth' });
    });
    document.getElementById('binder-next')?.addEventListener('click', () => {
      scrollEl?.scrollBy({ left: scrollEl.clientWidth, behavior: 'smooth' });
    });

    scrollEl?.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.binder-remove-btn');
      if(removeBtn){
        removeBtn.disabled = true;
        if(cfg.table === 'user_cards') window.InfinitePullsPokemonData.invalidateOwnedCollectionCache();
        client().from(cfg.table).delete().in('id', removeBtn.dataset.rowIds.split(',')).then(() => renderYourList(user, mode));
        return;
      }
      // Checked before the tile, so tapping the pencil edits rather than
      // opening the card underneath it.
      const editBtn = e.target.closest('.binder-edit-btn');
      if(editBtn){
        const key = editBtn.dataset.rowIds;
        const entry = priced.find(p => p.row.rowIds.join(',') === key);
        if(entry) showHoldingEditor(editBtn.closest('.binder-page'), entry.row, entry.card, cfg, user, mode);
        return;
      }
      const tile = e.target.closest('.binder-card');
      if(tile) openOwnedCardDetail(tile.dataset.cardId, user, mode, rowFromDataset(tile));
    });
  }

  // ---- Portfolio view: total value, value-over-time chart, ranked list ----
  function formatSnapshotDate(dateStr){
    try{
      return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }catch{ return dateStr; }
  }

  // Hand-rolled inline SVG line chart — no charting library. Plots each
  // day's total value left to right, scaled to fill the box.
  function buildValueChart(points){
    const W = 600, H = 160, PAD = 14;
    const values = points.map(p => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = (max - min) || Math.max(max, 1);
    const stepX = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
    const coords = points.map((p, i) => {
      const x = PAD + i * stepX;
      const y = H - PAD - ((p.value - min) / range) * (H - PAD * 2);
      return [x, y];
    });
    const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${(H - PAD).toFixed(1)} L${coords[0][0].toFixed(1)},${(H - PAD).toFixed(1)} Z`;

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;" role="img" aria-label="Collection value over time">
        <path d="${escapeHtml(areaPath)}" fill="var(--gold)" opacity="0.12"></path>
        <path d="${escapeHtml(linePath)}" fill="none" stroke="var(--gold)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></path>
        ${coords.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="var(--gold)"></circle>`).join('')}
      </svg>
      <div style="display:flex; justify-content:space-between; margin-top:4px;">
        <small style="color:var(--muted)">${escapeHtml(formatSnapshotDate(points[0].date))}</small>
        <small style="color:var(--muted)">${escapeHtml(formatSnapshotDate(points[points.length - 1].date))}</small>
      </div>
    `;
  }

  async function renderPortfolioView(user, listWrap, priced, total, anyMissing, mode, money){
    const { data: history, error: historyError } = await client()
      .from('collection_value_snapshots')
      .select('snapshot_date, total_value')
      .eq('user_id', user.id)
      .order('snapshot_date', { ascending: true });

    const points = (historyError || !history ? [] : history).map(h => ({ date: h.snapshot_date, value: Number(h.total_value) }));

    let changeHtml = '';
    if(points.length >= 2){
      const first = points[0].value;
      const last = points[points.length - 1].value;
      const delta = last - first;
      const pct = first > 0 ? (delta / first) * 100 : 0;
      const sign = delta >= 0 ? '+' : '-';
      const color = delta >= 0 ? '#5fd97a' : '#ff6b6b';
      changeHtml = `<small style="color:${color}; font-weight:700;">${sign}${currency(Math.abs(delta))} (${sign}${Math.abs(pct).toFixed(1)}%) since ${escapeHtml(formatSnapshotDate(points[0].date))}</small>`;
    }

    const chartHtml = points.length >= 2
      ? buildValueChart(points)
      : `<div class="empty-state" style="padding:22px 12px">📈 Building your value history — a new snapshot saves once a day, so check back in a day or two and a real trend line will start filling in here.</div>`;

    const ranked = priced
      .filter(p => p.lineValue !== null)
      .sort((a, b) => b.lineValue - a.lineValue)
      .slice(0, 10);

    const rankedHtml = ranked.length
      ? ranked.map(({ row, lineValue }, i) => `
          <div class="info-row ranked-card-row" data-card-id="${escapeHtml(row.card_id)}" data-card-lang="${escapeHtml(row.card_lang || '')}" data-dex-id="${escapeHtml(row.dex_id ? String(row.dex_id) : '')}" style="align-items:center; cursor:pointer;">
            <span style="display:flex; align-items:center; gap:10px; min-width:0;">
              <strong style="color:var(--muted); width:1.3em; flex:0 0 auto;">${i + 1}</strong>
              ${row.image_url ? `<img src="${escapeHtml(row.image_url)}" alt="" loading="lazy" style="width:34px;height:47px;object-fit:contain;flex:0 0 auto;">` : ''}
              <span style="min-width:0;">
                <strong style="display:block">${escapeHtml(row.card_name)} ${row.quantity > 1 ? `×${row.quantity}` : ''}</strong>
                <small>${escapeHtml(row.set_name || '')} · ${escapeHtml(VARIANT_LABELS[row.variant] || row.variant)}</small>
              </span>
            </span>
            <strong style="flex:0 0 auto">${currency(lineValue)}</strong>
          </div>
        `).join('')
      : '<div class="empty-state">No priced cards yet.</div>';

    listWrap.innerHTML = `
      <div class="notice" style="display:flex; flex-direction:column; gap:5px;">
        <span>Estimated Total Value *</span>
        <strong style="font-size:1.6rem">${currency(total)}</strong>
        ${changeHtml}
      </div>
      ${anyMissing ? '<p><small>Some cards don\'t have current pricing available and aren\'t included in the total.</small></p>' : ''}
      ${convertedNoteHtml(money)}
      <div style="margin-top:18px">${chartHtml}</div>
      <h3 style="margin-top:22px; margin-bottom:6px; font-size:1rem;">Most Valuable</h3>
      <p><small>Tap a card for its full details.</small></p>
      <div class="info-list">${rankedHtml}</div>
    `;

    listWrap.querySelectorAll('.ranked-card-row').forEach(rowEl => {
      rowEl.addEventListener('click', () => openOwnedCardDetail(rowEl.dataset.cardId, user, mode, rowFromDataset(rowEl)));
    });
  }

  // ---- Page shells ----
  /* The home page's "Look up a card" button lands here when nobody is
     signed in, so this card is the account prompt -- and it asks in the
     words of the thing they just tried to do rather than in the abstract.
     Somebody who came here from the nav rather than that button reads the
     same thing and loses nothing: looking a card up is what this page is
     for either way. */
  function renderSignedOut(){
    const el = root();
    if(!el) return;
    el.innerHTML = `
      <section class="hero">
        <div class="eyebrow">Look Up A Card</div>
        <h1>Free account, then look up anything</h1>
        <p>Search any card by name or number, or scan one with your camera — you'll see what it's worth and could keep it in a collection that adds itself up.</p>
        <p><a class="primary-btn" href="?page=account" data-route="account">Create a free account</a></p>
        <p><small style="color:var(--muted)">Already have one? The same button signs you in.</small></p>
      </section>
    `;
  }

  // The three tabs share one header row but only two of them are card
  // lists. Sealed has no card search, no variants and no conditions in the
  // card sense, so it gets its own component (components/sealed.js) rather
  // than a third entry in LIST_CONFIG that would be mostly exceptions.
  function tabRowHtml(mode){
    const tabs = [
      ['collection', 'My Collection'],
      ['wishlist',   'Wish List'],
      ['sealed',     'Sealed'],
    ];
    return `
      <section class="hero">
        <div class="eyebrow">My Cards</div>
        <div class="form-actions" style="margin-top:6px">
          ${tabs.map(([key, label]) => `<button type="button" data-tab="${key}" class="${mode === key ? 'primary-btn' : 'ghost-btn'}">${escapeHtml(label)}</button>`).join('')}
        </div>
      </section>
    `;
  }

  function wireTabRow(el, user, mode){
    el.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        if(btn.dataset.tab === mode) return;
        viewMode = 'binder';  // portfolio view only makes sense on the collection tab
        lastSearch = null;    // don't let one tab's search results bleed into another
        renderSignedIn(user, btn.dataset.tab);
      });
    });
  }

  async function renderSealed(user){
    const el = root();
    if(!el) return;
    const sealed = window.InfinitePullsSealed;
    if(!sealed){
      el.innerHTML = `${tabRowHtml('sealed')}<section class="hero section"><div class="empty-state">Sealed product isn't loaded — refresh and try again.</div></section>`;
      wireTabRow(el, user, 'sealed');
      return;
    }
    el.innerHTML = `${tabRowHtml('sealed')}<div id="sealed-tab"></div>`;
    wireTabRow(el, user, 'sealed');
    await sealed.renderSealedTab(document.getElementById('sealed-tab'), user, () => { sealedValueCache = null; });
  }

  async function renderSignedIn(user, mode='collection'){
    if(mode === 'sealed'){ await renderSealed(user); return; }
    const el = root();
    if(!el) return;
    const cfg = LIST_CONFIG[mode];

    el.innerHTML = `
      ${tabRowHtml(mode)}

      <section class="hero section">
        <div class="eyebrow">${escapeHtml(cfg.tabLabel)}</div>
        <h1>${escapeHtml(cfg.addTitle)}</h1>
        ${languageSwitchHtml()}
        <form id="card-search-form" class="form-grid">
          <label>Card Name or Number<input name="term" placeholder="${escapeHtml(cfg.searchPlaceholder)}" required></label>
          <p id="card-search-hint"><small style="color:var(--muted)">${searchHintHtml()}</small></p>
          <div class="form-actions">
            <button class="primary-btn" type="submit">Search</button>
            <button type="button" id="scan-card-btn" class="ghost-btn">📷 Scan a Card</button>
            ${window.InfinitePullsImport?.canImport?.(mode) ? '<button type="button" id="import-collection-btn" class="ghost-btn">⇪ Import a List</button>' : ''}
          </div>
        </form>
        <input type="file" id="scan-card-input" accept="image/*" capture="environment" style="display:none">
        <div id="card-search-results" style="margin-top:12px"></div>
      </section>

      <section class="hero section">
        <div class="eyebrow">${escapeHtml(cfg.yourEyebrow)}</div>
        <h1 style="margin-bottom:8px">${escapeHtml(cfg.yourTitle)}</h1>
        <div class="form-actions" style="margin-top:0;">
          ${(mode === 'collection' ? [['list','📋 List'],['portfolio','📈 Portfolio'],['binder','🗂️ Binder']] : [['list','📋 List'],['binder','🗂️ Binder']])
            .map(([key, label]) => `<button type="button" data-view="${key}" class="${viewMode === key ? 'primary-btn' : 'ghost-btn'}">${label}</button>`).join('')}
        </div>
        <div id="collection-list-wrap"></div>
        <p style="margin-top:14px"><small style="color:var(--muted)">* Card values shown are estimated market prices from <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a> (sourced from TCGplayer data), for reference only. Prices change often and are not set, guaranteed, or offered by Infinite Pulls. Cards with no US market price are counted at their Cardmarket European price converted to dollars, and marked <strong>≈</strong> wherever they appear. Sealed product you own <strong>is</strong> included in this total; see the Sealed tab for the breakdown.</small></p>
      </section>
    `;

    wireTabRow(el, user, mode);

    el.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        if(btn.dataset.view !== viewMode){
          viewMode = btn.dataset.view;
          renderSignedIn(user, mode);
        }
      });
    });

    document.getElementById('card-search-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      runCardSearch(e.target.elements.term.value.trim(), user, mode);
    });

    // Flipping the language re-runs whatever is already in the box, so the
    // switch answers the question someone actually has ("does this exist
    // in Japanese?") in one tap instead of making them search again.
    el.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = langOf(btn.dataset.lang);
        if(next === searchLang) return;
        searchLang = next;
        lastSearch = null;
        el.querySelectorAll('[data-lang]').forEach(b => {
          const on = b.dataset.lang === searchLang;
          b.classList.toggle('primary-btn', on);
          b.classList.toggle('ghost-btn', !on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        const input = el.querySelector('#card-search-form input[name="term"]');
        const hint = document.getElementById('card-search-hint');
        if(hint) hint.innerHTML = `<small style="color:var(--muted)">${searchHintHtml()}</small>`;
        if(input && input.value.trim()) runCardSearch(input.value.trim(), user, mode);
      });
    });

    document.getElementById('scan-card-btn')?.addEventListener('click', async () => {
      const shot = await openCardCamera();
      if(shot === null) return;                       // backed out on purpose
      if(shot === 'unavailable'){
        // No camera to be had — permission refused, an in-app browser, an
        // insecure context. Fall back to the picker rather than dead-ending.
        document.getElementById('scan-card-input')?.click();
        return;
      }
      handleScanFile(shot, user, mode, () => renderYourList(user, mode), true);
    });
    document.getElementById('scan-card-input')?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if(file) handleScanFile(file, user, mode, () => renderYourList(user, mode));
    });

    // Bringing a whole collection in from another app. Everything it
    // needs lives in components/collection-import*.js — this is only the
    // way in, so that a 155KB file does not grow by another thousand
    // lines for a screen most people use once.
    document.getElementById('import-collection-btn')?.addEventListener('click', () => {
      window.InfinitePullsImport?.open(user, mode, () => renderYourList(user, mode));
    });

    renderYourList(user, mode);
  }

  // ---- The search itself ----------------------------------------------
  //
  // Numbers first, deliberately. A number search runs identically in both
  // databases — "066/108" means the same thing whichever language the card
  // was printed in — so it needs no translation and is the most precise
  // query anyone can make. A NAME search is the one that has to cross the
  // language gap, and only in one direction: English in, Japanese out.
  async function runCardSearch(term, user, mode){
    const resultsEl = document.getElementById('card-search-results');
    if(!resultsEl || !term) return;
    const onAdded = () => renderYourList(user, mode);
    resultsEl.innerHTML = '<div class="empty-state">Searching…</div>';

    try{
      const { namePart, number, setTotal, numberOnly } = parseSearchTerm(term);

      if(numberOnly){
        await runNumberSearch(number, setTotal, user, onAdded, mode);
        return;
      }

      if(searchLang === 'ja'){
        await runJapaneseNameSearch(namePart || term, number, user, onAdded, mode);
        return;
      }

      const cards = await searchCards(number ? namePart : term, 'en');

      let finalCards = cards;
      let note = null;
      if(number){
        const numberMatches = cards.filter(c => matchesCardNumber(c.localId, number));
        if(numberMatches.length){
          finalCards = numberMatches;
          note = `Showing ${namePart} #${number} — ${numberMatches.length} match${numberMatches.length === 1 ? '' : 'es'}.`;
        } else if(cards.length){
          note = `Couldn't find "${namePart}" #${number} specifically — showing every "${namePart}" result instead.`;
        }
      }

      renderSearchResults(finalCards, user, onAdded, mode, note);
    }catch(err){
      resultsEl.innerHTML = `<div class="empty-state">Search failed: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function runNumberSearch(number, setTotal, user, onAdded, mode){
    const { setMatches, dexMatches, setTotalMissed } = await searchByNumber(number, setTotal, searchLang);

    if(!setMatches.length && !dexMatches.length){
      // Before saying no, check the other database — someone holding a
      // Japanese card with the switch on English (or the reverse) has typed
      // a number that genuinely exists, just not where we looked.
      const other = Object.keys(LANGUAGES).find(l => l !== searchLang);
      let elsewhere = null;
      try{ elsewhere = await searchByNumber(number, setTotal, other); }catch{ /* optional */ }
      if(elsewhere && (elsewhere.setMatches.length || elsewhere.dexMatches.length)){
        const groups = [];
        if(elsewhere.setMatches.length) groups.push({ label: `${LANGUAGES[other].label} · ${setTotal ? `${number}/${setTotal}` : `numbered ${number}`}`, cards: elsewhere.setMatches });
        if(elsewhere.dexMatches.length) groups.push({ label: `${LANGUAGES[other].label} · National Dex #${number}`, cards: elsewhere.dexMatches });
        renderSearchResults([], user, onAdded, mode,
          `Nothing numbered ${setTotal ? `${number}/${setTotal}` : number} in ${LANGUAGES[searchLang].label} — but there is in ${LANGUAGES[other].label}.`, groups);
        return;
      }

      renderSearchResults([], user, onAdded, mode,
        setTotal
          ? `No card numbered ${number}/${setTotal} found. Try just ${number} to see every card with that number.`
          : `No card numbered ${number} found.`);
      return;
    }

    const groups = [];
    if(setMatches.length){
      groups.push({
        label: setTotal && !setTotalMissed ? `Card ${number}/${setTotal}` : `Cards numbered ${number}`,
        cards: setMatches,
      });
    }
    if(dexMatches.length){
      groups.push({ label: `National Dex #${number}`, cards: dexMatches });
    }
    const notes = [];
    if(setTotalMissed) notes.push(`No set with ${setTotal} cards has a #${number} — showing every card numbered ${number} instead.`);
    if(groups.length > 1) notes.push('Tap the right card below.');
    renderSearchResults([], user, onAdded, mode, notes.join(' ') || null, groups);
  }

  // English name → Japanese cards. Says which Pokémon it decided you meant
  // and what that is in Japanese, because the results themselves are in a
  // script most people here can't read — without the line above them,
  // there'd be no way to tell a right answer from a wrong one.
  async function runJapaneseNameSearch(namePart, number, user, onAdded, mode){
    const { cards, species, reason } = await searchJapaneseFromEnglish(namePart);

    if(reason === 'bridge-missing'){
      renderSearchResults([], user, onAdded, mode,
        'Japanese search needs the Pokémon data to load first — give it a moment and try again.');
      return;
    }

    if(reason === 'not-a-pokemon'){
      renderSearchResults([], user, onAdded, mode,
        `Japanese search works by Pokémon name or by card number. "${namePart}" doesn't look like a Pokémon — for a Trainer, Item or Energy card, type the number off the bottom of the card instead (like 066/108).`);
      return;
    }

    // Stamped so everything downstream — the tile caption, eBay's search
    // string, the news feed, and the dex number saved with the card — has
    // the English identity the Japanese card itself never carries.
    cards.forEach(c => {
      if(species?.english) c._enName = species.english;
      if(species?.dexNumber) c._dexId = species.dexNumber;
    });

    const who = species?.english || namePart;
    const inJapanese = species?.japanese ? ` (${species.japanese}${species.romaji ? ` · ${species.romaji}` : ''})` : '';

    let finalCards = cards;
    let note = `Japanese cards for ${who}${inJapanese}.`;
    if(number){
      const numberMatches = cards.filter(c => matchesCardNumber(c.localId, number));
      if(numberMatches.length){
        finalCards = numberMatches;
        note = `Japanese ${who}${inJapanese} #${number} — ${numberMatches.length} match${numberMatches.length === 1 ? '' : 'es'}.`;
      } else if(cards.length){
        note = `No Japanese ${who} numbered ${number} — showing every Japanese ${who} card instead.`;
      }
    }

    if(!finalCards.length){
      renderSearchResults([], user, onAdded, mode,
        `No Japanese cards found for ${who}${inJapanese}. Not every Pokémon has one, and TCGdex's Japanese data is less complete than its English.`);
      return;
    }

    renderSearchResults(finalCards, user, onAdded, mode, note);
  }

  // The line under the search box. Different in each language because the
  // rules genuinely are different: English takes any card name, Japanese
  // takes a Pokémon name (translated for you) or a number.
  function searchHintHtml(){
    if(searchLang === 'ja'){
      return `Type a Pokémon in <strong>English</strong> — it gets matched to the Japanese card database for you. Or type the number off the bottom of the card (like <strong>066/108</strong>), which works the same in either language.`;
    }
    return `Search by name (<strong>Charizard ex</strong>) or by the number off the bottom of the card (<strong>199/165</strong>).`;
  }

  function languageSwitchHtml(){
    return `
      <div class="lang-switch" role="group" aria-label="Card language">
        ${Object.keys(LANGUAGES).map(code => {
          const on = code === searchLang;
          const lang = LANGUAGES[code];
          return `<button type="button" data-lang="${code}" class="${on ? 'primary-btn' : 'ghost-btn'}" aria-pressed="${on ? 'true' : 'false'}">${escapeHtml(lang.label)}${code === 'ja' ? ` <span class="lang-native">${escapeHtml(lang.native)}</span>` : ''}</button>`;
        }).join('')}
      </div>
    `;
  }

  // Set by findCards() below (My Pokédex's "FIND [X] CARDS" button on a
  // Pokémon it doesn't have yet — see components/pokedex.js) just before
  // navigating here, then consumed once on the next init() and cleared —
  // this is a plain module variable rather than a URL param because this
  // whole app is one long-lived SPA (see app.js) that never reloads
  // between "pages," so a simple in-memory handoff is all that's needed.
  let pendingSearchTerm = null;

  async function init(){
    const el = root();
    if(!el) return;
    if(!window.InfinitePullsSupabase || !window.InfinitePullsSupabase.ready){
      el.innerHTML = `<section class="hero"><div class="eyebrow">My Cards</div><h1>Not connected yet</h1><p>Connect Supabase in config.js to enable accounts and collections.</p></section>`;
      return;
    }

    const { data: { session } } = await client().auth.getSession();
    if(!session){ renderSignedOut(); return; }

    await renderSignedIn(session.user, 'collection');

    if(pendingCardId){
      const cardId = pendingCardId;
      pendingCardId = null;
      openOwnedCardDetail(cardId, session.user, 'collection');
      return;
    }

    if(pendingSearchTerm){
      const term = pendingSearchTerm;
      pendingSearchTerm = null;
      const input = document.querySelector('#card-search-form input[name="term"]');
      const form = document.getElementById('card-search-form');
      if(input && form){
        input.value = term;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
      return;
    }

    if(pendingScan){
      pendingScan = false;
      const scanBtn = document.getElementById('scan-card-btn');
      if(scanBtn){
        scanBtn.scrollIntoView({ block: 'center', behavior: 'instant' });
        scanBtn.click();
      }
      return;
    }

    if(pendingFocusSearch){
      pendingFocusSearch = false;
      const input = document.querySelector('#card-search-form input[name="term"]');
      if(input){
        // Scroll it into view before focusing: on a phone the keyboard
        // comes up over the bottom half, and a box focused off-screen is
        // somebody typing into nothing.
        input.scrollIntoView({ block: 'center', behavior: 'instant' });
        input.focus({ preventScroll: true });
      }
    }
  }

  // Called from My Pokédex's missing-Pokémon detail view ("FIND PSYDUCK
  // CARDS") to jump into My Collection's own card search, pre-filled and
  // already searching — the app-wide loop this whole feature is meant to
  // encourage (see components/pokedex.js's file header).
  function findCards(term){
    pendingSearchTerm = term;
    window.navigate('collection');
  }

  // Called from the home page's "Look up a card" button. Same jump as
  // findCards() but with nothing to search yet — it opens the box and puts
  // the cursor in it, so the next thing that happens is typing. Signed
  // out, init() renders the account prompt instead and this flag is simply
  // never used.
  let pendingFocusSearch = false;
  function lookUp(){
    pendingFocusSearch = true;
    window.navigate('collection');
  }

  // Called from the home page's Scanner chip. Same jump, then it opens the
  // camera picker straight away -- the scan button here is the thing the
  // chip is named after, so landing next to it and making somebody find it
  // would be a chip that lied. Signed out, init() renders the account
  // prompt instead and this flag is never used.
  let pendingScan = false;
  function scan(){
    pendingScan = true;
    window.navigate('collection');
  }

  // Called from My Pokédex's owned-cards list — jumps straight to one
  // specific card's full detail view rather than a search. Mirrors
  // pendingSearchTerm: the id is stashed, navigation re-runs init(), and
  // init() opens it once the collection UI actually exists to render into.
  let pendingCardId = null;
  function openCard(cardId){
    if(!cardId) return;
    pendingCardId = cardId;
    window.navigate('collection');
  }

  /* ---- CARD LOOKUP -- the fast lane -------------------------------------
   *
   * components/card-lookup.js is a page of its own for one job: somebody
   * standing at a show, mid-negotiation, needs a price NOW. It does not
   * add anything to a collection and it does not ask a second question.
   *
   * It is not a second search engine. Everything below hands straight to
   * the machinery this file already runs -- the same TCGdex lookups, the
   * same set-total narrowing, the same one place that decides what a card
   * is worth. Two front doors, one engine, so the two can never disagree
   * about a price.
   *
   * The typed path and the scanned path converge on purpose: the scanner's
   * whole job is to read "112/150" off the corner of the card, which is
   * exactly what somebody would have typed. Once there is a number, there
   * is only one code path.
   */

  /* Best available dollar figure for a card nobody owns yet, so there is
     no saved variant to price. Tries the real printings in the order a
     collector would assume, then lets usdValueFor do the euro fallback. */
  function bestUsdValue(card, fx){
    const tp = card && card.pricing && card.pricing.tcgplayer;
    if(tp){
      const preferred = ['normal', 'holofoil', 'reverse-holofoil', '1st-edition', '1st-edition-holofoil'];
      const keys = preferred.filter(k => tp[k]).concat(Object.keys(tp).filter(k => !preferred.includes(k)));
      for(const key of keys){
        const v = usdValueFor(card, key, fx);
        if(typeof v.amount === 'number') return { ...v, variant: key };
      }
    }
    return usdValueFor(card, undefined, fx);
  }

  /* "112/150" -> { number: '112', setTotal: '150' }. Takes any separator
     somebody's thumb produces -- a slash, a space, a dash -- because at a
     show the typing is fast and the keyboard is small. */
  function parseCardNumber(raw){
    const text = String(raw || '').trim();
    if(!text) return null;
    const parts = text.split(/[^0-9A-Za-z]+/).filter(Boolean);
    if(!parts.length) return null;
    if(parts.length === 1) return { number: parts[0], setTotal: '' };
    return { number: parts[0], setTotal: parts[1] };
  }

  /* One number in, priced cards out. Details are fetched in parallel and
     capped, because a lookup that takes four seconds is a lookup nobody
     uses twice. */
  const LOOKUP_LIMIT = 8;

  async function lookupByNumber(raw, lang){
    const parsed = parseCardNumber(raw);
    if(!parsed) return { results: [], setTotalMissed: false, parsed: null };

    const found = await searchByNumber(parsed.number, parsed.setTotal, lang);
    const briefs = [...found.setMatches, ...found.dexMatches].slice(0, LOOKUP_LIMIT);
    const fx = await loadEurToUsd();

    const results = await Promise.all(briefs.map(async (brief) => {
      try{
        const card = await fetchCardDetail(brief.id, brief.lang || lang);
        const value = bestUsdValue(card, fx);
        return { card, brief, amount: value.amount, converted: !!value.converted };
      }catch(_){
        return { card: null, brief, amount: null, converted: false };
      }
    }));

    return { results, setTotalMissed: found.setTotalMissed, parsed };
  }

  /* Camera, then the same corner-reading OCR the scanner in this file
     already runs -- but it RETURNS the number instead of rendering a
     result, so the lookup page can do its own thing with it. Pass 1 only:
     on the lookup page a failed read is answered by typing the number,
     which is faster than a second OCR pass over the card's name. */
  async function scanCardNumber(){
    const shot = await openCardCamera();
    if(shot === null) return { status: 'cancelled' };
    if(shot === 'unavailable') return { status: 'unavailable' };

    let worker, photo;
    try{
      [worker, photo] = await Promise.all([
        getOcrWorker(),
        shot instanceof HTMLCanvasElement ? Promise.resolve(shot) : loadImageToCanvas(shot, SCAN_MAX_DIM),
      ]);
    }catch(err){
      return { status: 'error', message: err.message || 'Could not read that photo.' };
    }

    // A scan ran, whatever it read. Infinite Rewards has a card for the
    // first one and it is asserted here for the same reason it is in the
    // collection scanner: somebody whose card was misread still scanned.
    window.InfinitePullsDex?.noticeScan?.();

    const texts = [];
    for(const region of GUIDED_NUMBER_REGIONS){
      const crop = binarizeForOcr(cropRegion(photo, region.fx, region.fy, region.fw, region.fh, 260));
      const text = await readText(worker, crop, '0123456789/', region.psm);
      if(!text.trim()) continue;
      texts.push(text);
      const candidate = extractNumberCandidates(text)[0];
      if(candidate) return { status: 'ok', number: candidate };
    }

    // The likeliest two regions again, judging each pixel against its own
    // neighbourhood -- what survives a reflection across the strip.
    for(const region of GUIDED_NUMBER_REGIONS.slice(0, 2)){
      const crop = adaptiveBinarize(cropRegion(photo, region.fx, region.fy, region.fw, region.fh, 260), 0.22);
      const text = await readText(worker, crop, '0123456789/', region.psm);
      if(!text.trim()) continue;
      texts.push(text);
      const candidate = extractNumberCandidates(text)[0];
      if(candidate) return { status: 'ok', number: candidate };
    }

    for(const text of texts){
      const loose = extractLooseNumbers(text)[0];
      if(loose) return { status: 'ok', number: loose };
    }

    return { status: 'unread' };
  }

  /* ---- One-tap add, from Card Lookup -------------------------------------
   *
   * The add form on this page asks three questions -- printing, condition,
   * quantity -- and it is right to. Card Lookup asks none of them, because
   * somebody mid-negotiation at a show is not going to stand there picking
   * a condition off a dropdown.
   *
   * So it takes the defaults a dealer would take anyway: the first priced
   * printing, Near Mint, one copy. Every one of those is editable in My
   * Collection afterwards, which is where somebody who cares about the
   * difference between Lightly and Moderately Played is going to be
   * sitting anyway.
   *
   * It bumps the quantity on an exact match rather than inserting a second
   * identical line, exactly as the full form does -- add the same card
   * twice at a show and you own two, not two rows.
   */
  const pdata = () => window.InfinitePullsPokemonData;

  async function quickAdd(card){
    const c = client();
    if(!c || !card) return { ok: false, reason: 'not-connected' };

    const { data: { session } } = await c.auth.getSession();
    const user = session && session.user;
    if(!user) return { ok: false, reason: 'signed-out' };

    const variant = (variantOptions(card)[0] || { value: 'normal' }).value;
    const condition = CONDITIONS[0];   // Near Mint

    try{
      const { data: dupes } = await c.from('user_cards')
        .select('id, quantity')
        .eq('user_id', user.id)
        .eq('card_id', card.id)
        .eq('variant', variant)
        .eq('condition', condition)
        .limit(1);

      if(dupes && dupes.length){
        const row = dupes[0];
        const quantity = (Number(row.quantity) || 0) + 1;
        const { error } = await c.from('user_cards').update({ quantity }).eq('id', row.id);
        if(error) return { ok: false, reason: error.message };
        pdata() && pdata().invalidateOwnedCollectionCache && pdata().invalidateOwnedCollectionCache();
        return { ok: true, quantity, variant, condition, bumped: true };
      }

      const dexNumber = (Array.isArray(card.dexId) && card.dexId.length ? card.dexId[0] : null) || card._dexId || null;
      const { error } = await c.from('user_cards').insert({
        user_id: user.id,
        card_id: card.id,
        card_name: card.name,
        set_name: (card.set && card.set.name) || null,
        image_url: card.image ? thumbUrl(card.image) : null,
        rarity: card.rarity || null,
        illustrator: card.illustrator || null,
        set_id: (card.set && card.set.id) || null,
        card_lang: cardLang(card),
        dex_id: dexNumber,
        variant, condition, quantity: 1
      });
      if(error) return { ok: false, reason: error.message };
      pdata() && pdata().invalidateOwnedCollectionCache && pdata().invalidateOwnedCollectionCache();
      return { ok: true, quantity: 1, variant, condition, bumped: false };
    }catch(err){
      return { ok: false, reason: (err && err.message) || 'could not save' };
    }
  }

  /* ---- Price tiles, for the Card Lookup rail ----------------------------
   *
   * Every figure this app can reach for one card, normalised into a list
   * the lookup page can slide sideways. Built here rather than there for
   * the same reason lookupByNumber is: one place decides what a card is
   * worth, so two screens can never quote different numbers.
   *
   * TCGplayer comes first and one tile PER PRINTING, because that is the
   * honest shape of the data. A card is not worth one number -- the
   * reverse holo is routinely worth several times the normal, and a rail
   * that averaged them would be wrong in a way somebody loses money on.
   */
  async function priceTilesFor(card){
    const fx = await loadEurToUsd();
    const tiles = [];

    const tp = (card && card.pricing && card.pricing.tcgplayer) || {};
    Object.keys(tp)
      .filter(k => k !== 'updated' && k !== 'unit')
      .forEach(key => {
        const amount = tp[key] && tp[key].marketPrice;
        if(typeof amount !== 'number' || !isFinite(amount)) return;
        tiles.push({
          kind: 'tcgplayer',
          source: 'TCGplayer',
          label: VARIANT_LABELS[key] || key,
          amount,
          note: 'market'
        });
      });

    // Cardmarket is in euros and is the ONLY source that covers Japanese
    // cards, so it is never dropped just because TCGplayer had something.
    const cm = card && card.pricing && card.pricing.cardmarket;
    const cmTrend = typeof (cm && cm.trend) === 'number' ? cm.trend
      : (typeof (cm && cm['trend-holo']) === 'number' ? cm['trend-holo'] : null);
    if(cmTrend !== null){
      tiles.push({
        kind: 'cardmarket',
        source: 'Cardmarket',
        label: 'Trend',
        euros: cmTrend,
        amount: (fx && fx.rate) ? Math.round(cmTrend * fx.rate * 100) / 100 : null,
        converted: true,
        note: 'europe'
      });
    }

    return tiles;
  }

  /* The eBay tile is fetched separately: it is a network round trip to an
     Edge Function and the rest of the rail should not wait on it. */
  async function ebayPriceFor(card){
    return fetchEbayPrice(card);
  }

  /* A link to REAL SOLD COMPS, which is a different question from the
     figure the tile shows. eBay's free API has no sold endpoint at all --
     ebayPriceFor above can only ever see what is being ASKED right now --
     so the sold number lives on eBay's own site and this is how somebody
     gets to it.
       LH_Sold=1 & LH_Complete=1   completed sales, not live listings
       _sop=13                     most recently ended first, because at a
                                   show a comp from Tuesday beats one from
                                   March
     The card number goes in the query even though ebayQueryFor leaves it
     out: that function feeds an API search where a number narrows too
     hard, but a human scanning sold comps wants exactly this printing. */
  function ebaySoldUrl(card, grade){
    if(!card) return '';
    const total = card.set && card.set.cardCount && card.set.cardCount.official;
    const number = card.localId ? (total ? `${card.localId}/${total}` : String(card.localId)) : '';
    /* A grade goes in the query verbatim -- "PSA 10", "BGS 9.5" -- which
       is how the listings themselves are titled, so it narrows to real
       slabbed sales of this card. Raw adds nothing: a raw search that
       excluded graded listings would need eBay filters this URL cannot
       express, and over-narrowing to zero comps is worse than a few slabs
       in the list. */
    const q = [card.name, (card.set && card.set.name) || '', number, grade || '', 'pokemon card']
      .filter(Boolean).join(' ').trim();
    return 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(q)
      + '&LH_Sold=1&LH_Complete=1&_sop=13';
  }

  /* ---- The collection's value, remembered ---------------------------
   *
   * WHY THIS EXISTS
   *
   * The home page scoreboard used to read the newest row of
   * collection_value_snapshots, which is written once a day by a Supabase
   * cron job. Two ways that shows a dash to somebody who plainly owns
   * cards: they added their collection today and the job has not run yet,
   * or that job was never scheduled on this project at all -- in which
   * case the dash is permanent and looks like a broken app.
   *
   * So the real figure is kept here, in the browser, every time My
   * Collection prices everything. It is the exact number that page shows,
   * so the two can never disagree, and it costs the home page nothing.
   *
   * Per user id, because a shared phone must never show one person's
   * collection value to the next one.
   */
  const VALUE_KEY = 'infinite-pulls-collection-value';

  function cacheCollectionValue(userId, total){
    if(!userId || typeof total !== 'number' || !isFinite(total)) return;
    try{
      localStorage.setItem(VALUE_KEY, JSON.stringify({ userId, total, at: Date.now() }));
    }catch(_){ /* private mode, or storage full -- the profile copy below still works */ }
    saveValueToProfile(userId, total);
  }

  /* THE SAME NUMBER, ON THE ACCOUNT.
   *
   * localStorage alone meant the value lived in ONE browser. Sign in on a
   * phone after building the collection on a desktop and the home page
   * showed a dash -- same account, same cards, no number -- and clearing
   * site data wiped it too. Both are a poor first impression on the one
   * screen the whole app opens with.
   *
   * profiles already takes writes from this app for bio, tags and the
   * grail card, so its own-row update policy covers this: no new table, no
   * new policy, and nothing that depends on the snapshot cron job.
   *
   * Fire and forget. This runs after the page has already drawn the total,
   * so a failure here costs a visitor nothing they can see -- and the
   * local copy has already been written above either way.
   */
  function saveValueToProfile(userId, total){
    const c = client();
    if(!c) return;
    c.from('profiles')
      .update({ collection_value: total, collection_value_at: new Date().toISOString() })
      .eq('id', userId)
      .then(() => {}, () => {});
  }

  function cachedCollectionValue(userId){
    try{
      const v = JSON.parse(localStorage.getItem(VALUE_KEY) || 'null');
      if(!v || v.userId !== userId || typeof v.total !== 'number') return null;
      return v;
    }catch(_){ return null; }
  }

  /* The account's copy, for a browser that has never priced this
     collection -- a new phone, or one that has had its data cleared.
     Returns null on any error, including the columns not existing yet, so
     a database that has not had the migration run simply falls back to the
     local copy rather than breaking the home page. */
  async function profileCollectionValue(userId){
    const c = client();
    if(!c || !userId) return null;
    try{
      const { data, error } = await c.from('profiles')
        .select('collection_value, collection_value_at')
        .eq('id', userId).maybeSingle();
      if(error || !data || data.collection_value == null) return null;
      const total = Number(data.collection_value);
      if(!isFinite(total)) return null;
      return { total, at: Date.parse(data.collection_value_at) || 0 };
    }catch(_){ return null; }
  }

  window.InfinitePullsCollection = { init, findCards, openCard, lookUp, scan,
    cachedCollectionValue, profileCollectionValue,
    lookupByNumber, scanCardNumber, parseCardNumber,
    priceTilesFor, ebayPriceFor, ebaySoldUrl, quickAdd, VARIANT_LABELS };
})();
