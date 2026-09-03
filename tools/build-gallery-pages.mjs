/* Writes a real HTML page for every published gallery photo, plus the
 * sitemap.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Facebook's crawler does not run JavaScript. Neither, reliably, does
 * Google's first pass. The app routes on query strings and clean paths
 * handled in the browser, and GitHub Pages has no server to answer for
 * it — a direct visit to a clean path falls through to 404.html, which is
 * served with an actual HTTP 404 status. A human never notices, because
 * the app redirects them a moment later. A crawler sees 404 and leaves.
 *
 * That means, without this script, every photo Jeff shares would unfurl
 * on Facebook with the site's generic description and none of them would
 * ever appear in Google. The failure is silent and would look fine to
 * everybody testing it.
 *
 * So: this writes pulls/<slug>/index.html as a genuine file. A real 200,
 * on the shop's own domain, with the preview tags baked in and the
 * caption in the HTML rather than fetched later.
 *
 * WHAT IT NEEDS
 *
 * Nothing secret. It reads the Supabase URL and anon key out of config.js
 * — the same public key the browser uses — and only ever reads the
 * gallery_public view, which is published photos and nothing else. There
 * are no repository secrets to set up and none to leak.
 *
 * WHAT IT WRITES
 *
 *   pulls/<slug>/index.html    one per published photo
 *   pulls/<old-slug>/index.html  a redirect, for every address a photo
 *                                has ever had (see gallery_slug_aliases)
 *   sitemap.xml                including image entries, which is the half
 *                              that matters for a shop whose customers
 *                              search Google Images
 *   robots.txt                 if one is not already there
 *
 * Run:  node tools/build-gallery-pages.mjs
 */

import { readFile, writeFile, mkdir, rm, readdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT      = process.cwd();
const PULLS_DIR = path.join(ROOT, 'pulls');
const SITE      = process.env.SITE_ORIGIN || 'https://infinitepulls.com';

/* ---------- config, read from the file the browser already uses ------- */

async function readConfig() {
  const src = await readFile(path.join(ROOT, 'config.js'), 'utf8');
  const url = /SUPABASE_URL:\s*["']([^"']+)["']/.exec(src);
  const key = /SUPABASE_ANON_KEY:\s*["']([^"']+)["']/.exec(src);
  if (!url || !key) throw new Error('Could not read SUPABASE_URL / SUPABASE_ANON_KEY out of config.js');
  if (url[1].includes('YOUR-PROJECT-REF')) throw new Error('config.js has not been filled in yet');
  return { url: url[1].replace(/\/+$/, ''), key: key[1] };
}

async function rest(cfg, pathAndQuery) {
  const res = await fetch(`${cfg.url}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` }
  });
  if (!res.ok) throw new Error(`Supabase returned ${res.status} for ${pathAndQuery}`);
  return res.json();
}

/* ---------- escaping ---------------------------------------------------- */

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ---------- one photo's page --------------------------------------------- */

/* Self-contained and styled inline. No stylesheet, no script, nothing to
 * wait for — a person arriving from a Facebook link on shop wifi sees the
 * photo immediately, and a crawler sees the whole thing in one request.
 *
 * It is a real page rather than a redirect into the app on purpose. A page
 * that bounces you somewhere else is worth nothing in search, and there is
 * no reason to make somebody wait for an app to boot to look at one
 * picture. */
function photoPage(item) {
  const url      = `${SITE}/pulls/${item.slug}`;
  const title    = item.title || item.caption || 'Infinite Pulls';
  const desc     = item.meta_description || item.caption || 'A photo from Infinite Pulls TCG & Hobby Shop.';
  // The 1200x630 crop was made for exactly this and is the right shape for
  // a link card. The full photo is the fallback if it was never generated.
  const ogImage  = item.image_og_url || item.image_square_url || item.image_url;
  /* WHOSE PHOTO. Amended 3 Sep 2026 -- the shop used to get no line at all,
     so on the page a stranger actually lands on, "the shop took this" was
     said by silence. An anonymous customer photo gets its own line rather
     than falling through to the shop's, because reading as the shop's is the
     one thing it must not do.

     KEEP IN STEP with the same block in components/gallery.js. That one is
     what a person browsing the app sees; this one is what Facebook and
     Google see. Neither looks wrong on its own if they drift apart. */
  const credit   = item.source === 'customer'
    ? (item.submitted_name
        ? `<p class="credit">Pulled by <a href="${SITE}/${esc(item.submitted_name)}">${esc(item.submitted_name)}</a> at the shop.</p>`
        : `<p class="credit">Pulled by a customer at the shop.</p>`)
    : `<p class="credit">Posted by Infinite Pulls.</p>`;

  // Structured data, so a photo can turn up as a picture in search rather
  // than only as a blue link. For a card shop that is most of the value.
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    contentUrl: item.image_url,
    thumbnailUrl: item.image_square_url || item.image_url,
    caption: item.caption || undefined,
    description: desc,
    name: title,
    datePublished: item.published_at,
    representativeOfPage: true,
    isPartOf: { '@type': 'WebPage', '@id': url },
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
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(item.alt_text || title)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(ogImage)}">

<script type="application/ld+json">${jsonLd}</script>

<style>
:root{--bg:#03070d;--panel:#0a1120;--panel-2:#11213a;--text:#f7f8fb;
      --muted:#9eb0c8;--blue:#19bfff;--gold:#ffc928;--border:rgba(255,255,255,.09)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
     font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:16px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0 14px}
.brand{color:var(--gold);font-weight:900;letter-spacing:.12em;text-transform:uppercase;
       font-size:.78rem;text-decoration:none}
.home{color:var(--blue);text-decoration:none;font-weight:700;font-size:.9rem}
figure{margin:0;border:1px solid var(--border);border-radius:18px;overflow:hidden;background:var(--panel)}
img.photo{display:block;width:100%;height:auto;background:var(--panel-2)}
figcaption{padding:16px}
h1{margin:0;font-size:1.2rem;line-height:1.45;font-weight:600}
.credit{margin:10px 0 0;color:var(--muted)}
.credit a{color:var(--blue);font-weight:700}
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
    <a class="home" href="${SITE}/?page=gallery">The Gallery →</a>
  </header>

  <figure>
    <img class="photo" src="${esc(item.image_url)}" alt="${esc(item.alt_text || title)}"
         ${item.image_width ? `width="${esc(item.image_width)}"` : ''}
         ${item.image_height ? `height="${esc(item.image_height)}"` : ''}>
    <figcaption>
      <h1>${esc(item.caption || title)}</h1>
      ${credit}
      <p class="meta">Infinite Pulls TCG &amp; Hobby Shop</p>
      <div class="actions">
        <a class="btn btn-primary" href="${SITE}/?page=gallery">See what else is up</a>
        <a class="btn btn-ghost" href="${SITE}/?page=location">Find the shop</a>
      </div>
    </figcaption>
  </figure>

  <footer>
    More at <a href="${SITE}/">infinitepulls.com</a>
  </footer>
</div>
</body>
</html>
`;
}

/* A slug this photo used to live at. Not deleted, ever — a link Jeff
 * posted to Facebook in March has to keep working. Canonical points at
 * the current address so search engines consolidate rather than seeing
 * two pages with the same picture on them. */
function aliasPage(slug, target) {
  const url = `${SITE}/pulls/${target}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Moved — Infinite Pulls</title>
<link rel="canonical" href="${esc(url)}">
<meta name="robots" content="noindex,follow">
<meta http-equiv="refresh" content="0; url=${esc(url)}">
</head>
<body style="background:#03070d;color:#f7f8fb;font:16px system-ui;padding:24px">
<p>This photo lives at <a style="color:#19bfff" href="${esc(url)}">${esc(url)}</a>.</p>
</body>
</html>
`;
}

/* ---------- the sitemap --------------------------------------------------- */

/* With <image:image> entries. Ordinary sitemap advice treats images as an
 * afterthought; for a shop whose customers search "moonbreon alt art" and
 * then look at pictures, they are the point. */
function sitemap(items) {
  const today = new Date().toISOString().slice(0, 10);
  const staticPages = ['/', '/?page=gallery', '/?page=shop', '/?page=events',
                       '/?page=deals', '/?page=location', '/?page=hours',
                       '/?page=contact', '/?page=about'];

  const urls = staticPages.map((p) => `  <url>
    <loc>${esc(SITE + p)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
  </url>`).join('\n');

  const photos = items.map((i) => `  <url>
    <loc>${esc(SITE + '/pulls/' + i.slug)}</loc>
    <lastmod>${esc((i.published_at || '').slice(0, 10) || today)}</lastmod>
    <changefreq>monthly</changefreq>
    <image:image>
      <image:loc>${esc(i.image_url)}</image:loc>
      <image:title>${esc(i.title || i.caption || 'Infinite Pulls')}</image:title>
      <image:caption>${esc(i.alt_text || i.caption || '')}</image:caption>
    </image:image>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls}
${photos}
</urlset>
`;
}

/* ---------- go ------------------------------------------------------------ */

async function main() {
  const cfg = await readConfig();

  const items = await rest(cfg,
    'gallery_public?select=id,slug,title,caption,alt_text,meta_description,image_url,' +
    'image_square_url,image_og_url,image_width,image_height,source,submitted_name,published_at');

  const aliases = await rest(cfg, 'gallery_slug_aliases?select=slug,item_id');
  const bySlug = new Map(items.map((i) => [i.id, i.slug]));

  await mkdir(PULLS_DIR, { recursive: true });

  const wanted = new Set();

  for (const item of items) {
    const dir = path.join(PULLS_DIR, item.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), photoPage(item), 'utf8');
    wanted.add(item.slug);
  }

  let aliasCount = 0;
  for (const a of aliases) {
    const target = bySlug.get(a.item_id);
    // An alias whose photo has been taken down has nowhere to point. Leave
    // it out rather than sending somebody to a dead address.
    if (!target || a.slug === target) continue;
    const dir = path.join(PULLS_DIR, a.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), aliasPage(a.slug, target), 'utf8');
    wanted.add(a.slug);
    aliasCount++;
  }

  // A photo taken down in the panel stops being served here too. Safe to
  // delete: it is all in git, and the row itself is only ever soft-deleted.
  let removed = 0;
  for (const entry of await readdir(PULLS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && !wanted.has(entry.name)) {
      await rm(path.join(PULLS_DIR, entry.name), { recursive: true, force: true });
      removed++;
    }
  }

  await writeFile(path.join(ROOT, 'sitemap.xml'), sitemap(items), 'utf8');

  // Only written if it is not already there — never overwrite a robots.txt
  // somebody has deliberately edited.
  const robots = path.join(ROOT, 'robots.txt');
  if (!existsSync(robots)) {
    await writeFile(robots, `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`, 'utf8');
  }

  console.log(`${items.length} photo pages, ${aliasCount} kept-alive old links, ` +
              `${removed} removed, sitemap has ${items.length + 9} URLs.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
