import type { CustomFood } from '../db/schema';

/**
 * Guessing what she ate.
 *
 * This is the one place a model is allowed near a number that lands in the
 * log, so it is worth being exact about why that does not break rule one.
 *
 * The app's rule is that the AI never *decides* a number: not the weight, not
 * the calorie target, not the macros she is aiming for. Those are
 * prescriptions, and a prescription invented by a language model is a
 * prescription nobody can check. This is the opposite direction. She ate a
 * shawarma wrap. The wrap has a calorie content whether or not anybody knows
 * it, the app cannot look it up, and her three options are a guess, a blank
 * row, or giving up on logging that day. A rough number she can see, edit and
 * correct beats a hole in the log, and it beats the far more common failure
 * where a food app has nothing for her dinner so she stops opening it.
 *
 * What keeps it honest:
 *
 *   - Every field is bounded here, in code, against what food can physically
 *     be. A misread "two wraps" cannot become 12,000 kcal.
 *   - The macros and the calories have to agree. A model that returns "600
 *     kcal, 8 g protein, 10 g carbohydrate, 3 g fat" has contradicted itself,
 *     and the arithmetic wins - otherwise the ring for calories and the ring
 *     for protein would be telling her two different stories about one meal.
 *   - It lands on a card she edits before anything is written. What she taps
 *     is what gets logged, exactly as with the coach's meal proposals.
 *   - The row is flagged `estimated` for good, and the screen says so. An
 *     estimate she accepted is still an estimate.
 */

export interface FoodEstimate extends CustomFood {
  /** How the calorie figure was arrived at, so the card can say. */
  kcalSource: 'model' | 'macros';
}

/* -------------------------------- bounds -------------------------------- */

/*
 * What one portion of one food can be. These are not tuned to be tight; they
 * are here so a misparse cannot land something absurd in the log, and every
 * one of them sits well outside anything real.
 */
const MAX_NAME = 60;
const MAX_SERVING = 40;
const LIMITS = {
  kcal: 2000,
  proteinG: 200,
  carbG: 300,
  fatG: 200,
  fibreG: 80,
  ironMg: 30,
} as const;

/** Atwater, with fibre at 2 kcal/g because most of it is not absorbed. */
export function kcalFromMacros(macros: {
  proteinG: number;
  carbG: number;
  fatG: number;
  fibreG: number;
}): number {
  const fibre = Math.min(macros.fibreG, macros.carbG);
  return (
    macros.proteinG * 4 + (macros.carbG - fibre) * 4 + fibre * 2 + macros.fatG * 9
  );
}

/**
 * How far the stated calories may sit from what the macros add up to.
 *
 * Generous, because home cooking varies and both figures are rounded, and
 * because a model that is roughly right about both should not be overruled
 * on a technicality. Past this the two are telling different stories and the
 * arithmetic wins.
 */
const KCAL_TOLERANCE_FRACTION = 0.25;
const KCAL_TOLERANCE_FLOOR = 30;

const clamp = (value: number, max: number): number =>
  Math.min(max, Math.max(0, value));

const asNumber = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

const asText = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  // Collapse whitespace so a multi-line reply cannot become a multi-line row.
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text.slice(0, max);
};

/* ------------------------------- the prompt ------------------------------- */

export const ESTIMATE_OPEN = '<<<FOOD';
export const ESTIMATE_CLOSE = 'FOOD>>>';

export const ESTIMATE_SYSTEM_PROMPT = `You estimate the nutrition of one food or one meal from a short description, for a training app's food log.

Reply with nothing but one block, in exactly this form:

${ESTIMATE_OPEN}
{"name":"Chicken shawarma wrap","serving":"1 wrap","kcal":520,"protein":30,"carbs":48,"fat":22,"fibre":3,"iron":2.1}
${ESTIMATE_CLOSE}

Rules:
- The numbers are for ONE serving as you have described it in "serving", not for everything she said she ate. If she says she had two wraps, describe one wrap; the app multiplies.
- "name" is what she would recognise on a list. Keep it under sixty characters and do not put the quantity in it.
- "serving" is the household portion: "1 wrap", "a large bowl", "1 slice", "100 g".
- Grams for protein, carbs, fat and fibre. Milligrams for iron. Numbers only, no units, no ranges, no text.
- The macros must account for the calories: protein and carbohydrate about 4 kcal per gram, fat about 9. If those do not add up to your calorie figure, fix them before you answer.
- Assume ordinary home or restaurant cooking. Do not assume anything is low fat unless she said so.
- If she describes several different foods, estimate the whole plate as one item and name it for the meal.
- No prose, no explanation, no apology, no markdown fence. The block only.`;

export function estimatePrompt(description: string): string {
  return `Estimate this: ${description.replace(/\s+/g, ' ').trim().slice(0, 400)}`;
}

/* ------------------------------- the parser ------------------------------- */

function extractJson(text: string): Record<string, unknown> | null {
  // The block if it kept the format, otherwise the outermost braces in the
  // reply. A model that drops the markers but returns the object is a model
  // that has done the job, and refusing it only makes the feature look broken.
  const start = text.indexOf(ESTIMATE_OPEN);
  const body =
    start === -1
      ? text
      : text.slice(
          start + ESTIMATE_OPEN.length,
          text.includes(ESTIMATE_CLOSE, start)
            ? text.indexOf(ESTIMATE_CLOSE, start)
            : undefined,
        );

  const cleaned = body.replace(/```[a-z]*/gi, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last <= first) return null;

  try {
    const parsed: unknown = JSON.parse(cleaned.slice(first, last + 1));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * What the model said, bounded into something that can go in a log.
 *
 * Returns null rather than a plausible-looking row when it cannot find a name
 * or any energy at all - the screen falls back to asking her, which is a
 * worse experience than a good guess and a much better one than a wrong
 * number she never saw arrive.
 */
export function parseEstimate(
  text: string,
  fallbackName?: string,
): FoodEstimate | null {
  const raw = extractJson(text);
  if (!raw) return null;

  const name = asText(raw.name, MAX_NAME) ?? asText(fallbackName, MAX_NAME);
  if (!name) return null;

  const macros = {
    proteinG: round1(clamp(asNumber(raw.protein) ?? 0, LIMITS.proteinG)),
    carbG: round1(clamp(asNumber(raw.carbs) ?? 0, LIMITS.carbG)),
    fatG: round1(clamp(asNumber(raw.fat) ?? 0, LIMITS.fatG)),
    fibreG: round1(clamp(asNumber(raw.fibre) ?? 0, LIMITS.fibreG)),
  };

  const stated = asNumber(raw.kcal);
  const fromMacros = Math.round(kcalFromMacros(macros));

  // Nothing to go on at all: no calories and no macros is not an estimate.
  if ((stated === null || stated <= 0) && fromMacros <= 0) return null;

  const bounded = stated === null ? 0 : Math.round(clamp(stated, LIMITS.kcal));
  const tolerance = Math.max(KCAL_TOLERANCE_FLOOR, bounded * KCAL_TOLERANCE_FRACTION);

  // The arithmetic wins a disagreement. Two rings on the Fuel screen read
  // these numbers separately, and a row whose calories and macros contradict
  // each other makes the two of them tell different stories about one meal.
  const agrees = bounded > 0 && Math.abs(fromMacros - bounded) <= tolerance;
  const useStated = agrees || fromMacros <= 0;

  return {
    name,
    serving: asText(raw.serving, MAX_SERVING) ?? '1 portion',
    kcal: useStated ? bounded : Math.min(LIMITS.kcal, fromMacros),
    ...macros,
    ironMg: round1(clamp(asNumber(raw.iron) ?? 0, LIMITS.ironMg)),
    estimated: true,
    kcalSource: useStated ? 'model' : 'macros',
  };
}

/**
 * The same bounding, for numbers she typed herself.
 *
 * Shares the limits deliberately: a slipped decimal point is a slipped
 * decimal point whoever typed it, and having two sets of rules is how the
 * form and the estimate end up disagreeing about what a valid row is.
 */
export function boundCustomFood(input: {
  name: string;
  serving?: string;
  kcal: number;
  proteinG: number;
  carbG?: number;
  fatG?: number;
  fibreG?: number;
  ironMg?: number;
  estimated?: boolean;
}): CustomFood | null {
  const name = asText(input.name, MAX_NAME);
  if (!name) return null;

  const kcal = Math.round(clamp(asNumber(input.kcal) ?? 0, LIMITS.kcal));
  if (kcal <= 0) return null;

  return {
    name,
    serving: asText(input.serving, MAX_SERVING) ?? '1 portion',
    kcal,
    proteinG: round1(clamp(asNumber(input.proteinG) ?? 0, LIMITS.proteinG)),
    carbG: round1(clamp(asNumber(input.carbG) ?? 0, LIMITS.carbG)),
    fatG: round1(clamp(asNumber(input.fatG) ?? 0, LIMITS.fatG)),
    fibreG: round1(clamp(asNumber(input.fibreG) ?? 0, LIMITS.fibreG)),
    ironMg: round1(clamp(asNumber(input.ironMg) ?? 0, LIMITS.ironMg)),
    ...(input.estimated ? { estimated: true as const } : {}),
  };
}

export const ESTIMATE_CAVEAT =
  'This is a guess from a description, not a measurement. It is in your log as an estimate. Change any number that looks wrong to you, because you saw the plate and it did not.';
