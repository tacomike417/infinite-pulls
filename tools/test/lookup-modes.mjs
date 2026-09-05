/* Checks that Sealed Product is off the screen and still in the code.
 *
 * Run:  node tools/test/lookup-modes.mjs
 *
 * It slices the real declarations out of components/card-lookup.js rather
 * than copying them, so it cannot pass against a file that no longer says
 * what it says today.
 *
 * Every check here has been seen to FAIL. Three deliberate breakages were
 * run against it first:
 *   - dropping `hidden: true`                        -> 4 failures
 *   - letting readMode accept any remembered mode    -> 1
 *   - drawing the chips from MODES again             -> 1
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, '..', '..', 'components', 'card-lookup.js');
const src = fs.readFileSync(target, 'utf8');

function grab(a, b){
  const i = src.indexOf(a);
  if(i < 0) throw new Error('card-lookup.js no longer contains: ' + a);
  const j = src.indexOf(b, i);
  if(j < 0) throw new Error('card-lookup.js no longer contains: ' + b);
  return src.slice(i, j);
}

// The slice HAS to run past MODE_KEY. It didn't at first, which left the
// key undefined in here, which made every readMode() check return 'en' for
// the wrong reason -- including the one that was supposed to prove sealed
// gets redirected. It passed while proving nothing. The Japanese check
// below is what caught it.
const decls = grab('  const MODES = [', '  const sbWrap =')
            + grab('  function readMode() {', '  /* ---- The screen');

function build(text){
  return new Function('__store', `
    const localStorage = {
      getItem: (k) => (k in __store ? __store[k] : null),
      setItem: (k, v) => { __store[k] = String(v); },
    };
${text}
    return { MODES, VISIBLE_MODES, readMode, saveMode, modeMeta, setMode: (m) => { mode = m; } };
  `);
}

// `mode` is declared further down the real file; the slice above doesn't
// include it, so give the evaluated copy one.
const mod = build('  let mode = "en";\n' + decls)({});

let pass = 0, fail = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

const keys = (list) => list.map((m) => m.key);

// off the screen
check('the chips on offer are English and Japanese only',
  keys(mod.VISIBLE_MODES), ['en', 'ja']);

// still in the code — this is a hide, not a delete
check('sealed is still defined, just hidden',
  keys(mod.MODES), ['en', 'ja', 'sealed']);
check('sealed carries the hidden flag',
  mod.MODES.find((m) => m.key === 'sealed').hidden, true);

// the returning visitor who was last in Sealed Product
const withSaved = (v) => build('  let mode = "en";\n' + decls)({ 'infinite-pulls-lookup-mode': v });
check('a visitor last seen in sealed lands on English',
  withSaved('sealed').readMode(), 'en');
check('a visitor last seen in Japanese still lands on Japanese',
  withSaved('ja').readMode(), 'ja');
check('a nonsense saved mode lands on English',
  withSaved('banana').readMode(), 'en');

// nothing can end up with no mode at all
mod.setMode('sealed');
check('modeMeta never returns undefined, even asked for a hidden mode',
  !!mod.modeMeta() && mod.modeMeta().key, 'en');

// the chips are drawn from the narrowed list, not the full one
check('the chip row is built from VISIBLE_MODES',
  /\$\{VISIBLE_MODES\.map/.test(src), true);
check('no chip row is built from the full MODES list',
  /\$\{MODES\.map/.test(src), false);

// and the signed-out page stops advertising it
check('the signed-out blurb no longer promises sealed product',
  /or sealed product/.test(src), false);

// THE WAY BACK. Deleting one flag has to restore it, or the comment lies.
const restored = build('  let mode = "en";\n' + decls.replace(", hidden: true", ""))({});
check('deleting `hidden: true` brings sealed straight back',
  keys(restored.VISIBLE_MODES), ['en', 'ja', 'sealed']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
