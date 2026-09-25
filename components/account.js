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

  function renderSignedOut(mode='signin'){
    const el = root();
    if(!el) return;
    el.innerHTML = `
      <section class="hero">
        <div class="eyebrow">Account</div>
        <h1>${mode === 'signup' ? 'Create Your Account' : 'Sign In'}</h1>
        <!-- The line follows the heading. It used to say "Create a free
             account..." under a heading that said SIGN IN, which is the same
             mismatch that sent confirmed users looking for a second signup. -->
        <p>${mode === 'signup'
          ? 'A free account holds your collection and keeps a running total of what it\'s worth.'
          : 'Welcome back — sign in and your collection is where you left it.'}</p>

        <form id="account-auth-form" class="form-grid">
          ${mode === 'signup' ? `<label>Username<input name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_-]+" title="Letters, numbers, underscores, and hyphens only" autocomplete="username">
            <small style="font-weight:400">This becomes your public page: infinitepulls.com/<em>username</em></small></label>` : ''}
          <label>Email<input type="email" name="email" required autocomplete="email"></label>
          ${mode === 'signup' ? `<label>Phone <small style="font-weight:400">optional &middot; private, only the shop sees it</small>
            <input type="tel" name="phone" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="(330) 555-1234"></label>
            <label style="display:flex; gap:10px; align-items:flex-start; font-weight:600">
              <input type="checkbox" name="texts_ok" style="margin-top:3px">
              <span style="font-size:.86rem; line-height:1.4; font-weight:600">${TEXTS_CONSENT}</span></label>` : ''}
          <label>Password<input type="password" name="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>
          <div class="form-actions">
            <button class="primary-btn" type="submit">${mode === 'signup' ? 'Create Account' : 'Sign In'}</button>
          </div>
          <div id="account-status" class="form-status"></div>
        </form>

        <p style="margin-top:14px">
          ${mode === 'signup'
            ? `Already have an account? <a href="#" id="account-switch-mode">Sign in</a>`
            : `New here? <a href="#" id="account-switch-mode">Create an account</a>`}
        </p>
      </section>
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
              texts_ok: !!(e.target.elements.texts_ok && e.target.elements.texts_ok.checked)
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
    else renderSignedOut('signin');

    client().auth.onAuthStateChange((_event, newSession) => {
      // Only react if we're still looking at the account page — a stray
      // event after navigating away shouldn't repaint a different page.
      if(!root()) return;
      if(newSession) renderSignedIn(newSession.user);
      else renderSignedOut('signin');
    });
  }

  window.InfinitePullsAccount = { init, CONDITIONS };
})();
