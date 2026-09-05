/* Checks the local card index resolver in components/collection.js.
 *
 * Run:  node tools/test/local-index.mjs
 *
 * It does NOT copy the code it tests. It slices the real functions out of
 * components/collection.js as text and runs those, so this file cannot
 * quietly pass against a version of the code that no longer ships.
 *
 * Every check here has been seen to FAIL. Seven deliberate breakages were
 * run against it before it was committed:
 *   - querying the raw number instead of the normalised one     -> 2 failures
 *   - treating a Supabase error as "no rows" not a fall-through -> 1
 *   - dropping the set-total narrowing                          -> 3
 *   - treating a species-only name as the exact card name       -> 2
 *   - going blank instead of saying "English name not found"    -> 2
 *   - skipping escapeHtml on a card name                        -> 1
 *   - putting an English name under an English card             -> 1
 * A check that has only ever been seen to pass has not been seen to work.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, '..', '..', 'components', 'collection.js');
const src = fs.readFileSync(target, 'utf8');

function grab(startMarker, endMarker){
  const a = src.indexOf(startMarker);
  if(a < 0) throw new Error('collection.js no longer contains: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  if(b < 0) throw new Error('collection.js no longer contains: ' + endMarker);
  return src.slice(a, b);
}

const extracted = [
  grab('  function normalizeCardNumber(v){', '  function matchesCardNumber'),
  grab('  const LOCAL_HYDRATE_MAX = 8;', '  async function searchByNumber'),
].join('\n');

// ---- the world these functions live in, stubbed ------------------------
let DB_ROWS = [];          // what public.cards returns
let DB_ERROR = null;       // supabase { error }
let DB_THROWS = false;
let DB_PRESENT = true;
let LAST_QUERY = null;

const harness = `
  const LANGUAGES = { en:{}, ja:{} };
  const DEFAULT_LANG = 'en';
  function langOf(v){ return LANGUAGES[v] ? v : DEFAULT_LANG; }
  function client(){ return __env.dbPresent ? __env.db : null; }
  function cardLang(card){ return langOf(card && card._lang); }
  function isJapanese(card){ return cardLang(card) === 'ja'; }
  function escapeHtml(v=''){ return String(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
${extracted}
  return { localCardsByNumber, attachLocalRow, LOCAL_HYDRATE_MAX, normalizeCardNumber,
           englishNameFromRow, applyEnglishName, enNameLineHtml };
`;

const __env = {
  dbPresent: true,
  db: {
    from(table){
      LAST_QUERY = { table, filters:{}, select:null, limit:null };
      const q = {
        select(s){ LAST_QUERY.select = s; return q; },
        eq(k,v){ LAST_QUERY.filters[k]=v; return q; },
        limit(n){ LAST_QUERY.limit=n; return q; },
        then(res, rej){
          if(DB_THROWS) return Promise.reject(new Error('boom')).then(res,rej);
          return Promise.resolve({ data: DB_ROWS, error: DB_ERROR }).then(res, rej);
        },
      };
      return q;
    },
  },
};
const mod = new Function('__env', harness)(__env);

// ---- checks -------------------------------------------------------------
let pass = 0, fail = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

const row = (o) => Object.assign({ tcgdex_id:'x', language:'en', set_id:'sv3', set_total:'198', number_norm:'82' }, o);

// realistic: "082" scanned, three English cards share number_norm 82
const THREE = [
  row({ tcgdex_id:'sv3-082', set_id:'sv3', set_total:'198', collector_number:'082' }),
  row({ tcgdex_id:'sv4-082', set_id:'sv4', set_total:'182', collector_number:'082' }),
  row({ tcgdex_id:'svp-082', set_id:'svp', set_total:'0',   collector_number:'082' }),
];

await (async () => {
  // 1. the padded number reaches the index as the bare one
  DB_ROWS = THREE;
  await mod.localCardsByNumber('082', null, 'en', null);
  check('scanned 082 queries number_norm 82', LAST_QUERY.filters, { language:'en', number_norm:'82' });

  // 2. H01 -> H1 (the Aquapolis case the SQL normaliser also handles)
  await mod.localCardsByNumber('H01', null, 'en', null);
  check('scanned H01 queries number_norm H1', LAST_QUERY.filters.number_norm, 'H1');

  // 3. set total narrows to exactly one
  let r = await mod.localCardsByNumber('082', '198', 'en', null);
  check('set total 198 narrows to one card', [r.rows.map(x=>x.tcgdex_id), r.setTotalMissed], [['sv3-082'], false]);

  // 4. set total that no row has -> keeps all, flags the miss (same as TCGdex path)
  r = await mod.localCardsByNumber('082', '999', 'en', null);
  check('unknown set total keeps all + flags miss', [r.rows.length, r.setTotalMissed], [3, true]);

  // 5. set code beats set total
  r = await mod.localCardsByNumber('082', '198', 'en', 'SV4');
  check('set code SV4 wins over total 198', r.rows.map(x=>x.tcgdex_id), ['sv4-082']);

  // 6. a promo stored with total 0 is not silently matched by a real total
  r = await mod.localCardsByNumber('082', '0', 'en', null);
  check('total 0 finds the promo', r.rows.map(x=>x.tcgdex_id), ['svp-082']);

  // 7. language is honoured
  await mod.localCardsByNumber('082', null, 'ja', null);
  check('japanese search asks the ja rows', LAST_QUERY.filters.language, 'ja');
  await mod.localCardsByNumber('082', null, 'zz', null);
  check('unknown language falls back to en', LAST_QUERY.filters.language, 'en');

  // ---- every way this must give up quietly ----
  DB_ROWS = [];
  check('zero rows returns null (fall through)', await mod.localCardsByNumber('082','198','en',null), null);

  DB_ROWS = THREE; DB_ERROR = { message:'relation "cards" does not exist' };
  check('missing table returns null (fall through)', await mod.localCardsByNumber('082','198','en',null), null);
  DB_ERROR = null;

  DB_THROWS = true;
  check('thrown error returns null (fall through)', await mod.localCardsByNumber('082','198','en',null), null);
  DB_THROWS = false;

  __env.dbPresent = false;
  check('no supabase on page returns null (fall through)', await mod.localCardsByNumber('082','198','en',null), null);
  __env.dbPresent = true;

  check('empty number returns null', await mod.localCardsByNumber('','198','en',null), null);

  // ---- the hydrate ceiling ----
  const many = Array.from({length: 9}, (_,i) => row({ tcgdex_id:'s'+i+'-82', set_id:'s'+i, set_total:'' }));
  DB_ROWS = many;
  r = await mod.localCardsByNumber('82', null, 'en', null);
  check('9 matches is over the ceiling of 8', [r.rows.length, r.rows.length <= mod.LOCAL_HYDRATE_MAX], [9, false]);
  DB_ROWS = many.slice(0,8);
  r = await mod.localCardsByNumber('82', null, 'en', null);
  check('8 matches is within the ceiling', r.rows.length <= mod.LOCAL_HYDRATE_MAX, true);

  // ---- the row rides along on the card ----
  const card = { id:'sv3-082', name:'ピカチュウ' };
  mod.attachLocalRow(card, { name_english:'Pikachu' });
  check('english name attached for a japanese card', card._local.name_english, 'Pikachu');
  check('attachLocalRow survives a null card', mod.attachLocalRow(null, {}), null);


  // ---- the English name on a Japanese card --------------------------------
  const ja = (local) => ({ id:'sv3-82', name:'\u30d4\u30ab\u30c1\u30e5\u30a6', _lang:'ja', _local: local });

  // the three tiers the index calls trustworthy -> a bare name, no hedge
  for(const status of ['verified_name_map','verified_name_map_with_suffix','pokeapi_term_map']){
    check(`${status} gives a clean name`,
      mod.englishNameFromRow({ name_english:'Pikachu', translation_status: status }),
      { name:'Pikachu', note:'' });
  }

  // species_name_only is a name we are NOT sure about, and says so
  check('species_name_only is flagged, not passed off as the card name',
    mod.englishNameFromRow({ name_english:'Pikachu', translation_status:'species_name_only' }),
    { name:'Pikachu', note:'species name \u2014 not the exact card name' });

  // the 3,518
  check('untranslated says so instead of going blank',
    mod.englishNameFromRow({ name_english:'', translation_status:'untranslated' }),
    { name:'', note:'English name not found' });
  check('a null row says so too',
    mod.englishNameFromRow(null), { name:'', note:'English name not found' });

  // an unknown future tier is hedged rather than trusted
  check('an unrecognised tier is hedged',
    mod.englishNameFromRow({ name_english:'Pikachu', translation_status:'something_new' }),
    { name:'Pikachu', note:'closest match we have' });

  // ---- what actually reaches the screen ----
  let c = mod.applyEnglishName(ja({ name_english:'Pikachu', translation_status:'verified_name_map' }));
  check('verified japanese card renders the plain english name',
    mod.enNameLineHtml(c, 'detail').includes('Pikachu') && !mod.enNameLineHtml(c,'detail').includes('('),
    true);

  c = mod.applyEnglishName(ja({ name_english:'Pikachu', translation_status:'species_name_only' }));
  check('species-only card shows the hedge on screen',
    mod.enNameLineHtml(c, 'detail').includes('species name'), true);

  c = mod.applyEnglishName(ja({ name_english:'', translation_status:'untranslated' }));
  check('untranslated card shows "English name not found"',
    mod.enNameLineHtml(c, 'detail').includes('English name not found'), true);

  // an ENGLISH card must never get a second name under its first
  const en = { id:'sv3-82', name:'Pikachu', _lang:'en',
               _local:{ name_english:'Pikachu', translation_status:'verified_name_map' } };
  mod.applyEnglishName(en);
  check('english card gets no english-name line', [en._enName, mod.enNameLineHtml(en,'detail')], [undefined, '']);

  // a japanese card we never looked up stays silent -- it does NOT claim
  // "not found" for a card the index was never asked about
  check('japanese card with no index row renders nothing at all',
    mod.enNameLineHtml({ id:'x', _lang:'ja' }, 'detail'), '');

  // a hostile name cannot break out of the markup
  c = mod.applyEnglishName(ja({ name_english:'<img onerror=alert(1)>', translation_status:'verified_name_map' }));
  check('a name is escaped before it reaches the page',
    mod.enNameLineHtml(c, 'detail').includes('<img'), false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
