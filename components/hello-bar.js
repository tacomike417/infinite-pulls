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
 * So the name is the loud part of the line.
 *
 * TAPPING IT OPENS THEIR OWN FEED PAGE. It used to copy the username to
 * the clipboard, which solved the counter problem and nothing else -- and
 * a name with a face next to it is a door in every app anybody has ever
 * used, so a tap that silently copied text read as broken. The username
 * is still on screen for anybody who needs to read it out.
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
 *
 * AND SIGNED IN, IT IS ALSO THE WAY OUT
 *
 * Signing out used to live at the bottom of the account page -- four taps
 * from most of the app, and findable only by somebody who already knew it
 * was there. It sits on this strip now, opposite the name, on every page.
 *
 * The two states are the same shape on purpose: the way in and the way out
 * are in the same place, so there is one strip to learn rather than two.
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

  /* ONE QUERY, TWO THINGS. The picture arrives with the name rather than
     in a second round trip, so the strip never draws a name and then pops
     a face in beside it half a second later. */
  async function profileFor(user) {
    try {
      const { data } = await sb().from('profiles')
        .select('username, avatar_url').eq('id', user.id).maybeSingle();
      if (data && data.username) return { name: data.username, avatar: data.avatar_url || '' };
    } catch (_) { /* fall through to the cached name */ }

    // The Dex data layer already caches the name for the signed-in
    // visitor and is loaded on every page. No picture there, but a name
    // with no face beats an empty strip.
    const dex = window.InfinitePullsDexData;
    if (dex && dex.loadUsername) {
      try {
        const n = await dex.loadUsername();
        if (n) return { name: n, avatar: '' };
      } catch (_) { /* nothing left to try */ }
    }
    return { name: '', avatar: '' };
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
    /* Shorter than it was, because it lives in the top bar now rather
       than on a full-width strip of its own. "New here?" was scene-setting
       that the two buttons make unnecessary. */
    bar.innerHTML =
      '<a class="hello-cta" href="?page=account" data-route="account">Sign up</a>' +
      '<a class="hello-alt" href="?page=account" data-route="account">Log in</a>';
    bar.hidden = onAccountPage();
  }

  /* Called on every navigation from app.js. No network, no re-query --
     it only decides whether the signed-out strip belongs on this page. */
  function applyPage() {
    const bar = el();
    if (!bar || !signedOutMode) return;
    bar.hidden = onAccountPage();
  }

  function render(name, avatar) {
    const bar = el();
    if (!bar) return;
    if (!name) { renderSignedOut(); return; }
    signedOutMode = false;

    /* The "Let's explore what's out there!" tail came off when Sign out
       moved in. On a narrow phone the two together wrapped the strip onto
       a second line, and of the two, the one that does something wins. */
    /* "Glad you're here," became "Hi," when this moved into the top bar.
       The greeting was worth a full-width strip; it is not worth the space
       beside a logo, and the NAME is the part that earns its place -- it
       is what Jeff asks for at the counter to hand over a reward, and the
       one thing about their own account nobody can ever remember. */
    /* A PLAIN LINK, NOT A BUTTON WITH A HANDLER. The feed is its own page
       rather than a route inside this app, so there is nothing for a
       router to do -- and a real <a> gives long-press, middle-click and
       copy-address for free, which a button never does.

       Straight to /feed-next/?who= rather than the clean /username: that
       clean path is served by 404.html, which bounces through a second
       page load to get here. The feed puts the pretty address back itself
       once it knows who it is looking at, so this is the same destination
       and one load quicker.

       NO PICTURE, NO BROKEN IMAGE. A first initial in a gold circle reads
       as deliberate; an <img> with an empty src reads as a bug. */
    const face = avatar
      ? '<img class="hello-face" src="' + esc(avatar) + '" alt="" ' +
        'onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),' +
        '{className:\'hello-face hello-face-letter\',textContent:' +
        JSON.stringify(String(name).charAt(0).toUpperCase()) + '}))">'
      : '<span class="hello-face hello-face-letter">' + esc(String(name).charAt(0).toUpperCase()) + '</span>';

    bar.innerHTML =
      '<a class="hello-me" href="/feed-next/?who=' + encodeURIComponent(name) + '" ' +
         'title="Open my page in the feed">' +
        face +
        '<span class="hello-name">' + esc(name) + '</span>' +
      '</a>' +
      '<button type="button" class="hello-signout">Sign out</button>';
    bar.hidden = false;

    bar.querySelector('.hello-signout').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Signing out…';
      const client = sb();
      /* Said out loud so the recorder can tell a sign-out somebody asked for
         from one the app did on its own. See components/auth-log.js. */
      window.InfinitePullsAuthLog && window.InfinitePullsAuthLog.onPurpose('the Sign out button in the top bar');
      try { if (client) await client.auth.signOut(); } catch (_) { /* going home either way */ }
      /* Home, not wherever they were: My Collection, My Pokédex and the
         rest are signed-in pages, and leaving somebody on one they can no
         longer read looks like the app broke rather than like they left. */
      if (typeof window.navigate === 'function') window.navigate('home');
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
    const me = await profileFor(user);
    render(me.name, me.avatar);
  }

  /* Safe to call more than once, and it has to be: its element is created
     by components/topbar.js now, which may render after this file's own
     DOMContentLoaded has already run and found nothing. The topbar calls
     this the moment the slot exists. */
  let started = false;
  function init() {
    if (!el()) return;
    refresh();
    if (started) return;
    started = true;
    const client = sb();
    if (client) client.auth.onAuthStateChange(() => { shownFor = null; refresh(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.InfinitePullsHelloBar = { init, refresh, render, applyPage };
})();
