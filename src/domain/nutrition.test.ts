import { describe, expect, it } from 'vitest';
import {
  bmi,
  bmiBand,
  bmr,
  calorieTarget,
  energyAvailability,
  energyNeeds,
  EA_LOW,
  macroTargets,
  metKcal,
  nutritionPlan,
  readBmi,
} from './nutrition';

const HER = {
  weightKg: 65,
  heightCm: 165,
  age: 32,
  activityLevel: 'light' as const,
  trainingKcalPerWeek: 900,
};

describe('BMI', () => {
  it('is weight over height squared', () => {
    expect(bmi(65, 165)!).toBeCloseTo(23.88, 2);
  });

  it('refuses nonsense input rather than returning Infinity', () => {
    expect(bmi(65, 0)).toBeNull();
    expect(bmi(0, 165)).toBeNull();
    expect(bmi(-5, 165)).toBeNull();
  });

  it('uses the WHO cut-points', () => {
    expect(bmiBand(18.4)).toBe('under');
    expect(bmiBand(18.5)).toBe('healthy');
    expect(bmiBand(24.9)).toBe('healthy');
    expect(bmiBand(25)).toBe('over');
    expect(bmiBand(30)).toBe('obese');
  });

  it('gives the healthy weight range for her height', () => {
    const reading = readBmi(65, 165)!;
    expect(reading.healthyRangeKg[0]).toBeCloseTo(50.4, 1);
    expect(reading.healthyRangeKg[1]).toBeCloseTo(67.8, 1);
  });
});

describe('energy', () => {
  it('uses Mifflin-St Jeor for women', () => {
    // 10*65 + 6.25*165 - 5*32 - 161 = 1360.25
    expect(bmr(65, 165, 32)).toBe(1360);
  });

  it('returns null rather than guessing at a missing age', () => {
    expect(bmr(65, 165, 0)).toBeNull();
  });

  it('counts training separately from lifestyle, not inside it', () => {
    const resting = energyNeeds({ ...HER, trainingKcalPerWeek: 0 })!;
    const training = energyNeeds(HER)!;
    expect(training.baselineKcal).toBe(resting.baselineKcal);
    expect(training.tdee - resting.tdee).toBe(Math.round(900 / 7));
  });

  it('converts a MET value to kilocalories', () => {
    // 5 MET, 45 minutes, 65 kg -> 5 * 3.5 * 65 / 200 * 45
    expect(metKcal(5, 45, 65)).toBe(256);
  });
});

describe('calorie target', () => {
  const energy = energyNeeds(HER)!;

  it('holds at maintenance when she is not trying to change weight', () => {
    const target = calorieTarget({ energy, weightGoal: 'maintain', ffmKg: 45 });
    expect(target.kcal).toBe(energy.tdee);
    expect(target.floor).toBe('none');
  });

  it('caps the deficit at about half a kilo a week', () => {
    const target = calorieTarget({ energy, weightGoal: 'lose', ffmKg: 45 });
    expect(energy.tdee - target.requestedKcal).toBeLessThanOrEqual(500);
  });

  it('never prescribes below resting metabolic rate', () => {
    // A small, very active person is where an unfloored deficit goes wrong.
    const small = energyNeeds({
      weightKg: 45,
      heightCm: 152,
      age: 24,
      activityLevel: 'sedentary',
      trainingKcalPerWeek: 3500,
    })!;
    const target = calorieTarget({ energy: small, weightGoal: 'lose', ffmKg: 34 });
    expect(target.kcal).toBeGreaterThanOrEqual(small.bmr);
    expect(target.floorNote).not.toBeNull();
  });

  it('keeps energy availability at or above the low threshold', () => {
    const heavyTraining = energyNeeds({
      weightKg: 52,
      heightCm: 160,
      age: 27,
      activityLevel: 'sedentary',
      trainingKcalPerWeek: 4200,
    })!;
    const target = calorieTarget({
      energy: heavyTraining,
      weightGoal: 'lose',
      ffmKg: 40,
    });
    const available = energyAvailability(
      target.kcal,
      heavyTraining.trainingKcalPerDay,
      40,
    )!;
    expect(available).toBeGreaterThanOrEqual(EA_LOW - 0.05);
  });

  it('reports the number the goal asked for alongside the one it gave', () => {
    const small = energyNeeds({
      weightKg: 45,
      heightCm: 152,
      age: 24,
      activityLevel: 'sedentary',
      trainingKcalPerWeek: 3500,
    })!;
    const target = calorieTarget({ energy: small, weightGoal: 'lose', ffmKg: 34 });
    expect(target.requestedKcal).toBeLessThan(target.kcal);
  });
});

describe('macros', () => {
  it('raises protein in a deficit, where it matters most', () => {
    const cutting = macroTargets({
      kcal: 1800,
      weightKg: 65,
      heightCm: 165,
      weightGoal: 'lose',
    });
    const maintaining = macroTargets({
      kcal: 2200,
      weightKg: 65,
      heightCm: 165,
      weightGoal: 'maintain',
    });
    expect(cutting.proteinG).toBeGreaterThan(maintaining.proteinG);
  });

  it('scales protein to a reference weight above BMI 30', () => {
    // 2 g/kg of 120 kg is 240 g, which nobody eats and no evidence supports.
    const macros = macroTargets({
      kcal: 2000,
      weightKg: 120,
      heightCm: 165,
      weightGoal: 'lose',
    });
    expect(macros.proteinG).toBeLessThan(160);
  });

  it('roughly adds up to the calorie target', () => {
    const kcal = 2100;
    const macros = macroTargets({ kcal, weightKg: 65, heightCm: 165, weightGoal: 'maintain' });
    const fromMacros = macros.proteinG * 4 + macros.carbG * 4 + macros.fatG * 9;
    expect(Math.abs(fromMacros - kcal)).toBeLessThan(60);
  });

  it('never squeezes fat below what hormones need', () => {
    const macros = macroTargets({
      kcal: 1400,
      weightKg: 65,
      heightCm: 165,
      weightGoal: 'lose',
    });
    expect(macros.fatG).toBeGreaterThanOrEqual(Math.round(65 * 0.7));
  });
});

describe('the whole plan', () => {
  it('produces a coherent set of numbers', () => {
    const plan = nutritionPlan({ ...HER, weightGoal: 'maintain', trainingToday: true })!;
    expect(plan.bmi!.value).toBeCloseTo(23.9, 1);
    expect(plan.target.kcal).toBe(plan.energy.tdee);
    expect(plan.macros.proteinG).toBeGreaterThan(90);
    expect(plan.waterMl).toBe(65 * 35);
  });

  it('warns rather than helps when she is already underweight and cutting', () => {
    const plan = nutritionPlan({
      weightKg: 45,
      heightCm: 168,
      age: 25,
      activityLevel: 'light',
      trainingKcalPerWeek: 900,
      weightGoal: 'lose',
      trainingToday: false,
    })!;
    expect(plan.warnings.some((warning) => warning.includes('doctor'))).toBe(true);
  });
});
