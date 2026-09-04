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
  deals: [],
  shopLinksEnabled: true
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

// Populated once a Clover connection is set up in the admin panel (see
// supabase/SETUP.md) — until then, this just quietly shows nothing extra
// rather than an error, since most visitors will see this before that's
// configured.
async function loadShopInventory(){
  const listEl = document.getElementById('shop-inventory-list');
  if(!listEl || !supabaseClient) return;

  const { data, error } = await supabaseClient
    .from('shop_inventory')
    .select('name, price, stock_count')
    .order('name', { ascending: true });

  if(error || !data || !data.length){
    listEl.innerHTML = '<div class="empty-state">Nothing listed here yet — check back soon.</div>';
    return;
  }

  listEl.innerHTML = `<div class="card-grid">
    ${data.map(item => `
      <div class="card">
        <strong style="display:block">${escapeHtml(item.name)}</strong>
        <small>
          ${typeof item.price === 'number' ? '$' + item.price.toFixed(2) : 'Price unavailable'}
          ${typeof item.stock_count === 'number' ? ` · ${item.stock_count > 0 ? item.stock_count + ' in stock' : 'Out of stock'}` : ''}
        </small>
      </div>
    `).join('')}
  </div>`;
}

function escapeHtml(value=''){
  return String(value).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

const pages = {
  home(data){
    return `
      <!-- THE SCOREBOARD. Logo, then three numbers, then one button — and
           on a phone all of it lands above the fold, which is the point.
           Filled in by components/home-stats.js right after this renders;
           it draws zeros synchronously first so nothing shifts under a
           thumb. The store name and the "all in one mobile-ready app"
           line that used to live here are gone on purpose: the name is
           already in the top bar three lines above, and the sentence
           described the app to itself in the highest-value spot on the
           site. -->
      <section class="hero home-hero">
        <img class="hero-logo" src="/assets/logo.webp" alt="Infinite Pulls" width="420" height="420" decoding="async">
      </section>
      <div id="home-stats" class="home-stats" hidden></div>

      <!-- THE ANNOUNCEMENT IS HIDDEN ON THE HOME PAGE FOR NOW. It defaults
           to "Welcome to Infinite Pulls!", which costs a full-width strip
           of the first screen to tell somebody the name of the site they
           just opened -- it is written in the top bar, on the logo, and in
           the browser tab already. Nothing is deleted: store_info still
           holds the announcement and every other page still reads it. To
           bring the strip back, put the expression in the comment below
           back into the template. -->
      ${'' /* announcement hidden -- restore with:
           data.announcement ? `<div class="notice home-notice">${escapeHtml(data.announcement)}</div>` : '' */}

      <!-- The quick rail: six chips at thumb height, the sixth deliberately
           part-way off the right edge so the strip reads as scrollable.
           See components/home-rails.js for why that matters here. -->
      ${window.InfinitePullsHomeRails ? window.InfinitePullsHomeRails.quickRailHtml() : ''}

      ${window.InfinitePullsGallery ? window.InfinitePullsGallery.homeTileHtml() : ''}

      <!-- Jeff's tutorial videos, one and a half cards at a time. Renders
           nothing at all until he has added one. -->
      ${window.InfinitePullsHomeRails ? window.InfinitePullsHomeRails.videoRailHtml() : ''}

      <!-- My Collection / Collector Goals / Infinite Rewards, for somebody signed in
           who owns cards. Filled by components/home-mine.js after this
           renders; empty and invisible for everybody else. -->
      <div id="home-mine"></div>

      <!-- THE SHOP BLOCK. This was nine boxes, and five of them went where
           something else on this page already goes:

             Shop, My Collection, My Pokedex, Infinite Rewards -- all four
             are in the bar at the bottom of every screen, so the grid was
             the same menu a second time, in a bigger font.

             The Gallery -- its own tile is directly above this, with a
             real photo and a count on it. A text box pointing at the same
             page cannot compete with that and does not need to.

           What is left is the four things about the shop itself that are
           nowhere else on the home page, and four fills a two-across grid
           exactly -- no odd box on a row of its own. It gets a heading
           now, because a block about the shop deserves saying so on an
           app that opens with a collector's scoreboard. -->
      <h2 class="rail-title shop-block-title">At the shop</h2>
      <section class="card-grid">
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
    </section>
    <section class="hero section">
      <div class="eyebrow">In Stock At The Shop</div>
      <h1>What's Available Now</h1>
      <div id="shop-inventory-list"><div class="empty-state">Loading…</div></div>
    </section>`;
  },

  // Populated by components/gallery.js right after this renders — the
  // grid, the master switch and the submit form are all live data, same
  // reasoning as My Collection below.
  gallery(){
    return `<section id="gallery-page"><div class="empty-state">Loading…</div></section>`;
  },

  collection(){
    // Populated by components/collection.js right after this renders —
    // it needs to check sign-in state and load live data, which can't
    // happen synchronously like the rest of these page templates.
    return `<section id="collection-page"><div class="empty-state">Loading your collection…</div></section>`;
  },

  pokedex(){
    // Populated by components/pokedex.js right after this renders, same
    // reasoning as the My Collection page above — My Pokédex is entirely
    // derived from live My Collection data plus PokéAPI, both async.
    return `<section id="pokedex-page"><div class="empty-state">Loading My Pokédex…</div></section>`;
  },

  dex(){
    // Populated by components/infinite-dex.js right after this renders,
    // same as pokedex() and goals() above.
    return `<section id="dex-page"><div class="empty-state">Loading Infinite Rewards…</div></section>`;
  },

  goals(){
    // Populated by components/collector-goals.js right after this
    // renders, same reasoning as My Collection/My Pokédex above.
    return `<section id="goals-page"><div class="empty-state">Loading Collector Goals…</div></section>`;
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
    // Tagging the subscription with the signed-in visitor's id (if any)
    // is what lets check-price-alerts (see supabase/functions/) send a
    // price alert to just this one person's devices instead of every
    // subscriber — the admin banner blast keeps working the same either
    // way, since it just sends to every row regardless of user_id.
    const { data: { session } } = await supabaseClient.auth.getSession();

    // Goes through the save_push_subscription() Postgres function (see
    // supabase/schema.sql) instead of writing to the table directly. That
    // function runs with the table owner's privileges, so it can insert
    // without Postgres needing to grant this anonymous request any read
    // access back — avoids a rough edge where a direct upsert call can
    // require implicit SELECT visibility just to process the write.
    const { error } = await supabaseClient.rpc('save_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_user_id: session?.user?.id || null
    });

    if(error){ console.error('Could not save push subscription', error); return false; }
    return true;
  },

  // Covers the common case where someone turned notifications on before
  // ever creating an account: called from the account page once they're
  // signed in, so an already-subscribed device gets retroactively tagged
  // as theirs instead of staying anonymous forever.
  async retagCurrentSubscription(userId){
    if(!this.isSupported() || !userId) return;
    try{
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if(!sub) return;
      const json = sub.toJSON();
      await supabaseClient.rpc('save_push_subscription', {
        p_endpoint: json.endpoint,
        p_p256dh: json.keys.p256dh,
        p_auth: json.keys.auth,
        p_user_id: userId
      });
    }catch(err){
      console.error('Could not link this device\'s notifications to your account', err);
    }
  },

  async unsubscribe(){
    if(!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if(sub) await sub.unsubscribe();
  }
};

window.InfinitePullsPush = InfinitePullsPush;

// A device that turned notifications on before signing in stays tagged to
// nobody, and price alerts are sent per person — so that device never gets
// one. This used to be fixed only by visiting My Account; now any sign-in
// does it.
if(supabaseClient){
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if(session?.user?.id) InfinitePullsPush.retagCurrentSubscription(session.user.id);
  });
}

function currentPage(){
  return new URLSearchParams(location.search).get('page') || 'home';
}

// The Infinite Dex is switchable from the admin panel, because a shop that
// has not launched its rewards yet should not be showing customers a half
// of one. See components/infinite-dex-switch.js. Absent switch = on, so a
// missing script cannot take a live feature down.
function dexOn(){
  const sw = window.InfinitePullsDexSwitch;
  return !sw || sw.dexOn();
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
  'service-worker','home','shop','collection','pokedex','dex','goals','events','deals',
  'location','hours','contact','about','account','menu','gallery','pulls'
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
  // One photo from the gallery: infinitepulls.com/pulls/<slug>. This is the
  // address Jeff pastes into Facebook, so it is a real path and not a query
  // string — and the static page builder writes a genuine HTML file here so
  // that the crawler, which does not run any of this JavaScript, still gets
  // the right preview card. What follows is what a PERSON sees at the same
  // address once the app has booted.
  if(segments.length === 2 && segments[0].toLowerCase() === 'pulls' && /^[a-z0-9-]{1,80}$/i.test(segments[1])){
    return { type: 'pull', slug: segments[1].toLowerCase() };
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
// The Dex switch redraws the page when it turns out to disagree with the
// cached answer it painted with.
window.InfinitePullsApp = { currentPage, renderPage, dexOn, storeData: getStoreData };

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

  if(route && route.type === 'pull'){
    content.innerHTML = `<section id="gallery-page"><div class="empty-state">Loading…</div></section>`;
    window.InfinitePullsNavbar.renderNavbar(null);
    content.focus({preventScroll:true});
    window.scrollTo({top:0, behavior:'instant'});
    if(window.InfinitePullsGallery) window.InfinitePullsGallery.initPhoto(route.slug);
    return;
  }

  let page = currentPage();
  // An old bookmark, a QR code still on a board, or a shared link, after
  // the Dex was switched off. Home rather than an empty page or a 404 --
  // nothing is broken, the feature is simply not running.
  if(page === 'dex' && !dexOn()) page = 'home';
  const data = getStoreData();
  const renderer = pages[page] || pages.home;
  content.innerHTML = renderer(data);
  window.InfinitePullsNavbar.renderNavbar(page);
  content.focus({preventScroll:true});
  window.scrollTo({top:0, behavior:'instant'});

  // Pages with their own live/async data hydrate themselves right after
  // the shell above renders — same pattern as initBanner()/loadStoreData().
  if(page === 'account' && window.InfinitePullsAccount) window.InfinitePullsAccount.init();
  if(page === 'gallery' && window.InfinitePullsGallery) window.InfinitePullsGallery.init();
  // The tile is drawn from a cached answer so the home page does not reflow
  // under somebody's thumb; this fills in the actual newest photo.
  // The signed-out "Sign up free / Log in" strip hides itself on the
  // account page. No query -- it only re-checks which page this is.
  if(window.InfinitePullsHelloBar) window.InfinitePullsHelloBar.applyPage();
  if(page === 'home' && window.InfinitePullsHomeStats) window.InfinitePullsHomeStats.init();
  if(page === 'home' && window.InfinitePullsHomeRails) window.InfinitePullsHomeRails.init();
  if(page === 'home' && window.InfinitePullsHomeMine) window.InfinitePullsHomeMine.mount();
  if(page === 'home' && window.InfinitePullsGallery) window.InfinitePullsGallery.fillHomeTile();
  if(page === 'collection' && window.InfinitePullsCollection) window.InfinitePullsCollection.init();
  if(page === 'pokedex' && window.InfinitePullsPokedex){
    // A deep link like ?page=pokedex&dex=6 (e.g. the "View in My Pokédex"
    // link on a card's own "About [Pokémon]" section) opens straight to
    // that Pokémon's detail view instead of the main grid — see the
    // data-route click handling below for how that extra query param
    // survives navigate()'s normal "just set ?page=" behavior.
    const focusDex = new URLSearchParams(location.search).get('dex');
    window.InfinitePullsPokedex.init(focusDex ? Number(focusDex) : null);
  }
  // A card earned on another page announces itself the next time the
  // visitor moves anywhere. One cheap call; the usual answer is nothing.
  // sweep() checks the switch itself, so this line did not need to learn
  // about it -- see components/infinite-dex.js.
  if(page !== 'dex' && window.InfinitePullsDex) window.InfinitePullsDex.sweep();

  if(page === 'dex' && window.InfinitePullsDex){
    // ?page=dex&code=GRANDOPENING fills the claim box in and claims it on
    // arrival, so a QR code on a board in the shop is the whole journey.
    const code = new URLSearchParams(location.search).get('code');
    window.InfinitePullsDex.init(code || null);
  }
  if(page === 'goals' && window.InfinitePullsCollectorGoalsPage) window.InfinitePullsCollectorGoalsPage.init();
  if(page === 'shop') loadShopInventory();
}

document.addEventListener('click', (e) => {
  // The Scanner chip on the home rail. It is a real link to My Collection
  // underneath (so middle-click and open-in-new-tab work), but a plain tap
  // goes one step further and opens the camera picker on arrival.
  const scan = e.target.closest('[data-scan]');
  if(scan && window.InfinitePullsCollection && window.InfinitePullsCollection.scan){
    e.preventDefault();
    window.InfinitePullsCollection.scan();
    return;
  }

  const nav = e.target.closest('[data-nav]');
  if(nav){
    e.preventDefault();
    navigate(nav.dataset.nav);
    return;
  }
  const route = e.target.closest('[data-route]');
  if(route){
    e.preventDefault();
    // navigate() only ever sets `?page=`, which is right for a plain
    // page link — but a link can carry extra query params of its own
    // (e.g. href="?page=pokedex&dex=6" from a card's "About [Pokémon]"
    // section, deep-linking straight to that Pokémon) that a bare
    // navigate(page) call would silently drop. When the href has more
    // than just `page` on it, push it through as-is instead.
    const href = route.getAttribute('href');
    const extraParams = href && new URL(href, location.origin).searchParams;
    const hasExtraParams = extraParams && [...extraParams.keys()].some(k => k !== 'page');
    if(hasExtraParams){
      const url = new URL(href, location.origin);
      url.pathname = '/';
      window.InfinitePullsNavbar.closeMenu();
      history.pushState({page: route.dataset.route}, '', url);
      renderPage();
    } else {
      navigate(route.dataset.route);
    }
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