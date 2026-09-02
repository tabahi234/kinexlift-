import type { MealSlot } from '../db/schema';
import { isBodyweight, isTimed, type Exercise } from './exercises';
import { addNutrients, NO_NUTRIENTS, scale, type Food, type Nutrients } from './foods';

/**
 * What the coach is allowed to change, and how it asks.
 *
 * Up to now the coach could only talk. That was the safe answer to a real
 * problem - a model let loose on a training log will invent a personal best -
 * but it made the most obvious request in the app ("give me a dinner that hits
 * my protein") end in a paragraph she then had to retype into the food picker
 * by hand, item by item. That is not a coach, that is dictation.
 *
 * So the model may now propose, and only propose. Three things, every one of
 * which she could already do herself in the UI:
 *
 *   1. Food to add to today's log.
 *   2. Swapping an exercise in today's session for one already offered as an
 *      alternative for that slot.
 *   3. Sets she has already done and told it about, which is the one thing she
 *      would rather say out loud than tap in while holding a barbell.
 *
 * Everything that made the old rule safe still holds, because none of it was
 * about talking:
 *
 *   - The model picks *ids from a list we gave it*. It cannot invent a food,
 *     a portion size or a macro; every number on the card is computed here
 *     from the same table the Fuel screen reads.
 *   - Anything it names that is not on the list is dropped, and the card says
 *     so rather than quietly serving her something she does not eat.
 *   - A proposal is a card. It is written to the database when she taps it,
 *     never when the model says it.
 *   - It still cannot touch a weight, a set count, a calorie target or a
 *     setting. Those belong to the engine and they stay there.
 *
 * Parsing lives next to the prompt that produces the format on purpose. If one
 * changes without the other the tests below fail immediately, which is the
 * only real defence against a protocol that drifts.
 */

export const PROPOSAL_OPEN = '<<<PROPOSAL';
export const PROPOSAL_CLOSE = 'PROPOSAL>>>';

export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Half a serving is the smallest thing anyone actually plates up. */
const MIN_SERVINGS = 0.5;
/** Above this it is not a portion, it is a rounding error with a plate. */
const MAX_SERVINGS = 6;
const MAX_ITEMS = 10;
const MAX_SWAPS = 4;

/**
 * Bounds for a logged set. Every one of these is here because a log is not a
 * suggestion: what lands in it is what the progression engine reads next week,
 * so a misread "3 x 10" must not be able to become 310 kilograms.
 */
const MAX_LOG_ENTRIES = 6;
const MAX_WEIGHT_KG = 500;
const MAX_REPS = 100;
const MAX_SECONDS = 600;
const MAX_SET_COUNT = 10;
const MAX_RIR = 4;

/* ------------------------------- the shapes ------------------------------- */

export interface ProposedItem {
  food: Food;
  servings: number;
  slot: MealSlot;
}

export interface MealProposal {
  kind: 'meal';
  items: ProposedItem[];
  /** Everything it named that we would not serve, in its own words. */
  dropped: string[];
}

export interface ProposedSwap {
  slotKey: string;
  from: Exercise;
  to: Exercise;
}

export interface SessionProposal {
  kind: 'session';
  swaps: ProposedSwap[];
  dropped: string[];
}

export interface ProposedSet {
  exercise: Exercise;
  weightKg: number;
  /** Seconds rather than repetitions on a hold. */
  reps: number;
  /** How many identical sets of it. */
  sets: number;
  rir: number | null;
}

/**
 * Sets she has already done, told in a sentence.
 *
 * "I did three sets of ten on the squat at 22.5" is faster to say than it is
 * to tap in, and it is the one thing she is most likely to want to do while
 * still holding a barbell. The card that comes back is the same numbers the
 * steppers would have produced, and it goes in her log the same way.
 */
export interface LogProposal {
  kind: 'log';
  sets: ProposedSet[];
  dropped: string[];
}

export type Proposal = MealProposal | SessionProposal | LogProposal;

/** One slot of today's session, as the swap sheet already knows it. */
export interface SlotOffer {
  slotKey: string;
  exercise: Exercise;
  alternatives: Exercise[];
  /** What the engine prescribed, so the model can fill in a weight she omitted. */
  weightKg: number;
  sets: number;
  repRange: readonly [number, number];
}

export interface ProposalContext {
  /** Already filtered by her diet pattern and her avoid list. */
  pantry: Food[];
  slots: SlotOffer[];
  /** Exercises a logged set may name. The catalogue advertises today's only. */
  loggable: Exercise[];
  /** Where food goes when the model does not say. */
  defaultSlot: MealSlot;
}

/* ------------------------------- the prompt ------------------------------- */

/**
 * The rules the model works under when it wants to change something.
 *
 * Written at the model rather than at a person, but it is shown to her
 * verbatim in the coach's "what it can see" drawer, so it stays honest about
 * what the app will and will not do with what comes back.
 */
export const PROPOSAL_PROTOCOL = `PUTTING SOMETHING IN HER LOG

You can propose exactly three things, and all three are things she can already do herself in the app:
1. Food to add to today's food log.
2. Swapping an exercise in today's session for one of the alternatives listed for that slot.
3. Sets she has already done, when she tells you what she did.

A proposal is a card that appears under your answer. She can change the portions, drop an item, or ignore it. Nothing reaches her log until she taps to accept it, so propose confidently rather than asking permission twice.

How to send one:
- Answer in prose first, in your normal voice. Say what the food is and why it fits her numbers.
- Make the last sentence before the block an offer to change it, and ask it as a question: "Want it with rice instead, or a bigger portion?" "Happy with that, or would you rather keep the squat?" Never end on your own decision.
- Never say you have added it, are adding it, or will add it. You have not - she has not tapped anything yet. "Let me add that for you" is wrong for the same reason.
- Then end the message with the block, on its own lines, nothing after it:

${PROPOSAL_OPEN}
{"type":"meal","items":[{"food":"chicken-breast","servings":1,"slot":"dinner"},{"food":"roti","servings":2,"slot":"dinner"}]}
${PROPOSAL_CLOSE}

or:

${PROPOSAL_OPEN}
{"type":"session","swaps":[{"slot":"lower-a:0","exercise":"goblet-squat"}]}
${PROPOSAL_CLOSE}

or, when she tells you what she has already lifted:

${PROPOSAL_OPEN}
{"type":"log","sets":[{"exercise":"barbell-back-squat","weight":22.5,"reps":10,"sets":3,"rir":2}]}
${PROPOSAL_CLOSE}

Rules for the block:
- "food", "exercise" and "slot" must be ids copied exactly from the lists below. An id you invent is dropped and she sees nothing for it.
- Only use foods from the list. It is already filtered to what she eats.
- "servings" counts the serving shown in the list, between 0.5 and 6, in halves.
- A food's "slot" is breakfast, lunch, dinner or snack.
- Only propose a swap for a slot in today's session, and only to an exercise listed as an alternative for that slot.
- For a log: "weight" is kilograms and is 0 for a bodyweight movement, "reps" is repetitions - or seconds on a hold - "sets" is how many identical sets of it, and "rir" is reps left in reserve from 0 to 4, left out if she did not say.
- Never invent a number she did not give you for a log. If she says how many sets and reps but not the weight, use the weight prescribed for that exercise in the session list below, and say in the prose that that is what you have assumed. If you cannot tell which exercise she means, ask instead of guessing.
- One thing at a time. A message proposes food, or a swap, or a log - never two kinds at once.
- One block per message, at the very end. No code fences around it, no second block, no text after it.
- Send a block only when she asked for food or for a change to today's session. Explaining something does not need one.
- Never mention the block, JSON, or a "proposal". She sees a card, not this. Do not say "I've added it" either - she has not tapped it yet.
- Every number you say in the prose must match the block.`;

/** The food table, as the model needs to see it to name ids. */
export function foodCatalogue(pantry: Food[]): string {
  const lines = pantry.map(
    (food) =>
      `${food.id} | ${food.name} | one serving = ${food.serving} | ${food.kcal} kcal | ${food.proteinG} g protein`,
  );
  return `FOODS SHE CAN EAT (id | name | serving | per serving)\n${lines.join('\n')}`;
}

/** Today's slots, what fills them, and what may replace them. */
export function sessionCatalogue(slots: SlotOffer[], dayName: string): string {
  if (slots.length === 0) {
    return `TODAY'S SESSION: ${dayName}. There are no exercise slots today, so do not propose a swap.`;
  }
  const lines = slots.map((slot) => {
    const options = slot.alternatives
      .slice(0, 6)
      .map((option) => `${option.id} (${option.name})`)
      .join(', ');
    const load = slot.weightKg > 0 ? `${slot.weightKg} kg` : 'bodyweight';
    return [
      `${slot.slotKey}`,
      `now: ${slot.exercise.id} (${slot.exercise.name})`,
      `prescribed: ${slot.sets} sets of ${slot.repRange[0]}-${slot.repRange[1]} at ${load}`,
      `alternatives: ${options || 'none'}`,
    ].join(' | ');
  });
  return `TODAY'S SESSION: ${dayName}\n(slot | current exercise id | what the app prescribed | ids you may swap to)\n${lines.join('\n')}`;
}

/* ------------------------------- extraction ------------------------------- */

/**
 * Splits a reply into what she reads and what the app acts on.
 *
 * Forgiving on purpose. Models wrap things in code fences, use smart quotes
 * around the sentinels and occasionally forget the closing marker at the end
 * of a message - none of which is a reason to show her a wall of JSON.
 */
/**
 * Model prose, with the dashes taken out.
 *
 * The app writes none of its own, and then the coach cheerfully returned
 * "24 g fibre—adds up to the calorie total" and put one on screen anyway.
 * The system prompt asks it not to, which is the better fix because the model
 * rewrites the sentence rather than swapping a character; this is the
 * guarantee behind the request.
 *
 * A comma is the substitution because it is the one that is never wrong,
 * only sometimes slightly loose. A colon or a full stop reads better in
 * particular sentences and badly in the others, and nothing here can tell
 * which sentence it is looking at.
 */
export function withoutDashes(text: string): string {
  return (
    text
      // Spaced: "a thing — and another" becomes "a thing, and another".
      .replace(/\s+[—–]\s+/g, ', ')
      // Closed up: "fibre—adds" becomes "fibre, adds".
      .replace(/[—–]/g, ', ')
      // A dash next to punctuation that was already there leaves a double up.
      .replace(/([,;:])\s*,\s*/g, '$1 ')
      .replace(/,\s*([.!?])/g, '$1')
      // No space before punctuation, which is what a dash at the end of a
      // clause leaves behind once its comma has been removed again.
      .replace(/\s+([,.!?;:])/g, '$1')
      // And never leave a doubled space behind.
      .replace(/ {2,}/g, ' ')
  );
}

export function splitProposal(text: string): { prose: string; raw: unknown | null } {
  const start = text.indexOf(PROPOSAL_OPEN);
  if (start === -1) return { prose: text.trim(), raw: null };

  const after = start + PROPOSAL_OPEN.length;
  const end = text.indexOf(PROPOSAL_CLOSE, after);
  const body = end === -1 ? text.slice(after) : text.slice(after, end);

  const prose = (
    text.slice(0, start) + (end === -1 ? '' : text.slice(end + PROPOSAL_CLOSE.length))
  )
    // A fence opened around the block leaves its opening line behind.
    .replace(/```[a-z]*\s*$/i, '')
    .replace(/^\s*```\s*/m, '')
    .trim();

  const json = body.replace(/```[a-z]*/gi, '').trim();
  if (!json) return { prose, raw: null };

  try {
    return { prose, raw: JSON.parse(json) };
  } catch {
    // Trailing prose after the JSON object is the common failure; take the
    // outermost braces and try once more before giving up.
    const first = json.indexOf('{');
    const last = json.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return { prose, raw: JSON.parse(json.slice(first, last + 1)) };
      } catch {
        /* fall through */
      }
    }
    return { prose, raw: null };
  }
}

/* ------------------------------- validation ------------------------------- */

const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** Portions she could actually serve: halves, and never a silly number of them. */
export function clampServings(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, Math.round(numeric * 2) / 2));
}

const numberOr = (value: unknown, fallback: number): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

/** Kilograms, to the nearest half plate, and never a world record. */
export function clampWeight(value: unknown): number {
  const numeric = numberOr(value, 0);
  return Math.min(MAX_WEIGHT_KG, Math.max(0, Math.round(numeric * 2) / 2));
}

/** Repetitions, or seconds when the movement is a hold. */
export function clampReps(value: unknown, exercise: Exercise): number {
  const max = isTimed(exercise) ? MAX_SECONDS : MAX_REPS;
  return Math.min(max, Math.max(1, Math.round(numberOr(value, 1))));
}

export function clampSetCount(value: unknown): number {
  return Math.min(MAX_SET_COUNT, Math.max(1, Math.round(numberOr(value, 1))));
}

/** Reps in reserve, or null when she did not say. */
export function clampRir(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(MAX_RIR, Math.max(0, Math.round(numeric)));
}

/**
 * Finds the food it meant.
 *
 * Ids first, because that is what it was asked for. Names second, because a
 * model that has just written "two rotis" in the prose will sometimes write
 * "roti" rather than the id in the block, and refusing a match it obviously
 * meant would only make the feature look broken.
 */
function resolveFood(value: unknown, pantry: Food[]): Food | null {
  const raw = asString(value);
  if (!raw) return null;
  const key = normalise(raw);

  return (
    pantry.find((food) => food.id === raw) ??
    pantry.find((food) => normalise(food.id) === key) ??
    pantry.find((food) => normalise(food.name) === key) ??
    pantry.find((food) => normalise(food.name).startsWith(key) && key.length >= 4) ??
    null
  );
}

function resolveExercise(value: unknown, options: Exercise[]): Exercise | null {
  const raw = asString(value);
  if (!raw) return null;
  const key = normalise(raw);
  return (
    options.find((exercise) => exercise.id === raw) ??
    options.find((exercise) => normalise(exercise.id) === key) ??
    options.find((exercise) => normalise(exercise.name) === key) ??
    null
  );
}

function resolveSlot(value: unknown, fallback: MealSlot): MealSlot {
  const raw = asString(value);
  if (!raw) return fallback;
  const key = normalise(raw);
  return MEAL_SLOTS.find((slot) => slot === key) ?? fallback;
}

function parseMeal(
  raw: Record<string, unknown>,
  context: ProposalContext,
): MealProposal | null {
  const rows = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(raw.foods)
      ? raw.foods
      : [];
  const mealSlot = resolveSlot(raw.slot, context.defaultSlot);

  const items: ProposedItem[] = [];
  const dropped: string[] = [];

  for (const entry of rows.slice(0, MAX_ITEMS * 2)) {
    const row = asRecord(entry);
    const name = row ? (row.food ?? row.id ?? row.name) : entry;
    const food = resolveFood(name, context.pantry);

    if (!food) {
      const label = asString(name);
      if (label) dropped.push(label);
      continue;
    }

    const slot = resolveSlot(row?.slot ?? row?.meal, mealSlot);
    const servings = clampServings(row?.servings ?? row?.portions ?? 1);

    // The same food twice in one meal is a mistake, not two dishes.
    const existing = items.find((item) => item.food.id === food.id && item.slot === slot);
    if (existing) {
      existing.servings = clampServings(existing.servings + servings);
      continue;
    }

    if (items.length < MAX_ITEMS) items.push({ food, servings, slot });
  }

  if (items.length === 0) return null;
  return { kind: 'meal', items, dropped };
}

function parseSession(
  raw: Record<string, unknown>,
  context: ProposalContext,
): SessionProposal | null {
  const rows = Array.isArray(raw.swaps) ? raw.swaps : [];
  const swaps: ProposedSwap[] = [];
  const dropped: string[] = [];

  for (const entry of rows.slice(0, MAX_SWAPS * 2)) {
    const row = asRecord(entry);
    if (!row) continue;

    const wanted = row.exercise ?? row.to ?? row.exerciseId;

    // Either it names the slot, or it names the exercise it wants replaced.
    const slotKey = asString(row.slot ?? row.slotKey);
    const offer =
      context.slots.find((slot) => slot.slotKey === slotKey) ??
      context.slots.find(
        (slot) =>
          resolveExercise(row.from ?? row.replace ?? slotKey, [slot.exercise]) !== null,
      );

    if (!offer) {
      const label = asString(wanted);
      if (label) dropped.push(label);
      continue;
    }

    const to = resolveExercise(wanted, offer.alternatives);
    if (!to || to.id === offer.exercise.id) {
      const label = asString(wanted);
      if (label) dropped.push(label);
      continue;
    }

    if (swaps.some((swap) => swap.slotKey === offer.slotKey)) continue;
    if (swaps.length < MAX_SWAPS) {
      swaps.push({ slotKey: offer.slotKey, from: offer.exercise, to });
    }
  }

  if (swaps.length === 0) return null;
  return { kind: 'session', swaps, dropped };
}

/**
 * What kind of card a reply carried, whether or not one can still be built
 * from it.
 *
 * An accepted swap makes its own proposal unparseable a second later: the
 * exercise it offered is now the one prescribed, so it is no longer an
 * alternative and validation rightly rejects it. Without this the card she had
 * just tapped would vanish instead of turning into a receipt, which reads as
 * the app having lost her tap.
 */
export function proposalKind(raw: unknown): Proposal['kind'] | null {
  const record = asRecord(raw);
  if (!record) return null;
  const type = normalise(asString(record.type) ?? '');
  if (type === 'session' || type === 'training' || type === 'swap' || type === 'workout') {
    return 'session';
  }
  if (type === 'log' || type === 'logsets' || type === 'sets') return 'log';
  return Array.isArray(record.items) || Array.isArray(record.foods) ? 'meal' : null;
}

/**
 * Sets she says she has already done.
 *
 * Every bound here exists because a model that has misread "3 x 10" once will
 * write 310, and a log is not a suggestion: what goes into it decides what the
 * progression engine prescribes next week. She still sees each number on a
 * stepper before any of it is written.
 */
function parseLog(
  raw: Record<string, unknown>,
  context: ProposalContext,
): LogProposal | null {
  const rows = Array.isArray(raw.sets)
    ? raw.sets
    : Array.isArray(raw.entries)
      ? raw.entries
      : [];

  const sets: ProposedSet[] = [];
  const dropped: string[] = [];

  for (const entry of rows.slice(0, MAX_LOG_ENTRIES * 2)) {
    const row = asRecord(entry);
    const named = row ? (row.exercise ?? row.id ?? row.name) : entry;
    const exercise = resolveExercise(named, context.loggable);

    if (!exercise) {
      const label = asString(named);
      if (label) dropped.push(label);
      continue;
    }

    // The slot, when today's session has one for it: the weight she omitted
    // comes from what the engine actually prescribed, never from the model.
    const slot = context.slots.find((offer) => offer.exercise.id === exercise.id);

    const weightKg = isBodyweight(exercise)
      ? 0
      : clampWeight(row?.weight ?? row?.weightKg ?? slot?.weightKg ?? 0);
    const reps = clampReps(row?.reps ?? row?.seconds ?? slot?.repRange[0] ?? 8, exercise);
    const count = clampSetCount(row?.sets ?? row?.count ?? 1);

    if (sets.length < MAX_LOG_ENTRIES) {
      sets.push({ exercise, weightKg, reps, sets: count, rir: clampRir(row?.rir) });
    }
  }

  if (sets.length === 0) return null;
  return { kind: 'log', sets, dropped };
}

export function parseProposal(raw: unknown, context: ProposalContext): Proposal | null {
  const record = asRecord(raw);
  if (!record) return null;

  const type = normalise(asString(record.type) ?? '');
  if (type === 'session' || type === 'training' || type === 'swap' || type === 'workout') {
    return parseSession(record, context);
  }
  if (type === 'log' || type === 'logsets' || type === 'sets') {
    return parseLog(record, context);
  }
  if (type === 'meal' || type === 'food' || type === 'meals' || type === '') {
    return parseMeal(record, context);
  }
  return null;
}

/** The whole job: what she reads, and what the card offers her. */
export function readProposal(
  text: string,
  context: ProposalContext,
): { prose: string; proposal: Proposal | null } {
  const { prose, raw } = splitProposal(text);
  return { prose, proposal: raw === null ? null : parseProposal(raw, context) };
}

/* -------------------------------- helpers -------------------------------- */

/** Totals for a meal proposal, computed here rather than believed. */
export function totalsOfItems(items: ProposedItem[]): Nutrients {
  return items.reduce(
    (sum, item) => addNutrients(sum, scale(item.food, item.servings)),
    NO_NUTRIENTS,
  );
}

/** Where food goes when the model does not say which meal it is. */
export function slotForHour(hour: number): MealSlot {
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}
