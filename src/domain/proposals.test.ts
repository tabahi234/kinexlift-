import { describe, expect, it } from 'vitest';
import {
  clampServings,
  foodCatalogue,
  parseProposal,
  proposalKind,
  PROPOSAL_CLOSE,
  PROPOSAL_OPEN,
  readProposal,
  sessionCatalogue,
  slotForHour,
  splitProposal,
  totalsOfItems,
  withoutDashes,
  type LogProposal,
  type MealProposal,
  type ProposalContext,
  type SessionProposal,
} from './proposals';
import { allowedFoods, getFood } from './foods';
import { EXERCISES, getExercise } from './exercises';

const pantry = allowedFoods('halal', []);

const slots: ProposalContext['slots'] = [
  {
    slotKey: 'lower-a:0',
    exercise: getExercise('barbell-back-squat')!,
    alternatives: [getExercise('goblet-squat')!, getExercise('leg-press')!],
    weightKg: 40,
    sets: 3,
    repRange: [8, 12],
  },
  {
    slotKey: 'lower-a:1',
    exercise: getExercise('romanian-deadlift')!,
    alternatives: [getExercise('dumbbell-rdl')!],
    weightKg: 30,
    sets: 3,
    repRange: [8, 12],
  },
];

const context: ProposalContext = {
  pantry,
  slots,
  loggable: EXERCISES,
  defaultSlot: 'dinner',
};

const block = (payload: unknown) =>
  `Here is a dinner that lands on your protein. Want it lighter, or with rice instead?\n\n${PROPOSAL_OPEN}\n${JSON.stringify(payload)}\n${PROPOSAL_CLOSE}`;

const meal = (text: string): MealProposal => {
  const { proposal } = readProposal(text, context);
  if (proposal?.kind !== 'meal') throw new Error('expected a meal proposal');
  return proposal;
};

const session = (text: string): SessionProposal => {
  const { proposal } = readProposal(text, context);
  if (proposal?.kind !== 'session') throw new Error('expected a session proposal');
  return proposal;
};

describe('splitProposal', () => {
  it('leaves an ordinary answer alone', () => {
    const { prose, raw } = splitProposal('Your squat has not moved in three sessions.');
    expect(prose).toBe('Your squat has not moved in three sessions.');
    expect(raw).toBeNull();
  });

  it('keeps the block out of what she reads', () => {
    const { prose } = splitProposal(block({ type: 'meal', items: [{ food: 'daal' }] }));
    expect(prose).not.toContain('PROPOSAL');
    expect(prose).not.toContain('daal');
    expect(prose.endsWith('rice instead?')).toBe(true);
  });

  it('survives a model that wraps the block in a code fence', () => {
    const text = `Try this.\n\n\`\`\`\n${PROPOSAL_OPEN}\n{"type":"meal","items":[{"food":"daal"}]}\n${PROPOSAL_CLOSE}\n\`\`\``;
    const { prose, raw } = splitProposal(text);
    expect(raw).not.toBeNull();
    expect(prose).toBe('Try this.');
  });

  it('survives a missing closing marker', () => {
    const text = `Try this.\n${PROPOSAL_OPEN}\n{"type":"meal","items":[{"food":"daal"}]}`;
    expect(splitProposal(text).raw).not.toBeNull();
    expect(splitProposal(text).prose).toBe('Try this.');
  });

  it('gives up quietly on a block that is not JSON', () => {
    const text = `Try this.\n${PROPOSAL_OPEN}\nsome daal and rice\n${PROPOSAL_CLOSE}`;
    const { prose, raw } = splitProposal(text);
    expect(raw).toBeNull();
    expect(prose).toBe('Try this.');
  });
});

describe('meal proposals', () => {
  it('resolves ids, portions and slots', () => {
    const proposal = meal(
      block({
        type: 'meal',
        items: [
          { food: 'chicken-karahi', servings: 1, slot: 'dinner' },
          { food: 'roti', servings: 2, slot: 'dinner' },
        ],
      }),
    );
    expect(proposal.items.map((item) => item.food.id)).toEqual(['chicken-karahi', 'roti']);
    expect(proposal.items[1]!.servings).toBe(2);
    expect(proposal.items.every((item) => item.slot === 'dinner')).toBe(true);
  });

  it('computes the totals itself rather than believing the model', () => {
    const proposal = meal(
      block({ type: 'meal', items: [{ food: 'roti', servings: 2, kcal: 9000 }] }),
    );
    const totals = totalsOfItems(proposal.items);
    expect(totals.kcal).toBe(getFood('roti')!.kcal * 2);
  });

  it('drops a food she does not eat and says which', () => {
    const vegan: ProposalContext = { ...context, pantry: allowedFoods('vegan', []) };
    const { proposal } = readProposal(
      block({
        type: 'meal',
        items: [{ food: 'chicken-breast' }, { food: 'tofu-firm', servings: 1.5 }],
      }),
      vegan,
    );
    expect(proposal?.kind).toBe('meal');
    const parsed = proposal as MealProposal;
    expect(parsed.items.map((item) => item.food.id)).toEqual(['tofu-firm']);
    expect(parsed.dropped).toEqual(['chicken-breast']);
  });

  it('returns nothing at all when it invented every item', () => {
    const { proposal } = readProposal(
      block({ type: 'meal', items: [{ food: 'quinoa-bowl' }, { food: 'protein-cookie' }] }),
      context,
    );
    expect(proposal).toBeNull();
  });

  it('accepts a name when it forgets to use the id', () => {
    const proposal = meal(block({ type: 'meal', items: [{ food: 'Greek yogurt' }] }));
    expect(proposal.items[0]!.food.id).toBe('greek-yogurt');
  });

  it('falls back to the slot the app suggested', () => {
    const proposal = meal(block({ type: 'meal', items: [{ food: 'dahi' }] }));
    expect(proposal.items[0]!.slot).toBe('dinner');
  });

  it('clamps absurd portions and rounds to something servable', () => {
    const proposal = meal(
      block({
        type: 'meal',
        items: [
          { food: 'roti', servings: 40 },
          { food: 'daal', servings: 1.3 },
          { food: 'dahi', servings: -2 },
        ],
      }),
    );
    expect(proposal.items.map((item) => item.servings)).toEqual([6, 1.5, 1]);
  });

  it('merges the same food listed twice in one meal', () => {
    const proposal = meal(
      block({
        type: 'meal',
        items: [
          { food: 'roti', servings: 1, slot: 'lunch' },
          { food: 'roti', servings: 1, slot: 'lunch' },
        ],
      }),
    );
    expect(proposal.items).toHaveLength(1);
    expect(proposal.items[0]!.servings).toBe(2);
  });

  it('spreads a whole day across the slots it names', () => {
    const proposal = meal(
      block({
        type: 'meal',
        items: [
          { food: 'oats', servings: 1, slot: 'breakfast' },
          { food: 'chicken-biryani', servings: 1, slot: 'lunch' },
          { food: 'daal', servings: 1, slot: 'dinner' },
        ],
      }),
    );
    expect(proposal.items.map((item) => item.slot)).toEqual([
      'breakfast',
      'lunch',
      'dinner',
    ]);
  });
});

describe('session proposals', () => {
  it('accepts a swap to a listed alternative', () => {
    const proposal = session(
      block({ type: 'session', swaps: [{ slot: 'lower-a:0', exercise: 'goblet-squat' }] }),
    );
    expect(proposal.swaps).toHaveLength(1);
    expect(proposal.swaps[0]!.from.id).toBe('barbell-back-squat');
    expect(proposal.swaps[0]!.to.id).toBe('goblet-squat');
  });

  it('finds the slot from the exercise being replaced', () => {
    const proposal = session(
      block({
        type: 'session',
        swaps: [{ from: 'romanian-deadlift', to: 'dumbbell-rdl' }],
      }),
    );
    expect(proposal.swaps[0]!.slotKey).toBe('lower-a:1');
  });

  it('refuses an exercise that is not an alternative for that slot', () => {
    const { proposal } = readProposal(
      block({ type: 'session', swaps: [{ slot: 'lower-a:0', exercise: 'pull-up' }] }),
      context,
    );
    expect(proposal).toBeNull();
  });

  it('refuses a slot that is not in today’s session', () => {
    const { proposal } = readProposal(
      block({ type: 'session', swaps: [{ slot: 'upper-b:2', exercise: 'goblet-squat' }] }),
      context,
    );
    expect(proposal).toBeNull();
  });

  it('ignores a swap to the exercise already prescribed', () => {
    const { proposal } = readProposal(
      block({
        type: 'session',
        swaps: [{ slot: 'lower-a:0', exercise: 'barbell-back-squat' }],
      }),
      context,
    );
    expect(proposal).toBeNull();
  });

  it('keeps one swap per slot', () => {
    const proposal = session(
      block({
        type: 'session',
        swaps: [
          { slot: 'lower-a:0', exercise: 'goblet-squat' },
          { slot: 'lower-a:0', exercise: 'leg-press' },
        ],
      }),
    );
    expect(proposal.swaps).toHaveLength(1);
    expect(proposal.swaps[0]!.to.id).toBe('goblet-squat');
  });
});

describe('logging sets', () => {
  const log = (payload: unknown): LogProposal => {
    const { proposal } = readProposal(block(payload), context);
    if (proposal?.kind !== 'log') throw new Error('expected a log proposal');
    return proposal;
  };

  it('reads back what she said she did', () => {
    const proposal = log({
      type: 'log',
      sets: [{ exercise: 'barbell-back-squat', weight: 22.5, reps: 10, sets: 3, rir: 2 }],
    });
    expect(proposal.sets).toEqual([
      {
        exercise: getExercise('barbell-back-squat'),
        weightKg: 22.5,
        reps: 10,
        sets: 3,
        rir: 2,
      },
    ]);
  });

  it('fills a missing weight from what the app prescribed, not from thin air', () => {
    const proposal = log({
      type: 'log',
      sets: [{ exercise: 'barbell-back-squat', reps: 10, sets: 3 }],
    });
    expect(proposal.sets[0]!.weightKg).toBe(40);
  });

  it('refuses a weight no one has ever lifted', () => {
    const proposal = log({
      type: 'log',
      sets: [{ exercise: 'barbell-back-squat', weight: 3100, reps: 10, sets: 3 }],
    });
    expect(proposal.sets[0]!.weightKg).toBe(500);
  });

  it('bounds reps, set counts and reps in reserve', () => {
    const proposal = log({
      type: 'log',
      sets: [
        { exercise: 'barbell-back-squat', weight: 20, reps: 900, sets: 40, rir: 11 },
      ],
    });
    expect(proposal.sets[0]!.reps).toBe(100);
    expect(proposal.sets[0]!.sets).toBe(10);
    expect(proposal.sets[0]!.rir).toBe(4);
  });

  it('leaves reps in reserve unset when she did not say', () => {
    const proposal = log({
      type: 'log',
      sets: [{ exercise: 'barbell-back-squat', weight: 20, reps: 8, sets: 1 }],
    });
    expect(proposal.sets[0]!.rir).toBeNull();
  });

  it('forces bodyweight movements to no load', () => {
    const proposal = log({
      type: 'log',
      sets: [{ exercise: 'push-up', weight: 60, reps: 12, sets: 3 }],
    });
    expect(proposal.sets[0]!.weightKg).toBe(0);
  });

  it('allows a hold to run longer than a set of reps ever would', () => {
    const proposal = log({
      type: 'log',
      sets: [{ exercise: 'plank', reps: 45, sets: 3 }],
    });
    expect(proposal.sets[0]!.reps).toBe(45);
  });

  it('takes an exercise outside today’s session, since the log is hers', () => {
    const proposal = log({
      type: 'log',
      sets: [{ exercise: 'bicep-curl', weight: 7, reps: 12, sets: 3 }],
    });
    expect(proposal.sets[0]!.exercise.id).toBe('bicep-curl');
  });

  it('drops an exercise it invented and says which', () => {
    const { proposal } = readProposal(
      block({
        type: 'log',
        sets: [
          { exercise: 'jazzercise', reps: 10, sets: 3 },
          { exercise: 'plank', reps: 30, sets: 1 },
        ],
      }),
      context,
    );
    const parsed = proposal as LogProposal;
    expect(parsed.sets).toHaveLength(1);
    expect(parsed.dropped).toEqual(['jazzercise']);
  });

  it('returns nothing when it invented all of them', () => {
    const { proposal } = readProposal(
      block({ type: 'log', sets: [{ exercise: 'jazzercise', reps: 10 }] }),
      context,
    );
    expect(proposal).toBeNull();
  });
});

describe('proposalKind', () => {
  it('still knows what an accepted swap was, after it stops validating', () => {
    const raw = { type: 'session', swaps: [{ slot: 'lower-a:0', exercise: 'goblet-squat' }] };
    // The swap has been applied, so goblet squat is now the prescribed
    // exercise rather than an alternative, and the proposal no longer parses.
    const applied: ProposalContext = {
      ...context,
      slots: [{ ...slots[0]!, exercise: getExercise('goblet-squat')!, alternatives: [] }],
    };
    expect(parseProposal(raw, applied)).toBeNull();
    expect(proposalKind(raw)).toBe('session');
  });

  it('reads a meal block by its items when the type is missing', () => {
    expect(proposalKind({ items: [{ food: 'roti' }] })).toBe('meal');
    expect(proposalKind({ type: 'meal', items: [] })).toBe('meal');
    expect(proposalKind({ nonsense: true })).toBeNull();
    expect(proposalKind('not an object')).toBeNull();
  });
});

describe('the catalogues', () => {
  it('lists every food she is allowed, with its id', () => {
    const text = foodCatalogue(allowedFoods('vegetarian', ['nuts']));
    expect(text).toContain('daal |');
    expect(text).not.toContain('chicken-karahi |');
    expect(text).not.toContain('almonds |');
  });

  it('lists the slots with the ids that may fill them', () => {
    const text = sessionCatalogue(slots, 'Lower body A');
    expect(text).toContain('lower-a:0');
    expect(text).toContain('goblet-squat');
    expect(text).toContain('Lower body A');
  });

  it('says plainly when there is nothing to swap', () => {
    expect(sessionCatalogue([], 'Easy conditioning')).toContain('no exercise slots');
  });
});

describe('helpers', () => {
  it('rounds servings to halves within bounds', () => {
    expect(clampServings(0.1)).toBe(0.5);
    expect(clampServings(2.26)).toBe(2.5);
    expect(clampServings('3')).toBe(3);
    expect(clampServings(undefined)).toBe(1);
  });

  it('puts food in the meal the clock is nearest', () => {
    expect(slotForHour(8)).toBe('breakfast');
    expect(slotForHour(13)).toBe('lunch');
    expect(slotForHour(19)).toBe('dinner');
    expect(slotForHour(23)).toBe('snack');
  });
});

describe('taking the dashes out of a reply', () => {
  it('handles the spaced kind', () => {
    expect(withoutDashes('Eat more protein — it is the one that matters.')).toBe(
      'Eat more protein, it is the one that matters.',
    );
  });

  it('handles the closed-up kind', () => {
    // The one the coach actually produced: "24 g fibre—adds up to the total".
    expect(withoutDashes('24 g fibre—adds up to the calorie total.')).toBe(
      '24 g fibre, adds up to the calorie total.',
    );
  });

  it('handles an en dash too', () => {
    expect(withoutDashes('Sets of 8–12 reps')).toBe('Sets of 8, 12 reps');
  });

  it('does not leave doubled punctuation behind', () => {
    expect(withoutDashes('Rest, — then go again.')).toBe('Rest, then go again.');
    expect(withoutDashes('That is the point —.')).toBe('That is the point.');
  });

  it('never leaves a double space', () => {
    expect(withoutDashes('One  —  two')).toBe('One, two');
    expect(withoutDashes('One, two')).toBe('One, two');
  });

  it('leaves an ordinary hyphen alone', () => {
    // A hyphenated word is not a dash and rewriting it would be wrong.
    expect(withoutDashes('A well-planned check-in')).toBe('A well-planned check-in');
  });

  it('leaves text with no dashes exactly as it is', () => {
    const text = 'Your squat has not moved in three sessions. Hold the weight.';
    expect(withoutDashes(text)).toBe(text);
  });
});
