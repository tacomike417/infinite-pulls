/* The eBay sold-comps link — the one number a deal actually closes on.
 *
 * Run:  node tools/test/ebay-sold.mjs
 *
 * card-states.mjs checks that the whole selection reaches the query. This
 * file checks the WORDS, which is a different way to be wrong:
 *   - leave the printing out and a 1st-edition shadowless Charizard comes
 *     back with unlimited copies at a fraction of the price, in the same
 *     list, presented as comparable sales;
 *   - put TCGplayer's word for it in and "holofoil" -- which almost no
 *     eBay seller types -- returns nothing, which reads as "this card
 *     never sells".
 *
 * Every check has been seen to FAIL. Four deliberate breakages:
 *   - dropping the printing from the query        -> 3 failures
 *   - passing the raw key instead of the term     -> 3
 *   - narrowing "normal" instead of leaving it    -> 1
 *   - losing LH_Sold                              -> 1
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', '..', 'components', 'collection.js'), 'utf8');
const a = src.indexOf('  const PSA_NAMES = {');
const b = src.indexOf('  // Two lists share this exact same search');
if (a < 0 || b < 0) throw new Error('collection.js no longer contains the selection model');

const esc = (v='') => String(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const mod = new Function('escapeHtml','currency','VARIANT_LABELS','TCGDEX_VARIANT_KEYS','isJapanese',
  src.slice(a, b) + '\nreturn { ebaySoldUrl, EBAY_PRINTING_TERMS, defaultSelection, gradesFor };'
)(esc, (n)=>'$'+n, { normal:'Normal' }, { normal:'normal' }, (c)=>!!(c&&c._lang==='ja'));

let pass = 0, fail = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}
const terms = (u) => decodeURIComponent(new URL(u).searchParams.get('_nkw'));

const CHARIZARD = { id:'base1-4', name:'Charizard', localId:'4', _lang:'en',
  set:{ id:'base1', name:'Base Set', cardCount:{ official:102 } },
  pricing:{ tcgplayer:{ normal:{marketPrice:1}, holofoil:{marketPrice:2},
    'reverse-holofoil':{marketPrice:3}, '1st-edition-holofoil':{marketPrice:4} } } };
const pick = (over) => Object.assign(mod.defaultSelection(CHARIZARD), over || {});

check('1st edition holo is named the way eBay sellers name it',
  terms(mod.ebaySoldUrl(CHARIZARD, pick({ finishKey:'1st-edition-holofoil' }))),
  'Charizard 4/102 Base Set 1st edition holo near mint');

check('reverse holo says "reverse holo", not "reverse-holofoil"',
  terms(mod.ebaySoldUrl(CHARIZARD, pick({ finishKey:'reverse-holofoil' }))).includes('reverse holo'), true);

check("TCGplayer's own spelling never reaches eBay",
  ['holofoil','reverse-holofoil','1st-edition-holofoil']
    .some(k => terms(mod.ebaySoldUrl(CHARIZARD, pick({ finishKey:k }))).includes(k)), false);

/* "normal" is a trap: no seller types it, and ANDing it excludes every
   genuine sale. */
check('the normal printing adds no word at all',
  terms(mod.ebaySoldUrl(CHARIZARD, pick({ finishKey:'normal' }))),
  'Charizard 4/102 Base Set near mint');

check('two printings give two different searches',
  terms(mod.ebaySoldUrl(CHARIZARD, pick({ finishKey:'holofoil' })))
    !== terms(mod.ebaySoldUrl(CHARIZARD, pick({ finishKey:'1st-edition-holofoil' }))), true);

/* The set name does the job the generic word "pokemon" used to, so only
   one of them goes in -- eBay ANDs every keyword and each one is another
   way to come back empty. */
check('the set name is in the query, and the filler word is not',
  [terms(mod.ebaySoldUrl(CHARIZARD, pick())).includes('Base Set'),
   terms(mod.ebaySoldUrl(CHARIZARD, pick())).includes('pokemon')], [true, false]);

check('a card with no set still gets something generic to hold onto',
  terms(mod.ebaySoldUrl({ id:'x', name:'Mystery', localId:'7' }, pick())).includes('pokemon'), true);

check('sold + completed filters are on the url',
  (u => [u.searchParams.get('LH_Sold'), u.searchParams.get('LH_Complete')])(new URL(mod.ebaySoldUrl(CHARIZARD, pick()))),
  ['1','1']);

check('no card, no url -- it never throws',
  mod.ebaySoldUrl(null, pick()), '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
