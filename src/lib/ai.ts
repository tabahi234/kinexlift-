/**
 * The model client.
 *
 * One job: send messages, get text back, and never throw. Everything about
 * *what* to send lives in domain/coach.ts and lib/coachClient.ts, so this file
 * can be swapped for a different provider - or for a server-side proxy - in an
 * afternoon.
 *
 * A note on the key. `VITE_` variables are compiled into the bundle, so the
 * Groq key ships to the browser and anyone with dev tools can read it. That is
 * acceptable for a personal build with a rate-limited free key and it is not
 * acceptable for a public one: before this app is handed to anyone else, the
 * call below moves behind a small server route that holds the key. There is a
 * deliberately loud note about it in the README.
 */

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Much larger than the 8B model the first draft used, and the difference is
 * not subtle: a small model cheerfully misreads a training log and invents
 * numbers, which is the one failure this feature cannot have.
 *
 * Providers retire models. The Llama 3.x ids this originally used had already
 * been withdrawn by the time it was first run, and the app answered every
 * question with a 404. If that happens again, `curl -H "Authorization: Bearer
 * $KEY" https://api.groq.com/openai/v1/models` lists what the account can
 * actually reach - and a 404 is treated as retryable below precisely so the
 * fallback gets a turn when it does.
 */
const PRIMARY_MODEL = 'openai/gpt-oss-120b';
/** Used when the primary is rate-limited, retired or unavailable. */
const FALLBACK_MODEL = 'openai/gpt-oss-20b';

const TIMEOUT_MS = 30_000;

/**
 * These are reasoning models: they spend tokens thinking before they answer,
 * and that spend comes out of max_tokens. At the 150-token budget the first
 * version used, the whole allowance went on reasoning and the reply came back
 * empty. Low effort plus a real budget is the combination that answers.
 */
const REASONING_EFFORT = 'low';
const DEFAULT_MAX_TOKENS = 700;

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export type AiResult =
  | { ok: true; text: string; model: string }
  | { ok: false; error: string; retryable: boolean };

export function aiConfigured(): boolean {
  return Boolean(import.meta.env.VITE_GROQ_API_KEY);
}

interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

async function callModel(
  model: string,
  messages: ChatTurn[],
  options: ChatOptions,
): Promise<AiResult> {
  const key = import.meta.env.VITE_GROQ_API_KEY;
  if (!key) {
    return {
      ok: false,
      error: 'No API key is configured, so the coach cannot answer.',
      retryable: false,
    };
  }

  // Two abort sources: the caller's (she navigated away) and our own timeout.
  // Without the timeout a hung request leaves the composer disabled forever.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options.temperature ?? 0.4,
        reasoning_effort: REASONING_EFFORT,
      }),
      signal: timeout.signal,
    });

    if (response.status === 429) {
      return {
        ok: false,
        error: 'The coach is rate-limited right now. Try again in a minute.',
        retryable: true,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `The coach could not be reached (${response.status}).`,
        // 5xx is worth retrying, and so is 404 - that is what a retired model
        // id looks like, and the fallback model is exactly the right response
        // to it. A 400 means we sent something wrong, and retrying it
        // unchanged would fail identically.
        retryable: response.status >= 500 || response.status === 404,
      };
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();

    if (!text) {
      // Almost always means the token budget was spent on reasoning before
      // the answer began. Retryable, because the fallback is a smaller model
      // that thinks less.
      return {
        ok: false,
        error: 'The coach ran out of room before it answered. Try again.',
        retryable: true,
      };
    }

    return { ok: true, text, model };
  } catch (error) {
    if (options.signal?.aborted) {
      return { ok: false, error: 'Cancelled.', retryable: false };
    }
    if (timeout.signal.aborted) {
      return {
        ok: false,
        error: 'That took too long. Check your connection and try again.',
        retryable: true,
      };
    }
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? `Could not reach the coach: ${error.message}`
          : 'Could not reach the coach.',
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Sends a conversation and returns the reply.
 *
 * Falls back to the smaller model only when the large one is unavailable, and
 * only for reasons where a different model would plausibly succeed. Falling
 * back on a 400 would just produce the same error twice as slowly.
 */
export async function chat(
  messages: ChatTurn[],
  options: ChatOptions = {},
): Promise<AiResult> {
  const primary = await callModel(PRIMARY_MODEL, messages, options);
  if (primary.ok || !primary.retryable || options.signal?.aborted) return primary;

  const fallback = await callModel(FALLBACK_MODEL, messages, options);
  return fallback.ok ? fallback : primary;
}
