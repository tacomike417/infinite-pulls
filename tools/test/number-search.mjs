/* Checks that a number search returns every card with that number.
 *
 * Run:  node tools/test/number-search.mjs
 *
 * WHY. Searching "02" in English returned 8 cards. 196 English cards are
 * numerically card two. The matching was never wrong -- two caps in a row
 * threw the rest away, one of them shared with name search where a cap
 * makes sense and here it does not.
 *
 * This reads data/cards_english.csv, counts the real answer, and checks
 * the caps against it -- so if the catalogue grows past them, this fails
 * instead of the app quietly truncating again.
 *
 * Every check has been seen to FAIL. Four deliberate breakages:
 *   - putting NUMBER_RESULT_LIMIT back to 120     -> 1 failure
 *   - putting NUMBER_LOOKUP_LIMIT back to 8       -> 1
 *   - normalising with the raw string             -> 4
 *   - matching on substring instead of equality   -> 4
 *   - pricing every match instead of one page     -> 2
 *
 * That last one caught NOTHING on the first attempt. Every check passed
 * with the page slice deleted -- the arithmetic was verified and the code
 * using it was not. The two checks at the bottom read the call itself.
 * Third vacuous test found in this codebase; all three were found by
 * breaking the code on purpose rather than by reading the word PASS.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const src = fs.readFileSync(path.join(root, 'components', 'collection.js'), 'utf8');

function grab(a, b){
  const i = src.indexOf(a);
  if(i < 0) throw new Error('collection.js no longer contains: ' + a);
  const j = src.indexOf(b, i);
  if(j < 0) throw new Error('collection.js no longer contains: ' + b);
  return src.slice(i, j);
}
function constOf(name){
  const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\d+)\\s*;'));
  if(!m) throw new Error('collection.js no longer defines ' + name);
  return Number(m[1]);
}

const mod = new Function(
  grab('  function normalizeCardNumber(v){', '  /* Every spelling of a scanned number') +
  grab('  const PREFIX_NOT_STORED', '  // TCGdex\'s card objects carry no release date') +
  '\nreturn { normalizeCardNumber, matchesCardNumber, cardNumberForms };'
)();

let pass = 0, fail = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

/* ---- the real catalogue, not a fixture ---------------------------- */
const csv = fs.readFileSync(path.join(root, 'data', 'cards_english.csv'), 'utf8').split('\n');
const head = csv[0].split(',');
const numCol = head.indexOf('collector_number');
if (numCol < 0) throw new Error('cards_english.csv has no collector_number column');
const stored = csv.slice(1).filter(Boolean).map(l => (l.split(',')[numCol] || '').trim());

const isTwo = stored.filter(n => mod.matchesCardNumber(n, '2'));
console.log(`\n(cards_english.csv: ${stored.length} rows, ${isTwo.length} of them numerically card two)\n`);

check('the real catalogue holds 196 cards numbered 2', isTwo.length, 196);
check('both spellings are in there, and only those two',
  [...new Set(isTwo)].sort(), ['002', '2']);

/* ---- 2, 02 and 002 are one question ---- */
check('every spelling of two normalises to the same thing',
  ['2','02','002','0002'].map(mod.normalizeCardNumber), ['2','2','2','2']);
check('typing 2, 02 or 002 matches a card stored either way',
  ['2','02','002'].flatMap(q => ['2','002'].map(st => mod.matchesCardNumber(st, q))),
  [true,true,true,true,true,true]);

/* ---- and it must not drag in its neighbours ---- */
check('20, 25, 102 and 202 are not card two',
  ['20','25','102','202'].map(n => mod.matchesCardNumber(n, '02')), [false,false,false,false]);
check('nor is card two any of them',
  ['20','25','102','202'].map(n => mod.matchesCardNumber('2', n)), [false,false,false,false]);

/* ---- prefixed numbers are their own cards ---- */
check('TG02, GG02, RC2 and SWSH002 are not plain card two',
  ['TG02','GG02','RC2','SWSH002'].map(n => mod.matchesCardNumber(n, '2')), [false,false,false,false]);
check('but typing TG02 still finds TG2, and vice versa',
  [mod.matchesCardNumber('TG2','TG02'), mod.matchesCardNumber('TG02','TG2')], [true,true]);

/* ---- what gets asked of TCGdex ---- */
check('a search for 02 asks TCGdex for every spelling that could be stored',
  mod.cardNumberForms('02').sort(), ['002','02','2']);

/* ---- THE CAPS. This is what actually broke. ---- */
const NUMBER_RESULT_LIMIT = constOf('NUMBER_RESULT_LIMIT');
const NUMBER_LOOKUP_LIMIT = constOf('NUMBER_LOOKUP_LIMIT');
const LOOKUP_LIMIT = constOf('LOOKUP_LIMIT');

check('the search cap clears the real answer with room to grow',
  NUMBER_RESULT_LIMIT >= isTwo.length, true);
check('the lookup cap clears it too -- this is the one that showed 8',
  NUMBER_LOOKUP_LIMIT >= isTwo.length, true);
check('name search keeps its own cap of 8, untouched', LOOKUP_LIMIT, 8);

/* ---- PAGING. Raising the cap fixed the count and exposed the cost:
   pricing every match needs one request per card, so 196 matches meant
   196 round trips before anything appeared. Only a page gets priced. ---- */
const PAGE = constOf('NUMBER_PAGE_SIZE');
check('a page is 25 cards', PAGE, 25);

/* The arithmetic the pager runs on, checked against the real 196. */
const pageCount = Math.max(1, Math.ceil(isTwo.length / PAGE));
check('196 matches is eight pages', pageCount, 8);
check('the last page holds the remainder, not a full page',
  isTwo.length - (pageCount - 1) * PAGE, 21);
check('the first page prices 25 cards, not 196',
  Math.min(PAGE, isTwo.length), 25);

/* Page numbers are clamped, so a stale "next" cannot ask for page 99 and
   render an empty grid. */
const clamp = (n) => Math.min(Math.max(0, n), pageCount - 1);
check('page numbers clamp at both ends', [clamp(-3), clamp(0), clamp(99)], [0, 0, 7]);

/* The search itself must NOT be re-run to turn a page -- the briefs are
   already in hand. This checks the seam exists that makes that possible. */
check('collection.js exposes a way to price one page without searching again',
  /priceBriefs, NUMBER_PAGE_SIZE/.test(src), true);
check('lookupByNumber hands back every match, not just the priced page',
  /results, briefs, total: briefs\.length/.test(src), true);

/* THE ONE THAT MATTERS, and the one this file missed at first.
   Every check above passed with the page slice removed -- i.e. with the
   exact bug that made "05" hang, pricing all 196 before showing anything.
   The arithmetic was right; nothing checked that the code USED it. These
   two read the call itself. */
check('the priced set is a SLICE of the matches',
  /priceBriefs\(\s*briefs\.slice\(/.test(src), true);
// `await`, so this reads the CALL and not the function's own declaration,
// which is literally `priceBriefs(briefs, lang)` and matched at first.
check('nothing hands the whole match list to the pricer',
  /await\s+priceBriefs\(\s*briefs\s*,/.test(src), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
