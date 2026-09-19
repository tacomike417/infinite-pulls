/* Writes a real HTML page for every card in every public collection.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The same reason tools/build-post-pages.mjs and tools/build-gallery-pages.mjs
 * exist, and worth repeating rather than cross-referencing, because the
 * failure here was silent for a long time and looked like success:
 *
 * components/profile.js already renders this page. A person who taps CARD
 * DETAILS in the feed gets it, and always has. What happens underneath is
 * that GitHub Pages has no file at /<user>/collection/<slug>, answers with a
 * genuine HTTP 404, serves 404.html, and 404.html stashes the path and
 * bounces to / where the app puts it back. A person sees a flicker. A
 * crawler sees 404 and leaves.
 *
 * So every card page on this site was invisible to Google and unfurled on
 * Facebook as the site's generic card -- and it tested perfectly, because
 * everybody testing it had a browser.
 *
 * THE THING TO UNDERSTAND BEFORE EDITING THIS FILE
 *
 * Once a real file exists at that path, GitHub Pages serves THE FILE.
 * profile.js's version of this page stops running for everybody. So this
 * page is not a stub that hands off to the app -- it has to carry what the
 * app's page carried, or the fix for crawlers is a downgrade for people.
 * That is why it reads TCGdex for rarity, illustrator, HP and the market
 * price of the exact finish somebody owns.
 *
 * WHAT IT NEEDS
 *
 * Nothing secret. The Supabase URL and anon key out of config.js -- the same
 * public key the browser uses -- and only rows those keys may already read:
 * cards belonging to profiles with is_public true. No repository secrets.
 *
 * WHAT IT WRITES
 *
 *   <username>/collection/<slug>/index.html   one per owned card
 *   collection-sitemap.xml                    so they can be found at all
 *   tools/.tcgdex-cache.json                  see THE CACHE below
 *
 * THE CACHE, AND WHY IT IS COMMITTED
 *
 * A card's rarity and illustrator never change. Its price does, slowly.
 * Without a cache this would ask TCGdex for every card on every run, and on
 * a ten-minute schedule that is thousands of requests a day at somebody
 * else's expense for data that mostly did not move. So answers are kept in
 * tools/.tcgdex-cache.json, committed with the pages, and refetched only
 * when older than CACHE_HOURS. Steady state is close to zero requests.
 *
 * A card TCGdex does not know still gets a page. It gets the page without
 * the extras, which is the collection row's own information -- name, set,
 * finish, condition, how many -- and that is a real page.
 *
 * Run:  node tools/build-collection-pages.mjs
 */

import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SITE = process.env.SITE_ORIGIN || 'https://infinitepulls.com';
const TCGDEX = 'https://api.tcgdex.net/v2/en';

/* Same reasoning as the post builder: every page is a directory on disk and
   a line in a sitemap. This is far more than the shop has and small enough
   that the repo does not become mostly index.html files. */
const MAX_CARDS = 2000;

/* How stale a cached card may be before it is asked for again. Rarity and
   illustrator never move; the price does, and a day old is honest for a
   number that is labeled as a market estimate. */
const CACHE_HOURS = 24;

/* How many cards may be fetched in one run. A first run over a large shelf
   would otherwise hammer TCGdex in one burst; instead it fills in over
   several runs and every card has a page from the first one -- just without
   the extras until its turn comes. */
const FETCH_BUDGET = 120;

/* Names that are folders, pages or query-string routes in the app. Kept
   identical to the post builder's list for the same reason it has one: a
   page written under one of these would shadow something real. */
const RESERVED = new Set([
  'admin','assets','components','supabase','api','www','null','undefined',
  'favicon','index','readme','cname','app','style','config','manifest',
  'service-worker','home','shop','collection','pokedex','dex','goals','events',
  'deals','lookup','location','hours','contact','about','account','menu',
  'gallery','pulls','infinite-questions','feed-next','tools','post'
]);

const usable = (name) =>
  /^[A-Za-z0-9_-]{3,24}$/.test(String(name || '')) && !RESERVED.has(String(name).toLowerCase());

/* ---------- THE SLUG ------------------------------------------------------
   Character-for-character the same rule as components/profile.js and
   feed-next/feed.js. It is a contract between three files: the feed writes
   the link, this writes the page, profile.js renders it in the app when no
   file exists yet. Change it in one place and every link points at nothing.
   the collectionpages suite asserts all three agree. */
const slugify = (text) => String(text).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40) || 'card';

const cardSlug = (row) =>
  `${slugify(row.card_name)}-${String(row.id).replace(/-/g, '').slice(0, 8)}`;

/* ---------- config, read from the file the browser already uses ---------- */

async function readConfig() {
  const src = await readFile(path.join(ROOT, 'config.js'), 'utf8');
  const url = /SUPABASE_URL:\s*["']([^"']+)["']/.exec(src);
  const key = /SUPABASE_ANON_KEY:\s*["']([^"']+)["']/.exec(src);
  const pic = /CARD_PHOTO_BASE:\s*["']([^"']*)["']/.exec(src);
  if (!url || !key) throw new Error('Could not read SUPABASE_URL / SUPABASE_ANON_KEY out of config.js');
  if (url[1].includes('YOUR-PROJECT-REF')) throw new Error('config.js has not been filled in yet');
  return {
    url: url[1].replace(/\/+$/, ''),
    key: key[1],
    photos: (pic ? pic[1] : '').replace(/\/+$/, '')
  };
}

async function rest(cfg, pathAndQuery) {
  const res = await fetch(`${cfg.url}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` }
  });
  if (!res.ok) throw new Error(`Supabase returned ${res.status} for ${pathAndQuery}`);
  return res.json();
}

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const photoUrl = (cfg, key) => {
  if (!key) return '';
  if (/^https?:\/\//i.test(key)) return key;
  if (!cfg.photos) return '';
  return cfg.photos + '/p/' + String(key).split('/').map(encodeURIComponent).join('/');
};

const thumbUrl = (image, size = 'high') => (image ? `${image}/${size}.webp` : '');

const money = (n) =>
  typeof n === 'number' && isFinite(n)
    ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : '';

/* The app's own labels, so a card does not describe its finish one way in
   the feed and another way on its own page. */
const VARIANT_LABELS = {
  'normal': 'Normal',
  'holofoil': 'Holofoil',
  'reverse-holofoil': 'Reverse Holofoil',
  '1st-edition': '1st Edition',
  '1st-edition-holofoil': '1st Edition Holofoil',
  'unlimited': 'Unlimited',
  'unlimited-holofoil': 'Unlimited Holofoil'
};
const finishOf = (v) => {
  const k = String(v || '').trim().toLowerCase();
  if (!k) return '';
  return VARIANT_LABELS[k] || k.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

/* THE SAME FIVE GRADERS, THE SAME LINKS the app and the post pages use.
   A copy, kept in step by hand: this runs in a GitHub action with nothing
   to import from. A slab has to read the same on the page a customer lands
   on as it does inside the app. */
const GRADER_LINKS = {
  TAG: (c) => `https://my.taggrading.com/card/${encodeURIComponent(c)}`,
  PSA: (c) => `https://www.psacard.com/cert/${encodeURIComponent(c)}`,
  CGC: (c) => `https://www.cgccards.com/certlookup/${encodeURIComponent(c)}/`,
  SGC: () => 'https://gosgc.com/cert-code-lookup',
  BGS: () => 'https://www.beckett.com/grading'
};
const graderOf = (cond) => {
  const first = String(cond || '').trim().split(/\s+/)[0].toUpperCase();
  return GRADER_LINKS[first] ? first : '';
};

const localNum = (cardId) => {
  const m = /-([^-]+)$/.exec(String(cardId || '').trim());
  return m ? m[1] : '';
};

/* Same shape profile.js reads: pricing.tcgplayer[<variant>].marketPrice. */
const priceForVariant = (card, variantKey) => {
  const entry = card && card.pricing && card.pricing.tcgplayer
    ? card.pricing.tcgplayer[variantKey] : null;
  return entry && typeof entry.marketPrice === 'number' ? entry.marketPrice : null;
};

/* ---------- the TCGdex cache --------------------------------------------- */

const CACHE_PATH = path.join(ROOT, 'tools', '.tcgdex-cache.json');

async function loadCache() {
  try { return JSON.parse(await readFile(CACHE_PATH, 'utf8')); }
  catch { return {}; }
}

const fresh = (hit) =>
  hit && hit.at && (Date.now() - Date.parse(hit.at)) < CACHE_HOURS * 3600 * 1000;

async function fetchCard(id) {
  try {
    const res = await fetch(`${TCGDEX}/cards/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/* Only the handful of fields the page shows is kept. Storing whole TCGdex
   payloads would put megabytes of move lists and legality tables into the
   repository to print four lines. */
const slim = (card) => !card ? null : {
  image: card.image || '',
  rarity: card.rarity || '',
  category: card.category || '',
  illustrator: card.illustrator || '',
  hp: card.hp == null ? '' : String(card.hp),
  pricing: card.pricing && card.pricing.tcgplayer
    ? { tcgplayer: card.pricing.tcgplayer } : null
};

/* ---------- one card's page ---------------------------------------------- */

function cardPage(item) {
  const url   = `${SITE}/${item.handle}/collection/${item.slug}`;
  const app   = `${SITE}/feed-next/?post=c-${encodeURIComponent(item.rowId)}`;
  const title = item.set ? `${item.name} — ${item.set}` : item.name;

  /* Third slot means the value is already HTML and must not be escaped
     again. Only the rows that carry a link or a colour use it. */
  const facts = [
    ['Collection', `${item.handle}`],
    item.finish ? ['Finish', item.finish] : null,
    item.condition
      ? [item.company ? 'Grade' : 'Condition',
         item.company ? `<span class="grade">${esc(item.condition)}</span>` : esc(item.condition), true]
      : null,
    /* THE CERTIFICATE, AND THE REPORT BEHIND IT. This page is where a
       customer looks at somebody else's slab, which makes it the one place
       the number most needs to be checkable -- and it was the one place it
       was not printed at all. */
    item.cert
      ? ['Cert #', item.company
          ? `<a href="${esc(GRADER_LINKS[item.company](item.cert))}" target="_blank" rel="noopener noreferrer">` +
            `${esc(item.cert)}<small>${esc(item.company)} report \u2197</small></a>`
          : esc(item.cert), true]
      : null,
    item.quantity > 1 ? ['Quantity', `${item.quantity} copies`] : null,
    item.rarity ? ['Rarity', item.rarity] : null,
    item.category ? ['Category', item.category] : null,
    item.illustrator ? ['Illustrator', item.illustrator] : null,
    item.hp ? ['HP', item.hp] : null,
    /* WHETHER IT IS UP OR DOWN, not just what it is. The figure alone is
       the one thing this page has always had and the one thing that says
       nothing -- a price with no direction is a number, not news. Measured
       against the reading closest to the day it was added, from
       card_price_history, so it is this card's own move and not the
       market's. */
    item.price != null
      ? ['Market price', item.moveHtml
          ? `<span class="${item.dir}">${esc(money(item.price))}</span>${item.moveHtml}`
          : esc(money(item.price)), true]
      : null,
    (item.price != null && item.quantity > 1) ? ['Line value', money(item.price * item.quantity)] : null
  ].filter(Boolean);

  const desc = [
    `${item.name}${item.set ? ` from ${item.set}` : ''}`,
    item.finish ? `in ${item.finish}` : '',
    `in ${item.handle}'s collection at Infinite Pulls.`
  ].filter(Boolean).join(' ');

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: title,
    description: desc,
    ...(item.image ? { image: item.image } : {}),
    ...(item.category ? { category: item.category } : {}),
    brand: { '@type': 'Brand', name: 'Pokémon' },
    /* THE PRICE IS AN ESTIMATE OF WHAT THE CARD IS WORTH, not an offer --
       none of these are for sale. Marked up as a valuation rather than an
       Offer so it cannot be read as a shop listing by anything crawling it. */
    ...(item.price != null ? {
      additionalProperty: {
        '@type': 'PropertyValue',
        name: 'Market price',
        value: item.price,
        unitText: 'USD'
      }
    } : {}),
    copyrightHolder: { '@type': 'Organization', name: 'Infinite Pulls' }
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} — Infinite Pulls</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="#03070d">
<link rel="icon" href="${SITE}/assets/icons/icon-192.png">

<meta property="og:type" content="article">
<meta property="og:site_name" content="Infinite Pulls">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
${item.image ? `<meta property="og:image" content="${esc(item.image)}">
<meta property="og:image:alt" content="${esc(title)}">` : ''}

<meta name="twitter:card" content="${item.image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
${item.image ? `<meta name="twitter:image" content="${esc(item.image)}">` : ''}

<script type="application/ld+json">${jsonLd}</script>

<style>
:root{--bg:#03070d;--panel:#0a1120;--panel-2:#11213a;--text:#f7f8fb;
      --muted:#9eb0c8;--blue:#19bfff;--gold:#ffc928;--border:rgba(255,255,255,.09)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
     font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
/* Sized for a phone, which is where a shared link gets opened. */
.wrap{max-width:560px;margin:0 auto;padding:16px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0 14px}
.brand{color:var(--gold);font-weight:900;letter-spacing:.12em;text-transform:uppercase;
       font-size:.78rem;text-decoration:none}
.home{color:var(--blue);text-decoration:none;font-weight:700;font-size:.9rem}
figure{margin:0;border:1px solid var(--border);border-radius:18px;overflow:hidden;background:var(--panel)}
img.photo{display:block;width:100%;height:auto;background:var(--panel-2)}
figcaption{padding:16px}
h1{margin:0;font-size:1.15rem;line-height:1.45;font-weight:600}
.credit{margin:10px 0 0;color:var(--muted)}
.credit a{color:var(--blue);font-weight:700;text-decoration:none}
/* Label left, value right -- the same shape CARD PULSE uses in the feed, so
   somebody arriving here from a post is not reading a different app. */
dl.facts{margin:16px 0 0;display:grid;gap:8px}
dl.facts > div{display:flex;align-items:baseline;gap:12px}
dl.facts dt{flex:none;width:104px;color:var(--muted);font-size:.74rem;
            letter-spacing:.11em;text-transform:uppercase;font-weight:700}
dl.facts dd{margin:0;flex:1;min-width:0;font-weight:700;overflow-wrap:anywhere}
.note{margin:14px 0 0;color:var(--muted);font-size:.78rem}
.note b{color:var(--text)}
dl.facts dd small{display:block;margin-top:2px;color:var(--muted);
  font-size:.62rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
dl.facts dd a{color:var(--blue);text-decoration:none}
.grade{color:var(--gold)}
.up{color:#43d17f}
.down{color:#ff7a7a}
.sold{display:flex;align-items:center;justify-content:center;margin-top:12px;
  min-height:44px;border:1px solid var(--border);border-radius:12px;
  color:var(--gold);text-decoration:none;font-weight:800;font-size:.72rem;
  letter-spacing:.09em;text-transform:uppercase}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
.btn{flex:1 1 auto;text-align:center;text-decoration:none;font-weight:800;
     padding:14px 18px;border-radius:14px;min-height:48px;
     display:inline-flex;align-items:center;justify-content:center}
.btn-primary{background:linear-gradient(135deg,#0ea5e9,var(--blue));color:#03101b}
.btn-ghost{border:1px solid var(--border);color:var(--text)}
footer{margin:26px 0 10px;color:var(--muted);font-size:.85rem;text-align:center}
footer a{color:var(--blue)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <a class="brand" href="${SITE}/">Infinite Pulls</a>
    <a class="home" href="${SITE}/feed-next/">The feed →</a>
  </header>

  <figure>
    ${item.image
      ? `<img class="photo" src="${esc(item.image)}" alt="${esc(title)}" width="1200" height="1650">`
      : ''}
    <figcaption>
      <h1>${esc(title)}</h1>
      <p class="credit">In <a href="${SITE}/${esc(item.handle)}">${esc(item.handle)}</a>&rsquo;s collection.</p>

      <dl class="facts">${facts.map(([k, v, raw]) => `
        <div><dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd></div>`).join('')}
      </dl>

      ${item.price != null
        ? `<p class="note">Market price is an estimate from TCGplayer for this finish. This card is not for sale.</p>`
        : ''}
      ${item.offNM
        ? `<p class="note">That figure is a <b>raw Near Mint</b> price. A ${esc(item.condition)}
           copy sells for something different &mdash; sold listings are the real picture.</p>
           <a class="sold" href="${esc(item.sold)}" target="_blank" rel="noopener noreferrer">See sold listings</a>`
        : ''}

      <div class="actions">
        <a class="btn btn-primary" href="${esc(app)}">See it in the feed</a>
        <a class="btn btn-ghost" href="${SITE}/${esc(item.handle)}">${esc(item.handle)}&rsquo;s collection</a>
      </div>
    </figcaption>
  </figure>

  <footer>
    <a href="${SITE}/">Infinite Pulls</a> — TCG &amp; Hobby Shop
  </footer>
</div>
</body>
</html>
`;
}

/* ---------- go ------------------------------------------------------------ */

async function main() {
  const cfg = await readConfig();

  /* WHO IS PUBLIC, and separately, who shows prices. show_price is a
     per-person setting the app already honors on this very page; a static
     copy that ignored it would publish a number somebody chose to hide. */
  const people = await rest(cfg,
    'profiles?select=id,username,is_public,show_price&is_public=eq.true&limit=5000');
  const byId = new Map();
  people.forEach((p) => {
    if (usable(p.username)) byId.set(p.id, { handle: p.username, showPrice: p.show_price !== false });
  });
  if (!byId.size) { console.log('No public profiles with a usable username. Nothing to write.'); return; }

  const ids = [...byId.keys()];
  const inList = `(${ids.map((x) => `"${x}"`).join(',')})`;

  /* hidden_feed is respected here too. A card somebody took off the feed
     should not keep a public page with its own address. */
  /* cert_number may not exist yet on a database that has not had
     cert_number.sql run, and asking for a missing column fails the WHOLE
     query -- so it is tried once and dropped on the one error that means
     that, the same way the feed and the post builder do it. */
  const CARD_COLS = 'id,user_id,card_id,card_name,set_name,image_url,photo_key,' +
                    'variant,condition,quantity,added_at,hidden_feed';
  const rowQuery = (extra) =>
    `user_cards?select=${CARD_COLS}${extra}&user_id=in.${inList}` +
    `&hidden_feed=is.false&order=added_at.desc&limit=${MAX_CARDS}`;

  let rows;
  try {
    rows = await rest(cfg, rowQuery(',cert_number'));
  } catch (e) {
    if (!/\b400\b/.test(String(e && e.message))) throw e;
    console.log('No cert_number column on this database - run supabase/cert_number.sql. ' +
                'Certificate numbers will be left off the pages until then.');
    rows = await rest(cfg, rowQuery(''));
  }

  const keep = rows.slice(0, MAX_CARDS);

  /* ---- fill in what TCGdex knows, within the budget ---- */
  const cache = await loadCache();
  let fetched = 0, served = 0;
  for (const r of keep) {
    if (!r.card_id) continue;
    if (fresh(cache[r.card_id])) { served++; continue; }
    if (fetched >= FETCH_BUDGET) continue;
    const card = await fetchCard(r.card_id);
    fetched++;
    cache[r.card_id] = { at: new Date().toISOString(), card: slim(card) };
    /* Gentle on somebody else's free API. */
    await new Promise((r2) => setTimeout(r2, 120));
  }
  await mkdir(path.join(ROOT, 'tools'), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 0), 'utf8');

  /* ---- what each card was worth when it went in, and what it is worth
          now ----------------------------------------------------------
     THE VARIANT IS THE PRINTING. sync-prices writes one tcgplayer row per
     printing per day -- "normal", "holofoil", "reverse-holofoil" -- and one
     cardmarket row called "trend". There is no variant called "market".

     Read with the public anon key, so card_price_history needs a policy for
     anon or this comes back empty and every page simply carries the figure
     with no direction on it, exactly as it did before. That policy is
     supabase/card_price_history_public.sql. Nothing here fails without it. */
  const cardIds = [...new Set(keep.map((r) => r.card_id).filter(Boolean))];
  const series = new Map();   /* card_id -> { printing: [ {price, on}, ... ] } */
  for (let i = 0; i < cardIds.length; i += 100) {
    const slice = cardIds.slice(i, i + 100);
    const list = `(${slice.map((x) => `"${x}"`).join(',')})`;
    let hist = [];
    try {
      hist = await rest(cfg,
        `card_price_history?select=card_id,variant,price,recorded_on` +
        `&card_id=in.${list}&source=eq.tcgplayer&order=recorded_on.asc&limit=20000`);
    } catch (_) { hist = []; }
    hist.forEach((h) => {
      if (!series.has(h.card_id)) series.set(h.card_id, {});
      const book = series.get(h.card_id);
      (book[h.variant] = book[h.variant] || []).push(
        { price: Number(h.price), on: h.recorded_on });
    });
  }
  if (cardIds.length && !series.size) {
    console.log('No price history came back for any card. If there should be some, ' +
                'card_price_history has no policy for the anon role - ' +
                'run supabase/card_price_history_public.sql.');
  }

  /* The reading closest to the day it was added, without going past it.
     If the history does not reach back that far, the earliest reading is
     used instead of nothing -- and the caller shows no arrow either way if
     there is only the one reading, because one point is not a direction. */
  function priceWhenAdded(cardId, variant, addedAt) {
    const book = series.get(cardId);
    if (!book) return null;
    const key = Object.prototype.hasOwnProperty.call(book, variant)
      ? variant
      : Object.keys(book).sort((a, b) => book[b].length - book[a].length)[0];
    const list = key ? book[key] : null;
    if (!list || !list.length) return null;
    const day0 = addedAt ? String(addedAt).slice(0, 10) : null;
    let pick = null;
    if (day0) for (const row of list) { if (String(row.on).slice(0, 10) <= day0) pick = row; }
    return pick || list[0];
  }

  /* ---- build the list ---- */
  const items = keep.map((r) => {
    const who = byId.get(r.user_id);
    const hit = cache[r.card_id] && cache[r.card_id].card;
    const price = (who.showPrice && hit) ? priceForVariant(hit, r.variant) : null;

    const condition = (r.condition || '').trim();
    const company = graderOf(condition);
    const cert = String(r.cert_number || '').trim();

    /* The arrow. Only drawn when there is something real to compare with:
       a price today, a reading from around the day it was added, and an
       actual gap between them. A green arrow on a card that has not moved
       is worse than no arrow. */
    const then = price != null ? priceWhenAdded(r.card_id, r.variant, r.added_at) : null;
    const move = (then && isFinite(then.price)) ? price - then.price : null;
    const dir = (move == null || Math.abs(move) < 0.005) ? ''
      : (move > 0 ? 'up' : 'down');
    const pct = (dir && then.price > 0) ? (move / then.price) * 100 : null;
    const moveHtml = dir
      ? `<small>${dir === 'up' ? '\u25b2' : '\u25bc'} ${esc(money(Math.abs(move)))}` +
        `${pct != null ? ` (${move > 0 ? '+' : '\u2212'}${Math.abs(pct).toFixed(1)}%)` : ''}` +
        ` since added</small>`
      : '';

    /* Every figure on this site is a raw Near Mint market price. Saying so
       matters most here, where the reader is a customer and the card in
       front of them is a slab. */
    const offNM = !!company || (!!condition && !/^near mint$/i.test(condition));

    return {
      condition,
      company,
      cert,
      dir,
      moveHtml,
      offNM,
      sold: 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(
        [(r.card_name || '').trim(), localNum(r.card_id), (r.set_name || '').trim() || 'pokemon',
         company ? condition : ''].filter(Boolean).join(' ')) +
        '&LH_Sold=1&LH_Complete=1&_sop=13',
      handle: who.handle,
      slug: cardSlug(r),
      rowId: r.id,
      at: r.added_at,
      name: (r.card_name || 'A card').trim(),
      set: (r.set_name || '').trim(),
      finish: finishOf(r.variant),
      quantity: r.quantity || 1,
      rarity: hit ? hit.rarity : '',
      category: hit ? hit.category : '',
      illustrator: hit ? hit.illustrator : '',
      hp: hit ? hit.hp : '',
      price,
      /* The owner's own photograph first, then the catalog art -- the same
         order the feed uses, so the picture here is the picture there. */
      image: photoUrl(cfg, r.photo_key) || (hit && hit.image ? thumbUrl(hit.image, 'high') : '') || r.image_url || ''
    };
  });

  /* ---- sweep pages that should not exist any more ---- */
  const wanted = new Set(items.map((i) => `${i.handle}/collection/${i.slug}`));
  const handles = new Set(items.map((i) => i.handle));

  for (const handle of handles) {
    const dir = path.join(ROOT, handle, 'collection');
    if (!existsSync(dir)) continue;
    for (const entry of await readdir(dir)) {
      if (!wanted.has(`${handle}/collection/${entry}`)) {
        await rm(path.join(dir, entry), { recursive: true, force: true });
        console.log('removed', `${handle}/collection/${entry}`);
      }
    }
  }

  /* ---- write ---- */
  for (const item of items) {
    const dir = path.join(ROOT, item.handle, 'collection', item.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), cardPage(item), 'utf8');
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items.map((i) => `  <url>
    <loc>${esc(`${SITE}/${i.handle}/collection/${i.slug}`)}</loc>
    ${i.at ? `<lastmod>${esc(String(i.at).slice(0, 10))}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
  </url>`).join('\n')}
</urlset>
`;
  await writeFile(path.join(ROOT, 'collection-sitemap.xml'), xml, 'utf8');

  console.log(
    `Wrote ${items.length} collection pages and collection-sitemap.xml. ` +
    `TCGdex: ${served} from cache, ${fetched} fetched` +
    (fetched >= FETCH_BUDGET ? ` (budget reached -- the rest fill in next run)` : '') + '.'
  );
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
