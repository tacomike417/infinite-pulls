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
          market_price: row.market_price
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

  /* ---- Wiring -------------------------------------------------------- */

  async function init() {
    if (!el('scan-inventory-card')) return;

    const client = sb();
    if (client) {
      try {
        const { data } = await client.auth.getSession();
        userId = data && data.session && data.session.user && data.session.user.id;
      } catch (_) { /* the cards still go in */ }
    }

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
