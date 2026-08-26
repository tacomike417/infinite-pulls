/* The collection import parser, driven against real-world files.
 *
 * No browser and no network — the parser is deliberately pure, so it can
 * be tested straight in node. Every fixture below is either a format we
 * verified from a primary source, or a shape of homemade spreadsheet the
 * research turned up as common. The point of the awkward ones is that
 * they are not hypothetical: secret rares numbered past the end of their
 * set, dollar signs in price columns, Excel's byte-order mark, tabs from
 * Cardmarket, and a set checklist that would hand somebody a complete
 * collection if we read it as an inventory.
 */
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const src = await readFile(new URL('../components/collection-import-parse.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const P = sandbox.window.InfinitePullsImportParse;

let fails = 0, total = 0;
const check = (label, cond, extra = '') => {
  total++; if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  [' + extra + ']' : ''}`);
};
const eq = (label, got, want) => check(label, got === want, got === want ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// ============================================================
console.log('--- the one format we actually verified ---');
// TCGplayer's mobile export. Confirmed from the screenshot in Collectr's
// own Import/Export help page, which is also the only format Collectr
// accepts as an import. These eleven headers, in this order.
{
  const csv = [
    'Quantity,Name,Simple Name,Set,Card Number,Set Code,Printing,Condition,Language,Rarity,Product ID',
    '1,Charizard,Charizard,Base Set,4/102,BS,Holofoil,Near Mint,English,Rare Holo,15663',
    '3,Pikachu,Pikachu,Jungle,60/64,JU,Normal,Lightly Played,English,Common,4146',
    '1,Umbreon ex,Umbreon ex,Prismatic Evolutions,161/131,PRE,Holofoil,Near Mint,English,Special Illustration Rare,6275'
  ].join('\n');
  const r = P.parse(csv);

  eq('every column is recognised', Object.keys(r.mapping).length, 10);
  check('Name wins over Simple Name', r.mapping.name === 1, 'col ' + r.mapping.name);
  eq('three rows, all usable', r.counts.usable, 3);
  eq('...and five cards between them', r.counts.cards, 5);

  eq('the number keeps only its left half', r.rows[0].number, '4');
  eq('...and remembers the right half without trusting it', r.rows[0].printedTotal, '102');
  eq('printing lands on the app\'s own key', r.rows[0].variant, 'holofoil');
  eq('condition lands on the app\'s own word', r.rows[1].condition, 'Lightly Played');
  eq('language becomes a code', r.rows[0].language, 'en');
  eq('the set name comes through', r.rows[2].setName, 'Prismatic Evolutions');
  eq('so does the TCGplayer product id', r.rows[0].productId, '15663');
}

console.log('--- a secret rare must survive ---');
// 161/131 against a 131-card set is not a mistake, it is the most
// valuable card in the file. Validating the numerator against the
// denominator would throw away exactly the cards that matter.
{
  eq('numerator past the end of the set is kept', P.splitNumber('199/197').number, '199');
  eq('...and the bogus total is not used for anything', P.splitNumber('199/197').printedTotal, '197');
  eq('a zero-padded total does not confuse it', P.splitNumber('172/086').number, '172');
  eq('leading zeros come off a plain number', P.splitNumber('006').number, '6');
  eq('but never off a lettered one', P.splitNumber('SV045').number, 'SV045');
  eq('trainer gallery numbers survive', P.splitNumber('TG12/TG30').number, 'TG12');
  eq('a hash is not part of the number', P.splitNumber('#4').number, '4');
  eq('"No. 4" is not either', P.splitNumber('No. 4').number, '4');
  eq('lowercase is normalised up', P.splitNumber('gg01').number, 'GG01');
  eq('an empty cell is empty, not zero', P.splitNumber('').number, '');
}

console.log('--- columns are read by name, never by position ---');
// TCGplayer's columns are tickboxes in the app, so no two people's
// exports have the same set in the same order. A positional parser reads
// one person's file correctly and silently corrupts everyone else's.
{
  const a = P.parse('Count,Name,Edition,Card Number,Set Code\n2,Mew,Celebrations,25/25,CEL');
  eq('"Count" is a quantity', a.rows[0].quantity, 2);
  eq('"Edition" is a set name', a.rows[0].setName, 'Celebrations');

  const b = P.parse('Card Number,Set,Qty,Card Name\n25/25,Celebrations,2,Mew');
  eq('...and the same file shuffled reads identically', b.rows[0].name, 'Mew');
  eq('...including the quantity', b.rows[0].quantity, 2);
  eq('...and the number', b.rows[0].number, '25');

  const c = P.parse('Name,Set,Set Code\nMew,Celebrations,CEL');
  check('"Set" and "Set Code" do not collide', c.mapping.setName === 1 && c.mapping.setCode === 2,
    JSON.stringify({ setName: c.mapping.setName, setCode: c.mapping.setCode }));
}

console.log('--- the community TCGplayer exporter ---');
// The only way to get data out of TCGplayer's website is to save the page
// and run it through a community tool. Its eight headers are fixed and
// its prices carry dollar signs.
{
  const csv = [
    'Name,Set,Have,Want,Trade,Low,Mid,High',
    'Charizard,Base Set,2,0,1,$210.00,$385.50,$1,200.00'
  ].join('\n');
  const r = P.parse(csv);
  eq('"Have" is the quantity', r.rows[0].quantity, 2);
  eq('the dollar sign comes off the price', r.rows[0].price, 210);
  check('Want and Trade are left alone rather than guessed at',
    r.unmapped.some((c) => c.header === 'Want') && r.unmapped.some((c) => c.header === 'Trade'),
    r.unmapped.map((c) => c.header).join(','));
  check('only one price column is taken', Object.values(r.mapping).filter((i) => i === 6 || i === 7).length === 0);
}

console.log('--- money, in the shapes it actually arrives in ---');
{
  eq('plain dollars', P.stripMoney('$12.34'), 12.34);
  eq('thousands separator', P.stripMoney('$1,234.56'), 1234.56);
  eq('euros the European way round', P.stripMoney('1.234,56 €'), 1234.56);
  eq('a bare European decimal', P.stripMoney('12,34'), 12.34);
  eq('an empty cell is nothing, not zero', P.stripMoney(''), null);
  eq('a dash is nothing too', P.stripMoney('-'), null);
}

console.log('--- a checklist is not an inventory ---');
// A set list has every card in the set on it, ticked or not. Read as an
// inventory it hands somebody the complete set they were working towards
// — the single worst thing this importer could quietly do.
{
  const rows = ['Card Number,Name,Owned'];
  for (let i = 1; i <= 60; i++) rows.push(`${i}/64,Card ${i},${i <= 12 ? 'x' : ''}`);
  const r = P.parse(rows.join('\n'));

  eq('a mostly-blank tick column reads as a checklist', r.archetype, 'checklist');
  eq('...so only the ticked ones are imported', r.counts.usable, 12);
  eq('...and the rest are left out rather than granted', r.counts.cards, 12);

  const inv = ['Card Number,Name,Qty'];
  for (let i = 1; i <= 60; i++) inv.push(`${i}/64,Card ${i},${(i % 3) + 1}`);
  eq('a filled quantity column reads as an inventory', P.parse(inv.join('\n')).archetype, 'inventory');
}

console.log('--- a checklist with no quantity column at all ---');
// The other shape: one row per card in the set, nothing but the list.
// Sequential numbers with no gaps is the tell.
{
  const seq = ['Number,Name'];
  for (let i = 1; i <= 102; i++) seq.push(`${i}/102,Card ${i}`);
  eq('unbroken 1..102 is a set list', P.parse(seq.join('\n')).archetype, 'checklist');

  const gappy = ['Number,Name'];
  [3, 17, 44, 45, 91, 130, 187, 201, 233, 290, 301, 355, 400, 455, 502, 560, 601, 655, 700, 780, 812, 890, 930, 999]
    .forEach((n, i) => gappy.push(`${n}/999,Card ${i}`));
  eq('a scattered list of holdings is an inventory', P.parse(gappy.join('\n')).archetype, 'inventory');

  const small = ['Number,Name', '4/102,Charizard', '60/64,Pikachu', '25/25,Mew'];
  eq('a short file gets the friendlier guess', P.parse(small.join('\n')).archetype, 'inventory');
}

console.log('--- files as they come off a real machine ---');
{
  const bom = '﻿Quantity,Name,Set\n1,Mew,Celebrations';
  eq('Excel\'s byte-order mark does not eat the first header', P.parse(bom).rows[0].quantity, 1);

  const tsv = 'Qty\tName\tCard ID\tLanguage\tCondition\tSet\n2\tGlaceon V\t175\tEnglish\tNM\tEvolving Skies';
  const t = P.parse(tsv);
  eq('Cardmarket\'s tabs are found', t.delimiter, '\t');
  eq('...and read', t.rows[0].name, 'Glaceon V');
  eq('...with NM understood', t.rows[0].condition, 'Near Mint');

  const semi = P.parse('Anzahl;Name;Set\n3;Mew;Celebrations');
  eq('a semicolon file is found too', semi.delimiter, ';');

  const crlf = P.parse('Quantity,Name\r\n1,Mew\r\n2,Pikachu');
  eq('Windows line endings leave no stray carriage return', crlf.rows[1].name, 'Pikachu');

  const quoted = P.parse('Quantity,Name,Set\n1,"Mew, Mewtwo & Co.","Sword & Shield, Brilliant Stars"');
  eq('a comma inside a quoted name does not split the row', quoted.rows[0].name, 'Mew, Mewtwo & Co.');
  eq('...nor inside a set name', quoted.rows[0].setName, 'Sword & Shield, Brilliant Stars');

  const dq = P.parse('Name,Set\n"Farfetch""d","Base Set"');
  eq('a doubled quote is one literal quote', dq.rows[0].name, 'Farfetch"d');
}

console.log('--- a homemade sheet with a title on top ---');
// Almost every spreadsheet a person made themselves opens with a title
// and a blank line. Assuming row one is the header maps nothing and tells
// them their perfectly good file is unreadable.
{
  const messy = [
    'My Pokemon Collection',
    '',
    'Last updated 2026-08-01',
    '',
    'Qty,Card Name,Set,Card #,Condition',
    '1,Charizard,Base Set,4/102,NM',
    '2,Blastoise,Base Set,2/102,LP'
  ].join('\n');
  const r = P.parse(messy);
  eq('the header row is found further down', r.headerIndex, 4);
  eq('...and the rows above it are not imported as cards', r.counts.total, 2);
  eq('"Card #" is a card number', r.rows[0].number, '4');
  eq('...and the abbreviated condition is understood', r.rows[1].condition, 'Lightly Played');
}

console.log('--- conditions and printings, however they are written ---');
{
  eq('NM', P.normalizeCondition('NM'), 'Near Mint');
  eq('Mint means the best one we have', P.normalizeCondition('Mint'), 'Near Mint');
  eq('LP', P.normalizeCondition('LP'), 'Lightly Played');
  eq('Excellent is a lightly played card', P.normalizeCondition('Excellent'), 'Lightly Played');
  eq('MP spelled out', P.normalizeCondition('Moderately Played'), 'Moderately Played');
  eq('Heavily Played', P.normalizeCondition('HP'), 'Heavily Played');
  eq('Damaged', P.normalizeCondition('DMG'), 'Damaged');
  eq('something we do not know stays unknown', P.normalizeCondition('Slabbed'), null);

  eq('Normal', P.normalizeVariant('Normal'), 'normal');
  eq('bare Foil means holo', P.normalizeVariant('Foil'), 'holofoil');
  eq('Holofoil', P.normalizeVariant('Holofoil'), 'holofoil');
  eq('Reverse Holofoil is checked before plain holo', P.normalizeVariant('Reverse Holofoil'), 'reverse-holofoil');
  eq('...and so is the abbreviation', P.normalizeVariant('RH'), 'reverse-holofoil');
  eq('1st Edition Holofoil', P.normalizeVariant('1st Edition Holofoil'), '1st-edition-holofoil');
  eq('1st Edition on its own', P.normalizeVariant('1st Edition'), '1st-edition');
  eq('Unlimited Holofoil', P.normalizeVariant('Unlimited Holofoil'), 'unlimited-holofoil');
  eq('a key we already use passes straight through', P.normalizeVariant('reverse-holofoil'), 'reverse-holofoil');
  eq('nonsense stays unknown rather than defaulting', P.normalizeVariant('Sparkly'), null);
}

console.log('--- graded cards ---');
// The expensive ones. The app has nowhere to store a grade, so this only
// has to notice it — but noticing it is what stops "PSA 10" being read as
// a condition we do not recognise and the row being thrown away.
{
  const g = P.parseGrade('PSA 10 (GEM-MT)');
  check('the grader is picked out', g && g.company === 'PSA', JSON.stringify(g));
  check('...and the number', g && g.grade === 10);
  check('half grades survive', P.parseGrade('BGS 9.5').grade === 9.5);
  check('TAG, as Collectr writes it', P.parseGrade('TAG 10 (Pristine)').company === 'TAG');
  check('CGC', P.parseGrade('CGC 8').company === 'CGC');
  eq('a plain condition is not a grade', P.parseGrade('Near Mint'), null);
  eq('a bare number is not a grade either', P.parseGrade('10'), null);

  const r = P.parse('Quantity,Name,Card Number,Condition\n1,Umbreon ex,161/131,PSA 10');
  check('a grade in the condition column is picked up there', r.rows[0].grade && r.rows[0].grade.grade === 10,
    JSON.stringify(r.rows[0].grade));
  check('...and the row is still imported', !r.rows[0].skip);
}

console.log('--- languages ---');
{
  eq('English', P.normalizeLanguage('English'), 'en');
  eq('Japanese', P.normalizeLanguage('Japanese'), 'ja');
  eq('JP', P.normalizeLanguage('JP'), 'ja');
  eq('French', P.normalizeLanguage('Francais'), 'fr');
  eq('missing means English', P.parse('Name,Set\nMew,Celebrations').rows[0].language, 'en');
  eq('something odd is handed back as typed', P.normalizeLanguage('Klingon'), 'Klingon');
}

console.log('--- broken lines do not sink the file ---');
// Four hundred cards with six bad rows should import three hundred and
// ninety-four and show the six.
{
  const csv = [
    'Quantity,Name,Card Number,Set',
    '1,Charizard,4/102,Base Set',
    '1,,,Base Set',
    '0,Pikachu,60/64,Jungle',
    '-2,Mew,25/25,Celebrations',
    '2,Blastoise,2/102,Base Set'
  ].join('\n');
  const r = P.parse(csv);
  eq('five rows read', r.counts.total, 5);
  eq('...two of them usable', r.counts.usable, 2);
  eq('...three set aside', r.counts.skipped, 3);
  eq('...and three cards in total', r.counts.cards, 3);
  check('a row with neither a name nor a number says why',
    r.rows[1].problems.join(' ').includes('nothing to identify a card by'), r.rows[1].problems.join('; '));
  check('a zero quantity is set aside, not imported as nothing', r.rows[2].skip);
  check('a negative quantity says so', r.rows[3].problems.join(' ').includes('negative'), r.rows[3].problems.join('; '));
  eq('an empty file says so plainly', P.parse('').ok, false);
}

console.log('--- a mapping the customer corrects wins ---');
// The whole design rests on the customer being able to fix our guess.
{
  const csv = 'Widget,Doohickey\nCharizard,4/102';
  const blind = P.parse(csv);
  check('an unrecognisable file maps nothing and says so', Object.keys(blind.mapping).length === 0,
    JSON.stringify(blind.mapping));
  check('...but hands back both columns to be assigned', blind.unmapped.length === 2);

  const fixed = P.parse(csv, { mapping: { name: 0, number: 1 } });
  eq('given the mapping it reads perfectly', fixed.rows[0].name, 'Charizard');
  eq('...number and all', fixed.rows[0].number, '4');
  check('...and the row is usable', !fixed.rows[0].skip);

  const forced = P.parse('Number,Name\n1/64,A\n2/64,B\n3/64,C', { archetype: 'inventory' });
  eq('an archetype the customer chose is obeyed', forced.archetype, 'inventory');
}

console.log('--- the rescue hatch: a typed list ---');
// pkmn.gg has no export. Dex has none on Android. TCGplayer has none at
// all. Those customers can still type.
{
  const text = [
    '4x Charizard Base Set 4/102',
    'Pikachu Jungle 60/64',
    '2 Umbreon ex Prismatic Evolutions 161/131',
    'Mew Celebrations #25'
  ].join('\n');
  const r = P.parseFreeText(text);

  eq('four lines, four cards', r.counts.total, 4);
  eq('"4x" is four copies', r.rows[0].quantity, 4);
  eq('...and comes off the front of the name', r.rows[0].name, 'Charizard Base Set');
  eq('a number on the end is pulled off', r.rows[0].number, '4');
  eq('no count means one', r.rows[1].quantity, 1);
  eq('"2 " without an x counts too', r.rows[2].quantity, 2);
  eq('a secret rare still keeps its numerator', r.rows[2].number, '161');
  eq('a hashed number works', r.rows[3].number, '25');
  eq('...and comes off the name', r.rows[3].name, 'Mew Celebrations');
  eq('eight cards between them', r.counts.cards, 8);
}

console.log('--- table or typed list ---');
{
  check('a csv is a table', P.looksLikeTable('Quantity,Name\n1,Mew'));
  check('a typed list is not', !P.looksLikeTable('4x Charizard Base Set 4/102\nPikachu Jungle 60/64'));
  check('one lonely line is not a table', !P.looksLikeTable('Quantity,Name'));
  check('tabs make a table', P.looksLikeTable('Qty\tName\n1\tMew'));
}

console.log(`\n${fails ? fails + ' OF ' + total + ' CHECKS FAILED' : total + ' CHECKS PASSED'}`);
process.exit(fails ? 1 : 0);
