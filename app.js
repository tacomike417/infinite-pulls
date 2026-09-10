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

/* THE SHELF LIVES IN components/shop.js.
 *
 * It grew from a flat alphabetical list into categories, pictures,
 * a product page each and a basket, which is more than belongs in the
 * middle of the router. This stays as the hook the page render calls. */
async function loadShopInventory(){
  if(window.InfinitePullsShop) window.InfinitePullsShop.init();
}

/* BUYING — see components/shop.js.
 *
 * This used to be a "Buy" button that went straight to a payment page,
 * one card at a time. Somebody buying three cards paid three times and
 * paid shipping three times. It is a basket now, and all of it -- the
 * cart, the sheet, the call to create-checkout -- lives in the shop
 * component beside the shelf it belongs to.
 *
 * SHIPPING_FLAT stays here because the receipt below still shows it. */
const SHIPPING_FLAT = 8;

/* COMING BACK FROM THE PAYMENT PAGE.
 *
 * THE CANCEL URL IS NOT ENOUGH, AND ASSUMING IT WAS COST US A CARD.
 *
 * The first version only let a hold go when Clover sent the customer to
 * the cancel URL. Then somebody backed out with the browser BACK button
 * -- which is how most people leave a payment page -- landed on the shop
 * with no `pay` flag at all, and the card stayed held. The next tap on
 * Buy said "that one just went", about a card sitting on the shelf.
 *
 * So the rule is not "did Clover tell us they cancelled". It is: if this
 * browser is holding a card and has arrived back here WITHOUT having
 * paid, the card goes back. Back button, closed tab, retyped address,
 * cancel link -- all the same thing, and all handled by looking at what
 * we are holding rather than at how they got here.
 *
 * Paid is deliberately still NOT decided here. A browser landing on a
 * success URL proves nothing and anybody could type it. Only the signed
 * webhook from Clover marks a sale. All `pay=ok` does is say thank you
 * and stop this from releasing a hold the webhook is about to settle.
 *
 * Releasing one that was in fact paid is harmless anyway:
 * release_shop_hold() only touches a hold still marked `held`, so a sale
 * the webhook has already recorded cannot be undone by a stale tab. */
/* THE ORDER THIS BROWSER IS IN THE MIDDLE OF, IF ANY.
   Reads the durable copy first and falls back to the per-tab one, so it
   works whichever way the trip out to Clover came home. Anything older
   than two hours is treated as not there at all. */
const HOLD_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function storedHoldId(){
  try {
    const raw = localStorage.getItem('ip-hold');
    if(raw){
      const o = JSON.parse(raw);
      if(o && o.id && (Date.now() - (o.at || 0)) < HOLD_MAX_AGE_MS) return o.id;
      localStorage.removeItem('ip-hold');
    }
  } catch(_){}
  try { return sessionStorage.getItem('ip-hold') || ''; } catch(_){ return ''; }
}

function clearStoredHold(){
  try { localStorage.removeItem('ip-hold'); } catch(_){}
  try { sessionStorage.removeItem('ip-hold'); } catch(_){}
}

/* A BASKET IS ONE ORDER, NOT THREE HOLDS.
   The browser could have remembered three hold ids. It would also have
   lost one, or come back from Clover in a different tab holding two of
   them, and a receipt cannot tell "you bought two cards" from "you bought
   three and I dropped one". One reference goes out, one order comes back.

   Same two-hour stamp as the single holds above, for the same reason: an
   id left over from last week must never resurface as somebody's
   receipt. */
function storedOrderRef(){
  try {
    const raw = localStorage.getItem('ip-order');
    if(raw){
      const o = JSON.parse(raw);
      if(o && o.ref && (Date.now() - (o.at || 0)) < HOLD_MAX_AGE_MS) return o.ref;
      localStorage.removeItem('ip-order');
    }
  } catch(_){}
  return '';
}

function clearStoredOrder(){
  try { localStorage.removeItem('ip-order'); } catch(_){}
}

async function handlePayReturn(){
  let params;
  try { params = new URLSearchParams(location.search); } catch(_){ params = null; }
  const pay = params ? params.get('pay') : null;

  const holdId = storedHoldId();
  const orderRef = storedOrderRef();

  /* THE THANK-YOU PAGE IS NOT A CANCELLATION.
     Clover sends a successful payment to ?page=thanks, which carries no
     `pay` flag -- so without this, arriving on the receipt would look
     exactly like walking away and would hand the card straight back.
     (release_shop_hold only touches a hold still marked `held`, so the
     webhook would have saved us anyway; relying on a race for that is
     not a plan.) */
  if(params && params.get('page') === 'thanks') return;

  // Nothing held and nothing to say: this is just an ordinary page load.
  if(!holdId && !orderRef && !pay) return;

  clearStoredHold();
  clearStoredOrder();
  if(pay !== 'ok' && supabaseClient){
    /* Both, because a browser can be carrying either: a basket from
       today, or a single hold from a sale made before the cart existed.
       Neither call can touch a paid row, so running both is safe. */
    if(orderRef){ try { await supabaseClient.rpc('release_cart', { p_ref: orderRef }); } catch(_){} }
    if(holdId){ try { await supabaseClient.rpc('release_shop_hold', { p_hold: holdId }); } catch(_){} }
  }

  /* Only say something when Clover actually sent them back with a flag.
     Somebody who wandered off and came back a minute later does not need
     a message about it -- the card is quietly back on the shelf, which
     is the whole point. */
  if(pay){
    const note = document.createElement('div');
    note.className = 'pay-note' + (pay === 'ok' ? ' is-good' : '');
    note.textContent = pay === 'ok'
      ? 'Thanks — your order is in. You will get a receipt from the shop by email.'
      : (pay === 'failed'
          ? 'That payment did not go through, and nothing was charged. Everything is back on the shelf.'
          : 'No problem — nothing was charged, and everything is back on the shelf.');

    const put = () => {
      const host = document.getElementById('shop-inventory-list');
      if(!host || !host.parentNode) return false;
      host.parentNode.insertBefore(note, host);
      return true;
    };
    if(!put()) setTimeout(put, 600);

    /* Take the flag out of the address bar so a refresh -- or a bookmark
       -- does not replay the message forever. */
    try {
      params.delete('pay');
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
    } catch(_){}
  }

  // Whatever just happened, the shelf on screen is out of date.
  setTimeout(loadShopInventory, 400);
}

/* ALSO ON THE WAY BACK THROUGH THE BFCACHE.
   Chrome restores a page from memory when you press Back, and a restored
   page does NOT run DOMContentLoaded again -- so the version that only
   listened for load missed exactly the case it was written for. */
window.addEventListener('pageshow', (e) => { if(e.persisted) handlePayReturn(); });

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', handlePayReturn);
else handlePayReturn();




function escapeHtml(value=''){
  return String(value).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

/* "AT THE SHOP" — the four boxes at the foot of the home page.
 *
 * WHY THIS IS A FUNCTION NOW
 *
 * Events and Deals have never been filled in. A box promising
 * "Tournaments, trade nights & releases" that opens onto "No events
 * posted yet" is worse than no box: somebody spends a tap to learn
 * nothing, and reads the three boxes beside it a little more sceptically
 * afterwards. So a box appears only when there is something behind it.
 *
 * It asks components/navbar.js the question rather than answering it here.
 * The menu hides the same two rows on the same condition, and two copies
 * of one rule is how the menu and the home page end up disagreeing about
 * whether Jeff has posted an event.
 *
 * ON DROPPING TO TWO. The four were chosen partly because four fills a
 * two-across grid with no orphan box. Two fills one row just as exactly.
 * Three would leave an odd box on a row of its own -- worth remembering if
 * a fifth is ever added, or if Shop is ever given the same treatment.
 *
 * The heading goes with them if the block ever empties completely, rather
 * than standing over nothing -- the same rule the menu applies to a group
 * whose every row is filtered out. */
function shopBlockHtml(){
  const nav = window.InfinitePullsNavbar;
  const has = (key) => (nav && typeof nav.hasContent === 'function')
    ? nav.hasContent(key)
    : true;   // cannot tell yet -> show it; see the note in navbar.js

  const boxes = [
    {page:'events',   icon:'★', label:'Events',   blurb:'Tournaments, trade nights & releases.', emptyKey:'events'},
    {page:'deals',    icon:'⚡', label:'Deals',    blurb:'Current specials and promos.',          emptyKey:'deals'},
    {page:'location', icon:'⌖', label:'Location', blurb:'Find the shop and get directions.'},
    {page:'hours',    icon:'◷', label:'Hours',    blurb:'See when we\'re open.'}
  ].filter(b => !b.emptyKey || has(b.emptyKey));

  if(!boxes.length) return '';

  return `
      <h2 class="rail-title shop-block-title">At the shop</h2>
      <section class="card-grid">
        ${boxes.map(b => `<a class="card" href="?page=${b.page}" data-route="${b.page}"><div class="card-icon">${b.icon}</div><strong>${escapeHtml(b.label)}</strong><small>${escapeHtml(b.blurb)}</small></a>`).join('')}
      </section>`;
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
      ${shopBlockHtml(data)}
    `;
  },

  /* THE PAGE IS THE SHELF, NOT A BUTTON TO SOMEWHERE ELSE.
   *
   * This used to open with developer copy -- "connect this button to the
   * shop's Clover storefront when ready" -- sitting above a real list of
   * real stock at real prices, on a page any customer could reach. It
   * said the shop was not set up yet directly above proof that it was.
   *
   * The storefront link is now optional furniture and only renders when
   * there is somewhere for it to go. A button with an empty href is a
   * dead end, and a dead end is the one thing every screen here is not
   * allowed to have. What the page leads with instead is the thing that
   * is actually true: this is what is on the shelf right now, taken
   * straight from the till. */
  shop(data){
    const url = String((data && data.shopUrl) || '').trim();
    return `<section class="hero">
      <div class="eyebrow">Shop</div><h1>Shop Infinite Pulls</h1>
      <p>Everything on the shelf right now, straight from the shop's till. Come in and grab it, or call ahead and we'll hold it.</p>
      ${url ? `<p><a class="primary-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open the full storefront</a></p>` : ''}
    </section>
    <section class="hero section">
      <div class="eyebrow">In Stock At The Shop</div>
      <h1>What's Available Now</h1>
      <div id="shop-inventory-list"><div class="empty-state">Loading…</div></div>
    </section>`;
  },

  /* ONE THING ON THE SHELF, at its own address.
   *
   * A route rather than a pop-up, and that is deliberate: ?page=item&id=
   * can be sent to somebody, opened on a laptop, and crawled. The whole
   * long game for this site is a real URL for every card. A modal has no
   * address and cannot be any of those things.
   *
   * Filled in by components/shop.js once it knows which item. */
  item(){
    return `<section id="shop-item-page" class="section"><div class="empty-state">Loading…</div></section>`;
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

  /* Card Lookup fills itself in — it has to check sign-in before it can
     draw anything, and the whole page is one component. Nothing renders
     here so the box is never on screen twice. */
  lookup(){
    return `<section id="lookup-page"><div class="empty-state">Loading…</div></section>`;
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

  /* THE ONE PAGE A STRANGER CAN READ IN FULL. No session check anywhere
     in it, deliberately -- see the header of components/movers.js. */
  movers(){
    return window.InfinitePullsMovers
      ? window.InfinitePullsMovers.shellHtml('<div class="empty-state">Loading the board…</div>')
      : `<section id="movers-page"><div class="empty-state">Loading…</div></section>`;
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
  },

  /* THE SCREEN AFTER PAYING.
   *
   * Clover's own confirmation is a number and a total. It does not say
   * whose shop it was, where it is, when it is open, or what happens
   * next -- which for a pickup order is the only thing that matters,
   * because it is the screen that tells somebody to get in a car.
   *
   * The order details land a moment later (they come from the database);
   * the shop details are already here and are painted immediately, so the
   * page is never blank and never useless even if the lookup fails.
   *
   * TWO WAYS OUT, at the bottom, always. A confirmation page somebody
   * cannot leave is the worst kind of dead end -- they have just paid. */
  thanks(data){
    const dayOrder = Object.keys(DEFAULT_DATA.hours);
    return `<section class="hero">
      <div class="eyebrow">Order confirmed</div>
      <h1>Thanks — you're all set.</h1>
      <div id="thanks-order"><div class="empty-state">Getting your order…</div></div>

      <article class="card section">
        <strong>${escapeHtml(data.storeName)}</strong>
        <p>${escapeHtml(data.address)}</p>
        <div class="info-list">
          <div class="info-row"><span>Phone</span><strong>${escapeHtml(data.phone)}</strong></div>
          <div class="info-row"><span>Email</span><strong>${escapeHtml(data.email)}</strong></div>
        </div>
        <p><a class="secondary-btn" href="${escapeHtml(data.mapUrl)}" target="_blank" rel="noopener">Get directions</a></p>
      </article>

      <article class="card section">
        <strong>When we're open</strong>
        <div class="info-list">${dayOrder.map(day =>
          `<div class="info-row"><span>${escapeHtml(day)}</span><strong>${escapeHtml((data.hours || {})[day] ?? '')}</strong></div>`).join('')}
        </div>
      </article>

      <div class="card-grid">
        <a class="card" href="?page=shop" data-route="shop"><strong>Back to the shop</strong><small>See what else is on the shelf</small></a>
        <a class="card" href="?page=home" data-route="home"><strong>Home</strong><small>Everything else</small></a>
      </div>
    </section>`;
  }
};

/* Fills in what they actually bought. Deliberately its own request:
   the page above is already on screen and useful before this returns,
   and a shop address is more use to somebody than a spinner. */
async function loadThanksOrder(){
  const host = document.getElementById('thanks-order');
  if(!host) return;

  const orderRef = storedOrderRef();
  const holdId   = storedHoldId();

  /* Nothing to go on means they typed the address, came from another
     device, or cleared the tab. Say something true rather than inventing
     an order. */
  if((!orderRef && !holdId) || !supabaseClient){
    host.innerHTML = `<article class="card section"><p>Your payment went through. Your receipt is on its way by email from the shop.</p></article>`;
    return;
  }

  /* MARK IT PAID FROM HERE.
     Clover's webhook verified its URL and then never fired on a real
     payment, so the redirect to this page is the only signal the shop
     actually receives. Both functions are fenced hard on the database
     side -- they can only move a row from `held` to `paid`, only within
     thirty minutes, and only with the random reference handed to this
     browser. They run before the summary so the receipt reads `paid` on
     the first try rather than after a refresh. */
  let rows = [];
  try{
    if(orderRef){
      await supabaseClient.rpc('confirm_cart', { p_ref: orderRef });
      const { data } = await supabaseClient.rpc('shop_cart_summary', { p_ref: orderRef });
      rows = Array.isArray(data) ? data : [];
    } else {
      await supabaseClient.rpc('confirm_order', { p_hold: holdId });
      const { data } = await supabaseClient.rpc('shop_order_summary', { p_hold: holdId });
      rows = Array.isArray(data) ? data : (data ? [data] : []);
    }
  }catch(_){ rows = []; }

  if(!rows.length){
    host.innerHTML = `<article class="card section"><p>Your payment went through. Your receipt is on its way by email from the shop.</p></article>`;
    return;
  }

  const ship = rows.some(r => r.fulfilment === 'ship');

  /* A LINE THAT DID NOT GET CHARGED HAS TO SAY SO.
     A hold that timed out while somebody dithered on the payment page
     stays marked `held` -- it is already back on the shelf and no money
     moved for it. Showing it in a receipt with no explanation is how
     somebody thinks they bought something they did not. */
  const paid = rows.filter(r => r.status === 'paid');
  const notPaid = rows.filter(r => r.status !== 'paid');

  const lineOf = (r) => {
    const price = typeof r.unit_price === 'number' ? r.unit_price : parseFloat(r.unit_price);
    return isFinite(price) ? price * (r.qty || 1) : null;
  };
  const goods = paid.reduce((sum, r) => sum + (lineOf(r) || 0), 0);
  const total = goods + (ship ? SHIPPING_FLAT : 0);

  host.innerHTML = `
    <article class="card section">
      <div class="info-list">
        ${paid.map(r => {
          const line = lineOf(r);
          return `<div class="info-row"><span>${escapeHtml(r.item_name || 'Your order')}${(r.qty || 1) > 1 ? ' × ' + r.qty : ''}</span><strong>${line !== null ? '$' + line.toFixed(2) : ''}</strong></div>`;
        }).join('')}
        ${ship ? `<div class="info-row"><span>Shipping</span><strong>$${SHIPPING_FLAT.toFixed(2)}</strong></div>` : ''}
        <div class="info-row"><span><strong>Total</strong></span><strong>$${total.toFixed(2)}</strong></div>
      </div>
      <p>${ship
        ? 'It will be posted to the address you gave Clover.'
        : 'It is set aside for you — come in whenever suits.'}</p>
      ${notPaid.length ? `<p class="thanks-dropped">${notPaid.map(r => escapeHtml(r.item_name || 'One item')).join(', ')} ${notPaid.length === 1 ? 'was' : 'were'} not charged — ${notPaid.length === 1 ? 'it' : 'they'} timed out before payment finished and ${notPaid.length === 1 ? 'is' : 'are'} back on the shelf.</p>` : ''}
      <p><small>Your receipt is on its way by email from the shop.</small></p>
    </article>`;
}

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
  'service-worker','home','shop','collection','pokedex','dex','goals','events','deals','lookup',
  'location','hours','contact','about','account','menu','gallery','pulls',
  /* A real folder of 364 static pages. Left claimable, somebody could
     register it and quietly shadow the whole section. */
  'infinite-questions'
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
  /* MY CARDS IS A SHEET, NOT A PAGE. Same shape as Menu above: the bar
     button opens something over the page rather than replacing it. */
  if(page === 'mine'){
    window.InfinitePullsNavbar.openMine();
    return;
  }
  /* THE WISH LIST IS A TAB ON MY COLLECTION, NOT A PAGE OF ITS OWN.
     It has always been the second tab there; it simply had no way into
     it from the bar. This sends somebody to that page with the tab
     already chosen, so "My Wish List" in the sheet lands where it says
     rather than on the collection tab with a chip to find and press. */
  if(page === 'wishlist'){
    window.InfinitePullsNavbar.closeMine();
    window.InfinitePullsNavbar.closeMenu();
    if(push){
      const url = new URL(location.href);
      url.pathname = '/';
      url.searchParams.set('page', 'collection');
      url.searchParams.set('tab', 'wishlist');
      history.pushState({page:'collection'}, '', url);
    }
    renderPage();
    return;
  }
  window.InfinitePullsNavbar.closeMine();
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
  window.InfinitePullsNavbar.closeMine();
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
  // Where you are, and one tap home. See components/breadcrumb.js for why
  // the bottom bar alone was not enough.
  window.InfinitePullsBreadcrumb?.render(page);
  // Re-drawn per page so the menu marks where you are.
  window.InfinitePullsNavbar.renderMenu();
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
  if(page === 'lookup' && window.InfinitePullsCardLookup) window.InfinitePullsCardLookup.init();
  if(page === 'movers' && window.InfinitePullsMovers) window.InfinitePullsMovers.init();
  if(page === 'goals' && window.InfinitePullsCollectorGoalsPage) window.InfinitePullsCollectorGoalsPage.init();
  if(page === 'shop') loadShopInventory();
  if(page === 'item' && window.InfinitePullsShop) window.InfinitePullsShop.initItem();
  if(page === 'thanks') loadThanksOrder();
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
      window.InfinitePullsNavbar.closeMine();
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
  if(e.target.closest('[data-close-mine]')){
    window.InfinitePullsNavbar.closeMine();
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