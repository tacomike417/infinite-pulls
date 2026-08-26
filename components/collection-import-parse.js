/* Collection importer, part 1 of 5: reading the file.
 *
 * This file does one job and knows nothing about anything else. It takes
 * the text of a spreadsheet somebody exported or typed themselves, and
 * turns it into plain rows. It does not touch the network, it does not
 * touch Supabase, it does not know what a TCGdex is. Chunk 2 does the
 * looking-up; chunk 3 puts a screen on it.
 *
 * WHY IT IS BUILT THIS WAY
 *
 * We went looking for the file formats of the eight apps Pokemon
 * collectors actually use. Almost every one of them puts its export
 * behind a subscription, an iPhone, or a once-a-year request. The
 * practical result is that most people cannot hand us an app export at
 * all, so the file a real customer brings in is a spreadsheet they made
 * themselves — and no two of those agree on anything.
 *
 * So there is no list of supported apps in here and there never will be.
 * Everything keys off the words in the header row, and the customer gets
 * shown the mapping we guessed so they can correct it. That reads a file
 * we have never seen, and it does not break when Collectr ships an
 * update.
 *
 * The one format we have actually verified is TCGplayer's mobile export,
 * which is also the only format Collectr accepts as an import:
 *
 *   Quantity, Name, Simple Name, Set, Card Number, Set Code, Printing,
 *   Condition, Language, Rarity, Product ID
 *
 * Even that one is not safe to read by position — those columns are
 * tickboxes in the TCGplayer app, so each person's export has a
 * different subset in a different order. Header names, always.
 */
(function () {
  'use strict';

  // ----------------------------------------------------------------
  // The app's own vocabularies. An imported row has to land on one of
  // these or it cannot be saved, so the parser converts to them here
  // rather than leaving it to a later chunk to guess.
  // Both lists are lifted from components/collection.js — if that file
  // ever gains a condition or a printing, add it in both places.
  // ----------------------------------------------------------------
  const CONDITIONS = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];

  const VARIANTS = ['normal', 'holofoil', 'reverse-holofoil', '1st-edition',
                    '1st-edition-holofoil', 'unlimited', 'unlimited-holofoil'];

  // ================================================================
  // 1. SPLITTING THE FILE INTO CELLS
  // ================================================================

  /* Which character separates the columns.
   *
   * Comma is the common case. Tab matters because Cardmarket — the
   * European marketplace — hands out tab-separated files, and a European
   * customer is a real customer. Semicolon matters because Excel in a
   * country that writes 1,50 for one and a half refuses to use a comma
   * as a separator and quietly switches.
   *
   * Decided by counting on the first line only. The header row is the one
   * line guaranteed to have every separator and no free text.
   */
  function sniffDelimiter(text) {
    const firstLine = String(text || '').split(/\r?\n/, 1)[0] || '';
    const counts = { ',': 0, '\t': 0, ';': 0, '|': 0 };
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (!inQuotes && ch in counts) counts[ch]++;
    }
    let best = ',', bestN = 0;
    for (const d of Object.keys(counts)) if (counts[d] > bestN) { best = d; bestN = counts[d]; }
    return bestN ? best : ',';
  }

  /* A real CSV reader, not a call to split(',').
   *
   * It has to be real because card and set names contain commas
   * ("Sword & Shield—Brilliant Stars" is fine, but "Mew, Mewtwo & Co."
   * is not), quoted cells contain newlines, and a quote inside a quoted
   * cell is written as two quotes. split(',') gets all three wrong and
   * the damage shows up as one mangled row in the middle of an otherwise
   * fine import, which is the worst kind of bug to find later.
   */
  function splitRows(text, delimiter) {
    const src = String(text || '').replace(/^﻿/, '');  // Excel writes a byte-order mark
    const rows = [];
    let row = [], cell = '', inQuotes = false;

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];

      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { cell += '"'; i++; }   // "" is one literal quote
          else inQuotes = false;
        } else cell += ch;
        continue;
      }

      if (ch === '"' && cell === '') { inQuotes = true; continue; }
      if (ch === delimiter) { row.push(cell); cell = ''; continue; }
      if (ch === '\r') continue;
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
      cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }

    return rows.map((r) => r.map((c) => c.trim()));
  }

  /* Find the header row.
   *
   * Homemade spreadsheets very often open with a title, a blank line, and
   * maybe a total, before the actual column names. Assuming row 1 is the
   * header would map every column to nothing and the customer would be
   * told their file was unreadable when it was fine.
   *
   * So: look at the first few rows and take the first one where at least
   * two cells are recognisable column names. If none of them are, fall
   * back to the first non-empty row and let the customer fix the mapping
   * by hand — which is the whole reason that screen exists.
   */
  function findHeaderRow(rows) {
    const limit = Math.min(rows.length, 12);
    for (let i = 0; i < limit; i++) {
      const r = rows[i];
      if (!r || r.filter((c) => c !== '').length < 2) continue;
      const hits = r.filter((c) => c && fieldForHeader(c)).length;
      if (hits >= 2) return i;
    }
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].filter((c) => c !== '').length >= 2) return i;
    }
    return 0;
  }

  // ================================================================
  // 2. WORKING OUT WHAT EACH COLUMN IS
  // ================================================================

  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');

  /* Header names we recognise, per field.
   *
   * Order matters twice over. Within a field, the earlier spelling wins,
   * so a sheet with both "Name" and "Simple Name" maps "Name" — Simple
   * Name is TCGplayer's stripped-down version and matching against it
   * loses the detail that tells two printings apart.
   *
   * Between fields, the list order below is the tie-break when one header
   * could be two things. "Number" is the ugly one: in a card spreadsheet
   * it means the collector number essentially always, but in a plain
   * inventory it occasionally means how many. Card number wins, because
   * guessing wrong on quantity costs one wrong count while guessing wrong
   * on the number imports a completely different card.
   */
  const HEADERS = {
    // What card it is
    name:      ['name', 'cardname', 'card', 'title', 'productname', 'englishname', 'cardtitle', 'simplename'],
    number:    ['cardnumber', 'collectornumber', 'number', 'cardno', 'cardnum', 'no', 'num', 'card', 'n'],
    setName:   ['set', 'setname', 'expansion', 'edition', 'series', 'expansionname', 'setexpansion'],
    setCode:   ['setcode', 'code', 'abbreviation', 'abbr', 'ptcgocode', 'expansioncode', 'setabbreviation'],
    productId: ['productid', 'tcgplayerid', 'tcgplayerproductid', 'sku', 'id'],

    // Which copy of it
    printing:  ['printing', 'variant', 'finish', 'foil', 'holo', 'print', 'edition type', 'parallel', 'foiling', 'isfoil'],
    condition: ['condition', 'cond', 'cardcondition', 'conditiongrade'],
    language:  ['language', 'lang', 'cardlanguage'],
    grade:     ['grade', 'grading', 'graded', 'gradecompany', 'psa', 'bgs', 'cgc'],

    // How many, and what it is worth
    quantity:  ['quantity', 'qty', 'count', 'have', 'owned', 'copies', 'amount', 'numberowned', 'qtyowned', 'total'],
    price:     ['price', 'marketprice', 'market', 'value', 'currentvalue', 'purchaseprice', 'paid', 'cost', 'low', 'mid', 'high'],

    // Extras we keep but never match on
    rarity:    ['rarity', 'rare']
  };

  // Every field, in the order they get first refusal on an ambiguous header.
  const FIELD_ORDER = ['quantity', 'name', 'number', 'setName', 'setCode', 'printing',
                       'condition', 'language', 'rarity', 'productId', 'grade', 'price'];

  /* Every field a header could plausibly be, best guess first.
   *
   * A list rather than one answer, because headers genuinely are
   * ambiguous and the right choice depends on what the other columns
   * already took. "Card #" and "Card Name" both reduce to something
   * containing "card"; whichever one is not the name is the number, and
   * that is only knowable once the name column has been claimed.
   *
   * Exact matches rank above partial ones, so a sheet with both "Set" and
   * "Set Code" does not hand "Set Code" to setName just because setName
   * is checked first.
   */
  function fieldsForHeader(header) {
    const h = norm(header);
    if (!h) return [];
    const exact = [], partial = [];
    for (const field of FIELD_ORDER) {
      if (HEADERS[field].some((alias) => norm(alias) === h)) { exact.push(field); continue; }
      if (HEADERS[field].some((alias) => {
        const a = norm(alias);
        return a.length >= 3 && (h.includes(a) || a.includes(h));
      })) partial.push(field);
    }
    const ranked = exact.concat(partial);

    // A hash in the header is a collector number essentially always on a
    // card sheet — "Card #", "#". It survives none of the normalising
    // above, so it is checked against the raw text.
    if (/#/.test(String(header)) && ranked.includes('number')) {
      return ['number'].concat(ranked.filter((f) => f !== 'number'));
    }
    return ranked;
  }

  // The single best guess, for callers that only want one — the
  // header-row sniffer, and the tests.
  function fieldForHeader(header) {
    return fieldsForHeader(header)[0] || null;
  }

  /* Header row in, {field: columnIndex} out.
   *
   * One column per field and one field per column. If two headers both
   * claim a field the earlier one keeps it and the later one is left
   * unmapped rather than silently overwriting — that is what happens on
   * the community TCGplayer export, whose Low / Mid / High are all
   * prices, and taking Low and ignoring the rest is the right answer.
   *
   * Everything unmapped is still carried through on the row so the
   * customer can point at it on the mapping screen.
   */
  function mapColumns(headerCells) {
    const mapping = {};
    const claimedBy = {};
    (headerCells || []).forEach((cell, i) => {
      const field = fieldsForHeader(cell).find((f) => mapping[f] === undefined);
      if (!field) return;                          // every candidate already taken
      mapping[field] = i;
      claimedBy[field] = String(cell);
    });
    return { mapping, claimedBy };
  }

  // ================================================================
  // 3. CLEANING UP THE VALUES
  // ================================================================

  /* A collector number as printed, turned into something we can look up.
   *
   * The important part is the slash. Cards are written 4/102, and secret
   * rares deliberately run past the end of their set — 199/197, 172/086.
   * The number after the slash is not the set size we should check
   * against, it is decoration, and a parser that validates against it
   * throws away exactly the expensive cards. Split, keep the left, never
   * look right again.
   *
   * Leading zeros go from all-digit numbers because TCGdex writes 6, not
   * 006. They stay on anything with a letter in it, because TG12, GG01,
   * SV045 and SWSH284 are the real identifiers and trimming them breaks
   * the lookup.
   */
  function splitNumber(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return { number: '', printedTotal: null };

    s = s.replace(/^\s*(?:#|no\.?|nr\.?|num\.?)\s*/i, '').trim();   // "#4", "No. 4", "Nr 4"

    let printedTotal = null;
    const slash = s.indexOf('/');
    if (slash >= 0) {
      const right = s.slice(slash + 1).trim();
      printedTotal = right || null;
      s = s.slice(0, slash).trim();
    }

    s = s.replace(/\s+/g, '');
    if (/^\d+$/.test(s)) s = String(parseInt(s, 10));     // 006 -> 6
    else s = s.toUpperCase();                             // tg12 -> TG12

    return { number: s, printedTotal };
  }

  /* "$12.34" -> 12.34, and the European "1.234,56" too.
   *
   * Prices arrive as formatted strings from every source we looked at,
   * never as bare numbers. We do not import the money — the app prices
   * cards live — but reading it lets the preview screen show a total the
   * customer recognises, which is how they tell the import worked.
   */
  function stripMoney(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    s = s.replace(/[^0-9.,\-]/g, '');
    if (!s || s === '-') return null;
    if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
    else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');                          // 12,34
    else s = s.replace(/,/g, '');                                                          // 1,234.56
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /* How many copies this row is.
   *
   * Blank means one, not zero: on a checklist that a person ticks by
   * hand, a row that exists at all is a card they have. And a tick is a
   * one — homemade sheets mark ownership with x, a checkmark, "yes" or
   * TRUE at least as often as with a digit.
   */
  const TICKS = ['x', 'X', '✓', '✔', 'yes', 'y', 'true', 'owned', 'have', 'got', '1'];

  function parseQuantity(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return 1;
    if (TICKS.some((t) => t.toLowerCase() === s.toLowerCase())) return 1;
    const n = parseInt(s.replace(/[^0-9\-]/g, ''), 10);
    if (!Number.isFinite(n)) return 1;
    return n;                                    // 0 and negatives survive; the caller drops them
  }

  /* Condition text from anywhere, onto the five the app stores.
   *
   * TCGplayer's five are the app's five, which is most of the battle.
   * The abbreviations are here because homemade sheets are written in
   * them, and "Mint" is here because plenty of people write it and mean
   * the best one, which for us is Near Mint.
   */
  function normalizeCondition(raw) {
    const s = norm(raw);
    if (!s) return null;
    if (/^(nm|nrmt|nearmint|mint|m|nmm|nearmintmint|pack fresh|packfresh)$/.test(s)) return 'Near Mint';
    if (/^(lp|lightlyplayed|slightlyplayed|sp|excellent|ex|vg|verygood)$/.test(s)) return 'Lightly Played';
    if (/^(mp|moderatelyplayed|good|gd|played|pl)$/.test(s)) return 'Moderately Played';
    if (/^(hp|heavilyplayed|poor|pr|fair)$/.test(s)) return 'Heavily Played';
    if (/^(dmg|damaged|dm|d)$/.test(s)) return 'Damaged';
    if (s.includes('nearmint')) return 'Near Mint';
    if (s.includes('lightly')) return 'Lightly Played';
    if (s.includes('moderately')) return 'Moderately Played';
    if (s.includes('heavily')) return 'Heavily Played';
    if (s.includes('damag')) return 'Damaged';
    return null;
  }

  /* Printing text from anywhere, onto the seven the app stores.
   *
   * "Foil" on its own means holofoil — that is what TCGplayer writes on
   * a Magic export and what plenty of people write for Pokemon. Reverse
   * is checked before plain holo because "Reverse Holofoil" contains the
   * word holo and would otherwise match the wrong one.
   */
  function normalizeVariant(raw) {
    const s = norm(raw);
    if (!s) return null;
    if (VARIANTS.includes(String(raw).trim())) return String(raw).trim();   // already ours
    const first = /^(1st|first)/.test(s) || s.includes('1stedition') || s.includes('firstedition');
    const unlimited = s.includes('unlimited');
    const reverse = s.includes('reverse') || s === 'rh' || s === 'rev';
    const holo = s.includes('holo') || s.includes('foil') || s === 'h';

    if (reverse) return 'reverse-holofoil';
    if (first) return holo ? '1st-edition-holofoil' : '1st-edition';
    if (unlimited) return holo ? 'unlimited-holofoil' : 'unlimited';
    if (/^(normal|nonfoil|non|regular|plain|no|false|n)$/.test(s)) return 'normal';
    if (holo) return 'holofoil';
    return null;
  }

  /* "PSA 10 (GEM-MT)" -> { company: 'PSA', grade: 10 }
   *
   * Graded cards are the ones worth the most, and Collectr's own screens
   * show them as one blob of text. The app has nowhere to put a grade —
   * user_cards knows about condition and printing and nothing else — so
   * this does not decide anything. It pulls the grade out so the
   * preview screen can show it and the customer can see we noticed,
   * and so a later chunk has it if we ever add grading.
   */
  const GRADERS = ['PSA', 'BGS', 'BCCG', 'CGC', 'SGC', 'TAG', 'ACE', 'HGA', 'GMA', 'ISA', 'MNT', 'AGS', 'CSG'];

  function parseGrade(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    const m = s.match(new RegExp('\\b(' + GRADERS.join('|') + ')\\b[\\s:.-]*([0-9]{1,2}(?:\\.5)?)', 'i'));
    if (!m) return null;
    const grade = Number(m[2]);
    if (!Number.isFinite(grade) || grade < 1 || grade > 10) return null;
    return { company: m[1].toUpperCase(), grade, label: m[1].toUpperCase() + ' ' + m[2] };
  }

  /* Language down to a two-letter code, because that is what TCGdex wants.
   * Anything we do not recognise comes back as typed, so the mapping
   * screen can show it rather than silently claiming English.
   */
  const LANGS = {
    en: ['en', 'eng', 'english'], ja: ['ja', 'jp', 'jpn', 'japanese'],
    fr: ['fr', 'fra', 'french', 'francais'], de: ['de', 'deu', 'ger', 'german', 'deutsch'],
    es: ['es', 'esp', 'spa', 'spanish', 'espanol'], it: ['it', 'ita', 'italian', 'italiano'],
    pt: ['pt', 'por', 'portuguese'], ko: ['ko', 'kor', 'korean'],
    zh: ['zh', 'chi', 'chinese', 'zht', 'zhs'], nl: ['nl', 'dutch'], ru: ['ru', 'rus', 'russian']
  };

  function normalizeLanguage(raw) {
    const s = norm(raw);
    if (!s) return null;
    for (const code of Object.keys(LANGS)) if (LANGS[code].includes(s)) return code;
    return String(raw).trim();
  }

  // ================================================================
  // 4. WHAT SHAPE OF SHEET IS THIS
  // ================================================================

  /* Two kinds of spreadsheet turn up and they mean opposite things.
   *
   * An INVENTORY is a list of what somebody owns, one line per holding,
   * with a quantity column. Import every row.
   *
   * A CHECKLIST is a printed set list — every card in the set, one row
   * each, with a tick or a highlight against the ones they have. The
   * quantity column is often missing entirely, and the rows they have
   * NOT got are still in the file. Importing it as an inventory hands
   * somebody the complete set they were working towards.
   *
   * Telling them apart: if there is no quantity column at all and the row
   * count is large and the card numbers run 1, 2, 3... with few gaps,
   * that is a set list. The customer confirms either way on the mapping
   * screen — this only decides which answer is pre-selected, because
   * getting it wrong silently is the one mistake that would really annoy
   * somebody.
   */
  function detectArchetype(records, mapping) {
    const hasQtyColumn = mapping.quantity !== undefined;
    const n = records.length;

    if (hasQtyColumn) {
      const filled = records.filter((r) => String(r.raw[mapping.quantity] || '').trim() !== '').length;
      // A quantity column that is mostly blank is a checklist someone
      // ticked in a different column, not an inventory of blank holdings.
      if (n >= 20 && filled / n < 0.5) return 'checklist';
      return 'inventory';
    }

    if (n < 20) return 'inventory';          // too small to tell; the friendlier guess

    // Sequential collector numbers with hardly a gap is what a set list
    // looks like and what an inventory almost never does.
    const nums = records
      .map((r) => (mapping.number !== undefined ? splitNumber(r.raw[mapping.number]).number : ''))
      .filter((v) => /^\d+$/.test(v))
      .map(Number)
      .sort((a, b) => a - b);
    if (nums.length < n * 0.8) return 'inventory';
    const span = nums[nums.length - 1] - nums[0] + 1;
    const density = nums.length / Math.max(span, 1);
    return density > 0.9 ? 'checklist' : 'inventory';
  }

  // ================================================================
  // 5. THE WHOLE JOB
  // ================================================================

  /* Text in, everything chunk 2 needs out.
   *
   * Nothing here throws on bad data. A row we cannot read comes back
   * marked with what was wrong with it, because a file of four hundred
   * cards with six broken lines should import three hundred and
   * ninety-four and show the customer the six, not refuse the lot.
   */
  function parse(text, opts) {
    const options = opts || {};
    const delimiter = options.delimiter || sniffDelimiter(text);

    // Blank rows are skipped, but their line numbers are not reused. When
    // we tell somebody "line 37 could not be read" they are going to open
    // the file and look at line 37, so the count has to include the empty
    // rows and the title block they cannot see the point of.
    const filled = [];
    splitRows(text, delimiter).forEach((cells, i) => {
      if (cells.some((c) => c !== '')) filled.push({ line: i + 1, cells });
    });

    if (!filled.length) {
      return { ok: false, reason: 'That file looks empty.', delimiter, headers: [], rows: [] };
    }

    let at = options.headerIndex != null
      ? filled.findIndex((r) => r.line === options.headerIndex + 1)
      : findHeaderRow(filled.map((r) => r.cells));
    if (at < 0) at = 0;

    const headers = filled[at].cells;
    const headerIndex = filled[at].line - 1;      // where it really is in the file

    const auto = mapColumns(headers);
    // A mapping handed in from the confirm screen always wins over ours.
    const mapping = Object.assign({}, auto.mapping, options.mapping || {});

    const records = filled.slice(at + 1).map((r) => ({ line: r.line, raw: r.cells }));
    const archetype = options.archetype || detectArchetype(records, mapping);

    const cell = (raw, field) => (mapping[field] === undefined ? '' : (raw[mapping[field]] || ''));

    const rows = records.map((rec) => {
      const raw = rec.raw;
      const name = String(cell(raw, 'name')).trim();
      const num = splitNumber(cell(raw, 'number'));
      const grade = parseGrade(cell(raw, 'grade')) || parseGrade(cell(raw, 'condition'));

      // On a checklist the quantity column is a tick, so anything present
      // means one copy and anything blank means they have not got it.
      const qtyCell = String(cell(raw, 'quantity')).trim();
      const quantity = archetype === 'checklist'
        ? (qtyCell === '' ? 0 : parseQuantity(qtyCell))
        : parseQuantity(qtyCell);

      // A row only has to identify a card SOMEHOW. Name and number are
      // both nice, but plenty of real sheets have one without the other
      // — a set checklist has numbers and no names worth reading, and a
      // hand-typed list has names and no numbers at all. Demanding both
      // would throw away most homemade files. Chunk 2 decides what it
      // can do with what is here; this only rejects a row that says
      // nothing about any card.
      const problems = [];
      if (!name && !num.number && !cell(raw, 'productId')) problems.push('nothing to identify a card by');
      if (quantity < 0) problems.push('negative quantity');

      return {
        line: rec.line,
        name,
        number: num.number,
        printedTotal: num.printedTotal,
        setName: String(cell(raw, 'setName')).trim() || null,
        setCode: String(cell(raw, 'setCode')).trim().toUpperCase() || null,
        productId: String(cell(raw, 'productId')).trim() || null,
        variant: normalizeVariant(cell(raw, 'printing')),
        condition: normalizeCondition(cell(raw, 'condition')),
        language: normalizeLanguage(cell(raw, 'language')) || 'en',
        rarity: String(cell(raw, 'rarity')).trim() || null,
        grade,
        price: stripMoney(cell(raw, 'price')),
        quantity,
        // Kept so the mapping screen can show the customer a column we
        // did not understand and let them assign it.
        raw,
        problems,
        skip: quantity <= 0 || problems.length > 0
      };
    });

    return {
      ok: true,
      delimiter,
      headerIndex,
      headers,
      mapping,
      mappedFrom: auto.claimedBy,
      unmapped: headers.map((h, i) => ({ header: h, index: i }))
        .filter((c) => c.header && !Object.values(mapping).includes(c.index)),
      archetype,
      rows,
      counts: {
        total: rows.length,
        usable: rows.filter((r) => !r.skip).length,
        skipped: rows.filter((r) => r.skip).length,
        cards: rows.filter((r) => !r.skip).reduce((s, r) => s + r.quantity, 0)
      }
    };
  }

  /* The rescue hatch: a typed or pasted list, no columns at all.
   *
   * pkmn.gg has no export. Dex has none on Android. TCGplayer has none
   * at all. Those customers cannot produce a file, and telling them to
   * go and buy a subscription to somebody else's app before they can use
   * ours is not an answer.
   *
   * PriceCharting proved a plain line works — they claim 90% or better
   * matching off exactly this. One card per line, in whatever order the
   * person naturally writes it:
   *
   *   4x Charizard Base Set 4/102
   *   Pikachu Jungle 60/64
   *   Umbreon ex Prismatic Evolutions 161/131
   *
   * The leading count and the trailing number are the two things we can
   * pull out with confidence. Everything in between is name and set,
   * and which is which is chunk 2's problem — it has the card database
   * and can try it both ways round.
   */
  function parseFreeText(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rows = lines.map((line, i) => {
      let rest = line;
      let quantity = 1;

      const lead = rest.match(/^(\d{1,4})\s*[x×]?\s+(.*)$/i) || rest.match(/^(\d{1,4})[x×]\s*(.*)$/i);
      if (lead) { quantity = parseInt(lead[1], 10); rest = lead[2].trim(); }

      let number = '', printedTotal = null;
      const tail = rest.match(/[#\s]([A-Za-z]{0,4}\d{1,4}[A-Za-z]?(?:\/\d{1,4}[A-Za-z]?)?)\s*$/);
      if (tail) {
        const parsed = splitNumber(tail[1]);
        number = parsed.number;
        printedTotal = parsed.printedTotal;
        rest = rest.slice(0, tail.index).trim();
      }

      const problems = [];
      if (!rest) problems.push('nothing but a number on that line');

      return {
        line: i + 1,
        text: line,
        name: rest,          // still mixed with the set name; chunk 2 separates them
        number, printedTotal,
        setName: null, setCode: null, productId: null,
        variant: null, condition: null, language: 'en', rarity: null,
        grade: null, price: null,
        quantity,
        raw: [line],
        problems,
        skip: quantity <= 0 || problems.length > 0
      };
    });

    return {
      ok: true, freeText: true, delimiter: null, headers: [], mapping: {}, mappedFrom: {},
      unmapped: [], archetype: 'inventory', rows,
      counts: {
        total: rows.length,
        usable: rows.filter((r) => !r.skip).length,
        skipped: rows.filter((r) => r.skip).length,
        cards: rows.filter((r) => !r.skip).reduce((s, r) => s + r.quantity, 0)
      }
    };
  }

  /* Is this a table or is it a typed list? Called when somebody pastes
   * into the box rather than choosing a file, so we can run the right
   * one without asking them a question they should not have to think
   * about.
   */
  function looksLikeTable(text) {
    const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
    if (lines.length < 2) return false;
    const d = sniffDelimiter(text);
    const counts = lines.map((l) => l.split(d).length);
    return counts[0] >= 2 && counts.every((c) => c >= 2);
  }

  window.InfinitePullsImportParse = {
    parse, parseFreeText, looksLikeTable,
    // exported one by one so the tests and the mapping screen can use
    // them without going through a whole file
    sniffDelimiter, splitRows, findHeaderRow, mapColumns, fieldForHeader, fieldsForHeader,
    splitNumber, stripMoney, parseQuantity, parseGrade,
    normalizeCondition, normalizeVariant, normalizeLanguage, detectArchetype,
    CONDITIONS, VARIANTS, HEADERS
  };
})();
