import type { CycleEvent } from '../db/schema';
import { addDays, daysBetween } from '../lib/date';

/**
 * Cycle intelligence.
 *
 * Everything here is *derived* from logged period events. No phase is ever
 * stored, because a stored phase is a number that quietly goes wrong the
 * moment she logs a period a day late.
 *
 * Three rules keep this honest:
 *
 *   1. It uses *her* cycle length, never 28. The textbook 28-day cycle is a
 *      population average that only a minority of cycles actually match, and
 *      building on it produces a calendar that is confidently wrong.
 *   2. The luteal phase is the stable one (about 14 days), not the follicular
 *      one. So ovulation is estimated backwards from the *next* expected
 *      period, not forwards from the last one. Estimating forwards is the
 *      single most common mistake in cycle apps and it misplaces ovulation by
 *      a week in anyone whose cycle is not 28 days.
 *   3. Nothing in here returns a number the training engine can read. Phase is
 *      display and pattern-detection only. Fixed per-phase weight multipliers
 *      are not supported by the evidence (McNulty 2020, Colenso-Semple 2023)
 *      and they work against progressive overload, which is the entire point
 *      of the daily readiness check-in.
 */

export type CyclePhase = 'menstrual' | 'follicular' | 'ovulatory' | 'luteal';

export type CycleConfidence = 'none' | 'low' | 'medium' | 'high';

export type CycleFlag =
  | 'no-data'
  /** Nothing logged for a long time. Worth raising with a clinician. */
  | 'absent'
  /** Spread between her cycles is too wide to predict from. */
  | 'irregular'
  /** Past the predicted date by more than the usual spread. */
  | 'late';

/** The luteal phase is the consistent one; the follicular phase absorbs the variation. */
export const LUTEAL_DAYS = 14;

/** Below this, two logged starts are one period entered twice, not two cycles. */
const MIN_CYCLE_DAYS = 15;

/**
 * A gap longer than this is missed logging or an absent period, not a cycle.
 * Including it would drag the median far enough to poison every prediction.
 */
const MAX_CYCLE_DAYS = 90;

/** Days without a period start that are worth mentioning to a clinician. */
export const ABSENT_AFTER_DAYS = 90;

/** Fallback bleed length when she has never logged a period end. */
const DEFAULT_PERIOD_DAYS = 5;

const live = <T extends { deletedAt: number | null }>(rows: T[]): T[] =>
  rows.filter((row) => row.deletedAt === null);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Median absolute deviation rather than standard deviation: one 60-day gap
 * after a stressful month should not make eight regular cycles read as
 * chaotic, and MAD does not let it.
 */
function medianAbsoluteDeviation(values: number[]): number | null {
  const centre = median(values);
  if (centre === null) return null;
  return median(values.map((value) => Math.abs(value - centre)));
}

/* ------------------------------ statistics ------------------------------ */

export interface CycleStats {
  /** Period start dates, ascending, with duplicate entries collapsed. */
  starts: string[];
  /** Days between consecutive starts, implausible gaps excluded. */
  lengths: number[];
  completeCycles: number;
  medianLengthDays: number | null;
  shortestDays: number | null;
  longestDays: number | null;
  /** Typical distance from her own median, in days. */
  variabilityDays: number | null;
  medianPeriodDays: number | null;
  confidence: CycleConfidence;
}

/**
 * Collapses repeat entries: a second 'period_start' two days after the first
 * is the same period logged twice, not a two-day cycle.
 */
export function periodStarts(events: CycleEvent[]): string[] {
  const dates = live(events)
    .filter((event) => event.kind === 'period_start')
    .map((event) => event.date)
    .sort();

  const kept: string[] = [];
  for (const date of dates) {
    const previous = kept.at(-1);
    if (previous === undefined || daysBetween(previous, date) >= MIN_CYCLE_DAYS) {
      kept.push(date);
    }
  }
  return kept;
}

/** Bleed lengths, from each start to the first end logged after it. */
export function periodLengths(events: CycleEvent[]): number[] {
  const rows = live(events);
  const starts = periodStarts(events);
  const ends = rows
    .filter((event) => event.kind === 'period_end')
    .map((event) => event.date)
    .sort();

  const lengths: number[] = [];
  for (const start of starts) {
    const end = ends.find((candidate) => daysBetween(start, candidate) >= 0);
    if (!end) continue;
    const span = daysBetween(start, end) + 1;
    // A "period" over two weeks long is a mis-logged end date, and it would
    // push the follicular phase past ovulation if it were believed.
    if (span >= 1 && span <= 14) lengths.push(span);
  }
  return lengths;
}

function confidenceFor(cycles: number, variability: number | null): CycleConfidence {
  if (cycles === 0) return 'none';
  if (variability !== null && variability > 9) return 'low';
  if (cycles >= 6 && variability !== null && variability <= 5) return 'high';
  if (cycles >= 3 && variability !== null && variability <= 7) return 'medium';
  return 'low';
}

export function cycleStats(events: CycleEvent[]): CycleStats {
  const starts = periodStarts(events);

  const lengths: number[] = [];
  for (let i = 1; i < starts.length; i++) {
    const gap = daysBetween(starts[i - 1]!, starts[i]!);
    if (gap >= MIN_CYCLE_DAYS && gap <= MAX_CYCLE_DAYS) lengths.push(gap);
  }

  const medianLength = median(lengths);
  const variability = medianAbsoluteDeviation(lengths);

  return {
    starts,
    lengths,
    completeCycles: lengths.length,
    medianLengthDays: medianLength === null ? null : Math.round(medianLength),
    shortestDays: lengths.length ? Math.min(...lengths) : null,
    longestDays: lengths.length ? Math.max(...lengths) : null,
    variabilityDays: variability === null ? null : Math.round(variability),
    medianPeriodDays: (() => {
      const value = median(periodLengths(events));
      return value === null ? null : Math.round(value);
    })(),
    confidence: confidenceFor(lengths.length, variability),
  };
}

/* -------------------------------- phase -------------------------------- */

export interface PhaseWindow {
  phase: CyclePhase;
  /** Inclusive cycle days, 1-based. */
  fromDay: number;
  toDay: number;
}

/**
 * The phase map for one cycle of a given length.
 *
 * Ovulation is placed at `length - LUTEAL_DAYS`, so a 34-day cycle puts it on
 * day 20 rather than day 14. The fertile-window convention of a few days
 * either side is kept deliberately narrow here: this drives a label on a
 * screen, not a contraceptive decision.
 */
export function phaseWindows(cycleLengthDays: number, periodDays: number): PhaseWindow[] {
  const length = Math.max(MIN_CYCLE_DAYS, Math.round(cycleLengthDays));
  const bleed = Math.min(Math.max(1, Math.round(periodDays)), 10);
  const ovulationDay = Math.max(bleed + 2, length - LUTEAL_DAYS);

  const windows: PhaseWindow[] = [{ phase: 'menstrual', fromDay: 1, toDay: bleed }];

  const follicularEnd = ovulationDay - 2;
  if (follicularEnd >= bleed + 1) {
    windows.push({ phase: 'follicular', fromDay: bleed + 1, toDay: follicularEnd });
  }

  windows.push({
    phase: 'ovulatory',
    fromDay: Math.max(bleed + 1, ovulationDay - 1),
    toDay: ovulationDay + 1,
  });

  if (length >= ovulationDay + 2) {
    windows.push({ phase: 'luteal', fromDay: ovulationDay + 2, toDay: length });
  }

  return windows;
}

/**
 * Which phase a cycle day falls in.
 *
 * Days past the expected end of the cycle stay luteal rather than wrapping
 * round to day one - she is late, not menstruating, and saying otherwise is
 * exactly the kind of confident wrong answer this module exists to avoid.
 */
export function phaseForDay(
  dayOfCycle: number,
  cycleLengthDays: number,
  periodDays: number,
): CyclePhase | null {
  if (dayOfCycle < 1) return null;
  const windows = phaseWindows(cycleLengthDays, periodDays);
  const found = windows.find(
    (window) => dayOfCycle >= window.fromDay && dayOfCycle <= window.toDay,
  );
  if (found) return found.phase;
  return dayOfCycle > cycleLengthDays ? 'luteal' : null;
}

export const PHASE_LABEL: Record<CyclePhase, string> = {
  menstrual: 'Period',
  follicular: 'Follicular',
  ovulatory: 'Around ovulation',
  luteal: 'Luteal',
};

/** Plain description of what is actually known, with no training claim in it. */
export const PHASE_NOTE: Record<CyclePhase, string> = {
  menstrual:
    'Bleeding days. Plenty of women train right through these and feel better for it; some do not. Your check-in decides, not the calendar.',
  follicular:
    'The stretch after your period. Nothing in your programme changes here - if you do feel stronger, your logged sets will show it.',
  ovulatory:
    'Around the middle of your cycle. Estimated from your own cycle length, so treat it as a rough marker.',
  luteal:
    'The run-up to your next period. Body temperature and appetite often rise; that is normal and not a setback.',
};

/* ------------------------------- status ------------------------------- */

export interface CycleStatus {
  stats: CycleStats;
  lastStart: string | null;
  /** 1-based day of the current cycle. */
  dayOfCycle: number | null;
  phase: CyclePhase | null;
  /** The cycle length the phase estimate used. */
  assumedLengthDays: number | null;
  predictedNextStart: string | null;
  /** Inclusive earliest and latest plausible date for the next start. */
  predictedWindow: [string, string] | null;
  daysUntilNext: number | null;
  /** Days since the last logged period start. */
  daysSinceStart: number | null;
  flags: CycleFlag[];
}

/**
 * Everything the cycle screen shows, from the events alone.
 *
 * Returns nulls rather than guesses whenever the data cannot support an
 * answer: no logged periods means no phase, and one logged period means a day
 * count but no prediction.
 */
export function cycleStatus(events: CycleEvent[], today: string): CycleStatus {
  const stats = cycleStats(events);
  const flags: CycleFlag[] = [];
  const lastStart = stats.starts.at(-1) ?? null;

  if (lastStart === null) {
    return {
      stats,
      lastStart: null,
      dayOfCycle: null,
      phase: null,
      assumedLengthDays: null,
      predictedNextStart: null,
      predictedWindow: null,
      daysUntilNext: null,
      daysSinceStart: null,
      flags: ['no-data'],
    };
  }

  const daysSinceStart = daysBetween(lastStart, today);
  // A start logged in the future is a typo; treat it as unusable rather than
  // producing a negative cycle day.
  const dayOfCycle = daysSinceStart >= 0 ? daysSinceStart + 1 : null;

  if (daysSinceStart >= ABSENT_AFTER_DAYS) flags.push('absent');

  // Irregularity is a property of the cycles, not of how sure the app is about
  // them. Keying this off `confidence` told anyone with two textbook 28-day
  // cycles that hers vary a lot, because two cycles is always low confidence
  // however identical they are.
  if (
    stats.completeCycles >= 3 &&
    ((stats.variabilityDays !== null && stats.variabilityDays > 7) ||
      (stats.shortestDays !== null && stats.shortestDays < 21) ||
      (stats.longestDays !== null && stats.longestDays > 35))
  ) {
    flags.push('irregular');
  }

  const assumedLength = stats.medianLengthDays;
  const periodDays = stats.medianPeriodDays ?? DEFAULT_PERIOD_DAYS;

  const phase =
    assumedLength !== null && dayOfCycle !== null
      ? phaseForDay(dayOfCycle, assumedLength, periodDays)
      : null;

  let predictedNextStart: string | null = null;
  let predictedWindow: [string, string] | null = null;
  let daysUntilNext: number | null = null;

  if (assumedLength !== null) {
    predictedNextStart = addDays(lastStart, assumedLength);
    const spread = Math.max(2, stats.variabilityDays ?? 2);
    predictedWindow = [
      addDays(predictedNextStart, -spread),
      addDays(predictedNextStart, spread),
    ];
    daysUntilNext = daysBetween(today, predictedNextStart);

    if (daysBetween(predictedWindow[1], today) > 0 && !flags.includes('absent')) {
      flags.push('late');
    }
  }

  return {
    stats,
    lastStart,
    dayOfCycle,
    phase,
    assumedLengthDays: assumedLength,
    predictedNextStart,
    predictedWindow,
    daysUntilNext,
    daysSinceStart,
    flags,
  };
}

/**
 * The safety message for a flag, or null when there is nothing to say.
 *
 * The absent-period wording is deliberate. Periods that stop are one of the
 * clearest signs of low energy availability, which is the risk this whole app
 * has to be careful about, and the right response is a clinician - not a
 * training tweak and not a cheerful nudge to eat more.
 */
export function flagMessage(flag: CycleFlag): string | null {
  switch (flag) {
    case 'absent':
      return 'You have not logged a period for over three months. That is worth raising with a doctor - it is one of the clearest signals that training and eating are out of balance, and it is treatable.';
    case 'irregular':
      return 'Your cycles vary quite a lot, so predictions here are rough. If they are consistently shorter than 21 days or longer than 35, a doctor is the right person to ask.';
    case 'late':
      return 'You are past your usual window. Cycles move around for all sorts of ordinary reasons; if it keeps happening, mention it at your next appointment.';
    case 'no-data':
      return null;
  }
}
