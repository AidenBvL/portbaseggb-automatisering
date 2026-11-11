/*
 * Tests voor ai/src/aanbieders.mjs (ChatGPT, Gemini, verdeler, modellenlijst)
 * met nagebootste API's. Draaien: node test/ai-aanbieders.test.mjs (na npm install in ai/)
 */
import assert from 'node:assert';
import { extract, extractOpenAI, extractGemini, modellen } from '../ai/src/aanbieders.mjs';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok  ' + name); }

const BESTANDEN = [
  { naam: 'hc.pdf', mediaType: 'application/pdf', data: 'JVBERi0xLjQK' },
  { naam: 'foto.jpg', mediaType: 'image/jpeg', data: '/9j/4AAQ' },
];
const VOORSTEL = { bol: { waarde: 'HLCU1', bron: 'B/L', zekerheid: 'hoog' }, landOorsprong: { waarde: 'IN', bron: 'HC', zekerheid: 'hoog' }, goederen: [{ gnCode: '0306 17 92', omschrijving: 'Shrimps' }], waarschuwingen: [] };
const antwoordJson = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function opname(antwoorden) {
  const verzoeken = [];
  const fetch = async (url, init = {}) => {
    verzoeken.push({ url: String(url), headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : null });
    const a = antwoorden.shift();
    return typeof a === 'function' ? a() : a;
  };
  return { fetch, verzoeken };
}

/* ---------------- ChatGPT ---------------- */

await test('ChatGPT: verzoek met strikt JSON-schema, PDF als file en foto als image_url', async () => {
  const { fetch, verzoeken } = opname([antwoordJson({ model: 'gpt-test', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(VOORSTEL) } }], usage: { prompt_tokens: 900, completion_tokens: 120 } })]);
  const res = await extractOpenAI({ apiKey: 'sk-o', model: 'gpt-test', bestanden: BESTANDEN, context: 'ETA 26-09', fetch });
  const v = verzoeken[0];
  assert.strictEqual(v.url, 'https://api.openai.com/v1/chat/completions');
  assert.strictEqual(v.headers.get('authorization'), 'Bearer sk-o');
  assert.strictEqual(v.body.model, 'gpt-test');
  assert.strictEqual(v.body.messages[0].role, 'system');
  const inhoud = v.body.messages[1].content;
  assert.deepStrictEqual(inhoud[0], { type: 'file', file: { filename: 'hc.pdf', file_data: 'data:application/pdf;base64,JVBERi0xLjQK' } });
  assert.deepStrictEqual(inhoud[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQ' } });
  assert.ok(inhoud[2].text.includes('ETA 26-09'));
  assert.strictEqual(v.body.response_format.type, 'json_schema');
  assert.strictEqual(v.body.response_format.json_schema.strict, true);
  assert.ok(v.body.response_format.json_schema.schema.properties.goederen);
  assert.strictEqual(res.resultaat.goederen[0].gnCode, '03061792');
  assert.deepStrictEqual(res.gebruik, { input: 900, output: 120 });
});

await test('ChatGPT: weigering, afgebroken antwoord en ongeldige sleutel', async () => {
  await assert.rejects(extractOpenAI({ apiKey: 'k', model: 'm', bestanden: BESTANDEN, fetch: opname([antwoordJson({ choices: [{ message: { refusal: 'Nee' } }] })]).fetch }), /geweigerd: Nee/);
  await assert.rejects(extractOpenAI({ apiKey: 'k', model: 'm', bestanden: BESTANDEN, fetch: opname([antwoordJson({ choices: [{ finish_reason: 'length', message: { content: '{' } }] })]).fetch }), /te lang/);
  await assert.rejects(extractOpenAI({ apiKey: 'k', model: 'm', bestanden: BESTANDEN, fetch: opname([antwoordJson({ error: { message: 'Incorrect API key' } }, 401)]).fetch }), /Ongeldige OpenAI-API-sleutel/);
  await assert.rejects(extractOpenAI({ apiKey: 'k', model: '', bestanden: BESTANDEN }), /Geen OpenAI-model/);
});

/* ---------------- Gemini ---------------- */

await test('Gemini: verzoek met inlineData, systemInstruction en responseJsonSchema', async () => {
  const { fetch, verzoeken } = opname([antwoordJson({ modelVersion: 'gemini-x', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(VOORSTEL) }] } }], usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 90 } })]);
  const res = await extractGemini({ apiKey: 'AIza', model: 'models/gemini-pro-latest', bestanden: BESTANDEN, fetch });
  const v = verzoeken[0];
  assert.strictEqual(v.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent');
  assert.strictEqual(v.headers.get('x-goog-api-key'), 'AIza');
  assert.ok(v.body.systemInstruction.parts[0].text.includes('GGB'));
  const delen = v.body.contents[0].parts;
  assert.deepStrictEqual(delen[0], { inlineData: { mimeType: 'application/pdf', data: 'JVBERi0xLjQK' } });
  assert.deepStrictEqual(delen[1], { inlineData: { mimeType: 'image/jpeg', data: '/9j/4AAQ' } });
  assert.strictEqual(v.body.generationConfig.responseMimeType, 'application/json');
  assert.ok(v.body.generationConfig.responseJsonSchema.properties.bol);
  assert.strictEqual(res.resultaat.bol.waarde, 'HLCU1');
  assert.strictEqual(res.model, 'gemini-x');
});

await test('Gemini: terugval naar schema-in-prompt als responseJsonSchema onbekend is', async () => {
  const { fetch, verzoeken } = opname([
    antwoordJson({ error: { message: 'Invalid JSON payload received. Unknown name "responseJsonSchema"' } }, 400),
    antwoordJson({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(VOORSTEL) }] } }] }),
  ]);
  const res = await extractGemini({ apiKey: 'AIza', model: 'gemini-oud', bestanden: BESTANDEN, fetch });
  assert.strictEqual(verzoeken.length, 2);
  assert.ok(!('responseJsonSchema' in verzoeken[1].body.generationConfig));
  assert.ok(verzoeken[1].body.contents[0].parts.at(-1).text.includes('"goederen"'), 'schema in de prompt');
  assert.strictEqual(res.resultaat.landOorsprong.waarde, 'IN');
});

await test('Gemini: geblokkeerd en afgebroken antwoord', async () => {
  await assert.rejects(extractGemini({ apiKey: 'k', model: 'm', bestanden: BESTANDEN, fetch: opname([antwoordJson({ promptFeedback: { blockReason: 'SAFETY' } })]).fetch }), /geblokkeerd: SAFETY/);
  await assert.rejects(extractGemini({ apiKey: 'k', model: 'm', bestanden: BESTANDEN, fetch: opname([antwoordJson({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] })]).fetch }), /te lang/);
});

/* ---------------- verdeler en modellen ---------------- */

await test('verdeler kiest de aanbieder uit de instellingen; handmatig geeft een duidelijke melding', async () => {
  const { fetch, verzoeken } = opname([antwoordJson({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(VOORSTEL) }] } }] })]);
  await extract({ instellingen: { provider: 'gemini', gemini: { apiKey: 'AIza', model: 'gemini-pro-latest' } }, bestanden: BESTANDEN, fetch });
  assert.ok(verzoeken[0].url.includes('generativelanguage'));
  await assert.rejects(extract({ instellingen: { provider: 'handmatig' }, bestanden: BESTANDEN }), /Handmatige modus/);
});

await test('modellen: OpenAI filtert op chatmodellen (nieuwste eerst), Gemini op generateContent', async () => {
  const o = await modellen({ provider: 'openai', apiKey: 'sk', fetch: opname([antwoordJson({ data: [
    { id: 'gpt-oud', created: 1 }, { id: 'gpt-nieuw', created: 9 }, { id: 'text-embedding-3-large', created: 5 }, { id: 'gpt-x-realtime', created: 8 }, { id: 'whisper-1', created: 2 },
  ] })]).fetch });
  assert.deepStrictEqual(o.map((m) => m.id), ['gpt-nieuw', 'gpt-oud']);
  const g = await modellen({ provider: 'gemini', apiKey: 'AIza', fetch: opname([antwoordJson({ models: [
    { name: 'models/gemini-pro-latest', displayName: 'Gemini Pro Latest', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent', 'generateContent'] },
  ] })]).fetch });
  assert.deepStrictEqual(g, [{ id: 'gemini-pro-latest', naam: 'Gemini Pro Latest' }]);
  await assert.rejects(modellen({ provider: 'openai', apiKey: 'fout', fetch: opname([antwoordJson({ error: { message: 'bad key' } }, 401)]).fetch }), /Ongeldige OpenAI-API-sleutel/);
  await assert.rejects(modellen({ provider: 'openai', apiKey: '' }), /API-sleutel/);
});

await test('modellen: Claude via de Anthropic SDK', async () => {
  const { fetch, verzoeken } = opname([antwoordJson({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-opus-5-5' })]);
  const lijst = await modellen({ provider: 'claude', apiKey: 'sk-ant', fetch });
  assert.ok(verzoeken[0].url.startsWith('https://api.anthropic.com/v1/models'));
  assert.deepStrictEqual(lijst, [{ id: 'claude-opus-5-5', naam: 'Claude Opus 5.5' }]);
});

console.log('\n' + passed + ' aanbieder-tests geslaagd');
