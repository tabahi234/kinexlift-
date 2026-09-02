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
 *
 * Fields added after v1 are declared optional even though the app always
 * writes them now. A profile row saved before the field existed genuinely has
 * no value for it, and pretending otherwise is how `undefined` ends up inside
 * a calorie target. Every one is read through a resolver in domain/profile.ts.
 */

export const SCHEMA_VERSION = 2;

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
 * 'strength' - every session in the rotation is lifting.
 * 'hybrid'   - conditioning days sit in the same rotation as the lifting days,
 *              so endurance work is programmed and progressed rather than
 *              bolted on and forgotten.
 */
export type TrainingStyle = 'strength' | 'hybrid';

/** Life outside training. Training itself is counted from the log, not here. */
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active';

export type WeightGoal = 'lose' | 'maintain' | 'gain';

export type DietPattern = 'omnivore' | 'halal' | 'vegetarian' | 'vegan';

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

  /* ---- added in v2. Optional on purpose: see the note at the top. ---- */

  trainingStyle?: TrainingStyle;
  activityLevel?: ActivityLevel;
  weightGoal?: WeightGoal;
  dietPattern?: DietPattern;
  /** Allergy and dislike tags. Anything listed is excluded from every meal. */
  foodAvoid?: string[];
  /**
   * ISO 3166-1 alpha-2, asked once during onboarding. It decides which food
   * she is shown *first* and which dishes a generated day is built from -
   * never what she is allowed to eat, which is what dietPattern and foodAvoid
   * are for. Absent is a real answer and means "show me everything".
   */
  country?: string;
  /**
   * The coach talks to a third-party model, so it stays off until she says
   * yes. The app promised nothing leaves the device, and that promise
   * outranks the feature.
   */
  coachOptIn?: boolean;
  /** Same reasoning for backup: sync uploads special-category health data. */
  cloudSync?: boolean;
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
    trainingStyle: 'strength',
    activityLevel: 'light',
    weightGoal: 'maintain',
    dietPattern: 'omnivore',
    foodAvoid: [],
    coachOptIn: false,
    cloudSync: false,
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

/* --------------------------- conditioning --------------------------- */

export type ConditioningModality =
  | 'walk'
  | 'incline-walk'
  | 'run'
  | 'bike'
  | 'row'
  | 'skipping'
  | 'stairs'
  | 'swim'
  | 'elliptical';

/**
 * The atom of the hybrid protocol, the way a set is the atom of lifting.
 * Minutes and effort are logged; weekly load and the next prescription derive
 * from these rows, never from a stored total.
 */
export interface ConditioningLog extends SyncMeta {
  /** The training session it belonged to, when it was a programmed day. */
  sessionId: string | null;
  /** 'YYYY-MM-DD' local. */
  date: string;
  modality: ConditioningModality;
  /** 'easy' is zone 2 by feel; 'intervals' is the hard day. */
  kind: 'easy' | 'intervals';
  minutes: number;
  /** Rate of perceived exertion, 1-10. */
  rpe: number;
  distanceKm: number | null;
  /**
   * Interval shape, when it was an interval session. Stored rather than
   * derived because the next prescription progresses from what she actually
   * did, and she is free to change it mid-session.
   */
  rounds: number | null;
  workSeconds: number | null;
  restSeconds: number | null;
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

/* ------------------------------ body ------------------------------ */

/**
 * A weight history rather than one number on the profile, so BMI, the trend
 * line and the calorie target all read the same observations. The profile's
 * bodyWeightKg mirrors the most recent entry for convenience only.
 */
export interface BodyMetric extends SyncMeta {
  /** 'YYYY-MM-DD' local. Unique - one weigh-in per day. */
  date: string;
  weightKg: number;
  waistCm: number | null;
  note: string | null;
}

/* ------------------------------ nutrition ------------------------------ */

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/**
 * Something she ate that the table does not have.
 *
 * Written onto the meal row rather than into a food table of her own, and
 * that is the whole design decision here. A log records what she ate *then*.
 * If "my mum's biryani" lived in a table and she corrected its calories in
 * March, every February dinner would silently change with it - which is the
 * one thing a log must never do.
 *
 * The cost is that the same dish repeated is repeated data. That is the right
 * trade for maybe a dozen rows a week, and `foodId` still carries a stable
 * slug so the quick-add row can notice she keeps logging the same thing.
 */
export interface CustomFood {
  name: string;
  /** How she described one portion: 'one wrap', 'a large bowl'. */
  serving: string;
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fibreG: number;
  ironMg: number;
  /**
   * A model guessed these from a description rather than her reading a label.
   *
   * Stored because the difference matters and the screen has to be able to
   * say so: an estimate she accepted is still an estimate, and a day built
   * out of them deserves to be marked rather than presented as measurement.
   */
  estimated?: boolean;
}

/**
 * One portion of one food. Daily totals are summed from these on read, so the
 * Fuel screen can never disagree with what she actually logged.
 */
export interface MealLog extends SyncMeta {
  /** 'YYYY-MM-DD' local. */
  date: string;
  slot: MealSlot;
  /**
   * Id from the curated food table in domain/foods.ts, or a `custom:` slug
   * when `custom` below carries the food instead.
   */
  foodId: string;
  /** Multiples of that food's household serving. */
  servings: number;
  /** Present only for a food she entered herself. See CustomFood. */
  custom?: CustomFood;
}

/* -------------------------------- coach -------------------------------- */

export type ChatRole = 'user' | 'assistant';

/** The conversation, kept so the coach remembers what has already been said. */
export interface ChatMessage extends SyncMeta {
  role: ChatRole;
  content: string;
  createdAt: number;
  /** Set when a request failed, so the UI can offer a retry rather than lie. */
  failed?: boolean;
  /**
   * When she accepted the proposal attached to this reply.
   *
   * On the message rather than in component state because the card is
   * rendered from the stored conversation: without this, scrolling away and
   * back would offer to add the same dinner to her log a second time.
   */
  appliedAt?: number | null;
}

/**
 * Long-term coach memory.
 *
 * 'summary' is a rolling recap of conversation that has fallen out of the
 * verbatim window, so a chat from three months ago still informs today's
 * answer without resending three months of tokens.
 * 'fact' is something she told the coach that should outlive any summary -
 * an injury, a dislike, a deadline.
 */
export type CoachNoteKind = 'summary' | 'fact';

export interface CoachNote extends SyncMeta {
  kind: CoachNoteKind;
  content: string;
  createdAt: number;
  /** For summaries: the createdAt of the newest message it covers. */
  coversUntil: number | null;
}
