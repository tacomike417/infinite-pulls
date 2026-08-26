/* Collection importer, part 3 of 5: the screen.
 *
 * Chunk 1 reads the file, chunk 2 works out which cards it means, and
 * this is what a customer actually sees and touches. It owns the whole
 * flow from "choose a file" to "added 412 cards", and it is the only one
 * of the three that writes anything to the database.
 *
 *
 * THE THREE STEPS, AND WHY THERE ARE THREE
 *
 *   1. PICK      a file, or paste a spreadsheet
 *   2. CHECK     the columns we guessed, before anything is looked up
 *   3. REVIEW    what is about to be added, and fix what we were unsure of
 *
 * Step 2 is the one it would be tempting to skip, and skipping it is what
 * makes importers untrustworthy. We cannot know what somebody's homemade
 * spreadsheet means — chunk 1 guesses from the header names and is right
 * most of the time, but "most of the time" is not good enough when the
 * cost of being wrong is a stranger's collection. Showing the guess and
 * letting them correct it takes five seconds and removes the whole class
 * of problem.
 *
 * Step 3 exists because chunk 2 refuses to guess. Anything it was not
 * sure about arrives here with a plain-English reason attached, and
 * nothing in that pile is added unless a person says so.
 *
 *
 * WHAT IT WRITES
 *
 * Exactly what tapping Add already writes, row for row, and it obeys the
 * same merge rule: a card you already own in the SAME printing and the
 * SAME condition has its quantity bumped rather than gaining a second
 * identical line. A near-mint holo and a played reverse stay separate,
 * because they are genuinely different holdings.
 *
 * Which means importing the same file twice does NOT double somebody's
 * collection into a mess — it just puts the counts up, which is at least
 * an honest mistake and one they can see and undo.
 */
(function () {
  'use strict';

  const client = () => window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  const Parse = () => window.InfinitePullsImportParse;
  const Resolve = () => window.InfinitePullsImportResolve;

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  // The tables this can fill. Sealed product is deliberately absent —
  // it is a different shape of thing and no export contains it.
  const TABLES = {
    collection: { table: 'user_cards', noun: 'collection' },
    wishlist:   { table: 'wishlist_cards', noun: 'wish list' }
  };

  // Fields the customer can point a column at, in the order they matter.
  const FIELDS = [
    ['quantity',  'How many',      'How many copies of this card.'],
    ['name',      'Card name',     'Used to check we found the right card.'],
    ['number',    'Card number',   'The collector number — 4/102, or just 4.'],
    ['setName',   'Set',           'Which set the card is from.'],
    ['setCode',   'Set code',      'The short code — BS, SVI, PRE.'],
    ['printing',  'Printing',      'Normal, holofoil, reverse holofoil.'],
    ['condition', 'Condition',     'Near Mint, Lightly Played, and so on.'],
    ['language',  'Language',      'English unless it says otherwise.'],
    ['grade',     'Grade',         'PSA 10, BGS 9.5 — noted, but not stored yet.'],
    ['price',     'Price',         'Only used to show you a total. Never saved.'],
    ['rarity',    'Rarity',        'Carried through if it is there.'],
    ['productId', 'Product ID',    'TCGplayer’s own id, if the file has one.']
  ];

  // How many rows go into one insert. Big enough that a large import is a
  // handful of requests, small enough that a failure loses little.
  const WRITE_BATCH = 200;

  // Columns the database may not have if an older schema is in place.
  // Same fallback collection.js does on a normal add.
  const NEW_COLUMNS = ['card_lang', 'dex_id', 'set_id'];

  let state = null;

  // ================================================================
  // THE SHELL
  // ================================================================

  function close() {
    document.body.classList.remove('import-open');
    const el = document.getElementById('import-overlay');
    if (el) el.remove();
    document.removeEventListener('keydown', onKey);
    state = null;
  }

  function onKey(e) {
    if (e.key === 'Escape' && state && !state.busy) close();
  }

  function shell(bodyHtml, opts) {
    const o = opts || {};
    let el = document.getElementById('import-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'import-overlay';
      el.className = 'import-overlay';
      document.body.appendChild(el);
      document.body.classList.add('import-open');
      document.addEventListener('keydown', onKey);
    }
    el.innerHTML = `
      <div class="import-sheet" role="dialog" aria-modal="true" aria-label="Import your collection">
        <header class="import-head">
          <div>
            <div class="eyebrow">Import${o.step ? ' · Step ' + o.step + ' of 3' : ''}</div>
            <h2>${esc(o.title || 'Bring your collection in')}</h2>
          </div>
          <button type="button" class="import-x" id="import-close" aria-label="Close">✕</button>
        </header>
        <div class="import-body">${bodyHtml}</div>
        ${o.footer ? `<footer class="import-foot">${o.footer}</footer>` : ''}
      </div>`;
    document.getElementById('import-close').addEventListener('click', () => {
      if (state && state.busy) return;
      close();
    });
    return el;
  }

  const say = (msg, kind) => {
    const el = document.getElementById('import-status');
    if (el) el.innerHTML = msg ? `<span class="import-note ${kind || ''}">${msg}</span>` : '';
  };

  // ================================================================
  // STEP 1 — PICK
  // ================================================================

  function stepPick() {
    shell(`
      <p class="import-lede">
        Most collection apps can export a spreadsheet. Bring that file here and
        we will match it up against the real cards — you get to check our work
        before anything is added.
      </p>

      <div class="import-choice">
        <label class="import-drop" for="import-file">
          <span class="import-drop-icon">⇪</span>
          <strong>Choose a file</strong>
          <small>CSV, TSV or a plain text table</small>
          <input type="file" id="import-file" accept=".csv,.tsv,.txt,.tab,text/csv,text/plain" hidden>
        </label>

        <div class="import-or">or paste it</div>

        <div class="import-paste">
          <label for="import-paste-box"><strong>Paste a spreadsheet</strong>
            <small>Select the rows in Excel or Google Sheets, copy, and paste them here.</small>
          </label>
          <textarea id="import-paste-box" rows="6" spellcheck="false" placeholder="Quantity,Name,Set,Card Number
2,Charizard,Base Set,4/102"></textarea>
        </div>
      </div>

      <p id="import-status"></p>

      <details class="import-help">
        <summary>Where do I get a file?</summary>
        <ul>
          <li><strong>Collectr</strong> — Portfolio, the three dots, Export. It is emailed to you. Needs PRO.</li>
          <li><strong>TCGplayer app</strong> — export from the mobile app, not the website.</li>
          <li><strong>TCG Collector</strong> and <strong>CollX</strong> — export is a paid feature on both.</li>
          <li><strong>Dex</strong> — Settings, Data, Export Collection. iPhone only.</li>
          <li><strong>Your own spreadsheet</strong> — works fine. It just needs a header row
              naming the columns, and at least a card name or a card number.</li>
        </ul>
      </details>
    `, {
      title: 'Bring your collection in',
      step: 1,
      // The action lives in the footer on every step, so "what now?" has
      // the same answer every time. Off until there is something to act
      // on — a dead button that tells you why beats a live one that
      // scolds you after you press it.
      footer: `<span class="import-foot-hint" id="import-foot-hint">Choose a file, or paste your list above.</span>
               <button type="button" class="primary-btn" id="import-paste-go" disabled>Continue</button>`
    });

    const box = document.getElementById('import-paste-box');
    const go = document.getElementById('import-paste-go');
    const hint = document.getElementById('import-foot-hint');

    const refresh = () => {
      const has = box.value.trim().length > 0;
      go.disabled = !has;
      hint.textContent = has ? '' : 'Choose a file, or paste your list above.';
    };

    // A stale complaint about the last thing they pasted, sitting over
    // the new thing they just pasted, is how somebody decides a screen is
    // broken. It goes the moment they touch the box.
    box.addEventListener('input', () => { say(''); refresh(); });
    box.addEventListener('paste', () => setTimeout(() => { say(''); refresh(); }, 0));
    refresh();

    go.addEventListener('click', () => {
      const text = box.value;
      if (!text.trim()) return;
      read(text, 'what you pasted');
    });

    document.getElementById('import-file').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      say('');
      if (f.size > 8 * 1024 * 1024) { say('That file is bigger than 8MB — is it definitely a spreadsheet?', 'bad'); return; }
      try { read(await f.text(), f.name); }
      catch (_) { say('Could not read that file.', 'bad'); }
    });
  }

  function read(text, label) {
    const P = Parse();
    if (!P) { say('The importer did not load properly — try reloading the page.', 'bad'); return; }

    if (!P.looksLikeTable(text)) {
      say('That does not look like a table — it needs a header row and at least two columns. ' +
          'A plain typed list is coming in a later update.', 'bad');
      return;
    }
    const parsed = P.parse(text);
    if (!parsed.ok || !parsed.rows.length) { say('There were no rows in that.', 'bad'); return; }

    state.source = label;
    state.text = text;
    state.parsed = parsed;
    stepColumns();
  }

  // ================================================================
  // STEP 2 — CHECK THE COLUMNS
  //
  // This step is shown YOUR columns, not our field names. You recognise
  // your own header row; you should not have to decode ours to check our
  // work. Each column is one capsule carrying three things — what the
  // header says, what we think it means, and the first real value in it —
  // because the sample is usually what makes it obvious at a glance that
  // we got it right.
  //
  // No dropdowns. A dropdown is a form, and a form is something you fill
  // in rather than something you check. The whole step has to survive a
  // ten-second glance: if every capsule reads correctly you press the
  // button and never touch one. Changing a capsule is one tap, and it
  // opens a row of chips, not a menu.
  //
  // The ✕ needs the confirm because it is the only destructive thing on
  // the screen. Dropping the card number by accident does not fail
  // loudly — it quietly turns a clean import into a pile of guesses.
  // ================================================================

  const FIELD_LABEL = {};
  FIELDS.forEach(([f, l]) => { FIELD_LABEL[f] = l; });

  const flat = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const same = (a, b) => flat(a) === flat(b);

  /* One capsule per column in their file, with our guess attached. */
  function buildCols(p) {
    const owner = {};
    Object.keys(p.mapping).forEach((f) => { owner[p.mapping[f]] = f; });

    const firstValue = (i) => {
      for (const r of p.rows.slice(0, 25)) {
        const v = String(r.raw[i] == null ? '' : r.raw[i]).trim();
        if (v) return v.length > 22 ? v.slice(0, 21) + '…' : v;
      }
      return '';
    };

    return p.headers.map((h, i) => ({
      i,
      header: (h || '').trim() || 'Column ' + (i + 1),
      field: owner[i] || null,
      sample: firstValue(i)
    }));
  }

  function capsuleHtml(c) {
    if (state.confirming === c.i) {
      // No sentence here on purpose. "Set — Leave it out / Keep it" is
      // the whole question, and two buttons ask it faster than a line of
      // text they would have to read first.
      return `
        <li class="import-cap is-confirm">
          <span class="import-cap-head">${esc(c.header)}</span>
          <span class="import-cap-confirm-btns">
            <button type="button" class="import-mini" data-yes="${c.i}">Leave it out</button>
            <button type="button" class="import-mini is-ghost" data-no="${c.i}">Keep it</button>
          </span>
        </li>`;
    }

    const on = !!c.field;
    // If their header already says what we made of it — "Condition" read
    // as Condition — repeating it back is noise that buries the capsules
    // where we actually decided something.
    const echo = on && same(c.header, FIELD_LABEL[c.field]);
    return `
      <li class="import-cap${on ? ' is-on' : ' is-off'}">
        <button type="button" class="import-cap-body" data-open="${c.i}">
          <span class="import-cap-head">${esc(c.header)}</span>
          ${echo ? '' : `<span class="import-cap-role">${on ? esc(FIELD_LABEL[c.field]) : 'not used'}</span>`}
          ${c.sample ? `<span class="import-cap-eg">${esc(c.sample)}</span>` : ''}
        </button>
        ${on
          ? `<button type="button" class="import-cap-x" data-x="${c.i}" aria-label="Leave out ${esc(c.header)}">✕</button>`
          : `<button type="button" class="import-cap-add" data-open="${c.i}" aria-label="Use ${esc(c.header)}">＋</button>`}
      </li>`;
  }

  /* The chips that open under a capsule you tapped. A field another
   * column already holds is shown as taken rather than hidden — you can
   * still choose it, and it moves, which is what somebody fixing a
   * wrong guess actually means.
   */
  function pickerHtml(c) {
    const takenBy = {};
    state.cols.forEach((x) => { if (x.field && x.i !== c.i) takenBy[x.field] = x.header; });

    return `
      <li class="import-picker">
        <p class="import-picker-q"><strong>${esc(c.header)}</strong>${c.sample ? ` <span class="import-cap-eg">${esc(c.sample)}</span>` : ''} is…</p>
        <div class="import-chips">
          ${FIELDS.map(([f, l]) => `
            <button type="button" class="import-chip${c.field === f ? ' is-on' : ''}${takenBy[f] ? ' is-taken' : ''}"
                    data-set="${c.i}" data-field="${esc(f)}"
                    ${takenBy[f] ? `title="Currently ${esc(takenBy[f])}"` : ''}>${esc(l)}</button>`).join('')}
          <button type="button" class="import-chip is-none" data-set="${c.i}" data-field="">Not used</button>
        </div>
      </li>`;
  }

  function drawColumns() {
    const list = document.getElementById('import-caps');
    if (!list) return;
    list.innerHTML = state.cols.map((c) =>
      capsuleHtml(c) + (state.open === c.i ? pickerHtml(c) : '')).join('');

    const redraw = () => drawColumns();

    list.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
      const at = Number(b.dataset.open);
      state.open = state.open === at ? null : at;
      state.confirming = null;
      redraw();
    }));

    list.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => {
      state.confirming = Number(b.dataset.x);
      state.open = null;
      redraw();
    }));

    list.querySelectorAll('[data-yes]').forEach((b) => b.addEventListener('click', () => {
      const at = Number(b.dataset.yes);
      const col = state.cols.find((c) => c.i === at);
      if (col) col.field = null;
      state.confirming = null;
      redraw();
      summarise();
    }));

    list.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', () => {
      state.confirming = null;
      redraw();
    }));

    list.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
      const at = Number(b.dataset.set);
      const field = b.dataset.field || null;
      // A field belongs to exactly one column. Choosing one that another
      // column holds moves it rather than duplicating it.
      if (field) state.cols.forEach((c) => { if (c.field === field) c.field = null; });
      const col = state.cols.find((c) => c.i === at);
      if (col) col.field = field;
      state.open = null;
      redraw();
      summarise();
    }));

    summarise();
  }

  /* The one line that tells somebody whether they can just press the
   * button, without reading a single capsule. */
  function summarise() {
    const el = document.getElementById('import-caps-note');
    if (!el) return;
    const used = state.cols.filter((c) => c.field).length;
    const out = state.cols.length - used;
    const need = state.cols.some((c) => c.field === 'name' || c.field === 'number');
    el.innerHTML = need
      ? `Using <strong>${used}</strong> of your ${state.cols.length} columns${out ? `, leaving ${out} out` : ''}. Tap any one to change it.`
      : `<span class="import-note bad">Nothing here says which card a row is. Set one column to Card name or Card number.</span>`;
    const go = document.getElementById('import-go');
    if (go) go.disabled = !need;
  }

  function stepColumns() {
    const p = state.parsed;
    if (!state.cols || state.colsFor !== p) { state.cols = buildCols(p); state.colsFor = p; }
    state.open = null;
    state.confirming = null;

    shell(`
      <p class="import-lede">
        We read <strong>${p.rows.length}</strong> row${p.rows.length === 1 ? '' : 's'} from ${esc(state.source)}.
        Here is what we made of your columns — check it before we look anything up.
      </p>

      <ul class="import-caps" id="import-caps"></ul>
      <p class="import-caps-note" id="import-caps-note"></p>

      <div class="import-archetype">
        <strong>What kind of list is this?</strong>
        <div class="import-arch-pair">
          <button type="button" class="import-arch${p.archetype === 'inventory' ? ' is-on' : ''}" data-arch="inventory">
            <strong>Cards I own</strong><small>Every row is mine.</small>
          </button>
          <button type="button" class="import-arch${p.archetype === 'checklist' ? ' is-on' : ''}" data-arch="checklist">
            <strong>A set checklist</strong><small>Only the ticked rows are mine.</small>
          </button>
        </div>
        <small class="import-warn" id="import-arch-note"></small>
      </div>

      <p id="import-status"></p>
    `, {
      title: 'Check your columns',
      step: 2,
      footer: `<button type="button" class="ghost-btn" id="import-back">Back</button>
               <button type="button" class="primary-btn" id="import-go">Look these up</button>`
    });

    state.archetype = p.archetype;
    drawColumns();

    const archNote = () => {
      const el = document.getElementById('import-arch-note');
      if (el) el.textContent = state.archetype === 'checklist'
        ? 'Only rows with something in the "How many" column will be added.'
        : 'If this is really a set checklist, leaving it here gives you the whole set.';
    };
    archNote();

    document.querySelectorAll('[data-arch]').forEach((b) => b.addEventListener('click', () => {
      state.archetype = b.dataset.arch;
      document.querySelectorAll('[data-arch]').forEach((x) => x.classList.toggle('is-on', x === b));
      archNote();
    }));

    document.getElementById('import-back').addEventListener('click', stepPick);
    document.getElementById('import-go').addEventListener('click', () => {
      const mapping = {};
      state.cols.forEach((c) => { if (c.field) mapping[c.field] = c.i; });
      if (mapping.name === undefined && mapping.number === undefined) { summarise(); return; }
      state.parsed = Parse().parse(state.text, {
        mapping, archetype: state.archetype, headerIndex: state.parsed.headerIndex
      });
      stepWorking();
    });
  }

  // ================================================================
  // STEP 3 — LOOKING THEM UP
  // ================================================================

  async function stepWorking() {
    state.busy = true;
    shell(`
      <p class="import-lede">Matching your cards against the card database. Sets are read
        once each rather than card by card, so this is quicker than it sounds.</p>
      <div class="import-progress"><div class="import-bar" id="import-bar" style="width:0%"></div></div>
      <p class="import-progress-note" id="import-progress-note">Starting…</p>
    `, { title: 'Looking them up' });

    const bar = () => document.getElementById('import-bar');
    const note = () => document.getElementById('import-progress-note');

    let out;
    try {
      out = await Resolve().resolve(state.parsed.rows, {
        lang: 'en',
        onProgress: (p) => {
          const b = bar(), n = note();
          if (!b || !n) return;
          if (p.total) b.style.width = Math.round((p.done / p.total) * 100) + '%';
          n.textContent = p.phase === 'sets'
            ? (p.total ? `Reading sets… ${p.done} of ${p.total}` : (p.note || 'Reading sets…'))
            : `Matching cards… ${p.done} of ${p.total}`;
        }
      });
    } catch (e) {
      state.busy = false;
      shell(`<p class="import-lede">Something went wrong looking those up.</p>
             <p id="import-status"><span class="import-note bad">${esc((e && e.message) || 'Unknown error')}</span></p>`,
        { title: 'Could not look them up',
          footer: `<button type="button" class="ghost-btn" id="import-back">Back</button>` });
      document.getElementById('import-back').addEventListener('click', stepColumns);
      return;
    }

    state.busy = false;
    state.resolved = out;
    // Everything we were sure about starts ticked; everything we were not
    // starts unticked. That is the whole safety rule, expressed as a
    // default rather than as a warning nobody reads.
    out.results.forEach((r) => { r.include = r.status === 'matched'; });
    stepReview();
  }

  // ================================================================
  // STEP 4 — REVIEW
  // ================================================================

  function chosenCount() {
    return state.resolved.results
      .filter((r) => r.include && r.values)
      .reduce((s, r) => s + r.values.quantity, 0);
  }

  function refreshFooter() {
    const btn = document.getElementById('import-save');
    if (!btn) return;
    const n = chosenCount();
    btn.textContent = n ? `Add ${n} card${n === 1 ? '' : 's'} to my ${state.cfg.noun}` : 'Nothing selected';
    btn.disabled = !n;
  }

  function stepReview() {
    const rs = state.resolved.results;
    const matched = rs.filter((r) => r.status === 'matched');
    const review = rs.filter((r) => r.status === 'review');
    const failed = rs.filter((r) => r.status === 'failed');

    const rowHtml = (r, i) => {
      const v = r.values;
      const title = v ? v.card_name : (r.row.name || '(no name)');
      const sub = v
        ? `${esc(v.set_name)} · ${esc(v.card_id.split('-').slice(1).join('-'))} · ${esc(v.variant)} · ${esc(v.condition)}`
        : esc([r.row.setName, r.row.number].filter(Boolean).join(' · ') || 'line ' + r.row.line);
      return `
        <li class="import-row${r.include ? ' is-on' : ''}" data-at="${i}">
          <label class="import-check">
            <input type="checkbox" data-pick="${i}"${r.include ? ' checked' : ''}${v ? '' : ' disabled'}>
          </label>
          ${v && v.image_url ? `<img class="import-thumb" src="${esc(v.image_url)}" alt="" loading="lazy">` : '<span class="import-thumb is-blank"></span>'}
          <div class="import-row-main">
            <strong>${esc(title)}</strong>
            <small>${sub}</small>
            ${r.reason ? `<small class="import-why">${esc(r.reason)}</small>` : ''}
          </div>
          <span class="import-qty">×${esc(r.row.quantity)}</span>
        </li>`;
    };

    shell(`
      <div class="import-summary">
        <div class="import-stat is-good"><strong>${matched.length}</strong><small>ready to add</small></div>
        <div class="import-stat${review.length ? ' is-warn' : ''}"><strong>${review.length}</strong><small>need a look</small></div>
        <div class="import-stat"><strong>${failed.length}</strong><small>unreadable</small></div>
      </div>

      ${review.length ? `
        <section class="import-block">
          <h3>We were not sure about these</h3>
          <p class="import-lede">Nothing here is added unless you tick it. Each one says what
            stopped us — usually a set we could not place, or a number and a name that disagree.</p>
          <ul class="import-list">${review.map((r) => rowHtml(r, rs.indexOf(r))).join('')}</ul>
        </section>` : ''}

      ${matched.length ? `
        <section class="import-block">
          <h3>Ready to add</h3>
          <ul class="import-list">${matched.slice(0, 200).map((r) => rowHtml(r, rs.indexOf(r))).join('')}</ul>
          ${matched.length > 200 ? `<p class="import-lede"><small>…and ${matched.length - 200} more, all ticked.</small></p>` : ''}
        </section>` : ''}

      ${failed.length ? `
        <details class="import-help">
          <summary>${failed.length} row${failed.length === 1 ? '' : 's'} we could not read at all</summary>
          <ul class="import-list is-quiet">
            ${failed.map((r) => `<li class="import-row"><div class="import-row-main">
              <strong>Line ${esc(r.row.line)}</strong><small class="import-why">${esc(r.reason)}</small></div></li>`).join('')}
          </ul>
        </details>` : ''}

      <p id="import-status"></p>
    `, {
      title: 'What we found',
      step: 3,
      footer: `<button type="button" class="ghost-btn" id="import-back">Back</button>
               <button type="button" class="primary-btn" id="import-save"></button>`
    });

    document.getElementById('import-back').addEventListener('click', stepColumns);
    document.getElementById('import-save').addEventListener('click', save);

    document.querySelectorAll('[data-pick]').forEach((box) => {
      box.addEventListener('change', () => {
        const at = Number(box.dataset.pick);
        state.resolved.results[at].include = box.checked;
        box.closest('.import-row').classList.toggle('is-on', box.checked);
        refreshFooter();
      });
    });

    refreshFooter();
  }

  // ================================================================
  // STEP 5 — WRITING IT
  // ================================================================

  function isMissingNewColumn(error) {
    const text = `${(error && error.message) || ''} ${(error && error.details) || ''}`.toLowerCase();
    return NEW_COLUMNS.some((c) => text.includes(c)) &&
      (text.includes('does not exist') || text.includes('could not find') || text.includes('schema cache'));
  }

  const holdingKey = (v) => [v.card_id, v.variant, v.condition].join('|');

  async function save() {
    const sb = client();
    if (!sb) { say('You appear to be signed out.', 'bad'); return; }

    const chosen = state.resolved.results.filter((r) => r.include && r.values);
    if (!chosen.length) return;

    state.busy = true;
    const btn = document.getElementById('import-save');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    say('');

    const table = state.cfg.table;

    try {
      // ---- fold duplicate lines in the file together first ----
      // Two rows for the same card in the same printing and condition are
      // one holding of two, not two holdings. Doing this here means the
      // database sees one write instead of two that race each other.
      const wanted = new Map();
      for (const r of chosen) {
        const k = holdingKey(r.values);
        if (wanted.has(k)) wanted.get(k).quantity += r.values.quantity;
        else wanted.set(k, Object.assign({}, r.values));
      }

      // ---- what they already have ----
      const { data: existing, error: readErr } = await sb.from(table)
        .select('id, card_id, variant, condition, quantity')
        .eq('user_id', state.user.id);
      if (readErr) throw readErr;

      const have = new Map();
      (existing || []).forEach((row) => { have.set(holdingKey(row), row); });

      const inserts = [], updates = [];
      wanted.forEach((v, k) => {
        const mine = have.get(k);
        if (mine) updates.push({ id: mine.id, quantity: (Number(mine.quantity) || 0) + v.quantity });
        else inserts.push(Object.assign({ user_id: state.user.id }, v));
      });

      let done = 0;
      const total = inserts.length + updates.length;
      const tick = () => { btn.textContent = `Adding… ${Math.round((++done / total) * 100)}%`; };

      // ---- new holdings, in batches ----
      for (let i = 0; i < inserts.length; i += WRITE_BATCH) {
        const batch = inserts.slice(i, i + WRITE_BATCH);
        let { error } = await sb.from(table).insert(batch);
        if (error && isMissingNewColumn(error)) {
          // Older schema. Drop the columns it does not know about rather
          // than refusing — collection.js backfills them through use.
          const trimmed = batch.map((row) => {
            const copy = Object.assign({}, row);
            NEW_COLUMNS.forEach((c) => delete copy[c]);
            return copy;
          });
          ({ error } = await sb.from(table).insert(trimmed));
        }
        if (error) throw error;
        batch.forEach(tick);
      }

      // ---- and the ones that just go up ----
      for (const u of updates) {
        const { error } = await sb.from(table).update({ quantity: u.quantity }).eq('id', u.id);
        if (error) throw error;
        tick();
      }

      state.busy = false;

      // My Pokédex counts owned cards, so its cache is now stale.
      try { window.InfinitePullsPokemonData.invalidateOwnedCollectionCache(); } catch (_) {}

      const added = chosen.reduce((s, r) => s + r.values.quantity, 0);
      stepDone(added, inserts.length, updates.length);
    } catch (e) {
      state.busy = false;
      btn.disabled = false;
      refreshFooter();
      say('Could not save: ' + esc((e && e.message) || 'unknown error') +
          '. Nothing was lost — try again, or close and start over.', 'bad');
    }
  }

  function stepDone(added, newRows, bumped) {
    shell(`
      <div class="import-done">
        <div class="import-done-mark">✓</div>
        <h3>${esc(added)} card${added === 1 ? '' : 's'} added</h3>
        <p class="import-lede">
          ${newRows ? `${esc(newRows)} new ${newRows === 1 ? 'entry' : 'entries'}` : ''}${newRows && bumped ? ', and ' : ''}${bumped ? `${esc(bumped)} you already had went up` : ''}.
        </p>
        <p class="import-lede"><small>Your Pokédex has been updated too — any Pokémon these
          cards discovered are now filled in.</small></p>
      </div>
    `, {
      title: 'Done',
      footer: `<button type="button" class="primary-btn" id="import-finish">See my ${esc(state.cfg.noun)}</button>`
    });
    document.getElementById('import-finish').addEventListener('click', () => {
      const done = state.onDone;
      close();
      if (typeof done === 'function') done();
    });
  }

  // ================================================================
  // WAY IN
  // ================================================================

  function open(user, mode, onDone) {
    if (!user || !client()) return;
    if (!Parse() || !Resolve()) return;
    state = {
      user, onDone, busy: false,
      cfg: TABLES[mode] || TABLES.collection,
      source: '', text: '', parsed: null, resolved: null
    };
    stepPick();
  }

  window.InfinitePullsImport = { open, close, canImport: (mode) => !!TABLES[mode] };
})();
