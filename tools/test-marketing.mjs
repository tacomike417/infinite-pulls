/* The Marketing tab, driven end to end against a stubbed Supabase.
 *
 * Nothing here touches the live project: window.supabase.createClient is
 * replaced before admin.js runs, so the panel talks to a fake that returns
 * the row marketing.sql seeds and records what it would have written.
 *
 * What is actually being proved is the one thing that matters -- that the
 * text this produces is correct. He is going to paste it into somebody
 * else's website and trust the result, so a prompt with a blank Title: line
 * or a stray {{palette}} in it is not a cosmetic bug.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const PORT = Number(process.env.PORT || 8300);
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

// The row marketing.sql seeds, near enough. Kept short so the assertions
// below can be about assembly rather than about a wall of prose.
const ROW = {
  slug: 'poster',
  name: 'Poster Creation',
  blurb: 'Fill this in and it writes the prompt for you.',
  template: [
    'You are a senior graphic designer making a poster for Infinite Pulls.',
    '',
    'THE POSTER',
    'Title: {{title}}',
    '{{notes}}',
    '',
    'WHERE THE INFORMATION COMES FROM',
    '{{source}}',
    '',
    'LOOK AND FEEL',
    '{{palette}}',
    '',
    'SHAPE',
    '{{shape}}',
    '',
    'RULES',
    '- Use the attached logo.'
  ].join('\n'),
  options: [
    { id: 'normal', label: 'Normal', instruction: 'Clean, modern retail poster.' },
    { id: 'gold',   label: 'Gold',   instruction: 'Deep black with metallic gold as the only accent.' }
  ],
  shapes: [
    { id: 'square', label: 'Square — Facebook / Instagram post', instruction: 'Square, 1:1, 2048x2048.' },
    { id: 'tall',   label: 'Tall — story, phone wallpaper, print', instruction: 'Portrait, 4:5 to 2:3.' }
  ],
  attachments: ['The Infinite Pulls logo (PNG, transparent background)']
};

const stub = (row) => `(() => {
  const ROW = ${JSON.stringify(row)};
  window.__writes = [];
  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'admin' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null })
    },
    rpc: async () => ({ data: [], error: null }),
    from: (table) => {
      const q = {
        select: () => q, eq: () => q, limit: () => q,
        maybeSingle: async () => ({ data: table === 'marketing_prompts' ? ROW : null, error: null }),
        order: async () => ({ data: table === 'marketing_assets'
          ? [{ id:'1', label:'Logo (full wordmark)', url:'https://infinitepulls.com/brand-kit/logo-full.png', note:'Never redraw it.', sort:1 }]
          : [], error: null }),
        single: async () => ({ data: table === 'marketing_prompts' ? ROW : null, error: null }),
        update(values){ window.__writes.push({ table, values }); return q; },
        upsert(values){ window.__writes.push({ table, values }); return q; },
        insert(values){ window.__writes.push({ table, values }); return q; },
        delete: () => q,
        then: (res) => res({ data: [], error: null })
      };
      return q;
    }
  }) };
})()`;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = [];

const open = async (query = '') => {
  const ctx = await b.newContext({
    viewport: { width: 420, height: 900 }, deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts\.g|TUNNEL|ERR_|404/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  await p.addInitScript(stub(ROW));
  // No route out of this sandbox, so an opened tab resolves to a chrome
  // error page. Record what was ASKED for -- that is the thing under test.
  await p.addInitScript(`window.__opened = [];
    const realOpen = window.open;
    window.open = (url, ...rest) => { window.__opened.push(url); return null; };`);
  await p.goto(`http://localhost:${PORT}/admin/${query}`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(900);
  return p;
};

console.log('--- the form he meets ---');
{
  const p = await open();
  check('the Marketing card is on the page', await p.isVisible('#marketing-card'));
  check('...and it opened, rather than sitting behind a Supabase error',
    await p.isVisible('#poster-title'));

  const looks = await p.$$eval('#poster-look option', (ns) => ns.map((n) => n.textContent.trim()));
  check(`the looks come from the database, not the code  [${looks.join(' / ')}]`,
    looks.join(' / ') === 'Normal / Gold');

  const shapes = await p.$$eval('#poster-shape option', (ns) => ns.map((n) => n.textContent.trim()));
  check(`shape is a choice too, because the real posters are not all one shape  [${shapes.length}]`,
    shapes.length === 2 && /Square/.test(shapes[0]));

  check('it says what to attach', (await p.textContent('#poster-attachments')).includes('logo'));
  // The whole point of putting the kit in the repo: these are links, not
  // a note telling him to go and find the logo.
  const dl = await p.$$eval('#poster-attachments a', (ns) => ns.map((n) => n.getAttribute('href')));
  check(`the brand files are real download links  [${dl.length}]`,
    dl.length >= 1 && dl[0].includes('/brand-kit/'), dl[0] || '(none)');
  check('...and admits the prompt cannot carry files',
    (await p.textContent('#poster-attachments')).includes('cannot carry files'));

  // Nothing filled in: every line that was only a placeholder should be gone.
  const empty = await p.textContent('#poster-preview');
  check('an empty form does not produce a prompt full of blanks',
    !empty.includes('Title:') && !empty.includes('{{'), empty.slice(0, 60));
  await p.close();
}

console.log('--- what it writes ---');
{
  const p = await open();
  await p.fill('#poster-title', "This Week's Top 9 Market Movers");
  await p.fill('#poster-source', 'https://www.pokemonpricetracker.com/market-movers');
  await p.selectOption('#poster-look', 'gold');
  await p.waitForTimeout(200);

  const out = await p.textContent('#poster-preview');
  check('the title goes in', out.includes("Title: This Week's Top 9 Market Movers"));
  check('the link goes in', out.includes('pokemonpricetracker.com/market-movers'));
  await p.selectOption('#poster-shape', 'tall');
  await p.waitForTimeout(200);
  const shaped = await p.textContent('#poster-preview');
  const hrefNow = await p.evaluate(() => document.querySelector('#poster-send').href);
  check('the link keeps up with the form as it is filled in',
    decodeURIComponent(hrefNow).includes("This Week's Top 9 Market Movers"));

  check('the shape lands as an instruction too',
    shaped.includes('Portrait, 4:5') && !shaped.includes('{{shape}}'));

  check('the look becomes an instruction, not a colour name',
    out.includes('Deep black with metallic gold') && !out.includes('gold\n'), '');
  check('nothing is left unfilled', !out.includes('{{'));
  // The blank lines BETWEEN sections are deliberate. What must not happen is
  // an orphan gap where {{notes}} used to be, or three blanks in a row.
  check('an optional answer left out takes its line with it, leaving no gap',
    /THE POSTER\nTitle: .*\n\nWHERE THE INFORMATION/.test(out), JSON.stringify(out.slice(0, 90)));
  check('...and never stacks blank lines', !/\n\n\n/.test(out));
  await p.fill('#poster-notes', 'Mention that we buy collections.');
  await p.waitForTimeout(200);
  const out2 = await p.textContent('#poster-preview');
  check('...and filling it in puts it back',
    out2.includes('Mention that we buy collections.'));

  // Changing the look changes only the look.
  await p.selectOption('#poster-look', 'normal');
  await p.waitForTimeout(200);
  const out3 = await p.textContent('#poster-preview');
  check('switching the look swaps that line and nothing else',
    out3.includes('Clean, modern retail poster.')
    && !out3.includes('metallic gold')
    && out3.includes("Title: This Week's Top 9 Market Movers"));
  await p.close();
}

console.log('--- copy and send ---');
{
  const p = await open();
  // Refuses to build a poster with no subject.
  await p.click('#poster-copy');
  await p.waitForTimeout(300);
  check('it will not send a poster with no title',
    (await p.textContent('#poster-status')).includes('title'));

  await p.fill('#poster-title', 'Top 9 Market Movers');
  await p.fill('#poster-source', 'https://example.com/movers');
  await p.click('#poster-copy');
  await p.waitForTimeout(400);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  check('Copy puts the built prompt on the clipboard',
    clip.includes('Top 9 Market Movers') && clip.includes('example.com/movers'));
  check('...and says what to do with it',
    (await p.textContent('#poster-status')).toLowerCase().includes('paste'));

  // Send opens ChatGPT with the prompt in the composer.
  // THE BUG: Send was a <button> that copied (async) and then called
  // window.open. By then the click was over, the browser treated it as an
  // unsolicited pop-up, blocked it, and the button did nothing at all.
  const el = await p.evaluate(() => {
    const n = document.querySelector('#poster-send');
    return { tag: n.tagName, target: n.getAttribute('target'), href: n.href };
  });
  check('Send is a real link, which no pop-up blocker can stop',
    el.tag === 'A' && el.target === '_blank', el.tag);
  check('...pointing at ChatGPT', el.href.startsWith('https://chatgpt.com/?q='));
  check('...with the prompt prefilled in the composer',
    decodeURIComponent(el.href).includes('Top 9 Market Movers'), el.href.slice(0, 60) + '…');

  await p.click('#poster-send');
  await p.waitForTimeout(400);
  check('nothing calls window.open — that is what was being blocked',
    (await p.evaluate(() => window.__opened.length)) === 0);
  check('...and the clipboard is loaded too, in case the link stops working',
    (await p.evaluate(() => navigator.clipboard.readText())).includes('Top 9 Market Movers'));
  await p.close();
}

console.log('--- a prompt too long for a URL ---');
{
  const p = await open();
  await p.fill('#poster-title', 'Long one');
  await p.fill('#poster-notes', 'x'.repeat(2500));
  await p.waitForTimeout(200);
  const long = await p.evaluate(() => document.querySelector('#poster-send').href);
  check('too long to prefill falls back to a plain ChatGPT tab',
    long === 'https://chatgpt.com/', long);
  await p.click('#poster-send');
  await p.waitForTimeout(400);
  check('...and the prompt is on the clipboard instead',
    (await p.evaluate(() => navigator.clipboard.readText())).includes('Long one'));
  check('...and it says so rather than failing quietly',
    (await p.textContent('#poster-status')).toLowerCase().includes('clipboard'));
  await p.close();
}

console.log('--- the editor is yours, not his ---');
{
  const p = await open();
  check('he never sees the prompt editor',
    await p.evaluate(() => document.querySelector('#prompt-editor').hidden));
  await p.close();

  const q = await open('?prompts=1');
  check('you get it with ?prompts=1',
    await q.evaluate(() => !document.querySelector('#prompt-editor').hidden));
  check('...loaded with what is in the database',
    (await q.inputValue('#prompt-template')).includes('senior graphic designer'));
  check('...and the look choices as editable JSON',
    JSON.parse(await q.inputValue('#prompt-options')).length === 2);
  // Sentences, not data. Counting brackets to add "the store photo" was a
  // silly tax on the one person who edits this.
  check('...and the attach list as plain lines, no brackets to count',
    (await q.inputValue('#prompt-attachments')) === 'The Infinite Pulls logo (PNG, transparent background)');

  // Bad JSON is caught before anything is written.
  await q.fill('#prompt-options', '[{"id":"oops"');
  await q.click('#prompt-save');
  await q.waitForTimeout(300);
  check('broken JSON is refused with a reason',
    (await q.textContent('#prompt-editor-status')).includes('not valid'));
  check('...and nothing was written',
    (await q.evaluate(() => window.__writes.length)) === 0);

  // So is JSON that parses but would break his dropdown.
  await q.fill('#prompt-options', '[{"label":"No id here"}]');
  await q.click('#prompt-save');
  await q.waitForTimeout(300);
  check('a look choice with no id is refused too',
    (await q.textContent('#prompt-editor-status')).includes('id and a label'));
  check('...and still nothing was written',
    (await q.evaluate(() => window.__writes.length)) === 0);

  // A good save goes through.
  await q.fill('#prompt-options', '[{"id":"normal","label":"Normal","instruction":"Clean."}]');
  await q.fill('#prompt-template', 'Make a poster called {{title}}.');
  await q.fill('#prompt-attachments', 'The logo\n\nThe QR code\n');
  await q.click('#prompt-save');
  await q.waitForTimeout(400);
  const writes = await q.evaluate(() => window.__writes);
  check('a valid prompt saves', writes.length === 1 && writes[0].table === 'marketing_prompts');
  check('...sending the template, the colours and the shapes together',
    writes[0].values.template.includes('{{title}}')
    && writes[0].values.options.length === 1
    && Array.isArray(writes[0].values.shapes));
  check('...and the attach lines come back as a list, blanks dropped',
    JSON.stringify(writes[0].values.attachments) === '["The logo","The QR code"]',
    JSON.stringify(writes[0].values.attachments));
  await q.close();
}

await b.close();
server.close();
if (errs.length) console.log('\nJS ERRORS:\n' + errs.join('\n'));
console.log(fails === 0 ? `\n${total} CHECKS PASSED` : `\n${fails} of ${total} CHECKS FAILED`);
process.exit(fails || errs.length ? 1 : 0);
