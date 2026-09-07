/* MOVERS & SHAKERS — the public board (?page=movers)
 * ==================================================
 *
 * The only page in this app a stranger can read in full. Everything else
 * either belongs to somebody (a collection, a Pokédex) or asks for an
 * account first (Card Lookup). This one is the front door: real prices,
 * real movement, no sign-in, nothing held back.
 *
 * WHY IT IS PUBLIC
 *
 * Two reasons, and they are the same reason. Somebody searching "pokemon
 * cards going up in price" has to be able to land on it and read it, or it
 * will never be found -- that is the same long-game the per-photo gallery
 * URLs are playing. And a stranger who reads twenty-five real numbers has
 * already been shown what the app is for, which is a better argument for
 * an account than any sentence describing one.
 *
 * WHERE TAPPING A CARD GOES
 *
 * Card Lookup, which IS gated. That is deliberate and it is not a dead
 * end: the signed-out lookup page is an invitation with the whole nav bar
 * still under it, so the way on is a free account and the way back is one
 * tap. The board gives the value away; the tool asks for a name.
 *
 * WHAT IT REFUSES TO DO
 *
 * Invent a board. Until there is a genuine week of history the honest
 * answer is that there is not enough yet, said in those words, with the
 * date it changes. An empty leaderboard that looks broken costs more trust
 * than a sentence explaining itself -- and this is the page a stranger
 * meets first, so it is the worst possible place to look broken.
 *
 * The floor, the ranking and the one-row-per-card rule all live in
 * supabase/top_movers.sql. Read the header there before changing what
 * appears here -- the reasoning is about penny cards and it is not
 * obvious from the outside.
 */
(function () {
  'use strict';

  const HOW_MANY = 25;
  const WINDOW_DAYS = 7;

  const sbWrap = () => window.InfinitePullsSupabase || {};
  const sb = () => (sbWrap().ready ? sbWrap().client : null);

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const money = (n) => '$' + Number(n).toFixed(2);

  /* The API's variant key is not a label. "reverse-holofoil" is how
     TCGplayer names a printing to a machine; "Reverse Holofoil" is how a
     collector says it out loud. */
  function printing(variant) {
    if (!variant || variant === 'normal') return '';
    return String(variant).split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  /* ---- One row ------------------------------------------------------- */

  function rowHtml(r, rank) {
    const dir = Number(r.pct) >= 0 ? 'up' : 'down';
    const pct = Math.abs(Number(r.pct));
    const shown = pct >= 100 ? Math.round(pct) : Math.round(pct * 10) / 10;
    const print = printing(r.variant);
    const where = [r.set_name, r.number].filter(Boolean).join(' · ');

    /* A link, not a button. It is a real destination with a real URL, so
       it can be opened in a new tab, shared, and followed by a crawler --
       all three of which are the point of this page existing. */
    return `
      <a class="mv-row" href="?page=lookup&q=${encodeURIComponent(r.number || r.name)}"
         data-route="lookup" data-mv-card="${esc(r.card_id)}">
        <span class="mv-rank">${rank}</span>
        <span class="mv-body">
          <strong class="mv-name">${esc(r.name)}</strong>
          <small class="mv-where">${esc(where)}${print ? ' · ' + esc(print) : ''}</small>
        </span>
        <span class="mv-prices">
          <span class="mv-move is-${dir}">
            <span aria-hidden="true">${dir === 'up' ? '▲' : '▼'}</span>${shown}%
          </span>
          <small class="mv-then-now">${money(r.then_price)} → ${money(r.now_price)}</small>
        </span>
      </a>`;
  }

  /* ---- One board ----------------------------------------------------- */

  function boardHtml(dir, rows) {
    const rising = dir === 'up';
    const title = rising ? 'Rising this week' : 'Falling this week';

    if (!rows.length) {
      return `
        <section class="mv-board is-${dir}">
          <h2 class="mv-board-title">
            <span class="mv-board-arrow is-${dir}" aria-hidden="true">${rising ? '▲' : '▼'}</span>
            ${title}
          </h2>
          <p class="mv-none">Nothing ${rising ? 'rose' : 'fell'} by more than 3% this week.</p>
        </section>`;
    }

    return `
      <section class="mv-board is-${dir}">
        <h2 class="mv-board-title">
          <span class="mv-board-arrow is-${dir}" aria-hidden="true">${rising ? '▲' : '▼'}</span>
          ${title}
          <span class="mv-count">${rows.length}</span>
        </h2>
        <ol class="mv-list">
          ${rows.map((r, i) => rowHtml(r, i + 1)).join('')}
        </ol>
      </section>`;
  }

  /* ---- The states that are not a board ------------------------------- */

  /* NOT ENOUGH HISTORY IS NOT AN ERROR, and must never be dressed as one.
     The board fills from readings the weekly price run leaves behind, so
     before there are two of those a week apart there is genuinely nothing
     to rank. Saying so plainly -- and saying when it changes -- is the
     difference between a page that is waiting and a page that is broken. */
  function waitingHtml() {
    return `
      <div class="mv-waiting">
        <p class="mv-waiting-lead">The board is still filling up.</p>
        <p>Movement is measured over seven days, against prices this app
           records for all 36,771 cards once a week. Until there are two
           of those readings a week apart there is nothing honest to rank,
           so rather than show you a made-up list, here is the truth.</p>
        <p class="mv-waiting-foot">Come back after the next weekly price run.</p>
      </div>`;
  }

  function errorHtml() {
    return `
      <div class="mv-waiting">
        <p class="mv-waiting-lead">The board could not load.</p>
        <p>That is on us, not on you — the prices are fine, the page just
           could not reach them. Trying again in a moment usually does it.</p>
        <button type="button" class="primary-btn" data-mv-retry>Try again</button>
      </div>`;
  }

  /* ---- The page ------------------------------------------------------ */

  function shellHtml(inner) {
    return `
      <section id="movers-page" class="mv-page">
        <header class="mv-head">
          <p class="mv-eyebrow">Pokémon card prices</p>
          <h1>Movers &amp; Shakers</h1>
          <p class="mv-sub">The biggest price moves of the last seven days,
             from TCGplayer market prices. Cards worth under $5 to start
             with are left off, so nothing here is a rounding error on a
             bulk common.</p>
        </header>

        ${inner}

        <!-- THE WAY ON. A stranger who has just read twenty-five real
             numbers is the most persuadable visitor this site gets, and
             this is the only thing on the page asking anything of them. -->
        <aside class="mv-cta">
          <strong>Look up any card, free</strong>
          <p>Search by name or the number on the card, see what it is worth,
             and keep track of the ones you own.</p>
          <a class="primary-btn" href="?page=lookup" data-route="lookup">Look up a card</a>
        </aside>

        <p class="mv-foot" id="mv-foot"></p>
      </section>`;
  }

  function footNote(rows) {
    const any = rows.find((r) => r.then_on && r.now_on);
    if (!any) return '';
    return `Comparing ${any.then_on} with ${any.now_on}. `
      + `Market prices from TCGplayer, in US dollars. English cards only — `
      + `Japanese cards are priced in euros on a different marketplace and `
      + `cannot be ranked against these without the exchange rate becoming `
      + `part of the answer.`;
  }

  async function init() {
    const root = document.getElementById('movers-page');
    if (!root) return;

    const client = sb();
    if (!client) { paint(errorHtml(), []); return; }

    let up = [], down = [];
    try {
      /* Both boards at once. They are two questions about one table and
         waiting for the first before asking the second would double the
         time somebody stares at a spinner. */
      const [a, b] = await Promise.all([
        client.rpc('top_movers', { p_direction: 'up',   p_limit: HOW_MANY, p_days: WINDOW_DAYS }),
        client.rpc('top_movers', { p_direction: 'down', p_limit: HOW_MANY, p_days: WINDOW_DAYS })
      ]);
      if (a.error || b.error) throw (a.error || b.error);
      up = a.data || [];
      down = b.data || [];
    } catch (_) {
      paint(errorHtml(), []);
      return;
    }

    if (!up.length && !down.length) { paint(waitingHtml(), []); return; }
    paint(boardHtml('up', up) + boardHtml('down', down), up.concat(down));
  }

  function paint(inner, rows) {
    const content = document.getElementById('page-content');
    if (!content) return;
    content.innerHTML = shellHtml(inner);
    const foot = document.getElementById('mv-foot');
    if (foot) foot.textContent = footNote(rows || []);
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-mv-retry]')) {
      const content = document.getElementById('page-content');
      if (content) content.innerHTML = shellHtml('<div class="empty-state">Loading…</div>');
      init();
    }
  });

  window.InfinitePullsMovers = { init, shellHtml };
})();
