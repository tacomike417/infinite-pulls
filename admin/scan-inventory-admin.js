/* PRICE CARDS IN — the counter scanner.
 *
 * WHAT THIS IS FOR: standing in the shop with a stack of two hundred
 * cards and getting through them. That is the whole specification. Every
 * decision below is "does this cost a second, two hundred times over".
 *
 * THE LOOP
 *
 *   snap -> the card comes up -> type a price -> Add -> camera is back
 *
 * and nothing in that loop waits for the network. The moment Add is
 * pressed the card is on the list and the camera is reopening; the photo
 * upload and the push into Clover happen behind it, while the next card
 * is already being shot. Two hundred cards times three seconds of
 * watching a spinner is ten minutes of standing still.
 *
 * WHY THAT IS SAFE. Every card is written to shop_scan_queue first, and
 * that row is the record. If Clover refuses one, the row stays and the
 * card turns red on the list with a Try again button. Nothing that was
 * scanned can be lost by a bad signal, which matters when the shop wifi
 * is what it is.
 *
 * ONE CARD, ONE LISTING. Scanning a second copy of the same card makes a
 * second listing with its own photo and its own price, because that is
 * what it is -- two different physical objects in two different
 * conditions. Stock counts are for sealed product, not singles.
 *
 * NOTHING HERE IS WRITTEN TWICE. The camera, Google Vision, the number
 * parsing, the TCGdex lookup and the pricing are all components/
 * collection.js -- the same code the customer scanner runs.
 */
(function () {
  'use strict';

  const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  const col = () => window.InfinitePullsCollection;
  const el = (id) => document.getElementById(id);

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  const money = (n) => (typeof n === 'number' && isFinite(n))
    ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD' }) : null;

  let pending = null;      // the card on screen, waiting for a price
  let alternatives = [];   // other matches, if the read was ambiguous
  let added = [];          // this session's cards, newest first
  let busy = false;        // a scan is in flight
  let userId = null;
  let categories = [];     // his own Clover categories

  /* THE CATEGORY IS REMEMBERED, NOT ASKED.
     He does singles for an hour, then sealed for twenty minutes. Asking
     per card would be asking the same question two hundred times; asking
     once and remembering it between visits means the answer is already
     right when he opens the page tomorrow. */
  const CAT_KEY = 'ip-scan-category';
  function savedCategory() {
    try { return JSON.parse(localStorage.getItem(CAT_KEY) || 'null'); } catch (_) { return null; }
  }
  function rememberCategory(cat) {
    try {
      if (cat && cat.id) localStorage.setItem(CAT_KEY, JSON.stringify({ id: cat.id, name: cat.name }));
      else localStorage.removeItem(CAT_KEY);
    } catch (_) { /* it still works, it just forgets */ }
  }
  function chosenCategory() {
    const sel = el('scan-inv-category');
    if (!sel || !sel.value) return null;
    return { id: sel.value, name: sel.options[sel.selectedIndex]?.textContent || null };
  }

  function say(msg, kind) {
    const node = el('scan-inv-status');
    if (!node) return;
    node.textContent = msg || '';
    node.style.color = kind === 'bad' ? '#fca5a5' : (kind === 'good' ? '#86efac' : '');
  }

  /* ---- The camera ---------------------------------------------------- */

  async function snap() {
    const c = col();
    if (!c || !c.scanCardSmart) { say('The scanner is not loaded on this page.', 'bad'); return; }
    if (busy) return;
    busy = true;

    try {
      const res = await c.scanCardSmart('en');

      if (res.status === 'cancelled') { say(''); return; }
      if (res.status === 'unavailable') { say('No camera on this device.', 'bad'); return; }

      if (res.status !== 'ok' || !res.number) {
        /* A misread is not a failure to recover from with a fresh start --
           he is holding the card. Straight back to the camera. */
        say('Could not read that one. Fill the outline and hold it flat.', 'bad');
        return;
      }

      say('Looking it up…');
      const { results } = await c.lookupByNumber(res.number, 'en');
      const hits = (results || []).filter((r) => r.card);
      if (!hits.length) { say(`Read ${res.number}, but no card came back for it.`, 'bad'); return; }

      alternatives = hits.slice(1, 6);
      show(hits[0], res.photo || null);
      say('');
    } catch (err) {
      say((err && err.message) || 'That did not go through.', 'bad');
    } finally {
      busy = false;
    }
  }

  function show(hit, photo) {
    const card = hit.card;
    pending = {
      card_id: card.id,
      name: card.name || '',
      set_name: (card.set && card.set.name) || '',
      card_number: card.localId || '',
      art_url: card.image ? card.image + '/low.webp' : '',
      photo_data: photo,
      market_price: (typeof hit.amount === 'number') ? hit.amount : null
    };

    el('scan-inv-photo').src = photo || pending.art_url || '';
    el('scan-inv-name').textContent = pending.name;
    el('scan-inv-meta').textContent =
      [pending.set_name, pending.card_number].filter(Boolean).join(' · ');

    /* What it is worth is shown, never filled in. The price on the shelf
       is a decision with rent behind it, and it is not TCGplayer's to
       make. */
    const worth = money(pending.market_price);
    el('scan-inv-market').textContent = worth ? `Worth ${worth} right now` : 'No market price for this one';

    el('scan-inv-wrong').hidden = !alternatives.length;
    el('scan-inv-choices').hidden = true;
    el('scan-inv-choices').innerHTML = '';

    const price = el('scan-inv-price');
    price.value = '';
    el('scan-inv-pending').hidden = false;
    price.focus();
  }

  function showAlternatives() {
    const box = el('scan-inv-choices');
    box.innerHTML = alternatives.map((h, i) => {
      const c = h.card;
      const worth = money(h.amount);
      return `<button type="button" class="ghost-btn" data-alt="${i}">
        <strong>${esc(c.name || '')}</strong>
        <small>${esc([(c.set && c.set.name) || '', c.localId || ''].filter(Boolean).join(' · '))}${worth ? ' · ' + worth : ''}</small>
      </button>`;
    }).join('');
    box.hidden = false;
  }

  function clearPending() {
    pending = null;
    alternatives = [];
    el('scan-inv-pending').hidden = true;
    el('scan-inv-choices').hidden = true;
  }

  /* ---- Adding one ---------------------------------------------------- */

  async function add() {
    if (!pending) return;
    const price = parseFloat(el('scan-inv-price').value);
    if (!isFinite(price) || price <= 0) {
      say('Put a price on it first.', 'bad');
      el('scan-inv-price').focus();
      return;
    }

    const row = {
      key: 'k' + Date.now() + Math.random().toString(36).slice(2, 6),
      card_id: pending.card_id,
      name: pending.name,
      set_name: pending.set_name,
      card_number: pending.card_number,
      art_url: pending.art_url,
      photo_data: pending.photo_data,
      market_price: pending.market_price,
      price,
      state: 'sending'
    };

    /* Read at the moment of adding, not at the moment of scanning: if he
       changes the picker between the snap and the Add, the card goes
       where the picker says now. */
    const cat = chosenCategory();
    if (cat) { row.category_id = cat.id; row.category_name = cat.name; }

    added = [row, ...added];
    clearPending();
    draw();

    /* Straight back to the camera. The card is already on the list and
       the rest of it happens behind him. */
    send(row);
    snap();
  }

  /* Everything that touches the network for one card, in the background.
     Queue row first -- that is the thing that means a card is never lost
     -- then the photo, then Clover. */
  async function send(row) {
    const client = sb();
    if (!client) { fail(row, 'Not signed in.'); return; }

    try {
      const { data: queued, error: qErr } = await client.from('shop_scan_queue').insert({
        scanned_by: userId,
        card_id: row.card_id,
        name: row.name,
        set_name: row.set_name,
        card_number: row.card_number,
        image_url: row.art_url,
        sku: row.card_id,
        price: row.price,
        market_price: row.market_price,
        quantity: 1
      }).select('id').single();
      if (qErr) { fail(row, qErr.message); return; }
      row.queue_id = queued.id;

      let photoUrl = null;
      if (row.photo_data) {
        /* A photo that would not upload is not worth losing the card
           over -- the listing goes up on the catalogue art instead. But
           it says so on the row, because a photo silently going missing
           on two hundred cards is not something to find out later. */
        try {
          photoUrl = await uploadPhoto(row);
        } catch (err) {
          row.warning = 'Added, but the photo did not upload.';
        }
      }

      const { data, error } = await client.functions.invoke('clover-add-item', {
        body: {
          name: [row.name, row.set_name, row.card_number].filter(Boolean).join(' - '),
          price: row.price,
          stock_count: 1,
          card_id: row.card_id,
          set_name: row.set_name,
          card_number: row.card_number,
          art_url: row.art_url,
          photo_url: photoUrl,
          market_price: row.market_price,
          category_id: row.category_id || null,
          category_name: row.category_name || null
        }
      });

      const problem = error
        ? (error.context && (await error.context.text().catch(() => '')) || error.message)
        : (data && data.error);
      if (problem) { fail(row, problem); return; }

      await client.from('shop_scan_queue')
        .update({ pushed_at: new Date().toISOString() })
        .eq('id', queued.id);

      row.state = 'done';
      row.warning = data && data.warning ? data.warning : null;
      draw();
    } catch (err) {
      fail(row, (err && err.message) || 'That did not reach Clover.');
    }
  }

  /* The frame arrives as a data: URL. Decoding it by hand rather than
     fetch()ing it looks like the long way round, and is not: fetch on a
     data: URL is subject to the page's origin rules and quietly refuses
     in enough situations to matter. This cannot. */
  function dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const meta = dataUrl.slice(0, comma);
    const type = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const body = dataUrl.slice(comma + 1);
    const binary = meta.includes(';base64') ? atob(body) : decodeURIComponent(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  async function uploadPhoto(row) {
    const client = sb();
    const blob = dataUrlToBlob(row.photo_data);
    const path = `${row.card_id || 'card'}-${Date.now()}.jpg`;
    const { error } = await client.storage.from('shop-cards')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    const { data } = client.storage.from('shop-cards').getPublicUrl(path);
    return data && data.publicUrl ? data.publicUrl : null;
  }

  function fail(row, why) {
    row.state = 'failed';
    row.why = why || 'It did not go through.';
    draw();
  }

  async function retry(key) {
    const row = added.find((r) => r.key === key);
    if (!row) return;
    row.state = 'sending';
    row.why = null;
    draw();
    /* The queue row was already written if it got that far, so start
       from the push rather than making a second one. */
    if (row.queue_id) {
      const client = sb();
      await client.from('shop_scan_queue').delete().eq('id', row.queue_id).catch(() => {});
      row.queue_id = null;
    }
    send(row);
  }

  /* ---- The list ------------------------------------------------------ */

  function draw() {
    const list = el('scan-inv-list');
    if (!list) return;

    const done = added.filter((r) => r.state === 'done').length;
    const total = added.reduce((sum, r) => sum + (r.state !== 'failed' ? r.price : 0), 0);
    el('scan-inv-count').textContent = added.length
      ? `${added.length}${done < added.length ? ` · ${done} in Clover` : ''} · ${money(total)}`
      : '';

    if (!added.length) {
      list.innerHTML = '<small>Nothing yet. Snap the first one.</small>';
      return;
    }

    list.innerHTML = added.map((r) => {
      const tag = r.state === 'done' ? '<span class="scan-ok">in Clover</span>'
        : r.state === 'failed' ? '<span class="scan-bad">did not go</span>'
        : '<span class="scan-wait">sending…</span>';
      return `<div class="info-row scan-row ${esc(r.state)}">
        <span>
          <strong>${esc(r.name)}</strong>
          <small>${esc([r.set_name, r.card_number].filter(Boolean).join(' · '))} ${tag}</small>
          ${r.state === 'failed' ? `<small class="scan-why">${esc(r.why)}</small>` : ''}
          ${r.warning ? `<small class="scan-why">${esc(r.warning)}</small>` : ''}
        </span>
        <span>${esc(money(r.price))}
          ${r.state === 'failed' ? `<button class="ghost-btn" type="button" data-retry="${esc(r.key)}">Try again</button>` : ''}
        </span>
      </div>`;
    }).join('');
  }

  /* ---- His own categories --------------------------------------------
   *
   * Fetched from Clover rather than typed in here, because they are his
   * and they change -- he added Popdarts and Legos without telling
   * anybody, and a hard-coded list would have quietly sent both to the
   * wrong shelf. The Edge Function asks Clover; nothing here guesses.
   *
   * IF THIS FAILS, SCANNING STILL WORKS. A card with no category still
   * sells; it just lands in "Everything else" on the website until the
   * tidy-up below moves it. Losing the category list must never stop him
   * pricing cards, so the failure is a line of text and nothing more.
   */
  async function loadCategories() {
    const sel = el('scan-inv-category');
    const note = el('scan-inv-cat-note');
    const client = sb();
    if (!sel || !client) return;

    const remembered = savedCategory();

    try {
      const { data, error } = await client.functions.invoke('clover-add-item', {
        body: { action: 'categories' }
      });
      if (error) throw error;
      if (data && data.error) throw new Error(data.error);
      categories = Array.isArray(data && data.categories) ? data.categories : [];
    } catch (err) {
      categories = [];
      sel.innerHTML = '<option value="">No category</option>';
      if (note) {
        note.hidden = false;
        note.textContent = 'Could not get your category list from Clover just now. Cards still go in — they will sit under "Everything else" on the website until you file them.';
      }
      return;
    }

    /* "No category" stays as a real choice. Sometimes the honest answer
       is that he does not know yet, and forcing a wrong shelf is worse
       than an empty one. */
    sel.innerHTML = '<option value="">No category</option>' +
      categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');

    /* Last time's answer, if it is still one of his categories. */
    if (remembered && remembered.id && categories.some((c) => c.id === remembered.id)) {
      sel.value = remembered.id;
    }
    if (note) { note.hidden = true; note.textContent = ''; }
  }

  /* ---- The stack that went in before the picker existed ---------------
   *
   * Only shown when there is actually something to fix. A tidy-up button
   * that is always there, always saying zero, is one more thing to read
   * past every morning.
   */
  async function drawBacklog() {
    const box = el('scan-inv-backlog');
    const count = el('scan-inv-backlog-count');
    const client = sb();
    if (!box || !client) return;

    let n = 0;
    try {
      const { count: c, error } = await client
        .from('shop_inventory')
        .select('id', { count: 'exact', head: true })
        .is('category_id', null)
        .not('card_id', 'is', null);      // scanned cards only, never his Clover stock
      if (error) throw error;
      n = c || 0;
    } catch (_) { box.hidden = true; return; }

    if (!n) { box.hidden = true; return; }
    box.hidden = false;
    if (count) {
      count.innerHTML = `<small>${n} card${n === 1 ? '' : 's'} you added ${n === 1 ? 'is' : 'are'} not in a category yet. ` +
        `Pick where they go at the top of this page, then press the button.</small>`;
    }
  }

  async function fileBacklog() {
    const btn = el('scan-inv-file');
    const status = el('scan-inv-backlog-status');
    const client = sb();
    const cat = chosenCategory();
    if (!client || !btn) return;

    if (!cat) {
      if (status) { status.textContent = 'Pick a category at the top of this page first.'; status.style.color = '#fca5a5'; }
      return;
    }

    btn.disabled = true;
    if (status) { status.style.color = ''; status.textContent = `Filing them under ${cat.name}…`; }

    try {
      const { data, error } = await client.functions.invoke('clover-add-item', {
        body: { action: 'file-uncategorised', category_id: cat.id, category_name: cat.name }
      });
      if (error) throw error;
      if (data && data.error) throw new Error(data.error);

      const moved  = (data && data.filed)  || 0;
      const missed = (data && data.failed) || 0;

      /* A thousand at a time is the server's limit, so a very large
         backlog goes in more than one press. Nothing is lost by that:
         the count is redrawn below, so if any are left the panel simply
         stays open with the smaller number still on it. */

      /* A PARTIAL RESULT HAS TO SAY SO.
         Clover is asked in batches of fifty, and one batch can be refused
         while the rest go through. Reporting that as "Done" is how he
         finds three weeks later that forty cards never moved. */
      if (status) {
        if (missed) {
          status.style.color = '#fca5a5';
          status.textContent = `${moved} moved into ${cat.name}, but ${missed} would not go. ` +
            `Press it again in a minute — the ones that worked are already done and will not move twice.`;
        } else {
          status.style.color = '#86efac';
          status.textContent = moved
            ? `Done — ${moved} card${moved === 1 ? '' : 's'} moved into ${cat.name}.`
            : 'Nothing needed moving.';
        }
      }
      await drawBacklog();
    } catch (err) {
      if (status) {
        status.style.color = '#fca5a5';
        status.textContent = `That did not go through: ${err?.message || err}. Nothing was moved — you can press it again.`;
      }
    } finally {
      btn.disabled = false;
    }
  }

  /* ---- The way in ----------------------------------------------------
   *
   * A tab is only found by somebody who goes looking for one. This is the
   * first thing on the page whichever tab he was last on, and pressing it
   * opens the camera -- so it is one tap from logging in to shooting a
   * card, with no tabs, no scrolling and nothing to expand.
   *
   * It is deliberately NOT the same filled gold as the orders banner.
   * That one means something is waiting for you; this one is just the
   * door. Two identical yellow bars, one urgent and one routine, teaches
   * people to ignore both.
   */
  function banner() {
    const host = document.getElementById('admin-content');
    if (!host || document.getElementById('add-stock-banner')) return;

    const wrap = document.createElement('div');
    wrap.id = 'add-stock-banner';
    wrap.className = 'stock-banner';
    wrap.innerHTML = `
      <span class="sb-icon" aria-hidden="true">📷</span>
      <span class="sb-words">
        <strong>Add cards to the shop</strong>
        <small>Snap it, type your price, and it is in Clover and on the website.</small>
      </span>
      <button type="button" class="sb-go" id="add-stock-go">Add a card</button>`;

    /* Under the orders banner when there is one -- something already sold
       matters more than something not yet listed. */
    const orders = document.getElementById('orders-banner');
    if (orders && orders.nextSibling) host.insertBefore(wrap, orders.nextSibling);
    else if (orders) host.appendChild(wrap);
    else host.insertBefore(wrap, host.firstChild);

    document.getElementById('add-stock-go').addEventListener('click', () => {
      const tabs = window.InfinitePullsAdminTabs;
      if (tabs && tabs.select) tabs.select('addstock');
      snap();
    });
  }

  /* ---- Wiring -------------------------------------------------------- */

  async function init() {
    if (!el('scan-inventory-card')) return;
    banner();
    /* The orders banner arrives after its own network call, so this one
       is put back in the right order once that has had its chance. */
    setTimeout(() => {
      const wrap = document.getElementById('add-stock-banner');
      const orders = document.getElementById('orders-banner');
      if (wrap && orders && orders.nextSibling !== wrap) {
        orders.parentNode.insertBefore(wrap, orders.nextSibling);
      }
    }, 2500);

    const client = sb();
    if (client) {
      try {
        const { data } = await client.auth.getSession();
        userId = data && data.session && data.session.user && data.session.user.id;
      } catch (_) { /* the cards still go in */ }
    }

    /* Both behind the scanning loop, not in front of it: he can snap a
       card before either has come back, and the category is only read
       when Add is pressed. */
    loadCategories();
    drawBacklog();

    el('scan-inv-category')?.addEventListener('change', () => rememberCategory(chosenCategory()));
    el('scan-inv-file')?.addEventListener('click', fileBacklog);

    el('scan-inv-shoot')?.addEventListener('click', snap);
    el('scan-inv-retake')?.addEventListener('click', snap);
    el('scan-inv-add')?.addEventListener('click', add);
    el('scan-inv-skip')?.addEventListener('click', () => { clearPending(); say(''); snap(); });
    el('scan-inv-wrong')?.addEventListener('click', showAlternatives);

    /* Done on the phone keypad adds the card. Reaching for a button
       every time is the difference between fast and tedious. */
    el('scan-inv-price')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); add(); }
    });

    el('scan-inv-choices')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-alt]');
      if (!btn) return;
      const pick = alternatives[Number(btn.dataset.alt)];
      const photo = pending && pending.photo_data;
      if (pick) { alternatives = alternatives.filter((h) => h !== pick); show(pick, photo); }
    });

    el('scan-inv-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-retry]');
      if (btn) retry(btn.dataset.retry);
    });

    draw();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
