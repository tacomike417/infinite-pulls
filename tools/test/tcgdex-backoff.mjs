/* BACKING OFF WHEN TCGdex SAYS TO — checked without calling them.
 *
 * The slice logic from supabase/functions/sync-prices/index.ts, lifted out
 * and run against fabricated responses. The two that matter:
 *
 *   a 429 or 503 stops the slice IMMEDIATELY, so the cards still queued
 *   behind it are never asked for;
 *
 *   an ordinary 404 does NOT, because one card TCGdex will not serve is
 *   one card missing from this week's history, not a reason to abandon
 *   the other 36,770.
 *
 *     node tools/test/tcgdex-backoff.mjs
 */
async function pooled(items, n, worker) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const mine = i++; out[mine] = await worker(items[mine]); }
  }));
  return out;
}
async function runSlice(cards, respond) {
  let errors = 0, throttled = false, fetched = 0;
  await pooled(cards, 8, async (c) => {
    if (throttled) return [];
    const res = respond(c);
    fetched++;
    if (res.status === 429 || res.status === 503) { throttled = true; return []; }
    if (!res.ok) { errors++; return []; }
    return ['row'];
  });
  return { throttled, errors, fetched };
}
const cards = Array.from({ length: 400 }, (_, i) => ({ id: i }));
let fail = 0;
const ok = (n, c) => { console.log((c?'  ok  ':'  FAIL')+'  '+n); if(!c) fail++; };

let r = await runSlice(cards, () => ({ ok: true, status: 200 }));
ok('happy path fetches all 400', r.fetched === 400 && !r.throttled && r.errors === 0);

r = await runSlice(cards, (c) => c.id < 10 ? { ok:true, status:200 } : { ok:false, status:429 });
ok('a 429 stops the slice',       r.throttled === true);
ok('and stops it FAST',           r.fetched < 30);
ok('429 is not counted an error', r.errors === 0);

r = await runSlice(cards, (c) => c.id === 5 ? { ok:false, status:503 } : { ok:true, status:200 });
ok('503 backs off too',           r.throttled === true && r.fetched < 30);

r = await runSlice(cards, (c) => c.id % 50 === 0 ? { ok:false, status:404 } : { ok:true, status:200 });
ok('a 404 does NOT stop the run', !r.throttled && r.fetched === 400 && r.errors === 8);
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail?1:0);
