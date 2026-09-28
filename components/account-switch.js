/* SWITCH ACCOUNTS, Instagram style (28 Sep 2026, Mike and Jeff).
 *
 * Sign into two accounts on one phone once (say your own and the shop's),
 * then flip between them from the menu with one tap. Each account is a
 * normal login; this only remembers them on THIS phone.
 *
 * HOW: the app's sign-in lives in localStorage under 'infinite-pulls-app-auth'.
 * The accounts you've used here are kept in 'ip-accounts' (username, face,
 * and that account's sign-in tokens), the same kind of data the app already
 * keeps for the account you're signed into. Switching hands the other
 * account's tokens to setSession() and reloads.
 *
 * Adding an account never calls signOut(), because signing out cancels that
 * account's tokens on the server and the switch back would fail. It just
 * puts the current sign-in aside and opens the sign-in page.
 */
(function () {
  'use strict';
  const sb = () => window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  const AUTH_KEY = 'infinite-pulls-app-auth';
  const LIST_KEY = 'ip-accounts';
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const read = () => { try { return JSON.parse(localStorage.getItem(LIST_KEY) || '[]') || []; } catch (_) { return []; } };
  const write = (l) => { try { localStorage.setItem(LIST_KEY, JSON.stringify(l.slice(0, 5))); } catch (_) {} };
  let meId = null;

  /* remember (or refresh) the account that's signed in right now */
  async function remember(session) {
    const c = sb(); if (!c) return;
    if (!session) { try { ({ data: { session } } = await c.auth.getSession()); } catch (_) { return; } }
    if (!session || !session.user) return;
    meId = session.user.id;
    let name = '', face = '';
    const list = read();
    const had = list.find((a) => a.id === meId);
    if (had) { name = had.name; face = had.face; }
    try {
      const { data } = await c.from('profiles').select('username, avatar_url').eq('id', meId).maybeSingle();
      if (data) { name = data.username || name; face = data.avatar_url || ''; }
    } catch (_) {}
    const entry = { id: meId, name: name || 'account', face, access_token: session.access_token, refresh_token: session.refresh_token, at: Date.now() };
    write([entry].concat(list.filter((a) => a.id !== meId)));
  }

  function forget(id) { write(read().filter((a) => a.id !== id)); }

  async function switchTo(id) {
    const c = sb(); if (!c || id === meId) return;
    const target = read().find((a) => a.id === id);
    if (!target) return;
    await remember();                                   /* keep this one's newest tokens */
    try {
      const { data, error } = await c.auth.setSession({ access_token: target.access_token, refresh_token: target.refresh_token });
      if (error || !data || !data.session) throw error || new Error('no session');
      await remember(data.session);
      location.href = '/feed-next/';
    } catch (_) {
      forget(id);
      alertLine(`@${target.name} needs you to sign in again.`);
      setTimeout(() => addAccount(), 1200);
    }
  }

  async function addAccount() {
    await remember();                                   /* set this one aside, still signed in */
    try { localStorage.removeItem(AUTH_KEY); } catch (_) {}
    try { sessionStorage.setItem('ip-after-signin', '/feed-next/'); } catch (_) {}
    location.href = '/?page=account';
  }

  function alertLine(t) {
    let el = document.getElementById('acct-say');
    if (!el) {
      el = document.createElement('div'); el.id = 'acct-say';
      el.style.cssText = 'position:fixed;left:50%;bottom:calc(90px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9999;background:#111827;color:#fff;padding:10px 16px;border-radius:999px;font:700 14px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.4)';
      document.body.appendChild(el);
    }
    el.textContent = t;
    clearTimeout(alertLine.t); alertLine.t = setTimeout(() => el.remove(), 3500);
  }

  /* THE MENU ROWS (feed.js calls this while drawing the menu) */
  function menuRows() {
    const list = read();
    const face = (a) => a.face
      ? `<img src="${esc(a.face)}" alt="" style="width:34px;height:34px;border-radius:50%;object-fit:cover;flex:none">`
      : `<span style="width:34px;height:34px;border-radius:50%;background:#1e293b;display:grid;place-items:center;font:900 14px system-ui;flex:none">${esc((a.name || '?').slice(0, 1).toUpperCase())}</span>`;
    const row = (a) => {
      const on = a.id === meId;
      return `<button type="button" data-acct-switch="${esc(a.id)}" style="display:flex;align-items:center;gap:10px;text-align:left">
        ${face(a)}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">@${esc(a.name)}</span>
        ${on ? '<span style="font-size:12px;font-weight:800;color:#2fd27a">✓ ON NOW</span>' : '<span style="font-size:12px;font-weight:800;opacity:.75">SWITCH</span>'}</button>`;
    };
    return `<p style="margin:12px 0 6px;font-size:11px;font-weight:800;letter-spacing:.08em;opacity:.7">YOUR ACCOUNTS ON THIS PHONE</p>
      ${list.map(row).join('')}
      <button type="button" data-acct-add style="display:flex;align-items:center;gap:10px">
        <span style="width:34px;height:34px;border-radius:50%;border:2px dashed currentColor;display:grid;place-items:center;font:900 18px system-ui;flex:none;opacity:.8">+</span>ADD ANOTHER ACCOUNT</button>`;
  }

  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-acct-switch]');
    if (s) { e.preventDefault(); e.stopPropagation(); switchTo(s.getAttribute('data-acct-switch')); return; }
    if (e.target.closest('[data-acct-add]')) { e.preventDefault(); e.stopPropagation(); addAccount(); }
  }, true);

  async function start() {
    for (let k = 0; k < 60 && !sb(); k++) await new Promise((r) => setTimeout(r, 150));
    if (!sb()) return;
    remember();
    try {
      sb().auth.onAuthStateChange((ev, session) => {
        if (ev === 'SIGNED_OUT') { if (meId) forget(meId); meId = null; return; }   /* a real sign out: drop it from the list */
        if (session && (ev === 'SIGNED_IN' || ev === 'TOKEN_REFRESHED')) remember(session);
      });
    } catch (_) {}
  }

  window.InfinitePullsAccounts = { menuRows, switchTo, addAccount, list: read };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
