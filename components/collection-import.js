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
            <div class="eyebrow">Import</div>
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

        <div class="import-or">or</div>

        <div class="import-paste">
          <label for="import-paste-box"><strong>Paste a spreadsheet</strong>
            <small>Select the rows in Excel or Google Sheets, copy, and paste them here.</small>
          </label>
          <textarea id="import-paste-box" rows="6" placeholder="Quantity	Name	Set	Card Number
1	Charizard	Base Set	4/102"></textarea>
          <div class="form-actions">
            <button type="button" class="primary-btn" id="import-paste-go">Read this</button>
          </div>
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
    `, { title: 'Bring your collection in' });

    const file = document.getElementById('import-file');
    file.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) { say('That file is bigger than 8MB — is it definitely a spreadsheet?', 'bad'); return; }
      try { read(await f.text(), f.name); }
      catch (_) { say('Could not read that file.', 'bad'); }
    });

    document.getElementById('import-paste-go').addEventListener('click', () => {
      const text = document.getElementById('import-paste-box').value;
      if (!text.trim()) { say('Nothing pasted yet.', 'bad'); return; }
      read(text, 'what you pasted');
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
  // ================================================================

  function stepColumns() {
    const p = state.parsed;
    const cols = p.headers.map((h, i) => ({ i, h: h || '(column ' + (i + 1) + ')' }));

    const pick = (field) => `
      <select data-field="${field}">
        <option value="">— not in this file —</option>
        ${cols.map((c) => `<option value="${c.i}"${p.mapping[field] === c.i ? ' selected' : ''}>${esc(c.h)}</option>`).join('')}
      </select>`;

    const sample = p.rows.slice(0, 3);

    shell(`
      <p class="import-lede">
        We read <strong>${p.rows.length}</strong> row${p.rows.length === 1 ? '' : 's'} from ${esc(state.source)}.
        Here is what we think each column is. Change anything we got wrong —
        nothing is looked up until you say go.
      </p>

      <div class="import-fields">
        ${FIELDS.map(([field, label, hint]) => `
          <div class="import-field${p.mapping[field] !== undefined ? ' is-found' : ''}">
            <div class="import-field-label"><strong>${esc(label)}</strong><small>${esc(hint)}</small></div>
            ${pick(field)}
          </div>`).join('')}
      </div>

      <div class="import-archetype">
        <strong>What kind of list is this?</strong>
        <label><input type="radio" name="import-arch" value="inventory"${p.archetype === 'inventory' ? ' checked' : ''}>
          <span><strong>Cards I own.</strong> Every row is something in my collection.</span></label>
        <label><input type="radio" name="import-arch" value="checklist"${p.archetype === 'checklist' ? ' checked' : ''}>
          <span><strong>A set checklist.</strong> Every card in the set is listed and only the ticked ones are mine.</span></label>
        <small class="import-warn">${p.archetype === 'checklist'
          ? 'This looks like a set list, so only the rows with something in the "How many" column will be added.'
          : 'If this is a set checklist and you leave it on "Cards I own", you will be given the whole set.'}</small>
      </div>

      <details class="import-help">
        <summary>Show me the first few rows as we read them</summary>
        <div class="import-scroll">
          <table class="import-table">
            <thead><tr>${p.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${sample.map((r) => `<tr>${p.headers.map((_, i) => `<td>${esc(r.raw[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
      </details>

      <p id="import-status"></p>
    `, {
      title: 'Check the columns',
      footer: `<button type="button" class="ghost-btn" id="import-back">Back</button>
               <button type="button" class="primary-btn" id="import-go">Look these up</button>`
    });

    document.getElementById('import-back').addEventListener('click', stepPick);
    document.getElementById('import-go').addEventListener('click', () => {
      const mapping = {};
      document.querySelectorAll('[data-field]').forEach((sel) => {
        if (sel.value !== '') mapping[sel.dataset.field] = Number(sel.value);
      });
      if (mapping.name === undefined && mapping.number === undefined) {
        say('Point at least one column at the card name or the card number, ' +
            'or there is nothing to look a card up by.', 'bad');
        return;
      }
      const arch = document.querySelector('input[name="import-arch"]:checked');
      state.parsed = Parse().parse(state.text, {
        mapping,
        archetype: arch ? arch.value : undefined,
        headerIndex: state.parsed.headerIndex
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
