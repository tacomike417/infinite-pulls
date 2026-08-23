// Checks the sealed-product logic that decides what somebody sees and
// what their collection is worth. Built on responses captured from the
// LIVE PokemonPriceTracker API, not on its documentation — the two
// disagree, and the disagreements are the interesting part.
//
// Run: node tools/sealed-test.mjs
import { readFileSync } from 'node:fs';

const jsSrc = readFileSync(new URL('../components/sealed.js', import.meta.url), 'utf8');
const tsSrc = readFileSync(new URL('../supabase/functions/sealed-price/index.ts', import.meta.url), 'utf8');

function grab(src, name){
  let i = src.indexOf(`function ${name}(`);
  if(i < 0) throw new Error(`${name} is gone — this check is out of date`);
  if(src.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0, k = src.indexOf('{', i);
  for(; k < src.length; k++){
    if(src[k] === '{') depth++;
    else if(src[k] === '}'){ depth--; if(!depth) break; }
  }
  return src.slice(i, k + 1);
}
// The three server functions under test are TypeScript. Rather than pull
// in a compiler for three functions, this strips annotations whose type is
// one of the primitive keywords — which is all these use, and which can't
// collide with an object literal like { code: text.slice(...) }.
const stripTypes = s => s.replace(
  /:\s*(?:string|number|boolean|any|unknown|void)(?:\s*\[\])?(?:\s*\|\s*null)?/g, ''
);

const client = new Function(
  grab(jsSrc, 'matchingSets') + grab(jsSrc, 'setLogoUrl') + grab(jsSrc, 'langOf') +
  grab(jsSrc, 'currency') + grab(jsSrc, 'escapeHtml') + grab(jsSrc, 'priceLabelHtml') +
  grab(jsSrc, 'sumOwned') +
  'const LANGUAGES = { en:{}, ja:{} };' +
  '; return { matchingSets, setLogoUrl, langOf, priceLabelHtml, sumOwned };')();

const server = new Function(
  stripTypes(grab(tsSrc, 'splitSetName')) + stripTypes(grab(tsSrc, 'scoreProductMatch')) + stripTypes(grab(tsSrc, 'numberOrNull')) +
  '; return { splitSetName, scoreProductMatch, numberOrNull };')();

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if(g === w){ pass++; console.log('  ok   ' + label); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const group = t => console.log('\n' + t);

group('THE NEAR MISS: a Booster Box is not a Booster Box Case');
// Real names and real prices, straight off the live API.
eq('an exact name matches', server.scoreProductMatch('Surging Sparks Booster Box', 'Surging Sparks Booster Box'), 2);
eq('the CASE is refused, not accepted as close enough',
   server.scoreProductMatch('Surging Sparks Booster Box', 'Surging Sparks Booster Box Case'), -1);
eq('so is the HALF box', server.scoreProductMatch('Surging Sparks Booster Box', 'Surging Sparks Half Booster Box'), -1);
eq('and the asked-for product does not match some other set\'s box',
   server.scoreProductMatch('Surging Sparks Booster Box', 'Evolving Skies Booster Box'), -1);
eq('the same words reordered is still the same product',
   server.scoreProductMatch('Booster Box Surging Sparks', 'Surging Sparks Booster Box'), 1);
eq('nothing matches nothing', server.scoreProductMatch('', 'Surging Sparks Booster Box'), -1);

group('Set names arrive prefixed with a code, which is what joins them to TCGdex');
eq('"SV08: Surging Sparks" splits', server.splitSetName('SV08: Surging Sparks'), { code:'SV08', label:'Surging Sparks' });
eq('a name with no code still works', server.splitSetName('Surging Sparks'), { code:'', label:'Surging Sparks' });
eq('junk does not throw', server.splitSetName(null), { code:'', label:'' });

group('The price field is unopenedPrice, which their docs do not mention');
eq('a real price is taken', server.numberOrNull(307.09), 307.09);
eq('a string price is taken', server.numberOrNull('307.09'), 307.09);
eq('zero is not a price', server.numberOrNull(0), null);
eq('and neither is absent', server.numberOrNull(undefined), null);

group('A price never claims to be something it is not');
eq('TCGplayer is called a market price',
   client.priceLabelHtml({ price: 307.09, priceSource:'tcgplayer' }).includes('market'), true);
eq('eBay is called an ASKING price',
   client.priceLabelHtml({ price: 89.5, priceSource:'ebay' }).includes('eBay asking'), true);
eq('and an eBay figure is never labelled a market price',
   client.priceLabelHtml({ price: 89.5, priceSource:'ebay' }).includes('>market<'), false);
eq('no price says so plainly', client.priceLabelHtml(null).includes('No price found'), true);
eq('so does a product that was never made',
   client.priceLabelHtml({ price: null, notFound: true }).includes('No price found'), true);

group('THE POINT: an unpriced box adds nothing to a total, it is not guessed at');
const OWNED = [
  { product_id:'tcgplayer:565606', quantity:2 },              // $307.09 each
  { product_id:'derived:SV8:gift-box:ja', quantity:1 },       // never made
  { product_id:'derived:SV8:booster-box:ja', quantity:1 },    // $89.50, eBay
];
const PRICES = {
  'tcgplayer:565606':          { price: 307.09, priceSource:'tcgplayer' },
  'derived:SV8:gift-box:ja':   { price: null, notFound: true },
  'derived:SV8:booster-box:ja':{ price: 89.50, priceSource:'ebay' },
};
eq('two boxes plus a Japanese box, phantom counted as nothing',
   client.sumOwned(OWNED, PRICES), { total: 703.68, anyMissing: true });
eq('nothing missing means nothing flagged',
   client.sumOwned([OWNED[0]], PRICES), { total: 614.18, anyMissing: false });
eq('an empty shelf is zero, not an error', client.sumOwned([], PRICES), { total: 0, anyMissing: false });
eq('a box whose price never loaded is flagged, not treated as free',
   client.sumOwned([{ product_id:'unknown', quantity: 1 }], PRICES), { total: 0, anyMissing: true });

group('Sets are offered newest first');
const SETS = [
  { id:'base1', name:'Base Set',       logo:'https://x/base1/logo', order:0, lang:'en' },
  { id:'sv08',  name:'Surging Sparks', logo:'https://x/sv08/logo',  order:1, lang:'en' },
  { id:'me05',  name:'Pitch Black',    logo:null,                   order:2, lang:'en' },
];
eq('everything, newest first', client.matchingSets(SETS, '').map(s => s.id), ['me05','sv08','base1']);
eq('a name search still sorts newest first', client.matchingSets(SETS, 's').map(s => s.id), ['sv08','base1']);
eq('an exact set id matches', client.matchingSets(SETS, 'base1').map(s => s.id), ['base1']);
eq('searching does not reorder the caller\'s list', SETS.map(s => s.id), ['base1','sv08','me05']);
eq('a set with no logo stays null', client.setLogoUrl(null), null);
eq('and one with a logo becomes an image url', client.setLogoUrl('https://x/logo'), 'https://x/logo.png');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
