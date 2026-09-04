/* CONNECTING CLOVER WITH A MERCHANT API TOKEN.
 *
 * The other way into Clover — register a developer account, build an app,
 * send the shop through an OAuth screen — is the right shape for an app
 * that many shops install. It is also gated on a developer approval that
 * had not arrived, and it was the only path this panel offered.
 *
 * A shop can mint a token for its OWN data from its own Clover dashboard
 * in about two minutes, no developer account involved. Clover's own words
 * for what that is for: "internal tools or integrations where you control
 * both the application and the merchant environment". That is this.
 *
 * WHY THIS IS BETTER THAN A SHARED LOGIN
 *
 * Jeff offered his Clover login, which would have worked and been a bad
 * idea: it is the account that holds his payment history, and it stops
 * working the day he changes his password. A token is scoped to inventory
 * and nothing else, it cannot see payments or customers or staff, and he
 * can revoke it from that same screen without locking himself out of his
 * own till.
 *
 * THE TOKEN IS WRITE-ONLY FROM HERE. It goes into clover_connection,
 * which has row level security on and no policies at all, so nothing in
 * any browser can read it back — only the sync functions, running with the
 * service role. This page shows whether it is connected and never shows
 * the token.
 */
(function () {
  'use strict';

  const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  const el = (id) => document.getElementById(id);

  function say(node, msg, kind) {
    if (!node) return;
    node.textContent = msg;
    node.style.color = kind === 'bad' ? '#fca5a5' : (kind === 'good' ? '#86efac' : '');
  }

  /* The panel already has its own status line for Clover. This adds the
     one thing it could not say before: WHICH kind of connection is in
     place, so somebody with a working token is not still being told to go
     and finish an OAuth flow. */
  async function refresh() {
    const client = sb();
    const out = el('clover-token-status');
    if (!client || !out) return;

    try {
      const { data, error } = await client.rpc('clover_connection_status');
      if (error) {
        say(out, 'Run supabase/clover_merchant_token.sql in the SQL editor first.', 'bad');
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.connected) { say(out, ''); return; }

      if (row.token_kind === 'merchant') {
        say(out, `Connected with an API token — merchant ${row.merchant_id || ''}.`, 'good');
        // The developer-app steps are noise once a token is working.
        const oauth = el('clover-setup-steps');
        if (oauth) oauth.open = false;
      } else if (row.token_kind === 'oauth') {
        say(out, 'Connected through the developer app.', 'good');
      }
    } catch (_) { /* the panel's own status line still covers the basics */ }
  }

  async function save() {
    const client = sb();
    const out = el('clover-token-status');
    const mid = (el('clover-merchant-id')?.value || '').trim();
    const tok = (el('clover-api-token')?.value || '').trim();
    if (!client) return;

    if (!mid || !tok) { say(out, 'Both the Merchant ID and the token are needed.', 'bad'); return; }

    say(out, 'Connecting…');
    try {
      const { error } = await client.rpc('clover_save_merchant_token', {
        p_merchant_id: mid, p_token: tok
      });
      if (error) { say(out, error.message || 'Could not save that.', 'bad'); return; }
      // No reason for a live token to sit in a form field on a shop computer.
      const t = el('clover-api-token');
      if (t) t.value = '';
      say(out, 'Connected. Try "Sync Inventory Now" below.', 'good');
      refresh();
    } catch (err) {
      say(out, (err && err.message) || 'Could not save that.', 'bad');
    }
  }

  async function disconnect() {
    const client = sb();
    const out = el('clover-token-status');
    if (!client) return;
    say(out, 'Disconnecting…');
    try {
      const { error } = await client.rpc('clover_save_merchant_token', {
        p_merchant_id: '', p_token: ''
      });
      if (error) { say(out, error.message || 'Could not disconnect.', 'bad'); return; }
      const t = el('clover-api-token');
      if (t) t.value = '';
      say(out, 'Disconnected. The shop page falls back to whatever it showed before.', 'good');
    } catch (err) {
      say(out, (err && err.message) || 'Could not disconnect.', 'bad');
    }
  }

  function init() {
    if (!el('clover-token-setup')) return;
    el('clover-save-token')?.addEventListener('click', save);
    el('clover-disconnect')?.addEventListener('click', disconnect);
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
