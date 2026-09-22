'use strict';
const assert = require('assert');
const { DEFAULT_RULES } = require('../js/rules.default.js');
const engine = require('../js/engine.js');
const parser = require('../js/parser.js');

const PORTBASE_TEXT = `
New declaration
Overview
Timeline
General
Declaration type

Products of animal origin (CHED-P)

Food/feed of non-animal origin (CHED-D)
Bill of lading number (I.13)
HLCUMA3260712342
Destination (I.20-25)
Import
Own reference
1002002123 - 2026-468
Exporter (I.1)
GHAN MARINE PRODUCTS (IN)
Importer (I.6)
EUROFOODLINK B.V. (NL)
Country of origin (I.11)
IN
Country of loading (I.14)
IN
Expected date of arrival (I.10)
9/26/2026
 
7:00 AM
Document(s) (I.9)
#
1
Type
Health certificate
Identification
EIA/VSP/2026-27/02937
Date of issue
07-08-2026
#
2
Type
Certified lab report
Identification
EIA/VZ/26-27/0003572
Date of issue
07-08-2026
Goods item(s)
GN-code (I.31)
03061792
Animo code (I.31)
206107 (Visproducten aquacult. en 2-kleppige weekdieren MC, tenzij hermetisch verpakt én ambient)
Goods description (I.31)
Schaaldieren / garnalen van het geslacht "Penaeus"
Gross weight (I.34)
21516
Package type (I.32)
Carton (CT)
`;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

test('parser haalt kopgegevens, documenten en goederen uit Portbase-tekst', () => {
  const d = parser.parsePortbase(PORTBASE_TEXT);
  assert.strictEqual(d.type, 'PRD');
  assert.strictEqual(d.eigenReferentie, '1002002123 - 2026-468');
  assert.strictEqual(d.landOorsprong, 'IN');
  assert.strictEqual(d.landLading, 'IN');
  assert.strictEqual(d.eta, '9/26/2026');
  assert.strictEqual(d.documenten.length, 2);
  assert.strictEqual(d.documenten[0].type, 'HC');
  assert.strictEqual(d.documenten[0].identificatie, 'EIA/VSP/2026-27/02937');
  assert.strictEqual(d.documenten[1].type, 'LAB');
  assert.strictEqual(d.documenten[1].datum, '07-08-2026');
  assert.strictEqual(d.goederen.length, 1);
  assert.strictEqual(d.goederen[0].gn, '03061792');
  assert.strictEqual(d.goederen[0].animo, '206107');
});

test('garnalen uit India vereisen gezondheidscertificaat + labrapport', () => {
  const r = engine.requirementsFor({ type: 'PRD', gn: '03061792', animo: '206107', land: 'IN' }, DEFAULT_RULES);
  const types = r.vereisten.map(v => v.type);
  assert.deepStrictEqual(types, ['HC', 'LAB']);
  assert.strictEqual(r.vereisten[1].verwijstNaar, 'HC');
  assert.strictEqual(r.vereisten[1].niveau, 'verplicht');
});

test('aquacultuur (Animo 206107) sluit vangstcertificaat uit', () => {
  const wild = engine.requirementsFor({ type: 'PRD', gn: '03061792', animo: '999999', land: 'IN' }, DEFAULT_RULES);
  assert.ok(wild.vereisten.some(v => v.type === 'CATCH' && v.niveau === 'aandacht'));
  const aqua = engine.requirementsFor({ type: 'PRD', gn: '03061792', animo: '206107', land: 'IN' }, DEFAULT_RULES);
  assert.ok(!aqua.vereisten.some(v => v.type === 'CATCH'));
});

test('garnalen uit Ecuador: alleen gezondheidscertificaat', () => {
  const r = engine.requirementsFor({ type: 'PRD', gn: '03061792', animo: '206107', land: 'EC' }, DEFAULT_RULES);
  assert.deepStrictEqual(r.vereisten.map(v => v.type), ['HC']);
});

test('samengesteld product: HC of private attestation', () => {
  const r = engine.requirementsFor({ type: 'PRD', gn: '19023010', animo: '', land: 'CN' }, DEFAULT_RULES);
  assert.strictEqual(r.vereisten.length, 1);
  assert.strictEqual(r.vereisten[0].type, 'HC');
  assert.deepStrictEqual(r.vereisten[0].alternatieven, ['PRIVATT']);
  const decl = { type: 'PRD', landOorsprong: 'CN', documenten: [{ type: 'PRIVATT', identificatie: 'PA-1', datum: '01-01-2026' }], goederen: [{ gn: '19023010' }] };
  const res = engine.checkDeclaration(decl, DEFAULT_RULES);
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.items[0].vereisten[0].gebruiktType, 'PRIVATT');
});

test('CHED-D sesamzaad India: officieel certificaat + labrapport', () => {
  const r = engine.requirementsFor({ type: 'LNV', gn: '12074090', animo: '', land: 'IN' }, DEFAULT_RULES);
  assert.deepStrictEqual(r.vereisten.map(v => v.type), ['OFFCERT', 'LAB']);
});

test('CHED-D zonder regels geeft info-melding', () => {
  const res = engine.checkItem({ type: 'LNV', landOorsprong: 'BR', documenten: [] }, { gn: '08051022' }, DEFAULT_RULES);
  assert.strictEqual(res.vereisten.length, 0);
  assert.strictEqual(res.status, 'ok');
  assert.ok(res.meldingen.some(m => m.niveau === 'info'));
});

test('volledige declaratie uit Portbase-tekst: compleet, verwijzing handmatig te controleren', () => {
  const decl = parser.parsePortbase(PORTBASE_TEXT);
  const res = engine.checkDeclaration(decl, DEFAULT_RULES);
  assert.strictEqual(res.items.length, 1);
  const lab = res.items[0].vereisten.find(v => v.type === 'LAB');
  assert.strictEqual(lab.status, 'aandacht');
  assert.ok(lab.tekst.some(t => /handmatig/.test(t)));
  assert.strictEqual(res.status, 'aandacht');
});

test('labrapport met correcte verwijzing naar certificaat: ok', () => {
  const decl = parser.parsePortbase(PORTBASE_TEXT);
  decl.documenten[1].verwijstNaar = 'EIA/VSP/2026-27/02937';
  const res = engine.checkDeclaration(decl, DEFAULT_RULES);
  assert.strictEqual(res.status, 'ok');
});

test('labrapport met foute verwijzing: fout', () => {
  const decl = parser.parsePortbase(PORTBASE_TEXT);
  decl.documenten[1].verwijstNaar = 'ANDERS/123';
  const res = engine.checkDeclaration(decl, DEFAULT_RULES);
  assert.strictEqual(res.status, 'fout');
});

test('ontbrekend labrapport: ontbreekt', () => {
  const decl = parser.parsePortbase(PORTBASE_TEXT);
  decl.documenten = decl.documenten.filter(d => d.type !== 'LAB');
  const res = engine.checkDeclaration(decl, DEFAULT_RULES);
  assert.strictEqual(res.status, 'ontbreekt');
  const lab = res.items[0].vereisten.find(v => v.type === 'LAB');
  assert.strictEqual(lab.status, 'ontbreekt');
});

test('afgiftedatum na ETA geeft aandacht', () => {
  const decl = { type: 'PRD', landOorsprong: 'EC', eta: '9/26/2026', documenten: [{ type: 'HC', identificatie: 'X', datum: '01-10-2026' }], goederen: [{ gn: '03061792', animo: '206107' }] };
  const res = engine.checkDeclaration(decl, DEFAULT_RULES);
  assert.strictEqual(res.items[0].vereisten[0].status, 'aandacht');
});

test('parseDate accepteert dd-mm-jjjj en m/d/jjjj', () => {
  assert.strictEqual(engine.parseDate('07-08-2026').getMonth(), 7);
  assert.strictEqual(engine.parseDate('9/26/2026').getDate(), 26);
  assert.strictEqual(engine.parseDate('2026-09-26').getDate(), 26);
});

test('validateRules vindt fouten', () => {
  assert.deepStrictEqual(engine.validateRules(DEFAULT_RULES), []);
  const errs = engine.validateRules([{ id: 'a' }, { id: 'a', documenten: [{ type: 'HC', niveau: 'x' }], gn: 'nope' }]);
  assert.ok(errs.length >= 3);
});

console.log('\n' + passed + ' tests geslaagd');

// ---------------------------------------------------------------------------
// Uitbreidingen: GN-match in beide richtingen, meldingen en de TARIC-regels
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

test('regelcode op 10 cijfers matcht ook een 8-cijferige invoer', () => {
  const rule = { id: 'x', type: '*', gn: ['0306179220'], animo: '*', landen: '*', documenten: [{ type: 'HC', niveau: 'verplicht' }] };
  assert.ok(engine.matchRule(rule, { type: 'PRD', gn: '03061792', land: 'IN' }));
  assert.ok(engine.matchRule(rule, { type: 'PRD', gn: '0306179220', land: 'IN' }));
  assert.ok(!engine.matchRule(rule, { type: 'PRD', gn: '03061791', land: 'IN' }));
  assert.ok(!engine.matchRule(rule, { type: 'PRD', gn: '03', land: 'IN' }));
});

test('regels met alleen meldingen (bijv. invoerverbod) werken', () => {
  const rule = { id: 'verbod', type: '*', gn: ['0306'], animo: '*', landen: ['KP'], meldingen: [{ niveau: 'fout', tekst: 'Invoerverbod' }] };
  assert.deepStrictEqual(engine.validateRules([rule]), []);
  const res = engine.checkItem({ type: 'PRD', landOorsprong: 'KP', documenten: [] }, { gn: '03061792' }, [rule]);
  assert.strictEqual(res.status, 'fout');
  assert.ok(res.meldingen.some(m => m.tekst === 'Invoerverbod'));
  const r2 = engine.requirementsFor({ type: 'PRD', gn: '03061792', land: 'KP' }, [rule]);
  assert.strictEqual(r2.meldingen.length, 1);
});

const taricPath = path.join(__dirname, '..', 'data', 'rules.taric.json');
if (fs.existsSync(taricPath)) {
  const TARIC_RULES = JSON.parse(fs.readFileSync(taricPath, 'utf8'));
  const ALL = DEFAULT_RULES.concat(TARIC_RULES);

  test('TARIC-regels zijn geldig volgens validateRules', () => {
    assert.deepStrictEqual(engine.validateRules(ALL), []);
  });

  test('TARIC: garnalen uit India -> veterinaire controle (HC) + IUU (vangstcertificaat ter beoordeling)', () => {
    const r = engine.requirementsFor({ type: 'PRD', gn: '03061792', animo: '206107', land: 'IN' }, TARIC_RULES);
    const hc = r.vereisten.find(v => v.type === 'HC');
    const catchDoc = r.vereisten.find(v => v.type === 'CATCH');
    assert.ok(hc && hc.niveau === 'verplicht');
    assert.ok(catchDoc && catchDoc.niveau === 'aandacht');
    assert.ok(r.regels.every(x => x.bronType === 'taric'));
  });

  test('TARIC: Noorwegen is uitgezonderd van veterinaire controle', () => {
    const r = engine.requirementsFor({ type: 'PRD', gn: '03061792', animo: '', land: 'NO' }, TARIC_RULES);
    assert.ok(!r.vereisten.some(v => v.type === 'HC'));
  });

  test('TARIC: sesamzaad uit India -> Ver. 2019/1793 (officieel certificaat + labrapport ter beoordeling)', () => {
    const r = engine.requirementsFor({ type: 'LNV', gn: '12074090', animo: '', land: 'IN' }, TARIC_RULES);
    assert.ok(r.vereisten.some(v => v.type === 'OFFCERT'));
    assert.ok(r.vereisten.some(v => v.type === 'LAB' && v.verwijstNaar === 'OFFCERT'));
    const brazil = engine.requirementsFor({ type: 'LNV', gn: '12074090', animo: '', land: 'BR' }, TARIC_RULES);
    assert.ok(!brazil.vereisten.some(v => v.type === 'OFFCERT'));
  });

  test('TARIC: invoerverbod Noord-Korea geeft status fout', () => {
    const res = engine.checkItem({ type: 'PRD', landOorsprong: 'KP', documenten: [{ type: 'HC', identificatie: 'X', datum: '01-01-2026' }] }, { gn: '03061792' }, ALL);
    assert.strictEqual(res.status, 'fout');
  });

  test('handmatig + TARIC gecombineerd: India-garnalen vereisen HC (beide) en LAB (handmatig)', () => {
    const r = engine.requirementsFor({ type: 'PRD', gn: '03061792', animo: '206107', land: 'IN' }, ALL);
    const lab = r.vereisten.find(v => v.type === 'LAB');
    assert.ok(lab && lab.niveau === 'verplicht' && lab.verwijstNaar === 'HC');
    const hc = r.vereisten.find(v => v.type === 'HC');
    assert.ok(hc.regelIds.length >= 2);
  });
}

console.log('\n' + passed + ' tests geslaagd (totaal)');
