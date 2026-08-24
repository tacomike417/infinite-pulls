// Checks the arithmetic behind editing a card you already own.
//
// This is the highest-stakes maths in the app: it decides how many copies
// of a card somebody owns after they change a condition or split a stack.
// Get it wrong and cards silently appear or vanish from a collection, with
// nothing on screen to suggest anything happened. So every case below
// asserts that the TOTAL number of cards is conserved.
//
// Run: node tools/holdings-test.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../components/collection.js', import.meta.url), 'utf8');
function grab(name){
  let i = src.indexOf(`function ${name}(`);
  if(i < 0) throw new Error(`collection.js no longer defines ${name}`);
  if(src.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0, k = src.indexOf('{', i);
  for(; k < src.length; k++){
    if(src[k] === '{') depth++;
    else if(src[k] === '}'){ depth--; if(!depth) break; }
  }
  return src.slice(i, k + 1);
}
const { planHoldingMove } = new Function(grab('planHoldingMove') + '; return { planHoldingMove };')();

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if(g === w){ pass++; console.log('  ok   ' + label); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const group = t => console.log('\n' + t);

// Replays a plan against a little in-memory collection so the tests check
// what actually HAPPENS, not just what the plan says.
function applyPlan(rows, plan){
  if(plan.noop) return rows.slice();
  let out = rows.map(r => ({ ...r }));
  plan.inserts.forEach(ins => {
    const from = out.find(r => r.id === ins.fromId);
    out.push({ ...from, id: 'new', ...ins.values });
  });
  plan.updates.forEach(u => {
    const row = out.find(r => r.id === u.id);
    if(row) Object.assign(row, u.patch);
  });
  const gone = new Set(plan.deletes);
  return out.filter(r => !gone.has(r.id));
}
const totalOf = rows => rows.reduce((n, r) => n + r.quantity, 0);
const shapeOf = rows => rows
  .map(r => `${r.variant}/${r.condition}×${r.quantity}`)
  .sort().join(' + ');

group('The plain case Jeff asked for: fix the condition of a whole holding');
{
  const rows = [{ id:'a', variant:'holofoil', condition:'Lightly Played', quantity:1 }];
  const plan = planHoldingMove({
    sourceRowIds:['a'], sourceQty:1, targetRowIds:[], targetQty:0,
    variant:'holofoil', condition:'Near Mint', moveCount:1,
  });
  const after = applyPlan(rows, plan);
  eq('one card, condition corrected', shapeOf(after), 'holofoil/Near Mint×1');
  eq('still one card', totalOf(after), 1);
  eq('the row was reused, not deleted and remade', plan.inserts.length, 0);
}

group('THE MERGE: fixing a card into a holding you already have');
{
  const rows = [
    { id:'nm', variant:'holofoil', condition:'Near Mint',     quantity:3 },
    { id:'lp', variant:'holofoil', condition:'Lightly Played', quantity:1 },
  ];
  const plan = planHoldingMove({
    sourceRowIds:['lp'], sourceQty:1, targetRowIds:['nm'], targetQty:3,
    variant:'holofoil', condition:'Near Mint', moveCount:1,
  });
  const after = applyPlan(rows, plan);
  eq('two rows became one', after.length, 1);
  eq('and it holds all four', shapeOf(after), 'holofoil/Near Mint×4');
  eq('nothing was created or lost', totalOf(after), totalOf(rows));
}

group('THE SPLIT: one of four got dinged at a show');
{
  const rows = [{ id:'a', variant:'holofoil', condition:'Near Mint', quantity:4 }];
  const plan = planHoldingMove({
    sourceRowIds:['a'], sourceQty:4, targetRowIds:[], targetQty:0,
    variant:'holofoil', condition:'Lightly Played', moveCount:1,
  });
  const after = applyPlan(rows, plan);
  eq('three stay, one moves', shapeOf(after), 'holofoil/Lightly Played×1 + holofoil/Near Mint×3');
  eq('still four cards', totalOf(after), 4);
  eq('the mover is a copy, so rarity and dex number come with it', plan.inserts.length, 1);
}

group('Splitting onto a holding that already exists');
{
  const rows = [
    { id:'nm', variant:'holofoil', condition:'Near Mint',     quantity:4 },
    { id:'lp', variant:'holofoil', condition:'Lightly Played', quantity:2 },
  ];
  const plan = planHoldingMove({
    sourceRowIds:['nm'], sourceQty:4, targetRowIds:['lp'], targetQty:2,
    variant:'holofoil', condition:'Lightly Played', moveCount:2,
  });
  const after = applyPlan(rows, plan);
  eq('two moved across and merged', shapeOf(after), 'holofoil/Lightly Played×4 + holofoil/Near Mint×2');
  eq('six cards before, six after', totalOf(after), 6);
}

group('Variant changes, which Jeff did not ask about but will');
{
  const rows = [{ id:'a', variant:'holofoil', condition:'Near Mint', quantity:2 }];
  const plan = planHoldingMove({
    sourceRowIds:['a'], sourceQty:2, targetRowIds:[], targetQty:0,
    variant:'reverse-holofoil', condition:'Near Mint', moveCount:2,
  });
  const after = applyPlan(rows, plan);
  eq('holo became reverse holo', shapeOf(after), 'reverse-holofoil/Near Mint×2');
  eq('still two cards', totalOf(after), 2);
}

group('Historical duplicates get tidied up on the way past');
{
  // Two rows that are the same holding — the app groups them on screen but
  // the database can genuinely contain both.
  const rows = [
    { id:'a', variant:'holofoil', condition:'Near Mint', quantity:2 },
    { id:'b', variant:'holofoil', condition:'Near Mint', quantity:1 },
  ];
  const plan = planHoldingMove({
    sourceRowIds:['a','b'], sourceQty:3, targetRowIds:[], targetQty:0,
    variant:'holofoil', condition:'Damaged', moveCount:3,
  });
  const after = applyPlan(rows, plan);
  eq('collapsed to a single row', after.length, 1);
  eq('holding all three', shapeOf(after), 'holofoil/Damaged×3');
  eq('none lost in the tidying', totalOf(after), 3);
}
{
  const rows = [
    { id:'a', variant:'holofoil', condition:'Near Mint', quantity:2 },
    { id:'b', variant:'holofoil', condition:'Near Mint', quantity:1 },
  ];
  const plan = planHoldingMove({
    sourceRowIds:['a','b'], sourceQty:3, targetRowIds:[], targetQty:0,
    variant:'holofoil', condition:'Damaged', moveCount:1,
  });
  const after = applyPlan(rows, plan);
  eq('a partial move also collapses the duplicates', shapeOf(after), 'holofoil/Damaged×1 + holofoil/Near Mint×2');
  eq('and still totals three', totalOf(after), 3);
}

group('Nonsense input does something sensible instead of something destructive');
{
  const same = planHoldingMove({
    sourceRowIds:['a'], sourceQty:2, targetRowIds:[], targetQty:0,
    variant:'holofoil', condition:'Near Mint', moveCount:2, sameHolding:true,
  });
  eq('changing nothing does nothing', same, { noop:true, reason:'unchanged' });

  const rows = [{ id:'a', variant:'holofoil', condition:'Near Mint', quantity:3 }];
  const tooMany = planHoldingMove({
    sourceRowIds:['a'], sourceQty:3, targetRowIds:[], targetQty:0,
    variant:'holofoil', condition:'Damaged', moveCount:99,
  });
  eq('moving more than you own moves what you own', totalOf(applyPlan(rows, tooMany)), 3);
  eq('and moves all three', shapeOf(applyPlan(rows, tooMany)), 'holofoil/Damaged×3');

  const zero = planHoldingMove({
    sourceRowIds:['a'], sourceQty:3, targetRowIds:[], targetQty:0,
    variant:'holofoil', condition:'Damaged', moveCount:0,
  });
  eq('moving zero is treated as moving one, not as deleting', zero.move, 1);
  eq('and still totals three', totalOf(applyPlan(rows, zero)), 3);

  eq('a holding that does not exist is refused',
     planHoldingMove({ sourceRowIds:[], sourceQty:0, variant:'x', condition:'y', moveCount:1 }),
     { noop:true, reason:'nothing-to-move' });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
