/* BEFORE YOU KEEP GOING (28 Sep 2026, Mike).
 *
 * Every signed-in member who hasn't given a birthday and agreed to the
 * Terms gets this once. Under 13 gets a stop screen instead. Nothing is
 * shown to guests, and nothing at all happens until supabase/ages.sql has
 * been run (my_age_status() is missing, so this quietly does nothing).
 *
 * The birthday is private (member_ages, only its owner can read it) and
 * can't be changed afterwards from the app.
 *
 * The way out is Sign out: this step is required, so there's no close.
 */
(function () {
  'use strict';
  const sb = () => window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  const today = () => new Date().toISOString().slice(0, 10);

  const CSS = `
.ag{position:fixed;inset:0;z-index:9990;background:rgba(3,7,13,.96);color:#f7f8fb;display:flex;align-items:center;justify-content:center;padding:20px 16px calc(20px + env(safe-area-inset-bottom));font:500 15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;overflow:auto}
.ag-card{width:100%;max-width:420px;background:#0a1120;border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:22px 20px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.ag-inf{font:900 13px/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#ffc928}
.ag h2{margin:10px 0 6px;font:900 24px/1.15 system-ui,sans-serif}
.ag p{margin:0 0 14px;color:#9eb0c8}
.ag label.b{display:block;font:800 14px/1.3 system-ui,sans-serif;margin:14px 0 6px}
.ag label.b small{font-weight:600;color:#9eb0c8}
.ag input[type=date]{box-sizing:border-box;width:100%;padding:13px 12px;border-radius:12px;border:1px solid #2a3656;background:#03070d;color:#fff;font:600 16px/1.2 system-ui,sans-serif;color-scheme:dark}
.ag .agree{display:flex;gap:10px;align-items:flex-start;margin:16px 0 4px;font-size:14px;line-height:1.4}
.ag .agree input{width:22px;height:22px;margin-top:1px;accent-color:#ffc928;flex:none}
.ag a{color:#19bfff}
.ag .go{display:block;width:100%;margin-top:16px;padding:15px;border:0;border-radius:14px;background:#ffc928;color:#1a1300;font:900 17px/1 system-ui,sans-serif;cursor:pointer}
.ag .go[disabled]{opacity:.45}
.ag .err{min-height:20px;margin:10px 0 0;color:#ff8a8a;font-weight:700;font-size:14px}
.ag .out{display:block;margin:14px auto 0;background:none;border:0;color:#9eb0c8;font:700 14px/1 system-ui,sans-serif;text-decoration:underline;cursor:pointer;padding:8px}
.ag .rules{margin:12px 0 0;padding:10px 12px;border-radius:12px;background:rgba(255,201,40,.06);border:1px solid rgba(255,201,40,.25);color:#e7ecf5;font-size:13px}
`;

  function yearsOld(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
    const [y, m, d] = iso.split('-').map(Number);
    const now = new Date();
    let a = now.getFullYear() - y;
    if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
    return (a >= 0 && a < 125) ? a : null;
  }

  let el = null;
  function show(html) {
    if (!document.getElementById('ag-css')) {
      const st = document.createElement('style'); st.id = 'ag-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    if (!el) {
      el = document.createElement('div'); el.className = 'ag';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
      document.body.appendChild(el);
      document.documentElement.style.overflow = 'hidden';
    }
    el.innerHTML = `<div class="ag-card">${html}</div>`;
    const out = el.querySelector('[data-ag-out]');
    if (out) out.addEventListener('click', async () => {
      try { await sb().auth.signOut(); } catch (_) {}
      location.href = '/feed-next/';
    });
  }
  function hide() {
    if (el) { el.remove(); el = null; document.documentElement.style.overflow = ''; }
  }

  function stop() {
    show(`<div class="ag-inf">∞ Infinite Pulls</div>
      <h2>Sorry, you have to be 13 or older</h2>
      <p>Infinite Pulls accounts are for members 13 and up. A parent or guardian can make an account in their own name and use it with you.</p>
      <p>You're still welcome in the shop any time.</p>
      <button type="button" class="go" data-ag-out>Sign out</button>`);
  }

  function ask(hasBirthday) {
    show(`<div class="ag-inf">∞ Infinite Pulls</div>
      <h2>Before you keep going</h2>
      <p>${hasBirthday ? 'We updated our rules. Please read and agree to keep using Infinite Pulls.' : 'We need your birthday once, and your OK on our rules. It only takes a second.'}</p>
      ${hasBirthday ? '' : `<label class="b" for="ag-bday">Your birthday <small>· private, never shown on your profile</small></label>
      <input type="date" id="ag-bday" max="${today()}" min="1900-01-02" autocomplete="bday">`}
      <div class="rules">Accounts are for ages 13 and up. Private messaging is for 18 and up. Teens get extra protections.</div>
      <label class="agree"><input type="checkbox" id="ag-ok"><span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>. If I'm under 18, my parent or guardian agrees too.</span></label>
      <button type="button" class="go" data-ag-go disabled>Continue</button>
      <p class="err" role="status"></p>
      <button type="button" class="out" data-ag-out>Sign out instead</button>`);
    const bday = el.querySelector('#ag-bday'), ok = el.querySelector('#ag-ok'), go = el.querySelector('[data-ag-go]'), err = el.querySelector('.err');
    const sync = () => { go.disabled = !ok.checked || (bday && !bday.value); };
    if (bday) bday.addEventListener('input', sync);
    ok.addEventListener('change', sync);
    go.addEventListener('click', async () => {
      err.textContent = '';
      let iso = bday ? bday.value : '2000-01-01';     /* already on file: the server keeps the real one */
      if (bday) {
        const a = yearsOld(iso);
        if (a == null) { err.textContent = 'Please enter your birthday.'; return; }
      }
      go.disabled = true; go.textContent = 'Saving…';
      try {
        const { data, error } = await sb().rpc('set_my_birthdate', { p_birth: iso, p_agree: true });
        if (error) throw error;
        if (data === 'under13') { stop(); return; }
        if (data === 'ok' || data === 'already') { hide(); return; }
        err.textContent = 'That didn’t save. Check your birthday and try again.';
      } catch (_) {
        err.textContent = 'That didn’t save. Check your connection and try again.';
      }
      go.disabled = false; go.textContent = 'Continue';
    });
  }

  async function check() {
    const c = sb(); if (!c) return;
    let session = null;
    try { ({ data: { session } } = await c.auth.getSession()); } catch (_) {}
    if (!session) return;
    let row = null;
    try {
      const { data, error } = await c.rpc('my_age_status');
      if (error) return;                 /* ages.sql not run yet: do nothing */
      row = Array.isArray(data) ? data[0] : data;
    } catch (_) { return; }
    if (!row) return;
    if (row.has_birthdate && row.age != null && row.age < 13) { stop(); return; }
    if (row.has_birthdate && row.agreed) return;
    ask(!!row.has_birthdate);
  }

  async function start() {
    for (let k = 0; k < 60 && !sb(); k++) await new Promise((r) => setTimeout(r, 150));
    if (!sb()) return;
    check();
    try { sb().auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN') check(); }); } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
