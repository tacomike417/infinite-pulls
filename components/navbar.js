
(function(){
  // EDIT THESE ARRAYS to change the app's navigation.
  // Labels here are exact, deliberate product names — "My Collection" and
  // "My Pokédex" specifically, never shortened to "Collection"/"Pokédex"
  // anywhere in the app (nav, headings, buttons, links, page titles).
  const primaryNav = [
    {page:'home',       label:'Home',         icon:'⌂'},
    /* CARD LOOKUP TOOK SHOP'S SLOT, 5 Sep 2026.
       It is the busiest screen in the app and it was in no menu at all --
       reachable only from the home page, so pricing a card from anywhere
       else meant going Home first, every time.
       Shop lost the slot rather than anything else because the shop
       inventory page has never once had data in it: it is fed by a Clover
       sync that has never successfully run. A permanent slot pointing at
       an empty page, next to a daily tool with no slot at all. */
    {page:'lookup',     label:'Card Lookup',  icon:'🔍'},
    {page:'collection', label:'My Collection',icon:'▣'},
    {page:'pokedex',    label:'My Pokédex',   icon:'<img src="/assets/icons/pokedex-nav.png" alt="" class="nav-img-icon">'},
    // Infinite Rewards took Events' place in the bar because it is the thing
    // that ties the shop and the app together — a code on a board in the
    // shop is worthless if nobody can find where to type it. Events moved
    // into the menu below rather than out of the app.
    {page:'dex',        label:'Infinite Rewards', icon:'∞'},
    {page:'menu',       label:'Menu',         icon:'☰'}
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
    {page:'shop',     label:'Shop'},               // moved out of the bar
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

  function barItems(){
    return dexOn() ? primaryNav : primaryNav.filter(item => item.page !== 'dex');
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
    menuItemsTrimmed,
    hasContent,
    renderNavbar,
    renderMenu,
    refreshNotifyRow,
    openMenu,
    closeMenu
  };
})();
