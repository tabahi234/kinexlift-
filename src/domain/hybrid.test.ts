import { describe, expect, it } from 'vitest';
import {
  isConditioningDay,
  liftingDaysIn,
  nextDay,
  programFor,
} from './templates';
import { buildSession, planFor } from './plan';
import { assessReadiness } from './readiness';
import { makeDefaultProfile, type Profile } from '../db/schema';
import { GYM_EQUIPMENT } from './exercises';
import type { ConditioningLog } from '../db/schema';

const profile = (over: Partial<Profile> = {}): Profile => ({
  ...makeDefaultProfile(),
  id: 'profile',
  updatedAt: 0,
  deletedAt: null,
  schemaVersion: 2,
  equipment: GYM_EQUIPMENT,
  onboardedAt: 1,
  ...over,
});

const hybrid = (daysPerWeek = 3) =>
  profile({ trainingStyle: 'hybrid', daysPerWeek });

describe('choosing a programme', () => {
  it('leaves the strength programmes exactly as they were', () => {
    // Hybrid is an addition. If turning it off changed what a lifting-only
    // user got, this would be a rewrite rather than a feature.
    expect(programFor(2).id).toBe('full-body-2');
    expect(programFor(3).id).toBe('full-body-3');
    expect(programFor(4).id).toBe('upper-lower-4');
    expect(programFor(9).id).toBe('upper-lower-4');
  });

  it('treats a missing training style as lifting only', () => {
    // Profiles written before the setting existed have no value for it.
    const old = profile();
    delete (old as Partial<Profile>).trainingStyle;
    expect(programFor(old.daysPerWeek, old.trainingStyle).id).toBe('full-body-3');
  });

  it('puts conditioning days in the rotation, not beside it', () => {
    const program = programFor(4, 'hybrid');
    expect(program.days.filter(isConditioningDay)).toHaveLength(2);
    expect(liftingDaysIn(program)).toBe(2);
  });

  it('offers a five-day week only for hybrid', () => {
    expect(programFor(5, 'hybrid').days).toHaveLength(5);
  });

  it('never lets a conditioning day be the very first session', () => {
    // Opening a new programme with a walk, before she has lifted anything,
    // makes the first impression of a strength app a cardio session.
    for (const days of [2, 3, 4, 5]) {
      const program = programFor(days, 'hybrid');
      expect(isConditioningDay(program.days[0]!)).toBe(false);
    }
  });

  it('keeps the lifting day ids stable across a style change', () => {
    // Her squat history is keyed on the exercise, but the rotation and her
    // saved exercise swaps are keyed on the day id. Renaming them would lose
    // both the moment she tried hybrid.
    const strength = programFor(3).days.map((day) => day.id);
    const withCardio = programFor(3, 'hybrid')
      .days.filter((day) => !isConditioningDay(day))
      .map((day) => day.id);
    for (const id of withCardio) expect(strength).toContain(id);
  });

  it('alternates rather than stacking the conditioning days', () => {
    const program = programFor(5, 'hybrid');
    for (let i = 1; i < program.days.length; i++) {
      const back_to_back =
        isConditioningDay(program.days[i]!) && isConditioningDay(program.days[i - 1]!);
      expect(back_to_back).toBe(false);
    }
  });
});

describe('planning a conditioning day', () => {
  const program = programFor(3, 'hybrid');
  const conditioningDay = program.days.find(isConditioningDay)!;

  it('produces a conditioning prescription and no exercises', () => {
    const session = buildSession(conditioningDay, program, hybrid(), new Map());
    expect(session.exercises).toEqual([]);
    expect(session.conditioning).not.toBeNull();
    expect(session.conditioning!.kind).toBe('easy');
  });

  it('produces exercises and no conditioning on a lifting day', () => {
    const liftingDay = program.days.find((day) => !isConditioningDay(day))!;
    const session = buildSession(liftingDay, program, hybrid(), new Map());
    expect(session.conditioning).toBeNull();
    expect(session.exercises.length).toBeGreaterThan(0);
  });

  it('progresses from her own conditioning history', () => {
    const history: ConditioningLog[] = [
      {
        id: 'c1',
        updatedAt: 0,
        deletedAt: null,
        schemaVersion: 2,
        sessionId: null,
        date: '2026-05-01',
        modality: 'bike',
        kind: 'easy',
        minutes: 40,
        rpe: 4,
        distanceKm: null,
        rounds: null,
        workSeconds: null,
        restSeconds: null,
      },
    ];
    const session = buildSession(conditioningDay, program, hybrid(), new Map(), null, {
      easy: history,
      intervals: [],
    });
    expect(session.conditioning!.minutes).toBe(44);
  });

  it('eases a conditioning day on a bad check-in like any other session', () => {
    const red = assessReadiness({ sleep: 1, energy: 1, soreness: 5 });
    const session = buildSession(conditioningDay, program, hybrid(), new Map(), red);
    expect(session.conditioning!.readiness?.band).toBe('red');
  });

  it('leaves it alone when she has turned adjustments off', () => {
    const red = assessReadiness({ sleep: 1, energy: 1, soreness: 5 });
    const session = buildSession(
      conditioningDay,
      program,
      profile({ trainingStyle: 'hybrid', readinessAdjustments: 'off' }),
      new Map(),
      red,
    );
    expect(session.conditioning!.readiness).toBeUndefined();
  });

  it('advances the rotation past a finished conditioning day', () => {
    const program3 = programFor(3, 'hybrid');
    const after = nextDay(program3, 'cond-easy');
    expect(isConditioningDay(after)).toBe(false);
  });

  it('starts a new hybrid user on a lifting day', () => {
    const session = planFor(hybrid(), null, new Map());
    expect(session.conditioning).toBeNull();
  });
});
