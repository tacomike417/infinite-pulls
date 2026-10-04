
/* BUMPED TO DROP EVERY OLD COPY. The activate step below deletes any cache
   whose name is not this one, so changing this number is what forces every
   phone out there to fetch the app shell fresh instead of trusting what it
   already has. Bump it whenever a stylesheet and a script have to land
   together -- they are separate downloads, and a phone holding yesterday's
   feed.css beside today's feed.js shows something neither of them describes. */
const CACHE = 'infinite-pulls-v296';   // v296: Turn on alerts step.   // v295: search-engine text hidden on ?page= pages.   // v294: one buzz, not a bunch (quiet alerts stack on one card).   // v293: Messages open; greeter.   // v292: the unclear list (Like, Sign up free / Log in, My Stuff, reward cards).   // v291: Make a Loop opens on two buttons.   // v290: an X on every sheet (no dead ends).   // v272: GO LIVE box, Twitch/YouTube/Discord on profiles.   // v270: honest box on sign-up (free today / planned for 2027).   // v269: password eye, Stay signed in, accounts stay in the switcher.   // v268: Loop card chip -> card post; picture-only tags.   // v267: report freeze.   // v266: request + report alerts.   // v265: phone alerts for messages.   // v264: Messages launch.   // v263: username sign-in, forgot password.   // v262: trades + Ask to chat.   // v261: Messages safety lane.   // v260: Messages first; links in chats.   // v259: no photos in Messages.   // v258: Loops in NEW POSTS.   // v257: Messages mark + profile button.   // v256: Message button on profiles.   // v255: sign-in card.   // v254: account switcher.   // v253: Messages style fix.   // v252: Terms, birthdays, age rules.   // v251: close buttons on full-screen layers.   // v250: Infinite Messenger private test.   // v249: tag the card in a Loop.   // v248: green/red sound buttons.   // v247: Loops show the whole video (no side crop); Loop maker welcome.   // v246: Loops live.   // v245: share the video.   // v244: Glow.   // v243: lens fixes.   // v242: widest zoom.   // v241: camera zoom fix.   // v240: lens art.   // v239: face lenses.   // v238: Loop voice changer.   // v237: pop-up repeats for testers.   // v236: Loop camera.   // v235: pop-up pictures.   // v234: Loops row up top, Loops tab, welcome pop-up.   // v233: Loop player sound button + tap to pause.   // v232: 6 Loop styles, movable text.   // v231: record video in the Loop maker.   // v230: Loop maker.   // v229: Reports / takedown screen.   // v228: Loops shrink to 720p before upload.   // v227: profile tabs survive a hiccup.   // v226: Loops play with sound.   // v225: Infinite Loops (15-second videos).   // v224: wall wording, open-in-app.   // v223: # picker, one page per tag.   // v222: join from shared post pages.   // v221: personal version tag v53.   // v220: smart tags.   // v219: online dots.   // v218: new tagline.   // v217: homepage readable by Google.   // v216: Photos tab is a grid.   // v215: photo posts survive a missing column.   // v214: soft wall on profiles for guests.   // v213: editions (1st Edition / Shadowless / Unlimited).   // v212: tag people in card stories.   // v211: @ picker in comments and captions.   // v210: card story in My Collection's Edit and on the card page.   // v209: sealed from imports goes to the Sealed tab.   // v208: Japanese set names for imports.   // v185: ADD speed dial -- Scan card / Make a post (phone picker first).   // v184: POST PIC; type the card number right in the camera.   // v183: camera -- POST MY PULL / SCAN A CARD / UPLOAD big across the top, one-time tip; + says POST.   // v182: Goals as a feed; Goals tab on profiles; old menu GOALS lands there.   // v181: the rail -- ME, GOALS, NEW POSTS, ALERTS.   // v180: My Photos shows all of your pictures.   // v179: Instagram camera -- SCAN / PHOTO / UPLOAD under one big shutter, flash, white blink, Share.   // v178: no add-a-photo tile on card posts.   // v177: Rewards tab drops the My.   // v176: a real flame on double-tap.   // v175: My Photos etc. on one line.   // v174: profile tabs Photos first, empty tabs hidden on others' pages.   // v173: My Cards / My ∞ Rewards / My Wants / My Photos; MY PROFILE in the menu.   // v172: works like Instagram -- double-tap heat, linked @names, Heat from, comment preview, follower lists, pull to refresh.   // v171: white join box with the collector tools.   // v170: JOIN FREE + the join box for guests.   // v169: profile tabs are words, not icons.   // v168: Start Here card shows once; no picture, no place in the feed.   // v167: My Account retired -- switches on My Collection, EDIT PROFILE in the menu; Show my value works again.   // v166: phone numbers (sign-up, My Account, Edit profile, one-time ask).   // v165: old pages' SHOP/COLLECTION/MENU open the feed's sheets in place; bell on the top bar, Install in the menu; wish list loads; CARDS count fixed.   // v164: bottom bar taps work again (data-page on <body> was swallowing every click); your face on MENU.   // v163: your face and @name under the wordmark, feed and old pages alike.   // v162: the old pages wear the feed's top bar and bottom menu; My Collection in the new look.   // v161: the grail card is retired.   // v160: CLAIM NOW is for the name badge only; reward cards arrive on their own again.   // v159: rewards wait to be claimed -- CLAIM NOW pill on your profile.   // v158: Infinite Feed title, full-circle app icon, no tabs on profiles.   // v157: a card in the profile grid opens their post over the profile.   // v156: card tiles open the card's page; rewards tab shows only earned cards + what was done.   // v155: $ on card tiles, EARNED + how-to-earn on reward tiles.   // v154: profile tabs -- cards, ∞ rewards, wish list, posts.   // v153: Instagram-style profile, Edit profile, real following with EVERYONE / FOLLOWING.   // v152: scan-to-follow QR codes.   // v151: @ search finds people, with card counts.   // v150: @handles in the feed.
const CORE = [
  /* WHAT THIS LIST IS FOR, WHICH IS NOT WHAT IT LOOKS LIKE.
     The fetch handler below is network-first and caches every GET it makes.
     So nothing here makes the app faster for somebody online -- they fetch
     the fresh copy regardless. This list is purely OFFLINE support, and it
     is paid for by everybody, at install, before the app is usable.

     It held 41 files and 1.16 MB: the whole old app, including collection.js
     at 286 KB, the card importer, the Pokedex and card-lookup. A first-time
     visitor opening the feed downloaded all of it in the background while
     waiting for the photographs they actually came to see -- and the feed's
     own files were not in here at all, which is backwards now that the feed
     is the front door.

     What is left is the two shells and the chrome they share. Everything
     else caches itself the first time somebody actually opens it.

     THE TRADE, written down: somebody who has never opened the collection
     page and then goes offline will not get it. They would not have got a
     working one anyway -- collection.js was the biggest thing in here and
     the page is nothing without it -- so what is really lost is an
     unstyled shell instead of a blank one. */
  './',
  './index.html',
  './404.html',
  './config.js',
  './manifest.json',

  /* the chrome every page of the old app boots with */
  './app.js',
  './components/auth-log.js',
  './components/topbar.js',
  './components/infinite-dex-switch.js',
  './components/navbar.js',
  './components/breadcrumb.js',
  './components/notify-invite.js',
  /* components/app-installed.js is deliberately NOT in this list. Its
     whole job is one RPC to Supabase, which cannot happen offline, so
     precaching it would charge every visitor a download at install for
     something that can do nothing without a network. The fetch handler
     below caches it the first time a page asks for it, like everything
     else. It also keeps addAll() -- which fails ENTIRELY if any one
     entry 404s -- from depending on a brand new file. */

  /* the feed, which is about to be the front door */
  './feed-next/',
  './feed-next/index.html',
  './feed-next/feed.js',
  './feed-next/feed.css',
  './components/card-photo.js',

  /* IMAGES IN HERE ARE DOWNLOADED BY EVERY VISITOR, EVERY TIME THE CACHE
     VERSION CHANGES. That is the whole install, before the app is usable,
     so this list earns its keep by staying short.

     What was here once: logo.png at 1.9 MB -- displayed at 50x50 in the top
     bar -- plus icon-512 (409 KB) and pokedex-512 (210 KB), which are
     install icons the manifest hands to the operating system and which no
     page ever renders. 2.6 MB of images to show a 50-pixel logo.

     Now: the small logo the top bar actually uses, and the icons the app
     genuinely draws. */
  './assets/logo-sm.webp',
  './assets/app-mark.png',          /* the app's own mark (2 Oct 2026); logo-sm is the store's */
  './assets/app-mark-inf.png',      /* the same mark without the word, for the top bar */
  './assets/icons/app-192.png',
  './assets/icons/pokedex-nav.png',
  './assets/icons/pokedex-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// The app's own HTML/CSS/JS are served by GitHub Pages with a ten-minute
// max-age, and this worker is network-first — but a plain fetch() still
// reads the browser's HTTP cache first, so for ten minutes after a deploy
// a reload kept serving the PREVIOUS build and new work looked like it had
// never shipped. Re-requesting the app shell with cache:'no-cache' forces a
// revalidation against the server instead: unchanged files come back as a
// cheap 304, changed ones come back fresh immediately. Everything else
// (card images, sprites, API calls) keeps normal HTTP caching.
const APP_SHELL_RE = /\.(?:js|css|json|html)$/i;

function appShellRequest(request){
  const url = new URL(request.url);
  if(url.origin !== self.location.origin) return request;
  // A DIRECTORY URL is an app-shell request too. /feed-next/ ends in a slash
  // and has no extension, so it fell through to GitHub Pages' ten-minute
  // max-age -- meaning a reload after a deploy could keep serving the old
  // page and look like the work had never shipped.
  if(url.pathname !== '/' && !url.pathname.endsWith('/')
     && !APP_SHELL_RE.test(url.pathname)) return request;
  return new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' });
}

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  event.respondWith(
    fetch(appShellRequest(event.request))
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html')))
  );
});

// ---- Push notifications ----
// The admin panel triggers a Supabase Edge Function, which sends each
// subscribed device a payload shaped like: { title, body, url }.
self.addEventListener('push', event => {
  let data = { title: 'Infinite Pulls', body: 'You have an update.', url: './' };
  if(event.data){
    try{ data = { ...data, ...event.data.json() }; }
    catch{ data.body = event.data.text() || data.body; }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './assets/icons/app-192.png',
      badge: './assets/icons/app-192.png',
      data: { url: data.url || './' },
      /* a chat's newest message replaces its older alert (28 Sep) */
      /* ONE BUZZ, NOT A BUNCH (3 Oct 2026): a quiet alert updates the card without a sound */
      ...(data.tag ? { tag: String(data.tag), renotify: !data.quiet, silent: !!data.quiet } : {})
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './', self.registration.scope).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for(const client of clientList){
        if(client.url === targetUrl && 'focus' in client) return client.focus();
      }
      if(self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
