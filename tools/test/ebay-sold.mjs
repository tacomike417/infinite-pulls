/* Checks the eBay sold-comps link and the grading ladder.
 *
 * Run:  node tools/test/ebay-sold.mjs
 *
 * Both are sliced as text out of the real files, so this cannot pass
 * against code that no longer ships.
 *
 * WHY THIS FILE EXISTS. The sold link is the one number Jeff says a deal
 * actually closes on. Two ways to get it confidently wrong:
 *   - leave the printing out, and a 1st-edition shadowless Charizard comes
 *     back with unlimited copies at a fraction of the price, in the same
 *     list, presented as comparable sales;
 *   - put TCGplayer's word for the printing in, and "holofoil" -- which
 *     almost no eBay seller types -- returns nothing, which reads as
 *     "this card never sells".
 *
 * Every check has been seen to FAIL. Five deliberate breakages:
 *   - dropping the printing from the query        -> 4 failures
 *   - passing TCGplayer's key instead of the term -> 2
 *   - dropping the japanese qualifier             -> 1
 *   - narrowing "normal" instead of leaving it    -> 1
 *   - losing LH_Sold                              -> 1
 *   - putting the set name back in the query      -> 2
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, '..', '..', ...p), 'utf8');
const collection = read('components', 'collection.js');
const lookup = read('components', 'card-lookup.js');

function grab(src, a, b, what){
  const i = src.indexOf(a);
  if(i < 0) throw new Error(what + ' no longer contains: ' + a);
  const j = src.indexOf(b, i);
  if(j < 0) throw new Error(what + ' no longer contains: ' + b);
  return src.slice(i, j);
}

const mod = new Function(`
  function isJapanese(card){ return !!(card && card._lang === 'ja'); }
${grab(collection, '  const EBAY_PRINTING_TERMS = {', '  /* ---- The collection', 'collection.js')}
${grab(lookup, '  const GRADES = [', '  const GRADERS', 'card-lookup.js')}
  return { ebaySoldUrl, EBAY_PRINTING_TERMS, GRADES };
`)();

let pass = 0, fail = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}
const terms = (url) => decodeURIComponent(new URL(url).searchParams.get('_nkw'));

// The card that makes the case: 4 printings, wildly different money.
const CHARIZARD = { id:'base1-4', name:'Charizard', localId:'4',
  set:{ id:'base1', name:'Base Set', cardCount:{ official:102 } } };
const JAPANESE = { id:'M6-082', name:'ピカチュウ', localId:'082', _lang:'ja',
  set:{ id:'M6', name:'メガブレイブ', cardCount:{ official:100 } } };

// ---- the printing reaches the query, in eBay's words ----
check('1st edition holo is named the way eBay sellers name it',
  terms(mod.ebaySoldUrl(CHARIZARD, 'PSA 10', '1st-edition-holofoil')),
  'Charizard 4/102 1st edition holo PSA 10 pokemon');

check('reverse holo says "reverse holo", not "reverse-holofoil"',
  terms(mod.ebaySoldUrl(CHARIZARD, '', 'reverse-holofoil')).includes('reverse holo'), true);

check('TCGplayer\'s own spelling never reaches eBay',
  ['holofoil', 'reverse-holofoil', '1st-edition-holofoil']
    .some(k => terms(mod.ebaySoldUrl(CHARIZARD, '', k)).includes(k)), false);

// ---- "normal" is a trap: no seller types it ----
check('the normal printing adds no word at all',
  terms(mod.ebaySoldUrl(CHARIZARD, '', 'normal')),
  'Charizard 4/102 pokemon');

/* LIBERAL BY DEFAULT. eBay ANDs every keyword, so every word is another
   way to return nothing -- and an empty sold list reads as "this card
   never sells", not as "try fewer words". The chips are how somebody
   narrows; the query does not do it for them. */
check('the plainest lookup asks for three words, not seven',
  terms(mod.ebaySoldUrl(CHARIZARD, '', 'normal')).split(' ').length, 3);
check('the set name is not in the query -- the number already says the set',
  terms(mod.ebaySoldUrl(CHARIZARD, 'PSA 10', 'holofoil')).toLowerCase().includes('base set'), false);
check('the word "card" is not required of a listing title',
  terms(mod.ebaySoldUrl(CHARIZARD, 'PSA 10', 'holofoil')).includes('card'), false);

// ---- two printings must not produce the same search ----
check('two printings give two different searches',
  terms(mod.ebaySoldUrl(CHARIZARD, 'PSA 10', 'holofoil'))
    !== terms(mod.ebaySoldUrl(CHARIZARD, 'PSA 10', '1st-edition-holofoil')), true);

// ---- japanese cards must not return the english print ----
check('a japanese card asks for the japanese print',
  terms(mod.ebaySoldUrl(JAPANESE, 'PSA 10', null)).includes('japanese'), true);
check('an english card does not say japanese',
  terms(mod.ebaySoldUrl(CHARIZARD, 'PSA 10', 'holofoil')).includes('japanese'), false);

// ---- the search must be SOLD, completed ----
const u = new URL(mod.ebaySoldUrl(CHARIZARD, 'PSA 10', 'holofoil'));
check('sold + completed filters are on the url',
  [u.searchParams.get('LH_Sold'), u.searchParams.get('LH_Complete')], ['1', '1']);

// ---- degrading gracefully ----
check('no printing, no card, unknown key: never throws, never invents',
  [terms(mod.ebaySoldUrl(CHARIZARD, 'PSA 10', null)),
   mod.ebaySoldUrl(null, 'PSA 10', 'holofoil'),
   terms(mod.ebaySoldUrl(CHARIZARD, '', 'made-up-printing'))],
  ['Charizard 4/102 PSA 10 pokemon',
   '',
   'Charizard 4/102 pokemon']);

// ---- the ladder ----
check('every grader is represented, 8 through 10',
  mod.GRADES.map(g => g.key),
  ['raw','psa10','psa9','psa8','bgs10','bgs95','bgs9','cgc10','cgc95','cgc9','sgc10','sgc95']);

check('raw searches without a grade word',
  mod.GRADES.find(g => g.key === 'raw').query, '');

check('the query is the bare grade, not the adjective',
  mod.GRADES.filter(g => g.grader).map(g => g.query),
  ['PSA 10','PSA 9','PSA 8','BGS 10','BGS 9.5','BGS 9','CGC 10','CGC 9.5','CGC 9','SGC 10','SGC 9.5']);

check('every graded chip still carries its proper name for the reader',
  mod.GRADES.filter(g => g.grader).every(g => /Mint|Pristine/.test(g.full)), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
