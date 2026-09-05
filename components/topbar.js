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
        <a class="brand" href="?page=home" data-route="home" aria-label="Infinite Pulls home">
          <img src="/assets/logo-sm.webp" alt="Infinite Pulls">
        </a>

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
          <button id="notify-app" class="notify-btn" type="button" hidden aria-label="Notifications off — tap to turn on" title="Notifications off — tap to turn on">🔕</button>
          <button id="install-app" class="install-btn" hidden>Install</button>

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
      });

      document.getElementById('notify-app')?.addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        const push = window.InfinitePullsPush;
        if(!push) return;

        btn.disabled = true;
        try{
          if(await push.isSubscribed()){
            await push.unsubscribe();
          } else {
            const ok = await push.subscribe();
            if(!ok && push.getPermission() === 'denied'){
              alert('Notifications are blocked for this site. Enable them in your browser/phone settings if you\'d like updates from Infinite Pulls.');
            }
          }
        } catch(err){
          console.error('Notification opt-in failed', err);
        } finally {
          btn.disabled = false;
          this.updateNotifyButton();
        }
      });

      document.addEventListener('click', (event) => {
        const wrap = event.target.closest('.install-wrap');
        if(!wrap){
          const help = document.getElementById('ios-install-help');
          if(help) help.hidden = true;
        }
      });

      this.updateInstallButton();
      this.updateNotifyButton();

      /* The name and the sign in/out live in this bar now, and the element
         they fill was created by the line above. hello-bar.js runs on
         DOMContentLoaded and finds nothing if that happened first, so it
         is told directly rather than left to guess. */
      window.InfinitePullsHelloBar?.init();
    },

    updateInstallButton(){
      const btn = document.getElementById('install-app');
      if(!btn) return;

      if(this.isStandalone()){
        btn.hidden = true;
        return;
      }

      btn.hidden = !this.isMobile();
    },

    async updateNotifyButton(){
      const btn = document.getElementById('notify-app');
      if(!btn) return;

      const push = window.InfinitePullsPush;
      if(!push || !push.isSupported() || push.getPermission() === 'denied'){
        btn.hidden = true;
        return;
      }

      btn.hidden = false;
      const subscribed = await push.isSubscribed();
      btn.classList.toggle('is-on', subscribed);
      btn.textContent = subscribed ? '🔔' : '🔕';
      btn.setAttribute('aria-pressed', subscribed ? 'true' : 'false');
      btn.title = subscribed ? 'Notifications on — tap to turn off' : 'Notifications off — tap to turn on';
      btn.setAttribute('aria-label', btn.title);
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
        this.updateInstallButton();
      });
    }
  };

  window.InfinitePullsTopbar = Topbar;
})();