/* The collection import resolver, against fixtures taken from the live
 * TCGdex API rather than from its documentation.
 *
 * The set shapes below are real. base1 and swsh3 really do number their
 * cards "1, 2, 3"; sv08.5, sv03.5, sv01 and me05 really do number theirs
 * "001, 002, 003"; the abbreviations really are BS, DAA, PRE, MEW, SVI
 * and PBL; and A4 really is a Pokemon TCG Pocket set sitting in the same
 * English database as the paper ones. All of that was read off the API,
 * because two of the three things the written sources said turned out to
 * be wrong.
 *
 * No network here on purpose. A test that depends on TCGdex being up is
 * a test that fails for reasons that are not our fault.
 */
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const pad = (n, w) => String(n).padStart(w, '0');

// cards(count, width) — width 0 means unpadded, as base1 and swsh3 are
const cards = (setId, count, width, names = {}) =>
  Array.from({ length: count }, (_, i) => {
    const localId = width ? pad(i + 1, width) : String(i + 1);
    return {
      id: `${setId}-${localId}`,
      localId,
      name: names[i + 1] || `Card ${i + 1}`,
      image: `https://assets.tcgdex.net/en/x/${setId}/${localId}`
    };
  });

const FULL = {
  base1: {
    id: 'base1', name: 'Base Set', serie: { id: 'base', name: 'Base' },
    abbreviation: { official: 'BS' },
    cardCount: { official: 102, total: 102 },
    cards: cards('base1', 102, 0, { 4: 'Charizard', 2: 'Blastoise', 58: 'Pikachu' })
  },
  swsh3: {
    id: 'swsh3', name: 'Darkness Ablaze', serie: { id: 'swsh', name: 'Sword & Shield' },
    abbreviation: { official: 'DAA' },
    cardCount: { official: 189, total: 201 },
    cards: cards('swsh3', 201, 0, { 136: 'Charizard V' })
  },
  'sv08.5': {
    id: 'sv08.5', name: 'Prismatic Evolutions', serie: { id: 'sv', name: 'Scarlet & Violet' },
    abbreviation: { official: 'PRE' },
    cardCount: { official: 131, total: 180 },
    cards: cards('sv08.5', 180, 3, { 60: 'Umbreon ex', 161: 'Umbreon ex', 1: 'Exeggcute' })
  },
  'sv03.5': {
    id: 'sv03.5', name: '151', serie: { id: 'sv', name: 'Scarlet & Violet' },
    abbreviation: { official: 'MEW' },
    cardCount: { official: 165, total: 207 },
    cards: cards('sv03.5', 207, 3, { 199: 'Charizard ex' })
  },
  sv01: {
    id: 'sv01', name: 'Scarlet & Violet', serie: { id: 'sv', name: 'Scarlet & Violet' },
    abbreviation: { official: 'SVI' },
    cardCount: { official: 198, total: 258 },
    cards: cards('sv01', 258, 3)
  },
  me05: {
    id: 'me05', name: 'Pitch Black', serie: { id: 'me', name: 'Mega Evolution' },
    abbreviation: { official: 'PBL' },
    cardCount: { official: 84, total: 120 },
    cards: cards('me05', 120, 3)
  },
  xy12: {
    id: 'xy12', name: 'Evolutions', serie: { id: 'xy', name: 'XY' },
    abbreviation: { official: 'EVO' },
    cardCount: { official: 108, total: 113 },
    cards: cards('xy12', 113, 0, { 11: 'Charizard' })
  },
  // Checked live: 305 cards, and promo sets carry NO abbreviation at all,
  // so this one can only ever be found by its name.
  swshp: {
    id: 'swshp', name: 'SWSH Black Star Promos', serie: { id: 'swsh', name: 'Sword & Shield' },
    cardCount: { official: 305, total: 305 },
    cards: Array.from({ length: 305 }, (_, i) => ({
      id: `swshp-SWSH${pad(i + 1, 3)}`, localId: `SWSH${pad(i + 1, 3)}`,
      name: i + 1 === 284 ? 'Charizard V' : `Promo ${i + 1}`,
      image: `https://assets.tcgdex.net/en/swsh/swshp/SWSH${pad(i + 1, 3)}`
    }))
  },
  // Pokemon TCG Pocket — digital only, and it has no abbreviation.
  A4: {
    id: 'A4', name: 'Wisdom of Sea and Sky', serie: { id: 'tcgp', name: 'Pokémon TCG Pocket' },
    cardCount: { official: 200, total: 239 },
    cards: cards('A4', 239, 0, { 112: 'Umbreon ex' })
  }
};

const BRIEF = Object.values(FULL).map((s) => ({ id: s.id, name: s.name, cardCount: s.cardCount }));

// ------------------------------------------------------------------
// A stubbed TCGdex that counts what was asked of it
// ------------------------------------------------------------------
function makeApi(opts = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (opts.failSet && url.includes('/sets/' + opts.failSet)) {
      return { ok: false, status: 500, json: async () => null };
    }
    const m = url.match(/\/sets\/(.+)$/);
    if (m) {
      const set = FULL[decodeURIComponent(m[1])];
      return set
        ? { ok: true, status: 200, json: async () => set }
        : { ok: false, status: 404, json: async () => null };
    }
    if (url.endsWith('/sets')) return { ok: true, status: 200, json: async () => BRIEF };
    return { ok: false, status: 404, json: async () => null };
  };
  return { fetchImpl, calls };
}

// ------------------------------------------------------------------
const parseSrc = await readFile(new URL('../components/collection-import-parse.js', import.meta.url), 'utf8');
const resolveSrc = await readFile(new URL('../components/collection-import-resolve.js', import.meta.url), 'utf8');

function freshSandbox(pokemonData) {
  const sandbox = { window: {}, console, setTimeout, clearTimeout, fetch: undefined };
  sandbox.window.InfinitePullsPokemonData = pokemonData;
  vm.createContext(sandbox);
  vm.runInContext(parseSrc, sandbox);
  vm.runInContext(resolveSrc, sandbox);
  return { P: sandbox.window.InfinitePullsImportParse, R: sandbox.window.InfinitePullsImportResolve };
}

let { P, R } = freshSandbox(null);

let fails = 0, total = 0;
const check = (label, cond, extra = '') => {
  total++; if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  [' + extra + ']' : ''}`);
};
const eq = (label, got, want) => check(label, got === want, got === want ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const run = async (csv, opts = {}) => {
  ({ P, R } = freshSandbox(opts.pokemonData || null));   // caches must not leak between tests
  const api = makeApi(opts);
  const parsed = P.parse(csv);
  const out = await R.resolve(parsed.rows, { fetchImpl: api.fetchImpl, ...opts });
  return { ...out, calls: api.calls, parsed };
};

// ============================================================
console.log('--- the padding bug, which is the whole reason this file fetches sets ---');
// base1 counts 1,2,3 and sv08.5 counts 001,002,003, and the wrong form is
// a hard 404. Constructing card ids from the number would have silently
// failed on half of every import.
{
  const csv = [
    'Quantity,Name,Set,Card Number',
    '1,Charizard,Base Set,4/102',
    '1,Umbreon ex,Prismatic Evolutions,161/131',
    '1,Exeggcute,Prismatic Evolutions,1/131',
    '1,Charizard V,Darkness Ablaze,136/189'
  ].join('\n');
  const r = await run(csv);

  eq('all four matched', r.counts.matched, 4);
  eq('an unpadded set gives an unpadded id', r.results[0].values.card_id, 'base1-4');
  eq('a padded set gives a padded id', r.results[1].values.card_id, 'sv08.5-161');
  eq('...even when the file wrote "1"', r.results[2].values.card_id, 'sv08.5-001');
  eq('...and the other unpadded set too', r.results[3].values.card_id, 'swsh3-136');
  eq('the secret rare came through', r.results[1].values.card_name, 'Umbreon ex');
}

console.log('--- one request per set, not one per card ---');
{
  const rows = ['Quantity,Set,Card Number'];
  for (let i = 1; i <= 60; i++) rows.push(`1,Prismatic Evolutions,${i}/131`);
  for (let i = 1; i <= 40; i++) rows.push(`1,Base Set,${i}/102`);
  const r = await run(rows.join('\n'));

  eq('a hundred cards all matched', r.counts.matched, 100);
  eq('...on three requests', r.calls.length, 3, r.calls.join(' '));
  check('...being the set list and the two sets',
    r.calls.filter((u) => u.endsWith('/sets')).length === 1 &&
    r.calls.some((u) => u.endsWith('/sets/base1')) &&
    r.calls.some((u) => u.endsWith('/sets/sv08.5')));
}

console.log('--- Pokemon TCG Pocket is not in anybody\'s binder ---');
// A4 is a digital-only set sitting in the same English database. Its
// cards do not exist on cardboard.
{
  const r = await run('Quantity,Name,Set,Card Number\n1,Umbreon ex,Wisdom of Sea and Sky,112');
  eq('a Pocket set does not resolve', r.counts.matched, 0);
  eq('...it asks instead of guessing', r.counts.review, 1);
  check('...and says which set it could not place', /Wisdom of Sea and Sky/.test(r.results[0].reason), r.results[0].reason);

  const list = R.usableSets(BRIEF).map((s) => s.id);
  check('the Pocket set is filtered out of the set list', !list.includes('A4'), list.join(','));
  check('...and the paper ones are not', list.includes('base1') && list.includes('me05'));
}

console.log('--- set names as people actually write them ---');
{
  eq('exact', R.resolveSetByName('Prismatic Evolutions', BRIEF).id, 'sv08.5');
  eq('case and punctuation do not matter', R.resolveSetByName('prismatic  evolutions', BRIEF).id, 'sv08.5');
  eq('a series prefix comes off', R.resolveSetByName('Sword & Shield—Darkness Ablaze', BRIEF).id, 'swsh3');
  eq('...however it is spelled', R.resolveSetByName('Sword and Shield Darkness Ablaze', BRIEF).id, 'swsh3');
  eq('"151" is a real set name', R.resolveSetByName('151', BRIEF).id, 'sv03.5');
  eq('...and so is the long way of writing it', R.resolveSetByName('Scarlet & Violet 151', BRIEF).id, 'sv03.5');
  eq('"Base" means Base Set', R.resolveSetByName('Base', BRIEF).id, 'base1');
  eq('...and so does the shadowless note people add', R.resolveSetByName('Base Set (Shadowless)', BRIEF).id, 'base1');
  eq('"Evolutions" is its own set, not Prismatic', R.resolveSetByName('Evolutions', BRIEF).id, 'xy12');
  eq('something that is not a set at all resolves to nothing', R.resolveSetByName('My Binder', BRIEF), null);
}

console.log('--- an ambiguous set name is a question, not a guess ---');
{
  // "Scarlet" is inside both "Scarlet & Violet" and nothing else here,
  // but a partial that hits two sets must refuse.
  const twoSets = BRIEF.concat([{ id: 'zz1', name: 'Prismatic Skies', cardCount: {} }]);
  eq('two sets containing the word means no answer', R.resolveSetByName('Prismatic', twoSets), null);
  eq('one set containing it is fine', R.resolveSetByName('Ablaze', BRIEF).id, 'swsh3');
}

console.log('--- set codes, when the file has no set name ---');
{
  const csv = 'Quantity,Name,Set Code,Card Number\n1,Charizard,BS,4\n1,Umbreon ex,PRE,161';
  const r = await run(csv);
  eq('both matched off the code alone', r.counts.matched, 2);
  eq('BS is Base Set', r.results[0].values.set_id, 'base1');
  eq('PRE is Prismatic Evolutions', r.results[1].values.set_id, 'sv08.5');
}

console.log('--- a set name beats a set code, and costs nothing ---');
{
  const csv = 'Quantity,Name,Set,Set Code,Card Number\n1,Charizard,Base Set,BS,4';
  const r = await run(csv);
  eq('matched', r.counts.matched, 1);
  eq('...on two requests, with no code sweep', r.calls.length, 2, r.calls.join(' '));
}

console.log('--- the number matched but it is the wrong card ---');
// This is what a wrong set looks like: number 4 exists in Base Set and
// it is Charizard, but the file says Blastoise. Never accepted silently.
{
  const r = await run('Quantity,Name,Set,Card Number\n1,Blastoise,Base Set,4');
  eq('it goes to review', r.counts.review, 1);
  eq('...and not into the collection', r.counts.matched, 0);
  check('...with both names in the reason',
    /Charizard/.test(r.results[0].reason) && /Blastoise/.test(r.results[0].reason), r.results[0].reason);
}

console.log('--- a lazily written name is still the right card ---');
// If the set and number agree, "Charizard" for "Charizard ex" is somebody
// being brief, not a mismatch.
{
  const r = await run('Quantity,Name,Set,Card Number\n1,Charizard,151,199/165');
  eq('accepted', r.counts.matched, 1);
  eq('...as the card the set actually holds', r.results[0].values.card_name, 'Charizard ex');
}

console.log('--- rows with a name but no number ---');
{
  const r = await run('Quantity,Name,Set\n1,Charizard,Base Set\n1,Umbreon ex,Prismatic Evolutions');
  eq('a name unique in its set is accepted', r.results[0].status, 'matched');
  eq('...as the right card', r.results[0].values.card_id, 'base1-4');
  eq('a name that appears twice is a question', r.results[1].status, 'review');
  check('...and it says how many', /2 cards/.test(r.results[1].reason), r.results[1].reason);
  check('...and offers them to choose from', (r.results[1].candidates || []).length === 2);
}

console.log('--- a number that is not in the set ---');
{
  const r = await run('Quantity,Name,Set,Card Number\n1,Charizard,Base Set,999');
  eq('review, not a wrong card', r.results[0].status, 'review');
  check('...saying so plainly', /no card numbered 999 in Base Set/.test(r.results[0].reason), r.results[0].reason);
}

console.log('--- promo numbers ---');
// TCGplayer writes 284 for what the set calls SWSH284.
{
  const r = await run('Quantity,Name,Set,Card Number\n1,Charizard V,SWSH Black Star Promos,284');
  eq('the set prefix is worked out from the set itself', r.results[0].status, 'matched');
  eq('...giving the real id', r.results[0].values.card_id, 'swshp-SWSH284');

  const written = await run('Quantity,Name,Set,Card Number\n1,Charizard V,SWSH Black Star Promos,SWSH284');
  eq('and it works when the file wrote it out in full', written.results[0].values.card_id, 'swshp-SWSH284');
}

console.log('--- one broken set does not sink the import ---');
{
  const csv = [
    'Quantity,Name,Set,Card Number',
    '1,Charizard,Base Set,4',
    '1,Umbreon ex,Prismatic Evolutions,161'
  ].join('\n');
  const r = await run(csv, { failSet: 'base1' });
  eq('the set that loaded still imported', r.counts.matched, 1);
  eq('...and the one that did not is a question', r.counts.review, 1);
  check('...naming the set', /Base Set/.test(r.results[0].reason), r.results[0].reason);
}

console.log('--- the card database being down ---');
{
  const bad = async () => ({ ok: false, status: 503, json: async () => null });
  ({ P, R } = freshSandbox(null));
  const parsed = P.parse('Quantity,Name,Set,Card Number\n1,Charizard,Base Set,4');
  const r = await R.resolve(parsed.rows, { fetchImpl: bad });
  eq('nothing is imported', r.counts.matched, 0);
  eq('...everything waits', r.counts.review, 1);
  check('...and it says why', /could not reach/.test(r.results[0].reason), r.results[0].reason);
}

console.log('--- rows chunk 1 already gave up on ---');
{
  const r = await run('Quantity,Name,Set,Card Number\n1,Charizard,Base Set,4\n1,,Base Set,\n0,Pikachu,Base Set,58');
  eq('the good one imported', r.counts.matched, 1);
  eq('...the unusable ones stayed failed', r.counts.failed, 2);
  check('...without being looked up', r.calls.length === 2, r.calls.join(' '));
}

console.log('--- the row that gets saved is the row the app already writes ---');
{
  const r = await run('Quantity,Name,Set,Card Number,Printing,Condition,Language\n3,Charizard,Base Set,4/102,Holofoil,Lightly Played,English');
  const v = r.results[0].values;
  eq('card_id', v.card_id, 'base1-4');
  eq('card_name', v.card_name, 'Charizard');
  eq('set_name', v.set_name, 'Base Set');
  eq('set_id', v.set_id, 'base1');
  eq('image_url is the thumbnail the grid uses', v.image_url, 'https://assets.tcgdex.net/en/x/base1/4/low.webp');
  eq('variant', v.variant, 'holofoil');
  eq('condition', v.condition, 'Lightly Played');
  eq('quantity', v.quantity, 3);
  eq('card_lang', v.card_lang, 'en');
  check('rarity and illustrator are left for the app to backfill',
    !('rarity' in v) && !('illustrator' in v), Object.keys(v).join(','));

  const plain = await run('Quantity,Name,Set,Card Number\n1,Charizard,Base Set,4');
  eq('a file that says nothing about printing gets normal', plain.results[0].values.variant, 'normal');
  eq('...and Near Mint', plain.results[0].values.condition, 'Near Mint');
}

console.log('--- My Pokedex lights up straight after an import ---');
// Costs nothing: the species roster is already in the app, so the dex
// number comes from the card name without asking TCGdex anything.
{
  const stub = { dexNumberFor: async (name) => (/charizard/i.test(name) ? 6 : null) };
  const r = await run('Quantity,Name,Set,Card Number\n1,Charizard,Base Set,4\n1,Card 7,Base Set,7',
    { pokemonData: stub });
  eq('a Pokemon card carries its dex number', r.results[0].values.dex_id, 6);
  check('a card that is not a Pokemon simply has none', !('dex_id' in r.results[1].values));

  const none = await run('Quantity,Name,Set,Card Number\n1,Charizard,Base Set,4');
  check('and a roster that has not loaded breaks nothing', none.counts.matched === 1);
}

console.log('--- progress is reported, because a big import is slow ---');
{
  ({ P, R } = freshSandbox(null));
  const api = makeApi();
  const rows = ['Quantity,Name,Set,Card Number'];
  for (let i = 1; i <= 30; i++) rows.push(`1,Card ${i},Base Set,${i}`);
  const seen = [];
  const parsed = P.parse(rows.join('\n'));
  await R.resolve(parsed.rows, { fetchImpl: api.fetchImpl, onProgress: (p) => seen.push(p) });
  check('it reports while reading sets', seen.some((p) => p.phase === 'sets'));
  check('...and while matching cards', seen.some((p) => p.phase === 'cards'));
  const last = seen.filter((p) => p.phase === 'cards').pop();
  check('...ending at the total', last && last.done === 30 && last.total === 30, JSON.stringify(last));
}

console.log('--- a second run costs nothing ---');
{
  ({ P, R } = freshSandbox(null));
  const api = makeApi();
  const csv = 'Quantity,Name,Set,Card Number\n1,Charizard,Base Set,4';
  const parsed = P.parse(csv);
  await R.resolve(parsed.rows, { fetchImpl: api.fetchImpl });
  const first = api.calls.length;
  await R.resolve(parsed.rows, { fetchImpl: api.fetchImpl });
  eq('the first run fetched', first, 2);
  eq('...and the second fetched nothing', api.calls.length, first);
}

console.log('--- names, in the shapes they arrive in ---');
{
  eq('accents are ignored', R.normName('Flabébé'), 'flabebe');
  eq('curly apostrophes are ignored', R.normName('Farfetch’d'), R.normName("Farfetch'd"));
  eq('em dashes are ignored', R.normName('Ho—Oh'), R.normName('Ho-Oh'));
  eq('ampersands read as "and"', R.normName('Scarlet & Violet'), 'scarlet and violet');
  check('an identical name scores 1', R.similarity('Umbreon ex', 'Umbreon ex') === 1);
  check('a different Pokemon scores near nothing', R.similarity('Charizard', 'Blastoise') < 0.2,
    R.similarity('Charizard', 'Blastoise').toFixed(2));
  check('the ex suffix is not thrown away',
    R.normName('Umbreon ex') !== R.normName('Umbreon'));
}

console.log('--- matchLocalId on its own ---');
{
  const padded = FULL['sv08.5'].cards, plainCards = FULL.base1.cards;
  eq('"1" into a padded set', R.matchLocalId('1', padded).localId, '001');
  eq('"001" into a padded set', R.matchLocalId('001', padded).localId, '001');
  eq('"4" into an unpadded set', R.matchLocalId('4', plainCards).localId, '4');
  eq('"004" into an unpadded set', R.matchLocalId('004', plainCards).localId, '4');
  eq('a number past the end is nothing', R.matchLocalId('999', plainCards), null);
  eq('an empty number is nothing', R.matchLocalId('', plainCards), null);
}

console.log(`\n${fails ? fails + ' OF ' + total + ' CHECKS FAILED' : total + ' CHECKS PASSED'}`);
process.exit(fails ? 1 : 0);
