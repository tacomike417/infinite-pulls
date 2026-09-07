/* MOVERS & SHAKERS — the public board, rendered without a browser.
 *
 * This is the one page a stranger meets first, so what it SAYS matters as
 * much as whether it runs: that the floor is stated, that waiting does not
 * read as broken, that a card name out of the database cannot inject
 * markup, and that the page admits in its own footer which cards it
 * cannot rank. Those are the assertions below.
 *
 *     node tools/test/movers.mjs
 *
 * The shipped file is evaluated as-is against a fake window; only its
 * export line is rewritten, in memory, to reach the internals.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
let src = fs.readFileSync(path.join(here, '..', '..', 'components', 'movers.js'), 'utf8');
src = src.replace('window.InfinitePullsMovers = { init, shellHtml };',
  'window.InfinitePullsMovers = { init, shellHtml, rowHtml, boardHtml, waitingHtml, errorHtml, footNote, printing };');
const doc = { addEventListener(){}, getElementById(){ return null; } };
const win = {};
new Function('window','document', src)(win, doc);
const M = win.InfinitePullsMovers;
let fail = 0;
const ok = (n,c) => { console.log((c?'  ok  ':'  FAIL')+'  '+n); if(!c) fail++; };

const row = { card_id:'base1-4', name:'Charizard', set_name:'Base Set', number:'4/102',
              variant:'holofoil', then_price:186.00, now_price:247.05, pct:32.8,
              then_on:'2026-09-06', now_on:'2026-09-13' };
const faller = { ...row, card_id:'sv3-197', name:'Moonbreon', pct:-26.5,
                 then_price:412, now_price:302.8, variant:'normal' };

const up = M.rowHtml(row, 1);
console.log('row rendering');
ok('rank shown',                 up.includes('>1</span>'));
ok('name shown',                 up.includes('Charizard'));
ok('set and number joined',      up.includes('Base Set · 4/102'));
ok('printing humanised',         up.includes('Holofoil') && !up.includes('holofoil"'));
ok('normal printing hidden',     !M.rowHtml(faller,2).includes('Normal'));
ok('up gets green class',        up.includes('mv-move is-up') && up.includes('▲'));
ok('down gets red class',        M.rowHtml(faller,2).includes('mv-move is-down') && M.rowHtml(faller,2).includes('▼'));
ok('percent shown once',         up.includes('32.8%'));
ok('both prices shown',          up.includes('$186.00') && up.includes('$247.05'));
ok('links into lookup with q',   up.includes('?page=lookup&q=4%2F102'));
ok('is a real anchor',           up.trim().startsWith('<a class="mv-row"'));

console.log('escaping');
const nasty = { ...row, name: 'Ho-Oh <script>alert(1)</script>', set_name: `Neo "Revelation"` };
const esc = M.rowHtml(nasty, 1);
ok('script tag escaped',         !esc.includes('<script>') && esc.includes('&lt;script&gt;'));
ok('quotes escaped',             !/set_name="Neo "Revelation""/.test(esc) && esc.includes('&quot;'));

console.log('boards');
const b = M.boardHtml('up', [row, faller]);
ok('board titled',               b.includes('Rising this week'));
ok('board counts rows',          /mv-count">2</.test(b));
ok('empty board explains',       M.boardHtml('down', []).includes('Nothing fell by more than 3%'));
ok('empty board has no list',    !M.boardHtml('down', []).includes('<ol'));
ok('ranks run 1 then 2',         b.indexOf('class="mv-rank">1<') < b.indexOf('class="mv-rank">2<'));
ok('one rank per row',           (b.match(/class="mv-rank"/g)||[]).length === 2);

console.log('page shell');
const shell = M.shellHtml(b);
ok('h1 present for crawlers',    shell.includes('<h1>Movers &amp; Shakers</h1>'));
ok('states the $5 floor',        shell.includes('under $5'));
ok('cta after the boards',       shell.indexOf('mv-cta') > shell.indexOf('mv-board'));
ok('cta links to lookup',        shell.includes('href="?page=lookup"'));
ok('has a foot slot',            shell.includes('id="mv-foot"'));

console.log('honesty states');
ok('waiting is not an error',    M.waitingHtml().includes('still filling up') && !/error/i.test(M.waitingHtml()));
ok('waiting explains the wait',  M.waitingHtml().includes('seven days'));
ok('error offers a retry',       M.errorHtml().includes('data-mv-retry'));
ok('foot names both dates',      M.footNote([row]).includes('2026-09-06') && M.footNote([row]).includes('2026-09-13'));
ok('foot admits no JP cards',    M.footNote([row]).includes('Japanese'));
ok('foot empty with no rows',    M.footNote([]) === '');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail?1:0);
