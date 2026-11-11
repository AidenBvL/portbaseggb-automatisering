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

test('zoekresultaat in organisatiedialoog: naam (zonder B.V./Pvt Ltd) en erkenningsnummer', () => {
  const FILL = require('../extension/portbase-fill.js');
  const rij = (naam, erk) => ({ querySelector: (sel) => ({ textContent: /approvalNumber/.test(sel) ? erk : /name/.test(sel) ? naam : '' }) });
  assert.strictEqual(FILL.rijScore(rij('EUROFOODLINK B.V.', ''), { term: 'EUROFOODLINK B.V.', type: 'NAME' }), 4);
  assert.strictEqual(FILL.rijScore(rij('GHAN MARINE PRODUCTS PVT LTD', ''), { term: 'Ghan Marine Products', type: 'NAME' }), 4);
  // Andere firma met dezelfde beginnaam: alleen kandidaat (2), nooit exact (4) -> wordt niet automatisch aangevinkt
  assert.strictEqual(FILL.rijScore(rij('EUROFOODLINK LOGISTICS B.V.', ''), { term: 'EUROFOODLINK B.V.', type: 'NAME' }), 2);
  assert.strictEqual(FILL.rijScore(rij('X', '1234'), { term: '1234', type: 'APPROVAL_NUMBER' }), 4);
  assert.strictEqual(FILL.rijScore(rij('X', 'IN-1234-A'), { term: '1234', type: 'APPROVAL_NUMBER' }), 2);
});

test('grenscontrolepost wordt op de Portbase-lijst gezet; inspectiecentrum niet door AI', () => {
  assert.strictEqual(AI.zoekInLijst(AI.BCP_NL, 'Port of Rotterdam').label, 'Rotterdam (NLRTM1)');
  assert.strictEqual(AI.zoekInLijst(AI.BCP_NL, 'NLAMS4').label, 'Amsterdam Airport Schiphol (NLAMS4)');
  assert.strictEqual(AI.zoekInLijst(AI.BCP_NL, 'Amsterdam').label, 'Amsterdam (NLAMS1)');
  assert.strictEqual(AI.zoekInLijst(AI.BCP_NL, 'Antwerpen'), null);
  const r = AI.normaliseer({ grenscontrolepost: veld('Rotterdam') });
  assert.strictEqual(r.grenscontrolepost.waarde, 'Rotterdam (NLRTM1)');
  const r2 = AI.normaliseer({ grenscontrolepost: veld('Antwerpen') });
  assert.strictEqual(r2.grenscontrolepost.waarde, '');
  assert.ok(r2.waarschuwingen.some(w => /Grenscontrolepost "Antwerpen"/.test(w)));
  assert.ok(!('inspectiecentrum' in AI.SCHEMA.properties), 'inspectiecentrum vult de declarant zelf in');
  const bcpEnum = AI.SCHEMA.properties.grenscontrolepost.properties.waarde.enum;
  assert.ok(bcpEnum.includes('Rotterdam (NLRTM1)') && bcpEnum.includes(''));
});

test('GN-regel: GN-code (6 of 8 cijfers) en soort bepalen de score', () => {
  const FILL = require('../extension/portbase-fill.js');
  const rij = (gn, wn) => ({ querySelector: (sel) => ({ textContent: /gnCode/.test(sel) ? ' ' + gn + ' ' : /scientificName/.test(sel) ? wn : '' }) });
  assert.strictEqual(FILL.gnScore(rij('030617', 'Penaeus vannamei'), '03061792', 'Penaeus vannamei'), 22);
  assert.strictEqual(FILL.gnScore(rij('03061792', 'Penaeus vannamei'), '03061792', 'Penaeus vannamei'), 32);
  assert.strictEqual(FILL.gnScore(rij('030617', 'Penaeus monodon'), '03061792', 'Penaeus vannamei'), 21, 'zelfde geslacht');
  assert.strictEqual(FILL.gnScore(rij('160232', 'Gallus gallus'), '03061792', 'Gallus gallus'), 0, 'andere GN-code');
});

test('AI-voorstel bevat soort en aard per goederenitem', () => {
  const r = AI.normaliseer({ goederen: [{ gnCode: '03061792', omschrijving: 'Shrimps', wetenschappelijkeNaam: ' Penaeus  vannamei ', aardProduct: 'Farmed' }] });
  assert.strictEqual(r.goederen[0].wetenschappelijkeNaam, 'Penaeus vannamei');
  assert.strictEqual(r.goederen[0].aardProduct, 'Farmed');
  assert.ok(AI.SCHEMA.properties.goederen.items.required.includes('wetenschappelijkeNaam'));
});

test('instellingen: oud formaat wordt Claude, standaarden per aanbieder, probleemmelding', () => {
  const oud = AI.instellingen({ apiKey: 'sk-ant-1', model: 'claude-opus-5-5', effort: 'xhigh' });
  assert.strictEqual(oud.provider, 'claude');
  assert.deepStrictEqual(oud.claude, { apiKey: 'sk-ant-1', model: 'claude-opus-5-5', effort: 'xhigh' });
  const leeg = AI.instellingen({});
  assert.strictEqual(leeg.claude.model, 'claude-opus-5-5');
  assert.strictEqual(leeg.gemini.model, 'gemini-pro-latest');
  assert.strictEqual(leeg.openai.model, '', 'geen verouderde OpenAI-modelnaam hardcoden');
  assert.ok(/Geen API-sleutel voor Claude/.test(AI.aanbiederProbleem(leeg)));
  assert.ok(/Geen model voor ChatGPT/.test(AI.aanbiederProbleem(AI.instellingen({ provider: 'openai', openai: { apiKey: 'sk' } }))));
  assert.strictEqual(AI.aanbiederProbleem(AI.instellingen({ provider: 'gemini', gemini: { apiKey: 'AIza' } })), '');
  assert.strictEqual(AI.instellingen({ provider: 'onzin' }).provider, 'claude');
});

test('handmatige prompt: instructies, bestandsnamen, extra info en schema', () => {
  const p = AI.handmatigePrompt(['hc.pdf', 'bl.pdf'], 'ETA 26-09-2026');
  assert.ok(p.startsWith(AI.SYSTEM));
  assert.ok(p.includes('hc.pdf, bl.pdf') && p.includes('ETA 26-09-2026'));
  assert.ok(p.includes('UITSLUITEND met één JSON-object'));
  assert.ok(p.includes(JSON.stringify(AI.SCHEMA)));
  assert.ok(AI.handmatigePrompt([], '').includes('(de bijgevoegde documenten)'));
});

test('geplakt chat-antwoord: met tekst eromheen, codeblok en kale waarden', () => {
  const plak = 'Natuurlijk! Hier is het resultaat:\n```json\n' + JSON.stringify({ bol: 'HLCU1', landOorsprong: 'in', exporteur: 'GHAN MARINE', declaratieType: { waarde: 'PRD', bron: 'HC', zekerheid: 'hoog' }, goederen: [{ gnCode: '0306.17.92' }] }) + '\n```\nSucces!';
  const r = AI.normaliseer(AI.leesJsonAntwoord(plak));
  assert.strictEqual(r.bol.waarde, 'HLCU1');
  assert.strictEqual(r.bol.zekerheid, 'middel', 'kale waarde -> middel');
  assert.strictEqual(r.landOorsprong.waarde, 'IN');
  assert.strictEqual(r.exporteur.naam, 'GHAN MARINE');
  assert.strictEqual(r.declaratieType.zekerheid, 'hoog');
  assert.strictEqual(r.goederen[0].gnCode, '03061792');
  assert.throws(() => AI.leesJsonAntwoord(''), /Plak eerst/);
  assert.throws(() => AI.leesJsonAntwoord('Ik kan dat niet lezen.'), /Geen JSON-object/);
  assert.throws(() => AI.leesJsonAntwoord('{"bol": "x",}'), /geen geldige JSON/);
  assert.throws(() => AI.leesJsonAntwoord('{"naam": "x"}'), /niet op een GGB-voorstel/);
});

console.log('\n' + passed + ' AI-tests geslaagd');
