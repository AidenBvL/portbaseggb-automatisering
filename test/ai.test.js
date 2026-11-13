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

test('organisatiedialoog: van 5 regels "Quang Phu" wint de exporteur in Binh An; inrichting via DL 1022', () => {
  global.window = global.window || {};
  const FILL = require('../extension/portbase-fill.js');
  const rij = (o) => ({ querySelector: (sel) => { const m = sel.match(/mat-column-(\w+)/); return { textContent: m ? (o[m[1]] || '') : '' }; }, textContent: o.name });
  const ADRES = 'LAND PLOT NUMBER 1358, MAP SHEET 3, GROUP 2, AN PHUOC HAMLET, BINH AN COMMUNE, AN GIANG PROVINCE';
  const NAAM = 'QUANG PHU SEAFOOD IMPORT EXPORT COMPANY LIMITED';
  const R = [ // echte zoekresultaten uit Portbase
    { name: 'Quang Phu Seafood Import Export Company Limited', address: ADRES, city: 'Binh An', approvalNumber: 'DL 1022', activity: 'PP - establish_pp', activityDepartment: 'food' },
    { name: NAAM, address: 'AN PHUOC HAMLET, BINH AN COMMUNE. CHAU THANH DISTRICT, KIEN GIANG PROVINCE, VIETNAM', city: 'Chau Thanh', activity: 'AE - animal_exporter', activityDepartment: 'veterinary' },
    { name: NAAM, address: 'AN PHUOC HAMLET, BINH AN COMMUNE, CHAU THANH DISTRICT, KIEN GIANG PROVINCE, VIETNAM', city: 'Chau Thanh', activity: 'ES - establishment', activityDepartment: 'food' },
    { name: NAAM, address: 'AN PHUOC HAMLET, BINH AN COMMUNE, CHAU THANH DISTRICT, KIEN GIANG PROVINCE, VIETNAM', city: 'Chau Thanh', activity: 'EX - exporter', activityDepartment: 'food' },
    { name: NAAM, address: 'LAND PLOT N 1358 / MAP SHEET 3 / GROUP 2 / AN PHUOC HAMLET', city: 'Binh An', activity: 'EX - exporter', activityDepartment: 'fishing' },
  ].map(rij);
  const r = AI.normaliseer({ landOorsprong: 'VN', goederen: [{ gnCode: '03061792' }],
    exporteur: { naam: 'Quang Phu Seafood Import Export Company Limited', adres: ADRES, plaats: 'Binh An', land: 'VN' },
    plaatsVerzending: { naam: 'Quang Phu Seafood Import Export Company Limited', adres: ADRES, plaats: 'Binh An', land: 'VN', erkenningsnummer: 'DL 1022' } });
  const best = (zoek) => { const s = R.map((x) => FILL.rijScore(x, zoek)); const max = Math.max(...s); return { i: s.indexOf(max), marge: max - [...s].sort((a, b) => b - a)[1] }; };
  const ex = best(FILL.orgZoek(r.exporteur, 'exporter', 'VN', r));
  assert.strictEqual(ex.i, 4, 'EX - exporter, fishing, Binh An');
  assert.ok(ex.marge >= 8, 'duidelijke winnaar');
  const pvZoek = FILL.orgZoek(r.plaatsVerzending, 'inrichting', 'VN', r);
  assert.strictEqual(pvZoek.type, 'APPROVAL_NUMBER');
  assert.strictEqual(pvZoek.term, 'DL 1022');
  assert.strictEqual(best(pvZoek).i, 0);
  // Andere firma met dezelfde beginnaam is nooit een exacte naam-match
  const ander = rij({ name: 'EUROFOODLINK LOGISTICS B.V.', city: 'Rotterdam' });
  assert.ok(FILL.rijScore(ander, { type: 'NAME', term: 'EUROFOODLINK B.V.', naam: 'EUROFOODLINK B.V.' }) < 40);
});

test('GN-producttype: aard product + Animo-omschrijving kiezen tussen aquacultuur en wild gevangen', () => {
  const FILL = require('../extension/portbase-fill.js');
  const hints = 'Wild caught, frozen Andere visserijproducten dan 206107 (FQ3)';
  assert.ok(FILL.typeOvereenkomst('Visserijproducten (wild gevangen)', hints) > FILL.typeOvereenkomst('Visserijproducten (aquacultuur)', hints));
  const aqua = 'Farmed, frozen Visproducten aquacult. en 2-kleppige weekdieren MC';
  assert.ok(FILL.typeOvereenkomst('Visserijproducten (aquacultuur)', aqua) > FILL.typeOvereenkomst('Visserijproducten (wild gevangen)', aqua));
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

test('GN-code zoals op het HC (zoekterm GN-dialoog) en Animo-keuzehulp in de prompt', () => {
  const r = AI.normaliseer({ goederen: [{ gnCode: '1602.32.19', gnCodeHc: '1602 32', omschrijving: 'Chicken', animoCode: '201100' }, { gnCode: '', gnCodeHc: '030617', omschrijving: 'Shrimps' }] });
  assert.strictEqual(r.goederen[0].gnCodeHc, '160232');
  assert.strictEqual(r.goederen[0].gnCode, '16023219');
  assert.strictEqual(r.goederen[0].animoCode, '201100');
  assert.strictEqual(r.goederen[1].gnCode, '030617', 'zonder volledige GN-code: de code van het HC');
  assert.ok(AI.SCHEMA.properties.goederen.items.required.includes('gnCodeHc'));
  const p = AI.handmatigePrompt([], '');
  assert.ok(/ALTIJD de Animo-code/.test(p) && /Keuzehulp/.test(p) && /206107 bij aquacultuur/.test(p) && /201105/.test(p), 'Animo-keuzehulp');
  assert.ok(!/Leeg als je het niet zeker weet/.test(p), 'AI mag de Animo-code niet zomaar leeg laten');
});

test('extension/ai.bundle.js is bijgewerkt met js/ggb-ai.js (anders: cd ai && npm run build)', () => {
  const bundel = require('fs').readFileSync(require('path').join(__dirname, '..', 'extension', 'ai.bundle.js'), 'utf8');
  const sleutels = new Set();
  (function loop(s) { if (!s || typeof s !== 'object') return; if (s.properties) Object.keys(s.properties).forEach((k) => { sleutels.add(k); loop(s.properties[k]); }); if (s.items) loop(s.items); })(AI.SCHEMA);
  for (const k of sleutels) assert.ok(bundel.includes(k), 'schemaveld ' + k + ' ontbreekt in de bundel');
  for (const regel of AI.SYSTEM.split('\n').map((r) => r.trim()).filter((r) => r.length > 30 && /^[\x20-\x7e]+$/.test(r) && !/["'\\]/.test(r))) {
    assert.ok(bundel.includes(regel), 'promptregel ontbreekt in de bundel: ' + regel);
  }
});

test('GN-producttype: wild/gefokt, bereiding/vleesproduct uit HC en Animo-code', () => {
  const FILL = require('../extension/portbase-fill.js');
  const wild = 'Fishery products, Wild stock; Frozen';
  assert.ok(FILL.kenmerkScore('Wilde dieren', wild, '102108') > FILL.kenmerkScore('Gefokte dieren', wild, '102108'), 'Wild stock -> Wilde dieren');
  assert.ok(FILL.kenmerkScore('Gefokte dieren', 'Frozen', '206107') > FILL.kenmerkScore('Wilde dieren', 'Frozen', '206107'), 'Animo 206107 -> Gefokte dieren');
  assert.ok(FILL.kenmerkScore('Vleesbereiding', 'Meat preparation', '201105') > FILL.kenmerkScore('Vleesproducten', 'Meat preparation', '201105'));
  assert.strictEqual(FILL.kenmerkScore('Wilde dieren', 'wild or farmed', ''), 0, 'tegenstrijdige HC-tekst telt niet');
});

test('keuzelijsten: verpakking naar Portbase-optie, containernummer met spaties', () => {
  const FILL = require('../extension/portbase-fill.js');
  const optie = (t) => ({ textContent: t });
  const VERP = ['Bag (BG)', 'Box (BX)', 'Carton (CT)', 'Case (CS)', 'Pallet (PX)', 'Package (PK)'].map(optie);
  const termen = FILL.GOED.filter((d) => d.key === 'verpakkingstype')[0].termen;
  for (const [in_, uit] of [['Carton', 'Carton (CT)'], ['CTNS', 'Carton (CT)'], ['cartons', 'Carton (CT)'], ['Bags', 'Bag (BG)'], ['Pallets', 'Pallet (PX)'], ['PKGS', 'Package (PK)'], ['Box (BX)', 'Box (BX)']]) {
    assert.strictEqual(FILL.besteOptie(VERP, termen(in_)).textContent, uit, in_);
  }
  assert.strictEqual(FILL.besteOptie([optie(' OTPU6051557 '), optie('HLBU9066045')], ['OTPU 605155 7']).textContent.trim(), 'OTPU6051557');
  assert.strictEqual(FILL.besteOptie(['Import', 'Transhipment', 'Transit', 'Storage', 'Transfer', 'Re-import'].map(optie), ['Import']).textContent, 'Import');
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

const ALLE_REGELS = (() => {
  const fs = require('fs'), path = require('path');
  const p = path.join(__dirname, '..', 'data', 'rules.taric.json');
  return DEFAULT_RULES.concat(fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : []);
})();
function ggbDocs(voorstel) {
  const r = AI.normaliseer(voorstel);
  const decl = AI.naarDeclaratie(r);
  const index = Object.fromEntries(ALLE_REGELS.map((x) => [x.id, x]));
  const eisen = decl.goederen.map((g) => engine.requirementsFor({ type: decl.type, gn: g.gn, animo: g.animo, land: decl.landOorsprong }, ALLE_REGELS).vereisten);
  return AI.bepaalGgbDocumenten(r, eisen, (id) => index[id]);
}
const doc = (type, identificatie) => ({ type, identificatie, datumAfgifte: '07-08-2026', landAfgifte: 'IN', inrichtingOorsprong: '', verwijstNaar: '', bestand: '', zekerheid: 'hoog' });

test('GGB-documenten: garnalen India -> HC (636) en labrapport (162); factuur en B/L alleen bron', () => {
  const r = ggbDocs({ declaratieType: veld('PRD'), landOorsprong: veld('IN'), goederen: [{ gnCode: '03061792', omschrijving: 'Shrimps' }],
    documenten: [doc('HC', 'HC1'), doc('LAB', 'LAB1'), doc('COMM', 'INV-1'), doc('COMM', 'BL-1')] });
  assert.deepStrictEqual(r.documenten.map((d) => [d.type, d.opnemen, d.portbaseType]), [
    ['HC', true, 'Health certificate (636)'], ['LAB', true, 'Certified lab report (162)'],
    ['COMM', false, 'Commercial invoice (380)'], ['COMM', false, 'Commercial invoice (380)']]);
  assert.ok(/Niet gevraagd/.test(r.documenten[2].reden));
  assert.deepStrictEqual(AI.naarDeclaratie(r).documenten.map((d) => d.type), ['HC', 'LAB'], 'documentcheck kijkt alleen naar GGB-documenten');
});

test('GGB-documenten: sesamzaad India -> varianten Ver. 2019/1793', () => {
  const r = ggbDocs({ declaratieType: veld('LNV'), landOorsprong: veld('IN'), goederen: [{ gnCode: '12074090', omschrijving: 'Sesame seeds' }],
    documenten: [doc('OFFCERT', 'OC1'), doc('LAB', 'LAB1'), doc('COMM', 'INV-1')] });
  assert.deepStrictEqual(r.documenten.map((d) => [d.opnemen, d.portbaseType]), [
    [true, 'Official certificate 2019/1793 (100)'], [true, 'Certified lab report 2019/1793 (4)'], [false, 'Commercial invoice (380)']]);
  assert.ok(/Ver\. 2019\/1793/.test(r.documenten[1].reden));
});

test('GGB-documenten: "ter beoordeling" (vangstcertificaat) standaard niet opnemen', () => {
  const r = ggbDocs({ declaratieType: veld('PRD'), landOorsprong: veld('VN'), goederen: [{ gnCode: '03074399', omschrijving: 'Cuttlefish' }],
    documenten: [doc('HC', 'IMPORT.EU.VN.2026.0000001'), doc('CATCH', ''), doc('OTHER', 'LAB-TEST-01')] });
  assert.deepStrictEqual(r.documenten.map((d) => d.opnemen), [true, false, false]);
  assert.ok(/zelf aanvinken/.test(r.documenten[1].reden));
});

test('GGB-documenten: garnalen Noorwegen -> alleen HC; meegestuurd labrapport niet opnemen', () => {
  const r = ggbDocs({ declaratieType: veld('PRD'), landOorsprong: veld('NO'), goederen: [{ gnCode: '03061792', omschrijving: 'Shrimps' }],
    documenten: [doc('HC', 'HC1'), doc('LAB', 'LAB1')] });
  assert.deepStrictEqual(r.documenten.map((d) => d.opnemen), [true, false]);
});

test('GGB-documenten: keuze en type van de gebruiker blijven staan', () => {
  const r = ggbDocs({ declaratieType: veld('PRD'), landOorsprong: veld('NO'), goederen: [{ gnCode: '03061792', omschrijving: 'Shrimps' }],
    documenten: [doc('HC', 'HC1'), doc('LAB', 'LAB1')] });
  r.documenten[1].opnemen = true;
  r.documenten[0].portbaseType = 'Veterinary certificate (853)';
  r.documenten[0].portbaseTypeHandmatig = true;
  AI.bepaalGgbDocumenten(r, [[{ type: 'HC', niveau: 'verplicht', alternatieven: [], regelIds: [] }]]);
  assert.strictEqual(r.documenten[1].opnemen, true);
  assert.strictEqual(r.documenten[0].portbaseType, 'Veterinary certificate (853)');
  assert.ok(Object.values(AI.PORTBASE_DOCTYPE).every((t) => AI.PORTBASE_DOCTYPES.includes(t)), 'standaardtypes staan in de Portbase-lijst');
});

test('goederenitems = HC-regels: brutogewicht naar rato verdeeld, som exact gelijk aan HC I.26', () => {
  const regels = [['03074399', '4000', '500'], ['03074399', '1500', '200'], ['03075200', '9500', '1300']];
  const r = AI.normaliseer({ totaalBrutoGewicht: veld('22.280'), totaalNettoGewicht: veld('15000'), totaalColli: veld('2000'),
    goederen: regels.map(([gn, net, col]) => ({ gnCode: gn, nettoGewicht: net, aantalColli: col })) });
  assert.strictEqual(r.goederen.length, 3, 'niet samengevoegd');
  assert.deepStrictEqual(r.goederen.map((g) => g.brutoGewicht), ['5941.3', '2228', '14110.7']);
  assert.ok(r.waarschuwingen.some((w) => /naar rato/.test(w)));
  // Bruto per regel op het HC: niet overschrijven, wel controleren
  const r2 = AI.normaliseer({ totaalBrutoGewicht: veld('1000'), goederen: [{ gnCode: '03074399', brutoGewicht: '600', nettoGewicht: '500' }, { gnCode: '03074399', brutoGewicht: '300', nettoGewicht: '250' }] });
  assert.deepStrictEqual(r2.goederen.map((g) => g.brutoGewicht), ['600', '300']);
  assert.ok(r2.waarschuwingen.some((w) => /wijkt af van het totaal/.test(w)));
});

test('HC: altijd de IMSOC-referentie (I.2.a) als nummer, certificate reference (I.2) als verwijzing', () => {
  const doc = (x) => Object.assign({ type: 'HC', datumAfgifte: '07-08-2026', landAfgifte: 'IN', inrichtingOorsprong: '', verwijstNaar: '', bestand: 'hc.pdf', zekerheid: 'hoog' }, x);
  // AI zet de certificate reference als identificatie, maar geeft ook de IMSOC-referentie
  let r = AI.normaliseer({ documenten: [doc({ identificatie: 'EIA/VSP/2026-27/02937', imsocReferentie: 'import.eu.in.2026.0012345', certificaatReferentie: '' })] });
  assert.strictEqual(r.documenten[0].identificatie, 'IMPORT.EU.IN.2026.0012345');
  assert.strictEqual(r.documenten[0].certificaatReferentie, 'EIA/VSP/2026-27/02937');
  assert.ok(!r.waarschuwingen.some((w) => /IMSOC/.test(w)));
  // IMSOC alleen als identificatie (handmatige modus, oud formaat)
  r = AI.normaliseer({ documenten: [doc({ identificatie: 'IMPORT.EU.VN.2026.0000001' })] });
  assert.strictEqual(r.documenten[0].identificatie, 'IMPORT.EU.VN.2026.0000001');
  assert.strictEqual(r.documenten[0].imsocReferentie, 'IMPORT.EU.VN.2026.0000001');
  // Geen IMSOC-referentie, wel certificate reference: die is dan het nummer (met melding)
  r = AI.normaliseer({ documenten: [doc({ identificatie: '', imsocReferentie: '', certificaatReferentie: 'EIA/VSP/2026-27/02937' })] });
  assert.strictEqual(r.documenten[0].identificatie, 'EIA/VSP/2026-27/02937');
  assert.strictEqual(r.documenten[0].zekerheid, 'hoog');
  assert.ok(r.waarschuwingen.some((w) => /niet gevonden; de certificate reference "EIA\/VSP\/2026-27\/02937" staat als nummer/.test(w)));
  r = AI.normaliseer({ documenten: [doc({ identificatie: 'EIA/VSP/2026-27/02937' })] });
  assert.strictEqual(r.documenten[0].identificatie, 'EIA/VSP/2026-27/02937');
  // Geen IMSOC-referentie en geen certificate reference: waarschuwing en zekerheid laag
  r = AI.normaliseer({ documenten: [doc({ identificatie: '' })] });
  assert.strictEqual(r.documenten[0].zekerheid, 'laag');
  assert.ok(r.waarschuwingen.some((w) => /IMSOC-referentie \(HC vak I\.2\.a\) niet gevonden/.test(w)));
  // Andere documenten: nummer ongewijzigd
  r = AI.normaliseer({ documenten: [doc({ type: 'LAB', identificatie: 'EIA/VZ/26-27/0003572', imsocReferentie: 'IMPORT.EU.IN.2026.0012345' })] });
  assert.strictEqual(r.documenten[0].identificatie, 'EIA/VZ/26-27/0003572');
  assert.ok(AI.isImsoc('CHEDP.NL.2026.0001234') && AI.isImsoc('IMPORT.EU.IN.2026.0012345') && !AI.isImsoc('EIA/VSP/2026-27/02937'));
  assert.ok(/IMSOC/.test(AI.SYSTEM) && AI.SCHEMA.properties.documenten.items.required.includes('imsocReferentie'));
});

test('labrapport dat naar de certificate reference verwijst, verwijst correct naar het HC (IMSOC)', () => {
  const r = AI.normaliseer({ declaratieType: veld('PRD'), landOorsprong: veld('IN'),
    documenten: [{ type: 'HC', identificatie: 'IMPORT.EU.IN.2026.0012345', certificaatReferentie: 'EIA/VSP/2026-27/02937', datumAfgifte: '07-08-2026' },
      { type: 'LAB', identificatie: 'LAB-1', verwijstNaar: 'EIA/VSP/2026-27/02937', datumAfgifte: '07-08-2026' }],
    goederen: [{ gnCode: '03061792', animoCode: '206107', nettoGewicht: '100' }] });
  r.documenten.forEach((d) => { d.opnemen = true; });
  const res = engine.checkDeclaration(AI.naarDeclaratie(r), DEFAULT_RULES);
  const lab = res.items[0].vereisten.filter((v) => v.type === 'LAB')[0];
  assert.ok(lab && lab.tekst.some((t) => /Verwijst correct/.test(t)), JSON.stringify(lab));
});

test('datums op het Portbase-formulier: MM/DD/YYYY (11/29/2026) en terug', () => {
  assert.strictEqual(AI.naarPortbaseDatum('29-11-2026'), '11/29/2026');
  assert.strictEqual(AI.naarPortbaseDatum('07-08-2026', 'MM/DD/YYYY'), '08/07/2026');
  assert.strictEqual(AI.naarPortbaseDatum('2026-11-29', 'DD-MM-YYYY'), '29-11-2026');
  assert.strictEqual(AI.vanPortbaseDatum('11/29/2026'), '29-11-2026');
  assert.strictEqual(AI.vanPortbaseDatum('8/7/2026'), '07-08-2026');
  assert.strictEqual(AI.vanPortbaseDatum('29-11-2026'), '29-11-2026');
  assert.strictEqual(AI.normDatum('11/29/2026'), '29-11-2026', 'ook een Amerikaanse datum van een document');
  assert.deepStrictEqual(AI.instellingen({}).invullen, { datumFormaat: 'MM/DD/YYYY', maxWacht: 120, trefwoorden: true });
  assert.deepStrictEqual(AI.invulInstellingen({ datumFormaat: 'DD-MM-YYYY', maxWacht: '5', trefwoorden: false }), { datumFormaat: 'DD-MM-YYYY', maxWacht: 120, trefwoorden: false });
});

test('organisatie zoeken: na "No results" verder op trefwoorden', () => {
  const FILL = require('../extension/portbase-fill.js');
  FILL.instellen({ trefwoorden: true });
  const p = FILL.orgPogingen(FILL.orgZoek({ naam: 'QUANG PHU SEAFOOD IMPORT-EXPORT CO., LTD', plaats: 'Binh An' }, 'exporter', 'VN', {}));
  assert.deepStrictEqual(p.map((x) => x.type + ':' + x.term), ['NAME:QUANG PHU SEAFOOD IMPORT-EXPORT CO., LTD', 'NAME:quang phu seafood import export', 'NAME:quang phu', 'NAME:quang', 'CITY:Binh An']);
  const i = FILL.orgPogingen(FILL.orgZoek({ naam: 'Koelhuis X B.V.', erkenningsnummer: 'NL 1001 EG' }, 'inrichting', 'NL', {}));
  assert.deepStrictEqual(i.map((x) => x.type + ':' + x.term), ['APPROVAL_NUMBER:NL 1001 EG', 'APPROVAL_NUMBER:1001', 'NAME:Koelhuis X B.V.', 'NAME:koelhuis x', 'NAME:koelhuis']);
  FILL.instellen({ trefwoorden: false });
  assert.strictEqual(FILL.orgPogingen(FILL.orgZoek({ naam: 'QUANG PHU SEAFOOD CO., LTD' }, 'exporter', 'VN', {})).length, 1);
});

test('erkenningsnummer: trefwoorden zonder landcode, kolom ID voor Nederlandse inrichtingen', () => {
  const FILL = require('../extension/portbase-fill.js');
  FILL.instellen({ trefwoorden: true });
  assert.strictEqual(FILL.erkKern('3700/03447 CN'), '3700/03447');
  assert.strictEqual(FILL.erkKern('NL 527 EG'), '527');
  assert.strictEqual(FILL.erkKern('DL 1022'), '1022');
  assert.deepStrictEqual(FILL.erkTrefwoorden('3700/03447 CN'), ['3700/03447', '03447', '3700', '370003447']);
  const ex = FILL.orgPogingen(FILL.orgZoek({ naam: 'Guolian Aquatic Co., Ltd', erkenningsnummer: '3700/03447 CN' }, 'exporter', 'CN', {}));
  assert.deepStrictEqual(ex.map((x) => x.type + ':' + x.term).slice(0, 3), ['NAME:Guolian Aquatic Co., Ltd', 'APPROVAL_NUMBER:3700/03447 CN', 'APPROVAL_NUMBER:3700/03447']);
  const rij = (o, ids) => ({ textContent: o.name, querySelector: (sel) => {
    const m = sel.match(/mat-column-(\w+)/); const k = m && m[1];
    return { textContent: k === 'identificationNumber' ? (ids || '') : (o[k] || '') }; } });
  // Portbase: 3700/03447 zonder CN -> exacte treffer op de kern
  const cn = FILL.rijScore(rij({ name: 'GUOLIAN AQUATIC CO., LTD', approvalNumber: '3700/03447' }), FILL.orgZoek({ naam: 'Guolian Aquatic Co., Ltd', erkenningsnummer: '3700/03447 CN' }, 'inrichting', 'CN', {}));
  assert.ok(cn >= 85, 'naam 40 + kern 45: ' + cn);
  // Constellation Nijkerk: kolom Approval number leeg, NL 527 EG staat als 527 in kolom ID (OAI/TNT)
  const zoek = FILL.orgZoek({ naam: 'Constellation Cold Logistics Nijkerk B.V.', plaats: 'Nijkerk', erkenningsnummer: 'NL 527 EG' }, 'bestemming', 'NL', {});
  const C = { name: 'Constellation Cold Logistics Nijkerk B.V.', address: 'Gildenstraat 51', city: 'Nijkerk', approvalNumber: '', activityDepartment: 'veterinary' };
  const met = FILL.rijScore(rij(Object.assign({ activity: 'ES - establishment' }, C), ' 6534796\n527 '), zoek);
  const zonder = FILL.rijScore(rij(Object.assign({ activity: 'ES - establishment' }, C), ' 6534796\n1234 '), zoek);
  assert.strictEqual(met - zonder, 35, 'ID 527 telt als erkenningsnummer');
  assert.ok(FILL.rijScore(rij({ name: 'Iets anders B.V.', city: 'Elders' }, '6534796\n527'), zoek) >= 35, 'ook zonder naam een basis');
});

test('organisatie zoeken: umlaut ook een keer uitgeschreven (Kühne -> KUEHNE)', () => {
  const FILL = require('../extension/portbase-fill.js');
  FILL.instellen({ trefwoorden: true });
  const p = FILL.orgPogingen(FILL.orgZoek({ naam: 'Kühne + Heitz', plaats: 'Großenkneten' }, 'importer', 'DE', {}));
  assert.deepStrictEqual(p.map((x) => x.type + ':' + x.term), ['NAME:Kühne + Heitz', 'NAME:KUEHNE + HEITZ', 'NAME:kuhne', 'NAME:heitz', 'CITY:Großenkneten', 'CITY:GROSSENKNETEN']);
  FILL.instellen({ trefwoorden: false });
  assert.deepStrictEqual(FILL.orgPogingen(FILL.orgZoek({ naam: 'Kühne + Heitz' }, 'importer', 'DE', {})).map((x) => x.term), ['Kühne + Heitz', 'KUEHNE + HEITZ']);
  assert.strictEqual(FILL.orgPogingen(FILL.orgZoek({ naam: 'Koelhuis X B.V.' }, 'importer', 'NL', {})).length, 1);
  // Een regel "KUEHNE + HEITZ" telt als exacte naam voor zoeknaam "Kühne + Heitz".
  const rij = { textContent: 'KUEHNE + HEITZ', querySelector: () => null, querySelectorAll: () => [] };
  assert.ok(FILL.rijScore(rij, { type: 'NAME', term: 'Kühne + Heitz', naam: 'Kühne + Heitz' }) >= 40);
});

console.log('\n' + passed + ' AI-tests geslaagd');
