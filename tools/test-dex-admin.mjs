/* The Infinite Dex admin screen, driven end to end against a stubbed
 * Supabase and a stubbed storage bucket.
 *
 * Nothing here touches the live project: window.supabase.createClient is
 * replaced before admin.js runs, so the panel talks to a fake that returns
 * a seeded season and records what it would have written.
 *
 * What is actually being proved: that a card Jeff saves is the card the
 * database will accept, and that the word on the board matches the word in
 * the row. A card that cannot be claimed on September 12th is not a
 * cosmetic bug -- it is a customer at the counter being told no.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';

const PORT = Number(process.env.PORT || 8310);
const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png' };

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

// A season part-way through being drawn, which is the real state of it:
// some cards have art, most do not, and the event card is still switched
// off waiting for Jeff.
const mk = (n, code, name, task, trigger, art) => ({
  id: 'id-' + code, code, name, task_line: task, flavor: 'Flavor.',
  season: 'S26', series: 'set', number: n, rarity: code === 'COL-100' ? 'gold' : 'holo',
  art_url: art ? 'https://cdn.test/' + code + '-full.png' : null,
  thumb_url: art ? 'https://cdn.test/' + code + '-thumb.webp' : null,
  award_type: 'auto', claim_code: null, trigger_key: trigger,
  active_from: null, active_until: null, enabled: true, display_order: n
});

const ROWS = [
  mk(1,'ACC-001','The Initiate','ACCOUNT CREATED','account_created', false),
  mk(2,'COL-001','The Collection Keeper','FIRST CARD ADDED','first_card_added', true),
  mk(3,'APP-001','The Portal Opens','APP INSTALLED','app_installed', true),
  mk(4,'WSH-001','The Wishfinder','FIRST WISH SAVED','first_wish_saved', true),
  mk(5,'SCN-001','Snapsnout','FIRST CARD SCANNED','first_card_scanned', true),
  mk(6,'COL-010','The Tenfold Titan','10 CARDS COLLECTED','cards_10', true),
  mk(7,'COL-100','The Hundredfold','100 CARDS COLLECTED','cards_100', true),
  mk(8,'PDX-050','The Dexwarden','50 POKÉMON DISCOVERED','pokedex_50', false),
  mk(9,'GOL-001','The Oathkeeper','FIRST GOAL COMPLETED','first_goal_completed', false),
  mk(10,'SLD-001','The Unbroken Seal','FIRST SEALED PRODUCT','first_sealed_added', false),
  mk(11,'NTF-001','The Signal','ALERTS TURNED ON','alerts_enabled', false),
  mk(12,'PRO-001','The Herald','COLLECTION MADE PUBLIC','collection_public', false),
  {
    id: 'id-EVT-001', code: 'EVT-001', name: 'Grand Opening',
    task_line: 'SHOW UP SEPTEMBER 12TH', flavor: 'You were there.',
    season: 'S26', series: 'event', number: null, rarity: 'holo',
    art_url: null, thumb_url: null,
    award_type: 'code', claim_code: 'GRANDOPENING', trigger_key: null,
    // 2026-09-12 00:00 and 2026-09-13 03:00 in New York.
    active_from: '2026-09-12T04:00:00.000Z',
    active_until: '2026-09-13T07:00:00.000Z',
    enabled: false, display_order: 100
  }
];

const stub = (rows) => `(() => {
  const ROWS = ${JSON.stringify(rows)};
  window.__writes = [];
  window.__uploads = [];
  const mkQuery = (table) => {
    const q = {
      _rows: ROWS, _err: null,
      select: () => q, eq: () => q, limit: () => q, order: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      update(values){ window.__writes.push({ table, op:'update', values }); return q; },
      insert(values){
        window.__writes.push({ table, op:'insert', values });
        // The database's own unique constraint, said back the way
        // PostgREST says it.
        if (ROWS.some(r => r.code === values.code)) {
          q._err = { message: 'duplicate key value violates unique constraint "infinite_dex_cards_code_key"' };
        }
        return q;
      },
      delete: () => q,
      then: (res) => res({ data: table === 'infinite_dex_cards' ? ROWS : [], error: q._err })
    };
    return q;
  };
  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'admin' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null })
    },
    rpc: async () => ({ data: [], error: null }),
    from: mkQuery,
    storage: { from: () => ({
      upload: async (path, body, opts) => {
        window.__uploads.push({ path, contentType: opts && opts.contentType, size: body && body.size });
        return { data: { path }, error: null };
      },
      getPublicUrl: (path) => ({ data: { publicUrl: 'https://cdn.test/' + path } })
    }) }
  }) };
})()`;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = [];

const open = async () => {
  const ctx = await b.newContext({
    viewport: { width: 420, height: 900 }, deviceScaleFactor: 2,
    timezoneId: 'America/New_York',
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts\.g|TUNNEL|ERR_|404/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  await p.addInitScript(stub(ROWS));
  await p.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#dex-admin-list .dex-row', { timeout: 5000 });
  return p;
};

// A real 5:7 card-shaped PNG, and a square one, to prove the shape check.
// Drawn here rather than committed as fixtures: the point is only the
// dimensions and enough detail that the file is genuinely large, which is
// what makes the thumbnail comparison mean something.
const pngPath = join(tmpdir(), 'dex-card.png');
const squarePath = join(tmpdir(), 'dex-square.png');

async function makePng(w, h, path) {
  const ctx = await b.newContext();
  const pg = await ctx.newPage();
  const dataUrl = await pg.evaluate(([w, h]) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    let seed = 1;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    // Stands in for card art: a smooth ground with a lot of detail on top,
    // which is what a holo card actually is. Pure noise would be a
    // pathological case that no real card resembles.
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#1b0f3a'); bg.addColorStop(0.5, '#0b3d5c'); bg.addColorStop(1, '#3a1020');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      g.globalAlpha = 0.15 + rnd() * 0.5;
      g.fillStyle = `hsl(${(rnd()*360)|0} 90% ${40 + rnd()*45}%)`;
      g.beginPath();
      g.arc(rnd() * w, rnd() * h, 3 + rnd() * 26, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
    return c.toDataURL('image/png');
  }, [w, h]);
  await writeFile(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
  await ctx.close();
}

await makePng(1060, 1484, pngPath);
await makePng(900, 900, squarePath);

const p = await open();

console.log('--- the list he lands on ---');
{
  const rows = await p.$$eval('#dex-admin-list .dex-row', (n) => n.length);
  check('every card is listed', rows === 13, rows + ' rows');

  const groups = await p.$$eval('#dex-admin-list .dex-group', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  check('the season and the in-shop cards are separated', groups.length === 2 && /season/i.test(groups[0]) && /in-shop/i.test(groups[1]), groups.join(' | '));
  check('...and it says how many still need art', /6 of 12 have art/.test(groups[0]), groups[0]);

  const evt = await p.$eval('#dex-admin-list', (el) =>
    [...el.querySelectorAll('.dex-row')].find((r) => r.textContent.includes('EVT-001'))?.textContent.replace(/\s+/g, ' ').trim() || '');
  check('the grand opening card shows as off, not live', /Off/.test(evt) && !/Live/.test(evt), evt.slice(0, 60));
  check('...and shows the word that goes on the board', /GRANDOPENING/.test(evt));
  check('...and has no art yet, which is visible at a glance', /no art/.test(evt));

  const gold = await p.$eval('#dex-admin-list', (el) =>
    [...el.querySelectorAll('.dex-row')].find((r) => r.textContent.includes('COL-100'))?.textContent || '');
  check('the gold card is marked gold', /gold/.test(gold));
}

console.log('--- the code goes on a board, so it can be copied ---');
{
  await p.click('.dex-copy');
  await p.waitForTimeout(150);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  check('Copy code puts the word on the clipboard', clip === 'GRANDOPENING', clip);
  const status = await p.textContent('#dex-status');
  check('...and says what it is for', /board/i.test(status), status);
}

console.log('--- a new card starts as an in-shop card ---');
{
  check('the form is out of the way until asked for', !(await p.isVisible('#dex-admin-form')));
  await p.click('#dex-admin-new');
  await p.waitForTimeout(120);
  check('the form opens', await p.isVisible('#dex-admin-form'));
  check('it defaults to a code card, because that is the one he makes', await p.inputValue('#dex-form-award') === 'code');
  check('...so the word field is showing', await p.isVisible('#dex-form-code-word'));
  check('...and the trigger picker is not', !(await p.isVisible('#dex-form-trigger')));
  check('...and it defaults to OFF, so a half-made card cannot be claimed', !(await p.isChecked('#dex-form-enabled')));

  await p.selectOption('#dex-form-award', 'auto');
  await p.waitForTimeout(80);
  check('switching to automatic swaps the two', (await p.isVisible('#dex-form-trigger')) && !(await p.isVisible('#dex-form-code-word')));

  const opts = await p.$$eval('#dex-form-trigger option', (n) => n.map((o) => o.value));
  check('every trigger the database knows is offered', opts.length === 12 && opts.includes('cards_100') && opts.includes('collection_public'), opts.length + ' options');

  await p.selectOption('#dex-form-trigger', 'app_installed');
  await p.waitForTimeout(80);
  check('a trigger the database cannot check says so', await p.isVisible('#dex-trigger-warn'));
  await p.selectOption('#dex-form-trigger', 'cards_10');
  await p.waitForTimeout(80);
  check('...and one it can check does not', !(await p.isVisible('#dex-trigger-warn')));

  await p.selectOption('#dex-form-series', 'set');
  await p.waitForTimeout(80);
  check('a season card asks for its number', await p.isVisible('#dex-form-number'));
  await p.selectOption('#dex-form-series', 'event');
  await p.waitForTimeout(80);
  check('...an in-shop card does not', !(await p.isVisible('#dex-form-number')));
}

console.log('--- it refuses to save a card nobody could earn ---');
{
  const trySave = async () => { await p.click('#dex-admin-form button[type=submit]'); await p.waitForTimeout(150); return p.textContent('#dex-status'); };

  await p.fill('#dex-form-name', 'Halloween');
  await p.fill('#dex-form-task', 'CAME IN COSTUME');
  await p.selectOption('#dex-form-award', 'code');
  await p.fill('#dex-form-code', 'nope');
  check('a collector code in the wrong shape is refused', /COL-001 or EVT-002/.test(await trySave()));

  await p.fill('#dex-form-code', 'EVT-002');
  await p.fill('#dex-form-code-word', '');
  check('a code card with no word is refused', /word that goes on the board/i.test(await trySave()));

  await p.fill('#dex-form-code-word', 'spooky');
  await p.fill('#dex-form-from', '2026-10-31T18:00');
  await p.fill('#dex-form-until', '2026-10-31T09:00');
  check('a window that finishes before it starts is refused', /before the start/i.test(await trySave()));

  await p.selectOption('#dex-form-series', 'set');
  await p.fill('#dex-form-until', '2026-10-31T23:00');
  await p.fill('#dex-form-number', '');
  check('a season card with no number is refused', /needs a number/i.test(await trySave()));
  await p.selectOption('#dex-form-series', 'event');
}

console.log('--- the card he actually saves ---');
{
  await p.evaluate(() => { window.__writes = []; });
  await p.click('#dex-admin-form button[type=submit]');
  await p.waitForTimeout(250);

  const w = await p.evaluate(() => window.__writes.at(-1));
  check('it is an insert into the cards table', w && w.op === 'insert' && w.table === 'infinite_dex_cards');
  check('the code is upper-cased for him', w?.values.code === 'EVT-002', w?.values.code);
  check('...and so is the word on the board', w?.values.claim_code === 'SPOOKY', w?.values.claim_code);
  check('an in-shop card carries no season number', w?.values.number === null);
  check('...and no trigger, since it is claimed by code', w?.values.trigger_key === null);
  check('the times are sent as real instants, not wall clock', /^2026-10-31T22:00:00.000Z$/.test(w?.values.active_from || ''), w?.values.active_from);
  check('...both of them', /^2026-11-01T03:00:00.000Z$/.test(w?.values.active_until || ''), w?.values.active_until);
  check('it saves turned off', w?.values.enabled === false);

  const status = await p.textContent('#dex-status');
  check('...and says so plainly rather than looking like a failure', /turned off/i.test(status), status);
}

console.log('--- a code somebody already used ---');
{
  await p.click('#dex-admin-new');
  await p.fill('#dex-form-name', 'Clash');
  await p.fill('#dex-form-task', 'X');
  await p.fill('#dex-form-code', 'COL-001');
  await p.fill('#dex-form-code-word', 'AGAIN');
  await p.click('#dex-admin-form button[type=submit]');
  await p.waitForTimeout(250);
  const status = await p.textContent('#dex-status');
  check('a duplicate collector code is explained, not dumped', /already exists/i.test(status) && !/constraint/i.test(status), status);
}

console.log('--- editing the grand opening card ---');
{
  await p.evaluate(() => {
    [...document.querySelectorAll('#dex-admin-list .dex-row')]
      .find((r) => r.textContent.includes('EVT-001'))
      .querySelector('.dex-edit').click();
  });
  await p.waitForTimeout(150);
  check('the word comes back', await p.inputValue('#dex-form-code-word') === 'GRANDOPENING');
  check('the start time comes back in shop time, not UTC', await p.inputValue('#dex-form-from') === '2026-09-12T00:00', await p.inputValue('#dex-form-from'));
  check('...and so does the end time', await p.inputValue('#dex-form-until') === '2026-09-13T03:00', await p.inputValue('#dex-form-until'));
  check('the series comes back as an in-shop card', await p.inputValue('#dex-form-series') === 'event');
  check('...and it is still switched off', !(await p.isChecked('#dex-form-enabled')));
}

console.log('--- the preview, so the words are checked in their shape ---');
{
  await p.fill('#dex-form-name', 'Grand Opening');
  await p.fill('#dex-form-task', 'show up september 12th');
  await p.waitForTimeout(120);
  const t = (await p.textContent('#dex-form-preview')).replace(/\s+/g, ' ');
  check('the name and task show as they will be printed', /GRAND OPENING/.test(t) && /SHOW UP SEPTEMBER 12TH/.test(t), t.trim().slice(0, 60));
}

console.log('--- the art, and the thumbnail nobody should have to remember ---');
{
  await p.evaluate(() => { window.__uploads = []; window.__writes = []; });
  await p.setInputFiles('#dex-form-art', pngPath);
  await p.waitForTimeout(200);
  await p.click('#dex-admin-form button[type=submit]');
  await p.waitForTimeout(600);

  const ups = await p.evaluate(() => window.__uploads);
  check('two files go up, not one', ups.length === 2, ups.map((u) => u.path).join(', '));
  const full = ups.find((u) => /-full\./.test(u.path));
  const thumb = ups.find((u) => /-thumb\./.test(u.path));
  check('the full art is stored untouched', !!full && full.size > 100000, full && Math.round(full.size / 1024) + ' KB');
  check('a WebP thumbnail is made alongside it', !!thumb && /\.webp$/.test(thumb.path), thumb && thumb.path);
  check('...and it is small enough for a grid on shop wifi', thumb && thumb.size < 80000, thumb && Math.round(thumb.size / 1024) + ' KB');
  check('...far smaller than the original', thumb && full && thumb.size < full.size / 10);

  const w = await p.evaluate(() => window.__writes.at(-1));
  check('both URLs are written onto the card', /-full\./.test(w?.values.art_url || '') && /-thumb\./.test(w?.values.thumb_url || ''), w?.values.thumb_url);
  check('the art is filed under the card code', /^evt-001\//.test(new URL(w?.values.art_url).pathname.slice(1)), w?.values.art_url);

  const note = await p.textContent('#dex-art-note');
  check('a card-shaped image passes without a warning', /Thumbnail is/.test(note) && !/not the 5:7/.test(note), note);
}

console.log('--- an image that is the wrong shape ---');
{
  // A successful save closes the form, so open the card again first --
  // which is also what he would actually do.
  await p.evaluate(() => {
    [...document.querySelectorAll('#dex-admin-list .dex-row')]
      .find((r) => r.textContent.includes('EVT-001'))
      .querySelector('.dex-edit').click();
  });
  await p.waitForTimeout(150);
  await p.setInputFiles('#dex-form-art', squarePath);
  await p.waitForTimeout(200);
  await p.click('#dex-admin-form button[type=submit]');
  await p.waitForTimeout(600);
  const note = await p.textContent('#dex-art-note');
  check('a square image is flagged but still accepted', /not the 5:7/.test(note), note);
}

console.log('--- turning a card on and off ---');
{
  await p.evaluate(() => { window.__writes = []; });
  p.once('dialog', (d) => d.accept());
  await p.evaluate(() => {
    [...document.querySelectorAll('#dex-admin-list .dex-row')]
      .find((r) => r.textContent.includes('EVT-001'))
      .querySelector('.dex-toggle').click();
  });
  await p.waitForTimeout(300);
  const w = await p.evaluate(() => window.__writes.at(-1));
  check('turning it on updates only that flag', w?.op === 'update' && w.values.enabled === true && Object.keys(w.values).length === 1, JSON.stringify(w?.values));
  const status = await p.textContent('#dex-status');
  check('...and says it is on', /turned on/i.test(status), status);
}

console.log('--- nothing on this screen can hand out a card ---');
{
  const wrote = await p.evaluate(() => window.__writes.some((w) => w.table === 'user_dex_cards'));
  check('user_dex_cards is never written to from the admin panel', wrote === false);
}

check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

await b.close();
server.close();
console.log(`\n${fails ? fails + ' OF ' + total + ' CHECKS FAILED' : total + ' CHECKS PASSED'}`);
process.exit(fails ? 1 : 0);
