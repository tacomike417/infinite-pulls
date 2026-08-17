
(function(){
  const Topbar = {
    deferredInstallPrompt: null,

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
        <button id="install-app" class="install-btn" hidden>Install</button>
      `;

      document.getElementById('install-app')?.addEventListener('click', async () => {
        if(!this.deferredInstallPrompt) return;
        this.deferredInstallPrompt.prompt();
        await this.deferredInstallPrompt.userChoice;
        this.deferredInstallPrompt = null;
        this.updateInstallButton();
      });
    },

    updateInstallButton(){
      const btn = document.getElementById('install-app');
      if(btn) btn.hidden = !this.deferredInstallPrompt;
    },

    init(){
      this.render();
      window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        this.deferredInstallPrompt = event;
        this.updateInstallButton();
      });
    }
  };

  window.InfinitePullsTopbar = Topbar;
})();
