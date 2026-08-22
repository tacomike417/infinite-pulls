
(function(){
  // EDIT THESE ARRAYS to change the app's navigation.
  // Labels here are exact, deliberate product names — "My Collection" and
  // "My Pokédex" specifically, never shortened to "Collection"/"Pokédex"
  // anywhere in the app (nav, headings, buttons, links, page titles).
  const primaryNav = [
    {page:'home',       label:'Home',         icon:'⌂'},
    {page:'shop',       label:'Shop',         icon:'🛒'},
    {page:'collection', label:'My Collection',icon:'▣'},
    {page:'pokedex',    label:'My Pokédex',   icon:'<span class="pokeball-icon"></span>'},
    {page:'events',     label:'Events',       icon:'★'},
    {page:'menu',       label:'Menu',         icon:'☰'}
  ];

  const menuNav = [
    {page:'account',  label:'My Account'},
    {page:'goals',    label:'Collector Goals'},
    {page:'deals',    label:'Deals & Specials'},
    {page:'location', label:'Location'},
    {page:'hours',    label:'Hours'},
    {page:'contact',  label:'Contact'},
    {page:'about',    label:'About Infinite Pulls'}
  ];

  function renderNavbar(activePage){
    const nav = document.getElementById('navbar');
    if(!nav) return;
    nav.innerHTML = primaryNav.map(item => {
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
    links.innerHTML = menuNav.map(item =>
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
    renderNavbar,
    renderMenu,
    openMenu,
    closeMenu
  };
})();
