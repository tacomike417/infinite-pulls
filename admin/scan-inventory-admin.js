/* SCAN A CARD INTO THE SHOP'S INVENTORY.
 *
 * WHAT JEFF ASKED FOR: scan a card at the counter, and have it end up in
 * his POS inventory. Not an API integration -- that was an assumption
 * about the route, and the route turned out to be closed.
 *
 * WHY THERE IS A SPREADSHEET IN THE MIDDLE, FOR NOW
 *
 * Clover's REST API rejects every token this account can generate. That
 * was tested to exhaustion: all four regional hosts, both auth styles,
 * both merchant identifiers, and a token with every permission Clover
 * offers -- 401 every time. Clover's own staff have said in their
 * community that merchant-generated tokens cannot do this.
 *
 * What Clover DOES offer every merchant is bulk import from a sheet:
 * Inventory -> the three dots -> Import Inventory. So the scanning, the
 * pricing and the stacking happen here, and the last step is a file.
 *
 * THE LAST STEP IS THE ONLY PART THAT CHANGES LATER. Every row lands in
 * shop_scan_queue carrying what clover-add-item needs. When a token
 * finally works, "Download sheet" becomes "Add to Clover" and the flow is
 * scan, add, done. Nothing above that line gets rewritten.
 *
 * NOTHING HERE IS WRITTEN TWICE. The camera, Google Vision, the number
 * parsing, the TCGdex lookup and the pricing are all components/
 * collection.js -- the same code the customer-facing scanner runs. A
 * second implementation would be a second thing to fix every time a set
 * releases.
 */
(function () {
  'use strict';

  const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  const col = () => window.InfinitePullsCollection;
  const el = (id) => document.getElementById(id);

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  let pending = null;   // the card just scanned, not yet added
  let rows = [];        // what is queued
  let scanning = false;

  function say(node, msg, kind) {
    if (!node) return;
    node.textContent = msg;
    node.style.color = kind === 'bad' ? '#fca5a5' : (kind === 'good' ? '#86efac' : '');
  }

  const money = (n) => (typeof n === 'number' && isFinite(n))
    ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD' }) : '—';

  /* ---- Scanning ------------------------------------------------------ */

  async function scan() {
    const c = col();
    const status = el('scan-inv-status');
    if (!c || !c.scanCardSmart) { say(status, 'The scanner is not loaded on this page.', 'bad'); return; }
    if (scanning) return;
    scanning = true;

    try {
      say(status, '📷 Reading the card…');
      const res = await c.scanCardSmart('en');

      if (res.status === 'cancelled') { say(status, ''); return; }
      if (res.status === 'unavailable') { say(status, 'No camera available on this device.', 'bad'); return; }
      if (res.status !== 'ok' || !res.number) {
        say(status, 'Could not read that card. Fill the outline and hold it straight on.', 'bad');
        return;
      }

      say(status, `Read ${res.number} — looking it up…`);
      const { results } = await c.lookupByNumber(res.number, 'en');
      const hit = (results || []).find((r) => r.card) || null;
      if (!hit) { say(status, `Read ${res.number} but found no card by it.`, 'bad'); return; }

      showPending(hit);
      say(status, '');
    } catch (err) {
      say(status, (err && err.message) || 'That did not go through.', 'bad');
    } finally {
      scanning = false;
    }
  }

  function showPending(hit) {
    const card = hit.card;
    pending = {
      card_id: card.id,
      name: card.name || '',
      set_name: (card.set && card.set.name) || '',
      card_number: card.localId || '',
      image_url: card.image ? card.image + '/low.webp' : '',
      market_price: (typeof hit.amount === 'number') ? hit.amount : null
    };

    el('scan-inv-art').src = pending.image_url || '';
    el('scan-inv-name').textContent = pending.name;
    el('scan-inv-meta').textContent =
      [pending.set_name, pending.card_number].filter(Boolean).join(' · ');
    el('scan-inv-market').textContent = pending.market_price === null
      ? 'No market price carried for this one'
      : 'Market ' + money(pending.market_price);

    /* The market price is offered as the starting point, not imposed. What
       a shop sells at is a decision with rent and a counter behind it, and
       it is not TCGplayer's to make. */
    el('scan-inv-price').value = pending.market_price === null ? '' : pending.market_price.toFixed(2);
    el('scan-inv-qty').value = 1;
    el('scan-inv-pending').hidden = false;
    el('scan-inv-price').focus();
  }

  function clearPending() {
    pending = null;
    el('scan-inv-pending').hidden = true;
  }

  /* ---- The queue ----------------------------------------------------- */

  async function add() {
    const client = sb();
    const status = el('scan-inv-status');
    if (!client || !pending) return;

    const price = parseFloat(el('scan-inv-price').value);
    const qty = parseInt(el('scan-inv-qty').value, 10);
    if (!isFinite(price) || price < 0) { say(status, 'Put a price on it first.', 'bad'); return; }
    if (!isFinite(qty) || qty < 1) { say(status, 'Quantity has to be at least 1.', 'bad'); return; }

    let userId = null;
    try {
      const { data } = await client.auth.getSession();
      userId = data && data.session && data.session.user && data.session.user.id;
    } catch (_) { /* the row is still worth writing */ }

    try {
      const { error } = await client.from('shop_scan_queue').insert({
        scanned_by: userId,
        card_id: pending.card_id,
        name: pending.name,
        set_name: pending.set_name,
        card_number: pending.card_number,
        image_url: pending.image_url,
        /* The TCGdex id doubles as the SKU: it is already unique, already
           stable across reprints, and it means a card scanned twice on
           different days carries the same code into his till. */
        sku: pending.card_id,
        price,
        market_price: pending.market_price,
        quantity: qty
      });
      if (error) { say(status, error.message || 'Could not save that.', 'bad'); return; }

      say(status, `Added ${pending.name} — scan the next one.`, 'good');
      clearPending();
      await load();
    } catch (err) {
      say(status, (err && err.message) || 'Could not save that.', 'bad');
    }
  }

  async function load() {
    const client = sb();
    const list = el('scan-inv-list');
    if (!client || !list) return;

    try {
      const { data, error } = await client.from('shop_scan_queue')
        .select('*').is('pushed_at', null)
        .order('scanned_at', { ascending: false }).limit(500);
      if (error) {
        list.innerHTML = '<small>Run supabase/scan_queue.sql in the SQL editor first.</small>';
        return;
      }
      rows = data || [];
    } catch (_) { return; }

    el('scan-inv-count').textContent = rows.length ? `(${rows.length})` : '';

    if (!rows.length) {
      list.innerHTML = '<small>Nothing scanned yet.</small>';
      return;
    }

    list.innerHTML = rows.map((r) => `
      <div class="info-row">
        <span>
          <strong>${esc(r.name)}</strong>
          <small>${esc([r.set_name, r.card_number].filter(Boolean).join(' · '))}${r.exported_at ? ' · already downloaded' : ''}</small>
        </span>
        <span>${money(Number(r.price))}${r.quantity > 1 ? ` ×${r.quantity}` : ''}
          <button class="ghost-btn" type="button" data-remove="${esc(r.id)}">Remove</button>
        </span>
      </div>`).join('');
  }

  async function remove(id) {
    const client = sb();
    if (!client) return;
    try {
      await client.from('shop_scan_queue').delete().eq('id', id);
      await load();
    } catch (_) { /* the list redraws from the truth either way */ }
  }

  /* ---- The sheet ------------------------------------------------------ */

  /* CSV, which Clover's importer accepts alongside Excel, and which needs
     no library to produce. Columns are the ones Clover's own template
     uses; if his import ever rejects it, the template on his Inventory
     screen is the thing to match and it is a one-line change here. */
  function csv(list) {
    const head = ['Name', 'Price', 'Quantity', 'SKU', 'Product Code', 'Category'];
    const cell = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [head.join(',')];
    list.forEach((r) => {
      const label = [r.name, r.set_name, r.card_number].filter(Boolean).join(' - ');
      lines.push([
        cell(label),
        cell(Number(r.price).toFixed(2)),
        cell(r.quantity),
        cell(r.sku),
        cell(r.card_number),
        cell('Pokemon Singles')
      ].join(','));
    });
    return lines.join('\r\n');
  }

  async function exportSheet() {
    const out = el('scan-inv-export-status');
    if (!rows.length) { say(out, 'Nothing to download yet.', 'bad'); return; }

    const blob = new Blob([csv(rows)], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `infinite-pulls-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);

    /* Marked as downloaded, NOT deleted. An import that fails validation
       in Clover would otherwise be a stack of cards to scan all over
       again. Clearing is a separate, deliberate button. */
    const client = sb();
    if (client) {
      try {
        await client.from('shop_scan_queue')
          .update({ exported_at: new Date().toISOString() })
          .in('id', rows.map((r) => r.id));
      } catch (_) { /* the file is already downloaded, which is the point */ }
    }
    say(out, `${rows.length} card${rows.length === 1 ? '' : 's'} downloaded. In Clover: Inventory → the three dots → Import Inventory.`, 'good');
    load();
  }

  async function clearList() {
    const client = sb();
    const out = el('scan-inv-export-status');
    if (!client || !rows.length) return;
    // Only clears what has actually been downloaded — anything scanned
    // since the last download stays.
    const done = rows.filter((r) => r.exported_at).map((r) => r.id);
    if (!done.length) { say(out, 'Nothing has been downloaded yet — nothing cleared.', 'bad'); return; }
    try {
      await client.from('shop_scan_queue').delete().in('id', done);
      say(out, `Cleared ${done.length} downloaded card${done.length === 1 ? '' : 's'}.`, 'good');
      await load();
    } catch (err) {
      say(out, (err && err.message) || 'Could not clear those.', 'bad');
    }
  }

  function init() {
    if (!el('scan-inventory-card')) return;
    el('scan-inv-shoot')?.addEventListener('click', scan);
    el('scan-inv-add')?.addEventListener('click', add);
    el('scan-inv-skip')?.addEventListener('click', () => { clearPending(); say(el('scan-inv-status'), ''); });
    el('scan-inv-export')?.addEventListener('click', exportSheet);
    el('scan-inv-clear')?.addEventListener('click', clearList);
    el('scan-inv-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (btn) remove(btn.dataset.remove);
    });
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
