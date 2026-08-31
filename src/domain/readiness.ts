import type { Checkin, SymptomTag } from '../db/schema';
import type { Exercise } from './exercises';
import { loadableStep, roundTo, type Prescription } from './progression';

/**
 * Readiness autoregulation.
 *
 * This is what replaces cycle-phase programming. Rather than assuming from a
 * calendar how strong she is today, it asks her three questions and adjusts
 * within a narrow, visible, one-tap-reversible range.
 *
 * Two rules keep it honest:
 *   - The adjustment is bounded (never more than 10%) and always shown with the
 *     original weight next to it, so nothing changes silently.
 *   - Symptoms are recorded but deliberately do NOT feed the score. Her energy
 *     rating already encodes how the cramps feel, and double-counting would
 *     bake in the population-level assumption this whole approach exists to
 *     avoid. The symptom log is raw material for per-user pattern detection in
 *     P3, where the app can learn whether they actually matter for her.
 */

export type ReadinessBand = 'green' | 'amber' | 'red';

export interface Readiness {
  /** 0-100. Shown only as a band; the raw number would invite false precision. */
  score: number;
  band: ReadinessBand;
  weightMultiplier: number;
  dropOneSet: boolean;
  headline: string;
  detail: string;
}

export interface ReadinessInput {
  sleep: number;
  energy: number;
  /** Higher means more sore, so it counts against her. */
  soreness: number;
}

export const SCALE_MIN = 1;
export const SCALE_MAX = 5;

/** An average day should be a full session, so the green band starts at 50. */
const GREEN_FROM = 50;
const AMBER_FROM = 30;

const clamp = (value: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(value)));

export function readinessScore(input: ReadinessInput): number {
  const sleep = clamp(input.sleep);
  const energy = clamp(input.energy);
  const soreness = clamp(input.soreness);

  // Soreness is inverted so all three read "higher is better", then the sum is
  // mapped from its 3..15 range onto 0..100.
  const total = sleep + energy + (SCALE_MAX + 1 - soreness);
  return Math.round(((total - 3) / 12) * 100);
}

export function bandFor(score: number): ReadinessBand {
  if (score >= GREEN_FROM) return 'green';
  if (score >= AMBER_FROM) return 'amber';
  return 'red';
}

const COPY: Record<ReadinessBand, { headline: string; detail: string }> = {
  green: {
    headline: 'You are good to go.',
    detail: 'Full session as planned.',
  },
  amber: {
    headline: 'Slightly lighter today.',
    detail: 'Same sets, about 5% off the bar.',
  },
  red: {
    headline: 'Let us bank an easy one.',
    detail: 'About 10% lighter and one set fewer. It still counts.',
  },
};

const MULTIPLIER: Record<ReadinessBand, number> = {
  green: 1,
  amber: 0.95,
  red: 0.9,
};

export function assessReadiness(input: ReadinessInput): Readiness {
  const score = readinessScore(input);
  const band = bandFor(score);

  return {
    score,
    band,
    weightMultiplier: MULTIPLIER[band],
    dropOneSet: band === 'red',
    headline: COPY[band].headline,
    detail: COPY[band].detail,
  };
}

export function readinessFromCheckin(checkin: Checkin | null | undefined): Readiness | null {
  return checkin ? assessReadiness(checkin) : null;
}

/**
 * The one place that decides what "adjustments are on" means.
 *
 * Profiles written before this setting existed have no value for it, and it
 * must read as on everywhere or the screen will claim adjustments are off
 * while the planner quietly applies them.
 */
export function adjustmentsEnabled(profile: {
  readinessAdjustments?: 'on' | 'off';
}): boolean {
  return profile.readinessAdjustments !== 'off';
}

/* ----------------------------- applying it ----------------------------- */

export interface ReadinessAdjustment {
  band: ReadinessBand;
  originalWeightKg: number;
  originalSets: number;
}

/**
 * Applies a readiness band to a prescription.
 *
 * Returns the prescription untouched when there is nothing to do, so the
 * session screen can treat "no check-in", "green" and "adjustments off"
 * identically without special-casing each one.
 */
export function applyReadiness(
  prescription: Prescription,
  exercise: Exercise,
  readiness: Readiness | null,
  enabled = true,
): Prescription {
  if (!enabled || !readiness || readiness.band === 'green') return prescription;

  // Bodyweight work has no load to shave, so only the set count can move.
  const weightKg =
    prescription.weightKg > 0
      ? Math.max(
          exercise.incrementKg,
          roundTo(prescription.weightKg * readiness.weightMultiplier, loadableStep(exercise)),
        )
      : 0;

  const sets = readiness.dropOneSet
    ? Math.max(1, prescription.sets - 1)
    : prescription.sets;

  // On a light lift, 5% can round away to nothing. Attaching an adjustment
  // anyway would make the screen announce "eased from 6 kg" next to 6 kg.
  if (weightKg === prescription.weightKg && sets === prescription.sets) {
    return prescription;
  }

  return {
    ...prescription,
    weightKg,
    sets,
    readiness: {
      band: readiness.band,
      originalWeightKg: prescription.weightKg,
      originalSets: prescription.sets,
    },
  };
}

/* ------------------------------ overrides ------------------------------ */

/** She overrode this many of the last few sessions she was offered a break. */
export interface OverrideTally {
  offered: number;
  overridden: number;
}

const OVERRIDE_WINDOW = 4;
const OVERRIDE_THRESHOLD = 3;

/**
 * True when the app has been wrong often enough that it should stop guessing
 * and ask her directly. Being told "you keep overriding this, shall I stop?"
 * is far better than silently learning to back off, because she can see what
 * the app concluded and disagree with it.
 */
export function shouldOfferToStopAdjusting(tally: OverrideTally): boolean {
  return tally.offered >= OVERRIDE_WINDOW && tally.overridden >= OVERRIDE_THRESHOLD;
}

export { OVERRIDE_WINDOW };

/* ------------------------------- symptoms ------------------------------- */

export interface SymptomChoice {
  id: SymptomTag;
  label: string;
  /** Only offered when she is tracking her cycle. */
  cycleOnly?: boolean;
}

export const SYMPTOM_CHOICES: SymptomChoice[] = [
  { id: 'poor_sleep', label: 'Slept badly' },
  { id: 'high_stress', label: 'Stressed' },
  { id: 'headache', label: 'Headache' },
  { id: 'low_mood', label: 'Low mood' },
  { id: 'cramps', label: 'Cramps', cycleOnly: true },
  { id: 'bloating', label: 'Bloating', cycleOnly: true },
  { id: 'breast_tenderness', label: 'Breast tenderness', cycleOnly: true },
];

export function symptomsFor(tracksCycle: boolean): SymptomChoice[] {
  return SYMPTOM_CHOICES.filter((choice) => tracksCycle || !choice.cycleOnly);
}
