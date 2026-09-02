import type { Checkin, CycleEvent, SymptomTag } from '../db/schema';
import { daysBetween } from '../lib/date';
import {
  cycleStats,
  phaseForDay,
  PHASE_LABEL,
  periodStarts,
  type CyclePhase,
} from './cycle';
import { readinessScore } from './readiness';

/**
 * Per-user pattern detection.
 *
 * This is the payoff for refusing to programme from a calendar. Instead of
 * telling her what women feel in the luteal phase, it waits until she has
 * logged enough of her own days, then tells her what *she* recorded - or says
 * plainly that nothing stands out, which is the most common honest answer.
 *
 * The bar for reporting anything is deliberately high:
 *
 *   - three complete cycles minimum, because two gives you a coin flip;
 *   - at least four check-ins inside a phase before that phase is described
 *     at all, so one rough Tuesday cannot become a personality trait;
 *   - a difference has to clear a visible threshold, not merely exist.
 *
 * And whatever it finds, it changes nothing. Findings are shown to her; the
 * training engine never reads them.
 */

const MIN_COMPLETE_CYCLES = 3;
const MIN_SAMPLES_PER_PHASE = 4;
/** Points on the 0-100 readiness scale. Below this it is noise. */
const READINESS_DIFFERENCE = 8;
/** A symptom has to be this common in a phase before it is worth naming. */
const SYMPTOM_RATE = 0.4;
/** ...and this many times more common than in her other phases. */
const SYMPTOM_LIFT = 2;

const DEFAULT_PERIOD_DAYS = 5;

const live = <T extends { deletedAt: number | null }>(rows: T[]): T[] =>
  rows.filter((row) => row.deletedAt === null);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The phase a past date fell in.
 *
 * Uses the *observed* length of the cycle the date sits inside - the gap to
 * the next logged start - and only falls back to her median for the cycle
 * still in progress. Retrospective assignment has the real answer available,
 * so using the median for it would throw away accuracy for no reason.
 */
export function phaseOnDate(
  date: string,
  starts: string[],
  medianLengthDays: number | null,
  periodDays: number,
): CyclePhase | null {
  let index = -1;
  for (let i = 0; i < starts.length; i++) {
    if (daysBetween(starts[i]!, date) >= 0) index = i;
    else break;
  }
  if (index === -1) return null;

  const start = starts[index]!;
  const next = starts[index + 1];
  const observed = next ? daysBetween(start, next) : null;
  const length = observed ?? medianLengthDays;
  if (length === null) return null;

  return phaseForDay(daysBetween(start, date) + 1, length, periodDays);
}

/* ------------------------------- report ------------------------------- */

export interface PhaseSample {
  phase: CyclePhase;
  checkins: number;
  medianReadiness: number | null;
  /** Fraction of check-ins in this phase carrying each symptom. */
  symptomRates: Partial<Record<SymptomTag, number>>;
}

export type FindingKind = 'readiness-lower' | 'readiness-higher' | 'symptom';

export interface Finding {
  phase: CyclePhase;
  kind: FindingKind;
  /** Shown to her verbatim. */
  text: string;
}

export interface PatternReport {
  /** False when there is not yet enough logged to say anything at all. */
  ready: boolean;
  /** Why not, in plain language. Null once ready. */
  waitingFor: string | null;
  completeCycles: number;
  checkinsAssigned: number;
  samples: PhaseSample[];
  findings: Finding[];
  /** True when there is enough data and nothing stood out. Not a failure. */
  nothingStandsOut: boolean;
}

const SYMPTOM_WORD: Record<SymptomTag, string> = {
  cramps: 'cramps',
  bloating: 'bloating',
  headache: 'headaches',
  low_mood: 'low mood',
  poor_sleep: 'bad sleep',
  breast_tenderness: 'breast tenderness',
  high_stress: 'feeling stressed',
};

export function detectPatterns(input: {
  checkins: Checkin[];
  cycleEvents: CycleEvent[];
}): PatternReport {
  const stats = cycleStats(input.cycleEvents);
  const starts = periodStarts(input.cycleEvents);
  const periodDays = stats.medianPeriodDays ?? DEFAULT_PERIOD_DAYS;

  const empty = (): PatternReport => ({
    ready: false,
    waitingFor:
      stats.completeCycles === 0
        ? 'Log two period start dates and this begins to fill in.'
        : `${MIN_COMPLETE_CYCLES - stats.completeCycles} more full ${
            MIN_COMPLETE_CYCLES - stats.completeCycles === 1 ? 'cycle' : 'cycles'
          } and the app can start comparing your own days.`,
    completeCycles: stats.completeCycles,
    checkinsAssigned: 0,
    samples: [],
    findings: [],
    nothingStandsOut: false,
  });

  if (stats.completeCycles < MIN_COMPLETE_CYCLES) return empty();

  const byPhase = new Map<CyclePhase, Checkin[]>();
  let assigned = 0;

  for (const checkin of live(input.checkins)) {
    const phase = phaseOnDate(checkin.date, starts, stats.medianLengthDays, periodDays);
    if (!phase) continue;
    assigned++;
    const bucket = byPhase.get(phase);
    if (bucket) bucket.push(checkin);
    else byPhase.set(phase, [checkin]);
  }

  const allScores = [...byPhase.values()]
    .flat()
    .map((checkin) => readinessScore(checkin));
  const overall = median(allScores);

  const samples: PhaseSample[] = [];
  const findings: Finding[] = [];

  for (const [phase, checkins] of byPhase) {
    const rates: Partial<Record<SymptomTag, number>> = {};
    const counts = new Map<SymptomTag, number>();
    for (const checkin of checkins) {
      for (const symptom of new Set(checkin.symptoms)) {
        counts.set(symptom, (counts.get(symptom) ?? 0) + 1);
      }
    }
    for (const [symptom, count] of counts) {
      rates[symptom] = count / checkins.length;
    }

    samples.push({
      phase,
      checkins: checkins.length,
      medianReadiness: median(checkins.map((checkin) => readinessScore(checkin))),
      symptomRates: rates,
    });
  }

  samples.sort((a, b) => b.checkins - a.checkins);

  for (const sample of samples) {
    if (sample.checkins < MIN_SAMPLES_PER_PHASE) continue;
    if (sample.medianReadiness === null || overall === null) continue;

    const gap = sample.medianReadiness - overall;
    const label = PHASE_LABEL[sample.phase].toLowerCase();

    if (gap <= -READINESS_DIFFERENCE) {
      findings.push({
        phase: sample.phase,
        kind: 'readiness-lower',
        text: `Across ${sample.checkins} check-ins, you tend to rate yourself lower during your ${label} days than the rest of your cycle. Your sessions already ease off on the days you say so - this just names the pattern.`,
      });
    } else if (gap >= READINESS_DIFFERENCE) {
      findings.push({
        phase: sample.phase,
        kind: 'readiness-higher',
        text: `Across ${sample.checkins} check-ins, your ${label} days are the ones you rate highest. If you get to choose when to push, this is your window.`,
      });
    }

    // A symptom only counts as a pattern if it is both common in this phase
    // and clearly rarer elsewhere. Common everywhere is not a cycle pattern.
    const others = samples.filter((entry) => entry.phase !== sample.phase);
    const otherTotal = others.reduce((sum, entry) => sum + entry.checkins, 0);

    for (const [symptom, rate] of Object.entries(sample.symptomRates) as [
      SymptomTag,
      number,
    ][]) {
      if (rate < SYMPTOM_RATE) continue;
      const elsewhere =
        otherTotal === 0
          ? 0
          : others.reduce(
              (sum, entry) => sum + (entry.symptomRates[symptom] ?? 0) * entry.checkins,
              0,
            ) / otherTotal;
      if (elsewhere > 0 && rate < elsewhere * SYMPTOM_LIFT) continue;

      findings.push({
        phase: sample.phase,
        kind: 'symptom',
        text: `You log ${SYMPTOM_WORD[symptom]} on about ${Math.round(rate * 100)}% of your ${label} days, and rarely otherwise. Worth planning around rather than pushing through.`,
      });
    }
  }

  const usable = samples.filter((sample) => sample.checkins >= MIN_SAMPLES_PER_PHASE);
  if (usable.length < 2) {
    return {
      ready: false,
      waitingFor:
        'Keep doing the daily check-in. Comparing phases needs a few answers inside each one.',
      completeCycles: stats.completeCycles,
      checkinsAssigned: assigned,
      samples,
      findings: [],
      nothingStandsOut: false,
    };
  }

  return {
    ready: true,
    waitingFor: null,
    completeCycles: stats.completeCycles,
    checkinsAssigned: assigned,
    samples,
    findings,
    nothingStandsOut: findings.length === 0,
  };
}
