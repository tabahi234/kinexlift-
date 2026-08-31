import type { Experience } from '../db/schema';

/**
 * The exercise library.
 *
 * Curated by hand rather than imported from an open dataset, because the
 * fields the engine actually needs - the smallest sensible weight jump, a
 * beginner starting load, what it can be swapped for - are exactly the fields
 * public datasets do not carry.
 *
 * Templates ask for a movement *pattern*; the planner resolves the pattern
 * against the equipment she actually has. That is what makes the same program
 * work in a full gym and in a bedroom with one pair of dumbbells.
 */

export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'push-horizontal'
  | 'push-vertical'
  | 'pull-horizontal'
  | 'pull-vertical'
  | 'core'
  | 'accessory';

export type Equipment =
  | 'bodyweight'
  | 'dumbbells'
  | 'barbell'
  | 'kettlebell'
  | 'bench'
  | 'squat-rack'
  | 'cable'
  | 'machine'
  | 'pullup-bar'
  | 'bands';

export type Limitation = 'knees' | 'back' | 'wrists' | 'shoulders';

export interface Exercise {
  id: string;
  name: string;
  pattern: MovementPattern;
  /** Every item is required to perform it. */
  equipment: Equipment[];
  /** Smallest weight jump that makes sense on this lift. */
  incrementKg: number;
  /** Where an absolute beginner starts. 0 means bodyweight-only. */
  startingKg: number;
  /** Loaded per side, so the logged weight is one implement, not the total. */
  isUnilateral: boolean;
  experienceMin: Experience;
  /** Skipped when she flagged one of these. */
  avoidFor: Limitation[];
  /** One short coaching cue - shown under the exercise name while logging. */
  cue: string;
  /** Holds are logged and prescribed in seconds, not reps. */
  unit?: 'seconds';
}

/** Held positions where a rep count would be meaningless. */
export function isTimed(exercise: Exercise): boolean {
  return exercise.unit === 'seconds';
}

/** Sensible hold length, used instead of the goal's rep range. */
export const TIMED_RANGE: readonly [number, number] = [20, 45];

const EXPERIENCE_RANK: Record<Experience, number> = {
  never: 0,
  some: 1,
  experienced: 2,
};

export const GYM_EQUIPMENT: Equipment[] = [
  'bodyweight',
  'dumbbells',
  'barbell',
  'kettlebell',
  'bench',
  'squat-rack',
  'cable',
  'machine',
  'pullup-bar',
  'bands',
];

/** Offered as checkboxes during onboarding when she trains at home. */
export const HOME_EQUIPMENT_CHOICES: { id: Equipment; label: string }[] = [
  { id: 'dumbbells', label: 'Dumbbells' },
  { id: 'kettlebell', label: 'Kettlebell' },
  { id: 'bands', label: 'Resistance bands' },
  { id: 'bench', label: 'A bench or sturdy chair' },
  { id: 'pullup-bar', label: 'Pull-up bar' },
  { id: 'barbell', label: 'Barbell and plates' },
];

/**
 * Ordered best-first within each pattern: the planner takes the first entry
 * she has the equipment and experience for, so the ordering below is the
 * programming opinion.
 */
export const EXERCISES: Exercise[] = [
  /* ------------------------------- squat ------------------------------- */
  {
    id: 'barbell-back-squat',
    name: 'Barbell back squat',
    pattern: 'squat',
    equipment: ['barbell', 'squat-rack'],
    incrementKg: 2.5,
    startingKg: 20,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: ['knees', 'back'],
    cue: 'Brace, sit down between your hips, knees tracking over your toes.',
  },
  {
    id: 'goblet-squat',
    name: 'Goblet squat',
    pattern: 'squat',
    equipment: ['dumbbells'],
    incrementKg: 2,
    startingKg: 8,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: ['knees'],
    cue: 'Hold the weight at your chest and let it counterbalance you.',
  },
  {
    id: 'kettlebell-goblet-squat',
    name: 'Kettlebell goblet squat',
    pattern: 'squat',
    equipment: ['kettlebell'],
    incrementKg: 4,
    startingKg: 8,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: ['knees'],
    cue: 'Elbows inside your knees at the bottom, chest tall.',
  },
  {
    id: 'leg-press',
    name: 'Leg press',
    pattern: 'squat',
    equipment: ['machine'],
    incrementKg: 5,
    startingKg: 20,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Feet mid-platform. Stop before your lower back rounds off the pad.',
  },
  {
    id: 'bodyweight-squat',
    name: 'Bodyweight squat',
    pattern: 'squat',
    equipment: ['bodyweight'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Slow on the way down - three seconds - then stand up strong.',
  },

  /* ------------------------------- hinge ------------------------------- */
  {
    id: 'romanian-deadlift',
    name: 'Romanian deadlift',
    pattern: 'hinge',
    equipment: ['barbell'],
    incrementKg: 2.5,
    startingKg: 20,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: ['back'],
    cue: 'Push your hips back, bar close to your legs, stop at the stretch.',
  },
  {
    id: 'dumbbell-rdl',
    name: 'Dumbbell Romanian deadlift',
    pattern: 'hinge',
    equipment: ['dumbbells'],
    incrementKg: 2,
    startingKg: 8,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: ['back'],
    cue: 'Hips back, not down. You should feel it in your hamstrings.',
  },
  {
    id: 'hip-thrust',
    name: 'Barbell hip thrust',
    pattern: 'hinge',
    equipment: ['barbell', 'bench'],
    incrementKg: 2.5,
    startingKg: 20,
    isUnilateral: false,
    experienceMin: 'some',
    avoidFor: [],
    cue: 'Chin tucked, ribs down, squeeze your glutes hard at the top.',
  },
  {
    id: 'kettlebell-swing',
    name: 'Kettlebell swing',
    pattern: 'hinge',
    equipment: ['kettlebell'],
    incrementKg: 4,
    startingKg: 8,
    isUnilateral: false,
    experienceMin: 'some',
    avoidFor: ['back'],
    cue: 'It is a hinge, not a squat. The float at the top is free.',
  },
  {
    id: 'conventional-deadlift',
    name: 'Deadlift',
    pattern: 'hinge',
    equipment: ['barbell'],
    incrementKg: 2.5,
    startingKg: 30,
    isUnilateral: false,
    experienceMin: 'experienced',
    avoidFor: ['back'],
    cue: 'Take the slack out of the bar before you pull.',
  },
  {
    id: 'glute-bridge',
    name: 'Glute bridge',
    pattern: 'hinge',
    equipment: ['bodyweight'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Drive through your heels and pause for a second at the top.',
  },

  /* ------------------------------- lunge ------------------------------- */
  {
    id: 'bulgarian-split-squat',
    name: 'Bulgarian split squat',
    pattern: 'lunge',
    equipment: ['dumbbells', 'bench'],
    incrementKg: 2,
    startingKg: 5,
    isUnilateral: true,
    experienceMin: 'some',
    avoidFor: ['knees'],
    cue: 'Front shin roughly vertical. Back foot is for balance only.',
  },
  {
    id: 'walking-lunge',
    name: 'Walking lunge',
    pattern: 'lunge',
    equipment: ['dumbbells'],
    incrementKg: 2,
    startingKg: 5,
    isUnilateral: true,
    experienceMin: 'never',
    avoidFor: ['knees'],
    cue: 'Long steps, torso upright, push through the front heel.',
  },
  {
    id: 'reverse-lunge-bodyweight',
    name: 'Reverse lunge',
    pattern: 'lunge',
    equipment: ['bodyweight'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: true,
    experienceMin: 'never',
    avoidFor: ['knees'],
    cue: 'Step back, not forward - it is much kinder on the knees.',
  },
  {
    id: 'step-up',
    name: 'Step-up',
    pattern: 'lunge',
    equipment: ['bench'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: true,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Do not push off the back foot. All the work is the top leg.',
  },

  /* -------------------------- push, horizontal -------------------------- */
  {
    id: 'barbell-bench-press',
    name: 'Barbell bench press',
    pattern: 'push-horizontal',
    equipment: ['barbell', 'bench', 'squat-rack'],
    incrementKg: 1.25,
    startingKg: 20,
    isUnilateral: false,
    experienceMin: 'some',
    avoidFor: ['shoulders', 'wrists'],
    cue: 'Shoulder blades tucked back and down. Bar to your lower chest.',
  },
  {
    id: 'dumbbell-bench-press',
    name: 'Dumbbell bench press',
    pattern: 'push-horizontal',
    equipment: ['dumbbells', 'bench'],
    incrementKg: 2,
    startingKg: 5,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: ['shoulders'],
    cue: 'Lower until your elbows are level with the bench, then press.',
  },
  {
    id: 'machine-chest-press',
    name: 'Machine chest press',
    pattern: 'push-horizontal',
    equipment: ['machine'],
    incrementKg: 2.5,
    startingKg: 10,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Set the seat so the handles sit at chest height.',
  },
  {
    id: 'push-up',
    name: 'Push-up',
    pattern: 'push-horizontal',
    equipment: ['bodyweight'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: ['wrists'],
    cue: 'Hands under your shoulders. Elevate them if full reps are too hard.',
  },

  /* --------------------------- push, vertical --------------------------- */
  {
    id: 'dumbbell-shoulder-press',
    name: 'Dumbbell shoulder press',
    pattern: 'push-vertical',
    equipment: ['dumbbells'],
    incrementKg: 2,
    startingKg: 4,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: ['shoulders'],
    cue: 'Ribs down. Press up, not forward.',
  },
  {
    id: 'overhead-press',
    name: 'Barbell overhead press',
    pattern: 'push-vertical',
    equipment: ['barbell'],
    incrementKg: 1.25,
    startingKg: 20,
    isUnilateral: false,
    experienceMin: 'some',
    avoidFor: ['shoulders'],
    cue: 'Squeeze your glutes so your lower back stays out of it.',
  },
  {
    id: 'band-overhead-press',
    name: 'Band overhead press',
    pattern: 'push-vertical',
    equipment: ['bands'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: ['shoulders'],
    cue: 'Stand on the band. Control it back down rather than letting it snap.',
  },
  {
    id: 'pike-push-up',
    name: 'Pike push-up',
    pattern: 'push-vertical',
    equipment: ['bodyweight'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'some',
    avoidFor: ['shoulders', 'wrists'],
    cue: 'Hips high, crown of your head towards the floor.',
  },

  /* --------------------------- pull, vertical --------------------------- */
  {
    id: 'lat-pulldown',
    name: 'Lat pulldown',
    pattern: 'pull-vertical',
    equipment: ['cable'],
    incrementKg: 2.5,
    startingKg: 15,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Lead with your elbows, finish with the bar at your collarbone.',
  },
  {
    id: 'assisted-pull-up',
    name: 'Assisted pull-up',
    pattern: 'pull-vertical',
    equipment: ['machine'],
    incrementKg: 2.5,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'More assistance is not cheating. Full range beats partial reps.',
  },
  {
    id: 'pull-up',
    name: 'Pull-up',
    pattern: 'pull-vertical',
    equipment: ['pullup-bar'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'experienced',
    avoidFor: [],
    cue: 'Start from a dead hang and pull your chest to the bar.',
  },
  {
    id: 'dumbbell-pullover',
    name: 'Dumbbell pullover',
    pattern: 'pull-vertical',
    equipment: ['dumbbells', 'bench'],
    incrementKg: 2,
    startingKg: 6,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: ['shoulders'],
    cue: 'Only your arms move. Keep your ribs down and go slowly.',
  },
  {
    id: 'band-pulldown',
    name: 'Band pulldown',
    pattern: 'pull-vertical',
    equipment: ['bands'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Anchor it high, kneel, and pull down towards your chest.',
  },

  /* -------------------------- pull, horizontal -------------------------- */
  {
    id: 'seated-cable-row',
    name: 'Seated cable row',
    pattern: 'pull-horizontal',
    equipment: ['cable'],
    incrementKg: 2.5,
    startingKg: 15,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Chest up, pull to your belly button, do not rock backwards.',
  },
  {
    id: 'dumbbell-row',
    name: 'Dumbbell row',
    pattern: 'pull-horizontal',
    equipment: ['dumbbells'],
    incrementKg: 2,
    startingKg: 6,
    isUnilateral: true,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Pull the weight to your hip, not your shoulder.',
  },
  {
    id: 'barbell-row',
    name: 'Barbell row',
    pattern: 'pull-horizontal',
    equipment: ['barbell'],
    incrementKg: 2.5,
    startingKg: 20,
    isUnilateral: false,
    experienceMin: 'some',
    avoidFor: ['back'],
    cue: 'Hinge to about 45 degrees and hold that angle the whole set.',
  },
  {
    id: 'inverted-row',
    name: 'Inverted row',
    pattern: 'pull-horizontal',
    equipment: ['pullup-bar'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'The higher the bar, the easier it is. Keep your body in one line.',
  },
  {
    // The only real pulling option when she owns nothing at all. Without it,
    // a bodyweight programme has no upper-back work in it whatsoever.
    id: 'prone-y-raise',
    name: 'Prone Y raise',
    pattern: 'pull-horizontal',
    equipment: ['bodyweight'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Face down, arms in a Y. Lift your thumbs a few inches and hold.',
  },
  {
    id: 'band-row',
    name: 'Band row',
    pattern: 'pull-horizontal',
    equipment: ['bands'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Squeeze your shoulder blades together and pause for a beat.',
  },

  /* -------------------------------- core -------------------------------- */
  {
    id: 'plank',
    name: 'Plank',
    pattern: 'core',
    equipment: ['bodyweight'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: ['wrists'],
    cue: 'Squeeze your glutes and tuck your ribs. Stop before your hips sag.',
    unit: 'seconds',
  },
  {
    id: 'dead-bug',
    name: 'Dead bug',
    pattern: 'core',
    equipment: ['bodyweight'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Lower back stays flat on the floor the whole time.',
  },
  {
    id: 'pallof-press',
    name: 'Pallof press',
    pattern: 'core',
    equipment: ['bands'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: true,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Resist the twist. That resistance is the entire exercise.',
  },
  {
    id: 'hanging-knee-raise',
    name: 'Hanging knee raise',
    pattern: 'core',
    equipment: ['pullup-bar'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'some',
    avoidFor: [],
    cue: 'Curl your pelvis up rather than just lifting your legs.',
  },

  /* ------------------------------ accessory ----------------------------- */
  {
    id: 'lateral-raise',
    name: 'Lateral raise',
    pattern: 'accessory',
    equipment: ['dumbbells'],
    incrementKg: 1,
    startingKg: 2,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: ['shoulders'],
    cue: 'Light weight, lead with your elbows, stop at shoulder height.',
  },
  {
    id: 'face-pull',
    name: 'Face pull',
    pattern: 'accessory',
    equipment: ['cable'],
    incrementKg: 2.5,
    startingKg: 10,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Pull to your forehead and pull the rope apart as you do.',
  },
  {
    id: 'bicep-curl',
    name: 'Bicep curl',
    pattern: 'accessory',
    equipment: ['dumbbells'],
    incrementKg: 1,
    startingKg: 4,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Elbows pinned to your sides. No swinging.',
  },
  {
    id: 'calf-raise',
    name: 'Calf raise',
    pattern: 'accessory',
    equipment: ['bodyweight'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Full range: all the way down, all the way up, pause at the top.',
  },
  {
    id: 'band-glute-abduction',
    name: 'Banded glute abduction',
    pattern: 'accessory',
    equipment: ['bands'],
    incrementKg: 0,
    startingKg: 0,
    isUnilateral: false,
    experienceMin: 'never',
    avoidFor: [],
    cue: 'Band above the knees, push out slowly and control the return.',
  },
];

const BY_ID = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

export function getExercise(id: string): Exercise | undefined {
  return BY_ID.get(id);
}

export function exerciseName(id: string): string {
  return BY_ID.get(id)?.name ?? id;
}

export interface SelectionContext {
  equipment: Equipment[];
  experience: Experience;
  limitations: string[];
}

function isAvailable(exercise: Exercise, context: SelectionContext): boolean {
  const owned = new Set<Equipment>([...context.equipment, 'bodyweight']);
  if (!exercise.equipment.every((item) => owned.has(item))) return false;
  if (EXPERIENCE_RANK[exercise.experienceMin] > EXPERIENCE_RANK[context.experience]) {
    return false;
  }
  return !exercise.avoidFor.some((limitation) =>
    context.limitations.includes(limitation),
  );
}

/**
 * Every exercise she could do for a pattern, best-first. The planner takes the
 * head of this list; the swap UI offers the tail.
 */
export function candidatesFor(
  pattern: MovementPattern,
  context: SelectionContext,
): Exercise[] {
  return EXERCISES.filter(
    (exercise) => exercise.pattern === pattern && isAvailable(exercise, context),
  );
}

/**
 * The nearest acceptable substitute when a pattern cannot be filled at all -
 * she owns no bar to hang from, or every option is ruled out by an injury.
 *
 * Dropping the slot instead would quietly hand her a shorter session with a
 * whole movement missing, which is a worse programme than an imperfect
 * substitute and gives her no way to notice it happened.
 */
const PATTERN_FALLBACK: Record<MovementPattern, MovementPattern[]> = {
  squat: ['lunge', 'hinge'],
  hinge: ['squat', 'lunge'],
  lunge: ['squat', 'hinge'],
  'push-horizontal': ['push-vertical', 'accessory'],
  'push-vertical': ['push-horizontal', 'accessory'],
  'pull-horizontal': ['pull-vertical', 'accessory'],
  'pull-vertical': ['pull-horizontal', 'accessory'],
  core: ['accessory'],
  accessory: ['core'],
};

export function candidatesWithFallback(
  pattern: MovementPattern,
  context: SelectionContext,
): Exercise[] {
  const direct = candidatesFor(pattern, context);
  if (direct.length > 0) return direct;

  for (const substitute of PATTERN_FALLBACK[pattern]) {
    const options = candidatesFor(substitute, context);
    if (options.length > 0) return options;
  }
  return [];
}

/**
 * Bodyweight movements have no external load, so progression happens in reps
 * rather than kilos and the weight stepper should stay hidden.
 */
export function isBodyweight(exercise: Exercise): boolean {
  return exercise.incrementKg === 0;
}
