/* PRICE TREND — the green and red arrows, and the only place that decides
 * whether one is honest to draw.
 *
 * WHAT AN ARROW CLAIMS
 *
 * That this card is worth measurably more, or less, or the same as it was
 * a week ago. That is a claim somebody negotiates against, so this file
 * refuses to make it without evidence: NO HISTORY, NOTHING DRAWN.
 *
 * Note the shape of that rule, because it changed. There are now three
 * visible answers — rising, falling, steady — and steady is only ever
 * shown when we genuinely hold a week-old figure to compare against. A
 * card we have never priced still draws nothing at all, because "steady"
 * and "we do not know" are different claims and only one of them is safe
 * to make to somebody holding cash.
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
 * prices jitter by a cent or two on nothing. Below the floor the card
 * reads STEADY -- which is a finding, not a failure, and is still not the
 * same as the nothing drawn for a card with no history.
 *
 * ONE ROUND TRIP, NOT ONE PER CARD
 *
 * forCard() answers for a single card against the live figure on screen,
 * which is the most accurate reading and right for the card somebody has
 * opened. Everywhere else -- a page of search results, a collection rail,
 * thirty pieces of artwork -- goes through trendsFor(), which asks the
 * card_trends() function for every card on screen at once and compares
 * stored against stored. Thirty arrows, one request.
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
  /* THREE ANSWERS AND A SILENCE.
   *
   * This used to have two: a move, or null. Null did double duty -- it
   * meant "under the floor" AND "we have never seen this card before",
   * and the screen could not tell them apart because both drew nothing.
   *
   * Those are different facts. "We priced this a week ago and it has
   * barely moved" is real, useful information a collector wants at a
   * table. "We have no idea" is not.
   *
   *   { dir: 'up' }    it rose,  by at least FLOOR_PCT
   *   { dir: 'down' }  it fell,  by at least FLOOR_PCT
   *   { dir: 'flat' }  we HAVE both figures and it did not really move
   *   null             we cannot compare -- draw nothing at all
   *
   * The null case is still sacred. Nothing renders for it, because a
   * steady dot on a card we have never priced is the same false claim the
   * original two-state version was written to avoid. */
  function change(now, then) {
    if (typeof now !== 'number' || typeof then !== 'number') return null;
    if (!isFinite(now) || !isFinite(then) || then <= 0) return null;
    const pct = ((now - then) / then) * 100;
    if (Math.abs(pct) < FLOOR_PCT) return { dir: 'flat', pct: Math.abs(pct) };
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

    /* Steady says the word rather than a percentage. "0.4%" invites
       somebody to read a trend into rounding; "Steady" is the actual
       finding and cannot be over-read. */
    if (ch.dir === 'flat') {
      return `<span class="trend is-flat" title="Steady — moved less than ${FLOOR_PCT}% in ${days} days">`
        + `<span class="trend-arrow" aria-hidden="true">●</span>`
        + (showPct ? `<span class="trend-pct">Steady</span>` : '')
        + `</span>`;
    }

    const rounded = ch.pct >= 100 ? Math.round(ch.pct) : Math.round(ch.pct * 10) / 10;
    return `<span class="trend is-${ch.dir}" title="${ch.dir === 'up' ? 'Up' : 'Down'} ${rounded}% in ${days} days">`
      + `<span class="trend-arrow" aria-hidden="true">${ch.dir === 'up' ? '▲' : '▼'}</span>`
      + (showPct ? `<span class="trend-pct">${rounded}%</span>` : '')
      + `</span>`;
  }

  /* THE DOT. For places with artwork and no room for words -- the home
     rail, the collection strip. Same three colours as the arrow, so the
     language is learned once and read everywhere. */
  function dotHtml(ch) {
    if (!ch) return '';
    const word = ch.dir === 'up' ? 'Rising' : ch.dir === 'down' ? 'Falling' : 'Steady';
    return `<span class="trend-dot is-${ch.dir}" title="${word}" aria-label="${word}"></span>`;
  }

  /* The class that colours the PRICE ITSELF. The figure is what the eye
     lands on, so the figure is what carries the news; the arrow beside it
     says by how much. Returns '' for null, which leaves the price its
     ordinary gold and makes no claim. */
  function priceClass(ch) {
    return ch ? ' is-' + ch.dir : '';
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

  /* ---- Many cards at once --------------------------------------------
   *
   * A list does not have a live price for every row and must not go and
   * fetch thirty of them, so out here the comparison is STORED against
   * STORED: the newest figure we hold versus the newest one at least a
   * week old. The weekly catalogue sync means "newest" is rarely more
   * than a few days stale, and a slightly older reading in a list is a
   * fair trade for a list that draws immediately.
   *
   * The open card keeps forCard(), which uses the live figure on screen.
   * That is the number somebody is about to negotiate against, so that
   * one is worth a round trip. */
  async function trendsFor(cardIds, days) {
    const out = new Map();
    const client = sb();
    const ids = [...new Set((cardIds || []).filter(Boolean))];
    if (!client || !ids.length) return out;
    try {
      const { data, error } = await client.rpc('card_trends', {
        p_card_ids: ids,
        p_days: days || CARD_DAYS
      });
      if (error || !data) return out;
      data.forEach((r) => {
        const list = out.get(r.card_id);
        if (list) list.push(r); else out.set(r.card_id, [r]);
      });
    } catch (_) {
      /* No batch is the same outcome as no history: an empty map, and
         every caller draws nothing. A list must never fail to render
         because its decoration could not load. */
    }
    return out;
  }

  /* One card's answer out of a batch, WITHOUT naming a printing.
   *
   * A row in a list shows one price and one card; it is not the place to
   * argue about Reverse Holofoil versus Normal. So the question it asks
   * is the plain one a collector would ask -- "is this card moving?" --
   * and the loudest printing answers it. A real mover is never hidden
   * behind a flat sibling, which is why a directional reading always
   * beats a steady one no matter the size.
   *
   * TCGplayer wins when it is present, because that is the marketplace
   * the figure beside the arrow came from. */
  function fromBatchAny(batch, cardId) {
    const rows = (batch && batch.get) ? batch.get(cardId) : null;
    if (!rows || !rows.length) return null;

    const tp = rows.filter((r) => r.source === 'tcgplayer');
    const pool = tp.length ? tp : rows;

    let best = null;
    pool.forEach((r) => {
      const ch = change(Number(r.now_price), Number(r.then_price));
      if (!ch) return;
      if (!best) { best = ch; return; }
      const bestIsFlat = best.dir === 'flat';
      const thisIsFlat = ch.dir === 'flat';
      if (bestIsFlat && !thisIsFlat) { best = ch; return; }
      if (!bestIsFlat && thisIsFlat) return;
      if (ch.pct > best.pct) best = ch;
    });
    if (best) best.days = CARD_DAYS;
    return best;
  }

  /* The exact series, when the caller does know the printing and the
     marketplace -- the price rail on the open card. `amount` is the live
     figure if there is one; without it this falls back to the newest
     stored reading, which is still same-source and still honest. */
  function fromBatchExact(batch, cardId, variant, source, amount) {
    const rows = (batch && batch.get) ? batch.get(cardId) : null;
    if (!rows || !rows.length) return null;
    const want = source || 'tcgplayer';
    const row = rows.find((r) => r.source === want && r.variant === variant);
    if (!row) return null;
    const now = typeof amount === 'number' ? amount : Number(row.now_price);
    const ch = change(now, Number(row.then_price));
    if (ch) ch.days = CARD_DAYS;
    return ch;
  }

  window.InfinitePullsTrend = {
    CARD_DAYS, PORTFOLIO_DAYS, FLOOR_PCT,
    change, arrowHtml, dotHtml, priceClass,
    forCard, record, recordPortfolio, forPortfolio,
    trendsFor, fromBatchAny, fromBatchExact
  };
})();
