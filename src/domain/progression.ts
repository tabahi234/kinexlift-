import type { Experience } from '../db/schema';
import type { Exercise } from './exercises';
// Type-only, so this does not create a runtime import cycle with readiness.ts.
import type { ReadinessAdjustment } from './readiness';

/**
 * The progression engine.
 *
 * Every function here is pure - no database, no clock, no React. That is
 * deliberate: this is the code that decides what she lifts, so it has to be
 * exhaustively testable, and it has to give the same answer offline as online.
 * The AI layer in P5 explains these decisions; it never makes them.
 */

export type RepRange = readonly [number, number];

export interface WorkingSet {
  weightKg: number;
  reps: number;
  /** Reps in reserve. Null when she did not rate the set. */
  rir: number | null;
}

/** Most recent session first. Each entry is one session's working sets. */
export type SessionHistory = WorkingSet[][];

export type PrescriptionKind = 'calibrate' | 'hold' | 'increase' | 'deload';

export interface Prescription {
  weightKg: number;
  sets: number;
  repRange: RepRange;
  kind: PrescriptionKind;
  /** Shown to her verbatim. Plain language, no jargon. */
  rationale: string;
  /**
   * Present when a low-readiness check-in moved this prescription. Carries the
   * untouched numbers so the screen can show what it changed and offer to put
   * it back. Set by applyReadiness, never by prescribe.
   */
  readiness?: ReadinessAdjustment;
}

/** Unrated sets are assumed to have been reasonably hard, not maximal. */
const ASSUMED_RIR = 2;

/** At or below this, a set counts as hard enough to earn a weight increase. */
const EFFORT_THRESHOLD = 2;

const EXPERIENCE_MULTIPLIER: Record<Experience, number> = {
  never: 1,
  some: 1.35,
  experienced: 1.7,
};

/* ------------------------------- estimates ------------------------------- */

/**
 * Estimated one-rep max, with reps-in-reserve folded in so a set taken to
 * failure is not scored the same as an easy one.
 *
 * Epley is only trustworthy in low rep ranges, so above roughly 12 total reps
 * this returns null rather than a confident wrong number. Charts should skip
 * those points instead of drawing them.
 */
export function e1rm(weightKg: number, reps: number, rir: number | null): number | null {
  if (weightKg <= 0 || reps <= 0) return null;
  const effectiveReps = reps + (rir ?? ASSUMED_RIR);
  if (effectiveReps > 12) return null;
  return weightKg * (1 + effectiveReps / 30);
}

export function bestE1rm(sets: WorkingSet[]): number | null {
  let best: number | null = null;
  for (const set of sets) {
    const estimate = e1rm(set.weightKg, set.reps, set.rir);
    if (estimate !== null && (best === null || estimate > best)) best = estimate;
  }
  return best;
}

/* ------------------------------- rounding ------------------------------- */

export function roundTo(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

/**
 * Barbells load in pairs, so a 33.75 kg suggestion is not something she can
 * actually put on the bar even when the progression step is 1.25.
 */
export function loadableStep(exercise: Exercise): number {
  return exercise.equipment.includes('barbell')
    ? Math.max(exercise.incrementKg, 2.5)
    : exercise.incrementKg;
}

export function startingWeight(exercise: Exercise, experience: Experience): number {
  if (exercise.incrementKg === 0) return 0;
  const scaled = exercise.startingKg * EXPERIENCE_MULTIPLIER[experience];
  return roundTo(scaled, loadableStep(exercise));
}

/* ------------------------------ progression ------------------------------ */

const totalReps = (sets: WorkingSet[]): number =>
  sets.reduce((sum, set) => sum + set.reps, 0);

const averageRir = (sets: WorkingSet[]): number => {
  if (sets.length === 0) return ASSUMED_RIR;
  return sets.reduce((sum, set) => sum + (set.rir ?? ASSUMED_RIR), 0) / sets.length;
};

/** The heaviest weight used in a session, which is what she is progressing. */
const sessionWeight = (sets: WorkingSet[]): number =>
  sets.reduce((max, set) => Math.max(max, set.weightKg), 0);

/**
 * A stall is three sessions at the same weight with no rep improvement. Two
 * is a bad night's sleep; three is a pattern worth acting on.
 */
export function detectStall(history: SessionHistory): boolean {
  const recent = history.slice(0, 3).filter((session) => session.length > 0);
  if (recent.length < 3) return false;

  const weight = sessionWeight(recent[0]!);
  if (!recent.every((session) => sessionWeight(session) === weight)) return false;

  // history is newest-first, so improvement means each session beat the one after it.
  return !recent.some(
    (session, index) =>
      index < recent.length - 1 && totalReps(session) > totalReps(recent[index + 1]!),
  );
}

/**
 * Double progression: hold the weight until every working set reaches the top
 * of the rep range at a hard-but-not-maximal effort, then add the smallest
 * increment and drop back to the bottom of the range.
 *
 * Boring on purpose. It is what actually builds strength over a year, and it
 * needs no more input than she is already giving.
 */
export function prescribe(
  exercise: Exercise,
  history: SessionHistory,
  options: { sets: number; repRange: RepRange; experience: Experience },
): Prescription {
  const { sets, repRange, experience } = options;
  const [bottom, top] = repRange;
  const timed = exercise.unit === 'seconds';
  const unit = timed ? 'seconds' : 'reps';
  const completed = history.filter((session) => session.length > 0);

  if (completed.length === 0) {
    const weightKg = startingWeight(exercise, experience);
    return {
      weightKg,
      sets,
      repRange,
      kind: 'calibrate',
      rationale:
        exercise.incrementKg === 0
          ? `First time. Aim for ${bottom}-${top} good ${unit} and note how it felt.`
          : `First time. Start here and adjust - you want to stop about 2 reps short.`,
    };
  }

  const last = completed[0]!;
  const currentWeight = sessionWeight(last);

  // Bodyweight movements have no external load, so progression is in reps or,
  // for a hold, in seconds.
  if (exercise.incrementKg === 0) {
    const hitTop = last.every((set) => set.reps >= top);
    const harder = timed
      ? `You held ${top} seconds on every set. Add a few more, or try it one-armed.`
      : `You cleared ${top} on every set. Slow the lowering down to make it harder.`;

    return {
      weightKg: 0,
      sets,
      repRange,
      kind: hitTop ? 'increase' : 'hold',
      rationale: hitTop
        ? harder
        : `Last time: ${last.map((set) => set.reps).join(', ')} ${unit}. Beat one of those.`,
    };
  }

  const hitTopOnEverySet = last.every((set) => set.reps >= top);
  const wasHardEnough = averageRir(last) <= EFFORT_THRESHOLD;

  if (hitTopOnEverySet && wasHardEnough) {
    return {
      weightKg: roundTo(currentWeight + exercise.incrementKg, exercise.incrementKg),
      sets,
      repRange,
      kind: 'increase',
      rationale: `You hit ${top} on every set at ${currentWeight} kg. Time to go up.`,
    };
  }

  if (detectStall(completed)) {
    const deloaded = roundTo(currentWeight * 0.9, loadableStep(exercise));
    return {
      weightKg: Math.max(deloaded, exercise.incrementKg),
      sets,
      repRange,
      kind: 'deload',
      rationale: `Three sessions stuck at ${currentWeight} kg. Drop back, rebuild, pass it.`,
    };
  }

  return {
    weightKg: currentWeight,
    sets,
    repRange,
    kind: 'hold',
    rationale: `Last time: ${last.map((set) => set.reps).join(', ')} reps. Add a rep where you can.`,
  };
}
