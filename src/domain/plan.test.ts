import { describe, expect, it } from 'vitest';
import { planFor, buildSession } from './plan';
import { programFor, nextDay } from './templates';
import { GYM_EQUIPMENT, type Equipment } from './exercises';
import { makeDefaultProfile, type Profile } from '../db/schema';

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    ...makeDefaultProfile(),
    id: 'profile',
    updatedAt: 0,
    deletedAt: null,
    schemaVersion: 1,
    ...overrides,
  };
}

const idsIn = (session: ReturnType<typeof planFor>) =>
  session.exercises.map((entry) => entry.exercise.id);

describe('planning against available equipment', () => {
  it('gives a full gym the barbell work', () => {
    const session = planFor(
      profile({ equipment: GYM_EQUIPMENT, experience: 'some', daysPerWeek: 3 }),
      null,
      new Map(),
    );
    expect(idsIn(session)).toContain('barbell-back-squat');
    expect(session.exercises).toHaveLength(4);
  });

  it('falls back to bodyweight when she has nothing at home', () => {
    const session = planFor(
      profile({ location: 'home', equipment: [], experience: 'never', daysPerWeek: 3 }),
      null,
      new Map(),
    );

    expect(session.exercises.length).toBeGreaterThan(0);
    for (const entry of session.exercises) {
      expect(entry.exercise.equipment).toEqual(['bodyweight']);
      expect(entry.prescription.weightKg).toBe(0);
    }
  });

  it('uses dumbbells when that is all she owns', () => {
    const session = planFor(
      profile({ location: 'home', equipment: ['dumbbells'], experience: 'never' }),
      null,
      new Map(),
    );
    expect(idsIn(session)).toContain('goblet-squat');
    expect(idsIn(session)).not.toContain('barbell-back-squat');
  });
});

describe('planning around her constraints', () => {
  it('skips knee-loading work when she flagged her knees', () => {
    const session = planFor(
      profile({ equipment: GYM_EQUIPMENT, experience: 'some', limitations: ['knees'] }),
      null,
      new Map(),
    );
    for (const entry of session.exercises) {
      expect(entry.exercise.avoidFor).not.toContain('knees');
    }
    // It still programs a squat pattern - just one that is kinder on the knee.
    expect(idsIn(session)).toContain('leg-press');
  });

  it('withholds technical lifts from complete beginners', () => {
    const session = planFor(
      profile({ equipment: GYM_EQUIPMENT, experience: 'never', daysPerWeek: 4 }),
      null,
      new Map(),
    );
    expect(idsIn(session)).not.toContain('conventional-deadlift');
    expect(idsIn(session)).not.toContain('pull-up');
  });
});

describe('rotation', () => {
  it('advances through the program and wraps around', () => {
    const program = programFor(3);
    expect(nextDay(program, null).id).toBe('fb-a');
    expect(nextDay(program, 'fb-a').id).toBe('fb-b');
    expect(nextDay(program, 'fb-c').id).toBe('fb-a');
  });

  it('starts over rather than failing on an unknown day id', () => {
    const program = programFor(3);
    expect(nextDay(program, 'from-an-older-program').id).toBe('fb-a');
  });

  it('picks a program that matches how often she trains', () => {
    expect(programFor(2).days).toHaveLength(2);
    expect(programFor(3).days).toHaveLength(3);
    expect(programFor(4).days).toHaveLength(4);
  });
});

describe('slot resolution', () => {
  it('never hands her the same exercise twice in one session', () => {
    const program = programFor(4);
    // Lower B asks for hinge and squat; both must resolve to different lifts.
    const day = program.days.find((entry) => entry.id === 'lower-b')!;
    const session = buildSession(
      day,
      program,
      profile({ equipment: GYM_EQUIPMENT, experience: 'some' }),
      new Map(),
    );
    const ids = session.exercises.map((entry) => entry.exercise.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('honours a saved swap, and ignores one she can no longer perform', () => {
    const swapped = planFor(
      profile({
        equipment: GYM_EQUIPMENT,
        experience: 'some',
        daysPerWeek: 3,
        exerciseOverrides: { 'fb-a:0': 'leg-press' },
      }),
      null,
      new Map(),
    );
    expect(idsIn(swapped)[0]).toBe('leg-press');

    // She swapped to a machine, then started training at home without one.
    const unavailable = planFor(
      profile({
        location: 'home',
        equipment: ['dumbbells'],
        experience: 'some',
        daysPerWeek: 3,
        exerciseOverrides: { 'fb-a:0': 'leg-press' },
      }),
      null,
      new Map(),
    );
    expect(idsIn(unavailable)[0]).not.toBe('leg-press');
    expect(idsIn(unavailable)[0]).toBe('goblet-squat');
  });

  it('offers alternatives for every slot it fills', () => {
    const session = planFor(
      profile({ equipment: GYM_EQUIPMENT, experience: 'some' }),
      null,
      new Map(),
    );
    for (const entry of session.exercises) {
      expect(entry.alternatives).not.toContainEqual(entry.exercise);
    }
  });
});

describe('rep ranges follow the goal', () => {
  it('programs low reps for strength and higher reps for muscle', () => {
    const strength = planFor(
      profile({ goal: 'strength', equipment: GYM_EQUIPMENT, experience: 'some' }),
      null,
      new Map(),
    );
    const muscle = planFor(
      profile({ goal: 'muscle', equipment: GYM_EQUIPMENT, experience: 'some' }),
      null,
      new Map(),
    );

    expect(strength.exercises[0]!.prescription.repRange).toEqual([4, 6]);
    expect(muscle.exercises[0]!.prescription.repRange).toEqual([8, 12]);
  });

  it('keeps accessory work light whatever the goal', () => {
    const program = programFor(3);
    // Full body C ends on an accessory slot rather than a timed hold.
    const day = program.days.find((entry) => entry.id === 'fb-c')!;
    const session = buildSession(
      day,
      program,
      profile({ goal: 'strength', equipment: GYM_EQUIPMENT, experience: 'some' }),
      new Map(),
    );
    expect(session.exercises.at(-1)!.prescription.repRange).toEqual([10, 15]);
  });

  it('prescribes holds in seconds, not reps', () => {
    const program = programFor(3);
    const day = program.days.find((entry) => entry.id === 'fb-a')!;
    const session = buildSession(
      day,
      program,
      profile({ goal: 'strength', equipment: GYM_EQUIPMENT, experience: 'some' }),
      new Map(),
    );

    const plank = session.exercises.find((entry) => entry.exercise.id === 'plank')!;
    expect(plank.exercise.unit).toBe('seconds');
    // A goal-derived rep range would read as "4-6 reps" on a plank card.
    expect(plank.prescription.repRange).toEqual([20, 45]);
    expect(plank.prescription.rationale).toContain('seconds');
  });
});

describe('no slot is ever silently dropped', () => {
  const kits: { name: string; equipment: Equipment[] }[] = [
    { name: 'nothing at all', equipment: [] },
    { name: 'dumbbells only', equipment: ['dumbbells'] },
    { name: 'dumbbells and a bench', equipment: ['dumbbells', 'bench'] },
    { name: 'bands only', equipment: ['bands'] },
    { name: 'a kettlebell', equipment: ['kettlebell'] },
    { name: 'a full gym', equipment: GYM_EQUIPMENT },
  ];

  for (const kit of kits) {
    for (const days of [2, 3, 4]) {
      it(`fills every slot with ${kit.name}, training ${days} days`, () => {
        const program = programFor(days);
        const person = profile({
          equipment: kit.equipment,
          experience: 'never',
          daysPerWeek: days,
        });

        for (const day of program.days) {
          const session = buildSession(day, program, person, new Map());
          // A missing slot would mean a whole movement pattern quietly absent
          // from her week, which is worse than an imperfect substitute.
          expect(session.exercises).toHaveLength(day.slots.length);
        }
      });
    }
  }

  it('still programs pulling when she owns no equipment', () => {
    const program = programFor(3);
    const person = profile({ equipment: [], experience: 'never', daysPerWeek: 3 });

    const patterns = program.days.flatMap((day) =>
      buildSession(day, program, person, new Map()).exercises.map(
        (entry) => entry.exercise.pattern,
      ),
    );

    expect(patterns.some((pattern) => pattern.startsWith('pull'))).toBe(true);
  });

  it('works around an injury without leaving a gap', () => {
    const program = programFor(3);
    const person = profile({
      equipment: GYM_EQUIPMENT,
      experience: 'never',
      limitations: ['knees', 'back', 'shoulders', 'wrists'],
    });

    for (const day of program.days) {
      const session = buildSession(day, program, person, new Map());
      expect(session.exercises).toHaveLength(day.slots.length);
      for (const entry of session.exercises) {
        expect(entry.exercise.avoidFor).toHaveLength(0);
      }
    }
  });
});
