/* MENU ROWS THAT HIDE UNTIL THERE IS SOMETHING BEHIND THEM.
 *
 * Events and Deals have never been filled in, and a row leading to "No
 * events posted yet" costs more trust than it earns. They hide themselves
 * and come back the moment Jeff posts something.
 *
 * The assertion that matters most is the LAST one: when the store data has
 * not arrived yet, the row is SHOWN. Hiding on uncertainty would make real
 * rows appear a beat late, or vanish under a thumb already moving.
 *
 *     node tools/test/nav-empty-pages.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', '..', 'components', 'navbar.js'), 'utf8');

function load(storeData) {
  const win = {};
  if (storeData !== undefined) win.InfinitePullsApp = { storeData: () => storeData };
  const doc = { addEventListener(){}, getElementById(){ return null; }, querySelectorAll(){ return []; } };
  new Function('window', 'document', src)(win, doc);
  return win.InfinitePullsNavbar;
}
const pages = (N) => N.menuItems().filter(i => i.page).map(i => i.page);

let fail = 0;
const ok = (n, c) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + n); if (!c) fail++; };

console.log('nothing posted');
let N = load({ events: [], deals: [] });
ok('Events hidden',              !pages(N).includes('events'));
ok('Deals hidden',               !pages(N).includes('deals'));
ok('everything else stays',      pages(N).includes('shop') && pages(N).includes('gallery')
                                 && pages(N).includes('hours') && pages(N).includes('contact'));
ok('the shop group survives',    N.menuItemsTrimmed().some(i => i.group === 'The shop'));

console.log('Jeff posts an event');
N = load({ events: [{ title: 'Prerelease' }], deals: [] });
ok('Events comes back',          pages(N).includes('events'));
ok('Deals still hidden',         !pages(N).includes('deals'));

console.log('both filled');
N = load({ events: [{}], deals: [{}] });
ok('both shown',                 pages(N).includes('events') && pages(N).includes('deals'));

console.log('malformed or missing data');
ok('missing keys -> hidden',     !pages(load({})).includes('events'));
ok('a string is not a list',     !pages(load({ events: 'soon' })).includes('events'));
ok('null is not a list',         !pages(load({ events: null })).includes('events'));

console.log('data has not arrived yet');
N = load(undefined);                       // no InfinitePullsApp at all
ok('unknown -> Events SHOWN',    pages(N).includes('events'));
ok('unknown -> Deals SHOWN',     pages(N).includes('deals'));
N = load(); N.hasContent && ok('hasContent is defensive', N.hasContent('events') === true);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
