
/* BUMPED TO DROP EVERY OLD COPY. The activate step below deletes any cache
   whose name is not this one, so changing this number is what forces every
   phone out there to fetch the app shell fresh instead of trusting what it
   already has. Bump it whenever a stylesheet and a script have to land
   together -- they are separate downloads, and a phone holding yesterday's
   feed.css beside today's feed.js shows something neither of them describes. */
const CACHE = 'infinite-pulls-v127';
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
  './assets/icons/icon-192.png',
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
      icon: './assets/icons/icon-192.png',
      badge: './assets/icons/icon-192.png',
      data: { url: data.url || './' }
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
