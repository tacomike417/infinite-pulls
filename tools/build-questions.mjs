/* ===========================================================================
   INFINITE QUESTIONS — the page builder.

   364 questions and answers, one static page each, written straight to disk.
   There is no content management system here on purpose: these pages never
   change once written, nothing on them needs a database, and a folder of
   plain HTML is the fastest thing a phone or a crawler can be handed.

   Run it with:   node tools/build-questions.mjs
   It reads infinite-questions/entries.json and rewrites every page. Editing
   an answer means editing the JSON and running this again -- never editing
   the built HTML, which this will happily overwrite.

   WHAT IT WRITES
     infinite-questions/<slug>/index.html   one per entry
     infinite-questions/index.html          the hub, grouped by topic
     infinite-questions/sitemap.xml         all 365 urls
   =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT  = path.join(ROOT, 'infinite-questions');
const SITE = 'https://infinitepulls.com';
const BASE = '/infinite-questions';

const entries = JSON.parse(fs.readFileSync(path.join(OUT, 'entries.json'), 'utf8'));

/* ---- words ---------------------------------------------------------- */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const slugify = (s) => s.toLowerCase()
  /* Pokemon, not pok-mon: stripping an accented letter outright leaves a gap
     in the middle of the word somebody is actually searching for. */
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[’']/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

/* The copy arrives in capitals, which is a headline style and not a title.
   Small words stay small unless they open or close the line; anything that
   is an abbreviation in this hobby stays shouted. */
/* Articles, conjunctions and short prepositions only. Verbs stay
   capitalised -- "What Even Is Pokenomics?", never "is". */
const SMALL = new Set(['a','an','and','as','at','but','by','for','from','if','in','into',
                       'nor','of','on','or','per','the','to','via','vs','with']);
const SHOUT = new Set(['psa','bgs','cgc','sgc','tcg','tcgplayer','hp','gx','ex','vmax','vstar','id','ok','pc','usa','uk','og','pdf','url','ai','faq','eu']);

function titleCase(s) {
  const words = s.toLowerCase().split(/(\s+|—|–|\/)/);
  let seen = 0;
  return words.map((w) => {
    if (!/[a-z0-9]/i.test(w)) return w;
    seen++;
    const bare = w.replace(/[^a-z0-9]/g, '');
    if (SHOUT.has(bare)) return w.replace(bare, bare.toUpperCase());
    const first = seen === 1;
    const last  = w === words.filter((x) => /[a-z0-9]/i.test(x)).slice(-1)[0];
    if (!first && !last && SMALL.has(bare)) return w;
    return w.replace(/^[a-z]/, (c) => c.toUpperCase());
  }).join('');
}

/* A description has to fit in a search result, and a sentence cut mid-word
   looks broken. Trim on a space and add nothing that was not written. */
function clamp(s, n = 155) {
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:—-]$/, '') + '…';
}

/* ---- what each question is about ------------------------------------
   No topics were supplied, so they are worked out here from the words
   people actually used. Order matters: the first bucket that matches wins,
   so the specific ones are checked before the broad ones. A question that
   matches nothing lands in "Getting started", which is a real place and not
   a dumping ground -- those tend to be the beginner ones. */
const TOPICS = [
  ['fakes-and-scams',   'Fakes, scams & bad deals',
    /\b(fake|fakes|counterfeit|proxy|scam|scammed|scammer|stolen|resealed|weigh(ed|ing)? pack|too good to be true|chargeback)\b/i],
  ['grading',           'Grading & slabs',
    /\b(grade|graded|grading|psa|bgs|cgc|sgc|slab|slabbed|gem mint|population|pop report|cert|certification|resubmit|crack(ed)? out|subgrade)\b/i],
  ['what-its-worth',    'What is it worth?',
    /\b(worth|price|prices|priced|pricing|value|valued|market value|comps?|appraise|appraisal|how much|expensive|estimate)\b/i],
  ['condition',         'Condition & damage',
    /\b(condition|whitening|scratch|scratched|crease|creased|bend|bent|dent|ding|edges|corner|corners|surface|print line|played|damaged|water damage|near mint)\b/i],
  ['sets-and-numbers',  'Sets, numbers & symbols',
    /\b(set symbol|set number|card number|checklist|secret rare|rarity|promo|reprint|reprinted|holo|holos|reverse|first edition|1st edition|shadowless|error|misprint|regulation mark|full art|alt art)\b/i],
  ['sealed',            'Sealed product & packs',
    /\b(sealed|pack|packs|booster|blister|bundle|tin|etb|elite trainer|collection box)\b/i],
  ['languages',         'Japanese & other languages',
    /\b(japanese|japan|language|languages|kanji|korean|chinese|german|french|spanish)\b/i],
  ['storage',           'Storage, binders & sleeves',
    /\b(binder|binders|sleeve|sleeves|toploader|top loader|penny sleeve|storage|store them|humidity|sunlight|attic|basement|display)\b/i],
  ['kids-and-family',   'Kids & family collections',
    /\b(kid|kids|son|daughter|nephew|niece|grandson|granddaughter|my dad|my mom|my mum|parent|child|children|school|birthday)\b/i],
  ['collecting',        'Collecting & keeping track',
    /\b(collection|collecting|collector|goal|goals|master set|complete|completing|wish ?list|track|tracking|spreadsheet|organize|organise|theme)\b/i],
  ['buying-and-selling','Buying, selling & trading',
    /\b(sell|selling|sold|sale|buy|buying|bought|trade|trading|traded|ebay|listing|consign|shipping|ship|mailer|buyer|seller|store credit)\b/i],
];
const FALLBACK = ['getting-started', 'Getting started'];

function topicOf(e) {
  const hay = `${e.title} ${e.question}`;
  for (const [id, label, re] of TOPICS) if (re.test(hay)) return [id, label];
  return FALLBACK;
}

/* ---- what else somebody might read ----------------------------------
   Related, not random. Shared uncommon words between two questions is a
   crude measure and a good one: it puts binder questions next to binder
   questions without anybody tagging 364 entries by hand. Same topic is
   worth a point on its own, and the tie-break is the entry number so the
   build is repeatable -- two runs of this must produce identical files or
   every rebuild churns the whole folder in git.  */
const COMMON = new Set(('the a an and or but if is are was were be been being to of in on at for with from '
  + 'my your his her its our their this that these those i you he she it we they what when where how why do '
  + 'does did can could should would will just get got have has had im ive dont doesnt cant about like some '
  + 'any all one two out up so no not now then than there here them me thing things really pretty lot lots '
  + 'card cards pokemon pokémon jeff').split(/\s+/));

function bagOf(e) {
  const words = `${e.title} ${e.question}`.toLowerCase().match(/[a-z]{3,}/g) || [];
  return new Set(words.filter((w) => !COMMON.has(w)));
}

/* ---- assemble -------------------------------------------------------- */

const used = new Map();
for (const e of entries) {
  let s = slugify(e.title);
  /* Two entries could one day share a title. Rather than silently letting
     one overwrite the other's folder, the second gets a suffix. */
  if (used.has(s)) { const n = used.get(s) + 1; used.set(s, n); s = `${s}-${n}`; }
  else used.set(s, 1);
  e.slug = s;
  e.url = `${BASE}/${s}/`;
  e.heading = titleCase(e.title);
  const [tid, tlabel] = topicOf(e);
  e.topic = tid; e.topicLabel = tlabel;
  e.bag = bagOf(e);
}

const byUser = new Map();
for (const e of entries) {
  if (!byUser.has(e.username)) byUser.set(e.username, []);
  byUser.get(e.username).push(e);
}

for (const e of entries) {
  /* RELATED READING. */
  e.related = entries
    .filter((o) => o.n !== e.n)
    .map((o) => {
      let score = 0;
      for (const w of o.bag) if (e.bag.has(w)) score += 2;
      if (o.topic === e.topic) score += 1;
      return { o, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.o.n - b.o.n)
    .slice(0, 3)
    .map((r) => r.o);

  /* Somebody Jeff named in the answer. The reply does not say which of that
     reader's questions it means, so the closest one they asked EARLIER is
     offered, and the link is labelled as that reader's question rather than
     as the exact one Jeff had in mind -- which would be a claim this build
     cannot back up. */
  e.mentionLinks = (e.mentions || []).map((u) => {
    const theirs = (byUser.get(u) || []).filter((o) => o.n < e.n);
    if (!theirs.length) return null;
    let best = theirs[0], bestScore = -1;
    for (const o of theirs) {
      let score = 0;
      for (const w of o.bag) if (e.bag.has(w)) score++;
      if (score > bestScore) { best = o; bestScore = score; }
    }
    return { username: u, entry: best };
  }).filter(Boolean);
}

/* ---- the page -------------------------------------------------------- */

const avatarFile = (u) => `${BASE}/avatars/${u.toLowerCase().replace(/[^a-z0-9]/g, '')}.webp`;

function shell({ title, description, canonical, body, jsonld, cls = '', back }) {
  /* The hub must not offer a link back to itself. */
  back = back || { href: `${BASE}/`, label: 'All questions' };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="theme-color" content="#03070d">
<link rel="icon" href="/assets/icons/icon-192.png">
<link rel="stylesheet" href="${BASE}/style.css">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Infinite Pulls">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${SITE}${BASE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}${BASE}/og.png">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head>
<body${cls ? ` class="${cls}"` : ''}>
<a class="skip" href="#main">Skip to the question</a>
<header class="bar">
  <a class="bar-brand" href="/">Infinite&nbsp;Pulls</a>
  <a class="bar-back" href="${back.href}">${back.label}</a>
</header>
${body}
<footer class="foot">
  <p><a href="/">infinitepulls.com</a> — price your cards, track your collection, and see what the shop has in.</p>
  <p class="fineprint">Reader names and questions are made up for the column. The advice is Jeff's own and is not financial advice.</p>
</footer>
</body>
</html>
`;
}

function entryPage(e) {
  const q = e.question;
  const a = e.answer;
  const title = `${e.heading} — Infinite Questions | Infinite Pulls`;

  const mentions = e.mentionLinks.length ? `
  <aside class="also">
    <h2>Jeff mentions</h2>
    <ul>
      ${e.mentionLinks.map((m) => `<li><a href="${m.entry.url}"><img src="${avatarFile(m.username)}" alt="" width="36" height="36" loading="lazy"><span><b>@${esc(m.username)}</b>${esc(m.entry.heading)}</span></a></li>`).join('\n      ')}
    </ul>
  </aside>` : '';

  const related = e.related.length ? `
  <aside class="more">
    <h2>Maybe this will interest you</h2>
    <ul>
      ${e.related.map((o) => `<li><a href="${o.url}"><b>${esc(o.heading)}</b><span>${esc(clamp(o.question, 110))}</span></a></li>`).join('\n      ')}
    </ul>
  </aside>` : '';

  const body = `
<main id="main" class="wrap">
  <p class="kicker"><a href="${BASE}/#${e.topic}">${esc(e.topicLabel)}</a></p>
  <h1>${esc(e.heading)}</h1>

  <article class="thread">
    <div class="msg msg-q">
      <img class="face" src="${avatarFile(e.username)}" alt="" width="56" height="56">
      <div class="bubble">
        <p class="who">@${esc(e.username)} asks</p>
        <p class="say">${esc(q)}</p>
      </div>
    </div>
    <div class="msg msg-a">
      <img class="face" src="${avatarFile('jeff')}" alt="" width="56" height="56" loading="lazy">
      <div class="bubble">
        <p class="who">Jeff answers</p>
        <p class="say">${esc(a)}</p>
        <p class="sig">${esc(e.signature)}</p>
      </div>
    </div>
  </article>

  <p class="cta"><a href="/?page=lookup">Price a card in the app →</a></p>
${mentions}${related}
  <p class="back"><a href="${BASE}/">← All 364 questions</a></p>
</main>`;

  return shell({
    title,
    description: clamp(`${q} — Jeff answers.`),
    canonical: `${SITE}${e.url}`,
    body,
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'QAPage',
      mainEntity: {
        '@type': 'Question',
        name: e.heading,
        text: q,
        answerCount: 1,
        acceptedAnswer: {
          '@type': 'Answer',
          text: a,
          url: `${SITE}${e.url}`,
          author: { '@type': 'Person', name: 'Jeff', url: SITE }
        }
      },
      isPartOf: { '@type': 'WebSite', name: 'Infinite Pulls', url: SITE }
    }
  });
}

function indexPage() {
  const order = [...TOPICS.map((t) => [t[0], t[1]]), FALLBACK];
  const groups = order
    .map(([id, label]) => [id, label, entries.filter((e) => e.topic === id)])
    .filter((g) => g[2].length);

  const nav = groups.map(([id, label, list]) =>
    `<a href="#${id}">${esc(label)} <span>${list.length}</span></a>`).join('\n    ');

  const sections = groups.map(([id, label, list]) => `
  <section class="group" id="${id}">
    <h2>${esc(label)} <span>${list.length}</span></h2>
    <ul class="qlist">
      ${list.map((e) => `<li><a href="${e.url}"><img src="${avatarFile(e.username)}" alt="" width="36" height="36" loading="lazy"><span><b>${esc(e.heading)}</b>${esc(clamp(e.question, 120))}</span></a></li>`).join('\n      ')}
    </ul>
  </section>`).join('\n');

  const body = `
<main id="main" class="wrap">
  <h1>Infinite Questions</h1>
  <p class="lede">Real questions people bring to the counter, answered plainly. ${entries.length} of them, sorted by what they are about.</p>

  <nav class="topics" aria-label="Topics">
    ${nav}
  </nav>

  <div class="finder">
    <label for="q">Search these questions</label>
    <input id="q" type="search" placeholder="grading, binder, charizard…" autocomplete="off">
    <p class="finder-count" id="q-count" role="status"></p>
  </div>
${sections}
  <p class="back"><a href="/">← Back to Infinite Pulls</a></p>
</main>
<script>
/* The list is complete and readable with this script blocked; all this does
   is hide the rows that do not match, and put everything back when the box
   is emptied. Nothing is fetched and nothing is stored. */
(function(){
  var box = document.getElementById('q');
  var count = document.getElementById('q-count');
  if(!box) return;
  var rows = [].slice.call(document.querySelectorAll('.qlist li'));
  var groups = [].slice.call(document.querySelectorAll('.group'));
  rows.forEach(function(li){ li.dataset.t = li.textContent.toLowerCase(); });
  box.addEventListener('input', function(){
    var term = box.value.trim().toLowerCase();
    if(!term){
      rows.forEach(function(li){ li.hidden = false; });
      groups.forEach(function(g){ g.hidden = false; });
      count.textContent = '';
      return;
    }
    var hits = 0;
    rows.forEach(function(li){
      var on = li.dataset.t.indexOf(term) !== -1;
      li.hidden = !on;
      if(on) hits++;
    });
    groups.forEach(function(g){
      g.hidden = !g.querySelector('.qlist li:not([hidden])');
    });
    count.textContent = hits + (hits === 1 ? ' question' : ' questions');
  });
})();
</script>`;

  return shell({
    title: `Infinite Questions — ${entries.length} Pokémon card questions answered | Infinite Pulls`,
    description: `Plain answers to ${entries.length} questions about Pokémon cards: what they are worth, grading, condition, sets, sealed product, and keeping a collection straight.`,
    canonical: `${SITE}${BASE}/`,
    body,
    cls: 'is-index',
    back: { href: '/', label: 'Open the app' },
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Infinite Questions',
      url: `${SITE}${BASE}/`,
      isPartOf: { '@type': 'WebSite', name: 'Infinite Pulls', url: SITE }
    }
  });
}

/* ---- write ----------------------------------------------------------- */

let written = 0;
for (const e of entries) {
  const dir = path.join(OUT, e.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), entryPage(e));
  written++;
}
fs.writeFileSync(path.join(OUT, 'index.html'), indexPage());

const urls = [`${SITE}${BASE}/`, ...entries.map((e) => `${SITE}${e.url}`)];
fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')
  + `\n</urlset>\n`);

const counts = {};
for (const e of entries) counts[e.topicLabel] = (counts[e.topicLabel] || 0) + 1;
console.log(`${written} question pages + index + sitemap`);
console.log('topics:', counts);
console.log('cross-references linked:', entries.filter((e) => e.mentionLinks.length).length);
console.log('without related reading:', entries.filter((e) => !e.related.length).length);
