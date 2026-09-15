/* Collects every original photograph the shop has taken of a card, into one
 * folder, with a manifest, ready to be zipped and sent off for polishing.
 *
 * WHY THIS RUNS ON YOUR MACHINE
 *
 * The photographs live in the R2 bucket behind the image worker, and the
 * list of which ones exist lives in Supabase. Both are reachable from your
 * machine and neither is reachable from the sandbox this was written in, so
 * this is a script you run rather than a zip somebody hands you.
 *
 * WHAT IT NEEDS
 *
 * Nothing secret -- it reads the Supabase URL and anon key out of config.js,
 * the same public key the browser uses, and asks only for rows that key is
 * already allowed to read.
 *
 * WHAT IT WRITES
 *
 *   jeff-photos/shop/001_Charizard_Base-Set.jpg     the shelf photographs
 *   jeff-photos/collection/001_....jpg              his own cards
 *   jeff-photos/manifest.csv                        which file is which
 *
 * THE MANIFEST IS THE POINT, not a nicety. Every file is named for the card
 * so it can be looked at, but the polished versions have to go BACK to an
 * exact key in the bucket, and a readable name cannot survive a round trip
 * through anything that renames files. The number at the front of each name
 * is what ties a polished file to its row. Keep it.
 *
 * Run:  node tools/pull-jeff-photos.mjs
 *       node tools/pull-jeff-photos.mjs someotherusername
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'jeff-photos');
const WHO = process.argv[2] || 'Jefleppard';

async function readConfig() {
  const src = await readFile(path.join(ROOT, 'config.js'), 'utf8');
  const url = /SUPABASE_URL:\s*["']([^"']+)["']/.exec(src);
  const key = /SUPABASE_ANON_KEY:\s*["']([^"']+)["']/.exec(src);
  const pic = /CARD_PHOTO_BASE:\s*["']([^"']*)["']/.exec(src);
  if (!url || !key) throw new Error('Could not read SUPABASE_URL / SUPABASE_ANON_KEY out of config.js');
  return {
    url: url[1].replace(/\/+$/, ''),
    key: key[1],
    photos: (pic ? pic[1] : '').replace(/\/+$/, '')
  };
}

async function rest(cfg, q) {
  const res = await fetch(`${cfg.url}/rest/v1/${q}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` }
  });
  if (!res.ok) throw new Error(`Supabase returned ${res.status} for ${q}`);
  return res.json();
}

const address = (cfg, key) => {
  if (!key) return '';
  if (/^https?:\/\//i.test(key)) return key;      /* already a full address */
  if (!cfg.photos) return '';
  return cfg.photos + '/p/' + String(key).split('/').map(encodeURIComponent).join('/');
};

const tidy = (s) => String(s || '')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'card';

const pad = (n) => String(n).padStart(3, '0');

/* The extension the bytes actually are, not the one the key claims. A file
   named .jpg that is really a webp confuses everything downstream. */
function extOf(buf, fallback) {
  const b = Buffer.from(buf.slice(0, 16));
  if (b[0] === 0xFF && b[1] === 0xD8) return '.jpg';
  if (b[0] === 0x89 && b[1] === 0x50) return '.png';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return '.webp';
  return fallback || '.jpg';
}

/* ONE COUNTER FOR THE WHOLE RUN, not one per folder. The read-me tells
   somebody the number at the front of a filename is what identifies the
   photograph -- and with a counter per folder there were two 001s, so that
   was only true as long as nobody moved a file between folders, which is
   exactly what happens when a batch is sent off to be worked on. */
let SEQ = 0;

async function grab(cfg, list, folder, rows) {
  if (!list.length) { console.log(`  (nothing in ${folder})`); return; }
  await mkdir(path.join(OUT, folder), { recursive: true });
  let got = 0, missed = 0;
  for (const item of list) {
    const n = ++SEQ;
    const url = address(cfg, item.key);
    if (!url) { missed++; continue; }
    try {
      const res = await fetch(url);
      if (!res.ok) { console.log(`  ${pad(n)} MISSING (${res.status}) ${item.name}`); missed++; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = extOf(buf, path.extname(item.key) || '.jpg');
      const file = `${pad(n)}_${tidy(item.name)}${item.set ? '_' + tidy(item.set) : ''}${ext}`;
      await writeFile(path.join(OUT, folder, file), buf);
      rows.push([folder + '/' + file, item.key, item.name, item.set || '', item.card_id || '']);
      got++;
      /* No trailing newline: the line is overwritten each time, and printed
         once properly when the folder is done. */
      process.stdout.write(`\r  ${folder}: ${got} saved, ${missed} missing   `);
    } catch (e) {
      missed++;
      console.log(`\n  ${pad(n)} FAILED ${item.name}: ${e.message}`);
    }
    /* Gentle on the worker -- this is a bucket, not a CDN with a plan. */
    await new Promise(r => setTimeout(r, 60));
  }
  process.stdout.write(`\r  ${folder}: ${got} saved, ${missed} missing${' '.repeat(12)}\n`);
}

async function main() {
  const cfg = await readConfig();
  if (!cfg.photos) throw new Error('CARD_PHOTO_BASE is empty in config.js — nowhere to download from');

  if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const rows = [['file', 'object_key', 'card_name', 'set_name', 'card_id']];

  /* ---- the shelf ---- */
  console.log('Reading the shop shelf…');
  const shelf = await rest(cfg,
    'shop_available?select=clover_item_id,name,set_name,card_id,photo_url&limit=5000');
  const shopList = shelf
    .filter(r => r.photo_url)
    .map(r => ({ key: r.photo_url, name: r.name, set: r.set_name, card_id: r.card_id }));
  console.log(`  ${shopList.length} shelf rows have a photograph of their own.`);
  await grab(cfg, shopList, 'shop', rows);

  /* ---- his own cards ---- */
  console.log(`Reading ${WHO}'s collection…`);
  const who = await rest(cfg,
    `profiles?select=id,username&username=eq.${encodeURIComponent(WHO)}&limit=1`);
  if (!who.length) {
    console.log(`  No profile called "${WHO}". Pass the right username as an argument:`);
    console.log(`    node tools/pull-jeff-photos.mjs theusername`);
  } else {
    const id = who[0].id;
    /* kind='card' is the SCANNED shot -- the picture taken of the card
       itself. kind='mine' is somebody's own extra photographs of it, which
       are a different thing and not what is being replaced here. */
    const shots = await rest(cfg,
      `card_photos?select=object_key,sort,user_card_id,kind&user_id=eq.${id}` +
      `&kind=eq.card&order=added_at.asc&limit=5000`);
    const cards = await rest(cfg,
      `user_cards?select=id,card_id,card_name,set_name,photo_key&user_id=eq.${id}&limit=5000`);
    const byId = new Map(cards.map(c => [c.id, c]));

    const seen = new Set();
    const mineList = [];
    shots.forEach(s => {
      if (!s.object_key || seen.has(s.object_key)) return;
      seen.add(s.object_key);
      const c = byId.get(s.user_card_id) || {};
      mineList.push({ key: s.object_key, name: c.card_name || 'card', set: c.set_name, card_id: c.card_id });
    });
    /* A card whose photo predates the card_photos table has its key on the
       card row instead. Both are asked for, duplicates dropped. */
    cards.forEach(c => {
      if (!c.photo_key || seen.has(c.photo_key)) return;
      seen.add(c.photo_key);
      mineList.push({ key: c.photo_key, name: c.card_name || 'card', set: c.set_name, card_id: c.card_id });
    });
    console.log(`  ${mineList.length} photographs on ${WHO}'s cards.`);
    await grab(cfg, mineList, 'collection', rows);
  }

  await writeFile(path.join(OUT, 'manifest.csv'),
    rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'), 'utf8');

  await writeFile(path.join(OUT, 'READ-ME-FIRST.txt'),
`These are the shop's original card photographs.

WHEN THE POLISHED ONES COME BACK, keep the number at the front of each
filename. That number is the only thing tying a polished picture to the row
it belongs to -- manifest.csv maps it to the exact key in the bucket. The
readable part of the name is for your eyes and can change; the number
cannot.

shop/        photographs of cards on the shelf
collection/  photographs of cards in ${WHO}'s own collection
manifest.csv file, object_key, card_name, set_name, card_id
`, 'utf8');

  /* ---- zip it, if this machine can ---- */
  const zipPath = path.join(ROOT, 'jeff-photos.zip');
  await new Promise((resolve) => {
    execFile('zip', ['-r', '-q', zipPath, 'jeff-photos'], { cwd: ROOT }, (err) => {
      if (err) {
        console.log(`\nSaved to ${OUT}`);
        console.log('Could not zip it automatically — right-click the jeff-photos folder and compress it.');
      } else {
        console.log(`\nZipped: ${zipPath}`);
      }
      resolve();
    });
  });

  console.log(`${rows.length - 1} photographs in all.`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
