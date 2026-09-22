/**
 * What to do next.
 *
 * The app knows a lot and, until this file existed, said almost none of it out
 * loud: five tabs, each correct in isolation, and no answer anywhere to the
 * only question she actually opens the app with - *what now?* Screens that are
 * individually well designed still add up to a maze if none of them says where
 * the way forward is.
 *
 * So the way forward is computed, in one place, from the same state the
 * screens already read. Pure on purpose: it takes a snapshot and returns an
 * ordered checklist, which means the order can be argued about in a test
 * rather than in four components.
 *
 * The order is the opinion. Check in before training, because it is what makes
 * the session fit the day. Train before eating, because the session is the
 * point. Food before the weekly things, because it is the one most likely to
 * slide.
 */

/** The five tabs. `ui/nav.tsx` re-exports this as `View`. */
export type Screen = 'today' | 'fuel' | 'coach' | 'progress' | 'you';

export type StepId =
  | 'fuel-setup'
  | 'checkin'
  | 'session'
  | 'food'
  | 'protein'
  | 'weigh-in'
  | 'period';

export interface NextStep {
  id: StepId;
  /** Imperative and short - it is a button as often as a heading. */
  title: string;
  hint: string;
  cta: string;
  screen: Screen;
  /** What the destination should open when she arrives. See ui/nav.tsx. */
  focus?: string;
  done: boolean;
}

export interface NextUpInput {
  /** The session the rotation has queued, e.g. 'Lower body A'. */
  sessionName: string;
  /** A conditioning day is walked, not lifted, and the copy should say so. */
  conditioning: boolean;
  checkedIn: boolean;
  sessionOpen: boolean;
  /** Sets, or conditioning entries, logged into the open session. */
  loggedInSession: number;
  trainedToday: boolean;
  /**
   * Today is not one of her training days. The session step still exists -
   * the list is the whole day - but it reads as a rest day and counts as
   * done, so the dial does not sit at four of five forever on a Sunday.
   * `restDayNext` is when the next one is: "tomorrow", "on Thursday".
   */
  restDay?: boolean;
  restDayNext?: string;
  /** False until height, weight and age are known. */
  nutritionReady: boolean;
  mealsLoggedToday: number;
  proteinG: number;
  proteinTargetG: number;
  /** Null when she has never weighed in. */
  daysSinceWeighIn: number | null;
  tracksCycle: boolean;
  /** Null when she tracks her cycle but has logged no period yet. */
  daysSincePeriodLog: number | null;
}

/** Weigh-ins are a weekly rhythm, not a daily one. */
const WEIGH_IN_DAYS = 7;

/**
 * Long enough that a missing entry is more likely forgotten than early. The
 * median cycle is 28 days and the app never assumes hers is; this is a nudge
 * to log, not a prediction, so it stays quiet until well past due.
 */
const PERIOD_PROMPT_DAYS = 32;

/** Below this share of the target, the day still has protein work to do. */
const PROTEIN_ENOUGH = 0.8;

export function nextSteps(input: NextUpInput): NextStep[] {
  const steps: NextStep[] = [];

  // Everything on Fuel is downstream of three numbers. Until they exist the
  // screen can only ask for them, so nothing else about food is worth saying.
  if (!input.nutritionReady) {
    steps.push({
      id: 'fuel-setup',
      title: 'Finish setting up Fuel',
      hint: 'Your height, weight and age. A calorie target cannot be worked out from less.',
      cta: 'Add them',
      screen: 'fuel',
      done: false,
    });
  }

  // The check-in tunes the session. Once the session is done, or today is
  // a rest day, asking for it is asking her to answer three questions for
  // nothing - and it was sitting at the top of the list as "Next" right
  // under the card that congratulated her on finishing.
  const checkinRelevant = input.checkedIn || (!input.trainedToday && !input.restDay);
  if (checkinRelevant) {
    steps.push({
      id: 'checkin',
      title: input.checkedIn ? 'Checked in' : 'Check in',
      hint: input.checkedIn
        ? 'Today’s session is set to how you said you feel.'
        : 'Three taps, and it decides whether today is a full session or an easier one.',
      cta: 'Check in',
      screen: 'today',
      focus: 'checkin',
      done: input.checkedIn,
    });
  }

  if (input.trainedToday) {
    steps.push({
      id: 'session',
      title: 'Trained today',
      hint: `${input.sessionName} is logged.`,
      cta: 'Open it',
      screen: 'today',
      done: true,
    });
  } else if (input.restDay && !input.sessionOpen) {
    steps.push({
      id: 'session',
      title: 'Rest day',
      hint: `${input.sessionName} is next, ${input.restDayNext ?? 'on your next training day'}.`,
      cta: 'See it',
      screen: 'today',
      done: true,
    });
  } else if (input.sessionOpen) {
    steps.push({
      id: 'session',
      title: `Finish ${input.sessionName}`,
      hint:
        input.loggedInSession > 0
          ? `${input.loggedInSession} logged so far. Nothing counts until you finish the session.`
          : 'The session is open and nothing is logged in it yet.',
      cta: 'Carry on',
      screen: 'today',
      done: false,
    });
  } else {
    steps.push({
      id: 'session',
      title: `Start ${input.sessionName}`,
      hint: input.conditioning
        ? 'A conditioning day: minutes and effort, not sets.'
        : 'The weights are already worked out from what you last lifted.',
      cta: 'Start',
      screen: 'today',
      done: false,
    });
  }

  if (input.nutritionReady) {
    steps.push({
      id: 'food',
      title: input.mealsLoggedToday > 0 ? 'Food logged' : 'Log what you have eaten',
      hint:
        input.mealsLoggedToday > 0
          ? `${input.mealsLoggedToday} ${input.mealsLoggedToday === 1 ? 'item' : 'items'} today.`
          : 'Or ask the coach for a meal and add it in one tap.',
      cta: input.mealsLoggedToday > 0 ? 'Add more' : 'Log food',
      screen: 'fuel',
      focus: 'add-food',
      done: input.mealsLoggedToday > 0,
    });

    // Only worth raising once she has logged something: telling her protein is
    // at zero before breakfast is noise, not coaching.
    if (input.mealsLoggedToday > 0 && input.proteinTargetG > 0) {
      const short = Math.max(0, Math.round(input.proteinTargetG - input.proteinG));
      const enough = input.proteinG >= input.proteinTargetG * PROTEIN_ENOUGH;
      steps.push({
        id: 'protein',
        title: enough ? 'Protein is on track' : `${short} g of protein to go`,
        hint: enough
          ? `${Math.round(input.proteinG)} g of ${Math.round(input.proteinTargetG)} g.`
          : 'The one macro worth chasing. Fuel lists the cheapest ways to close it.',
        cta: 'Close it',
        screen: 'fuel',
        focus: 'protein',
        done: enough,
      });
    }
  }

  const weighed =
    input.daysSinceWeighIn !== null && input.daysSinceWeighIn < WEIGH_IN_DAYS;
  steps.push({
    id: 'weigh-in',
    title: weighed ? 'Weighed in this week' : 'Weigh in',
    hint: weighed
      ? `Last one ${input.daysSinceWeighIn === 0 ? 'today' : `${input.daysSinceWeighIn} days ago`}.`
      : 'Once a week is enough. The trend is what matters, never one morning.',
    cta: 'Log it',
    screen: 'progress',
    focus: 'weight',
    done: weighed,
  });

  // Cycle logging lives inside Progress, which is exactly the sort of thing
  // that gets forgotten for two months. Raised only when it is well past due.
  if (
    input.tracksCycle &&
    (input.daysSincePeriodLog === null || input.daysSincePeriodLog >= PERIOD_PROMPT_DAYS)
  ) {
    steps.push({
      id: 'period',
      title: 'Log your period',
      hint:
        input.daysSincePeriodLog === null
          ? 'Nothing logged yet. The cycle screen needs one start date before it can say anything.'
          : `Nothing logged for ${input.daysSincePeriodLog} days. Tap the day it started.`,
      cta: 'Open the calendar',
      screen: 'progress',
      focus: 'cycle',
      done: false,
    });
  }

  return steps;
}

export interface NextUpSummary {
  steps: NextStep[];
  /** The first thing left to do, or null when the day is clear. */
  next: NextStep | null;
  done: number;
  total: number;
}

export function summariseSteps(steps: NextStep[]): NextUpSummary {
  return {
    steps,
    next: steps.find((step) => !step.done) ?? null,
    done: steps.filter((step) => step.done).length,
    total: steps.length,
  };
}
