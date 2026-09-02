import type { DietPattern, MealSlot } from '../db/schema';
import type { Cuisine } from './cuisines';
import {
  addNutrients,
  allowedFoods,
  isFrom,
  isUniversal,
  NO_NUTRIENTS,
  scale,
  sortForCuisine,
  type Food,
  type Nutrients,
} from './foods';
import type { Macros } from './nutrition';

/**
 * Meal assembly.
 *
 * Deterministic, like everything else that decides what she is told to do.
 * The same day, the same targets and the same kitchen produce the same plan,
 * every time, offline. The model in the coach layer can explain a plan or
 * argue with it, but it does not get to invent one - a language model asked to
 * do arithmetic over portion sizes will happily hand back a day that adds up
 * to the wrong number.
 *
 * The strategy is deliberately dull: pick an anchor for each part of the meal
 * from what she actually eats, then scale the portions until the day lands on
 * her protein and calorie targets. Whatever is left over is reported as a gap
 * rather than hidden.
 */

export interface PlannedItem {
  food: Food;
  servings: number;
}

export interface PlannedMeal {
  slot: MealSlot;
  items: PlannedItem[];
  totals: Nutrients;
}

export interface DayPlan {
  meals: PlannedMeal[];
  totals: Nutrients;
  /** Signed difference from target: positive means the plan is over. */
  kcalGap: number;
  proteinGap: number;
  /** Empty when nothing needs saying. */
  notes: string[];
  /**
   * What this plan was actually built to hit. On a whole day that is her
   * target; on a plan for the rest of the day it is her target minus what she
   * has already eaten, and the screen has to say which it is showing.
   */
  targetKcal: number;
  targetProteinG: number;
  /** Which meals it covers. Shorter than four when it is planning from lunch. */
  slots: MealSlot[];
  /** True when it left out meals she has already had. */
  partial: boolean;
}

/** How the day's calories are split. Sums to 1. */
const SLOT_SHARE: Record<MealSlot, number> = {
  breakfast: 0.25,
  lunch: 0.3,
  dinner: 0.3,
  snack: 0.15,
};

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Portions are only useful if she can actually serve them. */
const roundServings = (value: number): number =>
  Math.max(0.5, Math.round(value * 2) / 2);

/**
 * A stable number from a string, so a plan varies day to day without ever
 * varying between two renders of the same day.
 */
function seedFrom(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

const pick = <T>(options: T[], seed: number, offset: number): T | undefined =>
  options.length === 0 ? undefined : options[(seed + offset) % options.length];

export interface MealPlanInput {
  macros: Macros;
  kcal: number;
  dietPattern: DietPattern;
  avoid: string[];
  /** Any 'YYYY-MM-DD'. Used only to rotate the choices. */
  dateKey: string;
  /**
   * Whose kitchen to build from. Regional dishes and everyday staples are
   * reached for first; the rest of the table is still there if her exclusions
   * leave her region too thin to fill a slot. Null - she has not said - uses
   * the whole table, because guessing a region is worse than not sorting.
   */
  cuisine?: Cuisine | null;
  /**
   * Which meals to plan. Defaults to the whole day; pass a shorter list to
   * plan the rest of it. The calorie split is renormalised over whatever is
   * here, so planning dinner and a snack does not hand her 45% of a day.
   */
  slots?: MealSlot[];
  /**
   * What she has already eaten. Subtracted from the targets before anything
   * is chosen. A plan that ignores the 800 kcal already in the log is a plan
   * that puts her 800 kcal over and calls it a target.
   */
  eaten?: Nutrients;
}

function totalsOf(items: PlannedItem[]): Nutrients {
  return items.reduce(
    (sum, item) => addNutrients(sum, scale(item.food, item.servings)),
    NO_NUTRIENTS,
  );
}

const dayTotals = (meals: PlannedMeal[]): Nutrients =>
  meals.reduce((sum, meal) => addNutrients(sum, meal.totals), NO_NUTRIENTS);

/**
 * Brings the day onto the calorie target by moving the carbohydrate.
 *
 * Choosing the protein portion and the carbohydrate portion independently gets
 * each macro roughly right and the calorie total badly wrong - the first
 * version of this landed nearly five hundred kilocalories over, which is not a
 * meal plan, it is a suggestion with a rounding error the size of lunch.
 *
 * Carbohydrate is the lever because it is the one with the most room in it:
 * the protein is the point of the plan, and the fat has a floor under it for
 * hormonal reasons. Portions move half a serving at a time so what comes out
 * is still something a person can put on a plate.
 */
function reconcile(meals: PlannedMeal[], targetKcal: number): Nutrients {
  /**
   * What may move, in the order it is allowed to.
   *
   * Carbohydrate first: it is the lever with the most room in it. Then the
   * added fat, which is a garnish rather than a meal. Protein last and
   * grudgingly - it is the point of the plan, so it only gives way when a low
   * target genuinely cannot be met any other way, and never below half a
   * serving.
   */
  const tiers: { group: string; min: number; max: number }[] = [
    { group: 'carb', min: MIN_SERVINGS, max: MAX_CARB_SERVINGS },
    // A composite dish - biryani, ramen, feijoada - is mostly its
    // carbohydrate, so it gives way early and for the same reason.
    { group: 'mixed', min: MIN_SERVINGS, max: 3 },
    { group: 'fat', min: MIN_SERVINGS, max: 3 },
    { group: 'dairy', min: MIN_SERVINGS, max: 3 },
    { group: 'protein', min: MIN_SERVINGS, max: 3 },
  ];

  const entries = meals.flatMap((meal) =>
    meal.items.map((item) => ({
      meal,
      item,
      tier: tiers.findIndex((tier) => tier.group === item.food.group),
    })),
  );

  const tolerance = Math.max(60, targetKcal * 0.04);

  // Bounded: every pass either moves a portion by half a serving or stops.
  for (let pass = 0; pass < 120; pass++) {
    const gap = dayTotals(meals).kcal - targetKcal;
    if (Math.abs(gap) <= tolerance) break;

    const movable = entries.filter(({ item, tier }) => {
      if (tier === -1) return false;
      const bounds = tiers[tier]!;
      return gap > 0 ? item.servings > bounds.min : item.servings < bounds.max;
    });
    if (movable.length === 0) break;

    const tier = Math.min(...movable.map((entry) => entry.tier));
    const candidates = movable.filter((entry) => entry.tier === tier);

    // Take from the biggest plate and add to the smallest, so the day stays
    // evenly spread instead of ending with one enormous bowl of rice.
    const chosen = candidates.reduce((best, entry) =>
      gap > 0
        ? entry.item.servings > best.item.servings
          ? entry
          : best
        : entry.item.servings < best.item.servings
          ? entry
          : best,
    );

    chosen.item.servings += gap > 0 ? -0.5 : 0.5;
    chosen.meal.totals = totalsOf(chosen.meal.items);
  }

  return dayTotals(meals);
}

/**
 * A day of meals that lands on her targets.
 *
 * Returns null only when her exclusions leave nothing to build from - which
 * the screen has to handle, because "vegan, no soy, no nuts, no gluten" is a
 * real combination and silently serving her chicken would be worse than
 * saying so.
 */
/** Enough protein per serving that a meal does not need four of them. */
const MAIN_PROTEIN_MIN_G = 10;
/** A snack is a snack. Nothing here should be a plate of food. */
const SNACK_MAX_KCAL = 220;
const MIN_SERVINGS = 0.5;
const MAX_CARB_SERVINGS = 5;

/**
 * Her kitchen first.
 *
 * Regional dishes and the things everyone eats, unless that leaves too little
 * to choose from in this role - in which case the whole table comes back,
 * because a slot that resolves to nothing is worse than a slot filled from
 * somewhere else. Same rule as `candidatesWithFallback` on the training side.
 */
function kitchen(foods: Food[], cuisine: Cuisine | null): Food[] {
  if (cuisine === null) return foods;
  const own = foods.filter((food) => isFrom(food, cuisine) || isUniversal(food));
  return own.length >= 2 ? own : foods;
}

/** Enough carbohydrate left in the slot to be worth putting a second dish on the plate. */
const CARB_SIDE_MIN_FRACTION = 0.25;

/** Below this a snack is a nice thing to eat rather than part of the plan. */
const SNACK_MIN_PROTEIN_G = 5;

/**
 * The ones worth anchoring on, or all of them if that leaves nothing.
 *
 * Same shape as `kitchen`: prefer, then fall back, never return empty. A slot
 * that resolves to nothing is the failure this whole file is arranged to
 * avoid.
 */
function withProtein(foods: Food[], minimum: number): Food[] {
  const dense = foods.filter((food) => food.proteinG >= minimum);
  return dense.length > 0 ? dense : foods;
}

export function buildDayPlan(input: MealPlanInput): DayPlan | null {
  const cuisine = input.cuisine ?? null;
  const slots = input.slots ?? SLOT_ORDER;
  if (slots.length === 0) return null;

  // Sorted before anything is picked, so the rotation itself walks her own
  // region first rather than the table's declaration order.
  const pantry = sortForCuisine(allowedFoods(input.dietPattern, input.avoid), cuisine);
  if (pantry.length === 0) return null;

  // A composite dish - biryani, ramen, arroz con pollo - is a main meal, and
  // leaving it out of the anchors is why the planner used to be unable to
  // suggest half the table. Its carbohydrate is accounted for below rather
  // than served twice.
  const proteinLike = pantry.filter(
    (food) =>
      !food.supplement &&
      (food.group === 'protein' || food.group === 'dairy' || food.group === 'mixed'),
  );
  // Anchoring a main meal on something with six grams of protein a serving is
  // what produces "three glasses of lassi for lunch": the maths is right and
  // the meal is absurd. The list falls back to everything only if a diet
  // leaves nothing dense enough.
  const mains = proteinLike.filter((food) => food.proteinG >= MAIN_PROTEIN_MIN_G);
  const proteins = kitchen(mains.length > 0 ? mains : proteinLike, cuisine);
  const carbs = kitchen(
    pantry.filter((food) => food.group === 'carb'),
    cuisine,
  );
  const veg = pantry.filter((food) => food.group === 'veg');
  const fruit = pantry.filter((food) => food.group === 'fruit');
  const sides = kitchen(veg.length > 0 ? veg : fruit, cuisine);
  const fats = kitchen(
    pantry.filter((food) => food.group === 'fat'),
    cuisine,
  );
  // Tagged by hand, not inferred from the group. The inferred version offered
  // "Snack: 50 g of cooked chicken breast" - under the ceiling, a protein, and
  // not something any person has ever eaten between meals.
  const snacks = kitchen(
    pantry.filter((food) => food.snack === true && food.kcal <= SNACK_MAX_KCAL),
    cuisine,
  );

  if (proteins.length === 0 || carbs.length === 0) return null;

  // What is left to eat, not what the whole day was worth. Floored at zero so
  // a day she has already overshot plans a small sensible meal rather than
  // solving for a negative calorie target.
  const eaten = input.eaten ?? NO_NUTRIENTS;
  const targetKcal = Math.max(0, input.kcal - eaten.kcal);
  const targetProteinG = Math.max(0, input.macros.proteinG - eaten.proteinG);
  const targetCarbG = Math.max(0, input.macros.carbG - eaten.carbG);
  const targetFatG = Math.max(0, input.macros.fatG - eaten.fatG);
  const targetFibreG = Math.max(0, input.macros.fibreG - eaten.fibreG);

  // The shares are renormalised over the slots actually being planned, so
  // "dinner and a snack" gets the whole remainder rather than 45% of it.
  const shareTotal = slots.reduce((sum, slot) => sum + SLOT_SHARE[slot], 0);

  const seed = seedFrom(input.dateKey);
  const meals: PlannedMeal[] = [];

  slots.forEach((slot, index) => {
    const share = SLOT_SHARE[slot] / shareTotal;
    const items: PlannedItem[] = [];

    if (slot === 'snack') {
      // The savoury half is the half that carries protein. Picking from every
      // snack she can eat gave her a snack of two handfuls of dates - one
      // gram of protein and a hundred and thirty calories, in the one slot
      // that exists to top the day up.
      const savoury = pick(withProtein(snacks, SNACK_MIN_PROTEIN_G), seed, index * 3);
      // Her fruit bowl, not the table's. This used to reach past the region
      // filter and put dates in a Greek snack.
      const bowl = kitchen(fruit, cuisine).filter((food) => food.id !== savoury?.id);
      const sweet = pick(bowl, seed, index * 3 + 1);
      if (savoury) {
        items.push({
          food: savoury,
          servings: Math.min(
            2,
            roundServings((targetProteinG * share) / Math.max(1, savoury.proteinG)),
          ),
        });
      }
      if (sweet) items.push({ food: sweet, servings: 1 });
      meals.push({ slot, items, totals: totalsOf(items) });
      return;
    }

    const protein = pick(proteins, seed, index * 3);
    const carb = pick(carbs, seed, index * 3 + 1);
    const side = pick(sides, seed, index * 3 + 2);

    if (protein) {
      items.push({
        food: protein,
        servings: Math.min(
          3,
          roundServings((targetProteinG * share) / Math.max(1, protein.proteinG)),
        ),
      });
    }

    // A dish that already carries its own rice does not get rice next to it.
    // Without this, biryani came with a cup of basmati beside it, because a
    // minimum serving of half a portion is still half a portion.
    const fromAnchor = protein ? protein.carbG * (items[0]?.servings ?? 0) : 0;
    const carbNeeded = Math.max(0, targetCarbG * share - fromAnchor);
    if (carb && carbNeeded > carb.carbG * CARB_SIDE_MIN_FRACTION) {
      items.push({
        food: carb,
        servings: Math.min(
          MAX_CARB_SERVINGS,
          roundServings(carbNeeded / Math.max(1, carb.carbG)),
        ),
      });
    }

    if (side) items.push({ food: side, servings: 1 });

    meals.push({ slot, items, totals: totalsOf(items) });
  });

  // Fat is balanced before the calorie reconciliation, because it can be added
  // to an otherwise finished meal without changing what the meal is - and
  // because adding it afterwards would undo the reconciliation.
  const beforeFat = dayTotals(meals);
  const fatShortfall = targetFatG - beforeFat.fatG;
  const fat = fats.length > 0 ? fats[seed % fats.length] : undefined;
  if (fat && fatShortfall > fat.fatG * 0.5) {
    const servings = Math.min(3, roundServings(fatShortfall / fat.fatG));
    // The last main meal being planned, which is dinner on a whole day and
    // whatever she has left on a partial one.
    const host = [...meals].reverse().find((meal) => meal.slot !== 'snack') ?? meals[0];
    if (host) {
      host.items.push({ food: fat, servings });
      host.totals = totalsOf(host.items);
    }
  }

  const totals = reconcile(meals, targetKcal);
  const kcalGap = Math.round(totals.kcal - targetKcal);
  const proteinGap = Math.round(totals.proteinG - targetProteinG);
  const partial = slots.length < SLOT_ORDER.length || eaten.kcal > 0;

  const notes: string[] = [];
  if (targetKcal > 0 && Math.abs(kcalGap) > targetKcal * 0.1) {
    notes.push(
      kcalGap > 0
        ? `This lands about ${kcalGap} kcal over. Take a portion off the biggest plate rather than skipping the protein.`
        : `This lands about ${Math.abs(kcalGap)} kcal under. Add to the carbohydrate at whichever meal sits before you train.`,
    );
  }
  if (proteinGap < -10) {
    notes.push(
      `Protein is about ${Math.abs(proteinGap)} g short here. That is the one worth fixing - it is what decides whether the training turns into muscle.`,
    );
  }
  if (totals.fibreG < targetFibreG * 0.7) {
    notes.push(
      'Fibre is on the low side. Beans, lentils and whole grains move it more than anything else in this list.',
    );
  }

  return {
    meals,
    totals,
    kcalGap,
    proteinGap,
    notes,
    targetKcal,
    targetProteinG,
    slots: [...slots],
    partial,
  };
}

/**
 * The meals still to come, given the hour.
 *
 * Takes the hour rather than reading a clock, so this file stays pure and the
 * ordering can be argued with in a test. Late enough at night and only a snack
 * is left, which is the honest answer - offering to plan tomorrow's breakfast
 * at eleven at night is a screen answering a question nobody asked.
 */
export function slotsRemaining(hour: number): MealSlot[] {
  if (hour < 10) return SLOT_ORDER;
  if (hour < 15) return ['lunch', 'dinner', 'snack'];
  if (hour < 20) return ['dinner', 'snack'];
  return ['snack'];
}

/* --------------------------- closing the gap --------------------------- */

export interface GapSuggestion {
  food: Food;
  servings: number;
  adds: Nutrients;
}

/**
 * Portions are capped here rather than solved exactly.
 *
 * Dividing the whole shortfall by one food's protein produces "four and a half
 * scoops of whey", which is not advice - it is arithmetic wearing advice's
 * clothes. A hundred grams of protein is closed by three or four items across
 * a day, so each suggestion offers a portion a person would actually serve and
 * says what it contributes.
 */
const MAX_GAP_SERVINGS = 2;

/**
 * What to eat to make up a protein shortfall inside a calorie budget.
 *
 * Sorted by protein per kilocalorie, so what comes back is genuinely the most
 * efficient thing available to her rather than the first match in the table.
 */
export function closeProteinGap(input: {
  proteinShortG: number;
  kcalRemaining: number;
  dietPattern: DietPattern;
  avoid: string[];
  cuisine?: Cuisine | null;
  limit?: number;
}): GapSuggestion[] {
  if (input.proteinShortG <= 0) return [];

  const cuisine = input.cuisine ?? null;
  // Her kitchen, then sorted by efficiency inside it. Sorting the whole table
  // by protein per kilocalorie and taking the top three answers "tuna, whey,
  // tilapia" for every woman on earth, which is arithmetic pretending to be
  // local knowledge. `kitchen` falls back to the whole table when her region
  // and her exclusions leave nothing dense enough.
  const pantry = kitchen(
    allowedFoods(input.dietPattern, input.avoid).filter((food) => food.proteinG >= 5),
    cuisine,
  ).sort((a, b) => b.proteinG / b.kcal - a.proteinG / a.kcal);

  // How much room is honestly left. Once she is at or past the target there is
  // no budget to fit anything into, so the cap comes off and the caller says
  // out loud that these go over - which is usually still the right call, since
  // protein is the macro worth being slightly over on.
  const budget = input.kcalRemaining > 0 ? input.kcalRemaining * 1.15 : Infinity;

  const limit = input.limit ?? 3;

  const offer = (food: Food): GapSuggestion | null => {
    const servings = Math.min(
      MAX_GAP_SERVINGS,
      roundServings(input.proteinShortG / food.proteinG),
    );
    const adds = scale(food, servings);
    return adds.kcal > budget ? null : { food, servings, adds };
  };

  const results: GapSuggestion[] = [];
  for (const food of pantry) {
    const suggestion = offer(food);
    if (suggestion) results.push(suggestion);
    if (results.length >= limit) break;
  }

  /*
   * One of these has to be something she cooks.
   *
   * Protein per kilocalorie is a real ranking and it is the same ranking
   * everywhere: tuna, whey and chicken breast win it for every woman on
   * earth. Answering with only those is a card that is technically correct
   * and never once names her dinner - and the whole argument of this app is
   * that a target you cannot hit with the food in your kitchen is a target
   * you abandon. So the last row is given to the most efficient thing from
   * her own region when the efficient three did not already include one.
   */
  if (cuisine !== null && !results.some((result) => isFrom(result.food, cuisine))) {
    const local = pantry.find(
      (food) =>
        isFrom(food, cuisine) && !results.some((result) => result.food.id === food.id),
    );
    const suggestion = local ? offer(local) : null;
    if (suggestion) {
      if (results.length >= limit) results.pop();
      results.push(suggestion);
    }
  }

  return results;
}

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

export { SLOT_ORDER };
