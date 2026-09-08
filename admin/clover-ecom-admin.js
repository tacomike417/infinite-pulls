/* SWITCHING ONLINE PAYMENTS ON.
 *
 * Sibling of clover-token-admin.js, and deliberately not folded into it.
 * That one stores a key scoped to inventory; this one stores a key that
 * can take money off a customer. Same shop, same dashboard, very
 * different consequence if either is mishandled, so they are two rows in
 * two tables and two bits of code.
 *
 * NEITHER KEY IS EVER READABLE BACK. clover_ecom has row level security
 * on with NO policies at all, so only the Edge Functions -- running as
 * the service role -- can see it. This page can say "connected" and which
 * merchant, and that is the whole of what it is allowed to know.
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

  /* The URL Clover has to call. Built from the Supabase project the page
     is already talking to, rather than typed into a config file that goes
     stale the day the project moves. */
  function webhookUrl() {
    try {
      const base = (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL)
        || (sb() && sb().supabaseUrl) || '';
      return base ? base.replace(/\/+$/, '') + '/functions/v1/clover-webhook' : '';
    } catch (_) { return ''; }
  }

  async function refresh() {
    const client = sb();
    const out = el('clover-ecom-status');
    if (!client || !out) return;

    const box = el('clover-webhook-url');
    if (box && !box.value) box.value = webhookUrl();

    try {
      const { data, error } = await client.rpc('clover_ecom_status');
      if (error) {
        say(out, 'Run supabase/shop_checkout.sql in the SQL editor first.', 'bad');
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.connected) { say(out, 'Payments are off — the shelf is view-only.'); return; }

      /* A connected key with no signing secret is the dangerous middle
         state: customers can reach a payment page, and nothing can prove
         the "you got paid" message is really from Clover. The webhook
         function refuses to act without the secret, so this says plainly
         that sales will not complete rather than looking finished. */
      if (!row.has_webhook) {
        say(out, `Key saved for merchant ${row.merchant_id || ''}, but there is no signing secret yet — `
               + 'sales will not complete until the webhook is set up in Clover and its secret pasted above.', 'bad');
        return;
      }
      say(out, `Payments are on — merchant ${row.merchant_id || ''}.`, 'good');
    } catch (_) { /* the panel's own status line still covers the basics */ }
  }

  async function save() {
    const client = sb();
    const out = el('clover-ecom-status');
    const mid = (el('clover-ecom-merchant')?.value || '').trim();
    const tok = (el('clover-ecom-token')?.value || '').trim();
    const sec = (el('clover-ecom-secret')?.value || '').trim();
    if (!client) return;

    if (!mid || !tok) { say(out, 'Both the Merchant ID and the private token are needed.', 'bad'); return; }

    say(out, 'Switching payments on…');
    try {
      const { error } = await client.rpc('clover_save_ecom', {
        p_merchant_id: mid, p_private_token: tok, p_webhook_secret: sec || null
      });
      if (error) { say(out, error.message || 'Could not save that.', 'bad'); return; }
      // No live key sits in a form field on a shop computer.
      const t = el('clover-ecom-token'); if (t) t.value = '';
      const s = el('clover-ecom-secret'); if (s) s.value = '';
      refresh();
    } catch (err) {
      say(out, (err && err.message) || 'Could not save that.', 'bad');
    }
  }

  async function disconnect() {
    const client = sb();
    const out = el('clover-ecom-status');
    if (!client) return;
    say(out, 'Turning payments off…');
    try {
      const { error } = await client.rpc('clover_save_ecom', {
        p_merchant_id: '', p_private_token: '', p_webhook_secret: null
      });
      if (error) { say(out, error.message || 'Could not do that.', 'bad'); return; }
      const t = el('clover-ecom-token'); if (t) t.value = '';
      const s = el('clover-ecom-secret'); if (s) s.value = '';
      say(out, 'Payments are off. The shelf still shows, nobody can buy.', 'good');
    } catch (err) {
      say(out, (err && err.message) || 'Could not do that.', 'bad');
    }
  }

  function copyWebhook() {
    const box = el('clover-webhook-url');
    if (!box) return;
    box.select();
    try { document.execCommand('copy'); } catch (_) { /* the field is selected either way */ }
    say(el('clover-ecom-status'), 'Copied. Paste it into Clover, then press Generate there.', 'good');
  }

  function init() {
    if (!el('clover-ecom-setup')) return;
    el('clover-save-ecom')?.addEventListener('click', save);
    el('clover-ecom-disconnect')?.addEventListener('click', disconnect);
    el('clover-copy-webhook')?.addEventListener('click', copyWebhook);
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
