/* Collection importer, part 2 of 5: working out which card each row is.
 *
 * Chunk 1 turned a file into rows. This turns a row into a real TCGdex
 * card, or into an honest "I am not sure". It knows nothing about
 * Supabase and writes nothing anywhere — it hands back the exact shape
 * components/collection.js already inserts into user_cards, and chunk 4
 * does the inserting.
 *
 *
 * WHAT THE LIVE API ACTUALLY DOES, AS OPPOSED TO WHAT IS WRITTEN DOWN
 *
 * Every one of these was checked against api.tcgdex.net rather than
 * assumed, and three of them would have broken the import badly:
 *
 * 1. COLLECTOR NUMBERS ARE PADDED IN SOME SETS AND NOT OTHERS, and the
 *    wrong form is a hard 404, not a near miss:
 *
 *        /cards/sv08.5-001  200      /cards/sv08.5-1  404
 *        /cards/base1-4     200      /cards/base1-004 404
 *
 *    Base Set and Darkness Ablaze count "1, 2, 3". Prismatic Evolutions,
 *    Scarlet & Violet and Pitch Black count "001, 002, 003". There is no
 *    rule to it. Guessing the id from the number would have silently
 *    failed on roughly half of every import.
 *
 *    So we never guess a card id. We fetch the SET, which comes back
 *    with every one of its cards and their real localIds, and match
 *    against that list. Which leads to the good part:
 *
 * 2. A WHOLE SET IS ONE CHEAP REQUEST. Prismatic Evolutions — 180 cards
 *    — is 20KB and came back in 64ms. So a 500-card collection spread
 *    over 20 sets is TWENTY requests, not five hundred. That is the
 *    difference between an import that takes a moment and one that
 *    hammers a free API from somebody's phone.
 *
 * 3. THE SET IDS ARE NOT THE ONES IN THE DOCUMENTATION PEOPLE QUOTE.
 *    TCGdex uses sv08.5, sv03.5, base1. The sv3pt5 / swsh12 style
 *    belongs to pokemontcg.io, which is a different API and two years
 *    stale. /sets/sv3pt5 returns 404 here.
 *
 * 4. THE PTCGO CODE IS ON THE SET, but only on the full object, spelled
 *    `abbreviation.official` — singular, not the `abbreviations` the
 *    docs mention. base1 -> BS, sv01 -> SVI, sv03.5 -> MEW, sv08.5 ->
 *    PRE, swsh3 -> DAA.
 *
 * 5. POKEMON TCG POCKET IS IN THE SAME DATABASE. The `tcgp` series —
 *    Wisdom of Sea and Sky, Mega Rising, and the rest — is a digital-only
 *    game whose cards do not exist on cardboard. Nobody's collection
 *    contains them, and leaving them in makes every name search
 *    ambiguous. They are excluded.
 *
 *
 * THE RULE THIS FILE IS BUILT AROUND
 *
 * A card we are not sure about goes to the review pile. It does not go
 * into somebody's collection. Getting a match wrong is worse than asking
 * — the customer can fix a question in two seconds, but a wrong card
 * sitting in their binder is something they may never notice and can
 * only find by auditing the lot.
 */
(function () {
  'use strict';

  const API = (lang) => 'https://api.tcgdex.net/v2/' + (lang || 'en');

  // Digital-only. See note 5 above.
  const EXCLUDED_SERIES = ['tcgp'];

  // How alike two card names have to be. A name that normalises to the
  // same thing scores 1 and is accepted outright. Below the floor we do
  // not believe it is the same card at all. In between, a person looks.
  const NAME_CONFIDENT = 0.85;
  const NAME_FLOOR = 0.60;

  // Sets we will pull in full while hunting for a set code we could not
  // resolve by name, newest first. Bounded because the alternative is
  // downloading all 218 of them; the sweep stops early as soon as every
  // outstanding code is accounted for, and in practice stops within a
  // handful because people own recent cards.
  const CODE_SWEEP_LIMIT = 60;

  const CONCURRENCY = 4;

  // ================================================================
  // CACHES
  // Kept for the life of the page. A second import, or a customer who
  // goes back and fixes their mapping and runs it again, costs nothing.
  // ================================================================
  const setListCache = {};      // lang -> [brief set]
  const fullSetCache = {};      // 'en|sv08.5' -> full set
  const codeIndex = {};         // lang -> { PRE: 'sv08.5' }
  const sweptSets = {};         // lang -> Set of ids already pulled for codes
  const dexCache = {};          // card name -> national dex number or null

  // ================================================================
  // 1. TEXT
  // ================================================================

  /* Card names, flattened enough to compare but not so far that two
   * different cards collide.
   *
   * Accents go because a customer typing Flabebe should still find
   * Flabébé. Punctuation goes because Farfetch'd is written with three
   * different apostrophes in the wild and Ho-Oh is written both with and
   * without the hyphen. Case goes last.
   *
   * What deliberately does NOT go: the ex / V / VMAX / GX suffix. Those
   * are different cards, often in the same set, and stripping them would
   * merge a $2 Umbreon with a $400 one.
   */
  function normName(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')      // é -> e
      .replace(/[\u2018\u2019\u02bc]/g, "'")                 // curly apostrophes
      .replace(/[\u2010-\u2015\u2212]/g, '-')                // en/em dashes
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /* How alike two names are, 0 to 1, by shared letter pairs.
   *
   * A pair count rather than an edit distance because it is forgiving in
   * the right way: it barely notices a missing space or a swapped word,
   * and it notices immediately when the words are different. "Charizard
   * ex" against "Charizard" scores high but not 1, which is exactly the
   * "have a look at this one" we want.
   */
  function bigrams(s) {
    const t = ' ' + s + ' ';
    const out = new Map();
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  }

  function similarity(a, b) {
    const x = normName(a), y = normName(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    const ga = bigrams(x), gb = bigrams(y);
    let shared = 0, na = 0, nb = 0;
    ga.forEach((n) => { na += n; });
    gb.forEach((n, g) => { nb += n; shared += Math.min(n, ga.get(g) || 0); });
    return (2 * shared) / (na + nb);
  }

  // ================================================================
  // 2. TALKING TO TCGDEX
  // ================================================================

  function makeFetcher(opts) {
    const f = (opts && opts.fetchImpl) || ((typeof fetch === 'function') ? fetch : null);
    if (!f) throw new Error('no fetch available');
    return async (url) => {
      const res = await f(url, { signal: opts && opts.signal });
      if (!res.ok) {
        const err = new Error('tcgdex ' + res.status);
        err.status = res.status;
        throw err;
      }
      return res.json();
    };
  }

  /* The list of every set: id, name, card counts. One request, and the
   * only one that has to happen before anything else can.
   */
  async function getSetList(lang, get) {
    if (setListCache[lang]) return setListCache[lang];
    const all = await get(API(lang) + '/sets');
    setListCache[lang] = Array.isArray(all) ? all : [];
    return setListCache[lang];
  }

  /* One set, with all of its cards. This is the workhorse — everything
   * downstream matches against the localIds in here rather than
   * constructing a card id and hoping.
   */
  async function getFullSet(lang, id, get) {
    const key = lang + '|' + id;
    if (fullSetCache[key]) return fullSetCache[key];
    const set = await get(API(lang) + '/sets/' + encodeURIComponent(id));
    fullSetCache[key] = set;
    // Every full set we pull teaches us its PTCGO code for free.
    const code = set && set.abbreviation && set.abbreviation.official;
    if (code) {
      codeIndex[lang] = codeIndex[lang] || {};
      if (!codeIndex[lang][String(code).toUpperCase()]) {
        codeIndex[lang][String(code).toUpperCase()] = set.id;
      }
    }
    return set;
  }

  // ================================================================
  // 3. WHICH SET
  // ================================================================

  /* Series names people put in front of a set name.
   *
   * "Sword & Shield—Brilliant Stars" is how TCGplayer writes it and
   * "Brilliant Stars" is how TCGdex does. Rather than list every pairing,
   * strip a leading series name and try again — that fixes the whole
   * family at once, including the ones that do not exist yet.
   */
  const SERIES_PREFIXES = [
    'mega evolution', 'scarlet and violet', 'sword and shield', 'sun and moon',
    'black and white', 'diamond and pearl', 'heartgold and soulsilver',
    'x and y', 'xy', 'platinum', 'neo', 'ex', 'pokemon tcg', 'pokemon'
  ];

  /* The handful that no amount of prefix-stripping will fix, because the
   * two databases genuinely use different words for the same set.
   */
  const SET_ALIASES = {
    'base': 'base1',
    'base set shadowless': 'base1',
    'base set unlimited': 'base1',
    'base set 1st edition': 'base1',
    '151': 'sv03.5',
    'pokemon 151': 'sv03.5',
    'scarlet and violet 151': 'sv03.5',
    'scarlet and violet base': 'sv01',
    'scarlet and violet base set': 'sv01',
    'sword and shield base': 'swsh1',
    'sword and shield base set': 'swsh1'
  };

  function stripSeries(name) {
    let n = normName(name);
    for (const p of SERIES_PREFIXES) {
      if (n.startsWith(p + ' ')) return n.slice(p.length + 1).trim();
    }
    return n;
  }

  function usableSets(sets) {
    // The brief list has no series on it, so Pocket sets are spotted by
    // their ids, which are A1 / A2a / B1 — a letter and a digit, a shape
    // no paper set uses.
    return sets.filter((s) => !/^[AB]\d/.test(String(s.id)));
  }

  /* A set name from a file, onto a TCGdex set id.
   *
   * Exact first, then the alias table, then with the series prefix
   * removed, then a containment match — but only when exactly one set
   * contains it. "Evolutions" matching both Evolutions and Prismatic
   * Evolutions is not an answer, it is a question, and it goes to the
   * customer.
   */
  function resolveSetByName(hint, sets) {
    const list = usableSets(sets);
    const want = normName(hint);
    if (!want) return null;

    let hit = list.find((s) => normName(s.name) === want);
    if (hit) return { id: hit.id, name: hit.name, how: 'name' };

    if (SET_ALIASES[want]) {
      hit = list.find((s) => s.id === SET_ALIASES[want]);
      if (hit) return { id: hit.id, name: hit.name, how: 'alias' };
    }

    const bare = stripSeries(hint);
    if (bare && bare !== want) {
      hit = list.find((s) => normName(s.name) === bare);
      if (hit) return { id: hit.id, name: hit.name, how: 'name' };
      if (SET_ALIASES[bare]) {
        hit = list.find((s) => s.id === SET_ALIASES[bare]);
        if (hit) return { id: hit.id, name: hit.name, how: 'alias' };
      }
    }

    const needle = bare || want;
    const contains = list.filter((s) => {
      const n = normName(s.name);
      return n.includes(needle) || needle.includes(n);
    });
    if (contains.length === 1) return { id: contains[0].id, name: contains[0].name, how: 'partial' };

    return null;
  }

  /* A set code like PRE or SVI, onto a set id.
   *
   * The code only exists on the full set object, so this is the one
   * lookup that can cost real requests. It is cheap in the normal case
   * because almost every export carries the set NAME as well and that
   * resolves for free; the sweep only runs for a file that has codes and
   * nothing else, and it stops the moment it has what it came for.
   */
  async function resolveSetByCode(codes, lang, sets, get, onProgress) {
    codeIndex[lang] = codeIndex[lang] || {};
    sweptSets[lang] = sweptSets[lang] || new Set();

    const outstanding = codes.filter((c) => !codeIndex[lang][c]);
    if (!outstanding.length) return codeIndex[lang];

    const candidates = usableSets(sets)
      .filter((s) => !sweptSets[lang].has(s.id))
      .slice(-CODE_SWEEP_LIMIT)
      .reverse();                                   // newest first

    let left = outstanding.slice();
    for (const s of candidates) {
      if (!left.length) break;
      sweptSets[lang].add(s.id);
      try { await getFullSet(lang, s.id, get); } catch (_) { /* skip it */ }
      left = left.filter((c) => !codeIndex[lang][c]);
      if (onProgress) onProgress({ phase: 'sets', note: 'looking up set codes' });
    }
    return codeIndex[lang];
  }

  // ================================================================
  // 4. WHICH CARD IN THAT SET
  // ================================================================

  /* The collector number from the file, against the real localIds.
   *
   * Chunk 1 already took "161/131" down to "161" and stripped leading
   * zeros off plain numbers. This puts them back if that is what the set
   * wants — see note 1 at the top, this is the whole reason the set gets
   * fetched at all.
   *
   * The promo case is the last resort: swshp numbers its cards SWSH001,
   * and an export that just says 284 is talking about SWSH284. If every
   * card in a set shares a letter prefix, try it.
   */
  function matchLocalId(number, cards) {
    const want = String(number == null ? '' : number).trim();
    if (!want || !cards || !cards.length) return null;

    const byId = new Map();
    for (const c of cards) byId.set(String(c.localId).toUpperCase(), c);

    const tries = [want.toUpperCase()];
    if (/^\d+$/.test(want)) {
      tries.push(want.padStart(2, '0'), want.padStart(3, '0'), want.padStart(4, '0'));
    } else {
      tries.push(want.replace(/^([A-Z]+)0*(\d+)$/i, (m, p, d) => p.toUpperCase() + d));
    }
    // "004" in the file against a set that counts 1, 2, 3
    if (/^0\d+$/.test(want)) tries.push(String(parseInt(want, 10)));

    for (const t of tries) {
      const hit = byId.get(t);
      if (hit) return hit;
    }

    if (/^\d+$/.test(want)) {
      const prefixes = new Set();
      for (const c of cards) {
        const m = String(c.localId).match(/^([A-Za-z]+)\d+$/);
        if (m) prefixes.add(m[1].toUpperCase());
      }
      for (const p of prefixes) {
        for (const pad of [want, want.padStart(2, '0'), want.padStart(3, '0')]) {
          const hit = byId.get(p + pad);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  /* Cards in a set whose name looks like the one in the file. Used when
   * a row has a name but no usable number, which is most homemade
   * spreadsheets.
   */
  function matchByName(name, cards) {
    if (!name) return [];
    const want = normName(name);
    const exact = cards.filter((c) => normName(c.name) === want);
    if (exact.length) return exact;
    return cards
      .map((c) => ({ card: c, score: similarity(name, c.name) }))
      .filter((x) => x.score >= NAME_CONFIDENT)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.card);
  }

  // ================================================================
  // 5. THE ROW THE APP WILL SAVE
  // ================================================================

  const thumbUrl = (image) => (image ? image + '/low.webp' : '');

  /* Exactly what components/collection.js writes when somebody taps Add,
   * minus the fields it fills in later by itself.
   *
   * rarity, illustrator and set_id are deliberately left off: collection.js
   * has a backfill that fills them in the first time a card's detail is
   * opened, so setting them here would mean a second request per card for
   * something that arrives free later. set_id is the exception — it comes
   * from the set we already have, so it costs nothing.
   */
  function toUserCardRow(card, set, row, lang) {
    return {
      card_id: card.id,
      card_name: card.name,
      set_name: set.name,
      set_id: set.id,
      image_url: thumbUrl(card.image),
      card_lang: lang,
      variant: row.variant || 'normal',
      condition: row.condition || 'Near Mint',
      quantity: row.quantity
    };
  }

  /* Which Pokemon this card is, so an imported collection lights up My
   * Pokedex straight away rather than filling in slowly as the customer
   * opens cards one at a time.
   *
   * Free: the species roster is already loaded by the app and
   * pokemon-data can turn a card name into a dex number without asking
   * TCGdex anything. Guarded to a fault — a Trainer, an Energy, or a
   * roster that has not loaded all return nothing, and nothing is a
   * perfectly good answer that costs the import nothing.
   */
  async function dexIdFor(cardName) {
    if (!cardName) return null;
    if (Object.prototype.hasOwnProperty.call(dexCache, cardName)) return dexCache[cardName];
    let n = null;
    try {
      const pd = window.InfinitePullsPokemonData;
      if (pd && pd.dexNumberFor) n = await pd.dexNumberFor(cardName);
    } catch (_) { n = null; }
    dexCache[cardName] = n;
    return n;
  }

  // ================================================================
  // 6. DOING IT
  // ================================================================

  async function pool(items, n, worker) {
    const out = new Array(items.length);
    let i = 0;
    const runners = new Array(Math.min(n, items.length)).fill(0).map(async () => {
      while (i < items.length) {
        const at = i++;
        try { out[at] = await worker(items[at], at); }
        catch (e) { out[at] = { __error: e }; }
      }
    });
    await Promise.all(runners);
    return out;
  }

  const setKeyFor = (row) => normName(row.setName || '') || (row.setCode ? 'code:' + row.setCode.toUpperCase() : '');

  /* Rows in, an answer per row out.
   *
   * Never throws for one bad row and never throws for one failed
   * request: a set that will not load turns its rows into review items
   * with a reason on them, and the other nineteen sets still import.
   */
  async function resolve(rows, opts) {
    const options = opts || {};
    const lang = options.lang || 'en';
    const get = makeFetcher(options);
    const onProgress = options.onProgress || function () {};
    const usable = (rows || []).filter((r) => !r.skip);

    const results = rows.map((row) => ({
      status: row.skip ? 'failed' : 'pending',
      row, card: null, set: null, score: 0,
      reason: row.skip ? (row.problems || []).join('; ') || 'skipped' : '',
      values: null
    }));

    if (!usable.length) return finish(results);

    // ---- the set list, once ----
    onProgress({ phase: 'sets', done: 0, total: 1, note: 'reading the set list' });
    let sets;
    try {
      sets = await getSetList(lang, get);
    } catch (e) {
      results.forEach((r) => {
        if (r.status === 'pending') { r.status = 'review'; r.reason = 'could not reach the card database'; }
      });
      return finish(results);
    }

    // ---- every distinct set mentioned in the file ----
    const groups = new Map();                    // setKey -> [result index]
    results.forEach((r, i) => {
      if (r.status !== 'pending') return;
      groups.set(setKeyFor(r.row), (groups.get(setKeyFor(r.row)) || []).concat(i));
    });

    // Codes we will need and cannot get from a name.
    const codeOnly = [];
    for (const key of groups.keys()) {
      if (!key) continue;
      const idxs = groups.get(key);
      const sample = results[idxs[0]].row;
      if (sample.setName && resolveSetByName(sample.setName, sets)) continue;
      if (sample.setCode) codeOnly.push(sample.setCode.toUpperCase());
    }
    if (codeOnly.length) {
      try { await resolveSetByCode(codeOnly, lang, sets, get, onProgress); } catch (_) { /* review pile */ }
    }

    // ---- resolve each group's set, then pull it once ----
    const keys = Array.from(groups.keys());
    let setsDone = 0;

    const resolved = await pool(keys, CONCURRENCY, async (key) => {
      const idxs = groups.get(key);
      const sample = results[idxs[0]].row;

      let found = sample.setName ? resolveSetByName(sample.setName, sets) : null;
      if (!found && sample.setCode) {
        const id = (codeIndex[lang] || {})[sample.setCode.toUpperCase()];
        const brief = id && sets.find((s) => s.id === id);
        if (brief) found = { id: brief.id, name: brief.name, how: 'code' };
      }

      let full = null;
      if (found) {
        try { full = await getFullSet(lang, found.id, get); }
        catch (_) { full = null; }
      }
      onProgress({ phase: 'sets', done: ++setsDone, total: keys.length, note: 'reading sets' });
      return { key, found, full };
    });

    const byKey = new Map();
    resolved.forEach((r) => { if (r && !r.__error) byKey.set(r.key, r); });

    // ---- and now every row ----
    let done = 0;
    for (const key of keys) {
      const entry = byKey.get(key);
      for (const i of groups.get(key)) {
        const r = results[i];
        judge(r, entry, lang);
        onProgress({ phase: 'cards', done: ++done, total: usable.length, note: 'matching cards' });
      }
    }

    // ---- which Pokemon each one is, for My Pokedex ----
    await pool(results.filter((r) => r.values), CONCURRENCY, async (r) => {
      const dex = await dexIdFor(r.values.card_name);
      if (dex) r.values.dex_id = dex;
    });

    return finish(results);
  }

  /* One row, decided. Split out from resolve() so the whole decision is
   * readable in one screen — this is the part that says a card goes into
   * somebody's collection.
   */
  function judge(r, entry, lang) {
    const row = r.row;

    if (!entry || !entry.found) {
      r.status = 'review';
      r.reason = row.setName || row.setCode
        ? 'could not tell which set "' + (row.setName || row.setCode) + '" is'
        : 'no set on this row';
      return;
    }
    if (!entry.full || !Array.isArray(entry.full.cards)) {
      r.status = 'review';
      r.reason = 'could not read ' + entry.found.name + ' from the card database';
      return;
    }

    const set = { id: entry.full.id, name: entry.full.name };
    const cards = entry.full.cards;
    r.set = set;

    // -- by number, which is the reliable way --
    let card = row.number ? matchLocalId(row.number, cards) : null;

    if (card) {
      const score = row.name ? similarity(row.name, card.name) : 1;
      r.card = card;
      r.score = score;
      r.values = toUserCardRow(card, set, row, lang);

      if (!row.name || score >= NAME_CONFIDENT) {
        r.status = 'matched';
        r.reason = row.name ? '' : 'matched on set and number';
      } else {
        // The number found a card but it is not the card the file names.
        // Usually the set is wrong. Never silently accepted.
        r.status = 'review';
        r.reason = 'number ' + row.number + ' in ' + set.name + ' is ' + card.name +
                   ', but the file says ' + row.name;
      }
      return;
    }

    // -- by name within the set, for sheets with no numbers --
    const named = row.name ? matchByName(row.name, cards) : [];
    if (named.length === 1) {
      r.card = named[0];
      r.score = similarity(row.name, named[0].name);
      r.values = toUserCardRow(named[0], set, row, lang);
      r.status = row.number ? 'review' : 'matched';
      r.reason = row.number
        ? 'no card numbered ' + row.number + ' in ' + set.name + ', but the name matches ' + named[0].name
        : 'matched on name alone';
      return;
    }
    if (named.length > 1) {
      r.status = 'review';
      r.reason = named.length + ' cards in ' + set.name + ' are called ' + row.name;
      r.candidates = named.slice(0, 12);
      return;
    }

    r.status = 'review';
    r.reason = row.number
      ? 'no card numbered ' + row.number + ' in ' + set.name
      : 'nothing in ' + set.name + ' matches ' + (row.name || 'this row');
  }

  function finish(results) {
    return {
      results,
      counts: {
        total: results.length,
        matched: results.filter((r) => r.status === 'matched').length,
        review: results.filter((r) => r.status === 'review').length,
        failed: results.filter((r) => r.status === 'failed').length,
        cards: results.filter((r) => r.status === 'matched')
          .reduce((s, r) => s + (r.values ? r.values.quantity : 0), 0)
      }
    };
  }

  // ================================================================
  // 7. PUTTING ONE ROW RIGHT
  //
  // The review pile is not a rejection pile. Almost everything in it is
  // a row where we found something and were not confident, or found the
  // wrong thing because the set was wrong — and in both cases the person
  // who typed the file knows the answer in a second. These two are what
  // the fix-it panel in chunk 3 is built on.
  // ================================================================

  /* Sets whose name contains what they have typed so far, best first.
   * An empty box offers the newest sets, because a card somebody is
   * still sorting is far more likely to be from this year than 2003.
   */
  async function findSets(query, opts) {
    const options = opts || {};
    const lang = options.lang || 'en';
    const sets = usableSets(await getSetList(lang, makeFetcher(options)));
    const q = normName(query || '');
    if (!q) return sets.slice(-14).reverse();

    const starts = [], has = [];
    for (const s of sets) {
      const n = normName(s.name);
      if (n.startsWith(q)) starts.push(s);
      else if (n.includes(q)) has.push(s);
    }
    return starts.concat(has).slice(0, 14);
  }

  /* Judge one row again, against a set the customer chose by hand.
   *
   * Same judge() as the bulk run, so a hand-picked set gets exactly the
   * same treatment — including telling them, again, if the number they
   * typed turns out to be a different card in the set they just chose.
   */
  async function resolveInSet(row, setId, opts) {
    const options = opts || {};
    const lang = options.lang || 'en';
    const get = makeFetcher(options);

    const r = { status: 'review', row, card: null, set: null, score: 0, reason: '', values: null };
    let full = null;
    try { full = await getFullSet(lang, setId, get); }
    catch (_) {
      r.reason = 'could not read that set from the card database';
      return r;
    }
    judge(r, { key: '', found: { id: full.id, name: full.name, how: 'chosen' }, full }, lang);
    if (r.values) {
      const dex = await dexIdFor(r.values.card_name);
      if (dex) r.values.dex_id = dex;
    }
    return r;
  }

  /* The customer pointed at one specific card. No judging left to do —
   * they can see it, and they know their own collection better than a
   * string comparison does.
   */
  async function useCard(row, card, set, lang) {
    const values = toUserCardRow(card, set, row, lang || 'en');
    const dex = await dexIdFor(values.card_name);
    if (dex) values.dex_id = dex;
    return values;
  }

  /* Every card in a set, for picking from by hand. Cached, so opening
   * the picker on a set already looked up costs nothing. */
  async function cardsInSet(setId, opts) {
    const options = opts || {};
    const full = await getFullSet(options.lang || 'en', setId, makeFetcher(options));
    return (full && full.cards) || [];
  }

  window.InfinitePullsImportResolve = {
    resolve, findSets, resolveInSet, useCard, cardsInSet,
    // for the review screen in chunk 3, and for the tests
    normName, similarity, matchLocalId, matchByName, resolveSetByName,
    getSetList, getFullSet, toUserCardRow, usableSets, stripSeries,
    NAME_CONFIDENT, NAME_FLOOR, EXCLUDED_SERIES,
    _caches: { setListCache, fullSetCache, codeIndex, sweptSets, dexCache }
  };
})();
