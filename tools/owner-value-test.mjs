// YOUR VALUE on a graded card, tested without a database.
//
// Jeff's option A (26 Sep 2026): the owner types what their slab is worth
// and the collection total uses it. This checks the rules that decide WHEN
// that number counts, because getting it wrong either inflates somebody's
// total with a raw card's "slab price" or quietly ignores the number they
// typed. Both files carry their own copy of the helpers (collection.js and
// feed-next/feed.js are separate browser bundles), so both are checked and
// then checked against each other.
//
// Run: node tools/owner-value-test.mjs
import { readFileSync } from 'node:fs';

function grabFrom(src, file, name){
  let i = src.indexOf(`function ${name}(`);
  if(i < 0) throw new Error(`${file} no longer defines ${name}`);
  let depth = 0, k = src.indexOf('{', i);
  for(; k < src.length; k++){
    if(src[k] === '{') depth++;
    else if(src[k] === '}'){ depth--; if(!depth) break; }
  }
  return src.slice(i, k + 1);
}

const coll = readFileSync(new URL('../components/collection.js', import.meta.url), 'utf8');
const feed = readFileSync(new URL('../feed-next/feed.js', import.meta.url), 'utf8');

// Just the companies matter here, not the grade lists.
const LADDERS = 'const GRADE_LADDERS = { PSA:[], BGS:[], CGC:[], SGC:[], TAG:[] };';

const C = new Function(LADDERS + 'const OWNER_VALUE_WARN_X = 20; const OWNER_VALUE_BIG = 10000;' +
  ['isGradedCondition', 'parseOwnerValue', 'ownerValueOf', 'ownerValueWarning', 'groupOwnedRows']
    .map(n => grabFrom(coll, 'collection.js', n)).join('\n') +
  '; return { isGradedCondition, parseOwnerValue, ownerValueOf, ownerValueWarning, groupOwnedRows };')();

const F = new Function(LADDERS + 'const OWNER_VALUE_WARN_X = 20; const OWNER_VALUE_BIG = 10000;' +
  ['isGradedCond', 'parseOwnerValue', 'ownerValueWarning']
    .map(n => grabFrom(feed, 'feed.js', n)).join('\n') +
  '; return { isGradedCond, parseOwnerValue, ownerValueWarning };')();

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if(g === w){ pass++; console.log('  ok   ' + label); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const group = t => console.log('\n' + t);

group('which conditions are graded');
eq('PSA 10', C.isGradedCondition('PSA 10'), true);
eq('TAG 10 Pristine', C.isGradedCondition('TAG 10 Pristine'), true);
eq('lower case still reads', C.isGradedCondition('bgs 9.5'), true);
eq('Near Mint is raw', C.isGradedCondition('Near Mint'), false);
eq('empty is raw', C.isGradedCondition(''), false);
eq('a word that merely starts like a grader is raw', C.isGradedCondition('Pristine'), false);

group('reading what somebody typed');
eq('plain number', C.parseOwnerValue('230'), 230);
eq('dollar sign and comma', C.parseOwnerValue('$1,250'), 1250);
eq('cents round to two places', C.parseOwnerValue('99.999'), 100);
eq('blank means "not set"', C.parseOwnerValue(''), null);
eq('words are not a price', C.parseOwnerValue('a lot'), null);
eq('negative refused', C.parseOwnerValue('-5'), null);
eq('over a million refused (the database would too)', C.parseOwnerValue('2000000'), null);
eq('zero is a real answer', C.parseOwnerValue('0'), 0);

group('when the number counts');
eq('graded row with a value', C.ownerValueOf({ condition: 'PSA 10', owner_value: '245.00' }), 245);
eq('graded row without one', C.ownerValueOf({ condition: 'PSA 10', owner_value: null }), null);
eq('RAW row keeps counting at market even if a value is left over',
   C.ownerValueOf({ condition: 'Near Mint', owner_value: 245 }), null);
eq('no row', C.ownerValueOf(null), null);

group('"you sure?"');
eq('2x raw: quiet', C.ownerValueWarning(220, 109), '');
eq('exactly 20x: quiet', C.ownerValueWarning(2000, 100), '');
eq('50x raw: asks', /50× the raw price/.test(C.ownerValueWarning(5000, 100)), true);
eq('no raw price, $5,000: quiet', C.ownerValueWarning(5000, null), '');
eq('no raw price, $110,000: still asks', /big number/.test(C.ownerValueWarning(110000, null)), true);
eq('feed agrees on the no-price case', /big number/.test(F.ownerValueWarning(110000, null)), true);
eq('no value: quiet', C.ownerValueWarning(null, 100), '');

group('"you sure?" works off Cardmarket too (Japanese / vintage cards)');
const P = new Function('function currency(n){ return "$" + n.toFixed(2); }' +
  ['priceForSelection', 'rawUsdFor'].map(n => grabFrom(coll, 'collection.js', n)).join('\n') +
  '; return { rawUsdFor };')();
const cmOnly = { pricing: { tcgplayer: null, cardmarket: { trend: 1273 } } };
const tpCard = { pricing: { tcgplayer: { holofoil: { marketPrice: 1400 } } } };
eq('TCGplayer price read as-is', P.rawUsdFor(tpCard, 'holofoil', null), 1400);
eq('Cardmarket euros at the day\'s rate', P.rawUsdFor(cmOnly, 'holofoil', { rate: 1.1 }), 1273 * 1.1);
eq('Cardmarket euros still count before the rate loads', P.rawUsdFor(cmOnly, 'holofoil', null) > 1000, true);
eq('$110,000 on a $1,400 card asks (the one Mike caught)',
   /× the raw price/.test(C.ownerValueWarning(110000, P.rawUsdFor(tpCard, 'holofoil', null))), true);
eq('$110,000 on a Cardmarket-only $1,400 card asks too',
   /× the raw price/.test(C.ownerValueWarning(110000, P.rawUsdFor(cmOnly, 'holofoil', null))), true);
eq('no price anywhere: nothing to compare, quiet', P.rawUsdFor({ pricing: {} }, 'normal', null), null);

group('stacking never merges two different values');
const rows = [
  { id: 1, card_id: 'a', variant: 'holofoil', condition: 'PSA 10', cert_number: null, owner_value: 240, quantity: 1 },
  { id: 2, card_id: 'a', variant: 'holofoil', condition: 'PSA 10', cert_number: null, owner_value: 240, quantity: 1 },
  { id: 3, card_id: 'a', variant: 'holofoil', condition: 'PSA 10', cert_number: null, owner_value: 300, quantity: 1 },
];
const g = C.groupOwnedRows(rows);
eq('two lines, not one', g.length, 2);
eq('the matching pair stacks to 2', g.find(r => r.owner_value === 240).quantity, 2);
eq('no card lost or invented', g.reduce((s, r) => s + r.quantity, 0), 3);

group('the feed agrees with My Collection');
['PSA 10', 'TAG 9.5', 'Near Mint', 'Lightly Played', ''].forEach(c =>
  eq(`graded? "${c}"`, F.isGradedCond(c), C.isGradedCondition(c)));
['230', '$1,250', '', 'x', '-1', '0'].forEach(t =>
  eq(`parse "${t}"`, F.parseOwnerValue(t), C.parseOwnerValue(t)));
eq('both warn at 50x', !!F.ownerValueWarning(5000, 100) && !!C.ownerValueWarning(5000, 100), true);
eq('neither warns at 2x', !F.ownerValueWarning(200, 100) && !C.ownerValueWarning(200, 100), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
