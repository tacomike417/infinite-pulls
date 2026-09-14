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
  const money  = (n) => (n == null || isNaN(n)) ? '' : '$' + Number(n).toFixed(2);

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
             data-row="${esc(p.rowId || '')}" data-owner="${esc(p.userId || '')}" data-note="${esc(p.note || '')}">
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
        .select('recorded_on, price, variant')
        .eq('card_id', cardId).eq('variant', 'market')
        .order('recorded_on', { ascending: true }).limit(200);
      if (error || !Array.isArray(data)) return [];
      return data;
    } catch (_) { return []; }
  }

  function rearHTML(p, hist) {
    /* BOTH NUMBERS COME FROM THE SAME PLACE, or the comparison is a lie.
       card_price_history is market value; a shop row's `price` is what Jeff
       is ASKING for it. Putting one against the other made a card look like
       it fell from $141 to $7 when nothing had happened to it at all.
       So: if there is history, the pair is history's first and last. The
       listing price is only used when there is no history to compare with,
       and then there is nothing to compare it to anyway. */
    const first = hist.length ? Number(hist[0].price) : null;
    const last  = hist.length ? Number(hist[hist.length - 1].price) : null;
    const now   = hist.length ? last : (p.price != null ? p.price : null);
    const moved = (first != null && last != null) ? last - first : null;
    const dir   = moved == null ? '' : (moved > 0.005 ? 'up' : (moved < -0.005 ? 'down' : ''));

    const events = [];
    if (p.when) events.push(['ADDED', day(p.when), 'Listed at the shop']);
    if (hist.length > 1) {
      const l = hist[hist.length - 1];
      events.push(['VALUE', day(l.recorded_on),
        `${money(first)} \u2192 ${money(Number(l.price))}`]);
    }

    return `
      <span class="eyebrow">THIS IS THE BACK OF YOUR CARD</span>
      <div class="backface">
        <img src="../assets/logo-sm.webp" alt=""
             onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('span'),{textContent:'INFINITE PULLS'}))">
      </div>
      <div class="facts">
        <div class="fact">${I.cal}<span><span class="k">ADDED</span>
          <span class="v">${esc(day(p.when) || 'not recorded')}</span></span></div>
        ${first != null ? `<div class="fact">${I.coin}<span><span class="k">ORIGINAL VALUE</span>
          <span class="v">${esc(money(first))}</span></span></div>` : ''}
        <div class="fact">${I.trend}<span><span class="k">${hist.length ? 'CURRENT VALUE' : 'PRICE AT THE SHOP'}</span>
          <span class="v ${dir}">${esc(money(now) || '—')}</span></span></div>
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
    while (out.length < n) {
      const keys = [...queues.keys()].filter(k => queues.get(k).length);
      if (!keys.length) break;
      /* start the round at a different seat each time so the same account is
         not permanently first */
      const order = keys.slice(spin % keys.length).concat(keys.slice(0, spin % keys.length));
      spin++;
      let tookAny = false;
      for (const k of order) {
        if (out.length >= n) break;
        const q = queues.get(k);
        if (!q.length) continue;
        /* only refuse a repeat while somebody else actually has one waiting */
        if (k === lastWho && keys.length > 1 && out.length) continue;
        out.push(q.shift());
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

  async function facesFor(ids) {
    const want = ids.filter(id => id && !(id in faces));
    if (!want.length || !sb) return;
    try {
      const { data } = await sb.from('profiles')
        .select('id, username, avatar_url').in('id', want);
      (data || []).forEach(p => { faces[p.id] = { name: p.username, avatar: p.avatar_url }; });
    } catch (_) { /* a missing name is not worth failing a feed over */ }
    want.forEach(id => { if (!(id in faces)) faces[id] = null; });
  }

  async function fetchCards() {
    let q = sb.from('user_cards')
      .select('id, user_id, card_id, card_name, set_name, image_url, variant, condition, quantity, added_at, note')
      .order('added_at', { ascending: false })
      .limit(PAGE * 3);
    if (cursor) q = q.lt('added_at', cursor);
    const { data, error } = await q;
    /* SAY SO WHEN IT FAILS. The first version treated an error exactly like
       an empty shelf -- it marked the source drained and slid on to the shop,
       so a broken permission looked identical to nobody having any cards.
       That cost real time. */
    if (error) { note('Could not read collections: ' + (error.message || error.code || 'unknown')); drained = true; return; }
    if (!data) { drained = true; return; }
    if (data.length) cursor = data[data.length - 1].added_at;
    if (data.length < PAGE * 3) drained = true;
    if (!data.length && !queued()) note('No collections came back — nobody has cards, or no profile is public.');
    await facesFor([...new Set(data.map(r => r.user_id))]);
    data.forEach(r => enqueue((function () {
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
        pics: r.image_url ? [r.image_url] : [NO_PHOTO],
        shape: 'portrait'
      };
    })()));
  }

  async function fetchShop() {
    let q = sb.from('shop_available')
      .select('clover_item_id, card_id, name, set_name, card_number, price, available, photo_url, art_url, added_at, hidden_online')
      .order('added_at', { ascending: false })
      .limit(PAGE * 3);
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
        ? (queued() >= PAGE && queues.size > 1) || (drained && queued())
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
        const p = { when: post.getAttribute('data-when'),
                    price: Number(post.getAttribute('data-price')) || null,
                    kind: owner ? 'card' : 'shop',
                    note: post.getAttribute('data-note') || '',
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
  async function start() {
    if (!sb) {
      feed.innerHTML = `<div class="msg"><b>No connection to the shop</b>
        This page needs config.js and the Supabase library. Open it from the site,
        not from a file on your computer.</div>`;
      return;
    }
    feed.innerHTML = tutorialHTML() +
      `<div class="skel"><div class="bar" style="width:55%"></div><div class="box"></div></div>`;
    await loadMore();
    const first = feed.querySelector('.skel');
    if (first) first.remove();
    if (!feed.querySelector('.post:not(.tutorial)')) {
      feed.insertAdjacentHTML('beforeend', `<div class="msg"><b>No cards yet</b>
        Scan your first one and it lands right here.</div>`);
      return;
    }
    /* keep loading as they approach the bottom */
    const io = new IntersectionObserver((ents) => {
      if (ents.some(x => x.isIntersecting)) loadMore();
    }, { rootMargin: '900px' });
    sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    feed.appendChild(sentinel);
    io.observe(sentinel);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
