/* Infinite Rewards — the admin side.
 *
 * Named Infinite Dex until 3 Sep 2026. Wording only: every id, table and
 * column below is exactly as it was.
 *
 * Its own file, and it owns its own lifecycle: it watches Supabase auth
 * itself rather than being called from admin.js's showSignedIn(). That
 * keeps admin.js — already 54 KB — untouched by this feature, and means a
 * mistake in here cannot take the rest of the panel down with it.
 *
 * What this screen is for: Jeff writes a word on a board in the shop, and
 * a card in the app matches it. Everything else here exists to make that
 * one thing correct before a customer is standing at the counter.
 *
 * It never writes to user_dex_cards. Nothing can — see section 2 of
 * supabase/infinite_dex.sql.
 */
(function () {
  'use strict';

  // admin.js declares supabaseClient as a top-level const, which puts it in
  // the global lexical scope for every script that loads after it. Read it
  // through a function rather than capturing it at load time, so this file
  // does not care about script order.
  const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : null);

  const BUCKET = 'dex-art';

  // These are the keys public.dex_trigger_met() knows. Adding one here
  // without adding it there produces a card nobody can ever earn, so the
  // two lists are meant to be read side by side.
  //
  // `blind: true` marks the three the database cannot check — the app's
  // word is taken for those. See INFINITE-DEX.md.
  const TRIGGERS = [
    { key: 'account_created',      label: 'Account created' },
    { key: 'first_card_added',     label: 'First card added to My Collection' },
    { key: 'cards_10',             label: '10 cards collected' },
    { key: 'cards_100',            label: '100 cards collected' },
    { key: 'first_wish_saved',     label: 'First wish list card saved' },
    { key: 'first_goal_completed', label: 'First Collector Goal completed' },
    { key: 'first_sealed_added',   label: 'First sealed product added' },
    { key: 'alerts_enabled',       label: 'Price alerts turned on' },
    { key: 'collection_public',    label: 'Public collector page set up' },
    { key: 'app_installed',        label: 'App installed to home screen', blind: true },
    { key: 'first_card_scanned',   label: 'First card scanned with the camera', blind: true },
    { key: 'pokedex_50',           label: '50 Pokémon discovered', blind: true }
  ];

  let cards = [];
  let busy = false;

  const $ = (id) => document.getElementById(id);
  const esc = (v = '') => String(v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  function say(msg, bad) {
    const el = $('dex-status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = bad ? '#fca5a5' : '';
  }

  // ---- Loading and listing ----

  async function loadDexAdmin() {
    const client = sb();
    if (!client) return;
    try {
      const { data, error } = await client
        .from('infinite_dex_cards')
        .select('*')
        .order('series', { ascending: true })
        .order('number', { ascending: true, nullsFirst: false })
        .order('display_order', { ascending: true });
      if (error) throw error;
      cards = data || [];
      // Deliberately does not clear the status line. Every caller sets a
      // message and then reloads, and a reload that wipes it makes a
      // successful save look like nothing happened.
    } catch (err) {
      cards = [];
      say('Could not load the cards: ' + (err.message || err), true);
    }
    renderDexList();
  }

  function triggerLabel(key) {
    const t = TRIGGERS.find((x) => x.key === key);
    return t ? t.label : key;
  }

  function howEarned(c) {
    if (c.award_type === 'code') {
      return 'Code: <b class="dex-code">' + esc(c.claim_code) + '</b>';
    }
    return 'Automatic — ' + esc(triggerLabel(c.trigger_key));
  }

  // "Live", "Not yet", "Finished" or "Off", said in words rather than as a
  // pair of timestamps he has to compare in his head.
  function windowState(c) {
    if (!c.enabled) return { text: 'Off', tone: 'muted' };
    const now = Date.now();
    if (c.active_from && now < Date.parse(c.active_from)) return { text: 'Starts later', tone: 'muted' };
    if (c.active_until && now > Date.parse(c.active_until)) return { text: 'Finished', tone: 'muted' };
    return { text: 'Live', tone: 'live' };
  }

  function cardRow(c) {
    const st = windowState(c);
    const art = c.thumb_url || c.art_url;
    const slot = c.series === 'set' ? String(c.number).padStart(3, '0') : 'event';
    return `
      <div class="info-row dex-row">
        <span class="dex-thumb">${art
          ? `<img src="${esc(art)}" alt="">`
          : '<em>no art</em>'}</span>
        <span style="min-width:0; flex:1">
          <strong style="display:block">${esc(c.name)}
            <small class="dex-pill dex-${st.tone}">${esc(st.text)}</small>
            ${c.rarity === 'gold' ? '<small class="dex-pill dex-gold">gold</small>' : ''}
          </strong>
          <small style="display:block; color:var(--muted)">${esc(c.code)} · ${esc(c.season)} · ${esc(slot)}</small>
          <small style="display:block">${esc(c.task_line)}</small>
          <small style="display:block; color:var(--muted)">${howEarned(c)}</small>
        </span>
        <span style="display:flex; flex-direction:column; gap:4px; flex:0 0 auto;">
          <button type="button" class="ghost-btn dex-edit" data-id="${c.id}" style="padding:4px 8px;">Edit</button>
          <button type="button" class="ghost-btn dex-toggle" data-id="${c.id}" style="padding:4px 8px;">${c.enabled ? 'Turn off' : 'Turn on'}</button>
          ${c.award_type === 'code' ? `<button type="button" class="ghost-btn dex-copy" data-code="${esc(c.claim_code)}" style="padding:4px 8px;">Copy code</button>` : ''}
        </span>
      </div>`;
  }

  function renderDexList() {
    const el = $('dex-admin-list');
    if (!el) return;

    if (!cards.length) {
      el.innerHTML = '<p><small>No cards yet. Run <code>supabase/infinite_dex.sql</code> to seed the season, or add one below.</small></p>';
      return;
    }

    const set = cards.filter((c) => c.series === 'set');
    const events = cards.filter((c) => c.series === 'event');
    const withArt = set.filter((c) => c.art_url).length;

    el.innerHTML =
      `<h3 class="dex-group">The season — ${esc(set[0]?.season || 'S26')}
         <small>${withArt} of ${set.length} have art</small></h3>` +
      (set.map(cardRow).join('') || '<p><small>None.</small></p>') +
      `<h3 class="dex-group">In-shop cards <small>${events.length}</small></h3>` +
      (events.map(cardRow).join('') || '<p><small>None yet — these are the ones with a code on a board.</small></p>');

    el.querySelectorAll('.dex-edit').forEach((b) =>
      b.addEventListener('click', () => openDexForm(cards.find((c) => c.id === b.dataset.id))));
    el.querySelectorAll('.dex-toggle').forEach((b) =>
      b.addEventListener('click', () => toggleDexCard(b.dataset.id)));
    el.querySelectorAll('.dex-copy').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.code);
          say('Copied "' + b.dataset.code + '" — that is what goes on the board.');
        } catch {
          say('Could not copy. The code is ' + b.dataset.code, true);
        }
      }));
  }

  async function toggleDexCard(id) {
    const c = cards.find((x) => x.id === id);
    if (!c) return;
    if (!c.enabled && !c.art_url && !confirm('This card has no art yet. Turn it on anyway?')) return;
    say('Saving…');
    try {
      const { error } = await sb().from('infinite_dex_cards').update({ enabled: !c.enabled }).eq('id', id);
      if (error) throw error;
      say(c.enabled ? 'Turned off. Nobody can earn it now.' : 'Turned on.');
    } catch (err) {
      say('Could not save: ' + (err.message || err), true);
    }
    await loadDexAdmin();
  }

  // ---- The form ----

  // <input type="datetime-local"> speaks local wall-clock time with no zone.
  // The column is timestamptz. These two convert between them via the
  // browser's own zone, which is the shop's zone, which is what he means
  // when he types "9pm".
  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fromLocalInput(v) {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d) ? null : d.toISOString();
  }

  function syncFormVisibility() {
    const series = $('dex-form-series').value;
    const award = $('dex-form-award').value;
    $('dex-number-wrap').hidden = series !== 'set';
    $('dex-code-wrap').hidden = award !== 'code';
    $('dex-trigger-wrap').hidden = award !== 'auto';

    const t = TRIGGERS.find((x) => x.key === $('dex-form-trigger').value);
    const warn = $('dex-trigger-warn');
    if (warn) {
      warn.hidden = !(award === 'auto' && t && t.blind);
      warn.textContent = t && t.blind
        ? 'The database cannot check this one — the app is taken at its word. That is expected for these three.'
        : '';
    }
    renderDexPreview();
  }

  function renderDexPreview() {
    const box = $('dex-form-preview');
    if (!box) return;
    const name = $('dex-form-name').value.trim() || 'CARD NAME';
    const task = $('dex-form-task').value.trim() || 'TASK LINE';
    const flavor = $('dex-form-flavor').value.trim();
    const gold = $('dex-form-rarity').value === 'gold';
    const art = box.dataset.preview || '';
    box.innerHTML = `
      <div class="dex-preview ${gold ? 'is-gold' : ''}">
        ${art ? `<img src="${esc(art)}" alt="">` : '<span class="dex-preview-empty">art goes here</span>'}
        <div class="dex-preview-text">
          <small>INFINITE DEX</small>
          <b>${esc(name.toUpperCase())}</b>
          <i>${esc(task.toUpperCase())}</i>
          ${flavor ? `<u>${esc(flavor)}</u>` : ''}
        </div>
      </div>`;
  }

  function resetDexForm() {
    const f = $('dex-admin-form');
    f.reset();
    $('dex-form-id').value = '';
    $('dex-form-season').value = cards[0]?.season || 'S26';
    $('dex-form-enabled').checked = false;
    $('dex-form-preview').dataset.preview = '';
    $('dex-form-art').value = '';
    $('dex-art-note').textContent = '';
    syncFormVisibility();
  }

  function openDexForm(card) {
    const f = $('dex-admin-form');
    if (!f) return;
    f.hidden = false;
    resetDexForm();

    if (card) {
      $('dex-form-id').value = card.id;
      $('dex-form-code').value = card.code;
      $('dex-form-name').value = card.name;
      $('dex-form-task').value = card.task_line;
      $('dex-form-flavor').value = card.flavor || '';
      $('dex-form-season').value = card.season;
      $('dex-form-series').value = card.series;
      $('dex-form-number').value = card.number ?? '';
      $('dex-form-rarity').value = card.rarity;
      $('dex-form-award').value = card.award_type;
      $('dex-form-code-word').value = card.claim_code || '';
      $('dex-form-trigger').value = card.trigger_key || 'account_created';
      $('dex-form-from').value = toLocalInput(card.active_from);
      $('dex-form-until').value = toLocalInput(card.active_until);
      $('dex-form-enabled').checked = !!card.enabled;
      $('dex-form-order').value = card.display_order ?? 0;
      $('dex-form-preview').dataset.preview = card.thumb_url || card.art_url || '';
      syncFormVisibility();
    }

    f.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Art ----

  // The originals are ~3 MB each and 1060x1484. Twelve of those is 38 MB to
  // open the Dex on a phone on shop wifi, so a small WebP is written
  // alongside every upload and the grid shows that instead. The full art is
  // stored untouched — it is only loaded when somebody taps a card.
  const THUMB_WIDTH = 420;
  const CARD_RATIO = 5 / 7;

  async function processArt(file) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = Math.round((bitmap.height / bitmap.width) * THUMB_WIDTH);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    let thumb = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.82));
    let ext = 'webp';
    // Safari was late to WebP encoding and toBlob hands back null rather
    // than throwing. JPEG is bigger but universal.
    if (!thumb) {
      thumb = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      ext = 'jpg';
    }
    if (!thumb) throw new Error('This browser could not resize that image.');

    return { thumb, thumbExt: ext, width: bitmap.width, height: bitmap.height };
  }

  async function uploadArt(code, file) {
    const client = sb();
    const { thumb, thumbExt, width, height } = await processArt(file);
    const stamp = Date.now();
    const fullExt = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const base = code.toLowerCase() + '/' + stamp;

    const put = async (path, body, type) => {
      const { error } = await client.storage.from(BUCKET).upload(path, body, {
        contentType: type, upsert: true, cacheControl: '31536000'
      });
      if (error) throw error;
      return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    };

    const art_url = await put(`${base}-full.${fullExt}`, file, file.type || 'image/png');
    const thumb_url = await put(`${base}-thumb.${thumbExt}`, thumb, thumb.type);

    return { art_url, thumb_url, width, height, thumbBytes: thumb.size };
  }

  // ---- Saving ----

  async function saveDexCard(e) {
    e.preventDefault();
    if (busy) return;

    const id = $('dex-form-id').value || null;
    const code = $('dex-form-code').value.trim().toUpperCase();
    const series = $('dex-form-series').value;
    const award = $('dex-form-award').value;
    const numberRaw = $('dex-form-number').value.trim();
    const from = fromLocalInput($('dex-form-from').value);
    const until = fromLocalInput($('dex-form-until').value);

    // Everything below is also enforced by a constraint in the database.
    // It is repeated here so he gets a sentence instead of a Postgres
    // error message.
    if (!/^[A-Z0-9]{2,6}-[A-Z0-9]{1,6}$/.test(code)) {
      return say('The code should look like COL-001 or EVT-002.', true);
    }
    if (series === 'set' && !numberRaw) {
      return say('A card in the season set needs a number — it is the "005" of "005 / 012".', true);
    }
    if (award === 'code' && !$('dex-form-code-word').value.trim()) {
      return say('A code card needs the word that goes on the board.', true);
    }
    if (from && until && Date.parse(until) <= Date.parse(from)) {
      return say('The finish time is before the start time.', true);
    }

    const row = {
      code,
      name: $('dex-form-name').value.trim(),
      task_line: $('dex-form-task').value.trim(),
      flavor: $('dex-form-flavor').value.trim() || null,
      season: $('dex-form-season').value.trim() || 'S26',
      series,
      number: series === 'set' ? Number(numberRaw) : null,
      rarity: $('dex-form-rarity').value,
      award_type: award,
      claim_code: award === 'code' ? $('dex-form-code-word').value.trim() : null,
      trigger_key: award === 'auto' ? $('dex-form-trigger').value : null,
      active_from: from,
      active_until: until,
      enabled: $('dex-form-enabled').checked,
      display_order: Number($('dex-form-order').value || 0)
    };

    busy = true;
    say('Saving…');
    try {
      const file = $('dex-form-art').files?.[0];
      if (file) {
        say('Uploading the art…');
        const art = await uploadArt(code, file);
        row.art_url = art.art_url;
        row.thumb_url = art.thumb_url;
        const ratio = art.width / art.height;
        if (Math.abs(ratio - CARD_RATIO) > 0.03) {
          $('dex-art-note').textContent =
            `Heads up: that image is ${art.width}×${art.height}, which is not the 5:7 shape the other cards use. It will still work, it will just sit differently in the grid.`;
        } else {
          $('dex-art-note').textContent =
            `Art uploaded. Thumbnail is ${Math.round(art.thumbBytes / 1024)} KB.`;
        }
      }

      const client = sb();
      const q = id
        ? client.from('infinite_dex_cards').update(row).eq('id', id)
        : client.from('infinite_dex_cards').insert(row);
      const { error } = await q;
      if (error) throw error;

      say(row.enabled
        ? 'Saved, and it is live.'
        : 'Saved. It is turned off, so nobody can earn it yet.');
      $('dex-admin-form').hidden = true;
      await loadDexAdmin();
    } catch (err) {
      const msg = String(err.message || err);
      // The two most likely ones, said in English.
      if (/infinite_dex_cards_code_key|duplicate key.*code/i.test(msg)) {
        say('A card with the code ' + code + ' already exists. Edit that one instead.', true);
      } else if (/claim_code_idx/i.test(msg)) {
        say('Another card already uses that word. Codes have to be unique.', true);
      } else if (/season_number_idx/i.test(msg)) {
        say('Another card is already in that slot for this season.', true);
      } else {
        say('Could not save: ' + msg, true);
      }
    } finally {
      busy = false;
    }
  }

  // ---- The rewards ----
  //
  // A tier is a number of cards and a sentence. The sentence is free text
  // on purpose: Jeff writes "10% off a booster pack" or "a free sleeve",
  // and neither this screen nor the database needs to understand what that
  // means -- he is the one standing there handing it over.
  //
  // No delete here either, and for the same reason as the cards above: a
  // tier's rows in dex_reward_redemptions are the record of what he has
  // already given away. Turning a tier off stops it being offered without
  // erasing that.

  let tiers = [];

  function sayR(msg, bad) {
    const el = $('dex-rewards-status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = bad ? '#fca5a5' : '';
  }

  async function loadTiers() {
    const client = sb();
    if (!client) return;
    try {
      const { data, error } = await client
        .from('dex_reward_tiers')
        .select('*')
        .order('cards_required', { ascending: true });
      if (error) throw error;
      tiers = data || [];
    } catch (err) {
      tiers = [];
      sayR('Could not load the rewards: ' + (err.message || err), true);
    }
    renderTiers();
  }

  // How many cards a customer could actually hold right now. A tier set
  // above this is one nobody can reach, which is worth saying on the screen
  // rather than leaving him to work out why nobody has claimed it.
  function reachableTotal() {
    return cards.filter((c) => c.enabled).length;
  }

  function tierRow(t) {
    const max = reachableTotal();
    const unreachable = max > 0 && t.cards_required > max;
    return `
      <div class="info-row dex-row">
        <span class="dex-tier-n">${t.cards_required}</span>
        <span style="min-width:0; flex:1">
          <!-- CONDITION FIRST, THEN WHAT THEY GET. Swapped 3 Sep 2026.

               The prize used to be the headline with a muted "at 6 cards"
               beneath it, which reads as a label on a thing rather than a
               sentence. The row is meant to be taken in one go -- "6 reward
               cards collected, prize to be decided" -- and that only works
               in the order somebody would say it out loud.

               "REWARD cards", not "cards". The trigger list at the top of
               this same file already uses "10 cards collected" and "100
               cards collected" to mean POKEMON cards in somebody's own
               collection. Two rows apart, the same three words would have
               meant two different things -- the exact confusion this rename
               set out to end. -->
          <strong style="display:block">${t.cards_required} reward card${t.cards_required === 1 ? '' : 's'} collected${
            unreachable ? ` <small class="dex-pill dex-warn">only ${max} exist today</small>` : ''}</strong>
          ${editingTier === t.id ? `
            <span class="tier-inline">
              <input type="text" class="tier-inline-input" data-id="${t.id}"
                     value="${esc(t.reward)}" placeholder="What do they get?"
                     aria-label="What do they get for ${t.cards_required} reward cards">
              <span class="tier-inline-acts">
                <button type="button" class="primary-btn tier-save" data-id="${t.id}">Save</button>
                <button type="button" class="ghost-btn tier-cancel">Cancel</button>
              </span>
            </span>` : `
            <span style="display:block">${esc(t.reward)}
              <small class="dex-pill dex-${t.enabled ? 'live' : 'muted'}">${t.enabled ? 'On' : 'Off'}</small>
            </span>`}
          ${t.description ? `<small style="display:block; color:var(--muted)">${esc(t.description)}</small>` : ''}
        </span>
        <span style="display:flex; flex-direction:column; gap:4px; flex:0 0 auto;">
          ${editingTier === t.id ? '' :
            `<button type="button" class="ghost-btn tier-edit" data-id="${t.id}" style="padding:4px 8px;">Edit</button>`}
          <button type="button" class="ghost-btn tier-toggle" data-id="${t.id}" style="padding:4px 8px;">${t.enabled ? 'Turn off' : 'Turn on'}</button>
        </span>
      </div>`;
  }

  /* WHICH PRIZE IS OPEN FOR EDITING, IF ANY. Added 3 Sep 2026.

     Edit used to open the form at the bottom of the card and scroll to it.
     That worked and was still the wrong shape: the thing you tapped and the
     thing you type into were in different places, and the page moved under
     you in between. For somebody who is not certain what he just pressed,
     the movement IS the problem.

     So the prize becomes a box where it already is. Nothing scrolls, and
     what you tapped is what you are typing in. One row at a time -- opening
     a second closes the first, because two half-finished edits on screen is
     a question nobody wants to be asked. */
  let editingTier = '';

  function renderTiers() {
    const el = $('dex-rewards-list');
    if (!el) return;
    if (!tiers.length) {
      el.innerHTML = '<p><small>No rewards yet. Add one below — say five cards for 10% off a pack, and see how it goes.</small></p>';
      return;
    }
    el.innerHTML = tiers.map(tierRow).join('');
    el.querySelectorAll('.tier-edit').forEach((b) =>
      b.addEventListener('click', () => { editingTier = b.dataset.id; renderTiers(); focusInline(); }));
    el.querySelectorAll('.tier-toggle').forEach((b) =>
      b.addEventListener('click', () => toggleTier(b.dataset.id)));
    el.querySelectorAll('.tier-cancel').forEach((b) =>
      b.addEventListener('click', () => { editingTier = ''; sayR(''); renderTiers(); }));
    el.querySelectorAll('.tier-save').forEach((b) =>
      b.addEventListener('click', () => saveTierInline(b.dataset.id)));
    /* Enter saves, Escape gives up -- what a keyboard already promises
       everywhere else, and neither costs him a button to find. */
    el.querySelectorAll('.tier-inline-input').forEach((i) => {
      i.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveTierInline(i.dataset.id); }
        if (e.key === 'Escape') { editingTier = ''; sayR(''); renderTiers(); }
      });
    });
  }

  function focusInline() {
    const box = document.querySelector('.tier-inline-input');
    if (!box) return;
    box.focus();
    /* Cursor at the end rather than everything selected: he is far more often
       adjusting what is there than replacing it, and select-all means one
       stray keypress wipes it. */
    box.setSelectionRange(box.value.length, box.value.length);
  }

  /* Saves ONLY the prize wording. How many cards it takes is not on this row
     and is not sent -- the threshold is the system's shape, not something to
     nudge by accident while typing what a prize is. */
  async function saveTierInline(id) {
    const box = document.querySelector(`.tier-inline-input[data-id="${id}"]`);
    if (!box) return;
    const reward = box.value.trim();
    if (!reward) return sayR('Say what they get. Whatever you would say at the counter is fine.', true);

    sayR('Saving\u2026');
    try {
      const { error } = await sb().from('dex_reward_tiers').update({ reward }).eq('id', id);
      if (error) throw error;
      editingTier = '';
      sayR('Saved.');
      await loadTiers();
    } catch (err) {
      /* The row stays open with his words still in it. Losing them because
         the network blinked would be the worst thing this could do. */
      sayR('Could not save: ' + String(err.message || err), true);
    }
  }

  async function toggleTier(id) {
    const t = tiers.find((x) => x.id === id);
    if (!t) return;
    sayR('Saving\u2026');
    try {
      const { error } = await sb().from('dex_reward_tiers').update({ enabled: !t.enabled }).eq('id', id);
      if (error) throw error;
      sayR(t.enabled
        ? 'Turned off. Nobody new can reach it; anyone you have already paid out keeps that.'
        : 'Turned on.');
    } catch (err) {
      sayR('Could not save: ' + (err.message || err), true);
    }
    await loadTiers();
  }

  function openTierForm(t) {
    const f = $('dex-rewards-form');
    if (!f) return;
    f.hidden = false;
    f.reset();
    $('tier-form-id').value = '';
    $('tier-form-enabled').checked = true;
    if (t) {
      $('tier-form-id').value = t.id;
      $('tier-form-cards').value = t.cards_required;
      $('tier-form-reward').value = t.reward;
      $('tier-form-note').value = t.description || '';
      $('tier-form-enabled').checked = !!t.enabled;
    }
    f.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function saveTier(e) {
    e.preventDefault();
    if (busy) return;

    const id = $('tier-form-id').value || null;
    const n = Number($('tier-form-cards').value);
    const reward = $('tier-form-reward').value.trim();

    if (!Number.isInteger(n) || n < 1) return sayR('How many cards? A whole number, at least one.', true);
    if (!reward) return sayR('Say what they get. Whatever you would say at the counter is fine.', true);

    const max = reachableTotal();
    if (max > 0 && n > max && !confirm(
      'There are only ' + max + ' cards switched on right now, so nobody can reach ' + n + ' yet. Save it anyway?')) return;

    busy = true;
    sayR('Saving\u2026');
    try {
      const row = {
        cards_required: n,
        reward,
        description: $('tier-form-note').value.trim() || null,
        enabled: $('tier-form-enabled').checked,
        display_order: n
      };
      const client = sb();
      const { error } = id
        ? await client.from('dex_reward_tiers').update(row).eq('id', id)
        : await client.from('dex_reward_tiers').insert(row);
      if (error) throw error;
      sayR('Saved.');
      $('dex-rewards-form').hidden = true;
      await loadTiers();
    } catch (err) {
      const msg = String(err.message || err);
      if (/cards_required_key|duplicate key/i.test(msg)) {
        sayR('There is already a reward at ' + n + ' cards. Edit that one instead.', true);
      } else {
        sayR('Could not save: ' + msg, true);
      }
    } finally {
      busy = false;
    }
  }

  // ---- The counter ----
  //
  // A customer says a username. This looks them up, shows what they have
  // earned, and records it when it is handed over.
  //
  // Both halves are database functions (supabase/infinite_dex_redeem.sql),
  // not queries. Row-level security means this panel cannot read another
  // person's cards at all, and widening that policy to make this screen
  // work would expose every collection to every signed-in visitor. The
  // functions hand back only what a counter needs.
  //
  // The card count is checked again inside dex_redeem_reward at the moment
  // of handing over, so a number that has been sitting on screen for ten
  // minutes cannot pay out something that is not earned.

  let customer = null;

  function sayC(msg, bad) {
    const el = $('dex-redeem-status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = bad ? '#fca5a5' : '';
  }

  async function checkStaffLock() {
    const el = $('dex-staff-note');
    if (!el || !sb()) return;
    try {
      const { data, error } = await sb().from('shop_staff').select('user_id, label');
      if (error) throw error;
      el.textContent = (data && data.length)
        ? 'This counter is limited to ' + data.length + ' named staff account' + (data.length === 1 ? '' : 's') + '.'
        : 'Right now anyone signed in to this panel can look a customer up. See the top of supabase/infinite_dex_redeem.sql for the one line that limits it to named staff.';
    } catch (_) {
      el.textContent = '';
    }
  }

  async function lookupCustomer() {
    const name = ($('dex-redeem-username').value || '').trim();
    if (!name) return sayC('Ask them for their username first.', true);

    customer = null;
    renderCustomer();
    sayC('Looking\u2026');
    try {
      const { data, error } = await sb().rpc('dex_lookup_customer', { p_username: name });
      if (error) throw error;
      if (data.status === 'denied') return sayC('This account is not on the staff list for the counter.', true);
      if (data.status !== 'ok') {
        return sayC('No collector called "' + name + '". Check the spelling with them — it is the name on their Dex, not their email.', true);
      }
      customer = data;
      sayC('');
      renderCustomer();
    } catch (err) {
      sayC('Could not look that up: ' + (err.message || err), true);
    }
  }

  function renderCustomer() {
    const el = $('dex-redeem-result');
    if (!el) return;
    if (!customer) { el.innerHTML = ''; return; }

    const ready = customer.rewards.filter((r) => r.met && !r.redeemed_at);
    const done = customer.rewards.filter((r) => r.redeemed_at);
    const soon = customer.rewards.filter((r) => !r.met);

    el.innerHTML = `
      <div class="dex-customer">
        <strong>${esc(customer.username)}</strong>
        <span>${customer.cards} card${customer.cards === 1 ? '' : 's'} collected</span>
      </div>
      ${ready.length ? ready.map((r) => `
        <div class="info-row dex-row dex-redeem-row">
          <span class="dex-tier-n">${r.cards_required}</span>
          <span style="min-width:0; flex:1">
            <strong style="display:block">${esc(r.reward)}</strong>
            ${r.description ? `<small style="display:block; color:var(--muted)">${esc(r.description)}</small>` : ''}
          </span>
          <button type="button" class="primary-btn dex-redeem-btn" data-tier="${esc(r.tier_id)}" style="flex:0 0 auto; padding:8px 12px;">Mark given</button>
        </div>`).join('')
        : '<p class="dex-hint" style="margin-top:10px">Nothing waiting to be handed over right now.</p>'}

      ${done.length ? `<h3 class="dex-group">Already given</h3>` + done.map((r) => `
        <div class="info-row dex-row">
          <span class="dex-tier-n">${r.cards_required}</span>
          <span style="min-width:0; flex:1">
            <strong style="display:block">${esc(r.reward)}</strong>
            <small style="display:block; color:var(--muted)">${new Date(r.redeemed_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}${r.redeemed_by ? ' \u00b7 ' + esc(r.redeemed_by) : ''}</small>
          </span>
        </div>`).join('') : ''}

      ${soon.length ? `<h3 class="dex-group">Not there yet</h3>` + soon.map((r) => `
        <div class="info-row dex-row" style="opacity:.6">
          <span class="dex-tier-n">${r.cards_required}</span>
          <span style="min-width:0; flex:1">
            <strong style="display:block">${esc(r.reward)}</strong>
            <small style="display:block; color:var(--muted)">${r.cards_required - customer.cards} more card${r.cards_required - customer.cards === 1 ? '' : 's'} to go</small>
          </span>
        </div>`).join('') : ''}
    `;

    el.querySelectorAll('.dex-redeem-btn').forEach((b) =>
      b.addEventListener('click', () => redeem(b.dataset.tier, b)));
  }

  async function redeem(tierId, btn) {
    if (busy || !customer) return;
    busy = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }
    try {
      const { data, error } = await sb().rpc('dex_redeem_reward', {
        p_user: customer.user_id,
        p_tier: tierId,
        p_by: ($('dex-redeem-by').value || '').trim() || null,
        p_note: null
      });
      if (error) throw error;

      if (data.status === 'recorded') sayC('Marked given. It cannot be claimed again.');
      else if (data.status === 'already') sayC('That one was already given \u2014 nothing changed.');
      else if (data.status === 'not_earned') sayC('They are on ' + data.cards + ' cards and that one needs ' + data.needed + '. Nothing recorded.', true);
      else if (data.status === 'denied') sayC('This account is not on the staff list for the counter.', true);
      else sayC('That reward is not available any more.', true);

      // Re-read rather than patching what is on screen, so what he sees is
      // what the database actually holds.
      await lookupCustomerSilently();
    } catch (err) {
      sayC('Could not record that: ' + (err.message || err), true);
    } finally {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Mark given'; }
    }
  }

  async function lookupCustomerSilently() {
    if (!customer) return;
    try {
      const { data } = await sb().rpc('dex_lookup_customer', { p_username: customer.username });
      if (data && data.status === 'ok') { customer = data; renderCustomer(); }
    } catch (_) { /* the message from redeem() still stands */ }
  }

  // ---- Wiring ----

  function buildTriggerOptions() {
    const sel = $('dex-form-trigger');
    if (!sel) return;
    sel.innerHTML = TRIGGERS.map((t) =>
      `<option value="${t.key}">${esc(t.label)}${t.blind ? ' (app’s word)' : ''}</option>`).join('');
  }

  function init() {
    if (!$('dex-card')) return;

    buildTriggerOptions();

    $('dex-admin-new')?.addEventListener('click', () => openDexForm(null));
    $('dex-form-cancel')?.addEventListener('click', () => { $('dex-admin-form').hidden = true; say(''); });
    $('dex-admin-form')?.addEventListener('submit', saveDexCard);
    $('dex-form-series')?.addEventListener('change', syncFormVisibility);
    $('dex-form-award')?.addEventListener('change', syncFormVisibility);
    $('dex-form-trigger')?.addEventListener('change', syncFormVisibility);
    ['dex-form-name', 'dex-form-task', 'dex-form-flavor'].forEach((id) =>
      $(id)?.addEventListener('input', renderDexPreview));
    $('dex-form-rarity')?.addEventListener('change', renderDexPreview);
    $('dex-form-code')?.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });
    $('dex-form-code-word')?.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });
    $('dex-redeem-form')?.addEventListener('submit', (e) => { e.preventDefault(); lookupCustomer(); });
    $('dex-redeem-clear')?.addEventListener('click', () => {
      customer = null; renderCustomer(); sayC('');
      $('dex-redeem-username').value = '';
      $('dex-redeem-username').focus();
    });

    $('dex-rewards-new')?.addEventListener('click', () => openTierForm(null));
    $('dex-rewards-cancel')?.addEventListener('click', () => { $('dex-rewards-form').hidden = true; sayR(''); });
    $('dex-rewards-form')?.addEventListener('submit', saveTier);

    $('dex-form-art')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      const box = $('dex-form-preview');
      if (file && box) {
        box.dataset.preview = URL.createObjectURL(file);
        renderDexPreview();
      }
    });

    const client = sb();
    if (!client) {
      ['dex-card', 'dex-rewards-card', 'dex-redeem-card'].forEach((id) => {
        const card = $(id);
        if (card) card.innerHTML = '<h2>' + card.querySelector('h2').textContent + '</h2><p>Connect Supabase in config.js to enable this.</p>';
      });
      return;
    }

    // Cards first, then rewards -- the reward list needs to know how many
    // cards exist before it can tell him a tier is out of reach.
    const loadAll = async () => { await loadDexAdmin(); await loadTiers(); await checkStaffLock(); };
    client.auth.getSession().then(({ data }) => { if (data?.session) loadAll(); });
    client.auth.onAuthStateChange((_e, session) => { if (session) loadAll(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Exposed for the test harness, and for anything later that wants to
  // refresh this section without reloading the page.
  window.InfinitePullsDexAdmin = {
    load: loadDexAdmin,
    loadTiers,
    lookupCustomer,
    TRIGGERS,
    _internals: { toLocalInput, fromLocalInput, processArt }
  };
})();
