/* The bottom bar and the menu, from the real navbar.js. */
import fs from 'fs';
const src = fs.readFileSync(new URL('../../components/navbar.js', import.meta.url),'utf8');
const a = src.indexOf('  const primaryNav = ['), b = src.indexOf('  /* A group whose every row');
const mk = (dexOn) => new Function('window', src.slice(a, b) +
  `\nreturn { bar: barItems().map(i=>i.label), menu: menuItems().filter(i=>i.page).map(i=>i.label) };`
)({ InfinitePullsDexSwitch: { dexOn: () => dexOn } });

let pass=0, fail=0;
const check=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  console.log(`${ok?'PASS':'FAIL'}  ${n}\n        got  ${JSON.stringify(g)}\n        want ${JSON.stringify(w)}`); ok?pass++:fail++;};

const off = mk(false), on = mk(true);

/* Five across a phone is the comfortable maximum -- at six the labels
   start truncating, which is what "too cramped down there" meant. */
check('with Infinite Rewards OFF the bar is five items and the slot closes up',
  off.bar, ['Home','Card Lookup','My Collection','My Pokédex','Menu']);
check('with Infinite Rewards ON it keeps its slot',
  on.bar, ['Home','Card Lookup','My Collection','My Pokédex','Infinite Rewards','Menu']);
check('the slot closing up is what removes an item, not a relabel',
  [off.bar.length, on.bar.length], [5, 6]);
check('Events is never in the bar either way',
  [off.bar.includes('Events'), on.bar.includes('Events')], [false, false]);
/* It has to stay reachable. Taking it off the bar AND out of the menu
   would have deleted the page from the app by accident. */
check('Events is still in the menu either way',
  [off.menu.includes('Events'), on.menu.includes('Events')], [true, true]);
check('nothing else left the menu', off.menu, on.menu);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
