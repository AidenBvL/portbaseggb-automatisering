/*
 * Uitlezen via de gekozen AI-aanbieder: Claude (Anthropic SDK, zie
 * extract.mjs), ChatGPT (OpenAI Chat Completions API) of Gemini (Google
 * Gemini API). Alle drie krijgen dezelfde instructies (GGB_AI.SYSTEM) en
 * hetzelfde JSON-schema; het antwoord gaat door GGB_AI.normaliseer().
 *
 * OpenAI en Gemini worden via hun REST-API aangeroepen (fetch), zonder extra
 * SDK in de extensie.
 */
import Anthropic from '@anthropic-ai/sdk';
import GGB_AI from '../../js/ggb-ai.js';
import { extract as extractClaude } from './extract.mjs';

const OPENAI_URL = 'https://api.openai.com/v1';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';

function controleer({ apiKey, model, bestanden }, naam) {
  if (!apiKey) throw new Error(`Geen ${naam}-API-sleutel ingesteld. Open de instellingen van de extensie.`);
  if (!model) throw new Error(`Geen ${naam}-model gekozen. Kies er een in de instellingen (Modellen ophalen).`);
  if (!bestanden || !bestanden.length) throw new Error('Geen documenten geselecteerd.');
}

function json(tekst, naam) {
  try {
    return JSON.parse(tekst);
  } catch {
    throw new Error(`Het antwoord van ${naam} was geen geldige JSON.`);
  }
}

async function foutVan(res, naam) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || '';
  } catch { /* geen JSON */ }
  if (res.status === 401 || res.status === 403) return new Error(`Ongeldige ${naam}-API-sleutel of geen toegang${detail ? ': ' + detail : '.'}`);
  if (res.status === 429) return new Error(`${naam}: te veel verzoeken of tegoed op (429)${detail ? ': ' + detail : '.'}`);
  if (res.status === 404) return new Error(`${naam}: model niet gevonden (404)${detail ? ': ' + detail : '.'}`);
  return new Error(`${naam}-fout ${res.status}${detail ? ': ' + detail : ''}`);
}

async function post(url, headers, body, fetchImpl, naam) {
  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch {
    throw new Error(`Geen verbinding met ${new URL(url).host}.`);
  }
  if (!res.ok) throw await foutVan(res, naam);
  return res.json();
}

/* ---------------- ChatGPT (OpenAI) ---------------- */

export function openaiInhoud(bestanden, context) {
  const delen = bestanden.map((b) => {
    if (b.mediaType === 'application/pdf') {
      return { type: 'file', file: { filename: b.naam, file_data: `data:application/pdf;base64,${b.data}` } };
    }
    if (/^image\//.test(b.mediaType)) return { type: 'image_url', image_url: { url: `data:${b.mediaType};base64,${b.data}` } };
    throw new Error(`Bestandstype ${b.mediaType || 'onbekend'} van "${b.naam}" wordt niet ondersteund.`);
  });
  delen.push({ type: 'text', text: GGB_AI.gebruikersPrompt(bestanden.map((b) => b.naam), context) });
  return delen;
}

export async function extractOpenAI({ apiKey, model, bestanden, context = '', fetch: fetchImpl = fetch }) {
  controleer({ apiKey, model, bestanden }, 'OpenAI');
  const antwoord = await post(`${OPENAI_URL}/chat/completions`, { authorization: `Bearer ${apiKey}` }, {
    model,
    messages: [
      { role: 'system', content: GGB_AI.SYSTEM },
      { role: 'user', content: openaiInhoud(bestanden, context) },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'ggb_voorstel', strict: true, schema: GGB_AI.SCHEMA } },
  }, fetchImpl, 'OpenAI');
  const keuze = antwoord.choices?.[0];
  if (!keuze) throw new Error('Leeg antwoord van OpenAI.');
  if (keuze.message?.refusal) throw new Error('ChatGPT heeft het verzoek geweigerd: ' + keuze.message.refusal);
  if (keuze.finish_reason === 'length') throw new Error('Het antwoord van ChatGPT was te lang en is afgebroken.');
  return {
    resultaat: GGB_AI.normaliseer(json(keuze.message?.content || '', 'ChatGPT')),
    model: antwoord.model || model,
    gebruik: { input: antwoord.usage?.prompt_tokens ?? 0, output: antwoord.usage?.completion_tokens ?? 0 },
  };
}

/* ---------------- Gemini (Google) ---------------- */

export function geminiInhoud(bestanden, context, schemaInTekst) {
  const delen = bestanden.map((b) => {
    if (b.mediaType === 'application/pdf' || /^image\//.test(b.mediaType)) return { inlineData: { mimeType: b.mediaType, data: b.data } };
    throw new Error(`Bestandstype ${b.mediaType || 'onbekend'} van "${b.naam}" wordt niet ondersteund.`);
  });
  let tekst = GGB_AI.gebruikersPrompt(bestanden.map((b) => b.naam), context);
  if (schemaInTekst) tekst += '\n\nAntwoord uitsluitend met JSON volgens dit schema:\n' + JSON.stringify(GGB_AI.SCHEMA);
  delen.push({ text: tekst });
  return delen;
}

export async function extractGemini({ apiKey, model, bestanden, context = '', fetch: fetchImpl = fetch }) {
  controleer({ apiKey, model, bestanden }, 'Gemini');
  const url = `${GEMINI_URL}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`;
  const verzoek = (metSchema) => post(url, { 'x-goog-api-key': apiKey }, {
    systemInstruction: { parts: [{ text: GGB_AI.SYSTEM }] },
    contents: [{ role: 'user', parts: geminiInhoud(bestanden, context, !metSchema) }],
    generationConfig: metSchema
      ? { responseMimeType: 'application/json', responseJsonSchema: GGB_AI.SCHEMA }
      : { responseMimeType: 'application/json' },
  }, fetchImpl, 'Gemini');
  let antwoord;
  try {
    antwoord = await verzoek(true);
  } catch (e) {
    // Oudere modellen kennen responseJsonSchema niet: schema dan in de prompt meesturen.
    if (!/responseJsonSchema|response_json_schema|Unknown name/i.test(e.message)) throw e;
    antwoord = await verzoek(false);
  }
  if (antwoord.promptFeedback?.blockReason) throw new Error('Gemini heeft het verzoek geblokkeerd: ' + antwoord.promptFeedback.blockReason);
  const kandidaat = antwoord.candidates?.[0];
  if (!kandidaat) throw new Error('Leeg antwoord van Gemini.');
  if (kandidaat.finishReason === 'MAX_TOKENS') throw new Error('Het antwoord van Gemini was te lang en is afgebroken.');
  if (kandidaat.finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(kandidaat.finishReason)) {
    throw new Error('Gemini stopte zonder antwoord (' + kandidaat.finishReason + ').');
  }
  const tekst = (kandidaat.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  return {
    resultaat: GGB_AI.normaliseer(json(tekst, 'Gemini')),
    model: antwoord.modelVersion || model,
    gebruik: { input: antwoord.usageMetadata?.promptTokenCount ?? 0, output: antwoord.usageMetadata?.candidatesTokenCount ?? 0 },
  };
}

/* ---------------- verdeler en modellenlijst ---------------- */

/** Uitlezen met de aanbieder uit de instellingen (GGB_AI.instellingen). */
export async function extract({ instellingen, bestanden, context, fetch: fetchImpl }) {
  const inst = GGB_AI.instellingen(instellingen);
  const p = inst[inst.provider];
  if (inst.provider === 'handmatig') throw new Error('Handmatige modus is gekozen: gebruik "Kopieer prompt" en plak het JSON-antwoord.');
  if (inst.provider === 'openai') return extractOpenAI({ ...p, bestanden, context, fetch: fetchImpl });
  if (inst.provider === 'gemini') return extractGemini({ ...p, bestanden, context, fetch: fetchImpl });
  return extractClaude({ apiKey: p.apiKey, model: p.model, effort: p.effort, bestanden, context, fetch: fetchImpl });
}

const OPENAI_GEEN_CHAT = /(audio|realtime|tts|transcribe|embedding|whisper|dall-e|image|moderation|search|davinci|babbage|instruct|codex)/i;

/**
 * Beschikbare modellen bij een aanbieder (controleert meteen de sleutel).
 * @returns {Promise<{id: string, naam: string}[]>}
 */
export async function modellen({ provider, apiKey, fetch: fetchImpl = fetch }) {
  if (!apiKey) throw new Error('Vul eerst een API-sleutel in.');
  if (provider === 'claude') {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, ...(fetchImpl !== fetch ? { fetch: fetchImpl } : {}) });
    const lijst = [];
    try {
      for await (const m of client.models.list({ limit: 100 })) lijst.push({ id: m.id, naam: m.display_name || m.id });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('Ongeldige Anthropic-API-sleutel.');
      throw new Error(e?.message || String(e));
    }
    return lijst;
  }
  if (provider === 'openai') {
    let res;
    try { res = await fetchImpl(`${OPENAI_URL}/models`, { headers: { authorization: `Bearer ${apiKey}` } }); } catch { throw new Error('Geen verbinding met api.openai.com.'); }
    if (!res.ok) throw await foutVan(res, 'OpenAI');
    const body = await res.json();
    return (body.data || [])
      .filter((m) => /^(gpt|o\d|chatgpt)/i.test(m.id) && !OPENAI_GEEN_CHAT.test(m.id))
      .sort((a, b) => (b.created || 0) - (a.created || 0))
      .map((m) => ({ id: m.id, naam: m.id }));
  }
  if (provider === 'gemini') {
    let res;
    try { res = await fetchImpl(`${GEMINI_URL}/models?pageSize=1000`, { headers: { 'x-goog-api-key': apiKey } }); } catch { throw new Error('Geen verbinding met generativelanguage.googleapis.com.'); }
    if (!res.ok) throw await foutVan(res, 'Gemini');
    const body = await res.json();
    return (body.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name) && !/(embedding|image|tts|audio|live)/i.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), naam: m.displayName || m.name }));
  }
  throw new Error('Onbekende aanbieder: ' + provider);
}
