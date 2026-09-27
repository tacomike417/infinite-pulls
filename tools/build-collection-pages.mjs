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
  'admin','assets','components','supabase','api','tools','data','pulls',
  'infinite-questions','feed-next','brand-kit','cf-worker','stress-test',
  'node_modules','icons','functions','retailer','privacy','card-art',
  'dex-art','jeff-photos','home','shop','collection','pokedex','dex','goals',
  'events','deals','lookup','location','hours','contact','about','account',
  'menu','gallery','item','thanks','movers','mine','wishlist','post','search',
  'feed','profile','www','null','undefined','favicon','index','readme',
  'cname','app','style','config','manifest','service-worker','robots',
  'sitemap','404','static','infinitepulls','infinite-pulls','infinite_pulls',
  'infinite','official','staff','support','help','team','moderator','mod',
  'owner','administrator','jeff','jeffhyde','jeff-hyde','hyde','hydebot',
  'hyde-bot','store','live','verified','security','billing','system','root',
  'me','you','everyone','pokemon','pokemontcg','tcgplayer','whatnot'
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
  /* With the ending slash -- see build-post-pages.mjs (27 Sep 2026). */
  const url   = `${SITE}/${item.handle}/collection/${item.slug}/`;
  const app   = `${SITE}/feed-next/?post=c-${encodeURIComponent(item.rowId)}`;
  const join  = `${app}&join=1&follow=${encodeURIComponent(item.handle)}`;
  const title = item.set ? `${item.name} — ${item.set}` : item.name;

  /* THE NEW LOOK (27 Sep 2026) -- the same white card, holo strip, big
     picture and orange-pink button as the shared post pages, so a card
     page and a post page read as one app. The facts are the THIS COPY
     grid those pages use. Third slot = the value is already HTML. */
  const facts = [
    item.condition
      ? [item.company ? 'Grade' : 'Condition',
         item.company ? `<span class="grade">${esc(item.condition)}</span>` : esc(item.condition), true]
      : null,
    item.finish ? ['Finish', item.finish] : null,
    item.edition ? ['Edition', item.edition] : null,
    /* THE CERTIFICATE, AND THE REPORT BEHIND IT -- the one place somebody
       looks at another person's slab, so the number has to be checkable. */
    item.cert
      ? ['Cert #', item.company
          ? `<a href="${esc(GRADER_LINKS[item.company](item.cert))}" target="_blank" rel="noopener noreferrer">` +
            `${esc(item.cert)}<small>${esc(item.company)} report ↗</small></a>`
          : esc(item.cert), true]
      : null,
    item.quantity > 1 ? ['Quantity', `${item.quantity} copies`] : null,
    item.rarity ? ['Rarity', item.rarity] : null,
    item.illustrator ? ['Illustrator', item.illustrator] : null,
    item.hp ? ['HP', item.hp] : null,
    item.category && !item.hp ? ['Category', item.category] : null,
    /* WHETHER IT IS UP OR DOWN since it was added, not just the figure. */
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
    `in @${item.handle}'s collection on Infinite Pulls.`
  ].filter(Boolean).join(' ');

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: title,
    description: desc,
    ...(item.image ? { image: item.image } : {}),
    ...(item.category ? { category: item.category } : {}),
    brand: { '@type': 'Brand', name: 'Pokémon' },
    /* AN ESTIMATE OF WHAT IT IS WORTH, not an offer -- none of these are for
       sale, so it is a PropertyValue and never an Offer. */
    ...(item.price != null ? {
      additionalProperty: { '@type': 'PropertyValue', name: 'Market price', value: item.price, unitText: 'USD' }
    } : {}),
    copyrightHolder: { '@type': 'Organization', name: 'Infinite Pulls' }
  });

  const face = item.face
    ? `<img class="face" src="${esc(item.face)}" alt="" width="44" height="44">`
    : `<span class="face blank">${esc(String(item.handle).slice(0, 1).toUpperCase())}</span>`;
  const tags = [item.name, item.set, item.rarity, item.company ? item.condition : '', item.edition]
    .filter(Boolean).map((t, k) => `<span class="tag${k ? '' : ' lead'}">${esc(t)}</span>`).join('');
  const story = item.story
    ? esc(item.story).replace(/(^|[^A-Za-z0-9_@.])@([A-Za-z0-9_.]{2,30}[A-Za-z0-9_])/g,
        (m, pre, h) => `${pre}<a class="at" href="${SITE}/${h}/">@${h}</a>`)
    : '';

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
:root{--bg:#03070d;--ink:#0d1725;--mute:#5b6b80;--line:#e6ebf2;--blue:#19bfff;--gold:#ffc928;
      --hot1:#ff7a2f;--hot2:#ff3d7f}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:#f7f8fb;
     font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:520px;margin:0 auto;padding:14px 14px 28px}
.top{display:flex;align-items:center;justify-content:space-between;padding:4px 2px 14px}
.brand{display:flex;align-items:center;gap:8px;color:var(--gold);font-weight:900;letter-spacing:.14em;
       text-transform:uppercase;font-size:.78rem;text-decoration:none}
.brand img{width:28px;height:28px;border-radius:8px}
.top .open{color:var(--blue);text-decoration:none;font-weight:800;font-size:.85rem}
.post{background:#fff;color:var(--ink);border-radius:22px;overflow:hidden;position:relative;
      box-shadow:0 14px 40px rgba(0,0,0,.45)}
.post::before{content:"";position:absolute;left:0;right:0;top:0;height:5px;z-index:2;
      background:linear-gradient(90deg,#ff7a2f,#ff3d7f,#7c5cff,#19bfff,#35d07f,#ffc13d)}
.who{display:flex;align-items:center;gap:10px;padding:16px 16px 12px}
.face{width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid var(--hot1);flex:none;background:#f1f4f8}
.face.blank{display:grid;place-items:center;font-weight:900;color:var(--hot1)}
.who b{display:block;font-size:1rem}
.who b a{color:inherit;text-decoration:none}
.who small{color:var(--mute);font-size:.8rem}
.pic{background:#0a1120;display:block}
.pic img{display:block;margin:0 auto;padding:18px 0;max-height:70vh;width:auto;max-width:86%;height:auto;
         filter:drop-shadow(0 10px 22px rgba(0,0,0,.55))}
.body{padding:14px 16px 18px}
h1{margin:0;font-size:1.2rem;line-height:1.35;font-weight:800}
.at{color:#0a8fd6;font-weight:800;text-decoration:none}
.story{margin:12px 0 0;padding:12px 14px;border-radius:14px;background:#fff7ef;border:1px solid #ffe0c7;
       font-style:italic;color:#5a3a1a;white-space:pre-line;overflow-wrap:anywhere}
.story b{font-style:normal;display:block;font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:var(--hot1);margin-bottom:4px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.tag{font-weight:800;font-size:.78rem;padding:6px 11px;border-radius:999px;background:#f1f4f8;color:#33445a}
.tag.lead{background:#e6f7ff;color:#0a79b8}
.spec{margin-top:16px;border-top:1px solid var(--line);padding-top:14px}
.spec-h{margin:0 0 10px;font-size:.66rem;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--hot1)}
.spec-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:0}
.spec-g div{min-width:0}
.spec-g dt{font-size:.6rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}
.spec-g dd{margin:3px 0 0;font-weight:800;font-size:.95rem;overflow-wrap:anywhere}
.spec-g dd small{display:block;margin-top:2px;font-size:.62rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.spec-g dd a{color:#0a8fd6;text-decoration:none}
.grade{color:#c47d00}
.up{color:#16a34a}
.down{color:#dc2626}
.note{margin:12px 0 0;font-size:.8rem;line-height:1.5;color:var(--mute)}
.note b{color:var(--ink)}
.sold{display:flex;align-items:center;justify-content:center;margin-top:10px;min-height:44px;
      border:1px solid var(--line);border-radius:12px;color:var(--ink);text-decoration:none;
      font-weight:800;font-size:.72rem;letter-spacing:.09em;text-transform:uppercase}
.cta{margin:18px 0 0;display:grid;gap:10px}
.go{display:flex;align-items:center;justify-content:center;min-height:56px;border-radius:16px;
    background:linear-gradient(135deg,var(--hot1),var(--hot2));color:#fff;text-decoration:none;
    font-weight:900;font-size:1.05rem;letter-spacing:.02em;box-shadow:0 8px 22px rgba(255,61,127,.35)}
.go2{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:14px;
     border:1px solid var(--line);color:var(--ink);text-decoration:none;font-weight:800}
.new{margin:4px 0 0;text-align:center;font-size:.9rem;color:var(--mute)}
.new a{color:var(--hot2);font-weight:800;text-decoration:none}
.pitch .new{color:#9eb0c8}
.pitch{margin:22px 4px 0;text-align:center}
.pitch h2{margin:0;font-size:1.3rem;line-height:1.25;font-weight:900}
.pitch h2 span{background:linear-gradient(90deg,var(--hot1),var(--hot2),var(--blue));
              -webkit-background-clip:text;background-clip:text;color:transparent}
.pitch ul{list-style:none;padding:0;margin:16px 0 0;display:grid;gap:10px;text-align:left}
.pitch li{display:flex;gap:12px;align-items:flex-start;background:#0a1120;border:1px solid rgba(255,255,255,.08);
          border-radius:14px;padding:12px 14px;font-size:.95rem;line-height:1.4;color:#dfe7f2}
.pitch li i{font-style:normal;font-size:1.3rem;line-height:1}
.pitch li b{color:#fff}
.shop{margin:16px 0 0;color:#9eb0c8;font-size:.85rem}
.shop b{color:var(--gold)}
.cta2{margin-top:16px}
footer{margin:26px 0 0;color:#6f819a;font-size:.8rem;text-align:center}
footer a{color:var(--blue)}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="brand" href="${SITE}/"><img src="${SITE}/assets/icons/icon-192.png" alt="">Infinite Pulls</a>
    <a class="open" href="${esc(app)}">Open app →</a>
  </header>

  <article class="post">
    <div class="who">
      ${face}
      <div><b><a href="${SITE}/${esc(item.handle)}/">@${esc(item.handle)}</a></b>
        <small>In their collection${item.at ? ' · ' + esc(when(item.at)) : ''}</small></div>
    </div>
    ${item.image ? `<div class="pic"><img src="${esc(item.image)}" alt="${esc(title)}"></div>` : ''}
    <div class="body">
      <h1>${esc(title)}</h1>
      ${story ? `<p class="story"><b>The story</b>${story}</p>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      ${facts.length ? `
      <section class="spec">
        <p class="spec-h">This copy</p>
        <dl class="spec-g">${facts.map(([k, v, raw]) => `
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
      </section>` : ''}
      <div class="cta">
        <a class="go" href="${esc(app)}">See it in Infinite Pulls</a>
        <a class="go2" href="${SITE}/${esc(item.handle)}/">See all of @${esc(item.handle)}&rsquo;s cards</a>
        <p class="new">New here? <a href="${esc(join)}">Join free &amp; follow @${esc(item.handle)}</a></p>
      </div>
    </div>
  </article>

  <section class="pitch">
    <h2>Track your Pokémon cards <span>&amp; share your pulls.</span></h2>
    <ul>
      <li><i aria-hidden="true">\u{1F4F8}</i><span><b>Post your pulls</b> &mdash; packs, slabs, trades and shop finds, with the story behind them.</span></li>
      <li><i aria-hidden="true">\u{1F50D}</i><span><b>Scan any card</b> with your phone for its price, and add it to your collection in seconds.</span></li>
      <li><i aria-hidden="true">\u{1F91D}</i><span><b>Follow collectors like you</b> &mdash; comment, tag friends, and see what everyone's pulling.</span></li>
    </ul>
    <p class="shop">From <b>Infinite Pulls</b>, a real card shop in Canton, Ohio. Free, and it works right in your browser.</p>
    <div class="cta2"><a class="go" href="${SITE}/feed-next/">Open Infinite Pulls</a>
      <p class="new">New here? <a href="${esc(join)}">Join free</a></p></div>
  </section>

  <footer>
    <a href="${SITE}/">Infinite Pulls</a> — TCG &amp; Hobby Shop · 4229 4th St NW, Canton, OH
  </footer>
</div>
</body>
</html>
`;
}

/* "Added Sep 27" / "Added Sep 27, 2025" */
function when(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const opts = { month: 'short', day: 'numeric', timeZone: 'America/New_York' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return 'Added ' + d.toLocaleDateString('en-US', opts);
}

/* ---------- go ------------------------------------------------------------ */

async function main() {
  const cfg = await readConfig();

  /* WHO IS PUBLIC, and separately, who shows prices. show_price is a
     per-person setting the app already honors on this very page; a static
     copy that ignored it would publish a number somebody chose to hide. */
  const people = await rest(cfg,
    'profiles?select=id,username,is_public,show_price,avatar_url&is_public=eq.true&limit=5000');
  const byId = new Map();
  people.forEach((p) => {
    if (usable(p.username)) byId.set(p.id, {
      handle: p.username, showPrice: p.show_price !== false,
      face: p.avatar_url && /^https?:\/\//i.test(p.avatar_url) ? p.avatar_url : ''
    });
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

  let rows = null;
  /* edition + the card's story (note) too, when the database has them */
  try { rows = await rest(cfg, rowQuery(',cert_number,edition,note')); } catch (_) { rows = null; }
  if (!rows) try {
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
      face: who.face,
      edition: (r.edition || '').trim(),
      story: (r.note || '').trim(),
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
    <loc>${esc(`${SITE}/${i.handle}/collection/${i.slug}/`)}</loc>
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
