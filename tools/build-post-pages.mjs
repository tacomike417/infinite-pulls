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

/* "Team Rocket's Mewtwo ex" is a Mewtwo -- the same rule as the app's
   smart tags (feed-next/feed.js pokemonOf), kept in step by hand. */
function pokemonOf(name) {
  let n = String(name || '').replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ').trim();
  n = n.replace(/^[A-Z][\w.'-]*(?:\s[A-Z][\w.'-]*)?['’]s\s+/, '');
  n = n.replace(/^(?:Radiant|Shining|Dark|Light|Mega|M|Shiny)\s+/i, '');
  for (let k = 0; k < 2; k++) {
    n = n.replace(/\s+(?:ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.?\s?X|Prime|LEGEND|δ|☆|Star)$/, '');
  }
  return n.trim();
}

/* @names and #tags in a caption, as plain styled text (no app to open them in here). */
const richText = (t) => esc(t || '')
  .replace(/(^|[^A-Za-z0-9_@.])@([A-Za-z0-9_.]{2,30}[A-Za-z0-9_])/g, (m, pre, h) => `${pre}<a class="at" href="${SITE}/${h}/">@${h}</a>`)
  .replace(/(^|[^A-Za-z0-9_&#;])#([A-Za-z][A-Za-z0-9_]{1,30})/g, (m, pre, h) => `${pre}<b class="hash">#${h}</b>`);

/* ---------- one post's page ---------------------------------------------- */

/* THE PAGE A STRANGER LANDS ON (redesigned 27 Sep 2026, Mike: "make it look
   super freaking cool ... so they're like, I want this app"). It is still a
   real page for everybody -- that is what Google wants -- and it is also the
   pitch: the post itself, big, then one bright button and three lines on
   what Infinite Pulls is. Phone first. */
function postPage(post) {
  const url   = `${SITE}/${post.handle}/post/${post.id}/`;
  const title = post.title;
  const desc  = post.desc;
  const app   = `${SITE}/feed-next/?post=${encodeURIComponent(post.id)}`;
  const join  = `${SITE}/feed-next/?post=${encodeURIComponent(post.id)}&join=1&follow=${encodeURIComponent(post.handle)}`;
  const who   = post.said || post.handle;
  const isCard = post.kind === 'card';

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

  const face = post.avatar
    ? `<img class="face" src="${esc(post.avatar)}" alt="" width="44" height="44">`
    : `<span class="face blank">${esc(String(who).slice(0, 1).toUpperCase())}</span>`;
  const tags = (post.tags || []).map((t, k) => `<span class="tag${k ? '' : ' lead'}">${esc(t)}</span>`).join('');
  const nums = [
    `<span class="n"><i aria-hidden="true">\u{1F525}</i>${post.heat || 0}<small>heat</small></span>`,
    `<span class="n"><i aria-hidden="true">\u{1F4AC}</i>${post.comments || 0}<small>comment${post.comments === 1 ? '' : 's'}</small></span>`
  ].join('');

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
.pic img{display:block;width:100%;height:auto;max-height:78vh;object-fit:${isCard ? 'contain' : 'cover'};margin:0 auto}
.pic.card img{padding:18px 0;max-height:70vh;width:auto;max-width:86%;filter:drop-shadow(0 10px 22px rgba(0,0,0,.55))}
.body{padding:14px 16px 18px}
.nums{display:flex;gap:18px;margin:0 0 10px}
.n{display:flex;align-items:baseline;gap:5px;font-weight:900;font-size:1rem}
.n i{font-style:normal}
.n small{font-weight:600;color:var(--mute);font-size:.8rem}
h1{margin:0;font-size:1.2rem;line-height:1.35;font-weight:800}
.cap{margin:6px 0 0;font-size:1rem;line-height:1.5;white-space:pre-line;overflow-wrap:anywhere}
.cap b.user{margin-right:6px}
.at,.hash{color:#0a8fd6;font-weight:800;text-decoration:none}
.story{margin:12px 0 0;padding:12px 14px;border-radius:14px;background:#fff7ef;border:1px solid #ffe0c7;
       font-style:italic;color:#5a3a1a}
.story b{font-style:normal;display:block;font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:var(--hot1);margin-bottom:4px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.tag{font-weight:800;font-size:.78rem;padding:6px 11px;border-radius:999px;background:#f1f4f8;color:#33445a}
.tag.lead{background:#e6f7ff;color:#0a79b8}
.spec{margin-top:16px;border-top:1px solid var(--line);padding-top:14px}
.spec-h{margin:0 0 10px;font-size:.66rem;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--hot1)}
.spec-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:0}
.spec-g div{min-width:0}
.spec-g div.wide{grid-column:1/-1}
.spec-g dt{font-size:.6rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}
.spec-g dd{margin:3px 0 0;font-weight:800;font-size:.95rem;overflow-wrap:anywhere}
.spec-g dd small{display:block;margin-top:2px;font-size:.62rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.spec-g dd a{color:#0a8fd6;text-decoration:none}
.grade{color:#c47d00}
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
      <div><b><a href="${SITE}/${esc(post.handle)}/">${esc(post.said ? post.said : '@' + post.handle)}</a></b>
        <small>${esc([isCard ? 'In their collection' : 'Posted', post.at ? when(post.at) : ''].filter(Boolean).join(' · '))}</small></div>
    </div>
    ${post.image ? `<div class="pic${isCard ? ' card' : ''}"><img src="${esc(post.image)}" alt="${esc(title)}"></div>` : ''}
    <div class="body">
      <div class="nums">${nums}</div>
      ${isCard ? `<h1>${esc(post.heading)}</h1>` : ''}
      ${post.caption ? `<p class="cap">${isCard ? '' : `<b class="user">${esc(post.said || '@' + post.handle)}</b>`}${richText(post.caption)}</p>`
        : (!isCard ? `<h1>${esc(post.heading)}</h1>` : '')}
      ${post.story ? `<p class="story"><b>The story</b>${richText(post.story)}</p>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      ${post.spec && post.spec.length ? `
      <section class="spec">
        <p class="spec-h">This copy</p>
        <dl class="spec-g">${post.spec.map(([k, v, wide]) => `
          <div${wide ? ' class="wide"' : ''}><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}
        </dl>
        ${post.note ? `<p class="note">${post.note}</p>` : ''}
        ${post.sold ? `<a class="sold" href="${esc(post.sold)}" target="_blank" rel="noopener noreferrer">See sold listings</a>` : ''}
      </section>` : ''}
      <div class="cta">
        <a class="go" href="${esc(join)}">Join free &amp; follow ${esc(post.said || '@' + post.handle)}</a>
        <a class="go2" href="${esc(app)}">Open it in Infinite Pulls</a>
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
    <div class="cta2"><a class="go" href="${esc(join)}">Join free</a></div>
  </section>

  <footer>
    <a href="${SITE}/">Infinite Pulls</a> — TCG &amp; Hobby Shop · 4229 4th St NW, Canton, OH
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
  const faceOf = new Map(people.map((p) => [p.id, p.avatar_url && /^https?:\/\//i.test(p.avatar_url) ? p.avatar_url : '']));
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
    cards = await rest(cfg, cardQuery(',cert_number,edition,note,card_lang'));
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
      kind: 'photo', id: 'p-' + r.id, handle, said: said === handle ? '' : said, at: r.added_at, image,
      avatar: faceOf.get(r.user_id) || '', caption: cap,
      tags: [...new Set((cap.match(/#[A-Za-z][A-Za-z0-9_]{1,30}/g) || []))],
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

    const tagList = [pokemonOf(name), set, company ? cond : '', edition].filter(Boolean);
    posts.push({
      kind: 'card', id: 'c-' + r.id, handle, at: r.added_at, image,
      avatar: faceOf.get(r.user_id) || '', story: String(r.note || '').trim(),
      cardId: r.card_id, lang: r.card_lang || 'en',
      tags: [...new Set(tagList)],
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

  /* HEAT AND COMMENTS, a hundred posts a request. A failure leaves zeros. */
  for (let i = 0; i < keep.length; i += 100) {
    const slice = keep.slice(i, i + 100);
    const list = `(${slice.map((p) => `"${p.id}"`).join(',')})`;
    for (const [view, field] of [['post_heat_counts', 'heat'], ['post_comment_counts', 'comments']]) {
      try {
        const rows = await rest(cfg, `${view}?select=post_key,n&post_key=in.${list}`);
        const byKey = new Map(rows.map((r) => [r.post_key, Number(r.n) || 0]));
        slice.forEach((p) => { p[field] = byKey.get(p.id) || 0; });
      } catch (_) { /* zeros */ }
    }
  }

  /* NO PICTURE? The official card image, asked of TCGdex once per card.
     A blank page is the one thing this page cannot be. */
  const artCache = new Map();
  let artAsked = 0;
  for (const p of keep) {
    if (p.image || p.kind !== 'card' || !p.cardId || artAsked >= 150) continue;
    if (!artCache.has(p.cardId)) {
      artAsked++;
      let img = '';
      for (const lang of [p.lang || 'en', p.lang === 'ja' ? 'en' : 'ja']) {
        try {
          const res = await fetch(`https://api.tcgdex.net/v2/${lang}/cards/${encodeURIComponent(p.cardId)}`);
          if (res.ok) { const c = await res.json(); if (c && c.image) { img = c.image + '/high.webp'; break; } }
        } catch (_) {}
      }
      artCache.set(p.cardId, img);
    }
    p.image = artCache.get(p.cardId) || '';
  }

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
<script>
/* PEOPLE GO STRAIGHT INTO THE APP (Mike, 27 Sep 2026). This page is for
   Google and for link previews only -- a person tapping a profile link or
   scanning a QR code lands on the live profile in the app, exactly as
   before this page existed. Crawlers and preview bots stay and read it. */
(function(){
  var bot = /bot|crawl|spider|slurp|google|bing|yandex|baidu|duckduck|facebookexternalhit|facebot|twitter|linkedin|whatsapp|telegram|discord|slack|pinterest|embedly|preview|lighthouse|headless/i;
  if (!bot.test(navigator.userAgent || '')) {
    location.replace('/feed-next/?who=' + encodeURIComponent(${JSON.stringify(handle)}) + location.hash);
  }
})();
</script>
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
