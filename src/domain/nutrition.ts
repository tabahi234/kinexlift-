import type { ActivityLevel, WeightGoal } from '../db/schema';

/**
 * Nutrition targets.
 *
 * Pure arithmetic over published equations, with every constant named and
 * sourced in a comment. Nothing here is invented, and nothing is guessed: a
 * missing input returns null rather than a plausible-looking number.
 *
 * The one opinion baked in is the guardrail. This app is for women who lift,
 * and the failure mode that actually hurts them is not eating slightly too
 * much - it is chronic under-fuelling, which costs bone density, periods and
 * the very strength they came here for. So the calorie target is floored, and
 * the floor is allowed to overrule the goal.
 */

/* --------------------------------- BMI --------------------------------- */

export function bmi(weightKg: number, heightCm: number): number | null {
  if (!(weightKg > 0) || !(heightCm > 0)) return null;
  const metres = heightCm / 100;
  return weightKg / (metres * metres);
}

export type BmiBand = 'under' | 'healthy' | 'over' | 'obese';

export interface BmiReading {
  value: number;
  band: BmiBand;
  label: string;
  /** Healthy-BMI weight range for her height, in kg. */
  healthyRangeKg: [number, number];
}

/** WHO cut-points. Same for adult women and men. */
export function bmiBand(value: number): BmiBand {
  if (value < 18.5) return 'under';
  if (value < 25) return 'healthy';
  if (value < 30) return 'over';
  return 'obese';
}

const BMI_LABEL: Record<BmiBand, string> = {
  under: 'Below the healthy range',
  healthy: 'In the healthy range',
  over: 'Above the healthy range',
  obese: 'Well above the healthy range',
};

export function readBmi(weightKg: number, heightCm: number): BmiReading | null {
  const value = bmi(weightKg, heightCm);
  if (value === null) return null;
  const metres = heightCm / 100;
  return {
    value: Math.round(value * 10) / 10,
    band: bmiBand(value),
    label: BMI_LABEL[bmiBand(value)],
    healthyRangeKg: [
      Math.round(18.5 * metres * metres * 10) / 10,
      Math.round(24.9 * metres * metres * 10) / 10,
    ],
  };
}

/**
 * The caveat that has to travel with the number.
 *
 * BMI cannot tell muscle from fat, and it was never designed to describe an
 * individual - it is a population screening tool. A woman who has been lifting
 * for two years can read "overweight" while being demonstrably healthier than
 * she was at a lower number, and if the app does not say so, the number will
 * quietly undo the training.
 */
export const BMI_CAVEAT =
  'BMI only knows your height and your weight. It cannot tell muscle from fat, so it reads high for people who lift and it says nothing at all about where you carry weight. Treat it as one rough marker among several, not a verdict.';

/* ---------------------------- energy needs ---------------------------- */

/**
 * Mifflin-St Jeor, female. The most accurate of the common predictive
 * equations for people who are not extremely lean or extremely large.
 *   BMR = 10*kg + 6.25*cm - 5*age - 161
 */
export function bmr(weightKg: number, heightCm: number, age: number): number | null {
  if (!(weightKg > 0) || !(heightCm > 0) || !(age > 0)) return null;
  return Math.round(10 * weightKg + 6.25 * heightCm - 5 * age - 161);
}

/**
 * Multipliers for life *outside* training only.
 *
 * The usual published multipliers bundle exercise in, which double-counts as
 * soon as you also know how much she trains - and this app does know, from the
 * log. So these are deliberately lower than the numbers you will find
 * elsewhere, and training is added on top in kilocalories.
 */
const LIFESTYLE_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.3,
  moderate: 1.45,
  active: 1.6,
};

export const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  sedentary: 'Mostly sitting',
  light: 'On my feet a bit',
  moderate: 'On my feet a lot',
  active: 'Physically demanding days',
};

export const ACTIVITY_HINT: Record<ActivityLevel, string> = {
  sedentary: 'Desk work, driving, not much walking',
  light: 'Some walking, errands, light housework',
  moderate: 'Teaching, nursing, retail, chasing children',
  active: 'Manual work, or on the move most of the day',
};

/**
 * Kilocalories burned by an activity, from its MET value.
 *   kcal/min = MET * 3.5 * kg / 200
 * This is the standard ACSM conversion and it is close enough for planning.
 */
export function metKcal(met: number, minutes: number, weightKg: number): number {
  if (!(met > 0) || !(minutes > 0) || !(weightKg > 0)) return 0;
  return Math.round((met * 3.5 * weightKg) / 200 * minutes);
}

/** Resistance training, sustained effort with rests. Compendium value 5.0. */
export const LIFTING_MET = 5;

export interface EnergyInput {
  weightKg: number;
  heightCm: number;
  age: number;
  activityLevel: ActivityLevel;
  /** From the log, averaged over recent weeks. Not from the plan. */
  trainingKcalPerWeek: number;
}

export interface Energy {
  bmr: number;
  /** Everything except purposeful training. */
  baselineKcal: number;
  trainingKcalPerDay: number;
  tdee: number;
}

export function energyNeeds(input: EnergyInput): Energy | null {
  const base = bmr(input.weightKg, input.heightCm, input.age);
  if (base === null) return null;

  const baseline = Math.round(base * LIFESTYLE_FACTOR[input.activityLevel]);
  const training = Math.round(Math.max(0, input.trainingKcalPerWeek) / 7);

  return {
    bmr: base,
    baselineKcal: baseline,
    trainingKcalPerDay: training,
    tdee: baseline + training,
  };
}

/* -------------------------- body composition -------------------------- */

/**
 * Deurenberg estimate of body fat from BMI and age, female:
 *   BF% = 1.20*BMI + 0.23*age - 5.4
 *
 * Its error on an individual is around five percentage points, which is far
 * too coarse to show her as a body-fat reading. It is used for one thing only:
 * putting the energy-availability floor on roughly the right footing, where
 * being approximately right is much better than not checking at all.
 */
export function estimatedBodyFatPercent(bmiValue: number, age: number): number | null {
  if (!(bmiValue > 0) || !(age > 0)) return null;
  const percent = 1.2 * bmiValue + 0.23 * age - 5.4;
  return Math.min(60, Math.max(8, percent));
}

export function fatFreeMassKg(weightKg: number, bodyFatPercent: number): number {
  return weightKg * (1 - bodyFatPercent / 100);
}

/**
 * Energy availability: what is left for the body once training is paid for,
 * per kilo of fat-free mass.
 *
 *   EA = (intake - exercise) / FFM
 *
 * Below 30 kcal/kg FFM/day is the threshold associated with low energy
 * availability - disrupted cycles, falling bone density, stalled training.
 * Around 45 is where things function normally.
 */
export const EA_LOW = 30;
export const EA_OPTIMAL = 45;

/**
 * Where a warning is worth showing.
 *
 * Not 45. Plenty of perfectly healthy women sit in the high thirties at true
 * maintenance, and warning every one of them turns the one message on this
 * screen that really matters into wallpaper. Between 30 and 35 is close enough
 * to the low-availability threshold to be worth a sentence.
 */
export const EA_CAUTION = 35;

export function energyAvailability(
  intakeKcal: number,
  exerciseKcalPerDay: number,
  ffmKg: number,
): number | null {
  if (!(ffmKg > 0)) return null;
  return (intakeKcal - exerciseKcalPerDay) / ffmKg;
}

/* ------------------------------- targets ------------------------------- */

/** Roughly 0.5 kg a week, and never more than a fifth of maintenance. */
const MAX_DEFICIT_KCAL = 500;
const MAX_DEFICIT_FRACTION = 0.2;
/** A lean gain. Bigger surpluses mostly add fat, not muscle. */
const SURPLUS_KCAL = 250;

export type TargetFloor = 'none' | 'bmr' | 'energy-availability';

export interface CalorieTarget {
  kcal: number;
  /** What the goal alone would have asked for, before the floor. */
  requestedKcal: number;
  floor: TargetFloor;
  /** Present when the floor overruled the goal. Shown to her verbatim. */
  floorNote: string | null;
  /** Estimated energy availability at this target, kcal/kg FFM/day. */
  energyAvailability: number | null;
}

export function calorieTarget(input: {
  energy: Energy;
  weightGoal: WeightGoal;
  ffmKg: number | null;
}): CalorieTarget {
  const { energy, weightGoal, ffmKg } = input;

  const deficit = Math.min(MAX_DEFICIT_KCAL, Math.round(energy.tdee * MAX_DEFICIT_FRACTION));
  const requested =
    weightGoal === 'lose'
      ? energy.tdee - deficit
      : weightGoal === 'gain'
        ? energy.tdee + SURPLUS_KCAL
        : energy.tdee;

  let kcal = requested;
  let floor: TargetFloor = 'none';
  let floorNote: string | null = null;

  // Floor one: never prescribe below resting metabolic rate. Whatever the
  // goal, eating less than the body burns lying still is not a plan.
  if (kcal < energy.bmr) {
    kcal = energy.bmr;
    floor = 'bmr';
    floorNote = `Raised to ${energy.bmr} kcal. That is what your body uses at complete rest, and going under it is where cycles, sleep and strength start to go.`;
  }

  // Floor two: keep energy availability at or above the low-availability
  // threshold once training is paid for. This is the floor that actually
  // binds for someone small who trains a lot.
  let availability = ffmKg
    ? energyAvailability(kcal, energy.trainingKcalPerDay, ffmKg)
    : null;

  if (ffmKg && availability !== null && availability < EA_LOW) {
    const needed = Math.ceil(EA_LOW * ffmKg + energy.trainingKcalPerDay);
    kcal = needed;
    floor = 'energy-availability';
    floorNote = `Raised to ${needed} kcal. Once your training is paid for, anything less leaves too little for everything else your body has to do - and that shows up as missed periods and lost bone long before it shows up on the scale.`;
    availability = energyAvailability(kcal, energy.trainingKcalPerDay, ffmKg);
  }

  return {
    kcal: Math.round(kcal),
    requestedKcal: Math.round(requested),
    floor,
    floorNote,
    energyAvailability:
      availability === null ? null : Math.round(availability * 10) / 10,
  };
}

/* -------------------------------- macros -------------------------------- */

export interface Macros {
  proteinG: number;
  fatG: number;
  carbG: number;
  fibreG: number;
}

/**
 * Protein per kilo of body weight.
 *
 * A deficit is when protein matters most - it is what decides whether the
 * weight lost is fat or the muscle she has been working for. Above BMI 30 the
 * target is computed on the weight she would be at BMI 25, because scaling to
 * total mass produces a number nobody can eat and that no evidence supports.
 */
const PROTEIN_PER_KG: Record<WeightGoal, number> = {
  lose: 2,
  maintain: 1.7,
  gain: 1.8,
};

/** Below roughly 0.6 g/kg, hormone production and fat-soluble vitamins suffer. */
const FAT_PER_KG_MIN = 0.7;
const FAT_FRACTION = 0.28;
/** Dietary guidelines: 14 g of fibre per 1000 kcal. */
const FIBRE_PER_1000_KCAL = 14;

export function macroTargets(input: {
  kcal: number;
  weightKg: number;
  heightCm: number;
  weightGoal: WeightGoal;
}): Macros {
  const { kcal, weightKg, heightCm, weightGoal } = input;

  const metres = heightCm / 100;
  const bmiValue = weightKg / (metres * metres);
  const referenceKg = bmiValue > 30 ? 25 * metres * metres : weightKg;

  const proteinG = Math.round(referenceKg * PROTEIN_PER_KG[weightGoal]);
  const fatG = Math.round(
    Math.max((kcal * FAT_FRACTION) / 9, referenceKg * FAT_PER_KG_MIN),
  );

  // Carbohydrate takes what is left. It is the lever with the most room in it,
  // and it is also what fuels the session, so it is never squeezed to zero.
  const remaining = kcal - proteinG * 4 - fatG * 9;
  const carbG = Math.max(50, Math.round(remaining / 4));

  return {
    proteinG,
    fatG,
    carbG,
    fibreG: Math.round((kcal / 1000) * FIBRE_PER_1000_KCAL),
  };
}

/** 30-35 ml per kg is the usual adult guide; training days sit at the top. */
export function waterMl(weightKg: number, trainingToday: boolean): number {
  return Math.round(weightKg * (trainingToday ? 35 : 30));
}

/* ------------------------------ the plan ------------------------------ */

export interface NutritionPlan {
  bmi: BmiReading | null;
  energy: Energy;
  target: CalorieTarget;
  macros: Macros;
  waterMl: number;
  /** Estimated, and shown as such. Never displayed as a body-fat reading. */
  ffmKg: number | null;
  warnings: string[];
}

export type NutritionInput = EnergyInput & {
  weightGoal: WeightGoal;
  trainingToday: boolean;
};

/**
 * Everything the Fuel screen needs, or null when it cannot be computed.
 *
 * Height, weight and age are all genuinely required. Filling in a default age
 * would move the calorie target by over a hundred kilocalories a day without
 * telling her, so the screen asks instead.
 */
export function nutritionPlan(input: NutritionInput): NutritionPlan | null {
  const energy = energyNeeds(input);
  if (energy === null) return null;

  const reading = readBmi(input.weightKg, input.heightCm);
  const bmiValue = bmi(input.weightKg, input.heightCm);
  const bodyFat =
    bmiValue === null ? null : estimatedBodyFatPercent(bmiValue, input.age);
  const ffmKg = bodyFat === null ? null : fatFreeMassKg(input.weightKg, bodyFat);

  const target = calorieTarget({ energy, weightGoal: input.weightGoal, ffmKg });
  const macros = macroTargets({
    kcal: target.kcal,
    weightKg: input.weightKg,
    heightCm: input.heightCm,
    weightGoal: input.weightGoal,
  });

  const warnings: string[] = [];
  if (target.floorNote) warnings.push(target.floorNote);
  if (reading?.band === 'under' && input.weightGoal === 'lose') {
    warnings.push(
      'Your weight is already below the healthy range for your height. Losing more is not something this app will help with - please talk to a doctor or a dietitian first.',
    );
  }
  if (
    target.energyAvailability !== null &&
    target.energyAvailability < EA_CAUTION &&
    target.floor === 'none'
  ) {
    warnings.push(
      'For how much you train, this target is on the lean side. It is workable for a while, but if your periods change, your sleep gets worse or your lifts stop moving, eat more before you train less.',
    );
  }

  return {
    bmi: reading,
    energy,
    target,
    macros,
    waterMl: waterMl(input.weightKg, input.trainingToday),
    ffmKg: ffmKg === null ? null : Math.round(ffmKg * 10) / 10,
    warnings,
  };
}

export const NUTRITION_DISCLAIMER =
  'These are estimates from equations, not measurements. They are a starting point to adjust from - if your weight is not doing what you expected after three or four weeks, change the number, not the plan. Not medical or dietetic advice.';
