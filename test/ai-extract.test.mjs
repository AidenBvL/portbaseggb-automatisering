/*
 * Test van ai/src/extract.mjs met een nagebootste API (geen echte aanroep).
 * Vereist `npm install` in ai/ (Anthropic SDK). Draaien: node test/ai-extract.test.mjs
 */
import assert from 'node:assert';
import { extract, documentBlokken } from '../ai/src/extract.mjs';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok  ' + name); }

function sse(events) {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' } });
}

function antwoord(json, stopReason = 'end_turn') {
  const tekst = JSON.stringify(json);
  return sse([
    { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: tekst.slice(0, 40) } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: tekst.slice(40) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 350 } },
    { type: 'message_stop' },
  ]);
}

const BESTANDEN = [
  { naam: 'hc.pdf', mediaType: 'application/pdf', data: 'JVBERi0xLjQK' },
  { naam: 'foto.jpg', mediaType: 'image/jpeg', data: '/9j/4AAQ' },
];

await test('verzoek: model, schema, effort, fallback en documenten', async () => {
  let verzoek;
  const res = await extract({
    apiKey: 'sk-test',
    bestanden: BESTANDEN,
    context: 'ETA 26-09-2026',
    fetch: async (url, init) => {
      verzoek = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
      return antwoord({ bol: { waarde: 'HLCU1', bron: 'B/L', zekerheid: 'hoog' }, goederen: [{ gnCode: '0306 17 92', omschrijving: 'Shrimps' }], waarschuwingen: [] });
    },
  });
  assert.ok(/\/v1\/messages(\?|$)/.test(verzoek.url), verzoek.url);
  assert.ok(verzoek.headers.get('x-api-key') === 'sk-test' || verzoek.headers.get('authorization') === 'Bearer sk-test', 'API-sleutel meegestuurd');
  assert.ok(verzoek.headers.get('anthropic-beta').includes('server-side-fallback-2026-07-01'));
  const b = verzoek.body;
  assert.strictEqual(b.model, 'claude-opus-5-5');
  assert.strictEqual(b.stream, true);
  assert.strictEqual(b.fallbacks, 'default');
  assert.strictEqual(b.output_config.effort, 'high');
  assert.strictEqual(b.output_config.format.type, 'json_schema');
  assert.ok(b.output_config.format.schema.properties.goederen);
  assert.ok(!('thinking' in b), 'thinking niet meesturen (altijd aan op Opus 5.5)');
  const c = b.messages[0].content;
  assert.strictEqual(c[0].type, 'document');
  assert.strictEqual(c[0].title, 'hc.pdf');
  assert.strictEqual(c[1].text, 'Bestand: foto.jpg');
  assert.strictEqual(c[2].type, 'image');
  assert.ok(c[3].text.includes('ETA 26-09-2026'));

  assert.strictEqual(res.resultaat.bol.waarde, 'HLCU1');
  assert.strictEqual(res.resultaat.goederen[0].gnCode, '03061792');
  assert.strictEqual(res.resultaat.declaratieType.waarde, 'PRD');
  assert.deepStrictEqual(res.gebruik, { input: 1200, output: 350 });
});

await test('weigering en afgebroken antwoord geven een duidelijke fout', async () => {
  await assert.rejects(
    extract({ apiKey: 'k', bestanden: BESTANDEN, fetch: async () => antwoord({}, 'refusal') }),
    /geweigerd/
  );
  await assert.rejects(
    extract({ apiKey: 'k', bestanden: BESTANDEN, fetch: async () => antwoord({}, 'max_tokens') }),
    /te lang/
  );
});

await test('ongeldige sleutel -> Nederlandse foutmelding', async () => {
  await assert.rejects(
    extract({
      apiKey: 'fout',
      bestanden: BESTANDEN,
      fetch: async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
    }),
    /Ongeldige API-sleutel/
  );
});

await test('zonder sleutel of bestanden direct een fout', async () => {
  await assert.rejects(extract({ apiKey: '', bestanden: BESTANDEN }), /API-sleutel/);
  await assert.rejects(extract({ apiKey: 'k', bestanden: [] }), /Geen documenten/);
});

await test('niet-ondersteund bestandstype wordt geweigerd', async () => {
  assert.throws(() => documentBlokken([{ naam: 'a.docx', mediaType: 'application/msword', data: '' }]), /niet ondersteund/);
});

console.log('\n' + passed + ' extract-tests geslaagd');
