import { describe, expect, it } from 'vitest';
import { buildDayPlan, closeProteinGap, slotsRemaining } from './meals';
import {
  allowedFoods,
  FOODS,
  isFrom,
  isUniversal,
  searchFoods,
  sortForCuisine,
} from './foods';
import { COUNTRIES, CUISINES, cuisineForCountry, searchCountries } from './cuisines';
import { macroTargets } from './nutrition';

const KCAL = 2100;
const MACROS = macroTargets({
  kcal: KCAL,
  weightKg: 65,
  heightCm: 165,
  weightGoal: 'maintain',
});

const plan = (over: Partial<Parameters<typeof buildDayPlan>[0]> = {}) =>
  buildDayPlan({
    macros: MACROS,
    kcal: KCAL,
    dietPattern: 'omnivore',
    avoid: [],
    dateKey: '2026-05-01',
    ...over,
  });

describe('the food table', () => {
  it('has no duplicate ids', () => {
    const ids = FOODS.map((food) => food.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has macros that roughly account for the stated calories', () => {
    // Atwater: protein and available carbohydrate at 4 kcal/g, fat at 9, and
    // fibre at 2 rather than 4 because most of it is not absorbed. Counting
    // fibre at the full 4 makes a cup of spinach look like a 29% error when
    // the row is correct - so this check has to model it properly or it will
    // report a false failure on every high-fibre food in the table.
    //
    // A row more than 15% out after that really is a typo, and a typo here
    // quietly corrupts every target the app computes.
    for (const food of FOODS) {
      const fibre = Math.min(food.fibreG, food.carbG);
      const fromMacros =
        food.proteinG * 4 + (food.carbG - fibre) * 4 + fibre * 2 + food.fatG * 9;
      // Allowed to be out by 15% or 10 kcal, whichever is larger. On a 25 kcal
      // bowl of salad a percentage tolerance is measuring rounding, not
      // accuracy, and nothing in a day's eating turns on four kilocalories.
      const off = Math.abs(fromMacros - food.kcal);
      expect(
        off,
        `${food.id}: ${Math.round(fromMacros)} vs ${food.kcal} kcal`,
      ).toBeLessThanOrEqual(Math.max(10, food.kcal * 0.15));
    }
  });

  it('has a positive serving size for everything', () => {
    for (const food of FOODS) {
      expect(food.servingG, food.id).toBeGreaterThan(0);
      expect(food.kcal, food.id).toBeGreaterThan(0);
    }
  });
});

describe('diet patterns', () => {
  it('removes meat and fish for a vegetarian', () => {
    const pantry = allowedFoods('vegetarian', []);
    expect(
      pantry.some((food) => food.contains.includes('meat') || food.contains.includes('fish')),
    ).toBe(false);
  });

  it('removes dairy and egg as well for a vegan', () => {
    const pantry = allowedFoods('vegan', []);
    expect(
      pantry.some(
        (food) => food.contains.includes('dairy') || food.contains.includes('egg'),
      ),
    ).toBe(false);
  });

  it('treats an allergy separately from a diet', () => {
    const pantry = allowedFoods('omnivore', ['dairy']);
    expect(pantry.some((food) => food.contains.includes('dairy'))).toBe(false);
    expect(pantry.some((food) => food.contains.includes('meat'))).toBe(true);
  });
});

describe('building a day', () => {
  it('lands within a tenth of the calorie target', () => {
    const day = plan()!;
    expect(Math.abs(day.kcalGap)).toBeLessThan(KCAL * 0.1);
  });

  it('lands close on every day and every diet, not just the one in this test', () => {
    // Testing a single date hid a case that overshot by 483 kcal - the day
    // rotation picks different anchors, and some combinations are far denser
    // than others. Sweeping the rotation is what actually checks the
    // reconciliation rather than one lucky seed.
    const patterns = ['omnivore', 'halal', 'vegetarian', 'vegan'] as const;
    const targets = [1500, 1900, 2400, 3000];

    for (const dietPattern of patterns) {
      for (const kcal of targets) {
        const macros = macroTargets({
          kcal,
          weightKg: 65,
          heightCm: 165,
          weightGoal: 'maintain',
        });
        for (let day = 1; day <= 28; day++) {
          const date = `2026-06-${String(day).padStart(2, '0')}`;
          const built = buildDayPlan({
            macros,
            kcal,
            dietPattern,
            avoid: [],
            dateKey: date,
          })!;
          expect(
            Math.abs(built.kcalGap),
            `${dietPattern} ${kcal} kcal on ${date}`,
          ).toBeLessThan(kcal * 0.12);
        }
      }
    }
  });

  it('never asks for a portion nobody would serve', () => {
    for (let day = 1; day <= 28; day++) {
      const built = plan({ dateKey: `2026-07-${String(day).padStart(2, '0')}` })!;
      for (const meal of built.meals) {
        for (const item of meal.items) {
          expect(item.servings, `${item.food.id} on day ${day}`).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  it('keeps the snack small', () => {
    for (let day = 1; day <= 14; day++) {
      const built = plan({ dateKey: `2026-08-${String(day).padStart(2, '0')}` })!;
      const snack = built.meals.find((meal) => meal.slot === 'snack')!;
      expect(snack.totals.kcal, `day ${day}`).toBeLessThan(600);
    }
  });

  it('gets close to the protein target', () => {
    const day = plan()!;
    expect(day.totals.proteinG).toBeGreaterThan(MACROS.proteinG * 0.8);
  });

  it('is the same plan twice for the same day', () => {
    const first = plan()!;
    const second = plan()!;
    expect(first.meals.map((meal) => meal.items.map((item) => item.food.id))).toEqual(
      second.meals.map((meal) => meal.items.map((item) => item.food.id)),
    );
  });

  it('varies from one day to the next', () => {
    const monday = plan({ dateKey: '2026-05-01' })!;
    const tuesday = plan({ dateKey: '2026-05-02' })!;
    expect(JSON.stringify(monday.meals)).not.toBe(JSON.stringify(tuesday.meals));
  });

  it('respects her exclusions in every meal', () => {
    const day = plan({ dietPattern: 'vegetarian', avoid: ['dairy'] })!;
    for (const meal of day.meals) {
      for (const item of meal.items) {
        expect(item.food.contains).not.toContain('meat');
        expect(item.food.contains).not.toContain('dairy');
      }
    }
  });

  it('never serves a portion she cannot measure out', () => {
    const day = plan()!;
    for (const meal of day.meals) {
      for (const item of meal.items) {
        expect(item.servings % 0.5).toBe(0);
        expect(item.servings).toBeGreaterThan(0);
      }
    }
  });

  it('gives up rather than serving food she excluded', () => {
    const impossible = plan({
      dietPattern: 'vegan',
      avoid: ['soy', 'nuts', 'gluten'],
      macros: MACROS,
    });
    // Whatever it returns, it must not contain something on the avoid list.
    if (impossible) {
      for (const meal of impossible.meals) {
        for (const item of meal.items) {
          expect(item.food.contains).not.toContain('soy');
          expect(item.food.contains).not.toContain('nuts');
        }
      }
    }
  });
});

describe('closing a protein gap', () => {
  it('offers the most protein-dense options she can eat', () => {
    const options = closeProteinGap({
      proteinShortG: 30,
      kcalRemaining: 600,
      dietPattern: 'omnivore',
      avoid: [],
    });
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.adds.kcal).toBeLessThanOrEqual(600 * 1.15);
    }
  });

  it('offers nothing when she is already there', () => {
    expect(
      closeProteinGap({
        proteinShortG: 0,
        kcalRemaining: 600,
        dietPattern: 'omnivore',
        avoid: [],
      }),
    ).toEqual([]);
  });

  it('never suggests something she cannot eat', () => {
    const options = closeProteinGap({
      proteinShortG: 40,
      kcalRemaining: 800,
      dietPattern: 'vegan',
      avoid: [],
    });
    for (const option of options) {
      expect(option.food.contains).not.toContain('dairy');
      expect(option.food.contains).not.toContain('meat');
    }
  });
});

describe('building for her kitchen', () => {
  it('leads with her own region on every one of them', () => {
    // The point of asking her country. A plan for a Nigerian user that opens
    // with roti is a plan that reads as a translation of somebody else's app.
    for (const cuisine of CUISINES) {
      const built = plan({ cuisine })!;
      const foods = built.meals.flatMap((meal) => meal.items.map((item) => item.food));
      const regional = foods.filter((food) => isFrom(food, cuisine));
      expect(regional.length, `${cuisine} used none of its own food`).toBeGreaterThan(0);
      // Nothing from somebody else's kitchen: every item is hers or a staple
      // everybody eats. The fallback only fires when a slot cannot be filled.
      for (const food of foods) {
        expect(
          isFrom(food, cuisine) || isUniversal(food),
          `${cuisine} was served ${food.id}`,
        ).toBe(true);
      }
    }
  });

  it('still lands on the target in every kitchen, on every day', () => {
    // The same sweep that caught the 483 kcal overshoot, now across regions
    // as well: a kitchen with denser anchors is exactly where reconciliation
    // stops working, and East Asian and Latin American both are.
    for (const cuisine of CUISINES) {
      for (const kcal of [1500, 2100, 2900]) {
        const macros = macroTargets({
          kcal,
          weightKg: 65,
          heightCm: 165,
          weightGoal: 'maintain',
        });
        for (let day = 1; day <= 28; day++) {
          const date = `2026-09-${String(day).padStart(2, '0')}`;
          const built = buildDayPlan({
            macros,
            kcal,
            dietPattern: 'omnivore',
            avoid: [],
            dateKey: date,
            cuisine,
          })!;
          expect(
            Math.abs(built.kcalGap),
            `${cuisine} ${kcal} kcal on ${date}`,
          ).toBeLessThan(kcal * 0.12);
        }
      }
    }
  });

  it('falls back rather than leaving a meal empty', () => {
    // East Asian has no food tagged as a fat and no fruit of its own. A slot
    // that resolves to nothing is worse than one filled from the wider table.
    const built = plan({ cuisine: 'east-asian', dietPattern: 'vegan', avoid: ['soy'] });
    expect(built).not.toBeNull();
    for (const meal of built!.meals) {
      expect(meal.items.length, meal.slot).toBeGreaterThan(0);
    }
  });

  it('sorts her region first without hiding anything', () => {
    const pantry = allowedFoods('omnivore', []);
    const sorted = sortForCuisine(pantry, 'african');
    expect(sorted.length).toBe(pantry.length);
    expect(isFrom(sorted[0]!, 'african')).toBe(true);
    expect(sorted.some((food) => food.id === 'roti')).toBe(true);
  });
});

describe('planning the rest of the day', () => {
  const eatenSoFar = {
    kcal: 900,
    proteinG: 45,
    carbG: 100,
    fatG: 30,
    fibreG: 10,
    ironMg: 5,
  };

  it('plans against what is left, not against the whole day', () => {
    const rest = buildDayPlan({
      macros: MACROS,
      kcal: KCAL,
      dietPattern: 'omnivore',
      avoid: [],
      dateKey: '2026-05-01',
      slots: ['dinner', 'snack'],
      eaten: eatenSoFar,
    })!;

    expect(rest.targetKcal).toBe(KCAL - eatenSoFar.kcal);
    expect(rest.partial).toBe(true);
    expect(rest.meals.map((meal) => meal.slot)).toEqual(['dinner', 'snack']);
    // The whole remainder, not forty-five per cent of a day. Before the shares
    // were renormalised over the slots being planned, this handed her 45% of
    // her target and called it the rest of the day.
    expect(Math.abs(rest.kcalGap)).toBeLessThan(rest.targetKcal * 0.15);
  });

  it('does not solve for a negative target once she is past it', () => {
    const over = buildDayPlan({
      macros: MACROS,
      kcal: KCAL,
      dietPattern: 'omnivore',
      avoid: [],
      dateKey: '2026-05-01',
      slots: ['snack'],
      eaten: { ...eatenSoFar, kcal: KCAL + 400, proteinG: MACROS.proteinG + 20 },
    })!;
    expect(over.targetKcal).toBe(0);
    for (const meal of over.meals) {
      for (const item of meal.items) {
        expect(item.servings).toBeGreaterThan(0);
      }
    }
  });

  it('says what is left to eat by the hour', () => {
    expect(slotsRemaining(7)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    expect(slotsRemaining(12)).toEqual(['lunch', 'dinner', 'snack']);
    expect(slotsRemaining(18)).toEqual(['dinner', 'snack']);
    expect(slotsRemaining(22)).toEqual(['snack']);
  });
});

describe('composite dishes', () => {
  it('can put one on the plate at all', () => {
    // Biryani, ramen, feijoada and arroz con pollo are group 'mixed', and the
    // planner used to skip that group entirely - a third of the table was
    // unreachable by anything except the search box.
    const seen = new Set<string>();
    for (const cuisine of CUISINES) {
      for (let day = 1; day <= 28; day++) {
        const built = plan({
          cuisine,
          dateKey: `2026-10-${String(day).padStart(2, '0')}`,
        })!;
        for (const meal of built.meals) {
          for (const item of meal.items) {
            if (item.food.group === 'mixed') seen.add(item.food.id);
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it('does not serve rice beside a dish that already contains it', () => {
    for (const cuisine of CUISINES) {
      for (let day = 1; day <= 28; day++) {
        const built = plan({
          cuisine,
          dateKey: `2026-11-${String(day).padStart(2, '0')}`,
        })!;
        for (const meal of built.meals) {
          const anchor = meal.items[0];
          if (!anchor || anchor.food.group !== 'mixed') continue;
          const carbSide = meal.items.find((item) => item.food.group === 'carb');
          if (!carbSide) continue;
          // A carbohydrate side is only allowed to be there when the anchor
          // did not already cover the slot on its own.
          const fromAnchor = anchor.food.carbG * anchor.servings;
          expect(fromAnchor, `${meal.slot} on day ${day}`).toBeLessThan(
            MACROS.carbG * 0.45,
          );
        }
      }
    }
  });
});

describe('searching the table', () => {
  const pantry = allowedFoods('omnivore', []);
  const idsFor = (query: string) => searchFoods(pantry, query, null).map((food) => food.id);

  it('finds a food by what she would actually type', () => {
    expect(idsFor('lentils')).toContain('daal');
    expect(idsFor('yogurt')).toContain('dahi');
    expect(idsFor('chapati')).toContain('roti');
    expect(idsFor('protein powder')).toContain('whey-scoop');
    expect(idsFor('noodles').length).toBeGreaterThan(0);
  });

  it('puts a name match above an alias match', () => {
    const results = searchFoods(pantry, 'chicken', null);
    expect(results[0]!.name.toLowerCase()).toContain('chicken');
  });

  it('breaks a tie with her own kitchen', () => {
    expect(isFrom(searchFoods(pantry, 'curry', 'south-asian')[0]!, 'south-asian')).toBe(
      true,
    );
    expect(
      isFrom(searchFoods(pantry, 'curry', 'southeast-asian')[0]!, 'southeast-asian'),
    ).toBe(true);
  });

  it('never loses a food that is in the table', () => {
    expect(searchFoods(pantry, '', 'african').length).toBe(pantry.length);
  });
});

describe('the country map', () => {
  it('has no duplicate codes', () => {
    const codes = COUNTRIES.map((country) => country.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every region at least one country to arrive from', () => {
    for (const cuisine of CUISINES) {
      expect(
        COUNTRIES.some((country) => country.cuisine === cuisine),
        cuisine,
      ).toBe(true);
    }
  });

  it('gives every region enough of its own food to build a day from', () => {
    // The map is only worth having if picking a country changes what she is
    // shown. A region with two dishes in it falls straight back to the
    // universal staples and makes the question pointless.
    for (const cuisine of CUISINES) {
      const own = FOODS.filter((food) => isFrom(food, cuisine));
      expect(own.length, cuisine).toBeGreaterThanOrEqual(8);
      expect(
        own.some((food) => food.group === 'carb'),
        `${cuisine} has no carbohydrate of its own`,
      ).toBe(true);
      expect(
        own.some(
          (food) =>
            food.proteinG >= 10 &&
            (food.group === 'protein' ||
              food.group === 'dairy' ||
              food.group === 'mixed'),
        ),
        `${cuisine} has nothing to anchor a meal on`,
      ).toBe(true);
    }
  });

  it('resolves a country to a region, and an unknown one to nothing', () => {
    expect(cuisineForCountry('PK')).toBe('south-asian');
    expect(cuisineForCountry('ng')).toBe('african');
    expect(cuisineForCountry('ZZ')).toBeNull();
    expect(cuisineForCountry(null)).toBeNull();
  });

  it('offers a prefix match before a substring one', () => {
    expect(searchCountries('ind')[0]!.code).toBe('IN');
    expect(searchCountries('pak')[0]!.code).toBe('PK');
    expect(searchCountries('')).toEqual([]);
  });
});

describe('what belongs on a plate', () => {
  it('never opens a meal with a scoop of powder', () => {
    // Whey wins any protein-per-calorie sort, which is why it used to anchor
    // lunch. It stays in the search and in the protein-gap list, where it is
    // genuinely the right answer, and it is barred from being a meal.
    for (const cuisine of CUISINES) {
      for (let day = 1; day <= 28; day++) {
        const built = plan({
          cuisine,
          dateKey: `2026-12-${String(day).padStart(2, '0')}`,
        })!;
        for (const meal of built.meals) {
          if (meal.slot === 'snack') continue;
          for (const item of meal.items) {
            expect(item.food.supplement ?? false, `${meal.slot}: ${item.food.id}`).toBe(
              false,
            );
          }
        }
      }
    }
  });

  it('only snacks on things a person snacks on', () => {
    // The rule used to be "any protein under 220 kcal", which offered her
    // fifty grams of cooked chicken breast.
    for (const cuisine of CUISINES) {
      for (let day = 1; day <= 14; day++) {
        const built = plan({
          cuisine,
          dateKey: `2027-01-${String(day).padStart(2, '0')}`,
        })!;
        const snack = built.meals.find((meal) => meal.slot === 'snack')!;
        for (const item of snack.items) {
          expect(
            item.food.snack === true || item.food.group === 'fruit',
            `snacked on ${item.food.id}`,
          ).toBe(true);
        }
      }
    }
  });

  it('closes a protein gap from her own kitchen', () => {
    // Sorting the whole table by protein per kilocalorie answers "tuna, whey,
    // tilapia" for every woman on earth.
    const options = closeProteinGap({
      proteinShortG: 40,
      kcalRemaining: 800,
      dietPattern: 'omnivore',
      avoid: [],
      cuisine: 'south-asian',
    });
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(
        isFrom(option.food, 'south-asian') || isUniversal(option.food),
        `offered ${option.food.id}`,
      ).toBe(true);
    }
  });

  it('still answers when her exclusions empty her region', () => {
    const options = closeProteinGap({
      proteinShortG: 40,
      kcalRemaining: 800,
      dietPattern: 'vegan',
      avoid: ['soy', 'nuts', 'gluten'],
      cuisine: 'east-asian',
    });
    expect(options.length).toBeGreaterThan(0);
  });

  it('always names one thing she actually cooks', () => {
    // Protein per kilocalorie ranks the same way everywhere, so the honest
    // top three are tuna, whey and chicken breast for every woman on earth.
    // One row is reserved for her region so the card names her dinner too.
    for (const cuisine of CUISINES) {
      const options = closeProteinGap({
        proteinShortG: 40,
        kcalRemaining: 800,
        dietPattern: 'omnivore',
        avoid: [],
        cuisine,
      });
      expect(options.length, cuisine).toBeLessThanOrEqual(3);
      expect(
        options.some((option) => isFrom(option.food, cuisine)),
        `${cuisine} was offered nothing of its own`,
      ).toBe(true);
    }
  });

  it('puts protein in the snack, not just fruit', () => {
    // The one slot whose job is topping the day up came back as two handfuls
    // of dates: one gram of protein and a hundred and thirty calories.
    for (const cuisine of CUISINES) {
      for (let day = 1; day <= 14; day++) {
        const built = plan({
          cuisine,
          dateKey: `2027-02-${String(day).padStart(2, '0')}`,
        })!;
        const snack = built.meals.find((meal) => meal.slot === 'snack')!;
        // The anchor, not the reconciled total: the calorie pass is allowed
        // to shrink a portion, and asserting on the total would be testing
        // reconciliation rather than what the slot reached for.
        expect(
          snack.items[0]!.food.proteinG,
          `${cuisine} day ${day}: ${snack.items.map((i) => i.food.id).join()}`,
        ).toBeGreaterThanOrEqual(5);
      }
    }
  });
});
