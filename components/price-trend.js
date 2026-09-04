/* PRICE TREND — the green and red arrows, and the only place that decides
 * whether one is honest to draw.
 *
 * WHAT AN ARROW CLAIMS
 *
 * That this card is worth measurably more, or less, than it was a week
 * ago. That is a claim somebody negotiates against, so this file refuses
 * to make it without evidence: no history, no arrow. Not a grey arrow, not
 * a flat dash — nothing at all, because a neutral arrow reads as "it has
 * not moved" when what it means is "we do not know".
 *
 * WHERE THE EVIDENCE COMES FROM, IN ORDER
 *
 *   1. Cardmarket's own averages, when TCGdex passes them through. Their
 *      data commonly carries 1-, 7- and 30-day averages alongside the
 *      trend price. If avg7 is there it is the best possible source: a
 *      real seven-day mean, computed by the marketplace, available on the
 *      first ever lookup with no history of our own.
 *
 *      It is read defensively -- present, use it; absent, ignore it -- so
 *      this works whether or not TCGdex carries the field, and it needs no
 *      verification to be safe.
 *
 *   2. Our own card_price_history, written every time this app prices a
 *      card. Covers TCGplayer, which publishes no history at all, and
 *      covers Cardmarket too if the averages turn out not to be there.
 *      Starts empty and fills at the speed of everybody's lookups.
 *
 * THE TIMEFRAMES, AND WHY
 *
 *   Cards       7 days. A one-day move in a single is usually one seller
 *               relisting. A week is where a real move shows up -- a
 *               tournament result, a reprint announcement, a rotation.
 *               Thirty days is too slow to matter at a table.
 *   Portfolio  30 days. A collection's daily wobble is noise; the month
 *               is the arc worth talking about.
 *
 * THE 3% FLOOR
 *
 * Under three per cent, an arrow would be pointing at rounding. Market
 * prices jitter by a cent or two on nothing. Below the floor there is no
 * arrow -- which is different from a flat one, and deliberately so.
 */
(function () {
  'use strict';

  const CARD_DAYS = 7;
  const PORTFOLIO_DAYS = 30;
  const FLOOR_PCT = 3;

  const sbWrap = () => window.InfinitePullsSupabase || {};
  const sb = () => (sbWrap().ready ? sbWrap().client : null);

  const todayUtc = () => new Date().toISOString().slice(0, 10);
  const daysAgoUtc = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

  /* ---- Deciding, and drawing ---------------------------------------- */

  /* now vs then -> { dir, pct } or null. Null is the answer whenever an
     arrow would be a guess: no past figure, a zero to divide by, or a move
     too small to mean anything. */
  function change(now, then) {
    if (typeof now !== 'number' || typeof then !== 'number') return null;
    if (!isFinite(now) || !isFinite(then) || then <= 0) return null;
    const pct = ((now - then) / then) * 100;
    if (Math.abs(pct) < FLOOR_PCT) return null;
    return { dir: pct > 0 ? 'up' : 'down', pct: Math.abs(pct) };
  }

  function arrowHtml(ch, opts) {
    if (!ch) return '';
    const showPct = !opts || opts.pct !== false;
    const days = (opts && opts.days) || CARD_DAYS;
    const rounded = ch.pct >= 100 ? Math.round(ch.pct) : Math.round(ch.pct * 10) / 10;
    return `<span class="trend is-${ch.dir}" title="${ch.dir === 'up' ? 'Up' : 'Down'} ${rounded}% in ${days} days">`
      + `<span class="trend-arrow" aria-hidden="true">${ch.dir === 'up' ? '▲' : '▼'}</span>`
      + (showPct ? `<span class="trend-pct">${rounded}%</span>` : '')
      + `</span>`;
  }

  /* ---- 1. Cardmarket's own averages, if they are there ---------------- */

  /* TCGdex may or may not pass these through -- read defensively so this
     is correct either way and never invents a comparison. */
  function fromCardmarket(card) {
    const cm = card && card.pricing && card.pricing.cardmarket;
    if (!cm) return null;
    const now = [cm.trend, cm['trend-holo'], cm.avg1, cm.avg].find((v) => typeof v === 'number');
    const then = [cm.avg7, cm.avg30].find((v) => typeof v === 'number');
    if (typeof now !== 'number' || typeof then !== 'number') return null;
    return change(now, then);
  }

  /* ---- 2. Our own history -------------------------------------------- */

  /* Written every time the app prices a card. One row per card, per
     variant, per day -- the primary key sees to that, and the upsert just
     overwrites the day's figure with the latest reading. Fire and forget:
     a price on screen must never wait on bookkeeping. */
  function record(cardId, variant, price, source) {
    const client = sb();
    if (!client || !cardId || typeof price !== 'number' || !isFinite(price) || price <= 0) return;
    client.from('card_price_history')
      .upsert({
        card_id: cardId,
        variant: variant || 'market',
        recorded_on: todayUtc(),
        price,
        currency: 'USD',
        source: source || 'tcgplayer'
      }, { onConflict: 'card_id,variant,recorded_on' })
      .then(() => {}, () => {});
  }

  /* The newest reading at least CARD_DAYS old. Not the oldest we have --
     comparing today against a price from six months ago and calling it a
     seven-day move would be a lie with a true-looking arrow on it. */
  async function pastPrice(cardId, variant, days) {
    const client = sb();
    if (!client || !cardId) return null;
    try {
      const { data, error } = await client
        .from('card_price_history')
        .select('price, recorded_on')
        .eq('card_id', cardId)
        .eq('variant', variant || 'market')
        .lte('recorded_on', daysAgoUtc(days || CARD_DAYS))
        .order('recorded_on', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      const v = Number(data.price);
      return isFinite(v) ? v : null;
    } catch (_) {
      return null;
    }
  }

  /* ---- The one call the rest of the app makes ------------------------ */

  /* Cardmarket first because it needs no round trip and no history of our
     own; ours second. Returns null far more often than not at first, and
     that is correct — the arrows appear as the history earns them. */
  async function forCard(card, variant, amount) {
    const cm = fromCardmarket(card);
    if (cm) return cm;
    if (!card || !card.id) return null;
    const then = await pastPrice(card.id, variant, CARD_DAYS);
    return change(amount, then);
  }

  /* ---- Portfolio ------------------------------------------------------ */

  /* One row per day, written when My Collection prices everything. This is
     the same table the nightly Edge Function was meant to fill and never
     did — writing it from the browser needs no deploy and no cron, and a
     day somebody never opened the app is a day that genuinely has no
     figure rather than a made-up one. */
  async function recordPortfolio(userId, total) {
    const client = sb();
    if (!client || !userId || typeof total !== 'number' || !isFinite(total)) return;
    try {
      await client.from('collection_value_snapshots')
        .upsert({ user_id: userId, snapshot_date: todayUtc(), total_value: total },
                { onConflict: 'user_id,snapshot_date' });
    } catch (_) { /* the value itself is already saved elsewhere */ }
  }

  async function forPortfolio(userId, total) {
    const client = sb();
    if (!client || !userId) return null;
    try {
      const { data, error } = await client
        .from('collection_value_snapshots')
        .select('total_value, snapshot_date')
        .eq('user_id', userId)
        .lte('snapshot_date', daysAgoUtc(PORTFOLIO_DAYS))
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      return change(total, Number(data.total_value));
    } catch (_) {
      return null;
    }
  }

  window.InfinitePullsTrend = {
    CARD_DAYS, PORTFOLIO_DAYS, FLOOR_PCT,
    change, arrowHtml, forCard, record, recordPortfolio, forPortfolio
  };
})();
