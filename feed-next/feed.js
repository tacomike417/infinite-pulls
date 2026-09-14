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
  const BUILD = 'v26';

  const PAGE = 8;                     // posts per fetch
  const MARKS = 'ip-feed-marks';      // hype + wishlist, this device only

  const cfg = window.InfinitePullsConfig || {};

  /* THE SESSION LIVES UNDER A KEY THE APP CHOSE.
     app.js does not take supabase-js's default storage key -- it passes
     storageKey: 'infinite-pulls-app-auth'. A client built here without that
     looks in a different drawer of the same localStorage, finds nothing, and
     concludes nobody is signed in. Which is what happened: you could sign in
     on the app, walk to the feed, and the feed would treat you as a stranger
     -- no follow buttons of your own, no EDIT STORY, no face on the nav.

     Two clients on one page also means two sessions to keep in step, so the
     app's own client is used when this page is running inside the app, and
     one is only built here when it is not. The key is stated either way, and
     it has to stay the same as app.js's. */
  const AUTH_KEY = 'infinite-pulls-app-auth';
  let sb = null;
  try {
    const shared = window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
    if (shared) {
      sb = shared;
    } else if (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { storageKey: AUTH_KEY, persistSession: true,
                autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
  } catch (_) { sb = null; }

  /* SAY IT OUT LOUD, ONCE, HERE. components/card-photo.js asks for the shared
     client by this name to get the signed-in token it hands the worker. It
     used to be set inside goalsEngine(), which meant the uploader worked or
     did not depending on whether anybody had looked at a badge yet. */
  if (sb && !window.InfinitePullsSupabase) window.InfinitePullsSupabase = { client: sb, ready: true };

  /* WHO IS LOOKING. */
  let me = null;
  /* WAITED FOR, NOT FIRED AND FORGOTTEN. Who is looking decides which posts
     get a follow button and which get an EDIT STORY button, and the first
     screenful used to be drawn before the answer came back -- so on a slow
     connection your own cards arrived looking like a stranger's. */
  async function whoAmI() {
    if (!sb) return;
    try {
      const r = await sb.auth.getUser();
      me = (r && r.data && r.data.user) ? r.data.user.id : null;
    } catch (_) { me = null; }
    if (!me) return;
    /* Your own name and face, asked for directly rather than hoped for from
       the roster -- the roster only carries PUBLIC profiles, so somebody who
       has turned themselves private would otherwise be signed in and look
       like a stranger to their own app. */
    try {
      const { data } = await sb.from('profiles')
        .select('id, username, avatar_url').eq('id', me).limit(1);
      if (data && data[0]) faces[me] = { name: data[0].username, avatar: data[0].avatar_url };
    } catch (_) { /* a missing name is not worth failing the feed over */ }
  }

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
    /* HEAT, not hype -- Jeff's word, and the one the shop floor uses. Filled
       the same way the bolt was, so the button is the shape it always was. */
    flame:'<svg viewBox="0 0 24 24"><path d="M12.8 2c.6 3-1.1 4.4-2.6 5.8C8.4 9.4 6.6 11 6.6 14a5.4 5.4 0 0 0 10.8 0c0-2.2-1-3.7-2-5-.3 1-.9 1.7-1.7 2 .5-3.1-.6-7.2-.9-9z"/><path d="M12 21a2.6 2.6 0 0 1-2.6-2.6c0-1.6 1.6-2.3 2.6-4 1 1.7 2.6 2.4 2.6 4A2.6 2.6 0 0 1 12 21z" opacity=".55"/></svg>',
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
    quill:'<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    chevL:'<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    chevR2:'<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>'
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
  /* A PICTURE IS ALWAYS { u, id, kind } -- never a bare string.
     `id` is the card_photos row behind it, which is what a remove button
     needs; `kind` says whether it is the scanned shot or somebody's own
     picture, which is what decides whether that button is there at all.
     The shop's two pictures go through the same shape so one renderer draws
     both and there is no second code path to forget about. */
  const pic = (u, id, kind) => ({ u, id: id || '', kind: kind || 'card' });

  const shotsFor = (r) => {
    const mine = photoUrl(r.photo_key);
    if (mine) return [pic(mine, '', 'card')];
    return r.image_url ? [pic(r.image_url, '', 'card')] : [pic(NO_PHOTO, '', 'card')];
  };

  /* ---- EVERY PHOTO ON A CARD ---------------------------------------------
     card_photos holds one row per picture: the shot the scanner kept when the
     card was added (kind='card') and the owner's own pictures beside it
     (kind='mine'), in `sort` order. Asked for a whole screenful at a time --
     one query for twenty cards, not twenty queries for one each.

     A DATABASE WITHOUT THE TABLE STILL WORKS. Until card_photos.sql has been
     run this asks once, is told there is no such table, says so on screen,
     and never asks again; every card falls back to user_cards.photo_key
     exactly as it did before. Photos are a bonus, never a gate -- the same
     rule the uploader follows. */
  const noTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' ||
    /relation .* does not exist|could not find the table/i.test(e.message || ''));

  let photosOff = false;
  async function attachPhotos(rows) {
    if (photosOff || !sb || !rows.length) return;
    /* CARD ROWS ONLY. A photo post's rowId is a user_photos id, and asking
       card_photos about it can only ever return nothing -- while making the
       query longer and the intent murkier. */
    const ids = [...new Set(rows.filter(r => r.kind === 'card').map(r => r.rowId).filter(Boolean))];
    if (!ids.length) return;
    let data = null, error = null;
    try {
      ({ data, error } = await sb.from('card_photos')
        .select('id, user_card_id, object_key, kind, sort')
        .in('user_card_id', ids)
        .order('sort', { ascending: true })
        .order('added_at', { ascending: true }));
    } catch (e) { error = e; }
    if (error) {
      photosOff = true;
      note(noTable(error)
        ? 'Card photos are not switched on yet — run card_photos.sql.'
        : 'Could not read card photos: ' + (error.message || error.code || 'unknown'));
      return;
    }
    const by = new Map();
    (data || []).forEach(row => {
      const u = photoUrl(row.object_key);
      if (!u) return;
      if (!by.has(row.user_card_id)) by.set(row.user_card_id, []);
      by.get(row.user_card_id).push(pic(u, row.id, row.kind));
    });
    rows.forEach(r => {
      const list = by.get(r.rowId);
      if (list && list.length) r.pics = list;
    });
  }
  const fallback = `onerror="this.onerror=null;this.src='${NO_PHOTO}';this.closest('.frame')?.setAttribute('data-shape','portrait')"`;

  /* ONE SLIDE. A picture you added yourself gets a way to un-add it: a photo
     you cannot take back is worse than never having put one up. The scanned
     shot does not get one -- that is the card, and a card with no picture of
     itself is not a post. */
  const figureHTML = (q, p) => `<figure>
      <img src="${esc(q.u)}" alt="${esc(p.name)}" loading="lazy" decoding="async" ${fallback}>
      ${(p.mine && q.id && q.kind === 'mine')
        ? `<button class="dropx" type="button" data-drop-photo="${esc(q.id)}"
                   aria-label="Remove this photo">&times;</button>` : ''}
    </figure>`;

  /* THE LAST SLIDE ON YOUR OWN CARD. No menu, no separate screen, no plus
     button somewhere else on the page that means a different thing -- the
     empty space where a second picture would be IS the way to put one there.
     The <span data-say> is where "Adding…" and any complaint goes, so a
     failure is on the tile the person is looking at instead of in a console
     nobody opens. */
  const ADD_TILE = `<figure class="addpic">
      <button type="button" data-add-photo aria-label="Add your own photo of this card">
        <span class="plus">+</span>
        <b>ADD YOUR OWN PHOTO</b>
        <small>you holding it, the pull, wherever it came from</small>
        <span class="say" data-say hidden></span>
      </button>
    </figure>`;

  /* ---- turning a shop row into a post ----------------------------------- */
  function toPost(r) {
    /* Two pictures exist today: the photograph Jeff took, and the catalogue
       art. His own comes first, because the whole idea is that the feed is
       real cards somebody actually holds. */
    const urls = [r.photo_url, r.art_url].filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);
    if (!urls.length) urls.push(NO_PHOTO);
    const pics = urls.map(u => pic(u, '', 'card'));
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

  /* ---- A PHOTO POST ------------------------------------------------------
     Deliberately less than a card post, and the list of what is missing is
     the design: no card back to turn over, because there is no card; no
     CARD SNAPSHOT, no LOOK UP / SOLD LISTINGS / CARD DETAILS, because none
     of them mean anything about a picture of a person; and no WISHLIST,
     because you cannot want somebody else's photograph.

     What is left is what a photograph is for: whose it is, the picture, and
     HEAT, COMMENT and SHARE. */
  function photoHTML(p, i) {
    const hyped = marked(p.key, 'hype');
    const n = 41 + (i % 7) * 4;       /* until HEAT is a real table */
    const shot = p.pics[0];
    return `
    <article class="post is-photo" data-key="${esc(p.key)}" data-when="${esc(p.when || '')}"
             data-row="${esc(p.rowId || '')}" data-owner="${esc(p.userId || '')}">
      <header class="post-top">
        <button class="avatar-btn" type="button" data-open-person="${esc(p.userId)}"
                data-open-label="${esc(p.who || 'A collector')}"
                aria-label="See ${esc(p.who || 'this collector')}&rsquo;s cards">
          <img class="avatar" src="${esc(p.avatar || '../assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='../assets/hyde-bot.png'">
        </button>
        <button class="who who-btn" type="button" data-open-person="${esc(p.userId)}"
                data-open-label="${esc(p.who || 'A collector')}">
          <b>${esc(p.who || 'A collector')}</b><small>${esc(day(p.when) || 'Posted a photo')}</small>
        </button>
        ${p.mine
          ? /* ITS OWN CLASS, NOT .follow. Borrowing the follow button's class
               for a button that DELETES something meant every querySelector
               for '.follow' in the app -- and in its tests -- came back
               holding a remove button. It looks the same; it is not the same
               thing. */
            `<button class="post-drop" type="button" data-drop-post="${esc(p.rowId)}">REMOVE</button>`
          : `<button class="follow${following(p.userId) ? ' on' : ''}" type="button"
                     data-follow="${esc(p.userId || '')}">${following(p.userId) ? 'FOLLOWING' : 'FOLLOW'}</button>`}
      </header>

      <div class="frame" data-shape="auto">
        <div class="rail">
          ${shot ? `<figure><img src="${esc(shot.u)}" alt="" loading="lazy" decoding="async" ${fallback}></figure>` : ''}
        </div>
      </div>

      <div class="acts is-photo">
        <button class="act hype${hyped ? ' on' : ''}" data-hype aria-pressed="${hyped}" aria-label="Heat">
          <span class="ring">${I.flame}</span>
          <span><span class="lbl">HEAT</span><span class="n">${n + (hyped ? 1 : 0)}</span></span>
        </button>
        <button class="act" data-comment>${I.chat}<span>COMMENT</span></button>
        <button class="act" data-share>${I.share}<span>SHARE</span></button>
      </div>

      ${p.caption
        ? `<p class="caption"><b>${esc(p.who || 'A collector')}</b> ${esc(p.caption)}</p>`
        : ''}
    </article>`;
  }

  /* ---- one post --------------------------------------------------------- */
  function postHTML(p, i) {
    if (p.kind === 'photo') return photoHTML(p, i);
    /* The MARK is still stored under 'hype': the word on the button changed,
       not the thing it records, and renaming the key would silently throw
       away every mark anybody has already made on their own phone. */
    const hyped = marked(p.key, 'hype');
    const saved = marked(p.key, 'save');
    const n = 37 + (i % 9) * 3;       /* until HYPE is a real table */
    const sub = [p.set, p.num && '#' + p.num].filter(Boolean).join(' · ');
    /* TWO DIFFERENT NUMBERS, AND THEY ARE NOT THE SAME NUMBER.
       
       PHOTOS is how many pictures there are, and it is the only thing the
       "1 / 3" badge ever counts -- a card and two of your own reads 1 / 3,
       because three is how many pictures a person can see. The add tile is
       not a picture of anything.

       SLIDES includes the tile, because the tile is still somewhere the
       strip goes, and the pips are a map of where it goes. On your own card
       that makes the strip two long even when there is one picture, which is
       the point: a card with a single photo gives nobody a reason to swipe,
       and an invitation sitting one swipe in is never found. */
    const photos = p.pics.length;
    const slides = photos + (p.mine ? 1 : 0);

    return `
    <article class="post" data-key="${esc(p.key)}" data-when="${esc(p.when || '')}" data-price="${esc(p.price == null ? '' : p.price)}"
             data-row="${esc(p.rowId || '')}" data-owner="${esc(p.userId || '')}" data-note="${esc(p.note || '')}"
             data-name="${esc(p.name || '')}" data-num="${esc(p.num || '')}">
      <header class="post-top">
        ${p.kind === 'shop' || !p.userId ? `
        <img class="avatar" src="${esc(p.avatar || '../assets/hyde-bot.png')}" alt=""
             onerror="this.onerror=null;this.src='../assets/hyde-bot.png'">
        <div class="who"><b>${esc(p.who || 'A collector')}</b><small>${esc(sub || 'At the shop')}</small></div>
        ` : `
        <!-- A name and a face are the obvious things to tap to see somebody's
             cards, so they are both the same button. It narrows the feed the
             way a search result does, chip and all, rather than being a
             second and different way of looking at one person. -->
        <button class="avatar-btn" type="button" data-open-person="${esc(p.userId)}"
                data-open-label="${esc(p.who || 'A collector')}"
                aria-label="See ${esc(p.who || 'this collector')}&rsquo;s cards">
          <img class="avatar" src="${esc(p.avatar || '../assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='../assets/hyde-bot.png'">
        </button>
        <button class="who who-btn" type="button" data-open-person="${esc(p.userId)}"
                data-open-label="${esc(p.who || 'A collector')}">
          <b>${esc(p.who || 'A collector')}</b><small>${esc(sub || 'In their collection')}</small>
        </button>
        `}
        <div class="badges"><span>&#9889;</span><span>&#9733;</span></div>
        ${p.kind === 'shop' || (me && p.userId === me) ? '' :
          `<button class="follow${following(p.userId) ? ' on' : ''}" type="button"
                   data-follow="${esc(p.userId || '')}">${following(p.userId) ? 'FOLLOWING' : 'FOLLOW'}</button>`}
      </header>

      <div class="frame" data-shape="${esc(p.shape)}" data-card="${esc(p.cardId || '')}">
        <div class="flip">
          <div class="side front">
            <span class="count"${photos > 1 ? '' : ' hidden'}>1 / ${photos}</span>
            <div class="rail">
              ${p.pics.map(q => figureHTML(q, p)).join('')}${p.mine ? ADD_TILE : ''}
            </div>
            <div class="pips"${slides > 1 ? '' : ' hidden'}>${Array.from({ length: slides }, (_, k) =>
              `<button type="button" class="${k ? '' : 'on'}" data-pip="${k}" aria-label="Photo ${k + 1}"></button>`).join('')}</div>
            <button class="nudge prev" type="button" data-nudge="-1" aria-label="Previous photo"${slides > 1 ? '' : ' hidden'}>${I.chevL}</button>
            <button class="nudge next" type="button" data-nudge="1" aria-label="Next photo"${slides > 1 ? '' : ' hidden'}>${I.chevR2}</button>
          </div>
          <div class="side rear" data-rear><!-- filled the first time it is turned over --></div>
        </div>
        <button class="turn" type="button" data-turn>${I.flip}<span data-turn-label>CARD STORY</span></button>
      </div>

      <div class="acts">
        <button class="act hype${hyped ? ' on' : ''}" data-hype aria-pressed="${hyped}"
                aria-label="Heat">
          <span class="ring">${I.flame}</span>
          <span><span class="lbl">HEAT</span><span class="n">${n + (hyped ? 1 : 0)}</span></span>
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
  /* ONE PLACE DECIDES WHAT THE STRIP SAYS.
     
     Everything is read off the rail at the moment it is asked, never
     captured when the post was drawn or when the scroll was wired: a photo
     added or removed since then changes every one of these numbers, and a
     second copy of this arithmetic somewhere else is a second copy to get
     out of step. `rebuild` is for when the slides themselves changed. */
  function paintStrip(frame, rebuild) {
    const rail = frame.querySelector('.rail');
    if (!rail) return;
    const figs = [...rail.querySelectorAll('figure')];
    if (!figs.length) return;
    const photos = figs.filter(f => !f.classList.contains('addpic')).length;
    const at = Math.max(0, Math.min(figs.length - 1,
      Math.round(rail.scrollLeft / (rail.clientWidth || 1))));

    const pips = frame.querySelector('.pips');
    if (pips) {
      if (rebuild || pips.children.length !== figs.length) {
        pips.innerHTML = Array.from({ length: figs.length }, (_, k) =>
          `<button type="button" data-pip="${k}" aria-label="Photo ${k + 1}"></button>`).join('');
      }
      [...pips.children].forEach((el, k) => el.classList.toggle('on', k === at));
      pips.hidden = figs.length < 2;
    }

    /* The arrows know where you are, so the one that would do nothing says
       so rather than being a button that ignores you. */
    const prev = frame.querySelector('.nudge.prev');
    const next = frame.querySelector('.nudge.next');
    if (prev) { prev.hidden = figs.length < 2; prev.disabled = at <= 0; }
    if (next) { next.hidden = figs.length < 2; next.disabled = at >= figs.length - 1; }

    /* ON THE ADD TILE THE BADGE GOES AWAY. "4 / 3" is not a thing, and
       neither is counting a blank invitation as a photograph. */
    const count = frame.querySelector('.count');
    if (count) {
      const onTile = !!(figs[at] && figs[at].classList.contains('addpic'));
      count.hidden = onTile || photos < 2;
      if (!count.hidden) count.textContent = `${at + 1} / ${photos}`;
    }
    /* THE "SWIPE FOR PHOTOS" BANNER IS GONE. It sat across the bottom of the
       picture, overlapping the CARD STORY button and the pips both, and it
       asked for a gesture that turned out not to be reliable in the first
       place. The arrows say the same thing by being arrows. */
  }

  /* MOVE THE STRIP TO A SLIDE, whatever asked for it -- an arrow, a pip, or
     a keyboard. scrollTo rather than scrollIntoView: scrollIntoView on a
     horizontal child will also scroll the PAGE to bring the post into view,
     which on a feed means the ground moving under somebody's thumb. */
  function goToSlide(frame, k) {
    const rail = frame.querySelector('.rail');
    if (!rail) return;
    const n = rail.querySelectorAll('figure').length;
    const at = Math.max(0, Math.min(n - 1, k));
    rail.scrollTo({ left: at * rail.clientWidth, behavior: 'smooth' });
    /* painted now as well as on the scroll event: a smooth scroll that gets
       interrupted would otherwise leave the pips lying about where you are */
    setTimeout(() => paintStrip(frame, false), 420);
  }

  function wireRail(frame) {
    const rail = frame.querySelector('.rail');
    if (!rail) return;
    let tick;
    rail.addEventListener('scroll', () => {
      frame.classList.add('moved');
      clearTimeout(tick);
      tick = setTimeout(() => paintStrip(frame, false), 60);
    }, { passive: true });
  }

  /* The strip after a photo arrives or leaves. */
  const syncRail = (frame) => paintStrip(frame, true);

  /* ---- PUTTING A PHOTO ON YOUR OWN CARD ----------------------------------
     A hidden file input, not a live camera stream, and on purpose:

       * it opens the phone's own camera sheet, which ALSO offers the photos
         already on the phone -- and most of these pictures were taken at the
         moment of the pull, long before anybody thought to open the app;
       * `capture` is deliberately not set, because setting it takes the
         library away and leaves only a viewfinder;
       * there is no permission prompt to survive and no stream to shut down
         when somebody scrolls away mid-shot.

     The tap on the tile is the gesture the browser insists on, and it is
     spent on the very next line -- nothing navigates in between, which is
     the thing that breaks it. */
  let picker = null, pickFor = null;
  function ensurePicker() {
    if (picker) return picker;
    picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
    picker.addEventListener('change', () => {
      const file = picker.files && picker.files[0];
      picker.value = '';        /* or choosing the same photo twice is silent */
      if (file && pickFor) addPhoto(pickFor, file);
    });
    document.body.appendChild(picker);
    return picker;
  }

  const readFile = (file) => new Promise((ok) => {
    try {
      const fr = new FileReader();
      fr.onload  = () => ok(String(fr.result || ''));
      fr.onerror = () => ok('');
      fr.readAsDataURL(file);
    } catch (_) { ok(''); }
  });

  function sayOn(tile, msg) {
    const el = tile && tile.querySelector('[data-say]');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  async function addPhoto(frame, file) {
    const post  = frame.closest('.post');
    const rowId = post && post.getAttribute('data-row');
    const tile  = frame.querySelector('.addpic');
    if (!rowId || !tile) return;
    const CP = window.InfinitePullsCardPhoto;
    if (!CP || !CP.ready()) { sayOn(tile, 'Photo storage is not set up yet'); return; }

    frame.setAttribute('data-busy', '1');
    sayOn(tile, 'Adding…');
    try {
      const src = await readFile(file);
      if (!src) throw new Error('could not read that file');
      const blob = await CP.shrink(src);
      if (!blob) throw new Error('could not shrink that photo');
      const key = await CP.upload(blob, rowId);
      if (!key) throw new Error('the upload was refused');

      /* Sort puts it after everything already there, so the scanned shot
         stays the face of the post and new pictures queue up behind it. */
      const sort = frame.querySelectorAll('.rail figure:not(.addpic)').length;
      const { data, error } = await sb.from('card_photos')
        .insert({ user_card_id: rowId, user_id: me, object_key: key, kind: 'mine', sort })
        .select('id').single();
      if (error) throw new Error(error.message || error.code || 'could not save it');

      const fig = document.createElement('figure');
      fig.innerHTML = `<img src="${esc(CP.urlFor(key))}" alt="" decoding="async">
        <button class="dropx" type="button" data-drop-photo="${esc(data && data.id)}"
                aria-label="Remove this photo">&times;</button>`;
      tile.parentNode.insertBefore(fig, tile);
      syncRail(frame);
      sayOn(tile, '');
      fig.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    } catch (e) {
      /* SAID ON THE TILE, NOT IN THE CONSOLE. A photo that silently does not
         appear is indistinguishable from an app that is broken. */
      sayOn(tile, (e && e.message) || 'that did not work');
      setTimeout(() => sayOn(tile, ''), 5000);
    }
    frame.removeAttribute('data-busy');
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
  const PHOTOS_PER_ACCOUNT = 2;  // and photo posts, off the other table
  const MAX_PER_PAGE = 2;    // posts any one account may have per screenful

  /* ---- WHO YOU HAVE UNFOLLOWED ------------------------------------------
     Everybody follows everybody, so this is the short list of people you
     have said otherwise about. Loaded once; a signed-out visitor has none
     and sees everyone, which is the truth about what they can see. */
  const unfollowed = new Set();
  let followsLoaded = false;

  async function loadFollows() {
    if (followsLoaded || !sb || !me) { followsLoaded = true; return; }
    followsLoaded = true;
    try {
      const { data, error } = await sb.from('follows')
        .select('followee_id, following').eq('follower_id', me);
      if (error) {
        /* No table yet? Then nobody has unfollowed anybody, which is exactly
           what the feed should show. Say it once and carry on rather than
           refusing to draw. */
        note('Could not read follows (' + (error.message || error.code || 'unknown') + ') — showing everyone.');
        return;
      }
      (data || []).forEach(r => { if (r.following === false) unfollowed.add(r.followee_id); });
    } catch (_) { /* same reasoning */ }
  }

  const following = (id) => !!id && !unfollowed.has(id);

  /* ---- WHAT THE FEED IS NARROWED TO -------------------------------------
     null is the whole feed. A person filter swaps the roster for a list of
     one, which is nearly free because the feed already fetches per account.
     A card filter is a different shape -- one query across everybody -- and
     it still feeds the same round-robin queues, so five people who each own
     a Charizard come back interleaved rather than in a block. */
  let filter = null;   /* null | {kind:'person', id, label} | {kind:'card', name} */

  let roster = null;            /* [user_id, ...] shuffled */
  let rosterAt = 0;
  const spent = new Set();      /* accounts with nothing left of either kind */
  const cursors = new Map();    /* user_id -> oldest added_at we have seen */
  /* CARDS AND PHOTO POSTS RUN OUT SEPARATELY, so they are tracked
     separately: somebody with two hundred cards and three photographs must
     not stop showing cards the moment the photographs are used up, nor the
     other way round. `spent` is only set once both are. */
  const cardSpent = new Set(), photoSpent = new Set(), photoCursors = new Map();
  let photoPostsOff = false;

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
        /* Unfollowing is what takes somebody out of the feed. It happens
           here, before any card is asked for, so their rows are never
           fetched at all rather than fetched and then thrown away. */
        if (!unfollowed.has(p.id)) roster.push(p.id);
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
    railDone.clear();
    queues.clear(); spent.clear(); cursors.clear();
    cardSpent.clear(); photoSpent.clear(); photoCursors.clear(); firstPhotoAsk = null;
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
    const mine = !!(me && r.user_id === me);
    /* YOUR OWN CARD WITH NOTHING ON IT SHOWS THE ADD TILE INSTEAD OF THE
       "no photo" card. One slide, and it is the invitation. A stranger still
       gets the placeholder, because telling them to add a photo to somebody
       else's card is nonsense. */
    let pics = shotsFor(r);
    if (mine && pics.length === 1 && pics[0].u === NO_PHOTO) pics = [];
    return {
      mine,
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
      pics,
      shape: 'portrait'
    };
  };

  /* ---- A PHOTO THAT IS ITS OWN POST -------------------------------------
     Not a picture of a card. user_photos has no card on it at all, which is
     the whole point: somebody opens the camera, swipes off the card lane,
     takes a picture and posts it. It arrives in the feed beside the cards
     and belongs to nothing else.

     It goes through the SAME per-person queue the cards do, so somebody who
     posted four pictures this morning takes over the screen no more than
     somebody who added four cards did. */
  const photoRow = (r) => {
    const who = faces[r.user_id];
    const u = photoUrl(r.object_key);
    return {
      kind: 'photo',
      key: 'ph' + r.id,
      rowId: r.id,
      userId: r.user_id,
      mine: !!(me && r.user_id === me),
      who: (who && who.name) || 'A collector',
      avatar: (who && who.avatar) || '',
      caption: r.caption || '',
      name: '',
      when: r.added_at,
      pics: u ? [pic(u, r.id, 'post')] : [],
      /* whatever shape the phone gave us. A photograph is not 4:5, and
         letterboxing somebody's face to fit a card frame is a choice nobody
         would make on purpose. */
      shape: 'auto'
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

  async function fetchCardsForAccount(id) {
    if (cardSpent.has(id)) return [];
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
    if (error) { note('Could not read a collection: ' + (error.message || error.code || 'unknown')); cardSpent.add(id); return []; }
    const rows = data || [];
    if (rows.length) cursors.set(id, rows[rows.length - 1].added_at);
    if (rows.length < PER_ACCOUNT) cardSpent.add(id);
    return rows.map(cardRow);
  }

  /* THE SAME WALK, DOWN THE OTHER TABLE. */
  /* THE FIRST ASK GATES THE REST OF ITS OWN SLICE.
     Six accounts are asked at once, so on a database without the table all
     six fired, all six failed, and all six said so -- the switch that is
     meant to stop asking was flipped six times in the same tick. The first
     query out holds the door: the others wait for its answer and then find
     the switch already thrown. It costs one round trip of extra latency,
     once, on the very first slice of a visit. */
  let firstPhotoAsk = null;

  async function fetchPhotosForAccount(id) {
    if (photoPostsOff || photoSpent.has(id)) return [];
    if (firstPhotoAsk) {
      try { await firstPhotoAsk; } catch (_) {}
      if (photoPostsOff) return [];
    }
    let data = null, error = null;
    try {
      let q = sb.from('user_photos')
        .select('id, user_id, object_key, caption, added_at')
        .eq('user_id', id)
        .order('added_at', { ascending: false })
        .limit(PHOTOS_PER_ACCOUNT);
      if (photoCursors.has(id)) q = q.lt('added_at', photoCursors.get(id));
      const run = Promise.resolve(q);
      if (!firstPhotoAsk) firstPhotoAsk = run;
      ({ data, error } = await run);
    } catch (e) { error = e; }
    if (error) {
      /* No such table means the migration has not been run, and that is a
         thing to say ONCE and then stop asking about -- not once per account
         per screenful, which is six wasted round trips a scroll. */
      if (noTable(error)) { photoPostsOff = true; note('Photo posts are not switched on yet — run user_photos.sql.'); }
      else note('Could not read photo posts: ' + (error.message || error.code || 'unknown'));
      photoSpent.add(id);
      return [];
    }
    const rows = data || [];
    if (rows.length) photoCursors.set(id, rows[rows.length - 1].added_at);
    if (rows.length < PHOTOS_PER_ACCOUNT) photoSpent.add(id);
    return rows.map(photoRow);
  }

  /* BOTH KINDS, ALTERNATING, BEFORE EITHER GOES IN THE QUEUE.
   *
   * The first version of this simply enqueued the cards and then the photos,
   * and the photographs never appeared at all: a person's queue came out as
   * four cards followed by two pictures, the round-robin takes two posts per
   * person per screenful, and two is always two cards. A photograph would
   * have had to wait for somebody's entire collection to run dry.
   *
   * So they are dealt one for one -- a card, a picture, a card -- and it is
   * done HERE rather than in the queue, because the queue's job is fairness
   * between PEOPLE and this is fairness between the two things one person
   * posts. Whoever has the newer thing goes first, so a picture taken five
   * minutes ago is not sat behind a card added last week.
   *
   * An account is finished only when both of its shelves are. Marking it
   * spent on the first empty answer is the same bug wearing a hat: somebody
   * whose cards ran out would never show a photograph again. */
  function deal(a, b) {
    const out = [];
    let i = 0, j = 0;
    let takeA = !b.length || (a.length && String(a[0].when || '') >= String(b[0].when || ''));
    while (i < a.length || j < b.length) {
      if (takeA && i < a.length) out.push(a[i++]);
      else if (!takeA && j < b.length) out.push(b[j++]);
      else if (i < a.length) out.push(a[i++]);
      else out.push(b[j++]);
      takeA = !takeA;
    }
    return out;
  }

  async function fetchForAccount(id) {
    const [cards, pics] = await Promise.all([
      fetchCardsForAccount(id), fetchPhotosForAccount(id)
    ]);
    deal(cards || [], pics || []).forEach(enqueue);
    if (cardSpent.has(id) && (photoPostsOff || photoSpent.has(id))) spent.add(id);
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
    rows.filter(r => following(r.user_id)).forEach(r => enqueue(cardRow(r)));
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
    /* ONE QUERY FOR THE WHOLE SCREENFUL. The photos are asked for after the
       cards are chosen and before a single one is drawn, so nothing flashes
       the catalog art and then swaps to somebody's photograph underneath a
       thumb that is already moving. */
    await attachPhotos(rows);
    const start = feed.querySelectorAll('.post:not(.tutorial)').length;
    if (rows.length) {
      const html = rows.map((r, k) => postHTML(r, start + k)).join('');
      if (sentinel) sentinel.insertAdjacentHTML('beforebegin', html);
      else feed.insertAdjacentHTML('beforeend', html);
      feed.querySelectorAll('.frame:not([data-wired])').forEach(f => {
        f.setAttribute('data-wired', '1');
        wireRail(f);
        /* PAINTED ONCE ON ARRIVAL, not only when something scrolls. The
           arrows' dead/alive state and the pips are worked out from where
           the strip actually is, and until this ran a freshly drawn post
           showed a live "previous" arrow while sitting on the first
           picture -- a button that does nothing, which is worse than no
           button at all. */
        paintStrip(f, false);
      });
      placeRails();
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

    /* THE STRIP'S OWN CONTROLS COME FIRST, before anything that claims a tap
       on a frame. A GESTURE IS NOT A GUARANTEE: on a desktop there is
       nothing to swipe with at all, and on a phone it depends on the browser
       agreeing with you about which way your thumb went. */
    const nudge = e.target.closest('[data-nudge]');
    if (nudge) {
      const frame = nudge.closest('.frame');
      const rail = frame && frame.querySelector('.rail');
      if (!rail) return;
      const now = Math.round(rail.scrollLeft / (rail.clientWidth || 1));
      goToSlide(frame, now + Number(nudge.getAttribute('data-nudge')));
      return;
    }
    const pip = e.target.closest('[data-pip]');
    if (pip) {
      const frame = pip.closest('.frame');
      if (frame) goToSlide(frame, Number(pip.getAttribute('data-pip')));
      return;
    }

    /* THESE TWO COME FIRST. Both live inside .frame, and everything below
       that looks at a frame would happily claim the tap on the way past. */
    const addp = e.target.closest('[data-add-photo]');
    if (addp) {
      const frame = addp.closest('.frame');
      const tile  = addp.closest('.addpic');
      if (!me) { sayOn(tile, 'Sign in to add photos'); setTimeout(() => sayOn(tile, ''), 4000); return; }
      if (frame && !frame.hasAttribute('data-busy')) { pickFor = frame; ensurePicker().click(); }
      return;
    }
    /* YOUR OWN PHOTOGRAPH, OFF THE FEED. A picture of your face that you
       cannot take down is the worst kind of dead end, and this is the only
       screen it appears on. */
    const dropPost = e.target.closest('[data-drop-post]');
    if (dropPost) {
      const id = dropPost.getAttribute('data-drop-post');
      const art = dropPost.closest('.post');
      if (!id || !sb) return;
      dropPost.disabled = true;
      dropPost.textContent = 'REMOVING…';
      sb.from('user_photos').delete().eq('id', id).then(({ error }) => {
        if (error) {
          dropPost.disabled = false; dropPost.textContent = 'REMOVE';
          note('Could not remove that photo: ' + (error.message || error.code || 'unknown'));
          return;
        }
        /* the file in the bucket stays -- same reasoning as a card photo */
        if (art) art.remove();
      });
      return;
    }
    const drop = e.target.closest('[data-drop-photo]');
    if (drop) {
      const id    = drop.getAttribute('data-drop-photo');
      const fig   = drop.closest('figure');
      const frame = drop.closest('.frame');
      if (!id || !sb) return;
      drop.disabled = true;
      /* THE ROW GOES; THE FILE IN THE BUCKET STAYS. The worker has no delete
         and is not being given one from a web page -- an orphan costs about
         a tenth of a penny a year and can be swept up later, whereas a page
         that can delete storage is a page somebody can make delete storage. */
      sb.from('card_photos').delete().eq('id', id).then(({ error }) => {
        if (error) {
          drop.disabled = false;
          note('Could not remove that photo: ' + (error.message || error.code || 'unknown'));
          return;
        }
        if (fig) fig.remove();
        if (frame) syncRail(frame);
      });
      return;
    }

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

  /* THE NAV SAYS WHO YOU ARE.
     Hamburger means guest, your face means you -- readable without opening
     anything, which was the whole complaint. Most people have no avatar set,
     so the fallback is their own initial rather than a generic silhouette:
     a letter that is THEIRS still answers "am I signed in". */
  function initialsFor(name) {
    const parts = String(name || '').trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
    if (!parts.length) return '?';
    const a = parts[0][0] || '';
    const b = parts.length > 1 ? (parts[1][0] || '') : (parts[0][1] || '');
    return (a + b).toUpperCase().slice(0, 2);
  }

  function paintNavMe() {
    const slot = document.getElementById('navme');
    const link = document.querySelector('[data-menu]');
    if (!slot || !link) return;
    if (!me) {
      slot.hidden = true; slot.innerHTML = '';
      link.classList.remove('isme');
      link.setAttribute('aria-label', 'Menu');
      return;
    }
    const mine = faces[me] || null;
    const name = (mine && mine.name) || '';
    const pic  = (mine && mine.avatar) || '';
    slot.innerHTML = pic
      /* a broken avatar URL must fall back to the initial, not to a torn
         image icon -- and the handler disarms itself first or a fallback
         that also fails re-fires it forever */
      ? `<img src="${esc(pic)}" alt="" onerror="this.onerror=null;this.parentNode.textContent='${esc(initialsFor(name))}'">`
      : esc(initialsFor(name));
    slot.hidden = false;
    link.classList.add('isme');
    link.setAttribute('aria-label', name ? ('Menu — signed in as ' + name) : 'Menu — signed in');
  }

  /* ======================================================================
     THE MENU SHEET — who you are, and the door in or out.

     The feed does not grow a sign-in form of its own. The app already has
     one on the account screen -- email, password, a username on signup, and
     Supabase's confirmation mail -- and a second implementation of that is a
     second thing to keep in step and a second thing to get wrong. So SIGN IN
     and CREATE AN ACCOUNT hand off to it. Signing OUT is a single call with
     nothing to type, so it happens right here and you stay where you were.
     ====================================================================== */
  const ICON = {
    inn:  '<svg viewBox="0 0 24 24"><path d="M14 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>',
    out:  '<svg viewBox="0 0 24 24"><path d="M10 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><path d="M17 17l5-5-5-5"/><path d="M22 12H10"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.6 6 .7-4.4 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.4 9.8l6-.7z"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
    star2:'<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.6 6 .7-4.4 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.4 9.8l6-.7z"/></svg>',
    goal: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>',
    cards:'<svg viewBox="0 0 24 24"><rect x="4" y="3" width="11" height="15" rx="2"/><path d="M8 21h9a2 2 0 0 0 2-2V8"/></svg>',
    heart:'<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.8C19 15.6 12 20 12 20z"/></svg>',
    dex:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><circle cx="12" cy="12" r="2.6"/></svg>',
    inf:  '<svg viewBox="0 0 24 24"><path d="M8.5 9.5a3.5 3.5 0 1 0 0 5c1.4-1.2 2.2-2.6 3.5-2.5 1.3-.1 2.1 1.3 3.5 2.5a3.5 3.5 0 1 0 0-5c-1.4 1.2-2.2 2.6-3.5 2.5-1.3.1-2.1-1.3-3.5-2.5z"/></svg>',
    bag:  '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>',
    clock:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></svg>',
    pin:  '<svg viewBox="0 0 24 24"><path d="M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 14.9 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.4"/></svg>',
    phone:'<svg viewBox="0 0 24 24"><path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2C11.7 19 5 12.3 4.5 5.7A2 2 0 0 1 6.5 3.5z"/></svg>'
  };

  /* IS THE REWARDS SIDE SWITCHED ON.
     dex_settings is one row Jeff owns. The row for Infinite Rewards only
     appears when he has turned it on -- a menu row leading to a page that
     is not open yet is worse than no row: somebody taps it, learns nothing,
     and trusts the next row slightly less. */
  let rewards = null;
  async function rewardsAreOn() {
    if (rewards !== null) return rewards;
    rewards = false;
    if (!sb) return rewards;
    try {
      const { data } = await sb.from('dex_settings').select('dex_on, rewards_on').eq('id', 1).maybeSingle();
      rewards = !!(data && data.dex_on && data.rewards_on);
    } catch (_) { /* not switched on, as far as anybody here can tell */ }
    return rewards;
  }

  /* MY COLLECTION IS A DOOR, NOT A PAGE. Four things live behind it and the
     bar has room for one word, so the word opens the four. Same sheet the
     menu uses, because two kinds of bottom sheet is one kind too many. */
  function mineHTML(showRewards) {
    if (!me) {
      return {
        who: `Your collection<small>Sign in to see your cards, your wish list and your Pok&eacute;dex</small>`,
        rows: `<a class="go" href="../?page=account">${ICON.inn}SIGN IN</a>`
      };
    }
    const rows = [
      `<a href="../?page=collection">${ICON.cards}MY COLLECTION</a>`,
      `<a href="../?page=collection&tab=wishlist">${ICON.heart}MY WISH LIST</a>`,
      `<a href="../?page=pokedex">${ICON.dex}MY POK&Eacute;DEX</a>`
    ];
    if (showRewards) rows.push(`<a href="../?page=dex">${ICON.inf}MY INFINITE REWARDS</a>`);
    return { who: `Your collection<small>Everything you have, in one place</small>`, rows: rows.join('') };
  }

  /* THE SHOP IS A DOOR TOO. Tapping SHOP used to leave the feed for the
     shelf, which is the one thing on the bar that took you off the page
     without asking. The four things about the shop live behind it instead:
     the shelf, and the three answers somebody actually walks in with --
     when are you open, where are you, how do I reach you.

     All four are pages the app already has. The feed does not grow its own
     hours table; a second copy of Jeff's opening times is a second copy to
     get wrong the week he changes them. */
  function shopHTML() {
    return {
      who: `Infinite Pulls<small>The shelf, and how to find us</small>`,
      rows: [
        `<a href="../?page=shop">${ICON.bag}BROWSE THE SHOP</a>`,
        `<a href="../?page=hours">${ICON.clock}HOURS</a>`,
        `<a href="../?page=location">${ICON.pin}LOCATION</a>`,
        `<a href="../?page=contact">${ICON.phone}CONTACT</a>`
      ].join('')
    };
  }

  function menuHTML() {
    const mine = me && faces[me];
    const rows = [];
    if (me) {
      rows.push(`<a href="../?page=collection">${ICON.star}MY COLLECTION</a>`);
      rows.push(`<a href="../?page=goals">${ICON.goal}COLLECTOR GOALS</a>`);
      rows.push(`<a href="../?page=account">${ICON.user}MY ACCOUNT</a>`);
    } else {
      rows.push(`<a class="go" href="../?page=account">${ICON.inn}SIGN IN</a>`);
      rows.push(`<a class="go" href="../?page=account">${ICON.star}CREATE AN ACCOUNT</a>`);
    }
    if (me) rows.push(`<button class="out" type="button" data-signout>${ICON.out}SIGN OUT</button>`);
    return {
      who: me
        ? `${esc((mine && mine.name) || 'Signed in')}<small>You are signed in</small>`
        : `Browsing as a guest<small>Sign in to follow, unfollow and write card stories</small>`,
      rows: rows.join('')
    };
  }

  /* One sheet, three contents. `kind` decides which. */
  const SHEETS = { mine: '[data-mine]', shop: '[data-shop]', menu: '[data-menu]' };

  function drawMenu(on, kind) {
    const wrap = document.getElementById('menuwrap');
    if (!wrap) return;
    if (on) {
      const m = (kind === 'mine') ? mineHTML(rewards === true)
              : (kind === 'shop') ? shopHTML()
              : menuHTML();
      document.getElementById('menuwho').innerHTML = m.who;
      document.getElementById('menurows').innerHTML = m.rows;
    }
    wrap.hidden = !on;
    document.querySelectorAll('[data-menu],[data-mine],[data-shop]').forEach(b =>
      b.setAttribute('aria-expanded', 'false'));
    if (on) {
      const b = document.querySelector(SHEETS[kind] || SHEETS.menu);
      if (b) b.setAttribute('aria-expanded', 'true');
    }
    document.body.style.overflow = on ? 'hidden' : '';
  }

  /* ======================================================================
     THE PHONE'S OWN BACK BUTTON

     A panel that covers the screen is, to the person looking at it, a place
     they went. So pressing Back has to bring them out of it -- and until now
     it took them off the page entirely, which on a phone reads as the app
     throwing you out.

     Opening one pushes a history entry; Back pops it and that is what
     closes the panel. Every other way out -- the X, the dimmed feed, Escape,
     picking a result -- goes through the same door by calling history.back()
     rather than hiding the panel itself, so there is one closing path and
     the history stack cannot drift out of step with what is on screen.
     ====================================================================== */
  let overlay = null;          /* 'menu' | 'search' | null */
  let overlayPushed = false;

  const draw = (kind, on) =>
    (kind === 'search') ? drawSearch(on) : drawMenu(on, kind);

  function showOverlay(kind, on) {
    if (on) {
      if (overlay === kind) return;
      if (overlay) draw(overlay, false);          /* only one at a time */
      draw(kind, true);
      overlay = kind;
      if (!overlayPushed) {
        history.pushState({ ipOverlay: 1 }, '', location.href);
        overlayPushed = true;
      }
      return;
    }
    if (overlay !== kind) return;
    if (overlayPushed) { history.back(); return; }  /* popstate does the closing */
    draw(kind, false);
    overlay = null;
  }

  window.addEventListener('popstate', () => {
    if (!overlay) return;        /* nothing open: let the phone go back */
    draw(overlay, false);
    overlay = null;
    overlayPushed = false;
  });

  /* Kept for anything that still says openSearch/openMenu in plain terms. */
  const openSearch = (on) => showOverlay('search', on);
  const openMenu   = (on) => showOverlay('menu', on);
  /* The rewards row is decided before the sheet is drawn, not after -- a row
     appearing a beat late is a row that moves under somebody's thumb. */
  const openMine   = async (on) => { if (on) await rewardsAreOn(); showOverlay('mine', on); };
  const openShop   = (on) => showOverlay('shop', on);
  /* CLOSE WHATEVER IS OPEN, not the one you were expecting. The X, the dimmed
     feed and Escape all used to say openMenu(false) -- which does nothing at
     all when the sheet showing is the collection one, because showOverlay
     ignores a close aimed at a kind that is not open. A sheet with no way out
     of it, reachable from the nav bar. */
  const closeSheet = () => { if (overlay && overlay !== 'search') showOverlay(overlay, false); };

  async function signOut() {
    if (!sb) return;
    try { await sb.auth.signOut(); } catch (_) { /* going anyway */ }
    me = null;
    wanted = null;
    rewards = null;
    myBadges = null;
    unfollowed.clear();
    followsLoaded = false;
    closeSheet();
    paintNavMe();
    /* Stay on the feed, as a guest. Everything public is still there; the
       things that need an account simply stop offering themselves. */
    resetFeed();
    roster = null;            /* the roster was built for the signed-in view */
    await startFeed();
    bellSay('Signed out. You are browsing as a guest.');
  }

  /* ======================================================================
     FOLLOWING

     Everybody follows everybody, so this button starts on for everyone and
     the only thing it can do is turn off. Turning it off is not a bookmark:
     that person's cards leave the feed, because a switch that appears to do
     nothing reads as broken.

     They leave straight away rather than at the next reload -- and because
     that is a big thing to happen on one tap, a strip takes their place with
     a way back. Nothing here is irreversible and nothing needs a dialog.
     ====================================================================== */
  async function writeFollow(id, on) {
    if (!sb || !me || !id) return false;
    const { error } = await sb.from('follows').upsert({
      follower_id: me, followee_id: id, following: on, changed_at: new Date().toISOString()
    }, { onConflict: 'follower_id,followee_id' });
    if (error) { note('Could not save that: ' + (error.message || 'unknown')); return false; }
    return true;
  }

  async function tapFollow(btn) {
    const id = btn.getAttribute('data-follow');
    if (!id || btn.dataset.busy) return;
    if (!me) { bellSay('Sign in to change who you follow.', 'bad'); return; }
    btn.dataset.busy = '1';
    const turningOff = following(id);
    const ok = await writeFollow(id, !turningOff);
    delete btn.dataset.busy;
    if (!ok) return;

    if (turningOff) {
      unfollowed.add(id);
      const who = (faces[id] && faces[id].name) || 'them';
      /* Everything of theirs goes, and one strip takes the place of the
         first one so the gap explains itself. */
      const theirs = [...feed.querySelectorAll('.post[data-owner="' + CSS.escape(id) + '"]')];
      if (theirs.length) {
        theirs[0].insertAdjacentHTML('beforebegin',
          /* one span, or flex treats the name and the full stop as separate
             items and pushes the full stop across the row on its own */
          `<div class="gone" data-gone="${esc(id)}"><span>Unfollowed <b>${esc(who)}</b>. You will not see their cards.</span>
             <button type="button" data-refollow="${esc(id)}">UNDO</button></div>`);
      }
      theirs.forEach(el => el.remove());
    } else {
      unfollowed.delete(id);
      feed.querySelectorAll('.follow[data-follow="' + CSS.escape(id) + '"]').forEach(b => {
        b.classList.add('on'); b.textContent = 'FOLLOWING';
      });
    }
  }

  async function tapRefollow(id) {
    if (!id) return;
    if (!(await writeFollow(id, true))) return;
    unfollowed.delete(id);
    /* Their cards were dropped from the page, and the fair way to bring them
       back is to build the feed again rather than guess where they went. */
    feed.querySelectorAll('[data-gone="' + CSS.escape(id) + '"]').forEach(el => el.remove());
    resetFeed();
    await startFeed();
  }

  /* ======================================================================
     THE BELL

     There is no inbox behind it. It is the same on/off switch for push
     notifications the rest of the app has, and the honest thing for it to do
     is look like the state it is in rather than wear a permanent unread dot
     over an empty inbox.

     It prefers the app's own push module when this page is running inside
     the app, so there is one implementation of subscribing and one place
     that knows about the VAPID key. Standing on its own in /feed-next/ it
     falls back to doing the same work directly -- with one deliberate
     limit: it will USE a service worker that is already registered but it
     will not register one. Registering the app's worker from a test folder
     would put the app's cache under a page that is not the app.
     ====================================================================== */
  const push = () => window.InfinitePullsPush || null;

  const pushable = () => 'serviceWorker' in navigator && 'PushManager' in window
                      && 'Notification' in window;

  function bellSay(msg, tone) {
    const el = document.getElementById('bellsaid');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'bell-said' + (tone ? ' ' + tone : '');
    el.hidden = !msg;
    if (msg) setTimeout(() => { if (el.textContent === msg) el.hidden = true; }, 4200);
  }

  function b64ToBytes(v) {
    const pad = '='.repeat((4 - v.length % 4) % 4);
    const raw = atob((v + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  async function reg() {
    /* ready would wait forever where nothing is registered, so ask first */
    const have = await navigator.serviceWorker.getRegistration('/');
    return have ? navigator.serviceWorker.ready : null;
  }

  /* WHAT THE ANSWER IS KEPT ON.
     "I want notifications" is a fact about a person, not about a browser, so
     it lives on the account -- profiles.price_alerts_enabled, the same column
     the price-alert job already reads. That is what makes it survive a
     refresh, and what makes a new phone already know the answer.

     The SUBSCRIPTION cannot move and there is no point pretending otherwise:
     it is an endpoint the push service hands to one browser on one device.
     What lives on the account is the ANSWER; what lives on the device is the
     plumbing. When the two disagree -- you said yes, but this browser has no
     subscription -- the plumbing is quietly rebuilt, without asking again,
     because permission was already given.

     Signed out there is no account to ask, so the browser is the only thing
     that knows and it is asked directly. */
  let wanted = null;          /* the account's answer, once we have it */

  async function readWanted() {
    if (!sb || !me) return null;
    try {
      const { data, error } = await sb.from('profiles')
        .select('price_alerts_enabled').eq('id', me).limit(1);
      if (error || !data || !data[0]) return null;
      return data[0].price_alerts_enabled === true;
    } catch (_) { return null; }
  }

  async function writeWanted(on) {
    if (!sb || !me) return false;
    try {
      const { error } = await sb.from('profiles')
        .update({ price_alerts_enabled: on }).eq('id', me);
      if (error) { note('Could not save that: ' + (error.message || 'unknown')); return false; }
      wanted = on;
      return true;
    } catch (_) { return false; }
  }

  async function deviceOn() {
    const P = push();
    if (P) { try { return await P.isSubscribed(); } catch (_) { return false; } }
    if (!pushable()) return false;
    try {
      const r = await reg();
      if (!r) return false;
      return !!(await r.pushManager.getSubscription());
    } catch (_) { return false; }
  }

  async function isOn() {
    if (me) {
      if (wanted === null) wanted = await readWanted();
      if (wanted !== null) return wanted;
    }
    return deviceOn();
  }

  async function turnOn() {
    const P = push();
    if (P) return !!(await P.subscribe());
    if (!pushable() || !sb) return false;
    if ((await Notification.requestPermission()) !== 'granted') return false;
    const r = await reg();
    if (!r) return 'no-worker';
    let sub = await r.pushManager.getSubscription();
    if (!sub) {
      const key = cfg.VAPID_PUBLIC_KEY;
      if (!key) return 'no-key';
      sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    }
    const j = sub.toJSON();
    const { data } = await sb.auth.getSession();
    /* through the same function the app uses -- it runs as the table owner,
       so an anonymous device can be written down without being given read
       access back */
    const { error } = await sb.rpc('save_push_subscription', {
      p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth,
      p_user_id: (data && data.session && data.session.user && data.session.user.id) || null
    });
    if (error) { note('Could not save the subscription: ' + (error.message || 'unknown')); return false; }
    return true;
  }

  async function turnOff() {
    const P = push();
    if (P) { try { await P.unsubscribe(); return true; } catch (_) { return false; } }
    try {
      const r = await reg();
      const sub = r && await r.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      return true;
    } catch (_) { return false; }
  }

  async function paintBell() {
    const el = document.getElementById('bell');
    if (!el) return;
    if (!pushable()) {
      el.disabled = true;
      el.setAttribute('aria-label', 'Notifications are not available in this browser');
      return;
    }
    if (('Notification' in window) && Notification.permission === 'denied') {
      el.disabled = true;
      el.classList.remove('on');
      el.setAttribute('aria-label', 'Notifications are blocked in your phone settings');
      return;
    }
    const on = await isOn();
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', String(on));
    el.setAttribute('aria-label', on ? 'Notifications are on. Turn them off.'
                                     : 'Notifications are off. Turn them on.');
  }

  /* The account said yes but this browser has nothing set up -- which is what
     a new phone looks like, and what a browser whose service worker was wiped
     looks like. Permission is already granted, so this needs no prompt and
     nobody is asked a question they have answered. */
  async function healDevice() {
    if (!me || wanted === null || !pushable()) return;
    const on = await deviceOn();
    if (wanted === true) {
      if (on || Notification.permission !== 'granted') return;
      try { await turnOn(); } catch (_) { /* it can try again next visit */ }
      return;
    }
    /* AND THE OTHER WAY. If the account says no and this browser is still
       signed up, the bell would read off while notifications kept arriving --
       a switch that lies about which way it is pointing. One switch has to
       mean one thing, so the device is brought into line with the answer. */
    if (on) { try { await turnOff(); } catch (_) {} }
  }

  async function tapBell() {
    const el = document.getElementById('bell');
    if (!el || el.disabled || el.dataset.busy) return;
    el.dataset.busy = '1';
    try {
      if (await isOn()) {
        await turnOff();
        if (me) await writeWanted(false);
        bellSay('Notifications off.');
      } else {
        const r = await turnOn();
        if (r === true && me) await writeWanted(true);
        if (r === true) bellSay('Notifications on. Price drops and your grail card.', 'good');
        else if (r === 'no-worker') bellSay('Open the main app once, then try again.', 'bad');
        else if (r === 'no-key') bellSay('Notifications are not set up on this site yet.', 'bad');
        else if (('Notification' in window) && Notification.permission === 'denied')
          bellSay('Blocked in your phone settings.', 'bad');
        else bellSay('That did not work. Try again in a moment.', 'bad');
      }
    } catch (e) {
      note('Bell failed: ' + ((e && e.message) || 'unknown'));
      bellSay('That did not work. Try again in a moment.', 'bad');
    }
    delete el.dataset.busy;
    await paintBell();
  }

  /* ======================================================================
     THE HOME PAGE, MOVED IN A PIECE AT A TIME

     Rather than a home page with rails on it and a feed somewhere else,
     the rails come to the feed and arrive where somebody has earned them:
     ten cards in, and twenty cards in. A person who scrolls gets more of
     the shop; a person who does not is not made to scroll past it first.

     They render here rather than borrowing the app's own rail components.
     Those read app.js's page state and paint into page-sized containers;
     this page has neither. What they share is the DATA -- the same
     store_info row and the same top_movers RPC -- so there is one source
     of truth and two ways of drawing it.

     Each one is fetched the first time it is about to be needed, not on
     load. A rail nobody scrolls to costs nothing.
     ====================================================================== */
  const RAILS = [
    { at: 10, key: 'videos', build: videoRail },
    { at: 20, key: 'movers', build: moversRail }
  ];
  const railDone = new Set();

  const ytId = (v) => {
    const raw = String((v && (v.url || v.id || v)) || '');
    const m = raw.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(raw) ? raw : '');
  };

  async function videoRail() {
    if (!sb) return '';
    let list = [];
    try {
      const { data, error } = await sb.from('store_info').select('data').eq('id', 1).maybeSingle();
      if (error) { note('Could not read the videos: ' + (error.message || 'unknown')); return ''; }
      const raw = (data && data.data && Array.isArray(data.data.videos)) ? data.data.videos : [];
      list = raw.map(v => ({ id: ytId(v), title: (v && v.title) || '' })).filter(v => v.id).slice(0, 5);
    } catch (_) { return ''; }
    if (!list.length) return '';            /* invisible until there is something */
    return `<section class="rail-block" data-rail="videos">
      <h2>How it works</h2>
      <div class="rail">
        ${list.map(v => `
          <button class="rail-video" type="button" data-video="${esc(v.id)}"
                  aria-label="Play${v.title ? ' ' + esc(v.title) : ' video'}">
            <span class="rail-thumb">
              <img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy" decoding="async">
              <span class="rail-play" aria-hidden="true">&#9654;</span>
            </span>
            ${v.title ? `<span class="rail-cap">${esc(v.title)}</span>` : ''}
          </button>`).join('')}
      </div>
    </section>`;
  }

  async function moversRail() {
    if (!sb) return '';
    let up = [], down = [];
    try {
      const [a, b] = await Promise.all([
        sb.rpc('top_movers', { p_direction: 'up',   p_limit: 6, p_days: 7 }),
        sb.rpc('top_movers', { p_direction: 'down', p_limit: 6, p_days: 7 })
      ]);
      if (a.error || b.error) { note('Could not read the movers: ' + ((a.error || b.error).message || 'unknown')); return ''; }
      up = a.data || []; down = b.data || [];
    } catch (_) { return ''; }
    const rows = [...up, ...down];
    if (!rows.length) return '';
    const card = (r) => {
      const pct = Number(r.pct) || 0;
      const dir = pct >= 0 ? 'up' : 'down';
      const shown = Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.round(Math.abs(pct) * 10) / 10;
      return `<a class="rail-mover" href="../?page=lookup&q=${encodeURIComponent(r.number || r.name || '')}">
        <span class="rail-art">${r.image_base
          ? `<img src="${esc(r.image_base)}/low.webp" alt="" loading="lazy" decoding="async">`
          : ''}</span>
        <strong>${esc(r.name || 'Card')}</strong>
        <span class="rail-move is-${dir}">${dir === 'up' ? '&#9650;' : '&#9660;'} ${shown}%</span>
        <small>${esc(money(r.then_price))} &rarr; ${esc(money(r.now_price))}</small>
      </a>`;
    };
    return `<section class="rail-block" data-rail="movers">
      <h2>Movers &amp; Shakers</h2>
      <div class="rail">${rows.map(card).join('')}</div>
      <a class="rail-more" href="../?page=movers">See the whole board</a>
    </section>`;
  }

  /* A thumbnail that will not load takes its video with it -- and if that
     empties the rail, the heading goes too. A blocked i.ytimg (plenty of ad
     blockers do) would otherwise leave HOW IT WORKS sitting over nothing.
     Listened for in the capture phase, because error events do not bubble. */
  feed.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    const vid = img.closest('.rail-video');
    if (!vid) return;
    const block = vid.closest('.rail-block');
    vid.remove();
    if (block && !block.querySelector('.rail-video')) block.remove();
  }, true);

  /* Put each rail in once, after the card it belongs behind. Called after
     every batch, so a rail that was not reachable last time gets its turn
     when the feed grows past it. */
  async function placeRails() {
    if (filter) return;            /* a filtered feed is an answer, not a homepage */
    const posts = [...feed.querySelectorAll('.post:not(.tutorial)')];
    for (const r of RAILS) {
      if (railDone.has(r.key) || posts.length < r.at) continue;
      railDone.add(r.key);         /* claimed before the await, so two batches cannot both build it */
      let html = '';
      try { html = await r.build(); } catch (_) { html = ''; }
      if (!html) continue;
      /* the strip rides in above the videos, the way he asked */
      if (r.key === 'videos') html = (await buildMyBadges()) + html;
      const after = posts[r.at - 1];
      if (after && after.isConnected) after.insertAdjacentHTML('afterend', html);
    }
  }

  /* ======================================================================
     YOUR BADGES, AT THE TOP OF YOUR OWN FEED

     THE EXPENSIVE PART IS SKIPPED, ON PURPOSE. The profile page works these
     out with buildContext(), which loads the whole national species list
     from PokeAPI -- a third-party call for a thousand Pokemon. It needs
     that, because a Pokedex goal cannot be judged without it. The five
     badges that earn themselves cannot: Gem Mint Ten, Grade Ladder,
     Monthly Momentum, Yearlong Collector and Value Milestone read your
     cards and your collection value and nothing else. So the context is
     built here from those two things and handed in, and the species list is
     never fetched. The CALCULATORS are still the app's own -- one set of
     rules about what counts as earned, two ways of feeding it.

     The three picked goals are not computed at all: whether they are
     finished is already written down in user_collector_goals, so it is
     read rather than worked out.
     ====================================================================== */
  let myBadges = null;          /* the markup, worked out once */

  async function goalsEngine() {
    if (window.InfinitePullsCollectorGoals) return window.InfinitePullsCollectorGoals;
    if (!sb) return null;
    /* the engine looks for the shared client under this name */
    if (!window.InfinitePullsSupabase) window.InfinitePullsSupabase = { client: sb, ready: true };
    try {
      await new Promise((ok, no) => {
        const el = document.createElement('script');
        el.src = '../components/collector-goals-data.js';
        el.onload = ok; el.onerror = () => no(new Error('could not load'));
        document.head.appendChild(el);
      });
    } catch (_) { return null; }
    return window.InfinitePullsCollectorGoals || null;
  }

  async function buildMyBadges() {
    if (myBadges !== null) return myBadges;
    myBadges = '';
    if (!sb || !me) return myBadges;
    const G = await goalsEngine();
    if (!G) return myBadges;
    try {
      const [cards, prof] = await Promise.all([
        sb.from('user_cards')
          .select('id, card_id, card_name, set_name, variant, condition, quantity, added_at')
          .eq('user_id', me),
        sb.from('profiles').select('collection_value').eq('id', me).maybeSingle()
      ]);
      if (cards.error) { note('Could not read your cards for badges: ' + (cards.error.message || 'unknown')); return myBadges; }
      const ctx = {
        userId: me,
        ownedRows: cards.data || [],
        collectionValue: Number(prof && prof.data && prof.data.collection_value) || 0,
        allSpecies: [], discoveredMap: {}      /* not needed by the automatic five */
      };
      const auto = await G.computeAutoProgress(me, ctx);

      /* THE PICKED GOALS ARE ONLY HERE ONCE THEY ARE FINISHED, and that is
         not laziness. Judging how far along a Set Complete or a Regional
         Pokedex is means fetching a set's card count or the whole species
         list -- the very network calls this strip exists to avoid. Finished
         is already written down in the row, so it costs nothing to know.
         A picked goal still in progress has a proper bar on the Goals page,
         where somebody has asked to look at goals. */
      const picked = await G.loadUserGoals(me);
      const done = (picked || [])
        .filter(r => r && r.completed_at && r.template)
        .map(r => ({ eff: G.effectiveGoal(r), progress: { complete: true, pct: 100 } }));

      /* Earned first, then whatever is closest. The strip leads with what
         somebody has done and then shows them the next one within reach. */
      const all = [...done, ...auto].sort((a, b) => {
        const ad = a.progress && a.progress.complete ? 1 : 0;
        const bd = b.progress && b.progress.complete ? 1 : 0;
        if (ad !== bd) return bd - ad;
        return ((b.progress && b.progress.pct) || 0) - ((a.progress && a.progress.pct) || 0);
      });
      if (!all.length) return myBadges;

      myBadges = `<div class="mybadges" data-mybadges>
        ${all.map(r => {
          const pr = r.progress || {};
          const on = !!pr.complete;
          const art = r.eff && r.eff.badgeImage;
          const url = art && !/^(https?:)?\/\//.test(art) ? '/' + String(art).replace(/^\/+/, '') : art;
          const pct = Math.max(0, Math.min(100, Math.round(pr.pct || 0)));
          /* "8 / 25" says more than "32%" for a thing you are collecting,
             so the calculator's own wording is used where it has one. */
          const label = pr.primaryLabel || (pct + '%');
          return `<a class="mb${on ? ' is-on' : ''}" href="../?page=goals"
                     aria-label="${esc((r.eff && r.eff.name) || 'Badge')}${on ? ', earned' : ', ' + esc(label)}">
            ${url ? `<img src="${esc(url)}" alt="" width="64" height="64" loading="lazy" decoding="async">`
                  : `<span class="mb-emoji">${esc((r.eff && r.eff.icon) || '\u{1F3C6}')}</span>`}
            <strong>${esc((r.eff && r.eff.name) || 'Badge')}</strong>
            ${on ? '' : `<span class="mb-bar"><span style="width:${pct}%"></span></span>
                         <small>${esc(label)}</small>`}
          </a>`;
        }).join('')}
      </div>`;
    } catch (e) {
      note('Could not work out your badges: ' + ((e && e.message) || 'unknown'));
    }
    return myBadges;
  }

  /* Once at the very top, once again above the videos. Twice is on purpose:
     the second one is where somebody has been scrolling long enough to have
     forgotten the first. */
  async function placeMyBadges() {
    if (filter || !me) return;
    const html = await buildMyBadges();
    if (!html) return;
    if (!feed.querySelector('[data-mybadges]')) feed.insertAdjacentHTML('afterbegin', html);
  }

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
    placeMyBadges();
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
    if (sb) { await whoAmI(); paintNavMe(); settleBell(); await loadFollows(); }
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

  function drawSearch(on) {
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
      const mw = document.getElementById('menuwrap');
      if (mw && !mw.hidden) { closeSheet(); return; }
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
    const mineBtn = e.target.closest('[data-mine]');
    if (mineBtn) { e.preventDefault(); openMine(true); return; }
    const shopBtn = e.target.closest('[data-shop]');
    if (shopBtn) { e.preventDefault(); openShop(true); return; }
    const menu = e.target.closest('[data-menu]');
    if (menu) { e.preventDefault(); openMenu(true); return; }
    if (e.target.closest('[data-menu-close]')) { closeSheet(); return; }
    if (e.target.closest('[data-signout]')) { signOut(); return; }
    const person = e.target.closest('[data-open-person]');
    if (person) {
      openSearch(false);
      window.scrollTo(0, 0);
      setFilter({ kind: 'person', id: person.getAttribute('data-open-person'),
                  label: person.getAttribute('data-open-label') || 'them' });
      return;
    }
    const fol = e.target.closest('[data-follow]');
    if (fol) { tapFollow(fol); return; }
    const undo = e.target.closest('[data-refollow]');
    if (undo) { tapRefollow(undo.getAttribute('data-refollow')); return; }
    /* A thumbnail becomes the real player only when somebody asks for it --
       five YouTube iframes on a feed is a few hundred KB and a pile of
       third-party cookies for videos most people never play. */
    const vid = e.target.closest('[data-video]');
    if (vid) {
      const id = vid.getAttribute('data-video');
      const box = document.createElement('div');
      box.className = 'rail-video is-playing';
      box.innerHTML = `<span class="rail-thumb"><iframe src="https://www.youtube-nocookie.com/embed/${esc(id)}?autoplay=1&rel=0"
        title="Video" frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen></iframe></span>`;
      vid.replaceWith(box);
      return;
    }
    if (e.target.closest('[data-bell]')) { tapBell(); return; }
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
    paintBell();
  }

  /* Once we know who is looking, the account's answer is the one that counts,
     so the bell is painted again -- and a device that has fallen behind that
     answer is put right. */
  async function settleBell() {
    if (!me) return;
    wanted = await readWanted();
    await healDevice();
    await paintBell();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { stamp(); start(); });
  else { stamp(); start(); }
})();
