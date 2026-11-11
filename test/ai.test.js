'use strict';
/* Tests voor js/ggb-ai.js: schema, normalisatie en koppeling met de documentcheck. */
const assert = require('assert');
const AI = require('../js/ggb-ai.js');
const engine = require('../js/engine.js');
const { DEFAULT_RULES } = require('../js/rules.default.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

function veld(waarde, zekerheid = 'hoog', bron = 'HC') { return { waarde, bron, zekerheid }; }

// Wat Claude zou teruggeven voor garnalen uit India (HC + labrapport + B/L).
const RUW = {
  declaratieType: veld('PRD'),
  bol: veld('HLCU MA3260712342'),
  bestemming: veld('Import', 'middel'),
  exporteur: { naam: 'GHAN MARINE PRODUCTS', adres: 'Plot 12, Kakinada, Andhra Pradesh', land: 'in', bron: 'HC I.1', zekerheid: 'hoog' },
  importeur: { naam: 'EUROFOODLINK B.V.', adres: 'Rotterdam', land: 'NL', bron: 'HC I.5', zekerheid: 'hoog' },
  grenscontrolepost: veld('Rotterdam (NLRTM1)', 'middel'),
  plaatsBestemming: veld('EUROFOODLINK B.V., Rotterdam'),
  landOorsprong: veld('IN'),
  landLading: veld('India'), // geen ISO-code -> waarschuwing
  gecertificeerdVoor: veld('Human consumption'),
  transportconditie: veld('Frozen'),
  vervoermiddel: veld('Vessel'),
  vervoermiddelNaam: veld('MSC ANNA'),
  vervoermiddelNationaliteit: veld('PA'),
  aankomstDatum: veld('2026-09-26'),
  aankomstTijd: veld('7.00'),
  containers: [
    { containernummer: 'HLBU 906604-5', zegelnummer: 'EIA123', bron: 'HC' },
    { containernummer: 'HLBU9066046', zegelnummer: '', bron: 'B/L' } // fout controlecijfer
  ],
  documenten: [
    { type: 'HC', identificatie: 'EIA/VSP/2026-27/02937', datumAfgifte: '07 Aug 2026', landAfgifte: 'IN', inrichtingOorsprong: '', verwijstNaar: '', bestand: 'hc.pdf', zekerheid: 'hoog' },
    { type: 'LAB', identificatie: 'EIA/VZ/26-27/0003572', datumAfgifte: '07/08/2026', landAfgifte: 'IN', inrichtingOorsprong: '', verwijstNaar: 'EIA/VSP/2026-27/02937', bestand: 'lab.pdf', zekerheid: 'hoog' },
    { type: 'ONZIN', identificatie: '', datumAfgifte: '', landAfgifte: '', inrichtingOorsprong: '', verwijstNaar: '', bestand: '', zekerheid: 'laag' }
  ],
  goederen: [
    { gnCode: '0306.17.92', omschrijving: 'Frozen shrimps (Penaeus vannamei)', brutoGewicht: '21.516,00', nettoGewicht: '13,447.5 kg', aantalColli: '1600', verpakkingstype: 'Carton', batchnummer: 'L123', aanvullendeEenheden: '', erkenningsnummer: '1234', containernummer: 'HLBU9066045', bron: 'HC I.27', zekerheid: 'hoog' }
  ],
  waarschuwingen: ['Brutogewicht op B/L wijkt af van HC.']
};

test('schema is geldig voor structured outputs (alle objecten strikt)', () => {
  function loop(s, pad) {
    if (s.type === 'object') {
      assert.strictEqual(s.additionalProperties, false, pad + ' mist additionalProperties:false');
      assert.deepStrictEqual(s.required.slice().sort(), Object.keys(s.properties).sort(), pad + ' required != properties');
      Object.keys(s.properties).forEach(k => loop(s.properties[k], pad + '.' + k));
    } else if (s.type === 'array') {
      loop(s.items, pad + '[]');
    } else {
      assert.ok(['string'].includes(s.type), pad + ' onverwacht type ' + s.type);
    }
  }
  loop(AI.SCHEMA, '$');
});

test('datums worden dd-mm-jjjj', () => {
  assert.strictEqual(AI.normDatum('2026-09-26'), '26-09-2026');
  assert.strictEqual(AI.normDatum('7/8/2026'), '07-08-2026');
  assert.strictEqual(AI.normDatum('07 Aug 2026'), '07-08-2026');
  assert.strictEqual(AI.normDatum('7 mei 26'), '07-05-2026');
  assert.strictEqual(AI.normDatum('Aug 7, 2026'), '07-08-2026');
  assert.strictEqual(AI.normDatum('31-02-2026'), '');
  assert.strictEqual(AI.normDatum('onbekend'), '');
});

test('gewichten, tijden en landcodes', () => {
  assert.strictEqual(AI.normGetal('21.516,00'), '21516');
  assert.strictEqual(AI.normGetal('13,447.5 kg'), '13447.5');
  assert.strictEqual(AI.normGetal('13447,5'), '13447.5');
  assert.strictEqual(AI.normGetal('abc'), '');
  assert.strictEqual(AI.normTijd('7.00'), '07:00');
  assert.strictEqual(AI.normTijd('25:00'), '');
  assert.strictEqual(AI.normLand('in'), 'IN');
  assert.strictEqual(AI.normLand('India'), '');
});

test('ISO 6346-controlecijfer van containernummers', () => {
  assert.ok(AI.containerGeldig('HLBU9066045'));
  assert.ok(AI.containerGeldig('CSQU3054383'));
  assert.ok(!AI.containerGeldig('HLBU9066046'));
  assert.ok(!AI.containerGeldig('HLBU906604'));
});

test('normaliseer: velden, documenten, goederen en waarschuwingen', () => {
  const r = AI.normaliseer(RUW);
  assert.strictEqual(r.bol.waarde, 'HLCUMA3260712342');
  assert.strictEqual(r.exporteur.land, 'IN');
  assert.strictEqual(r.landLading.waarde, '');
  assert.strictEqual(r.aankomstDatum.waarde, '26-09-2026');
  assert.strictEqual(r.aankomstTijd.waarde, '07:00');
  assert.strictEqual(r.containers[0].containernummer, 'HLBU9066045');
  assert.strictEqual(r.documenten.length, 2, 'lege/onbekende documentregel valt weg');
  assert.strictEqual(r.documenten[0].datumAfgifte, '07-08-2026');
  assert.strictEqual(r.goederen[0].gnCode, '03061792');
  assert.strictEqual(r.goederen[0].brutoGewicht, '21516');
  assert.strictEqual(r.goederen[0].nettoGewicht, '13447.5');
  assert.ok(r.waarschuwingen.includes('Brutogewicht op B/L wijkt af van HC.'));
  assert.ok(r.waarschuwingen.some(w => /HLBU9066046/.test(w)));
  assert.ok(r.waarschuwingen.some(w => /India/.test(w)));
});

test('normaliseer is robuust tegen een leeg of half antwoord', () => {
  const r = AI.normaliseer({});
  assert.strictEqual(r.bol.waarde, '');
  assert.strictEqual(r.bol.zekerheid, 'laag');
  assert.deepStrictEqual(r.goederen, []);
  assert.strictEqual(r.declaratieType.waarde, '');
  const r2 = AI.normaliseer({ goederen: [{ gnCode: '12074090', omschrijving: 'Sesame seeds' }] });
  assert.strictEqual(r2.declaratieType.waarde, 'LNV', 'CHED-type afgeleid uit GN-code');
});

test('AI-voorstel -> documentcheck: India-garnalen met HC + labrapport dat naar het HC verwijst is compleet', () => {
  const decl = AI.naarDeclaratie(AI.normaliseer(RUW));
  assert.strictEqual(decl.type, 'PRD');
  assert.strictEqual(decl.landOorsprong, 'IN');
  const res = engine.checkDeclaration(decl, DEFAULT_RULES);
  const item = res.items[0];
  const hc = item.vereisten.find(x => x.type === 'HC');
  const lab = item.vereisten.find(x => x.type === 'LAB');
  assert.strictEqual(hc.status, 'ok');
  assert.strictEqual(lab.status, 'ok');
});

test('AI-voorstel zonder labrapport -> documentcheck meldt ontbrekend labrapport', () => {
  const zonderLab = Object.assign({}, RUW, { documenten: [RUW.documenten[0]] });
  const res = engine.checkDeclaration(AI.naarDeclaratie(AI.normaliseer(zonderLab)), DEFAULT_RULES);
  const lab = res.items[0].vereisten.find(x => x.type === 'LAB');
  assert.strictEqual(lab.status, 'ontbreekt');
});

test('gebruikersprompt noemt bestanden en extra info', () => {
  const t = AI.gebruikersPrompt(['hc.pdf', 'bl.pdf'], 'ETA 26-09');
  assert.ok(t.includes('hc.pdf, bl.pdf'));
  assert.ok(t.includes('ETA 26-09'));
});

test('invuller kiest de best passende optie (eigen waarde gaat voor synoniem)', () => {
  const FILL = require('../extension/portbase-fill.js');
  const opt = (...xs) => xs.map(textContent => ({ textContent }));
  assert.strictEqual(FILL.besteOptie(opt('Bag', 'Box', 'Carton'), ['Carton', 'Box']).textContent, 'Carton');
  assert.strictEqual(FILL.besteOptie(opt('Saint Kitts', 'ID - Indonesia', 'IN - India'), ['IN']).textContent, 'IN - India');
  assert.strictEqual(FILL.besteOptie(opt('Sea', 'Air', 'Rail', 'Road'), ['Vessel', 'Ship', 'Sea']).textContent, 'Sea');
  assert.strictEqual(FILL.besteOptie(opt('Health certificate (636)', 'Certified lab report'), ['Certified lab report']).textContent, 'Certified lab report');
  assert.strictEqual(FILL.besteOptie(opt('Ambient', 'Chilled'), ['Frozen']), null);
});

console.log('\n' + passed + ' AI-tests geslaagd');
