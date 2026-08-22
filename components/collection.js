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
        <strong>GOAL COMPLETE!</strong>
        <span>🏆 ${newlyCompleted.length} Collector Goals Complete</span>
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
  let setDateMapPromise = null;
  function loadSetReleaseDates(){
    if(setDateMapPromise) return setDateMapPromise;
    setDateMapPromise = (async () => {
      try{
        const sets = await fetchTcgdex(`${TCGDEX_BASE}/sets`, 1);
        if(!Array.isArray(sets)) return {};
        const map = {};
        sets.forEach(set => { if(set?.id && set.releaseDate) map[set.id] = set.releaseDate; });
        return map;
      }catch{
        return {};
      }
    })();
    return setDateMapPromise;
  }

  function sortByNewestSet(cards, dateMap){
    // Stable: cards whose set has no known date keep their original relative
    // order at the bottom rather than being shuffled arbitrarily.
    return cards
      .map((card, i) => ({ card, i, date: dateMap[card?.set?.id] || null }))
      .sort((a, b) => {
        if(a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
        if(a.date && !b.date) return -1;
        if(!a.date && b.date) return 1;
        return a.i - b.i;
      })
      .map(x => x.card);
  }

  // A bare number is ambiguous, so both readings are looked up at once:
  //   localId — the number printed on the card ("134/165")
  //   dexId   — the National Dex number, i.e. which Pokémon it is
  // The dex lookup is best-effort: dexId is an array field, and if TCGdex
  // won't filter on it the set-number half still works on its own rather
  // than the whole search failing.
  async function searchByNumber(number, setTotal){
    const isPlainNumber = /^\d{1,4}$/.test(number);
    const dexNum = isPlainNumber ? parseInt(number, 10) : null;
    const wantDex = !setTotal && dexNum !== null && dexNum >= 1 && dexNum <= 1200;

    const [bySetNumber, byDex, dateMap] = await Promise.all([
      fetchTcgdex(`${TCGDEX_BASE}/cards?localId=eq:${encodeURIComponent(number)}`)
        .then(r => Array.isArray(r) ? r : [])
        .catch(() => []),
      wantDex
        ? fetchTcgdex(`${TCGDEX_BASE}/cards?dexId=eq:${dexNum}`, 1)
            .then(r => Array.isArray(r) ? r : [])
            .catch(() => [])
        : Promise.resolve([]),
      loadSetReleaseDates(),
    ]);

    let setMatches = bySetNumber;
    let setTotalMissed = false;
    if(setTotal){
      const exact = bySetNumber.filter(c => String(c?.set?.cardCount?.official || '') === String(parseInt(setTotal, 10)));
      if(exact.length) setMatches = exact;
      else setTotalMissed = bySetNumber.length > 0;
    }

    // A card can legitimately answer to both readings (a Vaporeon that is
    // also #134 in its set). Show it once, under the set-number heading.
    const seen = new Set(setMatches.map(c => c.id));
    const dexMatches = byDex.filter(c => !seen.has(c.id));

    return {
      setMatches: sortByNewestSet(setMatches, dateMap).slice(0, SEARCH_RESULT_LIMIT),
      dexMatches: sortByNewestSet(dexMatches, dateMap).slice(0, SEARCH_RESULT_LIMIT),
      setTotalMissed,
    };
  }

  async function fetchCardDetail(id){
    return await fetchTcgdex(`${TCGDEX_BASE}/cards/${encodeURIComponent(id)}`);
  }

  // A bigger picture for the detail view than the thumbnail grid uses.
  function fullImageUrl(image){
    return image ? `${image}/high.webp` : '';
  }

  // Release date only lives on the FULL Set object (not the brief one
  // embedded in a card), so it needs its own fetch — cached by set ID
  // since most searches turn up several cards from the same set.
  const setDetailCache = {};
  async function fetchSetDetail(setId){
    if(!setId) return null;
    if(setDetailCache[setId]) return setDetailCache[setId];
    try{
      const data = await fetchTcgdex(`${TCGDEX_BASE}/sets/${encodeURIComponent(setId)}`);
      setDetailCache[setId] = data;
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
    try{
      const json = await fetchTcgdex(`${TCGDEX_BASE}/cards?name=eq:${encodeURIComponent(card.name)}`);
      return Array.isArray(json) ? json.filter(c => c.id !== card.id).slice(0, 24) : [];
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
    const cmRow = cmTrend !== null
      ? `<div class="info-row"><span>Cardmarket · Trend Price</span><strong>€${cmTrend.toFixed(2)}</strong></div>`
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

    return (tcgRows || cmRow || ebayRow) ? `${tcgRows}${cmRow}${ebayRow}` : '<p><small>No pricing available for this card yet.</small></p>';
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
          <button type="button" class="card search-result-btn" data-card-id="${escapeHtml(c.id)}" style="text-align:left; cursor:pointer;">
            ${c.image
              ? `<img src="${escapeHtml(thumbUrl(c.image))}" alt="" loading="lazy" style="width:100%;aspect-ratio:245/337;object-fit:contain;margin-bottom:8px;">`
              : `<div style="width:100%;aspect-ratio:245/337;margin-bottom:8px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid var(--border);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:10px;">
                   <img src="./assets/logo.png" alt="" style="width:55%;opacity:.55;">
                   <small style="color:var(--muted);text-align:center;line-height:1.2;">No preview picture</small>
                 </div>`}
            <strong style="display:block">${escapeHtml(c.name)}</strong>
            ${c.localId ? `<small style="display:block; color:var(--muted);">#${escapeHtml(String(c.localId))}${c.set?.cardCount?.official ? `/${escapeHtml(String(c.set.cardCount.official))}` : ''}${c.set?.name ? ` · ${escapeHtml(c.set.name)}` : ''}</small>` : ''}
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
          const card = await fetchCardDetail(btn.dataset.cardId);
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
    const query = encodeURIComponent(`${card.name} ${card.set?.name || ''} pokemon card`.trim());
    const links = [
      { label: 'eBay (live listings)', url: `https://www.ebay.com/sch/i.html?_nkw=${query}` },
      { label: 'TCGplayer', url: `https://www.tcgplayer.com/search/pokemon/product?q=${query}` },
      { label: 'Cardmarket', url: `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(`${card.name} ${card.set?.name || ''}`.trim())}` },
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
    return fetchNews(`${card.name} pokemon card`);
  }

  // Current eBay asking-price estimate, via a Supabase Edge Function that
  // proxies eBay's Browse API (see supabase/functions/ebay-price — free,
  // no eBay Partner Network application needed for basic search, but does
  // need the shop's own eBay Developer credentials set as a secret, so
  // this quietly returns unavailable until that's configured). Never
  // throws: same graceful-degradation pattern as fetchCardNews above.
  async function fetchEbayPrice(card){
    try{
      const { data, error } = await withTimeout(
        client().functions.invoke('ebay-price', {
          body: { query: `${card.name} ${card.set?.name || ''} pokemon card`.trim() }
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
    const [setDetail, otherPrintings, showShopLinks, ownedQty] = await Promise.all([
      fetchSetDetail(card.set?.id),
      fetchOtherPrintings(card),
      shopLinksEnabled(),
      fetchOwnedQuantity(cfg.table, user.id, card.id)
    ]);

    if(myToken !== cardDetailRenderToken) return; // a different card opened while we were waiting

    const releaseDate = formatReleaseDate(setDetail?.releaseDate);
    const cardNumber = card.localId && card.set?.cardCount?.official
      ? `${card.localId}/${card.set.cardCount.official}`
      : (card.localId || null);

    const attrRows = [];
    if(card.illustrator) attrRows.push(['Illustrator', card.illustrator]);
    if(releaseDate) attrRows.push(['Release Date', releaseDate]);
    if(card.rarity) attrRows.push(['Rarity', card.rarity]);
    if(Array.isArray(card.dexId) && card.dexId.length) attrRows.push(['National Dex #', card.dexId.join(', ')]);
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
          <p style="margin-top:14px"><small>This is already in ${escapeHtml(cfg.tabLabel)} — use the ✕ on its row back in the list to remove or adjust it.</small></p>
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
              <button type="button" class="card other-printing-btn" data-card-id="${escapeHtml(c.id)}" style="text-align:left; cursor:pointer; padding:8px;">
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
      const dexNumber = Array.isArray(card.dexId) && card.dexId.length ? card.dexId[0] : null;
      let wasAlreadyDiscovered = true;
      let speciesDisplayName = card.name;
      if(dexNumber && cfg.table === 'user_cards'){
        try{
          const pd = window.InfinitePullsPokemonData;
          const [info, ownedRows] = await Promise.all([pd.loadPokemonInfo(dexNumber), pd.fetchOwnedCollectionRows(user.id)]);
          speciesDisplayName = pd.displayName(info.species.name);
          wasAlreadyDiscovered = pd.ownedSummaryForSpecies(info.species.name, ownedRows).discovered;
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
      ({ error } = await client().from(cfg.table).insert({
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
        variant, condition, quantity
      }));
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

    resultsEl.querySelectorAll('.other-printing-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        resultsEl.innerHTML = '<div class="empty-state">Loading card details…</div>';
        resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try{
          const nextCard = await fetchCardDetail(btn.dataset.cardId);
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
  let viewMode = 'binder';

  // Tapping a card in List or Binder view — refetches full detail
  // (pricing, illustrator, other printings, etc. aren't on the list-row
  // data we already have) and opens it in the same detail view search
  // results use, just with a back button that returns to the collection
  // instead of a search grid.
  async function openOwnedCardDetail(cardId, user, mode){
    const resultsEl = document.getElementById('card-search-results');
    if(!resultsEl) return;
    resultsEl.innerHTML = '<div class="empty-state">Loading card details…</div>';
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try{
      const card = await fetchCardDetail(cardId);
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
    if(!card?.id || (!card.rarity && !card.illustrator && !card.set?.id)) return;
    try{
      await client().from('user_cards')
        .update({ rarity: card.rarity || null, illustrator: card.illustrator || null, set_id: card.set?.id || null })
        .eq('user_id', userId)
        .eq('card_id', card.id);
    }catch{ /* not worth surfacing */ }
  }

  // The original compact-row view — one line per card, image/name/value,
  // tap anywhere on a row to open its full detail (same as Binder view),
  // ✕ to remove.
  function renderListView(listWrap, cfg, priced, total, anyMissing, user, mode){
    const rowsHtml = priced.map(({ row, lineValue }) => `
      <div class="info-row list-view-row" data-card-id="${escapeHtml(row.card_id)}" style="align-items:center; cursor:pointer;">
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
          <strong>${lineValue !== null ? currency(lineValue) : 'price unavailable'}</strong>
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

    listWrap.querySelectorAll('.list-view-row').forEach(rowEl => {
      rowEl.addEventListener('click', () => openOwnedCardDetail(rowEl.dataset.cardId, user, mode));
    });
  }

  // Rows that are the same card in the same variant and condition are one
  // holding as far as a collector is concerned. New adds merge at write
  // time (see the add form above), but rows created before that behaviour
  // existed are still separate, so they're folded together here too — the
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

    const priced = groupOwnedRows(rows).map(row => {
      const card = cardById[row.card_id];
      const market = card ? priceForVariant(card, row.variant) : null;
      const lineValue = typeof market === 'number' ? market * row.quantity : null;
      return { row, lineValue };
    });

    const total = priced.reduce((sum, p) => sum + (p.lineValue || 0), 0);
    const anyMissing = priced.some(p => p.lineValue === null);

    if(mode === 'collection' && viewMode === 'portfolio'){
      await renderPortfolioView(user, listWrap, priced, total, anyMissing, mode);
      return;
    }

    if(viewMode === 'list'){
      renderListView(listWrap, cfg, priced, total, anyMissing, user, mode);
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
        ${pageItems.map(({ row, lineValue }) => `
          <div class="binder-card" data-card-id="${escapeHtml(row.card_id)}" tabindex="0" role="button" aria-label="View ${escapeHtml(row.card_name)}">
            <button type="button" class="binder-remove-btn" data-row-ids="${escapeHtml(row.rowIds.join(','))}" aria-label="Remove ${escapeHtml(row.card_name)}">✕</button>
            ${row.quantity > 1 ? `<span class="binder-qty" title="${row.quantity} copies">${row.quantity}</span>` : ''}
            ${row.image_url
              ? `<img src="${escapeHtml(row.image_url)}" alt="" loading="lazy">`
              : `<img src="./assets/logo.png" alt="" style="opacity:.35;">`}
            <strong>${escapeHtml(row.card_name)}</strong>
            <small>${lineValue !== null ? currency(lineValue) : '—'}</small>
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
      const tile = e.target.closest('.binder-card');
      if(tile) openOwnedCardDetail(tile.dataset.cardId, user, mode);
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

  async function renderPortfolioView(user, listWrap, priced, total, anyMissing, mode){
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
          <div class="info-row ranked-card-row" data-card-id="${escapeHtml(row.card_id)}" style="align-items:center; cursor:pointer;">
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
      <div style="margin-top:18px">${chartHtml}</div>
      <h3 style="margin-top:22px; margin-bottom:6px; font-size:1rem;">Most Valuable</h3>
      <p><small>Tap a card for its full details.</small></p>
      <div class="info-list">${rankedHtml}</div>
    `;

    listWrap.querySelectorAll('.ranked-card-row').forEach(rowEl => {
      rowEl.addEventListener('click', () => openOwnedCardDetail(rowEl.dataset.cardId, user, mode));
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
          <label>Card Name or Number<input name="term" placeholder="${escapeHtml(cfg.searchPlaceholder)}" required></label>
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
        <h1 style="margin-bottom:8px">${escapeHtml(cfg.yourTitle)}</h1>
        <div class="form-actions" style="margin-top:0;">
          ${(mode === 'collection' ? [['list','📋 List'],['portfolio','📈 Portfolio'],['binder','🗂️ Binder']] : [['list','📋 List'],['binder','🗂️ Binder']])
            .map(([key, label]) => `<button type="button" data-view="${key}" class="${viewMode === key ? 'primary-btn' : 'ghost-btn'}">${label}</button>`).join('')}
        </div>
        <div id="collection-list-wrap"></div>
        <p style="margin-top:14px"><small style="color:var(--muted)">* Card values shown are estimated market prices from <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a> (sourced from TCGplayer data), for reference only. Prices change often and are not set, guaranteed, or offered by Infinite Pulls.</small></p>
      </section>
    `;

    el.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        if(btn.dataset.tab !== mode){
          viewMode = 'binder'; // portfolio view only makes sense on the collection tab
          lastSearch = null; // don't let "My Collection" search results bleed into the Wish List tab or vice versa
          renderSignedIn(user, btn.dataset.tab);
        }
      });
    });

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
      const term = e.target.elements.term.value.trim();
      const resultsEl = document.getElementById('card-search-results');
      if(!term) return;
      resultsEl.innerHTML = '<div class="empty-state">Searching…</div>';
      try{
        const { namePart, number, setTotal, numberOnly } = parseSearchTerm(term);

        if(numberOnly){
          const { setMatches, dexMatches, setTotalMissed } = await searchByNumber(number, setTotal);
          if(!setMatches.length && !dexMatches.length){
            renderSearchResults([], user, () => renderYourList(user, mode), mode,
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
          renderSearchResults([], user, () => renderYourList(user, mode), mode, notes.join(' ') || null, groups);
          return;
        }

        const cards = await searchCards(number ? namePart : term);

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

        renderSearchResults(finalCards, user, () => renderYourList(user, mode), mode, note);
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

  window.InfinitePullsCollection = { init, findCards, openCard };
})();
