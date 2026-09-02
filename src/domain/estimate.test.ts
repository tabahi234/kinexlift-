import { describe, expect, it } from 'vitest';
import {
  boundCustomFood,
  ESTIMATE_CLOSE,
  ESTIMATE_OPEN,
  kcalFromMacros,
  parseEstimate,
} from './estimate';

const block = (body: Record<string, unknown>): string =>
  `${ESTIMATE_OPEN}\n${JSON.stringify(body)}\n${ESTIMATE_CLOSE}`;

const wrap = {
  name: 'Chicken shawarma wrap',
  serving: '1 wrap',
  kcal: 520,
  protein: 30,
  carbs: 48,
  fat: 22,
  fibre: 3,
  iron: 2.1,
};

describe('reading an estimate', () => {
  it('takes a well-formed one at its word', () => {
    const estimate = parseEstimate(block(wrap))!;
    expect(estimate.name).toBe('Chicken shawarma wrap');
    expect(estimate.serving).toBe('1 wrap');
    expect(estimate.kcal).toBe(520);
    expect(estimate.proteinG).toBe(30);
    expect(estimate.kcalSource).toBe('model');
    expect(estimate.estimated).toBe(true);
  });

  it('accepts the object without the markers', () => {
    // A model that drops the block but returns the object has done the job.
    // Refusing it only makes the feature look broken.
    expect(parseEstimate(JSON.stringify(wrap))?.kcal).toBe(520);
  });

  it('survives a fence and a sentence of prose around it', () => {
    const messy = `Sure! Here you go:\n\`\`\`json\n${block(wrap)}\n\`\`\`\nHope that helps.`;
    expect(parseEstimate(messy)?.name).toBe('Chicken shawarma wrap');
  });

  it('gives up rather than inventing a row', () => {
    expect(parseEstimate('I am not able to estimate that.')).toBeNull();
    expect(parseEstimate('')).toBeNull();
    expect(parseEstimate(block({ ...wrap, name: '   ' }))).toBeNull();
    // No energy and no macros is not an estimate, it is an empty row.
    expect(
      parseEstimate(block({ name: 'Mystery', kcal: 0, protein: 0, carbs: 0, fat: 0 })),
    ).toBeNull();
  });

  it('falls back to what she typed when it forgets to name it', () => {
    const estimate = parseEstimate(
      block({ ...wrap, name: undefined }),
      'two wraps from the shop',
    )!;
    expect(estimate.name).toBe('two wraps from the shop');
  });
});

describe('bounding what comes back', () => {
  it('cannot put an absurd number in the log', () => {
    // A misread "two wraps" must not be able to become twelve thousand
    // kilocalories, whatever the model does.
    const silly = parseEstimate(
      block({ ...wrap, kcal: 99999, protein: 5000, carbs: 9999, fat: 4000, iron: 900 }),
    )!;
    expect(silly.kcal).toBeLessThanOrEqual(2000);
    expect(silly.proteinG).toBeLessThanOrEqual(200);
    expect(silly.carbG).toBeLessThanOrEqual(300);
    expect(silly.fatG).toBeLessThanOrEqual(200);
    expect(silly.ironMg).toBeLessThanOrEqual(30);
  });

  it('refuses negatives instead of subtracting from her day', () => {
    const negative = parseEstimate(
      block({ ...wrap, protein: -30, carbs: -10, fat: -5, iron: -2 }),
    )!;
    expect(negative.proteinG).toBe(0);
    expect(negative.carbG).toBe(0);
    expect(negative.fatG).toBe(0);
    expect(negative.ironMg).toBe(0);
  });

  it('ignores text where a number belongs', () => {
    const wordy = parseEstimate(
      block({ ...wrap, protein: 'about 30 g', fat: 'a lot' }),
    )!;
    expect(wordy.proteinG).toBe(0);
    expect(wordy.fatG).toBe(0);
  });

  it('never lets a reply become a multi-line row', () => {
    const estimate = parseEstimate(
      block({ ...wrap, name: 'Wrap\n\nwith\tgarlic   sauce' }),
    )!;
    expect(estimate.name).toBe('Wrap with garlic sauce');
  });

  it('caps a name that would break the layout', () => {
    const estimate = parseEstimate(block({ ...wrap, name: 'x'.repeat(400) }))!;
    expect(estimate.name.length).toBeLessThanOrEqual(60);
  });
});

describe('when the calories and the macros disagree', () => {
  it('lets the arithmetic win', () => {
    // Two rings on Fuel read calories and protein separately. A row whose
    // macros say 250 and whose header says 600 makes them tell different
    // stories about one meal.
    const estimate = parseEstimate(
      block({ ...wrap, kcal: 600, protein: 8, carbs: 10, fat: 3, fibre: 0 }),
    )!;
    expect(estimate.kcalSource).toBe('macros');
    expect(estimate.kcal).toBe(kcalFromMacros({ proteinG: 8, carbG: 10, fatG: 3, fibreG: 0 }));
  });

  it('leaves an ordinary rounding difference alone', () => {
    const estimate = parseEstimate(block(wrap))!;
    // 30*4 + 45*4 + 3*2 + 22*9 = 504 against a stated 520. Both are right to
    // the precision anybody can cook to.
    expect(estimate.kcalSource).toBe('model');
    expect(estimate.kcal).toBe(520);
  });

  it('uses the macros when it gave no calorie figure at all', () => {
    const estimate = parseEstimate(
      block({ name: 'Daal', serving: '1 cup', protein: 12, carbs: 27, fat: 2.5, fibre: 8 }),
    )!;
    expect(estimate.kcal).toBeGreaterThan(0);
    expect(estimate.kcalSource).toBe('macros');
  });

  it('keeps the calories when it gave no macros at all', () => {
    const estimate = parseEstimate(block({ name: 'Slice of cake', kcal: 350 }))!;
    expect(estimate.kcal).toBe(350);
    expect(estimate.kcalSource).toBe('model');
  });

  it('counts fibre at two kilocalories a gram, not four', () => {
    // The same lesson the food table's own check learned: scoring fibre at 4
    // makes a correct high-fibre row look 29% wrong.
    expect(kcalFromMacros({ proteinG: 0, carbG: 10, fatG: 0, fibreG: 10 })).toBe(20);
    expect(kcalFromMacros({ proteinG: 0, carbG: 10, fatG: 0, fibreG: 0 })).toBe(40);
  });

  it('cannot count more fibre than there is carbohydrate', () => {
    expect(kcalFromMacros({ proteinG: 0, carbG: 5, fatG: 0, fibreG: 50 })).toBe(10);
  });
});

describe('numbers she typed herself', () => {
  it('bounds them the same way', () => {
    // A slipped decimal point is a slipped decimal point whoever typed it,
    // and two sets of rules is how the form and the estimate end up
    // disagreeing about what a valid row is.
    const food = boundCustomFood({ name: 'Mum’s biryani', kcal: 50000, proteinG: 900 })!;
    expect(food.kcal).toBe(2000);
    expect(food.proteinG).toBe(200);
  });

  it('needs a name and some energy', () => {
    expect(boundCustomFood({ name: '', kcal: 300, proteinG: 10 })).toBeNull();
    expect(boundCustomFood({ name: 'Nothing', kcal: 0, proteinG: 10 })).toBeNull();
  });

  it('fills in a serving she did not describe', () => {
    expect(boundCustomFood({ name: 'Cake', kcal: 300, proteinG: 4 })!.serving).toBe(
      '1 portion',
    );
  });

  it('is not marked as an estimate unless it was one', () => {
    expect(boundCustomFood({ name: 'Cake', kcal: 300, proteinG: 4 })!.estimated).toBe(
      undefined,
    );
    expect(
      boundCustomFood({ name: 'Cake', kcal: 300, proteinG: 4, estimated: true })!.estimated,
    ).toBe(true);
  });
});
