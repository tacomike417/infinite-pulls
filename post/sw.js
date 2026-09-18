/* NETWORK FIRST. This app is three files and it changes while it is being
   built; cache-first is how "I deployed and nothing changed" happens. The
   cache is only there so it still opens on bad signal in the shop. */
const CACHE = 'hyde-bot-v2';
const CORE = ['./', './index.html', './styles.css?v=1', './app.js?v=1',
              './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  /* ONLY THIS FOLDER. The rest of infinitepulls.com is another app with its
     own worker, and answering for it from here would serve the wrong page. */
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL('./', location.href).pathname)) return;
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
