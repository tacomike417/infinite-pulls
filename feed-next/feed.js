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
  /* The big gold tag next to Mike's own name in the top bar. His check
     that a refresh took: bump it by one with every update we ship. */
  const DEV_VER = 'v66';   // +1 EVERY update Mike pushes (his refresh check). v53 = 27 Sep evening: smart tags, online dots, tagline, photo grid, soft wall.
  const RELEASE = 'v2.5';   // v2.5: works like Instagram -- double-tap heat, @names link, Heat from, comment preview, follower lists, pull to refresh.  // v2.4: Join free + the join box for guests.  // v2.3: profile tabs say what they are.  // v2.2: Start Here once, no picture no feed spot
  /* EVERY ADDRESS THIS FILE WRITES IS ROOT-ABSOLUTE, and that is a rule
     rather than a style. It used to write them relative -- ../?page=... and
     ../assets/... -- which is correct only while the address bar says
     /feed-next/.

     It does not always say that. pinnedPost() deliberately replaces the
     address with the post's pretty permalink, /<handle>/post/<id>, because
     that is the thing worth copying out of the bar. From there ../ resolves
     to /<handle>/ -- so MY WISH LIST went to /<handle>/?page=collection,
     which is a path 404.html reads as somebody's profile, and the answer
     was "Page Not Found". Every image went with it: the dex cutouts, the
     badges, the no-photo placeholder, Hyde-Bot's avatar.

     Fifty-six addresses, all of them quietly depending on the address bar
     not having changed. A root-absolute path cannot care what the bar says.

     If this app is ever served from a subdirectory instead of the domain
     root, this is the line that has to change. */
  const BUILD = 'v116';   // v116: Infinite Loops row at the top of the feed (5+), Loops tab on profiles, dark welcome pop-up, ADD says Infinite Loops.  // v115: Loops play like Reels -- tap pauses, speaker button keeps sound on for every Loop until turned off.  // v114: Loop maker -- Retro VHS + Comic styles (6 in all); drag, pinch and turn the text.  // v113: ∞ Loop opens straight into the maker; record a video (or pick videos + photos), then text + stickers over it, with its sound.  // v112: LOOP MAKER -- photos + style + text + stickers made into a video on the phone.  // v111: REPORTS in the menu for moderators -- take a reported post down (hidden, not deleted) or clear it.  // v110: INFINITE LOOPS -- 15-second videos: a Loops row in the feed, full-screen swipe player, Make a Loop on ADD, pinned Loops on profiles.  // v109: wall leads with Log in / Open in the app, never 'sign up'; Facebook/Instagram browsers get a way out.  //   // v108: # picker; #Charizard shows photos and Charizard cards together.  //   // v107: shared post pages redesigned; Join free & follow from them.  //   // v106: smart tags -- Pokemon, set, rarity, grade, edition under every card; #tags tappable; tag search.  //   // v105: online dots -- green dot when active, "Active 12m ago" on profiles, switch to hide it.  //   // v104: new tagline -- Track your Pokémon cards & share your pulls.  //   // v103: Photos tab is a 3-across grid like Instagram; tap opens the post over the profile.  //   // v102: photo posts survive a missing column (is_intro blanked every photo).  //   // v101: soft wall -- guests see 9 posts on a profile, then "Follow @x to see the rest".  //   // v100: editions -- 1st Edition / Shadowless / Unlimited on the card back, Edit and sold search.  //   // v99: tag people in a card's story too.  //   // v98: type @ in a comment or caption to pick who to tag.  //   // v97: BRING YOUR COLLECTION IN on your cards tab and in the checklist.  // v96b: v96b: (i) how-tos for Collectr and Dex on Edit profile.  // v96: Collectr + Dex buttons on profiles.  // v95b: v95b: Say hi only for members under 30 days with no photo posts; everyone else 4 steps.  // v95: v95: profile score is 5 easy steps ending in SAY HI (a hello post made for you); NEW MEMBER tag + Say welcome.  // v94: PROFILE SCORE -- % complete on the feed and your profile, each step opens its screen.  // v93: GET STARTED checklist for new members (photo, first card or post).  // v92: SUGGESTED FOR YOU after the 5th post -- switches itself on at 50 members.  // v91: NEW THIS WEEK row above the videos.  // v90: fresh first -- people who posted in the last day get the first seats.  // v89: photo posts can have up to 10 pictures (swipe, dots, 1 / N).  // v88: notifications A+ (white, holo strip, brand colors, Follow back); posts say what happened; reward posts open from links.  // v87: INVITE in the rail (replaces ALERTS; the top bell has them), invite screen, once after sign up.  // v86: the bell opens a Facebook-style notifications dropdown; rows go to the exact comment.  // v85: SHARE offers story size AND post size.  // v84: invite friends -- your profile link remembers who sent a newcomer.  // v83: SHARE -> share to your story (picture with QR) or share link.  // v82: streaks on profiles.  // v81: HOT THIS WEEK strip at the top of the feed.  // v80: notifications nudge after you comment, post, or open with alerts waiting.  // v79: social pack 1 -- mentions notify, report/block, view counts, edit caption.  // v78: ADD speed dial -- Scan card / Make a post.  // v77: Goals as a feed; Goals tab on other people's profiles.  // v76: the rail -- ME, GOALS, NEW POSTS (count since last open), ALERTS (unread).  // v75: My Photos keeps walking until it has a screenful of pictures.  // v74: no add-a-photo tile on card posts; your own pictures are photo posts.  // v73: Rewards tab drops the My.  // v72: double-tap shows a real filled flame in the middle of the picture.  // v71: My Photos etc. on one line.  // v70: profile tabs in order Photos / Cards / Wants / Rewards; others' pages hide empty tabs and open on the first with something in it.  // v69: tabs say My Cards / My ∞ Rewards / My Wants / My Photos on your own page; menu says MY PROFILE.  // v68: Instagram batch; short times under names; Photos tab is photos only.  // v67: join box is white; social first, then scanner / prices / eBay comps.  // v66: guests get JOIN FREE, a once-per-phone join box, and the box again on HEAT / FOLLOW / wish list / photos.  // v65: profile tabs are words (Cards, Rewards, Wants, Posts), not icons.  // v64: Start Here card shows once per phone; a post with no picture stays out of the feed

  const PAGE = 8;                     // posts per fetch
  /* ONE NAME, IN ONE PLACE. It is the shop's display name, the key its posts
     queue under (enqueue falls back to `who` when there is no owner), and
     what the chip says when the feed is narrowed to the shelf. Three things
     that have to agree, so they are one constant rather than three strings
     that drifted apart the first time somebody renamed the store. */
  const SHOP_WHO = 'Infinite Pulls';

  /* A COLLECTOR IS AN @HANDLE -- 25 Sep 2026 (SOCIAL-NEXT part 2). Wherever
     a person's name is DRAWN it reads @tacomike417, the way every social app
     writes a handle. Only drawn: the name itself (p.who, filter.label, the
     data-open-label attributes) stays bare, because personPath() builds the
     address from it and an @ would fail its check. Anything that is not a
     username -- the shop's name, "A collector" -- has a space or is empty,
     so it comes back exactly as it went in. */
  const at = (name) =>
    (name && /^[A-Za-z0-9_-]{3,24}$/.test(name)) ? '@' + name : (name || '');

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
  /* ---- THE VOCABULARY A CARD CAN BE EDITED INTO ---------------------------
     A COPY, on purpose, for the same reason GRADER_LINKS below is a copy:
     the feed is its own bundle and importing components/collection.js would
     mean the feed waiting on the app to load. If a grader or a finish is
     added there, add it here -- the rule is that a card reads and edits the
     same wherever it is shown.

     THE LADDERS ARE NOT INTERCHANGEABLE and that is the point of having
     five of them. PSA runs whole numbers with a 1.5 and no halves. BGS, CGC
     and SGC run half points with two different tens at the top. TAG runs
     half points BUT issues nothing between 9 and 10 -- offering a TAG 9.5
     would be offering a grade that does not exist. */
  const RAW_CONDITIONS = ['Near Mint', 'Lightly Played', 'Moderately Played',
                          'Heavily Played', 'Damaged'];
  const GRADE_COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC', 'TAG'];
  const PSA_NAMES = {
    '10': 'Gem Mint', '9': 'Mint', '8': 'Near Mint-Mint', '7': 'Near Mint',
    '6': 'Excellent-Mint', '5': 'Excellent', '4': 'Very Good-Excellent',
    '3': 'Very Good', '2': 'Good', '1.5': 'Fair', '1': 'Poor'
  };
  const halfSteps = (from) => {
    const out = [];
    for (let v = from; v >= 1; v -= 0.5) out.push(String(v));
    return out;
  };
  const GRADE_LADDERS = {
    PSA: ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1.5', '1']
           .map(g => ({ value: g, label: g + ' \u2013 ' + PSA_NAMES[g] })),
    BGS: [{ value: '10 Black Label', label: '10 \u2013 Black Label' },
          { value: '10 Pristine',    label: '10 \u2013 Pristine' }]
           .concat(halfSteps(9.5).map(g => ({ value: g, label: g }))),
    CGC: [{ value: '10 Pristine', label: '10 \u2013 Pristine' },
          { value: '10 Gem Mint', label: '10 \u2013 Gem Mint' }]
           .concat(halfSteps(9.5).map(g => ({ value: g, label: g }))),
    SGC: [{ value: '10 Pristine', label: '10 \u2013 Pristine' },
          { value: '10 Gem Mint', label: '10 \u2013 Gem Mint' }]
           .concat(halfSteps(9.5).map(g => ({ value: g, label: g }))),
    TAG: [{ value: '10 Pristine', label: '10 \u2013 Pristine' },
          { value: '10 Gem Mint', label: '10 \u2013 Gem Mint' },
          { value: '9',           label: '9 \u2013 Mint' }]
           .concat(halfSteps(8.5).map(g => ({ value: g, label: g })))
  };

  /* "PSA 10" and "TAG 10 Pristine" split back into the company and the
     grade, so the box opens on what the card already says rather than on
     a blank form somebody has to fill in twice. */
  function splitCondition(cond) {
    const t = String(cond || '').trim();
    if (!t) return { graded: false, raw: 'Near Mint', company: 'PSA', grade: '10' };
    const m = /^(PSA|BGS|CGC|SGC|TAG)\s+(.+)$/i.exec(t);
    if (!m) return { graded: false, raw: t, company: 'PSA', grade: '10' };
    const co = m[1].toUpperCase();
    return { graded: true, raw: 'Near Mint', company: co, grade: m[2].trim() };
  }

  const finishOf = (v) => {
    const k = String(v || '').trim().toLowerCase();
    if (!k) return '';
    return VARIANT_LABELS[k] || k.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  /* THE SAME FIVE GRADERS THE REST OF THE APP KNOWS, with the same links.
     This is a copy of the table in components/collection.js and it is meant
     to stay a copy: the feed is a separate bundle that loads on its own, so
     importing it would mean the feed waiting on the app. If a grader is
     added there, add it here -- a card's slab has to read the same wherever
     it is shown, which is the whole rule. */
  const GRADER_LINKS = {
    TAG: { direct: c => 'https://my.taggrading.com/card/' + encodeURIComponent(c) },
    PSA: { direct: c => 'https://www.psacard.com/cert/' + encodeURIComponent(c) },
    CGC: { direct: c => 'https://www.cgccards.com/certlookup/' + encodeURIComponent(c) + '/' },
    SGC: { lookup: 'https://gosgc.com/cert-code-lookup' },
    BGS: { lookup: 'https://www.beckett.com/grading' }
  };

  /* A stored condition reads "PSA 10" or "TAG 10 Pristine" -- graded rows
     always start with the company, raw ones never do. */
  function graderOf(condition) {
    const first = String(condition || '').trim().split(/\s+/)[0].toUpperCase();
    return GRADER_LINKS[first] ? first : '';
  }

  /* ---- YOUR VALUE on a graded card (26 Sep 2026) ---------------------------
     The owner's own figure for a slab, because nothing we can reach prices
     one. Counts only while the card is graded. Same rules as collection.js;
     see owner_value.sql for the why. ACE counts as graded even though it has
     no report link, so this reads the ladders, not GRADER_LINKS. */
  function isGradedCond(condition) {
    const first = String(condition || '').trim().split(/\s+/)[0].toUpperCase();
    return !!GRADE_LADDERS[first];
  }
  function parseOwnerValue(text) {
    const t = String(text == null ? '' : text).replace(/[$,\s]/g, '');
    if (!t) return null;
    const n = Number(t);
    if (!isFinite(n) || n < 0 || n > 1000000) return null;
    return Math.round(n * 100) / 100;
  }
  const OWNER_VALUE_WARN_X = 20;
  const OWNER_VALUE_BIG = 10000;
  function ownerValueWarning(value, raw) {
    if (value == null) return '';
    /* No price history for this card yet: still ask on a five-figure number. */
    if (!(raw > 0)) {
      return value >= OWNER_VALUE_BIG
        ? 'That\u2019s a big number for one card. You sure? Check the sold listings.' : '';
    }
    const x = value / raw;
    return x > OWNER_VALUE_WARN_X
      ? 'That\u2019s ' + Math.round(x) + '\u00d7 the raw price. You sure? Check the sold listings.'
      : '';
  }

  function gradingReport(condition, cert) {
    const co = graderOf(condition);
    const num = String(cert || '').trim();
    if (!co || !num) return null;
    const entry = GRADER_LINKS[co];
    return entry.direct
      ? { company: co, url: entry.direct(num), direct: true }
      : { company: co, url: entry.lookup, direct: false };
  }

  /* THE NUMBER OFF THE CARD, out of the catalogue id -- `base1-4` is card 4
     of Base Set. Display only, and deliberately NOT written to p.num: that
     field feeds the lookup link, which expects the shop's "4/102" form, and
     sending it "4" would search the whole catalogue for a four. */
  const localNum = (cardId) => {
    const m = /-([^-]+)$/.exec(String(cardId || '').trim());
    return m ? m[1] : '';
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
      // ?who=@tacomike417 is the same person as ?who=tacomike417.
      const w = (new URLSearchParams(location.search).get('who') || '').replace(/^@/, '');
      return /^[A-Za-z0-9_-]{3,24}$/.test(w) ? w : '';
    } catch (_) { return ''; }
  })();

  /* INVITES -- social pack #5. Your invite link is your profile link. The
     first profile a visitor lands on (or ?ref=) is remembered for 30 days;
     once they have an account, claim_invite() in invites.sql decides whether
     it counts (only accounts under 3 days old do). */
  const REF_KEY = 'ip-ref-v1';
  const inviteRef = (() => {
    try {
      const q = new URLSearchParams(location.search);
      /* The landing page of this visit only -- the first feed page opened in
         this tab. Tapping around inside the app later gives nobody credit.
         (A profile link bounces through 404.html first, which is why this is
         not done with document.referrer.) */
      let landing = true;
      try { landing = !sessionStorage.getItem('ip-landed'); sessionStorage.setItem('ip-landed', '1'); } catch (_) {}
      const w = (q.get('ref') || '').replace(/^@/, '') || (landing ? WANTS_WHO : '');
      const old = JSON.parse(localStorage.getItem(REF_KEY) || 'null');
      if (old && old.u && Date.now() - old.t < 30 * 864e5) return old.u;
      if (/^[A-Za-z0-9_-]{3,24}$/.test(w)) { localStorage.setItem(REF_KEY, JSON.stringify({ u: w, t: Date.now() })); return w; }
    } catch (_) {}
    return '';
  })();

  /* Coming BACK from the lookup page, not arriving from a shared link:
     turn the pinned card over, because its back is what was being read. */
  const WANTS_FLIP = (() => {
    try { return new URLSearchParams(location.search).get('flip') === '1'; }
    catch (_) { return false; }
  })();

  const WANTS_TALK = (() => {
    /* a Loop link (l-) opens its own comments, in components/loops.js */
    try { const q = new URLSearchParams(location.search); return q.get('talk') === '1' && !/^l-/.test(q.get('post') || ''); }
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
      ? `<img class="vb" src="/assets/badge-original-2026.webp" alt="Infinite Original 2026"
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
      /* verified_at rides along so the CLAIM NOW dot knows whether your
         badge is still waiting. Asked for separately so a database without
         the column still gives back the name. */
      let { data, error } = await sb.from('profiles')
        .select('id, username, avatar_url, verified_at, tagline').eq('id', me).limit(1);
      if (error) ({ data } = await sb.from('profiles').select('id, username, avatar_url').eq('id', me).limit(1));
      if (data && data[0]) faces[me] = { id: me, name: data[0].username, avatar: data[0].avatar_url,
        badge: !!data[0].verified_at, tagline: data[0].tagline || '' };
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

  /* ---- WHAT A EURO IS WORTH TODAY -----------------------------------------
     Jeff reads the back of a card in Ohio and a Cardmarket price in euros
     tells him nothing. It stays un-converted in the HISTORY for the reason
     written directly above -- a stored row keeps the currency it was quoted
     in. It is converted at the moment it is DISPLAYED, and shown BESIDE the
     euro rather than instead of it, so the real quote is never hidden.

     Same source and the same two honesty rules as components/collection.js,
     which has done this on the card detail panel for months:

       1. A converted figure is ALWAYS marked approximate. It is a European
          marketplace price wearing a dollar sign.
       2. If the rate cannot be fetched, show the euro ALONE rather than a
          number guessed from a hardcoded rate. A missing conversion is
          recoverable; a wrong one quietly is not.

     One request for the life of the page, no key, no account, European
     Central Bank reference rates. */
  /* Named, because they are used inside template literals where a bare
     escape sequence would be read as part of the surrounding string. */
  const MINUS = '\u2212', MIDDOT = '\u00b7', POSS = '\u2019', DASH = '\u2013';

  const FX_URL = 'https://api.frankfurter.dev/v1/latest?from=EUR&to=USD';
  const FX_KEY = 'ip-eur-usd';

  /* REMEMBERED BETWEEN VISITS, on purpose.

     The first version fetched the rate when a card was turned over and
     redrew the back when it arrived -- so whether the dollar figure appeared
     depended on a network round trip winning a race against somebody's
     thumb. On a slow connection it lost, and the euro sat there alone,
     which is exactly what was reported.

     Now: the rate is read out of storage SYNCHRONOUSLY at startup, so on
     every visit after the first it is already in hand before a single card
     is drawn and there is no re-render and no flash. The network is only
     asked once a day, to refresh it.

     A stored rate is still shown when today's fetch fails -- a reference
     rate a day or two old is a fine guide to what a euro is worth, and it
     carries its own date so it is never passed off as today's. The rule
     that has not changed: with NO rate at all, the euro is shown alone. */
  let fxRate = null;              /* { rate, date } */
  let fxPromise = null;

  (function readStoredRate() {
    try {
      const raw = localStorage.getItem(FX_KEY);
      if (!raw) return;
      const v = JSON.parse(raw);
      if (v && isFinite(Number(v.rate)) && Number(v.rate) > 0) {
        fxRate = { rate: Number(v.rate), date: v.date || null, got: v.got || '' };
      }
    } catch (_) { /* storage THROWS in private browsing; carry on without */ }
  })();

  function loadEurToUsd() {
    if (fxPromise) return fxPromise;
    /* Already refreshed today -- nothing to ask for. */
    const today = new Date().toISOString().slice(0, 10);
    if (fxRate && fxRate.got === today) return Promise.resolve(fxRate);

    fxPromise = (async () => {
      try {
        const res = await fetch(FX_URL, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) return fxRate;
        const data = await res.json();
        const rate = Number(data && data.rates && data.rates.USD);
        if (!isFinite(rate) || rate <= 0) return fxRate;
        fxRate = { rate: rate, date: (data && data.date) || null, got: today };
        try { localStorage.setItem(FX_KEY, JSON.stringify(fxRate)); } catch (_) {}
        return fxRate;
      } catch (_) {
        /* Keep whatever was stored. A day-old reference rate beats nothing. */
        return fxRate;
      }
    })();
    fxPromise.catch(() => { fxPromise = null; });
    return fxPromise;
  }

  /* Asked for at startup rather than on the first flip, so it is in hand
     long before anybody turns a card over. Costs one small request. */
  try { loadEurToUsd(); } catch (_) {}

  /* The euro alone, or the euro with a dollar estimate beside it once the
     rate is in. The tilde is doing real work: it says estimate, not quote. */
  function withUsd(amount, currency) {
    const base = esc(money(amount, currency));
    if (currency !== 'EUR' || !fxRate || amount == null || isNaN(amount)) return base;
    const usd = Math.round(Number(amount) * fxRate.rate * 100) / 100;
    const when = fxRate.date ? 'rate for ' + fxRate.date : 'reference rate';
    return base + ' <span class="fx" title="Converted at the European Central Bank '
      + esc(when) + '. A guide, not a quote.">(' + '\u2248' + esc(money(usd, 'USD')) + ')</span>';
  }

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
    pencil:'<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/></svg>',
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
  const NO_PHOTO = '/assets/feed/no-photo.webp';

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

  /* NO PICTURE, NO PLACE IN THE FEED (26 Sep 2026, Mike's rule). A post
     whose only picture is the "needs its close-up" placeholder is filtered
     out before it is drawn -- see hasPicture() and loadMore(). This catches
     the other way to end up with no picture: an address that turns out to be
     dead once the phone asks for it. Inside the main feed that picture is
     dropped, and a post left with nothing to show goes with it. Everywhere
     else (a profile grid, a shared post someone came to see on purpose) it
     keeps the old behavior and shows the placeholder. */
  window.__ipNoPic = function (img) {
    img.onerror = null;
    const post = img.closest('.post');
    const inFeed = post && !post.closest('.pinned-post') && !post.classList.contains('tutorial')
      && !(typeof feed !== 'undefined' && feed && feed.classList.contains('is-grid'));
    if (inFeed) {
      const fig = img.closest('figure');
      const frame = img.closest('.frame');
      if (fig) fig.remove();
      if (!frame || !frame.querySelector('figure img')) { post.remove(); return; }
      return;
    }
    img.src = NO_PHOTO;
    img.closest('.frame')?.setAttribute('data-shape', 'portrait');
  };
  const fallback = `onerror="window.__ipNoPic(this)"`;
  const hasPicture = (p) => {
    if (!p) return false;
    if (p.kind === 'reward') return (p.cards || []).some(c => c && (c.thumb_url || c.art_url));
    return (p.pics || []).some(q => q && q.u && q.u !== NO_PHOTO);
  };

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

    const look = '/?page=lookup&q=' + encodeURIComponent(
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
      : (p.kind === 'shop' && p.key ? '/?page=item&id=' + encodeURIComponent(p.key) : '');

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
      /* Jeff's photograph is the front; the catalogue art is the card. */
      art:   r.art_url || '',
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
    const many = p.pics.length > 1;
    const lvl = heatLevel(n + (hyped ? 1 : 0));
    return `
    <article class="post is-photo${many ? ' is-multi' : ''}${p.shop ? ' is-shop' : ''}" data-key="${esc(p.key)}" data-when="${esc(p.when || '')}"
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
          <img class="avatar" src="${esc(p.avatar || '/assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">
        </button>
        <button class="who who-btn is-shop" type="button" data-open-shop>
          <b>${esc(SHOP_WHO)}</b><small>${esc(agoShort(p.when) || 'At the shop')}</small>
        </button>
        <!-- PINNED IS A LABEL. REMOVE IS A DOOR. They were an either/or, and
             the arithmetic of that went wrong in one direction only: the
             shop's NEWEST photo is the one that gets pinned, and the newest
             photo is exactly the one somebody wants to take down when they
             have just posted the wrong picture. So the one post Jeff most
             needs the button on was the one post that never had it.
             Both now, and the badge stays first because it explains why the
             post is sitting at the top of the feed. -->
        ${p.pinned ? `<span class="pin">PINNED</span>` : ''}
        ${p.mine ? `<button class="post-drop" type="button" data-drop-post="${esc(p.rowId)}">REMOVE</button>` : ''}
        ` : `
        <button class="avatar-btn" type="button" data-open-person="${esc(p.userId)}"
                data-open-label="${esc(p.who || 'A collector')}"
                aria-label="See ${esc(p.who || 'this collector')}&rsquo;s cards">
          <img class="avatar" src="${esc(p.avatar || '/assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">
        </button>
        <button class="who who-btn" type="button" data-open-person="${esc(p.userId)}"
                data-open-label="${esc(p.who || 'A collector')}">
          <span class="nameline"><b>${esc(at(p.who) || 'A collector')}</b>${badgeOf(faces[p.userId])}</span>
          ${subLine(p, agoShort(p.when) || 'Posted a photo')}
        </button>
        ${p.intro ? `<span class="nm-tag">NEW MEMBER</span>` : ''}
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

      <div class="frame" data-shape="${many ? 'portrait' : 'auto'}">
        ${many ? `<span class="count">1 / ${p.pics.length}</span>` : ''}
        <div class="rail">
          ${many
            ? p.pics.map((q, k) => `<figure><img src="${esc(q.u)}" alt="" loading="${k ? 'lazy' : 'eager'}" decoding="async" ${fallback}></figure>`).join('')
            : (shot ? `<figure><img src="${esc(shot.u)}" alt="" loading="lazy" decoding="async" ${fallback}></figure>` : '')}
        </div>
        ${many ? `<div class="pips">${p.pics.map((_, k) =>
            `<button type="button" class="${k ? '' : 'on'}" data-pip="${k}" aria-label="Photo ${k + 1}"></button>`).join('')}</div>
          <button class="nudge prev" type="button" data-nudge="-1" aria-label="Previous photo">${I.chevL}</button>
          <button class="nudge next" type="button" data-nudge="1" aria-label="Next photo">${I.chevR2}</button>` : ''}
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
      ${p.intro && !p.mine ? `<button type="button" class="welcome-btn" data-welcome="${esc(p.rowId)}" data-welcome-owner="${esc(p.userId)}">\u{1F44B} Say welcome</button>` : ''}

      ${p.caption
        ? `<p class="caption"><b${p.shop ? ' class="is-shop"' : ''}>${esc(at(p.who) || 'A collector')}</b>${p.shop ? '' : badgeOf(faces[p.userId])} <span class="cap-t">${mentions(p.caption)}</span></p>`
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
    paintSocial();
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
    paintSocial();
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
    /* Somebody you blocked is not in your threads. */
    const rows = (data || []).filter(r => !blocked.has(r.user_id));

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
    const face = (who && who.avatar) || '/assets/hyde-bot.png';
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
             onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">
        <div class="cbody">
          <p class="cwho"><b class="cname${isOwner ? ' is-owner' : ''}"
             data-open-person="${esc(c.user_id)}" data-open-label="${esc(name)}"
             role="link" tabindex="0">${esc(at(name))}</b>${badgeOf(who)}
            ${isOwner ? '<span class="tag">THEIR POST</span>' : ''}
            <small>${esc(agoShort(c.created_at) || '')}</small></p>
          <p class="ctext">${mentions(c.body)}</p>
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

  /* `fromBack` is the stack calling in to close it. Without it, closing
     would call popBack, which calls history.back(), which pops the layer and
     calls this again -- a close that closes itself. */
  async function toggleTalk(art, on, fromBack) {
    const sec = art.querySelector('[data-talk]');
    const btn = art.querySelector('[data-comment]');
    if (!sec) return;
    const key = sec.getAttribute('data-talk');

    if (!on) {
      if (!fromBack && popBack('talk')) return;   /* the listener closes it */
      sec.hidden = true;
      talkOpen.delete(key);
      if (btn) btn.setAttribute('aria-expanded', 'false');
      return;
    }

    /* READING A THREAD IS A PLACE YOU WENT. Back used to leave the feed
       entirely from here and reload it at the top -- and since ?talk=1 deep
       links straight into a thread, that was the easiest way in the whole
       app to lose your place. One layer, one tap out. */
    if (!backHas('talk')) pushBack('talk', () => toggleTalk(art, false, true));

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
    location.href = '/?page=account';
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
    if (!error) setTimeout(() => askPush('comment'), 1200);
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
    /* A slab's certificate is part of what the card IS, so it reads the same
       here as it does on the back and on the card page: the number, and a
       way through to the grader's own report. Fourth slot says the value is
       already HTML and must not be escaped again -- the only row that uses
       it, and the reason it exists. */
    const certReport = gradingReport(p.cond, p.cert);
    const facts = [
      ['Where', p.kind === 'shop' ? 'At the shop' : 'In a collection', 'state'],
      finish ? ['Finish', finish, ''] : null,
      ['Condition', (p.cond || 'RAW').toUpperCase(), 'cond'],
      p.cert ? ['Cert #', certReport
        ? '<a class="sp-cert" href="' + esc(certReport.url) + '" target="_blank" rel="noopener noreferrer">'
          + esc(p.cert) + '</a>'
        : esc(p.cert), 'cond', true] : null,
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
    /* NO ADD-A-PHOTO TILE ON CARD POSTS (27 Sep 2026, Mike). A card post is
       the card. Anything of your own -- a selfie, your binder, a pull -- is a
       photo post from +, and that is what fills My Photos. The scanned
       picture of the card itself still shows: it is a photo OF the card. */
    const slides = photos;

    return `
    <article class="post${p.kind === 'shop' ? ' is-shop' : ''}" data-key="${esc(p.key)}" data-when="${esc(p.when || '')}" data-price="${esc(p.price == null ? '' : p.price)}"
             data-row="${esc(p.rowId || '')}" data-owner="${esc(p.userId || '')}" data-note="${esc(p.note || '')}"
             data-link="${esc(shareLink(p))}"
             data-name="${esc(p.name || '')}" data-num="${esc(p.num || '')}"
             data-set="${esc(p.set || '')}" data-localnum="${esc(p.numShown || '')}"
             data-variant="${esc(p.variant || '')}" data-cond="${esc(p.cond || '')}"
             data-cert="${esc(p.cert || '')}" data-qty="${esc(p.qty || 1)}"
             data-edition="${esc(p.edition || '')}"
             data-ownerval="${esc(p.ownerValue == null ? '' : p.ownerValue)}"
             data-art="${esc(p.art || '')}">
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
          <img class="avatar" src="${esc(p.avatar || '/assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">
        </button>
        <button class="who who-btn is-shop" type="button" data-open-shop>
          <b>${esc(p.who || SHOP_WHO)}</b><small>${esc(agoShort(p.when) || 'At the shop')}</small>
        </button>
        ` : !p.userId ? `
        <img class="avatar" src="${esc(p.avatar || '/assets/hyde-bot.png')}" alt=""
             onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">
        <div class="who"><b>${esc(at(p.who) || 'A collector')}</b><small>${esc(sub || 'At the shop')}</small></div>
        ` : `
        <!-- A name and a face are the obvious things to tap to see somebody's
             cards, so they are both the same button. It narrows the feed the
             way a search result does, chip and all, rather than being a
             second and different way of looking at one person. -->
        <button class="avatar-btn" type="button" data-open-person="${esc(p.userId)}"
                data-open-label="${esc(p.who || 'A collector')}"
                aria-label="See ${esc(p.who || 'this collector')}&rsquo;s cards">
          <img class="avatar" src="${esc(p.avatar || '/assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">
        </button>
        <button class="who who-btn" type="button" data-open-person="${esc(p.userId)}"
                data-open-label="${esc(p.who || 'A collector')}">
          <span class="nameline"><b>${esc(at(p.who) || 'A collector')}</b>${badgeOf(faces[p.userId])}</span>
          ${subLine(p, agoShort(p.when) || 'In their collection')}
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
              ${p.pics.map(q => figureHTML(q, p)).join('')}
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
      <p class="caption"><b${p.kind === 'shop' ? ' class="is-shop"' : ''}>${esc(at(p.who) || 'A collector')}</b>${badgeOf(faces[p.userId])} ${esc(p.name)}${p.set ? ' — ' + esc(p.set) : ''}</p>

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
      ${tagsHTML(p)}
      ${talkHTML(p)}

      <section class="snap${shut ? ' shut' : ''}">
        <button class="snap-head" type="button" data-snap
                aria-expanded="${shut ? 'false' : 'true'}">
          <span class="ic">${I.card}</span><b>CARD PULSE</b>${I.chev}
        </button>
        <div class="snap-body">
          <dl class="pulse-rows">${facts.map(([k, v, cls, raw]) => `
            <div class="pulse-row"><dt>${esc(k)}</dt><dd${cls ? ` class="${cls}"` : ''}>${raw ? v : esc(v)}</dd></div>`).join('')}
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
     It is not a database row -- it is one constant, so it can never be
     missing, never be slow, and never need a query.

     SEEN ONCE, THEN GONE (26 Sep 2026, Mike's call: "after you have seen it
     once dont show it again"). The same card at the top of every visit made
     the feed look like it never changed. The first time it is drawn, this
     phone remembers it, and every visit after that starts on real posts.
     Kept per phone in localStorage, not on the profile, so a guest gets
     the same treatment as somebody signed in. A private window that cannot
     store anything just keeps seeing it, which is the harmless way to fail. */
  const START_SEEN = 'ip_start_here_seen';
  function startSeen() {
    try { return localStorage.getItem(START_SEEN) === '1'; } catch (_) { return false; }
  }
  function tutorialHTML() {
    if (startSeen()) return '';
    try { localStorage.setItem(START_SEEN, '1'); } catch (_) {}
    return `
    <article class="post tutorial">
      <header class="post-top">
        <button class="avatar-btn" type="button" data-open-shop
                aria-label="See what is at the shop">
          <img class="avatar" src="/assets/hyde-bot.png" alt=""
               onerror="this.onerror=null;this.style.visibility='hidden'">
        </button>
        <button class="who who-btn is-shop" type="button" data-open-shop>
          <b>${esc(SHOP_WHO)}</b><small>Start here</small>
        </button>
        <span class="pin">PINNED</span>
      </header>
      <div class="frame" data-shape="auto">
        <div class="rail">
          <figure><img src="/assets/feed/jeff-welcome.webp"
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

  /* THERE IS NO VARIANT CALLED "market". This asked for one for weeks and
     got nothing back on every card in the app, which is why every card back
     said "no price was recorded back then" while LOOK UP showed a price a
     second later: the number was there the whole time, under a name nobody
     here was asking for.

     What sync-prices actually writes, one row per day per card:
       tcgplayer   variant is the PRINTING -- "normal", "holofoil",
                   "reverse-holofoil", "1st-edition-holofoil" -- in USD
       cardmarket  variant is always "trend", in EUR

     So the filter comes off the query and the choosing happens here, where
     the card's own printing is known. */
  async function priceHistory(cardId) {
    /* card_price_history has a policy for `authenticated` and none for `anon`,
       so a signed-out reader gets nothing here. That is not an error -- the
       back simply shows what it can and says nothing it cannot prove. */
    if (!sb || !cardId) return [];
    try {
      const { data, error } = await sb.from('card_price_history')
        .select('recorded_on, price, variant, source, currency')
        .eq('card_id', cardId)
        .order('recorded_on', { ascending: true }).limit(400);
      if (error || !Array.isArray(data)) return [];
      return data;
    } catch (_) { return []; }
  }

  /* ONE SERIES, THE RIGHT ONE. A card with three printings has three
     TCGplayer series in here and they are different prices -- comparing a
     reverse holo reading against a normal one is how a card "moves" without
     moving. Take the holding's own printing; if the history has nothing
     under that name, take whichever printing has the most readings rather
     than mixing them, so the series is at least internally honest. */
  function seriesFor(hist, source, variant) {
    const rows = hist.filter(r => (r.source || 'tcgplayer') === source);
    if (!rows.length) return [];
    if (source === 'cardmarket') return rows.filter(r => r.variant === 'trend');
    const want = String(variant || '').trim().toLowerCase();
    const mine = want ? rows.filter(r => String(r.variant).toLowerCase() === want) : [];
    if (mine.length) return mine;
    const byVariant = new Map();
    rows.forEach(r => {
      const k = String(r.variant);
      if (!byVariant.has(k)) byVariant.set(k, []);
      byVariant.get(k).push(r);
    });
    let best = [];
    byVariant.forEach(list => { if (list.length > best.length) best = list; });
    return best;
  }

  /* WHAT IT WAS WORTH THE DAY THEY ADDED IT.
     One market at a time -- TCGplayer against TCGplayer, Cardmarket against
     Cardmarket. The reading used is the last one taken on or before the day
     the card went in. If the price history does not reach back that far, the
     earliest reading there is gets used INSTEAD OF NOTHING, and its own date
     is shown beside it, because calling a later reading "the price when
     added" would be a quiet little lie. */
  function atAdd(hist, source, when, variant) {
    const rows = seriesFor(hist, source, variant);
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

  /* ---- READING A POINT OFF THE CHART -------------------------------------
     An HTML chart is interactive by default, so it ships with a readout
     rather than leaving somebody to guess at a line. One delegated handler
     for every chart on the page: touch or hover anywhere across it and the
     nearest reading is named underneath, with a hairline marking where.

     Attached to the document once, not per chart, because charts are drawn
     and thrown away every time a range is tapped. */
  function chartPoint(ev) {
    const svg = ev.target.closest('.pchart');
    if (!svg) return;
    if (!svg.__xs) {
      svg.__xs = (svg.getAttribute('data-xs') || '').split(',').map(Number);
      svg.__ds = (svg.getAttribute('data-ds') || '').split(',')
        .map(t => { const i = t.indexOf(':'); return [Number(t.slice(0, i)), Number(t.slice(i + 1))]; });
    }
    const rows = svg.__ds;
    if (!rows || rows.length < 2) return;
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const x = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - box.left) / box.width * CH_W;

    let best = 0, bestD = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const d = Math.abs(svg.__xs[i] - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    const cross = svg.querySelector('.cross');
    if (cross) {
      cross.setAttribute('x1', svg.__xs[best].toFixed(1));
      cross.setAttribute('x2', svg.__xs[best].toFixed(1));
      cross.style.display = '';
    }
    const out = svg.parentElement && svg.parentElement.querySelector('[data-readout]');
    if (out) out.textContent = day(new Date(rows[best][0]).toISOString().slice(0, 10))
      + '   ' + money(rows[best][1], svg.getAttribute('data-cur') || 'USD');
  }

  /* THE TARGET MUST BE THE CHART ITSELF, NOT SOMETHING INSIDE IT.
     pointerleave does not bubble, so this listens in the capture phase --
     which means it also sees the event fire as the pointer crosses from the
     line to a label to the dot, all of them INSIDE the chart. Matching with
     closest() cleared the readout on every one of those, so dragging a thumb
     across the chart made the number flicker and then vanish. Only the
     element that actually is the chart counts as leaving it. */
  function chartLeave(ev) {
    const svg = ev.target;
    if (!svg || !svg.classList || !svg.classList.contains('pchart')) return;
    const cross = svg.querySelector('.cross');
    if (cross) cross.style.display = 'none';
    const out = svg.parentElement && svg.parentElement.querySelector('[data-readout]');
    if (out) out.textContent = out.getAttribute('data-span') || '';
  }

  document.addEventListener('pointermove', chartPoint, { passive: true });
  document.addEventListener('touchmove',   chartPoint, { passive: true });
  document.addEventListener('pointerleave', chartLeave, true);
  document.addEventListener('touchend',     chartLeave, { passive: true });

  /* ---- THE PRICE CHART ----------------------------------------------------
     ONE SERIES, ONE AXIS, and that is a rule rather than a simplification.
     The obvious "improvement" is to draw TCGplayer and Cardmarket together,
     and it would be wrong twice over: they are quoted in different
     currencies, and converting the old rows to match would bake today's
     exchange rate into a reading from March. Two scales on one plot invent a
     correlation that is not in the data. So the chart draws the market the
     rest of this card back is already quoting, in its own currency, and says
     which market that is.

     No library. It is a polyline and three hairlines. */
  const CH_W = 320, CH_H = 96, CH_L = 4, CH_R = 4, CH_T = 10, CH_B = 16;

  /* WHAT THE TABLE ACTUALLY HOLDS IS THIRTY DAYS.

     prune_price_history() runs daily at 05:30 UTC and deletes every reading
     older than 30 days -- see supabase/price_sync.sql. So 3M, 6M and 1Y were
     offering windows that can never contain anything, and the gate meant to
     hide an empty range did not catch it: it asked "are there two readings
     inside this window", and with a month of data EVERY window contains all
     of them. Four tabs, one picture, drawn four times.

     These are the ranges a thirty-day table can actually tell apart, and the
     gate below now asks the only question that matters: does this window
     leave anything OUT. If it does not, it is the same chart as ALL and it
     is not offered. Widen the retention in price_sync.sql and longer ranges
     appear here on their own -- nothing here needs changing. */
  const RANGES = [['7D', 7], ['14D', 14], ['30D', 30], ['3M', 90], ['1Y', 365], ['ALL', 0]];

  function inRange(rows, days) {
    if (!days) return rows;
    const cut = Date.now() - days * 86400000;
    const kept = rows.filter(r => Date.parse(r.recorded_on) >= cut);
    /* A window with one reading in it is not a line. Fall back to the whole
       series rather than drawing a dot and calling it a chart. */
    return kept.length >= 2 ? kept : rows;
  }

  function chartSVG(rows, cur) {
    if (!rows || rows.length < 2) return '';
    const xs = rows.map(r => Date.parse(r.recorded_on));
    const ys = rows.map(r => Number(r.price));
    const x0 = xs[0], x1 = xs[xs.length - 1];
    let lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    /* A card that never moved is a flat line across the middle, not a
       zero-height band that divides by nothing. */
    if (hi - lo < 0.01) { const m = (hi + lo) / 2 || 1; lo = m * 0.95; hi = m * 1.05; }
    const span = (x1 - x0) || 1;
    const px = (t) => CH_L + ((t - x0) / span) * (CH_W - CH_L - CH_R);
    const py = (v) => CH_T + (1 - (v - lo) / (hi - lo)) * (CH_H - CH_T - CH_B);

    const pts = rows.map((r, i) => px(xs[i]).toFixed(1) + ',' + py(ys[i]).toFixed(1));
    const area = 'M' + pts[0] + 'L' + pts.join('L')
               + 'L' + px(x1).toFixed(1) + ',' + (CH_H - CH_B) + 'L' + px(x0).toFixed(1)
               + ',' + (CH_H - CH_B) + 'Z';

    const move = ys[ys.length - 1] - ys[0];
    const cls  = move > 0.005 ? 'up' : (move < -0.005 ? 'down' : 'flat');

    /* Gridlines are SOLID hairlines one shade off the surface. Dashed reads
       as "projection" when it is just a grid. */
    const grid = [0, 0.5, 1].map(f => {
      const y = (CH_T + f * (CH_H - CH_T - CH_B)).toFixed(1);
      return `<line class="g" x1="${CH_L}" y1="${y}" x2="${CH_W - CH_R}" y2="${y}"/>`;
    }).join('');

    const lastX = px(x1), lastY = py(ys[ys.length - 1]);
    /* Labelled selectively -- the high, the low and the endpoint. A number on
       every point is chaos and goes unread. */
    /* THE READOUT'S DATA, CARRIED ON THE ELEMENT. The chart is built as a
       string and handed to innerHTML, so there is no moment at which a
       property could be attached to it -- and it is rebuilt from scratch
       every time a range is tapped, so anything attached afterwards would
       have to be re-attached. Attributes survive both. */
    const xsAttr = rows.map((r, i) => px(xs[i]).toFixed(1)).join(',');
    const dsAttr = rows.map((r, i) => Date.parse(r.recorded_on) + ':' + ys[i]).join(',');

    return `<svg class="pchart ${cls}" data-cur="${esc(cur)}"
      data-xs="${xsAttr}" data-ds="${dsAttr}"
      viewBox="0 0 ${CH_W} ${CH_H}" role="img"
      aria-label="Price from ${esc(day(rows[0].recorded_on))} to ${esc(day(rows[rows.length - 1].recorded_on))}, ${esc(money(ys[0], cur))} to ${esc(money(ys[ys.length - 1], cur))}">
      ${grid}
      <path class="a" d="${area}"/>
      <polyline class="l" points="${pts.join(' ')}"/>
      <circle class="dot" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.2"/>
      <text class="hi" x="${CH_L + 2}" y="${CH_T - 2}">${esc(money(hi, cur))}</text>
      <text class="lo" x="${CH_L + 2}" y="${CH_H - CH_B + 10}">${esc(money(lo, cur))}</text>
      <text class="d0" x="${CH_W - CH_R}" y="${CH_H - CH_B + 10}" text-anchor="end">${esc(day(rows[rows.length - 1].recorded_on))}</text>
      <line class="cross" x1="0" y1="${CH_T}" x2="0" y2="${CH_H - CH_B}" style="display:none"/>
    </svg>`;
  }

  /* The chart plus its range row. Re-rendered on its own when a range is
     tapped, so turning the card over again is not needed. */
  function chartBlock(rows, cur, days) {
    const win = inRange(rows, days);
    const svg = chartSVG(win, cur);
    if (!svg) return '';
    const oldest = Date.parse(rows[0].recorded_on);
    const tabs = RANGES.map(([label, d]) => {
      if (d) {
        const cut = Date.now() - d * 86400000;
        /* Two questions, and it takes BOTH: enough readings inside to draw a
           line, and at least a couple left OUT. "At least a couple" rather
           than "any" on purpose -- with thirty days in the table, a 30D
           window clips one reading off a thirty-day series and draws a
           chart indistinguishable from ALL. A tab has to earn its place by
           showing something different. */
        const inside = rows.filter(r => Date.parse(r.recorded_on) >= cut).length;
        if (inside < 2 || rows.length - inside < 2) return '';
      }
      return `<button type="button" class="rg${d === days ? ' on' : ''}" data-range="${d}">${label}</button>`;
    }).join('');
    return `<section class="chart" data-chart>
        <div class="chart-head">
          <span class="chart-k">${esc(cur === 'EUR' ? 'CARDMARKET' : 'TCGPLAYER')} HISTORY</span>
          <div class="ranges">${tabs}</div>
        </div>
        ${svg}
        <!-- Says how far back this goes BEFORE anybody touches it. With a
             thirty-day table that is the most useful thing the line can say
             about itself, and it stops "TCGPLAYER HISTORY" reading as though
             it means all of history. Replaced by the reading under a thumb,
             and put back when the thumb lifts. -->
        <p class="readout" data-readout data-span="${esc(day(win[0].recorded_on) + '  ' + DASH + '  ' + day(win[win.length - 1].recorded_on))}">${esc(day(win[0].recorded_on))}  ${DASH}  ${esc(day(win[win.length - 1].recorded_on))}</p>
      </section>`;
  }

  /* ---- EDITING YOUR OWN COPY, WITHOUT LEAVING THE CARD ---------------------
     A card gets scanned in a hurry and the finish or the grade is wrong, and
     until now the only way to correct it was to go and find the card
     somewhere else in the app. This is the correction where the mistake is
     visible: on the back of the card, with the wrong value in front of you.

     A DIALOG RATHER THAN A SCREEN, deliberately. Sending somebody to another
     page to change one dropdown means finding their way back afterwards --
     and their way back is the thing that has already gone wrong twice today.
     Nothing navigates: the box opens over the card, and closing it puts the
     corrected card straight back underneath.

     FOUR WAYS OUT, because a box with one is a box somebody gets stuck in:
     the X, CANCEL, tapping the dark outside it, and the phone's own Back
     button (pushState, exactly as the card flip does).

     ONLY THE CARD'S OWNER OPENS IT. The button is drawn only on p.mine, and
     the write is .eq('user_id', me) as well as the row id -- the policy on
     user_cards is what actually enforces that, but a query that could not
     touch somebody else's row even if the policy were dropped is the one
     worth writing. */
  /* Sold listings for the card as the box currently describes it. */
  /* EDITIONS -- same rule as My Collection (components/collection.js):
     English sets up to Neo Destiny had a 1st Edition run, Base Set also a
     Shadowless one. Unlimited is searched as "not 1st, not shadowless",
     because Unlimited listings rarely say so. */
  const ED_SETS = { 'base set': 3, 'base': 3, 'jungle': 2, 'fossil': 2, 'team rocket': 2,
    'gym heroes': 2, 'gym challenge': 2, 'neo genesis': 2, 'neo discovery': 2,
    'neo revelation': 2, 'neo destiny': 2 };
  function editionsForSet(setName) {
    const n = ED_SETS[String(setName || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()];
    return !n ? [] : n === 3 ? ['1st Edition', 'Shadowless', 'Unlimited'] : ['1st Edition', 'Unlimited'];
  }
  function edWord(ed) {
    return ed === '1st Edition' ? '1st edition' : ed === 'Shadowless' ? 'shadowless'
      : ed === 'Unlimited' ? '-1st -shadowless' : '';
  }

  function ceSoldUrl(p, cond) {
    const q = [p.name, p.set || 'pokemon', edWord(p.edition), cond || p.cond].filter(Boolean).join(' ').trim();
    return 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(q)
      + '&LH_Sold=1&LH_Complete=1&_sop=13';
  }

  function editBoxHTML(p) {
    const cur = splitCondition(p.cond);
    const opt = (v, label, on) =>
      `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;

    const finishes = Object.keys(VARIANT_LABELS)
      .map(k => opt(k, VARIANT_LABELS[k], String(p.variant || 'normal').toLowerCase() === k))
      .join('');

    const raws = RAW_CONDITIONS.map(c =>
      `<button type="button" class="ce-chip${!cur.graded && cur.raw === c ? ' on' : ''}"
         data-raw="${esc(c)}">${esc(c)}</button>`).join('');

    const companies = GRADE_COMPANIES
      .map(c => opt(c, c, cur.company === c)).join('');

    const eds = editionsForSet(p.set);
    if (p.edition && eds.indexOf(p.edition) === -1) eds.push(p.edition);

    /* The ladder for the company that is selected RIGHT NOW. Changing the
       company redraws it, because a BGS 9.5 on a PSA slab is not a grade. */
    const grades = (GRADE_LADDERS[cur.company] || [])
      .map(g => opt(g.value, g.label, cur.grade === g.value)).join('');

    return `<div class="ce-wrap" data-edit-box>
      <div class="ce-dim" data-edit-close></div>
      <div class="ce-box" role="dialog" aria-modal="true" aria-label="Edit this card">
        <div class="ce-head">
          <b>EDIT THIS COPY</b>
          <button type="button" class="ce-x" data-edit-close aria-label="Close">&#10005;</button>
        </div>
        <p class="ce-name">${esc(p.name || 'Card')}</p>

        <label class="ce-lab" for="ce-finish">FINISH</label>
        <select class="ce-sel" id="ce-finish" data-ce-finish>${finishes}</select>

        ${eds.length ? `
        <label class="ce-lab" for="ce-ed">EDITION</label>
        <select class="ce-sel" id="ce-ed" data-ce-edition>
          ${opt('', 'Not sure', !p.edition)}
          ${eds.map(e => opt(e, e, p.edition === e)).join('')}
        </select>` : ''}

        <span class="ce-lab">CONDITION</span>
        <div class="ce-tabs">
          <button type="button" class="ce-tab${cur.graded ? '' : ' on'}" data-ce-mode="raw">RAW</button>
          <button type="button" class="ce-tab${cur.graded ? ' on' : ''}" data-ce-mode="graded">GRADED</button>
        </div>

        <div class="ce-raw" data-ce-panel="raw"${cur.graded ? ' hidden' : ''}>
          <div class="ce-chips" data-ce-raws>${raws}</div>
        </div>

        <div class="ce-graded" data-ce-panel="graded"${cur.graded ? '' : ' hidden'}>
          <div class="ce-two">
            <span><label class="ce-lab" for="ce-co">GRADER</label>
              <select class="ce-sel" id="ce-co" data-ce-company>${companies}</select></span>
            <span><label class="ce-lab" for="ce-gr">GRADE</label>
              <select class="ce-sel" id="ce-gr" data-ce-grade>${grades}</select></span>
          </div>
          <label class="ce-lab" for="ce-cert">CERT #</label>
          <input class="ce-in" id="ce-cert" type="text" inputmode="numeric"
                 autocomplete="off" spellcheck="false"
                 placeholder="off the slab" value="${esc(p.cert || '')}" data-ce-cert>
          <!-- Says what the number BUYS, so it is worth typing: PSA, CGC and
               TAG open the grader's own report on this exact slab. -->
          <p class="ce-hint">PSA, CGC and TAG numbers open the grader&rsquo;s own report on the card.</p>

          <!-- YOUR VALUE. What the slab is worth, in the owner's own words,
               because nothing we can reach prices a graded card. Blank =
               counts at raw price. The sold-listings link is right here so
               the number is one tap from proof. -->
          <label class="ce-lab" for="ce-val">YOUR VALUE ($)</label>
          <input class="ce-in" id="ce-val" type="text" inputmode="decimal"
                 autocomplete="off" placeholder="what it would sell for"
                 value="${esc(p.ownerValue == null ? '' : String(p.ownerValue))}" data-ce-value>
          <p class="ce-warn" data-ce-warn aria-live="polite"></p>
          <p class="ce-hint">Counts in your collection total.
            <a class="ce-sold" href="${esc(ceSoldUrl(p))}" target="_blank" rel="noopener noreferrer" data-ce-sold>Check eBay sold listings &rsaquo;</a></p>
        </div>

        <label class="ce-lab" for="ce-qty">HOW MANY</label>
        <div class="ce-qty">
          <button type="button" class="ce-step" data-ce-qty="-1" aria-label="One fewer">&minus;</button>
          <input class="ce-in ce-num" id="ce-qty" type="number" min="1" max="9999"
                 value="${esc(String(p.qty || 1))}" data-ce-qty-in>
          <button type="button" class="ce-step" data-ce-qty="1" aria-label="One more">+</button>
        </div>

        <p class="ce-err" data-ce-err hidden></p>
        <div class="ce-actions">
          <button type="button" class="ce-cancel" data-edit-close>CANCEL</button>
          <button type="button" class="ce-save" data-edit-save="${esc(p.rowId || '')}">SAVE</button>
        </div>
      </div>
    </div>`;
  }

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
    const shopSeries = seriesFor(hist, 'tcgplayer', p.variant);
    const first = shopSeries.length ? Number(shopSeries[0].price) : null;
    const last  = shopSeries.length ? Number(shopSeries[shopSeries.length - 1].price) : null;
    const now   = shopSeries.length ? last : (p.price != null ? p.price : null);
    const moved = (first != null && last != null) ? last - first : null;
    const dir   = moved == null ? '' : (moved > 0.005 ? 'up' : (moved < -0.005 ? 'down' : ''));

    /* WHAT IT IS WORTH NOW, AND WHETHER THAT IS UP OR DOWN.
       A collection card used to get "price when added" and nothing else, so
       the one question anybody actually turns a card over to ask -- is it
       worth more than when I got it -- had no answer on the page, even
       though every reading needed to answer it was already in the table.
       Measured from the reading used for PRICE WHEN ADDED, not from the
       oldest row in the table, or a card added last week would be credited
       with a year of somebody else's gains. */
    const mineAt   = isShop ? null : atAdd(hist, 'tcgplayer', p.when, p.variant);
    const nowRow   = shopSeries.length ? shopSeries[shopSeries.length - 1] : null;
    const nowPrice = nowRow ? Number(nowRow.price) : null;
    const thenPrice = mineAt && !isNaN(mineAt.price) ? mineAt.price : null;
    const myMove = (thenPrice != null && nowPrice != null) ? nowPrice - thenPrice : null;
    const myDir  = myMove == null ? '' : (myMove > 0.005 ? 'up' : (myMove < -0.005 ? 'down' : ''));
    const pct = (thenPrice && myMove != null && thenPrice > 0)
      ? (myMove / thenPrice) * 100 : null;

    const events = [];
    if (p.when) events.push(['ADDED', day(p.when), isShop ? 'Listed at the shop' : 'Added to the collection']);
    if (isShop && shopSeries.length > 1) {
      const l = shopSeries[shopSeries.length - 1];
      events.push(['VALUE', day(l.recorded_on),
        `${money(first)} \u2192 ${money(Number(l.price))}`]);
    }
    if (!isShop && myMove != null && myDir) {
      events.push(['VALUE', day(nowRow.recorded_on),
        `${money(thenPrice)} \u2192 ${money(nowPrice)}`]);
    }

    /* what the two markets said the day it went in */
    const added = isShop ? [] : MARKETS
      .map(([key, label]) => [label, atAdd(hist, key, p.when, p.variant)])
      .filter(([, v]) => v && !isNaN(v.price));

    /* THE HANDOFF. This used to pass a TEXT query and hope search_cards
       ranked the right printing first -- which is exactly why the card you
       came from kept landing two or three rows down. We already KNOW which
       card this is: it has a card_id. So hand over the id and let the lookup
       page pin it. The text query stays as the fallback for an old row with
       no card_id, and so the search box is never left empty. */
    const lookQ  = encodeURIComponent(p.num || p.name || '');
    const lookId = encodeURIComponent(p.cardId || '');
    /* AND THE WAY BACK. Looking a card up is a detour, not a departure --
       you go to check one thing and you want to end up where you started.
       The row id rides along so the lookup page can offer a door straight
       back to this exact card, and so the click handler below can leave a
       breadcrumb the phone's own Back button will find. */
    const lookFrom = p.rowId ? encodeURIComponent('c-' + p.rowId) : '';
    const lookHref = '/?page=lookup'
      + (lookQ ? '&q=' + lookQ : '')
      + (lookId ? '&card=' + lookId : '')
      + (lookFrom ? '&from=' + lookFrom : '');

    /* WHAT THIS COPY ACTUALLY IS.
       The back used to carry a date, a price and a story and nothing about
       the card itself -- you could turn over a PSA 10 Shadowless Charizard
       and be told only that it was added in September. Every row below is
       already on the post object or one line off it; the only thing the
       database is asked for that it was not asked for before is
       cert_number, and a database without that column just loses the CERT
       row rather than the whole back.

       A row with nothing behind it is left out rather than printed empty --
       "FINISH --" tells a reader nothing except that the app is missing
       something. */
    const finish  = finishOf(p.variant);
    const company = graderOf(p.cond);
    const slabbed = isGradedCond(p.cond);
    const report  = gradingReport(p.cond, p.cert);
    const condTxt = String(p.cond || '').trim();
    const setLine = [esc(p.set || ''), (p.numShown || p.num)
      ? '<span class="sp-num">#' + esc(p.numShown || p.num) + '</span>' : ''].filter(Boolean).join(' ');

    const spec = [
      setLine ? ['SET', setLine, 'wide'] : null,
      finish ? ['FINISH', esc(finish), ''] : null,
      p.edition ? ['EDITION', '<span class="sp-grade">' + esc(p.edition.toUpperCase()) + '</span>', ''] : null,
      [company ? 'GRADE' : 'CONDITION',
        condTxt
          ? '<span class="' + (company ? 'sp-grade' : '') + '">' + esc(condTxt.toUpperCase()) + '</span>'
          : '<span class="sp-raw">RAW</span>', ''],
      /* Only shown when there is one. A cert number on a raw card is not a
         thing, and an empty CERT row on every raw card in the feed would be
         five hundred rows of nothing. */
      /* Reads the way it reads on the card page -- the number, and the
         grader's own report behind it. SGC and BGS have no per-cert address,
         so those say "look up" rather than promising a page that opens on
         this card. */
      /* On a graded card the label at the top already carries the
         certificate, and its own link. Repeating it here said the same
         thing twice on one screen. Raw cards cannot reach this row at all
         (no grader, no cert), so in practice this drops the duplicate. */
      (p.cert && !company) ? ['CERT #', report
        ? '<a class="sp-cert" href="' + esc(report.url) + '" target="_blank" rel="noopener noreferrer">'
          + esc(p.cert) + '<small>' + esc(report.direct
            ? report.company + ' report \u2197'
            : 'Look up at ' + report.company + ' \u2197') + '</small></a>'
        : esc(p.cert), 'wide'] : null,
      ['QUANTITY', '\u00d7' + (p.qty || 1), '']
    ].filter(Boolean);

    /* THE SAME DISCLOSURE THE CARD PAGE MAKES, in the same words.
       Every price on this app is a raw Near Mint market figure. On a graded
       or a played copy that number is not what the card is worth, and the
       only honest answer is what one actually sold for -- so the note that
       says so carries the search that shows it. Shown on exactly the rows
       the card page shows it on: graded, or raw but not Near Mint. */
    const offCond = !!company || (!!condTxt && !/^near mint$/i.test(condTxt));
    /* A 1st Edition or Shadowless copy is off the printing's price too. */
    const edOnly = !offCond && (p.edition === '1st Edition' || p.edition === 'Shadowless');
    const offNM = offCond || edOnly;
    const soldQ = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(
      [p.name, p.numShown || p.num, p.set || 'pokemon', edWord(p.edition), company ? condTxt : '']
        .filter(Boolean).join(' ')) + '&LH_Sold=1&LH_Complete=1&_sop=13';

    /* WHICH CARD THIS IS, IN THE CARD'S OWN WORDS.
       The back opened with "THIS IS THE BACK OF YOUR CARD" and then never
       said WHICH card -- you could turn over a Shadowless Charizard and be
       told only a date. Name, finish and number: the three things anybody
       would say out loud to identify it. Missing parts are left out rather
       than printed as blanks. */
    const idBits = [p.name || 'Card', finish, p.numShown || p.num].filter(Boolean);

    /* WHOSE COPY. It said "THIS COPY", which is true of every card ever
       printed and so tells a reader nothing. The owner's user_id has been on
       the post all along as data-owner, and `faces` has mapped user_id to a
       display name since the feed was written -- the id simply was never
       handed across. Falls back to the old wording while the name is still
       loading, so nothing reads as broken mid-scroll. */
    const ownFace = p.owner ? faces[p.owner] : null;
    const ownName = (ownFace && ownFace.name) || '';
    const copyWho = isShop ? 'ON THE SHELF'
      : (p.mine ? 'YOUR COPY'
      : (ownName ? ownName.toUpperCase() + POSS + 'S COPY' : 'THIS COPY'));

    /* THE MOVEMENT, AS THE ONE THING THE EYE LANDS ON.
       Up the left in green, down the right in red, or a steady bar across the
       bottom -- the POSITION carries the direction, so it reads before any of
       the text does. On a card in somebody's collection this is THEIR number,
       measured from the day they added it; a shelf card has no "added" to
       measure from, so it is the whole recorded run. The label underneath
       says which, because a percentage with no period attached is not a fact. */
    const bigPct = isShop
      ? ((first && moved != null && first > 0) ? (moved / first) * 100 : null)
      : pct;
    const bigDir   = isShop ? dir : myDir;
    const bigSince = isShop ? 'ALL TIME' : 'SINCE ADDED';
    const bigTxt   = bigPct == null ? ''
      : (bigPct > 0 ? '+' : (bigPct < 0 ? MINUS : '')) + Math.abs(bigPct).toFixed(1) + '%';

    /* Steady is a real answer, not the absence of one. A card that has not
       moved should SAY so rather than leave a blank where the arrow goes --
       "nothing happened" is information a collector wants. */
    const haveMove = bigPct != null;
    const moveHTML = !haveMove ? '' : (bigDir
      ? `<span class="mv ${bigDir}">
           <svg viewBox="0 0 24 24" aria-hidden="true">
             <path d="${bigDir === 'up' ? 'M12 4l8 10h-5v6h-6v-6H4z' : 'M12 20l-8-10h5V4h6v6h5z'}"/>
           </svg>
           <b>${esc(bigTxt)}</b>
           <i>${bigSince}</i>
         </span>`
      : `<span class="mv steady"><b>STEADY</b><i>${bigSince}</i></span>`);

    /* The card, not the logo. Falls back to the branded panel when the row
       has no artwork -- still true of the English cards we are filling in, so
       the fallback has to look deliberate rather than broken. */
    /* WHICH SERIES THE CHART DRAWS. The same market the numbers above
       already quote, so the line and the figures can never disagree. Falls
       back to Cardmarket, in euros, for a card with no US readings -- drawn
       in its own currency rather than converted, because applying today's
       rate to a reading from March would move a line that never moved. */
    const cmSeries  = seriesFor(hist, 'cardmarket', p.variant);
    const chartRows = shopSeries.length >= 2 ? shopSeries : cmSeries;
    const chartCur  = shopSeries.length >= 2 ? 'USD' : 'EUR';

    const artHTML = p.art
      ? `<img class="art" src="${esc(p.art)}" alt="${esc(p.name || 'Card')}" decoding="async"
             onerror="this.onerror=null;this.closest('.backface').classList.add('no-art');this.remove()">`
      : '';

    /* ---- A GRADED CARD WEARS ITS LABEL ------------------------------------
       A slabbed card is not just a card with an extra field on it -- the
       label IS how a graded card is read, and everybody who owns one knows
       that shape on sight: the card named down the left, the company and the
       grade big on the right, the certificate number along the bottom. So a
       graded card gets that, in black on white, instead of the same dark
       title strip a raw card gets.

       DRAWN, NOT REPRODUCED. No grader's logo, no wordmark, no copy of
       anybody's label artwork -- the company's initials as plain text and
       the grade as a number. It reads as a grading label because that is the
       shape the information has, not because it is pretending to be PSA's.

       The grade splits into the number and its words: "10 Pristine" is a 10
       with PRISTINE under it, "9.5" is just a 9.5. Big number, small word --
       the same way it sits on a real label, and the same way somebody says
       it out loud. */
    const gradeBits = /^([\d.]+)\s*(.*)$/.exec(
      String(p.cond || '').replace(/^(PSA|BGS|CGC|SGC|TAG)\s+/i, '').trim());
    const gradeNum = gradeBits ? gradeBits[1] : '';
    const gradeWord = gradeBits ? gradeBits[2] : '';

    /* HE ASKED FOR THIS EXACTLY. PSA, CGC and TAG publish a page for one
       certificate, so the number is a link to that card's own report. SGC
       and BGS do not -- so those show the number and nothing else rather
       than a link that lands on a search box and looks broken. */
    const certHTML = !p.cert ? '' : (report && report.direct
      ? `<a class="slab-cert" href="${esc(report.url)}" target="_blank" rel="noopener noreferrer">
           <span>CERT ${esc(p.cert)}</span><i>${esc(company)} REPORT \u2197</i></a>`
      : `<span class="slab-cert is-plain"><span>CERT ${esc(p.cert)}</span></span>`);

    const headHTML = company ? `
      <div class="cardhead is-slab">
        <div class="slab">
          <div class="slab-id">
            <b>${esc(idBits.join(' ' + MIDDOT + ' '))}</b>
            ${p.set ? `<span>${esc(p.set)}</span>` : ''}
          </div>
          <div class="slab-grade">
            <span class="slab-co">${esc(company)}</span>
            <b>${esc(gradeNum || condTxt)}</b>
            ${gradeWord ? `<i>${esc(gradeWord.toUpperCase())}</i>` : ''}
          </div>
        </div>
        ${certHTML}
        <span class="eyebrow">THIS IS THE BACK OF YOUR CARD</span>
      </div>`
    : `
      <div class="cardhead">
        <b>${esc(idBits.join(' ' + MIDDOT + ' '))}</b>
        <span class="eyebrow">THIS IS THE BACK OF YOUR CARD</span>
      </div>`;

    return `
      ${headHTML}
      <div class="backface${p.art ? '' : ' no-art'}${haveMove && bigDir ? ' has-mv' : ''}">
        ${artHTML}
        ${moveHTML}
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
                <span class="v">${withUsd(v.price, v.currency)}</span>
                ${v.exact ? '' : `<span class="asof">as of ${esc(day(v.on))}</span>`}</span>`).join('')
              : `<span class="v">—</span>
                 <span class="asof">no price was recorded back then</span>`}
          </span></div>
          ${slabbed && p.ownerValue != null ? `
            <!-- YOUR VALUE. On a slab this is the number that counts: the
                 owner's own figure, because no price we can reach knows
                 what a graded copy sells for. The raw price rides
                 underneath so nobody mistakes one for the other. -->
            <div class="fact">${I.trend}<span><span class="k">${p.mine ? 'YOUR VALUE' : 'OWNER\u2019S VALUE'}</span>
              <span class="v">${esc(money(p.ownerValue))}</span>
              <span class="asof">${nowPrice != null ? 'raw copy ' + esc(money(nowPrice)) : 'set by the owner'}</span>
            </span></div>` : nowPrice != null ? `
            <div class="fact">${I.trend}<span><span class="k">${slabbed ? 'RAW PRICE NOW' : 'VALUE NOW'}</span>
              <span class="v ${myDir}">${esc(money(nowPrice))}</span>
              ${myMove != null && myDir ? `<span class="asof">${myDir === 'up' ? '\u25b2' : '\u25bc'} ${esc(money(Math.abs(myMove)))}${pct != null ? ' (' + (myMove > 0 ? '+' : '\u2212') + Math.abs(pct).toFixed(1) + '%)' : ''} since added</span>`
                : `<span class="asof">as of ${esc(day(nowRow.recorded_on))}</span>`}
            </span></div>` : ''}
          <a class="btn-look" href="${esc(lookHref)}">${I.look}LOOK UP NOW</a>
          <!-- ONLY ON YOUR OWN CARD, AND ONLY SIGNED IN. p.mine is already
               both of those: it is set from me && owner && me === owner, so
               a signed-out reader and somebody looking at another
               collector's card both get nothing here rather than a button
               that fails when they press it. -->
          ${p.mine && p.rowId ? `<button type="button" class="btn-edit"
            data-edit-card="${esc(p.rowId)}">${I.pencil}EDIT MY CARD INFO</button>` : ''}
        `}
      </div>
      ${chartBlock(chartRows, chartCur, p.range || 0)}
      <section class="spec">
        <span class="spec-head">${I.card}${esc(copyWho)}</span>
        <div class="spec-grid">
          ${spec.map(([k, v, cls]) => `
            <div class="spec-row ${cls}"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`).join('')}
        </div>
        ${offNM ? `${edOnly ? `
          <p class="spec-note">Prices on this app are for the <b>printing, not the edition</b>. A
          ${esc(p.edition)} copy sells for something different &mdash; sold listings are the
          real picture.</p>` : slabbed && p.ownerValue != null ? `
          <p class="spec-note"><b>${p.mine ? 'Your' : 'The owner\u2019s'} value</b> is what this
          ${esc(condTxt)} counts for in ${p.mine ? 'your' : 'their'} collection total. Sold
          listings are the proof &mdash; check them anytime.</p>` : slabbed && p.mine ? `
          <p class="spec-note">Prices on this app are <b>raw Near Mint</b>, so this
          ${esc(condTxt)} is counting at the raw price. Check the sold listings, then tap
          <b>Edit my card info</b> and set <b>your value</b> &mdash; that is what your total will use.</p>` : `
          <p class="spec-note">Prices on this app are <b>raw Near Mint</b>. A
          ${esc(condTxt)} copy sells for something different &mdash; sold listings are
          the real picture, and they are not counted in a collection total.</p>`}
          <a class="sp-sold" href="${esc(soldQ)}" target="_blank" rel="noopener noreferrer">${I.bars}SEE SOLD LISTINGS</a>` : ''}
      </section>
      ${p.kind === 'card' ? `
      <section class="story" data-story-panel>
        <span class="k">${I.quill}MY HISTORY</span>
        ${p.note
          ? `<p data-story-text>${mentions(p.note)}</p>`
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
      ${note ? `<p>${mentions(note)}</p>`
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

  /* ---- WHO YOU FOLLOW ------------------------------------------------------
     REAL FOLLOWING -- 25 Sep 2026 (SOCIAL-NEXT part 6). This used to be
     "everybody follows everybody" with a short list of exceptions. Mike
     switched it to opt-in, like Instagram: a row with following = true is a
     follow, and no row means you do not follow them. Every member who was
     here on the day of the switch was given a row for every other member
     (supabase/follows_opt_in_step1.sql), so nothing changed for them; new
     people start out following nobody, and the shop is always in Following.

     WHAT FOLLOWING DOES NOW. The feed has two tabs: EVERYONE is the whole
     site, as it always was, and FOLLOWING is only the people you follow,
     plus yourself and the shop. Unfollowing somebody takes them out of
     FOLLOWING, never out of EVERYONE. */
  const followed = new Set();
  let followsLoaded = false;

  async function loadFollows() {
    if (followsLoaded || !sb || !me) { followsLoaded = true; return; }
    followsLoaded = true;
    try {
      const { data, error } = await sb.from('follows')
        .select('followee_id, following').eq('follower_id', me);
      if (error) {
        /* No table yet? Then nobody follows anybody yet, and EVERYONE still
           shows the whole site. Say it once and carry on rather than
           refusing to draw. */
        note('Could not read follows (' + (error.message || error.code || 'unknown') + ').');
        return;
      }
      (data || []).forEach(r => { if (r.following === true) followed.add(r.followee_id); });
    } catch (_) { /* same reasoning */ }
  }

  const following = (id) => !!id && followed.has(id);

  /* EVERYONE or FOLLOWING. Only a signed-in person on the main feed has the
     choice; inside a filter, or signed out, it is always everyone. The pick
     is remembered in this browser, which is a convenience, not a setting. */
  let feedModePick = (() => { try { return localStorage.getItem('ip-feed-mode') || 'everyone'; } catch (_) { return 'everyone'; } })();
  const feedMode = () => (me && !filter && feedModePick === 'following') ? 'following' : 'everyone';
  const inView = (id) => feedMode() !== 'following' || id === me || isStore(id) || followed.has(id);

  function paintFeedTabs() {
    /* The tab's name says where you are: "Infinite Feed" on the feed,
       "@name" on somebody's profile. */
    try {
      document.title = (filter && filter.kind === 'person')
        ? at(filter.label) + ' · Infinite Pulls'
        : 'Infinite Feed · Infinite Pulls';
    } catch (_) {}
    const bar = document.getElementById('feedtabs');
    if (!bar) return;
    bar.hidden = !me || !!filter;
    bar.querySelectorAll('[data-feed-mode]').forEach(b => {
      const on = b.getAttribute('data-feed-mode') === feedMode();
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  async function pickFeedMode(mode) {
    if (mode === feedModePick && mode === feedMode()) return;
    feedModePick = mode;
    try { localStorage.setItem('ip-feed-mode', mode); } catch (_) {}
    roster = null;               /* the roster is built per mode */
    paintFeedTabs();
    resetFeed();
    window.scrollTo(0, 0);
    await startFeed();
  }

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
    if (!sb) return;
    if (!me) { showJoin('Sign up to keep a wish list.'); return; }
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

  /* FRESH FIRST (Jeff, 27 Sep 2026). The rotation is still one person at a
     time, but the SEATS are no longer random: whoever posted in the last day
     sits first, newest first; the last week next (shuffled); everybody else
     after (shuffled, as before). See feed_freshness() in feed_fresh.sql. If
     that is not installed the roster simply stays shuffled. */
  async function freshFirst() {
    if (!roster.length) return;
    try {
      const { data, error } = await sb.rpc('feed_freshness');
      if (error || !data) return;
      const last = new Map(data.map(x => [x.user_id, Date.parse(x.last_at) || 0]));
      const now = Date.now(), DAY = 864e5;
      const today = roster.filter(id => now - (last.get(id) || 0) <= DAY)
                          .sort((a, b) => last.get(b) - last.get(a));
      const week = shuffle(roster.filter(id => { const t = last.get(id) || 0; return now - t > DAY && now - t <= 7 * DAY; }));
      const rest = roster.filter(id => now - (last.get(id) || 0) > 7 * DAY);   /* already shuffled */
      roster.length = 0;
      roster.push(...today, ...week, ...rest);
    } catch (_) { /* stays shuffled */ }
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
        /* In FOLLOWING, only the people you follow (and you, and the shop)
           are dealt in. Decided here, before any card is asked for, so the
           others' rows are never fetched at all. */
        if (inView(p.id)) roster.push(p.id);
      });
      shuffle(roster);
      await freshFirst();
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
    /* ONE TEXT RUN. The chip is a flex row with a gap, so "<b>name</b>'s"
       put the gap between the name and its apostrophe ("Shabby 's"). The
       words sit inside one span now. A person's chip is just their @handle,
       the way Instagram's top bar is -- the profile underneath says the rest. */
    const what = filter.kind === 'shop'
      ? `<b>${esc(SHOP_WHO)}</b> &mdash; at the shop`
      : filter.kind === 'person'
        ? `<b>${esc(at(filter.label))}</b>`
        : filter.kind === 'tag'
          ? (filter.field === 'hash' ? `<b>${esc(filter.label)}</b>` : `Tagged <b>${esc(filter.label)}</b>`)
          : `Everyone with <b>${esc(filter.label)}</b>`;
    void isMe;
    return `<span class="chip"><span class="chip-t">${what}</span>
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

     EVERY PIECE IS OPTIONAL. A profile with no bio and no badges
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
           <img src="/${esc(b.badge_image)}" alt="${esc(name)}" loading="lazy" decoding="async">
           <i>${esc(name)}</i></span>`
      /* No artwork on this template yet -- the emoji is the fallback the
         goals board already uses, rather than a broken image. */
      : `<span class="pbadge is-plain" title="${esc(name)}">
           <b>${esc((b && b.icon) || '★')}</b><i>${esc(name)}</i></span>`;
  }

  /* How many people follow them, and how many they follow. Only numbers come
     back: follow rows are private, so follow_counts() (security definer,
     supabase/follows_opt_in_step2.sql) is the only way anybody else can know. */
  async function followCounts(id) {
    try {
      const { data, error } = await sb.rpc('follow_counts', { uid: id });
      if (error) return null;
      const row = Array.isArray(data) ? data[0] : data;
      return row ? { followers: Number(row.followers) || 0, following: Number(row.following) || 0 } : null;
    } catch (_) { return null; }
  }

  /* The three social buttons. The profile holds only a HANDLE (the database
     refuses anything else), and the address is built here, so a button that
     looks like Instagram can only ever go to Instagram. */
  const SOCIALS = [
    ['instagram', 'Instagram', (h) => 'https://www.instagram.com/' + encodeURIComponent(h) + '/',
      '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".9" fill="currentColor"/>'],
    ['tiktok', 'TikTok', (h) => 'https://www.tiktok.com/@' + encodeURIComponent(h),
      '<path d="M14 3v11a3.5 3.5 0 11-3-3.46"/><path d="M14 3c.5 2.5 2.5 4 5 4"/>'],
    ['whatnot', 'Whatnot', (h) => 'https://www.whatnot.com/user/' + encodeURIComponent(h),
      '<path d="M4 6l3 12 3-9 3 9 3-12"/><circle cx="20" cy="6" r="1.4" fill="currentColor"/>'],
    /* 27 Sep 2026: the collection apps. Plain drawn icons (not their logos)
       with the name under them. Collectr is the share link its app hands
       you; Dex is a username. Tapping opens their app if it is installed
       and the app claims its own links; otherwise their web page. */
    ['collectr', 'Collectr', (v) => v,
      '<rect x="4" y="3" width="12" height="16" rx="2"/><path d="M8 21h10a2 2 0 002-2V7"/><path d="M7 14l2.5-3 2 2 2.5-4"/>'],
    ['dex', 'Dex', (h) => 'https://app.dextcg.com/users/' + encodeURIComponent(h),
      '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M3 8V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v3M21 16v3a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-3"/>']
  ];
  const LABELED = new Set(['collectr', 'dex']);
  const svgLine = (d, n) => `<svg viewBox="0 0 24 24" width="${n || 18}" height="${n || 18}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

  /* ======================================================================
     THE PROFILE, INSTAGRAM-STYLE -- 25 Sep 2026 (SOCIAL-NEXT part 5)

     Mike's layout, from his mockup: the photo in a gold ring with four
     numbers beside it (cards, ∞ rewards, followers, following), the name,
     the bio, the collection's value, the social buttons, then a row of
     FOLLOW (or EDIT PROFILE on your own) · SHARE PROFILE · the real little
     QR code, which opens the big one. Badges sit underneath like Instagram's
     highlights. (The grail card was retired 25 Sep 2026.)

     EVERYTHING OPTIONAL IS SIMPLY ABSENT when it is empty -- a new account
     is a photo, a name and four numbers, and that has to look deliberate.
     ====================================================================== */
  /* STREAKS -- social pack #9. See streaks.sql. A day counts when you post a
     photo, comment, or add a card. Shows from 2 days up. On your own page,
     when today has not counted yet, it tells you what keeps it alive. */
  async function streakFor(id) {
    if (!sb || !id) return null;
    try {
      const { data, error } = await sb.rpc('user_streak', { p_user: id });
      if (error || !data || !data[0]) return null;
      return data[0];
    } catch (_) { return null; }
  }
  function streakChip(st, mine) {
    if (!st) return '';
    const n = Number(st.current_days) || 0, best = Number(st.best_days) || 0;
    if (mine && n >= 2 && !st.today_done) {
      return `<span class="ph-streak is-risk">\u{1F525} ${n}-day streak &middot; post or comment today to keep it</span>`;
    }
    if (n >= 2) {
      return `<span class="ph-streak">\u{1F525} ${n}-day streak${mine && best > n ? ` &middot; best ${best}` : ''}</span>`;
    }
    return '';
  }

  async function fillProfile(id) {
    const box = document.getElementById('profcard');
    if (!box || !sb || !id) return;

    const BASE = 'id, username, avatar_url, bio, tagline, verified_at';
    const MORE = ', display_name, instagram, tiktok, whatnot, collectr, dex, collection_value, show_price';
    let p = null;
    try {
      let r = await sb.from('profiles').select(BASE + MORE).eq('id', id).limit(1);
      /* The new columns arrive with profile_socials.sql. Without them the
         header still draws, just without the new parts. */
      if (r.error && missingColumn(r.error)) r = await sb.from('profiles').select(BASE).eq('id', id).limit(1);
      p = (r.data || [])[0] || null;
    } catch (_) { p = null; }
    if (!p) return;

    const [cards, badges, counts, , streak, invitedN] = await Promise.all([
      profCount('user_cards', id),
      profBadges(id),
      followCounts(id),
      marksFor([id]),
      streakFor(id),
      (me && me === id) ? sb.rpc('invite_count', { p_user: id }).then(r => Number(r.data) || 0, () => 0) : Promise.resolve(0)
    ]);
    const invited = invitedN || 0;
    if (!document.getElementById('profcard')) return;   /* they moved on */

    const mine = !!me && me === id;
    const m = marks[id] || null;
    const num = (n) => (n == null ? '—' : Number(n).toLocaleString());
    const face = faces[id] || { id, name: p.username, badge: !!p.verified_at, tagline: p.tagline };

    /* A number is a door on your own profile where there is somewhere to go. */
    const stat = (value, label, attr) => attr
      ? `<button class="ps" type="button" ${attr}><b>${value}</b><i>${esc(label)}</i></button>`
      : `<span class="ps"><b>${value}</b><i>${esc(label)}</i></span>`;
    const rewardsN = `<span class="inf" aria-hidden="true">∞</span>${esc(num(m ? m.cards : null))}`;

    const socials = SOCIALS
      .filter(([k]) => p[k])
      .map(([k, label, url, icon]) => LABELED.has(k)
        ? `<a class="psoc psoc-app" href="${esc(url(p[k]))}" target="_blank" rel="noopener"
            aria-label="${esc(at(p.username))} on ${label}">${svgLine(icon)}<span>${label}</span></a>`
        : `<a class="psoc" href="${esc(url(p[k]))}" target="_blank" rel="noopener"
            aria-label="${esc(at(p.username))} on ${label}">${svgLine(icon)}</a>`).join('');

    /* "Show my value" (the switch at the foot of My Collection) hides the
       gold total from everybody else. You always see your own. It was on
       the old public page and got missed when this one was built. */
    const value = (mine || p.show_price !== false) && (p.collection_value != null && Number(p.collection_value) > 0)
      ? '$' + Math.round(Number(p.collection_value)).toLocaleString() : '';

    const mainBtn = mine
      ? `<button class="pbtn" type="button" data-edit-profile>EDIT PROFILE</button>`
      : me
        ? `<button class="pbtn follow${following(id) ? ' on' : ''}" type="button" data-follow="${esc(id)}">${following(id) ? 'FOLLOWING' : 'FOLLOW'}</button>`
        : `<button class="pbtn follow" type="button" data-join-why="Sign up to follow collectors.">FOLLOW</button>`;

    box.className = 'prof ph';
    box.setAttribute('data-owner', id);
    box.innerHTML = `
      <div class="ph-top">
        <span class="ph-ring"><img class="ph-face" src="${esc(p.avatar_url || '/assets/hyde-bot.png')}" alt=""
             onerror="this.onerror=null;this.src='/assets/hyde-bot.png'"></span>
        <div class="ph-right">
          <h2 class="ph-name">${esc(p.display_name || at(p.username))}${badgeOf(face)}</h2>
          <div class="ph-stats">
            ${stat(num(cards), 'cards', mine ? 'data-go-collection' : '')}
            ${stat(rewardsN, 'rewards', 'data-ptab-go="rewards"')}
            ${stat(`<span data-followers="${counts ? counts.followers : 0}">${num(counts && counts.followers)}</span>`, 'followers', `data-flist="followers" data-flist-of="${esc(id)}"`)}
            ${stat(num(counts && counts.following), 'following', `data-flist="following" data-flist-of="${esc(id)}"`)}
          </div>
        </div>
      </div>
      ${p.tagline ? `<p class="ph-tag">${esc(p.tagline)}</p>` : ''}
      ${p.bio ? `<div class="prof-bio">
        <p class="pb-text">${esc(p.bio)}</p>
        <button class="pb-more" type="button" data-bio-more hidden>MORE</button>
      </div>` : ''}
      ${(value || streakChip(streak, mine) || invited) ? `<div class="ph-chips">${streakChip(streak, mine)}${invited ? `<span class="ph-inv">\u{1F91D} ${invited} ${invited === 1 ? 'friend' : 'friends'} joined</span>` : ''}${value ? `<span class="ph-val">${esc(value)} collection</span>` : ''}</div>` : ''}
      ${socials ? `<div class="ph-soc">${socials}</div>` : ''}
      <div class="ph-btns">
        ${mainBtn}
        <button class="pbtn${mine ? ' is-invite' : ''}" type="button" data-share-profile>${mine ? 'INVITE FRIENDS' : 'SHARE PROFILE'}</button>
        <button class="pqr" type="button" data-qr aria-label="Show ${esc(at(p.username))}&rsquo;s QR code"><canvas aria-hidden="true"></canvas></button>
      </div>
      ${badges.length ? `<div class="ph-badges">${badges.map(profBadgeHTML).join('')}</div>` : ''}`;
    box.hidden = false;
    if (mine) paintClaimPill(box, p);
    if (mine) paintScoreChip(box);
    paneOwner = id;
    paneMine = mine;
    drawProfTabs();
    lastProfile = p;
    paintOnline();

    /* The little code is the real code. Drawn once the generator is here;
       until then the white square is already in place, so nothing jumps. */
    loadQrLib().then(lib => {
      const cv = box.querySelector('.pqr canvas');
      if (cv) drawQR(lib, QR_HOST + p.username, cv, 96);
    }).catch(() => {});
    box.querySelector('[data-qr]').addEventListener('click', (e) => {
      e.stopPropagation();
      openQR({ name: p.username, avatar: p.avatar_url, mine });
    });
    box.querySelector('[data-share-profile]').addEventListener('click', () => mine ? openInvite() : shareProfile(p.username));
    const go = box.querySelector('[data-go-collection]');
    if (go) go.addEventListener('click', () => { location.href = '/?page=collection'; });
    const edit = box.querySelector('[data-edit-profile]');
    if (edit) edit.addEventListener('click', () => openEditProfile(p));
    if (mine && WANTS_EDIT && !editAsked) { editAsked = true; openEditProfile(p); }
    else if (mine && editWanted) { editWanted = false; openEditProfile(p); }

    /* MORE ONLY IF THERE IS MORE -- by measurement, not by a character count. */
    const t = box.querySelector('.pb-text');
    const more = box.querySelector('.pb-more');
    if (t && more && t.scrollHeight > t.clientHeight + 1) more.hidden = false;
  }

  let lastProfile = null;
  let editAsked = false;

  /* ======================================================================
     CLAIM YOUR BADGE -- 25 Sep 2026 (SOCIAL-NEXT part 9)

     The little mark beside a name -- the Infinite Original 2026 badge --
     is claimed, not handed out. Until it is, your own profile shows a gold
     pill right under your photo: "Your Infinite Original badge -- CLAIM
     NOW". One tap and it is beside your name everywhere on the site. A gold
     dot on your face in the menu says it is waiting, wherever you are.

     (Infinite Rewards cards are NOT claimed -- they arrive on their own
     with the celebration, as they always have. Mike, 25 Sep.)
     ====================================================================== */
  const badgeWaiting = () => !!me && !(faces[me] && faces[me].badge);

  async function refreshClaims() {
    const link = document.querySelector('[data-menu]');
    if (link) link.classList.toggle('has-claim', badgeWaiting());
    const box = document.getElementById('profcard');
    if (box && me && box.getAttribute('data-owner') === me && lastProfile) paintClaimPill(box, lastProfile);
  }

  function paintClaimPill(box, p) {
    const old = box.querySelector('[data-claim-row]');
    if (old) old.remove();
    if (p.verified_at || !badgeWaiting()) return;
    const top = box.querySelector('.ph-top');
    if (top) top.insertAdjacentHTML('afterend', `<div class="claim-row" data-claim-row>
      <button class="claim-pill" type="button" data-claim-badge>
        <img src="/assets/badge-original-2026.webp" alt="" width="22" height="22">
        <span>Your Infinite Original badge</span><b>CLAIM NOW</b></button></div>`);
  }

  async function claimBadgeNow(btn) {
    if (!sb || !me) return;
    if (btn) btn.disabled = true;
    const { error } = await sb.rpc('claim_founder_badge');
    if (error) { if (btn) btn.disabled = false; note(error.message || 'That did not work.'); return; }
    if (faces[me]) faces[me].badge = true;
    const link = document.querySelector('[data-menu]');
    if (link) link.classList.remove('has-claim');
    repaintNames();
    if (document.getElementById('profcard')) fillProfile(me);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-claim-badge]');
    if (b) { e.preventDefault(); claimBadgeNow(b); }
  });

  /* ======================================================================
     THE PROFILE TABS -- 25 Sep 2026 (Mike's list)

       ▦ CARDS     their collection, three to a row, until it runs out
       ∞ REWARDS   all fifty Infinite Rewards cards, theirs lit, the rest dim
       ♡ WISH LIST the cards they are hunting
       ▤ POSTS     their posts, the way the profile always showed them

     CARDS opens first. The ∞ number in the header jumps to REWARDS, on
     anybody's profile. The tab row sticks under the top bar while you
     scroll, so you can always switch; the old "your posts" chip no longer
     does -- it scrolls away with the page.

     The grids read the same tables the feed does (user_cards,
     user_reward_cards, wishlist_cards), which are readable for any public
     profile. Tapping a card opens it the way a shared link does.
     ====================================================================== */
  let profTab = 'cards';
  let paneOwner = null;
  let paneMine = false;
  let paneIO = null;
  const GRID_PAGE = 60;

  /* WORDS, NOT ICONS -- 27 Sep 2026. Mike could not tell what the icons
     meant, and a heart reads as "likes" everywhere else. The icon column
     is kept in case a picture ever comes back next to the word. */
  const PTABS = [
    ['posts',   'Photos',     '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16"/>'],
    ['loops',   'Loops',     null],
    ['cards',   'Cards',     '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'],
    ['wish',    'Wants',     '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>'],
    ['goals',   'Goals',     null],
    ['rewards', 'Rewards',   null]
  ];

  /* YOUR OWN PAGE SAYS "MY" (27 Sep 2026, Mike): My Cards, My ∞ Rewards,
     My Wants, My Photos. Somebody else's page drops the "My". */
  let tabsCrowded = false;     /* five tabs on a phone: drop the "My" */
  function tabLabel(k, label) {
    const words = k === 'rewards'
      ? '<i class="inf-mark" aria-hidden="true">\u221e</i> Rewards'
      : k === 'loops' ? '<i class="inf-mark" aria-hidden="true">\u221e</i> Loops' : esc(label);
    /* ONE LINE, "My Photos" (27 Sep 2026 -- the stacked MY read as
       "my my my my"). The type is a touch smaller so four fit at 360px. */
    /* No "My" on Rewards -- "My \u221e Rewards" was too crammed (27 Sep 2026). */
    return '<span>' + (paneMine && k !== 'rewards' && k !== 'loops' && !tabsCrowded ? 'My ' : '') + words + '</span>';
  }

  /* WHICH TABS, AND WHICH ONE OPENS -- 27 Sep 2026 (Mike: social first).
     Order is Photos, Cards, Wants, Rewards. Somebody else's page only shows
     a tab that has something in it -- a blank grid reads as broken -- and
     opens on the first one that does, so a collector who posts photos is
     met by their photos. Your own page shows all four, so you can fill
     them. Four counts, one round trip, head-only (no rows come back). */
  async function tabCounts(id) {
    /* A COUNT THAT FAILS IS NOT A ZERO (27 Sep 2026). The database answers
       503 for a moment while it reloads after a change (running SQL does
       that), and reading that as 0 hid tabs that had things in them. So:
       ask again once, and if it still cannot say, show the tab anyway. */
    const n = async (ask) => {
      for (let t = 0; t < 2; t++) {
        try {
          const { count, error, status } = await ask();
          if (!error && status < 500) return count || 0;
        } catch (_) {}
        if (t === 0) await new Promise(r => setTimeout(r, 800));
      }
      return 1;
    };
    const head = { count: 'exact', head: true };
    const L = window.InfinitePullsLoops;
    const [photos, cards, wish, rewards, goals, loops] = await Promise.all([
      n(() => sb.from('user_photos').select('id', head).eq('user_id', id)),
      n(() => sb.from('user_cards').select('id', head).eq('user_id', id)),
      n(() => sb.from('wishlist_cards').select('card_id', head).eq('user_id', id)),
      n(() => sb.from('user_reward_cards').select('card_id', head).eq('user_id', id).not('claimed_at', 'is', null)),
      n(() => sb.from('user_collector_goals').select('id', head).eq('user_id', id)),
      (L && L.countFor) ? L.countFor(id, id === me).catch(() => 0) : Promise.resolve(0)
    ]);
    return { posts: photos, cards, wish, rewards, goals, loops };
  }

  async function drawProfTabs() {
    const pane = document.getElementById('ppane');
    if (!pane) return;
    /* The tab row sticks just under the top bar, whatever height that is. */
    const top = document.querySelector('.stickytop');
    if (top) document.documentElement.style.setProperty('--stick', top.offsetHeight + 'px');
    const owner = paneOwner;
    pane.innerHTML = '<div class="pg-wait">Loading&hellip;</div>';
    let counts = { posts: 1, cards: 1, wish: 1, rewards: 1 };
    if (sb && owner) { try { counts = await tabCounts(owner); } catch (_) {} }
    if (paneOwner !== owner) return;          /* they moved on while we asked */
    /* GOALS shows on other people's pages. Yours are one tap away in the
       row up top, and a fifth tab would not fit beside "My ..." on a phone. */
    /* LOOPS only where Loops are switched on for this viewer (loops.js gate) */
    const loopsOn = !!(window.InfinitePullsLoops && window.InfinitePullsLoops.on);
    const shown = PTABS.filter(([k]) => k === 'goals' ? (!paneMine && counts[k] > 0)
      : k === 'loops' ? (loopsOn && (paneMine || counts[k] > 0))
      : (paneMine || counts[k] > 0));
    tabsCrowded = shown.length >= 5;
    const first = (shown.find(([k]) => counts[k] > 0) || shown[0] || [])[0];
    if (!shown.length) {
      pane.innerHTML = '<div class="pg-empty">Nothing posted yet.</div>';
      return;
    }
    profTab = first;
    pane.innerHTML = `
      <nav class="ptabs" role="tablist" aria-label="What to show" style="grid-template-columns:repeat(${shown.length},1fr)">
        ${shown.map(([k, label]) => `<button type="button" role="tab" data-ptab="${k}"
            aria-label="${label}" aria-selected="${k === profTab}" class="${k === profTab ? 'on' : ''}">
            <span class="ptab-l">${tabLabel(k, label)}</span></button>`).join('')}
      </nav>
      <div class="pgrid" id="pgrid"></div>`;
    showProfTab(profTab);
  }

  function showProfTab(tab) {
    profTab = tab;
    document.querySelectorAll('[data-ptab]').forEach(b => {
      const on = b.getAttribute('data-ptab') === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const grid = document.getElementById('pgrid');
    if (paneIO) { paneIO.disconnect(); paneIO = null; }
    /* PHOTOS IS A GRID NOW (Mike, 27 Sep 2026: "like Instagram"). Three
       across, cropped; tap one and the post opens over the profile, back
       closes it and you are where you were. */
    feed.classList.add('is-grid');
    if (!grid || !paneOwner) return;
    /* BRING YOUR COLLECTION IN, above your own cards (Mike, 27 Sep: "stand
       out like a sore thumb so people know it's there"). */
    const oldImp = document.getElementById('pimport');
    if (oldImp) oldImp.remove();
    if (tab === 'cards' && paneMine) {
      grid.insertAdjacentHTML('beforebegin', `<a class="pimport" id="pimport" href="/?page=collection&import=1">
        <span class="pimport-ic" aria-hidden="true">\u21EA</span>
        <span><b>BRING YOUR COLLECTION IN</b><small>From Collectr, TCGplayer, or a spreadsheet</small></span></a>`);
    }
    grid.innerHTML = '<div class="pg-wait">Loading&hellip;</div>';
    if (tab === 'posts') gridPhotos(grid, paneOwner, 0);
    else if (tab === 'cards') gridCards(grid, paneOwner, 0);
    else if (tab === 'wish') gridWish(grid, paneOwner);
    else if (tab === 'rewards') gridRewards(grid, paneOwner);
    else if (tab === 'goals') gridGoals(grid, paneOwner);
    else if (tab === 'loops' && window.InfinitePullsLoops) window.InfinitePullsLoops.profileGrid(grid, paneOwner, paneMine);
  }

  const tileImg = (src, alt) => `<img src="${esc(src || NO_PHOTO)}" alt="${esc(alt || '')}" loading="lazy" decoding="async"
       onerror="this.onerror=null;this.src='${esc(NO_PHOTO)}'">`;

  async function gridPhotos(grid, id, from) {
    let rows = [];
    const cols = () => ['id', 'object_key', 'caption', 'added_at']
      .concat(photoExtraCols.filter(c => c === 'extra_keys')).join(', ');
    try {
      const ask = () => sb.from('user_photos').select(cols())
        .eq('user_id', id).order('added_at', { ascending: false })
        .range(from, from + GRID_PAGE - 1);
      let { data, error } = await ask();
      if (error && missingColumn(error) && photoExtraCols.includes('extra_keys')) {
        photoExtraCols = photoExtraCols.filter(c => c !== 'extra_keys');
        ({ data, error } = await ask());
      }
      if (error) throw error;
      rows = data || [];
    } catch (_) {
      if (!from) grid.innerHTML = '<div class="pg-empty">Could not load the photos. Try again in a moment.</div>';
      return;
    }
    if (profTab !== 'posts' || paneOwner !== id) return;     /* they moved on */
    if (!from) grid.innerHTML = '';
    if (!from && !rows.length) {
      grid.innerHTML = `<div class="pg-empty">${paneMine
        ? 'No photos yet. Tap <b>+</b> to post your first picture.' : 'No photos yet.'}</div>`;
      return;
    }
    /* A guest sees the first GUEST_PEEK, then the wall. */
    const walled = !me && rows.length > GUEST_PEEK;
    if (!me && from) return;
    if (walled) rows = rows.slice(0, GUEST_PEEK);
    grid.insertAdjacentHTML('beforeend', rows.map(r => {
      const more = Array.isArray(r.extra_keys) && r.extra_keys.length > 0;
      return `<a class="pg-tile ph-tile" href="./?post=${encodeURIComponent('p-' + r.id)}" data-open-post="p-${esc(r.id)}" title="${esc(r.caption || '')}">
         ${tileImg(photoUrl(r.object_key), r.caption)}${more ? `<span class="ph-multi" aria-label="More than one picture"></span>` : ''}</a>`;
    }).join(''));
    if (walled) { grid.insertAdjacentHTML('beforeend', guestWallHTML()); return; }
    if (rows.length === GRID_PAGE) {
      const tail = document.createElement('div');
      tail.className = 'pg-tail';
      grid.appendChild(tail);
      paneIO = new IntersectionObserver((ents) => {
        if (!ents.some(x => x.isIntersecting)) return;
        paneIO.disconnect(); paneIO = null; tail.remove();
        gridPhotos(grid, id, from + GRID_PAGE);
      }, { rootMargin: '600px' });
      paneIO.observe(tail);
    }
  }

  async function gridCards(grid, id, from) {
    let rows = [];
    try {
      const { data, error } = await sb.from('user_cards')
        .select('id, card_id, variant, quantity, card_name, set_name, image_url, added_at')
        .eq('user_id', id).order('added_at', { ascending: false })
        .range(from, from + GRID_PAGE - 1);
      if (error) throw error;
      rows = data || [];
    } catch (e) {
      if (!from) grid.innerHTML = '<div class="pg-empty">Could not load the cards. Try again in a moment.</div>';
      return;
    }
    if (profTab !== 'cards' || paneOwner !== id) return;     /* they moved on */
    if (!from) grid.innerHTML = '';
    if (!from && !rows.length) {
      grid.innerHTML = `<div class="pg-empty">${paneMine ? 'No cards yet. Scan your first one and it lands here.' : 'No cards yet.'}</div>`;
      return;
    }
    /* A guest sees the first GUEST_PEEK cards, then the wall. */
    const walled = !me && rows.length > GUEST_PEEK;
    if (!me && from) return;
    if (walled) rows = rows.slice(0, GUEST_PEEK);
    const values = await tileValues(rows);
    if (profTab !== 'cards' || paneOwner !== id) return;
    grid.insertAdjacentHTML('beforeend', rows.map(r => {
      const v = values.get(r.id);
      /* THEIR POST OF THIS CARD, opened right here over the profile, the way
         Instagram opens a post from the grid (Mike, 25 Sep). The href is the
         post's own address, so a long-press or a new tab still works; a tap
         opens it in place. */
      return `<a class="pg-tile" href="./?post=${encodeURIComponent('c-' + r.id)}" data-open-post="${esc(r.id)}" title="${esc(r.card_name || '')}">
         ${tileImg(r.image_url, r.card_name)}${v ? `<b class="pg-val">${esc(v)}</b>` : ''}</a>`;
    }).join(''));
    if (walled) { grid.insertAdjacentHTML('beforeend', guestWallHTML()); return; }
    /* Three to a row until it runs out: the next sixty are asked for as the
       last row comes into view. */
    if (rows.length === GRID_PAGE) {
      const tail = document.createElement('div');
      tail.className = 'pg-tail';
      grid.appendChild(tail);
      paneIO = new IntersectionObserver((ents) => {
        if (!ents.some(x => x.isIntersecting)) return;
        paneIO.disconnect(); paneIO = null; tail.remove();
        gridCards(grid, id, from + GRID_PAGE);
      }, { rootMargin: '600px' });
      paneIO.observe(tail);
    }
  }

  /* THE DOLLAR FIGURE ON EACH TILE. One query for the whole page of cards:
     the last two weeks of TCGplayer readings for every card on it, then the
     newest reading of each card's OWN printing (seriesFor, the same choice
     the card's back makes). No reading, no figure -- a tile never guesses.
     Cardmarket-only cards (Japanese) have no dollar price, so they show none
     rather than a converted one. */
  async function tileValues(rows) {
    const out = new Map();
    const ids = [...new Set(rows.map(r => r.card_id).filter(Boolean))];
    if (!ids.length || !sb) return out;
    let hist = [];
    try {
      const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
      const { data, error } = await sb.from('card_price_history')
        .select('card_id, recorded_on, price, variant, source')
        .in('card_id', ids).eq('source', 'tcgplayer').gte('recorded_on', since)
        .order('recorded_on', { ascending: true }).limit(3000);
      if (error) return out;
      hist = data || [];
    } catch (_) { return out; }
    const byCard = new Map();
    hist.forEach(h => { if (!byCard.has(h.card_id)) byCard.set(h.card_id, []); byCard.get(h.card_id).push(h); });
    rows.forEach(r => {
      const series = seriesFor(byCard.get(r.card_id) || [], 'tcgplayer', r.variant);
      const last = series[series.length - 1];
      const n = last ? Number(last.price) : NaN;
      if (!isFinite(n) || n <= 0) return;
      out.set(r.id, n >= 10 ? '$' + Math.round(n).toLocaleString() : '$' + n.toFixed(2));
    });
    return out;
  }

  /* ---- ONE POST, OPENED OVER THE PROFILE --------------------------------
     The same post the feed draws -- flip, photos, HEAT, comments -- in a
     layer on top of the profile. Every button on a post is wired at the
     document level, so it works the same here. Back closes it and leaves
     you exactly where you were in the grid. */
  function dropPostSheet() {
    const el = document.querySelector('[data-post-sheet]');
    if (el) el.remove();
    document.body.style.overflow = '';
  }

  async function openPostSheet(rowId) {
    if (!rowId || !sb || document.querySelector('[data-post-sheet]')) return;
    const sheet = document.createElement('div');
    sheet.className = 'post-sheet';
    sheet.setAttribute('data-post-sheet', '');
    sheet.setAttribute('role', 'dialog');
    sheet.innerHTML = '<div class="post-sheet-in"><div class="pg-wait">Loading&hellip;</div></div>';
    document.body.appendChild(sheet);
    document.body.style.overflow = 'hidden';
    pushBack('postsheet', dropPostSheet);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) { if (!popBack('postsheet')) dropPostSheet(); } });

    let data = null, error = null;
    /* A PHOTO POST, from the Photos grid: "p-<id>". */
    const isPhoto = /^p-/.test(rowId);
    if (isPhoto) {
      const pid = rowId.slice(2);
      const ask = () => sb.from('user_photos')
        .select(['id', 'user_id', 'object_key', 'caption', 'added_at'].concat(photoExtraCols).join(', '))
        .eq('id', pid).maybeSingle();
      try {
        ({ data, error } = await ask());
        for (let n = 0; error && missingColumn(error) && photoExtraCols.length && n < 3; n++) {
          const gone = missingName(error);
          photoExtraCols = gone ? photoExtraCols.filter(c => c !== gone) : [];
          ({ data, error } = await ask());
        }
      } catch (e) { error = e; }
    } else {
    let asked = (columns || NEW_COLS).slice();
    try {
      for (let tries = asked.length + 1; tries > 0; tries--) {
        ({ data, error } = await sb.from('user_cards').select(colList(asked)).eq('id', rowId).maybeSingle());
        if (!error || !missingColumn(error) || !asked.length) break;
        const gone = missingName(error);
        asked = gone ? asked.filter(c => c !== gone) : [];
      }
    } catch (e) { error = e; }
    }
    const inner = sheet.querySelector('.post-sheet-in');
    if (!inner || !document.body.contains(sheet)) return;      /* closed already */
    if (error || !data) {
      inner.innerHTML = `<div class="pg-empty">That ${isPhoto ? 'post' : 'card'} could not be opened. Try again in a moment.</div>`;
      return;
    }
    await facesFor([data.user_id]);
    const row = isPhoto ? photoRow(data) : cardRow(data);
    if (!isPhoto) await attachPhotos([row]);
    if (!document.body.contains(sheet)) return;
    inner.innerHTML = postHTML(row, 0);
    inner.querySelectorAll('.frame:not([data-wired])').forEach(f => {
      f.setAttribute('data-wired', '1'); wireRail(f); paintStrip(f, false);
    });
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open-post]');
    if (!t) return;
    e.preventDefault();
    openPostSheet(t.getAttribute('data-open-post'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.querySelector('[data-post-sheet]')) { if (!popBack('postsheet')) dropPostSheet(); }
  });

  const cardInfoHref = (cardId, name, rowId) => '/?page=lookup'
    + (name ? '&q=' + encodeURIComponent(name) : '')
    + (cardId ? '&card=' + encodeURIComponent(cardId) : '')
    + (rowId ? '&from=' + encodeURIComponent('c-' + rowId) : '');

  async function gridWish(grid, id) {
    let rows = [];
    try {
      const { data, error } = await sb.from('wishlist_cards')
        .select('id, card_id, card_name, set_name, image_url, added_at')
        .eq('user_id', id).order('added_at', { ascending: false }).limit(300);
      if (error) throw error;
      rows = data || [];
    } catch (_) {
      grid.innerHTML = '<div class="pg-empty">Could not load the wish list. Try again in a moment.</div>';
      return;
    }
    if (profTab !== 'wish' || paneOwner !== id) return;
    grid.innerHTML = rows.length
      ? rows.map(r => `<a class="pg-tile" href="${esc(cardInfoHref(r.card_id, r.card_name, null))}" title="${esc(r.card_name || '')}">
          ${tileImg(r.image_url, r.card_name)}</a>`).join('')
      : `<div class="pg-empty">${paneMine ? 'Nothing on your wish list yet. Tap WISHLIST on any card to add it.' : 'Nothing on the wish list yet.'}</div>`;
  }

  async function gridRewards(grid, id) {
    let all = [], held = new Set();
    const earnedOn = new Map();
    try {
      const [c, h] = await Promise.all([
        sb.from('reward_cards').select('id, card_number, name, secret, task_line, thumb_url, art_url')
          .eq('enabled', true).order('card_number'),
        sb.from('user_reward_cards').select('card_id, earned_at').eq('user_id', id).not('claimed_at', 'is', null)
      ]);
      if (c.error) throw c.error;
      all = c.data || [];
      (h.data || []).forEach(r => { held.add(r.card_id); earnedOn.set(r.card_id, r.earned_at); });
    } catch (_) {
      grid.innerHTML = '<div class="pg-empty">Could not load the rewards. Try again in a moment.</div>';
      return;
    }
    if (profTab !== 'rewards' || paneOwner !== id) return;
    /* ONLY WHAT THEY EARNED, and what they did to earn it (Mike, 25 Sep:
       "if the card's in there, of course I earned it... just the ones I earn
       and what I did to earn it"). Newest first. No grey cards. */
    const got = all.filter(r => held.has(r.id))
      .sort((x, y) => String(earnedOn.get(y.id) || '').localeCompare(String(earnedOn.get(x.id) || '')));
    if (!got.length) {
      grid.innerHTML = `<div class="pg-empty">${paneMine ? 'No Infinite Rewards yet. Tap the \u221e to see how to earn your first.' : 'No Infinite Rewards yet.'}</div>`;
      return;
    }
    grid.innerHTML = `<div class="pg-count"><span class="inf">\u221e</span>${got.length} earned</div>` +
      got.map(r => `<button type="button" class="pg-rw" data-rw-tile="${esc(r.card_number)}" title="${esc(r.name || '')}">
          <span class="pg-tile rw">${tileImg(r.thumb_url || r.art_url, r.name)}<i>${esc(String(r.card_number || ''))}</i></span>
          <span class="pg-did">${esc(r.task_line || r.name || '')}</span></button>`).join('');
    rwTiles = { all, held, earnedOn, mine: paneMine };
  }

  /* TAP A REWARD CARD -> THAT CARD'S OWN INFO PAGE, the one inside the
     Infinite Rewards sheet (art, what it takes, the explainer, the Dex
     number). Opened straight to the card; Back goes to all the cards, Back
     again closes. */
  let rwTiles = null;
  async function openRwInfo(n) {
    if (!n) return;
    showOverlay('rewards', true);
    await fillRewards();
    rwdOpen(n);
  }

  document.addEventListener('click', (e) => {
    const rt = e.target.closest('[data-rw-tile]');
    if (rt) { e.preventDefault(); openRwInfo(+rt.getAttribute('data-rw-tile')); return; }
    const t = e.target.closest('[data-ptab]');
    if (t) { e.preventDefault(); showProfTab(t.getAttribute('data-ptab')); return; }
    const go = e.target.closest('[data-ptab-go]');
    if (go) {
      e.preventDefault();
      showProfTab(go.getAttribute('data-ptab-go'));
      const nav = document.querySelector('.ptabs');
      if (nav) nav.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  /* ?edit=1 -- My Account's "Edit my profile" link lands here and opens the
     sheet, then takes itself back out of the address. */
  let editWanted = false;     /* EDIT PROFILE in the menu, on its way to your profile */
  const WANTS_EDIT = (() => {
    try {
      const u = new URL(location.href);
      if (u.searchParams.get('edit') !== '1') return false;
      u.searchParams.delete('edit');
      history.replaceState(history.state, '', u.pathname + (u.search ? u.search : '') + u.hash);
      return true;
    } catch (_) { return false; }
  })();

  async function claimInvite() {
    if (!me || !sb || !inviteRef) return;
    try {
      const { data, error } = await sb.rpc('claim_invite', { p_username: inviteRef });
      if (error) return;                               /* not installed yet: try next visit */
      localStorage.removeItem(REF_KEY);
      if (data === 'ok') { try { await loadFollows(); } catch (_) {} }
    } catch (_) {}
  }

  async function inviteFriends(name) {
    const url = QR_HOST + name;
    const text = 'Come follow me on Infinite Pulls \u2014 post your pulls, show off your collection, and see what everyone else is pulling.';
    try {
      if (navigator.share) { await navigator.share({ title: 'Join me on Infinite Pulls', text, url }); return; }
    } catch (err) { if (err && err.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text + ' ' + url); popSay('Invite link copied.'); } catch (_) { note(url); }
  }

  async function shareProfile(name) {
    const url = QR_HOST + name;
    try {
      if (navigator.share) { await navigator.share({ title: at(name) + ' on Infinite Pulls', url }); return; }
    } catch (err) { if (err && err.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); note('Link copied'); } catch (_) { note(url); }
  }

  /* ======================================================================
     EDIT PROFILE -- 25 Sep 2026

     Everything people SEE is edited here, on your own profile, the
     Instagram way: photo, name, bio, and the three social handles. My
     Account keeps only what they don't see (email, password, privacy,
     alerts, sign out). The badge and tagline are in here too (Mike, 25 Sep:
     "why are they a separate page?") -- claim the badge right here, and once
     it is yours the tagline is just another field.

     A layer on the back stack like everything else that covers the screen:
     the phone's back button closes it, and so does a tap off the panel.
     ====================================================================== */
  const HANDLE_RULES = { instagram: /^[A-Za-z0-9._]{1,30}$/, tiktok: /^[A-Za-z0-9._]{2,24}$/, whatnot: /^[A-Za-z0-9._-]{1,30}$/, dex: /^[A-Za-z0-9._-]{2,30}$/ };
  /* A Collectr share link, only on Collectr's own addresses (same rule as
     collectr_dex_links.sql). A bare word is not a link, so it is refused. */
  const COLLECTR_OK = /^https:\/\/(([a-z0-9-]+\.)*getcollectr\.com|[a-z0-9-]*collectr[a-z0-9-]*\.(app\.link|page\.link))\/[^\s<>"']{1,200}$/i;
  function cleanCollectr(v) {
    let u = String(v || '').trim();
    if (!u) return null;
    const m = u.match(/https?:\/\/\S+/i);          /* they may paste "Check out my Collectr! https://..." */
    if (m) u = m[0];
    return u.replace(/^http:\/\//i, 'https://');
  }
  /* "@name", "name" or a pasted profile address all come down to "name". */
  function cleanHandle(v) {
    let h = String(v || '').trim();
    if (!h) return null;
    h = h.replace(/^https?:\/\//i, '').replace(/^(www\.)?[a-z0-9.-]+\.(com|net|co)\//i, '');
    h = h.replace(/^user\//i, '');
    h = h.split(/[/?#]/)[0].replace(/^@/, '');
    return h || null;
  }

  /* ======================================================================
     PHONE NUMBERS (25 Sep 2026). Mike: "let's start grabbing phone numbers."
     Nothing texts anybody yet -- this collects the number and, separately,
     a clear yes to texts, in the same words phone_numbers.sql records.
     Private: its own table, readable by you and shop staff only.
     ====================================================================== */
  const TEXTS_CONSENT = 'Text me when Infinite Pulls drops new cards or goes live. A few texts a month. Msg &amp; data rates may apply. Reply STOP to stop.';
  const PHONE_ASKED = 'ip-phone-asked';
  function usPhone(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    return (d.length === 10 && /[2-9]/.test(d[0])) ? d : null;
  }
  function prettyPhone(v) {
    const d = String(v || '').replace(/\D/g, '').slice(-10);
    return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : '';
  }
  /* null = could not ask (no table yet, signed out); {} = no number on file. */
  async function loadMyPhone() {
    if (!sb || !me) return null;
    try {
      const { data, error } = await sb.from('contact_phones').select('phone, texts_ok').eq('user_id', me).maybeSingle();
      if (error) return null;
      return data || {};
    } catch (_) { return null; }
  }

  /* ASKED ONCE, NOT ON THE FIRST VISIT. The welcome panel owns a brand-new
     person's first look; a second thing asking for something on top of it
     is how both get dismissed unread. From the second visit on, one small
     sheet, once per phone. "Not now" and the phone's Back both end it. */
  async function askPhone() {
    if (!me) return;
    let visits = 0;
    try {
      if (localStorage.getItem(PHONE_ASKED)) return;
      visits = Number(localStorage.getItem('ip-visits') || 0) + 1;
      localStorage.setItem('ip-visits', String(visits));
    } catch (_) { return; }
    if (visits < 2) return;
    const had = await loadMyPhone();
    if (had === null) return;                                    // table not there yet
    if (had.phone) { try { localStorage.setItem(PHONE_ASKED, '1'); } catch (_) {} return; }
    /* Never on top of something else the person is already looking at. */
    if (document.querySelector('[data-edit-sheet], .hey.is-in, .post-sheet') || overlay) return;

    const sheet = document.createElement('div');
    sheet.className = 'ep-sheet';
    sheet.setAttribute('data-edit-sheet', '');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Get a text when new cards drop');
    sheet.innerHTML = `
      <form class="ep-panel ep-ask" novalidate>
        <h3>Get a text when new cards drop</h3>
        <p class="ep-note" style="margin:0;text-align:center">Jeff puts new cards out all week. Be first to know &mdash; and when we go live.</p>
        <label><span>Your phone <small>private &mdash; only the shop sees it</small></span><input name="phone" type="tel"
               inputmode="tel" autocomplete="tel" maxlength="20" placeholder="(330) 555-1234"></label>
        <p class="ep-note">${TEXTS_CONSENT}</p>
        <p class="ep-status" role="status" data-ep-status></p>
        <button class="ep-save" type="submit">YES, TEXT ME</button>
        <button class="ep-later" type="button" data-ask-later>NOT NOW</button>
      </form>`;
    document.body.appendChild(sheet);
    document.body.style.overflow = 'hidden';
    try { localStorage.setItem(PHONE_ASKED, '1'); } catch (_) {}   // asked, whatever they answer
    pushBack('editprofile', dropEditProfile);
    const close = () => { if (!popBack('editprofile')) dropEditProfile(); };
    sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-ask-later]')) close(); });
    const form = sheet.querySelector('form');
    const say = (t) => { sheet.querySelector('[data-ep-status]').textContent = t; };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const typed = form.elements.phone.value.trim();
      if (!usPhone(typed)) { say('Ten digits, please — like (330) 555-1234.'); return; }
      const btn = form.querySelector('.ep-save');
      btn.disabled = true; say('Saving…');
      const { error } = await sb.rpc('save_my_phone', { p_phone: typed, p_texts_ok: true });
      if (error) { btn.disabled = false; say('Could not save: ' + (error.message || 'try again')); return; }
      say('Got it. You’re on the list.');
      setTimeout(close, 900);
    });
  }

  function dropEditProfile() {
    const el = document.querySelector('[data-edit-sheet]');
    if (el) el.remove();
    document.body.style.overflow = '';
  }

  function openEditProfile(p) {
    if (!p || !me || document.querySelector('[data-edit-sheet]')) return;
    const sheet = document.createElement('div');
    sheet.className = 'ep-sheet';
    sheet.setAttribute('data-edit-sheet', '');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Edit profile');
    const h = (k) => (p[k] ? '@' + p[k] : '');
    const hasBadge = !!p.verified_at || !!(faces[me] && faces[me].badge);
    /* Once the badge is yours the tagline is a field like any other. Before
       that, the badge is claimed right here -- same words as the old sheet,
       because what the badge does NOT mean is the important part. */
    const taglineField = () => `
        <label><span>Tagline <small>under your name on every post</small></span><input name="tagline" maxlength="60"
               autocomplete="off" placeholder="Base Set or nothing" value="${esc(p.tagline || '')}"></label>
        <p class="ep-note">Sixty characters. No links, numbers to call, or claiming to work at the shop.</p>`;
    const claimBlock = `
        <div class="ep-badge" data-ep-badge>
          <img src="/assets/badge-original-2026.webp" alt="" width="44" height="44">
          <div><b>Infinite Original 2026</b>
            <small>Every account made before 2027 gets this badge and a tagline under its name.
              It says you were early &mdash; it is not a check on who you are.</small></div>
          <button type="button" data-ep-claim>CLAIM</button>
        </div>`;
    sheet.innerHTML = `
      <form class="ep-panel" novalidate>
        <h3>Edit profile</h3>
        <div class="ep-photo">
          <img src="${esc(p.avatar_url || '/assets/hyde-bot.png')}" alt="" data-ep-face
               onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">
          <label class="ep-change">CHANGE PHOTO<input type="file" accept="image/*" hidden data-ep-file></label>
        </div>
        <label><span>Name <small>optional</small></span><input name="display_name" maxlength="40" autocomplete="name"
               placeholder="Mike N." value="${esc(p.display_name || '')}"></label>
        <label>Bio<textarea name="bio" maxlength="160" rows="3"
               placeholder="Collecting since 2019 — Charizard hunter.">${esc(p.bio || '')}</textarea></label>
        <label>Instagram<input name="instagram" maxlength="60" autocapitalize="none" autocorrect="off" spellcheck="false"
               placeholder="@yourname" value="${esc(h('instagram'))}"></label>
        <label>TikTok<input name="tiktok" maxlength="60" autocapitalize="none" autocorrect="off" spellcheck="false"
               placeholder="@yourname" value="${esc(h('tiktok'))}"></label>
        <label>Whatnot<input name="whatnot" maxlength="60" autocapitalize="none" autocorrect="off" spellcheck="false"
               placeholder="@yourname" value="${esc(h('whatnot'))}"></label>
        <label><span>Collectr <span class="ep-info" role="button" tabindex="0" data-ep-info="collectr" aria-label="How to get your Collectr link">i</span></span><input name="collectr" maxlength="240" autocapitalize="none" autocorrect="off" spellcheck="false"
               inputmode="url" placeholder="Paste your Collectr share link" value="${esc(p.collectr || '')}"></label>
        <div class="ep-help" data-ep-help="collectr" hidden>
          <b>Getting your Collectr link</b>
          <ol><li>Open the <b>Collectr</b> app</li>
              <li>Go to <b>Settings</b></li>
              <li>Turn on <b>Portfolio Sharing</b></li>
              <li>Tap to <b>copy</b> your link, then paste it here</li></ol>
          <small>Only people with your link can see your Collectr collection. Turning sharing off in Collectr stops the link working.</small>
        </div>
        <label><span>Dex <span class="ep-info" role="button" tabindex="0" data-ep-info="dex" aria-label="How to find your Dex name">i</span></span><input name="dex" maxlength="60" autocapitalize="none" autocorrect="off" spellcheck="false"
               placeholder="@yourname" value="${esc(h('dex'))}"></label>
        <div class="ep-help" data-ep-help="dex" hidden>
          <b>Finding your Dex name</b>
          <ol><li>Open the <b>Dex</b> app</li>
              <li>Tap your <b>profile</b> &mdash; your name is the one with the @</li>
              <li>Type it here (with or without the @)</li></ol>
        </div>
        <label><span>Phone <small>private &mdash; only the shop sees it</small></span><input name="phone" type="tel"
               inputmode="tel" autocomplete="tel" maxlength="20" placeholder="(330) 555-1234" data-ep-phone></label>
        <label class="ep-check"><input type="checkbox" name="texts_ok" data-ep-texts><span>${TEXTS_CONSENT}</span></label>
        <div data-ep-tagslot>${hasBadge ? taglineField() : claimBlock}</div>
        <p class="ep-status" role="status" data-ep-status></p>
        <button class="ep-save" type="submit">SAVE</button>
      </form>`;
    document.body.appendChild(sheet);
    document.body.style.overflow = 'hidden';
    pushBack('editprofile', dropEditProfile);
    /* The number is private, so it is not on p (the public profile). Asked
       for separately; a database without the table just leaves it blank. */
    let phoneWas = { phone: '', ok: false };
    loadMyPhone().then(r => {
      if (!r || !sheet.isConnected) return;
      phoneWas = { phone: r.phone || '', ok: !!r.texts_ok };
      const f = sheet.querySelector('[data-ep-phone]'), c = sheet.querySelector('[data-ep-texts]');
      if (f && !f.value) f.value = prettyPhone(r.phone);
      if (c) c.checked = !!r.texts_ok;
    });
    const close = () => { if (!popBack('editprofile')) dropEditProfile(); };
    sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });

    let photo = null;
    const faceImg = sheet.querySelector('[data-ep-face]');
    sheet.querySelector('[data-ep-file]').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      photo = f;
      try { faceImg.src = URL.createObjectURL(f); } catch (_) {}
    });

    const form = sheet.querySelector('form');
    const say = (t) => { sheet.querySelector('[data-ep-status]').textContent = t; };

    const claim = sheet.querySelector('[data-ep-claim]');
    if (claim) claim.addEventListener('click', async () => {
      claim.disabled = true;
      const { error } = await sb.rpc('claim_founder_badge');
      if (error) { claim.disabled = false; say(error.message || 'That did not work.'); return; }
      p.verified_at = p.verified_at || new Date().toISOString();
      if (faces[me]) faces[me].badge = true;
      repaintNames();
      sheet.querySelector('[data-ep-tagslot]').innerHTML = taglineField();
      say('The badge is yours. Add a tagline if you like.');
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const el = form.elements;
      const socials = { instagram: cleanHandle(el.instagram.value), tiktok: cleanHandle(el.tiktok.value), whatnot: cleanHandle(el.whatnot.value),
                        dex: el.dex ? cleanHandle(String(el.dex.value || '').replace(/^.*\/users\//i, '')) : null };
      const bad = Object.keys(socials).find(k => socials[k] && !HANDLE_RULES[k].test(socials[k]));
      if (bad) {
        say('That ' + ({ instagram: 'Instagram', tiktok: 'TikTok', whatnot: 'Whatnot', dex: 'Dex' })[bad] +
            ' name has something in it a handle can’t — just the name after the @, please.');
        return;
      }
      if (el.collectr) {
        const c = cleanCollectr(el.collectr.value);
        if (c && !COLLECTR_OK.test(c)) { say('That doesn’t look like a Collectr share link. In Collectr, turn on portfolio sharing, copy the link, and paste it here.'); return; }
        socials.collectr = c;
      }
      const phoneTyped = (el.phone && el.phone.value.trim()) || '';
      if (phoneTyped && !usPhone(phoneTyped)) { say('That phone number doesn’t look right. Ten digits, or leave it blank.'); return; }
      const btn = form.querySelector('.ep-save');
      btn.disabled = true; say('Saving…');
      const patch = {
        display_name: el.display_name.value.trim().slice(0, 40) || null,
        bio: el.bio.value.trim().slice(0, 160) || null,
        ...socials
      };
      try {
        if (photo) {
          /* Same place and same name the account page always used, so there
             is one photo per person, not a pile of them. */
          const ext = ((photo.name || '').split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
          const path = me + '/avatar.' + ext;
          const up = await sb.storage.from('avatars').upload(path, photo, { upsert: true });
          if (up.error) throw up.error;
          const { data: { publicUrl } } = sb.storage.from('avatars').getPublicUrl(path);
          patch.avatar_url = publicUrl + '?t=' + Date.now();
        }
        const { error } = await sb.from('profiles').update(patch).eq('id', me);
        if (error) throw error;
        /* The phone goes through save_my_phone(), which cleans the number and
           records the yes to texts. Only when something actually changed. */
        const wantOk = !!(el.texts_ok && el.texts_ok.checked);
        const typedDigits = usPhone(phoneTyped) || '';
        const wasDigits = usPhone(phoneWas.phone) || '';
        if (typedDigits !== wasDigits || wantOk !== phoneWas.ok) {
          const r = await sb.rpc('save_my_phone', { p_phone: phoneTyped || null, p_texts_ok: wantOk });
          if (r.error) throw r.error;
          try { localStorage.setItem(PHONE_ASKED, '1'); } catch (_) {}
        }
        /* The tagline goes through set_tagline(), which applies the same
           rules as comments -- not a plain column write. */
        const tl = el.tagline;
        if (tl && tl.value.trim() !== (p.tagline || '')) {
          const r = await sb.rpc('set_tagline', { new_tagline: tl.value.trim() });
          if (r.error) throw r.error;
          if (faces[me]) faces[me].tagline = (r.data && r.data.tagline) || '';
          repaintNames();
        }
      } catch (err) {
        btn.disabled = false;
        say('Could not save: ' + ((err && err.message) || 'try again'));
        return;
      }
      if (faces[me]) {
        if (patch.avatar_url) faces[me].avatar = patch.avatar_url;
      }
      paintNavMe();
      close();
      fillProfile(me);
    });
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

  /* WHERE THEY WERE WHEN THEY TAPPED THE NAME.
     Narrowing rebuilds the list and scrolls to the top -- so coming back out
     of somebody's feed landed you at the top of the unsorted one with no
     idea where you had been. The offset is remembered on the way IN and put
     back on the way OUT, after the feed has been rebuilt. */
  let widenTo = 0;

  async function narrowTo(next) {
    if (!filter) widenTo = window.scrollY || 0;   /* only the first narrow */
    window.scrollTo(0, 0);
    await setFilter(next);
    const where = personPath(next);
    if (next && !filterPushed) {
      filterPushed = true;
      pushBack('filter', async () => {
        filterPushed = false;
        const back = widenTo; widenTo = 0;
        await setFilter(null);
        /* After the rebuild, not before -- the list has no height until the
           first screenful is in. rAF twice: once for the DOM, once for the
           layout it causes. */
        requestAnimationFrame(() => requestAnimationFrame(() => {
          try { window.scrollTo(0, back); } catch (_) {}
        }));
      }, where || location.href);
    } else if (where) {
      history.replaceState({ ipBack: 'filter' }, '', where);
    }
  }

  /* The way out, wherever it was asked for. */
  function widen() {
    if (popBack('filter')) return;                  /* the listener clears it */
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
    if (goalsOpen) closeGoals(true);
    setTimeout(() => { try { paintRail(); } catch (_) {} }, 0);
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
      /* The slab's number. May be undefined on a database that has not had
         cert_number.sql run yet -- the back simply leaves the row out. */
      cert: r.cert_number || '',
      /* 1st Edition / Shadowless / Unlimited, when the owner picked one. */
      edition: r.edition || '',
      rarity: r.rarity || '',
      /* YOUR VALUE on a slab; null when not set or the column is missing. */
      ownerValue: r.owner_value == null ? null : Number(r.owner_value),
      numShown: localNum(r.card_id),
      /* THE CATALOGUE ART, kept apart from `pics`. pics is what the FRONT
         shows, and it becomes somebody's own photograph the moment they
         upload one -- so on a card with a photo it is no longer a picture of
         the card. The back wants the card itself, every time. */
      art: r.image_url || '',
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
            <input type="text" name="body" maxlength="600" autocomplete="off" data-mention
                   placeholder="Write a comment&hellip; @ to tag someone" aria-label="Write a comment">
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
      /* up to 10 pictures: the first, then extra_keys (multi_photo.sql) */
      pics: [u, ...((r.extra_keys || []).map(photoUrl))].filter(Boolean).map(x => pic(x, r.id, 'post')),
      intro: !!r.is_intro,
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
  const NEW_COLS = ['photo_key', 'hidden_feed', 'cert_number', 'owner_value', 'edition', 'rarity'];
  let columns = null;
  const colList = (extra) =>
    'id, user_id, card_id, card_name, set_name, image_url, variant, condition, quantity, added_at, note'
    + (extra.length ? ', ' + extra.join(', ') : '');
  const missingColumn = (e) =>
    !!e && (e.code === '42703' || /column .* does not exist|could not find the .* column/i.test(e.message || ''));

  /* WHICH column, not just THAT one is missing. Dropping the whole list on
     the first complaint meant a database missing ONE of the three new
     columns also lost the other two -- so a shop that had run the photo
     migration but not cert_number.sql would have stopped showing photos in
     the feed the moment this file shipped. Postgres names the column in the
     message; take it and drop only that one. */
  const missingName = (e) => {
    const msg = (e && e.message) || '';
    const m = /column\s+(?:[\w.]*\.)?"?([a-z0-9_]+)"?\s+does not exist/i.exec(msg)
           || /could not find the '?"?([a-z0-9_]+)"?'? column/i.exec(msg);
    return m ? m[1] : '';
  };

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
    let asked = columns.slice();
    let { data, error } = await askFor(id, asked);
    /* One name at a time, worst case once per new column. */
    let guard = asked.length + 1;
    while (error && missingColumn(error) && asked.length && guard-- > 0) {
      const gone = missingName(error);
      note(gone
        ? 'This database has no ' + gone + ' column \u2014 run the migration that adds it.'
        : 'This database is missing a column the feed asks for \u2014 run card_photos.sql, hide_from_feed.sql and cert_number.sql.');
      asked = gone ? asked.filter(c => c !== gone) : [];
      /* Remember it for the other five accounts in this slice, and keep
         whatever another one of them has already ruled out. */
      columns = columns.filter(c => asked.indexOf(c) !== -1);
      ({ data, error } = await askFor(id, asked));
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
  let photoExtraCols = ['extra_keys', 'is_intro'];

  async function fetchPhotosForAccount(id) {
    if (photoPostsOff || photoSpent.has(id)) return [];
    if (firstPhotoAsk) {
      try { await firstPhotoAsk; } catch (_) {}
      if (photoPostsOff) return [];
    }
    let data = null, error = null;
    /* A MISSING COLUMN DROPS ONLY ITSELF (27 Sep 2026). is_intro was asked
       for before say_hi.sql had run, the whole query failed, and every
       photo post on the site vanished -- every profile said "you're all
       caught up". Now a column the database does not have is left off and
       remembered, and the pictures still come. */
    const ask = () => {
      let q = sb.from('user_photos')
        .select(['id', 'user_id', 'object_key', 'caption', 'added_at'].concat(photoExtraCols).join(', '))
        .eq('user_id', id)
        .order('added_at', { ascending: false })
        .limit(PHOTOS_PER_ACCOUNT);
      if (photoCursors.has(id)) q = q.lt('added_at', photoCursors.get(id));
      return Promise.resolve(q);
    };
    try {
      const run = ask();
      if (!firstPhotoAsk) firstPhotoAsk = run;
      ({ data, error } = await run);
      for (let n = 0; error && missingColumn(error) && photoExtraCols.length && n < 3; n++) {
        const gone = missingName(error);
        photoExtraCols = gone ? photoExtraCols.filter(c => c !== gone) : [];
        note('This database has no user_photos.' + (gone || 'column') + ' \u2014 run the migration that adds it.');
        ({ data, error } = await ask());
      }
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
        .eq('user_id', id).not('claimed_at', 'is', null)
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
    const who = (at(p.who) || 'A collector').toUpperCase();
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
    const text = (at(p.who) || 'A collector') + ' earned ' + (lead.name || 'a reward card') +
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
          <img class="avatar" src="${esc(p.avatar || '/assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">
        </button>
        <button class="who who-btn" type="button" data-open-person="${esc(p.userId)}"
                data-open-label="${esc(p.who || 'A collector')}">
          <span class="nameline"><b>${esc(at(p.who) || 'A collector')}</b>${badgeOf(faces[p.userId])}</span>
          ${subLine(p, agoShort(p.when) || 'Earned a reward card')}
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

      <p class="caption reward-cap"><b>${esc(at(p.who) || 'A collector')}</b>${badgeOf(faces[p.userId])}
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
  /* ONE NAME, EVERYWHERE IT APPEARS (27 Sep 2026). A Pokemon tag or a
     #tag is one page: every card with that name AND every photo whose
     caption carries the #tag. Two sources, each with its own place kept on
     the filter itself, so a new narrow always starts clean. The feed is only
     finished when both are. */
  async function nameCards(name) {
    const f = filter;
    if (!columns) columns = NEW_COLS.slice();
    const run = (extra) => {
      let q = sb.from('user_cards')
        .select(colList(extra))
        .in('user_id', roster)          /* same reason as the search: public shelves only */
        .ilike('card_name', '%' + name + '%')
        .order('added_at', { ascending: false })
        .limit(PAGE * 3);
      if (f._cc) q = q.lt('added_at', f._cc);
      return q;
    };
    const asked = columns.slice();
    let { data, error } = await run(asked);
    if (error && missingColumn(error) && asked.length) {
      columns = []; ({ data, error } = await run([]));
    }
    if (filter !== f) return;
    if (error) { note('Could not search collections: ' + (error.message || 'unknown')); f._cd = true; return; }
    const rows = data || [];
    if (rows.length) f._cc = rows[rows.length - 1].added_at;
    if (rows.length < PAGE * 3) f._cd = true;
    await facesFor([...new Set(rows.map(r => r.user_id))]);
    rows.filter(r => inView(r.user_id)).forEach(r => enqueue(cardRow(r)));
  }

  async function hashPhotos(word) {
    const f = filter;
    word = String(word || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!word || photoPostsOff) { f._pd = true; return; }
    let q = sb.from('user_photos')
      .select(['id', 'user_id', 'object_key', 'caption', 'added_at'].concat(photoExtraCols).join(', '))
      .in('user_id', roster)
      .ilike('caption', '%#' + word + '%')
      .order('added_at', { ascending: false })
      .limit(PAGE * 3);
    if (f._pc) q = q.lt('added_at', f._pc);
    const { data, error } = await q;
    if (filter !== f) return;
    if (error) { note('Could not read that tag: ' + (error.message || 'unknown')); f._pd = true; return; }
    const rows = data || [];
    if (rows.length) f._pc = rows[rows.length - 1].added_at;
    if (rows.length < PAGE * 3) f._pd = true;
    const whole = new RegExp('#' + word + '(?![A-Za-z0-9_])', 'i');
    await facesFor([...new Set(rows.map(r => r.user_id))]);
    rows.filter(r => whole.test(r.caption || '') && inView(r.user_id)).forEach(r => enqueue(photoRow(r)));
  }

  async function fetchOneCard() {
    await loadRoster();
    if (!roster.length) { drained = true; return; }
    const word = /^[A-Za-z][A-Za-z0-9_]{1,30}$/.test(filter.name || '') ? filter.name : '';
    if (!word) filter._pd = true;
    if (!filter._cd) await nameCards(filter.name);
    if (filter && !filter._pd) await hashPhotos(word);
    if (filter && filter._cd && filter._pd) drained = true;
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
    if (filter && filter.kind === 'tag') return fetchTag();
    await loadRoster();
    if (!view().length) { drained = true; return; }
    const slice = nextSlice(SLICE);
    if (!slice.length) { drained = true; if (!queued()) note('Nobody on the roster has any cards yet.'); return; }
    await Promise.all(slice.map(fetchForAccount));
    if (spent.size >= roster.length) drained = true;
  }

  async function fetchShop() {
    /* Somebody looking at one person's cards did not ask what is for sale. */
    if (filter && (filter.kind === 'person' || filter.kind === 'tag')) { shopDrained = true; return; }
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

  /* THE SOFT WALL (Mike, 27 Sep 2026). A guest on somebody's profile sees
     their first GUEST_PEEK posts (or cards), then one card: "Follow @x to
     see the rest". Joining from it follows that person on the way in, so
     their feed is not empty on day one. Signed-in members never see it. */
  const GUEST_PEEK = 9;
  const FOLLOW_AFTER_JOIN = 'ip-follow-after-join';
  const guestOnProfile = () => !me && !!(filter && filter.kind === 'person');

  /* NEVER LEAD WITH "SIGN UP" (Mike, 27 Sep 2026: "I don't want to confuse
     the people who have the app"). Like Instagram, Reddit and Pinterest: the
     headline is about seeing more, the first buttons are Open in the app /
     Log in, and "New here? Join free" comes last and small.

     INSIDE FACEBOOK OR INSTAGRAM a link opens in their built-in browser,
     which does not know anybody is logged in here -- so a member looks like
     a guest. There the first button gets them OUT: on Android straight into
     Chrome (which opens the installed app if they have it); on iPhone, where
     a page is not allowed to jump out, it shows where to tap. */
  const UA = navigator.userAgent || '';
  const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|FBIOS|Instagram/i.test(UA);
  const IS_ANDROID = /Android/i.test(UA);

  function guestWallHTML() {
    const who = (faces[filter.id] && faces[filter.id].name) || filter.label || 'them';
    const face = faces[filter.id] && faces[filter.id].avatar;
    return `<section class="guest-wall" id="guest-wall">
        ${face ? `<img class="gw-face" src="${esc(face)}" alt="">` : ''}
        <h3 class="gw-h">See the rest of @${esc(who)}&rsquo;s posts</h3>
        <p class="gw-p">Pulls, trades, grails and the collectors @${esc(who)} hangs out with.</p>
        ${IN_APP_BROWSER ? `
        <button type="button" class="gw-go" data-gw-open>OPEN IN THE APP</button>
        <p class="gw-hint" data-gw-hint hidden>Tap <b>&bull;&bull;&bull;</b> at the top of the screen, then
          <b>Open in browser</b>. If Infinite Pulls is on your home screen, you can open it from there too.</p>
        <button type="button" class="gw-alt" data-gw-login>LOG IN</button>` : `
        <button type="button" class="gw-go" data-gw-login>LOG IN</button>`}
        <p class="gw-sub">New here? <a href="/?page=account&amp;new=1" data-gw-join>Join free</a></p>
      </section>`;
  }

  const rememberFollow = () => {
    try {
      if (filter && filter.kind === 'person') {
        localStorage.setItem(FOLLOW_AFTER_JOIN, JSON.stringify({ id: filter.id, at: Date.now() }));
      }
    } catch (_) {}
  };

  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-gw-open]');
    if (open) {
      e.preventDefault();
      if (IS_ANDROID) {
        /* Out of Facebook/Instagram into Chrome, same address. */
        location.href = 'intent://' + location.host + location.pathname + location.search
          + '#Intent;scheme=https;package=com.android.chrome;end';
      } else {
        const hint = open.parentNode.querySelector('[data-gw-hint]');
        if (hint) hint.hidden = false;
      }
      return;
    }
    const login = e.target.closest('[data-gw-login]');
    if (login) { e.preventDefault(); rememberFollow(); joinGo('signin'); return; }
    const go = e.target.closest('[data-gw-join]');
    if (!go) return;
    e.preventDefault();
    rememberFollow();
    joinGo('signup');
  });

  /* Back from signing up or in: follow whoever the wall was for. Kept for a
     day, so a sign-up that takes a detour (email check, invite screen)
     still lands the follow the next time the feed opens. */
  async function followAfterJoin() {
    if (!me) return;
    let want = null;
    try { want = JSON.parse(localStorage.getItem(FOLLOW_AFTER_JOIN) || 'null'); } catch (_) {}
    if (!want || !want.id) return;
    try { localStorage.removeItem(FOLLOW_AFTER_JOIN); } catch (_) {}
    if (want.id === me || Date.now() - (want.at || 0) > 864e5) return;
    if (await writeFollow(want.id, true)) {
      followed.add(want.id);
      const n = (faces[want.id] && faces[want.id].name) || '';
      popSay(n ? `You're following @${n} \u{1F44B}` : "You're following them \u{1F44B}");
    }
  }

  /* ONLINE DOTS (Mike, 27 Sep 2026). A green dot on somebody's picture when
     they have used the app in the last few minutes, and "Active 12m ago"
     under the name on their profile. The app says "I'm here" every couple
     of minutes while it is open (touch_seen). Anybody can switch it off in
     Your settings ("Show when I'm active"); the database then simply never
     answers for them. Needs supabase/online_status.sql -- without it
     nothing shows and nothing breaks. */
  const ONLINE_MS = 5 * 60e3;
  const seenAt = new Map();      /* id -> last seen (ms), 0 = not showing */
  const seenAsked = new Map();   /* id -> when we last asked */

  async function touchSeen() {
    if (!sb || !me || document.visibilityState !== 'visible') return;
    try { await sb.rpc('touch_seen'); } catch (_) {}
  }

  function activeLabel(ms) {
    const d = Date.now() - ms;
    if (d < ONLINE_MS) return 'Active now';
    const m = Math.round(d / 60e3);
    if (m < 60) return `Active ${m}m ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `Active ${h}h ago` : '';
  }

  async function paintOnline() {
    if (!sb) return;
    const btns = [...document.querySelectorAll('.avatar-btn[data-open-person]')];
    const prof = document.querySelector('.prof.ph[data-owner]');
    const ids = new Set(btns.map(b => b.getAttribute('data-open-person')));
    if (prof) ids.add(prof.getAttribute('data-owner'));
    const now = Date.now();
    const want = [...ids].filter(id => id && (!seenAsked.has(id) || now - seenAsked.get(id) > 60e3));
    if (want.length) {
      want.forEach(id => seenAsked.set(id, now));
      try {
        const { data, error } = await sb.rpc('seen_status', { ids: want.slice(0, 200) });
        if (!error) {
          want.forEach(id => seenAt.set(id, 0));
          (data || []).forEach(r => seenAt.set(r.id, Date.parse(r.last_seen_at) || 0));
        }
      } catch (_) {}
    }
    const isOn = (id) => { const t = seenAt.get(id) || 0; return !!t && Date.now() - t < ONLINE_MS; };
    btns.forEach(b => b.classList.toggle('is-on', isOn(b.getAttribute('data-open-person'))));
    if (prof) {
      const id = prof.getAttribute('data-owner');
      const ring = prof.querySelector('.ph-ring');
      if (ring) ring.classList.toggle('is-on', isOn(id));
      const t = seenAt.get(id) || 0;
      const txt = t ? activeLabel(t) : '';
      let line = prof.querySelector('.ph-active');
      if (txt) {
        if (!line) {
          line = document.createElement('p');
          line.className = 'ph-active';
          const name = prof.querySelector('.ph-name');
          if (name) name.insertAdjacentElement('afterend', line);
        }
        line.textContent = txt;
        line.classList.toggle('now', isOn(id));
      } else if (line) line.remove();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { touchSeen(); paintOnline(); }
  });

  /* ?join=1&follow=name -- the "Join free & follow" button on a shared post
     page (tools/build-post-pages.mjs). A guest gets the join box and follows
     that person once they're in; somebody already signed in just follows. */
  async function joinFromLink() {
    let u;
    try { u = new URL(location.href); } catch (_) { return; }
    if (u.searchParams.get('join') !== '1') return;
    const h = (u.searchParams.get('follow') || '').replace(/^@/, '');
    u.searchParams.delete('join'); u.searchParams.delete('follow');
    try { history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash); } catch (_) {}
    let id = '';
    if (h && sb && /^[A-Za-z0-9_-]{3,24}$/.test(h)) {
      try {
        const { data } = await sb.from('profiles').select('id').ilike('username', h).limit(1);
        id = (data && data[0] && data[0].id) || '';
      } catch (_) {}
    }
    if (me) {
      if (id && id !== me && !following(id) && await writeFollow(id, true)) {
        followed.add(id);
        popSay(`You're following @${h} \u{1F44B}`);
      }
      return;
    }
    if (id) {
      try { localStorage.setItem(FOLLOW_AFTER_JOIN, JSON.stringify({ id, at: Date.now() })); } catch (_) {}
    }
    showJoin(h ? `Join free to follow @${h} \u{1F44B}` : undefined);
  }

  /* Trim a guest's profile to the peek and put the wall after it. True when
     the wall is up, so the caller stops loading. */
  function applyGuestWall(moreToCome) {
    if (!guestOnProfile()) return false;
    if (document.getElementById('guest-wall')) return true;
    const posts = [...feed.querySelectorAll('.post:not(.tutorial)')];
    if (posts.length < GUEST_PEEK || (posts.length === GUEST_PEEK && !moreToCome)) return false;
    posts.slice(GUEST_PEEK).forEach(el => el.remove());
    posts[GUEST_PEEK - 1].insertAdjacentHTML('afterend', guestWallHTML());
    return true;
  }

  async function loadMore() {
    if (busy) return;
    if (guestOnProfile() && document.getElementById('guest-wall')) return;
    /* A grid tab is showing on a profile: the posts underneath are hidden,
       so fetching more of them would be work nobody can see. */
    if (feed.classList.contains('is-grid')) return;
    if (goalsOpen) return;            /* the goals are showing; posts can wait */
    if (finished() && !buffer.length && !queued()) { endOfFeed(); return; }
    busy = true;
    /* ONE QUERY FOR THE WHOLE SCREENFUL. The photos are asked for after the
       cards are chosen and before a single one is drawn, so nothing flashes
       the catalog art and then swaps to somebody's photograph underneath a
       thumb that is already moving.

       NO PICTURE, NO PLACE. Photos have to be attached BEFORE this check,
       because a card whose own row has no picture may still have one in
       card_photos. Whatever is left with only the placeholder is dropped.
       A screenful that filters down to nothing asks again (a few times at
       most) so the feed never stalls on a run of picture-less cards. */
    let rows = [];
    /* THE PHOTOS TAB IS THEIR OWN PICTURES ONLY (27 Sep 2026). A person's
       page walks their cards and their pictures together, newest first, and
       the cards are thrown away here -- so on somebody with sixty cards and
       a dozen memes, one screenful of the walk held one picture, the loop
       stopped at "found something", and the tab showed a single post.
       Here it keeps walking until it has a screenful of pictures or the
       person runs out. */
    const photosOnly = !!(filter && filter.kind === 'person' && profTab === 'posts');
    const want = photosOnly ? 6 : 1;
    for (let tries = 0; tries < (photosOnly ? 60 : 6) && rows.length < want; tries++) {
      let got = await fetchPage();
      if (!got.length) break;
      if (photosOnly) got = got.filter(r => r.kind === 'photo');
      if (blocked.size) got = got.filter(r => !blocked.has(r.userId));
      if (got.length) {
        await attachPhotos(got);
        rows = rows.concat(got.filter(hasPicture));
      }
      if (finished() && !queued() && !buffer.length) break;
    }
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
      refreshHeat().then(refreshSocial);
      placeRails();
      paintOnline();
    }
    busy = false;
    if (applyGuestWall(!(finished() && !buffer.length && !queued()))) return;
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
      if (!me) { showJoin('Sign up to add your own photos.'); return; }
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
      if (!me) { showJoin('Sign up to give that some heat.'); return; }
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
      if (was && heatWho.has(key)) heatWho.set(key, heatWho.get(key).filter(u => u !== me));
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
    /* ---- LEAVING FOR THE LOOKUP PAGE --------------------------------------
       He turns a card over, taps LOOK UP NOW, reads the search results,
       opens one, decides he did not need any of it -- and then taps Back
       three times and lands on a freshly reloaded feed with the card he
       started from nowhere in sight.

       The reason is that the history entry he is going back TO is the bare
       feed address. So before leaving, that entry is rewritten to name the
       card he was reading. replaceState, not pushState: we are correcting
       the address of the page he is standing on, not adding a step -- Back
       still takes exactly as many taps as it did before, it just arrives
       somewhere useful.

       Not done at flip time on purpose. Somebody who turns a card over and
       turns it back has not gone anywhere, and rewriting their address then
       would be hijacking a Back button they never aimed at us. */
    /* ---- THE EDIT BOX ----------------------------------------------------- */
    const ceOpen = e.target.closest('[data-edit-card]');
    if (ceOpen && post) {
      const rear = post.querySelector('[data-rear]');
      if (!rear || !rear.__p) return;
      if (document.querySelector('[data-edit-box]')) return;   /* already open */
      document.body.insertAdjacentHTML('beforeend', editBoxHTML(rear.__p));
      document.body.style.overflow = 'hidden';
      /* Remembered so SAVE knows which card back to redraw without having to
         go looking through the feed for it again. */
      const box = document.querySelector('[data-edit-box]');
      if (box) box.__rear = rear;
      /* Same door the card flip uses. It sits ABOVE the flip layer on the
         stack, so Back closes the box and leaves the card turned over --
         which is what the old repair-the-entry trick was working around. */
      pushBack('edit', dropEditBox);
      return;
    }

    const ceClose = e.target.closest('[data-edit-close]');
    if (ceClose) { closeEditBox(); return; }

    /* RAW or GRADED. Two panels, one shown -- rather than one panel that
       means different things, which is how a raw card ends up carrying a
       cert number. */
    const ceMode = e.target.closest('[data-ce-mode]');
    if (ceMode) {
      const box = ceMode.closest('[data-edit-box]');
      const want = ceMode.getAttribute('data-ce-mode');
      box.querySelectorAll('[data-ce-mode]').forEach(t => t.classList.toggle('on', t === ceMode));
      box.querySelectorAll('[data-ce-panel]').forEach(pa =>
        pa.hidden = pa.getAttribute('data-ce-panel') !== want);
      return;
    }

    const ceRaw = e.target.closest('[data-raw]');
    if (ceRaw) {
      ceRaw.closest('[data-ce-raws]').querySelectorAll('.ce-chip')
        .forEach(c => c.classList.toggle('on', c === ceRaw));
      return;
    }

    const ceStep = e.target.closest('[data-ce-qty]');
    if (ceStep) {
      const input = ceStep.closest('[data-edit-box]').querySelector('[data-ce-qty-in]');
      const n = Math.max(1, Math.min(9999,
        (Number(input.value) || 1) + Number(ceStep.getAttribute('data-ce-qty'))));
      input.value = String(n);
      return;
    }

    const ceSave = e.target.closest('[data-edit-save]');
    if (ceSave) { await saveEdit(ceSave); return; }

    const look = e.target.closest('.btn-look');
    if (look && post) {
      const row = post.getAttribute('data-row') || '';
      if (row) {
        try {
          const back = new URL(location.href);
          back.searchParams.set('post', 'c-' + row);
          back.searchParams.set('flip', '1');
          history.replaceState(history.state, '', back.pathname + back.search);
        } catch (_) { /* no history API: Back behaves as it always did */ }
      }
      return;            /* the link's own navigation carries on */
    }

    const turn = e.target.closest('[data-turn]');
    if (turn && post) {
      const frame = post.querySelector('.frame');
      const rear  = frame.querySelector('[data-rear]');
      const label = turn.querySelector('[data-turn-label]');
      const showingBack = frame.classList.toggle('back');
      if (label) label.textContent = showingBack ? 'FLIP TO FRONT' : 'CARD STORY';

      /* ---- THE BACK BUTTON TURNS THE CARD BACK OVER -------------------------
         He kept reaching for the phone's back button to get out of the card
         story -- which is the correct instinct, it looks like a place you
         went -- and it left the feed entirely, reloaded it, and lost the post
         he had been reading. So a flip now PUSHES a history entry, and the
         back gesture pops it and turns the card over instead of leaving.

         Flipping back by the button calls history.back() rather than
         dropping the class directly, so both ways out go through the same
         door and the stack can never drift out of step with what is showing.

         Nothing is pushed when the browser has no history API, and the
         popstate handler below is a no-op if the card is already face up --
         so the worst case is exactly today's behavior. */
      if (showingBack) {
        /* Named per card. The old listener unflipped EVERY open back face on
           any pop, so closing a sheet turned over a card three posts away. */
        pushBack('flip', () => {
          frame.classList.remove('back');
          const l = frame.querySelector('[data-turn-label]');
          if (l) l.textContent = 'CARD STORY';
        });
      } else if (!popBack('flip')) {
        /* nothing of ours on the stack -- the class toggle above already
           turned it over, so there is nothing left to do */
      }
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
                    /* WHAT THE CARD IS. These were the missing half: the back
                       was rebuilt from six attributes and the set, finish,
                       condition, certificate and count were on none of them,
                       so a PSA 10 Shadowless anything turned over into a date
                       and a story box. Every one is written onto the article
                       when the post is drawn. */
                    set:  post.getAttribute('data-set') || '',
                    numShown: post.getAttribute('data-localnum') || '',
                    variant: post.getAttribute('data-variant') || '',
                    cond: post.getAttribute('data-cond') || '',
                    cert: post.getAttribute('data-cert') || '',
                    edition: post.getAttribute('data-edition') || '',
                    ownerValue: post.getAttribute('data-ownerval')
                      ? Number(post.getAttribute('data-ownerval')) : null,
                    qty:  Number(post.getAttribute('data-qty')) || 1,
                    cardId: cardId,
                    /* The catalogue art, so the back can show the CARD
                       instead of our logo, and the owner's id so it can say
                       whose copy it is. Both were already on the article. */
                    art: post.getAttribute('data-art') || '',
                    /* The user_cards row, which is what ?post= takes. */
                    rowId: post.getAttribute('data-row') || '',
                    owner: owner,
                    range: 0,
                    mine: !!(me && owner && me === owner) };
        rear.innerHTML = rearHTML(p, []);
        /* Kept on the element so tapping 1M / 3M / ALL redraws from what we
           already have rather than asking the database the same question
           five times. */
        rear.__p = p; rear.__hist = [];
        priceHistory(cardId).then(h => {
          if (!h.length) return;
          rear.__hist = h;
          rear.innerHTML = rearHTML(p, h);
          /* The euro rate arrives on its own schedule. When it lands, the
             Cardmarket line is redrawn with the dollar estimate beside it --
             once, and only if this card is showing a euro price at all. */
          if (/CARDMARKET/.test(rear.innerHTML) && !fxRate) {
            loadEurToUsd().then(r => {
              if (r && rear.isConnected && rear.__hist === h) {
                rear.innerHTML = rearHTML(rear.__p, h);
              }
            });
          }
        });
      }
      return;
    }

    /* ---- A RANGE TAB ON THE PRICE CHART -----------------------------------
       Redrawn from the history already in hand. Nothing is fetched, so the
       line changes on the tap rather than a moment after it. */
    const rg = e.target.closest('[data-range]');
    if (rg) {
      const rear = rg.closest('[data-rear]');
      if (rear && rear.__p && rear.__hist) {
        rear.__p.range = Number(rg.getAttribute('data-range')) || 0;
        rear.innerHTML = rearHTML(rear.__p, rear.__hist);
      }
      return;
    }

    const edit = e.target.closest('[data-story-edit]');
    if (edit && post) {
      const panel = edit.closest('[data-story-panel]');
      const now = post.getAttribute('data-note') || '';
      edit.remove();
      panel.insertAdjacentHTML('beforeend', `
        <textarea data-story-box data-mention maxlength="600"
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
      if (post.querySelector('.frame figure img')) { openShareSheet(post); return; }
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
        if (unread > 0 && !askedThisVisit) setTimeout(() => askPush('alerts'), 6000);
      }
    } catch (_) { unread = 0; }
    paintNavDot();
  }

  function paintNavDot() {
    try { paintRail(); } catch (_) {}
    try {
      const bell = document.getElementById('bell');
      if (bell) {
        let n = bell.querySelector('.bell-n');
        if (!n) { n = document.createElement('i'); n.className = 'bell-n'; bell.appendChild(n); }
        const c = me ? unread : 0;
        n.textContent = c > 99 ? '99+' : String(c);
        n.hidden = !(c > 0);
      }
    } catch (_) {}
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

  /* SHORT TIME, the way Instagram writes it under a name (27 Sep 2026):
     now, 5m, 3h, 2d, then the date once it is more than a week old. */
  function agoShort(iso) {
    const then = Date.parse(iso || '');
    if (!then) return '';
    const s = Math.max(0, (Date.now() - then) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 604800) return Math.floor(s / 86400) + 'd';
    const d = new Date(then);
    return d.toLocaleDateString(undefined, d.getFullYear() === new Date().getFullYear()
      ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
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
    heat:    'added heat to your card',
    mention: 'mentioned you',
    invite:  'joined from your invite \u{1F389}'
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
      const personGo = !system && !r.post_key && (r.kind === 'follow' || r.kind === 'invite') && who && who.name
        ? '/feed-next/?who=' + encodeURIComponent(who.name) : '';
      const go = system ? (r.href || '') : (r.post_key || personGo);
      return `<button class="alert${r.read_at ? '' : ' unread'}" type="button"
                 data-alert-go="${esc(go)}" data-alert-href="${system || personGo ? '1' : ''}">
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

  /* WHO YOU ARE, under the wordmark at the top (25 Sep 2026). Small, but
     always there: your face and your @name, and a tap opens your page.
     Signed out it says "Sign in" and goes to the account screen, which is
     where the app's one sign-in form lives. Painted with the MENU face
     below, so the two can never disagree. */
  function paintTopMe() {
    const a = document.getElementById('topme');
    if (!a) return;
    if (!me) {
      /* JOIN FREE, not "Sign in" (27 Sep 2026): sign in sounds like it is
         for people who already have an account. Opens the join box, which
         has the sign-in link for the ones who do. */
      a.className = 'topme out join'; a.href = '/?page=account';
      a.setAttribute('data-join-why', '');
      a.textContent = 'Join free'; a.hidden = !sb; return;
    }
    a.removeAttribute('data-join-why');
    const mine = faces[me] || null;
    const name = (mine && mine.name) || '';
    const pic  = (mine && mine.avatar) || '';
    const init = esc(initialsFor(name).charAt(0) || '?');
    a.className = 'topme';
    a.href = name ? '/feed-next/?who=' + encodeURIComponent(name) : '/feed-next/';
    a.innerHTML = (pic
      ? `<img src="${esc(pic)}" alt="" onerror="this.onerror=null;this.outerHTML='<span class=&quot;tl&quot;>${init}</span>'">`
      : `<span class="tl">${init}</span>`) + (name ? `<b>${esc(name)}</b>` : '<b>you</b>')
      /* MIKE'S VERSION TAG (26 Sep 2026). Only on his own account, big
         enough to read at a glance, so after a refresh he knows he is on
         the update we just talked about. Bump DEV_VER with every change. */
      + ((name || '').toLowerCase() === 'tacomike417'
          ? `<span class="devver" style="display:inline-block;flex:0 0 auto;margin-left:8px;padding:2px 10px;border-radius:10px;background:#ffcb3d;color:#1b1400;font:900 22px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;vertical-align:middle">${DEV_VER}</span>`
          : '');
    a.setAttribute('aria-label', 'Signed in as ' + (name || 'you') + ' — open my page');
    a.hidden = false;
    if (!a.dataset.wired) {
      a.dataset.wired = '1';
      a.addEventListener('click', (e) => {
        if (!me) return;               // signed out: the plain link does it
        e.preventDefault();
        const who = faces[me];
        goNarrow({ kind: 'person', id: me, label: (who && who.name) || 'you' });
      });
    }
  }

  function paintNavMe() {
    paintTopMe();
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
        rows: `<a class="go" href="/?page=account">${ICON.inn}SIGN IN</a>`
      };
    }
    const rows = [
      `<a href="/?page=collection">${ICON.cards}MY COLLECTION</a>`,
      `<a href="/?page=collection&tab=wishlist">${ICON.heart}MY WISH LIST</a>`,
      `<a href="/?page=pokedex">${ICON.dex}MY POK&Eacute;DEX</a>`
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
        `<a class="go" href="/?page=shop">${ICON.bag}BROWSE THE SHOP</a>`,
        `<div class="tiles">
          <a class="tile" href="/?page=hours">${ICON.clock}<span>HOURS</span></a>
          <a class="tile" href="/?page=location">${ICON.pin}<span>LOCATION</span></a>
          <a class="tile" href="/?page=contact">${ICON.phone}<span>CONTACT</span></a>
        </div>`,
        `<div class="tiles tiles--quiet">
          <a class="tile" href="/?page=about">${I.people}<span>ABOUT</span></a>
          <a class="tile" href="/?page=movers">${I.trend}<span>MOVERS &amp; SHAKERS</span></a>
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
          ${ICON.feed}<span>MY PROFILE</span></button>
        <button class="tile${unread ? ' has-news' : ''}" type="button" data-alerts>
          ${ICON.bell}<span>NOTIFICATIONS</span>
          ${unread ? `<i class="tile-n">${unread > 99 ? '99+' : unread}</i>` : ''}</button>
        <button class="tile" type="button" data-open-goals>
          ${ICON.goal}<span>GOALS</span></button>
      </div>`);
      /* MY ACCOUNT became EDIT PROFILE (25 Sep 2026): the account page is
         gone, and everything on it moved to Edit profile or My Collection. */
      /* REPORTS, moderators only (components/reports.js). */
      if (window.InfinitePullsReports && window.InfinitePullsReports.menuRow) rows.push(window.InfinitePullsReports.menuRow());
      rows.push(`<button type="button" data-myedit>${ICON.user}EDIT PROFILE</button>`);
    } else {
      rows.push(`<a class="go" href="/?page=account">${ICON.inn}SIGN IN</a>`);
      rows.push(`<a class="go" href="/?page=account">${ICON.star}CREATE AN ACCOUNT</a>`);
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
               <a class="go gold" href="/?page=account">SIGN IN</a>`
      };
    }
    const mine = faces[me] || {};
    if (!mine.badge) {
      return {
        who: `Infinite Original 2026<small>Yours if you were here before 2027</small>`,
        rows: `
          <div class="badge-hero">
            <img src="/assets/badge-original-2026-lg.webp" alt="" width="96" height="96">
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
          <img src="/assets/badge-original-2026-lg.webp" alt="" width="64" height="64">
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

  /* HOW CLOSE YOU ARE TO EACH LOCKED CARD.

     card_id -> { kind, have, need, pct, trigger_key } from
     reward_card_progress(). Three kinds come back and only ONE gets a bar:

       count  32 cards. 'cards_25' is card_qty >= 25, so 12/25 is a real
              fraction and a bar means something.
       yesno  16 cards. Set an avatar. Own one holo. There is no halfway --
              a bar would sit at 0% while somebody is one tap from done,
              which reads as further away than it is. No bar; the task line
              already says what to do.
       blind   2 cards. app_installed and pokedex_50 cannot be seen from the
              database. have comes back null, not zero, and nothing is drawn.

     Same reasoning the goals page uses for folding 0% badges away: a wall of
     empty bars reads as failing at everything. */
  let rwdProg = new Map();

  function rewardsShell() {
    return { who: 'Infinite Rewards<small>Looking&hellip;</small>',
             rows: '<div class="alert-empty">Looking&hellip;</div>' };
  }

  async function loadRewards() {
    if (!sb) return;
    if (!rwdCards) {
      const { data, error } = await sb.from('reward_cards')
        .select('id, code, card_number, secret, name, task_line, explainer, ' +
                'form_name, thumb_url, art_url, dex_creatures(dex_number, name)')
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
    const { data } = await sb.from('user_reward_cards').select('card_id').not('claimed_at', 'is', null);
    (data || []).forEach(r => rwdMine.add(r.card_id));

    /* THE BARS ARE A BONUS, NOT A DEPENDENCY. If reward_card_progress has
       not been installed the call fails and the sheet renders exactly as it
       did before -- cards, locks, task lines, all of it. A progress bar is
       not worth taking the rewards page down for. */
    rwdProg = new Map();
    try {
      const { data: pr, error: pe } = await sb.rpc('reward_card_progress');
      if (!pe) (pr || []).forEach(r => rwdProg.set(r.card_id, r));
    } catch (e) { /* no bars this time */ }
  }

  const rwdHas  = (c) => rwdMine.has(c.id);

  /* A dollar target reads as nonsense without the sign -- "45 / 1000" could
     be anything, "$45 / $1000" is a collection value. */
  function rwdProgOf(c) {
    if (rwdHas(c)) return null;
    const p = rwdProg.get(c.id);
    if (!p || p.kind !== 'count') return null;
    const have = Number(p.have), need = Number(p.need);
    if (!isFinite(have) || !isFinite(need) || need <= 0) return null;
    const money = /^value_/.test(p.trigger_key || '');
    const n = (v) => (money ? '$' : '') + Math.round(v).toLocaleString('en-US');
    return { pct: Math.max(0, Math.min(100, Number(p.pct) || 0)),
             text: n(have) + ' / ' + n(need) };
  }

  /* Pinned to the bottom edge of the artwork rather than added under the
     tile: every card then carries it in the same place and no tile changes
     height, so the grid does not reflow as the numbers arrive. */
  function rwdTileProg(c) {
    const p = rwdProgOf(c);
    if (!p) return '';
    return `<span class="rwd-prog" aria-hidden="true"><i style="width:${p.pct}%"></i></span>
            <span class="rwd-prog-n">${esc(p.text)}</span>`;
  }
  const rwdDex  = (c) => (c.dex_creatures && c.dex_creatures.dex_number) || 0;
  /* THE CUTOUT, FOR A CARD FROM EITHER DIRECTION. The catalogue arrives from
     PostgREST with the creature embedded; the sweep hands back its own flat
     object with `dex` on it. One function so nothing downstream has to know
     which door the card came through, and '' rather than a broken image when
     it came through neither. */
  function rwdCut(c) {
    const d = (c && (c.dex || rwdDex(c))) || 0;
    return d ? `/assets/dex-cutouts/${String(d).padStart(3, '0')}.webp` : '';
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
        aria-label="${esc(c.name)}. ${esc(c.task_line)}${on ? '' : '. Locked'}${
          (() => { const p = rwdProgOf(c); return p ? '. ' + p.text : ''; })()}">
        <span class="shot"><img src="${esc(c.thumb_url || '')}" alt="" loading="lazy" decoding="async">
        ${on ? '' : `<span class="rwd-lock">${RWD_LOCK}</span>${rwdTileProg(c)}`}</span>
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
      const art = `/assets/dex-cutouts/${String(d).padStart(3, '0')}.webp`;
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
    /* Inside the sheet, on top of the sheet's own layer. Back steps back to
       the grid of cards rather than closing the whole sheet -- one tap
       fewer, and the tap somebody actually meant. */
    if (!backHas('rwdcard')) pushBack('rwdcard', () => { rwdView = 'grid'; rwdPaint(); });
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
         <!-- THE RULE, UNDER THE LABEL. The tile above can only carry four
              words, which is how "FIVE OF YOUR OWN PHOTOS" and "FIVE PHOTO
              POSTS" ended up two tiles apart reading as the same thing --
              when in fact one counts your card photographs and the other
              counts those PLUS every standalone photo, so one contains the
              other. This is the screen with room to say so. Cards whose
              label really is self-explanatory carry no explainer and get
              nothing extra here. -->
         ${c.explainer ? `<p class="task-why">${esc(c.explainer)}</p>` : ''}
         <p class="who">${esc(rwdName(c))}${c.form_name ? ' &middot; ' + esc(c.form_name) : ''}
            &middot; Dex #${String(rwdDex(c)).padStart(3, '0')}</p>
         ${on ? '<p class="got">Earned</p>' : (() => {
             const p = rwdProgOf(c);
             if (!p) return '';
             return `<div class="rwd-open-prog">
                       <div class="rwd-bar"><span style="width:${p.pct}%"></span></div>
                       <p class="rwd-open-n">${esc(p.text)}</p>
                     </div>`;
           })()}
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
    /* A panel that covers the screen and locks scrolling is a place. Back
       used to close the whole app from here -- and the card had already
       been marked as seen, so the moment was gone for good. */
    pushBack('won', rwdCloseWon);
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
         <img class="hey-pull" src="/assets/dex-cutouts/001.webp" alt="" aria-hidden="true">
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
    pushBack('hey', closeWelcome);
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

  /* The other half of the back-button fix above. A card showing its back
     is turned over; anything else is left alone, so an ordinary back out of
     the feed still works exactly as it did. */
  /* A GRADER'S LADDER IS ITS OWN. Switching the company rebuilds the grade
     list, because half the grades on one company's scale do not exist on
     another's -- TAG issues nothing between 9 and 10, PSA has no halves at
     all. Keeping the old list would quietly offer a grade the slab cannot
     say. */
  /* YOUR VALUE, as it is typed: the "you sure?" line, and the sold-listings
     link kept pointing at the grade the box says right now. Never blocks the
     save -- a vintage PSA 10 really can be 50x raw. */
  function ceValueCheck(box) {
    if (!box) return;
    const rear = box.__rear, p = rear && rear.__p;
    if (!p) return;
    const warn = box.querySelector('[data-ce-warn]');
    const sold = box.querySelector('[data-ce-sold]');
    const co = box.querySelector('[data-ce-company]');
    const gr = box.querySelector('[data-ce-grade]');
    const cond = co && gr ? (co.value + ' ' + gr.value).trim() : p.cond;
    if (sold) sold.href = ceSoldUrl(p, cond);
    if (warn) {
      /* TCGplayer first; Cardmarket (euros, roughly 1.1 to the dollar) for
         a card TCGplayer does not price -- every Japanese card, some
         vintage. Without the fallback those never got a "you sure?". */
      const hist = rear.__hist || [];
      const tp = seriesFor(hist, 'tcgplayer', p.variant);
      const cm = seriesFor(hist, 'cardmarket', p.variant);
      const raw = tp.length ? Number(tp[tp.length - 1].price)
        : (cm.length ? Number(cm[cm.length - 1].price) * 1.1 : null);
      const v = parseOwnerValue((box.querySelector('[data-ce-value]') || {}).value);
      warn.textContent = ownerValueWarning(v, raw);
    }
  }
  document.addEventListener('input', (e) => {
    if (e.target.closest('[data-ce-value]')) ceValueCheck(e.target.closest('[data-edit-box]'));
  });

  document.addEventListener('change', (e) => {
    if (e.target.closest('[data-ce-grade]')) ceValueCheck(e.target.closest('[data-edit-box]'));
    const co = e.target.closest('[data-ce-company]');
    if (!co) return;
    const box = co.closest('[data-edit-box]');
    const sel = box && box.querySelector('[data-ce-grade]');
    if (!sel) return;
    sel.innerHTML = (GRADE_LADDERS[co.value] || [])
      .map(g => `<option value="${esc(g.value)}">${esc(g.label)}</option>`).join('');
    ceValueCheck(box);
  });

  /* ---- SAVING THE CORRECTION ----------------------------------------------
     Writes the row, then redraws the card back from the values that were
     actually saved -- not from what was typed. If the database rewrote or
     rejected anything, what the card shows afterwards is the truth rather
     than an optimistic echo of the form.

     A RAW CARD'S CERT NUMBER IS CLEARED, not left behind. Somebody correcting
     a card from "PSA 10" to "Lightly Played" is saying it was never in that
     slab, and a cert number sitting on a raw card would go on linking to a
     grading report for a card that is not this one.

     cert_number MAY NOT EXIST. The column is one of NEW_COLS -- a database
     that has not had cert_number.sql run against it drops just that field
     and saves the rest, the same way every other reader here degrades. */
  async function saveEdit(btn) {
    const box = btn.closest('[data-edit-box]');
    const rear = box && box.__rear;
    const rowId = btn.getAttribute('data-edit-save');
    if (!box || !rear || !rowId || !sb || !me) return;

    const err = box.querySelector('[data-ce-err]');
    const fail = (msg) => { if (err) { err.textContent = msg; err.hidden = false; }
                            btn.disabled = false; btn.textContent = 'SAVE'; };
    if (err) err.hidden = true;
    btn.disabled = true; btn.textContent = 'SAVING\u2026';

    const graded = !!box.querySelector('[data-ce-mode="graded"].on');
    const variant = box.querySelector('[data-ce-finish]').value;
    const qty = Math.max(1, Math.min(9999,
      Number(box.querySelector('[data-ce-qty-in]').value) || 1));

    let condition, cert;
    if (graded) {
      const co = box.querySelector('[data-ce-company]').value;
      const gr = box.querySelector('[data-ce-grade]').value;
      condition = (co + ' ' + gr).trim();
      cert = String(box.querySelector('[data-ce-cert]').value || '').trim();
    } else {
      const picked = box.querySelector('[data-ce-raws] .ce-chip.on');
      condition = picked ? picked.getAttribute('data-raw') : 'Near Mint';
      cert = '';                      /* see the note above */
    }

    const patch = { variant, condition, quantity: qty, cert_number: cert || null };
    const edIn = box.querySelector('[data-ce-edition]');
    if (edIn) patch.edition = edIn.value || null;
    /* Your value goes with the grade. Switching to raw clears it, same as
       the cert, so a raw card never carries a slab price around. */
    const valIn = box.querySelector('[data-ce-value]');
    patch.owner_value = graded && valIn ? parseOwnerValue(valIn.value) : null;
    let error = null, saved = null;
    for (let tries = 3; tries > 0; tries--) {
      /* user_id as well as the row id. The policy on user_cards is what
         actually stops somebody editing a card that is not theirs; this is
         a query that could not do it even if the policy were dropped. */
      ({ data: saved, error } = await sb.from('user_cards')
        .update(patch).eq('id', rowId).eq('user_id', me)
        .select('variant, condition, quantity' +
                ('cert_number' in patch ? ', cert_number' : '') +
                ('owner_value' in patch ? ', owner_value' : '') +
                ('edition' in patch ? ', edition' : ''))
        .maybeSingle());
      if (!error || !missingColumn(error)) break;
      /* Older database: drop just the column it does not have. */
      const gone = missingName(error);
      if (gone === 'edition') delete patch.edition;
      else if (gone === 'owner_value' || (!gone && 'owner_value' in patch)) delete patch.owner_value;
      else delete patch.cert_number;
    }

    if (error) { fail('Could not save that: ' + (error.message || error.code || 'unknown')); return; }
    if (!saved) { fail('That card is not yours to edit.'); return; }

    /* THE CARD BACK, REDRAWN FROM WHAT THE DATABASE KEPT. */
    const p = rear.__p;
    p.variant = saved.variant || '';
    p.cond    = saved.condition || '';
    p.qty     = saved.quantity || 1;
    p.cert    = ('cert_number' in saved) ? (saved.cert_number || '') : p.cert;
    p.edition = ('edition' in saved) ? (saved.edition || '') : p.edition;
    p.ownerValue = ('owner_value' in saved)
      ? (saved.owner_value == null ? null : Number(saved.owner_value)) : p.ownerValue;
    rear.innerHTML = rearHTML(p, rear.__hist || []);

    /* And the article's own attributes, so turning the card over again
       later rebuilds the corrected version rather than the old one. */
    const art = rear.closest('.post');
    if (art) {
      art.setAttribute('data-variant', p.variant);
      art.setAttribute('data-cond', p.cond);
      art.setAttribute('data-qty', String(p.qty));
      art.setAttribute('data-cert', p.cert || '');
      art.setAttribute('data-edition', p.edition || '');
      art.setAttribute('data-ownerval', p.ownerValue == null ? '' : String(p.ownerValue));
    }

    closeEditBox();
    note('Card updated.');
  }

  function dropEditBox() {
    const box = document.querySelector('[data-edit-box]');
    if (box) box.remove();
    document.body.style.overflow = '';
  }

  /* ---- CLOSING THE BOX ON PURPOSE ----------------------------------------
     Through the stack, like every other layer. This used to REPAIR its own
     history entry with replaceState instead of popping it, because popping
     ran a popstate handler that unflipped the card underneath -- so closing
     the box turned the card over and dumped the feed back to the top.

     That handler is gone. The stack pops exactly the top layer, and the
     flip layer sits below this one untouched, so Back or SAVE or CANCEL or
     the X all close the box and leave the card exactly as it was. The
     workaround is not needed, so it is not here. */
  function closeEditBox() {
    if (popBack('edit')) return;     /* the listener does the closing */
    dropEditBox();                   /* no history API: close it directly */
  }

  /* ESCAPE IS A WAY OUT TOO, for anybody on a keyboard. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!document.querySelector('[data-edit-box]')) return;
    closeEditBox();
  });

  /* ======================================================================
     SCAN TO FOLLOW -- 25 Sep 2026 (SOCIAL-NEXT part 4)

     Every profile has a QR code for its own address,
     infinitepulls.com/@name. Tap the little QR mark beside the name and it
     fills the screen, big and black-on-white, so somebody standing next to
     you can point their camera at it. Jeff's goes on the counter and on
     stream.

     Two things to do with it besides scanning: SHARE hands the link to the
     phone's own share sheet, and SAVE PICTURE makes a printable card (the
     code, the @name, the address) -- the one for the counter.

     No on-screen back arrow, by Mike's rule: it is a layer on the back
     stack, so the phone's back button or edge swipe closes it, and so does
     a tap anywhere off the white card, or Escape.

     The generator is qrcode.js beside this file (Kazuhiko Arase, MIT),
     loaded the first time somebody opens one, so nobody else pays for it.
     ====================================================================== */
  const QR_HOST = 'https://infinitepulls.com/@';
  let qrLib = null;

  function loadQrLib() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (qrLib) return qrLib;
    qrLib = new Promise((ok, fail) => {
      const tag = document.createElement('script');
      tag.src = './qrcode.js';
      tag.onload = () => (window.qrcode ? ok(window.qrcode) : fail(new Error('QR code did not load')));
      tag.onerror = () => { qrLib = null; fail(new Error('QR code did not load')); };
      document.head.appendChild(tag);
    });
    return qrLib;
  }

  /* Draws the code onto a canvas at a whole number of pixels per square, with
     the four-square white border scanners need. Medium error correction:
     enough to survive a scuffed print on a counter without a huge code. */
  function drawQR(lib, text, canvas, px) {
    const qr = lib(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    const cell = Math.max(1, Math.floor(px / (n + quiet * 2)));
    const size = cell * (n + quiet * 2);
    canvas.width = size; canvas.height = size;
    const x = canvas.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, size, size);
    x.fillStyle = '#000';
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (qr.isDark(r, c)) x.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    return size;
  }

  /* The printable one: the code, the @name under it, the address under that. */
  function qrPoster(lib, name) {
    const url = QR_HOST + name;
    const W = 1200, H = 1500;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    const code = document.createElement('canvas');
    const size = drawQR(lib, url, code, 1000);
    x.drawImage(code, (W - size) / 2, 110);
    x.fillStyle = '#04070f';
    x.textAlign = 'center';
    x.font = '800 84px system-ui, sans-serif';
    x.fillText('@' + name, W / 2, 110 + size + 110);
    x.font = '600 44px system-ui, sans-serif';
    x.fillStyle = '#55677e';
    x.fillText('Scan to see my cards on Infinite Pulls', W / 2, 110 + size + 185);
    x.fillText('infinitepulls.com/@' + name, W / 2, 110 + size + 245);
    return c;
  }

  function dropQR() {
    const el = document.querySelector('[data-qr-sheet]');
    if (el) el.remove();
    document.body.style.overflow = '';
  }

  async function openQR({ name, avatar, mine }) {
    if (!name || document.querySelector('[data-qr-sheet]')) return;
    const url = QR_HOST + name;
    const sheet = document.createElement('div');
    sheet.className = 'qr-sheet';
    sheet.setAttribute('data-qr-sheet', '');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', at(name) + ' QR code');
    sheet.innerHTML = `
      <div class="qr-card">
        <div class="qr-who">
          <img src="${esc(avatar || '/assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">
          <b>${esc(at(name))}</b>
        </div>
        <div class="qr-code"><canvas aria-hidden="true"></canvas><span class="qr-wait">Making the code&hellip;</span></div>
        <p class="qr-say">${mine ? 'Scan to see my cards' : 'Scan to see ' + esc(at(name)) + '&rsquo;s cards'}</p>
        <p class="qr-url">infinitepulls.com/@${esc(name)}</p>
        <div class="qr-acts">
          <button type="button" data-qr-share>SHARE</button>
          <button type="button" data-qr-save>SAVE PICTURE</button>
        </div>
      </div>`;
    document.body.appendChild(sheet);
    document.body.style.overflow = 'hidden';
    pushBack('qr', dropQR);

    const closeQR = () => { if (!popBack('qr')) dropQR(); };
    sheet.addEventListener('click', (e) => { if (e.target === sheet) closeQR(); });

    let lib;
    try {
      lib = await loadQrLib();
      const cv = sheet.querySelector('.qr-code canvas');
      drawQR(lib, url, cv, 720);
      sheet.querySelector('.qr-wait').remove();
    } catch (e) {
      const w = sheet.querySelector('.qr-wait');
      if (w) w.textContent = 'The code would not load. Check your signal and try again.';
      return;
    }

    sheet.querySelector('[data-qr-share]').addEventListener('click', async () => {
      try {
        if (navigator.share) { await navigator.share({ title: at(name) + ' on Infinite Pulls', url }); return; }
      } catch (err) { if (err && err.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(url); note('Link copied'); }
      catch (_) { note(url); }
    });

    sheet.querySelector('[data-qr-save]').addEventListener('click', () => {
      const poster = qrPoster(lib, name);
      poster.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], 'infinitepulls-' + name + '-qr.png', { type: 'image/png' });
        /* On a phone, the share sheet is where "Save Image" lives; a
           download link there opens a tab instead. On a computer, download. */
        try {
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: at(name) + ' QR code' });
            return;
          }
        } catch (err) { if (err && err.name === 'AbortError') return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, 'image/png');
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !document.querySelector('[data-qr-sheet]')) return;
    if (!popBack('qr')) dropQR();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !document.querySelector('[data-edit-sheet]')) return;
    if (!popBack('editprofile')) dropEditProfile();
  });

  /* EVERYONE / FOLLOWING, the two tabs above the feed. */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-feed-mode]');
    if (!t) return;
    e.preventDefault();
    pickFeedMode(t.getAttribute('data-feed-mode'));
  });

  /* ======================================================================
     ONE STACK FOR THE PHONE'S BACK BUTTON

     Nobody taps an on-screen back arrow on a phone. They use the button or
     the edge swipe, and when that throws them out of the app instead of
     going back one step, they lose their place -- which on a page you are
     RESEARCHING with is the whole game.

     This file used to answer that three separate times: a flag pair for the
     sheet, another for the feed filter, and a state tag for the card flip
     and the edit box -- served by TWO popstate listeners that did not know
     about each other. They fired in registration order, so popping a SHEET
     entry also ran the flip listener, which unflipped every open card back
     face on the page. One tap, two things closed, and the second one was
     somewhere you were not even looking.

     One ordered stack fixes both halves. Anything that covers the screen
     pushes a layer; Back pops exactly the top one and closes exactly that.

     THREE RULES, all of them learned the hard way in the code this replaces:

       1. The pushed entry carries the SAME address as the page underneath,
          so an entry left behind later is invisible rather than a trapdoor.
       2. ONE entry per layer, never one per step. Drilling deeper inside a
          layer does not push again.
       3. EVERY deliberate way out -- an X, a backdrop tap, Escape, picking
          a result -- goes through popBack(), which calls history.back() and
          lets the listener do the closing. One closing path means the stack
          can never drift out of step with what is on the screen.
     ====================================================================== */
  const backStack = [];          /* [{ tag, close }] -- newest last */
  /* components/add-dial.js (the ADD button) puts its layer on this same
     stack, so one Back closes it and nothing else. */
  window.InfinitePullsFeedBack = { push: (t, c) => pushBack(t, c), pop: (t) => popBack(t) };

  function pushBack(tag, close, url) {
    backStack.push({ tag: tag, close: close });
    try { history.pushState({ ipBack: tag }, '', url || location.href); }
    catch (_) {
      /* No history API. The layer still opens and still closes by its own
         control; it just cannot be closed by the phone's button. */
      backStack.pop();
    }
  }

  /* Returns false when the top of the stack is not ours to close, so the
     caller can fall back to hiding the thing directly. */
  function popBack(tag) {
    const top = backStack[backStack.length - 1];
    if (!top || (tag && top.tag !== tag)) return false;
    try { history.back(); } catch (_) { return false; }
    return true;
  }

  const backHas = (tag) => backStack.some(l => l.tag === tag);

  window.addEventListener('popstate', () => {
    const top = backStack.pop();
    if (!top) return;            /* nothing of ours open: let the phone go back */
    try { top.close(); } catch (_) { /* a close that throws must not trap them */ }
  });

  /* ======================================================================
     SOCIAL PACK, PHASE 1 -- 27 Sep 2026. See supabase/social_pack_1.sql.

       * BLOCK a person: their posts and comments stop showing to you. They
         are never told. Undo it from their ⋯ menu.
       * REPORT a post: it goes to a list only staff can read.
       * EDIT CAPTION on your own photo post, from its ⋯ menu.
       * VIEWS: a post counts as seen after a second at least half on
         screen, once per phone per visit. The number sits after the heat.
     ====================================================================== */
  var blocked = new Set();        /* var: read by loadMore/loadTalk above */
  function popSay(msg) {
    let t = document.getElementById('ip-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ip-toast'; t.className = 'ip-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on');
    clearTimeout(popSay._t); popSay._t = setTimeout(() => t.classList.remove('on'), 2600);
  }
  var viewCount = new Map();      /* post_key -> views */

  async function loadBlocks() {
    if (!sb || !me) return;
    try {
      const { data } = await sb.from('user_blocks').select('blocked_id').eq('blocker_id', me);
      (data || []).forEach(r => blocked.add(r.blocked_id));
    } catch (_) { /* no table yet: nobody is blocked */ }
  }

  /* ---- the ⋯ button on every post that belongs to a person ---- */
  const MORE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
  function decoratePosts() {
    feed.querySelectorAll('.post[data-owner]:not([data-more])').forEach(post => {
      const owner = post.getAttribute('data-owner');
      post.setAttribute('data-more', '1');
      if (!owner || post.classList.contains('tutorial')) return;
      const head = post.querySelector('.post-top');
      if (!head) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'post-more'; b.setAttribute('data-post-more', '');
      b.setAttribute('aria-label', 'More');
      b.innerHTML = MORE_ICON;
      head.appendChild(b);
    });
  }

  let moreBox = null;
  function closeMore() { if (moreBox) { moreBox.remove(); moreBox = null; document.documentElement.classList.remove('join-open'); } }
  function sheet(title, rowsHTML) {
    closeMore();
    moreBox = document.createElement('div');
    moreBox.className = 'flist';
    moreBox.setAttribute('role', 'dialog');
    moreBox.innerHTML = `<div class="fl-card"><div class="fl-top"><b>${title}</b></div><div class="fl-rows more-rows">${rowsHTML}</div></div>`;
    document.body.appendChild(moreBox);
    document.documentElement.classList.add('join-open');
    if (!backHas('more')) pushBack('more', closeMore);
    moreBox.addEventListener('click', (e) => { if (!e.target.closest('.fl-card')) { if (!popBack('more')) closeMore(); } });
    return moreBox;
  }
  const leaveSheet = () => { if (!popBack('more')) closeMore(); };

  function openMore(post) {
    const owner = post.getAttribute('data-owner') || '';
    const key = (post.querySelector('[data-hype]') || {}).getAttribute
      ? post.querySelector('[data-hype]').getAttribute('data-hype') : post.getAttribute('data-key');
    const mine = !!me && owner === me;
    const name = (faces[owner] && faces[owner].name) || 'them';
    const isPhoto = post.classList.contains('is-photo');
    const rows = [];
    if (mine) {
      if (isPhoto) rows.push(`<button type="button" class="more-row" data-more-edit>✏️ Edit caption</button>`);
      rows.push(`<button type="button" class="more-row" data-more-copy>\u{1F517} Copy link</button>`);
    } else {
      rows.push(`<button type="button" class="more-row" data-more-copy>\u{1F517} Copy link</button>`);
      rows.push(`<button type="button" class="more-row is-warn" data-more-report>\u{1F6A9} Report this post</button>`);
      rows.push(blocked.has(owner)
        ? `<button type="button" class="more-row" data-more-unblock>Unblock ${esc(at(name))}</button>`
        : `<button type="button" class="more-row is-warn" data-more-block>\u{1F6AB} Block ${esc(at(name))}</button>`);
    }
    const box = sheet('Post', rows.join(''));
    box.addEventListener('click', async (e) => {
      const btn = e.target.closest('button'); if (!btn) return;
      if (btn.hasAttribute('data-more-copy')) {
        try { await navigator.clipboard.writeText(post.getAttribute('data-link') || location.href); popSay('Link copied.'); } catch (_) {}
        leaveSheet(); return;
      }
      if (btn.hasAttribute('data-more-edit')) { leaveSheet(); setTimeout(() => editCaption(post), 80); return; }
      if (!me) { leaveSheet(); setTimeout(() => showJoin('Sign up to report or block.'), 80); return; }
      if (btn.hasAttribute('data-more-report')) { reportSheet(post, key, owner); return; }
      if (btn.hasAttribute('data-more-block')) {
        if (!btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = `Tap again to block ${at(name)}`; return; }
        try {
          const { error } = await sb.from('user_blocks').insert({ blocker_id: me, blocked_id: owner });
          if (error && error.code !== '23505') throw error;
          blocked.add(owner);
          feed.querySelectorAll(`.post[data-owner="${CSS.escape(owner)}"]`).forEach(p => p.remove());
          popSay(`${at(name)} is blocked. You won't see their posts.`);
        } catch (err) { popSay('That did not save: ' + ((err && err.message) || 'try again')); }
        leaveSheet(); return;
      }
      if (btn.hasAttribute('data-more-unblock')) {
        try { await sb.from('user_blocks').delete().eq('blocker_id', me).eq('blocked_id', owner); blocked.delete(owner); popSay(`${at(name)} is unblocked.`); }
        catch (_) {}
        leaveSheet();
      }
    });
  }

  const REASONS = ['Spam or not Pokémon', 'Rude, hateful or bullying', 'Not their photo / stolen', 'Copyright -- uses my photo, video or music', 'Scam or fake', 'Something else'];
  function reportSheet(post, key, owner) {
    const box = sheet('Why are you reporting it?', REASONS.map(r =>
      `<button type="button" class="more-row" data-reason="${esc(r)}">${esc(r)}</button>`).join(''));
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-reason]'); if (!b) return;
      try {
        const { error } = await sb.from('post_reports').insert({ post_key: key, post_owner: owner || null, reporter_id: me, reason: b.getAttribute('data-reason') });
        if (error && error.code !== '23505') throw error;
        popSay('Thanks — the shop will take a look.');
      } catch (err) { popSay('That did not send: ' + ((err && err.message) || 'try again')); }
      leaveSheet();
    });
  }

  /* ---- edit your caption, right on the post ---- */
  async function editCaption(post) {
    const rowId = post.getAttribute('data-row');
    if (!rowId || post.querySelector('.cap-edit')) return;
    const cap = post.querySelector('.caption');
    let current = '';
    try {
      const { data } = await sb.from('user_photos').select('caption').eq('id', rowId).maybeSingle();
      current = (data && data.caption) || '';
    } catch (_) { const t = cap && cap.querySelector('.cap-t'); current = t ? t.textContent : ''; }
    if (post.querySelector('.cap-edit')) return;
    const form = document.createElement('form');
    form.className = 'cap-edit';
    form.innerHTML = `<textarea maxlength="500" rows="3" data-mention>${esc(current)}</textarea>
      <div><button type="button" data-cap-cancel>Cancel</button><button type="submit">Save</button></div>`;
    (cap || post.querySelector('.acts')).insertAdjacentElement('afterend', form);
    if (cap) cap.hidden = true;
    const ta = form.querySelector('textarea'); ta.focus();
    const done = () => { form.remove(); if (cap) cap.hidden = false; };
    form.querySelector('[data-cap-cancel]').addEventListener('click', done);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const next = ta.value.trim();
      try {
        const { error } = await sb.from('user_photos').update({ caption: next || null }).eq('id', rowId).eq('user_id', me);
        if (error) throw error;
        const span = cap && cap.querySelector('.cap-t');
        if (span) span.innerHTML = mentions(next);
        else if (!cap && next) {
          const who = (faces[me] && faces[me].name) || '';
          post.querySelector('.acts').insertAdjacentHTML('afterend',
            `<p class="caption"><b>${esc(at(who) || 'You')}</b> <span class="cap-t">${mentions(next)}</span></p>`);
        }
        popSay('Caption saved.');
      } catch (err) { popSay('That did not save: ' + ((err && err.message) || 'try again')); }
      done();
    });
  }

  document.addEventListener('click', (e) => {
    const m = e.target.closest('[data-post-more]');
    if (!m) return;
    e.preventDefault();
    const post = m.closest('.post');
    if (post) openMore(post);
  });

  /* ---- views ---- */
  let viewIO = null;
  const viewPending = new Set();
  const viewSeen = (() => { try { return new Set(JSON.parse(sessionStorage.getItem('ip-viewed') || '[]')); } catch (_) { return new Set(); } })();
  let viewTimer = null;
  function flushViews() {
    viewTimer = null;
    if (!sb || !viewPending.size) return;
    const keys = [...viewPending]; viewPending.clear();
    keys.forEach(k => { viewSeen.add(k); viewCount.set(k, (viewCount.get(k) || 0) + 1); });
    try { sessionStorage.setItem('ip-viewed', JSON.stringify([...viewSeen].slice(-800))); } catch (_) {}
    sb.rpc('record_views', { p_keys: keys }).then(() => {}, () => {});
  }
  function watchViews() {
    if (!('IntersectionObserver' in window)) return;
    if (!viewIO) {
      const timers = new Map();
      viewIO = new IntersectionObserver((ents) => ents.forEach(en => {
        const hb = en.target.querySelector('[data-hype]');
        const k = hb && hb.getAttribute('data-hype');
        if (!k || k.length < 3 || viewSeen.has(k)) { viewIO.unobserve(en.target); return; }
        if (en.isIntersecting) {
          timers.set(k, setTimeout(() => {
            viewPending.add(k); viewIO.unobserve(en.target);
            if (!viewTimer) viewTimer = setTimeout(flushViews, 3000);
          }, 1000));
        } else { clearTimeout(timers.get(k)); timers.delete(k); }
      }), { threshold: 0.5 });
    }
    feed.querySelectorAll('.post:not([data-vw])').forEach(p => { p.setAttribute('data-vw', '1'); viewIO.observe(p); });
  }
  window.addEventListener('pagehide', flushViews);

  /* ======================================================================
     THE NOTIFICATIONS NUDGE -- social pack #2, 27 Sep 2026.
     Asked at the moment it makes sense, never on arrival:
       * right after you comment   ("get a buzz when someone answers")
       * right after you post       (?posted=1 from the ADD dial)
       * when you open the app with alerts waiting
     At most once every 4 days; after 3 "Not now"s, once a month. Never
     if this phone is already signed up or the phone has blocked it.
     iPhone in a Safari tab cannot get notifications at all, so it gets
     the add-to-Home-Screen steps instead.
     ====================================================================== */
  const ASK_KEY = 'ip-push-ask-v1';
  let askedThisVisit = false;
  function askState() { try { return JSON.parse(localStorage.getItem(ASK_KEY) || '{}'); } catch (_) { return {}; } }
  function askSave(o) { try { localStorage.setItem(ASK_KEY, JSON.stringify(o)); } catch (_) {} }
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent || '');
  const installed = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  async function askPush(why) {
    if (askedThisVisit || !me || !sb) return;
    const st = askState();
    const wait = (st.nos || 0) >= 3 ? 30 : 4;
    if (st.last && Date.now() - st.last < wait * 864e5) return;
    const iosTab = isIOS() && !installed() && !pushable();
    if (!iosTab) {
      if (!pushable() || Notification.permission === 'denied') return;
      if (await deviceOn()) return;
    }
    if (document.querySelector('.flist, .joinbox')) return;   /* something is already up */
    askedThisVisit = true;
    askSave({ ...st, last: Date.now() });

    const line = why === 'comment' ? 'Get a buzz the second someone answers you.'
      : why === 'post' ? 'Get a buzz when people give your post heat or comment on it.'
      : 'You have alerts waiting. Get them on your phone the second they happen.';
    const box = document.createElement('div');
    box.className = 'flist pushask';
    box.setAttribute('role', 'dialog');
    box.innerHTML = iosTab
      ? `<div class="fl-card"><div class="pa-body">
           <div class="pa-bell">\u{1F514}</div>
           <h3>Get alerts on your iPhone</h3>
           <p>${line}</p>
           <ol><li>Tap the <b>Share</b> button <span class="pa-share">⬆︎</span> at the bottom of Safari</li>
               <li>Tap <b>Add to Home Screen</b></li>
               <li>Open Infinite Pulls from your Home Screen and tap <b>TURN ON</b> when it asks</li></ol>
           <button type="button" class="pa-go" data-pa-no>GOT IT</button>
         </div></div>`
      : `<div class="fl-card"><div class="pa-body">
           <div class="pa-bell">\u{1F514}</div>
           <h3>Don't miss the heat \u{1F525}</h3>
           <p>${line}</p>
           <button type="button" class="pa-go" data-pa-on>TURN ON</button>
           <button type="button" class="pa-no" data-pa-no>Not now</button>
         </div></div>`;
    document.body.appendChild(box);
    document.documentElement.classList.add('join-open');
    const close = () => { box.remove(); document.documentElement.classList.remove('join-open'); };
    pushBack('pushask', close);
    const leave = () => { if (!popBack('pushask')) close(); };
    box.addEventListener('click', async (e) => {
      if (!e.target.closest('.fl-card') || e.target.closest('[data-pa-no]')) {
        if (!iosTab) askSave({ ...askState(), nos: (askState().nos || 0) + 1 });
        leave(); return;
      }
      const on = e.target.closest('[data-pa-on]');
      if (!on || on.disabled) return;
      on.disabled = true; on.textContent = 'One sec…';
      let r = false;
      try { r = await turnOn(); } catch (_) {}
      leave();
      if (r === true) {
        askSave({ ...askState(), nos: 0 });
        popSay('Notifications are on \u{1F525}');
        try { paintBell(); } catch (_) {}
      } else if (Notification.permission === 'denied') {
        popSay('Your phone blocked it. You can allow it in Settings.');
      } else popSay('That did not work. Try the bell later.');
    });
  }
  window.InfinitePullsAskPush = askPush;

  /* ======================================================================
     INVITE YOUR FRIENDS -- 27 Sep 2026 (Jeff). INVITE in the rail, INVITE
     FRIENDS on your own page, and once right after you sign up.
     No website can read your Instagram or Facebook friends, and iPhones do
     not let a website read contacts -- so each button opens the app with the
     invite ready to send. On Android, TEXT opens the contact picker first so
     several people can be ticked at once.
     ====================================================================== */
  let invBox = null;
  function closeInvite() { if (invBox) { invBox.remove(); invBox = null; document.documentElement.classList.remove('join-open'); } }
  function inviteParts() {
    const name = (faces[me] && faces[me].name) || '';
    const url = name ? QR_HOST + name : location.origin;
    const text = "Come follow me on Infinite Pulls — post your pulls, show off your collection, and see what everyone's pulling.";
    return { url, text, full: text + ' ' + url };
  }
  const isAndroid = () => /Android/i.test(navigator.userAgent || '');
  async function copyInvite(msg) {
    try { await navigator.clipboard.writeText(inviteParts().full); popSay(msg || 'Invite copied.'); return true; } catch (_) { return false; }
  }

  async function openInvite(welcome) {
    if (!me) { showJoin('Sign up to invite your friends.'); return; }
    if (invBox) return;
    const tiles = [
      ['text', '\u{1F4AC}', 'Text'],
      ['wa', '\u{1F7E2}', 'WhatsApp'],
      ['msgr', '\u{1F4E8}', 'Messenger'],
      ['ig', '\u{1F4F8}', 'Instagram DM'],
      ['fb', '\u{1F310}', 'Facebook post'],
      ['more', '…', 'More'],
    ];
    invBox = document.createElement('div');
    invBox.className = 'flist invite';
    invBox.setAttribute('role', 'dialog');
    invBox.innerHTML = `<div class="fl-card"><div class="iv-body">
        <div class="iv-art">\u{1F91D}</div>
        <h3>${welcome ? "You're in! Bring your crew" : 'Invite your friends'}</h3>
        <p>Collecting is better with your people. When they join from your invite, they follow you automatically.</p>
        <div class="iv-grid">${tiles.map(([k, ic, lb]) =>
          `<button type="button" class="iv-tile" data-iv="${k}"><span class="iv-ic">${ic}</span><span>${lb}</span></button>`).join('')}</div>
        <button type="button" class="iv-copy" data-iv="copy">\u{1F517} Copy invite link</button>
        <p class="iv-count" hidden></p>
        ${welcome ? '<button type="button" class="iv-skip" data-iv="skip">Maybe later</button>' : ''}
      </div></div>`;
    document.body.appendChild(invBox);
    document.documentElement.classList.add('join-open');
    pushBack('invite', closeInvite);
    const leave = () => { if (!popBack('invite')) closeInvite(); };
    try {
      const { data } = await sb.rpc('invite_count', { p_user: me });
      const n = Number(data) || 0;
      const c = invBox && invBox.querySelector('.iv-count');
      if (c && n > 0) { c.textContent = `\u{1F91D} ${n} ${n === 1 ? 'friend has' : 'friends have'} joined from your invites`; c.hidden = false; }
    } catch (_) {}
    invBox && invBox.addEventListener('click', async (e) => {
      if (!e.target.closest('.fl-card')) { leave(); return; }
      const b = e.target.closest('[data-iv]'); if (!b) return;
      const k = b.getAttribute('data-iv');
      const { url, text, full } = inviteParts();
      const enc = encodeURIComponent;
      if (k === 'skip') { leave(); return; }
      if (k === 'copy') { await copyInvite('Invite link copied. Paste it anywhere.'); return; }
      if (k === 'text') {
        let to = '';
        if (isAndroid() && navigator.contacts && navigator.contacts.select) {
          try {
            const picked = await navigator.contacts.select(['name', 'tel'], { multiple: true });
            to = (picked || []).map(c => (c.tel && c.tel[0]) || '').filter(Boolean).map(t => t.replace(/[^\d+]/g, '')).join(',');
            if (!to && picked && !picked.length) return;          /* they backed out */
          } catch (_) {}
        }
        location.href = isAndroid() ? `sms:${to}?body=${enc(full)}` : `sms:&body=${enc(full)}`;
        return;
      }
      if (k === 'wa') { window.open(`https://wa.me/?text=${enc(full)}`, '_blank', 'noopener'); return; }
      if (k === 'fb') { window.open(`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`, '_blank', 'noopener'); return; }
      if (k === 'msgr') {
        await copyInvite('Invite copied — paste it in Messenger.');
        location.href = `fb-messenger://share/?link=${enc(url)}`;
        return;
      }
      if (k === 'ig') {
        await copyInvite('Invite copied — paste it in a DM.');
        setTimeout(() => { location.href = 'https://www.instagram.com/direct/inbox/'; }, 700);
        return;
      }
      if (k === 'more') {
        try { if (navigator.share) { await navigator.share({ title: 'Join me on Infinite Pulls', text, url }); return; } } catch (_) { return; }
        await copyInvite();
      }
    });
  }

  /* ONCE, right after sign up: the first feed visit in an account's first
     three days. */
  async function welcomeInvite() {
    try {
      if (localStorage.getItem('ip-welcome-invite-v1')) return;
      const { data } = await sb.auth.getUser();
      const made = data && data.user && Date.parse(data.user.created_at || '');
      if (!made || Date.now() - made > 3 * 864e5) { localStorage.setItem('ip-welcome-invite-v1', 'old'); return; }
      setTimeout(() => {
        if (backStack.length || document.querySelector('.flist, .joinbox, .notifdrop')) return;
        localStorage.setItem('ip-welcome-invite-v1', '1');
        openInvite(true);
      }, 4000);
    } catch (_) {}
  }

  /* ======================================================================
     NOTIFICATIONS DROPDOWN -- 27 Sep 2026, Jeff: "work like Facebook's."
     The bell at the top (and ALERTS in the rail) drops this down under the
     top bar: who did what, when, with the post's picture on the right.
     Tapping a row goes to the exact thing -- a comment opens the post with
     that comment lit up and the reply box aimed at it; heat opens the post;
     a follow opens their page. New ones on top, then Earlier.
     ====================================================================== */
  let dropBox = null;
  let dropRows = [];
  function closeDrop() {
    if (!dropBox) return;
    dropBox.remove(); dropBox = null;
    document.documentElement.classList.remove('join-open');
    const b = document.getElementById('bell'); if (b) b.setAttribute('aria-expanded', 'false');
  }
  function openDrop() {
    if (!me) { showJoin('Sign up to get your notifications.'); return; }
    if (dropBox) { if (!popBack('notifdrop')) closeDrop(); return; }
    const head = document.querySelector('header');
    const top = head ? Math.max(0, Math.round(head.getBoundingClientRect().bottom)) : 56;
    dropBox = document.createElement('div');
    dropBox.className = 'notifdrop';
    dropBox.style.setProperty('--nd-top', top + 'px');
    dropBox.innerHTML = `<div class="nd-panel" role="dialog" aria-label="Notifications">
        <div class="nd-holo" aria-hidden="true"></div>
        <div class="nd-head"><b><em aria-hidden="true">\u221E</em>Notifications</b>
          <button type="button" class="nd-phone" data-nd-phone><span>Phone alerts</span><i></i></button></div>
        <div class="nd-rows"><p class="nd-empty">Loading&hellip;</p></div>
      </div>`;
    document.body.appendChild(dropBox);
    document.documentElement.classList.add('join-open');
    const b = document.getElementById('bell'); if (b) b.setAttribute('aria-expanded', 'true');
    pushBack('notifdrop', closeDrop);
    dropBox.addEventListener('click', (e) => {
      if (!e.target.closest('.nd-panel')) { if (!popBack('notifdrop')) closeDrop(); return; }
      const fb = e.target.closest('[data-nd-follow]');
      if (fb) {
        e.stopPropagation();
        const id = fb.getAttribute('data-nd-follow');
        if (fb.disabled || !id) return;
        fb.disabled = true;
        writeFollow(id, true).then((ok) => {
          if (!ok) { fb.disabled = false; return; }
          followed.add(id);
          fb.textContent = 'Following'; fb.classList.add('is-on');
          bumpFollowers(id, 1);
        });
        return;
      }
      const row = e.target.closest('[data-nd-i]');
      if (!row) return;
      const go = dropTarget(dropRows[Number(row.getAttribute('data-nd-i'))]);
      if (!go) return;
      closeDrop();
      location.href = go;
    });
    paintBell();
    fillDrop();
  }

  function dropTarget(r) {
    if (!r) return '';
    if (!r.actor_id) return r.href || '';
    const who = faces[r.actor_id];
    if ((r.kind === 'follow' || r.kind === 'invite') && who && who.name) return '/feed-next/?who=' + encodeURIComponent(who.name);
    if (!r.post_key) return who && who.name ? '/feed-next/?who=' + encodeURIComponent(who.name) : '';
    let u = '/feed-next/?post=' + encodeURIComponent(r.post_key);
    if (r.comment_id) u += '&talk=1&c=' + encodeURIComponent(r.comment_id);
    u += '&from=n&k=' + encodeURIComponent(r.kind) + (who && who.name ? '&a=' + encodeURIComponent(who.name) : '');
    return u;
  }

  const ND_BADGE = {
    comment: '\u{1F4AC}', reply: '\u21A9\uFE0E', heart: '\u2665\uFE0E', heat: '\u{1F525}',
    mention: '@', follow: '+', invite: '\u{1F91D}'
  };

  function dropSays(r) {
    const what = r.post_key && r.post_key.startsWith('c-') ? 'card' : r.post_key && r.post_key.startsWith('r-') ? 'reward card' : r.post_key && r.post_key.startsWith('l-') ? 'Loop' : 'post';
    switch (r.kind) {
      case 'comment': return `commented on your ${what}`;
      case 'reply':   return 'replied to your comment';
      case 'heart':   return 'liked your comment';
      case 'heat':    return `gave your ${what} heat \u{1F525}`;
      case 'mention': return r.comment_id ? 'mentioned you in a comment' : `mentioned you in a ${what}`;
      case 'follow':  return 'started following you';
      case 'invite':  return 'joined from your invite \u{1F389}';
      default:        return ALERT_SAYS[r.kind] || 'did something';
    }
  }

  async function fillDrop() {
    const box = dropBox && dropBox.querySelector('.nd-rows');
    if (!box || !sb) return;
    let rows = [];
    try {
      const { data, error } = await sb.from('notifications')
        .select('id, actor_id, kind, post_key, comment_id, created_at, read_at, detail, href')
        .order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      rows = (data || []).filter(r => !r.actor_id || !blocked.has(r.actor_id));
    } catch (e) {
      box.innerHTML = `<p class="nd-empty">Could not load these right now.</p>`; return;
    }
    if (!rows.length) {
      box.innerHTML = `<p class="nd-empty">Nothing yet.<br>When somebody gives your posts heat, comments, or follows you, it shows up here.</p>`;
      await clearUnread(); return;
    }
    await facesFor([...new Set(rows.map(r => r.actor_id).filter(Boolean))]);
    const bodies = new Map();
    const cids = [...new Set(rows.map(r => r.comment_id).filter(Boolean))];
    const pIds = [...new Set(rows.map(r => r.post_key).filter(k => k && k.startsWith('p-')).map(k => k.slice(2)))];
    const cIds = [...new Set(rows.map(r => r.post_key).filter(k => k && k.startsWith('c-')).map(k => k.slice(2)))];
    const rIds = [...new Set(rows.map(r => r.post_key).filter(k => k && k.startsWith('r-')).map(k => k.slice(2)))];
    const lIds = [...new Set(rows.map(r => r.post_key).filter(k => k && k.startsWith('l-')).map(k => k.slice(2)))];
    const thumbs = new Map();
    await Promise.all([
      cids.length ? sb.from('post_comments').select('id, body').in('id', cids)
        .then(({ data }) => (data || []).forEach(c => bodies.set(c.id, c.body)), () => {}) : null,
      pIds.length ? sb.from('user_photos').select('id, object_key').in('id', pIds)
        .then(({ data }) => (data || []).forEach(x => thumbs.set('p-' + x.id, photoUrl(x.object_key))), () => {}) : null,
      cIds.length ? sb.from('user_cards').select('id, photo_key, image_url').in('id', cIds)
        .then(({ data }) => (data || []).forEach(x => thumbs.set('c-' + x.id, photoUrl(x.photo_key) || x.image_url || '')), () => {}) : null,
      rIds.length ? sb.from('user_reward_cards').select('id, reward_cards(thumb_url)').in('id', rIds)
        .then(({ data }) => (data || []).forEach(x => thumbs.set('r-' + x.id, (x.reward_cards && x.reward_cards.thumb_url) || '')), () => {}) : null,
      lIds.length ? sb.from('user_loops').select('id, video_guid').in('id', lIds)
        .then(({ data }) => (data || []).forEach(x => thumbs.set('l-' + x.id, 'https://vz-bf34e88b-2d7.b-cdn.net/' + x.video_guid + '/thumbnail.jpg')), () => {}) : null
    ]);
    if (!dropBox) return;
    dropRows = rows;
    const one = (r, i) => {
      const system = !r.actor_id;
      const who = system ? null : faces[r.actor_id];
      const name = (who && who.name) || 'Somebody';
      const line = system
        ? (ALERT_SYSTEM[r.kind] ? ALERT_SYSTEM[r.kind](r.detail) : esc(r.detail || ''))
        : `<b>${esc(at(name))}</b> ${esc(dropSays(r))}`;
      const said = bodies.get(r.comment_id) || '';
      const badge = ND_BADGE[r.kind] ? `<span class="nd-k nd-k-${r.kind}" aria-hidden="true">${ND_BADGE[r.kind]}</span>` : '';
      const face = system
        ? `<span class="nd-face is-app">${ALERT_MARK[r.kind] || ALERT_MARK.dex}</span>`
        : `<span class="nd-face">${who && who.avatar ? `<img src="${esc(who.avatar)}" alt="" onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">` : esc(initialsFor(name))}${badge}</span>`;
      const th = thumbs.get(r.post_key || '');
      const followBack = !system && (r.kind === 'follow' || r.kind === 'invite') && r.actor_id && !following(r.actor_id)
        ? `<span role="button" tabindex="0" class="nd-fb" data-nd-follow="${esc(r.actor_id)}">Follow back</span>` : '';
      return `<button type="button" class="nd-row${r.read_at ? '' : ' is-new'}" data-nd-i="${i}">
          ${face}
          <span class="nd-txt"><span class="nd-line">${line}${said ? `: <q>${esc(said.length > 90 ? said.slice(0, 88) + '…' : said)}</q>` : ''}</span>
            <small>${esc(agoShort(r.created_at))}</small></span>
          ${followBack || (th ? `<img class="nd-thumb" src="${esc(th)}" alt="" loading="lazy" onerror="this.remove()">` : '')}
          ${r.read_at ? '' : '<i class="nd-dot" aria-label="new"></i>'}
        </button>`;
    };
    const fresh = rows.map((r, i) => [r, i]).filter(([r]) => !r.read_at);
    const older = rows.map((r, i) => [r, i]).filter(([r]) => r.read_at);
    box.innerHTML =
      (fresh.length ? `<h4 class="nd-sec">NEW</h4>` + fresh.map(([r, i]) => one(r, i)).join('') : '') +
      (older.length ? `<h4 class="nd-sec">EARLIER</h4>` + older.map(([r, i]) => one(r, i)).join('') : '');
    await clearUnread();
  }

  /* ======================================================================
     SHARE TO YOUR STORY -- social pack #4, 27 Sep 2026.
     SHARE on a photo or card post opens two choices: the story picture
     (1080 x 1920: the photo, @name, caption, and a QR code back to the
     post) or the plain link. The picture is built the moment the sheet
     opens, because an iPhone throws away a share that starts too long
     after the tap -- so by the time they tap, the file is ready.
     ====================================================================== */
  const STORY_W = 1080, STORY_H = 1920;
  function wrapLines(x, text, maxW, maxLines) {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
    const out = []; let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (x.measureText(t).width <= maxW) { line = t; continue; }
      if (line) out.push(line);
      line = w;
      if (out.length === maxLines) break;
    }
    if (out.length < maxLines && line) out.push(line);
    if (out.length === maxLines && words.join(' ').length > out.join(' ').length) {
      let last = out[maxLines - 1];
      while (last && x.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      out[maxLines - 1] = last + '…';
    }
    return out.slice(0, maxLines);
  }

  /* Two shapes. STORY is 9:16 for stories; POST is 4:5, Instagram's feed
     size, laid out tighter so nothing important sits where a crop would cut. */
  const SHAPES = {
    story: { W: 1080, H: 1920, mark: 230, markSize: 34, logoY: 128, top: 290, maxH: 980, nameGap: 90, nameSize: 58,
             capLines: 2, capSize: 38, qy: 1530, qs: 250, qx: 110, t1: 46, t2: 34 },
    post:  { W: 1080, H: 1350, mark: 76,  markSize: 28, logoY: 0,   top: 112, maxH: 720, nameGap: 74, nameSize: 50,
             capLines: 1, capSize: 34, qy: 1080, qs: 200, qx: 150, t1: 40, t2: 30 }
  };
  async function storyImage(post, shape) {
    const L = SHAPES[shape] || SHAPES.story;
    const STORY_W = L.W, STORY_H = L.H;
    const src = post.querySelector('.frame figure img').currentSrc || post.querySelector('.frame figure img').src;
    const img = await loadImage(src);
    const owner = post.getAttribute('data-owner') || '';
    const nameB = post.querySelector('.caption b, .post-top .who b, .post-top b');
    const name = at((faces[owner] && faces[owner].name) || '') || (nameB && nameB.textContent.trim()) || 'A collector';
    const capEl = post.querySelector('.caption .cap-t') || post.querySelector('.caption');
    let cap = capEl ? capEl.textContent.trim() : '';
    if (!post.querySelector('.caption .cap-t') && capEl) {
      const b = capEl.querySelector('b'); if (b) cap = cap.replace(b.textContent, '').trim();
    }
    const link = post.getAttribute('data-link') || location.origin;
    let qrCanvas = null;
    try { const lib = await loadQrLib(); qrCanvas = document.createElement('canvas'); drawQR(lib, link, qrCanvas, L.qs); } catch (_) {}
    let logo = null;
    try { logo = await loadImage(location.origin + '/assets/logo.webp'); } catch (_) {}

    const c = document.createElement('canvas');
    c.width = STORY_W; c.height = STORY_H;
    const x = c.getContext('2d');
    const mid = STORY_W / 2;
    x.fillStyle = '#04070f'; x.fillRect(0, 0, STORY_W, STORY_H);
    const g1 = x.createRadialGradient(170, 260, 20, 170, 260, 900 * STORY_H / 1920 + 300);
    g1.addColorStop(0, 'rgba(255,138,0,.30)'); g1.addColorStop(1, 'rgba(255,138,0,0)');
    x.fillStyle = g1; x.fillRect(0, 0, STORY_W, STORY_H);
    const g2 = x.createRadialGradient(930, STORY_H * 0.78, 20, 930, STORY_H * 0.78, 900 * STORY_H / 1920 + 300);
    g2.addColorStop(0, 'rgba(229,46,113,.28)'); g2.addColorStop(1, 'rgba(229,46,113,0)');
    x.fillStyle = g2; x.fillRect(0, 0, STORY_W, STORY_H);

    /* top: the wordmark (Instagram puts its own bar over the first ~150px) */
    x.textAlign = 'center';
    setType(x, '900', L.markSize, 9);
    x.fillStyle = '#e9f0fa';
    x.fillText('INFINITE PULLS', mid, L.mark);

    /* the picture, as big as fits, never cropped */
    const maxW = 920, maxH = L.maxH, top = L.top;
    const k = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const ix = Math.round((STORY_W - w) / 2), iy = top + Math.round((maxH - h) / 2);
    x.save(); x.shadowColor = 'rgba(0,0,0,.75)'; x.shadowBlur = 60; x.shadowOffsetY = 24;
    roundRect(x, ix, iy, w, h, 36); x.fillStyle = '#04070f'; x.fill(); x.restore();
    x.save(); roundRect(x, ix, iy, w, h, 36); x.clip(); x.drawImage(img, ix, iy, w, h); x.restore();
    x.lineWidth = 4; x.strokeStyle = 'rgba(255,138,0,.7)'; roundRect(x, ix, iy, w, h, 36); x.stroke();

    /* who, and what they said */
    let y = top + maxH + L.nameGap;
    setType(x, '900', L.nameSize, -0.5);
    x.fillStyle = '#ffffff';
    x.fillText(name, mid, y);
    if (cap) {
      setType(x, '500', L.capSize, 0);
      x.fillStyle = 'rgba(233,240,250,.85)';
      y += 10;
      wrapLines(x, cap, 900, L.capLines).forEach((ln) => { y += Math.round(L.capSize * 1.42); x.fillText(ln, mid, y); });
    }

    /* the way back: QR on the left, the words on the right */
    const qy = L.qy, qs = L.qs;
    if (qrCanvas) {
      const qx = L.qx;
      roundRect(x, qx - 14, qy - 14, qs + 28, qs + 28, 26); x.fillStyle = '#fff'; x.fill();
      x.imageSmoothingEnabled = false;
      x.drawImage(qrCanvas, qx, qy, qs, qs);
      x.imageSmoothingEnabled = true;
      x.textAlign = 'left';
      const tx = qx + qs + 60, u = qs / 250;
      setType(x, '900', L.t1, 0); x.fillStyle = '#ffffff';
      x.fillText('Scan to see it', tx, qy + 78 * u);
      setType(x, '600', L.t2, 0); x.fillStyle = 'rgba(233,240,250,.8)';
      x.fillText('Track your Pokémon cards', tx, qy + 138 * u);
      x.fillText('& share your pulls', tx, qy + 180 * u);
      setType(x, '900', L.t2, 1); x.fillStyle = '#ff9a3c';
      x.fillText('infinitepulls.com', tx, qy + 238 * u);
      x.textAlign = 'center';
    } else {
      setType(x, '900', 44, 1); x.fillStyle = '#ff9a3c';
      x.fillText('infinitepulls.com', mid, qy + 120);
    }
    if (logo && L.logoY) { try { x.drawImage(logo, mid - 32, L.logoY, 64, 64); } catch (_) {} }

    return await new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('no picture')), 'image/jpeg', 0.9));
  }

  function openShareSheet(post) {
    const link = post.getAttribute('data-link') || location.href;
    const box = sheet('Share', `
      <button type="button" class="more-row share-story" data-sh-pic="story" disabled>\u{1F4F8} Share to your story <small>Getting it ready\u2026</small></button>
      <button type="button" class="more-row share-story" data-sh-pic="post" disabled>\u{1F5BC}\uFE0F Share as a post <small>Getting it ready\u2026</small></button>
      <button type="button" class="more-row share-story" data-sh-link>\u{1F517} Share link <small>Text it, DM it, paste it anywhere</small></button>`);
    const files = {};
    const ready = { story: 'Tall picture for stories \u2014 Instagram, TikTok, Facebook', post: 'Feed-size picture \u2014 nothing gets cropped' };
    ['story', 'post'].forEach((k) => {
      const btn = box.querySelector(`[data-sh-pic="${k}"]`);
      storyImage(post, k).then((blob) => {
        files[k] = new File([blob], `infinite-pulls-${k}.jpg`, { type: 'image/jpeg' });
        if (!btn.isConnected) return;
        btn.disabled = false;
        btn.querySelector('small').textContent = ready[k];
      }).catch(() => {
        if (!btn.isConnected) return;
        btn.querySelector('small').textContent = 'Could not make the picture for this one';
      });
    });
    box.addEventListener('click', async (e) => {
      if (e.target.closest('[data-sh-link]')) {
        leaveSheet();
        if (navigator.share) { navigator.share({ url: link }).catch(() => {}); return; }
        try { await navigator.clipboard.writeText(link); popSay('Link copied.'); } catch (_) {}
        return;
      }
      const pick = e.target.closest('[data-sh-pic]');
      const file = pick && files[pick.getAttribute('data-sh-pic')];
      if (file) {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).catch(() => {});
          leaveSheet();
          return;
        }
        /* a computer: hand them the picture */
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file); a.download = file.name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        popSay('Picture saved.');
        leaveSheet();
      }
    });
  }

  /* ======================================================================
     PROFILE SCORE -- 27 Sep 2026 (Mike). "Your profile is 50% complete",
     and every missing piece is one tap from the screen that fixes it.
       picture 20 · bio 15 · first card or post 25 · follow 3 people 15
       · a collecting goal 10 · a social link 15            = 100
     Shown as a card at the top of the feed (the next step, and SEE ALL)
     and as a chip on your own profile. Both go away at 100%.
     ====================================================================== */
  const GS_SNOOZE = 'ip-getstarted-snooze-v1';
  let scoreCache = null;
  async function profileScore(force) {
    if (!sb || !me) return null;
    if (scoreCache && !force) return scoreCache;
    const head = { count: 'exact', head: true };
    let pr = {}, cards = 0, hello = 0, photos = 0, joined = 0;
    try {
      const [a, cd, hi, ph, u] = await Promise.all([
        sb.from('profiles').select('avatar_url, bio, tagline, username').eq('id', me).maybeSingle(),
        sb.from('user_cards').select('id', head).eq('user_id', me),
        sb.from('user_photos').select('id', head).eq('user_id', me).eq('is_intro', true),
        sb.from('user_photos').select('id', head).eq('user_id', me),
        sb.auth.getUser()
      ]);
      pr = a.data || {};
      cards = cd.count || 0; hello = hi.error ? 0 : (hi.count || 0);
      photos = ph.count || 0;
      joined = Date.parse((u.data && u.data.user && u.data.user.created_at) || '') || 0;
    } catch (_) { return null; }
    /* SAY HI is only for someone NEW (joined in the last 30 days) who has
       not posted a photo yet -- anyone who already posted has introduced
       themselves (Mike, 27 Sep). Everybody else gets four steps. */
    const newbie = joined && (Date.now() - joined) < 30 * 864e5;
    const offerHi = hello > 0 || (newbie && photos === 0);
    const steps = [
      { k: 'photo',   w: 20, done: !!pr.avatar_url, title: 'Add a profile picture', sub: 'You, your mascot, your favorite card — anything goes', btn: 'ADD' },
      { k: 'bio',     w: 20, done: !!(pr.bio && pr.bio.trim()), title: 'Write a short bio', sub: 'One line is plenty', btn: 'WRITE' },
      { k: 'tagline', w: 20, done: !!(pr.tagline && pr.tagline.trim()), title: 'Claim your badge & tagline', sub: 'Free for everyone who joins before 2027', btn: 'CLAIM' },
      { k: 'card',    w: 20, done: cards > 0, title: 'Add your first card', sub: 'Scan one, or bring your whole collection over', btn: 'SCAN', alt: { k: 'import', btn: 'IMPORT' } },
      { k: 'sayhi',   w: 20, done: hello > 0, title: 'Say hi \u{1F44B}', sub: 'We made you a hello post — one tap', btn: 'SAY HI' }
    ].filter(x => x.k !== 'sayhi' || offerHi);
    steps.forEach(x => { x.w = 100 / steps.length; });
    const pct = Math.round(steps.reduce((t, x) => t + (x.done ? x.w : 0), 0));
    scoreCache = { pct, steps };
    return scoreCache;
  }
  const ring = (pct, size) => {
    const r = size / 2 - 4, c = 2 * Math.PI * r;
    return `<svg class="ps-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <defs><linearGradient id="psg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a00"/><stop offset="1" stop-color="#e52e71"/></linearGradient></defs>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#eef1f5" stroke-width="6"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#psg)" stroke-width="6" stroke-linecap="round"
        stroke-dasharray="${(c * pct / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="53%" text-anchor="middle" dominant-baseline="middle" font-size="${size * 0.27}" font-weight="900" fill="#0d1725" font-family="system-ui,sans-serif">${pct}%</text>
    </svg>`;
  };

  async function paintGetStarted() {
    const box = document.getElementById('getstarted');
    if (!box || !sb || !me) return;
    try { const z = Number(localStorage.getItem(GS_SNOOZE) || 0); if (z && Date.now() < z) return; } catch (_) {}
    const sc = await profileScore();
    if (!sc || sc.pct >= 100) return;
    const next = sc.steps.find(x => !x.done);
    const left = sc.steps.filter(x => !x.done).length;
    box.innerHTML = `
      <button type="button" class="gs-x" data-gs-snooze aria-label="Hide for now">&times;</button>
      <div class="ps-top">${ring(sc.pct, 64)}
        <div><h3>Your profile is ${sc.pct}% done</h3><small>${left} quick ${left === 1 ? 'step' : 'steps'} left \u2014 each takes a few seconds</small></div></div>
      <div class="gs-step"><span class="gs-num">→</span>
        <span class="gs-txt"><b>${esc(next.title)}</b><small>${esc(next.sub)}</small></span>
        <span class="gs-btns"><button type="button" class="gs-go" data-ps-go="${next.k}">${next.btn}</button>${next.alt ? `<button type="button" class="gs-go gs-alt" data-ps-go="${next.alt.k}">${next.alt.btn}</button>` : ''}</span></div>
      <button type="button" class="ps-all" data-ps-all>See all steps</button>`;
    box.hidden = false;
  }

  let psBox = null;
  function closeChecklist() { if (psBox) { psBox.remove(); psBox = null; document.documentElement.classList.remove('join-open'); } }
  async function openChecklist() {
    if (psBox) return;
    const sc = await profileScore(true);
    if (!sc) return;
    psBox = document.createElement('div');
    psBox.className = 'flist pscheck';
    psBox.setAttribute('role', 'dialog');
    psBox.innerHTML = `<div class="fl-card"><div class="ps-body">
        <div class="ps-top">${ring(sc.pct, 72)}<div><h3>Your profile is ${sc.pct}% done</h3>
          <small>${sc.pct >= 100 ? 'All done. Nice.' : 'Tap a step to finish it'}</small></div></div>
        ${sc.steps.map((x, i) => `<div class="gs-step${x.done ? ' is-done' : ''}">
            <span class="gs-num">${x.done ? '✓' : i + 1}</span>
            <span class="gs-txt"><b>${esc(x.title)}</b><small>${esc(x.sub)}</small></span>
            ${x.done ? '<span class="gs-ok">Done</span>' : `<span class="gs-btns"><button type="button" class="gs-go" data-ps-go="${x.k}">${x.btn}</button>${x.alt ? `<button type="button" class="gs-go gs-alt" data-ps-go="${x.alt.k}">${x.alt.btn}</button>` : ''}</span>`}
          </div>`).join('')}
      </div></div>`;
    document.body.appendChild(psBox);
    document.documentElement.classList.add('join-open');
    pushBack('pscheck', closeChecklist);
    psBox.addEventListener('click', (e) => { if (!e.target.closest('.fl-card')) { if (!popBack('pscheck')) closeChecklist(); } });
  }

  async function goStep(k) {
    if (psBox) { if (!popBack('pscheck')) closeChecklist(); await new Promise(r => setTimeout(r, 80)); }
    scoreCache = null;                       /* re-count next time it is drawn */
    if (k === 'card') { location.href = '/?page=lookup&scan=1'; return; }
    if (k === 'import') { location.href = '/?page=collection&import=1'; return; }
    if (k === 'sayhi') { openSayHi(); return; }
    /* photo, bio, tagline: all on Edit profile */
    try {
      const BASE = 'id, username, avatar_url, bio, tagline, verified_at';
      const MORE = ', display_name, instagram, tiktok, whatnot, collectr, dex, collection_value, show_price';
      let r = await sb.from('profiles').select(BASE + MORE).eq('id', me).limit(1);
      if (r.error && missingColumn(r.error)) r = await sb.from('profiles').select(BASE).eq('id', me).limit(1);
      const p = (r.data || [])[0];
      if (p) openEditProfile(p);
    } catch (_) {}
  }

  /* the chip on your own profile */
  async function paintScoreChip(box) {
    const sc = await profileScore(true);
    if (!sc || sc.pct >= 100 || !box.isConnected) return;
    let chips = box.querySelector('.ph-chips');
    if (!chips) {
      chips = document.createElement('div'); chips.className = 'ph-chips';
      const after = box.querySelector('.ph-soc') || box.querySelector('.prof-bio') || box.querySelector('.ph-tag') || box.querySelector('.ph-top');
      after.insertAdjacentElement('afterend', chips);
    }
    chips.insertAdjacentHTML('afterbegin', `<button type="button" class="ph-score" data-ps-all>Profile ${sc.pct}% complete &rsaquo;</button>`);
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-gs-snooze]')) {
      try { localStorage.setItem(GS_SNOOZE, String(Date.now() + 3 * 864e5)); } catch (_) {}
      const b = document.getElementById('getstarted'); if (b) b.hidden = true;
      return;
    }
    const go = e.target.closest('[data-ps-go]');
    if (go) { e.preventDefault(); goStep(go.getAttribute('data-ps-go')); return; }
    if (e.target.closest('[data-ps-all]')) { e.preventDefault(); openChecklist(); }
  });

  /* ======================================================================
     SAY HI -- 27 Sep 2026 (Mike: "very friendly and easy, the least
     intimidating as possible"). The last profile step. A hello picture is
     made FOR them -- photo in the gradient ring, JUST JOINED, @name, their
     tagline, their first card, and their profile QR (no words by it, Mike)
     -- with the caption already written. One button posts it; nothing goes
     up unless they tap. Afterwards: "share it to your story too?"
     ====================================================================== */
  async function helloImage() {
    const W = 1080, H = 1350;
    const { data: pr } = await sb.from('profiles').select('username, avatar_url, tagline').eq('id', me).maybeSingle();
    const name = (pr && pr.username) || (faces[me] && faces[me].name) || 'collector';
    let face = null, card = null, qr = null, logo = null;
    try { if (pr && pr.avatar_url) face = await loadImage(pr.avatar_url); } catch (_) {}
    try {
      const { data } = await sb.from('user_cards').select('photo_key, image_url').eq('user_id', me)
        .order('added_at', { ascending: true }).limit(1);
      const c = data && data[0];
      const src = c && (photoUrl(c.photo_key) || c.image_url);
      if (src) card = await loadImage(src);
    } catch (_) {}
    try { const lib = await loadQrLib(); qr = document.createElement('canvas'); drawQR(lib, QR_HOST + name, qr, 230); } catch (_) {}
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); const mid = W / 2;
    x.fillStyle = '#04070f'; x.fillRect(0, 0, W, H);
    const g1 = x.createRadialGradient(200, 200, 20, 200, 200, 900); g1.addColorStop(0, 'rgba(255,138,0,.34)'); g1.addColorStop(1, 'rgba(255,138,0,0)');
    x.fillStyle = g1; x.fillRect(0, 0, W, H);
    const g2 = x.createRadialGradient(900, 1150, 20, 900, 1150, 900); g2.addColorStop(0, 'rgba(229,46,113,.32)'); g2.addColorStop(1, 'rgba(229,46,113,0)');
    x.fillStyle = g2; x.fillRect(0, 0, W, H);
    const holo = x.createLinearGradient(0, 0, W, 0);
    ['#ff8a00', '#ffd23f', '#3ee0a4', '#39b8ff', '#a970ff', '#e52e71'].forEach((col, i) => holo.addColorStop(i / 5, col));
    x.fillStyle = holo; x.fillRect(0, 0, W, 16);
    x.textAlign = 'center';
    setType(x, '900', 30, 9); x.fillStyle = '#e9f0fa'; x.fillText('INFINITE PULLS', mid, 92);
    /* the face, in the ring */
    const R = 210, cy = 370;
    const ringG = x.createLinearGradient(mid - R, cy - R, mid + R, cy + R);
    ringG.addColorStop(0, '#ff8a00'); ringG.addColorStop(.5, '#ffd23f'); ringG.addColorStop(1, '#e52e71');
    x.beginPath(); x.arc(mid, cy, R + 16, 0, Math.PI * 2); x.fillStyle = ringG; x.fill();
    x.beginPath(); x.arc(mid, cy, R + 2, 0, Math.PI * 2); x.fillStyle = '#04070f'; x.fill();
    x.save(); x.beginPath(); x.arc(mid, cy, R - 10, 0, Math.PI * 2); x.clip();
    if (face) {
      const k = Math.max((2 * R) / face.naturalWidth, (2 * R) / face.naturalHeight);
      const w = face.naturalWidth * k, h = face.naturalHeight * k;
      x.drawImage(face, mid - w / 2, cy - h / 2, w, h);
    } else {
      x.fillStyle = '#1b2a44'; x.fillRect(mid - R, cy - R, 2 * R, 2 * R);
      setType(x, '900', 170, 0); x.fillStyle = '#ffffff'; x.fillText(name.slice(0, 1).toUpperCase(), mid, cy + 60);
    }
    x.restore();
    x.font = '120px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; x.fillText('\u{1F44B}', mid + 185, cy + 185);
    /* words */
    setType(x, '900', 40, 8); x.fillStyle = '#ff9a3c'; x.fillText('JUST JOINED', mid, 690);
    setType(x, '900', 84, -1); x.fillStyle = '#ffffff';
    let big = '@' + name; while (x.measureText(big).width > 960 && parseInt(x.font) > 40) setType(x, '900', parseInt(x.font) - 4, -1);
    x.fillText(big, mid, 790);
    if (pr && pr.tagline) {
      setType(x, '500', 40, 0); x.fillStyle = 'rgba(233,240,250,.85)';
      wrapLines(x, '“' + pr.tagline + '”', 900, 2).forEach((ln, i) => x.fillText(ln, mid, 860 + i * 52));
    }
    /* QR bottom left, card bottom right */
    if (qr) {
      roundRect(x, 70, 1040, 250, 250, 24); x.fillStyle = '#fff'; x.fill();
      x.imageSmoothingEnabled = false; x.drawImage(qr, 80, 1050, 230, 230); x.imageSmoothingEnabled = true;
    }
    if (card) {
      const ch = 300, cw = Math.round(ch * card.naturalWidth / card.naturalHeight);
      x.save(); x.translate(W - 110 - cw / 2, 1160); x.rotate(0.14);
      x.shadowColor = 'rgba(0,0,0,.7)'; x.shadowBlur = 40; x.shadowOffsetY = 14;
      roundRect(x, -cw / 2 - 6, -ch / 2 - 6, cw + 12, ch + 12, 16); x.fillStyle = '#fff'; x.fill();
      x.shadowColor = 'transparent';
      x.save(); roundRect(x, -cw / 2, -ch / 2, cw, ch, 12); x.clip(); x.drawImage(card, -cw / 2, -ch / 2, cw, ch); x.restore();
      x.restore();
    }
    return await new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('no picture')), 'image/jpeg', 0.9));
  }

  let hiBox = null;
  function closeSayHi() { if (hiBox) { hiBox.remove(); hiBox = null; document.documentElement.classList.remove('join-open'); } }
  async function openSayHi() {
    if (!me || hiBox) return;
    hiBox = document.createElement('div');
    hiBox.className = 'sayhi';
    hiBox.setAttribute('role', 'dialog');
    hiBox.innerHTML = `
      <header class="sh-top"><button type="button" data-sh-no>Not now</button><b>Say hi \u{1F44B}</b><span></span></header>
      <div class="sh-scroll">
        <p class="sh-hint">We made you a hello post. Share it and people will welcome you in.</p>
        <div class="sh-pic"><p class="sh-wait">Making your picture…</p></div>
        <textarea class="sh-cap" maxlength="300" rows="2">Hey, I'm new here! \u{1F44B}</textarea>
        <p class="sh-say" hidden></p>
        <button type="button" class="sh-go" data-sh-go disabled>SAY HI</button>
        <p class="sh-small">You can change the caption, or skip for now.</p>
      </div>`;
    document.body.appendChild(hiBox);
    document.documentElement.classList.add('join-open');
    pushBack('sayhi', closeSayHi);
    let blob = null, dataUrl = '';
    try {
      blob = await helloImage();
      dataUrl = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result || '')); fr.readAsDataURL(blob); });
      if (!hiBox) return;
      hiBox.querySelector('.sh-pic').innerHTML = `<img alt="Your hello picture" src="${dataUrl}">`;
      hiBox.querySelector('[data-sh-go]').disabled = false;
    } catch (_) {
      if (hiBox) hiBox.querySelector('.sh-pic').innerHTML = '<p class="sh-wait">Could not make the picture right now. Try again in a bit.</p>';
    }
    hiBox && hiBox.addEventListener('click', async (e) => {
      if (e.target.closest('[data-sh-no]')) { if (!popBack('sayhi')) closeSayHi(); return; }
      const story = e.target.closest('[data-sh-story]');
      if (story && blob) {
        const file = new File([blob], 'infinite-pulls-hello.jpg', { type: 'image/jpeg' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file] }).catch(() => {});
        return;
      }
      const done = e.target.closest('[data-sh-done]');
      if (done) { location.href = done.getAttribute('data-sh-done'); return; }
      const go = e.target.closest('[data-sh-go]');
      if (!go || go.disabled || !dataUrl) return;
      go.disabled = true; go.textContent = 'POSTING…';
      const say = hiBox.querySelector('.sh-say');
      try {
        const CP = window.InfinitePullsCardPhoto;
        if (!CP || !CP.keep) throw new Error('Photo storage is not ready. Try again in a moment.');
        const key = await CP.keep(dataUrl, 'me');
        if (!key) throw new Error('The upload did not go through. Try again.');
        const caption = (hiBox.querySelector('.sh-cap').value || '').trim() || null;
        const { data: made, error } = await sb.from('user_photos')
          .insert({ user_id: me, object_key: key, caption, is_intro: true }).select('id').single();
        if (error) throw new Error(error.message || 'Could not post it.');
        scoreCache = null;
        const link = '/feed-next/?post=p-' + encodeURIComponent(made.id);
        hiBox.querySelector('.sh-scroll').innerHTML = `
          <div class="sh-yay">\u{1F389}</div>
          <h3 class="sh-h">You're in!</h3>
          <p class="sh-hint">Your hello post is up. People can welcome you right on it.</p>
          <button type="button" class="sh-go" data-sh-story>\u{1F4F8} Share it to your story too</button>
          <button type="button" class="sh-alt" data-sh-done="${esc(link)}">See my post</button>`;
      } catch (err) {
        say.hidden = false; say.textContent = (err && err.message) || 'That did not work. Try again.';
        go.disabled = false; go.textContent = 'SAY HI';
      }
    });
  }

  /* SAY WELCOME -- one tap under a hello post: a real comment from you,
     "Welcome to Infinite Pulls! 👋". Once per person per post. */
  const WELCOME = 'Welcome to Infinite Pulls! \u{1F44B}';
  async function paintWelcomes() {
    if (!sb || !me) return;
    const btns = [...document.querySelectorAll('[data-welcome]:not([data-wchecked])')];
    if (!btns.length) return;
    btns.forEach(b => b.setAttribute('data-wchecked', '1'));
    try {
      const keys = btns.map(b => 'p-' + b.getAttribute('data-welcome'));
      const { data } = await sb.from('post_comments').select('post_key').eq('user_id', me).in('post_key', keys).eq('body', WELCOME);
      const said = new Set((data || []).map(x => x.post_key));
      btns.forEach(b => { if (said.has('p-' + b.getAttribute('data-welcome'))) { b.classList.add('is-done'); b.textContent = '\u{1F44B} Welcomed'; } });
    } catch (_) {}
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-welcome]');
    if (!b) return;
    e.preventDefault();
    if (!me) { showJoin('Sign up to welcome new collectors.'); return; }
    if (b.classList.contains('is-done') || b.disabled) return;
    b.disabled = true;
    const key = 'p-' + b.getAttribute('data-welcome');
    try {
      const { error } = await sb.from('post_comments').insert({ post_key: key, post_owner: b.getAttribute('data-welcome-owner'), user_id: me, body: WELCOME });
      if (error) throw error;
      b.classList.add('is-done'); b.textContent = '\u{1F44B} Welcomed';
      talkRows.delete(key);
      talkCount.set(key, (talkCount.get(key) || 0) + 1);
      try { paintCounts(); } catch (_) {}
      const art = b.closest('.post');
      if (art) { try { await toggleTalk(art, true); } catch (_) {} }
    } catch (_) { b.disabled = false; popSay('That did not go through. Try again.'); }
  });

  /* The little (i) beside Collectr and Dex on Edit profile: opens the
     how-to under the field. preventDefault keeps the tap from jumping
     into the text box and popping the keyboard. */
  document.addEventListener('click', (e) => {
    const i = e.target.closest('[data-ep-info]');
    if (!i) return;
    e.preventDefault();
    const box = document.querySelector(`[data-ep-help="${i.getAttribute('data-ep-info')}"]`);
    if (box) { box.hidden = !box.hidden; i.classList.toggle('on', !box.hidden); }
  });

  /* ======================================================================
     HOT THIS WEEK -- social pack #8, 27 Sep 2026. See hot_this_week.sql.
     A sideways strip at the top of the main feed: the photo posts getting
     the most heat and comments from other people in the last 7 days. It
     stays hidden until there are at least 3, so an empty week never shows
     a sad half-strip. Tapping one opens the post in its own sheet, where
     heat and comments work like anywhere else; phone back closes it.
     ====================================================================== */
  let hotRows = [];
  async function paintHot() {
    const box = document.getElementById('hotwk');
    if (!box || !sb) return;
    try {
      const { data, error } = await sb.rpc('hot_this_week', { p_limit: 12 });
      if (error || !data) return;
      hotRows = data.filter(x => !blocked.has(x.user_id) && x.object_key);
      if (hotRows.length < 3) return;
      await facesFor([...new Set(hotRows.map(x => x.user_id))]);
      const keys = hotRows.map(x => 'p-' + x.id);
      try {
        const { data: hc } = await sb.from('post_heat_counts').select('post_key, n').in('post_key', keys);
        (hc || []).forEach(x => heatCount.set(x.post_key, Number(x.n) || 0));
      } catch (_) {}
      box.innerHTML = `<div class="hw-head"><span>\u{1F525} HOT THIS WEEK</span></div>
        <div class="hw-row">${hotRows.map((x, i) => {
          const f = faces[x.user_id] || {};
          const n = heatCount.get('p-' + x.id) || x.heat || 0;
          return `<button type="button" class="hw-tile" data-hot="${i}">
            <img src="${esc(photoUrl(x.object_key))}" alt="" loading="lazy">
            <span class="hw-rank">${i + 1}</span>
            <span class="hw-foot"><b>${esc(at(f.name || '') || 'collector')}</b><i>\u{1F525} ${nfmt(n)}</i></span>
          </button>`;
        }).join('')}</div>`;
      box.hidden = false;
    } catch (_) { /* no function yet: no strip */ }
  }

  let hotBox = null;
  function closeHot() { if (hotBox) { hotBox.remove(); hotBox = null; document.documentElement.classList.remove('join-open'); } }
  async function openHot(x) {
    closeHot();
    if (!x.extra_keys) {
      try {
        const { data } = await sb.from('user_photos').select('extra_keys').eq('id', x.id).maybeSingle();
        x.extra_keys = (data && data.extra_keys) || [];
      } catch (_) { x.extra_keys = []; }
    }
    const row = photoRow(x);
    hotBox = document.createElement('div');
    hotBox.className = 'hotview';
    hotBox.setAttribute('role', 'dialog');
    hotBox.innerHTML = `<div class="hv-card">${postHTML(row, 0)}</div>`;
    document.body.appendChild(hotBox);
    document.documentElement.classList.add('join-open');
    pushBack('hotview', closeHot);
    hotBox.querySelectorAll('.frame').forEach(f => { f.setAttribute('data-wired', '1'); try { wireRail(f); paintStrip(f, false); } catch (_) {} });
    hotBox.addEventListener('click', (e) => { if (!e.target.closest('.hv-card')) { if (!popBack('hotview')) closeHot(); } });
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-hot]');
    if (!t) return;
    const x = hotRows[Number(t.getAttribute('data-hot'))];
    if (x) { e.preventDefault(); openHot(x); }
  });

  /* ======================================================================
     GOALS, AS A FEED -- 27 Sep 2026 (Mike: "it just shows your goals in the
     feed style so you just swipe up to see your goals and progress").

     GOALS in the row (or the menu) turns the feed into your goals: one
     card per goal, scrolled like posts, with the row and the bottom bar
     still there -- the old Goals page was a separate page and a dead end.
     Each card: the goal, a big progress ring, the next few you still need,
     and Make primary / Remove. Below them, "Add a goal" cards for the
     ones you have not picked, and Create your own.

     Other people's goals show read-only on their profile (a Goals tab),
     using the same card. Goals are public (Mike: "not sensitive info").
     ====================================================================== */
  let goalsOpen = false;

  async function goalsFull() {
    const G = await goalsEngine();
    if (!G) return null;
    if (!window.InfinitePullsPokemonData) {
      try {
        await new Promise((ok, no) => {
          const el = document.createElement('script');
          el.src = '/components/pokemon-data.js';
          el.onload = ok; el.onerror = () => no(new Error('could not load'));
          document.head.appendChild(el);
        });
      } catch (_) { return null; }
    }
    return window.InfinitePullsPokemonData ? G : null;
  }

  function goalCardHTML(r, opts) {
    const o = opts || {};
    const g = r.eff || {};
    const pr = r.progress || {};
    const row = r.userGoal || {};
    const pct = Math.max(0, Math.min(100, Math.round(pr.pct || 0)));
    const done = !!pr.complete;
    const art = g.badgeImage && !/^(https?:)?\/\//.test(g.badgeImage) ? '/' + String(g.badgeImage).replace(/^\/+/, '') : g.badgeImage;
    const PD = window.InfinitePullsPokemonData;
    const next = (pr.missingDexIds || []).slice(0, 8);
    const ring = `<svg class="gc-ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="52" class="gc-track"/>
        <circle cx="60" cy="60" r="52" class="gc-fill" style="stroke-dasharray:${(pct / 100 * 326.7).toFixed(1)} 326.7"/></svg>`;
    const manual = g.goalType === 'custom_manual' && o.mine;
    return `
    <article class="post goalcard${done ? ' is-done' : ''}" data-goal="${esc(row.id || '')}">
      <header class="gc-top">
        <span class="gc-icon">${art ? `<img src="${esc(art)}" alt="">` : esc(g.icon || '\u{1F3AF}')}</span>
        <span class="gc-name"><b>${esc(g.name || 'Goal')}</b>${g.description ? `<small>${esc(g.description)}</small>` : ''}</span>
        ${row.is_primary ? '<span class="gc-tag">PRIMARY</span>' : ''}
      </header>
      <div class="gc-body">
        <div class="gc-dial">${ring}<span class="gc-pct">${done ? '✓' : (pr.total ? pct + '%' : esc(String(pr.current || 0)))}</span></div>
        <div class="gc-facts">
          <b>${esc(pr.primaryLabel || '')}</b>
          <span>${done ? 'Finished! \u{1F389}' : esc(pr.missingLabel ? pr.missingLabel + ' to go' : 'Keep going')}</span>
          ${pr.total ? `<span class="gc-bar"><i style="width:${pct}%"></i></span>` : ''}
        </div>
      </div>
      ${next.length && PD ? `<div class="gc-next"><small>NEXT UP</small><div>${next.map(id =>
          `<img src="${esc(PD.spriteUrl(id))}" alt="" loading="lazy" onerror="this.remove()">`).join('')}</div></div>` : ''}
      ${o.mine ? `<div class="gc-acts">
        ${manual ? `<button type="button" data-goal-step="-1">&minus;1</button><button type="button" data-goal-step="1">+1</button>` : ''}
        ${row.is_primary ? '' : `<button type="button" data-goal-primary>Make primary</button>`}
        <button type="button" class="gc-drop" data-goal-drop>Remove</button>
      </div>` : ''}
    </article>`;
  }

  function addCardHTML(t) {
    return `
    <article class="post goalcard is-add" data-goal-tpl="${esc(t.id)}">
      <header class="gc-top">
        <span class="gc-icon">${esc(t.icon || '\u{1F3AF}')}</span>
        <span class="gc-name"><b>${esc(t.name || 'Goal')}</b>${t.description ? `<small>${esc(t.description)}</small>` : ''}</span>
      </header>
      <div class="gc-acts"><button type="button" class="gc-add" data-goal-add="${esc(t.id)}">+ Add this goal</button></div>
    </article>`;
  }

  async function paintGoals() {
    const box = document.getElementById('goalsview');
    if (!box) return;
    const G = await goalsFull();
    if (!G) { box.innerHTML = '<div class="msg">Goals could not load. Try again in a moment.</div>'; return; }
    let picked = [], results = [], templates = [];
    try {
      [picked, templates] = await Promise.all([G.loadUserGoals(me, { forceRefresh: true }), G.loadGoalTemplates()]);
      const ctx = await G.buildContext(me);
      results = await G.computeAllProgress(me, picked, ctx);
      /* A goal that just crossed 100% gets written down (and its post goes
         out -- see the goal posts in the feed). */
      try { G.checkAndUpdateGoalCompletions(me); } catch (_) {}
    } catch (e) {
      box.innerHTML = `<div class="msg">Goals could not load: ${esc((e && e.message) || 'unknown')}</div>`;
      return;
    }
    if (!goalsOpen) return;
    results.sort((a, b) => (b.userGoal.is_primary ? 1 : 0) - (a.userGoal.is_primary ? 1 : 0));
    const have = new Set(picked.map(p => p.template_id).filter(Boolean));
    const addable = (templates || []).filter(t => t.enabled !== false && !t.auto_track && !have.has(t.id));
    box.innerHTML = `
      <h2 class="gv-h">${results.length ? 'My Goals' : 'Pick your first goal'}</h2>
      ${results.map(r => goalCardHTML(r, { mine: true })).join('')}
      ${addable.length ? `<h2 class="gv-h">Add a goal</h2>${addable.map(addCardHTML).join('')}` : ''}
      <article class="post goalcard is-add">
        <header class="gc-top"><span class="gc-icon">✏️</span>
          <span class="gc-name"><b>Create my own</b><small>Name it, set a number, count it up yourself.</small></span></header>
        <form class="gc-own" data-goal-own>
          <input name="name" maxlength="60" placeholder="What are you chasing?" required>
          <input name="target" type="number" min="1" max="100000" placeholder="Goal #" required>
          <button type="submit" class="gc-add">Add</button>
        </form>
      </article>`;
  }

  function openGoals() {
    if (!me) { showJoin('Sign up to set collecting goals.'); return; }
    if (goalsOpen) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    goalsOpen = true;
    let box = document.getElementById('goalsview');
    if (!box) { box = document.createElement('section'); box.id = 'goalsview'; feed.prepend(box); }
    box.innerHTML = '<div class="pg-wait">Loading your goals&hellip;</div>';
    feed.classList.add('is-goals');
    window.scrollTo(0, 0);
    pushBack('goals', () => closeGoals(false));
    paintRail();
    paintGoals();
  }

  function closeGoals(viaNarrow) {
    if (!goalsOpen) return;
    goalsOpen = false;
    feed.classList.remove('is-goals');
    const box = document.getElementById('goalsview');
    if (box) box.remove();
    /* Leaving by some other door (ME, a name) takes the back entry off too. */
    if (viaNarrow) popBack('goals');
    paintRail();
  }

  async function gridGoals(grid, id) {
    const G = await goalsFull();
    if (!G) { grid.innerHTML = '<div class="pg-empty">Goals could not load.</div>'; return; }
    try {
      const picked = await G.loadUserGoals(id, { forceRefresh: true });
      const ctx = await G.buildContext(id);
      const results = await G.computeAllProgress(id, picked, ctx);
      if (paneOwner !== id || profTab !== 'goals') return;
      results.sort((a, b) => (b.userGoal.is_primary ? 1 : 0) - (a.userGoal.is_primary ? 1 : 0));
      grid.innerHTML = results.length
        ? `<div class="pg-goals">${results.map(r => goalCardHTML(r, { mine: false })).join('')}</div>`
        : '<div class="pg-empty">No goals yet.</div>';
    } catch (_) { grid.innerHTML = '<div class="pg-empty">Goals could not load.</div>'; }
  }

  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-open-goals]')) {
      e.preventDefault();
      if (overlay) { afterOverlay = openGoals; try { history.back(); } catch (_) { openGoals(); } return; }
      openGoals();
      return;
    }
    const card = e.target.closest('.goalcard');
    if (!card || !goalsOpen) return;
    const G = window.InfinitePullsCollectorGoals;
    if (!G || !me) return;
    const id = card.getAttribute('data-goal');
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    try {
      if (btn.hasAttribute('data-goal-add')) {
        btn.disabled = true; btn.textContent = 'Adding…';
        await G.selectGoal(me, btn.getAttribute('data-goal-add'));
      } else if (btn.hasAttribute('data-goal-primary')) {
        btn.disabled = true;
        await G.setPrimaryGoal(me, id);
      } else if (btn.hasAttribute('data-goal-drop')) {
        /* Two taps, no pop-up: the first one asks. */
        if (!btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = 'Tap again to remove'; setTimeout(() => { if (btn.isConnected) { delete btn.dataset.sure; btn.textContent = 'Remove'; } }, 3000); return; }
        btn.disabled = true;
        await G.deleteUserGoal(me, id);
      } else if (btn.hasAttribute('data-goal-step')) {
        const rows = await G.loadUserGoals(me);
        const row = rows.find(x => x.id === id);
        if (!row) return;
        const cur = Number((row.custom_config || {}).current) || 0;
        btn.disabled = true;
        await G.updateCustomManualCurrent(me, row, cur + Number(btn.getAttribute('data-goal-step')));
      } else return;
    } catch (err) {
      bellSay('That did not save: ' + ((err && err.message) || 'try again'), 'bad');
    }
    paintGoals();
  });

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-goal-own]');
    if (!f) return;
    e.preventDefault();
    const G = window.InfinitePullsCollectorGoals;
    if (!G || !me) return;
    const name = f.elements.name.value.trim(), target = f.elements.target.value;
    if (!name || !target) return;
    const b = f.querySelector('button'); if (b) { b.disabled = true; b.textContent = 'Adding…'; }
    try { await G.createCustomGoal(me, { name, target }); }
    catch (err) { bellSay('That did not save: ' + ((err && err.message) || 'try again'), 'bad'); }
    paintGoals();
  });

  /* ======================================================================
     THE RAIL -- 27 Sep 2026 (Mike, option A: "A all day").
     Facebook's row of icons, right under the top bar:

         ME    GOALS    NEW POSTS (12)    ALERTS (3)

     ME opens your own page. GOALS is the goals page. ALERTS is the
     notifications list, with the unread count the menu already had.
     NEW POSTS counts what other people have posted since you last opened
     the app on this phone, and opens a list of who -- tap a face, see
     their page. Guests get the join box on everything but NEW POSTS.
     ====================================================================== */
  const LAST_OPEN = 'ip-last-open-v1';
  let newSince = null;              /* the last open BEFORE this one */
  let newCount = 0;
  let newBy = [];                   /* [{ id, n }] newest poster first */

  (function stampOpen() {
    let prev = null;
    try { prev = localStorage.getItem(LAST_OPEN); } catch (_) {}
    /* First time on this phone: call the last three days "new". */
    newSince = prev || new Date(Date.now() - 3 * 86400000).toISOString();
    try { localStorage.setItem(LAST_OPEN, new Date().toISOString()); } catch (_) {}
  })();

  const RAIL_ICONS = {
    me:   '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    goal: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    invite: '<circle cx="9" cy="8" r="4"/><path d="M2 21c1.3-4 4-6 7-6s5.7 2 7 6"/><path d="M19 8v6M16 11h6"/>'
  };
  const railSvg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

  function buildRail() {
    if (document.getElementById('fbrail')) return;
    const top = document.querySelector('.stickytop .topbar');
    if (!top) return;
    const nav = document.createElement('nav');
    nav.id = 'fbrail';
    nav.className = 'fbrail';
    nav.setAttribute('aria-label', 'You');
    nav.innerHTML = `
      <button type="button" data-rail="me">${railSvg(RAIL_ICONS.me)}<span>ME</span></button>
      <button type="button" data-rail="goals">${railSvg(RAIL_ICONS.goal)}<span>GOALS</span></button>
      <button type="button" data-rail="new">${railSvg(RAIL_ICONS.news)}<i class="rb-n" hidden></i><span>NEW POSTS</span></button>
      <button type="button" data-rail="invite">${railSvg(RAIL_ICONS.invite)}<span>INVITE</span></button>`;
    top.insertAdjacentElement('afterend', nav);
    const st = document.querySelector('.stickytop');
    if (st) document.documentElement.style.setProperty('--stick', st.offsetHeight + 'px');
  }

  function paintRail() {
    const rail = document.getElementById('fbrail');
    if (!rail) return;
    const set = (k, n) => {
      const b = rail.querySelector(`[data-rail="${k}"] .rb-n`);
      if (!b) return;
      b.textContent = n > 99 ? '99+' : String(n);
      b.hidden = !(n > 0);
    };
    set('new', newCount);
    set('alerts', me ? unread : 0);
    /* ME is lit on your own page, the way a tab bar shows where you are. */
    const meBtn = rail.querySelector('[data-rail="me"]');
    if (meBtn) meBtn.classList.toggle('on', !goalsOpen && !!(me && filter && filter.kind === 'person' && filter.id === me));
    const gBtn = rail.querySelector('[data-rail="goals"]');
    if (gBtn) gBtn.classList.toggle('on', goalsOpen);
  }

  async function countNewPosts() {
    if (!sb || !newSince) return;
    const tally = new Map();       /* user_id -> { n, last } */
    const add = (rows) => (rows || []).forEach(r => {
      if (!r.user_id || r.user_id === me) return;
      const t = tally.get(r.user_id) || { n: 0, last: '' };
      t.n++; if (String(r.added_at) > t.last) t.last = String(r.added_at);
      tally.set(r.user_id, t);
    });
    try {
      const [cards, pics] = await Promise.all([
        sb.from('user_cards').select('user_id, added_at').gt('added_at', newSince).limit(1000),
        sb.from('user_photos').select('user_id, added_at').gt('added_at', newSince).limit(1000)
      ]);
      add(cards && cards.data); add(pics && pics.data);
    } catch (_) { return; }
    newBy = [...tally.entries()].map(([id, t]) => ({ id, n: t.n, last: t.last }))
      .sort((a, b) => b.last.localeCompare(a.last));
    newCount = newBy.reduce((s, x) => s + x.n, 0);
    paintRail();
  }

  /* The list of who posted. Built like the followers list: a white sheet
     from the bottom, the phone's back button closes it. */
  let newBox = null;
  function closeNew() { if (newBox) { newBox.remove(); newBox = null; document.documentElement.classList.remove('join-open'); } }
  async function openNew() {
    if (newBox) return;
    newBox = document.createElement('div');
    newBox.className = 'flist';
    newBox.setAttribute('role', 'dialog');
    newBox.innerHTML = `<div class="fl-card"><div class="fl-top"><b>New since you were last here</b></div>
      <div class="fl-rows"><p class="fl-wait">Loading&hellip;</p></div></div>`;
    document.body.appendChild(newBox);
    document.documentElement.classList.add('join-open');
    pushBack('newposts', closeNew);
    newBox.addEventListener('click', (e) => {
      const who = e.target.closest('[data-fl-go]');
      if (who) {
        const id = who.getAttribute('data-fl-go'), label = who.getAttribute('data-fl-name') || 'them';
        if (!popBack('newposts')) closeNew();
        setTimeout(() => goNarrow({ kind: 'person', id, label }), 60);
        return;
      }
      if (!e.target.closest('.fl-card')) { if (!popBack('newposts')) closeNew(); }
    });
    const ids = newBy.map(x => x.id).filter(id => !(id in faces));
    if (ids.length) await facesFor(ids);
    const box = newBox && newBox.querySelector('.fl-rows');
    if (!box) return;
    const rows = newBy.filter(x => faces[x.id]);
    box.innerHTML = rows.length ? rows.map(x => {
      const f = faces[x.id];
      return `<button type="button" class="fl-row" data-fl-go="${esc(x.id)}" data-fl-name="${esc(f.name || '')}">
        <img src="${esc(f.avatar || '/assets/hyde-bot.png')}" alt="" loading="lazy"
             onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">
        <span><b>${esc(at(f.name || ''))}</b><small>${x.n} new ${x.n === 1 ? 'post' : 'posts'} &middot; ${esc(agoShort(x.last))}</small></span>
      </button>`;
    }).join('') : `<p class="fl-wait">Nothing new since you were last here. Check back soon.</p>`;
    /* Seen. The number goes away until somebody posts again. */
    newCount = 0;
    paintRail();
  }

  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-rail]');
    if (!r) return;
    const k = r.getAttribute('data-rail');
    if (k === 'new') { e.preventDefault(); openNew(); return; }
    if (!me) {
      e.preventDefault();
      showJoin(k === 'invite' ? 'Sign up to invite your friends.'
             : k === 'alerts' ? 'Sign up to get your notifications.'
             : k === 'goals' ? 'Sign up to set collecting goals.' : 'Sign up to get your own page.');
      return;
    }
    if (k === 'me') {
      e.preventDefault();
      const who = faces[me];
      goNarrow({ kind: 'person', id: me, label: (who && who.name) || 'you' });
      return;
    }
    if (k === 'alerts') {
      e.preventDefault();
      openDrop();
      return;
    }
    if (k === 'invite') {
      e.preventDefault();
      openInvite();
      return;
    }
    if (k === 'goals') { e.preventDefault(); openGoals(); }
  });

  /* ======================================================================
     WORKS LIKE INSTAGRAM -- 27 Sep 2026. Mike: "if we claim that, we should
     work like it." Everything in here is the thing people's thumbs do
     without thinking, because that is what they do on every other feed.

       * DOUBLE-TAP a picture = heat (never takes heat away, same as a like)
       * every @name goes to that person's page: the caption's name, and
         @mentions typed into captions and comments
       * "Heat from @jeff and 12 others" under the buttons
       * "View all 8 comments" and the newest comment under the caption
       * followers / following open the list
       * FEED on the bottom bar, tapped on the feed, goes back to the top
       * pull down at the top to refresh
     ====================================================================== */

  const nfmt = (n) => Number(n || 0).toLocaleString();

  /* ---- @mentions ---- */
  /* ======================================================================
     SMART TAGS (Mike, 27 Sep 2026). Tappable labels under every card post,
     filled in from the card itself -- the Pokemon, the set, the rarity, the
     grade, the edition -- so nobody has to type a hashtag. #words typed in a
     caption or a card's story are tappable too. Tapping one narrows the feed
     to everything with that tag, the same way picking a search result does.
     ====================================================================== */
  const QUIET_RARITY = /^(common|uncommon|none|promo)$/i;

  /* "Team Rocket's Mewtwo ex" is a Mewtwo. The ex / V / VMAX / owner come off. */
  function pokemonOf(name) {
    let n = String(name || '').replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ').trim();
    n = n.replace(/^[A-Z][\w.'-]*(?:\s[A-Z][\w.'-]*)?['’]s\s+/, '');
    n = n.replace(/^(?:Radiant|Shining|Dark|Light|Mega|M|Shiny)\s+/i, '');
    for (let k = 0; k < 2; k++) {
      n = n.replace(/\s+(?:ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.?\s?X|Prime|LEGEND|δ|☆|Star)$/, '');
    }
    return n.trim();
  }

  function tagsFor(p) {
    if (!p || p.kind !== 'card') return [];
    const out = [];
    const add = (field, value, label) => {
      if (value && !out.some(t => t.field === field && t.value === value)) out.push({ field, value, label: label || value });
    };
    add('pokemon', pokemonOf(p.name));
    add('set', p.set);
    if (p.rarity && !QUIET_RARITY.test(p.rarity)) add('rarity', p.rarity);
    if (graderOf(p.cond)) add('grade', p.cond);
    add('edition', p.edition);
    return out;
  }

  function tagsHTML(p) {
    const tags = tagsFor(p);
    if (!tags.length) return '';
    return `<div class="stags">${tags.map((t, k) => `<button type="button" class="stag${k ? '' : ' lead'}"
        data-tag-field="${esc(t.field)}" data-tag-value="${esc(t.value)}">${esc(t.label)}</button>`).join('')}</div>`;
  }

  const tagFilter = (field, value) => field === 'pokemon'
    ? { kind: 'card', name: value, label: value }
    : { kind: 'tag', field, value, label: field === 'hash' ? '#' + value : value };

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tag-field]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    const f = tagFilter(t.getAttribute('data-tag-field'), t.getAttribute('data-tag-value') || '');
    if (!f.value && !f.name) return;
    /* Opened from a post sitting over a profile: close that first. */
    if (document.querySelector('[data-post-sheet]')) {
      if (!popBack('postsheet')) dropPostSheet();
      setTimeout(() => goNarrow(f), 60);
      return;
    }
    goNarrow(f);
  }, true);

  const TAG_COL = { set: 'set_name', rarity: 'rarity', grade: 'condition', edition: 'edition' };

  /* EVERYONE WITH THIS TAG. Cards by column, #tags by caption. */
  async function fetchTag() {
    await loadRoster();
    if (!roster.length) { drained = true; return; }
    if (filter.field === 'hash') {
      const word = String(filter.value || '');
      if (!filter._pd) await hashPhotos(word);
      /* #Charizard is also every Charizard card. */
      if (filter && !filter._cd) await nameCards(word);
      if (filter && filter._cd && filter._pd) drained = true;
      return;
    }
    const col = TAG_COL[filter.field];
    if (!col) { drained = true; return; }
    if (!columns) columns = NEW_COLS.slice();
    const run = (extra) => {
      let q = sb.from('user_cards').select(colList(extra))
        .in('user_id', roster).eq(col, filter.value)
        .order('added_at', { ascending: false }).limit(PAGE * 3);
      if (cursor) q = q.lt('added_at', cursor);
      return q;
    };
    let { data, error } = await run(columns.slice());
    if (error && missingColumn(error)) { columns = []; ({ data, error } = await run([])); }
    if (error) { note('Could not read that tag: ' + (error.message || 'unknown')); drained = true; return; }
    const rows = data || [];
    if (rows.length) cursor = rows[rows.length - 1].added_at;
    if (rows.length < PAGE * 3) drained = true;
    await facesFor([...new Set(rows.map(r => r.user_id))]);
    rows.filter(r => inView(r.user_id)).forEach(r => enqueue(cardRow(r)));
  }

  function mentions(text) {
    return esc(text || '').replace(/(^|[^A-Za-z0-9_@.])@([A-Za-z0-9_.]{2,30}[A-Za-z0-9_])/g,
      (m, pre, h) => `${pre}<b class="mention" role="link" tabindex="0" data-open-handle="${h}">@${h}</b>`)
      .replace(/(^|[^A-Za-z0-9_&#;])#([A-Za-z][A-Za-z0-9_]{1,30})/g,
      (m, pre, h) => `${pre}<b class="hashtag" role="link" tabindex="0" data-tag-field="hash" data-tag-value="${h.toLowerCase()}">#${h}</b>`);
  }

  async function openHandle(h) {
    const want = String(h || '').toLowerCase();
    let id = Object.keys(faces).find(k => faces[k] && String(faces[k].name || '').toLowerCase() === want);
    if (!id && sb) {
      try {
        const { data } = await sb.from('profiles').select('id, username').ilike('username', want).limit(1);
        if (data && data[0]) id = data[0].id;
      } catch (_) {}
    }
    if (!id) { bellSay('No collector called @' + h + '.', 'bad'); return; }
    goNarrow({ kind: 'person', id, label: h });
  }

  /* ---- who gave heat, and the newest comment, for a screenful at once ---- */
  /* var, not const: paintSocial() is called from paintHeat/paintCounts,
     which live higher up the file, and a const read before this line has
     run would throw instead of just finding nothing yet. */
  var heatWho  = new Map();   /* post_key -> [user_id, newest first] */
  var talkLast = new Map();   /* post_key -> { user_id, body } */
  var socAsked = new Set();

  async function refreshSocial() {
    if (!sb) { paintSocial(); return; }
    const keys = [...feed.querySelectorAll('.post [data-hype]')]
      .map(b => b.getAttribute('data-hype'))
      .filter(k => k && k.length > 2 && !socAsked.has(k));
    keys.forEach(k => socAsked.add(k));
    const hot  = keys.filter(k => (heatCount.get(k) || 0) > 0);
    const talk = keys.filter(k => (talkCount.get(k) || 0) > 0);
    try {
      const jobs = [];
      if (hot.length) jobs.push(sb.from('post_heat').select('post_key, user_id, created_at')
        .in('post_key', hot).order('created_at', { ascending: false }).limit(400)
        .then(({ data }) => (data || []).forEach(r => {
          const a = heatWho.get(r.post_key) || [];
          if (a.length < 8) a.push(r.user_id);
          heatWho.set(r.post_key, a);
        })));
      if (talk.length) jobs.push(sb.from('post_comments').select('post_key, user_id, body, created_at')
        .in('post_key', talk).is('parent_id', null).order('created_at', { ascending: false }).limit(400)
        .then(({ data }) => (data || []).forEach(r => {
          if (!talkLast.has(r.post_key)) talkLast.set(r.post_key, { user_id: r.user_id, body: r.body });
        })));
      if (keys.length) jobs.push(sb.from('post_view_counts').select('post_key, n').in('post_key', keys)
        .then(({ data }) => (data || []).forEach(r => viewCount.set(r.post_key, Number(r.n) || 0))));
      await Promise.all(jobs);
      watchViews();
      const ids = new Set();
      heatWho.forEach(a => a.forEach(u => ids.add(u)));
      talkLast.forEach(c => ids.add(c.user_id));
      const unknown = [...ids].filter(u => u && !(u in faces));
      if (unknown.length) await facesFor(unknown);
    } catch (_) { /* a missing line is a missing line, not a broken feed */ }
    paintSocial();
  }

  const nameLink = (id) => {
    const f = faces[id];
    const n = (f && f.name) || '';
    return n ? `<b role="link" tabindex="0" data-open-person="${esc(id)}" data-open-label="${esc(n)}">${esc(at(n))}</b>` : '';
  };

  function paintSocial() {
    if (!heatWho || !talkLast) return;
    try { decoratePosts(); } catch (_) {}
    try { paintWelcomes(); } catch (_) {}
    feed.querySelectorAll('.post').forEach(post => {
      const hb = post.querySelector('[data-hype]');
      const key = hb && hb.getAttribute('data-hype');
      if (!key || key.length < 3) return;
      const acts = post.querySelector('.acts');
      if (!acts) return;

      /* THE CAPTION'S NAME GOES TO THEIR PAGE, same as the header's. */
      const owner = post.getAttribute('data-owner') || '';
      const capName = post.querySelector('.caption > b:first-child');
      if (capName && !capName.hasAttribute('data-open-person') && !capName.hasAttribute('data-open-shop')) {
        if (capName.classList.contains('is-shop')) capName.setAttribute('data-open-shop', '');
        else if (owner) {
          capName.setAttribute('data-open-person', owner);
          capName.setAttribute('data-open-label', (faces[owner] && faces[owner].name) || 'them');
        }
        capName.setAttribute('role', 'link'); capName.setAttribute('tabindex', '0');
      }

      /* HEAT FROM ... */
      let hl = post.querySelector('.soc-heat');
      if (!hl) { hl = document.createElement('p'); hl.className = 'soc-heat'; acts.insertAdjacentElement('afterend', hl); }
      const n = heatCount.get(key) || 0;
      let html = '';
      if (n > 0) {
        const mineOn = !!me && heatMine.has(key);
        const pool = (heatWho.get(key) || []).filter(u => u !== me && faces[u]);
        const pick = pool.find(u => following(u)) || pool[0];
        const first = mineOn ? '<b>you</b>' : (pick ? nameLink(pick) : '');
        const rest = n - 1;
        if (first) html = `Heat from ${first}${rest > 0 ? ` and <b>${nfmt(rest)} ${rest === 1 ? 'other' : 'others'}</b>` : ''}`;
        else html = `<b>${nfmt(n)}</b> ${n === 1 ? 'person' : 'people'} gave this heat`;
      }
      /* VIEWS, after the heat line -- small and grey, the way a view count is. */
      const views = (typeof viewCount !== 'undefined' && viewCount.get(key)) || 0;
      if (views > 1) html += `${html ? ' <i class="soc-dot">&middot;</i> ' : ''}<span class="soc-views">${nfmt(views)} views</span>`;
      hl.innerHTML = html;
      hl.hidden = !html;

      /* VIEW ALL N COMMENTS, and the newest one. */
      const sec = post.querySelector('[data-talk]');
      if (!sec) return;
      const tk = sec.getAttribute('data-talk');
      let tl = post.querySelector('.soc-talk');
      if (!tl) {
        tl = document.createElement('div'); tl.className = 'soc-talk';
        const after = post.querySelector('.caption') || hl;
        after.insertAdjacentElement('afterend', tl);
      }
      const c = talkCount.get(tk) || 0;
      const last = talkLast.get(tk);
      const open = !sec.hidden;
      if (!c || open) { tl.hidden = true; tl.innerHTML = ''; return; }
      tl.hidden = false;
      tl.innerHTML = `<button type="button" class="soc-all" data-soc-open>${c === 1 ? 'View 1 comment' : `View all ${nfmt(c)} comments`}</button>` +
        (last && faces[last.user_id]
          ? `<p class="soc-last">${nameLink(last.user_id)} ${mentions(last.body)}</p>` : '');
    });
  }

  /* ---- double-tap a picture = heat ---- */
  const DT_FLAME = `<svg viewBox="0 0 64 80" aria-hidden="true">
    <defs><linearGradient id="dtg" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#ff3d00"/><stop offset=".55" stop-color="#ff8a00"/><stop offset="1" stop-color="#ffd23f"/>
    </linearGradient></defs>
    <path fill="url(#dtg)" stroke="#fff" stroke-width="3" stroke-linejoin="round"
      d="M34 3c2 12-4 18-9 25-6 8-10 14-10 23 0 14 11 25 17 25s17-11 17-25c0-7-3-12-6-16 0 6-3 10-7 11 3-9 1-20-2-26 5 3 6-9 0-17z"/>
    <path fill="#fff4b8" opacity=".9" d="M32 50c4 5 8 9 8 15 0 6-4 10-8 10s-8-4-8-10c0-5 4-9 8-15z"/>
  </svg>`;
  let tapAt = 0, tapX = 0, tapY = 0, downX = 0, downY = 0;
  document.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; }, { passive: true });
  document.addEventListener('pointerup', (e) => {
    const fig = e.target.closest('.post .frame .rail figure');
    if (!fig || fig.classList.contains('addpic') || e.target.closest('button, a')) return;
    const frame = fig.closest('.frame');
    if (frame.classList.contains('back')) return;
    if (Math.abs(e.clientX - downX) > 12 || Math.abs(e.clientY - downY) > 12) { tapAt = 0; return; }   /* a swipe */
    const now = Date.now();
    const close = Math.abs(e.clientX - tapX) < 40 && Math.abs(e.clientY - tapY) < 40;
    if (now - tapAt < 320 && close) {
      tapAt = 0;
      const post = fig.closest('.post');
      const btn = post && post.querySelector('[data-hype]');
      if (!btn) return;
      const burst = document.createElement('span');
      burst.className = 'dt-burst';
      /* ITS OWN FLAME, not the button's icon -- the button's is a line
         drawing colored by the button, and lifted out on its own it came
         out as a black outline (27 Sep 2026). Big, filled, in the middle of
         the picture, the way Instagram's heart is. */
      burst.innerHTML = DT_FLAME;
      const r = frame.getBoundingClientRect();
      burst.style.left = (r.width / 2) + 'px';
      burst.style.top  = (r.height / 2) + 'px';
      frame.appendChild(burst);
      setTimeout(() => burst.remove(), 900);
      /* Only ever adds. A second double-tap on something already hot just
         plays the flame again, the way a like works. */
      if (!me || !btn.classList.contains('on')) btn.click();
      return;
    }
    tapAt = now; tapX = e.clientX; tapY = e.clientY;
  });
  /* The phone's own double-tap-to-zoom would fight this on a picture. */

  /* ---- followers / following ---- */
  let flistBox = null;
  function closeFlist() { if (flistBox) { flistBox.remove(); flistBox = null; document.documentElement.classList.remove('join-open'); } }
  async function openFlist(of, which) {
    if (flistBox || !sb) return;
    flistBox = document.createElement('div');
    flistBox.className = 'flist';
    flistBox.setAttribute('role', 'dialog');
    flistBox.innerHTML = `<div class="fl-card"><div class="fl-top"><b>${which === 'following' ? 'Following' : 'Followers'}</b></div>
      <div class="fl-rows"><p class="fl-wait">Loading&hellip;</p></div></div>`;
    document.body.appendChild(flistBox);
    document.documentElement.classList.add('join-open');
    pushBack('flist', closeFlist);
    flistBox.addEventListener('click', (e) => {
      const who = e.target.closest('[data-fl-go]');
      if (who) {
        const id = who.getAttribute('data-fl-go'), label = who.getAttribute('data-fl-name') || 'them';
        if (!popBack('flist')) closeFlist();
        setTimeout(() => goNarrow({ kind: 'person', id, label }), 60);
        return;
      }
      if (!e.target.closest('.fl-card')) { if (!popBack('flist')) closeFlist(); }
    });
    let rows = [], err = null;
    try {
      const { data, error } = await sb.rpc('follow_list', { uid: of, which });
      if (error) err = error; else rows = data || [];
    } catch (x) { err = x; }
    const box = flistBox && flistBox.querySelector('.fl-rows');
    if (!box) return;
    if (err) { box.innerHTML = `<p class="fl-wait">The list is not switched on yet &mdash; run follow_list.sql.</p>`; return; }
    box.innerHTML = rows.length ? rows.map(r => `
      <button type="button" class="fl-row" data-fl-go="${esc(r.id)}" data-fl-name="${esc(r.username || '')}">
        <img src="${esc(r.avatar_url || '/assets/hyde-bot.png')}" alt="" loading="lazy"
             onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">
        <span><b>${esc(at(r.username || ''))}</b>${r.display_name ? `<small>${esc(r.display_name)}</small>` : ''}</span>
      </button>`).join('') : `<p class="fl-wait">Nobody yet.</p>`;
  }

  /* ---- one listener for the taps above ---- */
  document.addEventListener('click', (e) => {
    const h = e.target.closest('[data-open-handle]');
    if (h) { e.preventDefault(); openHandle(h.getAttribute('data-open-handle')); return; }
    const all = e.target.closest('[data-soc-open]');
    if (all) {
      e.preventDefault();
      const b = all.closest('.post') && all.closest('.post').querySelector('[data-comment]');
      if (b) b.click();
      return;
    }
    const fl = e.target.closest('[data-flist]');
    if (fl) { e.preventDefault(); openFlist(fl.getAttribute('data-flist-of'), fl.getAttribute('data-flist')); return; }
    /* FEED, tapped while already on the main feed: back to the top, and if
       you are already there, fresh posts. Anywhere else it goes home as
       it always did. */
    const home = e.target.closest('.nav a[href="./"]');
    if (home && !filter) {
      e.preventDefault();
      if (window.scrollY > 40) window.scrollTo({ top: 0, behavior: 'smooth' });
      else location.reload();
    }
  });

  /* ---- pull down at the top to refresh ---- */
  (function pullToRefresh() {
    let y0 = null, pulled = 0;
    const tab = document.createElement('div');
    tab.className = 'ptr';
    tab.innerHTML = '<span></span>';
    document.body.appendChild(tab);
    document.addEventListener('touchstart', (e) => {
      y0 = (window.scrollY <= 0 && !backStack.length && e.touches.length === 1) ? e.touches[0].clientY : null;
      pulled = 0;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      pulled = Math.max(0, e.touches[0].clientY - y0);
      if (window.scrollY > 0) { pulled = 0; y0 = null; }
      const d = Math.min(pulled, 120);
      tab.style.transform = `translate(-50%, ${d * 0.6 - 40}px) rotate(${d * 3}deg)`;
      tab.style.opacity = String(Math.min(1, d / 50));
      tab.classList.toggle('ready', pulled > 90);
    }, { passive: true });
    document.addEventListener('touchend', () => {
      if (y0 != null && pulled > 90) { tab.classList.add('spin'); location.reload(); return; }
      y0 = null; pulled = 0;
      tab.style.transform = ''; tab.style.opacity = ''; tab.classList.remove('ready');
    }, { passive: true });
  })();

  /* ======================================================================
     THE JOIN BOX -- 27 Sep 2026 (Mike: "this is the instagram of pokemon
     collectors", "with a big let's go button").

     Guests could scroll forever and never be told what the place is for.
     Nobody posted, because everybody assumed it was one more tracker. This
     box says it in one line, three bullets, one big button.

     WHEN IT SHOWS
       * On its own ONCE per phone, and only after they have looked around:
         8 seconds on the page, or about two posts scrolled, whichever
         comes first. Somebody who clicked Jeff's Facebook post came to see
         that post, not a sign-up box.
       * Every time a guest taps something that needs an account -- HEAT,
         FOLLOW, the wish list, a photo. That is the moment they want in.
       * When they tap "Join free" at the top.
     It waits if something else already covers the screen, and it is one
     layer on the back stack, so the phone's back button closes it.
     ====================================================================== */
  const JOIN_SEEN = 'ip-join-seen-v1';
  window.InfinitePullsJoin = (why) => showJoin(why);
  /* For components/loops.js: open a person or a #tag from inside a Loop. */
  window.InfinitePullsFeedGo = {
    person: (id, label) => goNarrow({ kind: 'person', id, label: label || 'them' }),
    tag: (v) => goNarrow(tagFilter('hash', String(v || '').toLowerCase()))
  };
  let joinBox = null;

  /* mode 'signup' opens the account page on Create Account; anything else
     on Sign In. */
  function joinGo(mode) {
    try { sessionStorage.setItem('ip-after-signin', location.pathname + location.search); } catch (_) {}
    location.href = '/?page=account' + (mode === 'signup' ? '&new=1' : '');
  }

  function closeJoin() {
    if (!joinBox) return;
    joinBox.remove(); joinBox = null;
    document.documentElement.classList.remove('join-open');
  }

  function showJoin(why) {
    if (me || joinBox) return;
    try { localStorage.setItem(JOIN_SEEN, '1'); } catch (_) {}
    const lead = why ? `<p class="jb-why">${esc(why)}</p>` : '';
    joinBox = document.createElement('div');
    joinBox.className = 'joinbox';
    joinBox.setAttribute('role', 'dialog');
    joinBox.setAttribute('aria-modal', 'true');
    joinBox.setAttribute('aria-labelledby', 'jb-h');
    joinBox.innerHTML = `
      <div class="jb-card">
        ${lead}
        <h2 id="jb-h" class="jb-h">Track your Pok&eacute;mon cards &amp; share your pulls.</h2>
        <ul class="jb-list">
          <li>Post your pulls and show off your cards</li>
          <li>Follow collectors and see what everyone&rsquo;s pulling</li>
        </ul>
        <p class="jb-plus">Plus every collector tool you need</p>
        <ul class="jb-list jb-tools">
          <li>Scan a card with your camera to add it in seconds</li>
          <li>Your whole collection with TCGplayer market prices</li>
          <li>eBay sold comps one tap away</li>
        </ul>
        <button type="button" class="jb-go" data-join-go="new">LET&rsquo;S GO!</button>
        <p class="jb-sub">Free. Already have an account? <a href="/?page=account" data-join-go>Sign in</a></p>
      </div>`;
    document.body.appendChild(joinBox);
    document.documentElement.classList.add('join-open');
    pushBack('join', closeJoin);
    joinBox.addEventListener('click', (e) => {
      const jg = e.target.closest('[data-join-go]');
      if (jg) { e.preventDefault(); joinGo(jg.getAttribute('data-join-go') === 'new' ? 'signup' : 'signin'); return; }
      if (!e.target.closest('.jb-card')) { if (!popBack('join')) closeJoin(); }
    });
    const go = joinBox.querySelector('.jb-go');
    if (go) go.focus({ preventScroll: true });
  }

  document.addEventListener('click', (e) => {
    const j = e.target.closest('[data-join-why]');
    if (!j || me) return;
    e.preventDefault();
    showJoin(j.getAttribute('data-join-why') || '');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && joinBox) { if (!popBack('join')) closeJoin(); }
  });

  /* The once-per-phone prompt. Asked again at the moment it would fire,
     because who is looking is only known a moment after the page draws. */
  (function armJoin() {
    let seen = false;
    try { seen = localStorage.getItem(JOIN_SEEN) === '1'; } catch (_) {}
    if (seen || !sb) return;
    let done = false;
    const fire = () => {
      if (done) return;
      if (me) { done = true; return; }
      if (backStack.length) return;          /* something is open; try again later */
      done = true;
      window.removeEventListener('scroll', onScroll);
      showJoin(inviteRef ? '@' + inviteRef + ' invited you \u{1F44B}' : undefined);
    };
    const onScroll = () => { if (window.scrollY > window.innerHeight * 1.5) fire(); };
    window.addEventListener('scroll', onScroll, { passive: true });
    setTimeout(fire, 8000);
    setTimeout(fire, 20000);                 /* the second try, if the first was blocked */
  })();

  /* THE APP-INSTALLED CARD, ARRIVING FROM OUTSIDE.
     S26-12 is the one card the database cannot decide -- only the browser
     knows it is running as an installed app. components/app-installed.js
     watches for that, tells reward_assert_installed(), and fires this event
     with the card in reward_sweep()'s exact shape. Which means the reveal
     panel needs no special case: it is handed a card and it draws it.

     The listener is registered here, at file scope, so it is live before
     that script even loads -- it is deliberately the last tag on the page. */
  window.addEventListener('ip:reward-awarded', (e) => {
    const won = (e && Array.isArray(e.detail)) ? e.detail : [];
    if (!won.length) return;
    /* Mark it held before celebrating, so the sheet behind the panel is
       already showing it in colour when they close the panel. */
    /* Mark it held before celebrating, so the sheet behind the panel is
       already showing it in colour when they close the panel. */
    try { won.forEach(c => { if (c && c.card_id) rwdMine.add(c.card_id); }); } catch (_) {}
    try { rwdCelebrate(won); } catch (_) { /* the card is theirs regardless */ }
  });

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
          .select('id, code, card_number, secret, name, task_line, explainer, ' +
                  'form_name, thumb_url, art_url, dex_creatures(dex_number, name)')
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
      /* ONE entry for all seven sheets. Opening the menu over My Cards is a
         swap, not a second layer, so Back still takes one tap to leave. */
      if (!overlayPushed) {
        overlayPushed = true;
        pushBack('sheet', () => {
          draw(overlay, false);
          overlay = null;
          overlayPushed = false;
          /* whatever was waiting for the sheet to get out of the way */
          const then = afterOverlay; afterOverlay = null;
          if (then) setTimeout(then, 0);
        });
      }
      return;
    }
    if (overlay !== kind) return;
    if (popBack('sheet')) return;                   /* the listener closes it */
    draw(kind, false);
    overlay = null;
    overlayPushed = false;
  }

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
    if (overlay === 'rewards' && rwdView === 'card') {
      if (!popBack('rwdcard')) rwdPaint();
      return;
    }
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
    followed.clear();
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
    if (!me) { showJoin('Sign up to follow collectors.'); return; }
    btn.dataset.busy = '1';
    const turningOff = following(id);
    const ok = await writeFollow(id, !turningOff);
    delete btn.dataset.busy;
    if (!ok) return;

    if (turningOff) followed.delete(id); else followed.add(id);
    feed.querySelectorAll('.follow[data-follow="' + CSS.escape(id) + '"]').forEach(b => {
      b.classList.toggle('on', !turningOff);
      b.textContent = turningOff ? 'FOLLOW' : 'FOLLOWING';
    });
    bumpFollowers(id, turningOff ? -1 : 1);

    /* IN FOLLOWING, an unfollow takes their cards off the page straight away
       -- a switch that appears to do nothing reads as broken -- and one strip
       takes their place with a way back. In EVERYONE nothing leaves: they
       are still part of the whole site, you just do not follow them. */
    if (turningOff && feedMode() === 'following') {
      const who = (faces[id] && faces[id].name) || 'them';
      const theirs = [...feed.querySelectorAll('.post[data-owner="' + CSS.escape(id) + '"]')];
      if (theirs.length) {
        theirs[0].insertAdjacentHTML('beforebegin',
          `<div class="gone" data-gone="${esc(id)}"><span>Unfollowed <b>${esc(at(who))}</b>. They are still in Everyone.</span>
             <button type="button" data-refollow="${esc(id)}">UNDO</button></div>`);
      }
      theirs.forEach(el => el.remove());
    }
  }

  /* The follower number on an open profile moves with the button, so the
     tap visibly did something even before anybody reloads. */
  function bumpFollowers(id, by) {
    const box = document.getElementById('profcard');
    if (!box || box.getAttribute('data-owner') !== id) return;
    const n = box.querySelector('[data-followers]');
    if (!n) return;
    const v = Math.max(0, (parseInt(n.getAttribute('data-followers'), 10) || 0) + by);
    n.setAttribute('data-followers', String(v));
    n.textContent = v.toLocaleString();
  }

  async function tapRefollow(id) {
    if (!id) return;
    if (!(await writeFollow(id, true))) return;
    followed.add(id);
    bumpFollowers(id, 1);
    /* Their cards were dropped from the page, and the fair way to bring them
       back is to build the feed again rather than guess where they went. */
    feed.querySelectorAll('[data-gone="' + CSS.escape(id) + '"]').forEach(el => el.remove());
    roster = null;
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
    /* THE BELL IS THE NOTIFICATIONS LIST NOW (27 Sep 2026, Jeff: "work like
       Facebook's"). It is never greyed out. The phone on/off switch it used
       to be lives at the top of the dropdown, and that is what this paints. */
    const el = document.getElementById('bell');
    if (el) {
      el.disabled = false;
      el.classList.remove('on');
      el.removeAttribute('aria-pressed');
      el.setAttribute('aria-label', 'Notifications');
    }
    const sw = document.querySelector('[data-nd-phone]');
    if (!sw) return;
    let state;
    if (!pushable()) state = 'na';
    else if (('Notification' in window) && Notification.permission === 'denied') state = 'blocked';
    else state = (await isOn()) ? 'on' : 'off';
    sw.dataset.state = state;
    const iosTab = /iPhone|iPad|iPod/.test(navigator.userAgent || '') &&
      !((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true);
    sw.querySelector('span').textContent =
        state === 'on' || state === 'off' ? 'Phone alerts'
      : state === 'blocked' ? 'Blocked in phone settings'
      : iosTab ? 'Add to Home Screen for phone alerts' : 'No phone alerts in this browser';
    sw.disabled = state === 'na' || state === 'blocked';
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
    const el = document.querySelector('[data-nd-phone]');
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
        if (r === true) bellSay('Notifications on. Price drops on your wish list.', 'good');
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
    /* SUGGESTED FOR YOU, after the 5th post. Empty (so invisible) until the
       site has 50 members -- suggested_follows.sql decides. */
    /* INFINITE LOOPS (27 Sep 2026) -- components/loops.js draws it. */
    /* at 0 = the very top of the feed (Mike, 27 Sep: first thing anybody sees) */
    { at: 0, key: 'loops', build: () => window.InfinitePullsLoops ? window.InfinitePullsLoops.railHTML() : '' },
    { at: 5, key: 'suggest', build: suggestRail },
    { at: 10, key: 'videos', build: videoRail },
    /* same spot, placed second so it lands ABOVE the videos (Jeff) */
    { at: 10, key: 'newbies', build: newbiesRail },
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

  /* NEW THIS WEEK (Jeff, 27 Sep 2026). People who joined in the last seven
     days -- only once they have a profile picture and something posted, so
     a tap never lands on an empty page. See new_members.sql. */
  async function newbiesRail() {
    if (!sb) return '';
    let list = [];
    try {
      const { data, error } = await sb.rpc('new_members', { p_days: 7, p_limit: 20 });
      if (error || !data) return '';
      list = data.filter(x => x.id !== me && !blocked.has(x.id));
    } catch (_) { return ''; }
    if (!list.length) return '';
    list.forEach(x => { if (!faces[x.id]) faces[x.id] = { id: x.id, name: x.username, avatar: x.avatar_url }; });
    return `<section class="rail-block" data-rail="newbies">
      <h2>\u{1F44B} New this week</h2>
      <div class="rail">${list.map(x => `
        <div class="rail-newbie">
          <button type="button" class="nb-face" data-open-person="${esc(x.id)}" data-open-label="${esc(x.username)}"
                  aria-label="See ${esc(at(x.username))}">
            <img src="${esc(x.avatar_url)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">
          </button>
          <button type="button" class="nb-name" data-open-person="${esc(x.id)}" data-open-label="${esc(x.username)}">${esc(at(x.username))}</button>
          <small>joined ${esc(agoShort(x.joined_at))}</small>
          ${me ? `<button class="follow nb-follow${following(x.id) ? ' on' : ''}" type="button" data-follow="${esc(x.id)}">${following(x.id) ? 'FOLLOWING' : 'FOLLOW'}</button>`
               : `<button class="follow nb-follow" type="button" data-join-why="Sign up to follow collectors.">FOLLOW</button>`}
        </div>`).join('')}</div>
    </section>`;
  }

  const SUGGEST_HIDE = 'ip-suggest-hidden-v1';
  async function suggestRail() {
    if (!sb || !me) return '';
    let hidden = [];
    try { hidden = JSON.parse(localStorage.getItem(SUGGEST_HIDE) || '[]'); } catch (_) {}
    let preview = false;
    try { preview = staff && new URL(location.href).searchParams.get('suggest') === '1'; } catch (_) {}
    let list = [];
    try {
      const { data, error } = await sb.rpc('suggested_follows', { p_limit: 14, p_preview: preview });
      if (error || !data) return '';
      list = data.filter(x => !hidden.includes(x.id) && !following(x.id) && !blocked.has(x.id));
    } catch (_) { return ''; }
    if (list.length < 2) return '';
    list.forEach(x => { if (!faces[x.id]) faces[x.id] = { id: x.id, name: x.username, avatar: x.avatar_url }; });
    return `<section class="rail-block" data-rail="suggest">
      <h2>Suggested for you</h2>
      <div class="rail">${list.map(x => `
        <div class="rail-newbie is-suggest" data-sg="${esc(x.id)}">
          <button type="button" class="sg-x" data-sg-hide="${esc(x.id)}" aria-label="Not interested">&times;</button>
          <button type="button" class="nb-face" data-open-person="${esc(x.id)}" data-open-label="${esc(x.username)}"
                  aria-label="See ${esc(at(x.username))}">
            <img src="${esc(x.avatar_url)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">
          </button>
          <button type="button" class="nb-name" data-open-person="${esc(x.id)}" data-open-label="${esc(x.username)}">${esc(at(x.username))}</button>
          <small>${esc(x.reason || '')}</small>
          <button class="follow nb-follow" type="button" data-follow="${esc(x.id)}">FOLLOW</button>
        </div>`).join('')}</div>
    </section>`;
  }
  document.addEventListener('click', (e) => {
    const x = e.target.closest('[data-sg-hide]');
    if (!x) return;
    e.preventDefault();
    const id = x.getAttribute('data-sg-hide');
    try {
      const h = JSON.parse(localStorage.getItem(SUGGEST_HIDE) || '[]');
      if (!h.includes(id)) h.push(id);
      localStorage.setItem(SUGGEST_HIDE, JSON.stringify(h.slice(-200)));
    } catch (_) {}
    const card = x.closest('.rail-newbie');
    const block = card && card.closest('.rail-block');
    if (card) card.remove();
    if (block && !block.querySelector('.rail-newbie')) block.remove();
  });

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
      return `<a class="rail-mover" href="/?page=lookup&q=${encodeURIComponent(r.number || r.name || '')}">
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
      <a class="rail-more" href="/?page=movers">See the whole board</a>
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
      if (r.at === 0) {
        const first = feed.querySelector('.post:not(.tutorial)');
        if (first && first.isConnected) first.insertAdjacentHTML('beforebegin', html);
        continue;
      }
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
        el.src = '/components/collector-goals-data.js';
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
          return `<a class="mb${on ? ' is-on' : ''}" href="/?page=goals" data-open-goals
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
      const m = /^([pcr])-(.+)$/.exec(raw.trim());
      if (!m) return null;
      return { kind: m[1] === 'p' ? 'photo' : m[1] === 'r' ? 'reward' : 'card', id: m[2] };
    } catch (_) { return null; }
  }

  /* THE OTHER HALF OF THE WAY BACK. The pinned card is drawn face up like
     any other; ?flip=1 says he was reading its back when he left, so turn
     it over for him. Through the button rather than by adding the class, so
     the back is FILLED -- the panel is built on the first turn and setting
     the class alone would show an empty one. */
  function flipPinnedIfAsked() {
    if (!WANTS_FLIP) return;
    const turn = feed.querySelector('.pinned-post [data-turn]');
    if (turn) turn.click();
    /* Take the flag out of the address. A refresh, or a Back to here from
       somewhere else later, should not keep re-flipping a card he has since
       turned face up himself. */
    try {
      const u = new URL(location.href);
      if (u.searchParams.has('flip')) {
        u.searchParams.delete('flip');
        history.replaceState(history.state, '', u.pathname + u.search);
      }
    } catch (_) {}
  }

  /* COMING BACK FROM SIGNING IN. askToSignIn() remembers which post
     somebody was about to comment on; this is the other half -- ?talk=1
     says open that post's comments once it is on screen, so they land on
     the thing they were looking at with the box already waiting. */
  function openTalkIfAsked() {
    if (!WANTS_TALK) return;
    const sec = feed.querySelector('[data-talk]');
    const art = sec && sec.closest('.post');
    if (!art) return;
    /* ?c=<comment id> -- from a notification. Open the thread, put that
       comment in the middle of the screen, light it up, and have the reply
       box ready to answer it (Jeff, 27 Sep: "take me to where he commented
       so I could comment back or like it"). */
    let cid = '';
    try { cid = new URL(location.href).searchParams.get('c') || ''; } catch (_) {}
    Promise.resolve(toggleTalk(art, true)).then(() => setTimeout(() => {
      const row = cid && art.querySelector(`[data-cmt="${CSS.escape(cid)}"]`);
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        row.classList.add('cmt-hl');
        setTimeout(() => row.classList.remove('cmt-hl'), 4000);
        const rep = row.querySelector('[data-reply]');
        if (rep) { rep.click(); return; }
      }
      const input = art.querySelector('.say input');
      if (input) input.focus({ preventScroll: !!row });
    }, 350));
    try {
      const u = new URL(location.href);
      if (u.searchParams.has('c')) { u.searchParams.delete('c'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); }
    } catch (_) {}
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
      note('No collector called @' + WANTS_WHO + '. Here is everybody instead.');
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
        .select('id, user_id, object_key, extra_keys, caption, added_at, is_intro')
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

  /* WHAT HAPPENED, above a post you arrived at from a notification
     (?from=n&k=comment&a=Jefleppard) -- instead of "a post somebody shared". */
  function notifLabel() {
    try {
      const q = new URL(location.href).searchParams;
      if (q.get('from') !== 'n') return '';
      const a = (q.get('a') || '').replace(/[^A-Za-z0-9_-]/g, '');
      const who = a ? '@' + a : 'Somebody';
      const says = { comment: '\u{1F4AC} ' + who + ' commented on this',
                     reply: '\u21A9\uFE0E ' + who + ' replied to your comment',
                     heart: '\u2665\uFE0E ' + who + ' liked your comment',
                     heat: '\u{1F525} ' + who + ' gave this heat',
                     mention: '@ ' + who + ' mentioned you here' };
      return says[q.get('k')] || '\u{1F514} From your notifications';
    } catch (_) { return ''; }
  }

  async function rewardPinned(want) {
    const SEL = 'id, user_id, card_id, earned_at, reward_cards(card_number, name, task_line, secret, thumb_url, art_url)';
    const { data: one } = await sb.from('user_reward_cards').select(SEL).eq('id', want.id).maybeSingle();
    if (!one) return null;
    const since = new Date(Date.parse(one.earned_at) - 6 * 3600e3).toISOString();
    let rows = [one];
    try {
      const { data: more } = await sb.from('user_reward_cards').select(SEL)
        .eq('user_id', one.user_id).not('claimed_at', 'is', null)
        .lte('earned_at', one.earned_at).gte('earned_at', since)
        .order('earned_at', { ascending: false });
      if (more && more.length && more[0].id === one.id) rows = more;
    } catch (_) {}
    await facesFor([one.user_id]);
    return rewardRow(rewardBatches(rows)[0]);
  }

  async function pinnedPost() {
    const want = wantedPost();
    if (!want || !sb) return '';
    const label = notifLabel();
    const moreLinks = label
      ? `<div class="pinned-links"><a class="pinned-more" href="/feed-next/?alerts=1">\u{1F514} See your other notifications</a>
           <a class="pinned-more" href="/feed-next/">See the whole feed</a></div>`
      : `<a class="pinned-more" href="/feed-next/">See the whole feed</a>`;
    if (want.kind === 'reward') {
      try {
        const row = await rewardPinned(want);
        if (!row) { note('That post is not here any more.'); return ''; }
        return `<div class="pinned-post">
            <div class="pinned-head">${I.link}<span>${esc(label || 'A POST SOMEBODY SHARED')}</span></div>
            ${postHTML(row, 0)}
            ${moreLinks}
          </div>`;
      } catch (e) { note('Could not open that post: ' + ((e && e.message) || 'unknown')); return ''; }
    }
    try {
      const table = want.kind === 'photo' ? 'user_photos' : 'user_cards';
      /* `columns` IS NULL UNTIL THE FEED'S FIRST CARD FETCH SETS IT, and a
         shared link opens this before that has happened. It used to read
         `columns || []`, which quietly asked for none of the new columns --
         so a card opened straight from its own link came back with no
         cert_number and no photo_key, and the certificate was missing on
         exactly the page somebody had been sent to look at. Ask for them,
         and drop back the same way every other reader here does. */
      let asked = want.kind === 'photo' ? [] : (columns || NEW_COLS).slice();
      let data, error;
      for (let tries = asked.length + 1; tries > 0; tries--) {
        const cols = want.kind === 'photo'
          ? 'id, user_id, object_key, extra_keys, caption, added_at, is_intro'
          : colList(asked);
        ({ data, error } = await sb.from(table).select(cols).eq('id', want.id).maybeSingle());
        if (!error || !missingColumn(error) || !asked.length) break;
        const gone = missingName(error);
        asked = gone ? asked.filter(c => c !== gone) : [];
        columns = (columns || NEW_COLS).filter(c => asked.indexOf(c) !== -1);
      }
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
      if (!label) { try { history.replaceState(history.state, '', permalink(row)); } catch (_) {} }
      /* "A POST SOMEBODY SHARED" is true of a link from outside and a lie
         on the way back from the lookup page -- nobody shared anything, he
         went to check a price and came back. Same pinned row, honest label. */
      return `<div class="pinned-post">
          <div class="pinned-head">${I.link}<span>${label ? esc(label) : WANTS_FLIP
            ? 'THE CARD YOU WERE LOOKING AT' : 'A POST SOMEBODY SHARED'}</span></div>
          ${postHTML(row, 0)}
          ${moreLinks}
        </div>`;
    } catch (e) {
      note('Could not open that post: ' + ((e && e.message) || 'unknown'));
      return '';
    }
  }

  async function startFeed() {
    paintFeedTabs();
    /* WHOSE FEED FIRST, because it decides everything below it: a narrowed
       feed has no welcome card and no pinned post, and asking for either
       before knowing would draw them and then take them away again. */
    if (WANTS_WHO && !filter) await openWhoIfAsked();
    /* AGAIN, AFTER. Arriving on infinitepulls.com/somebody sets the filter
       just above, after the tabs were first painted -- which left EVERYONE /
       FOLLOWING showing on top of that person's profile. */
    paintFeedTabs();
    /* The welcome card is a welcome, not a search result -- it has no place
       inside a filter. */
    /* The shared post goes in FIRST and before anything else is asked for,
       so the thing somebody followed a link for is on screen while the rest
       of the feed is still loading behind it. */
    const pinned = filter ? '' : await pinnedPost();
    /* WHOSE SHELF THIS IS, above their cards. Drawn hidden and filled in
       afterwards: the name, the badges and the counts are several
       round trips, and holding the whole feed back for them would mean
       staring at nothing on the one screen somebody arrived at from Google. */
    const prof = (filter && filter.kind === 'person')
      ? '<section class="prof" id="profcard" hidden></section><section class="ppane" id="ppane"></section>' : '';
    profTab = 'cards';
    if (prof) feed.classList.add('is-grid'); else feed.classList.remove('is-grid');
    /* Under the welcome card, above everything the rotation deals. Skipped
       inside a filter and when somebody arrived on a shared post: both of
       those are screens about one particular thing, and a notice board on
       top of them is noise. */
    const shopPin = (filter || pinned) ? '' : await shopPinHTML();
    feed.innerHTML = prof + pinned + (filter || pinned ? '' : '<section class="getstarted" id="getstarted" hidden></section><section class="hotwk" id="hotwk" hidden></section>' + tutorialHTML() + shopPin) +
      `<div class="skel"><div class="bar" style="width:55%"></div><div class="box"></div></div>`;
    if (prof) fillProfile(filter.id);
    paintNotes();
    await refreshCounts();
    refreshHeat().then(refreshSocial);
    if (!filter && !pinned) { paintHot(); paintGetStarted(); }
    feed.querySelectorAll('.pinned-post .frame:not([data-wired])').forEach(f => {
      f.setAttribute('data-wired', '1'); wireRail(f); paintStrip(f, false);
    });
    await loadMore();
    const first = feed.querySelector('.skel');
    if (first) first.remove();
    placeMyBadges();
    flipPinnedIfAsked();
    openTalkIfAsked();
    /* On a profile the CARDS grid opens first and the posts wait for their
       tab, so "has not added any cards" would be a lie told behind the grid. */
    if (!feed.classList.contains('is-grid') && !feed.querySelector('.post:not(.tutorial)')) {
      feed.insertAdjacentHTML('beforeend', filter
        ? `<div class="msg"><b>Nothing here</b>
             ${filter.kind === 'shop'
               ? 'There is nothing on the shelf right now.'
               : filter.kind === 'person'
                 ? esc(at(filter.label)) + ' has not added any cards yet.'
                 : 'Nobody has added one of those yet.'}</div>`
        : feedMode() === 'following'
          ? `<div class="msg"><b>Nobody to show yet</b>
               Following shows the people you follow. Tap EVERYONE, then FOLLOW
               anybody whose cards you want here.</div>`
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
    buildRail();
    if (sb) { await whoAmI(); followAfterJoin(); joinFromLink(); touchSeen(); setInterval(() => { touchSeen(); paintOnline(); }, 120e3); paintNavMe(); settleBell(); loadUnread(); refreshClaims(); countNewPosts();
              paintMineDot(); rwdSoon(1800);
              await Promise.all([loadFollows(), loadWishlist(), loadBlocks()]);
              claimInvite(); welcomeInvite(); }
    try {
      const u = new URL(location.href);
      if (u.searchParams.get('posted') === '1') {
        u.searchParams.delete('posted');
        history.replaceState(history.state, '', u.pathname + u.search + u.hash);
        setTimeout(() => askPush('post'), 3000);
      }
    } catch (_) {}
    if (!sb) {
      feed.innerHTML = `<div class="msg"><b>No connection to the shop</b>
        This page needs config.js and the Supabase library. Open it from the site,
        not from a file on your computer.</div>`;
      return;
    }
    await startFeed();
    /* ?menu=1 AND ?search=1 (25 Sep 2026). The older pages wear the feed's
       own bottom bar and top bar now; their MENU and search buttons land
       here and open the real thing, then take the words back out of the
       address so a refresh does not open it again. */
    try {
      const u = new URL(location.href);
      const wantMenu = u.searchParams.get('menu') === '1';
      const wantSearch = u.searchParams.get('search') === '1';
      /* ?alerts=1 and ?rewards=1: the NOTIFICATIONS tile and the MY
         INFINITE REWARDS row on the old pages' sheets land here, open. */
      const wantAlerts = u.searchParams.get('alerts') === '1';
      const wantRewards = u.searchParams.get('rewards') === '1';
      const wantGoals = u.searchParams.get('goals') === '1';
      if (wantGoals) {
        u.searchParams.delete('goals');
        history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
        setTimeout(openGoals, 0);
      }
      if (wantMenu || wantSearch || wantAlerts || wantRewards) {
        ['menu', 'search', 'alerts', 'rewards'].forEach(k => u.searchParams.delete(k));
        history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
        if (wantMenu) openMenu(true);
        else if (wantSearch) openSearch(true);
        else if (wantAlerts && me) { openDrop(); }
        else if (wantRewards && me) {
          showOverlay('rewards', true);
          rwdNewsLine = rwdLoadNew().size;
          fillRewards(); rwdSeen();
        }
      }
    } catch (_) {}
    /* AFTER the feed, not before: the panel is a thing sitting on top of the
       app, and it only reads that way if the app is behind it. */
    askWelcome();
    /* After the welcome has had its chance, and only if it did not show. */
    setTimeout(() => { askPhone().catch(() => {}); }, 2500);
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
    /* #word is a tag search: one row, straight to that tag. */
    const hash = /^\s*#([A-Za-z][A-Za-z0-9_]{1,30})/.exec(String(raw || ''));
    if (hash) return { q: hash[1], tags: [{ field: 'hash', value: hash[1].toLowerCase() }], people: [], cards: [], shop: [] };
    const q = cleanQ(raw);
    if (q.length < 2 || !sb) return null;
    const like = '%' + q + '%';
    /* FIND PEOPLE -- 25 Sep 2026 (SOCIAL-NEXT part 3). Starting with @ means
       "a person": only collectors come back, and more of them, the way every
       app's @ search works. Without the @ it is the mixed search it was. */
    const peopleOnly = /^\s*@/.test(String(raw || ''));

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
      .eq('is_public', true).ilike('username', like).limit(peopleOnly ? 12 : 6);

    if (peopleOnly) {
      const p = await people;
      if (p.error) note('Could not search people: ' + (p.error.message || 'unknown'));
      return { q, peopleOnly: true, people: await withCardCounts(p.data || []), cards: [], shop: [] };
    }

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

    /* TAGS THAT MATCH: the Pokemon and the sets in what came back. */
    const tagHits = [];
    const lowq = q.toLowerCase();
    const addHit = (field, value) => {
      if (value && !tagHits.some(t => t.field === field && t.value === value)) tagHits.push({ field, value });
    };
    rows.forEach(r => {
      const mon = pokemonOf(r.card_name);
      if (mon.toLowerCase().includes(lowq)) addHit('pokemon', mon);
      if ((r.set_name || '').toLowerCase().includes(lowq)) addHit('set', r.set_name);
    });

    await facesFor([...new Set(packed.map(r => r.user_id))]);
    return {
      q,
      tags: tagHits.slice(0, 6),
      people: await withCardCounts(p.data || []),
      cards: packed,
      shop: (sh.data || []).filter(usableShop)
    };
  }

  /* HOW MANY CARDS EACH PERSON HAS, for the people row. One count per person,
     asked all at once, head-only so no rows travel. A count that fails just
     leaves that row saying "See their cards", which is what it said before. */
  async function withCardCounts(people) {
    if (!people.length) return people;
    const counts = await Promise.all(people.map(u =>
      sb.from('user_cards').select('id', { count: 'exact', head: true }).eq('user_id', u.id)
        .then(r => (r.error ? null : r.count), () => null)));
    return people.map((u, i) => ({ ...u, cards: counts[i] }));
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

    if (r.tags && r.tags.length) {
      bits.push('<div class="res-group">TAGS</div>');
      bits.push(`<div class="res-tags">${r.tags.map(t => `<button type="button" class="stag"
          data-tag-field="${esc(t.field)}" data-tag-value="${esc(t.value)}">${esc(t.field === 'hash' ? '#' + t.value : t.value)}</button>`).join('')}</div>`);
    }

    if (r.people.length) {
      bits.push('<div class="res-group">PEOPLE</div>');
      r.people.forEach(u => {
        bits.push(`<button class="res" type="button" data-pick="person"
          data-id="${esc(u.id)}" data-label="${esc(u.username || 'A collector')}">
          <img class="pic round" src="${esc(u.avatar_url || '/assets/hyde-bot.png')}" alt=""
               onerror="this.onerror=null;this.src='/assets/hyde-bot.png'">
          <span><b>${esc(at(u.username) || 'A collector')}</b><small>${
            typeof u.cards === 'number'
              ? (u.cards === 1 ? '1 card' : u.cards.toLocaleString() + ' cards')
              : 'See their cards'}</small></span>
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
            <small>${esc([c.set_name, (who && at(who.name)) || 'a collector',
                           c.copies > 1 ? '\u00d7' + c.copies : ''].filter(Boolean).join(' \u00b7 '))}</small>
            ${why ? `<span class="why">\u201c${esc(why)}\u201d</span>` : ''}</span>
        </button>`);
      });
    }

    if (r.shop.length) {
      bits.push('<div class="res-group">AT THE SHOP</div>');
      r.shop.forEach(it => {
        bits.push(`<a class="res" href="/?page=shop">
          <img class="pic" src="${esc(it.photo_url || it.art_url || NO_PHOTO)}" alt=""
               onerror="this.onerror=null;this.src='${NO_PHOTO}'">
          <span><b>${esc(it.name || 'Card')}</b>
            <small>${esc([it.set_name, money(it.price)].filter(Boolean).join(' \u00b7 '))}</small></span>
        </a>`);
      });
    }

    /* NOT A DEAD END. Nothing here owns one, so the next thing on screen is
       the door to the page that knows about every card there is. */
    if (!bits.length && r.peopleOnly) {
      bits.push(`<div class="res-none"><b>No collector called @${esc(r.q)}</b>
        Check the spelling, or search without the @ to look for cards.</div>`);
    }
    if (!bits.length) {
      bits.push(`<div class="res-none"><b>Nobody here has one yet</b>
        No people, cards or shop listings match \u201c${esc(r.q)}\u201d.</div>
        <a class="res" href="/?page=lookup&q=${encodeURIComponent(r.q)}">
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
      closeSheet();
      setTimeout(openDrop, 60);
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
    /* ALL CARDS, NICE and START LOOKING are the same door the phone's Back
       button is. They go through popBack so the stack cannot be left
       holding a layer for something already off the screen -- which would
       quietly cost the user their next back press. */
    if (e.target.closest('[data-rwd-back]')) {
      e.preventDefault();
      if (!popBack('rwdcard')) rwdPaint();
      return;
    }
    if (e.target.closest('[data-won-close]')) {
      e.preventDefault();
      if (!popBack('won')) rwdCloseWon();
      return;
    }
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

    if (e.target.closest('[data-hey-close]')) {
      e.preventDefault();
      if (!popBack('hey')) closeWelcome();
      return;
    }
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
    if (e.target.closest('[data-myedit]')) {
      if (!me) return;
      /* Already on your own profile: press its EDIT PROFILE. Otherwise go
         to your profile and let fillProfile open the sheet when it draws. */
      const btn = document.querySelector('#profcard [data-edit-profile]');
      if (btn && filter && filter.kind === 'person' && filter.id === me) { btn.click(); return; }
      editWanted = true;
      const who = faces[me];
      goNarrow({ kind: 'person', id: me, label: (who && who.name) || 'you' });
      return;
    }
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
    if (e.target.closest('[data-bell]')) { openDrop(); return; }
    if (e.target.closest('[data-nd-phone]')) { tapBell(); return; }
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
