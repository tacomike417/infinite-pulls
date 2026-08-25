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
  let signedIn = false;
  let openCardId = null;

  const el = () => document.getElementById('dex-page');

  // ---- Rendering ----

  function tile(c) {
    const has = earned.has(c.id);
    const art = c.thumb_url || c.art_url;
    const num = c.series === 'set' ? String(c.number).padStart(3, '0') : '★';
    return `
      <button type="button" class="dex-tile${has ? ' is-earned' : ''}${c.rarity === 'gold' ? ' is-gold' : ''}"
              data-dex-card="${esc(c.id)}">
        <span class="dex-tile-art">
          ${art ? `<img src="${esc(art)}" alt="" loading="lazy">` : '<span class="dex-tile-noart">?</span>'}
          ${has ? '' : '<span class="dex-tile-lock">🔒</span>'}
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
    `;
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
      const res = await D().claimCode(word);
      if (res.status === 'awarded') {
        D().toast(res);
        await refresh();
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
      render();
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  });

  async function init(prefillCode) {
    const root = el();
    if (!root) return;
    openCardId = null;

    try {
      const user = await D().currentUser();
      signedIn = !!user;
      cards = await D().loadCatalogue(true);
      earned = await D().loadEarned(true);
    } catch (err) {
      root.innerHTML = '<div class="empty-state">Could not load the Infinite Dex just now.</div>';
      return;
    }
    render();

    // A QR code on the board in the shop points here with the code already
    // on it, so the whole thing is: point phone, card arrives.
    if (prefillCode) {
      const input = document.getElementById('dex-claim-input');
      if (input) input.value = prefillCode.toUpperCase();
      if (signedIn) claim(prefillCode);
      else status('Make a free account and this code is waiting for you.');
    }
  }

  window.InfinitePullsDex = { init, claim, refresh, _render: render };
})();
