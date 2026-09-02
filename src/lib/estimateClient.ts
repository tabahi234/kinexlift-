import { aiConfigured, chat } from './ai';
import {
  ESTIMATE_SYSTEM_PROMPT,
  estimatePrompt,
  parseEstimate,
  type FoodEstimate,
} from '../domain/estimate';

/**
 * One question, one answer, no memory.
 *
 * Deliberately not routed through the coach thread. "A wrap from the place by
 * the station" is not a conversation, and putting it in the chat history
 * would spend context on it every message afterwards. It also means the
 * estimate works the same whether or not she has ever opened the coach.
 *
 * The reply is parsed by `domain/estimate.ts`, which bounds every field.
 * Nothing here trusts anything the model said.
 */

export type EstimateResult =
  | { ok: true; estimate: FoodEstimate }
  | { ok: false; error: string };

export function estimateAvailable(): boolean {
  return aiConfigured();
}

export async function estimateFood(
  description: string,
  signal?: AbortSignal,
): Promise<EstimateResult> {
  const trimmed = description.trim();
  if (trimmed === '') return { ok: false, error: 'Say what you ate first.' };
  if (!aiConfigured()) {
    return { ok: false, error: 'No model key is set, so estimates are off.' };
  }

  const reply = await chat(
    [
      { role: 'system', content: ESTIMATE_SYSTEM_PROMPT },
      { role: 'user', content: estimatePrompt(trimmed) },
    ],
    // Small budget: the answer is one line of JSON. These are reasoning
    // models and thinking tokens come out of the same allowance, so it is not
    // as small as the answer looks.
    { maxTokens: 400, signal },
  );

  if (!reply.ok) return { ok: false, error: reply.error };

  // Her own words are the fallback name, so a reply that gets the numbers
  // right and forgets the label still produces a usable card.
  const estimate = parseEstimate(reply.text, trimmed);
  return estimate
    ? { ok: true, estimate }
    : {
        ok: false,
        error: 'That came back in a shape the app could not read. Try describing it more plainly, or type the numbers in yourself.',
      };
}
