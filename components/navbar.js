
(function(){
  // EDIT THESE ARRAYS to change the app's navigation.
  // Labels here are exact, deliberate product names — "My Collection" and
  // "My Pokédex" specifically, never shortened to "Collection"/"Pokédex"
  // anywhere in the app (nav, headings, buttons, links, page titles).
  const primaryNav = [
    {page:'home',       label:'Home',         icon:'⌂'},
    /* SHOP IS BACK, 9 Sep 2026, and back in the slot beside Home.
       It lost its place in September because it pointed at an empty page:
       the Clover sync had never run and there was nothing on the shelf.
       That is fixed -- there are 190 things in it, it keeps itself in
       step with the till on its own, and it is the only screen in the app
       that takes money. It earns the slot now. */
    {page:'shop',       label:'Shop',         icon:'🛍'},
    {page:'lookup',     label:'Card Lookup',  icon:'🔍'},
    /* ONE BUTTON FOR EVERYTHING THAT IS THEIRS.
       My Collection, Wish List, My Pokedex and Infinite Rewards were four
       separate slots fighting over a phone-width bar -- and every one of
       them is the same sentence: "the cards I have." Five labels fit
       across a phone; six truncate. So they are one button that opens a
       small sheet, which buys back the slot Shop needed and puts the Wish
       List in the bar for the first time -- it was never there at all. */
    {page:'mine',       label:'My Cards',     icon:'▣', sheet:true},
    {page:'menu',       label:'Menu',         icon:'☰'}
  ];

  /* WHAT IS BEHIND "MY CARDS".
     Half a sheet, not a whole screen: it opens over the page rather than
     replacing it, so picking the wrong one costs a tap rather than a page
     load and a trip back. Infinite Rewards drops out of here when the
     shop has it switched off, exactly as it used to drop out of the bar. */
  const mineNav = [
    {page:'collection', label:'My Collection', sub:'Cards you own',            icon:'▣'},
    {page:'wishlist',   label:'My Wish List',  sub:'Cards you are after',      icon:'☆'},
    {page:'pokedex',    label:'My Pokédex',    sub:'Every Pokémon you have caught',
      icon:'<img src="/assets/icons/pokedex-nav.png" alt="" class="nav-img-icon">'},
    {page:'dex',        label:'My Infinite Rewards', sub:'Shop cards and prizes', icon:'∞', dexOnly:true}
  ];

  /* The menu, in two groups. Nine equal-weight rows is a list; two
     headings make it a map. "Your stuff" is what somebody came here to
     do, "The shop" is what they came here to find out. */
  const menuNav = [
    {group:'Your stuff'},
    {page:'account',  label:'My Account'},
    {page:'goals',    label:'Collector Goals'},   // the route matches the word again
    {page:'movers',   label:'Movers & Shakers'},  // public: readable with no account
    {group:'The shop'},
    // Shop came back to the bar on 9 Sep 2026, so it is not repeated here.
    {page:'gallery',  label:'The Gallery'},
    /* HIDDEN UNTIL THERE IS SOMETHING BEHIND THEM.
       Neither of these has ever been filled in, and a menu row leading to
       "No events posted yet" is worse than no row: somebody taps it,
       learns nothing, and trusts the next row slightly less. `emptyKey`
       names the array in store_info that has to have something in it for
       the row to appear. Jeff adds one event and Events comes back on its
       own -- there is nothing to remember to switch on. */
    {page:'events',   label:'Events',           emptyKey:'events'},
    {page:'deals',    label:'Deals & Specials', emptyKey:'deals'},
    {page:'location', label:'Location'},
    {page:'hours',    label:'Hours'},
    {page:'contact',  label:'Contact'},
    {page:'about',    label:'About Infinite Pulls'}
  ];

  /* Infinite Rewards can be switched off in the admin panel while the shop
     is not ready to run it — see components/infinite-dex-switch.js.
     When it is off, that slot now simply CLOSES UP.
     It used to hand the slot to Events, which put six items across a
     phone: five labels fit, six get cramped and start truncating. And
     there are no events planned, so a permanent slot was pointing at an
     empty page — the same mistake the Shop slot made before it.
     Events keeps its row in the menu either way, so nothing became
     unreachable; it just stopped taking a sixth of the bar to say so. */
  function dexOn(){
    const sw = window.InfinitePullsDexSwitch;
    return !sw || sw.dexOn();
  }

  /* The bar is fixed at five now. Infinite Rewards being switched off no
     longer changes the bar at all -- it only drops out of the sheet
     behind My Cards, where it lives. */
  function barItems(){
    return primaryNav;
  }

  function mineItems(){
    return mineNav.filter(item => !item.dexOnly || dexOn());
  }

  /* WHEN WE CANNOT TELL, WE SHOW IT.
     Store data arrives asynchronously, so the first paint may not know yet
     whether Jeff has posted an event. Defaulting to hidden would make a
     real row appear a beat after the menu opened, or vanish under a thumb
     already moving towards it. Defaulting to shown means the worst case is
     a row that is briefly there and correct -- and returning visitors read
     the cached copy, so they never see either. */
  function hasContent(key){
    const app = window.InfinitePullsApp;
    if(!app || typeof app.storeData !== 'function') return true;
    try{
      const list = app.storeData()[key];
      return Array.isArray(list) && list.length > 0;
    }catch{
      return true;
    }
  }

  // Events and Deals live in the menu whether or not the Dex is on -- they
  // are never in the bar, so the Dex has nothing to say about them. What
  // they ARE filtered on is whether they have anything to show.
  function menuItems(){
    return menuNav.filter(item => !item.emptyKey || hasContent(item.emptyKey));
  }

  /* A group whose every row was filtered out would leave a heading over
     nothing. Nothing filters that hard today, but it will one day. */
  function menuItemsTrimmed(){
    const items = menuItems();
    return items.filter((item, i) => {
      if(!item.group) return true;
      for(let j = i + 1; j < items.length; j++){
        if(items[j].group) break;
        if(items[j].page) return true;
      }
      return false;
    });
  }

  function renderNavbar(activePage){
    const nav = document.getElementById('navbar');
    if(!nav) return;
    /* MY CARDS LIGHTS UP FOR ANY OF THE PAGES BEHIND IT. Somebody sitting
       on My Pokédex must be able to see where they are, and there is no
       longer a Pokédex button to light. */
    const mineHere = mineNav.some(i => i.page === activePage);
    nav.innerHTML = barItems().map(item => {
      const on = item.sheet ? mineHere : item.page === activePage;
      return `<button class="nav-item${on ? ' active' : ''}" data-nav="${item.page}"${
        item.sheet ? ' aria-haspopup="true" aria-expanded="false"' : ''}>
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${item.label}</span>
      </button>`;
    }).join('');
  }

  function renderMenu(){
    const links = document.getElementById('menu-links');
    if(!links) return;
    /* The current page is marked. Opening a menu that gives no sign of
       where you already are is how somebody taps the row they are already
       standing on and wonders whether it worked. */
    const here = (window.InfinitePullsApp && window.InfinitePullsApp.currentPage)
      ? window.InfinitePullsApp.currentPage() : '';
    links.innerHTML = menuItemsTrimmed().map(item => {
      if(item.group) return `<div class="menu-group">${item.group}</div>`;
      const on = item.page === here ? ' is-here' : '';
      return `<button class="menu-link${on}" data-nav="${item.page}"`
        + (on ? ' aria-current="page"' : '') + `>${item.label}</button>`;
    }).join('')
    /* The notification switch belongs in the menu, not in a small bell in
       a corner. Somebody who wants to turn these OFF goes looking for
       settings, and this is the only thing in the app that looks like
       settings. The bell stays where it is for anybody who has learned it. */
    + '<button class="menu-link menu-notify" data-notify-toggle hidden></button>';
    refreshNotifyRow();
  }

  async function refreshNotifyRow(){
    const row = document.querySelector('[data-notify-toggle]');
    const push = window.InfinitePullsPush;
    if(!row) return;
    if(!push || !push.isSupported()){ row.hidden = true; return; }

    if(push.getPermission() === 'denied'){
      // Nothing this app can do -- the block lives in the phone's own
      // settings -- so it says that rather than offering a button that
      // cannot work.
      row.hidden = false;
      row.textContent = 'Notifications blocked in your phone settings';
      row.disabled = true;
      return;
    }

    row.hidden = false;
    row.disabled = false;
    let on = false;
    try{ on = await push.isSubscribed(); }catch(_){ /* treat as off */ }
    row.textContent = on ? 'Notifications: on — tap to turn off' : 'Notifications: off — tap to turn on';
    row.classList.toggle('is-on', on);
  }

  document.addEventListener('click', async (e) => {
    const row = e.target.closest && e.target.closest('[data-notify-toggle]');
    if(!row || row.disabled) return;
    const push = window.InfinitePullsPush;
    if(!push) return;
    row.disabled = true;
    try{
      if(await push.isSubscribed()) await push.unsubscribe();
      else await push.subscribe();
    }catch(_){ /* declined or blocked */ }
    row.disabled = false;
    refreshNotifyRow();
    window.InfinitePullsTopbar?.updateNotifyButton?.();
  });

  /* ---- THE MY CARDS SHEET --------------------------------------------
   * Rendered fresh every time it opens rather than once at start-up: the
   * Dex switch and the page you are standing on can both have changed
   * since, and a sheet that is right only the first time is worse than
   * one that is slow. It is four rows; there is nothing to be slow about. */
  function renderMine(){
    const host = document.getElementById('mine-links');
    if(!host) return;
    let here = (window.InfinitePullsApp && window.InfinitePullsApp.currentPage)
      ? window.InfinitePullsApp.currentPage() : '';
    /* The wish list IS the collection page with a tab chosen, so the page
       name alone would mark the wrong row -- somebody standing on their
       wish list would be told they were on My Collection. */
    try{
      const params = new URLSearchParams(location.search);
      if(here === 'collection' && params.get('tab') === 'wishlist') here = 'wishlist';
    }catch(_){ /* the page name is close enough */ }
    host.innerHTML = mineItems().map(item => {
      const on = item.page === here ? ' is-here' : '';
      return `<button class="mine-link${on}" data-nav="${item.page}"${on ? ' aria-current="page"' : ''}>
        <span class="mine-link-icon" aria-hidden="true">${item.icon}</span>
        <span class="mine-link-words">
          <strong>${item.label}</strong>
          <small>${item.sub}</small>
        </span>
      </button>`;
    }).join('');
  }

  function openMine(){
    renderMine();
    const sheet = document.getElementById('mine-sheet');
    if(sheet) sheet.hidden = false;
    document.querySelector('.nav-item[data-nav="mine"]')?.setAttribute('aria-expanded', 'true');
  }

  function closeMine(){
    const sheet = document.getElementById('mine-sheet');
    if(sheet) sheet.hidden = true;
    document.querySelector('.nav-item[data-nav="mine"]')?.setAttribute('aria-expanded', 'false');
  }

  /* Only one sheet at a time. Opening the menu over a half-open My Cards
     leaves two panels stacked and no obvious way back. */
  function openMenu(){
    closeMine();
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
    menuItemsTrimmed,
    hasContent,
    mineNav,
    mineItems,
    renderNavbar,
    renderMenu,
    renderMine,
    refreshNotifyRow,
    openMenu,
    closeMenu,
    openMine,
    closeMine
  };
})();
