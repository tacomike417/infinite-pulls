(function(){
  const CONDITIONS = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];

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
    if(/password/i.test(error.message) && /short|length|6/i.test(error.message)) return 'Password must be at least 6 characters.';
    return error.message;
  }

  async function loadProfile(userId){
    const { data, error } = await client().from('profiles').select('username, avatar_url').eq('id', userId).maybeSingle();
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
          ${mode === 'signup' ? '<label>Username<input name="username" required minlength="3" maxlength="24" autocomplete="username"></label>' : ''}
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

  async function renderSignedIn(user){
    const el = root();
    if(!el) return;
    const profile = await loadProfile(user.id);
    const username = profile?.username || user.email;
    const avatarUrl = profile?.avatar_url || '';

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

        <div class="form-actions" style="margin-top:20px">
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
