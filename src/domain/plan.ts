import type { Profile } from '../db/schema';
import {
  candidatesWithFallback,
  getExercise,
  isTimed,
  TIMED_RANGE,
  type Exercise,
  type Equipment,
  type SelectionContext,
} from './exercises';
import { prescribe, type Prescription, type RepRange, type SessionHistory } from './progression';
import { adjustmentsEnabled, applyReadiness, type Readiness } from './readiness';
import {
  nextDay,
  programFor,
  repRangeFor,
  setsForGoal,
  type Program,
  type TemplateDay,
} from './templates';

/**
 * Turns a profile plus her training history into today's session.
 *
 * Pure: takes history in, returns a plan out. The database wrapper lives in
 * ui/useTodaysPlan so this stays trivially testable.
 */

export interface PlannedExercise {
  /** `${dayId}:${slotIndex}` - stable key for swaps and for logging. */
  slotKey: string;
  exercise: Exercise;
  prescription: Prescription;
  /** Everything else she could do for this slot, for the swap sheet. */
  alternatives: Exercise[];
}

export interface PlannedSession {
  program: Program;
  day: TemplateDay;
  exercises: PlannedExercise[];
}

export function selectionContextFor(profile: Profile): SelectionContext {
  return {
    equipment: profile.equipment as Equipment[],
    experience: profile.experience,
    limitations: profile.limitations,
  };
}

/** Every exercise id the plan will need history for. */
export function exerciseIdsForDay(day: TemplateDay, profile: Profile): string[] {
  const context = selectionContextFor(profile);
  const chosen: string[] = [];

  day.slots.forEach((slot, index) => {
    const exercise = resolveSlot(day, index, slot.pattern, profile, context, chosen);
    if (exercise) chosen.push(exercise.id);
  });

  return chosen;
}

/**
 * Picks the exercise for one slot: her saved swap if it is still available,
 * otherwise the best candidate she has not already been given today.
 */
function resolveSlot(
  day: TemplateDay,
  slotIndex: number,
  pattern: TemplateDay['slots'][number]['pattern'],
  profile: Profile,
  context: SelectionContext,
  alreadyChosen: string[],
): Exercise | null {
  const options = candidatesWithFallback(pattern, context);
  if (options.length === 0) return null;

  const overrideId = profile.exerciseOverrides?.[`${day.id}:${slotIndex}`];
  if (overrideId) {
    const override = options.find((exercise) => exercise.id === overrideId);
    if (override) return override;
  }

  // Two slots can share a pattern; do not hand her the same lift twice.
  return options.find((exercise) => !alreadyChosen.includes(exercise.id)) ?? options[0]!;
}

export function buildSession(
  day: TemplateDay,
  program: Program,
  profile: Profile,
  historyByExercise: Map<string, SessionHistory>,
  readiness: Readiness | null = null,
): PlannedSession {
  const context = selectionContextFor(profile);
  const adjustmentsOn = adjustmentsEnabled(profile);
  const goalRange = repRangeFor(profile.goal);
  const mainSets = setsForGoal(profile.goal);
  const chosen: string[] = [];
  const exercises: PlannedExercise[] = [];

  day.slots.forEach((slot, index) => {
    const exercise = resolveSlot(day, index, slot.pattern, profile, context, chosen);
    if (!exercise) return;
    chosen.push(exercise.id);

    // A hold is prescribed in seconds, so neither the goal's rep range nor the
    // slot's light range applies to it.
    const repRange: RepRange = isTimed(exercise)
      ? TIMED_RANGE
      : (slot.repRange ?? goalRange);
    const sets = slot.repRange ? slot.sets : Math.max(slot.sets, mainSets - 1);

    const prescription = prescribe(exercise, historyByExercise.get(exercise.id) ?? [], {
      sets,
      repRange,
      experience: profile.experience,
    });

    exercises.push({
      slotKey: `${day.id}:${index}`,
      exercise,
      prescription: applyReadiness(prescription, exercise, readiness, adjustmentsOn),
      alternatives: candidatesWithFallback(slot.pattern, context).filter(
        (option) => option.id !== exercise.id,
      ),
    });
  });

  return { program, day, exercises };
}

export function planFor(
  profile: Profile,
  lastCompletedDayId: string | null,
  historyByExercise: Map<string, SessionHistory>,
  readiness: Readiness | null = null,
): PlannedSession {
  const program = programFor(profile.daysPerWeek);
  const day = nextDay(program, lastCompletedDayId);
  return buildSession(day, program, profile, historyByExercise, readiness);
}

export function dayForRotation(profile: Profile, lastCompletedDayId: string | null): {
  program: Program;
  day: TemplateDay;
} {
  const program = programFor(profile.daysPerWeek);
  return { program, day: nextDay(program, lastCompletedDayId) };
}

export { getExercise };
