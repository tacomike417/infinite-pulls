/* PRICE TREND — the arrow rules, tested without a browser or a database.
 *
 * Everything here is a claim somebody negotiates against, so the parts
 * that decide WHETHER to draw and WHICH WAY are worth pinning down. Run:
 *
 *     node tools/test/price-trend.mjs
 *
 * The module is loaded by evaluating it against a fake `window`, the same
 * trick tools/test/price-sync.mjs uses, so the file under test is the one
 * the browser actually ships -- not a copy that can drift from it.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', '..', 'components', 'price-trend.js'), 'utf8');
const win = {};
new Function('window', src)(win);
const T = win.InfinitePullsTrend;
let fail = 0;
const ok = (name, cond) => { console.log((cond?'  ok  ':'  FAIL') + '  ' + name); if(!cond) fail++; };

console.log('change()');
ok('rise above floor -> up',        T.change(122, 100).dir === 'up');
ok('fall above floor -> down',      T.change(88, 100).dir === 'down');
ok('under floor -> flat, not null', T.change(102, 100).dir === 'flat');
ok('exactly at floor -> up',        T.change(103, 100).dir === 'up');
ok('no past figure -> null',        T.change(100, null) === null);
ok('zero past -> null',             T.change(100, 0) === null);
ok('NaN -> null',                   T.change(NaN, 100) === null);
ok('pct is magnitude',              Math.abs(T.change(78.03, 63.96).pct - 22) < 0.05);

console.log('arrowHtml()');
ok('null draws nothing',            T.arrowHtml(null) === '');
ok('up is green class + triangle',  /class="trend is-up"/.test(T.arrowHtml({dir:'up',pct:22})) && T.arrowHtml({dir:'up',pct:22}).includes('▲'));
ok('flat says Steady',              T.arrowHtml({dir:'flat',pct:0.4}).includes('Steady'));
ok('flat shows no percentage',      !/0\.4%/.test(T.arrowHtml({dir:'flat',pct:0.4})));
ok('flat pct:false -> dot only',    !/<span class="trend-pct">/.test(T.arrowHtml({dir:'flat',pct:0.4},{pct:false})));
ok('flat default has pct span',     /<span class="trend-pct">Steady</.test(T.arrowHtml({dir:'flat',pct:0.4})));
ok('flat keeps tooltip either way', T.arrowHtml({dir:'flat',pct:0.4},{pct:false}).includes('title="Steady'));
ok('>=100% rounds whole',           T.arrowHtml({dir:'up',pct:143.7}).includes('144%'));

console.log('dotHtml() / priceClass()');
ok('dot null -> nothing',           T.dotHtml(null) === '');
ok('dot carries direction',         T.dotHtml({dir:'down'}).includes('is-down'));
ok('priceClass null -> empty',      T.priceClass(null) === '');
ok('priceClass up',                 T.priceClass({dir:'up'}) === ' is-up');

console.log('fromBatchAny()');
const B = new Map();
B.set('a', [
  { card_id:'a', variant:'normal',          source:'tcgplayer', then_price:100, now_price:101 },  // flat
  { card_id:'a', variant:'reverse-holofoil',source:'tcgplayer', then_price:100, now_price:130 },  // +30
]);
B.set('b', [
  { card_id:'b', variant:'normal', source:'tcgplayer', then_price:100, now_price:100.5 },
]);
B.set('c', [
  { card_id:'c', variant:'trend',  source:'cardmarket', then_price:50, now_price:70 },
]);
B.set('d', [
  { card_id:'d', variant:'normal', source:'tcgplayer', then_price:100, now_price:104 },   // +4
  { card_id:'d', variant:'trend',  source:'cardmarket', then_price:100, now_price:180 },  // +80 EUR
]);
ok('a real move beats a flat sibling', T.fromBatchAny(B,'a').dir === 'up');
ok('all flat -> steady',               T.fromBatchAny(B,'b').dir === 'flat');
ok('cardmarket used when alone',       T.fromBatchAny(B,'c').dir === 'up');
ok('tcgplayer wins over cardmarket',   Math.abs(T.fromBatchAny(B,'d').pct - 4) < 0.01);
ok('unknown card -> null',             T.fromBatchAny(B,'zzz') === null);
ok('empty batch -> null',              T.fromBatchAny(new Map(),'a') === null);

console.log('the span the figures came from');
const D = new Map([['d1', [{ card_id:'d1', variant:'normal', source:'tcgplayer',
  then_price:100, now_price:130, then_on:'2026-09-05', now_on:'2026-09-07' }]]]);
ok('reports the real 2-day gap',   T.fromBatchAny(D,'d1').days === 2);
ok('tooltip says 2 days, not 7',   T.arrowHtml(T.fromBatchAny(D,'d1')).includes('in 2 days'));
const W = new Map([['w1', [{ card_id:'w1', variant:'normal', source:'tcgplayer',
  then_price:100, now_price:130, then_on:'2026-09-06', now_on:'2026-09-13' }]]]);
ok('a real week says 7 days',      T.fromBatchAny(W,'w1').days === 7);
const N = new Map([['n1', [{ card_id:'n1', variant:'normal', source:'tcgplayer',
  then_price:100, now_price:130 }]]]);
ok('no dates falls back to 7',     T.fromBatchAny(N,'n1').days === 7);
ok('exact: stored pair uses gap',  T.fromBatchExact(D,'d1','normal','tcgplayer').days === 2);
ok('exact: a live price is today', T.fromBatchExact(D,'d1','normal','tcgplayer',150).days === 7);

console.log('fromBatchExact()');
ok('exact printing',        Math.abs(T.fromBatchExact(B,'a','reverse-holofoil','tcgplayer').pct - 30) < 0.01);
ok('live amount overrides', Math.abs(T.fromBatchExact(B,'a','normal','tcgplayer', 150).pct - 50) < 0.01);
ok('wrong source -> null',  T.fromBatchExact(B,'a','normal','cardmarket') === null);
ok('missing printing -> null', T.fromBatchExact(B,'a','holofoil','tcgplayer') === null);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
