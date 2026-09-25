
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
    /* THREE ROWS CAME OUT, 18 Sep 2026.
       The Gallery was switched off and the row was pointing at it anyway.
       Infinite Questions is reachable from the shop sheet in the feed,
       which is where somebody browsing the shop would look for it, so a
       second row here was the same link twice. Movers & Shakers is a page
       people visit when they want it, not something worth a permanent
       slot in the only menu in the app.
       What went in the space they left is above: the cards you have just
       looked up, which is the one thing here somebody actually wants
       again five minutes later. */
    {group:'The shop'},
    // Shop came back to the bar on 9 Sep 2026, so it is not repeated here.
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
        if(items[j].page || items[j].href) return true;
      }
      return false;
    });
  }

  /* ONE WAY OUT, AND IT GOES FORWARD.
     ----------------------------------------------------------------------
     These pages are not a separate app any more -- they are the inside of
     the feed. Your collection, your goals, the shelf, the opening hours:
     every one of them is reached by tapping a row in the feed's own menu,
     and the way back is the way you came.

     What was here was the old app's whole bottom bar -- Home, Shop, Card
     Lookup, My Cards, Menu -- and behind Menu sat The Gallery, Events,
     Deals and the old home page. Pages the front door now refuses to open,
     offered from inside the pages it still allows. Somebody signed in,
     landed on a collection page, tapped Menu and was back in the design we
     had just replaced, with no idea they had left.

     So it is one button. It is not a copy of the feed's navigation -- two
     bottom bars that look alike and do different things is worse than one
     that does less -- it is the door back.

     The MENU and MY CARDS sheets are left defined above rather than
     deleted: this is the layer that decides what is offered, and a later
     decision to offer more belongs here and not in a rebuild. */
  /* THE FEED'S BOTTOM BAR, 25 Sep 2026 (Mike: "this back to the feed is
     just nasty. It needs to be our menu"). The same five doors the feed
     has -- FEED, SHOP, SCAN A CARD, COLLECTION, MENU -- in the same order
     and the same look, so walking from the feed into these pages no
     longer feels like leaving the app. The page you are on is lit gold.
     MENU opens the feed's own menu (?menu=1), which is where account
     things live. */
  function renderNavbar(activePage){
    const nav = document.getElementById('navbar');
    if(!nav) return;
    const p = activePage || '';
    const onColl = ['collection','wishlist','sealed','pokedex','goals','dex','account'].indexOf(p) !== -1;
    const onShop = ['shop','item','hours','location','contact','about','movers','deals','events'].indexOf(p) !== -1;
    const onScan = p === 'lookup';
    nav.className = 'nf-nav';
    /* SHOP, COLLECTION and MENU OPEN SHEETS, exactly as they do on the feed
       (25 Sep 2026 -- Mike's screen recording: on these pages they jumped
       straight to a page, and MENU threw you out to the feed). Each is still
       a real link underneath, so a failed script still goes somewhere.
       SCAN A CARD goes through the router (data-route), so it changes the
       page without reloading the whole app. */
    nav.innerHTML = `
      <a href="/feed-next/">
        <svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7"/><path d="M6.5 10v10h11V10"/></svg>
        <span>FEED</span></a>
      <a href="/?page=shop" data-nf-sheet="shop" aria-haspopup="dialog"${onShop ? ' class="on"' : ''}>
        <svg viewBox="0 0 24 24"><path d="M2.5 3.5h2.3l2.6 11.3h9.9"/><path d="M6.3 6.6h14.2l-1.8 6.6H7.8"/><circle cx="9.5" cy="19.3" r="1.5"/><circle cx="17.5" cy="19.3" r="1.5"/></svg>
        <span>SHOP</span></a>
      <a class="scan${onScan ? ' on' : ''}" href="/?page=lookup&amp;scan=1" data-route="lookup">
        <i><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></i>
        <span>SCAN A CARD</span></a>
      <a href="/?page=collection" data-nf-sheet="mine" aria-haspopup="dialog"${onColl ? ' class="on"' : ''}>
        <svg viewBox="0 0 24 24"><rect x="4" y="3" width="11" height="15" rx="2"/><path d="M8 21h9a2 2 0 0 0 2-2V8"/></svg>
        <span>COLLECTION</span></a>
      <a class="nf-menu" href="/feed-next/?menu=1" data-nf-sheet="menu" aria-haspopup="dialog" aria-label="Menu">
        <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        <span>MENU</span><span class="me" hidden></span></a>`;
    paintMe();
    try { window.InfinitePullsTopbar && window.InfinitePullsTopbar.paintBell && window.InfinitePullsTopbar.paintBell(); } catch(_){}
  }

  /* ======================================================================
     THE FEED'S THREE SHEETS, ON THESE PAGES TOO (25 Sep 2026)
     Same rows, same order, same look as feed.js mineHTML / shopHTML /
     menuHTML. Rows that are pages of this app use data-nav, so the router
     changes the page in place -- no reload, no "Loading..." flash. The three
     things that live inside the feed (My Feed, Notifications, Infinite
     Rewards) are links that open the feed with that thing already up.
     One sheet element, refilled for whichever button opened it; it rides
     the same history entry the old sheets used, so Back closes it.
     ====================================================================== */
  const SI = {
    inn:  '<svg viewBox="0 0 24 24"><path d="M14 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>',
    out:  '<svg viewBox="0 0 24 24"><path d="M10 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><path d="M17 17l5-5-5-5"/><path d="M22 12H10"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.6 6 .7-4.4 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.4 9.8l6-.7z"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
    goal: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>',
    cards:'<svg viewBox="0 0 24 24"><rect x="4" y="3" width="11" height="15" rx="2"/><path d="M8 21h9a2 2 0 0 0 2-2V8"/></svg>',
    heart:'<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.8C19 15.6 12 20 12 20z"/></svg>',
    dex:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><circle cx="12" cy="12" r="2.6"/></svg>',
    inf:  '<svg viewBox="0 0 24 24"><path d="M8.5 9.5a3.5 3.5 0 1 0 0 5c1.4-1.2 2.2-2.6 3.5-2.5 1.3-.1 2.1 1.3 3.5 2.5a3.5 3.5 0 1 0 0-5c-1.4 1.2-2.2 2.6-3.5 2.5-1.3.1-2.1-1.3-3.5-2.5z"/></svg>',
    feed: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="14" width="17" height="6" rx="2"/></svg>',
    bag:  '<svg viewBox="0 0 24 24"><path d="M2.5 3.5h2.3l2.6 11.3h9.9"/><path d="M6.3 6.6h14.2l-1.8 6.6H7.8"/><circle cx="9.5" cy="19.3" r="1.5"/><circle cx="17.5" cy="19.3" r="1.5"/></svg>',
    clock:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></svg>',
    pin:  '<svg viewBox="0 0 24 24"><path d="M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 14.9 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.4"/></svg>',
    phone:'<svg viewBox="0 0 24 24"><path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2C11.7 19 5 12.3 4.5 5.7A2 2 0 0 1 6.5 3.5z"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M12 3.5a5.5 5.5 0 0 0-5.5 5.5c0 4.2-1.5 5.5-1.5 5.5h14s-1.5-1.3-1.5-5.5A5.5 5.5 0 0 0 12 3.5z"/><path d="M10.2 18a2 2 0 0 0 3.6 0"/></svg>',
    people:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17.5" cy="9" r="2.6"/><path d="M17 15.5a5 5 0 0 1 4 4.5"/></svg>',
    trend:'<svg viewBox="0 0 24 24"><path d="M4 17l6-6 4 4 6-7"/><path d="M15 8h5v5"/></svg>',
    quill:'<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>'
  };

  /* Is Infinite Rewards switched on? Asked once, same question the feed
     asks, so the row is there on both or on neither. */
  let rewardsOn = null;
  async function checkRewards(){
    if(rewardsOn !== null) return rewardsOn;
    rewardsOn = false;
    try{
      const w = window.InfinitePullsSupabase;
      const c = w && w.ready ? w.client : null;
      if(c){
        const { data } = await c.from('dex_settings').select('dex_on, rewards_on').eq('id', 1).maybeSingle();
        rewardsOn = !!(data && data.dex_on && data.rewards_on);
      }
    }catch(_){ /* off, as far as anybody here can tell */ }
    return rewardsOn;
  }

  function nfMe(){ const m = window.InfinitePullsMe; return (m && m.name) ? m : null; }

  function nfMineHTML(){
    if(!nfMe()) return {
      who: 'Your collection<small>Sign in to see your cards, your wish list and your Pok&eacute;dex</small>',
      rows: `<button class="go" type="button" data-nav="account">${SI.inn}SIGN IN</button>`
    };
    const rows = [
      `<button type="button" data-nav="collection">${SI.cards}MY COLLECTION</button>`,
      `<button type="button" data-nav="wishlist">${SI.heart}MY WISH LIST</button>`,
      `<button type="button" data-nav="pokedex">${SI.dex}MY POK&Eacute;DEX</button>`
    ];
    if(rewardsOn) rows.push(`<a class="go gold" href="/feed-next/?rewards=1">${SI.inf}MY INFINITE REWARDS</a>`);
    return { who: 'Your collection<small>Everything you have, in one place</small>', rows: rows.join('') };
  }

  function nfShopHTML(){
    return {
      who: 'Infinite Pulls<small>The shelf, and how to find us</small>',
      rows: [
        `<button class="go" type="button" data-nav="shop">${SI.bag}BROWSE THE SHOP</button>`,
        `<div class="tiles">
          <button class="tile" type="button" data-nav="hours">${SI.clock}<span>HOURS</span></button>
          <button class="tile" type="button" data-nav="location">${SI.pin}<span>LOCATION</span></button>
          <button class="tile" type="button" data-nav="contact">${SI.phone}<span>CONTACT</span></button>
        </div>`,
        `<div class="tiles tiles--quiet">
          <button class="tile" type="button" data-nav="about">${SI.people}<span>ABOUT</span></button>
          <button class="tile" type="button" data-nav="movers">${SI.trend}<span>MOVERS &amp; SHAKERS</span></button>
          <a class="tile" href="/infinite-questions/">${SI.quill}<span>INFINITE QUESTIONS</span></a>
        </div>`
      ].join('')
    };
  }

  function nfMenuHTML(){
    const me = nfMe();
    const rows = [];
    if(me){
      rows.push(`<div class="tiles">
        <a class="tile" href="/feed-next/?who=${encodeURIComponent(me.name)}">${SI.feed}<span>MY FEED</span></a>
        <a class="tile" href="/feed-next/?alerts=1">${SI.bell}<span>NOTIFICATIONS</span></a>
        <button class="tile" type="button" data-nav="goals">${SI.goal}<span>GOALS</span></button>
      </div>`);
      /* MY ACCOUNT became EDIT PROFILE (25 Sep 2026), same as the feed. */
      rows.push(`<a href="/feed-next/?who=${encodeURIComponent(me.name)}&amp;edit=1">${SI.user}EDIT PROFILE</a>`);
    } else {
      rows.push(`<button class="go" type="button" data-nav="account">${SI.inn}SIGN IN</button>`);
      rows.push(`<button class="go" type="button" data-nav="account">${SI.star}CREATE AN ACCOUNT</button>`);
    }
    /* INSTALL lives here now, not in the top bar -- and only when there is
       something to install (a phone, not already installed). */
    const tb = window.InfinitePullsTopbar;
    if(tb && tb.installOffered && tb.installOffered()){
      rows.push(`<button class="go" type="button" data-nf-install>${SI.down}INSTALL THE APP</button>`);
    }
    if(me) rows.push(`<button class="out" type="button" data-nf-signout>${SI.out}SIGN OUT</button>`);
    return {
      who: me ? `${esc(me.name)}<small>You are signed in</small>`
              : 'Browsing as a guest<small>Sign in to follow, unfollow and write card stories</small>',
      rows: rows.join('')
    };
  }

  function nfSheetEl(){
    let wrap = document.getElementById('nf-sheet');
    if(wrap) return wrap;
    wrap = document.createElement('div');
    wrap.className = 'nf-sheetwrap';
    wrap.id = 'nf-sheet';
    wrap.hidden = true;
    wrap.innerHTML = `
      <div class="nf-dim" data-nf-close></div>
      <div class="nf-sheet" role="dialog" aria-modal="true">
        <div class="nf-top"><b id="nf-who"></b>
          <button class="nf-x" type="button" data-nf-close aria-label="Close">&times;</button></div>
        <div class="nf-rows" id="nf-rows"></div>
        <div class="nf-foot" data-nf-close aria-hidden="true"></div>
      </div>`;
    document.body.appendChild(wrap);
    return wrap;
  }

  let nfKind = null;
  function fillNf(kind){
    const html = kind === 'shop' ? nfShopHTML() : kind === 'mine' ? nfMineHTML() : nfMenuHTML();
    const wrap = nfSheetEl();
    wrap.querySelector('#nf-who').innerHTML = html.who;
    wrap.querySelector('#nf-rows').innerHTML = html.rows;
    wrap.querySelector('.nf-sheet').setAttribute('aria-label',
      kind === 'shop' ? 'Shop' : kind === 'mine' ? 'Your collection' : 'Menu');
  }

  function openNf(kind){
    hideMine(); hideMenu();
    nfKind = kind;
    fillNf(kind);
    nfSheetEl().hidden = false;
    markOpen('nf');
    if(kind === 'mine' && rewardsOn === null){
      checkRewards().then(() => { if(nfKind === 'mine' && openSheet === 'nf') fillNf('mine'); });
    }
  }

  function hideNf(){
    nfKind = null;
    const w = document.getElementById('nf-sheet');
    if(w) w.hidden = true;
  }

  function closeNf(dismissed){
    hideNf();
    if(openSheet === 'nf') markClosed(dismissed === true);
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest ? e.target : null;
    if(!t) return;
    const opener = t.closest('[data-nf-sheet]');
    if(opener){
      e.preventDefault();
      const kind = opener.getAttribute('data-nf-sheet');
      /* The same button again closes it -- the bar reads as a toggle. */
      if(openSheet === 'nf' && nfKind === kind) closeNf(true);
      else openNf(kind);
      return;
    }
    if(t.closest('[data-nf-close]')){ e.preventDefault(); closeNf(true); return; }
    if(t.closest('[data-nf-install]')){
      e.preventDefault();
      closeNf(true);
      /* After this tap has finished: the top bar closes its iPhone steps on
         any tap outside itself, and this tap is outside it. */
      setTimeout(() => document.getElementById('install-app')?.click(), 60);
      return;
    }
    const out = t.closest('[data-nf-signout]');
    if(out){
      e.preventDefault();
      /* ASKS TWICE, like the feed's -- the one row here that throws work away. */
      if(!out.dataset.armed){
        out.dataset.armed = '1';
        out.classList.add('armed');
        out.innerHTML = SI.out + 'TAP AGAIN TO SIGN OUT';
        setTimeout(() => {
          if(!out.isConnected) return;
          out.dataset.armed = '';
          out.classList.remove('armed');
          out.innerHTML = SI.out + 'SIGN OUT';
        }, 4000);
        return;
      }
      out.disabled = true;
      out.innerHTML = SI.out + 'SIGNING OUT…';
      window.InfinitePullsAuthLog && window.InfinitePullsAuthLog.onPurpose('SIGN OUT in the menu sheet (old pages)');
      try{
        const w = window.InfinitePullsSupabase;
        if(w && w.ready) await w.client.auth.signOut();
      }catch(_){ /* leaving either way */ }
      location.href = '/feed-next/';
    }
  });

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && openSheet === 'nf') closeNf(true);
  });

  /* YOUR FACE ON MENU, like the feed: a hamburger means guest, a face
     means you. hello-bar.js already fetches your name and photo for the
     top bar, so it hands them over (window.InfinitePullsMe) rather than
     this asking the database a second time. Painted on every page change
     because the bar is redrawn on every page change. */
  function paintMe(){
    const link = document.querySelector('#navbar .nf-menu');
    const slot = link && link.querySelector('.me');
    if(!slot) return;
    const me = window.InfinitePullsMe || null;
    if(!me || !me.name){
      slot.hidden = true; slot.innerHTML = '';
      link.classList.remove('isme'); link.setAttribute('aria-label', 'Menu');
      return;
    }
    const letter = esc(String(me.name).charAt(0).toUpperCase());
    slot.innerHTML = me.avatar
      ? `<img src="${esc(me.avatar)}" alt="" onerror="this.onerror=null;this.parentNode.textContent='${letter}'">`
      : letter;
    slot.hidden = false;
    link.classList.add('isme');
    link.setAttribute('aria-label', 'Menu — signed in as ' + me.name);
  }

  /* ---- THE CARDS YOU JUST LOOKED UP ----------------------------------
     Written by components/card-lookup.js every time a card is opened, and
     read here. This menu is the only thing in the app somebody can reach
     from every page, which makes it the right place for "that card I
     checked ten minutes ago, what was it again".

     READ, NEVER WRITTEN. If the key is missing, unreadable, or full of
     something unexpected, the section simply does not appear -- a menu is
     not worth breaking over a browser that will not hand back its own
     storage. */
  /* Every label in this file was hardcoded until now, so nothing here had
     ever needed escaping. A card name read back out of localStorage is not
     hardcoded, so it gets escaped like anything else that came from
     outside this file. */
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  const RECENT_KEY = 'infinite-pulls-recent-lookups';
  const RECENT_SHOWN = 5;

  function recentLookups(){
    try{
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      if(!Array.isArray(raw)) return [];
      return raw.filter(r => r && r.id && (r.en || r.name)).slice(0, RECENT_SHOWN);
    }catch(_){ return []; }
  }

  /* A real anchor carrying the card's name as the search term, which is
     what the feed's own LOOK UP pills already do. One constant to change
     the day the search moves to a different screen. */
  const LOOKUP_PAGE = '?page=lookup&q=';

  function recentMenuHtml(){
    const list = recentLookups();
    if(!list.length) return '';
    return '<div class="menu-group">Recent searches</div>'
      + list.map(r => {
          const label = esc(r.en || r.name);
          const term  = encodeURIComponent(r.en || r.name);
          return `<a class="menu-link menu-recent" href="${LOOKUP_PAGE}${term}">
                    <span class="menu-recent-art">${r.img
                      ? `<img src="${esc(r.img)}" alt="" loading="lazy" decoding="async">` : ''}</span>
                    <span class="menu-recent-name">${label}</span>
                  </a>`;
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
    links.innerHTML = recentMenuHtml() + menuItemsTrimmed().map(item => {
      if(item.group) return `<div class="menu-group">${item.group}</div>`;
      /* A row that leaves the app entirely is an anchor, so it opens the way
         a link opens: middle-click, long-press, copy address all work, and
         the router is never asked to route somewhere it has never heard of. */
      if(item.href) return `<a class="menu-link" href="${item.href}">${item.label}</a>`;
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

  /* ======================================================================
     THE PHONE'S BACK BUTTON AND THESE SHEETS

     A sheet covering the screen is, to the person looking at it, somewhere
     they went. Until now opening one told the browser nothing -- it just set
     hidden = false -- so Back skipped straight past it to the previous page,
     or out of the app entirely when there wasn't one. That is what "the back
     button takes you out of the app" was.

     Opening a sheet now pushes a history entry and Back pops it. Two details
     that matter more than they look:

     THE ENTRY CARRIES THE SAME URL as the page underneath. So if it is ever
     popped when no sheet is open -- which happens if you opened a sheet and
     then tapped through to another page -- it lands on exactly the page it
     was pushed from. A stale entry is invisible rather than a trapdoor.

     CLOSING BY HAND AND CLOSING TO NAVIGATE ARE NOT THE SAME THING. Tapping
     the X should spend that history entry. navigate() closing the sheets on
     its way to another page should not, because it is about to push an entry
     of its own -- calling back() there would race it. So closeMenu(true)
     means "somebody dismissed this" and plain closeMenu() means "we are
     tidying up before going somewhere".
     ====================================================================== */
  let openSheet = null;      /* 'menu' | 'mine' | null */
  let pushed = false;        /* is there an entry of ours on the stack */

  function markOpen(kind){
    openSheet = kind;
    if(pushed) return;
    try { history.pushState({ ipSheet: 1 }, '', location.href); pushed = true; }
    catch(_){ /* a browser that will not let us is no reason to refuse to open */ }
  }

  function markClosed(dismissed){
    const was = openSheet;
    openSheet = null;
    if(!was) return;
    const had = pushed;
    pushed = false;
    if(had && dismissed){ try { history.back(); } catch(_){} }
  }

  /* Called by app.js BEFORE it re-renders on popstate. If a sheet was open,
     Back meant "close this", the URL has not changed, and re-rendering the
     page would throw away the scroll position for nothing. */
  function absorbPop(){
    if(!openSheet) return false;
    const was = openSheet;
    openSheet = null;
    pushed = false;
    if(was === 'mine') hideMine(); else if(was === 'nf') hideNf(); else hideMenu();
    return true;
  }

  function hideMine(){
    const sheet = document.getElementById('mine-sheet');
    if(sheet) sheet.hidden = true;
    document.querySelector('.nav-item[data-nav="mine"]')?.setAttribute('aria-expanded', 'false');
  }

  function hideMenu(){
    const sheet = document.getElementById('menu-sheet');
    if(sheet) sheet.hidden = true;
  }

  function openMine(){
    renderMine();
    const sheet = document.getElementById('mine-sheet');
    if(sheet) sheet.hidden = false;
    document.querySelector('.nav-item[data-nav="mine"]')?.setAttribute('aria-expanded', 'true');
    markOpen('mine');
  }

  function closeMine(dismissed){
    hideMine();
    if(openSheet === 'mine') markClosed(dismissed === true);
  }

  /* Only one sheet at a time. Opening the menu over a half-open My Cards
     leaves two panels stacked and no obvious way back. */
  function openMenu(){
    hideMine();                /* a swap, not a dismissal: the entry stays */
    const sheet = document.getElementById('menu-sheet');
    if(sheet) sheet.hidden = false;
    markOpen('menu');
  }

  function closeMenu(dismissed){
    hideMenu();
    if(openSheet === 'menu') markClosed(dismissed === true);
    /* navigate() calls this on its way to every page, so the feed-style
       sheet is tidied away here too (without spending the history entry). */
    hideNf();
    if(openSheet === 'nf') markClosed(dismissed === true);
  }

  window.InfinitePullsNavbar = {
    paintMe,
    openNf,
    closeNf,
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
    closeMine,
    absorbPop
  };
})();
