import type { ConditioningLog, ConditioningModality, Experience } from '../db/schema';
import type { Readiness } from './readiness';
import { metKcal } from './nutrition';

/* Equipment ids live in exercises.ts. Taking them as plain strings here keeps
   the conditioning engine free of a dependency on the exercise library, which
   it otherwise has no reason to know about. */
type EquipmentId = string;

/**
 * The hybrid protocol.
 *
 * Conditioning gets the same treatment as lifting: a prescription derived from
 * what she actually logged, progressed by one rule, bounded by the same
 * readiness check-in. Cardio bolted onto a lifting app as a free-text "add
 * 20 minutes of cardio" note is how endurance work stops happening in week
 * three, so it is programmed as days in the rotation instead.
 *
 * Two easy sessions and one hard one is the shape most of the endurance
 * literature converges on. The easy days are the ones that get skipped and the
 * ones that do most of the aerobic work, so the app defaults to them and only
 * offers intervals once there is a base to put them on top of.
 */

export type ConditioningKind = 'easy' | 'intervals';

export interface ModalityInfo {
  id: ConditioningModality;
  label: string;
  /** Compendium of Physical Activities value for a steady effort. */
  met: number;
  /** Needed to do it at all. Empty means anywhere. */
  needs: EquipmentId[];
  note: string;
}

export const MODALITIES: ModalityInfo[] = [
  {
    id: 'walk',
    label: 'Brisk walk',
    met: 3.5,
    needs: [],
    note: 'Fast enough that talking takes effort. The most under-rated session there is.',
  },
  {
    id: 'incline-walk',
    label: 'Incline walk',
    met: 6,
    needs: [],
    note: 'A hill or a treadmill at 8-10%. All the aerobic work, almost none of the impact.',
  },
  {
    id: 'run',
    label: 'Run',
    met: 9,
    needs: [],
    note: 'Easy runs should feel embarrassingly slow. That is the point of them.',
  },
  {
    id: 'bike',
    label: 'Bike',
    met: 7,
    needs: ['machine'],
    note: 'Kind to the knees, and easy to hold a steady effort on.',
  },
  {
    id: 'row',
    label: 'Rower',
    met: 7,
    needs: ['machine'],
    note: 'Legs, then hips, then arms. Most of the power comes from the legs.',
  },
  {
    id: 'elliptical',
    label: 'Cross trainer',
    met: 5,
    needs: ['machine'],
    note: 'Low impact. Resist the urge to lean on the handles.',
  },
  {
    id: 'stairs',
    label: 'Stairs',
    met: 8,
    needs: [],
    note: 'Walk down, do not run down. The descent is where things get tweaked.',
  },
  {
    id: 'skipping',
    label: 'Skipping',
    met: 11,
    needs: [],
    note: 'Very hard, very quickly. Short intervals suit it better than steady work.',
  },
  {
    id: 'swim',
    label: 'Swim',
    met: 7,
    needs: [],
    note: 'The one option that asks nothing of your joints at all.',
  },
];

const MODALITY_BY_ID = new Map(MODALITIES.map((entry) => [entry.id, entry]));

export function modalityInfo(id: ConditioningModality): ModalityInfo {
  return MODALITY_BY_ID.get(id) ?? MODALITIES[0]!;
}

export function modalityLabel(id: ConditioningModality): string {
  return modalityInfo(id).label;
}

/**
 * A sensible default for her setup. Everything stays selectable - she knows
 * whether there is a pool nearby and the app does not - but the option that
 * needs kit she has not got should not be the one already chosen.
 */
export function suggestedModality(
  equipment: EquipmentId[],
  lastLogged?: ConditioningModality,
): ConditioningModality {
  if (lastLogged) return lastLogged;
  if (equipment.includes('machine')) return 'bike';
  return 'incline-walk';
}

/** Intervals cost more per minute than the steady value implies. */
const INTERVAL_MET_FACTOR = 1.35;

export function conditioningKcal(
  log: Pick<ConditioningLog, 'modality' | 'minutes' | 'kind'>,
  weightKg: number,
): number {
  const met = modalityInfo(log.modality).met;
  return metKcal(
    log.kind === 'intervals' ? met * INTERVAL_MET_FACTOR : met,
    log.minutes,
    weightKg,
  );
}

/* ----------------------------- prescription ----------------------------- */

export interface ConditioningPrescription {
  kind: ConditioningKind;
  /** Total session time including warm-up and cool-down. */
  minutes: number;
  targetRpe: [number, number];
  /** Intervals only. */
  rounds: number | null;
  workSeconds: number | null;
  restSeconds: number | null;
  /** Shown to her verbatim. */
  rationale: string;
  readiness?: { band: Readiness['band']; originalMinutes: number };
}

const EASY_START: Record<Experience, number> = {
  never: 20,
  some: 25,
  experienced: 30,
};

const EASY_CAP = 60;

/** Rate of perceived exertion, 1-10. Easy work is genuinely easy. */
const EASY_RPE: [number, number] = [3, 4];
const INTERVAL_RPE: [number, number] = [7, 9];

const INTERVAL_WARMUP = 5;
const INTERVAL_COOLDOWN = 3;
const MIN_ROUNDS = 4;
const MAX_ROUNDS = 8;
const MAX_WORK_SECONDS = 120;

function intervalMinutes(rounds: number, work: number, rest: number): number {
  return Math.round(INTERVAL_WARMUP + INTERVAL_COOLDOWN + (rounds * (work + rest)) / 60);
}

/**
 * The next conditioning session.
 *
 * `history` is that kind's own sessions, most recent first. Easy and hard days
 * progress separately: adding a round to the interval session should not also
 * make the walk longer.
 */
export function prescribeConditioning(
  kind: ConditioningKind,
  history: ConditioningLog[],
  experience: Experience,
): ConditioningPrescription {
  const last = history[0];

  if (kind === 'easy') {
    if (!last) {
      const minutes = EASY_START[experience];
      return {
        kind,
        minutes,
        targetRpe: EASY_RPE,
        rounds: null,
        workSeconds: null,
        restSeconds: null,
        rationale: `Start at ${minutes} minutes at a pace you could hold a conversation through. If you cannot talk, it is too fast.`,
      };
    }

    // The ten percent rule, applied per session rather than per week: the
    // usual injuries in endurance work come from the size of the jump, not
    // from the total.
    const step = Math.max(1, Math.round(last.minutes * 0.1));

    if (last.rpe >= 8) {
      return {
        kind,
        minutes: last.minutes,
        targetRpe: EASY_RPE,
        rounds: null,
        workSeconds: null,
        restSeconds: null,
        rationale: `Last easy session came out at ${last.rpe} out of 10, which is not easy. Same ${last.minutes} minutes, slower this time.`,
      };
    }

    const minutes = Math.min(EASY_CAP, last.minutes + step);
    return {
      kind,
      minutes,
      targetRpe: EASY_RPE,
      rounds: null,
      workSeconds: null,
      restSeconds: null,
      rationale:
        minutes === last.minutes
          ? `Holding at ${minutes} minutes. There is nothing to gain from making the easy day longer than this.`
          : `${last.minutes} minutes last time, so ${minutes} today. Same easy pace.`,
    };
  }

  if (!last) {
    const rounds = MIN_ROUNDS;
    const work = 60;
    const rest = 90;
    return {
      kind,
      minutes: intervalMinutes(rounds, work, rest),
      targetRpe: INTERVAL_RPE,
      rounds,
      workSeconds: work,
      restSeconds: rest,
      rationale: `${rounds} rounds of one minute hard, ninety seconds easy. Hard means you could not hold it for three minutes.`,
    };
  }

  const lastRounds = last.rounds ?? MIN_ROUNDS;
  const lastWork = last.workSeconds ?? 60;
  const rest = last.restSeconds ?? 90;

  if (last.rpe >= 9) {
    return {
      kind,
      minutes: intervalMinutes(lastRounds, lastWork, rest),
      targetRpe: INTERVAL_RPE,
      rounds: lastRounds,
      workSeconds: lastWork,
      restSeconds: rest,
      rationale: `That last one was all the way out at ${last.rpe}. Repeat it before adding anything.`,
    };
  }

  // Rounds first, then the length of each effort. Adding both at once means
  // never knowing which change she stopped tolerating.
  if (lastRounds < MAX_ROUNDS) {
    const rounds = lastRounds + 1;
    return {
      kind,
      minutes: intervalMinutes(rounds, lastWork, rest),
      targetRpe: INTERVAL_RPE,
      rounds,
      workSeconds: lastWork,
      restSeconds: rest,
      rationale: `${lastRounds} rounds last time, so ${rounds} today at the same effort.`,
    };
  }

  const work = Math.min(MAX_WORK_SECONDS, lastWork + 15);
  const rounds = work === lastWork ? MAX_ROUNDS : 5;
  return {
    kind,
    minutes: intervalMinutes(rounds, work, rest),
    targetRpe: INTERVAL_RPE,
    rounds,
    workSeconds: work,
    restSeconds: rest,
    rationale:
      work === lastWork
        ? `You are at the top of this progression. Hold here, or make the efforts faster rather than longer.`
        : `Eight rounds is enough of those. ${rounds} longer efforts of ${work} seconds instead.`,
  };
}

/**
 * The same bounded, visible adjustment the lifting side gets.
 *
 * Conditioning is where an under-slept session does the most damage, because
 * there is no bar to fail under - she just accumulates fatigue - so a red day
 * turns the intervals into an easy session rather than a shorter hard one.
 */
export function applyReadinessToConditioning(
  prescription: ConditioningPrescription,
  readiness: Readiness | null,
  enabled = true,
): ConditioningPrescription {
  if (!enabled || !readiness || readiness.band === 'green') return prescription;

  if (readiness.band === 'red') {
    const minutes = Math.max(15, Math.round(prescription.minutes * 0.7));
    return {
      kind: 'easy',
      minutes,
      targetRpe: EASY_RPE,
      rounds: null,
      workSeconds: null,
      restSeconds: null,
      rationale:
        prescription.kind === 'intervals'
          ? 'Intervals on a day like this cost more than they pay back. An easy session instead, and the hard one keeps until next time.'
          : 'Shorter and easier today.',
      readiness: { band: readiness.band, originalMinutes: prescription.minutes },
    };
  }

  const minutes = Math.max(10, Math.round(prescription.minutes * 0.9));
  if (minutes === prescription.minutes) return prescription;

  return {
    ...prescription,
    minutes,
    readiness: { band: readiness.band, originalMinutes: prescription.minutes },
  };
}

/* -------------------------------- summary -------------------------------- */

/**
 * Minutes in the last seven days, and how that compares to the week before.
 *
 * Used to warn when the jump is too big. Ramping weekly volume by more than
 * about a tenth is the single best-evidenced way to pick up an overuse injury.
 */
export function weeklyLoad(
  logs: ConditioningLog[],
  daysBetweenFn: (a: string, b: string) => number,
  today: string,
): { thisWeek: number; lastWeek: number; jumpTooBig: boolean } {
  let thisWeek = 0;
  let lastWeek = 0;

  for (const log of logs) {
    if (log.deletedAt !== null) continue;
    const age = daysBetweenFn(log.date, today);
    if (age < 0) continue;
    if (age < 7) thisWeek += log.minutes;
    else if (age < 14) lastWeek += log.minutes;
  }

  return {
    thisWeek,
    lastWeek,
    jumpTooBig: lastWeek > 0 && thisWeek > lastWeek * 1.3,
  };
}
