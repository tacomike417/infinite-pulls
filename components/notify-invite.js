/* ASKING ABOUT NOTIFICATIONS ONCE, PROPERLY.
 *
 * WHAT WAS WRONG
 *
 * The only way to turn notifications on was a small bell in the top-right
 * corner. Nobody presses that. The app had working price alerts nobody was
 * receiving, and the shop owner did not know the feature existed until one
 * arrived by accident.
 *
 * WHY IT IS NOT SIMPLY ON BY DEFAULT
 *
 * Because no browser allows it. Notification.requestPermission() only
 * works inside a real tap -- Chrome ignores it otherwise -- and that rule
 * exists for a good reason: a site that could subscribe you silently
 * would.
 *
 * So the closest honest thing to "on by default" is to ASK, once, plainly,
 * where somebody will actually see it, instead of hiding it in an icon.
 *
 * WHEN IT APPEARS
 *
 * Signed in, notifications supported, never asked before, never dismissed.
 * All four, or it stays out of the way. It does not appear the instant
 * somebody lands -- a permission strip in front of a stranger is the thing
 * everybody hates -- it waits until they have signed in, which means they
 * have already decided they want this app.
 *
 * IT ASKS ONCE. "No thanks" is remembered forever, and the bell in the top
 * bar is still there for anybody who changes their mind. A prompt that
 * comes back is worse than no prompt at all.
 */
(function () {
  'use strict';

  const DISMISSED = 'infinite-pulls-notify-asked';

  const sbWrap = () => window.InfinitePullsSupabase || {};
  const sb = () => (sbWrap().ready ? sbWrap().client : null);
  const push = () => window.InfinitePullsPush;
  const el = () => document.getElementById('notify-invite');

  function asked() {
    try { return localStorage.getItem(DISMISSED) === '1'; } catch (_) { return false; }
  }
  function remember() {
    try { localStorage.setItem(DISMISSED, '1'); } catch (_) { /* a private window just gets asked again */ }
  }

  function hide() {
    const root = el();
    if (root) { root.hidden = true; root.innerHTML = ''; }
  }

  function html() {
    return `
      <div class="notify-invite-inner">
        <span class="notify-invite-text">
          <strong>Want a heads up when your cards move?</strong>
          <small>Price drops on your wish list, and when the shop posts something.</small>
        </span>
        <span class="notify-invite-actions">
          <button type="button" class="primary-btn" id="notify-yes">Turn on</button>
          <button type="button" class="ghost-btn" id="notify-no">No thanks</button>
        </span>
      </div>`;
  }

  async function maybeShow() {
    const root = el();
    const p = push();
    if (!root || !p) return;

    // Four conditions, all of them, or it stays hidden.
    if (asked()) return hide();
    if (!p.isSupported()) return hide();
    if (p.getPermission() !== 'default') return hide();   // already decided, either way

    const client = sb();
    if (!client) return hide();
    let signedIn = false;
    try {
      const { data } = await client.auth.getSession();
      signedIn = !!(data && data.session && data.session.user);
    } catch (_) { /* treat as signed out */ }
    if (!signedIn) return hide();

    root.hidden = false;
    root.innerHTML = html();

    /* subscribe() runs inside this click, which is the only place a
       browser will honour a permission request. */
    document.getElementById('notify-yes')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Turning on…';
      remember();
      try { await p.subscribe(); } catch (_) { /* declined, or blocked */ }
      hide();
      window.InfinitePullsTopbar?.updateNotifyButton?.();
    });

    document.getElementById('notify-no')?.addEventListener('click', () => {
      remember();
      hide();
    });
  }

  function init() {
    maybeShow();
    const client = sb();
    if (client && !init.bound) {
      init.bound = true;
      // Signing in is the moment this becomes relevant.
      client.auth.onAuthStateChange(() => maybeShow());
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.InfinitePullsNotifyInvite = { init, maybeShow };
})();
