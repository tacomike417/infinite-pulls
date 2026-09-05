/* Checks what the weekly price run decides to store.
 *
 * Run:  node tools/test/price-sync.mjs
 *
 * It slices priceRowsFor out of supabase/functions/sync-prices/index.ts as
 * text and runs that, so it cannot pass against a version that no longer
 * ships. (The function carries no type annotations for exactly this
 * reason -- it is valid JavaScript as written.)
 *
 * The fixtures below are REAL responses from api.tcgdex.net, fetched
 * 5 Sep 2026, not shapes anybody guessed. That matters here more than
 * usual: the last attempt at Cardmarket trends was built on a guess at
 * somebody else's schema and put a confident -46.2% on a card that had
 * not moved.
 *
 * Every check has been seen to FAIL. Five deliberate breakages were run
 * against it:
 *   - deleting the "updated"/"unit" skip-list              -> 1 failure
 *   - converting euros to dollars before storing           -> 3
 *   - using cardmarket avg7 instead of trend               -> 2
 *   - keeping zero and negative prices                     -> 1
 *   - dropping the trend-holo fallback                     -> 1
 *
 * The first of those caught nothing on the first attempt -- see the note
 * beside that check. It is the second vacuous test found in this codebase
 * today; both were found by breaking the code on purpose rather than by
 * reading the word PASS.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, '..', '..', 'supabase', 'functions', 'sync-prices', 'index.ts');
const src = fs.readFileSync(target, 'utf8');

const a = src.indexOf('function priceRowsFor(');
const b = src.indexOf('/* Runs `worker` over `items`', a);
if (a < 0 || b < 0) throw new Error('sync-prices/index.ts no longer contains priceRowsFor');
const priceRowsFor = new Function(src.slice(a, b) + '\nreturn priceRowsFor;')();

const TODAY = '2026-09-05';

/* ---- real API responses, trimmed to the pricing object ---- */

// en/swsh6-82 — Galarian Yamask. Two TCGplayer printings AND cardmarket.
const EN = { pricing: {
  cardmarket: { updated:'2026-09-05T15:06:41.327Z', unit:'EUR', idProduct:567190,
    avg:0.04, low:0.02, trend:0.04, avg1:0.06, avg7:0.05, avg30:0.04,
    'avg-holo':0.18, 'low-holo':0.02, 'trend-holo':0.21, 'avg1-holo':0.2,
    'avg7-holo':0.15, 'avg30-holo':0.18 },
  tcgplayer: { unit:'USD', updated:'2026-09-05T15:06:49.411Z',
    'reverse-holofoil': { productId:241749, lowPrice:0.05, midPrice:0.25, highPrice:999, marketPrice:0.23, directLowPrice:0.19 },
    'normal':           { productId:241749, lowPrice:0.01, midPrice:0.15, highPrice:999, marketPrice:0.12, directLowPrice:0.01 } },
} };

// ja/M6-082 — the Japanese half of the catalogue. tcgplayer is NULL.
const JA = { pricing: {
  cardmarket: { updated:'2026-09-05T15:06:41.415Z', unit:'EUR', idProduct:900108,
    avg:3.27, low:1.5, trend:2.42, avg1:2.49, avg7:2.84, avg30:3.11,
    'avg-holo':null, 'low-holo':null, 'trend-holo':0, 'avg1-holo':null,
    'avg7-holo':null, 'avg30-holo':null },
  tcgplayer: null,
} };

let pass = 0, fail = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

const en = priceRowsFor(EN, 'swsh6-82', TODAY);
const ja = priceRowsFor(JA, 'M6-082', TODAY);

// ---- the English card ----
check('an english card yields both printings and cardmarket',
  en.map(r => `${r.source}:${r.variant}`),
  ['tcgplayer:reverse-holofoil', 'tcgplayer:normal', 'cardmarket:trend']);

/* This one was VACUOUS at first. It asserted that the real response's
   "updated" and "unit" keys don't become printings -- but on the real
   response they are STRINGS, so the price guard drops them whatever the
   skip-list does. Deleting the skip-list entirely still passed.
   What actually needs defending is the day TCGdex makes one of those an
   object with a price-shaped field on it, which is precisely what the
   skip-list is for. So the fixture is one where the guard is the only
   thing standing between them and the table. */
check('a price-shaped "updated" or "unit" is still not a printing',
  priceRowsFor({ pricing: { tcgplayer: {
    updated: { marketPrice: 1.23 },
    unit:    { marketPrice: 4.56 },
    normal:  { marketPrice: 2.00 },
  } } }, 'x', TODAY).map(r => r.variant),
  ['normal']);

check('the real response\'s housekeeping keys never become printings',
  en.some(r => r.variant === 'updated' || r.variant === 'unit'), false);

check('tcgplayer stores marketPrice, not low/mid/high',
  en.filter(r => r.source === 'tcgplayer').map(r => r.price), [0.23, 0.12]);

check('tcgplayer rows are USD',
  en.filter(r => r.source === 'tcgplayer').every(r => r.currency === 'USD'), true);

// ---- the Japanese card: the whole reason cardmarket is here ----
check('a japanese card still produces a reading',
  ja.map(r => `${r.source}:${r.variant}`), ['cardmarket:trend']);

// ---- money ----
check('cardmarket is stored in euros, unconverted',
  ja.filter(r => r.source === 'cardmarket').map(r => [r.price, r.currency]),
  [[2.42, 'EUR']]);

check('cardmarket takes trend, not avg / avg7 / avg30 / low',
  en.find(r => r.source === 'cardmarket').price, 0.04);

// ---- the fallback, and its limit ----
check('trend-holo is used when trend is missing',
  priceRowsFor({ pricing:{ cardmarket:{ trend:null, 'trend-holo':9.5 } } }, 'x', TODAY)
    .map(r => r.price), [9.5]);

check('a trend-holo of 0 is not a price',    // the real ja/M6-082 has one
  priceRowsFor({ pricing:{ cardmarket:{ trend:null, 'trend-holo':0 } } }, 'x', TODAY), []);

// ---- nothing worthless gets stored ----
check('zero, negative, null and NaN prices are all dropped',
  priceRowsFor({ pricing:{ tcgplayer:{
    a:{marketPrice:0}, b:{marketPrice:-1}, c:{marketPrice:null},
    d:{marketPrice:NaN}, e:{marketPrice:'3.00'}, f:{marketPrice:3} } } }, 'x', TODAY)
    .map(r => r.variant), ['f']);

check('a card with no pricing at all yields nothing, quietly',
  [priceRowsFor({}, 'x', TODAY), priceRowsFor(null, 'x', TODAY),
   priceRowsFor({ pricing:{ tcgplayer:null, cardmarket:null } }, 'x', TODAY)],
  [[], [], []]);

// ---- the row is addressed the way the table expects ----
check('every row carries the four key columns',
  en.every(r => r.card_id === 'swsh6-82' && r.variant && r.recorded_on === TODAY && r.source),
  true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
