const DEFAULT_DATA = {
  storeName: "Infinite Pulls",
  tagline: "TCG & Hobby Shop",
  announcement: "Welcome to Infinite Pulls!",
  shopUrl: "#",
  address: "Store address coming soon",
  mapUrl: "#",
  phone: "Phone coming soon",
  email: "Email coming soon",
  facebook: "#",
  instagram: "#",
  about: "Infinite Pulls is your local TCG and hobby shop.",
  hours: {
    Monday:"Coming soon", Tuesday:"Coming soon", Wednesday:"Coming soon",
    Thursday:"Coming soon", Friday:"Coming soon", Saturday:"Coming soon", Sunday:"Coming soon"
  },
  events: [],
  deals: []
};

// Filled in once loadStoreData() finishes (see below). Store Info/Hours/
// Events/Deals used to live only in this browser's localStorage — they're
// now published from Supabase, same as the banner, so every visitor sees
// the same thing. localStorage is kept only as a fallback for the moment
// right after page load, before the live data has arrived.
let liveStoreData = null;

function getStoreData(){
  if(liveStoreData) return {...DEFAULT_DATA, ...liveStoreData};
  try{
    return {...DEFAULT_DATA, ...(JSON.parse(localStorage.getItem('infinitePullsData')) || {})};
  }catch{
    return {...DEFAULT_DATA};
  }
}

async function loadStoreData(){
  if(!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from('store_info')
    .select('data')
    .eq('id', 1)
    .maybeSingle();

  if(error || !data || !data.data || !Object.keys(data.data).length) return;
  liveStoreData = data.data;
  renderPage();
}

function escapeHtml(value=''){
  return String(value).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

const pages = {
  home(data){
    return `
      <section class="hero">
        <img class="hero-logo" src="./assets/logo.png" alt="Infinite Pulls">
        <div class="eyebrow">TCG & Hobby Shop</div>
        <h1>${escapeHtml(data.storeName)}</h1>
        <div class="notice">${escapeHtml(data.announcement)}</div>
        <p>Cards, collectibles, events, deals, and more — all in one mobile-ready app.</p>
      </section>

      <section class="card-grid">
        <a class="card" href="?page=shop" data-route="shop"><div class="card-icon">🛒</div><strong>Shop</strong><small>Browse Infinite Pulls.</small></a>
        <a class="card" href="?page=collection" data-route="collection"><div class="card-icon">▣</div><strong>My Collection</strong><small>Track your cards and see what they're worth.</small></a>
        <a class="card" href="?page=events" data-route="events"><div class="card-icon">★</div><strong>Events</strong><small>Tournaments, trade nights & releases.</small></a>
        <a class="card" href="?page=deals" data-route="deals"><div class="card-icon">⚡</div><strong>Deals</strong><small>Current specials and promos.</small></a>
        <a class="card" href="?page=location" data-route="location"><div class="card-icon">⌖</div><strong>Location</strong><small>Find the shop and get directions.</small></a>
        <a class="card" href="?page=hours" data-route="hours"><div class="card-icon">◷</div><strong>Hours</strong><small>See when we're open.</small></a>
      </section>
    `;
  },

  shop(data){
    return `<section class="hero">
      <div class="eyebrow">Shop</div><h1>Shop Infinite Pulls</h1>
      <p>Connect this button to the shop's Clover storefront or other online store when ready.</p>
      <p><a class="primary-btn" href="${escapeHtml(data.shopUrl)}" target="_blank" rel="noopener">Open Shop</a></p>
    </section>`;
  },

  collection(){
    // Populated by components/collection.js right after this renders —
    // it needs to check sign-in state and load live data, which can't
    // happen synchronously like the rest of these page templates.
    return `<section id="collection-page"><div class="empty-state">Loading your collection…</div></section>`;
  },

  account(){
    // Populated by components/account.js right after this renders, same
    // reasoning as the collection page above.
    return `<section id="account-page"><div class="empty-state">Loading…</div></section>`;
  },

  events(data){
    const items = Array.isArray(data.events) ? data.events : [];
    return `<section class="hero"><div class="eyebrow">Events</div><h1>Upcoming Events</h1>
      ${items.length ? items.map(x => `<article class="card section"><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.date || '')}</small><p>${escapeHtml(x.description || '')}</p></article>`).join('') : '<div class="empty-state">No events posted yet.</div>'}
    </section>`;
  },

  deals(data){
    const items = Array.isArray(data.deals) ? data.deals : [];
    return `<section class="hero"><div class="eyebrow">Deals</div><h1>Deals & Specials</h1>
      ${items.length ? items.map(x => `<article class="card section"><strong>${escapeHtml(x.title)}</strong><p>${escapeHtml(x.description || '')}</p></article>`).join('') : '<div class="empty-state">No specials posted yet.</div>'}
    </section>`;
  },

  location(data){
    return `<section class="hero"><div class="eyebrow">Visit</div><h1>Location</h1>
      <p>${escapeHtml(data.address)}</p>
      <p><a class="secondary-btn" href="${escapeHtml(data.mapUrl)}" target="_blank" rel="noopener">Get Directions</a></p>
    </section>`;
  },

  hours(data){
    // Always list days Monday→Sunday, regardless of what order the
    // stored data's keys come back in. Postgres's jsonb column type does
    // not preserve object key order (it re-sorts on write), so reading
    // straight off Object.entries(data.hours) here could show days out
    // of order even though the admin panel always saves them correctly.
    const dayOrder = Object.keys(DEFAULT_DATA.hours);
    return `<section class="hero"><div class="eyebrow">Store Hours</div><h1>Hours of Operation</h1>
      <div class="info-list">${dayOrder.map(day =>
        `<div class="info-row"><span>${escapeHtml(day)}</span><strong>${escapeHtml((data.hours || {})[day] ?? '')}</strong></div>`).join('')}
      </div>
    </section>`;
  },

  contact(data){
    return `<section class="hero"><div class="eyebrow">Contact</div><h1>Get in Touch</h1>
      <div class="info-list">
        <div class="info-row"><span>Phone</span><strong>${escapeHtml(data.phone)}</strong></div>
        <div class="info-row"><span>Email</span><strong>${escapeHtml(data.email)}</strong></div>
      </div>
      <div class="card-grid">
        <a class="card" href="${escapeHtml(data.facebook)}" target="_blank" rel="noopener"><strong>Facebook</strong></a>
        <a class="card" href="${escapeHtml(data.instagram)}" target="_blank" rel="noopener"><strong>Instagram</strong></a>
      </div>
    </section>`;
  },

  about(data){
    return `<section class="hero"><div class="eyebrow">About</div><h1>Infinite Pulls</h1><p>${escapeHtml(data.about)}</p></section>`;
  }
};

// ---- Supabase (banner + push notifications) ----
// If config.js hasn't been filled in yet with a real project, these features
// quietly no-op instead of throwing — the rest of the app works either way.
const supabaseConfig = window.InfinitePullsConfig || {};
const supabaseReady = !!(
  supabaseConfig.SUPABASE_URL &&
  !supabaseConfig.SUPABASE_URL.includes('YOUR-PROJECT-REF') &&
  supabaseConfig.SUPABASE_ANON_KEY &&
  !supabaseConfig.SUPABASE_ANON_KEY.includes('YOUR-SUPABASE')
);

// storageKey: a distinct key from the admin panel's client — both live on
// the same origin and the same Supabase project, so without this a
// customer's login and an admin's login would silently overwrite each
// other in the browser's shared storage. Giving each client its own key
// keeps a signed-in admin and a signed-in customer completely separate,
// even in two tabs of the same browser.
//
// detectSessionInUrl: true — required for email confirmation links to
// work. When someone signs up, confirms via the emailed link, and lands
// back on the site, Supabase appends their new session to that URL; this
// tells the client to actually pick it up and sign them in automatically
// instead of leaving them looking logged-out on an empty form.
const supabaseClient = (supabaseReady && window.supabase)
  ? window.supabase.createClient(supabaseConfig.SUPABASE_URL, supabaseConfig.SUPABASE_ANON_KEY, {
      auth: { storageKey: 'infinite-pulls-app-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

// Shared with components/account.js, components/collection.js, and
// components/profile.js so they don't each open a second, separate
// connection. `ready` also requires supabaseClient to actually exist —
// supabaseReady alone only means the config looks filled in; if the
// supabase-js script itself fails to load (CDN hiccup, ad blocker, etc.)
// supabaseClient stays null even though supabaseReady is true, and every
// page that trusted `ready` to mean "safe to call client().auth..." would
// otherwise crash instead of falling back to their "not connected" state.
window.InfinitePullsSupabase = { client: supabaseClient, config: supabaseConfig, ready: supabaseReady && !!supabaseClient };

// ---- Top banner ----
// The banner's "updated_at" acts as its version. Closing it only remembers
// that exact version, so publishing a new banner in the admin panel always
// shows again even if the visitor closed a previous one.
const BANNER_DISMISSED_KEY = 'infinitePullsBannerDismissed';

async function initBanner(){
  if(!supabaseClient) return;
  const bannerEl = document.getElementById('site-banner');
  const textEl = document.getElementById('site-banner-text');
  const closeBtn = document.getElementById('site-banner-close');
  if(!bannerEl || !textEl || !closeBtn) return;

  const { data, error } = await supabaseClient
    .from('banner')
    .select('message, active, updated_at')
    .eq('id', 1)
    .maybeSingle();

  if(error || !data || !data.active || !data.message) return;

  const dismissedVersion = localStorage.getItem(BANNER_DISMISSED_KEY);
  if(dismissedVersion === data.updated_at) return;

  textEl.textContent = data.message;
  bannerEl.hidden = false;

  closeBtn.addEventListener('click', () => {
    localStorage.setItem(BANNER_DISMISSED_KEY, data.updated_at);
    bannerEl.hidden = true;
  }, { once: true });
}

// ---- Push notifications ----
function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

const InfinitePullsPush = {
  isSupported(){
    return supabaseReady && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  },

  getPermission(){
    return ('Notification' in window) ? Notification.permission : 'unsupported';
  },

  async isSubscribed(){
    if(!this.isSupported()) return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  },

  // Returns true on success, false if the visitor declined or something
  // went wrong. Safe to call from a click handler any time.
  async subscribe(){
    if(!this.isSupported()) return false;

    const permission = await Notification.requestPermission();
    if(permission !== 'granted') return false;

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if(!sub){
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(supabaseConfig.VAPID_PUBLIC_KEY)
      });
    }

    const json = sub.toJSON();
    // Goes through the save_push_subscription() Postgres function (see
    // supabase/schema.sql) instead of writing to the table directly. That
    // function runs with the table owner's privileges, so it can insert
    // without Postgres needing to grant this anonymous request any read
    // access back — avoids a rough edge where a direct upsert call can
    // require implicit SELECT visibility just to process the write.
    const { error } = await supabaseClient.rpc('save_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth
    });

    if(error){ console.error('Could not save push subscription', error); return false; }
    return true;
  },

  async unsubscribe(){
    if(!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if(sub) await sub.unsubscribe();
  }
};

window.InfinitePullsPush = InfinitePullsPush;

function currentPage(){
  return new URLSearchParams(location.search).get('page') || 'home';
}

// ---- Public profile routing ----
// A customer's public collector page lives at a clean path —
// infinitepulls.com/username — instead of a query string, so it's easy to
// share. A single card within that collection goes one level deeper:
// infinitepulls.com/username/collection/card-slug. GitHub Pages has no
// server-side routing, so a direct visit to either path 404s unless it's
// redirected back through index.html first; see 404.html for that half,
// and the DOMContentLoaded handler below for where the redirect gets
// restored to a clean URL again.
const RESERVED_USERNAMES = new Set([
  'admin','assets','components','supabase','api','www','null','undefined',
  'favicon','index','readme','cname','app','style','config','manifest',
  'service-worker','home','shop','collection','events','deals','location',
  'hours','contact','about','account','menu'
]);

function isValidUsernameSegment(segment){
  return /^[A-Za-z0-9_-]{3,24}$/.test(segment) && !RESERVED_USERNAMES.has(segment.toLowerCase());
}

// Returns null for a normal in-app page (query-string routing takes over),
// or a route object describing a public profile / card-detail path.
function currentRoute(){
  const segments = location.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if(segments.length === 1 && isValidUsernameSegment(segments[0])){
    return { type: 'profile', username: segments[0] };
  }
  if(segments.length === 3 && segments[1].toLowerCase() === 'collection' && isValidUsernameSegment(segments[0])){
    return { type: 'card', username: segments[0], slug: segments[2] };
  }
  return null;
}

function navigate(page, push=true){
  if(page === 'menu'){
    window.InfinitePullsNavbar.openMenu();
    return;
  }
  window.InfinitePullsNavbar.closeMenu();

  if(push){
    const url = new URL(location.href);
    url.pathname = '/'; // leave any public-profile path behind
    if(page === 'home') url.searchParams.delete('page');
    else url.searchParams.set('page', page);
    history.pushState({page}, '', url);
  }

  renderPage();
}

// For SPA-style transitions between public-profile paths (a profile page
// linking to one of its cards, a card page linking back) — same idea as
// navigate() above, just for path-based routes instead of query-string ones.
function navigateToPath(path, push=true){
  window.InfinitePullsNavbar.closeMenu();
  if(push) history.pushState(null, '', path);
  renderPage();
}
window.InfinitePullsNavigateToPath = navigateToPath;

function renderPage(){
  const content = document.getElementById('page-content');
  const route = currentRoute();

  if(route && route.type === 'profile'){
    content.innerHTML = `<section id="profile-page"><div class="empty-state">Loading…</div></section>`;
    window.InfinitePullsNavbar.renderNavbar(null);
    content.focus({preventScroll:true});
    window.scrollTo({top:0, behavior:'instant'});
    if(window.InfinitePullsProfile) window.InfinitePullsProfile.init(route.username);
    return;
  }

  if(route && route.type === 'card'){
    content.innerHTML = `<section id="profile-page"><div class="empty-state">Loading…</div></section>`;
    window.InfinitePullsNavbar.renderNavbar(null);
    content.focus({preventScroll:true});
    window.scrollTo({top:0, behavior:'instant'});
    if(window.InfinitePullsProfile) window.InfinitePullsProfile.initCard(route.username, route.slug);
    return;
  }

  const page = currentPage();
  const data = getStoreData();
  const renderer = pages[page] || pages.home;
  content.innerHTML = renderer(data);
  window.InfinitePullsNavbar.renderNavbar(page);
  content.focus({preventScroll:true});
  window.scrollTo({top:0, behavior:'instant'});

  // Pages with their own live/async data hydrate themselves right after
  // the shell above renders — same pattern as initBanner()/loadStoreData().
  if(page === 'account' && window.InfinitePullsAccount) window.InfinitePullsAccount.init();
  if(page === 'collection' && window.InfinitePullsCollection) window.InfinitePullsCollection.init();
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if(nav){
    e.preventDefault();
    navigate(nav.dataset.nav);
    return;
  }
  const route = e.target.closest('[data-route]');
  if(route){
    e.preventDefault();
    navigate(route.dataset.route);
    return;
  }
  // Links between public-profile paths (a card in someone's collection,
  // or "back to their page") — handled client-side for a smooth transition
  // instead of a full page reload. Plain links without this attribute
  // (e.g. the "open in a new tab" link on My Account) are left alone.
  const pathLink = e.target.closest('[data-path]');
  if(pathLink){
    e.preventDefault();
    navigateToPath(pathLink.getAttribute('href'));
    return;
  }
  if(e.target.closest('[data-close-menu]')){
    window.InfinitePullsNavbar.closeMenu();
  }
});

window.addEventListener('popstate', () => renderPage());

window.addEventListener('DOMContentLoaded', () => {
  // If 404.html just bounced a direct visit to a public profile path
  // (e.g. someone opened infinitepulls.com/username fresh, or refreshed
  // it), restore the real clean URL before rendering anything, so both
  // the route below and the browser's address bar are correct.
  const redirectPath = sessionStorage.getItem('ip-redirect-path');
  if(redirectPath){
    sessionStorage.removeItem('ip-redirect-path');
    history.replaceState(null, '', redirectPath);
  }

  window.InfinitePullsTopbar.init();
  window.InfinitePullsNavbar.renderMenu();
  renderPage();
  initBanner();
  loadStoreData();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./service-worker.js').catch(console.error);
  }
});