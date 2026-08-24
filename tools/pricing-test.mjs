// Checks what a card is worth in dollars, and — just as importantly —
// whether the app is honest about where that number came from.
//
// Built on the real API response for the card Jeff reported:
// svp-052 Mewtwo, SVP Black Star Promos, which has a Cardmarket price in
// euros and no TCGplayer price at all, and was therefore counting as zero
// in people's collections.
//
// Run: node tools/pricing-test.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../components/collection.js', import.meta.url), 'utf8');
function grab(name){
  let i = src.indexOf(`function ${name}(`);
  if(i < 0) throw new Error(`collection.js no longer defines ${name}`);
  if(src.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0, k = src.indexOf('{', i);
  for(; k < src.length; k++){
    if(src[k] === '{') depth++;
    else if(src[k] === '}'){ depth--; if(!depth) break; }
  }
  return src.slice(i, k + 1);
}
const api = new Function(
  [grab('cardmarketEur'), grab('usdValueFor'), grab('priceForVariant'),
   grab('setIdFromCardId'), grab('setInfoFor'), grab('matchesCardNumber'),
   grab('sortByNewestSet')].join('\n') +
  '; return { cardmarketEur, usdValueFor, priceForVariant, setIdFromCardId, setInfoFor, sortByNewestSet, matchesCardNumber };'
)();

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if(g === w){ pass++; console.log('  ok   ' + label); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const group = t => console.log('\n' + t);

// Verbatim from api.tcgdex.net/v2/en/cards/svp-052
const MEWTWO_PROMO = {
  id: 'svp-052', name: 'Mewtwo', rarity: 'Promo',
  variants: { firstEdition:false, holo:true, normal:false, reverse:false, wPromo:false },
  pricing: { tcgplayer: null, cardmarket: { unit:'EUR', avg:62.63, low:30, trend:65.65 } },
};
// A normal card, for contrast
const CHARIZARD = {
  id: 'sv03-125', name: 'Charizard ex',
  pricing: {
    tcgplayer: { unit:'USD', holofoil: { marketPrice: 12.34 } },
    cardmarket: { unit:'EUR', trend: 9.5 },
  },
};
const FX = { rate: 1.1699, date: '2026-08-21' };

group("JEFF'S BUG: a card with only a euro price counted as nothing");
eq('the old behaviour — TCGplayer alone finds no price',
   api.priceForVariant(MEWTWO_PROMO, 'holofoil'), null);
eq('the euro price is found', api.cardmarketEur(MEWTWO_PROMO, 'holofoil'), 65.65);
eq('and converted, the card is finally worth something',
   api.usdValueFor(MEWTWO_PROMO, 'holofoil', FX), { amount: 76.80, converted: true, euros: 65.65 });
eq('a roughly seventy dollar card no longer counts as zero',
   api.usdValueFor(MEWTWO_PROMO, 'holofoil', FX).amount > 70, true);

group('A converted figure is always flagged as converted');
eq('this one is', api.usdValueFor(MEWTWO_PROMO, 'holofoil', FX).converted, true);
eq('a real US market price is NOT', api.usdValueFor(CHARIZARD, 'holofoil', FX).converted, false);
eq('and a US price is preferred over converting, even when both exist',
   api.usdValueFor(CHARIZARD, 'holofoil', FX).amount, 12.34);

group('No rate means no number — never a guessed one');
eq('without a rate the card goes back to counting as nothing',
   api.usdValueFor(MEWTWO_PROMO, 'holofoil', null), { amount: null, converted: false });
eq('a nonsense rate is refused too',
   api.usdValueFor(MEWTWO_PROMO, 'holofoil', { rate: 0 }), { amount: null, converted: false });
eq('a card with neither price is still nothing',
   api.usdValueFor({ id:'x-1', pricing:{} }, 'normal', FX), { amount: null, converted: false });

group('Cardmarket quotes holo separately, so a holo variant uses holo figures');
const BOTH = { id:'x-1', pricing:{ cardmarket:{ trend: 4, 'trend-holo': 40 } } };
eq('a holo variant takes the holo figure', api.cardmarketEur(BOTH, 'holofoil'), 40);
eq('a reverse holo does too', api.cardmarketEur(BOTH, 'reverse-holofoil'), 40);
eq('a normal variant takes the plain one', api.cardmarketEur(BOTH, 'normal'), 4);
eq('trend wins over average', api.cardmarketEur({ pricing:{ cardmarket:{ trend: 5, avg: 9 } } }, 'normal'), 5);
eq('but average is used when there is no trend',
   api.cardmarketEur({ pricing:{ cardmarket:{ avg: 9 } } }, 'normal'), 9);
eq('zero is not a price', api.cardmarketEur({ pricing:{ cardmarket:{ trend: 0, avg: 9 } } }, 'normal'), 9);

group("A card's id carries its set, which is how 052/225 finds one card");
eq('svp-052 belongs to svp', api.setIdFromCardId('svp-052'), 'svp');
eq('a Japanese id works the same', api.setIdFromCardId('SV3-066'), 'SV3');
eq('so does a set id containing a dot', api.setIdFromCardId('sv10.5w-004'), 'sv10.5w');
eq('and one containing digits', api.setIdFromCardId('xy12-52'), 'xy12');
eq('an id with no hyphen has no set', api.setIdFromCardId('nonsense'), '');

const SET_INDEX = {
  svp:   { id:'svp',   name:'SVP Black Star Promos', cardCount:{ official:225 }, order:174 },
  base4: { id:'base4', name:'Base Set 2',            cardCount:{ official:130 }, order:9 },
};
eq('a brief with no set of its own still resolves one',
   api.setInfoFor({ id:'svp-052', localId:'052' }, SET_INDEX).name, 'SVP Black Star Promos');
eq('and it knows the set size, which is what 052/225 narrows on',
   api.setInfoFor({ id:'svp-052' }, SET_INDEX).cardCount.official, 225);
eq('an unknown set resolves to nothing rather than throwing',
   api.setInfoFor({ id:'zzz-1' }, SET_INDEX), null);

group('Leading zeros, which promos print and people do not type');
eq('052 matches 52', api.matchesCardNumber('052', '52'), true);
eq('52 matches 052', api.matchesCardNumber('52', '052'), true);
eq('but 5 does not match 52', api.matchesCardNumber('5', '52'), false);

group('Newest set first, now that a set can be found at all');
const CARDS = [{ id:'base4-52' }, { id:'svp-052' }, { id:'unknown-9' }];
eq('newer set leads, unknown sinks to the bottom',
   api.sortByNewestSet(CARDS, SET_INDEX).map(c => c.id), ['svp-052', 'base4-52', 'unknown-9']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
