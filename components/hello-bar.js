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

  function render(name) {
    const bar = el();
    if (!bar) return;
    if (!name) { bar.hidden = true; bar.innerHTML = ''; return; }

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
    let user = null;
    try {
      const { data } = await client.auth.getUser();
      user = data && data.user;
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

  window.InfinitePullsHelloBar = { refresh, render };
})();
