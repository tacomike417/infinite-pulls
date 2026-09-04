/* "Glad you're here, tacomike417."
 *
 * A strip under the top bar that stays put on every page while somebody is
 * signed in. It is friendly, but that is not really what it is for.
 *
 * The username is what Jeff asks for at the counter to hand over a reward,
 * and it is the one thing about their own account nobody can ever
 * remember. Buried on My Account it costs a customer four taps while a
 * queue builds behind them. Here it is already on screen, wherever they
 * happen to be.
 *
 * So the name is the loud part of the line, and tapping it copies it.
 *
 * SIGNED OUT, THE SAME STRIP IS THE WAY IN
 *
 * The slot sat empty for anybody without an account, which is exactly the
 * person who most needs to be told there is one. It now carries "New here?
 * Sign up free · Log in" instead -- the top of the content, full width,
 * impossible to miss, and it costs the pages below it nothing: no button
 * had to be squeezed into the top bar and the white card on the home page
 * keeps its single action.
 *
 * The word "free" is in the button rather than beside it. Somebody scanning
 * reads the buttons and skips the sentence, and "free" is the fact that
 * decides whether they tap.
 *
 * It hides itself on the account page, where a strip inviting you to sign
 * up would be sitting directly above the sign-up form.
 */
(function () {
  'use strict';

  const sbWrap = () => window.InfinitePullsSupabase || {};
  const sb = () => (sbWrap().ready ? sbWrap().client : null);
  const el = () => document.getElementById('hello-bar');

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  let shownFor = null;

  async function nameFor(user) {
    // The Dex data layer already caches this for the signed-in visitor, and
    // it is loaded on every page. Reuse it rather than opening a second
    // query on every navigation.
    const dex = window.InfinitePullsDexData;
    if (dex && dex.loadUsername) {
      try {
        const n = await dex.loadUsername();
        if (n) return n;
      } catch (_) { /* fall through to asking directly */ }
    }
    try {
      const { data } = await sb().from('profiles').select('username').eq('id', user.id).maybeSingle();
      return (data && data.username) || '';
    } catch (_) {
      return '';
    }
  }

  /* Set while the strip is showing its signed-out form, so applyPage()
     knows whether a page change could hide it. */
  let signedOutMode = false;

  function onAccountPage() {
    const app = window.InfinitePullsApp;
    return !!(app && app.currentPage && app.currentPage() === 'account');
  }

  function renderSignedOut() {
    const bar = el();
    if (!bar) return;
    signedOutMode = true;
    bar.innerHTML =
      '<span class="hello-text hello-out">New here?' +
        '<a class="hello-cta" href="?page=account" data-route="account">Sign up free</a>' +
        '<a class="hello-alt" href="?page=account" data-route="account">Log in</a>' +
      '</span>';
    bar.hidden = onAccountPage();
  }

  /* Called on every navigation from app.js. No network, no re-query --
     it only decides whether the signed-out strip belongs on this page. */
  function applyPage() {
    const bar = el();
    if (!bar || !signedOutMode) return;
    bar.hidden = onAccountPage();
  }

  function render(name) {
    const bar = el();
    if (!bar) return;
    if (!name) { renderSignedOut(); return; }
    signedOutMode = false;

    bar.innerHTML =
      '<span class="hello-text">Glad you’re here, ' +
        '<button type="button" class="hello-name" title="Tap to copy">' + esc(name) + '</button>. ' +
        'Let’s explore what’s out there!</span>';
    bar.hidden = false;

    bar.querySelector('.hello-name').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(name);
        const was = btn.textContent;
        btn.textContent = 'copied';
        btn.classList.add('is-copied');
        setTimeout(() => { btn.textContent = was; btn.classList.remove('is-copied'); }, 1200);
      } catch (_) { /* a name they can read is the point; copying is a bonus */ }
    });
  }

  async function refresh() {
    const client = sb();
    if (!client) { render(''); return; }
    /* getSession() rather than getUser(), for the same reason as the
       scoreboard: getUser() is a round trip to the server, and during it
       this strip showed "New here? Sign up free" to somebody who was
       already signed in. */
    let user = null;
    try {
      const { data } = await client.auth.getSession();
      user = data && data.session && data.session.user;
    } catch (_) { /* signed out */ }

    if (!user) { shownFor = null; render(''); return; }
    if (shownFor === user.id && el() && !el().hidden) return;   // already up
    shownFor = user.id;
    render(await nameFor(user));
  }

  function init() {
    if (!el()) return;
    refresh();
    const client = sb();
    if (client) client.auth.onAuthStateChange(() => { shownFor = null; refresh(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.InfinitePullsHelloBar = { refresh, render, applyPage };
})();
