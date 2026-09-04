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
 * WHERE THE EVIDENCE COMES FROM
 *
 * One place only: card_price_history, which this app writes itself every
 * time it prices a card -- a Card Lookup, a My Collection load. Every
 * column in it was defined here, so we know exactly what every number
 * means.
 *
 * It deliberately does NOT use Cardmarket's published averages, though
 * the code to do so is still below behind a switch. See the note on
 * USE_CARDMARKET_AVERAGES for what went wrong when it did.
 *
 * TWO RULES THE COMPARISON NEVER BREAKS
 *
 *   Same marketplace.  A TCGplayer figure is only ever compared against
 *                      other TCGplayer figures. TCGplayer and Cardmarket
 *                      are different markets with different supply and
 *                      different buyers; the gap between them is not a
 *                      price movement.
 *   Same currency.     Cardmarket is stored in euros, TCGplayer in
 *                      dollars, each compared against itself. Convert
 *                      first and the exchange rate becomes part of the
 *                      card's history -- a flat card would sprout an
 *                      arrow because the euro moved. The arrow is a
 *                      percentage, so the unit never reaches the screen.
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

  /* CARDMARKET'S OWN AVERAGES ARE SWITCHED OFF. READ THIS BEFORE TURNING
   * THEM BACK ON.
   *
   * The idea was good: Cardmarket publishes 7- and 30-day averages, so an
   * arrow could appear on the very first lookup instead of waiting a week
   * for our own history. The problem is that nobody here has ever SEEN
   * TCGdex's cardmarket object. The field names below (avg7, avg30, avg1,
   * trend, avg) are an educated guess at somebody else's schema.
   *
   * The first live test said the guess is wrong. Base Set Charizard came
   * back as DOWN 46.2% -- on a card that has not fallen 46% in a week, in
   * a month, or in a year. Whatever `avg7`/`avg30` hold on that object, it
   * is not what this code assumed, and the arrow it produced was
   * confidently, dramatically false.
   *
   * That is the worst possible failure for this feature. Somebody is
   * reading these arrows mid-negotiation. A missing arrow costs nothing; a
   * red 46% on a card that is flat could cost hundreds of dollars in one
   * handshake.
   *
   * So the app now runs on ONE source: the history it records itself,
   * every lookup and every collection load, in a table whose every column
   * we defined. It is slower to start -- a week of nothing -- and it is
   * correct from the first arrow it draws.
   *
   * To reconsider: look at a real card's pricing.cardmarket object (the
   * console line in the notes below prints one), work out what those
   * fields genuinely mean, and only then flip this. */
  const USE_CARDMARKET_AVERAGES = false;

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

  /* The window in the tooltip is the window the FIGURES came from, never
     the one we asked for. Cardmarket sometimes carries a 30-day average
     and no 7-day one; saying "in 7 days" over a 30-day comparison would
     be a true percentage with a false claim attached to it. */
  function arrowHtml(ch, opts) {
    if (!ch) return '';
    const showPct = !opts || opts.pct !== false;
    const days = ch.days || (opts && opts.days) || CARD_DAYS;
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
    if (typeof now !== 'number') return null;

    /* Whichever average is actually there, and the arrow carries its
       window with it. avg7 is preferred because a week is the timeframe
       that matters at a table; avg30 is accepted rather than throwing the
       comparison away, but it goes out labelled as thirty days. */
    let then = null, days = CARD_DAYS;
    if (typeof cm.avg7 === 'number') { then = cm.avg7; days = 7; }
    else if (typeof cm.avg30 === 'number') { then = cm.avg30; days = 30; }
    if (then === null) return null;

    const ch = change(now, then);
    if (ch) ch.days = days;
    return ch;
  }

  /* ---- 2. Our own history -------------------------------------------- */

  /* Written every time the app prices a card. One row per card, per
     variant, per day -- the primary key sees to that, and the upsert just
     overwrites the day's figure with the latest reading. Fire and forget:
     a price on screen must never wait on bookkeeping. */
  function record(cardId, variant, price, source, currency) {
    const client = sb();
    if (!client || !cardId || typeof price !== 'number' || !isFinite(price) || price <= 0) return;
    client.from('card_price_history')
      .upsert({
        card_id: cardId,
        variant: variant || 'market',
        recorded_on: todayUtc(),
        price,
        currency: currency || 'USD',
        source: source || 'tcgplayer'
      }, { onConflict: 'card_id,variant,source,recorded_on' })
      .then(() => {}, () => {});
  }

  /* The newest reading at least CARD_DAYS old, FROM THE SAME MARKETPLACE.
     Not the oldest we have -- comparing today against a price from six
     months ago and calling it a seven-day move would be a lie with a
     true-looking arrow on it.

     The source filter matters just as much. A card that TCGplayer carries
     and Cardmarket also carries gets a row from whichever pass priced it
     that day. Without this filter, a TCGplayer price today would happily
     be compared against a Cardmarket price from last week -- two different
     markets, two different currencies -- and the difference between them
     would be drawn as a week's movement. That is the same mistake that
     put a false 46% on a Charizard, arriving by a different door. */
  async function pastPrice(cardId, variant, days, source) {
    const client = sb();
    if (!client || !cardId) return null;
    try {
      const { data, error } = await client
        .from('card_price_history')
        .select('price, recorded_on')
        .eq('card_id', cardId)
        .eq('variant', variant || 'market')
        .eq('source', source || 'tcgplayer')
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

  /* WHICH MARKET'S MOVEMENT, AND WHOSE
   *
   * `kind` is not optional decoration. Cardmarket's averages describe
   * CARDMARKET -- a European marketplace, in euros, with its own supply
   * and its own buyers. TCGplayer is a different market that moves on its
   * own schedule, and the two regularly disagree by a lot.
   *
   * This function used to reach for the Cardmarket averages first no
   * matter which capsule was asking, which put Cardmarket's percentage on
   * the TCGplayer capsule. Both capsules then showed the identical figure
   * -- and the one on the left was describing a market it had never
   * looked at. A dealer reads that number and prices against it.
   *
   * So: a Cardmarket capsule may use Cardmarket's averages. Every other
   * capsule waits for our own history of that same source, and shows
   * nothing until there is a week of it. */
  async function forCard(card, variant, amount, kind) {
    if (USE_CARDMARKET_AVERAGES && kind === 'cardmarket') {
      const cm = fromCardmarket(card);
      if (cm) return cm;
    }
    if (!card || !card.id) return null;
    /* Compare like with like: a TCGplayer figure only ever against other
       TCGplayer figures, a Cardmarket one only against Cardmarket. */
    const source = kind === 'cardmarket' ? 'cardmarket' : 'tcgplayer';
    const then = await pastPrice(card.id, variant, CARD_DAYS, source);
    const ch = change(amount, then);
    if (ch) ch.days = CARD_DAYS;
    return ch;
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
