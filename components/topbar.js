(function(){
  const Topbar = {
    deferredInstallPrompt: null,

    isIOS(){
      return /iphone|ipad|ipod/i.test(navigator.userAgent);
    },

    isAndroid(){
      return /android/i.test(navigator.userAgent);
    },

    isMobile(){
      return this.isIOS() || this.isAndroid();
    },

    isStandalone(){
      return window.matchMedia('(display-mode: standalone)').matches ||
             window.navigator.standalone === true;
    },

    render(){
      const el = document.getElementById('topbar');
      if(!el) return;

      el.innerHTML = `
        <!-- THE FEED'S TOP BAR, 25 Sep 2026. Mike: these pages looked like a
             different site ("MySpace did a whole update, but behind the
             scenes it was super ugly"). Same three parts as the feed: the
             logo (home is the feed now), the wordmark with its blue rule,
             and search. The name / sign-out that used to sit here lives in
             the feed's menu; hello-bar is kept below, hidden, because
             hello-bar.js still fills it. -->
        <a class="brand nf-mark" href="/feed-next/" aria-label="Infinite Pulls feed">
          <img src="/assets/logo-sm.webp" alt="Infinite Pulls">
        </a>
        <h1 class="nf-word">Infinite Pulls</h1>

        <!-- THE SHOP'S NAME CAME OFF THIS BAR, 5 Sep 2026.
             "INFINITE PULLS / TCG & HOBBY SHOP" was two lines of text
             telling somebody something the logo beside it already said,
             and it was doing that on every screen forever. The space now
             holds who you are and the way in or out -- which changes, and
             which somebody actually needs.

             The id stays "hello-bar" because components/hello-bar.js
             already owns this: who is signed in, the sign-out, the copyable
             username Jeff asks for at the counter. Moving the element was
             cheaper and safer than rewriting the thing that fills it. -->
        <div id="hello-bar" class="topbar-user" hidden></div>

        <div class="install-wrap" style="position:relative; display:flex; align-items:center; gap:8px;">
          <!-- THE BELL CAME OFF THIS BAR, 18 Sep 2026.
               A 42px button on every screen forever, to toggle a thing
               somebody decides once. It was also the third item competing
               for a phone-width bar, which is what pushed the username
               into the logo. The switch itself is not gone: it lives in
               the Menu, under the only thing in this app that looks like
               settings, which is where somebody goes when they want to
               turn notifications OFF. See refreshNotifyRow in navbar.js. -->
          <button id="install-app" class="install-btn" hidden>Install</button>
          <a class="nf-icon" href="/feed-next/?search=1" aria-label="Search">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          </a>

          <div id="ios-install-help"
               hidden
               style="
                 position:absolute;
                 right:0;
                 top:calc(100% + 8px);
                 width:min(310px, calc(100vw - 24px));
                 background:#111;
                 border:1px solid rgba(255,255,255,.16);
                 border-radius:12px;
                 padding:14px;
                 z-index:9999;
                 box-shadow:0 14px 35px rgba(0,0,0,.45);
                 color:#fff;
                 text-align:left;
               ">
            <strong style="display:block; margin-bottom:8px;">Install Infinite Pulls on iPhone</strong>

            <div style="font-size:.92rem; line-height:1.45;">
              <div style="margin-bottom:8px;"><strong>1.</strong> Make sure you're viewing Infinite Pulls in <strong>Safari</strong>.</div>
              <div style="margin-bottom:8px;"><strong>2.</strong> Tap the <strong>Share</strong> button — the square with the arrow pointing up.</div>
              <div style="margin-bottom:8px;"><strong>3.</strong> Scroll down and tap <strong>Add to Home Screen</strong>.</div>
              <div style="margin-bottom:8px;"><strong>4.</strong> Make sure <strong>Open as Web App</strong> is turned on.</div>
              <div><strong>5.</strong> Tap <strong>Add</strong>. The Infinite Pulls icon will appear on your Home Screen.</div>
            </div>

            <button id="close-ios-install"
                    type="button"
                    class="secondary-btn"
                    style="margin-top:12px; width:100%;">
              Got it
            </button>
          </div>
        </div>
      `;

      document.getElementById('install-app')?.addEventListener('click', async () => {
        if(this.isIOS()){
          const help = document.getElementById('ios-install-help');
          if(help) help.hidden = !help.hidden;
          return;
        }

        if(this.isAndroid() && this.deferredInstallPrompt){
          this.deferredInstallPrompt.prompt();
          await this.deferredInstallPrompt.userChoice;
          this.deferredInstallPrompt = null;
          this.updateInstallButton();
        }
      });

      document.getElementById('close-ios-install')?.addEventListener('click', () => {
        const help = document.getElementById('ios-install-help');
        if(help) help.hidden = true;
        /* They have read the steps. Whether they followed them is not
           something this page can find out, so it stops asking for a
           month either way. */
        try { localStorage.setItem(this.DISMISS_KEY, String(Date.now())); } catch(_){ }
        this.updateInstallButton();
      });

      document.addEventListener('click', (event) => {
        const wrap = event.target.closest('.install-wrap');
        if(!wrap){
          const help = document.getElementById('ios-install-help');
          if(help) help.hidden = true;
        }
      });

      this.updateInstallButton();

      /* The name and the sign in/out live in this bar now, and the element
         they fill was created by the line above. hello-bar.js runs on
         DOMContentLoaded and finds nothing if that happened first, so it
         is told directly rather than left to guess. */
      window.InfinitePullsHelloBar?.init();
    },

    /* ---- "INSTALL" ON A PHONE THAT ALREADY HAS IT ----------------------
       This used to be: not running as an app, and on a phone, therefore
       offer to install. Which is wrong for the commonest case there is --
       somebody who installed it weeks ago and happens to be looking at the
       site in a browser tab right now. They are told to install a thing
       they already have, on every screen, forever.

       ANDROID HAS A REAL ANSWER. Chrome fires beforeinstallprompt only for
       a site it is actually willing to install, and it does NOT fire it
       once the app is installed. So the presence of that event IS the
       question being asked. No prompt, no button.

       IOS HAS NO SIGNAL AT ALL. Safari never fires that event and never
       says whether the icon is on the home screen, so the honest fallback
       is to let somebody dismiss it: "Got it" puts the button away for a
       month. A nag you can silence is a different thing from a nag.

       And any visit that runs as an installed app is remembered, so the
       browser tab on that same phone stops asking too. */
    INSTALLED_KEY: 'ip-installed',
    DISMISS_KEY: 'ip-install-dismissed',
    DISMISS_DAYS: 30,

    rememberInstalled(){
      try { localStorage.setItem(this.INSTALLED_KEY, '1'); } catch(_){ /* private window */ }
    },

    knownInstalled(){
      try { return localStorage.getItem(this.INSTALLED_KEY) === '1'; } catch(_){ return false; }
    },

    dismissedRecently(){
      try {
        const at = Number(localStorage.getItem(this.DISMISS_KEY) || 0);
        return at > 0 && (Date.now() - at) < this.DISMISS_DAYS * 86400000;
      } catch(_){ return false; }
    },

    updateInstallButton(){
      const btn = document.getElementById('install-app');
      if(!btn) return;

      if(this.isStandalone()){
        /* Running as the app right now, so this phone knows the answer.
           Remembered for the next visit in a browser tab. */
        this.rememberInstalled();
        btn.hidden = true;
        return;
      }

      if(!this.isMobile() || this.knownInstalled() || this.dismissedRecently()){
        btn.hidden = true;
        return;
      }

      /* iOS: no signal either way, so it shows until dismissed.
         Android: shown only while Chrome is offering. */
      btn.hidden = this.isIOS() ? false : !this.deferredInstallPrompt;
    },

    init(){
      this.render();

      window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        this.deferredInstallPrompt = event;
        this.updateInstallButton();
      });

      window.addEventListener('appinstalled', () => {
        this.deferredInstallPrompt = null;
        this.rememberInstalled();
        this.updateInstallButton();
      });
    }
  };

  window.InfinitePullsTopbar = Topbar;
})();