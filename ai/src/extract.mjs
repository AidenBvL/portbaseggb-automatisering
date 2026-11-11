/*
 * Uitlezen van GGB-documenten met Claude (Anthropic SDK).
 *
 * Wordt met esbuild gebundeld naar extension/ai.bundle.js (zie ai/package.json)
 * en in de service worker geladen. Daar is de globale GGB_AI_CLIENT.extract()
 * beschikbaar.
 *
 * De API-sleutel komt uit de extensie-instellingen (chrome.storage.local) en
 * wordt alleen naar api.anthropic.com gestuurd.
 */
import Anthropic from '@anthropic-ai/sdk';
import GGB_AI from '../../js/ggb-ai.js';

export const STANDAARD_MODEL = 'claude-opus-5-5';

const AFBEELDING_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * Bouwt de content-blokken voor de documenten.
 * @param {{naam: string, mediaType: string, data: string}[]} bestanden  data = base64 zonder prefix
 */
export function documentBlokken(bestanden) {
  const blokken = [];
  for (const b of bestanden) {
    if (b.mediaType === 'application/pdf') {
      blokken.push({
        type: 'document',
        title: b.naam,
        source: { type: 'base64', media_type: 'application/pdf', data: b.data },
      });
    } else if (AFBEELDING_TYPES.includes(b.mediaType)) {
      blokken.push({ type: 'text', text: `Bestand: ${b.naam}` });
      blokken.push({ type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.data } });
    } else {
      throw new Error(`Bestandstype ${b.mediaType || 'onbekend'} van "${b.naam}" wordt niet ondersteund (gebruik PDF, JPG, PNG of WEBP).`);
    }
  }
  return blokken;
}

/**
 * Leest de documenten uit en geeft het genormaliseerde GGB-voorstel terug.
 * @param {object} opties
 * @param {string} opties.apiKey
 * @param {{naam: string, mediaType: string, data: string}[]} opties.bestanden
 * @param {string} [opties.context]  extra aanwijzingen van de declarant
 * @param {string} [opties.model]
 * @param {string} [opties.effort]   low | medium | high | xhigh | max
 * @param {typeof fetch} [opties.fetch]  alleen voor tests
 */
export async function extract({ apiKey, bestanden, context = '', model = STANDAARD_MODEL, effort = 'high', fetch: fetchImpl }) {
  if (!apiKey) throw new Error('Geen Anthropic API-sleutel ingesteld. Open de instellingen van de extensie.');
  if (!bestanden || !bestanden.length) throw new Error('Geen documenten geselecteerd.');

  const client = new Anthropic({
    apiKey,
    // De sleutel is van de gebruiker zelf en staat lokaal in de extensie.
    dangerouslyAllowBrowser: true,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });

  const content = [
    ...documentBlokken(bestanden),
    { type: 'text', text: GGB_AI.gebruikersPrompt(bestanden.map((b) => b.naam), context) },
  ];

  let bericht;
  try {
    bericht = await client.beta.messages
      .stream({
        model,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: GGB_AI.SYSTEM,
        output_config: {
          effort,
          format: { type: 'json_schema', schema: GGB_AI.SCHEMA },
        },
        messages: [{ role: 'user', content }],
      })
      .finalMessage();
  } catch (e) {
    throw new Error(foutmelding(e));
  }

  if (bericht.stop_reason === 'refusal') {
    throw new Error('Claude heeft het verzoek geweigerd' + (bericht.stop_details?.explanation ? ': ' + bericht.stop_details.explanation : '.'));
  }
  if (bericht.stop_reason === 'max_tokens') {
    throw new Error('Het antwoord was te lang en is afgebroken. Probeer minder documenten tegelijk.');
  }
  const tekst = bericht.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let ruw;
  try {
    ruw = JSON.parse(tekst);
  } catch {
    throw new Error('Het antwoord van Claude was geen geldige JSON.');
  }
  return {
    resultaat: GGB_AI.normaliseer(ruw),
    model: bericht.model,
    gebruik: { input: bericht.usage.input_tokens, output: bericht.usage.output_tokens },
  };
}

function foutmelding(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Ongeldige API-sleutel. Controleer de instellingen van de extensie.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Deze API-sleutel heeft geen toegang tot het model.';
  if (e instanceof Anthropic.RateLimitError) return 'Te veel verzoeken (rate limit). Probeer het over een minuut opnieuw.';
  if (e instanceof Anthropic.BadRequestError) return 'Verzoek geweigerd door de API: ' + e.message;
  if (e instanceof Anthropic.APIConnectionError) return 'Geen verbinding met api.anthropic.com.';
  if (e instanceof Anthropic.APIError) return `API-fout ${e.status ?? ''}: ${e.message}`;
  return e && e.message ? e.message : String(e);
}
