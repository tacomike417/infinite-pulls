/* ===========================================================================
   THE FEED — Infinite Pulls

   STEP ONE. This is the look, running on Jeff's real cards. It reads
   `shop_available` (the same view the shop page reads) and nothing else. No
   new tables, no migration, nothing written back -- so it cannot break the
   live app no matter what happens in here.

   Still to come, deliberately not here yet:
     - personal photos per card  (needs a table)
     - the back of the card / CARD STORY  (needs a story field)
     - HYPE, comments and wishlist as real rows  (needs tables)
   HYPE and WISHLIST work in here, but they are kept on the phone only, the
   same way the portfolio's hearts are: a private mark that survives a reload
   and never pretends to be a number somebody counted.

   PAGINATION IS KEYSET, NOT OFFSET. `OFFSET 200` makes Postgres walk two
   hundred rows and throw them away, and this feed is built to be scrolled
   deep -- so each page asks for rows ORDER BY added_at DESC that come AFTER
   the last one we saw. Constant speed at any depth.
   =========================================================================== */
(function () {
  'use strict';

  /* THE BUILD STAMP. Bumped every time this file ships. It is drawn in the
     top bar so you can tell at a glance whether a hard refresh actually
     took -- an old number means the browser handed you a cached feed.js. */
  const BUILD = 'v4';

  const PAGE = 8;                     // posts per fetch
  const MARKS = 'ip-feed-marks';      // hype + wishlist, this device only

  const cfg = window.InfinitePullsConfig || {};
  let sb = null;
  try {
    if (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    }
  } catch (_) { sb = null; }

  /* WHO IS LOOKING. supabase-js keeps its session in localStorage under a key
     made from the project URL, and /feed-next/ is the same origin as the app,
     so a client built here picks up the signed-in session with no extra work.
     Nobody is asked to sign in twice. */
  let me = null;
  if (sb) sb.auth.getUser().then(r => { me = (r && r.data && r.data.user) ? r.data.user.id : null; })
                           .catch(() => { me = null; });

  const feed   = document.getElementById('feed');
  /* Problems get SAID, not swallowed. Visible to anyone with ?debug=1 on the
     URL, and always in the console, so "I only see the shop" never again
     means digging blind. */
  const DEBUG = /[?&]debug=1/.test(location.search);
  const notes = [];
  function note(msg) {
    if (notes.includes(msg)) return;
    notes.push(msg);
    try { console.warn('[feed] ' + msg); } catch (_) {}
    if (!DEBUG || !feed) return;
    let box = document.getElementById('feed-notes');
    if (!box) {
      box = document.createElement('div');
      box.id = 'feed-notes'; box.className = 'msg';
      box.style.cssText = 'text-align:left;border-bottom:1px solid var(--line)';
      feed.prepend(box);
    }
    box.insertAdjacentHTML('beforeend', '<div>&#9888; ' + msg.replace(/[<>&]/g, '') + '</div>');
  }
  const esc    = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
                 c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  /* CARDMARKET QUOTES IN EUROS AND TCGPLAYER IN DOLLARS, and the price
     history deliberately keeps them that way rather than converting -- a
     converted price makes the exchange rate part of the card's story, so a
     card that never moved appears to move because the euro did. That means
     the symbol has to follow the row it came from. */
  const SIGN = { USD: '$', EUR: '\u20ac', GBP: '\u00a3' };
  const money = (n, cur) => (n == null || isNaN(n))
    ? '' : (SIGN[cur || 'USD'] || '$') + Number(n).toFixed(2);

  /* ---- what a person marks, kept on their own device -------------------- */
  function marks() {
    try { return JSON.parse(localStorage.getItem(MARKS) || '{}') || {}; } catch (_) { return {}; }
  }
  function toggleMark(key, kind) {
    const m = marks(), id = kind + ':' + key;
    if (m[id]) delete m[id]; else m[id] = 1;
    try { localStorage.setItem(MARKS, JSON.stringify(m)); } catch (_) {}
    return !!m[id];
  }
  const marked = (key, kind) => !!marks()[kind + ':' + key];

  /* ---- icons ------------------------------------------------------------ */
  const I = {
    search:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    bell:'<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 1 0-12 0c0 7-2 8-2 8h16s-2-1-2-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    bolt:'<svg viewBox="0 0 24 24"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z"/></svg>',
    chat:'<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>',
    share:'<svg viewBox="0 0 24 24"><path d="M4 15v-2a8 8 0 0 1 8-8h5"/><path d="M14 2l4 3-4 3"/><path d="M4 15l4 4"/></svg>',
    mark:'<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    card:'<svg viewBox="0 0 24 24"><rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M8 7h8M8 11h5"/></svg>',
    chev:'<svg viewBox="0 0 24 24" class="chev"><path d="M6 15l6-6 6 6"/></svg>',
    chevR:'<svg viewBox="0 0 24 24" class="chev"><path d="M9 6l6 6-6 6"/></svg>',
    look:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    bars:'<svg viewBox="0 0 24 24"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
    doc:'<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
    people:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17.5" cy="9" r="2.6"/><path d="M17 15.5a5 5 0 0 1 4 4.5"/></svg>',
    arrowL:'<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    arrowR:'<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    home:'<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7"/><path d="M6.5 10v10h11V10"/></svg>',
    shop:'<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>',
    plus:'<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    stack:'<svg viewBox="0 0 24 24"><rect x="4" y="3" width="11" height="15" rx="2"/><path d="M8 21h9a2 2 0 0 0 2-2V8"/></svg>',
    menu:'<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    flip:'<svg viewBox="0 0 24 24"><path d="M4 9a8 8 0 0 1 13-3l3 3"/><path d="M20 4v5h-5"/><path d="M20 15a8 8 0 0 1-13 3l-3-3"/><path d="M4 20v-5h5"/></svg>',
    cal:'<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>',
    coin:'<svg viewBox="0 0 24 24"><ellipse cx="12" cy="7" rx="7.5" ry="3.2"/><path d="M4.5 7v10c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2V7"/><path d="M4.5 12c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2"/></svg>',
    trend:'<svg viewBox="0 0 24 24"><path d="M4 17l6-6 4 4 6-7"/><path d="M15 8h5v5"/></svg>',
    quill:'<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>'
  };

  /* THE PICTURE, IN ORDER OF PREFERENCE.
       1. the photograph somebody actually took of THIS copy
       2. the catalogue art from the API
       3. the placeholder, for a card the API has no art for
     An `art_url` that 404s falls through to the placeholder too -- a broken
     image icon in a feed reads as the whole app being broken. */
  const NO_PHOTO = '../assets/feed/no-photo.webp';

  /* THE SHOT ORDER: the photo they took, then the catalog art, then the
     card that says nobody has photographed this one. photo_key is a key
     inside the bucket, not an address -- the address is built here, so the
     photos can move without touching a single saved row. */
  const PHOTO_BASE = String(cfg.CARD_PHOTO_BASE || '').replace(/\/+$/, '');
  const photoUrl = (key) => {
    if (!key) return '';
    if (/^https?:\/\//i.test(key)) return key;
    if (!PHOTO_BASE) return '';
    return PHOTO_BASE + '/p/' + key.split('/').map(encodeURIComponent).join('/');
  };
  const shotsFor = (r) => {
    const mine = photoUrl(r.photo_key);
    if (mine) return [mine];
    return r.image_url ? [r.image_url] : [NO_PHOTO];
  };
  const fallback = `onerror="this.onerror=null;this.src='${NO_PHOTO}';this.closest('.frame')?.setAttribute('data-shape','portrait')"`;

  /* ---- turning a shop row into a post ----------------------------------- */
  function toPost(r) {
    /* Two pictures exist today: the photograph Jeff took, and the catalogue
       art. His own comes first, because the whole idea is that the feed is
       real cards somebody actually holds. */
    const pics = [r.photo_url, r.art_url].filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);
    if (!pics.length) pics.push(NO_PHOTO);
    return {
      kind:  'shop',
      who:   'Infinite Pulls',
      avatar:'',
      cond:  'RAW',
      qty:   1,
      key:   String(r.clover_item_id || r.card_id || r.name),
      cardId: r.card_id || '',
      name:  r.name || 'Card',
      set:   r.set_name || '',
      num:   r.card_number || '',
      price: typeof r.price === 'number' ? r.price : null,
      when:  r.added_at || null,
      pics:  pics.length ? pics : [],
      shape: 'portrait'
    };
  }

  /* ---- one post --------------------------------------------------------- */
  function postHTML(p, i) {
    const hyped = marked(p.key, 'hype');
    const saved = marked(p.key, 'save');
    const n = 37 + (i % 9) * 3;       /* until HYPE is a real table */
    const sub = [p.set, p.num && '#' + p.num].filter(Boolean).join(' · ');

    return `
    <article class="post" data-key="${esc(p.key)}" data-when="${esc(p.when || '')}" data-price="${esc(p.price == null ? '' : p.price)}"
             data-row="${esc(p.rowId || '')}" data-owner="${esc(p.userId || '')}" data-note="${esc(p.note || '')}"
             data-name="${esc(p.name || '')}" data-num="${esc(p.num || '')}">
      <header class="post-top">
        <img class="avatar" src="${esc(p.avatar || '../assets/hyde-bot.png')}" alt=""
             onerror="this.onerror=null;this.src='../assets/hyde-bot.png'">
        <div class="who"><b>${esc(p.who || 'A collector')}</b><small>${esc(sub || (p.kind === 'shop' ? 'At the shop' : 'In their collection'))}</small></div>
        <div class="badges"><span>&#9889;</span><span>&#9733;</span></div>
        <button class="follow on" type="button">FOLLOWING</button>
        <span class="dots">&#8943;</span>
      </header>

      <div class="frame" data-shape="${esc(p.shape)}" data-card="${esc(p.cardId || '')}">
        <div class="flip">
          <div class="side front">
            ${p.pics.length > 1 ? `<span class="count">1 / ${p.pics.length}</span>` : ''}
            <div class="rail">
              ${p.pics.map(u => `<figure><img src="${esc(u)}" alt="${esc(p.name)}" loading="lazy" decoding="async" ${fallback}></figure>`).join('')}
            </div>
            ${p.pics.length > 1 ? `
              <div class="hint">${I.arrowL}<span>SWIPE FOR PHOTOS</span>${I.arrowR}</div>
              <div class="pips">${p.pics.map((_, k) => `<i class="${k ? '' : 'on'}"></i>`).join('')}</div>` : ''}
          </div>
          <div class="side rear" data-rear><!-- filled the first time it is turned over --></div>
        </div>
        <button class="turn" type="button" data-turn>${I.flip}<span data-turn-label>CARD STORY</span></button>
      </div>

      <div class="acts">
        <button class="act hype${hyped ? ' on' : ''}" data-hype aria-pressed="${hyped}">
          <span class="ring">${I.bolt}</span>
          <span><span class="lbl">HYPE</span><span class="n">${n + (hyped ? 1 : 0)}</span></span>
        </button>
        <button class="act" data-comment>${I.chat}<span>COMMENT</span></button>
        <button class="act" data-share>${I.share}<span>SHARE</span></button>
        <button class="act${saved ? ' on' : ''}" data-save aria-pressed="${saved}">${I.mark}<span>WISHLIST</span></button>
      </div>

      <p class="caption"><b>${esc(p.who || 'A collector')}</b> ${esc(p.name)}${p.set ? ' — ' + esc(p.set) : ''}</p>

      <section class="snap">
        <button class="snap-head" type="button" data-snap>
          <span class="ic">${I.card}</span><b>CARD SNAPSHOT</b>${I.chev}
        </button>
        <div class="snap-body">
          <span class="state">${p.kind === 'shop' ? 'AT THE SHOP' : 'IN A COLLECTION'}</span><span class="sep">•</span>
          <span class="cond">${esc((p.cond || 'RAW').toUpperCase())}</span>
          ${p.qty > 1 ? `<span class="sep">•</span><span class="cond">&times;${p.qty}</span>` : ''}
          ${p.price != null ? `<span class="sep">•</span><span class="price">${esc(money(p.price))}</span>` : ''}
        </div>
      </section>

      <div class="pills">
        <button class="pill" type="button" data-go="look">${I.look}<span>LOOK UP</span></button>
        <button class="pill" type="button" data-go="sold">${I.bars}<span>SOLD LISTINGS</span></button>
        <button class="pill" type="button" data-go="details">${I.doc}<span>CARD DETAILS</span></button>
      </div>

      <button class="nearby" type="button">${I.people}<span>${p.kind === 'shop' ? 'See this one at the shop' : 'Look this one up'}</span>${I.chevR}</button>
    </article>`;
  }

  /* ---- Jeff's welcome post -----------------------------------------------
     Shown to EVERYONE, at the top, every time. It is not a database row --
     it is one constant, so it can never be missing, never be slow, and never
     need a query. When user cards arrive it gains the rule agreed earlier:
     it retires itself once somebody has added their first card. */
  function tutorialHTML() {
    return `
    <article class="post tutorial">
      <header class="post-top">
        <img class="avatar" src="../assets/hyde-bot.png" alt=""
             onerror="this.onerror=null;this.style.visibility='hidden'">
        <div class="who"><b>Infinite Pulls</b><small>Start here</small></div>
        <span class="pin">PINNED</span>
      </header>
      <div class="frame" data-shape="auto">
        <div class="rail">
          <figure><img src="../assets/feed/jeff-welcome.webp"
            alt="Welcome to Infinite Pulls. Tap the plus below to scan your first card."
            decoding="async"></figure>
        </div>
      </div>
    </article>`;
  }

  /* ---- the back of the card ---------------------------------------------
     Built the first time somebody turns a post over, not up front: most
     posts are scrolled past, and a price-history query per post on load
     would be dozens of requests nobody asked for. */
  const day = (d) => {
    if (!d) return '';
    const t = new Date(d);
    if (isNaN(t)) return '';
    return t.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
  };

  async function priceHistory(cardId) {
    /* card_price_history has a policy for `authenticated` and none for `anon`,
       so a signed-out reader gets nothing here. That is not an error -- the
       back simply shows what it can and says nothing it cannot prove. */
    if (!sb || !cardId) return [];
    try {
      const { data, error } = await sb.from('card_price_history')
        .select('recorded_on, price, variant, source, currency')
        .eq('card_id', cardId).eq('variant', 'market')
        .order('recorded_on', { ascending: true }).limit(200);
      if (error || !Array.isArray(data)) return [];
      return data;
    } catch (_) { return []; }
  }

  /* WHAT IT WAS WORTH THE DAY THEY ADDED IT.
     One market at a time -- TCGplayer against TCGplayer, Cardmarket against
     Cardmarket. The reading used is the last one taken on or before the day
     the card went in. If the price history does not reach back that far, the
     earliest reading there is gets used INSTEAD OF NOTHING, and its own date
     is shown beside it, because calling a later reading "the price when
     added" would be a quiet little lie. */
  function atAdd(hist, source, when) {
    const rows = hist.filter(r => (r.source || 'tcgplayer') === source);
    if (!rows.length) return null;
    const day0 = when ? String(when).slice(0, 10) : null;
    let pick = null;
    if (day0) for (const r of rows) { if (String(r.recorded_on).slice(0, 10) <= day0) pick = r; }
    const row = pick || rows[0];
    return {
      price: Number(row.price),
      currency: row.currency || (source === 'cardmarket' ? 'EUR' : 'USD'),
      on: row.recorded_on,
      exact: !!pick
    };
  }

  const MARKETS = [['tcgplayer', 'TCGPLAYER'], ['cardmarket', 'CARDMARKET']];

  function rearHTML(p, hist) {
    /* BOTH NUMBERS COME FROM THE SAME PLACE, or the comparison is a lie.
       card_price_history is market value; a shop row's `price` is what Jeff
       is ASKING for it. Putting one against the other made a card look like
       it fell from $141 to $7 when nothing had happened to it at all.
       So: if there is history, the pair is history's first and last. The
       listing price is only used when there is no history to compare with,
       and then there is nothing to compare it to anyway. */
    /* WHOSE CARD IS THIS. Only the shop has a shop price -- it is what Jeff
       is ASKING for the card. A card in somebody's collection is not for
       sale, so "price at the shop" was never true on one, and it was showing
       there with nothing behind it. What belongs on a collection card is
       what it was worth the day they got it. */
    const isShop = p.kind === 'shop';

    /* the shop compares one series against itself, TCGplayer only -- that is
       the market the shop prices against */
    const shopSeries = hist.filter(r => (r.source || 'tcgplayer') === 'tcgplayer');
    const first = shopSeries.length ? Number(shopSeries[0].price) : null;
    const last  = shopSeries.length ? Number(shopSeries[shopSeries.length - 1].price) : null;
    const now   = shopSeries.length ? last : (p.price != null ? p.price : null);
    const moved = (first != null && last != null) ? last - first : null;
    const dir   = moved == null ? '' : (moved > 0.005 ? 'up' : (moved < -0.005 ? 'down' : ''));

    const events = [];
    if (p.when) events.push(['ADDED', day(p.when), isShop ? 'Listed at the shop' : 'Added to the collection']);
    if (isShop && shopSeries.length > 1) {
      const l = shopSeries[shopSeries.length - 1];
      events.push(['VALUE', day(l.recorded_on),
        `${money(first)} \u2192 ${money(Number(l.price))}`]);
    }

    /* what the two markets said the day it went in */
    const added = isShop ? [] : MARKETS
      .map(([key, label]) => [label, atAdd(hist, key, p.when)])
      .filter(([, v]) => v && !isNaN(v.price));

    const lookQ = encodeURIComponent(p.num || p.name || '');

    return `
      <span class="eyebrow">THIS IS THE BACK OF YOUR CARD</span>
      <div class="backface">
        <img src="../assets/logo-sm.webp" alt=""
             onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('span'),{textContent:'INFINITE PULLS'}))">
      </div>
      <div class="facts">
        <div class="fact">${I.cal}<span><span class="k">ADDED</span>
          <span class="v">${esc(day(p.when) || 'not recorded')}</span></span></div>
        ${isShop ? `
          ${first != null ? `<div class="fact">${I.coin}<span><span class="k">ORIGINAL VALUE</span>
            <span class="v">${esc(money(first))}</span></span></div>` : ''}
          <div class="fact">${I.trend}<span><span class="k">${shopSeries.length ? 'CURRENT VALUE' : 'PRICE AT THE SHOP'}</span>
            <span class="v ${dir}">${esc(money(now) || '—')}</span></span></div>
        ` : `
          <div class="fact wide">${I.coin}<span><span class="k">PRICE WHEN ADDED</span>
            ${added.length ? added.map(([label, v]) => `
              <span class="mkt"><span class="m">${label}</span>
                <span class="v">${esc(money(v.price, v.currency))}</span>
                ${v.exact ? '' : `<span class="asof">as of ${esc(day(v.on))}</span>`}</span>`).join('')
              : `<span class="v">—</span>
                 <span class="asof">no price was recorded back then</span>`}
          </span></div>
          <a class="btn-look" href="../?page=lookup${lookQ ? '&q=' + lookQ : ''}">${I.look}LOOK UP NOW</a>
        `}
      </div>
      ${p.kind === 'card' ? `
      <section class="story" data-story-panel>
        <span class="k">${I.quill}MY HISTORY</span>
        ${p.note
          ? `<p data-story-text>${esc(p.note)}</p>`
          : `<p class="empty" data-story-text>${p.mine
              ? 'Where did this one come from? Write it down before you forget.'
              : 'No story on this one yet.'}</p>`}
        ${p.mine ? `<button class="btn-edit" type="button" data-story-edit>EDIT STORY</button>` : ''}
      </section>` : ''}
      ${events.length ? `<ul class="tline">${events.map(([k, d, t]) => `
          <li><span class="d">${esc(d)}</span><span class="t">${esc(k === 'ADDED' ? 'Added' : 'Value updated')}</span>
          <span class="s">${t}</span></li>`).join('')}</ul>`
        : `<p class="tline quiet">Its history starts filling in from here.</p>`}`;
  }

  /* Put the panel back the way it was -- used by both Cancel and a good save,
     so there is always a way out of the editor. */
  function redrawStory(post, saved) {
    const panel = post.querySelector('[data-story-panel]');
    if (!panel) return;
    const note = post.getAttribute('data-note') || '';
    panel.innerHTML = `
      <span class="k">${I.quill}MY HISTORY</span>
      ${note ? `<p>${esc(note)}</p>`
             : `<p class="empty">Where did this one come from? Write it down before you forget.</p>`}
      <button class="btn-edit" type="button" data-story-edit>EDIT STORY</button>
      ${saved ? `<span class="said-ok">Saved</span>` : ''}`;
    if (saved) setTimeout(() => { const s = panel.querySelector('.said-ok'); if (s) s.remove(); }, 2200);
  }

  /* ---- the sideways swipe ----------------------------------------------- */
  /* Thunkagram's job, done with the browser's own scroll snapping: no drag
     maths, no library, and it keeps momentum and accessibility for free. */
  function wireRail(frame) {
    const rail = frame.querySelector('.rail');
    const pips = [...frame.querySelectorAll('.pips i')];
    const count = frame.querySelector('.count');
    if (!rail || !pips.length) return;
    let tick;
    rail.addEventListener('scroll', () => {
      frame.classList.add('moved');
      clearTimeout(tick);
      tick = setTimeout(() => {
        const at = Math.round(rail.scrollLeft / rail.clientWidth);
        pips.forEach((p, k) => p.classList.toggle('on', k === at));
        if (count) count.textContent = `${at + 1} / ${pips.length}`;
      }, 60);
    }, { passive: true });
  }

  /* ---- reading the feed --------------------------------------------------

     TWO SOURCES, IN ORDER. Everyone's own cards first -- that is the whole
     idea, the collection IS the content -- and when those run out the shop's
     shelf carries on, so the feed never dead-ends into an empty screen.

     NO MIGRATION WAS NEEDED. user_cards already carries a policy letting
     anon and authenticated read the cards of any profile with is_public
     true, and is_public defaults to true. That same flag is the per-person
     way out of the feed, and it already exists.

     THE JOIN IS DONE IN TWO QUERIES, ON PURPOSE. user_cards.user_id points
     at auth.users, not at profiles, so PostgREST has no foreign key to embed
     across and `profiles(username)` would simply fail. Asking for the cards
     and then asking for the handful of profiles behind them is two small
     round trips instead of one that does not work.

     PAGINATION IS KEYSET. `OFFSET 200` makes Postgres walk two hundred rows
     and throw them away; this feed is built to be scrolled deep.

     NOTHING FETCHED IS DISCARDED. Rows that survive the filter but do not
     fit this screenful wait in a buffer for the next one -- an earlier
     version dropped them and then claimed the feed had ended. */
  const SOURCES = ['cards', 'shop'];
  let srcAt = 0, cursor = null, drained = false, busy = false, buffer = [];

  /* THE ROSTER. Who is in the feed is decided before any card is asked for.
     The old way asked for the newest rows in the whole table and then tried
     to share them out, which cannot work: if one person added a shelf in one
     sitting, every row in the window belongs to them and there is nobody to
     share with. So the accounts come first, shuffled, and cards are asked for
     a few accounts at a time. A different shuffle every visit means the feed
     is not the same order twice.

     SCALING NOTE: this reads up to ROSTER_MAX public profiles in one small
     query. That is right for now. Past a few thousand accounts it wants to
     become a server-side random sample instead of the whole list. */
  const ROSTER_MAX  = 200;   // accounts we know about in one sitting
  const SLICE       = 6;     // accounts asked for cards at a time
  const PER_ACCOUNT = 4;     // cards asked of each of them
  const MAX_PER_PAGE = 2;    // posts any one account may have per screenful

  /* ---- WHAT THE FEED IS NARROWED TO -------------------------------------
     null is the whole feed. A person filter swaps the roster for a list of
     one, which is nearly free because the feed already fetches per account.
     A card filter is a different shape -- one query across everybody -- and
     it still feeds the same round-robin queues, so five people who each own
     a Charizard come back interleaved rather than in a block. */
  let filter = null;   /* null | {kind:'person', id, label} | {kind:'card', name} */

  let roster = null;            /* [user_id, ...] shuffled */
  let rosterAt = 0;
  const spent = new Set();      /* accounts with no more cards to give */
  const cursors = new Map();    /* user_id -> oldest added_at we have seen */

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ROUND-ROBIN BY PERSON, NOT BY TIME.
     Straight newest-first means whoever added the most cards last owns the
     feed. That is Jeff with a shelf of inventory today, and it is equally
     any collector who imports their binder on a Sunday night -- who would
     be doing nothing wrong. So cards wait in a queue per account and the
     feed takes one from each in turn. Everybody is seen before anybody is
     seen twice, there is no ratio to tune, and somebody with two hundred
     cards simply keeps their turn for longer rather than taking everyone
     else's. */
  const queues = new Map();     /* user_id -> [post, post, ...] */
  let spin = 0;                 /* rotates the starting seat each round */
  let lastWho = null;           /* nobody twice in a row if anyone is waiting */

  const queued = () => { let n = 0; queues.forEach(q => { n += q.length; }); return n; };

  function enqueue(post) {
    const k = post.userId || post.who;
    if (!queues.has(k)) queues.set(k, []);
    queues.get(k).push(post);
  }

  function takeRound(n) {
    const out = [];
    const tally = new Map();          /* how many this screenful has taken */
    const capped = (k) => (tally.get(k) || 0) >= MAX_PER_PAGE;
    while (out.length < n) {
      /* anybody with cards waiting who has not already had their two */
      let keys = [...queues.keys()].filter(k => queues.get(k).length && !capped(k));
      /* only if EVERYBODY is capped do we lift the cap -- an empty screenful
         is worse than a repeat */
      if (!keys.length) {
        keys = [...queues.keys()].filter(k => queues.get(k).length);
        if (!keys.length) break;
        tally.clear();
      }
      /* a fresh shuffle each round, not a fixed rotation: strict turn order
         is still an order, and it shows */
      const order = shuffle(keys.slice());
      spin++;
      let tookAny = false;
      for (const k of order) {
        if (out.length >= n) break;
        const q = queues.get(k);
        if (!q.length || capped(k)) continue;
        /* only refuse a repeat while somebody else actually has one waiting */
        if (k === lastWho && order.length > 1 && out.length) continue;
        out.push(q.shift());
        tally.set(k, (tally.get(k) || 0) + 1);
        lastWho = k;
        tookAny = true;
      }
      if (!tookAny) break;
    }
    queues.forEach((q, k) => { if (!q.length) queues.delete(k); });
    return out;
  }
  /* The sentinel the scroll watcher looks for has to stay LAST. Appending
     each new batch to the end of the feed left it stranded in the middle,
     permanently on screen, firing loadMore on every single scroll event --
     it happened to keep working, which is the worst kind of broken. */
  let sentinel = null;
  const faces = {};                    /* user_id -> { name, avatar } */

  const usableShop = (r) =>
    typeof r.price === 'number' && (r.available || 0) > 0 && !r.hidden_online;

  /* Read the roster once. Names and avatars come back with it, so the
     separate profiles lookup is no longer needed for these accounts. */
  /* A card filter reaches accounts the roster slice may not have touched, so
     the names have to be fetched for whoever turns up. */
  async function facesFor(ids) {
    const want = ids.filter(id => id && !(id in faces));
    if (!want.length || !sb) return;
    try {
      const { data } = await sb.from('profiles')
        .select('id, username, avatar_url').in('id', want);
      (data || []).forEach(p => { faces[p.id] = { name: p.username, avatar: p.avatar_url }; });
    } catch (_) { /* a missing name is not worth failing a search over */ }
    want.forEach(id => { if (!(id in faces)) faces[id] = null; });
  }

  async function loadRoster() {
    if (roster) return;
    roster = [];
    try {
      const { data, error } = await sb.from('profiles')
        .select('id, username, avatar_url, is_public')
        .eq('is_public', true).limit(ROSTER_MAX);
      if (error) { note('Could not read the roster: ' + (error.message || error.code || 'unknown')); return; }
      (data || []).forEach(p => {
        faces[p.id] = { name: p.username, avatar: p.avatar_url };
        roster.push(p.id);
      });
      shuffle(roster);
      if (!roster.length) note('No public profiles came back — nobody to show.');
    } catch (e) { note('Could not read the roster: ' + (e && e.message || 'unknown')); }
  }

  /* The next few accounts still holding cards. Wraps, skipping the spent. */
  /* the roster this pass is allowed to draw from */
  const view = () => (filter && filter.kind === 'person') ? [filter.id] : roster;

  function nextSlice(n) {
    const out = [];
    const list = view();
    if (!list.length) return out;
    let looked = 0;
    while (out.length < n && looked < list.length) {
      const id = list[rosterAt % list.length];
      rosterAt++; looked++;
      if (!spent.has(id)) out.push(id);
    }
    return out;
  }

  /* ---- narrowing, and the way back out ----------------------------------
     Everything the feed has fetched belongs to the old view, so it all goes:
     the queues, the per-account cursors, who is spent, the buffer, the
     source we were on, and the posts on screen. Leaving any of it behind is
     how you end up with somebody else's card inside a filter. */
  function resetFeed() {
    queues.clear(); spent.clear(); cursors.clear();
    buffer = []; srcAt = 0; cursor = null; drained = false;
    rosterAt = 0; spin = 0; lastWho = null; sentinel = null;
    feed.innerHTML = '';
  }

  function chipHTML() {
    if (!filter) return '';
    const what = filter.kind === 'person'
      ? `<b>${esc(filter.label)}</b>&rsquo;s cards`
      : `Everyone with <b>${esc(filter.label)}</b>`;
    return `<span class="chip">${what}
      <button class="x" type="button" data-chip-clear aria-label="Show the whole feed again">&times;</button></span>`;
  }

  async function setFilter(next) {
    filter = next;
    const bar = document.getElementById('chipbar');
    if (bar) { bar.innerHTML = chipHTML(); bar.hidden = !filter; }
    resetFeed();
    await startFeed();
  }

  const cardRow = (r) => {
    const who = faces[r.user_id];
    return {
      kind: 'card',
      key: 'u' + r.id,
      rowId: r.id,
      userId: r.user_id,
      note: r.note || '',
      who: (who && who.name) || 'A collector',
      avatar: (who && who.avatar) || '',
      name: r.card_name || 'Card',
      set: r.set_name || '',
      num: '',
      cardId: r.card_id || '',
      cond: r.condition || '',
      qty: r.quantity || 1,
      price: null,
      when: r.added_at,
      pics: shotsFor(r),
      shape: 'portrait'
    };
  };

  /* One account, its own keyset cursor. Small and fast; the slice of them
     goes out together so six accounts cost one round trip of waiting, not
     six. */
  /* COLUMNS THAT MAY NOT BE THERE YET. Asking for a column the database does
     not have fails the WHOLE query, so a feed that selects `photo_key` against
     a database that has not had the migration run shows nothing at all and
     blames the permissions. The app's importer already solves this by asking
     again without the new columns, and this does the same: try the full list
     once, and if the answer is "no such column", drop back and remember. */
  const NEW_COLS = ['photo_key'];
  let columns = null;
  const colList = (extra) =>
    'id, user_id, card_id, card_name, set_name, image_url, variant, condition, quantity, added_at, note'
    + (extra.length ? ', ' + extra.join(', ') : '');
  const missingColumn = (e) =>
    !!e && (e.code === '42703' || /column .* does not exist|could not find the .* column/i.test(e.message || ''));

  async function askFor(id, extra) {
    let q = sb.from('user_cards')
      .select(colList(extra))
      .eq('user_id', id)
      .order('added_at', { ascending: false })
      .limit(PER_ACCOUNT);
    if (cursors.has(id)) q = q.lt('added_at', cursors.get(id));
    return q;
  }

  async function fetchForAccount(id) {
    if (!columns) columns = NEW_COLS.slice();
    let { data, error } = await askFor(id, columns);
    if (error && missingColumn(error) && columns.length) {
      note('This database has not had the card-photo migration run yet — showing catalog art.');
      columns = [];
      ({ data, error } = await askFor(id, columns));
    }
    /* SAY SO WHEN IT FAILS. An earlier version treated an error exactly like
       an empty shelf, so a broken permission looked identical to nobody
       having any cards. That cost real time. */
    if (error) { note('Could not read a collection: ' + (error.message || error.code || 'unknown')); spent.add(id); return; }
    const rows = data || [];
    if (rows.length) cursors.set(id, rows[rows.length - 1].added_at);
    if (rows.length < PER_ACCOUNT) spent.add(id);
    rows.forEach(r => enqueue(cardRow(r)));
  }

  /* ONE CARD, EVERYBODY WHO HAS IT. A different query shape from the rest of
     the feed -- across all accounts at once rather than a few at a time --
     but the rows still go through the same queues, so five owners come back
     interleaved instead of one person's five copies in a row. */
  async function fetchOneCard() {
    if (!columns) columns = NEW_COLS.slice();
    await loadRoster();
    if (!roster.length) { drained = true; return; }
    const run = async (extra) => {
      let q = sb.from('user_cards')
        .select(colList(extra))
        .in('user_id', roster)          /* same reason as the search: public shelves only */
        .ilike('card_name', '%' + filter.name + '%')
        .order('added_at', { ascending: false })
        .limit(PAGE * 3);
      if (cursor) q = q.lt('added_at', cursor);
      return q;
    };
    let { data, error } = await run(columns);
    if (error && missingColumn(error) && columns.length) {
      columns = []; ({ data, error } = await run(columns));
    }
    if (error) { note('Could not search collections: ' + (error.message || 'unknown')); drained = true; return; }
    const rows = data || [];
    if (rows.length) cursor = rows[rows.length - 1].added_at;
    if (rows.length < PAGE * 3) drained = true;
    await facesFor([...new Set(rows.map(r => r.user_id))]);
    rows.forEach(r => enqueue(cardRow(r)));
  }

  async function fetchCards() {
    if (filter && filter.kind === 'card') return fetchOneCard();
    await loadRoster();
    if (!view().length) { drained = true; return; }
    const slice = nextSlice(SLICE);
    if (!slice.length) { drained = true; if (!queued()) note('Nobody on the roster has any cards yet.'); return; }
    await Promise.all(slice.map(fetchForAccount));
    if (spent.size >= roster.length) drained = true;
  }

  async function fetchShop() {
    /* Somebody looking at one person's cards did not ask what is for sale. */
    if (filter && filter.kind === 'person') { drained = true; return; }
    let q = sb.from('shop_available')
      .select('clover_item_id, card_id, name, set_name, card_number, price, available, photo_url, art_url, added_at, hidden_online')
      .order('added_at', { ascending: false })
      .limit(PAGE * 3);
    if (filter && filter.kind === 'card') q = q.ilike('name', '%' + filter.name + '%');
    if (cursor) q = q.lt('added_at', cursor);
    const { data, error } = await q;
    if (error) { note('Could not read the shop: ' + (error.message || 'unknown')); drained = true; return; }
    if (!data) { drained = true; return; }
    if (data.length) cursor = data[data.length - 1].added_at;
    if (data.length < PAGE * 3) drained = true;
    buffer = buffer.concat(data.filter(usableShop).map(toPost));
  }

  async function fetchRows() {
    if (!sb) { drained = true; return; }
    if (SOURCES[srcAt] === 'cards') await fetchCards();
    else await fetchShop();
    /* one source running dry moves us to the next, it does not end the feed */
    if (drained && !queued() && srcAt < SOURCES.length - 1) {
      srcAt++; cursor = null; drained = false;
    }
  }

  async function fetchPage() {
    let guard = 0;
    /* keep asking while neither the queues nor the plain buffer can fill a
       screenful -- and, while still on people, keep asking a little longer if
       only ONE account has anything queued, because a second voice makes the
       round-robin worth doing at all */
    while (!finished() && guard++ < 12) {
      const enough = SOURCES[srcAt] === 'cards'
        ? (queued() >= PAGE && queues.size > 2) || (drained && queued())
        : buffer.length >= PAGE;
      if (enough) break;
      await fetchRows();
    }
    const fromPeople = takeRound(PAGE);
    if (fromPeople.length >= PAGE) return fromPeople;
    return fromPeople.concat(buffer.splice(0, PAGE - fromPeople.length));
  }

  const finished = () => drained && srcAt >= SOURCES.length - 1 && !queued();

  async function loadMore() {
    if (busy) return;
    if (finished() && !buffer.length && !queued()) { endOfFeed(); return; }
    busy = true;
    const rows = await fetchPage();
    const start = feed.querySelectorAll('.post:not(.tutorial)').length;
    if (rows.length) {
      const html = rows.map((r, k) => postHTML(r, start + k)).join('');
      if (sentinel) sentinel.insertAdjacentHTML('beforebegin', html);
      else feed.insertAdjacentHTML('beforeend', html);
      feed.querySelectorAll('.frame:not([data-wired])').forEach(f => {
        f.setAttribute('data-wired', '1'); wireRail(f);
      });
    }
    busy = false;
    if (finished() && !buffer.length && !queued()) endOfFeed();
  }

  function endOfFeed() {
    if (document.getElementById('feed-end')) return;
    const html = `<div class="end" id="feed-end">you're all caught up</div>`;
    if (sentinel) sentinel.insertAdjacentHTML('beforebegin', html);
    else feed.insertAdjacentHTML('beforeend', html);
  }

  /* ---- taps -------------------------------------------------------------- */
  document.addEventListener('click', (e) => {
    const post = e.target.closest('.post');
    const key = post && post.getAttribute('data-key');

    const hype = e.target.closest('[data-hype]');
    if (hype && key) {
      const on = toggleMark(key, 'hype');
      hype.classList.toggle('on', on);
      hype.setAttribute('aria-pressed', String(on));
      const n = hype.querySelector('.n');
      if (n) n.textContent = String(Number(n.textContent) + (on ? 1 : -1));
      return;
    }
    const save = e.target.closest('[data-save]');
    if (save && key) {
      const on = toggleMark(key, 'save');
      save.classList.toggle('on', on);
      save.setAttribute('aria-pressed', String(on));
      return;
    }
    const turn = e.target.closest('[data-turn]');
    if (turn && post) {
      const frame = post.querySelector('.frame');
      const rear  = frame.querySelector('[data-rear]');
      const label = turn.querySelector('[data-turn-label]');
      const showingBack = frame.classList.toggle('back');
      if (label) label.textContent = showingBack ? 'FLIP TO FRONT' : 'CARD STORY';
      if (showingBack && !rear.getAttribute('data-filled')) {
        rear.setAttribute('data-filled', '1');
        const cardId = frame.getAttribute('data-card');
        const owner = post.getAttribute('data-owner') || '';
        /* THE BACK IS BUILT FROM THE POST, NOT FROM THE ROW. The row is long
           gone by the time somebody turns a card over, so everything the back
           needs has to be on the element -- including the name and number,
           without which LOOK UP NOW landed on an empty search box. */
        const p = { when: post.getAttribute('data-when'),
                    price: Number(post.getAttribute('data-price')) || null,
                    kind: owner ? 'card' : 'shop',
                    note: post.getAttribute('data-note') || '',
                    name: post.getAttribute('data-name') || '',
                    num:  post.getAttribute('data-num') || '',
                    mine: !!(me && owner && me === owner) };
        rear.innerHTML = rearHTML(p, []);
        priceHistory(cardId).then(h => { if (h.length) rear.innerHTML = rearHTML(p, h); });
      }
      return;
    }

    const edit = e.target.closest('[data-story-edit]');
    if (edit && post) {
      const panel = edit.closest('[data-story-panel]');
      const now = post.getAttribute('data-note') || '';
      edit.remove();
      panel.insertAdjacentHTML('beforeend', `
        <textarea data-story-box maxlength="600"
          placeholder="Pulled this at the grand opening. Jeff handed me the pack."></textarea>
        <div class="story-btns">
          <button class="btn-cancel" type="button" data-story-cancel>CANCEL</button>
          <button class="btn-save" type="button" data-story-save>SAVE</button>
        </div>`);
      const box = panel.querySelector('[data-story-box]');
      box.value = now; box.focus();
      return;
    }

    const cancel = e.target.closest('[data-story-cancel]');
    if (cancel && post) { redrawStory(post); return; }

    const keep = e.target.closest('[data-story-save]');
    if (keep && post) {
      const panel = keep.closest('[data-story-panel]');
      const box = panel.querySelector('[data-story-box]');
      const text = (box.value || '').trim();
      const row = post.getAttribute('data-row');
      keep.disabled = true; keep.textContent = 'SAVING…';
      sb.from('user_cards').update({ note: text || null }).eq('id', row)
        .then(({ error }) => {
          if (error) {
            keep.disabled = false; keep.textContent = 'SAVE';
            panel.insertAdjacentHTML('beforeend',
              `<span class="said-no">Could not save: ${esc(error.message || 'unknown')}</span>`);
            return;
          }
          post.setAttribute('data-note', text);
          redrawStory(post, true);
        });
      return;
    }

    const snap = e.target.closest('[data-snap]');
    if (snap) { snap.closest('.snap').classList.toggle('shut'); return; }

    const share = e.target.closest('[data-share]');
    if (share && post) {
      const title = post.querySelector('.caption').textContent.trim();
      const url = location.href;
      if (navigator.share) { navigator.share({ title, url }).catch(() => {}); }
      else if (navigator.clipboard) { navigator.clipboard.writeText(url).catch(() => {}); }
      return;
    }
  });

  /* ---- go ---------------------------------------------------------------- */
  let io = null;

  async function startFeed() {
    /* The welcome card is a welcome, not a search result -- it has no place
       inside a filter. */
    feed.innerHTML = (filter ? '' : tutorialHTML()) +
      `<div class="skel"><div class="bar" style="width:55%"></div><div class="box"></div></div>`;
    await loadMore();
    const first = feed.querySelector('.skel');
    if (first) first.remove();
    if (!feed.querySelector('.post:not(.tutorial)')) {
      feed.insertAdjacentHTML('beforeend', filter
        ? `<div class="msg"><b>Nothing here</b>
             ${filter.kind === 'person'
               ? esc(filter.label) + ' has not added any cards yet.'
               : 'Nobody has added one of those yet.'}</div>`
        : `<div class="msg"><b>No cards yet</b>
             Scan your first one and it lands right here.</div>`);
      return;
    }
    /* keep loading as they approach the bottom. The old watcher is dropped
       first -- otherwise every filter change leaves one behind, still
       watching a sentinel that is no longer on the page. */
    if (io) io.disconnect();
    io = new IntersectionObserver((ents) => {
      if (ents.some(x => x.isIntersecting)) loadMore();
    }, { rootMargin: '900px' });
    sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    feed.appendChild(sentinel);
    io.observe(sentinel);
  }

  async function start() {
    if (!sb) {
      feed.innerHTML = `<div class="msg"><b>No connection to the shop</b>
        This page needs config.js and the Supabase library. Open it from the site,
        not from a file on your computer.</div>`;
      return;
    }
    await startFeed();
  }

  /* ======================================================================
     SEARCH

     Three questions asked at once: who is on here, who has this card, and
     what is at the shop. It searches what EXISTS on the app -- not the whole
     Pokemon catalogue, which already has its own front door on the lookup
     page. If a search finds nothing, the last thing on screen is that door
     rather than a dead end.

     The stories people write on the backs of their cards are searched too.
     That reads like a privacy question and is not one: the only rows anybody
     can read are those of a profile with is_public true, which is the same
     rule that governs the feed itself. Anyone who switches to private leaves
     search at the same moment they leave the feed.
     ====================================================================== */
  const searchEls = () => ({
    wrap: document.getElementById('searchwrap'),
    box:  document.getElementById('q'),
    out:  document.getElementById('results')
  });

  /* PostgREST's `or` filter is a little language of its own: commas separate
     the clauses and parentheses group them. A card called "Farfetch'd (Delta)"
     typed into it would not be an attack -- the rules still decide what can be
     read -- but it would be a broken query, so anything that is not part of a
     card's name comes out first. */
  const cleanQ = (v) => String(v || '').replace(/[^A-Za-z0-9 '&.\-]/g, ' ')
                                       .replace(/\s+/g, ' ').trim().slice(0, 48);

  async function searchAll(raw) {
    const q = cleanQ(raw);
    if (q.length < 2 || !sb) return null;
    const like = '%' + q + '%';

    /* SEARCH ONLY THE PEOPLE THE FEED CAN SEE.
       The database rule already refuses the cards of a private profile, and
       that rule is the real guarantee. But the feed does not lean on it --
       it asks for public profiles first and only ever fetches their rows --
       and search had been reaching into user_cards directly, which made it
       the one place in here where a single policy stood between a private
       shelf and a stranger. It now draws from the same roster. Cheap, and it
       means two things have to go wrong instead of one. */
    await loadRoster();
    if (!roster.length) return { q, people: [], cards: [], shop: [] };

    const people = sb.from('profiles')
      .select('id, username, avatar_url')
      .eq('is_public', true).ilike('username', like).limit(6);

    const shop = sb.from('shop_available')
      .select('clover_item_id, name, set_name, price, photo_url, art_url, available, hidden_online')
      .or(`name.ilike.${like},set_name.ilike.${like}`).limit(6);

    const askCards = (withNote) => sb.from('user_cards')
      .select('id, user_id, card_id, card_name, set_name, image_url, added_at'
              + (withNote ? ', note' : ''))
      .in('user_id', roster)
      .or(`card_name.ilike.${like},set_name.ilike.${like}`
          + (withNote ? `,note.ilike.${like}` : ''))
      .order('added_at', { ascending: false }).limit(40);

    let cards = await askCards(true);
    if (cards.error && missingColumn(cards.error)) cards = await askCards(false);

    const [p, sh] = await Promise.all([people, shop]);
    if (p.error)  note('Could not search people: ' + (p.error.message || 'unknown'));
    if (sh.error) note('Could not search the shop: ' + (sh.error.message || 'unknown'));
    if (cards.error) note('Could not search collections: ' + (cards.error.message || 'unknown'));

    /* FOUR ROWS SAYING THE SAME THING ARE NOT FOUR RESULTS. Somebody with
       four Charizards filled the whole list with one card. One row per person
       per card, with the count on it, and the copy carrying a story wins the
       row so the story is not the one that gets folded away. */
    const rows = cards.data || [];
    const byOne = new Map();
    rows.forEach(r => {
      const k = r.user_id + '|' + (r.card_name || '');
      const had = byOne.get(k);
      if (!had) { byOne.set(k, { ...r, copies: 1 }); return; }
      had.copies++;
      const hit = (v) => (v || '').toLowerCase().includes(q.toLowerCase());
      if (!hit(had.note) && hit(r.note)) { had.note = r.note; had.id = r.id; }
    });
    const packed = [...byOne.values()].slice(0, 10);

    await facesFor([...new Set(packed.map(r => r.user_id))]);
    return {
      q,
      people: p.data || [],
      cards: packed,
      shop: (sh.data || []).filter(usableShop)
    };
  }

  /* If a story is why this card matched, show the part that matched -- an
     unexplained result reads as a bug. */
  function whyLine(row, q) {
    const n = row.note || '';
    if (!n) return '';
    const at = n.toLowerCase().indexOf(q.toLowerCase());
    if (at < 0) return '';
    const from = Math.max(0, at - 24);
    return (from ? '\u2026' : '') + n.slice(from, from + 90).trim() + (n.length > from + 90 ? '\u2026' : '');
  }

  function resultsHTML(r) {
    if (!r) return '';
    const bits = [];

    if (r.people.length) {
      bits.push('<div class="res-group">PEOPLE</div>');
      r.people.forEach(u => {
        bits.push(`<button class="res" type="button" data-pick="person"
          data-id="${esc(u.id)}" data-label="${esc(u.username || 'A collector')}">
          <img class="pic round" src="${esc(u.avatar_url || '../assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='../assets/hyde-bot.png'">
          <span><b>${esc(u.username || 'A collector')}</b><small>See their cards</small></span>
        </button>`);
      });
    }

    if (r.cards.length) {
      bits.push('<div class="res-group">CARDS ON HERE</div>');
      r.cards.forEach(c => {
        const who = faces[c.user_id];
        const why = whyLine(c, r.q);
        bits.push(`<button class="res" type="button" data-pick="card"
          data-label="${esc(c.card_name || 'Card')}">
          <img class="pic" src="${esc(c.image_url || NO_PHOTO)}" alt=""
               onerror="this.onerror=null;this.src='${NO_PHOTO}'">
          <span><b>${esc(c.card_name || 'Card')}</b>
            <small>${esc([c.set_name, (who && who.name) || 'a collector',
                           c.copies > 1 ? '\u00d7' + c.copies : ''].filter(Boolean).join(' \u00b7 '))}</small>
            ${why ? `<span class="why">\u201c${esc(why)}\u201d</span>` : ''}</span>
        </button>`);
      });
    }

    if (r.shop.length) {
      bits.push('<div class="res-group">AT THE SHOP</div>');
      r.shop.forEach(it => {
        bits.push(`<a class="res" href="../?page=shop">
          <img class="pic" src="${esc(it.photo_url || it.art_url || NO_PHOTO)}" alt=""
               onerror="this.onerror=null;this.src='${NO_PHOTO}'">
          <span><b>${esc(it.name || 'Card')}</b>
            <small>${esc([it.set_name, money(it.price)].filter(Boolean).join(' \u00b7 '))}</small></span>
        </a>`);
      });
    }

    /* NOT A DEAD END. Nothing here owns one, so the next thing on screen is
       the door to the page that knows about every card there is. */
    if (!bits.length) {
      bits.push(`<div class="res-none"><b>Nobody here has one yet</b>
        No people, cards or shop listings match \u201c${esc(r.q)}\u201d.</div>
        <a class="res" href="../?page=lookup&q=${encodeURIComponent(r.q)}">
          <span class="pic">${I.look}</span>
          <span><b>Look it up instead</b><small>Search every card there is</small></span>
        </a>`);
    }
    return bits.join('');
  }

  let searchAt = 0;          /* only the newest answer is allowed to draw */
  let searchTimer = null;

  function runSearch(raw) {
    const { out } = searchEls();
    if (!out) return;
    if (cleanQ(raw).length < 2) { out.innerHTML = ''; return; }
    const mine = ++searchAt;
    searchAll(raw).then(r => {
      /* A slow answer to an old query must never overwrite a fast answer to
         the current one -- that is how a search box ends up showing results
         for something you already deleted. */
      if (mine !== searchAt) return;
      out.innerHTML = resultsHTML(r);
    }).catch(e => {
      if (mine !== searchAt) return;
      note('Search failed: ' + ((e && e.message) || 'unknown'));
      out.innerHTML = `<div class="res-none"><b>That did not work</b>Try again in a moment.</div>`;
    });
  }

  function openSearch(on) {
    const { wrap, box, out } = searchEls();
    if (!wrap) return;
    wrap.hidden = !on;
    const btn = document.querySelector('[data-search-open]');
    if (btn) btn.setAttribute('aria-expanded', String(!!on));
    if (on) { if (box) { box.focus(); box.select(); } }
    else { if (box) box.value = ''; if (out) out.innerHTML = ''; searchAt++; }
  }

  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'q') {
      clearTimeout(searchTimer);
      const v = e.target.value;
      searchTimer = setTimeout(() => runSearch(v), 260);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const { wrap } = searchEls();
      if (wrap && !wrap.hidden) openSearch(false);
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-search-open]')) {
      const { wrap } = searchEls();
      openSearch(!wrap || wrap.hidden);
      return;
    }
    if (e.target.closest('[data-search-close]')) { openSearch(false); return; }
    if (e.target.closest('[data-chip-clear]')) { setFilter(null); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const label = pick.getAttribute('data-label') || '';
      openSearch(false);
      window.scrollTo(0, 0);
      setFilter(pick.getAttribute('data-pick') === 'person'
        ? { kind: 'person', id: pick.getAttribute('data-id'), label }
        : { kind: 'card', name: label, label });
    }
  });

  /* Draw the build stamp first, before anything can go wrong. If the feed
     itself fails you still want to know which build failed. */
  function stamp() {
    const el = document.getElementById('build');
    if (el) el.textContent = BUILD;
    console.log('[feed] build ' + BUILD);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { stamp(); start(); });
  else { stamp(); start(); }
})();
