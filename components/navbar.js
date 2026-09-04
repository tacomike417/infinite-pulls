
(function(){
  // EDIT THESE ARRAYS to change the app's navigation.
  // Labels here are exact, deliberate product names — "My Collection" and
  // "My Pokédex" specifically, never shortened to "Collection"/"Pokédex"
  // anywhere in the app (nav, headings, buttons, links, page titles).
  const primaryNav = [
    {page:'home',       label:'Home',         icon:'⌂'},
    {page:'shop',       label:'Shop',         icon:'🛒'},
    {page:'collection', label:'My Collection',icon:'▣'},
    {page:'pokedex',    label:'My Pokédex',   icon:'<img src="/assets/icons/pokedex-nav.png" alt="" class="nav-img-icon">'},
    // Infinite Rewards took Events' place in the bar because it is the thing
    // that ties the shop and the app together — a code on a board in the
    // shop is worthless if nobody can find where to type it. Events moved
    // into the menu below rather than out of the app.
    {page:'dex',        label:'Infinite Rewards', icon:'∞'},
    {page:'menu',       label:'Menu',         icon:'☰'}
  ];

  const menuNav = [
    {page:'account',  label:'My Account'},
    {page:'goals',    label:'Badges'},   // the route stays 'goals'; only the word changed
    {page:'gallery',  label:'The Gallery'},
    {page:'events',   label:'Events'},
    {page:'deals',    label:'Deals & Specials'},
    {page:'location', label:'Location'},
    {page:'hours',    label:'Hours'},
    {page:'contact',  label:'Contact'},
    {page:'about',    label:'About Infinite Pulls'}
  ];

  /* Infinite Rewards can be switched off in the admin panel while the shop
     is not ready to run it — see components/infinite-dex-switch.js.
     When it is off, Events takes its slot back in the bar, which is where
     it lived before the Dex arrived, and drops out of the menu so it is
     never in both places at once. A bar with a gap in it looks broken; a
     bar with Events in it looks like a decision. */
  function dexOn(){
    const sw = window.InfinitePullsDexSwitch;
    return !sw || sw.dexOn();
  }

  function barItems(){
    if(dexOn()) return primaryNav;
    return primaryNav.map(item =>
      item.page === 'dex'
        ? {page:'events', label:'Events', icon:'★'}
        : item);
  }

  function menuItems(){
    return dexOn() ? menuNav : menuNav.filter(item => item.page !== 'events');
  }

  function renderNavbar(activePage){
    const nav = document.getElementById('navbar');
    if(!nav) return;
    nav.innerHTML = barItems().map(item => {
      const active = item.page === activePage ? ' active' : '';
      return `<button class="nav-item${active}" data-nav="${item.page}">
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${item.label}</span>
      </button>`;
    }).join('');
  }

  function renderMenu(){
    const links = document.getElementById('menu-links');
    if(!links) return;
    links.innerHTML = menuItems().map(item =>
      `<button class="menu-link" data-nav="${item.page}">${item.label}</button>`
    ).join('');
  }

  function openMenu(){
    const sheet = document.getElementById('menu-sheet');
    if(sheet) sheet.hidden = false;
  }

  function closeMenu(){
    const sheet = document.getElementById('menu-sheet');
    if(sheet) sheet.hidden = true;
  }

  window.InfinitePullsNavbar = {
    primaryNav,
    menuNav,
    barItems,
    menuItems,
    renderNavbar,
    renderMenu,
    openMenu,
    closeMenu
  };
})();
