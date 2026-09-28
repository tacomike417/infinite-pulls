/* SET A NEW PASSWORD (28 Sep 2026, Mike).
 *
 * The "Forgot password?" email links back here with ?reset=1. The link
 * itself signs you in; this card then asks for the new password and saves
 * it. "Not now" closes it (you stay signed in), so it's never a dead end.
 */
(function () {
  'use strict';
  const sb = () => window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  let shown = false;

  const CSS = `
.pr{position:fixed;inset:0;z-index:9995;background:rgba(3,7,13,.85);display:flex;align-items:center;justify-content:center;padding:18px 16px;font:500 15px/1.45 system-ui,-apple-system,sans-serif}
.pr-card{width:100%;max-width:400px;background:#fff;color:#0f172a;border-radius:22px;padding:24px 20px 20px;box-shadow:0 20px 50px rgba(0,0,0,.45)}
.pr-card .wm{display:block;text-align:center;font:900 13px/1 system-ui,sans-serif;letter-spacing:.12em;color:#1d6cf2}
.pr-card h2{margin:10px 0 4px;text-align:center;font:900 24px/1.15 system-ui,sans-serif}
.pr-card p{margin:0 0 14px;text-align:center;color:#64748b}
.pr-card label{display:grid;gap:6px;margin:0 0 12px;color:#334155;font:700 14px/1.3 system-ui,sans-serif}
.pr-card input{box-sizing:border-box;width:100%;height:48px;padding:0 14px;border-radius:12px;border:1.5px solid #cbd5e1;background:#f8fafc;color:#0f172a;font:500 16px/1.2 system-ui,sans-serif}
.pr-card input:focus{outline:none;border-color:#1d6cf2;background:#fff}
.pr-show{display:flex;align-items:center;gap:8px;margin:-4px 0 12px;color:#475569;font:600 14px/1 system-ui,sans-serif}
.pr-show input{width:18px;height:18px;accent-color:#1d6cf2}
.pr-go{width:100%;height:52px;border:0;border-radius:14px;background:linear-gradient(135deg,#1d6cf2,#19bfff);color:#fff;font:900 17px/1 system-ui,sans-serif;cursor:pointer}
.pr-go[disabled]{opacity:.5}
.pr-st{min-height:20px;margin:10px 0 0;text-align:center;font:700 14px/1.4 system-ui,sans-serif;color:#b91c1c}
.pr-st.ok{color:#15803d}
.pr-later{display:block;margin:12px auto 0;background:none;border:0;color:#64748b;font:700 14px/1 system-ui,sans-serif;text-decoration:underline;cursor:pointer;padding:8px}
`;

  function clearFlag() {
    try {
      const u = new URL(location.href);
      if (u.searchParams.has('reset')) { u.searchParams.delete('reset'); history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash); }
    } catch (_) {}
  }

  function show() {
    if (shown) return; shown = true;
    if (!document.getElementById('pr-css')) { const st = document.createElement('style'); st.id = 'pr-css'; st.textContent = CSS; document.head.appendChild(st); }
    const el = document.createElement('div');
    el.className = 'pr'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<form class="pr-card">
      <span class="wm">∞ INFINITE PULLS</span>
      <h2>Set a new password</h2>
      <p>Pick one you'll remember. At least 6 characters.</p>
      <label>New password<input type="password" name="a" required minlength="6" autocomplete="new-password"></label>
      <label>Type it again<input type="password" name="b" required minlength="6" autocomplete="new-password"></label>
      <label class="pr-show"><input type="checkbox" name="s"> Show password</label>
      <button class="pr-go" type="submit">Save password</button>
      <p class="pr-st" role="status"></p>
      <button class="pr-later" type="button">Not now</button>
    </form>`;
    document.body.appendChild(el);
    const f = el.querySelector('form'), st = el.querySelector('.pr-st'), go = el.querySelector('.pr-go');
    const close = () => { el.remove(); clearFlag(); };
    el.querySelector('.pr-later').addEventListener('click', close);
    f.elements.s.addEventListener('change', () => { const t = f.elements.s.checked ? 'text' : 'password'; f.elements.a.type = t; f.elements.b.type = t; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      st.className = 'pr-st'; st.textContent = '';
      const a = f.elements.a.value, b = f.elements.b.value;
      if (a.length < 6) { st.textContent = 'At least 6 characters.'; return; }
      if (a !== b) { st.textContent = 'Those two don’t match.'; return; }
      go.disabled = true; go.textContent = 'Saving…';
      try {
        const { error } = await sb().auth.updateUser({ password: a });
        if (error) throw error;
        st.className = 'pr-st ok'; st.textContent = 'Saved! You’re signed in.';
        setTimeout(close, 1400);
      } catch (err) {
        st.textContent = /same|different/i.test((err && err.message) || '') ? 'That’s your old password. Pick a new one.'
          : 'That didn’t save. The link may have expired. Tap Forgot password again.';
        go.disabled = false; go.textContent = 'Save password';
      }
    });
    setTimeout(() => { try { f.elements.a.focus(); } catch (_) {} }, 50);
  }

  async function start() {
    for (let k = 0; k < 60 && !sb(); k++) await new Promise((r) => setTimeout(r, 150));
    if (!sb()) return;
    try { sb().auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') show(); }); } catch (_) {}
    let flagged = false;
    try { flagged = new URL(location.href).searchParams.get('reset') === '1' || /type=recovery/.test(location.hash); } catch (_) {}
    if (!flagged) return;
    /* the link's sign-in can take a moment to land */
    for (let k = 0; k < 20; k++) {
      try { const { data } = await sb().auth.getSession(); if (data && data.session) { show(); return; } } catch (_) {}
      await new Promise((r) => setTimeout(r, 300));
    }
    clearFlag();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
