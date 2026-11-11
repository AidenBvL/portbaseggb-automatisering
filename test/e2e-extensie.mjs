/*
 * End-to-end test van de extensie in Chromium (Playwright):
 *  - laadt de uitgepakte extensie;
 *  - serveert test/fixtures/portbase-new-declaration.html op de Portbase-URL;
 *  - beantwoordt api.anthropic.com met een vast AI-antwoord (geen echte aanroep);
 *  - uploadt een HC, klikt "Uitlezen met AI" en "Invullen in Portbase";
 *  - controleert de ingevulde formuliervelden.
 *
 * Draaien: PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node test/e2e-extensie.mjs
 * (vereist Playwright + Chromium; niet onderdeel van de gewone tests)
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const fixture = fs.readFileSync(path.join(here, 'fixtures', 'portbase-new-declaration.html'), 'utf8');
const URL_PB = 'https://food-and-consumer-products.pcs.portbase.com/declarations/new';

const v = (waarde, zekerheid = 'hoog', bron = 'HC') => ({ waarde, bron, zekerheid });
const AI_JSON = {
  declaratieType: v('PRD'), bol: v('HLCUMA3260712342', 'hoog', 'B/L'), bestemming: v('Import', 'middel'),
  exporteur: { naam: 'GHAN MARINE PRODUCTS', adres: 'Kakinada', land: 'IN', bron: 'HC I.1', zekerheid: 'hoog' },
  importeur: { naam: 'EUROFOODLINK B.V.', adres: 'Rotterdam', land: 'NL', bron: 'HC I.5', zekerheid: 'hoog' },
  grenscontrolepost: v('Rotterdam (NLRTM1)', 'middel'), plaatsBestemming: v('KOELHUIS ONBEKEND, Rotterdam'),
  landOorsprong: v('IN'), landLading: v('IN'), gecertificeerdVoor: v('Human consumption'), transportconditie: v('Frozen'),
  vervoermiddel: v('Vessel'), vervoermiddelNaam: v('MSC ANNA'), vervoermiddelNationaliteit: v('PA'),
  aankomstDatum: v('26-09-2026', 'laag', 'Extra info'), aankomstTijd: v('07:00', 'laag'),
  containers: [{ containernummer: 'HLBU9066045', zegelnummer: 'EIA123', bron: 'HC' }],
  documenten: [
    { type: 'HC', identificatie: 'EIA/VSP/2026-27/02937', datumAfgifte: '07-08-2026', landAfgifte: 'IN', inrichtingOorsprong: '', verwijstNaar: '', bestand: 'hc.pdf', zekerheid: 'hoog' },
    { type: 'LAB', identificatie: 'EIA/VZ/26-27/0003572', datumAfgifte: '07-08-2026', landAfgifte: 'IN', inrichtingOorsprong: '', verwijstNaar: 'EIA/VSP/2026-27/02937', bestand: 'hc.pdf', zekerheid: 'hoog' },
    { type: 'COMM', identificatie: 'INV-2026-0815', datumAfgifte: '05-08-2026', landAfgifte: 'IN', inrichtingOorsprong: '', verwijstNaar: '', bestand: 'hc.pdf', zekerheid: 'hoog' },
    { type: 'COMM', identificatie: 'HLCUMA3260712342', datumAfgifte: '12-08-2026', landAfgifte: 'IN', inrichtingOorsprong: '', verwijstNaar: '', bestand: 'hc.pdf', zekerheid: 'hoog' }
  ],
  goederen: [
    { gnCode: '03061792', omschrijving: 'Frozen shrimps (Penaeus vannamei)', brutoGewicht: '21516', nettoGewicht: '13447.5', aantalColli: '1600', verpakkingstype: 'Carton', batchnummer: 'L123', aanvullendeEenheden: '', erkenningsnummer: '1234', containernummer: 'HLBU9066045', wetenschappelijkeNaam: 'Penaeus vannamei', aardProduct: 'Farmed, frozen', bron: 'HC', zekerheid: 'hoog' },
    { gnCode: '03061791', omschrijving: 'Frozen shrimps (Penaeus monodon)', brutoGewicht: '500', nettoGewicht: '400', aantalColli: '40', verpakkingstype: 'Carton', batchnummer: 'L124', aanvullendeEenheden: '', erkenningsnummer: '1234', containernummer: 'HLBU9066045', wetenschappelijkeNaam: 'Penaeus monodon', aardProduct: 'Wild caught, frozen', bron: 'HC', zekerheid: 'hoog' }
  ],
  waarschuwingen: ['Aankomstdatum niet in de documenten; overgenomen uit extra info.']
};

function sseBody(json) {
  const tekst = JSON.stringify(json);
  const ev = [
    { type: 'message_start', message: { id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5000, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: tekst } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 900 } },
    { type: 'message_stop' }
  ];
  return ev.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

const profiel = fs.mkdtempSync(path.join(os.tmpdir(), 'ggb-e2e-'));
const context = await chromium.launchPersistentContext(profiel, {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${repo}`, `--load-extension=${repo}`],
});

let apiVerzoek = null;
await context.route('https://api.anthropic.com/**', async (route) => {
  apiVerzoek = JSON.parse(route.request().postData());
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sseBody(AI_JSON) });
});
await context.route('https://food-and-consumer-products.pcs.portbase.com/**', (route) =>
  route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ 'ggb.ai': { apiKey: 'sk-test', model: 'claude-opus-5-5', effort: 'high' } }, r)));

  const page = await context.newPage();
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  await page.goto(URL_PB);
  await page.locator('#ggb-documentcheck-host').waitFor({ state: 'attached' });

  await page.locator('#tab-ai').click();
  await page.locator('#file').setInputFiles({ name: 'hc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%test\n') });
  await page.locator('#ai-run').click();
  await page.locator('#ai-fill').waitFor({ timeout: 30000 });

  assert.ok(apiVerzoek, 'API-verzoek verstuurd');
  assert.strictEqual(apiVerzoek.model, 'claude-opus-5-5');
  assert.strictEqual(apiVerzoek.messages[0].content[0].type, 'document');
  assert.strictEqual(apiVerzoek.messages[0].content[0].title, 'hc.pdf');

  // Alleen HC en labrapport in de GGB (regels garnalen India); factuur en B/L alleen bron
  const samenvatting = await page.locator('#doc-samenvatting').innerText();
  assert.ok(/In de GGB: Gezondheidscertificaat, Gecertificeerd laboratoriumrapport \(2 van 4\)/.test(samenvatting), samenvatting);
  assert.ok(await page.locator('input[data-opnemen="0"]').isChecked());
  assert.ok(!(await page.locator('input[data-opnemen="2"]').isChecked()));
  assert.strictEqual(await page.locator('select[data-doctype="1"]').inputValue(), 'Certified lab report (162)');
  const check = await page.locator('#ai-check').innerText();
  assert.ok(/Gezondheidscertificaat/i.test(check), 'documentcheck toont HC');

  // Correctie door de gebruiker in het voorstel
  await page.locator('input[data-pad="vervoermiddelNaam.waarde"]').fill('MSC ANNA / IMO 9000000');

  await page.locator('#ai-fill').click();
  await page.locator('#ai-verslag h3').waitFor({ timeout: 60000 });
  const verslag = await page.locator('#ai-verslag').innerText();

  const waarde = (sel, n = 0) => page.locator(sel).nth(n).inputValue();
  const tekst = (sel, n = 0) => page.locator(sel).nth(n).innerText();
  const keuze = (sel, n = 0) => tekst(sel + ' .mat-mdc-select-value', n);
  assert.ok(await page.locator('input[name="goodsClassificationCode"][value="PRD"]').isChecked(), 'CHED-P gekozen');
  assert.strictEqual(await waarde('app-form-general [data-test="bill-of-lading-number"]'), 'HLCUMA3260712342');
  assert.strictEqual(await keuze('[data-test="purpose-code"]'), 'Import');
  assert.strictEqual(await waarde('#countryOfOriginUnCode'), 'IN - India');
  assert.strictEqual(await waarde('app-form-general #countryOfLoadingUnCode'), 'IN - India');
  assert.strictEqual(await keuze('[data-test="goods-intended-use-code"]'), 'Human consumption');
  assert.strictEqual(await keuze('[data-test="transport-conditions-code"]'), 'Frozen');
  assert.strictEqual(await keuze('[data-test="arrival-means-of-transport-mode"]'), 'Sea', 'Vessel -> Sea');
  assert.strictEqual(await waarde('[data-test="arrival-means-of-transport-identification"]'), 'MSC ANNA / IMO 9000000');
  assert.strictEqual(await waarde('[data-test="arrival-means-of-transport-nationality-un-code"]'), 'PA - Panama');
  assert.strictEqual(await waarde('app-form-means-of-transport-before-border [data-test="arrival-date-time-estimated"]'), '26-09-2026');
  assert.strictEqual(await waarde('app-form-means-of-transport-before-border [data-test="start-time"]'), '07:00');
  // Verborgen secties met dezelfde data-test-namen blijven onaangeroerd
  assert.strictEqual(await waarde('app-form-means-of-transport-after-border [data-test="start-time"]'), '');
  for (const sel of ['app-form-transit [data-test="country-of-loading-un-code"]', 'app-form-transhipment [data-test="country-of-loading-un-code"]', 'app-form-transhipment #billOfLadingNumber']) {
    assert.strictEqual(await waarde(sel), '', sel + ' moet leeg blijven');
  }
  assert.strictEqual(await waarde('input[formcontrolname="equipmentNumber"]'), 'HLBU9066045');
  assert.strictEqual(await waarde('input[formcontrolname="sealNumber"]'), 'EIA123');
  // Documenten: tweede kaart via "Add document"
  assert.strictEqual(await page.locator('app-form-documents form > mat-card').count(), 2);
  assert.strictEqual(await keuze('[data-test="document-type"]', 0), 'Health certificate (636)');
  assert.strictEqual(await keuze('[data-test="document-type"]', 1), 'Certified lab report (162)');
  assert.strictEqual(await waarde('[data-test="document-number"]', 1), 'EIA/VZ/26-27/0003572');
  assert.strictEqual(await waarde('[data-test="document-date-of-issue"]', 0), '07-08-2026');
  assert.strictEqual(await waarde('[data-test="document-country-un-code-of-issue"]', 1), 'IN - India');
  assert.strictEqual(await tekst('app-form-documents .file-name', 0), 'hc.pdf', 'HC geüpload in documentregel');
  // Goederen: twee items
  assert.strictEqual(await page.locator('app-form-goods-items form > mat-card').count(), 2);
  assert.strictEqual(await waarde('[data-test="goods-description"]', 1), 'Frozen shrimps (Penaeus monodon)');
  assert.strictEqual(await waarde('[data-test="gross-weight"]', 0), '21516');
  assert.strictEqual(await waarde('[data-test="nett-weight"]', 0), '13447.5');
  assert.strictEqual(await waarde('[data-test="packaging-number-of-packages"]', 0), '1600');
  assert.strictEqual(await keuze('[data-test="packaging-package-type"]', 0), 'Carton');
  assert.strictEqual(await waarde('input[formcontrolname="batchNumber"]', 1), 'L124');
  // Dialoogvelden: niet automatisch gekozen, wel "Zoek in Portbase" in het verslag
  assert.ok(/handmatig/.test(verslag) && /GHAN MARINE PRODUCTS/.test(verslag) && /03061792/.test(verslag));
  assert.strictEqual(await page.locator('mat-dialog-container').count(), 0, 'geen dialoog vanzelf geopend');
  const zoekKnoppen = page.locator('#ai-verslag button[data-dialoog]');
  assert.ok(await zoekKnoppen.count() >= 6, 'zoekknoppen voor exporteur, importeur, BCP, plaats, GN-codes, erkenningsnummer');
  const dlg = page.locator('mat-dialog-container');
  async function zoek(rijTekst, n = 0) {
    const li = page.locator('#ai-verslag li', { hasText: rijTekst }).nth(n);
    await li.locator('button[data-dialoog]').click();
    await li.locator('.dlg-melding').waitFor({ timeout: 20000 });
    return li.locator('.dlg-melding').innerText();
  }
  async function sluitDialoog() { await dlg.locator('[data-test="cancel"]').click(); await dlg.waitFor({ state: 'detached' }); }

  // Exporteur: land IN gekozen, op naam gezocht, unieke treffer aangevinkt (niet "GHAN MARINE EXPORTS")
  let melding = await zoek('Exporter (I.1)');
  assert.ok(/aangevinkt: GHAN MARINE PRODUCTS, KAKINADA/.test(melding), melding);
  assert.strictEqual(await dlg.locator('[data-test="search-country"]').inputValue(), 'IN - India');
  assert.strictEqual(await dlg.locator('[data-test="search-term"]').inputValue(), 'GHAN MARINE PRODUCTS');
  assert.ok(await dlg.locator('[data-test="search-type"] input[value="NAME"]').isChecked());
  assert.ok(await dlg.locator('input[name="org-keuze"][value="GHAN MARINE PRODUCTS"]').isChecked());
  await sluitDialoog();

  // Importeur: exacte naam wint van "EUROFOODLINK LOGISTICS B.V."; land NL
  melding = await zoek('Importer (I.6)');
  assert.ok(/aangevinkt: EUROFOODLINK B\.V\./.test(melding), melding);
  assert.strictEqual(await dlg.locator('[data-test="search-country"]').inputValue(), 'NL - Netherlands');
  assert.ok(await dlg.locator('input[name="org-keuze"][value="EUROFOODLINK B.V."]').isChecked());
  // Gebruiker klikt zelf Save -> keuze komt in het formulier
  await dlg.locator('[data-test="save"]').click();
  assert.strictEqual(await page.locator('[data-test="organisation-dialog-importer"]').innerText(), 'EUROFOODLINK B.V.');

  // Erkenningsnummer van goederenitem 1: zoektype Approval number
  melding = await zoek('Activity / approval number (I.15)');
  assert.ok(/aangevinkt: GHAN MARINE PRODUCTS/.test(melding), melding);
  assert.ok(await dlg.locator('[data-test="search-type"] input[value="APPROVAL_NUMBER"]').isChecked());
  assert.strictEqual(await dlg.locator('[data-test="search-term"]').inputValue(), '1234');
  await sluitDialoog();

  // Geen treffer -> duidelijke melding, niets aangevinkt
  melding = await zoek('Place of destination');
  assert.ok(/geen resultaten/.test(melding), melding);
  await sluitDialoog();

  // Grenscontrolepost: land staat al op NL, rij met code NLRTM1 wordt aangevinkt; gebruiker klikt Save
  melding = await zoek('Border control post');
  assert.ok(/aangevinkt: Rotterdam\s*NLRTM1/.test(melding), melding);
  assert.strictEqual(await dlg.locator('mat-row.mat-mdc-row-selected .mat-column-code').innerText(), 'NLRTM1');
  await dlg.locator('[data-test="save"]').click();
  assert.strictEqual(await page.locator('[data-test="border-control-post-dialog"]').innerText(), 'Rotterdam');

  // GN-code item 1: 8 cijfers geven niets, 6 cijfers wel; unieke soort -> aangevinkt; browser-autofill in Scientific name gewist
  melding = await zoek('GN-code (I.31)', 0);
  assert.ok(/aangevinkt: 030617 · Penaeus vannamei · Visserijproducten \(aquacultuur\)/.test(melding), melding);
  assert.strictEqual(await dlg.locator('[data-test="name"]').inputValue(), '030617');
  assert.strictEqual(await dlg.locator('[data-test="scientific-name"]').inputValue(), '');
  const gekozenRij = dlg.locator('[data-test="gn-codes-list-row"]', { has: page.locator('input:checked') });
  assert.strictEqual(await gekozenRij.count(), 1);
  assert.ok(/Penaeus vannamei/.test(await gekozenRij.innerText()));
  await dlg.locator('[data-test="save"]').click();
  assert.ok(/030617 Visserijproducten \(aquacultuur\)/.test(await page.locator('[data-test="gn-code-dialog"]').first().innerText()));

  // GN-code item 2: twee producttypes voor P. monodon -> niets aangevinkt, keuze + HC-omschrijving in de melding
  melding = await zoek('GN-code (I.31)', 1);
  assert.ok(/2 regels gemarkeerd; kies het producttype: Visserijproducten \(aquacultuur\) · Visserijproducten \(wild gevangen\) \(HC: Wild caught, frozen\)/.test(melding), melding);
  assert.strictEqual(await dlg.locator('[data-test="gn-codes-list-row"] input:checked').count(), 0);
  await sluitDialoog();

  // Inspectiecentrum vult de declarant zelf in: geen regel in het verslag, knop niet aangeraakt
  assert.ok(!/Inspection centre/.test(verslag), 'inspectiecentrum hoort niet in het verslag');

  // Nooit opslaan of verzenden
  const klikken = await page.evaluate(() => window.__klikken);
  assert.ok(!klikken.some((k) => /^(save|send)-declaration$/.test(k)), 'Save/Send van de declaratie niet aangeklikt: ' + klikken.join(','));
  assert.ok(!klikken.includes('inspection-centre-dialog'), 'inspectiecentrum niet aangeraakt');
  assert.strictEqual(klikken.filter((k) => k === 'save').length, 3, 'dialoog-Save alleen door de gebruiker (3x in deze test)');
  assert.deepStrictEqual(fouten, []);

  await page.screenshot({ path: path.join(os.tmpdir(), 'ggb-e2e.png'), fullPage: false });
  console.log(verslag.split('\n').slice(0, 3).join('\n'));

  /* ================= Instellingenpagina ================= */
  const extId = new URL(sw.url()).host;
  let openaiVerzoek = null;
  await context.route('https://api.openai.com/v1/models', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: [{ id: 'gpt-oud', created: 1 }, { id: 'gpt-nieuw', created: 9 }, { id: 'text-embedding-3-small', created: 5 }] }) }));
  await context.route('https://api.openai.com/v1/chat/completions', async (route) => {
    openaiVerzoek = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ model: 'gpt-nieuw', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(AI_JSON) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) });
  });
  const opties = await context.newPage();
  opties.on('pageerror', (e) => fouten.push('opties: ' + e.message));
  await opties.setViewportSize({ width: 1180, height: 860 });
  await opties.goto(`chrome-extension://${extId}/extension/options.html`);
  // Oud formaat is omgezet; Claude is actief met de bestaande sleutel
  await opties.locator('.kaart[data-provider="claude"][aria-checked="true"]').waitFor();
  assert.strictEqual(await opties.locator('#sleutel').inputValue(), 'sk-test');
  const opgeslagen = () => sw.evaluate(() => new Promise((r) => chrome.storage.local.get('ggb.ai', (x) => r(x['ggb.ai']))));
  assert.strictEqual((await opgeslagen()).provider, 'claude', 'oud formaat omgezet naar nieuw');
  // Overstappen naar ChatGPT: sleutel invullen, modellen ophalen -> nieuwste chatmodel gekozen
  await opties.locator('.kaart[data-provider="openai"]').click();
  await opties.locator('#sleutel').fill('sk-openai-test');
  await opties.locator('#ophalen').click();
  await opties.locator('.melding.ok').waitFor();
  assert.ok(/Sleutel werkt · 2 modellen gevonden/.test(await opties.locator('.melding.ok').innerText()));
  assert.strictEqual(await opties.locator('#model').inputValue(), 'gpt-nieuw');
  await opties.waitForTimeout(600);
  const inst = await opgeslagen();
  assert.strictEqual(inst.provider, 'openai');
  assert.deepStrictEqual(inst.openai, { apiKey: 'sk-openai-test', model: 'gpt-nieuw' });
  assert.strictEqual(inst.claude.apiKey, 'sk-test', 'Claude-sleutel blijft bewaard');
  await opties.screenshot({ path: path.join(os.tmpdir(), 'ggb-opties.png') });
  // Handmatige prompt
  await opties.locator('nav a[data-pagina="prompt"]').click();
  assert.ok((await opties.locator('#prompt-tekst').inputValue()).includes('"goederen"'));
  await opties.screenshot({ path: path.join(os.tmpdir(), 'ggb-opties-prompt.png') });

  /* ================= Paneel met ChatGPT ================= */
  const p2 = await context.newPage();
  p2.on('pageerror', (e) => fouten.push('p2: ' + e.message));
  await p2.goto(URL_PB);
  await p2.locator('#ggb-documentcheck-host').waitFor({ state: 'attached' });
  await p2.locator('#tab-ai').click();
  await p2.locator('#ai-via', { hasText: 'ChatGPT' }).waitFor();
  assert.ok(/gpt-nieuw/.test(await p2.locator('#ai-via').innerText()));
  await p2.locator('#file').setInputFiles({ name: 'hc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%test\n') });
  assert.strictEqual(await p2.locator('#ai-run').innerText(), 'Uitlezen met ChatGPT');
  await p2.locator('#ai-run').click();
  await p2.locator('#ai-fill').waitFor({ timeout: 30000 });
  assert.strictEqual(openaiVerzoek.model, 'gpt-nieuw');
  assert.strictEqual(openaiVerzoek.messages[1].content[0].file.filename, 'hc.pdf');
  assert.strictEqual(await p2.locator('input[data-pad="bol.waarde"]').inputValue(), 'HLCUMA3260712342');

  /* ================= Handmatige modus ================= */
  await sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ 'ggb.ai': { provider: 'handmatig' } }, r)));
  const p3 = await context.newPage();
  p3.on('pageerror', (e) => fouten.push('p3: ' + e.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://food-and-consumer-products.pcs.portbase.com' });
  await p3.goto(URL_PB);
  await p3.locator('#ggb-documentcheck-host').waitFor({ state: 'attached' });
  await p3.locator('#tab-ai').click();
  await p3.locator('#blok-hand:not([hidden])').waitFor();   // handmatig staat vooraan door de instelling
  await p3.locator('#file').setInputFiles({ name: 'hc-scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') });
  await p3.locator('#ctx').fill('ETA 26-09-2026 07:00');
  await p3.locator('#prompt-kopie').click();
  await p3.locator('#prompt-kopie', { hasText: 'Gekopieerd' }).waitFor();
  const klembord = await p3.evaluate(() => navigator.clipboard.readText());
  assert.ok(klembord.includes('hc-scan.pdf') && klembord.includes('ETA 26-09-2026 07:00') && klembord.includes('"goederen"'), 'prompt met bestandsnamen, extra info en schema');
  // Chat-antwoord met tekst eromheen plakken
  await p3.locator('#json-in').fill('Hier is het JSON-object:\n```json\n' + JSON.stringify(AI_JSON) + '\n```');
  await p3.locator('#json-verwerk').click();
  await p3.locator('#ai-fill').waitFor();
  assert.ok(/handmatig/.test(await p3.locator('#ai-status').innerText()));
  assert.strictEqual(await p3.locator('input[data-pad="goederen.0.gnCode"]').inputValue(), '03061792');
  // Fout antwoord geeft duidelijke melding
  await p3.locator('#json-in').fill('Sorry, ik kan de PDF niet openen.');
  await p3.locator('#json-verwerk').click();
  assert.ok(/Geen JSON-object gevonden/.test(await p3.locator('#ai-status').innerText()));
  await p3.locator('.wrap').screenshot({ path: path.join(os.tmpdir(), 'ggb-paneel-handmatig.png') }).catch(() => {});
  assert.deepStrictEqual(fouten, []);

  console.log('\nE2E geslaagd');
} finally {
  await context.close();
}
