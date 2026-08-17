
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

function getStoreData(){
  try{
    return {...DEFAULT_DATA, ...(JSON.parse(localStorage.getItem('infinitePullsData')) || {})};
  }catch{
    return {...DEFAULT_DATA};
  }
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
        <a class="card" href="?page=collection" data-route="collection"><div class="card-icon">▣</div><strong>My Collection</strong><small>Collection tools are coming soon.</small></a>
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
    return `<section class="hero coming-soon">
      <span class="badge">COMING SOON</span>
      <h1>My Collection</h1>
      <p>We're leaving the collection system parked here until we're ready to build it correctly.</p>
    </section>`;
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
    return `<section class="hero"><div class="eyebrow">Store Hours</div><h1>Hours of Operation</h1>
      <div class="info-list">${Object.entries(data.hours || {}).map(([day,hours]) =>
        `<div class="info-row"><span>${escapeHtml(day)}</span><strong>${escapeHtml(hours)}</strong></div>`).join('')}
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

function currentPage(){
  return new URLSearchParams(location.search).get('page') || 'home';
}

function navigate(page, push=true){
  if(page === 'menu'){
    window.InfinitePullsNavbar.openMenu();
    return;
  }
  window.InfinitePullsNavbar.closeMenu();

  if(push){
    const url = new URL(location.href);
    if(page === 'home') url.searchParams.delete('page');
    else url.searchParams.set('page', page);
    history.pushState({page}, '', url);
  }

  renderPage(page);
}

function renderPage(page=currentPage()){
  const data = getStoreData();
  const content = document.getElementById('page-content');
  const renderer = pages[page] || pages.home;
  content.innerHTML = renderer(data);
  window.InfinitePullsNavbar.renderNavbar(page);
  content.focus({preventScroll:true});
  window.scrollTo({top:0, behavior:'instant'});
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
  if(e.target.closest('[data-close-menu]')){
    window.InfinitePullsNavbar.closeMenu();
  }
});

window.addEventListener('popstate', () => renderPage(currentPage()));

window.addEventListener('DOMContentLoaded', () => {
  window.InfinitePullsTopbar.init();
  window.InfinitePullsNavbar.renderMenu();
  renderPage();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./service-worker.js').catch(console.error);
  }
});
