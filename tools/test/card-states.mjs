/* Checks the one thing a card can be: raw at a condition, or in a slab.
 *
 * Run:  node tools/test/card-states.mjs
 *
 * CARD_STATES is now the single source for BOTH the value saved on a
 * collection row and the words added to the eBay search, on BOTH screens.
 * That is a lot resting on one table, so this checks the table itself.
 *
 * Every check has been seen to FAIL. Four deliberate breakages:
 *   - a graded state whose saved value is not its label  -> 1 failure
 *   - dropping the pre-merge condition spellings         -> 1
 *   - two states sharing a saved value                   -> 1
 *   - a raw condition contributing nothing to the search -> 1
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', '..', 'components', 'collection.js'), 'utf8');
const a = src.indexOf('  const CARD_STATES = [');
const b = src.indexOf('  function statePickerHtml', a);
if (a < 0 || b < 0) throw new Error('collection.js no longer contains CARD_STATES');
const mod = new Function(src.slice(a, b) + '\nreturn { CARD_STATES, STATE_GROUPS, DEFAULT_STATE, stateByKey, stateByValue, isGraded };')();

let pass = 0, fail = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}
const S = mod.CARD_STATES;

check('one axis: six raw conditions and eleven slab grades',
  mod.STATE_GROUPS.map(g => S.filter(s => s.group === g).length), [6, 3, 3, 3, 2]);

/* NOTHING ALREADY SAVED MAY BREAK. Rows written before the merge hold
   these five exact strings, and the edit form matches on the value. A
   changed spelling orphans every holding somebody owns. */
check('every pre-merge condition spelling still exists, character for character',
  ['Near Mint','Lightly Played','Moderately Played','Heavily Played','Damaged']
    .filter(v => !S.some(s => s.value === v)), []);

check('Near Mint is still the default the database column assumes',
  mod.stateByKey(mod.DEFAULT_STATE).value, 'Near Mint');

/* The saved value is the key the app groups holdings by (.eq('condition',
   ...)). Two states sharing one would silently merge two different cards
   into one holding. */
check('no two states share a saved value',
  S.length - new Set(S.map(s => s.value)).size, 0);
check('no two states share a key',
  S.length - new Set(S.map(s => s.key)).size, 0);

check('a graded row saves the grade itself, so the edit form can find it',
  S.filter(s => s.group !== 'Ungraded').every(s => s.value === s.query), true);

check('every state contributes something to the eBay search',
  S.filter(s => !s.query).map(s => s.key), []);

check('graded chips search the bare grade, not the adjective',
  S.filter(s => s.group === 'PSA').map(s => s.query), ['PSA 10','PSA 9','PSA 8']);

check('isGraded splits raw from slabbed and nothing lands in between',
  [S.filter(s => mod.isGraded(s)).length, S.filter(s => !mod.isGraded(s)).length], [11, 6]);

check('an unknown key falls back to the default rather than undefined',
  mod.stateByKey('nonsense').key, mod.DEFAULT_STATE);
check('a value saved before the merge still resolves to its chip',
  mod.stateByValue('Heavily Played').key, 'hp');
check('a value we have never seen resolves to null, not a wrong chip',
  mod.stateByValue('PSA 6.5'), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
