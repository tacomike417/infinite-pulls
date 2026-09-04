/* API KEYS IN THE ADMIN PANEL.
 *
 * WHY THIS IS NOT A NORMAL ADMIN FIELD
 *
 * Every other box in this panel saves a value the panel can also read
 * back: the store name, the hours, the announcement. This one is
 * deliberately one-way. A Ximilar token is money — whoever holds it can
 * spend the shop's scanning budget — so it is written into a table that
 * has row level security on and no policies at all, unreachable over the
 * API by anybody, staff included. The only thing that ever reads it is
 * the scan-card Edge Function, running with the service role on
 * Supabase's own servers.
 *
 * So this page cannot show the key back. It shows the last four
 * characters, who saved it and when — which is enough to confirm a save
 * landed, and enough to tell one person's key from another's when the
 * account changes hands, and useless to anybody who steals it.
 *
 * WHY IT MATTERS HERE SPECIFICALLY
 *
 * Mike pays for this until November, then Jeff takes over with his own
 * key. That handover is a person typing a token into a box in a panel he
 * already uses — not a terminal, not a Supabase login, not a phone call
 * to whoever built the app.
 *
 * IT FAILS QUIETLY. If api_keys.sql has not been run, the functions this
 * calls do not exist; the card says so plainly instead of throwing.
 */
(function () {
  'use strict';

  const SECRET_NAME = 'ximilar';

  const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  const el = (id) => document.getElementById(id);

  function say(node, msg, kind) {
    if (!node) return;
    node.textContent = msg;
    node.style.color = kind === 'bad' ? '#fca5a5' : (kind === 'good' ? '#86efac' : '');
  }

  function when(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  async function refresh() {
    const status = el('scanner-key-status');
    const client = sb();
    if (!status || !client) return;

    let rows;
    try {
      const { data, error } = await client.rpc('app_secret_status');
      if (error) {
        // Most likely the migration has not been run yet. Say which one.
        status.innerHTML = '<small>Key storage is not set up yet — run <code>supabase/api_keys.sql</code> in the SQL editor.</small>';
        return;
      }
      rows = data || [];
    } catch (_) {
      status.innerHTML = '<small>Could not check the key.</small>';
      return;
    }

    const row = rows.find((r) => r.name === SECRET_NAME);
    if (!row) {
      status.innerHTML = '<small>No key saved. The scanner is falling back to reading the number in the corner.</small>';
      return;
    }
    const who = row.updated_by_email ? ' by ' + row.updated_by_email : '';
    const date = when(row.updated_at);
    status.innerHTML = '<small>✅ Key saved — ends <strong>' + String(row.hint || '????') + '</strong>'
      + (date ? ', ' + date : '') + who + '.</small>';
  }

  async function save() {
    const input = el('ximilar-token');
    const out = el('ximilar-save-status');
    const client = sb();
    if (!input || !client) return;

    const value = (input.value || '').trim();
    if (!value) { say(out, 'Paste a token first, or use Remove Key.', 'bad'); return; }

    say(out, 'Saving…');
    try {
      const { error } = await client.rpc('set_app_secret', { p_name: SECRET_NAME, p_value: value });
      if (error) { say(out, error.message || 'Could not save that key.', 'bad'); return; }
      // Cleared immediately: no reason for a live token to sit in a form
      // field on a shared shop computer.
      input.value = '';
      say(out, 'Saved. The scanner is using it from the next scan.', 'good');
      refresh();
    } catch (err) {
      say(out, (err && err.message) || 'Could not save that key.', 'bad');
    }
  }

  async function clear() {
    const out = el('ximilar-save-status');
    const client = sb();
    if (!client) return;
    say(out, 'Removing…');
    try {
      const { error } = await client.rpc('set_app_secret', { p_name: SECRET_NAME, p_value: '' });
      if (error) { say(out, error.message || 'Could not remove the key.', 'bad'); return; }
      const input = el('ximilar-token');
      if (input) input.value = '';
      say(out, 'Removed. The scanner is back to reading the corner number.', 'good');
      refresh();
    } catch (err) {
      say(out, (err && err.message) || 'Could not remove the key.', 'bad');
    }
  }

  function init() {
    if (!el('scanner-card')) return;
    el('ximilar-save')?.addEventListener('click', save);
    el('ximilar-clear')?.addEventListener('click', clear);
    refresh();

    const client = sb();
    if (client && !init.bound) {
      init.bound = true;
      client.auth.onAuthStateChange(() => refresh());
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
