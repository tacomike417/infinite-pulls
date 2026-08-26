/* Who is allowed to see the admin panel.
 *
 * THIS IS THE SECOND LOCK, NOT THE FIRST.
 *
 * The real one is row-level security — supabase/admin_lockdown.sql — and it
 * is the only one that matters, because the database is reachable over the
 * ordinary REST API with nothing but the public anon key and a customer's
 * own login. A customer never has to open this page to write to a table.
 * Hiding the page protects nothing on its own.
 *
 * What this file is for is honesty. Before it, a customer who signed in at
 * /admin/ got the whole panel: every field, every Publish button, all of
 * them failing silently because the policies said no. That reads as a
 * broken shop, not a closed door. This tells them plainly instead.
 *
 * It fails OPEN on purpose. If is_shop_staff() does not exist yet — the
 * lockdown SQL has not been run — this does nothing at all rather than
 * locking the shop out of its own panel over a missing function.
 */
(function () {
  'use strict';

  const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : null);

  let denied = false;

  function deny() {
    if (denied) return;
    denied = true;

    const content = document.getElementById('admin-content');
    const login = document.getElementById('login-screen');
    const status = document.getElementById('login-status');
    const signOut = document.getElementById('sign-out-btn');

    if (content) content.hidden = true;
    if (login) login.hidden = false;
    if (signOut) signOut.hidden = true;
    if (status) {
      status.textContent =
        'That account is signed in, but it is not set up for the shop panel. If it should be, ask whoever runs the shop to add it.';
      status.style.color = '#fca5a5';
    }

    // Sign the customer account out of this panel so a reload does not put
    // them straight back on a page they cannot use. Their login on the
    // public app is a separate session and is not touched — see the
    // storageKey note in admin.js.
    const client = sb();
    if (client) client.auth.signOut().catch(() => {});
  }

  async function check(session) {
    const client = sb();
    if (!client || !session) return;
    let ok;
    try {
      const { data, error } = await client.rpc('is_shop_staff');
      // No such function: the lockdown has not been run. Leave the panel
      // exactly as it was rather than guessing.
      if (error) return;
      ok = data;
    } catch (_) {
      return;
    }
    if (ok === false) deny();
  }

  function init() {
    const client = sb();
    if (!client) return;
    client.auth.getSession().then(({ data }) => check(data && data.session));
    client.auth.onAuthStateChange((_e, session) => { denied = false; check(session); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.InfinitePullsAdminGuard = { check, deny };
})();
