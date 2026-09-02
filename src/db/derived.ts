import { db } from './db';
import { getProfile } from './repo';
import {
  getBodyMetrics,
  getCheckins,
  getCheckinFor,
  getConditioningForSession,
  getConditioningLogs,
  getCycleEvents,
  getExerciseHistory,
  getIntakeFor,
  getIntakeHistory,
  getLastCompletedDayId,
  getLatestBodyMetric,
  getLiftSnapshots,
  getMealsFor,
  getOpenSession,
  getOverrideTally,
  getRecentCheckins,
  getSessionsSince,
  getSetsForSession,
  getTrainingKcalPerWeek,
  getTrainingSummary,
} from './queries';
import { dateKey, daysBetween } from '../lib/date';
import { cycleStatus, type CycleStatus } from '../domain/cycle';
import { detectPatterns, type PatternReport } from '../domain/patterns';
import { nutritionPlan, type NutritionPlan } from '../domain/nutrition';
import { weeklyLoad } from '../domain/conditioning';
import { renderBriefing, type BriefingInput } from '../domain/coach';
import {
  activityLevelOf,
  ageFrom,
  cuisineOf,
  dietPatternOf,
  foodAvoidOf,
  trainingStyleOf,
  weightGoalOf,
} from '../domain/profile';
import {
  adjustmentsEnabled,
  bandFor,
  readinessFromCheckin,
  readinessScore,
  shouldOfferToStopAdjusting,
  type Readiness,
} from '../domain/readiness';
import { isConditioningDay, nextDay, programFor } from '../domain/templates';
import { buildSession, exerciseIdsForDay, type PlannedSession } from '../domain/plan';
import { EXERCISES } from '../domain/exercises';
import type { SessionHistory } from '../domain/progression';
import { buildDayPlan, slotsRemaining, type DayPlan } from '../domain/meals';
import {
  allowedFoods,
  foodFor,
  isCustomId,
  sortForCuisine,
  type Food,
  type Nutrients,
} from '../domain/foods';
import type { Cuisine } from '../domain/cuisines';
import {
  foodCatalogue,
  sessionCatalogue,
  slotForHour,
  type ProposalContext,
} from '../domain/proposals';
import type { NextUpInput } from '../domain/nextUp';
import type {
  Checkin,
  ConditioningLog,
  CustomFood,
  CycleTracking,
  MealLog,
  Profile,
  Session,
  SetLog,
} from './schema';

/**
 * Derived state that more than one screen needs.
 *
 * The rule this file exists to enforce: the Fuel screen and the coach must
 * never compute a calorie target differently. If the screen says 2,100 and the
 * coach says 1,900, the app has told her two different things and she is right
 * to stop trusting both. So there is one function that works it out, and both
 * call it.
 */

const live = <T extends { deletedAt: number | null }>(rows: T[]): T[] =>
  rows.filter((row) => row.deletedAt === null);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/* ------------------------------ nutrition ------------------------------ */

/**
 * A food she keeps logging, ready to log again in one tap.
 *
 * Carries the custom payload where there is one, because a food she wrote
 * herself lives on the meal row rather than in a table - re-adding it has to
 * bring its macros along or the quick-add writes a name and no numbers.
 */
export interface UsualFood {
  food: Food;
  custom?: CustomFood;
}

export interface NutritionContext {
  profile: Profile | null;
  plan: NutritionPlan | null;
  /** What is stopping a plan being computed, in the order to ask for it. */
  missing: ('weight' | 'height' | 'age')[];
  intakeToday: Nutrients | null;
  /** A whole day built to her targets, ignoring what she has eaten so far. */
  dayPlan: DayPlan | null;
  /**
   * The meals still to come, built against what is actually left of her
   * targets. This is the one the screen leads with: a full day offered at six
   * in the evening is a plan for a day that is nearly over.
   */
  restOfDay: DayPlan | null;
  /** Whose kitchen she cooks in, or null when she has not said. */
  cuisine: Cuisine | null;
  /** What she logs most, most-used first. The quick-add row on Fuel. */
  usualFoods: UsualFood[];
  history: { date: string; totals: Nutrients }[];
  medianProteinG: number | null;
  daysFoodLogged: number;
}

async function trainedToday(): Promise<boolean> {
  const today = dateKey();
  const sessions = live(await db.sessions.toArray());
  return sessions.some((session) => dateKey(new Date(session.startedAt)) === today);
}

export async function getNutritionContext(): Promise<NutritionContext> {
  const profile = (await getProfile()) ?? null;
  const history = await getIntakeHistory(14);
  const intakeToday = await getIntakeFor();
  const cuisine = cuisineOf(profile ?? {});

  const proteinValues = history.map((point) => point.totals.proteinG);

  const base = {
    profile,
    history,
    intakeToday,
    cuisine,
    usualFoods: await getUsualFoods(
      dietPatternOf(profile ?? {}),
      foodAvoidOf(profile ?? {}),
    ),
    medianProteinG: median(proteinValues),
    daysFoodLogged: history.length,
  };

  const nothingPlanned = { plan: null, missing: [] as NutritionContext['missing'], dayPlan: null, restOfDay: null };

  if (!profile) {
    return { ...base, ...nothingPlanned, missing: ['weight', 'height', 'age'] };
  }

  const age = ageFrom(profile.birthYear);
  const missing: NutritionContext['missing'] = [];
  if (!profile.bodyWeightKg) missing.push('weight');
  if (!profile.heightCm) missing.push('height');
  if (age === null) missing.push('age');

  if (missing.length > 0 || !profile.bodyWeightKg || !profile.heightCm || age === null) {
    return { ...base, ...nothingPlanned, missing };
  }

  const plan = nutritionPlan({
    weightKg: profile.bodyWeightKg,
    heightCm: profile.heightCm,
    age,
    activityLevel: activityLevelOf(profile),
    trainingKcalPerWeek: await getTrainingKcalPerWeek(profile.bodyWeightKg),
    weightGoal: weightGoalOf(profile),
    trainingToday: await trainedToday(),
  });

  if (!plan) return { ...base, ...nothingPlanned };

  const forHer = {
    macros: plan.macros,
    kcal: plan.target.kcal,
    dietPattern: dietPatternOf(profile),
    avoid: foodAvoidOf(profile),
    dateKey: dateKey(),
    cuisine,
  };

  // What is left of today, against what is left of the targets. Withheld once
  // there is too little room to put a meal in: offering her a plan for the
  // last ninety calories of the day is arithmetic, not help.
  const remainingKcal = plan.target.kcal - (intakeToday?.kcal ?? 0);
  const restOfDay =
    intakeToday && intakeToday.kcal > 0 && remainingKcal >= MIN_PLANNABLE_KCAL
      ? buildDayPlan({
          ...forHer,
          slots: slotsRemaining(new Date().getHours()),
          eaten: intakeToday,
        })
      : null;

  return { ...base, plan, missing: [], dayPlan: buildDayPlan(forHer), restOfDay };
}

/** Below this there is nothing left to plan, only something to eat. */
const MIN_PLANNABLE_KCAL = 250;

/**
 * What she actually eats, by how often she logs it.
 *
 * A food log lives or dies on the second week. By then she is logging the same
 * eight things, and making her search for each of them every morning is the
 * friction that ends it. Ties break towards the more recent, so a food she has
 * moved on from sinks on its own.
 */
async function getUsualFoods(
  pattern: Parameters<typeof allowedFoods>[0],
  avoid: string[],
  limit = 6,
): Promise<UsualFood[]> {
  const cutoff = dateKey(new Date(Date.now() - 21 * 24 * 60 * 60 * 1000));
  const rows = live(await db.meals.toArray()).filter((row) => row.date >= cutoff);

  // The newest row for each food is kept, not just a count, because a food she
  // wrote herself lives on the row rather than in a table: re-adding "Mum's
  // biryani" from here has to carry its macros with it, or the quick-add
  // writes a name and no numbers.
  const tally = new Map<string, { count: number; last: string; row: MealLog }>();
  for (const row of rows) {
    const seen = tally.get(row.foodId);
    if (seen) {
      seen.count += 1;
      if (row.date > seen.last) {
        seen.last = row.date;
        seen.row = row;
      }
    } else {
      tally.set(row.foodId, { count: 1, last: row.date, row });
    }
  }

  // Filtered against her diet, because a food she logged before going vegan is
  // not a food to offer her one tap away from the log. A food she wrote
  // herself is exempt: the app was never told what is in it, and refusing to
  // re-offer her own row on a guess would be the app overruling her about her
  // own dinner.
  const eligible = new Set(allowedFoods(pattern, avoid).map((food) => food.id));

  return [...tally.entries()]
    .filter(([id]) => isCustomId(id) || eligible.has(id))
    .sort((a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last))
    .slice(0, limit)
    .flatMap(([, entry]) => {
      const food = foodFor(entry.row);
      return food ? [{ food, custom: entry.row.custom }] : [];
    });
}

/* -------------------------------- cycle -------------------------------- */

export interface CycleContext {
  tracking: boolean;
  /**
   * What she actually chose, not just whether it is on.
   *
   * The screen needs the difference: "off" and "on hormonal contraception"
   * are two different answers and deserve two different explanations, and
   * neither of them should look like the feature was never there.
   */
  mode: CycleTracking;
  status: CycleStatus;
  patterns: PatternReport;
}

export async function getCycleContext(): Promise<CycleContext> {
  const profile = await getProfile();
  const [events, checkins] = await Promise.all([getCycleEvents(), getCheckins()]);

  return {
    tracking: profile?.cycleTracking === 'track',
    mode: profile?.cycleTracking ?? 'off',
    status: cycleStatus(events, dateKey()),
    patterns: detectPatterns({ checkins, cycleEvents: events }),
  };
}

/* -------------------------------- body -------------------------------- */

export interface WeightTrend {
  points: { date: string; weightKg: number }[];
  changeKg: number | null;
  /** Average of the last three weigh-ins, which is what to actually judge by. */
  smoothedKg: number | null;
}

/**
 * Body weight over time.
 *
 * The smoothed figure is the one worth showing. Day-to-day weight moves by a
 * kilo or more on water alone, and a single reading read as progress is how a
 * perfectly good week gets abandoned on a Tuesday.
 */
export async function getWeightTrend(): Promise<WeightTrend> {
  const rows = await getBodyMetrics();
  const points = rows.map((row) => ({ date: row.date, weightKg: row.weightKg }));

  const recent = points.slice(-3).map((point) => point.weightKg);
  const smoothed =
    recent.length === 0
      ? null
      : Math.round((recent.reduce((sum, value) => sum + value, 0) / recent.length) * 10) /
        10;

  return {
    points,
    changeKg:
      points.length < 2
        ? null
        : Math.round((points.at(-1)!.weightKg - points[0]!.weightKg) * 10) / 10,
    smoothedKg: smoothed,
  };
}

/* ------------------------------- briefing ------------------------------- */

/**
 * Everything the coach is told, assembled from the same queries the screens
 * use. Returns the structured input as well as the rendered text so the app
 * can show her exactly what was sent.
 */
export async function buildBriefing(): Promise<{
  input: BriefingInput | null;
  text: string;
}> {
  const profile = await getProfile();
  if (!profile) return { input: null, text: '' };

  const today = dateKey();
  const program = programFor(profile.daysPerWeek, trainingStyleOf(profile));
  const day = nextDay(program, await getLastCompletedDayId());

  const [
    summary,
    lifts,
    checkins,
    cycleContext,
    nutrition,
    sessionsLast28Days,
    conditioningLogs,
    weight,
  ] = await Promise.all([
    getTrainingSummary(),
    getLiftSnapshots(8),
    getRecentCheckins(14),
    getCycleContext(),
    getNutritionContext(),
    getSessionsSince(28),
    getConditioningLogs(60),
    getWeightTrend(),
  ]);

  const input: BriefingInput = {
    today,
    profile,
    programName: program.name,
    nextDayName: day.name,
    sessionsAllTime: summary.sessionsAllTime,
    sessionsThisMonth: summary.sessionsThisMonth,
    sessionsLast28Days,
    lastTrainedDate: summary.lastTrainedDate,
    lifts,
    recentReadiness: checkins.map((checkin) => ({
      date: checkin.date,
      score: readinessScore(checkin),
      band: bandFor(readinessScore(checkin)),
    })),
    cycle: profile.cycleTracking === 'track' ? cycleContext.status : null,
    patterns: profile.cycleTracking === 'track' ? cycleContext.patterns : null,
    nutrition: nutrition.plan,
    cuisine: nutrition.cuisine,
    intakeToday: nutrition.intakeToday,
    medianProteinG: nutrition.medianProteinG,
    daysFoodLogged: nutrition.daysFoodLogged,
    conditioningMinutes:
      trainingStyleOf(profile) === 'hybrid'
        ? (() => {
            const load = weeklyLoad(conditioningLogs, daysBetween, today);
            return { thisWeek: load.thisWeek, lastWeek: load.lastWeek };
          })()
        : null,
    bodyWeightTrendKg: weight.changeKg,
  };

  return { input, text: renderBriefing(input) };
}

/**
 * History the planner needs for a conditioning day, in the shape it wants.
 *
 * `excludeSessionId` is the same rule the set history follows, and it exists
 * for the same reason: without it, logging today's walk immediately recomputes
 * today's prescription from today's walk, and the card announces "28 minutes,
 * done" directly above the 25 minutes she actually did.
 */
export async function getConditioningExtras(excludeSessionId?: string): Promise<{
  easy: Awaited<ReturnType<typeof getConditioningLogs>>;
  intervals: Awaited<ReturnType<typeof getConditioningLogs>>;
}> {
  const logs = (await getConditioningLogs(120)).filter(
    (log) => !excludeSessionId || log.sessionId !== excludeSessionId,
  );
  return {
    easy: logs.filter((log) => log.kind === 'easy').slice(0, 8),
    intervals: logs.filter((log) => log.kind === 'intervals').slice(0, 8),
  };
}

/* -------------------------------- today -------------------------------- */

export interface TodayState {
  profile: Profile | null;
  plan: PlannedSession | null;
  openSession: Session | null;
  loggedSets: SetLog[];
  /** Conditioning already logged into the open session. */
  loggedConditioning: ConditioningLog[];
  checkin: Checkin | null;
  readiness: Readiness | null;
  /** She keeps overriding the suggestion, so offer to stop making it. */
  offerToStopAdjusting: boolean;
}

const EMPTY_TODAY: TodayState = {
  profile: null,
  plan: null,
  openSession: null,
  loggedSets: [],
  loggedConditioning: [],
  checkin: null,
  readiness: null,
  offerToStopAdjusting: false,
};

/**
 * Today's session, the check-in behind it, and what is logged into it.
 *
 * Lives here rather than inside the hook it started in because three things
 * now need it: the session screen, the "what next" strip, and the coach - which
 * has to know which slots exist before it can offer to swap one. A hook cannot
 * be called from a network client, and duplicating the query would eventually
 * mean the coach offering a swap for a session she is not being shown.
 */
export async function getTodayState(): Promise<TodayState> {
  const profile = await getProfile();
  if (!profile || profile.onboardedAt === null) {
    return { ...EMPTY_TODAY, profile: profile ?? null };
  }

  const openSession = (await getOpenSession()) ?? null;
  const lastCompletedDayId = await getLastCompletedDayId();
  const program = programFor(profile.daysPerWeek, trainingStyleOf(profile));

  // Once a session is underway it stays on its own day, even if finishing
  // another session elsewhere would otherwise advance the rotation.
  const day =
    (openSession?.templateId
      ? program.days.find((entry) => entry.id === openSession.templateId)
      : undefined) ?? nextDay(program, lastCompletedDayId);

  const history = new Map<string, SessionHistory>();
  // A conditioning day resolves no slots, so there is no set history to fetch
  // for it - and asking for it anyway would be several index scans for a
  // screen that shows a stopwatch.
  if (!isConditioningDay(day)) {
    for (const exerciseId of exerciseIdsForDay(day, profile)) {
      history.set(exerciseId, await getExerciseHistory(exerciseId, 6, openSession?.id));
    }
  }

  const checkin = (await getCheckinFor()) ?? null;
  const readiness = readinessFromCheckin(checkin);

  // An override already made this session must stick: without this the plan
  // would snap back to the reduced weight on the next live-query refresh.
  const effectiveReadiness = openSession?.readinessOverride ? null : readiness;

  return {
    profile,
    plan: buildSession(
      day,
      program,
      profile,
      history,
      effectiveReadiness,
      isConditioningDay(day) ? await getConditioningExtras(openSession?.id) : undefined,
    ),
    openSession,
    loggedSets: openSession ? await getSetsForSession(openSession.id) : [],
    loggedConditioning: openSession
      ? await getConditioningForSession(openSession.id)
      : [],
    checkin,
    readiness,
    offerToStopAdjusting:
      adjustmentsEnabled(profile) && shouldOfferToStopAdjusting(await getOverrideTally()),
  };
}

/** A session she started and finished today, as opposed to one still open. */
async function finishedSessionToday(): Promise<boolean> {
  const today = dateKey();
  return live(await db.sessions.toArray()).some(
    (session) =>
      session.endedAt !== null && dateKey(new Date(session.startedAt)) === today,
  );
}

/**
 * The snapshot the "what next" strip reasons over.
 *
 * Assembled here so the ordering rules stay in domain/nextUp.ts, where they
 * can be argued with in a test rather than inside a component.
 */
export async function getNextUpInput(): Promise<NextUpInput | null> {
  const profile = await getProfile();
  if (!profile || profile.onboardedAt === null) return null;

  const today = dateKey();
  const [state, nutrition, meals, weighIn, cycleEvents, trained] = await Promise.all([
    getTodayState(),
    getNutritionContext(),
    getMealsFor(today),
    getLatestBodyMetric(),
    getCycleEvents(),
    finishedSessionToday(),
  ]);

  const lastPeriod = cycleEvents
    .filter((event) => event.kind === 'period_start')
    .map((event) => event.date)
    .sort()
    .at(-1);

  return {
    sessionName: state.plan?.day.name ?? 'today’s session',
    conditioning: state.plan?.conditioning !== null && state.plan !== null,
    checkedIn: state.checkin !== null,
    sessionOpen: state.openSession !== null,
    loggedInSession:
      state.loggedSets.length + state.loggedConditioning.length,
    trainedToday: trained,
    nutritionReady: nutrition.plan !== null,
    mealsLoggedToday: meals.length,
    proteinG: nutrition.intakeToday?.proteinG ?? 0,
    proteinTargetG: nutrition.plan?.macros.proteinG ?? 0,
    daysSinceWeighIn: weighIn ? daysBetween(weighIn.date, today) : null,
    tracksCycle: profile.cycleTracking === 'track',
    daysSincePeriodLog: lastPeriod ? daysBetween(lastPeriod, today) : null,
  };
}

/* ---------------------------- coach proposals ---------------------------- */

export interface TodayProposalContext extends ProposalContext {
  dayName: string;
  /**
   * The programme day a logged set should open a session against, when there
   * is no session open yet. Null on a day with nothing planned.
   */
  templateId: string | null;
}

/**
 * The only things the coach is allowed to name: foods she eats and swaps
 * today's session actually offers.
 *
 * Built from the same functions the food picker and the swap sheet use, so a
 * proposal can never contain an option the UI would have refused to show her.
 */
export async function getProposalContext(): Promise<TodayProposalContext> {
  const profile = await getProfile();
  const state = await getTodayState();

  return {
    // Sorted into her kitchen first. The model reads this list top-down and a
    // catalogue that opens with somebody else's staples is a coach that
    // offers a Pakistani user porridge and calls it local knowledge.
    pantry: sortForCuisine(
      allowedFoods(dietPatternOf(profile ?? {}), foodAvoidOf(profile ?? {})),
      cuisineOf(profile ?? {}),
    ),
    slots: (state.plan?.exercises ?? []).map((planned) => ({
      slotKey: planned.slotKey,
      exercise: planned.exercise,
      alternatives: planned.alternatives,
      weightKg: planned.prescription.weightKg,
      sets: planned.prescription.sets,
      repRange: planned.prescription.repRange,
    })),
    // The whole library, deliberately. The catalogue the model is shown only
    // advertises today's slots, so this is what happens when she says "I also
    // did some curls" - a real exercise, resolvable, and hers to log.
    loggable: EXERCISES,
    defaultSlot: slotForHour(new Date().getHours()),
    dayName: state.plan?.day.name ?? 'no session planned',
    templateId: state.plan?.day.id ?? null,
  };
}

/**
 * The catalogues, as the model sees them.
 *
 * Shown to her verbatim next to the briefing. If the app is going to let a
 * model put food in her log, "what exactly can it choose from" deserves a
 * literal answer rather than a reassurance.
 */
export async function buildActionContext(): Promise<string> {
  const context = await getProposalContext();
  return [
    foodCatalogue(context.pantry),
    '',
    sessionCatalogue(context.slots, context.dayName),
    '',
    `If she does not say which meal, use ${context.defaultSlot}.`,
  ].join('\n');
}
