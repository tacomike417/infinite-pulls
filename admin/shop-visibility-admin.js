/* WHAT IS ON THE WEBSITE — the curtain.
 *
 * WHY THIS IS OURS AND NOT CLOVER'S. Clover has a "show on the web"
 * switch, and it does nothing here: it belongs to Clover Online
 * Ordering, a separate product with its own permissions. This site
 * reads the plain Inventory API, which has no such flag. So the switch
 * is here instead.
 *
 * AND WHY NOT CLOVER'S `hidden`. Items do carry a `hidden` field, but it
 * hides them from the REGISTER -- and he still wants to sell a bottle of
 * water across the counter. "Not on the website" and "not on the till"
 * are two different sentences.
 *
 * NOTHING HERE DELETES ANYTHING. No stock moves, nothing changes in
 * Clover, and putting a category back is the same tap that took it down.
 */
(function () {
  'use strict';

  const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  let rows = [];

  function say(msg, kind) {
    const node = el('shop-visibility-status');
    if (!node) return;
    node.textContent = msg || '';
    node.style.color = kind === 'bad' ? '#fca5a5' : (kind === 'good' ? '#86efac' : '');
  }

  async function load() {
    const host = el('shop-visibility-list');
    const client = sb();
    if (!host || !client) return;

    try {
      const { data, error } = await client.rpc('shop_category_list');
      if (error) throw error;
      rows = Array.isArray(data) ? data : [];
    } catch (err) {
      host.innerHTML = '<small>Could not read the category list just now.</small>';
      return;
    }

    if (!rows.length) {
      host.innerHTML = '<small>Nothing in the shop yet. Sync from Clover first.</small>';
      return;
    }

    /* HIDDEN ONES FIRST. They are the ones he is most likely to have
       come here to change his mind about, and a list where the
       interesting rows are buried is a list nobody reads. */
    const sorted = [...rows].sort((a, b) => {
      if (a.hidden !== b.hidden) return a.hidden ? -1 : 1;
      return String(a.category_name).localeCompare(String(b.category_name));
    });

    host.innerHTML = sorted.map((r) => `
      <div class="vis-row${r.hidden ? ' is-hidden' : ''}">
        <span class="vis-name">
          <strong>${esc(r.category_name)}</strong>
          <small>${r.item_count} thing${Number(r.item_count) === 1 ? '' : 's'}${r.hidden ? ' · not on the website' : ''}</small>
        </span>
        <button type="button" class="ghost-btn vis-toggle"
                data-cat="${esc(r.category_name)}" data-hide="${r.hidden ? '0' : '1'}">
          ${r.hidden ? 'Put it back' : 'Take it off'}
        </button>
      </div>`).join('');

    const off = rows.filter((r) => r.hidden).length;
    say(off
      ? `${off} categor${off === 1 ? 'y is' : 'ies are'} off the website. Everything still sells at the counter.`
      : 'Everything is on the website.');
  }

  async function toggle(name, hide) {
    const client = sb();
    if (!client) return;

    /* "Everything else" is this screen's word for items with no category
       at all. There is no row in Clover to hide, so hiding it would be
       hiding a name we invented. */
    if (name === 'Everything else') {
      say('Those have no category in Clover yet. Give them one first — the scanner can file them in a batch.', 'bad');
      return;
    }

    say(hide ? `Taking ${name} off the website…` : `Putting ${name} back…`);
    try {
      const { error } = await client.rpc('set_category_hidden', { p_name: name, p_hidden: hide });
      if (error) throw error;
      await load();
      say(hide
        ? `${name} is off the website. It still sells at the counter, and nothing was deleted.`
        : `${name} is back on the website.`, 'good');
    } catch (err) {
      say(`That did not save: ${err?.message || err}. Nothing changed.`, 'bad');
    }
  }

  function init() {
    if (!el('shop-visibility-card')) return;
    el('shop-visibility-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      toggle(btn.dataset.cat, btn.dataset.hide === '1');
    });
    el('shop-visibility-refresh')?.addEventListener('click', load);
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
