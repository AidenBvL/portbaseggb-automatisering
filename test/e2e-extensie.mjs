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
  grenscontrolepost: v('Rotterdam (NLRTM1)', 'middel'), plaatsBestemming: v('EUROFOODLINK B.V.'),
  landOorsprong: v('IN'), landLading: v('IN'), gecertificeerdVoor: v('Human consumption'), transportconditie: v('Frozen'),
  vervoermiddel: v('Vessel'), vervoermiddelNaam: v('MSC ANNA'), vervoermiddelNationaliteit: v('PA'),
  aankomstDatum: v('26-09-2026', 'laag', 'Extra info'), aankomstTijd: v('07:00', 'laag'),
  containers: [{ containernummer: 'HLBU9066045', zegelnummer: 'EIA123', bron: 'HC' }],
  documenten: [
    { type: 'HC', identificatie: 'EIA/VSP/2026-27/02937', datumAfgifte: '07-08-2026', landAfgifte: 'IN', inrichtingOorsprong: '', verwijstNaar: '', bestand: 'hc.pdf', zekerheid: 'hoog' },
    { type: 'LAB', identificatie: 'EIA/VZ/26-27/0003572', datumAfgifte: '07-08-2026', landAfgifte: 'IN', inrichtingOorsprong: '', verwijstNaar: 'EIA/VSP/2026-27/02937', bestand: 'hc.pdf', zekerheid: 'hoog' }
  ],
  goederen: [
    { gnCode: '03061792', omschrijving: 'Frozen shrimps (Penaeus vannamei)', brutoGewicht: '21516', nettoGewicht: '13447.5', aantalColli: '1600', verpakkingstype: 'Carton', batchnummer: 'L123', aanvullendeEenheden: '', erkenningsnummer: '1234', containernummer: 'HLBU9066045', bron: 'HC', zekerheid: 'hoog' },
    { gnCode: '03061791', omschrijving: 'Frozen shrimps (Penaeus monodon)', brutoGewicht: '500', nettoGewicht: '400', aantalColli: '40', verpakkingstype: 'Carton', batchnummer: 'L124', aanvullendeEenheden: '', erkenningsnummer: '1234', containernummer: 'HLBU9066045', bron: 'HC', zekerheid: 'hoog' }
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
  assert.strictEqual(await keuze('[data-test="document-type"]', 1), 'Certified lab report');
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
  await page.locator('#ai-verslag li', { hasText: 'Exporter (I.1)' }).locator('button[data-dialoog]').click();
  await page.locator('mat-dialog-container input').waitFor();
  assert.strictEqual(await page.locator('mat-dialog-container input').inputValue(), 'GHAN MARINE PRODUCTS');
  await page.evaluate(() => document.querySelector('mat-dialog-container').remove());
  await page.locator('#ai-verslag li', { hasText: 'Border control post' }).locator('button[data-dialoog]').click();
  await page.locator('mat-dialog-container input').waitFor();
  assert.strictEqual(await page.locator('mat-dialog-container input').inputValue(), 'NLRTM1');
  // Nooit opslaan of verzenden
  const klikken = await page.evaluate(() => window.__klikken);
  assert.ok(!klikken.some((k) => /save|send/.test(k)), 'Save/Send niet aangeklikt: ' + klikken.join(','));
  assert.deepStrictEqual(fouten, []);

  await page.screenshot({ path: path.join(os.tmpdir(), 'ggb-e2e.png'), fullPage: false });
  console.log(verslag.split('\n').slice(0, 3).join('\n'));
  console.log('\nE2E geslaagd');
} finally {
  await context.close();
}
