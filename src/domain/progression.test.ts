import { describe, expect, it } from 'vitest';
import {
  bestE1rm,
  detectStall,
  e1rm,
  prescribe,
  roundTo,
  startingWeight,
  type SessionHistory,
  type WorkingSet,
} from './progression';
import { getExercise } from './exercises';

const squat = getExercise('barbell-back-squat')!;
const dumbbellRow = getExercise('dumbbell-row')!;
const pushUp = getExercise('push-up')!;

const set = (weightKg: number, reps: number, rir: number | null = 2): WorkingSet => ({
  weightKg,
  reps,
  rir,
});

/** One session of identical sets, the normal case. */
const session = (weightKg: number, reps: number, rir: number | null = 2, count = 3) =>
  Array.from({ length: count }, () => set(weightKg, reps, rir));

describe('e1rm', () => {
  it('folds reps in reserve into the estimate', () => {
    // Eight reps with two left is a harder set than eight to failure is easy.
    const withReserve = e1rm(60, 8, 2)!;
    const toFailure = e1rm(60, 8, 0)!;
    expect(withReserve).toBeGreaterThan(toFailure);
    expect(toFailure).toBeCloseTo(60 * (1 + 8 / 30), 5);
  });

  it('refuses to estimate from high-rep sets', () => {
    // Epley falls apart here, so returning null beats a confident wrong number.
    expect(e1rm(40, 15, 2)).toBeNull();
    expect(e1rm(40, 11, 2)).toBeNull();
    expect(e1rm(40, 10, 2)).not.toBeNull();
  });

  it('returns null for bodyweight and empty sets', () => {
    expect(e1rm(0, 10, 1)).toBeNull();
    expect(e1rm(50, 0, 1)).toBeNull();
  });

  it('assumes an unrated set was hard but not maximal', () => {
    expect(e1rm(50, 8, null)).toBe(e1rm(50, 8, 2));
  });

  it('takes the best set of a session', () => {
    expect(bestE1rm([set(50, 8), set(60, 8), set(55, 8)])).toBeCloseTo(e1rm(60, 8, 2)!, 5);
    expect(bestE1rm([set(40, 20)])).toBeNull();
  });
});

describe('starting weight', () => {
  it('scales with experience and stays loadable on a barbell', () => {
    const beginner = startingWeight(squat, 'never');
    const advanced = startingWeight(squat, 'experienced');

    expect(beginner).toBe(20); // an empty bar
    expect(advanced).toBeGreaterThan(beginner);
    // Plates load in pairs, so barbell suggestions must land on 2.5 kg steps.
    expect(advanced % 2.5).toBe(0);
  });

  it('is zero for bodyweight movements', () => {
    expect(startingWeight(pushUp, 'experienced')).toBe(0);
  });
});

describe('double progression', () => {
  it('calibrates when there is no history', () => {
    const result = prescribe(squat, [], {
      sets: 3,
      repRange: [8, 12],
      experience: 'never',
    });
    expect(result.kind).toBe('calibrate');
    expect(result.weightKg).toBe(20);
  });

  it('adds weight only once every set reaches the top of the range', () => {
    const history: SessionHistory = [session(60, 12, 1)];
    const result = prescribe(squat, history, {
      sets: 3,
      repRange: [8, 12],
      experience: 'some',
    });
    expect(result.kind).toBe('increase');
    expect(result.weightKg).toBe(62.5);
  });

  it('holds when one set falls short', () => {
    const history: SessionHistory = [[set(60, 12, 1), set(60, 12, 1), set(60, 10, 0)]];
    const result = prescribe(squat, history, {
      sets: 3,
      repRange: [8, 12],
      experience: 'some',
    });
    expect(result.kind).toBe('hold');
    expect(result.weightKg).toBe(60);
    expect(result.rationale).toContain('12, 12, 10');
  });

  it('holds when she hit the reps but the sets were too easy', () => {
    // Twelve reps with four still in reserve means the weight was too light to
    // have earned an increase - the reps came free.
    const history: SessionHistory = [session(60, 12, 4)];
    const result = prescribe(squat, history, {
      sets: 3,
      repRange: [8, 12],
      experience: 'some',
    });
    expect(result.kind).toBe('hold');
  });

  it('deloads after three flat sessions, not two', () => {
    const stalled = session(60, 9, 0);
    const twoSessions: SessionHistory = [stalled, stalled];
    expect(
      prescribe(squat, twoSessions, { sets: 3, repRange: [8, 12], experience: 'some' }).kind,
    ).toBe('hold');

    const threeSessions: SessionHistory = [stalled, stalled, stalled];
    const result = prescribe(squat, threeSessions, {
      sets: 3,
      repRange: [8, 12],
      experience: 'some',
    });
    expect(result.kind).toBe('deload');
    expect(result.weightKg).toBe(55); // 10% off, rounded to a loadable step
  });

  it('does not deload while reps are still improving at the same weight', () => {
    const improving: SessionHistory = [session(60, 11, 1), session(60, 10, 1), session(60, 9, 1)];
    expect(detectStall(improving)).toBe(false);
    expect(
      prescribe(squat, improving, { sets: 3, repRange: [8, 12], experience: 'some' }).kind,
    ).toBe('hold');
  });

  it('does not call it a stall when the weight changed', () => {
    const climbing: SessionHistory = [session(65, 9, 1), session(62.5, 9, 1), session(60, 9, 1)];
    expect(detectStall(climbing)).toBe(false);
  });

  it('uses the smaller increment on dumbbell lifts', () => {
    const result = prescribe(dumbbellRow, [session(10, 12, 1)], {
      sets: 3,
      repRange: [8, 12],
      experience: 'some',
    });
    expect(result.kind).toBe('increase');
    expect(result.weightKg).toBe(12);
  });

  it('progresses bodyweight work in reps, never in kilos', () => {
    const cleared = prescribe(pushUp, [session(0, 12, 1)], {
      sets: 3,
      repRange: [8, 12],
      experience: 'never',
    });
    expect(cleared.weightKg).toBe(0);
    expect(cleared.kind).toBe('increase');
    expect(cleared.rationale).toMatch(/slow/i);

    const short = prescribe(pushUp, [[set(0, 8), set(0, 7), set(0, 6)]], {
      sets: 3,
      repRange: [8, 12],
      experience: 'never',
    });
    expect(short.kind).toBe('hold');
    expect(short.weightKg).toBe(0);
  });

  it('never prescribes a weight below one increment', () => {
    const tiny = getExercise('lateral-raise')!;
    const stalled = session(1, 9, 0);
    const result = prescribe(tiny, [stalled, stalled, stalled], {
      sets: 2,
      repRange: [10, 15],
      experience: 'never',
    });
    expect(result.weightKg).toBeGreaterThanOrEqual(tiny.incrementKg);
  });
});

describe('roundTo', () => {
  it('snaps to the nearest step and passes through a zero step', () => {
    expect(roundTo(33.7, 2.5)).toBe(32.5);
    expect(roundTo(34, 2.5)).toBe(35);
    expect(roundTo(7.3, 0)).toBe(7.3);
  });
});
