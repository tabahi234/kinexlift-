import { useLiveQuery } from 'dexie-react-hooks';
import {
  getNutritionContext,
  getProposalContext,
  type TodayProposalContext,
} from '../../db/derived';

/** What the day looks like before the card is added to it. */
export interface DayBudget {
  kcalTarget: number;
  proteinTargetG: number;
  kcalEaten: number;
  proteinEatenG: number;
}

export interface ProposalScreenContext {
  context: TodayProposalContext;
  /** Null until Fuel has the three numbers it needs to have a target at all. */
  budget: DayBudget | null;
}

/**
 * What a proposal has to be read against.
 *
 * Live, because both halves move while a card is on screen: she logs a snack
 * from the picker, or swaps a slot by hand, and a card offering to fill a gap
 * that has already closed is worse than no card.
 */
export function useProposalContext(): ProposalScreenContext | undefined {
  return useLiveQuery(async () => {
    const [context, nutrition] = await Promise.all([
      getProposalContext(),
      getNutritionContext(),
    ]);

    return {
      context,
      budget: nutrition.plan
        ? {
            kcalTarget: nutrition.plan.target.kcal,
            proteinTargetG: nutrition.plan.macros.proteinG,
            kcalEaten: nutrition.intakeToday?.kcal ?? 0,
            proteinEatenG: nutrition.intakeToday?.proteinG ?? 0,
          }
        : null,
    };
  }, []);
}
