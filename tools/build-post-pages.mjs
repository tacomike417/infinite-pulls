/* Writes a real HTML page for every post in the feed.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The same reason tools/build-gallery-pages.mjs exists, and worth repeating
 * rather than cross-referencing, because the failure is silent:
 *
 * Facebook's crawler does not run JavaScript. Neither, reliably, does
 * Google's first pass. The feed is drawn entirely in the browser, and
 * GitHub Pages has no server to answer a clean path -- a direct visit to
 * /tacomike417/post/p-abc falls through to 404.html, which is served with a
 * genuine HTTP 404. A person never notices, because the app redirects them
 * a moment later. A crawler sees 404 and leaves.
 *
 * So without this, every post anybody shared would unfurl on Facebook as
 * the site's generic card -- no picture, no caption, no name -- and none of
 * them would ever appear in search. And it would look perfect to everybody
 * testing it, because everybody testing it has a browser.
 *
 * WHAT IT NEEDS
 *
 * Nothing secret. It reads the Supabase URL and anon key out of config.js,
 * the same public key the browser uses, and only ever reads rows those keys
 * are already allowed to read: posts belonging to public profiles. There
 * are no repository secrets to set up and none to leak.
 *
 * WHAT IT WRITES
 *
 *   <username>/post/p-<id>/index.html   one per photo post
 *   <username>/post/c-<id>/index.html   one per card post
 *   post-sitemap.xml                    so they can be found at all
 *   <username>/index.html               one per public profile (27 Sep 2026)
 *   profile-sitemap.xml                 the profiles, for the same reason
 *
 * PROFILES, 27 Sep 2026. infinitepulls.com/<name> used to answer a real
 * HTTP 404 (404.html bounced people into the feed a moment later), so
 * Google never saw a single collector -- and every post page's "Posted by"
 * link led it into that dead end. Now each public profile with something
 * on it gets a real page: photo, name, tagline, bio and their latest posts,
 * each linking to that post's own page. People tap through to the app.
 *
 * A PAGE, NOT A REDIRECT. Somebody arriving from Facebook wants to see the
 * thing, not watch an app boot on shop wifi to show them one picture. And a
 * page that bounces you elsewhere is worth nothing in search. So the whole
 * post is here -- picture, caption, who, when -- styled inline, no
 * stylesheet and no script to wait for. The way into the app is a button.
 *
 * Run:  node tools/build-post-pages.mjs
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SITE = process.env.SITE_ORIGIN || 'https://infinitepulls.com';
/* Must match SHOP_WHO in feed-next/feed.js. Two files naming one store
   differently is how a poster reads as the shop in the feed and as a
   stranger on the page it links to. */
const SHOP_NAME = 'Infinite Pulls';

/* HOW FAR BACK. Every page is a directory on disk and a line in a sitemap,
   and the value of a shared link is almost entirely in its first week. Two
   thousand is far more than this shop has and small enough that the repo
   does not become mostly index.html files. Past that the oldest fall off,
   which is the right thing to lose. */
const MAX_POSTS = 2000;

/* Names that are folders, pages or query-string routes in the app. A post
   under one of these would shadow something real, and the app's own
   RESERVED_USERNAMES already refuses to hand them out -- this is the same
   list, kept here so the builder cannot write a page the app would never
   route to. */
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

/* ---------- config, read from the file the browser already uses ------- */

async function readConfig() {
  const src = await readFile(path.join(ROOT, 'config.js'), 'utf8');
  const url = /SUPABASE_URL:\s*["']([^"']+)["']/.exec(src);
  const key = /SUPABASE_ANON_KEY:\s*["']([^"']+)["']/.exec(src);
  const pic = /CARD_PHOTO_BASE:\s*["']([^"']*)["']/.exec(src);
  /* The store's own account. Its posts are the SHOP's posts, so the page
     says the shop's name rather than the login's handle -- the same rule
     the feed follows. The folder still uses the handle, because a URL has
     to be one word and the handle is the one word it has. */
  const store = /STORE_USER_ID:\s*["']([^"']*)["']/.exec(src);
  if (!url || !key) throw new Error('Could not read SUPABASE_URL / SUPABASE_ANON_KEY out of config.js');
  if (url[1].includes('YOUR-PROJECT-REF')) throw new Error('config.js has not been filled in yet');
  return {
    url: url[1].replace(/\/+$/, ''),
    key: key[1],
    photos: (pic ? pic[1] : '').replace(/\/+$/, ''),
    store: store ? store[1] : ''
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

/* A key in the bucket is not an address; the address is built here, exactly
   as the app builds it, so the two cannot drift. */
const photoUrl = (cfg, key) => {
  if (!key) return '';
  if (/^https?:\/\//i.test(key)) return key;
  if (!cfg.photos) return '';
  return cfg.photos + '/p/' + String(key).split('/').map(encodeURIComponent).join('/');
};

const when = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

/* THE SAME FIVE GRADERS, THE SAME LINKS, AND THE SAME PRINTING NAMES the
   app uses. Copies of the tables in components/collection.js and
   feed-next/feed.js, kept in step by hand: this file runs in a GitHub
   action with no browser and nothing to import from. A card has to read the
   same here as it does in the app, because this IS the page people land on
   from Facebook. */
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

/* `base1-4` is card 4 of Base Set. Display only. */
const localNum = (cardId) => {
  const m = /-([^-]+)$/.exec(String(cardId || '').trim());
  return m ? m[1] : '';
};

const usd = (n) => (typeof n === 'number' && isFinite(n))
  ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '';

/* ---------- one post's page ---------------------------------------------- */

function postPage(post) {
  /* WITH THE ENDING SLASH (27 Sep 2026). GitHub Pages answers /x/post/y
     with a redirect to /x/post/y/, and a canonical that points at a
     redirect is one Google ignores. */
  const url   = `${SITE}/${post.handle}/post/${post.id}/`;
  const title = post.title;
  const desc  = post.desc;
  const app   = `${SITE}/feed-next/?post=${encodeURIComponent(post.id)}`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': post.kind === 'photo' ? 'ImageObject' : 'Product',
    name: title,
    description: desc,
    ...(post.image ? { image: post.image, contentUrl: post.image } : {}),
    datePublished: post.at,
    ...(post.kind === 'photo'
      ? { isPartOf: { '@type': 'WebPage', '@id': url } }
      : { brand: { '@type': 'Brand', name: 'Pokémon' } }),
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
${post.image ? `<meta property="og:image" content="${esc(post.image)}">
<meta property="og:image:alt" content="${esc(title)}">` : ''}

<meta name="twitter:card" content="${post.image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
${post.image ? `<meta name="twitter:image" content="${esc(post.image)}">` : ''}

<script type="application/ld+json">${jsonLd}</script>

<style>
:root{--bg:#03070d;--panel:#0a1120;--panel-2:#11213a;--text:#f7f8fb;
      --muted:#9eb0c8;--blue:#19bfff;--gold:#ffc928;--border:rgba(255,255,255,.09)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
     font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
/* SIZED FOR A PHONE, which is where a link off Facebook gets opened. It
   stops growing well before it could dwarf the picture on a laptop. */
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
.meta{margin:8px 0 0;color:var(--muted);font-size:.86rem}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
.btn{flex:1 1 auto;text-align:center;text-decoration:none;font-weight:800;
     padding:14px 18px;border-radius:14px;min-height:48px;
     display:inline-flex;align-items:center;justify-content:center}
.btn-primary{background:linear-gradient(135deg,#0ea5e9,var(--blue));color:#03101b}
.btn-ghost{border:1px solid var(--border);color:var(--text)}
footer{margin:26px 0 10px;color:var(--muted);font-size:.85rem;text-align:center}
footer a{color:var(--blue)}
/* WHAT THE CARD IS. This page used to be a picture, a name and a date, and
   somebody arriving from Facebook could not tell a beat-up common from a
   PSA 10 -- while the app knew both. Phone width first: two columns at
   360px, and minmax(0,1fr) so a long set name wraps inside its own column
   instead of pushing the other one off the screen. */
.spec{margin-top:16px;border-top:1px solid var(--border);padding-top:14px}
.spec-h{margin:0 0 10px;font-size:.68rem;font-weight:900;letter-spacing:.14em;
        text-transform:uppercase;color:var(--gold)}
.spec-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px}
.spec-g div{min-width:0}
.spec-g div.wide{grid-column:1/-1}
.spec-g dt{font-size:.62rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--blue)}
.spec-g dd{margin:3px 0 0;font-weight:800;font-size:.92rem;overflow-wrap:anywhere}
.spec-g dd small{display:block;margin-top:2px;font-size:.62rem;font-weight:800;
                 letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.spec-g dd a{color:var(--blue);text-decoration:none}
.grade{color:var(--gold)}
.up{color:#43d17f}
.down{color:#ff7a7a}
.note{margin:14px 0 0;font-size:.8rem;line-height:1.5;color:var(--muted)}
.note b{color:var(--text)}
.sold{display:flex;align-items:center;justify-content:center;margin-top:10px;
      min-height:44px;border:1px solid var(--border);border-radius:12px;
      color:var(--gold);text-decoration:none;font-weight:800;font-size:.72rem;
      letter-spacing:.09em;text-transform:uppercase}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <a class="brand" href="${SITE}/">Infinite Pulls</a>
    <a class="home" href="${SITE}/feed-next/">The feed →</a>
  </header>

  <figure>
    ${post.image
      ? `<img class="photo" src="${esc(post.image)}" alt="${esc(title)}" width="1200" height="1500">`
      : ''}
    <figcaption>
      <h1>${esc(post.heading)}</h1>
      <p class="credit">Posted by <a href="${SITE}/${esc(post.handle)}/">${esc(post.said || post.handle)}</a>.</p>
      ${post.at ? `<p class="meta">${esc(when(post.at))}</p>` : ''}
      ${post.spec && post.spec.length ? `
      <section class="spec">
        <p class="spec-h">This copy</p>
        <dl class="spec-g">${post.spec.map(([k, v, wide]) => `
          <div${wide ? ' class="wide"' : ''}><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}
        </dl>
        ${post.note ? `<p class="note">${post.note}</p>` : ''}
        ${post.sold ? `<a class="sold" href="${esc(post.sold)}" target="_blank" rel="noopener noreferrer">See sold listings</a>` : ''}
      </section>` : ''}
      <div class="actions">
        <a class="btn btn-primary" href="${esc(app)}">Open it in Infinite Pulls</a>
        <a class="btn btn-ghost" href="${SITE}/feed-next/">See the whole feed</a>
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

/* ---------- go ----------------------------------------------------------- */

async function main() {
  const cfg = await readConfig();

  /* WHO IS PUBLIC. Everything below is filtered to these people, which is
     the same rule the feed runs on -- a private profile has no shareable
     posts and must not get a page written for it. */
  let people;
  try {
    people = await rest(cfg,
      'profiles?select=id,username,is_public,avatar_url,bio,tagline,created_at&is_public=eq.true&limit=5000');
  } catch (_) {
    people = await rest(cfg,
      'profiles?select=id,username,is_public&is_public=eq.true&limit=5000');
  }
  const byId = new Map();
  people.forEach((p) => { if (usable(p.username)) byId.set(p.id, p.username); });
  if (!byId.size) { console.log('No public profiles with a usable username. Nothing to write.'); return; }

  const ids = [...byId.keys()];
  const inList = `(${ids.map((x) => `"${x}"`).join(',')})`;

  const photos = await rest(cfg,
    `user_photos?select=id,user_id,object_key,caption,added_at&user_id=in.${inList}` +
    `&order=added_at.desc&limit=${MAX_POSTS}`);

  /* EVERYTHING THE APP KNOWS ABOUT THE COPY, not just its name and picture.
     card_id, variant, condition, quantity and cert_number were all sitting
     in this table and none of them were asked for, which is the whole reason
     a shared card page said nothing about the card.

     cert_number may not exist yet on a database that has not had
     cert_number.sql run. Asking for a column that is not there fails the
     WHOLE query, so it is tried once and dropped on the one error that
     means that -- the same dance the feed and the importer already do. */
  const CARD_COLS = 'id,user_id,card_id,card_name,set_name,image_url,photo_key,' +
                    'added_at,hidden_feed,variant,condition,quantity';
  const cardQuery = (extra) =>
    `user_cards?select=${CARD_COLS}${extra}` +
    `&user_id=in.${inList}&hidden_feed=is.false&order=added_at.desc&limit=${MAX_POSTS}`;

  let cards;
  try {
    cards = await rest(cfg, cardQuery(',cert_number,edition'));
  } catch (_) { cards = null; }
  if (!cards) try {
    cards = await rest(cfg, cardQuery(',cert_number'));
  } catch (e) {
    if (!/\b400\b/.test(String(e && e.message))) throw e;
    console.log('No cert_number column on this database - run supabase/cert_number.sql. ' +
                'Certificate numbers will be left off the pages until then.');
    cards = await rest(cfg, cardQuery(''));
  }

  /* THE LATEST READING FOR EVERY CARD ON THE LIST, in one request per
     hundred ids rather than one per card.

     THE VARIANT IS THE PRINTING. sync-prices writes one tcgplayer row per
     printing ("normal", "holofoil", ...) and one cardmarket row called
     "trend". There is no variant called "market", which is what the app
     used to ask for and why every card claimed no price had ever been
     recorded.

     READ AS anon. If card_price_history has no policy for the anon role
     this comes back empty and every page simply carries no value -- which
     is why supabase/card_price_history_public.sql exists. Nothing here
     fails if it has not been run. */
  const cardIds = [...new Set(cards.map((r) => r.card_id).filter(Boolean))];
  const priceFor = new Map();   /* card_id -> { variant: {price, on} } */
  for (let i = 0; i < cardIds.length; i += 100) {
    const slice = cardIds.slice(i, i + 100);
    const list = `(${slice.map((x) => `"${x}"`).join(',')})`;
    let rows = [];
    try {
      rows = await rest(cfg,
        `card_price_history?select=card_id,variant,price,recorded_on,source,currency` +
        `&card_id=in.${list}&source=eq.tcgplayer&order=recorded_on.asc&limit=20000`);
    } catch (_) { rows = []; }
    /* ascending, so the last write per (card, printing) is the newest */
    rows.forEach((r) => {
      if (!priceFor.has(r.card_id)) priceFor.set(r.card_id, {});
      priceFor.get(r.card_id)[r.variant] = { price: Number(r.price), on: r.recorded_on };
    });
  }
  if (cardIds.length && !priceFor.size) {
    console.log('No price history came back for any card. If there should be some, ' +
                'card_price_history has no policy for the anon role - ' +
                'run supabase/card_price_history_public.sql.');
  }

  const posts = [];

  photos.forEach((r) => {
    const handle = byId.get(r.user_id);
    const image = photoUrl(cfg, r.object_key);
    const cap = (r.caption || '').trim();
    /* The name a READER sees. For the store's own account that is the shop,
       not the login behind it -- somebody arriving from Facebook should read
       the same name on the page that they read in the feed. */
    const said = (cfg.store && r.user_id === cfg.store) ? SHOP_NAME : handle;
    posts.push({
      kind: 'photo', id: 'p-' + r.id, handle, said, at: r.added_at, image,
      heading: cap || `A photo from ${said}`,
      title: cap || `${said} on Infinite Pulls`,
      desc: cap || `A photo posted by ${said} at Infinite Pulls TCG & Hobby Shop.`
    });
  });

  cards.forEach((r) => {
    const handle = byId.get(r.user_id);
    const image = photoUrl(cfg, r.photo_key) || r.image_url || '';
    const name = (r.card_name || 'A card').trim();
    const set = (r.set_name || '').trim();
    const full = set ? `${name} — ${set}` : name;
    const company = graderOf(r.condition);
    const cert    = String(r.cert_number || '').trim();
    const finish  = finishOf(r.variant);
    const num     = localNum(r.card_id);
    const cond    = String(r.condition || '').trim();
    const qty     = Number(r.quantity) || 1;
    const edition = String(r.edition || '').trim();

    /* The card's own printing if there is a reading for it, otherwise
       whichever printing has one -- a price under the wrong printing is
       still a better answer than none, and the printing is printed right
       above it either way. */
    const book = priceFor.get(r.card_id) || {};
    const key  = Object.prototype.hasOwnProperty.call(book, r.variant)
      ? r.variant : Object.keys(book)[0];
    const val  = key ? book[key] : null;

    const spec = [
      set ? ['Set', esc(set) + (num ? ` <small>#${esc(num)}</small>` : ''), true] : null,
      finish ? ['Finish', esc(finish), false] : null,
      edition ? ['Edition', `<span class="grade">${esc(edition)}</span>`, false] : null,
      [company ? 'Grade' : 'Condition',
        cond ? `<span class="${company ? 'grade' : ''}">${esc(cond)}</span>` : 'Raw', false],
      cert ? ['Cert #',
        company
          ? `<a href="${esc(GRADER_LINKS[company](cert))}" target="_blank" rel="noopener noreferrer">${esc(cert)}` +
            `<small>${esc(company)} report \u2197</small></a>`
          : esc(cert), true] : null,
      qty > 1 ? ['Quantity', '\u00d7' + qty, false] : null,
      val && isFinite(val.price)
        ? ['Market value', `${esc(usd(val.price))}<small>TCGplayer \u00b7 ${esc(when(val.on))}</small>`, false]
        : null
    ].filter(Boolean);

    /* THE SAME DISCLOSURE THE APP MAKES. Every figure on this site is a raw
       Near Mint market price. On a slab or a played copy it is not what the
       card is worth, and saying so on the page a stranger lands on matters
       more than saying it inside the app. */
    const offNM = !!company || (!!cond && !/^near mint$/i.test(cond));
    const sold = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(
      [name, num, set || 'pokemon', company ? cond : ''].filter(Boolean).join(' ')) +
      '&LH_Sold=1&LH_Complete=1&_sop=13';

    posts.push({
      kind: 'card', id: 'c-' + r.id, handle, at: r.added_at, image,
      heading: full,
      title: `${full}`,
      desc: `${name}${set ? ` from ${set}` : ''}${cond ? `, ${cond}` : ''}, in ${handle}'s collection at Infinite Pulls.`,
      spec,
      note: offNM
        ? `Prices here are <b>raw Near Mint</b>. A ${esc(cond)} copy sells for ` +
          `something different &mdash; sold listings are the real picture.`
        : '',
      sold: offNM ? sold : ''
    });
  });

  posts.sort((a, b) => (a.at < b.at ? 1 : -1));
  const keep = posts.slice(0, MAX_POSTS);

  /* EVERY PAGE THAT EXISTS NOW, so the ones that should not exist any more
     can go. A post taken off the feed or deleted leaves a page behind
     otherwise, and a live URL for something somebody removed is the worst
     kind of stale. */
  const wanted = new Set(keep.map((p) => `${p.handle}/post/${p.id}`));
  const handles = new Set(keep.map((p) => p.handle));

  for (const handle of handles) {
    const dir = path.join(ROOT, handle, 'post');
    if (!existsSync(dir)) continue;
    const { readdir } = await import('node:fs/promises');
    for (const entry of await readdir(dir)) {
      if (!wanted.has(`${handle}/post/${entry}`)) {
        await rm(path.join(dir, entry), { recursive: true, force: true });
        console.log('removed', `${handle}/post/${entry}`);
      }
    }
  }

  for (const post of keep) {
    const dir = path.join(ROOT, post.handle, 'post', post.id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), postPage(post), 'utf8');
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${keep.map((p) => `  <url>
    <loc>${esc(`${SITE}/${p.handle}/post/${p.id}/`)}</loc>
    ${p.at ? `<lastmod>${esc(String(p.at).slice(0, 10))}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
  </url>`).join('\n')}
</urlset>
`;
  await writeFile(path.join(ROOT, 'post-sitemap.xml'), xml, 'utf8');

  console.log(`Wrote ${keep.length} post pages (${photos.length} photos, ${cards.length} cards) and post-sitemap.xml.`);

  await writeProfiles(cfg, people, keep);
}

/* ---------- profiles ---------------------------------------------------- */

/* Marks a folder's index.html as one of OURS, so the clean-up below only
   ever removes a profile page this script wrote -- never a real section of
   the site that happens to be one word. */
const PROFILE_MARK = '<meta name="ip-page" content="profile">';

async function writeProfiles(cfg, people, keep) {
  const { readdir, readFile: rf } = await import('node:fs/promises');
  const postsBy = new Map();
  keep.forEach((p) => {
    if (!postsBy.has(p.handle)) postsBy.set(p.handle, []);
    postsBy.get(p.handle).push(p);
  });

  /* WHO GETS A PAGE: public, a usable name, and something on it -- at
     least one post, or a photo and a few words about themselves. An empty
     page with only a name is exactly the kind Google files as thin and
     counts against the whole site. */
  const pages = [];
  people.forEach((p) => {
    if (!usable(p.username)) return;
    const posts = postsBy.get(p.username) || [];
    const about = String(p.bio || '').trim() || String(p.tagline || '').trim();
    if (!posts.length && !(p.avatar_url && about)) return;
    pages.push({ person: p, posts });
  });

  const wanted = new Set(pages.map((x) => x.person.username));

  /* Clean up pages for people who went private, renamed or left. */
  for (const entry of await readdir(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || wanted.has(entry.name)) continue;
    const file = path.join(ROOT, entry.name, 'index.html');
    if (!existsSync(file)) continue;
    const html = await rf(file, 'utf8').catch(() => '');
    if (html.includes(PROFILE_MARK)) {
      await rm(file, { force: true });
      console.log('removed profile', entry.name);
    }
  }

  for (const x of pages) {
    const dir = path.join(ROOT, x.person.username);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), profilePage(cfg, x.person, x.posts), 'utf8');
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((x) => `  <url>
    <loc>${esc(`${SITE}/${x.person.username}/`)}</loc>
    ${x.posts[0] && x.posts[0].at ? `<lastmod>${esc(String(x.posts[0].at).slice(0, 10))}</lastmod>` : ''}
    <changefreq>daily</changefreq>
  </url>`).join('\n')}
</urlset>
`;
  await writeFile(path.join(ROOT, 'profile-sitemap.xml'), xml, 'utf8');
  console.log(`Wrote ${pages.length} profile pages and profile-sitemap.xml.`);
}

function profilePage(cfg, person, posts) {
  const handle = person.username;
  const isShop = !!cfg.store && person.id === cfg.store;
  const said = isShop ? SHOP_NAME : '@' + handle;
  const url = `${SITE}/${handle}/`;
  const app = `${SITE}/feed-next/?who=${encodeURIComponent(handle)}`;
  const tagline = String(person.tagline || '').trim();
  const bio = String(person.bio || '').trim();
  const avatar = person.avatar_url && /^https?:\/\//i.test(person.avatar_url) ? person.avatar_url : '';
  const count = posts.length;
  const cards = posts.filter((p) => p.kind === 'card').length;
  const photos = count - cards;

  const title = isShop
    ? `${SHOP_NAME} (@${handle}) — Pokémon cards & collection`
    : `@${handle}${tagline ? ' · ' + tagline : ''} — Pokémon collector on Infinite Pulls`;
  const desc = (bio || tagline
    ? (bio || tagline)
    : `${said} collects Pokémon cards on Infinite Pulls.`)
    + (count ? ` ${count} post${count === 1 ? '' : 's'}${cards ? `, ${cards} card${cards === 1 ? '' : 's'}` : ''}.` : '');
  const shareImg = avatar || (posts.find((p) => p.image) || {}).image || '';

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url,
    name: title,
    ...(posts[0] && posts[0].at ? { dateModified: posts[0].at } : {}),
    mainEntity: {
      '@type': isShop ? 'Organization' : 'Person',
      name: isShop ? SHOP_NAME : handle,
      alternateName: '@' + handle,
      identifier: handle,
      ...(avatar ? { image: avatar } : {}),
      ...(bio || tagline ? { description: bio || tagline } : {}),
      url
    }
  });

  const grid = posts.slice(0, 24).map((p) => `
      <a class="tile" href="${esc(`${SITE}/${handle}/post/${p.id}/`)}" title="${esc(p.title)}">
        ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" width="300" height="300">`
                  : `<span>${esc(p.heading)}</span>`}
      </a>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${PROFILE_MARK}
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="#03070d">
<link rel="icon" href="${SITE}/assets/icons/icon-192.png">

<meta property="og:type" content="profile">
<meta property="og:site_name" content="Infinite Pulls">
<meta property="og:title" content="${esc(said)} on Infinite Pulls">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="profile:username" content="${esc(handle)}">
${shareImg ? `<meta property="og:image" content="${esc(shareImg)}">` : ''}
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(said)} on Infinite Pulls">
<meta name="twitter:description" content="${esc(desc)}">
${shareImg ? `<meta name="twitter:image" content="${esc(shareImg)}">` : ''}

<script type="application/ld+json">${jsonLd}</script>

<style>
:root{--bg:#03070d;--panel:#0a1120;--panel-2:#11213a;--text:#f7f8fb;
      --muted:#9eb0c8;--blue:#19bfff;--gold:#ffc928;--border:rgba(255,255,255,.09)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
     font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:560px;margin:0 auto;padding:16px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0 14px}
.brand{color:var(--gold);font-weight:900;letter-spacing:.12em;text-transform:uppercase;
       font-size:.78rem;text-decoration:none}
.home{color:var(--blue);text-decoration:none;font-weight:700;font-size:.9rem}
.who{display:flex;align-items:center;gap:16px}
.face{width:88px;height:88px;border-radius:50%;object-fit:cover;flex:none;
      border:3px solid var(--gold);background:var(--panel-2)}
.face.blank{display:grid;place-items:center;font-weight:900;font-size:2rem;color:var(--gold)}
h1{margin:0;font-size:1.35rem;line-height:1.2;overflow-wrap:anywhere}
.tag{margin:4px 0 0;color:var(--gold);font-weight:800;font-size:.9rem}
.stats{margin:6px 0 0;color:var(--muted);font-size:.86rem}
.bio{margin:14px 0 0;white-space:pre-line;overflow-wrap:anywhere}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}
.btn{flex:1 1 auto;text-align:center;text-decoration:none;font-weight:800;
     padding:14px 18px;border-radius:14px;min-height:48px;
     display:inline-flex;align-items:center;justify-content:center}
.btn-primary{background:linear-gradient(135deg,#0ea5e9,var(--blue));color:#03101b}
.btn-ghost{border:1px solid var(--border);color:var(--text)}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
.tile{display:block;aspect-ratio:1/1;overflow:hidden;background:var(--panel);border-radius:6px;
      color:var(--muted);text-decoration:none;font-size:.72rem}
.tile img{width:100%;height:100%;object-fit:cover;display:block}
.tile span{display:flex;align-items:center;justify-content:center;height:100%;padding:6px;text-align:center}
h2{margin:22px 0 10px;font-size:.72rem;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--gold)}
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

  <section class="who">
    ${avatar ? `<img class="face" src="${esc(avatar)}" alt="${esc(said)}" width="88" height="88">`
             : `<span class="face blank" aria-hidden="true">${esc(handle.slice(0, 1).toUpperCase())}</span>`}
    <div>
      <h1>${esc(isShop ? SHOP_NAME : '@' + handle)}</h1>
      ${tagline ? `<p class="tag">${esc(tagline)}</p>` : ''}
      ${count ? `<p class="stats">${count} post${count === 1 ? '' : 's'}${cards && photos ? ` · ${cards} card${cards === 1 ? '' : 's'} · ${photos} photo${photos === 1 ? '' : 's'}` : ''}</p>` : ''}
    </div>
  </section>
  ${bio ? `<p class="bio">${esc(bio)}</p>` : ''}

  <div class="actions">
    <a class="btn btn-primary" href="${esc(app)}">Follow ${esc(said)} on Infinite Pulls</a>
  </div>

  ${grid ? `<h2>Latest posts</h2>
  <div class="grid">${grid}
  </div>` : ''}

  <footer>
    <a href="${SITE}/">Infinite Pulls</a> — Pokémon cards, collectors &amp; the TCG &amp; Hobby Shop
  </footer>
</div>
</body>
</html>
`;
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
