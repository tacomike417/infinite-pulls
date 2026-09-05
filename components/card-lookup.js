/* CARD LOOKUP — the fast lane.
 *
 * A page with one job. Somebody is standing at a show, mid-negotiation,
 * with a card in one hand and a phone in the other. They need a price and
 * they need it now. Everything on this screen serves that and nothing
 * else: no hero, no logo, no explanation, no second question.
 *
 * WHY IT IS NOT MY COLLECTION
 *
 * My Collection's search exists to ADD a card to a collection: pick the
 * printing, pick the condition, set a quantity, save. Correct for what it
 * is, and four taps too many for a man being asked "what do you want for
 * it" in front of him. This page never asks a second question -- it takes
 * a number and gives back a number.
 *
 * WHAT THE BOX MEANS DEPENDS ON THE MODE
 *
 *   English / Japanese   a printed card number -- "112/150", exactly as
 *                        it reads on the bottom of the card. The two
 *                        modes are two separate TCGdex databases, not a
 *                        filter: a Japanese card id asked of the English
 *                        database simply 404s.
 *   Sealed Product       a SET name -- "Obsidian Flames" -- because
 *                        sealed product has no card number. This is the
 *                        one thing on the page that changes what typing
 *                        means, so the placeholder says so and the chip
 *                        stays visibly chosen.
 *
 * The chosen mode is remembered. Somebody who deals in Japanese cards
 * should not re-pick Japanese every time they open the page, and one
 * saved tap is a real saving on a screen built around single seconds.
 *
 * TYPED AND SCANNED ARE THE SAME PATH
 *
 * The scanner's whole job is to read "112/150" off the corner. Once there
 * is a number, this page cannot tell how it arrived -- which means the
 * scan path gets every improvement the typed path gets, for free, and the
 * OCR can be swapped underneath without touching this file.
 *
 * The engine is components/collection.js. Same TCGdex lookups, same
 * set-total narrowing, same single function that decides what a card is
 * worth, so a price here can never disagree with a price there.
 */
(function () {
  'use strict';

  /* Short labels on purpose. These sit beside Scan Card on one row, and a
     row that has to hold "Sealed Product" leaves the scan button too
     narrow to hit in a hurry. `full` is what a screen reader says and what
     the tooltip shows, so nothing is actually lost. */
  const MODES = [
    /* "112 150", not "112/150". The number field opens a NUMERIC KEYPAD,
       and a numeric keypad has no slash on it -- so a placeholder reading
       "112/150" was instructing somebody to press a key that is not on
       their screen. Space, dash, comma and period all are, and the parser
       in collection.js splits on any non-alphanumeric character, so all of
       them work, and so does the slash on a desktop keyboard. The
       placeholder shows the one that is always reachable. */
    { key: 'en',     short: 'EN',  full: 'English',        placeholder: 'Card number, e.g. 112 150' },
    { key: 'ja',     short: 'JP',  full: 'Japanese',       placeholder: 'Card number, e.g. 112 150' },
    { key: 'sealed', short: '📦',  full: 'Sealed Product', placeholder: 'Set name, e.g. Obsidian Flames' }
  ];
  const MODE_KEY = 'infinite-pulls-lookup-mode';

  const sbWrap = () => window.InfinitePullsSupabase || {};
  const sb = () => (sbWrap().ready ? sbWrap().client : null);
  const col = () => window.InfinitePullsCollection;
  const sealed = () => window.InfinitePullsSealed;
  const root = () => document.getElementById('lookup-page');

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  const money = (n) => (typeof n === 'number' && isFinite(n))
    ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
    : null;

  let mode = 'en';
  let busy = false;
  let lastResults = [];

  function readMode() {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (MODES.some((m) => m.key === saved)) return saved;
    } catch (_) { /* private mode */ }
    return 'en';
  }
  function saveMode(m) {
    try { localStorage.setItem(MODE_KEY, m); } catch (_) { /* fine */ }
  }
  const modeMeta = () => MODES.find((m) => m.key === mode) || MODES[0];

  /* ---- The screen ---------------------------------------------------- */

  function shellHtml() {
    const meta = modeMeta();
    return `
      <section class="lookup-bar">
        <form id="lookup-form" autocomplete="off">
          <div class="lookup-row">
            <input id="lookup-input" type="text" name="q"
                   placeholder="${esc(meta.placeholder)}"
                   inputmode="${mode === 'sealed' ? 'text' : 'numeric'}"
                   enterkeyhint="search"
                   autocapitalize="none" autocorrect="off" spellcheck="false">
            <button type="submit" class="primary-btn lookup-go" aria-label="Look it up">Go</button>
          </div>
          <!-- Scan and the three modes share one row. The modes are what
               the scan and the box both act on, so they belong beside the
               thing they modify rather than on a line of their own. -->
          <div class="lookup-actions">
            <!-- The label follows the mode, because the button does two
                 genuinely different things. On a card it opens a camera
                 with a card-shaped outline and a capture button; on sealed
                 product it opens a barcode reader with no button at all,
                 which reads by itself. Calling both "Scan Card" invites
                 somebody to think they tapped the wrong thing. -->
            <button type="button" class="secondary-btn lookup-scan" id="lookup-scan">
              <span aria-hidden="true">${mode === 'sealed' ? '▥' : '📷'}</span> ${mode === 'sealed' ? 'Scan Barcode' : 'Scan Card'}
            </button>
            <div class="lookup-modes" role="group" aria-label="What to look up">
              ${MODES.map((m) => `
                <button type="button" class="lookup-mode${m.key === mode ? ' is-on' : ''}"
                        data-mode="${m.key}" aria-pressed="${m.key === mode}"
                        title="${esc(m.full)}" aria-label="${esc(m.full)}">${esc(m.short)}</button>`).join('')}
            </div>
          </div>
        </form>
      </section>

      <div id="lookup-status" class="lookup-status" role="status" aria-live="polite"></div>
      <div id="lookup-results"></div>`;
  }

  function signedOutHtml() {
    return `
      <section class="hero">
        <div class="eyebrow">Card Lookup</div>
        <h1>Free account, then look up anything</h1>
        <p>Type a card number or scan the card, and see what it's worth — English, Japanese, or sealed product.</p>
        <p><a class="primary-btn" href="?page=account" data-route="account">Create a free account</a></p>
        <p><small style="color:var(--muted)">Already have one? The same button signs you in.</small></p>
      </section>`;
  }

  function status(msg, kind) {
    const el = document.getElementById('lookup-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'lookup-status' + (kind ? ' is-' + kind : '');
  }

  /* ---- Results ------------------------------------------------------- */

  /* JAPANESE CARDS, MADE USEFUL.
   *
   * Jeff's words: some Japanese cards look up, some have images and some
   * do not, and the ones without an image are not useful. Both halves of
   * that are the same problem -- a row that says リザードン with a grey box
   * where the picture should be tells somebody who does not read Japanese
   * absolutely nothing.
   *
   * The app already knew how to fix this and was not doing it here. My
   * Collection's search has resolved a Japanese card to its English
   * Pokemon name for a long time, through the card's National Dex number:
   * dexId 6 is Charizard in any language. Card Lookup has its own render
   * path and simply never called it.
   *
   * So: the English name is shown under the Japanese one, and when TCGdex
   * carries no card art the Pokemon's sprite stands in. The sprite is
   * LABELLED, never passed off as the card -- it says which Pokemon this
   * is, which is the question being asked, and it does not pretend to be a
   * photograph of the thing in his hand. */
  function dexIdOf(card) {
    if (!card) return null;
    if (Array.isArray(card.dexId) && card.dexId.length) return Number(card.dexId[0]) || null;
    if (card._dexId) return Number(card._dexId) || null;
    return null;
  }

  /* Does this name contain Japanese script?
   *
   * NOT "has no Latin letters", which was the first version and which the
   * test suite immediately broke: modern Japanese cards are named things
   * like アルセウスVSTAR and リザードンex. The Latin suffix is right there,
   * so a Latin check said "no translation needed" for exactly the cards
   * Jeff is holding.
   *
   * Hiragana, katakana and kanji. An accented English name -- Flabébé --
   * is not caught, which is correct: it needs no translating. */
  function needsEnglish(name) {
    return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(String(name || ''));
  }

  /* Fills in r.enName for anything that needs it. loadAllSpecies() is
     promise-cached by pokemon-data.js, so this is one fetch for the whole
     session and free after that. Failures are silent: a missing English
     name leaves the row exactly as it was. */
  async function addEnglishNames(results) {
    const c = col();
    if (!c || !c.englishNameForDex) return results;
    await Promise.all((results || []).map(async (r) => {
      const card = r && r.card;
      if (!card || !needsEnglish(card.name)) return;
      const dex = dexIdOf(card);
      if (!dex) return;
      try { r.enName = await c.englishNameForDex(dex); } catch (_) { /* leave it */ }
    }));
    return results;
  }

  /* The card's own art if TCGdex has it; the Pokemon's sprite if not. */
  function artFor(card, enName) {
    if (card && card.image) return { src: card.image + '/high.webp', isCard: true };
    const pd = window.InfinitePullsPokemonData;
    const dex = dexIdOf(card);
    if (pd && pd.spriteUrl && dex) return { src: pd.spriteUrl(dex), isCard: false };
    return { src: '', isCard: false };
  }

  /* Deliberately plain for now: picture, what it is, what it is worth. The
     price is the biggest thing on the row because it is the only thing
     being asked for. */
  function cardRowHtml(r) {
    /* A row whose detail fetch failed renders from its brief, so it looks
       exactly like every other row -- but openCard() searches lastResults
       for a matching r.card and finds nothing, so tapping it did nothing
       at all, silently, every time. Say so on the row instead. */
    if (!r.card) {
      const b = r.brief || {};
      return `
        <div class="lookup-hit is-unpriced">
          <span class="lookup-hit-art">${b.image ? `<img src="${esc(b.image + '/low.webp')}" alt="" loading="lazy">` : ''}</span>
          <span class="lookup-hit-body">
            <strong>${esc(b.name || 'That card')}</strong>
            <small>Could not load this one — try again in a moment</small>
          </span>
        </div>`;
    }
    const c = r.card || r.brief || {};
    const setName = (c.set && c.set.name) || '';
    const total = c.set && c.set.cardCount && c.set.cardCount.official;
    const num = c.localId ? esc(c.localId) + (total ? '/' + esc(String(total)) : '') : '';
    const price = money(r.amount);
    /* A Japanese row with no picture and a name he cannot read is not a
       row he can choose from. The sprite says which Pokemon; the English
       name says which one in words. */
    const art = c.image ? { src: c.image + '/low.webp', isCard: true } : artFor(c, r.enName);
    return `
      <button type="button" class="lookup-hit" data-pick="${esc(c.id || '')}">
        <span class="lookup-hit-art${art.src && !art.isCard ? ' is-sprite' : ''}">
          ${art.src ? `<img src="${esc(art.src)}" alt="" loading="lazy" decoding="async">` : ''}
        </span>
        <span class="lookup-hit-body">
          <strong>${esc(c.name || 'Unknown card')}</strong>
          ${r.enName ? `<span class="lookup-hit-en">${esc(r.enName)}</span>` : ''}
          <small>${esc(setName)}${num ? ' · ' + num : ''}${art.src && !art.isCard ? ' · no card image' : ''}</small>
        </span>
        <span class="lookup-hit-price${price ? '' : ' is-none'}">
          ${price ? (r.converted ? '≈ ' : '') + esc(price) : 'No price'}
        </span>
      </button>`;
  }

  /* ---- The card itself ------------------------------------------------
   *
   * Once the card is picked this is the whole screen: the card big enough
   * to check against the one in his hand, what it is underneath, and then
   * every price we can reach as a rail that slides sideways.
   *
   * A rail rather than a stacked list because the prices are SIBLINGS, not
   * a ranking. Normal, Reverse Holo, Cardmarket and eBay are four answers
   * to the same question from four different markets, and stacking them
   * would say the top one is the real one.
   */

  let picked = null;   // the card currently open, for going back to the list

  /* ---- Grading --------------------------------------------------------
   *
   * WHAT PICKING A GRADE DOES, AND WHAT IT DELIBERATELY DOES NOT
   *
   * It retargets the eBay sold search. Pick PSA 10 and the eBay capsule
   * looks up completed sales of THIS card in a PSA 10 slab -- which is
   * exactly what a dealer does by hand, in one tap instead of typing.
   *
   * It does NOT change the TCGplayer or Cardmarket figures, and those
   * capsules say "raw" out loud once a grade is chosen. There is no
   * graded price in any source this app can reach, and the tempting fix --
   * multiplying raw by a per-grade factor -- would put an invented number
   * in front of somebody negotiating with real money. Graded multiples
   * swing from under 1x on a modern bulk common to 50x on a vintage holo,
   * so an estimate would not be roughly right, it would be wrong by
   * multiples in both directions.
   *
   * A real graded number needs a real graded source (PriceCharting is the
   * realistic one). When that exists it becomes another capsule, and this
   * rail already carries the grade it needs.
   */
  const GRADES = [
    { key: 'raw',      label: 'Raw',      query: '' },
    { key: 'psa10',    label: 'PSA 10',   query: 'PSA 10' },
    { key: 'psa9',     label: 'PSA 9',    query: 'PSA 9' },
    { key: 'psa8',     label: 'PSA 8',    query: 'PSA 8' },
    { key: 'bgs95',    label: 'BGS 9.5',  query: 'BGS 9.5' },
    { key: 'cgc95',    label: 'CGC 9.5',  query: 'CGC 9.5' }
  ];
  let grade = GRADES[0];

  function gradeRailHtml() {
    return `
      <div class="rail grade-rail" role="group" aria-label="Grade">
        ${GRADES.map((g) => `
          <button type="button" class="grade-chip${g.key === grade.key ? ' is-on' : ''}"
                  data-grade="${g.key}" aria-pressed="${g.key === grade.key}">${esc(g.label)}</button>`).join('')}
      </div>`;
  }

  /* Each capsule carries a mark for its source. These are OURS -- a
     letter on a coloured disc -- not the brands' logos, which are
     trademarks we do not redraw. If official logo files are ever dropped
     into assets/prices/, MARKS below is the one place to point at them
     and every capsule picks them up. */
  const MARKS = {
    tcgplayer:  { ch: 'T', cls: 'is-tcg' },
    cardmarket: { ch: 'C', cls: 'is-cm' },
    ebay:       { ch: 'e', cls: 'is-ebay-mark' }
  };

  function markHtml(kind) {
    const m = MARKS[kind] || { ch: '·', cls: '' };
    return `<span class="price-mark ${m.cls}" aria-hidden="true">${esc(m.ch)}</span>`;
  }

  function priceTileHtml(t) {
    const isCm = t.kind === 'cardmarket';
    const amount = isCm ? '€' + t.euros.toFixed(2) : money(t.amount);
    /* Once a grade is picked these figures are still RAW, and saying so
       is the difference between a price and a misunderstanding. */
    const raw = grade.key === 'raw' ? '' : ' · raw';
    const sub = isCm
      ? (t.amount !== null ? '≈ ' + money(t.amount) + ' · Cardmarket' + raw : 'Cardmarket · Europe' + raw)
      : t.source + ' · ' + t.label + raw;
    return `
      <div class="price-tile">
        ${markHtml(t.kind)}
        <span class="price-tile-text">
          <!-- paintTrends() appends the up/down arrow in here once it
               knows there is an honest one to draw. -->
          <strong class="price-tile-amount">${esc(amount)}</strong>
          <span class="price-tile-note">${esc(sub)}</span>
        </span>
      </div>`;
  }

  /* eBay is a link, not a figure. Its own API can only see what is being
     ASKED right now -- eBay has no free sold endpoint -- so the number on
     the tile is labelled as asking, and tapping goes to the real sold
     comps on eBay's site. It opens in a new tab because eBay blocks being
     put in a frame, and because he is mid-negotiation: he glances, comes
     back, and this page is exactly where he left it. */
  function ebayTileHtml(card, ebay) {
    const c = col();
    const href = (c && c.ebaySoldUrl) ? c.ebaySoldUrl(card, grade.query) : '';
    /* The in-app figure is an ASKING price across live listings, and it
       has no idea about grade -- so it is only shown for Raw. On a graded
       pick the capsule is purely the way to real slabbed sold comps, and
       it does not put a raw asking price under a PSA 10 heading. */
    const has = ebay && ebay.available && grade.key === 'raw';
    return `
      <a class="price-tile is-ebay" href="${esc(href)}" target="_blank" rel="noopener">
        ${markHtml('ebay')}
        <span class="price-tile-text">
          <strong class="price-tile-amount">${has ? esc(money(ebay.median)) : 'Sold'} <span class="price-tile-out" aria-hidden="true">↗</span></strong>
          <span class="price-tile-note">${has
            ? 'eBay asking · tap for sold'
            : (grade.key === 'raw' ? 'eBay · tap for sold comps' : 'eBay · sold ' + esc(grade.label))}</span>
        </span>
      </a>`;
  }

  /* EVERYTHING ON ONE SCREEN, WITHOUT SCROLLING.
   *
   * This started as a centred card with its name under it, and the prices
   * ended up below the fold -- on the one page whose entire reason for
   * existing is a price in the next second. The card was 350px tall on its
   * own.
   *
   * So the card and its details sit side by side. The art is here to
   * answer "is this the card in my hand", which a thumbnail does as well
   * as a poster, and putting the words beside it rather than under it buys
   * back about two hundred pixels -- which is the price rail.
   *
   * Back only appears when there is a list to go back to. A single match
   * opens straight to the card, and a button offering to return to a list
   * that was never drawn is a button that lies.
   */
  function detailHtml(card, tiles, showBack, enName) {
    const art = artFor(card, enName);
    const total = card.set && card.set.cardCount && card.set.cardCount.official;
    const num = card.localId ? esc(card.localId) + (total ? '/' + esc(String(total)) : '') : '';
    return `
      <div class="lookup-detail">
        ${showBack ? '<button type="button" class="lookup-back" data-back>← Back to results</button>' : ''}
        ${gradeRailHtml()}
        <div class="lookup-card">
          <div class="lookup-card-art${art.src && !art.isCard ? ' is-sprite' : ''}">
            ${art.src ? `<img src="${esc(art.src)}" alt="${esc(card.name || '')}">` : ''}
            ${art.src && !art.isCard ? '<span class="lookup-noart">No card image — this is the Pokémon, not the card</span>' : ''}
          </div>
          <div class="lookup-card-info">
            <h2 class="lookup-card-name">${esc(card.name || '')}</h2>
            ${enName ? `<p class="lookup-card-en">${esc(enName)}</p>` : ''}
            <p class="lookup-card-meta">${esc((card.set && card.set.name) || '')}</p>
            <p class="lookup-card-num">${num}</p>
            ${card.rarity ? `<p class="lookup-card-rarity">${esc(card.rarity)}</p>` : ''}
            <!-- Beside the card rather than under the prices: it is about
                 THIS card, and it belongs with the card's own details. -->
            <button type="button" class="primary-btn lookup-add" data-add>+ Add to my collection</button>
          </div>
        </div>

        <div class="rail price-rail" id="price-rail">
          ${tiles.length ? tiles.map(priceTileHtml).join('')
                         : '<div class="price-tile is-none"><span class="price-mark" aria-hidden="true">·</span><span class="price-tile-text"><strong class="price-tile-amount">—</strong><span class="price-tile-note">No price carried yet</span></span></div>'}
        </div>

        <!-- His own collection, under the prices. Filled in after the card
             draws: it is context, not the answer, and it must never make
             the price wait. -->
        <div id="lookup-mine"></div>
      </div>`;
  }

  /* Records what we just saw, then asks whether that is up or down on a
     week ago, and slips the arrow in beside the figure already drawn.
     `picked` is re-checked before every write because he may well have
     moved on to the next card by the time these come back. */
  async function paintTrends(card, tiles) {
    const tr = window.InfinitePullsTrend;
    if (!tr || !tiles || !tiles.length) return;

    // Bookkeeping. Fires into the void -- nothing on screen waits on it.
    tiles.forEach((t) => {
      if (t.kind === 'tcgplayer' && typeof t.amount === 'number') {
        // t.key, not t.label: the API's variant name, so this lands on the
        // same history row My Collection writes for the same printing.
        tr.record(card.id, t.key, t.amount, 'tcgplayer', 'USD');
      }
    });

    await Promise.all(tiles.map(async (t, i) => {
      let ch = null;
      try { ch = await tr.forCard(card, t.key, t.amount, t.kind); } catch (_) { return; }
      if (!ch || picked !== card) return;
      const rail = document.getElementById('price-rail');
      const tile = rail && rail.children[i];
      const amount = tile && tile.querySelector('.price-tile-amount');
      // Only ever added once, even if this somehow runs twice.
      if (amount && !amount.querySelector('.trend')) {
        amount.insertAdjacentHTML('beforeend', tr.arrowHtml(ch, { days: tr.CARD_DAYS }));
      }
    }));
  }

  /* The same strip as the home page, drawn by the same function, so the
     two can never drift apart. It answers the question that follows a
     price at a show: "hang on, do I already have this?" */
  async function showMyCollection(justAdded) {
    const wrap = document.getElementById('lookup-mine');
    const mine = window.InfinitePullsHomeMine;
    const data = window.InfinitePullsPokemonData;
    if (!wrap || !mine || !mine.collectionRail || !data) return;

    const client = sb();
    if (!client) return;
    try {
      const { data: sess } = await client.auth.getSession();
      const user = sess && sess.session && sess.session.user;
      if (!user) return;
      const rows = await data.fetchOwnedCollectionRows(user.id);
      /* A card he just added goes to the front and gets the animation.
         Without the hoist it lands wherever the collection's own order
         puts it, which on a sideways rail is frequently off screen -- so
         the button would say "Added" and nothing visible would happen. */
      wrap.innerHTML = mine.collectionRail(rows,
        justAdded ? { firstId: justAdded, flashId: justAdded } : null) || '';
      if (justAdded) {
        const rail = wrap.querySelector('.mine-scroller');
        if (rail) rail.scrollLeft = 0;
      }
    } catch (_) { /* a missing strip costs nothing; a stuck one would */ }
  }

  async function openCard(cardId) {
    const c = col();
    const hit = (lastResults || []).find((r) => r.card && r.card.id === cardId);
    if (!hit || !hit.card) return;
    // A different card starts from Raw. Carrying PSA 10 over to the next
    // card he looks up is how somebody reads a slab price for a loose card.
    if (!picked || picked.id !== hit.card.id) grade = GRADES[0];
    picked = hit.card;

    status('');
    const tiles = await c.priceTilesFor(hit.card);

    /* Resolved before the card draws, not after: the whole point is that
       he can tell what he is holding, and a name that appears a second
       later is a name he has already given up on. It is one cached
       lookup, so it costs nothing after the first card of the day. */
    let enName = hit.enName || null;
    if (!enName && needsEnglish(hit.card.name)) {
      await addEnglishNames([hit]);
      enName = hit.enName || null;
    }

    renderResults(detailHtml(hit.card, tiles, lastResults.length > 1, enName));

    /* Arrows land late, like eBay does, and for the same reason: this is
       the page somebody opens mid-negotiation, and a price is not allowed
       to wait on a history read. The number is on screen first; the arrow
       arrives beside it a moment later, or never, which is the honest
       outcome for a card with no history yet. */
    paintTrends(hit.card, tiles);
    window.scrollTo({ top: 0, behavior: 'instant' });

    showMyCollection();

    /* eBay lands late and on its own. The rail is already usable without
       it, and a card that takes seven seconds because eBay was slow is a
       card he stopped waiting for. */
    /* NOT awaited. eBay's own fetch has a seven second timeout, and this
       function is awaited by submit(), which holds `busy` until it
       returns. The result: for seven seconds after every single-match
       lookup, Go did nothing and -- worse -- a fresh scan opened the
       camera, took a photo, and was thrown away at submit()'s busy check
       while the screen still showed the previous card. The rail fills
       itself in whenever eBay answers; nothing waits on it. */
    (async () => {
      let ebay = null;
      try { ebay = await c.ebayPriceFor(hit.card); } catch (_) { ebay = null; }
      const rail = document.getElementById('price-rail');
      if (rail && picked === hit.card && !rail.querySelector('.price-tile.is-ebay')) {
        rail.insertAdjacentHTML('beforeend', ebayTileHtml(hit.card, ebay));
      }
    })();
  }

  /* The sealed row leans on sealed.js's own price label, which already
     knows the difference between a sold price and an asking price and
     says so. Re-deciding that here is how the two screens end up quoting
     different numbers for the same box. */
  function sealedRowHtml(product, priced, setName) {
    const s = sealed();
    const price = priced || product;
    const img = price.imageUrl || product.imageUrl;
    const label = (s && s.priceLabelHtml) ? s.priceLabelHtml(price) : '';
    const unpriced = typeof price.price !== 'number';
    return `
      <div class="lookup-hit${unpriced ? ' is-unpriced' : ''}">
        <span class="lookup-hit-art">
          ${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">` : ''}
        </span>
        <span class="lookup-hit-body">
          <strong>${esc(product.name)}</strong>
          <small>${esc(setName || '')}</small>
        </span>
        <span class="lookup-hit-price${unpriced ? ' is-none' : ''}">${label}</span>
      </div>`;
  }

  function renderResults(html) {
    const el = document.getElementById('lookup-results');
    if (el) el.innerHTML = html;
  }

  /* ---- Looking things up --------------------------------------------- */

  async function runCardLookup(raw) {
    const c = col();
    if (!c || !c.lookupByNumber) { status('Lookup is not available right now.', 'bad'); return; }

    status('Looking it up…');
    renderResults('');
    try {
      const { results, setTotalMissed, parsed } = await c.lookupByNumber(raw, mode);
      await addEnglishNames(results);
      if (!parsed) { status('Type the number from the bottom of the card, like 112/150.', 'bad'); return; }

      if (!results.length) {
        status(`Nothing found for ${parsed.number}${parsed.setTotal ? '/' + parsed.setTotal : ''} in ${mode === 'ja' ? 'Japanese' : 'English'}. ${mode === 'en' ? 'Try the Japanese chip.' : 'Try the English chip.'}`, 'bad');
        return;
      }

      lastResults = results;

      /* One match and no ambiguity about the set: there is nothing to
         choose, so choosing is a tap that exists only to be spent. Go
         straight to the card. */
      if (results.length === 1 && !setTotalMissed && results[0].card) {
        await openCard(results[0].card.id);
        return;
      }

      /* The set total narrowed to nothing, so what is on screen is every
         card with that number. Say so -- a silently widened search is how
         somebody quotes a price off the wrong card. */
      status(setTotalMissed
        ? `No set with ${parsed.setTotal} cards has a ${parsed.number} — showing every card numbered ${parsed.number}.`
        : `${results.length} match${results.length === 1 ? '' : 'es'}`);
      renderResults(results.map(cardRowHtml).join(''));
    } catch (err) {
      status('That did not go through — try again in a moment.', 'bad');
    }
  }

  /* SEARCH BY NAME, not number.
   *
   * Only ever reached from the scanner: Google read the card but the
   * number in the corner was gone -- glare, wear, a thumb over it -- while
   * the name across the top came through fine. That is the ordinary way a
   * scan fails, because the name is the biggest text on a card and the
   * number is the smallest.
   *
   * Showing "18 Charizards, which one" is a far better answer at a table
   * than "could not read that card". It renders through exactly the same
   * rows as a number search, so there is one result screen to maintain. */
  async function runNameLookup(name) {
    const c = col();
    if (!c || !c.lookupByName) { status('Lookup is not available right now.', 'bad'); return; }
    if (busy) return;
    busy = true;

    status(`Looking up ${name}…`);
    renderResults('');
    try {
      const { results } = await c.lookupByName(name, mode);
      await addEnglishNames(results);
      if (!results.length) {
        status(`Read the name "${name}" but found no card by it. Type the number instead.`, 'bad');
        focusBox(true);
        return;
      }

      lastResults = results;
      /* NEVER auto-opens, not even on a single match. A number identifies
         one card; a NAME is a guess off a photo, and a guess that opens
         straight onto a price is how a wrong price gets quoted to a
         customer. One result still gets shown as a row to tap. */
      status(`Could not read the number, but read "${name}" — ${results.length} match${results.length === 1 ? '' : 'es'}. Tap the right one.`);
      renderResults(results.map(cardRowHtml).join(''));
    } catch (_) {
      status('That did not go through — try again in a moment.', 'bad');
    } finally {
      busy = false;
    }
  }

  /* A SCANNED BOX, MATCHED BY ITS BARCODE.
   *
   * The first time a barcode is unknown, whoever is holding the box names
   * it once. Every scan afterwards is instant and exact. There is no free
   * database of Pokemon UPCs, so rather than pay for one or do without,
   * the shop builds its own -- and it ends up better than a bought one,
   * because it holds the products actually stocked at the prices actually
   * charged, with no rate limit and nothing to go down. */
  async function scanSealedBarcode() {
    const bc = window.InfinitePullsBarcode;
    if (!bc || !bc.supported()) {
      status('Barcode scanning needs Chrome on Android. Type the set name instead.', 'bad');
      focusBox(true);
      return;
    }

    status('📷 Point at the barcode…');
    const code = await bc.scan();
    if (code === null) { status(''); return; }
    if (code === 'unavailable') {
      status('No camera available here — type the set name instead.', 'bad');
      focusBox(true);
      return;
    }

    const client = sb();
    if (!client) { status('Not connected right now.', 'bad'); return; }

    status('Looking up ' + code + '…');
    let row = null;
    try {
      const { data } = await client.from('sealed_barcodes')
        .select('*').eq('barcode', code).maybeSingle();
      row = data || null;
    } catch (_) { /* treat as unknown */ }

    if (row) {
      // Seen before: show it, and note that it was seen again.
      try {
        await client.from('sealed_barcodes')
          .update({ last_seen: new Date().toISOString() }).eq('barcode', code);
      } catch (_) { /* not worth failing over */ }
      renderResults(knownSealedHtml(row));
      status('');
      return;
    }

    renderResults(newSealedHtml(code));
    wireSealedForm();
    status('First time seeing this one — name it once and it is known from now on.');
  }

  /* Known product: what it is, what it costs, and HOW MANY HE HAS.
     The quantity is the point of the whole screen -- recognising the box
     is only useful if the next tap puts it in the inventory sheet. It
     defaults to 1 and sits under his thumb, because the common case is
     one box at a time and the second-commonest is a small number he
     types. */
  function knownSealedHtml(row) {
    const price = (typeof row.price === 'number') ? money(row.price) : null;
    return `
      <div class="sealed-known">
        <h2 class="lookup-card-name">${esc(row.product_name)}</h2>
        <p class="lookup-card-meta">${esc([row.product_type, row.set_name, row.language].filter(Boolean).join(' · '))}</p>
        ${price ? `<p class="sealed-price">${esc(price)}</p>` : '<p class="lookup-card-meta">No price set yet</p>'}
        <p class="lookup-card-num">Barcode ${esc(row.barcode)}</p>

        <div class="sealed-qty">
          <label>How many do you have?
            <input type="number" id="sealed-qty" min="1" step="1" value="1" inputmode="numeric">
          </label>
          <button type="button" class="primary-btn" data-stock-sealed="${esc(row.barcode)}">Add to inventory</button>
        </div>
        <div id="sealed-stock-status" class="save-status"></div>

        <button type="button" class="ghost-btn" data-edit-sealed="${esc(row.barcode)}">Edit this product</button>
      </div>`;
  }

  /* Straight into the same queue the card scanner fills, so sealed boxes
     and singles come out on one sheet for Clover rather than two. The
     barcode becomes the SKU -- it is already unique per exact product,
     which is the whole reason we scan it. */
  async function stockSealed(code) {
    const client = sb();
    const out = document.getElementById('sealed-stock-status');
    if (!client) return;

    const qty = parseInt(document.getElementById('sealed-qty')?.value, 10);
    if (!isFinite(qty) || qty < 1) {
      if (out) { out.textContent = 'How many? At least 1.'; out.style.color = '#fca5a5'; }
      return;
    }

    if (out) { out.textContent = 'Adding…'; out.style.color = ''; }
    try {
      const { data: row } = await client.from('sealed_barcodes')
        .select('*').eq('barcode', code).maybeSingle();
      if (!row) { if (out) { out.textContent = 'That product went missing — scan it again.'; out.style.color = '#fca5a5'; } return; }

      let userId = null;
      try {
        const { data } = await client.auth.getSession();
        userId = data && data.session && data.session.user && data.session.user.id;
      } catch (_) { /* still worth the row */ }

      const { error } = await client.from('shop_scan_queue').insert({
        scanned_by: userId,
        card_id: null,
        name: row.product_name,
        set_name: row.set_name,
        card_number: null,
        image_url: row.image_url,
        sku: row.barcode,
        price: row.price,
        market_price: row.market_price,
        quantity: qty
      });
      if (error) { if (out) { out.textContent = error.message || 'Could not add that.'; out.style.color = '#fca5a5'; } return; }
      if (out) {
        out.textContent = `Added ${qty} × ${row.product_name}. Scan the next one.`;
        out.style.color = '#86efac';
      }
    } catch (err) {
      if (out) { out.textContent = (err && err.message) || 'Could not add that.'; out.style.color = '#fca5a5'; }
    }
  }

  /* The naming form. Deliberately short: product name and price are the
     two that matter, everything else is optional and can stay blank
     forever without hurting anything. Somebody standing at a counter with
     a queue is not filling in twelve fields. */
  function newSealedHtml(code, row) {
    const r = row || {};
    return `
      <div class="sealed-new">
        <p class="lookup-card-num">Barcode ${esc(code)}</p>
        <label>What is it?<input type="text" id="sealed-name" placeholder="e.g. Obsidian Flames Elite Trainer Box" value="${esc(r.product_name || '')}"></label>
        <label>Your price<input type="number" id="sealed-price" step="0.01" min="0" inputmode="decimal" value="${r.price != null ? esc(r.price) : ''}"></label>
        <label>Type <small>(optional)</small><input type="text" id="sealed-type" placeholder="Booster box, ETB, tin…" value="${esc(r.product_type || '')}"></label>
        <label>Set <small>(optional)</small><input type="text" id="sealed-set" placeholder="Obsidian Flames" value="${esc(r.set_name || '')}"></label>
        <label>Language<select id="sealed-lang">
          <option value="English"${r.language === 'Japanese' ? '' : ' selected'}>English</option>
          <option value="Japanese"${r.language === 'Japanese' ? ' selected' : ''}>Japanese</option>
        </select></label>
        <div class="admin-actions">
          <button type="button" class="primary-btn" data-save-sealed="${esc(code)}">Save it</button>
        </div>
        <!-- Anything already named that looks like what he is typing.
             Fills in as he types; empty and invisible otherwise. -->
        <div id="sealed-similar" class="sealed-similar" hidden></div>
      </div>`;
  }

  /* WHY THIS EXISTS: the catalogue rots quietly without it.
   *
   * A box named "Obsidian Flames ETB" on Tuesday and a near-identical one
   * named "Obsidian Flames Elite Trainer Box" on Friday are two products
   * as far as anything downstream is concerned, and the export sheet Jeff
   * hands Clover looks like it was written by two different people.
   *
   * It does not block anything. Two boxes really can be nearly the same
   * name and genuinely different -- a Pokemon Center ETB is the obvious
   * case. So this shows what already exists and lets him decide. */
  let similarTimer = null;
  async function showSimilarProducts(typed) {
    const box = document.getElementById('sealed-similar');
    const client = sb();
    if (!box || !client) return;

    const q = String(typed || '').trim();
    if (q.length < 3) { box.hidden = true; box.innerHTML = ''; return; }

    try {
      const { data } = await client.from('sealed_barcodes')
        .select('barcode, product_name, price')
        .ilike('product_name', '%' + q.slice(0, 40) + '%')
        .limit(4);
      const rows = data || [];
      if (!rows.length) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      box.innerHTML = '<small>Already named, in case one of these is the same thing:</small>'
        + rows.map((r) => `<div class="sealed-similar-row">${esc(r.product_name)}`
            + `<span>${typeof r.price === 'number' ? esc(money(r.price)) : ''}</span></div>`).join('');
    } catch (_) { /* a hint that fails is not worth mentioning */ }
  }

  function wireSealedForm() {
    const name = document.getElementById('sealed-name');
    if (!name) return;
    name.addEventListener('input', () => {
      if (similarTimer) clearTimeout(similarTimer);
      similarTimer = setTimeout(() => showSimilarProducts(name.value), 350);
    });
  }

  async function saveSealed(code) {
    const client = sb();
    if (!client) return;
    const name = (document.getElementById('sealed-name')?.value || '').trim();
    if (!name) { status('Give it a name first.', 'bad'); return; }
    const priceRaw = parseFloat(document.getElementById('sealed-price')?.value);

    let userId = null;
    try {
      const { data } = await client.auth.getSession();
      userId = data && data.session && data.session.user && data.session.user.id;
    } catch (_) { /* still worth saving */ }

    status('Saving…');
    try {
      const { error } = await client.from('sealed_barcodes').upsert({
        barcode: code,
        product_name: name,
        product_type: (document.getElementById('sealed-type')?.value || '').trim() || null,
        set_name: (document.getElementById('sealed-set')?.value || '').trim() || null,
        language: document.getElementById('sealed-lang')?.value || 'English',
        price: isFinite(priceRaw) ? priceRaw : null,
        last_seen: new Date().toISOString(),
        added_by: userId
      }, { onConflict: 'barcode' });
      if (error) { status(error.message || 'Could not save that.', 'bad'); return; }
      const { data } = await client.from('sealed_barcodes').select('*').eq('barcode', code).maybeSingle();
      if (data) renderResults(knownSealedHtml(data));
      status('Saved. That barcode is known from now on.', 'good');
    } catch (err) {
      status((err && err.message) || 'Could not save that.', 'bad');
    }
  }

  /* The old set-name path, still reached by TYPING in sealed mode.
   *
   * Vision returns every line on the box -- the set name, "36 BOOSTER
   * PACKS", the copyright. Longest first is a decent proxy for "most
   * likely to be the set name", and the first line that matches a real set
   * wins. Nothing is guessed: if no line matches a set, it says so and
   * hands him the keyboard. */
  async function runSealedFromLines(lines) {
    const s = sealed();
    if (!s || !s.matchingSets) { status('Sealed lookup is not available right now.', 'bad'); return; }
    if (!lines.length) { status('Could not read that box — type the set name instead.', 'bad'); focusBox(true); return; }

    status('Reading the box…');
    try {
      const sets = await s.loadSets('en');
      for (const line of lines) {
        const hits = s.matchingSets(sets || [], line);
        if (hits && hits.length) {
          const box = document.getElementById('lookup-input');
          if (box) box.value = line;
          await runSealedLookup(line);
          return;
        }
      }
      status(`Read the box but no set matched. It said "${lines[0]}". Try typing the set name.`, 'bad');
      focusBox(true);
    } catch (_) {
      status('That did not go through — try again in a moment.', 'bad');
    }
  }

  /* Sealed is a set name, then that set's products -- two steps, because
     a flat list of every product of every set is thousands of rows and
     the upstream catalogue bills per product returned. Same reasoning,
     and the same functions, as the Sealed tab in My Collection. */
  async function runSealedLookup(query) {
    const s = sealed();
    if (!s || !s.matchingSets) { status('Sealed lookup is not available right now.', 'bad'); return; }

    status('Looking it up…');
    renderResults('');
    try {
      const sets = await s.loadSets('en');
      const hits = s.matchingSets(sets || [], query);
      if (!hits.length) { status(`No set matching "${query}".`, 'bad'); return; }

      const set = hits[0];
      status(`Looking up ${set.name}…`);
      const products = await s.catalogForSet(set);
      if (!products || !products.length) {
        status(`No sealed product catalogued for ${set.name}. Older sets and Japanese sets often are not.`, 'bad');
        return;
      }

      const prices = await s.pricesFor(products.map((p) => p.productId));

      // Priced first: an unpriced row is usually something that was never
      // made, and it has no business above a real box.
      const ordered = products.slice().sort((a, b) => {
        const pa = prices[a.productId] && prices[a.productId].price;
        const pb = prices[b.productId] && prices[b.productId].price;
        if (typeof pa === 'number' && typeof pb !== 'number') return -1;
        if (typeof pb === 'number' && typeof pa !== 'number') return 1;
        if (typeof pa === 'number' && typeof pb === 'number') return pb - pa;
        return String(a.name).localeCompare(String(b.name));
      });

      status(`${set.name}${hits.length > 1 ? ` — closest of ${hits.length} matching sets` : ''}`);
      renderResults(ordered.map((p) => sealedRowHtml(p, prices[p.productId], set.name)).join(''));
    } catch (err) {
      status('That did not go through — try again in a moment.', 'bad');
    }
  }

  async function submit(raw) {
    const q = String(raw || '').trim();
    if (!q || busy) return;
    busy = true;
    try {
      if (mode === 'sealed') await runSealedLookup(q);
      else await runCardLookup(q);
    } finally {
      busy = false;
    }
  }

  /* ---- Wiring -------------------------------------------------------- */

  function focusBox(select) {
    const input = document.getElementById('lookup-input');
    if (!input) return;
    input.focus({ preventScroll: true });
    // Selecting rather than clearing: the previous number is still there
    // to glance at, and the first keystroke replaces it.
    if (select) input.select();
  }

  function wire() {
    const form = document.getElementById('lookup-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submit(form.elements.q.value);
      });
    }

    /* One camera at a time. openCardCamera() awaits getUserMedia BEFORE it
       puts its overlay up, and the very first scan on a phone shows a
       permission prompt in that gap -- during which this button is still
       live. Two taps opened two cameras and left one overlay stranded with
       its track still running. */
    let scanning = false;
    document.getElementById('lookup-scan')?.addEventListener('click', async () => {
      if (scanning) return;
      scanning = true;
      try { await doScan(); } finally { scanning = false; }
    });

    async function doScan() {
      const c = col();
      /* scanCardSmart recognises the whole card and keeps the old OCR as
         its own fallback. scanCardNumber is still here for a browser
         running a cached older collection.js. */
      const scan = (c && (c.scanCardSmart || c.scanCardNumber));
      if (!scan) { status('The scanner is not available right now.', 'bad'); return; }
      /* SEALED PRODUCT IS A BARCODE, NOT WORDS.
         A Pokemon Center ETB and a regular one read almost identically and
         are different products at different prices. Their barcodes differ,
         and so do a reprint's, a Japanese box's, and a bundle's. Reading
         the set name off the box could never tell those apart. */
      if (mode === 'sealed') { await scanSealedBarcode(); return; }

      status('📷 Reading the card…');
      const res = await scan.call(c, mode);

      if (res.status === 'cancelled') { status(''); return; }
      if (res.status === 'unavailable') { status('No camera available here — type the number instead.', 'bad'); focusBox(true); return; }


      /* It could not read the number but it read the card's name. Show
         what that name matches rather than calling the scan a failure. */
      if (res.status === 'name' && res.name) {
        const box = document.getElementById('lookup-input');
        if (box) box.value = res.name;
        await runNameLookup(res.name);
        return;
      }

      if (res.status === 'unread' || res.status === 'error') {
        status('Could not read that card. Fill the outline, hold it straight on, light on the bottom corner — or just type the number.', 'bad');
        focusBox(true);
        return;
      }

      // It read a number. From here it is the typed path exactly.
      const input = document.getElementById('lookup-input');
      if (input) input.value = res.number;
      submit(res.number);
    }

    /* Delegated, because the results area is rewritten on every search
       and on every back. */
    document.getElementById('lookup-results')?.addEventListener('click', (e) => {
      const back = e.target.closest('[data-back]');
      if (back) {
        picked = null;
        status(`${lastResults.length} match${lastResults.length === 1 ? '' : 'es'}`);
        renderResults(lastResults.map(cardRowHtml).join(''));
        return;
      }
      const add = e.target.closest('[data-add]');
      if (add) { quickAdd(add); return; }

      const g = e.target.closest('[data-grade]');
      if (g) {
        const next = GRADES.find((x) => x.key === g.dataset.grade);
        if (next && next.key !== grade.key && picked) {
          grade = next;
          openCard(picked.id);
        }
        return;
      }

      const stockBtn = e.target.closest('[data-stock-sealed]');
      if (stockBtn) { stockSealed(stockBtn.dataset.stockSealed); return; }

      const saveSealedBtn = e.target.closest('[data-save-sealed]');
      if (saveSealedBtn) { saveSealed(saveSealedBtn.dataset.saveSealed); return; }

      const editSealedBtn = e.target.closest('[data-edit-sealed]');
      if (editSealedBtn) {
        const code = editSealedBtn.dataset.editSealed;
        const client = sb();
        if (client) {
          client.from('sealed_barcodes').select('*').eq('barcode', code).maybeSingle()
            .then(({ data }) => { renderResults(newSealedHtml(code, data || {})); wireSealedForm(); })
            .catch(() => { renderResults(newSealedHtml(code)); wireSealedForm(); });
        }
        return;
      }

      const pick = e.target.closest('[data-pick]');
      if (pick && pick.dataset.pick) openCard(pick.dataset.pick);
    });

    root().querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === mode) return;
        mode = btn.dataset.mode;
        saveMode(mode);
        render();
        focusBox(true);
      });
    });
  }

  /* One tap, no questions. Printing, condition and quantity all take the
     defaults a dealer would take anyway -- and all three are editable in
     My Collection, which is where somebody who cares about the difference
     is going to be sitting. The button says what it did rather than
     popping a dialog to be dismissed. */
  async function quickAdd(btn) {
    const c = col();
    if (!c || !c.quickAdd || !picked || btn.disabled) return;
    // Captured now: he may well have moved on by the time the save lands.
    const addedId = picked.id;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Adding…';

    const res = await c.quickAdd(picked);
    if (!res.ok) {
      btn.textContent = res.reason === 'signed-out' ? 'Sign in to add' : 'Could not add';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 2200);
      return;
    }

    const label = (c.VARIANT_LABELS && c.VARIANT_LABELS[res.variant]) || res.variant;
    btn.classList.add('is-added');
    btn.textContent = res.bumped ? `✓ You now have ${res.quantity}` : `✓ Added · ${label}`;
    // The strip below just changed, so it is redrawn rather than left
    // showing a collection that is one card out of date -- with the new
    // card first, and lit up, so the tap has somewhere visible to land.
    showMyCollection(addedId);
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove('is-added');
      btn.textContent = original;
    }, 2600);
  }

  function render() {
    const el = root();
    if (!el) return;
    el.innerHTML = shellHtml();
    wire();
  }

  async function init() {
    const el = root();
    if (!el) return;

    const client = sb();
    if (!client) { el.innerHTML = signedOutHtml(); return; }

    let user = null;
    try {
      const { data } = await client.auth.getSession();
      user = data && data.session && data.session.user;
    } catch (_) { /* signed out */ }
    if (!user) { el.innerHTML = signedOutHtml(); return; }

    mode = readMode();
    render();
    // The cursor is in the box before the phone has finished settling. On
    // this page that is the entire point.
    focusBox(false);
  }

  window.InfinitePullsCardLookup = { init };
})();
