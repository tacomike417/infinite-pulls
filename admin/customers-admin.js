/* CUSTOMERS — who is behind the four numbers on The Shop at a Glance.
 *
 * The Glance card still shows counts and nothing else; that was a
 * deliberate design and it is untouched. Tapping a tile brings you HERE,
 * to a tab that says out loud what it is. See supabase/admin_customers.sql
 * for the same reasoning on the database side, and for the line this
 * feature does not cross: no email, no contact details, no sign-in times.
 *
 * TWO SCREENS, NEVER BOTH.
 *   the list    everybody in the chosen group, newest account first
 *   one person  their collection and their wish list
 *
 * The list is not paged. Below a few hundred customers a scroll is
 * simpler than a pager and Jeff never has to learn what a page is. When
 * that stops being true, page it here and nowhere else.
 */
(function () {
  'use strict';

  const SCOPES = [
    { key: 'all',        label: 'Everyone',    blurb: 'Every account, newest first.' },
    { key: 'new7',       label: 'New this week', blurb: 'Signed up in the last 7 days.' },
    { key: 'collectors', label: 'Collecting',  blurb: 'Has at least one card saved.' },
    { key: 'hunting',    label: 'Hunting',     blurb: 'Has a wish list going.' }
  ];

  let scope = 'all';
  let listCache = null;      // the rows for the scope on screen
  let openUser = null;       // the row being looked at, or null for the list

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const n = (v) => Number(v || 0).toLocaleString();

  /* "3 days ago" beats a timestamp for the question actually being asked,
     which is always how new somebody is rather than the exact minute. */
  function whenJoined(iso) {
    if (!iso) return '';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return 'joined today';
    if (days === 1) return 'joined yesterday';
    if (days < 30) return 'joined ' + days + ' days ago';
    if (days < 365) {
      const m = Math.floor(days / 30);
      return 'joined ' + m + (m === 1 ? ' month ago' : ' months ago');
    }
    return 'joined ' + new Date(iso).toLocaleDateString();
  }

  function status(msg) {
    const el = $('customers-status');
    if (el) el.textContent = msg || '';
  }

  /* Same reach as every other admin module: supabaseClient is a top-level
     const in admin.js, which puts it in global scope but not on window. */
  function client() {
    return (typeof supabaseClient !== 'undefined') ? supabaseClient : null;
  }

  /* ---- the list ---------------------------------------------------- */

  async function loadList() {
    const body = $('customers-body');
    const sb = client();
    if (!body || !sb) return;
    openUser = null;
    status('Loading…');
    body.innerHTML = '';

    const { data, error } = await sb.rpc('admin_customers', { scope });
    if (error) {
      status('Could not load: ' + error.message);
      return;
    }
    status('');
    listCache = data || [];
    renderList();
  }

  function renderList() {
    const body = $('customers-body');
    if (!body) return;
    const rows = listCache || [];
    const blurb = (SCOPES.find((s) => s.key === scope) || SCOPES[0]).blurb;

    if (!rows.length) {
      body.innerHTML =
        '<p class="cust-blurb">' + esc(blurb) + '</p>' +
        '<p><small>Nobody in this group yet.</small></p>';
      return;
    }

    body.innerHTML =
      '<p class="cust-blurb">' + esc(blurb) + ' — ' + n(rows.length) +
      (rows.length === 1 ? ' customer.' : ' customers.') + '</p>' +
      '<div class="cust-list">' + rows.map((r, i) => `
        <button class="cust-row" type="button" data-i="${i}">
          <span class="cust-face">${r.avatar_url
            ? `<img src="${esc(r.avatar_url)}" alt="">`
            : esc((r.username || '?').slice(0, 1).toUpperCase())}</span>
          <span class="cust-who">
            <b>${esc(r.username || 'no name')}</b>
            <small>${esc(whenJoined(r.created_at))}${r.is_public ? ' · public page' : ''}</small>
          </span>
          <span class="cust-nums">
            <span class="cust-num"><em>${n(r.cards_saved)}</em><i>cards</i></span>
            <span class="cust-num"><em>${n(r.cards_hunted)}</em><i>hunting</i></span>
          </span>
        </button>`).join('') + '</div>';
  }

  /* ---- one person -------------------------------------------------- */

  async function openPerson(row) {
    const body = $('customers-body');
    const sb = client();
    if (!body || !sb) return;
    openUser = row;
    status('Loading…');

    /* THE WAY OUT COMES FIRST. It is written before the two lists load,
       so there is never a moment on this screen without a visible way
       back to everybody. */
    body.innerHTML = `
      <div class="cust-detail-head">
        <button class="ghost-btn" type="button" id="cust-back">← All customers</button>
      </div>
      <div class="cust-person">
        <span class="cust-face cust-face-lg">${row.avatar_url
          ? `<img src="${esc(row.avatar_url)}" alt="">`
          : esc((row.username || '?').slice(0, 1).toUpperCase())}</span>
        <div>
          <h3>${esc(row.username || 'no name')}</h3>
          <small>${esc(whenJoined(row.created_at))}${row.is_public ? ' · has a public collector page' : ''}</small>
        </div>
      </div>
      <div id="cust-cards"></div>
      <div id="cust-wants"></div>`;

    const [cards, wants] = await Promise.all([
      sb.rpc('admin_customer_cards', { uid: row.user_id }),
      sb.rpc('admin_customer_wishlist', { uid: row.user_id })
    ]);
    status('');

    $('cust-cards').innerHTML = cardBlock(
      'Their collection', cards.data, cards.error,
      'Nothing saved yet.');
    $('cust-wants').innerHTML = cardBlock(
      'What they are hunting', wants.data, wants.error,
      'No wish list yet.');
  }

  function cardBlock(title, rows, error, empty) {
    if (error) return `<h4 class="cust-h">${esc(title)}</h4>
      <p><small>Could not load: ${esc(error.message)}</small></p>`;
    const list = rows || [];
    if (!list.length) return `<h4 class="cust-h">${esc(title)}</h4>
      <p><small>${esc(empty)}</small></p>`;
    return `<h4 class="cust-h">${esc(title)} <span>${n(list.length)}</span></h4>
      <div class="cust-cards">` + list.map((c) => `
        <div class="cust-card">
          ${c.image_url ? `<img src="${esc(c.image_url)}" alt="" loading="lazy">` : '<span class="cust-card-noart"></span>'}
          <div>
            <b>${esc(c.card_name)}</b>
            <small>${esc(c.set_name || '')}</small>
            <small>${esc(c.condition || '')}${c.quantity > 1 ? ' · ×' + n(c.quantity) : ''}</small>
          </div>
        </div>`).join('') + '</div>';
  }

  /* ---- wiring ------------------------------------------------------ */

  function buildChips() {
    const el = $('customers-chips');
    if (!el) return;
    el.innerHTML = SCOPES.map((s) => `
      <button class="cust-chip" type="button" data-scope="${s.key}"
              aria-pressed="${s.key === scope}">${esc(s.label)}</button>`).join('');
  }

  function markChips() {
    document.querySelectorAll('#customers-chips .cust-chip').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.scope === scope));
    });
  }

  function wire() {
    const card = $('customers-card');
    if (!card || card.dataset.wired === '1') return;
    card.dataset.wired = '1';
    buildChips();

    card.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-scope]');
      if (chip) { scope = chip.dataset.scope; markChips(); loadList(); return; }

      const back = e.target.closest('#cust-back');
      if (back) { renderList(); openUser = null; return; }

      const row = e.target.closest('.cust-row');
      if (row && listCache) { openPerson(listCache[Number(row.dataset.i)]); }
    });

    $('customers-refresh')?.addEventListener('click', loadList);
  }

  /* Opened from a tile on The Shop at a Glance. Sets the group, switches
     the tab by clicking its button (the strip owns its own switching --
     this file does not reach inside it), and loads. */
  function open(which) {
    scope = SCOPES.some((s) => s.key === which) ? which : 'all';
    wire();
    markChips();
    const btn = document.getElementById('tab-customers');
    if (btn) btn.click();
    window.scrollTo({ top: 0, behavior: 'instant' });
    loadList();
  }

  function init() {
    wire();
    /* Load when the tab is actually opened, not on every admin sign-in --
       there is no reason to pull every customer for somebody who came in
       to change the banner. */
    document.getElementById('tab-customers')?.addEventListener('click', () => {
      if (!listCache) loadList();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.InfinitePullsCustomers = { open, reload: loadList };
})();
