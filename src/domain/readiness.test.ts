import { describe, expect, it } from 'vitest';
import {
  applyReadiness,
  assessReadiness,
  bandFor,
  readinessScore,
  shouldOfferToStopAdjusting,
  symptomsFor,
} from './readiness';
import { getExercise } from './exercises';
import { prescribe, type SessionHistory } from './progression';

const squat = getExercise('barbell-back-squat')!;
const pushUp = getExercise('push-up')!;

const at = (weightKg: number, reps: number, rir = 2, count = 3) =>
  Array.from({ length: count }, () => ({ weightKg, reps, rir }));

const held = (history: SessionHistory = [at(60, 9)]) =>
  prescribe(squat, history, { sets: 3, repRange: [8, 12], experience: 'some' });

describe('scoring', () => {
  it('treats a middling day as a full session', () => {
    // If "everything is a 3" produced a reduction, the app would quietly shave
    // weight off most ordinary days and stall her progress.
    expect(bandFor(readinessScore({ sleep: 3, energy: 3, soreness: 3 }))).toBe('green');
  });

  it('spans the full range', () => {
    expect(readinessScore({ sleep: 5, energy: 5, soreness: 1 })).toBe(100);
    expect(readinessScore({ sleep: 1, energy: 1, soreness: 5 })).toBe(0);
  });

  it('counts soreness against her', () => {
    const fresh = readinessScore({ sleep: 4, energy: 4, soreness: 1 });
    const wrecked = readinessScore({ sleep: 4, energy: 4, soreness: 5 });
    expect(fresh).toBeGreaterThan(wrecked);
  });

  it('lands in amber for a poor night and in red for a bad week', () => {
    expect(assessReadiness({ sleep: 2, energy: 3, soreness: 3 }).band).toBe('amber');
    expect(assessReadiness({ sleep: 2, energy: 2, soreness: 4 }).band).toBe('red');
  });

  it('clamps values that arrive outside the scale', () => {
    expect(readinessScore({ sleep: 99, energy: 99, soreness: -4 })).toBe(100);
  });
});

describe('applying a band to a prescription', () => {
  it('leaves a green day completely alone', () => {
    const original = held();
    const result = applyReadiness(original, squat, assessReadiness({ sleep: 4, energy: 4, soreness: 2 }));
    expect(result).toEqual(original);
    expect(result.readiness).toBeUndefined();
  });

  it('takes about 5% off an amber day and keeps the sets', () => {
    const original = held();
    const result = applyReadiness(original, squat, assessReadiness({ sleep: 2, energy: 3, soreness: 3 }));

    expect(result.weightKg).toBe(57.5); // 60 * 0.95, rounded to a loadable step
    expect(result.sets).toBe(original.sets);
    expect(result.readiness?.originalWeightKg).toBe(60);
  });

  it('takes about 10% off a red day and drops one set', () => {
    const original = held();
    const result = applyReadiness(original, squat, assessReadiness({ sleep: 1, energy: 2, soreness: 5 }));

    expect(result.weightKg).toBe(55);
    expect(result.sets).toBe(original.sets - 1);
    expect(result.readiness?.band).toBe('red');
    expect(result.readiness?.originalSets).toBe(original.sets);
  });

  it('never adjusts by more than 10%', () => {
    const original = held();
    const worst = applyReadiness(original, squat, assessReadiness({ sleep: 1, energy: 1, soreness: 5 }));
    expect(worst.weightKg).toBeGreaterThanOrEqual(original.weightKg * 0.9 - 2.5);
  });

  it('keeps the original numbers so the screen can offer to put them back', () => {
    const original = held();
    const result = applyReadiness(original, squat, assessReadiness({ sleep: 1, energy: 1, soreness: 5 }));

    expect(result.readiness).toEqual({
      band: 'red',
      originalWeightKg: original.weightKg,
      originalSets: original.sets,
    });
  });

  it('claims no adjustment when rounding leaves everything unchanged', () => {
    // 5% off a 2 kg lateral raise rounds straight back to 2 kg, and amber does
    // not drop a set - so nothing moved and the card must not say it did.
    const raise = getExercise('lateral-raise')!;
    const original = prescribe(raise, [at(2, 12)], {
      sets: 2,
      repRange: [10, 15],
      experience: 'never',
    });
    const result = applyReadiness(original, raise, assessReadiness({ sleep: 2, energy: 3, soreness: 3 }));

    expect(result.weightKg).toBe(original.weightKg);
    expect(result.readiness).toBeUndefined();
  });

  it('still marks an adjustment when only the set count moved', () => {
    const raise = getExercise('lateral-raise')!;
    const original = prescribe(raise, [at(2, 12)], {
      sets: 2,
      repRange: [10, 15],
      experience: 'never',
    });
    const result = applyReadiness(original, raise, assessReadiness({ sleep: 1, energy: 1, soreness: 5 }));

    expect(result.sets).toBe(1);
    expect(result.readiness?.originalSets).toBe(2);
  });

  it('only moves the set count for bodyweight work', () => {
    const original = prescribe(pushUp, [at(0, 9)], {
      sets: 3,
      repRange: [8, 12],
      experience: 'never',
    });
    const result = applyReadiness(original, pushUp, assessReadiness({ sleep: 1, energy: 2, soreness: 5 }));

    expect(result.weightKg).toBe(0);
    expect(result.sets).toBe(2);
  });

  it('does nothing when she has turned adjustments off', () => {
    const original = held();
    const red = assessReadiness({ sleep: 1, energy: 1, soreness: 5 });
    expect(applyReadiness(original, squat, red, false)).toEqual(original);
  });

  it('does nothing when she has not checked in', () => {
    const original = held();
    expect(applyReadiness(original, squat, null)).toEqual(original);
  });

  it('leaves the rep range and rationale untouched', () => {
    const original = held();
    const result = applyReadiness(original, squat, assessReadiness({ sleep: 1, energy: 2, soreness: 5 }));
    expect(result.repRange).toEqual(original.repRange);
    expect(result.rationale).toBe(original.rationale);
    expect(result.kind).toBe(original.kind);
  });
});

describe('noticing that it keeps being wrong', () => {
  it('offers to stop once she has overridden most of a run', () => {
    expect(shouldOfferToStopAdjusting({ offered: 4, overridden: 3 })).toBe(true);
    expect(shouldOfferToStopAdjusting({ offered: 6, overridden: 5 })).toBe(true);
  });

  it('stays quiet on a small or mixed sample', () => {
    expect(shouldOfferToStopAdjusting({ offered: 3, overridden: 3 })).toBe(false);
    expect(shouldOfferToStopAdjusting({ offered: 5, overridden: 2 })).toBe(false);
    expect(shouldOfferToStopAdjusting({ offered: 0, overridden: 0 })).toBe(false);
  });
});

describe('symptom options', () => {
  it('hides cycle symptoms from someone who is not tracking', () => {
    const general = symptomsFor(false).map((choice) => choice.id);
    expect(general).toContain('poor_sleep');
    expect(general).not.toContain('cramps');

    expect(symptomsFor(true).map((choice) => choice.id)).toContain('cramps');
  });
});
