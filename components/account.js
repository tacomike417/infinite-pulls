(function(){
  const CONDITIONS = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];

  // The same list as public.is_reserved_username() in supabase/usernames.sql
  // (the database is the real gate; this copy is only the instant error) — usernames become part of a public
  // URL (infinitepulls.com/username), so they can't collide with a real
  // path the site already uses. Checked here too just for a friendlier,
  // instant error instead of waiting on a round trip to Supabase.
  const RESERVED_USERNAMES = new Set([
    'admin','assets','components','supabase','api','tools','data','pulls',
    'infinite-questions','feed-next','brand-kit','cf-worker','stress-test',
    'node_modules','icons','functions','retailer','privacy','card-art',
    'dex-art','jeff-photos','home','shop','collection','pokedex','dex',
    'goals','events','deals','lookup','location','hours','contact','about',
    'account','menu','gallery','item','thanks','movers','mine','wishlist',
    'post','search','feed','profile','www','null','undefined','favicon',
    'index','readme','cname','app','style','config','manifest',
    'service-worker','robots','sitemap','404','static','infinitepulls',
    'infinite-pulls','infinite_pulls','infinite','official','staff','support',
    'help','team','moderator','mod','owner','administrator','jeff','jeffhyde',
    'jeff-hyde','hyde','hydebot','hyde-bot','store','live','verified',
    'security','billing','system','root','me','you','everyone','pokemon',
    'pokemontcg','tcgplayer','whatnot'
  ]);

  const VARIANT_LABELS = {
    normal: 'Normal',
    holofoil: 'Holofoil',
    'reverse-holofoil': 'Reverse Holofoil',
    '1st-edition': '1st Edition',
    '1st-edition-holofoil': '1st Edition Holofoil',
    unlimited: 'Unlimited',
    'unlimited-holofoil': 'Unlimited Holofoil'
  };

  function escapeHtml(value=''){
    return String(value).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[m]));
  }

  /* PHONE NUMBERS (25 Sep 2026). Same words as texts_consent_words() in
     phone_numbers.sql -- what somebody ticks is what gets recorded. Nothing
     texts anybody yet; this collects the number and the yes. */
  const TEXTS_CONSENT = 'Text me when Infinite Pulls drops new cards or goes live. A few texts a month. Msg &amp; data rates may apply. Reply STOP to stop.';
  function usPhone(v){
    let d = String(v || '').replace(/\D/g, '');
    if(d.length === 11 && d[0] === '1') d = d.slice(1);
    return (d.length === 10 && /[2-9]/.test(d[0])) ? d : null;
  }

  function client(){
    return window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  }

  function root(){
    return document.getElementById('account-page');
  }

  function friendlyError(error){
    if(!error) return '';
    if(/profiles_username_key/i.test(error.message)) return 'That username is already taken — try another.';
    if(/profiles_username_format/i.test(error.message)) return 'Usernames can only use letters, numbers, underscores, and hyphens (3–24 characters), and can\'t be a reserved word like "admin".';
    if(/password/i.test(error.message) && /short|length|6/i.test(error.message)) return 'Password must be at least 6 characters.';
    return error.message;
  }

  // Instant client-side check before ever hitting Supabase — mirrors the
  // profiles_username_format constraint in supabase/schema.sql.
  function usernameProblem(username){
    if(!/^[A-Za-z0-9_-]{3,24}$/.test(username)) return 'Usernames can only use letters, numbers, underscores, and hyphens (3–24 characters).';
    if(RESERVED_USERNAMES.has(username.toLowerCase())) return 'That username is reserved — try another.';
    return null;
  }

  async function loadProfile(userId){
    const { data, error } = await client().from('profiles')
      .select('username, avatar_url, is_public, show_price, bio, tags, price_alerts_enabled, display_name, instagram, tiktok, whatnot')
      .eq('id', userId).maybeSingle();
    if(error) return null;
    return data;
  }

  async function loadOwnedCards(userId){
    const { data, error } = await client().from('user_cards')
      .select('id, card_name, variant, quantity')
      .eq('user_id', userId)
      .order('added_at', { ascending: false });
    if(error) return [];
    return data || [];
  }

  /* ?page=account&new=1 opens on Create Account (the "Join free" links);
     everything else opens on Sign In, which is what a member expects. */
  function firstMode(){
    try{ return new URLSearchParams(location.search).get('new') === '1' ? 'signup' : 'signin'; }
    catch(_){ return 'signin'; }
  }

  /* whole years since a YYYY-MM-DD birthdate, or null */
  function yearsOld(iso){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
    const [y, m, d] = iso.split('-').map(Number);
    const now = new Date();
    let a = now.getFullYear() - y;
    if(now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
    return (a >= 0 && a < 125) ? a : null;
  }


  /* the 'login' server function (username sign-in, reset emails) */
  async function loginCall(body){
    try {
      const { data, error } = await client().functions.invoke('login', { body });
      if(error) return { error: 'Couldn\'t reach the sign-in service. Check your connection.' };
      return data || { error: 'No answer. Try again.' };
    } catch(_) { return { error: 'Couldn\'t reach the sign-in service. Check your connection.' }; }
  }

  /* FORGOT PASSWORD (28 Sep 2026, Mike): type your username OR email; the
     reset link goes to the account's email, and the screen shows it with
     the middle hidden (j••••@gmail.com) so you know which inbox to check,
     even if you forgot which email you used. */
  function renderForgot(el, typed){
    el.innerHTML = `
      <section class="acct"><div class="acct-card">
        <div class="acct-brand"><img src="/assets/logo-sm.webp" alt=""><span class="wm"><i>∞</i>INFINITE PULLS</span></div>
        <h1>Reset your password</h1>
        <p class="acct-sub">Type your username or email. We'll email you a link to pick a new password.</p>
        <form id="account-forgot-form" class="form-grid">
          <label>Username or email<input type="text" name="who" required autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" value="${String(typed || '').replace(/[&<>"']/g, '')}"></label>
          <div class="form-actions"><button class="primary-btn" type="submit">Send reset link</button></div>
          <div id="account-status" class="form-status"></div>
        </form>
        <p class="acct-switch"><a href="#" id="account-back">Back to sign in</a></p>
      </div></section>`;
    document.getElementById('account-back').addEventListener('click', (e) => { e.preventDefault(); renderSignedOut('signin'); });
    document.getElementById('account-forgot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const st = document.getElementById('account-status'), btn = e.target.querySelector('button');
      const who = e.target.elements.who.value.trim();
      if(!who){ st.textContent = 'Type your username or email.'; return; }
      btn.disabled = true; st.textContent = 'Sending…';
      const r = await loginCall({ action: 'reset', who, redirect: location.origin + '/feed-next/?reset=1' });
      btn.disabled = false;
      st.textContent = r.error || r.message || 'Check your email for the link.';
    });
  }

  /* INVITED BY (2 Oct 2026, Mike): the collector whose link brought them here is already
     typed in. It's the same note the feed keeps (ip-ref-v1, good for 30 days). They can
     change it or clear it; what's in the box when they tap Create account is who gets
     the credit. */
  const REF_KEY = 'ip-ref-v1';
  function invitedBy(){
    try{
      const q = (new URLSearchParams(location.search).get('ref') || '').replace(/^@/, '');
      if(/^[A-Za-z0-9_-]{3,24}$/.test(q)) return q;
      const old = JSON.parse(localStorage.getItem(REF_KEY) || 'null');
      if(old && old.u && Date.now() - old.t < 30 * 864e5) return String(old.u);
    }catch(_){}
    return '';
  }
  const escAttr = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

  function renderSignedOut(mode='signin'){
    const el = root();
    if(!el) return;
    /* THE SIGN-IN CARD (28 Sep 2026, Mike): a clean white card with the
       logo on the page's blue, the way the big apps do it. */
    if(!document.getElementById('acct-css')){
      const st = document.createElement('style'); st.id = 'acct-css';
      st.textContent = `
.acct{display:flex;justify-content:center;padding:18px 16px 28px}
.acct-card{width:100%;max-width:420px;background:#fff;color:#0f172a;border-radius:22px;padding:26px 22px 22px;box-shadow:0 20px 50px rgba(0,0,0,.45),0 0 0 1px rgba(25,191,255,.25)}
.acct-brand{display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:6px}
.acct-brand img{width:72px;height:72px;border-radius:18px;object-fit:cover;box-shadow:0 6px 18px rgba(15,23,42,.25)}
.acct-brand .wm{font:900 15px/1 system-ui,-apple-system,sans-serif;letter-spacing:.22em;color:#0f172a}
.acct-brand .wm i{font-style:normal;background:linear-gradient(90deg,#19bfff,#7c5cff,#ff4f93);-webkit-background-clip:text;background-clip:text;color:transparent;margin-right:4px;letter-spacing:0}
.acct-card h1{margin:14px 0 4px;text-align:center;font:900 26px/1.15 system-ui,-apple-system,sans-serif;color:#0f172a}
.acct-card .acct-sub{margin:0 0 18px;text-align:center;color:#64748b;font-size:15px;line-height:1.4}
.acct-card .form-grid{display:grid;gap:14px}
.acct-card label{display:grid;gap:6px;color:#334155;font:700 14px/1.3 system-ui,sans-serif}
.acct-card label small{color:#64748b;font-weight:500}
.acct-card input:not([type=checkbox]){box-sizing:border-box;width:100%;height:48px;padding:0 14px;border-radius:12px;border:1.5px solid #cbd5e1;background:#f8fafc;color:#0f172a;font:500 16px/1.2 system-ui,sans-serif;color-scheme:light}
.acct-card input:not([type=checkbox]):focus{outline:none;border-color:#1d6cf2;background:#fff;box-shadow:0 0 0 4px rgba(29,108,242,.15)}
.acct-card input[type=checkbox]{width:20px;height:20px;accent-color:#1d6cf2;flex:none}
.acct-card .form-actions{margin-top:4px}
.acct-card .primary-btn{width:100%;height:52px;border:0;border-radius:14px;background:linear-gradient(135deg,#1d6cf2,#19bfff);color:#fff;font:900 17px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 20px rgba(29,108,242,.3)}
.acct-card .form-status{min-height:20px;color:#1e293b;font:700 14px/1.4 system-ui,sans-serif;text-align:center}
.acct-perk{display:flex;align-items:center;gap:12px;margin:0 0 16px;padding:10px 12px;border-radius:14px;background:linear-gradient(135deg,#fff7e0,#ffeec2);border:1px solid #f3d27a;text-align:left;color:#3b2f0b;font-size:14px;line-height:1.35}
.acct-perk img{flex:none;width:46px;height:46px;object-fit:contain}
.acct-perk b{display:block;color:#0f172a;font-size:15px}
.acct-sell{margin:22px 0 0;text-align:left}
.acct-lab{margin:0 0 10px;font-size:12px;font-weight:900;letter-spacing:.14em;color:#64748b;text-align:center}
.acct-tier{margin:0 0 10px;padding:14px 14px 6px;border-radius:16px;background:#f8fafc;border:1.5px solid #e2e8f0}
.acct-tier.on{background:#eff8ff;border-color:#19bfff;box-shadow:0 6px 18px rgba(25,191,255,.18)}
.acct-tier .t-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.acct-tier .t-top b{font-size:19px;font-weight:900;color:#0f172a}
.acct-tier .t-price{font-size:19px;font-weight:900;color:#0f172a}
.acct-tier .t-price small{font-size:12px;font-weight:700;color:#64748b}
.acct-tier .t-when{display:inline-block;margin:6px 0 2px;padding:3px 9px;border-radius:999px;background:#e2e8f0;color:#475569;font-size:10.500px;font-weight:900;letter-spacing:.1em}
.acct-tier .t-when.now{background:#19bfff;color:#fff}
.acct-tier ul{margin:8px 0 8px;padding-left:18px;color:#334155;font-size:14.500px;line-height:1.5}
.acct-tier .t-thanks{margin:4px 0 10px;padding:10px 12px;border-radius:12px;background:#fff;border:1px dashed #19bfff;color:#0f172a;font-size:14px;line-height:1.4}
.acct-card a.acct-aff{margin-top:14px}
/* 2 Oct 2026 (Mike): "anything under that white box on that page, take out". The old
   shell's words and links below the card are hidden while the sign-in card is up. */
:root:has(#account-page .acct) .seo-home,:root:has(#account-page .acct) .shell-foot{display:none!important}
.acct-fine{margin:2px 0 12px;text-align:center;color:#64748b;font-size:13px}
.acct-aff{display:block;padding:14px;border-radius:16px;background:#0f172a;color:#e2e8f0;text-decoration:none;font-size:14.500px;line-height:1.4}
.acct-card a.acct-aff,.acct-card a.acct-aff span{color:#e2e8f0}
.acct-card a.acct-aff b{color:#fff}
.acct-card a.acct-aff i{display:block;margin-top:6px;font-style:normal;font-weight:900;color:#ffc928}
.acct-card .acct-switch{margin:18px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;color:#64748b;font-size:15px}
.acct-card a{color:#1d6cf2;font-weight:800}
.acct-legal{margin:10px 0 0;text-align:center;font-size:12px;color:#94a3b8}
.acct-legal a{color:#64748b;font-weight:600}`;
      document.head.appendChild(st);
    }
    el.innerHTML = `
      <section class="acct"><div class="acct-card">
        <div class="acct-brand"><img src="/assets/logo-sm.webp" alt=""><span class="wm"><i>∞</i>INFINITE PULLS</span></div>
        <h1>${mode === 'signup' ? 'Get in while it&rsquo;s free' : 'Welcome back'}</h1>
        <!-- The line follows the heading. It used to say "Create a free
             account..." under a heading that said SIGN IN, which is the same
             mismatch that sent confirmed users looking for a second signup. -->
        <p class="acct-sub">${mode === 'signup'
          ? 'Infinite Pulls is in beta. Make your account now and you&rsquo;re a beta tester. Active beta testers get a year of Premium free in 2027.'
          : 'Sign in and your collection is right where you left it.'}</p>

        ${mode === 'signup' ? `<div class="acct-perk"><img src="/assets/badge-original-2026-lg.webp" alt="" width="46" height="46">
          <span><b>Join before 2027, get the badge.</b> Every beta account gets the Infinite Original 2026 badge on its profile.</span></div>` : ''}
        <form id="account-auth-form" class="form-grid">
          ${mode === 'signup' ? `<label>Username<input name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_-]+" title="Letters, numbers, underscores, and hyphens only" autocomplete="username">
            <small style="font-weight:400">This becomes your public page: infinitepulls.com/<em>username</em></small></label>` : ''}
          ${mode === 'signup'
            ? `<label>Email<input type="email" name="email" required autocomplete="email"></label>`
            : `<label>Email or username<input type="text" name="email" required autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></label>`}
          ${mode === 'signup' ? `<label>Phone <small style="font-weight:400">optional &middot; private, only the shop sees it</small>
            <input type="tel" name="phone" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="(330) 555-1234"></label>
            <label style="display:flex; gap:10px; align-items:flex-start; font-weight:600">
              <input type="checkbox" name="texts_ok" style="margin-top:3px">
              <span style="font-size:.86rem; line-height:1.4; font-weight:600">${TEXTS_CONSENT}</span></label>` : ''}
          ${mode === 'signup' ? `<label>Invited by <small style="font-weight:400">optional &middot; they get the credit</small>
            <input name="invited_by" maxlength="25" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="@username" value="${escAttr(invitedBy())}"></label>` : ''}
          ${mode === 'signup' ? `<label>Birthday <small style="font-weight:400">private &middot; never shown on your profile</small>
            <input type="date" name="birthdate" required max="${new Date().toISOString().slice(0, 10)}" min="1900-01-02" autocomplete="bday"></label>` : ''}
          <label>Password
            <!-- THE EYE (2 Oct 2026, Jeff): tap it to see what you typed, tap again to hide it. -->
            <span style="position:relative;display:block">
              <input type="password" name="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" style="padding-right:52px">
              <button type="button" id="account-eye" aria-label="Show password" aria-pressed="false" style="position:absolute;right:2px;top:50%;transform:translateY(-50%);width:48px;height:44px;border:0;background:none;color:inherit;opacity:.75;display:grid;place-items:center;cursor:pointer;padding:0">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.600 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="eye-off" d="M4 4l16 16"/></svg>
              </button>
            </span></label>
          ${mode === 'signup' ? '' : `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:-4px">
            <!-- STAY SIGNED IN (2 Oct 2026, Jeff). On unless they turn it off. Off = signed out when the app is closed. -->
            <label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;margin:0"><input type="checkbox" name="stay" checked style="width:20px;height:20px;margin:0"> Stay signed in</label>
            <a href="#" id="account-forgot" style="font-size:14px">Forgot password?</a></div>`}
          ${mode === 'signup' ? `<label style="display:flex; gap:10px; align-items:flex-start; font-weight:600">
              <input type="checkbox" name="agree" required style="margin-top:3px">
              <span style="font-size:.86rem; line-height:1.4; font-weight:600">I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>. I'm 13 or older, and if I'm under 18 my parent or guardian agrees too.</span></label>` : ''}
          <div class="form-actions">
            <button class="primary-btn" type="submit">${mode === 'signup' ? 'Create account' : 'Sign in'}</button>
          </div>
          <div id="account-status" class="form-status"></div>
        </form>

        ${mode === 'signup' ? `
        <!-- THE SELL (2 Oct 2026, Mike): "it needs to be a sell page... get in now, get a free
             account for beta testing" AND "when influencers show up, it's honest". Three
             plain boxes: what is free today, and the two paid plans with their planned price
             and when they open. Nothing here is promised that the app doesn't do or plan. -->
        <div class="acct-sell">
          <div class="acct-lab">RIGHT NOW</div>
          <div class="acct-tier on">
            <div class="t-top"><b>Beta</b><span class="t-price">FREE</span></div>
            <span class="t-when now">OPEN NOW &middot; YOU&rsquo;RE HERE</span>
            <ul><li>Track your collection and what it&rsquo;s worth</li><li>Card lookup with TCGplayer market prices</li><li>Card scanner (early version)</li><li>Post your pulls, make Loops, follow collectors</li></ul>
            <p class="t-thanks"><b>Our thank-you:</b> in 2027 your beta account becomes a Free account. Stay active and you get <b>a year of Premium, free</b>, for helping us build this.</p>
          </div>
          <div class="acct-lab" style="margin-top:20px">IN 2027 &middot; THREE LEVELS</div>
          <div class="acct-tier">
            <div class="t-top"><b>Free</b><span class="t-price">$0</span></div>
            <ul><li>Everything in the beta today</li></ul>
          </div>
          <div class="acct-tier">
            <div class="t-top"><b>Premium</b><span class="t-price">$9.99<small>/mo</small></span></div>
            <ul><li>Live TCGplayer pricing</li><li>eBay sold prices</li><li>Graded card prices</li><li>The upgraded scanner</li><li>Go live once a month</li></ul>
          </div>
          <div class="acct-tier">
            <div class="t-top"><b>Streamer</b><span class="t-price">$13.99<small>/mo</small></span></div>
            <ul><li>Everything in Premium</li><li>Go live as much as you want</li><li>Your stream at the top of the feed</li></ul>
          </div>
          <a class="acct-aff" href="/affiliates/"><span><b>Got a following?</b> Bring collectors and earn 10%. Next affiliate drop: January 1.</span><i>Get in the queue &rarr;</i></a>
        </div>` : ''}
        <p class="acct-switch">
          ${mode === 'signup'
            ? `Already have an account? <a href="#" id="account-switch-mode">Sign in</a>`
            : `New here? <a href="#" id="account-switch-mode">Create an account</a>`}
        </p>
        <p class="acct-legal"><a href="/terms">Terms</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/affiliates/">Affiliates</a></p>
      </div></section>
    `;

    /* WHERE YOU LAND AFTER SIGNING IN.
     *
     * It used to be this page -- the account screen, re-rendered as the
     * signed-in version. Which is a settings page: correct, and a dead end.
     * The first thing worth seeing is the scoreboard on the home page with
     * real numbers in it, and from there the whole app is one tap away.
     *
     * Signing UP without a session (email confirmation still pending) does
     * not come through here, because that person is not signed in yet and
     * has an email to go and find. */
    function goHome(statusEl){
      /* BACK WHERE THEY WERE, when something sent them here to sign in.
         A guest who taps a comment under a card is told to sign in, and
         landing them on the front of the app afterwards loses the card they
         were looking at -- they have to find it again, which most people
         simply do not do. Whatever sent them here leaves the way back in
         sessionStorage; this spends it.

         ONLY A PATH ON THIS SITE. A stored value beginning with // is a
         protocol-relative URL and would hand somebody straight to another
         domain immediately after they typed their password, which is the
         shape of a phishing redirect. Checked rather than trusted, because
         this is read from storage and storage is not a promise. */
      let back = null;
      try {
        back = sessionStorage.getItem('ip-after-signin');
        sessionStorage.removeItem('ip-after-signin');
      } catch (e) { back = null; }

      if (back && back.charAt(0) === '/' && back.charAt(1) !== '/' &&
          /^[A-Za-z0-9_\-./?=&%#+]*$/.test(back)) {
        if(statusEl) statusEl.textContent = 'Signed in — taking you back…';
        location.href = back;
        return;
      }

      /* HOME IS THE FEED NOW, and getting here was the bug: navigate('home')
         is the OLD app's own router, so it changed the page underneath
         without ever leaving this document -- and the front door in
         index.html, which would have sent them to the feed, never ran. You
         signed in and landed on the old home page, with the old menu, in
         the design we had just replaced. A whole-page navigation is the
         point rather than an oversight. */
      if(statusEl) statusEl.textContent = 'Signed in — taking you to the feed…';
      location.href = '/feed-next/';
    }

    /* sent here by the account switcher to sign one account back in: their name is already typed */
    try {
      const who = sessionStorage.getItem('ip-signin-who');
      const box = document.querySelector('#account-auth-form [name="email"]');
      if(who && box && mode !== 'signup'){ box.value = who; sessionStorage.removeItem('ip-signin-who'); document.querySelector('#account-auth-form [name="password"]')?.focus(); }
    } catch(_) {}
    document.getElementById('account-eye')?.addEventListener('click', (e) => {
      const b = e.currentTarget, inp = b.parentNode.querySelector('input'), show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.setAttribute('aria-pressed', show ? 'true' : 'false');
      b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      const off = b.querySelector('.eye-off'); if (off) off.style.display = show ? 'none' : '';
      inp.focus();
    });
    document.getElementById('account-forgot')?.addEventListener('click', (e) => {
      e.preventDefault();
      renderForgot(el, e.target.closest('.acct-card').querySelector('input[name=email]').value.trim());
    });

    document.getElementById('account-switch-mode')?.addEventListener('click', (e) => {
      e.preventDefault();
      renderSignedOut(mode === 'signup' ? 'signin' : 'signup');
    });

    document.getElementById('account-auth-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusEl = document.getElementById('account-status');
      const email = e.target.elements.email.value.trim();
      const password = e.target.elements.password.value;
      statusEl.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';

      if(mode === 'signup'){
        const username = e.target.elements.username.value.trim();
        const problem = usernameProblem(username);
        if(problem){ statusEl.textContent = problem; return; }
        /* AGE (28 Sep 2026): 13+ to have an account, 18+ to message.
           The birthdate rides in the metadata and save_signup_age()
           (supabase/ages.sql) files it privately. */
        const bday = e.target.elements.birthdate ? e.target.elements.birthdate.value : '';
        const age = yearsOld(bday);
        if(age == null){ statusEl.textContent = 'Please enter your birthday.'; return; }
        if(age < 13){ statusEl.textContent = 'Sorry, you have to be 13 or older to make an account. A parent or guardian can make one in their name.'; return; }
        if(!(e.target.elements.agree && e.target.elements.agree.checked)){
          statusEl.textContent = 'Please agree to the Terms of Service and Privacy Policy.'; return;
        }
        /* who invited them: kept for the feed's claim_invite(), and in the account too */
        const inviter = e.target.elements.invited_by ? e.target.elements.invited_by.value.trim().replace(/^@/, '') : '';
        if(inviter && !/^[A-Za-z0-9_-]{3,24}$/.test(inviter)){ statusEl.textContent = 'That "Invited by" name doesn\'t look right. Type their username, or leave it blank.'; return; }
        try{ if(inviter) localStorage.setItem(REF_KEY, JSON.stringify({ u: inviter, t: Date.now() })); else localStorage.removeItem(REF_KEY); }catch(_){}
        const phoneTyped = e.target.elements.phone ? e.target.elements.phone.value.trim() : '';
        if(phoneTyped && !usPhone(phoneTyped)){
          statusEl.textContent = 'That phone number doesn\'t look right. Ten digits, or leave it blank.';
          return;
        }
        /* emailRedirectTo IS NOT OPTIONAL, and it points at the FEED.

           Without it, Supabase builds the confirmation link from the Site
           URL in its own dashboard, which shipped as http://localhost:3000
           and sent every new member to a dead page on their own phone.

           It points at /feed-next/ rather than '/' because the root is a
           redirect shim, and every hop is a chance to lose the token that
           rides in the URL. Landing on the page that actually reads the
           token is what signs people in; landing on '/' meant arriving at
           the feed as a guest and being asked to sign into the account you
           made ninety seconds earlier. index.html carries the fragment
           across as well, for links already sitting in people's inboxes. */
        const { data, error } = await client().auth.signUp({
          email,
          password,
          options: {
            /* The phone rides in the account's metadata: there is no session
               yet (the confirmation email is out), so nothing here can write
               to the database as this person. save_signup_phone() in
               phone_numbers.sql copies it across when the account is made. */
            data: {
              username,
              phone: (e.target.elements.phone && e.target.elements.phone.value.trim()) || null,
              texts_ok: !!(e.target.elements.texts_ok && e.target.elements.texts_ok.checked),
              birthdate: bday,
              invited_by: inviter || null,
              terms: true
            },
            emailRedirectTo: window.location.origin + '/feed-next/'
          }
        });
        if(error){ statusEl.textContent = friendlyError(error); return; }
        if(!data.session){
          statusEl.textContent = 'Account created — look for an email from Supabase (that\'s who handles our secure accounts) and click the link to confirm it, then sign in.';
          return;
        }
        goHome(statusEl);
      } else {
        /* EMAIL OR USERNAME (28 Sep 2026, Mike). An email signs in right
           here like always. A username goes to the 'login' server function,
           which finds the email behind it WITHOUT ever sending it to the
           phone, signs in there, and hands back the session. */
        /* STAY SIGNED IN (2 Oct 2026, Jeff). Checked = the way it has always
           worked. Unchecked = this phone signs out when the app is closed
           (account-switch.js does that on the next open). Written BEFORE the
           sign-in, because the page moves on the moment it succeeds. */
        try {
          const stayBox = e.target.elements.stay;
          if(stayBox && !stayBox.checked) localStorage.setItem('ip-stay', '0'); else localStorage.removeItem('ip-stay');
          sessionStorage.setItem('ip-live', '1');
        } catch(_) {}
        if(email.includes('@')){
          const { error } = await client().auth.signInWithPassword({ email, password });
          if(error){ statusEl.textContent = /invalid/i.test(error.message) ? 'That email and password don\'t match. Tap Forgot password if you need a new one.' : friendlyError(error); return; }
        } else {
          const r = await loginCall({ action: 'signin', who: email, password });
          if(r.error || !r.access_token){ statusEl.textContent = r.error || 'Couldn\'t sign in. Try again.'; return; }
          const { error } = await client().auth.setSession({ access_token: r.access_token, refresh_token: r.refresh_token });
          if(error){ statusEl.textContent = 'Couldn\'t sign in. Try again.'; return; }
        }
        goHome(statusEl);
      }
    });
  }

  /* THE MY ACCOUNT PAGE IS GONE (25 Sep 2026). Mike: "It's useless."
     Everything on it lives somewhere people actually look:
       - photo, name, bio, socials, phone  -> EDIT PROFILE on your profile
       - public / show value / price alerts -> the foot of My Collection
       - sign out                          -> the menu
     Signed OUT, this is still the sign-in / create-account screen. Signed
     IN, it sends you straight to Edit profile, so every old link and
     bookmark to ?page=account still lands somewhere useful. replace(), not
     assign(): Back must not bounce you into this redirect again. */
  async function renderSignedIn(user){
    const el = root();
    if(el) el.innerHTML = '<section class="hero"><p>Opening your profile…</p></section>';
    // Tag this device's notification subscription to the account, as the
    // old page did on every visit. Fire-and-forget.
    window.InfinitePullsPush?.retagCurrentSubscription(user.id);
    const profile = await loadProfile(user.id);
    const name = profile?.username;
    location.replace(name ? '/feed-next/?who=' + encodeURIComponent(name) + '&edit=1' : '/feed-next/');
  }

  async function init(){
    const el = root();
    if(!el) return;
    if(!window.InfinitePullsSupabase || !window.InfinitePullsSupabase.ready){
      el.innerHTML = `<section class="hero"><div class="eyebrow">Account</div><h1>Not connected yet</h1><p>Connect Supabase in config.js to enable accounts.</p></section>`;
      return;
    }

    const { data: { session } } = await client().auth.getSession();
    if(session) await renderSignedIn(session.user);
    else renderSignedOut(firstMode());

    client().auth.onAuthStateChange((_event, newSession) => {
      // Only react if we're still looking at the account page — a stray
      // event after navigating away shouldn't repaint a different page.
      if(!root()) return;
      if(newSession) renderSignedIn(newSession.user);
      else renderSignedOut(firstMode());
    });
  }

  window.InfinitePullsAccount = { init, CONDITIONS };
})();
