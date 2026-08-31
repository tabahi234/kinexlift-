import type { Goal } from '../db/schema';
import type { MovementPattern } from './exercises';
import type { RepRange } from './progression';

/**
 * Programs are written in movement *patterns*, never in named exercises.
 *
 * The planner resolves each pattern against the equipment she actually has, so
 * one program definition works in a commercial gym and in a bedroom with a
 * single pair of dumbbells - and swapping an exercise never breaks the
 * structure of the week.
 */

export interface TemplateSlot {
  pattern: MovementPattern;
  sets: number;
  /** Overrides the goal-derived range. Used for core and accessory work. */
  repRange?: RepRange;
}

export interface TemplateDay {
  id: string;
  name: string;
  slots: TemplateSlot[];
}

export interface Program {
  id: string;
  name: string;
  days: TemplateDay[];
}

/** Core and light accessory work lives in higher reps regardless of goal. */
const LIGHT: RepRange = [10, 15];

const GOAL_REP_RANGE: Record<Goal, RepRange> = {
  strength: [4, 6],
  muscle: [8, 12],
  health: [8, 12],
  energy: [10, 15],
};

export function repRangeFor(goal: Goal): RepRange {
  return GOAL_REP_RANGE[goal];
}

/** Main lifts get an extra set when the reps are low. */
export function setsForGoal(goal: Goal): number {
  return goal === 'strength' ? 4 : 3;
}

function fullBody(id: string, name: string, patterns: MovementPattern[]): TemplateDay {
  return {
    id,
    name,
    slots: [
      { pattern: patterns[0]!, sets: 3 },
      { pattern: patterns[1]!, sets: 3 },
      { pattern: patterns[2]!, sets: 3 },
      { pattern: patterns[3]!, sets: 2, repRange: LIGHT },
    ],
  };
}

const TWO_DAY: Program = {
  id: 'full-body-2',
  name: 'Full body, twice a week',
  days: [
    fullBody('fb-a', 'Full body A', ['squat', 'push-horizontal', 'pull-horizontal', 'core']),
    fullBody('fb-b', 'Full body B', ['hinge', 'push-vertical', 'pull-vertical', 'core']),
  ],
};

const THREE_DAY: Program = {
  id: 'full-body-3',
  name: 'Full body, three times a week',
  days: [
    fullBody('fb-a', 'Full body A', ['squat', 'push-horizontal', 'pull-vertical', 'core']),
    fullBody('fb-b', 'Full body B', ['hinge', 'push-vertical', 'pull-horizontal', 'core']),
    fullBody('fb-c', 'Full body C', ['lunge', 'push-horizontal', 'pull-vertical', 'accessory']),
  ],
};

const FOUR_DAY: Program = {
  id: 'upper-lower-4',
  name: 'Upper and lower, four times a week',
  days: [
    {
      id: 'lower-a',
      name: 'Lower A',
      slots: [
        { pattern: 'squat', sets: 3 },
        { pattern: 'hinge', sets: 3 },
        { pattern: 'lunge', sets: 3 },
        { pattern: 'accessory', sets: 2, repRange: LIGHT },
      ],
    },
    {
      id: 'upper-a',
      name: 'Upper A',
      slots: [
        { pattern: 'push-horizontal', sets: 3 },
        { pattern: 'pull-vertical', sets: 3 },
        { pattern: 'push-vertical', sets: 3 },
        { pattern: 'accessory', sets: 2, repRange: LIGHT },
      ],
    },
    {
      id: 'lower-b',
      name: 'Lower B',
      slots: [
        { pattern: 'hinge', sets: 3 },
        { pattern: 'squat', sets: 3 },
        { pattern: 'lunge', sets: 3 },
        { pattern: 'core', sets: 2, repRange: LIGHT },
      ],
    },
    {
      id: 'upper-b',
      name: 'Upper B',
      slots: [
        { pattern: 'pull-horizontal', sets: 3 },
        { pattern: 'push-horizontal', sets: 3 },
        { pattern: 'pull-vertical', sets: 3 },
        { pattern: 'core', sets: 2, repRange: LIGHT },
      ],
    },
  ],
};

export function programFor(daysPerWeek: number): Program {
  if (daysPerWeek <= 2) return TWO_DAY;
  if (daysPerWeek === 3) return THREE_DAY;
  return FOUR_DAY;
}

/**
 * Rotation is by position in the program, not by weekday. Missing a Tuesday
 * should not skip a session - she just picks up where she left off.
 */
export function nextDay(program: Program, lastCompletedDayId: string | null): TemplateDay {
  const first = program.days[0]!;
  if (!lastCompletedDayId) return first;

  const lastIndex = program.days.findIndex((day) => day.id === lastCompletedDayId);
  if (lastIndex === -1) return first;

  return program.days[(lastIndex + 1) % program.days.length]!;
}
