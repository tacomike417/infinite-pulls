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
          <img src="./assets/logo.png" alt="Infinite Pulls logo">
          <div class="brand-text">
            <div class="brand-title">INFINITE PULLS</div>
            <div class="brand-subtitle">TCG & HOBBY SHOP</div>
          </div>
        </a>

        <div class="install-wrap" style="position:relative;">
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

      document.addEventListener('click', (event) => {
        const wrap = event.target.closest('.install-wrap');
        if(!wrap){
          const help = document.getElementById('ios-install-help');
          if(help) help.hidden = true;
        }
      });

      this.updateInstallButton();
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