/* SWITCHING ONLINE PAYMENTS ON.
 *
 * Sibling of clover-token-admin.js, and deliberately not folded into it.
 * That one stores a key scoped to inventory; this one stores a key that
 * can charge a customer. Same shop, same dashboard, very different
 * consequence if either is mishandled -- which is exactly what went
 * wrong the first time, when both lived in one card and a payments key
 * went into the inventory box. Two tabs rows, two tables, two files.
 *
 * NEITHER KEY IS EVER READABLE BACK. clover_ecom has row level security
 * on with NO policies at all, so only the Edge Functions -- running as
 * the service role -- can see it. This page can say "connected" and which
 * merchant, and that is the whole of what it is allowed to know.
 *
 * WHICH IS WHY SAVING IS SPLIT IN TWO. Setting this up means: paste the
 * key, save, go to Clover, generate a signing secret there, come back,
 * paste the secret. The key cannot be read back on that second visit, so
 * the secret has to be savable on its own -- clover_save_ecom() treats a
 * blank field as "leave that one alone".
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

  /* The URL Clover has to call. Built from the Supabase project this page
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
    const pay  = el('clover-ecom-status');
    const hook = el('clover-hook-status');
    if (!client) return;

    const box = el('clover-webhook-url');
    if (box && !box.value) box.value = webhookUrl();

    try {
      const { data, error } = await client.rpc('clover_ecom_status');
      if (error) {
        say(pay, 'Run supabase/shop_checkout.sql and shop_checkout_patch.sql in the SQL editor first.', 'bad');
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;

      if (!row || !row.connected) {
        say(pay, 'Payments are off — the shelf is view-only.');
        say(hook, 'Save the payments key first.');
        return;
      }

      say(pay, `Payments key saved — merchant ${row.merchant_id || ''}.`, 'good');

      /* A saved key with no signing secret is the dangerous middle state:
         customers can reach a payment page, and nothing can prove the
         "you got paid" message is really from Clover. The webhook
         function refuses to act without it, so this says plainly that
         sales will not complete rather than looking finished. */
      if (!row.has_webhook) {
        say(hook, 'No signing secret yet — sales will NOT complete until this is done.', 'bad');
      } else {
        say(hook, 'Signing secret saved. Payments are fully on.', 'good');
      }
    } catch (_) { /* the cards' own copy still explains the steps */ }
  }

  async function saveKey() {
    const client = sb();
    const out = el('clover-ecom-status');
    const mid = (el('clover-ecom-merchant')?.value || '').trim();
    const tok = (el('clover-ecom-token')?.value || '').trim();
    if (!client) return;

    if (!mid || !tok) { say(out, 'Both the Merchant ID and the private token are needed.', 'bad'); return; }

    say(out, 'Saving…');
    try {
      const { error } = await client.rpc('clover_save_ecom', {
        p_merchant_id: mid, p_private_token: tok, p_webhook_secret: null
      });
      if (error) { say(out, error.message || 'Could not save that.', 'bad'); return; }
      const t = el('clover-ecom-token'); if (t) t.value = '';   // no live key in a form field
      refresh();
    } catch (err) {
      say(out, (err && err.message) || 'Could not save that.', 'bad');
    }
  }

  async function saveSecret() {
    const client = sb();
    const out = el('clover-hook-status');
    const sec = (el('clover-ecom-secret')?.value || '').trim();
    if (!client) return;
    if (!sec) { say(out, 'Paste the signing secret Clover generated.', 'bad'); return; }

    say(out, 'Saving…');
    try {
      // Nulls for the key: leave whatever is already stored alone.
      const { error } = await client.rpc('clover_save_ecom', {
        p_merchant_id: null, p_private_token: null, p_webhook_secret: sec
      });
      if (error) { say(out, error.message || 'Could not save that.', 'bad'); return; }
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
      const { error } = await client.rpc('clover_disconnect_ecom');
      if (error) { say(out, error.message || 'Could not do that.', 'bad'); return; }
      const t = el('clover-ecom-token');  if (t) t.value = '';
      const s = el('clover-ecom-secret'); if (s) s.value = '';
      say(out, 'Payments are off. The shelf still shows, nobody can buy.', 'good');
      say(el('clover-hook-status'), '');
    } catch (err) {
      say(out, (err && err.message) || 'Could not do that.', 'bad');
    }
  }

  function copyWebhook() {
    const box = el('clover-webhook-url');
    if (!box) return;
    box.select();
    try { document.execCommand('copy'); } catch (_) { /* selected either way */ }
    say(el('clover-hook-status'), 'Copied. Paste it into Clover, then press Generate there.', 'good');
  }

  /* PUTTING A STUCK CARD BACK.
     A hold lets go on its own after fifteen minutes, and now also the
     moment a customer backs out of the payment page. This is for the
     third case -- something odd, a browser closed mid-payment, a test
     run -- so that unsticking a card is a button rather than a trip to
     the SQL editor. */
  async function releaseHolds() {
    const client = sb();
    const out = el('clover-holds-status');
    if (!client) return;
    say(out, 'Putting them back…');
    try {
      const { data, error } = await client.rpc('release_all_shop_holds');
      if (error) { say(out, error.message || 'Could not do that.', 'bad'); return; }
      const n = typeof data === 'number' ? data : 0;
      say(out, n ? `${n} item${n === 1 ? '' : 's'} back on sale.` : 'Nothing was being held.', 'good');
    } catch (err) {
      say(out, (err && err.message) || 'Could not do that.', 'bad');
    }
  }

  function init() {
    el('clover-release-holds')?.addEventListener('click', releaseHolds);
    if (!el('clover-ecom-setup')) return;
    el('clover-save-ecom')?.addEventListener('click', saveKey);
    el('clover-save-secret')?.addEventListener('click', saveSecret);
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
