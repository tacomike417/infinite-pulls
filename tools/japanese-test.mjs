// Checks the English → Japanese card bridge against the exact JSON shapes
// the live TCGdex API returns (captured from api.tcgdex.net/v2/ja, not
// invented), without needing the network.
//
// The thing being proved: somebody typing "Charizard" on a US keyboard
// ends up looking at Japanese cards, a Japanese card keeps enough English
// identity to be priced and counted, and none of it quietly mangles the
// English path that already worked.
//
// Run: node tools/japanese-test.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../components/collection.js', import.meta.url), 'utf8');

function grabFn(name){
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
function grabConst(name, close){
  const i = src.indexOf(`const ${name} = ${close === '}' ? '{' : '['}`);
  if(i < 0) throw new Error(`collection.js no longer defines ${name}`);
  let depth = 0, k = src.indexOf(close === '}' ? '{' : '[', i);
  const open = close === '}' ? '{' : '[';
  for(; k < src.length; k++){
    if(src[k] === open) depth++;
    else if(src[k] === close){ depth--; if(!depth) break; }
  }
  return src.slice(i, k + 2);
}

// ---- exactly what the live API returned, on 2026-08-23 ----------------
const JA_CHARIZARD_BY_DEX = [
  { id:'SM10-007', localId:'007', name:'レシラム&リザードンGX' },
  { id:'S12a-015', localId:'015', name:'かがやくリザードン', image:'https://assets.tcgdex.net/ja/S/S12a/015' },
  { id:'SV3-066',  localId:'066', name:'リザードンex',      image:'https://assets.tcgdex.net/ja/SV/SV3/066' },
];
const JA_CHARIZARD_BY_NAME = [
  { id:'SV3-066',  localId:'066', name:'リザードンex',      image:'https://assets.tcgdex.net/ja/SV/SV3/066' },
  { id:'SV2a-185', localId:'185', name:'リザードンex',      image:'https://assets.tcgdex.net/ja/SV/SV2a/185' },
];
const JA_CARD_DETAIL = {
  category:'Pokemon', id:'SV3-066', illustrator:'5ban Graphics', localId:'066',
  name:'リザードンex', rarity:'Double rare',
  set:{ cardCount:{ official:108, total:141 }, id:'SV3', name:'黒炎の支配者' },
  variants:{ firstEdition:false, holo:false, normal:true, reverse:false, wPromo:false },
  hp:330,
  pricing:{ cardmarket:{ unit:'EUR', avg:1.17, low:0.5, trend:1.05 }, tcgplayer:null },
};
const EN_CARD_DETAIL = {
  id:'sv3-125', localId:'125', name:'Charizard ex',
  set:{ cardCount:{ official:197 }, id:'sv3', name:'Obsidian Flames' },
  dexId:[6],
  variants:{ holo:true, normal:false, reverse:false, firstEdition:false },
  pricing:{ tcgplayer:{ unit:'USD', holofoil:{ marketPrice: 12.34 } }, cardmarket:{ trend: 9.5 } },
};

const calls = [];
async function fetchTcgdex(url){
  calls.push(url);
  if(url.includes('/ja/cards?dexId=eq:6')) return JA_CHARIZARD_BY_DEX;
  if(url.includes('/ja/cards?name='))      return JA_CHARIZARD_BY_NAME;
  if(url.includes('/en/cards?name='))      return [EN_CARD_DETAIL];
  return [];
}

// A stand-in for the PokéAPI layer, returning what pokeapi.co really does
// for Charizard: ja-Hrkt リザードン, ja-roma Lizardon.
const pokemonData = {
  dexNumberFor: async (name) => /charizard/i.test(name) ? 6 : null,
  japaneseNameFor: async (name) => /charizard/i.test(name)
    ? { dexNumber:6, english:'Charizard', japanese:'リザードン', romaji:'Lizardon' } : null,
};

const parts = [
  grabConst('LANGUAGES','}'),
  grabConst('VARIANT_LABELS','}'),
  grabConst('TCGDEX_VARIANT_KEYS','}'),
  "const TCGDEX_ROOT = 'https://api.tcgdex.net/v2';",
  "const DEFAULT_LANG = 'en';",
  'const SEARCH_RESULT_LIMIT = 120;',
  'let searchLang = "en";',
  grabFn('langOf'), grabFn('tcgdexBase'), grabFn('stampLang'), grabFn('stampAll'),
  grabFn('cardLang'), grabFn('isJapanese'),
  grabFn('searchCards'), grabFn('searchCardsByDex'), grabFn('searchJapaneseFromEnglish'),
  grabFn('ebayQueryFor'), grabFn('variantOptions'), grabFn('priceForVariant'),
  grabFn('currency'), grabFn('matchesCardNumber'),
].join('\n\n');

const api = new Function('fetchTcgdex','window', parts +
  '; return { searchCards, searchCardsByDex, searchJapaneseFromEnglish, ebayQueryFor, variantOptions, priceForVariant, isJapanese, cardLang, setLang: (l)=>{ searchLang = l; } };'
)(fetchTcgdex, { InfinitePullsPokemonData: pokemonData });

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if(g === w){ pass++; console.log('  ok   ' + label); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const group = t => console.log('\n' + t);

group('The language decides which database is asked');
calls.length = 0;
await api.searchCards('Charizard', 'en');
eq('English goes to /v2/en', calls[0].startsWith('https://api.tcgdex.net/v2/en/'), true);
calls.length = 0;
await api.searchCards('リザードン', 'ja');
eq('Japanese goes to /v2/ja', calls[0].startsWith('https://api.tcgdex.net/v2/ja/'), true);

group('THE POINT: an English keyboard reaches the Japanese database');
calls.length = 0;
const jp = await api.searchJapaneseFromEnglish('Charizard');
eq('typing "Charizard" returns Japanese cards', jp.cards.length > 0, true);
eq('the dex-number route ran first', calls.some(u => u.includes('dexId=eq:6')), true);
eq('it says which Pokémon it decided you meant', jp.species.english, 'Charizard');
eq('and what that is in Japanese', jp.species.japanese, 'リザードン');
eq('every result is stamped as Japanese', jp.cards.every(c => api.isJapanese(c)), true);
eq('the two routes are merged without duplicating SV3-066',
   jp.cards.filter(c => c.id === 'SV3-066').length, 1);

group('A Trainer or a misspelling is told the truth, not shown nothing');
const nope = await api.searchJapaneseFromEnglish("Professor's Research");
eq('reason is given', nope.reason, 'not-a-pokemon');
eq('and no cards are invented', nope.cards.length, 0);

group('A Japanese card is still priceable and still addable');
const ja = { ...JA_CARD_DETAIL, _lang:'ja', _enName:'Charizard', _dexId:6 };
eq('eBay is searched the way a US listing is actually titled',
   api.ebayQueryFor(ja), 'Charizard SV3 066 japanese pokemon card');
eq('an English card keeps its old eBay query',
   api.ebayQueryFor({ ...EN_CARD_DETAIL, _lang:'en' }), 'Charizard ex Obsidian Flames pokemon card');
eq('the variant picker no longer collapses to "no pricing available"',
   api.variantOptions(ja), [{ value:'normal', label:'Normal' }]);
eq('an English card still lists its priced printings',
   api.variantOptions({ ...EN_CARD_DETAIL, _lang:'en' }), [{ value:'holofoil', label:'Holofoil — $12.34' }]);

group('Euros never leak into the dollar total');
eq('a Japanese card contributes no dollar value', api.priceForVariant(ja, 'normal'), null);
eq('even though it does have a Cardmarket euro figure', typeof ja.pricing.cardmarket.trend, 'number');
eq('an English card still returns its dollar market price',
   api.priceForVariant({ ...EN_CARD_DETAIL, _lang:'en' }, 'holofoil'), 12.34);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
