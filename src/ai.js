import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

// Modèle vision le moins cher/rapide, adapté à la classification simple.
const MODELE = 'claude-haiku-4-5';

// Client construit avec une clé non vide pour éviter une erreur à l'import.
// La pré-qualif n'est appelée que si une vraie clé est configurée (cf. prequalif.js).
const client = new Anthropic({ apiKey: config.anthropicApiKey || 'non-configuree' });

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'confiance', 'justification'],
  properties: {
    verdict: { type: 'string', enum: ['bon', 'mauvais', 'incertain'] },
    confiance: { type: 'number' },           // 0..1 (clampé ci-dessous)
    justification: { type: 'string' },       // courte, en français
  },
};

const SYSTEME =
  "Tu juges un rallye photo. On te donne un critère et une photo. " +
  "Dis si la photo satisfait le critère : 'bon', 'mauvais' ou 'incertain' " +
  "(incertain si tu n'es pas sûr ou si la photo est ambiguë), avec une confiance " +
  "entre 0 et 1 et une justification courte en français. Sois indulgent sur la " +
  "qualité (flou, cadrage), strict sur le contenu effectivement demandé.";

// Renvoie { verdict, confiance, justification }. Lève en cas d'échec API (géré par l'appelant).
export async function prequalifier(jpegBuffer, critere) {
  const data = jpegBuffer.toString('base64');
  const resp = await client.messages.create({
    model: MODELE,
    max_tokens: 300,
    system: SYSTEME,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
        { type: 'text', text: `Critère du défi : ${critere}\n\nLa photo satisfait-elle ce critère ?` },
      ],
    }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  });

  const bloc = resp.content.find((b) => b.type === 'text');
  const out = JSON.parse(bloc.text);
  return {
    verdict: ['bon', 'mauvais', 'incertain'].includes(out.verdict) ? out.verdict : 'incertain',
    confiance: Math.max(0, Math.min(1, Number(out.confiance) || 0)),
    justification: String(out.justification || '').slice(0, 500),
  };
}
