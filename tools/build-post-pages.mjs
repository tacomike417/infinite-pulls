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
  'admin','assets','components','supabase','api','www','null','undefined',
  'favicon','index','readme','cname','app','style','config','manifest',
  'service-worker','home','shop','collection','pokedex','dex','goals','events',
  'deals','lookup','location','hours','contact','about','account','menu',
  'gallery','pulls','infinite-questions','feed-next','tools','post'
]);

const usable = (name) =>
  /^[A-Za-z0-9_-]{3,24}$/.test(String(name || '')) && !RESERVED.has(String(name).toLowerCase());

/* ---------- config, read from the file the browser already uses ------- */

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

/* ---------- one post's page ---------------------------------------------- */

function postPage(post) {
  const url   = `${SITE}/${post.handle}/post/${post.id}`;
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
      <p class="credit">Posted by <a href="${SITE}/${esc(post.handle)}">${esc(post.handle)}</a>.</p>
      ${post.at ? `<p class="meta">${esc(when(post.at))}</p>` : ''}
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
  const people = await rest(cfg,
    'profiles?select=id,username,is_public&is_public=eq.true&limit=5000');
  const byId = new Map();
  people.forEach((p) => { if (usable(p.username)) byId.set(p.id, p.username); });
  if (!byId.size) { console.log('No public profiles with a usable username. Nothing to write.'); return; }

  const ids = [...byId.keys()];
  const inList = `(${ids.map((x) => `"${x}"`).join(',')})`;

  const photos = await rest(cfg,
    `user_photos?select=id,user_id,object_key,caption,added_at&user_id=in.${inList}` +
    `&order=added_at.desc&limit=${MAX_POSTS}`);

  const cards = await rest(cfg,
    `user_cards?select=id,user_id,card_name,set_name,image_url,photo_key,added_at,hidden_feed` +
    `&user_id=in.${inList}&hidden_feed=is.false&order=added_at.desc&limit=${MAX_POSTS}`);

  const posts = [];

  photos.forEach((r) => {
    const handle = byId.get(r.user_id);
    const image = photoUrl(cfg, r.object_key);
    const cap = (r.caption || '').trim();
    posts.push({
      kind: 'photo', id: 'p-' + r.id, handle, at: r.added_at, image,
      heading: cap || `A photo from ${handle}`,
      title: cap || `${handle} on Infinite Pulls`,
      desc: cap || `A photo posted by ${handle} at Infinite Pulls TCG & Hobby Shop.`
    });
  });

  cards.forEach((r) => {
    const handle = byId.get(r.user_id);
    const image = photoUrl(cfg, r.photo_key) || r.image_url || '';
    const name = (r.card_name || 'A card').trim();
    const set = (r.set_name || '').trim();
    const full = set ? `${name} — ${set}` : name;
    posts.push({
      kind: 'card', id: 'c-' + r.id, handle, at: r.added_at, image,
      heading: full,
      title: `${full}`,
      desc: `${name}${set ? ` from ${set}` : ''}, in ${handle}'s collection at Infinite Pulls.`
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
    <loc>${esc(`${SITE}/${p.handle}/post/${p.id}`)}</loc>
    ${p.at ? `<lastmod>${esc(String(p.at).slice(0, 10))}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
  </url>`).join('\n')}
</urlset>
`;
  await writeFile(path.join(ROOT, 'post-sitemap.xml'), xml, 'utf8');

  console.log(`Wrote ${keep.length} post pages (${photos.length} photos, ${cards.length} cards) and post-sitemap.xml.`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
