/* WHAT SOLD ONLINE, AND WHETHER ANYBODY HAS DEALT WITH IT.
 *
 * The rest of the checkout worked and still left the shop out of it.
 * Somebody pays at nine at night, the stock drops, the card leaves the
 * website, the customer gets a receipt -- and nobody in the shop is told
 * anything. This is the list that fixes that, plus a count on the Clover
 * tab so it does not need looking for.
 *
 * DATES ARE SPELLED OUT, NOT COUNTED DOWN. "2 days ago" is fine for a
 * feed and useless for a job: somebody standing at the counter needs to
 * know it was Saturday afternoon, because that is what they will search
 * their memory and their inbox for. Both are shown -- the plain date, and
 * how long it has been waiting, which is the bit that creates urgency.
 *
 * NO CUSTOMER DETAILS ANYWHERE. Their name, address, email and card live
 * with Clover, which is built to hold them. This page never asks for
 * them and could not show them if it wanted to.
 */
(function () {
  'use strict';

  const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  const el = (id) => document.getElementById(id);

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function money(n) {
    const v = typeof n === 'number' ? n : parseFloat(n);
    return isFinite(v) ? '$' + v.toFixed(2) : '';
  }

  /* "Sat 6 Sep, 9:14 pm" -- the shop's own clock, not UTC. */
  function whenText(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit'
    });
  }

  function waitingText(iso) {
    if (!iso) return '';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!isFinite(mins) || mins < 0) return '';
    if (mins < 60) return `waiting ${mins} min`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `waiting ${hrs} hour${hrs === 1 ? '' : 's'}`;
    return `waiting ${Math.round(hrs / 24)} days`;
  }

  function rowHtml(o) {
    const done = !!o.handled_at;
    const ship = o.fulfilment === 'ship';
    const line = money(o.unit_price);
    return `
      <div class="order-row${done ? ' is-done' : ''}">
        <span class="order-dot" aria-hidden="true"></span>
        <span class="order-body">
          <strong>${esc(o.item_name)}${(o.qty || 1) > 1 ? ' × ' + o.qty : ''}</strong>
          <small>
            <b class="order-tag${ship ? ' is-ship' : ''}">${ship ? 'POST IT' : 'COLLECTING'}</b>
            ${line ? esc(line) + ' · ' : ''}${esc(whenText(o.paid_at))}
            ${done ? '' : ' · <i>' + esc(waitingText(o.paid_at)) + '</i>'}
          </small>
        </span>
        <button type="button" class="${done ? 'ghost-btn' : 'primary-btn'} order-btn"
                data-order="${esc(o.id)}" data-done="${done ? '0' : '1'}">
          ${done ? 'Undo' : 'Done'}
        </button>
      </div>`;
  }

  async function load() {
    const client = sb();
    const host = el('orders-list');
    if (!client || !host) return;

    try {
      const { data, error } = await client.rpc('shop_orders', { p_limit: 40 });
      if (error) {
        host.innerHTML = `<div class="save-status" style="color:#fca5a5">Run supabase/shop_orders.sql in the SQL editor first.</div>`;
        return;
      }
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) {
        host.innerHTML = `<div class="save-status">Nothing has sold online yet. When it does, it shows up here.</div>`;
        badge(0);
        setTimeout(() => badge(0), 400);
        return;
      }
      host.innerHTML = rows.map(rowHtml).join('');
      const waiting = rows.filter((r) => !r.handled_at).length;
      badge(waiting);
      /* admin-tabs.js may not have drawn the strip yet when this first
         runs -- the count went nowhere and that is why no number showed
         up beside Clover. One retry after the page has settled. */
      setTimeout(() => badge(waiting), 400);
    } catch (_) {
      host.innerHTML = `<div class="save-status" style="color:#fca5a5">Could not load orders just now.</div>`;
    }
  }

  /* THE THING JEFF CANNOT MISS.
     A number on a tab was too quiet -- it is small, it is grey until you
     look for it, and somebody opening the panel to post a photo will
     never notice it. This is a full-width yellow bar above everything
     else, and it only exists when there is something to do. When the
     list is clear it removes itself entirely, so it never becomes
     furniture people learn to ignore. */
  function banner(n) {
    const host = document.getElementById('admin-content');
    const old = document.getElementById('orders-banner');
    if (!host) return;

    if (!n) { if (old) old.remove(); return; }

    const wrap = old || document.createElement('div');
    wrap.id = 'orders-banner';
    wrap.className = 'orders-banner';
    wrap.innerHTML = `
      <span class="ob-bell" aria-hidden="true">🔔</span>
      <span class="ob-words">
        <strong>${n} online order${n === 1 ? '' : 's'} waiting</strong>
        <small>Somebody bought from the website. ${n === 1 ? 'It needs' : 'They need'} posting or setting aside.</small>
      </span>
      <button type="button" class="ob-go" id="orders-banner-go">See the orders</button>`;

    // First child, so it sits above the tab strip and is the first thing
    // on the page whichever tab he was last looking at.
    if (!old) host.insertBefore(wrap, host.firstChild);

    document.getElementById('orders-banner-go')?.addEventListener('click', () => {
      const tabs = window.InfinitePullsAdminTabs;
      if (tabs && tabs.select) tabs.select('clover');
      /* Open the fold-out too. Landing on the right tab with the list
         still collapsed is most of the way there and no use at all. */
      setTimeout(() => {
        const card = document.getElementById('clover-orders-card');
        const det = card && card.querySelector('details');
        if (det) det.open = true;
        card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    });
  }

  /* The count on the tab as well -- free, and it keeps saying so once the
     banner has been clicked past. */
  function badge(n) {
    document.querySelectorAll('.tab-btn').forEach((b) => {
      if (!/^Clover/.test(b.textContent.trim())) return;
      b.textContent = n > 0 ? `Clover (${n})` : 'Clover';
      b.classList.toggle('has-waiting', n > 0);
    });
    banner(n);
  }

  async function toggle(id, done) {
    const client = sb();
    if (!client) return;
    try {
      await client.rpc('mark_order_handled', { p_hold: id, p_done: done });
    } catch (_) { /* the reload below shows the truth either way */ }
    load();
  }

  function init() {
    if (!el('orders-list')) return;
    el('orders-refresh')?.addEventListener('click', load);
    el('orders-list').addEventListener('click', (e) => {
      const b = e.target.closest('.order-btn');
      if (!b) return;
      toggle(b.getAttribute('data-order'), b.getAttribute('data-done') === '1');
    });
    load();

    const client = sb();
    if (client && !init.bound) {
      init.bound = true;
      client.auth.onAuthStateChange(() => load());
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
