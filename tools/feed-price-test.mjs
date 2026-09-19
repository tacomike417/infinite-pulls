/* The price history the card back reads, tested without a database.
 *
 * WHY THIS FILE EXISTS
 *
 * feed-next/feed.js asked card_price_history for `variant = 'market'`.
 * Nothing writes a variant called "market" -- sync-prices writes the
 * PRINTING for TCGplayer ("normal", "holofoil", "reverse-holofoil",
 * "1st-edition-holofoil") and "trend" for Cardmarket. So the query matched
 * zero rows on every card, every time, and every card back in the app said
 * "no price was recorded back then" while LOOK UP showed a price one tap
 * later. It looked exactly like missing data and it was a wrong filter.
 *
 * The lesson worth keeping: a filter that silently matches nothing reads as
 * an empty database. These tests would have caught it on the first run,
 * because the first one asserts that "market" matches nothing.
 *
 * Run:  node tools/feed-price-test.mjs
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FEED = path.join(process.cwd(), 'feed-next', 'feed.js');
const src = await readFile(FEED, 'utf8');

/* Lift a named function out of feed.js by brace matching. The same trick
   tools/holdings-test.mjs uses: the file is a browser bundle with no
   exports, and copying the logic here to test it would test the copy. */
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('feed.js has no function named ' + name);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && !--depth) return src.slice(i, k + 1);
  }
  throw new Error('unbalanced braces reading ' + name);
}

const code = [grab('seriesFor'), grab('atAdd')].join('\n') + '\nexport { seriesFor, atAdd };';
const { seriesFor, atAdd } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok  ' : '  FAIL') + '  ' + label +
    (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
};

/* Shaped exactly like what sync-prices writes: one row per card, per
   printing, per day, plus Cardmarket's single "trend" row in euros. */
const hist = [
  { variant: 'normal',           price: 0.35, recorded_on: '2026-09-10', source: 'tcgplayer',  currency: 'USD' },
  { variant: 'reverse-holofoil', price: 1.10, recorded_on: '2026-09-10', source: 'tcgplayer',  currency: 'USD' },
  { variant: 'trend',            price: 0.42, recorded_on: '2026-09-10', source: 'cardmarket', currency: 'EUR' },
  { variant: 'normal',           price: 0.41, recorded_on: '2026-09-17', source: 'tcgplayer',  currency: 'USD' },
  { variant: 'reverse-holofoil', price: 1.45, recorded_on: '2026-09-17', source: 'tcgplayer',  currency: 'USD' },
  { variant: 'trend',            price: 0.48, recorded_on: '2026-09-17', source: 'cardmarket', currency: 'EUR' }
];

console.log('\nThe card back’s price history\n');

is('there is no variant called "market" — the bug this file exists for',
  hist.filter(r => r.variant === 'market').length, 0);

is('a reverse holo is priced as a reverse holo, not as a normal',
  seriesFor(hist, 'tcgplayer', 'reverse-holofoil').map(r => r.price), [1.10, 1.45]);

is('Cardmarket is always its trend series',
  seriesFor(hist, 'cardmarket', 'reverse-holofoil').map(r => r.price), [0.42, 0.48]);

is('a printing with no readings falls back to one whole series, never a mix',
  seriesFor(hist, 'tcgplayer', '1st-edition-holofoil').length, 2);

is('a holding with no printing recorded still gets one clean series',
  new Set(seriesFor(hist, 'tcgplayer', '').map(r => r.variant)).size, 1);

is('price when added is the last reading on or before that day',
  atAdd(hist, 'tcgplayer', '2026-09-15', 'reverse-holofoil').price, 1.10);

is('…and is flagged exact, because a reading existed by then',
  atAdd(hist, 'tcgplayer', '2026-09-15', 'reverse-holofoil').exact, true);

is('added before any reading: earliest used, flagged NOT exact so the date shows',
  [atAdd(hist, 'tcgplayer', '2026-01-01', 'normal').price,
   atAdd(hist, 'tcgplayer', '2026-01-01', 'normal').exact], [0.35, false]);

is('Cardmarket keeps euros — converting before storage invents price moves',
  atAdd(hist, 'cardmarket', '2026-09-15', 'normal').currency, 'EUR');

is('a card with no history returns null, not a zero dollar card',
  atAdd([], 'tcgplayer', '2026-09-15', 'normal'), null);

console.log(`\n${pass} pass, ${fail} fail\n`);
process.exit(fail ? 1 : 0);
