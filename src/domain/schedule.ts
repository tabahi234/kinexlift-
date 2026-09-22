import type { Profile, SetLog } from '../db/schema';
import { e1rm } from './progression';
import { exerciseName } from './exercises';

/**
 * When she trains, and what the app says when she has.
 *
 * Three things from the first round of testing, all about the shape of a
 * week rather than the shape of a session:
 *
 *   - Which days. The rotation (A, B, C) decides what the next session is;
 *     the days she picked decide when the app expects her. Missing a Tuesday
 *     still does not skip a session - she picks up where she left off.
 *   - A pause after a session. Finishing used to reveal the next session
 *     with a Start button under it, which invited two in a row and gave the
 *     one she had just done no ending at all. Now the next one opens eight
 *     hours later, and the screen in between says what she did.
 *   - A gap. Coming back after a week should feel like a door held open,
 *     not a scoreboard, so the note is short and the weights are unchanged.
 *
 * Pure: takes plain values and a clock, returns decisions.
 */

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Monday-first, because that is how a week is planned. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * Sensible days for a count, used as the starting point of the picker and
 * as the answer for a profile that predates the picker. Alternating days
 * with a weekend gap, which is what most programmes assume.
 */
export const DEFAULT_DAYS: Record<number, number[]> = {
  1: [1],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};

/**
 * The days she trains. A profile from before v3 has none recorded, and for
 * it the honest answer is "any day" - that is how the app behaved when she
 * set it up, and inventing Mon/Wed/Fri for her would put a "rest day" in
 * front of someone who has always trained on Tuesdays.
 */
export function trainingDaysOf(profile: Pick<Profile, 'trainingDays'>): number[] | null {
  const days = profile.trainingDays;
  if (!days || days.length === 0) return null;
  return normaliseDays(days);
}

/** Sorted Monday-first, de-duplicated, only real weekdays. */
export function normaliseDays(days: number[]): number[] {
  const set = new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  return WEEK_ORDER.filter((day) => set.has(day));
}

export function isTrainingDay(days: number[] | null, date: Date): boolean {
  if (days === null) return true;
  return days.includes(date.getDay());
}

/**
 * The next training day strictly after `from`. Null when there are no
 * training days at all, which the picker does not allow but the data could.
 */
export function nextTrainingDate(days: number[] | null, from: Date): Date | null {
  if (days === null) return addDays(from, 1);
  if (days.length === 0) return null;
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = addDays(from, offset);
    if (days.includes(candidate.getDay())) return candidate;
  }
  return null;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** "tomorrow", "on Thursday", or "next Monday". */
export function describeNextTrainingDay(days: number[] | null, from: Date): string {
  const next = nextTrainingDate(days, from);
  if (!next) return 'when you pick a training day';
  const diff = Math.round((startOfDay(next).getTime() - startOfDay(from).getTime()) / DAY_MS);
  if (diff === 1) return 'tomorrow';
  if (diff < 7) return `on ${WEEKDAY_LONG[next.getDay()]}`;
  return `next ${WEEKDAY_LONG[next.getDay()]}`;
}

function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

const DAY_MS = 86_400_000;

/* ------------------------------ the gate ------------------------------ */

/**
 * Eight hours. Long enough that "finish, then start the next one" is not
 * an option; short enough that a morning session and an evening one on a
 * genuinely two-a-day schedule can both happen through the override.
 */
export const SESSION_COOLDOWN_MS = 8 * 60 * 60 * 1000;

export type SessionGate =
  | { kind: 'open' }
  /** She finished a session recently. The next one opens at `opensAt`. */
  | { kind: 'cooldown'; opensAt: number; finishedAt: number }
  /** Not one of her training days. */
  | { kind: 'rest-day'; next: string };

export function sessionGate(input: {
  now: number;
  /** endedAt of the most recent finished session, or null. */
  lastFinishedAt: number | null;
  trainingDays: number[] | null;
  /** She used the override for today. */
  overridden: boolean;
}): SessionGate {
  if (input.overridden) return { kind: 'open' };

  if (input.lastFinishedAt !== null) {
    const opensAt = input.lastFinishedAt + SESSION_COOLDOWN_MS;
    if (input.now < opensAt) {
      return { kind: 'cooldown', opensAt, finishedAt: input.lastFinishedAt };
    }
  }

  const today = new Date(input.now);
  if (!isTrainingDay(input.trainingDays, today)) {
    return { kind: 'rest-day', next: describeNextTrainingDay(input.trainingDays, today) };
  }

  return { kind: 'open' };
}

/** "opens at 6:30 am" or "opens in 2 h 15 min" - whichever reads better. */
export function describeOpensAt(opensAt: number, now: number): string {
  const remaining = Math.max(0, opensAt - now);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.ceil((remaining % 3_600_000) / 60_000);
  if (hours === 0) return minutes <= 1 ? 'opens in a minute' : `opens in ${minutes} min`;
  return `opens in ${hours} h ${minutes === 60 ? 0 : minutes} min`;
}

/* ----------------------------- welcome back ----------------------------- */

/** Three days is one missed session at most cadences. Below that, silence. */
export const GAP_DAYS = 3;

/**
 * The note for a return after a gap, or null when there is nothing to say.
 * No streak, no count of missed sessions, no "we missed you".
 */
export function gapNote(daysSinceLastSession: number | null): string | null {
  if (daysSinceLastSession === null || daysSinceLastSession < GAP_DAYS) return null;
  if (daysSinceLastSession < 7) {
    return `It has been ${daysSinceLastSession} days. That is fine - the session below picks up exactly where you left off, weights included.`;
  }
  if (daysSinceLastSession < 21) {
    return `It has been ${daysSinceLastSession} days. Nothing has been lost. Today's weights are the ones you last lifted; if they feel heavy, the check-in will ease them.`;
  }
  return `Welcome back. After a few weeks off, the first session is about moving again rather than matching old numbers - take the lighter option if the check-in offers it.`;
}

/* ---------------------------- session summary ---------------------------- */

export interface SessionSummary {
  sets: number;
  reps: number;
  /** Sum of weight × reps across every working set, in kg. */
  volumeKg: number;
  exercises: number;
  /** Lifts whose best estimated 1RM today beat everything on record. */
  bests: string[];
}

/**
 * What she just did, in numbers she can feel good about.
 *
 * `previous` is the best e1RM on record per exercise, from before this
 * session. A best is only claimed against real history: a first-ever set
 * of anything is a starting point, not a record.
 */
export function summariseSession(
  sets: SetLog[],
  previousBest: Map<string, number>,
): SessionSummary {
  const working = sets.filter((set) => !set.isWarmup && set.deletedAt === null);
  const byExercise = new Map<string, number>();
  let volume = 0;
  let reps = 0;

  for (const set of working) {
    reps += set.reps;
    volume += set.weightKg * set.reps;
    const best = e1rm(set.weightKg, set.reps, set.rir) ?? 0;
    byExercise.set(set.exerciseId, Math.max(byExercise.get(set.exerciseId) ?? 0, best));
  }

  const bests: string[] = [];
  for (const [exerciseId, todayBest] of byExercise) {
    const before = previousBest.get(exerciseId);
    if (before !== undefined && before > 0 && todayBest > before + 0.5) {
      bests.push(exerciseName(exerciseId));
    }
  }

  return {
    sets: working.length,
    reps,
    volumeKg: Math.round(volume),
    exercises: byExercise.size,
    bests,
  };
}

/** One warm sentence. Varies with what happened, never with a streak. */
export function praiseFor(summary: SessionSummary, conditioning: boolean): string {
  if (conditioning) return 'Conditioning done. That is the session that is easiest to skip, and you did not.';
  if (summary.bests.length === 1) return `A new best on the ${summary.bests[0]!.toLowerCase()}. That is the programme working.`;
  if (summary.bests.length > 1) return `New bests on ${summary.bests.length} lifts. That is the programme working.`;
  if (summary.volumeKg >= 3000) return `${summary.volumeKg.toLocaleString()} kg moved. Go and eat something.`;
  if (summary.sets >= 9) return 'Every set logged. Consistency is the whole trick, and this was a day of it.';
  return 'Done. Showing up is most of it.';
}
