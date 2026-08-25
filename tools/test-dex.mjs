/* The Infinite Dex page, driven end to end against a stubbed Supabase.
 *
 * Nothing here touches the live project: window.supabase.createClient is
 * replaced before app.js runs, so the page talks to a fake that returns a
 * seeded season and answers claim_dex_card the way the real function does.
 *
 * What is actually being proved: that somebody standing in the shop on
 * September 12th, looking at a board, can type the word on it and get the
 * card. Everything else on this page is decoration around that.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const PORT = Number(process.env.PORT || 8330);
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

const mk = (n, code, name, task, flavor) => ({
  id: 'id-' + code, code, name, task_line: task, flavor,
  season: 'S26', series: 'set', number: n, rarity: code === 'COL-100' ? 'gold' : 'holo',
  art_url: 'https://cdn.test/' + code + '-full.png',
  thumb_url: 'https://cdn.test/' + code + '-thumb.webp',
  award_type: 'auto', claim_code: null, trigger_key: 'x',
  active_from: null, active_until: null, enabled: true, display_order: n
});

const CARDS = [
  mk(1,'ACC-001','The Initiate','ACCOUNT CREATED','Welcome, collector.'),
  mk(2,'COL-001','The Collection Keeper','FIRST CARD ADDED','Your collection begins.'),
  mk(3,'APP-001','The Portal Opens','APP INSTALLED','Your journey is live.'),
  mk(4,'WSH-001','The Wishfinder','FIRST WISH SAVED','The hunt begins.'),
  mk(5,'SCN-001','Snapsnout','FIRST CARD SCANNED','Found it!'),
  mk(6,'COL-010','The Tenfold Titan','10 CARDS COLLECTED','Your vault is growing.'),
  mk(7,'COL-100','The Hundredfold','100 CARDS COLLECTED','The vault has awakened.'),
  mk(8,'PDX-050','The Dexwarden','50 POKÉMON DISCOVERED','The dex remembers.'),
  mk(9,'GOL-001','The Oathkeeper','FIRST GOAL COMPLETED','You said you would.'),
  mk(10,'SLD-001','The Unbroken Seal','FIRST SEALED PRODUCT','Still shrink-wrapped.'),
  mk(11,'NTF-001','The Signal','ALERTS TURNED ON',"You'll know first."),
  mk(12,'PRO-001','The Herald','COLLECTION MADE PUBLIC','Now the world sees.'),
  {
    id: 'id-EVT-001', code: 'EVT-001', name: 'Grand Opening',
    task_line: 'SHOW UP SEPTEMBER 12TH', flavor: 'You were there.',
    season: 'S26', series: 'event', number: null, rarity: 'holo',
    art_url: 'https://cdn.test/EVT-001-full.png', thumb_url: 'https://cdn.test/EVT-001-thumb.webp',
    award_type: 'code', claim_code: 'GRANDOPENING', trigger_key: null,
    active_from: null, active_until: null, enabled: true, display_order: 100
  },
  {
    id: 'id-EVT-000', code: 'EVT-000', name: 'Last Summer',
    task_line: 'CAME TO THE SUMMER JAM', flavor: 'Long gone.',
    season: 'S26', series: 'event', number: null, rarity: 'holo',
    art_url: null, thumb_url: null,
    award_type: 'code', claim_code: 'SUMMERJAM', trigger_key: null,
    active_from: '2026-06-01T00:00:00.000Z', active_until: '2026-06-02T00:00:00.000Z',
    enabled: true, display_order: 99
  }
];

// Three already earned, so the grid has both states in it from the start.
const OWNED = ['id-ACC-001', 'id-COL-001', 'id-APP-001'];

// Tiers chosen so that claiming ONE card crosses one of them -- that is the
// moment worth testing, and it is hard to test by accident.
const TIERS = [
  { id: 'r3',  cards_required: 3,  reward: 'A free card sleeve',     description: 'One per customer', enabled: true },
  { id: 'r4',  cards_required: 4,  reward: '10% off a booster pack', description: null,               enabled: true },
  { id: 'r10', cards_required: 10, reward: 'A booster box at cost',  description: null,               enabled: true }
];
const REDEMPTIONS = [{ tier_id: 'r3', redeemed_at: '2026-08-10T12:00:00.000Z' }];

const stub = (signedIn) => `(() => {
  const CARDS = ${JSON.stringify(CARDS)};
  const TIERS = ${JSON.stringify(TIERS)};
  const REDEMPTIONS = ${JSON.stringify(REDEMPTIONS)};
  window.__owned = ${JSON.stringify(OWNED)};
  window.__writes = [];
  const SIGNED_IN = ${signedIn};

  const rows = (table) => {
    if (table === 'infinite_dex_cards') return CARDS.filter(c => c.enabled);
    if (table === 'user_dex_cards') return window.__owned.map(id => ({ card_id: id, earned_at: '2026-08-01T12:00:00.000Z' }));
    if (table === 'dex_reward_tiers') return TIERS;
    if (table === 'dex_reward_redemptions') return SIGNED_IN ? REDEMPTIONS : [];
    return [];
  };
  const mkQuery = (table) => {
    const q = {
      select: () => q, eq: () => q, in: () => q, limit: () => q, order: () => q,
      maybeSingle: async () => ({ data: table === 'profiles' && SIGNED_IN ? { username: 'tacomike417' } : null, error: null }),
      single: async () => ({ data: null, error: null }),
      update(v){ window.__writes.push({ table, op:'update', v }); return q; },
      insert(v){ window.__writes.push({ table, op:'insert', v }); return q; },
      upsert(v){ window.__writes.push({ table, op:'upsert', v }); return q; },
      delete: () => q,
      then: (res) => res({ data: rows(table), error: null })
    };
    return q;
  };

  // What public.claim_dex_card() does, in the same order and with the same
  // four answers. Kept deliberately close to the SQL so a change to one is
  // obvious against the other.
  const claim = (word) => {
    const w = String(word || '').trim().toUpperCase();
    if (!SIGNED_IN || !w) return { status: 'invalid' };
    const card = CARDS.find(c => c.enabled && c.award_type === 'code'
      && String(c.claim_code || '').trim().toUpperCase() === w);
    if (!card) return { status: 'invalid' };
    const now = Date.now();
    if (card.active_from && now < Date.parse(card.active_from)) return { status: 'closed', code: card.code };
    if (card.active_until && now > Date.parse(card.active_until)) return { status: 'closed', code: card.code };
    if (window.__owned.includes(card.id)) return { status: 'already', code: card.code };
    window.__owned = window.__owned.concat([card.id]);
    return { status: 'awarded', card_id: card.id, code: card.code, name: card.name,
             task_line: card.task_line, flavor: card.flavor, rarity: card.rarity,
             art_url: card.art_url, thumb_url: card.thumb_url };
  };

  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: SIGNED_IN ? { user: { id: 'u1' } } : null } }),
      getUser: async () => ({ data: { user: SIGNED_IN ? { id: 'u1' } : null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
      signOut: async () => ({ error: null })
    },
    rpc: async (fn, args) => {
      if (fn === 'claim_dex_card') return { data: claim(args && args.p_claim_code), error: null };
      if (fn === 'award_dex_card') return { data: { status: 'not_yet' }, error: null };
      return { data: [], error: null };
    },
    from: mkQuery,
    storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), getPublicUrl: (x) => ({ data: { publicUrl: x } }) }) }
  }) };
})()`;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = [];

const open = async (query = '?page=dex', signedIn = true) => {
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts\.g|TUNNEL|ERR_|404|cdn\.test/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  await pg.route('https://cdn.test/**', (r) => r.abort());
  await pg.addInitScript(stub(signedIn));
  await pg.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('#dex-page .dex-tile', { timeout: 6000 });
  return pg;
};

const p = await open();

console.log('--- the grid he opens ---');
{
  const tiles = await p.$$eval('#dex-page .dex-tile', (n) => n.length);
  check('every card in the set, plus the shop cards', tiles === 14, tiles + ' tiles');

  const head = (await p.textContent('.dex-head')).replace(/\s+/g, ' ');
  check('it counts the season only, not the shop cards', /3 of 12 collected/.test(head), head.slice(0, 40));
  check('...and says it as a percentage too', /25%/.test(head));

  const earnedNames = await p.$$eval('#dex-page .dex-tile.is-earned .dex-tile-name', (n) => n.map((x) => x.textContent));
  check('the three they have are named', earnedNames.length === 3 && earnedNames.includes('The Initiate'), earnedNames.join(', '));

  const locked = await p.$eval('#dex-page .dex-tile:not(.is-earned)', (n) => ({
    name: n.querySelector('.dex-tile-name').textContent,
    task: n.querySelector('.dex-tile-task').textContent,
    lock: !!n.querySelector('.dex-tile-lock')
  }));
  check('one they do not have keeps its name back', locked.name === '???', locked.name);
  check('...but still says what it would take', /FIRST WISH SAVED/.test(locked.task), locked.task);
  check('...and is marked locked', locked.lock);

  const grey = await p.$eval('#dex-page .dex-tile:not(.is-earned) img', (n) => getComputedStyle(n).filter);
  check('an unearned card is visibly drained of colour', /grayscale/.test(grey), grey);
  const colour = await p.$eval('#dex-page .dex-tile.is-earned img', (n) => getComputedStyle(n).filter);
  check('...and an earned one is not', colour === 'none', colour);

  check('the shop cards get their own heading', /From the shop/.test(await p.textContent('#dex-page')));
}

console.log('--- what the rewards say before anything is claimed ---');
{
  const line = (await p.textContent('.dex-reward-next')).replace(/\s+/g, ' ').trim();
  check('it says how many more, and for what', /^1 more card for 10% off a booster pack/.test(line), line);
  check('...and is explicit that this number counts both grids',
    /3 of 4 cards collected, season and shop together/.test(line), line);
  check('...which is a different number from the season fraction above it',
    /3 of 12 collected/.test((await p.textContent('.dex-head')).replace(/\s+/g, ' ')));

  const rows = await p.$$eval('.dex-reward-row', (n) => n.map((x) => ({
    t: x.textContent.replace(/\s+/g, ' ').trim(), cls: x.className
  })));
  check('every reward is listed, reachable or not', rows.length === 3, rows.length + ' rows');
  check('one already paid out says when', /Collected August 10/.test(rows[0].t) && /is-done/.test(rows[0].cls), rows[0].t);
  check('...and the far one counts down honestly', /7 more cards to go/.test(rows[2].t), rows[2].t);
  check('a reward not yet reached is dimmed, not hidden', !/is-met/.test(rows[2].cls));
  check('nothing is waiting at the counter yet', !(await p.$('.dex-reward-ready')));
}

console.log('--- typing the word off the board ---');
{
  await p.fill('#dex-claim-input', 'nonsense');
  await p.click('#dex-claim-form button[type=submit]');
  await p.waitForTimeout(250);
  check('a wrong code says so, kindly', /isn.t right/i.test(await p.textContent('#dex-claim-status')), await p.textContent('#dex-claim-status'));

  await p.fill('#dex-claim-input', '  grandopening  ');
  await p.click('#dex-claim-form button[type=submit]');
  await p.waitForTimeout(500);

  check('the right code, typed sloppily, still works', /Got it/.test(await p.textContent('#dex-claim-status')), await p.textContent('#dex-claim-status'));
  const toast = await p.$('.dex-toast');
  check('...and it announces itself', !!toast);
  check('...saying which card', /Grand Opening/.test(toast ? await toast.textContent() : ''));
  check('...without being a modal in the way', toast ? await p.isVisible('.dex-grid') : false);

  const head = (await p.textContent('.dex-head')).replace(/\s+/g, ' ');
  check('the season count does NOT move for a shop card', /3 of 12 collected/.test(head), head.slice(0, 40));

  const evt = await p.$eval('#dex-page', (el) =>
    [...el.querySelectorAll('.dex-tile')].find((t) => t.textContent.includes('SHOW UP SEPTEMBER'))?.className || '');
  check('the card lights up in the grid', /is-earned/.test(evt), evt);
  check('the box empties, ready for the next one', (await p.inputValue('#dex-claim-input')) === '');
}

console.log('--- the card that tips them over a reward ---');
{
  await p.waitForTimeout(1100);   // the reward toast is staggered behind the card's
  const toasts = await p.$$eval('.dex-toast', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ')));
  check('a second toast fires for the reward itself', toasts.some((t) => /REWARD UNLOCKED/.test(t)), toasts.join(' | '));
  check('...naming what they get', toasts.some((t) => /10% off a booster pack/.test(t)));

  const ready = await p.$('.dex-reward-ready');
  check('the top of the page now says it is waiting at the counter', !!ready);
  const t = ready ? (await ready.textContent()).replace(/\s+/g, ' ') : '';
  check('...names the reward', /10% off a booster pack/.test(t), t.slice(0, 70));
  check('...and tells them the username to say, rather than expecting them to remember it',
    /tacomike417/.test(t), t.slice(0, 90));

  const row = await p.$$eval('.dex-reward-row', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ')));
  check('the reward list agrees', /Ready — show your username/.test(row[1]), row[1]);
}

console.log('--- the same code twice ---');
{
  await p.fill('#dex-claim-input', 'GRANDOPENING');
  await p.click('#dex-claim-form button[type=submit]');
  await p.waitForTimeout(300);
  const s = await p.textContent('#dex-claim-status');
  check('says they already have it', /already have/i.test(s), s);
  check('...and does not treat it as an error', !(await p.$eval('#dex-claim-status', (n) => n.classList.contains('is-bad'))));
}

console.log('--- a code that has closed ---');
{
  await p.fill('#dex-claim-input', 'SUMMERJAM');
  await p.click('#dex-claim-form button[type=submit]');
  await p.waitForTimeout(300);
  const s = await p.textContent('#dex-claim-status');
  check('an expired code says closed, not wrong', /closed/i.test(s), s);
}

console.log('--- tapping a card ---');
{
  await p.evaluate(() => {
    [...document.querySelectorAll('#dex-page .dex-tile')]
      .find((t) => t.textContent.includes('FIRST WISH SAVED')).click();
  });
  await p.waitForTimeout(200);
  const t = (await p.textContent('.dex-detail')).replace(/\s+/g, ' ');
  check('a locked card opens without giving its name away', /Not yet collected/.test(t), t.slice(0, 60));
  check('...and says how it is earned', /turns up on its own/.test(t));
  check('...and does not leak the flavour line', !/The hunt begins/.test(t));

  await p.click('[data-dex-back]');
  await p.waitForTimeout(200);
  check('back returns to the grid', await p.isVisible('.dex-grid'));

  await p.evaluate(() => {
    [...document.querySelectorAll('#dex-page .dex-tile')]
      .find((t) => t.textContent.includes('The Initiate')).click();
  });
  await p.waitForTimeout(200);
  const t2 = (await p.textContent('.dex-detail')).replace(/\s+/g, ' ');
  check('an earned card shows its name', /The Initiate/.test(t2));
  check('...its flavour line', /Welcome, collector/.test(t2));
  check('...when they got it', /Collected August 1, 2026/.test(t2), t2.slice(0, 90));
  check('...and its collector code', /ACC-001 · S26/.test(t2));
  await p.click('[data-dex-back]');
}

console.log('--- the QR code on the board ---');
{
  const q = await open('?page=dex&code=GRANDOPENING');
  await q.waitForTimeout(700);
  const s = await q.textContent('#dex-claim-status');
  check('a link with the code on it claims it on arrival', /Got it/.test(s), s);
  check('...and the card is theirs', await q.$eval('#dex-page', (el) =>
    [...el.querySelectorAll('.dex-tile')].some((t) => t.textContent.includes('SHOW UP SEPTEMBER') && t.classList.contains('is-earned'))));
  await q.close();
}

console.log('--- signed out ---');
{
  const q = await open('?page=dex', false);
  check('the grid still shows, because it is the pitch', (await q.$$eval('#dex-page .dex-tile', (n) => n.length)) === 14);
  check('nothing is marked as theirs', (await q.$$eval('#dex-page .dex-tile.is-earned', (n) => n.length)) === 0);
  check('the box is not usable yet', await q.isDisabled('#dex-claim-input'));
  check('...and says why', /free account/i.test(await q.textContent('#dex-claim-status')));
  check('no reward is promised to nobody', !(await q.$('.dex-reward-ready')) && !(await q.$('.dex-reward-next')));
  const rows = await q.$$eval('.dex-reward-row', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ')));
  check('...but the rewards are still on show, because they are the pitch',
    rows.length === 3 && /At 3 cards/.test(rows[0]), rows[0]);
  await q.close();
}

console.log('--- how they find it ---');
{
  const q = await open();
  const menu = await q.$$eval('#menu-links .menu-link', (n) => n.map((x) => x.textContent.trim()));
  check('Infinite Dex is in the menu', menu.includes('Infinite Dex'), menu.join(' / '));
  await q.close();
}

console.log('--- the rule the whole thing rests on ---');
{
  const wrote = await p.evaluate(() => window.__writes.filter((w) => w.table === 'user_dex_cards'));
  check('the app never writes to user_dex_cards itself', wrote.length === 0, JSON.stringify(wrote));
}

check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

await b.close();
server.close();
console.log(`\n${fails ? fails + ' OF ' + total + ' CHECKS FAILED' : total + ' CHECKS PASSED'}`);
process.exit(fails ? 1 : 0);
