
const CACHE = 'infinite-pulls-v28';
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
  './components/collection.js',
  './components/pokedex.js',
  './components/collector-goals.js',
  './components/profile.js',
  './manifest.json',
  './assets/logo.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
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

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
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
