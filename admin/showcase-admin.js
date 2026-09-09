/* INFINITE PULLS SHOWCASE — the row Jeff fills himself.
 *
 * The shop page sorts by name, price or date. None of those put his best
 * card in front of anybody; it lands wherever the alphabet drops it. This
 * is the screen where he says which twenty-five people see first.
 *
 * TWENTY-FIVE IS THE DATABASE'S RULE, NOT THIS SCREEN'S. There is a
 * trigger on the table. This screen greys out the Add buttons when the
 * row is full, which is a kindness, not the limit -- the limit holds even
 * with two phones open.
 *
 * A CARD THAT SELLS STAYS ON THIS SCREEN, marked sold, so he knows a slot
 * has gone dead and can fill it. It has already stopped showing on the
 * website by itself -- the public list only ever draws what is in stock.
 */
(function () {
  'use strict';

  const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
  const money = (n) => {
    const v = typeof n === 'number' ? n : parseFloat(n);
    return isFinite(v) ? '$' + v.toFixed(2) : '';
  };

  const MAX = 25;
  let chosen = [];     // what is in the showcase now
  let found = [];      // the last search results

  function say(node, msg, kind) {
    const n = el(node);
    if (!n) return;
    n.textContent = msg || '';
    n.style.color = kind === 'bad' ? '#fca5a5' : (kind === 'good' ? '#86efac' : '');
  }

  const inShowcase = (id) => chosen.some((c) => c.clover_item_id === id);

  /* The little picture. Catalogue art first, same as the website, so what
     he sees here is what a customer sees there. */
  function pic(row) {
    const src = row.art_url || row.photo_url;
    return src
      ? `<img class="sc-pic" src="${esc(src)}" alt="" loading="lazy">`
      : `<span class="sc-pic sc-pic-blank" aria-hidden="true"></span>`;
  }

  async function load() {
    const client = sb();
    if (!client || !el('showcase-card')) return;
    try {
      const { data, error } = await client.rpc('shop_showcase_admin');
      if (error) throw error;
      chosen = Array.isArray(data) ? data : [];
    } catch (err) {
      say('showcase-status', 'Could not read the Showcase just now.', 'bad');
      return;
    }
    drawChosen();
    drawFound();      // Add buttons grey out when the row fills
  }

  function drawChosen() {
    const host = el('showcase-list');
    const count = el('showcase-count');
    if (!host) return;

    if (count) {
      const dead = chosen.filter((c) => c.sold || c.hidden).length;
      count.textContent = `${chosen.length} of ${MAX}` + (dead ? ` · ${dead} need swapping out` : '');
    }

    if (!chosen.length) {
      host.innerHTML = '<p><small>Nothing picked yet. Search below and add your best cards — they show up across the top of the shop page.</small></p>';
      return;
    }

    host.innerHTML = chosen.map((c, i) => {
      const trouble = c.sold ? 'Sold — swap it out'
                    : c.hidden ? 'Its category is off the website' : '';
      return `<div class="sc-row${trouble ? ' is-trouble' : ''}">
        <span class="sc-num">${i + 1}</span>
        ${pic(c)}
        <span class="sc-facts">
          <strong>${esc(c.name)}</strong>
          <small>${esc([c.set_name, c.card_number].filter(Boolean).join(' · '))}${c.price != null ? ' · ' + money(c.price) : ''}</small>
          ${trouble ? `<small class="sc-trouble">${esc(trouble)}</small>` : ''}
        </span>
        <span class="sc-actions">
          <button type="button" class="ghost-btn sc-move" data-move="-1" data-id="${esc(c.clover_item_id)}"
                  ${i === 0 ? 'disabled' : ''} aria-label="Move left">←</button>
          <button type="button" class="ghost-btn sc-move" data-move="1" data-id="${esc(c.clover_item_id)}"
                  ${i === chosen.length - 1 ? 'disabled' : ''} aria-label="Move right">→</button>
          <button type="button" class="ghost-btn sc-drop" data-drop="${esc(c.clover_item_id)}" aria-label="Take out">✕</button>
        </span>
      </div>`;
    }).join('');
  }

  /* ---- finding a card to add ------------------------------------------
   * Searches his own shelf, not a card catalogue: the only things that
   * can go in the Showcase are things he actually has for sale. */
  async function search() {
    const term = (el('showcase-q')?.value || '').trim();
    const client = sb();
    if (!client) return;

    if (term.length < 2) { say('showcase-find-status', 'Type at least two letters.', 'bad'); return; }
    say('showcase-find-status', 'Looking…');

    try {
      const { data, error } = await client
        .from('shop_available')
        .select('clover_item_id, name, price, available, art_url, photo_url, set_name, card_number, hidden_online')
        .ilike('name', `%${term}%`)
        .gt('available', 0)
        .order('name')
        .limit(30);
      if (error) throw error;
      found = (data || []).filter((r) => !r.hidden_online && r.price != null);
    } catch (err) {
      found = [];
      say('showcase-find-status', 'That search did not go through. Try again in a moment.', 'bad');
      return;
    }

    if (!found.length) {
      say('showcase-find-status', `Nothing in stock matching "${term}".`, 'bad');
      drawFound();
      return;
    }
    say('showcase-find-status', '');
    drawFound();
  }

  function drawFound() {
    const host = el('showcase-found');
    if (!host) return;
    if (!found.length) { host.innerHTML = ''; return; }

    const full = chosen.length >= MAX;
    host.innerHTML = found.map((r) => {
      const already = inShowcase(r.clover_item_id);
      return `<div class="sc-row">
        ${pic(r)}
        <span class="sc-facts">
          <strong>${esc(r.name)}</strong>
          <small>${esc([r.set_name, r.card_number].filter(Boolean).join(' · '))}${r.price != null ? ' · ' + money(r.price) : ''}</small>
        </span>
        <span class="sc-actions">
          <button type="button" class="ghost-btn sc-add" data-add="${esc(r.clover_item_id)}"
                  ${already || full ? 'disabled' : ''}>
            ${already ? 'In it' : (full ? 'Row is full' : 'Add')}
          </button>
        </span>
      </div>`;
    }).join('');
  }

  async function act(fn, args, working) {
    const client = sb();
    if (!client) return;
    say('showcase-status', working);
    try {
      const { error } = await client.rpc(fn, args);
      if (error) throw error;
      await load();
      say('showcase-status', '', 'good');
    } catch (err) {
      /* The cap's own words come from the database, and they already say
         what to do about it. Anything else gets an honest sentence. */
      say('showcase-status', (err?.message || String(err)) + ' Nothing changed.', 'bad');
    }
  }

  function init() {
    if (!el('showcase-card')) return;

    el('showcase-list')?.addEventListener('click', (e) => {
      const drop = e.target.closest('[data-drop]');
      if (drop) return act('showcase_remove', { p_item_id: drop.dataset.drop }, 'Taking it out…');
      const move = e.target.closest('[data-move]');
      if (move && !move.disabled) {
        return act('showcase_move', { p_item_id: move.dataset.id, p_direction: Number(move.dataset.move) }, 'Moving it…');
      }
    });

    el('showcase-found')?.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      if (add && !add.disabled) act('showcase_add', { p_item_id: add.dataset.add }, 'Adding it…');
    });

    el('showcase-search')?.addEventListener('click', search);
    el('showcase-q')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); search(); }
    });

    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
