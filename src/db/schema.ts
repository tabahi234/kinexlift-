/**
 * The data model.
 *
 * Two rules hold the whole app together:
 *   1. Store observations, derive everything else. There is no "total volume"
 *      or "streak" column - those are computed from set rows on read, so they
 *      can never go stale or disagree with the log.
 *   2. Every record carries SyncMeta from day one. Retrofitting sync metadata
 *      onto data already sitting on users' phones is not realistically
 *      possible, so it goes in before the first user exists.
 */

export const SCHEMA_VERSION = 1;

export interface SyncMeta {
  /** uuid v7, generated on device. Stable across export/import and sync. */
  id: string;
  /** epoch ms, rewritten on every mutation. Drives last-write-wins merges. */
  updatedAt: number;
  /** Soft delete. A hard delete cannot be replicated to other devices. */
  deletedAt: number | null;
  /** Lets a future version read an export written by this one. */
  schemaVersion: number;
}

/* ------------------------------ profile ------------------------------ */

export type Goal = 'strength' | 'muscle' | 'health' | 'energy';
export type Experience = 'never' | 'some' | 'experienced';
export type TrainingLocation = 'home' | 'gym';
export type Units = 'metric' | 'imperial';

/**
 * 'track'         - logs periods, cycle features on
 * 'contraception' - most combined-pill users do not ovulate; there is no
 *                   cycle to sync to, so the features are off by design
 * 'off'           - declined, and never asked again
 */
export type CycleTracking = 'track' | 'contraception' | 'off';

export interface Profile extends SyncMeta {
  displayName: string | null;
  birthYear: number | null;
  /** Always metric in storage. Imperial is a display concern only. */
  bodyWeightKg: number | null;
  heightCm: number | null;
  goal: Goal;
  experience: Experience;
  location: TrainingLocation;
  equipment: string[];
  daysPerWeek: number;
  units: Units;
  cycleTracking: CycleTracking;
  /** Free-text joints or movements to work around, e.g. ['knees']. */
  limitations: string[];
  /**
   * Exercises she swapped, keyed by `${dayId}:${slotIndex}`. Kept on the
   * profile rather than in the plan because the plan is derived, never stored.
   */
  exerciseOverrides: Record<string, string>;
  /**
   * Whether a low-readiness day actually changes the prescribed weight, or
   * only shows her the reading and leaves the session alone.
   */
  readinessAdjustments: 'on' | 'off';
  onboardedAt: number | null;
}

/** The profile is a singleton row; a fixed id keeps upserts trivial. */
export const PROFILE_ID = 'profile';

export function makeDefaultProfile(): Omit<Profile, keyof SyncMeta> {
  return {
    displayName: null,
    birthYear: null,
    bodyWeightKg: null,
    heightCm: null,
    goal: 'muscle',
    experience: 'never',
    location: 'gym',
    equipment: [],
    daysPerWeek: 3,
    units: 'metric',
    cycleTracking: 'off',
    limitations: [],
    exerciseOverrides: {},
    readinessAdjustments: 'on',
    onboardedAt: null,
  };
}

/* ------------------------------ training ------------------------------ */

export interface Session extends SyncMeta {
  startedAt: number;
  endedAt: number | null;
  /** Which planned day this came from, if any. Free sessions have none. */
  templateId: string | null;
  notes: string | null;
  /**
   * She was offered a lighter session and chose the full weight anyway.
   * Recorded so the app can notice it keeps being wrong and offer to stop,
   * rather than quietly nagging her every low-readiness day forever.
   */
  readinessOverride?: boolean;
}

/**
 * The atom of the whole app. Sets are the only training truth; plans,
 * charts, PRs and progression all derive from these rows.
 */
export interface SetLog extends SyncMeta {
  sessionId: string;
  exerciseId: string;
  performedAt: number;
  weightKg: number;
  reps: number;
  /** Reps in reserve. Null when she did not rate it. */
  rir: number | null;
  isWarmup: boolean;
}

/* ------------------------------ readiness ------------------------------ */

export type SymptomTag =
  | 'cramps'
  | 'bloating'
  | 'headache'
  | 'low_mood'
  | 'poor_sleep'
  | 'breast_tenderness'
  | 'high_stress';

/**
 * Replaces phase-based programming. Three taps a morning, and after a few
 * cycles it is also the raw material for per-user pattern detection.
 */
export interface Checkin extends SyncMeta {
  /** 'YYYY-MM-DD' local. Unique - one check-in per day. */
  date: string;
  sleep: number;
  energy: number;
  soreness: number;
  symptoms: SymptomTag[];
}

/* ------------------------------ cycle ------------------------------ */

export type CycleEventKind = 'period_start' | 'period_end' | 'spotting';

/** Observations only. Predicted phase is derived, never stored. */
export interface CycleEvent extends SyncMeta {
  date: string;
  kind: CycleEventKind;
}
