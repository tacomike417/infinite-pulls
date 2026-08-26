/* The Infinite Dex card builder, driven end to end against a stubbed
 * Supabase.
 *
 * Nothing here touches the live project. What is being proved is the one
 * thing that matters: that the words Jeff types are the words that reach
 * ChatGPT, exactly, and that a card he half-filled in cannot be sent.
 *
 * The prompt itself lives in the database, so this test carries the real
 * row from supabase/marketing_dexcard.sql rather than a stand-in — a test
 * against a fake template would pass while the real one was broken.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const PORT = Number(process.env.PORT || 8440);
const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };

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

// The real template, lifted out of the SQL file so the two cannot drift
// apart without this test noticing.
const sql = await readFile(new URL('../supabase/marketing_dexcard.sql', import.meta.url), 'utf8');
const template = sql
  .slice(sql.indexOf("template =\n") + 11, sql.indexOf("\n\n-- The colour schemes"))
  .split('\n')
  .map((l) => l.replace(/^\s*(\|\|\s*)?E'/, '').replace(/\\n'\s*$/, '').replace(/'\s*,?\s*$/, ''))
  .join('\n')
  .replace(/''/g, "'");

const OPTIONS = JSON.parse(sql.slice(sql.indexOf("options = '") + 11, sql.indexOf("]'::jsonb,\n\n-- No QR")) + ']');

const ROW = { slug: 'dexcard', name: 'Infinite Dex Card', blurb: 'Type what goes on the card.', template, options: OPTIONS, attachments: [] };

const stub = `(() => {
  const ROW = ${JSON.stringify(ROW)};
  window.__writes = [];
  const q = (table) => {
    const o = {
      select: () => o, eq: () => o, order: () => o, limit: () => o,
      maybeSingle: async () => ({ data: table === 'marketing_prompts' ? ROW : null, error: null }),
      single: async () => ({ data: null, error: null }),
      update(v){ window.__writes.push({ table, v }); return o; },
      insert(v){ window.__writes.push({ table, v }); return o; },
      delete: () => o,
      then: (r) => r({ data: [], error: null })
    };
    return o;
  };
  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'admin' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } })
    },
    rpc: async () => ({ data: [], error: null }),
    from: q,
    storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), getPublicUrl: (x) => ({ data: { publicUrl: x } }) }) }
  }) };
})()`;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = [];
const ctx = await b.newContext({
  viewport: { width: 430, height: 900 }, deviceScaleFactor: 2,
  permissions: ['clipboard-read', 'clipboard-write']
});
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts\.g|ERR_|404/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
await p.addInitScript(stub);
await p.goto(`http://localhost:${PORT}/admin/?tab=marketing`, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#dexcard-body', { timeout: 6000 });

const sent = async () => {
  const href = await p.getAttribute('#dexcard-send', 'href');
  return decodeURIComponent(new URL(href).searchParams.get('q') || '');
};

console.log('--- where it lives ---');
{
  check('the card builder sits with the poster, under Marketing',
    (await p.evaluate(() => document.getElementById('dexcard-card').closest('.tab-panel').id)) === 'tabpanel-marketing');
  check('the poster builder is still next to it', await p.isVisible('#marketing-card'));

  const colours = await p.$$eval('#dexcard-colour option', (n) => n.map((o) => o.textContent));
  check('the colours come from the database, not the code', colours.length === 7, colours.length + ' schemes');
  check('...and are named after cards that already exist', /Vault Blue/.test(colours[0]), colours[0]);
}

console.log('--- a half-filled card cannot be sent ---');
{
  await p.click('#dexcard-copy');
  await p.waitForTimeout(150);
  const s = await p.textContent('#dexcard-status');
  check('it says what is still missing, by name', /card name/.test(s) && /task line/.test(s) && /collector code/.test(s), s);

  await p.fill('#dexcard-name', 'The First Pull');
  await p.click('#dexcard-copy');
  await p.waitForTimeout(150);
  check('...and stops naming the ones now filled in', !/the card name/.test(await p.textContent('#dexcard-status')), await p.textContent('#dexcard-status'));
}

console.log('--- the words he typed are the words that go ---');
{
  await p.fill('#dexcard-task', 'Grand Opening');
  await p.fill('#dexcard-flavor', 'Showed up. Powered up.');
  await p.fill('#dexcard-subject', 'A huge armoured eagle of blue crystal and gold bursting out of a booster pack');
  await p.fill('#dexcard-code', 'knt-912');
  await p.fill('#dexcard-number', '001/012');
  await p.waitForTimeout(200);

  const out = await sent();
  check('the name goes up in caps, as it is printed', out.includes('THE FIRST PULL'), out.slice(0, 0) || 'ok');
  check('...so does the task line', out.includes('GRAND OPENING'));
  check('the flavour line keeps its sentence case', out.includes('Showed up. Powered up.'));
  check('the artwork description goes through untouched', /armoured eagle of blue crystal/.test(out));
  check('the collector code is assembled the way it reads on the card',
    out.includes('KNT-912 · S26 · 001/012'), (out.match(/KNT[^\n]*/) || [''])[0]);
  check('the chosen colour becomes an instruction, not a colour name',
    /Deep navy ground/.test(out) && !/vault/.test(out));
  check('the real size is in there', /1060 x 1484/.test(out));
  check('the example cards are linked for it to look at', /dex-card-example-holo\.jpg/.test(out));
  check('no QR code on a card', !/QR/.test(out));
}

console.log('--- a line he left blank takes itself out ---');
{
  const out = await sent();
  check('no empty label is left behind', !/\{\{/.test(out) && !out.includes('Extra lines between'), (out.match(/\{\{\w+\}\}/) || [''])[0] || 'clean');
  check('...and no stacked blank lines', !/\n\n\n/.test(out));

  await p.fill('#dexcard-extra', 'Kanton, Ohio\nSeptember 12, 2026');
  await p.waitForTimeout(200);
  const out2 = await sent();
  check('filling it in puts the line back', /Extra lines between the task line/.test(out2));
  check('...with both lines on it', /Kanton, Ohio {2}\/ {2}September 12, 2026/.test(out2), (out2.match(/Extra lines[^\n]*/) || [''])[0].slice(0, 90));

  await p.fill('#dexcard-extra', '');
  await p.waitForTimeout(200);
  check('emptying it takes the line away again', !(await sent()).includes('Extra lines between'));
}

console.log('--- copy and send ---');
{
  await p.fill('#dexcard-flavor', 'Showed up. Powered up.');
  await p.waitForTimeout(150);
  await p.click('#dexcard-copy');
  await p.waitForTimeout(200);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  check('Copy puts the built prompt on the clipboard', clip.includes('THE FIRST PULL') && clip.includes('1060 x 1484'), clip.length + ' chars');

  check('Send is a real link, which no pop-up blocker can stop',
    (await p.evaluate(() => document.getElementById('dexcard-send').tagName)) === 'A');
  check('...pointing at ChatGPT with the prompt prefilled',
    (await p.getAttribute('#dexcard-send', 'href')).startsWith('https://chatgpt.com/?q='));

  await p.click('#dexcard-send');
  await p.waitForTimeout(200);
  check('...and it says what to do with the picture when it arrives',
    /upload it on the Infinite Dex tab/i.test(await p.textContent('#dexcard-status')), await p.textContent('#dexcard-status'));
}

console.log('--- the prompt the shop actually gets ---');
{
  const out = await sent();
  check('it protects the logo from being redrawn', /never redraw/i.test(out));
  check('it refuses to put Pokémon artwork on a card the shop will sell against',
    /No Pokémon characters/.test(out) && /Infinite Pulls original/.test(out));
  check('it forbids inventing words he did not type', /do not add a word I did not give you/.test(out));
  check('it asks to read the lines back before drawing', /Read back the five text lines/.test(out));
  check('a real prompt still fits in the link', encodeURIComponent(out).length < 14000, encodeURIComponent(out).length + ' encoded chars');
}

check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

await b.close();
server.close();
console.log(`\n${fails ? fails + ' OF ' + total + ' CHECKS FAILED' : total + ' CHECKS PASSED'}`);
process.exit(fails ? 1 : 0);
