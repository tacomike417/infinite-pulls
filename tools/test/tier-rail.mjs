/* THE "BY PRICE" RAIL and the card artwork — rendered without a browser.
 *
 * Two things here are easy to get quietly wrong and hard to notice by
 * eye: that the four brackets TILE with no gap or overlap, and that a
 * steady card says "Steady" rather than a percentage that invites somebody
 * to read a trend into rounding. Both are pinned below.
 *
 *     node tools/test/tier-rail.mjs
 *
 * The shipped file is evaluated as-is; only its export line is rewritten,
 * in memory, to reach the internals and set the rail's state directly.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
let src = fs.readFileSync(path.join(here, '..', '..', 'components', 'home-mine.js'), 'utf8');
src = src.replace('window.InfinitePullsHomeMine = { mount, collectionRail, paintCardDots };',
  `window.InfinitePullsHomeMine = { mount, collectionRail, paintCardDots,
     moversTile, tierTile, tierRailHtml, tierScrollerHtml, cardArtHtml, TIERS,
     _tier(c,k){ tierCache=c; tierKey=k; } };`);
const doc = { addEventListener(){}, getElementById(){return null;}, querySelectorAll(){return [];} };
const win = {};
new Function('window','document','setTimeout', src)(win, doc, ()=>{});
const H = win.InfinitePullsHomeMine;
let fail=0; const ok=(n,c)=>{console.log((c?'  ok  ':'  FAIL')+'  '+n); if(!c)fail++;};
const IMG='https://assets.tcgdex.net/en/base/base1/4';
const card=(o={})=>({ name:'Charizard', set_name:'Base Set', number:'4/102', variant:'holofoil',
  image_base:IMG, then_price:520, now_price:640, pct:23.1, ...o });

console.log('artwork');
ok('renders low.webp',        H.cardArtHtml(card()).includes(IMG+'/low.webp'));
ok('lazy loaded',             H.cardArtHtml(card()).includes('loading="lazy"'));
ok('no art -> framed blank',  H.cardArtHtml(card({image_base:null})).includes('mv-art is-empty'));
ok('no art -> no <img>',      !H.cardArtHtml(card({image_base:null})).includes('<img'));
ok('art url escaped',         H.cardArtHtml(card({image_base:'x" onerror="y'})).includes('&quot;'));
ok('movers tile has art',     H.moversTile(card()).includes('mv-art'));

console.log('the tiers themselves');
ok('four brackets',           H.TIERS.length === 4);
ok('named as agreed',         H.TIERS.map(t=>t.label).join(',') === 'Notable,High-value,Premium,Grails');
ok('tile with no gaps',       H.TIERS.every((t,i)=> i===0 || t.min === H.TIERS[i-1].max));
ok('grails is open ended',    H.TIERS[3].max === null && H.TIERS[3].min === 500);

console.log('tier tiles');
const t = H.tierTile(card());
ok('PRICE is the headline',   t.indexOf('tier-price') < t.indexOf('tier-move') && t.includes('$640.00'));
ok('move is the second line', t.includes('tier-move is-up') && t.includes('23.1%'));
ok('faller reads red',        H.tierTile(card({pct:-14.2})).includes('tier-move is-down'));
ok('steady says Steady',      H.tierTile(card({pct:0.6})).includes('Steady'));
ok('steady shows no percent', !/0\.6%/.test(H.tierTile(card({pct:0.6}))));
ok('steady is neither colour',H.tierTile(card({pct:0.6})).includes('is-flat'));
ok('3% is a move, not flat',  H.tierTile(card({pct:3})).includes('tier-move is-up'));
ok('links into lookup',       t.includes('?page=lookup&q=4%2F102'));
ok('escapes names',           H.tierTile(card({name:'<b>x'})).includes('&lt;b&gt;'));

console.log('the rail');
H._tier({ notable:[card(),card()] }, 'notable');
let r = H.tierRailHtml();
ok('titled By price',         r.includes('>By price</h2>'));
ok('four chips',              (r.match(/data-tier=/g)||[]).length === 4);
ok('chips show ranges',       r.includes('$50–99') && r.includes('$500+'));
ok('range excludes the max',  r.includes('$100–249') && r.includes('$250–499'));
ok('picked chip is pressed',  /data-tier="notable"[^>]*aria-pressed="true"/.test(r.replace(/\n\s*/g,' ')));
ok('others are not',          /data-tier="grails"[^>]*aria-pressed="false"/.test(r.replace(/\n\s*/g,' ')));
ok('chips above the cards',   r.indexOf('tier-chips') < r.indexOf('tier-scroller'));

console.log('padding and limits');
H._tier({ notable: Array.from({length:40},(_,i)=>card({name:'C'+i})) }, 'notable');
ok('never more than 20',      (H.tierScrollerHtml().match(/class="mv-tile tier-tile/g)||[]).length === 20);
H._tier({ grails: [card(), card({pct:0.2}), card({pct:0.1})] }, 'grails');
ok('short bracket stays short',(H.tierScrollerHtml().match(/class="mv-tile tier-tile/g)||[]).length === 3);
ok('steady cards do pad it',  (H.tierScrollerHtml().match(/is-flat/g)||[]).length === 4);
H._tier({ grails: [] }, 'grails');
ok('empty bracket explains',  H.tierScrollerHtml().includes('week of price history'));
H._tier({}, 'premium');
ok('unfetched says loading',  H.tierScrollerHtml().includes('Loading'));

console.log(fail?`\n${fail} FAILED`:'\nall passed');
process.exit(fail?1:0);
