/* The Gallery tab — the half Jeff touches.
 *
 * THE ONE DESIGN RULE THIS FILE IS BUILT AROUND
 *
 * What makes a thing feel like a chore is not taps. It is DECISIONS. A
 * form with six fields feels like homework even when it takes twenty
 * seconds, because every blank box is a small "what do I put here?" and
 * that is the moment a busy man decides to do it later.
 *
 * So the whole flow is built to cost him ONE decision:
 *
 *     photo  →  tap a chip  →  tap the caption that made him laugh  →  Post it
 *                                        ↑
 *                            the only actual decision
 *
 * The slug, the page title, the alt text, the meta description, the three
 * social crops and the link preview card are all derived from that and he
 * never sees any of them. He can type his own caption if he wants — there
 * is a link for it — but it is never in his path.
 *
 * WHAT ELSE THAT RULE BUYS
 *
 * - NOTHING IS REQUIRED. A photo with no caption still publishes and still
 *   gets a decent page built around it.
 * - THE DRAFT SURVIVES A CUSTOMER. He will be interrupted mid-post every
 *   single time, so the photo and everything with it goes into IndexedDB
 *   as he works and is still sitting there an hour later.
 * - EVERYTHING IS EDITABLE AFTER PUBLISHING, with no confirmation
 *   dialogs. Much of "this seems like a lot of work" is really fear of
 *   getting it wrong. If it is trivially fixable, the stakes go to zero.
 *
 * THE TWO THINGS THAT ARE DELIBERATELY NOT EASY
 *
 * 1. THE PUSH NOTIFICATION. It cannot be recalled — that is the only
 *    genuinely irreversible thing in this whole feature — so it is a
 *    separate, deliberate button that appears after publishing and spends
 *    itself when used. His finger, his decision, once.
 *
 * 2. WRITING TONE. He picks from three; he does not get a "make it
 *    funnier" box. See supabase/gallery_caption.sql for why.
 *
 * ON THE LANGUAGE IN HERE
 *
 * Could, never should. Every number is a challenge and never a scold —
 * "three up this week, four has never been done" and never "you have not
 * posted since Tuesday". Nothing in this panel ever tells him he is
 * behind, because a panel that makes a man feel bad is a panel he stops
 * opening.
 */
(function () {
  'use strict';

  const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : null);

  const DB_NAME  = 'infinite-pulls-gallery';
  const DB_STORE = 'draft';
  const BUCKET   = 'gallery';

  const MIN_WORDS = 8;
  const MAX_WORDS = 18;

  // Fallback only. The real list is the `options` on the gallery-caption
  // prompt row, so the shop's categories can change without a deploy.
  const FALLBACK_CHIPS = [
    { id: 'just-pulled',  label: 'Just Pulled'  },
    { id: 'restock',      label: 'Restock'      },
    { id: 'case-break',   label: 'Case Break'   },
    { id: 'in-the-case',  label: 'In the Case'  },
    { id: 'store',        label: 'The Store'    },
    { id: 'event',        label: 'Event'        },
    { id: 'sold',         label: 'Sold'         }
  ];

  let chips = FALLBACK_CHIPS;
  let draft = null;          // { file, prepared, chips:[], caption, ... }
  let settings = null;

  /* ---------- tiny helpers ------------------------------------------- */

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const $ = (id) => document.getElementById(id);
  const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

  function say(el, message, tone) {
    if (!el) return;
    el.textContent = message || '';
    el.style.color = tone === 'bad' ? '#fca5a5' : tone === 'good' ? '#86efac' : '';
  }

  /* ---------- the draft, kept through interruptions -------------------- */

  /* IndexedDB rather than localStorage because the thing worth keeping is
   * the PHOTO, and a photo does not fit in localStorage. He gets
   * interrupted by a customer roughly every time; coming back to an empty
   * form is how a feature stops being used. */
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveDraft() {
    if (!draft) return;
    try {
      const db = await idb();
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({
        blob: draft.prepared ? draft.prepared.full : null,
        width: draft.prepared ? draft.prepared.width : null,
        height: draft.prepared ? draft.prepared.height : null,
        chips: draft.chips,
        caption: draft.caption,
        generated: draft.generated,
        savedAt: Date.now()
      }, 'current');
    } catch (_) { /* a draft that fails to save is not worth a message */ }
  }

  async function loadDraft() {
    try {
      const db = await idb();
      return await new Promise((resolve) => {
        const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get('current');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_) { return null; }
  }

  async function clearDraft() {
    try {
      const db = await idb();
      db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).delete('current');
    } catch (_) {}
  }

  /* ---------- the Master Switch ---------------------------------------- */

  async function loadSettings() {
    const client = sb();
    if (!client) return;
    const { data } = await client.from('gallery_settings').select('*').limit(1).maybeSingle();
    settings = data || null;
    paintSettings();
  }

  function paintSettings() {
    if (!settings) return;
    const set = (id, val) => { const el = $(id); if (el) el.checked = !!val; };
    set('gallery-on', settings.gallery_on);
    set('gallery-submissions-on', settings.submissions_on);
    set('gallery-captions-on', settings.captions_on);
    set('gallery-reactions-on', settings.reactions_on);
    set('gallery-hometile-on', settings.home_tile_on);
    const label = $('gallery-hometile-label');
    if (label) label.value = settings.home_tile_label || '';
    const blurb = $('gallery-submit-blurb');
    if (blurb) blurb.value = settings.submit_blurb || '';
  }

  async function saveSettings() {
    const client = sb();
    const status = $('gallery-master-status');
    if (!client) return;

    say(status, 'Saving…');
    const patch = {
      gallery_on:      $('gallery-on').checked,
      submissions_on:  $('gallery-submissions-on').checked,
      captions_on:     $('gallery-captions-on').checked,
      reactions_on:    $('gallery-reactions-on').checked,
      home_tile_on:    $('gallery-hometile-on').checked,
      home_tile_label: $('gallery-hometile-label').value.trim() || 'See what just landed',
      submit_blurb:    $('gallery-submit-blurb').value.trim()
    };

    const { error } = await client.from('gallery_settings').update(patch).eq('id', true);
    if (error) { say(status, 'That did not save. You could try once more.', 'bad'); return; }

    settings = Object.assign({}, settings, patch);
    say(status, 'Saved. Live for everyone now.', 'good');
    renderQueue();
  }

  /* ---------- chips ----------------------------------------------------- */

  async function loadChips() {
    const client = sb();
    if (!client) return;
    const { data } = await client.from('marketing_prompts')
      .select('options').eq('slug', 'gallery-caption').maybeSingle();
    if (data && Array.isArray(data.options) && data.options.length) {
      chips = data.options.map((o) => ({ id: o.id, label: o.label }));
    }
    paintChips();
  }

  function paintChips() {
    const row = $('gallery-chips');
    if (!row) return;
    const chosen = (draft && draft.chips) || [];
    row.innerHTML = chips.map((c) => `
      <button type="button" class="gallery-chip${chosen.includes(c.id) ? ' is-on' : ''}"
              data-chip="${esc(c.id)}">${esc(c.label)}</button>`).join('');
  }

  /* ---------- picking a photo -------------------------------------------- */

  async function onPhotoChosen(file) {
    const status = $('gallery-post-status');
    if (!file) return;

    say(status, 'Making it look good…');
    try {
      const prepared = await window.InfinitePullsGalleryImage.prepare(file, {});
      draft = draft || { chips: [], caption: '', generated: null };
      draft.prepared = prepared;
      showPreview(prepared.full);
      say(status, '');
      await saveDraft();
      refreshPostCard();
    } catch (err) {
      say(status, 'That picture could not be read. Another one could work.', 'bad');
    }
  }

  function showPreview(blob) {
    const wrap = $('gallery-preview');
    if (!wrap) return;
    const url = URL.createObjectURL(blob);
    wrap.innerHTML = `<img src="${url}" alt="">`;
    wrap.hidden = false;
  }

  /* ---------- captions ---------------------------------------------------- */

  async function writeCaptions() {
    const client = sb();
    const status = $('gallery-post-status');
    const box = $('gallery-caption-options');
    if (!client || !draft || !draft.prepared) {
      say(status, 'Add a photo first and this lights up.');
      return;
    }

    say(status, 'Writing three…');
    box.innerHTML = '';

    // The caption writer needs a URL it can fetch, so the photo goes up
    // first. It is going up anyway when he publishes — doing it now just
    // moves the wait to where he is already waiting.
    try {
      if (!draft.uploaded) draft.uploaded = await uploadAll();

      const { data: sess } = await client.auth.getSession();
      const token = sess && sess.session && sess.session.access_token;

      const res = await client.functions.invoke('gallery-caption', {
        body: {
          image_url: draft.uploaded.full,
          chips: draft.chips,
          keyword: ($('gallery-keyword').value || '').trim(),
          notes: ''
        },
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (res.error || (res.data && res.data.error)) {
        say(status, 'No captions this time. You could write one below, or try again.', 'bad');
        showOwnWords();
        return;
      }

      draft.generated = res.data;
      say(status, '');
      paintCaptionOptions(res.data);
      await saveDraft();
    } catch (err) {
      say(status, 'No captions this time. You could write one below, or try again.', 'bad');
      showOwnWords();
    }
  }

  function paintCaptionOptions(result) {
    const box = $('gallery-caption-options');
    if (!box) return;
    box.innerHTML = `
      <p class="gallery-pick-hint">Pick the one that made you laugh.</p>
      ${result.captions.map((c, i) => `
        <button type="button" class="gallery-option" data-caption="${i}">
          <span class="gallery-option-text">${esc(c.text)}</span>
          <span class="gallery-option-meta">${esc(c.words)} words</span>
        </button>`).join('')}
      <button type="button" class="gallery-own-link" id="gallery-own">Say it your way instead</button>`;
    box.hidden = false;
  }

  function showOwnWords() {
    const box = $('gallery-own-wrap');
    if (box) box.hidden = false;
    const ta = $('gallery-own-text');
    if (ta) ta.focus();
  }

  function chooseCaption(index) {
    if (!draft || !draft.generated) return;
    const chosen = draft.generated.captions[index];
    if (!chosen) return;
    draft.caption = chosen.text;

    document.querySelectorAll('.gallery-option').forEach((b, i) => {
      b.classList.toggle('is-on', i === index);
    });
    refreshPostCard();
    saveDraft();
  }

  /* ---------- publishing --------------------------------------------------- */

  async function uploadAll() {
    const client = sb();
    const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    const base = `shop/${id}`;
    const p = draft.prepared;

    async function put(name, blob) {
      if (!blob) return null;
      const path = `${base}/${name}.jpg`;
      const { error } = await client.storage.from(BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;
      return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    }

    return {
      full:   await put('full',   p.full),
      square: await put('square', p.square),
      story:  await put('story',  p.story),
      og:     await put('og',     p.og)
    };
  }

  async function publish() {
    const client = sb();
    const status = $('gallery-post-status');
    if (!client || !draft || !draft.prepared) {
      say(status, 'Add a photo and this lights up.');
      return;
    }

    const btn = $('gallery-publish');
    if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
    say(status, 'Posting…');

    try {
      if (!draft.uploaded) draft.uploaded = await uploadAll();

      const own = ($('gallery-own-text') && $('gallery-own-text').value || '').trim();
      const caption = own || draft.caption || '';
      const gen = draft.generated || {};
      const keyword = ($('gallery-keyword').value || '').trim();

      // Nothing is required. If he posted a bare photo, the page still gets
      // a sensible title and address built from whatever is here.
      const seed = gen.slug || keyword || caption || (draft.chips[0] || 'photo');
      const { data: slug } = await client.rpc('gallery_unique_slug', { raw: seed });

      const row = {
        slug: slug || ('photo-' + Date.now().toString(36)),
        title: gen.title || keyword || 'Infinite Pulls',
        caption,
        alt_text: gen.alt_text || keyword || 'A photo from Infinite Pulls',
        meta_description: gen.meta_description || caption || '',
        keyword,
        chips: draft.chips,
        image_url: draft.uploaded.full,
        image_square_url: draft.uploaded.square,
        image_story_url: draft.uploaded.story,
        image_og_url: draft.uploaded.og,
        image_width: draft.prepared.width,
        image_height: draft.prepared.height,
        source: 'shop',
        status: 'published'
      };

      const { data: saved, error } = await client.from('gallery_items')
        .insert(row).select().single();
      if (error) throw error;

      showPublished(saved, gen.hashtags || []);
      await clearDraft();
      draft = null;
      renderQueue();
    } catch (err) {
      say(status, 'That did not go up. Everything is still here — you could try again.', 'bad');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Post it'; }
    }
  }

  /* What he sees the moment it is live. The link first, because sharing it
   * is the next thing he does, and the crops next, because they are the
   * part that surprises him. */
  function showPublished(item, hashtags) {
    const wrap = $('gallery-published');
    if (!wrap) return;

    const url = location.origin + '/pulls/' + item.slug;
    wrap.innerHTML = `
      <div class="gallery-done">
        <strong>That is live.</strong>
        <div class="gallery-link-row">
          <input type="text" id="gallery-live-link" readonly value="${esc(url)}">
          <button type="button" class="secondary-btn" id="gallery-copy-link">Copy</button>
        </div>
        <p class="gallery-done-note">The link preview builds itself in about a minute.
          Paste it into Facebook after that and it arrives as a proper card.</p>

        <div class="gallery-done-actions">
          <button type="button" class="secondary-btn" data-save="square">Save the square one</button>
          <button type="button" class="secondary-btn" data-save="story">Save the story one</button>
        </div>

        ${hashtags && hashtags.length ? `
          <label>Hashtags for Instagram
            <textarea id="gallery-tags" rows="2" readonly>${esc(hashtags.map((h) => '#' + h).join(' '))}</textarea>
          </label>` : ''}

        <div class="gallery-notify">
          <button type="button" class="primary-btn" id="gallery-notify" data-slug="${esc(item.slug)}">
            📣 Let them know about this
          </button>
          <p class="gallery-notify-note">Goes to every phone that has notifications on.
            It cannot be recalled, and it works once.</p>
        </div>
        <div id="gallery-notify-status" class="save-status"></div>
      </div>`;
    wrap.hidden = false;

    // The crops were made in the browser and are still in memory, which is
    // why saving them is instant and needs no round trip.
    const prepared = (draft && draft.prepared) || null;
    wrap.querySelectorAll('[data-save]').forEach((b) => {
      b.addEventListener('click', () => {
        const which = b.dataset.save;
        const blob = prepared && prepared[which];
        if (!blob) { b.textContent = 'That one is on the site'; return; }
        window.InfinitePullsGalleryImage.download(blob, `infinite-pulls-${item.slug}-${which}.jpg`);
      });
    });

    const copy = $('gallery-copy-link');
    if (copy) copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
      } catch (_) { $('gallery-live-link').select(); }
    });

    const notify = $('gallery-notify');
    if (notify) notify.addEventListener('click', () => sendNotify(item, notify));

    resetPostCard();
  }

  /* The one genuinely irreversible thing in the whole feature. One tap,
   * spent afterwards, and the button says so rather than pretending it
   * could be taken back. */
  async function sendNotify(item, btn) {
    const client = sb();
    const status = $('gallery-notify-status');
    if (!client) return;

    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const res = await client.functions.invoke('send-notification', {
        body: {
          title: 'Infinite Pulls',
          body: item.caption || item.title || 'Something new at the shop.',
          url: '/pulls/' + item.slug
        }
      });
      if (res.error || (res.data && res.data.error)) throw new Error('failed');

      await client.from('gallery_items').update({ notified_at: new Date().toISOString() })
        .eq('id', item.id);

      btn.textContent = 'Sent';
      say(status, 'Out to every phone with notifications on.', 'good');
    } catch (_) {
      btn.disabled = false;
      btn.textContent = '📣 Let them know about this';
      say(status, 'That did not send. It could work on a second try.', 'bad');
    }
  }

  function resetPostCard() {
    const preview = $('gallery-preview');
    if (preview) { preview.innerHTML = ''; preview.hidden = true; }
    const opts = $('gallery-caption-options');
    if (opts) { opts.innerHTML = ''; opts.hidden = true; }
    const own = $('gallery-own-wrap');
    if (own) own.hidden = true;
    const ownText = $('gallery-own-text');
    if (ownText) ownText.value = '';
    const kw = $('gallery-keyword');
    if (kw) kw.value = '';
    draft = null;
    paintChips();
    refreshPostCard();
  }

  /* ---------- backing out ---------------------------------------------- */

  /* The way out. It publishes nothing and saves nothing — it only puts the
   * card back the way he found it, and throws the kept draft away so the
   * next visit does not hand the discarded photo back to him. */
  /* START OVER. No confirm, deliberately -- changed 3 Sep 2026.

     It used to ask "Discard this post?" first. A confirm earns its place when
     the mistake is expensive to undo, and this one is not: what it throws
     away is a photo he has already decided against and, at worst, a caption
     he can get back by tapping the same chip again. Set against that, every
     dialog is a sentence to read, a decision to make, and somewhere to
     freeze -- and freezing is the thing that actually costs him time. */
  function cancelPost() {
    clearDraft();
    resetPostForm();
    say($('gallery-post-status'), 'Cleared. Add another photo when you are ready.');
  }

  function resetPostForm() {
    draft = null;

    /* One input since 3 Sep 2026 -- the camera/library choice belongs to the
       phone's own sheet, not to two buttons on this card. */
    const chooser = $('gallery-file');
    if (chooser) chooser.value = '';

    const preview = $('gallery-preview');
    if (preview) { preview.innerHTML = ''; preview.hidden = true; }

    const keyword = $('gallery-keyword');
    if (keyword) keyword.value = '';

    const options = $('gallery-caption-options');
    if (options) { options.innerHTML = ''; options.hidden = true; }

    const ownWrap = $('gallery-own-wrap');
    if (ownWrap) ownWrap.hidden = true;
    const ownText = $('gallery-own-text');
    if (ownText) ownText.value = '';
    say($('gallery-own-count'), '');

    const published = $('gallery-published');
    if (published) { published.innerHTML = ''; published.hidden = true; }

    paintChips();          // repaints with nothing selected, since draft is null
    refreshPostCard();
  }

  function refreshPostCard() {
    const has = !!(draft && draft.prepared);
    const publishBtn = $('gallery-publish');
    if (publishBtn) publishBtn.disabled = !has;
    const writeBtn = $('gallery-write');
    if (writeBtn) writeBtn.disabled = !has;
  }

  /* ---------- the queue and the numbers ------------------------------------ */

  async function renderQueue() {
    const client = sb();
    const pendingWrap = $('gallery-pending');
    const liveWrap = $('gallery-recent');
    if (!client) return;

    // --- waiting for him ---
    const { data: pending } = await client.from('gallery_items')
      .select('id, slug, caption, image_url, submitted_name, created_at')
      .eq('status', 'pending').order('created_at', { ascending: true }).limit(30);

    if (pendingWrap) {
      if (!pending || !pending.length) {
        pendingWrap.innerHTML = settings && settings.submissions_on
          ? '<div class="empty-state">Nothing waiting. Everything customers have sent is dealt with.</div>'
          : '<div class="empty-state">Customer submissions are switched off up above. Nothing can arrive here until they are on.</div>';
      } else {
        pendingWrap.innerHTML = pending.map((p) => `
          <div class="gallery-queue-row" data-id="${esc(p.id)}">
            <img src="${esc(p.image_url)}" alt="">
            <div class="gallery-queue-body">
              <strong>${esc(p.submitted_name || 'A customer')}</strong>
              <small>${esc(p.caption || 'No caption sent')}</small>
            </div>
            <div class="gallery-queue-actions">
              <button type="button" class="primary-btn" data-approve="${esc(p.id)}">Put it up</button>
              <button type="button" class="secondary-btn" data-reject="${esc(p.id)}">Not this one</button>
            </div>
          </div>`).join('');
      }
    }

    // --- what he posted, and what it did ---
    const { data: live } = await client.from('gallery_items')
      .select('id, slug, caption, image_url, image_square_url, view_count, share_count, reaction_count, published_at, notified_at')
      .eq('status', 'published').order('published_at', { ascending: false }).limit(12);

    if (liveWrap) {
      if (!live || !live.length) {
        liveWrap.innerHTML = '<div class="empty-state">Nothing up yet. The first one could go up in about ten seconds.</div>';
      } else {
        liveWrap.innerHTML = `
          ${streakLine(live)}
          ${live.map((p) => `
            <div class="gallery-queue-row">
              <img src="${esc(p.image_square_url || p.image_url)}" alt="">
              <div class="gallery-queue-body">
                <small>${esc(p.caption || '(no caption)')}</small>
                <strong class="gallery-numbers">
                  ${esc(p.view_count || 0)} looked
                  · ${esc(p.reaction_count || 0)} liked
                  · ${esc(p.share_count || 0)} shared
                </strong>
              </div>
              <div class="gallery-queue-actions">
                <a class="secondary-btn" href="/pulls/${esc(p.slug)}" target="_blank" rel="noopener">Open</a>
                <button type="button" class="secondary-btn" data-hide="${esc(p.id)}">Take down</button>
              </div>
            </div>`).join('')}`;
      }
    }
  }

  /* A challenge, never a scold. It counts UP from what he has done and
   * never mentions a gap, a streak he broke, or a day he missed. The
   * best photo's number is there to be beaten, not lived up to. */
  function streakLine(live) {
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const thisWeek = live.filter((p) => new Date(p.published_at).getTime() > weekAgo).length;
    const best = live.reduce((a, b) => ((b.view_count || 0) > (a.view_count || 0) ? b : a), live[0]);

    const parts = [];
    if (thisWeek > 0) {
      parts.push(thisWeek === 1
        ? 'One up this week. Two has a nice ring to it.'
        : `${thisWeek} up this week.`);
    }
    if (best && best.view_count > 0) {
      parts.push(`Best one so far pulled ${best.view_count} looks. That number is beatable.`);
    }
    if (!parts.length) return '';
    return `<p class="gallery-streak">${esc(parts.join(' '))}</p>`;
  }

  async function moderate(id, nextStatus) {
    const client = sb();
    if (!client) return;
    await client.from('gallery_items').update({ status: nextStatus }).eq('id', id);
    renderQueue();
  }

  /* ---------- wiring --------------------------------------------------------- */

  function wire() {
    const card = $('gallery-post-card');
    if (!card) return;

    /* One input, one handler. It carries no `capture`, so the phone offers
       the library and the camera itself -- see the comment in index.html. */
    const chooser = $('gallery-file');
    if (chooser) {
      chooser.addEventListener('change', () => {
        const f = chooser.files && chooser.files[0];
        onPhotoChosen(f);
        chooser.value = '';
      });
    }

    const chipRow = $('gallery-chips');
    if (chipRow) chipRow.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-chip]');
      if (!btn) return;
      draft = draft || { chips: [], caption: '', generated: null };
      const id = btn.dataset.chip;
      const i = draft.chips.indexOf(id);
      if (i === -1) draft.chips.push(id); else draft.chips.splice(i, 1);
      btn.classList.toggle('is-on');
      saveDraft();
    });

    const write = $('gallery-write');
    if (write) write.addEventListener('click', writeCaptions);

    const opts = $('gallery-caption-options');
    if (opts) opts.addEventListener('click', (e) => {
      if (e.target.closest('#gallery-own')) { showOwnWords(); return; }
      const b = e.target.closest('[data-caption]');
      if (b) chooseCaption(Number(b.dataset.caption));
    });

    const own = $('gallery-own-text');
    if (own) own.addEventListener('input', () => {
      const n = words(own.value);
      const note = $('gallery-own-count');
      if (!note) return;
      if (!n) { say(note, ''); return; }
      // A count, and a nudge that is never a telling-off.
      if (n < MIN_WORDS)      say(note, `${n} words — a couple more could land it better.`);
      else if (n > MAX_WORDS) say(note, `${n} words — Facebook folds anything past about 18 behind "See More".`);
      else                    say(note, `${n} words. That is the sweet spot.`, 'good');
    });

    const publishBtn = $('gallery-publish');
    if (publishBtn) publishBtn.addEventListener('click', publish);

    const cancelBtn = $('gallery-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', cancelPost);

    const save = $('gallery-master-save');
    if (save) save.addEventListener('click', saveSettings);

    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-approve]');
      if (a) { moderate(a.dataset.approve, 'published'); return; }
      const r = e.target.closest('[data-reject]');
      // Trashed, not deleted — it sits recoverable for 30 days, because it
      // is somebody else's photo and they may not have another copy.
      if (r) { moderate(r.dataset.reject, 'trashed'); return; }
      const h = e.target.closest('[data-hide]');
      if (h) { moderate(h.dataset.hide, 'hidden'); }
    });

    refreshPostCard();
  }

  async function restoreDraft() {
    const saved = await loadDraft();
    if (!saved || !saved.blob) return;

    draft = {
      chips: saved.chips || [],
      caption: saved.caption || '',
      generated: saved.generated || null,
      prepared: null
    };

    // Re-derive the crops from the saved photo so a restored draft is a
    // whole draft, not a picture with half its outputs missing.
    try {
      const img = await window.InfinitePullsGalleryImage.fileToImage(
        new File([saved.blob], 'draft.jpg', { type: 'image/jpeg' }));
      draft.prepared = {
        full: saved.blob, width: saved.width, height: saved.height,
        square: await window.InfinitePullsGalleryImage.crop(img, window.InfinitePullsGalleryImage.SIZES.square, {}),
        story:  await window.InfinitePullsGalleryImage.crop(img, window.InfinitePullsGalleryImage.SIZES.story,  {}),
        og:     await window.InfinitePullsGalleryImage.crop(img, window.InfinitePullsGalleryImage.SIZES.og,     {})
      };
      showPreview(saved.blob);
      if (draft.generated) paintCaptionOptions(draft.generated);
      paintChips();
      refreshPostCard();
      say($('gallery-post-status'), 'Picked up where you left off.');
    } catch (_) {
      draft = null;
    }
  }

  async function init() {
    if (!$('gallery-post-card')) return;
    wire();
    await Promise.all([loadSettings(), loadChips()]);
    await restoreDraft();
    renderQueue();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.InfinitePullsGalleryAdmin = { init, renderQueue, loadSettings };
})();
