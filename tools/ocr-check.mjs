// Runs the REAL card-scanner pipeline out of components/collection.js
// against generated card photos, in a real browser, and reports what it
// read. This is the only check that proves the scanner actually reads a
// number off an image — tools/scan-test.mjs only covers what happens to
// the text afterwards.
//
// It pulls cropRegion / binarizeForOcr / readText / NUMBER_REGIONS
// straight out of collection.js rather than copying them, so it cannot
// drift away from the code it is testing: rename one of those and this
// fails loudly instead of quietly testing a stale copy.
//
// SETUP (one time, and deliberately not in package.json — none of this
// ships to anybody, it is only for working on the scanner):
//
//   npm install --no-save playwright tesseract.js @tesseract.js-data/eng
//   npx playwright install chromium
//   python3 tools/make-test-cards.py
//   node tools/ocr-check.mjs
//
// Tesseract's model files are served from a local folder rather than a
// CDN so this works on a machine with no internet.
import { chromium } from 'playwright';
import { readFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const ROOT   = new URL('..', import.meta.url).pathname;
const CARDS  = join(ROOT, 'tools', 'test-cards');
const SERVE  = join(ROOT, 'tools', '.ocr-serve');
const PORT   = 8321;

// What each generated photo has printed in its corner.
const EXPECTED = {
  // Loose snapshots — a card on a table, with background and rotation.
  // These go through NUMBER_REGIONS.
  'clean.jpg':  '066/108',
  'secret.jpg': '199/165',   // a secret rare — number ABOVE the set total
  'dark.jpg':   '025/091',   // white number on a dark strip
  'tilted.jpg': '004/162',   // photographed at an angle
  // What the in-page framing guide delivers: the card and nothing else.
  // These go through the tighter GUIDED_NUMBER_REGIONS.
  'guided-clean.jpg':  '066/108',
  'guided-secret.jpg': '199/165',
  'guided-dark.jpg':   '025/091',
  // Reported from real use: a card on a glass desk reads nothing while the
  // same card on a black mat reads fine. Glare across the number corner,
  // shadow above it — the case a single global threshold cannot serve.
  'guided-glare.jpg':  '066/108',
  // The reported failure, loose: card on a glass desk, reflections all
  // round it. Read with the LOOSE regions, i.e. the old un-guided path.
  // EXPECTED TO FAIL. Kept deliberately: it is the reported bug, and the
  // pair it makes with guided-glass-desk.jpg below is the evidence for the
  // framing guide. If this one ever starts passing, that is worth knowing
  // too — say so rather than quietly going green.
  'glass-desk.jpg':    null,
  // The SAME photo, cropped to the card the way the framing guide crops
  // it. Same glare, same reflections — the only change is that the desk is
  // out of the picture. This pair is the argument for the guide.
  'guided-glass-desk.jpg': '066/108',
};

if(!existsSync(CARDS)){
  console.error('No test cards yet. Run:  python3 tools/make-test-cards.py');
  process.exit(2);
}

// ---- pull the pipeline out of the app itself -------------------------
const src = readFileSync(join(ROOT, 'components', 'collection.js'), 'utf8');
function grabFn(name){
  let i = src.indexOf(`function ${name}(`);
  if(i < 0) throw new Error(`collection.js no longer defines ${name} — this check is out of date`);
  if(src.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0, k = src.indexOf('{', i);
  for(; k < src.length; k++){
    if(src[k] === '{') depth++;
    else if(src[k] === '}'){ depth--; if(!depth) break; }
  }
  return src.slice(i, k + 1);
}
function grabRegions(name){
  const i = src.indexOf(`const ${name} = [`);
  if(i < 0) throw new Error(`collection.js no longer defines ${name}`);
  return src.slice(i, src.indexOf('];', i) + 2).replace(/^const /, 'var ');
}
const pipeline = [
  grabFn('cropRegion'), grabFn('binarizeForOcr'), grabFn('readText'),
  grabRegions('NUMBER_REGIONS'), grabRegions('GUIDED_NUMBER_REGIONS'),
  grabFn('adaptiveBinarize'),
  grabFn('extractNumberCandidates'), grabFn('extractLooseNumbers'),
].join('\n\n');

// ---- stage the model files and the photos next to each other ---------
mkdirSync(SERVE, { recursive: true });
const need = [
  ['node_modules/tesseract.js/dist/tesseract.min.js', 'tesseract.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js',    'worker.min.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', 'eng.traineddata.gz'],
];
for(const [from, to] of need){
  const p = join(ROOT, from);
  if(!existsSync(p)){
    console.error(`Missing ${from}\nRun:  npm install --no-save playwright tesseract.js @tesseract.js-data/eng`);
    process.exit(2);
  }
  copyFileSync(p, join(SERVE, to));
}
for(const f of readdirSync(join(ROOT, 'node_modules', 'tesseract.js-core'))){
  if(f.endsWith('.js') || f.endsWith('.wasm')) copyFileSync(join(ROOT,'node_modules','tesseract.js-core',f), join(SERVE, f));
}
const files = readdirSync(CARDS).filter(f => f.endsWith('.jpg'));
files.forEach(f => copyFileSync(join(CARDS, f), join(SERVE, f)));

const TYPES = { '.js':'text/javascript', '.wasm':'application/wasm', '.gz':'application/gzip', '.jpg':'image/jpeg', '.html':'text/html' };
const server = createServer((req, res) => {
  const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if(name === 'index.html'){ res.writeHead(200, {'Content-Type':'text/html'}); return res.end('<!doctype html><meta charset="utf-8"><body></body>'); }
  try{
    const body = readFileSync(join(SERVE, name));
    res.writeHead(200, { 'Content-Type': TYPES[extname(name)] || 'application/octet-stream' });
    res.end(body);
  }catch{ res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

// ---- run it ----------------------------------------------------------
// CHROMIUM_PATH is an escape hatch for a machine where Playwright's own
// browser download isn't available — point it at any Chromium binary.
let browser;
try{
  browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  );
}catch(err){
  console.error('Could not start a browser.\nRun:  npx playwright install chromium');
  console.error('Or point CHROMIUM_PATH at a Chromium binary you already have.\n');
  console.error(String(err.message || err).split('\n')[0]);
  server.close();
  process.exit(2);
}
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.addScriptTag({ url: `http://127.0.0.1:${PORT}/tesseract.min.js` });

const results = await page.evaluate(async ({ pipeline, files, port }) => {
  eval(pipeline);
  const base = `http://127.0.0.1:${port}/`;
  const worker = await window.Tesseract.createWorker('eng', 1, {
    workerPath: base + 'worker.min.js', corePath: base, langPath: base, gzip: true,
  });
  const loadCanvas = (url, maxDim) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c);
    };
    img.onerror = () => rej(new Error('could not load ' + url));
    img.src = url;
  });

  const out = {};
  for(const name of files){
    const photo = await loadCanvas(base + name, 2400);
    const raw = []; let hit = null;
    // A file starting "guided-" stands in for a framing-guide capture and
    // is read with the tight regions, exactly as the app does.
    const regions = name.startsWith('guided-') ? GUIDED_NUMBER_REGIONS : NUMBER_REGIONS;
    // Both thresholding passes, in the same order the app tries them, so
    // the report can say which one actually rescued a card.
    const passes = [
      { label: 'global', prepare: (c) => binarizeForOcr(c) },
      { label: 'local',  prepare: (c) => adaptiveBinarize(c, 0.22) },
    ];
    outer:
    for(const region of regions){
      for(const pass of passes){
        const crop = pass.prepare(cropRegion(photo, region.fx, region.fy, region.fw, region.fh, 260));
        const text = await readText(worker, crop, '0123456789/', region.psm);
        if(!text.trim()) continue;
        raw.push({ region: `${region.label}/${pass.label}`, text: text.replace(/\s+/g, ' ').trim() });
        const cands = extractNumberCandidates(text);
        if(cands.length){ hit = { region: `${region.label} · ${pass.label} threshold`, candidate: cands[0] }; break outer; }
      }
    }
    out[name] = { hit, raw, loose: hit ? [] : raw.flatMap(r => extractLooseNumbers(r.text)) };
  }
  await worker.terminate();
  return out;
}, { pipeline, files, port: PORT });

let pass = 0, fail = 0;
console.log('');
for(const name of files){
  const r = results[name];
  const want = EXPECTED[name];
  const got = r.hit ? `${r.hit.candidate.number}/${r.hit.candidate.setTotal}` : null;
  if(want === null){
    // An expected failure, kept on purpose. Passing isn't an error — but
    // it IS news, so say so rather than quietly going green.
    pass++;
    console.log(got
      ? `  ok*  ${name.padEnd(22)} now reads ${got} — this used to fail, worth knowing why`
      : `  ok   ${name.padEnd(22)} failed as expected (the case the framing guide exists for)`);
  }
  else if(got === want){ pass++; console.log(`  ok   ${name.padEnd(22)} read ${got}  (from the ${r.hit.region})`); }
  else {
    fail++;
    console.log(`  FAIL ${name.padEnd(22)} wanted ${want}, got ${got || 'nothing'}`);
    r.raw.forEach(x => console.log(`         ${x.region}: "${x.text}"`));
    if(r.loose.length) console.log(`         loose numbers: ${r.loose.map(l => l.number).join(', ')}`);
  }
}
console.log(`\n${pass} read correctly, ${fail} failed`);

await browser.close();
server.close();
process.exit(fail ? 1 : 0);
