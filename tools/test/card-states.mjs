/* The card-detail decision flow: finish, then graded-or-not, then the
 * condition or the grade, then a price that is honest about itself.
 *
 * Run:  node tools/test/card-states.mjs
 *
 * Sliced out of components/collection.js as text, so it cannot pass
 * against code that no longer ships.
 *
 * THE POINT OF THIS FILE. Three choices, and only ONE of them is a
 * pricing input. TCGplayer quotes a different market price for Normal,
 * Holofoil and Reverse Holo -- separate products, separate listings. No
 * marketplace we can reach prices condition or grade, so those two are
 * the collector describing their own copy: saved on their row, used to
 * build the eBay sold search, and they leave the figure alone.
 *
 * What that buys, and what it costs. It buys a number on screen every
 * time one exists, instead of a wall of caution hiding the one real
 * figure we have. It costs a label that has to stay honest -- the number
 * is an UNGRADED market price whatever grade is selected above it, and on
 * a Charizard rather than a Seedot that difference is real money.
 *
 * Every check has been seen to FAIL. Six deliberate breakages:
 *   - letting the condition change the figure        -> 1 failure
 *   - letting the grade change the figure            -> 1
 *   - calling the figure something other than ungraded -> 3
 *   - offering BGS half-grades on a PSA slab         -> 2
 *   - putting Mint back as a raw condition           -> 2
 *   - showing finishes the card was never printed in -> 1
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
  src.slice(a, b) + `
  return { RAW_CONDITIONS, DEFAULT_CONDITION, GRADE_COMPANIES, gradesFor, gradeEntry,
           conditionByKey, finishesFor, defaultSelection, selectionLabel,
           selectionCondition, priceForSelection, ebaySoldUrl, NO_PRICE_REASON };`
)(esc, (n)=> typeof n==='number' ? '$'+n.toFixed(2) : '—',
  { normal:'Normal', holofoil:'Holofoil', 'reverse-holofoil':'Reverse Holofoil', '1st-edition-holofoil':'1st Edition Holofoil' },
  { normal:'normal', holo:'holofoil', reverse:'reverse-holofoil' },
  (c)=>!!(c&&c._lang==='ja'));

let pass = 0, fail = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

const CARD = { id:'sv5-3', name:'Seedot', localId:'003', _lang:'en',
  set:{ id:'sv5', name:'Temporal Forces', cardCount:{ official:162 } },
  pricing:{ tcgplayer:{ unit:'USD', updated:'x',
      normal:{marketPrice:0.23}, holofoil:{marketPrice:0.36}, 'reverse-holofoil':{marketPrice:0.49} },
    cardmarket:{ trend:0.05 } } };
// One printing only. Offering three would be offering two that were never made.
const ONE = { id:'x-1', name:'Bulbasaur', localId:'1', _lang:'en',
  set:{ id:'x', name:'Base', cardCount:{ official:102 } },
  pricing:{ tcgplayer:{ holofoil:{marketPrice:9.99} } } };
// Japanese: TCGplayer is null on all 13,223 of them.
const JA = { id:'M6-082', name:'ピカチュウ', localId:'082', _lang:'ja',
  set:{ id:'M6', name:'メガブレイブ', cardCount:{ official:100 } },
  pricing:{ tcgplayer:null, cardmarket:{ trend:2.42 } } };

const sel = (over) => Object.assign(mod.defaultSelection(CARD), over || {});

/* ---- only the finishes this card actually has ---- */
check('a card with three printings offers three finishes',
  mod.finishesFor(CARD).map(f => f.key), ['normal','holofoil','reverse-holofoil']);
check('a card with one printing offers exactly one',
  mod.finishesFor(ONE).map(f => f.label), ['Holofoil']);

/* ---- the ungraded ladder ---- */
check('five raw conditions, and no separate Mint',
  mod.RAW_CONDITIONS.map(c => c.label), ['NM','LP','MP','HP','DMG']);
check('nothing raw is called Mint on its own',
  mod.RAW_CONDITIONS.some(c => c.value === 'Mint'), false);
check('the pre-merge spellings survive, so nothing already saved is orphaned',
  ['Near Mint','Lightly Played','Moderately Played','Heavily Played','Damaged']
    .filter(v => !mod.RAW_CONDITIONS.some(c => c.value === v)), []);

/* ---- each company's own ladder ---- */
check('PSA runs whole numbers plus 1.5, and no half grades',
  mod.gradesFor('PSA').map(g => g.value), ['10','9','8','7','6','5','4','3','2','1.5','1']);
check('BGS opens with Black Label then Pristine',
  mod.gradesFor('BGS').slice(0,3).map(g => g.value), ['10 Black Label','10 Pristine','9.5']);
check('CGC and SGC open with Pristine then Gem Mint',
  [mod.gradesFor('CGC')[0].value, mod.gradesFor('SGC')[0].value], ['10 Pristine','10 Pristine']);
check('a BGS 9.5 is not a grade PSA issues',
  mod.gradesFor('PSA').some(g => g.value === '9.5'), false);

/* ---- WHAT MAY BE CALLED A PRICE ---- */
check('the card gets the TCGplayer market figure, named for what it is',
  (({amount,source,basis}) => ({amount,source,basis}))(mod.priceForSelection(CARD, sel(), null)),
  { amount:0.23, source:'TCGplayer', basis:'Ungraded market' });

/* THE ONE PRICING INPUT. Three printings, three listings, three prices. */
check('the finish changes the figure',
  ['normal','holofoil','reverse-holofoil'].map(k => mod.priceForSelection(CARD, sel({finishKey:k}), null).amount),
  [0.23, 0.36, 0.49]);

/* AND THE TWO THAT ARE NOT. Nothing prices condition or grade, so
   describing your copy must not move the market figure -- in either
   direction. Blanking it out is as wrong as inflating it. */
check('the condition never moves the figure',
  ['nm','lp','mp','hp','dmg'].map(c => mod.priceForSelection(CARD, sel({condition:c}), null).amount),
  [0.23, 0.23, 0.23, 0.23, 0.23]);
check('the grade never moves the figure either',
  ['PSA','BGS','CGC','SGC'].map(co => mod.priceForSelection(CARD, sel({graded:true, company:co}), null).amount),
  [0.23, 0.23, 0.23, 0.23]);

/* ...which is only safe because the label says what the number is. A
   figure shown under a PSA 10 heading with no qualifier is how somebody
   reads a raw price as a slab price mid-negotiation. */
check('a slab still shows an UNGRADED figure, and says so',
  mod.priceForSelection(CARD, sel({graded:true, company:'PSA', grade:'10'}), null).basis, 'Ungraded market');
check('a played card says the same thing',
  mod.priceForSelection(CARD, sel({condition:'dmg'}), null).basis, 'Ungraded market');

check('a japanese card falls to Cardmarket, in euros, labelled as a trend',
  (({display,currency,basis}) => ({display,currency,basis}))(
    mod.priceForSelection(JA, mod.defaultSelection(JA), { rate:1.08 })),
  { display:'€2.42', currency:'EUR', basis:'Ungraded market trend' });

check('a card no marketplace lists says so rather than showing zero',
  mod.priceForSelection({ id:'x', name:'Ghost', pricing:{} }, sel(), null).reliable, false);

/* ---- what gets said, and what gets saved ---- */
check('the label names the whole selection',
  [mod.selectionLabel(CARD, sel()), mod.selectionLabel(CARD, sel({graded:true, company:'PSA', grade:'9'}))],
  ['Normal · NM', 'PSA 9']);
check('the saved condition is the selection, not always Near Mint',
  [mod.selectionCondition(sel()), mod.selectionCondition(sel({condition:'hp'})),
   mod.selectionCondition(sel({graded:true, company:'BGS', grade:'10 Black Label'}))],
  ['Near Mint', 'Heavily Played', 'BGS 10 Black Label']);

/* ---- the eBay query carries the whole selection ---- */
const terms = (u) => decodeURIComponent(new URL(u).searchParams.get('_nkw'));
check('a raw played card asks for the played card in its set',
  terms(mod.ebaySoldUrl(CARD, sel({finishKey:'holofoil', condition:'lp'}))),
  'Seedot 003/162 Temporal Forces holo lightly played');
check('a slab asks for the slab',
  terms(mod.ebaySoldUrl(CARD, sel({graded:true, company:'PSA', grade:'9'}))),
  'Seedot 003/162 Temporal Forces PSA 9');
check('a japanese card asks for the japanese print',
  terms(mod.ebaySoldUrl(JA, mod.defaultSelection(JA))).includes('japanese'), true);
check('sold and completed filters are on the url',
  (u => [u.searchParams.get('LH_Sold'), u.searchParams.get('LH_Complete')])(new URL(mod.ebaySoldUrl(CARD, sel()))),
  ['1','1']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
