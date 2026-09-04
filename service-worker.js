
const CACHE = 'infinite-pulls-v64';
const CORE = [
  './',
  './index.html',
  './404.html',
  './style.css',
  './config.js',
  './app.js',
  './components/topbar.js',
  // Before the navbar in index.html, and cached with it: the bar cannot
  // decide about the ∞ tab without it.
  './components/infinite-dex-switch.js',
  './components/navbar.js',
  './components/account.js',
  './components/pokemon-data.js',
  './components/pokemon-info.js',
  './components/collector-goals-data.js',
  './components/tcgdex-cache.js',
  './components/sealed.js',
  './components/collection-import-parse.js',
  './components/collection-import-resolve.js',
  './components/collection-import.js',
  './components/collection.js',
  './components/pokedex.js',
  './components/infinite-dex-data.js',
  './components/infinite-dex.js',
  './components/hello-bar.js',
  './components/collector-goals.js',
  './components/price-trend.js',
  './components/home-stats.js',
  './components/home-rails.js',
  './components/home-mine.js',
  './components/card-lookup.js',
  './components/gallery-image.js',
  './components/gallery.js',
  './components/profile.js',
  './manifest.json',

  /* IMAGES IN HERE ARE DOWNLOADED BY EVERY VISITOR, EVERY TIME THE CACHE
     VERSION CHANGES. That is the whole install, before the app is usable,
     so this list earns its keep by staying short.

     What was here: logo.png at 1.9 MB — displayed at 50x50 in the top bar —
     plus icon-512 (409 KB) and pokedex-512 (210 KB), which are install
     icons the manifest hands to the operating system and which no page
     ever renders. 2.6 MB of images to show a 50-pixel logo.

     Now: the small logo the top bar actually uses, and the icons the app
     genuinely draws. The 512s still exist and the manifest still points at
     them; the browser fetches them once at install time and they do not
     belong in the app shell. The 840px hero logo is fetched on demand on
     the home page and kept by the runtime cache below. */
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
  if(url.pathname !== '/' && !APP_SHELL_RE.test(url.pathname)) return request;
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
