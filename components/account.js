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
.acct-card .form-status{min-height:20px;color:#b91c1c;font:700 14px/1.4 system-ui,sans-serif;text-align:center}
.acct-card .acct-switch{margin:18px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;color:#64748b;font-size:15px}
.acct-card a{color:#1d6cf2;font-weight:800}
.acct-legal{margin:10px 0 0;text-align:center;font-size:12px;color:#94a3b8}
.acct-legal a{color:#64748b;font-weight:600}`;
      document.head.appendChild(st);
    }
    el.innerHTML = `
      <section class="acct"><div class="acct-card">
        <div class="acct-brand"><img src="/assets/logo-sm.webp" alt=""><span class="wm"><i>∞</i>INFINITE PULLS</span></div>
        <h1>${mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
        <!-- The line follows the heading. It used to say "Create a free
             account..." under a heading that said SIGN IN, which is the same
             mismatch that sent confirmed users looking for a second signup. -->
        <p class="acct-sub">${mode === 'signup'
          ? 'Free. Track your cards, post your pulls, follow collectors.'
          : 'Sign in and your collection is right where you left it.'}</p>

        <form id="account-auth-form" class="form-grid">
          ${mode === 'signup' ? `<label>Username<input name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_-]+" title="Letters, numbers, underscores, and hyphens only" autocomplete="username">
            <small style="font-weight:400">This becomes your public page: infinitepulls.com/<em>username</em></small></label>` : ''}
          <label>Email<input type="email" name="email" required autocomplete="email"></label>
          ${mode === 'signup' ? `<label>Phone <small style="font-weight:400">optional &middot; private, only the shop sees it</small>
            <input type="tel" name="phone" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="(330) 555-1234"></label>
            <label style="display:flex; gap:10px; align-items:flex-start; font-weight:600">
              <input type="checkbox" name="texts_ok" style="margin-top:3px">
              <span style="font-size:.86rem; line-height:1.4; font-weight:600">${TEXTS_CONSENT}</span></label>` : ''}
          ${mode === 'signup' ? `<label>Birthday <small style="font-weight:400">private &middot; never shown on your profile</small>
            <input type="date" name="birthdate" required max="${new Date().toISOString().slice(0, 10)}" min="1900-01-02" autocomplete="bday"></label>` : ''}
          <label>Password<input type="password" name="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>
          ${mode === 'signup' ? `<label style="display:flex; gap:10px; align-items:flex-start; font-weight:600">
              <input type="checkbox" name="agree" required style="margin-top:3px">
              <span style="font-size:.86rem; line-height:1.4; font-weight:600">I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>. I'm 13 or older, and if I'm under 18 my parent or guardian agrees too.</span></label>` : ''}
          <div class="form-actions">
            <button class="primary-btn" type="submit">${mode === 'signup' ? 'Create account' : 'Sign in'}</button>
          </div>
          <div id="account-status" class="form-status"></div>
        </form>

        <p class="acct-switch">
          ${mode === 'signup'
            ? `Already have an account? <a href="#" id="account-switch-mode">Sign in</a>`
            : `New here? <a href="#" id="account-switch-mode">Create an account</a>`}
        </p>
        <p class="acct-legal"><a href="/terms">Terms</a> &middot; <a href="/privacy">Privacy</a></p>
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
        const { data, error } = await client().auth.signInWithPassword({ email, password });
        if(error){ statusEl.textContent = friendlyError(error); return; }
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
