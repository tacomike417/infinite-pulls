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

  /* Everything the database can see, checked in one call. Returns only
     what it just handed over, so the usual answer is an empty array. */
  async function sweep() {
    const client = sb();
    if (!client) return [];
    const { data, error } = await client.rpc('dex_sweep');
    if (error) throw error;
    const list = Array.isArray(data) ? data : [];
    if (list.length) earned = null;
    return list;
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

  /* NOT the same visual language as "NEW POKÉDEX ENTRY!", which is what
     it used to be and what caused the trouble.
     
     Two different things were announcing themselves in an identical gold
     box a few pixels above the same spot: discovering a Pokémon, and
     earning an Infinite Pulls reward. Worse, this one said "NEW DEX
     CARD", and the app already has a thing called My Pokédex — so a
     customer earning a shop reward could reasonably think we had gone
     and changed their Pokédex.
     
     So this one is blue and marked with the ∞, and it says what it
     actually is. Nothing about a dex. */
  function toast(card) { showToast('∞ INFINITE REWARD EARNED!', card.name, card.task_line); }

  /* A backfill -- somebody who has been using the app for weeks and is
     handed everything they already earned -- can be nine cards at once.
     Nine toasts 0.8s apart is seven seconds of things sliding in and out,
     and it stops being a pleasure around the fourth. Past three, say the
     number once and let the wiggling grid do the rest of the talking. */
  function batchToast(n) {
    showToast('∞ INFINITE REWARDS EARNED!', n + ' at once', 'Every one of them is wiggling below.');
  }

  /* Crossing a reward tier is the bigger moment of the two, so it gets its
     own, fired after the card's own toast rather than instead of it. */
  function rewardToast(tier) {
    showToast('★ SHOP REWARD UNLOCKED!', tier.reward, 'Show your username at the counter', 1200);
  }

  // Long enough to actually read three lines. The old 3.2 seconds was
  // fine for one word; it is not fine for a heading, a card name and a
  // task line, and somebody glancing down at their phone got nothing but
  // a flash of gold.
  const TOAST_MS = 5200;

  /* Two arriving together used to sit exactly on top of each other —
     same position, same size — so the first was simply invisible. Each
     one now sits above the last, and the stack settles back down as they
     leave. */
  function restack() {
    // Measured, not guessed. A fixed offset was fine for a one-line toast
    // and overlapped badly on a three-line one, which is the whole thing
    // this was meant to fix.
    //
    // Newest sits lowest — nearest the thumb and painted on top — and
    // anything already up is pushed above it. Every toast in the app is
    // caught, not just this file's, so an Infinite Reward and a Pokédex
    // entry arriving together cannot land on each other either.
    const live = [...document.querySelectorAll('.pokedex-toast')].reverse();
    let lift = 0;
    live.forEach((t) => {
      t.style.setProperty('--toast-lift', lift + 'px');
      lift += t.offsetHeight + 10;
    });
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
    restack();
    requestAnimationFrame(() => el.classList.add('pokedex-toast-in'));
    setTimeout(() => {
      el.classList.remove('pokedex-toast-in');
      setTimeout(() => { el.remove(); restack(); }, 300);
    }, TOAST_MS);
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
    loadTiers, loadRedemptions, loadUsername, rewardStatus, sweep,
    progress, isOpen, claimCode, award, toast, batchToast, rewardToast, forget, escapeHtml
  };
})();
