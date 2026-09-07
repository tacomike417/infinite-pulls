/* THE MOVERS RAIL on the home page — rendered without a browser.
 *
 * The arrows carry no words, so what they mean has to be carried by the
 * markup instead: which one is pressed, what a screen reader is told, and
 * that the up view is what somebody sees first. Those are assertions here
 * rather than something to remember.
 *
 *     node tools/test/home-movers-rail.mjs
 *
 * The shipped file is evaluated as-is; only its export line is rewritten,
 * in memory, to reach the internals and to set the rail's state directly.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
let src = fs.readFileSync(path.join(here, '..', '..', 'components', 'home-mine.js'), 'utf8');
src = src.replace('window.InfinitePullsHomeMine = { mount, collectionRail, paintCardDots };',
  `window.InfinitePullsHomeMine = { mount, collectionRail, paintCardDots,
     moversTile, moversRailHtml, moversScrollerHtml,
     _set(c,d){ moversCache=c; moversDir=d; }, _dir(){ return moversDir; } };`);
const doc = { addEventListener(){}, getElementById(){return null;}, querySelectorAll(){return [];} };
const win = {};
new Function('window','document','setTimeout', src)(win, doc, ()=>{});
const H = win.InfinitePullsHomeMine;
let fail=0; const ok=(n,c)=>{console.log((c?'  ok  ':'  FAIL')+'  '+n); if(!c)fail++;};

const up   = { name:'Charizard', set_name:'Base Set', number:'4/102', variant:'holofoil',
               then_price:186, now_price:247.05, pct:32.8 };
const down = { name:'Moonbreon', set_name:'Evolving Skies', number:'215/203', variant:'normal',
               then_price:412, now_price:302.8, pct:-26.5 };

console.log('tiles');
const t = H.moversTile(up);
ok('percent is first and present', t.indexOf('mv-tile-move') < t.indexOf('mv-tile-name') && t.includes('32.8%'));
ok('up tile green class',          t.includes('mv-tile is-up') && t.includes('▲'));
ok('down tile red class',          H.moversTile(down).includes('mv-tile is-down') && H.moversTile(down).includes('▼'));
ok('name and where shown',         t.includes('Charizard') && t.includes('Base Set · 4/102'));
ok('both prices shown',            t.includes('$186.00') && t.includes('$247.05'));
ok('links to lookup with number',  t.includes('?page=lookup&q=4%2F102'));
ok('escapes card names',           H.moversTile({...up, name:'<img onerror=x>'}).includes('&lt;img'));

console.log('the rail');
H._set({ up:[up,up,up], down:[down] }, 'up');
let r = H.moversRailHtml();
ok('titled Movers & Shakers',      r.includes('Movers &amp; Shakers'));
ok('see-all goes to the page',     r.includes('href="?page=movers"'));
ok('two arrow buttons, no words',  (r.match(/data-mv-dir/g)||[]).length === 2 && !/>Up<|>Down</.test(r));
ok('arrows are ▲ and ▼',           r.includes('>▲</button>') && r.includes('>▼</button>'));
ok('up is the default view',       /data-mv-dir="up"[^>]*aria-pressed="true"/.test(r.replace(/\n\s*/g,' ')));
ok('down starts off',              /data-mv-dir="down"[^>]*aria-pressed="false"/.test(r.replace(/\n\s*/g,' ')));
ok('arrows have aria labels',      r.includes('aria-label="Cards going up in price"'));
ok('sort sits left of scroller',   r.indexOf('mv-sort') < r.indexOf('mv-scroller'));
ok('shows the up rows',            (r.match(/mv-tile is-up/g)||[]).length === 3);

console.log('capped at 20');
const many = Array.from({length:40}, (_,i)=>({...up, name:'Card'+i}));
H._set({ up:many, down:[] }, 'up');
ok('never more than 20 tiles',     (H.moversScrollerHtml().match(/class="mv-tile is-/g)||[]).length === 20);
ok('and it kept the first 20',     H.moversScrollerHtml().includes('Card0') && H.moversScrollerHtml().includes('Card19') && !H.moversScrollerHtml().includes('Card20'));

console.log('switching view');
H._set({ up:[up], down:[down,down] }, 'down');
ok('down view shows fallers',      (H.moversScrollerHtml().match(/mv-tile is-down/g)||[]).length === 2);
ok('down view marks its arrow',    /data-mv-dir="down"[^>]*aria-pressed="true"/.test(H.moversRailHtml().replace(/\n\s*/g,' ')));
H._set({ up:[], down:[down] }, 'up');
ok('empty side says so',           H.moversScrollerHtml().includes('Nothing rose by more than 3%'));

console.log(fail?`\n${fail} FAILED`:'\nall passed');
process.exit(fail?1:0);
