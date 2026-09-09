/* INFINITE PULLS SHOWCASE — the row Jeff fills himself.
 *
 * The shop page sorts by name, price or date. None of those put his best
 * card in front of anybody; it lands wherever the alphabet drops it. This
 * is where he says which twenty-five people see first.
 *
 * SWITCHES, NOT A BASKET. The first version had a search box and Add
 * buttons, which meant knowing what you were looking for before you could
 * do anything. Almost every card that belongs up here is one he listed in
 * the last day or two -- so those are simply on the screen with a switch
 * beside each, and the job is flicking a few of them on. Searching is
 * there for the older ones, underneath, where it belongs.
 *
 * TWENTY-FIVE IS THE DATABASE'S RULE, NOT THIS SCREEN'S. There is a
 * trigger on the table. This screen dims the off-switches when the row is
 * full, which is a kindness, not the limit -- the limit holds with two
 * phones open.
 *
 * THE SEARCH IS OURS, NOT CLOVER'S. It runs against shop_available in our
 * own database and matches on name, set name and card number, so "4/102"
 * and "base set" find things and not just an exact name.
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
  const RECENT = 25;

  let chosen = [];   // what is in the showcase now, in order
  let recent = [];   // the last 25 he listed
  let found = [];    // the last search

  const onIds = () => new Set(chosen.map((c) => c.clover_item_id));
  const isOn = (id) => onIds().has(id);

  function say(id, msg, kind) {
    const n = el(id);
    if (!n) return;
    n.textContent = msg || '';
    n.style.color = kind === 'bad' ? '#fca5a5' : (kind === 'good' ? '#86efac' : '');
  }

  function pic(row) {
    const src = row.art_url || row.photo_url;
    return src
      ? `<img class="sc-pic" src="${esc(src)}" alt="" loading="lazy">`
      : `<span class="sc-pic sc-pic-blank" aria-hidden="true"></span>`;
  }

  /* ONE ROW, ONE SWITCH. A real checkbox underneath, so it can be reached
     by keyboard and read out by a screen reader; the switch is what it
     looks like, not what it is. */
  function switchRow(row, opts = {}) {
    const on = isOn(row.clover_item_id);
    const full = chosen.length >= MAX && !on;
    const meta = [row.set_name, row.card_number].filter(Boolean).join(' · ');
    return `<label class="sc-row sc-switch-row${on ? ' is-on' : ''}${full ? ' is-full' : ''}">
      ${pic(row)}
      <span class="sc-facts">
        <strong>${esc(row.name)}</strong>
        <small>${esc(meta)}${row.price != null ? (meta ? ' · ' : '') + money(row.price) : ''}</small>
        ${opts.note ? `<small class="sc-trouble">${esc(opts.note)}</small>` : ''}
      </span>
      <span class="sc-toggle">
        <input type="checkbox" class="sc-switch" data-toggle="${esc(row.clover_item_id)}"
               ${on ? 'checked' : ''} ${full ? 'disabled' : ''}
               aria-label="Show ${esc(row.name)} in the Showcase">
        <span class="sc-track" aria-hidden="true"><span class="sc-knob"></span></span>
      </span>
    </label>`;
  }

  function drawCount() {
    const n = el('showcase-count');
    if (!n) return;
    const dead = chosen.filter((c) => c.sold || c.hidden).length;
    const left = MAX - chosen.length;
    n.innerHTML = `<strong>${chosen.length}</strong> of ${MAX} switched on`
      + (left > 0 ? ` · room for ${left} more` : ' · that is the lot')
      + (dead ? ` · <span class="sc-trouble">${dead} sold, swap ${dead === 1 ? 'it' : 'them'} out</span>` : '');
  }

  /* ---- the last 25 he listed -----------------------------------------
   * Newest first, because the card he is most likely to want up there is
   * the one he just priced in. */
  async function loadRecent() {
    const host = el('showcase-recent');
    const client = sb();
    if (!host || !client) return;
    try {
      const { data, error } = await client
        .from('shop_available')
        .select('clover_item_id, name, price, available, art_url, photo_url, set_name, card_number, added_at, hidden_online')
        .gt('available', 0)
        .not('price', 'is', null)
        /* FILTERED BEFORE THE LIMIT, NOT AFTER.
           Dropping hidden ones in JavaScript after asking for 25 means a
           shop with six hidden things shows nineteen. The database has to
           do the filtering or "the last 25" is a lie. */
        .eq('hidden_online', false)
        .order('added_at', { ascending: false })
        .limit(RECENT);
      if (error) throw error;
      recent = data || [];
    } catch (err) {
      host.innerHTML = '<small>Could not read your recent cards just now.</small>';
      return;
    }
    drawRecent();
  }

  function drawRecent() {
    const host = el('showcase-recent');
    if (!host) return;
    host.innerHTML = recent.length
      ? recent.map((r) => switchRow(r)).join('')
      : '<small>Nothing listed yet. Add a card and it turns up here.</small>';
  }

  /* ---- what is in it now, and in what order --------------------------- */
  async function loadChosen() {
    const client = sb();
    if (!client) return;
    try {
      const { data, error } = await client.rpc('shop_showcase_admin');
      if (error) throw error;
      chosen = Array.isArray(data) ? data : [];
    } catch (err) {
      say('showcase-status', 'Could not read the Showcase just now.', 'bad');
      chosen = [];
    }
    drawCount();
    drawOrder();
  }

  function drawOrder() {
    const host = el('showcase-list');
    const box = el('showcase-order');
    if (!host) return;
    if (box) box.hidden = chosen.length < 2;   // nothing to reorder with one card

    host.innerHTML = chosen.map((c, i) => `
      <div class="sc-row${c.sold || c.hidden ? ' is-trouble' : ''}">
        <span class="sc-num">${i + 1}</span>
        ${pic(c)}
        <span class="sc-facts">
          <strong>${esc(c.name)}</strong>
          <small>${esc([c.set_name, c.card_number].filter(Boolean).join(' · '))}</small>
          ${c.sold ? '<small class="sc-trouble">Sold — switch it off</small>' : ''}
          ${c.hidden && !c.sold ? '<small class="sc-trouble">Its category is off the website</small>' : ''}
        </span>
        <span class="sc-actions">
          <button type="button" class="ghost-btn sc-move" data-move="-1" data-id="${esc(c.clover_item_id)}"
                  ${i === 0 ? 'disabled' : ''} aria-label="Move earlier">←</button>
          <button type="button" class="ghost-btn sc-move" data-move="1" data-id="${esc(c.clover_item_id)}"
                  ${i === chosen.length - 1 ? 'disabled' : ''} aria-label="Move later">→</button>
        </span>
      </div>`).join('');
  }

  /* ---- searching his own shop ----------------------------------------
   * Name OR set OR card number, because he does not always have the same
   * one to hand: sometimes it is "charizard", sometimes "4/102", and
   * sometimes all he knows is that it came out of a Base Set box. */
  async function search() {
    const term = (el('showcase-q')?.value || '').trim();
    const client = sb();
    if (!client) return;

    if (term.length < 2) { say('showcase-find-status', 'Type at least two letters.', 'bad'); return; }
    say('showcase-find-status', 'Looking…');

    /* Commas and parentheses are the separators in PostgREST's `or`
       syntax, so a search for "Charizard, Base (Shadowless)" would be
       read as three broken conditions rather than one phrase. */
    const safe = term.replace(/[(),]/g, ' ').trim();
    if (!safe) { say('showcase-find-status', 'Try letters or numbers.', 'bad'); return; }

    try {
      const { data, error } = await client
        .from('shop_available')
        .select('clover_item_id, name, price, available, art_url, photo_url, set_name, card_number, hidden_online')
        .or(`name.ilike.%${safe}%,set_name.ilike.%${safe}%,card_number.ilike.%${safe}%`)
        .gt('available', 0)
        .not('price', 'is', null)
        .eq('hidden_online', false)      // same reason as above
        .order('name')
        .limit(40);
      if (error) throw error;
      found = data || [];
    } catch (err) {
      found = [];
      el('showcase-found').innerHTML = '';
      say('showcase-find-status', 'That search did not go through. Try again in a moment.', 'bad');
      return;
    }

    if (!found.length) {
      el('showcase-found').innerHTML = '';
      say('showcase-find-status', `Nothing in stock matching "${term}". Try part of the name, or the set.`, 'bad');
      return;
    }
    say('showcase-find-status', `${found.length} found.`);
    drawFound();
  }

  function drawFound() {
    const host = el('showcase-found');
    if (!host) return;
    host.innerHTML = found.map((r) => switchRow(r)).join('');
  }

  /* Every list on the screen shows the same cards, so all of them are
     redrawn after any change -- a card switched on in the search results
     has to look switched on in the recent list too. */
  function redrawAll() {
    drawCount();
    drawRecent();
    drawFound();
    drawOrder();
  }

  async function toggle(id, on, input) {
    const client = sb();
    if (!client) return;
    if (input) input.disabled = true;
    say('showcase-status', on ? 'Putting it up…' : 'Taking it down…');
    try {
      const { error } = await client.rpc(on ? 'showcase_add' : 'showcase_remove', { p_item_id: id });
      if (error) throw error;
      await loadChosen();
      redrawAll();
      say('showcase-status', '');
    } catch (err) {
      /* Put the switch back where it was: a switch that stays flicked
         after a failed save is a lie about what the shop is showing. */
      if (input) input.checked = !on;
      redrawAll();
      say('showcase-status', (err?.message || String(err)) + ' Nothing changed.', 'bad');
    } finally {
      if (input) input.disabled = false;
    }
  }

  async function move(id, direction) {
    const client = sb();
    if (!client) return;
    say('showcase-status', 'Moving it…');
    try {
      const { error } = await client.rpc('showcase_move', { p_item_id: id, p_direction: direction });
      if (error) throw error;
      await loadChosen();
      redrawAll();
      say('showcase-status', '');
    } catch (err) {
      say('showcase-status', (err?.message || String(err)) + ' Nothing changed.', 'bad');
    }
  }

  function init() {
    if (!el('showcase-card')) return;

    /* One listener on the card rather than one per switch: every list here
       is redrawn after every change, and listeners bound to redrawn HTML
       are the classic reason a second tap does nothing. */
    el('showcase-card').addEventListener('change', (e) => {
      const box = e.target.closest('[data-toggle]');
      if (!box) return;
      toggle(box.dataset.toggle, box.checked, box);
    });

    el('showcase-card').addEventListener('click', (e) => {
      const mv = e.target.closest('[data-move]');
      if (mv && !mv.disabled) move(mv.dataset.id, Number(mv.dataset.move));
    });

    el('showcase-search')?.addEventListener('click', search);
    el('showcase-q')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); search(); }
    });

    /* What is in it first, because every switch on the screen depends on
       knowing that -- then the cards to flick. */
    loadChosen().then(loadRecent);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
