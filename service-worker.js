
const CACHE = 'infinite-pulls-v36';
const CORE = [
  './',
  './index.html',
  './404.html',
  './style.css',
  './config.js',
  './app.js',
  './components/topbar.js',
  './components/navbar.js',
  './components/account.js',
  './components/pokemon-data.js',
  './components/pokemon-info.js',
  './components/collector-goals-data.js',
  './components/sealed.js',
  './components/collection.js',
  './components/pokedex.js',
  './components/collector-goals.js',
  './components/profile.js',
  './manifest.json',
  './assets/logo.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/pokedex-nav.png',
  './assets/icons/pokedex-32.png',
  './assets/icons/pokedex-192.png',
  './assets/icons/pokedex-512.png'
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
