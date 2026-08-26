/* The import screen, driven end to end in a real browser.
 *
 * Supabase and TCGdex are both stubbed, so nothing here touches the live
 * project and nothing depends on an API being up. What is being proved is
 * the part a customer actually experiences: that our column guesses are
 * shown before anything is looked up, that a card we were unsure about
 * arrives unticked, and that what finally reaches the database is the
 * same shape and obeys the same merge rule as tapping Add.
 *
 * The set fixtures are the real ones — base1 numbers its cards 1,2,3 and
 * sv08.5 numbers its 001,002,003. That difference is the bug chunk 2
 * exists to survive, so the UI test carries it too.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const PORT = Number(process.env.PORT || 8460);
const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(PORT, r));

let fails = 0, total = 0;
const check = (label, cond, extra = '') => {
  total++; if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  [' + extra + ']' : ''}`);
};
const eq = (label, got, want) => check(label, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want) ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// ------------------------------------------------------------------
// Stubs. Supabase records every write; TCGdex serves two real sets.
// ------------------------------------------------------------------
const stub = `(() => {
  const pad = (n,w) => String(n).padStart(w,'0');
  const mk = (setId,count,width,names={}) => Array.from({length:count},(_,i)=>{
    const localId = width ? pad(i+1,width) : String(i+1);
    return { id: setId+'-'+localId, localId, name: names[i+1]||('Card '+(i+1)),
             image:'https://assets.tcgdex.net/en/x/'+setId+'/'+localId };
  });
  const FULL = {
    base1:{ id:'base1', name:'Base Set', abbreviation:{official:'BS'},
            cardCount:{official:102,total:102},
            cards: mk('base1',102,0,{4:'Charizard',2:'Blastoise',58:'Pikachu'}) },
    'sv08.5':{ id:'sv08.5', name:'Prismatic Evolutions', abbreviation:{official:'PRE'},
            cardCount:{official:131,total:180},
            cards: mk('sv08.5',180,3,{161:'Umbreon ex',60:'Umbreon ex'}) }
  };
  const BRIEF = Object.values(FULL).map(s=>({id:s.id,name:s.name,cardCount:s.cardCount}));

  const realFetch = window.fetch.bind(window);
  window.__api = [];
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (!/api\\.tcgdex\\.net/.test(u)) return realFetch(url, opts);
    window.__api.push(u);
    const m = u.match(/\\/sets\\/(.+)$/);
    const body = m ? FULL[decodeURIComponent(m[1])] : (u.endsWith('/sets') ? BRIEF : null);
    return new Response(JSON.stringify(body), { status: body ? 200 : 404,
      headers:{'Content-Type':'application/json'} });
  };

  // ---- Supabase ----
  window.__writes = [];
  window.__existing = [];
  const q = (table) => {
    const st = { table, filters:{} };
    const o = {
      select(){ return o; },
      eq(k,v){ st.filters[k]=v; return o; },
      in(){ return o; }, order(){ return o; }, limit(){ return o; },
      maybeSingle: async () => ({ data:null, error:null }),
      single: async () => ({ data:null, error:null }),
      insert(v){ window.__writes.push({op:'insert', table, rows: Array.isArray(v)?v:[v]}); return Promise.resolve({data:null,error:null}); },
      update(v){ window.__writes.push({op:'update', table, patch:v, filters:st.filters}); return o; },
      delete(){ return o; },
      then(res){ return res({ data: table==='user_cards' ? window.__existing : [], error:null }); }
    };
    return o;
  };
  const user = { id:'u1', email:'m@example.com' };
  window.supabase = { createClient: () => ({
    auth: {
      getUser: async () => ({ data:{ user } }),
      getSession: async () => ({ data:{ session:{ user } } }),
      onAuthStateChange: () => ({ data:{ subscription:{ unsubscribe(){} } } })
    },
    rpc: async () => ({ data:[], error:null }),
    from: q,
    storage:{ from: () => ({ getPublicUrl:(x)=>({data:{publicUrl:x}}) }) }
  }) };
})()`;

const CSV = [
  'Quantity,Name,Simple Name,Set,Card Number,Set Code,Printing,Condition,Language,Rarity,Product ID',
  '2,Charizard,Charizard,Base Set,4/102,BS,Holofoil,Near Mint,English,Rare Holo,15663',
  '1,Umbreon ex,Umbreon ex,Prismatic Evolutions,161/131,PRE,Holofoil,Near Mint,English,Special Illustration Rare,6275',
  '3,Pikachu,Pikachu,Base Set,58/102,BS,Normal,Lightly Played,English,Common,4146',
  '1,Blastoise,Blastoise,Base Set,4/102,BS,Holofoil,Near Mint,English,Rare Holo,99999'
].join('\n');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = [];
const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts\.g|ERR_|404|manifest/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
await p.addInitScript(stub);
await p.goto(`http://localhost:${PORT}/?page=collection`, { waitUntil: 'domcontentloaded' });

const openImporter = async () => {
  await p.waitForSelector('#import-collection-btn', { timeout: 8000 });
  await p.click('#import-collection-btn');
  await p.waitForSelector('#import-overlay', { timeout: 4000 });
};

const paste = async (text) => {
  await p.fill('#import-paste-box', text);
  await p.click('#import-paste-go');
  await p.waitForSelector('.import-fields', { timeout: 4000 });
};

console.log('--- the way in ---');
{
  check('an Import button sits beside Scan a Card', await p.isVisible('#import-collection-btn'));
  await openImporter();
  check('...and opens a sheet', await p.isVisible('.import-sheet'));
  check('the page behind it cannot scroll away', await p.evaluate(() => document.body.classList.contains('import-open')));
  // The file input itself is hidden on purpose — the big dashed panel is
  // its label, because a bare "Choose file" button looks like nothing.
  check('it offers a file, behind a target big enough to tap',
    await p.isVisible('.import-drop') && (await p.$('#import-file')) !== null);
  check('...and a box to paste into', await p.isVisible('#import-paste-box'));
  check('...and says where to get a file', /Collectr/.test(await p.textContent('.import-help')));

  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  check('Escape closes it', !(await p.isVisible('#import-overlay').catch(() => false)));
  check('...and gives the page back', await p.evaluate(() => !document.body.classList.contains('import-open')));
}

console.log('--- nothing is looked up before the columns are shown ---');
{
  await openImporter();
  await p.evaluate(() => { window.__api = []; });
  await paste(CSV);

  eq('the card database has not been touched yet', await p.evaluate(() => window.__api.length), 0);
  check('it says how many rows it read', /4 rows/.test(await p.textContent('.import-lede')), await p.textContent('.import-lede'));

  const guessed = await p.$$eval('.import-field.is-found .import-field-label strong', (n) => n.map((x) => x.textContent));
  check('the columns it recognised are marked', guessed.includes('How many') && guessed.includes('Card number') && guessed.includes('Set'), guessed.join(','));

  const nameCol = await p.$eval('[data-field="name"]', (s) => s.options[s.selectedIndex].textContent);
  eq('Name is picked over Simple Name', nameCol, 'Name');

  check('it asks whether this is a checklist', await p.isVisible('.import-archetype'));
  const arch = await p.$eval('input[name="import-arch"]:checked', (i) => i.value);
  eq('...and guesses an inventory for this file', arch, 'inventory');
}

console.log('--- a column we got wrong can be corrected ---');
{
  await p.selectOption('[data-field="name"]', { label: 'Simple Name' });
  const now = await p.$eval('[data-field="name"]', (s) => s.options[s.selectedIndex].textContent);
  eq('the customer can point the name somewhere else', now, 'Simple Name');
  await p.selectOption('[data-field="name"]', { label: 'Name' });

  await p.selectOption('[data-field="name"]', { value: '' });
  await p.selectOption('[data-field="number"]', { value: '' });
  await p.click('#import-go');
  await p.waitForTimeout(200);
  check('unpointing both the name and the number is refused',
    /nothing to look a card up by/.test(await p.textContent('#import-status')), await p.textContent('#import-status'));
  check('...and it did not go and look anyway', (await p.evaluate(() => window.__api.length)) === 0);
  await p.selectOption('[data-field="name"]', { label: 'Name' });
  await p.selectOption('[data-field="number"]', { label: 'Card Number' });
}

console.log('--- looking them up ---');
{
  await p.click('#import-go');
  await p.waitForSelector('.import-summary', { timeout: 8000 });

  const api = await p.evaluate(() => window.__api);
  eq('three requests for four cards across two sets', api.length, 3);
  check('...the set list once', api.filter((u) => u.endsWith('/sets')).length === 1, api.join(' '));
  check('...and each set once', api.some((u) => u.endsWith('/sets/base1')) && api.some((u) => u.endsWith('/sets/sv08.5')));

  const stats = await p.$$eval('.import-stat strong', (n) => n.map((x) => Number(x.textContent)));
  eq('three ready, one to look at, none unreadable', stats, [3, 1, 0]);
}

console.log('--- the one we were unsure about ---');
// Number 4 in Base Set is Charizard, but that row says Blastoise. That is
// what a wrong set looks like, and it must never go in quietly.
{
  const why = await p.textContent('.import-why');
  check('it says which two names disagree', /Charizard/.test(why) && /Blastoise/.test(why), why);

  const boxes = await p.$$eval('.import-row [data-pick]', (n) => n.map((x) => x.checked));
  eq('the doubtful one starts unticked and the rest ticked', boxes, [false, true, true, true]);

  const btn = await p.textContent('#import-save');
  check('the button counts only the ticked ones', /Add 6 cards/.test(btn), btn);
}

console.log('--- ticking it in counts it ---');
{
  await p.click('.import-row [data-pick]');
  await p.waitForTimeout(120);
  check('the total goes up by that row', /Add 7 cards/.test(await p.textContent('#import-save')), await p.textContent('#import-save'));
  await p.click('.import-row [data-pick]');
  await p.waitForTimeout(120);
  check('...and back down again', /Add 6 cards/.test(await p.textContent('#import-save')));
}

console.log('--- what actually reaches the database ---');
{
  await p.evaluate(() => { window.__writes = []; });
  await p.click('#import-save');
  await p.waitForSelector('.import-done', { timeout: 6000 });

  const writes = await p.evaluate(() => window.__writes);
  eq('one insert, not one per card', writes.length, 1);
  eq('...into user_cards', writes[0].table, 'user_cards');
  eq('...carrying three holdings', writes[0].rows.length, 3);

  const rows = writes[0].rows;
  const chari = rows.find((r) => r.card_name === 'Charizard');
  eq('the unpadded set gives an unpadded id', chari.card_id, 'base1-4');
  eq('quantity comes from the file', chari.quantity, 2);
  eq('printing is carried over', chari.variant, 'holofoil');
  eq('so is condition', chari.condition, 'Near Mint');
  eq('the owner is stamped on', chari.user_id, 'u1');
  eq('the set name is the real one', chari.set_name, 'Base Set');
  eq('the thumbnail is the small one the grid uses', chari.image_url, 'https://assets.tcgdex.net/en/x/base1/4/low.webp');

  const umb = rows.find((r) => r.card_name === 'Umbreon ex');
  eq('the padded set gives a padded id', umb.card_id, 'sv08.5-161');

  const pika = rows.find((r) => r.card_name === 'Pikachu');
  eq('a played card keeps its condition', pika.condition, 'Lightly Played');
  eq('...and its printing', pika.variant, 'normal');

  check('it says how many went in', /6 cards added/.test(await p.textContent('.import-done h3')), await p.textContent('.import-done h3'));
}

console.log('--- importing on top of cards you already have ---');
// The merge rule: same card, same printing, same condition is one holding
// that goes up — not a second identical line.
{
  await p.click('#import-finish');
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    window.__existing = [{ id: 'row-1', card_id: 'base1-4', variant: 'holofoil', condition: 'Near Mint', quantity: 5 }];
    window.__writes = [];
  });

  await openImporter();
  await paste(CSV);
  await p.click('#import-go');
  await p.waitForSelector('.import-summary', { timeout: 8000 });
  await p.click('#import-save');
  await p.waitForSelector('.import-done', { timeout: 6000 });

  const writes = await p.evaluate(() => window.__writes);
  const ins = writes.filter((w) => w.op === 'insert');
  const upd = writes.filter((w) => w.op === 'update');

  eq('the card already owned is an update, not an insert', upd.length, 1);
  eq('...adding to what was there rather than replacing it', upd[0].patch.quantity, 7);
  eq('...on that exact row', upd[0].filters.id, 'row-1');
  eq('the two new ones are still inserted', ins[0].rows.length, 2);
  check('...and neither of them is the one that already existed',
    !ins[0].rows.some((r) => r.card_id === 'base1-4'), ins[0].rows.map((r) => r.card_id).join(','));
}

console.log('--- a set checklist is not handed over as a collection ---');
{
  await p.click('#import-finish');
  await p.waitForTimeout(300);
  await p.evaluate(() => { window.__existing = []; window.__writes = []; });

  const list = ['Card Number,Name,Owned'];
  for (let i = 1; i <= 60; i++) list.push(`${i}/102,Card ${i},${i <= 5 ? 'x' : ''}`);

  await openImporter();
  await paste(list.join('\n'));
  const arch = await p.$eval('input[name="import-arch"]:checked', (i) => i.value);
  eq('it spots the checklist', arch, 'checklist');
  check('...and warns what that means', /only the rows with something/.test(await p.textContent('.import-warn')),
    await p.textContent('.import-warn'));
}

console.log('--- rubbish in ---');
{
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  await openImporter();
  await p.fill('#import-paste-box', 'just some words I typed');
  await p.click('#import-paste-go');
  await p.waitForTimeout(200);
  check('a plain sentence is refused, kindly',
    /does not look like a table/.test(await p.textContent('#import-status')), await p.textContent('#import-status'));

  await p.fill('#import-paste-box', '');
  await p.click('#import-paste-go');
  await p.waitForTimeout(150);
  check('an empty box says so', /Nothing pasted/.test(await p.textContent('#import-status')));
}

check('no page errors anywhere in that', errs.length === 0, errs.slice(0, 3).join(' | '));

await b.close();
server.close();
console.log(`\n${fails ? fails + ' OF ' + total + ' CHECKS FAILED' : total + ' CHECKS PASSED'}`);
process.exit(fails ? 1 : 0);
