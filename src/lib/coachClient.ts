import { addChatMessage, addCoachNote } from '../db/actions';
import { buildActionContext, buildBriefing } from '../db/derived';
import { getChatMessages, getCoachNotes } from '../db/queries';
import { getProfile } from '../db/repo';
import { COACH_SYSTEM_PROMPT, SUMMARY_PROMPT } from '../domain/coach';
import { coachEnabled } from '../domain/profile';
import { PROPOSAL_PROTOCOL } from '../domain/proposals';
import { chat, type ChatTurn } from './ai';

/**
 * The coach's memory.
 *
 * A chat assistant that forgets everything between sessions is a search box
 * with extra steps. This gives it three layers, in increasing order of age:
 *
 *   1. The briefing - regenerated from the database on every single message,
 *      so the numbers are never stale by even one logged set.
 *   2. The last dozen messages, verbatim, so the thread of the current
 *      conversation holds.
 *   3. A rolling summary of everything older, plus any standing facts she has
 *      given it. Written by the model when the conversation outgrows the
 *      verbatim window, stored on device, and sent with every request.
 *
 * Layer three is what makes it remember in March what she said in January
 * without resending January.
 */

/** Kept in full. Beyond this, older turns are represented by the summary. */
const VERBATIM_MESSAGES = 12;

/**
 * How many messages may sit outside the summary before a new one is written.
 * Summarising every turn would double the cost of the feature for nothing.
 */
const SUMMARISE_AFTER = 16;

export type CoachError =
  | { kind: 'not-enabled' }
  | { kind: 'no-profile' }
  | { kind: 'failed'; message: string; retryable: boolean };

export type CoachOutcome =
  | { ok: true; text: string; messageId: string }
  | { ok: false; error: CoachError };

/**
 * Where she asked from.
 *
 * The whole conversation is one thread wherever she types into it - the coach
 * screen, the box on Fuel, the box on Today - so this only steers what the
 * reply is likely to be about. It never changes what the model is allowed to
 * do, which is the same everywhere and enforced when the reply is parsed.
 */
export type CoachFocus = 'general' | 'meal' | 'training';

const FOCUS_NUDGE: Record<CoachFocus, string | null> = {
  general: null,
  meal: 'She is asking from the Fuel screen, so this is almost certainly about food. If she has asked for something to eat, choose it from the food list and attach the card.',
  training:
    "She is asking from the Today screen, about the session in the list below. If she is telling you what she has already lifted, write it down as a log card - that is the fastest thing you do for her. If she wants a movement changed and an alternative for that slot suits her better, attach a swap card. If nothing listed helps - the problem is pain, not preference - say so and tell her to stop rather than swapping for the sake of it.",
};

async function memoryTurns(): Promise<ChatTurn[]> {
  const notes = await getCoachNotes();
  const facts = notes.filter((note) => note.kind === 'fact');
  const summary = notes.filter((note) => note.kind === 'summary').at(-1);

  const parts: string[] = [];
  if (summary) {
    parts.push(`Earlier conversations, summarised:\n${summary.content}`);
  }
  if (facts.length > 0) {
    parts.push(
      `Standing notes she has given you:\n${facts.map((note) => `- ${note.content}`).join('\n')}`,
    );
  }

  return parts.length === 0 ? [] : [{ role: 'system', content: parts.join('\n\n') }];
}

/**
 * Asks the coach a question and records both sides of the exchange.
 *
 * The user's message is saved before the request goes out. If the network
 * fails, what she typed is still on screen and still in the log - losing it
 * would be the most annoying possible way for this to break.
 */
export async function askCoach(
  question: string,
  options: { signal?: AbortSignal; focus?: CoachFocus } = {},
): Promise<CoachOutcome> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: { kind: 'no-profile' } };
  if (!coachEnabled(profile)) return { ok: false, error: { kind: 'not-enabled' } };

  await addChatMessage('user', question);

  const [{ text: briefing }, actions, memory, history] = await Promise.all([
    buildBriefing(),
    buildActionContext(),
    memoryTurns(),
    getChatMessages(200),
  ]);

  const recent = history.slice(-VERBATIM_MESSAGES);
  const nudge = FOCUS_NUDGE[options.focus ?? 'general'];

  const turns: ChatTurn[] = [
    { role: 'system', content: COACH_SYSTEM_PROMPT },
    {
      role: 'system',
      content: `Here is her current data, computed by the app. Treat every number in it as authoritative and do not recalculate any of it.\n\n${briefing}`,
    },
    // The protocol and the two catalogues travel together: the rules are
    // meaningless without the ids, and the ids are dangerous without the rules.
    { role: 'system', content: `${PROPOSAL_PROTOCOL}\n\n${actions}` },
    ...(nudge ? [{ role: 'system' as const, content: nudge }] : []),
    ...memory,
    ...recent.map((message) => ({
      role: message.role as ChatTurn['role'],
      content: message.content,
    })),
  ];

  const result = await chat(turns, {
    // A meal for a whole day, written out in prose and then again as a block,
    // does not fit in the budget an explanation needs.
    maxTokens: 1100,
    temperature: 0.4,
    signal: options.signal,
  });

  if (!result.ok) {
    // Recorded as a failed assistant turn so the thread shows what happened
    // rather than swallowing her question into silence.
    await addChatMessage('assistant', result.error, true);
    return {
      ok: false,
      error: { kind: 'failed', message: result.error, retryable: result.retryable },
    };
  }

  const message = await addChatMessage('assistant', result.text);
  void maybeSummarise();

  return { ok: true, text: result.text, messageId: message.id };
}

/**
 * Writes a new rolling summary once enough has been said since the last one.
 *
 * Deliberately fire-and-forget: it must never delay her reply, and if it fails
 * the only cost is that the next request carries slightly less history.
 */
export async function maybeSummarise(): Promise<void> {
  const [messages, notes] = await Promise.all([getChatMessages(400), getCoachNotes()]);
  const previous = notes.filter((note) => note.kind === 'summary').at(-1);
  const coveredUntil = previous?.coversUntil ?? 0;

  const uncovered = messages.filter((message) => message.createdAt > coveredUntil);
  if (uncovered.length < SUMMARISE_AFTER) return;

  // Everything except the turns still being sent verbatim: summarising those
  // too would just duplicate them in the next request.
  const toSummarise = uncovered.slice(0, uncovered.length - VERBATIM_MESSAGES);
  if (toSummarise.length === 0) return;

  const transcript = toSummarise
    .map((message) => `${message.role === 'user' ? 'She' : 'Coach'}: ${message.content}`)
    .join('\n');

  const result = await chat(
    [
      { role: 'system', content: SUMMARY_PROMPT },
      ...(previous
        ? [
            {
              role: 'system' as const,
              content: `The previous summary, which yours should absorb and replace:\n${previous.content}`,
            },
          ]
        : []),
      { role: 'user', content: transcript },
    ],
    { maxTokens: 600, temperature: 0.2 },
  );

  if (!result.ok) return;

  await addCoachNote('summary', result.text, toSummarise.at(-1)!.createdAt);
}

/**
 * Openers, chosen from her actual state rather than a fixed list.
 *
 * An empty chat box is the reason most in-app assistants go unused, and a
 * generic "ask me anything" chip does not fix it. These name something the app
 * already knows is true about her week.
 */
export function suggestedQuestions(input: {
  hasStall: boolean;
  hasNutrition: boolean;
  tracksCycle: boolean;
  hybrid: boolean;
  sessions: number;
}): string[] {
  const questions: string[] = [];

  if (input.hasStall) questions.push('Why has one of my lifts stopped moving?');
  if (input.sessions === 0) questions.push('What should I expect from my first session?');
  else questions.push('How is my training actually going?');

  if (input.hasNutrition) {
    // First, and phrased as an instruction rather than a question, because it
    // is the one that ends in something landing in her log.
    questions.unshift('Give me a dinner that hits my protein.');
    questions.push('Explain my calorie target to me.');
  }
  if (input.tracksCycle) {
    questions.push('Should I train differently around my period?');
  }
  if (input.hybrid) {
    questions.push('Is my cardio getting in the way of my lifting?');
  }
  questions.push('What am I neglecting?');

  return questions.slice(0, 5);
}
