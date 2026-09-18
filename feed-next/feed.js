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
  /* WHAT PEOPLE SEE, AND WHAT IS ACTUALLY RUNNING, are two different
     numbers now and both are worth having. RELEASE is the one on the screen
     -- the design people are looking at. BUILD carries on counting every
     time this file ships, because "your browser is on v28, not v29" has
     already explained one bug this month that otherwise looked like a
     broken feature. It rides in the title attribute, so it costs nothing on
     screen and is one tap away when somebody needs it. */
  const RELEASE = 'v2.1';
  const BUILD = 'v48';

  const PAGE = 8;                     // posts per fetch
  /* ONE NAME, IN ONE PLACE. It is the shop's display name, the key its posts
     queue under (enqueue falls back to `who` when there is no owner), and
     what the chip says when the feed is narrowed to the shelf. Three things
     that have to agree, so they are one constant rather than three strings
     that drifted apart the first time somebody renamed the store. */
  const SHOP_WHO = 'Infinite Pulls';

  /* THE STORE POSTS AS AN ACCOUNT, AND THAT ACCOUNT IS THE STORE.
     The shelf has no account behind it -- its rows come off shop_available
     -- but a PICTURE cannot come off a shelf. Somebody has to be signed in
     to post one, so the store has a login of its own, and Hyde-Bot uses it.

     Without this the store's own poster arrived in the feed as an ordinary
     collector with a made-up-looking handle, sitting next to a FOLLOW
     button, which is precisely the thing a shop post is not. One id in
     config.js turns those posts back into the shop: the shop's name, a tap
     that lands on the shelf, and no follow.

     Empty is a perfectly good answer -- the posts just read as a collector
     again, which is what they did before. */
  /* READ OFF window, NOT off `cfg`. `cfg` is declared two hundred lines
     below this one, and a `const` cannot be read before its own line runs --
     so reaching for it here threw "Cannot access 'cfg' before
     initialization" at load and took the ENTIRE feed down with it, because
     everything in this file lives inside one function. config.js is a
     plain script tag ahead of this one, so its object is already on window
     by now and there is nothing to wait for. */
  const STORE_ID = String((window.InfinitePullsConfig || {}).STORE_USER_ID || '');
  const isStore  = (id) => !!STORE_ID && id === STORE_ID;

  /* The shop's newest poster is drawn above the feed and must not also be
     dealt into it. Declared HERE, beside the id it belongs to, because
     enqueue() reads it and enqueue() lives far above the code that sets it
     -- a `let` further down the file would be a trap waiting for whoever
     moves a call earlier. */
  const SHOP_PIN_DAYS = 7;
  let shopPinId = null;

  /* FINISH IS THE FIELD THAT MOVES THE MONEY, and it was being thrown away.
     `variant` has been in the feed's select list the whole time and cardRow
     dropped it on the floor, so a Reverse Holofoil and a plain Normal of the
     same card looked identical in the feed -- which is exactly the pair of
     cards a collector most needs told apart.

     Same labels the collection uses. Deliberately the same strings: two
     screens naming one property differently is how somebody ends up thinking
     they own two versions of a card. */
  const VARIANT_LABELS = {
    'normal': 'Normal',
    'holofoil': 'Holofoil',
    'reverse-holofoil': 'Reverse Holofoil',
    '1st-edition': '1st Edition',
    '1st-edition-holofoil': '1st Edition Holofoil',
    'unlimited': 'Unlimited',
    'unlimited-holofoil': 'Unlimited Holofoil'
  };
  const finishOf = (v) => {
    const k = String(v || '').trim().toLowerCase();
    if (!k) return '';
    return VARIANT_LABELS[k] || k.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  /* OPEN UNTIL SOMEBODY SAYS OTHERWISE, AND THEN SHUT FOR GOOD.
     Open by default so nothing is hidden from a first-time reader -- SOLD
     LISTINGS is the most useful button on a card post and burying it behind
     a tap most people never make would have cost more than the space it
     saves. Closing it once closes it on every card from then on, so anybody
     who wants the tighter feed gets it by asking once instead of on every
     post. Same drawer the HEAT marks already live in, which means it follows
     THE PHONE, not the login -- a deliberate trade: no column, no write on
     every tap, and a fold-open preference is not worth a round trip. */
  /* ---- COMMENTS ---------------------------------------------------------
     TEN OF THEM, AND THEY DO NOT MOVE. Six or seven fit across a phone and
     the rest are one swipe right. In the same order every time, because a
     row that reshuffles is a row nobody's thumb ever learns -- the whole
     point of a one-tap comment is not having to read it first. */
  const QUICK = [
    'Nice! \u{1F64C}', 'Heat! \u{1F525}', 'Great pull!', 'Need it! \u{1F440}',
    'Huge hit!', 'Love this! \u2764\uFE0F', 'Binder worthy!', 'What a pull!',
    'Congrats! \u{1F389}', "That's clean! \u2728"
  ];

  /* THE SAME RULE THE DATABASE ENFORCES, kept here only so somebody is told
     BEFORE the round trip rather than after it. The database's copy is the
     one that matters -- this file is one client of a public API and anybody
     can post a comment without it. If the two ever disagree, the database
     wins and the person sees its message instead of this one, which is the
     right way round for the two to fail. */
  const LINKY = /(https?:\/\/|www\.)/i;
  const DOMAIN = /[a-z0-9][a-z0-9-]*\.(com|net|org|io|co|me|gg|shop|store|xyz|info|biz|us|uk|ca|ru|cn|link|live|app|site|online|ee|ly|to|cc|tv|bio|page|click|top|vip|tk|gl|gd)([/?#]|\s|$)/i;
  const SLASHED = /[a-z0-9][a-z0-9-]*\.[a-z]{2,10}\//i;
  const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  const DRESSED = /\(\s*at\s*\)|\[\s*at\s*\]|\sat\s+[a-z0-9-]+\s+dot\s|\sdot\s+(com|net|org|io|co|me)\b/i;
  const PHONEISH = /\+?[0-9][0-9 ().+-]{5,}[0-9]/;

  function contactTrouble(text) {
    const t = String(text || '');
    /* EMAIL IS CHECKED FIRST because an address contains a domain --
       "scammer@gmail.com" matches the bare-domain rule too, and whichever
       runs first decides what the person is told. Both refuse it; only one
       of them tells them the truth about why. */
    if (EMAIL.test(t) || DRESSED.test(t)) return 'Comments cannot contain email addresses.';
    if (LINKY.test(t) || DOMAIN.test(t) || SLASHED.test(t)) return 'Comments cannot contain links.';
    const run = t.match(PHONEISH);
    if (run && run[0].replace(/[^0-9]/g, '').length >= 7) return 'Comments cannot contain phone numbers.';
    return '';
  }

  /* Open threads, their loaded comments, and the reply somebody is aiming at.
     Keyed by post so scrolling away and back does not lose the place. */
  /* READ AT LOAD, NOT WHEN IT IS WANTED. pinnedPost() rewrites the address
     to the post's pretty permalink with history.replaceState -- which is the
     right thing for the address bar and for sharing, and it takes ?talk=1
     with it. Asking location.search later therefore found nothing, and
     somebody coming back from signing in landed on their post with the
     comments still shut. Captured here, before anything can rewrite it. */
  /* WHOSE FEED, IF THIS IS SOMEBODY'S. infinitepulls.com/tacomike417 is a
     person's feed now, and 404.html hands it here as ?who=tacomike417 --
     GitHub Pages has no server to route a clean path, so the clean path is
     something this page puts BACK once it knows who it is looking at.

     Read at load for the same reason ?talk= is: pinnedPost() rewrites the
     address with replaceState, and anything read later is reading whatever
     the address was rewritten to. */
  const WANTS_WHO = (() => {
    try {
      const w = new URLSearchParams(location.search).get('who') || '';
      return /^[A-Za-z0-9_-]{3,24}$/.test(w) ? w : '';
    } catch (_) { return ''; }
  })();

  const WANTS_TALK = (() => {
    try { return new URLSearchParams(location.search).get('talk') === '1'; }
    catch (_) { return false; }
  })();

  const talkOpen = new Set();
  const talkRows = new Map();      /* postKey -> [comment, ...] */
  const talkCount = new Map();     /* postKey -> number on the icon */
  const talkReply = new Map();     /* postKey -> parent comment id */
  const myHearts = new Set();      /* comment ids this person has hearted */
  let staff = false;               /* is this Jeff or Mike */

  /* ---- THE BADGE ---------------------------------------------------------
     INFINITE ORIGINAL 2026, and what it does NOT mean is the important part:
     nobody has been checked. It says the account existed before 2027 and
     nothing else, which is why it is not called Verified anywhere in here.
     In a place where people mail each other four-hundred-dollar cards, a
     gold star that reads as "the shop vouches for this person" is a liability
     dressed as a feature.

     One function, because it appears beside a name in six different places
     and six copies of an <img> tag is six chances for one of them to end up
     a different size, a different title, or missing its alt text. */
  /* ---- RIBBONS ---------------------------------------------------------
     Two marks, both earned by holding cards rather than by anything stored:

       HALF   25 reward cards
       WHOLE  51/50 in hand -- the entire set

     Worked out from the ledger by reward_marks(), so they can never say
     something the cards do not. Both are shown when both are held: somebody
     who finished has passed 25 as well, and hiding the first one would make
     the row change shape at exactly the moment it should be busiest. */
  const marks = {};              /* user_id -> { cards, secret } */

  const RIBBON = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="8.6" r="5.4"/>' +
    '<path d="M8.4 13.1 6.2 21.4l5.8-3.1 5.8 3.1-2.2-8.3"/></svg>';

  function ribbonsOf(id) {
    const m = id && marks[id];
    if (!m) return '';
    let out = '';
    if (m.cards >= 25) {
      out += `<span class="rb rb--half" title="Half the set — 25 reward cards"
                    role="img" aria-label="25 reward cards">${RIBBON}</span>`;
    }
    if (m.secret) {
      out += `<span class="rb rb--whole" title="The whole set — 51/50"
                    role="img" aria-label="The whole set">${RIBBON}</span>`;
    }
    return out;
  }

  const badgeOf = (who) => {
    const b = (who && who.badge)
      ? `<img class="vb" src="../assets/badge-original-2026.webp" alt="Infinite Original 2026"
              title="Infinite Original 2026 — joined before 2027" width="15" height="15"
              loading="lazy" decoding="async">`
      : '';
    return b + ribbonsOf(who && who.id);
  };

  /* The ribbons for a batch of people, in one round trip. Asked for at the
     same moment as their names, because a mark that arrives a beat after the
     name it belongs to moves the row under somebody's thumb. */
  const marksAsked = new Set();
  /* IN-FLIGHT ASKS ARE SHARED. The posts can ask for an id while the
     profile card is still loading; the card's ask used to see "already
     asked" and return at once, before the answer landed -- so REWARDS drew
     a dash. Now a second ask waits on the first one's promise. */
  const marksPending = new Map();
  async function marksFor(ids) {
    if (!sb) return;
    const all = (ids || []).filter(Boolean);
    const want = all.filter(id => !marksAsked.has(id));
    const waits = all.filter(id => marksPending.has(id)).map(id => marksPending.get(id));
    if (want.length) {
      want.forEach(id => marksAsked.add(id));
      const job = (async () => {
        try {
          const { data, error } = await sb.rpc('reward_marks', { p_ids: want });
          if (error) throw error;
          (data || []).forEach(r => { marks[r.user_id] = { cards: r.cards, secret: !!r.has_secret }; });
          /* No row back means no reward cards yet -- that is 0/50, not a dash. */
          want.forEach(id => { if (!marks[id]) marks[id] = { cards: 0, secret: false }; });
        } catch (e) {
          console.warn('[feed] reward_marks failed', e);
          /* No ribbons is a page that still works. Let them be asked for again
             later rather than pretending the answer was "none". */
          want.forEach(id => marksAsked.delete(id));
        } finally {
          want.forEach(id => marksPending.delete(id));
        }
      })();
      want.forEach(id => marksPending.set(id, job));
      waits.push(job);
    }
    await Promise.all(waits);
  }

  /* The tagline rides with the name in the feed but NOT in a comment thread.
     It is one line under a post; repeated down twenty comments it is twenty
     billboards in a conversation, and the thing being read stops being what
     anybody said. */
  /* IT GETS THE LINE UNDER THE NAME, which is where it was asked to go and
     also the only place it fits. Beside the name it was sharing a row with
     the name, the badge and the FOLLOW button, and at 393px a sixty-
     character line had about forty pixels -- "Raw hunter, no sl".

     It takes that line FROM the post's own subtitle, and on a card post
     nothing is lost by that: the subtitle is the set, and the set is
     already in the caption directly below the picture and again in CARD
     PULSE. On a photo post it replaces the date, which is the one real
     cost and is bought back by the order of the feed itself. */
  const subLine = (p, fallback) => {
    const who = faces[p.userId];
    return (who && who.badge && who.tagline)
      ? `<small class="tline">${esc(who.tagline)}</small>`
      : `<small>${esc(fallback)}</small>`;
  };

  const PULSE_KEY = 'infinite-pulls-feed-pulse-shut';
  const pulseShut = () => {
    try { return localStorage.getItem(PULSE_KEY) === '1'; } catch (_) { return false; }
  };
  const setPulseShut = (on) => {
    try { localStorage.setItem(PULSE_KEY, on ? '1' : '0'); } catch (_) {}
  };
  /* ip-feed-marks IS GONE. It held heat and the wishlist on one phone;
     both are database rows now, and a dead store that still looks live is
     how somebody wires a new feature to the wrong place a year from now.
     Anything left in that key on somebody's phone is simply ignored. */

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
    if (!me) { staff = false; return; }
    /* Asked here rather than on the first REMOVE button, so the buttons are
       right the first time they are drawn instead of appearing a moment
       after somebody has already decided the app cannot do it. */
    loadStaff();
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
    paintNotes();
  }

  /* PUT THEM BACK IF THE FEED WAS REDRAWN UNDER THEM.
     startFeed() rewrites the whole feed, and anything that went wrong while
     it was working that out -- reading the post somebody followed a link to,
     for one -- had already prepended its warning to the element about to be
     replaced. The message was raised, recorded, and then thrown away a
     moment later, which is the same as never having said it. Rebuilt from
     the list rather than appended to, so calling this twice cannot double
     anything up. */
  function paintNotes() {
    if (!DEBUG || !feed || !notes.length) return;
    let box = document.getElementById('feed-notes');
    if (!box) {
      box = document.createElement('div');
      box.id = 'feed-notes'; box.className = 'msg';
      box.style.cssText = 'text-align:left;border-bottom:1px solid var(--line)';
      feed.prepend(box);
    }
    box.innerHTML = notes.map(m => '<div>&#9888; ' + m.replace(/[<>&]/g, '') + '</div>').join('');
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
    shop:'<svg viewBox="0 0 24 24"><path d="M2.5 3.5h2.3l2.6 11.3h9.9"/><path d="M6.3 6.6h14.2l-1.8 6.6H7.8"/><circle cx="9.5" cy="19.3" r="1.5"/><circle cx="17.5" cy="19.3" r="1.5"/></svg>',
    plus:'<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    stack:'<svg viewBox="0 0 24 24"><rect x="4" y="3" width="11" height="15" rx="2"/><path d="M8 21h9a2 2 0 0 0 2-2V8"/></svg>',
    menu:'<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    flip:'<svg viewBox="0 0 24 24"><path d="M4 9a8 8 0 0 1 13-3l3 3"/><path d="M20 4v5h-5"/><path d="M20 15a8 8 0 0 1-13 3l-3-3"/><path d="M4 20v-5h5"/></svg>',
    cal:'<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>',
    coin:'<svg viewBox="0 0 24 24"><ellipse cx="12" cy="7" rx="7.5" ry="3.2"/><path d="M4.5 7v10c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2V7"/><path d="M4.5 12c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2"/></svg>',
    trend:'<svg viewBox="0 0 24 24"><path d="M4 17l6-6 4 4 6-7"/><path d="M15 8h5v5"/></svg>',
    quill:'<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 13a4 4 0 0 0 5.7.4l3-3A4 4 0 0 0 13 4.7l-1.7 1.7"/><path d="M14 11a4 4 0 0 0-5.7-.4l-3 3A4 4 0 0 0 11 19.3l1.7-1.7"/></svg>',
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
  /* ---- HOW HOT IS IT ------------------------------------------------------
     Three steps, and the middle one is the one that matters: past twenty
     marks the drawn flame gives way to the actual fire emoji. A card that
     everybody is marking should not look like a card nobody is -- and the
     jump has to be a jump, not a slightly brighter shade of the same
     picture, or nobody ever notices it happened.

     Fifty does not change the picture again. Another emoji on top would
     read as clutter; it gets a hotter ring and its number in gold instead,
     which is the difference between "this is doing well" and "look at
     this" without adding a single thing to the screen. */
  const HOT = 20, BLAZING = 50;
  const heatLevel = (n) => (n >= BLAZING ? 3 : n >= HOT ? 2 : 1);
  /* The emoji is a real character, not a picture of one: it is what people
     mean by the fire emoji, and it is whatever their own phone draws. */
  const heatMark = (lvl) => (lvl > 1 ? '<i class="emoji" aria-hidden="true">&#128293;</i>' : I.flame);

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

  /* ---- WHERE THE THREE PILLS GO ------------------------------------------
     All three were buttons with no handler at all: a row of things that
     looked tappable and did nothing. They are anchors now rather than
     buttons, which costs nothing and buys a long-press, an open-in-new-tab
     and a destination somebody can see before they commit to it.

     LOOK UP hands the name to the app's own card lookup -- the same screen
     the scanner lands on -- rather than growing a second search in here.

     SOLD LISTINGS is the honest one. What a card is WORTH is what one just
     sold for, and eBay's completed-listings search is where that lives. The
     set name goes in the query because "Charizard" alone returns four
     hundred different cards; LH_Sold and LH_Complete are what turn a list of
     asking prices into a list of real ones.

     CARD DETAILS is the owner's own page for that card --
     infinitepulls.com/<them>/collection/<slug> -- which already exists and
     is already shareable. The slug is the card's name plus a chunk of the
     row id, and it is built the same way components/profile.js builds it:
     if these two ever disagree the link 404s, so it is copied rather than
     approximated. */
  /* WHAT A SHARE OF THIS POST SHOULD OPEN.
     A collection card and a photo post each have their own address and that
     is the answer. A SHOP post has no post address -- it is a row on the
     shelf, not something somebody posted -- and until v34 that did not
     matter, because shop posts could not reach the feed to be shared. Now
     they can, and with nothing here the share handler fell back to
     location.href: the top of the feed, showing somebody else's cards. That
     is the exact fault the permalinks were built to fix, arriving by a side
     door. The shelf page for that card is the honest destination -- a real
     page, about the card in the picture, with the price and the buy button
     on it. Built absolute: a share leaves this page, so a relative address
     is no address at all. */
  function shareLink(p) {
    if (!p) return '';
    if (p.kind === 'shop') {
      return p.key ? location.origin + '/?page=item&id=' + encodeURIComponent(p.key) : '';
    }
    /* An r- key has no static post page -- build-post-pages.mjs writes c-
       and p- only -- so a reward post links to the collector's page, which
       is real, and the share sheet carries the picture. */
    if (p.kind === 'reward') return rewardShareUrl(p);
    return p.rowId ? permalink(p) : '';
  }

  /* THE SLUG IS A CONTRACT WITH TWO OTHER FILES and it is character-for-
     character the same in all three: here, components/profile.js (which
     renders this page in the app) and tools/build-collection-pages.mjs
     (which writes the static one). Change the rule in one and every link
     the feed draws points at a page that does not exist. Card name, forty
     characters of it, plus eight characters of the row id -- readable, and
     still unique when somebody owns the same card twice. */
  const slugify = (t) => String(t).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'card';

  const cardSlug = (name, id) =>
    slugify(name) + '-' + String(id || '').replace(/-/g, '').slice(0, 8);

  function pillLinks(p) {
    const name = (p.name || '').trim();
    const set  = (p.set || '').trim();
    const who  = (faces[p.userId] && faces[p.userId].name) || '';

    const look = '../?page=lookup&q=' + encodeURIComponent(
      /* A number lands on ONE card; a name lands on a list. Use the number
         when the row carries one, which the shop's rows do. */
      p.num ? p.num : name);

    const sold = 'https://www.ebay.com/sch/i.html?_nkw=' +
      encodeURIComponent([name, p.num, set || 'pokemon'].filter(Boolean).join(' ')) +
      '&LH_Sold=1&LH_Complete=1&_sop=13';

    /* A card in somebody's collection has a page of its own, and it is a
       different page from the post: the post is "somebody put this up", the
       collection page is the card itself -- rarity, illustrator, what it is
       worth in that finish, how many they hold. Two buttons, two
       destinations, which is why CARD DETAILS and SHARE can both exist.

       WORTH KNOWING, because it caught me out: this address returns a real
       HTTP 404 from GitHub Pages and 404.html rescues it in the browser, so
       it has always worked for a person and never for a crawler. That is
       what tools/build-collection-pages.mjs is for -- it writes a real file
       here, which also means the file it writes REPLACES the app's version
       of this page for everybody, and has to carry what the app's carried.

       The shop's shelf has no such page: its rows are stock, and the page
       for one of those is the shop's own item page. */
    const details = (p.kind === 'card' && p.rowId && /^[A-Za-z0-9_-]{3,24}$/.test(who))
      ? '/' + who + '/collection/' + cardSlug(name, p.rowId)
      : (p.kind === 'shop' && p.key ? '../?page=item&id=' + encodeURIComponent(p.key) : '');

    return { look, sold, details };
  }

  /* ---- ONE POST, ONE ADDRESS ---------------------------------------------
     infinitepulls.com/tacomike417/post/p-<id>

     The id carries which shelf it came off -- p for a photograph, c for a
     card -- because the two live in different tables and a bare uuid does
     not say which one to look in. The username is in there for the person
     reading the link, not for the lookup: it is decoration, and a wrong one
     still finds the right post.

     The pretty path is only half of it. tools/build-post-pages.mjs writes a
     REAL html file at that address with the picture and the caption baked
     in, because Facebook's crawler does not run JavaScript and would
     otherwise unfurl every one of these as the site's generic card. That is
     the same reason pulls/<slug> exists, and the same trap: it looks fine to
     everybody testing it. */
  const postId = (p) =>
    (p.kind === 'photo' ? 'p-' : p.kind === 'reward' ? 'r-' : 'c-') + (p.rowId || '');

  function permalink(p) {
    if (!p || !p.rowId) return location.origin + '/feed-next/';
    const who = (faces[p.userId] && faces[p.userId].name) || 'collector';
    const handle = /^[A-Za-z0-9_-]{3,24}$/.test(who) ? who : 'collector';
    return location.origin + '/' + handle + '/post/' + postId(p);
  }

  /* ---- turning a shop row into a post -----------------------------------
     A SHOP POST SAYS SO ON ITSELF. It carries `is-shop` on the article now
     that these actually reach the feed. Until v34 they never did, so every
     selector written as "a card post" -- in the app and in its tests -- was
     quietly relying on the shelf being unreachable: a shop row renders with
     an EMPTY data-owner, which still matches [data-owner], so the first
     screenful of shelf cards would have walked straight into rules meant for
     somebody's collection. One honest class costs nothing and closes that. */
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
      who:   SHOP_WHO,
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
    /* REAL NUMBERS. Drawn as whatever is known right now -- zero on the
       first paint -- and corrected by refreshHeat() the moment the counts
       land, the same way the comment badge already worked. */
    /* KEYED ON postId(), NOT p.key. p.key is the feed's own row name
       ('u<uuid>' for a card, and a Clover item number for a shelf row);
       post_key is 'c-<uuid>' / 'p-<uuid>', which is what comments already
       use and what the database constrains. Using the wrong one wrote
       'u11111111-...' into a column that only accepts the other shape, and
       every insert would have been refused. */
    const hk = postId(p);
    const hyped = heatMine.has(hk);
    const n = heatCount.get(hk) || 0;
    const shot = p.pics[0];
    const lvl = heatLevel(n + (hyped ? 1 : 0));
    return `
    <article class="post is-photo${p.shop ? ' is-shop' : ''}" data-key="${esc(p.key)}" data-when="${esc(p.when || '')}"
             data-row="${esc(p.rowId || '')}" data-owner="${esc(p.userId || '')}"
             data-link="${esc(shareLink(p))}">
      <header class="post-top">
        ${p.shop ? `
        <!-- THE SHOP'S OWN PICTURE. Same header a shelf row gets, for the
             same reason: the name is the store, the tap goes to the store,
             and there is no FOLLOW, because following the shop you are
             standing in is not a thing anybody does. The one difference from
             a shelf row is that this one HAS an owner behind it, so REMOVE
             still appears for whoever is signed in as the store. -->
        <button class="avatar-btn" type="button" data-open-shop
                aria-label="See what is at the shop">
          <img class="avatar" src="${esc(p.avatar || '../assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='../assets/hyde-bot.png'">
        </button>
        <button class="who who-btn is-shop" type="button" data-open-shop>
          <b>${esc(SHOP_WHO)}</b><small>${esc(day(p.when) || 'At the shop')}</small>
        </button>
        ${p.pinned
          ? `<span class="pin">PINNED</span>`
          : (p.mine ? `<button class="post-drop" type="button" data-drop-post="${esc(p.rowId)}">REMOVE</button>` : '')}
        ` : `
        <button class="avatar-btn" type="button" data-open-person="${esc(p.userId)}"
                data-open-label="${esc(p.who || 'A collector')}"
                aria-label="See ${esc(p.who || 'this collector')}&rsquo;s cards">
          <img class="avatar" src="${esc(p.avatar || '../assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='../assets/hyde-bot.png'">
        </button>
        <button class="who who-btn" type="button" data-open-person="${esc(p.userId)}"
                data-open-label="${esc(p.who || 'A collector')}">
          <span class="nameline"><b>${esc(p.who || 'A collector')}</b>${badgeOf(faces[p.userId])}</span>
          ${subLine(p, day(p.when) || 'Posted a photo')}
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
        `}
      </header>

      <div class="frame" data-shape="auto">
        <div class="rail">
          ${shot ? `<figure><img src="${esc(shot.u)}" alt="" loading="lazy" decoding="async" ${fallback}></figure>` : ''}
        </div>
      </div>

      <div class="acts is-photo">
        <button class="act hype${hyped ? ' on' : ''}" data-hype="${esc(hk)}" data-level="${lvl}"
                aria-pressed="${hyped}" aria-label="Heat">
          <span class="ring">${heatMark(lvl)}</span>
          <span><span class="lbl">HEAT</span><span class="n">${n}</span></span>
        </button>
        <button class="act" data-comment aria-expanded="false">${I.chat}<span>COMMENT</span><b class="cn" hidden></b></button>
        <button class="act" data-share>${I.share}<span>SHARE</span></button>
      </div>

      ${p.caption
        ? `<p class="caption"><b${p.shop ? ' class="is-shop"' : ''}>${esc(p.who || 'A collector')}</b>${p.shop ? '' : badgeOf(faces[p.userId])} ${esc(p.caption)}</p>`
        : ''}

      ${talkHTML(p)}
    </article>`;
  }

  /* ======================================================================
     COMMENTS: reading, writing, hearting, and taking down.

     EVERY RULE HERE IS ALSO A RULE IN THE DATABASE. supabase/comments.sql
     decides who may write, who may remove, and what a comment may contain;
     this file decides what a person SEES, and tries to make sure nobody is
     told "no" by a server when they could have been told "no" by a button.
     If the two ever disagree the database wins -- which is why every write
     below reports the server's own message rather than assuming success.
     ====================================================================== */

  /* Who is shop staff. Asked once, on load, and only for somebody signed in.
     It is not a secret -- is_shop_staff() answers about the caller and
     nobody else -- and getting it wrong only ever hides a REMOVE button from
     somebody who would have been allowed to use it, because the function in
     the database is what actually decides. */
  async function loadStaff() {
    if (!sb || !me) { staff = false; return; }
    try {
      const { data } = await sb.rpc('is_shop_staff');
      staff = data === true;
    } catch (_) { staff = false; }
  }

  /* THE NUMBERS ON THE ICONS, for a whole screenful in one request.
     Driven off what is ON THE PAGE rather than off a list of posts, because
     posts arrive by two different routes -- the ordinary feed and the single
     pinned post somebody followed a link to -- and only one of them has a
     post object to hand at the point the counts are wanted. Asking the page
     works for both, and asking only about keys with no count yet means
     scrolling never re-fetches what is already known. */
  /* ======================================================================
     HEAT, FOR REAL.

     This used to be a mark in localStorage and a number the page invented
     (`37 + (i % 9) * 3` on cards, `41 + (i % 7) * 4` on photos). Every post
     showed a count nobody had earned, and your own mark did not follow you
     to a second device. Now it is a row per person per post, and the
     primary key on (post_key, user_id) is the whole mechanic: the number
     means HOW MANY PEOPLE, not how many taps.

     A DATABASE WITHOUT THE TABLE STILL WORKS. Until post_heat.sql has been
     run this asks once, is told there is no such view, says so on screen,
     and never asks again -- every post then reads a true zero rather than a
     false 37.
     ====================================================================== */
  const heatCount = new Map();      /* post_key -> how many people */
  const heatMine  = new Set();      /* post_keys I have marked */
  let heatOff = false;

  async function refreshHeat() {
    if (heatOff || !sb) { paintHeat(); return; }
    /* Asked of the BUTTONS, so the key is always the one the button will
       write with -- and a post without a heat button (the shelf) is never
       asked about. */
    const keys = [...feed.querySelectorAll('[data-hype]')]
      .map(el => el.getAttribute('data-hype'))
      .filter(k => k && k.length > 2 && !heatCount.has(k));
    if (!keys.length) { paintHeat(); return; }
    try {
      const { data, error } = await sb
        .from('post_heat_counts').select('post_key, n').in('post_key', keys);
      if (error) {
        if (noTable(error)) {
          heatOff = true;
          note('Heat is not switched on yet — run post_heat.sql.');
        }
        throw error;
      }
      (data || []).forEach(r => heatCount.set(r.post_key, r.n));

      /* MY OWN MARKS, in the same pass. Signed out there are none, and the
         button is still drawn -- tapping it is what says why. */
      if (me) {
        const { data: mine } = await sb
          .from('post_heat').select('post_key').eq('user_id', me).in('post_key', keys);
        (mine || []).forEach(r => heatMine.add(r.post_key));
      }
    } catch (_) { /* a missing count is a missing number, not a broken feed */ }
    /* A post nobody has marked has no row in that view at all, so remember
       the zero -- otherwise every scroll asks about it again. */
    keys.forEach(k => { if (!heatCount.has(k)) heatCount.set(k, 0); });
    paintHeat();
  }

  function paintHeat() {
    feed.querySelectorAll('[data-hype]').forEach(btn => {
      const key = btn.getAttribute('data-hype');
      if (!key || key.length < 3) return;
      const n  = heatCount.get(key) || 0;
      const on = heatMine.has(key);
      const nEl = btn.querySelector('.n');
      if (nEl) nEl.textContent = String(n);
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      const lvl = heatLevel(n);
      if (String(lvl) !== btn.getAttribute('data-level')) {
        btn.setAttribute('data-level', String(lvl));
        const ring = btn.querySelector('.ring');
        if (ring) ring.innerHTML = heatMark(lvl);
      }
    });
  }

  async function refreshCounts() {
    if (!sb) return;
    const keys = [...feed.querySelectorAll('[data-talk]')]
      .map(sec => sec.getAttribute('data-talk'))
      .filter(k => k && !talkCount.has(k));
    if (!keys.length) { paintCounts(); return; }
    try {
      const { data, error } = await sb
        .from('post_comment_counts')
        .select('post_key, n')
        .in('post_key', keys);
      if (!error && data) data.forEach(r => talkCount.set(r.post_key, r.n));
      /* A post nobody has commented on has no row in that view at all, so
         remember the zero -- otherwise every scroll asks about it again. */
      keys.forEach(k => { if (!talkCount.has(k)) talkCount.set(k, 0); });
    } catch (_) { /* a missing count is a missing badge, not a broken feed */ }
    paintCounts();
  }

  function paintCounts() {
    feed.querySelectorAll('.post [data-talk]').forEach(sec => {
      const key = sec.getAttribute('data-talk');
      const btn = sec.closest('.post').querySelector('[data-comment] .cn');
      if (!btn) return;
      const n = talkCount.get(key) || 0;
      btn.textContent = n > 99 ? '99+' : String(n);
      btn.hidden = n === 0;    /* no badge at all rather than a zero */
    });
  }

  const bump = (key, by) => {
    talkCount.set(key, Math.max(0, (talkCount.get(key) || 0) + by));
    paintCounts();
  };

  /* ---- reading one thread ---- */

  async function loadTalk(key) {
    if (!sb) return [];
    const { data, error } = await sb
      .from('post_comments')
      .select('id, post_key, user_id, parent_id, body, created_at')
      .eq('post_key', key)
      .order('created_at', { ascending: true })
      .limit(300);
    if (error) { note('Could not read the comments: ' + (error.message || 'unknown')); return []; }
    const rows = data || [];

    /* The names and faces, for anybody not already on screen. */
    const unknown = [...new Set(rows.map(r => r.user_id))].filter(id => !faces[id]);
    if (unknown.length) await facesFor(unknown);

    /* WHICH ONES THIS PERSON HAS ALREADY HEARTED. Asked only about the
       comments actually on screen, and only when signed in -- a guest has
       no hearts and the question would be a request for nothing. */
    if (me && rows.length) {
      try {
        const { data: mine } = await sb
          .from('comment_hearts')
          .select('comment_id')
          .eq('user_id', me)
          .in('comment_id', rows.map(r => r.id));
        (mine || []).forEach(h => myHearts.add(h.comment_id));
      } catch (_) {}
    }

    /* The heart counts, for everybody. */
    const counts = new Map();
    if (rows.length) {
      try {
        const { data: hearts } = await sb
          .from('comment_hearts')
          .select('comment_id')
          .in('comment_id', rows.map(r => r.id))
          .limit(2000);
        (hearts || []).forEach(h => counts.set(h.comment_id, (counts.get(h.comment_id) || 0) + 1));
      } catch (_) {}
    }
    rows.forEach(r => { r.hearts = counts.get(r.id) || 0; });

    talkRows.set(key, rows);
    return rows;
  }

  /* ---- drawing one thread ---- */

  const postOwnerOf = (sec) => {
    const art = sec.closest('.post');
    return art ? (art.getAttribute('data-owner') || '') : '';
  };

  function commentHTML(c, ownerId, isReply) {
    const who = faces[c.user_id];
    const name = (who && who.name) || 'A collector';
    const face = (who && who.avatar) || '../assets/hyde-bot.png';
    /* THE PERSON WHOSE POST IT IS STANDS OUT. Their answer under their own
       card is not the same kind of thing as a stranger's, and on a phone the
       only room to say so is the name itself. */
    const isOwner = !!ownerId && c.user_id === ownerId;
    const mineToRemove = !!me && (c.user_id === me || me === ownerId || staff);
    const hearted = myHearts.has(c.id);
    return `
      <article class="cmt${isReply ? ' is-reply' : ''}" data-cmt="${esc(c.id)}">
        ${/* THE FACE AND THE NAME GO SOMEWHERE. Tapping a name on a POST has
              narrowed the feed to that person since the beginning; the same
              name inside a thread did nothing at all, which is the kind of
              inconsistency people read as the app being broken rather than
              as a thing that was never built. Same attribute, same handler,
              same destination. */''}
        <img class="cface" src="${esc(face)}" alt="" loading="lazy"
             data-open-person="${esc(c.user_id)}" data-open-label="${esc(name)}"
             onerror="this.onerror=null;this.src='../assets/hyde-bot.png'">
        <div class="cbody">
          <p class="cwho"><b class="cname${isOwner ? ' is-owner' : ''}"
             data-open-person="${esc(c.user_id)}" data-open-label="${esc(name)}"
             role="link" tabindex="0">${esc(name)}</b>${badgeOf(who)}
            ${isOwner ? '<span class="tag">THEIR POST</span>' : ''}
            <small>${esc(day(c.created_at) || '')}</small></p>
          <p class="ctext">${esc(c.body)}</p>
          <div class="cacts">
            <button class="chrt${hearted ? ' on' : ''}" type="button"
                    data-heart="${esc(c.id)}" aria-pressed="${hearted}"
                    aria-label="Heart this comment">
              ${ICON.heart}<span class="hn"${c.hearts ? '' : ' hidden'}>${c.hearts || ''}</span>
            </button>
            ${isReply ? '' : `<button class="clink" type="button" data-reply="${esc(c.id)}">REPLY</button>`}
            ${mineToRemove ? `<button class="clink drop" type="button" data-drop="${esc(c.id)}">REMOVE</button>` : ''}
          </div>
        </div>
      </article>`;
  }

  function paintTalk(sec) {
    const key = sec.getAttribute('data-talk');
    const rows = talkRows.get(key) || [];
    const list = sec.querySelector('.said');
    const ownerId = postOwnerOf(sec);
    if (!list) return;

    /* The number on the head, so a collapsed-and-reopened thread says how
       much is in it before it has finished drawing. Hidden at zero: "0" is a
       fact nobody needs and it makes a quiet post look like a failure. */
    const n = sec.querySelector('.talk-n');
    if (n) { n.textContent = rows.length ? String(rows.length) : ''; n.hidden = !rows.length; }

    if (!rows.length) {
      list.innerHTML = `<p class="talk-empty">No comments yet. Be the first &mdash; tap one above.</p>`;
      return;
    }

    /* Tops in the order they were written, each followed by its own replies.
       One level, so there is no recursion here and no staircase on screen. */
    const tops = rows.filter(r => !r.parent_id);
    const kids = new Map();
    rows.filter(r => r.parent_id).forEach(r => {
      if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
      kids.get(r.parent_id).push(r);
    });

    list.innerHTML = tops.map(t =>
      commentHTML(t, ownerId, false) +
      (kids.get(t.id) || []).map(k => commentHTML(k, ownerId, true)).join('')
    ).join('');
  }

  /* ---- opening and closing ---- */

  async function toggleTalk(art, on) {
    const sec = art.querySelector('[data-talk]');
    const btn = art.querySelector('[data-comment]');
    if (!sec) return;
    const key = sec.getAttribute('data-talk');

    if (!on) {
      sec.hidden = true;
      talkOpen.delete(key);
      if (btn) btn.setAttribute('aria-expanded', 'false');
      return;
    }

    sec.hidden = false;
    talkOpen.add(key);
    if (btn) btn.setAttribute('aria-expanded', 'true');

    if (!talkRows.has(key)) {
      await loadTalk(key);
      talkCount.set(key, (talkRows.get(key) || []).length);
      paintCounts();
    }
    paintTalk(sec);
  }

  /* ---- the sign-in gate ---------------------------------------------------
     A guest who taps a quick comment is not doing something wrong, they are
     doing the thing the button is for. So they are taken to sign in and
     brought BACK to this post with its comments already open, rather than
     dropped on the front of a feed wondering what happened to the card they
     were looking at. */
  function askToSignIn(key) {
    try {
      sessionStorage.setItem('ip-after-signin',
        '/feed-next/?post=' + encodeURIComponent(key) + '&talk=1');
    } catch (_) {}
    location.href = '../?page=account';
  }

  /* ---- writing ---- */

  function sayNote(sec, message, kind) {
    const el = sec.querySelector('.say-note');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'say-note' + (kind ? ' ' + kind : '');
    el.hidden = !message;
  }

  /* "Comment added", and a way back out of it. The row of chips is easy to
     hit twice, and an undo is a kinder answer to that than a confirmation
     step in front of everybody who got it right the first time. */
  function offerUndo(sec, id) {
    const el = sec.querySelector('.say-note');
    if (!el) return;
    el.className = 'say-note ok';
    el.hidden = false;
    el.innerHTML = 'Comment added. <button class="undo" type="button" data-undo="' + esc(id) + '">UNDO</button>';
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      /* Only clear it if it is still the same message -- otherwise a timer
         from the last comment wipes the warning from this one. */
      if (el.querySelector('[data-undo="' + id + '"]')) { el.hidden = true; el.innerHTML = ''; }
    }, 6000);
  }

  async function sendComment(sec, body, fromChip) {
    const key = sec.getAttribute('data-talk');
    if (!me) { askToSignIn(key); return; }
    const text = String(body || '').trim();
    if (!text) return;

    const trouble = contactTrouble(text);
    if (trouble) { sayNote(sec, trouble, 'bad'); return; }

    const parent = talkReply.get(key) || null;
    sayNote(sec, '');

    const row = {
      post_key: key,
      post_owner: postOwnerOf(sec) || me,   /* the database looks this up itself */
      user_id: me,
      body: text
    };
    if (parent) row.parent_id = parent;

    const { data, error } = await sb.from('post_comments').insert(row).select().single();
    if (!error) rwdSoon();     /* comments earn cards; look once the burst ends */
    if (error) {
      /* THE SERVER'S OWN WORDS, not a guess at what went wrong. The check
         constraint's message is not something to show a person, though, so
         the one case worth translating is translated. */
      const m = (error.message || '');
      sayNote(sec, /post_comments_no_contact/.test(m)
        ? 'Comments cannot contain links, emails or phone numbers.'
        : ('That did not post: ' + (m || 'unknown')), 'bad');
      return;
    }

    const rows = talkRows.get(key) || [];
    rows.push(Object.assign({ hearts: 0 }, data));
    talkRows.set(key, rows);
    clearReply(sec);
    paintTalk(sec);
    bump(key, 1);
    if (fromChip) offerUndo(sec, data.id);
    else sayNote(sec, '');

    const input = sec.querySelector('.say input');
    if (input && !fromChip) input.value = '';
  }

  /* ---- replying ---- */

  function setReply(sec, id) {
    const key = sec.getAttribute('data-talk');
    const rows = talkRows.get(key) || [];
    const c = rows.find(r => r.id === id);
    if (!c) return;
    talkReply.set(key, id);
    const bar = sec.querySelector('.replying');
    const who = (faces[c.user_id] && faces[c.user_id].name) || 'a collector';
    if (bar) {
      bar.querySelector('span').textContent = 'Replying to ' + who;
      bar.hidden = false;
    }
    const input = sec.querySelector('.say input');
    if (input) input.focus();
  }

  function clearReply(sec) {
    const key = sec.getAttribute('data-talk');
    talkReply.delete(key);
    const bar = sec.querySelector('.replying');
    if (bar) bar.hidden = true;
  }

  /* ---- hearts ---- */

  async function toggleHeart(sec, id, btn) {
    const key = sec.getAttribute('data-talk');
    if (!me) { askToSignIn(key); return; }
    const rows = talkRows.get(key) || [];
    const c = rows.find(r => r.id === id);
    if (!c) return;

    const had = myHearts.has(id);
    /* Moved before the request and put back if it fails: a heart that waits
       for a server on shop wifi feels like a button that did not work, and
       the cost of being wrong is one heart in the wrong state for a moment. */
    if (had) { myHearts.delete(id); c.hearts = Math.max(0, c.hearts - 1); }
    else { myHearts.add(id); c.hearts += 1; }
    paintTalk(sec);

    const q = had
      ? sb.from('comment_hearts').delete().eq('comment_id', id).eq('user_id', me)
      : sb.from('comment_hearts').insert({ comment_id: id, user_id: me });
    const { error } = await q;
    if (!error && !had) rwdSoon();
    if (error) {
      if (had) { myHearts.add(id); c.hearts += 1; }
      else { myHearts.delete(id); c.hearts = Math.max(0, c.hearts - 1); }
      paintTalk(sec);
      sayNote(sec, 'That heart did not save.', 'bad');
    }
  }

  /* ---- taking one down ---- */

  async function dropComment(sec, id) {
    const key = sec.getAttribute('data-talk');
    if (!me) { askToSignIn(key); return; }
    /* ONE FUNCTION IN THE DATABASE DECIDES. This does not check whether the
       person is allowed -- it asks, and reports what it is told. The REMOVE
       button is hidden from people who cannot use it, but that is tidiness,
       not the rule. */
    const { error } = await sb.rpc('hide_comment', { comment_id: id });
    if (error) { sayNote(sec, error.message || 'That did not come down.', 'bad'); return; }

    const rows = (talkRows.get(key) || []).filter(r => r.id !== id && r.parent_id !== id);
    const gone = (talkRows.get(key) || []).length - rows.length;
    talkRows.set(key, rows);
    paintTalk(sec);
    bump(key, -gone);
    sayNote(sec, '');
  }

  /* ---- all of it, from one listener ---- */

  document.addEventListener('click', async (e) => {
    const commentBtn = e.target.closest('[data-comment]');
    if (commentBtn) {
      e.preventDefault();
      const art = commentBtn.closest('.post');
      const sec = art && art.querySelector('[data-talk]');
      if (sec) await toggleTalk(art, sec.hidden);
      return;
    }

    const sec = e.target.closest('[data-talk]');
    if (!sec) return;

    /* THE SECOND WAY OUT. The COMMENT icon is back up at the top of the post
       and scrolls off once a thread has a few answers in it, so from inside
       the conversation there was no way to shut it -- every screen needs a
       visible exit, and this is the one you can actually see from in here. */
    if (e.target.closest('[data-talk-close]')) {
      e.preventDefault();
      const art = sec.closest('.post');
      if (art) await toggleTalk(art, false);
      return;
    }

    const chip = e.target.closest('[data-quick]');
    if (chip) {
      e.preventDefault();
      /* Held down for a moment after a tap, because the chips are big and
         close together and a double tap is a duplicate comment. */
      if (chip.disabled) return;
      chip.disabled = true;
      setTimeout(() => { chip.disabled = false; }, 1200);
      await sendComment(sec, chip.getAttribute('data-quick'), true);
      return;
    }

    const undo = e.target.closest('[data-undo]');
    if (undo) { e.preventDefault(); await dropComment(sec, undo.getAttribute('data-undo')); return; }

    const heart = e.target.closest('[data-heart]');
    if (heart) { e.preventDefault(); await toggleHeart(sec, heart.getAttribute('data-heart'), heart); return; }

    const reply = e.target.closest('[data-reply]');
    if (reply) { e.preventDefault(); setReply(sec, reply.getAttribute('data-reply')); return; }

    if (e.target.closest('[data-unreply]')) { e.preventDefault(); clearReply(sec); return; }

    const drop = e.target.closest('[data-drop]');
    if (drop) { e.preventDefault(); await dropComment(sec, drop.getAttribute('data-drop')); return; }
  });

  document.addEventListener('submit', async (e) => {
    const tag = e.target.closest('[data-tagline]');
    if (tag) {
      e.preventDefault();
      const wrap = document.getElementById('menurows');
      const input = tag.querySelector('input');
      if (wrap && input) await saveTagline(wrap, input.value);
      return;
    }
    const form = e.target.closest('[data-say]');
    if (!form) return;
    e.preventDefault();
    const sec = form.closest('[data-talk]');
    const input = form.querySelector('input');
    if (sec && input) await sendComment(sec, input.value, false);
  });

  /* ---- one post --------------------------------------------------------- */
  function postHTML(p, i) {
    if (p.kind === 'photo')  return photoHTML(p, i);
    if (p.kind === 'reward') return rewardHTML(p, i);
    /* data-hype is still the attribute name: the word on the button changed
       and then the storage behind it did, but renaming the hook as well
       would have meant touching the CSS and the handler for nothing. */
    const hk = postId(p);
    const hyped = heatMine.has(hk);
    const saved = !!(p.cardId && wished.has(p.cardId));   /* the real list */
    const n = heatCount.get(hk) || 0;
    const sub = [p.set, p.num && '#' + p.num].filter(Boolean).join(' · ');
    const go = pillLinks(p);
    const shut = pulseShut();
    /* WHAT THE BOX KNOWS. Every row here is already on the post object --
       nothing new is asked of the database for any of it. A row with no
       value is left out rather than printed empty: "Finish --" tells a
       reader nothing except that the app is missing something. */
    const finish = finishOf(p.variant);
    const facts = [
      ['Where', p.kind === 'shop' ? 'At the shop' : 'In a collection', 'state'],
      finish ? ['Finish', finish, ''] : null,
      ['Condition', (p.cond || 'RAW').toUpperCase(), 'cond'],
      p.qty > 1 ? ['Quantity', '\u00d7' + p.qty, 'cond'] : null,
      p.price != null ? ['Price', money(p.price), 'price'] : null
    ].filter(Boolean);
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
    <article class="post${p.kind === 'shop' ? ' is-shop' : ''}" data-key="${esc(p.key)}" data-when="${esc(p.when || '')}" data-price="${esc(p.price == null ? '' : p.price)}"
             data-row="${esc(p.rowId || '')}" data-owner="${esc(p.userId || '')}" data-note="${esc(p.note || '')}"
             data-link="${esc(shareLink(p))}"
             data-name="${esc(p.name || '')}" data-num="${esc(p.num || '')}">
      <header class="post-top">
        ${p.kind === 'shop' ? `
        <!-- THE SHOP HAS NO ACCOUNT BEHIND IT. Its rows come off the shelf
             table, not user_cards, so there is no user_id for the ordinary
             "tap a name to see their cards" wiring to take hold of. It gets
             its own attribute and its own narrow instead, which lands in the
             same place from the reader's side: this name, these posts.
             The name is colored so it reads as a different KIND of account
             before it is read as a different account. -->
        <button class="avatar-btn" type="button" data-open-shop
                aria-label="See what is at the shop">
          <img class="avatar" src="${esc(p.avatar || '../assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='../assets/hyde-bot.png'">
        </button>
        <button class="who who-btn is-shop" type="button" data-open-shop>
          <b>${esc(p.who || SHOP_WHO)}</b><small>${esc(sub || 'At the shop')}</small>
        </button>
        ` : !p.userId ? `
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
          <span class="nameline"><b>${esc(p.who || 'A collector')}</b>${badgeOf(faces[p.userId])}</span>
          ${subLine(p, sub || 'In their collection')}
        </button>
        `}
        ${p.kind === 'shop' ? '' : (me && p.userId === me)
          /* REMOVE TAKES IT OFF THE FEED. It does NOT delete the card --
             same word as on a photo post, deliberately weaker meaning,
             because here the card goes on existing and the post does not.
             The line that replaces it says so, and offers it back. */
          ? `<button class="post-drop" type="button" data-hide-card="${esc(p.rowId || '')}">REMOVE</button>`
          : `<button class="follow${following(p.userId) ? ' on' : ''}" type="button"
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
        <button class="act hype${hyped ? ' on' : ''}" data-hype="${esc(hk)}" data-level="${heatLevel(n)}"
                aria-pressed="${hyped}" aria-label="Heat">
          <span class="ring">${heatMark(heatLevel(n))}</span>
          <span><span class="lbl">HEAT</span><span class="n">${n}</span></span>
        </button>
        ${p.kind === 'shop' || !p.rowId ? '' :
          `<button class="act" data-comment aria-expanded="false">${I.chat}<span>COMMENT</span><b class="cn" hidden></b></button>`}
        <button class="act" data-share>${I.share}<span>SHARE</span></button>
        <button class="act${saved ? ' on' : ''}" data-save aria-pressed="${saved}"
                data-card="${esc(p.cardId || '')}" data-cardname="${esc(p.name || '')}"
                data-cardset="${esc(p.set || '')}" data-cardart="${esc((p.pics[0] && p.pics[0].u) || '')}"
                ${p.cardId ? '' : 'disabled'}>${I.mark}<span>WISHLIST</span></button>
      </div>

      ${/* THE BYLINE IS THE SAME NAME AS THE HEADER and has to be the same
            color. It was left gold here while the header turned blue, so one
            post showed Infinite Pulls in two different colors an inch apart
            -- which reads as two accounts, or as a bug, and either way
            undoes the thing the color was for. */''}
      <p class="caption"><b${p.kind === 'shop' ? ' class="is-shop"' : ''}>${esc(p.who || 'A collector')}</b>${badgeOf(faces[p.userId])} ${esc(p.name)}${p.set ? ' — ' + esc(p.set) : ''}</p>

      ${/* ---- CARD PULSE ------------------------------------------------
            One box for one subject: what this card IS, and the three places
            to go find out more about it. It used to be two things -- a
            bordered box holding two facts, and a naked row of buttons
            floating underneath it -- which is two visual treatments for one
            idea, and a fold-away button covering almost nothing.

            The facts are LABELED ROWS rather than the old dot-separated
            line. That line was fine at three items and falls apart at five:
            on a 393px phone `IN A COLLECTION - REVERSE HOLOFOIL - NEAR MINT`
            wraps, and a wrapped dot-line reads as a mistake rather than a
            layout. A label beside a value survives any width.

            The buttons come last because they are the deliberate half. HEAT,
            WISHLIST and SHARE are reflex taps and stay up top where a thumb
            already is; looking a card up is something somebody decides to
            do, and a decision can afford to live one layer in. */''}
      ${/* THE CONVERSATION COMES FIRST. Somebody who tapped COMMENT wants
            the thread, and it used to open below a fold-out of prices and
            set names they had not asked for -- so the thing they opened
            arrived off the bottom of the screen. */''}
      ${talkHTML(p)}

      <section class="snap${shut ? ' shut' : ''}">
        <button class="snap-head" type="button" data-snap
                aria-expanded="${shut ? 'false' : 'true'}">
          <span class="ic">${I.card}</span><b>CARD PULSE</b>${I.chev}
        </button>
        <div class="snap-body">
          <dl class="pulse-rows">${facts.map(([k, v, cls]) => `
            <div class="pulse-row"><dt>${esc(k)}</dt><dd${cls ? ` class="${cls}"` : ''}>${esc(v)}</dd></div>`).join('')}
          </dl>
          <div class="pills">
            <a class="pill" href="${esc(go.look)}">${I.look}<span>LOOK UP</span></a>
            <a class="pill" href="${esc(go.sold)}" target="_blank" rel="noopener">${I.bars}<span>SOLD LISTINGS</span></a>
            ${go.details ? `<a class="pill" href="${esc(go.details)}">${I.doc}<span>CARD DETAILS</span></a>` : ''}
          </div>
        </div>
      </section>

      ${/* "Look this one up" went the same place LOOK UP goes, one row
            below it, in different words -- two buttons for one destination.
            The shop's version is a different thing entirely: it opens that
            item on the shelf, where the price and the buy button are -- and
            it is the only thing on a post that leads to money changing
            hands, so it stays OUTSIDE CARD PULSE rather than folding away
            with the research buttons. Gold, because gold is what this design
            already uses for the things you act on: HYPE, the + button, a
            person's name. The three research pills stay blue and quiet
            underneath it; this one is the loud one, on purpose.
            A CART, NOT THE TWO PEOPLE: this row borrowed the "people"
            glyph, which says something about collectors and nothing about a
            shelf. The icon set's own shop glyph was a bag drawn as a
            tapered box with a handle arc over it -- at 17px that is a trash
            can, and it read as one everywhere it appeared. A cart has
            wheels, which nothing else in the set does, so it survives being
            shrunk. The icon sits in the same 30px chip the CARD PULSE
            header uses, so the two rows read as one family. */
        p.kind === 'shop' && go.details
          ? `<a class="nearby" href="${esc(go.details)}">
               <span class="ic">${I.shop}</span>
               <span class="txt"><b>See this one at the shop</b></span>
               ${I.chevR}</a>`
          : ''}
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
        <button class="avatar-btn" type="button" data-open-shop
                aria-label="See what is at the shop">
          <img class="avatar" src="../assets/hyde-bot.png" alt=""
               onerror="this.onerror=null;this.style.visibility='hidden'">
        </button>
        <button class="who who-btn is-shop" type="button" data-open-shop>
          <b>${esc(SHOP_WHO)}</b><small>Start here</small>
        </button>
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
      rwdSoon();               /* your own photo of a card is 01/50 */

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

     TWO SOURCES, SIDE BY SIDE. Collections are the whole idea -- the
     collection IS the content -- and the shop's shelf runs alongside them
     rather than behind them. This used to be "people first, the shelf when
     they run out", which sounded fair and meant the shelf was never seen:
     people do not run out. Both are read together now and both go through
     the same per-account queue, so the shop takes a turn like a collector
     instead of waiting for one that never comes.

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
  /* THE SHOP IS NOT A SECOND HALF OF THE FEED, IT IS ANOTHER VOICE IN IT.
     This used to be a list of sources walked in order -- people first, the
     shop only once people ran out. People never run out: the roster holds up
     to two hundred accounts and the feed asks six at a time, so "cards are
     drained" is a state nobody scrolling ever reached. The shelf was not
     rare in the feed, it was UNREACHABLE, sitting behind a line with no end.

     So the shop now fills up beside the people instead of behind them, and
     its posts go through the same per-account queue everybody else uses.
     `enqueue` keys on `post.userId || post.who`, and a shop row has no owner
     -- so every one of them lands under "Infinite Pulls" and the existing
     fairness rule treats the shelf as one more collector: at most
     MAX_PER_PAGE of Jeff's cards per screenful, interleaved, never a block.
     Nothing had to be invented to make that true.

     It keeps its OWN cursor and its own drain flag. Sharing `cursor` with
     the card query was safe only while the two could never run at once. */
  let cursor = null, drained = false, busy = false, buffer = [];
  let shopCursor = null, shopDrained = false;

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

  /* ---- THE WISH LIST IS A REAL TABLE ------------------------------------
     WISHLIST used to tick a box in this browser and nothing else: the card
     never reached wishlist_cards, so My Wish List stayed empty, the profile
     page showed nothing, and the mark vanished the day somebody cleared
     their site data. It looked like it worked, which is the only reason it
     survived this long.

     Loaded once as a set of card ids, the same way the unfollow list is --
     a wish list is small, and one query on arrival beats one per screenful.
     Signed out it stays empty, and tapping says why. */
  const wished = new Set();
  let wishLoaded = false;

  async function loadWishlist() {
    if (wishLoaded || !sb || !me) { wishLoaded = true; return; }
    wishLoaded = true;
    try {
      const { data, error } = await sb.from('wishlist_cards').select('card_id').eq('user_id', me);
      if (error) { note('Could not read your wish list (' + (error.message || error.code) + ').'); return; }
      (data || []).forEach(r => { if (r.card_id) wished.add(r.card_id); });
    } catch (_) { /* the feed is still worth showing */ }
  }

  async function tapWish(btn, want) {
    if (!want.cardId) return;
    if (!sb || !me) { note('Sign in to keep a wish list.'); return; }
    const on = !wished.has(want.cardId);
    /* Painted first, reconciled after. A wish list button that waits for a
       round trip before it moves feels broken on shop wifi. */
    const paint = (state) => {
      btn.classList.toggle('on', state);
      btn.setAttribute('aria-pressed', String(state));
      if (state) wished.add(want.cardId); else wished.delete(want.cardId);
    };
    paint(on);
    try {
      const { error } = on
        ? await sb.from('wishlist_cards').insert({
            user_id: me, card_id: want.cardId,
            card_name: want.name || 'Card', set_name: want.set || null,
            image_url: want.art || null
          })
        : await sb.from('wishlist_cards').delete().eq('user_id', me).eq('card_id', want.cardId);
      if (error) throw new Error(error.message || error.code || 'unknown');
    } catch (e) {
      /* PUT IT BACK. A button left lit for something that was never saved is
         worse than one that never moved. */
      paint(!on);
      note('Could not change your wish list: ' + ((e && e.message) || 'unknown'));
    }
  }

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

  /* ONE STORE, ONE SEAT. A shelf row has no owner, so it queues under the
     shop's NAME; the store's own account has a user id, so its pictures
     queued under that instead -- two queues, both called Infinite Pulls to
     whoever is reading, and the round-robin handed the shop two turns a
     screenful where everybody else gets one. It also split the shop's own
     posts apart, so a poster from this morning could land pages away from
     the shelf cards it was posted beside.

     Both go under the shop's name now, and that one queue is kept in time
     order, so when the shop's turn comes round the newest thing it has put
     out is the thing that shows. */
  function enqueue(post) {
    /* ALREADY ON SCREEN, AT THE TOP. The shop's newest poster is drawn above
       the feed; letting the rotation deal it again would show the same
       picture twice on one screenful. Only in the MAIN feed -- inside the
       shop's own chip, or a person's page, it is an ordinary post and
       belongs in the list. */
    if (!filter && shopPinId && post.kind === 'photo' && post.rowId === shopPinId) return;
    const shopPost = post.shop || post.kind === 'shop';
    const k = shopPost ? SHOP_WHO : (post.userId || post.who);
    if (!queues.has(k)) queues.set(k, []);
    const q = queues.get(k);
    q.push(post);
    if (shopPost) q.sort((a, b) => String(b.when || '').localeCompare(String(a.when || '')));
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
  /* PROFILES GAINED TWO COLUMNS, and PostgREST fails the WHOLE query when
     one is missing rather than ignoring it -- the same trap the card columns
     already have a retry for. A database that has not had founder_badge.sql
     run would otherwise answer "no such column" to every request for a name
     and the feed would show a page of strangers. Asked for once; if they are
     not there, remembered and never asked for again. */
  let profileExtras = null;   /* null = not tried yet, [] = they are not there */
  const profileCols = () =>
    'id, username, avatar_url' + ((profileExtras || []).length ? ', ' + profileExtras.join(', ') : '');
  const PROFILE_EXTRAS = ['verified_at', 'tagline'];

  const asFace = (p) => ({
    /* The id rides along because badgeOf() draws the ribbons from it, and
       every call site passes the FACE, not the id it was looked up by. */
    id: p.id,
    name: p.username,
    avatar: p.avatar_url,
    /* A badge is a fact about the account, so it is carried with the name
       rather than looked up wherever a name is drawn. */
    badge: !!p.verified_at,
    tagline: p.tagline || ''
  });

  async function facesFor(ids) {
    /* Marks first, and for the WHOLE list -- a face can be cached from an
       earlier screen while its ribbons have never been asked for. */
    const marksJob = marksFor(ids);
    const want = ids.filter(id => id && !(id in faces));
    if (!want.length || !sb) { await marksJob; return; }
    try {
      if (profileExtras === null) profileExtras = PROFILE_EXTRAS.slice();
      const asked = profileExtras.slice();          /* what THIS call asked for */
      let { data, error } = await sb.from('profiles').select(profileCols()).in('id', want);
      if (error && missingColumn(error) && asked.length) {
        profileExtras = [];
        ({ data } = await sb.from('profiles').select(profileCols()).in('id', want));
      }
      (data || []).forEach(p => { faces[p.id] = asFace(p); });
    } catch (_) { /* a missing name is not worth failing a search over */ }
    want.forEach(id => { if (!(id in faces)) faces[id] = null; });
    await marksJob;
  }

  async function loadRoster() {
    if (roster) return;
    roster = [];
    try {
      if (profileExtras === null) profileExtras = PROFILE_EXTRAS.slice();
      const asked = profileExtras.slice();
      let { data, error } = await sb.from('profiles')
        .select(profileCols() + ', is_public')
        .eq('is_public', true).limit(ROSTER_MAX);
      if (error && missingColumn(error) && asked.length) {
        profileExtras = [];
        ({ data, error } = await sb.from('profiles')
          .select(profileCols() + ', is_public')
          .eq('is_public', true).limit(ROSTER_MAX));
      }
      if (error) { note('Could not read the roster: ' + (error.message || error.code || 'unknown')); return; }
      marksFor((data || []).map(p => p.id));
      (data || []).forEach(p => {
        faces[p.id] = asFace(p);
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
    rewardSpent.clear(); rewardCursors.clear(); firstRewardAsk = null;
    rewardPosts.clear();
    personBuf.length = 0;        /* the timeline belonged to the old view too */
    buffer = []; cursor = null; drained = false;
    shopCursor = null; shopDrained = false;
    rosterAt = 0; spin = 0; lastWho = null; sentinel = null;
    feed.innerHTML = '';
  }

  function chipHTML() {
    if (!filter) return '';
    /* YOUR OWN NAME IN THE THIRD PERSON reads like somebody else's shelf.
       When the person being filtered to is the one looking, say so. */
    const isMe = filter.kind === 'person' && me && filter.id === me;
    const what = filter.kind === 'shop'
      ? `<b>${esc(SHOP_WHO)}</b> &mdash; at the shop`
      : filter.kind === 'person'
        ? (isMe ? `<b>Your</b> posts` : `<b>${esc(filter.label)}</b>&rsquo;s cards`)
        : `Everyone with <b>${esc(filter.label)}</b>`;
    return `<span class="chip">${what}
      <button class="x" type="button" data-chip-clear aria-label="Show the whole feed again">&times;</button></span>`;
  }

  /* ======================================================================
     THE PROFILE CARD

     infinitepulls.com/tacomike417 has landed on a narrowed feed since 404.html
     started handing usernames to this page -- which showed a chip saying
     whose cards these were and then nothing else about them at all. The old
     app still has a collector profile in components/profile.js with the
     grail card, the bio and a trophy case on it; it simply became
     unreachable. This is the half of it that was worth keeping, in this
     design, at the top of the feed it replaced.

     EVERY PIECE IS OPTIONAL. A profile with no bio, no grail and no badges
     draws a name and three numbers and looks deliberate, because the empty
     state is what most accounts are on their first day.

     WHAT A VISITOR SEES. The three numbers are readable for any public
     profile -- the RLS for cards, wishes and reward marks all say so -- but
     there is no public page for somebody else's wish list or rewards, and
     reward_sweep runs on auth.uid() so there never can be one that is
     theirs. So the tiles are numbers for a visitor and doors for the owner.
     ====================================================================== */
  async function profCount(table, id) {
    try {
      const { count, error } = await sb.from(table)
        .select('id', { count: 'exact', head: true }).eq('user_id', id);
      if (error) return null;
      return count || 0;
    } catch (_) { return null; }
  }

  /* grail_card_id is a row in user_cards, not a card in the catalogue --
     it is a card this person OWNS, picked from their own shelf on the
     account page. So the picture and the words both come from that row. */
  async function profGrail(rowId) {
    if (!rowId) return null;
    try {
      const { data } = await sb.from('user_cards')
        .select('card_name, set_name, image_url').eq('id', rowId).limit(1);
      return (data || [])[0] || null;
    } catch (_) { return null; }
  }

  /* Goals that reached 100% and were stamped by goal_sweep(). The old page
     recomputed all eight from the collection every time it drew; the stamp
     is already in the database because 41/50 The Oathkeeper needs it, so
     this is one query instead of a rebuild of somebody's whole shelf. */
  async function profBadges(id) {
    try {
      const { data, error } = await sb.from('user_collector_goals')
        .select('completed_at, collector_goal_templates(name, badge_image, icon)')
        .eq('user_id', id).not('completed_at', 'is', null)
        .order('completed_at', { ascending: true });
      if (error) return [];
      return (data || []).map(r => r.collector_goal_templates).filter(Boolean);
    } catch (_) { return []; }
  }

  function profBadgeHTML(b) {
    const name = (b && b.name) || '';
    return b && b.badge_image
      ? `<span class="pbadge" title="${esc(name)}">
           <img src="../${esc(b.badge_image)}" alt="${esc(name)}" loading="lazy" decoding="async">
           <i>${esc(name)}</i></span>`
      /* No artwork on this template yet -- the emoji is the fallback the
         goals board already uses, rather than a broken image. */
      : `<span class="pbadge is-plain" title="${esc(name)}">
           <b>${esc((b && b.icon) || '★')}</b><i>${esc(name)}</i></span>`;
  }

  async function fillProfile(id) {
    const box = document.getElementById('profcard');
    if (!box || !sb || !id) return;

    let p = null;
    try {
      const { data } = await sb.from('profiles')
        .select('id, username, avatar_url, bio, tagline, verified_at, grail_card_id')
        .eq('id', id).limit(1);
      p = (data || [])[0] || null;
    } catch (_) { p = null; }
    /* A profile that will not load is not worth an error on somebody else's
       feed -- the posts underneath are the page. */
    if (!p) return;

    const [cards, wishes, grail, badges] = await Promise.all([
      profCount('user_cards', id),
      profCount('wishlist_cards', id),
      profGrail(p.grail_card_id),
      profBadges(id),
      /* THE RIBBON MARKS, ASKED FOR HERE. They normally arrive with a
         screenful of posts -- but this card draws before any post has been
         fetched, so reading marks[id] straight away got nothing and REWARDS
         showed a dash on every profile. marksFor de-duplicates, so asking
         again when the posts land costs one no-op. */
      marksFor([id])
    ]);
    if (!document.getElementById('profcard')) return;   /* they moved on */

    const mine = !!me && me === id;
    const m = marks[id] || null;
    const rwd = m ? `${m.cards}/50` : '\u2014';
    const num = (n) => (n == null ? '\u2014' : String(n));
    const face = faces[id] || { id, name: p.username, badge: !!p.verified_at, tagline: p.tagline };

    const tile = (label, value, href, attr) => {
      const inner = `<b>${esc(value)}</b><i>${esc(label)}</i>`;
      if (!mine) return `<span class="ptile">${inner}</span>`;
      return href ? `<a class="ptile is-door" href="${esc(href)}">${inner}</a>`
                  : `<button class="ptile is-door" type="button" ${attr || ''}>${inner}</button>`;
    };

    /* THE GRAIL IS THE HEADER. It was a thumbnail in a narrow column with a
       caption under it -- which is how you lay out a footnote, for the one
       thing on a profile that is actually personal. Its artwork is the band
       behind the name now, blurred hard and dimmed so it reads as light
       rather than as a picture, and the card itself lies tilted across the
       bottom edge of it. Every profile is lit by its owner's own grail, and
       the whole card went from 369px to under 200.

       NO GRAIL, NO BAND. Most accounts have not set one, so the plain panel
       is the common case and has to look deliberate rather than broken --
       which is why the art rides on a modifier class and nothing else in
       here changes when it is missing. */
    const art = grail && grail.image_url ? esc(grail.image_url) : '';
    box.className = 'prof' + (art ? ' has-art' : '');

    box.innerHTML = `
      <div class="prof-band"${art ? ` style="--art:url('${art}')"` : ''}>
        ${art ? '<span class="prof-art" aria-hidden="true"></span>' : ''}
        <div class="prof-top">
          <img class="prof-face" src="${esc(p.avatar_url || '../assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='../assets/hyde-bot.png'">
          <div class="prof-name">
            <h2>${esc(p.username)}${badgeOf(face)}</h2>
            ${p.tagline ? `<p class="prof-tag">${esc(p.tagline)}</p>` : ''}
          </div>
        </div>
        ${grail ? `
          <div class="gtag"><span>GRAIL</span><b>${esc(grail.card_name || '')}</b></div>
          <img class="gcard" src="${esc(grail.image_url || NO_PHOTO)}"
               alt="${esc(grail.card_name || '')}" loading="lazy" decoding="async"
               onerror="this.onerror=null;this.src='${esc(NO_PHOTO)}'">` : ''}
      </div>

      <div class="prof-rest">
        ${p.bio ? `<div class="prof-bio">
          <p class="pb-text">${esc(p.bio)}</p>
          <button class="pb-more" type="button" data-bio-more hidden>MORE</button>
        </div>` : ''}

        ${badges.length ? `<div class="prof-badges">
          ${badges.map(profBadgeHTML).join('')}
        </div>` : ''}

        <div class="prof-tiles">
          ${tile('CARDS',   num(cards),  mine ? '../?page=collection' : '')}
          ${tile('WISHED',  num(wishes), mine ? '../?page=collection&tab=wishlist' : '')}
          ${tile('REWARDS', rwd,         '', 'data-rewards')}
        </div>
      </div>`;
    box.hidden = false;

    /* MORE ONLY IF THERE IS MORE. The bio is clamped to two lines in CSS;
       whether that actually cut anything off depends on the words, so the
       button is offered by measurement rather than by a character count --
       which would be wrong at every width the moment somebody rotates. */
    const t = box.querySelector('.pb-text');
    const more = box.querySelector('.pb-more');
    if (t && more && t.scrollHeight > t.clientHeight + 1) more.hidden = false;
  }

  async function setFilter(next) {
    filter = next;
    const bar = document.getElementById('chipbar');
    if (bar) { bar.innerHTML = chipHTML(); bar.hidden = !filter; }
    resetFeed();
    await startFeed();
  }

  /* ======================================================================
     A NARROWED FEED IS A PLACE YOU WENT.

     Tapping somebody's name, picking a search result, or opening MY FEED
     replaces everything on the screen. To the person holding the phone that
     is a new screen, so Back has to bring them out of it -- and until now it
     took them off the feed entirely, which is the same complaint the sheets
     had before they learned to push a history entry.

     Same machinery, same rule: going in pushes an entry, and EVERY way out
     -- the chip's X, Back, picking somebody else -- goes through
     history.back() rather than clearing the filter directly, so there is one
     closing path and the stack cannot drift out of step with the screen.

     ORDERING MATTERS WHEN A SHEET IS OPEN. MY FEED lives inside the menu,
     and closing that sheet is itself a history.back() whose popstate lands a
     tick later. Pushing the filter's entry before that pop arrives would
     make the pop eat the filter instead of the sheet. So an action fired
     from inside an overlay is parked and run after the overlay has gone.
     ====================================================================== */
  let filterPushed = false;
  let afterOverlay = null;

  /* A PERSON'S FEED HAS AN ADDRESS; the other narrows do not.
     Tapping a name and being handed infinitepulls.com/tacomike417 is the
     whole point -- it is the link somebody says out loud, puts in a bio, or
     sends to a friend. A card search or the shelf is a thing you did to this
     page, not a place, and giving those addresses would put states in
     somebody's history that mean nothing a week later. */
  const personPath = (next) =>
    (next && next.kind === 'person' && next.label &&
     /^[A-Za-z0-9_-]{3,24}$/.test(next.label))
      ? '/' + next.label
      : null;

  async function narrowTo(next) {
    window.scrollTo(0, 0);
    await setFilter(next);
    const where = personPath(next);
    if (next && !filterPushed) {
      history.pushState({ ipFilter: 1 }, '', where || location.href);
      filterPushed = true;
    } else if (where) {
      history.replaceState({ ipFilter: 1 }, '', where);
    }
  }

  /* The way out, wherever it was asked for. */
  function widen() {
    if (filterPushed) { history.back(); return; }   /* popstate does the clearing */
    setFilter(null);
    /* Somebody who arrived at /tacomike417 and then asked for the whole feed
       is no longer on tacomike417's page, and the address has to say so --
       otherwise they share a link to everybody's feed that opens on one
       person's. */
    if (/^\/[A-Za-z0-9_-]{3,24}\/?$/.test(location.pathname)) {
      history.replaceState(null, '', '/feed-next/');
    }
  }

  /* Narrow from wherever we are: if a sheet or the search panel is covering
     the feed, it goes first and this follows it down. */
  function goNarrow(next) {
    if (overlay) {
      afterOverlay = () => narrowTo(next);
      showOverlay(overlay, false);
      return;
    }
    narrowTo(next);
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
      variant: r.variant || '',
      qty: r.quantity || 1,
      price: null,
      when: r.added_at,
      pics,
      shape: 'portrait'
    };
  };

  /* ---- THE COMMENT SECTION ------------------------------------------------
     Drawn closed on every post and filled in only when somebody opens it.
     A feed of eight posts that each fetched their conversation on arrival
     would be eight queries nobody asked for, to draw something nobody is
     looking at -- and the number on the icon, which IS wanted up front,
     comes for the whole screenful in one request instead.

     The whole thing is markup from the start rather than built on the first
     tap: opening it is then a class, which is instant, rather than a render
     that happens while a thumb is already moving. */
  function talkHTML(p) {
    /* THE SHOP'S SHELF HAS NO CONVERSATION UNDER IT, and this is a boundary
       rather than an omission. A comment belongs to a post, and a post
       belongs to a person -- that is who gets to moderate the thread, and it
       is the whole permission model. A shelf row belongs to the shop's
       inventory: there is no user_id on it, so there is nobody to be the
       owner of the thread, and the database refuses a comment on a post it
       cannot find an owner for.

       Left to itself this drew a section keyed 'c-' -- the post id with an
       empty uuid after it -- which looked fine, took a comment, and failed
       at the database with a constraint message. Better to not offer it. */
    if (p.kind === 'shop' || !p.rowId) return '';
    const key = postId(p);
    /* A BOX, NOT A BASEMENT. This used to be a hairline and some padding at
       the very bottom of the post -- the same dark as everything above it,
       with no edge of its own -- so an open thread read as more post rather
       than as a different kind of thing, and three people talking under one
       card was genuinely hard to follow.

       It is a container now, built to the same measurements as CARD PULSE:
       same side margins, same corner radius, same head with an icon chip and
       a chevron. And it sits ABOVE Card Pulse, because a conversation
       somebody opened on purpose should not be underneath the reference
       material they did not ask for.

       THE HEAD CLOSES IT. Two ways out, on purpose: the COMMENT icon that
       opened it, and the chevron up here -- which is the one people reach
       for, because it is the one they can see from inside the thread. */
    return `
      <section class="talk" data-talk="${esc(key)}" hidden>
        <button class="talk-head" type="button" data-talk-close
                aria-label="Close comments">
          <span class="ic">${I.chat}</span><b>COMMENTS</b>
          <i class="talk-n" hidden></i>${I.chev}
        </button>
        <div class="talk-body">
          <!-- TEN CHIPS THAT SCROLL SIDEWAYS. Not a grid: a grid of ten would
               be four rows deep on a phone and push the next post off the
               screen, and the row of quick things to say is not the thing
               somebody came here for. -->
          <div class="quick" role="group" aria-label="Quick comments">
            ${QUICK.map(q => `<button class="chip" type="button" data-quick="${esc(q)}">${esc(q)}</button>`).join('')}
          </div>

          <div class="replying" hidden>
            <span></span>
            <button class="x" type="button" data-unreply aria-label="Stop replying">&times;</button>
          </div>

          <form class="say" data-say>
            <input type="text" name="body" maxlength="600" autocomplete="off"
                   placeholder="Write a comment&hellip;" aria-label="Write a comment">
            <button class="send" type="submit">POST</button>
          </form>
          <p class="say-note" hidden role="alert"></p>

          <div class="said"><p class="talk-empty">Loading&hellip;</p></div>
        </div>
      </section>`;
  }

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
    /* THE STORE'S PICTURES ARE THE STORE TALKING. Marked here rather than in
       the renderer so everything downstream -- the caption, the share sheet,
       the pinned permalink -- says the same name without each one having to
       know the rule. */
    const shop = isStore(r.user_id);
    return {
      kind: 'photo',
      shop: shop,
      key: 'ph' + r.id,
      rowId: r.id,
      userId: r.user_id,
      mine: !!(me && r.user_id === me),
      who: shop ? SHOP_WHO : ((who && who.name) || 'A collector'),
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
  const NEW_COLS = ['photo_key', 'hidden_feed'];
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
    /* ASKED OF THE DATABASE, not sorted out here -- but only once we know
       the column exists. A hidden card filtered on this side would still
       have used up one of the four we asked for, so somebody with four
       hidden cards at the top of their shelf would look like they had none
       at all. */
    if (extra.indexOf('hidden_feed') !== -1) q = q.eq('hidden_feed', false);
    if (cursors.has(id)) q = q.lt('added_at', cursors.get(id));
    return q;
  }

  async function fetchCardsForAccount(id) {
    if (cardSpent.has(id)) return [];
    if (!columns) columns = NEW_COLS.slice();
    /* WHAT *THIS* CALL ASKED FOR, kept for itself.
    
       Six accounts are asked at once. The retry used to be guarded on
       `columns.length` -- the shared list, read AFTER the answers came back
       -- so the first account to be told "no such column" emptied it, and
       the other five then found it already empty, decided there was nothing
       to drop back to, and reported a broken collection instead of asking
       again. Five of six accounts vanished from the feed of any database
       that had not had the migration run. It only surfaced when a second
       new column arrived, but it was there the whole time. */
    const asked = columns.slice();
    let { data, error } = await askFor(id, asked);
    if (error && missingColumn(error) && asked.length) {
      note('This database is missing a column the feed asks for — run card_photos.sql and hide_from_feed.sql.');
      columns = [];
      ({ data, error } = await askFor(id, []));
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


  /* ======================================================================
     EARNED CARDS IN THE FEED.

     A post has been one of two things since this was built: a card somebody
     added, or a photo they put up. This is the third -- the reward cards
     somebody earned, gold-framed, because the whole point of a rare card is
     that other people see you get it.

     NOTHING IS STORED FOR THIS. There is no reward_posts table. A post IS
     the rows in user_reward_cards, grouped by when they landed, so the feed
     can never drift from the ledger and earning a card stays one insert.

     A BATCH IS WHAT ARRIVED TOGETHER. Six cards in the first two minutes of
     an account is normal, and six separate posts would be that person's
     first act in the app being to bury everyone else's. One post, swipe
     through them -- the rail already does that everywhere else.
     ====================================================================== */
  const REWARDS_PER_ACCOUNT = 6;     /* rows asked for, not posts */
  /* THIRTY MINUTES, not four. The window chains off the PREVIOUS card, not
     the first, so a steady signup collapses into one post either way -- but
     four minutes split the person who earns a few, wanders off, and comes
     back to add a card. That is a normal first session and it should not
     cost them three posts in everybody else's feed. */
  const BATCH_GAP_MS = 30 * 60 * 1000;

  const rewardCursors = new Map();
  const rewardSpent   = new Set();
  let   rewardPostsOff = false;      /* the migration has not been run */
  let   firstRewardAsk = null;

  /* Rows come back newest first. Walk them and start a new batch whenever
     the gap to the previous one is bigger than BATCH_GAP_MS. */
  function rewardBatches(rows) {
    const out = [];
    let cur = null;
    rows.forEach(r => {
      const t = new Date(r.earned_at).getTime();
      if (cur && (cur.last - t) <= BATCH_GAP_MS) {
        cur.rows.push(r);
        cur.last = t;
      } else {
        if (cur) out.push(cur);
        cur = { rows: [r], last: t };
      }
    });
    if (cur) out.push(cur);
    return out;
  }

  const rewardRow = (batch) => {
    const rows = batch.rows;
    const first = rows[0];
    const who = faces[first.user_id];
    /* The key is the FIRST card's row id, so a post keeps its name even if
       another card lands in the same batch a moment later. */
    return {
      kind: 'reward',
      key: 'rw' + first.id,
      rowId: first.id,
      userId: first.user_id,
      mine: !!(me && first.user_id === me),
      who: (who && who.name) || 'A collector',
      avatar: (who && who.avatar) || '',
      caption: '',
      name: '',
      when: first.earned_at,
      secret: rows.some(r => r.reward_cards && r.reward_cards.secret),
      cards: rows.map(r => r.reward_cards).filter(Boolean),
      pics: rows.map(r => r.reward_cards)
                .filter(Boolean)
                .map(c => ({ u: c.thumb_url || c.art_url || '' }))
                .filter(x => x.u),
      shape: 'portrait'
    };
  };

  async function fetchRewardsForAccount(id) {
    if (rewardPostsOff || rewardSpent.has(id)) return [];
    /* One account asks first. If the table is not there, nobody else asks. */
    if (firstRewardAsk) {
      try { await firstRewardAsk; } catch (_) {}
      if (rewardPostsOff) return [];
    }
    let data = null, error = null;
    try {
      let q = sb.from('user_reward_cards')
        .select('id, user_id, card_id, earned_at, ' +
                'reward_cards(card_number, name, task_line, secret, thumb_url, art_url)')
        .eq('user_id', id)
        .order('earned_at', { ascending: false })
        .limit(REWARDS_PER_ACCOUNT);
      if (rewardCursors.has(id)) q = q.lt('earned_at', rewardCursors.get(id));
      const run = Promise.resolve(q);
      if (!firstRewardAsk) firstRewardAsk = run;
      ({ data, error } = await run);
    } catch (e) { error = e; }

    if (error) {
      if (noTable(error)) {
        rewardPostsOff = true;
        note('Reward card posts are not switched on yet — run infinite_rewards.sql.');
      } else {
        note('Could not read reward posts: ' + (error.message || error.code || 'unknown'));
      }
      rewardSpent.add(id);
      return [];
    }

    const rows = data || [];
    if (rows.length) rewardCursors.set(id, rows[rows.length - 1].earned_at);
    if (rows.length < REWARDS_PER_ACCOUNT) rewardSpent.add(id);

    /* The LAST batch of a page is dropped unless the account is spent: it may
       still be growing on the far side of the cursor, and a post that gains a
       card on the next scroll is a post that changes under somebody's thumb. */
    const batches = rewardBatches(rows);
    if (batches.length > 1 && !rewardSpent.has(id)) {
      const held = batches.pop();
      rewardCursors.set(id, held.rows[0].earned_at);
    }
    return batches.map(rewardRow);
  }


  /* ======================================================================
     SHARING AN EARNED CARD.

     A link is the wrong thing to share here for two reasons. The static
     post pages are built for c- and p- keys only, so an r- permalink is a
     404 -- and more to the point, the card IS the thing. A picture of it in
     somebody's feed on Facebook does the work that a blue link never will.

     So this paints one: the card, who earned it, and the domain, at a size
     Instagram and Facebook are happy with. The URL that rides along with it
     points at that person's collection page, which is a page that exists.
     ====================================================================== */
  const SHARE_W = 1080, SHARE_H = 1350;   /* 4:5, the friendliest social shape */

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      /* Without this the canvas is tainted and toBlob throws. The bucket is
         public and sends the header; if it ever stops, we fall back. */
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  /* Tracking on canvas. Chrome and Safari both take ctx.letterSpacing now;
     anywhere that does not, setting it is a no-op and the type just sits
     tighter, which is not a broken image. */
  function setType(x, weight, size, spacing) {
    x.font = weight + ' ' + size + 'px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
    try { x.letterSpacing = (spacing || 0) + 'px'; } catch (_) {}
  }

  /* A hairline with a gap in the middle for a word to sit in. */
  function ruledLine(x, cx, y, half, gap, color) {
    x.strokeStyle = color; x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(cx - half, y); x.lineTo(cx - gap, y);
    x.moveTo(cx + gap, y);  x.lineTo(cx + half, y);
    x.stroke();
  }

  async function rewardShareImage(p) {
    const lead = (p.cards && p.cards[0]) || {};
    const src = lead.art_url || lead.thumb_url;
    if (!src) return null;

    const img = await loadImage(src);
    /* The logo is on our own origin, so it cannot taint the canvas. If it
       fails to load the image still works -- it just loses the badge. */
    let logo = null;
    try { logo = await loadImage(location.origin + '/assets/logo.webp'); } catch (_) {}

    const c = document.createElement('canvas');
    c.width = SHARE_W; c.height = SHARE_H;
    const x = c.getContext('2d');
    const mid = SHARE_W / 2;
    const gold = p.secret ? '#ffe9a8' : '#ffc13d';

    x.fillStyle = '#04070f';
    x.fillRect(0, 0, SHARE_W, SHARE_H);
    const glow = x.createRadialGradient(mid, 520, 40, mid, 520, 640);
    glow.addColorStop(0, p.secret ? 'rgba(255,233,168,.32)' : 'rgba(255,193,61,.24)');
    glow.addColorStop(1, 'rgba(255,193,61,0)');
    x.fillStyle = glow;
    x.fillRect(0, 0, SHARE_W, SHARE_H);

    x.textAlign = 'center';

    /* WHO, between two rules. The name is the loud half. */
    const who = (p.who || 'A collector').toUpperCase();
    const verb = p.secret ? 'FINISHED THE SET' : 'EARNED';
    setType(x, '900', 27, 3.5);
    const wName = x.measureText(who).width;
    setType(x, '700', 27, 3.5);
    const wVerb = x.measureText(' ' + verb).width;
    const startX = mid - (wName + wVerb) / 2;

    x.textAlign = 'left';
    setType(x, '900', 27, 3.5);
    x.fillStyle = '#e9f0fa';
    x.fillText(who, startX, 84);
    setType(x, '700', 27, 3.5);
    x.fillStyle = gold;
    x.fillText(' ' + verb, startX + wName, 84);
    x.textAlign = 'center';

    ruledLine(x, mid, 74, 470, (wName + wVerb) / 2 + 22,
              p.secret ? 'rgba(255,233,168,.45)' : 'rgba(255,193,61,.38)');

    /* THE LAYOUT IS WORKED OUT BACKWARDS, from the bottom up.
       The badge and the address are a fixed block at the foot; the lines of
       type above them vary -- a batch has one more line than a single card
       -- so the CARD takes whatever is left. Sizing the card first and
       hoping is how "+ 2 MORE" ends up printed through the logo. */
    const LOGO = 132;
    const domainY = SHARE_H - 46;
    const logoTop = domainY - 34 - LOGO;

    const hasTask = !!lead.task_line;
    const extra   = (p.cards && p.cards.length > 1) ? 1 : 0;
    const textH   = 74 + (hasTask ? 44 : 0) + (extra ? 40 : 0);

    const cy = 124;
    const ch = Math.round(logoTop - 34 - textH - cy);
    const cw = Math.round(ch * 5 / 7);
    const cx = (SHARE_W - cw) / 2;

    x.save();
    x.shadowColor = 'rgba(0,0,0,.8)';
    x.shadowBlur = 54; x.shadowOffsetY = 20;
    roundRect(x, cx, cy, cw, ch, 28);
    x.fillStyle = '#04070f';
    x.fill();
    x.restore();
    x.save();
    roundRect(x, cx, cy, cw, ch, 28);
    x.clip();
    x.drawImage(img, cx, cy, cw, ch);
    x.restore();
    x.strokeStyle = p.secret ? 'rgba(255,233,168,.9)' : 'rgba(255,193,61,.65)';
    x.lineWidth = 3;
    roundRect(x, cx, cy, cw, ch, 28);
    x.stroke();

    /* THE NAME. The biggest thing on the picture after the card. */
    let y = cy + ch + 74;
    setType(x, '900', 58, -0.5);
    x.fillStyle = '#ffffff';
    x.fillText(lead.name || 'Infinite Rewards', mid, y);

    /* WHAT IT TOOK, ruled on both sides. */
    if (hasTask) {
      y += 44;
      setType(x, '800', 21, 3);
      x.fillStyle = '#8ba5c8';
      const t = lead.task_line.toUpperCase();
      x.fillText(t, mid, y);
      ruledLine(x, mid, y - 7, 420, x.measureText(t).width / 2 + 20, 'rgba(139,165,200,.32)');
    }

    if (extra) {
      y += 40;
      setType(x, '800', 22, 1);
      x.fillStyle = gold;
      x.fillText('+ ' + (p.cards.length - 1) + ' MORE', mid, y);
    }

    /* THE BADGE. Jeff's logo already says INFINITE PULLS, so the words under
       it would be saying it twice -- the address is what the logo does not
       carry, so the address is what goes there. */
    if (logo) {
      x.save();
      x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 26; x.shadowOffsetY = 8;
      x.drawImage(logo, mid - LOGO / 2, logoTop, LOGO, LOGO);
      x.restore();
    } else {
      setType(x, '900', 30, 4);
      x.fillStyle = gold;
      x.fillText('INFINITE PULLS', mid, logoTop + LOGO - 28);
    }
    setType(x, '800', 25, 2.5);
    x.fillStyle = gold;
    x.fillText('infinitepulls.com', mid, domainY);

    /* JPEG, not PNG. The card art is a painting, so PNG buys nothing but
       two megabytes -- and two megabytes through a phone's share sheet on
       shop wifi is the difference between sharing it and giving up. */
    return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
  }

  /* The address that goes with it. NOT the post permalink -- there is no
     static page for an r- key -- their collection page, which is real. */
  function rewardShareUrl(p) {
    const who = (faces[p.userId] && faces[p.userId].name) || '';
    return /^[A-Za-z0-9_-]{3,24}$/.test(who)
      ? location.origin + '/' + who
      : location.origin + '/feed-next/';
  }

  async function shareReward(p, btn) {
    const url = rewardShareUrl(p);
    const lead = (p.cards && p.cards[0]) || {};
    const text = (p.who || 'A collector') + ' earned ' + (lead.name || 'a reward card') +
                 ' on Infinite Pulls';
    const say = (word) => {
      const lbl = btn && btn.querySelector('span:last-child');
      if (!lbl) return;
      const was = lbl.textContent;
      lbl.textContent = word;
      setTimeout(() => { lbl.textContent = was; }, 1800);
    };

    let blob = null;
    try { blob = await rewardShareImage(p); } catch (_) { /* fall through to a link */ }

    if (blob && navigator.canShare) {
      const file = new File([blob], 'infinite-reward.jpg', { type: 'image/jpeg' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text, url }); return; }
        catch (_) { return; }   /* they backed out; that is not an error */
      }
    }
    if (navigator.share) {
      try { await navigator.share({ title: text, text, url }); return; } catch (_) { return; }
    }
    /* No share sheet at all -- a desktop. Hand them the picture. */
    if (blob) {
      try {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'infinite-reward.jpg';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        say('SAVED');
        return;
      } catch (_) {}
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => say('COPIED')).catch(() => {});
    }
  }

  /* The rendered posts, by key, so the share handler can get back to the
     card list from the article element it was given. Reward posts only --
     a handful per account, ever. */
  const rewardPosts = new Map();

  function rewardHTML(p, i) {
    rewardPosts.set(p.key, p);
    const hk = postId(p);
    const hyped = heatMine.has(hk);
    const n = heatCount.get(hk) || 0;
    const lvl = heatLevel(n + (hyped ? 1 : 0));
    const many = p.cards.length > 1;
    const lead = p.cards[0] || {};

    return `
    <article class="post is-reward${p.secret ? ' is-secret' : ''}" data-key="${esc(p.key)}"
             data-when="${esc(p.when || '')}" data-row="${esc(p.rowId || '')}"
             data-owner="${esc(p.userId || '')}" data-link="${esc(shareLink(p))}">
      <header class="post-top">
        <button class="avatar-btn" type="button" data-open-person="${esc(p.userId)}"
                data-open-label="${esc(p.who || 'A collector')}"
                aria-label="See ${esc(p.who || 'this collector')}&rsquo;s cards">
          <img class="avatar" src="${esc(p.avatar || '../assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='../assets/hyde-bot.png'">
        </button>
        <button class="who who-btn" type="button" data-open-person="${esc(p.userId)}"
                data-open-label="${esc(p.who || 'A collector')}">
          <span class="nameline"><b>${esc(p.who || 'A collector')}</b>${badgeOf(faces[p.userId])}</span>
          ${subLine(p, day(p.when) || 'Earned a reward card')}
        </button>
        ${p.mine ? '' : `<button class="follow${following(p.userId) ? ' on' : ''}" type="button"
                     data-follow="${esc(p.userId || '')}">${following(p.userId) ? 'FOLLOWING' : 'FOLLOW'}</button>`}
      </header>

      ${/* WHAT THEY DID, NOT JUST THAT THEY DID SOMETHING.
            This line used to read EARNED AN INFINITE REWARD CARD and stop,
            which tells somebody scrolling past that a thing exists and
            nothing whatsoever about how to get one. The task line is the
            instruction -- FIRST POST HEATED UP, YOUR OWN PHOTO OF A CARD --
            so it goes on the front of the post where it is doing the
            teaching, rather than under the picture where it was a footnote.

            Two lines: the label on top, quiet, and the action under it in
            the size that gets read. The caption below drops its copy of the
            task line, because the same sentence twice on one post reads as
            a mistake. */''}
      <p class="reward-flag">${p.secret ? 'INFINITE REWARD EARNED' : (many
          ? 'INFINITE REWARDS EARNED' : 'INFINITE REWARD EARNED')}<b>${p.secret
          ? 'FINISHED THE SET &mdash; ALL FIFTY CARDS'
          : esc(lead.task_line || 'A REWARD CARD') +
            (many ? ` &middot; AND ${p.cards.length - 1} MORE` : '')}</b></p>

      <div class="frame" data-shape="portrait">
        <div class="rail">
          ${p.cards.map(c => `<figure>
            <img src="${esc(c.thumb_url || c.art_url || '')}" alt="${esc(c.name || '')}"
                 loading="lazy" decoding="async" ${fallback}>
          </figure>`).join('')}
        </div>
        ${many ? `<span class="reward-count">${p.cards.length}</span>` : ''}
      </div>

      <div class="acts is-photo">
        <button class="act hype${hyped ? ' on' : ''}" data-hype="${esc(hk)}" data-level="${lvl}"
                aria-pressed="${hyped}" aria-label="Heat">
          <span class="ring">${heatMark(lvl)}</span>
          <span><span class="lbl">HEAT</span><span class="n">${n}</span></span>
        </button>
        <button class="act" data-comment aria-expanded="false">${I.chat}<span>COMMENT</span><b class="cn" hidden></b></button>
        <button class="act" data-share>${I.share}<span>SHARE</span></button>
      </div>

      <p class="caption reward-cap"><b>${esc(p.who || 'A collector')}</b>${badgeOf(faces[p.userId])}
        ${many
          ? `${esc(lead.name || '')} and ${p.cards.length - 1} more`
          : esc(lead.name || '')}</p>

      ${talkHTML(p)}
    </article>`;
  }

  /* ---- ONE PERSON'S PAGE IS A TIMELINE, NOT A MIX ------------------------
   *
   * The MAIN feed mixes on purpose: it rotates between people so everybody
   * gets a fair turn and you meet somebody you have not seen before. That is
   * the right answer for a room full of strangers.
   *
   * It is the wrong answer for ONE person. Tapping a name is asking "what
   * has this person been up to", and the answer to that is newest first,
   * the whole way down -- cards, pictures and rewards in one line, the way
   * anybody who has ever opened a profile expects. Alternating one card and
   * one picture put a photograph from this morning underneath a card from
   * last week, which reads as broken rather than as fair.
   *
   * THE HOLD-BACK IS THE WHOLE TRICK. The three sources are three separate
   * queries, each newest-first and each paging on its own. Sorting one
   * batch is not enough: four cards from today and two pictures from last
   * week come back together, and the NEXT batch of cards is still from
   * today -- so a picture shown now would be jumped by a card shown later.
   *
   * So nothing is released until it cannot be beaten. Each source that has
   * more to give reports the oldest thing it has handed over; anything
   * newer than ALL of those is safe to show, because nothing still coming
   * can be newer than that. The rest waits for the next batch, and when
   * every source is exhausted the buffer empties out. */
  const personBuf = [];
  const timeOf = (p) => String((p && p.when) || '');

  function releaseFromBuffer(id) {
    /* The oldest thing each UNFINISHED source has handed over. A finished
       source has nothing left to beat anything with, so it gets no vote. */
    const floors = [];
    if (!cardSpent.has(id) && cursors.has(id)) floors.push(String(cursors.get(id)));
    if (!photoPostsOff && !photoSpent.has(id) && photoCursors.has(id)) floors.push(String(photoCursors.get(id)));
    if (!rewardPostsOff && !rewardSpent.has(id) && rewardCursors.has(id)) floors.push(String(rewardCursors.get(id)));

    const done = cardSpent.has(id)
      && (photoPostsOff || photoSpent.has(id))
      && (rewardPostsOff || rewardSpent.has(id));

    personBuf.sort((a, b) => timeOf(b).localeCompare(timeOf(a)));

    if (done || !floors.length) {          /* nothing is still coming */
      personBuf.splice(0).forEach(enqueue);
      return;
    }
    const floor = floors.sort().reverse()[0];
    let n = 0;
    while (n < personBuf.length && timeOf(personBuf[n]) >= floor) n++;
    personBuf.splice(0, n).forEach(enqueue);
  }

  async function fetchForAccount(id) {
    const [cards, pics, won] = await Promise.all([
      fetchCardsForAccount(id), fetchPhotosForAccount(id), fetchRewardsForAccount(id)
    ]);

    if (filter && filter.kind === 'person') {
      personBuf.push(...(won || []), ...(cards || []), ...(pics || []));
      releaseFromBuffer(id);
      /* Not finished while the buffer still holds anything: that would end
         the page with posts in hand and nothing on screen. */
      if (cardSpent.has(id)
          && (photoPostsOff || photoSpent.has(id))
          && (rewardPostsOff || rewardSpent.has(id))
          && !personBuf.length) spent.add(id);
      return;
    }

    /* deal() interleaves cards and photos so one kind never blocks. Reward
       posts are rare by comparison -- a handful ever, per account -- so they
       go in at the front of that account's queue rather than through the
       shuffle, and the round-robin between ACCOUNTS still keeps one person
       from taking over a screenful. */
    (won || []).forEach(enqueue);
    deal(cards || [], pics || []).forEach(enqueue);
    if (cardSpent.has(id)
        && (photoPostsOff || photoSpent.has(id))
        && (rewardPostsOff || rewardSpent.has(id))) spent.add(id);
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
    const asked = columns.slice();       /* same reasoning as fetchCardsForAccount */
    let { data, error } = await run(asked);
    if (error && missingColumn(error) && asked.length) {
      columns = []; ({ data, error } = await run([]));
    }
    if (error) { note('Could not search collections: ' + (error.message || 'unknown')); drained = true; return; }
    const rows = data || [];
    if (rows.length) cursor = rows[rows.length - 1].added_at;
    if (rows.length < PAGE * 3) drained = true;
    await facesFor([...new Set(rows.map(r => r.user_id))]);
    rows.filter(r => following(r.user_id)).forEach(r => enqueue(cardRow(r)));
  }

  async function fetchCards() {
    /* THE SHOP'S OWN FEED. Narrowed to the shelf, there are no collections
       to walk -- asking for them would fill the screen with other people's
       cards under a chip that says Infinite Pulls.

       ONE EXCEPTION, AND IT IS THE POINT OF THE CHIP: the store's own
       account. Its pictures are the shop's posts, so a chip that says
       Infinite Pulls has to show them -- otherwise tapping the name on the
       store's own poster takes you to a page the poster is not on, which
       reads as a bug to everybody who tries it. Its photos only: the store
       account keeps no collection, and asking for one costs a round trip to
       be told so. */
    if (filter && filter.kind === 'shop') {
      if (STORE_ID && !photoSpent.has(STORE_ID) && !photoPostsOff) {
        const pics = await fetchPhotosForAccount(STORE_ID);
        (pics || []).forEach(enqueue);
        if (pics && pics.length) return;
      }
      drained = true; return;
    }
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
    if (filter && filter.kind === 'person') { shopDrained = true; return; }
    let q = sb.from('shop_available')
      .select('clover_item_id, card_id, name, set_name, card_number, price, available, photo_url, art_url, added_at, hidden_online')
      .order('added_at', { ascending: false })
      .limit(PAGE * 3);
    if (filter && filter.kind === 'card') q = q.ilike('name', '%' + filter.name + '%');
    if (shopCursor) q = q.lt('added_at', shopCursor);
    const { data, error } = await q;
    if (error) { note('Could not read the shop: ' + (error.message || 'unknown')); shopDrained = true; return; }
    if (!data) { shopDrained = true; return; }
    if (data.length) shopCursor = data[data.length - 1].added_at;
    if (data.length < PAGE * 3) shopDrained = true;
    /* INTO THE QUEUE, not into the buffer. The buffer is drawn only after
       the round-robin has been emptied, which put the shelf back at the end
       of the feed by a different route. */
    data.filter(usableShop).map(toPost).forEach(enqueue);
  }

  async function fetchRows() {
    if (!sb) { drained = true; shopDrained = true; return; }
    /* BOTH, TOGETHER. The shelf is topped up whenever Jeff's queue is
       getting short rather than when the rest of the feed runs out, so his
       cards are always available to be dealt into the next screenful. Asked
       for in parallel, because one waiting on the other is two round trips
       for no reason. */
    const shopLow = !shopDrained && (queues.get(SHOP_WHO) || []).length < MAX_PER_PAGE;
    const jobs = [];
    if (!drained) jobs.push(fetchCards());
    if (shopLow) jobs.push(fetchShop());
    if (jobs.length) await Promise.all(jobs);
  }

  async function fetchPage() {
    let guard = 0;
    /* keep asking while neither the queues nor the plain buffer can fill a
       screenful -- and, while still on people, keep asking a little longer if
       only ONE account has anything queued, because a second voice makes the
       round-robin worth doing at all */
    while (!finished() && guard++ < 12) {
      const enough = (queued() >= PAGE && queues.size > 2)
        || (drained && shopDrained && (queued() || buffer.length));
      if (enough) break;
      await fetchRows();
    }
    const fromPeople = takeRound(PAGE);
    if (fromPeople.length >= PAGE) return fromPeople;
    return fromPeople.concat(buffer.splice(0, PAGE - fromPeople.length));
  }

  const finished = () => drained && shopDrained && !queued() && !buffer.length;

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
      /* PAINTED AFTER THE POSTS ARE ON THE PAGE. The numbers are FETCHED
         before they are drawn, so nothing pops in a beat late -- but
         painting them before the markup existed wrote them onto nothing at
         all, and every badge stayed hidden while the data sat right there
         in the map. */
      /* One request for the whole screenful, once the posts are actually on
         the page -- painting them before the markup existed wrote the
         numbers onto nothing and every badge stayed hidden while the data
         sat right there in the map. */
      await refreshCounts();
      refreshHeat();
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
  /* async because the heat button writes a row. Every preventDefault in
     here still runs before any await, which is the only thing that would
     have broken by making it so. */
  document.addEventListener('click', async (e) => {
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
    /* YOUR OWN CARD, OFF THE FEED -- AND STILL YOURS.
       The post collapses to a line rather than vanishing, because REMOVE on
       something you own reads as "delete" no matter what the button says,
       and the cheapest way to be believed is to leave the way back on
       screen. The row is never touched; one boolean is. */
    const hide = e.target.closest('[data-hide-card]');
    if (hide) {
      const id = hide.getAttribute('data-hide-card');
      const art = hide.closest('.post');
      if (!id || !sb || !art) return;
      hide.disabled = true; hide.textContent = 'REMOVING…';
      sb.from('user_cards').update({ hidden_feed: true }).eq('id', id).then(({ error }) => {
        hide.disabled = false; hide.textContent = 'REMOVE';
        if (error) {
          note(missingColumn(error)
            ? 'Keeping a card off the feed is not switched on yet — run hide_from_feed.sql.'
            : 'Could not take that one off the feed: ' + (error.message || error.code || 'unknown'));
          return;
        }
        art.classList.add('gone-from-feed');
        art.insertAdjacentHTML('afterbegin',
          `<div class="undo-strip"><span>Off the feed. It is still in your collection.</span>
             <button type="button" data-unhide-card="${esc(id)}">UNDO</button></div>`);
      });
      return;
    }
    const unhide = e.target.closest('[data-unhide-card]');
    if (unhide) {
      const id = unhide.getAttribute('data-unhide-card');
      const art = unhide.closest('.post');
      if (!id || !sb || !art) return;
      unhide.disabled = true;
      sb.from('user_cards').update({ hidden_feed: false }).eq('id', id).then(({ error }) => {
        if (error) {
          unhide.disabled = false;
          note('Could not put that one back: ' + (error.message || error.code || 'unknown'));
          return;
        }
        art.classList.remove('gone-from-feed');
        const strip = art.querySelector('.undo-strip');
        if (strip) strip.remove();
      });
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
    if (hype) {
      /* The button's own key, not the post's row name. A shelf row has no
         post id at all, so its button carries 'c-' and nothing else -- that
         is the shelf, and heat does not apply to it any more than comments
         do. Same boundary, same reason: no owner, no thread, no mark. */
      const key = hype.getAttribute('data-hype');
      if (!key || key.length < 3) { bellSay('Heat is for collectors\u2019 cards.', 'bad'); return; }
      /* SIGNED OUT IT SAYS WHY. It used to work and write to this phone,
         which meant somebody could mark twenty cards, sign in, and find the
         lot of them blank. Better to be told once than to lose the lot. */
      if (!me) { bellSay('Sign in to add heat.', 'bad'); return; }
      if (heatOff) { bellSay('Heat is not switched on yet.', 'bad'); return; }
      if (hype.dataset.busy) return;
      hype.dataset.busy = '1';

      const was = heatMine.has(key);
      const wasN = heatCount.get(key) || 0;

      /* MOVED IN THEIR HAND, THEN WRITTEN. A tap that waits on the network
         before the number moves feels broken on a bad signal -- and being
         the mark that tips a card over twenty and watching it catch fire is
         the whole reason for having a threshold. If the write fails it is
         put straight back, so the page never keeps a number the database
         does not agree with. */
      if (was) { heatMine.delete(key); heatCount.set(key, Math.max(0, wasN - 1)); }
      else     { heatMine.add(key);    heatCount.set(key, wasN + 1); }
      paintHeat();

      const post = hype.closest('.post');
      const owner = (post && post.getAttribute('data-owner')) || null;

      try {
        let error = null;
        if (was) {
          ({ error } = await sb.from('post_heat').delete()
            .eq('post_key', key).eq('user_id', me));
        } else {
          /* post_owner rides along so the trigger knows who to tell. The
             shop's own posts carry no owner, and heat on those is counted
             and tells nobody -- which is the right answer for a shelf. */
          ({ error } = await sb.from('post_heat')
            .insert({ post_key: key, user_id: me, post_owner: owner || null }));
          /* 23505 = already there. Somebody double-tapped, or two tabs are
             open. The row we wanted exists, so this is a success. */
          if (error && error.code === '23505') error = null;
        }
        if (error) throw error;
      } catch (err) {
        if (was) { heatMine.add(key); } else { heatMine.delete(key); }
        heatCount.set(key, wasN);
        paintHeat();
        bellSay('That did not save. Try again in a moment.', 'bad');
      }
      delete hype.dataset.busy;
      return;
    }
    const save = e.target.closest('[data-save]');
    if (save) {
      tapWish(save, {
        cardId: save.getAttribute('data-card') || '',
        name:   save.getAttribute('data-cardname') || '',
        set:    save.getAttribute('data-cardset') || '',
        art:    save.getAttribute('data-cardart') || ''
      });
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
    if (snap) {
      /* ONE TAP SETS IT EVERYWHERE. Toggling only the post under the thumb
         meant scrolling into an endless supply of boxes in the old state,
         which is not a preference, it is a chore. The choice is written down
         and every CARD PULSE on the page follows it in the same frame. */
      const nowShut = !snap.closest('.snap').classList.contains('shut');
      setPulseShut(nowShut);
      document.querySelectorAll('.snap').forEach(x => {
        x.classList.toggle('shut', nowShut);
        const head = x.querySelector('.snap-head');
        if (head) head.setAttribute('aria-expanded', nowShut ? 'false' : 'true');
      });
      return;
    }

    const share = e.target.closest('[data-share]');
    if (share && post) {
      /* A reward card shares as a PICTURE. See shareReward. */
      const rk = post.classList.contains('is-reward') && post.getAttribute('data-key');
      if (rk && rewardPosts.has(rk)) { shareReward(rewardPosts.get(rk), share); return; }
      const cap = post.querySelector('.caption');
      const title = cap ? cap.textContent.trim() : 'Infinite Pulls';
      /* THE POST, NOT THE PAGE. This used to share location.href -- whatever
         address the feed happened to be sitting on -- so every card anybody
         ever shared landed the reader on the top of the feed looking at
         somebody else's cards. The one thing a share has to do is arrive at
         the thing that was shared. */
      const url = post.getAttribute('data-link') || location.href;
      if (navigator.share) { navigator.share({ title, url }).catch(() => {}); return; }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
          /* SAY SO. A share sheet announces itself; a silent copy is
             indistinguishable from a button that does nothing. */
          const lbl = share.querySelector('span:last-child');
          if (!lbl) return;
          const was = lbl.textContent;
          lbl.textContent = 'COPIED';
          setTimeout(() => { lbl.textContent = was; }, 1800);
        }).catch(() => {});
      }
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

  /* COMING BACK TO THE TAB REFRESHES THE COUNT. A phone keeps this page
     alive for days on a home screen; without this the badge is whatever it
     was when you last looked, which is worse than no badge. Cheap -- one
     integer, and only when the page is actually being looked at. */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { loadUnread(); rwdSoon(600); }
  });

  /* ======================================================================
     NOTIFICATIONS.

     The count is a COUNT, fetched with an rpc that returns one integer
     rather than a page of rows -- the badge does not need the contents to
     know whether to appear, and asking for rows to count them is how a bell
     ends up being the most expensive thing on the page.

     The list is fetched only when the sheet is opened. Most people never
     open it, and nobody needs twenty rows they are not looking at.

     A TABLE THAT IS NOT THERE YET IS NOT AN ERROR. Until notifications.sql
     has been run the rpc does not exist; that is noticed once, the bell
     stays dark, and nothing asks again. Notifications are a bonus, never a
     gate -- the same rule the photo uploader follows.
     ====================================================================== */
  let unread = 0;
  let alertsOff = false;

  async function loadUnread() {
    if (alertsOff || !sb || !me) { unread = 0; paintNavDot(); return; }
    try {
      const { data, error } = await sb.rpc('unread_notifications');
      if (error) {
        /* 42883 = no such function, PGRST202 = PostgREST cannot see it. */
        if (error.code === '42883' || error.code === 'PGRST202' ||
            /could not find the function|does not exist/i.test(error.message || '')) {
          alertsOff = true;
          note('Notifications are not switched on yet — run notifications.sql.');
        } else {
          note('Could not read notifications: ' + (error.message || error.code));
        }
        unread = 0;
      } else {
        unread = Number(data) || 0;
      }
    } catch (_) { unread = 0; }
    paintNavDot();
  }

  function paintNavDot() {
    const dot = document.getElementById('navdot');
    if (!dot) return;
    if (!me || unread < 1) { dot.hidden = true; dot.textContent = ''; return; }
    /* 99+ rather than a number that stretches the circle out of round. */
    dot.textContent = unread > 99 ? '99+' : String(unread);
    dot.hidden = false;
    const link = document.querySelector('[data-menu]');
    if (link) link.setAttribute('aria-label',
      'Menu — ' + unread + (unread === 1 ? ' new notification' : ' new notifications'));
  }

  /* HOW LONG AGO, in the fewest characters that are still true. */
  function ago(iso) {
    const then = Date.parse(iso);
    if (!then) return '';
    const s = Math.max(0, (Date.now() - then) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /* WHAT EACH KIND SAYS. The first four are somebody doing something to
     you and read as "<name> <did this>". The rest are the app speaking --
     no actor, so the sentence has to stand on its own. */
  const ALERT_SAYS = {
    comment: 'commented on your card',
    reply:   'replied to you',
    heart:   'liked your comment',
    follow:  'followed you',
    heat:    'added heat to your card'
  };

  /* Written as a whole line because there is nobody to put in front of it.
     The detail is the name as it was WHEN IT HAPPENED, copied into the row
     rather than looked up now -- a card renamed next month must not rewrite
     what somebody was told last month. */
  const ALERT_SYSTEM = {
    dex:      (d) => `You earned <b>${esc(d || 'a new card')}</b>`,
    goal:     (d) => `Goal complete &mdash; <b>${esc(d || 'a goal')}</b>`,
    wishlist: (d) => `<b>${esc(d || 'A card you want')}</b> is at the shop`
  };

  /* The badge in place of a face, for the rows nobody sent. */
  const ALERT_MARK = {
    dex:      '<svg viewBox="0 0 24 24"><path d="M8.5 9.5a3.5 3.5 0 1 0 0 5c1.4-1.2 2.2-2.6 3.5-2.5 1.3-.1 2.1 1.3 3.5 2.5a3.5 3.5 0 1 0 0-5c-1.4 1.2-2.2 2.6-3.5 2.5-1.3.1-2.1-1.3-3.5-2.5z"/></svg>',
    goal:     '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>',
    wishlist: '<svg viewBox="0 0 24 24"><path d="M2.5 3.5h2.3l2.6 11.3h9.9"/><path d="M6.3 6.6h14.2l-1.8 6.6H7.8"/><circle cx="9.5" cy="19.3" r="1.5"/><circle cx="17.5" cy="19.3" r="1.5"/></svg>'
  };

  /* The sheet opens IMMEDIATELY with a waiting line and fills itself in.
     Opening a sheet only once a query has come back means tapping the bell
     does nothing for a beat, which reads as a dead button. */
  function alertsShell() {
    return {
      who: 'Notifications<small>' +
           (unread ? unread + (unread === 1 ? ' new' : ' new') : 'Nothing new') + '</small>',
      rows: '<div class="alert-empty">Looking&hellip;</div>'
    };
  }

  async function fillAlerts() {
    const wrap = document.getElementById('menurows');
    if (!wrap || !sb || !me) return;

    let rows = [];
    try {
      const { data, error } = await sb.from('notifications')
        .select('id, actor_id, kind, post_key, comment_id, created_at, read_at, detail, href')
        .order('created_at', { ascending: false })
        .limit(40);
      if (error) throw error;
      rows = data || [];
    } catch (e) {
      wrap.innerHTML = '<div class="alert-empty">Could not load these right now.<br>' +
                       esc((e && e.message) || '') + '</div>';
      return;
    }

    if (!rows.length) {
      wrap.innerHTML = '<div class="alert-empty">Nothing yet.<br>' +
        'When somebody comments on your card, likes what you wrote, or follows you, it shows up here.</div>';
      await clearUnread();
      return;
    }

    /* The names behind the ids, in one query rather than one per row -- the
       same two-step the feed uses, because notifications.actor_id points at
       auth.users and PostgREST has no foreign key to embed profiles across. */
    await facesFor([...new Set(rows.map(r => r.actor_id).filter(Boolean))]);

    /* What each comment actually said, so a notification reads like the
       thing that happened rather than like a filing reference. Hidden
       comments are already gone from this table, so anything still pointed
       at is safe to quote. */
    const cids = [...new Set(rows.map(r => r.comment_id).filter(Boolean))];
    const bodies = new Map();
    if (cids.length) {
      try {
        const { data } = await sb.from('post_comments').select('id, body').in('id', cids);
        (data || []).forEach(c => bodies.set(c.id, c.body));
      } catch (_) { /* the line reads fine without the quote */ }
    }

    wrap.innerHTML = rows.map(r => {
      const system = !r.actor_id;
      const who  = system ? null : faces[r.actor_id];
      const name = (who && who.name) || 'Somebody';
      const pic  = (who && who.avatar) || '';
      const said = bodies.get(r.comment_id) || '';

      const line = system
        ? (ALERT_SYSTEM[r.kind] ? ALERT_SYSTEM[r.kind](r.detail) : esc(r.detail || ''))
        : `<b>${esc(name)}</b> ${esc(ALERT_SAYS[r.kind] || 'did something')}`;

      const mark = system
        ? `<span class="face is-app">${ALERT_MARK[r.kind] || ALERT_MARK.dex}</span>`
        : `<span class="face">${pic
            ? `<img src="${esc(pic)}" alt="" onerror="this.onerror=null;this.parentNode.textContent='${esc(initialsFor(name))}'">`
            : esc(initialsFor(name))}</span>`;

      /* Where it goes. A post-shaped one goes to the post; a system one goes
         wherever the row says, which was written down when it was sent. */
      const go = system ? (r.href || '') : (r.post_key || '');
      return `<button class="alert${r.read_at ? '' : ' unread'}" type="button"
                 data-alert-go="${esc(go)}" data-alert-href="${system ? '1' : ''}">
        ${mark}
        <span class="txt">
          <p>${line}</p>
          ${said ? `<span class="quote">&ldquo;${esc(said)}&rdquo;</span>` : ''}
          <small>${esc(ago(r.created_at))}</small>
        </span>
      </button>`;
    }).join('');

    /* READ ON OPENING, not on tapping a row. They have been shown to you;
       pretending otherwise is what makes a badge that never clears. The
       rows keep their gold edge for this viewing so you can still see which
       ones were new -- it is only the next open that comes up clean. */
    await clearUnread();
  }

  async function clearUnread() {
    if (!sb || !me || !unread) return;
    try { await sb.rpc('mark_notifications_read'); } catch (_) {}
    unread = 0;
    paintNavDot();
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
    feed: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="14" width="17" height="6" rx="2"/></svg>',
    bag:  '<svg viewBox="0 0 24 24"><path d="M2.5 3.5h2.3l2.6 11.3h9.9"/><path d="M6.3 6.6h14.2l-1.8 6.6H7.8"/><circle cx="9.5" cy="19.3" r="1.5"/><circle cx="17.5" cy="19.3" r="1.5"/></svg>',
    clock:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></svg>',
    pin:  '<svg viewBox="0 0 24 24"><path d="M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 14.9 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.4"/></svg>',
    phone:'<svg viewBox="0 0 24 24"><path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2C11.7 19 5 12.3 4.5 5.7A2 2 0 0 1 6.5 3.5z"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M12 3.5a5.5 5.5 0 0 0-5.5 5.5c0 4.2-1.5 5.5-1.5 5.5h14s-1.5-1.3-1.5-5.5A5.5 5.5 0 0 0 12 3.5z"/><path d="M10.2 18a2 2 0 0 0 3.6 0"/></svg>'
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
    /* Used to be a link out to ../?page=dex, the old app's page. The cards
       live in here now, so it opens a sheet rather than leaving the feed. */
    /* THE ROW SAYS WHAT THE 9 ON THE NAV BUTTON MEANT.
       A count on the bottom bar tells somebody there is news and nothing
       about where. So the row that holds it wears the same number, and
       wiggles once on open -- long enough to catch an eye, short enough
       not to be a thing that moves while you are reading. */
    if (showRewards) {
      const n = me ? rwdLoadNew().size : 0;
      rows.push(`<button class="go gold${n ? ' has-news' : ''}" type="button" data-rewards>
        ${ICON.inf}MY INFINITE REWARDS
        ${n ? `<i class="row-n">${n > 99 ? '99+' : n}</i>` : ''}</button>`);
    }
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
    /* ONE ROW, THEN TWO ROWS OF TILES.
       Seven identical full-width bars ran about 400px and gave equal weight
       to the thing people opened this for and to a page they will visit
       once. BROWSE stays long because it is the point of the sheet; the
       other six are short labels of two kinds, and a tile holds a short
       label in a third of the height.

       THE SIX ARE TWO GROUPS AND THE ROWS SAY SO. Hours, Location and
       Contact are the door. About, Movers and Infinite Questions are the
       hobby -- kept here deliberately, because all three lost their only way
       in when the old menu went, and Infinite Questions is 767 static pages
       that rank partly BECAUSE something links to them. A page on the
       allowlist with nothing pointing at it is not a page. */
    return {
      who: `Infinite Pulls<small>The shelf, and how to find us</small>`,
      rows: [
        `<a class="go" href="../?page=shop">${ICON.bag}BROWSE THE SHOP</a>`,
        `<div class="tiles">
          <a class="tile" href="../?page=hours">${ICON.clock}<span>HOURS</span></a>
          <a class="tile" href="../?page=location">${ICON.pin}<span>LOCATION</span></a>
          <a class="tile" href="../?page=contact">${ICON.phone}<span>CONTACT</span></a>
        </div>`,
        `<div class="tiles tiles--quiet">
          <a class="tile" href="../?page=about">${I.people}<span>ABOUT</span></a>
          <a class="tile" href="../?page=movers">${I.trend}<span>MOVERS &amp; SHAKERS</span></a>
          <a class="tile" href="/infinite-questions/">${I.quill}<span>INFINITE QUESTIONS</span></a>
        </div>`
      ].join('')
    };
  }

  function menuHTML() {
    const mine = me && faces[me];
    const rows = [];
    if (me) {
      /* THREE TILES, THEN TWO ROWS.
         It was eight full-width rows that all looked the same while doing
         three unrelated things -- opening a sheet here, changing this page,
         and leaving for another screen. Eight identical bars give no clue
         which is which, and the list was long enough that none of them read
         as important.

         The three things you actually come in here for are square and
         side by side, where the eye takes all three at once. My Account and
         Sign Out stay long, because they are a different kind of thing and
         one of them is the way out.

         TWO ROWS WERE CUT RATHER THAN RESTYLED. MY COLLECTION was a second
         route to what COLLECTION on the bottom bar already owns -- and that
         sheet carries the wish list and the Pokedex beside it, so the menu's
         version was the worse of the two. LOOK UP A CARD went with it. */
      rows.push(`<div class="tiles">
        <button class="tile" type="button" data-myfeed>
          ${ICON.feed}<span>MY FEED</span></button>
        <button class="tile${unread ? ' has-news' : ''}" type="button" data-alerts>
          ${ICON.bell}<span>NOTIFICATIONS</span>
          ${unread ? `<i class="tile-n">${unread > 99 ? '99+' : unread}</i>` : ''}</button>
        <a class="tile" href="../?page=goals">
          ${ICON.goal}<span>GOALS</span></a>
      </div>`);
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

  /* ---- INFINITE ORIGINAL 2026 ------------------------------------------
     Claim it, then pick the line that goes under your name.

     THE WORDING IS THE FEATURE. Everything in here says what the badge
     actually means -- the account existed before 2027 -- and says plainly
     that nobody has been checked. A person reading this screen should come
     away unable to believe the shop has vouched for anybody, because in a
     place where strangers mail each other expensive cards that belief is
     the thing that costs somebody money. */
  function badgeHTML() {
    if (!me) {
      return {
        who: `Infinite Original 2026<small>The badge for everybody who was here first</small>`,
        rows: `<p class="sheet-note">Sign in and it is yours &mdash; every account made before 2027 gets one.</p>
               <a class="go gold" href="../?page=account">SIGN IN</a>`
      };
    }
    const mine = faces[me] || {};
    if (!mine.badge) {
      return {
        who: `Infinite Original 2026<small>Yours if you were here before 2027</small>`,
        rows: `
          <div class="badge-hero">
            <img src="../assets/badge-original-2026-lg.webp" alt="" width="96" height="96">
            <p><b>You were here first.</b> Every account made before 2027 gets this
               badge beside its name, and a line of your own under it.</p>
          </div>
          <p class="sheet-note">It says you were early. It is not a check on who you are
            &mdash; nobody has been checked at all, so do not treat anybody&rsquo;s badge
            as a reason to trust them in a trade.</p>
          <button class="go gold" type="button" data-claim>CLAIM MY BADGE</button>
          <p class="say-note" hidden role="alert"></p>`
      };
    }
    return {
      who: `Infinite Original 2026<small>Claimed &mdash; now pick your line</small>`,
      rows: `
        <div class="badge-hero small">
          <img src="../assets/badge-original-2026-lg.webp" alt="" width="64" height="64">
          <p><b>It is yours.</b> Your line goes under your name on every post you make.</p>
        </div>
        <form class="say" data-tagline>
          <input type="text" name="tagline" maxlength="60" autocomplete="off"
                 value="${esc(mine.tagline || '')}"
                 placeholder="Base Set or nothing" aria-label="Your tagline">
          <button class="send" type="submit">SAVE</button>
        </form>
        <p class="sheet-note">Sixty characters. No links, numbers to call, or claiming to
          work at the shop &mdash; same rules as comments, and the shop can clear it.</p>
        <p class="say-note" hidden role="alert"></p>`
    };
  }

  async function claimBadge(wrap) {
    const note = wrap.querySelector('.say-note');
    const btn = wrap.querySelector('[data-claim]');
    if (btn) btn.disabled = true;
    const { error } = await sb.rpc('claim_founder_badge');
    if (error) {
      if (btn) btn.disabled = false;
      if (note) { note.textContent = error.message || 'That did not work.'; note.className = 'say-note bad'; note.hidden = false; }
      return;
    }
    /* The name this person is drawn under is cached, so it has to be told --
       otherwise the badge is real in the database and invisible until a
       reload, which reads as the button having done nothing. */
    if (faces[me]) faces[me].badge = true;
    drawMenu(true, 'badge');
    repaintNames();
  }

  async function saveTagline(wrap, value) {
    const note = wrap.querySelector('.say-note');
    const { data, error } = await sb.rpc('set_tagline', { new_tagline: value });
    if (error) {
      if (note) { note.textContent = error.message || 'That did not save.'; note.className = 'say-note bad'; note.hidden = false; }
      return;
    }
    if (faces[me]) faces[me].tagline = (data && data.tagline) || '';
    if (note) { note.textContent = 'Saved.'; note.className = 'say-note ok'; note.hidden = false; }
    repaintNames();
  }

  /* EVERY NAME ON THE PAGE, not just the next screenful. Somebody who has
     just claimed a badge is looking at a feed already full of their own
     posts, and leaving those without it until a reload is the version of
     this that gets reported as broken. */
  function repaintNames() {
    const mine = faces[me] || {};
    feed.querySelectorAll(`.post[data-owner="${me}"]`).forEach(art => {
      const line = art.querySelector('.who .nameline');
      if (line && !line.querySelector('.vb') && mine.badge) {
        line.querySelector('b').insertAdjacentHTML('afterend', badgeOf(mine));
      }
      /* The subtitle is the tagline's line now, so repainting means swapping
         what that line says rather than adding something beside the name. */
      const small = art.querySelector('.who small');
      if (small && mine.badge && mine.tagline) {
        small.className = 'tline';
        small.textContent = mine.tagline;
      }
    });
  }

  /* ======================================================================
     INFINITE REWARDS + THE INFINITE DEX

     Two collections, two tabs on one sheet: the fifty-one reward cards,
     and the twenty-five Pullkins they picture. A Pullkin is discovered by
     holding any card it appears on, so the Dex is worked out from the
     cards rather than stored -- the two can never disagree.

     Built for a phone at 393px. Three cards across: fifty-one of them
     two-across is a six-thousand-pixel scroll, and one-across is a joke.
     ====================================================================== */
  let rwdCards = null;              /* the catalogue, fetched once a session */
  let rwdMine  = new Set();         /* the card ids this visitor holds */
  let rwdTab   = 'cards';           /* 'cards' | 'dex' | 'prizes' */

  /* THE ONE PRIZE, and the only place its wording lives. Jeff has said 10%
     and has not confirmed 10% of WHAT, so when he does, this line changes
     and nothing else does. It is not read from dex_reward_tiers because
     that table is count-based and there is exactly one prize now. */
  const RWD_PRIZE = '10% off your order';
  let rwdView  = 'grid';            /* 'grid' | 'card' -- what the X means */

  const RWD_LOCK = '<svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/>' +
                   '<path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/></svg>';

  function rewardsShell() {
    return { who: 'Infinite Rewards<small>Looking&hellip;</small>',
             rows: '<div class="alert-empty">Looking&hellip;</div>' };
  }

  async function loadRewards() {
    if (!sb) return;
    if (!rwdCards) {
      const { data, error } = await sb.from('reward_cards')
        .select('id, code, card_number, secret, name, task_line, form_name, ' +
                'thumb_url, art_url, dex_creatures(dex_number, name)')
        .eq('enabled', true).order('card_number');
      if (error) throw error;
      rwdCards = data || [];
    }
    rwdMine = new Set();
    if (!me) return;
    /* Hand over anything earned since last time BEFORE reading the ledger, so
       a card earned two minutes ago is already in colour when the sheet opens
       rather than on the visit after. Through rwdCheck, so a card that lands
       as the sheet opens still gets its moment. */
    await rwdCheck();
    const { data } = await sb.from('user_reward_cards').select('card_id');
    (data || []).forEach(r => rwdMine.add(r.card_id));
  }

  const rwdHas  = (c) => rwdMine.has(c.id);
  const rwdDex  = (c) => (c.dex_creatures && c.dex_creatures.dex_number) || 0;
  /* THE CUTOUT, FOR A CARD FROM EITHER DIRECTION. The catalogue arrives from
     PostgREST with the creature embedded; the sweep hands back its own flat
     object with `dex` on it. One function so nothing downstream has to know
     which door the card came through, and '' rather than a broken image when
     it came through neither. */
  function rwdCut(c) {
    const d = (c && (c.dex || rwdDex(c))) || 0;
    return d ? `../assets/dex-cutouts/${String(d).padStart(3, '0')}.webp` : '';
  }
  const rwdName = (c) => (c.dex_creatures && c.dex_creatures.name) || '';

  /* The Pullkin roster, built from the cards: each one represented by the
     lowest-numbered card it appears on, which is always its base form. */
  function rwdPullkins() {
    const m = new Map();
    rwdCards.forEach(c => {
      const d = rwdDex(c);
      if (!d) return;
      if (!m.has(d) || c.card_number < m.get(d).card_number) m.set(d, c);
    });
    return [...m.values()].sort((a, b) => rwdDex(a) - rwdDex(b));
  }
  function rwdFound() {
    const s = new Set();
    rwdCards.forEach(c => { if (rwdHas(c)) s.add(rwdDex(c)); });
    s.delete(0);
    return s;
  }
  const rwdFifty = () => rwdCards.filter(c => !c.secret);
  const rwdGot   = () => rwdFifty().filter(rwdHas).length;
  /* The prize is not a count any more -- it is "do you hold this one card".
     51/50 IS the key, which is why it can be shown to somebody at a counter. */
  const rwdWon   = () => rwdCards.some(c => c.secret && rwdHas(c));

  function rwdTabsHTML() {
    const got = rwdGot(), all = rwdFifty().length;
    const f = rwdFound().size, p = rwdPullkins().length;
    return `<div class="rwd-tabs">
      <button class="rwd-tab${rwdTab === 'cards' ? ' is-on' : ''}" type="button" data-rwd-tab="cards">
        CARDS<i>${got} / ${all}</i></button>
      <button class="rwd-tab${rwdTab === 'dex' ? ' is-on' : ''}" type="button" data-rwd-tab="dex">
        INFINITE DEX<i>${f} / ${p}</i></button>
      <button class="rwd-tab${rwdTab === 'prizes' ? ' is-on' : ''}${rwdWon() ? ' is-won' : ''}" type="button" data-rwd-tab="prizes">
        PRIZES<i>${rwdWon() ? 'READY' : '0 / 1'}</i></button>
    </div>`;
  }

  function rwdCardsHTML() {
    const fifty = rwdFifty(), got = rwdGot();
    const secret = rwdCards.find(c => c.secret);

    let h = `<div class="rwd-bar"><span style="width:${fifty.length ? (got / fifty.length * 100).toFixed(1) : 0}%"></span></div>`;

    /* The number alone said nothing. What earns the card is the reason to
       care about it, so it goes under every tile -- locked or not. */
    h += '<div class="rwd-grid">' + fifty.map(c => {
      const on = rwdHas(c);
      return `<button class="rwd ${on ? 'on' : 'off'}" type="button" data-rwd-card="${c.card_number}"
        aria-label="${esc(c.name)}. ${esc(c.task_line)}${on ? '' : '. Locked'}">
        <span class="shot"><img src="${esc(c.thumb_url || '')}" alt="" loading="lazy" decoding="async">
        ${on ? '' : `<span class="rwd-lock">${RWD_LOCK}</span>`}</span>
        <b>${String(c.card_number).padStart(2, '0')}</b>
        <small>${esc(c.task_line)}</small>
      </button>`;
    }).join('') + '</div>';

    /* 51/50 sits on its own. It is not a fifty-first slot in the grid -- it
       is the thing the grid is for, and a row you cannot miss says that
       better than a card in the corner. */
    if (secret) {
      const on = rwdHas(secret);
      h += `<div class="rwd-secret"><button class="rwd big ${on ? 'on' : 'off'}" type="button" data-rwd-card="${secret.card_number}">
        <span class="shot"><img src="${esc(secret.thumb_url || '')}" alt="" decoding="async"></span>
        <span class="txt"><b>${esc(secret.name)}</b><small>${on
          ? '10% off your order. Show this at the counter.'
          : 'Earn all fifty cards to unlock 10% off your order.'}</small></span>
      </button></div>`;
    }
    return h;
  }

  function rwdDexHTML() {
    const found = rwdFound();
    return '<div class="dex-grid">' + rwdPullkins().map(c => {
      const d = rwdDex(c), on = found.has(d);
      /* THE PULLKIN, NOT A CROP OF ITS CARD.
         This used to be the card art squeezed into a circle at 188% and
         nudged up 27% to find the face, which is a guess that was wrong on
         half of them. These are the characters cut out on transparent
         backgrounds, shipped with the app at 320px, so each one stands on
         its own plinth at the size it was drawn for. */
      const art = `../assets/dex-cutouts/${String(d).padStart(3, '0')}.webp`;
      return `<div class="dex-one ${on ? 'on' : 'off'}">
        <div class="dex-face"><img src="${art}" alt="" loading="lazy" decoding="async"></div>
        <b>${on ? esc(rwdName(c)) : '???'}</b><i>#${String(d).padStart(3, '0')}</i></div>`;
    }).join('') + '</div>' +
    (found.size ? '' : '<div class="dex-note">Earn a reward card and the Pullkin on it joins your Dex.</div>');
  }

  /* WHAT HAVE I ACTUALLY WON. Deliberately shows one prize and not a list of
     things that do not exist yet -- a reward with no finish line does not
     ship, and a reward with no implementation does not get listed either. */
  function rwdPrizesHTML() {
    const secret = rwdCards.find(c => c.secret);
    const got = rwdGot(), all = rwdFifty().length;
    const won = rwdWon();
    const left = Math.max(0, all - got);

    return `<div class="prize ${won ? 'is-won' : 'is-waiting'}">
      <div class="prize-art"><img src="${esc((secret && secret.thumb_url) || '')}" alt="" decoding="async"></div>
      <b>${esc(RWD_PRIZE)}</b>
      ${won
        ? `<span class="prize-state">Yours. Show this screen at the counter.</span>`
        : `<span class="prize-state">${left} more card${left === 1 ? '' : 's'} to go</span>
           <div class="rwd-bar"><span style="width:${all ? (got / all * 100).toFixed(1) : 0}%"></span></div>
           <small class="prize-how">Earn all ${all} reward cards and
             ${esc((secret && secret.name) || 'the last card')} unlocks it.</small>`}
    </div>
    ${won ? '' : '<div class="dex-note">This is the only prize that happens in the shop. Everything else you earn lives in the app.</div>'}`;
  }

  function rwdWho() {
    return `Infinite Rewards<small>${rwdGot()} of ${rwdFifty().length} cards &middot; ` +
           `${rwdFound().size} of ${rwdPullkins().length} Pullkins</small>`;
  }

  /* One card, opened. Not a nested overlay -- the sheet swaps its own
     contents, and both ALL CARDS and the sheet's X put them back, so the
     history stack stays exactly one deep. See closeSheet. */
  function rwdOpen(n) {
    if (!rwdCards || !n) return;
    const c = rwdCards.find(x => x.card_number === n);
    if (!c) return;
    const on = rwdHas(c);
    const wrap = document.getElementById('menurows');
    if (!wrap) return;
    rwdView = 'card';
    /* Same Pullkin, same corner, same reason as the celebration: .shot clips
       to keep the card's edges, so the character needs a stage of its own to
       stand on. A card you have not earned gets a silhouette rather than the
       character -- giving the answer away here would empty the Dex tab of
       the one thing it is for. */
    const cut = rwdCut(c);
    wrap.scrollTop = 0;
    wrap.innerHTML =
      `<button class="rwd-back" type="button" data-rwd-back>&larr; ALL CARDS</button>
       <div class="rwd-open ${on ? 'on' : 'off'}">
         <div class="rwd-stage">
           <div class="shot"><img src="${esc(c.art_url || c.thumb_url || '')}" alt="${esc(c.name)}" decoding="async"></div>
           ${cut ? `<img class="rwd-pull" src="${cut}" alt="" aria-hidden="true" decoding="async">` : ''}
         </div>
         <h3>${esc(c.name)}</h3>
         <p class="task">${esc(c.task_line)}</p>
         <p class="who">${esc(rwdName(c))}${c.form_name ? ' &middot; ' + esc(c.form_name) : ''}
            &middot; Dex #${String(rwdDex(c)).padStart(3, '0')}</p>
         ${on ? '<p class="got">Earned</p>' : ''}
       </div>`;
  }

  /* WHAT THE COUNT WAS ABOUT. Read BEFORE rwdSeen() clears it, and kept for
     this one painting -- so somebody who opens the sheet, looks at the Dex
     and comes back still sees why they were sent here. */
  let rwdNewsLine = 0;

  function rwdPaint() {
    const who = document.getElementById('menuwho');
    const wrap = document.getElementById('menurows');
    if (!wrap || !rwdCards) return;
    rwdView = 'grid';
    if (who) who.innerHTML = rwdWho();
    wrap.scrollTop = 0;
    wrap.innerHTML = rwdTabsHTML() +
      (rwdNewsLine && rwdTab === 'cards'
        ? `<p class="rwd-news">${rwdNewsLine} new card${rwdNewsLine === 1 ? '' : 's'} since you last looked.</p>`
        : '') +
      (rwdTab === 'dex'    ? rwdDexHTML()
     : rwdTab === 'prizes' ? rwdPrizesHTML()
     : rwdCardsHTML());
  }

  async function fillRewards() {
    const wrap = document.getElementById('menurows');
    if (!wrap) return;
    rwdTab = 'cards';
    rwdView = 'grid';
    try {
      await loadRewards();
    } catch (e) {
      wrap.innerHTML = '<div class="alert-empty">Could not load these right now.<br>' +
                       esc((e && e.message) || '') + '</div>';
      return;
    }
    if (!rwdCards || !rwdCards.length) {
      wrap.innerHTML = '<div class="alert-empty">No cards yet.</div>';
      return;
    }
    rwdPaint();
  }


  /* ======================================================================
     THE MOMENT A CARD LANDS.

     Cards are earned by doing ordinary things -- writing a comment, adding
     a card, hitting ten scans -- so without this they arrive in total
     silence, in a grid nobody has opened. reward_sweep() has always
     returned exactly what was just won; nothing was ever done with it.

     Three parts: a layer that interrupts, the card flying down to
     COLLECTION so you know where it went, and a count that stays on
     COLLECTION until you go and look.
     ====================================================================== */
  let rwdNew      = null;      /* card ids earned but not yet looked at */
  let rwdSweeping = false;     /* one sweep in flight at a time */

  function rwdNewKey() { return 'ip-rwd-new:' + (me || 'anon'); }

  function rwdLoadNew() {
    if (rwdNew) return rwdNew;
    rwdNew = new Set();
    try {
      const raw = window.localStorage.getItem(rwdNewKey());
      if (raw) JSON.parse(raw).forEach(id => rwdNew.add(id));
    } catch (_) { /* private mode, or storage off */ }
    return rwdNew;
  }
  function rwdSaveNew() {
    try { window.localStorage.setItem(rwdNewKey(), JSON.stringify([...rwdLoadNew()])); }
    catch (_) { /* nothing here is worth breaking a page over */ }
  }

  /* The count on COLLECTION. Same shape as the bell's, different corner. */
  function paintMineDot() {
    const d = document.getElementById('minedot');
    if (!d) return;
    const n = me ? rwdLoadNew().size : 0;
    d.hidden = !n;
    d.textContent = n > 9 ? '9+' : String(n);
  }

  /* Goes quiet the moment they actually look. */
  function rwdSeen() {
    if (!rwdNew || !rwdNew.size) return;
    rwdNew.clear();
    rwdSaveNew();
    paintMineDot();
  }

  /* The card flies to COLLECTION so the count that appears there is not a
     thing that merely turned up -- they watched it land. Skipped entirely
     for anybody who has asked for less motion. */
  function rwdFly(fromEl, done) {
    const target = document.querySelector('.nav a[data-mine]');
    let reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
    if (!fromEl || !target || reduced || !fromEl.animate) { done(); return; }

    const a = fromEl.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const ghost = fromEl.cloneNode(true);
    ghost.className = 'won-ghost';
    ghost.style.cssText = 'position:fixed;margin:0;z-index:200;pointer-events:none;' +
      `left:${a.left}px;top:${a.top}px;width:${a.width}px;height:${a.height}px;`;
    document.body.appendChild(ghost);

    const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    const anim = ghost.animate([
      { transform: 'translate(0,0) scale(1)',                        opacity: 1 },
      { transform: `translate(${dx}px,${dy}px) scale(.10)`,          opacity: .2 }
    ], { duration: 620, easing: 'cubic-bezier(.45,0,.55,1)' });

    let finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      try { ghost.remove(); } catch (_) {}
      done();
    };
    anim.onfinish = end;
    /* A tab backgrounded mid-flight never fires onfinish, and the count
       would never appear. Belt to that braces. */
    setTimeout(end, 900);
  }

  function rwdCloseWon() {
    const layer = document.getElementById('won');
    /* ONE FLIGHT PER PANEL. The card takes 620ms to reach COLLECTION and the
       panel is still on screen for all of it, so a second tap on NICE used
       to start a second flight -- two ghosts, two callbacks, and paintMineDot
       run twice. is-going is the flag that says this one has already left. */
    if (!layer || layer.classList.contains('is-going')) return;
    const art = layer.querySelector('.won-art');
    layer.classList.add('is-going');
    rwdFly(art, () => {
      try { layer.remove(); } catch (_) {}
      document.body.style.overflow = '';
      paintMineDot();
    });
  }

  /* One layer for the whole batch. Six cards in the first two minutes is
     normal, and six taps to dismiss six panels is not a celebration. */
  function rwdCelebrate(list) {
    if (!list || !list.length) return;
    list.forEach(c => { if (c && c.card_id) rwdLoadNew().add(c.card_id); });
    rwdSaveNew();

    const old = document.getElementById('won');
    if (old) { try { old.remove(); } catch (_) {} }

    const first = list[0];
    const more  = list.length - 1;
    /* THE CHARACTER COMES OUT OF THE CARD. The art inside the frame is the
       collectible; this is the Pullkin itself, standing clear of it on the
       stage where the rays and the halo already live. .won-art is
       overflow:hidden to keep the card's corners, so it could never have
       hung over the edge from in there. */
    const cut = rwdCut(first);
    const layer = document.createElement('div');
    layer.id = 'won';
    layer.className = 'won';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-live', 'polite');
    if (first.secret) layer.classList.add('is-secret');
    /* The card sits on a stage rather than on the panel: the rays and the
       halo are separate layers behind it, because .won-art is overflow:hidden
       to keep the art's corners and anything drawn inside it gets clipped. */
    layer.innerHTML =
      `<div class="won-dim" data-won-close></div>
       <div class="won-box">
         <p class="won-kicker">${first.secret ? 'YOU FINISHED THE SET!' : 'YOU EARNED AN INFINITE REWARD CARD!'}</p>
         <div class="won-stage">
           <span class="won-rays" aria-hidden="true"></span>
           <span class="won-halo" aria-hidden="true"></span>
           <div class="won-art"><img src="${esc(first.art_url || first.thumb_url || '')}" alt="${esc(first.name)}"></div>
           ${cut ? `<img class="won-pull" src="${cut}" alt="" aria-hidden="true" decoding="async">` : ''}
         </div>
         <b>${esc(first.name)}</b>
         <small>${esc(first.task_line || '')}</small>
         ${more ? `<p class="won-more">and ${more} more card${more === 1 ? '' : 's'}</p>` : ''}
         ${first.secret ? `<p class="won-prize">${esc(RWD_PRIZE)} is yours.</p>` : ''}
         <button class="won-ok" type="button" data-won-close>NICE</button>
       </div>`;
    document.body.appendChild(layer);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => layer.classList.add('is-in'));

    const ok = layer.querySelector('.won-ok');
    if (ok) { try { ok.focus(); } catch (_) {} }
  }

  /* ======================================================================
     THE FIRST MINUTE

     Six people signed up and none of them had a single reward card, because
     nothing on this page ever told them there was anything to do. The cards
     ARE the instructions -- 06/50 is "add a card", 02/50 is "leave a
     comment" -- but only if somebody knows the cards exist.

     So this is the one screen that says it, shown once, on the first visit
     after signing up. Not a notification: a notification is a line you swipe
     past on the way to something else, and this is the something else.

     ONCE PER PERSON, NOT ONCE PER PHONE. localStorage would show it again on
     their laptop and again after they clear their browser, so the fact that
     they have seen it lives on the profile, where it follows them.
     ====================================================================== */
  let welcoming = false;

  /* Kept apart from the identity query on purpose. If welcome.sql has not
     been run yet, `welcomed_at` does not exist and asking for it fails --
     and asking for it in the SAME select as the username would take the
     name and the face down with it, so a signed-in member would look like a
     stranger to their own app. On its own, the worst a failure does is skip
     a welcome, which is the right way for this to break. */
  async function askWelcome() {
    if (!sb || !me) return;
    try {
      const { data, error } = await sb.from('profiles')
        .select('welcomed_at').eq('id', me).limit(1);
      if (error) return;                       /* column not there yet */
      if (data && data[0] && data[0].welcomed_at == null) showWelcome();
    } catch (_) { /* never at the cost of the feed */ }
  }

  /* The three things, in the order they get easier. Each one names the card
     it pays, because "leave a comment" is a chore and "leave a comment, that
     is 02/50" is a move in a game.

     HEAT A POST UP PAYS 04/50 ONLY BECAUSE heat_counts.sql MADE IT TRUE.
     HEAT is on a post and the heart is on a comment -- two tables, two
     buttons -- and 04/50 used to read comment_hearts alone, so this row
     would have sent somebody to tap the big button for nothing. The stat
     counts both now. Do not put a card number beside an action here without
     checking which table its trigger actually reads. */
  const HEY_STEPS = [
    { i: I.card,  a: 'ADD A CARD',      c: 'The Collection Keeper &middot; 06/50' },
    { i: I.chat,  a: 'LEAVE A COMMENT', c: 'First Word &middot; 02/50' },
    { i: I.flame, a: 'HEAT A POST UP',  c: 'Open Heart &middot; 04/50' }
  ];

  function showWelcome() {
    if (welcoming || document.getElementById('hey')) return;
    welcoming = true;
    const layer = document.createElement('div');
    layer.id = 'hey';
    layer.className = 'hey';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', 'Welcome to Infinite Pulls');
    layer.innerHTML =
      `<div class="hey-dim"></div>
       <div class="hey-box">
         <img class="hey-pull" src="../assets/dex-cutouts/001.webp" alt="" aria-hidden="true">
         <p class="hey-kicker">WELCOME TO INFINITE PULLS</p>
         <h2 class="hey-h">Fifty cards to earn.</h2>
         <p class="hey-sub">Three of them are one tap away.</p>
         <ul class="hey-list">
           ${HEY_STEPS.map(s => `<li><span class="hey-ico">${s.i}</span>
             <span class="hey-txt"><b>${s.a}</b><i>${s.c}</i></span></li>`).join('')}
         </ul>
         <p class="hey-prize">All fifty earns <b>${esc(RWD_PRIZE)}</b> at the shop.</p>
         <button class="hey-go" type="button" data-hey-rewards>SEE ALL FIFTY</button>
         <button class="hey-ok" type="button" data-hey-close>START LOOKING</button>
       </div>`;
    document.body.appendChild(layer);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => layer.classList.add('is-in'));
    const go = layer.querySelector('.hey-go');
    if (go) { try { go.focus(); } catch (_) {} }
  }

  /* WRITTEN DOWN BEFORE THE PANEL GOES, and not waited on. If the write
     fails they see this once more on their next visit, which is a far better
     failure than a panel that sits there while a request times out. */
  function closeWelcome() {
    const layer = document.getElementById('hey');
    if (layer) { try { layer.remove(); } catch (_) {} }
    document.body.style.overflow = '';
    welcoming = false;
    if (sb && me) {
      try {
        sb.from('profiles').update({ welcomed_at: new Date().toISOString() })
          .eq('id', me).then(() => {}, () => {});
      } catch (_) {}
    }
    /* And now the card they just earned by existing. */
    rwdSoon(500);
  }

  /* Ask the database whether anything was earned, and make a fuss if so.
     Safe to call often: it returns an empty array nearly every time, and it
     will not run twice at once. */
  async function rwdCheck() {
    if (!sb || !me || rwdSweeping) return [];
    rwdSweeping = true;
    try {
      /* GOALS FIRST. 41/50 The Oathkeeper is "a collector goal completed",
         and until goal_sweep() runs there is nothing for it to see -- the
         five auto-tracked goals are worked out for display and never
         written down. Running it here means finishing a goal and earning
         the card that rewards it happen in the same tap, not a page load
         apart. It also never creates a goal; see goal_completion.sql. */
      try { await sb.rpc('goal_sweep'); } catch (_) { /* cards still sweep */ }
      const { data, error } = await sb.rpc('reward_sweep');
      if (error) throw error;
      const won = Array.isArray(data) ? data : [];
      if (won.length) rwdCelebrate(won);
      return won;
    } catch (_) {
      return [];                       /* never breaks the page it sits on */
    } finally {
      rwdSweeping = false;
    }
  }

  /* ---- CTRL + ALT + W: show me that again ------------------------------
     The moment fires once per card and then never again for that person,
     which makes it the hardest thing here to look at twice. This replays it
     on demand with REAL cards off the catalogue, so what you are judging is
     the real panel and not a mock of it.

     It writes nothing. The sweep is not called, no row is inserted, and the
     count it drops on COLLECTION clears the moment you open the rewards
     sheet, exactly as a genuine one does.

     Each press moves to the next thing: one card, then a batch of six,
     then 51/50. Three presses sees everything. */
  let rwdDemoStep = 0;

  async function rwdDemo() {
    try {
      if (!rwdCards && sb) {
        const { data } = await sb.from('reward_cards')
          .select('id, code, card_number, secret, name, task_line, form_name, ' +
                  'thumb_url, art_url, dex_creatures(dex_number, name)')
          .eq('enabled', true).order('card_number');
        rwdCards = data || [];
      }
      if (!rwdCards || !rwdCards.length) return;

      const fifty = rwdCards.filter(c => !c.secret);
      const secret = rwdCards.find(c => c.secret);
      const pick = n => {
        const out = [], pool = fifty.slice();
        while (out.length < n && pool.length) {
          out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        }
        return out;
      };

      const mode = rwdDemoStep % 3;
      rwdDemoStep += 1;
      const list = mode === 0 ? pick(1)
                 : mode === 1 ? pick(6)
                 : (secret ? [secret] : pick(1));

      /* rwdCelebrate reads card_id, which is what the sweep returns; the
         catalogue calls the same thing id. */
      rwdCelebrate(list.map(c => Object.assign({}, c, { card_id: c.id })));
    } catch (_) { /* a shortcut that throws is worse than one that does nothing */ }
  }

  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || !e.altKey) return;
    if ((e.key || '').toLowerCase() !== 'w') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    rwdDemo();
  });

  /* Debounced, because the things that earn cards -- a comment, a heart --
     happen in bursts, and one sweep after the burst is worth five during it. */
  let rwdSoonTimer = null;
  function rwdSoon(ms) {
    clearTimeout(rwdSoonTimer);
    rwdSoonTimer = setTimeout(() => {
      /* THE WELCOME GOES FIRST. A new member's first visit fires both of
         these: the welcome, and the sweep that hands them 10/50 for having
         an account. Two panels at once is neither, and the order matters --
         being told what to do and THEN immediately earning a card for it is
         the whole first minute. So the sweep waits its turn. */
      if (welcoming) { rwdSoon(600); return; }
      rwdCheck();
    }, ms == null ? 3500 : ms);
  }

  /* One sheet, six contents. `kind` decides which. */
  const SHEETS = { mine: '[data-mine]', shop: '[data-shop]', menu: '[data-menu]',
                   badge: '[data-badge]', alerts: '[data-menu]', rewards: '[data-mine]' };

  function drawMenu(on, kind) {
    const wrap = document.getElementById('menuwrap');
    if (!wrap) return;
    if (on) {
      const m = (kind === 'mine') ? mineHTML(rewards === true)
              : (kind === 'shop') ? shopHTML()
              : (kind === 'badge') ? badgeHTML()
              : (kind === 'alerts') ? alertsShell()
              : (kind === 'rewards') ? rewardsShell()
              : menuHTML();
      document.getElementById('menuwho').innerHTML = m.who;
      document.getElementById('menurows').innerHTML = m.rows;
    }
    wrap.hidden = !on;
    document.querySelectorAll('[data-menu],[data-mine],[data-shop],[data-badge]').forEach(b =>
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
    if (overlay) {
      draw(overlay, false);
      overlay = null;
      overlayPushed = false;
      /* whatever was waiting for the sheet to get out of the way */
      const then = afterOverlay; afterOverlay = null;
      if (then) setTimeout(then, 0);
      return;
    }
    /* No sheet open, but the feed is narrowed: Back widens it rather than
       leaving the page. */
    if (filter && filterPushed) { filterPushed = false; setFilter(null); return; }
    /* nothing open, nothing narrowed: let the phone go back */
  });

  /* Kept for anything that still says openSearch/openMenu in plain terms. */
  const openSearch = (on) => showOverlay('search', on);
  const openMenu   = (on) => showOverlay('menu', on);

  /* ?rewards=1 OPENS THE REWARDS SHEET ON ARRIVAL.
     A notification saying you earned a card has to land ON the card. The
     sheet has no address of its own, so the notification points here and
     the sheet opens itself -- the same trick ?badge=1 uses below. */
  (function () {
    try {
      if (new URL(location.href).searchParams.get('rewards') !== '1') return;
    } catch (_) { return; }
    window.addEventListener('load', () => setTimeout(() => {
      showOverlay('rewards', true);
      fillRewards();
      try {
        const u = new URL(location.href);
        u.searchParams.delete('rewards');
        history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      } catch (_) {}
    }, 400));
  })();

  /* ?badge=1 OPENS THE BADGE SHEET ON ARRIVAL.
     The badge and tagline moved to the account page, but the flow that
     claims it lives here -- and writing it a second time over there would
     be two implementations of one thing to keep in step. So the account
     page links back to this address and the sheet opens itself. */
  (function () {
    try {
      if (new URL(location.href).searchParams.get('badge') !== '1') return;
    } catch (_) { return; }
    window.addEventListener('load', () => setTimeout(() => {
      showOverlay('badge', true);
      const wrap = document.getElementById('menurows');
      if (wrap) claimBadge(wrap);
      /* Taken out of the address once it has done its job, so a reload or a
         shared link does not reopen a sheet nobody asked for. */
      try {
        const u = new URL(location.href);
        u.searchParams.delete('badge');
        history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      } catch (_) {}
    }, 400));
  })();
  /* The rewards row is decided before the sheet is drawn, not after -- a row
     appearing a beat late is a row that moves under somebody's thumb. */
  const openMine   = async (on) => { if (on) await rewardsAreOn(); showOverlay('mine', on); };
  const openShop   = (on) => showOverlay('shop', on);
  const openBadge  = (on) => showOverlay('badge', on);
  /* CLOSE WHATEVER IS OPEN, not the one you were expecting. The X, the dimmed
     feed and Escape all used to say openMenu(false) -- which does nothing at
     all when the sheet showing is the collection one, because showOverlay
     ignores a close aimed at a kind that is not open. A sheet with no way out
     of it, reachable from the nav bar. */
  const closeSheet = () => {
    /* Inside a single reward card, the X means "back to the cards", not
       "throw me out to the feed". One tap undoes one step. */
    if (overlay === 'rewards' && rwdView === 'card') { rwdPaint(); return; }
    if (overlay && overlay !== 'search') showOverlay(overlay, false);
  };

  let signOutTimer = null;

  async function signOut() {
    if (!sb) return;
    clearTimeout(signOutTimer);
    window.InfinitePullsAuthLog && window.InfinitePullsAuthLog.onPurpose('SIGN OUT in the feed menu');
    try { await sb.auth.signOut(); } catch (_) { /* going anyway */ }
    me = null;
    wanted = null;
    rewards = null;
    rwdMine = new Set();
    rwdNew = null;
    rewardCursors.clear();
    rewardSpent.clear();
    marksAsked.clear();
    Object.keys(marks).forEach(k => delete marks[k]);
    paintMineDot();
    myBadges = null;
    unfollowed.clear();
    followsLoaded = false;
    closeSheet();
    paintNavMe();
    loadUnread();
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
    if (feed.querySelector('[data-mybadges]')) return;
    /* BELOW THE SHARED POST, NOT ABOVE IT. Somebody who followed a link came
       for one thing, and their own badges are not it -- least of all a
       stranger's, who is looking at YOUR trophies over the photo they
       clicked. Normally there is no pinned post and this is the top of the
       feed, which is where it belongs. */
    const pinned = feed.querySelector('.pinned-post');
    if (pinned) pinned.insertAdjacentHTML('afterend', html);
    else feed.insertAdjacentHTML('afterbegin', html);
  }

  /* ---- go ---------------------------------------------------------------- */
  let io = null;

  /* ---- ARRIVING AT ONE POST ----------------------------------------------
     ?post=p-<id> pins that one to the top and then lets the rest of the feed
     carry on underneath it. Somebody who followed a link from Facebook came
     for one thing; they should see it without scrolling, and then have a
     reason to stay.

     NOT A FILTER. A filter empties the feed and shows only matches, which
     for one post is a dead end with a chip on it. This is a pinned row and
     the ordinary feed below, so the way "out" is simply to keep going. */
  function wantedPost() {
    try {
      const raw = new URL(location.href).searchParams.get('post') || '';
      const m = /^([pc])-(.+)$/.exec(raw.trim());
      if (!m) return null;
      return { kind: m[1] === 'p' ? 'photo' : 'card', id: m[2] };
    } catch (_) { return null; }
  }

  /* COMING BACK FROM SIGNING IN. askToSignIn() remembers which post
     somebody was about to comment on; this is the other half -- ?talk=1
     says open that post's comments once it is on screen, so they land on
     the thing they were looking at with the box already waiting. */
  function openTalkIfAsked() {
    if (!WANTS_TALK) return;
    const sec = feed.querySelector('[data-talk]');
    const art = sec && sec.closest('.post');
    if (art) {
      toggleTalk(art, true);
      setTimeout(() => {
        const input = art.querySelector('.say input');
        if (input) input.focus({ preventScroll: true });
      }, 320);
    }
  }

  /* ARRIVING ON SOMEBODY'S FEED.
     404.html turns infinitepulls.com/tacomike417 into ?who=tacomike417 and
     sends it here; this turns the name back into the account it belongs to
     and narrows to them. The address is put back to the clean path either
     way -- a person who followed a link should never see the machinery that
     got them there.

     A NAME THAT DOES NOT EXIST IS NOT AN ERROR PAGE. It is somebody
     mistyping, or a link to an account that has gone. They get the whole
     feed with a note saying so, which is a better answer than a dead end
     and is the same thing the app does for a missing profile. */
  async function openWhoIfAsked() {
    if (!WANTS_WHO || !sb) return false;
    let found = null;
    try {
      const { data } = await sb.from('profiles')
        .select('id, username, is_public')
        .ilike('username', WANTS_WHO).limit(1);
      found = (data || [])[0] || null;
    } catch (_) { found = null; }

    history.replaceState(null, '', '/' + WANTS_WHO);

    if (!found || found.is_public === false) {
      note('No collector called ' + WANTS_WHO + '. Here is everybody instead.');
      history.replaceState(null, '', '/feed-next/');
      return false;
    }
    /* Set directly rather than through goNarrow: this IS the page somebody
       asked for, so there is nothing to go back OUT of yet and pushing a
       history entry would make Back a no-op on arrival. */
    filter = { kind: 'person', id: found.id, label: found.username };
    const bar = document.getElementById('chipbar');
    if (bar) { bar.innerHTML = chipHTML(); bar.hidden = false; }
    return true;
  }

  /* ---- THE SHOP'S NEWEST POSTER, ABOVE THE FEED --------------------------
   *
   * The shop takes its fair turn in the rotation like everybody else, and
   * that is right for the shelf -- but not for an announcement. "We still
   * have some, stop in today" is worth nothing three screenfuls down, and
   * the whole reason Jeff posts one is that people see it.
   *
   * So the store's newest picture sits under the welcome card, marked
   * PINNED so it reads as the shop's notice board rather than as the feed
   * having lost its order.
   *
   * IT GOES STALE, SO IT LETS GO. A week is the leash: after that it drops
   * out of the pinned slot and back into the ordinary rotation, because a
   * "while supplies last" poster from three weeks ago sitting at the top of
   * the feed is worse than no poster at all. */
  async function shopPinHTML() {
    shopPinId = null;
    if (!sb || !STORE_ID || photoPostsOff) return '';
    try {
      const since = new Date(Date.now() - SHOP_PIN_DAYS * 86400000).toISOString();
      const { data, error } = await sb.from('user_photos')
        .select('id, user_id, object_key, caption, added_at')
        .eq('user_id', STORE_ID)
        .gte('added_at', since)
        .order('added_at', { ascending: false })
        .limit(1);
      if (error || !data || !data.length) return '';
      const row = photoRow(data[0]);
      row.pinned = true;
      shopPinId = row.rowId;
      return postHTML(row, 0);
    } catch (_) {
      /* A pin that cannot be read is a pin that is not drawn. It is the one
         thing on this screen nobody asked for, so it never gets to be the
         reason the feed does not appear. */
      return '';
    }
  }

  async function pinnedPost() {
    const want = wantedPost();
    if (!want || !sb) return '';
    try {
      const table = want.kind === 'photo' ? 'user_photos' : 'user_cards';
      const cols = want.kind === 'photo'
        ? 'id, user_id, object_key, caption, added_at'
        : colList(columns || []);
      const { data, error } = await sb.from(table).select(cols).eq('id', want.id).maybeSingle();
      if (error || !data) {
        note(error && error.message ? 'Could not open that post: ' + error.message
                                    : 'That post is not here any more.');
        return '';
      }
      await facesFor([data.user_id]);
      const row = want.kind === 'photo' ? photoRow(data) : cardRow(data);
      if (want.kind === 'card') await attachPhotos([row]);
      /* THE ADDRESS BAR SAYS THE PRETTY ONE. They may have arrived on
         ?post=... from the app or from a page that has not been built yet;
         either way the thing worth copying out of the bar is the permalink. */
      try { history.replaceState(history.state, '', permalink(row)); } catch (_) {}
      return `<div class="pinned-post">
          <div class="pinned-head">${I.link}<span>A POST SOMEBODY SHARED</span></div>
          ${postHTML(row, 0)}
          <a class="pinned-more" href="./">See the whole feed</a>
        </div>`;
    } catch (e) {
      note('Could not open that post: ' + ((e && e.message) || 'unknown'));
      return '';
    }
  }

  async function startFeed() {
    /* WHOSE FEED FIRST, because it decides everything below it: a narrowed
       feed has no welcome card and no pinned post, and asking for either
       before knowing would draw them and then take them away again. */
    if (WANTS_WHO && !filter) await openWhoIfAsked();
    /* The welcome card is a welcome, not a search result -- it has no place
       inside a filter. */
    /* The shared post goes in FIRST and before anything else is asked for,
       so the thing somebody followed a link for is on screen while the rest
       of the feed is still loading behind it. */
    const pinned = filter ? '' : await pinnedPost();
    /* WHOSE SHELF THIS IS, above their cards. Drawn hidden and filled in
       afterwards: the name, the grail, the badges and three counts are four
       round trips, and holding the whole feed back for them would mean
       staring at nothing on the one screen somebody arrived at from Google. */
    const prof = (filter && filter.kind === 'person')
      ? '<section class="prof" id="profcard" hidden></section>' : '';
    /* Under the welcome card, above everything the rotation deals. Skipped
       inside a filter and when somebody arrived on a shared post: both of
       those are screens about one particular thing, and a notice board on
       top of them is noise. */
    const shopPin = (filter || pinned) ? '' : await shopPinHTML();
    feed.innerHTML = prof + pinned + (filter || pinned ? '' : tutorialHTML() + shopPin) +
      `<div class="skel"><div class="bar" style="width:55%"></div><div class="box"></div></div>`;
    if (prof) fillProfile(filter.id);
    paintNotes();
    await refreshCounts();
    refreshHeat();
    feed.querySelectorAll('.pinned-post .frame:not([data-wired])').forEach(f => {
      f.setAttribute('data-wired', '1'); wireRail(f); paintStrip(f, false);
    });
    await loadMore();
    const first = feed.querySelector('.skel');
    if (first) first.remove();
    placeMyBadges();
    openTalkIfAsked();
    if (!feed.querySelector('.post:not(.tutorial)')) {
      feed.insertAdjacentHTML('beforeend', filter
        ? `<div class="msg"><b>Nothing here</b>
             ${filter.kind === 'shop'
               ? 'There is nothing on the shelf right now.'
               : filter.kind === 'person'
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
    if (sb) { await whoAmI(); paintNavMe(); settleBell(); loadUnread();
              paintMineDot(); rwdSoon(1800);
              await Promise.all([loadFollows(), loadWishlist()]); }
    if (!sb) {
      feed.innerHTML = `<div class="msg"><b>No connection to the shop</b>
        This page needs config.js and the Supabase library. Open it from the site,
        not from a file on your computer.</div>`;
      return;
    }
    await startFeed();
    /* AFTER the feed, not before: the panel is a thing sitting on top of the
       app, and it only reads that way if the app is behind it. */
    askWelcome();
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

  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-search-open]')) {
      const { wrap } = searchEls();
      openSearch(!wrap || wrap.hidden);
      return;
    }
    const mineBtn = e.target.closest('[data-mine]');
    if (mineBtn) { e.preventDefault(); openMine(true); return; }
    const shopBtn = e.target.closest('[data-shop]');
    if (shopBtn) { e.preventDefault(); openShop(true); return; }
    /* THE NAME AND THE NAV ICON ARE TWO DIFFERENT DESTINATIONS, deliberately.
       The icon in the bar opens the sheet -- browse, hours, location, contact.
       The name on a post narrows the feed to the shelf, which is the same
       thing tapping anybody else's name does, and is the only way to look at
       Jeff's cards AS POSTS. Sending them both to the sheet would have made
       the name a second, worse copy of a button already on the screen. */
    const badgeBtn = e.target.closest('[data-badge]');
    if (badgeBtn) { e.preventDefault(); openBadge(true); return; }

    const claim = e.target.closest('[data-claim]');
    if (claim) {
      e.preventDefault();
      const wrap = document.getElementById('menurows');
      if (wrap) await claimBadge(wrap);
      return;
    }

    const shopFeed = e.target.closest('[data-open-shop]');
    if (shopFeed) {
      e.preventDefault();
      goNarrow({ kind: 'shop', label: SHOP_WHO });
      return;
    }
    const alerts = e.target.closest('[data-alerts]');
    if (alerts) {
      e.preventDefault();
      showOverlay('alerts', true);
      fillAlerts();
      return;
    }
    const rwdBtn = e.target.closest('[data-rewards]');
    if (rwdBtn) {
      e.preventDefault();
      showOverlay('rewards', true);
      /* Counted first: rwdSeen() is about to set it to zero. */
      rwdNewsLine = me ? rwdLoadNew().size : 0;
      fillRewards();
      rwdSeen();
      return;
    }
    /* data-rwd-card, NOT data-card: every post in the feed puts data-card on
       its .frame, so [data-card] here matched a tap anywhere on a post, ate
       the click with preventDefault and threw on a catalogue that had not
       been loaded. Namespaced, and rwdOpen refuses to run without one. */
    const rwdCard = e.target.closest('[data-rwd-card]');
    if (rwdCard) { e.preventDefault(); rwdOpen(+rwdCard.getAttribute('data-rwd-card')); return; }
    if (e.target.closest('[data-rwd-back]')) { e.preventDefault(); rwdPaint(); return; }
    if (e.target.closest('[data-won-close]')) { e.preventDefault(); rwdCloseWon(); return; }
    const rwdTabBtn = e.target.closest('[data-rwd-tab]');
    if (rwdTabBtn) {
      e.preventDefault();
      rwdTab = rwdTabBtn.getAttribute('data-rwd-tab');
      rwdPaint();
      return;
    }
    /* A row in the list goes to the post it is about. A follow has no post,
       so it closes and leaves you where you were rather than going nowhere
       and looking broken. */
    const go = e.target.closest('[data-alert-go]');
    if (go) {
      e.preventDefault();
      const key = go.getAttribute('data-alert-go');
      const isHref = go.getAttribute('data-alert-href') === '1';
      closeSheet();
      /* A system row already knows its own address -- the Dex, the goals
         page -- and is not a post at all, so it must not be handed to the
         ?post= route, which would look for a post that does not exist. */
      if (isHref) { if (key) location.href = key; return; }
      /* ?post=<key> is the address the feed already understands -- it pins
         that post to the top and lets the rest carry on underneath. It is
         what the permalinks and the collection page both use; a hash would
         simply have been ignored. &talk=1 opens the comments, because the
         comment is the thing being pointed at. */
      if (key) location.href = './?post=' + encodeURIComponent(key) + '&talk=1';
      return;
    }
    const menu = e.target.closest('[data-menu]');
    if (menu) { e.preventDefault(); openMenu(true); return; }
    if (e.target.closest('[data-menu-close]')) { closeSheet(); return; }
    const bioMore = e.target.closest('[data-bio-more]');
    if (bioMore) {
      e.preventDefault();
      const wrap = bioMore.closest('.prof-bio');
      if (wrap) {
        const open = wrap.classList.toggle('is-open');
        bioMore.textContent = open ? 'LESS' : 'MORE';
      }
      return;
    }

    if (e.target.closest('[data-hey-close]')) { e.preventDefault(); closeWelcome(); return; }
    if (e.target.closest('[data-hey-rewards]')) {
      e.preventDefault();
      closeWelcome();
      showOverlay('rewards', true);
      rwdNewsLine = 0;
      fillRewards();
      rwdSeen();
      return;
    }

    /* SIGN OUT ASKS TWICE.
       The sheet covers the bottom bar, so before the .sheet-foot strip went
       in, this row sat exactly on top of the MENU button you had just
       tapped -- open the menu, tap the same spot to close it, and you were
       signed out. The geometry is fixed; this is the part that stays fixed
       if some future row ever lands there again. Four seconds and it goes
       back to being SIGN OUT, so an armed button is never left waiting. */
    const out = e.target.closest('[data-signout]');
    if (out) {
      if (out.dataset.armed === '1') { signOut(); return; }
      out.dataset.armed = '1';
      out.classList.add('armed');
      out.innerHTML = ICON.out + 'TAP AGAIN TO SIGN OUT';
      clearTimeout(signOutTimer);
      signOutTimer = setTimeout(() => {
        if (!out.isConnected) return;
        out.dataset.armed = '';
        out.classList.remove('armed');
        out.innerHTML = ICON.out + 'SIGN OUT';
      }, 4000);
      return;
    }
    /* Closed first, then narrowed. The sheet's way out goes through
       history.back(), so letting that settle before the feed is torn down
       and rebuilt keeps the two from arguing about what is on screen. */
    if (e.target.closest('[data-myfeed]')) {
      if (!me) return;
      const who = faces[me];
      goNarrow({ kind: 'person', id: me, label: (who && who.name) || 'you' });
      return;
    }
    const person = e.target.closest('[data-open-person]');
    if (person) {
      goNarrow({ kind: 'person', id: person.getAttribute('data-open-person'),
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
    if (e.target.closest('[data-chip-clear]')) { widen(); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const label = pick.getAttribute('data-label') || '';
      goNarrow(pick.getAttribute('data-pick') === 'person'
        ? { kind: 'person', id: pick.getAttribute('data-id'), label }
        : { kind: 'card', name: label, label });
    }
  });

  /* Draw the build stamp first, before anything can go wrong. If the feed
     itself fails you still want to know which build failed. */
  function stamp() {
    const el = document.getElementById('build');
    if (el) {
      el.textContent = RELEASE;
      el.title = 'build ' + BUILD;
    }
    console.log('[feed] ' + RELEASE + ' build ' + BUILD);
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
