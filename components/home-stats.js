/* THE SCOREBOARD — the first thing anybody sees on the home page.
 *
 * Three numbers and, when nobody is signed in, one button.
 *
 * WHY THIS EXISTS
 *
 * The home page used to open with a logo, the store name, the announcement
 * and a sentence that described the app to itself ("Cards, collectibles,
 * events, deals, and more — all in one mobile-ready app"), then nine
 * identical boxes. A first-time visitor had no wrong answer on that grid
 * and no right one either.
 *
 * This is the answer instead. Signed out it is 0 / 1025, 0, and a dash —
 * three empty numbers somebody wants to fill in, which is the whole pitch
 * for what collecting IS, made without a paragraph explaining it. Signed
 * in it is their own three numbers, so the home page is worth landing on
 * more than once.
 *
 * WHY THESE THREE
 *
 * They are the three the collector apps people already use put at the top,
 * so a Pokémon collector recognises the block on sight and does not have
 * to be taught it. Nothing about the shop is in here on purpose: the app
 * earns its place as a collector's tool first, and Jeff's shop is what it
 * plugs into, not what it opens with.
 *
 * WHERE THE NUMBERS COME FROM
 *
 *   Pokémon   pokemon-data.js — the same loadAllSpecies() +
 *             computeDiscoveredMap() pair My Pokédex uses, so the number
 *             here and the number there can never disagree. Both are
 *             promise-cached for the page load, so opening My Pokédex
 *             after this has run is instant rather than double work.
 *   Cards     the quantity column on user_cards, summed. Not a row count:
 *             four of the same card is four cards.
 *   Value     the newest of three saved figures: what My Collection worked
 *             out last time it priced everything (kept both in this
 *             browser and on the visitor's own profile row by
 *             collection.js), and the newest collection_value_snapshots
 *             row from the once-a-day Supabase job.
 *
 *             The profile copy is what makes this right on a phone after
 *             the collection was built on a desktop, and what survives
 *             somebody clearing their site data.
 *
 *             It reads a saved figure rather than pricing a collection
 *             live, because pricing means one TCGdex lookup per unique
 *             card -- right on the page somebody opened to see prices,
 *             wrong on a home screen. It started as the snapshot alone,
 *             and that showed a dash to anybody whose collection was
 *             newer than the last nightly run, and a permanent dash on any
 *             project where that cron job was never scheduled.
 *
 * SIGNED OUT COSTS NOTHING. No auth call, no query, no PokéAPI — the zeros
 * are already true for somebody with no account, so they are drawn
 * immediately and nothing is fetched.
 */
(function () {
  'use strict';

  const sbWrap = () => window.InfinitePullsSupabase || {};
  const sb = () => (sbWrap().ready ? sbWrap().client : null);
  const pd = () => window.InfinitePullsPokemonData;
  const el = () => document.getElementById('home-stats');

  /* The dex total before PokéAPI has answered. loadAllSpecies() corrects
     it on the way past, so the block never sits at a placeholder — but it
     also never renders "0 of 0" for the second before the network lands. */
  const DEX_FALLBACK = 1025;

  let lastSignature = '';

  function money(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return n.toLocaleString(undefined, {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: n >= 1000 ? 0 : 2,
      maximumFractionDigits: n >= 1000 ? 0 : 2
    });
  }

  function num(n) {
    return (Number(n) || 0).toLocaleString();
  }

  /* One row of three, and the button underneath only when signed out.

     Every cell is three fixed rows -- number, sub-line, label -- even
     though only Pokemon has a sub-line ("of 1,025"). The empty spans in
     the other two are what keeps all three labels sitting on one baseline.
     The total used to ride inline as "247/1,025" and a three-digit count
     pushed it out of a phone-width column, where it truncated to "1,...".
     `pending` dims the numbers while the real ones are on their way, so a
     signed-in visitor sees their own figures arrive rather than watching
     zeros flip — zeros that would read, for a second, like a collection
     that had been wiped. */
  function html(stats, signedIn, pending) {
    return `
      <div class="home-stats-row${pending ? ' is-pending' : ''}">
        <div class="hs-stat">
          <span class="hs-value">${num(stats.discovered)}</span>
          <span class="hs-sub">of ${num(stats.dexTotal)}</span>
          <span class="hs-label">Pokémon</span>
        </div>
        <div class="hs-stat">
          <span class="hs-value">${num(stats.cards)}</span>
          <span class="hs-sub"></span>
          <span class="hs-label">Cards</span>
        </div>
        <div class="hs-stat">
          <span class="hs-value">${stats.value === null ? '—' : money(stats.value)}</span>
          <span class="hs-sub"></span>
          <span class="hs-label">Value</span>
        </div>
      </div>
      <a class="primary-btn home-stats-cta" href="?page=collection" data-route="collection" data-look-up>
        <span class="hs-cta-icon" aria-hidden="true">🔍</span> Look up a card
      </a>
      ${signedIn ? '' : `
        <p class="home-stats-note">Search any card by name, number or camera — see what it's worth, and keep track of the ones you own.</p>`}
    `;
  }

  /* WHY ONE BUTTON AND NOT TWO
     Looking up a card is the thing a collector standing in a shop actually
     wants in the next ten seconds, so it gets the button in both states.
     Signed out it lands on My Collection's own sign-in card, which asks
     for a free account in the words of the thing they just tried to do --
     an account prompt with a reason attached, rather than an abstract
     "start collecting" next to a lookup button splitting the decision. */
  function wire() {
    const root = el();
    if (!root) return;
    const btn = root.querySelector('[data-look-up]');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      const col = window.InfinitePullsCollection;
      /* lookUp() navigates AND puts the cursor in the search box. Without
         it the href still works -- and a middle-click or "open in new tab"
         goes on working either way, which is why this is a real link. */
      if (col && col.lookUp) { e.preventDefault(); col.lookUp(); }
    });
  }

  function paint(stats, signedIn, pending) {
    const root = el();
    if (!root) return;
    /* Repainting identical markup under somebody's thumb is how a page
       loses a tap. Only touch the DOM when something actually changed. */
    const sig = JSON.stringify([stats, signedIn, pending]);
    if (sig === lastSignature) return;
    lastSignature = sig;
    root.innerHTML = html(stats, signedIn, pending);
    root.hidden = false;
    wire();
  }

  const EMPTY = { discovered: 0, cards: 0, value: null, dexTotal: DEX_FALLBACK };

  async function snapshotValue(userId) {
    try {
      const { data, error } = await sb()
        .from('collection_value_snapshots')
        .select('total_value, snapshot_date')
        .eq('user_id', userId)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      const v = Number(data.total_value);
      if (!isFinite(v)) return null;
      return { total: v, at: Date.parse(data.snapshot_date) || 0 };
    } catch (_) {
      /* A collection that loaded fine deserves its two other numbers even
         if the money one could not be read. A dash is not a failure here. */
      return null;
    }
  }

  /* Whichever of the three is most recent wins.
       local    this browser, written the last time My Collection priced.
       profile  the same number on the visitor's account row, so a new
                phone or a cleared browser still has it.
       snapshot the nightly Supabase job, where it is running.
     A dash now means one thing only: this collection has never been
     priced, anywhere, by anybody. */
  async function latestValue(userId) {
    const col = window.InfinitePullsCollection;
    const local = col && col.cachedCollectionValue ? col.cachedCollectionValue(userId) : null;

    /* The local copy is asked for first and synchronously, so a browser
       that has one paints without waiting on the network at all. The other
       two are only worth a round trip when it does not. */
    const [profile, snap] = local
      ? [null, null]
      : await Promise.all([
          col && col.profileCollectionValue ? col.profileCollectionValue(userId) : null,
          snapshotValue(userId)
        ]);

    const best = [local, profile, snap]
      .filter((v) => v && typeof v.total === 'number')
      .sort((a, b) => (b.at || 0) - (a.at || 0))[0];

    return best ? best.total : null;
  }

  async function load() {
    const client = sb();
    if (!client) { paint(EMPTY, false, false); return; }

    /* getSession(), not getUser(). getUser() asks the server to validate
       the token, which is a network round trip -- and for those few hundred
       milliseconds this card sat there showing zeros and a sign-up button to
       somebody who IS signed in. getSession() reads the session already in
       the browser and answers immediately, which matters most right after
       signing in, when the home page is where we now land people. */
    let user = null;
    try {
      const { data } = await client.auth.getSession();
      user = data && data.session && data.session.user;
    } catch (_) { /* signed out */ }

    if (!user) { paint(EMPTY, false, false); return; }

    // Their own numbers are coming — hold the shape, dim it, fill it in.
    paint(EMPTY, true, true);

    const data = pd();
    if (!data) { paint(EMPTY, true, false); return; }

    try {
      const [species, rows, value] = await Promise.all([
        data.loadAllSpecies(),
        data.fetchOwnedCollectionRows(user.id),
        latestValue(user.id)
      ]);

      const map = data.computeDiscoveredMap(species, rows);
      const discovered = species.filter((s) => map[s.id] && map[s.id].discovered).length;
      const cards = (rows || []).reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);

      paint({
        discovered,
        cards,
        value,
        dexTotal: species.length || data.NATIONAL_DEX_MAX || DEX_FALLBACK
      }, true, false);
    } catch (_) {
      /* PokéAPI down, or the collection would not read. Undimmed zeros
         would be a lie, so leave the block in its pending state rather
         than reporting a collection nobody has lost. */
      paint(EMPTY, true, true);
    }
  }

  function init() {
    if (!el()) return;
    lastSignature = '';
    // Zeros first, synchronously, so the block never lands as empty space
    // that pushes the page down a moment later.
    paint(EMPTY, false, false);
    load();

    const client = sb();
    if (client && !init.bound) {
      init.bound = true;
      client.auth.onAuthStateChange(() => { lastSignature = ''; load(); });
    }
  }

  window.InfinitePullsHomeStats = { init, refresh: load };
})();
