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

  /* ---- The rewards ----
     The tiers are the same for everybody; the redemptions are the
     customer's own. Both are read-only from here. Only Jeff's admin panel
     ever writes a redemption, because only Jeff can hand over a discount. */

  let tiers = null;
  let redeemed = null;
  let username = null;

  async function loadTiers(force) {
    if (tiers && !force) return tiers;
    const client = sb();
    if (!client) return (tiers = []);
    const { data, error } = await client
      .from('dex_reward_tiers')
      .select('*')
      .eq('enabled', true)
      .order('cards_required', { ascending: true });
    if (error) { tiers = []; throw error; }
    tiers = data || [];
    return tiers;
  }

  async function loadRedemptions(force) {
    if (redeemed && !force) return redeemed;
    const client = sb();
    const user = await currentUser();
    if (!client || !user) return (redeemed = new Map());
    const { data, error } = await client
      .from('dex_reward_redemptions')
      .select('tier_id, redeemed_at')
      .eq('user_id', user.id);
    if (error) { redeemed = new Map(); throw error; }
    redeemed = new Map((data || []).map((r) => [r.tier_id, r.redeemed_at]));
    return redeemed;
  }

  /* The name they say at the counter. Worth showing on the page rather
     than expecting somebody to remember what they typed when they signed
     up three weeks ago. */
  async function loadUsername(force) {
    if (username !== null && !force) return username;
    const client = sb();
    const user = await currentUser();
    if (!client || !user) return (username = '');
    const { data } = await client.from('profiles').select('username').eq('id', user.id).maybeSingle();
    username = (data && data.username) || '';
    return username;
  }

  /* Rewards count EVERY card in the Dex, season and shop alike -- it is a
     pile of cards, and somebody who turned up to the grand opening should
     not be told that one does not count. The season fraction above is a
     different question and stays a different number, so anywhere this is
     shown it has to say which it means. */
  function rewardStatus(list, count, done) {
    const all = (list || []).map((t) => ({
      ...t,
      met: count >= t.cards_required,
      redeemedAt: done && done.get ? done.get(t.id) : null
    }));
    return {
      count,
      ready: all.filter((t) => t.met && !t.redeemedAt),
      collected: all.filter((t) => t.met && t.redeemedAt),
      next: all.find((t) => !t.met) || null,
      all
    };
  }

  /* The same visual language as "NEW POKÉDEX ENTRY!" -- it announces
     itself and gets out of the way. Deliberately not a modal. */
  function toast(card) { showToast('NEW DEX CARD!', card.name, card.task_line); }

  /* Crossing a reward tier is the bigger moment of the two, so it gets its
     own, fired after the card's own toast rather than instead of it. */
  function rewardToast(tier) {
    showToast('REWARD UNLOCKED!', tier.reward, 'Show your username at the counter', 900);
  }

  function showToast(head, body, foot, delay) {
    const make = () => {
    const el = document.createElement('div');
    el.className = 'pokedex-toast dex-toast';
    el.innerHTML =
      '<strong>' + escapeHtml(head) + '</strong>' +
      '<span>' + escapeHtml(body || '') + '</span>' +
      (foot ? '<small>' + escapeHtml(foot) + '</small>' : '');
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('pokedex-toast-in'));
    setTimeout(() => {
      el.classList.remove('pokedex-toast-in');
      setTimeout(() => el.remove(), 300);
    }, 3200);
    };
    if (delay) setTimeout(make, delay); else make();
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function forget() { catalogue = null; earned = null; tiers = null; redeemed = null; username = null; }

  window.InfinitePullsDexData = {
    loadCatalogue, loadEarned, currentUser,
    loadTiers, loadRedemptions, loadUsername, rewardStatus,
    progress, isOpen, claimCode, award, toast, rewardToast, forget, escapeHtml
  };
})();
