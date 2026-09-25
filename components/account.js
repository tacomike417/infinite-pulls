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
      .select('username, avatar_url, is_public, show_price, bio, tags, grail_card_id, grail_note, price_alerts_enabled, display_name, instagram, tiktok, whatnot')
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
            data: { username },
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

  async function renderSignedIn(user){
    const el = root();
    if(!el) return;
    const profile = await loadProfile(user.id);
    const ownedCards = await loadOwnedCards(user.id);
    const username = profile?.username || user.email;
    const avatarUrl = profile?.avatar_url || '';
    const isPublic = profile?.is_public !== false;
    const showPrice = profile?.show_price !== false;
    const priceAlertsEnabled = profile?.price_alerts_enabled === true;
    const profileUrl = profile?.username ? `${location.origin}/${profile.username}` : '';

    // Retroactively tag this device's notification subscription (if any)
    // as belonging to this account — see app.js for why. Fire-and-forget:
    // shouldn't hold up rendering the page either way.
    window.InfinitePullsPush?.retagCurrentSubscription(user.id);

    el.innerHTML = `
      <section class="hero">
        <div class="eyebrow">Account</div>
        <h1>Hey, ${escapeHtml(username)}</h1>

        <div style="display:flex; align-items:center; gap:16px; margin:16px 0;">
          <div id="account-avatar-preview" style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,.06);border:1px solid var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:1.8rem;flex:0 0 auto;">
            ${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover">` : '🙂'}
          </div>
          <label class="ghost-btn" style="cursor:pointer;">
            Change Photo
            <input type="file" id="account-avatar-input" accept="image/*" hidden>
          </label>
        </div>
        <div id="account-avatar-status" class="form-status"></div>

        <div class="card-grid" style="margin-top:8px">
          <a class="card" href="?page=collection" data-route="collection"><div class="card-icon">▣</div><strong>My Collection</strong><small>Add cards and see their value.</small></a>
        </div>
      </section>

      <!-- MOVED HERE FROM THE FEED MENU. It is identity, the same as
           everything else on this page, and the menu it came out of was
           eight rows of things that all looked alike.

           IT LINKS RATHER THAN REBUILDS. The flow that claims the badge and
           writes the tagline lives in the feed, and a second copy over here
           would be two implementations of one screen to keep in step. That
           address opens the sheet on arrival and then takes itself back out
           of the URL. -->
      <section class="hero section">
        <div class="eyebrow">Your Badge</div>
        <h1>Badge & Tagline</h1>
        <p>The mark next to your name in the feed, and the line that sits under it.</p>
        <p><a class="primary-btn" href="/feed-next/?badge=1">Open my badge & tagline</a></p>
      </section>

      <section class="hero section">
        <div class="eyebrow">About You</div>
        <h1>Your Profile</h1>
        <p>Shows at the top of your public page. Anything you leave blank just doesn't show.</p>
        <form id="about-form" class="form-grid">
          <label>Name (optional)<input type="text" name="display_name" maxlength="40" autocomplete="name" placeholder="Mike N." value="${escapeHtml(profile?.display_name || '')}"></label>
          <label>Bio<textarea name="bio" maxlength="160" rows="3" placeholder="Collecting since 2019 — Charizard hunter.">${escapeHtml(profile?.bio || '')}</textarea></label>
          <!-- HANDLES, NOT LINKS (25 Sep 2026). Just the name after the @; the
               page builds the real link. Pasting a whole address works too --
               cleanHandle() keeps only the handle out of it. -->
          <label>Instagram<input type="text" name="instagram" maxlength="60" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="@yourname" value="${escapeHtml(profile?.instagram ? '@' + profile.instagram : '')}"></label>
          <label>TikTok<input type="text" name="tiktok" maxlength="60" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="@yourname" value="${escapeHtml(profile?.tiktok ? '@' + profile.tiktok : '')}"></label>
          <label>Whatnot<input type="text" name="whatnot" maxlength="60" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="@yourname" value="${escapeHtml(profile?.whatnot ? '@' + profile.whatnot : '')}"></label>
          <label>Tags (comma-separated, up to 5)<input type="text" name="tags" maxlength="150" placeholder="Vintage only, Set completionist" value="${escapeHtml((profile?.tags || []).join(', '))}"></label>
          <div class="form-actions"><button class="primary-btn" type="submit">Save</button></div>
          <div id="about-status" class="form-status"></div>
        </form>
      </section>

      <section class="hero section">
        <div class="eyebrow">Grail Card</div>
        <h1>Spotlight a Favorite</h1>
        <p>Pick one card from your collection to feature at the top of your public page, with a note about why it matters to you.</p>
        ${ownedCards.length ? `
          <form id="grail-form" class="form-grid">
            <label>Card
              <select name="grail_card_id">
                <option value="">— None —</option>
                ${ownedCards.map(c => `<option value="${escapeHtml(c.id)}" ${profile?.grail_card_id === c.id ? 'selected' : ''}>${escapeHtml(c.card_name)} — ${escapeHtml(VARIANT_LABELS[c.variant] || c.variant)}</option>`).join('')}
              </select>
            </label>
            <label>Why this card? (optional)<textarea name="grail_note" maxlength="200" rows="2">${escapeHtml(profile?.grail_note || '')}</textarea></label>
            <div class="form-actions"><button class="primary-btn" type="submit">Save</button></div>
            <div id="grail-status" class="form-status"></div>
          </form>
        ` : `<p><small>Add a card to your collection first, then come back here to pick your grail.</small></p>`}
      </section>

      <section class="hero section">
        <div class="eyebrow">Public Profile</div>
        <h1>Your Page</h1>
        <p>Anyone with the link can see your photo, username, and — if you allow it — your collection and its value. No account needed to view it.</p>

        <label style="display:flex; align-items:center; gap:10px; margin-top:14px; font-weight:700;">
          <input type="checkbox" id="profile-is-public" ${isPublic ? 'checked' : ''}>
          Make my collection public
        </label>
        <label style="display:flex; align-items:center; gap:10px; margin-top:10px; font-weight:700;">
          <input type="checkbox" id="profile-show-price" ${showPrice ? 'checked' : ''}>
          Show my collection's total value on my public page
        </label>
        <div id="profile-privacy-status" class="form-status"></div>

        ${isPublic && profile?.username
          ? `<p style="margin-top:6px">Your page: <a href="/${escapeHtml(profile.username)}" target="_blank">${escapeHtml(profileUrl)}</a></p>`
          : `<p style="margin-top:6px"><small>Turn on "Make my collection public" to get a shareable link.</small></p>`}
      </section>

      <section class="hero section">
        <div class="eyebrow">Price Alerts</div>
        <h1>Stay In The Loop</h1>
        <p>Get a push notification when a card on your wish list drops in price, when your grail card moves, or a weekly update on what your collection's worth.</p>

        <label style="display:flex; align-items:center; gap:10px; margin-top:14px; font-weight:700;">
          <input type="checkbox" id="price-alerts-enabled" ${priceAlertsEnabled ? 'checked' : ''}>
          Notify me about price changes
        </label>
        <p style="margin-top:6px"><small>Also needs notifications turned on for this app — tap the bell icon at the top of the screen if you haven't already.</small></p>
        <div id="price-alerts-status" class="form-status"></div>
      </section>

      <section class="hero section">
        <div class="form-actions">
          <button class="danger-btn" type="button" id="account-sign-out">Sign Out</button>
        </div>
      </section>
    `;

    document.getElementById('account-avatar-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if(!file) return;
      const statusEl = document.getElementById('account-avatar-status');
      statusEl.textContent = 'Uploading…';
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${user.id}/avatar.${ext}`;
      const { error: uploadError } = await client().storage.from('avatars').upload(path, file, { upsert: true });
      if(uploadError){ statusEl.textContent = 'Could not upload: ' + uploadError.message; return; }
      const { data: { publicUrl } } = client().storage.from('avatars').getPublicUrl(path);
      // Cache-bust so the new photo shows immediately instead of a stale cached one.
      const bustUrl = publicUrl + '?t=' + Date.now();
      const { error: updateError } = await client().from('profiles').update({ avatar_url: bustUrl }).eq('id', user.id);
      if(updateError){ statusEl.textContent = 'Could not save photo: ' + updateError.message; return; }
      statusEl.textContent = 'Photo updated.';
      await renderSignedIn(user);
    });

    document.getElementById('about-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusEl = document.getElementById('about-status');
      const bio = e.target.elements.bio.value.trim().slice(0, 160);
      /* "@name", "name", or a pasted "https://www.instagram.com/name/?hl=en"
         all come down to "name". Anything that still is not a plain handle
         is refused here with a readable message, before the database
         refuses it with an unreadable one. */
      const cleanHandle = (v) => {
        let h = String(v || '').trim();
        if (!h) return null;
        h = h.replace(/^https?:\/\//i, '').replace(/^(www\.)?[a-z0-9.-]+\.(com|net|co)\//i, '');
        h = h.replace(/^user\//i, '');            // whatnot.com/user/<name>
        h = h.split(/[/?#]/)[0].replace(/^@/, '');
        return h || null;
      };
      const socials = {
        instagram: cleanHandle(e.target.elements.instagram.value),
        tiktok:    cleanHandle(e.target.elements.tiktok.value),
        whatnot:   cleanHandle(e.target.elements.whatnot.value)
      };
      const rules = { instagram: /^[A-Za-z0-9._]{1,30}$/, tiktok: /^[A-Za-z0-9._]{2,24}$/, whatnot: /^[A-Za-z0-9._-]{1,30}$/ };
      const bad = Object.keys(socials).find(k => socials[k] && !rules[k].test(socials[k]));
      if (bad) {
        statusEl.textContent = 'That ' + ({ instagram: 'Instagram', tiktok: 'TikTok', whatnot: 'Whatnot' })[bad]
          + ' name has something in it a handle can\'t — just the name after the @, please.';
        return;
      }
      const displayName = e.target.elements.display_name.value.trim().slice(0, 40);
      const tags = e.target.elements.tags.value.split(',')
        .map(t => t.trim()).filter(Boolean).slice(0, 5).map(t => t.slice(0, 24));
      statusEl.textContent = 'Saving…';
      const { error } = await client().from('profiles').update({
        bio: bio || null,
        tags: tags.length ? tags : null,
        display_name: displayName || null,
        ...socials
      }).eq('id', user.id);
      statusEl.textContent = error ? 'Could not save: ' + error.message : 'Saved!';
    });

    document.getElementById('grail-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusEl = document.getElementById('grail-status');
      const grailCardId = e.target.elements.grail_card_id.value || null;
      const grailNote = e.target.elements.grail_note.value.trim().slice(0, 200);
      statusEl.textContent = 'Saving…';
      const { error } = await client().from('profiles').update({
        grail_card_id: grailCardId,
        grail_note: grailCardId ? (grailNote || null) : null
      }).eq('id', user.id);
      statusEl.textContent = error ? 'Could not save: ' + error.message : 'Saved!';
    });

    async function savePrivacy(){
      const statusEl = document.getElementById('profile-privacy-status');
      statusEl.textContent = 'Saving…';
      const { error } = await client().from('profiles').update({
        is_public: document.getElementById('profile-is-public').checked,
        show_price: document.getElementById('profile-show-price').checked
      }).eq('id', user.id);
      if(error){ statusEl.textContent = 'Could not save: ' + error.message; return; }
      await renderSignedIn(user);
    }
    document.getElementById('profile-is-public')?.addEventListener('change', savePrivacy);
    document.getElementById('profile-show-price')?.addEventListener('change', savePrivacy);

    document.getElementById('price-alerts-enabled')?.addEventListener('change', async (e) => {
      const statusEl = document.getElementById('price-alerts-status');
      statusEl.textContent = 'Saving…';
      const { error } = await client().from('profiles').update({
        price_alerts_enabled: e.target.checked
      }).eq('id', user.id);
      statusEl.textContent = error ? 'Could not save: ' + error.message : 'Saved!';
    });

    document.getElementById('account-sign-out')?.addEventListener('click', async () => {
      window.InfinitePullsAuthLog && window.InfinitePullsAuthLog.onPurpose('the Sign out button on My Account');
      await client().auth.signOut();
      renderSignedOut('signin');
    });
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
