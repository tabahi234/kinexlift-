import type { Profile } from '../db/schema';
import type { CycleStatus } from './cycle';
import { CUISINE_LABEL, type Cuisine } from './cuisines';
import { PHASE_LABEL } from './cycle';
import type { Nutrients } from './foods';
import type { NutritionPlan } from './nutrition';
import type { PatternReport } from './patterns';
import { trainingStyleOf, weightGoalOf } from './profile';

/**
 * What the coach knows before it says anything.
 *
 * The model is not asked to work out how her squat is going. Everything
 * numerical is computed here, from the log, by the same code that draws the
 * charts - then handed over as a fact sheet. The model's job is to read that
 * sheet and answer in sentences.
 *
 * That split is the whole design. A model left to infer progress from a raw
 * training log will confidently invent a personal best, and a coach that
 * invents a personal best is worse than no coach. It also means every claim it
 * makes can be checked against a screen in the app, and that the expensive
 * part of the request is small: a page of facts rather than a year of history.
 */

export type LiftTrend = 'new' | 'up' | 'flat' | 'down';

export interface LiftSnapshot {
  exerciseId: string;
  name: string;
  sessions: number;
  lastPerformed: string | null;
  lastWeightKg: number;
  bestE1rm: number | null;
  /** Change in estimated 1RM across her logged sessions, in kg. */
  changeKg: number | null;
  trend: LiftTrend;
  /** Three sessions at the same weight with no rep improvement. */
  stalled: boolean;
}

export interface BriefingInput {
  today: string;
  profile: Profile;
  programName: string;
  nextDayName: string;
  sessionsAllTime: number;
  sessionsThisMonth: number;
  sessionsLast28Days: number;
  lastTrainedDate: string | null;
  lifts: LiftSnapshot[];
  /** Most recent first. */
  recentReadiness: { date: string; score: number; band: string }[];
  cycle: CycleStatus | null;
  patterns: PatternReport | null;
  nutrition: NutritionPlan | null;
  /** The region her food catalogue is sorted into, or null if she never said. */
  cuisine: Cuisine | null;
  intakeToday: Nutrients | null;
  /** Median protein over the days she actually logged food, last 14 days. */
  medianProteinG: number | null;
  daysFoodLogged: number;
  conditioningMinutes: { thisWeek: number; lastWeek: number } | null;
  bodyWeightTrendKg: number | null;
}

/* ----------------------------- weak spots ----------------------------- */

/**
 * Where she is actually falling short.
 *
 * Kept deterministic on purpose. "What am I neglecting" is the question a
 * coach is most useful for and the one a language model is most likely to
 * answer from vibes, so the answer is computed here and the model is only
 * allowed to explain it.
 */
export function weakSpots(input: BriefingInput): string[] {
  const spots: string[] = [];

  const stalled = input.lifts.filter((lift) => lift.stalled);
  if (stalled.length > 0) {
    spots.push(
      `Stalled: ${stalled.map((lift) => lift.name).join(', ')} - three sessions at the same weight without a rep improvement.`,
    );
  }

  const stale = input.lifts.filter(
    (lift) =>
      lift.lastPerformed !== null && daysAgo(lift.lastPerformed, input.today) > 21,
  );
  if (stale.length > 0) {
    spots.push(
      `Not trained in over three weeks: ${stale.map((lift) => lift.name).join(', ')}.`,
    );
  }

  const expected = input.profile.daysPerWeek * 4;
  if (input.sessionsLast28Days < expected * 0.6 && input.sessionsAllTime > 0) {
    spots.push(
      `Attendance: ${input.sessionsLast28Days} sessions in the last four weeks against a plan of about ${expected}.`,
    );
  }

  if (
    input.nutrition &&
    input.medianProteinG !== null &&
    input.daysFoodLogged >= 3 &&
    input.medianProteinG < input.nutrition.macros.proteinG * 0.8
  ) {
    spots.push(
      `Protein: typically around ${Math.round(input.medianProteinG)} g on the days she logs food, against a target of ${input.nutrition.macros.proteinG} g.`,
    );
  }

  if (
    trainingStyleOf(input.profile) === 'hybrid' &&
    input.conditioningMinutes !== null &&
    input.conditioningMinutes.thisWeek === 0
  ) {
    spots.push('Conditioning: nothing logged in the last seven days.');
  }

  if (input.recentReadiness.length === 0 && input.sessionsAllTime > 2) {
    spots.push(
      'Check-ins: none recently, so sessions are running unadjusted and the cycle pattern work has nothing to read.',
    );
  }

  if (input.cycle?.flags.includes('absent')) {
    spots.push(
      'No period logged for over three months. This is a clinician question, not a training one, and it outranks everything else here.',
    );
  }

  return spots;
}

function daysAgo(from: string, to: string): number {
  const parse = (key: string) => Date.parse(`${key}T12:00:00Z`);
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/* ------------------------------ rendering ------------------------------ */

const line = (label: string, value: string | number | null | undefined): string | null =>
  value === null || value === undefined || value === '' ? null : `${label}: ${value}`;

/**
 * The fact sheet, as plain text.
 *
 * Written for a model to read rather than a person, but deliberately kept
 * legible so it can be shown to her verbatim - if the coach is going to be
 * told her cycle length and her calorie target, she gets to see exactly what
 * was sent.
 */
export function renderBriefing(input: BriefingInput): string {
  const { profile } = input;
  const parts: (string | null)[] = [];

  parts.push('## Who');
  parts.push(
    line('Goal', profile.goal),
    line('Experience', profile.experience),
    line('Trains', `${profile.daysPerWeek} days a week, ${trainingStyleOf(profile)}`),
    line('Programme', `${input.programName}; next session is ${input.nextDayName}`),
    line('Where', profile.location),
    line(
      'Working around',
      profile.limitations.length ? profile.limitations.join(', ') : null,
    ),
    line('Body weight', profile.bodyWeightKg ? `${profile.bodyWeightKg} kg` : null),
    line(
      'Weight trend',
      input.bodyWeightTrendKg === null
        ? null
        : `${input.bodyWeightTrendKg > 0 ? '+' : ''}${input.bodyWeightTrendKg} kg over the logged period`,
    ),
    line('Weight goal', weightGoalOf(profile)),
  );

  parts.push('', '## Training');
  parts.push(
    line('Sessions logged', input.sessionsAllTime),
    line('This month', input.sessionsThisMonth),
    line('Last 28 days', input.sessionsLast28Days),
    line('Last trained', input.lastTrainedDate),
  );

  if (input.lifts.length > 0) {
    parts.push('', 'Lifts (estimated 1RM change across logged sessions):');
    for (const lift of input.lifts.slice(0, 8)) {
      const change =
        lift.changeKg === null
          ? 'not enough data to estimate'
          : `${lift.changeKg > 0 ? '+' : ''}${lift.changeKg} kg`;
      parts.push(
        `- ${lift.name}: ${lift.sessions} sessions, working weight ${lift.lastWeightKg} kg, ${change}${lift.stalled ? ', STALLED' : ''}`,
      );
    }
  }

  if (input.conditioningMinutes) {
    parts.push(
      '',
      `Conditioning: ${input.conditioningMinutes.thisWeek} minutes in the last 7 days, ${input.conditioningMinutes.lastWeek} the week before.`,
    );
  }

  parts.push('', '## Readiness');
  if (input.recentReadiness.length === 0) {
    parts.push('No check-ins logged recently.');
  } else {
    const average = Math.round(
      input.recentReadiness.reduce((sum, entry) => sum + entry.score, 0) /
        input.recentReadiness.length,
    );
    parts.push(
      `Average score over the last ${input.recentReadiness.length} check-ins: ${average}/100 (50+ is a full session).`,
    );
    parts.push(
      `Most recent: ${input.recentReadiness[0]!.date}, ${input.recentReadiness[0]!.score}/100, ${input.recentReadiness[0]!.band}.`,
    );
  }

  if (input.cycle && input.cycle.lastStart) {
    parts.push('', '## Cycle');
    parts.push(
      line('Day of cycle', input.cycle.dayOfCycle),
      line(
        'Estimated phase',
        input.cycle.phase ? PHASE_LABEL[input.cycle.phase] : 'not enough data',
      ),
      line('Typical cycle length', input.cycle.stats.medianLengthDays),
      line('Cycles logged', input.cycle.stats.completeCycles),
      line('Prediction confidence', input.cycle.stats.confidence),
      line(
        'Flags',
        input.cycle.flags.length ? input.cycle.flags.join(', ') : null,
      ),
    );
    parts.push(
      'Note: the app does not change weights by cycle phase and neither should you. Phase is context, not a prescription.',
    );
  }

  if (input.patterns?.ready) {
    parts.push('', '## Her own patterns (from her logs, not from population averages)');
    if (input.patterns.findings.length === 0) {
      parts.push('Nothing stands out across her cycle phases so far.');
    } else {
      for (const finding of input.patterns.findings) parts.push(`- ${finding.text}`);
    }
  }

  if (input.nutrition) {
    const { nutrition } = input;
    parts.push('', '## Nutrition targets (computed by the app)');
    parts.push(
      line('Maintenance', `${nutrition.energy.tdee} kcal`),
      line('Target', `${nutrition.target.kcal} kcal`),
      line(
        'Macros',
        `${nutrition.macros.proteinG} g protein, ${nutrition.macros.carbG} g carbs, ${nutrition.macros.fatG} g fat, ${nutrition.macros.fibreG} g fibre`,
      ),
      line('BMI', nutrition.bmi ? `${nutrition.bmi.value} (${nutrition.bmi.label})` : null),
      line(
        'Floor applied',
        nutrition.target.floor === 'none' ? null : nutrition.target.floor,
      ),
    );
    if (input.intakeToday) {
      parts.push(
        `Logged today: ${Math.round(input.intakeToday.kcal)} kcal, ${Math.round(input.intakeToday.proteinG)} g protein.`,
      );
    }
    if (input.medianProteinG !== null) {
      parts.push(
        `Typical protein on logged days: ${Math.round(input.medianProteinG)} g (${input.daysFoodLogged} days logged).`,
      );
    }
    parts.push(
      line(
        'Kitchen',
        input.cuisine === null
          ? 'not said - do not assume one'
          : CUISINE_LABEL[input.cuisine],
      ),
    );
  }

  const spots = weakSpots(input);
  if (spots.length > 0) {
    parts.push('', '## Where she is falling short');
    for (const spot of spots) parts.push(`- ${spot}`);
  }

  return parts.filter((part) => part !== null).join('\n');
}

/* --------------------------- the system prompt --------------------------- */

/**
 * The rules the model works under.
 *
 * Most of these exist because the alternative is a specific, foreseeable harm:
 * a model that invents a personal best, or that agrees enthusiastically when
 * someone asks it to help them eat 900 kilocalories a day, or that programmes
 * her training around her cycle because that is what the internet says women's
 * training apps do.
 */
export const COACH_SYSTEM_PROMPT = `You are the coach inside a women's strength training app. You are talking to the person whose data appears below.

WHAT YOU ARE AND ARE NOT
- The app's engine decides every weight, set, rep, calorie and macro. You explain those decisions, answer questions, and give context. You never prescribe different numbers, and you never override the app.
- There are exactly two things you can put in front of her as a card she taps to accept: food for today's log, and swapping an exercise in today's session for one of the alternatives offered for that slot. The rules for both are below, under PUTTING SOMETHING IN HER LOG.
- Everything else, you cannot do. You cannot change a setting, log a set, move a target or edit her programme. What you can do is tell her exactly where in the app to do it herself.
- Every number you state must come from the briefing. If it is not there, say you do not have it rather than estimating. Never invent a personal best, a total, or a date.

ANSWER THE QUESTION SHE ASKED
- "What should I change?", "what am I doing wrong?", "should I do X?" are requests for your opinion. Answer them properly, with something specific from her data. Declining to answer because you cannot edit the app is a non-answer and it is the wrong reply.
- "What should I eat tonight?", "give me a high-protein lunch", "my knee hurts, what do I do about today's squats?" are requests for a card. Answer in prose and attach the proposal.
- Only mention what you cannot do when she has actually asked you to do something that is not one of the two.

WHERE THINGS ARE IN THE APP
Never invent a screen name. These five, and nothing else, exist:
- Today: the session, logging sets, the daily check-in, swapping an exercise.
- Fuel: calorie and macro targets, logging food, the BMI calculator, and the settings for how active she is and whether she is eating to lose, hold or gain.
- Coach: you.
- Progress: charts of her lifts, her body weight, and - if she tracks it - her cycle.
- You: days per week, lifting-only or hybrid, whether the check-in adjusts her sessions, cycle tracking, how she eats, export and delete.
There is no screen for editing a weight or a set count by hand. The engine sets those from her logged sets, and the daily check-in is what lowers them on a bad day. What she can change on Today is which exercise fills a slot, and she can stop logging at any point.
Both Today and Fuel have a box that asks you a question without leaving the screen, so "ask me for a meal" and "ask me about today's session" are things she can do from where she already is.

HOW TO ANSWER
- Short. Two to five sentences unless she asks for detail. No headings, no bullet lists unless she asks for a list, no emoji.
- Plain, warm, direct. Talk like a good coach in a gym, not like a wellness brand. No hype, no exclamation marks, no calling her "queen" or "babe".
- Never use an em dash or an en dash. Rewrite the sentence with a comma, a colon or a full stop instead. The app strips them anyway, and a rewrite reads better than a substituted character.
- Be specific to her data. "Your squat has not moved in three sessions" is useful; "keep up the great work" is not.
- If she is doing something well, say it once and move on.

TRAINING
- Progression is double progression: hold the weight until every working set hits the top of the rep range at two or fewer reps in reserve, then add the smallest increment. A stall is three sessions, not two.
- The app autoregulates from her daily check-in, within bounds she can see and undo.
- Do NOT programme by menstrual cycle phase. Fixed per-phase weight multipliers are not supported by the evidence and work against progressive overload. Her cycle phase is context for how she might feel; it is never a reason to change a prescribed weight. If she asks for cycle-based programming, explain this plainly rather than complying.

FOOD
- The calorie and macro targets in the briefing already have a floor built in that protects against under-eating. Never suggest going below the target given, and never help construct a lower one. If she pushes, say why the floor is there: periods, bone density and the strength she is training for all go first.
- BMI is a rough screening number that cannot tell muscle from fat. Say so whenever it comes up.
- Food suggestions should fit what she actually eats. The food catalogue you are given is already sorted into her own kitchen first, from the country she told the app. Work down it from the top rather than reaching for whatever is most familiar to you.
- Do not translate her food into somebody else's. If she cooks daal, jollof or adobo, name that; suggesting chicken and broccoli to a woman whose kitchen has neither is how a food target gets abandoned.
- When she asks what to eat, do not hand her a paragraph to retype into a food picker. Pick from the list of foods you are given, say what it comes to, and attach the card.

SAFETY
- You are not a clinician. Periods that have stopped, pain that does not settle, injury, disordered eating, pregnancy: name the concern once, say it is worth a doctor's opinion, and do not try to manage it.
- Never diagnose. Never discuss weight-loss drugs, supplements beyond ordinary food, or anything you would need a licence to say.

MEMORY
- The conversation summary and saved notes are things she told you before. Use them naturally. Do not announce that you remember, and do not recite them back at her.`;


/** Asked of the model when the conversation gets long enough to need a recap. */
export const SUMMARY_PROMPT = `Write a compact third-person summary of what matters from this conversation for future sessions: what she asked about, what she said about herself, what was decided, anything she said she would try. Keep everything she stated as fact about her body, injuries, schedule, food or preferences. Drop pleasantries and anything the app already tracks numerically. Under 150 words, plain prose, no headings.`;
