'use strict';
/* Tests voor js/geheugen.js (Smart Memory): profielen, leren, toepassen, aandachtspunten, sjablonen. */
const assert = require('assert');
const AI = require('../js/ggb-ai.js');
const G = require('../js/geheugen.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

const v = (waarde, zekerheid = 'hoog', bron = 'HC') => ({ waarde, bron, zekerheid });
// Vaste route: kip uit China naar een coldstore in Nijkerk.
function voorstel(x = {}) {
  return AI.normaliseer(Object.assign({
    declaratieType: v('PRD'), bol: v('COSU6400000001'), grenscontrolepost: v('Rotterdam (NLRTM1)', 'middel'),
    landOorsprong: v('CN'), landLading: v('CN'), gecertificeerdVoor: v('Human consumption'), transportconditie: v('Frozen'),
    vervoermiddel: v('Vessel'), vervoermiddelNaam: v('CMA CGM TEST'), vervoermiddelNationaliteit: v('CN', 'laag'),
    exporteur: { naam: 'Zhucheng Delicate Food Co., Ltd', adres: 'Zhucheng', plaats: 'Zhucheng', land: 'CN', erkenningsnummer: '3700/03447 CN', bron: 'HC I.1', zekerheid: 'hoog' },
    importeur: { naam: 'Eurofoodlink B.V.', plaats: 'Rotterdam', land: 'NL', bron: 'HC I.5', zekerheid: 'hoog' },
    plaatsBestemming: { naam: 'Constellation Cold Logistics Nijkerk B.V.', adres: 'Gildenstraat 51', plaats: 'Nijkerk', land: 'NL', erkenningsnummer: '', bron: 'HC I.12', zekerheid: 'middel' },
    documenten: [{ type: 'HC', identificatie: 'IMPORT.EU.CN.2026.0000001', bestand: 'hc.pdf', zekerheid: 'hoog' }],
    goederen: [{ gnCode: '16023219', omschrijving: 'Cooked chicken', nettoGewicht: '20000', brutoGewicht: '21000', aantalColli: '2000', verpakkingstype: 'Carton', animoCode: '', erkenningsnummer: '3700/03447', zekerheid: 'hoog' }],
    waarschuwingen: ['Brutogewicht per goederenitem berekend naar rato van het nettogewicht (totaal 21000 kg, HC I.26); controleer of dat zo gewenst is.']
  }, x));
}
// Wat de gebruiker in elk dossier aanpast: erkenningsnummer van de coldstore en de vlaggenstaat van het schip.
function corrigeer(r) {
  const d = G.kopie(r);
  d.plaatsBestemming.erkenningsnummer = 'NL 527 EG';
  d.vervoermiddelNationaliteit.waarde = 'MT';
  return d;
}
const akkoordAlles = (r) => Object.fromEntries(r.waarschuwingen.map((t) => [t, 'akkoord']));

test('profiel: exporteur -> plaats van bestemming, zonder rechtsvorm', () => {
  const p = G.profiel(voorstel());
  assert.strictEqual(p.sleutel, 'zhucheng delicate food > constellation cold logistics nijkerk');
  assert.strictEqual(p.ontvanger, 'Constellation Cold Logistics Nijkerk B.V.');
  assert.strictEqual(G.profiel(AI.normaliseer({})), null, 'zonder namen geen profiel');
});

test('één correctie is nog geen regel; na twee wel (en alleen als de AI het anders had)', () => {
  const g = G.leeg();
  const r1 = voorstel();
  G.leer(g, { id: 'a', tijd: 1, origineel: r1, definitief: corrigeer(r1), triage: {}, dossierNr: '426248' });
  assert.deepStrictEqual(G.suggesties(g, voorstel()).map((s) => s.sleutel), [], 'na 1 dossier niets');
  const r2 = voorstel();
  G.leer(g, { id: 'b', tijd: 2, origineel: r2, definitief: corrigeer(r2), triage: {}, dossierNr: '426249' });
  const r3 = voorstel();
  const res = G.pasToe(g, r3);
  assert.deepStrictEqual(res.toegepast.map((s) => s.sleutel + '=' + s.naar).sort(), ['plaatsBestemming.erkenningsnummer=NL 527 EG', 'vlag|cma cgm test=MT']);
  assert.strictEqual(r3.plaatsBestemming.erkenningsnummer, 'NL 527 EG');
  assert.strictEqual(r3.vervoermiddelNationaliteit.waarde, 'MT');
  assert.strictEqual(r3.vervoermiddelNationaliteit.bron, 'Smart Memory');
  assert.strictEqual(res.profiel.aantal, 2);
  // Grenspost was nooit gecorrigeerd: het geheugen laat die met rust
  assert.ok(!res.toegepast.some((s) => s.sleutel === 'grenscontrolepost'));
});

test('vlaggenstaat per schip geldt over profielen heen; nieuwe zending van een ander profiel', () => {
  const g = G.leeg();
  for (const id of ['a', 'b']) { const r = voorstel(); G.leer(g, { id, tijd: 1, origineel: r, definitief: corrigeer(r) }); }
  const ander = voorstel({ exporteur: { naam: 'Andere Exporteur Ltd', land: 'CN' } });
  const res = G.pasToe(g, ander);
  assert.deepStrictEqual(res.toegepast.map((s) => s.sleutel), ['vlag|cma cgm test']);
  assert.strictEqual(res.profiel.aantal, 0);
});

test('geen regel als de gebruiker wisselt (minder dan 75%) of de regel uitzet', () => {
  const g = G.leeg();
  ['NL 527 EG', 'NL 527 EG', 'NL 100 EG', 'NL 200 EG'].forEach((erk, i) => {
    const r = voorstel(), d = G.kopie(r);
    d.plaatsBestemming.erkenningsnummer = erk;
    G.leer(g, { id: 'x' + i, tijd: i, origineel: r, definitief: d });
  });
  assert.ok(!G.suggesties(g, voorstel()).some((s) => s.sleutel === 'plaatsBestemming.erkenningsnummer'), '2 van 4 is te weinig');
  const g2 = G.leeg();
  for (const id of ['a', 'b']) { const r = voorstel(); G.leer(g2, { id, origineel: r, definitief: corrigeer(r) }); }
  G.zetUit(g2, G.profiel(voorstel()).sleutel, 'plaatsBestemming.erkenningsnummer', true);
  assert.deepStrictEqual(G.suggesties(g2, voorstel()).map((s) => s.sleutel), ['vlag|cma cgm test']);
});

test('GN-gebonden correcties: de sleutel komt van de AI-GN, ook als de gebruiker de GN-code aanpast', () => {
  const g = G.leeg();
  for (const id of ['a', 'b']) {
    const r = voorstel(), d = G.kopie(r);
    d.goederen[0].gnCode = '16023230'; d.goederen[0].animoCode = '160232';
    G.leer(g, { id, origineel: r, definitief: d });
  }
  const r = voorstel();
  const res = G.pasToe(g, r);
  assert.strictEqual(r.goederen[0].gnCode, '16023230');
  assert.ok(res.toegepast.some((s) => s.sleutel === 'goed:16023219.animoCode' && s.naar === '160232'));
});

test('dossier opnieuw leren (zelfde id) telt niet dubbel', () => {
  const g = G.leeg();
  const r = voorstel();
  G.leer(g, { id: 'a', origineel: r, definitief: corrigeer(r) });
  G.leer(g, { id: 'a', origineel: r, definitief: corrigeer(r) });
  assert.strictEqual(g.dossiers.length, 1);
  assert.strictEqual(G.suggesties(g, voorstel()).length, 0);
});

test('aandachtspunten: sleutel zonder getallen, ernst, eerder akkoord, kritiek nooit automatisch', () => {
  assert.strictEqual(G.waarschuwingSleutel('Som van de colli (2000) wijkt af van het totaal op het HC (2100).'), G.waarschuwingSleutel('Som van de colli (40) wijkt af van het totaal op het HC (44).'));
  assert.strictEqual(G.niveau('Containernummer X heeft een ongeldig controlecijfer (ISO 6346)'), 'kritiek');
  assert.strictEqual(G.niveau('Brutogewicht per goederenitem berekend naar rato van het nettogewicht'), 'info');
  assert.strictEqual(G.niveau('Som van de colli (40) wijkt af van het totaal op het HC (44).'), 'let');
  assert.strictEqual(G.niveau('Som van de brutogewichten per regel (24284.14 kg) wijkt -0.10 kg af van het totaal brutogewicht (24284.24 kg, HC I.26).'), 'kritiek');
  assert.strictEqual(G.niveau('Goederenitem 2: brutogewicht (1000) is kleiner dan het nettogewicht (1882.44); niet gebruikt, de regel wordt naar rato berekend.'), 'kritiek');
  assert.strictEqual(G.niveau('Goederenitem 3: brutogewicht "-3127.70" is negatief; niet gebruikt, de regel wordt naar rato berekend.'), 'kritiek');
  assert.strictEqual(G.niveau('Brutogewicht van goederenitem 2, 3, 4 berekend naar rato van het nettogewicht: 12187.74 kg'), 'info');
  const KRIT = 'Goederenitem 1: nettogewicht (2) is groter dan brutogewicht (1).';
  const g = G.leeg();
  for (const id of ['a', 'b', 'c']) {
    const r = voorstel(); r.waarschuwingen.push(KRIT);
    G.leer(g, { id, origineel: r, definitief: r, triage: akkoordAlles(r) });
  }
  const r = voorstel(); r.waarschuwingen.push(KRIT);
  const t = G.triageAdvies(g, r);
  const info = r.waarschuwingen[0];
  assert.strictEqual(t[info].auto, true, 'info 3x akkoord -> voorgevinkt');
  assert.strictEqual(t[info].akkoord, 3);
  assert.strictEqual(t[KRIT].auto, false, 'kritiek nooit vanzelf');
  assert.strictEqual(t[KRIT].akkoord, 3);
  G.zetAltijdAkkoord(g, G.profiel(r).sleutel, KRIT, true);
  assert.strictEqual(G.triageAdvies(g, r)[KRIT].auto, true, 'expliciet altijd akkoord');
});

test('recente patronen en sjabloon voor het startscherm', () => {
  const g = G.leeg();
  for (const [id, nr] of [['a', '426248'], ['b', '426249']]) { const r = voorstel(); G.leer(g, { id, tijd: id === 'a' ? 1 : 2, origineel: r, definitief: corrigeer(r), dossierNr: nr }); }
  const ander = voorstel({ exporteur: { naam: 'Quang Phu Seafood', land: 'VN' } });
  G.leer(g, { id: 'c', tijd: 3, origineel: ander, definitief: ander });
  const p = G.recentePatronen(g);
  assert.deepStrictEqual(p.map((x) => x.exporteur + ':' + x.aantal), ['Quang Phu Seafood:1', 'Zhucheng Delicate Food Co., Ltd:2']);
  assert.deepStrictEqual(p[1].dossierNrs, ['426249', '426248']);
  // Sjabloon: vaste gegevens wel, zendinggebonden gegevens (B/L, gewichten, documenten) niet
  const s = AI.normaliseer(G.dossierOpId(g, 'b').sjabloon);
  assert.strictEqual(s.plaatsBestemming.erkenningsnummer, 'NL 527 EG');
  assert.strictEqual(s.transportconditie.waarde, 'Frozen');
  assert.strictEqual(s.bol.waarde, '');
  assert.strictEqual(s.goederen[0].gnCode, '16023219');
  assert.strictEqual(s.goederen[0].nettoGewicht, '');
  assert.strictEqual(s.documenten.length, 0);
});

test('vergeten en samenvoegen (geheugen van een collega)', () => {
  const g = G.leeg(), h = G.leeg();
  const r = voorstel();
  G.leer(g, { id: 'a', tijd: 1, origineel: r, definitief: r });
  G.leer(h, { id: 'a', tijd: 1, origineel: r, definitief: r });
  G.leer(h, { id: 'b', tijd: 2, origineel: r, definitief: r });
  assert.strictEqual(G.voegSamen(g, JSON.parse(JSON.stringify(h))), 1);
  assert.deepStrictEqual(g.dossiers.map((d) => d.id), ['b', 'a']);
  G.vergeetProfiel(g, G.profiel(r).sleutel);
  assert.strictEqual(g.dossiers.length, 0);
  assert.deepStrictEqual(G.laad({ versie: 99 }), G.leeg(), 'onbekende versie: leeg');
});

/* ---------------- organisaties (Portbase-keuzes) ---------------- */

const PLAK = ['Name', 'Address', 'Postal code', 'City', 'Approval number', 'ID type', 'ID number', 'Activity', 'Section', 'Chapter', '',
  'KUHNE + HEITZ HOLLAND B.V.', 'Wilgenbos 20', '3311 JX', 'Dordrecht', 'OAI', 'EOR', '2404021', 'NL806694324', 'IM - importer', 'OTH-OPER', 'veterinary'].join('\n');
const KUHNE = { naam: 'KUHNE + HEITZ HOLLAND B.V.', adres: 'Wilgenbos 20', postcode: '3311 JX', plaats: 'Dordrecht', erkenningsnummer: '',
  idType: 'OAI EOR', idNummer: '2404021 NL806694324', activiteit: 'IM - importer', sectie: 'OTH-OPER', hoofdstuk: 'veterinary' };

test('organisatie: regel uit Portbase plakken (kolommen onder elkaar, twee ID\'s; of tabelrij met tabs)', () => {
  assert.deepStrictEqual(G.rijUitTekst(PLAK), KUHNE);
  const tab = 'KUHNE + HEITZ HOLLAND B.V.\tWilgenbos 20\t3311 JX\tDordrecht\t\tOAI EOR\t2404021 NL806694324\tIM - importer\tOTH-OPER\tveterinary';
  assert.deepStrictEqual(G.rijUitTekst(tab), KUHNE);
  // Met erkenningsnummer en zonder postcode
  const r = G.rijUitTekst('Quang Phu Seafood\nLand plot 1358\nBinh An\nDL 1022\nOAI\n1\nPP - establish_pp\nFFP\nfood');
  assert.strictEqual(r.plaats, 'Binh An'); assert.strictEqual(r.erkenningsnummer, 'DL 1022'); assert.strictEqual(r.idNummer, '1'); assert.strictEqual(r.activiteit, 'PP - establish_pp');
});

test('organisatie: "Kühne + Heitz" op het HC = de geleerde Portbase-regel (per rol)', () => {
  const g = G.leeg();
  const res = G.leerOrganisatie(g, { rol: 'importer', naam: 'Kühne + Heitz', land: 'NL', rij: KUHNE });
  assert.ok(res.nieuw);
  for (const naam of ['Kühne + Heitz', 'KUEHNE + HEITZ', 'Kuhne+Heitz Holland BV', 'KUHNE + HEITZ HOLLAND B.V.']) {
    const e = G.vindOrganisatie(g, naam, 'importer');
    assert.ok(e, naam);
    assert.strictEqual(e.rij.idNummer, '2404021 NL806694324');
  }
  assert.strictEqual(G.vindOrganisatie(g, 'Kühne + Heitz', 'bestemming'), null, 'andere rol: niet geleerd');
  assert.strictEqual(G.vindOrganisatie(g, 'Heitz', 'importer'), null, 'te kort / ander begin');
  assert.strictEqual(G.vindOrganisatie(g, 'Kühne + Nagel', 'importer'), null);
  // Nog een keer gekozen: geen dubbele regel, teller omhoog
  G.leerOrganisatie(g, { rol: 'importer', naam: 'Kuehne + Heitz Holland', rij: KUHNE });
  assert.strictEqual(g.organisaties.length, 1);
  assert.strictEqual(g.organisaties[0].keer, 2);
});

test('organisatie: dezelfde regel herkennen in Portbase (naam, activiteit, ID)', () => {
  assert.ok(G.zelfdeRij(KUHNE, Object.assign({}, KUHNE, { idType: 'OAI', idNummer: '2404021' })));
  assert.ok(!G.zelfdeRij(KUHNE, Object.assign({}, KUHNE, { activiteit: 'ES - establishment' })), 'zelfde bedrijf, andere activiteit');
  assert.ok(!G.zelfdeRij(KUHNE, Object.assign({}, KUHNE, { plaats: 'Rotterdam', idNummer: '2404099' })), 'zelfde naam, andere vestiging');
});

test('organisatie: andere regel kiezen voor dezelfde naam vervangt de oude (correctie)', () => {
  const g = G.leeg();
  G.leerOrganisatie(g, { rol: 'importer', naam: 'Kühne + Heitz', rij: Object.assign({}, KUHNE, { plaats: 'Rotterdam', idNummer: '2404099', postcode: '3000 AA' }) });
  G.leerOrganisatie(g, { rol: 'importer', naam: 'Kühne + Heitz', rij: KUHNE });
  assert.strictEqual(g.organisaties.length, 1);
  assert.strictEqual(G.vindOrganisatie(g, 'Kühne + Heitz', 'importer').rij.plaats, 'Dordrecht');
});

test('organisatie: bewaard in het geheugen, samenvoegen met dat van een collega', () => {
  const g = G.leeg();
  G.leerOrganisatie(g, { rol: 'importer', naam: 'Kühne + Heitz', rij: KUHNE });
  const kopie = G.laad(JSON.parse(JSON.stringify(g)));
  assert.strictEqual(kopie.organisaties.length, 1);
  assert.deepStrictEqual(G.laad({ versie: 1, dossiers: [] }).organisaties, [], 'ouder geheugen zonder organisaties');
  const ander = G.leeg();
  G.voegSamen(ander, g);
  G.voegSamen(ander, g);
  assert.strictEqual(ander.organisaties.length, 1, 'niet dubbel');
});

test('invuller: geleerde regel wint in het Portbase-venster', () => {
  const FILL = require('../extension/portbase-fill.js');
  const g = G.leeg();
  G.leerOrganisatie(g, { rol: 'importer', naam: 'Kühne + Heitz', land: 'NL', rij: KUHNE });
  FILL.instellen({ geheugen: g });
  const zoek = FILL.orgZoek({ naam: 'Kühne + Heitz' }, 'importer', 'NL', {});
  assert.strictEqual(zoek.geleerd.naam, 'KUHNE + HEITZ HOLLAND B.V.');
  assert.strictEqual(FILL.orgPogingen(zoek)[0].term, 'KUHNE + HEITZ HOLLAND B.V.', 'eerst op de Portbase-naam');
  const cellen = (o) => ({ textContent: o.name, querySelector: (sel) => { const k = sel.replace('.mat-column-', ''); return k in o ? { textContent: o[k] } : null; }, querySelectorAll: () => [] });
  const rij = (x) => cellen(Object.assign({ name: KUHNE.naam, address: 'Wilgenbos 20', postalCode: '3311 JX', city: 'Dordrecht', approvalNumber: '', identificationType: 'OAI EOR', identificationNumber: '2404021 NL806694324', activity: 'IM - importer', section: 'OTH-OPER', activityDepartment: 'veterinary' }, x));
  const goed = FILL.rijScore(rij({}), zoek), andere = FILL.rijScore(rij({ city: 'Rotterdam', postalCode: '3000 AA', identificationNumber: '2404099' }), zoek);
  assert.ok(goed >= 1000 && andere < 100, goed + ' / ' + andere);
  FILL.instellen({ geheugen: null });
});

console.log('\n' + passed + ' geheugen-tests geslaagd');
