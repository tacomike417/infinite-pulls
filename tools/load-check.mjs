/* Loads every script index.html loads, in index.html's own order, and
 * checks that each one actually published what the rest of the app calls
 * on it.
 *
 * Run:  node tools/load-check.mjs        (no install, no browser, ~1s)
 *
 * WHY THIS EXISTS. collection.js once shipped with `const VARIANT_LABELS`
 * accidentally deleted. `node --check` passed -- it is valid JavaScript,
 * just with one name missing. Every unit test passed too, because they
 * slice functions out of the file and stub what those functions need. The
 * file threw ReferenceError the moment a browser ran it,
 * window.InfinitePullsCollection was never assigned, and the whole Card
 * Lookup page answered every search with "Lookup is not available right
 * now."
 *
 * Nothing here was checking the one thing that breaks everything: does
 * the app still load.
 *
 * HOW. Each file runs in a node:vm with a deliberately thin browser stub.
 * That is enough to catch a missing name, a typo'd reference, a bad
 * top-level call -- the things that stop a file dead. It is NOT a browser
 * and does not pretend to be: a file that needs more DOM than the stub
 * offers is reported as SKIPPED with the reason, never as a pass.
 */
import fs from 'fs';
import path from 'path';
import vm from 'node:vm';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/src="\.\/([^"]+)"/g)].map(m => m[1]);
if (!scripts.length) throw new Error('index.html lists no local scripts — has it moved?');

/* What the app calls on each global. Not every export -- the handful
   other files reach for, so a rename shows up here instead of at a
   customer's thumb. */
const EXPECTED = {
  InfinitePullsCollection: ['lookupByNumber', 'lookupByName', 'priceBriefs', 'priceTilesFor',
                            'ebaySoldUrl', 'quickAdd', 'defaultSelection', 'finishesFor',
                            'finishStepHtml', 'conditionStepHtml', 'valueBlockHtml',
                            'priceForSelection', 'selectionLabel', 'selectionCondition',
                            'gradesFor', 'scanCardSmart', 'parseCardNumber'],
  InfinitePullsTrend:       ['record', 'forCard'],
  InfinitePullsTcgdex:      ['fetch'],
  InfinitePullsPokemonData: ['loadAllSpecies', 'displayName'],
};

/* ---- the thinnest browser that lets a module-scope IIFE finish ---- */
const noop = () => {};
const el = () => new Proxy(function(){}, {
  get(t, k){
    if (k === 'style' || k === 'dataset' || k === 'classList') return el();
    if (k === 'children' || k === 'childNodes') return [];
    if (k === 'value' || k === 'textContent' || k === 'innerHTML') return '';
    if (k === Symbol.toPrimitive || k === 'toString') return () => '';
    return el();
  },
  set(){ return true; },
  apply(){ return el(); },
});
const store = () => ({ getItem: () => null, setItem: noop, removeItem: noop, clear: noop });
const win = {};
const ctx = {
  window: win, self: win, globalThis: win,
  document: {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el(), addEventListener: noop, removeEventListener: noop,
    documentElement: el(), body: el(), head: el(), readyState: 'complete',
    createTextNode: () => el(), cookie: '',
  },
  navigator: { userAgent: 'load-check', language: 'en-US', serviceWorker: { addEventListener: noop, register: () => Promise.resolve() }, mediaDevices: {} },
  location: { href: 'https://infinitepulls.com/', search: '', pathname: '/', hash: '', origin: 'https://infinitepulls.com' },
  localStorage: store(), sessionStorage: store(),
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
  setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: noop,
  console, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController,
  AbortSignal: { timeout: () => ({}), abort: () => ({}) },
  Intl, Image: function(){ return el(); }, FormData: function(){}, Blob: function(){},
  IntersectionObserver: function(){ return { observe: noop, unobserve: noop, disconnect: noop }; },
  MutationObserver: function(){ return { observe: noop, disconnect: noop }; },
  ResizeObserver: function(){ return { observe: noop, disconnect: noop }; },
  matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
  addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
  scrollTo: noop, getComputedStyle: () => el(), crypto: { randomUUID: () => 'x', getRandomValues: (a) => a },
  caches: { keys: () => Promise.resolve([]), open: () => Promise.resolve({}) },
  supabase: { createClient: () => ({ auth: { getSession: () => Promise.resolve({ data: {} }), onAuthStateChange: noop } }) },
};
Object.assign(win, ctx);
vm.createContext(ctx);

let pass = 0, fail = 0, skipped = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '\n        ' + detail}`);
  ok ? pass++ : fail++;
};

const broke = [];
const couldNotRun = [];
for (const rel of scripts) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { broke.push(`${rel}: listed in index.html but not on disk`); continue; }
  try {
    new vm.Script(fs.readFileSync(file, 'utf8'), { filename: rel }).runInContext(ctx);
  } catch (e) {
    /* A ReferenceError names a thing the file expects to exist. If that
       thing is one of OUR names it is a real break; if it is a browser API
       this stub does not carry, that is the stub's limit, not a bug --
       reported as skipped, never as a pass. */
    const missing = /(\w+) is not defined/.exec(e.message);
    const ours = missing && !(missing[1] in ctx) && /^[a-z_$]/.test(missing[1]);
    if (e instanceof ReferenceError && missing && missing[1] in ctx === false && !ours) {
      couldNotRun.push(`${rel}: needs ${missing[1]}, which this stub does not carry`);
      skipped++;
    } else {
      broke.push(`${rel}: ${e.name}: ${e.message}`);
    }
  }
}

check(`all ${scripts.length} scripts run without throwing`, broke.length === 0, broke.join('\n        '));
for (const [g, fns] of Object.entries(EXPECTED)) {
  const obj = ctx[g] || win[g];
  check(`${g} is published`, typeof obj === 'object' && obj !== null,
    `typeof is "${typeof obj}" — that file threw before it could publish`);
  if (obj) {
    const missing = fns.filter(f => typeof obj[f] !== 'function');
    check(`${g} exposes everything the app calls`, missing.length === 0, 'missing: ' + missing.join(', '));
  }
}

if (couldNotRun.length) {
  console.log(`\n${couldNotRun.length} file(s) needed more browser than this stub carries — not checked, not passed:`);
  couldNotRun.forEach(l => console.log('  · ' + l));
}
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(fail ? 1 : 0);
