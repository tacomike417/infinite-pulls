(function(){
  const CONDITIONS = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];

  // Kept in sync with app.js's RESERVED_USERNAMES and the DB check
  // constraint in supabase/schema.sql — usernames become part of a public
  // URL (infinitepulls.com/username), so they can't collide with a real
  // path the site already uses. Checked here too just for a friendlier,
  // instant error instead of waiting on a round trip to Supabase.
  const RESERVED_USERNAMES = new Set([
    'admin','assets','components','supabase','api','www','null','undefined',
    'favicon','index','readme','cname','app','style','config','manifest',
    'service-worker','home','shop','collection','events','deals','location',
    'hours','contact','about','account','menu'
  ]);

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
    const { data, error } = await client().from('profiles').select('username, avatar_url, is_public, show_price').eq('id', userId).maybeSingle();
    if(error) return null;
    return data;
  }

  function renderSignedOut(mode='signin'){
    const el = root();
    if(!el) return;
    el.innerHTML = `
      <section class="hero">
        <div class="eyebrow">Account</div>
        <h1>${mode === 'signup' ? 'Create Your Account' : 'Sign In'}</h1>
        <p>Create a free account to build your card collection and see what it's worth.</p>

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
        const { data, error } = await client().auth.signUp({
          email, password, options: { data: { username } }
        });
        if(error){ statusEl.textContent = friendlyError(error); return; }
        if(!data.session){
          statusEl.textContent = 'Account created — check your email to confirm it, then sign in.';
          return;
        }
        await renderSignedIn(data.session.user);
      } else {
        const { data, error } = await client().auth.signInWithPassword({ email, password });
        if(error){ statusEl.textContent = friendlyError(error); return; }
        await renderSignedIn(data.session.user);
      }
    });
  }

  async function loadVideos(userId){
    const { data, error } = await client().from('profile_videos').select('id, url, caption, added_at').eq('user_id', userId).order('added_at', { ascending: false });
    if(error) return [];
    return data || [];
  }

  function renderVideoRows(videos, userId){
    const listEl = document.getElementById('video-list');
    if(!listEl) return;
    if(!videos.length){
      listEl.innerHTML = '<div class="empty-state">No videos yet — paste a link above to add your first one.</div>';
      return;
    }
    listEl.innerHTML = `<div class="info-list">${videos.map(v => `
      <div class="info-row" style="align-items:center">
        <span style="min-width:0;">
          <strong style="display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(v.caption || v.url)}</strong>
          ${v.caption ? `<small style="display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(v.url)}</small>` : ''}
        </span>
        <button type="button" class="ghost-btn remove-video-btn" data-video-id="${escapeHtml(v.id)}" aria-label="Remove">✕</button>
      </div>
    `).join('')}</div>`;

    listEl.querySelectorAll('.remove-video-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await client().from('profile_videos').delete().eq('id', btn.dataset.videoId);
        renderVideoRows(await loadVideos(userId), userId);
      });
    });
  }

  async function renderSignedIn(user){
    const el = root();
    if(!el) return;
    const profile = await loadProfile(user.id);
    const username = profile?.username || user.email;
    const avatarUrl = profile?.avatar_url || '';
    const isPublic = profile?.is_public !== false;
    const showPrice = profile?.show_price !== false;
    const profileUrl = profile?.username ? `${location.origin}/${profile.username}` : '';

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
        <div class="eyebrow">Pack Openings</div>
        <h1>Videos</h1>
        <p>Already uploaded a pack-opening video to YouTube, TikTok, or Instagram? Paste the link here — YouTube links play right on your public page, others show as a "Watch" link. Only shows up if your collection is public.</p>
        <form id="add-video-form" class="form-grid">
          <label>Video Link<input type="url" name="url" placeholder="https://youtube.com/watch?v=..." required></label>
          <label>Caption (optional)<input type="text" name="caption" maxlength="80" placeholder="Opening a booster box!"></label>
          <div class="form-actions"><button class="primary-btn" type="submit">Add Video</button></div>
          <div id="add-video-status" class="form-status"></div>
        </form>
        <div id="video-list" style="margin-top:10px"></div>
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

    document.getElementById('add-video-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusEl = document.getElementById('add-video-status');
      const url = e.target.elements.url.value.trim();
      const caption = e.target.elements.caption.value.trim();
      try{ new URL(url); }catch{ statusEl.textContent = 'That doesn\'t look like a valid link.'; return; }
      statusEl.textContent = 'Adding…';
      const { error } = await client().from('profile_videos').insert({ user_id: user.id, url, caption: caption || null });
      if(error){ statusEl.textContent = 'Could not add: ' + error.message; return; }
      statusEl.textContent = 'Added!';
      e.target.reset();
      renderVideoRows(await loadVideos(user.id), user.id);
    });

    renderVideoRows(await loadVideos(user.id), user.id);

    document.getElementById('account-sign-out')?.addEventListener('click', async () => {
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
