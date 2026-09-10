/* ===========================================================================
   INFINITE QUESTIONS — reading every built page back.

   365 files is well past the point where opening a few and hoping tells you
   anything. Run this after every build:

       node tools/check-questions.mjs

   It has already earned its place once: the avatar for @PopulationOne-ish was
   saved as populationone-ish.webp while the pages asked for
   populationoneish.webp, which is a broken image on twelve pages and nothing
   anywhere on screen to say so.
   =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'infinite-questions');
const entries = JSON.parse(fs.readFileSync(path.join(OUT, 'entries.json'), 'utf8'));
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

const slugs = fs.readdirSync(OUT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'avatars').map((d) => d.name);

console.log('\n=== every entry got a page ===');
ok(slugs.length === entries.length, `${slugs.length} folders for ${entries.length} entries`);
ok(new Set(slugs).size === slugs.length, 'no two entries share a folder');

console.log('\n=== the words on the page are the words that were written ===');
let textOk = 0, jsonldOk = 0, canonOk = 0, descOk = 0, titleOk = 0;
const linkTargets = new Set();
const avatarsUsed = new Set();
let maxDesc = 0, emptyRelated = 0;

const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"');

for (const s of slugs) {
  const html = fs.readFileSync(path.join(OUT, s, 'index.html'), 'utf8');
  const say = [...html.matchAll(/<p class="say">([\s\S]*?)<\/p>/g)].map((m) => unesc(m[1]));
  const e = entries.find((x) => say[0] === x.question && say[1] === x.answer);
  if (e) textOk++;

  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (ld) {
    try {
      const j = JSON.parse(ld[1]);
      if (j['@type'] === 'QAPage' && j.mainEntity.text && j.mainEntity.acceptedAnswer.text) jsonldOk++;
    } catch { /* counted as a miss */ }
  }
  if (html.includes(`<link rel="canonical" href="https://infinitepulls.com/infinite-questions/${s}/">`)) canonOk++;

  const d = html.match(/<meta name="description" content="([^"]*)"/);
  if (d && d[1].length >= 40) { descOk++; maxDesc = Math.max(maxDesc, d[1].length); }
  const t = html.match(/<title>([^<]*)<\/title>/);
  if (t && t[1].length <= 100) titleOk++;

  for (const m of html.matchAll(/href="(\/infinite-questions\/[^"]*)"/g)) linkTargets.add(m[1]);
  for (const m of html.matchAll(/src="(\/infinite-questions\/avatars\/[^"]*)"/g)) avatarsUsed.add(m[1]);
  if (!/Maybe this will interest you/.test(html)) emptyRelated++;
}

ok(textOk === slugs.length, `${textOk}/${slugs.length} pages carry their question and answer verbatim`);
ok(jsonldOk === slugs.length, `${jsonldOk}/${slugs.length} carry valid QAPage structured data`);
ok(canonOk === slugs.length, `${canonOk}/${slugs.length} point their canonical at themselves`);
ok(descOk === slugs.length, `${descOk}/${slugs.length} have a real meta description (longest ${maxDesc})`);
ok(titleOk === slugs.length, `${titleOk}/${slugs.length} have a title under 100 characters`);
ok(emptyRelated === 0, `every page offers further reading (${emptyRelated} without)`);

console.log('\n=== nothing points at a page that is not there ===');
const broken = [...linkTargets].filter((u) => {
  if (u === '/infinite-questions/' || u.startsWith('/infinite-questions/#')) return false;
  const clean = u.split('#')[0].replace(/^\/infinite-questions\//, '').replace(/\/$/, '');
  if (clean === 'style.css' || clean === 'og.png' || clean === 'sitemap.xml') return false;
  return !fs.existsSync(path.join(OUT, clean, 'index.html'));
});
ok(broken.length === 0, `${linkTargets.size} distinct internal links, ${broken.length} broken` + (broken.length ? ': ' + broken.slice(0, 3) : ''));

const missingAvatars = [...avatarsUsed].filter((u) =>
  !fs.existsSync(path.join(OUT, u.replace('/infinite-questions/', ''))));
ok(missingAvatars.length === 0, `${avatarsUsed.size} avatars referenced, ${missingAvatars.length} missing`);

console.log('\n=== the hub reaches every one of them ===');
const hub = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const listed = new Set([...hub.matchAll(/href="\/infinite-questions\/([^"#/]+)\//g)].map((m) => m[1]));
ok(listed.size === slugs.length, `${listed.size} of ${slugs.length} listed on the hub`);
const orphans = slugs.filter((s) => !listed.has(s));
ok(orphans.length === 0, `no orphans` + (orphans.length ? ': ' + orphans.slice(0, 3) : ''));

console.log('\n=== the sitemap agrees with the folder ===');
const sm = fs.readFileSync(path.join(OUT, 'sitemap.xml'), 'utf8');
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
ok(locs.length === slugs.length + 1, `${locs.length} urls for ${slugs.length} pages plus the hub`);
ok(locs.every((u) => u.startsWith('https://infinitepulls.com/')), 'all absolute, all on the real domain');

console.log('\n=== the cross-references land somewhere real ===');
const withMentions = entries.filter((e) => (e.mentions || []).length);
let linkedBack = 0;
for (const e of withMentions) {
  const slug = slugs.find((s) => {
    const h = fs.readFileSync(path.join(OUT, s, 'index.html'), 'utf8');
    return unesc((h.match(/<p class="say">([\s\S]*?)<\/p>/) || [])[1] || '') === e.question;
  });
  if (!slug) continue;
  const h = fs.readFileSync(path.join(OUT, slug, 'index.html'), 'utf8');
  if (/Jeff mentions/.test(h)) linkedBack++;
}
ok(linkedBack === withMentions.length,
   `${linkedBack}/${withMentions.length} answers that name another reader link to them`);

console.log('\n=== nothing enormous ===');
const sizes = slugs.map((s) => fs.statSync(path.join(OUT, s, 'index.html')).size);
const biggest = Math.max(...sizes);
ok(biggest < 20000, `biggest page ${(biggest / 1024).toFixed(1)} KB`);
const css = fs.statSync(path.join(OUT, 'style.css')).size;
ok(css < 12000, `one shared stylesheet, ${(css / 1024).toFixed(1)} KB, fetched once`);

console.log('');
console.log(fail ? `${fail} FAILED` : 'ALL 365 PAGES CHECK OUT');
process.exit(fail ? 1 : 0);
