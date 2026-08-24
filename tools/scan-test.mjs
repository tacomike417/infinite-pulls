// Checks the pure text-parsing half of the card scanner and the search
// box. These are the functions that decide WHICH card somebody gets shown
// after the OCR has done its part, so a mistake here is a mistake nobody
// would see as a bug — they'd just get the wrong card.
//
// Run: node tools/scan-test.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../components/collection.js', import.meta.url), 'utf8');

function grab(name){
  const i = src.indexOf(`function ${name}(`);
  if(i < 0) throw new Error(`collection.js no longer defines ${name}`);
  let depth = 0, k = src.indexOf('{', i);
  for(; k < src.length; k++){
    if(src[k] === '{') depth++;
    else if(src[k] === '}'){ depth--; if(!depth) break; }
  }
  return src.slice(i, k + 1);
}

const names = ['extractNumberCandidates','extractLooseNumbers','parseSearchTerm','matchesCardNumber','extractNameCandidates','coverSourceRect'];
const api = new Function(names.map(grab).join('\n') + `; return {${names.join(',')}};`)();

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if(g === w){ pass++; console.log('  ok   ' + label); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const group = (t) => console.log('\n' + t);

group('extractNumberCandidates — what the corner OCR actually hands back');
eq('a clean read', api.extractNumberCandidates('199/165'), [{number:'199',setTotal:'165'}]);
eq('surrounded by noise', api.extractNumberCandidates('  \n 006/108 \n 007 '), [{number:'006',setTotal:'108'}]);
eq('THE SECRET RARE: number above the set total is real, not a misread',
   api.extractNumberCandidates('199/165'), [{number:'199',setTotal:'165'}]);
eq('another secret rare', api.extractNumberCandidates('201/185'), [{number:'201',setTotal:'185'}]);
eq('a lost slash invents nothing', api.extractNumberCandidates('0661108'), []);
eq('a set of zero cards is refused', api.extractNumberCandidates('12/0'), []);
eq('two readings keep their order', api.extractNumberCandidates('4/102 and 76/102'),
   [{number:'4',setTotal:'102'},{number:'76',setTotal:'102'}]);
eq('the same reading twice collapses', api.extractNumberCandidates('66/108 66/108'), [{number:'66',setTotal:'108'}]);
eq('nothing in, nothing out', api.extractNumberCandidates(''), []);

group('extractLooseNumbers — the weaker guess, only used after the above fails');
eq('bare numbers', api.extractLooseNumbers('006 108'), [{number:'006',setTotal:null},{number:'108',setTotal:null}]);
eq('capped so a noisy read cannot fire off dozens of searches', api.extractLooseNumbers('1 2 3 4 5 6 7 8').length, 6);

group('parseSearchTerm — the typed search box, which must not have changed');
eq('a name', api.parseSearchTerm('Charizard'), {namePart:'Charizard',number:null,setTotal:null,numberOnly:false});
eq('a name and a number', api.parseSearchTerm('Charizard 199'), {namePart:'Charizard',number:'199',setTotal:null,numberOnly:false});
eq('a printed number', api.parseSearchTerm('234/265'), {namePart:'',number:'234',setTotal:'265',numberOnly:true});
eq('Porygon2 is a name, not a name and a number', api.parseSearchTerm('Porygon2'), {namePart:'Porygon2',number:null,setTotal:null,numberOnly:false});
eq('a Japanese printed number reads identically', api.parseSearchTerm('066/108'), {namePart:'',number:'066',setTotal:'108',numberOnly:true});

group('matchesCardNumber — leading zeros, which Japanese cards always print');
eq('066 is 66', api.matchesCardNumber('066','66'), true);
eq('66 is 066', api.matchesCardNumber('66','066'), true);
eq('6 is not 66', api.matchesCardNumber('6','66'), false);

group('extractNameCandidates — the fallback, no longer thrown by one stray digit');
eq('a digit on the line no longer discards the whole line', api.extractNameCandidates('Charizard 4'), ['Charizard']);
eq('the HP header is still skipped', api.extractNameCandidates('HP'), []);
eq('a card type header is still skipped', api.extractNameCandidates('BASIC'), []);

group('The viewfinder crop, which is where an overlay scanner silently goes wrong');
// A guide box drawn on screen has to map back to the camera's own pixels.
// If this is off, the outline looks perfect and the captured strip is the
// wrong part of the card — a bug with no visible symptom except bad reads.
const video = (w, h) => ({ videoWidth: w, videoHeight: h });

// Portrait phone: a 1920x1080 sensor shown in a 400x800 box means the
// video is scaled to cover and cropped left/right.
{
  const box = { width: 400, height: 800 };
  const full = api.coverSourceRect(video(1080, 1920), box, { x: 0, y: 0, width: 400, height: 800 });
  eq('a guide filling the box sees the full frame height', Math.round(full.sh), 1920);
  // Cover fits by height here, so the sides are cropped: the box shows 960
  // of the sensor's 1080 columns, 60 off each edge. Expecting 1080 would
  // mean expecting the video to be squashed rather than cropped.
  eq('and only the middle 960 columns, because cover crops the sides', Math.round(full.sw), 960);
  eq('60 pixels lost off the left edge', Math.round(full.sx), 60);
  eq('and the crop stays inside the sensor', Math.round(full.sx + full.sw) <= 1080, true);
}
{
  // A guide inset in the middle should map to an inset source rect.
  const box = { width: 400, height: 800 };
  const g = { x: 50, y: 100, width: 300, height: 400 };
  const r = api.coverSourceRect(video(400, 800), box, g);   // 1:1, no scaling
  eq('a 1:1 video maps the guide across unchanged',
     { sx: Math.round(r.sx), sy: Math.round(r.sy), sw: Math.round(r.sw), sh: Math.round(r.sh) },
     { sx: 50, sy: 100, sw: 300, sh: 400 });
}
{
  // Wider sensor than box: cover crops the sides, so a guide at x=0 must
  // map to a positive sx, not to zero.
  const box = { width: 400, height: 800 };
  const r = api.coverSourceRect(video(1600, 800), box, { x: 0, y: 0, width: 400, height: 800 });
  eq('a wider sensor is cropped at the sides, not squashed', Math.round(r.sw), 400);
  eq('and the left edge of the guide is NOT the left edge of the sensor', r.sx > 0, true);
}
eq('a video with no dimensions yet returns nothing rather than NaN',
   api.coverSourceRect(video(0, 0), { width: 400, height: 800 }, { x:0, y:0, width:10, height:10 }), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
