/* Infinite Dex — the page a customer sees.
 *
 * Two things happen here and nothing else:
 *
 *   1. A grid of every card in the set. The ones they have, in full
 *      colour. The ones they do not, dark, with the task showing -- a
 *      locked card that will not tell you how to unlock it is just a hole.
 *   2. A box to type the word off the board in the shop.
 *
 * The box sits at the top, above the grid, because on September 12th
 * somebody will be standing in the shop with the board in front of them
 * and no patience for scrolling.
 *
 * A QR code on that board can point at ?page=dex&code=GRANDOPENING, which
 * fills the box in and claims it on arrival -- see init().
 */
(function () {
  'use strict';

  const D = () => window.InfinitePullsDexData;
  const esc = (v) => D().escapeHtml(v);

  let cards = [];
  let earned = new Map();
  let tiers = [];
  let redeemed = new Map();
  let username = '';
  let userId = null;
  let signedIn = false;
  let openCardId = null;

  const el = () => document.getElementById('dex-page');

  // ---- What is new since they last looked ----
  //
  // A card that arrived while they were somewhere else should announce
  // itself when they open their Dex, not sit quietly in a grid of twelve.
  // So an earned card the visitor has not yet laid eyes on wiggles.
  //
  // "Seen" is per person and lives in this browser only. It is a nicety,
  // not a record -- a cleared cache means one extra wiggle, which is a
  // fine thing to get wrong.

  let seen = null;
  let seenTimer = null;

  /* Two switches in the admin panel, read here rather than everywhere.
     Off is never a deletion -- a customer's cards stay exactly where they
     are and come back untouched when it is switched on again.

     Absent switch file = on, deliberately. A script that failed to load
     must not be able to take a live feature away from a shop. */
  function dexOn() {
    const sw = window.InfinitePullsDexSwitch;
    return !sw || sw.dexOn();
  }
  function rewardsOn() {
    const sw = window.InfinitePullsDexSwitch;
    return !sw || sw.rewardsOn();
  }

  function seenKey() { return 'infinite-dex-seen:' + (userId || 'anon'); }

  function loadSeen() {
    if (seen) return seen;
    seen = new Set();
    try {
      const raw = window.localStorage.getItem(seenKey());
      if (raw) JSON.parse(raw).forEach((id) => seen.add(id));
    } catch (_) { /* private mode, or storage turned off */ }
    return seen;
  }

  function saveSeen() {
    try { window.localStorage.setItem(seenKey(), JSON.stringify([...seen])); }
    catch (_) { /* nothing here is worth breaking a page over */ }
  }

  function isNew(cardId) {
    return earned.has(cardId) && !loadSeen().has(cardId);
  }

  function markSeen(cardId) {
    loadSeen();
    if (seen.has(cardId)) return;
    seen.add(cardId);
    saveSeen();
  }

  /* Everything on screen counts as seen a couple of seconds after it is
     drawn -- long enough to have been noticed. Deliberately does NOT
     redraw, so the wiggle carries on for this visit and is simply gone the
     next time. The same behaviour as an unread badge, and for the same
     reason. */
  function armSeenTimer() {
    if (seenTimer) clearTimeout(seenTimer);
    seenTimer = setTimeout(() => {
      loadSeen();
      let changed = false;
      earned.forEach((_at, id) => { if (!seen.has(id)) { seen.add(id); changed = true; } });
      if (changed) saveSeen();
    }, 2500);
  }

  // ---- Rendering ----

  function tile(c) {
    const has = earned.has(c.id);
    const fresh = has && isNew(c.id);
    const art = c.thumb_url || c.art_url;
    const num = c.series === 'set' ? String(c.number).padStart(3, '0') : '★';
    return `
      <button type="button" class="dex-tile${has ? ' is-earned' : ''}${c.rarity === 'gold' ? ' is-gold' : ''}${fresh ? ' is-new' : ''}"
              data-dex-card="${esc(c.id)}">
        <span class="dex-tile-art">
          ${art ? `<img src="${esc(art)}" alt="" loading="lazy">` : '<span class="dex-tile-noart">?</span>'}
          ${has ? '' : '<span class="dex-tile-lock">🔒</span>'}
          ${fresh ? '<span class="dex-tile-new">NEW</span>' : ''}
        </span>
        <span class="dex-tile-name">${has ? esc(c.name) : '???'}</span>
        <span class="dex-tile-task">${esc(c.task_line)}</span>
        <span class="dex-tile-num">${esc(num)}</span>
      </button>`;
  }

  function detail(c) {
    const has = earned.has(c.id);
    const when = has ? new Date(earned.get(c.id)) : null;
    const art = c.art_url || c.thumb_url;
    const open = D().isOpen(c);
    return `
      <div class="dex-detail">
        <button type="button" class="ghost-btn" data-dex-back>← Back to my Dex</button>
        <div class="dex-detail-art${has ? '' : ' is-locked'}">
          ${art ? `<img src="${esc(art)}" alt="${esc(c.name)}">` : '<div class="dex-tile-noart big">?</div>'}
        </div>
        <div class="dex-detail-body">
          <div class="eyebrow">Infinite Dex${c.rarity === 'gold' ? ' · Gold' : ''}</div>
          <h2>${has ? esc(c.name) : 'Not yet collected'}</h2>
          <p class="dex-detail-task">${esc(c.task_line)}</p>
          ${c.flavor && has ? `<p class="dex-detail-flavor">${esc(c.flavor)}</p>` : ''}
          ${has
            ? `<p class="dex-detail-when">Collected ${when.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>`
            : c.award_type === 'code'
              ? (open
                  ? '<p class="dex-detail-how">Look for the code in the shop, then type it in the box on your Dex.</p>'
                  : '<p class="dex-detail-how">This one has closed. Keep an eye out for the next.</p>')
              : '<p class="dex-detail-how">Do the thing above and this card turns up on its own.</p>'}
          <p class="dex-detail-code">${esc(c.code)} · ${esc(c.season)}</p>
        </div>
      </div>`;
  }

  /* The one line at the top: what is next, or what is waiting to be
     collected. It names the number it is counting, because the fraction
     directly above it counts something else -- the season only. Two
     numbers on one screen that mean different things have to say so. */
  function rewardLine(st) {
    if (!rewardsOn() || !signedIn || !tiers.length) return '';

    if (st.ready.length) {
      const t = st.ready[0];
      const more = st.ready.length - 1;
      return `
        <div class="dex-reward-ready">
          <strong>Ready at the counter</strong>
          <b>${esc(t.reward)}</b>
          ${username
            ? `<span>Show them your username: <em>${esc(username)}</em></span>`
            : '<span>Show them your username at the counter.</span>'}
          ${more ? `<small>and ${more} more waiting</small>` : ''}
        </div>`;
    }

    if (st.next) {
      const left = st.next.cards_required - st.count;
      return `
        <p class="dex-reward-next">
          <b>${left}</b> more card${left === 1 ? '' : 's'} for <b>${esc(st.next.reward)}</b>
          <small>${st.count} of ${st.next.cards_required} cards collected, season and shop together</small>
        </p>`;
    }

    return '<p class="dex-reward-next"><b>Every reward collected.</b><small>Nicely done.</small></p>';
  }

  function rewardsSection(st) {
    if (!rewardsOn() || !tiers.length) return '';
    return `
      <h2 class="dex-section-title">Rewards</h2>
      <div class="dex-rewards">
        ${st.all.map((t) => `
          <div class="dex-reward-row${t.met ? ' is-met' : ''}${t.redeemedAt ? ' is-done' : ''}">
            <span class="dex-tier-n">${t.cards_required}</span>
            <span class="dex-reward-body">
              <strong>${esc(t.reward)}</strong>
              ${t.description ? `<small>${esc(t.description)}</small>` : ''}
              <small class="dex-reward-state">${
                t.redeemedAt
                  ? 'Collected ' + new Date(t.redeemedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
                  : t.met
                    ? 'Ready — show your username at the counter'
                    : (signedIn
                        ? (t.cards_required - st.count) + ' more card' + (t.cards_required - st.count === 1 ? '' : 's') + ' to go'
                        : 'At ' + t.cards_required + ' cards')}</small>
            </span>
          </div>`).join('')}
      </div>`;
  }

  function render() {
    const root = el();
    if (!root) return;

    if (openCardId) {
      const c = cards.find((x) => x.id === openCardId);
      if (c) { root.innerHTML = detail(c); return; }
      openCardId = null;
    }

    const set = cards.filter((c) => c.series === 'set');
    const events = cards.filter((c) => c.series === 'event');
    const p = D().progress(cards, earned);
    const st = D().rewardStatus(tiers, earned.size, redeemed);

    root.innerHTML = `
      <header class="pokedex-page-title">
        <div class="eyebrow">Infinite Pulls</div>
        <h1>Infinite Dex</h1>
      </header>

      <section class="card dex-head">
        <div class="pokedex-progress-row">
          <strong>${p.got} of ${p.total} collected</strong>
          <span>${p.pct}%</span>
        </div>
        <div class="pokedex-progress-bar"><span class="pokedex-progress-fill" style="width:${p.pct}%"></span></div>

        ${rewardLine(st)}

        <form class="dex-claim" id="dex-claim-form" autocomplete="off">
          <label for="dex-claim-input">Got a code from the shop?</label>
          <div class="dex-claim-row">
            <input id="dex-claim-input" name="code" type="text" inputmode="text"
                   autocapitalize="characters" spellcheck="false"
                   placeholder="Type it here" ${signedIn ? '' : 'disabled'}>
            <button class="primary-btn" type="submit" ${signedIn ? '' : 'disabled'}>Claim</button>
          </div>
          <p class="dex-claim-status" id="dex-claim-status" role="status">${
            signedIn ? '' : 'Make a free account to start collecting.'}</p>
        </form>
      </section>

      ${set.length ? `<div class="dex-grid">${set.map(tile).join('')}</div>`
                   : '<div class="empty-state">No cards yet — check back soon.</div>'}

      ${events.length ? `
        <h2 class="dex-section-title">From the shop</h2>
        <div class="dex-grid">${events.map(tile).join('')}</div>` : ''}

      ${rewardsSection(st)}
    `;

    armSeenTimer();
  }

  // ---- Claiming ----

  function status(msg, bad) {
    const s = document.getElementById('dex-claim-status');
    if (!s) return;
    s.textContent = msg;
    s.classList.toggle('is-bad', !!bad);
  }

  const WORDING = {
    already: 'You already have that one.',
    closed: 'That code has closed.',
    invalid: "That code isn't right. Check the board and try again.",
    not_yet: 'Not quite yet — keep going.',
    unknown: "That code isn't right. Check the board and try again."
  };

  async function claim(word) {
    if (!word) return;
    status('Checking…');
    try {
      const before = new Set(D().rewardStatus(tiers, earned.size, redeemed).ready.map((t) => t.id));
      const res = await D().claimCode(word);
      if (res.status === 'awarded') {
        D().toast(res);
        await refresh();
        // A card that tips them over a tier is the bigger moment of the
        // two. Both toasts fire; the reward one is staggered behind the
        // card so they read in the order they happened.
        const now = D().rewardStatus(tiers, earned.size, redeemed).ready;
        const fresh = now.find((t) => !before.has(t.id));
        if (fresh && rewardsOn()) D().rewardToast(fresh);
        status('Got it — ' + res.name + ' is in your Dex.');
        return res;
      }
      status(WORDING[res.status] || WORDING.invalid, res.status !== 'already');
      return res;
    } catch (err) {
      status('Could not check that just now. Try again in a moment.', true);
      return null;
    }
  }

  async function refresh() {
    cards = await D().loadCatalogue(true);
    earned = await D().loadEarned(true);
    redeemed = await D().loadRedemptions(true);
    render();
  }

  // ---- Wiring ----

  document.addEventListener('submit', (e) => {
    if (!e.target || e.target.id !== 'dex-claim-form') return;
    e.preventDefault();
    const input = document.getElementById('dex-claim-input');
    const word = (input && input.value || '').trim();
    if (!word) return status('Type the code from the board first.', true);
    claim(word).then((res) => { if (res && res.status === 'awarded' && input) input.value = ''; });
  });

  document.addEventListener('click', (e) => {
    const back = e.target.closest && e.target.closest('[data-dex-back]');
    if (back) { openCardId = null; render(); window.scrollTo({ top: 0, behavior: 'instant' }); return; }
    const tileEl = e.target.closest && e.target.closest('[data-dex-card]');
    if (tileEl && el() && el().contains(tileEl)) {
      openCardId = tileEl.dataset.dexCard;
      markSeen(openCardId);
      render();
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  });

  // ---- Cards that arrive on their own ----
  //
  // Nine of the twelve are checked by the database in one call
  // (dex_sweep). The other three are only visible to the browser, so the
  // app asserts those one at a time through award_dex_card -- which keeps
  // "the database decided" and "the browser said so" as two different
  // code paths, on purpose.
  //
  // This file is loaded on every page, so a card earned in My Collection
  // announces itself there rather than waiting for somebody to wander over
  // to their Dex.

  async function sweepNow() {
    if (!dexOn()) return [];
    if (!signedIn) {
      const u = await D().currentUser();
      signedIn = !!u;
      if (!signedIn) return [];
    }
    let list = [];
    try { list = await D().sweep(); } catch (_) { return []; }
    if (list.length) await announce(list);
    return list;
  }

  // Past this many arriving together, one toast with the number instead of
  // one toast each. See batchToast in the data layer for why.
  const TOAST_ONE_BY_ONE_UP_TO = 3;

  /* One toast per card, spaced out so two arriving together read as two
     things rather than one flicker, and the reward toast last of all. */
  async function announce(list) {
    let after, tiersNow, red;
    try {
      after = await D().loadEarned(true);
      tiersNow = await D().loadTiers();
      red = await D().loadRedemptions();
    } catch (_) {
      announceCards(list);
      return;
    }

    const wasReady = new Set(
      D().rewardStatus(tiersNow, Math.max(0, after.size - list.length), red).ready.map((t) => t.id));

    const after_ms = announceCards(list);

    const fresh = D().rewardStatus(tiersNow, after.size, red).ready.find((t) => !wasReady.has(t.id));
    if (fresh && rewardsOn()) setTimeout(() => D().rewardToast(fresh), after_ms + 200);

    earned = after;
    tiers = tiersNow;
    redeemed = red;
    try { cards = await D().loadCatalogue(); } catch (_) {}
    if (el()) render();
  }

  /* Returns when the last card toast will have fired, so the reward toast
     can queue up behind it either way. */
  function announceCards(list) {
    if (list.length > TOAST_ONE_BY_ONE_UP_TO) {
      D().batchToast(list.length);
      return 900;
    }
    // 1.4s apart rather than 0.8s. They stack now instead of covering
    // each other, but arriving faster than somebody can look down at
    // their phone still reads as one flicker.
    list.forEach((c, i) => setTimeout(() => D().toast(c), i * 1400));
    return list.length * 1400;
  }

  /* The three the database cannot check. Each is asserted only when this
     app has actually observed the thing happen. */
  async function assertTrigger(key) {
    if (!dexOn()) return;
    if (!signedIn) {
      const u = await D().currentUser();
      signedIn = !!u;
      if (!signedIn) return;
    }
    try {
      const cat = await D().loadCatalogue();
      const card = cat.find((c) => c.award_type === 'auto' && c.trigger_key === key);
      if (!card) return;
      const have = await D().loadEarned();
      if (have.has(card.id)) return;
      const res = await D().award(card.code);
      if (res && res.status === 'awarded') await announce([res]);
    } catch (_) { /* a card that does not arrive is not worth an error */ }
  }

  function isInstalled() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true;
  }

  /* Called from components/pokedex.js once it has counted. The threshold
     is read off the trigger key rather than written here, so a later
     "100 Pokémon" card is a row in the database and nothing else. */
  function noticePokedex(count) {
    if (!dexOn()) return;
    D().loadCatalogue().then((cat) => {
      cat.filter((c) => /^pokedex_\d+$/.test(c.trigger_key || '')).forEach((c) => {
        if (count >= Number(c.trigger_key.split('_')[1])) assertTrigger(c.trigger_key);
      });
    }).catch(() => {});
  }

  /* Called from components/collection.js when a scan actually runs -- not
     when the button is tapped, and not only when the OCR guesses right.
     Somebody who scanned a card the reader misread still scanned a card,
     and withholding it would teach them the wrong lesson. */
  function noticeScan() { if (dexOn()) assertTrigger('first_card_scanned'); }

  async function bootstrap() {
    const wrap = window.InfinitePullsSupabase;
    if (!wrap || !wrap.ready) return;
    if (!dexOn()) return;
    const u = await D().currentUser();
    signedIn = !!u;
    if (!signedIn) return;
    if (u.id !== userId) { userId = u.id; seen = null; }
    if (isInstalled()) assertTrigger('app_installed');
    await sweepNow();
  }

  window.addEventListener('appinstalled', () => assertTrigger('app_installed'));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
  else bootstrap();

  async function init(prefillCode) {
    const root = el();
    if (!root) return;
    // app.js sends ?page=dex home when the switch is off, so this is the
    // belt to that braces: a direct call from anywhere else finds nothing
    // to draw either.
    if (!dexOn()) { root.innerHTML = ''; return; }
    openCardId = null;

    try {
      const user = await D().currentUser();
      signedIn = !!user;
      if (user && user.id !== userId) { userId = user.id; seen = null; }
      cards = await D().loadCatalogue(true);
      earned = await D().loadEarned(true);
      tiers = await D().loadTiers(true);
      redeemed = await D().loadRedemptions(true);
      username = signedIn ? await D().loadUsername(true) : '';
    } catch (err) {
      root.innerHTML = '<div class="empty-state">Could not load the Infinite Dex just now.</div>';
      return;
    }
    render();
    sweepNow();

    // A QR code on the board in the shop points here with the code already
    // on it, so the whole thing is: point phone, card arrives.
    if (prefillCode) {
      const input = document.getElementById('dex-claim-input');
      if (input) input.value = prefillCode.toUpperCase();
      if (signedIn) claim(prefillCode);
      else status('Make a free account and this code is waiting for you.');
    }
  }

  window.InfinitePullsDex = { init, claim, refresh, sweep: sweepNow, noticePokedex, noticeScan, _render: render };
})();
