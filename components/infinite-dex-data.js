/* Infinite Dex — the data layer.
 *
 * Everything that talks to Supabase about Dex cards lives here, and the
 * page in components/infinite-dex.js only ever draws what this returns.
 * Same split as pokemon-data.js / pokedex.js.
 *
 * THE ONE RULE: this file never inserts into user_dex_cards, because it
 * cannot -- there is no insert policy on that table. A card is earned by
 * calling one of two database functions, which check first:
 *
 *   claim_dex_card(word)  the code off a board in the shop
 *   award_dex_card(code)  something the app noticed
 *
 * If a future change here starts writing rows directly, it is wrong. See
 * section 2 and 3 of supabase/infinite_dex.sql.
 */
(function () {
  'use strict';

  const sbWrap = () => window.InfinitePullsSupabase || {};
  const sb = () => (sbWrap().ready ? sbWrap().client : null);

  let catalogue = null;   // every enabled card, ordered
  let earned = null;      // Map of card id -> earned_at, for the signed-in user

  async function currentUser() {
    const client = sb();
    if (!client) return null;
    const { data } = await client.auth.getUser();
    return data && data.user ? data.user : null;
  }

  /* The catalogue is the same for everybody and changes only when Jeff
     saves in the admin panel, so it is fetched once per visit. */
  async function loadCatalogue(force) {
    if (catalogue && !force) return catalogue;
    const client = sb();
    if (!client) return (catalogue = []);
    const { data, error } = await client
      .from('infinite_dex_cards')
      .select('*')
      .eq('enabled', true)
      .order('series', { ascending: true })
      .order('number', { ascending: true, nullsFirst: false })
      .order('display_order', { ascending: true });
    if (error) { catalogue = []; throw error; }
    catalogue = data || [];
    return catalogue;
  }

  async function loadEarned(force) {
    if (earned && !force) return earned;
    const client = sb();
    const user = await currentUser();
    if (!client || !user) return (earned = new Map());
    const { data, error } = await client
      .from('user_dex_cards')
      .select('card_id, earned_at')
      .eq('user_id', user.id);
    if (error) { earned = new Map(); throw error; }
    earned = new Map((data || []).map((r) => [r.card_id, r.earned_at]));
    return earned;
  }

  /* "5 / 12 collected" counts the numbered season only. Event cards are
     open-ended by design, so folding them into the denominator would make
     it move every time Jeff invents one -- see INFINITE-DEX.md. */
  function progress(cards, has) {
    const set = cards.filter((c) => c.series === 'set');
    const got = set.filter((c) => has.has(c.id)).length;
    return { got, total: set.length, pct: set.length ? Math.round((got / set.length) * 100) : 0 };
  }

  /* A card is claimable now if it is inside its window. A card outside its
     window still shows in the grid -- "you missed this one" is part of
     what makes a set worth completing. */
  function isOpen(card, now) {
    const t = now || Date.now();
    if (card.active_from && t < Date.parse(card.active_from)) return false;
    if (card.active_until && t > Date.parse(card.active_until)) return false;
    return true;
  }

  async function claimCode(word) {
    const client = sb();
    if (!client) return { status: 'invalid' };
    const { data, error } = await client.rpc('claim_dex_card', { p_claim_code: word });
    if (error) throw error;
    if (data && data.status === 'awarded') earned = null;   // refetch
    return data || { status: 'invalid' };
  }

  async function award(code) {
    const client = sb();
    if (!client) return { status: 'unknown' };
    const { data, error } = await client.rpc('award_dex_card', { p_code: code });
    if (error) throw error;
    if (data && data.status === 'awarded') earned = null;
    return data || { status: 'unknown' };
  }

  /* The same visual language as "NEW POKÉDEX ENTRY!" -- it announces
     itself and gets out of the way. Deliberately not a modal. */
  function toast(card) {
    const el = document.createElement('div');
    el.className = 'pokedex-toast dex-toast';
    el.innerHTML =
      '<strong>NEW DEX CARD!</strong>' +
      '<span>' + escapeHtml(card.name || '') + '</span>' +
      (card.task_line ? '<small>' + escapeHtml(card.task_line) + '</small>' : '');
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('pokedex-toast-in'));
    setTimeout(() => {
      el.classList.remove('pokedex-toast-in');
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function forget() { catalogue = null; earned = null; }

  window.InfinitePullsDexData = {
    loadCatalogue, loadEarned, currentUser,
    progress, isOpen, claimCode, award, toast, forget, escapeHtml
  };
})();
